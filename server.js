const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { LogStore } = require('./lib/log-store');
const { ConfigStore } = require('./lib/config-store');
const { TmuxManager } = require('./lib/tmux-manager');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const MAX_LINES_PER_SOURCE = Number(process.env.MAX_LINES_PER_SOURCE || 10000);
const DIST_DIR = path.join(__dirname, 'dist');
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'data', 'config.json');
const INTERNAL_TOKEN = crypto.randomBytes(24).toString('hex');
const MAX_WS_BACKPRESSURE = 2 * 1024 * 1024;

const logStore = new LogStore(MAX_LINES_PER_SOURCE);
const configStore = new ConfigStore(CONFIG_PATH);
let tmuxManager;
let shuttingDown = false;

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function readJson(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(new Error('请求内容过大'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('JSON 格式无效')); }
    });
    request.on('error', reject);
  });
}

function contentType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function serveFrontend(request, response, pathname) {
  if (!fs.existsSync(DIST_DIR)) {
    sendJson(response, 503, { error: '前端尚未构建，请先执行 npm run build' });
    return;
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(DIST_DIR, relative);
  if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== path.join(DIST_DIR, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST_DIR, 'index.html');
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(response, 500, { error: '读取前端文件失败' });
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  const internalMatch = pathname.match(/^\/api\/internal\/collector\/(combined|px4|gazebo)\/([a-f0-9-]+)$/);
  if (request.method === 'POST' && internalMatch) {
    if (requestUrl.searchParams.get('token') !== INTERNAL_TOKEN) return sendJson(response, 403, { error: 'Forbidden' });
    tmuxManager.acceptStream(internalMatch[1], internalMatch[2], request, response);
    return;
  }

  try {
    if (request.method === 'GET' && pathname === '/api/status') {
      sendJson(response, 200, {
        ...logStore.stats(),
        connectedBrowsers: Array.from(wss.clients).filter((client) => client.readyState === WebSocket.OPEN).length,
        collectors: tmuxManager.snapshot(),
        uptimeSeconds: Math.floor(process.uptime())
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/tmux/panes') {
      sendJson(response, 200, { panes: await tmuxManager.listPanes() });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/collectors') {
      sendJson(response, 200, { collectors: tmuxManager.snapshot() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/collectors/attach') {
      const body = await readJson(request);
      const collector = await tmuxManager.attach(body);
      sendJson(response, 200, { ok: true, collector });
      return;
    }

    const detachMatch = pathname.match(/^\/api\/collectors\/(combined|px4|gazebo)$/);
    if (request.method === 'DELETE' && detachMatch) {
      await tmuxManager.detach(detachMatch[1]);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: '接口不存在' });
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      serveFrontend(request, response, pathname);
      return;
    }

    response.writeHead(405, { Allow: 'GET, HEAD, POST, DELETE' }).end();
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 400, { error: error.message || '请求失败' });
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 128 * 1024 });

function sendWs(client, payload) {
  if (client.readyState !== WebSocket.OPEN) return;
  if (client.bufferedAmount > MAX_WS_BACKPRESSURE) {
    client.close(1013, '客户端处理速度过慢');
    return;
  }
  client.send(JSON.stringify(payload));
}

function broadcast(payload, readyOnly = true) {
  for (const client of wss.clients) {
    if ((!readyOnly || client.subscribed) && client.readyState === WebSocket.OPEN) sendWs(client, payload);
  }
}

wss.on('connection', (client) => {
  client.isAlive = true;
  client.subscribed = false;
  client.on('pong', () => { client.isAlive = true; });

  const subscribeTimer = setTimeout(() => client.close(1008, '未订阅日志'), 5000);
  client.on('message', (data) => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message.type !== 'subscribe' || client.subscribed) return;

    const after = Number.isSafeInteger(message.after) && message.after >= 0 ? message.after : 0;
    const replay = logStore.replayAfter(after);
    sendWs(client, {
      type: 'snapshot-start',
      lost: replay.lost,
      latestSequence: replay.latestSequence,
      total: replay.entries.length,
      maxLinesPerSource: logStore.maxLinesPerSource,
      collectors: tmuxManager.snapshot()
    });
    for (let index = 0; index < replay.entries.length; index += 500) {
      sendWs(client, { type: 'snapshot-batch', entries: replay.entries.slice(index, index + 500) });
    }
    sendWs(client, { type: 'snapshot-end' });
    client.subscribed = true;
    clearTimeout(subscribeTimer);
  });
  client.on('close', () => clearTimeout(subscribeTimer));
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 15000);
heartbeat.unref();

logStore.on('entry', (entry) => broadcast({ type: 'log', entry }));

tmuxManager = new TmuxManager({
  logStore,
  configStore,
  port: PORT,
  token: INTERNAL_TOKEN,
  producerPath: path.join(__dirname, 'scripts', 'tmux-producer.js'),
  onStatus: (collectors) => broadcast({ type: 'collector-status', collectors }, false)
});

server.listen(PORT, HOST, async () => {
  console.log(`PX4/Gazebo 日志平台：http://${HOST}:${PORT}`);
  console.log(`日志仅保存在内存中，每个来源最多 ${MAX_LINES_PER_SOURCE} 行。`);
  await tmuxManager.restore();
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在关闭……`);
  clearInterval(heartbeat);
  await tmuxManager.shutdown().catch(() => {});
  for (const client of wss.clients) client.close(1001, '服务关闭');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

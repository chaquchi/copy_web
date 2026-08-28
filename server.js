const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const MAX_LINES_PER_SOURCE = Math.max(100, Number(process.env.MAX_LINES_PER_SOURCE || 10000));
const MAX_BODY_BYTES = 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VALID_SOURCES = new Set(['px4', 'gazebo']);
const clients = new Set();

let sequence = 0;
const history = [];
const sourceCounts = { px4: 0, gazebo: 0 };

function stripAnsi(value) {
  return value
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/\r/g, '');
}

function detectLevel(message, stream) {
  if (/\b(FATAL|PANIC|CRITICAL|ERROR|ERR)\b/i.test(message)) return 'error';
  if (/\b(WARNING|WARN)\b/i.test(message)) return 'warn';
  if (/\bDEBUG\b/i.test(message)) return 'debug';
  if (/\bINFO\b/i.test(message)) return 'info';
  return stream === 'stderr' ? 'error' : 'plain';
}

function addLog(source, rawMessage, stream = 'stdout') {
  if (!VALID_SOURCES.has(source)) return null;
  const message = stripAnsi(String(rawMessage)).replace(/\n$/, '');
  if (!message.trim()) return null;

  const entry = {
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    source,
    stream,
    level: detectLevel(message, stream),
    message
  };

  history.push(entry);
  sourceCounts[source] += 1;

  if (sourceCounts[source] > MAX_LINES_PER_SOURCE) {
    const oldestIndex = history.findIndex((item) => item.source === source);
    if (oldestIndex !== -1) {
      history.splice(oldestIndex, 1);
      sourceCounts[source] -= 1;
    }
  }

  broadcast({ type: 'log', entry });
  return entry;
}

function replayAfter(after) {
  const replay = history.filter((item) => item.sequence > after);
  const expected = Math.max(0, sequence - after);
  return { replay, lost: Math.max(0, expected - replay.length) };
}

function encodeWebSocketFrame(text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendText(client, text) {
  if (!client.socket.destroyed && client.socket.writable) client.socket.write(encodeWebSocketFrame(text));
}

function sendJson(client, payload) {
  sendText(client, JSON.stringify(payload));
}

function broadcast(payload) {
  const encoded = encodeWebSocketFrame(JSON.stringify(payload));
  for (const client of clients) {
    if (client.isReady && !client.socket.destroyed && client.socket.writable) client.socket.write(encoded);
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }[extension] || 'application/octet-stream';
}

function sendApiJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function handleIngest(request, response, source, requestUrl) {
  if (!VALID_SOURCES.has(source)) {
    sendApiJson(response, 404, { error: '日志来源只支持 px4 或 gazebo' });
    return;
  }

  const stream = requestUrl.searchParams.get('stream') === 'stderr' ? 'stderr' : 'stdout';
  let pending = '';
  let bytes = 0;
  let accepted = 0;

  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_BODY_BYTES && !requestUrl.searchParams.has('streaming')) {
      request.destroy();
      return;
    }

    pending += chunk;
    const lines = pending.split(/\r?\n|\r/);
    pending = lines.pop() || '';
    for (const line of lines) if (addLog(source, line, stream)) accepted += 1;
  });
  request.on('end', () => {
    if (pending && addLog(source, pending, stream)) accepted += 1;
    sendApiJson(response, 200, { ok: true, accepted });
  });
  request.on('error', () => {
    if (!response.headersSent) sendApiJson(response, 400, { error: '日志传输中断' });
  });
}

function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const ingestMatch = requestUrl.pathname.match(/^\/api\/ingest\/(px4|gazebo)$/);

  if (request.method === 'POST' && ingestMatch) {
    handleIngest(request, response, ingestMatch[1], requestUrl);
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/status') {
    sendApiJson(response, 200, {
      connectedClients: clients.size,
      latestSequence: sequence,
      buffered: { ...sourceCounts },
      maxLinesPerSource: MAX_LINES_PER_SOURCE,
      uptimeSeconds: Math.floor(process.uptime())
    });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' }).end();
    return;
  }

  serveStatic(request, response, decodeURIComponent(requestUrl.pathname));
});

function handleWebSocketData(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (client.buffer.length < 4) return;
      payloadLength = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (client.buffer.length < 10) return;
      const length = client.buffer.readBigUInt64BE(2);
      if (length > BigInt(Number.MAX_SAFE_INTEGER)) return client.socket.destroy();
      payloadLength = Number(length);
      offset = 10;
    }

    const maskLength = masked ? 4 : 0;
    if (client.buffer.length < offset + maskLength + payloadLength) return;
    const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLength));
    client.buffer = client.buffer.subarray(offset + payloadLength);

    if (masked) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 0x8) return client.socket.end(Buffer.from([0x88, 0x00]));
    if (opcode === 0x9) {
      const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
      client.socket.write(pong);
      continue;
    }
    if (opcode !== 0x1) continue;

    let message;
    try {
      message = JSON.parse(payload.toString('utf8'));
    } catch {
      continue;
    }
    if (message.type !== 'subscribe') continue;

    const after = Number.isSafeInteger(message.after) && message.after >= 0 ? message.after : 0;
    const { replay, lost } = replayAfter(after);
    sendJson(client, {
      type: 'snapshot',
      entries: replay,
      lost,
      latestSequence: sequence,
      maxLinesPerSource: MAX_LINES_PER_SOURCE
    });
    client.isReady = true;
    clearTimeout(client.readyTimer);
  }
}

server.on('upgrade', (request, socket) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const key = request.headers['sec-websocket-key'];
  if (requestUrl.pathname !== '/ws' || !key || request.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n'
  ].join('\r\n'));

  const client = { socket, buffer: Buffer.alloc(0), isReady: false, readyTimer: null };
  clients.add(client);
  client.readyTimer = setTimeout(() => {
    if (!client.isReady) socket.destroy();
  }, 5000);

  socket.on('data', (chunk) => handleWebSocketData(client, chunk));
  socket.on('close', () => {
    clearTimeout(client.readyTimer);
    clients.delete(client);
  });
  socket.on('error', () => {
    clearTimeout(client.readyTimer);
    clients.delete(client);
  });
});

function pipeLines(readable, source, stream) {
  let pending = '';
  readable.setEncoding('utf8');
  readable.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n|\r/);
    pending = lines.pop() || '';
    for (const line of lines) addLog(source, line, stream);
  });
  readable.on('end', () => {
    if (pending) addLog(source, pending, stream);
  });
}

function startConfiguredCommand(source, command) {
  if (!command) return;
  addLog(source, `INFO 启动配置命令：${command}`);
  const child = spawn('/bin/bash', ['-lc', command], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  pipeLines(child.stdout, source, 'stdout');
  pipeLines(child.stderr, source, 'stderr');
  child.on('error', (error) => addLog(source, `ERROR 无法启动命令：${error.message}`, 'stderr'));
  child.on('exit', (code, signal) => {
    const detail = signal ? `信号 ${signal}` : `退出码 ${code}`;
    addLog(source, `${code === 0 ? 'INFO' : 'ERROR'} 进程已结束（${detail}）`, code === 0 ? 'stdout' : 'stderr');
  });
}

server.listen(PORT, HOST, () => {
  console.log(`PX4/Gazebo 日志平台已启动：http://${HOST}:${PORT}`);
  console.log(`每个来源最多保留 ${MAX_LINES_PER_SOURCE} 行内存日志，不写入磁盘。`);
  startConfiguredCommand('px4', process.env.PX4_COMMAND);
  startConfiguredCommand('gazebo', process.env.GAZEBO_COMMAND);
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务……`);
  for (const client of clients) client.socket.end(Buffer.from([0x88, 0x00]));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { addLog, detectLevel, stripAnsi };

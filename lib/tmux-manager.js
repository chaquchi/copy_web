const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const VALID_SOURCES = new Set(['combined', 'px4', 'gazebo']);
const LIVE_MARKER = '\u001ePX4_WEB_LIVE\u001e';

class TmuxManager {
  constructor(options) {
    this.logStore = options.logStore;
    this.configStore = options.configStore;
    this.port = options.port;
    this.token = options.token;
    this.producerPath = path.resolve(options.producerPath);
    this.collectors = new Map();
    this.onStatus = options.onStatus || (() => {});
    this.monitorTimer = null;
  }

  async listPanes() {
    try {
      const format = [
        '#{session_name}:#{window_index}.#{pane_index}',
        '#{session_name}', '#{window_index}', '#{pane_index}',
        '#{pane_current_command}', '#{pane_pid}', '#{pane_title}',
        '#{pane_active}', '#{pane_pipe}'
      ].join('\t');
      const { stdout } = await execFileAsync('tmux', ['list-panes', '-a', '-F', format]);
      return stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [target, session, window, pane, command, pid, title, active, piped] = line.split('\t');
        return {
          target, session, window: Number(window), pane: Number(pane), command,
          pid: Number(pid), title, active: active === '1', piped: piped === '1'
        };
      });
    } catch (error) {
      if (/no server running|failed to connect|error connecting/i.test(error.stderr || error.message)) return [];
      throw new Error(`无法读取 tmux 窗格：${(error.stderr || error.message).trim()}`);
    }
  }

  snapshot() {
    return Array.from(this.collectors.values()).map((collector) => this.publicState(collector));
  }

  publicState(collector) {
    return {
      source: collector.source,
      target: collector.target,
      status: collector.status,
      message: collector.message,
      sessionId: collector.sessionId,
      connectedAt: collector.connectedAt,
      lastLogAt: collector.lastLogAt,
      historyLines: collector.historyLines
    };
  }

  async attach({ source, target, historyLines = 2000 }, persist = true) {
    if (!VALID_SOURCES.has(source)) throw new Error('日志来源无效');
    if (!/^[^:\s]+:\d+\.\d+$/.test(target)) throw new Error('tmux 窗格格式无效');
    historyLines = Math.min(10000, Math.max(0, Number(historyLines) || 0));

    const panes = await this.listPanes();
    const pane = panes.find((item) => item.target === target);
    if (!pane) throw new Error(`找不到 tmux 窗格 ${target}`);

    if (this.collectors.has(source)) await this.detach(source, false);
    for (const existing of this.collectors.values()) {
      if (existing.target === target) await this.detach(existing.source, false);
    }

    // 清除遗留的手工 pipe-pane，之后由平台统一管理。
    if (pane.piped) await this.disablePipe(target);

    const collector = {
      source,
      target,
      historyLines,
      sessionId: crypto.randomUUID(),
      status: 'connecting',
      message: '正在连接 tmux 终端',
      connectedAt: null,
      lastLogAt: null,
      activeRequest: null,
      opening: false,
      stopped: false
    };
    this.collectors.set(source, collector);
    this.emitStatus();

    try {
      await this.openPipe(collector, historyLines);
      if (persist) this.configStore.setCollector(source, { target, historyLines });
    } catch (error) {
      collector.status = 'error';
      collector.message = error.message;
      this.emitStatus();
      throw error;
    }
    return this.publicState(collector);
  }

  async openPipe(collector, historyLines = 0) {
    if (collector.opening || collector.stopped) return;
    collector.opening = true;
    collector.status = 'connecting';
    collector.message = historyLines > 0 ? '正在导入历史并连接实时输出' : '正在恢复实时采集';
    this.emitStatus();

    const endpoint = `http://127.0.0.1:${this.port}/api/internal/collector/${collector.source}/${collector.sessionId}?token=${encodeURIComponent(this.token)}`;
    const historyCommand = historyLines > 0
      ? `tmux capture-pane -p -J -t ${shellQuote(collector.target)} -S -${historyLines}; `
      : '';
    const shellCommand = `{ ${historyCommand}printf '\\036PX4_WEB_LIVE\\036\\n'; cat; } | ${shellQuote(process.execPath)} ${shellQuote(this.producerPath)} ${shellQuote(endpoint)}`;

    try {
      await execFileAsync('tmux', ['pipe-pane', '-t', collector.target, '-o', shellCommand]);
      collector.message = '等待终端数据';
    } finally {
      collector.opening = false;
      this.emitStatus();
    }
  }

  acceptStream(source, sessionId, request, response) {
    const collector = this.collectors.get(source);
    if (!collector || collector.sessionId !== sessionId || collector.stopped) {
      response.writeHead(409).end('collector is not active');
      return;
    }

    collector.activeRequest = request;
    collector.status = 'connected';
    collector.message = '正在实时采集';
    collector.connectedAt ||= new Date().toISOString();
    let origin = collector.historyLines > 0 && !collector.historyImported ? 'history' : 'live';
    let pending = '';
    this.emitStatus();

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (line === LIVE_MARKER) {
          origin = 'live';
          collector.historyImported = true;
          continue;
        }
        const entry = this.logStore.add(source, line, {
          sessionId: collector.sessionId,
          target: collector.target,
          origin
        });
        if (entry) collector.lastLogAt = entry.timestamp;
      }
    });

    const close = () => {
      if (collector.activeRequest !== request) return;
      if (pending && pending !== LIVE_MARKER) {
        const entry = this.logStore.add(source, pending, {
          sessionId: collector.sessionId,
          target: collector.target,
          origin
        });
        if (entry) collector.lastLogAt = entry.timestamp;
      }
      collector.activeRequest = null;
      if (!collector.stopped) {
        collector.status = 'reconnecting';
        collector.message = '采集连接中断，等待自动恢复';
      }
      this.emitStatus();
    };

    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
      close();
    });
    request.on('close', close);
    request.on('error', close);
  }

  async sendInput(source, input = {}) {
    const collector = this.collectors.get(source);
    if (!collector || collector.stopped) throw new Error('对应的终端采集器尚未连接');

    const allowedKeys = new Set(['Enter', 'Tab', 'Up', 'Down', 'Left', 'Right', 'BSpace', 'Escape', 'C-c', 'C-d', 'C-z']);
    if (typeof input.text === 'string') {
      if (input.text.length > 4096) throw new Error('单次输入不能超过 4096 个字符');
      if (input.text.includes('\0') || /[\r\n]/.test(input.text)) throw new Error('单次输入不能包含换行符');
      if (input.text) await execFileAsync('tmux', ['send-keys', '-t', collector.target, '-l', '--', input.text]);
      if (input.enter !== false) await execFileAsync('tmux', ['send-keys', '-t', collector.target, 'Enter']);
    } else if (typeof input.key === 'string' && allowedKeys.has(input.key)) {
      await execFileAsync('tmux', ['send-keys', '-t', collector.target, input.key]);
    } else {
      throw new Error('输入内容或按键无效');
    }

    return { source, target: collector.target };
  }

  async detach(source, persist = true) {
    const collector = this.collectors.get(source);
    if (!collector) return;
    collector.stopped = true;
    collector.status = 'disconnected';
    collector.message = '已断开';
    if (collector.activeRequest) collector.activeRequest.destroy();
    await this.disablePipe(collector.target).catch(() => {});
    this.collectors.delete(source);
    if (persist) this.configStore.removeCollector(source);
    this.emitStatus();
  }

  async disablePipe(target) {
    await execFileAsync('tmux', ['pipe-pane', '-t', target]);
  }

  async restore() {
    const saved = this.configStore.collectors();
    for (const [source, config] of Object.entries(saved)) {
      try {
        await this.attach({ source, ...config }, false);
      } catch (error) {
        console.warn(`恢复采集器 ${source} 失败：${error.message}`);
      }
    }
    this.startMonitor();
  }

  startMonitor() {
    clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(async () => {
      let panes;
      try { panes = await this.listPanes(); } catch { return; }
      for (const collector of this.collectors.values()) {
        if (collector.stopped || collector.opening) continue;
        const pane = panes.find((item) => item.target === collector.target);
        if (!pane) {
          collector.status = 'error';
          collector.message = 'tmux 窗格已不存在';
          this.emitStatus();
          continue;
        }
        if (!pane.piped || !collector.activeRequest) {
          if (pane.piped) await this.disablePipe(collector.target).catch(() => {});
          await this.openPipe(collector, 0).catch((error) => {
            collector.status = 'error';
            collector.message = error.message;
            this.emitStatus();
          });
        }
      }
    }, 4000);
    this.monitorTimer.unref();
  }

  emitStatus() {
    this.onStatus(this.snapshot());
  }

  async shutdown() {
    clearInterval(this.monitorTimer);
    for (const source of Array.from(this.collectors.keys())) await this.detach(source, false);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

module.exports = { TmuxManager, VALID_SOURCES };

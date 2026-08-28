const { EventEmitter } = require('events');

class LogStore extends EventEmitter {
  constructor(maxLinesPerSource = 10000) {
    super();
    this.maxLinesPerSource = Math.max(100, Number(maxLinesPerSource) || 10000);
    this.sequence = 0;
    this.entries = [];
    this.sourceCounts = new Map();
  }

  add(source, rawMessage, metadata = {}) {
    const message = stripAnsi(String(rawMessage)).replace(/\r/g, '').replace(/\n$/, '');
    if (!message.trim()) return null;

    const entry = {
      sequence: ++this.sequence,
      sessionId: metadata.sessionId || null,
      timestamp: new Date().toISOString(),
      source,
      target: metadata.target || null,
      origin: metadata.origin || 'live',
      level: detectLevel(message, metadata.stream),
      message
    };

    this.entries.push(entry);
    this.sourceCounts.set(source, (this.sourceCounts.get(source) || 0) + 1);
    this.pruneSource(source);
    this.emit('entry', entry);
    return entry;
  }

  addChunk(source, chunk, state, metadata = {}) {
    state.pending = (state.pending || '') + chunk;
    const lines = state.pending.split(/\r?\n|\r/);
    state.pending = lines.pop() || '';
    for (const line of lines) this.add(source, line, metadata);
  }

  flushChunk(source, state, metadata = {}) {
    if (state.pending) this.add(source, state.pending, metadata);
    state.pending = '';
  }

  pruneSource(source) {
    while ((this.sourceCounts.get(source) || 0) > this.maxLinesPerSource) {
      const index = this.entries.findIndex((entry) => entry.source === source);
      if (index === -1) break;
      this.entries.splice(index, 1);
      this.sourceCounts.set(source, this.sourceCounts.get(source) - 1);
    }
  }

  replayAfter(after = 0) {
    const entries = this.entries.filter((entry) => entry.sequence > after);
    const expected = Math.max(0, this.sequence - after);
    return {
      entries,
      lost: Math.max(0, expected - entries.length),
      latestSequence: this.sequence
    };
  }

  stats() {
    return {
      latestSequence: this.sequence,
      buffered: Object.fromEntries(this.sourceCounts),
      totalBuffered: this.entries.length,
      maxLinesPerSource: this.maxLinesPerSource
    };
  }
}

function detectLevel(message, stream) {
  if (/\b(FATAL|PANIC|CRITICAL|ERROR|ERR|FAILED|FAILURE)\b/i.test(message)) return 'error';
  if (/\b(WARNING|WARN)\b/i.test(message)) return 'warn';
  if (/\bDEBUG|TRACE\b/i.test(message)) return 'debug';
  if (/\bINFO|NOTICE\b/i.test(message)) return 'info';
  return stream === 'stderr' ? 'error' : 'plain';
}

function stripAnsi(value) {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

module.exports = { LogStore, detectLevel, stripAnsi };

(() => {
  const MAX_CLIENT_ENTRIES = 20000;
  const state = {
    entries: [],
    sequences: new Set(),
    lastSequence: 0,
    lastRenderedSequence: 0,
    source: 'all',
    level: 'all',
    search: '',
    follow: true,
    unseen: 0,
    socket: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    renderQueued: false,
    fullRenderQueued: false
  };

  const elements = {
    connectionPill: document.querySelector('#connectionPill'),
    connectionText: document.querySelector('#connectionText'),
    px4Count: document.querySelector('#px4Count'),
    gazeboCount: document.querySelector('#gazeboCount'),
    visibleCount: document.querySelector('#visibleCount'),
    allBadge: document.querySelector('#allBadge'),
    searchInput: document.querySelector('#searchInput'),
    copyVisibleButton: document.querySelector('#copyVisibleButton'),
    followToggle: document.querySelector('#followToggle'),
    consoleOutput: document.querySelector('#consoleOutput'),
    logRows: document.querySelector('#logRows'),
    emptyState: document.querySelector('#emptyState'),
    newLogButton: document.querySelector('#newLogButton'),
    newLogCount: document.querySelector('#newLogCount'),
    footerStatus: document.querySelector('#footerStatus'),
    footerDot: document.querySelector('.footer-dot'),
    bufferLimit: document.querySelector('#bufferLimit'),
    toast: document.querySelector('#toast')
  };

  const numberFormatter = new Intl.NumberFormat('zh-CN');
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false
  });

  function setConnection(status, text) {
    elements.connectionPill.dataset.state = status;
    elements.connectionText.textContent = text;
    elements.footerDot.className = `footer-dot ${status === 'online' ? 'online' : status === 'offline' ? 'offline' : ''}`;
    elements.footerStatus.textContent = status === 'online' ? '正在实时接收日志' : text;
  }

  function showToast(message, error = false) {
    elements.toast.textContent = message;
    elements.toast.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.className = 'toast', 2600);
  }

  function addEntries(entries) {
    let added = 0;
    for (const entry of entries) {
      if (!entry || state.sequences.has(entry.sequence)) continue;
      state.entries.push(entry);
      state.sequences.add(entry.sequence);
      state.lastSequence = Math.max(state.lastSequence, entry.sequence);
      added += 1;
    }
    if (!added) return;

    state.entries.sort((a, b) => a.sequence - b.sequence);
    if (state.entries.length > MAX_CLIENT_ENTRIES) {
      const removed = state.entries.splice(0, state.entries.length - MAX_CLIENT_ENTRIES);
      removed.forEach((entry) => state.sequences.delete(entry.sequence));
    }
    if (!state.follow) {
      state.unseen += added;
      updateNewLogButton();
    }
    queueRender(false);
  }

  function connect() {
    clearTimeout(state.reconnectTimer);
    setConnection('connecting', state.reconnectAttempt ? `第 ${state.reconnectAttempt} 次重连` : '正在连接');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    state.socket = socket;

    socket.addEventListener('open', () => {
      state.reconnectAttempt = 0;
      setConnection('online', '已连接');
      socket.send(JSON.stringify({ type: 'subscribe', after: state.lastSequence }));
    });

    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'snapshot') {
        if (Number.isFinite(message.maxLinesPerSource)) {
          elements.bufferLimit.textContent = numberFormatter.format(message.maxLinesPerSource);
        }
        addEntries(message.entries || []);
        if (message.lost > 0) {
          showToast(`断线时间较长，${numberFormatter.format(message.lost)} 条日志已超出内存缓冲，无法恢复`, true);
        }
      } else if (message.type === 'log') {
        addEntries([message.entry]);
      }
    });

    socket.addEventListener('close', () => {
      if (state.socket !== socket) return;
      scheduleReconnect();
    });
    socket.addEventListener('error', () => socket.close());
  }

  function scheduleReconnect() {
    state.reconnectAttempt += 1;
    const delays = [1000, 2000, 5000, 10000];
    const delay = delays[Math.min(state.reconnectAttempt - 1, delays.length - 1)];
    setConnection('offline', `${Math.round(delay / 1000)} 秒后重连`);
    state.reconnectTimer = setTimeout(connect, delay);
  }

  function filteredEntries() {
    const needle = state.search.toLocaleLowerCase();
    return state.entries.filter((entry) => {
      if (state.source !== 'all' && entry.source !== state.source) return false;
      if (state.level !== 'all' && entry.level !== state.level) return false;
      if (needle && !`${entry.source} ${entry.level} ${entry.message}`.toLocaleLowerCase().includes(needle)) return false;
      return true;
    });
  }

  function formatLevel(level) {
    return { error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG', plain: '—' }[level] || '—';
  }

  function formatTime(timestamp) {
    try { return timeFormatter.format(new Date(timestamp)); } catch { return '--:--:--.---'; }
  }

  function createRow(entry) {
    const row = document.createElement('div');
    row.className = `log-row level-${entry.level}`;
    row.dataset.sequence = entry.sequence;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatTime(entry.timestamp);

    const source = document.createElement('span');
    source.className = `log-source ${entry.source}`;
    source.textContent = entry.source === 'px4' ? 'PX4' : 'GAZEBO';

    const level = document.createElement('span');
    level.className = 'log-level';
    level.textContent = formatLevel(entry.level);

    const message = document.createElement('span');
    message.className = 'log-message';
    message.textContent = entry.message;

    row.append(time, source, level, message);
    return row;
  }

  function queueRender(full = false) {
    state.fullRenderQueued ||= full;
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      const shouldRenderFully = state.fullRenderQueued;
      state.renderQueued = false;
      state.fullRenderQueued = false;
      render(shouldRenderFully);
    });
  }

  function render(full = false) {
    const wasAtBottom = isAtBottom();
    const visible = filteredEntries();
    const fragment = document.createDocumentFragment();

    if (full) {
      for (const entry of visible) fragment.appendChild(createRow(entry));
      elements.logRows.replaceChildren(fragment);
    } else {
      for (const entry of visible) {
        if (entry.sequence > state.lastRenderedSequence) fragment.appendChild(createRow(entry));
      }
      elements.logRows.appendChild(fragment);
    }
    state.lastRenderedSequence = state.lastSequence;
    elements.emptyState.hidden = visible.length > 0;

    const px4 = state.entries.reduce((count, entry) => count + (entry.source === 'px4'), 0);
    const gazebo = state.entries.length - px4;
    elements.px4Count.textContent = numberFormatter.format(px4);
    elements.gazeboCount.textContent = numberFormatter.format(gazebo);
    elements.visibleCount.textContent = numberFormatter.format(visible.length);
    elements.allBadge.textContent = numberFormatter.format(state.entries.length);

    if (state.follow || wasAtBottom) scrollToBottom(false);
  }

  function isAtBottom() {
    const el = elements.consoleOutput;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 45;
  }

  function scrollToBottom(smooth = true) {
    elements.consoleOutput.scrollTo({ top: elements.consoleOutput.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    state.follow = true;
    state.unseen = 0;
    elements.followToggle.checked = true;
    updateNewLogButton();
  }

  function updateNewLogButton() {
    elements.newLogButton.hidden = state.unseen === 0;
    elements.newLogCount.textContent = numberFormatter.format(state.unseen);
  }

  function formatForCopy(entry) {
    const date = new Date(entry.timestamp);
    const stamp = Number.isNaN(date.getTime()) ? entry.timestamp : date.toLocaleString('zh-CN', { hour12: false }) + `.${String(date.getMilliseconds()).padStart(3, '0')}`;
    return `[${stamp}] [${entry.source.toUpperCase()}] [${formatLevel(entry.level)}] ${entry.message}`;
  }

  async function copyVisible() {
    const entries = filteredEntries();
    if (!entries.length) return showToast('当前没有可复制的日志', true);
    try {
      await navigator.clipboard.writeText(entries.map(formatForCopy).join('\n'));
      showToast(`已复制 ${numberFormatter.format(entries.length)} 条日志`);
    } catch {
      showToast('复制失败，请检查浏览器剪贴板权限', true);
    }
  }

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.source = button.dataset.source;
      queueRender(true);
    });
  });

  document.querySelectorAll('.level-chip').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.level-chip').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.level = button.dataset.level;
      queueRender(true);
    });
  });

  elements.searchInput.addEventListener('input', () => {
    state.search = elements.searchInput.value.trim();
    queueRender(true);
  });
  elements.copyVisibleButton.addEventListener('click', copyVisible);
  elements.newLogButton.addEventListener('click', () => scrollToBottom());
  elements.followToggle.addEventListener('change', () => {
    state.follow = elements.followToggle.checked;
    if (state.follow) scrollToBottom();
  });
  elements.consoleOutput.addEventListener('scroll', () => {
    if (isAtBottom()) {
      state.follow = true;
      state.unseen = 0;
      elements.followToggle.checked = true;
      updateNewLogButton();
    } else if (state.follow) {
      state.follow = false;
      elements.followToggle.checked = false;
    }
  }, { passive: true });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      elements.searchInput.focus();
    }
  });
  window.addEventListener('online', connect);
  window.addEventListener('offline', () => setConnection('offline', '网络已断开'));

  connect();
})();

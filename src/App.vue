<template>
  <div class="page-shell">
    <header class="app-header">
      <div class="header-title">
        <div class="logo-box"><el-icon :size="25"><Position /></el-icon></div>
        <div>
          <h1>PX4 / Gazebo 仿真日志</h1>
          <p>局域网实时终端监控平台</p>
        </div>
      </div>
      <div class="header-actions">
        <el-tag :type="socketTagType" effect="light" round>
          <span class="status-dot" :class="socketState"></span>{{ socketText }}
        </el-tag>
        <el-button type="primary" :icon="Connection" @click="openCollectorDialog">连接终端</el-button>
      </div>
    </header>

    <main class="content">
      <section class="overview-grid">
        <el-card shadow="never" class="overview-card">
          <div class="overview-icon blue"><el-icon><Monitor /></el-icon></div>
          <div><span>浏览器连接</span><strong>{{ socketText }}</strong><small>WebSocket 自动重连</small></div>
        </el-card>
        <el-card shadow="never" class="overview-card">
          <div class="overview-icon green"><el-icon><Link /></el-icon></div>
          <div><span>终端采集器</span><strong>{{ connectedCollectorCount }} / {{ collectors.length }}</strong><small>{{ collectorSummary }}</small></div>
        </el-card>
        <el-card shadow="never" class="overview-card">
          <div class="overview-icon orange"><el-icon><Document /></el-icon></div>
          <div><span>内存日志</span><strong>{{ formatNumber(entries.length) }}</strong><small>每个来源最多 {{ formatNumber(maxLinesPerSource) }} 行</small></div>
        </el-card>
        <el-card shadow="never" class="overview-card">
          <div class="overview-icon purple"><el-icon><Timer /></el-icon></div>
          <div><span>最后日志</span><strong>{{ lastLogText }}</strong><small>日志不写入磁盘</small></div>
        </el-card>
      </section>

      <el-card shadow="never" class="collector-panel">
        <template #header>
          <div class="card-header">
            <div><strong>终端采集状态</strong><span>后端自动管理 tmux，无需手工执行 curl 或 pipe-pane</span></div>
            <el-button text type="primary" :icon="Refresh" @click="refreshCollectors">刷新状态</el-button>
          </div>
        </template>
        <el-empty v-if="!collectors.length" :image-size="55" description="尚未连接 tmux 终端">
          <el-button type="primary" plain @click="openCollectorDialog">选择终端窗格</el-button>
        </el-empty>
        <div v-else class="collector-list">
          <div v-for="collector in collectors" :key="collector.source" class="collector-item">
            <div class="collector-source" :class="collector.source">
              <el-icon><DataLine /></el-icon>
            </div>
            <div class="collector-main">
              <div class="collector-title">
                <strong>{{ sourceLabel(collector.source) }}</strong>
                <el-tag size="small" :type="collectorTagType(collector.status)" effect="light">
                  {{ collectorStatusLabel(collector.status) }}
                </el-tag>
              </div>
              <div class="collector-meta">
                <span><el-icon><Monitor /></el-icon>{{ collector.target }}</span>
                <span><el-icon><Clock /></el-icon>{{ collector.lastLogAt ? relativeTime(collector.lastLogAt) : '尚无日志' }}</span>
                <span>{{ collector.message }}</span>
              </div>
            </div>
            <el-popconfirm title="断开后将停止采集，但不会停止仿真。" @confirm="detachCollector(collector.source)">
              <template #reference><el-button text type="danger">断开</el-button></template>
            </el-popconfirm>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="log-card" body-class="log-card-body">
        <template #header>
          <div class="log-toolbar">
            <div class="source-tabs">
              <el-segmented v-model="sourceFilter" :options="sourceOptions" />
            </div>
            <div class="toolbar-right">
              <el-input v-model="searchText" clearable :prefix-icon="Search" placeholder="搜索日志内容" class="search-input" />
              <el-button :icon="CopyDocument" @click="copyFilteredLogs">复制筛选结果</el-button>
            </div>
          </div>
        </template>

        <div class="filter-row">
          <span class="filter-title">日志等级</span>
          <el-check-tag v-for="option in levelOptions" :key="option.value" :checked="levelFilter === option.value" @change="levelFilter = option.value">
            <i v-if="option.value !== 'all'" class="level-dot" :class="option.value"></i>{{ option.label }}
          </el-check-tag>
          <div class="filter-spacer"></div>
          <span class="follow-label">自动跟随</span>
          <el-switch v-model="follow" @change="onFollowChange" />
        </div>

        <div class="command-bar">
          <div class="command-prompt"><span>&gt;_</span></div>
          <el-select v-model="commandSource" class="command-source" placeholder="选择终端" :disabled="!collectors.length">
            <el-option v-for="collector in collectors" :key="collector.source" :value="collector.source" :label="`${sourceShortLabel(collector.source)} · ${collector.target}`" />
          </el-select>
          <el-input
            v-model="commandText"
            class="command-input"
            placeholder="输入 PX4 或终端指令，按 Enter 发送"
            clearable
            :disabled="!commandSource"
            @keydown="handleCommandKeydown"
          />
          <el-button type="primary" :icon="Promotion" :loading="sendingCommand" :disabled="!commandSource || !commandText" @click="executeCommand">发送</el-button>
          <el-dropdown trigger="click" @command="sendSpecialKey">
            <el-button :disabled="!commandSource">终端按键<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="C-c">Ctrl+C（中断当前任务）</el-dropdown-item>
                <el-dropdown-item command="Tab">Tab（补全）</el-dropdown-item>
                <el-dropdown-item command="Up">↑ 上一条终端记录</el-dropdown-item>
                <el-dropdown-item command="Down">↓ 下一条终端记录</el-dropdown-item>
                <el-dropdown-item command="C-d" divided>Ctrl+D（EOF）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <div class="terminal-frame">
          <div class="terminal-header">
            <span>时间</span><span>来源</span><span>等级</span><span>终端消息</span>
          </div>
          <div ref="logViewport" class="log-viewport" @scroll="handleScroll">
            <el-empty v-if="!filteredEntries.length" :image-size="65" description="暂无符合条件的终端日志" />
            <div v-else class="virtual-space" :style="{ height: `${filteredEntries.length * rowHeight}px` }">
              <div class="virtual-window" :style="{ transform: `translateY(${virtualStart * rowHeight}px)` }">
                <div
                  v-for="item in virtualRows"
                  :key="item.entry.sequence"
                  class="log-row"
                  :class="`level-${item.entry.level}`"
                  :title="item.entry.message"
                >
                  <span class="log-time">{{ formatTime(item.entry.timestamp) }}</span>
                  <span><el-tag size="small" effect="plain" :type="sourceTagType(item.entry.source)">{{ sourceShortLabel(item.entry.source) }}</el-tag></span>
                  <span class="log-level" :class="item.entry.level">{{ levelLabel(item.entry.level) }}</span>
                  <span class="log-message">{{ item.entry.message }}</span>
                </div>
              </div>
            </div>
          </div>
          <el-button v-if="unseenCount" class="new-log-button" type="primary" round @click="scrollToBottom(true)">
            <el-icon><Bottom /></el-icon>{{ unseenCount }} 条新日志，回到底部
          </el-button>
        </div>
        <div class="log-footer">
          <span>当前显示 {{ formatNumber(filteredEntries.length) }} 条</span>
          <span>后端序号 {{ formatNumber(lastSequence) }}</span>
          <span>服务重启后清空终端日志</span>
        </div>
      </el-card>
    </main>

    <el-dialog v-model="collectorDialogVisible" title="连接 tmux 终端" width="640px" destroy-on-close>
      <el-alert title="平台将自动导入历史并持续采集新输出，不会停止或重启仿真。" type="info" show-icon :closable="false" />
      <el-form :model="collectorForm" label-position="top" class="collector-form">
        <el-form-item label="日志来源">
          <el-radio-group v-model="collectorForm.source">
            <el-radio-button value="combined">PX4 / Gazebo 混合</el-radio-button>
            <el-radio-button value="px4">PX4</el-radio-button>
            <el-radio-button value="gazebo">Gazebo</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="tmux 窗格">
          <el-select v-model="collectorForm.target" placeholder="选择正在运行仿真的窗格" style="width: 100%" :loading="panesLoading">
            <el-option v-for="pane in panes" :key="pane.target" :value="pane.target" :label="`${pane.target} · ${pane.command} · PID ${pane.pid}`">
              <div class="pane-option"><strong>{{ pane.target }}</strong><span>{{ pane.command }}</span><small>{{ pane.title }}</small><el-tag v-if="pane.piped" size="small" type="warning">已有管道</el-tag></div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="首次导入历史行数">
          <el-slider v-model="collectorForm.historyLines" :min="0" :max="10000" :step="500" show-input />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collectorDialogVisible = false">取消</el-button>
        <el-button :icon="Refresh" @click="loadPanes">刷新窗格</el-button>
        <el-button type="primary" :loading="attaching" :disabled="!collectorForm.target" @click="attachCollector">连接并开始采集</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowDown, Bottom, Clock, Connection, CopyDocument, DataLine, Document, Link,
  Monitor, Position, Promotion, Refresh, Search, Timer
} from '@element-plus/icons-vue';

const entries = ref([]);
const entrySequences = new Set();
const collectors = ref([]);
const panes = ref([]);
const socketState = ref('connecting');
const reconnectAttempt = ref(0);
const sourceFilter = ref('all');
const levelFilter = ref('all');
const searchText = ref('');
const follow = ref(true);
const unseenCount = ref(0);
const maxLinesPerSource = ref(10000);
const lastSequence = ref(0);
const logViewport = ref(null);
const viewportHeight = ref(500);
const scrollTop = ref(0);
const collectorDialogVisible = ref(false);
const panesLoading = ref(false);
const attaching = ref(false);
const collectorForm = reactive({ source: 'combined', target: '', historyLines: 2000 });
const commandSource = ref('');
const commandText = ref('');
const sendingCommand = ref(false);
const commandHistory = ref([]);
let commandHistoryIndex = -1;
const rowHeight = 30;
let socket;
let reconnectTimer;
let resizeObserver;
let relativeTimer;
const nowTick = ref(Date.now());

const sourceOptions = [
  { label: '全部日志', value: 'all' },
  { label: '混合终端', value: 'combined' },
  { label: 'PX4', value: 'px4' },
  { label: 'Gazebo', value: 'gazebo' }
];
const levelOptions = [
  { label: '全部', value: 'all' }, { label: 'ERROR', value: 'error' },
  { label: 'WARN', value: 'warn' }, { label: 'INFO', value: 'info' },
  { label: 'DEBUG', value: 'debug' }
];

const filteredEntries = computed(() => {
  const needle = searchText.value.trim().toLocaleLowerCase();
  return entries.value.filter((entry) => {
    if (sourceFilter.value !== 'all' && entry.source !== sourceFilter.value) return false;
    if (levelFilter.value !== 'all' && entry.level !== levelFilter.value) return false;
    return !needle || `${entry.source} ${entry.level} ${entry.message}`.toLocaleLowerCase().includes(needle);
  });
});
const virtualStart = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight) - 15));
const virtualEnd = computed(() => Math.min(filteredEntries.value.length, Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight) + 15));
const virtualRows = computed(() => filteredEntries.value.slice(virtualStart.value, virtualEnd.value).map((entry, index) => ({ entry, index: virtualStart.value + index })));
const connectedCollectorCount = computed(() => collectors.value.filter((item) => item.status === 'connected').length);
const collectorSummary = computed(() => collectors.value.length ? collectors.value.map((item) => `${sourceShortLabel(item.source)} ${collectorStatusLabel(item.status)}`).join(' · ') : '尚未连接 tmux');
const socketText = computed(() => ({ online: '已连接', offline: '已断开', connecting: reconnectAttempt.value ? `正在重连 ${reconnectAttempt.value}` : '正在连接' }[socketState.value]));
const socketTagType = computed(() => ({ online: 'success', offline: 'danger', connecting: 'warning' }[socketState.value]));
const lastLogText = computed(() => entries.value.length ? relativeTime(entries.value[entries.value.length - 1].timestamp) : '尚无日志');

function connectWebSocket() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close();
  socketState.value = 'connecting';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = current;
  current.addEventListener('open', () => {
    if (socket !== current) return;
    socketState.value = 'online';
    reconnectAttempt.value = 0;
    current.send(JSON.stringify({ type: 'subscribe', after: lastSequence.value }));
  });
  current.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'snapshot-start') {
      maxLinesPerSource.value = message.maxLinesPerSource || 10000;
      collectors.value = message.collectors || [];
      if (message.lost) ElMessage.warning(`${message.lost} 条日志已超出内存缓冲，无法恢复`);
    } else if (message.type === 'snapshot-batch') addEntries(message.entries || []);
    else if (message.type === 'log') addEntries([message.entry]);
    else if (message.type === 'collector-status') collectors.value = message.collectors || [];
  });
  current.addEventListener('close', () => {
    if (socket !== current) return;
    socketState.value = 'offline';
    reconnectAttempt.value += 1;
    const delay = [1000, 2000, 5000, 10000][Math.min(reconnectAttempt.value - 1, 3)];
    reconnectTimer = setTimeout(connectWebSocket, delay);
  });
  current.addEventListener('error', () => current.close());
}

function addEntries(newEntries) {
  let added = 0;
  for (const entry of newEntries) {
    if (!entry || entrySequences.has(entry.sequence)) continue;
    entrySequences.add(entry.sequence);
    entries.value.push(entry);
    lastSequence.value = Math.max(lastSequence.value, entry.sequence);
    added += 1;
  }
  if (!added) return;
  entries.value.sort((a, b) => a.sequence - b.sequence);
  const maxClientLines = maxLinesPerSource.value * 3;
  if (entries.value.length > maxClientLines) {
    const removed = entries.value.splice(0, entries.value.length - maxClientLines);
    removed.forEach((entry) => entrySequences.delete(entry.sequence));
  }
  if (follow.value) nextTick(() => scrollToBottom(false));
  else unseenCount.value += added;
}

function handleScroll(event) {
  const element = event.currentTarget;
  scrollTop.value = element.scrollTop;
  const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 45;
  if (atBottom) {
    follow.value = true;
    unseenCount.value = 0;
  } else if (follow.value) follow.value = false;
}
function scrollToBottom(smooth = false) {
  if (!logViewport.value) return;
  logViewport.value.scrollTo({ top: filteredEntries.value.length * rowHeight, behavior: smooth ? 'smooth' : 'auto' });
  follow.value = true;
  unseenCount.value = 0;
}
function onFollowChange(value) { if (value) nextTick(() => scrollToBottom(true)); }

async function requestJson(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}
async function loadPanes() {
  panesLoading.value = true;
  try {
    const result = await requestJson('/api/tmux/panes');
    panes.value = result.panes || [];
    if (!collectorForm.target && panes.value.length === 1) collectorForm.target = panes.value[0].target;
  } catch (error) { ElMessage.error(error.message); }
  finally { panesLoading.value = false; }
}
async function refreshCollectors() {
  try {
    const result = await requestJson('/api/collectors');
    collectors.value = result.collectors || [];
    ElMessage.success('状态已刷新');
  } catch (error) { ElMessage.error(error.message); }
}
async function openCollectorDialog() {
  collectorDialogVisible.value = true;
  await loadPanes();
}
async function attachCollector() {
  attaching.value = true;
  try {
    await requestJson('/api/collectors/attach', { method: 'POST', body: JSON.stringify(collectorForm) });
    collectorDialogVisible.value = false;
    ElMessage.success(`已连接 ${collectorForm.target}`);
    await refreshCollectors();
  } catch (error) { ElMessage.error(error.message); }
  finally { attaching.value = false; }
}
async function detachCollector(source) {
  try {
    await requestJson(`/api/collectors/${source}`, { method: 'DELETE' });
    collectors.value = collectors.value.filter((item) => item.source !== source);
    if (commandSource.value === source) commandSource.value = collectors.value[0]?.source || '';
    ElMessage.success('已停止采集，仿真不会受到影响');
  } catch (error) { ElMessage.error(error.message); }
}

async function sendTerminalInput(payload) {
  if (!commandSource.value) return ElMessage.warning('请先连接并选择一个终端');
  sendingCommand.value = true;
  try {
    await requestJson(`/api/collectors/${commandSource.value}/input`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return true;
  } catch (error) {
    ElMessage.error(error.message);
    return false;
  } finally {
    sendingCommand.value = false;
  }
}

async function executeCommand() {
  const command = commandText.value;
  if (!command) return;
  if (await sendTerminalInput({ text: command, enter: true })) {
    if (commandHistory.value.at(-1) !== command) commandHistory.value.push(command);
    if (commandHistory.value.length > 100) commandHistory.value.shift();
    commandHistoryIndex = commandHistory.value.length;
    commandText.value = '';
    follow.value = true;
    nextTick(() => scrollToBottom(true));
  }
}

async function sendSpecialKey(key) {
  if (key === 'C-c' || key === 'C-d') {
    try {
      await ElMessageBox.confirm(
        key === 'C-c' ? 'Ctrl+C 可能中断当前 PX4/Gazebo 仿真进程，确定发送吗？' : 'Ctrl+D 可能退出当前终端或程序，确定发送吗？',
        '确认终端操作',
        { type: 'warning', confirmButtonText: '确定发送', cancelButtonText: '取消' }
      );
    } catch { return; }
  }
  if (await sendTerminalInput({ key })) ElMessage.success(`已向终端发送 ${key}`);
}

function handleCommandKeydown(event) {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    executeCommand();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!commandHistory.value.length) return;
    commandHistoryIndex = Math.max(0, commandHistoryIndex - 1);
    commandText.value = commandHistory.value[commandHistoryIndex] || '';
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    commandHistoryIndex = Math.min(commandHistory.value.length, commandHistoryIndex + 1);
    commandText.value = commandHistory.value[commandHistoryIndex] || '';
  } else if (event.key === 'Tab') {
    event.preventDefault();
    if (commandText.value) sendTerminalInput({ text: commandText.value, enter: false }).then((sent) => {
      if (sent) {
        commandText.value = '';
        sendTerminalInput({ key: 'Tab' });
      }
    });
    else sendTerminalInput({ key: 'Tab' });
  }
}

async function copyFilteredLogs() {
  if (!filteredEntries.value.length) return ElMessage.warning('当前没有可复制的日志');
  const text = filteredEntries.value.map((entry) => `[${new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false })}] [${sourceShortLabel(entry.source)}] [${levelLabel(entry.level)}] ${entry.message}`).join('\n');
  try { await navigator.clipboard.writeText(text); ElMessage.success(`已复制 ${filteredEntries.value.length} 条日志`); }
  catch { ElMessage.error('复制失败，请检查浏览器剪贴板权限'); }
}

function sourceLabel(source) { return ({ combined: 'PX4 / Gazebo 混合终端', px4: 'PX4 终端', gazebo: 'Gazebo 终端' }[source] || source); }
function sourceShortLabel(source) { return ({ combined: '混合', px4: 'PX4', gazebo: 'Gazebo' }[source] || source); }
function sourceTagType(source) { return ({ combined: 'primary', px4: 'success', gazebo: 'warning' }[source] || 'info'); }
function collectorStatusLabel(status) { return ({ connected: '采集中', connecting: '连接中', reconnecting: '重连中', disconnected: '已断开', error: '异常' }[status] || status); }
function collectorTagType(status) { return ({ connected: 'success', connecting: 'warning', reconnecting: 'warning', disconnected: 'info', error: 'danger' }[status] || 'info'); }
function levelLabel(level) { return ({ error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG', plain: '—' }[level] || '—'); }
function formatNumber(value) { return new Intl.NumberFormat('zh-CN').format(value || 0); }
function formatTime(value) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
function relativeTime(value) {
  nowTick.value;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
}

watch([sourceFilter, levelFilter, searchText], () => nextTick(() => { if (follow.value) scrollToBottom(false); }));
watch(collectors, (value) => {
  if (!value.some((item) => item.source === commandSource.value)) commandSource.value = value[0]?.source || '';
}, { deep: true, immediate: true });
onMounted(() => {
  connectWebSocket();
  relativeTimer = setInterval(() => { nowTick.value = Date.now(); }, 5000);
  if (logViewport.value) {
    resizeObserver = new ResizeObserver(([entry]) => { viewportHeight.value = entry.contentRect.height; });
    resizeObserver.observe(logViewport.value);
  }
});
onBeforeUnmount(() => {
  clearTimeout(reconnectTimer);
  clearInterval(relativeTimer);
  resizeObserver?.disconnect();
  socket?.close();
});
</script>

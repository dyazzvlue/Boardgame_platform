/* lobby.js — 大厅与 WebSocket 核心 */
const WS_URL = `ws://${location.host}/ws`;
let ws = null;
let myIdx = -1;
let selectedGame = null;
let currentRoom = null;
let gameRenderer = null; // 由各 game.js 注册
let _countdownTimer = null;

/* ── 连接 ──────────────────────────────────────────────────────────────── */
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({type: 'list'}));
    startPing();
  };
  ws.onmessage = e => handleMsg(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}

let _pingTimer = null;
function startPing() {
  clearInterval(_pingTimer);
  _pingTimer = setInterval(
    () => ws && ws.readyState === 1 && ws.send(JSON.stringify({type: 'ping'})),
    15000
  );
}

/* ── 消息路由 ───────────────────────────────────────────────────────────── */
function handleMsg(msg) {
  switch (msg.type) {
    case 'game_list': renderGameList(msg.games); break;
    case 'room':      handleRoom(msg); break;
    case 'countdown': handleCountdown(msg.seconds); break;
    case 'state':     gameRenderer && gameRenderer.onState(msg.context); break;
    case 'request':   gameRenderer && gameRenderer.onRequest(msg.player_idx, msg.kind, msg.data); break;
    case 'log':       appendLog(msg.text, msg.style); break;
    case 'game_over': gameRenderer && gameRenderer.onGameOver(msg.result); break;
    case 'error':     showError(msg.msg); break;
    case 'pong':      break;
  }
}

/* ── 游戏列表 ───────────────────────────────────────────────────────────── */
function renderGameList(games) {
  const el = document.getElementById('game-list');
  el.innerHTML = '';
  games.forEach(g => {
    const div = document.createElement('div');
    div.className = 'game-card' + (g.id === selectedGame ? ' selected' : '');
    div.innerHTML = `<h3>${g.name}</h3><small>${g.min_players}–${g.max_players} 人</small>`;
    div.onclick = () => {
      selectedGame = g.id;
      document.querySelectorAll('.game-card').forEach(c => c.classList.remove('selected'));
      div.classList.add('selected');
    };
    el.appendChild(div);
  });
  if (games.length && !selectedGame) {
    selectedGame = games[0].id;
    el.querySelector('.game-card').classList.add('selected');
  }
}

/* ── 创建 / 加入 ────────────────────────────────────────────────────────── */
function createRoom() {
  if (!selectedGame) { showError('请先选择游戏'); return; }
  const name  = document.getElementById('create-name').value.trim() || '玩家';
  const count = parseInt(document.getElementById('create-count').value);
  const pwd   = document.getElementById('create-pwd').value;
  ws.send(JSON.stringify({type: 'create', game: selectedGame, name, player_count: count, password: pwd}));
}

function joinRoom(spectate) {
  const name = document.getElementById('join-name').value.trim() || '玩家';
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const pwd  = document.getElementById('join-pwd').value;
  if (!code) { showError('请输入房间码'); return; }
  ws.send(JSON.stringify({type: 'join', room: code, name, password: pwd, spectate}));
}

/* ── 房间 ───────────────────────────────────────────────────────────────── */
function handleRoom(msg) {
  currentRoom = msg;
  myIdx = msg.your_idx ?? myIdx;
  // 收到新房间状态时，若有倒计时 banner 存在但 msg 显示不满员则清除
  if (!msg.started) {
    showSection('room-waiting');
    document.getElementById('room-code-display').textContent = msg.code;
    const hint = msg.password ? '🔒 有密码' : '';
    document.getElementById('room-pwd-hint').textContent = hint;
    renderPlayerList(msg);
    renderHostControls(msg);
  } else {
    clearCountdownDisplay();
    initGameUI(msg.game_id);
  }
}

function renderPlayerList(msg) {
  const el = document.getElementById('player-list');
  el.innerHTML = '';
  msg.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    let badges = '';
    if (p.idx === myIdx)         badges += '<span class="badge you">你</span>';
    if (p.idx === msg.host_idx)  badges += '<span class="badge host">房主</span>';
    if (p.is_ai)                 badges += '<span class="badge ai">AI</span>';
    if (!p.connected && !p.is_ai) badges += '<span class="badge offline">离线</span>';
    div.innerHTML = `${badges} <span>${p.name}</span>`;
    el.appendChild(div);
  });
  // 空位占位显示
  const filled = msg.players.length;
  for (let i = filled; i < msg.player_count; i++) {
    const div = document.createElement('div');
    div.className = 'player-item empty';
    div.innerHTML = '<span class="badge empty-slot">等待中…</span>';
    el.appendChild(div);
  }
  if (msg.spectators > 0) {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `<span class="badge spectator">观战 ×${msg.spectators}</span>`;
    el.appendChild(div);
  }
}

/* ── 房主控制面板 ────────────────────────────────────────────────────────── */
function renderHostControls(msg) {
  let ctrl = document.getElementById('host-controls');
  if (!ctrl) {
    ctrl = document.createElement('div');
    ctrl.id = 'host-controls';
    ctrl.style.cssText = 'margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;';
    const waiting = document.getElementById('room-waiting');
    if (waiting) waiting.appendChild(ctrl);
  }
  ctrl.innerHTML = '';

  const isHost = (myIdx !== -1 && myIdx === msg.host_idx);
  if (!isHost) return;  // 非房主：不显示控制按钮

  // 添加 AI 按钮（房间未满且游戏未开始）
  if (!msg.started && msg.players.length < msg.player_count) {
    const btnAI = document.createElement('button');
    btnAI.textContent = '+ 添加 AI';
    btnAI.onclick = () => ws.send(JSON.stringify({type: 'add_ai'}));
    ctrl.appendChild(btnAI);
  }

  // 手动开始按钮（至少有1名真人玩家，即房主自己）
  if (!msg.started) {
    const btnStart = document.createElement('button');
    btnStart.textContent = '▶ 立即开始';
    btnStart.style.background = '#27ae60';
    btnStart.onclick = () => {
      if (confirm('确认立即开始游戏？')) {
        ws.send(JSON.stringify({type: 'start_game'}));
      }
    };
    ctrl.appendChild(btnStart);
  }
}

/* ── 倒计时 ──────────────────────────────────────────────────────────────── */
function handleCountdown(seconds) {
  if (seconds === 0) {
    clearCountdownDisplay();
    return;
  }
  let banner = document.getElementById('countdown-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'countdown-banner';
    banner.style.cssText = [
      'margin-top:10px', 'padding:8px 14px', 'border-radius:6px',
      'background:#e67e22', 'color:#fff', 'font-weight:bold',
      'font-size:1.1em', 'text-align:center'
    ].join(';');
    const waiting = document.getElementById('room-waiting');
    if (waiting) waiting.appendChild(banner);
  }
  banner.textContent = `⏳ 房间已满，${seconds} 秒后自动开始…（房主可立即开始）`;
}

function clearCountdownDisplay() {
  const banner = document.getElementById('countdown-banner');
  if (banner) banner.remove();
}

/* ── 游戏 UI 初始化 ──────────────────────────────────────────────────────── */
function initGameUI(gameId) {
  showSection('game-wrap');
  document.getElementById('log-panel').innerHTML = '';
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  if (gameId === 'manila') {
    gameRenderer = new ManilaRenderer(container, myIdx,
      (kind, value) => ws.send(JSON.stringify({type: 'response', kind, value})));
  } else {
    container.textContent = `游戏 ${gameId} 的渲染器尚未实现`;
  }
}

/* ── 日志 ───────────────────────────────────────────────────────────────── */
function _autoStyle(text, explicitStyle) {
  if (explicitStyle && explicitStyle !== 'normal') return explicitStyle;
  // 自动给常见格式分配样式
  if (/^──/.test(text) || /^▌/.test(text) || /^►/.test(text)) return 'section';
  if (/^\s*第\s*\d+\s*轮/.test(text))                           return 'header';
  if (/^\s*──\s*第\d+次出海/.test(text))                         return 'section';
  if (/掷骰子|骰子/.test(text))                                  return 'dice';
  if (/港务长|竞拍|竞价|bid/.test(text))                          return 'bid';
  if (/部署|工人|派遣/.test(text))                                return 'deploy';
  if (/利润|收益|入账|港口结算|造船厂结算/.test(text))              return 'profit';
  if (/⚠|warn|警告|断线|异常/.test(text))                        return 'warn';
  if (/AI|🤖/.test(text))                                        return 'ai';
  return explicitStyle || 'normal';
}

function appendLog(text, style) {
  const panel = document.getElementById('log-panel');
  const div = document.createElement('div');
  div.className = `log-${_autoStyle(text, style)}`;
  div.textContent = text;
  panel.appendChild(div);
  if (panel.children.length > 300) panel.removeChild(panel.firstChild);
  panel.scrollTop = panel.scrollHeight;
}

/* ── 工具 ───────────────────────────────────────────────────────────────── */
function showSection(id) {
  ['lobby', 'room-waiting', 'game-wrap'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? (id === 'game-wrap' ? 'block' : '') : 'none';
    if (el) el.classList.toggle('hidden', s !== id);
  });
}
function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) { el.textContent = msg; setTimeout(() => el.textContent = '', 4000); }
  else alert(msg);
}

connect();

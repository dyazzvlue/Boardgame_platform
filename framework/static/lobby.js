/* lobby.js — 大厅与 WebSocket 核心 */
const WS_URL = `ws://${location.host}/ws`;
let ws = null;
let myIdx = -1;
let selectedGame = null;
let currentRoom = null;
let gameRenderer = null; // 由各 game.js 注册

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
  _pingTimer = setInterval(() => ws && ws.readyState===1 && ws.send(JSON.stringify({type:'ping'})), 15000);
}

/* ── 消息路由 ───────────────────────────────────────────────────────────── */
function handleMsg(msg) {
  switch(msg.type) {
    case 'game_list': renderGameList(msg.games); break;
    case 'room':      handleRoom(msg); break;
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
    div.className = 'game-card' + (g.id===selectedGame ? ' selected' : '');
    div.innerHTML = `<h3>${g.name}</h3><small>${g.min_players}–${g.max_players}人</small>`;
    div.onclick = () => {
      selectedGame = g.id;
      document.querySelectorAll('.game-card').forEach(c=>c.classList.remove('selected'));
      div.classList.add('selected');
    };
    el.appendChild(div);
  });
  if (games.length && !selectedGame) { selectedGame = games[0].id; el.querySelector('.game-card').classList.add('selected'); }
}

/* ── 创建 / 加入 ────────────────────────────────────────────────────────── */
function createRoom() {
  if (!selectedGame) { showError('请先选择游戏'); return; }
  const name = document.getElementById('create-name').value.trim() || '玩家';
  const count = parseInt(document.getElementById('create-count').value);
  const pwd   = document.getElementById('create-pwd').value;
  ws.send(JSON.stringify({type:'create', game:selectedGame, name, player_count:count, password:pwd}));
}

function joinRoom(spectate) {
  const name = document.getElementById('join-name').value.trim() || '玩家';
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const pwd  = document.getElementById('join-pwd').value;
  if (!code) { showError('请输入房间码'); return; }
  ws.send(JSON.stringify({type:'join', room:code, name, password:pwd, spectate}));
}

/* ── 房间 ───────────────────────────────────────────────────────────────── */
function handleRoom(msg) {
  currentRoom = msg;
  myIdx = msg.your_idx ?? myIdx;
  if (!msg.started) {
    showSection('room-waiting');
    document.getElementById('room-code-display').textContent = msg.code;
    const hint = msg.password ? '🔒 有密码' : '';
    document.getElementById('room-pwd-hint').textContent = hint; // server doesn't echo password
    renderPlayerList(msg);
  } else {
    // 游戏已开始，等 state 消息
    initGameUI(msg.game_id);
  }
}

function renderPlayerList(msg) {
  const el = document.getElementById('player-list');
  el.innerHTML = '';
  msg.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    const badge = p.idx === myIdx ? '<span class="badge">你</span>' : '';
    div.innerHTML = `${badge} <span>${p.name}</span> ${!p.connected ? '<span class="badge ai">离线</span>' : ''}`;
    el.appendChild(div);
  });
  if (msg.spectators > 0) {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `<span class="badge spectator">观战 ×${msg.spectators}</span>`;
    el.appendChild(div);
  }
}

/* ── 游戏 UI 初始化 ──────────────────────────────────────────────────────── */
function initGameUI(gameId) {
  showSection('game-wrap');
  document.getElementById('log-panel').innerHTML = '';
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  if (gameId === 'manila') {
    gameRenderer = new ManilaRenderer(container, myIdx,
      (kind, value) => ws.send(JSON.stringify({type:'response', kind, value})));
  } else {
    container.textContent = `游戏 ${gameId} 的渲染器尚未实现`;
  }
}

/* ── 日志 ───────────────────────────────────────────────────────────────── */
function appendLog(text, style) {
  const panel = document.getElementById('log-panel');
  const div = document.createElement('div');
  div.className = `log-${style||'normal'}`;
  div.textContent = text;
  panel.appendChild(div);
  if (panel.children.length > 300) panel.removeChild(panel.firstChild);
  panel.scrollTop = panel.scrollHeight;
}

/* ── 工具 ───────────────────────────────────────────────────────────────── */
function showSection(id) {
  ['lobby','room-waiting','game-wrap'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s===id ? (id==='game-wrap'?'block':'') : 'none';
    if (el) el.classList.toggle('hidden', s!==id);
  });
}
function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) { el.textContent = msg; setTimeout(()=>el.textContent='', 4000); }
  else alert(msg);
}

connect();

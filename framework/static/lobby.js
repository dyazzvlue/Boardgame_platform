/* lobby.js — 大厅与 WebSocket 核心 */
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let ws = null;
let myIdx = -1;
let selectedGame = null;
let currentRoom = null;
let gameRenderer = null; // 由各 game.js 注册
const _RENDERERS = {};        // gameId → RendererClass，由各 game.js 注册
const _loadedScripts = {};   // gameId → Promise（加载缓存）
let _msgQueue = [];           // 脚本加载期间缓冲的消息
let _gameLoading = false;     // 正在加载游戏脚本中
let _countdownTimer = null;
let _gamesData = []; // 缓存游戏列表
let _wsReady = false;
let _gameListReady = false;

/* ── 连接 ──────────────────────────────────────────────────────────────── */
function connect() {
  _wsReady = false;
  _gameListReady = false;
  selectedGame = null;
  _gamesData = [];
  _updateCreateAvailability();
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    _wsReady = true;
    _gameListReady = false;
    selectedGame = null;
    _gamesData = [];
    _updateCreateAvailability();
    ws.send(JSON.stringify({type: 'list'}));
    startPing();
  };
  ws.onmessage = e => handleMsg(JSON.parse(e.data));
  ws.onerror = () => {};
  ws.onclose = () => {
    _wsReady = false;
    _gameListReady = false;
    selectedGame = null;
    _gamesData = [];
    _updateCreateAvailability('连接已断开，正在重连…');
    setTimeout(connect, 2000);
  };
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
    case 'state':     if (_gameLoading) { _msgQueue.push(msg); break; } gameRenderer && gameRenderer.onState(msg.context); _clearTurnTimer(); break;
    case 'request':   if (_gameLoading) { _msgQueue.push(msg); break; } gameRenderer && gameRenderer.onRequest(msg.player_idx, msg.kind, msg.data); _startTurnTimer(msg.player_idx, msg.turn_timeout); break;
    case 'log':       appendLog(msg.text, msg.style); break;
    case 'game_over': if (_gameLoading) { _msgQueue.push(msg); break; } gameRenderer && gameRenderer.onGameOver(msg.result); _clearTurnTimer(); _showPostGameBtns(); break;
    case 'error':     showError(msg.msg); break;
    case 'pong':      break;
  }
}

/* ── 游戏列表 ───────────────────────────────────────────────────────────── */
function _updateCountSelect(min, max) {
  const sel = document.getElementById('create-count');
  if (!sel) return;
  const cur = parseInt(sel.value) || min;
  sel.innerHTML = '';
  for (let i = min; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    if (i === cur || (cur < min && i === min)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function _setCreateStatus(message, isError = false) {
  const el = document.getElementById('create-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function _updateCreateAvailability(statusText = '') {
  const btn = document.getElementById('btn-create-room');
  const ready = _wsReady && _gameListReady && !!selectedGame;
  if (btn) btn.disabled = !ready;

  if (statusText) {
    _setCreateStatus(statusText, statusText.includes('没有可用游戏'));
    return;
  }
  if (!_wsReady) {
    _setCreateStatus('正在连接服务器…');
    return;
  }
  if (!_gameListReady) {
    _setCreateStatus('正在加载游戏列表…');
    return;
  }
  if (!selectedGame) {
    _setCreateStatus('游戏列表已加载，但当前没有可用游戏。', true);
    return;
  }
  _setCreateStatus(`已加载 ${_gamesData.length} 个游戏，可以创建房间。`);
}

function renderGameList(games) {
  _gamesData = Array.isArray(games) ? games : [];
  _gameListReady = true;
  selectedGame = _gamesData.length ? _gamesData[0].id : null;
  _updateCreateAvailability();
}

/* ── 创建 / 加入 ────────────────────────────────────────────────────────── */
function createRoom() {
  if (!_wsReady) { showError('服务器连接尚未建立，请稍候'); return; }
  if (!_gameListReady) { showError('游戏列表仍在加载，请稍候'); return; }
  if (!selectedGame) { showError('当前没有可用游戏，请稍后重试'); return; }
  const name    = document.getElementById('create-name').value.trim() || '玩家';
  const pwd     = document.getElementById('create-pwd').value;
  const timeout = parseInt(document.getElementById('create-timeout').value);
  // player_count 默认由服务端取游戏 min_players，在等待室可调整
  ws.send(JSON.stringify({type: 'create', game: selectedGame, name, password: pwd, turn_timeout: timeout}));
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
    if (msg.game_id) _loadGameScript(msg.game_id); // 预加载，静默忽略失败
    _resetPostGameBtns();
    gameRenderer = null;
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

  // 所有人都能看到当前游戏名称
  if (_gamesData.length) {
    const gameInfo = _gamesData.find(g => g.id === msg.game_id);
    const gameLabel = document.createElement('span');
    gameLabel.style.cssText = 'color:#aaa;font-size:.9em;align-self:center;';
    gameLabel.textContent = gameInfo ? `当前游戏：${gameInfo.name}` : `游戏：${msg.game_id}`;
    ctrl.appendChild(gameLabel);
  }

  if (!isHost) return;  // 非房主：不显示控制按钮

  // 游戏选择器 + 人数选择器
  if (!msg.started) {
    // 游戏下拉（游戏数 > 1 才显示）
    if (_gamesData.length > 1) {
      const gameSel = document.createElement('select');
      gameSel.id = 'host-game-sel';
      gameSel.style.cssText = 'background:#0f3460;color:#eee;border:1px solid #444;padding:.4rem .6rem;border-radius:6px;';
      _gamesData.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        if (g.id === msg.game_id) opt.selected = true;
        gameSel.appendChild(opt);
      });
      gameSel.onchange = () => _syncGameCount();
      ctrl.appendChild(gameSel);
    }

    // 人数下拉（始终显示）
    const countSel = document.createElement('select');
    countSel.id = 'host-count-sel';
    countSel.style.cssText = 'background:#0f3460;color:#eee;border:1px solid #444;padding:.4rem .6rem;border-radius:6px;width:4.5rem;';
    const curGame = _gamesData.find(g => g.id === msg.game_id) || {};
    const minP = curGame.min_players || 2, maxP = curGame.max_players || 10;
    for (let i = minP; i <= maxP; i++) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i + ' 人';
      if (i === msg.player_count) opt.selected = true;
      countSel.appendChild(opt);
    }
    countSel.onchange = () => _syncGameCount();
    ctrl.appendChild(countSel);
  }

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

function _syncGameCount() {
  const gameSel  = document.getElementById('host-game-sel');
  const countSel = document.getElementById('host-count-sel');
  const gameId = gameSel ? gameSel.value : (currentRoom && currentRoom.game_id);
  const count  = countSel ? parseInt(countSel.value) : undefined;
  if (!gameId) return;
  // rebuild count options if game changed
  if (gameSel && countSel) {
    const g = _gamesData.find(x => x.id === gameId);
    if (g) {
      const cur = parseInt(countSel.value) || g.min_players;
      countSel.innerHTML = '';
      for (let i = g.min_players; i <= g.max_players; i++) {
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = i + ' 人';
        opt.selected = (i === Math.max(g.min_players, Math.min(g.max_players, cur)));
        countSel.appendChild(opt);
      }
      _loadGameScript(gameId); // 预加载
    }
  }
  ws.send(JSON.stringify({type: 'change_game', game_id: gameId, player_count: parseInt(countSel ? countSel.value : count)}));
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

/* ── 懒加载游戏脚本 ─────────────────────────────────────────────────────── */
function _loadGameScript(gameId) {
  if (_loadedScripts[gameId]) return _loadedScripts[gameId];
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `/static/games/${gameId}.js?v=1777360000`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  _loadedScripts[gameId] = p;
  // 失败后清除缓存，下次可重试
  p.catch(() => { delete _loadedScripts[gameId]; });
  return p;
}

/* ── 游戏 UI 初始化 ──────────────────────────────────────────────────────── */
async function initGameUI(gameId) {
  if (_gameLoading) return;          // 防止重入
  _resetPostGameBtns();
  _gameLoading = true;
  _msgQueue = [];
  showSection('game-wrap');
  document.getElementById('log-panel').innerHTML = '';
  const container = document.getElementById('game-container');
  container.innerHTML = '';
  const respond = (kind, value) => ws.send(JSON.stringify({type: 'response', kind, value}));

  try {
    await _loadGameScript(gameId);
  } catch (e) {
    container.textContent = `加载游戏 ${gameId} 失败：${e}`;
    _gameLoading = false;
    return;
  }

  const RendererCls = _RENDERERS[gameId];
  if (RendererCls) {
    try {
      gameRenderer = new RendererCls(container, myIdx, respond);
    } catch (e) {
      console.error('[initGameUI] 渲染器构造失败:', e);
      container.textContent = `游戏 ${gameId} 初始化失败：${e.message || e}`;
    }
  } else {
    container.textContent = `游戏 ${gameId} 的渲染器尚未实现`;
  }
  _gameLoading = false;

  // 回放加载期间缓冲的消息
  const queued = _msgQueue.splice(0);
  for (const m of queued) {
    try { handleMsg(m); } catch (e) { console.error('[replay] 回放消息异常:', m.type, e); }
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

/* ── 离开游戏 ──────────────────────────────────────────────────────────── */
function leaveGame() {
  if (!confirm('确认退出游戏？')) return;
  _resetPostGameBtns();
  _gameLoading = false;
  _msgQueue = [];
  ws.send(JSON.stringify({type: 'leave_game'}));
  _clearTurnTimer();
  gameRenderer = null;
  showSection('lobby');
}

/* ── 回合计时器 ─────────────────────────────────────────────────────────── */
let _turnTimerInterval = null;

function _startTurnTimer(playerIdx, timeoutSecs) {
  _clearTurnTimer();
  const timerEl = document.getElementById('turn-timer');
  if (!timerEl) return;
  if (!timeoutSecs || timeoutSecs <= 0) {
    const playerName = _getPlayerName(playerIdx);
    timerEl.textContent = playerName ? '⏳ ' + playerName + ' 的回合' : '';
    timerEl.style.color = '#f39c12';
    return;
  }
  const playerName = _getPlayerName(playerIdx);
  let remaining = timeoutSecs;
  const update = () => {
    const name = playerName || ('玩家' + (playerIdx + 1));
    timerEl.textContent = '⏳ ' + name + ' 的回合 — 剩余 ' + remaining + 's';
    timerEl.style.color = remaining <= 5 ? '#e74c3c' : '#f39c12';
  };
  update();
  _turnTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      _clearTurnTimer();
      if (timerEl) { timerEl.textContent = '⏱ 超时'; timerEl.style.color = '#e74c3c'; }
    } else {
      update();
    }
  }, 1000);
}

function _clearTurnTimer() {
  if (_turnTimerInterval) { clearInterval(_turnTimerInterval); _turnTimerInterval = null; }
  const timerEl = document.getElementById('turn-timer');
  if (timerEl) timerEl.textContent = '';
}

function _getPlayerName(playerIdx) {
  if (!currentRoom || !currentRoom.players) return null;
  const p = currentRoom.players.find(p => p.idx === playerIdx);
  return p ? p.name : null;
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

/* ── 游戏结束后操作 ──────────────────────────────────────────────────────── */
function _showPostGameBtns() {
  const btn = document.getElementById('btn-return-room');
  if (btn) btn.style.display = '';
}

function _resetPostGameBtns() {
  const btn = document.getElementById('btn-return-room');
  if (btn) btn.style.display = 'none';
}

function returnToRoom() {
  ws.send(JSON.stringify({type: 'return_room'}));
  // 服务端会广播 room(started=false)，handleRoom 会切换到等待室
}

connect();

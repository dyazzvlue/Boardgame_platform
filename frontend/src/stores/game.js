/**
 * Pinia store: WebSocket 游戏状态管理
 * 管理与服务器的 WebSocket 连接、房间状态、游戏状态
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useGameStore = defineStore('game', () => {
  // ── State ──
  const ws = ref(null)
  const connected = ref(false)
  const games = ref([])         // 可选游戏列表
  const room = ref(null)        // 当前房间信息
  const myIdx = ref(-1)         // 我的玩家索引
  const gameState = ref(null)   // 游戏状态对象
  const request = ref(null)     // 当前等待我操作的请求
  const logs = ref([])          // 游戏日志
  const gameOver = ref(null)    // 游戏结束结果
  const countdown = ref(0)      // 倒计时秒数
  const error = ref('')         // 错误信息

  // ── Computed ──
  const isHost = computed(() => myIdx.value === 0)
  const isMyTurn = computed(() => request.value && request.value.player_idx === myIdx.value)
  const started = computed(() => room.value?.started ?? false)
  const gameId = computed(() => room.value?.game_id ?? '')

  // ── Actions ──
  function connect() {
    if (ws.value && ws.value.readyState <= 1) return
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/ws`)

    socket.onopen = () => {
      connected.value = true
      error.value = ''
      socket.send(JSON.stringify({ type: 'list' }))
    }

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      _handleMessage(msg)
    }

    socket.onclose = () => {
      connected.value = false
      ws.value = null
    }

    socket.onerror = () => {
      error.value = '连接失败'
      connected.value = false
    }

    ws.value = socket
  }

  function disconnect() {
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    _reset()
  }

  function send(msg) {
    if (ws.value && ws.value.readyState === 1) {
      ws.value.send(JSON.stringify(msg))
    }
  }

  function createRoom(gameId, name, password, playerCount, turnTimeout = 30) {
    send({ type: 'create', game: gameId, name, password, player_count: playerCount, turn_timeout: turnTimeout })
  }

  function joinRoom(code, name, password, spectate = false) {
    send({ type: 'join', room: code, name, password, spectate })
  }

  function startGame() {
    send({ type: 'start_game' })
  }

  function addAI() {
    send({ type: 'add_ai' })
  }

  function respond(kind, value) {
    send({ type: 'response', kind, value })
    request.value = null
  }

  function leaveGame() {
    send({ type: 'leave_game' })
  }

  function returnRoom() {
    send({ type: 'return_room' })
    gameState.value = null
    gameOver.value = null
    request.value = null
    logs.value = []
  }

  function switchGame(newGameId, newPlayerCount) {
    send({ type: 'switch_game', game: newGameId, player_count: newPlayerCount })
  }

  // ── Internal ──
  function _handleMessage(msg) {
    switch (msg.type) {
      case 'game_list':
        games.value = msg.games
        break
      case 'room':
        room.value = msg
        if (msg.your_idx !== undefined) myIdx.value = msg.your_idx
        break
      case 'state':
        gameState.value = msg.context
        break
      case 'request':
        request.value = msg
        break
      case 'log':
        logs.value.push(msg)
        if (logs.value.length > 200) logs.value.shift()
        break
      case 'game_over':
        gameOver.value = msg.result
        break
      case 'countdown':
        countdown.value = msg.seconds
        break
      case 'error':
        error.value = msg.msg
        setTimeout(() => { if (error.value === msg.msg) error.value = '' }, 5000)
        break
      case 'pong':
        break
    }
  }

  function _reset() {
    room.value = null
    myIdx.value = -1
    gameState.value = null
    request.value = null
    logs.value = []
    gameOver.value = null
    countdown.value = 0
    error.value = ''
  }

  // ── Keep-alive ──
  let pingInterval = null
  function startPing() {
    pingInterval = setInterval(() => send({ type: 'ping' }), 30000)
  }
  function stopPing() {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
  }

  return {
    // state
    ws, connected, games, room, myIdx, gameState, request, logs, gameOver, countdown, error,
    // computed
    isHost, isMyTurn, started, gameId,
    // actions
    connect, disconnect, send, createRoom, joinRoom, startGame, addAI,
    respond, leaveGame, returnRoom, switchGame, startPing, stopPing,
  }
})

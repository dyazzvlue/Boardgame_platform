import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const SESSION_KEY = 'boardgame.resume'
const CONNECT_TIMEOUT = 10000
const PING_INTERVAL = 15000
const PONG_TIMEOUT = 10000
const ACK_TIMEOUT = 10000

export const useGameStore = defineStore('game', () => {
  const ws = ref(null)
  const connected = ref(false)
  const connectionStatus = ref('idle')
  const recoveryError = ref('')
  const resumeRoomCode = ref('')
  const retryCount = ref(0)
  const pendingResponse = ref(null)
  const requestExpired = ref(false)
  const games = ref([])
  const room = ref(null)
  const myIdx = ref(-1)
  const gameState = ref(null)
  const request = ref(null)
  const logs = ref([])
  const gameOver = ref(null)
  const countdown = ref(0)
  const error = ref('')

  let savedSession = readSession()
  resumeRoomCode.value = savedSession?.room || ''
  let shouldReconnect = false
  let awaitingResume = false
  let failedRoomCode = ''
  let reconnectTimer = null
  let connectTimer = null
  let pingInterval = null
  let pongTimer = null
  let ackTimer = null
  let expiryTimer = null

  const isHost = computed(() => myIdx.value >= 0 && myIdx.value === room.value?.host_idx)
  const isMyTurn = computed(() => !!request.value && request.value.player_idx === myIdx.value)
  const started = computed(() => room.value?.started ?? false)
  const gameId = computed(() => room.value?.game_id ?? '')
  const actionsEnabled = computed(() =>
    connected.value && connectionStatus.value === 'connected' && !recoveryError.value && pendingResponse.value === null,
  )
  const canRespond = computed(() =>
    actionsEnabled.value && isMyTurn.value && !requestExpired.value && request.value?.request_id != null,
  )
  const connectionLabel = computed(() => ({
    idle: '未连接',
    connecting: '正在连接…',
    connected: '已连接',
    reconnecting: `连接中断，正在重连（${retryCount.value}）…`,
    resuming: '正在恢复房间，请稍候…',
    recovery_failed: '房间恢复失败',
  })[connectionStatus.value])

  function readSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY))
      if (typeof session?.room === 'string' && typeof session?.token === 'string' && session.room && session.token) {
        return { room: session.room.toUpperCase(), token: session.token }
      }
    } catch {
      // Storage may be unavailable in private browsing; normal joining still works.
    }
    return null
  }

  function saveSession(code, token) {
    savedSession = { room: code, token }
    resumeRoomCode.value = code
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(savedSession))
    } catch {
      error.value = '浏览器无法保存恢复凭证，刷新后需重新加入房间'
    }
  }

  function clearSession() {
    savedSession = null
    resumeRoomCode.value = ''
    try { sessionStorage.removeItem(SESSION_KEY) } catch { /* Storage is optional. */ }
  }

  function connect() {
    if (recoveryError.value || (ws.value && ws.value.readyState <= 1)) return
    shouldReconnect = true
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    connectionStatus.value = retryCount.value ? 'reconnecting' : 'connecting'
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    let socket
    try {
      socket = new WebSocket(`${protocol}://${location.host}/ws`)
    } catch {
      scheduleReconnect()
      return
    }
    ws.value = socket
    connectTimer = setTimeout(() => loseConnection(socket), CONNECT_TIMEOUT)

    socket.onopen = () => {
      if (ws.value !== socket) return
      clearTimeout(connectTimer)
      connectTimer = null
      connected.value = true
      error.value = ''
      awaitingResume = !!savedSession
      connectionStatus.value = awaitingResume ? 'resuming' : 'connected'
      if (!awaitingResume) retryCount.value = 0
      if (!send({ type: 'list' })) return
      if (awaitingResume) {
        if (!send({ type: 'resume', room: savedSession.room, token: savedSession.token })) return
        connectTimer = setTimeout(() => loseConnection(socket), CONNECT_TIMEOUT)
      }
      startPing()
    }

    socket.onmessage = (event) => {
      if (ws.value !== socket) return
      try {
        const message = JSON.parse(event.data)
        if (!message || typeof message.type !== 'string') throw new Error('Invalid message')
        handleMessage(message)
      } catch {
        error.value = '收到无效的服务器消息，请重新连接'
      }
    }
    socket.onclose = (event) => {
      if (ws.value !== socket) return
      if (event?.code === 4001) {
        failRecovery('连接已在另一页面恢复，请在该页面继续游戏')
      } else {
        loseConnection(socket)
      }
    }
    socket.onerror = () => loseConnection(socket)
  }

  function closeSocket() {
    const socket = ws.value
    ws.value = null
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    if (socket.readyState <= 1) socket.close()
  }

  function clearPending() {
    clearTimeout(ackTimer)
    ackTimer = null
    pendingResponse.value = null
  }

  function clearRequest() {
    clearTimeout(expiryTimer)
    expiryTimer = null
    request.value = null
    requestExpired.value = false
    clearPending()
  }

  function disconnect() {
    shouldReconnect = false
    clearTimeout(reconnectTimer)
    clearTimeout(connectTimer)
    clearTimeout(expiryTimer)
    reconnectTimer = connectTimer = null
    expiryTimer = null
    stopPing()
    clearPending()
    awaitingResume = false
    connected.value = false
    connectionStatus.value = 'idle'
    closeSocket()
  }

  function loseConnection(socket) {
    if (ws.value !== socket) return
    clearTimeout(connectTimer)
    connectTimer = null
    stopPing()
    clearPending()
    connected.value = false
    awaitingResume = false
    closeSocket()
    if (room.value && !savedSession) {
      failRecovery('连接中断，当前身份无法自动恢复，请返回大厅重新加入')
      return
    }
    scheduleReconnect()
  }

  function scheduleReconnect() {
    if (!shouldReconnect || recoveryError.value || reconnectTimer !== null) return
    connectionStatus.value = 'reconnecting'
    const delay = Math.min(500 * 2 ** Math.min(retryCount.value, 4), 5000)
    retryCount.value += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function send(message) {
    if (!connected.value || ws.value?.readyState !== 1) return false
    try {
      ws.value.send(JSON.stringify(message))
      return true
    } catch {
      loseConnection(ws.value)
      return false
    }
  }

  function command(message) {
    if (!actionsEnabled.value || !send(message)) {
      error.value = '连接尚未就绪，请等待恢复后再操作'
      return false
    }
    return true
  }

  function createRoom(gameId, name, password, playerCount, turnTimeout = 30) {
    return command({ type: 'create', game: gameId, name, password, player_count: playerCount, turn_timeout: turnTimeout })
  }

  function joinRoom(code, name, password, spectate = false) {
    return command({ type: 'join', room: code, name, password, spectate })
  }

  function startGame() { return command({ type: 'start_game' }) }
  function addAI() { return command({ type: 'add_ai' }) }

  function respond(kind, value) {
    const current = request.value
    if (!canRespond.value || kind !== current.kind) return false
    if (current.expires_at != null && Date.now() >= current.expires_at * 1000) {
      requestExpired.value = true
      error.value = '本次操作已超时，正在等待服务器更新'
      return false
    }
    pendingResponse.value = current.request_id
    if (!send({ type: 'response', kind, value, request_id: current.request_id })) {
      clearPending()
      error.value = '发送失败，请等待连接恢复；不会自动重复提交'
      return false
    }
    error.value = ''
    ackTimer = setTimeout(() => {
      error.value = '操作确认超时，正在重新同步；不会自动重复提交'
      if (ws.value) loseConnection(ws.value)
    }, ACK_TIMEOUT)
    return true
  }

  function leave(type) {
    send({ type })
    clearSession()
    disconnect()
    resetRoom()
    recoveryError.value = ''
    failedRoomCode = ''
    retryCount.value = 0
    error.value = ''
  }

  function leaveRoom() { leave('leave_room') }
  function leaveGame() { leave('leave_game') }
  function returnRoom() { return command({ type: 'return_room' }) }
  function switchGame(game, playerCount) {
    return command({ type: 'switch_game', game_id: game, player_count: playerCount })
  }

  function enterRoom(code) {
    code = String(code || '').toUpperCase()
    if (recoveryError.value) {
      if (failedRoomCode === code) return true
      leaveRoom()
      return false
    }
    if (room.value?.code !== code && savedSession?.room !== code) {
      leaveRoom()
      return false
    }
    connect()
    return true
  }

  function enterLobby(targetCode = '') {
    if (targetCode && resumeRoomCode.value && resumeRoomCode.value !== targetCode.toUpperCase()) leaveRoom()
    connect()
    if (connectionStatus.value === 'connected') send({ type: 'list' })
  }

  function failRecovery(message) {
    failedRoomCode = room.value?.code || savedSession?.room || ''
    disconnect()
    clearSession()
    resetRoom()
    recoveryError.value = message
    error.value = message
    connectionStatus.value = 'recovery_failed'
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'game_list':
        games.value = message.games
        break
      case 'room': {
        const { resume_token: token, ...roomInfo } = message
        if (awaitingResume) {
          if (message.code !== savedSession?.room) {
            failRecovery('恢复的房间与凭证不匹配，请返回大厅重新加入')
            break
          }
          clearTimeout(connectTimer)
          connectTimer = null
          resetRoom()
        }
        if (token) saveSession(message.code, token)
        else if (savedSession?.room !== message.code || message.your_idx < 0) clearSession()
        if (!message.started && (room.value?.started || gameOver.value)) {
          clearRequest()
          gameState.value = gameOver.value = null
          logs.value = []
          countdown.value = 0
        }
        room.value = roomInfo
        if (message.your_idx !== undefined) myIdx.value = message.your_idx
        awaitingResume = false
        retryCount.value = 0
        connectionStatus.value = 'connected'
        break
      }
      case 'state':
        gameState.value = message.context
        break
      case 'request':
        if (pendingResponse.value !== null && message.request_id === pendingResponse.value) break
        clearRequest()
        request.value = message
        if (message.expires_at != null) {
          const remaining = message.expires_at * 1000 - Date.now()
          requestExpired.value = remaining <= 0
          if (remaining > 0) {
            expiryTimer = setTimeout(() => { requestExpired.value = true }, Math.min(remaining, 2147483647))
          }
        }
        break
      case 'response_ack':
        if (pendingResponse.value !== message.request_id) break
        clearPending()
        if (message.accepted === true) {
          if (request.value?.request_id === message.request_id) clearRequest()
        } else {
          error.value = message.msg || '操作未被接受，请检查后重新选择'
        }
        break
      case 'log':
        logs.value.push(message)
        if (logs.value.length > 200) logs.value.shift()
        break
      case 'game_over':
        clearRequest()
        gameOver.value = message.result
        break
      case 'countdown':
        countdown.value = message.seconds
        break
      case 'error':
        if (awaitingResume || message.code === 'resume_expired') {
          failRecovery(message.msg || '恢复凭证已失效，请返回大厅重新加入')
        } else {
          error.value = message.msg || '操作失败'
        }
        break
      case 'pong':
        clearTimeout(pongTimer)
        pongTimer = null
        break
    }
  }

  function resetRoom() {
    room.value = null
    myIdx.value = -1
    gameState.value = null
    clearRequest()
    logs.value = []
    gameOver.value = null
    countdown.value = 0
  }

  function ping() {
    if (pongTimer !== null || !send({ type: 'ping' })) return
    pongTimer = setTimeout(() => {
      pongTimer = null
      if (ws.value) loseConnection(ws.value)
    }, PONG_TIMEOUT)
  }

  function startPing() {
    if (pingInterval !== null || !connected.value) return
    pingInterval = setInterval(ping, PING_INTERVAL)
    ping()
  }

  function stopPing() {
    clearInterval(pingInterval)
    clearTimeout(pongTimer)
    pingInterval = pongTimer = null
  }

  return {
    ws, connected, connectionStatus, connectionLabel, recoveryError, resumeRoomCode, retryCount,
    pendingResponse, requestExpired, actionsEnabled, canRespond,
    games, room, myIdx, gameState, request, logs, gameOver, countdown, error,
    isHost, isMyTurn, started, gameId,
    connect, disconnect, send, createRoom, joinRoom, startGame, addAI,
    respond, leaveRoom, leaveGame, returnRoom, switchGame, enterRoom, enterLobby, startPing, stopPing,
  }
})

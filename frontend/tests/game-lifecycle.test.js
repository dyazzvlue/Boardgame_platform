import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const SESSION_KEY = 'boardgame.resume'
const SESSION = { room: 'ABCDEF', token: 'test-only-resume-token' }
const stripImports = source => source.replace(/^import .+ from ['"].+['"]\r?\n/gm, '')
const storeSource = stripImports(readFileSync(new URL('../src/stores/game.js', import.meta.url), 'utf8'))
  .replace('export const useGameStore', 'const useGameStore')
const ref = value => ({ value })
const computed = getter => ({ get value() { return getter() } })

function harness({ session = null, autoPong = true, storageBlocked = false } = {}) {
  let now = 1000000
  let nextTimer = 1
  const timers = new Map()
  const sockets = []
  const storage = new Map(session ? [[SESSION_KEY, JSON.stringify(session)]] : [])
  const schedule = (callback, delay = 0, interval = 0) => {
    const id = nextTimer++
    timers.set(id, { callback, at: now + delay, interval })
    return id
  }
  const cancel = id => timers.delete(id)
  const tick = duration => {
    const end = now + duration
    for (let count = 0; count < 1000; count++) {
      const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry || entry[1].at > end) {
        now = end
        return
      }
      const [id, timer] = entry
      now = timer.at
      if (timer.interval) timer.at += timer.interval
      else timers.delete(id)
      timer.callback()
    }
    throw new Error('Timer loop did not settle')
  }
  class Socket {
    readyState = 0
    sent = []
    constructor(url) {
      this.url = url
      sockets.push(this)
    }
    open() {
      this.readyState = 1
      this.onopen?.()
      tick(0)
    }
    send(data) {
      assert.equal(this.readyState, 1)
      const message = JSON.parse(data)
      this.sent.push(message)
      if (autoPong && message.type === 'ping') schedule(() => this.message({ type: 'pong' }))
    }
    message(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
    drop(code) {
      this.readyState = 3
      this.onclose?.({ code })
    }
    close() { this.drop() }
  }
  const store = vm.runInNewContext(`${storeSource}\n;useGameStore()`, {
    ref, computed, defineStore: (_, setup) => setup, WebSocket: Socket,
    location: { protocol: 'https:', host: 'game.example' },
    sessionStorage: {
      getItem(key) {
        if (storageBlocked) throw new Error('Storage unavailable')
        return storage.get(key) ?? null
      },
      setItem(key, value) {
        if (storageBlocked) throw new Error('Storage unavailable')
        storage.set(key, value)
      },
      removeItem(key) {
        if (storageBlocked) throw new Error('Storage unavailable')
        storage.delete(key)
      },
    },
    Date: class extends Date { static now() { return now } },
    setTimeout: schedule, clearTimeout: cancel,
    setInterval: (callback, delay) => schedule(callback, delay, delay), clearInterval: cancel,
  })
  const viewStore = new Proxy(store, {
    get(target, key) {
      const value = target[key]
      return value && typeof value === 'object' && 'value' in value ? value.value : value
    },
    set(target, key, value) {
      target[key].value = value
      return true
    },
  })
  return {
    store, viewStore, sockets, storage, timers, tick,
    get now() { return now },
    open() { store.connect(); sockets.at(-1).open(); return sockets.at(-1) },
    room(socket, extra = {}) {
      socket.message({
        type: 'room', code: SESSION.room, resume_token: SESSION.token,
        your_idx: 0, host_idx: 0, started: true, game_id: 'avalon', players: [], ...extra,
      })
    },
    request(socket, extra = {}) {
      socket.message({ type: 'request', kind: 'vote', player_idx: 0, request_id: 'request-1', expires_at: null, ...extra })
    },
  }
}

function page(name, h, route) {
  const source = readFileSync(new URL(`../src/views/game/${name}.vue`, import.meta.url), 'utf8')
  const script = stripImports(source.match(/<script setup>([\s\S]*?)<\/script>/)[1])
  const watchers = []
  const mounts = []
  const guards = []
  const navigations = []
  const capture = method => target => navigations.push(JSON.parse(JSON.stringify({ method, target })))
  const bindings = name === 'GameRoom' ? 'roomCode, backToLobby' : 'joinCode, selectedGame, createRoom, joinRoom, resetRecovery'
  const result = vm.runInNewContext(`${script}\n;({${bindings}})`, {
    ref, computed, useRoute: () => route, useGameStore: () => h.viewStore,
    useRouter: () => ({ replace: capture('replace'), push: capture('push') }),
    defineAsyncComponent: loader => ({ loader }),
    localStorage: { getItem: () => 'Alice', setItem() {} },
    onMounted: callback => mounts.push(callback),
    onBeforeRouteLeave: callback => guards.push(callback),
    watch(source, callback, options) {
      const read = value => typeof value === 'function' ? value() : value.value
      const getter = Array.isArray(source) ? () => source.map(read) : () => read(source)
      const watcher = { getter, callback, previous: JSON.stringify(getter()) }
      watchers.push(watcher)
      if (options?.immediate) callback(getter())
    },
  })
  return {
    ...result, navigations,
    mount() { mounts.forEach(callback => callback()) },
    leave(to) { guards.forEach(callback => callback(to)) },
    flush() {
      watchers.forEach(watcher => {
        const value = watcher.getter()
        const snapshot = JSON.stringify(value)
        if (watcher.previous !== snapshot) {
          watcher.previous = snapshot
          watcher.callback(value)
        }
      })
    },
  }
}

test('a replaced connection stops recovery instead of competing with the new page', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  socket.drop(4001)
  assert.equal(h.store.connectionStatus.value, 'recovery_failed')
  assert.match(h.store.recoveryError.value, /另一页面/)
  h.tick(30000)
  assert.equal(h.sockets.length, 1)
  assert.equal(h.storage.has(SESSION_KEY), false)
})

test('host controls follow server host_idx rather than always selecting player zero', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket, { your_idx: 1, host_idx: 1 })
  assert.equal(h.store.isHost.value, true)
  h.room(socket, { your_idx: 0, host_idx: 1 })
  assert.equal(h.store.isHost.value, false)
  h.room(socket, { your_idx: -1, host_idx: -1 })
  assert.equal(h.store.isHost.value, false)
})

test('switching games uses the server game_id field', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  assert.equal(h.store.switchGame('manila', 3), true)
  assert.equal(socket.sent.at(-1).game_id, 'manila')
  assert.equal(socket.sent.at(-1).type, 'switch_game')
})

test('one connection owns one heartbeat, with HTTPS and bounded exponential backoff', () => {
  const h = harness()
  h.store.connect()
  h.store.connect()
  assert.equal(h.sockets.length, 1)
  assert.equal(h.sockets[0].url, 'wss://game.example/ws')
  for (const delay of [500, 1000, 2000, 4000, 5000, 5000]) {
    h.sockets.at(-1).drop()
    const count = h.sockets.length
    h.tick(delay - 1)
    assert.equal(h.sockets.length, count)
    h.tick(1)
    assert.equal(h.sockets.length, count + 1)
  }
  const socket = h.sockets.at(-1)
  socket.open()
  h.store.startPing()
  h.store.startPing()
  assert.equal([...h.timers.values()].filter(timer => timer.interval).length, 1)
  h.tick(45000)
  assert.equal(socket.sent.filter(message => message.type === 'ping').length, 4)
  assert.equal(h.store.connected.value, true)
})

test('personalized ROOM persists credentials privately and room updates retain them', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  assert.deepEqual(JSON.parse(h.storage.get(SESSION_KEY)), SESSION)
  assert.equal(h.store.resumeRoomCode.value, SESSION.room)
  assert.equal('resume_token' in h.store.room.value, false)
  h.room(socket, { resume_token: undefined, your_idx: undefined })
  assert.deepEqual(JSON.parse(h.storage.get(SESSION_KEY)), SESSION)
})

test('refresh resumes only the matching room, then consumes authoritative snapshot and request', () => {
  const h = harness({ session: SESSION })
  assert.equal(h.store.enterRoom('abcdef'), true)
  const socket = h.sockets[0]
  socket.open()
  assert.deepEqual(socket.sent.find(message => message.type === 'resume'), { type: 'resume', ...SESSION })
  assert.equal(h.store.connectionStatus.value, 'resuming')
  assert.equal(h.store.actionsEnabled.value, false)
  h.room(socket)
  socket.message({ type: 'state', context: { phase: 'vote' } })
  h.request(socket)
  assert.equal(h.store.connectionStatus.value, 'connected')
  assert.equal(h.store.gameState.value.phase, 'vote')
  assert.equal(h.store.canRespond.value, true)
})

test('resume may restore GAME_OVER instead of a current request', () => {
  const h = harness({ session: SESSION })
  const socket = h.open()
  h.room(socket)
  socket.message({ type: 'state', context: { phase: 'finished' } })
  socket.message({ type: 'game_over', result: { winner: 'good' } })
  assert.equal(h.store.gameOver.value.winner, 'good')
  assert.equal(h.store.request.value, null)
})

test('direct links without matching credentials cannot claim a seat', () => {
  for (const session of [null, SESSION]) {
    const h = harness({ session })
    assert.equal(h.store.enterRoom('UVWXYZ'), false)
    assert.equal(h.sockets.length, 0)
    assert.equal(h.storage.has(SESSION_KEY), false)
  }
})

test('expired or rejected resume becomes terminal, clears old state, and requires explicit rejoin', () => {
  for (const code of ['resume_expired', 'invalid_token']) {
    const h = harness({ session: SESSION })
    const socket = h.open()
    h.store.gameState.value = { old: true }
    socket.message({ type: 'error', code, msg: '恢复凭证已失效' })
    assert.equal(h.store.connectionStatus.value, 'recovery_failed')
    assert.match(h.store.recoveryError.value, /失效/)
    assert.equal(h.store.room.value, null)
    assert.equal(h.store.gameState.value, null)
    assert.equal(h.storage.has(SESSION_KEY), false)
    h.tick(60000)
    h.store.connect()
    assert.equal(h.sockets.length, 1)
    assert.equal(h.timers.size, 0)
    h.store.leaveRoom()
    h.store.enterLobby()
    assert.equal(h.sockets.length, 2)
  }
})

test('pending response survives until matching accepted ACK and cannot be submitted twice', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  h.request(socket)
  assert.equal(h.store.respond('vote', true), true)
  assert.equal(h.store.request.value.request_id, 'request-1')
  assert.equal(h.store.pendingResponse.value, 'request-1')
  assert.equal(h.store.actionsEnabled.value, false)
  assert.equal(h.store.respond('vote', false), false)
  socket.message({ type: 'response_ack', request_id: 'other', accepted: true })
  assert.equal(h.store.request.value.request_id, 'request-1')
  assert.deepEqual(socket.sent.find(message => message.type === 'response'), {
    type: 'response', kind: 'vote', value: true, request_id: 'request-1',
  })
  socket.message({ type: 'response_ack', request_id: 'request-1', accepted: true })
  assert.equal(h.store.request.value, null)
  assert.equal(h.store.pendingResponse.value, null)
})

test('rejected ACK retains request, reports reason, and permits explicit corrected submission', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  h.request(socket)
  h.store.respond('vote', true)
  socket.message({ type: 'response_ack', request_id: 'request-1', accepted: false, msg: '请重新选择' })
  assert.equal(h.store.request.value.request_id, 'request-1')
  assert.equal(h.store.pendingResponse.value, null)
  assert.equal(h.store.error.value, '请重新选择')
  assert.equal(h.store.respond('vote', false), true)
})

test('duplicate REQUEST cannot unlock an in-flight response before its acknowledgement', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  h.request(socket)
  h.store.respond('vote', true)
  h.request(socket)
  assert.equal(h.store.pendingResponse.value, 'request-1')
  assert.equal(h.store.respond('vote', false), false)
  assert.equal(socket.sent.filter(message => message.type === 'response').length, 1)
  socket.message({ type: 'response_ack', request_id: 'request-1', accepted: true })
  assert.equal(h.store.request.value, null)
})

test('new request and GAME_OVER invalidate old acknowledgements and request timers', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  h.request(socket, { expires_at: (h.now + 1000) / 1000 })
  h.store.respond('vote', true)
  h.request(socket, { request_id: 'request-2' })
  socket.message({ type: 'response_ack', request_id: 'request-1', accepted: true })
  h.tick(1000)
  assert.equal(h.store.request.value.request_id, 'request-2')
  assert.equal(h.store.requestExpired.value, false)
  socket.message({ type: 'game_over', result: { winner: 'good' } })
  assert.equal(h.store.request.value, null)
  assert.equal(h.store.pendingResponse.value, null)
})

test('request identity, turn ownership and Unix-second expiry are enforced before sending', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  for (const extra of [{ player_idx: 1 }, { request_id: undefined }, { expires_at: h.now / 1000 }]) {
    h.request(socket, extra)
    assert.equal(h.store.respond('vote', true), false)
  }
  h.request(socket, { expires_at: (h.now + 1000) / 1000 })
  assert.equal(h.store.canRespond.value, true)
  h.tick(1000)
  assert.equal(h.store.requestExpired.value, true)
  assert.equal(h.store.respond('vote', true), false)
  assert.equal(socket.sent.some(message => message.type === 'response'), false)
})

test('disconnect disables responses; recovered requests are never automatically replayed', () => {
  const h = harness()
  const first = h.open()
  h.room(first)
  h.request(first)
  h.store.respond('vote', true)
  const staleHandler = first.onmessage
  first.drop()
  assert.equal(h.store.connected.value, false)
  assert.equal(h.store.respond('vote', false), false)
  assert.equal(h.store.request.value.request_id, 'request-1')
  h.tick(500)
  const second = h.sockets.at(-1)
  second.open()
  staleHandler({ data: JSON.stringify({ type: 'error', code: 'resume_expired', msg: 'stale' }) })
  assert.equal(h.store.recoveryError.value, '')
  h.room(second)
  assert.equal(h.store.request.value, null)
  h.request(second, { request_id: 'request-2' })
  assert.equal(second.sent.some(message => message.type === 'response'), false)
  assert.equal(h.store.request.value.request_id, 'request-2')
})

test('ACK timeout resynchronizes rather than blindly resending', () => {
  const h = harness()
  const first = h.open()
  h.room(first)
  h.request(first)
  h.store.respond('vote', true)
  h.tick(10000)
  assert.equal(h.store.connectionStatus.value, 'reconnecting')
  assert.match(h.store.error.value, /不会自动重复提交/)
  h.tick(500)
  const second = h.sockets.at(-1)
  second.open()
  assert.equal(second.sent.some(message => message.type === 'resume'), true)
  assert.equal(second.sent.some(message => message.type === 'response'), false)
})

test('missing PONG and stalled connection/resume trigger a fresh connection', () => {
  const silent = harness({ autoPong: false })
  silent.open()
  silent.tick(10000)
  assert.equal(silent.store.connected.value, false)
  silent.tick(500)
  assert.equal(silent.sockets.length, 2)

  const stalled = harness()
  stalled.store.connect()
  stalled.tick(10000)
  assert.equal(stalled.store.connectionStatus.value, 'reconnecting')
  stalled.tick(500)
  assert.equal(stalled.sockets.length, 2)

  const resume = harness({ session: SESSION })
  resume.open()
  resume.tick(10500)
  assert.equal(resume.sockets.length, 2)
})

test('explicit leave_room and legacy leave_game release credentials and stop all background work', () => {
  for (const [action, type] of [['leaveRoom', 'leave_room'], ['leaveGame', 'leave_game']]) {
    const h = harness()
    const socket = h.open()
    h.room(socket)
    h.request(socket, { expires_at: (h.now + 30000) / 1000 })
    h.store.respond('vote', true)
    h.store[action]()
    assert.equal(socket.sent.at(-1).type, type)
    assert.equal(h.store.room.value, null)
    assert.equal(h.store.request.value, null)
    assert.equal(h.storage.has(SESSION_KEY), false)
    assert.equal(h.timers.size, 0)
    h.tick(60000)
    assert.equal(h.sockets.length, 1)
  }
})

test('disconnect cancels every timer without discarding refresh credentials', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  h.request(socket, { expires_at: (h.now + 30000) / 1000 })
  h.store.disconnect()
  assert.equal(h.timers.size, 0)
  assert.equal(h.storage.has(SESSION_KEY), true)
  h.tick(60000)
  assert.equal(h.sockets.length, 1)
  assert.equal(h.store.respond('vote', true), false)
})

test('send failure cannot leave a heartbeat or stale connection timeout after explicit leave', () => {
  const h = harness({ session: SESSION })
  h.store.connect()
  const socket = h.sockets[0]
  socket.send = () => { throw new Error('Socket closed during send') }
  socket.open()
  assert.equal(h.store.connectionStatus.value, 'reconnecting')
  h.store.leaveRoom()
  assert.equal(h.timers.size, 0)
  h.tick(60000)
  assert.equal(h.sockets.length, 1)
})

test('return_room stays in its room and waits for authoritative waiting-room state', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  socket.message({ type: 'game_over', result: { winner: 'good' } })
  assert.equal(h.store.returnRoom(), true)
  assert.equal(h.store.gameOver.value.winner, 'good')
  h.room(socket, { started: false })
  assert.equal(h.store.room.value.code, SESSION.room)
  assert.equal(h.store.gameOver.value, null)
  assert.equal(h.storage.has(SESSION_KEY), true)
})

test('malformed messages and unavailable storage do not crash joining', () => {
  const h = harness({ storageBlocked: true })
  const socket = h.open()
  socket.onmessage({ data: 'not-json' })
  assert.match(h.store.error.value, /无效/)
  assert.equal(h.store.joinRoom(SESSION.room, 'Alice', ''), true)
  h.room(socket)
  assert.match(h.store.error.value, /保存恢复凭证/)
})

test('spectator without credentials receives an explicit rejoin message after disconnection', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket, { resume_token: undefined, your_idx: -1 })
  socket.drop()
  assert.equal(h.store.connectionStatus.value, 'recovery_failed')
  assert.match(h.store.recoveryError.value, /重新加入/)
  assert.equal(h.timers.size, 0)
})

test('room page redirects credential-free deep link to the prefilled join form', () => {
  const h = harness()
  const view = page('GameRoom', h, { params: { roomCode: 'uvwxyz' }, query: {} })
  assert.deepEqual(view.navigations, [{
    method: 'replace', target: { name: 'GameLobby', query: { room: 'UVWXYZ' } },
  }])
  assert.equal(h.sockets.length, 0)
})

test('room route reuse reacts to its room code and never resumes another seat', () => {
  const h = harness({ session: SESSION })
  const route = { params: { roomCode: SESSION.room }, query: {} }
  const view = page('GameRoom', h, route)
  const socket = h.sockets[0]
  socket.open()
  h.room(socket)
  view.leave({ name: 'GameRoom', params: { roomCode: 'UVWXYZ' } })
  route.params.roomCode = 'UVWXYZ'
  view.flush()
  assert.equal(view.roomCode.value, 'UVWXYZ')
  assert.equal(socket.sent.some(message => message.type === 'leave_room'), true)
  assert.equal(h.storage.has(SESSION_KEY), false)
  assert.equal(view.navigations.at(-1).target.query.room, 'UVWXYZ')
})

test('returning to lobby leaves rather than bouncing on subsequent unrelated store mutations', () => {
  const h = harness({ session: SESSION })
  const roomView = page('GameRoom', h, { params: { roomCode: SESSION.room }, query: {} })
  h.sockets[0].open()
  h.room(h.sockets[0])
  roomView.backToLobby()
  roomView.leave({ name: 'GameLobby', params: {} })
  const lobby = page('GameLobby', h, { params: {}, query: {} })
  lobby.mount()
  const socket = h.sockets.at(-1)
  socket.open()
  socket.message({ type: 'log', text: 'unrelated' })
  lobby.flush()
  assert.equal(lobby.navigations.length, 0)
  assert.equal(h.store.room.value, null)
})

test('lobby preserves target room, selects cached games and navigates only on room/connection changes', () => {
  const h = harness()
  const socket = h.open()
  h.store.games.value = [{ id: 'avalon', min_players: 5 }]
  const route = { params: {}, query: { room: SESSION.room } }
  const lobby = page('GameLobby', h, route)
  assert.equal(lobby.joinCode.value, SESSION.room)
  assert.equal(lobby.selectedGame.value, 'avalon')
  lobby.mount()
  h.room(socket)
  lobby.flush()
  assert.equal(lobby.navigations.length, 1)
  socket.message({ type: 'log', text: 'unrelated' })
  lobby.flush()
  assert.equal(lobby.navigations.length, 1)
  lobby.leave({ name: 'GameRoom', params: { roomCode: SESSION.room } })
  assert.equal(h.store.connected.value, true)
  lobby.leave({ name: 'BlogHome', params: {} })
  assert.equal(h.store.connected.value, false)
  assert.equal(h.timers.size, 0)
})

test('lowercase manual join codes normalize before room-assignment navigation', () => {
  const h = harness()
  const socket = h.open()
  const lobby = page('GameLobby', h, { params: {}, query: {} })
  lobby.joinCode.value = ' abcdef '
  lobby.joinRoom()
  assert.equal(socket.sent.at(-1).room, SESSION.room)
  h.room(socket)
  lobby.flush()
  assert.equal(lobby.navigations.at(-1).target.params.roomCode, SESSION.room)
})

test('creating a room from a targeted join form navigates to the newly assigned room', () => {
  const h = harness()
  const socket = h.open()
  const lobby = page('GameLobby', h, { params: {}, query: { room: 'UVWXYZ' } })
  lobby.createRoom()
  h.room(socket)
  lobby.flush()
  assert.equal(lobby.navigations.at(-1).target.params.roomCode, SESSION.room)
})

test('a different targeted join form does not auto-navigate back into a cached room', () => {
  const h = harness()
  const socket = h.open()
  h.room(socket)
  const lobby = page('GameLobby', h, { params: {}, query: { room: 'UVWXYZ' } })
  assert.equal(lobby.navigations.length, 0)
  lobby.mount()
  lobby.flush()
  assert.equal(h.store.room.value, null)
  assert.equal(lobby.joinCode.value, 'UVWXYZ')
  assert.equal(lobby.navigations.length, 0)
})

test('terminal recovery stays visible for its room, but a different room gets the join form', () => {
  const h = harness({ session: SESSION })
  const socket = h.open()
  socket.message({ type: 'error', code: 'resume_expired', msg: '恢复凭证已失效' })
  const route = { params: { roomCode: SESSION.room }, query: {} }
  const view = page('GameRoom', h, route)
  assert.equal(view.navigations.length, 0)
  assert.equal(h.sockets.length, 1)
  route.params.roomCode = 'UVWXYZ'
  view.flush()
  assert.equal(view.navigations.at(-1).target.query.room, 'UVWXYZ')
  assert.equal(h.store.recoveryError.value, '')
})

test('returning after failed recovery pre-fills the expired room without reusing its token', () => {
  const h = harness({ session: SESSION })
  const socket = h.open()
  socket.message({ type: 'error', code: 'resume_expired', msg: '恢复凭证已失效' })
  const view = page('GameRoom', h, { params: { roomCode: SESSION.room }, query: {} })
  view.backToLobby()
  assert.deepEqual(view.navigations.at(-1), {
    method: 'push', target: { name: 'GameLobby', query: { room: SESSION.room } },
  })
  assert.equal(h.storage.has(SESSION_KEY), false)
})

test('game page templates retain balanced controls and visible recovery/connection states', () => {
  const voidTags = new Set(['input', 'img', 'br', 'hr'])
  for (const name of ['GameLobby', 'GameRoom']) {
    const source = readFileSync(new URL(`../src/views/game/${name}.vue`, import.meta.url), 'utf8')
    const template = source.slice(source.indexOf('<template>') + '<template>'.length, source.lastIndexOf('</template>'))
      .replace(/<!--[\s\S]*?-->/g, '')
    const stack = []
    for (const match of template.matchAll(/<(\/?)([A-Za-z][\w-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*\/?>/g)) {
      const [, closing, tag] = match
      if (closing) assert.equal(stack.pop(), tag, `${name}: unexpected closing ${tag}`)
      else if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(tag)
    }
    assert.deepEqual(stack, [], `${name}: unclosed template tags`)
    assert.match(template, /store\.connectionLabel/)
    assert.match(template, /store\.recoveryError/)
    assert.match(template, /<fieldset[^>]*:disabled="!store\.actionsEnabled/)
  }
})

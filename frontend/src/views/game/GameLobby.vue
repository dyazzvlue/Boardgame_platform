<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../../stores/game.js'

const store = useGameStore()
const router = useRouter()

const name = ref(localStorage.getItem('playerName') || '')
const password = ref('')
const joinCode = ref('')
const joinPwd = ref('')
const selectedGame = ref('')
const playerCount = ref(0)
const turnTimeout = ref(30)

function selectGame(g) {
  selectedGame.value = g.id
  playerCount.value = g.min_players
}

function createRoom() {
  if (!name.value.trim()) { store.error = '请输入你的名字'; return }
  localStorage.setItem('playerName', name.value.trim())
  store.createRoom(selectedGame.value, name.value.trim(), password.value, playerCount.value, turnTimeout.value)
}

function joinRoom(spectate = false) {
  if (!name.value.trim() || !joinCode.value.trim()) { store.error = '请填写名字和房间号'; return }
  localStorage.setItem('playerName', name.value.trim())
  store.joinRoom(joinCode.value.trim().toUpperCase(), name.value.trim(), joinPwd.value, spectate)
}

// Watch for room assignment to navigate
const unwatch = store.$subscribe((_, state) => {
  if (state.room && state.room.code) {
    router.push(`/game/${state.room.code}`)
  }
})

onMounted(() => {
  store.connect()
  // Auto-select first game when list arrives
  const stop = store.$subscribe((_, state) => {
    if (state.games.length && !selectedGame.value) {
      selectGame(state.games[0])
      stop()
    }
  })
})

onUnmounted(() => { unwatch() })
</script>

<template>
  <div class="lobby">
    <h1>🎲 游戏大厅</h1>
    <p v-if="store.error" class="error">{{ store.error }}</p>

    <div class="lobby-grid">
      <!-- 游戏选择 -->
      <section class="card">
        <h3>选择游戏</h3>
        <div class="game-list">
          <div v-for="g in store.games" :key="g.id" class="game-item"
               :class="{ active: selectedGame === g.id }" @click="selectGame(g)">
            <strong>{{ g.name }}</strong>
            <small>{{ g.min_players }}-{{ g.max_players }}人</small>
          </div>
        </div>
      </section>

      <!-- 创建房间 -->
      <section class="card">
        <h3>创建房间</h3>
        <div class="field"><input v-model="name" placeholder="你的名字" maxlength="20"></div>
        <div class="field"><input v-model="password" placeholder="房间密码（可选）" type="password"></div>
        <div class="field" v-if="store.games.length">
          <label>人数: {{ playerCount }}</label>
          <input type="range"
            :min="store.games.find(g=>g.id===selectedGame)?.min_players||2"
            :max="store.games.find(g=>g.id===selectedGame)?.max_players||8"
            v-model.number="playerCount">
        </div>
        <div class="field">
          <label>操作超时: {{ turnTimeout }}s</label>
          <input type="range" min="0" max="120" step="5" v-model.number="turnTimeout">
        </div>
        <button class="btn-primary" @click="createRoom" :disabled="!selectedGame">创建房间</button>
      </section>

      <!-- 加入房间 -->
      <section class="card">
        <h3>加入房间</h3>
        <div class="field"><input v-model="name" placeholder="你的名字" maxlength="20"></div>
        <div class="field"><input v-model="joinCode" placeholder="6位房间码" maxlength="6" style="text-transform:uppercase"></div>
        <div class="field"><input v-model="joinPwd" placeholder="密码（如需要）" type="password"></div>
        <div class="join-btns">
          <button class="btn-primary" @click="joinRoom(false)">加入游戏</button>
          <button class="btn-outline" @click="joinRoom(true)">观战</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lobby h1 { margin-bottom: 1.5rem; }
.error { color: var(--danger); background: rgba(255,50,50,0.1); padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
.lobby-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
.game-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.8rem; }
.game-item { padding: 0.6rem 0.8rem; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); transition: all 0.15s; }
.game-item:hover { border-color: var(--accent); }
.game-item.active { border-color: var(--accent); background: rgba(74,144,226,0.1); }
.game-item small { color: var(--text-muted); }
.field { margin-bottom: 0.8rem; }
.field label { display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.3rem; }
.join-btns { display: flex; gap: 0.5rem; }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.btn-outline:hover { border-color: var(--accent); }
</style>

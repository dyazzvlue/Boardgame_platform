<script setup>
import { computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../../stores/game.js'

const route = useRoute()
const router = useRouter()
const store = useGameStore()
const roomCode = route.params.roomCode

// Dynamic renderer based on game_id
const renderers = {
  manila: defineAsyncComponent(() => import('../../components/games/ManilaGame.vue')),
  avalon: defineAsyncComponent(() => import('../../components/games/AvalonGame.vue')),
  incan_gold: defineAsyncComponent(() => import('../../components/games/IncanGoldGame.vue')),
  guandan: defineAsyncComponent(() => import('../../components/games/GuanDanGame.vue')),
  transcard: defineAsyncComponent(() => import('../../components/games/TransCardGame.vue')),
}

const GameRenderer = computed(() => {
  const id = store.gameId
  return renderers[id] || null
})

onMounted(() => {
  if (!store.connected) store.connect()
  store.startPing()
})

onUnmounted(() => {
  store.stopPing()
})

function leave() {
  store.leaveGame()
  router.push('/game')
}

function backToLobby() {
  store.returnRoom()
  router.push('/game')
}
</script>

<template>
  <div class="game-room">
    <!-- 错误提示 -->
    <p v-if="store.error" class="error">{{ store.error }}</p>

    <!-- 等待室 -->
    <div v-if="store.room && !store.started" class="waiting card">
      <div class="room-header">
        <h2>房间: {{ roomCode }}</h2>
        <span class="game-badge">{{ store.room.game_name || store.room.game_id }}</span>
      </div>
      <p class="room-meta">
        人数: {{ store.room.players?.length || 0 }}/{{ store.room.player_count }}
        <span v-if="store.countdown > 0" class="countdown">⏱ {{ store.countdown }}s 后自动开始</span>
      </p>
      <div class="player-list">
        <div v-for="p in store.room.players" :key="p.idx" class="player-slot" :class="{ me: p.idx === store.myIdx }">
          <span class="player-name">{{ p.name }}</span>
          <span v-if="p.is_ai" class="ai-tag">AI</span>
          <span v-if="p.idx === 0" class="host-tag">房主</span>
          <span v-if="!p.connected && !p.is_ai" class="offline-tag">离线</span>
        </div>
      </div>
      <div v-if="store.isHost" class="host-controls">
        <button class="btn-primary" @click="store.startGame()" :disabled="(store.room.players?.length || 0) < 2">开始游戏</button>
        <button class="btn-outline" @click="store.addAI()">添加AI</button>
      </div>
      <button class="btn-outline" style="margin-top:0.5rem" @click="backToLobby">返回大厅</button>
    </div>

    <!-- 游戏进行中 -->
    <div v-else-if="store.gameState && !store.gameOver" class="game-area">
      <component v-if="GameRenderer" :is="GameRenderer" />
      <div v-else class="card fallback">
        <p>游戏进行中 ({{ store.gameId }})</p>
        <pre class="state-dump">{{ JSON.stringify(store.gameState, null, 2) }}</pre>
      </div>
    </div>

    <!-- 游戏结束 -->
    <div v-if="store.gameOver" class="game-over card">
      <h2>🎉 游戏结束</h2>
      <component v-if="GameRenderer" :is="GameRenderer" />
      <pre v-else class="state-dump">{{ JSON.stringify(store.gameOver, null, 2) }}</pre>
      <div class="over-actions">
        <button class="btn-primary" @click="store.returnRoom()">再来一局</button>
        <button class="btn-outline" @click="backToLobby">返回大厅</button>
      </div>
    </div>

    <!-- 日志面板 -->
    <div v-if="store.started || store.gameOver" class="log-panel card">
      <h4>游戏日志</h4>
      <div class="log-scroll">
        <div v-for="(log, i) in store.logs" :key="i" :class="['log-entry', log.style]">{{ log.text }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-room { max-width: 1200px; margin: 0 auto; }
.error { color: var(--danger); background: rgba(255,50,50,0.1); padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
.room-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem; }
.game-badge { background: var(--accent); color: #fff; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; }
.room-meta { color: var(--text-muted); margin-bottom: 1rem; }
.countdown { color: var(--accent); margin-left: 1rem; font-weight: bold; }
.player-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
.player-slot { padding: 0.5rem 0.8rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; gap: 0.5rem; }
.player-slot.me { border-color: var(--accent); }
.ai-tag { background: #555; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.7rem; }
.host-tag { background: #c6a700; color: #000; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.7rem; }
.offline-tag { background: var(--danger); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.7rem; }
.host-controls { display: flex; gap: 0.5rem; }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.btn-outline:hover { border-color: var(--accent); }
.game-area { margin-bottom: 1rem; }
.fallback { max-height: 500px; overflow: auto; }
.state-dump { font-size: 0.75rem; max-height: 400px; overflow: auto; background: #111; padding: 1rem; border-radius: 6px; }
.game-over { text-align: center; margin-bottom: 1rem; }
.game-over h2 { margin-bottom: 1rem; }
.over-actions { display: flex; gap: 0.5rem; justify-content: center; margin-top: 1rem; }
.log-panel h4 { margin-bottom: 0.5rem; }
.log-scroll { max-height: 200px; overflow-y: auto; font-size: 0.8rem; }
.log-entry { padding: 0.2rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.log-entry.warn { color: #f5a623; }
.log-entry.error { color: var(--danger); }
.log-entry.header { color: var(--accent); font-weight: bold; }
.log-entry.success { color: var(--success); }
</style>

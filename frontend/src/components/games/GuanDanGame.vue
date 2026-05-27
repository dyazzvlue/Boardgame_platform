<script setup>
import { computed, ref } from 'vue'
import { useGameStore } from '../../stores/game.js'

const store = useGameStore()
const state = computed(() => store.gameState || {})
const req = computed(() => store.isMyTurn ? store.request : null)
const myPlayer = computed(() => state.value.players?.find(p => p.idx === store.myIdx))
const selectedCards = ref([])

function toggleCard(uid) {
  const idx = selectedCards.value.indexOf(uid)
  if (idx >= 0) selectedCards.value.splice(idx, 1)
  else selectedCards.value.push(uid)
}

function playCards() {
  store.respond(store.request.kind, selectedCards.value)
  selectedCards.value = []
}

function pass() {
  store.respond(store.request.kind, 'pass')
  selectedCards.value = []
}

function respondTribute(uid) {
  store.respond(store.request.kind, uid)
}
</script>

<template>
  <div class="guandan">
    <!-- 状态栏 -->
    <div class="phase-bar">
      <span class="phase">{{ state.phase }}</span>
      <span>第 {{ state.round_num }} 局</span>
      <span>级牌: {{ state.level_rank }}</span>
      <span v-for="(lv, team) in state.level" :key="team">{{ team }}: {{ lv }}</span>
    </div>

    <!-- 其他玩家 -->
    <div class="other-players">
      <div v-for="p in state.players" :key="p.idx" v-show="p.idx !== store.myIdx"
           class="other card" :class="{ active: p.idx === state.current_idx }">
        <strong>{{ p.name }}</strong>
        <small>{{ p.team }}</small>
        <span class="hand-count">🃏×{{ p.hand_count }}</span>
        <span v-if="state.finish_order?.includes(p.idx)" class="finished">✅</span>
      </div>
    </div>

    <!-- 上一手牌 -->
    <div v-if="state.last_play" class="last-play card">
      <small>{{ state.players?.[state.last_player_idx]?.name }} 打出:</small>
      <div class="played-cards">
        <span v-for="c in state.last_play.cards" :key="c.uid" class="card-tile">{{ c.display }}</span>
      </div>
      <small>{{ state.last_play.hand_type }}</small>
    </div>
    <div v-else-if="state.current_idx >= 0" class="last-play card">
      <small>自由出牌</small>
    </div>

    <!-- 我的手牌 -->
    <div v-if="myPlayer?.hand" class="my-hand">
      <h4>我的手牌 ({{ myPlayer.hand.length }})</h4>
      <div class="hand-cards">
        <div v-for="c in myPlayer.hand" :key="c.uid"
             class="card-tile" :class="{ selected: selectedCards.includes(c.uid), wild: c.is_wild }"
             @click="toggleCard(c.uid)">
          {{ c.display }}
        </div>
      </div>
    </div>

    <!-- 出牌操作 -->
    <div v-if="req && req.kind === 'play'" class="request card highlight">
      <h4>🎯 轮到你出牌</h4>
      <div class="play-actions">
        <button class="btn-primary" @click="playCards()" :disabled="!selectedCards.length">出牌 ({{ selectedCards.length }})</button>
        <button class="btn-outline" @click="pass()" v-if="state.last_play">不出</button>
      </div>
    </div>

    <!-- 进贡操作 -->
    <div v-if="req && (req.kind === 'tribute_give' || req.kind === 'tribute_return')" class="request card highlight">
      <h4>🎯 {{ req.kind === 'tribute_give' ? '选择进贡的牌' : '选择还贡的牌' }}</h4>
      <p v-if="req.data" class="tribute-hint">{{ JSON.stringify(req.data) }}</p>
      <div class="hand-cards">
        <div v-for="c in myPlayer?.hand" :key="c.uid"
             class="card-tile tribute-pick" @click="respondTribute(c.uid)">
          {{ c.display }}
        </div>
      </div>
    </div>

    <!-- 游戏结束 -->
    <div v-if="state.game_over" class="result card">
      <h3>🎉 {{ state.winner_team }} 队获胜！</h3>
    </div>
  </div>
</template>

<style scoped>
.guandan { display: flex; flex-direction: column; gap: 1rem; }
.phase-bar { display: flex; gap: 1rem; align-items: center; font-size: 0.9rem; color: var(--text-muted); flex-wrap: wrap; }
.phase { background: #e74c3c; color: #fff; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; }
.other-players { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; }
.other { padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.2rem; font-size: 0.85rem; }
.other.active { border-color: var(--accent); box-shadow: 0 0 8px rgba(74,144,226,0.3); }
.hand-count { color: var(--text-muted); }
.finished { color: var(--success); }
.last-play { text-align: center; padding: 0.8rem; }
.played-cards { display: flex; justify-content: center; gap: 0.3rem; margin: 0.3rem 0; flex-wrap: wrap; }
.my-hand { margin-top: 0.5rem; }
.my-hand h4 { margin-bottom: 0.5rem; }
.hand-cards { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.card-tile { padding: 0.4rem 0.6rem; background: var(--bg-card); border: 2px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: bold; user-select: none; transition: all 0.15s; }
.card-tile:hover { border-color: var(--accent); }
.card-tile.selected { border-color: var(--accent); transform: translateY(-4px); background: rgba(74,144,226,0.15); }
.card-tile.wild { color: #e74c3c; }
.tribute-pick:hover { border-color: #e74c3c; transform: translateY(-3px); }
.request { border: 2px solid #e74c3c; animation: pulse 1.5s infinite; }
.highlight { background: rgba(231,76,60,0.05); }
.play-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.tribute-hint { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.result { text-align: center; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.8; } }
</style>

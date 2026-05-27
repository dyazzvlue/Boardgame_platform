<script setup>
import { computed } from 'vue'
import { useGameStore } from '../../stores/game.js'

const store = useGameStore()
const state = computed(() => store.gameState || {})
const req = computed(() => store.isMyTurn ? store.request : null)

function respond(value) {
  store.respond(store.request.kind, value)
}
</script>

<template>
  <div class="incangold">
    <!-- 阶段 -->
    <div class="phase-bar">
      <span class="phase">{{ state.phase || '探险中' }}</span>
      <span v-if="state.round_num">第 {{ state.round_num }} 轮</span>
      <span v-if="state.deck_remaining !== undefined">牌库: {{ state.deck_remaining }}</span>
      <span v-if="state.explorer_count !== undefined">探险者: {{ state.explorer_count }}人</span>
    </div>

    <!-- 翻开的牌 -->
    <div v-if="state.revealed_cards?.length" class="path">
      <h4>🏛 探险路径</h4>
      <div class="path-cards">
        <div v-for="(card, i) in state.revealed_cards" :key="i" class="path-card"
             :class="card.kind">
          <span class="card-icon">{{ card.kind === 'hazard' ? '💀' : card.kind === 'artifact' ? '🏺' : '💎' }}</span>
          <span class="card-name">{{ card.label || card.kind }}</span>
          <span v-if="card.value" class="card-value">{{ card.value }}</span>
        </div>
      </div>
      <p class="path-info">路径上宝石: {{ state.table_gems || 0 }} | 神器: {{ state.artifacts_on_path?.length || 0 }}</p>
    </div>

    <!-- 已见灾难 -->
    <div v-if="state.hazards_seen_labels?.length" class="hazards">
      <small>已出现灾难: {{ state.hazards_seen_labels.join(', ') }}</small>
    </div>

    <!-- 玩家状态 -->
    <div v-if="state.players" class="players">
      <div v-for="(p, i) in state.players" :key="i" class="player card" :class="{ me: i === store.myIdx, fled: !p.exploring }">
        <strong>{{ p.name }}</strong>
        <div class="player-stats">
          <span>💰 本轮: {{ p.round_gems || 0 }}</span>
          <span>🏠 帐篷: {{ p.tent_gems || 0 }}</span>
          <span v-if="p.artifact_score" class="artifact-score">🏺 {{ p.artifact_score }}</span>
          <span class="status-badge" :class="p.exploring ? 'exploring' : 'fled'">
            {{ p.exploring ? '探险中' : '已撤退' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 操作请求 -->
    <div v-if="req" class="request card highlight">
      <div v-if="req.kind === 'explore_or_return'" class="action-panel">
        <h4>🎯 继续探险还是撤退？</h4>
        <p>本轮已获得: {{ req.data?.my_round_gems || 0 }} 宝石</p>
        <div class="options">
          <button class="opt-btn explore-btn" @click="respond(true)">🏃 继续探险</button>
          <button class="opt-btn flee-btn" @click="respond(false)">🏠 返回帐篷</button>
        </div>
      </div>
      <div v-else class="action-panel">
        <h4>{{ req.kind }}</h4>
        <div v-if="req.data?.options" class="options">
          <button v-for="(opt, i) in req.data.options" :key="i" class="opt-btn" @click="respond(opt.value ?? opt)">
            {{ opt.label || opt }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.incangold { display: flex; flex-direction: column; gap: 1rem; }
.phase-bar { display: flex; gap: 1rem; align-items: center; font-size: 0.9rem; color: var(--text-muted); }
.phase { background: #d4a017; color: #000; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; text-transform: capitalize; }
.path-cards { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
.path-card { display: flex; flex-direction: column; align-items: center; padding: 0.5rem; border-radius: 8px; background: var(--bg-card); border: 2px solid var(--border); min-width: 65px; }
.path-card.treasure { border-color: #d4a017; }
.path-card.hazard { border-color: var(--danger); background: rgba(231,76,60,0.1); }
.path-card.artifact { border-color: #9b59b6; background: rgba(155,89,182,0.1); }
.card-icon { font-size: 1.4rem; }
.card-name { font-size: 0.7rem; color: var(--text-muted); }
.card-value { font-weight: bold; color: #d4a017; }
.path-info { color: var(--text-muted); font-size: 0.8rem; margin-top: 0.3rem; }
.hazards { font-size: 0.8rem; color: var(--danger); }
.players { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 0.5rem; }
.player { padding: 0.6rem; }
.player.me { border-color: var(--accent); }
.player.fled { opacity: 0.65; }
.player-stats { display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: 0.8rem; margin-top: 0.3rem; }
.artifact-score { color: #9b59b6; }
.status-badge { padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.7rem; }
.status-badge.exploring { background: rgba(39,174,96,0.2); color: #2ecc71; }
.status-badge.fled { background: rgba(150,150,150,0.2); color: var(--text-muted); }
.request { border: 2px solid #d4a017; animation: pulse 1.5s infinite; }
.highlight { background: rgba(212,160,23,0.06); }
.action-panel h4 { margin-bottom: 0.5rem; }
.action-panel p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.options { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.opt-btn { padding: 0.5rem 1rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
.explore-btn { background: var(--success); color: #fff; }
.flee-btn { background: #d4a017; color: #000; }
.opt-btn:hover { opacity: 0.85; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.8; } }
</style>

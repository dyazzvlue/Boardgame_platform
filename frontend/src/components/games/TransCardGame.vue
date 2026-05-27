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

function respond(value) {
  store.respond(store.request.kind, value)
  selectedCards.value = []
}
</script>

<template>
  <div class="transcard">
    <!-- 状态栏 -->
    <div class="phase-bar">
      <span class="phase">{{ state.phase === 'finished' ? '已结束' : '进行中' }}</span>
      <span>回合 {{ state.turn }}</span>
      <span>牌堆: {{ state.deck_remaining }}</span>
      <span>弃牌: {{ state.discard_count }}</span>
    </div>

    <!-- 其他玩家 -->
    <div class="other-players">
      <div v-for="p in state.players" :key="p.idx" v-show="p.idx !== store.myIdx"
           class="other card" :class="{ active: p.idx === state.current_idx }">
        <strong>{{ p.name }}</strong>
        <span class="hand-count">🃏×{{ p.hand_size }}</span>
        <span class="score">⭐{{ p.total_score }}</span>
        <div v-if="p.scored?.length" class="scored-summary">
          <small v-for="(s, i) in p.scored" :key="i">{{ s.type }}({{ s.score }})</small>
        </div>
      </div>
    </div>

    <!-- 我的得分区 -->
    <div v-if="myPlayer?.scored?.length" class="my-scored card">
      <h4>我的得分</h4>
      <div v-for="(s, i) in myPlayer.scored" :key="i" class="scored-group">
        <span class="scored-type">{{ s.type }} (+{{ s.score }})</span>
        <div class="scored-cards">
          <span v-for="c in s.cards" :key="c.uid" class="card-tile small">{{ c.name }}</span>
        </div>
      </div>
    </div>

    <!-- 我的手牌 -->
    <div v-if="myPlayer?.hand?.length" class="my-hand">
      <h4>我的手牌 ({{ myPlayer.hand.length }})</h4>
      <div class="hand-cards">
        <div v-for="c in myPlayer.hand" :key="c.uid"
             class="card-tile" :class="{ selected: selectedCards.includes(c.uid), effect: c.is_effect, joker: c.is_joker }"
             @click="toggleCard(c.uid)">
          {{ c.name }}
        </div>
      </div>
    </div>

    <!-- 操作请求 -->
    <div v-if="req" class="request card highlight">

      <!-- 选择行动类型 -->
      <div v-if="req.kind === 'choose_action'" class="action-panel">
        <h4>🎯 选择行动</h4>
        <div class="options">
          <button v-for="a in req.data?.available" :key="a" class="opt-btn" @click="respond(a)">
            {{ a === 'draw' ? '摸牌' : a === 'play' ? '出牌' : a === 'discard' ? '弃牌' : a === 'effect' ? '发动效果' : a }}
          </button>
        </div>
      </div>

      <!-- 选择卡牌 -->
      <div v-else-if="req.kind === 'select_cards'" class="action-panel">
        <h4>🃏 {{ req.data?.purpose || '选择卡牌' }}</h4>
        <p v-if="req.data?.n">需要选择 {{ req.data.n }} 张牌</p>
        <div class="hand-cards">
          <div v-for="c in (req.data?.hand || myPlayer?.hand || [])" :key="c.uid"
               class="card-tile" :class="{ selected: selectedCards.includes(c.uid), effect: c.is_effect, joker: c.is_joker }"
               @click="toggleCard(c.uid)">
            {{ c.name }}
          </div>
        </div>
        <div class="play-actions">
          <button class="btn-primary" @click="respond(selectedCards)"
                  :disabled="req.data?.n ? selectedCards.length !== req.data.n : !selectedCards.length">
            确认 ({{ selectedCards.length }}{{ req.data?.n ? '/' + req.data.n : '' }})
          </button>
          <button v-if="!req.data?.n" class="btn-outline" @click="respond([])">跳过</button>
        </div>
      </div>

      <!-- 选择目标玩家 -->
      <div v-else-if="req.kind === 'select_player'" class="action-panel">
        <h4>👤 {{ req.data?.prompt || '选择目标玩家' }}</h4>
        <div class="options">
          <button v-for="c in req.data?.candidates" :key="c.idx" class="opt-btn" @click="respond(c.idx)">
            {{ c.name }} (🃏{{ c.hand_size }})
          </button>
        </div>
      </div>

      <!-- 通用 fallback -->
      <div v-else class="action-panel">
        <h4>{{ req.kind }}</h4>
        <div v-if="req.data?.options" class="options">
          <button v-for="(opt, i) in req.data.options" :key="i" class="opt-btn" @click="respond(opt.value ?? opt)">
            {{ opt.label || opt }}
          </button>
        </div>
        <div v-else class="play-actions">
          <button class="btn-primary" @click="respond(selectedCards)" :disabled="!selectedCards.length">确认</button>
          <button class="btn-outline" @click="respond(null)">跳过</button>
        </div>
      </div>
    </div>

    <!-- 游戏结束 -->
    <div v-if="state.game_over" class="result card">
      <h3>🎉 游戏结束</h3>
      <p v-if="state.game_over_reason">{{ state.game_over_reason }}</p>
      <div class="final-scores">
        <div v-for="p in state.players" :key="p.idx" class="final-player">
          <strong>{{ p.name }}</strong>: {{ p.total_score }} 分
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transcard { display: flex; flex-direction: column; gap: 1rem; }
.phase-bar { display: flex; gap: 1rem; align-items: center; font-size: 0.9rem; color: var(--text-muted); flex-wrap: wrap; }
.phase { background: #2ecc71; color: #000; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; }
.other-players { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; }
.other { padding: 0.5rem; text-align: center; }
.other.active { border-color: var(--accent); box-shadow: 0 0 8px rgba(74,144,226,0.3); }
.hand-count { color: var(--text-muted); font-size: 0.8rem; }
.score { color: #d4a017; font-weight: bold; }
.scored-summary { display: flex; flex-wrap: wrap; gap: 0.2rem; justify-content: center; margin-top: 0.2rem; }
.scored-summary small { background: var(--bg); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.7rem; }
.my-scored { padding: 0.8rem; }
.my-scored h4 { margin-bottom: 0.5rem; }
.scored-group { margin-bottom: 0.4rem; }
.scored-type { font-size: 0.85rem; color: var(--accent); }
.scored-cards { display: flex; flex-wrap: wrap; gap: 0.2rem; margin-top: 0.2rem; }
.my-hand h4 { margin-bottom: 0.5rem; }
.hand-cards { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.5rem; }
.card-tile { padding: 0.4rem 0.6rem; background: var(--bg-card); border: 2px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; user-select: none; transition: all 0.15s; }
.card-tile.small { padding: 0.2rem 0.4rem; font-size: 0.75rem; cursor: default; }
.card-tile:hover { border-color: var(--accent); }
.card-tile.selected { border-color: #2ecc71; transform: translateY(-4px); background: rgba(46,204,113,0.15); }
.card-tile.effect { color: #9b59b6; }
.card-tile.joker { color: #e74c3c; }
.request { border: 2px solid #2ecc71; animation: pulse 1.5s infinite; }
.highlight { background: rgba(46,204,113,0.05); }
.action-panel h4 { margin-bottom: 0.5rem; }
.action-panel p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.options { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.opt-btn { padding: 0.5rem 1rem; background: #2ecc71; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
.opt-btn:hover { opacity: 0.85; }
.play-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.btn-primary { padding: 0.5rem 1rem; background: #2ecc71; color: #000; border: none; border-radius: 6px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.result { text-align: center; }
.final-scores { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; margin-top: 0.5rem; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.8; } }
</style>

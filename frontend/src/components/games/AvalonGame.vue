<script setup>
import { computed, ref } from 'vue'
import { useGameStore } from '../../stores/game.js'

const store = useGameStore()
const state = computed(() => store.gameState || {})
const req = computed(() => store.isMyTurn ? store.request : null)
const teamSelection = ref([])

function respond(value) {
  store.respond(store.request.kind, value)
}

function submitTeam() {
  respond(teamSelection.value)
  teamSelection.value = []
}
</script>

<template>
  <div class="avalon">
    <!-- 顶部信息 -->
    <div class="phase-bar">
      <span class="phase">{{ state.phase }}</span>
      <span v-if="state.round_num">第 {{ state.round_num }} 轮</span>
      <span v-if="state.vote_fail_count">否决: {{ state.vote_fail_count }}/5</span>
    </div>

    <!-- 我的身份 -->
    <div v-if="state.my_role" class="my-role card">
      <div class="role-header">
        <span class="role-label" :class="state.my_alignment === 'good' ? 'good' : 'evil'">
          {{ state.my_role }}
        </span>
        <span class="alignment">{{ state.my_alignment === 'good' ? '正义方 ⚔️' : '邪恶方 💀' }}</span>
      </div>
      <p v-if="state.role_desc" class="role-desc">{{ state.role_desc }}</p>
      <div v-if="state.visible_players?.length" class="visible-info">
        <small>你的情报:</small>
        <span v-for="v in state.visible_players" :key="v.idx" class="visible-tag">
          {{ v.name }} <small>({{ v.hint }})</small>
        </span>
      </div>
    </div>

    <!-- 任务轨道 -->
    <div v-if="state.mission_sizes" class="mission-track">
      <div v-for="(size, i) in state.mission_sizes" :key="i" class="mission"
           :class="{ success: state.mission_results?.[i] === 'success', fail: state.mission_results?.[i] === 'fail', current: i === state.round_idx }">
        <span class="mission-num">{{ i + 1 }}</span>
        <small>{{ size }}人</small>
        <span v-if="state.mission_results?.[i]" class="result-icon">
          {{ state.mission_results[i] === 'success' ? '✅' : '❌' }}
        </span>
      </div>
    </div>

    <!-- 玩家列表 -->
    <div v-if="state.players" class="players">
      <div v-for="(p, i) in state.players" :key="i" class="player card"
           :class="{ leader: i === state.leader_idx, me: i === store.myIdx }">
        <div class="player-name">{{ p.name }}</div>
        <div v-if="p.role" class="role-badge">{{ p.role }}</div>
        <div v-if="i === state.leader_idx" class="leader-badge">👑</div>
      </div>
    </div>

    <!-- 最近投票 -->
    <div v-if="state.vote_history?.length" class="vote-history card">
      <h4>最近投票</h4>
      <div v-for="(vh, vi) in state.vote_history" :key="vi" class="vote-round">
        <small>R{{ vh.round }}: {{ vh.result }}</small>
      </div>
    </div>

    <!-- 操作面板 -->
    <div v-if="req" class="request card highlight">

      <!-- show_role 确认（夜晚） -->
      <div v-if="req.kind === 'show_role'" class="action-panel">
        <h4>🌙 夜晚 — 查看身份</h4>
        <p>你的角色: <strong>{{ req.data?.your_role }}</strong> ({{ req.data?.alignment }})</p>
        <div v-if="req.data?.visible?.length" class="night-visible">
          <p>你看到的信息:</p>
          <div v-for="v in req.data.visible" :key="v.idx" class="visible-item">
            {{ v.name }}: {{ v.hint }}
          </div>
        </div>
        <p v-if="req.data?.role_desc" class="role-desc">{{ req.data.role_desc }}</p>
        <button class="btn-primary" @click="respond('ok')">我知道了</button>
      </div>

      <!-- 选队伍 -->
      <div v-else-if="req.kind === 'select_team'" class="action-panel">
        <h4>👑 选择出征队伍</h4>
        <p>选择 {{ req.data?.team_size }} 名队员:</p>
        <div class="player-options">
          <label v-for="(p, i) in state.players" :key="i" class="check-opt">
            <input type="checkbox" :value="i" v-model="teamSelection"> {{ p.name }}
          </label>
        </div>
        <button class="btn-primary" @click="submitTeam()"
                :disabled="teamSelection.length !== req.data?.team_size">
          确认 ({{ teamSelection.length }}/{{ req.data?.team_size }})
        </button>
      </div>

      <!-- 投票 -->
      <div v-else-if="req.kind === 'vote'" class="action-panel">
        <h4>🗳 投票</h4>
        <p v-if="req.data?.team">出征队伍: {{ req.data.team.map(i => state.players[i]?.name).join(', ') }}</p>
        <div class="options">
          <button class="btn-approve" @click="respond(true)">赞成 ✓</button>
          <button class="btn-reject" @click="respond(false)">反对 ✗</button>
        </div>
      </div>

      <!-- 执行任务 -->
      <div v-else-if="req.kind === 'mission'" class="action-panel">
        <h4>⚔️ 执行任务</h4>
        <div class="options">
          <button class="btn-approve" @click="respond(true)">任务成功 ✓</button>
          <button class="btn-reject" @click="respond(false)">任务失败 ✗</button>
        </div>
      </div>

      <!-- 刺杀 -->
      <div v-else-if="req.kind === 'assassinate'" class="action-panel">
        <h4>🗡 刺杀梅林</h4>
        <p>选择你认为是梅林的玩家:</p>
        <div class="options">
          <button v-for="(p, i) in state.players" :key="i"
                  class="opt-btn" @click="respond(i)"
                  v-show="p.alignment !== 'evil' || state.phase === 'game_over'">
            {{ p.name }}
          </button>
        </div>
      </div>

      <!-- 湖中女士 -->
      <div v-else-if="req.kind === 'lady_of_lake'" class="action-panel">
        <h4>🔮 湖中女士</h4>
        <p>选择一名玩家查验:</p>
        <div class="options">
          <button v-for="(p, i) in state.players" :key="i"
                  class="opt-btn" @click="respond(i)" v-show="i !== store.myIdx">
            {{ p.name }}
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
        <div v-else class="options">
          <button class="btn-approve" @click="respond(true)">确认</button>
          <button class="btn-reject" @click="respond(false)">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.avalon { display: flex; flex-direction: column; gap: 1rem; }
.phase-bar { display: flex; gap: 1rem; align-items: center; font-size: 0.9rem; }
.phase { background: #7b2ff7; color: #fff; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; text-transform: capitalize; }

.my-role { border: 2px solid #7b2ff7; background: rgba(123,47,247,0.08); }
.role-header { display: flex; align-items: center; gap: 0.8rem; }
.role-label { font-size: 1.2rem; font-weight: bold; padding: 0.2rem 0.6rem; border-radius: 4px; }
.role-label.good { background: rgba(39,174,96,0.2); color: #2ecc71; }
.role-label.evil { background: rgba(231,76,60,0.2); color: #e74c3c; }
.alignment { font-size: 0.9rem; color: var(--text-muted); }
.role-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem; }
.visible-info { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.5rem; }
.visible-tag { background: rgba(123,47,247,0.15); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; }

.mission-track { display: flex; gap: 0.5rem; justify-content: center; }
.mission { display: flex; flex-direction: column; align-items: center; padding: 0.5rem; border-radius: 8px; background: var(--bg-card); border: 2px solid var(--border); min-width: 55px; }
.mission.current { border-color: var(--accent); }
.mission.success { background: rgba(39,174,96,0.15); border-color: #2ecc71; }
.mission.fail { background: rgba(231,76,60,0.15); border-color: #e74c3c; }
.mission-num { font-size: 1.1rem; font-weight: bold; }

.players { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.5rem; }
.player { padding: 0.5rem; text-align: center; position: relative; }
.player.leader { border-color: gold; }
.player.me { border-color: var(--accent); }
.player-name { font-weight: bold; font-size: 0.85rem; }
.role-badge { font-size: 0.75rem; color: #7b2ff7; margin-top: 0.2rem; }
.leader-badge { position: absolute; top: 2px; right: 4px; font-size: 0.7rem; }

.request { border: 2px solid #7b2ff7; animation: pulse 1.5s infinite; }
.highlight { background: rgba(123,47,247,0.05); }
.action-panel h4 { margin-bottom: 0.5rem; }
.action-panel p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }

.player-options { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.8rem; }
.check-opt { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; font-size: 0.85rem; }

.options { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
.opt-btn { padding: 0.5rem 0.8rem; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; background: var(--bg-card); color: var(--text); }
.opt-btn:hover { border-color: #7b2ff7; }
.btn-primary { padding: 0.5rem 1rem; background: #7b2ff7; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-approve { padding: 0.5rem 1rem; background: #2ecc71; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.btn-reject { padding: 0.5rem 1rem; background: #e74c3c; color: #fff; border: none; border-radius: 6px; cursor: pointer; }

.night-visible { margin: 0.5rem 0; padding: 0.5rem; background: rgba(123,47,247,0.1); border-radius: 6px; }
.visible-item { font-size: 0.85rem; margin-left: 0.5rem; }
.vote-history { font-size: 0.8rem; }
.vote-round { padding: 0.2rem 0; }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.85; } }
</style>

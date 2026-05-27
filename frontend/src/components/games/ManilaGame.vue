<script setup>
import { computed, ref } from 'vue'
import { useGameStore } from '../../stores/game.js'

const store = useGameStore()
const state = computed(() => store.gameState || {})
const req = computed(() => store.isMyTurn ? store.request : null)
const kind = computed(() => req.value?.kind || '')
const data = computed(() => req.value?.data || {})

// ── 操作状态 ──
const bidAmount = ref(0)
const selectedGood = ref('')
const shipPlacements = ref({})  // { good: position }
const deployChoice = ref(null)  // { type, good?, slot? }
const navMoves = ref([])        // [{ good, step }]

// 初始化 bid 金额
function initBid() {
  bidAmount.value = data.value.min_bid || 0
}

function respond(value) {
  store.respond(kind.value, value)
  // reset
  bidAmount.value = 0
  selectedGood.value = ''
  shipPlacements.value = {}
  deployChoice.value = null
  navMoves.value = []
}

// 竞价
function submitBid() { respond(bidAmount.value) }
function passBid() { respond(0) }

// 购买股票
function buyStock(good) { respond(good) }
function skipBuy() { respond(null) }

// 选择排除货物
function excludeGood(good) { respond(good) }

// 船只放置
function setShipPos(good, pos) { shipPlacements.value[good] = pos }
function submitShipPlacement() { respond(shipPlacements.value) }

// 部署工人
function deployToShip(good, slot) { respond({ type: 'ship', good, slot }) }
function deployToBoard(area, slot) { respond({ type: area, slot }) }
function deployInsurance() { respond({ type: 'insurance' }) }
function skipDeploy() { respond(null) }

// 领航员
function addNavMove(good, step) {
  navMoves.value.push({ good, step })
}
function removeNavMove(idx) { navMoves.value.splice(idx, 1) }
function submitNavMoves() { respond(navMoves.value) }

// 保险
function acceptInsurance() { respond(true) }
function declineInsurance() { respond(false) }

// 港口行动
function harborAction(action) { respond(action) }

// 海盗
function pirateBoard(good) { respond(good) }
function piratePass() { respond(null) }
function pirateKick(slot) { respond(slot) }
function pirateDest(pos) { respond(pos) }
</script>

<template>
  <div class="manila">
    <!-- 顶部信息 -->
    <div class="phase-bar">
      <span class="phase">第 {{ state.round_num }} 轮</span>
      <span v-if="state.sub_round" class="sub">阶段 {{ state.sub_round }}</span>
      <span class="goods-info" v-if="state.active_goods?.length">
        活跃货物: <span v-for="g in state.active_goods" :key="g" class="good-tag">{{ g }}</span>
      </span>
    </div>

    <div class="game-layout">
      <!-- 左侧：船只 + 港口 -->
      <div class="main-area">
        <!-- 船只 -->
        <div v-if="state.ships && Object.keys(state.ships).length" class="ships card">
          <h4>🚢 船只航线</h4>
          <div class="ship-list">
            <div v-for="(ship, good) in state.ships" :key="good" class="ship-row">
              <div class="ship-label">
                <span class="good-tag">{{ good }}</span>
                <span class="ship-pos">位置 {{ ship.position }}</span>
                <span v-if="ship.docked_at" class="docked">✅ {{ ship.docked_at }}</span>
                <span v-if="ship.hijacked" class="hijacked">☠️ 被劫</span>
              </div>
              <div class="ship-slots">
                <div v-for="(slot, si) in ship.slots" :key="si" class="ship-slot" :class="{ occupied: slot.worker }">
                  <small>₱{{ slot.cost }}</small>
                  <span>{{ slot.worker || '空' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 港口设施 -->
        <div v-if="state.board" class="board card">
          <h4>🏗 港口设施</h4>
          <div class="board-grid">
            <div v-for="(area, key) in { port: '港口', shipyard: '造船厂', pirate: '海盗', navigator: '领航员' }" :key="key" class="board-area">
              <h5>{{ area }}</h5>
              <div class="area-slots">
                <div v-for="(s, i) in state.board[key]" :key="i" class="b-slot" :class="{ occupied: s.worker }">
                  <span class="slot-label">{{ s.label || `${key[0].toUpperCase()}${i+1}` }}</span>
                  <small v-if="s.cost">₱{{ s.cost }}</small>
                  <small v-if="s.profit" class="profit">+{{ s.profit }}</small>
                  <small v-if="s.move" class="move">⬆{{ s.move }}</small>
                  <span v-if="s.worker" class="worker-name">{{ s.worker }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：市场 + 玩家 -->
      <div class="side-area">
        <!-- 市场 -->
        <div v-if="state.market" class="market card">
          <h4>📈 市场</h4>
          <div class="market-list">
            <div v-for="(price, good) in state.market.prices" :key="good" class="market-row">
              <span class="good-tag">{{ good }}</span>
              <span class="price">₱{{ price }}</span>
              <small>余{{ state.market.bank_stocks[good] }}</small>
            </div>
          </div>
        </div>

        <!-- 玩家 -->
        <div v-if="state.players" class="players card">
          <h4>👥 玩家</h4>
          <div v-for="(p, i) in state.players" :key="i" class="player-row" :class="{ me: i === store.myIdx }">
            <strong>{{ p.name }}</strong>
            <span>💰{{ p.money }}</span>
            <span>👷{{ p.workers_available }}</span>
            <span v-if="p.is_harbor_master">⭐</span>
            <div v-if="Object.values(p.stocks).some(v => v > 0)" class="stocks">
              <small v-for="(cnt, g) in p.stocks" :key="g" v-show="cnt > 0">{{ g }}×{{ cnt }}</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ 操作面板 ══ -->
    <div v-if="req" class="request card">

      <!-- 竞价 -->
      <div v-if="kind === 'bid'" class="action-panel">
        <h4>💰 港长竞价</h4>
        <p>当前最高出价: ₱{{ data.current_bid }} | 最低加价: ₱{{ data.min_bid }}</p>
        <div class="bid-controls">
          <button class="btn-sm" @click="bidAmount = Math.max(data.min_bid, bidAmount - 1)">-</button>
          <input type="number" v-model.number="bidAmount" :min="data.min_bid" class="bid-input" @focus="initBid">
          <button class="btn-sm" @click="bidAmount++">+</button>
          <button class="btn-primary" @click="submitBid">出价 ₱{{ bidAmount }}</button>
          <button class="btn-outline" @click="passBid">不竞价</button>
        </div>
      </div>

      <!-- 购买股票 -->
      <div v-else-if="kind === 'buy_stock'" class="action-panel">
        <h4>📊 购买股票</h4>
        <p>你的资金: ₱{{ data.player_money }}</p>
        <div class="stock-options">
          <button v-for="(price, good) in data.market?.prices" :key="good"
                  class="stock-btn" :disabled="price > data.player_money || data.market?.bank_stocks?.[good] <= 0"
                  @click="buyStock(good)">
            {{ good }} ₱{{ price }} <small>(余{{ data.market?.bank_stocks?.[good] }})</small>
          </button>
          <button class="btn-outline" @click="skipBuy">不买</button>
        </div>
      </div>

      <!-- 选择排除货物 -->
      <div v-else-if="kind === 'choose_goods'" class="action-panel">
        <h4>🚫 选择排除一种货物</h4>
        <div class="good-options">
          <button v-for="g in data.goods" :key="g" class="good-btn" @click="excludeGood(g)">
            排除 {{ g }}
          </button>
        </div>
      </div>

      <!-- 船只放置 -->
      <div v-else-if="kind === 'ship_placement'" class="action-panel">
        <h4>🚢 放置船只起始位置</h4>
        <p>为每艘船分配起始格 (1-{{ data.count }})</p>
        <div v-for="g in data.active_goods" :key="g" class="placement-row">
          <span class="good-tag">{{ g }}</span>
          <select v-model="shipPlacements[g]">
            <option v-for="n in data.count" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <button class="btn-primary" @click="submitShipPlacement" :disabled="Object.keys(shipPlacements).length < data.active_goods?.length">确认</button>
      </div>

      <!-- 部署工人 -->
      <div v-else-if="kind === 'deploy'" class="action-panel">
        <h4>👷 部署工人</h4>
        <p>可用工人: {{ data.workers_available }}</p>
        <div class="deploy-sections">
          <div class="deploy-group">
            <h5>船只</h5>
            <div v-for="(ship, good) in data.ships" :key="good" class="deploy-ship">
              <span class="good-tag">{{ good }}</span>
              <button v-for="(slot, si) in ship.slots" :key="si" class="slot-btn"
                      :disabled="!!slot.worker" @click="deployToShip(good, si)">
                位{{ si+1 }} ₱{{ slot.cost }} {{ slot.worker ? '('+slot.worker+')' : '' }}
              </button>
            </div>
          </div>
          <div class="deploy-group">
            <h5>设施</h5>
            <div v-for="(area, key) in { port: '港口', shipyard: '造船厂', pirate: '海盗', navigator: '领航员' }" :key="key">
              <div v-if="data.board?.[key]" class="deploy-area">
                <span>{{ area }}:</span>
                <button v-for="(s, i) in data.board[key]" :key="i" class="slot-btn"
                        :disabled="!!s.worker" @click="deployToBoard(key, i)">
                  {{ s.label || `${i+1}` }} ₱{{ s.cost }} {{ s.worker ? '('+s.worker+')' : '' }}
                </button>
              </div>
            </div>
          </div>
          <button class="btn-outline" @click="skipDeploy">不部署 / 结束</button>
        </div>
      </div>

      <!-- 领航员 -->
      <div v-else-if="kind === 'navigator_moves'" class="action-panel">
        <h4>🧭 领航员移动</h4>
        <p>分配 {{ data.move_steps }} 步给未靠岸船只</p>
        <div class="nav-controls">
          <div v-for="g in data.undocked_goods" :key="g" class="nav-row">
            <span class="good-tag">{{ g }}</span>
            <button v-for="s in [1, 2, 3]" :key="s" class="btn-sm" @click="addNavMove(g, s)">+{{ s }}</button>
          </div>
          <div v-if="navMoves.length" class="nav-queue">
            <span v-for="(m, i) in navMoves" :key="i" class="nav-item" @click="removeNavMove(i)">
              {{ m.good }}+{{ m.step }} ×
            </span>
          </div>
          <p>已分配: {{ navMoves.reduce((s, m) => s + m.step, 0) }} / {{ data.move_steps }}</p>
          <button class="btn-primary" @click="submitNavMoves" :disabled="navMoves.reduce((s, m) => s + m.step, 0) !== data.move_steps">确认</button>
        </div>
      </div>

      <!-- 保险 -->
      <div v-else-if="kind === 'insurance'" class="action-panel">
        <h4>🛡 购买保险？</h4>
        <div class="options">
          <button class="btn-primary" @click="acceptInsurance">购买</button>
          <button class="btn-outline" @click="declineInsurance">不买</button>
        </div>
      </div>

      <!-- 港口行动 -->
      <div v-else-if="kind === 'harbor_action'" class="action-panel">
        <h4>⚓ 港口行动</h4>
        <p v-if="data.ship">船只: {{ data.ship.good }}</p>
        <div class="options">
          <button class="btn-primary" @click="harborAction('buy')">购买股票</button>
          <button class="btn-outline" @click="harborAction('pass')">跳过</button>
        </div>
      </div>

      <!-- 海盗登船 -->
      <div v-else-if="kind === 'pirate_board'" class="action-panel">
        <h4>☠️ 海盗登船</h4>
        <p>选择要劫持的船只:</p>
        <div class="good-options">
          <button v-for="g in data.active_goods" :key="g" class="good-btn" @click="pirateBoard(g)">{{ g }}</button>
          <button class="btn-outline" @click="piratePass">不劫持</button>
        </div>
      </div>

      <!-- 海盗踢人 -->
      <div v-else-if="kind === 'pirate_kick'" class="action-panel">
        <h4>☠️ 踢出船员</h4>
        <p>目标: {{ data.target_good }}</p>
        <div v-if="data.ship" class="options">
          <button v-for="(slot, i) in data.ship.slots" :key="i" :disabled="!slot.worker"
                  class="slot-btn" @click="pirateKick(i)">
            位{{ i+1 }}: {{ slot.worker || '空' }}
          </button>
        </div>
      </div>

      <!-- 海盗目的地 -->
      <div v-else-if="kind === 'pirate_dest'" class="action-panel">
        <h4>☠️ 选择劫持目的地</h4>
        <p>当前位置: {{ data.current_pos }}, 航道长度: {{ data.track_len }}</p>
        <div class="options">
          <button v-for="pos in data.track_len" :key="pos" class="btn-sm" :disabled="pos <= data.current_pos"
                  @click="pirateDest(pos)">
            {{ pos }}
          </button>
        </div>
      </div>

      <!-- 通用 fallback -->
      <div v-else class="action-panel">
        <h4>🎯 {{ kind }}</h4>
        <pre class="fallback-data">{{ JSON.stringify(data, null, 2) }}</pre>
        <div v-if="data?.options" class="options">
          <button v-for="(opt, i) in data.options" :key="i" class="btn-primary" @click="respond(opt.value ?? opt)">
            {{ opt.label || opt }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manila { display: flex; flex-direction: column; gap: 1rem; }
.phase-bar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.phase { background: var(--accent); color: #fff; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; }
.sub { color: var(--text-muted); }
.goods-info { font-size: 0.85rem; color: var(--text-muted); }
.good-tag { display: inline-block; background: #2a3a5a; color: #7ab; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.8rem; margin: 0 0.2rem; }

.game-layout { display: grid; grid-template-columns: 1fr 280px; gap: 1rem; }
@media (max-width: 900px) { .game-layout { grid-template-columns: 1fr; } }

/* Ships */
.ship-list { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.5rem; }
.ship-row { display: flex; flex-direction: column; gap: 0.3rem; padding: 0.5rem; background: var(--bg); border-radius: 6px; }
.ship-label { display: flex; align-items: center; gap: 0.5rem; }
.ship-pos { font-size: 0.85rem; color: var(--text-muted); }
.docked { color: var(--success); font-size: 0.8rem; }
.hijacked { color: var(--danger); font-size: 0.8rem; }
.ship-slots { display: flex; gap: 0.3rem; }
.ship-slot { padding: 0.3rem 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; font-size: 0.75rem; text-align: center; min-width: 60px; }
.ship-slot.occupied { border-color: var(--accent); }

/* Board */
.board-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-top: 0.5rem; }
.board-area h5 { margin-bottom: 0.3rem; color: var(--text-muted); font-size: 0.8rem; }
.area-slots { display: flex; flex-direction: column; gap: 0.2rem; }
.b-slot { font-size: 0.8rem; padding: 0.2rem 0.5rem; background: var(--bg); border-radius: 4px; display: flex; gap: 0.4rem; align-items: center; }
.b-slot.occupied { border-left: 2px solid var(--accent); }
.slot-label { font-weight: bold; }
.profit { color: var(--success); }
.move { color: var(--accent); }
.worker-name { color: var(--accent); margin-left: auto; }

/* Market */
.market-list { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.5rem; }
.market-row { display: flex; align-items: center; gap: 0.5rem; }
.price { font-weight: bold; color: #d4a017; }

/* Players */
.player-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; }
.player-row.me { color: var(--accent); }
.stocks { display: flex; gap: 0.3rem; }

/* Request panel */
.request { border: 2px solid var(--accent); background: rgba(74,144,226,0.05); animation: pulse 2s infinite; }
.action-panel h4 { margin-bottom: 0.5rem; }
.action-panel p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }

.bid-controls { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.bid-input { width: 80px; text-align: center; }
.btn-sm { padding: 0.3rem 0.6rem; border-radius: 4px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text); cursor: pointer; }
.btn-sm:hover { border-color: var(--accent); }
.btn-primary { padding: 0.4rem 0.8rem; background: var(--accent); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.btn-primary:hover { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-outline { padding: 0.4rem 0.8rem; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 6px; cursor: pointer; }
.btn-outline:hover { border-color: var(--accent); }

.stock-options, .good-options, .options { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.stock-btn, .good-btn { padding: 0.5rem 0.8rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; color: var(--text); }
.stock-btn:hover, .good-btn:hover { border-color: var(--accent); }
.stock-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.placement-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.placement-row select { padding: 0.3rem; border-radius: 4px; }

.deploy-sections { display: flex; flex-direction: column; gap: 0.8rem; }
.deploy-group h5 { margin-bottom: 0.3rem; color: var(--text-muted); }
.deploy-ship { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem; flex-wrap: wrap; }
.deploy-area { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.2rem; flex-wrap: wrap; }
.slot-btn { padding: 0.3rem 0.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 0.8rem; color: var(--text); }
.slot-btn:hover:not(:disabled) { border-color: var(--accent); }
.slot-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.nav-controls { display: flex; flex-direction: column; gap: 0.5rem; }
.nav-row { display: flex; align-items: center; gap: 0.3rem; }
.nav-queue { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.nav-item { padding: 0.2rem 0.5rem; background: var(--accent); color: #fff; border-radius: 4px; font-size: 0.8rem; cursor: pointer; }

.fallback-data { font-size: 0.75rem; max-height: 150px; overflow: auto; background: #111; padding: 0.5rem; border-radius: 4px; }

@keyframes pulse { 0%,100% { border-color: var(--accent); } 50% { border-color: rgba(74,144,226,0.4); } }
</style>

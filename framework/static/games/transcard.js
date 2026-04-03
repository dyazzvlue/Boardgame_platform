/* static/games/transcard.js — TransCard (转牌) 游戏渲染器 */

const _TC_SUIT_SYMBOL = {spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣'};
const _TC_SUIT_COLOR  = {spades:'#eee', hearts:'#e94560', diamonds:'#e94560', clubs:'#eee'};
const _TC_ACTION_NAME = {
  draw_deck:'抽牌(牌库)', draw_player:'盲抽(玩家)',
  return_draw:'换牌', play_cards:'出牌',
};
const _TC_COMBO_NAME = {same:'相同', straight:'顺子', flush_straight:'同花顺', single:'单打'};

class TransCardRenderer {
  constructor(container, myIdx, respond) {
    this.myIdx = myIdx;
    this.respond = respond;
    this.state = null;
    this.myHand = [];               // 从 ask 请求中获取本人手牌
    this.selectedUids = new Set();

    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = 'display:flex;flex-direction:column;gap:.75rem;width:100%;';
    container.appendChild(this.wrapper);

    // 信息区
    this.infoDiv = document.createElement('div');
    this.infoDiv.style.cssText = 'padding:.6rem;background:#16213e;border-radius:10px;color:#eee;font-size:.9rem;';
    this.wrapper.appendChild(this.infoDiv);

    // 玩家区
    this.playersDiv = document.createElement('div');
    this.playersDiv.style.cssText = 'display:flex;gap:.6rem;flex-wrap:wrap;';
    this.wrapper.appendChild(this.playersDiv);

    // 手牌区
    this.handLabel = document.createElement('div');
    this.handLabel.style.cssText = 'color:#f0c040;font-weight:bold;font-size:.95rem;';
    this.handLabel.textContent = '我的手牌';
    this.wrapper.appendChild(this.handLabel);

    this.handDiv = document.createElement('div');
    this.handDiv.style.cssText = 'display:flex;gap:.35rem;flex-wrap:wrap;min-height:60px;';
    this.wrapper.appendChild(this.handDiv);

    // 操作区
    this.actionDiv = document.createElement('div');
    this.actionDiv.id = 'action-panel';
    this.actionDiv.style.cssText = 'padding:.9rem;background:#16213e;border-radius:12px;min-height:50px;width:100%;';
    this.wrapper.appendChild(this.actionDiv);
  }

  // ── 框架回调 ───────────────────────────────────────────────

  onState(ctx) {
    this.state = ctx;
    this._renderInfo();
    this._renderPlayers();
  }

  onRequest(playerIdx, kind, data) {
    if (playerIdx !== this.myIdx) {
      this.actionDiv.innerHTML = `<span style="color:#888">等待玩家操作...</span>`;
      return;
    }
    // 更新手牌
    if (data && data.hand) {
      this.myHand = data.hand;
      this.selectedUids.clear();
      this._renderHand();
    }
    this._renderActionUI(kind, data);
  }

  onGameOver(result) {
    this.actionDiv.innerHTML = '<h3 style="color:#f0c040">游戏结束！</h3>' +
      `<div style="color:#aaa;margin:.3rem 0">${result.reason || ''}</div>` +
      (result.rankings || []).map((r,i) =>
        `<div style="color:${i===0?'#f0c040':'#eee'}">${r.rank}. ${r.name} — ${r.score}分 (${r.combos}个牌型, 剩余${r.hand_remaining}张)</div>`
      ).join('');
  }

  // ── 信息渲染 ───────────────────────────────────────────────

  _renderInfo() {
    if (!this.state) { this.infoDiv.textContent = '等待...'; return; }
    const s = this.state;
    const phase = s.game_over ? '已结束' : '进行中';
    this.infoDiv.innerHTML =
      `<span style="color:#f0c040;font-weight:bold">第 ${s.turn+1} 轮</span> · ` +
      `牌库 <b>${s.deck_remaining}</b> 张 · 弃牌堆 <b>${s.discard_count}</b> 张 · ` +
      `<span style="color:#888">${phase}</span>`;
  }

  _renderPlayers() {
    this.playersDiv.innerHTML = '';
    if (!this.state) return;
    (this.state.players || []).forEach((p,i) => {
      const isMe = i === this.myIdx;
      const isCurrent = i === this.state.current_idx;
      const card = document.createElement('div');
      card.style.cssText = `padding:.5rem .7rem;background:${isCurrent?'#1a3a6a':'#0f1b38'};border:2px solid ${isMe?'#f0c040':isCurrent?'#4488cc':'#333'};border-radius:10px;min-width:120px;`;

      const tag = p.is_human ? '' : '🤖';
      let html = `<div style="color:${isMe?'#f0c040':'#eee'};font-weight:bold">${tag}${p.name}${isMe?' (我)':''}</div>`;
      html += `<div style="color:#aaa;font-size:.8rem">手牌: ${p.hand_size} · 得分: ${p.total_score}</div>`;

      // 已出牌型
      if (p.scored && p.scored.length > 0) {
        html += '<div style="margin-top:.3rem;font-size:.75rem;color:#8ab4f8">';
        p.scored.forEach(s => {
          html += `<div>${_TC_COMBO_NAME[s.type]||s.type}: ${s.cards.map(c=>c.name).join(' ')} → ${s.score}分</div>`;
        });
        html += '</div>';
      }
      card.innerHTML = html;
      this.playersDiv.appendChild(card);
    });
  }

  // ── 手牌渲染 ───────────────────────────────────────────────

  _renderHand() {
    this.handDiv.innerHTML = '';
    this.myHand.forEach(c => {
      const el = document.createElement('div');
      const selected = this.selectedUids.has(c.uid);
      const color = c.is_joker ? (c.rank === 15 ? '#e94560' : '#888') : (_TC_SUIT_COLOR[c.suit] || '#eee');
      el.style.cssText = `
        cursor:pointer; padding:.4rem .5rem; border-radius:8px;
        border:2px solid ${selected ? '#f0c040' : '#444'};
        background:${selected ? '#2a3a5a' : '#0f1b38'};
        color:${color}; font-size:.95rem; font-weight:bold;
        min-width:36px; text-align:center; user-select:none;
        transition: border-color .15s, transform .1s;
        transform: ${selected ? 'translateY(-4px)' : 'none'};
      `;
      el.textContent = c.name;
      el.title = c.name;
      el.onclick = () => {
        if (this.selectedUids.has(c.uid)) this.selectedUids.delete(c.uid);
        else this.selectedUids.add(c.uid);
        this._renderHand();
      };
      this.handDiv.appendChild(el);
    });
  }

  // ── 操作面板 ───────────────────────────────────────────────

  _renderActionUI(kind, data) {
    const d = this.actionDiv;
    d.innerHTML = '';

    if (kind === 'choose_action') {
      const h = document.createElement('div');
      h.style.cssText = 'color:#f0c040;font-weight:bold;margin-bottom:.5rem';
      h.textContent = '选择行动';
      d.appendChild(h);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap';
      (data.available || []).forEach(a => {
        const btn = document.createElement('button');
        btn.textContent = _TC_ACTION_NAME[a] || a;
        btn.onclick = () => this.respond('choose_action', a);
        row.appendChild(btn);
      });
      d.appendChild(row);

    } else if (kind === 'select_cards') {
      const h = document.createElement('div');
      h.style.cssText = 'color:#f0c040;font-weight:bold;margin-bottom:.5rem';
      h.textContent = data.purpose || '选择卡牌';
      if (data.n) h.textContent += ` (选 ${data.n} 张)`;
      d.appendChild(h);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center';

      const btnConfirm = document.createElement('button');
      btnConfirm.textContent = '确认选择';
      btnConfirm.onclick = () => {
        this.respond('select_cards', Array.from(this.selectedUids));
        this.selectedUids.clear();
        this._renderHand();
      };
      row.appendChild(btnConfirm);

      const btnCancel = document.createElement('button');
      btnCancel.className = 'secondary';
      btnCancel.textContent = '放弃';
      btnCancel.onclick = () => {
        this.selectedUids.clear();
        this._renderHand();
        this.respond('select_cards', []);
      };
      row.appendChild(btnCancel);

      d.appendChild(row);

    } else if (kind === 'select_player') {
      const h = document.createElement('div');
      h.style.cssText = 'color:#f0c040;font-weight:bold;margin-bottom:.5rem';
      h.textContent = data.prompt || '选择一位玩家';
      d.appendChild(h);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap';
      (data.candidates || []).forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'secondary';
        btn.textContent = `${c.name} (${c.hand_size}张)`;
        btn.onclick = () => this.respond('select_player', c.idx);
        row.appendChild(btn);
      });
      d.appendChild(row);

    } else {
      d.textContent = `等待操作: ${kind}`;
    }
  }
}

// 注册到全局渲染器表
_RENDERERS['transcard'] = TransCardRenderer;

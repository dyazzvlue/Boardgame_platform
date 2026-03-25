function _igEl(tag, attrs = null, text = null) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'style') el.style.cssText = value;
      else if (key === 'className') el.className = value;
      else if (key === 'html') el.innerHTML = value;
      else el[key] = value;
    }
  }
  if (text !== null && text !== undefined) el.textContent = text;
  return el;
}

class IncanGoldRenderer {
  constructor(container, myIdx, respond) {
    this.container = container;
    this.myIdx = myIdx;
    this.respond = respond;
    this.state = null;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:14px;color:#f2ebd4;background:linear-gradient(180deg,#1c1409,#2f2210);min-height:560px;font-family:"Trebuchet MS","Microsoft YaHei",sans-serif;';
    this.header = _igEl('div', {style:'padding:12px 14px;border-radius:12px;background:#3a2810;box-shadow:inset 0 0 0 1px rgba(255,220,150,.18);'});
    this.path = _igEl('div', {style:'display:flex;gap:10px;flex-wrap:wrap;min-height:132px;padding:10px;border-radius:12px;background:#2a1d0e;'});
    this.players = _igEl('div', {style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;'});
    this.action = _igEl('div', {style:'padding:12px;border-radius:12px;background:#2a1d0e;min-height:88px;'});
    this.container.appendChild(this.header);
    this.container.appendChild(this.path);
    this.container.appendChild(this.players);
    this.container.appendChild(this.action);
  }

  onState(ctx) {
    this.state = ctx;
    this._renderHeader(ctx);
    this._renderPath(ctx);
    this._renderPlayers(ctx);
  }

  onRequest(playerIdx, kind, data) {
    if (kind !== 'explore_or_return') {
      this.action.innerHTML = '<span style="color:#b59c79">等待下一次操作…</span>';
      return;
    }
    if (playerIdx !== this.myIdx) {
      const name = (this.state && this.state.players && this.state.players[playerIdx]) ? this.state.players[playerIdx].name : `玩家${playerIdx}`;
      this.action.innerHTML = `<div style="font-size:18px;color:#d8c092;">等待 ${name} 决定是否继续探索…</div>`;
      return;
    }
    const btns = _igEl('div', {style:'display:flex;gap:10px;flex-wrap:wrap;align-items:center;'});
    const btnGo = _igEl('button', {style:'padding:12px 18px;border:none;border-radius:10px;background:#2e8b57;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;'}, '🏛️ 继续探索');
    const btnLeave = _igEl('button', {style:'padding:12px 18px;border:none;border-radius:10px;background:#b14545;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;'}, '🏕️ 返回营地');
    btnGo.onclick = () => this.respond('explore_or_return', true);
    btnLeave.onclick = () => this.respond('explore_or_return', false);
    this.action.innerHTML = '';
    this.action.appendChild(_igEl('div', {style:'margin-bottom:10px;color:#f0d9a7;font-size:18px;'}, '这一步你要继续深入，还是见好就收？'));
    this.action.appendChild(btns);
    btns.appendChild(btnGo);
    btns.appendChild(btnLeave);
  }

  onGameOver(result) {
    const rankings = (result && result.rankings) || [];
    let html = '<div style="font-size:20px;color:#f4d488;font-weight:bold;margin-bottom:8px;">游戏结束</div>';
    rankings.forEach((row, index) => {
      html += `<div style="padding:6px 0;color:#f2ebd4;">${index + 1}. ${row.name} - 总分 ${row.total_score}（帐篷 ${row.tent_gems} / 神器 ${row.artifact_score}）</div>`;
    });
    this.action.innerHTML = html;
  }

  _renderHeader(ctx) {
    const hazards = (ctx.hazards_seen_labels || []).join('、') || '无';
    const artifacts = (ctx.artifacts_on_path || []).join('、') || '无';
    this.header.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;"><span style="font-size:22px;font-weight:bold;color:#f4d488;">印加宝藏</span><span>第 ${ctx.round_num || 0}/5 轮</span><span>阶段：${ctx.phase || 'setup'}</span><span>路径散宝石：${ctx.table_gems || 0}</span><span>场上神器：${artifacts}</span><span>已见灾难：${hazards}</span></div>`;
  }

  _renderPath(ctx) {
    this.path.innerHTML = '';
    const cards = ctx.revealed_cards || [];
    if (!cards.length) {
      this.path.appendChild(_igEl('div', {style:'color:#b59c79;align-self:center;'}, '本轮路径还是空的。'));
      return;
    }
    cards.forEach(card => {
      const color = card.kind === 'treasure' ? '#8c6422' : card.kind === 'artifact' ? '#69408f' : '#7f2f2f';
      const title = card.kind === 'treasure' ? `宝藏 ${card.value}` : card.kind === 'artifact' ? `神器 ${card.value}` : (card.label || card.hazard_type || '灾难');
      const sub = card.kind === 'treasure' ? `余数 ${card.leftover || 0}` : card.kind === 'hazard' ? '小心重复灾难' : '唯一返回者可取走';
      const box = _igEl('div', {style:`width:98px;min-height:112px;border-radius:12px;background:${color};padding:10px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);display:flex;flex-direction:column;justify-content:space-between;`});
      box.appendChild(_igEl('div', {style:'font-size:16px;font-weight:bold;'}, title));
      box.appendChild(_igEl('div', {style:'font-size:12px;color:#f5e9cc;opacity:.9;'}, sub));
      this.path.appendChild(box);
    });
  }

  _renderPlayers(ctx) {
    this.players.innerHTML = '';
    (ctx.players || []).forEach(player => {
      const exploring = !!player.exploring;
      const border = exploring ? '#5ea56f' : '#8f7b59';
      const card = _igEl('div', {style:`padding:12px;border-radius:12px;background:#2f2314;box-shadow:inset 0 0 0 1px ${border};`});
      let badges = '';
      if (player.idx === this.myIdx) badges += '<span style="display:inline-block;margin-right:6px;padding:2px 8px;border-radius:999px;background:#155e75;color:#d8f6ff;font-size:12px;">你</span>';
      if (!player.is_human) badges += '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#444;color:#eee;font-size:12px;">AI</span>';
      card.innerHTML = `<div style="font-size:18px;font-weight:bold;margin-bottom:6px;">${player.name}</div><div style="margin-bottom:8px;">${badges}</div><div>帐篷宝石：${player.tent_gems}</div><div>本轮宝石：${player.round_gems}</div><div>神器分：${player.artifact_score}</div><div style="margin-top:8px;color:${exploring ? '#7fe39a' : '#d8c092'};">${exploring ? '探索中' : '已返回'}</div>`;
      this.players.appendChild(card);
    });
  }
}

if (typeof _RENDERERS !== 'undefined') _RENDERERS['incan_gold'] = IncanGoldRenderer;

/* static/games/manila.js — Manila 游戏渲染器 */
class ManilaRenderer {
  constructor(container, myIdx, respond) {
    this.myIdx = myIdx;
    this.respond = respond;
    this.state = null;
    this.pendingKind = null;
    this.pendingData = null;

    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = 'display:flex;flex-direction:column;gap:.75rem;width:100%;';
    container.appendChild(this.wrapper);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 900; this.canvas.height = 620;
    this.canvas.style.cssText = 'width:100%;max-width:900px;height:auto;align-self:center;';
    this.wrapper.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.actionDiv = document.createElement('div');
    this.actionDiv.id = 'action-panel';
    this.actionDiv.style.cssText = 'padding:.9rem;background:#16213e;border-radius:12px;min-height:60px;width:100%;overflow:auto';
    this.wrapper.appendChild(this.actionDiv);
  }

  onState(ctx) {
    this.state = ctx;
    this.render();
  }

  onRequest(playerIdx, kind, data) {
    if (playerIdx !== this.myIdx) {
      this.actionDiv.innerHTML = `<span style="color:#888">等待玩家 ${data.player_idx ?? playerIdx} 操作...</span>`;
      return;
    }
    this.pendingKind = kind;
    this.pendingData = data;
    this.renderActionUI(kind, data);
  }

  onGameOver(result) {
    this.actionDiv.innerHTML = '<h3 style="color:#f0c040">游戏结束！</h3>' +
      (result.ranking || []).map((r,i) => `<div>${i+1}. ${r.name} — ¥${r.worth}</div>`).join('');
  }

  // ── Canvas 渲染 ─────────────────────────────────────────────────────────
  render() {
    const cx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    cx.fillStyle = '#0a0a1e'; cx.fillRect(0,0,W,H);
    if (!this.state) { cx.fillStyle='#aaa'; cx.font='16px sans-serif'; cx.fillText('等待游戏状态...',20,30); return; }
    const s = this.state;
    this._drawPhase(cx, s);
    this._drawShips(cx, s);
    this._drawBoard(cx, s);
    this._drawMarket(cx, s);
    this._drawPlayers(cx, s);
  }

  _drawPhase(cx, s) {
    cx.fillStyle='#f0c040'; cx.font='bold 15px sans-serif';
    cx.fillText(`第 ${s.round_num} 大轮${s.sub_round ? ' · 小轮'+s.sub_round : ''} — ${s.phase||''}`, 10, 22);
  }

  _drawShips(cx, s) {
    const TRACK_W = 560, TRACK_X = 10, SHIP_Y = 40;
    const colors = {nutmeg:'#b87333',silk:'#4488cc',ginseng:'#d4b800',jade:'#3cb371'};
    const names  = {nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
    // 只显示本轮参与运输的货船（active_goods）
    const activeGoods = s.active_goods || ['nutmeg','silk','ginseng','jade'];

    activeGoods.forEach((g, i) => {
      const ship = (s.ships||{})[g];
      const y = SHIP_Y + i * 72;
      // 轨道
      cx.fillStyle='#1a2a4a'; cx.fillRect(TRACK_X, y, TRACK_W, 60);
      cx.strokeStyle='#333'; cx.strokeRect(TRACK_X, y, TRACK_W, 60);
      // 刻度
      for (let t=0; t<=13; t++) {
        const tx = TRACK_X + t * (TRACK_W/13);
        cx.strokeStyle = t===13 ? '#f0c040' : '#2a3a5a';
        cx.beginPath(); cx.moveTo(tx, y); cx.lineTo(tx, y+60); cx.stroke();
      }
      // 标签
      cx.fillStyle = colors[g]||'#aaa'; cx.font='12px sans-serif';
      cx.fillText(names[g], TRACK_X+2, y+12);
      if (!ship) return;
      // 船身（clamp 保证 position=0 时完整可见）
      const rawSx = TRACK_X + ship.position * (TRACK_W/13);
      const sx    = Math.max(TRACK_X + 14, Math.min(rawSx, TRACK_X + TRACK_W - 14));
      cx.fillStyle = ship.docked_at ? '#888' : (colors[g]||'#aaa');
      cx.fillRect(sx-14, y+15, 28, 30);
      cx.fillStyle='#fff'; cx.font='10px sans-serif';
      cx.fillText(`@${ship.position}`, sx-10, y+50);
      // 槽位工人
      (ship.slots||[]).forEach((slot, si) => {
        const sw = sx - 10 + si*12;
        cx.fillStyle = slot.worker ? '#e94560' : '#2a4a6a';
        cx.fillRect(sw, y+18, 10, 10);
        if (slot.worker) { cx.fillStyle='#fff'; cx.font='7px sans-serif'; cx.fillText(slot.worker[0]||'?', sw+2, y+27); }
      });
      // 铭牌
      if (ship.docked_at) { cx.fillStyle='#f0c040'; cx.font='9px sans-serif'; cx.fillText(ship.docked_at, sx-10, y+40); }
    });
  }

  _drawBoard(cx, s) {
    if (!s.board) return;
    const bx=10, by=340;
    cx.fillStyle='#16213e'; cx.fillRect(bx,by,560,100);
    cx.fillStyle='#f0c040'; cx.font='bold 12px sans-serif'; cx.fillText('棋盘',bx+4,by+14);
    const sections = [
      {label:'港口', slots:s.board.port, color:'#3cb371'},
      {label:'造船厂', slots:s.board.shipyard, color:'#4488cc'},
      {label:'海盗', slots:s.board.pirate, color:'#e94560'},
      {label:'领航员', slots:s.board.navigator, color:'#cf9aee'},
    ];
    let sx=bx+6;
    sections.forEach(sec => {
      cx.fillStyle=sec.color; cx.font='10px sans-serif'; cx.fillText(sec.label, sx, by+28);
      (sec.slots||[]).forEach((slot,i) => {
        cx.fillStyle = slot.worker ? '#e94560' : '#2a4060';
        cx.fillRect(sx+i*18, by+32, 16, 16);
        if (slot.worker) { cx.fillStyle='#fff'; cx.font='8px sans-serif'; cx.fillText(slot.worker[0], sx+i*18+3, by+44); }
      });
      sx += 6 + ((sec.slots||[]).length)*20;
    });
    // 保险
    cx.fillStyle='#ffa500'; cx.font='10px sans-serif'; cx.fillText('保险', sx, by+28);
    cx.fillStyle = s.board.insurance ? '#e94560' : '#2a4060';
    cx.fillRect(sx, by+32, 16, 16);
    if (s.board.insurance) { cx.fillStyle='#fff'; cx.font='8px sans-serif'; cx.fillText(s.board.insurance[0], sx+3, by+44); }
  }

  _drawMarket(cx, s) {
    if (!s.market) return;
    const mx=580, my=40;
    cx.fillStyle='#16213e'; cx.fillRect(mx,my,310,160);
    cx.fillStyle='#f0c040'; cx.font='bold 12px sans-serif'; cx.fillText('市场股价',mx+4,my+16);
    const goods=['nutmeg','silk','ginseng','jade'];
    const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
    const colors={nutmeg:'#b87333',silk:'#4488cc',ginseng:'#d4b800',jade:'#3cb371'};
    goods.forEach((g,i) => {
      const price = s.market.prices[g]||0;
      const bank  = s.market.bank_stocks[g]||0;
      const gy = my+32+i*30;
      cx.fillStyle=colors[g]; cx.font='12px sans-serif'; cx.fillText(names[g], mx+6, gy+12);
      // 价格条
      const bw = Math.min(price/30, 1) * 160;
      cx.fillStyle='#2a4060'; cx.fillRect(mx+62, gy, 160, 18);
      cx.fillStyle=colors[g]; cx.fillRect(mx+62, gy, bw, 18);
      cx.fillStyle='#fff'; cx.font='11px sans-serif'; cx.fillText(`¥${price}`, mx+232, gy+13);
      cx.fillStyle='#aaa'; cx.fillText(`银行:${bank}`, mx+262, gy+13);
    });
  }

  _drawPlayers(cx, s) {
    const px=580, py=215;
    cx.fillStyle='#16213e'; cx.fillRect(px,py,310,170);
    cx.fillStyle='#f0c040'; cx.font='bold 12px sans-serif'; cx.fillText('玩家状态',px+4,py+16);
    (s.players||[]).forEach((p,i) => {
      const gy = py+28+i*32;
      const isMe = i===this.myIdx;
      cx.fillStyle = isMe ? '#f0c040' : (p.is_harbor_master ? '#e94560' : '#eee');
      cx.font = (isMe?'bold ':'')+'12px sans-serif';
      const tag = p.is_harbor_master ? '👑' : (p.is_human ? '' : '🤖');
      cx.fillText(`${tag}${p.name}`, px+6, gy+13);
      cx.fillStyle='#aaa'; cx.font='11px sans-serif';
      cx.fillText(`¥${p.money}  工人:${p.workers_available}/${p.workers_total}`, px+6, gy+25);
      // 股票小方块
      const goods=['nutmeg','silk','ginseng','jade'];
      const colors={nutmeg:'#b87333',silk:'#4488cc',ginseng:'#d4b800',jade:'#3cb371'};
      let sx2=px+180;
      goods.forEach(g=>{
        const cnt=p.stocks[g]||0;
        for(let k=0;k<cnt;k++){
          cx.fillStyle=colors[g]; cx.fillRect(sx2,gy+3,8,8); sx2+=9;
        }
      });
    });
  }

  // ── 操作面板 ────────────────────────────────────────────────────────────
  renderActionUI(kind, data) {
    const d = this.actionDiv;
    d.innerHTML = '';
    const h = document.createElement('div');
    h.style.cssText='color:#f0c040;font-weight:bold;margin-bottom:.4rem';

    if (kind === 'bid') {
      h.textContent = `竞价 (当前: ¥${data.current_bid}, 最低: ¥${data.min_bid})`;
      d.appendChild(h);
      const row = document.createElement('div');
      row.style.cssText='display:flex;gap:.5rem;flex-wrap:wrap;align-items:center';
      const inp = document.createElement('input');
      inp.type='number'; inp.min=data.min_bid; inp.value=data.min_bid;
      inp.style.cssText='width:min(100%,90px);background:#0f3460;color:#eee;border:1px solid #444;padding:.55rem;border-radius:8px';
      row.appendChild(inp);
      const btnBid = document.createElement('button');
      btnBid.textContent='出价'; btnBid.onclick=()=>this.respond('bid', parseInt(inp.value)||0);
      const btnPass = document.createElement('button');
      btnPass.className='secondary'; btnPass.textContent='放弃'; btnPass.onclick=()=>this.respond('bid',0);
      row.appendChild(btnBid); row.appendChild(btnPass);
      d.appendChild(row);

    } else if (kind === 'choose_goods') {
      h.textContent='选择排除的货物（该货物本轮不运输）';
      d.appendChild(h);
      const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.5rem';
      (data.goods||[]).forEach(g=>{
        const btn=document.createElement('button');
        btn.className='secondary'; btn.textContent=names[g]||g;
        btn.onclick=()=>this.respond('choose_goods', g);
        row.appendChild(btn);
      });
      d.appendChild(row);

    } else if (kind === 'ship_placement') {
      h.textContent=`分配货船起始位置（总和 = ${9}，每艘 0–5）`;
      d.appendChild(h);
      const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
      const vals = {};
      (data.active_goods||[]).forEach(g=>vals[g]=Math.floor(9/(data.n_ships||3)));
      const form = document.createElement('div'); form.style.cssText='display:flex;gap:.6rem;flex-wrap:wrap';
      const inputs = {};
      (data.active_goods||[]).forEach(g=>{
        const lbl=document.createElement('label'); lbl.style.cssText='color:#aaa;font-size:.9rem;display:flex;align-items:center;gap:.3rem';
        const inp=document.createElement('input'); inp.type='number'; inp.min=0; inp.max=5; inp.value=vals[g];
        inp.style.cssText='width:min(100%,64px);background:#0f3460;color:#eee;border:1px solid #444;padding:.45rem;border-radius:8px';
        inp.id='placement_'+g; inputs[g]=inp;
        lbl.textContent=names[g]||g; lbl.appendChild(inp); form.appendChild(lbl);
      });
      d.appendChild(form);
      const btn=document.createElement('button'); btn.textContent='确认';
      btn.onclick=()=>{
        const result={};
        Object.keys(inputs).forEach(g=>result[g]=parseInt(inputs[g].value)||0);
        this.respond('ship_placement', result);
      };
      d.appendChild(btn);

    } else if (kind === 'deploy') {
      h.textContent='派遣工人';
      d.appendChild(h);
      const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.4rem;flex-wrap:wrap';
      // 货船槽：只显示 active_goods 中的船，且每船只展示第一个可放置的空槽
      const activeGoods = data.active_goods || Object.keys(data.ships||{});
      activeGoods.forEach(g=>{
        const ship = (data.ships||{})[g];
        if (!ship) return;
        // 找第一个空槽（必须从槽0开始连续放）
        const firstEmpty = (ship.slots||[]).findIndex(slot => !slot.worker);
        if (firstEmpty === -1) return;  // 全满，跳过
        const slot = ship.slots[firstEmpty];
        const btn=document.createElement('button'); btn.className='secondary';
        btn.textContent=`${names[g]||g} 槽${firstEmpty+1}(¥${slot.cost})`;
        btn.onclick=()=>this.respond('deploy', {type:'ship', good:g, slot:firstEmpty});
        row.appendChild(btn);
      });
      // 棋盘位置
      const board=data.board||{};
      ['port','shipyard','pirate','navigator'].forEach(pos=>{
        const bnames={port:'港口',shipyard:'造船厂',pirate:'海盗',navigator:'领航员'};
        (board[pos]||[]).forEach((slot,si)=>{
          if (slot.worker) return;
          const btn=document.createElement('button'); btn.className='secondary';
          btn.textContent=`${bnames[pos]}${slot.label}(¥${slot.cost})`;
          btn.onclick=()=>this.respond('deploy', {type:pos, slot:si});
          row.appendChild(btn);
        });
      });
      if (board.insurance===null||board.insurance===undefined) {
        const btn=document.createElement('button'); btn.className='secondary';
        btn.textContent='保险(¥0)'; btn.onclick=()=>this.respond('deploy',{type:'insurance'});
        row.appendChild(btn);
      }
      const btnPass=document.createElement('button'); btnPass.textContent='放弃';
      btnPass.onclick=()=>this.respond('deploy', null);
      row.appendChild(btnPass);
      d.appendChild(row);

    } else if (kind === 'buy_stock') {
      h.textContent='是否购买股票？';
      d.appendChild(h);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.5rem;flex-wrap:wrap';
      const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
      const prices=(data.market||{}).prices||{}; const bank=(data.market||{}).bank_stocks||{};
      Object.entries(prices).forEach(([g,p])=>{
        if (!(bank[g]>0)) return;
        const price=Math.max(p,5);
        if (price>data.player_money) return;
        const btn=document.createElement('button'); btn.className='secondary';
        btn.textContent=`${names[g]||g} ¥${price}`; btn.onclick=()=>this.respond('buy_stock',g);
        row.appendChild(btn);
      });
      const btnNo=document.createElement('button'); btnNo.textContent='不购买';
      btnNo.onclick=()=>this.respond('buy_stock',null);
      row.appendChild(btnNo); d.appendChild(row);

    } else if (kind === 'navigator_moves') {
      h.textContent=`领航员移动 (步数: ${data.move_steps})`;
      d.appendChild(h);
      const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
      const moves=[];
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.4rem;flex-wrap:wrap';
      (data.undocked_goods||[]).forEach(g=>{
        [-data.move_steps, data.move_steps].forEach(step=>{
          const btn=document.createElement('button'); btn.className='secondary';
          btn.textContent=`${names[g]||g} ${step>0?'+':''}${step}`;
          btn.onclick=()=>{ moves.push({good:g,step}); btn.disabled=true; btn.style.opacity='.4'; checkDone(); };
          row.appendChild(btn);
        });
      });
      d.appendChild(row);
      const btnDone=document.createElement('button'); btnDone.textContent='确认';
      btnDone.onclick=()=>this.respond('navigator_moves', moves);
      d.appendChild(btnDone);
      function checkDone(){}

    } else if (kind === 'pirate_board') {
      h.textContent='海盗：选择登船目标（或放弃）';
      d.appendChild(h);
      const names={nutmeg:'肉豆蔻',silk:'丝绸',ginseng:'人参',jade:'玉'};
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.5rem';
      (data.active_goods||[]).forEach(g=>{
        const btn=document.createElement('button'); btn.className='secondary';
        btn.textContent=names[g]||g; btn.onclick=()=>this.respond('pirate_board',g);
        row.appendChild(btn);
      });
      const btnNo=document.createElement('button'); btnNo.textContent='放弃';
      btnNo.onclick=()=>this.respond('pirate_board',null);
      row.appendChild(btnNo); d.appendChild(row);

    } else if (kind === 'pirate_kick') {
      h.textContent='踢出哪个槽位的工人？';
      d.appendChild(h);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.5rem';
      (data.ship.slots||[]).forEach((slot,i)=>{
        if (!slot.worker) return;
        const btn=document.createElement('button'); btn.className='secondary';
        btn.textContent=`槽${i+1}: ${slot.worker}`; btn.onclick=()=>this.respond('pirate_kick',i);
        row.appendChild(btn);
      });
      d.appendChild(row);

    } else if (kind === 'pirate_dest') {
      h.textContent='将货船送往？';
      d.appendChild(h);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:.5rem';
      ['port','shipyard'].forEach(dest=>{
        const btn=document.createElement('button'); btn.className='secondary';
        btn.textContent=dest==='port'?'港口':'造船厂';
        btn.onclick=()=>this.respond('pirate_dest', dest==='port'?data.track_len:0);
        row.appendChild(btn);
      });
      d.appendChild(row);

    } else {
      d.textContent = `等待操作: ${kind}`;
    }
  }
}

if (typeof _RENDERERS !== 'undefined') _RENDERERS['manila'] = ManilaRenderer;

/* static/games/guandan.js — 掼蛋渲染器 (响应式) */
class GuandanRenderer {
  constructor(container, myIdx, respond) {
    this.myIdx = myIdx;
    this.respond = respond;
    this.state = null;
    this.pendingKind = null;
    this.pendingData = null;
    this.selectedUids = new Set();
    this._recommendIdx = 0;

    /* ── 响应式 ── */
    this._isMobile = window.innerWidth < 640;
    var _m = this._isMobile;
    var self = this;
    window.addEventListener('resize', function() {
      self._isMobile = window.innerWidth < 640;
      if (self.state) self.render();
    });

    /* ── 牌桌 ── */
    this.table = document.createElement('div');
    this.table.style.cssText =
      'position:relative;width:100%;max-width:960px;margin:0 auto;' +
      (_m ? 'min-height:100vh;' : 'aspect-ratio:4/3;min-height:600px;') +
      'background:radial-gradient(ellipse at center,#1a3a2a 0%,#0d1b12 100%);' +
      'border-radius:'+(_m?'0':'24px')+';border:'+(_m?'none':'3px solid #2a5a3a')+';' +
      'overflow:hidden;font-family:"Noto Sans SC",sans-serif;color:#eee;user-select:none;';
    container.appendChild(this.table);

    /* ── 信息栏 ── */
    this.infoBar = document.createElement('div');
    this.infoBar.style.cssText =
      'position:absolute;top:0;left:0;right:0;height:'+(_m?'28px':'36px')+';' +
      'display:flex;justify-content:space-between;align-items:center;' +
      'padding:0 '+(_m?'8px':'16px')+';background:rgba(0,0,0,.45);font-size:'+(_m?'11px':'13px')+';z-index:10;';
    this.table.appendChild(this.infoBar);

    /* ── 三方位对手信息 ── */
    this.topSlot = this._mkSlot('top');
    this.leftSlot = this._mkSlot('left');
    this.rightSlot = this._mkSlot('right');

    /* ── 四方位出牌展示 ── */
    this.playZones = {};
    this.playZones.top = this._mkPlayZone('top');
    this.playZones.left = this._mkPlayZone('left');
    this.playZones.right = this._mkPlayZone('right');
    this.playZones.bottom = this._mkPlayZone('bottom');

    /* ── 手牌区 ── */
    this.handArea = document.createElement('div');
    this.handArea.style.cssText =
      'position:absolute;bottom:0;' +
      (_m ? 'left:0;right:0;overflow-x:auto;-webkit-overflow-scrolling:touch;justify-content:flex-start;padding:4px 6px 6px;'
          : 'left:50%;transform:translateX(-50%);justify-content:center;padding:8px 12px 10px;max-width:95%;') +
      'display:flex;align-items:flex-end;z-index:8;';
    this.table.appendChild(this.handArea);

    /* ── 自己信息 ── */
    this.myInfo = document.createElement('div');
    this.myInfo.style.cssText =
      'position:absolute;bottom:'+(_m?'68px':'100px')+';left:50%;transform:translateX(-50%);' +
      'font-size:'+(_m?'11px':'13px')+';text-align:center;z-index:7;color:#ccc;white-space:nowrap;';
    this.table.appendChild(this.myInfo);

    /* ── 操作按钮区 ── */
    this.actionDiv = document.createElement('div');
    this.actionDiv.style.cssText =
      'position:absolute;bottom:'+(_m?'64px':'95px')+';' +
      (_m ? 'left:50%;transform:translateX(-50%);' : 'right:16px;') +
      'display:flex;gap:'+(_m?'5px':'8px')+';align-items:center;z-index:12;';
    this.table.appendChild(this.actionDiv);
  }

  _mkSlot(pos) {
    var d = document.createElement('div');
    var _m = this._isMobile;
    var css = 'position:absolute;display:flex;flex-direction:column;align-items:center;' +
      'gap:'+(_m?'2px':'4px')+';font-size:'+(_m?'11px':'13px')+';z-index:6;';
    if (pos==='top')   css += 'top:'+(_m?'30px':'42px')+';left:50%;transform:translateX(-50%);';
    if (pos==='left')  css += 'top:'+(_m?'28%':'50%')+';left:'+(_m?'4px':'12px')+';transform:translateY(-50%);';
    if (pos==='right') css += 'top:'+(_m?'28%':'50%')+';right:'+(_m?'4px':'12px')+';transform:translateY(-50%);';
    d.style.cssText = css;
    this.table.appendChild(d);
    return d;
  }

  _mkPlayZone(pos) {
    var d = document.createElement('div');
    var _m = this._isMobile;
    var css = 'position:absolute;display:flex;flex-direction:column;align-items:center;' +
      'gap:2px;z-index:5;pointer-events:none;';
    if (pos==='top')    css += 'top:'+(_m?'76px':'110px')+';left:50%;transform:translateX(-50%);';
    if (pos==='left')   css += 'top:'+(_m?'42%':'50%')+';left:'+(_m?'8px':'120px')+';transform:translateY(-50%);';
    if (pos==='right')  css += 'top:'+(_m?'42%':'50%')+';right:'+(_m?'8px':'120px')+';transform:translateY(-50%);';
    if (pos==='bottom') css += 'bottom:'+(_m?'98px':'140px')+';left:50%;transform:translateX(-50%);';
    d.style.cssText = css;
    this.table.appendChild(d);
    return d;
  }

  /* ── 接口 ── */
  onState(ctx) { this.state = ctx; this.render(); }

  onRequest(playerIdx, kind, data) {
    if (playerIdx !== this.myIdx) {
      this.actionDiv.innerHTML = '<span style="color:#aaa;font-size:12px">等待操作...</span>';
      return;
    }
    this.pendingKind = kind;
    this.pendingData = data;
    this.selectedUids.clear();
    this.render();
    this._renderAction(kind, data);
  }

  onGameOver(result) {
    this.actionDiv.innerHTML = '';
    var _m = this._isMobile;
    var ov = document.createElement('div');
    ov.style.cssText =
      'position:absolute;inset:0;background:rgba(0,0,0,.7);display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;z-index:50;border-radius:'+(_m?'0':'24px')+';';
    ov.innerHTML =
      '<div style="font-size:'+(_m?'24px':'36px')+';font-weight:bold;color:#f0c040;margin-bottom:12px">' +
      (result.winner_team||'?') + ' 队获胜！</div>' +
      '<div style="font-size:'+(_m?'13px':'16px')+';color:#ccc">A队: ' + _rn(result.level_a) +
      ' | B队: ' + _rn(result.level_b) + ' | 共 ' + (result.rounds||'?') + ' 局</div>';
    this.table.appendChild(ov);
  }

  /* ── 渲染 ── */
  render() {
    if (!this.state) return;
    var s = this.state;
    this._renderInfo(s);
    this._renderOtherPlayers(s);
    this._renderPlayZones(s);
    this._renderMyHand(s);
    this._renderMyInfo(s);
  }

  _renderInfo(s) {
    var lr = s.level_rank||'?', lA = (s.level&&s.level.A)||'?', lB = (s.level&&s.level.B)||'?';
    this.infoBar.innerHTML =
      '<span>第'+(s.round_num||1)+'局 · 级牌<b style="color:#f0c040">'+_rn(lr)+'</b></span>' +
      '<span>A<b style="color:#4ecdc4">'+_rn(lA)+'</b> — B<b style="color:#ff6b6b">'+_rn(lB)+'</b></span>' +
      '<span style="color:#aaa">'+(s.phase==='play'?'出牌':s.phase==='tribute'?'贡牌':(s.phase||''))+'</span>';
  }

  _renderOtherPlayers(s) {
    var _m = this._isMobile;
    var seats = [(this.myIdx+1)%4, (this.myIdx+2)%4, (this.myIdx+3)%4];
    var slots = [this.rightSlot, this.topSlot, this.leftSlot];
    for (var i=0; i<3; i++) {
      var idx = seats[i], p = s.players[idx];
      if (!p) continue;
      var slot = slots[i];
      var isCur = s.current_idx===idx;
      var fi = (s.finish_order||[]).indexOf(idx);
      var fl = fi>=0 ? ['头游','二游','三游','末游'][fi] : '';
      var tc = p.team==='A' ? '#4ecdc4' : '#ff6b6b';
      var isMate = p.team === (s.players[this.myIdx]||{}).team;
      slot.innerHTML =
        '<div style="font-weight:bold;color:'+tc+';'+(isCur?'text-shadow:0 0 8px #f0c040;':'')+'">' +
        p.name+(isMate?' <span style="font-size:'+(_m?'8px':'10px')+';color:#8f8">(友)</span>':'')+'</div>' +
        '<div style="display:flex;align-items:center;gap:'+(_m?'3px':'6px')+';">' +
        (fi>=0 ? '<span style="color:#f0c040;font-weight:bold;font-size:'+(_m?'12px':'14px')+'">'+fl+'</span>'
               : this._cardBackSvg(p.hand_count)) +
        '</div>' +
        (isCur ? '<div style="color:#f0c040;font-size:'+(_m?'9px':'11px')+';animation:pulse 1s infinite">◆ 出牌中</div>' : '');
    }
  }

  _cardBackSvg(count) {
    var _m = this._isMobile, bw=_m?24:36, bh=_m?34:50;
    return '<div style="position:relative;width:'+bw+'px;height:'+bh+'px;background:linear-gradient(135deg,#1a3a7a,#2a5aaa);' +
      'border-radius:'+(_m?'3':'5')+'px;border:1px solid #4a7aca;display:flex;align-items:center;justify-content:center;">' +
      '<span style="color:#8ac;font-size:'+(_m?'8px':'10px')+'">🂠</span></div>' +
      '<span style="font-size:'+(_m?'14px':'18px')+';font-weight:bold;color:#ddd">'+count+'</span>';
  }

  _renderPlayZones(s) {
    var seats = [(this.myIdx+1)%4, (this.myIdx+2)%4, (this.myIdx+3)%4, this.myIdx];
    var zones = ['right','top','left','bottom'];
    var pla = s.player_last_action || {};
    for (var i=0; i<4; i++) {
      var zone = this.playZones[zones[i]];
      zone.innerHTML = '';
      var act = pla[seats[i]] || pla[String(seats[i])];
      if (!act) continue;
      if (act.type==='pass') {
        zone.innerHTML = '<span style="color:#888;font-size:'+(_m?'12px':'14px')+';background:rgba(0,0,0,.3);padding:3px 10px;border-radius:8px">过</span>';
      } else if (act.type==='play') {
        var lb = document.createElement('div');
        lb.style.cssText = 'font-size:'+(_m?'9px':'11px')+';color:#aaa;margin-bottom:2px;';
        lb.textContent = _ht(act.hand_type);
        zone.appendChild(lb);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;justify-content:center;';
        (act.cards||[]).forEach(function(c) { row.appendChild(_mkMiniCard(c)); });
        zone.appendChild(row);
      }
    }
  }

  _renderMyInfo(s) {
    var _m = this._isMobile;
    var me = s.players[this.myIdx]; if (!me) return;
    var tc = me.team==='A' ? '#4ecdc4' : '#ff6b6b';
    var isCur = s.current_idx===this.myIdx;
    var fi = (s.finish_order||[]).indexOf(this.myIdx);
    var fl = fi>=0 ? ' · '+['头游','二游','三游','末游'][fi] : '';
    this.myInfo.innerHTML =
      '<span style="color:'+tc+';font-weight:bold">'+me.name+'</span>' +
      '<span style="color:#888"> ('+me.team+'队'+fl+')</span>' +
      (isCur ? ' <span style="color:#f0c040">◆ 轮到你</span>' : '');
  }

  /* ── 手牌（响应式） ── */
  _renderMyHand(s) {
    this.handArea.innerHTML = '';
    var me = s.players[this.myIdx];
    if (!me || !me.hand) return;
    var self = this;
    var hand = me.hand.slice().reverse();
    var total = hand.length;
    var _m = self._isMobile;
    var cw = _m ? 36 : 52;
    var screenW = window.innerWidth;
    var availW = _m ? (screenW - 12) : Math.min(screenW*0.9, 900);
    var overlap = Math.min(cw, Math.max(_m?12:28, availW/total));

    hand.forEach(function(c, i) {
      var sel = self.selectedUids.has(c.uid);
      var el = self._mkHandCard(c, sel);
      if (i > 0) el.style.marginLeft = '-'+(cw-overlap)+'px';
      el.style.zIndex = i;
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        if (self.selectedUids.has(c.uid)) self.selectedUids.delete(c.uid);
        else self.selectedUids.add(c.uid);
        self._renderMyHand(s);
      });
      self.handArea.appendChild(el);
    });
  }

  _mkHandCard(c, sel) {
    var el = document.createElement('div');
    var _m = this._isMobile;
    var cw = _m?36:52, ch = _m?52:76;
    var red = c.suit==='\u2665'||c.suit==='\u2666';
    var jk = c.is_joker;
    var fg = jk ? (c.rank>=16?'#e94560':'#333') : (red?'#d44':'#222');
    var bg = sel ? '#d4e8ff' : '#fffff5';
    var border = c.is_wild ? '2px solid #f0c040' : '1px solid #bbb';
    var lift = sel ? 'translateY('+(_m?'-8':'-14')+'px)' : '';
    var shadow = sel ? '0 4px 12px rgba(78,205,196,.5)' : '0 2px 4px rgba(0,0,0,.3)';
    el.style.cssText =
      'width:'+cw+'px;height:'+ch+'px;border-radius:'+(_m?'4':'7')+'px;background:'+bg+
      ';border:'+border+
      ';display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-weight:bold;color:'+fg+';cursor:pointer;transform:'+lift+
      ';transition:transform .12s;box-shadow:'+shadow+';position:relative;flex-shrink:0;';
    var fs1 = _m?'9px':'13px', fs2 = _m?'11px':'16px';
    if (jk) {
      el.innerHTML = '<div style="font-size:'+(_m?'8px':'11px')+';line-height:1.2">'+(c.rank>=16?'大':'小')+'</div>' +
        '<div style="font-size:'+(_m?'10px':'14px')+'">👑</div>';
    } else {
      el.innerHTML = '<div style="font-size:'+fs1+';line-height:1">'+(c.suit||'')+'</div>' +
        '<div style="font-size:'+fs2+';line-height:1">'+_rn(c.rank)+'</div>';
    }
    if (c.is_wild) {
      var b = document.createElement('div');
      b.style.cssText = 'position:absolute;top:'+(_m?'-3':'-5')+'px;right:'+(_m?'-3':'-5')+'px;' +
        'background:#f0c040;color:#000;font-size:'+(_m?'7':'9')+'px;padding:1px '+(_m?'2':'4')+'px;' +
        'border-radius:'+(_m?'3':'6')+'px;font-weight:bold;';
      b.textContent = '配';
      el.appendChild(b);
    }
    el.addEventListener('mouseenter', function() { if(!sel) el.style.transform='translateY(-5px)'; });
    el.addEventListener('mouseleave', function() { el.style.transform=sel?'translateY('+(_m?'-8':'-14')+'px)':''; });
    return el;
  }

  /* ── 操作按钮 ── */
  _renderAction(kind, data) {
    this.actionDiv.innerHTML = '';
    var self = this;
    var _m = this._isMobile;
    if (kind === 'play') {
      var validPlays = (data && data.valid_plays) || [];
      if (validPlays.length > 0) {
        if (this._recommendIdx >= validPlays.length) this._recommendIdx = 0;
        var recBtn = this._btn('推荐▶', '#e9c46a', function() {
          var vp = validPlays[self._recommendIdx];
          if (!vp) return;
          self.selectedUids.clear();
          (vp.uids||[]).forEach(function(u) { self.selectedUids.add(u); });
          self._recommendIdx = (self._recommendIdx+1)%validPlays.length;
          self._renderMyHand(self.state);
          var ct = document.getElementById('gd-rec-counter');
          if (ct) ct.textContent = self._recommendIdx+'/'+validPlays.length;
        });
        this.actionDiv.appendChild(recBtn);
        var ct = document.createElement('span');
        ct.id = 'gd-rec-counter';
        ct.style.cssText = 'color:#aaa;font-size:'+(_m?'9px':'11px')+';min-width:28px;text-align:center;';
        ct.textContent = validPlays.length+'种';
        this.actionDiv.appendChild(ct);
      }
      var pb = this._btn('出牌', '#2a9d8f', function() {
        var uids = Array.from(self.selectedUids);
        if (!uids.length) return;
        self.respond('play', uids);
        self.selectedUids.clear();
        self.pendingKind = null;
        self._recommendIdx = 0;
        self.actionDiv.innerHTML = '<span style="color:#888;font-size:12px">已出牌</span>';
      });
      this.actionDiv.appendChild(pb);
      if (data && data.last_play) {
        var ps = this._btn('过牌', '#e76f51', function() {
          self.respond('play', 'pass');
          self.selectedUids.clear();
          self.pendingKind = null;
          self._recommendIdx = 0;
          self.actionDiv.innerHTML = '<span style="color:#888;font-size:12px">已过牌</span>';
        });
        this.actionDiv.appendChild(ps);
      }
    } else if (kind==='tribute_give' || kind==='tribute_return') {
      var label = kind==='tribute_give' ? '进贡' : '还牌';
      var color = kind==='tribute_give' ? '#f0c040' : '#4ecdc4';
      var hint = kind==='tribute_give' ? '选进贡牌' : '选还牌(≤10)';
      var hd = document.createElement('span');
      hd.style.cssText = 'color:'+color+';font-size:'+(_m?'10px':'12px')+';';
      hd.textContent = hint;
      this.actionDiv.appendChild(hd);
      var btn = this._btn(label, color, function() {
        var uids = Array.from(self.selectedUids);
        if (uids.length!==1) { alert('请选择1张牌'); return; }
        self.respond(self.pendingKind, uids[0]);
        self.selectedUids.clear();
        self.pendingKind = null;
      });
      this.actionDiv.appendChild(btn);
    }
  }

  _btn(txt, color, fn) {
    var b = document.createElement('button');
    var _m = this._isMobile;
    b.textContent = txt;
    b.style.cssText =
      'padding:'+(_m?'5px 10px':'8px 20px')+';border:none;border-radius:'+(_m?'6px':'10px')+';' +
      'background:'+color+';color:#fff;font-size:'+(_m?'12px':'15px')+';font-weight:bold;' +
      'cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3);transition:filter .15s;white-space:nowrap;';
    b.addEventListener('mouseenter', function(){ b.style.filter='brightness(1.15)'; });
    b.addEventListener('mouseleave', function(){ b.style.filter=''; });
    b.addEventListener('click', fn);
    return b;
  }
}

/* ── 迷你牌 ── */
function _mkMiniCard(c) {
  var el = document.createElement('div');
  var _m = window.innerWidth < 640;
  var mw=_m?22:34, mh=_m?32:48;
  var red = c.suit==='\u2665'||c.suit==='\u2666';
  var jk = c.is_joker;
  var fg = jk ? (c.rank>=16?'#e94560':'#444') : (red?'#d44':'#222');
  el.style.cssText =
    'width:'+mw+'px;height:'+mh+'px;border-radius:'+(_m?'3':'4')+'px;background:#fffff5;border:1px solid #bbb;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'font-size:'+(_m?'8px':'11px')+';font-weight:bold;color:'+fg+';flex-shrink:0;';
  if (jk) {
    el.innerHTML = '<div style="font-size:'+(_m?'7px':'9px')+'">'+(c.rank>=16?'大':'小')+'</div>' +
      '<div style="font-size:'+(_m?'9px':'12px')+'">👑</div>';
  } else {
    el.innerHTML = '<div style="font-size:'+(_m?'7px':'10px')+';line-height:1">'+(c.suit||'')+'</div>' +
      '<div style="line-height:1">'+_rn(c.rank)+'</div>';
  }
  if (c.is_wild) el.style.border = '2px solid #f0c040';
  return el;
}

function _rn(r) {
  var m={2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'};
  return m[r]||String(r);
}
function _ht(t) {
  var m={single:'单牌',pair:'对子',triple:'三条',triple_with_pair:'三带二',
    straight:'顺子',consecutive_pairs:'连对',consecutive_triples:'钢板',
    bomb_4:'炸弹(4)',bomb_5:'炸弹(5)',bomb_6:'炸弹(6)',bomb_7:'炸弹(7)',bomb_8:'炸弹(8)',
    flush_straight:'同花顺',rocket:'火箭'};
  return m[t]||t;
}

if (typeof _RENDERERS !== 'undefined') _RENDERERS['guandan'] = GuandanRenderer;

(function() {
  if (document.getElementById('guandan-styles')) return;
  var s = document.createElement('style');
  s.id = 'guandan-styles';
  s.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}';
  document.head.appendChild(s);
})();

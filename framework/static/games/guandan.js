/* static/games/guandan.js — 掼蛋渲染器 */
class GuandanRenderer {
  constructor(container, myIdx, respond) {
    this.myIdx = myIdx;
    this.respond = respond;
    this.state = null;
    this.pendingKind = null;
    this.pendingData = null;
    this.selectedUids = new Set();

    /* ── 整体容器：牌桌 ── */
    this.table = document.createElement('div');
    this.table.style.cssText =
      'position:relative;width:100%;max-width:960px;margin:0 auto;' +
      'aspect-ratio:4/3;min-height:600px;' +
      'background:radial-gradient(ellipse at center,#1a3a2a 0%,#0d1b12 100%);' +
      'border-radius:24px;border:3px solid #2a5a3a;overflow:hidden;' +
      'font-family:"Noto Sans SC",sans-serif;color:#eee;user-select:none;';
    container.appendChild(this.table);

    /* ── 信息栏 ── */
    this.infoBar = document.createElement('div');
    this.infoBar.style.cssText =
      'position:absolute;top:0;left:0;right:0;height:36px;' +
      'display:flex;justify-content:space-between;align-items:center;' +
      'padding:0 16px;background:rgba(0,0,0,.45);font-size:13px;z-index:10;';
    this.table.appendChild(this.infoBar);

    /* ── 四个玩家区域容器 ── */
    // 上(对家)
    this.topSlot = this._mkSlot('top');
    // 左
    this.leftSlot = this._mkSlot('left');
    // 右
    this.rightSlot = this._mkSlot('right');
    // 中央出牌展示
    this.centerArea = document.createElement('div');
    this.centerArea.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:5;';
    this.table.appendChild(this.centerArea);

    /* ── 四个出牌展示区（在各自方位） ── */
    this.playZones = {};
    this.playZones.top = this._mkPlayZone('top');
    this.playZones.left = this._mkPlayZone('left');
    this.playZones.right = this._mkPlayZone('right');
    this.playZones.bottom = this._mkPlayZone('bottom');

    /* ── 底部(自己)手牌区 ── */
    this.handArea = document.createElement('div');
    this.handArea.style.cssText =
      'position:absolute;bottom:0;left:50%;transform:translateX(-50%);' +
      'display:flex;justify-content:center;align-items:flex-end;' +
      'padding:8px 12px 10px;max-width:95%;z-index:8;';
    this.table.appendChild(this.handArea);

    /* ── 底部玩家信息 ── */
    this.myInfo = document.createElement('div');
    this.myInfo.style.cssText =
      'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);' +
      'font-size:13px;text-align:center;z-index:7;color:#ccc;';
    this.table.appendChild(this.myInfo);

    /* ── 操作按钮区 ── */
    this.actionDiv = document.createElement('div');
    this.actionDiv.style.cssText =
      'position:absolute;bottom:95px;right:16px;' +
      'display:flex;gap:8px;align-items:center;z-index:12;';
    this.table.appendChild(this.actionDiv);
  }

  /* ── 创建方位玩家信息槽 ── */
  _mkSlot(pos) {
    var d = document.createElement('div');
    var css = 'position:absolute;display:flex;flex-direction:column;align-items:center;' +
      'gap:4px;font-size:13px;z-index:6;';
    if (pos === 'top')   css += 'top:42px;left:50%;transform:translateX(-50%);';
    if (pos === 'left')  css += 'top:50%;left:12px;transform:translateY(-50%);';
    if (pos === 'right') css += 'top:50%;right:12px;transform:translateY(-50%);';
    d.style.cssText = css;
    this.table.appendChild(d);
    return d;
  }

  /* ── 创建各方位的出牌展示区 ── */
  _mkPlayZone(pos) {
    var d = document.createElement('div');
    var css = 'position:absolute;display:flex;flex-direction:column;align-items:center;' +
      'gap:2px;z-index:5;pointer-events:none;';
    if (pos === 'top')    css += 'top:110px;left:50%;transform:translateX(-50%);';
    if (pos === 'left')   css += 'top:50%;left:120px;transform:translateY(-50%);';
    if (pos === 'right')  css += 'top:50%;right:120px;transform:translateY(-50%);';
    if (pos === 'bottom') css += 'bottom:140px;left:50%;transform:translateX(-50%);';
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
    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:absolute;inset:0;background:rgba(0,0,0,.7);display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;z-index:50;border-radius:24px;';
    var wt = result.winner_team || '?';
    overlay.innerHTML =
      '<div style="font-size:36px;font-weight:bold;color:#f0c040;margin-bottom:12px">' +
      wt + ' 队获胜！</div>' +
      '<div style="font-size:16px;color:#ccc">A队等级: ' + _rn(result.level_a) +
      '&ensp;|&ensp;B队等级: ' + _rn(result.level_b) +
      '&ensp;|&ensp;共 ' + (result.rounds||'?') + ' 局</div>';
    this.table.appendChild(overlay);
  }

  /* ── 渲染总入口 ── */
  render() {
    if (!this.state) return;
    var s = this.state;
    this._renderInfo(s);
    this._renderOtherPlayers(s);
    this._renderPlayZones(s);
    this._renderMyHand(s);
    this._renderMyInfo(s);
  }

  /* ── 信息栏 ── */
  _renderInfo(s) {
    var lr = s.level_rank || '?';
    var lA = (s.level && s.level.A) || '?';
    var lB = (s.level && s.level.B) || '?';
    this.infoBar.innerHTML =
      '<span>第 ' + (s.round_num||1) + ' 局 · 级牌 <b style="color:#f0c040">' + _rn(lr) + '</b></span>' +
      '<span style="letter-spacing:1px">A队 <b style="color:#4ecdc4">' + _rn(lA) +
      '</b> — B队 <b style="color:#ff6b6b">' + _rn(lB) + '</b></span>' +
      '<span style="color:#aaa">' + (s.phase === 'play' ? '出牌' : s.phase === 'tribute' ? '贡牌' : (s.phase||'')) + '</span>';
  }

  /* ── 左/上/右三个对手 ── */
  _renderOtherPlayers(s) {
    // 座位顺序：下(me) → 右 → 上 → 左  (逆时针)
    var seats = [(this.myIdx+1)%4, (this.myIdx+2)%4, (this.myIdx+3)%4];
    var slots = [this.rightSlot, this.topSlot, this.leftSlot];
    var posLabels = ['右', '对家', '左'];
    for (var i = 0; i < 3; i++) {
      var idx = seats[i];
      var p = s.players[idx];
      if (!p) continue;
      var slot = slots[i];
      var isCur = s.current_idx === idx;
      var fi = (s.finish_order||[]).indexOf(idx);
      var finishLabel = fi >= 0 ? ['头游','二游','三游','末游'][fi] : '';
      var tc = p.team === 'A' ? '#4ecdc4' : '#ff6b6b';
      var isTeammate = p.team === (s.players[this.myIdx]||{}).team;

      slot.innerHTML =
        '<div style="font-weight:bold;color:' + tc + ';font-size:14px;' +
        (isCur ? 'text-shadow:0 0 8px #f0c040;' : '') + '">' +
        p.name + (isTeammate ? ' <span style="font-size:10px;color:#8f8">(友)</span>' : '') + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        (fi >= 0
          ? '<span style="color:#f0c040;font-weight:bold">' + finishLabel + '</span>'
          : this._cardBackSvg(p.hand_count)) +
        '</div>' +
        (isCur ? '<div style="color:#f0c040;font-size:11px;animation:pulse 1s infinite">◆ 出牌中</div>' : '');
    }
  }

  /* ── 牌背 SVG + 数量 ── */
  _cardBackSvg(count) {
    return '<div style="position:relative;width:36px;height:50px;background:linear-gradient(135deg,#1a3a7a,#2a5aaa);' +
      'border-radius:5px;border:1px solid #4a7aca;display:flex;align-items:center;justify-content:center;">' +
      '<span style="color:#8ac;font-size:10px">🂠</span></div>' +
      '<span style="font-size:18px;font-weight:bold;color:#ddd">' + count + '</span>';
  }

  /* ── 各方位出牌展示 ── */
  _renderPlayZones(s) {
    var seats = [(this.myIdx+1)%4, (this.myIdx+2)%4, (this.myIdx+3)%4, this.myIdx];
    var zones = ['right', 'top', 'left', 'bottom'];
    var pla = s.player_last_action || {};
    for (var i = 0; i < 4; i++) {
      var zone = this.playZones[zones[i]];
      zone.innerHTML = '';
      var act = pla[seats[i]] || pla[String(seats[i])];
      if (!act) continue;
      if (act.type === 'pass') {
        zone.innerHTML = '<span style="color:#888;font-size:14px;background:rgba(0,0,0,.3);' +
          'padding:4px 12px;border-radius:8px">过</span>';
      } else if (act.type === 'play') {
        var lb = document.createElement('div');
        lb.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:2px;';
        lb.textContent = _ht(act.hand_type);
        zone.appendChild(lb);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;justify-content:center;';
        (act.cards||[]).forEach(function(c) { row.appendChild(_mkMiniCard(c)); });
        zone.appendChild(row);
      }
    }
  }

  /* ── 自己信息 ── */
  _renderMyInfo(s) {
    var me = s.players[this.myIdx];
    if (!me) return;
    var tc = me.team === 'A' ? '#4ecdc4' : '#ff6b6b';
    var isCur = s.current_idx === this.myIdx;
    var fi = (s.finish_order||[]).indexOf(this.myIdx);
    var fl = fi >= 0 ? ' · ' + ['头游','二游','三游','末游'][fi] : '';
    this.myInfo.innerHTML =
      '<span style="color:' + tc + ';font-weight:bold">' + me.name + '</span>' +
      '<span style="color:#888"> (' + me.team + '队' + fl + ')</span>' +
      (isCur ? ' <span style="color:#f0c040">◆ 轮到你</span>' : '');
  }

  /* ── 自己的手牌 ── */
  _renderMyHand(s) {
    this.handArea.innerHTML = '';
    var me = s.players[this.myIdx];
    if (!me || !me.hand) return;
    var self = this;
    var hand = me.hand.slice().reverse();
    var total = hand.length;
    // 扇形展开：牌越多越紧凑
    var overlap = Math.min(52, Math.max(28, 800 / total));

    hand.forEach(function(c, i) {
      var sel = self.selectedUids.has(c.uid);
      var el = self._mkHandCard(c, sel);
      if (i > 0) el.style.marginLeft = '-' + (52 - overlap) + 'px';
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

  /* ── 手牌卡片 ── */
  _mkHandCard(c, sel) {
    var el = document.createElement('div');
    var red = c.suit === '♥' || c.suit === '♦';
    var jk = c.is_joker;
    var fg = jk ? (c.rank >= 16 ? '#e94560' : '#333') : (red ? '#d44' : '#222');
    var bg = sel ? '#d4e8ff' : '#fffff5';
    var border = c.is_wild ? '2.5px solid #f0c040' : '1px solid #bbb';
    var lift = sel ? 'translateY(-14px)' : '';
    var shadow = sel ? '0 4px 16px rgba(78,205,196,.5)' : '0 2px 6px rgba(0,0,0,.3)';

    el.style.cssText =
      'width:52px;height:76px;border-radius:7px;background:' + bg +
      ';border:' + border +
      ';display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-weight:bold;color:' + fg +
      ';cursor:pointer;transform:' + lift +
      ';transition:transform .12s,box-shadow .12s;box-shadow:' + shadow +
      ';position:relative;flex-shrink:0;';

    if (jk) {
      el.innerHTML = '<div style="font-size:11px;line-height:1.2">' + (c.rank >= 16 ? '大' : '小') + '</div>' +
        '<div style="font-size:14px">👑</div>';
    } else {
      el.innerHTML = '<div style="font-size:13px;line-height:1">' + (c.suit||'') + '</div>' +
        '<div style="font-size:16px;line-height:1">' + _rn(c.rank) + '</div>';
    }
    if (c.is_wild) {
      var b = document.createElement('div');
      b.style.cssText =
        'position:absolute;top:-5px;right:-5px;background:#f0c040;color:#000;' +
        'font-size:9px;padding:1px 4px;border-radius:6px;font-weight:bold;';
      b.textContent = '配';
      el.appendChild(b);
    }
    // Hover effect
    el.addEventListener('mouseenter', function() {
      if (!el._sel) el.style.transform = 'translateY(-6px)';
    });
    el.addEventListener('mouseleave', function() {
      if (!el._sel) el.style.transform = sel ? 'translateY(-14px)' : '';
    });
    el._sel = sel;
    return el;
  }

  /* ── 操作按钮 ── */
  _renderAction(kind, data) {
    this.actionDiv.innerHTML = '';
    var self = this;
    if (kind === 'play') {
      // 推荐按钮：循环展示合法出牌
      var validPlays = (data && data.valid_plays) || [];
      if (validPlays.length > 0) {
        this._recommendIdx = (this._recommendIdx || 0);
        if (this._recommendIdx >= validPlays.length) this._recommendIdx = 0;
        var recBtn = this._btn('推荐 ▶', '#e9c46a', function() {
          var vp = validPlays[self._recommendIdx];
          if (!vp) return;
          self.selectedUids.clear();
          (vp.uids || []).forEach(function(u) { self.selectedUids.add(u); });
          self._recommendIdx = (self._recommendIdx + 1) % validPlays.length;
          self._renderMyHand(self.state);
          // 更新计数提示
          var counter = document.getElementById('gd-rec-counter');
          if (counter) counter.textContent = self._recommendIdx + '/' + validPlays.length;
        });
        this.actionDiv.appendChild(recBtn);
        var counter = document.createElement('span');
        counter.id = 'gd-rec-counter';
        counter.style.cssText = 'color:#aaa;font-size:11px;min-width:32px;text-align:center;';
        counter.textContent = validPlays.length + '种';
        this.actionDiv.appendChild(counter);
      }
      // 出牌按钮
      var pb = this._btn('出 牌', '#2a9d8f', function() {
        var uids = Array.from(self.selectedUids);
        if (!uids.length) return;
        self.respond('play', uids);
        self.selectedUids.clear();
        self.pendingKind = null;
        self._recommendIdx = 0;
        self.actionDiv.innerHTML = '<span style="color:#888;font-size:12px">已出牌</span>';
      });
      this.actionDiv.appendChild(pb);
      // 过牌按钮（跟牌时才显示）
      if (data && data.last_play) {
        var ps = this._btn('过 牌', '#e76f51', function() {
          self.respond('play', 'pass');
          self.selectedUids.clear();
          self.pendingKind = null;
          self._recommendIdx = 0;
          self.actionDiv.innerHTML = '<span style="color:#888;font-size:12px">已过牌</span>';
        });
        this.actionDiv.appendChild(ps);
      }
    } else if (kind === 'tribute_give' || kind === 'tribute_return') {
      var label = kind === 'tribute_give' ? '确认进贡' : '确认还牌';
      var color = kind === 'tribute_give' ? '#f0c040' : '#4ecdc4';
      var hint = kind === 'tribute_give' ? '选择进贡的牌' : '选择还牌(≤10)';
      var hd = document.createElement('span');
      hd.style.cssText = 'color:' + color + ';font-size:12px;';
      hd.textContent = hint;
      this.actionDiv.appendChild(hd);
      var btn = this._btn(label, color, function() {
        var uids = Array.from(self.selectedUids);
        if (uids.length !== 1) { alert('请选择1张牌'); return; }
        self.respond(self.pendingKind, uids[0]);
        self.selectedUids.clear();
        self.pendingKind = null;
      });
      this.actionDiv.appendChild(btn);
    }
  }

  _btn(txt, color, fn) {
    var b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText =
      'padding:8px 20px;border:none;border-radius:10px;background:' + color +
      ';color:#fff;font-size:15px;font-weight:bold;cursor:pointer;' +
      'box-shadow:0 3px 8px rgba(0,0,0,.3);transition:filter .15s;';
    b.addEventListener('mouseenter', function() { b.style.filter = 'brightness(1.15)'; });
    b.addEventListener('mouseleave', function() { b.style.filter = ''; });
    b.addEventListener('click', fn);
    return b;
  }
}

/* ── 迷你牌（出牌展示区用，小尺寸） ── */
function _mkMiniCard(c) {
  var el = document.createElement('div');
  var red = c.suit === '♥' || c.suit === '♦';
  var jk = c.is_joker;
  var fg = jk ? (c.rank >= 16 ? '#e94560' : '#444') : (red ? '#d44' : '#222');
  el.style.cssText =
    'width:34px;height:48px;border-radius:4px;background:#fffff5;border:1px solid #bbb;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'font-size:11px;font-weight:bold;color:' + fg + ';flex-shrink:0;';
  if (jk) {
    el.innerHTML = '<div style="font-size:9px">' + (c.rank >= 16 ? '大' : '小') + '</div><div>👑</div>';
  } else {
    el.innerHTML = '<div style="font-size:10px;line-height:1">' + (c.suit||'') + '</div>' +
      '<div style="line-height:1">' + _rn(c.rank) + '</div>';
  }
  if (c.is_wild) {
    el.style.border = '2px solid #f0c040';
  }
  return el;
}

/* ── 工具函数 ── */
function _rn(r) {
  var m = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',
           11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'};
  return m[r] || String(r);
}
function _ht(t) {
  var m = {single:'单牌',pair:'对子',triple:'三条',triple_with_pair:'三带二',
    straight:'顺子',consecutive_pairs:'连对',consecutive_triples:'钢板',
    bomb_4:'炸弹(4)',bomb_5:'炸弹(5)',bomb_6:'炸弹(6)',bomb_7:'炸弹(7)',bomb_8:'炸弹(8)',
    flush_straight:'同花顺',rocket:'火箭'};
  return m[t] || t;
}

/* ── 注册到框架 ── */
if (typeof _RENDERERS !== 'undefined') _RENDERERS['guandan'] = GuandanRenderer;

/* ── 动画关键帧 ── */
(function() {
  if (document.getElementById('guandan-styles')) return;
  var style = document.createElement('style');
  style.id = 'guandan-styles';
  style.textContent = '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}';
  document.head.appendChild(style);
})();

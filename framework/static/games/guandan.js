/* static/games/guandan.js */
class GuandanRenderer {
  constructor(container, myIdx, respond) {
    this.myIdx = myIdx;
    this.respond = respond;
    this.state = null;
    this.pendingKind = null;
    this.pendingData = null;
    this.selectedUids = new Set();

    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = 'display:flex;flex-direction:column;gap:.5rem;width:100%;font-family:sans-serif;color:#eee;';
    container.appendChild(this.wrapper);

    this.infoBar = document.createElement('div');
    this.infoBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:.5rem 1rem;background:#16213e;border-radius:8px;font-size:14px;';
    this.wrapper.appendChild(this.infoBar);

    this.otherArea = document.createElement('div');
    this.otherArea.style.cssText = 'display:flex;justify-content:space-around;gap:.5rem;min-height:120px;';
    this.wrapper.appendChild(this.otherArea);

    this.playArea = document.createElement('div');
    this.playArea.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100px;padding:1rem;background:#0d1b2a;border-radius:12px;';
    this.wrapper.appendChild(this.playArea);

    this.handArea = document.createElement('div');
    this.handArea.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:4px;padding:.5rem;min-height:120px;';
    this.wrapper.appendChild(this.handArea);

    this.actionDiv = document.createElement('div');
    this.actionDiv.style.cssText = 'display:flex;gap:.5rem;justify-content:center;padding:.5rem;min-height:48px;align-items:center;';
    this.wrapper.appendChild(this.actionDiv);
  }

  onState(ctx) { this.state = ctx; this.render(); }

  onRequest(playerIdx, kind, data) {
    if (playerIdx !== this.myIdx) {
      this.actionDiv.innerHTML = '<span style="color:#888">等待玩家操作...</span>';
      return;
    }
    this.pendingKind = kind;
    this.pendingData = data;
    this.selectedUids.clear();
    this.render();
    this._renderAction(kind, data);
  }

  onGameOver(result) {
    this.actionDiv.innerHTML = '<h3 style="color:#f0c040;margin:0">游戏结束！' +
      (result.winner_team||'') + ' 队获胜！</h3>' +
      '<div style="margin-top:.5rem">A队: ' + (result.level_a||'?') +
      '  B队: ' + (result.level_b||'?') + '  共 ' + (result.rounds||'?') + ' 局</div>';
  }

  render() {
    if (!this.state) return;
    var s = this.state;
    this._renderInfo(s);
    this._renderOthers(s);
    this._renderPlayArea(s);
    this._renderHand(s);
  }

  _renderInfo(s) {
    var lr = s.level_rank || '?';
    var lA = (s.level && s.level.A) || '?';
    var lB = (s.level && s.level.B) || '?';
    this.infoBar.innerHTML =
      '<span>第 ' + (s.round_num||1) + ' 局 · 级牌: <b style="color:#f0c040">' + _rn(lr) + '</b></span>' +
      '<span>A队: <b style="color:#4ecdc4">' + _rn(lA) + '</b> | B队: <b style="color:#e94560">' + _rn(lB) + '</b></span>' +
      '<span>' + (s.phase||'') + '</span>';
  }

  _renderOthers(s) {
    this.otherArea.innerHTML = '';
    var seats = [(this.myIdx+1)%4, (this.myIdx+2)%4, (this.myIdx+3)%4];
    var labels = ['左手','对家','右手'];
    var self = this;
    seats.forEach(function(idx, i) {
      var p = s.players[idx]; if (!p) return;
      var div = document.createElement('div');
      var cur = s.current_idx === idx;
      var fi = (s.finish_order||[]).indexOf(idx);
      var fl = fi >= 0 ? ['头游','二游','三游','末游'][fi] : '';
      var tc = p.team === 'A' ? '#4ecdc4' : '#e94560';
      div.style.cssText = 'flex:1;padding:.5rem;background:#1a1a2e;border-radius:8px;text-align:center;border:2px solid ' + (cur?'#f0c040':'transparent') + ';';
      div.innerHTML = '<div style="font-weight:bold;color:' + tc + '">' + labels[i] + ' · ' + p.name + '</div>' +
        '<div style="font-size:24px;margin:.3rem 0">' + (fi>=0 ? fl : '\u{1F0CF}\u00D7'+p.hand_count) + '</div>';
      self.otherArea.appendChild(div);
    });
  }

  _renderPlayArea(s) {
    this.playArea.innerHTML = '';
    if (s.last_play) {
      var lp = s.last_play;
      var who = s.players[lp.player_idx] ? s.players[lp.player_idx].name : '?';
      var lb = document.createElement('div');
      lb.style.cssText = 'font-size:12px;color:#888;margin-bottom:.3rem;';
      lb.textContent = who + ' · ' + _ht(lp.hand_type);
      this.playArea.appendChild(lb);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:center;';
      var self = this;
      (lp.cards||[]).forEach(function(c) { row.appendChild(self._mkCard(c, false, false)); });
      this.playArea.appendChild(row);
    } else {
      this.playArea.innerHTML = '<span style="color:#555">空（自由出牌）</span>';
    }
  }

  _renderHand(s) {
    this.handArea.innerHTML = '';
    var me = s.players[this.myIdx];
    if (!me || !me.hand) return;
    var self = this;
    me.hand.forEach(function(c) {
      var sel = self.selectedUids.has(c.uid);
      var el = self._mkCard(c, true, sel);
      el.addEventListener('click', function() {
        if (self.selectedUids.has(c.uid)) self.selectedUids.delete(c.uid);
        else self.selectedUids.add(c.uid);
        self._renderHand(s);
      });
      self.handArea.appendChild(el);
    });
  }

  _mkCard(c, click, sel) {
    var el = document.createElement('div');
    var red = c.suit === '\u2665' || c.suit === '\u2666';
    var jk = c.is_joker;
    var color = jk ? (c.rank >= 16 ? '#e94560' : '#333') : (red ? '#e94560' : '#1a1a2e');
    var bg = sel ? '#2a4a6a' : '#f5f5f0';
    var bdr = c.is_wild ? '2px solid #f0c040' : '1px solid #999';
    var tf = sel ? 'translateY(-8px)' : '';
    el.style.cssText = 'width:48px;height:68px;border-radius:6px;background:'+bg+
      ';border:'+bdr+';display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:14px;font-weight:bold;color:'+color+
      ';cursor:'+(click?'pointer':'default')+';user-select:none;transform:'+tf+';transition:transform .15s;position:relative;';
    if (jk) { el.innerHTML = '<div style="font-size:10px">'+c.display+'</div>'; }
    else { el.innerHTML = '<div style="font-size:10px">'+(c.suit||'')+'</div><div>'+_rn(c.rank)+'</div>'; }
    if (c.is_wild) {
      var b = document.createElement('div');
      b.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#f0c040;color:#000;font-size:8px;padding:1px 3px;border-radius:4px;';
      b.textContent = '配';
      el.appendChild(b);
    }
    return el;
  }

  _renderAction(kind, data) {
    this.actionDiv.innerHTML = '';
    var self = this;
    if (kind === 'play') {
      var pb = this._btn('出牌', '#4ecdc4', function() {
        var uids = Array.from(self.selectedUids);
        if (!uids.length) return;
        self.respond(uids);
        self.selectedUids.clear();
        self.pendingKind = null;
        self.actionDiv.innerHTML = '<span style="color:#888">已出牌</span>';
      });
      var ps = this._btn('过牌', '#e94560', function() {
        self.respond('pass');
        self.selectedUids.clear();
        self.pendingKind = null;
        self.actionDiv.innerHTML = '<span style="color:#888">已过牌</span>';
      });
      this.actionDiv.appendChild(pb);
      if (data && data.last_play) this.actionDiv.appendChild(ps);
    } else if (kind === 'tribute_give' || kind === 'tribute_return') {
      var label = kind === 'tribute_give' ? '确认进贡' : '确认还牌';
      var color = kind === 'tribute_give' ? '#f0c040' : '#4ecdc4';
      var hint = kind === 'tribute_give' ? '选择进贡的牌（最大非配牌）' : '选择还牌（≤10）';
      this.actionDiv.innerHTML = '<span style="color:'+color+'">'+hint+'</span>';
      var btn = this._btn(label, color, function() {
        var uids = Array.from(self.selectedUids);
        if (uids.length !== 1) { alert('请选择1张牌'); return; }
        self.respond(uids[0]);
        self.selectedUids.clear();
        self.pendingKind = null;
      });
      this.actionDiv.appendChild(btn);
    }
  }

  _btn(txt, color, fn) {
    var b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = 'padding:.5rem 1.5rem;border:none;border-radius:8px;background:'+color+';color:#fff;font-size:15px;font-weight:bold;cursor:pointer;';
    b.addEventListener('click', fn);
    return b;
  }
}

function _rn(r) {
  var m = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'};
  return m[r] || String(r);
}
function _ht(t) {
  var m = {single:'单牌',pair:'对子',triple:'三条',triple_with_pair:'三带二',
    straight:'顺子',consecutive_pairs:'连对',consecutive_triples:'钢板',
    bomb_4:'炸弹(4)',bomb_5:'炸弹(5)',bomb_6:'炸弹(6)',bomb_7:'炸弹(7)',bomb_8:'炸弹(8)',
    flush_straight:'同花顺',rocket:'火箭'};
  return m[t] || t;
}

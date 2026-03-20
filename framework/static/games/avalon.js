/* Avalon frontend renderer */
"use strict";

const ROLE_COLORS = {
  "梅林": "#5082DC", "派西维尔": "#50B4C8", "亚瑟的忠臣": "#3C6EB4",
  "刺客": "#C82D37", "莫德雷德": "#A02846", "莫甘娜": "#BE4696",
  "奥伯倫": "#9640B4", "莫德雷德的爪牙": "#823228",
};

class AvalonRenderer {
  constructor(container, myIdx, respond) {
    this.container = container;
    this.myIdx = myIdx;
    this.respond = respond;
    this._selectedTeam = [];
    this._state = null;
    this._buildUI();
  }

  _buildUI() {
    this.container.innerHTML = "";
    this.container.style.cssText = "display:flex;flex-direction:column;height:100%;background:#0f1428;color:#d2d7e6;font-family:sans-serif;overflow:hidden;";

    // top bar
    const bar = this._el("div", "topBar", "padding:8px 16px;background:#16203a;border-bottom:1px solid #2d4678;font-size:15px;display:flex;align-items:center;gap:16px;");
    this.phaseLabel = this._el("span","",  "color:#d7aa2d;font-weight:bold;");
    this.phaseLabel.textContent = "等待开始…";
    bar.appendChild(this.phaseLabel);
    this.voteFails = this._el("span","","color:#e83238;font-size:13px;");
    bar.appendChild(this.voteFails);
    this.container.appendChild(bar);

    // main area
    const main = this._el("div","","display:flex;flex:1;overflow:hidden;");

    // left: table + track
    const left = this._el("div","","flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:12px;");
    this.tableSvg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    this.tableSvg.setAttribute("viewBox","0 0 640 480");
    this.tableSvg.style.cssText = "width:640px;max-width:100%;";
    left.appendChild(this.tableSvg);
    this.trackDiv = this._el("div","","display:flex;gap:8px;margin-top:12px;align-items:center;");
    left.appendChild(this.trackDiv);
    this.actionPanel = this._el("div","actionPanel","min-height:80px;padding:12px 16px;background:#161e3a;border-top:1px solid #2d4678;width:100%;box-sizing:border-box;");
    left.appendChild(this.actionPanel);
    main.appendChild(left);

    // right: vote history + role
    const right = this._el("div","","width:260px;display:flex;flex-direction:column;background:#0c1020;border-left:1px solid #1a2848;overflow-y:auto;");
    this.rolePanel = this._el("div","","padding:10px 12px;background:#14203c;border-bottom:1px solid #1a2848;");
    right.appendChild(this.rolePanel);
    const vh = this._el("div","","padding:8px 12px;font-size:12px;color:#8898ab;font-weight:bold;");
    vh.textContent = "投票历史";
    right.appendChild(vh);
    this.voteHistory = this._el("div","","padding:4px 8px;flex:1;overflow-y:auto;font-size:12px;");
    right.appendChild(this.voteHistory);
    main.appendChild(right);
    this.container.appendChild(main);
  }

  _el(tag, id, style) {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (style) e.style.cssText = style;
    return e;
  }

  onState(ctx) {
    this._state = ctx;
    this._renderTable(ctx);
    this._renderTrack(ctx);
    this._renderRolePanel(ctx);
    this._renderVoteHistory(ctx);
    this.phaseLabel.textContent = ctx.phase_label || ctx.phase || "";
    const vf = ctx.vote_fail_count || 0;
    this.voteFails.textContent = vf > 0 ? `投票连败: ${vf}/5` : "";
  }

  _tablePos(n, i) {
    const cx = 320, cy = 220, rx = 250, ry = 180;
    const myI = this.myIdx;
    const offset = (i - myI + n) % n;
    const angle = Math.PI / 2 + 2 * Math.PI * offset / n;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  }

  _renderTable(ctx) {
    const svg = this.tableSvg;
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    // table ellipse
    const ell = document.createElementNS(ns, "ellipse");
    ell.setAttribute("cx","320"); ell.setAttribute("cy","220");
    ell.setAttribute("rx","258"); ell.setAttribute("ry","188");
    ell.setAttribute("fill","#0c1628"); ell.setAttribute("stroke","#2d4678"); ell.setAttribute("stroke-width","2");
    svg.appendChild(ell);

    const players = ctx.players || [];
    const n = players.length;
    const leaderIdx = ctx.leader_idx;
    const lastVote = (ctx.vote_history || []).slice(-1)[0] || null;

    players.forEach((p, i) => {
      const {x, y} = this._tablePos(n, p.idx);
      const isMe = p.idx === this.myIdx;
      const isLeader = p.idx === leaderIdx;
      const inTeam = this._selectedTeam.includes(p.idx) || (ctx.current_team || []).includes(p.idx);

      // card bg
      const role = p.role;
      let bColor = isMe ? "#64C8FF" : inTeam ? "#D7AA2D" : "#2d4678";
      if (role && ctx.phase === "game_over") bColor = p.alignment === "好人" ? "#3C78D2" : "#C82D37";

      const g = document.createElementNS(ns,"g");
      g.style.cursor = "pointer";
      g.dataset.idx = p.idx;

      const rx = 40, ry = 28;
      const rect = document.createElementNS(ns,"rect");
      rect.setAttribute("x", x-rx); rect.setAttribute("y", y-ry);
      rect.setAttribute("width", rx*2); rect.setAttribute("height", ry*2);
      rect.setAttribute("rx","8"); rect.setAttribute("fill","#161e3a");
      rect.setAttribute("stroke", bColor); rect.setAttribute("stroke-width", isMe?"2.5":"1.5");
      g.appendChild(rect);

      const nameT = document.createElementNS(ns,"text");
      nameT.setAttribute("x",x); nameT.setAttribute("y",y-6);
      nameT.setAttribute("text-anchor","middle"); nameT.setAttribute("font-size","12");
      nameT.setAttribute("fill", isMe?"#ffffff":"#d2d7e6");
      nameT.setAttribute("font-weight", isMe?"bold":"normal");
      nameT.textContent = p.name.slice(0,5);
      g.appendChild(nameT);

      if (role) {
        const roleT = document.createElementNS(ns,"text");
        roleT.setAttribute("x",x); roleT.setAttribute("y",y+10);
        roleT.setAttribute("text-anchor","middle"); roleT.setAttribute("font-size","10");
        roleT.setAttribute("fill", ROLE_COLORS[role]||"#a0a8c0");
        roleT.textContent = role;
        g.appendChild(roleT);
      } else {
        const aT = document.createElementNS(ns,"text");
        aT.setAttribute("x",x); aT.setAttribute("y",y+10);
        aT.setAttribute("text-anchor","middle"); aT.setAttribute("font-size","10");
        aT.setAttribute("fill","#606880");
        aT.textContent = p.is_human ? "真人" : "AI";
        g.appendChild(aT);
      }

      if (isLeader) {
        const crown = document.createElementNS(ns,"text");
        crown.setAttribute("x",x-rx+4); crown.setAttribute("y",y-ry+14);
        crown.setAttribute("font-size","13"); crown.textContent = "👑";
        g.appendChild(crown);
      }

      if (lastVote) {
        const votes = lastVote.votes || {};
        const v = votes[p.idx];
        if (v !== undefined) {
          const vt = document.createElementNS(ns,"text");
          vt.setAttribute("x",x+rx-8); vt.setAttribute("y",y+10);
          vt.setAttribute("font-size","14");
          vt.setAttribute("fill", v ? "#2DB450":"#C82D37");
          vt.textContent = v ? "✓":"✗";
          g.appendChild(vt);
        }
      }

      // team selection click
      g.addEventListener("click", () => {
        const pending = this._pending;
        if (pending && pending.kind === "select_team" && pending.playerIdx === this.myIdx) {
          const ts = pending.data.team_size;
          const idx2 = p.idx;
          const sel = this._selectedTeam;
          const pos = sel.indexOf(idx2);
          if (pos >= 0) sel.splice(pos, 1);
          else if (sel.length < ts) sel.push(idx2);
          this._renderTable(ctx);
          this._renderTeamConfirmBtn(ts);
        }
      });

      svg.appendChild(g);
    });
  }

  _renderTrack(ctx) {
    const div = this.trackDiv;
    div.innerHTML = "";
    const results = ctx.mission_results || [];
    const sizes = ctx.mission_sizes || [2,3,2,3,3];
    const cur = ctx.round_idx || 0;
    for (let i = 0; i < 5; i++) {
      const cell = this._el("div","",`width:82px;height:52px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:13px;gap:2px;border:1px solid #2d4678;`);
      if (i < results.length) {
        cell.style.background = results[i] ? "#1a5a30" : "#5a1a1a";
        cell.innerHTML = `<span>${results[i] ? "✅ 成功":"❌ 失败"}</span>`;
      } else if (i === cur) {
        cell.style.background = "#1a2050";
        cell.innerHTML = `<span style="color:#9ab0e0">R${i+1} 进行中</span>`;
      } else {
        cell.style.background = "#1a1e30";
        cell.innerHTML = `<span style="color:#5a6888">R${i+1}</span>`;
      }
      cell.innerHTML += `<span style="font-size:11px;color:#6070a0">${sizes[i]}人</span>`;
      div.appendChild(cell);
    }
  }

  _renderRolePanel(ctx) {
    const p = this.rolePanel;
    const me = (ctx.players || []).find(pl => pl.idx === this.myIdx);
    if (!me) { p.innerHTML = ""; return; }
    const role = me.role;
    if (!role) { p.innerHTML = `<div style="color:#6070a0;font-size:13px;">等待开始…</div>`; return; }
    const rc = ROLE_COLORS[role] || "#a0a8c0";
    const ac = me.alignment === "好人" ? "#3C78D2" : "#C82D37";
    p.innerHTML = `
      <div style="font-size:14px;font-weight:bold;color:${rc}">${role}</div>
      <div style="font-size:12px;color:${ac}">${me.alignment}</div>
    `;
  }

  _renderVoteHistory(ctx) {
    const div = this.voteHistory;
    div.innerHTML = "";
    const vh = ctx.vote_history || [];
    const players = ctx.players || [];
    const nameOf = idx => { const found = players.find(p => p.idx === idx); return found ? found.name : `#${idx}`; };
    vh.slice().reverse().forEach((vr, ri) => {
      const item = this._el("div","","padding:6px 4px;border-bottom:1px solid #1a2848;margin-bottom:4px;");
      const team = (vr.team_idxs || []).map(nameOf).join("、");
      const passed = vr.passed;
      const roundNum = vh.length - ri;
      const hdr = this._el("div","",`font-weight:bold;color:${passed?"#2DB450":"#C82D37"};font-size:12px;margin-bottom:3px;`);
      hdr.textContent = `第${roundNum}次投票 ${passed?"✅ 通过":"❌ 否决"}`;
      item.appendChild(hdr);
      const teamEl = this._el("div","","font-size:11px;color:#9ab0e0;margin-bottom:3px;");
      teamEl.textContent = `队伍: ${team}`;
      item.appendChild(teamEl);
      const votes = vr.votes || {};
      const approvers = [], rejecters = [];
      Object.entries(votes).forEach(([idx, v]) => {
        (v ? approvers : rejecters).push(nameOf(Number(idx)));
      });
      if (approvers.length) {
        const ap = this._el("div","","font-size:11px;color:#2DB450;");
        ap.textContent = `✓ 赞成(${approvers.length}): ${approvers.join("、")}`;
        item.appendChild(ap);
      }
      if (rejecters.length) {
        const rj = this._el("div","","font-size:11px;color:#e05050;");
        rj.textContent = `✗ 反对(${rejecters.length}): ${rejecters.join("、")}`;
        item.appendChild(rj);
      }
      div.appendChild(item);
    });
  }

  onRequest(playerIdx, kind, data) {
    this._pending = { playerIdx, kind, data };
    this._selectedTeam = [];
    const panel = this.actionPanel;
    panel.innerHTML = "";

    if (playerIdx !== this.myIdx) {
      panel.innerHTML = `<span style="color:#8898ab">等待 ${data.player_name || "#"+playerIdx} 操作…</span>`;
      return;
    }

    if (kind === "show_role") {
      const role = data.your_role || "?"; const al = data.alignment || "?";
      const rc = ROLE_COLORS[role] || "#a0a8c0";
      const desc = data.role_desc || ""; const vis = data.visible || [];
      panel.innerHTML = `
        <div style="font-size:16px;font-weight:bold;color:${rc}">${role} <span style="font-size:13px;color:#8898ab">(${al})</span></div>
        <div style="font-size:12px;color:#8898ab;margin:4px 0">${desc}</div>
        ${vis.map(v=>`<span style="font-size:12px;color:#d2d7e6;border:1px solid #2d4678;padding:2px 8px;border-radius:4px;margin-right:6px;">${v.name}：${v.hint}</span>`).join("")}
      `;
      const btn = this._mkBtn("✅ 我知道了", "#2DB450");
      btn.onclick = () => { this._pending = null; this.respond('show_role', true); panel.innerHTML = ""; };
      panel.appendChild(btn);
    } else if (kind === "select_team") {
      const ts = data.team_size;
      panel.innerHTML = `<div style="color:#D7AA2D;font-weight:bold">请在圆桌上点击选择 ${ts} 名队员（已选 <span id="selCnt">0</span>/${ts}）</div>`;
      this._renderTeamConfirmBtn(ts);
    } else if (kind === "vote_team") {
      const names = (data.team_names||[]).join("、");
      panel.innerHTML = `<div style="color:#D7AA2D;font-weight:bold;">队伍：${names} — 是否赞成出任务？</div>`;
      const yes = this._mkBtn("✅ 赞成", "#2DB450");
      const no = this._mkBtn("❌ 反对", "#C82D37");
      yes.onclick = () => { this._pending = null; this.respond('vote_team', true); panel.innerHTML=""; };
      no.onclick  = () => { this._pending = null; this.respond('vote_team', false); panel.innerHTML=""; };
      panel.appendChild(yes); panel.appendChild(no);
    } else if (kind === "play_mission") {
      const canFail = data.can_fail;
      panel.innerHTML = `<div style="color:#D7AA2D;font-weight:bold;">任务进行中 — 选择任务牌${canFail?" (邪恶方可选失败)":""}</div>`;
      const yes = this._mkBtn("✅ 任务成功", "#2DB450");
      yes.onclick = () => { this._pending = null; this.respond('play_mission', true); panel.innerHTML=""; };
      panel.appendChild(yes);
      if (canFail) {
        const no = this._mkBtn("❌ 任务失败", "#C82D37");
        no.onclick = () => { this._pending = null; this.respond('play_mission', false); panel.innerHTML=""; };
        panel.appendChild(no);
      }
    } else if (kind === "assassinate") {
      panel.innerHTML = `<div style="color:#C82D37;font-weight:bold;">${data.assassin_name||"刺客"}，选择刺杀目标：</div>`;
      const cands = data.candidate_idxs || [], cnames = data.candidate_names || [];
      cands.forEach((ci, ii) => {
        const btn = this._mkBtn(cnames[ii]||`#${ci}`, "#8c2028");
        btn.onclick = () => { this._pending = null; this.respond('assassinate', ci); panel.innerHTML=""; };
        panel.appendChild(btn);
      });
    }
  }

  _renderTeamConfirmBtn(ts) {
    const old = document.getElementById("_teamConfirm");
    if (old) old.remove();
    const panel = this.actionPanel;
    const sc = document.getElementById("selCnt");
    if (sc) sc.textContent = this._selectedTeam.length;
    if (this._selectedTeam.length === ts) {
      const btn = this._mkBtn("✅ 确认队伍", "#2DB450");
      btn.id = "_teamConfirm";
      btn.onclick = () => {
        const sel = [...this._selectedTeam];
        this._pending = null; this._selectedTeam = [];
        this.respond('select_team', sel); panel.innerHTML="";
      };
      panel.appendChild(btn);
    }
  }

  _mkBtn(label, color) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = `background:${color};color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin:4px 8px 4px 0;`;
    return btn;
  }

  onGameOver(result) {
    this._pending = null;
    this.actionPanel.innerHTML = '';   // 清除残留的操作按钮
    const winner = result.winner;
    const color = winner === "good" ? "#2DB450" : "#C82D37";
    const overlay = this._el("div","","position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:100;");
    overlay.style.position = "absolute";
    const box = this._el("div","","background:#161e3a;border:2px solid #2d4678;border-radius:12px;padding:24px 32px;text-align:center;max-width:600px;");
    const wt = winner === "good" ? "🏆 好人阵营获胜" : "👿 邪恶阵营获胜";
    box.innerHTML = `<div style="font-size:24px;font-weight:bold;color:${color}">${wt}</div>
      <div style="color:#a0a8c0;margin:8px 0 16px">${result.end_reason||""}</div>`;
    const grid = this._el("div","","display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:16px;");
    (result.players||[]).forEach(p => {
      const rc = p.alignment === "好人" ? "#3C78D2" : "#C82D37";
      const card = this._el("div","",`border:2px solid ${rc};border-radius:8px;padding:8px 12px;min-width:80px;`);
      card.innerHTML = `<div style="font-weight:bold">${p.name}</div>
        <div style="font-size:12px;color:${ROLE_COLORS[p.role]||"#a0a8c0"}">${p.role||"?"}</div>
        <div style="font-size:11px;color:${rc}">${p.alignment}</div>`;
      grid.appendChild(card);
    });
    box.appendChild(grid);
    const closeBtn = this._mkBtn("关闭", "#2d4678");
    closeBtn.onclick = () => overlay.remove();
    box.appendChild(closeBtn);
    const restartBtn = this._mkBtn("🔄 重新开始", "#2980b9");
    restartBtn.onclick = () => { overlay.remove(); if (typeof voteRestart === 'function') voteRestart(); };
    box.appendChild(restartBtn);
    overlay.appendChild(box);
    this.container.style.position = "relative";
    this.container.appendChild(overlay);
  }
}

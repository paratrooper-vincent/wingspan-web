// 展翅翱翔 · 客户端 UI 渲染（纯函数式：由 G.view 驱动）
export const $ = sel => document.querySelector(sel);
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (id, cls) => `<svg class="icon ${cls || ''}"><use href="#${id}"/></svg>`;
export const FOOD_ICON = { invertebrate: 'i-inv', seed: 'i-seed', fish: 'i-fish', fruit: 'i-fruit', rodent: 'i-rodent', wild: 'i-wild', none: 'i-none' };
export const FOOD_ZH = { invertebrate: '无脊椎', seed: '种子', fish: '鱼', fruit: '水果', rodent: '啮齿', wild: '任意' };
export const HAB_ZH = { forest: '森林', grassland: '草原', wetland: '湿地' };
export const NEST_ICON = { bowl: 'n-bowl', cavity: 'n-cavity', ground: 'n-ground', platform: 'n-platform', wild: 'n-wild', none: 'i-none' };
export const NEST_ZH = { bowl: '碗巢', cavity: '洞巢', ground: '地巢', platform: '平台巢', wild: '星形（万能）', none: '无巢' };
export const HAB_ICON = { forest: 'h-forest', grassland: 'h-grassland', wetland: 'h-wetland' };
export const ACTION_ICON = { play_bird: 'a-play', gain_food: 'a-food', lay_eggs: 'a-eggs', draw_cards: 'a-draw' };
export const ACTION_ZH = { play_bird: '打出鸟类', gain_food: '获取食物', lay_eggs: '产蛋', draw_cards: '抽取鸟卡' };

export function imgUrl(file) { return '/assets/' + file; }

// ---------- 数据便捷查找 ----------
export function birdOf(G, id) { return G.DATA.birds.find(b => b.id === id); }
export function bonusOf(G, id) { return G.DATA.bonus.find(b => b.id === id); }
export function goalOf(G, id) { return G.DATA.goals.find(g => g.id === id); }
export function me(G) { return G.view.players.find(p => p.pid === G.pid); }
export function playerByPid(G, pid) { return G.view.players.find(p => p.pid === pid); }

// ---------- 客户端目标计数（与引擎 goalCount 同步的视图版） ----------
export function goalCountView(G, pid, goalId) {
  const p = playerByPid(G, pid);
  if (!p) return 0;
  const all = Object.values(p.habitats).flat();
  const D = id => birdOf(G, id);
  const eggsIn = h => p.habitats[h].reduce((a, x) => a + x.eggs, 0);
  const nestEggs = nest => all.reduce((a, x) => a + (nestMatchesV(D(x.card).nest, nest) ? x.eggs : 0), 0);
  const nestBirds = nest => all.filter(x => nestMatchesV(D(x.card).nest, nest));
  switch (goalId) {
    case 'goal_egg_sets': return Math.min(p.habitats.forest.reduce((a, x) => a + x.eggs, 0), p.habitats.grassland.reduce((a, x) => a + x.eggs, 0), p.habitats.wetland.reduce((a, x) => a + x.eggs, 0));
    case 'goal_egg_forest': return eggsIn('forest');
    case 'goal_egg_wetland': return eggsIn('wetland');
    case 'goal_egg_grassland': return eggsIn('grassland');
    case 'goal_egg_ground': return nestEggs('ground');
    case 'goal_egg_bowl': return nestEggs('bowl');
    case 'goal_egg_platform': return nestEggs('platform');
    case 'goal_egg_cavity': return nestEggs('cavity');
    case 'goal_total_birds': return all.length;
    case 'goal_bird_forest': return p.habitats.forest.length;
    case 'goal_bird_wetland': return p.habitats.wetland.length;
    case 'goal_bird_grassland': return p.habitats.grassland.length;
    case 'goal_bird_egg_ground': return nestBirds('ground').filter(x => x.eggs > 0).length;
    case 'goal_bird_egg_bowl': return nestBirds('bowl').filter(x => x.eggs > 0).length;
    case 'goal_bird_egg_platform': return nestBirds('platform').filter(x => x.eggs > 0).length;
    case 'goal_bird_egg_cavity': return nestBirds('cavity').filter(x => x.eggs > 0).length;
    default: return 0;
  }
}
const nestMatchesV = (nest, want) => nest === want || nest === 'wild';

// ---------- 顶栏 ----------
export function renderTopbar(G) {
  const v = G.view;
  $('#tb-mode').textContent = ({ base: '基础 4–5人', flock: 'Flock 6–7人', extended: '扩展 8人·非官方' })[v.mode];
  $('#tb-mode').className = 'badge' + (v.extended ? ' warn' : '');
  $('#tb-room').textContent = G.roomCode ? '房间 ' + G.roomCode : '单机';
  const acts = me(G) ? me(G).cubesSupply : 0;
  $('#tb-round').innerHTML = `第 <b class="num">${v.round}</b>/4 轮 · 我还剩 <b class="num" style="color:var(--gold)">${acts}</b> 个行动`;
  const names = (v.activePids || []).map(pid => { const p = playerByPid(G, pid); return p ? `<b>${esc(p.name)}</b>` : ''; }).join(' 与 ');
  const isMy = (v.turnPid === G.pid);
  $('#tb-active').innerHTML = v.phase === 'done' ? '对局结束' :
    (names ? `${isMy ? '🎯 ' : ''}轮到 ${names}` : '结算中…');
  document.body.dataset.focus = (v.activePids && v.activePids.length && !v.activePids.includes(G.pid)) ? 'dim' : 'me';
}

// ---------- 公共区 ----------
export function renderPublic(G, callbacks) {
  const v = G.view;
  const box = $('#public-area');
  box.innerHTML = '';
  const groups = v.groups.length > 1 ? v.groups : [v.groups[0]];
  const myGroup = me(G)?.group || groups[0].id;
  for (const g of groups) {
    const gid = g.id;
    const feeder = v.public['feeder_' + gid];
    const tray = v.public['tray_' + gid];
    const isMine = gid === myGroup;
    // 喂食器
    const fe = el('div', 'pub-card');
    if (!isMine) fe.style.opacity = .66;
    fe.innerHTML = `<div class="pub-title">喂食器${groups.length > 1 ? `<div class="pub-group-tag">${gid}组</div>` : ''}</div>`;
    const diceRow = el('div', 'dice-row');
    const pickableKind = G.pending && G.pending.kind === 'pick_die' && isMine;
    feeder.forEach(d => {
      const die = el('div', 'die' + (d.in ? '' : ' out') + (pickableKind && d.in ? ' pickable' : ''));
      die.dataset.face = d.face;
      die.dataset.dieId = d.id;
      die.title = faceZh(d.face);
      if (d.in && d.face !== 'seed_or_invertebrate') die.innerHTML = icon(FOOD_ICON[d.face]);
      else if (d.in) die.innerHTML = icon('i-seed') + icon('i-inv');
      else die.innerHTML = icon(FOOD_ICON[d.face === 'seed_or_invertebrate' ? 'seed' : d.face]);
      if (pickableKind && d.in) die.onclick = () => callbacks.pickDie(d.face);
      diceRow.appendChild(die);
    });
    fe.appendChild(diceRow);
    if (pickableKind) {
      const rb = el('button', 'btn reroll-btn', '全部同面，可重掷');
      rb.onclick = () => callbacks.reroll();
      fe.appendChild(rb);
    }
    box.appendChild(fe);
    // 鸟托盘
    const tr = el('div', 'pub-card');
    if (!isMine) tr.style.opacity = .66;
    tr.innerHTML = `<div class="pub-title">鸟托盘${groups.length > 1 ? `<div class="pub-group-tag">${gid}组</div>` : ''}</div>`;
    const wrap = el('div', 'tray-wrap');
    const trayPick = G.pending && G.pending.kind === 'draw_pick_source' && isMine;
    const cards = el('div', 'tray-cards');
    tray.forEach((cid, i) => {
      const slot = el('div', 'tray-slot' + (cid ? '' : ' empty') + (trayPick && cid ? ' pickable' : ''));
      if (cid) {
        const b = birdOf(G, cid);
        slot.innerHTML = `<img src="${imgUrl(b.file)}" alt="${esc(b.name_zh)}">`;
        slot.title = `${b.name_zh}（${b.name_en}）`;
        if (trayPick) slot.onclick = () => callbacks.drawSource('tray' + i);
      } else slot.textContent = '待补';
      cards.appendChild(slot);
    });
    wrap.appendChild(cards);
    const deck = el('div', 'deck-stack' + (trayPick ? ' pickable' : ''));
    deck.innerHTML = `<div class="cnt num">${v.public['deck_' + gid]}</div><div class="lbl">牌库</div>`;
    if (trayPick) deck.onclick = () => callbacks.drawSource('deck');
    wrap.appendChild(deck);
    const disc = el('div', '', `<div style="font-size:11px;color:var(--ink-3);text-align:center">弃牌堆<br><b class="num">${v.public['discard_' + gid]}</b></div>`);
    wrap.appendChild(disc);
    tr.appendChild(wrap);
    box.appendChild(tr);
  }
}
const faceZh = f => f === 'seed_or_invertebrate' ? '种子 / 无脊椎（二选一）' : FOOD_ZH[f];

// ---------- 我的面板 ----------
export function renderMat(G, callbacks) {
  const v = G.view, m = me(G);
  const mat = $('#mat');
  mat.innerHTML = '';
  // 打鸟行
  const strip = el('div', 'mat-row play-strip');
  const ps = el('div', 'ps-label', `${icon('a-play')} 打出一只鸟`);
  strip.appendChild(ps);
  const spaces = el('div', 'ps-spaces');
  const playedTotal = Object.values(m.habitats).flat().length;
  for (let i = 0; i < 5; i++) {
    const sp = el('div', 'aspace' + (playedTotal > i ? ' used' : ''), playedTotal > i ? '🁢' : '');
    if (playedTotal === i) { // 下一个打鸟目标列
      const cost = G.DATA.mat.play_egg_cost[i];
      sp.innerHTML = `<span class="egg-cost">${icon('i-egg')}×${cost}</span>`;
    }
    spaces.appendChild(sp);
  }
  strip.appendChild(spaces);
  strip.appendChild(el('div', 'spacer'));
  strip.appendChild(el('div', '', `<span style="font-size:12px;color:var(--ink-3)">蛋成本 0/1/1/2/2</span>`));
  mat.appendChild(strip);

  // 三栖息地
  const habAction = { forest: ['获取食物', 'a-food'], grassland: ['产蛋', 'a-eggs'], wetland: ['抽取鸟卡', 'a-draw'] };
  const pickHab = G.pending && G.pending.kind === 'play_pick_habitat';
  for (const hab of ['forest', 'grassland', 'wetland']) {
    const row = el('div', 'mat-row ' + hab);
    const head = el('div', 'hab-head');
    const legal = pickHab && (G.pending.data.habitats || []).includes(hab);
    if (legal) { head.style.cursor = 'pointer'; head.style.outline = '3px solid var(--gold)'; head.onclick = () => callbacks.pickHabitat(hab); }
    head.innerHTML = `
      <div class="hab-name">${HAB_ZH[hab]}</div>
      <div class="hab-action">${icon(habAction[hab][1])} ${habAction[hab][0]}</div>
      <div class="bird-count">${icon('a-play')} ${m.habitats[hab].length}/5</div>`;
    row.appendChild(head);
    const body = el('div', 'hab-body habbg');
    const slots = el('div', 'slots');
    const guide = pickHab && (G.pending.data.habitats || []).includes(hab);
    for (let i = 0; i < 5; i++) {
      const inst = m.habitats[hab][i];
      const slot = el('div', 'slot');
      if (inst) {
        const b = birdOf(G, inst.card);
        const card = birdCardEl(G, b, inst, callbacks);
        slot.appendChild(card);
      } else if (i === m.habitats[hab].length) {
        if (guide) { slot.classList.add('guide'); slot.onclick = () => callbacks.pickHabitat(hab); }
        const cost = G.DATA.mat.play_egg_cost[i];
        slot.innerHTML = `<div class="slot-cost">${icon('i-egg')}×${cost}</div>`;
      }
      slots.appendChild(slot);
    }
    body.appendChild(slots);
    // 行动槽收益条
    const as = el('div', 'action-spaces');
    const cfg = G.DATA.mat[hab][Math.min(m.habitats[hab].length, 4)];
    const gainHtml = hab === 'forest' ? Array(cfg.dice).fill(icon('i-wild')).join('') :
      hab === 'grassland' ? `${icon('i-egg')}×${cfg.eggs}` : `${icon('a-draw')}×${cfg.cards}`;
    as.innerHTML = `<span class="gain-icon">${gainHtml}</span>` +
      (cfg.exchange ? `<span class="exch">${exchZh(cfg.exchange)}</span>` : '') +
      `<span style="margin-left:auto;font-size:10.5px;color:var(--ink-3)">下一个行动位（第 ${Math.min(m.habitats[hab].length + 1, 5)} 格）</span>`;
    body.appendChild(as);
    row.appendChild(body);
    mat.appendChild(row);
  }
}
const exchZh = t => ({ card_food: '可弃 1 卡换 1 食', food_egg: '可付 1 食换 1 蛋', egg_card: '可弃 1 蛋换 1 卡' })[t] || '';

export function birdCardEl(G, b, inst, callbacks) {
  const card = el('div', 'bird-card' + (b.power ? ' power-' + b.power.color : ''));
  card.innerHTML = `<img src="${imgUrl(b.file)}" alt="${esc(b.name_zh)}">` +
    (inst.eggs ? `<div class="ov ov-eggs">${icon('i-egg')}<span class="num">${inst.eggs}</span></div>` : '') +
    (inst.cached.length ? `<div class="ov ov-cache">${icon(FOOD_ICON[inst.cached[0]])}×${inst.cached.length}</div>` : '') +
    (inst.tucked ? `<div class="ov ov-tuck">${icon('a-draw')}<span class="num">${inst.tucked}</span></div>` : '') +
    `<div class="ov ov-pts">${b.points}</div>`;
  card.title = `${b.name_zh} ${b.name_en} | ${b.points}分 | ${NEST_ZH[b.nest]} 蛋上限${b.egg_limit} | 翼展${b.wingspan}cm`;
  if (callbacks && callbacks.onBirdClick) card.onclick = e => callbacks.onBirdClick(inst, card, e);
  return card;
}

// ---------- 侧栏 ----------
export function renderSidebar(G, callbacks) {
  const v = G.view;
  // 目标板
  const gp = $('#goal-panel');
  gp.innerHTML = `<div class="panel-title">${icon('i-points')} 轮末目标（${v.goalSide === 'green' ? '绿面·名次' : '蓝面·每物品1分'}）</div>`;
  const lastRound = v.goalResults[v.goalResults.length - 1];
  v.goalIds.forEach((gid, i) => {
    const g = goalOf(G, gid);
    if (!g) return;
    const tile = el('div', 'goal-tile');
    const cnt = goalCountView(G, G.pid, gid);
    const mine = lastRound?.perGoal[i]?.rows.find(r => r.pid === G.pid);
    tile.innerHTML = `<img src="${imgUrl(g.file)}" alt="${esc(g.name_zh)}">
      <div class="goal-info"><div class="g-name">${esc(g.name_zh)}</div><div class="g-tip">${esc(g.tip_zh)}</div></div>
      <div class="goal-mine"><div class="g-count num">${cnt}</div><div class="g-rank">${mine ? `上轮第${mine.rank}名 +${mine.points}分` : '本轮进行中'}</div></div>`;
    gp.appendChild(tile);
  });
  // 玩家列表
  const pp = $('#players-panel');
  pp.innerHTML = `<div class="panel-title">${icon('h-forest')} 玩家</div>`;
  const scored = v.finalScores;
  const estScore = p => {
    if (scored) { const r = scored.find(x => x.pid === p.pid); return r ? r.total : 0; }
    // 估算：鸟分+蛋+储存+塞卡+目标分（鸟分实时，其余按已记录目标结果）
    const birds = Object.values(p.habitats).flat();
    let s = birds.reduce((a, x) => a + birdOf(G, x.card).points + x.eggs + x.cached.length + x.tucked, 0);
    if (v.goalResults) s += v.goalResults.reduce((a, r) => a + r.perGoal.reduce((b, gg) => b + (gg.rows.find(x => x.pid === p.pid)?.points || 0), 0), 0);
    return s;
  };
  [...v.players].sort((a, b) => estScore(b) - estScore(a)).forEach(p => {
    const row = el('div', 'player-row' + (v.activePids?.includes(p.pid) ? ' active' : '') + (p.group === 'B' && v.groups.length > 1 ? ' groupB' : ''));
    const active = v.turnPid === p.pid;
    row.innerHTML = `
      <span class="player-dot" style="background:${p.color}" title="${p.group}组"></span>
      <span class="player-name">${esc(p.name)}${p.pid === G.pid ? '<span class="me-tag">我</span>' : ''}${p.bot ? ' 🤖' : ''}</span>
      <span class="p-badge">${p.handCount}卡·${p.foodCount}食</span>
      <span class="player-score num">${estScore(p)}</span>`;
    if (p.pid !== G.pid) {
      const vb = el('button', 'btn view-btn', '面板');
      vb.onclick = () => callbacks.viewPlayer(p);
      row.appendChild(vb);
    }
    if (active) row.appendChild(el('span', 'p-badge', '行动中'));
    pp.appendChild(row);
  });
  if (v.groups.length > 1) {
    pp.appendChild(el('div', 'queued', `A/B 组各有独立喂食器与托盘 · 当前活跃：${v.activePids.map(x => esc(playerByPid(G, x)?.name || '')).join('、')}`));
  }
  // 日志
  const lp = $('#log-panel');
  lp.innerHTML = `<div class="panel-title">${icon('a-draw')} 对局日志</div>`;
  const list = el('div', ''); list.id = 'log-list';
  v.log.forEach(e => list.appendChild(logItem(G, e)));
  lp.appendChild(list);
  list.scrollTop = list.scrollHeight;
}

export function logItem(G, e) {
  const item = el('div', 'log-item');
  const d = e.data || {};
  const P = pid => esc(playerByPid(G, pid)?.name || pid);
  const B = id => { const b = birdOf(G, id); return b ? b.name_zh : id; };
  const bn = id => `<b>${B(id)}</b>`;
  switch (e.type) {
    case 'round_start': item.innerHTML = `—— 第 ${d.round} 轮开始 ——`; item.style.textAlign = 'center'; item.style.color = 'var(--gold)'; break;
    case 'wave_start': item.innerHTML = `${(d.pids || []).map(P).join(' 与 ')} 同时行动`; break;
    case 'turn_start': item.innerHTML = `▸ ${P(d.pid)} 的回合`; break;
    case 'bird_played': item.innerHTML = `${P(d.pid)} 打出 ${bn(d.card)} → ${HAB_ZH[d.habitat]}（第 ${d.col + 1} 列，蛋成本 ${d.eggCost}）`; break;
    case 'action_gain_food': item.innerHTML = `${P(d.pid)} 获取食物 ×${d.dice}`; break;
    case 'action_lay_eggs': item.innerHTML = `${P(d.pid)} 产蛋 ×${d.eggs}`; break;
    case 'action_draw': item.innerHTML = `${P(d.pid)} 抽取鸟卡 ×${d.cards}`; break;
    case 'food_gained': item.innerHTML = `${P(d.pid)} 获得 ${icon(FOOD_ICON[d.food])}${FOOD_ZH[d.food] || d.food}${d.n > 1 ? ' ×' + d.n : ''}${d.from === 'feeder' ? '（喂食器）' : '（供应区）'}`; break;
    case 'food_cached': item.innerHTML = `${P(d.pid)} 在 ${bn(d.card)} 上储存 ${icon(FOOD_ICON[d.food])}${d.n > 1 ? '×' + d.n : ''}`; break;
    case 'feeder_rerolled': item.innerHTML = `骰子全部重掷：${(d.faces || []).map(f => icon(FOOD_ICON[f === 'seed_or_invertebrate' ? 'seed' : f])).join(' ')}`; break;
    case 'card_drawn': item.innerHTML = `${P(d.pid)} 抽 ${d.n > 1 ? d.n + ' 张卡' : '1 张卡'}${d.card ? '（托盘：' + bn(d.card) + '）' : ''}`; break;
    case 'card_tucked': item.innerHTML = `${P(d.pid)} 塞牌 ×${d.n} 到 ${bn(d.card)}`; break;
    case 'card_discarded': item.innerHTML = `${P(d.pid)} 弃置 ${d.eot ? '（回合末）' : ''}${d.card ? bn(d.card) : d.n + ' 张卡'}`; break;
    case 'eggs_laid': item.innerHTML = `${P(d.pid)} 产蛋 ×${d.n}${d.card ? '（' + bn(d.card) + '）' : ''}`; break;
    case 'eggs_lost': item.innerHTML = `${P(d.pid)} 蛋容量不足，损失 ${d.lost} 蛋`; break;
    case 'predator_roll': item.innerHTML = `${P(d.pid)} 掷骰 ${(d.faces || []).map(f => icon(FOOD_ICON[f === 'seed_or_invertebrate' ? 'seed' : f])).join(' ')} ${d.success ? '→ 捕猎成功！' : '→ 未命中'}`; break;
    case 'power_activated': item.innerHTML = `${P(d.pid)} 触发 ${bn(d.card)} 的${({ white: '白色', brown: '棕色', pink: '粉色', teal: '青色', yellow: '黄色' })[d.color]}能力`; break;
    case 'power_fizzled': item.innerHTML = `${bn(d.card)}：${esc(d.reason || '条件不满足')}`; break;
    case 'power_skipped': item.innerHTML = `${P(d.pid)} 跳过 ${bn(d.card)}`; break;
    case 'bird_moved': item.innerHTML = `${P(d.pid)} 迁徙 ${bn(d.card)}：${HAB_ZH[d.from]} → ${HAB_ZH[d.to]}`; break;
    case 'egg_discarded_gain': item.innerHTML = `${P(d.pid)} 弃 1 蛋换任意食物 ×${d.n}`; break;
    case 'all_draw': item.innerHTML = `${P(d.pid)} 的效果：所有玩家各抽 1 卡`; break;
    case 'all_gain': item.innerHTML = `${P(d.pid)} 的效果：所有玩家各得 ${icon(FOOD_ICON[d.food])}×${d.n}`; break;
    case 'fewest_draw': item.innerHTML = `${HAB_ZH[d.habitat]}鸟最少的玩家各抽 1 卡`; break;
    case 'bonus_kept': item.innerHTML = `${P(d.pid)} 保留了新奖励卡`; break;
    case 'deck_reshuffled': item.innerHTML = `${d.group} 组牌库耗尽，弃牌堆重洗成新牌库`; break;
    case 'first_player_pass': item.innerHTML = `先手标记传给 ${P(d.to)}`; break;
    case 'round_end': item.innerHTML = `—— 第 ${d.round} 轮结束 ——`; item.style.textAlign = 'center'; item.style.color = 'var(--gold)'; break;
    case 'goal_scored': item.innerHTML = `轮末目标计分完成`; break;
    case 'game_over': item.innerHTML = `🏁 对局结束！${(d.winners || []).map(P).join('、')} 获胜`; item.style.color = 'var(--gold)'; break;
    case 'initial_keep': item.innerHTML = `${P(d.pid)} 完成开局抉择（保留 ${d.birds} 鸟 + ${d.food} 食）`; break;
    case 'exchange_card_food': item.innerHTML = `${P(d.pid)} 弃 1 卡换 1 食物`; break;
    case 'exchange_food_egg': item.innerHTML = `${P(d.pid)} 付 1 食物换 1 蛋`; break;
    case 'exchange_egg_card': item.innerHTML = `${P(d.pid)} 弃 1 蛋换 1 卡`; break;
    default: item.innerHTML = `${e.type}`; break;
  }
  return item;
}

// ---------- 底部：行动按钮 + 食物 + 手牌 ----------
export function renderHandbar(G, callbacks) {
  const m = me(G);
  const v = G.view;
  const isMyPending = G.pending && G.pending.pid === G.pid;
  // 行动按钮
  const ab = $('#action-buttons');
  ab.innerHTML = '';
  const legal = isMyPending && G.pending.kind === 'pick_action' ? G.pending.data.legal : [];
  const acts = [
    { id: 'play_bird', zh: '打出鸟类', sub: '支付食物与蛋' },
    { id: 'gain_food', zh: '获取食物', sub: subFor(G, 'forest') },
    { id: 'lay_eggs', zh: '产蛋', sub: subFor(G, 'grassland') },
    { id: 'draw_cards', zh: '抽取鸟卡', sub: subFor(G, 'wetland') },
  ];
  for (const a of acts) {
    const btn = el('button', 'action-btn' + (legal.includes(a.id) ? ' myturn' : ''));
    btn.disabled = !legal.includes(a.id);
    btn.innerHTML = `${icon(ACTION_ICON[a.id])} ${a.zh}<span class="sub">${a.sub}</span>`;
    btn.onclick = () => callbacks.action(a.id);
    ab.appendChild(btn);
  }
  // 食物
  const ft = $('#food-tray');
  ft.innerHTML = `<div class="pub-title" style="letter-spacing:1px">我的食物</div>`;
  for (const f of ['invertebrate', 'seed', 'fish', 'fruit', 'rodent']) {
    const pile = el('div', 'food-pile' + (m.food[f] === 0 ? ' zero' : ''));
    pile.innerHTML = `${icon(FOOD_ICON[f])}<span class="cnt num">${m.food[f]}</span>`;
    pile.title = FOOD_ZH[f];
    ft.appendChild(pile);
  }
  // 手牌
  const hc = $('#hand-cards');
  hc.innerHTML = '';
  const handPick = isMyPending && ['play_pick_bird', 'tuck_pick', 'exchange_pick_card', 'eot_discard', 'pick_distributed_card'].includes(G.pending.kind);
  const legalBirds = isMyPending && G.pending.kind === 'play_pick_bird' ? G.pending.data.candidates : null;
  const tuckCards = isMyPending && G.pending.kind === 'tuck_pick' ? G.pending.data.hand : null;
  (m.hand || []).forEach((cid, idx) => {
    const b = birdOf(G, cid);
    const card = el('div', 'hand-card');
    let dim = false;
    if (legalBirds) dim = !legalBirds.includes(cid);
    if (tuckCards) dim = false;
    if (handPick) card.classList.add('pickable');
    if (dim) card.classList.add('dim');
    if (G.ui && G.ui.selection && G.ui.selection.includes(cid)) card.classList.add('sel');
    card.innerHTML = `<img src="${imgUrl(b.file)}" alt="${esc(b.name_zh)}">` +
      (G.lastDrawn && G.lastDrawn.includes(idx) ? '<span class="hc-new">新</span>' : '');
    card.title = cardTooltip(G, b);
    if (handPick) card.onclick = () => callbacks.handPick(cid, b);
    else card.onclick = () => callbacks.showCard(b);
    hc.appendChild(card);
  });
  if (!m.hand.length) hc.appendChild(el('div', 'hand-empty', '手牌为空 —— 用「抽取鸟卡」行动补充'));
}
function subFor(G, hab) {
  const m = me(G);
  const cfg = G.DATA.mat[hab][Math.min(m.habitats[hab].length, 4)];
  if (hab === 'forest') return `${cfg.dice} 颗骰子` + (cfg.exchange ? ' + 弃卡换食' : '');
  if (hab === 'grassland') return `${cfg.eggs} 颗蛋` + (cfg.exchange ? ' + 食物换蛋' : '');
  return `${cfg.cards} 张卡` + (cfg.exchange ? ' + 弃蛋换卡' : '');
}
export function cardTooltip(G, b) {
  const cost = b.food_cost.map(c => c.any_of ? c.any_of.map(a => FOOD_ZH[a.type]).join('/') : c.type === 'wild' ? '任意' + (c.amount > 1 ? '×' + c.amount : '') : FOOD_ZH[c.type] + (c.amount > 1 ? '×' + c.amount : '')).join(' + ');
  return `${b.name_zh}（${b.name_en}）
${b.points} 分 | ${b.habitats.map(h => HAB_ZH[h]).join('/')} | 成本 ${cost || '无'}
${NEST_ZH[b.nest]} · 蛋上限 ${b.egg_limit} · 翼展 ${b.wingspan}cm
${b.power ? b.power.text_zh || b.power.text : '无能力'}`;
}

// ---------- 成本显示工具 ----------
export function costHtml(G, cost) {
  return cost.map(c => {
    if (c.any_of) return c.any_of.map(a => icon(FOOD_ICON[a.type])).join('<span style="opacity:.5">/</span>');
    if (c.type === 'none') return icon('i-none');
    return icon(FOOD_ICON[c.type]).repeat(c.amount || 1);
  }).join(' ');
}

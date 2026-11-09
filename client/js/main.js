// 展翅翱翔 · 客户端主控制器
// 在线模式：WebSocket 连接服务器（服务端权威）；单机模式：引擎在浏览器内运行。
import { $, el, esc, icon, FOOD_ICON, FOOD_ZH, HAB_ZH, NEST_ICON, NEST_ZH, ACTION_ZH, imgUrl,
  birdOf, bonusOf, goalOf, me, playerByPid, renderTopbar, renderPublic, renderMat, renderSidebar,
  renderHandbar, costHtml, birdCardEl } from './ui.js';

const G = {
  DATA: null, pid: null, view: null, pending: null,
  ws: null, mode: null, // 'online' | 'local'
  roomCode: null, name: localStorage.getItem('ws-name') || '',
  local: null, // {state, driver}
  ui: { selection: null, allocTemp: null },
  lastRev: 0,
};

// ---------------- 初始化 ----------------
const WS_MAX_RETRY = 5;
let wsRetries = 0;
async function boot() {
  G.DATA = await (await fetch('/data/game_data.json')).json();
  initHome();
  connectWs();
}
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try { ws = new WebSocket(proto + '://' + location.host + '/ws'); }
  catch { G.mode = 'local'; return; }
  G.ws = ws; G.mode = 'online';
  ws.onopen = () => { wsRetries = 0; hello(); };
  ws.onmessage = ev => onServerMessage(JSON.parse(ev.data));
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onclose = () => {
    if (G.mode === 'local') return; // 单机模式不重连
    if (wsRetries < WS_MAX_RETRY) {
      const delay = Math.min(1000 * 2 ** wsRetries, 12000);
      wsRetries++;
      if (G.view) toast(`连接中断，${Math.round(delay / 1000)} 秒后自动重连（第 ${wsRetries}/${WS_MAX_RETRY} 次）`, 'info', delay);
      setTimeout(connectWs, delay);
    } else if (G.view) {
      toast('与服务器断开连接且重连失败，请刷新页面重连', 'danger', 8000);
    }
  };
}
function send(obj) { if (G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(obj)); }
function hello() { send({ type: 'hello', name: G.name }); }
function answer(a) {
  if (G.mode === 'online') send({ type: 'answer', answer: a });
  else {
    G.local.driver.answer(a);
    afterLocalPump();
  }
}
function onServerMessage(msg) {
  switch (msg.type) {
    case 'welcome': G.pid = msg.pid; break;
    case 'room': {
      G.roomCode = msg.code;
      showScreen('lobby');
      $('#lobby-code').textContent = msg.code;
      const modeZh = { base: '基础模式 4–5 人', flock: 'Flock 模式 6–7 人', extended: '扩展模式 8 人（非官方）' }[msg.cfg.mode];
      $('#lobby-meta').textContent = `${modeZh} · 目标板${msg.cfg.goalSide === 'green' ? '绿面' : '蓝面'} · 共 ${msg.cfg.total} 人`;
      const box = $('#lobby-players'); box.innerHTML = '';
      const need = msg.cfg.total - msg.players.length;
      msg.players.forEach((p, i) => box.appendChild(el('div', 'lobby-p' + (i === 0 ? ' owner' : ''), esc(p.name))));
      for (let i = 0; i < need; i++) box.appendChild(el('div', 'lobby-p', '🤖 机器人'));
      $('#btn-start').classList.toggle('hidden', !msg.players.some(p => p.pid === G.pid) || msg.players[0].pid !== G.pid);
      break;
    }
    case 'game': {
      G.view = msg.view;
      G.pending = msg.pending || null;
      if (G.view.phase === 'done') G.pending = null;
      onGameState();
      break;
    }
    case 'chat': toast(`${esc(msg.from)}：${esc(msg.text)}`, 'info', 5000); break;
    case 'error': toast(msg.msg || msg.code, 'danger'); break;
  }
}

// ---------------- 单机模式 ----------------
async function startLocal(cfg) {
  const engine = await import('/shared/engine.js');
  engineView = st => engine.stateView(st, G.pid || 'me', G.DATA);
  const colors = ['purple', 'blue', 'yellow', 'red', 'green', 'teal', 'white', 'orange'];
  const n = cfg.total;
  const players = [{ pid: 'me', name: G.name || '我', color: colors[0], bot: false }];
  for (let i = 1; i < n; i++) players.push({ pid: 'bot' + i, name: '机器人' + i, color: colors[i], bot: true });
  G.local = { state: engine.createGame({ mode: cfg.mode, players, seed: (Math.random() * 2 ** 31) >>> 0, goalSide: cfg.goalSide }, G.DATA) };
  G.local.driver = new engine.MatchDriver(G.local.state, G.DATA);
  G.pid = 'me'; G.mode = 'local'; G.roomCode = null;
  G.local.driver.pump(); // 推进到首个人类决策点（或机器人打完）
  afterLocalPump();
}
function afterLocalPump() {
  const st = G.local.state;
  G.view = engineView(st);
  G.pending = st.pending && st.pending.pid === 'me' ? { pid: st.pending.pid, kind: st.pending.kind, data: st.pending.data } : null;
  if (G.view.phase === 'done') G.pending = null;
  onGameState();
}
let engineView = null; // startLocal 时装配

// ---------------- 视图刷新 ----------------
let roundBannerShown = -1;
async function onGameState() {
  if (!G.view) return;
  showScreen('game');
  const callbacks = makeCallbacks();
  renderTopbar(G);
  renderPublic(G, callbacks);
  renderMat(G, callbacks);
  renderSidebar(G, callbacks);
  renderHandbar(G, callbacks);
  handlePending(callbacks);
  // 轮末横幅
  const gr = G.view.goalResults;
  if (gr && gr.length && gr.length !== roundBannerShown) {
    roundBannerShown = gr.length;
    showRoundSummary(gr[gr.length - 1]);
  }
  // 终局
  if (G.view.phase === 'done' && G.view.finalScores && !G._winShown) {
    G._winShown = true;
    showFinalScores();
  }
}

// ---------------- 决策交互（pending → UI） ----------------
function myPending() { return G.pending && G.pending.pid === G.pid ? G.pending : null; }

function handlePending(callbacks) {
  const hb = $('#hint-bar');
  const p = myPending();
  if (G._lastPendingKind !== (p && p.kind)) { G.ui.selection = []; G._lastPendingKind = p && p.kind; }
  hb.classList.add('hidden');
  hb.innerHTML = '';
  if (!p) {
    const v = G.view;
    if (v.phase === 'initial') hint(`等待玩家完成开局抉择…`);
    else if (v.phase !== 'done') hint(`${esc(playerByPid(G, v.turnPid)?.name || '')} 行动中…`);
    return;
  }
  const d = p.data || {};
  switch (p.kind) {
    case 'pick_action': hint('轮到你了！点击下方彩色行动按钮选择行动'); break;
    case 'play_pick_bird': hint('选择要打出的鸟（点击手牌）'); break;
    case 'play_pick_habitat': hint(`选择栖息地（点击行标签或虚线槽位）· 蛋成本见槽位角标`); break;
    case 'play_pay_eggs': payEggsModal(d); break;
    case 'play_pay_food': payFoodModal(d); break;
    case 'exchange_card_food': confirmHint('槽位加成：弃 1 张鸟卡，额外获得 1 个食物？', a => answer({ use: a })); break;
    case 'exchange_food_egg': confirmHint('槽位加成：支付 1 个食物，额外产 1 颗蛋？', a => answer({ use: a })); break;
    case 'exchange_egg_card': confirmHint('槽位加成：弃 1 颗蛋，额外抽 1 张卡？', a => answer({ use: a })); break;
    case 'optional_reroll': confirmHint('喂食器全部同面，是否重掷全部 5 颗骰子？', a => answer({ reroll: a })); break;
    case 'pick_die': hint('点击喂食器中的骰子取食（二选一面可选种子或无脊椎）'); break;
    case 'pick_die_face': chooseFoodModal('二选一面：选择获得哪种食物', ['seed', 'invertebrate'], f => answer({ food: f })); break;
    case 'pick_wild_food': chooseFoodModal('获得任意食物：选择种类', null, f => answer({ food: f })); break;
    case 'exchange_pick_food': chooseFoodModal('支付哪种食物？', null, f => answer({ food: f }), true); break;
    case 'lay_eggs_alloc': allocEggsModal(d); break;
    case 'exchange_pick_egg': hint('点击面板上一颗蛋将其移除（或直接确认，自动移除）', [{ t: '确认', fn: () => answer({}) }]); break;
    case 'draw_pick_source': hint(`点击鸟托盘明牌或牌库选择抽卡来源（还剩 ${d.remaining} 张）`); break;
    case 'activate_brown': {
      const b = birdOf(G, d.bird);
      hint(`${b.name_zh} 棕色能力：${esc(b.power.text_zh)}`,
        [{ t: '✅ 激活', fn: () => answer({ activate: true }) }, { t: '跳过', fn: () => answer({ activate: false }) }]);
      break;
    }
    case 'cache_or_gain': confirmHint(`储存还是获得 ${FOOD_ZH[d.food]}？（储存=终局1分且不可再花）`, a => answer({ cache: a })); break;
    case 'optional_if_do': confirmHint('执行后续效果？', a => answer({ use: a })); break;
    case 'optional_tuck_deck_cost': confirmHint(`弃 ${FOOD_ZH[d.cost.food]}×${d.cost.n}，从牌库塞 ${d.tuck} 张卡到这只鸟下？`, a => answer({ use: a })); break;
    case 'tuck_pick': hint(`选择要塞入的 ${d.n} 张手牌（点击后确认）`, [{ t: '确认', fn: () => answer({ cards: G.ui.selection || [] }) }], () => { G.ui.selection = G.ui.selection || []; return G.ui.selection.length; }); break;
    case 'eot_discard': hint(`回合结束：弃 ${d.count} 张手牌（点击选择后确认）`, [{ t: '确认', fn: () => answer({ cards: G.ui.selection || [] }) }], () => (G.ui.selection || []).length); break;
    case 'exchange_pick_card': hint('选择要弃置的手牌'); break;
    case 'lay_egg_target': {
      const targets = d.targets || [];
      const m = me(G);
      const list = [];
      Object.values(m.habitats).flat().forEach(inst => {
        if (targets.includes(inst.iid)) {
          const b = birdOf(G, inst.card);
          list.push({ key: inst.iid, img: b.file, name: b.name_zh, sub: `${NEST_ZH[b.nest]} · ${inst.eggs}/${b.egg_limit} 蛋` });
        }
      });
      choiceListModal('选择产蛋目标', list, k => answer({ iid: k }));
      break;
    }
    case 'discard_egg_pick': {
      const m = me(G);
      const list = [];
      Object.values(m.habitats).flat().forEach(inst => {
        if (inst.eggs > 0 && (d.birds || []).includes(inst.iid)) {
          const b = birdOf(G, inst.card);
          list.push({ key: inst.iid, img: b.file, name: b.name_zh, sub: `${inst.eggs} 蛋可弃` });
        }
      });
      choiceListModal('选择弃蛋的鸟', list, k => answer({ iid: k }));
      break;
    }
    case 'move_bird_dest': {
      const list = (d.dests || []).map(h => ({ key: h, iconId: 'h-' + h, name: HAB_ZH[h], sub: `当前 ${me(G).habitats[h].length}/5 鸟` }));
      choiceListModal('迁徙到哪个栖息地？', list, k => answer({ habitat: k }));
      break;
    }
    case 'pick_start_player': {
      const list = (d.players || []).map(pid => ({ key: pid, name: playerByPid(G, pid).name, sub: pid === G.pid ? '（我）' : '', dot: playerByPid(G, pid).color }));
      choiceListModal('从哪位玩家开始依次取骰？', list, k => answer({ pid: k }));
      break;
    }
    case 'pick_distributed_card': {
      cardGridModal('选择 1 张鸟卡加入手牌', d.cards, c => answer({ card: c }), true);
      break;
    }
    case 'bonus_keep': cardGridModal('选择保留 1 张奖励卡', d.drawn, c => answer({ keep: c }), true, 'bonus'); break;
    case 'pink_offer': {
      const b = birdOf(G, d.card);
      pinkToast(b, use => answer({ use }));
      break;
    }
    case 'initial_keep': initialKeepModal(d); break;
    case 'initial_bonus': {
      cardGridModal('选择你的奖励卡（保留 1 张）', d.options, c => answer({ bonus: c }), true, 'bonus');
      break;
    }
    // —— 新能力引入的决策类型 ——
    case 'feeder_food_choice':
      chooseFoodModal('喂食器中可用的食物（选择其一）', d.choices, f => answer({ food: f })); break;
    case 'supply_food_choice':
      chooseFoodModal('选择供应区食物', d.choices, f => answer({ food: f })); break;
    case 'repeat_pick_target':
      iidChoiceModal('选择要重复的棕色能力', d.targets, k => answer({ iid: k }), (b) => b.power.text_zh); break;
    case 'trade_pick_give':
      chooseFoodModal('选择要弃掉的食物', d.foods, f => answer({ food: f }), true); break;
    case 'trade_pick_get':
      chooseFoodModal('选择要换取的食物', d.foods, f => answer({ food: f })); break;
    case 'all_lay_egg_target':
      iidChoiceModal('选择产蛋的鸟', d.targets, k => answer({ iid: k })); break;
    case 'all_lay_extra':
      iidChoiceModal('额外产 1 蛋（可选，须另一只）', d.targets, k => answer({ iid: k }), null,
        [{ t: '跳过', fn: () => { closeModal(); answer({ iid: '' }); } }]); break;
    default: {
      // 兜底：通用确认
      confirmHint(`需要你的决定：${p.kind}`, a => answer({ ok: a }));
    }
  }
}

function hint(text, actions, countFn) {
  const hb = $('#hint-bar');
  hb.classList.remove('hidden');
  let cntHtml = '';
  if (actions) {
    cntHtml = '<span class="hb-actions">' + (countFn ? `<span id="hb-cnt" class="num"></span>` : '') +
      actions.map((a, i) => `<button class="btn" data-i="${i}">${a.t}</button>`).join('') + '</span>';
  }
  hb.innerHTML = text + cntHtml;
  if (actions) {
    hb.querySelectorAll('.hb-actions .btn').forEach(btn => {
      btn.onclick = () => actions[Number(btn.dataset.i)].fn();
    });
  }
}

function confirmHint(text, cb) {
  hint(text, [{ t: '是', fn: () => cb(true) }, { t: '否', fn: () => cb(false) }]);
}

// ---------------- 各类弹窗 ----------------
function modal(title, bodyEl, actions, wide) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const m = el('div', 'modal' + (wide ? ' wide' : ''));
  const t = el('div', 'modal-title', title);
  const b = el('div', 'modal-body');
  if (bodyEl) b.appendChild(bodyEl);
  const a = el('div', 'modal-actions');
  (actions || []).forEach(act => {
    const btn = el('button', 'btn ' + (act.cls || ''), act.t);
    btn.onclick = act.fn;
    a.appendChild(btn);
  });
  m.append(t, b, a);
  root.appendChild(m);
  root.onmousedown = e => { if (e.target === root && actions && actions.some(x => x.dismiss !== false)) { /* 允许点背景关闭仅当显式 */ } };
  return m;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function cardGridModal(title, cardIds, cb, immediate, kind) {
  const grid = el('div', 'choice-grid');
  let sel = null;
  cardIds.forEach(cid => {
    const c = kind === 'bonus' ? bonusOf(G, cid) : birdOf(G, cid);
    const cc = el('div', 'choice-card');
    cc.innerHTML = `<img src="${imgUrl(c.file)}"><div class="cc-name">${esc(c.name_zh)}</div>`;
    cc.onclick = () => {
      if (immediate) { closeModal(); cb(cid); return; }
      grid.querySelectorAll('.choice-card').forEach(x => x.classList.remove('sel'));
      cc.classList.add('sel'); sel = cid;
    };
    grid.appendChild(cc);
  });
  if (kind === 'bonus' && cardIds[0]) {
    const b = bonusOf(G, cardIds[0]);
    // 展示计分说明
    const info = el('p', '', `<b>${esc(b.name_zh)}</b>（${esc(b.name_en)}）：${esc(b.detail_zh)}`);
    const wrap = el('div');
    wrap.append(grid, info);
    grid.querySelectorAll('.choice-card').forEach((cc, i) => {
      cc.onmouseenter = () => { info.innerHTML = `<b>${esc(bonusOf(G, cardIds[i]).name_zh)}</b>（${esc(bonusOf(G, cardIds[i]).name_en)}）：${esc(bonusOf(G, cardIds[i]).detail_zh)}`; };
    });
    modal(title, wrap, []);
    return;
  }
  modal(title, grid, immediate ? [] : [{ t: '确认', cls: 'primary', fn: () => { if (sel) { closeModal(); cb(sel); } } }]);
}

function choiceListModal(title, items, cb) {
  const list = el('div', 'opt-list');
  items.forEach(it => {
    const row = el('div', 'opt-row');
    let left = '';
    if (it.img) left = `<img src="${imgUrl(it.img)}" style="width:34px;border-radius:4px">`;
    else if (it.iconId) left = icon(it.iconId, '');
    else if (it.dot) left = `<span class="player-dot" style="background:${it.dot}"></span>`;
    row.innerHTML = `${left}<b>${esc(it.name)}</b><span class="desc">${esc(it.sub || '')}</span>`;
    row.onclick = () => { closeModal(); cb(it.key); };
    list.appendChild(row);
  });
  modal(title, list, []);
}

// 按实例 iid 列出可选鸟（用于重复能力/全员产蛋等），actions 可提供"跳过"等额外按钮
function iidChoiceModal(title, targets, cb, subFn, actions) {
  const m = me(G);
  const list = el('div', 'opt-list');
  Object.values(m.habitats).flat().forEach(inst => {
    if (!targets.includes(inst.iid)) return;
    const b = birdOf(G, inst.card);
    const sub = subFn ? subFn(b, inst) : `${NEST_ZH[b.nest]} · ${inst.eggs}/${b.egg_limit} 蛋`;
    const row = el('div', 'opt-row');
    row.innerHTML = `<img src="${imgUrl(b.file)}" style="width:34px;border-radius:4px"><b>${esc(b.name_zh)}</b><span class="desc">${esc(sub)}</span>`;
    row.onclick = () => { closeModal(); cb(inst.iid); };
    list.appendChild(row);
  });
  modal(title, list, actions || []);
}

function chooseFoodModal(title, onlyTwo, cb, payable) {
  const m = me(G);
  const foods = onlyTwo || ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'];
  const list = el('div', 'opt-list');
  foods.forEach(f => {
    if (payable && m.food[f] <= 0) return;
    const row = el('div', 'opt-row');
    row.innerHTML = `${icon(FOOD_ICON[f])}<b>${FOOD_ZH[f]}</b>${payable ? `<span class="desc">拥有 ${m.food[f]}</span>` : ''}`;
    row.onclick = () => { closeModal(); cb(f); };
    list.appendChild(row);
  });
  modal(title, list, []);
}

function payEggsModal(d) {
  const m = me(G);
  const need = d.amount;
  const wrap = el('div');
  wrap.appendChild(el('p', '', `需支付 <b class="num">${need}</b> ${icon('i-egg')} —— 点击选择要移除蛋的鸟`));
  const grid = el('div', 'choice-grid');
  const sel = {};
  const refresh = () => {
    const total = Object.values(sel).reduce((a, b) => a + b, 0);
    wrap.querySelector('p b').textContent = `${need - total}`;
    grid.querySelectorAll('.cc-num').forEach((n, i) => {
      const insts = [];
      Object.values(m.habitats).forEach(arr => arr.forEach(x => insts.push(x)));
      n.textContent = sel[insts[i].iid] || 0;
    });
  };
  const insts = [];
  Object.values(m.habitats).forEach(arr => arr.forEach(x => { if (x.eggs > 0) insts.push(x); }));
  insts.forEach(inst => {
    const b = birdOf(G, inst.card);
    const cc = el('div', 'choice-card');
    cc.innerHTML = `<img src="${imgUrl(b.file)}"><div class="cc-name">${esc(b.name_zh)}<br><span class="cc-num num" style="font-size:13px;color:var(--gold)">${sel[inst.iid] || 0}</span>/${inst.eggs} ${icon('i-egg')}</div>`;
    cc.onclick = () => {
      const cur = sel[inst.iid] || 0;
      const total = Object.values(sel).reduce((a, b) => a + b, 0);
      if (cur < inst.eggs && total < need) sel[inst.iid] = cur + 1;
      else if (cur > 0) sel[inst.iid] = cur - 1;
      else delete sel[inst.iid];
      refresh();
    };
    grid.appendChild(cc);
  });
  wrap.appendChild(grid);
  modal(`支付蛋成本`, wrap, [
    { t: '确认支付', cls: 'primary', fn: () => {
      const birds = [];
      for (const [iid, n] of Object.entries(sel)) for (let i = 0; i < n; i++) birds.push(iid);
      closeModal(); answer({ birds });
    } },
  ]);
}

function payFoodModal(d) {
  const m = me(G);
  const wrap = el('div');
  wrap.appendChild(el('p', '', `卡牌食物成本：${costHtml(G, d.cost)}　（${icon('i-wild')} 表示任意；任意 2 个食物可当 1 个任意食物）`));
  const plans = d.plans || [];
  const list = el('div', 'opt-list');
  // 防御：无可用支付方案时给出提示，不发送 plan:undefined
  if (!plans.length) {
    list.innerHTML = '<div class="opt-row">没有可用的支付方案（食物不足）</div>';
    wrap.appendChild(list);
    modal('支付食物成本', wrap, []);
    return;
  }
  let selIdx = 0;
  plans.forEach((pl, i) => {
    const direct = Object.entries(pl.direct || {}).map(([f, n]) => `${FOOD_ZH[f]}×${n}`).join(' + ');
    const row = el('div', 'opt-row' + (i === 0 ? ' sel' : ''));
    row.innerHTML = `${icon('i-wild')}<b>方案 ${i + 1}</b><span class="desc">${direct || '无直接支付'}${pl.twofor ? ` + 2换1 ×${pl.twofor}` : ''}</span>`;
    row.onclick = () => { list.querySelectorAll('.opt-row').forEach(r => r.classList.remove('sel')); row.classList.add('sel'); selIdx = i; };
    list.appendChild(row);
  });
  wrap.appendChild(list);
  modal('支付食物成本', wrap, [
    { t: '确认支付', cls: 'primary', fn: () => { closeModal(); answer({ plan: plans[selIdx] }); } },
  ]);
}

function allocEggsModal(d) {
  const m = me(G);
  const wrap = el('div');
  const amount = d.amount;
  wrap.appendChild(el('p', '', `可产 <b class="num">${amount}</b> ${icon('i-egg')}（可少产，超出容量的蛋会损失；点 + 分配）`));
  const alloc = {};
  const rows = el('div');
  const insts = [];
  Object.values(m.habitats).forEach(arr => arr.forEach(x => { if (x.eggLimit > x.eggs) insts.push(x); }));
  insts.forEach(inst => {
    const b = birdOf(G, inst.card);
    const cap = b.egg_limit - inst.eggs;
    const row = el('div', 'alloc-row');
    row.innerHTML = `<img src="${imgUrl(b.file)}"><span class="ar-name">${esc(b.name_zh)}</span><span class="ar-cap">${inst.eggs}/${b.egg_limit} ${NEST_ZH[b.nest]}</span>`;
    const st = el('div', 'stepper');
    const minus = el('button', '', '−'), val = el('span', 'val num', '0'), plus = el('button', '', '+');
    minus.onclick = () => { alloc[inst.iid] = Math.max(0, (alloc[inst.iid] || 0) - 1); val.textContent = alloc[inst.iid]; refresh(); };
    plus.onclick = () => {
      const total = Object.values(alloc).reduce((a, b) => a + b, 0);
      if (total < amount && (alloc[inst.iid] || 0) < cap) { alloc[inst.iid] = (alloc[inst.iid] || 0) + 1; val.textContent = alloc[inst.iid]; refresh(); }
    };
    st.append(minus, val, plus);
    row.appendChild(st);
    rows.appendChild(row);
  });
  const totalEl = el('p', '', '');
  const refresh = () => {
    const total = Object.values(alloc).reduce((a, b) => a + b, 0);
    totalEl.innerHTML = `已分配 <b class="num">${total}</b> / ${amount}`;
  };
  refresh();
  wrap.append(rows, totalEl);
  // 自动分配
  const autoBtn = { t: '自动分配', fn: () => { closeModal(); answer({ alloc: null }); } }; // 引擎兜底自动
  modal('分配产蛋', wrap, [
    autoBtn,
    { t: '确认', cls: 'primary', fn: () => {
      const out = [];
      for (const [iid, n] of Object.entries(alloc)) if (n > 0) out.push({ iid, n });
      closeModal(); answer({ alloc: out });
    } },
  ]);
}

function initialKeepModal(d) {
  const hand = d.hand || [];
  const wrap = el('div');
  wrap.appendChild(el('p', '', `「10 留 5」：勾选要保留的 <b>5</b> 样资源 —— 每保留 1 张鸟卡，就少保留 1 个食物（初始每种食物各 1 个）`));
  const grid = el('div', 'choice-grid');
  const selBirds = new Set();
  hand.forEach(cid => {
    const b = birdOf(G, cid);
    const cc = el('div', 'choice-card');
    cc.innerHTML = `<img src="${imgUrl(b.file)}" alt="${esc(b.name_zh)}"><div class="cc-name">${esc(b.name_zh)}<br><span style="color:var(--ink-3)">${b.points}分 · ${b.habitats.map(h => HAB_ZH[h]).join('/')}</span></div>`;
    cc.onclick = () => {
      if (selBirds.has(cid)) { selBirds.delete(cid); cc.classList.remove('sel'); }
      else if (selBirds.size < 5) { selBirds.add(cid); cc.classList.add('sel'); }
      refresh();
    };
    grid.appendChild(cc);
  });
  const foodSel = new Set();
  const foodRow = el('div', 'opt-list');
  foodRow.style.marginTop = '10px';
  ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'].forEach(f => {
    const row = el('div', 'opt-row');
    row.innerHTML = `${icon(FOOD_ICON[f])}<b>${FOOD_ZH[f]}</b><span class="desc">${selBirds.size + foodSel.size < 5 ? '点击保留' : '已达上限'}</span>`;
    row.onclick = () => {
      if (foodSel.has(f)) { foodSel.delete(f); row.classList.remove('sel'); }
      else if (selBirds.size + foodSel.size < 5) { foodSel.add(f); row.classList.add('sel'); }
      refresh();
    };
    row.dataset.food = f;
    foodRow.appendChild(row);
  });
  const status = el('p', '', '');
  const refresh = () => {
    const total = selBirds.size + foodSel.size;
    status.innerHTML = `已保留 <b class="num">${total}</b> / 5（鸟 ${selBirds.size} + 食物 ${foodSel.size}）`;
    foodRow.querySelectorAll('.opt-row .desc').forEach((s, i) => {
      const f = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'][i];
      s.textContent = foodSel.has(f) ? '已选' : (total < 5 ? '点击保留' : '已达上限');
    });
  };
  refresh();
  wrap.append(grid, foodRow, status);
  modal('开局抉择 · 10 留 5', wrap, [
    { t: '确认（不满 5 自动补齐）', cls: 'primary', fn: () => {
      closeModal();
      answer({ birds: [...selBirds], food: [...foodSel] });
    } },
  ], true);
}

function pinkToast(b, cb) {
  const root = $('#toast-root');
  const t = el('div', 'toast pink');
  t.innerHTML = `<div class="t-title">${icon('i-egg')} 粉色能力可触发：${esc(b.name_zh)}</div>
    <div class="t-sub">${esc(b.power.text_zh)}</div>
    <div class="t-actions"><button class="btn primary">使用</button><button class="btn">忽略</button></div>`;
  const [use, skip] = t.querySelectorAll('.btn');
  use.onclick = () => { t.remove(); cb(true); };
  skip.onclick = () => { t.remove(); cb(false); };
  root.appendChild(t);
  setTimeout(() => t.remove(), 20000);
}

function showRoundSummary(gr) {
  const banner = el('div', 'round-banner', `第 ${gr.round} 轮结束 · 轮末目标计分`);
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 2300);
}

function showFinalScores() {
  const v = G.view;
  const wrap = el('div');
  const table = el('table', 'score-table');
  const items = [['排名', 0], ['玩家', 0], ['鸟类分', 'birdPts'], ['奖励分', 'bonusPts'], ['目标分', 'goalPts'], ['蛋', 'eggPts'], ['储存', 'cachePts'], ['塞卡', 'tuckPts'], ['总分', 'total']];
  table.innerHTML = '<tr>' + items.map(i => `<th>${i[0]}</th>`).join('') + '</tr>';
  v.finalScores.forEach((r, i) => {
    const tr = el('tr', (r.pid === G.pid ? 'me ' : '') + (v.winnerPids.includes(r.pid) ? 'win' : ''));
    tr.innerHTML = `<td>${i + 1}</td><td><b>${esc(r.name)}</b>${r.pid === G.pid ? '（我）' : ''}</td>` +
      ['birdPts', 'bonusPts', 'goalPts', 'eggPts', 'cachePts', 'tuckPts'].map(k => `<td class="num">${r[k]}</td>`).join('') +
      `<td class="total num">${r.total}</td>`;
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  const winners = v.winnerPids.map(pid => playerByPid(G, pid)?.name).join('、');
  wrap.appendChild(el('p', '', `<br>🏆 获胜者：<b>${esc(winners)}</b>　（平局时比较剩余食物：${v.finalScores.map(r => `${esc(r.name)} ${r.foodLeft}食`).join('，')}）`));
  modal(`🏁 终局计分`, wrap, [{ t: '回顾对局', cls: 'primary', fn: () => closeModal() }], true);
}

function viewPlayerModal(p) {
  const wrap = el('div');
  const title = el('p', '', `<b>${esc(p.name)}</b>（${p.group}组） · 手牌 ${p.handCount} 张 · 食物 ${p.foodCount} 个`);
  wrap.appendChild(title);
  for (const hab of ['forest', 'grassland', 'wetland']) {
    wrap.appendChild(el('p', '', `<b>${HAB_ZH[hab]}</b>（${p.habitats[hab].length}/5）`));
    const grid = el('div', 'choice-grid');
    p.habitats[hab].forEach(inst => {
      const b = birdOf(G, inst.card);
      const cc = el('div', 'choice-card');
      cc.innerHTML = `<img src="${imgUrl(b.file)}">` +
        (inst.eggs ? `<div class="ov ov-eggs" style="position:static;display:inline-flex">${icon('i-egg')}${inst.eggs}</div>` : '') +
        `<div class="cc-name">${esc(b.name_zh)}</div>`;
      cc.title = `${b.points}分 · 蛋${inst.eggs}/${b.egg_limit} · 储存${inst.cached.length} · 塞卡${inst.tucked}`;
      grid.appendChild(cc);
    });
    if (!p.habitats[hab].length) grid.appendChild(el('div', 'cc-name', '（空）'));
    wrap.appendChild(grid);
  }
  modal(`${esc(p.name)} 的面板（公开信息）`, wrap, [{ t: '关闭', fn: () => closeModal() }], true);
}

function showRules() {
  const wrap = el('div');
  const sec = (h, body) => { const s = el('div', 'rules-sec'); s.appendChild(el('h4', '', h)); s.appendChild(el('div', '', body)); wrap.appendChild(s); };
  sec('回合结构', `<p>每局固定 4 轮，每轮行动数 <b>8 / 7 / 6 / 5</b>（每轮末需放 1 个方块到目标板）。每个回合从 4 个行动中选 1 个：</p>
    <ul>
    <li>${icon('a-play')} <b>打出鸟类</b>：付食物成本（可用「任意 2 食物 = 1 任意食物」，仅打鸟时可用）+ 列蛋成本（0/1/1/2/2），触发白色能力。</li>
    <li>${icon('a-food')} <b>获取食物</b>：从喂食器逐颗取骰（第 6 面"种子/无脊椎"二选一只得 1 个）；之后从右到左结算森林棕色能力。</li>
    <li>${icon('a-eggs')} <b>产蛋</b>：按行动格数量产蛋（可少产）；之后结算草原棕色能力。</li>
    <li>${icon('a-draw')} <b>抽取鸟卡</b>：从托盘明牌或牌库抽取；之后结算湿地棕色能力。</li>
    </ul>`);
  sec('能力颜色', `<ul>
    <li><b style="color:var(--white-p);background:#888;padding:0 4px">白</b> 打出时触发一次。</li>
    <li><b style="color:#fff;background:var(--brown-p);padding:0 4px">棕</b> 执行该行行动时从右到左逐只可选激活。</li>
    <li><b style="color:#fff;background:var(--pink-p);padding:0 4px">粉</b> 其他玩家回合满足条件时可触发；你的两次行动之间每张限 1 次。</li>
    <li><b style="color:#fff;background:var(--teal-p);padding:0 4px">青</b> 轮末触发（本牌库未含）。</li>
    <li><b style="color:#333;background:var(--yellow-p);padding:0 4px">黄</b> 终局触发（本牌库未含）。</li>
    </ul>`);
  sec('喂食器', `<p>空了必须重掷全部 5 颗；全部同面（含只剩 1 颗）时可在取食前选择重掷。轮末不重置。</p>`);
  sec('轮末与计分', `<p>青能力 → 目标计分（绿面按名次 4-2-1/5-3-1/6-3-2/7-4-3，Flock 用 6 名次表且平局为友好式）→ 收回方块（其中 1 个放到目标板）→ 托盘全部换新 → 传先手。终局 = 鸟分 + 奖励分 + 目标分 + 蛋/储存/塞卡各 1 分；平局比剩余食物。</p>`);
  sec('多人模式', `<p>4–5 人：基础官方规则。6–7 人：官方 Flock（A/B 两组，各有独立喂食器与托盘，每组同时 1 人行动）。8 人：非官方扩展（4+4，沿用 Flock 并发）。</p>`);
  sec('版权说明', `<p>本项目为学习与研究用途。卡牌版权归 Stonemaier Games；8 人模式为社区扩展，非官方玩法。</p>`);
  modal('📖 规则速览', wrap, [{ t: '关闭', fn: () => closeModal() }]);
}

function showCardBrowser() {
  const wrap = el('div');
  const filters = el('div', 'filter-row');
  const kinds = [['all', '全部'], ['none', '无能力'], ['white', '白'], ['brown', '棕'], ['pink', '粉'], ['predator', '捕食者'], ['flocking', '群栖'], ['bonus', '奖励卡']];
  let cur = 'all';
  kinds.forEach(([k, zh], i) => {
    const chip = el('button', 'chip' + (i === 0 ? ' sel' : ''), zh);
    chip.onclick = () => { cur = k; filters.querySelectorAll('.chip').forEach(c => c.classList.remove('sel')); chip.classList.add('sel'); renderGrid(); };
    filters.appendChild(chip);
  });
  const grid = el('div', 'browse-grid');
  const renderGrid = () => {
    grid.innerHTML = '';
    if (cur === 'bonus') {
      G.DATA.bonus.forEach(b => {
        const c = el('div', 'browse-card');
        c.innerHTML = `<img src="${imgUrl(b.file)}"><div class="bc-name">${esc(b.name_zh)}<br>${esc(b.detail_zh)}</div>`;
        grid.appendChild(c);
      });
      return;
    }
    G.DATA.birds.filter(b => {
      if (cur === 'all') return true;
      if (cur === 'none') return !b.power;
      if (cur === 'predator') return b.predator;
      if (cur === 'flocking') return b.flocking;
      return b.power && b.power.color === cur;
    }).forEach(b => {
      const c = el('div', 'browse-card');
      c.innerHTML = `<img src="${imgUrl(b.file)}"><div class="bc-name">${esc(b.name_zh)} · ${b.points}分${b.power ? ' · ' + ({ white: '白', brown: '棕', pink: '粉' })[b.power.color] : ''}</div>`;
      c.title = `${b.name_en} | ${NEST_ZH[b.nest]} 蛋上限${b.egg_limit} 翼展${b.wingspan}cm\n${b.power ? b.power.text_zh : ''}`;
      grid.appendChild(c);
    });
  };
  renderGrid();
  wrap.append(filters, grid);
  modal('🃏 卡牌浏览', wrap, [{ t: '关闭', fn: () => closeModal() }], true);
}

// ---------------- Toast ----------------
function toast(text, cls, ms) {
  const t = el('div', 'toast ' + (cls || 'info'), `<div class="t-title">${text}</div>`);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), ms || 3500);
}

// ---------------- 回调集合 ----------------
function makeCallbacks() {
  return {
    pickDie: face => {
      if (face === 'seed_or_invertebrate') return; // 引擎会再询问二选一
      answer({ face });
    },
    reroll: () => answer({ reroll: true }),
    drawSource: src => answer({ source: src }),
    pickHabitat: hab => answer({ habitat: hab }),
    action: id => answer({ action: id }),
    handPick: (cid, b) => {
      const p = myPending();
      if (!p) return showBigCard(b);
      if (p.kind === 'play_pick_bird') {
        if ((p.data.candidates || []).includes(cid)) answer({ bird: cid });
        else toast(`${b.name_zh} 当前无法打出（成本不足或栖息地已满）`, 'danger');
      } else if (p.kind === 'tuck_pick' || p.kind === 'eot_discard' || p.kind === 'exchange_pick_card') {
        G.ui.selection = G.ui.selection || [];
        const i = G.ui.selection.indexOf(cid);
        if (i >= 0) G.ui.selection.splice(i, 1);
        else G.ui.selection.push(cid);
        renderHandbar(G, makeCallbacks()); // 刷新选中态
        const cnt = $('#hb-cnt');
        if (cnt) cnt.textContent = `已选 ${G.ui.selection.length}`;
      } else if (p.kind === 'pick_distributed_card') {
        answer({ card: cid });
      } else showBigCard(b);
    },
    showCard: b => showBigCard(b),
    viewPlayer: p => viewPlayerModal(p),
    onBirdClick: (inst, cardEl, ev) => {
      const b = birdOf(G, inst.card);
      const p = myPending();
      if (p && (p.kind === 'exchange_pick_egg' || p.kind === 'lay_egg_target' || p.kind === 'discard_egg_pick')) return; // 用弹窗处理
      showBigCard(b, inst);
    },
  };
}
function showBigCard(b, inst) {
  document.querySelectorAll('.bigcard-float').forEach(x => x.remove());
  const f = el('div', 'bigcard-float');
  const meta = [
    `<b class="bc-zh">${esc(b.name_zh)}</b>`,
    `<span class="bc-en">${esc(b.name_en)} · <i>${esc(b.latin)}</i></span>`,
    `<span class="bc-line">${b.points} 分 · ${b.habitats.map(h => HAB_ZH[h]).join('/')}</span>`,
    `<span class="bc-line">${NEST_ZH[b.nest]} · 蛋上限 ${b.egg_limit} · 翼展 ${b.wingspan}cm${b.predator ? ' · 捕食者' : ''}${b.flocking ? ' · 群栖' : ''}</span>`,
    `<span class="bc-power">${b.power ? b.power.text_zh : '（无能力）'}</span>`,
    inst ? `<span class="bc-inst">当前：${inst.eggs} 蛋 · 储存 ${inst.cached.length} · 塞卡 ${inst.tucked}</span>` : '',
  ].join('');
  f.innerHTML = `<img src="${imgUrl(b.file)}" alt="${esc(b.name_zh)}"><div class="bc-info">${meta}</div>`;
  document.body.appendChild(f);
  const close = ev2 => { if (!f.contains(ev2.target)) { f.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 50);
}

// ---------------- 首页 / 大厅 ----------------
let homeCfg = { mode: 'base', total: 4, goalSide: 'green' };
function initHome() {
  showScreen('home');
  $('#inp-name').value = G.name;
  $('#inp-name').oninput = e => { G.name = e.target.value.slice(0, 12); localStorage.setItem('ws-name', G.name); };
  const segPlayers = $('#seg-players');
  const renderSeg = () => {
    const opts = homeCfg.mode === 'base' ? [4, 5] : homeCfg.mode === 'flock' ? [6, 7] : [8];
    if (!opts.includes(homeCfg.total)) homeCfg.total = opts[0];
    segPlayers.innerHTML = '';
    opts.forEach(n => {
      const b = el('button', n === homeCfg.total ? 'sel' : '', `${n} 人`);
      b.onclick = () => { homeCfg.total = n; renderSeg(); };
      segPlayers.appendChild(b);
    });
    $('#players-hint').textContent = homeCfg.mode === 'extended' ? '（非官方扩展模式）' : '（空位由机器人补齐）';
  };
  document.querySelectorAll('.mode-card').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.mode-card').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      homeCfg.mode = c.dataset.mode;
      renderSeg();
    };
  });
  $('#seg-goal').querySelectorAll('button').forEach(b => {
    b.onclick = () => { $('#seg-goal').querySelectorAll('button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); homeCfg.goalSide = b.dataset.v; };
  });
  renderSeg();
  $('#btn-solo').onclick = () => { G.name = $('#inp-name').value || '我'; startLocal({ ...homeCfg }); };
  $('#btn-create').onclick = () => {
    G.name = $('#inp-name').value || '玩家';
    if (G.mode !== 'online' || !G.ws || G.ws.readyState !== 1) return toast('无法连接服务器', 'danger');
    if (!G.pid) { setTimeout(() => $('#btn-create').click(), 300); return; }
    send({ type: 'create_room', name: G.name, cfg: homeCfg });
  };
  $('#btn-join').onclick = () => {
    G.name = $('#inp-name').value || '玩家';
    const code = $('#inp-code').value.trim().toUpperCase();
    if (code.length !== 4) return toast('请输入 4 位房间码', 'danger');
    if (!G.pid) { setTimeout(() => $('#btn-join').click(), 300); return; }
    send({ type: 'join_room', code, name: G.name, pid: G.pid });
  };
  $('#btn-start').onclick = () => send({ type: 'start_game' });
  $('#btn-leave').onclick = () => location.reload();
  $('#btn-rules').onclick = () => showRules();
  $('#btn-cards').onclick = () => showCardBrowser();
  $('#btn-theme').onclick = () => {
    const cur = document.body.dataset.theme === 'night' ? 'paper' : 'night';
    document.body.dataset.theme = cur;
    localStorage.setItem('ws-theme', cur);
    $('#btn-theme').textContent = cur === 'night' ? '☀️' : '🌙';
  };
  const savedTheme = localStorage.getItem('ws-theme');
  if (savedTheme) { document.body.dataset.theme = savedTheme; $('#btn-theme').textContent = savedTheme === 'night' ? '☀️' : '🌙'; }
}

function showScreen(name) {
  ['home', 'lobby', 'game'].forEach(s => $('#screen-' + s).classList.toggle('hidden', s !== name));
}

// 调试与自动化测试出口
window.G = G;
window.__answer = answer;

boot();

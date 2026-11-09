// 展翅翱翔 · 服务端权威规则引擎（共享模块：Node 与浏览器通用）
// 原则（对齐 02 技术文档）：纯状态机 + 可注入 RNG + 生成器驱动的决策暂停/恢复 + 事件日志。
// 所有规则数值来自 data/game_data.json（官方数值零改动）。
import { botDecide } from './bot.js';

export const HABITATS = ['forest', 'grassland', 'wetland'];
export const FOODS = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'];
export const DICE_FACES = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'seed_or_invertebrate'];

// ---------- RNG（确定性，双流：牌库 / 骰子） ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  constructor(seed) { this.seed = seed; this.f = mulberry32(seed); }
  next() { return this.f(); }
  int(n) { return Math.floor(this.next() * n); }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = this.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  pick(arr) { return arr[this.int(arr.length)]; }
}
function serializeRng(r) { return r.seed; } // mulberry32 状态即 seed 演进值——直接存回
// 简化：记录已抽取次数用于审计
class AuditedRng extends Rng {
  constructor(seed, stream) { super(seed); this.stream = stream; this.draws = 0; }
  next() { this.draws++; return super.next(); }
  audit() { return { stream: this.stream, seed: this.seed, draws: this.draws }; }
}

// ---------- 通用工具 ----------
export const clone = s => structuredClone(s);
const cap = s => s[0].toUpperCase() + s.slice(1);
export function foodSum(food) { return FOODS.reduce((a, f) => a + (food[f] || 0), 0); }
export function allBirds(p) { return HABITATS.flatMap(h => p.habitats[h]); }
export function eggCapacity(inst) { return Math.max(0, inst.eggLimit - inst.eggs); }
export function totalEggCapacity(p) { return allBirds(p).reduce((a, b) => a + eggCapacity(b), 0); }
export function nestMatches(instNest, wanted) { return instNest === wanted || instNest === 'wild'; }

// ---------- 对局创建 ----------
// cfg: { mode: 'base'|'flock'|'extended', players: [{pid,name,color,bot}], goalSide:'green'|'blue', seed }
export function createGame(cfg, DATA) {
  const mode = cfg.mode || 'base';
  const players = cfg.players;
  const n = players.length;
  if (!(mode === 'base' ? n >= 4 && n <= 5 : (mode === 'flock' ? n >= 6 && n <= 7 : n === 8))) {
    throw new Error('人数与模式不匹配: ' + mode + ' ' + n);
  }
  const seed = cfg.seed >>> 0;
  const deckRng = new AuditedRng(seed, 'deck');
  const diceRng = new AuditedRng((seed ^ 0x9E3779B9) >>> 0, 'dice');

  // 分组：base 单组；flock 6=3+3 7=3+4；extended 8=4+4（按座位就近分组）
  let groups;
  if (mode === 'base') groups = [{ id: 'main', pids: players.map(p => p.pid) }];
  else {
    const half = mode === 'flock' ? Math.ceil(n / 2) : 4;
    groups = [{ id: 'A', pids: players.slice(0, half).map(p => p.pid) }, { id: 'B', pids: players.slice(half).map(p => p.pid) }];
  }

  // 牌库：每组独立（复制牌库为扩展手段，单卡数值不变）
  const birdIds = DATA.birds.map(b => b.id);
  const decks = {}, discards = {}, trays = {}, feeders = {};
  for (const g of groups) {
    decks[g.id] = deckRng.shuffle([...birdIds]);
    discards[g.id] = [];
    trays[g.id] = decks[g.id].splice(0, DATA.constants.tray_size);
    feeders[g.id] = { dice: Array.from({ length: DATA.constants.dice_count }, (_, i) => ({ id: 'd' + g.id + i, face: DICE_FACES[diceRng.int(6)], in: true })) };
  }

  // 目标砖：随机 4 个
  const goalIds = deckRng.shuffle(DATA.goals.map(g => g.id)).slice(0, 4);

  // 奖励卡牌库：7 张的 3 份虚拟拷贝（保证多人局供给；构成可配置）
  const bonusDeck = deckRng.shuffle(DATA.bonus.flatMap(b => Array(3).fill(b.id)));

  const st = {
    v: 1, dataRef: { mat: DATA.mat, constants: DATA.constants },
    cfg: { mode, goalSide: cfg.goalSide || 'green', extended: mode === 'extended' },
    players: players.map((p, i) => ({
      pid: p.pid, name: p.name, color: p.color, bot: !!p.bot, seat: i,
      group: groups.find(g => g.pids.includes(p.pid)).id,
      hand: [], bonus: null, bonusOptions: [], food: { invertebrate: 1, seed: 1, fish: 1, fruit: 1, rodent: 1 },
      habitats: { forest: [], grassland: [], wetland: [] },
      cubesSupply: 8, cubesOnMat: [], cubesOnGoal: 0,
      pinkUsed: [], eotDiscards: 0, connected: true,
    })),
    groups, round: 1, phase: 'initial',
    firstPid: players[0].pid,
    decks, discards, trays, feeders, bonusDeck, bonusDiscard: [],
    goalIds, goalResults: [], activePids: [], turnPid: null, lastAction: null,
    pending: null, log: [], rev: 0,
    rngAudit: { deck: deckRng.audit(), dice: diceRng.audit() },
    finalScores: null, winnerPids: null,
  };
  st._rng = { deck: deckRng, dice: diceRng };
  // 发初始手牌与奖励卡选项
  for (const p of st.players) {
    p.hand = st.decks[p.group].splice(0, DATA.constants.hand_start);
    p.bonusOptions = st.bonusDeck.splice(0, DATA.constants.bonus_choice);
  }
  return st;
}

// ---------- 日志与事件 ----------
export function logEvent(st, type, data) {
  st.rev++;
  st.log.push({ rev: st.rev, type, data: data === undefined ? {} : data });
}

// ---------- 状态视图（信息隐藏） ----------
export function stateView(st, viewerPid, DATA) {
  const bird = id => DATA.birds.find(b => b.id === id);
  const pub = {};
  const hiddenDeck = g => st.decks[g].length;
  for (const g of st.groups) {
    pub['tray_' + g.id] = [...st.trays[g.id]];
    pub['deck_' + g.id] = hiddenDeck(g.id);
    pub['discard_' + g.id] = st.discards[g.id].length;
    pub['feeder_' + g.id] = st.feeders[g.id].dice.map(d => ({ id: d.id, face: d.in ? d.face : null, in: d.in }));
  }
  const viewer = st.players.find(p => p.pid === viewerPid);
  return {
    rev: st.rev, mode: st.cfg.mode, extended: st.cfg.extended, round: st.round, phase: st.phase,
    firstPid: st.firstPid, activePids: st.activePids, turnPid: st.turnPid,
    groups: st.groups, goalIds: st.goalIds, goalSide: st.cfg.goalSide, goalResults: st.goalResults,
    actionsLeft: st.phase === 'playing' || st.phase === 'initial' ? undefined : undefined,
    pending: st.pending ? { pid: st.pending.pid, kind: st.pending.kind } : null,
    players: st.players.map(p => ({
      pid: p.pid, name: p.name, color: p.color, bot: p.bot, seat: p.seat, group: p.group,
      handCount: p.hand.length,
      hand: p.pid === viewerPid ? [...p.hand] : undefined,
      bonus: p.pid === viewerPid ? p.bonus : (p.bonus ? 'hidden' : null),
      bonusOptions: p.pid === viewerPid ? p.bonusOptions : undefined,
      food: { ...p.food }, foodCount: foodSum(p.food),
      habitats: Object.fromEntries(HABITATS.map(h => [h, p.habitats[h].map(inst => ({
        iid: inst.iid, card: inst.cardId, eggs: inst.eggs, cached: [...inst.cached], tucked: inst.tucked,
      }))])),
      cubesSupply: p.cubesSupply, cubesOnGoal: p.cubesOnGoal,
      playedFoodCost: Object.fromEntries(FOODS.map(f => [f, allBirds(p).reduce((a, inst) => {
        const c = bird(inst.cardId); return a + (c.food_cost.some(it => it.type === f) ? 1 : 0);
      }, 0)])),
    })),
    public: pub,
    log: st.log.slice(-80),
    finalScores: st.finalScores,
    winnerPids: st.winnerPids || [],
    rngAudit: st.rngAudit,
  };
}

// ---------- 决策请求 ----------
function ask(st, pid, kind, data) {
  // 生成器 yield 点：由驱动器决定交给人类还是机器人
  return { type: 'choice', pid, kind, data };
}

// ---------- 主流程（生成器） ----------
// driver: 驱动器把 yield 出去的请求交给玩家/机器人，再 resume(answer)。
export function* matchLoop(st, DATA) {
  const C = DATA.constants;
  const P = pid => st.players.find(p => p.pid === pid);

  // ===== 初始抉择：10 留 5 + 奖励卡 =====
  for (const p of st.players) {
    // 保留 k 张鸟 + (5-k) 个食物；食物按类型保留
    const r = yield ask(st, p.pid, 'initial_keep', { hand: [...p.hand] });
    let keepBirds = (r && r.birds) || [], keepFood = (r && r.food) || [];
    keepBirds = keepBirds.filter(id => p.hand.includes(id));
    if (keepBirds.length > 5) keepBirds = keepBirds.slice(0, 5);
    // 校验食物选择：5-k 个，且不超过各 1（初始 5 食物各 1）
    keepFood = FOODS.filter(f => keepFood.includes(f));
    if (keepBirds.length + keepFood.length !== 5) {
      // 兜底：自动调整为合法（前 5）
      keepFood = FOODS.slice(0, 5 - keepBirds.length);
    }
    const dropBirds = p.hand.filter(id => !keepBirds.includes(id));
    for (const b of dropBirds) { p.hand.splice(p.hand.indexOf(b), 1); st.discards[p.group].push(b); }
    for (const f of FOODS) if (!keepFood.includes(f)) p.food[f] = Math.max(0, p.food[f] - 1);
    logEvent(st, 'initial_keep', { pid: p.pid, birds: keepBirds.length, food: keepFood.length });
  }
  for (const p of st.players) {
    const r = yield ask(st, p.pid, 'initial_bonus', { options: [...p.bonusOptions] });
    let pick = r && r.bonus && p.bonusOptions.includes(r.bonus) ? r.bonus : p.bonusOptions[0];
    const returned = p.bonusOptions.filter(x => x !== pick); // 未选中的奖励卡退回牌堆
    p.bonus = pick;
    p.bonusOptions = [];
    st.bonusDeck.push(...returned);
    logEvent(st, 'initial_bonus', { pid: p.pid, bonus: pick });
  }
  st.phase = 'playing';
  logEvent(st, 'game_start', {});

  // ===== 轮次循环 =====
  for (st.round = 1; st.round <= C.rounds; st.round++) {
    for (const p of st.players) p.cubesSupply = 9 - st.round; // 8/7/6/5
    logEvent(st, 'round_start', { round: st.round });
    // 回合调度
    const order = st.players.map(p => p.pid); // 座位顺序，先手开始
    const startIdx = order.indexOf(st.firstPid);
    const remaining = new Map(st.players.map(p => [p.pid, 9 - st.round]));
    if (st.cfg.mode === 'base') {
      // 官方顺序回合：玩家按座位轮流，每人每次做 1 个行动，一圈圈轮转直至都用完本轮行动数
      const remain = new Map(order.map(pid => [pid, 9 - st.round]));
      for (;;) {
        let progressed = false;
        for (let i = 0; i < order.length; i++) {
          const pid = order[(startIdx + i) % order.length];
          if (remain.get(pid) > 0) {
            remain.set(pid, remain.get(pid) - 1);
            yield* takeTurn(st, pid, DATA);
            progressed = true;
          }
        }
        if (!progressed) break;
      }
    } else {
      // Flock / 扩展：转盘波次，每组各出 1 名活跃玩家并发；
      // 每名玩家每轮行动 8/7/6/5 次（以 cubesSupply 计数），转盘指针轮转推进。
      const cursors = st.groups.map(g => {
        const list = g.pids;
        return { gid: g.id, list, ptr: Math.max(0, list.indexOf(st.firstPid)) };
      });
      const totalTurns = st.players.reduce((a, p) => a + p.cubesSupply, 0);
      void totalTurns;
      while (st.players.some(p => p.cubesSupply > 0)) {
        const actives = [];
        for (const c of cursors) {
          // 从指针起找下一名还有行动数的玩家
          for (let k = 0; k < c.list.length; k++) {
            const pid = c.list[(c.ptr + k) % c.list.length];
            if (P2(st, pid).cubesSupply > 0) { actives.push(pid); c.ptr = (c.ptr + k) % c.list.length; break; }
          }
        }
        if (!actives.length) break;
        st.activePids = actives;
        logEvent(st, 'wave_start', { pids: [...actives] });
        for (const pid of actives) yield* takeTurn(st, pid, DATA);
        for (const c of cursors) c.ptr = (c.ptr + 1) % c.list.length;
      }
      st.activePids = [];
    }
    // ===== 轮末 =====
    st.phase = 'roundEnd';
    yield* roundEnd(st, DATA);
    if (st.round < C.rounds) {
      const idx = order.indexOf(st.firstPid);
      st.firstPid = order[(idx + 1) % order.length]; // 顺时针传递
      logEvent(st, 'first_player_pass', { to: st.firstPid });
    }
  }
  // ===== 终局 =====
  st.phase = 'gameEnd';
  // 最后一次行动后的粉色窗口（官方 FAQ）
  yield* pinkWindow(st, null, DATA, true);
  finalScoring(st, DATA);
  st.phase = 'done';
}

// ---------- 单个回合 ----------
function* takeTurn(st, pid, DATA) {
  const p = P2(st, pid);
  st.turnPid = pid;
  if (st.cfg.mode === 'base') st.activePids = [pid]; // 顺序模式：单活跃玩家
  if (p.cubesSupply <= 0) { st.turnPid = null; return; }
  p.pinkUsed = []; // 成为活跃玩家时重置粉色计数
  p.cubesSupply--; p.cubesOnMat.push({ round: st.round });
  logEvent(st, 'turn_start', { pid, round: st.round });

  // 选择行动
  const legal = legalActions(st, pid, DATA);
  const r = yield ask(st, pid, 'pick_action', { legal });
  const action = r && r.action && legal.includes(r.action) ? r.action : legal[0];
  st.lastAction = action;
  if (action === 'play_bird') yield* actionPlayBird(st, pid, DATA);
  else if (action === 'gain_food') yield* actionGainFood(st, pid, DATA);
  else if (action === 'lay_eggs') yield* actionLayEggs(st, pid, DATA);
  else yield* actionDrawCards(st, pid, DATA);

  // 回合结束结算：EOT 弃牌 → 粉色窗口 → 托盘补牌
  yield* resolveEotDiscards(st, pid, DATA);
  yield* pinkWindow(st, pid, DATA, false);
  refillTray(st, p.group);
  st.turnPid = null;
  logEvent(st, 'turn_end', { pid });
}

const P2 = (st, pid) => st.players.find(x => x.pid === pid);

// ---------- 合法行动判定 ----------
export function legalActions(st, pid, DATA) {
  const p = P2(st, pid);
  const legal = [];
  const playable = p.hand.some(id => {
    const b = D(DATA, id);
    return b.habitats.some(h => p.habitats[h].length < 5) && canAffordBird(p, b, DATA);
  });
  if (playable) legal.push('play_bird');
  if (st.feeders[p.group].dice.some(d => d.in)) legal.push('gain_food');
  if (totalEggCapacity(p) > 0) legal.push('lay_eggs');
  legal.push('draw_cards');
  return legal;
}
function D(DATA, id) { return DATA.birds.find(b => b.id === id); }
export function canAffordBird(p, b, DATA) {
  // 蛋成本：打到目标列需付的蛋（列 = 行鸟数+1）
  const targetHabs = b.habitats.filter(h => p.habitats[h].length < 5);
  if (!targetHabs.length) return false;
  const okEgg = targetHabs.some(h => {
    const col = p.habitats[h].length; // 新列索引
    const eggCost = DATA.mat.play_egg_cost[col];
    return totalEggs(p) >= eggCost;
  });
  if (!okEgg) return false;
  return paymentPlans(b.food_cost, p.food).length > 0;
}
export function totalEggs(p) { return allBirds(p).reduce((a, x) => a + x.eggs, 0); }

// ---------- 食物支付求解（含 2 换 1，仅打鸟时） ----------
// cost: [{type,amount}...] 或 [{any_of:[...]}]；返回可行的支付方案列表（供 UI 展示/服务端校验）
export function paymentPlans(cost, supply) {
  const plans = [];
  // 归一化：展开 any_of 为多个备选成本
  const variants = [cost];
  const idx = cost.findIndex(c => c.any_of);
  if (idx >= 0) {
    const v2 = [];
    const base = cost.slice();
    const alt = base.splice(idx, 1)[0].any_of;
    for (const a of alt) variants.push([...base, a]);
  }
  for (const v of variants) {
    const need = {};
    for (const it of v) if (it.type !== 'none' && it.type !== 'wild') need[it.type] = (need[it.type] || 0) + (it.amount || 1);
    const wildNeed = v.filter(it => it.type === 'wild').reduce((a, it) => a + (it.amount || 1), 0);
    // 贪心 + 2 换 1：直接付 → 剩余缺口用 2 换 1
    const pay = {};
    let ok = true;
    for (const f of Object.keys(need)) {
      const use = Math.min(need[f], supply[f] || 0);
      if (use > 0) { pay[f] = use; need[f] -= use; }
    }
    let shortfall = Object.values(need).reduce((a, b) => a + b, 0) + wildNeed;
    let have = FOODS.reduce((a, f) => a + Math.max(0, (supply[f] || 0) - (pay[f] || 0)), 0);
    if (shortfall * 2 <= have) {
      // 构造 2 换 1 明细：每种缺口 1 份 = 2 个任意食物
      const plan = { direct: { ...pay }, twofor: shortfall };
      plans.push(plan);
    }
    void ok;
  }
  return plans;
}
// 校验客户端提交的支付明细
export function validatePayment(cost, supply, direct, twofor) {
  const supplyC = { ...supply };
  for (const f of Object.keys(direct || {})) {
    if ((supplyC[f] || 0) < direct[f]) return false;
    supplyC[f] -= direct[f];
  }
  const have = foodSum(supplyC);
  if (!twofor || twofor < 0 || twofor * 2 > have) return false;
  // 还原需求并检查 direct 是否精确匹配 cost（非 2 换 1 部分）
  for (const v of [cost].flat()) {
    if (v.any_of) {
      // 二选一：direct 应等于其中一个选项
      const ok = v.any_of.some(alt => {
        const needType = alt.type;
        return (direct[needType] || 0) >= (alt.amount || 1) && coveredBy(cost, alt, direct, twofor);
      });
      if (ok) return true;
    }
  }
  return coveredByCost(cost, supply, direct, twofor);
}
function coveredByCost(cost, supply, direct, twofor) {
  // 每个成本项要么被 direct 精确覆盖，要么计入 twofor 数量
  let twoforNeed = 0;
  const d = { ...(direct || {}) };
  for (const it of cost) {
    if (it.type === 'none') continue;
    if (it.type === 'wild') { twoforNeed += it.amount || 1; continue; }
    const use = Math.min(d[it.type] || 0, it.amount || 1);
    d[it.type] = (d[it.type] || 0) - use;
    if (use < (it.amount || 1)) twoforNeed += (it.amount || 1) - use;
  }
  const extra = Object.values(d).reduce((a, b) => a + Math.max(0, b), 0);
  return twofor === twoforNeed + Math.floor(extra / 2) && extra % 2 === 0;
}
function coveredBy(cost, alt, direct, twofor) { return coveredByCost([{ type: alt.type, amount: alt.amount }], {}, direct, twofor); }

// ---------- 行动一：打鸟 ----------
function* actionPlayBird(st, pid, DATA) {
  const ok = yield* playBirdInternal(st, pid, DATA, {});
  if (!ok) logEvent(st, 'action_fizzled', { pid, action: 'play_bird' });
}

// 打鸟内部流程（普通行动 / 白能力"再打一只"共用）
// opts.limitHabitat：限定目标栖息地（白能力）；返回是否成功打出
function* playBirdInternal(st, pid, DATA, opts) {
  const p = P2(st, pid);
  const limitHab = opts.limitHabitat || null;
  const candidates = p.hand.filter(id => {
    const b = D(DATA, id);
    const habs = b.habitats.filter(h => p.habitats[h].length < 5);
    if (limitHab) return habs.includes(limitHab) && canAffordBird(p, b, DATA);
    return habs.length > 0 && canAffordBird(p, b, DATA);
  });
  if (!candidates.length) return false;
  const r1 = yield ask(st, pid, 'play_pick_bird', { candidates });
  const cardId = r1 && candidates.includes(r1.bird) ? r1.bird : candidates[0];
  const b = D(DATA, cardId);
  let habs = b.habitats.filter(h => p.habitats[h].length < 5 && totalEggs(p) >= DATA.mat.play_egg_cost[p.habitats[h].length]);
  if (limitHab) habs = habs.filter(h => h === limitHab);
  if (!habs.length) return false;
  const r2 = yield ask(st, pid, 'play_pick_habitat', { bird: cardId, habitats: habs, eggCosts: Object.fromEntries(habs.map(h => [h, DATA.mat.play_egg_cost[p.habitats[h].length]])) });
  const hab = r2 && habs.includes(r2.habitat) ? r2.habitat : habs[0];
  const col = p.habitats[hab].length;
  const eggCost = DATA.mat.play_egg_cost[col];

  // 支付蛋：选择从哪些鸟移除
  if (eggCost > 0) {
    const r3 = yield ask(st, pid, 'play_pay_eggs', { amount: eggCost });
    applyEggRemoval(p, (r3 && r3.birds) || [], eggCost);
  }
  // 支付食物
  const plans = paymentPlans(b.food_cost, p.food);
  const r4 = yield ask(st, pid, 'play_pay_food', { cost: b.food_cost, plans });
  const plan = r4 && r4.plan && validatePayment(b.food_cost, p.food, r4.plan.direct, r4.plan.twofor)
    ? r4.plan : plans[0];
  applyPayment(p, plan);

  // 放置
  p.hand.splice(p.hand.indexOf(cardId), 1);
  const inst = { iid: 'i' + st.rev + '_' + pid, cardId, eggs: 0, cached: [], tucked: 0, eggLimit: b.egg_limit };
  p.habitats[hab].push(inst);
  logEvent(st, 'bird_played', { pid, card: cardId, habitat: hab, col, eggCost });

  // 白色能力（可连锁）
  if (b.power && b.power.color === 'white') yield* runPower(st, pid, inst, b, DATA);
  // 粉色触发：有鸟被打出
  st._pinkFlag = { type: 'bird_played', habitat: hab };
  return true;
}

function applyEggRemoval(p, picks, amount) {
  let need = amount;
  const cnt = {};
  for (const iid of picks) cnt[iid] = (cnt[iid] || 0) + 1;
  for (const h of HABITATS) for (const inst of p.habitats[h]) {
    if (cnt[inst.iid]) {
      const take = Math.min(cnt[inst.iid], inst.eggs, need);
      inst.eggs -= take; need -= take;
      if (need <= 0) return;
    }
  }
  // 兜底：从右到左扣
  if (need > 0) for (const h of HABITATS) for (let i = p.habitats[h].length - 1; i >= 0 && need > 0; i--) {
    const inst = p.habitats[h][i];
    const take = Math.min(inst.eggs, need); inst.eggs -= take; need -= take;
  }
}
function applyPayment(p, plan) {
  if (!plan) return;
  for (const f of Object.keys(plan.direct || {})) p.food[f] -= plan.direct[f];
  if (plan.twofor) {
    let left = plan.twofor * 2;
    for (const f of FOODS) { const use = Math.min(left, p.food[f]); p.food[f] -= use; left -= use; if (!left) break; }
  }
}

// ---------- 行动二：获取食物 ----------
function* actionGainFood(st, pid, DATA) {
  const p = P2(st, pid);
  const col = p.habitats.forest.length;
  // 官方：行满（5 鸟）时无暴露槽位，基础收益与交换均不可用，仅触发棕色能力
  if (col >= 5) {
    logEvent(st, 'action_gain_food', { pid, dice: 0, slot: 0, full: true });
    st._actionFoods = [];
    yield* runBrownRow(st, pid, 'forest', DATA);
    st._pinkFlag = { type: 'gain_food_action', foods: st._actionFoods.splice(0) };
    st._actionFoods = null;
    return;
  }
  const slot = DATA.mat.forest[col];
  let takes = slot.dice;
  logEvent(st, 'action_gain_food', { pid, dice: takes, slot: col + 1 });
  // 交换：弃 1 卡 → 额外 1 骰
  if (slot.exchange === 'card_food' && p.hand.length > 0) {
    const r = yield ask(st, pid, 'exchange_card_food', {});
    if (r && r.use) {
      const rc = yield ask(st, pid, 'exchange_pick_card', { hand: [...p.hand] });
      const card = rc && p.hand.includes(rc.card) ? rc.card : p.hand[0];
      p.hand.splice(p.hand.indexOf(card), 1); st.discards[p.group].push(card);
      takes += 1;
      logEvent(st, 'exchange_card_food', { pid, card });
    }
  }
  st._actionFoods = [];
  for (let i = 0; i < takes; i++) yield* takeOneDie(st, pid, DATA);
  // 森林棕能力（右→左）
  yield* runBrownRow(st, pid, 'forest', DATA);
  st._pinkFlag = { type: 'gain_food_action', foods: st._actionFoods.splice(0) };
  st._actionFoods = null;
}

// 从喂食器取 1 颗骰（处理空器强制重掷 / 全同面可选重掷 / 二选一面）
function* takeOneDie(st, pid, DATA) {
  const p = P2(st, pid);
  const feeder = st.feeders[p.group];
  if (!feeder.dice.some(d => d.in)) rerollFeeder(st, p.group, DATA);
  const inDice = () => feeder.dice.filter(d => d.in);
  if (allSameFace(inDice())) {
    const r = yield ask(st, pid, 'optional_reroll', { faces: inDice().map(d => d.face) });
    if (r && r.reroll) rerollFeeder(st, p.group, DATA);
  }
  const faces = [...new Set(inDice().map(d => d.face))];
  const r = yield ask(st, pid, 'pick_die', { faces });
  let face = faces.includes(r && r.face) ? r.face : faces[0];
  let got;
  if (face === 'seed_or_invertebrate') {
    const r2 = yield ask(st, pid, 'pick_die_face', { face });
    got = r2 && ['seed', 'invertebrate'].includes(r2.food) ? r2.food : 'seed';
  } else got = face;
  const die = feeder.dice.find(d => d.in && d.face === face);
  die.in = false;
  p.food[got]++;
  if (st._actionFoods) st._actionFoods.push(got);
  logEvent(st, 'food_gained', { pid, food: got, from: 'feeder' });
  return got;
}
function allSameFace(dice) { return dice.length > 0 && dice.every(d => d.face === dice[0].face); }
function rerollFeeder(st, gid, DATA) {
  const feeder = st.feeders[gid];
  const rng = st._rng.dice;
  for (const d of feeder.dice) { d.in = true; d.face = DICE_FACES[rng.int(6)]; }
  logEvent(st, 'feeder_rerolled', { group: gid, faces: feeder.dice.map(d => d.face) });
}

// ---------- 行动三：产蛋 ----------
function* actionLayEggs(st, pid, DATA) {
  const p = P2(st, pid);
  const col = p.habitats.grassland.length;
  // 官方：行满（5 鸟）时无暴露槽位，基础收益与交换均不可用，仅触发棕色能力
  if (col >= 5) {
    logEvent(st, 'action_lay_eggs', { pid, eggs: 0, slot: 0, full: true });
    yield* runBrownRow(st, pid, 'grassland', DATA);
    st._pinkFlag = { type: 'lay_eggs_action' };
    return;
  }
  const slot = DATA.mat.grassland[col];
  let n = slot.eggs;
  logEvent(st, 'action_lay_eggs', { pid, eggs: n, slot: col + 1 });
  if (slot.exchange === 'food_egg' && foodSum(p.food) > 0) {
    const r = yield ask(st, pid, 'exchange_food_egg', {});
    if (r && r.use) {
      const rf = yield ask(st, pid, 'exchange_pick_food', { food: { ...p.food } });
      const f = rf && FOODS.includes(rf.food) && p.food[rf.food] > 0 ? rf.food : FOODS.find(x => p.food[x] > 0);
      p.food[f]--; n += 1;
      logEvent(st, 'exchange_food_egg', { pid, food: f });
    }
  }
  const cap = totalEggCapacity(p);
  const laid = Math.min(n, cap);
  if (laid > 0) {
    const r = yield ask(st, pid, 'lay_eggs_alloc', { amount: laid, capacity: cap });
    applyEggAllocation(p, r && r.alloc, laid);
  }
  if (n > cap) logEvent(st, 'eggs_lost', { pid, lost: n - cap });
  // 草原棕能力
  yield* runBrownRow(st, pid, 'grassland', DATA);
  st._pinkFlag = { type: 'lay_eggs_action' };
}
function applyEggAllocation(p, alloc, amount) {
  const map = {};
  for (const x of alloc || []) map[x.iid] = (map[x.iid] || 0) + x.n;
  let placed = 0;
  for (const h of HABITATS) for (const inst of p.habitats[h]) {
    const want = Math.min(map[inst.iid] || 0, eggCapacity(inst), amount - placed);
    inst.eggs += want; placed += want;
  }
  // 兜底自动分配
  for (const h of HABITATS) for (const inst of p.habitats[h]) {
    if (placed >= amount) return;
    const want = Math.min(eggCapacity(inst), amount - placed);
    inst.eggs += want; placed += want;
  }
}

// ---------- 行动四：抽卡 ----------
function* actionDrawCards(st, pid, DATA) {
  const p = P2(st, pid);
  const col = p.habitats.wetland.length;
  // 官方：行满（5 鸟）时无暴露槽位，基础收益与交换均不可用，仅触发棕色能力
  if (col >= 5) {
    logEvent(st, 'action_draw', { pid, cards: 0, slot: 0, full: true });
    yield* runBrownRow(st, pid, 'wetland', DATA);
    return;
  }
  const slot = DATA.mat.wetland[col];
  let n = slot.cards;
  logEvent(st, 'action_draw', { pid, cards: n, slot: col + 1 });
  if (slot.exchange === 'egg_card' && totalEggs(p) > 0) {
    const r = yield ask(st, pid, 'exchange_egg_card', {});
    if (r && r.use) {
      const re = yield ask(st, pid, 'exchange_pick_egg', {});
      removeOneEgg(p, re && re.iid);
      n += 1;
      logEvent(st, 'exchange_egg_card', { pid });
    }
  }
  for (let i = 0; i < n; i++) {
    const tray = st.trays[p.group];
    const options = ['deck', ...tray.map((c, idx) => c ? 'tray' + idx : null).filter(Boolean)];
    const r = yield ask(st, pid, 'draw_pick_source', { tray: [...tray], remaining: n - i });
    const src = r && options.includes(r.source) ? r.source : 'deck';
    if (src === 'deck') {
      const card = drawFromDeck(st, p.group);
      if (card) { p.hand.push(card); logEvent(st, 'card_drawn', { pid, from: 'deck' }); }
    } else {
      const idx = parseInt(src.slice(4));
      const card = tray[idx];
      tray[idx] = null; // 回合末补
      p.hand.push(card);
      logEvent(st, 'card_drawn', { pid, from: 'tray', card });
    }
  }
  // 湿地棕能力
  yield* runBrownRow(st, pid, 'wetland', DATA);
}
function drawFromDeck(st, gid) {
  if (!st.decks[gid].length) {
    if (!st.discards[gid].length) return null;
    st.decks[gid] = st._rng.deck.shuffle(st.discards[gid].splice(0));
    logEvent(st, 'deck_reshuffled', { group: gid });
  }
  return st.decks[gid].pop() || null;
}
// 抽 1 张奖励卡（虚拟牌堆；耗尽时把弃牌堆重洗回收）
function drawBonusCard(st) {
  if (!st.bonusDeck.length) {
    if (!st.bonusDiscard.length) return null;
    st.bonusDeck = st._rng.deck.shuffle(st.bonusDiscard.splice(0));
    logEvent(st, 'bonus_reshuffled', {});
  }
  return st.bonusDeck.pop() || null;
}
function removeOneEgg(p, iid) {
  if (iid) for (const h of HABITATS) for (const inst of p.habitats[h]) if (inst.iid === iid && inst.eggs > 0) { inst.eggs--; return; }
  for (const h of HABITATS) for (const inst of p.habitats[h]) if (inst.eggs > 0) { inst.eggs--; return; }
}
function refillTray(st, gid) {
  const tray = st.trays[gid];
  for (let i = 0; i < tray.length; i++) if (!tray[i]) tray[i] = drawFromDeck(st, gid);
  if (st.log[st.log.length - 1]?.type !== 'tray_refilled') logEvent(st, 'tray_refilled', { group: gid, tray: [...tray] });
}

// ---------- 棕色能力（右→左） ----------
function* runBrownRow(st, pid, hab, DATA) {
  const p = P2(st, pid);
  const row = [...p.habitats[hab]].reverse(); // 右到左
  for (const inst of row) {
    const b = D(DATA, inst.cardId);
    if (!b.power || b.power.color !== 'brown') continue;
    const r = yield ask(st, pid, 'activate_brown', { bird: inst.cardId, habitat: hab, text: b.power.text });
    if (!(r && r.activate === false)) {
      logEvent(st, 'power_activated', { pid, card: inst.cardId, color: 'brown' });
      yield* runOps(st, pid, inst, b.power.ops, DATA, { thisBird: inst, habitat: hab });
    }
  }
}

// ---------- 效果原语解释器 ----------
function* runOps(st, pid, inst, ops, DATA, ctx) {
  for (const op of ops) yield* runOp(st, pid, inst, op, DATA, ctx);
}
function* runOp(st, pid, inst, op, DATA, ctx) {
  const p = P2(st, pid);
  const bird = ctx.thisBird || inst;
  logEvent(st, 'op', { pid, op: op.op });
  switch (op.op) {
    case 'gain_food': {
      if (op.from === 'feeder') {
        // 喂食器中指定食物"若有"
        const feeder = st.feeders[p.group];
        const hasFace = f => feeder.dice.some(d => d.in && (d.face === f || (d.face === 'seed_or_invertebrate' && (f === 'seed' || f === 'invertebrate'))));
        let wantFood = op.food;
        // 二选一食物（如 Indigo Bunting：invertebrate or fruit）
        if (op.choices) {
          const avail = op.choices.filter(hasFace);
          if (!avail.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: 'feeder 无可用食物' }); break; }
          const rc = yield ask(st, pid, 'feeder_food_choice', { choices: avail });
          wantFood = rc && avail.includes(rc.food) ? rc.food : avail[0];
        }
        if (hasFace(wantFood)) {
          const die = feeder.dice.find(d => d.in && d.face === wantFood) || feeder.dice.find(d => d.in && d.face === 'seed_or_invertebrate');
          die.in = false;
          if (op.optional_cache) {
            const r = yield ask(st, pid, 'cache_or_gain', { food: wantFood });
            if (r && r.cache) { bird.cached.push(wantFood); logEvent(st, 'food_cached', { pid, card: bird.cardId, food: wantFood }); break; }
          }
          p.food[wantFood]++;
          if (st._actionFoods) st._actionFoods.push(wantFood);
          logEvent(st, 'food_gained', { pid, food: wantFood, from: 'feeder' });
        } else logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: 'feeder 无 ' + wantFood });
      } else {
        let sf = op.food;
        if (op.choices) {
          const rc = yield ask(st, pid, 'supply_food_choice', { choices: op.choices });
          sf = rc && op.choices.includes(rc.food) ? rc.food : op.choices[0];
        }
        p.food[sf] += op.n;
        logEvent(st, 'food_gained', { pid, food: sf, from: 'supply', n: op.n });
      }
      break;
    }
    case 'take_die': yield* takeOneDie(st, pid, DATA); break;
    case 'gain_all_dice': {
      const feeder = st.feeders[p.group];
      const match = d => d.in && (d.face === op.face || (d.face === 'seed_or_invertebrate' && (op.face === 'seed' || op.face === 'invertebrate')));
      let n = 0;
      for (const d of feeder.dice) if (match(d)) { d.in = false; n++; }
      p.food[op.face] += n;
      logEvent(st, 'food_gained', { pid, food: op.face, from: 'feeder', n });
      break;
    }
    case 'cache_food': {
      for (let i = 0; i < (op.n || 1); i++) bird.cached.push(op.food);
      logEvent(st, 'food_cached', { pid, card: bird.cardId, food: op.food, n: op.n || 1 });
      break;
    }
    case 'predator': {
      const feeder = st.feeders[p.group];
      const outside = feeder.dice.filter(d => !d.in);
      const rng = st._rng.dice;
      const faces = outside.map(() => DICE_FACES[rng.int(6)]);
      const hit = faces.some(f => f === op.face || (f === 'seed_or_invertebrate' && (op.face === 'seed' || op.face === 'invertebrate')));
      logEvent(st, 'predator_roll', { pid, card: bird.cardId, faces, target: op.face, success: hit });
      if (hit) {
        bird.cached.push(op.face);
        logEvent(st, 'food_cached', { pid, card: bird.cardId, food: op.face });
        st._predatorSuccess = true; // 粉色秃鹫触发标记
      }
      break;
    }
    case 'lay_eggs': {
      const targets = eggTargets(p, op.on, bird);
      if (!targets.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无合法产蛋目标' }); break; }
      if (op.on === 'this' || op.on.nest) {
        // 单目标（可能自动）
        if (targets.length === 1 || op.on === 'this') {
          const t = op.on === 'this' ? bird : targets[0];
          const n = Math.min(op.n, eggCapacity(t));
          t.eggs += n;
          logEvent(st, 'eggs_laid', { pid, card: t.cardId, n });
        } else {
          const r = yield ask(st, pid, 'lay_egg_target', { targets, n: op.n });
          const t = targets.find(x => x.iid === (r && r.iid)) || targets[0];
          const n = Math.min(op.n, eggCapacity(t));
          t.eggs += n;
          logEvent(st, 'eggs_laid', { pid, card: t.cardId, n });
        }
      } else {
        // any：多颗蛋自由分配
        const r = yield ask(st, pid, 'lay_eggs_alloc', { amount: op.n, targets });
        applyEggAllocation(p, r && r.alloc, Math.min(op.n, targets.reduce((a, t) => a + eggCapacity(t), 0)));
        logEvent(st, 'eggs_laid', { pid, n: op.n });
      }
      break;
    }
    case 'lay_eggs_each': {
      let n = 0;
      for (const h of HABITATS) for (const t of p.habitats[h]) if (nestMatches(tNest(st, t, DATA), op.nest) && eggCapacity(t) > 0) { t.eggs++; n++; }
      logEvent(st, 'eggs_laid', { pid, n, nest: op.nest });
      break;
    }
    case 'discard_egg_gain': {
      const others = allBirds(p).filter(x => x !== bird && x.eggs > 0);
      if (!others.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无蛋可弃' }); break; }
      const r = yield ask(st, pid, 'discard_egg_pick', { birds: others.map(o => o.iid) });
      removeOneEgg(p, r && r.iid);
      const rw = yield ask(st, pid, 'pick_wild_food', { n: op.n });
      gainWild(p, op.n, rw && rw.food);
      logEvent(st, 'egg_discarded_gain', { pid, n: op.n });
      break;
    }
    case 'draw': {
      for (let i = 0; i < op.n; i++) {
        if (op.from === 'any') {
          const tray = st.trays[p.group];
          const options = ['deck', ...tray.map((c, idx) => c ? 'tray' + idx : null).filter(Boolean)];
          const r = yield ask(st, pid, 'draw_pick_source', { tray: [...tray], remaining: op.n - i });
          const src = r && options.includes(r.source) ? r.source : 'deck';
          if (src === 'deck') { const c = drawFromDeck(st, p.group); if (c) p.hand.push(c); }
          else { const idx = parseInt(src.slice(4)); p.hand.push(st.trays[p.group][idx]); st.trays[p.group][idx] = null; }
        } else { const c = drawFromDeck(st, p.group); if (c) p.hand.push(c); }
      }
      logEvent(st, 'card_drawn', { pid, n: op.n });
      break;
    }
    case 'draw_bonus': {
      const drawn = [];
      for (let i = 0; i < op.draw; i++) { const c = drawBonusCard(st); if (c) drawn.push(c); }
      // 官方：保留 1 张新卡替换当前奖励卡；也可选择保留原卡，新卡全部弃掉
      const r = yield ask(st, pid, 'bonus_keep', { drawn, keep: op.keep, current: p.bonus });
      if (r && r.keep === 'keep_current') {
        st.bonusDiscard.push(...drawn);
        logEvent(st, 'bonus_kept', { pid, bonus: p.bonus, keptCurrent: true });
      } else {
        const keep = r && drawn.includes(r.keep) ? r.keep : drawn[0];
        if (p.bonus) st.bonusDiscard.push(p.bonus);
        p.bonus = keep;
        st.bonusDiscard.push(...drawn.filter(x => x !== keep));
        logEvent(st, 'bonus_kept', { pid, bonus: keep });
      }
      break;
    }
    case 'draw_then_eot_discard': {
      for (let i = 0; i < op.draw; i++) { const c = drawFromDeck(st, p.group); if (c) p.hand.push(c); }
      p.eotDiscards += op.discard;
      logEvent(st, 'card_drawn', { pid, n: op.draw, eot_discard: op.discard });
      break;
    }
    case 'tuck_hand': {
      if (!p.hand.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无手牌可塞' }); break; }
      const r = yield ask(st, pid, 'tuck_pick', { hand: [...p.hand], n: op.n });
      const cards = (r && r.cards || []).filter(c => p.hand.includes(c)).slice(0, op.n);
      if (!cards.length) { logEvent(st, 'power_skipped', { pid, card: bird.cardId }); break; }
      for (const c of cards) { p.hand.splice(p.hand.indexOf(c), 1); bird.tucked++; }
      logEvent(st, 'card_tucked', { pid, card: bird.cardId, n: cards.length, from: 'hand' });
      // if_do 后续效果
      for (const sub of op.if_do || []) {
        if (sub.optional) {
          const rr = yield ask(st, pid, 'optional_if_do', { sub });
          if (!(rr && rr.use)) continue;
        }
        yield* runOp(st, pid, inst, sub, DATA, ctx);
      }
      break;
    }
    case 'tuck_deck_cost': {
      if (p.food[op.cost.food] >= op.cost.n) {
        const r = yield ask(st, pid, 'optional_tuck_deck_cost', { cost: op.cost, tuck: op.tuck });
        if (r && r.use) {
          p.food[op.cost.food] -= op.cost.n;
          for (let i = 0; i < op.tuck; i++) {
            const c = drawFromDeck(st, p.group);
            if (c) { bird.tucked++; }
          }
          logEvent(st, 'card_tucked', { pid, card: bird.cardId, n: op.tuck, from: 'deck' });
        }
      }
      break;
    }
    case 'look_tuck': {
      const c = drawFromDeck(st, p.group);
      if (!c) break;
      const cb = D(DATA, c);
      if (cb.wingspan < op.max_ws) { bird.tucked++; logEvent(st, 'card_tucked', { pid, card: bird.cardId, n: 1, from: 'deck_look', wingspan: cb.wingspan }); }
      else { st.discards[p.group].push(c); logEvent(st, 'card_discarded', { pid, card: c, wingspan: cb.wingspan }); }
      break;
    }
    case 'move_if_rightmost': {
      const row = p.habitats[ctx.habitat || findHabitatOf(p, bird)];
      if (row[row.length - 1] !== bird) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '不是最右鸟' }); break; }
      const dests = HABITATS.filter(h => h !== findHabitatOf(p, bird) && p.habitats[h].length < 5);
      if (!dests.length) break;
      const r = yield ask(st, pid, 'move_bird_dest', { dests });
      const dest = r && dests.includes(r.habitat) ? r.habitat : dests[0];
      const from = findHabitatOf(p, bird);
      p.habitats[from].splice(p.habitats[from].indexOf(bird), 1);
      p.habitats[dest].push(bird);
      logEvent(st, 'bird_moved', { pid, card: bird.cardId, from, to: dest });
      break;
    }
    case 'all_draw': {
      for (const q of st.players) { const c = drawFromDeck(st, q.group); if (c) q.hand.push(c); }
      logEvent(st, 'all_draw', { pid });
      break;
    }
    case 'all_gain': {
      for (const q of st.players) q.food[op.food] += op.n;
      logEvent(st, 'all_gain', { pid, food: op.food, n: op.n });
      break;
    }
    case 'each_take_die': {
      const order = st.players.map(x => x.pid);
      const r = yield ask(st, pid, 'pick_start_player', { players: order });
      const start = r && order.includes(r.pid) ? r.pid : pid;
      const idx = order.indexOf(start);
      for (let i = 0; i < order.length; i++) {
        const qid = order[(idx + i) % order.length];
        const q = P2(st, qid);
        const feeder = st.feeders[q.group];
        if (!feeder.dice.some(d => d.in)) rerollFeeder(st, q.group, DATA);
        // 每位玩家选 1 颗（人类/机器人都回答）
        const faces = [...new Set(feeder.dice.filter(d => d.in).map(d => d.face))];
        if (!faces.length) continue;
        const rq = yield ask(st, qid, 'pick_die', { faces });
        let face = faces.includes(rq && rq.face) ? rq.face : faces[0];
        let got = face;
        if (face === 'seed_or_invertebrate') {
          const rf = yield ask(st, qid, 'pick_die_face', { face });
          got = rf && ['seed', 'invertebrate'].includes(rf.food) ? rf.food : 'seed';
        }
        const die = feeder.dice.find(d => d.in && d.face === face);
        die.in = false; q.food[got]++;
        if (st._actionFoods) st._actionFoods.push(got);
        logEvent(st, 'food_gained', { pid: qid, food: got, from: 'feeder' });
      }
      break;
    }
    case 'fewest_habitat_draw': {
      const counts = st.players.map(q => ({ pid: q.pid, n: q.habitats[op.habitat].length }));
      const min = Math.min(...counts.map(c => c.n));
      for (const c of counts) if (c.n === min) {
        const q = P2(st, c.pid);
        const card = drawFromDeck(st, q.group);
        if (card) q.hand.push(card);
      }
      logEvent(st, 'fewest_draw', { pid, habitat: op.habitat, winners: counts.filter(c => c.n === min).map(c => c.pid) });
      break;
    }
    case 'draw_tray_all': {
      const tray = st.trays[p.group];
      let n = 0;
      for (let i = 0; i < tray.length; i++) if (tray[i]) { p.hand.push(tray[i]); tray[i] = null; n++; }
      logEvent(st, 'card_drawn', { pid, from: 'tray_all', n });
      break;
    }
    case 'draw_and_distribute': {
      const total = st.players.length + 1;
      const cards = [];
      for (let i = 0; i < total; i++) { const c = drawFromDeck(st, p.group); if (c) cards.push(c); }
      const order = st.players.map(x => x.pid);
      const idx = order.indexOf(pid);
      for (let i = 0; i < order.length && cards.length; i++) {
        const qid = order[(idx + i) % order.length];
        const r = yield ask(st, qid, 'pick_distributed_card', { cards: [...cards] });
        const pickIdx = r && cards.includes(r.card) ? cards.indexOf(r.card) : 0;
        P2(st, qid).hand.push(cards.splice(pickIdx, 1)[0]);
      }
      if (cards.length) p.hand.push(cards.shift()); // 发起者保留剩余
      logEvent(st, 'draw_and_distribute', { pid, total });
      break;
    }
    case 'play_another_bird': {
      // 白能力：在指定栖息地（或本鸟所在栖息地）再打一只鸟，付正常费用，不耗行动
      let limitHab = op.habitat;
      if (!limitHab && op.this_habitat) limitHab = ctx.habitat || findHabitatOf(p, bird);
      const ok = yield* playBirdInternal(st, pid, DATA, { limitHabitat: limitHab });
      if (!ok) logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无可打出的鸟' });
      break;
    }
    case 'repeat_brown': {
      // 重复同一栖息地另一只鸟的棕色能力（Hooded Merganser 限定 predator）
      const hab = ctx.habitat || findHabitatOf(p, bird);
      const targets = p.habitats[hab].filter(x => x !== bird &&
        D(DATA, x.cardId).power?.color === 'brown' &&
        (!op.predator_only || D(DATA, x.cardId).predator));
      if (!targets.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无可重复的棕色能力' }); break; }
      const r = yield ask(st, pid, 'repeat_pick_target', { targets: targets.map(t => t.iid) });
      const t = targets.find(x => x.iid === (r && r.iid)) || targets[0];
      const tb = D(DATA, t.cardId);
      logEvent(st, 'power_activated', { pid, card: t.cardId, color: 'brown', repeated: true });
      yield* runOps(st, pid, t, tb.power.ops, DATA, { thisBird: t, habitat: hab });
      break;
    }
    case 'trade_food': {
      // 弃 1 个任意食物，从供应区换 1 个其他类型
      const giveable = FOODS.filter(f => p.food[f] > 0);
      if (!giveable.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无食物可交易' }); break; }
      const rg = yield ask(st, pid, 'trade_pick_give', { foods: giveable });
      const give = rg && giveable.includes(rg.food) ? rg.food : giveable[0];
      const gettable = FOODS.filter(f => f !== give);
      const r2 = yield ask(st, pid, 'trade_pick_get', { foods: gettable, give });
      const get = r2 && gettable.includes(r2.food) ? r2.food : gettable[0];
      p.food[give]--; p.food[get]++;
      logEvent(st, 'food_traded', { pid, give, get });
      break;
    }
    case 'discard_egg_draw': {
      // 弃 1 蛋，从牌库抽 2 卡
      const withEgg = allBirds(p).filter(x => x.eggs > 0);
      if (!withEgg.length) { logEvent(st, 'power_fizzled', { pid, card: bird.cardId, reason: '无蛋可弃' }); break; }
      const r = yield ask(st, pid, 'discard_egg_pick', { birds: withEgg.map(x => x.iid) });
      removeOneEgg(p, r && r.iid);
      for (let i = 0; i < (op.draw || 2); i++) { const c = drawFromDeck(st, p.group); if (c) p.hand.push(c); }
      logEvent(st, 'card_drawn', { pid, n: op.draw || 2, from: 'egg_discard' });
      break;
    }
    case 'all_lay_eggs': {
      // 所有玩家在 1 只指定巢型鸟上产 1 蛋；发起者可额外在另一只上产 1
      const nestTargetsOf = q => {
        const arr = [];
        for (const h of HABITATS) for (const t of q.habitats[h])
          if (nestMatches(tNest(st, t, DATA), op.nest) && eggCapacity(t) > 0) arr.push(t);
        return arr;
      };
      let firstTarget = null;
      for (const q of st.players) {
        const ts = nestTargetsOf(q);
        if (!ts.length) continue;
        const r = yield ask(st, q.pid, 'all_lay_egg_target', { targets: ts.map(t => t.iid), nest: op.nest });
        const t = ts.find(x => x.iid === (r && r.iid)) || ts[0];
        t.eggs++;
        if (q.pid === pid) firstTarget = t;
        logEvent(st, 'eggs_laid', { pid: q.pid, card: t.cardId, n: 1, all_lay: true });
      }
      // 发起者额外 1 蛋（可选，须为另一只）
      let extraTs = nestTargetsOf(p);
      if (firstTarget) extraTs = extraTs.filter(t => t !== firstTarget);
      if (extraTs.length) {
        const r = yield ask(st, pid, 'all_lay_extra', { targets: extraTs.map(t => t.iid), nest: op.nest });
        if (r && r.iid && extraTs.some(t => t.iid === r.iid)) {
          const t = extraTs.find(x => x.iid === r.iid);
          t.eggs++;
          logEvent(st, 'eggs_laid', { pid, card: t.cardId, n: 1, extra: true });
        }
      }
      break;
    }
    case 'fewest_habitat_food': {
      // 指定栖息地鸟最少的玩家，从自己组喂食器取 1 颗骰
      const counts = st.players.map(q => ({ pid: q.pid, n: q.habitats[op.habitat].length }));
      const min = Math.min(...counts.map(c => c.n));
      const winners = counts.filter(c => c.n === min).map(c => c.pid);
      for (const wid of winners) yield* takeOneDie(st, wid, DATA);
      logEvent(st, 'fewest_food', { pid, habitat: op.habitat, winners });
      break;
    }
    case 'pink': break; // pink 由 pinkWindow 处理，不在此执行
    default: logEvent(st, 'unknown_op', { op: op.op });
  }
}
function gainWild(p, n, chosen) { // 获得任意食物：人类可指定类型，否则自动选最稀缺
  if (chosen && FOODS.includes(chosen)) { p.food[chosen] += n; return; }
  const minF = FOODS.reduce((a, b) => (p.food[a] <= p.food[b] ? a : b));
  p.food[minF] += n;
}
function eggTargets(p, on, thisBird) {
  if (on === 'this') return eggCapacity(thisBird) > 0 ? [thisBird] : [];
  if (on === 'any') return allBirds(p).filter(x => eggCapacity(x) > 0);
  if (on && on.nest) return allBirds(p).filter(x => nestMatches(xNest(x), on.nest) && eggCapacity(x) > 0);
  if (on && on.other_nest) return allBirds(p).filter(x => x !== thisBird && nestMatches(xNest(x), on.other_nest) && eggCapacity(x) > 0);
  return allBirds(p).filter(x => eggCapacity(x) > 0);
}
function xNest(inst) { return inst.nest || 'wild'; }
function tNest(st, inst, DATA) { const b = D(DATA, inst.cardId); return b.nest; }
function findHabitatOf(p, bird) { return HABITATS.find(h => p.habitats[h].includes(bird)); }

// runPower：白色/粉色能力入口
function* runPower(st, pid, inst, b, DATA) {
  if (!b.power) return;
  logEvent(st, 'power_activated', { pid, card: b.id, color: b.power.color });
  yield* runOps(st, pid, inst, b.power.ops, DATA, { thisBird: inst });
}

// ---------- 粉色窗口 ----------
function* pinkWindow(st, actorPid, DATA, finalWindow) {
  const flag = finalWindow ? st._lastPinkFlag : st._pinkFlag;
  if (!flag) return;
  st._lastPinkFlag = flag;
  if (!finalWindow) st._pinkFlag = null;
  for (const q of st.players) {
    if (!finalWindow && q.pid === actorPid) continue; // 自己回合不触发
    for (const h of HABITATS) for (const inst of q.habitats[h]) {
      const b = D(DATA, inst.cardId);
      if (!b.power || b.power.color !== 'pink' || q.pinkUsed.includes(inst.iid)) continue;
      const pinkOp = b.power.ops.find(o => o.op === 'pink');
      if (!pinkOp) continue;
      let match = false;
      if (pinkOp.trigger === 'lay_eggs_action' && flag.type === 'lay_eggs_action') match = true;
      if (pinkOp.trigger === 'predator_success' && st._predatorSuccess) match = true;
      if (pinkOp.trigger === 'gain_food_action' && flag.type === 'gain_food_action' && (flag.foods || []).includes(pinkOp.food)) match = true;
      if (pinkOp.trigger === 'bird_played' && flag.type === 'bird_played' && flag.habitat === pinkOp.habitat) match = true;
      if (!match) continue;
      const r = yield ask(st, q.pid, 'pink_offer', { card: inst.cardId, text: b.power.text });
      if (r && r.use) {
        q.pinkUsed.push(inst.iid);
        logEvent(st, 'power_activated', { pid: q.pid, card: inst.cardId, color: 'pink' });
        yield* runOps(st, q.pid, inst, pinkOp.effect, DATA, { thisBird: inst });
      }
    }
  }
  st._predatorSuccess = false;
  st._pinkFlag = null;
}

// ---------- EOT 弃牌 ----------
function* resolveEotDiscards(st, pid, DATA) {
  const p = P2(st, pid);
  while (p.eotDiscards > 0) {
    if (!p.hand.length) { p.eotDiscards = 0; break; }
    const r = yield ask(st, pid, 'eot_discard', { count: p.eotDiscards, hand: [...p.hand] });
    const cards = (r && r.cards || []).filter(c => p.hand.includes(c)).slice(0, p.eotDiscards);
    while (cards.length < Math.min(p.eotDiscards, p.hand.length)) cards.push(p.hand.find(c => !cards.includes(c)));
    for (const c of cards) { p.hand.splice(p.hand.indexOf(c), 1); st.discards[p.group].push(c); }
    p.eotDiscards -= cards.length;
    logEvent(st, 'card_discarded', { pid, n: cards.length, eot: true });
  }
}

// ---------- 轮末 ----------
function* roundEnd(st, DATA) {
  st.activePids = [];
  logEvent(st, 'round_end', { round: st.round });
  // 1. 青色能力（本牌库无青卡，钩子保留）
  // 2. 目标计分
  const result = scoreRoundGoals(st, DATA);
  st.goalResults.push(result);
  logEvent(st, 'goal_scored', { round: st.round, result });
  // 3. 清理：收回方块并放 1 个到目标板；托盘全弃重发
  for (const p of st.players) {
    p.cubesOnMat = [];
    p.cubesOnGoal++;
  }
  for (const g of st.groups) {
    st.discards[g.id].push(...st.trays[g.id].filter(Boolean));
    for (let i = 0; i < DATA.constants.tray_size; i++) st.trays[g.id][i] = drawFromDeck(st, g.id);
  }
  logEvent(st, 'round_cleanup', { round: st.round });
}

// ---------- 目标砖评估 ----------
export function goalCount(st, pid, goalId, DATA) {
  const p = P2(st, pid);
  const eggsIn = h => p.habitats[h].reduce((a, x) => a + x.eggs, 0);
  const nestEggs = nest => allBirds(p).reduce((a, x) => a + (nestMatches(D(DATA, x.cardId).nest, nest) ? x.eggs : 0), 0);
  const nestBirds = nest => allBirds(p).filter(x => nestMatches(D(DATA, x.cardId).nest, nest));
  switch (goalId) {
    case 'goal_egg_sets': return Math.min(...HABITATS.map(eggsIn));
    case 'goal_egg_forest': return eggsIn('forest');
    case 'goal_egg_wetland': return eggsIn('wetland');
    case 'goal_egg_grassland': return eggsIn('grassland');
    case 'goal_egg_ground': return nestEggs('ground');
    case 'goal_egg_bowl': return nestEggs('bowl');
    case 'goal_egg_platform': return nestEggs('platform');
    case 'goal_egg_cavity': return nestEggs('cavity');
    case 'goal_total_birds': return allBirds(p).length;
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
function scoreRoundGoals(st, DATA) {
  const C = DATA.constants;
  const round = st.round;
  const flock = st.cfg.mode !== 'base';
  const table = (flock ? C.goal_flock_scores : C.goal_base_scores)[round - 1];
  const perGoal = st.goalIds.map(gid => {
    const counts = st.players.map(p => ({ pid: p.pid, count: goalCount(st, p.pid, gid, DATA) }));
    // 排名（并列处理：base 严格式 / flock 友好式）
    const sorted = [...counts].sort((a, b) => b.count - a.count);
    const rows = [];
    let rank = 0;
    let i = 0;
    while (i < sorted.length) {
      const grp = [sorted[i]];
      while (i + grp.length < sorted.length && sorted[i + grp.length].count === sorted[i].count) grp.push(sorted[i + grp.length]);
      rank++;
      const count = sorted[i].count;
      let points = 0;
      if (count > 0) {
        if (!flock) {
          // 严格式：被平掉名次+其后顺延名次分数之和 ÷ 平局人数，向下取整
          const span = table.slice(rank - 1, rank - 1 + grp.length);
          const sum = span.reduce((a, b) => a + b, 0);
          points = Math.floor(sum / grp.length);
        } else {
          // 友好式：并列都拿该名次满分，次名保留
          points = table[rank - 1] || 0;
        }
      }
      for (const g of grp) rows.push({ pid: g.pid, count, rank, points });
      i += grp.length;
    }
    // 记入总分
    for (const r of rows) { const pl = P2(st, r.pid); r.goalPoints = r.points; }
    return { goalId: gid, rows };
  });
  return { round, flock, perGoal };
}

// ---------- 奖励卡计分 ----------
const BODY_PARTS = ['beak', 'belly', 'bill', 'breast', 'cap', 'chin', 'collar', 'crest', 'crown', 'eye', 'face', 'head', 'neck', 'rump', 'shoulder', 'tail', 'throat', 'wing'];
const GEO_TERMS = ['american', 'atlantic', 'baltimore', 'california', 'canada', 'carolina', 'chihuahua', 'eastern', 'inca', 'mississippi', 'mountain', 'northern', 'prairie', 'sandhill', 'savannah', 'western'];
const COLOR_TERMS = ['red', 'black', 'blue', 'white', 'yellow', 'gray', 'grey', 'green', 'purple', 'gold', 'golden', 'cerulean', 'indigo', 'chestnut', 'rose', 'roseate', 'violet', 'brown', 'ruddy', 'lazuli', 'ruby'];
const PERSON_RE = /'s/;
// 食物成本是否含某类食物
const costHas = (b, food) => b.food_cost.some(it => it.type === food || (it.any_of || []).some(a => a.type === food));
// 食物成本"仅含"某类（无其他类型）
const costOnly = (b, food) => b.food_cost.length > 0 && b.food_cost.every(it =>
  it.type === food || (it.any_of && it.any_of.length > 0 && it.any_of.every(a => a.type === food)));
const onlyHabitat = (b, h) => b.habitats.length === 1 && b.habitats[0] === h;
const nestBirdCount = (birds, nest) => birds.filter(b => b.nest === nest || b.nest === 'wild').length;
const tier = (n, pairs) => { for (const [minN, pts] of pairs) if (n >= minN) return pts; return 0; };

export function bonusScore(st, pid, DATA) {
  const p = P2(st, pid);
  const insts = allBirds(p);
  const birds = insts.map(x => D(DATA, x.cardId));
  const nm = b => b.name_en.toLowerCase();
  switch (p.bonus) {
    // —— 每只 / 每单位固定分 ——
    case 'bonus_birdcounter': return 2 * birds.filter(b => b.flocking).length;
    case 'bonus_breedingmanager': return insts.filter(x => x.eggs >= 4).length;
    case 'bonus_ecologist': return 2 * Math.min(...HABITATS.map(h => p.habitats[h].length));
    case 'bonus_falconer': return 2 * birds.filter(b => b.predator).length;
    case 'bonus_foodwebexpert': return 2 * birds.filter(b => costOnly(b, 'invertebrate')).length;
    case 'bonus_historian': return 2 * birds.filter(b => PERSON_RE.test(nm(b))).length;
    case 'bonus_omnivorespecialist': return 2 * birds.filter(b => b.food_cost.some(it => it.type === 'wild')).length;
    case 'bonus_rodentologist': return 2 * birds.filter(b => costHas(b, 'rodent')).length;
    // —— 阶梯阈值 ——
    case 'bonus_anatomist':
      return tier(birds.filter(b => BODY_PARTS.some(w => nm(b).includes(w))).length, [[4, 7], [2, 3]]);
    case 'bonus_backyardbirder':
      return tier(birds.filter(b => b.points < 4).length, [[7, 6], [5, 3]]);
    case 'bonus_birdfeeder':
      return tier(birds.filter(b => costHas(b, 'seed')).length, [[8, 7], [5, 3]]);
    case 'bonus_cartographer':
      return tier(birds.filter(b => GEO_TERMS.some(w => nm(b).includes(w))).length, [[4, 7], [2, 3]]);
    case 'bonus_enclosurebuilder':
      return tier(nestBirdCount(birds, 'ground'), [[6, 7], [4, 4]]);
    case 'bonus_fisherymanager':
      return tier(birds.filter(b => costHas(b, 'fish')).length, [[4, 8], [2, 3]]);
    case 'bonus_forester':
      return tier(birds.filter(b => onlyHabitat(b, 'forest')).length, [[5, 5], [3, 4]]);
    case 'bonus_largebirdspecialist':
      return tier(birds.filter(b => b.wingspan > 65).length, [[6, 6], [4, 3]]);
    case 'bonus_nestboxbuilder':
      return tier(nestBirdCount(birds, 'cavity'), [[6, 7], [4, 4]]);
    case 'bonus_oologist':
      return tier(insts.reduce((a, x) => a + x.eggs, 0), [[9, 6], [7, 3]]);
    case 'bonus_passerinespecialist':
      return tier(birds.filter(b => b.wingspan <= 30).length, [[6, 6], [4, 3]]);
    case 'bonus_photographer':
      return tier(birds.filter(b => COLOR_TERMS.some(c => nm(b).includes(c))).length, [[6, 7], [4, 3]]);
    case 'bonus_platformbuilder':
      return tier(nestBirdCount(birds, 'platform'), [[6, 7], [4, 4]]);
    case 'bonus_prairiemanager':
      return tier(birds.filter(b => onlyHabitat(b, 'grassland')).length, [[4, 8], [2, 3]]);
    case 'bonus_viticulturalist':
      return tier(birds.filter(b => costHas(b, 'fruit')).length, [[4, 7], [2, 3]]);
    case 'bonus_visionaryleader':
      return tier(p.hand.length, [[8, 7], [5, 4]]);
    case 'bonus_wetlandscientist':
      return tier(birds.filter(b => onlyHabitat(b, 'wetland')).length, [[5, 7], [3, 3]]);
    case 'bonus_wildlifegardener':
      return tier(nestBirdCount(birds, 'bowl'), [[6, 7], [4, 4]]);
    default: return 0;
  }
}

// ---------- 终局计分 ----------
export function finalScoring(st, DATA) {
  const rows = st.players.map(p => {
    const birds = allBirds(p);
    const birdPts = birds.reduce((a, x) => a + D(DATA, x.cardId).points, 0);
    const bonusPts = bonusScore(st, p.pid, DATA);
    const goalPts = st.goalResults.reduce((a, r) => a + r.perGoal.reduce((b, g) => b + (g.rows.find(x => x.pid === p.pid)?.points || 0), 0), 0);
    const eggPts = birds.reduce((a, x) => a + x.eggs, 0);
    const cachePts = birds.reduce((a, x) => a + x.cached.length, 0);
    const tuckPts = birds.reduce((a, x) => a + x.tucked, 0);
    const total = birdPts + bonusPts + goalPts + eggPts + cachePts + tuckPts;
    return { pid: p.pid, name: p.name, birdPts, bonusPts, bonus: p.bonus, goalPts, eggPts, cachePts, tuckPts, total, foodLeft: foodSum(p.food) };
  });
  rows.sort((a, b) => b.total - a.total || b.foodLeft - a.foodLeft);
  const top = rows[0].total, topFood = rows[0].foodLeft;
  st.winnerPids = rows.filter(r => r.total === top && r.foodLeft === topFood).map(r => r.pid);
  st.finalScores = rows;
  logEvent(st, 'game_over', { winners: st.winnerPids, rows });
}

// ---------- 不变量断言 ----------
export function assertInvariants(st, DATA) {
  const errs = [];
  for (const p of st.players) {
    if (p.cubesSupply < 0 || p.cubesSupply > 8) errs.push(p.pid + ' 方块数异常 ' + p.cubesSupply);
    for (const h of HABITATS) {
      if (p.habitats[h].length > 5) errs.push(p.pid + ' ' + h + ' 超 5 鸟');
      for (const inst of p.habitats[h]) {
        const b = D(DATA, inst.cardId);
        if (inst.eggs > b.egg_limit) errs.push(p.pid + ' 蛋超上限 ' + b.name_en);
        if (inst.eggs < 0 || inst.tucked < 0) errs.push('负数资源');
        if (b.habitats && !b.habitats.includes(h)) errs.push(b.name_en + ' 栖息地非法: ' + h);
      }
    }
    for (const f of FOODS) if (p.food[f] < 0) errs.push(p.pid + ' 负食物');
  }
  for (const g of st.groups) {
    if (st.feeders[g.id].dice.length !== 5) errs.push(g.id + ' 骰子数异常');
    if (st.trays[g.id].length > 3) errs.push(g.id + ' 托盘超 3');
  }
  if (errs.length) throw new Error('不变量违例: ' + errs.join('; '));
}

// ---------- 驱动器 ----------
// 把生成器跑到底或暂停在人类决策点；机器人自动决策。
export class MatchDriver {
  constructor(state, DATA) {
    this.st = state; this.DATA = DATA;
    this.gen = matchLoop(state, DATA);
    this.waiting = null; // {request, resolve}
    this.done = false;
    this.error = null;
  }
  // 推进直到需要人类输入或结束
  pump() {
    for (;;) {
      if (this.done) return;
      let r;
      try { r = this.waiting ? this.gen.next(this.waiting.answer) : this.gen.next(); }
      catch (e) { this.error = e; this.done = true; throw e; }
      this.waiting = null;
      if (r.done) { this.done = true; return; }
      const req = r.value;
      const player = this.st.players.find(p => p.pid === req.pid);
      if (player.bot) {
        this.waiting = { answer: botDecide(this.st, req, this.DATA) };
        continue;
      }
      // 人类：暴露请求并等待
      this.st.pending = { pid: req.pid, kind: req.kind, data: req.data };
      return { needInput: req };
    }
  }
  // 人类回答后继续
  answer(a) {
    if (!this.st.pending) throw new Error('无待回答请求');
    this.waiting = { answer: a };
    this.st.pending = null;
    return this.pump();
  }
}

// 展翅翱翔 · 机器人决策策略（保守贪心：安全动作，不激进）
import { allBirds, eggCapacity, totalEggCapacity, foodSum, totalEggs, canAffordBird, HABITATS, FOODS } from './engine.js';

const D = (DATA, id) => DATA.birds.find(b => b.id === id);

function birdValue(b, DATA) {
  let v = b.points;
  if (b.power) v += b.power.color === 'brown' ? 2 : 1;
  if (b.egg_limit >= 4) v += 1;
  v -= b.food_cost.reduce((a, c) => a + (c.amount || (c.any_of ? 1 : 0)), 0) * 0.5;
  return v;
}
// 一张鸟"最容易支付"的具体食物类型（any_of 取第一项，wild 兜底为 seed）
function birdPrimaryFood(b) {
  for (const it of b.food_cost) {
    if (it.any_of && it.any_of.length) return it.any_of[0].type;
    if (it.type && it.type !== 'wild' && it.type !== 'none') return it.type;
  }
  return 'seed';
}

export function botDecide(st, req, DATA) {
  const p = st.players.find(x => x.pid === req.pid);
  const d = req.data || {};
  const first = arr => (arr && arr[0]);
  switch (req.kind) {
    case 'initial_keep': {
      // 「10 留 5」：在 4鸟1食 / 3鸟2食 / 5鸟0食 中选择"自洽"组合（保留的食物至少能打出 1 张鸟）
      const ranked = [...d.hand].sort((a, b) => birdValue(D(DATA, b), DATA) - birdValue(D(DATA, a), DATA));
      let chosen = null;
      for (const k of [4, 3, 5]) {
        const birdIds = ranked.slice(0, k);
        const need = {};
        birdIds.forEach(id => { const f = birdPrimaryFood(D(DATA, id)); need[f] = (need[f] || 0) + 1; });
        // 初始每种食物各 1，按需求度选不同类型的食物
        const food = FOODS.slice().sort((a, b) => (need[b] || 0) - (need[a] || 0)).slice(0, 5 - k);
        const remainFood = {};
        FOODS.forEach(f => { remainFood[f] = food.includes(f) ? 1 : 0; });
        const fakeP = { ...p, food: remainFood, hand: birdIds };
        const selfConsistent = birdIds.some(id => canAffordBird(fakeP, D(DATA, id), DATA));
        if (selfConsistent || k === 3) { chosen = { birds: birdIds, food }; break; }
      }
      return chosen;
    }
    case 'initial_bonus': return { bonus: first(d.options) };
    case 'pick_action': {
      const legal = d.legal || [];
      const food = foodSum(p.food);
      const birdCount = allBirds(p).length;
      // 精确判断：手牌中当前确实付得起费用、且有未满栖息地可放置的鸟
      const playable = p.hand.filter(id => canAffordBird(p, D(DATA, id), DATA));
      const hasEmptyHab = HABITATS.some(h => p.habitats[h].length === 0);
      // 1) 有可打鸟：前期铺场 / 有空栖息地 / 手牌将满 / 鸟太少时优先打鸟（鸟是分数与能力的核心来源）
      if (legal.includes('play_bird') && playable.length &&
        (st.round <= 2 || hasEmptyHab || p.hand.length >= 4 || birdCount < 3)) {
        return { action: 'play_bird' };
      }
      // 2) 暂无可打鸟且食物不足，先囤食为下一次打鸟做准备
      if (legal.includes('gain_food') && !playable.length && food < 3) return { action: 'gain_food' };
      // 3) 中后期有蛋容量时产蛋（争目标分与终局蛋分）
      if (legal.includes('lay_eggs') && totalEggCapacity(p) > 0 && st.round >= 2) return { action: 'lay_eggs' };
      // 4) 手牌枯竭时抽卡
      if (legal.includes('draw_cards') && p.hand.length < 3) return { action: 'draw_cards' };
      // 5) 兜底：能打鸟就打，其余按行动可得性
      if (legal.includes('play_bird') && playable.length) return { action: 'play_bird' };
      if (legal.includes('gain_food')) return { action: 'gain_food' };
      if (legal.includes('lay_eggs')) return { action: 'lay_eggs' };
      return { action: first(legal) || 'draw_cards' };
    }
    case 'play_pick_bird': {
      const sorted = [...(d.candidates || [])].sort((a, b) => birdValue(D(DATA, b), DATA) - birdValue(D(DATA, a), DATA));
      return { bird: sorted[0] };
    }
    case 'play_pick_habitat': return { habitat: first(d.habitats) };
    case 'play_pay_eggs': {
      // 分散扣蛋：从蛋最多的鸟开始，每只最多扣其当前蛋数，避免超出
      const avail = allBirds(p).filter(x => x.eggs > 0).sort((a, b) => b.eggs - a.eggs);
      const birds = [];
      let left = d.amount;
      for (const x of avail) {
        const take = Math.min(x.eggs, left);
        for (let k = 0; k < take; k++) birds.push(x.iid);
        left -= take;
        if (left <= 0) break;
      }
      return { birds };
    }
    case 'play_pay_food': return { plan: first(d.plans) || { direct: {}, twofor: 0 } };
    case 'exchange_card_food': return { use: p.hand.length > 4 };
    case 'exchange_pick_card': {
      const worst = [...p.hand].sort((a, b) => birdValue(D(DATA, a), DATA) - birdValue(D(DATA, b), DATA));
      return { card: worst[0] };
    }
    case 'optional_reroll': {
      const faces = d.faces || [];
      return { reroll: faces.length === 1 && faces[0] === 'seed_or_invertebrate' ? false : faces.length === 1 };
    }
    case 'pick_die': {
      // 取自己最缺的类型
      const faces = d.faces || [];
      const pref = faces.find(f => f !== 'seed_or_invertebrate') || faces[0];
      return { face: pref };
    }
    case 'pick_die_face': return { food: 'seed' };
    case 'pick_wild_food': {
      const f = FOODS.reduce((a, b) => (p.food[a] <= p.food[b] ? a : b));
      return { food: f };
    }
    case 'exchange_food_egg': return { use: foodSum(p.food) >= 2 };
    case 'exchange_pick_food': {
      const f = FOODS.reduce((a, b) => (p.food[a] >= p.food[b] ? a : b));
      return { food: f };
    }
    case 'lay_eggs_alloc': {
      // 贪心：填蛋上限大的鸟（保终局 1 分/蛋，同时靠近 4 蛋奖励）
      const amount = Math.min(d.amount || 0, d.capacity || d.amount || 0);
      const cands = allBirds(p).filter(x => eggCapacity(x) > 0).sort((a, b) => eggCapacity(b) - eggCapacity(a));
      const alloc = []; let left = amount;
      for (const c of cands) { const n = Math.min(left, eggCapacity(c)); if (n > 0) { alloc.push({ iid: c.iid, n }); left -= n; } if (!left) break; }
      return { alloc };
    }
    case 'exchange_egg_card': return { use: totalEggs(p) >= 3 };
    case 'exchange_pick_egg': {
      const b = allBirds(p).filter(x => x.eggs > 0).sort((a, b) => b.eggs - a.eggs)[0];
      return { iid: b ? b.iid : '' };
    }
    case 'draw_pick_source': {
      const tray = d.tray || [];
      const idx = tray.findIndex(c => c);
      return { source: idx >= 0 ? 'tray' + idx : 'deck' };
    }
    case 'activate_brown': return { activate: true };
    case 'cache_or_gain': {
      // 个人食物充足（≥4）时储存到鸟上争终局分，否则保留为个人食物以维持打鸟灵活性
      return { cache: foodSum(p.food) >= 4 };
    }
    case 'lay_egg_target': {
      const targets = (d.targets || []);
      return { iid: targets[0] };
    }
    case 'discard_egg_pick': {
      const birds = allBirds(p).filter(x => x.eggs > 0).sort((a, b) => b.eggs - a.eggs);
      return { iid: birds[0] ? birds[0].iid : '' };
    }
    case 'tuck_pick': {
      const worst = [...(d.hand || [])].sort((a, b) => birdValue(D(DATA, a), DATA) - birdValue(D(DATA, b), DATA));
      return { cards: worst.slice(0, d.n || 1) };
    }
    case 'optional_if_do': return { use: true };
    case 'optional_tuck_deck_cost': return { use: true };
    case 'move_bird_dest': {
      const dests = d.dests || [];
      const least = HABITATS.filter(h => dests.includes(h)).sort((a, b) => p.habitats[a].length - p.habitats[b].length);
      return { habitat: least[0] };
    }
    case 'pick_start_player': return { pid: req.pid };
    case 'pick_distributed_card': return { card: first(d.cards) };
    case 'pink_offer': return { use: true };
    case 'eot_discard': {
      const worst = [...(d.hand || [])].sort((a, b) => birdValue(D(DATA, a), DATA) - birdValue(D(DATA, b), DATA));
      return { cards: worst.slice(0, d.count || 1) };
    }
    case 'bonus_keep': return { keep: first(d.drawn) };
    // —— 新能力引入的决策类型 ——
    case 'feeder_food_choice': return { food: first(d.choices) };
    case 'supply_food_choice': return { food: first(d.choices) };
    case 'repeat_pick_target': return { iid: first(d.targets) };
    case 'trade_pick_give': return { food: first(d.foods) };
    case 'trade_pick_get': return { food: first(d.foods) };
    case 'all_lay_egg_target': return { iid: first(d.targets) };
    case 'all_lay_extra': return { iid: first(d.targets) }; // 额外蛋有终局价值，选择使用
    default:
      return {};
  }
}

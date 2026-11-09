// 展翅翱翔 · 机器人决策策略（保守贪心：安全动作，不激进）
import { allBirds, eggCapacity, totalEggCapacity, foodSum, totalEggs, HABITATS, FOODS } from './engine.js';

const D = (DATA, id) => DATA.birds.find(b => b.id === id);

function birdValue(b, DATA) {
  let v = b.points;
  if (b.power) v += b.power.color === 'brown' ? 2 : 1;
  if (b.egg_limit >= 4) v += 1;
  v -= b.food_cost.reduce((a, c) => a + (c.amount || (c.any_of ? 1 : 0)), 0) * 0.5;
  return v;
}

export function botDecide(st, req, DATA) {
  const p = st.players.find(x => x.pid === req.pid);
  const d = req.data || {};
  const first = arr => (arr && arr[0]);
  switch (req.kind) {
    case 'initial_keep': {
      // 保留价值最高的 4 鸟 + 1 食物
      const sorted = [...d.hand].sort((a, b) => birdValue(D(DATA, b), DATA) - birdValue(D(DATA, a), DATA));
      return { birds: sorted.slice(0, 4), food: ['seed', 'invertebrate'] };
    }
    case 'initial_bonus': return { bonus: first(d.options) };
    case 'pick_action': {
      const legal = d.legal || [];
      const food = foodSum(p.food);
      const birds = allBirds(p).length;
      // 贪心策略：能打鸟就打（引擎引擎构筑），食物不够先囤食；中期开始产蛋争目标；手牌枯竭抽卡
      if (legal.includes('play_bird') && (birds === 0 || p.hand.length > 0)) {
        if (birds === 0) return { action: 'play_bird' };
      }
      if (legal.includes('lay_eggs') && totalEggCapacity(p) > 0 && (st.round >= 2 || food >= 2)) {
        // 蛋容量吃紧（>60% 满）时优先补蛋
        return { action: 'lay_eggs' };
      }
      if (legal.includes('gain_food') && food < 3) return { action: 'gain_food' };
      if (legal.includes('play_bird')) return { action: 'play_bird' };
      if (legal.includes('draw_cards') && p.hand.length < 3) return { action: 'draw_cards' };
      if (legal.includes('lay_eggs')) return { action: 'lay_eggs' };
      if (legal.includes('gain_food')) return { action: 'gain_food' };
      return { action: first(legal) || 'draw_cards' };
    }
    case 'play_pick_bird': {
      const sorted = [...(d.candidates || [])].sort((a, b) => birdValue(D(DATA, b), DATA) - birdValue(D(DATA, a), DATA));
      return { bird: sorted[0] };
    }
    case 'play_pick_habitat': return { habitat: first(d.habitats) };
    case 'play_pay_eggs': {
      // 从蛋最多的鸟上移除
      const birds = allBirds(p).filter(x => x.eggs > 0).sort((a, b) => b.eggs - a.eggs);
      const out = [];
      for (let i = 0; i < d.amount; i++) if (birds[Math.floor(i / 1)]) out.push(birds[0].iid);
      return { birds: Array(d.amount).fill(birds[0] ? birds[0].iid : '') };
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
    case 'cache_or_gain': return { cache: true };
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
    default:
      return {};
  }
}

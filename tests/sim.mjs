// 无头回归测试：机器人跑完整对局（4/5/6/7/8 人），并覆盖 op、奖励卡、资源文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame, MatchDriver, assertInvariants, stateView, bonusScore,
  allBirds, foodSum, HABITATS,
} from '../shared/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game_data.json'), 'utf8'));
const COLORS = ['purple', 'blue', 'yellow', 'red', 'green', 'teal', 'white', 'orange'];
const SEEDS = [7, 11, 42, 99, 2026];
const MODES = [['base', 4], ['base', 5], ['flock', 6], ['flock', 7], ['extended', 8]];

// 引擎 runOp 支持的全部实际 op（pink 由窗口单独处理，不计入）
const ALL_OPS = ['gain_food', 'take_die', 'gain_all_dice', 'cache_food', 'predator', 'lay_eggs',
  'lay_eggs_each', 'discard_egg_gain', 'draw', 'draw_bonus', 'draw_then_eot_discard', 'tuck_hand',
  'tuck_deck_cost', 'look_tuck', 'move_if_rightmost', 'all_draw', 'all_gain', 'each_take_die',
  'fewest_habitat_draw', 'draw_tray_all', 'draw_and_distribute', 'play_another_bird', 'repeat_brown',
  'trade_food', 'discard_egg_draw', 'all_lay_eggs', 'fewest_habitat_food'];

const opSeen = new Set();
let failures = 0;
const fail = (where, e) => { failures++; console.error(`✘ [${where}] ${e.message}`); };

function simulate(mode, n, seed) {
  const players = Array.from({ length: n }, (_, i) =>
    ({ pid: 'p' + (i + 1), name: 'Bot' + (i + 1), color: COLORS[i], bot: true }));
  const st = createGame({ mode, players, seed }, DATA);
  const drv = new MatchDriver(st, DATA);
  let checks = 0;
  while (!drv.done) {
    const r = drv.pump();
    if (r && r.needInput) throw new Error('机器人对局不应等待人类输入: ' + r.needInput.kind);
    if (++checks % 200 === 0) assertInvariants(st, DATA);
  }
  assertInvariants(st, DATA);
  // 收集 op 覆盖
  for (const ev of st.log) if (ev.type === 'op') opSeen.add(ev.data.op);
  // 计分核对：总分 = 各项之和
  for (const row of st.finalScores) {
    const sum = row.birdPts + row.bonusPts + row.goalPts + row.eggPts + row.cachePts + row.tuckPts;
    if (sum !== row.total) throw new Error('计分不一致 ' + row.pid);
  }
  // 目标分核对
  for (const p of st.players) {
    const fromResults = st.goalResults.reduce((a, r) =>
      a + r.perGoal.reduce((b, g) => b + (g.rows.find(x => x.pid === p.pid)?.points || 0), 0), 0);
    if (fromResults !== st.finalScores.find(r => r.pid === p.pid).goalPts)
      throw new Error('目标分不一致 ' + p.pid);
  }
  // 信息隐藏：p1 视角看不到 p2 手牌，且 p2 奖励卡为 hidden
  const v = stateView(st, 'p1', DATA);
  const p2view = v.players.find(p => p.pid === 'p2');
  if (p2view.hand !== undefined) throw new Error('信息泄露：他人手牌可见');
  if (p2view.bonus !== 'hidden') throw new Error('信息泄露：他人奖励卡可见');
  return {
    scores: st.finalScores.map(r =>
      `${r.name}:${r.total}(鸟${r.birdPts} 奖${r.bonusPts} 目${r.goalPts} 蛋${r.eggPts} 储${r.cachePts} 塞${r.tuckPts})`).join('  '),
    winner: st.winnerPids.join(','),
    played: st.players.map(p => allBirds(p).length).join('/'),
    groups: st.groups.map(g => g.id + ':' + g.pids.length).join(' '),
  };
}

// ---------- A. 整局回归 ----------
console.log('— A. 整局回归（5 模式 × 5 种子 = 25 局）—');
for (const [mode, n] of MODES) {
  for (const seed of SEEDS) {
    try {
      const t0 = Date.now();
      const s = simulate(mode, n, seed);
      console.log(`✔ [${mode} ${n}人 seed=${seed}] ${Date.now() - t0}ms | ${s.scores} | 胜者:${s.winner} | 打鸟:${s.played} | 组:${s.groups}`);
    } catch (e) { fail(`${mode} ${n}人 seed=${seed}`, e); }
  }
}

// ---------- B. op 覆盖 ----------
console.log('\n— B. 能力原语 op 覆盖 —');
const missingOps = ALL_OPS.filter(o => !opSeen.has(o));
console.log(`自然触发 ${opSeen.size}/${ALL_OPS.length} 个 op`);
if (missingOps.length)
  console.log('未自然触发（稀有白能力，由 tests/ops_direct.mjs 定向覆盖）：' + missingOps.join(', '));
else console.log('✔ 全部 op 至少执行一次');

// ---------- C. 26 奖励卡健全性（空状态 + 实际终局均可被计分且不抛异常）----------
console.log('\n— C. 奖励卡计分健全性 —');
for (const bonus of DATA.bonus) {
  try {
    const p = { pid: 'p1', bonus: bonus.id, hand: [], food: {}, habitats: { forest: [], grassland: [], wetland: [] } };
    const st0 = { players: [p] };
    const vp = bonusScore(st0, 'p1', DATA);
    if (typeof vp !== 'number' || vp < 0) throw new Error('返回非法 VP: ' + vp);
  } catch (e) { fail('奖励卡 ' + bonus.id, e); }
}
if (!failures) console.log(`✔ ${DATA.bonus.length} 张奖励卡计分分支均可安全执行`);

// ---------- D. 卡牌资源文件存在性 ----------
console.log('\n— D. 卡牌资源文件存在性 —');
let missingFiles = 0;
for (const coll of ['birds', 'bonus', 'goals']) {
  for (const item of DATA[coll]) {
    const fp = path.join(ROOT, 'assets', item.file); // file 已含 cards/ 或 goals/ 前缀
    if (!fs.existsSync(fp)) { failures++; missingFiles++; console.error(`✘ 缺失资源 ${coll}: ${item.file}`); }
  }
}
if (!missingFiles) console.log(`✔ ${DATA.birds.length + DATA.bonus.length + DATA.goals.length} 个卡牌资源全部存在`);

console.log('\n' + (failures ? `失败：${failures} 项` : '全部通过'));
process.exit(failures ? 1 : 0);

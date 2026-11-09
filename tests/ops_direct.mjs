// 定向测试：构造 Brant（黑雁 b040）白能力场景，验证稀有 op draw_tray_all
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, MatchDriver } from '../shared/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game_data.json'), 'utf8'));
const COLORS = ['purple', 'blue', 'yellow', 'red'];
const BRANT = 'b040';
let failures = 0;

try {
  // p1 为人类（便于在决策点注入），其余为 bot
  const players = COLORS.map((c, i) =>
    ({ pid: 'p' + (i + 1), name: (i === 0 ? 'Human' : 'Bot') + (i + 1), color: c, bot: i !== 0 }));
  const st = createGame({ mode: 'base', players, seed: 11 }, DATA);
  const drv = new MatchDriver(st, DATA);
  let injected = false;

  // 推进；遇到人类决策点时按 kind 回答，pick_action 处注入 Brant 场景
  const answerFor = req => {
    const d = req.data || {};
    switch (req.kind) {
      case 'initial_keep':
        return { birds: d.hand.slice(0, 3), food: ['invertebrate', 'seed'] };
      case 'initial_bonus':
        return { bonus: d.options[0] };
      case 'pick_action': {
        if (!injected) {
          injected = true;
          const p1 = st.players[0];
          // 注入：手牌仅 Brant，食物可付其 1 seed + 1 wild（wild 用 invertebrate）
          p1.hand = [BRANT];
          p1.food = { invertebrate: 1, seed: 1, fish: 0, fruit: 0, rodent: 0 };
          // 托盘填满 3 张面朝上的其他鸟卡
          const filler = DATA.birds.map(b => b.id).filter(id => id !== BRANT).slice(0, 3);
          st.trays[p1.group] = [...filler];
        }
        return { action: 'play_bird' };
      }
      case 'play_pick_bird':
        return { bird: d.candidates[0] };
      case 'play_pick_habitat':
        return { habitat: d.habitats[0] };
      default:
        // 兜底：取首个候选，避免定向场景被未预期决策卡住
        if (Array.isArray(d.candidates) && d.candidates.length) return { bird: d.candidates[0] };
        if (Array.isArray(d.options) && d.options.length) return { bonus: d.options[0] };
        if (Array.isArray(d.habitats) && d.habitats.length) return { habitat: d.habitats[0] };
        return {};
    }
  };

  let r = drv.pump();
  let guard = 0;
  while (r && r.needInput && guard++ < 10000) r = drv.answer(answerFor(r.needInput));

  // 断言 1：日志中出现 draw_tray_all
  const fired = st.log.some(ev => ev.type === 'op' && ev.data.op === 'draw_tray_all');
  if (!fired) throw new Error('draw_tray_all 未被触发');
  // 断言 2：白能力当回合从托盘拿取 3 张（card_drawn 事件）
  const drawn = st.log.find(ev => ev.type === 'card_drawn' && ev.data.from === 'tray_all');
  if (!drawn || drawn.data.n !== 3) throw new Error('应从托盘拿取 3 张，实际: ' + JSON.stringify(drawn));
  // 断言 3：回合末托盘被重新补满（官方规则：托盘始终保持 3 个面朝上卡位）
  const refilled = st.log.some(ev => ev.type === 'tray_refilled');
  if (!refilled) throw new Error('回合末应补满托盘');
  // 断言 4：Brant 已在 wetland 打出，且最终托盘保持 3 个槽位
  const p1 = st.players[0];
  if (!p1.habitats.wetland.some(inst => inst.cardId === BRANT)) throw new Error('Brant 未在 wetland 打出');
  if (st.trays[p1.group].length !== 3 || st.trays[p1.group].some(x => !x))
    throw new Error('回合末托盘应补满为 3 张: ' + JSON.stringify(st.trays[p1.group]));

  console.log('✔ draw_tray_all 定向测试通过：Brant 打出后拿取托盘 3 张，回合末托盘补满');
} catch (e) {
  failures++;
  console.error('✘ draw_tray_all 定向测试失败: ' + e.message);
}
process.exit(failures ? 1 : 0);

// 展翅翱翔 · 数据构建脚本（全量版）
// 纳入 core 全集 180 张鸟卡（170 基础 + 10 Swift Start）与 26 张官方奖励卡。
// 有官方扫描图的沿用 jpg；无扫描图的生成数据驱动 SVG 卡面（tools/card_svg.mjs）。
// 原则：所有官方数值（分数/成本/蛋上限/翼展/能力文本）零改动，直接取自数据集。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { birdSvg, bonusSvg } from './card_svg.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const master = read('data/master_source.json');
const bonusSrcAll = read('data/bonus_source.json');
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- 1. 官方扫描图匹配（建立 英文名 → jpg 相对路径） ----------
const alias = {
  'bellsvired': "Bell's Vireo",
  'broadwingedhawk': 'Broad-Winged Hawk',
  'blackchinnedhummingbird': 'Black-Chinned Hummingbird',
};
const core = master.filter(b => b['Set'] === 'core');
const byName = new Map(core.map(b => [norm(b['Common name']), b]));
const NON_BIRD = new Set([
  'Anhinga-Copy.jpg', 'Anatomist.jpg', 'BackyardBirder.jpg', 'BirdCounter.jpg', 'BirdFeeder.jpg',
  'BreedingManager.jpg', 'Cartographer.jpg', 'Ecologist.jpg', 'BerryDice.jpg',
  'BirdsInForestGoal.jpg', 'BirdsInGrasslandGoal.jpg', 'BirdsInWetlandsGoal.jpg',
  'BowlCardsWithEggGoal.jpg', 'CavityCardsWithEggsGoal.jpg',
]);
const scanByName = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'assets/cards')).filter(f => /\.jpg$/i.test(f) && !NON_BIRD.has(f))) {
  const key = norm(f.replace(/\.jpg$/i, ''));
  const bird = byName.get(key) || byName.get(norm(alias[key] || '\u0000'));
  if (!bird) throw new Error('扫描图无法匹配到数据集鸟类: ' + f);
  scanByName.set(bird['Common name'], 'cards/' + f);
}
const SVG_DIR = 'cards/svg';
fs.mkdirSync(path.join(ROOT, 'assets', SVG_DIR), { recursive: true });

// ---------- 2. 中文译名（UI 标签；卡面英文为主） ----------
const ZH = {
  'Acorn Woodpecker': '橡树啄木鸟', 'American Avocet': '美洲反嘴鹬', 'American Bittern': '美洲麻鳽',
  'American Coot': '美洲白骨顶', 'American Crow': '美洲鸦', 'American Goldfinch': '北美金翅雀',
  'American Kestrel': '美洲隼', 'American Oystercatcher': '美洲蛎鹬', 'American Redstart': '橙尾鸲莺',
  'American Robin': '旅鸫', 'American White Pelican': '美洲白鹈鹕', 'American Woodcock': '美洲丘鹬',
  'Anhinga': '蛇鹈', "Anna's Hummingbird": '安娜蜂鸟', 'Ash-Throated Flycatcher': '灰喉霸鹟',
  'Atlantic Puffin': '北极海鹦', "Baird's Sparrow": '贝尔德沙鹀', 'Bald Eagle': '白头海雕',
  'Baltimore Oriole': '巴尔的摩拟黄鹂', 'Barn Owl': '仓鸮', 'Barn Swallow': '家燕',
  'Barred Owl': '横斑林鸮', "Barrow's Goldeneye": '巴氏鹊鸭', 'Belted Kingfisher': '带鱼狗',
  "Bell's Vireo": '贝尔氏莺雀', "Bewick's Wren": '比氏苇鹪鹩', 'Black Skimmer': '黑剪嘴鸥',
  'Black Tern': '黑浮鸥', 'Black Vulture': '黑美洲鹫', 'Black-Bellied Whistling-Duck': '黑腹树鸭',
  'Black-Billed Magpie': '黑嘴喜鹊', 'Black-Chinned Hummingbird': '黑颏北蜂鸟',
  'Black-Crowned Night-Heron': '黑冠夜鹭', 'Black-Necked Stilt': '黑颈长脚鹬',
  'Blue Grosbeak': '蓝彩鹀', 'Blue Jay': '冠蓝鸦', 'Blue-Gray Gnatcatcher': '灰蓝蚋莺',
  'Blue-Winged Warbler': '蓝翅林莺', 'Bobolink': '食米鸟', 'Brant': '黑雁',
  "Brewer's Blackbird": '布氏黑鹂', 'Broad-Winged Hawk': '阔翅鵟', 'Bronzed Cowbird': '铜色牛鹂',
  'Brown Pelican': '褐鹈鹕', 'Brown-Headed Cowbird': '褐头牛鹂', 'Burrowing Owl': '穴鸮',
  'Bushtit': '美洲丛山雀', 'California Condor': '加州神鹫', 'California Quail': '珠颈斑鹑',
  'Canada Goose': '加拿大雁', 'Canvasback': '帆背潜鸭', 'Carolina Chickadee': '卡罗山雀',
  'Carolina Wren': '卡罗苇鹪鹩', "Cassin's Finch": '卡氏朱雀', "Cassin's Sparrow": '卡氏沙鹀',
  'Cedar Waxwing': '雪松太平鸟', 'Cerulean Warbler': '青蓝林莺',
  'Chestnut-Collared Longspur': '栗领铁爪鹀', 'Chihuahuan Raven': '奇瓦瓦乌鸦',
  'Chimney Swift': '烟囱雨燕', 'Chipping Sparrow': '棕顶雀鹀', "Clark's Grebe": '克氏鸊鷉',
  "Clark's Nutcracker": '克氏星鸦', 'Common Grackle': '普通拟八哥', 'Common Loon': '普通潜鸟',
  "Forster's Tern": '福氏燕鸥', 'Ruddy Duck': '棕硬尾鸭',
  // —— 新增 113 张 ——
  'Common Merganser': '普通秋沙鸭', 'Common Nighthawk': '美洲夜鹰', 'Common Raven': '普通渡鸦',
  'Common Yellowthroat': '黄喉地莺', "Cooper's Hawk": '库氏鹰', 'Dark-Eyed Junco': '暗眼灯草鹀',
  'Dickcissel': '长刺歌雀', 'Double-Crested Cormorant': '双冠鸬鹚', 'Downy Woodpecker': '绒啄木鸟',
  'Eastern Bluebird': '东蓝鸲', 'Eastern Kingbird': '东王霸鹟', 'Eastern Phoebe': '东菲比霸鹟',
  'Eastern Screech-Owl': '东鸣角鸮', 'Ferruginous Hawk': '棕尾鵟', 'Fish Crow': '鱼鸦',
  "Franklin's Gull": '富兰克林鸥', 'Golden Eagle': '金雕', 'Grasshopper Sparrow': '蝗草鹀',
  'Gray Catbird': '灰猫嘲鸫', 'Great Blue Heron': '大蓝鹭', 'Great Crested Flycatcher': '大冠蝇霸鹟',
  'Great Egret': '大白鹭', 'Great Horned Owl': '大雕鸮', 'Greater Prairie-Chicken': '草原榛鸡',
  'Greater Roadrunner': '走鹃', 'Green Heron': '绿鹭', 'Hermit Thrush': '隐士夜鸫',
  'Hooded Merganser': '棕胁秋沙鸭', 'Hooded Warbler': '巾冠林莺', 'Horned Lark': '角百灵',
  'House Finch': '家朱雀', 'House Wren': '家鹪鹩', 'Inca Dove': '印加鸠',
  'Indigo Bunting': '靛蓝彩鹀', 'Juniper Titmouse': '杜福山雀', 'Killdeer': '双领鸻',
  'King Rail': '王秧鸡', 'Lazuli Bunting': '琉璃彩鹀', "Lincoln's Sparrow": '林肯带鹀',
  'Loggerhead Shrike': '呆头伯劳', 'Mallard': '绿头鸭', 'Mississippi Kite': '密西西比鸢',
  'Mountain Bluebird': '山蓝鸲', 'Mountain Chickadee': '高山山雀', 'Mourning Dove': '哀鸽',
  'Northern Bobwhite': '山齿鹑', 'Northern Cardinal': '北美红雀', 'Northern Flicker': '北扑翅䴕',
  'Northern Harrier': '白尾鹞', 'Northern Mockingbird': '北方嘲鸫', 'Northern Shoveler': '琵嘴鸭',
  'Osprey': '鹗', 'Painted Bunting': '彩鹀', 'Painted Whitestart': '彩尾鸲',
  'Peregrine Falcon': '游隼', "Pied-Billed Grebe": '斑嘴巨䴙䴘', 'Pileated Woodpecker': '北美黑啄木鸟',
  'Pine Siskin': '松金翅雀', 'Prothonotary Warbler': '蓝翅黄森莺', 'Purple Gallinule': '紫青水鸡',
  'Purple Martin': '紫崖燕', 'Pygmy Nuthatch': '侏儒䴓', 'Red Crossbill': '红交嘴雀',
  "Red-Bellied Woodpecker": '红腹啄木鸟', 'Red-Breasted Merganser': '红胸秋沙鸭',
  'Red-Breasted Nuthatch': '红胸䴓', 'Red-Cockaded Woodpecker': '红冠啄木鸟',
  "Red-Eyed Vireo": '红眼绿鹃', 'Red-Headed Woodpecker': '红头啄木鸟',
  "Red-Shouldered Hawk": '红肩鵟', 'Red-Tailed Hawk': '红尾鵟',
  'Red-Winged Blackbird': '红翅黑鹂', 'Ring-Billed Gull': '环嘴鸥',
  'Rose-Breasted Grosbeak': '玫胸白斑翅雀', 'Roseate Spoonbill': '玫瑰琵鹭',
  'Ruby-Crowned Kinglet': '红玉冠戴菊', 'Ruby-Throated Hummingbird': '红喉北蜂鸟',
  'Sandhill Crane': '沙丘鹤', 'Savannah Sparrow': '稀树草鹀', "Say's Phoebe": '塞伊菲比霸鹟',
  'Scaled Quail': '鳞斑翎鹑', 'Scissor-Tailed Flycatcher': '剪尾王霸鹟',
  'Snowy Egret': '雪鹭', 'Song Sparrow': '歌带鹀', 'Spotted Owl': '斑林鸮',
  'Spotted Sandpiper': '斑矶鹬', 'Spotted Towhee': '斑唧鹀', "Sprague's Pipit": '斯氏鹨',
  "Steller's Jay": '暗冠蓝鸦', "Swainson's Hawk": '斯氏鵟', 'Tree Swallow': '树燕',
  'Trumpeter Swan': '黑嘴天鹅', 'Tufted Titmouse': '簇山雀', 'Turkey Vulture': '红头美洲鹫',
  "Vaux's Swift": '沃氏雨燕', 'Violet-Green Swallow': '紫绿树燕',
  'Western Meadowlark': '西美草地鹨', 'Western Tanager': '西部唐纳雀',
  'White-Breasted Nuthatch': '白胸䴓', 'White-Crowned Sparrow': '白冠带鹀',
  'White-Faced Ibis': '白脸鹮', 'White-Throated Swift': '白喉雨燕',
  'Whooping Crane': '美洲鹤', 'Wild Turkey': '野火鸡', 'Willet': '斑翅鹬',
  "Wilson's Snipe": '威氏沙锥', 'Wood Duck': '林鸳鸯', 'Wood Stork': '林鹳',
  "Yellow-Bellied Sapsucker": '黄腹吸汁啄木鸟', "Yellow-Billed Cuckoo": '黄嘴杜鹃',
  'Yellow-Breasted Chat': '黄胸巨莺', 'Yellow-Headed Blackbird': '黄头黑鹂',
  'Yellow-Rumped Warbler': '黄腰林莺',
};

// ---------- 3. 能力 → 效果原语（完整原语库） ----------
const P = {
  // —— 白色 ——
  draw2bonus: { ops: [{ op: 'draw_bonus', draw: 2, keep: 1 }] },
  draw2: { ops: [{ op: 'draw', n: 2, from: 'any' }] },
  eggEachGround: { ops: [{ op: 'lay_eggs_each', nest: 'ground' }] },
  eggEachCavity: { ops: [{ op: 'lay_eggs_each', nest: 'cavity' }] },
  eggEachBowl: { ops: [{ op: 'lay_eggs_each', nest: 'bowl' }] },
  eggEachPlatform: { ops: [{ op: 'lay_eggs_each', nest: 'platform' }] },
  gain3fish: { ops: [{ op: 'gain_food', from: 'supply', food: 'fish', n: 3 }] },
  gain3seed: { ops: [{ op: 'gain_food', from: 'supply', food: 'seed', n: 3 }] },
  allFishFeeder: { ops: [{ op: 'gain_all_dice', face: 'fish' }] },
  allInvFeeder: { ops: [{ op: 'gain_all_dice', face: 'invertebrate' }] },
  drawTray3: { ops: [{ op: 'draw_tray_all' }] },
  oystercatcher: { ops: [{ op: 'draw_and_distribute' }] },
  playAnotherForest: { ops: [{ op: 'play_another_bird', habitat: 'forest' }] },
  playAnotherGrass: { ops: [{ op: 'play_another_bird', habitat: 'grassland' }] },
  playAnotherWet: { ops: [{ op: 'play_another_bird', habitat: 'wetland' }] },
  playAnotherThis: { ops: [{ op: 'play_another_bird', this_habitat: true }] },
  // —— 棕色 ——
  gain1inv: { ops: [{ op: 'gain_food', from: 'supply', food: 'invertebrate', n: 1 }] },
  gainFruit1: { ops: [{ op: 'gain_food', from: 'supply', food: 'fruit', n: 1 }] },
  gainSeed1: { ops: [{ op: 'gain_food', from: 'supply', food: 'seed', n: 1 }] },
  feederInv: { ops: [{ op: 'gain_food', from: 'feeder', food: 'invertebrate', n: 1 }] },
  feederSeedCache: { ops: [{ op: 'gain_food', from: 'feeder', food: 'seed', n: 1, optional_cache: true }] },
  feederInvOrFruit: { ops: [{ op: 'gain_food', from: 'feeder', food: 'invertebrate', n: 1, choices: ['invertebrate', 'fruit'] }] },
  feederSeedOrFruit: { ops: [{ op: 'gain_food', from: 'feeder', food: 'seed', n: 1, choices: ['seed', 'fruit'] }] },
  takeDie: { ops: [{ op: 'take_die' }] },
  cacheSeed: { ops: [{ op: 'cache_food', food: 'seed', n: 1 }] },
  predatorRodent: { ops: [{ op: 'predator', face: 'rodent' }] },
  predatorFish: { ops: [{ op: 'predator', face: 'fish' }] },
  eggThis: { ops: [{ op: 'lay_eggs', n: 1, on: 'this' }] },
  eggAny: { ops: [{ op: 'lay_eggs', n: 1, on: 'any' }] },
  tuckEggThis: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'lay_eggs', n: 1, on: 'this', optional: true }] }] },
  tuckGainFruit: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'gain_food', from: 'supply', food: 'fruit', n: 1 }] }] },
  tuckGainSeed: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'gain_food', from: 'supply', food: 'seed', n: 1 }] }] },
  tuckGainInv: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'gain_food', from: 'supply', food: 'invertebrate', n: 1 }] }] },
  tuckGainInvOrSeed: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'gain_food', from: 'supply', food: 'invertebrate', n: 1, choices: ['invertebrate', 'seed'] }] }] },
  tuckLayAny: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'lay_eggs', n: 1, on: 'any' }] }] },
  tuckDraw: { ops: [{ op: 'tuck_hand', n: 1, if_do: [{ op: 'draw', n: 1, from: 'any' }] }] },
  tuckDeckSeed: { ops: [{ op: 'tuck_deck_cost', cost: { food: 'seed', n: 1 }, tuck: 2 }] },
  tuckDeckFish: { ops: [{ op: 'tuck_deck_cost', cost: { food: 'fish', n: 1 }, tuck: 2 }] },
  eggForWild2: { ops: [{ op: 'discard_egg_gain', gain_food: 'wild', n: 2 }] },
  eggForWild1: { ops: [{ op: 'discard_egg_gain', gain_food: 'wild', n: 1 }] },
  drawEot1: { ops: [{ op: 'draw_then_eot_discard', draw: 1, discard: 1 }] },
  drawEot2: { ops: [{ op: 'draw_then_eot_discard', draw: 2, discard: 1 }] },
  draw1Deck: { ops: [{ op: 'draw', n: 1 }] },
  allDrawDeck: { ops: [{ op: 'all_draw', n: 1 }] },
  allGainFruit: { ops: [{ op: 'all_gain', food: 'fruit', n: 1 }] },
  allGainInv: { ops: [{ op: 'all_gain', food: 'invertebrate', n: 1 }] },
  allGainFish: { ops: [{ op: 'all_gain', food: 'fish', n: 1 }] },
  allGainSeed: { ops: [{ op: 'all_gain', food: 'seed', n: 1 }] },
  eachTakeDie: { ops: [{ op: 'each_take_die' }] },
  fewestWetlandDraw: { ops: [{ op: 'fewest_habitat_draw', habitat: 'wetland', n: 1 }] },
  fewestForestFood: { ops: [{ op: 'fewest_habitat_food', habitat: 'forest' }] },
  moveIfRight: { ops: [{ op: 'move_if_rightmost' }] },
  lookTuck50: { ops: [{ op: 'look_tuck', max_ws: 50 }] },
  lookTuck75: { ops: [{ op: 'look_tuck', max_ws: 75 }] },
  lookTuck100: { ops: [{ op: 'look_tuck', max_ws: 100 }] },
  repeatBrown: { ops: [{ op: 'repeat_brown' }] },
  repeatPredator: { ops: [{ op: 'repeat_brown', predator_only: true }] },
  tradeFood: { ops: [{ op: 'trade_food' }] },
  discardEggDraw: { ops: [{ op: 'discard_egg_draw', draw: 2 }] },
  allLayGround: { ops: [{ op: 'all_lay_eggs', nest: 'ground' }] },
  allLayBowl: { ops: [{ op: 'all_lay_eggs', nest: 'bowl' }] },
  allLayCavity: { ops: [{ op: 'all_lay_eggs', nest: 'cavity' }] },
  // —— 粉色 ——
  pinkEggBowl: { ops: [{ op: 'pink', trigger: 'lay_eggs_action', effect: [{ op: 'lay_eggs', n: 1, on: { nest: 'bowl' } }] }] },
  pinkEggCavity: { ops: [{ op: 'pink', trigger: 'lay_eggs_action', effect: [{ op: 'lay_eggs', n: 1, on: { other_nest: 'cavity' } }] }] },
  pinkEggGround: { ops: [{ op: 'pink', trigger: 'lay_eggs_action', effect: [{ op: 'lay_eggs', n: 1, on: { other_nest: 'ground' } }] }] },
  pinkLayBowl: { ops: [{ op: 'pink', trigger: 'lay_eggs_action', effect: [{ op: 'lay_eggs', n: 1, on: { nest: 'bowl' } }] }] },
  pinkPredDie: { ops: [{ op: 'pink', trigger: 'predator_success', effect: [{ op: 'take_die' }] }] },
  pinkWetlandFish: { ops: [{ op: 'pink', trigger: 'bird_played', habitat: 'wetland', effect: [{ op: 'gain_food', from: 'supply', food: 'fish', n: 1 }] }] },
  pinkForestInv: { ops: [{ op: 'pink', trigger: 'bird_played', habitat: 'forest', effect: [{ op: 'gain_food', from: 'supply', food: 'invertebrate', n: 1 }] }] },
  pinkGrassTuck: { ops: [{ op: 'pink', trigger: 'bird_played', habitat: 'grassland', effect: [{ op: 'tuck_hand', n: 1 }] }] },
  pinkGainFoodRodent: { ops: [{ op: 'pink', trigger: 'gain_food_action', food: 'rodent', effect: [{ op: 'cache_food', food: 'rodent', n: 1 }] }] },
};

// ---------- 4. 逐鸟映射（键 = 官方英文名） ----------
const BIRD_POWER = {
  'Acorn Woodpecker': P.feederSeedCache, 'Blue Jay': P.feederSeedCache, "Clark's Nutcracker": P.feederSeedCache,
  "Red-Bellied Woodpecker": P.feederSeedCache, "Red-Headed Woodpecker": P.feederSeedCache, "Steller's Jay": P.feederSeedCache,
  'American Redstart': P.takeDie, 'Carolina Chickadee': P.cacheSeed,
  'Juniper Titmouse': P.cacheSeed, 'Mountain Chickadee': P.cacheSeed,
  "Red-Breasted Nuthatch": P.cacheSeed, 'White-Breasted Nuthatch': P.cacheSeed,
  'Burrowing Owl': P.predatorRodent, 'Broad-Winged Hawk': P.predatorRodent, 'American Kestrel': P.predatorRodent,
  'Barn Owl': P.predatorRodent, 'Eastern Screech-Owl': P.predatorRodent,
  'Ferruginous Hawk': P.predatorRodent, 'Mississippi Kite': P.predatorRodent,
  'Anhinga': P.predatorFish, 'Black Skimmer': P.predatorFish,
  'Common Merganser': P.predatorFish, 'Snowy Egret': P.predatorFish,
  'White-Faced Ibis': P.predatorFish, 'Willet': P.predatorFish,
  'California Quail': P.eggThis, 'Mourning Dove': P.eggThis,
  'Northern Bobwhite': P.eggThis, 'Scaled Quail': P.eggThis,
  'Chipping Sparrow': P.eggAny, "Cassin's Sparrow": P.eggAny, "Baird's Sparrow": P.eggAny,
  'Grasshopper Sparrow': P.eggAny,
  'Common Grackle': P.tuckEggThis, 'Bushtit': P.tuckEggThis, "Brewer's Blackbird": P.tuckEggThis,
  'Dickcissel': P.tuckEggThis, 'Red-Winged Blackbird': P.tuckEggThis,
  'Yellow-Headed Blackbird': P.tuckEggThis,
  'Cedar Waxwing': P.tuckGainFruit,
  'Dark-Eyed Junco': P.tuckGainSeed, 'Pine Siskin': P.tuckGainSeed,
  "Vaux's Swift": P.tuckGainInv,
  'Pygmy Nuthatch': P.tuckGainInvOrSeed,
  'White-Throated Swift': P.tuckLayAny,
  'Barn Swallow': P.tuckDraw, 'American Robin': P.tuckDraw, 'American Coot': P.tuckDraw,
  'House Finch': P.tuckDraw, 'Purple Martin': P.tuckDraw, 'Tree Swallow': P.tuckDraw,
  'Violet-Green Swallow': P.tuckDraw, 'Ring-Billed Gull': P.tuckDraw,
  'Yellow-Rumped Warbler': P.tuckDraw,
  'Canada Goose': P.tuckDeckSeed, 'Black-Bellied Whistling-Duck': P.tuckDeckSeed,
  'Sandhill Crane': P.tuckDeckSeed,
  'American White Pelican': P.tuckDeckFish,
  'Double-Crested Cormorant': P.tuckDeckFish,
  'Chihuahuan Raven': P.eggForWild2, 'Common Raven': P.eggForWild2,
  'Black-Crowned Night-Heron': P.eggForWild1, 'American Crow': P.eggForWild1, 'Fish Crow': P.eggForWild1,
  'Black Tern': P.drawEot1, "Clark's Grebe": P.drawEot1, "Forster's Tern": P.drawEot1,
  'Common Yellowthroat': P.drawEot1, "Pied-Billed Grebe": P.drawEot1,
  'Red-Breasted Merganser': P.drawEot1, 'Wood Duck': P.drawEot1,
  'Ruddy Duck': P.drawEot2,
  'Mallard': P.draw1Deck,
  'Canvasback': P.allDrawDeck, 'Northern Shoveler': P.allDrawDeck, 'Purple Gallinule': P.allDrawDeck,
  'Spotted Sandpiper': P.allDrawDeck, "Wilson's Snipe": P.allDrawDeck,
  'Black-Chinned Hummingbird': P.allGainFruit, 'Baltimore Oriole': P.allGainFruit,
  'Eastern Phoebe': P.allGainInv, 'Scissor-Tailed Flycatcher': P.allGainInv,
  'Osprey': P.allGainFish,
  'Red Crossbill': P.allGainSeed,
  "Anna's Hummingbird": P.eachTakeDie, 'Ruby-Throated Hummingbird': P.eachTakeDie,
  'American Bittern': P.fewestWetlandDraw, 'Common Loon': P.fewestWetlandDraw,
  'Hermit Thrush': P.fewestForestFood,
  'Chimney Swift': P.moveIfRight, 'Blue Grosbeak': P.moveIfRight, "Bewick's Wren": P.moveIfRight,
  'Common Nighthawk': P.moveIfRight, "Lincoln's Sparrow": P.moveIfRight,
  'Song Sparrow': P.moveIfRight, 'White-Crowned Sparrow': P.moveIfRight,
  'Yellow-Breasted Chat': P.moveIfRight,
  'Barred Owl': P.lookTuck75, "Cooper's Hawk": P.lookTuck75, 'Northern Harrier': P.lookTuck75,
  "Red-Shouldered Hawk": P.lookTuck75, "Swainson's Hawk": P.lookTuck75, "Red-Tailed Hawk": P.lookTuck75,
  'Greater Roadrunner': P.lookTuck50,
  'Golden Eagle': P.lookTuck100, 'Great Horned Owl': P.lookTuck100, 'Peregrine Falcon': P.lookTuck100,
  'Gray Catbird': P.repeatBrown, 'Northern Mockingbird': P.repeatBrown,
  'Hooded Merganser': P.repeatPredator,
  'Green Heron': P.tradeFood,
  "Franklin's Gull": P.discardEggDraw, 'Killdeer': P.discardEggDraw,
  'Western Meadowlark': P.allLayGround,
  'Lazuli Bunting': P.allLayBowl,
  'Pileated Woodpecker': P.allLayCavity,
  'Great Crested Flycatcher': P.feederInv,
  'Indigo Bunting': P.feederInvOrFruit, 'Western Tanager': P.feederInvOrFruit,
  'Rose-Breasted Grosbeak': P.feederSeedOrFruit,
  'Northern Cardinal': P.gainFruit1,
  'Spotted Towhee': P.gainSeed1,
  'Painted Whitestart': P.gain1inv, "Yellow-Bellied Sapsucker": P.gain1inv,
  'Inca Dove': P.eggEachPlatform,
  "Say's Phoebe": P.eggEachBowl,
  'Northern Flicker': P.allInvFeeder,
  'Downy Woodpecker': P.playAnotherForest, 'Red-Eyed Vireo': P.playAnotherForest,
  'Ruby-Crowned Kinglet': P.playAnotherForest, 'Tufted Titmouse': P.playAnotherForest,
  'Red-Cockaded Woodpecker': P.playAnotherForest,
  'Eastern Bluebird': P.playAnotherGrass, 'Mountain Bluebird': P.playAnotherGrass,
  'Savannah Sparrow': P.playAnotherGrass,
  'Great Blue Heron': P.playAnotherWet, 'Great Egret': P.playAnotherWet,
  'House Wren': P.playAnotherThis,
  'Brown-Headed Cowbird': P.pinkEggBowl, 'Bronzed Cowbird': P.pinkEggBowl,
  "Barrow's Goldeneye": P.pinkEggCavity, 'American Avocet': P.pinkEggGround,
  'Yellow-Billed Cuckoo': P.pinkLayBowl,
  'Black Vulture': P.pinkPredDie, 'Black-Billed Magpie': P.pinkPredDie,
  'Turkey Vulture': P.pinkPredDie,
  'Belted Kingfisher': P.pinkWetlandFish,
  'Eastern Kingbird': P.pinkForestInv,
  'Horned Lark': P.pinkGrassTuck,
  'Loggerhead Shrike': P.pinkGainFoodRodent,
  // —— 补漏：旧卡迁移 + 白色 draw2bonus ——
  'American Goldfinch': P.gain3seed,
  'American Oystercatcher': P.oystercatcher,
  'Ash-Throated Flycatcher': P.eggEachCavity,
  'Atlantic Puffin': P.draw2bonus,
  'Bald Eagle': P.allFishFeeder,
  "Bell's Vireo": P.draw2bonus,
  'Black-Necked Stilt': P.draw2,
  'Blue-Gray Gnatcatcher': P.gain1inv,
  'Bobolink': P.eggEachGround,
  'Brant': P.drawTray3,
  'Brown Pelican': P.gain3fish,
  'California Condor': P.draw2bonus,
  'Carolina Wren': P.draw2,
  "Cassin's Finch": P.draw2bonus,
  'Cerulean Warbler': P.draw2bonus,
  'Chestnut-Collared Longspur': P.draw2bonus,
  'Greater Prairie-Chicken': P.draw2bonus,
  'King Rail': P.draw2bonus,
  'Painted Bunting': P.draw2bonus,
  'Roseate Spoonbill': P.draw2bonus,
  'Spotted Owl': P.draw2bonus,
  "Sprague's Pipit": P.draw2bonus,
  'Whooping Crane': P.draw2bonus,
  'Wood Stork': P.draw2bonus,
};

// ---------- 5. 食物成本结构化 ----------
function foodCost(b) {
  const items = [];
  for (const [col, t] of [['Invertebrate', 'invertebrate'], ['Seed', 'seed'], ['Fish', 'fish'], ['Fruit', 'fruit'], ['Rodent', 'rodent']]) {
    const v = b[col];
    if (v) items.push({ type: t, amount: Math.round(v) });
  }
  const wild = b['Wild (food)'] ? Math.round(b['Wild (food)']) : 0;
  const none = b['* (food cost)'] || (!items.length && !wild);
  const slash = b['/ (food cost)'] === '/';
  if (none && !items.length && !wild) return [{ type: 'none' }];
  if (slash) return [{ any_of: items.length ? items : [] }];
  if (wild) items.push({ type: 'wild', amount: wild });
  return items;
}

// ---------- 6. 效果原语 → 中文能力文本 ----------
const FOOD_ZH = { invertebrate: '无脊椎', seed: '种子', fish: '鱼', fruit: '水果', rodent: '啮齿', wild: '任意食物' };
const NEST_ZH = { bowl: '碗', cavity: '洞', ground: '地', platform: '平台' };
const HAB_ZH = { forest: '森林', grassland: '草原', wetland: '湿地' };
function foodList(choices) { return choices.map(c => FOOD_ZH[c]).join(' 或 '); }
function opsZh(ops) {
  const parts = [];
  for (const op of ops) {
    switch (op.op) {
      case 'gain_food': {
        if (op.from === 'feeder') {
          const what = op.choices ? foodList(op.choices) : FOOD_ZH[op.food];
          parts.push(`从喂食器获得 1 ${what}（若有）${op.optional_cache ? '，可改为储存到这只鸟上' : ''}`);
        } else {
          const what = op.choices ? foodList(op.choices) : `${FOOD_ZH[op.food]}×${op.n}`;
          parts.push(`从供应区获得 ${what}`);
        }
        break;
      }
      case 'take_die': parts.push('从喂食器取 1 颗骰子（自选面）'); break;
      case 'gain_all_dice': parts.push(`获得喂食器中所有${FOOD_ZH[op.face]}`); break;
      case 'cache_food': parts.push(`在这只鸟上储存 ${FOOD_ZH[op.food]}×${op.n || 1}`); break;
      case 'predator': parts.push(`重掷喂食器外的所有骰子，若有${FOOD_ZH[op.face]}，在这只鸟上储存 1 个${FOOD_ZH[op.face]}`); break;
      case 'lay_eggs': {
        if (op.on === 'this') parts.push(`在这只鸟上产 ${op.n} 蛋`);
        else if (op.on === 'any') parts.push(`在任意一只鸟上产 ${op.n} 蛋`);
        else if (op.on && op.on.nest) parts.push(`在一只${NEST_ZH[op.on.nest]}巢（或星巢）的鸟上产 ${op.n} 蛋`);
        else if (op.on && op.on.other_nest) parts.push(`在另一只${NEST_ZH[op.on.other_nest]}巢（或星巢）的鸟上产 ${op.n} 蛋`);
        break;
      }
      case 'lay_eggs_each': parts.push(`在每只${NEST_ZH[op.nest]}巢（或星巢）的鸟上各产 1 蛋`); break;
      case 'discard_egg_gain': parts.push(`从你的另一只鸟上弃 1 蛋，获得${FOOD_ZH[op.gain_food]}×${op.n}`); break;
      case 'draw': parts.push(`抽 ${op.n} 张鸟卡${op.from === 'any' ? '（托盘或牌库自选）' : ''}`); break;
      case 'draw_bonus': parts.push(`抽 ${op.draw} 张新的奖励卡，保留其中 ${op.keep} 张`); break;
      case 'draw_then_eot_discard': parts.push(`抽 ${op.draw} 张鸟卡，回合结束时应弃 ${op.discard} 张手牌`); break;
      case 'tuck_hand': {
        let s = `从手牌塞 ${op.n} 张卡到这只鸟下`;
        if (op.if_do && op.if_do.length) s += '，若如此做：' + opsZh(op.if_do);
        parts.push(s);
        break;
      }
      case 'tuck_deck_cost': parts.push(`弃 ${FOOD_ZH[op.cost.food]}×${op.cost.n}，从牌库顶塞 ${op.tuck} 张卡到这只鸟下`); break;
      case 'look_tuck': parts.push(`查看牌库顶 1 张卡：翼展小于 ${op.max_ws}cm 则塞到这只鸟下，否则弃置`); break;
      case 'move_if_rightmost': parts.push('若这只鸟是其栖息地最右侧的鸟，将它迁徙到另一个栖息地'); break;
      case 'all_draw': parts.push('所有玩家各从牌库抽 1 张卡'); break;
      case 'all_gain': parts.push(`所有玩家各从供应区获得 ${FOOD_ZH[op.food]}×${op.n}`); break;
      case 'each_take_die': parts.push('每位玩家（含你）依次从喂食器取 1 颗骰子，由你选择起始玩家'); break;
      case 'fewest_habitat_draw': parts.push(`${HAB_ZH[op.habitat]}中鸟最少的每位玩家（可并列）各抽 1 张卡`); break;
      case 'fewest_habitat_food': parts.push(`${HAB_ZH[op.habitat]}中鸟最少的每位玩家（可并列）各从喂食器取 1 颗骰子`); break;
      case 'draw_tray_all': parts.push('拿取鸟托盘全部 3 张面朝上的鸟卡'); break;
      case 'draw_and_distribute': parts.push('抽「玩家数+1」张鸟卡，从你开始顺时针每位玩家选 1 张加入手牌，你保留剩余的卡'); break;
      case 'play_another_bird': {
        const where = op.this_habitat ? '本鸟所在栖息地' : HAB_ZH[op.habitat];
        parts.push(`在你的${where}再打出一只鸟，支付其正常费用（不耗行动）`);
        break;
      }
      case 'repeat_brown': parts.push(`重复同一栖息地另一只鸟的棕色能力${op.predator_only ? '（限捕食者能力）' : ''}`); break;
      case 'trade_food': parts.push('弃 1 个食物，从供应区换 1 个其他类型的食物'); break;
      case 'discard_egg_draw': parts.push('弃 1 蛋，从牌库抽 2 张鸟卡'); break;
      case 'all_lay_eggs': parts.push(`所有玩家各在 1 只${NEST_ZH[op.nest]}巢（或星巢）的鸟上产 1 蛋，你可额外在另一只上产 1 蛋`); break;
      case 'pink': {
        const trig = {
          lay_eggs_action: '其他玩家执行「产蛋」行动',
          predator_success: '其他玩家的捕食者捕猎成功',
          gain_food_action: `其他玩家「获取食物」行动中获得${FOOD_ZH[op.food]}`,
          bird_played: `其他玩家在${HAB_ZH[op.habitat]}打出鸟`,
        }[op.trigger] || '触发条件满足';
        parts.push(`当${trig}时，你可以：` + opsZh(op.effect));
        break;
      }
      default: parts.push('');
    }
  }
  return parts.filter(Boolean).join('；');
}

// ---------- 7. 生成全部鸟卡 ----------
const birds = core.map((b, i) => {
  const name = b['Common name'];
  const color = b['Color'] || 'none';
  const powerDef = BIRD_POWER[name];
  if (color !== 'none' && !powerDef) throw new Error('缺少能力映射: ' + name);
  let file = scanByName.get(name);
  if (!file) { // 无扫描图：生成 SVG
    file = `${SVG_DIR}/${norm(name)}.svg`;
    const partial = {
      name_en: name, name_zh: ZH[name] || name,
      habitats: ['forest', 'grassland', 'wetland'].filter(h => b[h[0].toUpperCase() + h.slice(1)]),
      food_cost: foodCost(b), points: Math.round(b['Victory points'] || 0),
      nest: (b['Nest type'] === 'none' || !b['Nest type']) ? 'none' : b['Nest type'],
      egg_limit: Math.round(b['Egg limit'] || 0), wingspan: Math.round(b['Wingspan'] || 0),
    };
    const fullForSvg = { ...partial, power: powerDef ? { color, text_zh: opsZh(powerDef.ops) } : null };
    fs.writeFileSync(path.join(ROOT, 'assets', file), birdSvg(fullForSvg));
  }
  return {
    id: 'b' + String(i + 1).padStart(3, '0'), file,
    name_en: name, name_zh: ZH[name] || name, latin: b['Scientific name'] || '',
    swift_start: !!b['Swift Start'],
    habitats: ['forest', 'grassland', 'wetland'].filter(h => b[h[0].toUpperCase() + h.slice(1)]),
    food_cost: foodCost(b),
    points: Math.round(b['Victory points'] || 0),
    nest: (b['Nest type'] === 'none' || !b['Nest type']) ? 'none' : b['Nest type'],
    egg_limit: Math.round(b['Egg limit'] || 0),
    wingspan: Math.round(b['Wingspan'] || 0),
    beak: ({ L: 'left', R: 'right', LR: 'both', N: 'front' })[b['Beak direction'] || 'N'] || 'front',
    predator: !!b['Predator'], flocking: !!b['Flocking'],
    power: color === 'none' ? null
      : { color, text: b['Power text'] || '', text_zh: opsZh(powerDef.ops), ops: powerDef.ops },
  };
}).sort((a, b) => a.name_en.localeCompare(b.name_en));

// ---------- 8. 奖励卡（26 张：7 jpg + 19 svg） ----------
const BONUS_ZH = {
  'Anatomist': ['解剖学家', '名字含身体部位的鸟：2–3 只 3 分，4+ 只 7 分'],
  'Backyard Birder': ['后院观鸟者', '分数低于 4 的鸟：5–6 只 3 分，7+ 只 6 分'],
  'Bird Counter': ['数鸟人', '每只带群栖标记的鸟 2 分'],
  'Bird Feeder': ['喂鸟者', '食物成本含种子的鸟：5–7 只 3 分，8+ 只 7 分'],
  'Breeding Manager': ['繁育主管', '每只上面有至少 4 颗蛋的鸟 1 分'],
  'Cartographer': ['制图师', '名字含地理词的鸟：2–3 只 3 分，4+ 只 7 分'],
  'Ecologist': ['生态学家', '鸟最少的栖息地中每只鸟 2 分'],
  'Enclosure Builder': ['地巢建造师', '地巢（或星巢）鸟：4–5 只 4 分，6+ 只 7 分'],
  'Falconer': ['驯鹰人', '每只带捕食者标记的鸟 2 分'],
  'Fishery Manager': ['渔场主管', '食物成本含鱼的鸟：2–3 只 3 分，4+ 只 8 分'],
  'Food Web Expert': ['食物网专家', '食物成本仅含无脊椎的鸟，每只 2 分'],
  'Forester': ['林务官', '仅能在森林打出的鸟：3–4 只 4 分，5 只 5 分'],
  'Historian': ['历史学家', '以人名命名的鸟，每只 2 分'],
  'Large Bird Specialist': ['大型鸟专家', '翼展大于 65cm 的鸟：4–5 只 3 分，6+ 只 6 分'],
  'Nest Box Builder': ['巢箱建造师', '洞巢（或星巢）鸟：4–5 只 4 分，6+ 只 7 分'],
  'Omnivore Specialist': ['杂食专家', '食物成本含任意食物的鸟，每只 2 分'],
  'Oologist': ['鸟卵学家', '你巢中的蛋：7–8 颗 3 分，9+ 颗 6 分'],
  'Passerine Specialist': ['雀形目专家', '翼展不超过 30cm 的鸟：4–5 只 3 分，6+ 只 6 分'],
  'Photographer': ['摄影师', '名字含颜色词的鸟：4–5 只 3 分，6+ 只 7 分'],
  'Platform Builder': ['平台巢建造师', '平台巢（或星巢）鸟：4–5 只 4 分，6+ 只 7 分'],
  'Prairie Manager': ['草原主管', '仅能在草原打出的鸟：2–3 只 3 分，4+ 只 8 分'],
  'Rodentologist': ['啮齿学家', '食物成本含啮齿的鸟，每只 2 分'],
  'Visionary Leader': ['远见领袖', '你手中的鸟卡：5–7 张 4 分，8+ 张 7 分'],
  'Viticulturalist': ['葡萄栽培家', '食物成本含水果的鸟：2–3 只 3 分，4+ 只 7 分'],
  'Wetland Scientist': ['湿地科学家', '仅能在湿地打出的鸟：3–4 只 3 分，5 只 7 分'],
  'Wildlife Gardener': ['野生动物园丁', '碗巢（或星巢）鸟：4–5 只 4 分，6+ 只 7 分'],
};
const bonusScan = {
  'Anatomist.jpg': 'Anatomist', 'BackyardBirder.jpg': 'Backyard Birder', 'BirdCounter.jpg': 'Bird Counter',
  'BirdFeeder.jpg': 'Bird Feeder', 'BreedingManager.jpg': 'Breeding Manager',
  'Cartographer.jpg': 'Cartographer', 'Ecologist.jpg': 'Ecologist',
};
const bonusScanByName = new Map(Object.entries(bonusScan).map(([f, n]) => [n, 'cards/' + f]));
const bonus = bonusSrcAll.filter(x => x['Set'] === 'core' && !x['Bonus card'].startsWith('[')).map((src) => {
  const name = src['Bonus card'];
  const [zh, detail] = BONUS_ZH[name];
  let file = bonusScanByName.get(name);
  const vp_text = String(src['VP'] || '').replace(/<[^>]+>/g, '').replace(/\[point\]/g, '分').trim();
  const record = { id: 'bonus_' + norm(name), name_en: name, name_zh: zh, detail_zh: detail, vp_text };
  if (!file) {
    file = `${SVG_DIR}/bonus_${norm(name)}.svg`;
    fs.writeFileSync(path.join(ROOT, 'assets', file), bonusSvg(record));
  }
  return { ...record, file };
}).sort((a, b) => a.name_en.localeCompare(b.name_en));

// ---------- 9. 目标砖（16 张官方扫描） ----------
const goalDefs = [
  { n: 1, id: 'goal_egg_sets', zh: '三栖息地蛋套数', tip: '每套 = 森林1蛋+草原1蛋+湿地1蛋，取最小值' },
  { n: 2, id: 'goal_egg_forest', zh: '森林中的蛋总数', tip: '森林行所有鸟上的蛋' },
  { n: 3, id: 'goal_egg_wetland', zh: '湿地中的蛋总数', tip: '湿地行所有鸟上的蛋' },
  { n: 4, id: 'goal_egg_grassland', zh: '草原中的蛋总数', tip: '草原行所有鸟上的蛋' },
  { n: 5, id: 'goal_egg_ground', zh: '地巢中的蛋总数', tip: '所有地巢鸟上的蛋（星巢可匹配）' },
  { n: 6, id: 'goal_egg_bowl', zh: '碗巢中的蛋总数', tip: '所有碗巢鸟上的蛋（星巢可匹配）' },
  { n: 7, id: 'goal_egg_platform', zh: '平台巢中的蛋', tip: '所有平台巢鸟上的蛋（星巢可匹配）' },
  { n: 8, id: 'goal_egg_cavity', zh: '洞巢中的蛋总数', tip: '所有洞巢鸟上的蛋（星巢可匹配）' },
  { n: 9, id: 'goal_total_birds', zh: '已打出的总鸟数', tip: '三个栖息地全部鸟' },
  { n: 10, id: 'goal_bird_forest', zh: '森林中的鸟数', tip: '森林行的鸟' },
  { n: 11, id: 'goal_bird_wetland', zh: '湿地中的鸟数', tip: '湿地行的鸟' },
  { n: 12, id: 'goal_bird_grassland', zh: '草原中的鸟数', tip: '草原行的鸟' },
  { n: 13, id: 'goal_bird_egg_ground', zh: '有蛋的地巢鸟数', tip: '至少 1 蛋的地巢鸟（星巢可匹配）' },
  { n: 14, id: 'goal_bird_egg_bowl', zh: '有蛋的碗巢鸟数', tip: '至少 1 蛋的碗巢鸟（星巢可匹配）' },
  { n: 15, id: 'goal_bird_egg_platform', zh: '有蛋的平台巢鸟数', tip: '至少 1 蛋的平台巢鸟（星巢可匹配）' },
  { n: 16, id: 'goal_bird_egg_cavity', zh: '有蛋的洞巢鸟数', tip: '至少 1 蛋的洞巢鸟（星巢可匹配）' },
];
const goals = goalDefs.map(g => ({ id: g.id, file: 'goals/goal_' + g.n + '.jpg', name_zh: g.zh, tip_zh: g.tip }));

// ---------- 10. 玩家垫与全局常量 ----------
const MAT = {
  play_egg_cost: [0, 1, 1, 2, 2],
  forest: [{ dice: 1 }, { dice: 1, exchange: 'card_food' }, { dice: 2, exchange: 'card_food' }, { dice: 2, exchange: 'card_food' }, { dice: 2, exchange: 'card_food' }],
  grassland: [{ eggs: 2 }, { eggs: 2, exchange: 'food_egg' }, { eggs: 2, exchange: 'food_egg' }, { eggs: 3, exchange: 'food_egg' }, { eggs: 4, exchange: 'food_egg' }],
  wetland: [{ cards: 1 }, { cards: 1, exchange: 'egg_card' }, { cards: 2, exchange: 'egg_card' }, { cards: 2, exchange: 'egg_card' }, { cards: 3, exchange: 'egg_card' }],
};
const CONST = {
  rounds: 4,
  actions_per_round: [8, 7, 6, 5],
  dice_count: 5,
  tray_size: 3,
  hand_start: 5, food_start: 5, bonus_choice: 2,
  goal_base_scores: [[4, 2, 1, 0, 0], [5, 3, 1, 0, 0], [6, 3, 2, 0, 0], [7, 4, 3, 0, 0]],
  goal_flock_scores: [[5, 2, 1, 0, 0, 0], [6, 3, 2, 1, 0, 0], [7, 4, 3, 2, 1, 0], [8, 5, 4, 3, 2, 0]],
  egg_points: 1, cached_food_points: 1, tucked_card_points: 1,
};

const out = {
  meta: {
    source: 'TawnyFrogmouth 社区数据集（官方数值）+ 官方扫描图 + 程序化 SVG 卡面',
    bird_count: birds.length, generated_at: new Date().toISOString(),
    swift_start_count: birds.filter(b => b.swift_start).length,
  },
  birds, bonus, goals, mat: MAT, constants: CONST,
};
fs.writeFileSync(path.join(ROOT, 'data/game_data.json'), JSON.stringify(out, null, 1));
console.log(`OK: ${birds.length} 鸟卡, ${bonus.length} 奖励卡, ${goals.length} 目标砖`);
const colorStat = {};
birds.forEach(b => { const c = b.power ? b.power.color : 'none'; colorStat[c] = (colorStat[c] || 0) + 1; });
console.log('能力分布:', JSON.stringify(colorStat));
const habStat = { forest: 0, grassland: 0, wetland: 0 };
birds.forEach(b => b.habitats.forEach(h => habStat[h]++));
console.log('栖息地分布:', JSON.stringify(habStat));

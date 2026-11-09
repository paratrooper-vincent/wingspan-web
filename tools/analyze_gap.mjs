// 缺口分析：对比已实现67张与core全集180张，输出缺失卡清单与能力聚类
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/master_source.json'), 'utf8'));
const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game_data.json'), 'utf8'));

const have = new Set(game.birds.map(b => b.name_en));
const core = master.filter(b => b.Set === 'core');
const missing = core.filter(b => !have.has(b['Common name']));

console.log('core全集:', core.length, ' 已实现:', have.size, ' 缺失:', missing.length);

// 颜色分布
const colorStat = {};
missing.forEach(b => { const c = b.Color || 'none'; colorStat[c] = (colorStat[c] || 0) + 1; });
console.log('\n缺失卡颜色分布:', JSON.stringify(colorStat));

// Swift Start 缺失情况
const missSS = missing.filter(b => b['Swift Start']);
console.log('缺失的Swift Start卡:', missSS.map(b => b['Common name']).join(', ') || '(无)');

// 按能力文本聚类（归一化后统计）
const clusters = {};
for (const b of missing) {
  const key = (b['Power text'] || '无能力')
    .replace(/\[[^\]]+\]/g, '[X]')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
  (clusters[key] ||= []).push(b['Common name']);
}
console.log('\n=== 缺失卡能力文本聚类（', Object.keys(clusters).length, '种归一化模板）===');
Object.entries(clusters).sort((a, b) => b[1].length - a[1].length).forEach(([t, names], i) => {
  console.log(`\n[${i + 1}] (${names.length}张) ${t}`);
  console.log('   ', names.join(' | '));
});

fs.writeFileSync(path.join(ROOT, 'tools/missing_birds.json'),
  JSON.stringify(missing.map(b => ({
    name: b['Common name'], color: b.Color || 'none', ss: !!b['Swift Start'],
    power: b['Power text'] || '', vp: b['Victory points'], habitats:
      ['Forest', 'Grassland', 'Wetland'].filter(h => b[h]).map(h => h[0].toLowerCase() + h.slice(1)),
  })), null, 1));
console.log('\n缺失清单已写入 tools/missing_birds.json');

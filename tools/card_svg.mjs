// 展翅翱翔 · 程序化卡面生成（无官方扫描图的卡牌用）
// 数据驱动，输出与官方卡同比例（57:87）的 SVG；不伪造官方插画，仅呈现官方数值与能力文本。
import path from 'node:path';

export const CARD_W = 570;
export const CARD_H = 870;

const HAB_COLOR = { forest: '#3e7d4e', grassland: '#c29a2a', wetland: '#4a7fa5' };
const POWER_COLOR = { white: '#8a8375', brown: '#a2703d', pink: '#d97b9c', teal: '#55a8a0', yellow: '#d9b23c' };
const PAPER = '#f4eddb';
const INK = '#3a2c1a';
const GOLD = '#c99b3f';

// ---------- 内联小图标（返回 <g> 片段，以 cx,cy 为中心，s 为尺寸） ----------
function foodIcon(type, cx, cy, s, color = INK) {
  const h = s / 2;
  const d = {
    invertebrate: `<path d="M${cx - h},${cy + h * .5} q${h * .5},${-h} ${h},0 q${h * .5},${h} ${h},0" fill="none" stroke="${color}" stroke-width="${s * .16}" stroke-linecap="round"/>`,
    seed: `<ellipse cx="${cx}" cy="${cy}" rx="${h * .72}" ry="${h}" fill="${color}"/><path d="M${cx},${cy - h} l${h * .35},${-h * .55}" stroke="${color}" stroke-width="${s * .14}" fill="none"/>`,
    fish: `<path d="M${cx - h * .9},${cy} q${h * .5},${-h * .8} ${h * 1.3},0 q-${h * .8},${h * .8} -${h * 1.3},0 Z" fill="${color}"/><path d="M${cx + h * .45},${cy} l${h * .6},${-h * .55} v${h * 1.1} Z" fill="${color}"/><circle cx="${cx - h * .45}" cy="${cy - h * .15}" r="${s * .07}" fill="#fff"/>`,
    fruit: `<circle cx="${cx}" cy="${cy + h * .12}" r="${h * .85}" fill="${color}"/><path d="M${cx},${cy - h * .7} q${h * .4},${-h * .4} ${h * .7},0" fill="none" stroke="${color}" stroke-width="${s * .14}"/>`,
    rodent: `<circle cx="${cx}" cy="${cy + h * .2}" r="${h * .75}" fill="${color}"/><circle cx="${cx - h * .45}" cy="${cy - h * .55}" r="${h * .32}" fill="${color}"/><circle cx="${cx + h * .45}" cy="${cy - h * .55}" r="${h * .32}" fill="${color}"/>`,
    wild: starPath(cx, cy, h * .95, h * .45, color),
  }[type] || '';
  return `<g>${d}</g>`;
}
function nestIcon(type, cx, cy, s, color = INK) {
  const h = s / 2;
  const body = {
    bowl: `<path d="M${cx - h},${cy - h * .3} q${h},${h * 1.4} ${h * 2},0" fill="none" stroke="${color}" stroke-width="${s * .16}"/>`,
    cavity: `<circle cx="${cx}" cy="${cy}" r="${h * .85}" fill="${color}"/><circle cx="${cx}" cy="${cy}" r="${h * .45}" fill="${PAPER}"/>`,
    ground: `<ellipse cx="${cx}" cy="${cy - h * .1}" rx="${h * .8}" ry="${h * .5}" fill="${color}"/><line x1="${cx - h}" y1="${cy + h * .62}" x2="${cx + h}" y2="${cy + h * .62}" stroke="${color}" stroke-width="${s * .15}" stroke-linecap="round"/>`,
    platform: `<path d="M${cx - h},${cy} h${h * 2}" stroke="${color}" stroke-width="${s * .18}"/><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + h * .8}" stroke="${color}" stroke-width="${s * .14}"/>`,
    wild: starPath(cx, cy, h * .9, h * .42, color),
  }[type] || '';
  return `<g>${body}</g>`;
}
function starPath(cx, cy, rOut, rIn, color) {
  let pts = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? rIn : rOut, a = -Math.PI / 2 + i * Math.PI / 5;
    pts += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }
  return `<path d="${pts}Z" fill="${color}"/>`;
}
// 栖鸟剪影（侧视图，在 size 见方的区域居中）
function birdSilhouette(cx, cy, size, color) {
  const k = size / 200;
  const g = (x, y) => `${(cx + (x - 100) * k).toFixed(1)},${(cy + (y - 100) * k).toFixed(1)}`;
  return `<g>
    <path d="M${g(40, 100)} L${g(8, 72)} L${g(18, 122)} L${g(48, 128)} Z" fill="${color}"/>
    <ellipse cx="${cx}" cy="${cy + 10 * k}" rx="${60 * k}" ry="${42 * k}" fill="${color}"/>
    <circle cx="${cx + 45 * k}" cy="${cy - 30 * k}" r="${26 * k}" fill="${color}"/>
    <path d="M${g(168, 66)} L${g(196, 72)} L${g(168, 80)} Z" fill="${color}"/>
    <line x1="${cx - 15 * k}" y1="${cy + 50 * k}" x2="${cx - 20 * k}" y2="${cy + 85 * k}" stroke="${color}" stroke-width="${5 * k}"/>
    <line x1="${cx + 5 * k}" y1="${cy + 50 * k}" x2="${cx + 10 * k}" y2="${cy + 85 * k}" stroke="${color}" stroke-width="${5 * k}"/>
  </g>`;
}

// ---------- 文本折行（按字符估算宽度，中文友好） ----------
function isFullWidth(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x4E00 && c <= 0x9FFF) return true;   // CJK 统一表意文字（常用汉字）
  if (c >= 0x3400 && c <= 0x4DBF) return true;   // CJK 扩展 A
  if (c >= 0x3000 && c <= 0x303F) return true;   // CJK 标点
  if (c >= 0xFF00 && c <= 0xFFEF) return true;   // 全角形式
  if (c >= 0x2E80 && c <= 0x2EFF) return true;   // CJK 部首
  if (c >= 0xF900 && c <= 0xFAFF) return true;   // CJK 兼容表意
  return '—–，。；：、（）“”‘’'.includes(ch);
}
function charW(ch) {
  if (ch === ' ') return .3;
  return isFullWidth(ch) ? 1 : .56;
}
function wrapLines(text, fontSize, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '', w = 0;
    for (const ch of para) {
      const cw = charW(ch) * fontSize;
      if (w + cw > maxWidth && line) { lines.push(line); line = ''; w = 0; }
      line += ch; w += cw;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function textSvg(x, y, text, fontSize, color, opts = {}) {
  const maxW = opts.maxWidth || (CARD_W - 2 * x);
  const lines = wrapLines(text, fontSize, maxW);
  const lh = opts.lineHeight || fontSize * 1.32;
  return lines.map((ln, i) =>
    `<text x="${x}" y="${(y + i * lh).toFixed(1)}" font-size="${fontSize}" fill="${color}" text-anchor="${opts.anchor || 'start'}" font-family="${opts.family || 'inherit'}" font-weight="${opts.weight || 'normal'}">${esc(ln)}</text>`).join('');
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- 食物成本行 ----------
function costRow(cost, x, y, size) {
  let cx = x;
  const parts = [];
  cost.forEach((it, i) => {
    if (it.type === 'none') { parts.push(textSvg(cx, y, '无成本', 18, INK)); return; }
    if (it.any_of) {
      it.any_of.forEach((a, j) => {
        for (let k = 0; k < (a.amount || 1); k++) { parts.push(foodIcon(a.type, cx, y - size * .3, size)); cx += size * 1.05; }
        if (j < it.any_of.length - 1) { parts.push(`<text x="${cx}" y="${y}" font-size="${size * .8}" fill="${INK}">/</text>`); cx += size * .55; }
      });
    } else {
      for (let k = 0; k < (it.amount || 1); k++) { parts.push(foodIcon(it.type, cx, y - size * .3, size)); cx += size * 1.05; }
    }
    if (i < cost.length - 1) { cx += size * .25; }
  });
  return parts.join('');
}

function frame(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif">
<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fbf5e8"/><stop offset="1" stop-color="${PAPER}"/></linearGradient></defs>
<rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="20" fill="url(#pg)" stroke="#b9a98c" stroke-width="2"/>
${inner}</svg>`;
}

// ---------- 鸟卡 ----------
export function birdSvg(b) {
  const habs = b.habitats;
  // 顶部栖息地分段色带
  const segW = (CARD_W - 12) / habs.length;
  const bands = habs.map((h, i) =>
    `<rect x="${6 + i * segW}" y="6" width="${segW + 1}" height="64" fill="${HAB_COLOR[h]}" ${i === 0 ? 'rx="20" ry="20"' : ''}/>`).join('');
  const habLabels = habs.map((h, i) =>
    `<text x="${6 + segW * (i + .5)}" y="46" font-size="22" fill="#fff" text-anchor="middle" font-weight="700">${{ forest: '森林', grassland: '草原', wetland: '湿地' }[h]}</text>`).join('');

  // 中央徽章
  const badgeColor = b.power ? POWER_COLOR[b.power.color] : '#9a8a70';
  const inner = `
  ${bands}${habLabels}
  <g transform="translate(0,8)">
    ${costRow(b.food_cost, 30, 118, 34)}
    <circle cx="${CARD_W - 52}" cy="100" r="30" fill="${GOLD}" stroke="#a87f2c" stroke-width="2"/>
    <text x="${CARD_W - 52}" y="111" font-size="32" fill="#fff" text-anchor="middle" font-weight="800">${b.points}</text>
  </g>
  <circle cx="${CARD_W / 2}" cy="330" r="118" fill="#e7dcc2" stroke="#c9b996" stroke-width="2"/>
  ${birdSilhouette(CARD_W / 2, 330, 170, badgeColor)}
  <text x="${CARD_W / 2}" y="498" font-size="${b.name_en.length > 22 ? 22 : 27}" fill="${INK}" text-anchor="middle" font-weight="700">${esc(b.name_en)}</text>
  <text x="${CARD_W / 2}" y="528" font-size="20" fill="#6b5b45" text-anchor="middle">${esc(b.name_zh)}</text>
  <line x1="40" y1="552" x2="${CARD_W - 40}" y2="552" stroke="#c9b996" stroke-width="1.5"/>
  ${b.nest !== 'none' ? nestIcon(b.nest, 70, 592, 34) : ''}
  <text x="${b.nest !== 'none' ? 96 : 40}" y="600" font-size="17" fill="${INK}">${b.nest !== 'none' ? '蛋上限 ' + b.egg_limit : '无巢 · 蛋上限 ' + b.egg_limit}</text>
  <text x="330" y="600" font-size="17" fill="${INK}">翼展 ${b.wingspan} cm</text>
  ${b.power ? `
  <rect x="28" y="636" width="8" height="${Math.max(40, wrapLines(b.power.text_zh, 16, CARD_W - 90).length * 22 + 16)}" rx="4" fill="${badgeColor}"/>
  ${textSvg(50, 656, b.power.text_zh, 16, INK, { maxWidth: CARD_W - 82 })}` :
      `<text x="50" y="660" font-size="16" fill="#9b8b74">无能力</text>`}
  <text x="${CARD_W / 2}" y="846" font-size="12" fill="#a8987c" text-anchor="middle">程序化卡面 · 非官方扫描（数值与能力文本依官方数据）</text>`;
  return frame(inner);
}

// ---------- 奖励卡 ----------
export function bonusSvg(c) {
  const inner = `
  <path d="M6,26 a20,20 0 0 1 20,-20 h518 a20,20 0 0 1 20,20 v70 h-558 Z" fill="${GOLD}"/>
  <text x="${CARD_W / 2}" y="58" font-size="26" fill="#fff" text-anchor="middle" font-weight="800">${esc(c.name_en)}</text>
  <circle cx="${CARD_W / 2}" cy="280" r="110" fill="#efe4c9" stroke="#c9b996" stroke-width="2"/>
  ${starPath(CARD_W / 2, 280, 78, 36, GOLD)}
  <text x="${CARD_W / 2}" y="440" font-size="30" fill="${INK}" text-anchor="middle" font-weight="700">${esc(c.name_zh)}</text>
  <line x1="60" y1="470" x2="${CARD_W - 60}" y2="470" stroke="#c9b996"/>
  ${textSvg(50, 510, c.detail_zh, 18, INK, { maxWidth: CARD_W - 100 })}
  ${textSvg(50, 640, c.vp_text, 17, '#8a6a2c', { maxWidth: CARD_W - 100, weight: '700' })}
  <text x="${CARD_W / 2}" y="846" font-size="12" fill="#a8987c" text-anchor="middle">程序化卡面 · 非官方扫描</text>`;
  return frame(inner);
}

export const svgExt = f => path.extname(f).toLowerCase() === '.svg';

// 展翅翱翔 · 零依赖游戏服务器
// - 静态文件服务（client/assets/data）
// - 自实现 WebSocket（RFC 6455，文本帧）
// - 房间系统 + 服务端权威对局（引擎在服务端运行，客户端只收投影视图）
// 启动：node server/server.js  （默认 http://localhost:8420）
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8420);
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game_data.json'), 'utf8'));
const { createGame, MatchDriver, stateView } = await import('../shared/engine.js');
import { botDecide } from '../shared/bot.js';

const COLORS = ['purple', 'blue', 'yellow', 'red', 'green', 'teal', 'white', 'orange'];

// ---------------- 静态文件 ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
function serveFile(req, res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/client/index.html';
  const p = path.normalize(path.join(ROOT, url));
  // 必须严格位于 ROOT 内（加分隔符，防止 ROOT_backup 等同级目录被 startsWith 误判）
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------------- WebSocket（RFC6455 最小实现） ----------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsAccept(key) { return crypto.createHash('sha1').update(key + WS_GUID).digest('base64'); }

class WsConn {
  constructor(socket) {
    this.socket = socket; this.alive = true; this.onmessage = null; this.onclose = null;
    this.buf = Buffer.alloc(0); this.fragments = [];
    socket.on('data', d => this._feed(d));
    socket.on('close', () => { this.alive = false; this.onclose && this.onclose(); });
    socket.on('error', () => { this.alive = false; try { socket.destroy(); } catch { } });
  }
  _feed(data) {
    this.buf = Buffer.concat([this.buf, data]);
    for (;;) {
      const frame = this._parseFrame();
      if (!frame) break;
      const { opcode, payload, fin } = frame;
      if (opcode === 0x8) { this._send(0x8, Buffer.alloc(0)); this.socket.end(); this.alive = false; this.onclose && this.onclose(); return; }
      if (opcode === 0x9) { this._send(0xA, payload); continue; } // ping→pong
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments);
          this.fragments = [];
          this.onmessage && this.onmessage(full.toString('utf8'));
        }
      }
    }
  }
  _parseFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > 1 << 20) { this.socket.destroy(); return null; } // 1MB 上限
    let mask = null;
    if (masked) { if (b.length < off + 4) return null; mask = b.subarray(off, off + 4); off += 4; }
    if (b.length < off + len) return null;
    let payload = b.subarray(off, off + len);
    if (mask) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
    this.buf = b.subarray(off + len);
    return { fin, opcode, payload };
  }
  _send(opcode, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, payload]));
  }
  sendJson(obj) { this._send(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }
}

// ---------------- 房间与对局 ----------------
const rooms = new Map(); // code → room
const conns = new Set(); // 所有连接
let pidSeq = 1;

function genCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    if (!rooms.has(s)) return s;
  }
}

class Room {
  constructor(ownerPid, cfg) {
    this.code = genCode();
    this.ownerPid = ownerPid;
    this.cfg = cfg; // {mode, goalSide, humans, total}
    this.humans = []; // {pid, name, conn}
    this.started = false;
    this.driver = null;
    this.state = null;
  }
  broadcast() {
    if (!this.state) return;
    for (const h of this.humans) {
      if (!h.conn || !h.conn.alive) continue;
      h.conn.sendJson({
        type: 'game', view: stateView(this.state, h.pid, DATA),
        pending: this.state.pending && this.state.pending.pid === h.pid ? this.pendingFor(h.pid) : null,
      });
    }
  }
  pendingFor(pid) {
    // 只发给该玩家：请求需带 data（候选等）
    const p = this.state.pending;
    if (!p || p.pid !== pid) return null;
    return { pid, kind: p.kind, data: p.data };
  }
  pump() {
    if (!this.driver || this.driver.done) { this.broadcast(); return; }
    try {
      const r = this.driver.pump();
      this.broadcast();
      if (r && r.needInput) {
        const h = this.humans.find(x => x.pid === r.needInput.pid);
        if (!h || !h.conn || !h.conn.alive) {
          // 玩家掉线：托管代答（安全默认）
          this.driver.answer(botDecide(this.state, { pid: r.needInput.pid, kind: r.needInput.kind, data: r.needInput.data }, DATA));
          this.broadcast();
        }
      }
    } catch (e) {
      console.error(`[${this.code}] 对局异常:`, e);
      for (const h of this.humans) h.conn && h.conn.sendJson({ type: 'error', code: 'E_INTERNAL', msg: e.message });
    }
  }
  start() {
    const humans = this.humans.map(h => ({ pid: h.pid, name: h.name, color: '', bot: false }));
    const bots = Array.from({ length: Math.max(0, this.cfg.total - humans.length) }, (_, i) => ({
      pid: 'bot' + (i + 1), name: '机器人' + (i + 1), color: '', bot: true,
    }));
    const players = [...humans, ...bots].map((p, i) => ({ ...p, color: COLORS[i] }));
    this.state = createGame({ mode: this.cfg.mode, players, seed: (Math.random() * 2 ** 31) >>> 0, goalSide: this.cfg.goalSide }, DATA);
    this.driver = new MatchDriver(this.state, DATA);
    this.started = true;
    this.pump();
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (req.url === '/api/rooms') {
    const list = [...rooms.values()].filter(r => !r.started).map(r => ({
      code: r.code, mode: r.cfg.mode, humans: r.humans.length, total: r.cfg.total, owner: r.humans.find(h => h.pid === r.ownerPid)?.name,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }
  if (req.url === '/api/debug') {
    const dump = [...rooms.values()].map(r => ({
      code: r.code, started: r.started, humans: r.humans.map(h => ({ pid: h.pid, name: h.name, live: !!(h.conn && h.conn.alive) })),
      pending: r.state && r.state.pending && { pid: r.state.pending.pid, kind: r.state.pending.kind },
      phase: r.state && r.state.phase, turn: r.state && r.state.turnPid, rev: r.state && r.state.rev,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(dump));
  }
  serveFile(req, res);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n');
  socket.setNoDelay(true);
  const conn = new WsConn(socket);
  conns.add(conn);
  let myPid = null;
  let myRoom = null;

  conn.onclose = () => {
    conns.delete(conn);
    if (myRoom) {
      const h = myRoom.humans.find(x => x.conn === conn);
      if (h) h.conn = null; // 保留座位，可重连
    }
  };
  conn.onmessage = raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return conn.sendJson({ type: 'error', code: 'E_BAD_JSON' }); }
    try { handle(msg); } catch (e) {
      console.error('消息处理异常:', e);
      conn.sendJson({ type: 'error', code: 'E_INTERNAL', msg: e.message });
    }
  };

  function handle(msg) {
    switch (msg.type) {
      case 'hello': {
        myPid = 'u' + (pidSeq++);
        conn.sendJson({ type: 'welcome', pid: myPid, dataMeta: { bird_count: DATA.meta.bird_count, bonus: DATA.bonus.length, goals: DATA.goals.length } });
        break;
      }
      case 'create_room': {
        if (!myPid) return;
        const cfg = msg.cfg || {};
        const mode = ['base', 'flock', 'extended'].includes(cfg.mode) ? cfg.mode : 'base';
        const total = Math.max(1, Math.min(8, cfg.total | 0 || (mode === 'base' ? 4 : mode === 'flock' ? 6 : 8)));
        const min = mode === 'base' ? 4 : mode === 'flock' ? 6 : 8;
        const room = new Room(myPid, { mode, total: Math.max(min, total), goalSide: cfg.goalSide === 'blue' ? 'blue' : 'green' });
        room.humans.push({ pid: myPid, name: String(msg.name || '玩家').slice(0, 12), conn });
        rooms.set(room.code, room);
        myRoom = room;
        conn.sendJson({ type: 'room', code: room.code, cfg: room.cfg, players: room.humans.map(h => ({ pid: h.pid, name: h.name, bot: false })) });
        break;
      }
      case 'join_room': {
        if (!myPid) return;
        const room = rooms.get(String(msg.code || '').toUpperCase());
        if (!room) return conn.sendJson({ type: 'error', code: 'E_NO_ROOM', msg: '房间不存在' });
        if (room.started) {
          // 重连：按旧 pid 匹配座位，并把连接级 myPid 绑定回旧 pid，否则后续 answer 校验会失败
          const h = room.humans.find(x => x.pid === msg.pid);
          if (h) { h.conn = conn; myPid = h.pid; myRoom = room; room.broadcast(); return; }
          return conn.sendJson({ type: 'error', code: 'E_STARTED', msg: '对局已开始' });
        }
        if (room.humans.length >= room.cfg.total) return conn.sendJson({ type: 'error', code: 'E_FULL', msg: '房间已满' });
        room.humans.push({ pid: myPid, name: String(msg.name || '玩家').slice(0, 12), conn });
        myRoom = room;
        for (const h of room.humans) h.conn && h.conn.alive && h.conn.sendJson({
          type: 'room', code: room.code, cfg: room.cfg,
          players: room.humans.map(x => ({ pid: x.pid, name: x.name, bot: false })),
        });
        break;
      }
      case 'start_game': {
        if (!myRoom || myRoom.started) return;
        if (myRoom.ownerPid !== myPid) return conn.sendJson({ type: 'error', code: 'E_NOT_OWNER', msg: '只有房主可以开始' });
        myRoom.start();
        break;
      }
      case 'answer': {
        if (!myRoom || !myRoom.started) return;
        const p = myRoom.state.pending;
        if (!p || p.pid !== myPid) return conn.sendJson({ type: 'error', code: 'E_NOT_YOUR_TURN', msg: '当前无需你决策' });
        myRoom.driver.answer(msg.answer || {});
        myRoom.pump();
        break;
      }
      case 'chat': {
        if (!myRoom) return;
        const h = myRoom.humans.find(x => x.pid === myPid);
        const text = String(msg.text || '').slice(0, 200);
        for (const x of myRoom.humans) x.conn && x.conn.alive && x.conn.sendJson({ type: 'chat', from: h ? h.name : '?', text });
        break;
      }
      default: conn.sendJson({ type: 'error', code: 'E_UNKNOWN_MSG' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`《展翅翱翔》服务器已启动: http://localhost:${PORT}`);
});

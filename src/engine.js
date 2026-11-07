// Deterministic simulation. All lengths are in a 480-unit-wide world.
// Swept collision detection prevents a fast ball from tunnelling through notes.
export const WIDTH = 480;
export const STEP = 1 / 240;
export const TYPES = ['tap', 'flick', 'drag', 'hold'];
export const LEVELS = ['1E7', '1E10', '1E20', '1E60', '1E120', '123456!', '10↑↑10', '10↑↑100', '10↑↑114514'];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function randomGenerator(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function sweepBox(x, y, dx, dy, box, radius) {
  const minX = box.x - radius, maxX = box.x + box.w + radius;
  const minY = box.y - box.h / 2 - radius, maxY = box.y + box.h / 2 + radius;
  // Already-overlapping notes are handled only on entry, never every frame.
  if (x > minX && x < maxX && y > minY && y < maxY) return null;
  let entry = -Infinity, exit = Infinity, nx = 0, ny = 0;
  for (const [pos, delta, lo, hi, ax, ay] of [[x, dx, minX, maxX, 1, 0], [y, dy, minY, maxY, 0, 1]]) {
    if (Math.abs(delta) < 1e-10) { if (pos < lo || pos > hi) return null; continue; }
    let a = (lo - pos) / delta, b = (hi - pos) / delta;
    const sign = delta > 0 ? -1 : 1;
    if (a > b) [a, b] = [b, a];
    if (a > entry) { entry = a; nx = ax * sign; ny = ay * sign; }
    exit = Math.min(exit, b);
    if (entry > exit) return null;
  }
  return entry >= -1e-8 && entry <= 1 && exit >= 0 ? { t: Math.max(0, entry), nx, ny } : null;
}
export class Engine {
  constructor({ seed = 3467, mode = 'mixed', height = 800, generate = true } = {}) {
    this.height = height;
    this.generate = generate;
    this.reset(seed, mode);
  }
  reset(seed = this.seed, mode = this.mode) {
    this.seed = seed >>> 0;
    this.mode = mode;
    this.random = randomGenerator(this.seed);
    this.time = 0;
    this.camera = 0;
    this.previousCamera = 0;
    this.ball = { x: 192, y: 112, previousX: 192, previousY: 112, vx: 170, vy: 95, r: 11, hold: null };
    this.rows = [];
    this.notes = [];
    this.events = [];
    this.hits = 0;
    this.maxDepth = 0;
    this.typeHits = { tap: 0, flick: 0, drag: 0, hold: 0 };
    this.nextRow = 0;
    this.nextId = 0;
    this.boost = 1;
    this.lastHit = null;
    this.trail = [];
    this.trailClock = 0;
    if (this.generate) this.ensureWorld();
  }
  setHeight(height) { this.height = Math.max(320, height); }
  addNote(type, x, y, w = 94, length = 96, row = -1) {
    const n = { id: this.nextId++, type, x, y, w, h: type === 'flick' ? 12 : 8, length, row, dead: false, holding: false, progress: 0 };
    this.notes.push(n);
    return n;
  }
  ensureWorld() {
    while (!this.rows.length || this.rows.at(-1).y < this.camera + this.height + 400) {
      const index = this.nextRow++;
      const y = 238 + index * 136;
      this.rows.push({ index, y, active: index === 0, label: LEVELS[index % LEVELS.length] });
      if (index === 0) this.populateRow(this.rows.at(-1));
    }
  }
  populateRow(row) {
    const { index, y } = row;
    row.active = true;
    // The opening matches the blue note wall in the reference. Mixed types
    // appear from the next row onward, with all four represented in each row.
    const arrangement = ['tap', 'flick', 'drag', 'hold', 'tap'];
    const offset = Math.floor(this.random() * 5);
    for (let col = 0; col < 5; col++) {
      const type = this.mode === 'mixed' ? (index === 0 ? 'tap' : arrangement[(col + offset) % 5]) : this.mode;
      const n = this.addNote(type, col * 96 + 2, y + (type === 'hold' ? -12 : 0), 92, 104 + this.random() * 16, index);
      if (index === 0 && col % 2 === 1) this.addNote(type, n.x, y - 12, 92, 0, index);
      // Offset blue ledges recreate the dispersed notes after the first wall.
      if (index > 0 && index % 3 === 0 && col % 2 === 0 && type !== 'hold') this.addNote(type, n.x, y - 47, 92, 0, index);
    }
  }
  emit(type, note, extra = {}) {
    this.events.push({ type, noteType: note.type, x: this.ball.x, y: this.ball.y, time: this.time, id: note.id, ...extra });
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100);
  }
  consume(note) {
    if (note.dead || note.holding) return;
    this.hits++;
    this.typeHits[note.type]++;
    this.lastHit = note.type;
    if (note.type === 'hold') {
      note.holding = true;
      this.ball.hold = { note, startY: note.y, endY: note.y + note.length, previousVx: this.ball.vx };
      this.ball.x = note.x + note.w / 2;
      this.ball.y = note.y;
      this.ball.vx = 0;
      this.ball.vy = 105;
      this.emit('hold-start', note);
    } else {
      note.dead = true;
      this.emit('hit', note);
    }
  }
  react(note, normal) {
    const b = this.ball;
    this.consume(note);
    if (note.type === 'tap') {
      if (normal.nx) b.vx = normal.nx * Math.max(180, Math.abs(b.vx));
      if (normal.ny) b.vy = normal.ny * Math.max(380 * this.boost, Math.min(610, Math.abs(b.vy) * 0.92));
    } else if (note.type === 'flick') {
      this.boost = Math.min(1.7, this.boost + 0.06);
      const speed = Math.min(1180, Math.max(560, Math.hypot(b.vx, b.vy) * 1.25));
      let angle = this.random() * Math.PI * 2;
      // Preserve a clear vertical component while retaining random directions.
      if (Math.abs(Math.sin(angle)) < 0.3) angle += 0.5;
      b.vx = Math.cos(angle) * speed;
      b.vy = Math.sin(angle) * speed;
    } else if (note.type === 'drag') {
      this.boost = Math.min(1.7, this.boost + 0.045);
      const speed = Math.hypot(b.vx, b.vy);
      const factor = Math.min(1.24, 1180 / Math.max(speed, 1));
      b.vx *= factor;
      b.vy *= factor;
    }
  }
  advanceBall(dt) {
    const b = this.ball;
    b.previousX = b.x; b.previousY = b.y;
    if (b.hold) {
      const { note, endY, previousVx } = b.hold;
      b.x = note.x + note.w / 2;
      b.y = Math.min(endY, b.y + 105 * dt);
      b.vx = 0; b.vy = 105;
      note.progress = clamp((b.y - note.y) / note.length, 0, 1);
      if (b.y >= endY - 1e-8) {
        note.dead = true; note.holding = false;
        b.hold = null;
        b.vx = Math.abs(previousVx) > 80 ? previousVx : (this.random() < 0.5 ? -170 : 170);
        b.vy = 260;
        this.emit('hold-end', note);
      }
      return;
    }
    b.vy = Math.min(1180, b.vy + 920 * dt);
    let remaining = dt;
    for (let collision = 0; collision < 8 && remaining > 1e-7; collision++) {
      let contact = null;
      const dx = b.vx * remaining, dy = b.vy * remaining;
      for (const note of this.notes) {
        if (note.dead || note.holding || Math.abs(note.y - b.y) > Math.abs(dy) + b.r + note.h + 2) continue;
        const hit = sweepBox(b.x, b.y, dx, dy, note, b.r);
        if (hit && (!contact || hit.t < contact.t)) contact = { ...hit, note };
      }
      if (!contact) { b.x += dx; b.y += dy; break; }
      b.x += dx * contact.t; b.y += dy * contact.t;
      this.react(contact.note, contact);
      if (b.hold) break;
      remaining *= 1 - contact.t;
      // Nudge along outgoing velocity, so a consumed key cannot be hit twice.
      const magnitude = Math.hypot(b.vx, b.vy) || 1;
      b.x += b.vx / magnitude * 0.02; b.y += b.vy / magnitude * 0.02;
    }
    if (b.x < b.r) { b.x = b.r + (b.r - b.x); b.vx = Math.abs(b.vx); }
    if (b.x > WIDTH - b.r) { b.x = 2 * (WIDTH - b.r) - b.x; b.vx = -Math.abs(b.vx); }
    const ceiling = this.camera + 94;
    if (b.y < ceiling) { b.y = ceiling; b.vy = Math.max(100, Math.abs(b.vy)); }
  }
  step(dt = STEP) {
    this.time += dt;
    this.previousCamera = this.camera;
    if (this.generate) {
      for (const row of this.rows) if (!row.active && row.y < this.ball.y + 174) this.populateRow(row);
    }
    this.advanceBall(dt);
    this.maxDepth = Math.max(this.maxDepth, this.ball.y - 112);
    const target = Math.max(0, this.ball.y - this.height * 0.31);
    if (target > this.camera) this.camera += (target - this.camera) * (1 - Math.exp(-11 * dt));
    // A second bound keeps a highly accelerated ball visibly inside the stage.
    this.camera = Math.max(this.camera, this.ball.y - this.height * 0.66);
    this.trailClock += dt;
    if (this.trailClock >= 1 / 60) {
      this.trailClock -= 1 / 60;
      this.trail.push({ x: this.ball.x, y: this.ball.y, t: this.time });
    }
    this.trail = this.trail.filter(p => this.time - p.t < 0.28);
    if (this.generate) {
      this.notes = this.notes.filter(n => n.y + n.length > this.camera - 170 && (!n.dead || this.ball.hold?.note === n));
      this.rows = this.rows.filter(row => row.y > this.camera - 200);
      this.ensureWorld();
    }
  }
  drainEvents() { return this.events.splice(0); }
  get speed() { return Math.hypot(this.ball.vx, this.ball.vy); }
}

import { Engine, WIDTH, STEP, clamp, TYPES } from './engine.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), stage = $('stage'), ctx = canvas.getContext('2d', { alpha: false });
const preferences = $('preferences');
const modeNames = { mixed: '四色', tap: '蓝键', flick: '红键', drag: '黄键', hold: '长条' };
const colors = { tap: '#4dbfe4', flick: '#ff658c', drag: '#e2ce46', hold: '#78b8de' };
let config = { mode: 'mixed', speed: 1, trails: true, effects: true };
try {
  const stored = JSON.parse(localStorage.getItem('phigame-settings') || 'null');
  if (stored) {
    if (Object.hasOwn(modeNames, stored.mode)) config.mode = stored.mode;
    if (Number.isFinite(stored.speed)) config.speed = clamp(stored.speed, 0.5, 2);
    for (const key of ['trails', 'effects']) if (typeof stored[key] === 'boolean') config[key] = stored[key];
  }
} catch { /* Private browsing may disable storage; the game remains usable. */ }
const engine = new Engine({ mode: config.mode });
let paused = false, loaded = false, hidden = document.hidden, wasPausedBeforeDialog = false;
let cssWidth = 480, cssHeight = 800, scale = 1, dpr = 1;
let previousFrame = 0, accumulator = 0, hudTime = 0, toastTimer;
const images = {}, sprites = {}, particles = [], flashes = [];
const fxFrames = [];
let holdGlow = 0;
function persist() { try { localStorage.setItem('phigame-settings', JSON.stringify(config)); } catch {} }
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 1800);
}
function syncSettings() {
  $('modeName').textContent = modeNames[config.mode];
  $('speed').value = config.speed;
  $('speedValue').value = `${config.speed.toFixed(2).replace(/0$/, '')}×`;
  $('trails').checked = config.trails;
  $('effects').checked = config.effects;
  document.querySelectorAll('[data-mode]').forEach(el => {
    const selected = el.dataset.mode === config.mode;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', selected);
  });
}
function resize() {
  const rect = stage.getBoundingClientRect();
  cssWidth = Math.max(1, rect.width - 2 * (getComputedStyle(stage).borderLeftWidth === '0px' ? 0 : 1));
  cssHeight = Math.max(1, rect.height - 2 * (getComputedStyle(stage).borderTopWidth === '0px' ? 0 : 1));
  dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  scale = cssWidth / WIDTH;
  engine.setHeight(cssHeight / scale);
  draw(1);
}
new ResizeObserver(resize).observe(stage);
function prepareSprite(name, width) {
  const img = images[name];
  const h = width * img.height / img.width;
  const c = document.createElement('canvas');
  c.width = Math.ceil(width + 8); c.height = Math.ceil(h + 8);
  const g = c.getContext('2d');
  // A faint edge keeps the original white Phigros frame visible on white.
  g.shadowColor = 'rgba(55,73,85,0.68)'; g.shadowBlur = 1.7;
  g.drawImage(img, 4, 4, width, h);
  return { image: c, w: width, h, pad: 4 };
}
function prepareEffects() {
  const atlas = images.HitFx;
  const sourceSize = atlas.width / 5;
  for (let i = 0; i < 30; i++) {
    const c = document.createElement('canvas'); c.width = 110; c.height = 110;
    const g = c.getContext('2d');
    g.drawImage(atlas, i % 5 * sourceSize, Math.floor(i / 5) * sourceSize, sourceSize, sourceSize, 0, 0, 110, 110);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#e6be61'; g.fillRect(0, 0, 110, 110);
    fxFrames.push(c);
  }
}
async function loadAssets() {
  const names = ['Tap', 'Flick', 'Drag', 'Hold', 'HitFx'];
  await Promise.all(names.map(name => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images[name] = img; resolve(); };
    img.onerror = () => reject(new Error(`音符资源 ${name} 加载失败`));
    img.src = new URL(`../assets/skin/${name}.png`, import.meta.url).href;
  })));
  for (const name of ['Tap', 'Flick', 'Drag']) sprites[name.toLowerCase()] = prepareSprite(name, 276);
  prepareEffects();
  loaded = true;
  $('loading').hidden = true;
  resize();
}
const audio = {
  context: null, enabled: false, buffers: {}, loadPromise: null, voices: 0,
  async toggle(forceOn = false) {
    if (this.enabled && !forceOn) {
      this.enabled = false;
      this.updateButton();
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('此浏览器暂不支持音效');
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.gain = this.context.createGain(); this.gain.gain.value = 0.26;
        this.gain.connect(this.context.destination);
      }
      await this.context.resume();
      if (!this.loadPromise) this.loadPromise = Promise.all(['Tap', 'Flick', 'Drag'].map(async name => {
        const r = await fetch(new URL(`../assets/skin/${name}.wav`, import.meta.url));
        if (!r.ok) throw new Error('音效加载失败');
        this.buffers[name.toLowerCase()] = await this.context.decodeAudioData(await r.arrayBuffer());
      })).catch(error => { this.loadPromise = null; throw error; });
      await this.loadPromise;
      this.enabled = true;
      this.updateButton();
      $('soundHint').hidden = true;
      this.play('tap');
      toast('打击音效已开启');
    } catch (error) { toast(error.message || '音效暂时无法开启'); }
  },
  updateButton() {
    $('sound').setAttribute('aria-pressed', this.enabled);
    $('sound').setAttribute('aria-label', this.enabled ? '关闭音效' : '开启音效');
    $('sound').title = this.enabled ? '关闭音效' : '开启音效';
    $('sound').querySelector('use').setAttribute('href', this.enabled ? '#i-sound' : '#i-muted');
  },
  play(type) {
    if (!this.enabled || this.context.state !== 'running' || this.voices >= 14) return;
    const buffer = this.buffers[type === 'hold' ? 'tap' : type];
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.connect(this.gain);
    this.voices++; source.onended = () => { this.voices--; source.disconnect(); };
    source.start();
  }
};
function hitEffect(event) {
  audio.play(event.noteType);
  if (!config.effects) return;
  if (flashes.length > 25) flashes.shift();
  flashes.push({ x: event.x, y: event.y, birth: engine.time, color: colors[event.noteType] });
  for (let i = 0; i < 5 && particles.length < 100; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * (30 + Math.random() * 90), vy: Math.sin(angle) * 100 - 30, age: 0, color: colors[event.noteType] });
  }
}
function simulate(dt) {
  engine.step(dt);
  for (const event of engine.drainEvents()) {
    if (event.type !== 'hold-end') hitEffect(event);
    if (event.type === 'hold-start') holdGlow = 0;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt;
    if (p.age > 0.45) particles.splice(i, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) if (engine.time - flashes[i].birth > 0.5) flashes.splice(i, 1);
  if (engine.ball.hold) {
    holdGlow += dt;
    if (holdGlow > 0.17) {
      holdGlow = 0;
      if (config.effects) flashes.push({ x: engine.ball.x, y: engine.ball.y, birth: engine.time, color: colors.hold });
    }
  }
}
function drawNote(note, camera) {
  const y = note.y - camera;
  if (note.type === 'hold') {
    const consumed = note.progress * note.length;
    const top = y + consumed;
    const remaining = note.length - consumed;
    if (remaining <= 0) return;
    const img = images.Hold;
    const w = note.w * 0.83;
    // Keep the official endcaps intact; stretch only the body in between.
    const x = note.x + (note.w - w) / 2;
    const cap = Math.min(5, remaining / 2);
    ctx.globalAlpha = note.holding ? 0.87 + Math.sin(engine.time * 28) * 0.1 : 0.92;
    ctx.drawImage(img, 0, 0, img.width, 50, x, top, w, cap);
    if (remaining > cap * 2) ctx.drawImage(img, 0, 50, img.width, img.height - 100, x, top + cap, w, remaining - 2 * cap);
    ctx.drawImage(img, 0, img.height - 50, img.width, 50, x, top + remaining - cap, w, cap);
    // The hold head is the same original Tap sprite, overlaid at the active end.
    const head = sprites.tap;
    const ratio = w / head.w;
    ctx.drawImage(head.image, x - 4 * ratio, top - head.h * ratio / 2 - 4 * ratio, head.image.width * ratio, head.image.height * ratio);
    ctx.globalAlpha = 1;
    return;
  }
  const s = sprites[note.type];
  const ratio = note.w / s.w;
  ctx.drawImage(s.image, note.x - s.pad * ratio, y - s.h * ratio / 2 - s.pad * ratio, s.image.width * ratio, s.image.height * ratio);
}
function draw(alpha = 1) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cssWidth, cssHeight);
  if (!loaded) return;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  const camera = engine.previousCamera + (engine.camera - engine.previousCamera) * alpha;
  const height = cssHeight / scale;
  // Dark number bands are the unopened floors visible in the reference video.
  for (const row of engine.rows) {
    const y = row.y - camera;
    if (y < 100 || y > height + 20 || row.active) continue;
    ctx.fillStyle = '#70757c'; ctx.fillRect(0, y - 8, WIDTH, 16);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.fillText(row.label, WIDTH / 2, y + 0.5);
  }
  // Fade the upper edge into the quiet HUD area as the camera follows the ball.
  ctx.save(); ctx.beginPath(); ctx.rect(0, 91, WIDTH, height); ctx.clip();
  for (const note of engine.notes) {
    if (note.dead || note.y + note.length < camera + 70 || note.y - camera > height + 30) continue;
    drawNote(note, camera);
  }
  if (config.trails) {
    for (const p of engine.trail) {
      const life = clamp(1 - (engine.time - p.t) / 0.28, 0, 1);
      ctx.beginPath(); ctx.arc(p.x, p.y - camera, life * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(116,141,159,${life * 0.17})`; ctx.fill();
    }
  }
  if (config.effects) {
    for (const flash of flashes) {
      const age = engine.time - flash.birth;
      const frame = fxFrames[Math.min(29, Math.floor(age * 60))];
      if (frame) { ctx.globalAlpha = (1 - age / 0.5) * 0.58; ctx.drawImage(frame, flash.x - 32, flash.y - camera - 32, 64, 64); }
    }
    ctx.globalAlpha = 1;
    for (const p of particles) {
      ctx.globalAlpha = (1 - p.age / 0.45) * 0.58;
      ctx.fillStyle = p.color; ctx.fillRect(p.x - 1.5, p.y - camera - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
  const b = engine.ball;
  const x = b.previousX + (b.x - b.previousX) * alpha;
  const y = b.previousY + (b.y - b.previousY) * alpha - camera;
  ctx.strokeStyle = b.hold ? '#7eafce' : '#7b8a95'; ctx.lineWidth = 1.3;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#c3ccd3'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x, y, b.r + 2.5, -0.2, 1.2); ctx.stroke();
  // Draw the musical note as paths so it stays sharp on every platform.
  ctx.strokeStyle = b.hold ? '#679cc0' : '#667d8e'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x + 2, y + 4); ctx.lineTo(x + 2, y - 5); ctx.quadraticCurveTo(x + 7, y - 3, x + 4, y + 0.3); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x - 0.4, y + 4.4, 2.8, 1.8, -0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const fade = ctx.createLinearGradient(0, 85, 0, 115);
  fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#ffffff00'); ctx.fillStyle = fade; ctx.fillRect(0, 85, WIDTH, 30);
}
function updateHud() {
  $('hitCount').textContent = engine.hits.toLocaleString();
  $('depth').textContent = Math.floor(engine.maxDepth / 10).toLocaleString();
  $('velocity').textContent = Math.round(engine.speed);
  $('holdLabel').hidden = !engine.ball.hold;
}
function frame(time) {
  requestAnimationFrame(frame);
  const delta = previousFrame ? Math.min((time - previousFrame) / 1000, 0.05) : 0;
  previousFrame = time;
  if (!loaded || hidden) return;
  if (!paused) {
    accumulator += delta * config.speed;
    while (accumulator >= STEP) { simulate(STEP); accumulator -= STEP; }
    draw(accumulator / STEP);
    hudTime += delta;
    if (hudTime >= 0.1) { hudTime = 0; updateHud(); }
  }
}
function setPaused(value) {
  paused = value;
  $('pause').querySelector('use').setAttribute('href', value ? '#i-play' : '#i-pause');
  $('pause').setAttribute('aria-label', value ? '继续弹跳' : '暂停');
  $('pause').title = value ? '继续弹跳（空格）' : '暂停（空格）';
  $('pauseOverlay').hidden = !value;
  $('autoBadge').classList.toggle('paused', value);
  $('runStatus').textContent = value ? '已暂停' : '自动弹跳中';
  previousFrame = 0;
  draw(1);
}
function reset(seed = engine.seed) {
  engine.reset(seed, config.mode); particles.length = 0; flashes.length = 0;
  accumulator = 0; previousFrame = 0; updateHud(); draw(1);
}
function openSettings() {
  if (preferences.open) return;
  wasPausedBeforeDialog = paused;
  setPaused(true);
  preferences.showModal();
}
function closeSettings() {
  if (!preferences.open) return;
  preferences.close();
  setPaused(wasPausedBeforeDialog);
}
preferences.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
preferences.addEventListener('click', event => { if (event.target === preferences) { const r = preferences.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSettings(); } });
$('pause').addEventListener('click', () => setPaused(!paused));
$('resume').addEventListener('click', () => setPaused(false));
$('restart').addEventListener('click', () => { reset(); setPaused(false); toast('重新开始'); });
$('sound').addEventListener('click', () => audio.toggle());
$('soundHint').addEventListener('click', () => audio.toggle(true));
$('settings').addEventListener('click', openSettings);
$('mode').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => {
  const mode = el.dataset.mode;
  if (!Object.hasOwn(modeNames, mode)) return;
  if (config.mode !== mode) {
    config.mode = mode; persist(); syncSettings(); reset();
    toast(`已切换${modeNames[mode]}模式`);
  }
  closeSettings();
}));
$('speed').addEventListener('input', event => { config.speed = Number(event.target.value); syncSettings(); persist(); });
for (const key of ['trails', 'effects']) $(key).addEventListener('change', event => { config[key] = event.target.checked; persist(); draw(1); });
$('newRoute').addEventListener('click', () => {
  const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
  reset(bytes[0]); closeSettings(); toast('已生成新路线');
});
async function toggleFullscreen() {
  const app = $('app');
  if (document.fullscreenElement) { await document.exitFullscreen(); return; }
  if (app.classList.contains('immersive')) { app.classList.remove('immersive'); resize(); return; }
  app.classList.add('immersive');
  if (app.requestFullscreen) {
    try { await app.requestFullscreen(); } catch { /* iPad Safari uses the same immersive layout. */ }
  }
  resize();
}
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) $('app').classList.remove('immersive'); resize(); });
document.addEventListener('visibilitychange', () => {
  hidden = document.hidden; previousFrame = 0;
  if (!hidden && audio.enabled && audio.context?.state === 'suspended') audio.context.resume().catch(() => {});
});
window.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || preferences.open || !loaded) return;
  if (event.code === 'Space') { event.preventDefault(); setPaused(!paused); }
  if (event.code === 'KeyR') { reset(); setPaused(false); }
  if (event.code === 'KeyM') audio.toggle();
  if (event.code === 'Escape' && $('app').classList.contains('immersive')) toggleFullscreen();
});
syncSettings(); resize();
loadAssets().then(() => requestAnimationFrame(frame)).catch(error => {
  $('loading').replaceChildren();
  const text = document.createElement('p'); text.textContent = error.message;
  const retry = document.createElement('button'); retry.textContent = '重新加载'; retry.addEventListener('click', () => location.reload());
  $('loading').append(text, retry);
});

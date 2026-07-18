'use strict';

/* ============================================================
   DODGE THE CHAOS — GAME LOGIC 
   ------------------------------------------------------------
   JS = positions, physics, collisions, state, class toggling.
   CSS = every visual: themes, scenery, poses, animations.
   ============================================================ */

/* ============================================================
   ⚙️ CONFIG — YOUR CONTROL PANEL
   GAME_SPEED is the single speed knob. Movement is computed as
   a FRACTION OF SCREEN WIDTH per frame, so the game feels the
   same on a phone, tablet or desktop. Raise it → faster
   everywhere; lower it → slower everywhere. One variable,
   consistent across every screen size.
   ============================================================ */
const CONFIG = {
  GAME_SPEED: 6.5,     /* base speed — screens/sec feel, device-independent */
  SPEED_RAMP: 0.004,   /* how quickly difficulty ramps with score           */
  JUMP_V: -17,         /* jump impulse (negative = up)                      */
  GRAVITY: 0.85,       /* fall acceleration                                 */
  MAX_PNG_BYTES: 1024 * 1024,   /* 1 MB limit for custom characters        */
};

/* ---------- Tiny DOM helper ---------- */
const $ = id => document.getElementById(id);

const gameEl = $('game'), world = $('world');
const playerEl = $('player'), shadowEl = $('playerShadow');
const entities = $('entities'), npcLayer = $('npcLayer');
const cityStrip = $('cityStrip'), sidewalkEl = $('sidewalk');

/* ---------- Device detection: copy changes for touch screens ---------- */
const isTouch = window.matchMedia('(pointer: coarse)').matches;
$('introCta').textContent = isTouch ? '▶ TAP to play!' : '▶ Press SPACEBAR to play!';
$('overCta').textContent  = isTouch ? '▶ TAP to retry'  : '▶ Press SPACEBAR to retry';

/* ============================================================
   CHARACTER ROSTER — emoji heroes with matched run/jump poses.
   A custom PNG (uploaded by the player) becomes a 4th, STATIC
   option: no pose swap, no tilt, image stays as-is.
   ============================================================ */
const CHARACTERS = [
  { name: 'Sunny', run: '🏃',   jump: '🧍'   },
  { name: 'Maya',  run: '🏃🏽‍♀️', jump: '🧍🏽‍♀️' },
  { name: 'Andre', run: '🏃🏿',  jump: '🧍🏿'  },
];
let charIndex = 0;
let customPNG = null;          /* data-URL of the uploaded image, if any   */
let usingCustom = false;       /* true when the PNG character is selected  */

/* Apply a pose. With a custom PNG the character is static, so this is a
   no-op — CSS class .player--custom shows the image instead. */
function setPose(pose) {
  if (usingCustom) return;
  playerEl.style.setProperty('--player-emoji', '"' + CHARACTERS[charIndex][pose] + '"');
}
/* Switch between emoji hero & custom PNG — JS only toggles a class + var */
function applyCharacter() {
  if (usingCustom && customPNG) {
    playerEl.classList.add('player--custom');
    playerEl.style.setProperty('--player-image', 'url("' + customPNG + '")');
  } else {
    playerEl.classList.remove('player--custom');
    setPose(jumping ? 'jump' : 'run');
  }
  buildCharPickers();
}

/* ---------- Responsive metrics ---------- */
let W = 0, H = 0, GY = 0, PSIZE = 86;
function measure() {
  W = window.innerWidth;
  H = window.innerHeight;
  GY = H * (parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--ground-line')) / 100);
  PSIZE = playerEl.offsetWidth || 86;
}
window.addEventListener('resize', () => { measure(); buildCity(); });
window.addEventListener('orientationchange',
  () => setTimeout(() => { measure(); buildCity(); }, 200));

/* ---------- Audio ---------- */
let AC = null, muted = false;
const audio = () => AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
function beep(f1, f2, type, vol, dur) {
  if (muted) return;
  try {
    const a = audio(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.type = type;
    o.frequency.setValueAtTime(f1, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(f2, a.currentTime + dur * 0.6);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.start(); o.stop(a.currentTime + dur + 0.05);
  } catch (e) {}
}
const sJump = () => beep(300, 720, 'square', 0.12, 0.16);
const sJump2 = () => beep(480, 1100, 'square', 0.12, 0.14);
const sHit  = () => beep(380, 70, 'sawtooth', 0.15, 0.28);
const sCoin = () => beep(900, 1400, 'sine', 0.11, 0.18);
const sOver = () => beep(440, 110, 'square', 0.12, 0.5);
const sGo   = () => { beep(520, 780, 'sine', 0.1, 0.15);
                      setTimeout(() => beep(780, 1040, 'sine', 0.1, 0.2), 130); };

/* ---------- Seeded random ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- City builder ---------- */
const BLD_CLASSES = ['building--peach', 'building--mint', 'building--butter',
                     'building--lilac', 'building--rose', 'building--ice'];
let stripW = 0, cityX = 0;
function buildCity() {
  cityStrip.innerHTML = '';
  stripW = Math.max(1600, W * 2);
  for (let half = 0; half < 2; half++) {
    const rnd = mulberry32(4242);
    let x = half * stripW;
    while (x < (half + 1) * stripW - 60) {
      const w = 36 + rnd() * 50;
      const h = 50 + rnd() * 105;
      const b = document.createElement('div');
      b.className = 'building ' + BLD_CLASSES[(rnd() * BLD_CLASSES.length) | 0]
                  + (rnd() > 0.6 ? ' building--roofed' : '');
      b.style.left = x + 'px';
      b.style.width = w + 'px';
      b.style.height = h + 'px';
      cityStrip.appendChild(b);
      x += w + 10 + rnd() * 18;
    }
  }
  cityStrip.style.width = stripW * 2 + 'px';
}

/* ---------- NPCs ---------- */
const NPC_TYPES = ['🧒', '👧', '⚽', '🐕', '🚶', '🚴', '🛴', '👵', '🎈', '🐈'];
let npcs = [];
function spawnNPC(startX) {
  const dir = Math.random() > 0.5 ? 1 : -1;
  const el = document.createElement('div');
  el.className = 'npc';
  el.textContent = NPC_TYPES[(Math.random() * NPC_TYPES.length) | 0];
  npcLayer.appendChild(el);
  npcs.push({
    el, dir,
    x: startX !== undefined ? startX : (dir > 0 ? -40 : W + 40),
    sp: 0.4 + Math.random() * 0.8,
    bobSeed: Math.random() * Math.PI * 2
  });
}
function renderNPC(n, f) {
  const bob = Math.sin(f * 0.15 + n.bobSeed) * 2;
  n.el.style.transform =
    'translate3d(' + n.x + 'px,' + (GY - 28 + bob) + 'px,0)' +
    (n.dir < 0 ? ' scaleX(-1)' : '');
}

/* ---------- Obstacle catalogue ---------- */
const OBSTACLE_TYPES = [
  { e: '🦆', cls: 'obstacle--duck',  fly: false },
  { e: '🌮', cls: 'obstacle--taco',  fly: false },
  { e: '🛒', cls: 'obstacle--cart',  fly: false },
  { e: '🧀', cls: 'obstacle--nacho', fly: false },
  { e: '🎳', cls: 'obstacle--bowl',  fly: false },
  { e: '🍕', cls: 'obstacle--pizza', fly: false },
  { e: '🌯', cls: 'obstacle--wrap',  fly: false },
  { e: '🦆', cls: 'obstacle--fish',  fly: true  },
  { e: '🐟', cls: 'obstacle--fish',  fly: true  },
  { e: '🥤', cls: 'obstacle--drink', fly: true  },
];

/* ---------- Game state ---------- */
let state = 'intro';                 /* intro | playing | paused | over */
let obstacles = [], pickups = [];
let px = 0, py = 0, vy = 0, jumping = false, jumps = 0, runF = 0;
let score = 0, best = 0, lives = 3, frame = 0, speed = 5, spawnT = 0, invinc = 0;
let groundX = 0;

function pad(n) { return String(Math.floor(n)).padStart(5, '0'); }

/* Device-independent speed: fraction of screen width per frame.
   CONFIG.GAME_SPEED is YOUR knob — same feel on every screen size. */
function currentSpeed() {
  return (CONFIG.GAME_SPEED + score * CONFIG.SPEED_RAMP) * (W / 1000);
}

function resetPlayer() {
  px = W * 0.18;
  py = GY - PSIZE;
  vy = 0; jumping = false; jumps = 0; runF = 0;
  setPose('run');
}

/* ---------- Start / restart ---------- */
function init() {
  obstacles.forEach(o => o.el.remove());
  pickups.forEach(p => p.el.remove());
  obstacles = []; pickups = [];
  score = 0; lives = 3; frame = 0; spawnT = 60; invinc = 0;
  playerEl.classList.remove('player--blink');
  resetPlayer();
  state = 'playing';
  $('introOverlay').hidden = true;
  $('overOverlay').hidden = true;
  $('parade').hidden = true;
  world.classList.remove('zoom-in', 'zoom-mid');
  sGo();
}

/* ---------- Jump (doubles as start/retry; jump again mid-air = double jump) ---------- */
function jump() {
  if (state === 'paused') return;
  if (state !== 'playing') { init(); return; }
  if (jumps < 2) {
    jumps++;
    vy = CONFIG.JUMP_V;
    jumping = true;
    setPose('jump');                              /* emoji heroes swap pose */
    if (!usingCustom) playerEl.classList.add('player--jumping');
    if (jumps === 1) { sJump(); burstFX(px + PSIZE / 2, GY, '#ff8a65'); }
    else            { sJump2(); burstFX(px + PSIZE / 2, py + PSIZE, '#4fc3f7'); }
  }
}

/* ---------- FX ---------- */
function burstFX(x, y, color) {
  for (let i = 0; i < 7; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.background = color;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.setProperty('--px', (Math.random() * 80 - 40) + 'px');
    p.style.setProperty('--py', (-34 - Math.random() * 56) + 'px');
    entities.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}
function popupFX(x, y, text, color) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.textContent = text;
  el.style.color = color;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  entities.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

/* ---------- Spawners ---------- */
function spawnObstacle() {
  const t = OBSTACLE_TYPES[(Math.random() * OBSTACLE_TYPES.length) | 0];
  const el = document.createElement('div');
  el.className = 'obstacle ' + t.cls;
  el.textContent = t.e;
  entities.appendChild(el);
  const size = el.offsetWidth;
  obstacles.push({
    el, size, fly: t.fly,
    x: W + 80,
    y: t.fly ? GY - 130 - Math.random() * 55 : GY - size,
    wob: Math.random() * Math.PI * 2
  });
}
/* Stars sit in the single-jump arc; gems hover so high that only a
   DOUBLE jump reaches them — same array, one flag, no extra loop. */
function spawnPickup(gem) {
  const el = document.createElement('div');
  el.className = gem ? 'pickup pickup--gem' : 'pickup';
  el.textContent = gem ? '💎' : '⭐';
  entities.appendChild(el);
  const size = el.offsetWidth;
  pickups.push({
    el, size, gem,
    x: W + 50,
    y: gem ? GY - 300 - Math.random() * 70 : GY - 80 - Math.random() * 100,
    wob: 0
  });
}

/* ============================================================
   MAIN UPDATE
   ============================================================ */
function update() {
  frame++;
  speed = currentSpeed();
  if (invinc > 0) {
    invinc--;
    if (invinc === 0) playerEl.classList.remove('player--blink');
  }

  groundX += speed;
  sidewalkEl.style.backgroundPosition = (-groundX) + 'px 0, 0 0';
  cityX = (cityX + speed * 0.45) % stripW;
  cityStrip.style.transform = 'translate3d(' + (-cityX) + 'px,0,0)';

  vy += CONFIG.GRAVITY;
  py += vy;
  const groundTop = GY - PSIZE;
  if (py >= groundTop) {
    py = groundTop; vy = 0;
    if (jumping) {
      jumping = false; jumps = 0;
      setPose('run');
      playerEl.classList.remove('player--jumping');
    }
  }
  if (!jumping) runF++;

  if (frame % 130 === 0 && npcs.length < 6) spawnNPC();
  npcs = npcs.filter(n => {
    n.x += n.dir * n.sp - speed * 0.3;
    if (n.x < -80 || n.x > W + 80) { n.el.remove(); return false; }
    renderNPC(n, frame);
    return true;
  });

  spawnT++;
  const rate = Math.max(48, 105 - score * 0.1);
  if (spawnT >= rate) { spawnObstacle(); spawnT = 0; }
  if (frame % 100 === 0) spawnPickup(frame % 300 === 0);  /* every 3rd is a gem */

  const pcx = px + PSIZE / 2, pcy = py + PSIZE * 0.55, pr = PSIZE * 0.3;

  obstacles = obstacles.filter(o => {
    o.x -= speed;
    o.wob += o.fly ? 0.1 : 0.07;
    if (o.x < -110) { o.el.remove(); return false; }
    const bob = Math.sin(o.wob) * (o.fly ? 8 : 3);
    o.el.style.transform = 'translate3d(' + o.x + 'px,' + (o.y + bob) + 'px,0)';
    if (invinc === 0) {
      const ocx = o.x + o.size / 2, ocy = o.y + o.size / 2;
      const rr = pr + o.size * 0.34;
      const dx = ocx - pcx, dy = ocy - pcy;
      if (dx * dx + dy * dy < rr * rr) {
        lives--; invinc = 90;
        playerEl.classList.add('player--blink');
        sHit();
        burstFX(pcx, pcy, '#e53935');
        popupFX(pcx - 24, py - 34, 'OUCH!', '#c62828');
        o.el.remove();
        if (lives <= 0) gameOver();
        return false;
      }
    }
    return true;
  });

  pickups = pickups.filter(s => {
    s.x -= speed * 0.85;
    s.wob += 0.09;
    if (s.x < -70) { s.el.remove(); return false; }
    s.el.style.transform =
      'translate3d(' + s.x + 'px,' + (s.y + Math.sin(s.wob) * 5) + 'px,0)';
    const scx = s.x + s.size / 2, scy = s.y + s.size / 2;
    const rr = pr + s.size * 0.5;
    const dx = scx - pcx, dy = scy - pcy;
    if (dx * dx + dy * dy < rr * rr) {
      score += s.gem ? 40 : 15; sCoin();
      burstFX(scx, scy, s.gem ? '#4fc3f7' : '#ffb300');
      popupFX(scx - 16, scy - 24, s.gem ? '+40' : '+15', s.gem ? '#0277bd' : '#ef6c00');
      s.el.remove();
      return false;
    }
    return true;
  });

  if (frame % 15 === 0) score++;

  const bob = jumping ? 0 : Math.sin(runF * 0.3) * 3;
  playerEl.style.transform = 'translate3d(' + px + 'px,' + (py + bob) + 'px,0)';
  shadowEl.style.transform =
    'translate3d(' + (px + PSIZE * 0.19) + 'px,' + (GY + 4) + 'px,0)';

  $('hudScore').textContent = 'SCORE ' + pad(score);
  $('hudBest').textContent = 'BEST ' + pad(best);
  $('hudLives').textContent =
    '❤️'.repeat(Math.max(0, lives)) + '🤍'.repeat(Math.max(0, 3 - lives));
}

function gameOver() {
  best = Math.max(best, score);
  state = 'over';
  world.classList.add('zoom-mid');
  /* portrait = whoever they ran as: custom PNG or emoji hero */
  const c = $('overChar');
  if (usingCustom && customPNG) {
    c.innerHTML = '';
    const img = document.createElement('img');
    img.src = customPNG;
    c.appendChild(img);
  } else {
    c.textContent = CHARACTERS[charIndex].run;
  }
  $('overScore').textContent = pad(score);
  $('overBest').textContent = pad(best);
  $('overOverlay').hidden = false;
  sOver();
}

/* ---------- Idle render (intro / paused / over) ---------- */
function idleRender() {
  frame++;
  const bob = Math.sin(frame * 0.06) * 2.5;
  playerEl.style.transform = 'translate3d(' + px + 'px,' + (py + bob) + 'px,0)';
  shadowEl.style.transform =
    'translate3d(' + (px + PSIZE * 0.19) + 'px,' + (GY + 4) + 'px,0)';
  if (state === 'intro') {
    npcs.forEach(n => {
      n.x += n.dir * n.sp;
      if (n.x < -80) n.x = W + 60;
      if (n.x > W + 80) n.x = -60;
      renderNPC(n, frame);
    });
  }
}

function loop() {
  if (state === 'playing') update();
  else idleRender();
  requestAnimationFrame(loop);
}

/* ============================================================
   SETTINGS — pause, mute, theme, scenery
   All visuals are CSS classes; JS only toggles them.
   ============================================================ */
function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    $('pausePanel').hidden = false;
    $('pauseBtn').textContent = '▶';
  } else if (state === 'paused') {
    state = 'playing';
    $('pausePanel').hidden = true;
    $('pauseBtn').textContent = '⏸';
  }
}

/* Day / night: swap .theme-night on #game — CSS does the rest */
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('pointerdown', e => {
    e.stopPropagation();
    gameEl.classList.toggle('theme-night', btn.dataset.theme === 'night');
    document.querySelectorAll('.theme-btn').forEach(b =>
      b.classList.toggle('p-btn--active', b === btn));
  });
});

/* Scenery: swap .scene-* on #game — palettes handled by CSS variables */
document.querySelectorAll('.scene-btn').forEach(btn => {
  btn.addEventListener('pointerdown', e => {
    e.stopPropagation();
    gameEl.classList.remove('scene-desert', 'scene-snow');
    if (btn.dataset.scene !== 'city') gameEl.classList.add('scene-' + btn.dataset.scene);
    document.querySelectorAll('.scene-btn').forEach(b =>
      b.classList.toggle('p-btn--active', b === btn));
  });
});

/* ============================================================
   CHARACTER PICKERS — rendered on BOTH intro & pause screens
   ============================================================ */
function buildCharPickers() {
  ['introCharRow', 'pauseCharRow'].forEach(rowId => {
    const row = $(rowId);
    row.innerHTML = '';
    /* emoji heroes */
    CHARACTERS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'char-btn' +
        (!usingCustom && i === charIndex ? ' char-btn--active' : '');
      b.textContent = c.run;
      b.title = c.name;
      b.addEventListener('pointerdown', e => {
        e.stopPropagation();
        usingCustom = false;
        charIndex = i;
        applyCharacter();
      });
      row.appendChild(b);
    });
    /* custom PNG slot appears once an image is uploaded */
    if (customPNG) {
      const b = document.createElement('button');
      b.className = 'char-btn' + (usingCustom ? ' char-btn--active' : '');
      b.title = 'Your character';
      const img = document.createElement('img');
      img.src = customPNG;
      b.appendChild(img);
      b.addEventListener('pointerdown', e => {
        e.stopPropagation();
        usingCustom = true;
        applyCharacter();
      });
      row.appendChild(b);
    }
  });
}

/* ---------- Custom PNG upload (max 1 MB, PNG only, stays static) ---------- */
$('uploadBtn').addEventListener('pointerdown', e => {
  e.stopPropagation();
  $('pngInput').click();
});
$('pngInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'image/png') {
    alert('Please choose a PNG image.');
    e.target.value = '';
    return;
  }
  if (file.size > CONFIG.MAX_PNG_BYTES) {
    alert('That PNG is too big — the limit is 1 MB.');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    customPNG = ev.target.result;   /* data URL */
    usingCustom = true;
    applyCharacter();
  };
  reader.readAsDataURL(file);
});

/* ---------- Panel wiring ---------- */
$('pauseBtn').addEventListener('pointerdown', e => { e.stopPropagation(); togglePause(); });
$('resumeBtn').addEventListener('pointerdown', e => { e.stopPropagation(); togglePause(); });
$('muteBtn').addEventListener('pointerdown', e => {
  e.stopPropagation();
  muted = !muted;
  $('muteBtn').textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
});
$('pausePanel').addEventListener('pointerdown', e => e.stopPropagation());

/* ---------- Intro cast parade ---------- */
function buildParade() {
  const cast = ['🦆', '🌮', '🛒', '🧀', '🍕', '🐟', '⭐'];
  const parade = $('parade');
  cast.forEach((e, i) => {
    const s = document.createElement('span');
    s.textContent = e;
    s.style.position = 'absolute';
    s.style.fontSize = '34px';
    s.style.animation = 'parade ' + (9 + i * 1.3) + 's linear infinite';
    s.style.animationDelay = (-i * 2.2) + 's';
    parade.appendChild(s);
  });
  const style = document.createElement('style');
  style.textContent =
    '@keyframes parade { from { transform: translateX(-40px); }' +
    ' to { transform: translateX(110vw); } }';
  document.head.appendChild(style);
}

/* ---------- Input ---------- */
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
gameEl.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });

/* ---------- Boot ---------- */
measure();
buildCity();
buildParade();
buildCharPickers();
resetPlayer();
for (let i = 0; i < 3; i++) spawnNPC(Math.random() * W);
world.classList.add('zoom-in');
loop();
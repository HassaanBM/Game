'use strict';

/* ============================================================
   DODGE THE CHAOS — GAME LOGIC
   ------------------------------------------------------------
   The JS handles positions, physics, collisions and state.
   All appearance lives in the CSS above. JS reads element
   sizes FROM the DOM, so CSS edits propagate automatically.
   ============================================================ */

/* ---------- Tiny DOM helper ---------- */
const $ = id => document.getElementById(id);

const world = $('world'), game = $('game');
const playerEl = $('player'), shadowEl = $('playerShadow');
const entities = $('entities'), npcLayer = $('npcLayer');
const cityStrip = $('cityStrip'), sidewalkEl = $('sidewalk');

/* ============================================================
   CHARACTER ROSTER
   Each character has a matched run pose + standing jump pose
   (same skin tone). Add more entries to expand the roster —
   the picker builds itself from this array.
   ============================================================ */
const CHARACTERS = [
  { name: 'Sunny',  run: '🏃🏻‍➡️',   jump: '🧍🏻'   },   /* default yellow    */
  { name: 'Maya',   run: '🏃🏽‍♀️‍➡️', jump: '🧍🏽‍♀️' },   /* medium skin tone  */
  { name: 'Andre',  run: '🏃🏿‍➡️',  jump: '🧍🏿'  },   /* dark skin tone    */
];
let charIndex = 0;   /* currently selected character */

/* Apply a pose ('run' | 'jump') for the active character.
   The CSS ::before reads --player-emoji, so we just update the variable. */
function setPose(pose) {
  playerEl.style.setProperty('--player-emoji', '"' + CHARACTERS[charIndex][pose] + '"');
}

/* ---------- Responsive metrics ---------- */
let W = 0, H = 0, GY = 0, PSIZE = 86;
function measure() {
  W = window.innerWidth;
  H = window.innerHeight;
  /* ground line % comes from CSS so designers can move it */
  GY = H * (parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--ground-line')) / 100);
  PSIZE = playerEl.offsetWidth || 86;   /* hero size defined by CSS */
}
window.addEventListener('resize', () => { measure(); buildCity(); });
window.addEventListener('orientationchange',
  () => setTimeout(() => { measure(); buildCity(); }, 200));

/* ---------- Audio (tiny WebAudio synth, gated by mute) ---------- */
let AC = null, muted = false;
const audio = () => AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
function beep(f1, f2, type, vol, dur) {
  if (muted) return;                     /* master mute switch */
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
const sHit  = () => beep(380, 70, 'sawtooth', 0.15, 0.28);
const sCoin = () => beep(900, 1400, 'sine', 0.11, 0.18);
const sOver = () => beep(440, 110, 'square', 0.12, 0.5);
const sGo   = () => { beep(520, 780, 'sine', 0.1, 0.15);
                      setTimeout(() => beep(780, 1040, 'sine', 0.1, 0.2), 130); };

/* ---------- Seeded random (stable city layout) ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- City builder: DOM buildings with CSS classes ---------- */
const BLD_CLASSES = ['building--peach', 'building--mint', 'building--butter',
                     'building--lilac', 'building--rose', 'building--ice'];
let stripW = 0, cityX = 0;
function buildCity() {
  cityStrip.innerHTML = '';
  stripW = Math.max(1600, W * 2);
  /* two identical halves = seamless infinite scroll */
  for (let half = 0; half < 2; half++) {
    const rnd = mulberry32(4242);        /* same seed both halves */
    let x = half * stripW;
    while (x < (half + 1) * stripW - 60) {
      const w = 36 + rnd() * 100;
      const h = 50 + rnd() * 400;
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

/* ---------- NPCs: background city life ---------- */
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
/* shared renderer for an NPC (used by both game & idle loops) */
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
  { e: '🗑️', cls: 'obstacle--cart',  fly: false },
  { e: '📦', cls: 'obstacle--nacho', fly: false },
  { e: '🎳', cls: 'obstacle--bowl',  fly: false },
  { e: '🍕', cls: 'obstacle--pizza', fly: false },
  { e: '🌯', cls: 'obstacle--wrap',  fly: false },
  { e: '🦅', cls: 'obstacle--fish',  fly: true  },
  { e: '🐟', cls: 'obstacle--fish',  fly: true  },
  { e: '🥤', cls: 'obstacle--drink', fly: true  },
];

/* ---------- Game state ---------- */
let state = 'intro';                    /* intro | playing | paused | over */
let obstacles = [], pickups = [];
let px = 0, py = 0, vy = 0, jumping = false, runF = 0;
let score = 0, best = 0, lives = 3, frame = 0, speed = 5, spawnT = 0, invinc = 0;
let groundX = 0;                        /* sidewalk scroll offset */

/* Physics tuned for the bigger hero:
   jump height ≈ JUMP_V² / (2 × GRAVITY) ≈ 170px — clears the tallest cart */
const JUMP_V = -20;
const GRAVITY = 0.84;

function pad(n) { return String(Math.floor(n)).padStart(5, '0'); }

function resetPlayer() {
  px = W * 0.18;
  py = GY - PSIZE;
  vy = 0; jumping = false; runF = 0;
  setPose('run');
}

/* ---------- Start / restart ---------- */
function init() {
  /* clear leftover entities from the previous run */
  obstacles.forEach(o => o.el.remove());
  pickups.forEach(p => p.el.remove());
  obstacles = []; pickups = [];
  score = 0; lives = 3; frame = 0; speed = 5; spawnT = 60; invinc = 0;
  playerEl.classList.remove('player--blink');
  resetPlayer();
  state = 'playing';
  $('introOverlay').hidden = true;
  $('overOverlay').hidden = true;
  $('parade').hidden = true;
  world.classList.remove('zoom-in', 'zoom-mid');   /* cinematic zoom-out */
  sGo();
}

/* ---------- Jump (also acts as start/retry) ---------- */
function jump() {
  if (state === 'paused') return;          /* ignore while paused */
  if (state !== 'playing') { init(); return; }
  if (!jumping) {
    vy = JUMP_V;
    jumping = true;
    setPose('jump');                       /* swap to standing pose mid-air */
    playerEl.classList.add('player--jumping');
    sJump();
    burstFX(px + PSIZE / 2, GY, '#ff8a65');
  }
}

/* ---------- Visual FX helpers ---------- */
function burstFX(x, y, color) {
  for (let i = 0; i < 7; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.background = color;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    /* each particle gets its own random flight vector via CSS vars */
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
  const size = el.offsetWidth;             /* actual size from CSS */
  obstacles.push({
    el, size, fly: t.fly,
    x: W + 80,
    /* flyers hover in the jump arc; grounders sit on the sidewalk */
    y: t.fly ? GY - 130 - Math.random() * 55 : GY - size,
    wob: Math.random() * Math.PI * 2
  });
}
function spawnPickup() {
  const el = document.createElement('div');
  el.className = 'pickup';
  el.textContent = '⭐';
  entities.appendChild(el);
  const size = el.offsetWidth;
  pickups.push({ el, size, x: W + 50, y: GY - 80 - Math.random() * 100, wob: 0 });
}

/* ============================================================
   MAIN UPDATE (runs each frame while playing)
   ============================================================ */
function update() {
  frame++;
  speed = (5 + score * 0.005) * (W / 900 + 0.4);   /* ramp with score & screen */
  if (invinc > 0) {
    invinc--;
    if (invinc === 0) playerEl.classList.remove('player--blink');
  }

  /* --- scroll ground & city (background-position / transform = GPU-cheap) --- */
  groundX += speed;
  sidewalkEl.style.backgroundPosition = (-groundX) + 'px 0, 0 0';
  cityX = (cityX + speed * 0.45) % stripW;         /* city at 45% = parallax */
  cityStrip.style.transform = 'translate3d(' + (-cityX) + 'px,0,0)';

  /* --- player physics --- */
  vy += GRAVITY;
  py += vy;
  const groundTop = GY - PSIZE;
  if (py >= groundTop) {                            /* landed */
    py = groundTop; vy = 0;
    if (jumping) {
      jumping = false;
      setPose('run');                               /* back to running pose */
      playerEl.classList.remove('player--jumping');
    }
  }
  if (!jumping) runF++;

  /* --- NPC background life --- */
  if (frame % 130 === 0 && npcs.length < 6) spawnNPC();
  npcs = npcs.filter(n => {
    n.x += n.dir * n.sp - speed * 0.3;              /* stroll + world drift */
    if (n.x < -80 || n.x > W + 80) { n.el.remove(); return false; }
    renderNPC(n, frame);
    return true;
  });

  /* --- spawning: obstacles get denser as score climbs --- */
  spawnT++;
  const rate = Math.max(48, 105 - score * 0.1);
  if (spawnT >= rate) { spawnObstacle(); spawnT = 0; }
  if (frame % 100 === 0) spawnPickup();

  /* --- player collision circle (forgiving hitbox) --- */
  const pcx = px + PSIZE / 2, pcy = py + PSIZE * 0.55, pr = PSIZE * 0.3;

  /* --- obstacles: move, draw, collide --- */
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
      if (dx * dx + dy * dy < rr * rr) {            /* hit! */
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

  /* --- pickups: move, draw, collect --- */
  pickups = pickups.filter(s => {
    s.x -= speed * 0.85;
    s.wob += 0.09;
    if (s.x < -70) { s.el.remove(); return false; }
    s.el.style.transform =
      'translate3d(' + s.x + 'px,' + (s.y + Math.sin(s.wob) * 5) + 'px,0)';
    const scx = s.x + s.size / 2, scy = s.y + s.size / 2;
    const rr = pr + s.size * 0.5;
    const dx = scx - pcx, dy = scy - pcy;
    if (dx * dx + dy * dy < rr * rr) {              /* collected! */
      score += 15; sCoin();
      burstFX(scx, scy, '#ffb300');
      popupFX(scx - 16, scy - 24, '+15', '#ef6c00');
      s.el.remove();
      return false;
    }
    return true;
  });

  if (frame % 15 === 0) score++;                    /* survival score */

  /* --- render player + shadow --- */
  const bob = jumping ? 0 : Math.sin(runF * 0.3) * 3;
  playerEl.style.transform = 'translate3d(' + px + 'px,' + (py + bob) + 'px,0)';
  shadowEl.style.transform =
    'translate3d(' + (px + PSIZE * 0.19) + 'px,' + (GY + 4) + 'px,0)';

  /* --- HUD --- */
  $('hudScore').textContent = 'SCORE ' + pad(score);
  $('hudBest').textContent = 'BEST ' + pad(best);
  $('hudLives').textContent =
    '❤️'.repeat(Math.max(0, lives)) + '🤍'.repeat(Math.max(0, 3 - lives));
}

function gameOver() {
  best = Math.max(best, score);
  state = 'over';
  world.classList.add('zoom-mid');                  /* dramatic push-in */
  $('overStats').textContent = 'Score ' + pad(score) + ' · Best ' + pad(best);
  $('overOverlay').hidden = false;
  sOver();
}

/* ---------- Idle render: intro & pause (hero bobs, NPCs wander) ---------- */
function idleRender() {
  frame++;
  const bob = Math.sin(frame * 0.06) * 2.5;
  playerEl.style.transform = 'translate3d(' + px + 'px,' + (py + bob) + 'px,0)';
  shadowEl.style.transform =
    'translate3d(' + (px + PSIZE * 0.19) + 'px,' + (GY + 4) + 'px,0)';
  if (state === 'intro') {                          /* NPCs only wander on intro */
    npcs.forEach(n => {
      n.x += n.dir * n.sp;
      if (n.x < -80) n.x = W + 60;
      if (n.x > W + 80) n.x = -60;
      renderNPC(n, frame);
    });
  }
}

/* ---------- Main loop ---------- */
function loop() {
  if (state === 'playing') update();
  else idleRender();                                /* intro / paused / over */
  requestAnimationFrame(loop);
}

/* ============================================================
   PAUSE PANEL — resume, mute, character picker
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
  /* on intro/over screens the button does nothing */
}

/* Build the character picker buttons from the CHARACTERS roster */
function buildCharPicker() {
  const row = $('charRow');
  row.innerHTML = '';
  CHARACTERS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'char-btn' + (i === charIndex ? ' char-btn--active' : '');
    b.textContent = c.run;
    b.title = c.name;
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();                          /* don't trigger a jump */
      charIndex = i;
      setPose(jumping ? 'jump' : 'run');            /* apply immediately */
      buildCharPicker();                            /* refresh active ring */
    });
    row.appendChild(b);
  });
}

/* Pause button */
$('pauseBtn').addEventListener('pointerdown', e => {
  e.stopPropagation();
  togglePause();
});
/* Resume button inside the panel */
$('resumeBtn').addEventListener('pointerdown', e => {
  e.stopPropagation();
  togglePause();
});
/* Mute toggle */
$('muteBtn').addEventListener('pointerdown', e => {
  e.stopPropagation();
  muted = !muted;
  $('muteBtn').textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
});
/* Clicks inside the panel never fall through to the game */
$('pausePanel').addEventListener('pointerdown', e => e.stopPropagation());

/* ---------- Intro cast parade ---------- */
function buildParade() {
  const cast = ['🦆', '🌮', '🛒', '🧀', '🍕', '🐟', '⭐'];
  const parade = $('parade');
  cast.forEach((e, i) => {
    const s = document.createElement('span');
    s.textContent = e;
    s.style.position = 'absolute';
    s.style.fontSize = '40px';
    s.style.animation = 'parade ' + (9 + i * 1.2) + 's linear infinite';
    s.style.animationDelay = (-i * 2.2) + 's';
    parade.appendChild(s);
  });
  /* parade keyframes are injected here so they live near their usage */
  const style = document.createElement('style');
  style.textContent =
    '@keyframes parade { from { transform: translateX(-40px); }' +
    ' to { transform: translateX(110vw); } }';
  document.head.appendChild(style);
}

/* ---------- Game input (jump / start) ---------- */
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();   /* P / Esc pause */
});
game.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });

/* ---------- Boot ---------- */
measure();
buildCity();
buildParade();
buildCharPicker();
resetPlayer();
for (let i = 0; i < 3; i++) spawnNPC(Math.random() * W);
world.classList.add('zoom-in');       /* intro starts zoomed into the hero */
loop();
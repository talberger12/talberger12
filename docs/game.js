(() => {
  'use strict';

  // ---------- constants ----------
  const COLORS = ['#161b22', '#3b0764', '#6d28d9', '#a855f7', '#e9d5ff'];
  const POINTS = [0, 10, 20, 30, 50];
  const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  const BEST_KEY = 'snake-best-talberger12';
  const BASE_TICK = 130;
  const MIN_TICK = 62;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const card = $('board-card');
  const ui = {
    score: $('score'), best: $('best'), length: $('length'), eaten: $('eaten'), total: $('total'),
    overlay: $('overlay'), oEmoji: $('overlay-emoji'), oTitle: $('overlay-title'), oText: $('overlay-text'),
    startBtn: $('start-btn'), pauseBtn: $('pause-btn'), restartBtn: $('restart-btn'), soundBtn: $('sound-btn'),
    toast: $('toast'), tip: $('tip'),
  };

  // ---------- state ----------
  let weeks = [];
  let portrait = false;
  const L = { cols: 0, rows: 0, cell: 0, gap: 0, padL: 0, padT: 0, w: 0, h: 0 };
  let grid = [];
  let snake = [], prevSnake = [], dir = { x: 1, y: 0 }, queue = [];
  let growth = 0, score = 0, eatenGraph = 0, totalFood = 0, foodLeft = 0;
  let tick = BASE_TICK, lastTick = 0, lastP = 1, endless = false;
  let state = 'ready'; // ready | playing | paused | over
  let best = 0;
  let particles = [], floaters = [], shake = 0;
  let soundOn = true, audio = null;

  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) { /* storage blocked */ }

  // ---------- data ----------
  async function loadData() {
    try {
      const res = await fetch('contributions.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const cal = json.data.user.contributionsCollection.contributionCalendar;
      weeks = cal.weeks.map((w) => {
        const days = new Array(7).fill(null);
        w.contributionDays.forEach((d) => {
          const wd = typeof d.weekday === 'number' ? d.weekday : new Date(d.date + 'T00:00:00Z').getUTCDay();
          days[wd] = { date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 };
        });
        return days;
      });
      ui.total.textContent = cal.totalContributions;
    } catch (_) {
      // Fallback: a random graph so the game always works.
      weeks = Array.from({ length: 53 }, () =>
        Array.from({ length: 7 }, () => ({
          date: null, count: 0,
          level: Math.random() < 0.15 ? 1 + Math.floor(Math.random() * 4) : 0,
        })));
      ui.total.textContent = '—';
    }
  }

  // ---------- layout ----------
  const isPortrait = () => window.innerWidth < 640 && window.innerHeight > window.innerWidth;

  function layout() {
    const W = weeks.length, H = 7;
    L.cols = portrait ? H : W;
    L.rows = portrait ? W : H;
    L.padL = portrait ? 0 : 30;
    L.padT = portrait ? 0 : 20;
    const cs = getComputedStyle(card);
    const availW = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let size = Math.floor((availW - L.padL) / L.cols);
    if (portrait) size = Math.min(size, Math.floor((window.innerHeight * 0.6) / L.rows));
    size = Math.max(8, Math.min(size, 34));
    L.cell = size;
    L.gap = Math.max(2, Math.round(size * 0.18));
    L.w = L.padL + L.cols * size;
    L.h = L.padT + L.rows * size;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(L.w * dpr);
    canvas.height = Math.round(L.h * dpr);
    canvas.style.width = L.w + 'px';
    canvas.style.height = L.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const dayAt = (x, y) => (portrait ? weeks[y]?.[x] : weeks[x]?.[y]);

  function buildBoard() {
    grid = [];
    totalFood = 0;
    for (let y = 0; y < L.rows; y++) {
      const row = [];
      for (let x = 0; x < L.cols; x++) {
        const d = dayAt(x, y);
        const level = d ? d.level : 0;
        if (level > 0) totalFood++;
        row.push({ exists: !!d, level, date: d?.date || null, count: d?.count || 0, spawned: 0 });
      }
      grid.push(row);
    }
    foodLeft = totalFood;
  }

  // ---------- game flow ----------
  function reset() {
    buildBoard();
    const len = 4;
    if (portrait) {
      dir = { x: 0, y: 1 };
      snake = Array.from({ length: len }, (_, i) => ({ x: 3, y: len - i }));
    } else {
      dir = { x: 1, y: 0 };
      snake = Array.from({ length: len }, (_, i) => ({ x: len - i, y: 3 }));
    }
    prevSnake = snake.map((s) => ({ ...s }));
    queue = [];
    growth = 0; score = 0; eatenGraph = 0;
    tick = BASE_TICK; lastP = 1; endless = false;
    particles = []; floaters = [];
    if (totalFood === 0) { endless = true; spawnFood(3); }
    updateHud();
  }

  function spawnFood(n) {
    const free = [];
    for (let y = 0; y < L.rows; y++) {
      for (let x = 0; x < L.cols; x++) {
        const c = grid[y][x];
        if (c.exists && c.level === 0 && !snake.some((s) => s.x === x && s.y === y)) free.push(c);
      }
    }
    for (let i = 0; i < n && free.length; i++) {
      const c = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      const r = Math.random();
      c.level = r < 0.4 ? 1 : r < 0.7 ? 2 : r < 0.9 ? 3 : 4;
      c.spawned = performance.now();
      foodLeft++;
    }
  }

  function enqueue(x, y) {
    const last = queue.length ? queue[queue.length - 1] : dir;
    if ((x === -last.x && y === -last.y) || (x === last.x && y === last.y)) return;
    if (queue.length < 3) queue.push({ x, y });
  }

  function step() {
    if (queue.length) dir = queue.shift();
    const head = snake[0];
    const nx = (head.x + dir.x + L.cols) % L.cols;
    const ny = (head.y + dir.y + L.rows) % L.rows;
    const body = growth > 0 ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === nx && s.y === ny)) { gameOver(); return; }
    prevSnake = snake.map((s) => ({ ...s }));
    snake.unshift({ x: nx, y: ny });
    if (growth > 0) growth--; else snake.pop();
    const c = grid[ny][nx];
    if (c.level > 0) eat(c, nx, ny);
  }

  function cellCenter(x, y) {
    const s = L.cell - L.gap;
    return { cx: L.padL + x * L.cell + s / 2, cy: L.padT + y * L.cell + s / 2 };
  }

  function eat(c, x, y) {
    const lvl = c.level;
    const pts = POINTS[lvl];
    score += pts;
    growth += 1;
    foodLeft--;
    if (!c.spawned) eatenGraph++;
    c.level = 0;
    c.spawned = 0;
    tick = Math.max(MIN_TICK, tick - 2);

    const { cx, cy } = cellCenter(x, y);
    burst(cx, cy, lvl < 2 ? '#a855f7' : COLORS[lvl], 10 + lvl * 4);
    floaters.push({ x: cx, y: cy, text: '+' + pts, life: 1, color: lvl >= 3 ? COLORS[lvl] : '#c084fc' });
    if (lvl === 4) shake = 6;
    beep(320 + lvl * 120, 0.08, 'square');
    bump(ui.score);

    if (!endless && foodLeft === 0) {
      endless = true;
      toast('🎉 All commits eaten! Endless mode unlocked');
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle'), i * 90));
      spawnFood(3);
    } else if (endless && foodLeft < 3) {
      spawnFood(3 - foodLeft);
    }
    updateHud();
  }

  function gameOver() {
    state = 'over';
    shake = 12;
    const { cx, cy } = cellCenter(snake[0].x, snake[0].y);
    burst(cx, cy, '#ec4899', 30);
    beep(180, 0.25, 'sawtooth');
    setTimeout(() => beep(110, 0.35, 'sawtooth'), 120);
    const isBest = score > best && score > 0;
    if (isBest) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) { /* ignore */ }
    }
    updateHud();
    showOverlay(
      isBest ? '🏆' : '💀',
      isBest ? 'New high score!' : 'Game over',
      `You scored <b>${score}</b> and grew to <b>${snake.length}</b> squares.`,
      'Play again'
    );
    ui.pauseBtn.textContent = 'Pause';
  }

  function start() {
    ensureAudio();
    if (state === 'playing') return;
    if (state === 'over') reset();
    state = 'playing';
    hideOverlay();
    hideTip();
    lastTick = performance.now();
    ui.pauseBtn.textContent = 'Pause';
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    showOverlay('⏸️', 'Paused', 'Press <kbd>Space</kbd> or tap to resume', 'Resume');
    ui.pauseBtn.textContent = 'Resume';
  }

  function restart() {
    reset();
    state = 'ready';
    start();
  }

  // ---------- UI helpers ----------
  function updateHud() {
    ui.score.textContent = score;
    ui.best.textContent = Math.max(best, score);
    ui.length.textContent = snake.length;
    ui.eaten.textContent = `${eatenGraph}/${totalFood}`;
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function showOverlay(emoji, title, html, btn) {
    ui.oEmoji.textContent = emoji;
    ui.oTitle.textContent = title;
    ui.oText.innerHTML = html;
    ui.startBtn.textContent = btn;
    const panel = ui.overlay.querySelector('.panel');
    panel.style.animation = 'none';
    void panel.offsetWidth;
    panel.style.animation = '';
    ui.overlay.classList.remove('hidden');
  }
  const hideOverlay = () => ui.overlay.classList.add('hidden');

  let toastTimer;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800);
  }

  // ---------- audio ----------
  function ensureAudio() {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audio = null; }
    }
    if (audio && audio.state === 'suspended') audio.resume();
  }

  function beep(freq, dur, type = 'sine', vol = 0.035) {
    if (!soundOn || !audio) return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  }

  function toggleSound() {
    soundOn = !soundOn;
    ui.soundBtn.textContent = soundOn ? '🔊' : '🔇';
  }

  // ---------- effects ----------
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.6;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color, size: 1.5 + Math.random() * 2.5 });
    }
  }

  // ---------- rendering ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
    const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
    const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
    return `rgb(${r},${g},${bl})`;
  }

  function easeOutBack(a) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(a - 1, 3) + c1 * Math.pow(a - 1, 2);
  }

  function drawLabels() {
    if (portrait) return;
    const s = L.cell - L.gap;
    ctx.fillStyle = '#8b949e';
    ctx.font = `500 ${Math.max(9, Math.min(12, Math.round(L.cell * 0.55)))}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let lastMonth = -1, lastX = -Infinity;
    weeks.forEach((w, i) => {
      const d = w.find(Boolean);
      if (!d || !d.date) return;
      const m = Number(d.date.slice(5, 7)) - 1;
      const x = L.padL + i * L.cell;
      if (m !== lastMonth) {
        if (x - lastX >= L.cell * 3 && i < weeks.length - 2) {
          ctx.fillText(MONTHS[m], x, L.padT - 7);
          lastX = x;
        }
        lastMonth = m;
      }
    });
    DAYS.forEach((label, d) => {
      if (label) ctx.fillText(label, 0, L.padT + d * L.cell + s * 0.82);
    });
  }

  function drawGrid(t) {
    const s = L.cell - L.gap;
    const r = Math.max(2, s * 0.22);
    for (let y = 0; y < L.rows; y++) {
      for (let x = 0; x < L.cols; x++) {
        const c = grid[y][x];
        const px = L.padL + x * L.cell, py = L.padT + y * L.cell;
        if (c.level > 0) {
          const pulse = 0.5 + 0.5 * Math.sin(t / 350 + (x + y) * 0.6);
          let scale = 1;
          if (c.spawned) scale = Math.max(0, easeOutBack(Math.min(1, (t - c.spawned) / 350)));
          const sz = s * scale, off = (s - sz) / 2;
          ctx.shadowColor = COLORS[Math.max(2, c.level)];
          ctx.shadowBlur = 4 + pulse * 12;
          ctx.fillStyle = COLORS[c.level];
          rr(px + off, py + off, sz, sz, r);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.globalAlpha = c.exists ? 1 : 0.3;
          ctx.fillStyle = COLORS[0];
          rr(px, py, s, s, r);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawSnake(p) {
    const n = snake.length;
    const s = L.cell - L.gap;
    let head = null;
    for (let i = n - 1; i >= 0; i--) {
      const to = snake[i];
      const from = prevSnake[i] || to;
      let x = to.x, y = to.y;
      if (Math.abs(to.x - from.x) <= 1 && Math.abs(to.y - from.y) <= 1) {
        x = from.x + (to.x - from.x) * p;
        y = from.y + (to.y - from.y) * p;
      }
      const k = n > 1 ? i / (n - 1) : 0;
      const size = s * (i === 0 ? 1.1 : 1 - 0.3 * k);
      const px = L.padL + x * L.cell + (s - size) / 2;
      const py = L.padT + y * L.cell + (s - size) / 2;
      ctx.fillStyle = i === 0 ? '#f5f3ff' : mix('#c084fc', '#5b21b6', k);
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = i === 0 ? 18 : 6;
      rr(px, py, size, size, Math.max(2, size * 0.32));
      ctx.fill();
      if (i === 0) head = { cx: px + size / 2, cy: py + size / 2, size };
    }
    ctx.shadowBlur = 0;
    if (head) {
      const f = dir, perp = { x: -dir.y, y: dir.x };
      const er = Math.max(1.2, head.size * 0.11);
      ctx.fillStyle = '#1a0b2e';
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.arc(
          head.cx + f.x * head.size * 0.18 + perp.x * head.size * 0.22 * side,
          head.cy + f.y * head.size * 0.18 + perp.y * head.size * 0.22 * side,
          er, 0, Math.PI * 2
        );
        ctx.fill();
      });
    }
  }

  function drawEffects() {
    particles = particles.filter((pt) => pt.life > 0);
    particles.forEach((pt) => {
      pt.x += pt.vx; pt.y += pt.vy;
      pt.vx *= 0.94; pt.vy *= 0.94;
      pt.life -= 0.025;
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    });
    floaters = floaters.filter((f) => f.life > 0);
    ctx.font = `700 ${Math.max(11, Math.round(L.cell * 0.6))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    floaters.forEach((f) => {
      f.y -= 0.6;
      f.life -= 0.02;
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - L.cell * 0.4);
    });
    ctx.globalAlpha = 1;
  }

  function render(t, p) {
    ctx.save();
    ctx.clearRect(-20, -20, L.w + 40, L.h + 40);
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= 0.88;
      if (shake < 0.3) shake = 0;
    }
    drawLabels();
    drawGrid(t);
    drawSnake(p);
    drawEffects();
    ctx.restore();
  }

  function frame(t) {
    if (state === 'playing') {
      let steps = 0;
      while (state === 'playing' && t - lastTick >= tick && steps < 3) {
        lastTick += tick;
        step();
        steps++;
      }
      if (t - lastTick > tick * 3) lastTick = t;
      lastP = Math.min(1, Math.max(0, (t - lastTick) / tick));
    }
    render(t, lastP);
    requestAnimationFrame(frame);
  }

  // ---------- tooltip ----------
  function hideTip() { ui.tip.classList.remove('show'); }

  canvas.addEventListener('mousemove', (e) => {
    if (state === 'playing') return hideTip();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - L.padL, my = e.clientY - rect.top - L.padT;
    const x = Math.floor(mx / L.cell), y = Math.floor(my / L.cell);
    const c = grid[y]?.[x];
    if (!c || !c.exists || !c.date) return hideTip();
    const date = new Date(c.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    ui.tip.textContent = `${c.count || 'No'} contribution${c.count === 1 ? '' : 's'} on ${date}`;
    const cardRect = card.getBoundingClientRect();
    ui.tip.style.left = (rect.left - cardRect.left + L.padL + x * L.cell + L.cell / 2) + 'px';
    ui.tip.style.top = (rect.top - cardRect.top + L.padT + y * L.cell) + 'px';
    ui.tip.classList.add('show');
  });
  canvas.addEventListener('mouseleave', hideTip);

  // ---------- input ----------
  const KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };

  window.addEventListener('keydown', (e) => {
    const k = KEYS[e.code];
    if (k) {
      e.preventDefault();
      enqueue(k[0], k[1]);
      if (state === 'ready' || state === 'paused') start();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (state === 'playing') pause(); else start();
    } else if (e.code === 'KeyR') {
      restart();
    } else if (e.code === 'KeyM') {
      toggleSound();
    }
  });

  let touch = null;
  card.addEventListener('touchstart', (e) => {
    const t0 = e.touches[0];
    touch = { x: t0.clientX, y: t0.clientY };
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t1 = e.changedTouches[0];
    const dx = t1.clientX - touch.x, dy = t1.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return; // taps handled by click
    if (Math.abs(dx) > Math.abs(dy)) enqueue(Math.sign(dx), 0); else enqueue(0, Math.sign(dy));
    if (state === 'ready' || state === 'paused') start();
  });

  document.querySelectorAll('.dpad button').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const [x, y] = b.dataset.dir.split(',').map(Number);
      enqueue(x, y);
      if (state === 'ready' || state === 'paused') start();
    });
  });

  ui.overlay.addEventListener('click', start);
  ui.pauseBtn.addEventListener('click', () => (state === 'playing' ? pause() : start()));
  ui.restartBtn.addEventListener('click', restart);
  ui.soundBtn.addEventListener('click', toggleSound);
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => b.blur()));

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = isPortrait();
      if (next === portrait) { layout(); return; }
      if (state === 'ready' || state === 'over') {
        portrait = next;
        layout();
        reset();
        state = 'ready';
      }
    }, 150);
  });

  // ---------- boot ----------
  async function init() {
    ui.best.textContent = best;
    await loadData();
    portrait = isPortrait();
    layout();
    reset();
    requestAnimationFrame(frame);
  }

  init();
})();

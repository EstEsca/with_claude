'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const COLS = 10;
const ROWS = 20;
const CELL = (() => {
  // Dynamically compute cell size to fit the viewport
  const maxH = window.innerHeight * 0.55;
  const maxW = window.innerWidth * 0.52;
  return Math.floor(Math.min(maxH / ROWS, maxW / COLS, 30));
})();
const MINI_CELL = Math.max(Math.floor(CELL * 0.6), 14);

const COLORS = {
  I: '#00cfcf',
  O: '#f5c518',
  T: '#a64dff',
  S: '#39d353',
  Z: '#ff4c4c',
  J: '#4c7cff',
  L: '#ff9f43',
  ghost: 'rgba(255,255,255,0.12)',
  grid:  'rgba(255,255,255,0.04)',
};

const PIECES = {
  I: { shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], color: 'I' },
  O: { shape: [[1,1],[1,1]], color: 'O' },
  T: { shape: [[0,1,0],[1,1,1],[0,0,0]], color: 'T' },
  S: { shape: [[0,1,1],[1,1,0],[0,0,0]], color: 'S' },
  Z: { shape: [[1,1,0],[0,1,1],[0,0,0]], color: 'Z' },
  J: { shape: [[1,0,0],[1,1,1],[0,0,0]], color: 'J' },
  L: { shape: [[0,0,1],[1,1,1],[0,0,0]], color: 'L' },
};

const PIECE_KEYS = Object.keys(PIECES);

const SCORE_TABLE = { 1: 100, 2: 300, 3: 500, 4: 800 };
const LEVEL_SPEEDS = [800, 720, 630, 550, 470, 380, 300, 220, 130, 100, 80];

// ── Utilities ─────────────────────────────────────────────────────────────

function randomPiece() {
  const key = PIECE_KEYS[Math.floor(Math.random() * PIECE_KEYS.length)];
  return JSON.parse(JSON.stringify(PIECES[key]));
}

function rotateCW(matrix) {
  const n = matrix.length;
  return matrix[0].map((_, c) => matrix.map((row) => row[c]).reverse());
}

function rotateCCW(matrix) {
  const n = matrix.length;
  return matrix[0].map((_, c) => matrix.map((row) => row[n - 1 - c]));
}

// ── Canvas setup ──────────────────────────────────────────────────────────

const boardCanvas = document.getElementById('board');
const ctx = boardCanvas.getContext('2d');
boardCanvas.width  = COLS * CELL;
boardCanvas.height = ROWS * CELL;

const nextCanvas = document.getElementById('next-canvas');
const nCtx = nextCanvas.getContext('2d');
nextCanvas.width  = 4 * MINI_CELL;
nextCanvas.height = 4 * MINI_CELL;

const holdCanvas = document.getElementById('hold-canvas');
const hCtx = holdCanvas.getContext('2d');
holdCanvas.width  = 4 * MINI_CELL;
holdCanvas.height = 4 * MINI_CELL;

// ── Game State ────────────────────────────────────────────────────────────

let board, current, next, hold;
let score, level, lines;
let holdUsed, gameOver, paused;
let dropTimer, dropInterval;
let animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function spawnPiece() {
  current = next;
  next = randomPiece();
  current.x = Math.floor((COLS - current.shape[0].length) / 2);
  current.y = current.color === 'I' ? -1 : 0;
  holdUsed = false;

  if (!isValid(current.shape, current.x, current.y)) {
    endGame();
  }
}

function isValid(shape, px, py) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = px + c;
      const ny = py + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
      if (ny >= 0 && board[ny][nx]) return false;
    }
  }
  return true;
}

function ghostY() {
  let gy = current.y;
  while (isValid(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function lockPiece() {
  for (let r = 0; r < current.shape.length; r++) {
    for (let c = 0; c < current.shape[r].length; c++) {
      if (!current.shape[r][c]) continue;
      const ny = current.y + r;
      const nx = current.x + c;
      if (ny < 0) { endGame(); return; }
      board[ny][nx] = current.color;
    }
  }
  clearLines();
  spawnPiece();
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every((c) => c !== null)) {
      board.splice(r, 1);
      board.unshift(Array(COLS).fill(null));
      cleared++;
      r++;
    }
  }
  if (cleared > 0) {
    const pts = (SCORE_TABLE[cleared] || 0) * level;
    score += pts;
    lines += cleared;
    const newLevel = Math.floor(lines / 10) + 1;
    if (newLevel !== level) {
      level = newLevel;
      resetDropTimer();
    }
    updateUI();
    flashScore();
  }
}

// ── Movement ──────────────────────────────────────────────────────────────

function moveLeft()   { if (isValid(current.shape, current.x - 1, current.y)) current.x--; }
function moveRight()  { if (isValid(current.shape, current.x + 1, current.y)) current.x++; }
function softDrop()   {
  if (isValid(current.shape, current.x, current.y + 1)) {
    current.y++;
    score++;
    updateUI();
  } else {
    lockPiece();
  }
  resetDropTimer();
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  updateUI();
  lockPiece();
  resetDropTimer();
}

function rotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const k of kicks) {
    if (isValid(rotated, current.x + k, current.y)) {
      current.shape = rotated;
      current.x += k;
      return;
    }
  }
}

function holdPiece() {
  if (holdUsed) return;
  holdUsed = true;
  if (hold) {
    const tmp = hold;
    hold = { shape: JSON.parse(JSON.stringify(PIECES[current.color].shape)), color: current.color };
    current = tmp;
    current.x = Math.floor((COLS - current.shape[0].length) / 2);
    current.y = 0;
  } else {
    hold = { shape: JSON.parse(JSON.stringify(PIECES[current.color].shape)), color: current.color };
    spawnPiece();
  }
}

// ── Drop timer ────────────────────────────────────────────────────────────

function getSpeed() {
  const idx = Math.min(level - 1, LEVEL_SPEEDS.length - 1);
  return LEVEL_SPEEDS[idx];
}

function resetDropTimer() {
  clearInterval(dropTimer);
  dropInterval = getSpeed();
  dropTimer = setInterval(tick, dropInterval);
}

function tick() {
  if (paused || gameOver) return;
  if (isValid(current.shape, current.x, current.y + 1)) {
    current.y++;
  } else {
    lockPiece();
  }
  render();
}

// ── Render ────────────────────────────────────────────────────────────────

function drawCell(context, x, y, color, size) {
  if (!color) return;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);

  // Highlight
  context.fillStyle = 'rgba(255,255,255,0.18)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.fillRect(x * size + 1, y * size + 1, 4, size - 2);
}

function drawGrid() {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL);
    ctx.lineTo(COLS * CELL, r * CELL);
    ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, ROWS * CELL);
    ctx.stroke();
  }
}

function render() {
  ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  drawGrid();

  // Board
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawCell(ctx, c, r, COLORS[board[r][c]], CELL);
    }
  }

  if (current && !gameOver) {
    // Ghost
    const gy = ghostY();
    for (let r = 0; r < current.shape.length; r++) {
      for (let c = 0; c < current.shape[r].length; c++) {
        if (current.shape[r][c]) {
          drawCell(ctx, current.x + c, gy + r, COLORS.ghost, CELL);
        }
      }
    }
    // Current piece
    for (let r = 0; r < current.shape.length; r++) {
      for (let c = 0; c < current.shape[r].length; c++) {
        if (current.shape[r][c]) {
          drawCell(ctx, current.x + c, current.y + r, COLORS[current.color], CELL);
        }
      }
    }
  }

  renderMini(nCtx, next);
  renderMini(hCtx, hold);
}

function renderMini(context, piece) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (!piece) return;
  const offX = Math.floor((4 - piece.shape[0].length) / 2);
  const offY = Math.floor((4 - piece.shape.length) / 2);
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c]) {
        drawCell(context, offX + c, offY + r, COLORS[piece.color], MINI_CELL);
      }
    }
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const overlay  = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg   = document.getElementById('overlay-msg');
const overlayBtn   = document.getElementById('overlay-btn');

function updateUI() {
  scoreEl.textContent = score.toLocaleString();
  levelEl.textContent = level;
  linesEl.textContent = lines;
}

function flashScore() {
  scoreEl.classList.remove('score-flash');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('score-flash');
}

function showOverlay(title, msg, btn) {
  overlayTitle.textContent = title;
  overlayMsg.textContent   = msg;
  overlayBtn.textContent   = btn;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ── Game lifecycle ────────────────────────────────────────────────────────

function initGame() {
  board      = createBoard();
  score      = 0;
  level      = 1;
  lines      = 0;
  hold       = null;
  holdUsed   = false;
  gameOver   = false;
  paused     = false;
  next       = randomPiece();
  spawnPiece();
  updateUI();
  resetDropTimer();
  hideOverlay();
  if (animId) cancelAnimationFrame(animId);
  loop();
}

function endGame() {
  gameOver = true;
  clearInterval(dropTimer);
  render();
  showOverlay('게임 오버', `점수: ${score.toLocaleString()}`, '다시 시작');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  const btn = document.getElementById('btn-pause');
  if (paused) {
    btn.textContent = '▶ 계속';
    showOverlay('일시정지', '계속하려면 버튼을 누르세요', '계속');
  } else {
    btn.textContent = '⏸ 일시정지';
    hideOverlay();
  }
}

function loop() {
  render();
  animId = requestAnimationFrame(loop);
}

// ── Input: Keyboard ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (gameOver) return;
  if (paused && e.key !== 'Escape' && e.key !== 'p' && e.key !== 'P') return;
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); moveLeft();   break;
    case 'ArrowRight': e.preventDefault(); moveRight();  break;
    case 'ArrowDown':  e.preventDefault(); softDrop();   break;
    case 'ArrowUp':
    case 'x': case 'X': rotate(); break;
    case ' ':          e.preventDefault(); hardDrop();   break;
    case 'c': case 'C': holdPiece(); break;
    case 'Escape':
    case 'p': case 'P': togglePause(); break;
  }
});

// ── Input: Touch (swipe + tap) ────────────────────────────────────────────

let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
let lastTap = 0;
const SWIPE_THRESHOLD = 25;
const TAP_MAX_DIST    = 12;
const TAP_MAX_MS      = 200;
const DOUBLE_TAP_MS   = 300;

boardCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchStartTime = Date.now();
}, { passive: false });

boardCanvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (gameOver) return;
  if (paused) { togglePause(); return; }

  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const dist = Math.hypot(dx, dy);
  const dt   = Date.now() - touchStartTime;

  if (dist < TAP_MAX_DIST && dt < TAP_MAX_MS) {
    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      hardDrop();
      lastTap = 0;
    } else {
      rotate();
      lastTap = now;
    }
    return;
  }

  if (dist < SWIPE_THRESHOLD) return;

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) moveLeft(); else moveRight();
  } else {
    if (dy > 0) softDrop(); else holdPiece();
  }
}, { passive: false });

// ── Input: Buttons ────────────────────────────────────────────────────────

function bindBtn(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  let interval = null;

  const start = (e) => {
    e.preventDefault();
    if (gameOver || paused) return;
    fn();
    if (id === 'btn-left' || id === 'btn-right' || id === 'btn-down') {
      interval = setInterval(fn, 100);
    }
  };
  const stop = () => { clearInterval(interval); interval = null; };

  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend',   stop,  { passive: false });
  el.addEventListener('mousedown',  start);
  el.addEventListener('mouseup',    stop);
  el.addEventListener('mouseleave', stop);
}

bindBtn('btn-left',   moveLeft);
bindBtn('btn-right',  moveRight);
bindBtn('btn-down',   softDrop);
bindBtn('btn-rotate', rotate);
bindBtn('btn-drop',   hardDrop);
bindBtn('btn-hold',   holdPiece);

document.getElementById('btn-pause').addEventListener('touchstart', (e) => {
  e.preventDefault();
  togglePause();
}, { passive: false });
document.getElementById('btn-pause').addEventListener('click', togglePause);

overlayBtn.addEventListener('click', () => {
  if (paused) { togglePause(); return; }
  initGame();
});
overlayBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (paused) { togglePause(); return; }
  initGame();
}, { passive: false });

// ── Start ─────────────────────────────────────────────────────────────────

showOverlay('테트리스', '시작 버튼을 눌러 플레이하세요', '시작');
next = randomPiece();
current = { shape: [[]], color: 'I', x: 0, y: 0 };
board = createBoard();
render();

// PotatoVision — make your webcam look like it was filmed on a potato.

const $ = (id) => document.getElementById(id);

const video       = $('video');
const canvas      = $('canvas');
const emojiCanvas = $('emojiCanvas');
const statusEl    = $('status');
const startBtn    = $('start');
const snapBtn     = $('snap');
const levelInput  = $('level');
const levelOut    = $('levelOut');
const emojiToggle = $('emojiMode');
const presetBtns  = document.querySelectorAll('[data-preset]');

const W = 480;
const H = 360;
canvas.width = W;
canvas.height = H;
emojiCanvas.width = W;
emojiCanvas.height = H;

const ctx       = canvas.getContext('2d', { willReadFrequently: true });
const emojiCtx  = emojiCanvas.getContext('2d');

// Offscreen canvas for the main effects pipeline (resized per frame).
const effectsCanvas = document.createElement('canvas');
const effectsCtx    = effectsCanvas.getContext('2d', { willReadFrequently: true });

// Offscreen canvas used purely to sample video into a luminance grid for emoji mode.
const emojiSampleCanvas = document.createElement('canvas');
const emojiSampleCtx    = emojiSampleCanvas.getContext('2d', { willReadFrequently: true });

const scanlineCanvas = buildScanlines();
const vignetteCanvas = buildVignette();

let stream = null;
let running = false;
let level = 0;            // 0..1
let emojiMode = false;
let lastEmojiAt = 0;

// Dark → bright. Luminance buckets pick from this list.
const EMOJI_PALETTE = ['⬛', '🟫', '🟧', '🍟', '🥔'];
// 4:3 grid → square cells when rendered onto the 480×360 canvas.
const EMOJI_COLS = 32;
const EMOJI_ROWS = 24;
const EMOJI_CELL_W = W / EMOJI_COLS;   // 15
const EMOJI_CELL_H = H / EMOJI_ROWS;   // 15

// Pre-rendered emoji tiles, lazily built on first emoji-mode frame so system
// emoji fonts have a chance to load before we rasterize.
let emojiTiles = null;

// ---------- helpers ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp  = (a, b, t)   => a + (b - a) * t;
const easeIn = (t) => t * t;

function setStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.display = msg ? 'block' : 'none';
}

function buildScanlines() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let y = 0; y < H; y += 2) cx.fillRect(0, y, W, 1);
  return c;
}

function buildVignette() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.30, W/2, H/2, Math.max(W,H)*0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.9)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, H);
  return c;
}

// ---------- camera ----------

async function startCamera() {
  if (stream) return;
  startBtn.disabled = true;
  setStatus('Requesting camera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    setStatus('');
    startBtn.textContent = 'Camera on';
    requestAnimationFrame(render);
  } catch (e) {
    console.error(e);
    startBtn.disabled = false;
    setStatus(`Couldn't open camera: ${e.name === 'NotAllowedError' ? 'permission denied.' : e.message}`);
  }
}

// ---------- render pipeline ----------

function render(now) {
  if (!running) return;

  if (emojiMode) {
    renderEmoji(now);
    requestAnimationFrame(render);
    return;
  }

  const p = level;

  // Frame stutter at high potato level — keep the last canvas content.
  if (p > 0.85 && Math.random() < lerp(0, 0.55, (p - 0.85) / 0.15)) {
    requestAnimationFrame(render);
    return;
  }

  // 1) Pixelate: draw video into tiny offscreen canvas.
  const minW = 28;
  const targetW = Math.max(minW, Math.round(lerp(W, minW, easeIn(p))));
  const targetH = Math.max(1, Math.round(targetW * H / W));
  effectsCanvas.width = targetW;
  effectsCanvas.height = targetH;
  effectsCtx.imageSmoothingEnabled = true;
  effectsCtx.imageSmoothingQuality = 'low';
  effectsCtx.drawImage(video, 0, 0, targetW, targetH);

  // 2) Color quantization on the small canvas (cheap).
  if (p > 0.05) {
    const bits = Math.max(1, Math.round(lerp(8, 1, easeIn(p))));
    const levels = 1 << bits;
    const step = 255 / (levels - 1);
    const img = effectsCtx.getImageData(0, 0, targetW, targetH);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.round(d[i]     / step) * step;
      d[i + 1] = Math.round(d[i + 1] / step) * step;
      d[i + 2] = Math.round(d[i + 2] / step) * step;
    }
    effectsCtx.putImageData(img, 0, 0);
  }

  // 3) Scale up to display, no smoothing → blocky.
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(effectsCanvas, 0, 0, W, H);

  // 4) Chromatic ghosting (poor man's RGB shift). Two offset copies blended in.
  if (p > 0.25) {
    const offset = Math.round(lerp(0, 9, p));
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = lerp(0, 0.45, p);
    ctx.drawImage(effectsCanvas, -offset, 0, W, H);
    ctx.drawImage(effectsCanvas,  offset, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 5) Scanlines.
  if (p > 0.15) {
    ctx.globalAlpha = lerp(0, 0.55, p);
    ctx.drawImage(scanlineCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // 6) Vignette.
  if (p > 0.1) {
    ctx.globalAlpha = lerp(0, 0.85, p);
    ctx.drawImage(vignetteCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // 7) Color cast — sickly green at extreme potato levels.
  if (p > 0.7) {
    ctx.globalCompositeOperation = 'multiply';
    const tint = lerp(1, 0.78, (p - 0.7) / 0.3);
    ctx.fillStyle = `rgba(${Math.round(255*tint)}, 255, ${Math.round(255*tint)}, 1)`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  requestAnimationFrame(render);
}

function buildEmojiTiles() {
  // Render each palette emoji once into a square tile we can blit per cell.
  // 2× oversample to keep glyphs readable when the emojiCanvas is later
  // CSS-scaled up to the viewport.
  const scale = 2;
  const tileW = Math.ceil(EMOJI_CELL_W * scale);
  const tileH = Math.ceil(EMOJI_CELL_H * scale);
  return EMOJI_PALETTE.map((emoji) => {
    const c = document.createElement('canvas');
    c.width = tileW;
    c.height = tileH;
    const cx = c.getContext('2d');
    cx.fillStyle = '#0a0e0a';
    cx.fillRect(0, 0, tileW, tileH);
    cx.font = `${Math.floor(tileH * 0.92)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(emoji, tileW / 2, tileH / 2 + 1);
    return c;
  });
}

function renderEmoji(now) {
  if (now - lastEmojiAt < 90) return;
  lastEmojiAt = now;

  if (!emojiTiles) emojiTiles = buildEmojiTiles();

  emojiSampleCanvas.width = EMOJI_COLS;
  emojiSampleCanvas.height = EMOJI_ROWS;
  emojiSampleCtx.imageSmoothingEnabled = true;
  emojiSampleCtx.drawImage(video, 0, 0, EMOJI_COLS, EMOJI_ROWS);
  const data = emojiSampleCtx.getImageData(0, 0, EMOJI_COLS, EMOJI_ROWS).data;

  emojiCtx.fillStyle = '#0a0e0a';
  emojiCtx.fillRect(0, 0, W, H);

  const n = EMOJI_PALETTE.length;
  for (let y = 0; y < EMOJI_ROWS; y++) {
    for (let x = 0; x < EMOJI_COLS; x++) {
      const i = (y * EMOJI_COLS + x) * 4;
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      const idx = clamp(Math.floor(lum * n), 0, n - 1);
      emojiCtx.drawImage(
        emojiTiles[idx],
        Math.round(x * EMOJI_CELL_W),
        Math.round(y * EMOJI_CELL_H),
        EMOJI_CELL_W,
        EMOJI_CELL_H,
      );
    }
  }
}

// ---------- snapshot ----------

function downloadCanvas(c) {
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `potatovision-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

function stampCanvas(ox) {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  ox.font = 'bold 16px monospace';
  ox.fillStyle = 'rgba(255, 80, 80, 0.95)';
  ox.fillText(stamp, 10, H - 16);
  ox.fillText('● REC', 10, 22);
}

function snap() {
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ox = out.getContext('2d');

  ox.drawImage(emojiMode ? emojiCanvas : canvas, 0, 0);

  // At very low potato levels, skip the JPEG round-trip — Pristine should be pristine.
  if (level < 0.05) {
    stampCanvas(ox);
    downloadCanvas(out);
    return;
  }

  // Otherwise push it through a punishing JPEG pass, then re-decode and stamp.
  const q = clamp(lerp(0.92, 0.03, easeIn(level)), 0.03, 0.92);
  const url = out.toDataURL('image/jpeg', q);

  const img = new Image();
  img.onload = () => {
    ox.clearRect(0, 0, W, H);
    ox.drawImage(img, 0, 0);
    stampCanvas(ox);
    downloadCanvas(out);
  };
  img.src = url;
}

// ---------- UI wiring ----------

function setLevel(v) {
  level = clamp(v / 100, 0, 1);
  levelInput.value = String(v);
  levelOut.textContent = String(v);
}

function toggleEmojiMode(on) {
  emojiMode = on;
  canvas.hidden = on;
  emojiCanvas.hidden = !on;
}

startBtn.addEventListener('click', startCamera);
snapBtn.addEventListener('click', () => {
  if (!running) {
    setStatus('Start the camera first.');
    return;
  }
  snap();
});
levelInput.addEventListener('input', (e) => setLevel(Number(e.target.value)));
emojiToggle.addEventListener('change', (e) => toggleEmojiMode(e.target.checked));
presetBtns.forEach((btn) => {
  btn.addEventListener('click', () => setLevel(Number(btn.dataset.preset)));
});

// Stop the camera when the tab is hidden — be polite about indicator lights.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    running = false;
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera';
    setStatus('Camera paused (tab hidden). Click Start to resume.');
  }
});

setLevel(0);

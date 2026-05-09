// PotatoVision — make your webcam look like it was filmed on a potato.

const $ = (id) => document.getElementById(id);

const video      = $('video');
const canvas     = $('canvas');
const emojiEl    = $('emoji');
const statusEl   = $('status');
const startBtn   = $('start');
const snapBtn    = $('snap');
const levelInput = $('level');
const levelOut   = $('levelOut');
const emojiToggle = $('emojiMode');
const presetBtns = document.querySelectorAll('[data-preset]');

const W = 480;
const H = 360;
canvas.width = W;
canvas.height = H;

const ctx = canvas.getContext('2d', { willReadFrequently: true });
const tmp = document.createElement('canvas');
const tctx = tmp.getContext('2d', { willReadFrequently: true });

const scanlineCanvas = buildScanlines();
const vignetteCanvas = buildVignette();

let stream = null;
let running = false;
let level = 0;            // 0..1
let emojiMode = false;
let lastEmojiAt = 0;

const EMOJI_PALETTE = ['⬛', '🟫', '🟧', '🍟', '🥔'];
const EMOJI_COLS = 56;
const EMOJI_ROWS = 28;

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

  // 1) Pixelate: draw video into tiny tmp canvas.
  const minW = 28;
  const targetW = Math.max(minW, Math.round(lerp(W, minW, easeIn(p))));
  const targetH = Math.max(1, Math.round(targetW * H / W));
  tmp.width = targetW;
  tmp.height = targetH;
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'low';
  tctx.drawImage(video, 0, 0, targetW, targetH);

  // 2) Color quantization on the small canvas (cheap).
  if (p > 0.05) {
    const bits = Math.max(1, Math.round(lerp(8, 1, easeIn(p))));
    const levels = 1 << bits;
    const step = 255 / (levels - 1);
    const img = tctx.getImageData(0, 0, targetW, targetH);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.round(d[i]     / step) * step;
      d[i + 1] = Math.round(d[i + 1] / step) * step;
      d[i + 2] = Math.round(d[i + 2] / step) * step;
    }
    tctx.putImageData(img, 0, 0);
  }

  // 3) Scale up to display, no smoothing → blocky.
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0, W, H);

  // 4) Chromatic ghosting (poor man's RGB shift).
  if (p > 0.25) {
    const offset = Math.round(lerp(0, 9, p));
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = lerp(0, 0.45, p);
    ctx.drawImage(tmp, -offset, 0, W, H);
    ctx.drawImage(tmp,  offset, 1, W, H);
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

function renderEmoji(now) {
  // Throttle emoji rendering — DOM text updates are expensive.
  if (now - lastEmojiAt < 90) return;
  lastEmojiAt = now;

  tmp.width = EMOJI_COLS;
  tmp.height = EMOJI_ROWS;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(video, 0, 0, EMOJI_COLS, EMOJI_ROWS);
  const data = tctx.getImageData(0, 0, EMOJI_COLS, EMOJI_ROWS).data;

  const out = [];
  const n = EMOJI_PALETTE.length;
  for (let y = 0; y < EMOJI_ROWS; y++) {
    let line = '';
    for (let x = 0; x < EMOJI_COLS; x++) {
      const i = (y * EMOJI_COLS + x) * 4;
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      const idx = clamp(Math.floor(lum * n), 0, n - 1);
      line += EMOJI_PALETTE[idx];
    }
    out.push(line);
  }
  emojiEl.textContent = out.join('\n');
}

// ---------- snapshot ----------

function snap() {
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ox = out.getContext('2d');

  if (emojiMode) {
    // Render the emoji grid to a canvas — paint background and text.
    ox.fillStyle = '#0a0e0a';
    ox.fillRect(0, 0, W, H);
    ox.fillStyle = '#9aff9a';
    ox.font = `${Math.floor(H / EMOJI_ROWS)}px monospace`;
    ox.textBaseline = 'top';
    const lineH = H / EMOJI_ROWS;
    const text = emojiEl.textContent.split('\n');
    for (let i = 0; i < text.length; i++) {
      ox.fillText(text[i], 0, i * lineH);
    }
  } else {
    ox.drawImage(canvas, 0, 0);
  }

  // Push it through the worst JPEG of its life, then re-decode for download.
  const q = clamp(lerp(0.5, 0.03, easeIn(level)), 0.03, 0.7);
  const url = out.toDataURL('image/jpeg', q);

  const img = new Image();
  img.onload = () => {
    ox.clearRect(0, 0, W, H);
    ox.drawImage(img, 0, 0);
    // Date stamp, camcorder style.
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    ox.font = 'bold 16px monospace';
    ox.fillStyle = 'rgba(255, 80, 80, 0.95)';
    ox.fillText(stamp, 10, H - 16);
    ox.fillStyle = 'rgba(255, 80, 80, 0.95)';
    ox.fillText('● REC', 10, 22);

    out.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `potatovision-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
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
  emojiEl.hidden = !on;
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

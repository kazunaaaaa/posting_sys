// 配布部数表に貼る地図画像を作る
// Google Static Maps のベース地図（サーバー経由で取得）の上に、選択エリア・町名ラベル・
// 円（半径表示）・ピン（店名ラベル）をCanvasで重ね描きし、PNG(dataURL)を返す。
// ベース地図を取得できない場合は背景なしで描画する。
import { townLabel } from './labels.js';

const W = 640, H = 517, SCALE = 2; // 出力 1280x1034px
const PAD = 36;
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

const toNorm = (lat, lng) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};
const fromNorm = (x, y) => ({
  lng: x * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
});

function fitView(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    const n = toNorm(p.lat, p.lng);
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  const sx = Math.max(maxX - minX, 1e-7), sy = Math.max(maxY - minY, 1e-7);
  const z = Math.floor(Math.min(Math.log2((W - PAD * 2) / (256 * sx)), Math.log2((H - PAD * 2) / (256 * sy))));
  const zoom = Math.max(3, Math.min(18, z));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { zoom, cx, cy, center: fromNorm(cx, cy) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 区画の幅に収まる文字サイズ（論理px, 7〜11）
function fitFontSize(ctx, text, maxWidthPx) {
  ctx.font = `600 ${10 * SCALE}px ${FONT}`;
  const w10 = ctx.measureText(text).width + 7 * SCALE; // 余白込み
  return Math.max(7, Math.min(11, (10 * maxWidthPx) / w10));
}

function drawLabel(ctx, text, x, y, { bg = '#fff', color = '#111', size = 11, border = '#333' } = {}) {
  ctx.font = `600 ${size * SCALE}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const ph = 4 * SCALE, h = size * SCALE + ph * 2, w = tw + ph * 2.4;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 3 * SCALE);
  ctx.fillStyle = bg; ctx.fill();
  ctx.lineWidth = 1 * SCALE; ctx.strokeStyle = border; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5 * SCALE);
}

function drawPin(ctx, x, y) {
  const r = 9 * SCALE;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 0.2, y - r * 1.1, x - r, y - r * 1.4, x - r, y - r * 2.1);
  ctx.arc(x, y - r * 2.1, r, Math.PI, 0);
  ctx.bezierCurveTo(x + r, y - r * 1.4, x + r * 0.2, y - r * 1.1, x, y);
  ctx.closePath();
  ctx.fillStyle = '#e11d1d'; ctx.fill();
  ctx.lineWidth = 1.2 * SCALE; ctx.strokeStyle = '#7f1010'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - r * 2.1, r * 0.38, 0, Math.PI * 2); ctx.fillStyle = '#7f1010'; ctx.fill();
}

async function loadBaseMap(center, zoom) {
  const q = new URLSearchParams({ center: `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`, zoom: String(zoom), size: `${W}x${H}`, scale: String(SCALE) });
  const res = await fetch('/api/staticmap?' + q.toString());
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = [j.error, j.hint].filter(Boolean).join(' '); } catch { /* noop */ }
    throw new Error(msg);
  }
  return createImageBitmap(await res.blob());
}

/**
 * @param {object} p
 * @param {Array<{rings:number[][][], center:{lat,lng}, name:string}>} p.areas 選択エリア
 * @param {Array<{lat,lng,radiusKm}>} [p.circles]
 * @param {{lat,lng}|null} [p.pin]
 * @param {string} [p.pinLabel] 店名など
 * @param {(name:string)=>string} [p.labelOf]
 */
export async function buildMapImage({ areas, circles = [], pin = null, pinLabel = '', labelOf = townLabel }) {
  const pts = [];
  for (const a of areas) for (const ring of a.rings) for (const [lng, lat] of ring) pts.push({ lat, lng });
  for (const c of circles) {
    const dLat = c.radiusKm / 111.32, dLng = c.radiusKm / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    pts.push({ lat: c.lat + dLat, lng: c.lng + dLng }, { lat: c.lat - dLat, lng: c.lng - dLng });
  }
  if (pin) pts.push(pin);
  if (!pts.length) throw new Error('地図に描くエリアがありません');

  const { zoom, cx, cy, center } = fitView(pts);
  const world = 256 * 2 ** zoom * SCALE;
  const project = (lat, lng) => {
    const n = toNorm(lat, lng);
    return { x: (n.x - cx) * world + (W * SCALE) / 2, y: (n.y - cy) * world + (H * SCALE) / 2 };
  };

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');

  let baseMap = true, baseError = '';
  try {
    const img = await loadBaseMap(center, zoom);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } catch (e) {
    baseMap = false; baseError = e.message;
    ctx.fillStyle = '#eef2f5'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 選択エリア（塗り＋境界）
  for (const a of areas) {
    ctx.beginPath();
    for (const ring of a.rings) {
      ring.forEach(([lng, lat], i) => { const p = project(lat, lng); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(249,115,22,0.38)'; ctx.fill('evenodd');
    ctx.lineWidth = 1.4 * SCALE; ctx.strokeStyle = '#7c2d12'; ctx.stroke();
  }

  // 円（赤）
  const circleLabels = [];
  for (const c of circles) {
    const p = project(c.lat, c.lng);
    const mpp = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** zoom; // m/論理px
    const r = ((c.radiusKm * 1000) / mpp) * SCALE;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 3 * SCALE; ctx.strokeStyle = '#ef1c1c'; ctx.stroke();
    const ang = (20 * Math.PI) / 180; // 円周上（右やや下）に半径を表示
    circleLabels.push({ text: `${c.radiusKm}km`, x: p.x + r * Math.cos(ang), y: p.y + r * Math.sin(ang) });
  }

  // 町名ラベル（区画の幅に収まる大きさで、区画の中心に）
  for (const a of areas) {
    if (!a.center) continue;
    let minX = Infinity, maxX = -Infinity;
    for (const ring of a.rings) for (const [lng, lat] of ring) { const q = project(lat, lng); minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); }
    const text = labelOf(a.name);
    const p = project(a.center.lat, a.center.lng);
    drawLabel(ctx, text, p.x, p.y, { size: fitFontSize(ctx, text, (maxX - minX) * 0.95) });
  }

  // 半径ラベルは町名より手前に
  for (const l of circleLabels) drawLabel(ctx, l.text, l.x, l.y, { size: 11, border: '#ef1c1c', color: '#b91c1c' });

  // ピンと店名
  if (pin) {
    const p = project(pin.lat, pin.lng);
    drawPin(ctx, p.x, p.y);
    if (pinLabel) drawLabel(ctx, pinLabel, p.x, p.y + 14 * SCALE, { bg: '#fff59d', border: '#8a6d00', size: 12 });
  }

  if (!baseMap) {
    drawLabel(ctx, '背景地図なし（Maps Static API を確認）', canvas.width - 150 * SCALE, canvas.height - 14 * SCALE, { size: 10, bg: '#fff', border: '#999', color: '#555' });
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    baseMap,
    baseError,
  };
}

// 配布部数表に貼る地図画像を作る
// Google Static Maps のベース地図（サーバー経由で取得）の上に、選択エリア・町名ラベル・
// 円（半径表示）・ピン（店名ラベル）をCanvasで重ね描きし、PNG(dataURL)を返す。
// ベース地図を取得できない場合は背景なしで描画する。
import { townLabel } from './labels.js';

const W = 640, H = 517, SCALE = 2; // 出力 1280x1034px
const LEGEND_H = 26;      // 下端の凡例帯
const MH = H - LEGEND_H;  // 地図部分の高さ
const PAD = 14;           // 選択エリアの外側の余白（できるだけアップにする）
const MAX_TILE = 640;     // Static Maps の1枚の最大サイズ（論理px）
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';

const toNorm = (lat, lng) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};
const fromNorm = (x, y) => ({
  lng: x * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
});

// 点群が地図部分（W×MH）に収まる最大のズーム（小数）。整数ズームに丸めないので余白が少ない
function fitView(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    const n = toNorm(p.lat, p.lng);
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  const sx = Math.max(maxX - minX, 1e-7), sy = Math.max(maxY - minY, 1e-7);
  const z = Math.min(Math.log2((W - PAD * 2) / (256 * sx)), Math.log2((MH - PAD * 2) / (256 * sy)));
  const zoom = Math.max(3, Math.min(17.5, z));
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
  return Math.max(7, Math.min(12, (10 * maxWidthPx) / w10));
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

async function fetchStatic(center, zoom, w, h) {
  const q = new URLSearchParams({ center: `${center.lat.toFixed(7)},${center.lng.toFixed(7)}`, zoom: String(zoom), size: `${w}x${h}`, scale: String(SCALE) });
  const res = await fetch('/api/staticmap?' + q.toString());
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = [j.error, j.hint].filter(Boolean).join(' '); } catch { /* noop */ }
    throw new Error(msg);
  }
  return createImageBitmap(await res.blob());
}

/**
 * 小数ズーム zf の背景地図を、地図部分（W×MH）に描く。
 * Static Maps は整数ズームしか無いので、
 *   - 拡大率 k=2^(zf-整数部) が小さいとき: 整数ズームの地図を k 倍に拡大して描く
 *   - k が大きいとき: 1段上のズームで複数枚に分けて取得し、縮小して並べる（文字がぼやけない）
 */
async function drawBaseMap(ctx, cx, cy, zf) {
  let z = Math.floor(zf);
  let k = 2 ** (zf - z);
  if (k > 1.42 && z < 20) { z += 1; k /= 2; }
  const ew = W / k, eh = MH / k;                 // 取得する範囲（ズーム z の論理px）
  const margin = 40;                              // 内側の継ぎ目で隠す、下端のロゴ・著作権表示の分
  const cols = Math.ceil(ew / MAX_TILE);
  const rows = Math.ceil(eh / (MAX_TILE - margin));
  const tw = Math.ceil(ew / cols), th = Math.ceil(eh / rows);
  const worldZ = 256 * 2 ** z;
  const jobs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const last = r === rows - 1;
      const reqH = last ? th : th + margin;       // 最下段以外は下に余分に取り、その部分は描かない
      const x0 = -ew / 2 + c * tw, y0 = -eh / 2 + r * th;  // 地図中心からの位置（論理px）
      const center = fromNorm(cx + (x0 + tw / 2) / worldZ, cy + (y0 + reqH / 2) / worldZ);
      jobs.push(fetchStatic(center, z, tw, reqH).then((img) => ({ img, x0, y0, last })));
    }
  }
  const tiles = await Promise.all(jobs);
  const f = k * SCALE; // 論理px → キャンバスpx
  for (const { img, x0, y0, last } of tiles) {
    const sh = last ? img.height : th * SCALE;  // 描く高さ（画像px）
    ctx.drawImage(img, 0, 0, img.width, sh, (x0 + ew / 2) * f, (y0 + eh / 2) * f, tw * f, (sh / SCALE) * f);
  }
}

/**
 * @param {object} p
 * @param {Array<{rings:number[][][], center:{lat,lng}, name:string}>} p.areas 選択エリア
 * @param {Array<{lat,lng,radiusKm}>} [p.circles]
 * @param {{lat,lng}|null} [p.pin]
 * @param {string} [p.pinLabel] 店名など
 * @param {(name:string)=>string} [p.labelOf]
 */
export async function buildMapImage({ areas, circles = [], pin = null, pinLabel = '', labelOf = townLabel, competitors = [], competitorLabel = '競合', customers = [] }) {
  // 表示範囲は選択エリア（とピン）に合わせる。円は範囲外にはみ出してもよい（エリアをできるだけ大きく写す）
  const pts = [];
  for (const a of areas) for (const ring of a.rings) for (const [lng, lat] of ring) pts.push({ lat, lng });
  if (!pts.length) {
    for (const c of circles) {
      const dLat = c.radiusKm / 111.32, dLng = c.radiusKm / (111.32 * Math.cos((c.lat * Math.PI) / 180));
      pts.push({ lat: c.lat + dLat, lng: c.lng + dLng }, { lat: c.lat - dLat, lng: c.lng - dLng });
    }
  }
  if (pin) pts.push(pin);
  if (!pts.length) throw new Error('地図に描くエリアがありません');

  const { zoom, cx, cy } = fitView(pts);
  const world = 256 * 2 ** zoom * SCALE;
  const project = (lat, lng) => {
    const n = toNorm(lat, lng);
    return { x: (n.x - cx) * world + (W * SCALE) / 2, y: (n.y - cy) * world + (MH * SCALE) / 2 };
  };

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  let baseMap = true, baseError = '';
  try {
    await drawBaseMap(ctx, cx, cy, zoom);
  } catch (e) {
    baseMap = false; baseError = e.message;
    ctx.fillStyle = '#eef2f5'; ctx.fillRect(0, 0, canvas.width, MH * SCALE);
  }

  // 地図部分の外（凡例帯）には描かない
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, canvas.width, MH * SCALE); ctx.clip();

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
    const lx = p.x + r * Math.cos(ang), ly = p.y + r * Math.sin(ang);
    // 円が地図からはみ出すときも、半径の表示は地図の中に収める
    circleLabels.push({ text: `${c.radiusKm}km`, x: Math.min(Math.max(lx, 30 * SCALE), canvas.width - 30 * SCALE), y: Math.min(Math.max(ly, 14 * SCALE), MH * SCALE - 14 * SCALE) });
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

  // 競合店舗（紫の点）。地図の範囲に入るものだけ描く（範囲は選択エリアに合わせたまま）
  let compShown = 0;
  for (const c of competitors) {
    if (!Number.isFinite(c?.lat) || !Number.isFinite(c?.lng)) continue;
    const p = project(c.lat, c.lng);
    if (p.x < 0 || p.y < 0 || p.x > canvas.width || p.y > MH * SCALE) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5.5 * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = '#7c3aed'; ctx.fill();
    ctx.lineWidth = 1.6 * SCALE; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    compShown++;
  }

  // 顧客（町丁目ごとの人数のバブル）
  let custShown = 0;
  for (const c of customers) {
    const p = project(c.lat, c.lng);
    if (p.x < 0 || p.y < 0 || p.x > canvas.width || p.y > MH * SCALE) continue;
    const r = (c.count >= 0.5 ? 7 + 3 * Math.sqrt(c.count) : 4) * SCALE;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(13,148,136,0.85)'; ctx.fill();
    ctx.lineWidth = 1.5 * SCALE; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.font = `bold ${11 * SCALE}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (c.count >= 0.5) ctx.fillText(String(Math.round(c.count)), p.x, p.y + 0.5 * SCALE);
    custShown += c.count;
  }

  // 半径ラベルは町名より手前に
  for (const l of circleLabels) drawLabel(ctx, l.text, l.x, l.y, { size: 11, border: '#ef1c1c', color: '#b91c1c' });

  // ピンと店名
  if (pin) {
    const p = project(pin.lat, pin.lng);
    drawPin(ctx, p.x, p.y);
    if (pinLabel) drawLabel(ctx, pinLabel, p.x, p.y + 14 * SCALE, { bg: '#fff59d', border: '#8a6d00', size: 12 });
  }

  ctx.restore();

  // 凡例（下端の帯。地図に重ならない）
  const legend = [{ type: 'area', text: '配布エリア' }];
  if (circles.length) legend.push({ type: 'circle', text: '半径' });
  if (compShown) legend.push({ type: 'comp', text: `${competitorLabel}（${compShown}件）` });
  if (custShown) legend.push({ type: 'cust', text: `顧客（${Math.round(custShown)}人）` });
  if (pin && pinLabel) legend.push({ type: 'pin', text: pinLabel });
  drawLegendBar(ctx, legend, baseMap ? '' : '背景地図なし（Maps Static API を確認）');

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    baseMap,
    baseError,
    competitorsShown: compShown,
  };
}

function drawLegendBar(ctx, items, note) {
  const y0 = MH * SCALE, h = LEGEND_H * SCALE, cy = y0 + h / 2;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, y0, ctx.canvas.width, h);
  ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, y0, ctx.canvas.width, 1 * SCALE);
  ctx.font = `bold ${11 * SCALE}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let x = 10 * SCALE;
  const icon = 16 * SCALE, gap = 6 * SCALE;
  for (const it of items) {
    if (it.type === 'area') {
      ctx.fillStyle = 'rgba(249,115,22,0.5)'; ctx.fillRect(x, cy - 5 * SCALE, icon, 10 * SCALE);
      ctx.lineWidth = 1 * SCALE; ctx.strokeStyle = '#7c2d12'; ctx.strokeRect(x, cy - 5 * SCALE, icon, 10 * SCALE);
    } else if (it.type === 'circle') {
      ctx.beginPath(); ctx.arc(x + icon / 2, cy, 6 * SCALE, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 * SCALE; ctx.strokeStyle = '#ef1c1c'; ctx.stroke();
    } else if (it.type === 'comp') {
      ctx.beginPath(); ctx.arc(x + icon / 2, cy, 5 * SCALE, 0, Math.PI * 2);
      ctx.fillStyle = '#7c3aed'; ctx.fill(); ctx.lineWidth = 1 * SCALE; ctx.strokeStyle = '#fff'; ctx.stroke();
    } else if (it.type === 'cust') {
      ctx.beginPath(); ctx.arc(x + icon / 2, cy, 6 * SCALE, 0, Math.PI * 2);
      ctx.fillStyle = '#0d9488'; ctx.fill(); ctx.lineWidth = 1 * SCALE; ctx.strokeStyle = '#fff'; ctx.stroke();
    } else if (it.type === 'pin') {
      ctx.save(); ctx.translate(x + icon / 2, cy + 7 * SCALE); ctx.scale(0.55, 0.55); drawPin(ctx, 0, 0); ctx.restore();
    }
    ctx.font = `bold ${11 * SCALE}px ${FONT}`;
    ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(it.text, x + icon + gap, cy);
    x += icon + gap + ctx.measureText(it.text).width + 16 * SCALE;
  }
  if (note) {
    ctx.font = `${10 * SCALE}px ${FONT}`;
    ctx.fillStyle = '#777'; ctx.textAlign = 'right';
    ctx.fillText(note, ctx.canvas.width - 8 * SCALE, cy);
  }
}

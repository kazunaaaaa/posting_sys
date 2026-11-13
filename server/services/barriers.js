// エリアを分断する川・幹線道路・線路（OpenStreetMap Overpass API）
// ピン→町丁目の中心を結ぶ線分が、これらを何本またぐかで「分断の度合い」を計算する。
import fs from 'fs';
import path from 'path';
import { TOWN_DIR } from './towns.js';

const CACHE_DIR = path.join(TOWN_DIR, 'barriers');
// OVERPASS_URL で取得先を差し替え可能（別のOverpassサーバーやテスト用）
const OVERPASS_URLS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// 種類ごとの重み（大きいほど越えにくい）
export const BARRIER_TYPES = {
  river:    { label: '川',           weight: 3.0 },
  motorway: { label: '高速道路',     weight: 2.5 },
  railway:  { label: '線路',         weight: 1.5 },
  trunk:    { label: '国道',         weight: 1.5 },
  primary:  { label: '主要地方道',   weight: 0.6 },
};

export function classifyWay(tags = {}) {
  if (tags.waterway === 'river' || tags.waterway === 'canal') return 'river';
  if (tags.highway === 'motorway') return 'motorway';
  if (tags.highway === 'trunk') return 'trunk';
  if (tags.highway === 'primary') return 'primary';
  if (tags.railway === 'rail' && tags.tunnel !== 'yes') return 'railway';
  return null;
}

export function overpassQuery({ minLat, minLng, maxLat, maxLng }) {
  const b = `${minLat.toFixed(5)},${minLng.toFixed(5)},${maxLat.toFixed(5)},${maxLng.toFixed(5)}`;
  return `[out:json][timeout:40];(
way["waterway"~"^(river|canal)$"](${b});
way["highway"~"^(motorway|trunk|primary)$"]["tunnel"!="yes"](${b});
way["railway"="rail"]["tunnel"!="yes"](${b});
);out geom;`;
}

// Overpass の応答 → [{type, coords:[[lng,lat],...]}]
export function parseOverpass(json) {
  const out = [];
  for (const el of json?.elements || []) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    const type = classifyWay(el.tags);
    if (!type) continue;
    const name = el.tags?.name || el.tags?.ref || '';
    out.push({ type, name, coords: el.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]) });
  }
  return out;
}

/** bbox 内の分断要素（キャッシュあり）。取得できなければ { barriers: [], error } */
export async function fetchBarriers(bbox) {
  const r = (v) => Math.round(v * 50) / 50; // 0.02度単位で丸めてキャッシュ
  const key = [r(bbox.minLat), r(bbox.minLng), r(bbox.maxLat), r(bbox.maxLng)].join('_');
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  try { return { barriers: JSON.parse(fs.readFileSync(cachePath, 'utf-8')), cached: true }; } catch { /* 取得へ */ }
  const q = overpassQuery({ minLat: r(bbox.minLat) - 0.01, minLng: r(bbox.minLng) - 0.01, maxLat: r(bbox.maxLat) + 0.01, maxLng: r(bbox.maxLng) + 0.01 });
  const errors = [];
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
          'User-Agent': 'posting-sys/0.1 (+https://github.com/kazunaaaaa/posting_sys)',
        },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) { errors.push(`${new URL(url).host} HTTP ${res.status}`); continue; }
      const barriers = parseOverpass(await res.json());
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(barriers));
      return { barriers, cached: false };
    } catch (e) {
      errors.push(`${new URL(url).host} ${e.message}`);
    }
  }
  return { barriers: [], error: `道路・線路・川のデータを取得できませんでした（${errors.join(', ')}）` };
}

// ---- 交差判定 ----
function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// 分断要素ごとに外接矩形を前計算
export function indexBarriers(barriers) {
  return barriers.map((b) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of b.coords) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { ...b, minX, minY, maxX, maxY };
  });
}

/**
 * from→to の線分がまたぐ分断要素。
 * 同じ名前の道路・線路・川（上下線・複線で別の線になっているもの）は1本として数える。
 * @returns {{ weight:number, types:string[] }}
 */
export function crossings(from, to, indexed) {
  const ax = from.lng, ay = from.lat, bx = to.lng, by = to.lat;
  const sMinX = Math.min(ax, bx), sMaxX = Math.max(ax, bx), sMinY = Math.min(ay, by), sMaxY = Math.max(ay, by);
  let weight = 0;
  const types = [];
  const names = [];
  const seen = new Set();
  for (const b of indexed) {
    if (b.maxX < sMinX || b.minX > sMaxX || b.maxY < sMinY || b.minY > sMaxY) continue;
    const key = b.name ? `${b.type}:${b.name}` : null;
    if (key && seen.has(key)) continue;
    const c = b.coords;
    for (let i = 1; i < c.length; i++) {
      if (segIntersect(ax, ay, bx, by, c[i - 1][0], c[i - 1][1], c[i][0], c[i][1])) {
        if (key) seen.add(key);
        weight += BARRIER_TYPES[b.type].weight;
        types.push(b.type);
        if (b.name) names.push(b.name);
        break;
      }
    }
  }
  return { weight, types, names };
}

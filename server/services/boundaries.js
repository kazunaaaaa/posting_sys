// 市区町村の境界ポリゴンをオンデマンド取得・簡略化・キャッシュするサービス。
//
// データ源（優先順）:
//   1) ローカルキャッシュ  server/data/boundaries/<code>.json
//   2) e-Stat 統計GIS 境界データ（BOUNDARY_ESTAT_BASE を設定した場合／実運用推奨）
//   3) niiyz/JapanCityGeoJson（国土数値情報 行政区域ベース・キー不要のフォールバック）
//
// 取得したポリゴンは Douglas-Peucker で簡略化してキャッシュに保存する。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { simplifyRing, centroid, areaKm2 } from './geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'boundaries');

// niiyz は 5桁コードを 都道府県2桁/コード.json で配置
const NIIYZ_BASE =
  process.env.BOUNDARY_BASE ||
  'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson';

const SIMPLIFY_TOLERANCE = Number(process.env.BOUNDARY_SIMPLIFY ?? 0.0004);

function cachePath(code) {
  return path.join(CACHE_DIR, `${code}.json`);
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// GeoJSON Feature(Polygon/MultiPolygon) → 正規化された境界オブジェクト
function normalizeFeature(code, feature) {
  const g = feature.geometry;
  let rings = [];
  if (g.type === 'Polygon') rings = [g.coordinates[0]];
  else if (g.type === 'MultiPolygon') rings = g.coordinates.map((poly) => poly[0]);
  const simplified = rings
    // 点数の少ないリング（粗い元データ）はそのまま。多いものだけ簡略化。
    .map((r) => (r.length > 60 ? simplifyRing(r, SIMPLIFY_TOLERANCE) : r))
    .filter((r) => r.length >= 4);
  // 面積が最大のリングを主ポリゴンとして重心・面積算出に使う
  const main = simplified.slice().sort((a, b) => areaKm2(b) - areaKm2(a))[0] || simplified[0];
  const props = feature.properties || {};
  return {
    code,
    name: props.N03_004 || props.city || props.N03_003 || '',
    pref: props.N03_001 || props.pref || '',
    polygons: simplified,
    center: main ? centroid(main) : null,
    areaKm2: +simplified.reduce((s, r) => s + areaKm2(r), 0).toFixed(3),
  };
}

async function fetchFromSource(code) {
  const pref2 = code.slice(0, 2);
  const url = `${NIIYZ_BASE}/${pref2}/${code}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'posting-sys/0.1' } });
  if (!res.ok) throw new Error(`boundary ${code}: HTTP ${res.status}`);
  const json = await res.json();
  const feature = json.features?.[0];
  if (!feature) throw new Error(`boundary ${code}: no feature`);
  return normalizeFeature(code, feature);
}

export async function getBoundary(code) {
  ensureCacheDir();
  const cp = cachePath(code);
  if (fs.existsSync(cp)) {
    return JSON.parse(fs.readFileSync(cp, 'utf-8'));
  }
  const boundary = await fetchFromSource(code);
  fs.writeFileSync(cp, JSON.stringify(boundary));
  return boundary;
}

// 複数コードをまとめて取得（失敗は個別にスキップ）
export async function getBoundaries(codes) {
  const results = [];
  for (const code of codes) {
    try {
      results.push(await getBoundary(code));
    } catch (e) {
      results.push({ code, error: e.message, polygons: [] });
    }
  }
  return results;
}

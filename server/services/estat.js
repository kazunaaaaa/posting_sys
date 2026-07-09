// 世帯数データサービス
// - ESTAT_APP_ID が設定されていれば e-Stat API から取得（実装スタブ）
// - 未設定時は同梱サンプル（松戸市周辺）を返す
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { centroid, areaKm2 } from './geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配布部数 = 世帯数 × このレート（要件: 最新世帯数/国勢調査世帯数の70%）
export const DISTRIBUTION_RATE = 0.7;

let sampleCache = null;
function loadSample() {
  if (!sampleCache) {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'data', 'households.sample.json'),
      'utf-8'
    );
    sampleCache = JSON.parse(raw);
  }
  return sampleCache;
}

export function distributionFor(households) {
  return Math.round(households * DISTRIBUTION_RATE);
}

// エリアを正規化して返す（世帯数・配布部数・重心・面積を付与）
function enrich(area) {
  const c = centroid(area.polygon);
  const km2 = areaKm2(area.polygon);
  return {
    code: area.code,
    pref: area.pref,
    city: area.city,
    name: area.name,
    households: area.households,
    distribution: distributionFor(area.households),
    distributionRate: DISTRIBUTION_RATE,
    center: c,
    areaKm2: +km2.toFixed(3),
    householdDensity: +(area.households / Math.max(km2, 0.01)).toFixed(0),
    polygon: area.polygon,
  };
}

// e-Stat API 連携（実データ）。appId 未設定時は null を返しサンプルにフォールバック。
// 実装メモ: 統計表ID(statsDataId)は国勢調査 世帯数（例: 男女・世帯 小地域）を用いる。
// エンドポイント: https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData
async function fetchFromEstat({ pref, city }) {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return null;
  // NOTE: 小地域の境界ポリゴンは e-Stat 統計GIS(境界データ)から別途取得が必要。
  // ここでは世帯数の数値取得の骨組みのみ実装し、境界は境界データAPI/shapefileと結合する想定。
  try {
    const statsDataId = process.env.ESTAT_STATS_DATA_ID; // 世帯数の統計表ID
    if (!statsDataId) return null;
    const url = new URL('https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData');
    url.searchParams.set('appId', appId);
    url.searchParams.set('statsDataId', statsDataId);
    url.searchParams.set('limit', '5000');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`e-Stat ${res.status}`);
    const json = await res.json();
    // レスポンスの VALUE 配列を世帯数へマッピング（統計表の分類IDに依存するため要調整）
    const values = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? [];
    // 境界ポリゴンが無いと地図描画できないため、実運用では境界データと code で結合する。
    // ここでは取得件数のみログし、境界が無ければ null を返してサンプルへ委譲。
    console.log(`[estat] fetched ${values.length} values (境界データとの結合が必要)`);
    return null;
  } catch (e) {
    console.warn('[estat] fetch failed, fallback to sample:', e.message);
    return null;
  }
}

export async function getAreas(filter = {}) {
  const real = await fetchFromEstat(filter);
  if (real) return { source: 'e-stat', areas: real.map(enrich) };
  const sample = loadSample();
  return {
    source: 'sample',
    meta: sample.meta,
    areas: sample.areas.map(enrich),
  };
}

export async function getAreasByCodes(codes) {
  const { areas } = await getAreas();
  const set = new Set(codes);
  return areas.filter((a) => set.has(a.code));
}

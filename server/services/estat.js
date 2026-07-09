// 世帯数・エリアデータサービス
//
// 粒度は2種類:
//   - 市区町村 (municipality): 全国マスタ(municipalities.json)。世帯数は e-Stat で充填。
//   - 町丁目 (small area): 同梱サンプル(households.sample.json, 松戸市)。e-Stat 小地域で差し替え可。
//
// 配布部数 = 世帯数 × DISTRIBUTION_RATE (要件: 最新世帯数/国勢調査世帯数の70%)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { centroid, areaKm2 } from './geo.js';
import { fetchMunicipalityHouseholds } from './estatClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DISTRIBUTION_RATE = 0.7;

export function distributionFor(households) {
  if (households == null) return null;
  return Math.round(households * DISTRIBUTION_RATE);
}

// ---------- 町丁目サンプル ----------
let sampleCache = null;
function loadSample() {
  if (!sampleCache) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'households.sample.json'), 'utf-8');
    sampleCache = JSON.parse(raw);
  }
  return sampleCache;
}

function enrichSmallArea(area) {
  const c = centroid(area.polygon);
  const km2 = areaKm2(area.polygon);
  return {
    level: 'town',
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

export async function getSmallAreas() {
  const sample = loadSample();
  return { source: 'sample', meta: sample.meta, areas: sample.areas.map(enrichSmallArea) };
}

export async function getSmallAreasByCodes(codes) {
  const { areas } = await getSmallAreas();
  const set = new Set(codes);
  return areas.filter((a) => set.has(a.code));
}

// ---------- 全国市区町村マスタ ----------
let muniCache = null;
function loadMunicipalities() {
  if (!muniCache) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'municipalities.json'), 'utf-8');
    muniCache = JSON.parse(raw);
  }
  return muniCache;
}

export function listPrefectures() {
  const { municipalities } = loadMunicipalities();
  const seen = new Map();
  for (const m of municipalities) {
    if (!seen.has(m.pref)) seen.set(m.pref, { pref: m.pref, code: m.code.slice(0, 2), count: 0 });
    seen.get(m.pref).count += 1;
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export async function getMunicipalities({ pref, keyword } = {}) {
  const { municipalities, meta } = loadMunicipalities();
  let list = municipalities;
  if (pref) list = list.filter((m) => m.pref === pref);
  if (keyword) list = list.filter((m) => m.city.includes(keyword) || (m.kana || '').includes(keyword));
  const households = await fillHouseholds(list.map((m) => m.code));
  const withHh = list.map((m) => ({
    ...m,
    level: 'municipality',
    households: households[m.code] ?? m.households ?? null,
    distribution: distributionFor(households[m.code] ?? m.households ?? null),
    distributionRate: DISTRIBUTION_RATE,
  }));
  return { source: households.__source, meta, municipalities: withHh };
}

export async function getMunicipalitiesByCodes(codes) {
  const { municipalities } = loadMunicipalities();
  const set = new Set(codes);
  const list = municipalities.filter((m) => set.has(m.code));
  const households = await fillHouseholds(codes);
  return list.map((m) => ({
    ...m,
    level: 'municipality',
    households: households[m.code] ?? m.households ?? null,
    distribution: distributionFor(households[m.code] ?? m.households ?? null),
    distributionRate: DISTRIBUTION_RATE,
  }));
}

// ---------- e-Stat 世帯数の充填 ----------
// ESTAT_APP_ID + ESTAT_STATS_DATA_ID(市区町村別世帯数の統計表) を設定すると真値を取得。
// 未設定時は各コード null（= 世帯数未取得）を返す。
let estatMemo = null;
async function fillHouseholds(codes) {
  const appId = process.env.ESTAT_APP_ID;
  const statsDataId = process.env.ESTAT_STATS_DATA_ID;
  if (!appId || !statsDataId) {
    const map = Object.fromEntries(codes.map((c) => [c, null]));
    map.__source = 'none';
    return map;
  }
  try {
    if (!estatMemo) estatMemo = await fetchEstatHouseholds(appId, statsDataId);
    const map = Object.fromEntries(codes.map((c) => [c, estatMemo[c] ?? null]));
    map.__source = 'e-stat';
    return map;
  } catch (e) {
    console.warn('[estat] household fetch failed:', e.message);
    const map = Object.fromEntries(codes.map((c) => [c, null]));
    map.__source = 'none';
    return map;
  }
}

// e-Stat getStatsData から 市区町村別世帯数を取得し { code: households } を返す。
// 分類ID/世帯数コード/時間軸は estatClient が自動検出し、環境変数で上書きできる。
async function fetchEstatHouseholds(appId, statsDataId) {
  const { households, meta } = await fetchMunicipalityHouseholds(appId, statsDataId, {
    householdClassId: process.env.ESTAT_HOUSEHOLD_CLASS,   // 例: tab / cat01
    householdCode: process.env.ESTAT_HOUSEHOLD_CODE,       // 世帯数の分類コード
    timeCode: process.env.ESTAT_TIME_CODE,                 // 時間軸コード（未指定は最新）
  });
  console.log(`[estat] 世帯数取得: ${meta.municipalityCount}市区町村 (世帯分類=${meta.household.name}, 時間=${meta.timeCode})`);
  return households;
}

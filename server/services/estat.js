// 市区町村の世帯数・エリアデータサービス
//
//   - 市区町村 (municipality): 全国マスタ(municipalities.json)。世帯数は e-Stat API で充填。
//   - 町丁目は services/towns.js（e-Stat 小地域の実境界・世帯数）を参照。
//
// 配布部数 = 世帯数 × DISTRIBUTION_RATE (要件: 最新世帯数/国勢調査世帯数の70%)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMunicipalityHouseholds } from './estatClient.js';
import { distanceMeters } from './geo.js';
import { DISTRIBUTION_RATE, distributionFor } from './distribution.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { DISTRIBUTION_RATE, distributionFor };

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

// ---------- ピン周辺の市区町村（町丁目の自動読込用）----------
// 都道府県をまたいで、代表点がピンから km 以内の市区町村を近い順に返す。
// 政令指定都市は区単位でデータがあるため、区を持つ親（例: 相模原市）は除外。

export function nearbyMunicipalities(lat, lng, { km = 6, limit = 8 } = {}) {
  const { municipalities } = loadMunicipalities();
  const isParent = (m) => municipalities.some((o) => o.code !== m.code && o.city.startsWith(m.city + ' '));
  return municipalities
    .map((m) => ({ code: m.code, pref: m.pref, city: m.city, distanceKm: distanceMeters(lat, lng, m.lat, m.lng) / 1000 }))
    .filter((m) => m.distanceKm <= km)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((m) => !isParent(m))
    .slice(0, limit)
    .map((m) => ({ ...m, distanceKm: +m.distanceKm.toFixed(2) }));
}

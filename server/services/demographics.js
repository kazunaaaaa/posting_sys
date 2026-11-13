// 町丁目のターゲット人数（年齢・性別）
//
// 実データ: e-Stat 国勢調査 小地域「男女・年齢(5歳階級)別人口」（ESTAT_APP_ID が必要）
//   市区町村ごとに <キャッシュ>/demo/<市区町村コード>.json に保存する。
// 推計: 年齢データが無い場合は、町丁目の人口(JINKO)を全国の年齢・男女構成で按分する（estimated=true）。
import fs from 'fs';
import path from 'path';
import { TOWN_DIR } from './towns.js';
import { listPrefectures } from './estat.js';
import { searchSmallAreaTables, pickAgeSexTable, fetchTownAgeSex } from './estatClient.js';

const DEMO_DIR = path.join(TOWN_DIR, 'demo');
const TABLES_PATH = path.join(DEMO_DIR, '_tables.json');
const memo = new Map();

// 全国の男女・年齢(5歳階級)別人口（令和2年国勢調査の概数・千人）— 推計用
const NATIONAL = [
  [0, 4, 2306, 2196], [5, 9, 2588, 2464], [10, 14, 2717, 2588], [15, 19, 2864, 2722], [20, 24, 3078, 2929],
  [25, 29, 3148, 2989], [30, 34, 3375, 3244], [35, 39, 3764, 3653], [40, 44, 4245, 4142], [45, 49, 4884, 4776],
  [50, 54, 4318, 4253], [55, 59, 3876, 3881], [60, 64, 3664, 3720], [65, 69, 4148, 4383], [70, 74, 4255, 4729],
  [75, 79, 3010, 3601], [80, 84, 2215, 3044], [85, 89, 1236, 2215], [90, 94, 400, 1100], [95, 99, 70, 330], [100, 120, 10, 70],
].map(([min, max, m, f]) => ({ min, max, m, f }));

export function normalizeProfile(p = {}) {
  const ageMin = Math.max(0, Math.min(120, Number.isFinite(+p.ageMin) ? +p.ageMin : 0));
  const ageMax = Math.max(ageMin, Math.min(120, Number.isFinite(+p.ageMax) && p.ageMax !== '' ? +p.ageMax : 120));
  const sex = ['male', 'female'].includes(p.sex) ? p.sex : 'all';
  const sexLabel = { all: '', male: '男性', female: '女性' }[sex];
  const ageLabel = ageMin === 0 && ageMax >= 120 ? '全年齢' : ageMax >= 120 ? `${ageMin}歳以上` : `${ageMin}〜${ageMax}歳`;
  return { ageMin, ageMax, sex, label: p.label || `${ageLabel}${sexLabel ? 'の' + sexLabel : ''}` };
}

// 年齢区分 bands のうち、プロフィールに当てはまる人数（区分の一部だけ重なる場合は比例配分）
export function countInBands(bands, profile) {
  const { ageMin, ageMax, sex } = normalizeProfile(profile);
  let total = 0, all = 0;
  for (const b of bands) {
    const bMax = b.max >= 120 ? b.min + 9 : b.max; // 「○歳以上」は約10歳幅とみなす
    const width = bMax - b.min + 1;
    const overlap = Math.max(0, Math.min(bMax, ageMax) - Math.max(b.min, ageMin) + 1);
    const people = sex === 'male' ? b.m : sex === 'female' ? b.f : b.m + b.f;
    total += (people * overlap) / width;
    all += b.m + b.f;
  }
  return { target: total, population: all };
}

export function nationalShare(profile) {
  const { target, population } = countInBands(NATIONAL, profile);
  return population ? target / population : 0;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; } }

function prefNameOf(cityCode) {
  return listPrefectures().find((p) => p.code === cityCode.slice(0, 2))?.pref || '';
}

// 都道府県ごとの統計表ID（見つけたら保存して再利用）
async function tableFor(appId, prefName) {
  const saved = readJson(TABLES_PATH) || {};
  if (saved[prefName]) return saved[prefName];
  let tables = await searchSmallAreaTables(appId, { searchWord: `男女 年齢 5歳階級 ${prefName}` });
  let t = pickAgeSexTable(tables, prefName);
  if (!t) { tables = await searchSmallAreaTables(appId, {}); t = pickAgeSexTable(tables, prefName); }
  if (!t) throw new Error(`${prefName}の「男女・年齢別人口（町丁・字等）」の統計表が見つかりません`);
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(TABLES_PATH, JSON.stringify({ ...saved, [prefName]: { id: t.id, title: t.title } }, null, 2));
  return { id: t.id, title: t.title };
}

/** 市区町村の町丁目別 年齢・男女人口（取得できなければ null） */
export async function getCityDemographics(cityCode, { fetchIfMissing = true } = {}) {
  if (memo.has(cityCode)) return memo.get(cityCode);
  const cachePath = path.join(DEMO_DIR, `${cityCode}.json`);
  const cached = readJson(cachePath);
  if (cached) { memo.set(cityCode, cached); return cached; }
  const appId = process.env.ESTAT_APP_ID;
  if (!appId || !fetchIfMissing) return null;
  const table = await tableFor(appId, prefNameOf(cityCode));
  const { towns, meta } = await fetchTownAgeSex(appId, table.id, cityCode);
  if (!Object.keys(towns).length) throw new Error(`統計表 ${table.id} に ${cityCode} の町丁目データがありません`);
  const data = { cityCode, table, meta, fetchedAt: new Date().toISOString(), towns };
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(data));
  memo.set(cityCode, data);
  return data;
}

/**
 * 町丁目ごとのターゲット人数
 * @returns {{ byCode: Record<string,{target:number,rate:number,population:number,estimated:boolean}>, source:'census'|'estimate'|'mixed', errors:string[] }}
 */
export async function computeTargets(towns, profile) {
  const prof = normalizeProfile(profile);
  const share = nationalShare(prof);
  const cities = [...new Set(towns.map((t) => t.cityCode || String(t.code).slice(0, 5)))];
  const demo = {};
  const errors = [];
  for (const c of cities) {
    try { demo[c] = await getCityDemographics(c); } catch (e) { demo[c] = null; errors.push(`${c}: ${e.message}`); }
  }
  const byCode = {};
  let real = 0, est = 0;
  for (const t of towns) {
    const d = demo[t.cityCode || String(t.code).slice(0, 5)]?.towns?.[t.code];
    if (d) {
      const { target, population } = countInBands(d.bands, prof);
      byCode[t.code] = { target: Math.round(target), population, rate: population ? target / population : 0, estimated: false };
      real++;
    } else {
      const pop = t.population ?? (t.households != null ? t.households * 2.2 : 0);
      byCode[t.code] = { target: Math.round(pop * share), population: pop, rate: share, estimated: true };
      est++;
    }
  }
  return { byCode, profile: prof, source: real && est ? 'mixed' : real ? 'census' : 'estimate', errors };
}

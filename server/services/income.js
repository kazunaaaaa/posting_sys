// 所得（市区町村の平均所得＝実データ ＋ 町丁目の所得指数＝推計）
//
// 実データ: 社会・人口統計体系 市区町村データ  課税対象所得 ÷ 納税義務者数（所得割）＝ 納税者1人あたり平均所得
// 推計:     国勢調査 小地域の「管理職・専門職の割合」「持ち家率」「夫婦と子どもの世帯の割合」「単身世帯の割合」を
//           市区町村内で比べ、平均=1.00 の所得指数にする（金額ではなく相対的な高さ）。
// 取得結果は <キャッシュ>/income/ に保存する。
import fs from 'fs';
import path from 'path';
import { TOWN_DIR } from './towns.js';
import { listPrefectures } from './estat.js';
import { findMunicipalIncomeTable, fetchMunicipalIncome, searchSmallAreaTables, fetchSmallAreaShare } from './estatClient.js';

export const INCOME_PREFS = { high: '所得が高めの地域', low: '所得が低めの地域' };

const DIR = path.join(TOWN_DIR, 'income');
const TABLES_PATH = path.join(DIR, '_tables.json');
const memo = new Map();

// 町丁目の指標（weight: 重み、sign: +1 は高いほど所得が高い傾向）
export const INDICATORS = {
  whiteCollar: { label: '管理職・専門職の割合', search: '職業 大分類 就業者', title: /職業/, numerator: [/^管理的職業/, /^専門的・技術的職業/], weight: 0.4, sign: 1 },
  own:         { label: '持ち家率', search: '住宅の所有の関係 一般世帯', title: /所有の関係/, numerator: [/^持ち家/], weight: 0.3, sign: 1 },
  family:      { label: '夫婦と子どもの世帯の割合', search: '世帯の家族類型 一般世帯', title: /家族類型/, numerator: [/^夫婦と子供から成る世帯/], weight: 0.2, sign: 1 },
  single:      { label: '単身世帯の割合', search: '世帯の家族類型 一般世帯', title: /家族類型/, numerator: [/^単独世帯/], weight: 0.1, sign: -1 },
};

export function levelOf(index) {
  if (index == null) return '—';
  if (index >= 1.15) return '高い';
  if (index >= 1.05) return 'やや高い';
  if (index > 0.95) return '平均';
  if (index > 0.85) return 'やや低い';
  return '低い';
}

/**
 * 市区町村内の町丁目の所得指数（平均=1.00）
 * @param {string[]} codes 町丁目コード
 * @param {Record<string, Record<string, number>>} indicators { key: { code: share } }
 */
export function incomeIndexes(codes, indicators) {
  const stats = {};
  for (const [key, shares] of Object.entries(indicators)) {
    const vals = codes.map((c) => shares?.[c]).filter((v) => Number.isFinite(v));
    if (vals.length < 3) continue;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1e-9;
    stats[key] = { mean, sd };
  }
  const out = {};
  for (const c of codes) {
    let sum = 0, w = 0;
    const used = [];
    for (const [key, st] of Object.entries(stats)) {
      const v = indicators[key]?.[c];
      if (!Number.isFinite(v)) continue;
      const z = Math.max(-3, Math.min(3, (v - st.mean) / st.sd));
      sum += INDICATORS[key].sign * INDICATORS[key].weight * z;
      w += INDICATORS[key].weight;
      used.push(key);
    }
    const index = w ? Math.max(0.6, Math.min(1.6, 1 + 0.12 * (sum / w))) : null;
    out[c] = { index: index == null ? null : +index.toFixed(2), level: levelOf(index), used };
  }
  return out;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; } }
function saveJson(p, data) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(p, JSON.stringify(data)); }

async function tableFor(appId, prefName, key) {
  const saved = readJson(TABLES_PATH) || {};
  const spec = INDICATORS[key];
  const cacheKey = `${prefName}:${spec.search}`;
  if (saved[cacheKey]) return saved[cacheKey];
  const tables = await searchSmallAreaTables(appId, { searchWord: `${spec.search} ${prefName}` });
  const cands = tables.filter((t) => spec.title.test(t.text));
  const t = cands.find((x) => x.text.includes(prefName)) || cands[0];
  if (!t) throw new Error(`${prefName}の「${spec.label}」の統計表が見つかりません`);
  saveJson(TABLES_PATH, { ...saved, [cacheKey]: { id: t.id, title: t.title } });
  return { id: t.id, title: t.title };
}

const MUNI_PATH = path.join(DIR, '_municipal.json');

/** 市区町村の納税者1人あたり平均所得（実データ）。取得できなければ null */
export async function getMunicipalIncome(cityCode) {
  const saved = readJson(MUNI_PATH) || {};
  if (saved[cityCode] !== undefined) return saved[cityCode];
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return null;
  const t = await findMunicipalIncomeTable(appId);
  const v = await fetchMunicipalIncome(appId, t, cityCode);
  saveJson(MUNI_PATH, { ...(readJson(MUNI_PATH) || {}), [cityCode]: v ? { ...v, table: t.id } : null });
  return v;
}

/** 市区町村の所得データ（平均所得・町丁目の指標）。取れた分だけ返し、取れなかったものは errors に */
export async function getCityIncomeData(cityCode, { fetchIfMissing = true } = {}) {
  if (memo.has(cityCode)) return memo.get(cityCode);
  const cachePath = path.join(DIR, `${cityCode}.json`);
  const cached = readJson(cachePath);
  if (cached) { memo.set(cityCode, cached); return cached; }
  const appId = process.env.ESTAT_APP_ID;
  if (!appId || !fetchIfMissing) return null;

  const prefName = listPrefectures().find((p) => p.code === cityCode.slice(0, 2))?.pref || '';
  const data = { cityCode, municipal: null, indicators: {}, tables: {}, errors: [], fetchedAt: new Date().toISOString() };
  try { data.municipal = await getMunicipalIncome(cityCode); } catch (e) { data.errors.push(`平均所得: ${e.message}`); }
  const tableCache = new Map(); // 同じ表（家族類型）を2回取らない
  for (const key of Object.keys(INDICATORS)) {
    try {
      const t = await tableFor(appId, prefName, key);
      const spec = INDICATORS[key];
      const k = `${t.id}:${spec.numerator.map(String).join('|')}`;
      if (!tableCache.has(k)) tableCache.set(k, (await fetchSmallAreaShare(appId, t.id, cityCode, { numerator: spec.numerator })).shares);
      const shares = tableCache.get(k);
      if (Object.keys(shares).length) { data.indicators[key] = shares; data.tables[key] = t.id; }
      else data.errors.push(`${spec.label}: 町丁目のデータがありません`);
    } catch (e) { data.errors.push(`${INDICATORS[key].label}: ${e.message}`); }
  }
  // 何も取れなかった場合は保存しない（次回また取りにいく）
  if (data.municipal || Object.keys(data.indicators).length) saveJson(cachePath, data);
  memo.set(cityCode, data);
  return data;
}

/** 市区町村単位の所得指数（選択した市区町村の平均所得の平均 = 1.00） */
export async function computeMunicipalIncome(cityCodes) {
  const municipal = {}, errors = [];
  for (const c of cityCodes) {
    try { municipal[c] = await getMunicipalIncome(c); } catch (e) { municipal[c] = null; errors.push(`${c}: ${e.message}`); }
  }
  const vals = Object.values(municipal).filter((v) => v?.avgIncomeYen > 0).map((v) => v.avgIncomeYen);
  const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  const byCode = {};
  for (const c of cityCodes) {
    const v = municipal[c]?.avgIncomeYen;
    const index = mean && v ? +(v / mean).toFixed(2) : null;
    byCode[c] = { index, level: levelOf(index), estimated: false };
  }
  return { byCode, municipal, errors };
}

/**
 * 町丁目ごとの所得指数と、市区町村の平均所得
 * @returns {{ byCode: Record<string,{index:number|null, level:string, estimated:true}>, municipal: Record<string,{avgIncomeYen:number,year:string}|null>, errors: string[] }}
 */
export async function computeIncome(towns) {
  const byCity = new Map();
  for (const t of towns) {
    const c = t.cityCode || String(t.code).slice(0, 5);
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(t.code);
  }
  const byCode = {}, municipal = {}, errors = [];
  for (const [city, codes] of byCity) {
    let data = null;
    try { data = await getCityIncomeData(city); } catch (e) { errors.push(`${city}: ${e.message}`); }
    municipal[city] = data?.municipal || null;
    if (data?.errors?.length) errors.push(...data.errors.map((e) => `${city} ${e}`));
    // 指数は市区町村の全町丁目の中での相対位置（読み込んだ一部だけで比べない）
    // 上位の集計区分（大字など桁数の違うコード）は比較に含めない
    const len = String(codes[0]).length;
    const allCodes = [...new Set(Object.values(data?.indicators || {}).flatMap((sh) => Object.keys(sh)))].filter((c) => c.length === len);
    const idx = incomeIndexes(allCodes.length ? allCodes : codes, data?.indicators || {});
    for (const c of codes) byCode[c] = { ...(idx[c] || { index: null, level: '—', used: [] }), estimated: true };
  }
  return { byCode, municipal, errors };
}

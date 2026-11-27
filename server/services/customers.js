// 顧客の住所 → 町丁目（ジオコーディングを使わず、町丁目データとの照合だけで行う。外部には送らない）
//   「相模原市南区相南4-24-18-401」→ 相模原市南区 / 相南四丁目
//   「座間市相模が丘６－１０－１６」「相南１丁目２３番６号」「北葛飾郡杉戸町…」なども可
import { allMunicipalities } from './estat.js';
import { getTowns } from './towns.js';
import { townLabel, kanjiToNumber } from './exportArea.js';

const nfkc = (s) => String(s ?? '').normalize('NFKC');
// 住所の正規化: 全角→半角、ハイフン類を「-」に、空白を除く
export function normalizeAddress(s) {
  return nfkc(s).replace(/[‐‑‒–—―−ｰ－]/g, '-').replace(/(\d)ー(?=\d)/g, '$1-').replace(/\s+/g, '');
}
// 町名の比較用（ケ/ヶ/が、の/ノ/之 などのゆれを吸収）
const loose = (s) => s.replace(/[ヶケが]/g, 'ケ').replace(/[ノの之]/g, 'の').replace(/[ツっ]/g, 'つ');
const cityKey = (s) => nfkc(s).replace(/\s+/g, '');

const PREFS = /^(北海道|東京都|京都府|大阪府|.{2,3}?県)/;

let cityIndex = null;
function cities() {
  if (!cityIndex) {
    const list = allMunicipalities();
    cityIndex = list.map((m) => ({
      ...m,
      key: cityKey(m.city),
      // 政令市（区を持つ市）は区の一覧
      wards: list.filter((w) => w.code !== m.code && w.pref === m.pref && cityKey(w.city).startsWith(cityKey(m.city)) && /区$/.test(w.city)).map((w) => w.code),
    })).sort((a, b) => b.key.length - a.key.length); // 長い名前を先に（「相模原市南区」＞「相模原市」）
  }
  return cityIndex;
}

/** 住所 → { pref, city: {code, name, codes(読み込む市区町村)}, rest } */
export function splitAddress(pref, address) {
  let a = normalizeAddress(address);
  let p = nfkc(pref).trim();
  const pm = a.match(PREFS);
  if (pm && (!p || pm[1] === p)) { p = pm[1]; a = a.slice(pm[1].length); }
  const tryMatch = (s) => cities().find((c) => (!p || c.pref === p) && s.startsWith(c.key));
  let c = tryMatch(a);
  if (!c) { // 「○○郡△△町」→「△△町」
    const g = a.match(/^(.+?郡)(.+)$/);
    if (g) { c = tryMatch(g[2]); if (c) a = g[2]; }
  }
  if (!c) return { pref: p, city: null, rest: a };
  return { pref: c.pref, city: { code: c.code, name: c.city.replace(/\s+/g, ''), codes: c.wards.length ? c.wards : [c.code] }, rest: a.slice(c.key.length) };
}

// 町丁目の一覧 → 照合用の索引（町名の部分と丁目番号）
export function buildTownIndex(towns) {
  const items = [];
  for (const t of towns) {
    let name = nfkc(t.name).replace(/\s+/g, '').replace(/^(大字|字)/, '');
    const label = townLabel(name); // 「相南四丁目」→「相南(4)」
    const m = label.match(/^(.*)\((\d+)\)$/);
    items.push({ code: t.code, base: loose(m ? m[1] : name), n: m ? Number(m[2]) : null, town: t });
  }
  items.sort((a, b) => b.base.length - a.base.length);
  return items;
}

/**
 * 市区町村より後ろ（「相南4-24-18-401」）→ 町丁目
 * @returns {{ codes: string[], level: 'chome'|'town'|null, base?: string }}
 */
export function matchTown(rest, index) {
  let r = loose(String(rest || '').replace(/^(大字|字)/, ''));
  const hit = index.find((i) => i.base && r.startsWith(i.base));
  if (!hit) return { codes: [], level: null };
  const same = index.filter((i) => i.base === hit.base);
  const after = r.slice(hit.base.length);
  // 丁目: 「4-」「4丁目」「四丁目」「4番」「4」で終わる
  let n = null;
  const m1 = after.match(/^(\d+)(?:丁目|-|番|$)/);
  const m2 = after.match(/^([〇一二三四五六七八九十]+)丁目/);
  if (m1) n = Number(m1[1]); else if (m2) n = kanjiToNumber(m2[1]);
  const exact = n != null ? same.filter((i) => i.n === n) : [];
  if (exact.length) return { codes: exact.map((i) => i.code), level: 'chome', base: hit.base };
  const plain = same.filter((i) => i.n == null);
  if (plain.length && (n == null || !same.some((i) => i.n != null))) return { codes: plain.map((i) => i.code), level: 'chome', base: hit.base };
  // 丁目が分からない（「上鶴間」「上鶴間123-4」）→ その町の全丁目（人数は均等に割り振る）
  return { codes: same.map((i) => i.code), level: 'town', base: hit.base };
}

/**
 * 顧客の住所をまとめて照合する
 * @param {Array<{i:number, pref?:string, address:string}>} rows
 * @returns {{ results: Array<{i, codes, level, city}>, towns: Record<string,{name,city,lat,lng,households}>, cities: Array<{code,name,count}>, errors: string[] }}
 */
export async function matchCustomers(rows, { loadTowns = getTowns } = {}) {
  const results = [];
  const byCity = new Map();
  for (const r of rows) {
    const s = splitAddress(r.pref, r.address);
    if (!s.city) { results.push({ i: r.i, codes: [], level: null, reason: '市区町村が分かりません' }); continue; }
    const key = s.city.codes.join(',');
    if (!byCity.has(key)) byCity.set(key, { city: s.city, rows: [] });
    byCity.get(key).rows.push({ ...r, rest: s.rest });
  }
  const towns = {};
  const cityCount = new Map();
  const errors = [];
  for (const { city, rows: list } of byCity.values()) {
    const all = [];
    for (const code of city.codes) {
      try { all.push(...(await loadTowns(code)).towns); } catch (e) { errors.push(`${city.name}: ${e.message}`); }
    }
    if (!all.length) { for (const r of list) results.push({ i: r.i, codes: [], level: null, city: city.name, reason: '町丁目データを読み込めませんでした' }); continue; }
    const index = buildTownIndex(all);
    const byCode = new Map(all.map((t) => [t.code, t]));
    for (const r of list) {
      const m = matchTown(r.rest, index);
      results.push({ i: r.i, codes: m.codes, level: m.level, city: city.name, ...(m.level ? {} : { reason: '町名が見つかりません' }) });
      for (const c of m.codes) {
        const t = byCode.get(c);
        towns[c] ??= { name: t.name, city: t.city, cityCode: t.cityCode, lat: t.center.lat, lng: t.center.lng, households: t.households };
        cityCount.set(t.cityCode, (cityCount.get(t.cityCode) || 0) + 1 / m.codes.length);
      }
    }
  }
  const names = new Map(allMunicipalities().map((m) => [m.code, m.city.replace(/\s+/g, '')]));
  results.sort((a, b) => a.i - b.i);
  return {
    results, towns, errors: [...new Set(errors)],
    cities: [...cityCount].map(([code, count]) => ({ code, name: names.get(code) || code, count: Math.round(count * 10) / 10 })).sort((a, b) => b.count - a.count),
  };
}

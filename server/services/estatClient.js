// e-Stat API v3.0 クライアント（getStatsList / getMetaInfo / getStatsData）
// 市区町村別「世帯数」を取得し { 市区町村コード: 世帯数 } を返すことを目的とする。
//
// 参考: 政府統計の総合窓口(e-Stat) API仕様 3.0版
//   https://www.e-stat.go.jp/api/api-info/e-stat-manual3-0
const BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

// CLASS_INF の CLASS は要素1つだとオブジェクト、複数だと配列。常に配列へ正規化。
function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

async function call(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`e-Stat HTTP ${res.status}`);
  const json = await res.json();
  return json;
}

function checkResult(root, key) {
  const result = root?.[key]?.RESULT;
  if (!result) throw new Error('e-Stat: 不正なレスポンス（RESULTなし）');
  if (Number(result.STATUS) !== 0) {
    throw new Error(`e-Stat エラー[${result.STATUS}]: ${result.ERROR_MSG}`);
  }
}

// 統計表を検索（世帯数を含む表の statsDataId 候補を返す）
export async function searchTables(appId, { searchWord = '世帯数 市区町村', limit = 20 } = {}) {
  const json = await call('getStatsList', { appId, searchWord, limit });
  checkResult(json, 'GET_STATS_LIST');
  const tables = asArray(json.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF);
  return tables.map((t) => ({
    id: t['@id'],
    statName: t.STAT_NAME?.$,
    title: [t.TITLE?.$ ?? t.TITLE, t.TABLE_CATEGORY?.$].filter(Boolean).join(' / '),
    surveyDate: t.SURVEY_DATE,
    cycle: t.CYCLE,
  }));
}

// 統計表のメタ情報（分類）を取得
export async function getMeta(appId, statsDataId) {
  const json = await call('getMetaInfo', { appId, statsDataId });
  checkResult(json, 'GET_META_INFO');
  const classObjs = asArray(json.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ);
  return classObjs.map((o) => ({ id: o['@id'], name: o['@name'], classes: asArray(o.CLASS) }));
}

const HH_RE = /世帯(総)?数|総世帯数|一般世帯数/;

// メタから「世帯数」を表す分類ID・コードを検出（表章項目 tab か cat 系に存在）
export function detectHouseholdCode(classObjs) {
  for (const obj of classObjs) {
    // 完全一致優先（世帯数 / 世帯総数 / 総世帯数）
    let hit = obj.classes.find((c) => /^(世帯数|世帯総数|総世帯数|一般世帯数)$/.test((c['@name'] || '').trim()));
    if (!hit) hit = obj.classes.find((c) => HH_RE.test(c['@name'] || ''));
    if (hit) return { classId: obj.id, code: hit['@code'], name: hit['@name'], unit: hit['@unit'] };
  }
  return null;
}

// 地域分類のID（通常 'area'）を検出
export function detectAreaClassId(classObjs) {
  const byId = classObjs.find((o) => o.id === 'area');
  if (byId) return 'area';
  const byName = classObjs.find((o) => /地域|市区町村|全国/.test(o.name || ''));
  return byName?.id ?? 'area';
}

// 時間軸の最新コードを検出
export function detectLatestTime(classObjs) {
  const t = classObjs.find((o) => o.id === 'time');
  if (!t || !t.classes.length) return null;
  return t.classes.map((c) => c['@code']).sort().slice(-1)[0];
}

function cdParam(classId) {
  return 'cd' + classId.charAt(0).toUpperCase() + classId.slice(1);
}

// 5桁の市区町村コードか（全国 00000・都道府県 NN000 は除外）
export function isMunicipalityCode(code) {
  return /^\d{5}$/.test(code) && code !== '00000' && !/^\d{2}000$/.test(code);
}

// 市区町村別世帯数を取得。opts で自動検出を上書き可能。
// 返り値: { households: {code: number}, meta: {...}, sampleAreas: [...] }
export async function fetchMunicipalityHouseholds(appId, statsDataId, opts = {}) {
  const classObjs = await getMeta(appId, statsDataId);
  const hh = opts.householdClassId && opts.householdCode
    ? { classId: opts.householdClassId, code: opts.householdCode }
    : detectHouseholdCode(classObjs);
  if (!hh) throw new Error('この統計表に「世帯数」の分類が見つかりません。別のstatsDataIdを指定してください。');
  const areaId = detectAreaClassId(classObjs);
  const timeCode = opts.timeCode ?? detectLatestTime(classObjs);

  const params = {
    appId,
    statsDataId,
    [cdParam(hh.classId)]: hh.code,
    metaGetFlg: 'N',
    cntGetFlg: 'N',
    limit: 100000,
  };
  if (timeCode) params[cdParam('time')] = timeCode;

  const json = await call('getStatsData', params);
  checkResult(json, 'GET_STATS_DATA');
  const values = asArray(json.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE);

  const households = {};
  const areaAttr = '@' + areaId;
  for (const v of values) {
    const code = v[areaAttr] ?? v['@area'];
    const val = Number(v['$']);
    if (code && isMunicipalityCode(code) && Number.isFinite(val)) households[code] = val;
  }
  return {
    households,
    meta: {
      statsDataId,
      household: hh,
      areaId,
      timeCode,
      totalValues: values.length,
      municipalityCount: Object.keys(households).length,
    },
  };
}

// ======================================================================
// 小地域（町丁・字等）の 男女・年齢(5歳階級)別人口
//   getStatsList の searchKind=2（小地域・地域メッシュ）で統計表を探し、
//   メタ情報から「男女」「年齢」の分類を自動判定して取得する。
// ======================================================================
const textOf = (v) => (v == null ? '' : typeof v === 'object' ? String(v.$ ?? '') : String(v));

// 小地域の統計表を検索
export async function searchSmallAreaTables(appId, { searchWord = '男女 年齢 5歳階級', surveyYear = '2020' } = {}) {
  const json = await call('getStatsList', {
    appId, searchKind: 2, statsCode: '00200521', searchWord, surveyYears: surveyYear, limit: 200,
  });
  checkResult(json, 'GET_STATS_LIST');
  return asArray(json.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF).map((t) => ({
    id: t['@id'],
    title: textOf(t.TITLE),
    statName: textOf(t.STAT_NAME),
    collectArea: textOf(t.COLLECT_AREA),
    surveyDate: String(t.SURVEY_DATE ?? ''),
    text: [textOf(t.TITLE), textOf(t.STATISTICS_NAME), textOf(t.COLLECT_AREA), textOf(t.TITLE_SPEC?.TABLE_NAME)].join(' '),
  }));
}

// 都道府県に合う「男女・年齢(5歳階級)別人口（町丁・字等）」の表を選ぶ
export function pickAgeSexTable(tables, prefName) {
  const isAgeSex = (t) => /年齢/.test(t.text) && /5歳|５歳/.test(t.text) && /男女/.test(t.text);
  const cands = tables.filter(isAgeSex);
  return cands.find((t) => t.text.includes(prefName)) || (cands.length === 1 ? cands[0] : null) || cands[0] || null;
}

// 「0～4歳」「100歳以上」→ [min, max]。まとめ（再掲・15～64歳など幅広）や不詳は null
export function parseAgeBand(name) {
  const s = String(name).replace(/\s/g, '');
  if (/再掲|不詳|総数|平均|総年齢/.test(s)) return null;
  let m = s.match(/^(\d+)[～~〜\-－](\d+)歳$/);
  if (m) { const a = +m[1], b = +m[2]; return b - a === 4 ? [a, b] : null; }
  m = s.match(/^(\d+)歳以上$/);
  if (m && +m[1] >= 75) return [+m[1], 120];
  return null;
}

export function detectAgeSexClasses(classObjs) {
  let sex = null, age = null, measure = null;
  for (const o of classObjs) {
    const names = o.classes.map((c) => String(c['@name'] || '').trim());
    if (!sex && names.some((n) => /^男/.test(n)) && names.some((n) => /^女/.test(n))) {
      sex = {
        classId: o.id,
        male: o.classes.find((c) => /^男/.test(c['@name']))['@code'],
        female: o.classes.find((c) => /^女/.test(c['@name']))['@code'],
      };
      continue;
    }
    let bands = o.classes.map((c) => ({ code: c['@code'], band: parseAgeBand(c['@name']) })).filter((x) => x.band);
    if (!age && bands.length >= 10) {
      // 「○歳以上」は5歳刻みの続き（最上位）の1つだけを使う（85歳以上と85～89歳の二重計上を防ぐ）
      const closedMax = Math.max(...bands.filter((b) => b.band[1] < 120).map((b) => b.band[1]));
      bands = bands.filter((b) => b.band[1] < 120 || b.band[0] === closedMax + 1);
      age = { classId: o.id, bands };
      continue;
    }
    // 表章項目に「人口」と「平均年齢」等が混在する場合は人口だけ
    const pop = o.classes.find((c) => /人口/.test(c['@name']) && !/平均|総年齢/.test(c['@name']));
    if (!measure && pop && o.classes.length > 1 && o.id !== 'area' && o.id !== 'time') measure = { classId: o.id, code: pop['@code'] };
  }
  return { sex, age, measure };
}

// 市区町村内の町丁目ごとの男女・年齢別人口 → { areaCode: { bands:[{min,max,m,f}] } }
export async function fetchTownAgeSex(appId, statsDataId, cityCode) {
  const classObjs = await getMeta(appId, statsDataId);
  const { sex, age, measure } = detectAgeSexClasses(classObjs);
  if (!sex || !age) throw new Error('統計表から「男女」「年齢(5歳階級)」の分類を判定できませんでした');
  const areaObj = classObjs.find((o) => o.id === 'area');
  const areaCodes = (areaObj?.classes || []).map((c) => String(c['@code'])).filter((c) => c.startsWith(cityCode)).sort();
  const timeCode = detectLatestTime(classObjs);

  const base = { appId, statsDataId, metaGetFlg: 'N', cntGetFlg: 'N', limit: 100000 };
  base[cdParam(sex.classId)] = [sex.male, sex.female].join(',');
  if (measure) base[cdParam(measure.classId)] = measure.code;
  if (timeCode) base.cdTime = timeCode;
  if (areaCodes.length) { base.cdAreaFrom = areaCodes[0]; base.cdAreaTo = areaCodes[areaCodes.length - 1]; }

  const bandByCode = new Map(age.bands.map((b) => [b.code, b.band]));
  const sexAttr = '@' + sex.classId, ageAttr = '@' + age.classId;
  const out = {};
  let start = null;
  for (let page = 0; page < 30; page++) {
    const json = await call('getStatsData', start ? { ...base, startPosition: start } : base);
    checkResult(json, 'GET_STATS_DATA');
    const sd = json.GET_STATS_DATA?.STATISTICAL_DATA;
    for (const v of asArray(sd?.DATA_INF?.VALUE)) {
      const area = String(v['@area'] ?? '');
      if (!area.startsWith(cityCode)) continue;
      const band = bandByCode.get(v[ageAttr]);
      if (!band) continue;
      const n = Number(String(v.$).replace(/,/g, ''));
      const val = Number.isFinite(n) ? n : 0; // 秘匿（-・X）は0
      const rec = (out[area] ??= { bands: new Map() });
      const key = band.join('-');
      const b = rec.bands.get(key) || { min: band[0], max: band[1], m: 0, f: 0 };
      if (v[sexAttr] === sex.male) b.m += val; else if (v[sexAttr] === sex.female) b.f += val;
      rec.bands.set(key, b);
    }
    start = sd?.RESULT_INF?.NEXT_KEY;
    if (!start) break;
  }
  const result = {};
  for (const [area, rec] of Object.entries(out)) {
    result[area] = { bands: [...rec.bands.values()].sort((a, b) => a.min - b.min) };
  }
  return { towns: result, meta: { statsDataId, sexClass: sex.classId, ageClass: age.classId, bands: age.bands.length, timeCode, areaCount: Object.keys(result).length } };
}

// ======================================================================
// 市区町村の平均所得（実データ）
//   社会・人口統計体系 市区町村データ（C 経済基盤）
//   課税対象所得(C120110, 千円) ÷ 納税義務者数（所得割）(C120120, 人)
// ======================================================================
export const MUNICIPAL_ECON_TABLES = ['0000020203'];
const isIncome = (c) => /C120110|課税対象所得/.test(`${c['@code']} ${c['@name']}`);
const isTaxpayers = (c) => /C120120|納税義務者数/.test(`${c['@code']} ${c['@name']}`);

export async function findMunicipalIncomeTable(appId) {
  const ids = [...MUNICIPAL_ECON_TABLES];
  try {
    const json = await call('getStatsList', { appId, statsCode: '00200502', searchWord: '課税対象所得', limit: 50 });
    checkResult(json, 'GET_STATS_LIST');
    for (const t of asArray(json.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF)) if (!ids.includes(t['@id'])) ids.push(t['@id']);
  } catch { /* 既定の表で試す */ }
  for (const id of ids) {
    try {
      const objs = await getMeta(appId, id);
      for (const o of objs) {
        const inc = o.classes.find(isIncome), tax = o.classes.find(isTaxpayers);
        if (inc && tax) return { id, classId: o.id, incomeCode: inc['@code'], taxpayerCode: tax['@code'] };
      }
    } catch { /* 次の候補 */ }
  }
  throw new Error('「課税対象所得」「納税義務者数」を含む統計表が見つかりません');
}

/** 市区町村の納税者1人あたり平均所得（円）と年 */
export async function fetchMunicipalIncome(appId, table, cityCode) {
  const json = await call('getStatsData', {
    appId, statsDataId: table.id, cdArea: cityCode, [cdParam(table.classId)]: `${table.incomeCode},${table.taxpayerCode}`,
    metaGetFlg: 'N', cntGetFlg: 'N', limit: 1000,
  });
  checkResult(json, 'GET_STATS_DATA');
  const byTime = {};
  for (const v of asArray(json.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE)) {
    const n = Number(String(v.$).replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const t = (byTime[v['@time']] ??= {});
    if (v['@' + table.classId] === table.incomeCode) t.income = n;
    if (v['@' + table.classId] === table.taxpayerCode) t.taxpayers = n;
  }
  const times = Object.keys(byTime).filter((t) => byTime[t].income && byTime[t].taxpayers).sort();
  if (!times.length) return null;
  const latest = byTime[times[times.length - 1]];
  return { avgIncomeYen: Math.round((latest.income * 1000) / latest.taxpayers), year: times[times.length - 1].slice(0, 4), taxpayers: latest.taxpayers };
}

// ======================================================================
// 小地域（町丁目）の割合データ（持ち家率・世帯の家族類型・職業など）
//   対象の分類で「分子にあたる区分」と「総数」を取り、他の分類は総数に固定する。
// ======================================================================
// 区分名の先頭の符号（「A 管理的職業従事者」「1_持ち家」「(1) 単独世帯」など）を除く
export function cleanClassName(name) {
  return String(name ?? '').trim().replace(/^[（(]?[A-Za-zＡ-Ｚ0-9０-９]{1,4}[)）]?[\s_.．:：・　]+/, '').trim();
}

export async function fetchSmallAreaShare(appId, statsDataId, cityCode, { numerator, total = /^総数/ }) {
  const nums = Array.isArray(numerator) ? numerator : [numerator];
  const classObjs = await getMeta(appId, statsDataId);
  const nameOf = (c) => cleanClassName(c['@name']);
  const target = classObjs.find((o) => o.id !== 'area' && o.id !== 'time' && o.classes.some((c) => nums.some((r) => r.test(nameOf(c)))));
  if (!target) throw new Error(`統計表 ${statsDataId} に該当する区分がありません（${nums.map(String).join(', ')}）`);
  const numCodes = target.classes.filter((c) => nums.some((r) => r.test(nameOf(c)))).map((c) => c['@code']);
  const totalClass = target.classes.find((c) => total.test(nameOf(c)));
  const sumAll = !totalClass; // 総数が無い表は、再掲以外の全区分の合計を分母にする
  const totalCodes = totalClass ? [totalClass['@code']] : target.classes.filter((c) => !/再掲/.test(c['@name'])).map((c) => c['@code']);

  const params = { appId, statsDataId, metaGetFlg: 'N', cntGetFlg: 'N', limit: 100000 };
  params[cdParam(target.id)] = [...new Set([...numCodes, ...totalCodes])].join(',');
  for (const o of classObjs) {
    if (o === target || o.id === 'area' || o.id === 'time') continue;
    const pick = (o.id === 'tab' && o.classes.find((c) => /世帯|人数|人口|就業者/.test(c['@name'])))
      || o.classes.find((c) => /総数|合計/.test(c['@name'])) || o.classes[0];
    if (pick) params[cdParam(o.id)] = pick['@code'];
  }
  const areaObj = classObjs.find((o) => o.id === 'area');
  const areaCodes = (areaObj?.classes || []).map((c) => String(c['@code'])).filter((c) => c.startsWith(cityCode)).sort();
  if (areaCodes.length) { params.cdAreaFrom = areaCodes[0]; params.cdAreaTo = areaCodes[areaCodes.length - 1]; }
  const timeCode = detectLatestTime(classObjs);
  if (timeCode) params.cdTime = timeCode;

  const acc = {};
  let start = null;
  for (let page = 0; page < 30; page++) {
    const json = await call('getStatsData', start ? { ...params, startPosition: start } : params);
    checkResult(json, 'GET_STATS_DATA');
    const sd = json.GET_STATS_DATA?.STATISTICAL_DATA;
    for (const v of asArray(sd?.DATA_INF?.VALUE)) {
      const area = String(v['@area'] ?? '');
      if (!area.startsWith(cityCode)) continue;
      const n = Number(String(v.$).replace(/,/g, ''));
      const val = Number.isFinite(n) ? n : 0;
      const code = v['@' + target.id];
      const a = (acc[area] ??= { num: 0, total: 0 });
      if (numCodes.includes(code)) a.num += val;
      if (totalCodes.includes(code)) a.total += val;
    }
    start = sd?.RESULT_INF?.NEXT_KEY;
    if (!start) break;
  }
  const shares = {};
  for (const [area, a] of Object.entries(acc)) if (a.total > 0) shares[area] = a.num / a.total;
  return { shares, meta: { statsDataId, classId: target.id, numerator: numCodes, total: totalCodes.length } };
}

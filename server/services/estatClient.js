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

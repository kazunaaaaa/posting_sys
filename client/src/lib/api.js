const BASE = '/api';

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = [j.error, j.hint].filter(Boolean).join('\n'); } catch { /* noop */ }
    throw new Error(detail || `${path} ${res.status}`);
  }
  return res.json();
}
function post(path, body) {
  return req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export const api = {
  config: () => req('/config'),
  // 町丁目（e-Stat 小地域の実境界・世帯数）
  towns: (city) => req('/towns?city=' + encodeURIComponent(city)),
  townsStatus: () => req('/towns/status'),
  // 市区町村（全国）
  prefectures: () => req('/municipalities/prefectures'),
  municipalities: ({ pref, keyword } = {}) => {
    const q = new URLSearchParams();
    if (pref) q.set('pref', pref);
    if (keyword) q.set('keyword', keyword);
    return req('/municipalities?' + q.toString());
  },
  boundaries: (codes) => post('/municipalities/boundaries', { codes }),
  // ピン周辺の市区町村（県境をまたぐ）
  nearby: (lat, lng, km = 6, limit = 8) =>
    req(`/municipalities/nearby?lat=${lat}&lng=${lng}&km=${km}&limit=${limit}`),
  // 競合・分析・見積
  businessTypes: () => req('/competitors/business-types'),
  searchCompetitors: (businessTypeId, codes, level) => post('/competitors/search', { businessTypeId, codes, level }),
  analyze: (codes, level, businessTypeId, competitors, unitCost, profile, incomePref, coverRate, extra = {}) =>
    post('/analyze', { codes, level, businessTypeId, competitors, unitCost, profile, incomePref: incomePref || null, coverRate, ...extra }),
  // 顧客の住所 → 町丁目（住所だけを送る）
  matchCustomers: (rows) => post('/customers/match', { rows }),
  // 顧客データで配布エリアを見直す（傾向・削除/追加の提案・前回との差分の根拠）
  reviewCustomers: (payload) => post('/customers/review', payload),
  // AI最適エリアの作成（ターゲット・川や道路の分断を考慮）
  optimizeArea: (payload) => post('/optimize/area', payload),
  importAreaTable: (text) => post('/import/area-table', { text }),
  pricingCompanies: () => req('/pricing/companies'),
  quotes: (codes, level) => post('/pricing/quotes', { codes, level }),
  // 配布部数表（Excel）: { blob, filename }
  exportAreaXlsx: async (payload) => {
    const res = await fetch(BASE + '/export/area-xlsx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* noop */ }
      throw new Error(msg);
    }
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : 'エリア表.xlsx' };
  },
};

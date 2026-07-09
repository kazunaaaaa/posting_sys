const BASE = '/api';

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
function post(path, body) {
  return req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export const api = {
  config: () => req('/config'),
  // 町丁目（小地域）
  areas: () => req('/areas'),
  // 市区町村（全国）
  prefectures: () => req('/municipalities/prefectures'),
  municipalities: ({ pref, keyword } = {}) => {
    const q = new URLSearchParams();
    if (pref) q.set('pref', pref);
    if (keyword) q.set('keyword', keyword);
    return req('/municipalities?' + q.toString());
  },
  boundaries: (codes) => post('/municipalities/boundaries', { codes }),
  // 競合・分析・見積
  businessTypes: () => req('/competitors/business-types'),
  searchCompetitors: (businessTypeId, codes, level) => post('/competitors/search', { businessTypeId, codes, level }),
  analyze: (codes, level, businessTypeId, competitors, unitCost) =>
    post('/analyze', { codes, level, businessTypeId, competitors, unitCost }),
  pricingCompanies: () => req('/pricing/companies'),
  quotes: (codes, level) => post('/pricing/quotes', { codes, level }),
};

const BASE = '/api';

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export const api = {
  config: () => req('/config'),
  areas: () => req('/areas'),
  businessTypes: () => req('/competitors/business-types'),
  searchCompetitors: (businessTypeId, codes) =>
    req('/competitors/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessTypeId, codes }),
    }),
  analyze: (codes, businessTypeId, competitors, unitCost) =>
    req('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, businessTypeId, competitors, unitCost }),
    }),
};

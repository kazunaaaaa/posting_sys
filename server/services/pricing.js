// 配布会社の原価・見積サービス
// 将来的に各社の実原価/見積単価を area(市区町村・町丁目)コード単位で蓄積していくための土台。
// PRICING_DATA_PATH で外部データに差し替え可能。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cache = null;
function load() {
  if (!cache) {
    const p = process.env.PRICING_DATA_PATH || path.join(__dirname, '..', 'data', 'pricing.sample.json');
    cache = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return cache;
}

export function companies() {
  return load().companies.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    defaultRate: c.defaultRate,
    coverage: c.coverage,
  }));
}

function coversArea(company, code) {
  if (!company.coverage?.length) return true;
  return company.coverage.some((pref) => code.startsWith(pref));
}

// エリアコードに対する各社の単価(原価/見積)を返す
function ratesForArea(code) {
  const { companies } = load();
  const rows = [];
  for (const c of companies) {
    if (!coversArea(c, code)) continue;
    const r = c.rates?.[code];
    const cost = r?.cost ?? c.defaultRate;
    const quote = r?.quote ?? +(cost * (c.quoteMarkup ?? 1.35)).toFixed(2);
    rows.push({ companyId: c.id, name: c.name, color: c.color, cost, quote, estimated: !r });
  }
  return rows;
}

// 選択エリア群の見積: エリアごとに各社の単価 + 最安値、配布部数から金額を算出
export function getQuotes(areas) {
  const perArea = areas.map((a) => {
    const rates = ratesForArea(a.code);
    const cheapest = rates.reduce((m, r) => (r.quote < (m?.quote ?? Infinity) ? r : m), null);
    const dist = a.distribution ?? 0;
    return {
      code: a.code,
      name: a.name || a.city,
      distribution: dist,
      rates: rates.map((r) => ({
        ...r,
        costAmount: dist ? Math.round(dist * r.cost) : null,
        quoteAmount: dist ? Math.round(dist * r.quote) : null,
      })),
      cheapest: cheapest ? { ...cheapest, quoteAmount: dist ? Math.round(dist * cheapest.quote) : null } : null,
    };
  });

  // 会社ごとの合計（カバー範囲内エリアのみ）
  const totals = {};
  for (const a of perArea) {
    for (const r of a.rates) {
      const t = (totals[r.companyId] ??= { companyId: r.companyId, name: r.name, color: r.color, cost: 0, quote: 0, areas: 0 });
      t.cost += r.costAmount ?? 0;
      t.quote += r.quoteAmount ?? 0;
      t.areas += 1;
    }
  }
  return { perArea, companyTotals: Object.values(totals).sort((a, b) => a.quote - b.quote) };
}

// スコアリングのコスト軸に使う: エリアコード→最安見積単価(円/部)
export function cheapestRateMap(codes) {
  const map = {};
  for (const code of codes) {
    const rates = ratesForArea(code);
    if (rates.length) map[code] = Math.min(...rates.map((r) => r.quote));
  }
  return map;
}

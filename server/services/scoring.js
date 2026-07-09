// 最適エリア スコアリングエンジン
// 各エリアを「到達・競合機会・配布効率・コスト」の4軸で0-100点化し総合スコアを算出。
// 市区町村(重心のみ)・町丁目(ポリゴンあり)いずれにも対応。世帯数nullは対象外。
import { pointInPolygon, centroid, distanceMeters } from './geo.js';

const WEIGHTS = {
  reach: 0.35,
  opportunity: 0.30,
  efficiency: 0.20,
  cost: 0.15,
};

function areaCenter(a) {
  return a.center ?? (a.polygon ? centroid(a.polygon) : null);
}

// 競合を各エリアへ割り当て（ポリゴン内包 or 最近傍エリア）
function assignCompetitors(areas, competitors) {
  const counts = Object.fromEntries(areas.map((a) => [a.code, 0]));
  for (const comp of competitors) {
    let target = null;
    for (const a of areas) {
      if (a.polygon && pointInPolygon(comp.lng, comp.lat, a.polygon)) {
        target = a.code;
        break;
      }
    }
    if (!target) {
      let best = Infinity;
      for (const a of areas) {
        const c = areaCenter(a);
        if (!c) continue;
        const d = distanceMeters(comp.lat, comp.lng, c.lat, c.lng);
        // 市区町村は広いので割当半径を広めに
        const radius = a.level === 'municipality' ? 6000 : 800;
        if (d < best && d < radius) { best = d; target = a.code; }
      }
    }
    if (target) counts[target] += 1;
  }
  return counts;
}

function normalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

// options: { unitCost, rateMap: {code: 円/部} }
export function scoreAreas(allAreas, competitors = [], options = {}) {
  const unitCost = options.unitCost ?? 5.5;
  const rateMap = options.rateMap ?? {};

  // 世帯数が取得できているエリアのみスコア対象
  const areas = allAreas.filter((a) => a.households != null && a.distribution != null);
  const skipped = allAreas.filter((a) => a.households == null).map((a) => ({ code: a.code, name: a.name || a.city }));
  if (!areas.length) return { areas: [], best: null, weights: WEIGHTS, skipped, unitCost };

  const compCounts = assignCompetitors(areas, competitors);

  const households = areas.map((a) => a.households);
  const densities = areas.map((a) => a.householdDensity ?? a.households);
  const opportunity = areas.map((a) => a.households / (compCounts[a.code] + 1));
  const costEff = areas.map((a) => {
    const rate = rateMap[a.code] ?? unitCost;
    return a.households / (a.distribution * rate + 1);
  });

  const nReach = normalize(households);
  const nOpp = normalize(opportunity);
  const nEff = normalize(densities);
  const nCost = normalize(costEff);

  const scored = areas.map((a, i) => {
    const rate = rateMap[a.code] ?? unitCost;
    const breakdown = {
      reach: Math.round(nReach[i] * 100),
      opportunity: Math.round(nOpp[i] * 100),
      efficiency: Math.round(nEff[i] * 100),
      cost: Math.round(nCost[i] * 100),
    };
    const score =
      nReach[i] * WEIGHTS.reach +
      nOpp[i] * WEIGHTS.opportunity +
      nEff[i] * WEIGHTS.efficiency +
      nCost[i] * WEIGHTS.cost;
    return {
      code: a.code,
      name: a.name || a.city,
      city: a.city,
      level: a.level,
      households: a.households,
      distribution: a.distribution,
      unitCost: rate,
      estimatedCost: Math.round(a.distribution * rate),
      competitorCount: compCounts[a.code],
      competitorPer1000Households: +((compCounts[a.code] / a.households) * 1000).toFixed(2),
      score: Math.round(score * 100),
      breakdown,
    };
  });

  scored.sort((x, y) => y.score - x.score);
  return {
    weights: WEIGHTS,
    unitCost,
    areas: scored,
    best: scored[0] ?? null,
    skipped,
    totals: {
      households: households.reduce((s, v) => s + v, 0),
      distribution: areas.reduce((s, a) => s + a.distribution, 0),
      competitors: competitors.length,
      estimatedCost: scored.reduce((s, a) => s + a.estimatedCost, 0),
    },
  };
}

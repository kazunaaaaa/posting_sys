// 最適エリア スコアリングエンジン
// 各エリアを「到達・競合機会・配布効率・コスト」の4軸で0-100点化し総合スコアを算出。
import { pointInPolygon, centroid, distanceMeters } from './geo.js';

const WEIGHTS = {
  reach: 0.35, // 世帯数（配布到達数）
  opportunity: 0.30, // 競合の少なさ（ブルーオーシャン度）
  efficiency: 0.20, // 世帯密度（配布の歩留まり）
  cost: 0.15, // コスト効率
};

// 競合を各エリアへ割り当て（ポリゴン内包 or 最近傍エリア）
function assignCompetitors(areas, competitors) {
  const counts = Object.fromEntries(areas.map((a) => [a.code, 0]));
  for (const comp of competitors) {
    let target = null;
    for (const a of areas) {
      if (pointInPolygon(comp.lng, comp.lat, a.polygon)) {
        target = a.code;
        break;
      }
    }
    if (!target) {
      // ポリゴン外なら最近傍エリアへ（近接する競合として弱くカウント）
      let best = Infinity;
      for (const a of areas) {
        const c = a.center ?? centroid(a.polygon);
        const d = distanceMeters(comp.lat, comp.lng, c.lat, c.lng);
        if (d < best && d < 800) {
          best = d;
          target = a.code;
        }
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

// options: { unitCost: 円/部 }
export function scoreAreas(areas, competitors = [], options = {}) {
  const unitCost = options.unitCost ?? 5.5; // 1部あたり配布単価(円)の既定
  if (!areas.length) return { areas: [], best: null, weights: WEIGHTS };

  const compCounts = assignCompetitors(areas, competitors);

  const households = areas.map((a) => a.households);
  const densities = areas.map((a) => a.householdDensity ?? a.households);
  // 競合機会 = 世帯数 / (競合数+1) が大きいほど良い
  const opportunity = areas.map((a) => a.households / (compCounts[a.code] + 1));
  // コスト効率 = 到達世帯 / 配布コスト（部あたり）→ 一定だが将来のエリア別単価に備え変数化
  const costEff = areas.map((a) => a.households / (a.distribution * unitCost + 1));

  const nReach = normalize(households);
  const nOpp = normalize(opportunity);
  const nEff = normalize(densities);
  const nCost = normalize(costEff);

  const scored = areas.map((a, i) => {
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
      name: a.name,
      city: a.city,
      households: a.households,
      distribution: a.distribution,
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
    totals: {
      households: households.reduce((s, v) => s + v, 0),
      distribution: areas.reduce((s, a) => s + a.distribution, 0),
      competitors: competitors.length,
      estimatedCost: Math.round(areas.reduce((s, a) => s + a.distribution, 0) * unitCost),
    },
  };
}

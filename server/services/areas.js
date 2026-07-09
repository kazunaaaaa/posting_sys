// コード + 粒度(level) からエリアを解決する共通ヘルパー。
// - town(町丁目): サンプル（ポリゴン・世帯数あり）
// - municipality(市区町村): 全国マスタ（世帯数はe-Stat充填） + 境界はオンデマンド取得して結合
import { getSmallAreasByCodes, getMunicipalitiesByCodes, distributionFor } from './estat.js';
import { getBoundaries } from './boundaries.js';
import { areaKm2 } from './geo.js';

export async function resolveAreas(codes, level = 'municipality', { withBoundary = true } = {}) {
  if (!codes?.length) return [];
  if (level === 'town') {
    return getSmallAreasByCodes(codes);
  }
  const munis = await getMunicipalitiesByCodes(codes);
  if (!withBoundary) {
    return munis.map((m) => ({ ...m, center: { lat: m.lat, lng: m.lng } }));
  }
  const boundaries = await getBoundaries(codes);
  const bmap = Object.fromEntries(boundaries.map((b) => [b.code, b]));
  return munis.map((m) => {
    const b = bmap[m.code];
    const polygon = b?.polygons?.[0] ?? null; // 主ポリゴン（スコアの内包判定用）
    const km2 = b?.areaKm2 ?? null;
    return {
      ...m,
      center: b?.center ?? { lat: m.lat, lng: m.lng },
      polygon,
      polygons: b?.polygons ?? null,
      areaKm2: km2,
      householdDensity: m.households != null && km2 ? +(m.households / Math.max(km2, 0.01)).toFixed(0) : null,
    };
  });
}

// 「📍から約 N 部を追加」: ピンに近い町丁目から順に、目標部数に最も近くなるまで加える
import { distanceMeters } from './geo.js';

/**
 * @param {Array<{code:string, center:{lat:number,lng:number}, distribution:number|null}>} candidates 未選択の町丁目
 * @param {{lat:number,lng:number}} pin
 * @param {number} target 目標部数
 * @returns {{codes:string[], sum:number, maxDistanceKm:number}}
 */
export function pickByCount(candidates, pin, target) {
  const sorted = candidates
    .filter((t) => t.center && t.distribution > 0)
    .map((t) => ({ ...t, d: distanceMeters(pin.lat, pin.lng, t.center.lat, t.center.lng) }))
    .sort((a, b) => a.d - b.d);
  const codes = [];
  let sum = 0;
  let maxD = 0;
  for (const t of sorted) {
    if (sum >= target) break;
    const over = sum + t.distribution - target;
    // 加えると目標を超える場合は、超過のほうが不足より大きければ加えない（「約」N部）
    if (over > 0 && codes.length && over > target - sum) break;
    codes.push(t.code);
    sum += t.distribution;
    maxD = Math.max(maxD, t.d);
  }
  return { codes, sum, maxDistanceKm: +(maxD / 1000).toFixed(2) };
}

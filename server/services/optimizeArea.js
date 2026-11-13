// AI最適エリアの作成
// ピンのある町丁目から、隣り合う町丁目へ順に広げて目標部数に最も近い「まとまったエリア」を作る。
//   優先度（コスト）= 距離 × (1 + 分断の度合い) ÷ ターゲット密度^0.6
//   - 隣接: 境界が接している町丁目どうし（大きな川は水面区画で隔てられるため隣接しない）
//   - 分断: ピン→町丁目の中心が、川・高速道路・国道・線路をまたぐ数（重み付き）
//   - ターゲット密度: 町丁目のターゲット比率 ÷ 候補全体の平均
//   - 所得層（指定時）: 優先度 ÷ 所得指数^1.5（高め）／ × 所得指数^1.5（低め）
import { pointInPolygon } from './geo.js';
import { crossings, indexBarriers, BARRIER_TYPES } from './barriers.js';

const M_PER_DEG_LAT = 111320;

function project(lat0) {
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  return ([lng, lat]) => [lng * kx, lat * M_PER_DEG_LAT];
}

function distKm(a, b) {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lng - b.lng) * kx, dy = a.lat - b.lat;
  return Math.sqrt(dx * dx + dy * dy) * 111.32;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 境界が接している町丁目の組を求める（許容誤差 tolM メートル以内に頂点が2つ以上）
 * @returns {Map<string, Set<string>>}
 */
export function buildAdjacency(towns, tolM = 12) {
  if (!towns.length) return new Map();
  const lat0 = towns.reduce((s, t) => s + t.center.lat, 0) / towns.length;
  const P = project(lat0);
  const items = towns.map((t) => {
    const rings = (t.polygons ?? [t.polygon]).map((r) => r.map(P));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { code: t.code, rings, minX, minY, maxX, maxY };
  }).sort((a, b) => a.minX - b.minX);

  const touches = (A, B) => {
    let hits = 0;
    for (const ra of A.rings) {
      // 閉じるための重複頂点（最後＝最初）は数えない（角だけで接する区画を隣接としないため）
      const n = ra.length > 1 && ra[0][0] === ra[ra.length - 1][0] && ra[0][1] === ra[ra.length - 1][1] ? ra.length - 1 : ra.length;
      for (let k = 0; k < n; k++) {
        const [px, py] = ra[k];
        if (px < B.minX - tolM || px > B.maxX + tolM || py < B.minY - tolM || py > B.maxY + tolM) continue;
        let near = false;
        for (const rb of B.rings) {
          for (let i = 1; i < rb.length && !near; i++) {
            if (pointSegDist(px, py, rb[i - 1][0], rb[i - 1][1], rb[i][0], rb[i][1]) <= tolM) near = true;
          }
          if (near) break;
        }
        if (near && ++hits >= 2) return true;
      }
    }
    return false;
  };

  const adj = new Map(towns.map((t) => [t.code, new Set()]));
  for (let i = 0; i < items.length; i++) {
    const A = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const B = items[j];
      if (B.minX > A.maxX + tolM) break;
      if (B.minY > A.maxY + tolM || B.maxY < A.minY - tolM) continue;
      if (touches(A, B) || touches(B, A)) { adj.get(A.code).add(B.code); adj.get(B.code).add(A.code); }
    }
  }
  return adj;
}

/**
 * @param {object} p
 * @param {Array} p.towns  候補の町丁目（center, polygon(s), distribution, code, name）
 * @param {{lat,lng}} p.pin
 * @param {number} p.targetCopies
 * @param {Record<string,{target:number,rate:number}>} [p.targets]
 * @param {Array} [p.barriers] parseOverpass の結果
 * @param {string[]} [p.excludeCodes] 使わない町丁目
 * @param {Record<string,{index:number|null}>} [p.income] 町丁目の所得指数（平均=1）
 * @param {'high'|'low'|null} [p.incomePref] 所得層の優先
 */
export function buildOptimalArea({ towns, pin, targetCopies, targets = {}, barriers = [], excludeCodes = [], income = {}, incomePref = null }) {
  const target = Math.max(1, Number(targetCopies) || 0);
  const excluded = new Set(excludeCodes);
  const pool = towns
    .filter((t) => t.center && t.distribution > 0 && !excluded.has(t.code))
    .map((t) => ({ ...t, d: distKm(pin, t.center) }))
    .sort((a, b) => a.d - b.d);
  if (!pool.length) return { codes: [], sum: 0, note: '候補の町丁目がありません' };

  // 候補を「目標の約3倍の部数」までの近さに絞る（計算量と遠方の除外）
  let cum = 0, cut = pool.length;
  for (let i = 0; i < pool.length; i++) { cum += pool[i].distribution; if (cum >= target * 3) { cut = Math.min(pool.length, i + 1 + 20); break; } }
  const cands = pool.slice(0, cut);
  const byCode = new Map(cands.map((t) => [t.code, t]));

  // ターゲット密度（平均との比）
  const rates = cands.map((t) => targets[t.code]?.rate).filter((r) => r > 0);
  const avgRate = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
  const indexed = indexBarriers(barriers);
  for (const t of cands) {
    const c = indexed.length ? crossings(pin, t.center, indexed) : { weight: 0, types: [], names: [] };
    t.cross = c;
    const ti = avgRate && targets[t.code]?.rate ? Math.max(0.3, Math.min(3, targets[t.code].rate / avgRate)) : 1;
    t.targetIndex = ti;
    const ix = income[t.code]?.index;
    t.incomeIndex = ix ?? null;
    const fi = ix > 0 && (incomePref === 'high' || incomePref === 'low') ? Math.max(0.5, Math.min(2, incomePref === 'high' ? ix : 1 / ix)) : 1;
    t.cost = Math.max(0.05, t.d) * (1 + c.weight) / ti ** 0.6 / fi ** 1.5;
  }

  const adj = buildAdjacency(cands);
  // 出発点: ピンを含む町丁目、なければ最も近い町丁目
  const start = cands.find((t) => (t.polygons ?? [t.polygon]).some((r) => pointInPolygon(pin.lng, pin.lat, r))) || cands[0];

  const inRegion = new Set([start.code]);
  const order = [start];
  let sum = start.distribution;
  const frontier = new Map(); // code -> town
  const addNeighbors = (code) => {
    for (const n of adj.get(code) || []) if (!inRegion.has(n) && byCode.has(n)) frontier.set(n, byCode.get(n));
  };
  addNeighbors(start.code);
  let islands = 0;

  while (sum < target) {
    let next = null;
    for (const t of frontier.values()) if (!next || t.cost < next.cost) next = t;
    if (!next) {
      // 隣接がない（島・データの欠け）→ 選択範囲に最も近い町丁目を飛び地として追加
      for (const t of cands) if (!inRegion.has(t.code) && (!next || t.cost < next.cost)) next = t;
      if (!next) break;
      islands++;
    }
    const over = sum + next.distribution - target;
    if (over > 0 && over > target - sum) break; // 超過が不足より大きければ加えない（約N部）
    frontier.delete(next.code);
    inRegion.add(next.code);
    order.push(next);
    sum += next.distribution;
    addNeighbors(next.code);
  }

  // 仕上げ: 最後の1区画を、目標により近づく別の隣接区画と入れ替えられるか
  if (order.length > 1 && Math.abs(sum - target) > 0) {
    const last = order[order.length - 1];
    const base = sum - last.distribution;
    let best = { t: last, gap: Math.abs(sum - target) };
    for (const t of frontier.values()) {
      if (t.cost > last.cost * 1.5) continue;
      // 最後の区画を外しても、残りのエリアと接している区画だけ（飛び地にしない）
      if (![...(adj.get(t.code) || [])].some((n) => n !== last.code && inRegion.has(n))) continue;
      const gap = Math.abs(base + t.distribution - target);
      if (gap < best.gap) best = { t, gap };
    }
    if (best.t !== last) {
      order[order.length - 1] = best.t;
      inRegion.delete(last.code); inRegion.add(best.t.code);
      sum = base + best.t.distribution;
    }
  }

  // 分断のため除外した近い町丁目（説明用）: 選択範囲の最遠より近いのに選ばれず、分断をまたぐもの
  const maxD = Math.max(...order.map((t) => t.d));
  const skippedByBarrier = cands
    .filter((t) => !inRegion.has(t.code) && t.d <= maxD && t.cross.weight > 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map((t) => ({ code: t.code, name: t.name, distanceKm: +t.d.toFixed(2), barriers: [...new Set(t.cross.names.length ? t.cross.names : t.cross.types.map((x) => BARRIER_TYPES[x].label))] }));

  const targetTotal = order.reduce((s, t) => s + (targets[t.code]?.target || 0), 0);
  // 作成エリアの所得指数（部数で加重平均）
  const withIx = order.filter((t) => t.incomeIndex > 0);
  const wSum = withIx.reduce((s, t) => s + t.distribution, 0);
  const incomeIndex = wSum ? +(withIx.reduce((s, t) => s + t.incomeIndex * t.distribution, 0) / wSum).toFixed(2) : null;
  return {
    codes: order.map((t) => t.code),
    sum,
    targetCopies: target,
    startCode: start.code,
    maxDistanceKm: +maxD.toFixed(2),
    targetTotal,
    incomeIndex,
    incomePref: incomePref || null,
    islands,
    skippedByBarrier,
    crossedBarriers: [...new Set(order.flatMap((t) => t.cross.names.length ? t.cross.names : t.cross.types.map((x) => BARRIER_TYPES[x].label)))],
    candidates: cands.length,
  };
}

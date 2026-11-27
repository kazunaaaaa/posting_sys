// 顧客データによる配布エリアの見直し
//   1) 傾向: 顧客の分布を「距離帯」「方位（8方位）」「前回エリアの内／外」で、世帯あたりの顧客数（浸透度）として集計
//   2) 見直し案: 前回の配布エリア（比較元）から、
//        - 削除: 配布したのに顧客0人で、エリア平均の浸透度なら1人以上いるはずの町丁目
//                （まとめて「偶然0人になる確率」が10%未満のときだけ削除を提案）
//        - 追加: 未配布なのに顧客がいる町丁目のうち、残したエリアに隣接するもの（浸透度の高い順）
//        部数は前回とほぼ同じ（削除で浮いた部数の範囲で追加）
//   3) 差分の根拠: 比較元と現在の選択が違うとき、削除・追加した町丁目ごとに根拠を文章で返す
// 顧客の個人情報は扱わない（町丁目ごとの人数だけ）
import { pointInPolygon } from './geo.js';
import { buildAdjacency } from './optimizeArea.js';
import { townLabel } from './exportArea.js';

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const BANDS = [[0, 0.5, '0.5km未満'], [0.5, 1, '0.5〜1km'], [1, 1.5, '1〜1.5km'], [1.5, 2, '1.5〜2km'], [2, 3, '2〜3km'], [3, Infinity, '3km以上']];
const PRIOR_HH = 300;          // 少数の町丁目の浸透度を平均に寄せる世帯数
const MIN_EXPECTED = 0.8;      // 削除候補: 平均の浸透度なら0.8人以上いるはず
const MAX_P = 0.1;             // 削除候補をまとめて偶然0人になる確率がこれ未満なら削除を提案
const MAX_REMOVE_SHARE = 0.35; // 前回の部数のうち削除できる上限
const LOCAL_RATIO = 0.6;       // 削除候補: 周辺（自身＋隣接する前回エリア）の浸透度が平均のこの割合未満
const MIN_ADD_RATIO = 0.5;     // 追加候補: 浸透度が前回エリア平均のこの割合以上

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const per1000 = (c, h) => (h > 0 ? r2((c / h) * 1000) : null);

export function distKm(a, b) {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, a.lat - b.lat) * 111.32;
}
export function direction(pin, p) {
  const kx = Math.cos((pin.lat * Math.PI) / 180);
  const ang = (Math.atan2((p.lng - pin.lng) * kx, p.lat - pin.lat) * 180) / Math.PI; // 0=北・時計回り
  return DIRS[((Math.round(ang / 45) % 8) + 8) % 8];
}
// 期待値 λ のポアソン分布で 0 になる確率
export const probZero = (lambda) => Math.exp(-Math.max(0, lambda));
const pctText = (p) => (p < 0.001 ? '0.1%未満' : p < 0.01 ? `約${(p * 100).toFixed(1)}%` : `約${Math.round(p * 100)}%`);
const label = (t) => townLabel(t.name);

/**
 * @param {object} p
 * @param {Array} p.towns       町丁目（code, name, city, households, distribution, center, polygon(s)）
 * @param {{lat,lng}} p.pin     店舗
 * @param {string[]} p.baseCodes    比較元（前回の配布エリア）
 * @param {string[]} [p.currentCodes] 現在の選択（比較元と違えば差分の根拠を返す）
 * @param {Record<string,number>} p.customers 町丁目コード → 顧客数
 * @param {number} [p.customerTotal]  取り込んだ顧客の総数（町丁目に照合できた数）
 */
export function reviewArea({ towns, pin, baseCodes = [], currentCodes = null, customers = {}, customerTotal = null }) {
  const cust = (c) => customers[c] || 0;
  const byCode = new Map(towns.map((t) => [t.code, t]));
  const base = [...new Set(baseCodes)].map((c) => byCode.get(c)).filter(Boolean);
  if (!pin || !base.length) return null;
  const info = (t) => ({
    code: t.code, name: t.name, label: label(t), city: t.city,
    households: t.households || 0, copies: t.distribution || 0, customers: r1(cust(t.code)),
    per1000: per1000(cust(t.code), t.households), distanceKm: r2(distKm(pin, t.center)), dir: direction(pin, t.center),
  });
  const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);

  const baseSet = new Set(base.map((t) => t.code));
  const baseHh = sum(base, (t) => t.households);
  const baseCust = sum(base, (t) => cust(t.code));
  const baseCopies = sum(base, (t) => t.distribution);
  const avg = baseHh ? baseCust / baseHh : 0; // 前回エリアの浸透度（顧客/世帯）
  const totalCust = customerTotal ?? Object.values(customers).reduce((s, v) => s + v, 0);

  // ---- 1) 傾向 ----
  const baseMax = Math.max(...base.map((t) => distKm(pin, t.center)));
  const custTowns = towns.filter((t) => cust(t.code) > 0);
  const custDists = custTowns.flatMap((t) => [[distKm(pin, t.center), cust(t.code)]]).sort((a, b) => a[0] - b[0]);
  let acc = 0, r90 = 0;
  for (const [d, n] of custDists) { acc += n; r90 = d; if (acc >= 0.9 * sum(custTowns, (t) => cust(t.code))) break; }
  const R = Math.min(6, Math.max(baseMax + 1, r90));
  const near = towns.filter((t) => t.households > 0 && distKm(pin, t.center) <= R);

  const distanceBands = BANDS.map(([a, b, lab]) => {
    const l = near.filter((t) => { const d = distKm(pin, t.center); return d >= a && d < b; });
    const hh = sum(l, (t) => t.households), c = sum(l, (t) => cust(t.code));
    return { label: lab, households: hh, customers: r1(c), per1000: per1000(c, hh), baseHouseholds: sum(l.filter((t) => baseSet.has(t.code)), (t) => t.households) };
  }).filter((b) => b.households > 0);

  const sectors = DIRS.map((dir) => {
    const l = near.filter((t) => distKm(pin, t.center) >= 0.25 && direction(pin, t.center) === dir);
    const hh = sum(l, (t) => t.households), c = sum(l, (t) => cust(t.code));
    const lb = l.filter((t) => baseSet.has(t.code));
    const bh = sum(lb, (t) => t.households), bc = sum(lb, (t) => cust(t.code));
    return { dir, households: hh, customers: r1(c), per1000: per1000(c, hh), baseHouseholds: bh, baseCustomers: r1(bc), basePer1000: per1000(bc, bh) };
  }).filter((s) => s.households > 0);

  const outside = custTowns.filter((t) => !baseSet.has(t.code));
  const outsideCust = sum(outside, (t) => cust(t.code));
  const zeroBase = base.filter((t) => cust(t.code) < 0.5 && t.households > 0);

  const bullets = [];
  bullets.push(`前回の配布エリア（${base.length}町丁目・${baseHh.toLocaleString()}世帯）に住む顧客は約${r1(baseCust)}人${totalCust ? `（照合できた顧客${r1(totalCust)}人の${Math.round((baseCust / totalCust) * 100)}%）` : ''}。浸透度は1000世帯あたり${per1000(baseCust, baseHh)}人です。`);
  const bandsSorted = distanceBands.filter((b) => b.households >= 2000 && b.per1000 != null);
  if (bandsSorted.length >= 2) {
    bullets.push(`距離別の浸透度（1000世帯あたり）: ${bandsSorted.map((b) => `${b.label} ${b.per1000}人`).join(' / ')}。` +
      (bandsSorted[0].per1000 > bandsSorted[bandsSorted.length - 1].per1000 * 1.5 ? '店舗に近いほど顧客が濃く、距離とともに薄くなっています。' : '距離による差は大きくありません。'));
  }
  const sec = sectors.filter((s) => s.households >= 2000 && s.per1000 != null).sort((a, b) => b.per1000 - a.per1000);
  if (sec.length >= 3) {
    const hi = sec.slice(0, 2), lo = sec.slice(-2).reverse();
    bullets.push(`方位別の浸透度: 濃いのは${hi.map((s) => `${s.dir}側（${s.per1000}人）`).join('・')}、薄いのは${lo.map((s) => `${s.dir}側（${s.per1000}人）`).join('・')}（1000世帯あたり、店舗から${r1(R)}km以内）。`);
  }
  const strong = base.filter((t) => cust(t.code) >= 2).map(info).sort((a, b) => b.per1000 - a.per1000).slice(0, 4);
  if (strong.length) bullets.push(`前回エリアで特に浸透している町丁目: ${strong.map((t) => `${t.label}（${t.customers}人・1000世帯あたり${t.per1000}人）`).join('、')}。`);
  if (zeroBase.length) {
    const byDir = {};
    for (const t of zeroBase) (byDir[direction(pin, t.center)] ??= []).push(t);
    const main = Object.entries(byDir).sort((a, b) => sum(b[1], (t) => t.households) - sum(a[1], (t) => t.households))[0];
    bullets.push(`前回エリアで顧客0人の町丁目は${zeroBase.length}か所（${sum(zeroBase, (t) => t.households).toLocaleString()}世帯）${main && main[1].length >= 2 ? `。特に店舗の${main[0]}側に固まっています（${main[1].map(label).join('・')}）` : ''}。`);
  }
  if (outside.length) {
    const top = outside.map(info).sort((a, b) => b.customers - a.customers).slice(0, 5);
    bullets.push(`前回エリアの外に住む顧客は約${r1(outsideCust)}人（${outside.length}町丁目）。多いのは${top.map((t) => `${t.label}（${t.customers}人・${t.dir}${t.distanceKm}km）`).join('、')}。チラシ以外の経路で来ている層で、配布すれば上積みが見込めます。`);
  }

  // ---- 2) 見直し案 ----
  const pinTown = base.find((t) => (t.polygons ?? [t.polygon]).some((r) => r && pointInPolygon(pin.lng, pin.lat, r)))
    || [...base].sort((a, b) => distKm(pin, a.center) - distKm(pin, b.center))[0];
  const pool = near.filter((t) => !baseSet.has(t.code));
  const adj = buildAdjacency([...base, ...pool].filter((t) => t.polygon || t.polygons));
  // 周辺の浸透度（自身＋隣接する前回エリアの町丁目）。周りが濃ければ、0人は偶然の可能性が高いので残す
  const local = (t) => {
    const l = [t, ...[...(adj.get(t.code) || [])].filter((c) => baseSet.has(c)).map((c) => byCode.get(c))];
    const hh = sum(l, (x) => x.households);
    return hh ? sum(l, (x) => cust(x.code)) / hh : 0;
  };
  const removeCands = zeroBase
    .filter((t) => t.code !== pinTown.code && avg * t.households >= MIN_EXPECTED && local(t) < avg * LOCAL_RATIO)
    .sort((a, b) => local(a) - local(b) || b.households - a.households);
  const removed = [];
  let removedCopies = 0;
  for (const t of removeCands) {
    if (removedCopies + (t.distribution || 0) > baseCopies * MAX_REMOVE_SHARE) continue;
    removed.push(t); removedCopies += t.distribution || 0;
  }
  const removedExpected = sum(removed, (t) => avg * t.households);
  const groupP = removed.length ? probZero(removedExpected) : null;
  const doRemove = removed.length > 0 && groupP < MAX_P;
  const watch = doRemove ? [] : removed;
  // 顧客0人だが周辺が濃いため残した町丁目（説明用）
  const keptZero = zeroBase.filter((t) => !removed.includes(t) && t.code !== pinTown.code && avg * t.households >= MIN_EXPECTED);
  const removeList = doRemove ? removed : [];

  // 追加: 残したエリアに隣接する、顧客のいる未配布の町丁目
  const region = new Set(base.map((t) => t.code).filter((c) => !removeList.some((t) => t.code === c)));
  const added = [];
  let copies = baseCopies - removedCopies;
  const target = baseCopies;
  const density = (t) => (cust(t.code) + avg * PRIOR_HH) / (t.households + PRIOR_HH);
  if (doRemove) {
    for (;;) {
      const cand = pool
        .filter((t) => !region.has(t.code) && cust(t.code) >= 0.5 && cust(t.code) / t.households >= avg * MIN_ADD_RATIO && [...(adj.get(t.code) || [])].some((n) => region.has(n)))
        .filter((t) => copies + (t.distribution || 0) <= target + (t.distribution || 0) * 0.5)
        .sort((a, b) => density(b) - density(a) || distKm(pin, a.center) - distKm(pin, b.center))[0];
      if (!cand) break;
      added.push(cand); region.add(cand.code); copies += cand.distribution || 0;
    }
  }
  const extra = pool
    .filter((t) => !region.has(t.code) && cust(t.code) >= 0.5)
    .map(info).sort((a, b) => b.customers - a.customers || a.distanceKm - b.distanceKm).slice(0, 8);

  const avgText = `前回エリアの平均（1000世帯あたり${per1000(baseCust, baseHh)}人）`;
  const removeReason = (t) => {
    const e = avg * t.households;
    const lc = r2(local(t) * 1000);
    return `前回配布したが顧客0人。${avgText}なら約${r1(e)}人いるはず（1か所だけで偶然0人になる確率${pctText(probZero(e))}）。` +
      `隣接する前回エリアを含めた周辺の浸透度も1000世帯あたり${lc}人と低い。店舗の${direction(pin, t.center)}${r1(distKm(pin, t.center))}km。`;
  };
  const addReason = (t) => {
    const c = cust(t.code);
    const ratio = avg > 0 && t.households ? c / t.households / avg : null;
    const adjacent = [...(adj.get(t.code) || [])].some((n) => baseSet.has(n));
    return c > 0
      ? `未配布なのに顧客${r1(c)}人（1000世帯あたり${per1000(c, t.households)}人${ratio ? `・前回エリア平均の${ratio.toFixed(1)}倍` : ''}）。チラシ以外の経路で来店しており、配布で上積みが見込める。` +
        `店舗の${direction(pin, t.center)}${r1(distKm(pin, t.center))}km${adjacent ? '・前回エリアに隣接' : ''}。`
      : `顧客0人（未配布）。店舗の${direction(pin, t.center)}${r1(distKm(pin, t.center))}km${adjacent ? '・前回エリアに隣接' : ''}。部数の調整・エリアのまとまりのために追加したと考えられます。`;
  };
  const keepReasonOfRemoved = (t) => {
    const c = cust(t.code);
    if (c < 0.5) return removeReason(t);
    const ratio = avg > 0 ? c / t.households / avg : null;
    return `顧客${r1(c)}人（1000世帯あたり${per1000(c, t.households)}人${ratio ? `・前回エリア平均の${ratio.toFixed(1)}倍` : ''}）。店舗の${direction(pin, t.center)}${r1(distKm(pin, t.center))}km。部数の調整のために外したと考えられます${ratio && ratio >= 1 ? '（浸透度は平均以上のため、外す判断は要確認）' : ''}。`;
  };

  const sugCodes = [...region];
  const sugTowns = sugCodes.map((c) => byCode.get(c)).filter(Boolean);
  const sugHh = sum(sugTowns, (t) => t.households), sugCust = sum(sugTowns, (t) => cust(t.code));
  const suggestion = {
    codes: sugCodes,
    copies: sum(sugTowns, (t) => t.distribution), households: sugHh, customers: r1(sugCust), per1000: per1000(sugCust, sugHh),
    removed: removeList.map((t) => ({ ...info(t), expected: r1(avg * t.households), reason: removeReason(t) })),
    added: added.map((t) => ({ ...info(t), reason: addReason(t) })),
    watch: watch.map((t) => ({ ...info(t), expected: r1(avg * t.households), reason: removeReason(t) })),
    extraCandidates: extra,
    keptZero: keptZero.map((t) => ({ ...info(t), localPer1000: r2(local(t) * 1000),
      reason: `顧客0人だが、隣接する前回エリアを含めた周辺の浸透度は1000世帯あたり${r2(local(t) * 1000)}人（平均の${avg ? (local(t) / avg).toFixed(1) : '—'}倍）と高く、0人は偶然の可能性があるため残す。` })),
    groupP, removedExpected: r1(removedExpected),
    summary: doRemove
      ? `顧客0人の${removeList.length}町丁目（${removedCopies.toLocaleString()}部・${sum(removeList, (t) => t.households).toLocaleString()}世帯）を外し、` +
        (added.length ? `顧客のいる未配布の${added.length}町丁目（${sum(added, (t) => t.distribution).toLocaleString()}部）を追加。` : '追加できる隣接の町丁目はありませんでした。') +
        `外した町丁目は平均どおりなら合計約${r1(removedExpected)}人いるはずで、偶然0人になる確率は${pctText(groupP)}です。` +
        (copies < baseCopies * 0.97 ? `部数は前回より${(baseCopies - copies).toLocaleString()}部少なくなります（顧客のいる隣接の町丁目が足りないため。部数を揃えるなら地図で隣接の町丁目を足してください）。` : '')
      : removed.length
        ? `顧客0人の町丁目はありますが、まとめても偶然0人の可能性（${pctText(groupP)}）が残るため、削除は提案しません（様子見）。`
        : '前回エリアに、削除を提案できる町丁目（顧客0人で、平均なら0.8人以上いるはずの町丁目）はありません。',
  };

  // ---- 3) 比較元と現在の選択の差分 ----
  let diff = null;
  if (Array.isArray(currentCodes)) {
    const cur = new Set(currentCodes);
    const dRemoved = base.filter((t) => !cur.has(t.code));
    const dAdded = currentCodes.filter((c) => !baseSet.has(c)).map((c) => byCode.get(c)).filter(Boolean);
    if (dRemoved.length || dAdded.length) {
      const curTowns = currentCodes.map((c) => byCode.get(c)).filter(Boolean);
      const zeroRemoved = dRemoved.filter((t) => cust(t.code) < 0.5);
      const zExp = sum(zeroRemoved, (t) => avg * t.households);
      const cHh = sum(curTowns, (t) => t.households), cCust = sum(curTowns, (t) => cust(t.code));
      diff = {
        before: { towns: base.length, copies: baseCopies, households: baseHh, customers: r1(baseCust), per1000: per1000(baseCust, baseHh) },
        after: { towns: curTowns.length, copies: sum(curTowns, (t) => t.distribution), households: cHh, customers: r1(cCust), per1000: per1000(cCust, cHh) },
        removed: dRemoved.map((t) => ({ ...info(t), expected: r1(avg * t.households), reason: keepReasonOfRemoved(t) })),
        added: dAdded.map((t) => ({ ...info(t), reason: addReason(t) })),
        zeroRemoved: { count: zeroRemoved.length, households: sum(zeroRemoved, (t) => t.households), expected: r1(zExp), p: zeroRemoved.length ? probZero(zExp) : null },
      };
      const z = diff.zeroRemoved;
      diff.summary = `前回${base.length}町丁目・${baseCopies.toLocaleString()}部 → 今回${curTowns.length}町丁目・${diff.after.copies.toLocaleString()}部。` +
        `${dRemoved.length}町丁目を削除、${dAdded.length}町丁目を追加。` +
        (z.count ? `削除のうち${z.count}町丁目（${z.households.toLocaleString()}世帯）は顧客0人で、平均どおりなら合計約${z.expected}人いるはず＝偶然0人の確率は${pctText(z.p)}。` : '') +
        `エリア内の顧客は${r1(baseCust)}人 → ${r1(cCust)}人、浸透度は1000世帯あたり${per1000(baseCust, baseHh)}人 → ${per1000(cCust, cHh)}人。`;
    }
  }

  return {
    pin, radiusKm: r1(R),
    base: { towns: base.length, copies: baseCopies, households: baseHh, customers: r1(baseCust), per1000: per1000(baseCust, baseHh), share: totalCust ? r2(baseCust / totalCust) : null },
    customerTotal: r1(totalCust),
    trends: { bullets, distanceBands, sectors, outsideCustomers: r1(outsideCust), outsideTowns: outside.length },
    suggestion,
    diff,
  };
}

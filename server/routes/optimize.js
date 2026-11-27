import { Router } from 'express';
import { getTowns } from '../services/towns.js';
import { getBusinessType } from '../services/places.js';
import { computeTargets, normalizeProfile } from '../services/demographics.js';
import { fetchBarriers, BARRIER_TYPES } from '../services/barriers.js';
import { buildOptimalArea } from '../services/optimizeArea.js';
import { computeIncome } from '../services/income.js';
import { applyRate, normalizeRate } from '../services/distribution.js';

const router = Router();

function distKm(a, b) {
  const kx = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, a.lat - b.lat) * 111.32;
}

// AI最適エリアの作成
// POST /api/optimize/area { pin:{lat,lng}, targetCopies, cityCodes:[...], businessTypeId?, profile?, excludeCodes? }
router.post('/area', async (req, res) => {
  try {
    const { pin, targetCopies, cityCodes = [], businessTypeId, profile, excludeCodes = [], incomePref = null, coverRate, customers = null } = req.body ?? {};
    if (!pin || !Number.isFinite(+pin.lat) || !Number.isFinite(+pin.lng)) return res.status(400).json({ error: 'pin が必要です' });
    if (!(+targetCopies > 0)) return res.status(400).json({ error: 'targetCopies が必要です' });
    if (!cityCodes.length) return res.status(400).json({ error: '町丁目を読み込んだ市区町村がありません' });
    const p = { lat: +pin.lat, lng: +pin.lng };

    // 町丁目
    const rate = normalizeRate(coverRate);
    const towns = [];
    const loadErrors = [];
    for (const code of cityCodes) {
      try { towns.push(...applyRate((await getTowns(code)).towns, rate)); } catch (e) { loadErrors.push(`${code}: ${e.message}`); }
    }
    if (!towns.length) return res.status(502).json({ error: '町丁目データを読み込めませんでした', details: loadErrors });

    // 候補の範囲（目標の約3倍の部数が入る半径）
    const sorted = towns.filter((t) => t.distribution > 0).map((t) => ({ t, d: distKm(p, t.center) })).sort((a, b) => a.d - b.d);
    let cum = 0, radius = sorted[sorted.length - 1]?.d || 3;
    for (const x of sorted) { cum += x.t.distribution; if (cum >= targetCopies * 3) { radius = x.d; break; } }
    radius = Math.min(Math.max(radius + 0.5, 1.5), 10);
    const near = sorted.filter((x) => x.d <= radius + 0.5).map((x) => x.t);

    // ターゲット（入力された属性 → 業態の標準）
    const bt = businessTypeId ? getBusinessType(businessTypeId) : null;
    const prof = normalizeProfile(profile || bt?.target || {});
    const tg = await computeTargets(near, prof);

    // 分断要素（川・高速道路・国道・主要地方道・線路）
    const dLat = radius / 111.32, dLng = radius / (111.32 * Math.cos((p.lat * Math.PI) / 180));
    const bbox = { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
    const { barriers, error: barrierError } = await fetchBarriers(bbox);

    // 所得層を指定したときだけ所得指数を取る（未取得の市区町村はe-Statから取得）
    let inc = null;
    if (incomePref === 'high' || incomePref === 'low') {
      try { inc = await computeIncome(near); } catch (e) { inc = { byCode: {}, errors: [e.message] }; }
    }

    const result = buildOptimalArea({
      towns: near, pin: p, targetCopies: +targetCopies, targets: tg.byCode, barriers, excludeCodes,
      income: inc?.byCode || {}, incomePref: inc ? incomePref : null,
      customers: customers && typeof customers === 'object' ? customers : null,
    });

    // 地図表示用: 作成エリア周辺の分断線だけ返す
    const sel = near.filter((t) => result.codes.includes(t.code));
    let bMinLat = Infinity, bMaxLat = -Infinity, bMinLng = Infinity, bMaxLng = -Infinity;
    for (const t of sel) for (const r of t.polygons ?? [t.polygon]) for (const [x, y] of r) {
      bMinLat = Math.min(bMinLat, y); bMaxLat = Math.max(bMaxLat, y); bMinLng = Math.min(bMinLng, x); bMaxLng = Math.max(bMaxLng, x);
    }
    const m = 0.01;
    // 頂点がエリア外でもエリアを横切る長い線（線路など）を拾えるよう、線の外接矩形との重なりで判定
    const shown = barriers.filter((b) => {
      if (b.type === 'primary') return false;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of b.coords) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return x1 >= bMinLng - m && x0 <= bMaxLng + m && y1 >= bMinLat - m && y0 <= bMaxLat + m;
    });

    res.json({
      ...result,
      coverRate: rate,
      profile: tg.profile,
      targetSource: tg.source,
      targetErrors: tg.errors.slice(0, 3),
      incomeErrors: (inc?.errors || []).slice(0, 3),
      incomeAvailable: inc ? Object.values(inc.byCode).some((v) => v.index != null) : null,
      perTown: Object.fromEntries(result.codes.map((c) => [c, tg.byCode[c]])),
      barriers: shown.map((b) => ({ type: b.type, name: b.name, label: BARRIER_TYPES[b.type].label, coords: b.coords })),
      barrierError: barrierError || null,
      barrierCount: barriers.length,
      loadErrors,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

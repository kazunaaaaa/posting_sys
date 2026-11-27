import { Router } from 'express';
import express from 'express';
import { matchCustomers } from '../services/customers.js';
import { reviewArea } from '../services/customerReview.js';
import { getTowns } from '../services/towns.js';
import { applyRate, normalizeRate } from '../services/distribution.js';

const router = Router();

// 顧客の住所 → 町丁目  POST /api/customers/match { rows:[{i, pref, address}] }
// 氏名・生年月日などは受け取らない（画面側で住所だけを送る）。保存もしない。
router.post('/match', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const rows = (req.body?.rows || []).filter((r) => r && r.address).map((r) => ({ i: r.i, pref: String(r.pref || ''), address: String(r.address) }));
    if (!rows.length) return res.status(400).json({ error: '住所がありません' });
    if (rows.length > 50000) return res.status(400).json({ error: '一度に照合できるのは50,000件までです' });
    res.json(await matchCustomers(rows));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 顧客データによる配布エリアの見直し（傾向・削除/追加の提案・比較元との差分の根拠）
// POST /api/customers/review { pin, cityCodes, baseCodes, currentCodes?, customers:{code:人数}, customerTotal?, coverRate?, households?:{code:世帯数} }
router.post('/review', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { pin, cityCodes = [], baseCodes = [], currentCodes = null, customers = {}, customerTotal = null, coverRate, households = {} } = req.body ?? {};
    if (!pin || !Number.isFinite(+pin.lat) || !Number.isFinite(+pin.lng)) return res.status(400).json({ error: '📍（店舗の位置）が必要です' });
    if (!baseCodes.length) return res.status(400).json({ error: '比較元（前回の配布エリア）がありません' });
    const codes = [...new Set([...cityCodes, ...baseCodes.map((c) => String(c).slice(0, 5))])];
    const towns = [];
    const errors = [];
    for (const code of codes) {
      try { towns.push(...(await getTowns(code)).towns); } catch (e) { errors.push(`${code}: ${e.message}`); }
    }
    // 画面で貼り付けた世帯数を使っている町丁目は、その世帯数で計算する
    const hhFixed = towns.map((t) => (households[t.code] > 0 ? { ...t, households: +households[t.code] } : t));
    const result = reviewArea({
      towns: applyRate(hhFixed, normalizeRate(coverRate)), pin: { lat: +pin.lat, lng: +pin.lng },
      baseCodes, currentCodes, customers, customerTotal,
    });
    if (!result) return res.status(400).json({ error: '比較元の町丁目を読み込めませんでした', details: errors });
    res.json({ ...result, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

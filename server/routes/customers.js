import { Router } from 'express';
import express from 'express';
import { matchCustomers } from '../services/customers.js';

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

export default router;

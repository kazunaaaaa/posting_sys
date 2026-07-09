import { Router } from 'express';
import { listPrefectures, getMunicipalities, DISTRIBUTION_RATE } from '../services/estat.js';
import { getBoundaries } from '../services/boundaries.js';

const router = Router();

// 都道府県一覧
router.get('/prefectures', (req, res) => {
  res.json({ prefectures: listPrefectures() });
});

// 市区町村一覧（?pref=千葉県 or ?keyword=松戸）
router.get('/', async (req, res) => {
  try {
    const data = await getMunicipalities({ pref: req.query.pref, keyword: req.query.keyword });
    res.json({ distributionRate: DISTRIBUTION_RATE, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 境界ポリゴンのオンデマンド取得 { codes: [...] }
router.post('/boundaries', async (req, res) => {
  try {
    const codes = req.body?.codes ?? [];
    if (!codes.length) return res.status(400).json({ error: 'codes is required' });
    const boundaries = await getBoundaries(codes);
    res.json({ boundaries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

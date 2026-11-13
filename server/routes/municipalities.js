import { Router } from 'express';
import { listPrefectures, getMunicipalities, nearbyMunicipalities, DISTRIBUTION_RATE } from '../services/estat.js';
import { getBoundaries } from '../services/boundaries.js';

const router = Router();

// 都道府県一覧
router.get('/prefectures', (req, res) => {
  res.json({ prefectures: listPrefectures() });
});

// ピン周辺の市区町村（県境をまたぐ）  ?lat=&lng=&km=6&limit=8
router.get('/nearby', (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng is required' });
  const km = Math.min(Number(req.query.km) || 6, 30);
  const limit = Math.min(Number(req.query.limit) || 8, 30);
  res.json({ municipalities: nearbyMunicipalities(lat, lng, { km, limit }) });
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

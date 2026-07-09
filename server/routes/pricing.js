import { Router } from 'express';
import { companies, getQuotes } from '../services/pricing.js';
import { resolveAreas } from '../services/areas.js';

const router = Router();

// 配布会社一覧
router.get('/companies', (req, res) => {
  res.json({ companies: companies() });
});

// 選択エリアの各社見積 { codes: [...], level }
router.post('/quotes', async (req, res) => {
  try {
    const { codes = [], level = 'municipality' } = req.body ?? {};
    if (!codes.length) return res.status(400).json({ error: 'codes is required' });
    const areas = await resolveAreas(codes, level, { withBoundary: false });
    res.json(getQuotes(areas));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

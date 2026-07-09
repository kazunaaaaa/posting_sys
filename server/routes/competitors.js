import { Router } from 'express';
import { businessTypes, searchCompetitors } from '../services/places.js';
import { resolveAreas } from '../services/areas.js';

const router = Router();

// 業態マスタ
router.get('/business-types', (req, res) => {
  res.json({ categories: businessTypes() });
});

// 競合検索: { businessTypeId, codes: [...], level }
router.post('/search', async (req, res) => {
  try {
    const { businessTypeId, codes = [], level = 'municipality' } = req.body ?? {};
    if (!businessTypeId) return res.status(400).json({ error: 'businessTypeId is required' });
    const areas = await resolveAreas(codes, level);
    const result = await searchCompetitors(businessTypeId, areas);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

import { Router } from 'express';
import { businessTypes, searchCompetitors } from '../services/places.js';
import { getAreasByCodes } from '../services/estat.js';

const router = Router();

// 業態マスタ
router.get('/business-types', (req, res) => {
  res.json({ categories: businessTypes() });
});

// 競合検索: { businessTypeId, codes: [...] }
router.post('/search', async (req, res) => {
  try {
    const { businessTypeId, codes = [] } = req.body ?? {};
    if (!businessTypeId) return res.status(400).json({ error: 'businessTypeId is required' });
    const areas = await getAreasByCodes(codes);
    const result = await searchCompetitors(businessTypeId, areas);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

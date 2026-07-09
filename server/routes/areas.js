import { Router } from 'express';
import { getSmallAreas, getSmallAreasByCodes, distributionFor, DISTRIBUTION_RATE } from '../services/estat.js';

const router = Router();

// 町丁目（小地域）エリア一覧（世帯数・配布部数付き・ポリゴンあり）
router.get('/', async (req, res) => {
  try {
    const data = await getSmallAreas();
    res.json({ distributionRate: DISTRIBUTION_RATE, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 選択エリアの配布部数サマリ
router.post('/summary', async (req, res) => {
  try {
    const codes = req.body?.codes ?? [];
    const areas = await getSmallAreasByCodes(codes);
    const totalHouseholds = areas.reduce((s, a) => s + (a.households ?? 0), 0);
    res.json({
      distributionRate: DISTRIBUTION_RATE,
      count: areas.length,
      totalHouseholds,
      totalDistribution: distributionFor(totalHouseholds),
      areas: areas.map((a) => ({ code: a.code, name: a.name, households: a.households, distribution: a.distribution })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

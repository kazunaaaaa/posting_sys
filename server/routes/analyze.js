import { Router } from 'express';
import { getAreasByCodes } from '../services/estat.js';
import { searchCompetitors, getBusinessType } from '../services/places.js';
import { scoreAreas } from '../services/scoring.js';
import { explainBestArea } from '../services/claude.js';

const router = Router();

// 最適エリア分析: { codes: [...], businessTypeId, unitCost?, competitors? }
router.post('/', async (req, res) => {
  try {
    const { codes = [], businessTypeId, unitCost, competitors: passedCompetitors } = req.body ?? {};
    if (!codes.length) return res.status(400).json({ error: 'codes is required' });

    const areas = await getAreasByCodes(codes);

    // 競合はクライアントから渡されればそれを使い、無ければ再取得
    let competitors = passedCompetitors;
    let bt = businessTypeId ? getBusinessType(businessTypeId) : null;
    if (!competitors && businessTypeId) {
      const r = await searchCompetitors(businessTypeId, areas);
      competitors = r.competitors;
      bt = r.businessType;
    }
    competitors = competitors ?? [];

    const scoring = scoreAreas(areas, competitors, { unitCost });
    const explanation = await explainBestArea(scoring, bt?.label ?? '指定業態');

    res.json({ businessType: bt, scoring, explanation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

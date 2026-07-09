import { Router } from 'express';
import { resolveAreas } from '../services/areas.js';
import { searchCompetitors, getBusinessType } from '../services/places.js';
import { scoreAreas } from '../services/scoring.js';
import { explainBestArea } from '../services/claude.js';
import { cheapestRateMap, getQuotes } from '../services/pricing.js';

const router = Router();

// 最適エリア分析: { codes, level, businessTypeId, unitCost?, competitors? }
router.post('/', async (req, res) => {
  try {
    const { codes = [], level = 'municipality', businessTypeId, unitCost, competitors: passed } = req.body ?? {};
    if (!codes.length) return res.status(400).json({ error: 'codes is required' });

    const areas = await resolveAreas(codes, level);

    let competitors = passed;
    let bt = businessTypeId ? getBusinessType(businessTypeId) : null;
    if (!competitors && businessTypeId) {
      const r = await searchCompetitors(businessTypeId, areas);
      competitors = r.competitors;
      bt = r.businessType;
    }
    competitors = competitors ?? [];

    // 配布会社の最安見積単価をコスト軸に反映
    const rateMap = cheapestRateMap(codes);
    const scoring = scoreAreas(areas, competitors, { unitCost, rateMap });
    const quotes = getQuotes(areas);
    const explanation = await explainBestArea(scoring, bt?.label ?? '指定業態');

    res.json({ businessType: bt, scoring, quotes, explanation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

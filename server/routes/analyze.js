import { Router } from 'express';
import { resolveAreas } from '../services/areas.js';
import { searchCompetitors, getBusinessType } from '../services/places.js';
import { scoreAreas } from '../services/scoring.js';
import { explainBestArea } from '../services/claude.js';
import { cheapestRateMap, getQuotes } from '../services/pricing.js';
import { computeTargets } from '../services/demographics.js';
import { computeIncome, computeMunicipalIncome } from '../services/income.js';

const router = Router();

// 最適エリア分析: { codes, level, businessTypeId, unitCost?, competitors?, profile?:{ageMin,ageMax,sex,label}, incomePref?:'high'|'low' }
router.post('/', async (req, res) => {
  try {
    const { codes = [], level = 'municipality', businessTypeId, unitCost, competitors: passed, profile, incomePref } = req.body ?? {};
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

    // ターゲット人数（町丁目単位のみ）: 入力された属性 → 無ければ業態の標準ターゲット
    let tg = null;
    const prof = profile || bt?.target;
    if (level === 'town' && prof) tg = await computeTargets(areas, prof);

    // 所得: 町丁目は所得指数（推計）、市区町村は平均所得（実データ）の比
    let inc = null;
    try {
      inc = level === 'town' ? await computeIncome(areas) : await computeMunicipalIncome(areas.map((a) => a.code));
    } catch (e) { inc = { byCode: {}, municipal: {}, errors: [e.message] }; }

    const scoring = scoreAreas(areas, competitors, {
      unitCost, rateMap,
      targets: tg?.byCode, targetProfile: tg?.profile, targetSource: tg?.source,
      income: inc?.byCode, incomePref,
    });
    const cityName = Object.fromEntries(areas.map((a) => [a.cityCode || String(a.code).slice(0, 5), a.city]));
    scoring.income = {
      municipal: Object.entries(inc?.municipal || {}).filter(([, v]) => v).map(([code, v]) => ({ code, city: cityName[code] || code, ...v })),
      estimated: level === 'town',
      errors: (inc?.errors || []).slice(0, 5),
    };
    const quotes = getQuotes(areas);
    const explanation = await explainBestArea(scoring, bt?.label ?? '指定業態');

    res.json({ businessType: bt, scoring, quotes, explanation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

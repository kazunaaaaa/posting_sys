import { Router } from 'express';
import path from 'path';
import { getTowns, cachedCityCodes, RAW_DIR } from '../services/towns.js';

const router = Router();

// 取得済み（事前取得を含む）の市区町村数  GET /api/towns/status
router.get('/status', (req, res) => {
  const codes = [...cachedCityCodes()];
  const byPref = {};
  for (const c of codes) byPref[c.slice(0, 2)] = (byPref[c.slice(0, 2)] || 0) + 1;
  res.json({ cachedCities: codes.length, byPref });
});

// 市区町村内の町丁目一覧（実境界・世帯数・配布部数）  GET /api/towns?city=12207
router.get('/', async (req, res) => {
  const city = String(req.query.city || '');
  try {
    const data = await getTowns(city);
    res.json(data);
  } catch (e) {
    res.status(502).json({
      error: e.message,
      hint: 'e-Statへ接続できない環境では、e-Statの境界データ（小地域・シェープファイル・緯度経度）を手動でダウンロードし '
        + `${path.join(RAW_DIR, `${city}.zip`)} に置いてください。`,
    });
  }
});

export default router;

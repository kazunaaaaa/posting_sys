import { Router } from 'express';
import { getTowns } from '../services/towns.js';

const router = Router();

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
        + `server/data/towns/raw/${city}.zip に置いてください。`,
    });
  }
});

export default router;

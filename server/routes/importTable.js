import { Router } from 'express';
import { parseAreaTable, matchAreaTable } from '../services/importTable.js';

const router = Router();

// 貼り付けたエリア表を町丁目に照合  POST /api/import/area-table { text }
router.post('/area-table', async (req, res) => {
  try {
    const { rows, address, columns } = parseAreaTable(req.body?.text || '');
    if (!rows.length) return res.status(400).json({ error: '町丁目の行が見つかりません（Excelで「市区町村・町丁目名・世帯数」の列を選んでコピーしてください）' });
    if (rows.length > 3000) return res.status(400).json({ error: '一度に貼り付けられるのは3,000行までです' });
    const result = await matchAreaTable(rows);
    res.json({ ...result, address, columns, rowCount: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

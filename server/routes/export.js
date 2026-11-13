import express, { Router } from 'express';
import { buildAreaWorkbook } from '../services/exportArea.js';

const router = Router();

// 配布部数表（エリア表）Excel  POST /api/export/area-xlsx
// body: { rows:[{city,town,households,note?}], coverRate?, storeName?, projectName?, targetCopies?, mapImage?, mapSize? }
router.post('/area-xlsx', express.json({ limit: '30mb' }), async (req, res) => {
  try {
    const { buffer, title } = await buildAreaWorkbook(req.body || {});
    const filename = `${title}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="area.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;

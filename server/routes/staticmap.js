// Google Static Maps の中継（配布部数表に貼る地図画像のベース地図）
//   GET /api/staticmap?center=35.51,139.45&zoom=15&size=640x517&scale=2
// ベース地図だけを取得し、町丁目・円・ピン・ラベルはブラウザ側で重ね描きする
// （URL長の制限を受けず、日本語ラベルもきれいに描けるため）。
//
// キー: GOOGLE_STATIC_MAPS_KEY（サーバー用・IP制限推奨）があれば優先、
//       無ければ GOOGLE_MAPS_API_KEY を使い、ウェブサイト制限に合うよう参照元(Referer)を付ける。
//       どちらのキーでも「Maps Static API」の有効化が必要。
import { Router } from 'express';

const router = Router();

router.get('/', async (req, res) => {
  const key = process.env.GOOGLE_STATIC_MAPS_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY が未設定です' });

  const center = String(req.query.center || '');
  const zoom = Math.max(1, Math.min(20, Number(req.query.zoom) || 15));
  const size = /^\d{2,4}x\d{2,4}$/.test(String(req.query.size)) ? String(req.query.size) : '640x517';
  const scale = String(req.query.scale) === '1' ? '1' : '2';
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(center)) return res.status(400).json({ error: 'center=lat,lng が必要です' });

  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', center);
  url.searchParams.set('zoom', String(zoom));
  url.searchParams.set('size', size);
  url.searchParams.set('scale', scale);
  url.searchParams.set('language', 'ja');
  url.searchParams.set('region', 'JP');
  url.searchParams.set('key', key);

  // ウェブサイト制限付きキーでも通るよう、アプリの参照元を付与
  const referer = req.get('referer') || `${req.protocol}://${req.get('host')}/`;
  try {
    const r = await fetch(url, { headers: { Referer: referer } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) {
      const text = type.startsWith('image/') ? '' : (await r.text()).slice(0, 200);
      return res.status(502).json({
        error: `Static Maps の取得に失敗しました (HTTP ${r.status}) ${text}`.trim(),
        hint: 'Google Cloud で「Maps Static API」を有効にし、APIキーの「APIの制限」にも追加してください。',
      });
    }
    res.set('Content-Type', type);
    res.set('Cache-Control', 'private, max-age=600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: `Static Maps に接続できません: ${e.message}` });
  }
});

export default router;

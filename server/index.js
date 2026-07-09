import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import areasRouter from './routes/areas.js';
import municipalitiesRouter from './routes/municipalities.js';
import competitorsRouter from './routes/competitors.js';
import analyzeRouter from './routes/analyze.js';
import pricingRouter from './routes/pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// フロントに公開してよい設定（Maps用キーなど）
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    hasPlacesKey: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    hasClaudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasEstatKey: Boolean(process.env.ESTAT_APP_ID),
    defaultCenter: { lat: 35.7872, lng: 139.9182 },
    defaultZoom: 14,
  });
});

app.use('/api/areas', areasRouter);
app.use('/api/municipalities', municipalitiesRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/pricing', pricingRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// 本番ビルドされたクライアントを配信（存在すれば）
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`posting-sys server listening on http://localhost:${PORT}`);
});

import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import townsRouter from './routes/towns.js';
import municipalitiesRouter from './routes/municipalities.js';
import competitorsRouter from './routes/competitors.js';
import analyzeRouter from './routes/analyze.js';
import pricingRouter from './routes/pricing.js';
import staticmapRouter from './routes/staticmap.js';
import exportRouter from './routes/export.js';
import optimizeRouter from './routes/optimize.js';
import importRouter from './routes/importTable.js';
import customersRouter from './routes/customers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
const jsonParser = express.json({ limit: '2mb' });
// 配布部数表の出力は地図画像を含むため、専用ルート側で大きめの上限を設定する
app.use((req, res, next) => ((req.path.startsWith('/api/export') || req.path.startsWith('/api/customers')) ? next() : jsonParser(req, res, next)));

// フロントに公開してよい設定（Maps用キーなど）
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    hasPlacesKey: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    hasClaudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasEstatKey: Boolean(process.env.ESTAT_APP_ID),
    defaultCenter: { lat: 35.6812, lng: 139.7671 }, // 東京駅（住所検索で移動）
    defaultZoom: 11,
  });
});

app.use('/api/towns', townsRouter);
app.use('/api/municipalities', municipalitiesRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/staticmap', staticmapRouter);
app.use('/api/export', exportRouter);
app.use('/api/optimize', optimizeRouter);
app.use('/api/import', importRouter);
app.use('/api/customers', customersRouter);

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

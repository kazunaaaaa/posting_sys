// 町丁目（国勢調査 小地域）サービス
//
// e-Stat「境界データ 国勢調査 2020 小地域（町丁・字等別）」を市区町村単位で取得し、
// 実際の町丁目境界ポリゴン + 世帯数(SETAI) + 人口(JINKO) に変換してキャッシュする。
//
// 取得の優先順:
//   1) キャッシュ          server/data/towns/<市区町村コード>.json
//   2) 手動配置のZIP        server/data/towns/raw/<市区町村コード>.zip
//   3) e-Stat から自動ダウンロード（e-Statへ接続できる環境で動作）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';
import { simplifyRing, centroid, areaKm2 } from './geo.js';
import { DISTRIBUTION_RATE, distributionFor } from './distribution.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOWN_DIR = path.join(__dirname, '..', 'data', 'towns');
const RAW_DIR = path.join(TOWN_DIR, 'raw');
const TOLERANCE = Number(process.env.TOWN_SIMPLIFY ?? 0.00006); // 約6m

// e-Stat 境界データのダウンロードURL候補（測地系の指定違いを順に試す）
export function estatBoundaryUrls(cityCode) {
  const base = 'https://www.e-stat.go.jp/gis/statmap-search/data';
  const common = `dlserveyId=A002005212020&code=${cityCode}&coordSys=1&format=shape&downloadType=5`;
  return [`${base}?${common}&datum=2011`, `${base}?${common}&datum=2000`];
}

function ensureDirs() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

const memo = new Map();

async function downloadZip(cityCode) {
  const errors = [];
  for (const url of estatBoundaryUrls(cityCode)) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'posting-sys/0.1' } });
      if (!res.ok) { errors.push(`HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      // ZIP のシグネチャ(PK)を確認。HTMLのエラーページ等を弾く。
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) { errors.push('ZIP以外の応答'); continue; }
      return buf;
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(`e-Statから境界データを取得できません (${errors.join(', ')})`);
}

// ZIP(Buffer) → GeoJSON Feature配列
export async function readShapefileZip(zipBuf) {
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries();
  const shp = entries.find((e) => /\.shp$/i.test(e.entryName));
  const dbf = entries.find((e) => /\.dbf$/i.test(e.entryName));
  if (!shp || !dbf) throw new Error('ZIP内に .shp / .dbf が見つかりません');
  const cpg = entries.find((e) => /\.cpg$/i.test(e.entryName));
  const encoding = cpg ? cpg.getData().toString().trim().replace(/^cp?932$/i, 'shift_jis') : 'shift_jis';
  const source = await shapefile.open(shp.getData(), dbf.getData(), { encoding });
  const features = [];
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    features.push(r.value);
  }
  return features;
}

function num(v) {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Feature配列 → 町丁目エリア（KEY_CODEで統合）
export function normalizeTowns(features, cityCode) {
  const groups = new Map();
  for (const f of features) {
    const p = f.properties || {};
    if (!f.geometry) continue;
    if (String(p.HCODE) === '8154') continue; // 水面調査区は除外
    const key = String(p.KEY_CODE ?? '').trim();
    if (!key) continue;
    const g = groups.get(key) ?? { props: p, rings: [], setai: null, jinko: null };
    const rings = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates[0]]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((poly) => poly[0]) : [];
    g.rings.push(...rings);
    // 分割ポリゴンでは統計値が各片に重複するため、合算せず最大値を採用
    const s = num(p.SETAI); const j = num(p.JINKO);
    if (s != null) g.setai = Math.max(g.setai ?? 0, s);
    if (j != null) g.jinko = Math.max(g.jinko ?? 0, j);
    if (p.AREA_MAX_F === 'M') g.props = p;
    groups.set(key, g);
  }

  const towns = [];
  for (const [key, g] of groups) {
    const rings = g.rings
      .map((r) => (r.length > 30 ? simplifyRing(r, TOLERANCE) : r))
      .filter((r) => r.length >= 4)
      .map((r) => r.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]));
    if (!rings.length) continue;
    const main = rings.slice().sort((a, b) => areaKm2(b) - areaKm2(a))[0];
    const km2 = rings.reduce((s, r) => s + areaKm2(r), 0);
    const households = g.setai;
    towns.push({
      level: 'town',
      code: key,
      pref: g.props.PREF_NAME || '',
      city: g.props.CITY_NAME || '',
      cityCode,
      name: String(g.props.S_NAME || '').trim() || key,
      households,
      population: g.jinko,
      distribution: distributionFor(households),
      distributionRate: DISTRIBUTION_RATE,
      center: centroid(main),
      areaKm2: +km2.toFixed(4),
      householdDensity: households != null && km2 > 0 ? Math.round(households / km2) : null,
      polygon: main,
      polygons: rings,
    });
  }
  towns.sort((a, b) => a.code.localeCompare(b.code));
  return towns;
}

export async function getTowns(cityCode) {
  if (!/^\d{5}$/.test(cityCode)) throw new Error(`市区町村コードが不正です: ${cityCode}`);
  if (memo.has(cityCode)) return memo.get(cityCode);
  ensureDirs();
  const cachePath = path.join(TOWN_DIR, `${cityCode}.json`);
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    memo.set(cityCode, data);
    return data;
  }
  const rawPath = path.join(RAW_DIR, `${cityCode}.zip`);
  const source = fs.existsSync(rawPath) ? 'manual-zip' : 'e-stat';
  const zipBuf = source === 'manual-zip' ? fs.readFileSync(rawPath) : await downloadZip(cityCode);
  const towns = normalizeTowns(await readShapefileZip(zipBuf), cityCode);
  if (!towns.length) throw new Error('町丁目データが空です');
  const data = {
    cityCode,
    source,
    census: '令和2年国勢調査 小地域（町丁・字等別）',
    fetchedAt: new Date().toISOString(),
    towns,
  };
  fs.writeFileSync(cachePath, JSON.stringify(data));
  memo.set(cityCode, data);
  return data;
}

// KEY_CODE は先頭5桁が市区町村コード
export async function getTownsByCodes(codes) {
  const byCity = new Map();
  for (const c of codes) {
    const city = String(c).slice(0, 5);
    if (!byCity.has(city)) byCity.set(city, new Set());
    byCity.get(city).add(String(c));
  }
  const out = [];
  for (const [city, set] of byCity) {
    const { towns } = await getTowns(city);
    out.push(...towns.filter((t) => set.has(t.code)));
  }
  return out;
}

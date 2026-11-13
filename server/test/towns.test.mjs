// 町丁目（e-Stat 小地域シェープファイル）変換のテスト
// e-Statと同形式の模擬シェープファイル(Shift_JIS dbf)をメモリ上で生成し、
// ZIP展開 → 読込 → KEY_CODE統合 → 世帯数/部数算出 → キャッシュ までを検証する。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { rect, makeEstatZip } from './helpers/shpWriter.mjs';
import { readShapefileZip, normalizeTowns, getTowns, getTownsByCodes, estatBoundaryUrls } from '../services/towns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = { PREF_NAME: '千葉県', CITY_NAME: '松戸市' };
const ROWS = [
  { ...base, KEY_CODE: '12207001001', S_NAME: '胡録台', HCODE: 8101, AREA_MAX_F: 'M', JINKO: 6500, SETAI: 3120 },
  // 同じ町丁目が2片に分割（統計値は重複して入っている）
  { ...base, KEY_CODE: '12207002001', S_NAME: '上本郷一丁目', HCODE: 8101, AREA_MAX_F: 'M', JINKO: 2400, SETAI: 1100 },
  { ...base, KEY_CODE: '12207002001', S_NAME: '上本郷一丁目', HCODE: 8101, AREA_MAX_F: '', JINKO: 2400, SETAI: 1100 },
  // 水面調査区（除外されるべき）
  { ...base, KEY_CODE: '12207009999', S_NAME: '江戸川（水面）', HCODE: 8154, AREA_MAX_F: 'M', JINKO: 0, SETAI: 0 },
];
const GEOMS = [
  [rect(139.910, 35.780, 0.004, 0.003)],
  [rect(139.915, 35.790, 0.002, 0.002)],
  [rect(139.918, 35.790, 0.001, 0.001)],
  [rect(139.890, 35.770, 0.005, 0.010)],
];

const makeZip = () => makeEstatZip(GEOMS, ROWS, 'r2ka12207');

let pass = 0, fail = 0;
const ok = (label, cond, info = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${cond ? '' : ' → ' + info}`);
  cond ? pass++ : fail++;
};

// 1) ZIP読込・Shift_JIS デコード
const features = await readShapefileZip(makeZip());
ok('Feature数 = 4', features.length === 4, features.length);
ok('Shift_JIS 町名デコード', features[0].properties.S_NAME.trim() === '胡録台', features[0].properties.S_NAME);

// 2) 正規化
const towns = normalizeTowns(features, '12207');
ok('水面を除外し町丁目は2件', towns.length === 2, towns.length);
const kami = towns.find((t) => t.code === '12207002001');
ok('分割ポリゴンを1町丁目に統合（リング2つ）', kami?.polygons.length === 2, kami?.polygons.length);
ok('分割片の世帯数は合算せず1,100', kami?.households === 1100, kami?.households);
const koroku = towns.find((t) => t.code === '12207001001');
ok('胡録台 世帯数 3,120', koroku?.households === 3120, koroku?.households);
ok('胡録台 配布部数 = ROUNDDOWN(3,120×70%,-1) = 2,180', koroku?.distribution === 2180, koroku?.distribution);
ok('町名・市区町村名', koroku?.name === '胡録台' && koroku?.city === '松戸市', `${koroku?.name}/${koroku?.city}`);
ok('重心が区画内', koroku && koroku.center.lng > 139.910 && koroku.center.lng < 139.914 && koroku.center.lat > 35.780 && koroku.center.lat < 35.783);
ok('ダウンロードURLに市区町村コード', estatBoundaryUrls('12207')[0].includes('code=12207'));

// 3) 手動配置ZIP → getTowns → キャッシュ（テスト用コード 99999 を使用し後始末）
const townDir = path.join(__dirname, '..', 'data', 'towns');
const rawZip = path.join(townDir, 'raw', '99999.zip');
const cache = path.join(townDir, '99999.json');
fs.mkdirSync(path.dirname(rawZip), { recursive: true });
fs.writeFileSync(rawZip, makeZip());
try {
  const data = await getTowns('99999');
  ok('手動ZIPから取得（source=manual-zip）', data.source === 'manual-zip', data.source);
  ok('キャッシュJSONを書き出し', fs.existsSync(cache));
  const picked = await getTownsByCodes(['99999'.slice(0, 5) + '0'.repeat(0)]);
  ok('getTownsByCodes(該当なしコード)は空', picked.length === 0, picked.length);
} finally {
  fs.rmSync(rawZip, { force: true });
  fs.rmSync(cache, { force: true });
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);

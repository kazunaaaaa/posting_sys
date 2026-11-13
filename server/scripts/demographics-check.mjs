#!/usr/bin/env node
// 町丁目別「男女・年齢(5歳階級)別人口」の取得確認（ターゲット人数の元データ）
//   npm --prefix server run demographics:check -- 13122      (葛飾区。省略時も 13122)
//
// 確認内容: e-Statの小地域統計表の検索 → 男女・年齢分類の判定 → 町丁目境界との対応 → 人口の照合
import '../loadEnv.js';
import fs from 'fs';
import path from 'path';
import { getTowns } from '../services/towns.js';
import { getCityDemographics, countInBands, computeTargets } from '../services/demographics.js';
import { searchSmallAreaTables } from '../services/estatClient.js';
import { TOWN_DIR } from '../services/towns.js';

const city = process.argv[2] || '13122';
const c = { ok: (s) => `\x1b[32m${s}\x1b[0m`, ng: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
const appId = process.env.ESTAT_APP_ID;

console.log(c.b(`\n=== 町丁目別 年齢・男女別人口の確認（${city}）===\n`));
if (!appId) { console.log(c.ng('✗ ESTAT_APP_ID が未設定です（.env に設定してください）')); process.exit(1); }

// 1) 小地域の統計表を検索
console.log(c.b('[1] e-Stat 小地域統計表の検索'));
try {
  const tables = await searchSmallAreaTables(appId, {});
  console.log(`  候補 ${tables.length} 件`);
  for (const t of tables.slice(0, 8)) console.log(`   - ${t.id}  ${t.title.slice(0, 60)}`);
} catch (e) { console.log(c.ng(`✗ 検索に失敗: ${e.message}`)); process.exit(1); }

// 2) 取得（この市区町村のキャッシュと、都道府県の表の選択を一旦クリアして取り直す）
console.log(c.b('\n[2] 年齢・男女別人口の取得'));
const demoDir = path.join(TOWN_DIR, 'demo');
fs.rmSync(path.join(demoDir, `${city}.json`), { force: true });
let demo;
try {
  demo = await getCityDemographics(city);
  console.log(c.ok(`✓ 統計表 ${demo.table.id}「${demo.table.title.slice(0, 50)}」`));
  console.log(`  男女=${demo.meta.sexClass} / 年齢=${demo.meta.ageClass}（${demo.meta.bands}区分） / 時点=${demo.meta.timeCode} / 町丁目 ${demo.meta.areaCount} 件`);
} catch (e) {
  console.log(c.ng(`✗ 取得に失敗: ${e.message}`));
  console.log('  → この結果を開発者に送ってください（統計表の形式に合わせて調整します）');
  process.exit(1);
}

// 3) 町丁目境界との対応・人口の照合
console.log(c.b('\n[3] 町丁目境界データとの対応'));
const { towns } = await getTowns(city);
let matched = 0, popDemo = 0, popBoundary = 0;
for (const t of towns) {
  const d = demo.towns[t.code];
  if (!d) continue;
  matched++;
  popDemo += countInBands(d.bands, { ageMin: 0, ageMax: 120 }).target;
  popBoundary += t.population || 0;
}
const rate = towns.length ? (matched / towns.length) * 100 : 0;
console.log(`  町丁目 ${towns.length} 件中 ${matched} 件が対応（${rate.toFixed(1)}%）`);
if (!matched) {
  const sampleDemo = Object.keys(demo.towns).slice(0, 3).join(', ');
  const sampleTown = towns.slice(0, 3).map((t) => t.code).join(', ');
  console.log(c.ng(`  コードの形式が違います: 統計=${sampleDemo} / 境界=${sampleTown}`));
}
const diff = popBoundary ? Math.abs(popDemo - popBoundary) / popBoundary * 100 : 100;
console.log(`  人口の合計: 年齢別 ${Math.round(popDemo).toLocaleString()} 人 / 境界データ ${popBoundary.toLocaleString()} 人（差 ${diff.toFixed(1)}%）`);

// 4) ターゲット人数の例
console.log(c.b('\n[4] ターゲット人数の例（20〜59歳の女性・上位5町丁目）'));
const tg = await computeTargets(towns, { ageMin: 20, ageMax: 59, sex: 'female' });
const top = towns.map((t) => ({ t, x: tg.byCode[t.code] })).filter((r) => !r.x.estimated).sort((a, b) => b.x.target - a.x.target).slice(0, 5);
for (const r of top) console.log(`   - ${r.t.name}: ${r.x.target.toLocaleString()}人（人口の${(r.x.rate * 100).toFixed(1)}%）`);

console.log(c.b('\n=== 結果 ==='));
if (rate >= 90 && diff <= 5) {
  console.log(c.ok('✓ PASS: 町丁目別のターゲット人数を国勢調査の実数で計算できます。'));
} else if (matched > 0) {
  console.log(c.ng('△ PARTIAL: 一部の町丁目のみ対応、または人口の差が大きいです。この結果を送ってください。'));
} else {
  console.log(c.ng('✗ FAIL: 町丁目と対応できませんでした。この結果を送ってください（推計値で動作は続けます）。'));
  fs.rmSync(path.join(demoDir, `${city}.json`), { force: true });
}

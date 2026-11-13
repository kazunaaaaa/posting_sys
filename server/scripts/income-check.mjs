#!/usr/bin/env node
// 所得データの取得確認
//   npm --prefix server run income:check -- 14213      (大和市。省略時は 13122 葛飾区)
//
// 確認内容: 市区町村の平均所得（実データ） → 町丁目の4指標（推計の元データ） → 所得指数の分布
import '../loadEnv.js';
import fs from 'fs';
import path from 'path';
import { getTowns, TOWN_DIR } from '../services/towns.js';
import { getMunicipalIncome, getCityIncomeData, computeIncome, INDICATORS } from '../services/income.js';

const city = process.argv[2] || '13122';
const c = { ok: (s) => `\x1b[32m${s}\x1b[0m`, ng: (s) => `\x1b[31m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };

console.log(c.b(`\n=== 所得データの確認（${city}）===\n`));
if (!process.env.ESTAT_APP_ID) { console.log(c.ng('✗ ESTAT_APP_ID が未設定です（.env に設定してください）')); process.exit(1); }

// キャッシュを消して取り直す
const dir = path.join(TOWN_DIR, 'income');
fs.rmSync(path.join(dir, `${city}.json`), { force: true });
fs.rmSync(path.join(dir, '_tables.json'), { force: true });
try {
  const p = path.join(dir, '_municipal.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
  delete m[city];
  fs.writeFileSync(p, JSON.stringify(m));
} catch { /* なし */ }

console.log(c.b('[1] 市区町村の平均所得（実データ）'));
try {
  const m = await getMunicipalIncome(city);
  if (m) console.log(c.ok(`✓ 納税者1人あたり平均所得 約${Math.round(m.avgIncomeYen / 10000).toLocaleString()}万円（${m.year}年度・納税者 ${m.taxpayers.toLocaleString()}人）`));
  else console.log(c.warn('△ この市区町村のデータがありません'));
} catch (e) { console.log(c.ng(`✗ ${e.message}`)); }

console.log(c.b('\n[2] 町丁目の指標（国勢調査 小地域）'));
const data = await getCityIncomeData(city);
for (const [key, spec] of Object.entries(INDICATORS)) {
  const sh = data?.indicators?.[key];
  if (sh) {
    const v = Object.values(sh).filter(Number.isFinite);
    const avg = v.reduce((s, x) => s + x, 0) / (v.length || 1);
    console.log(c.ok(`✓ ${spec.label}: 町丁目 ${v.length} 件・平均 ${(avg * 100).toFixed(1)}%（統計表 ${data.tables[key]}）`));
  } else console.log(c.ng(`✗ ${spec.label}: 取得できませんでした`));
}
for (const e of data?.errors || []) console.log(c.warn(`  - ${e}`));

console.log(c.b('\n[3] 所得指数（推計・市区町村平均=1.00）'));
const { towns } = await getTowns(city);
const inc = await computeIncome(towns);
const list = towns.map((t) => ({ name: t.name, ...inc.byCode[t.code] })).filter((x) => x.index != null).sort((a, b) => b.index - a.index);
console.log(`  町丁目 ${towns.length} 件中 ${list.length} 件で算出（${towns.length ? ((list.length / towns.length) * 100).toFixed(1) : 0}%）`);
if (list.length) {
  const lv = {};
  for (const x of list) lv[x.level] = (lv[x.level] || 0) + 1;
  console.log(`  段階: ${['高い', 'やや高い', '平均', 'やや低い', '低い'].map((k) => `${k} ${lv[k] || 0}`).join(' / ')}`);
  console.log(`  高い順: ${list.slice(0, 5).map((x) => `${x.name} ${x.index.toFixed(2)}`).join('、')}`);
  console.log(`  低い順: ${list.slice(-5).reverse().map((x) => `${x.name} ${x.index.toFixed(2)}`).join('、')}`);
  console.log(c.ok('\n✓ 所得指数を使えます'));
} else {
  const sample = Object.keys(Object.values(data?.indicators || {})[0] || {}).slice(0, 3).join(', ');
  console.log(c.ng(`✗ 町丁目と対応できませんでした（統計=${sample || 'なし'} / 境界=${towns.slice(0, 3).map((t) => t.code).join(', ')}）`));
  console.log('  → この結果を開発者に送ってください');
  process.exit(1);
}

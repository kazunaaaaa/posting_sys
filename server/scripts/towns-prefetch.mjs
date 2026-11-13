#!/usr/bin/env node
// 町丁目データ（e-Stat 小地域境界）の一括事前取得
//
//   npm --prefix server run towns:prefetch -- 一都三県
//   npm --prefix server run towns:prefetch -- 全国
//   npm --prefix server run towns:prefetch -- 東京都 神奈川県      (都道府県名)
//   npm --prefix server run towns:prefetch -- 13 14 --concurrency=3  (都道府県コード)
//
// オプション:
//   --concurrency=N   同時ダウンロード数（既定3、最大5）
//   --force           取得済みも取り直す
//   --dry-run         対象と見込み時間だけ表示
//   --only=14213,...  指定した市区町村コードだけ取得
//
// 取得済みはスキップするので、途中で止めても（Ctrl+C）続きから再開できる。
import '../loadEnv.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTowns, forgetTowns, cachedCityCodes, TOWN_DIR } from '../services/towns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS = {
  一都三県: ['11', '12', '13', '14'],
  首都圏: ['11', '12', '13', '14'],
  関東: ['08', '09', '10', '11', '12', '13', '14'],
  関西: ['25', '26', '27', '28', '29', '30'],
  全国: Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0')),
};

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}`));
  if (!a) return def;
  const v = a.split('=')[1];
  return v === undefined ? true : v;
};
const concurrency = Math.max(1, Math.min(5, Number(opt('concurrency', 3)) || 3));
const force = !!opt('force', false);
const dryRun = !!opt('dry-run', false);
const only = String(opt('only', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
const terms = args.filter((a) => !a.startsWith('--'));

const { municipalities } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'municipalities.json'), 'utf-8'));
const prefByName = new Map(municipalities.map((m) => [m.pref, m.code.slice(0, 2)]));

const prefCodes = new Set();
for (const t of terms) {
  if (PRESETS[t]) PRESETS[t].forEach((c) => prefCodes.add(c));
  else if (/^\d{1,2}$/.test(t)) prefCodes.add(t.padStart(2, '0'));
  else if (prefByName.has(t)) prefCodes.add(prefByName.get(t));
  else if ([...prefByName.keys()].some((n) => n.startsWith(t))) prefCodes.add(prefByName.get([...prefByName.keys()].find((n) => n.startsWith(t))));
  else { console.error(`対象が分かりません: ${t}（例: 一都三県 / 全国 / 東京都 / 13）`); process.exit(1); }
}
if (only.length) only.forEach((c) => prefCodes.add(c.slice(0, 2)));
if (!prefCodes.size) {
  console.log('使い方: npm --prefix server run towns:prefetch -- 一都三県   （または 全国 / 東京都 / 13 など）');
  process.exit(1);
}

// 政令指定都市は区単位でデータがあるため、区を持つ親（例: 横浜市）は除外
const isParent = (m) => municipalities.some((o) => o.code !== m.code && o.city.startsWith(m.city + ' '));
const targets = municipalities.filter((m) => prefCodes.has(m.code.slice(0, 2)) && !isParent(m) && (!only.length || only.includes(m.code)));
const cached = cachedCityCodes();
const todo = force ? targets : targets.filter((m) => !cached.has(m.code));

const fmtTime = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}時間${Math.round((sec % 3600) / 60)}分`
  : sec >= 60 ? `${Math.floor(sec / 60)}分${Math.round(sec % 60)}秒` : `${Math.round(sec)}秒`);
const dirSizeMB = () => {
  if (!fs.existsSync(TOWN_DIR)) return 0;
  return fs.readdirSync(TOWN_DIR).filter((f) => f.endsWith('.json'))
    .reduce((s, f) => s + fs.statSync(path.join(TOWN_DIR, f)).size, 0) / 1024 / 1024;
};

console.log(`\n=== 町丁目データの一括取得 ===`);
console.log(`対象: ${[...prefCodes].sort().map((c) => municipalities.find((m) => m.code.startsWith(c))?.pref).join('・')}`);
console.log(`市区町村: ${targets.length} 件（取得済み ${targets.length - todo.length} 件 → 今回 ${todo.length} 件）`);
console.log(`保存先: ${TOWN_DIR}`);
console.log(`同時取得: ${concurrency} 件 / 見込み時間: 約${fmtTime((todo.length * 2.5) / concurrency)}`);
if (dryRun || !todo.length) {
  if (!todo.length) console.log('\n✓ すべて取得済みです。');
  process.exit(0);
}
console.log('');

const t0 = Date.now();
let done = 0, ok = 0, towns = 0;
const failed = [];
const queue = [...todo];

async function worker() {
  for (;;) {
    const m = queue.shift();
    if (!m) return;
    const name = `${m.pref}${m.city.replace(' ', '')}`;
    const t1 = Date.now();
    try {
      if (force) {
        fs.rmSync(path.join(TOWN_DIR, `${m.code}.json`), { force: true });
        forgetTowns(m.code);
      }
      const data = await getTowns(m.code);
      forgetTowns(m.code); // メモリを解放（データはファイルに保存済み）
      ok++; towns += data.towns.length;
      done++;
      console.log(`[${String(done).padStart(4)}/${todo.length}] ✓ ${m.code} ${name}  ${data.towns.length}町丁目  ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    } catch (e) {
      done++;
      failed.push({ code: m.code, name, error: e.message });
      console.log(`[${String(done).padStart(4)}/${todo.length}] ✗ ${m.code} ${name}  ${e.message}`);
    }
    if (done % 20 === 0 && queue.length) {
      const rate = (Date.now() - t0) / 1000 / done;
      console.log(`      … 残り ${queue.length} 件 / 約${fmtTime((rate * queue.length))}`);
    }
  }
}

process.on('SIGINT', () => {
  console.log(`\n中断しました（${ok}件取得済み）。同じコマンドで続きから再開できます。`);
  process.exit(130);
});

await Promise.all(Array.from({ length: concurrency }, worker));

const failPath = path.join(TOWN_DIR, 'prefetch-failed.json');
if (failed.length) fs.writeFileSync(failPath, JSON.stringify(failed, null, 2));
else fs.rmSync(failPath, { force: true });

console.log(`\n=== 結果 ===`);
console.log(`成功 ${ok} 件（町丁目 ${towns.toLocaleString()} 件）／ 失敗 ${failed.length} 件 ／ 所要 ${fmtTime((Date.now() - t0) / 1000)}`);
console.log(`保存容量（全キャッシュ）: ${dirSizeMB().toFixed(1)} MB`);
if (failed.length) {
  console.log(`\n失敗した市区町村（同じコマンドの再実行で再取得します）:`);
  for (const f of failed.slice(0, 30)) console.log(`  - ${f.code} ${f.name}: ${f.error}`);
  if (failed.length > 30) console.log(`  …ほか ${failed.length - 30} 件（${failPath}）`);
}
process.exit(failed.length ? 1 : 0);

#!/usr/bin/env node
// 町丁目データ（e-Stat 小地域境界）の取得・確認コマンド
//   npm --prefix server run towns:fetch -- 12207        # 松戸市
//   npm --prefix server run towns:fetch -- 12207 12217  # 複数可
import '../loadEnv.js';
import path from 'path';
import { getTowns, RAW_DIR } from '../services/towns.js';

const codes = process.argv.slice(2);
if (!codes.length) {
  console.log('使い方: npm --prefix server run towns:fetch -- <市区町村コード5桁> [...]');
  console.log('例:     npm --prefix server run towns:fetch -- 12207   (松戸市)');
  process.exit(1);
}

let failed = 0;
for (const code of codes) {
  process.stdout.write(`\n[${code}] 取得中… `);
  try {
    const t0 = Date.now();
    const { towns, source } = await getTowns(code);
    const hh = towns.reduce((s, t) => s + (t.households || 0), 0);
    const dist = towns.reduce((s, t) => s + (t.distribution || 0), 0);
    console.log(`OK (${source}, ${Date.now() - t0}ms)`);
    console.log(`  ${towns[0]?.pref ?? ''}${towns[0]?.city ?? ''}: 町丁目 ${towns.length} 件 / 世帯 ${hh.toLocaleString()} / 配布部数(×70%) ${dist.toLocaleString()} 部`);
    for (const t of towns.slice(0, 5)) {
      console.log(`   - ${t.code} ${t.name}: 世帯 ${t.households?.toLocaleString() ?? '—'} → ${t.distribution?.toLocaleString() ?? '—'}部`);
    }
  } catch (e) {
    failed++;
    console.log('失敗');
    console.log(`  ${e.message}`);
    console.log(`  → 手動の場合: e-Statの境界データ(小地域/シェープ/緯度経度)をダウンロードし ${path.join(RAW_DIR, `${code}.zip`)} に置いて再実行`);
  }
}
process.exit(failed ? 1 : 0);

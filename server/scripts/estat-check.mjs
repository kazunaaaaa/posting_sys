#!/usr/bin/env node
// e-Stat 世帯数 疎通確認スクリプト
//
// 使い方（プロジェクトルートで）:
//   1) .env に ESTAT_APP_ID を設定
//   2) node server/scripts/estat-check.mjs
//      → statsDataId 未設定なら「世帯数 市区町村」で候補を検索して一覧表示
//   3) .env に ESTAT_STATS_DATA_ID を設定して再実行
//      → メタ検出・世帯数取得・マスタ結合まで検証しPASS/FAILを表示
//
// 任意の上書き: ESTAT_HOUSEHOLD_CLASS / ESTAT_HOUSEHOLD_CODE / ESTAT_TIME_CODE
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  searchTables, getMeta, detectHouseholdCode, detectAreaClassId, detectLatestTime,
  fetchMunicipalityHouseholds,
} from '../services/estatClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_RATE = 0.7;

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  ng: (s) => `\x1b[31m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function loadMaster() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'municipalities.json'), 'utf-8');
  return JSON.parse(raw).municipalities;
}

// 確認用サンプル自治体
const SAMPLES = [
  ['01101', '札幌市中央区'], ['12207', '松戸市'], ['13112', '世田谷区'],
  ['14100', '横浜市'], ['27100', '大阪市'], ['40130', '福岡市博多区'],
];

async function main() {
  const appId = process.env.ESTAT_APP_ID;
  const statsDataId = process.env.ESTAT_STATS_DATA_ID;

  console.log(c.b('\n=== e-Stat 世帯数 疎通確認 ===\n'));
  if (!appId) {
    console.log(c.ng('✗ ESTAT_APP_ID が未設定です。'));
    console.log('  https://www.e-stat.go.jp/api/ でアプリケーションIDを取得し .env に設定してください。\n');
    process.exit(1);
  }
  console.log(`ESTAT_APP_ID: ${c.ok('設定済み')} (${appId.slice(0, 6)}…)`);

  // STEP 1: 接続確認（getStatsList）
  console.log(c.b('\n[1] 接続確認 (getStatsList)'));
  let tables;
  try {
    tables = await searchTables(appId, { searchWord: '世帯数 市区町村', limit: 15 });
    console.log(c.ok(`✓ 接続成功。候補統計表 ${tables.length} 件`));
  } catch (e) {
    console.log(c.ng(`✗ 接続失敗: ${e.message}`));
    console.log('  appId の誤り、またはネットワーク制限の可能性があります。\n');
    process.exit(1);
  }

  // statsDataId 未設定なら候補を提示して終了
  if (!statsDataId) {
    console.log(c.b('\n[2] statsDataId 候補（.env の ESTAT_STATS_DATA_ID に設定して再実行）'));
    for (const t of tables) {
      console.log(`  ${c.b(t.id)}  ${t.statName ?? ''} ${c.dim('/ ' + (t.title ?? ''))}`);
    }
    console.log('\n  「男女別人口総数及び世帯総数－全国，都道府県，市区町村」等、市区町村別に世帯数を持つ表を選んでください。\n');
    process.exit(0);
  }
  console.log(`ESTAT_STATS_DATA_ID: ${c.ok(statsDataId)}`);

  // STEP 2: メタ情報の検出
  console.log(c.b('\n[2] メタ情報の検出 (getMetaInfo)'));
  let classObjs;
  try {
    classObjs = await getMeta(appId, statsDataId);
  } catch (e) {
    console.log(c.ng(`✗ メタ取得失敗: ${e.message}\n`));
    process.exit(1);
  }
  console.log('  分類:', classObjs.map((o) => `${o.id}(${o.name}, ${o.classes.length}種)`).join(' / '));
  const hh = process.env.ESTAT_HOUSEHOLD_CODE
    ? { classId: process.env.ESTAT_HOUSEHOLD_CLASS, code: process.env.ESTAT_HOUSEHOLD_CODE, name: '(env指定)' }
    : detectHouseholdCode(classObjs);
  const areaId = detectAreaClassId(classObjs);
  const timeCode = process.env.ESTAT_TIME_CODE ?? detectLatestTime(classObjs);
  if (!hh) {
    console.log(c.ng('✗ 「世帯数」分類が見つかりません。'));
    console.log('  別のstatsDataId、または ESTAT_HOUSEHOLD_CLASS/ESTAT_HOUSEHOLD_CODE で明示してください。\n');
    process.exit(1);
  }
  console.log(`  世帯数分類: ${c.ok(`${hh.classId}=${hh.code}`)} (${hh.name})`);
  console.log(`  地域分類ID: ${areaId} / 時間軸: ${timeCode ?? '(なし)'}`);

  // STEP 3: 世帯数の取得
  console.log(c.b('\n[3] 市区町村別世帯数の取得 (getStatsData)'));
  let result;
  try {
    result = await fetchMunicipalityHouseholds(appId, statsDataId, {
      householdClassId: hh.classId, householdCode: hh.code, timeCode,
    });
  } catch (e) {
    console.log(c.ng(`✗ 取得失敗: ${e.message}\n`));
    process.exit(1);
  }
  const { households, meta } = result;
  console.log(c.ok(`✓ ${meta.municipalityCount} 市区町村の世帯数を取得（VALUE ${meta.totalValues} 件）`));
  console.log(c.b('\n  サンプル自治体の世帯数 → 配布部数(×70%):'));
  for (const [code, name] of SAMPLES) {
    const hhVal = households[code];
    if (hhVal != null) {
      console.log(`    ${code} ${name}: 世帯 ${hhVal.toLocaleString()} → ${c.ok(Math.round(hhVal * DIST_RATE).toLocaleString() + '部')}`);
    } else {
      console.log(`    ${code} ${name}: ${c.dim('該当なし（コード体系差の可能性）')}`);
    }
  }

  // STEP 4: マスタとの結合率
  console.log(c.b('\n[4] 全国マスタ(municipalities.json)との結合'));
  const master = loadMaster();
  const matched = master.filter((m) => households[m.code] != null);
  const rate = ((matched.length / master.length) * 100).toFixed(1);
  console.log(`  マスタ ${master.length} 件中 ${c.b(matched.length + ' 件')} が結合 (${rate}%)`);
  const unmatchedSample = master.filter((m) => households[m.code] == null).slice(0, 5).map((m) => `${m.code}:${m.city}`);
  if (unmatchedSample.length) console.log(c.dim(`  未結合例: ${unmatchedSample.join(', ')}`));

  // 総合判定
  console.log(c.b('\n=== 結果 ==='));
  if (matched.length > master.length * 0.7) {
    console.log(c.ok('✓ PASS: e-Stat 世帯数の疎通・結合に成功しました。'));
    console.log('  サーバー(server)を再起動すると市区町村モードで真値の部数が表示されます。\n');
  } else if (matched.length > 0) {
    console.log(c.ng('△ PARTIAL: 一部のみ結合。コード体系（区/政令市の扱い）や統計表の粒度を確認してください。'));
    console.log('  例: 市区町村単位の表か、時間軸(ESTAT_TIME_CODE)が適切かをご確認ください。\n');
  } else {
    console.log(c.ng('✗ FAIL: 結合0件。統計表の @area が市区町村コードでない可能性があります。別のstatsDataIdをお試しください。\n'));
  }
}

main().catch((e) => { console.error(c.ng('予期せぬエラー:'), e); process.exit(1); });

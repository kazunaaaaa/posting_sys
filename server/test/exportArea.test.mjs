// 配布部数表（エリア表）Excel 生成のテスト
import ExcelJS from 'exceljs';
import { buildAreaWorkbook, townLabel, cityLabel, copiesLabel, titleFor } from '../services/exportArea.js';
import { distributionFor, normalizeRate, applyRate } from '../services/distribution.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` → got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// 表記変換
eq('南林間一丁目 → 南林間(1)', townLabel('南林間一丁目'), '南林間(1)');
eq('中央林間西一丁目 → 中央林間西(1)', townLabel('中央林間西一丁目'), '中央林間西(1)');
eq('本町十二丁目 → 本町(12)', townLabel('本町十二丁目'), '本町(12)');
eq('二十三丁目 → (23)', townLabel('緑町二十三丁目'), '緑町(23)');
eq('全角数字 南麻布３丁目 → 南麻布(3)', townLabel('南麻布３丁目'), '南麻布(3)');
eq('丁目なし 下鶴間 → そのまま', townLabel('下鶴間'), '下鶴間');
eq('相模原市 南区 → 相模原市南区', cityLabel('相模原市 南区'), '相模原市南区');
eq('20000 → 2万部', copiesLabel(20000), '2万部');
eq('10140 → 10140部', copiesLabel(10140), '10140部');
eq('タイトル', titleFor({ storeName: 'Parfait Bar＆VIGO広尾店', projectName: 'オープン案件', copies: 20000 }),
  '【エリア表】_Parfait Bar＆VIGO広尾店様_オープン案件_20000部エリア');
eq('部数ルール ROUNDDOWN(1708*0.708,-1)=1200', distributionFor(1708, 0.708), 1200);
eq('部数ルール 3120*0.7 → 2180', distributionFor(3120), 2180);
eq('カバー率 0.65 はそのまま', normalizeRate(0.65), 0.65);
eq('カバー率 80（％）→ 0.8', normalizeRate(80), 0.8);
eq('カバー率 不正値 → 既定0.7', [normalizeRate(''), normalizeRate(-5), normalizeRate('abc'), normalizeRate(500)].join(), '0.7,0.7,0.7,0.7');
const ra = applyRate([{ code: 'a', households: 1000, distribution: 700 }, { code: 'b', households: null, distribution: null }], 0.55);
eq('applyRate 1000世帯×55% → 550部', ra[0].distribution, 550);
eq('applyRate 世帯数なしはそのまま', ra[1].distribution, null);


// ワークブック
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const rows = [
  { city: '大和市', town: '中央林間二丁目', households: 1450 },
  { city: '大和市', town: '下鶴間', households: 2210 },
  { city: '相模原市 南区', town: '相南四丁目', households: 1800 },
];
const { buffer, title, sheetName, totalCopies } = await buildAreaWorkbook({
  rows, coverRate: 0.7, storeName: 'テスト店', projectName: 'オープン案件', targetCopies: 10000,
  mapImage: PNG, mapSize: { width: 1280, height: 1034 },
});
eq('シート名', sheetName, '1万部エリア');
eq('合計部数(10部切捨ての合計)', totalCopies, 1010 + 1540 + 1260);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
const ws = wb.worksheets[0];
eq('B1 タイトル', ws.getCell('B1').value, title);
eq('B1:D1 結合', ws.model.merges.includes('B1:D1'), true);
eq('F1 カバー率 0.7 / 書式 0.00%', [ws.getCell('F1').value, ws.getCell('F1').numFmt], [0.7, '0.00%']);
eq('F2 合計部数の式', ws.getCell('F2').formula, 'E7&"部"');
eq('見出し', ['B3', 'C3', 'D3', 'E3', 'F3'].map((a) => ws.getCell(a).value), ['市区町村名', '町丁目名', '世帯数', '配布予定数', '備考']);
eq('見出しの塗り F2F2F2', ws.getCell('B3').fill.fgColor.argb, 'FFF2F2F2');
eq('4行目 市区町村/町丁目', [ws.getCell('B4').value, ws.getCell('C4').value], ['大和市', '中央林間(2)']);
eq('6行目 政令市の区', [ws.getCell('B6').value, ws.getCell('C6').value], ['相模原市南区', '相南(4)']);
eq('E4 ROUNDDOWN式', ws.getCell('E4').formula, 'ROUNDDOWN(D4*$F$1,-1)');
eq('E4 計算結果 1450*0.7 → 1010', ws.getCell('E4').result, 1010);
eq('合計行 D7/E7', [ws.getCell('D7').formula, ws.getCell('E7').formula], ['SUM(D4:D6)', 'SUM(E4:E6)']);
eq('罫線あり', ws.getCell('C5').border.left.style, 'thin');
eq('フォント', ws.getCell('C5').font.name, 'ＭＳ Ｐゴシック');
eq('ウィンドウ枠固定(3行目まで)', ws.views[0].ySplit, 3);
eq('印刷範囲', ws.pageSetup.printArea, 'A1:F8');
const imgs = ws.getImages();
eq('地図画像 1枚 / G4起点', [imgs.length, imgs[0]?.range.tl.nativeCol, imgs[0]?.range.tl.nativeRow], [1, 6, 3]);

// 画像アンカーのスキーマ準拠（oneCellAnchor に editAs を付けない）
const AdmZip = (await import('adm-zip')).default;
const drawingXml = new AdmZip(buffer).getEntry('xl/drawings/drawing1.xml').getData().toString('utf8');
eq('oneCellAnchor に editAs が無い', /<xdr:oneCellAnchor[^>]*editAs/.test(drawingXml), false);
eq('画像の大きさ(EMU) 幅1001px', /<xdr:ext cx="9534525"/.test(drawingXml), true);

// 地図なしでも出力できる
const noMap = await buildAreaWorkbook({ rows });

// ターゲット（人数・占有率）の2行
const withT = await buildAreaWorkbook({ rows, target: { label: '20〜59歳の女性', people: 7611.4, share: 0.243, note: '国勢調査' } });
const wbT = new ExcelJS.Workbook();
await wbT.xlsx.load(withT.buffer);
const wsT = wbT.worksheets[0];
eq('ターゲット人数 F3', [wsT.getCell('C3').value, wsT.getCell('F3').value, wsT.getCell('F3').numFmt], ['ターゲット（20〜59歳の女性）：', 7611, '"約"#,##0"人"']);
eq('ターゲット占有率 F4', [wsT.getCell('C4').value, wsT.getCell('F4').value, wsT.getCell('F4').numFmt], ['ターゲット占有率（人口比）：', 0.243, '0.0%']);
eq('見出しは5行目に下がる', ['B5', 'F5'].map((a) => wsT.getCell(a).value), ['市区町村名', '備考']);
eq('1行目のエリアは6行目・式も追従', wsT.getCell('E6').formula, 'ROUNDDOWN(D6*$F$1,-1)');
eq('合計部数の式も追従', wsT.getCell('F2').formula, `E${6 + rows.length}&"部"`);
eq('ウィンドウ枠の固定も5行目まで', wsT.views[0].ySplit, 5);
const zeroT = await buildAreaWorkbook({ rows, target: { label: 'x', people: 0 } });
const wbZ = new ExcelJS.Workbook(); await wbZ.xlsx.load(zeroT.buffer);
eq('ターゲット0人なら行を足さない', wbZ.worksheets[0].getCell('B3').value, '市区町村名');
eq('地図なしでも出力', noMap.buffer.length > 1000, true);

// 顧客分析レポート（別シート）
const cr = {
  summary: { total: 60, matched: 55, chome: 50, town: 5, unmatched: 5, excluded: 2, store: 'テスト店' },
  center: '緯度 35.5 / 経度 139.4',
  radius: { '0.5': 0.6, '0.8': 1.2, '0.9': 1.8 },
  distanceBands: [{ label: '0.5km未満', count: 20 }, { label: '0.5〜1km', count: 25 }, { label: '1km以上', count: 10 }],
  ageBands: [{ label: '20代', count: 10 }, { label: '30代', count: 30 }, { label: '40代', count: 15 }],
  ageSuggest: { min: 25, max: 49, median: 36 },
  cities: [{ name: '大和市', count: 40 }, { name: '座間市', count: 15 }],
  towns: [
    { name: '南林間一丁目', city: '大和市', customers: 12, households: 1500, per1000: 8, distanceKm: 0.3, selected: true },
    { name: '相模が丘六丁目', city: '座間市', customers: 6, households: 1200, per1000: 5, distanceKm: 1.4, selected: false },
  ],
  area: { townCount: 1, copies: 1050, households: 1500, customers: 12, per1000: 8, optimized: true,
    towns: [{ name: '南林間一丁目', city: '大和市', households: 1500, copies: 1050, customers: 12, per1000: 8 }] },
  candidates: [{ name: '相模が丘六丁目', city: '座間市', customers: 6, households: 1200, per1000: 5, distanceKm: 1.4 }],
  overallPer1000: 4,
};
const withC = await buildAreaWorkbook({ rows, customerReport: cr });
eq('顧客分析レポートのシート名', withC.customerSheetName, '顧客分析レポート');
const zc = new AdmZip(withC.buffer);
eq('シートの順番（エリア表 → 顧客分析）', [...zc.readAsText('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]), [withC.sheetName, '顧客分析レポート']);
const ssc = zc.readAsText('xl/sharedStrings.xml');
for (const t of ['■ 結論：顧客分析から絞り込んだ配布エリア', '80%が約1.2km', '顧客全体の22%', '2.0倍', '追加候補（エリア外で顧客が多い）: 相模が丘(6)', '■ 📍からの距離別の顧客', '■ 顧客の年齢層', '■ 絞り込んだ配布エリア（1町丁目・1,050部）', '退会者 2人を除く', '個人の情報は含めず']) {
  eq(`顧客分析に「${t}」`, ssc.includes(t), true);
}
eq('customerReport なしなら付けない', (await buildAreaWorkbook({ rows })).customerSheetName, null);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);

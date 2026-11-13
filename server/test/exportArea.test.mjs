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
eq('地図なしでも出力', noMap.buffer.length > 1000, true);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);

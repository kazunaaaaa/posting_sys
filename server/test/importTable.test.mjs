// 貼り付けたエリア表の読み取りと町丁目への照合
import { parseAreaTable, matchAreaTable, townKey, resolveCity } from '../services/importTable.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`✓ ${name}`); } else { fail++; console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
}

// --- 読み取り ---
const pasted = [
  '坂戸市北峰183-2',
  '都道府県\t市区町村\t町丁目名\t一般世帯数\t配布予定数',
  '埼玉県\t坂戸市\t日の出町\t1137\t790',
  '埼玉県\t坂戸市\t泉町\t517\t360',
  '埼玉県\t坂戸市\t泉町(2)\t602\t420',
  '埼玉県\t坂戸市\t泉町(3)\t673\t470',
  '埼玉県\t坂戸市\t大字浅羽\t409\t280',
  '埼玉県\t坂戸市\t浅羽野(1)\t338\t230',
  '埼玉県\t坂戸市\tにっさい花みず木(2)\t327\t220',
  '埼玉県\t坂戸市\t鶴舞(1)\t1,131\t90',
  '埼玉県\t坂戸市\t存在しない町\t10\t0',
  '\t\t合計\t9999\t9999',
].join('\r\n');
const p = parseAreaTable(pasted);
eq('住所（表の上の1セル）', p.address, '坂戸市北峰183-2');
eq('見出しから列を判定', p.columns, { pref: 0, city: 1, town: 2, households: 3, copies: 4 });
eq('行数（合計行は除く）', p.rows.length, 9);
eq('世帯数のカンマ', p.rows[7].households, 1131);
eq('配布予定数', p.rows[0].copies, 790);

const noHead = parseAreaTable('坂戸市\t日の出町\t1137\t790\n\t本町\t996\t690\n埼玉県坂戸市\t仲町\t869\t600');
eq('見出しなし: 市区町村・町丁目・数字', noHead.rows.map((r) => [r.city, r.town, r.households, r.copies]),
  [['坂戸市', '日の出町', 1137, 790], ['坂戸市', '本町', 996, 690], ['坂戸市', '仲町', 869, 600]]);
eq('「埼玉県坂戸市」を分ける', [noHead.rows[2].pref, noHead.rows[2].city], ['埼玉県', '坂戸市']);
eq('エリア表Excel形式（市区町村名・町丁目名・世帯数・配布予定数）',
  parseAreaTable('市区町村名\t町丁目名\t世帯数\t配布予定数\n大和市\t南林間(1)\t1234\t860').rows[0],
  { line: 2, pref: '', city: '大和市', town: '南林間(1)', households: 1234, copies: 860 });

// --- 表記ゆれ ---
eq('丁目の表記ゆれ', ['泉町二丁目', '泉町２丁目', '泉町(2)', '泉町（２）', '泉町2'].map((x) => townKey(x)), Array(5).fill('泉町(2)'));
eq('大字を除く', townKey('大字浅羽'), '浅羽');
eq('ケ・ヶ・の・ノ（ゆるい照合）', [townKey('日ノ出町', { loose: true }), townKey('日の出町', { loose: true })], ['日の出町', '日の出町']);

// --- 市区町村 ---
eq('坂戸市', resolveCity('埼玉県', '坂戸市').codes, ['11239']);
eq('政令市名だけ → 全区', resolveCity('神奈川県', '横浜市').codes.length, 18);
eq('政令市の区（空白なし）', resolveCity('', '相模原市南区').codes, ['14153']);
eq('同名の市は注意を出す', !!resolveCity('', '府中市').note, true);
eq('存在しない市', resolveCity('', 'あいうえ市').codes, []);

// --- 照合 ---
const T = (code, name, hh = 100) => ({ code, name, households: hh, cityCode: '11239' });
const towns = [
  T('11239001001', '日之出町'), T('11239002001', '泉町一丁目'), T('11239002002', '泉町二丁目'), T('11239002003', '泉町三丁目'),
  T('11239003000', '浅羽'), T('11239004001', '浅羽野一丁目'), T('11239005002', 'にっさい花みず木二丁目'),
  T('11239006001', '鶴舞一丁目'),
];
const res = await matchAreaTable(p.rows, { loadTowns: async (code) => ({ towns: code === '11239' ? towns : [] }) });
const byInput = Object.fromEntries(res.matched.map((m) => [m.input, m.codes]));
eq('日の出町 ↔ 日之出町（ゆるい照合）', byInput['坂戸市 日の出町'], ['11239001001']);
eq('泉町 → 他の行で指定のない 泉町一丁目', byInput['坂戸市 泉町'], ['11239002001']);
eq('泉町(2)', byInput['坂戸市 泉町(2)'], ['11239002002']);
eq('大字浅羽 → 浅羽', byInput['坂戸市 大字浅羽'], ['11239003000']);
eq('にっさい花みず木(2)', byInput['坂戸市 にっさい花みず木(2)'], ['11239005002']);
eq('照合できない行', res.unmatched.map((u) => u.input), ['坂戸市 存在しない町']);
eq('読み込む市区町村', res.cityCodes, ['11239']);
eq('貼り付けた世帯数を返す', res.matched.find((m) => m.input === '坂戸市 泉町(2)').households, 602);

// 丁目なしの町名だけ → 全丁目
const all = await matchAreaTable([{ line: 1, pref: '', city: '坂戸市', town: '泉町', households: 1792 }], { loadTowns: async () => ({ towns }) });
eq('丁目なしの町名だけなら全丁目', all.matched[0].codes, ['11239002001', '11239002002', '11239002003']);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);

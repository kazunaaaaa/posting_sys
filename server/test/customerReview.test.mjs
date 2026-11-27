// 顧客データによる配布エリアの見直し（架空の格子状の町丁目で検証）
import { reviewArea, direction, probZero } from '../services/customerReview.js';
import { buildAreaWorkbook } from '../services/exportArea.js';
import AdmZip from 'adm-zip';

let pass = 0, fail = 0;
const ok = (label, cond, info = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${cond ? '' : ' → ' + info}`); cond ? pass++ : fail++; };

// 9×9 の格子（約360m四方・各1000世帯 = 700部）。中央(4,4)に店舗
const W = 0.004, H = 0.0034, X0 = 139.40, Y0 = 35.50;
const towns = [];
for (let c = 0; c < 9; c++) for (let r = 0; r < 9; r++) {
  const x = X0 + c * W, y = Y0 + r * H;
  const ring = [[x, y], [x, y + H], [x + W, y + H], [x + W, y], [x, y]];
  towns.push({ code: `T${c}${r}`, name: `町${c}${r}`, city: 'テスト市', polygon: ring, polygons: [ring],
    center: { lat: y + H / 2, lng: x + W / 2 }, households: 1000, distribution: 700 });
}
const pin = { lat: Y0 + 4 * H + H / 2, lng: X0 + 4 * W + W / 2 };
// 前回エリア: 中央の5×5（c=2..6, r=2..6）
const base = towns.filter((t) => { const c = +t.code[1], r = +t.code[2]; return c >= 2 && c <= 6 && r >= 2 && r <= 6; }).map((t) => t.code);
// 顧客: 北側（r=6）の5町丁目は0人、それ以外の前回エリアは各3人。エリア外の南側 (3,1)(4,1)(5,1) に各3人
const customers = {};
for (const c of base) if (c[2] !== '6') customers[c] = 3;
for (const c of ['T31', 'T41', 'T51']) customers[c] = 3;

ok('方位: 真北', direction(pin, { lat: pin.lat + 0.01, lng: pin.lng }) === '北');
ok('方位: 南西', direction(pin, { lat: pin.lat - 0.01, lng: pin.lng - 0.012 }) === '南西');
ok('ポアソン: 期待値6で0人は0.25%', Math.abs(probZero(6) - 0.00248) < 0.0001);

const r = reviewArea({ towns, pin, baseCodes: base, customers });
ok('前回エリアの集計', r.base.towns === 25 && r.base.copies === 17500 && r.base.customers === 60, JSON.stringify(r.base));
const rm = r.suggestion.removed.map((t) => t.code).sort();
ok('削除: 顧客0人の北側5町丁目（上限35%の範囲）', rm.length >= 5 && rm.every((c) => c[2] === '6'), rm.join(','));
ok('削除の根拠に「顧客0人」と期待値', r.suggestion.removed[0].reason.includes('顧客0人') && r.suggestion.removed[0].expected === 2.4, r.suggestion.removed[0].reason);
ok('偶然0人の確率が小さい', r.suggestion.groupP < 0.001, r.suggestion.groupP);
const ad = r.suggestion.added.map((t) => t.code).sort();
ok('追加: 顧客のいる南側の隣接町丁目', ['T31', 'T41', 'T51'].every((c) => ad.includes(c)), ad.join(','));
ok('部数: 削除5（3,500部）・追加3（2,100部）', r.suggestion.copies === 16100, r.suggestion.copies);
ok('部数が減ることを要約で知らせる', r.suggestion.summary.includes('1,400部少なく'), r.suggestion.summary);
ok('追加の根拠に「未配布なのに顧客」', r.suggestion.added[0].reason.includes('未配布なのに顧客'), r.suggestion.added[0].reason);
ok('傾向: 北側が薄い', r.trends.bullets.some((b) => b.includes('北側')), r.trends.bullets.join('\n'));
ok('傾向: エリア外の顧客', r.trends.outsideCustomers === 9 && r.trends.outsideTowns === 3, JSON.stringify(r.trends));

// 差分: 比較元 → 提案どおりの選択
const d = reviewArea({ towns, pin, baseCodes: base, currentCodes: r.suggestion.codes, customers }).diff;
ok('差分: 削除・追加の件数', d.removed.length === rm.length && d.added.length === ad.length, `${d.removed.length}/${d.added.length}`);
ok('差分: 顧客0人の削除をまとめた確率', d.zeroRemoved.count === rm.length && d.zeroRemoved.p < 0.001, JSON.stringify(d.zeroRemoved));
ok('差分: 浸透度が上がる', d.after.per1000 > d.before.per1000, `${d.before.per1000} → ${d.after.per1000}`);
ok('差分: 要約文', d.summary.includes('削除') && d.summary.includes('偶然0人'), d.summary);

// 偶然の範囲なら削除しない（顧客が少ない）
const few = {}; for (const c of base.slice(0, 5)) few[c] = 1; // 25町丁目で5人 → 0人の町丁目の期待値は各0.2
const r2 = reviewArea({ towns, pin, baseCodes: base, customers: few });
ok('期待値が小さければ削除しない', r2.suggestion.removed.length === 0, JSON.stringify(r2.suggestion.removed));
ok('同じ部数の差分が無ければ diff は null', reviewArea({ towns, pin, baseCodes: base, currentCodes: base, customers }).diff === null);
ok('比較元が無ければ null', reviewArea({ towns, pin, baseCodes: [], customers }) === null);

// Excel「顧客分析レポート」に傾向・削除/追加の根拠が載る
const rows = r.suggestion.codes.map((c) => ({ city: 'テスト市', town: `町${c.slice(1)}`, households: 1000 }));
const rvDiff = reviewArea({ towns, pin, baseCodes: base, currentCodes: r.suggestion.codes, customers });
const wb = await buildAreaWorkbook({ rows, customerReport: { summary: { total: 69, matched: 69 }, towns: [], review: rvDiff } });
const ss = new AdmZip(wb.buffer).readAsText('xl/sharedStrings.xml');
for (const s of ['■ 顧客分布の傾向', '■ 方位別の浸透度', '■ 配布エリアの見直し（前回 → 今回）', '■ 削除した町丁目と根拠', '■ 追加した町丁目と根拠', '偶然0人', '前回エリアからの見直し']) ok(`レポートに「${s}」`, ss.includes(s));
const wb2 = await buildAreaWorkbook({ rows, customerReport: { summary: {}, towns: [], review: r } });
const ss2 = new AdmZip(wb2.buffer).readAsText('xl/sharedStrings.xml');
ok('差分が無いときは見直し案を載せる', ss2.includes('■ 配布エリアの見直し案') && ss2.includes('■ 削除を提案する町丁目と根拠'));

console.log(`\n${fail ? '❌' : '✅ ALL PASS'}  (${pass} passed, ${fail} failed)`);
if (fail) process.exit(1);

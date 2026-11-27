// 顧客住所 → 町丁目 の照合（架空の住所・架空の町丁目で検証）
import { normalizeAddress, splitAddress, buildTownIndex, matchTown, matchCustomers } from '../services/customers.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`✓ ${name}`); } else { fail++; console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
}

eq('全角・ハイフン類の正規化', normalizeAddress('相模が丘６－１２－７ ビル'), '相模が丘6-12-7ビル');
eq('長音「ー」の数字区切り', normalizeAddress('相模が丘3ー21ー8'), '相模が丘3-21-8');

// 市区町村
const s1 = splitAddress('神奈川県', '相模原市南区相南4-24-18-401');
eq('政令市の区', [s1.city.code, s1.city.codes, s1.rest], ['14153', ['14153'], '相南4-24-18-401']);
const s2 = splitAddress('', '神奈川県座間市相模が丘1-20-15');
eq('住所に都道府県を含む', [s2.pref, s2.city.code, s2.rest], ['神奈川県', '14216', '相模が丘1-20-15']);
const s3 = splitAddress('神奈川県', '相模原市相南1-2-3');
eq('区のない政令市 → 全区を対象', [s3.city.code, s3.city.codes.length], ['14150', 3]);
const s4 = splitAddress('埼玉県', '北葛飾郡杉戸町清地1-1');
eq('郡を除く', [s4.city.code, s4.rest], ['11464', '清地1-1']);
eq('市区町村が分からない', splitAddress('', 'どこか1-2').city, null);

// 町丁目
const T = (code, name) => ({ code, name, cityCode: '14153', city: '相模原市南区', center: { lat: 35.5, lng: 139.4 }, households: 1000 });
const towns = [
  T('a1', '相南一丁目'), T('a4', '相南四丁目'), T('k1', '上鶴間一丁目'), T('k2', '上鶴間二丁目'), T('kh', '上鶴間本町一丁目'),
  T('m', '松が枝町'), T('s6', '相模が丘六丁目'), T('o', '大字座間'), T('mk', '緑ケ丘'),
];
const idx = buildTownIndex(towns);
eq('「相南4-24-18-401」→ 相南四丁目', matchTown('相南4-24-18-401', idx), { codes: ['a4'], level: 'chome', base: '相南' });
eq('「相南1丁目23番6号」', matchTown('相南1丁目23番6号', idx).codes, ['a1']);
eq('「相南一丁目」（漢数字）', matchTown('相南一丁目5', idx).codes, ['a1']);
eq('丁目のない町「松が枝町19-13-103」', [matchTown('松が枝町19-13-103', idx).codes, matchTown('松が枝町19-13-103', idx).level], [['m'], 'chome']);
eq('長い町名を優先「上鶴間本町1-2」', matchTown('上鶴間本町1-2', idx).codes, ['kh']);
eq('丁目が分からない「上鶴間」→ 全丁目', matchTown('上鶴間', idx), { codes: ['k1', 'k2'], level: 'town', base: '上鶴間' });
eq('存在しない丁目番号「上鶴間123-04」→ 全丁目', matchTown('上鶴間123-04', idx).level, 'town');
eq('ケ/ヶ のゆれ「緑ヶ丘」', matchTown('緑ヶ丘', idx).codes, ['mk']);
eq('大字の有無「座間」', matchTown('座間', idx).codes, ['o']);
eq('見つからない', matchTown('入谷東ビューテラス', idx).level, null);

// まとめて照合
const res = await matchCustomers([
  { i: 1, pref: '神奈川県', address: '相模原市南区相南4-24-18-401' },
  { i: 2, pref: '神奈川県', address: '相模原市南区上鶴間' },
  { i: 3, pref: '神奈川県', address: '相模原市南区存在しない町1-1' },
  { i: 4, pref: '', address: 'どこか' },
], { loadTowns: async (code) => ({ towns: code === '14153' ? towns : [] }) });
eq('結果は行ごと', res.results.map((r) => [r.i, r.level]), [[1, 'chome'], [2, 'town'], [3, null], [4, null]]);
eq('町丁目の中心・世帯数を返す', Object.keys(res.towns).sort(), ['a4', 'k1', 'k2']);
eq('市区町村ごとの人数（丁目不明は均等割）', res.cities, [{ code: '14153', name: '相模原市南区', count: 2 }]);

// スコア・最適エリアへの反映
const { scoreAreas } = await import('../services/scoring.js');
const { buildOptimalArea } = await import('../services/optimizeArea.js');
const sq = (x) => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]].map(([a, b]) => [139.46 + a * 0.004, 35.47 + b * 0.004]);
const strip = [0, 1, 2, 3, 4].map((i) => ({ code: 't' + i, name: '町' + i, households: 1000, distribution: 700, polygon: sq(i), center: { lat: 35.472, lng: 139.462 + i * 0.004 } }));
const sc = scoreAreas(strip, [], { customers: { t4: 12, t0: 1 } });
eq('顧客の重み25%・合計1', [sc.weights.customer, +Object.values(sc.weights).reduce((a, b) => a + b, 0).toFixed(6)], [0.25, 1]);
eq('顧客が多い町が最上位', sc.best.code, 't4');
eq('顧客ランキング', sc.customerRanking.map((a) => [a.code, a.customers, a.customerPer1000]), [['t4', 12, 12], ['t0', 1, 1]]);
eq('顧客なしなら重みに入らない', scoreAreas(strip, [], {}).weights.customer, undefined);
const pin = strip[2].center;
const oR = buildOptimalArea({ towns: strip, pin, targetCopies: 1400, customers: { t3: 10 } });
const oL = buildOptimalArea({ towns: strip, pin, targetCopies: 1400, customers: { t1: 10 } });
eq('最適エリアは顧客の多い側へ広がる', [oR.codes, oL.codes], [['t2', 't3'], ['t2', 't1']]);
eq('エリア内の顧客数', [oR.customersInArea, buildOptimalArea({ towns: strip, pin, targetCopies: 1400 }).customersInArea], [10, null]);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);

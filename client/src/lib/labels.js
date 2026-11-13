// 町丁目名の表記（配布部数表・地図ラベル用）: 「南林間一丁目」→「南林間(1)」
// ※ サーバー側 services/exportArea.js の townLabel と同じ規則
const KANJI = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function kanjiToNumber(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch in KANJI) cur = cur * 10 + KANJI[ch];
    else return null;
  }
  return total + cur;
}
export function townLabel(name) {
  const m = String(name).match(/^(.*?)([0-9０-９]+|[〇一二三四五六七八九十]+)丁目$/);
  if (!m) return name;
  const digits = m[2].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const n = kanjiToNumber(digits);
  return n == null ? name : `${m[1]}(${n})`;
}

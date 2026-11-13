// 配布部数表（エリア表）Excel の生成
// 手本: 【エリア表】_<店舗名>様_<案件名>_<部数>部エリア（シート「2万部エリア」形式）
//   B:市区町村名 C:町丁目名 D:世帯数 E:配布予定数(=ROUNDDOWN(D*カバー率,-1)) F:備考 / 右側(G4〜)に地図画像
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import { DISTRIBUTION_RATE, distributionFor } from './distribution.js';

const FONT = { name: 'ＭＳ Ｐゴシック', size: 11 };
const THIN = { style: 'thin' };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

const KANJI = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function kanjiToNumber(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch in KANJI) cur = cur * 10 + KANJI[ch];
    else return null;
  }
  return total + cur;
}

// 「南林間一丁目」→「南林間(1)」、丁目の無い町名はそのまま
export function townLabel(name) {
  const m = String(name).match(/^(.*?)([0-9０-９]+|[〇一二三四五六七八九十]+)丁目$/);
  if (!m) return name;
  const digits = m[2].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const n = kanjiToNumber(digits);
  return n == null ? name : `${m[1]}(${n})`;
}

// 「相模原市 南区」→「相模原市南区」
export function cityLabel(city) {
  return String(city || '').replace(/\s+/g, '');
}

export function copiesLabel(n) {
  return n >= 10000 && n % 1000 === 0 ? `${n / 10000}万部` : `${n}部`;
}

function sheetNameFor(copies) {
  const name = `${copiesLabel(copies)}エリア`;
  return name.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
}

export function titleFor({ storeName, projectName, copies }) {
  const parts = ['【エリア表】'];
  if (storeName) parts.push(/様$/.test(storeName) ? storeName : `${storeName}様`);
  if (projectName) parts.push(projectName);
  parts.push(`${copies}部エリア`);
  return parts.join('_');
}

/**
 * @param {object} p
 * @param {Array<{city:string, town:string, households:number}>} p.rows
 * @param {number} [p.coverRate]
 * @param {string} [p.storeName]
 * @param {string} [p.projectName]
 * @param {number} [p.targetCopies]  「10,000部追加」などの目標部数（タイトル・シート名に使用）
 * @param {string} [p.mapImage]      data:image/png;base64,...
 * @param {{width:number,height:number}} [p.mapSize]
 */
export async function buildAreaWorkbook(p) {
  const rate = Number(p.coverRate) > 0 && Number(p.coverRate) <= 1 ? Number(p.coverRate) : DISTRIBUTION_RATE;
  const rows = (p.rows || []).filter((r) => r && r.households != null);
  if (!rows.length) throw new Error('出力するエリアがありません');

  const totalCopies = rows.reduce((s, r) => s + distributionFor(r.households, rate), 0);
  const copies = Number(p.targetCopies) > 0 ? Number(p.targetCopies) : totalCopies;
  const title = titleFor({ storeName: p.storeName, projectName: p.projectName, copies });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'posting-sys';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetNameFor(copies), {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: {
      paperSize: 9, orientation: 'portrait',
      margins: { left: 0.7087, right: 0.7087, top: 0.748, bottom: 0.748, header: 0.315, footer: 0.315 },
    },
  });
  ws.properties.defaultRowHeight = 17;
  ws.columns = [
    { key: 'a', width: 2 }, { key: 'b', width: 17.7 }, { key: 'c', width: 18 },
    { key: 'd', width: 14.7 }, { key: 'e', width: 12.5 }, { key: 'f', width: 19.3 }, { key: 'g', width: 9 },
  ];

  const set = (addr, value, style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = FONT;
    c.alignment = { vertical: 'middle', ...(style.alignment || {}) };
    if (style.numFmt) c.numFmt = style.numFmt;
    if (style.border) c.border = BORDER;
    if (style.fill) c.fill = HEADER_FILL;
    return c;
  };

  // 1〜2行目: タイトル・カバー率・合計部数
  const first = 4;
  const last = first + rows.length - 1;
  const totalRow = last + 1;
  ws.mergeCells('B1:D1');
  set('B1', title, { alignment: { horizontal: 'left' } });
  set('E1', 'カバー率：', { alignment: { horizontal: 'right' } });
  set('F1', rate, { alignment: { horizontal: 'center' }, numFmt: '0.00%' });
  set('E2', '合計部数：', { alignment: { horizontal: 'right' } });
  set('F2', { formula: `E${totalRow}&"部"`, result: `${totalCopies}部` }, { alignment: { horizontal: 'center' }, numFmt: '#,##0' });

  // 3行目: 見出し
  ws.getRow(3).height = 24;
  [['B3', '市区町村名'], ['C3', '町丁目名'], ['D3', '世帯数'], ['E3', '配布予定数'], ['F3', '備考']].forEach(([a, v]) =>
    set(a, v, { border: true, fill: true, alignment: { horizontal: a === 'F3' ? 'left' : 'center' } }));

  // 4行目〜: エリア
  rows.forEach((r, i) => {
    const n = first + i;
    ws.getRow(n).height = 17;
    set(`B${n}`, cityLabel(r.city), { border: true });
    set(`C${n}`, townLabel(r.town), { border: true });
    set(`D${n}`, r.households, { border: true, numFmt: '#,##0' });
    set(`E${n}`, { formula: `ROUNDDOWN(D${n}*$F$1,-1)`, result: distributionFor(r.households, rate) },
      { border: true, numFmt: '#,##0_);[Red](#,##0)' });
    set(`F${n}`, r.note || null, { border: true, alignment: { horizontal: 'left' } });
  });

  // 合計行
  const hhTotal = rows.reduce((s, r) => s + r.households, 0);
  set(`D${totalRow}`, { formula: `SUM(D${first}:D${last})`, result: hhTotal }, { numFmt: '#,##0' });
  set(`E${totalRow}`, { formula: `SUM(E${first}:E${last})`, result: totalCopies }, { numFmt: '#,##0' });

  ws.pageSetup.printArea = `A1:F${totalRow + 1}`;

  // 地図画像（G4 起点、手本と同じく幅約1000px）
  const m = String(p.mapImage || '').match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (m) {
    const id = wb.addImage({ base64: m[2], extension: m[1] === 'jpeg' ? 'jpeg' : 'png' });
    const w = 1001;
    const ratio = p.mapSize?.width ? p.mapSize.height / p.mapSize.width : 809 / 1001;
    ws.addImage(id, { tl: { col: 6, row: 3 }, ext: { width: w, height: Math.round(w * ratio) } });
  }

  const buffer = fixDrawingAnchors(Buffer.from(await wb.xlsx.writeBuffer()));
  return { buffer, title, sheetName: ws.name, totalCopies, copies };
}

// exceljs は <xdr:oneCellAnchor> に editAs 属性を付けるが、これは twoCellAnchor 専用で
// スキーマ違反（Excelの修復ダイアログや、他ツールで画像が読み飛ばされる原因）。出力後に取り除く。
export function fixDrawingAnchors(xlsxBuffer) {
  const zip = new AdmZip(xlsxBuffer);
  let changed = false;
  for (const e of zip.getEntries()) {
    if (!/^xl\/drawings\/drawing\d+\.xml$/.test(e.entryName)) continue;
    const xml = e.getData().toString('utf8');
    const fixed = xml.replace(/<xdr:oneCellAnchor\s+editAs="[^"]*"\s*>/g, '<xdr:oneCellAnchor>');
    if (fixed !== xml) { zip.updateFile(e.entryName, Buffer.from(fixed, 'utf8')); changed = true; }
  }
  return changed ? zip.toBuffer() : xlsxBuffer;
}

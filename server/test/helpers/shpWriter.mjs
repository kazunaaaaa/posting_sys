// テスト用: e-Stat 小地域と同形式の .shp(Polygon) / .dbf(Shift_JIS) を生成する最小ライタ
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';

// ---------- 最小限の .shp(Polygon) / .dbf ライタ ----------
export function writeShp(records) {
  const contents = records.map((rings) => {
    const pts = rings.flat();
    const n = pts.length;
    const buf = Buffer.alloc(44 + 4 * rings.length + 16 * n);
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    buf.writeInt32LE(5, 0);
    buf.writeDoubleLE(Math.min(...xs), 4); buf.writeDoubleLE(Math.min(...ys), 12);
    buf.writeDoubleLE(Math.max(...xs), 20); buf.writeDoubleLE(Math.max(...ys), 28);
    buf.writeInt32LE(rings.length, 36); buf.writeInt32LE(n, 40);
    let off = 44, start = 0;
    for (const r of rings) { buf.writeInt32LE(start, off); off += 4; start += r.length; }
    for (const [x, y] of pts) { buf.writeDoubleLE(x, off); buf.writeDoubleLE(y, off + 8); off += 16; }
    return buf;
  });
  const recBufs = contents.map((c, i) => {
    const h = Buffer.alloc(8); h.writeInt32BE(i + 1, 0); h.writeInt32BE(c.length / 2, 4);
    return Buffer.concat([h, c]);
  });
  const body = Buffer.concat(recBufs);
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE((100 + body.length) / 2, 24);
  header.writeInt32LE(1000, 28); header.writeInt32LE(5, 32);
  const all = records.flat(2);
  header.writeDoubleLE(Math.min(...all.map((p) => p[0])), 36); header.writeDoubleLE(Math.min(...all.map((p) => p[1])), 44);
  header.writeDoubleLE(Math.max(...all.map((p) => p[0])), 52); header.writeDoubleLE(Math.max(...all.map((p) => p[1])), 60);
  return Buffer.concat([header, body]);
}

export function writeDbf(fields, rows) {
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const headLen = 32 + 32 * fields.length + 1;
  const head = Buffer.alloc(32);
  head.writeUInt8(0x03, 0); head.writeUInt8(120, 1); head.writeUInt8(1, 2); head.writeUInt8(1, 3);
  head.writeUInt32LE(rows.length, 4); head.writeUInt16LE(headLen, 8); head.writeUInt16LE(recLen, 10);
  const descs = fields.map((f) => {
    const d = Buffer.alloc(32);
    d.write(f.name, 0, 'ascii'); d.write(f.type, 11, 'ascii'); d.writeUInt8(f.len, 16);
    return d;
  });
  const recs = rows.map((row) => {
    const parts = [Buffer.from(' ')];
    for (const f of fields) {
      const v = row[f.name] == null ? '' : String(row[f.name]);
      const enc = iconv.encode(v, 'shift_jis');
      const cell = Buffer.alloc(f.len, 0x20);
      if (f.type === 'N') enc.copy(cell, f.len - enc.length); else enc.copy(cell, 0);
      parts.push(cell);
    }
    return Buffer.concat(parts);
  });
  return Buffer.concat([head, ...descs, Buffer.from([0x0d]), ...recs, Buffer.from([0x1a])]);
}

// 時計回り（シェープファイルの外周）の矩形
export const rect = (x, y, w, h) => [[x, y], [x, y + h], [x + w, y + h], [x + w, y], [x, y]];

export const ESTAT_FIELDS = [
  { name: 'KEY_CODE', type: 'C', len: 11 }, { name: 'PREF_NAME', type: 'C', len: 12 },
  { name: 'CITY_NAME', type: 'C', len: 16 }, { name: 'S_NAME', type: 'C', len: 30 },
  { name: 'HCODE', type: 'N', len: 4 }, { name: 'AREA_MAX_F', type: 'C', len: 1 },
  { name: 'JINKO', type: 'N', len: 7 }, { name: 'SETAI', type: 'N', len: 7 },
];

export function makeEstatZip(geoms, rows, base = 'r2ka00000') {
  const zip = new AdmZip();
  zip.addFile(base + '.shp', writeShp(geoms));
  zip.addFile(base + '.dbf', writeDbf(ESTAT_FIELDS, rows));
  return zip.toBuffer();
}

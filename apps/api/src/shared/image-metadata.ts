/**
 * Rasm metama'lumotini olib tashlash: EXIF (GPS koordinata, qurilma, sana), XMP, izohlar. Rasm qayta kodlanmaydi —
 * piksellar va sifat o'zgarmaydi, faqat konteyner tuzilmasidan metama'lumot bo'laklari chiqariladi (bog'liqliksiz):
 *  - JPEG: APP1 (EXIF/XMP), APP13 (Photoshop IRB) va COM segmentlari; APP0 (JFIF), APP2 (ICC rang profili),
 *    APP14 (Adobe rang o'zgartirish) saqlanadi — ularsiz rang buziladi
 *  - PNG: tEXt, iTXt, zTXt, eXIf, tIME bo'laklari
 *  - WebP: EXIF va "XMP " bo'laklari, VP8X dagi tegishli bayroqlar va RIFF hajmi yangilanadi
 * Tuzilma kutilganidan farq qilsa — asl fayl qaytariladi (yuklash to'xtamaydi; fayl imzosi oldinroq tekshirilgan).
 */

const JPEG_DROP_MARKERS = new Set([0xe1, 0xed, 0xfe]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP_CHUNKS = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
const WEBP_DROP_CHUNKS = new Set(["EXIF", "XMP "]);
/** VP8X bayroqlari: EXIF (0x08) va XMP (0x04). */
const VP8X_METADATA_FLAGS = 0x0c;

export function stripImageMetadata(data: Buffer, contentType: string): Buffer {
  try {
    if (contentType === "image/jpeg") return stripJpeg(data);
    if (contentType === "image/png") return stripPng(data);
    if (contentType === "image/webp") return stripWebp(data);
  } catch {
    return data;
  }
  return data;
}

function stripJpeg(data: Buffer): Buffer {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return data;
  const parts: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;
  while (offset + 2 <= data.length) {
    if (data[offset] !== 0xff) return data;
    const marker = data[offset + 1]!;
    // To'ldiruvchi bayt
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Skan boshlandi (yoki tasvir tugadi) — qolgan qism o'zgarishsiz
    if (marker === 0xda || marker === 0xd9) {
      parts.push(data.subarray(offset));
      return Buffer.concat(parts);
    }
    // Uzunliksiz markerlar (RSTn, TEM)
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) return data;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return data;
    if (!JPEG_DROP_MARKERS.has(marker)) parts.push(data.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return data;
}

function stripPng(data: Buffer): Buffer {
  if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return data;
  const parts: Buffer[] = [data.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) return data;
    if (!PNG_DROP_CHUNKS.has(type)) parts.push(data.subarray(offset, end));
    offset = end;
    if (type === "IEND") return Buffer.concat(parts);
  }
  return data;
}

function stripWebp(data: Buffer): Buffer {
  if (data.length < 12 || data.toString("latin1", 0, 4) !== "RIFF" || data.toString("latin1", 8, 12) !== "WEBP") return data;
  const chunks: Buffer[] = [];
  let removed = false;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const type = data.toString("latin1", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (offset + 8 + size > data.length) return data;
    // Bo'lak juft baytgacha to'ldiriladi
    const end = Math.min(offset + 8 + size + (size % 2), data.length);
    const chunk = data.subarray(offset, end);
    if (WEBP_DROP_CHUNKS.has(type)) {
      removed = true;
    } else if (type === "VP8X" && chunk.length > 8) {
      const copy = Buffer.from(chunk);
      copy[8] = copy[8]! & ~VP8X_METADATA_FLAGS;
      chunks.push(copy);
    } else {
      chunks.push(chunk);
    }
    offset = end;
  }
  if (!removed) return data;
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "../src/shared/image-metadata.js";

const SECRET = "GPS-41.55-60.63-SECRET";

function jpegSegment(marker: number, payload: Buffer) {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function pngChunk(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload, Buffer.alloc(4)]);
}

function webpChunk(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "latin1");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

describe("Rasm metama'lumotini olib tashlash", () => {
  it("JPEG: EXIF (APP1) va izoh chiqariladi; JFIF, ICC, skan ma'lumoti o'zgarmaydi", () => {
    const jfif = jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1"));
    const icc = jpegSegment(0xe2, Buffer.from("ICC_PROFILE\0rang", "latin1"));
    const exif = jpegSegment(0xe1, Buffer.from(`Exif\0\0${SECRET}`, "latin1"));
    const comment = jpegSegment(0xfe, Buffer.from(`izoh ${SECRET}`, "latin1"));
    const scan = Buffer.concat([jpegSegment(0xda, Buffer.from([1, 2, 3])), Buffer.from([9, 8, 7, 0xff, 0xd9])]);
    const original = Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, icc, comment, scan]);

    const stripped = stripImageMetadata(original, "image/jpeg");
    expect(stripped.toString("latin1")).not.toContain(SECRET);
    expect(stripped.equals(Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, icc, scan]))).toBe(true);
  });

  it("PNG: tEXt / eXIf bo'laklari chiqariladi, tasvir bo'laklari o'zgarmaydi", () => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = pngChunk("IHDR", Buffer.alloc(13, 1));
    const text = pngChunk("tEXt", Buffer.from(`Comment\0${SECRET}`, "latin1"));
    const exif = pngChunk("eXIf", Buffer.from(SECRET, "latin1"));
    const idat = pngChunk("IDAT", Buffer.from([5, 6, 7]));
    const iend = pngChunk("IEND", Buffer.alloc(0));
    const stripped = stripImageMetadata(Buffer.concat([signature, ihdr, text, idat, exif, iend]), "image/png");
    expect(stripped.toString("latin1")).not.toContain(SECRET);
    expect(stripped.equals(Buffer.concat([signature, ihdr, idat, iend]))).toBe(true);
  });

  it("WebP: EXIF va XMP bo'laklari chiqariladi, VP8X bayroqlari va RIFF hajmi yangilanadi", () => {
    const vp8x = webpChunk("VP8X", Buffer.from([0x10 | 0x08 | 0x04, 0, 0, 0, 1, 0, 0, 1, 0, 0]));
    const image = webpChunk("VP8L", Buffer.from([1, 2, 3, 4, 5]));
    const exif = webpChunk("EXIF", Buffer.from(SECRET, "latin1"));
    const xmp = webpChunk("XMP ", Buffer.from(`<x>${SECRET}</x>`, "latin1"));
    const body = Buffer.concat([Buffer.from("WEBP", "latin1"), vp8x, image, exif, xmp]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0, "latin1");
    header.writeUInt32LE(body.length, 4);

    const stripped = stripImageMetadata(Buffer.concat([header, body]), "image/webp");
    expect(stripped.toString("latin1")).not.toContain(SECRET);
    expect(stripped.readUInt32LE(4)).toBe(stripped.length - 8);
    expect(stripped[20]! & 0x0c).toBe(0);
    expect(stripped[20]! & 0x10).toBe(0x10);
    expect(stripped.includes(image)).toBe(true);
  });

  it("buzilgan yoki noma'lum tuzilma — asl fayl qaytadi", () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
    expect(stripImageMetadata(broken, "image/jpeg")).toBe(broken);
    const text = Buffer.from("oddiy matn");
    expect(stripImageMetadata(text, "image/png")).toBe(text);
    expect(stripImageMetadata(text, "application/pdf")).toBe(text);
  });
});

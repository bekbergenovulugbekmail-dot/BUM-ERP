import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256, sha256Hex } from "@bum/shared";

const nodeHex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("Umumiy SHA-256 (brauzerda bo'laklab xeshlash)", () => {
  it("node:crypto bilan bir xil: bo'sh, blok chegaralari, turli bo'laklarga bo'lish", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const size of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 65_537]) {
      const data = randomBytes(size);
      expect(sha256Hex(data), `size ${size}`).toBe(nodeHex(data));
    }
    const data = randomBytes(3 * 1024 * 1024 + 77);
    const hash = new Sha256();
    for (let offset = 0, step = 1; offset < data.length; offset += step, step = (step * 7 + 13) % 400_000 || 1) {
      hash.update(data.subarray(offset, Math.min(data.length, offset + step)));
    }
    expect(hash.hex()).toBe(nodeHex(data));
  });
});

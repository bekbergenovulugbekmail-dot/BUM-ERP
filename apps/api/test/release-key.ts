import { generateKeyPairSync, sign } from "node:crypto";
import { releaseMessage, releaseSigning } from "../src/modules/platform/release-signing.js";

/** Faqat testlar uchun vaqtinchalik Ed25519 kalit — rasmiy maxfiy kalit repoda yo'q. */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

export const testReleasePublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");

export function useTestReleaseKey() {
  releaseSigning.publicKeys = [testReleasePublicKey];
}

export const signRelease = (version: string, sha256: string) => sign(null, Buffer.from(releaseMessage(version, sha256)), privateKey).toString("base64");

/** Boshqa (begona) kalit bilan qo'yilgan imzo — rad etilishi kerak. */
const foreign = generateKeyPairSync("ed25519").privateKey;
export const foreignSignature = (version: string, sha256: string) => sign(null, Buffer.from(releaseMessage(version, sha256)), foreign).toString("base64");

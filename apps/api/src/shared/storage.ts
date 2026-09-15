/**
 * S3-mos fayl saqlash (lokal MinIO, production'da istalgan S3).
 *
 * SDK o'rniga AWS Signature V4 imzolangan URL'lar (`node:crypto`): brauzer faylni to'g'ridan-to'g'ri
 * saqlashga yuklaydi (API orqali o'tmaydi), API faqat kalitni tekshirib yozuvga biriktiradi.
 * Imzo algoritmi AWS hujjatidagi rasmiy namuna bilan testda tekshiriladi.
 */
import { createHash, createHmac } from "node:crypto";
import { env, features } from "../env.js";

type Method = "GET" | "PUT" | "HEAD" | "DELETE";

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986: AWS faqat `A-Za-z0-9-_.~` ni kodlamaydi; yo'lda `/` saqlanadi. */
function encode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

export type PresignInput = {
  method: Method;
  /** Port bilan: "localhost:9000". */
  host: string;
  /** Kodlanmagan yo'l, "/" bilan boshlanadi. */
  path: string;
  accessKey: string;
  secretKey: string;
  region: string;
  expiresSeconds: number;
  /** Imzoga kiradigan qo'shimcha sarlavhalar (masalan content-type) — mijoz aynan shularni yuborishi shart. */
  headers?: Record<string, string>;
  now?: Date;
};

/** Imzolangan so'rov yo'li va query qatori: `/bucket/key?X-Amz-...&X-Amz-Signature=...`. */
export function presign(input: PresignInput): string {
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;

  const headers: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value.trim();
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(";");

  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.accessKey}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(input.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]
    .map(([k, v]) => `${encode(k!)}=${encode(v!)}`)
    .sort()
    .join("&");

  const canonicalPath = encode(input.path, true);
  const canonicalRequest = [
    input.method,
    canonicalPath,
    query,
    headerNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, dateStamp), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return `${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

export type StoredObject = { size: number; contentType: string | null };

export type StorageClient = {
  /** Brauzer uchun imzolangan URL; PUT da `contentType` imzoga kiradi. */
  signedUrl(method: "GET" | "PUT", key: string, expiresSeconds: number, contentType?: string): string;
  head(key: string): Promise<StoredObject | null>;
  /** Faylning birinchi `bytes` bayti (fayl imzosini tekshirish uchun); fayl yo'q — null. */
  readHead?(key: string, bytes: number): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
};

export type S3Config = {
  endpoint: string;
  /** Brauzer ko'radigan manzil (masalan CDN yoki tashqi domen); bo'lmasa `endpoint`. */
  publicEndpoint?: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
};

export function s3Client(config: S3Config): StorageClient {
  const urlFor = (base: string, method: Method, key: string, expiresSeconds: number, headers?: Record<string, string>) => {
    const origin = new URL(base);
    const signed = presign({
      method,
      host: origin.host,
      path: `${origin.pathname.replace(/\/$/, "")}/${config.bucket}/${key}`,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region,
      expiresSeconds,
      headers,
    });
    return `${origin.protocol}//${origin.host}${signed}`;
  };

  return {
    signedUrl(method, key, expiresSeconds, contentType) {
      return urlFor(config.publicEndpoint ?? config.endpoint, method, key, expiresSeconds, contentType ? { "content-type": contentType } : undefined);
    },
    async head(key) {
      const response = await fetch(urlFor(config.endpoint, "HEAD", key, 60), { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Saqlash xizmati javobi: ${response.status}`);
      return {
        size: Number(response.headers.get("content-length") ?? 0),
        contentType: response.headers.get("content-type"),
      };
    },
    async readHead(key, bytes) {
      const response = await fetch(urlFor(config.endpoint, "GET", key, 60), {
        headers: { range: `bytes=0-${bytes - 1}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Saqlash xizmati javobi: ${response.status}`);
      return Buffer.from(await response.arrayBuffer()).subarray(0, bytes);
    },
    async remove(key) {
      const response = await fetch(urlFor(config.endpoint, "DELETE", key, 60), { method: "DELETE", signal: AbortSignal.timeout(10_000) });
      if (!response.ok && response.status !== 404) throw new Error(`Saqlash xizmati javobi: ${response.status}`);
    },
  };
}

/** Sozlanmagan bo'lsa `null` — fayl endpointlari 503. Testlar mijozni almashtiradi. */
export const storageProvider: { client: StorageClient | null } = {
  client:
    features.storage && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY
      ? s3Client({
          endpoint: env.STORAGE_ENDPOINT!,
          publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT,
          bucket: env.STORAGE_BUCKET!,
          accessKey: env.STORAGE_ACCESS_KEY,
          secretKey: env.STORAGE_SECRET_KEY,
          region: env.STORAGE_REGION,
        })
      : null,
};

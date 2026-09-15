/**
 * Desktop kassa (BUM POS KASSA) relizlari: platforma admini o'rnatuvchini yuklaydi, izoh va majburiy versiyani
 * belgilaydi, e'lon qiladi. E'lon qilingan reliz bitta — yangisi e'lon qilinsa oldingisi arxivga o'tadi. Fayl bazada
 * bo'laklarda (bytea) — alohida fayl ombori shart emas; xotirada bir vaqtda bitta bo'lak turadi.
 *
 * Holatlar: uploading (qisman) → draft (to'liq, SHA-256 tekshirilgan) → published → archived; failed — yakunlashda
 * server hisoblagan SHA-256 mijoz aytganiga mos kelmadi (bo'laklar o'chiriladi, e'lon qilib bo'lmaydi).
 *
 * Yuklash ikki xil:
 *  - bo'laklab (`startUpload` → `putChunk` … → `completeUpload`): aloqa uzilsa yoki brauzer yangilansa, shu fayl qayta
 *    tanlanib faqat yetishmayotgan bo'laklar yuboriladi (0% dan emas). Bo'lak qayta kelsa — ustiga yoziladi, ikki marta
 *    sanalmaydi. Katta fayl bitta HTTP so'rovga bog'lanmaydi (Railway proksi vaqt chegarasi).
 *  - bitta oqim bilan (`uploadRelease`) — eski usul, 400 MB gacha.
 * Yuklab olish HTTP Range bilan davom ettiriladi (`parseByteRange`, `releaseByteRange`).
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { AppError, badRequest, conflict, notFound } from "@bum/shared";
import { users } from "../../db/schema/platform.js";
import { desktopReleaseChunks, desktopReleases } from "../../db/schema/pos.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";

/** Bitta oqim bilan yuklashdagi bo'lak hajmi. */
export const RELEASE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MIN_UPLOAD_CHUNK_BYTES = 1024 * 1024;
export const MAX_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
/** Bitta oqim bilan yuklash chegarasi (nginx ham shu). */
export const MAX_STREAM_RELEASE_BYTES = 400 * 1024 * 1024;
/** Bo'laklab yuklash chegarasi (har so'rov — bitta bo'lak). */
export const MAX_RELEASE_BYTES = 1024 * 1024 * 1024;
export const RELEASE_VERSION = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;

type Actor = { id: string; name: string | null };

const releaseFields = {
  id: desktopReleases.id,
  version: desktopReleases.version,
  fileName: desktopReleases.fileName,
  size: desktopReleases.size,
  sha256: desktopReleases.sha256,
  notes: desktopReleases.notes,
  minVersion: desktopReleases.minVersion,
  status: desktopReleases.status,
  chunkSize: desktopReleases.chunkSize,
  expectedSize: desktopReleases.expectedSize,
  expectedSha256: desktopReleases.expectedSha256,
  uploadedBy: desktopReleases.uploadedBy,
  error: desktopReleases.error,
  publishedAt: desktopReleases.publishedAt,
  createdAt: desktopReleases.createdAt,
};

async function audit(tx: Tx, actor: Actor, meta: RequestMeta, action: string, id: string, details: Record<string, unknown>) {
  await writeAuditLog({ userId: actor.id, userName: actor.name, companyId: null, action, resource: "desktop_releases", resourceId: id, details, ...meta }, tx);
}

const receivedBytesSql = sql<number>`(select coalesce(sum(octet_length(c.data)), 0) from desktop_release_chunks c where c.release_id = ${desktopReleases.id})`.mapWith(Number);

export function listReleases(conn: DbOrTx) {
  return conn
    .select({ ...releaseFields, uploadedByName: users.name, receivedBytes: receivedBytesSql })
    .from(desktopReleases)
    .leftJoin(users, eq(users.id, desktopReleases.uploadedBy))
    .orderBy(desc(desktopReleases.createdAt));
}

async function lockRelease(tx: Tx, id: string) {
  const [release] = await tx.select(releaseFields).from(desktopReleases).where(eq(desktopReleases.id, id)).limit(1).for("update");
  if (!release) throw notFound("Reliz topilmadi");
  return release;
}

const isIncomplete = (status: string) => status === "uploading" || status === "failed";

/** Bitta oqim bilan yuklash — bitta tranzaksiyada (xato bo'lsa bo'laklar ham qolmaydi). */
export async function uploadRelease(
  tx: Tx,
  input: {
    version: string;
    fileName: string;
    stream: AsyncIterable<Buffer | Uint8Array | string>;
    /** Mijoz yuborgan fayl xeshi (`x-sha256`): mos kelmasa hech narsa saqlanmaydi (tranzaksiya bekor). */
    expectedSha256: string;
  },
  actor: Actor,
  meta: RequestMeta,
) {
  if (!RELEASE_VERSION.test(input.version)) throw badRequest("Versiya formati: 1.2.3");
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)) throw badRequest("Fayl SHA-256 xeshi noto'g'ri");
  const [taken] = await tx.select({ id: desktopReleases.id }).from(desktopReleases).where(eq(desktopReleases.version, input.version)).limit(1);
  if (taken) throw conflict(`${input.version} versiyasi allaqachon yuklangan`);

  const [row] = await tx
    .insert(desktopReleases)
    .values({ version: input.version, fileName: input.fileName, sha256: "", chunkSize: RELEASE_CHUNK_BYTES, uploadedBy: actor.id })
    .returning({ id: desktopReleases.id });
  const releaseId = row!.id;

  const hash = createHash("sha256");
  let size = 0;
  let seq = 0;
  // Bo'lak to'lguncha qismlar ro'yxatda (har kelgan qismda qayta nusxalanmasin)
  let parts: Buffer[] = [];
  let pendingBytes = 0;
  const flush = async (bytes: number) => {
    const joined = Buffer.concat(parts, pendingBytes);
    await tx.insert(desktopReleaseChunks).values({ releaseId, seq: seq++, data: joined.subarray(0, bytes) });
    const rest = joined.subarray(bytes);
    parts = rest.length > 0 ? [rest] : [];
    pendingBytes = rest.length;
  };
  for await (const part of input.stream) {
    const chunk = Buffer.from(part);
    if (chunk.length === 0) continue;
    // Windows o'rnatuvchisi (PE) "MZ" bilan boshlanadi — boshqa fayl bazaga yozilmasin
    if (size < 2) {
      const head = Buffer.concat([...parts, chunk]).subarray(0, 2).toString("latin1");
      if (head !== "MZ".slice(0, head.length)) throw badRequest("Bu Windows o'rnatuvchi (.exe) fayli emas");
    }
    size += chunk.length;
    if (size > MAX_STREAM_RELEASE_BYTES) throw badRequest(`Fayl ${MAX_STREAM_RELEASE_BYTES / 1024 / 1024} MB dan katta — bo'laklab yuklang`);
    hash.update(chunk);
    parts.push(chunk);
    pendingBytes += chunk.length;
    while (pendingBytes >= RELEASE_CHUNK_BYTES) await flush(RELEASE_CHUNK_BYTES);
  }
  if (size < 2) throw badRequest("Fayl bo'sh yoki o'rnatuvchi emas");
  if (pendingBytes > 0) await flush(pendingBytes);

  const sha256 = hash.digest("hex");
  if (sha256 !== input.expectedSha256) {
    throw badRequest("Fayl SHA-256 xeshi e'lon qilinganiga mos emas — fayl yo'lda buzilgan yoki almashtirilgan", { reason: "checksum_mismatch", sha256 });
  }
  const [release] = await tx.update(desktopReleases).set({ size, sha256, updatedAt: new Date() }).where(eq(desktopReleases.id, releaseId)).returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOADED", releaseId, { version: input.version, size, sha256, chunks: seq });
  return release!;
}

// ─── Bo'laklab (davom ettiriladigan) yuklash ────────────────────────────────

/** Sessiya holati: qaysi bo'laklar serverda bor — mijoz faqat yetishmayotganlarini yuboradi. */
export async function uploadState(conn: DbOrTx, id: string) {
  const [release] = await conn.select(releaseFields).from(desktopReleases).where(eq(desktopReleases.id, id)).limit(1);
  if (!release) throw notFound("Yuklash sessiyasi topilmadi");
  const chunks = await conn
    .select({ seq: desktopReleaseChunks.seq, bytes: sql<number>`octet_length(${desktopReleaseChunks.data})`.mapWith(Number) })
    .from(desktopReleaseChunks)
    .where(eq(desktopReleaseChunks.releaseId, id))
    .orderBy(asc(desktopReleaseChunks.seq));
  return {
    ...release,
    totalChunks: release.expectedSize ? Math.ceil(release.expectedSize / release.chunkSize) : chunks.length,
    receivedChunks: chunks.map((chunk) => chunk.seq),
    receivedBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
  };
}

/**
 * Yuklashni boshlash yoki davom ettirish: shu versiya shu fayl (hajm, SHA-256, bo'lak hajmi) bilan yuklanayotgan bo'lsa —
 * o'sha sessiya qaytadi. `failed` versiya qayta yuklanadi; boshqa fayl bilan yuklanayotgani yoki tayyor reliz — 409.
 */
export async function startUpload(
  tx: Tx,
  input: { version: string; fileName: string; size: number; sha256: string; chunkSize: number },
  actor: Actor,
  meta: RequestMeta,
) {
  if (!RELEASE_VERSION.test(input.version)) throw badRequest("Versiya formati: 1.2.3");
  const session = { fileName: input.fileName, chunkSize: input.chunkSize, expectedSize: input.size, expectedSha256: input.sha256 };
  const [existing] = await tx.select(releaseFields).from(desktopReleases).where(eq(desktopReleases.version, input.version)).limit(1).for("update");
  if (existing) {
    const sameFile = existing.expectedSha256 === input.sha256 && existing.expectedSize === input.size && existing.chunkSize === input.chunkSize;
    if (existing.status === "uploading" && sameFile) return uploadState(tx, existing.id);
    if (existing.status === "uploading") throw conflict(`${input.version} boshqa fayl bilan yuklanmoqda — avval o'sha yuklashni bekor qiling`);
    if (existing.status !== "failed") throw conflict(`${input.version} versiyasi allaqachon yuklangan`);
    await tx.delete(desktopReleaseChunks).where(eq(desktopReleaseChunks.releaseId, existing.id));
    await tx
      .update(desktopReleases)
      .set({ ...session, size: 0, sha256: "", status: "uploading", error: null, uploadedBy: actor.id, updatedAt: new Date() })
      .where(eq(desktopReleases.id, existing.id));
    await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOAD_STARTED", existing.id, { version: input.version, size: input.size, sha256: input.sha256, restarted: true });
    return uploadState(tx, existing.id);
  }
  const [row] = await tx
    .insert(desktopReleases)
    .values({ version: input.version, sha256: "", status: "uploading", uploadedBy: actor.id, ...session })
    .returning({ id: desktopReleases.id });
  await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOAD_STARTED", row!.id, { version: input.version, size: input.size, sha256: input.sha256, chunkSize: input.chunkSize });
  return uploadState(tx, row!.id);
}

/** So'rov tanasini bo'lak chegarasi bilan o'qish. */
export async function readChunkBody(stream: Readable, limit = MAX_UPLOAD_CHUNK_BYTES) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of stream) {
    const buffer = Buffer.from(part as Buffer);
    size += buffer.length;
    if (size > limit) throw badRequest(`Bo'lak ${limit / 1024 / 1024} MB dan katta`);
    parts.push(buffer);
  }
  return Buffer.concat(parts, size);
}

/**
 * Bitta bo'lak: hajmi aniq (oxirgisi — qoldiq), ixtiyoriy `x-chunk-sha256` bilan yo'lda buzilmagani tekshiriladi.
 * Takroriy yuborish ustiga yozadi — bayt ikki marta sanalmaydi. Sessiya qatori `FOR SHARE` bilan: yakunlash (FOR UPDATE)
 * bilan bir vaqtda bo'lak yozilmaydi, bo'laklar esa parallel kelishi mumkin.
 */
export async function putChunk(tx: Tx, id: string, index: number, data: Buffer, chunkSha256: string | undefined, actor: Actor) {
  const [release] = await tx.select(releaseFields).from(desktopReleases).where(eq(desktopReleases.id, id)).limit(1).for("share");
  if (!release) throw notFound("Yuklash sessiyasi topilmadi");
  assertUploadOwner(release, actor);
  if (release.status !== "uploading" || !release.expectedSize) throw conflict("Bu reliz yuklanish holatida emas");
  const totalChunks = Math.ceil(release.expectedSize / release.chunkSize);
  if (index >= totalChunks) throw badRequest(`Bo'lak raqami noto'g'ri: ${index} (jami ${totalChunks})`);
  const expectedLength = index === totalChunks - 1 ? release.expectedSize - index * release.chunkSize : release.chunkSize;
  if (data.length !== expectedLength) {
    throw badRequest(`Bo'lak hajmi noto'g'ri: ${data.length} bayt (kutilgan ${expectedLength})`, { reason: "chunk_size" });
  }
  if (chunkSha256 && createHash("sha256").update(data).digest("hex") !== chunkSha256) {
    throw badRequest("Bo'lak yo'lda buzilgan (SHA-256 mos emas) — qayta yuboring", { reason: "chunk_checksum" });
  }
  if (index === 0 && data.subarray(0, 2).toString("latin1") !== "MZ") throw badRequest("Bu Windows o'rnatuvchi (.exe) fayli emas");
  await tx
    .insert(desktopReleaseChunks)
    .values({ releaseId: id, seq: index, data })
    .onConflictDoUpdate({ target: [desktopReleaseChunks.releaseId, desktopReleaseChunks.seq], set: { data } });
  const [received] = await tx
    .select({
      bytes: sql<number>`coalesce(sum(octet_length(${desktopReleaseChunks.data})), 0)`.mapWith(Number),
      chunks: sql<number>`count(*)`.mapWith(Number),
    })
    .from(desktopReleaseChunks)
    .where(eq(desktopReleaseChunks.releaseId, id));
  return { index, receivedBytes: received!.bytes, receivedChunks: received!.chunks, totalChunks };
}

/**
 * Yakunlash: barcha bo'laklar va hajm tekshiriladi, SHA-256 serverda bo'laklar bo'yicha hisoblanadi. Mos kelmasa —
 * `failed` (bo'laklar o'chiriladi, e'lon qilib bo'lmaydi) va `verified: false` — holat tranzaksiyada saqlanadi.
 * Tayyor relizni qayta yakunlash — o'zgarishsiz qaytadi.
 */
/** Bo'laklab yuklash sessiyasini faqat uni boshlagan platforma admini davom ettiradi, yakunlaydi yoki bekor qiladi. */
function assertUploadOwner(release: { uploadedBy: string | null; status: string }, actor: Actor) {
  if (release.uploadedBy && release.uploadedBy !== actor.id && isIncomplete(release.status)) {
    throw new AppError("FORBIDDEN", "Bu yuklash sessiyasini boshqa administrator boshlagan");
  }
}

export async function completeUpload(tx: Tx, id: string, actor: Actor, meta: RequestMeta) {
  const release = await lockRelease(tx, id);
  assertUploadOwner(release, actor);
  if (release.status !== "uploading") {
    if (!isIncomplete(release.status) && release.expectedSha256 && release.sha256 === release.expectedSha256) return { verified: true as const, release };
    throw conflict("Bu reliz yuklanish holatida emas");
  }
  const state = await uploadState(tx, id);
  const have = new Set(state.receivedChunks);
  const missing: number[] = [];
  for (let index = 0; index < state.totalChunks; index++) if (!have.has(index)) missing.push(index);
  if (missing.length > 0 || state.receivedBytes !== release.expectedSize) {
    throw new AppError("CONFLICT", `Fayl to'liq yuklanmagan: ${missing.length} ta bo'lak yetishmaydi`, {
      missing: missing.slice(0, 100),
      receivedBytes: state.receivedBytes,
    });
  }
  const hash = createHash("sha256");
  for await (const data of releaseChunks(tx, id)) hash.update(data);
  const sha256 = hash.digest("hex");
  if (sha256 !== release.expectedSha256) {
    const message = "Yuklangan fayl SHA-256 si kutilganiga mos emas — reliz yaroqsiz, faylni qayta yuklang";
    await tx.delete(desktopReleaseChunks).where(eq(desktopReleaseChunks.releaseId, id));
    const [failed] = await tx.update(desktopReleases).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(desktopReleases.id, id)).returning(releaseFields);
    await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOAD_FAILED", id, { version: release.version, expected: release.expectedSha256, actual: sha256 });
    return { verified: false as const, release: failed!, message };
  }
  const [ready] = await tx
    .update(desktopReleases)
    .set({ size: release.expectedSize!, sha256, status: "draft", error: null, updatedAt: new Date() })
    .where(eq(desktopReleases.id, id))
    .returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOADED", id, { version: release.version, size: release.expectedSize, sha256, chunks: state.totalChunks, resumable: true });
  return { verified: true as const, release: ready! };
}

/** Tugallanmagan yoki SHA-256 dan o'tmagan yuklashni bekor qilish (bo'laklar va sessiya o'chiriladi). */
export async function abortUpload(tx: Tx, id: string, actor: Actor, meta: RequestMeta) {
  const release = await lockRelease(tx, id);
  assertUploadOwner(release, actor);
  if (!isIncomplete(release.status)) throw conflict("Tayyor yoki e'lon qilingan relizni bekor qilib bo'lmaydi — arxivlang");
  const state = await uploadState(tx, id);
  await tx.delete(desktopReleaseChunks).where(eq(desktopReleaseChunks.releaseId, id));
  await tx.delete(desktopReleases).where(eq(desktopReleases.id, id));
  await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOAD_ABORTED", id, { version: release.version, status: release.status, receivedBytes: state.receivedBytes });
  return { id, version: release.version };
}

// ─── Boshqarish ─────────────────────────────────────────────────────────────

export async function updateRelease(tx: Tx, id: string, patch: { notes?: string | null; minVersion?: string | null }, actor: Actor, meta: RequestMeta) {
  const release = await lockRelease(tx, id);
  if (patch.minVersion && !RELEASE_VERSION.test(patch.minVersion)) throw badRequest("Majburiy versiya formati: 1.2.3");
  const [updated] = await tx
    .update(desktopReleases)
    .set({ ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.minVersion !== undefined ? { minVersion: patch.minVersion } : {}), updatedAt: new Date() })
    .where(eq(desktopReleases.id, release.id))
    .returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_UPDATED", id, { version: release.version, changes: Object.keys(patch) });
  return updated!;
}

/** E'lon qilish: qurilmalar shu relizni oladi; oldin e'lon qilingani arxivga. Faqat to'liq va tekshirilgan fayl. */
export async function publishRelease(tx: Tx, id: string, actor: Actor, meta: RequestMeta) {
  const release = await lockRelease(tx, id);
  if (isIncomplete(release.status) || release.size === 0 || !release.sha256) throw badRequest("Reliz fayli to'liq yuklanmagan yoki tekshiruvdan o'tmagan");
  await tx
    .update(desktopReleases)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(desktopReleases.status, "published"), ne(desktopReleases.id, id)));
  const [published] = await tx
    .update(desktopReleases)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(desktopReleases.id, id))
    .returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_PUBLISHED", id, { version: release.version, sha256: release.sha256 });
  return published!;
}

export async function archiveRelease(tx: Tx, id: string, actor: Actor, meta: RequestMeta) {
  const release = await lockRelease(tx, id);
  if (isIncomplete(release.status)) throw conflict("Yuklanayotgan relizni arxivlab bo'lmaydi — bekor qiling");
  const [archived] = await tx.update(desktopReleases).set({ status: "archived", updatedAt: new Date() }).where(eq(desktopReleases.id, release.id)).returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_ARCHIVED", id, { version: release.version, from: release.status });
  return archived!;
}

// ─── Qurilmaga berish ───────────────────────────────────────────────────────

/** Qurilmalarga taklif qilinadigan reliz (eng oxirgi e'lon qilingan). */
export async function currentRelease(conn: DbOrTx) {
  const [release] = await conn
    .select(releaseFields)
    .from(desktopReleases)
    .where(eq(desktopReleases.status, "published"))
    .orderBy(desc(desktopReleases.publishedAt))
    .limit(1);
  return release ?? null;
}

export async function downloadableRelease(conn: DbOrTx, id: string) {
  const [release] = await conn
    .select(releaseFields)
    .from(desktopReleases)
    .where(and(eq(desktopReleases.id, id), inArray(desktopReleases.status, ["published"])))
    .limit(1);
  if (!release) throw notFound("Reliz topilmadi yoki e'lon qilinmagan");
  return release;
}

/** Bo'laklar birma-bir (xotirada bittadan ortiq bo'lak turmaydi). */
export async function* releaseChunks(conn: DbOrTx, releaseId: string) {
  for (let seq = 0; ; seq++) {
    const [chunk] = await conn
      .select({ data: desktopReleaseChunks.data })
      .from(desktopReleaseChunks)
      .where(and(eq(desktopReleaseChunks.releaseId, releaseId), eq(desktopReleaseChunks.seq, seq)))
      .limit(1);
    if (!chunk) return;
    yield chunk.data;
  }
}

/**
 * `Range: bytes=…` (RFC 9110): bitta oraliq — `{start, end}` (end kiritiladi); boshlanishi fayldan tashqarida —
 * `unsatisfiable` (416); bir nechta oraliq yoki noto'g'ri sintaksis — `null` (butun fayl yuboriladi).
 */
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] !== "" && Number(match[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1) };
}

/** Faylning [start, end] oralig'i bo'laklardan (bo'lak hajmi reliz uchun bir xil, oxirgisi qisqa bo'lishi mumkin). */
export async function* releaseByteRange(conn: DbOrTx, releaseId: string, chunkSize: number, start: number, end: number) {
  let seq = Math.floor(start / chunkSize);
  let position = seq * chunkSize;
  while (position <= end) {
    const [chunk] = await conn
      .select({ data: desktopReleaseChunks.data })
      .from(desktopReleaseChunks)
      .where(and(eq(desktopReleaseChunks.releaseId, releaseId), eq(desktopReleaseChunks.seq, seq)))
      .limit(1);
    if (!chunk) return;
    yield chunk.data.subarray(Math.max(0, start - position), Math.min(chunk.data.length, end - position + 1));
    position += chunk.data.length;
    seq += 1;
  }
}

/**
 * Desktop kassa (BUM POS KASSA) relizlari: platforma admini o'rnatuvchini yuklaydi (oqim bilan, 4 MB bo'laklarda
 * bazaga, SHA-256 hisoblanadi), izoh va majburiy versiyani belgilaydi, e'lon qiladi. E'lon qilingan reliz bitta —
 * yangisi e'lon qilinsa oldingisi arxivga o'tadi. Qurilmalar qurilma tokeni bilan bo'laklab yuklab oladi.
 * Relizlar o'chirilmaydi (arxiv) — qaytarish mumkin bo'lsin.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@bum/shared";
import { users } from "../../db/schema/platform.js";
import { desktopReleaseChunks, desktopReleases } from "../../db/schema/pos.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import { writeAuditLog, type RequestMeta } from "../../shared/audit.js";

export const RELEASE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_RELEASE_BYTES = 400 * 1024 * 1024;
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
  publishedAt: desktopReleases.publishedAt,
  createdAt: desktopReleases.createdAt,
};

async function audit(tx: Tx, actor: Actor, meta: RequestMeta, action: string, id: string, details: Record<string, unknown>) {
  await writeAuditLog({ userId: actor.id, userName: actor.name, companyId: null, action, resource: "desktop_releases", resourceId: id, details, ...meta }, tx);
}

export function listReleases(conn: DbOrTx) {
  return conn
    .select({ ...releaseFields, uploadedByName: users.name })
    .from(desktopReleases)
    .leftJoin(users, eq(users.id, desktopReleases.uploadedBy))
    .orderBy(desc(desktopReleases.createdAt));
}

async function lockRelease(tx: Tx, id: string) {
  const [release] = await tx.select(releaseFields).from(desktopReleases).where(eq(desktopReleases.id, id)).limit(1).for("update");
  if (!release) throw notFound("Reliz topilmadi");
  return release;
}

/** O'rnatuvchini oqim bilan qabul qilish — bitta tranzaksiyada (xato bo'lsa bo'laklar ham qolmaydi). */
export async function uploadRelease(
  tx: Tx,
  input: { version: string; fileName: string; stream: AsyncIterable<Buffer | Uint8Array | string> },
  actor: Actor,
  meta: RequestMeta,
) {
  if (!RELEASE_VERSION.test(input.version)) throw badRequest("Versiya formati: 1.2.3");
  const [taken] = await tx.select({ id: desktopReleases.id }).from(desktopReleases).where(eq(desktopReleases.version, input.version)).limit(1);
  if (taken) throw conflict(`${input.version} versiyasi allaqachon yuklangan`);

  const [row] = await tx
    .insert(desktopReleases)
    .values({ version: input.version, fileName: input.fileName, sha256: "", uploadedBy: actor.id })
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
    if (size > MAX_RELEASE_BYTES) throw badRequest(`Fayl ${MAX_RELEASE_BYTES / 1024 / 1024} MB dan katta`);
    hash.update(chunk);
    parts.push(chunk);
    pendingBytes += chunk.length;
    while (pendingBytes >= RELEASE_CHUNK_BYTES) await flush(RELEASE_CHUNK_BYTES);
  }
  if (size < 2) throw badRequest("Fayl bo'sh yoki o'rnatuvchi emas");
  if (pendingBytes > 0) await flush(pendingBytes);

  const sha256 = hash.digest("hex");
  const [release] = await tx.update(desktopReleases).set({ size, sha256, updatedAt: new Date() }).where(eq(desktopReleases.id, releaseId)).returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_UPLOADED", releaseId, { version: input.version, size, sha256, chunks: seq });
  return release!;
}

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

/** E'lon qilish: qurilmalar shu relizni oladi; oldin e'lon qilingani arxivga. */
export async function publishRelease(tx: Tx, id: string, actor: Actor, meta: RequestMeta) {
  const release = await lockRelease(tx, id);
  if (release.size === 0 || !release.sha256) throw badRequest("Reliz fayli to'liq yuklanmagan");
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
  const [archived] = await tx.update(desktopReleases).set({ status: "archived", updatedAt: new Date() }).where(eq(desktopReleases.id, release.id)).returning(releaseFields);
  await audit(tx, actor, meta, "DESKTOP_RELEASE_ARCHIVED", id, { version: release.version, from: release.status });
  return archived!;
}

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
      .orderBy(asc(desktopReleaseChunks.seq))
      .limit(1);
    if (!chunk) return;
    yield chunk.data;
  }
}

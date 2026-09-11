import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { passwordResetCodes, rateLimits, sessions } from "../src/db/schema/platform.js";
import { purgeExpired } from "../src/shared/maintenance.js";
import { createUser, resetDatabase } from "./helpers.js";

const HOUR = 60 * 60 * 1000;
const now = new Date();
const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * HOUR);
const token = () => randomBytes(32).toString("hex");

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("davriy tozalash", () => {
  it("faqat 1 kundan oldin eskirgan yozuvlarni o'chiradi", async () => {
    const { user } = await createUser();

    await db.insert(sessions).values([
      { userId: user.id, tokenHash: token(), expiresAt: at(24 * 7), idleExpiresAt: at(1) }, // faol
      { userId: user.id, tokenHash: token(), expiresAt: at(-30), idleExpiresAt: at(-30) }, // mutlaq muddati o'tgan
      { userId: user.id, tokenHash: token(), expiresAt: at(24 * 7), idleExpiresAt: at(-26) }, // faolsizlikdan eskirgan
      { userId: user.id, tokenHash: token(), expiresAt: at(24 * 7), idleExpiresAt: at(-2) }, // yaqinda eskirgan — qoladi
      { userId: user.id, tokenHash: token(), expiresAt: at(24 * 7), idleExpiresAt: at(1), revokedAt: at(-48) }, // bekor qilingan
      { userId: user.id, tokenHash: token(), expiresAt: at(24 * 7), idleExpiresAt: at(1), revokedAt: at(-1) }, // yaqinda bekor — qoladi
    ]);
    await db.insert(passwordResetCodes).values([
      { userId: user.id, codeHash: token(), expiresAt: at(-25) },
      { userId: user.id, codeHash: token(), expiresAt: at(-1), consumedAt: at(-1) },
      { userId: user.id, codeHash: token(), expiresAt: at(0.1) },
    ]);
    await db.insert(rateLimits).values([
      { bucket: "login:+998900000001", windowStart: at(-30), count: 5 },
      { bucket: "login:+998900000001", windowStart: at(-0.25), count: 2 },
    ]);

    expect(await purgeExpired(now)).toEqual({ sessions: 3, passwordResetCodes: 1, rateLimits: 1 });
    expect(await db.$count(sessions)).toBe(3);
    expect(await db.$count(passwordResetCodes)).toBe(2);
    expect(await db.$count(rateLimits)).toBe(1);

    // Takror ishga tushirish — o'chiradigan narsa yo'q
    expect(await purgeExpired(now)).toEqual({ sessions: 0, passwordResetCodes: 0, rateLimits: 0 });
  });

  it("boshqa nusxa lockni ushlab turganda o'tkazib yuboradi", async () => {
    const holder = await db.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtext('maintenance:purge-expired'))");
      expect(await purgeExpired(now)).toBeNull();
      await holder.query("rollback");
    } finally {
      holder.release();
    }
    expect(await purgeExpired(now)).not.toBeNull();
    await db.execute(sql`select 1`);
  });
});

/**
 * Kassaning lokal PIN'i: kassir birinchi marta onlayn (telefon + parol) kirganda o'rnatadi, keyin offline almashishda
 * ishlatiladi. Argon2id (hash-wasm, native modulsiz); 5 ta xatodan keyin 5 daqiqa qulf. Server PIN xeshlari qurilmaga
 * tarqatilmaydi.
 */
import { randomBytes } from "node:crypto";
import { argon2Verify, argon2id } from "hash-wasm";
import type { LocalStore } from "./local-store.js";

export const PIN_PATTERN = /^\d{4,8}$/;
export const PIN_LOCK_AFTER = 5;
export const PIN_LOCK_MS = 5 * 60_000;

export function hashPin(pin: string): Promise<string> {
  return argon2id({
    password: pin,
    salt: randomBytes(16),
    iterations: 3,
    parallelism: 1,
    memorySize: 19_456,
    hashLength: 32,
    outputType: "encoded",
  });
}

export type PinCheck = { ok: true } | { ok: false; reason: "not_set" | "locked" | "wrong"; lockedUntil?: string };

export async function checkPin(store: LocalStore, userId: string, pin: string, now = new Date()): Promise<PinCheck> {
  const state = store.pinState(userId);
  if (!state) return { ok: false, reason: "not_set" };
  if (state.lockedUntil && Date.parse(state.lockedUntil) > now.getTime()) return { ok: false, reason: "locked", lockedUntil: state.lockedUntil };
  const valid = PIN_PATTERN.test(pin) && (await argon2Verify({ password: pin, hash: state.hash }));
  store.recordPinAttempt(userId, valid, PIN_LOCK_AFTER, PIN_LOCK_MS, now);
  if (valid) return { ok: true };
  const after = store.pinState(userId);
  return after?.lockedUntil && Date.parse(after.lockedUntil) > now.getTime()
    ? { ok: false, reason: "locked", lockedUntil: after.lockedUntil }
    : { ok: false, reason: "wrong" };
}

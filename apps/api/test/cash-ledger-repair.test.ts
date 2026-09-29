/**
 * Kassa ↔ buxgalteriya hisobi bog'lanishini tuzatish (bir martalik, moliyaviy).
 *
 * Production'da ikkita kassa noto'g'ri hisobga bog'langan edi: naqd kassa → "1020 Bank hisobi" (294 100 so'm
 * jurnalda bankka tushgan) va naqd kassa → "1100 Debitorlar" (tarixiy satr yo'q, faqat kelajakdagi yozuvlar xavfi).
 * Shu testlar tuzatish kodini o'sha ikki holat bo'yicha, production'ga tegmasdan tekshiradi.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../src/db/client.js";
import { accounts, cashAccounts, cashTransactions, journalEntries, journalLines } from "../src/db/schema/finance.js";
import { auditLogs } from "../src/db/schema/platform.js";
import { withTransaction } from "../src/db/transaction.js";
import { CASH_LEDGER_RECLASS, repairCashLedgerMapping } from "../src/modules/finance/cash-ledger-repair.service.js";
import { postJournalEntry } from "../src/modules/finance/journal.service.js";
import { buildServer } from "../src/server.js";
import { createCompany, resetDatabase, signedIn } from "./helpers.js";

type Company = Awaited<ReturnType<typeof createCompany>>;

let app: FastifyInstance;
let company: Company;
let mainCash: string;
let mainBank: string;
let adminCookie: string;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  const admin = await signedIn(app, { isPlatformAdmin: true });
  adminCookie = admin.cookie;
  company = await createCompany(app, admin.cookie, { name: "Tuzatish kompaniyasi" });
  const rows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
  mainCash = rows.find((r) => r.type === "cash")!.id;
  mainBank = rows.find((r) => r.type === "bank")!.id;
});

const api = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

async function ledger(code: string, companyId = company.companyId) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return row!;
}

async function cashBalance(id: string) {
  const [row] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, id));
  return row!.balance;
}

async function purposeFor(type: "in" | "out", cookie = company.ownerCookie) {
  const res = await api(cookie, "GET", `/accounts?type=${type === "in" ? "income" : "expense"}`);
  const rows = res.json().accounts as { id: string; isActive: boolean; subtype: string | null }[];
  return rows.find((row) => row.isActive && !["sales", "cogs"].includes(row.subtype ?? ""))!.id;
}

const record = async (body: { type?: string } & Record<string, unknown>, cookie = company.ownerCookie) =>
  api(cookie, "POST", "/cash-transactions", {
    description: "Sinov tushumi",
    counterAccountId: await purposeFor(body.type === "out" ? "out" : "in"),
    ...body,
  });

/**
 * Production'dagi buzuq holatni tiklaydi: naqd kassa 1020 "Bank hisobi" ga bog'langan va unga uchta tushum
 * yozilgan. Bog'lanish bazaga TO'G'RIDAN-TO'G'RI yoziladi, chunki API endi bunday bog'lanishni rad etadi —
 * ma'lumot aynan shu tekshiruv qo'shilgunga qadar paydo bo'lgan.
 */
async function brokenCashToBank(amounts = ["180000", "18000", "96100"]) {
  const bank = await ledger("1020");
  await db.update(cashAccounts).set({ ledgerAccountId: bank.id }).where(eq(cashAccounts.id, mainCash));
  for (const amount of amounts) {
    const res = await record({ cashAccountId: mainCash, type: "in", amount });
    expect(res.statusCode, res.body).toBe(201);
  }
  return bank;
}

const repair = (params: { companyId?: string; cashAccountId?: string; targetLedgerAccountId?: string | null } = {}) =>
  withTransaction((tx) =>
    repairCashLedgerMapping(tx, {
      companyId: params.companyId ?? company.companyId,
      cashAccountId: params.cashAccountId ?? mainCash,
      targetLedgerAccountId: params.targetLedgerAccountId ?? null,
      reason: "Production audit: kassa noto'g'ri hisobga bog'langan",
      actor: { userId: null, userName: "CLI repair" },
    }),
  );

async function reclassEntries(companyId = company.companyId) {
  return db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.referenceType, CASH_LEDGER_RECLASS)));
}

/** Tarixiy yozuvlarning "barmoq izi" — tuzatishdan keyin bitta ham o'zgarmasligi kerak. */
async function historySnapshot(companyId = company.companyId) {
  const entries = await db
    .select({ id: journalEntries.id, number: journalEntries.number, status: journalEntries.status, total: journalEntries.totalDebit })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, companyId));
  const ids = entries.map((e) => e.id);
  const lines = ids.length
    ? await db
        .select({ id: journalLines.id, entryId: journalLines.entryId, accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .where(inArray(journalLines.entryId, ids))
    : [];
  const sort = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return { entries: sort(entries), lines: sort(lines) };
}

describe("Kassa ↔ hisob bog'lanishini tuzatish", () => {
  it("A+C+D+E: buzuq holat tiklanadi, bog'lanish va 294 100 so'm reklassifikatsiya yozuvi to'g'rilanadi", async () => {
    const bank = await brokenCashToBank();

    // A) tuzatishdan OLDIN: naqd tushum jurnalda bankka tushgan
    expect((await ledger("1010")).balance).toBe("0.00");
    expect((await ledger("1020")).balance).toBe("294100.00");
    expect(await cashBalance(mainCash)).toBe("294100.00");

    const before = await historySnapshot();
    const result = await repair();

    // C) bog'lanish to'g'rilandi (null — kassa turi bo'yicha umumiy 1010)
    expect(result.status).toBe("repaired");
    expect(result.oldLedger).toMatchObject({ code: "1020" });
    expect(result.newLedger).toMatchObject({ code: "1010" });
    expect(result.mispostedLines).toBe(3);
    expect(result.amount).toBe("294100.00");
    const [cash] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
    expect(cash!.ledgerAccountId).toBeNull();

    // D) aynan bitta tuzatuvchi yozuv: DR 1010 / CR 1020
    const entries = await reclassEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.referenceId).toBe(mainCash);
    const cash1010 = await ledger("1010");
    const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entries[0]!.id));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === cash1010.id)!.debit).toBe("294100.00");
    expect(lines.find((l) => l.accountId === bank.id)!.credit).toBe("294100.00");

    // E) debet = kredit
    expect(entries[0]!.totalDebit).toBe(entries[0]!.totalCredit);

    // Tuzatishdan KEYIN: faqat tasnif o'zgardi, jami o'zgarmadi
    expect((await ledger("1010")).balance).toBe("294100.00");
    expect((await ledger("1020")).balance).toBe("0.00");

    // G) tarixiy yozuvlar daxlsiz — biror satr/holat o'zgarmagan
    const after = await historySnapshot();
    const untouched = {
      entries: after.entries.filter((e) => before.entries.some((b) => b.id === e.id)),
      lines: after.lines.filter((l) => before.lines.some((b) => b.id === l.id)),
    };
    expect(untouched).toEqual(before);
    expect(after.entries).toHaveLength(before.entries.length + 1);
  });

  it("F: tuzatishdan keyin naqd kassalar yig'indisi 1010 ga teng, kassa qoldig'i o'zgarmaydi", async () => {
    await brokenCashToBank();
    const cashBefore = await cashBalance(mainCash);

    await repair();

    // Kassa qoldig'iga TEGILMAYDI — u to'g'ri edi
    expect(await cashBalance(mainCash)).toBe(cashBefore);

    const kassas = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, company.companyId));
    const cashSum = kassas.filter((k) => k.type === "cash").reduce((s, k) => s + Number(k.balance), 0);
    expect(cashSum).toBe(Number((await ledger("1010")).balance));

    const bankSum = kassas.filter((k) => k.type === "bank").reduce((s, k) => s + Number(k.balance), 0);
    expect(bankSum).toBe(Number((await ledger("1020")).balance));
  });

  it("H: audit izida aktor, kassa, eski/yangi hisob, summa, sabab va tuzatuvchi yozuv id'si bo'ladi", async () => {
    await brokenCashToBank();
    const result = await repair();

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, company.companyId), eq(auditLogs.action, "CASH_LEDGER_REPAIRED")));
    expect(entry).toBeDefined();
    expect(entry!.resource).toBe("cash_accounts");
    expect(entry!.resourceId).toBe(mainCash);
    expect(entry!.userName).toBe("CLI repair");
    expect(entry!.occurredAt).toBeInstanceOf(Date);
    expect(entry!.details).toMatchObject({
      oldLedger: { code: "1020" },
      newLedger: { code: "1010" },
      mispostedLines: 3,
      amount: "294100.00",
      reason: "Production audit: kassa noto'g'ri hisobga bog'langan",
      correctionEntryId: result.correction!.entryId,
    });
  });

  it("I+M: ikkinchi chaqiruv 'already_repaired' qaytaradi va yangi yozuv yaratmaydi", async () => {
    await brokenCashToBank();
    const first = await repair();
    expect(first.status).toBe("repaired");

    const balancesAfterFirst = [(await ledger("1010")).balance, (await ledger("1020")).balance];

    // Ikkinchi chaqiruv — xuddi qayta deploy yoki qayta ishga tushirishdan keyingidek, yangi tranzaksiyada
    const second = await repair();
    expect(second.status).toBe("already_repaired");
    expect(second.correction).toBeNull();
    expect(second.amount).toBe("0");

    expect(await reclassEntries()).toHaveLength(1);
    expect([(await ledger("1010")).balance, (await ledger("1020")).balance]).toEqual(balancesAfterFirst);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "CASH_LEDGER_REPAIRED"))).toHaveLength(1);
  });

  it("J: tranzaksiya uzilsa hammasi rollback — bog'lanish ham, jurnal ham, qoldiq ham eski holatda qoladi", async () => {
    const bank = await brokenCashToBank();
    const before = { ...(await historySnapshot()), l1010: (await ledger("1010")).balance, l1020: (await ledger("1020")).balance };

    // 1-holat: bog'lanish yangilandi, jurnalgacha xato
    await expect(
      withTransaction(async (tx) => {
        await tx.update(cashAccounts).set({ ledgerAccountId: null }).where(eq(cashAccounts.id, mainCash));
        throw new Error("jurnalgacha uzildi");
      }),
    ).rejects.toThrow("jurnalgacha uzildi");
    const [afterFirst] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
    expect(afterFirst!.ledgerAccountId).toBe(bank.id);

    // 2-holat: bog'lanish + jurnal + audit bajarildi, commit'dan oldin xato
    await expect(
      withTransaction(async (tx) => {
        await repairCashLedgerMapping(tx, {
          companyId: company.companyId,
          cashAccountId: mainCash,
          targetLedgerAccountId: null,
          reason: "rollback sinovi",
          actor: { userId: null, userName: "CLI repair" },
        });
        throw new Error("commit'dan oldin uzildi");
      }),
    ).rejects.toThrow("commit'dan oldin uzildi");

    // Yakuniy holat boshlang'ich holat bilan bir xil
    const [cash] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, mainCash));
    expect(cash!.ledgerAccountId).toBe(bank.id);
    expect(await reclassEntries()).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "CASH_LEDGER_REPAIRED"))).toHaveLength(0);
    expect((await ledger("1010")).balance).toBe(before.l1010);
    expect((await ledger("1020")).balance).toBe(before.l1020);
    const after = await historySnapshot();
    expect(after).toEqual({ entries: before.entries, lines: before.lines });
  });

  it("K: boshqa kompaniya tuzatishdan ta'sirlanmaydi (ikki tomonlama)", async () => {
    await brokenCashToBank();
    const other = await createCompany(app, adminCookie, { name: "Ikkinchi kompaniya" });
    const otherRows = await db.select().from(cashAccounts).where(eq(cashAccounts.companyId, other.companyId));
    const otherCash = otherRows.find((r) => r.type === "cash")!.id;
    const otherBank = await ledger("1020", other.companyId);
    await db.update(cashAccounts).set({ ledgerAccountId: otherBank.id }).where(eq(cashAccounts.id, otherCash));

    const otherBefore = await historySnapshot(other.companyId);
    await repair();
    // Bonnu tuzatildi — ikkinchi kompaniyada hech narsa o'zgarmadi
    expect(await historySnapshot(other.companyId)).toEqual(otherBefore);
    expect(await reclassEntries(other.companyId)).toHaveLength(0);
    const [stillBroken] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, otherCash));
    expect(stillBroken!.ledgerAccountId).toBe(otherBank.id);

    // Teskarisi ham: ikkinchisini tuzatish birinchisiga tegmaydi
    const firstAfterRepair = await historySnapshot();
    await repair({ companyId: other.companyId, cashAccountId: otherCash });
    expect(await historySnapshot()).toEqual(firstAfterRepair);
  });

  it("K: boshqa kompaniyaning kassasini tuzatishga urinish rad etiladi", async () => {
    await brokenCashToBank();
    const other = await createCompany(app, adminCookie, { name: "Uchinchi kompaniya" });
    await expect(repair({ companyId: other.companyId, cashAccountId: mainCash })).rejects.toThrow("Kassa topilmadi");
    expect(await reclassEntries()).toHaveLength(0);
  });

  it("L: Ezo holati — bog'lanish noto'g'ri, tarixiy satr yo'q: faqat bog'lanish to'g'rilanadi, jurnal yozilmaydi", async () => {
    const receivable = await ledger("1100");
    const created = (
      await api(company.ownerCookie, "POST", "/cash-accounts", { name: "Yetkazuvchi — yo'ldagi naqd", type: "cash" })
    ).json().cashAccount;
    await db.update(cashAccounts).set({ ledgerAccountId: receivable.id }).where(eq(cashAccounts.id, created.id));

    const before = await historySnapshot();
    const result = await repair({ cashAccountId: created.id });

    expect(result.status).toBe("repaired");
    expect(result.oldLedger).toMatchObject({ code: "1100" });
    expect(result.newLedger).toMatchObject({ code: "1010" });
    expect(result.mispostedLines).toBe(0);
    expect(result.amount).toBe("0.00");
    expect(result.correction).toBeNull();

    const [cash] = await db.select().from(cashAccounts).where(eq(cashAccounts.id, created.id));
    expect(cash!.ledgerAccountId).toBeNull();
    expect(await reclassEntries()).toHaveLength(0);
    expect(await historySnapshot()).toEqual(before);
    expect((await ledger("1100")).balance).toBe(receivable.balance);

    // Ikkinchi chaqiruv ham xavfsiz: bog'lanish allaqachon to'g'ri
    const second = await repair({ cashAccountId: created.id });
    expect(second.status).toBe("nothing_to_repair");
    expect(await reclassEntries()).toHaveLength(0);
  });

  it("L: bog'lanishi to'g'ri kassada tuzatish ishlamaydi va jurnalga tegmaydi", async () => {
    const cash1010 = await ledger("1010");
    await db.update(cashAccounts).set({ ledgerAccountId: cash1010.id }).where(eq(cashAccounts.id, mainCash));
    const res = await record({ cashAccountId: mainCash, type: "in", amount: "50000" });
    expect(res.statusCode).toBe(201);

    const before = await historySnapshot();
    const result = await repair();
    expect(result.status).toBe("nothing_to_repair");
    expect(result.correction).toBeNull();
    expect(await historySnapshot()).toEqual(before);
    expect((await ledger("1010")).balance).toBe("50000.00");
  });

  it("N: parallel ikki tuzatish — natijada aynan bitta tuzatuvchi yozuv qoladi", async () => {
    await brokenCashToBank(["100000", "50000"]);

    const results = await Promise.allSettled([repair(), repair()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    expect(await reclassEntries()).toHaveLength(1);
    expect((await ledger("1010")).balance).toBe("150000.00");
    expect((await ledger("1020")).balance).toBe("0.00");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "CASH_LEDGER_REPAIRED"))).toHaveLength(1);
  });

  it("Xavfsizlik: tuzatish HTTP orqali chaqirilmaydi — marshrut yo'q", async () => {
    for (const url of ["/cash-accounts/repair-ledger", "/cash-ledger-repair", "/repair-cash-ledger"]) {
      const res = await api(company.ownerCookie, "POST", url, { cashAccountId: mainCash });
      expect(res.statusCode, `${url} ochiq qolgan`).toBe(404);
    }
  });

  it("Bitta hujjat bir nechta kassadan pul harakatlantirsa — faqat shu kassaning satri ko'chiriladi", async () => {
    // Production shakli: qaytarish hujjati K03-Q000001 naqd kassadan 14 000, ikkita bank kassasidan 3 000 va 3 160
    // qaytargan; uchala jurnal satri bitta `reference_id` ga ega va uchalasi ham 1020 da. Faqat havola bo'yicha
    // solishtirilganda bank satrlari ham naqd kassaga tegishli deb hisoblanardi.
    const bank1020 = await ledger("1020");
    const income = await ledger("4100");
    await db.update(cashAccounts).set({ ledgerAccountId: bank1020.id }).where(eq(cashAccounts.id, mainCash));

    const documentId = randomUUID();
    const txDate = "2026-09-20";
    await withTransaction(async (tx) => {
      const movements: [string, string, string][] = [
        [mainCash, "20000", "kassa ulushi"],
        [mainBank, "3000", "bank ulushi 1"],
        [mainBank, "3160", "bank ulushi 2"],
      ];
      for (const [accountId, amount, note] of movements) {
        await tx.insert(cashTransactions).values({
          companyId: company.companyId,
          cashAccountId: accountId,
          type: "in",
          amount,
          currency: "UZS",
          txDate,
          description: note,
          referenceType: "sinov_hujjat",
          referenceId: documentId,
          balanceAfter: amount,
        });
      }
      // Uchta alohida yozuv, bitta `reference_id`, har xil `reference_type` — yagona indeks shunga yo'l qo'yadi
      for (const [i, amount] of ["20000", "3000", "3160"].entries()) {
        await postJournalEntry(tx, company.companyId, null, {
          entryDate: txDate,
          description: `Sinov hujjati ${i}`,
          referenceType: `sinov_hujjat_${i}`,
          referenceId: documentId,
          lines: [
            { accountId: bank1020.id, debit: amount },
            { accountId: income.id, credit: amount },
          ],
        });
      }
    });
    expect((await ledger("1020")).balance).toBe("26160.00");

    const result = await repair();
    // Faqat naqd kassaning 20 000 i ko'chadi; bank kassasining 3 000 va 3 160 i tegilmaydi
    expect(result.mispostedLines).toBe(1);
    expect(result.skippedLines).toBe(2);
    expect(result.amount).toBe("20000.00");
    expect((await ledger("1010")).balance).toBe("20000.00");
    expect((await ledger("1020")).balance).toBe("6160.00");
  });

  it("Tuzatilgandan keyin bog'lanish yana buzilsa — jimgina 'tuzatilgan' demaydi, odam aralashuvini so'raydi", async () => {
    const bank = await brokenCashToBank(["70000"]);
    await repair();

    // Bazaga to'g'ridan-to'g'ri qayta buzish (API bunga yo'l qo'ymaydi): ikkinchi reklass yozuvini yagona indeks
    // bloklaydi, shuning uchun tuzatish "already_repaired" deb o'tib ketmasligi kerak
    await db.update(cashAccounts).set({ ledgerAccountId: bank.id }).where(eq(cashAccounts.id, mainCash));

    await expect(repair()).rejects.toThrow("yana");
    expect(await reclassEntries()).toHaveLength(1);
  });

  it("Nishon hisob kassa turiga mos bo'lmasa tuzatish rad etiladi", async () => {
    await brokenCashToBank(["10000"]);
    const clearing = await ledger("1030");
    await expect(repair({ targetLedgerAccountId: clearing.id })).rejects.toThrow("naqd");
    expect(await reclassEntries()).toHaveLength(0);
    expect((await ledger("1020")).balance).toBe("10000.00");
  });
});

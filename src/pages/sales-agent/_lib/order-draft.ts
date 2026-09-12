/**
 * Buyurtma qoralamasi qurilmada: har o'zgarish `localStorage` ga yoziladi — sahifa yangilansa, tarmoq uzilsa yoki agent
 * boshqa sahifaga o'tib ketsa ham davom etadi. Serverga "Saqlash"/"Tasdiqlash" da o'sha `requestId` bilan yuboriladi
 * (server bir identifikator uchun bitta buyurtma saqlaydi — qayta urinish takror buyurtma yaratmaydi).
 */
import { num, type AgentOrder, type PaymentType } from "./types.ts";

export type DraftLine = {
  productId: string;
  name: string;
  piecePrice: string;
  box: { unitName: string; factor: string; price: string } | null;
  pieces: number;
  boxes: number;
};

export type LocalDraft = {
  requestId: string;
  customerId: string;
  lines: DraftLine[];
  paymentType: PaymentType;
  paymentDueDate: string;
  deliveryDate: string;
  /** Oxirgi o'zgarish vaqti (ms); 0 — hali o'zgartirilmagan. */
  changedAt: number;
};

const storageKey = (customerId: string) => `bum:agent-order:${customerId}`;

export function readLocalDraft(customerId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(customerId));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(draft: LocalDraft) {
  try {
    localStorage.setItem(storageKey(draft.customerId), JSON.stringify(draft));
  } catch {
    // Xotira to'la yoki taqiqlangan — server qoralamasi baribir saqlanadi
  }
}

/** O'zgarish vaqti bilan (qurilmadagi nusxa serverdagidan yangiroqligini bilish uchun). */
export function stampDraft(draft: Omit<LocalDraft, "changedAt">): LocalDraft {
  return { ...draft, changedAt: Date.now() };
}

export function clearLocalDraft(customerId: string) {
  try {
    localStorage.removeItem(storageKey(customerId));
  } catch {
    // e'tiborsiz
  }
}

function fromServer(order: AgentOrder): LocalDraft {
  return {
    requestId: order.clientRequestId,
    customerId: order.customerId,
    paymentType: order.paymentType,
    paymentDueDate: order.paymentDueDate ?? "",
    deliveryDate: order.deliveryDate ?? "",
    changedAt: Date.parse(order.updatedAt),
    lines: order.lines.map((line) => {
      const item = order.items?.find((row) => row.productId === line.productId);
      const piecePrice = item?.unitPrice ?? "0";
      return {
        productId: line.productId,
        name: item?.productName ?? "",
        piecePrice,
        box: line.boxFactor ? { unitName: "", factor: line.boxFactor, price: String(num(piecePrice) * num(line.boxFactor)) } : null,
        pieces: num(line.pieces),
        boxes: num(line.boxes),
      };
    }),
  };
}

/** Boshlang'ich holat: qurilmadagi yangiroq nusxa, bo'lmasa server qoralamasi, bo'lmasa yangi identifikator. */
export function initialDraft(customerId: string, server: AgentOrder | null): LocalDraft {
  const local = readLocalDraft(customerId);
  if (server) {
    const serverDraft = fromServer(server);
    return local && local.requestId === server.clientRequestId && local.changedAt > serverDraft.changedAt ? local : serverDraft;
  }
  if (local && local.lines.length > 0) return local;
  return { requestId: crypto.randomUUID(), customerId, lines: [], paymentType: "cash", paymentDueDate: "", deliveryDate: "", changedAt: 0 };
}

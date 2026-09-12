import { afterEach, describe, expect, it } from "vitest";
import { clearLocalDraft, initialDraft, readLocalDraft, stampDraft, writeLocalDraft } from "./order-draft.ts";
import type { AgentOrder } from "./types.ts";

const serverOrder = (overrides: Partial<AgentOrder> = {}): AgentOrder => ({
  id: "o1",
  number: "SO-2026-0001",
  status: "draft",
  orderDate: "2026-09-12",
  deliveryDate: "2026-09-13",
  currency: "UZS",
  totalAmount: "230000.00",
  paidAmount: "0.00",
  notes: null,
  customerId: "c1",
  customerName: "Baraka",
  visitId: null,
  clientRequestId: "req-1",
  paymentType: "credit",
  paymentDueDate: "2026-09-20",
  lines: [{ productId: "p1", pieces: "3.0000", boxes: "2.0000", boxUnitId: "u1", boxFactor: "10.0000" }],
  submittedAt: null,
  submitDistanceMeters: null,
  approvalStatus: null,
  rejectionReason: null,
  updatedAt: "2020-01-01T00:00:00.000Z",
  items: [{ productId: "p1", productName: "Cola", quantity: "23.0000", unitPrice: "10000.0000", discountPercent: "0.00", lineTotal: "230000.00" }],
  ...overrides,
});

afterEach(() => localStorage.clear());

describe("buyurtma qoralamasi (qurilmada)", () => {
  it("server qoralamasidan tiklaydi: dona, blok, narx, to'lov va yetkazish", () => {
    const draft = initialDraft("c1", serverOrder());
    expect(draft).toMatchObject({ requestId: "req-1", customerId: "c1", paymentType: "credit", paymentDueDate: "2026-09-20", deliveryDate: "2026-09-13" });
    expect(draft.lines).toEqual([
      { productId: "p1", name: "Cola", piecePrice: "10000.0000", box: { unitName: "", factor: "10.0000", price: "100000" }, pieces: 3, boxes: 2 },
    ]);
  });

  it("qurilmadagi yangiroq nusxa ustun; boshqa identifikator yoki eskiroq nusxa bo'lsa — server", () => {
    const fromServer = initialDraft("c1", serverOrder());
    writeLocalDraft(stampDraft({ ...fromServer, lines: fromServer.lines.map((line) => ({ ...line, pieces: 5 })) }));

    expect(initialDraft("c1", serverOrder()).lines[0]!.pieces).toBe(5);
    expect(initialDraft("c1", serverOrder({ clientRequestId: "req-2" })).requestId).toBe("req-2");
    expect(initialDraft("c1", serverOrder({ updatedAt: "2999-01-01T00:00:00.000Z" })).lines[0]!.pieces).toBe(3);
  });

  it("server qoralamasi yo'q: qurilmadagi nusxa, bo'lmasa yangi identifikator; tozalash", () => {
    const fresh = initialDraft("c2", null);
    expect(fresh).toMatchObject({ customerId: "c2", lines: [], paymentType: "cash", changedAt: 0 });
    expect(initialDraft("c2", null).requestId).not.toBe(fresh.requestId);

    writeLocalDraft(stampDraft({ ...fresh, lines: [{ productId: "p1", name: "Cola", piecePrice: "10000", box: null, pieces: 1, boxes: 0 }] }));
    expect(initialDraft("c2", null).requestId).toBe(fresh.requestId);

    clearLocalDraft("c2");
    expect(readLocalDraft("c2")).toBeNull();
  });
});

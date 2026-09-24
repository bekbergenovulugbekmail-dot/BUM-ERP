import { describe, expect, it } from "vitest";
import { buildAgentRows, dayTotals, offScheduleRoutes } from "./schedule.ts";
import type { DistributionRoute } from "./types.ts";

/**
 * Haftalik panorama hisobi. Ayni shu joy bo'lmagani uchun bir agentga bitta kunda ikkita
 * marshrut tushib qolgani faqat agent ilovasida bilinardi (marshrutni "ko'chirganda" eski kun
 * o'chmay qolsa). Kun tartibi: UI da 0 = dushanba, bazada 0 = yakshanba.
 */
const route = (patch: Partial<DistributionRoute> & { id: string }): DistributionRoute => ({
  name: patch.id,
  territoryId: null,
  territoryName: null,
  salesRepId: null,
  description: null,
  days: [],
  color: null,
  isActive: true,
  salesRepName: null,
  customerCount: 0,
  ...patch,
});

// API kunlari: 1 = dushanba, 2 = seshanba, 4 = payshanba, 5 = juma
const hazorasp = route({ id: "hazorasp", salesRepId: "a1", salesRepName: "Lochinbek", days: [2, 4], customerCount: 78 });
const pitnak = route({ id: "pitnak", salesRepId: "a1", salesRepName: "Lochinbek", days: [4], customerCount: 50 });
const bogot = route({ id: "bogot", salesRepId: "a1", salesRepName: "Lochinbek", days: [1], customerCount: 73 });
const agentsiz = route({ id: "cholish", days: [], customerCount: 9 });
const kunsiz = route({ id: "kunsiz", salesRepId: "a2", salesRepName: "Dilshod", days: [], customerCount: 4 });

const ALL = [hazorasp, pitnak, bogot, agentsiz, kunsiz];

describe("haftalik panorama", () => {
  it("marshrutlarni agent va UI kuni bo'yicha joylaydi", () => {
    const [lochinbek] = buildAgentRows([hazorasp, pitnak, bogot]);
    expect(lochinbek!.name).toBe("Lochinbek");
    expect(lochinbek!.perDay[0]!.map((r) => r.id)).toEqual(["bogot"]); // dushanba
    expect(lochinbek!.perDay[1]!.map((r) => r.id)).toEqual(["hazorasp"]); // seshanba
    expect(lochinbek!.perDay[2]).toEqual([]); // chorshanba
    expect(lochinbek!.perDay[4]).toEqual([]); // juma
  });

  it("bir kunda ikkita marshrut ko'rinadi — 'ko'chirish' da eski kun o'chmay qolganda", () => {
    const [lochinbek] = buildAgentRows([hazorasp, pitnak, bogot]);
    expect(lochinbek!.perDay[3]!.map((r) => r.id)).toEqual(["hazorasp", "pitnak"]); // payshanba
    expect(lochinbek!.stores).toBe(73 + 78 + 78 + 50); // du + se + pa(2 ta)
  });

  it("agenti yoki kuni yo'q marshrut jadvalga tushmaydi", () => {
    expect(buildAgentRows(ALL).map((row) => row.name)).toEqual(["Dilshod", "Lochinbek"]);
    expect(buildAgentRows(ALL).find((row) => row.name === "Dilshod")!.perDay.every((day) => day.length === 0)).toBe(true);
    expect(offScheduleRoutes(ALL).map((r) => r.id)).toEqual(["cholish", "kunsiz"]);
  });

  it("kunlik yuk: agent, marshrut va do'kon soni", () => {
    const totals = dayTotals(ALL);
    expect(totals[0]).toEqual({ routes: 1, agents: 1, stores: 73 }); // dushanba
    expect(totals[3]).toEqual({ routes: 2, agents: 1, stores: 128 }); // payshanba
    expect(totals[6]).toEqual({ routes: 0, agents: 0, stores: 0 }); // yakshanba
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filtersToQuery, statusParam } from "./filters.ts";

describe("yetkazmalar filtri → server parametrlari", () => {
  it("bo'sh filtr — parametr yuborilmaydi", () => {
    expect(Object.values(filtersToQuery(EMPTY_FILTERS)).every((value) => value === undefined)).toBe(true);
  });

  it("holat guruhlari ro'yxatga ochiladi, bitta holat — o'zi", () => {
    expect(statusParam("open")).toBe("ready,assigned,accepted,out_for_delivery,arrived,delivering");
    expect(statusParam("waiting")).toBe("assigned,accepted");
    expect(statusParam("on_route")).toBe("out_for_delivery,arrived,delivering");
    expect(statusParam("failed")).toBe("failed");
    expect(statusParam("")).toBeUndefined();
  });

  it("sana, agent, belgilar va qidiruv", () => {
    expect(
      filtersToQuery({
        ...EMPTY_FILTERS,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-13",
        agentId: "a1",
        overdue: true,
        reviewPending: true,
        search: "  DL-2026  ",
      }),
    ).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-13",
      status: undefined,
      agentId: "a1",
      unassigned: undefined,
      overdue: "true",
      reviewPending: "true",
      search: "DL-2026",
    });
  });
});

/**
 * Saralash holati → so'rov parametrlari va hudud tanlovlari.
 * Muhim qoida: standart qiymatlar so'rovga QO'SHILMAYDI (URL toza qoladi, kesh kaliti o'zgarmaydi).
 */
import { describe, expect, it } from "vitest";
import {
  ALL,
  cityTotals,
  customerFilterParams,
  districtTotals,
  emptyCustomerFilter,
  isCustomerFilterActive,
  type CustomerRegion,
} from "./customer-filter.ts";

const REGIONS: CustomerRegion[] = [
  { city: "Urganch", district: "Luchevoy", count: 12 },
  { city: "Urganch", district: "Gulobod", count: 3 },
  { city: "Xiva", district: null, count: 5 },
  { city: null, district: null, count: 2 },
];

describe("mijozlarni saralash", () => {
  it("standart holatda hech qanday parametr yuborilmaydi", () => {
    expect(customerFilterParams(emptyCustomerFilter)).toEqual({
      city: undefined,
      district: undefined,
      withDebt: undefined,
      sort: undefined,
    });
    expect(isCustomerFilterActive(emptyCustomerFilter)).toBe(false);
  });

  it("tanlangan qiymatlar parametrga aylanadi", () => {
    const filter = { city: "Urganch", district: "Luchevoy", sort: "newest" as const, withDebt: true };
    expect(customerFilterParams(filter)).toEqual({
      city: "Urganch",
      district: "Luchevoy",
      withDebt: true,
      sort: "newest",
    });
    expect(isCustomerFilterActive(filter)).toBe(true);
    // Faqat tartib o'zgarsa ham "saralash yoqilgan" hisoblanadi (Tozalash tugmasi chiqadi)
    expect(isCustomerFilterActive({ ...emptyCustomerFilter, sort: "debt" })).toBe(true);
  });

  it("shahar ro'yxati mijozlar soni bilan yig'iladi, hududsizlar tanlovga tushmaydi", () => {
    expect(cityTotals(REGIONS)).toEqual([
      ["Urganch", 15],
      ["Xiva", 5],
    ]);
  });

  it("mahalla ro'yxati tanlangan shaharga qarab qisqaradi", () => {
    expect(districtTotals(REGIONS, ALL)).toEqual([
      ["Gulobod", 3],
      ["Luchevoy", 12],
    ]);
    expect(districtTotals(REGIONS, "Urganch")).toEqual([
      ["Gulobod", 3],
      ["Luchevoy", 12],
    ]);
    // Xivada mahalla ko'rsatilmagan — tanlov bo'sh, Select o'chiriladi
    expect(districtTotals(REGIONS, "Xiva")).toEqual([]);
  });
});

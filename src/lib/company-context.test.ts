import { afterEach, describe, expect, it } from "vitest";
import { companyPathKey } from "@bum/shared";
import { apiUrl, getCompanyContext, setCompanyContext } from "./api.ts";
import { pathHasLocale } from "../i18n.ts";

const ID = "c0000000-0000-4000-8000-000000000001";

afterEach(() => setCompanyContext(null));

describe("biznes manzili", () => {
  it("slug — yaroqli va band bo'lmasa; aks holda id", () => {
    expect(companyPathKey("bonnu-market", ID)).toBe("bonnu-market");
    expect(companyPathKey("Bonnu-Market", ID)).toBe("bonnu-market");
    expect(companyPathKey("admin", ID)).toBe(ID);
    expect(companyPathKey("uz", ID)).toBe(ID);
    expect(companyPathKey("login", ID)).toBe(ID);
    expect(companyPathKey(null, ID)).toBe(ID);
    expect(companyPathKey("a b", ID)).toBe(ID);
    expect(companyPathKey("bonnu", null)).toBeNull();
  });

  it("til yoki biznes manzili", () => {
    expect(pathHasLocale("/uz/login")).toBe(true);
    expect(pathHasLocale("/RU/dashboard")).toBe(true);
    expect(pathHasLocale("/bonnu-market/purchase")).toBe(false);
    expect(pathHasLocale("/")).toBe(false);
  });

  it("tab konteksti: brauzer yuklaydigan manzilga parametr, konteksti yo'q — o'zgarmaydi", () => {
    expect(apiUrl("/api/files/x", { v: 1 })).toBe("/api/files/x?v=1");
    setCompanyContext("hadicha-market");
    expect(getCompanyContext()).toBe("hadicha-market");
    expect(apiUrl("/api/files/x", { v: 1 })).toBe("/api/files/x?v=1&bumCompany=hadicha-market");
  });
});

/**
 * URL'ning birinchi bo'lagi: til (`/uz/login`) yoki biznes (`/bonnu-market/purchase`).
 *
 * Biznes bo'lagi shu brauzer tabining API konteksti bo'ladi (`x-bum-company`) — bir sessiya bilan bir nechta biznes
 * parallel tablarda ishlaydi, server kontekstni foydalanuvchining faol a'zoliklari bo'yicha tekshiradi. Til bo'lagi bilan
 * kelgan biznes sahifalari (eski `/uz/dashboard` havolalari) foydalanuvchining joriy biznesi manziliga yo'naltiriladi.
 * Sahifalardagi `/${lng}/...` havolalari biznes manzilida avtomatik shu biznesda qoladi.
 */
import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Building2, ShieldX } from "lucide-react";
import { companyPathKey } from "@bum/shared";
import { api, ApiError, setCompanyContext } from "@/lib/api.ts";
import { SAVED_OR_DEFAULT_LOCALE, changeLocale, isSupportedLocale, setLocaleInPath, type SupportedLocale } from "@/i18n.ts";
import { useCurrentUser, useMeError } from "@/hooks/use-auth.ts";
import type { MyCompany } from "@/hooks/use-company.ts";

/** Biznesdan tashqari, til bilan qoladigan sahifalar. */
const LOCALE_PAGES = new Set(["login", "onboarding", "select-company", "admin"]);

function Spinner() {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

export default function BaseSegment({ children }: { children: ReactNode }) {
  const { lng = "" } = useParams<{ lng: string }>();
  const lower = lng.toLowerCase();
  return isSupportedLocale(lower) ? (
    <LocaleSegment lng={lng}>{children}</LocaleSegment>
  ) : (
    <CompanySegment companyKey={lower}>{children}</CompanySegment>
  );
}

function LocaleSegment({ lng, children }: { lng: string; children: ReactNode }) {
  setCompanyContext(null);
  const { i18n } = useTranslation();
  const location = useLocation();
  const me = useCurrentUser();
  const meError = useMeError();
  const lower = lng.toLowerCase() as SupportedLocale;

  useEffect(() => {
    if (i18n.language !== lower) void changeLocale(lower);
  }, [lower, i18n]);

  if (lng !== lower) return <Navigate to={setLocaleInPath(lower, location.pathname, location.search, location.hash)} replace />;

  const rest = location.pathname.split("/").slice(2);
  if (!LOCALE_PAGES.has(rest[0] ?? "") && !meError) {
    if (me === undefined) return <Spinner />;
    const key = me ? companyPathKey(me.companySlug, me.activeCompanyId) : null;
    if (key) return <Navigate to={`/${key}/${rest.join("/")}${location.search}${location.hash}`} replace />;
  }
  return <>{children}</>;
}

function CompanySegment({ companyKey, children }: { companyKey: string; children: ReactNode }) {
  setCompanyContext(companyKey);
  const location = useLocation();
  const me = useCurrentUser();
  const meError = useMeError();

  if (meError instanceof ApiError && (meError.details as { reason?: string } | undefined)?.reason === "company_access_denied") {
    return <CompanyAccessDenied companyKey={companyKey} />;
  }
  // Kanonik manzil: id yoki eski slug bilan ochilgan bo'lsa — joriy slug'ga
  const canonical = me ? companyPathKey(me.companySlug, me.activeCompanyId) : null;
  if (canonical && canonical !== companyKey) {
    const rest = location.pathname.split("/").slice(2).join("/");
    return <Navigate to={`/${canonical}/${rest}${location.search}${location.hash}`} replace />;
  }
  return <>{children}</>;
}

function CompanyAccessDenied({ companyKey }: { companyKey: string }) {
  // O'z bizneslari ro'yxati — URL'dagi (kirish yo'q) biznes kontekstisiz
  const companies = useQuery<{ companies: MyCompany[] }, ApiError>({
    queryKey: ["/api/company/mine", {}, null],
    queryFn: ({ signal }) => api.get<{ companies: MyCompany[] }>("/api/company/mine", undefined, signal, null),
  }).data?.companies.filter((company) => company.membershipActive);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-5 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <ShieldX className="h-8 w-8 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Bu biznesga kirishingiz yo'q</h1>
          <p className="mt-1 text-sm text-muted-foreground">«{companyKey}» manzili topilmadi yoki siz bu biznesning faol xodimi emassiz.</p>
        </div>
        {companies && companies.length > 0 && (
          <div className="space-y-2 text-left">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sizning bizneslaringiz</p>
            {companies.map((company) => (
              <Link
                key={company.id}
                to={`/${companyPathKey(company.slug, company.id)}/dashboard`}
                className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{company.name}</span>
              </Link>
            ))}
          </div>
        )}
        <Link to={`/${SAVED_OR_DEFAULT_LOCALE}/login`} className="inline-block text-sm text-primary hover:underline">
          Boshqa hisob bilan kirish
        </Link>
      </div>
    </div>
  );
}

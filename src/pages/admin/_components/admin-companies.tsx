/**
 * Admin Companies — full company list with search, filter, status change, detail drawer
 * API: `GET /api/platform/companies`, `GET /companies/:id`, `POST /companies/:id/status`.
 */
import { useState } from "react";
import {
  Building2, Search, ChevronDown, Users, MapPin, Mail,
  Phone, Globe, Calendar, X, RefreshCw, Link2, Copy, Check, AlertTriangle,
} from "lucide-react";
import {
  LICENSE_STATUS_LABEL, LICENSE_TYPE_LABEL, SUBSCRIPTION_STATUS_LABEL, formatDay,
  type CompanyLicense, type SubscriptionHistory, type SubscriptionOverview, type SubscriptionPayment,
} from "@/lib/subscription.ts";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { toast } from "sonner";
import { format } from "date-fns";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { StatusBadge } from "./admin-overview.tsx";
import type { CompanyStatus, PlatformCompany, PlatformCompanyDetails } from "../_lib/types.ts";

const STATUS_ACTIONS: { label: string; value: CompanyStatus; danger?: boolean }[] = [
  { label: "Aktivlashtirish",  value: "active" },
  { label: "Sinov rejimi",     value: "trial" },
  { label: "Kutilmoqda",       value: "pending" },
  { label: "To'xtatish",       value: "suspended", danger: true },
  { label: "Bekor qilish",     value: "cancelled", danger: true },
];

const BASE_URL = "https://app.bum-erp.uz";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); void copy(); }}
      className="h-6 w-6 rounded flex items-center justify-center bg-white/8 hover:bg-white/15 text-white/40 hover:text-white transition-colors cursor-pointer shrink-0"
      title="Nusxa olish"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export default function AdminCompanies() {
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const companiesQuery = useApiQuery<{ companies: PlatformCompany[] }>("/api/platform/companies");
  const companies = companiesQuery.data?.companies;
  const detail = useApiQuery<PlatformCompanyDetails>(
    selectedId ? `/api/platform/companies/${selectedId}` : null,
  ).data;
  const updateStatus = useApiMutation(
    ({ companyId, status, reason }: { companyId: string; status: CompanyStatus; reason?: string }) =>
      api.post(`/api/platform/companies/${companyId}/status`, { status, reason }),
    { invalidate: ["/api/platform"] },
  );

  const q = search.trim().toLowerCase();
  const filtered = (companies ?? []).filter((c) => {
    const matchSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.slug ?? "").toLowerCase().includes(q) ||
      (c.owner?.phone ?? "").includes(q) ||
      (c.owner?.name ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleStatusChange = async (companyId: string, status: CompanyStatus) => {
    let reason: string | undefined;
    if (status === "suspended") {
      // Sabab kompaniya foydalanuvchilariga to'xtatilgan ekranida ko'rsatiladi
      const input = window.prompt("To'xtatish sababi (ixtiyoriy):");
      if (input === null) return;
      reason = input.trim().slice(0, 500) || undefined;
    }
    try {
      await updateStatus.mutateAsync({ companyId, status, reason });
      toast.success("Holat yangilandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Kompaniyalar</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {companies ? `${companies.length} ta tenant` : "Yuklanmoqda..."}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kompaniya, slug yoki egasi..."
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-primary/50"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["all", "active", "trial", "pending", "suspended", "cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                statusFilter === s
                  ? "bg-primary text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
              }`}
            >
              {s === "all" ? "Barchasi" :
               s === "active" ? "Aktiv" :
               s === "trial" ? "Sinov" :
               s === "pending" ? "Kutilmoqda" :
               s === "suspended" ? "To'xtatilgan" : "Bekor"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/4">
              {["Kompaniya", "Egasi", "Slug / URL", "A'zolar", "Obuna", "Holat", "Amallar"].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-white/40 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companiesQuery.error ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-white/40 text-sm">
                  {errorMessage(companiesQuery.error)}
                </td>
              </tr>
            ) : companies === undefined ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-5 w-full bg-white/5" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-white/30 text-sm">
                  Kompaniyalar topilmadi
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-white/5 hover:bg-white/4 transition-colors cursor-pointer"
                  onClick={() => setSelectedId(c.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{c.name}</p>
                        <p className="text-xs text-white/40">{format(new Date(c.createdAt), "dd.MM.yyyy")}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white/80">{c.owner?.name ?? "—"}</p>
                    <p className="text-xs text-white/40 font-mono">{c.owner?.phone ?? ""}</p>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {c.slug ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            {c.slug}
                          </span>
                          <CopyButton text={c.slug} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`${BASE_URL}/t/${c.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-white/35 hover:text-primary transition-colors flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link2 className="h-2.5 w-2.5" />
                            /t/{c.slug}
                          </a>
                          <CopyButton text={`${BASE_URL}/t/${c.slug}`} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-white/25 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-white/60">
                      <Users className="h-3.5 w-3.5" />
                      <span>{c.memberCount}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.subscription ? (
                      <div className="space-y-0.5">
                        <p className={
                          c.subscription.status === "active" ? "text-green-400"
                            : c.subscription.status === "trial" ? "text-sky-400" : "text-red-400"
                        }>
                          {SUBSCRIPTION_STATUS_LABEL[c.subscription.status]}
                        </p>
                        <p className="text-white/40">{c.subscription.expiresAt ? `${formatDay(c.subscription.expiresAt)} gacha` : "Muddatsiz"}</p>
                        <p className="text-white/40">{c.subscription.usedLicenses}/{c.subscription.includedLicenses} litsenziya</p>
                        {c.subscription.pendingPayments > 0 && (
                          <p className="text-amber-400">{c.subscription.pendingPayments} ta to'lov kutilmoqda</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-white/25">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                    {c.trialEndsAt && c.status === "trial" && (
                      <p className="text-[10px] text-amber-400/70 mt-0.5">
                        {format(new Date(c.trialEndsAt), "dd.MM.yyyy")} gacha
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={updateStatus.isPending}
                          className="h-7 px-2 text-white/50 hover:text-white hover:bg-white/10"
                        >
                          Holat
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {STATUS_ACTIONS.map((a) => (
                          <DropdownMenuItem
                            key={a.value}
                            disabled={a.value === c.status}
                            onClick={() => { void handleStatusChange(c.id, a.value); }}
                            className={a.danger ? "text-destructive focus:text-destructive cursor-pointer" : "cursor-pointer"}
                          >
                            {a.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      {selectedId && (
        <CompanyDetailDrawer
          companyId={selectedId}
          detail={detail}
          onClose={() => setSelectedId(null)}
          onStatusChange={(id, status) => { void handleStatusChange(id, status); }}
        />
      )}
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function CompanyDetailDrawer({
  companyId, detail, onClose, onStatusChange,
}: {
  companyId: string;
  detail: PlatformCompanyDetails | undefined;
  onClose: () => void;
  onStatusChange: (id: string, s: CompanyStatus) => void;
}) {
  const company = detail?.company;
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-[oklch(0.14_0.025_255)] border-l border-white/10 z-50 overflow-y-auto">
        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">
              {company?.name ?? "Yuklanmoqda..."}
            </h2>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg bg-white/8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!detail || !company ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 bg-white/5" />)}
            </div>
          ) : (
            <>
              {/* Status */}
              <div className="flex items-center gap-3">
                <StatusBadge status={company.status} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="secondary" className="h-7 text-xs">
                      <RefreshCw className="h-3 w-3 mr-1.5" />
                      Holat o'zgartirish
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    {STATUS_ACTIONS.map((a) => (
                      <DropdownMenuItem
                        key={a.value}
                        disabled={a.value === company.status}
                        onClick={() => onStatusChange(company.id, a.value)}
                        className={a.danger ? "text-destructive focus:text-destructive cursor-pointer" : "cursor-pointer"}
                      >
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {company.status === "suspended" && company.suspendReason && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{company.suspendReason}</span>
                </div>
              )}

              {/* Info */}
              <InfoSection title="Asosiy ma'lumotlar">
                <InfoRow icon={Building2} label="Yuridik nom" value={company.legalName} />
                <InfoRow icon={Building2} label="STIR"        value={company.taxId} />
                <InfoRow icon={Mail}      label="Email"        value={company.email} />
                <InfoRow icon={Phone}     label="Telefon"      value={company.phone} />
                <InfoRow icon={Globe}     label="Davlat"       value={`${company.country} / ${company.currency}`} />
                <InfoRow icon={MapPin}    label="Shahar"        value={company.city} />
                <InfoRow
                  icon={Building2}
                  label="Egasi"
                  value={detail.owner ? `${detail.owner.name ?? "—"} (${detail.owner.phone})` : "Egasiz"}
                />
                {company.slug && (
                  <div className="flex items-center gap-2 text-sm">
                    <Link2 className="h-3.5 w-3.5 text-white/30 shrink-0" />
                    <span className="text-white/40 text-xs w-24 shrink-0">Tenant URL</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <a
                        href={`${BASE_URL}/t/${company.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary text-xs hover:underline truncate"
                      >
                        {BASE_URL}/t/{company.slug}
                      </a>
                      <CopyButton text={`${BASE_URL}/t/${company.slug}`} />
                    </div>
                  </div>
                )}
                <InfoRow icon={Calendar}  label="Yaratilgan"    value={format(new Date(company.createdAt), "dd.MM.yyyy HH:mm")} />
                {company.trialEndsAt && (
                  <InfoRow icon={Calendar} label="Sinov tugaydi" value={
                    format(new Date(company.trialEndsAt), "dd.MM.yyyy")
                  } />
                )}
              </InfoSection>

              <CompanySubscriptionSection companyId={companyId} />

              {/* Members */}
              <InfoSection title={`A'zolar (${detail.members.length})`}>
                {detail.members.length === 0 ? (
                  <p className="text-xs text-white/30">A'zolar yo'q</p>
                ) : (
                  <div className="space-y-2">
                    {detail.members.map((m) => (
                      <div key={m.userId} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/4">
                        <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary">
                            {(m.name ?? m.phone)[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{m.name ?? "—"}</p>
                          <p className="text-[11px] text-white/40 truncate font-mono">{m.phone}</p>
                        </div>
                        {!(m.membershipActive && m.userActive) && (
                          <Badge variant="outline" className="text-[10px] shrink-0 border-red-500/30 text-red-400">
                            Bloklangan
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] shrink-0 border-white/15 text-white/50">
                          {m.companyRole}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </InfoSection>

              {/* Branches */}
              <InfoSection title={`Filiallar (${detail.branches.length})`}>
                {detail.branches.length === 0 ? (
                  <p className="text-xs text-white/30">Filiallar yo'q</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.branches.map((b) => (
                      <div key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-white/4 text-xs">
                        <span className="text-white/70">{b.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-white/40">{b.code}</span>
                          {b.isDefault && <span className="text-primary text-[10px]">✓ Asosiy</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </InfoSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}

type CompanySubscriptionDetails = SubscriptionOverview & {
  company: { id: string; name: string };
  licenseList: CompanyLicense[];
  history: SubscriptionHistory;
  payments: SubscriptionPayment[];
};

/** Obuna holati, litsenziyalar va included litsenziyalar sonini o'zgartirish (`PUT .../subscription`). */
function CompanySubscriptionSection({ companyId }: { companyId: string }) {
  const url = `/api/platform/companies/${companyId}/subscription`;
  const query = useApiQuery<CompanySubscriptionDetails>(url);
  const [licensesInput, setLicensesInput] = useState<string | null>(null);
  const save = useApiMutation((includedLicenses: number) => api.put(url, { includedLicenses }), { invalidate: ["/api/platform"] });
  const data = query.data;

  if (query.error) {
    return (
      <InfoSection title="Obuna va litsenziyalar">
        <p className="text-xs text-white/40">{errorMessage(query.error)}</p>
      </InfoSection>
    );
  }
  if (!data) return <Skeleton className="h-24 bg-white/5" />;

  const subscription = data.subscription;
  const counts = data.licenses;
  const value = licensesInput ?? String(subscription?.includedLicenses ?? 3);

  const handleSave = async () => {
    const next = Number(value);
    if (!Number.isInteger(next) || next < 1) {
      toast.error("Litsenziyalar soni butun musbat son bo'lsin");
      return;
    }
    try {
      await save.mutateAsync(next);
      setLicensesInput(null);
      toast.success("Included litsenziyalar soni saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <InfoSection title="Obuna va litsenziyalar">
      {!subscription ? (
        <p className="text-xs text-white/40">Obuna yozuvi yo'q</p>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-white/60 space-y-1">
            <p>
              Holat: <span className="text-white font-medium">{SUBSCRIPTION_STATUS_LABEL[subscription.status]}</span>
              {subscription.planName ? ` · ${subscription.planName}` : ""}
            </p>
            <p>Tugaydi: <span className="text-white">{subscription.expiresAt ? formatDay(subscription.expiresAt) : "Muddatsiz"}</span></p>
            {counts && (
              <p>
                Included: {counts.includedUsed}/{counts.includedTotal} · qo'shimcha: {counts.additionalActive}
                {counts.additionalPending > 0 ? ` (+${counts.additionalPending} to'lov kutmoqda)` : ""}
              </p>
            )}
            {data.pendingPayments.length > 0 && (
              <p className="text-amber-400">{data.pendingPayments.length} ta to'lov so'rovi — "To'lovlar" bo'limida tasdiqlang</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Included litsenziyalar</span>
            <Input
              type="number"
              min={1}
              max={10000}
              value={value}
              onChange={(e) => setLicensesInput(e.target.value)}
              className="h-7 w-20 bg-white/5 border-white/10 text-white text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={save.isPending || Number(value) === subscription.includedLicenses}
              onClick={() => { void handleSave(); }}
            >
              Saqlash
            </Button>
          </div>
          {data.licenseList.length > 0 && (
            <div className="space-y-1">
              {data.licenseList.map((license) => (
                <div key={license.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/4 text-[11px]">
                  <span className="text-white/80 truncate">
                    {license.employeeName ?? license.userName ?? license.userPhone}
                    {license.isOwner ? " (egasi)" : ""}
                  </span>
                  <span className="text-white/40 shrink-0">
                    {LICENSE_TYPE_LABEL[license.licenseType]} · {LICENSE_STATUS_LABEL[license.status]}
                    {license.expiresAt ? ` · ${formatDay(license.expiresAt)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </InfoSection>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wide">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function InfoRow({
  icon: Icon, label, value,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-3.5 w-3.5 text-white/30 shrink-0" />
      <span className="text-white/40 text-xs w-24 shrink-0">{label}</span>
      <span className="text-white/80 text-xs truncate">{value}</span>
    </div>
  );
}

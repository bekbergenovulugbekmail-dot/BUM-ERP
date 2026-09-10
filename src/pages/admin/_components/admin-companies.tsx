/**
 * Admin Companies — full company list with search, filter, status change, detail drawer
 */
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import {
  Building2, Search, ChevronDown, Users, MapPin, Mail,
  Phone, Globe, Calendar, X, RefreshCw, Link2, Copy, Check,
} from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { toast } from "sonner";
import { StatusBadge } from "./admin-overview.tsx";
import { format } from "date-fns";

type Status = "active" | "trial" | "pending" | "suspended" | "cancelled";

const STATUS_ACTIONS: { label: string; value: Status; danger?: boolean }[] = [
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
  const [selectedId, setSelectedId] = useState<Id<"companies"> | null>(null);

  const companies = useQuery(api.companies.platformListCompanies, {});
  const detail    = useQuery(
    api.companies.platformGetCompany,
    selectedId ? { companyId: selectedId } : "skip",
  );
  const updateStatus = useMutation(api.companies.platformUpdateCompanyStatus);

  const filtered = (companies ?? []).filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.ownerEmail ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleStatusChange = async (companyId: Id<"companies">, status: Status) => {
    try {
      await updateStatus({ companyId, status });
      toast.success("Holat yangilandi");
    } catch {
      toast.error("Xatolik yuz berdi");
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
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kompaniya yoki email..."
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-primary/50"
          />
        </div>
        <div className="flex gap-1.5">
          {["all", "active", "trial", "suspended", "cancelled"].map((s) => (
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
              {["Kompaniya", "Egasi", "Slug / URL", "A'zolar", "Holat", "Amallar"].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-white/40 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies === undefined ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-5 w-full bg-white/5" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/30 text-sm">
                  Kompaniyalar topilmadi
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr
                  key={c._id}
                  className="border-b border-white/5 hover:bg-white/4 transition-colors cursor-pointer"
                  onClick={() => setSelectedId(c._id as Id<"companies">)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{c.name}</p>
                        {c.legalName && <p className="text-xs text-white/40">{c.legalName}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white/80">{c.ownerName ?? "—"}</p>
                    <p className="text-xs text-white/40">{c.ownerEmail ?? ""}</p>
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
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status ?? "trial"} />
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
                            onClick={() => handleStatusChange(c._id as Id<"companies">, a.value)}
                            className={a.danger ? "text-destructive focus:text-destructive" : "cursor-pointer"}
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
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function CompanyDetailDrawer({
  detail, onClose, onStatusChange,
}: {
  companyId: Id<"companies">;
  detail: ReturnType<typeof useQuery<typeof api.companies.platformGetCompany>>;
  onClose: () => void;
  onStatusChange: (id: Id<"companies">, s: Status) => void;
}) {
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
              {detail?.name ?? "Yuklanmoqda..."}
            </h2>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg bg-white/8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!detail ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 bg-white/5" />)}
            </div>
          ) : (
            <>
              {/* Status */}
              <div className="flex items-center gap-3">
                <StatusBadge status={detail.status ?? "trial"} />
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
                        onClick={() => onStatusChange(detail._id as Id<"companies">, a.value)}
                        className={a.danger ? "text-destructive focus:text-destructive cursor-pointer" : "cursor-pointer"}
                      >
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Info */}
              <InfoSection title="Asosiy ma'lumotlar">
                <InfoRow icon={Building2} label="Yuridik nom" value={detail.legalName} />
                <InfoRow icon={Building2} label="STIR"        value={detail.taxId} />
                <InfoRow icon={Mail}      label="Email"        value={detail.email} />
                <InfoRow icon={Phone}     label="Telefon"      value={detail.phone} />
                <InfoRow icon={Globe}     label="Davlat"       value={`${detail.country} / ${detail.currency}`} />
                <InfoRow icon={MapPin}    label="Shahar"        value={detail.city} />
                <InfoRow icon={Building2} label="Egasi"         value={`${detail.ownerName ?? "—"} (${detail.ownerEmail ?? ""})`} />
                {detail.slug && (
                  <div className="flex items-center gap-2 text-sm">
                    <Link2 className="h-3.5 w-3.5 text-white/30 shrink-0" />
                    <span className="text-white/40 text-xs w-24 shrink-0">Tenant URL</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <a
                        href={`${BASE_URL}/t/${detail.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary text-xs hover:underline truncate"
                      >
                        {BASE_URL}/t/{detail.slug}
                      </a>
                      <CopyButton text={`${BASE_URL}/t/${detail.slug}`} />
                    </div>
                  </div>
                )}
                <InfoRow icon={Calendar}  label="Yaratilgan"    value={
                  detail._creationTime
                    ? format(new Date(detail._creationTime), "dd.MM.yyyy HH:mm")
                    : undefined
                } />
                {detail.trialEndsAt && (
                  <InfoRow icon={Calendar} label="Sinov tugaydi" value={
                    format(new Date(detail.trialEndsAt), "dd.MM.yyyy")
                  } />
                )}
              </InfoSection>

              {/* Members */}
              <InfoSection title={`A'zolar (${detail.members.length})`}>
                {detail.members.length === 0 ? (
                  <p className="text-xs text-white/30">A'zolar yo'q</p>
                ) : (
                  <div className="space-y-2">
                    {detail.members.map((m) => (
                      <div key={m._id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/4">
                        <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary">
                            {(m.userName ?? m.userEmail ?? "?")[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{m.userName ?? "—"}</p>
                          <p className="text-[11px] text-white/40 truncate">{m.userEmail}</p>
                        </div>
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
                      <div key={b._id} className="flex items-center justify-between p-2 rounded-lg bg-white/4 text-xs">
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

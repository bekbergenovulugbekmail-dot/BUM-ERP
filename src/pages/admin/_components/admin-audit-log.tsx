/**
 * Admin Audit Log — platform-wide audit trail
 * API: `GET /api/platform/audit-logs` (`(vaqt, id)` kursori). Qidiruv va daraja filtri joriy sahifa ichida.
 */
import { useState } from "react";
import { Search, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { format } from "date-fns";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { formatDetails, type PlatformAuditLog } from "../_lib/types.ts";

const PAGE_SIZE = 200;

const SEVERITY_META = {
  info:    { icon: Info,          color: "text-blue-400",   bg: "bg-blue-400/10" },
  warning: { icon: AlertTriangle, color: "text-amber-400",  bg: "bg-amber-400/10" },
  error:   { icon: AlertCircle,   color: "text-red-400",    bg: "bg-red-400/10" },
};

export default function AdminAuditLog() {
  const [search, setSearch]     = useState("");
  const [severity, setSeverity] = useState("all");
  const [cursor, setCursor]     = useState<string | undefined>(undefined);

  const { data, error } = useApiQuery<{ logs: PlatformAuditLog[]; nextCursor: string | null }>(
    "/api/platform/audit-logs",
    { limit: PAGE_SIZE, cursor },
  );
  const logs = data?.logs;

  const q = search.trim().toLowerCase();
  const filtered = (logs ?? []).filter((l) => {
    const matchSearch =
      !q ||
      l.action.toLowerCase().includes(q) ||
      (l.userName ?? "").toLowerCase().includes(q) ||
      l.companyName.toLowerCase().includes(q);
    const matchSeverity = severity === "all" || l.severity === severity;
    return matchSearch && matchSeverity;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Audit jurnali</h1>
        <p className="text-sm text-white/40 mt-0.5">Platforma bo'ylab barcha harakatlar</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Amal, foydalanuvchi yoki kompaniya..."
            className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>
        <div className="flex gap-1.5">
          {[
            { key: "all",     label: "Barchasi" },
            { key: "info",    label: "Info" },
            { key: "warning", label: "Ogohlantirish" },
            { key: "error",   label: "Xato" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setSeverity(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                severity === s.key
                  ? "bg-primary text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Log list */}
      <div className="rounded-xl border border-white/8 overflow-hidden">
        {error ? (
          <div className="py-12 text-center text-white/40 text-sm">{errorMessage(error)}</div>
        ) : logs === undefined ? (
          <div className="space-y-0">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-white/5 flex gap-3">
                <Skeleton className="h-8 w-8 rounded-lg bg-white/5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48 bg-white/5" />
                  <Skeleton className="h-3 w-80 bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-sm">
            {logs.length === 0 ? "Audit yozuvlari yo'q" : "Topilmadi"}
          </div>
        ) : (
          <div>
            {filtered.map((l) => {
              const meta = SEVERITY_META[l.severity] ?? SEVERITY_META.info;
              const Icon = meta.icon;
              const details = formatDetails(l.details);
              return (
                <div key={l.id} className="flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/3 transition-colors">
                  <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", meta.bg)}>
                    <Icon className={cn("h-4 w-4", meta.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{l.action}</span>
                      <span className="text-xs text-white/40">·</span>
                      <span className="text-xs font-mono text-white/50">{l.resource}</span>
                      <span className="text-xs text-white/40">·</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-white/8 text-white/60">{l.companyName}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {l.userName && (
                        <span className="text-xs text-white/40">{l.userName}</span>
                      )}
                      {l.ipAddress && (
                        <span className="text-xs text-white/25 font-mono">{l.ipAddress}</span>
                      )}
                      {details && (
                        <span className="text-xs text-white/30 truncate max-w-xs" title={details}>{details}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-white/30 shrink-0 tabular-nums">
                    {format(new Date(l.occurredAt), "dd.MM.yyyy HH:mm")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(cursor || data?.nextCursor) && (
        <div className="flex justify-end gap-2">
          {cursor && (
            <Button variant="secondary" size="sm" onClick={() => setCursor(undefined)}>
              Boshiga
            </Button>
          )}
          {data?.nextCursor && (
            <Button variant="secondary" size="sm" onClick={() => setCursor(data.nextCursor ?? undefined)}>
              Keyingi sahifa
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

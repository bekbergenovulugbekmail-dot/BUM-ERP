/**
 * Kompaniya audit jurnali — `GET /api/company/audit-logs` (`audit.view`), `(vaqt, id)` kursori bilan sahifalanadi.
 */
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import { ShieldCheck, ShieldAlert, Info } from "lucide-react";
import { formatAuditDetails, type AuditLog } from "../_lib/types.ts";

const PAGE_SIZE = 100;

const SEVERITY_CONFIG = {
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10", label: "Ma'lumot" },
  warning: { icon: ShieldAlert, color: "text-amber-500", bg: "bg-amber-500/10", label: "Ogohlantirish" },
  error: { icon: ShieldCheck, color: "text-rose-500", bg: "bg-rose-500/10", label: "Xatolik" },
};

const ACTION_COLORS: Record<string, string> = {
  create: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400",
  update: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
  delete: "text-rose-600 bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400",
  login: "text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400",
  approve: "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
};

/** Server amallari "ROLE_CREATED", "login_success" kabi — rang kalit so'z bo'yicha. */
function actionColor(action: string): string {
  const lower = action.toLowerCase();
  const key = Object.keys(ACTION_COLORS).find((k) => lower.includes(k));
  return key ? ACTION_COLORS[key]! : "text-muted-foreground bg-muted";
}

export default function AuditLogSection() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, error } = useApiQuery<{ logs: AuditLog[]; nextCursor: string | null }>(
    "/api/company/audit-logs",
    { limit: PAGE_SIZE, cursor },
  );
  const logs = data?.logs;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Audit jurnali</p>
        <p className="text-xs text-muted-foreground">Tizimda amalga oshirilgan barcha amallar tarixi</p>
      </div>

      {error ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground text-sm">
          {error.status === 403 ? "Audit jurnalini ko'rish uchun ruxsat yo'q" : errorMessage(error)}
        </div>
      ) : !logs ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : logs.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground text-sm">
          Audit yozuvlari hali yo'q
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Vaqt</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Foydalanuvchi</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Amal</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Resurs</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium hidden md:table-cell">Tafsilot</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Daraja</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => {
                const sev = SEVERITY_CONFIG[log.severity] ?? SEVERITY_CONFIG.info;
                const details = formatAuditDetails(log.details);
                return (
                  <tr key={log.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.occurredAt).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-xs">{log.userName ?? "Tizim"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", actionColor(log.action))}>{log.action}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="font-medium">{log.resource}</span>
                      {log.resourceId && <span className="text-muted-foreground ml-1">#{log.resourceId.slice(-6)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate hidden md:table-cell" title={details ?? undefined}>
                      {details ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className={cn("h-5 w-5 rounded mx-auto flex items-center justify-center", sev.bg)} title={sev.label}>
                        <sev.icon className={cn("h-3 w-3", sev.color)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

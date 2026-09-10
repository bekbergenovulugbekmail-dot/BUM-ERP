import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { ShieldCheck, ShieldAlert, Info } from "lucide-react";

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

export default function AuditLogSection() {
  const logs = useQuery(api.admin.listAuditLogs, { limit: 100 });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">Audit jurnali</p>
        <p className="text-xs text-muted-foreground">Tizimda amalga oshirilgan barcha amallar tarixi</p>
      </div>

      {!logs ? (
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
                const sev = SEVERITY_CONFIG[log.severity];
                const actionColor = ACTION_COLORS[log.action] ?? "text-muted-foreground bg-muted";
                return (
                  <tr key={log._id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-xs">{log.userName ?? "Tizim"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", actionColor)}>{log.action}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="font-medium">{log.resource}</span>
                      {log.resourceId && <span className="text-muted-foreground ml-1">#{log.resourceId.slice(-6)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate hidden md:table-cell">
                      {log.details ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className={cn("h-5 w-5 rounded mx-auto flex items-center justify-center", sev.bg)}>
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
    </div>
  );
}

/**
 * Admin Overview — stat cards + recent companies + quick chart
 * API: `GET /api/platform/stats`, `GET /api/platform/companies`.
 */
import { Building2, Users, Activity, TrendingUp, CheckCircle, Clock, PauseCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { errorMessage } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";
import type { PlatformCompany, PlatformStats } from "../_lib/types.ts";

const STATUS_META: Record<string, { label: string; color: string; icon: React.FC<{ className?: string }>; hex: string }> = {
  active:    { label: "Aktiv",       color: "text-green-400",  icon: CheckCircle,  hex: "#22c55e" },
  trial:     { label: "Sinov",       color: "text-blue-400",   icon: Clock,        hex: "#60a5fa" },
  pending:   { label: "Kutilmoqda",  color: "text-violet-400", icon: Clock,        hex: "#a78bfa" },
  suspended: { label: "To'xtatilgan",color: "text-amber-400",  icon: PauseCircle,  hex: "#f59e0b" },
  cancelled: { label: "Bekor",       color: "text-red-400",    icon: XCircle,      hex: "#ef4444" },
};

export default function AdminOverview() {
  const statsQuery = useApiQuery<PlatformStats>("/api/platform/stats");
  const companies = useApiQuery<{ companies: PlatformCompany[] }>("/api/platform/companies").data?.companies;
  const stats = statsQuery.data;

  if (statsQuery.error) {
    return <div className="text-center text-white/40 py-20">{errorMessage(statsQuery.error)}</div>;
  }
  if (stats === undefined) return <OverviewSkeleton />;

  const pieData = Object.entries(stats.byStatus)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: STATUS_META[k]?.label ?? k, value: v, color: STATUS_META[k]?.hex ?? "#888" }));

  const recentCompanies = (companies ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Platforma statistikasi</h1>
        <p className="text-sm text-white/40 mt-0.5">Barcha tenantlar bo'yicha umumiy ko'rsatkichlar</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Jami kompaniyalar",   value: stats.totalCompanies,  icon: Building2,  color: "from-blue-600/20 to-blue-600/5",  iconColor: "text-blue-400" },
          { label: "Jami foydalanuvchilar",value: stats.totalUsers,     icon: Users,      color: "from-green-600/20 to-green-600/5", iconColor: "text-green-400" },
          { label: "A'zoliklar",           value: stats.totalMembers,   icon: Activity,   color: "from-purple-600/20 to-purple-600/5",iconColor: "text-purple-400" },
          { label: "Aktiv kompaniyalar",   value: stats.byStatus.active, icon: TrendingUp, color: "from-amber-600/20 to-amber-600/5", iconColor: "text-amber-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-white/5 border-white/8 overflow-hidden relative">
            <div className={`absolute inset-0 bg-gradient-to-br ${s.color} pointer-events-none`} />
            <CardContent className="pt-5 pb-4 relative">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-white/50">{s.label}</p>
                  <p className="text-3xl font-bold text-white mt-1">{s.value}</p>
                </div>
                <div className={`h-9 w-9 rounded-xl bg-white/8 flex items-center justify-center ${s.iconColor}`}>
                  <s.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart + recent companies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pie chart */}
        <Card className="bg-white/5 border-white/8">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white/80">Holat bo'yicha taqsimot</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "oklch(0.17 0.025 255)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                      formatter={(v) => [Number(v), ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-1">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                        <span className="text-white/60">{d.name}</span>
                      </div>
                      <span className="text-white font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-40 flex items-center justify-center text-white/30 text-sm">Ma'lumot yo'q</div>
            )}
          </CardContent>
        </Card>

        {/* Recent companies */}
        <Card className="bg-white/5 border-white/8 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white/80">So'nggi kompaniyalar</CardTitle>
          </CardHeader>
          <CardContent>
            {companies === undefined ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 bg-white/5" />)}
              </div>
            ) : recentCompanies.length === 0 ? (
              <div className="text-center text-white/30 text-sm py-8">Hali kompaniyalar yo'q</div>
            ) : (
              <div className="space-y-2">
                {recentCompanies.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/4 hover:bg-white/8 transition-colors">
                    <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{c.name}</p>
                      <p className="text-xs text-white/40 truncate">
                        {c.owner ? `${c.owner.name ?? "—"} · ${c.owner.phone}` : "Egasiz"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-white/40">{c.memberCount} a'zo</span>
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status breakdown row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Object.entries(STATUS_META).map(([key, meta]) => {
          const count = stats.byStatus[key as keyof typeof stats.byStatus] ?? 0;
          return (
            <div key={key} className="flex items-center gap-3 p-3 rounded-xl bg-white/4 border border-white/8">
              <meta.icon className={`h-5 w-5 ${meta.color} shrink-0`} />
              <div>
                <p className={`text-lg font-bold ${meta.color}`}>{count}</p>
                <p className="text-xs text-white/40">{meta.label}</p>
              </div>
            </div>
          );
        })}
      </div>
      {/* Eski "eskirgan ma'lumotlarni belgilash" paneli olib tashlandi — PostgreSQL'da kompaniyasiz yozuv bo'lmaydi */}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  if (!meta) return <Badge variant="outline" className="text-xs">{status}</Badge>;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
      status === "active"    ? "bg-green-500/10 border-green-500/30 text-green-400" :
      status === "trial"     ? "bg-blue-500/10 border-blue-500/30 text-blue-400" :
      status === "pending"   ? "bg-violet-500/10 border-violet-500/30 text-violet-400" :
      status === "suspended" ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                               "bg-red-500/10 border-red-500/30 text-red-400"
    }`}>
      {meta.label}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64 bg-white/10" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 bg-white/5" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-64 bg-white/5" />
        <Skeleton className="h-64 bg-white/5 col-span-2" />
      </div>
    </div>
  );
}

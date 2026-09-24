import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { buildAgentRows, dayTotals, DAY_NAMES, offScheduleRoutes } from "../_lib/schedule.ts";
import type { DistributionRoute } from "../_lib/types.ts";

/**
 * Haftalik panorama: qator — agent, ustun — hafta kuni, katak — o'sha kuni yuriladigan
 * marshrutlar va do'konlar soni. Bo'sh kun, ikkilangan kun va kunlik yuk bir qarashda ko'rinadi.
 * Hisob-kitobi `_lib/schedule.ts` da — shu yerda faqat ko'rinish.
 */

type Props = {
  routes: DistributionRoute[];
  selectedRouteId?: string;
  onPick: (routeId: string) => void;
};

export default function WeeklyScheduleGrid({ routes, selectedRouteId, onPick }: Props) {
  const rows = buildAgentRows(routes);
  const offSchedule = offScheduleRoutes(routes);
  const totals = dayTotals(routes);

  if (rows.length === 0 && offSchedule.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
          Haftalik panorama — {rows.length} ta agent
        </div>
        {/* 7 ustun telefonga sig'maydi, shuning uchun faqat shu blok yon tomonga suriladi */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-semibold">Agent</th>
                {DAY_NAMES.map((name, day) => (
                  <th key={name} className="px-2 py-2 text-left font-semibold">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 align-top">
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">
                    <span className="block truncate">{row.name}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">{row.stores} do'kon/hafta</span>
                  </th>
                  {row.perDay.map((onDay, day) => (
                    <td
                      key={day}
                      className={cn(
                        "px-2 py-2",
                        onDay.length > 1 && "bg-amber-500/10",
                        onDay.length === 0 && "bg-muted/20",
                      )}
                    >
                      {onDay.length === 0 ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <div className="space-y-1">
                          {onDay.map((route) => (
                            <button
                              key={route.id}
                              type="button"
                              onClick={() => onPick(route.id)}
                              title={`${route.name} — ${route.customerCount} ta do'kon`}
                              className={cn(
                                "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent cursor-pointer",
                                selectedRouteId === route.id && "bg-primary/15 ring-1 ring-primary",
                              )}
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: route.color ?? "#6366f1" }} />
                              <span className="min-w-0 flex-1 truncate">{route.name}</span>
                              <span className="shrink-0 text-muted-foreground">{route.customerCount}</span>
                            </button>
                          ))}
                          {onDay.length > 1 && (
                            <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              {onDay.reduce((sum, route) => sum + route.customerCount, 0)} do'kon
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-semibold">Kunlik yuk</th>
                {totals.map((total, day) => (
                  <td key={day} className="px-2 py-2 text-muted-foreground">
                    {total.routes === 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">hech kim</span>
                    ) : (
                      <>
                        {total.stores} do'kon
                        <span className="block text-[11px]">
                          {total.agents} agent · {total.routes} marshrut
                        </span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {offSchedule.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Jadvalga tushmagan {offSchedule.length} ta marshrut — agentga hech qachon chiqmaydi
          </p>
          <div className="mt-2 space-y-1">
            {offSchedule.map((route) => (
              <button
                key={route.id}
                type="button"
                onClick={() => onPick(route.id)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent cursor-pointer"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: route.color ?? "#6366f1" }} />
                <span className="min-w-0 flex-1 truncate">{route.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {!route.salesRepId ? "agent belgilanmagan" : "hafta kuni belgilanmagan"} · {route.customerCount} do'kon
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

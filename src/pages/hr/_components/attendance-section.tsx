import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import {
  localIsoDate, toNum, trimQty,
  type AttendanceRecord, type AttendanceStats, type AttendanceStatus, type Employee,
} from "../_lib/types.ts";

const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; color: string }> = {
  present: { label: "Keldi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  absent: { label: "Kelmadi", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
  late: { label: "Kechikdi", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  half_day: { label: "Yarim kun", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  holiday: { label: "Dam olish", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  on_leave: { label: "Ta'tilda", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

type BulkBody = { date: string; records: { employeeId: string; status: AttendanceStatus }[] };

export default function AttendanceSection() {
  const today = localIsoDate();
  const thisMonth = today.slice(0, 7);
  const { can } = usePermissions();
  const canRecord = can("hr.attendance");

  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(thisMonth);
  const [bulkOpen, setBulkOpen] = useState(false);

  const attendance = useApiQuery<{ attendance: AttendanceRecord[] }>(
    selectedDate ? "/api/hr/attendance" : null,
    { date: selectedDate },
  ).data?.attendance;
  const monthStats = useApiQuery<AttendanceStats>(
    /^\d{4}-\d{2}$/.test(month) ? "/api/hr/attendance/stats" : null,
    { month },
  ).data;
  const employees = useApiQuery<{ employees: Employee[] }>("/api/hr/employees", { status: "active" }).data?.employees;

  const bulkRecord = useApiMutation((body: BulkBody) => api.put<{ processed: number }>("/api/hr/attendance/bulk", body));

  // For bulk attendance form
  const [bulkStatuses, setBulkStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [bulkDate, setBulkDate] = useState(today);

  const openBulk = (date: string) => {
    setBulkDate(date);
    setBulkStatuses(Object.fromEntries((employees ?? []).map((e) => [e.id, "present" as const])));
    setBulkOpen(true);
  };

  const handleBulkSave = async () => {
    if (!employees || employees.length === 0) { toast.error("Xodimlar topilmadi"); return; }
    try {
      // Soatlar serverda holatdan: to'liq kun 8, yarim kun 4, kelmagan/dam/ta'til 0
      const { processed } = await bulkRecord.mutateAsync({
        date: bulkDate,
        records: employees.map((emp) => ({ employeeId: emp.id, status: bulkStatuses[emp.id] ?? "present" })),
      });
      toast.success(`${processed} ta xodim davomati qayd etildi`);
      setBulkOpen(false);
      setSelectedDate(bulkDate);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      {/* Month stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Keldi", value: monthStats?.present ?? 0 },
          { label: "Kelmadi", value: monthStats?.absent ?? 0 },
          { label: "Kechikdi", value: monthStats?.late ?? 0 },
          { label: "Jami soat", value: `${Math.round(toNum(monthStats?.totalHours))}` },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn("text-xl font-bold mt-0.5")}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Sana:</Label>
          <Input type="date" className="w-40 h-8 text-sm" value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Oy statistikasi:</Label>
          <Input type="month" className="w-36 h-8 text-sm" value={month}
            onChange={(e) => setMonth(e.target.value)} />
        </div>
        {canRecord && (
          <div className="ml-auto">
            <Button size="sm" onClick={() => openBulk(today)}>
              <CalendarDays className="h-3.5 w-3.5 mr-1" /> Davomat belgilash
            </Button>
          </div>
        )}
      </div>

      {/* Daily attendance list */}
      {!attendance ? (
        <div className="space-y-1">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : attendance.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-20" />
          <p className="text-sm">{selectedDate} kuni uchun davomat ma'lumoti yo'q</p>
          {canRecord && (
            <Button size="sm" className="mt-3" variant="secondary" onClick={() => openBulk(selectedDate)}>
              <Plus className="h-4 w-4 mr-1" /> Davomat kiritish
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Xodim</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Bo'lim</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Holat</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Kelish</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Ketish</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Soat</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Qo'shimcha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attendance.map((rec) => {
                const st = ATTENDANCE_STATUS[rec.status];
                return (
                  <tr key={rec.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{rec.employeeName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{rec.departmentName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", st.color)}>{st.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{rec.checkIn?.slice(0, 5) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{rec.checkOut?.slice(0, 5) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">{trimQty(rec.workHours)}h</td>
                    <td className="px-4 py-2.5 text-right text-amber-600">{toNum(rec.overtime) > 0 ? `+${trimQty(rec.overtime)}h` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk attendance dialog */}
      {bulkOpen && (
        <Dialog open onOpenChange={(o) => !o && setBulkOpen(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Davomat belgilash</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <Label>Sana</Label>
                <Input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                {(employees ?? []).map((emp) => (
                  <div key={emp.id} className="flex items-center gap-3 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.departmentName ?? "—"}</p>
                    </div>
                    <Select
                      value={bulkStatuses[emp.id] ?? "present"}
                      onValueChange={(v) => setBulkStatuses({ ...bulkStatuses, [emp.id]: v as AttendanceStatus })}
                    >
                      <SelectTrigger className="w-36 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ATTENDANCE_STATUS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setBulkOpen(false)}>Bekor</Button>
              <Button onClick={handleBulkSave} disabled={bulkRecord.isPending}>{bulkRecord.isPending ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

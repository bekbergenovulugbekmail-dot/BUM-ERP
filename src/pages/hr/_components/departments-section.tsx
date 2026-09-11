import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Building2, Users } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { fmt, toNum, type Department, type Position } from "../_lib/types.ts";

type DepartmentBody = { name: string; code: string };
type PositionBody = {
  departmentId: string;
  name: string;
  level: string | null;
  minSalary: string | null;
  maxSalary: string | null;
};

export default function DepartmentsSection() {
  const { can } = usePermissions();
  const canManage = can("hr.manage");

  const departments = useApiQuery<{ departments: Department[] }>("/api/hr/departments").data?.departments;
  const positions = useApiQuery<{ positions: Position[] }>("/api/hr/positions").data?.positions;

  const createDept = useApiMutation((body: DepartmentBody) => api.post("/api/hr/departments", body));
  const deleteDept = useApiMutation((id: string) => api.delete(`/api/hr/departments/${id}`));
  const createPos = useApiMutation((body: PositionBody) => api.post("/api/hr/positions", body));
  const deletePos = useApiMutation((id: string) => api.delete(`/api/hr/positions/${id}`));

  const [deptOpen, setDeptOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: "", code: "" });
  const [posForm, setPosForm] = useState({ name: "", departmentId: "", level: "", minSalary: "", maxSalary: "" });

  const handleCreateDept = async () => {
    if (!deptForm.name.trim() || !deptForm.code.trim()) { toast.error("Nom va kod kiritilishi shart"); return; }
    try {
      await createDept.mutateAsync({ name: deptForm.name.trim(), code: deptForm.code.trim() });
      toast.success("Bo'lim qo'shildi");
      setDeptOpen(false);
      setDeptForm({ name: "", code: "" });
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleCreatePos = async () => {
    if (!posForm.name.trim() || !posForm.departmentId) {
      toast.error("Nom va bo'lim kiritilishi shart"); return;
    }
    try {
      await createPos.mutateAsync({
        name: posForm.name.trim(),
        departmentId: posForm.departmentId,
        level: posForm.level.trim() || null,
        minSalary: posForm.minSalary || null,
        maxSalary: posForm.maxSalary || null,
      });
      toast.success("Lavozim qo'shildi");
      setPosOpen(false);
      setPosForm({ name: "", departmentId: "", level: "", minSalary: "", maxSalary: "" });
    } catch (e) { toast.error(errorMessage(e)); }
  };

  // Xodimi yoki lavozimi bor bo'lim/lavozim server tomonidan rad etiladi (faolsizlantirish kerak)
  const handleDelete = async (kind: "dept" | "pos", id: string) => {
    if (!confirm("O'chirishni tasdiqlaysizmi?")) return;
    try {
      await (kind === "dept" ? deleteDept : deletePos).mutateAsync(id);
      toast.success("O'chirildi");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const loading = createDept.isPending || createPos.isPending;

  return (
    <div className="space-y-6">
      {/* Departments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Bo'limlar
          </h3>
          {canManage && (
            <Button size="sm" onClick={() => setDeptOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Bo'lim qo'shish
            </Button>
          )}
        </div>
        {!departments ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : departments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Bo'limlar yo'q
          </div>
        ) : (
          <div className="space-y-2">
            {departments.map((dept) => (
              <div key={dept.id} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{dept.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {dept.code} · {dept.employeeCount} xodim · {dept.positionCount} lavozim
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                    onClick={() => handleDelete("dept", dept.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Lavozimlar
          </h3>
          {canManage && (
            <Button size="sm" onClick={() => setPosOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Lavozim qo'shish
            </Button>
          )}
        </div>
        {!positions ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : positions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Lavozimlar yo'q</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Lavozim</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Bo'lim</th>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Daraja</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Min maosh</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Max maosh</th>
                  <th className="w-10 px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {positions.map((pos) => (
                  <tr key={pos.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{pos.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{pos.departmentName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{pos.level ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">{toNum(pos.minSalary) > 0 ? `${fmt(pos.minSalary)} so'm` : "—"}</td>
                    <td className="px-4 py-2.5 text-right">{toNum(pos.maxSalary) > 0 ? `${fmt(pos.maxSalary)} so'm` : "—"}</td>
                    <td className="px-2 py-2.5 text-right">
                      {canManage && (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleDelete("pos", pos.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create dept dialog */}
      {deptOpen && (
        <Dialog open onOpenChange={(o) => !o && setDeptOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi bo'lim qo'shish</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Bo'lim nomi *</Label><Input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="Savdo bo'limi" /></div>
              <div><Label>Kod *</Label><Input value={deptForm.code} onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })} placeholder="SALES" /></div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeptOpen(false)}>Bekor</Button>
              <Button onClick={handleCreateDept} disabled={loading}>{loading ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create position dialog */}
      {posOpen && (
        <Dialog open onOpenChange={(o) => !o && setPosOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Yangi lavozim qo'shish</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Lavozim nomi *</Label><Input value={posForm.name} onChange={(e) => setPosForm({ ...posForm, name: e.target.value })} placeholder="Savdo menejeri" /></div>
              <div>
                <Label>Bo'lim *</Label>
                <Select value={posForm.departmentId || "none"} onValueChange={(v) => setPosForm({ ...posForm, departmentId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanlang —</SelectItem>
                    {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Daraja</Label><Input value={posForm.level} onChange={(e) => setPosForm({ ...posForm, level: e.target.value })} placeholder="Senior, Junior..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Min maosh (so'm)</Label><Input type="number" min="0" value={posForm.minSalary} onChange={(e) => setPosForm({ ...posForm, minSalary: e.target.value })} placeholder="2000000" /></div>
                <div><Label>Max maosh (so'm)</Label><Input type="number" min="0" value={posForm.maxSalary} onChange={(e) => setPosForm({ ...posForm, maxSalary: e.target.value })} placeholder="8000000" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setPosOpen(false)}>Bekor</Button>
              <Button onClick={handleCreatePos} disabled={loading}>{loading ? "..." : "Saqlash"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

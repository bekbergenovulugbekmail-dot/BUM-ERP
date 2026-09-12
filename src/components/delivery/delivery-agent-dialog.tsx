/**
 * "Dostavka agenti qo'shish" / tahrirlash (`delivery.manage`). Yaratishda server bitta tranzaksiyada login (telefon +
 * argon2 parol), "Dostavka agenti" rolidagi a'zolik, HR xodimi ("Logistika") va yetkazuvchi profilini yaratadi.
 * Ism va telefon foydalanuvchida saqlanadi — profil ularni takrorlamaydi.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { DELIVERY_VEHICLE_TYPES, type DeliveryVehicleType } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { api } from "@/lib/api.ts";
import { deliveryErrorMessage } from "@/lib/delivery/errors.ts";
import type { DeliveryAgentRow } from "@/lib/delivery/types.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Supervisor = { userId: string; name: string | null; phone: string; companyRole: string };
type Branch = { id: string; name: string; isActive?: boolean };

const NONE = "none";
const MIN_PASSWORD = 8;
/** Dushanbadan boshlab (0 — yakshanba). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const LOAD_RE = /^\d{1,8}(\.\d{1,2})?$/;

export default function DeliveryAgentDialog({ agent, onClose }: { agent?: DeliveryAgentRow; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const editing = agent !== undefined;
  const [form, setForm] = useState(() => ({
    name: "",
    phone: "",
    password: "",
    hireDate: "",
    supervisorUserId: agent?.supervisorUserId ?? NONE,
    branchId: agent?.branchId ?? NONE,
    territory: agent?.territory ?? "",
    deliveryZone: agent?.deliveryZone ?? "",
    vehicleType: (agent?.vehicleType ?? NONE) as DeliveryVehicleType | typeof NONE,
    vehicleNumber: agent?.vehicleNumber ?? "",
    maxLoadKg: agent?.maxLoadKg ? String(Number(agent.maxLoadKg)) : "",
    days: agent?.workingSchedule?.days ?? ([] as number[]),
    start: agent?.workingSchedule?.start ?? "09:00",
    end: agent?.workingSchedule?.end ?? "18:00",
    notes: agent?.notes ?? "",
  }));
  const supervisors = useApiQuery<{ supervisors: Supervisor[] }>("/api/delivery/agents/supervisors").data?.supervisors;
  const branches = useApiQuery<{ branches: Branch[] }>("/api/company/branches").data?.branches;
  const save = useApiMutation(
    (body: Record<string, unknown>) => (editing ? api.patch(`/api/delivery/agents/${agent.id}`, body) : api.post("/api/delivery/agents", body)),
    { invalidate: ["/api/delivery", "/api/hr"] },
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleDay = (day: number, checked: boolean) =>
    setForm((current) => ({ ...current, days: checked ? [...new Set([...current.days, day])].sort() : current.days.filter((item) => item !== day) }));

  const submit = async () => {
    if (!editing && (!form.name.trim() || !form.phone.trim() || !form.password)) {
      toast.error(t("agents.required"));
      return;
    }
    if (!editing && form.password.length < MIN_PASSWORD) {
      toast.error(t("agents.password_short", { min: MIN_PASSWORD }));
      return;
    }
    if (form.maxLoadKg && (!LOAD_RE.test(form.maxLoadKg) || Number(form.maxLoadKg) <= 0)) {
      toast.error(t("agents.max_load_invalid"));
      return;
    }
    if (form.days.length > 0 && form.start >= form.end) {
      toast.error(t("agents.schedule_invalid"));
      return;
    }
    const profile = {
      supervisorUserId: form.supervisorUserId === NONE ? null : form.supervisorUserId,
      branchId: form.branchId === NONE ? null : form.branchId,
      territory: form.territory.trim() || null,
      deliveryZone: form.deliveryZone.trim() || null,
      vehicleType: form.vehicleType === NONE ? null : form.vehicleType,
      vehicleNumber: form.vehicleNumber.trim() || null,
      maxLoadKg: form.maxLoadKg || null,
      workingSchedule: form.days.length > 0 ? { days: form.days, start: form.start, end: form.end } : null,
      notes: form.notes.trim() || null,
    };
    try {
      await save.mutateAsync(
        editing
          ? profile
          : { ...profile, name: form.name.trim(), phone: form.phone.trim(), password: form.password, ...(form.hireDate ? { hireDate: form.hireDate } : {}) },
      );
      toast.success(editing ? t("agents.updated") : t("agents.created"));
      onClose();
    } catch (error) {
      toast.error(deliveryErrorMessage(error, t));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("agents.edit_title", { name: agent.name ?? agent.code }) : t("agents.add")}</DialogTitle>
          <DialogDescription>{editing ? t("agents.edit_hint") : t("agents.hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!editing && (
            <>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="delivery-agent-name">{t("agents.name")} *</Label>
                <Input id="delivery-agent-name" maxLength={200} value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="delivery-agent-phone">{t("agents.phone")} *</Label>
                <Input
                  id="delivery-agent-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="+998 90 000 00 00"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="delivery-agent-password">{t("agents.password")} *</Label>
                <Input
                  id="delivery-agent-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="delivery-agent-hire">{t("agents.hire_date")}</Label>
                <Input id="delivery-agent-hire" type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label>{t("agents.supervisor")}</Label>
            <Select value={form.supervisorUserId} onValueChange={(value) => set("supervisorUserId", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("agents.no_supervisor")}</SelectItem>
                {supervisors?.map((supervisor) => (
                  <SelectItem key={supervisor.userId} value={supervisor.userId}>
                    {supervisor.name ?? supervisor.phone} · {supervisor.companyRole}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("agents.branch")}</Label>
            <Select value={form.branchId} onValueChange={(value) => set("branchId", value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("agents.no_branch")}</SelectItem>
                {branches
                  ?.filter((branch) => branch.isActive !== false || branch.id === form.branchId)
                  .map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="delivery-agent-territory">{t("agents.territory")}</Label>
            <Input id="delivery-agent-territory" maxLength={100} value={form.territory} onChange={(e) => set("territory", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delivery-agent-zone">{t("agents.zone")}</Label>
            <Input id="delivery-agent-zone" maxLength={200} value={form.deliveryZone} onChange={(e) => set("deliveryZone", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("agents.vehicle_type")}</Label>
            <Select value={form.vehicleType} onValueChange={(value) => set("vehicleType", value as DeliveryVehicleType | typeof NONE)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {DELIVERY_VEHICLE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`vehicle.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="delivery-agent-vehicle-number">{t("agents.vehicle_number")}</Label>
            <Input id="delivery-agent-vehicle-number" maxLength={20} value={form.vehicleNumber} onChange={(e) => set("vehicleNumber", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="delivery-agent-load">{t("agents.max_load")}</Label>
            <Input id="delivery-agent-load" inputMode="decimal" value={form.maxLoadKg} onChange={(e) => set("maxLoadKg", e.target.value)} />
          </div>
          <fieldset className="space-y-2 rounded-xl border border-border p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-medium">{t("agents.schedule")}</legend>
            <div className="flex flex-wrap gap-3">
              {WEEK.map((day) => (
                <label key={day} htmlFor={`delivery-agent-day-${day}`} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Checkbox id={`delivery-agent-day-${day}`} checked={form.days.includes(day)} onCheckedChange={(checked) => toggleDay(day, checked === true)} />
                  {t(`agents.day.${day}`)}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="delivery-agent-start">{t("agents.schedule_start")}</Label>
                <Input id="delivery-agent-start" type="time" disabled={form.days.length === 0} value={form.start} onChange={(e) => set("start", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="delivery-agent-end">{t("agents.schedule_end")}</Label>
                <Input id="delivery-agent-end" type="time" disabled={form.days.length === 0} value={form.end} onChange={(e) => set("end", e.target.value)} />
              </div>
            </div>
          </fieldset>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="delivery-agent-notes">{t("agents.notes")}</Label>
            <Textarea id="delivery-agent-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={save.isPending} onClick={() => void submit()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? t("common.save") : t("agents.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

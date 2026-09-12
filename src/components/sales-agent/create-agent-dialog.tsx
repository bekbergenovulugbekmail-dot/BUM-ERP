import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Supervisor = { userId: string; name: string | null; phone: string; companyRole: string };

const NONE = "none";
const MIN_PASSWORD = 8;

/**
 * "Sotuv agenti qo'shish" (`sales_agent.agents.manage`): server bitta tranzaksiyada login (telefon + parol),
 * "Sotuv agenti" rolidagi a'zolik, HR xodimi va agent profilini yaratadi.
 */
export default function CreateAgentDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("distribution");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    password: "",
    region: "",
    supervisorUserId: NONE,
    monthlyTarget: "",
    hireDate: "",
  });
  const supervisors = useApiQuery<{ supervisors: Supervisor[] }>("/api/sales-agent/team/supervisors").data?.supervisors;
  const create = useApiMutation((body: Record<string, unknown>) => api.post("/api/sales-agent/team", body));

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.password) {
      toast.error(t("team.required"));
      return;
    }
    if (form.password.length < MIN_PASSWORD) {
      toast.error(t("team.password_short"));
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        region: form.region.trim() || null,
        supervisorUserId: form.supervisorUserId === NONE ? null : form.supervisorUserId,
        ...(form.monthlyTarget ? { monthlyTarget: form.monthlyTarget } : {}),
        ...(form.hireDate ? { hireDate: form.hireDate } : {}),
      });
      toast.success(t("team.created"));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("team.title")}</DialogTitle>
          <DialogDescription>{t("team.hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="agent-name">{t("team.name")} *</Label>
            <Input id="agent-name" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-phone">{t("team.phone")} *</Label>
            <Input
              id="agent-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="+998 90 000 00 00"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-password">{t("team.password")} *</Label>
            <Input
              id="agent-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-region">{t("team.region")}</Label>
            <Input id="agent-region" maxLength={100} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("team.supervisor")}</Label>
            <Select value={form.supervisorUserId} onValueChange={(value) => setForm({ ...form, supervisorUserId: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("team.no_supervisor")}</SelectItem>
                {supervisors?.map((supervisor) => (
                  <SelectItem key={supervisor.userId} value={supervisor.userId}>
                    {supervisor.name ?? supervisor.phone} · {supervisor.companyRole}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-target">{t("team.target")}</Label>
            <Input
              id="agent-target"
              type="number"
              min={0}
              value={form.monthlyTarget}
              onChange={(e) => setForm({ ...form, monthlyTarget: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-hire">{t("team.hire_date")}</Label>
            <Input id="agent-hire" type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={onClose}>{t("team.cancel")}</Button>
          <Button disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? "..." : t("team.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Invitations Section — Settings → Takliflar
 * Business Owner / Admin can invite employees by email.
 * Shows pending, accepted, and expired/cancelled invitations.
 */
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog.tsx";
import {
  UserPlus, Mail, Clock, CheckCircle, XCircle, Copy,
  Loader2, RefreshCw, Send,
} from "lucide-react";
import { DEFAULT_ROLES } from "@/lib/permissions.ts";
import type { Id } from "@/convex/_generated/dataModel.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvStatus = "pending" | "accepted" | "expired" | "cancelled";

const STATUS_CONFIG: Record<InvStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: "Kutilmoqda",  color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",  icon: Clock },
  accepted:  { label: "Qabul qilindi", color: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/25", icon: CheckCircle },
  expired:   { label: "Muddati o'tgan", color: "bg-muted text-muted-foreground border-border", icon: Clock },
  cancelled: { label: "Bekor qilindi", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: XCircle },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function InvitationsSection() {
  const invitations   = useQuery(api.companies.listInvitations);
  const branches      = useQuery(api.companies.listBranches);
  const createInvite  = useMutation(api.companies.createInvitation);
  const cancelInvite  = useMutation(api.companies.cancelInvitation);

  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState<"all" | InvStatus>("all");

  const [form, setForm] = useState({
    email:       "",
    phone:       "",
    companyRole: "Kassir",
    branchId:    "" as string,
    message:     "",
  });

  const ROLES = DEFAULT_ROLES.map((r) => r.name);

  const handleCreate = async () => {
    if (!form.email.trim() || !form.companyRole) return;
    setLoading(true);
    try {
      const result = await createInvite({
        email:       form.email.trim(),
        phone:       form.phone || undefined,
        companyRole: form.companyRole,
        branchId:    form.branchId ? form.branchId as Id<"branches"> : undefined,
        message:     form.message || undefined,
      });
      toast.success(`Taklif yaratildi! Token: ${result.token.slice(0, 8)}...`, {
        description: "Foydalanuvchiga taklif havolasini yuboring.",
      });
      setOpen(false);
      setForm({ email: "", phone: "", companyRole: "Kassir", branchId: "", message: "" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Xatolik yuz berdi";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: Id<"invitations">) => {
    try {
      await cancelInvite({ id });
      toast.success("Taklif bekor qilindi");
    } catch {
      toast.error("Xatolik yuz berdi");
    }
  };

  const filtered = (invitations ?? []).filter((inv) =>
    filter === "all" || inv.status === filter,
  );

  const pending = (invitations ?? []).filter((i) => i.status === "pending").length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Xodim takliflari</h3>
          <p className="text-sm text-muted-foreground">
            Email orqali xodimlarni kompaniyaga taklif qiling
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Taklif yuborish
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["all", "pending", "accepted", "cancelled"] as const).map((s) => {
          const count = s === "all"
            ? (invitations ?? []).length
            : (invitations ?? []).filter((i) => i.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={[
                "text-left p-3.5 rounded-xl border transition-colors cursor-pointer",
                filter === s
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border hover:border-primary/30 hover:bg-accent/50",
              ].join(" ")}
            >
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {s === "all" ? "Jami" : STATUS_CONFIG[s as InvStatus].label}
              </div>
            </button>
          );
        })}
      </div>

      {/* List */}
      {invitations === undefined ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Yuklanmoqda...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-dashed border-border">
          <Send className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {filter === "all" ? "Hali taklif yo'q" : `${STATUS_CONFIG[filter as InvStatus]?.label ?? filter} takliflar yo'q`}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            "Taklif yuborish" tugmasini bosing
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const cfg = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.pending;
            const StatusIcon = cfg.icon;
            const isExpired = inv.expiresAt < new Date().toISOString();

            return (
              <div key={inv._id}
                className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors">

                {/* Avatar */}
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-semibold text-primary text-sm">
                  {inv.email[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{inv.email}</span>
                    {inv.phone && <span className="text-xs text-muted-foreground">{inv.phone}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">{inv.companyRole}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(inv._creationTime), "dd.MM.yyyy")}
                    </span>
                    {inv.status === "pending" && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className={`text-xs ${isExpired ? "text-red-500" : "text-muted-foreground"}`}>
                          {isExpired ? "Muddati o'tgan" : `${format(new Date(inv.expiresAt), "dd.MM.yyyy")} gacha`}
                        </span>
                      </>
                    )}
                    {inv.invitedByName && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground">Taklif qildi: {inv.invitedByName}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Status badge */}
                <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${cfg.color}`}>
                  <StatusIcon className="h-3 w-3" />
                  {cfg.label}
                </span>

                {/* Copy token button for pending */}
                {inv.status === "pending" && !isExpired && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    onClick={() => {
                      const link = `${window.location.origin}/invite/${inv.token}`;
                      void navigator.clipboard.writeText(link);
                      toast.success("Havola nusxalandi!");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                )}

                {/* Cancel for pending */}
                {inv.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleCancel(inv._id)}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create invitation dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Xodim taklif qilish
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                placeholder="xodim@company.uz"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefon</Label>
              <Input
                placeholder="+998 90 123 45 67"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rol <span className="text-destructive">*</span></Label>
              <Select value={form.companyRole} onValueChange={(v) => setForm((p) => ({ ...p, companyRole: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Filial</Label>
              <Select value={form.branchId || "none"} onValueChange={(v) => setForm((p) => ({ ...p, branchId: v === "none" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha filiallar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Barcha filiallar</SelectItem>
                  {(branches ?? []).map((b) => (
                    <SelectItem key={b._id} value={b._id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Xabar (ixtiyoriy)</Label>
              <Input
                placeholder="Xush kelibsiz! BUM ERP tizimimizga qo'shiling."
                value={form.message}
                onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
              />
            </div>

            {/* Info note */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary/80">
              <Mail className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Taklif yaratilgandan so'ng havola nusxalashingiz mumkin. Hozircha avtomatik email yuborilmaydi — havolani o'zingiz yuboring.</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Bekor qilish
            </Button>
            <Button onClick={handleCreate} disabled={loading || !form.email.trim()} className="gap-2">
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" />Yaratilmoqda...</>
                : <><Send className="h-4 w-4" />Taklif yaratish</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

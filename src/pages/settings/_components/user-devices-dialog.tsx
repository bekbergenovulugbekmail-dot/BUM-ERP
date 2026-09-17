/**
 * Xodimning ishonchli qurilmalari — `GET/POST /api/company/employees/:userId/devices` (`users.manage`).
 *
 * Login va parolni bilgan begona odam kira olmasligi uchun: birinchi qurilma avtomatik ishonchli,
 * keyingilari "tasdiq kutilmoqda" bo'lib turadi va biznes egasi tasdiqlamaguncha kirish berilmaydi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";

type Device = {
  id: string;
  name: string;
  status: "pending" | "approved" | "revoked";
  userAgent: string | null;
  lastIp: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

const STATUS: Record<Device["status"], { label: string; tone: string }> = {
  pending: { label: "Tasdiq kutilmoqda", tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  approved: { label: "Ishonchli", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  revoked: { label: "Bekor qilingan", tone: "bg-destructive/10 text-destructive" },
};

const when = (value: string) => new Date(value).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" });

export default function UserDevicesDialog({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const path = `/api/company/employees/${userId}/devices`;
  const devices = useApiQuery<{ devices: Device[] }>(path).data?.devices;
  const [names, setNames] = useState<Record<string, string>>({});

  const change = useApiMutation(
    (input: { deviceRowId: string; status: "approved" | "revoked"; name?: string }) =>
      api.post(`${path}/${input.deviceRowId}`, { status: input.status, ...(input.name ? { name: input.name } : {}) }),
    { invalidate: [path] },
  );

  const apply = (device: Device, status: "approved" | "revoked") => {
    const name = names[device.id]?.trim();
    change.mutate(
      { deviceRowId: device.id, status, ...(name && name !== device.name ? { name } : {}) },
      {
        onSuccess: () => toast.success(status === "approved" ? "Qurilma tasdiqlandi" : "Qurilma bekor qilindi"),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="user-devices">
        <DialogHeader>
          <DialogTitle>{userName} — qurilmalari</DialogTitle>
          <DialogDescription>
            Birinchi qurilma avtomatik ishonchli. Yangi qurilmadan kirilsa — siz tasdiqlamaguncha
            kirish berilmaydi, hatto login va parol to'g'ri bo'lsa ham.
          </DialogDescription>
        </DialogHeader>

        {!devices ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : devices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Hali kirilmagan — birinchi kirgan qurilma avtomatik ishonchli bo'ladi.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {devices.map((device) => (
              <div key={device.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    aria-label={`${device.name} nomi`}
                    className="h-8 max-w-52"
                    value={names[device.id] ?? device.name}
                    onChange={(event) => setNames((current) => ({ ...current, [device.id]: event.target.value }))}
                  />
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[device.status].tone)}>
                    {STATUS[device.status].label}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    {device.status !== "approved" && (
                      <Button
                        size="sm"
                        data-testid={`approve-${device.id}`}
                        disabled={change.isPending}
                        onClick={() => apply(device, "approved")}
                      >
                        {change.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Tasdiqlash
                      </Button>
                    )}
                    {device.status === "approved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={change.isPending}
                        onClick={() => apply(device, "revoked")}
                      >
                        <X className="h-3.5 w-3.5" /> Bekor qilish
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 truncate text-xs text-muted-foreground">
                  Oxirgi kirish: {when(device.lastSeenAt)}
                  {device.lastIp ? ` · ${device.lastIp}` : ""}
                  {device.userAgent ? ` · ${device.userAgent.slice(0, 60)}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

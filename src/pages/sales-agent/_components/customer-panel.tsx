import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Camera, Loader2, MapPinned, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import CameraCapture from "@/components/camera-capture.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { usePermissions } from "@/hooks/use-company.ts";
import { api, apiUrl } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { freshPosition, uploadCustomerPhoto, visitErrorMessage } from "../_lib/visit-api.ts";
import type { CustomerHistory, StoreProfile } from "../_lib/types.ts";

const STORE_QUERIES = ["/api/sales-agent/stores", "/api/sales-agent/today", "/api/sales-agent/customers", "/api/sales-agent/debtors"];

type Form = { contactName: string; phone: string; address: string; notes: string };

/** Aloqa ma'lumotlari: mas'ul shaxs, telefon, manzil, izoh (moliyaviy maydonlar — supervayzerda). */
function EditCustomerDialog({ store, onClose }: { store: StoreProfile; onClose: () => void }) {
  const { t } = useTranslation("agent");
  const [form, setForm] = useState<Form>({
    contactName: store.contactName ?? "",
    phone: store.phone ?? "",
    address: store.address ?? "",
    notes: store.notes ?? "",
  });
  const save = useApiMutation((body: Form) => api.patch(`/api/sales-agent/customers/${store.id}`, body), { invalidate: STORE_QUERIES });
  const field = (key: keyof Form) => ({
    id: `customer-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: e.target.value })),
  });

  const submit = async () => {
    try {
      await save.mutateAsync(form);
      toast.success(t("customer.saved"));
      onClose();
    } catch (err) {
      toast.error(visitErrorMessage(err, t));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("customer.edit_title")}</DialogTitle>
          <DialogDescription>{t("customer.edit_hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="customer-contactName">{t("customer.contact")}</Label>
            <Input className="h-11" maxLength={200} {...field("contactName")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer-phone">{t("customer.phone")}</Label>
            <Input className="h-11" type="tel" inputMode="tel" maxLength={20} {...field("phone")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer-address">{t("customer.address")}</Label>
            <Input className="h-11" maxLength={500} {...field("address")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="customer-notes">{t("customer.notes")}</Label>
            <Textarea rows={3} maxLength={1000} {...field("notes")} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" className="h-12" onClick={onClose}>
            {t("customer.cancel")}
          </Button>
          <Button className="h-12" disabled={save.isPending} onClick={() => void submit()}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("customer.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mijoz amallari (ruxsat bo'yicha): tahrirlash, joylashuvni saqlash (yangi GPS, server mijoz yonida ekanini tekshiradi)
 * va vitrina rasmi (faqat kamera). Oxirgi vitrina rasmi ko'rsatiladi.
 */
export default function CustomerPanel({ store, history }: { store: StoreProfile; history: CustomerHistory | undefined }) {
  const { t } = useTranslation("agent");
  const { can } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const locate = useApiMutation(async () => api.put(`/api/sales-agent/customers/${store.id}/location`, await freshPosition()), {
    invalidate: STORE_QUERIES,
  });
  const photo = useApiMutation(async (file: File) => uploadCustomerPhoto(store.id, file, await freshPosition()), { invalidate: STORE_QUERIES });

  const canEdit = can("sales_agent.customer.edit");
  const canLocate = can("sales_agent.customer.location.edit");
  const canPhoto = can("sales_agent.customer.photo.create");
  if (!canEdit && !canLocate && !canPhoto && !history?.photo) return null;

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(visitErrorMessage(err, t));
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      {history?.photo && (
        // Brauzer rasmni o'zi yuklaydi: biznes konteksti sarlavhada emas, manzilda (`apiUrl`)
        <img
          src={apiUrl(`/api/sales-agent/customers/${store.id}/photo`, { v: history.photo.id })}
          alt={t("customer.photo_alt", { name: store.name })}
          className="w-full max-h-56 rounded-xl bg-muted object-cover"
        />
      )}
      {canLocate && !store.latitude && <p className="text-xs text-amber-700 dark:text-amber-400">{t("customer.no_location")}</p>}
      <div className="grid grid-cols-3 gap-2">
        {canEdit && (
          <Button variant="secondary" className="h-14 flex-col gap-1 text-[11px]" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> {t("customer.edit")}
          </Button>
        )}
        {canLocate && (
          <Button
            variant="secondary"
            className="h-14 flex-col gap-1 text-[11px]"
            disabled={locate.isPending}
            onClick={() => void run(() => locate.mutateAsync(), t("customer.location_saved"))}
          >
            {locate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinned className="h-4 w-4" />} {t("customer.location_save")}
          </Button>
        )}
        {canPhoto && (
          <>
            {/* Do'kon rasmi AYNAN shu yerda olinadi — galereyadan eski rasm yuborilmasin */}
            {cameraOpen && (
              <CameraCapture
                title={t("customer.photo_add")}
                busy={photo.isPending}
                onClose={() => setCameraOpen(false)}
                onCapture={async (file) => {
                  await run(() => photo.mutateAsync(file), t("customer.photo_added"));
                  setCameraOpen(false);
                }}
              />
            )}
            <Button
              variant="secondary"
              className="h-14 flex-col gap-1 text-[11px]"
              disabled={photo.isPending}
              data-testid="customer-photo"
              onClick={() => setCameraOpen(true)}
            >
              {photo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {t("customer.photo_add")}
            </Button>
          </>
        )}
      </div>
      {editing && <EditCustomerDialog store={store} onClose={() => setEditing(false)} />}
    </div>
  );
}

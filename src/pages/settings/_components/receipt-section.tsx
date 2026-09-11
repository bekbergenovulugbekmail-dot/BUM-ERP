/**
 * Chek shabloni — `GET /api/company/print-settings`, `PUT /api/company/print-settings/receipt` (`settings.manage`).
 * Chapda sozlamalar, o'ngda jonli ko'rinish — chop etishdagi HTML bilan aynan bir xil.
 */
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Printer, ReceiptText, RotateCcw, Save, Trash2 } from "lucide-react";
import { DEFAULT_RECEIPT_TEMPLATE, RECEIPT_LOGO_MAX_LENGTH, type ReceiptTemplate } from "@bum/shared";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import { PRINT_SETTINGS_PATH, type PrintSettings } from "@/hooks/use-print-settings.ts";
import { buildReceiptHtml, printHtml, sampleReceipt } from "@/lib/print/receipt-html.ts";

type BooleanKey = {
  [K in keyof ReceiptTemplate]: ReceiptTemplate[K] extends boolean ? K : never;
}[keyof ReceiptTemplate];

type Toggle = { key: BooleanKey; label: string; requires?: BooleanKey };

const HEADER_TOGGLES: Toggle[] = [
  { key: "showCompanyName", label: "Kompaniya nomi" },
  { key: "showAddress", label: "Manzil" },
  { key: "showPhone", label: "Telefon" },
  { key: "showTaxId", label: "STIR (INN)" },
];

const BODY_TOGGLES: Toggle[] = [
  { key: "showCashier", label: "Kassir ismi" },
  { key: "showSku", label: "Mahsulot SKU kodi" },
  { key: "showTax", label: "QQS summasi" },
];

const CUSTOMER_TOGGLES: Toggle[] = [
  { key: "showCustomer", label: "Mijoz ismi va telefoni" },
  { key: "showCustomerDebt", label: "Mijozning umumiy qarzi", requires: "showCustomer" },
  { key: "showCustomerBalance", label: "Mijoz balansi", requires: "showCustomer" },
  { key: "showCashback", label: "Keshbek (bonus)" },
];

const FONT_SIZES: { value: ReceiptTemplate["fontSize"]; label: string }[] = [
  { value: "sm", label: "Kichik" },
  { value: "md", label: "O'rta" },
  { value: "lg", label: "Katta" },
];

/** Termal printer uchun: kengligi 384 px gacha kichraytiriladi, shaffof fon oq bo'ladi. */
async function imageToLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("PNG, JPEG yoki WebP rasm tanlang");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 384 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Rasmni o'qib bo'lmadi");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > RECEIPT_LOGO_MAX_LENGTH) dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  if (dataUrl.length > RECEIPT_LOGO_MAX_LENGTH) throw new Error("Rasm juda katta — kichikroq logo tanlang");
  return dataUrl;
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ToggleRow({
  label, checked, onChange, disabled,
}: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function ReceiptSection() {
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const company = useActiveCompany().data?.company;
  const currentUser = useCurrentUser();
  const saved = useApiQuery<PrintSettings>(PRINT_SETTINGS_PATH).data?.receipt;
  // Saqlanmagan o'zgarishlar; null — saqlangan shablon ko'rsatiladi
  const [draft, setDraft] = useState<ReceiptTemplate | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useApiMutation(
    (body: ReceiptTemplate) => api.put<{ receipt: ReceiptTemplate }>("/api/company/print-settings/receipt", body),
    { invalidate: [PRINT_SETTINGS_PATH] },
  );

  const template = draft ?? saved;
  if (!template || !company) return <Skeleton className="h-[600px] rounded-2xl" />;

  const update = (patch: Partial<ReceiptTemplate>) => setDraft({ ...template, ...patch });
  const previewHtml = buildReceiptHtml(
    sampleReceipt(
      { name: company.name, address: company.address, phone: company.phone, taxId: company.taxId },
      currentUser?.name,
    ),
    template,
  );

  const handleLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      update({ logo: await imageToLogo(file), showLogo: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rasmni yuklab bo'lmadi");
    }
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync(template);
      setDraft(null);
      toast.success("Chek shabloni saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const renderToggles = (toggles: Toggle[]) =>
    toggles.map((toggle) => (
      <ToggleRow
        key={toggle.key}
        label={toggle.label}
        checked={template[toggle.key]}
        disabled={toggle.requires ? !template[toggle.requires] : undefined}
        onChange={(value) => update({ [toggle.key]: value })}
      />
    ));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
      <div className="space-y-4 max-w-2xl">
        <div className="flex items-center gap-3 pb-2 border-b border-border">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <ReceiptText className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <p className="font-semibold">Chek shabloni</p>
            <p className="text-xs text-muted-foreground">
              {canManage
                ? "POS kassada chop etiladigan chekning ko'rinishi"
                : "Faqat ko'rish — o'zgartirish uchun ruxsat yo'q"}
            </p>
          </div>
        </div>

        <fieldset disabled={!canManage} className="space-y-4">
          <Group title="Qog'oz">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Qog'oz kengligi</Label>
                <Select
                  value={String(template.paperWidth)}
                  onValueChange={(v) => update({ paperWidth: v === "58" ? 58 : 80 })}
                  disabled={!canManage}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="58">58 mm</SelectItem>
                    <SelectItem value="80">80 mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Shrift o'lchami</Label>
                <Select
                  value={template.fontSize}
                  onValueChange={(v) => update({ fontSize: v as ReceiptTemplate["fontSize"] })}
                  disabled={!canManage}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    {FONT_SIZES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Group>

          <Group title="Logo" description="PNG, JPEG yoki WebP; termal printer uchun avtomatik kichraytiriladi">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="h-20 w-36 shrink-0 rounded-lg border border-dashed border-border bg-white flex items-center justify-center overflow-hidden">
                {template.logo
                  ? <img src={template.logo} alt="Logo" className="max-h-full max-w-full object-contain" />
                  : <span className="text-xs text-muted-foreground">Logo yo'q</span>}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { void handleLogo(e.target.files?.[0]); e.target.value = ""; }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="h-4 w-4 mr-1.5" /> {template.logo ? "Almashtirish" : "Yuklash"}
                  </Button>
                  {template.logo && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => update({ logo: null, showLogo: false })}>
                      <Trash2 className="h-4 w-4 mr-1.5" /> O'chirish
                    </Button>
                  )}
                </div>
                <ToggleRow
                  label="Chekda ko'rsatish"
                  checked={template.showLogo}
                  disabled={!template.logo}
                  onChange={(value) => update({ showLogo: value })}
                />
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Kengligi</span>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={template.logoWidth}
                    onChange={(e) => update({ logoWidth: Number(e.target.value) })}
                    className="flex-1 accent-primary"
                  />
                  <span className="w-10 text-right tabular-nums">{template.logoWidth}%</span>
                </div>
              </div>
            </div>
          </Group>

          <Group title="Sarlavha">
            {renderToggles(HEADER_TOGGLES)}
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="receipt-header">Qo'shimcha matn</Label>
              <Textarea
                id="receipt-header"
                rows={2}
                maxLength={500}
                value={template.headerText}
                onChange={(e) => update({ headerText: e.target.value })}
                placeholder="Masalan: Chilonzor filiali, 09:00 — 22:00"
              />
            </div>
          </Group>

          <Group title="Chek tarkibi">{renderToggles(BODY_TOGGLES)}</Group>

          <Group title="Mijoz ma'lumotlari" description="Mijoz tanlangan cheklarda chiqadi">
            {renderToggles(CUSTOMER_TOGGLES)}
          </Group>

          <Group title="Pastki qism">
            <Textarea
              rows={3}
              maxLength={1000}
              value={template.footerText}
              onChange={(e) => update({ footerText: e.target.value })}
              placeholder="Xaridingiz uchun rahmat!"
            />
          </Group>

          <Group
            title="Chop etish"
            description="Brauzer chop etish oynasi ochiladi. Oynasiz chop etish uchun Chrome'ni --kiosk-printing bilan ishga tushiring."
          >
            <ToggleRow
              label="Sotuv yakunlanganda avtomatik chop etish"
              checked={template.autoPrint}
              onChange={(value) => update({ autoPrint: value })}
            />
          </Group>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button onClick={() => { void handleSave(); }} disabled={save.isPending || !draft}>
              <Save className="h-4 w-4 mr-2" />
              {save.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          )}
          {canManage && draft && (
            <Button variant="secondary" onClick={() => setDraft(null)}>
              <RotateCcw className="h-4 w-4 mr-2" /> Bekor qilish
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" onClick={() => setDraft({ ...DEFAULT_RECEIPT_TEMPLATE, logo: template.logo, showLogo: template.showLogo })}>
              Standart qiymatlar
            </Button>
          )}
          <Button variant="secondary" onClick={() => printHtml(previewHtml)}>
            <Printer className="h-4 w-4 mr-2" /> Sinov chekini chop etish
          </Button>
        </div>
      </div>

      <div className="xl:sticky xl:top-4 self-start space-y-2">
        <p className="text-sm font-medium">
          Ko'rinish {draft && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">— saqlanmagan</span>}
        </p>
        <iframe
          title="Chek ko'rinishi"
          sandbox=""
          srcDoc={previewHtml}
          className="w-full h-[680px] rounded-2xl border border-border bg-muted/40"
        />
      </div>
    </div>
  );
}

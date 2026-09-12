import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import type { AppStatus, KassaChannels } from "../../shared/kassa-api.js";
import { call, errorText } from "../kassa.ts";

type Options = KassaChannels["setup:options"]["output"];

/** Qurilmani ro'yxatdan o'tkazish: server, rahbar telefon/parol → kompaniya va ombor → kassa nomi. */
export default function SetupScreen({ onDone }: { onDone: (status: AppStatus) => void }) {
  const [apiUrl, setApiUrl] = useState("https://www.bum-erp.uz");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState("");
  const [name, setName] = useState("Kassa 1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const loadOptions = (company?: string) =>
    run(async () => {
      const result = await call("setup:options", { apiUrl, phone, password, ...(company ? { companyId: company } : {}) });
      setOptions(result);
      setCompanyId(result.company?.id);
      setWarehouseId(result.warehouses.find((w) => w.isDefault)?.id ?? result.warehouses[0]?.id ?? "");
    });

  const register = () =>
    run(async () => {
      onDone(await call("setup:register", { apiUrl, phone, password, companyId, warehouseId, name: name.trim() }));
    });

  return (
    <main className="flex min-h-full items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">BUM POS KASSA</h1>
          <p className="text-sm text-muted-foreground">Kassani ro'yxatdan o'tkazish — bir marta, internet bilan</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="setup-url">Server manzili</Label>
            <Input id="setup-url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} disabled={Boolean(options)} />
            <p className="text-xs text-muted-foreground">Masalan: https://www.bum-erp.uz</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="setup-phone">Rahbar telefoni</Label>
            <Input id="setup-phone" inputMode="tel" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={Boolean(options)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="setup-password">Parol</Label>
            <Input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={Boolean(options)} />
          </div>
        </div>

        {options && !options.company && (
          <div className="space-y-1">
            <Label htmlFor="setup-company">Kompaniya</Label>
            <select id="setup-company" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={companyId ?? ""} onChange={(e) => void loadOptions(e.target.value)}>
              <option value="" disabled>
                Tanlang
              </option>
              {options.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {options?.company && (
          <div className="space-y-3">
            <p className="text-sm">
              Kompaniya: <span className="font-medium">{options.company.name}</span>
            </p>
            <div className="space-y-1">
              <Label htmlFor="setup-warehouse">Kassa ombori</Label>
              <select id="setup-warehouse" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {options.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="setup-name">Kassa nomi</Label>
              <Input id="setup-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        )}

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {!options ? (
          <Button className="h-11 w-full" disabled={busy || !phone || !password} onClick={() => void loadOptions()}>
            {busy ? "Tekshirilmoqda…" : "Davom etish"}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="h-11" disabled={busy} onClick={() => setOptions(null)}>
              Orqaga
            </Button>
            <Button className="h-11" disabled={busy || !options.company || !warehouseId || !name.trim()} onClick={() => void register()}>
              {busy ? "Ro'yxatdan o'tmoqda…" : "Ro'yxatdan o'tkazish"}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * POS: mijoz tanlash — telefon raqami, ismi yoki familiyasi bo'yicha qidiruv;
 * topilmasa shu oynaning o'zida qo'shiladi (`pos.use` yetarli).
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Loader2, Search, UserPlus, UserRound } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { num, type Customer } from "@/pages/sales/_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

type Props = {
  onSelect: (customer: Customer) => void;
  onClose: () => void;
};

export default function CustomerPicker({ onSelect, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [mode, setMode] = useState<"search" | "create">("search");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const customers = useApiQuery<{ customers: Customer[] }>(
    "/api/sales/customers",
    { search: debouncedSearch || undefined, limit: 30 },
    { placeholderData: (previous) => previous },
  ).data?.customers;

  const create = useApiMutation(
    (body: object) => api.post<{ customer: Customer }>("/api/sales/pos/customers", body),
    { invalidate: ["/api/sales/customers"] },
  );

  // Qidiruvdagi matn yangi mijoz formasiga o'tadi: raqam bo'lsa telefonga, aks holda ismga
  const startCreate = () => {
    const term = search.trim();
    const looksLikePhone = /^[+\d\s()-]{7,}$/.test(term);
    setName(looksLikePhone ? "" : term);
    setPhone(looksLikePhone ? term : "");
    setError(null);
    setMode("create");
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || create.isPending) return;
    setError(null);
    try {
      const { customer } = await create.mutateAsync({ name: name.trim(), phone: phone.trim() || null });
      toast.success(`Mijoz qo'shildi: ${customer.name}`);
      onSelect(customer);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "create"
              ? <UserPlus className="h-5 w-5 text-primary" />
              : <UserRound className="h-5 w-5 text-primary" />}
            {mode === "create" ? "Yangi mijoz" : "Mijoz tanlash"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Saqlangach chekka darhol tanlanadi."
              : "Telefon raqami, ismi yoki familiyasi bo'yicha qidiring."}
          </DialogDescription>
        </DialogHeader>

        {mode === "search" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9 h-10"
                placeholder="90 123 45 67, Ali, Valiyev..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customers?.[0]) {
                    e.preventDefault();
                    onSelect(customers[0]);
                  }
                }}
              />
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {!customers ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
              ) : customers.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Mijoz topilmadi</div>
              ) : (
                customers.map((c) => {
                  const debt = num(c.totalDebt);
                  const balance = num(c.balance);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelect(c)}
                      className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:bg-accent hover:border-primary/30 transition-colors cursor-pointer"
                    >
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <UserRound className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.phone ?? "Telefon yo'q"} · <span className="font-mono">{c.code}</span>
                        </p>
                      </div>
                      <div className="text-right text-[11px] shrink-0 space-y-0.5">
                        {debt > 0 && <p className="font-semibold text-amber-600 dark:text-amber-400">Qarz {fmt(debt)}</p>}
                        {balance > 0 && <p className="font-semibold text-emerald-600 dark:text-emerald-400">Balans {fmt(balance)}</p>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <Button type="button" variant="secondary" className="w-full" onClick={startCreate}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Yangi mijoz qo'shish
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pos-customer-name">Ism familiya *</Label>
              <Input
                id="pos-customer-name"
                autoFocus={!name}
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                placeholder="Masalan: Valiyev Ali"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-customer-phone">Telefon</Label>
              <Input
                id="pos-customer-phone"
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                placeholder="+998 90 123 45 67"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => { setMode("search"); setError(null); }}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Orqaga
              </Button>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saqlanmoqda</> : "Qo'shish va tanlash"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

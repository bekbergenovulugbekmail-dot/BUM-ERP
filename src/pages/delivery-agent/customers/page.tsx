import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, PackageCheck, Phone, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { coordsOf, formatDateTime } from "@/lib/delivery/format.ts";
import { num, type AgentCustomer, type DeliveryTaskRow } from "@/lib/delivery/types.ts";
import { mapAppUrl } from "@/lib/maps/index.ts";
import { useApiQuery } from "@/lib/query.ts";
import ReturnPickupDialog from "../_components/return-pickup-dialog.tsx";
import TaskCard from "../_components/task-card.tsx";
import { useDeliveryAgent } from "../_lib/context.ts";

type CustomerDetail = {
  customer: Omit<AgentCustomer, "openTasks" | "deliveries" | "pendingPayments" | "lastDeliveredAt"> & { balance?: string };
  tasks: DeliveryTaskRow[];
};

function CustomerSheet({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { t } = useTranslation("delivery");
  const { money } = useDeliveryAgent();
  const { can } = useDeliveryAgent();
  const detail = useApiQuery<CustomerDetail>(`/api/delivery/agent/customers/${customerId}`).data;
  const customer = detail?.customer;
  /** Mijozdan ilgari sotilgan tovarni qaytarib olish. */
  const [returning, setReturning] = useState(false);
  const target = customer ? coordsOf(customer.latitude, customer.longitude) : null;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{customer?.name ?? "…"}</SheetTitle>
          <SheetDescription>{customer?.address ?? ""}</SheetDescription>
        </SheetHeader>
        {!detail ? (
          <div className="space-y-2 px-4 pb-4">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <div className="flex gap-2">
              {customer?.phone && (
                <Button asChild variant="secondary" className="h-12 flex-1">
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="mr-2 h-4 w-4" /> {t("task.call")}
                  </a>
                </Button>
              )}
              {target && (
                <Button asChild variant="secondary" className="h-12 flex-1">
                  <a href={mapAppUrl(target.latitude, target.longitude, customer?.name)} target="_blank" rel="noreferrer">
                    <MapPin className="mr-2 h-4 w-4" /> {t("task.map")}
                  </a>
                </Button>
              )}
            </div>
            {customer?.contactName && (
              <p className="text-sm">
                {t("task.contact")}: {customer.contactName}
              </p>
            )}
            {customer?.totalDebt !== undefined && (
              <div className="flex justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("task.customer_debt")}</span>
                <span className="font-semibold tabular-nums">{money(customer.totalDebt)}</span>
              </div>
            )}
            {can("delivery.return_pickup") && (
              <Button variant="secondary" className="h-12 w-full" data-testid="return-pickup-open" onClick={() => setReturning(true)}>
                <PackageCheck className="mr-2 h-4 w-4" /> {t("return_pickup.title")}
              </Button>
            )}
            <p className="text-sm font-semibold">{t("customers.tasks")}</p>
            <div className="space-y-3">
              {detail.tasks.map((task) => (
                <TaskCard key={task.id} task={task} money={money} />
              ))}
            </div>
          </div>
        )}
      </SheetContent>
      {returning && customer && (
        <ReturnPickupDialog customerId={customerId} customerName={customer.name} onClose={() => setReturning(false)} />
      )}
    </Sheet>
  );
}

/** Mijozlar — faqat agentga biriktirilgan (ochiq yoki so'nggi 90 kundagi) yetkazmalardagi mijozlar; qarz — ruxsat bilan. */
export default function DeliveryCustomersPage() {
  const { t, i18n } = useTranslation("delivery");
  const { money } = useDeliveryAgent();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const customers = useApiQuery<{ customers: AgentCustomer[] }>("/api/delivery/agent/customers", term ? { search: term } : undefined).data?.customers;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">{t("customers.title")}</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("customers.search")}
          placeholder={t("customers.search")}
          className="h-12 pl-9"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!customers ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-10 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("customers.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {customers.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => setSelected(customer.id)}
                className="w-full space-y-1 rounded-2xl border border-border bg-card p-4 text-left active:bg-accent"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{customer.name}</p>
                  {customer.totalDebt !== undefined && num(customer.totalDebt) > 0 && (
                    <span className="shrink-0 text-sm font-semibold text-amber-700 tabular-nums dark:text-amber-400">{money(customer.totalDebt)}</span>
                  )}
                </div>
                {customer.address && <p className="truncate text-xs text-muted-foreground">{customer.address}</p>}
                <p className="text-xs text-muted-foreground">
                  {t("customers.open_tasks", { count: customer.openTasks })} · {t("customers.deliveries", { count: customer.deliveries })}
                  {customer.pendingPayments > 0 ? ` · ${t("customers.pending_payments", { count: customer.pendingPayments })}` : ""}
                  {customer.lastDeliveredAt ? ` · ${formatDateTime(customer.lastDeliveredAt, i18n.language)}` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && <CustomerSheet customerId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/**
 * Supervayzer paneli: jamoa KPI (bugun/oy), mijozlar qarzi, agentdagi naqd, yetkazish holati, "agent nomidan" ishlash
 * va buyurtma zanjiri (Agent → Buyurtma → Ombor → Yetkazish → To'lov → Qarz → Topshirish).
 * Hamma raqam serverdan (`/api/sales-agent/supervisor/overview`, `/orders/:id/chain`) — bu yerda qayta hisoblanmaydi.
 * Jamoa chegarasi ("mas'ul bo'lganlari") serverda qo'llanadi.
 */
import { Fragment, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Link2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { useApiQuery } from "@/lib/query.ts";
import { setActAs } from "@/lib/act-as.ts";
import { usePermissions } from "@/hooks/use-company.ts";
import { todayLocal } from "@/pages/sales/_lib/types.ts";

type OverviewAgent = {
  id: string;
  name: string;
  code: string;
  region: string | null;
  monthlyTarget: string;
  salesThisMonth: string;
  ordersThisMonth: number;
  visitsThisMonth: number;
  targetPercent: number | null;
  ordersToday: number;
  salesToday: string;
  visitsToday: number;
  pendingApproval: number;
  customers: number;
  customerDebt: string;
  cashOnHand: string;
};
type Overview = {
  date: string;
  scoped: boolean;
  totals: { agents: number; ordersToday: number; salesToday: string; salesThisMonth: string; visitsToday: number; pendingApproval: number; customerDebt: string; cashOnHand: string };
  agents: OverviewAgent[];
  delivery: {
    total: number;
    unassigned: number;
    onRoute: number;
    delivered: number;
    partiallyDelivered: number;
    failed: number;
    returned: number;
    overdue: number;
    collected: { total: string };
    agents: { deliveryAgentId: string; name: string; total: number; done: number; failed: number; collected: { total: string } }[];
  } | null;
};
type ChainOrder = { id: string; number: string; customerName: string; totalAmount: string; status: string; approvalStatus: string | null };
type Chain = {
  agent: { name: string; actingUserName: string | null; overrideReason: string | null };
  order: { number: string; status: string; orderDate: string; totalAmount: string; paidAmount: string; customerName: string | null };
  warehouse: { name: string | null; movements: { type: string; quantity: string; lines: number }[] };
  delivery: { number: string; status: string; deliveryAgentName: string | null; collectedAmount: string; failureReason: string | null }[];
  payments: { collected: { method: string; amount: string }[]; customerPayments: { amount: string; method: string; status: string }[] };
  debt: { customerName: string | null; totalDebt: string; orderBalance: string };
  handover: { name: string; balance: string }[];
};

const money = (value: string | number) => new Intl.NumberFormat("uz-UZ").format(Math.round(Number(value)));

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ChainDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const chain = useApiQuery<Chain>(`/api/sales-agent/supervisor/orders/${orderId}/chain`).data;
  const steps = chain
    ? [
        { title: "Agent", body: `${chain.agent.name}${chain.agent.actingUserName ? ` · kiritdi: ${chain.agent.actingUserName} (agent nomidan)` : ""}${chain.agent.overrideReason ? ` · sabab: ${chain.agent.overrideReason}` : ""}` },
        { title: "Buyurtma", body: `${chain.order.number} · ${chain.order.customerName ?? "—"} · ${money(chain.order.totalAmount)} · ${chain.order.status}` },
        { title: "Ombor", body: `${chain.warehouse.name ?? "—"} · ${chain.warehouse.movements.map((row) => `${row.type}: ${Number(row.quantity)}`).join(", ") || "harakat yo'q"}` },
        { title: "Yetkazish", body: chain.delivery.map((task) => `${task.number} · ${task.status} · ${task.deliveryAgentName ?? "biriktirilmagan"}${task.failureReason ? ` · ${task.failureReason}` : ""}`).join("; ") || "yetkazma yo'q" },
        { title: "To'lov", body: chain.payments.collected.map((row) => `${row.method}: ${money(row.amount)}`).join(", ") || "yig'ilmagan" },
        { title: "Qarz", body: `buyurtma qoldig'i ${money(chain.debt.orderBalance)} · mijoz qarzi ${money(chain.debt.totalDebt)}` },
        { title: "Topshirish", body: chain.handover.map((row) => `${row.name}: ${money(row.balance)}`).join("; ") || "naqd yo'q" },
      ]
    : [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="order-chain">
        <DialogHeader>
          <DialogTitle>Buyurtma zanjiri</DialogTitle>
        </DialogHeader>
        {!chain ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3 rounded-xl border border-border p-3 text-sm" data-testid="chain-step">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                <div>
                  <p className="font-semibold">{step.title}</p>
                  <p className="text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AgentOrders({ salesRepId, onChain }: { salesRepId: string; onChain: (orderId: string) => void }) {
  const orders = useApiQuery<{ orders: ChainOrder[] }>("/api/sales-agent/supervisor/orders", { salesRepId, limit: 10 }).data?.orders;
  if (!orders) return <Skeleton className="h-10 w-full" />;
  if (orders.length === 0) return <p className="px-3 py-2 text-xs text-muted-foreground">Yuborilgan buyurtma yo'q</p>;
  return (
    <div className="space-y-1 px-3 py-2">
      {orders.map((order) => (
        <div key={order.id} className="flex items-center gap-2 text-xs">
          <span className="font-medium">{order.number}</span>
          <span className="text-muted-foreground truncate">{order.customerName}</span>
          <span className="ml-auto tabular-nums">{money(order.totalAmount)}</span>
          <Button size="sm" variant="ghost" className="h-7" data-testid="open-chain" onClick={() => onChain(order.id)}>
            <Link2 className="h-3.5 w-3.5 mr-1" /> Zanjir
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function SupervisorSection() {
  const { can } = usePermissions();
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayLocal());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chainOrder, setChainOrder] = useState<string | null>(null);
  const overview = useApiQuery<Overview>("/api/sales-agent/supervisor/overview", { date }).data;

  // Agent nomidan: mavjud agent ish joyi shu agent kontekstida ochiladi (server ruxsat va jamoani tekshiradi)
  const actAs = (agent: OverviewAgent) => {
    setActAs({ salesRepId: agent.id, name: agent.name });
    queryClient.removeQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/sales-agent") && !String(query.queryKey[0]).includes("/supervisor") });
    navigate(`/${lng}/sales-agent/customers`);
  };

  if (!overview) return <Skeleton className="h-64 w-full" />;
  const { totals, delivery } = overview;
  return (
    <div className="space-y-4" data-testid="supervisor-section">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" className="w-44" value={date} onChange={(event) => setDate(event.target.value || todayLocal())} aria-label="Sana" />
        {overview.scoped && <Badge variant="secondary">Faqat mas'ul jamoa</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="supervisor-totals">
        <Stat label="Agentlar" value={totals.agents} sub={`Tasdiq kutmoqda: ${totals.pendingApproval}`} />
        <Stat label="Bugungi buyurtmalar" value={totals.ordersToday} sub={`${money(totals.salesToday)} so'm · tashrif ${totals.visitsToday}`} />
        <Stat label="Oylik savdo" value={`${money(totals.salesThisMonth)} so'm`} />
        <Stat label="Mijozlar qarzi" value={`${money(totals.customerDebt)} so'm`} sub={`Agentlardagi naqd: ${money(totals.cashOnHand)} so'm`} />
      </div>
      {delivery && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="supervisor-delivery">
          <Stat label="Yetkazmalar" value={delivery.total} sub={`Biriktirilmagan: ${delivery.unassigned} · yo'lda: ${delivery.onRoute}`} />
          <Stat label="Yetkazildi" value={delivery.delivered + delivery.partiallyDelivered} sub={`Qisman: ${delivery.partiallyDelivered}`} />
          <Stat label="Bajarilmadi / qaytdi" value={`${delivery.failed} / ${delivery.returned}`} sub={`Muddati o'tgan: ${delivery.overdue}`} />
          <Stat label="Yig'ilgan pul" value={`${money(delivery.collected.total)} so'm`} />
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm" data-testid="supervisor-agents">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-3 py-2 text-right">Bugun</th>
              <th className="px-3 py-2 text-right">Oy (plan %)</th>
              <th className="px-3 py-2 text-right">Mijozlar / qarz</th>
              <th className="px-3 py-2 text-right">Naqd</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {overview.agents.map((agent) => (
              <Fragment key={agent.id}>
                <tr className="border-t border-border" data-testid="supervisor-agent-row">
                  <td className="px-3 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}>
                      {agent.name}
                    </button>
                    <p className="text-xs text-muted-foreground">{[agent.code, agent.region].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {agent.ordersToday} · {money(agent.salesToday)}
                    <p className="text-xs text-muted-foreground">tashrif {agent.visitsToday}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(agent.salesThisMonth)}
                    <p className="text-xs text-muted-foreground">{agent.targetPercent === null ? "plan yo'q" : `${agent.targetPercent}%`}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {agent.customers} · {money(agent.customerDebt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(agent.cashOnHand)}</td>
                  <td className="px-3 py-2 text-right">
                    {can("sales_agent.supervise") && (
                      <Button size="sm" variant="outline" data-testid="act-as-agent" onClick={() => actAs(agent)}>
                        <UserCheck className="h-4 w-4 mr-1" /> Agent nomidan <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    )}
                  </td>
                </tr>
                {expanded === agent.id && (
                  <tr className="bg-muted/20">
                    <td colSpan={6}>
                      <AgentOrders salesRepId={agent.id} onChain={setChainOrder} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {overview.agents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Jamoada agent yo'q</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {chainOrder && <ChainDialog orderId={chainOrder} onClose={() => setChainOrder(null)} />}
    </div>
  );
}

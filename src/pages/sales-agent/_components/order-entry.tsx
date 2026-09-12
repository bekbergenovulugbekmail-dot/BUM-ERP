import { Link, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { useApiQuery } from "@/lib/query.ts";
import { num, type AgentMe, type AgentOrder } from "../_lib/types.ts";

/** Do'kon sahifasida: buyurtma berish (yoki qoralamani davom ettirish) va shu do'konga so'nggi yuborilgan buyurtmalar. */
export default function OrderEntry({ customerId }: { customerId: string }) {
  const { t } = useTranslation("agent");
  const { lng = "uz" } = useParams<{ lng: string }>();
  const { company } = useOutletContext<AgentMe>();
  const orders = useApiQuery<{ orders: AgentOrder[] }>("/api/sales-agent/orders", { customerId }).data?.orders;
  const draft = orders?.find((order) => order.status === "draft" && !order.submittedAt);
  const recent = (orders ?? []).filter((order) => order.submittedAt).slice(0, 3);

  return (
    <div className="space-y-2">
      <Button asChild className="h-14 w-full text-base">
        <Link to={`/${lng}/sales-agent/stores/${customerId}/order`}>
          <ShoppingCart className="mr-2 h-5 w-5" />
          {draft ? t("order.continue_draft", { number: draft.number }) : t("order.create")}
        </Link>
      </Button>
      {recent.map((order) => (
        <div key={order.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            {order.number} · {order.approvalStatus === "pending" ? t("order.approval.pending") : t(`order.status.${order.status}`)}
          </span>
          <span className="font-semibold">{formatMoney(num(order.totalAmount), company.currency)}</span>
        </div>
      ))}
    </div>
  );
}

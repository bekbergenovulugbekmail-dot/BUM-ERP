import { useTranslation } from "react-i18next";
import { ShoppingCart } from "lucide-react";
import EmptyState from "../_components/empty-state.tsx";

export default function AgentSalesPage() {
  const { t } = useTranslation("agent");
  return <EmptyState icon={ShoppingCart} title={t("nav.sales")} message={t("empty.sales")} />;
}

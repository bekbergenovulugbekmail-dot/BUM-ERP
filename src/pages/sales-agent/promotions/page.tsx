import { useTranslation } from "react-i18next";
import { BadgePercent } from "lucide-react";
import EmptyState from "../_components/empty-state.tsx";

export default function AgentPromotionsPage() {
  const { t } = useTranslation("agent");
  return <EmptyState icon={BadgePercent} title={t("nav.promotions")} message={t("empty.promotions")} />;
}

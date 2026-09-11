import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import EmptyState from "../_components/empty-state.tsx";

export default function AgentDebtorsPage() {
  const { t } = useTranslation("agent");
  return <EmptyState icon={Wallet} title={t("nav.debtors")} message={t("empty.debtors")} />;
}

import { useTranslation } from "react-i18next";
import { Store } from "lucide-react";
import EmptyState from "../_components/empty-state.tsx";

export default function AgentStoresPage() {
  const { t } = useTranslation("agent");
  return <EmptyState icon={Store} title={t("nav.stores")} message={t("empty.stores")} />;
}

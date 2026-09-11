import { useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Target, MapPin, Phone, Hash } from "lucide-react";
import { formatMoney } from "@/hooks/use-currencies.ts";
import { num, type AgentMe } from "../_lib/types.ts";

export default function AgentDashboardPage() {
  const { t } = useTranslation("agent");
  const { agent, company } = useOutletContext<AgentMe>();
  const target = num(agent.monthlyTarget);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{t("greeting", { name: agent.name })}</h1>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        {[
          { icon: Hash, label: t("profile.code"), value: agent.code },
          { icon: MapPin, label: t("profile.region"), value: agent.region },
          { icon: Phone, label: t("profile.phone"), value: agent.phone },
        ]
          .filter((row) => row.value)
          .map((row) => (
            <div key={row.label} className="flex items-center gap-3 text-sm">
              <row.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{row.label}</span>
              <span className="ml-auto font-medium">{row.value}</span>
            </div>
          ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Target className="h-4 w-4" /> {t("plan.monthly")}
        </div>
        <p className="text-2xl font-bold mt-2">
          {target > 0 ? formatMoney(target, company.currency) : t("plan.not_set")}
        </p>
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import { motion } from "motion/react";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

type ComingSoonProps = {
  moduleName?: string;
};

export default function ComingSoon({ moduleName }: ComingSoonProps) {
  const { t } = useTranslation("common");
  const { lng } = useParams<{ lng: string }>();

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center space-y-4 max-w-sm"
      >
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Construction className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{moduleName ?? t("msg.coming_soon")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Bu modul tez kunda ishga tushiriladi.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to={`/${lng}/dashboard`}>{t("btn.back")}</Link>
        </Button>
      </motion.div>
    </div>
  );
}

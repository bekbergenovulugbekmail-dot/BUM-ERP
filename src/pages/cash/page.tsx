/**
 * "Kassalar" bo'limi — kassa mas'ullari uchun (ruxsat `cash.own`): faqat o'ziga biriktirilgan kassalar.
 * Rahbar shu panelni Moliya → "Kassalar" tabida hamma kassalar bilan ko'radi.
 */
import { Landmark } from "lucide-react";
import RegistersPanel from "./_components/registers-panel.tsx";

export default function CashPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <Landmark className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Kassalar</h1>
          <p className="text-xs text-muted-foreground">Kirim, chiqim, o'tkazma, ayirboshlash va kassa hisoboti</p>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <RegistersPanel />
      </div>
    </div>
  );
}

/**
 * Sahifa ichidagi bo'limlar (Marshrutlar, Xarita, Savdo vakillari ...) — mobil birinchi.
 *
 * Telefonda o'nlab bo'lim nomini yonma-yon siqib ko'rsatish kompyuter ko'rinishi bo'lib qoladi:
 * yozuvlar kesiladi va sahifa yon tomonga suriladi. Shuning uchun:
 *   - tor ekranda (md dan kichik) bo'limlar RO'YXATdan tanlanadi (bitta tugma → ochiluvchi ro'yxat);
 *   - keng ekranda avvalgidek tagi chizilgan yorliqlar qatori.
 * Shu bitta komponent barcha bo'limlarda ishlatiladi — har sahifada alohida uslub bo'lmaydi.
 */
import { useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog.tsx";

export type PageTab<K extends string> = {
  key: K;
  label: string;
  icon?: LucideIcon;
  /** Yorliq yonidagi son (masalan tasdiq kutayotganlar). */
  badge?: number;
};

export default function PageTabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: PageTab<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = tabs.find((tab) => tab.key === value) ?? tabs[0];
  if (!active) return null;
  const ActiveIcon = active.icon;

  return (
    <div className={cn("min-w-0", className)}>
      {/* Telefon: joriy bo'lim + ro'yxatdan tanlash */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="page-tabs-mobile"
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold md:hidden"
      >
        {ActiveIcon && <ActiveIcon className="h-4 w-4 shrink-0 text-primary" />}
        <span className="truncate">{active.label}</span>
        {active.badge !== undefined && active.badge > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{active.badge}</span>
        )}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Kompyuter: avvalgidek yorliqlar qatori */}
      <div className="hidden border-b border-border md:block">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-all cursor-pointer",
                tab.key === value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Bo'limlar</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { onChange(tab.key); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors",
                    tab.key === value ? "bg-primary/10 font-semibold text-foreground" : "hover:bg-accent",
                  )}
                >
                  {tab.icon && <tab.icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{tab.badge}</span>
                  )}
                  {tab.key === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

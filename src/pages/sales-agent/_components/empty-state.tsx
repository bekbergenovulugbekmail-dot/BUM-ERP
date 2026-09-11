import type { LucideIcon } from "lucide-react";

/** Agent ish joyidagi bo'sh bo'lim — katta ikonka va qisqa matn (mobil). */
export default function EmptyState({ icon: Icon, title, message }: { icon: LucideIcon; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs">{message}</p>
    </div>
  );
}

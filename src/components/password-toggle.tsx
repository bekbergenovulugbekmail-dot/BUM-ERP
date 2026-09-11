/**
 * Parolni ko'rsatish / yashirish tugmasi — input'ning `relative` o'rami ichida, o'ng tomonda.
 * Input'ga `pr-10` qo'shing, matn tugma ostiga kirmasin.
 */
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils.ts";

type Props = {
  shown: boolean;
  onToggle: () => void;
  className?: string;
};

export function PasswordToggle({ shown, onToggle, className }: Props) {
  const label = shown ? "Parolni yashirish" : "Parolni ko'rsatish";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={shown}
      title={label}
      className={cn(
        "absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 transition-colors cursor-pointer",
        className,
      )}
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

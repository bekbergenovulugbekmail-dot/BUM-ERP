/**
 * Erkin yoziladigan, lekin AVVAL KIRITILGAN qiymatlarni taklif qiladigan maydon
 * (shahar, mahalla kabi takrorlanadigan matnlar uchun).
 *
 * Maydon bosilganda to'liq ro'yxat chiqadi, yozila boshlangach ro'yxat qisqaradi; ro'yxatda yo'q
 * qiymatni ham yozish mumkin — bu `Select` emas, oddiy `Input` ustidagi taklif.
 * Ro'yxat qatori `onMouseDown` da tanlanadi (fokus maydonda qoladi, shuning uchun `blur` da yopilishi
 * tanlashni buzmaydi).
 */
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { cn } from "@/lib/utils.ts";

/** Ro'yxatda ko'pi bilan shuncha taklif (qolganini yozib qidiriladi). */
const MAX_SUGGESTIONS = 8;

export default function SuggestInput({
  value,
  onChange,
  options,
  id,
  placeholder,
  maxLength,
  className,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Takliflar — avval kiritilgan qiymatlar (takrorsiz). */
  options: string[];
  id?: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const query = value.trim().toLowerCase();
  // Yozilgan matn bo'yicha qisqartiriladi; aynan mos kelgan bitta variant qolsa ro'yxat keraksiz
  const matches = options.filter((option) => !query || option.toLowerCase().includes(query));
  const visible = matches.length === 1 && matches[0]?.toLowerCase() === query ? [] : matches.slice(0, MAX_SUGGESTIONS);

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        data-testid={testId}
        className={cn(options.length > 0 && "pr-8", className)}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      />
      {options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Ro'yxatni ochish"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          // `preventDefault` — maydon fokusdan chiqmaydi, ya'ni ro'yxat yopilib qolmaydi
          onMouseDown={(event) => { event.preventDefault(); setOpen((current) => !current); }}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      {open && visible.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {visible.map((option) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                className="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={(event) => { event.preventDefault(); onChange(option); setOpen(false); }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

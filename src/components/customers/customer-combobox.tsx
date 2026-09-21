/**
 * Mijoz tanlash — QIDIRUVLI ro'yxat (buyurtma, CRM kabi formalar uchun).
 *
 * Oddiy `Select` da 200 ta mijoz sig'masdi: kerakligini topish uchun butun ro'yxatni aylantirishga
 * to'g'ri kelardi. Bu yerda qidiruv SERVERDA bajariladi (`GET /api/sales/customers?search=`) — nomi,
 * kodi va telefoni bo'yicha, ya'ni ro'yxat chegarasidan tashqaridagi mijoz ham topiladi.
 */
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";

/** Tanlash uchun yetarli maydonlar; chaqiruvchi o'z turini (chegirma, qarz...) qo'shib berishi mumkin. */
export type CustomerPick = { id: string; name: string; phone?: string | null; code?: string; city?: string | null };

const LIMIT = 30;

export default function CustomerCombobox<T extends CustomerPick>({
  selected,
  onSelect,
  emptyLabel = "Tanlang",
  clearLabel,
  disabled = false,
  testId,
}: {
  /** Tanlangan mijoz (nomi tugmada ko'rinadi); tanlanmagan bo'lsa `null`. */
  selected: T | null;
  onSelect: (customer: T | null) => void;
  /** Hech narsa tanlanmaganda tugmadagi matn. */
  emptyLabel?: string;
  /** Berilsa — ro'yxat boshida "tanlovni bekor qilish" qatori chiqadi (masalan, "Anonim"). */
  clearLabel?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search] = useDebounce(query.trim(), 250);

  const customers =
    useApiQuery<{ customers: T[] }>(
      open ? "/api/sales/customers" : null,
      { search: search || undefined, limit: LIMIT },
      { placeholderData: (previous) => previous },
    ).data?.customers ?? [];

  const choose = (customer: T | null) => {
    onSelect(customer);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          data-testid={testId}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : (clearLabel ?? emptyLabel)}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,90vw)] p-0">
        {/* Filtrlash serverda — cmdk o'z filtrini qo'llamasin */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Nomi, telefoni yoki kodi..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Mijoz topilmadi</CommandEmpty>
            {clearLabel && (
              <CommandItem value="__clear__" onSelect={() => choose(null)}>
                <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-0" : "opacity-100")} />
                {clearLabel}
              </CommandItem>
            )}
            {customers.map((customer) => (
              <CommandItem key={customer.id} value={customer.id} onSelect={() => choose(customer)}>
                <Check className={cn("mr-2 h-4 w-4", selected?.id === customer.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{customer.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[customer.code, customer.phone, customer.city].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

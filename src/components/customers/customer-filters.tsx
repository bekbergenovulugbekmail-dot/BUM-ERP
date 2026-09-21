/**
 * Mijozlarni saralash paneli — mijoz ro'yxati chiqadigan HAR QANDAY joyda ishlatiladi
 * (Sotuv → Mijozlar, marshrutga mijoz qo'shish va h.k.).
 *
 * Saralash SERVERDA bajariladi: qiymatlar `GET /api/sales/customers` parametrlariga aylanadi
 * (`customerFilterParams`), shuning uchun ro'yxat chegarasidan (200/500) tashqaridagi mijoz ham topiladi.
 * Hudud tanlovlari `GET /api/sales/customers/regions` dan keladi — mavjud shahar/mahalla juftliklari
 * va har birida nechta mijoz borligi.
 */
import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { useApiQuery } from "@/lib/query.ts";
import {
  ALL,
  CUSTOMER_SORTS,
  cityTotals,
  districtTotals,
  emptyCustomerFilter,
  isCustomerFilterActive,
  type CustomerFilter,
  type CustomerRegion,
  type CustomerSort,
} from "./customer-filter.ts";

export default function CustomerFilters({
  value,
  onChange,
  includeInactive = false,
  showDebt = true,
  trailing,
}: {
  value: CustomerFilter;
  onChange: (next: CustomerFilter) => void;
  /** Arxiv ko'rinishi: hududlar nofaol mijozlardan ham yig'iladi. */
  includeInactive?: boolean;
  /** "Qarzi borlar" tugmasi kerakmi (marshrutga qo'shishda — kerak emas). */
  showDebt?: boolean;
  /** O'ng tomonda qo'shimcha matn (masalan, topilgan mijozlar soni). */
  trailing?: React.ReactNode;
}) {
  const regions =
    useApiQuery<{ regions: CustomerRegion[] }>("/api/sales/customers/regions", {
      includeInactive: includeInactive || undefined,
    }).data?.regions ?? [];

  const cities = cityTotals(regions);
  const districts = districtTotals(regions, value.city);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.city}
        // Shahar o'zgarsa mahalla tanlovi ma'nosini yo'qotadi
        onValueChange={(city) => onChange({ ...value, city, district: ALL })}
      >
        <SelectTrigger className="h-9 w-full sm:w-52" data-testid="customers-city">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue placeholder="Hudud" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL}>Barcha hududlar</SelectItem>
          {cities.map(([name, count]) => (
            <SelectItem key={name} value={name}>{name} ({count})</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.district}
        disabled={districts.length === 0}
        onValueChange={(district) => onChange({ ...value, district })}
      >
        <SelectTrigger className="h-9 w-full sm:w-52" data-testid="customers-district">
          <SelectValue placeholder="Mahalla" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL}>Barcha mahallalar</SelectItem>
          {districts.map(([name, count]) => (
            <SelectItem key={name} value={name}>{name} ({count})</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={value.sort} onValueChange={(sort) => onChange({ ...value, sort: sort as CustomerSort })}>
        <SelectTrigger className="h-9 w-full sm:w-52" data-testid="customers-sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {CUSTOMER_SORTS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showDebt && (
        <Button
          size="sm"
          variant={value.withDebt ? "default" : "secondary"}
          data-testid="customers-with-debt"
          onClick={() => onChange({ ...value, withDebt: !value.withDebt })}
        >
          Qarzi borlar
        </Button>
      )}

      {isCustomerFilterActive(value) && (
        <Button
          size="sm"
          variant="ghost"
          data-testid="customers-reset-filters"
          onClick={() => onChange(emptyCustomerFilter)}
        >
          <X className="h-3.5 w-3.5 mr-1" /> Tozalash
        </Button>
      )}

      {trailing}
    </div>
  );
}

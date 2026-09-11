import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { useApiQuery } from "@/lib/query.ts";
import { Package, Users, Truck } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
} from "@/components/ui/command.tsx";

type GlobalSearchProps = {
  open: boolean;
  onClose: () => void;
};

type ProductHit = { id: string; name: string; sku: string | null };
type PartyHit = { id: string; name: string; phone: string | null };

const LIMIT = 8;

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 300);

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Hammasi server tomonida qidiriladi; ruxsat bo'lmagan bo'lim (403) shunchaki bo'sh chiqadi
  const active = open && debouncedQuery.length >= 2;
  const search = { search: debouncedQuery, limit: LIMIT };

  const products = useApiQuery<{ products: ProductHit[] }>(active ? "/api/catalog/products" : null, search).data
    ?.products;
  const customers = useApiQuery<{ customers: PartyHit[] }>(active ? "/api/sales/customers" : null, search).data
    ?.customers;
  const suppliers = useApiQuery<{ suppliers: PartyHit[] }>(active ? "/api/purchase/suppliers" : null, {
    search: debouncedQuery,
  }).data?.suppliers;

  const productResults = products ?? [];
  const customerResults = customers ?? [];
  const supplierResults = (suppliers ?? []).slice(0, LIMIT);

  const hasResults =
    productResults.length > 0 ||
    customerResults.length > 0 ||
    supplierResults.length > 0;

  const navigateTo = useCallback(
    (path: string) => {
      navigate(`/${lng}/${path}`);
      onClose();
    },
    [navigate, lng, onClose],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      title="Qidiruv"
      description="Mahsulot, mijoz yoki yetkazib beruvchini qidiring"
      showCloseButton={false}
    >
      {/* Server allaqachon saralagan — cmdk o'z filtri bilan natijani yashirmasin */}
      <CommandInput
        placeholder="Qidiruv..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {debouncedQuery.length < 2 ? (
          <CommandEmpty>Kamida 2 ta belgi kiriting</CommandEmpty>
        ) : !hasResults ? (
          <CommandEmpty>Hech narsa topilmadi</CommandEmpty>
        ) : null}

        {productResults.length > 0 && (
          <CommandGroup heading="Mahsulotlar">
            {productResults.map((p) => (
              <CommandItem
                key={p.id}
                value={`product-${p.id} ${p.name} ${p.sku ?? ""}`}
                onSelect={() => navigateTo("products")}
                className="cursor-pointer"
              >
                <Package className="h-4 w-4 text-blue-500" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-sm">{p.name}</span>
                  {p.sku && (
                    <span className="text-xs text-muted-foreground truncate">
                      SKU: {p.sku}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {customerResults.length > 0 && (
          <CommandGroup heading="Mijozlar">
            {customerResults.map((c) => (
              <CommandItem
                key={c.id}
                value={`customer-${c.id} ${c.name} ${c.phone ?? ""}`}
                onSelect={() => navigateTo("sales")}
                className="cursor-pointer"
              >
                <Users className="h-4 w-4 text-emerald-500" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-sm">{c.name}</span>
                  {c.phone && (
                    <span className="text-xs text-muted-foreground truncate">
                      {c.phone}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {supplierResults.length > 0 && (
          <CommandGroup heading="Yetkazib beruvchilar">
            {supplierResults.map((s) => (
              <CommandItem
                key={s.id}
                value={`supplier-${s.id} ${s.name} ${s.phone ?? ""}`}
                onSelect={() => navigateTo("purchase")}
                className="cursor-pointer"
              >
                <Truck className="h-4 w-4 text-amber-500" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-sm">{s.name}</span>
                  {s.phone && (
                    <span className="text-xs text-muted-foreground truncate">
                      {s.phone}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export default GlobalSearch;

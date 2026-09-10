import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useNavigate, useParams } from "react-router-dom";
import { useDebounce } from "@/hooks/use-debounce.ts";
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

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const { lng = "uz" } = useParams<{ lng: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 300);

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Products: use server-side search via the search arg
  const products = useQuery(
    api.products.products.list,
    open && debouncedQuery.length >= 2
      ? {
          search: debouncedQuery,
          paginationOpts: { numItems: 8, cursor: null },
        }
      : "skip",
  );

  // Suppliers: fetch all, filter client-side
  const allSuppliers = useQuery(
    api.purchase.suppliers.list,
    open ? {} : "skip",
  );

  // Customers: use server-side search when available
  const customers = useQuery(
    api.sales.customers.list,
    open && debouncedQuery.length >= 2
      ? { search: debouncedQuery, limit: 8 }
      : "skip",
  );

  const filteredSuppliers =
    debouncedQuery.length >= 2 && allSuppliers
      ? allSuppliers
          .filter((s) =>
            s.name.toLowerCase().includes(debouncedQuery.toLowerCase()),
          )
          .slice(0, 8)
      : [];

  const productResults = products?.page ?? [];
  const customerResults = customers ?? [];

  const hasResults =
    productResults.length > 0 ||
    customerResults.length > 0 ||
    filteredSuppliers.length > 0;

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
                key={p._id}
                value={`product-${p._id}`}
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
                key={c._id}
                value={`customer-${c._id}`}
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

        {filteredSuppliers.length > 0 && (
          <CommandGroup heading="Yetkazib beruvchilar">
            {filteredSuppliers.map((s) => (
              <CommandItem
                key={s._id}
                value={`supplier-${s._id}`}
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

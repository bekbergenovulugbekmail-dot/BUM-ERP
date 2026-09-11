import { Warehouse, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import type { WarehouseItem } from "../_lib/types.ts";

type Props = {
  warehouses: WarehouseItem[];
  selectedId: string | null;
  onChange: (id: string) => void;
};

export default function WarehouseSelector({ warehouses, selectedId, onChange }: Props) {
  const selected = warehouses.find((w) => w.id === selectedId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="h-9 gap-2">
          <Warehouse className="h-4 w-4 text-primary" />
          {selected ? (
            <span className="font-medium">{selected.name}</span>
          ) : (
            <span className="text-muted-foreground">
              {warehouses.length === 0 ? "Ruxsat etilgan ombor yo'q" : "Ombor tanlang"}
            </span>
          )}
          {selected?.isDefault && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">Asosiy</Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {warehouses.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => onChange(w.id)}
            className="flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="font-medium text-sm">{w.name}</p>
                {w.city && <p className="text-xs text-muted-foreground">{w.city}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-mono text-muted-foreground">{w.code}</span>
              {w.isDefault && <Badge variant="secondary" className="text-[10px] h-4 px-1">Asosiy</Badge>}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Hududlar — GEOGRAFIK ma'lumotnoma: viloyat → shahar/tuman → mahalla.
 *
 * Marshrut shahar/tuman darajasiga biriktiriladi; mijozning "Shahar/tuman" va "Mahalla" maydonlari ham
 * shu ro'yxatdan to'ldiriladi. Nom o'zgartirilsa server mijozlardagi matnni ham yangilaydi, shuning
 * uchun bu yerda tuzatish xavfsiz. Ishlatilayotgan hudud (marshrut, mijoz yoki ichki hudud) o'chirilmaydi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import type { Territory, TerritoryKind } from "../_lib/types.ts";

const KINDS: { value: TerritoryKind; label: string; placeholder: string }[] = [
  { value: "region", label: "Viloyat", placeholder: "Xorazm" },
  { value: "district", label: "Shahar / tuman", placeholder: "Urganch" },
  { value: "neighborhood", label: "Mahalla", placeholder: "Luchevoy" },
];

/** Qaysi daraja qaysi ota ichida turadi (viloyatning otasi yo'q). */
const PARENT_KIND: Record<TerritoryKind, TerritoryKind | null> = {
  region: null,
  district: "region",
  neighborhood: "district",
};

const NO_PARENT = "__none__";

export default function TerritoriesDialog({ onClose }: { onClose: () => void }) {
  const query = useApiQuery<{ territories: Territory[] }>("/api/distribution/territories");
  const invalidate = ["/api/distribution", "/api/sales/customers"];
  const create = useApiMutation(
    (body: { name: string; kind: TerritoryKind; parentId: string | null }) =>
      api.post("/api/distribution/territories", body),
    { invalidate },
  );
  const rename = useApiMutation(
    ({ id, name }: { id: string; name: string }) =>
      api.patch<{ territory: { renamedCustomers: number } }>(`/api/distribution/territories/${id}`, { name }),
    { invalidate },
  );
  const remove = useApiMutation((id: string) => api.delete(`/api/distribution/territories/${id}`), { invalidate });
  /** O'zbekiston viloyat va tumanlari — bir marta bosiladigan yuklash (mavjudiga tegmaydi). */
  const seed = useApiMutation(
    () =>
      api.post<{ regionsAdded: number; districtsAdded: number; districtsLinked: number }>(
        "/api/distribution/territories/seed-uzbekistan",
        {},
      ),
    { invalidate },
  );
  const [seedOpen, setSeedOpen] = useState(false);

  const [kind, setKind] = useState<TerritoryKind>("district");
  const [parentId, setParentId] = useState(NO_PARENT);
  const [name, setName] = useState("");
  /** Nomini tuzatish: qaysi hudud va yangi nomi. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const territories = query.data?.territories;
  const parentKind = PARENT_KIND[kind];
  const parentOptions = (territories ?? []).filter((territory) => territory.kind === parentKind);
  const kindLabel = KINDS.find((option) => option.value === kind)!;

  const childrenOf = (id: string) => (territories ?? []).filter((territory) => territory.parentId === id);
  /** Viloyatga biriktirilmagan shahar/tumanlar — eski ma'lumot ko'zdan qochmasin. */
  const looseDistricts = (territories ?? []).filter((territory) => territory.kind === "district" && !territory.parentId);
  const regions = (territories ?? []).filter((territory) => territory.kind === "region");

  const add = async () => {
    const value = name.trim();
    if (!value) { toast.error("Hudud nomini kiriting"); return; }
    if (kind === "neighborhood" && parentId === NO_PARENT) {
      toast.error("Mahalla qaysi shahar/tumanga tegishli ekanini tanlang");
      return;
    }
    try {
      await create.mutateAsync({ name: value, kind, parentId: parentId === NO_PARENT ? null : parentId });
      setName("");
      toast.success(`${kindLabel.label} qo'shildi`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const saveName = async () => {
    if (!editing?.name.trim()) return;
    try {
      const result = await rename.mutateAsync({ id: editing.id, name: editing.name.trim() });
      const moved = result.territory.renamedCustomers;
      toast.success(moved > 0 ? `Nomi o'zgartirildi — ${moved} ta mijozda ham yangilandi` : "Nomi o'zgartirildi");
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const loadUzbekistan = async () => {
    try {
      const result = await seed.mutateAsync();
      const parts = [
        result.regionsAdded > 0 && `${result.regionsAdded} ta viloyat`,
        result.districtsAdded > 0 && `${result.districtsAdded} ta shahar/tuman`,
        result.districtsLinked > 0 && `${result.districtsLinked} tasi viloyatiga bog'landi`,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? `Qo'shildi: ${parts.join(", ")}` : "Ro'yxat allaqachon to'liq");
      setSeedOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const drop = async (territory: Territory) => {
    try {
      await remove.mutateAsync(territory.id);
      toast.success("Hudud o'chirildi");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  /** Bitta qator: nomi, ichidagilari va mijozlari soni, tuzatish va o'chirish. */
  const Row = ({ territory, depth }: { territory: Territory; depth: number }) => (
    <li>
      <div
        className="flex items-center justify-between gap-2 py-2 pe-3 text-sm"
        style={{ paddingInlineStart: `${12 + depth * 20}px` }}
      >
        {editing?.id === territory.id ? (
          <>
            <Input
              autoFocus
              className="h-8"
              value={editing.name}
              onChange={(event) => setEditing({ id: territory.id, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveName();
                if (event.key === "Escape") setEditing(null);
              }}
            />
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={rename.isPending} onClick={() => void saveName()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          </>
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              {depth > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate">{territory.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {[
                  territory.childCount > 0 && `${territory.childCount} ta hudud`,
                  territory.routeCount > 0 && `${territory.routeCount} ta marshrut`,
                  territory.customerCount > 0 && `${territory.customerCount} ta mijoz`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "bo'sh"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label={`${territory.name} nomini tuzatish`}
                onClick={() => setEditing({ id: territory.id, name: territory.name })}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive"
                aria-label={`${territory.name} hududini o'chirish`}
                disabled={remove.isPending}
                onClick={() => void drop(territory)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          </>
        )}
      </div>
      {childrenOf(territory.id).length > 0 && (
        <ul className="border-t border-border/60">
          {childrenOf(territory.id).map((child) => (
            <Row key={child.id} territory={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="territories-dialog" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hududlar</DialogTitle>
          <DialogDescription>
            Geografik ma'lumotnoma: viloyat → shahar/tuman → mahalla. Marshrutlar shahar/tuman tarkibida
            bo'ladi, mijozning shahar va mahallasi ham shu ro'yxatdan to'ldiriladi. Nomni tuzatsangiz —
            mijozlarda ham yangilanadi.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[11rem_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-xs">Daraja</Label>
            <Select value={kind} onValueChange={(next) => { setKind(next as TerritoryKind); setParentId(NO_PARENT); }}>
              <SelectTrigger className="h-9" data-testid="territory-kind"><SelectValue /></SelectTrigger>
              <SelectContent position="popper">
                {KINDS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs" htmlFor="territory-name">Nomi</Label>
            <Input
              id="territory-name"
              className="h-9"
              value={name}
              placeholder={kindLabel.placeholder}
              data-testid="territory-name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void add()}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs sm:invisible">Qo'shish</Label>
            <Button className="h-9 w-full" disabled={create.isPending} onClick={() => void add()}>
              <Plus className="mr-1 h-4 w-4" /> Qo'shish
            </Button>
          </div>

          {parentKind && (
            <div className="space-y-1 sm:col-span-3">
              <Label className="text-xs">
                {parentKind === "region" ? "Viloyat (ixtiyoriy)" : "Shahar / tuman *"}
              </Label>
              <Select value={parentId} onValueChange={setParentId} disabled={parentOptions.length === 0}>
                <SelectTrigger className="h-9" data-testid="territory-parent">
                  <SelectValue placeholder={parentOptions.length === 0 ? "Avval yuqori hududni qo'shing" : "Tanlang"} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {parentKind === "region" && <SelectItem value={NO_PARENT}>— viloyatsiz —</SelectItem>}
                  {parentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!territories ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : territories.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Hudud yo'q — birinchisini qo'shing</p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
            <ul className="divide-y divide-border">
              {regions.map((region) => <Row key={region.id} territory={region} depth={0} />)}
              {looseDistricts.map((district) => <Row key={district.id} territory={district} depth={0} />)}
            </ul>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" data-testid="territories-seed" onClick={() => setSeedOpen(true)}>
            <Download className="mr-1 h-4 w-4" /> O'zbekiston ro'yxatini yuklash
          </Button>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
        </DialogFooter>

        <AlertDialog open={seedOpen} onOpenChange={(open) => !open && setSeedOpen(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>O'zbekiston viloyat va tumanlarini yuklash</AlertDialogTitle>
              <AlertDialogDescription>
                14 ta viloyat (Qoraqalpog'iston Respublikasi va Toshkent shahri bilan) va ularning
                shahar/tumanlari ma'lumotnomaga qo'shiladi. Mavjud hududlaringiz <b>o'chirilmaydi va
                nomi o'zgarmaydi</b> — viloyatsiz turganlari o'z viloyatiga bog'lanadi xolos. Keraksizini
                keyin o'chirib tashlashingiz mumkin.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={seed.isPending}>Bekor qilish</AlertDialogCancel>
              <AlertDialogAction
                data-testid="territories-seed-confirm"
                disabled={seed.isPending}
                onClick={(event) => { event.preventDefault(); void loadUzbekistan(); }}
              >
                {seed.isPending ? "Yuklanmoqda..." : "Yuklash"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

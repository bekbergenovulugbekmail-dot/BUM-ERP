/**
 * Mahsulot kiritilishi mumkin bo'lgan o'lchov birliklari: asosiy birlik + asosiy birlikka
 * konversiyasi borlari. Server ham shu qoidada hisoblaydi (`catalog/conversions.ts`):
 * mahsulotga xos konversiya kompaniya bo'yicha umumiysidan ustun.
 */
import { useMemo } from "react";
import { useApiQuery } from "@/lib/query.ts";
import type { ProductListItem, Unit } from "@/pages/products/_lib/types.ts";

type Conversion = {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  factor: string;
  productId: string | null;
};

export type UnitOption = {
  id: string;
  label: string;
  /** Asosiy birlikdagi miqdor: 1 quti = 12 dona → "12.0000". Asosiy birlik — "1". */
  factor: string;
};

export function useProductUnits(product: ProductListItem | undefined): UnitOption[] {
  const units = useApiQuery<{ units: Unit[] }>("/api/catalog/units").data?.units;
  const conversions = useApiQuery<{ conversions: Conversion[] }>(product ? "/api/catalog/unit-conversions" : null).data
    ?.conversions;

  return useMemo(() => {
    if (!product) return [];
    const unitById = new Map((units ?? []).map((u) => [u.id, u]));
    const options: UnitOption[] = [{ id: product.baseUnitId, label: product.baseUnitName, factor: "1" }];
    const seen = new Set([product.baseUnitId]);

    const relevant = (conversions ?? [])
      .filter((c) => c.toUnitId === product.baseUnitId && (c.productId === product.id || c.productId === null))
      .sort((a, b) => Number(b.productId !== null) - Number(a.productId !== null));
    for (const conversion of relevant) {
      if (seen.has(conversion.fromUnitId)) continue;
      seen.add(conversion.fromUnitId);
      options.push({
        id: conversion.fromUnitId,
        label: unitById.get(conversion.fromUnitId)?.shortName ?? "?",
        factor: conversion.factor,
      });
    }
    return options;
  }, [product, units, conversions]);
}

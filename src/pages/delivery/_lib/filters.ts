/**
 * Yetkazmalar ro'yxati filtrlari → `GET /api/delivery/tasks` so'rov parametrlari (filtrlash va sahifalash serverda).
 */
import { ON_ROUTE_DELIVERY_STATUSES, OPEN_DELIVERY_STATUSES, type DeliveryStatus } from "@bum/shared";
import type { QueryParams } from "@/lib/api.ts";

export const STATUS_GROUPS: Record<"open" | "waiting" | "on_route", DeliveryStatus[]> = {
  open: [...OPEN_DELIVERY_STATUSES],
  waiting: ["assigned", "accepted"],
  on_route: [...ON_ROUTE_DELIVERY_STATUSES],
};

export type StatusFilter = "" | keyof typeof STATUS_GROUPS | DeliveryStatus;

export type TaskFilters = {
  dateFrom: string;
  dateTo: string;
  status: StatusFilter;
  agentId: string;
  unassigned: boolean;
  overdue: boolean;
  reviewPending: boolean;
  /** Tovari omborga qaytarilmagan yetkazmalar (yetkazilmagan yoki qisman). */
  returnPending: boolean;
  search: string;
};

export const EMPTY_FILTERS: TaskFilters = {
  dateFrom: "",
  dateTo: "",
  status: "",
  agentId: "",
  unassigned: false,
  overdue: false,
  reviewPending: false,
  returnPending: false,
  search: "",
};

const isGroup = (value: string): value is keyof typeof STATUS_GROUPS => Object.hasOwn(STATUS_GROUPS, value);

export function statusParam(status: StatusFilter): string | undefined {
  if (status === "") return undefined;
  return isGroup(status) ? STATUS_GROUPS[status].join(",") : status;
}

export function filtersToQuery(filters: TaskFilters): QueryParams {
  return {
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    status: statusParam(filters.status),
    agentId: filters.agentId || undefined,
    unassigned: filters.unassigned ? "true" : undefined,
    overdue: filters.overdue ? "true" : undefined,
    reviewPending: filters.reviewPending ? "true" : undefined,
    returnPending: filters.returnPending ? "true" : undefined,
    search: filters.search.trim() || undefined,
  };
}

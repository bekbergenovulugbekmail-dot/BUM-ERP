import { useOutletContext } from "react-router-dom";
import type { DeliveryPolicy, Permission } from "@bum/shared";
import type { DeliveryMe } from "@/lib/delivery/types.ts";
import type { DeliveryLocation } from "./use-delivery-tracking.ts";
import type { DeliveryQueue } from "./use-queue.ts";

/** Yetkazuvchi ish joyi sahifalariga layout beradigan kontekst. */
export type DeliveryAgentOutlet = {
  me: DeliveryMe;
  policy: DeliveryPolicy;
  location: DeliveryLocation;
  queue: DeliveryQueue;
  onDuty: boolean;
  can: (permission: Permission) => boolean;
  money: (value: string | number) => string;
};

export const useDeliveryAgent = () => useOutletContext<DeliveryAgentOutlet>();

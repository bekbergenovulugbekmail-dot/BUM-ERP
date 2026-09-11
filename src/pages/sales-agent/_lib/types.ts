/**
 * `/api/sales-agent/*` javob turlari (apps/api/src/modules/sales-agent). Summalar — numeric satr.
 */

/** `GET /api/sales-agent/me` — tizimga kirgan foydalanuvchiga bog'langan savdo agenti. */
export type AgentMe = {
  agent: {
    id: string;
    name: string;
    code: string;
    phone: string | null;
    region: string | null;
    monthlyTarget: string;
  };
  company: { id: string; name: string; currency: string };
};

export const num = (value: string | number | null | undefined): number => Number(value ?? 0) || 0;

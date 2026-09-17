/**
 * Obuna va litsenziyalar — `/api/subscription`.
 *
 * Ko'rish — subscription.view (litsenziyalar ro'yxati — license.view). Tarif so'rovi — subscription.manage,
 * qo'shimcha litsenziyani uzaytirish — license.manage. To'lov shlyuzi ulanmagan: so'rov platforma adminiga
 * boradi, u to'lovni tasdiqlaganda obuna/litsenziya faollashadi. Obuna tugagan bo'lsa ham bu sahifa ochiq.
 */
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CreditCard, History, Loader2, ShieldAlert, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";
import { useCurrentUser } from "@/hooks/use-auth.ts";
import NewEmployeeDialog from "@/components/company/new-employee-dialog.tsx";
import {
  HISTORY_EVENT_LABEL,
  LICENSE_STATUS_LABEL,
  LICENSE_TYPE_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  durationText,
  formatDay,
  formatUzs,
  newIdempotencyKey,
  subscriptionBlocked,
  type CompanyLicense,
  type LicenseCounts,
  type PlansResponse,
  type SubscriptionHistory,
  type SubscriptionOverview,
  type SubscriptionPayment,
} from "@/lib/subscription.ts";

const INVALIDATE = ["/api/subscription", "/api/auth/me"];

const STATUS_TONE: Record<string, string> = {
  trial: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  expired: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  pending_payment: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  revoked: "bg-muted text-muted-foreground",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[tone])}>{children}</span>;
}

export default function SubscriptionPage() {
  const { can } = usePermissions();
  // Xodim qo'shishni server faqat kompaniya egasiga ruxsat beradi — tugma ham faqat unga ko'rinadi
  const currentUser = useCurrentUser();
  const activeCompany = useActiveCompany().data;
  const isOwner = Boolean(currentUser && activeCompany?.company.ownerId === currentUser.id);
  const overviewQuery = useApiQuery<SubscriptionOverview>("/api/subscription");
  const plans = useApiQuery<PlansResponse>("/api/subscription/plans").data;
  const overview = overviewQuery.data;

  const purchase = useApiMutation(
    (planId: string) => api.post<{ duplicate: boolean }>("/api/subscription/purchase", { planId, idempotencyKey: newIdempotencyKey("plan") }),
    { invalidate: INVALIDATE },
  );
  const cancel = useApiMutation((paymentId: string) => api.post(`/api/subscription/payments/${paymentId}/cancel`), { invalidate: INVALIDATE });

  const choosePlan = async (planId: string) => {
    try {
      await purchase.mutateAsync(planId);
      toast.success("To'lov so'rovi yuborildi. To'lov tasdiqlangach obuna faollashadi.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (overviewQuery.error) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{errorMessage(overviewQuery.error)}</CardContent>
        </Card>
      </div>
    );
  }

  const subscription = overview?.subscription ?? null;
  const blocked = subscriptionBlocked(subscription);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" /> Obuna va litsenziyalar
        </h1>
        <p className="text-sm text-muted-foreground">Tarif, foydalanuvchi litsenziyalari va to'lovlar</p>
      </div>

      {!overview ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className={cn(blocked && "border-destructive/40")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" />
                  {subscription?.planName ?? (subscription?.isTrial ? "Bepul sinov (trial)" : "Obuna")}
                </span>
                {subscription && <Pill tone={subscription.status}>{SUBSCRIPTION_STATUS_LABEL[subscription.status]}</Pill>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!subscription ? (
                <p className="text-sm text-muted-foreground">Obuna ma'lumoti topilmadi. Platforma admini bilan bog'laning.</p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Boshlangan</dt>
                      <dd className="font-medium">{formatDay(subscription.startAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Tugash sanasi</dt>
                      <dd className="font-medium">{subscription.expiresAt ? formatDay(subscription.expiresAt) : "Muddatsiz"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Qolgan</dt>
                      <dd className="font-medium">{subscription.daysLeft === null ? "—" : `${Math.max(0, subscription.daysLeft)} kun`}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Muddat</dt>
                      <dd className="font-medium">
                        {subscription.effectiveMonths > 0
                          ? durationText({ durationMonths: subscription.baseDurationMonths, bonusMonths: subscription.bonusMonths, effectiveMonths: subscription.effectiveMonths })
                          : subscription.isTrial
                            ? "25 kun"
                            : "—"}
                      </dd>
                    </div>
                  </dl>
                  {blocked && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                      <p className="font-semibold text-destructive flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4" /> BUM ERP obunangiz muddati tugagan.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Tugagan sana: {formatDay(subscription.expiresAt)}. Ma'lumotlaringiz saqlangan — obuna uzaytirilgach barcha bo'limlar qayta ochiladi.
                      </p>
                      <Button size="sm" onClick={() => document.getElementById("subscription-plans")?.scrollIntoView({ behavior: "smooth" })}>
                        OBUNANI UZAYTIRISH
                      </Button>
                    </div>
                  )}
                  {!blocked && subscription.trialWarning !== null && (
                    <p className="text-xs rounded-lg bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 px-3 py-2 flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5" /> Sinov muddati tugashiga {subscription.daysLeft} kun qoldi.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <LicenseCountsCard counts={overview.licenses} canAddUser={isOwner} />
        </div>
      )}

      {overview && overview.pendingPayments.length > 0 && (
        <PendingPayments
          payments={overview.pendingPayments}
          canCancel={can("subscription.manage")}
          pending={cancel.isPending}
          onCancel={(id) => {
            cancel.mutate(id, { onError: (err) => toast.error(errorMessage(err)) });
          }}
        />
      )}

      <section id="subscription-plans" className="space-y-3 scroll-mt-4">
        <h2 className="text-lg font-semibold">Tariflar</h2>
        {!plans ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {plans.main.map((plan) => (
                <Card key={plan.id} className={cn(subscription?.planId === plan.id && "border-primary")}>
                  <CardContent className="pt-5 space-y-3">
                    <div>
                      <p className="font-semibold">{plan.name}</p>
                      <p className="text-2xl font-bold tabular-nums">{formatUzs(plan.price)}</p>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>{durationText(plan)}</li>
                      <li>{plan.includedLicenses} ta foydalanuvchi litsenziyasi</li>
                      {plan.bonusMonths > 0 && <li className="text-emerald-600 dark:text-emerald-400 font-medium">+{plan.bonusMonths} oy bepul</li>}
                    </ul>
                    {can("subscription.manage") && (
                      <Button className="w-full" size="sm" disabled={purchase.isPending} onClick={() => { void choosePlan(plan.id); }}>
                        {purchase.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : subscription?.status === "active" ? "Uzaytirish" : "Tanlash"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardContent className="py-4 text-sm space-y-2">
                <p className="font-medium flex items-center gap-2"><Users className="h-4 w-4" /> Qo'shimcha foydalanuvchi litsenziyasi (har bir xodimga alohida)</p>
                <div className="flex flex-wrap gap-2">
                  {plans.additional.map((plan) => (
                    <span key={plan.id} className="rounded-lg border px-3 py-1.5 text-xs">
                      {durationText(plan)} — <strong>{formatUzs(plan.price)}</strong>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  4-foydalanuvchidan boshlab xodim qo'shishda tanlanadi. Bepul xodimlar (dasturdan foydalanmaydiganlar) litsenziya talab qilmaydi.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {can("license.view") && <LicensesSection plans={plans} canManage={can("license.manage")} />}
      {can("subscription.view") && <HistorySection />}
    </div>
  );
}

function LicenseCountsCard({ counts, canAddUser }: { counts: LicenseCounts | null; canAddUser: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const tiles = counts
    ? [
        { label: "Included", value: counts.includedTotal },
        { label: "Ishlatilgan", value: counts.includedUsed },
        { label: "Qo'shimcha", value: counts.additionalActive },
        { label: "Jami faol", value: counts.totalActive },
        { label: "Bo'sh", value: counts.includedAvailable },
      ]
    : [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Foydalanuvchi litsenziyalari</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-lg bg-muted/50 px-2 py-2 text-center">
              <p className="text-xl font-bold tabular-nums">{tile.value}</p>
              <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            </div>
          ))}
        </div>
        {counts && counts.additionalPending > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">{counts.additionalPending} ta qo'shimcha litsenziya to'lovi kutilmoqda.</p>
        )}
        <p className="text-xs text-muted-foreground">Kompaniya egasi ham bitta included litsenziyani egallaydi. Bepul xodimlar hisoblanmaydi.</p>

        {canAddUser && (
          <div className="border-t border-border pt-3 space-y-2">
            {counts && counts.includedAvailable === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Bo'sh included litsenziya yo'q — yangi foydalanuvchi uchun qo'shimcha litsenziya tarifi tanlanadi.
              </p>
            )}
            <Button variant="outline" className="w-full" data-testid="add-user" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Foydalanuvchi qo'shish
            </Button>
          </div>
        )}
        <NewEmployeeDialog open={addOpen} onClose={() => setAddOpen(false)} />
      </CardContent>
    </Card>
  );
}

function PendingPayments({
  payments,
  canCancel,
  pending,
  onCancel,
}: {
  payments: SubscriptionPayment[];
  canCancel: boolean;
  pending: boolean;
  onCancel: (paymentId: string) => void;
}) {
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Kutilayotgan to'lovlar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {payments.map((payment) => (
          <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
            <div>
              <p className="font-medium">
                {payment.kind === "subscription" ? "Obuna" : `Qo'shimcha litsenziya — ${payment.licenseUserName ?? payment.licenseUserPhone ?? ""}`}: {payment.planName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatUzs(payment.amount)} · {formatDay(payment.createdAt)} · to'lov tasdiqlanishini kuting
              </p>
            </div>
            {canCancel && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onCancel(payment.id)}>
                Bekor qilish
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LicensesSection({ plans, canManage }: { plans: PlansResponse | undefined; canManage: boolean }) {
  const query = useApiQuery<{ licenses: CompanyLicense[]; counts: LicenseCounts }>("/api/subscription/licenses");
  const [planByLicense, setPlanByLicense] = useState<Record<string, string>>({});
  const renew = useApiMutation(
    ({ licenseId, planId }: { licenseId: string; planId: string }) =>
      api.post(`/api/subscription/licenses/${licenseId}/purchase`, { planId, idempotencyKey: newIdempotencyKey("license") }),
    { invalidate: INVALIDATE },
  );

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Litsenziyalar</h2>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {query.error ? (
            <p className="p-6 text-sm text-muted-foreground">{errorMessage(query.error)}</p>
          ) : !query.data ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Foydalanuvchi</th>
                  <th className="text-left px-4 py-2 font-medium">Turi</th>
                  <th className="text-left px-4 py-2 font-medium">Holat</th>
                  <th className="text-left px-4 py-2 font-medium">Tugaydi</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {query.data.licenses.map((license) => {
                  const expired = license.licenseType === "additional" && license.expiresAt !== null && new Date(license.expiresAt).getTime() <= query.dataUpdatedAt;
                  const status = expired ? "expired" : license.status;
                  const selected = planByLicense[license.id] ?? "";
                  return (
                    <tr key={license.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium">
                          {license.employeeName ?? license.userName ?? "—"}
                          {license.isOwner && <span className="ml-1.5 text-xs text-muted-foreground">(egasi)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">{license.userPhone}{license.companyRole ? ` · ${license.companyRole}` : ""}</p>
                      </td>
                      <td className="px-4 py-2">{LICENSE_TYPE_LABEL[license.licenseType]}{license.planName ? <span className="text-xs text-muted-foreground"> · {license.planName}</span> : null}</td>
                      <td className="px-4 py-2"><Pill tone={status}>{LICENSE_STATUS_LABEL[status]}</Pill></td>
                      <td className="px-4 py-2 text-xs">{license.licenseType === "included" ? "Obuna bilan" : formatDay(license.expiresAt)}</td>
                      {canManage && (
                        <td className="px-4 py-2">
                          {license.licenseType === "additional" && plans && (
                            <div className="flex items-center justify-end gap-2">
                              <Select value={selected} onValueChange={(value) => setPlanByLicense((current) => ({ ...current, [license.id]: value }))}>
                                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Tarif tanlang" /></SelectTrigger>
                                <SelectContent position="popper">
                                  {plans.additional.map((plan) => (
                                    <SelectItem key={plan.id} value={plan.id}>{durationText(plan)} — {formatUzs(plan.price)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!selected || renew.isPending}
                                onClick={() =>
                                  renew.mutate(
                                    { licenseId: license.id, planId: selected },
                                    {
                                      onSuccess: () => toast.success("To'lov so'rovi yuborildi"),
                                      onError: (err) => toast.error(errorMessage(err)),
                                    },
                                  )
                                }
                              >
                                {license.status === "pending_payment" ? "To'lash" : "Uzaytirish"}
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function HistorySection() {
  const history = useApiQuery<SubscriptionHistory>("/api/subscription/history", { limit: 50 }).data;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><History className="h-4 w-4" /> Tarix</h2>
      {!history ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Obuna</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {history.subscriptions.length === 0 && <p className="text-muted-foreground text-xs">Yozuvlar yo'q</p>}
              {history.subscriptions.map((row) => (
                <div key={row.id} className="border-b last:border-0 pb-2">
                  <p className="font-medium">{HISTORY_EVENT_LABEL[row.event] ?? row.event}{row.planName ? ` — ${row.planName}` : ""}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(row.createdAt)}
                    {row.effectiveMonths > 0 ? ` · ${row.durationMonths} oy + ${row.bonusMonths} bonus = ${row.effectiveMonths} oy` : ""}
                    {Number(row.price) > 0 ? ` · ${formatUzs(row.price)}` : ""}
                    {row.expiresAt ? ` · ${formatDay(row.startAt)} — ${formatDay(row.expiresAt)}` : ""}
                    {row.paymentReference ? ` · to'lov: ${row.paymentReference}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Litsenziyalar</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {history.licenses.length === 0 && <p className="text-muted-foreground text-xs">Yozuvlar yo'q</p>}
              {history.licenses.map((row) => (
                <div key={row.id} className="border-b last:border-0 pb-2">
                  <p className="font-medium">
                    {HISTORY_EVENT_LABEL[row.event] ?? row.event} — {row.employeeName ?? row.userName ?? row.userPhone ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(row.createdAt)} · {LICENSE_TYPE_LABEL[row.licenseType]}
                    {row.planName ? ` · ${row.planName}` : ""}
                    {Number(row.price) > 0 ? ` · ${formatUzs(row.price)}` : ""}
                    {row.expiresAt ? ` · ${formatDay(row.expiresAt)} gacha` : ""}
                    {row.actorName ? ` · ${row.actorName}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

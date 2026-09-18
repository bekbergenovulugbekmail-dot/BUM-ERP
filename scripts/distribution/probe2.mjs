/**
 * F. To'liq to'langan chekdan qaytarish: pul qayerga ketadi?
 * (naqd qaytarish va balansga qaytarish alohida).
 */
import { call, raw, state, RUN, phoneFor, money, today, sectionCompany, sectionEmployees, sectionInfrastructure, sectionCatalog } from "./lib.mjs";

await sectionCompany();
await sectionEmployees();
await sectionInfrastructure();
await sectionCatalog();

const customer = (await call("owner", "POST", "/api/sales/customers", {
  name: `Probe F ${RUN}`,
  phone: phoneFor(76),
  creditLimit: "9000000",
})).customer;

const snapshot = async (label) => {
  const c = (await call("owner", "GET", `/api/sales/customers/${customer.id}`)).customer;
  const accounts = (await call("owner", "GET", "/api/finance/cash-accounts?includeInactive=true")).cashAccounts;
  const cash = accounts.find((a) => a.id === state.cashAccounts.main);
  return `${label}: totalDebt=${c.totalDebt} balance=${c.balance} | kassa=${cash.balance}`;
};

/** To'liq to'langan, yakunlangan chek yaratadi. */
async function paidOrder(productIndex, quantity) {
  const created = await call("owner", "POST", "/api/sales/orders", {
    customerId: customer.id,
    warehouseId: state.warehouses.main,
    orderDate: today(),
    deliveryRequired: false,
    items: [{ productId: state.products[productIndex].id, quantity: String(quantity) }],
  });
  const id = created.order.id;
  await call("owner", "POST", `/api/sales/orders/${id}/confirm`, {});
  await call("owner", "POST", `/api/sales/orders/${id}/ship`, {});
  const order = (await call("owner", "GET", `/api/sales/orders/${id}`)).order;
  await call("owner", "POST", "/api/sales/payments", {
    customerId: customer.id,
    orderId: id,
    parts: [{ method: "cash", amount: String(money(order.totalAmount)) }],
    paymentDate: today(),
    reference: `probe-f-${RUN}-${productIndex}`,
  });
  return (await call("owner", "GET", `/api/sales/orders/${id}`)).order;
}

// ── F1: to'langan chek → BALANSGA qaytarish ─────────────────────────────────
{
  const order = await paidOrder(4, 10);
  const lines = [`chek=${order.number} summa=${order.totalAmount} to'langan=${order.paidAmount ?? order.totalPaid}`];
  lines.push(await snapshot("qaytarishdan oldin"));
  const res = await raw("owner", "POST", `/api/sales/orders/${order.id}/return-items`, {
    items: [{ orderItemId: order.items[0].id, quantity: "4" }],
    refundMethod: "balance",
    reason: "Probe F1",
  });
  lines.push(`qaytarish (balans) -> ${res.status} ${res.body?.message ?? ""}`);
  lines.push(await snapshot("qaytarishdan keyin"));
  const history = await call("owner", "GET", `/api/sales/customers/${customer.id}/balance?limit=10`);
  lines.push(`balans tarixi: ${JSON.stringify(history.entries ?? history.history ?? history).slice(0, 300)}`);
  console.log("\n### F1. To'langan chek -> balansga qaytarish\n" + lines.join("\n"));
}

// ── F2: to'langan chek → NAQD qaytarish ─────────────────────────────────────
{
  const order = await paidOrder(5, 10);
  const lines = [`chek=${order.number} summa=${order.totalAmount}`];
  lines.push(await snapshot("qaytarishdan oldin"));
  const res = await raw("owner", "POST", `/api/sales/orders/${order.id}/return-items`, {
    items: [{ orderItemId: order.items[0].id, quantity: "4" }],
    refundMethod: "cash",
    reason: "Probe F2",
  });
  lines.push(`qaytarish (naqd) -> ${res.status} ${res.body?.message ?? ""}`);
  lines.push(await snapshot("qaytarishdan keyin"));
  console.log("\n### F2. To'langan chek -> naqd qaytarish\n" + lines.join("\n"));
}

process.exit(0);

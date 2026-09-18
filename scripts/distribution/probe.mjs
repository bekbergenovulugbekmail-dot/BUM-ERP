/**
 * Topilmalarni aniqlashtirish uchun nuqtali tekshiruvlar (reproduktsiya).
 * Har biri alohida, yangi kompaniyada — boshqa natijalarga ta'sir qilmaydi.
 */
import { call, raw, loginAs, state, RUN, PASSWORD, phoneFor, money, today, sectionCompany, sectionEmployees, sectionInfrastructure, sectionCatalog } from "./lib.mjs";
import { near } from "./flows.mjs";

const log = (name, detail) => console.log(`\n### ${name}\n${detail}`);

await sectionCompany();
await sectionEmployees();
await sectionInfrastructure();
await sectionCatalog();

const customer = (await call("owner", "POST", "/api/sales/customers", {
  name: `Probe mijoz ${RUN}`,
  phone: phoneFor(75),
  latitude: 41.311081,
  longitude: 69.240562,
  creditLimit: "9000000",
})).customer;

// ─── A. Yetkazib bo'lmaganda sotuv holati ────────────────────────────────────
{
  const created = await call("owner", "POST", "/api/sales/orders", {
    customerId: customer.id,
    warehouseId: state.warehouses.main,
    orderDate: today(),
    deliveryRequired: true,
    items: [{ productId: state.products[5].id, quantity: "5" }],
  });
  const id = created.order.id;
  const at = async (label) => {
    const order = (await call("owner", "GET", `/api/sales/orders/${id}`)).order;
    return `${label}: status=${order.status} paid=${order.paidAmount ?? order.totalPaid} delivery=${order.fulfillmentMethod}`;
  };
  const steps = [await at("yaratildi")];
  await call("owner", "POST", `/api/sales/orders/${id}/confirm`, {});
  steps.push(await at("tasdiqlandi"));

  await call("owner", "PUT", "/api/delivery/policy", {
    ...(await call("owner", "GET", "/api/delivery/policy")).policy,
    deliveryRequiredByDefault: true,
    geofenceRadiusMeters: 500,
    confirmation: { otp: false, signature: false, photo: false },
  });
  const tasks = await call("owner", "GET", "/api/delivery/tasks?limit=50");
  const task = tasks.tasks.find((t) => t.orderId === id);
  const agents = await call("owner", "GET", "/api/delivery/agents");
  await call("owner", "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: agents.agents[0].id });
  await call("courier1", "POST", "/api/delivery/agent/work-session/start", near(20)).catch(() => null);
  await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/accept`, { clientRequestId: crypto.randomUUID() });
  steps.push(await at("agent qabul qildi"));
  await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/start`, { clientRequestId: crypto.randomUUID() });
  steps.push(await at("yo'lga chiqdi (tovar ombordan chiqdi)"));
  await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/fail`, {
    clientRequestId: crypto.randomUUID(),
    reason: "customer_absent",
    ...near(20),
  });
  steps.push(await at("YETKAZIB BO'LMADI"));
  const after = (await call("owner", "GET", "/api/delivery/tasks?limit=50")).tasks.find((t) => t.orderId === id);
  const debt = (await call("owner", "GET", `/api/sales/customers/${customer.id}`)).customer;
  steps.push(`yetkazma=${after.status}; mijoz: totalDebt=${debt.totalDebt} balance=${debt.balance}`);
  // Supervayzer qaytgan tovarni qabul qiladi — holat tiklanadimi?
  const returned = await raw("owner", "POST", `/api/delivery/tasks/${task.id}/return`, {
    refundMethod: "balance",
    reason: "Probe: yetkazilmadi, tovar omborga",
  });
  steps.push(`qaytarish -> ${returned.status} ${returned.body?.message ?? ""}`);
  steps.push(await at("qaytarishdan keyin"));
  const restored = (await call("owner", "GET", `/api/sales/customers/${customer.id}`)).customer;
  steps.push(`mijoz: totalDebt=${restored.totalDebt} balance=${restored.balance}`);
  log("A. Yetkazib bo'lmaganda sotuv holati", steps.join("\n"));
}

// ─── B. Balansga qaytarish qarzni kamaytiradimi ──────────────────────────────
{
  const created = await call("owner", "POST", "/api/sales/orders", {
    customerId: customer.id,
    warehouseId: state.warehouses.main,
    orderDate: today(),
    deliveryRequired: false,
    items: [{ productId: state.products[4].id, quantity: "10" }],
  });
  const id = created.order.id;
  await call("owner", "POST", `/api/sales/orders/${id}/confirm`, {});
  const shipped = await raw("owner", "POST", `/api/sales/orders/${id}/ship`, {});
  console.log(`   (B: jo'natish -> ${shipped.status})`);
  const before = (await call("owner", "GET", `/api/sales/customers/${customer.id}`)).customer;
  const order = (await call("owner", "GET", `/api/sales/orders/${id}`)).order;
  await call("owner", "POST", `/api/sales/orders/${id}/return-items`, {
    items: [{ orderItemId: order.items[0].id, quantity: "4" }],
    refundMethod: "balance",
    reason: "Probe",
  });
  const after = (await call("owner", "GET", `/api/sales/customers/${customer.id}`)).customer;
  log(
    "B. Balansga qaytarish",
    [
      `buyurtma=${order.number} summa=${order.totalAmount}`,
      `oldin: totalDebt=${before.totalDebt} balance=${before.balance} cashback=${before.cashbackBalance ?? "-"}`,
      `keyin: totalDebt=${after.totalDebt} balance=${after.balance} cashback=${after.cashbackBalance ?? "-"}`,
    ].join("\n"),
  );
}

// ─── D. Zaxiradan ortiq buyurtma qayerda to'xtaydi ───────────────────────────
{
  const product = state.products[3];
  const stock = (await call("owner", "GET", `/api/inventory/stock/products/${product.id}`)).stock.reduce(
    (sum, row) => sum + money(row.quantity),
    0,
  );
  const created = await raw("owner", "POST", "/api/sales/orders", {
    customerId: customer.id,
    warehouseId: state.warehouses.main,
    orderDate: today(),
    deliveryRequired: true,
    items: [{ productId: product.id, quantity: String(stock + 1000) }],
  });
  const steps = [`zaxira=${stock}, buyurtma miqdori=${stock + 1000}`, `yaratish → ${created.status}`];
  if (created.status === 201) {
    const confirmed = await raw("owner", "POST", `/api/sales/orders/${created.body.order.id}/confirm`, {});
    steps.push(`tasdiqlash → ${confirmed.status} ${confirmed.body?.message ?? ""}`);
    const tasks = await call("owner", "GET", "/api/delivery/tasks?limit=50");
    const task = tasks.tasks.find((t) => t.orderId === created.body.order.id);
    steps.push(`yetkazma vazifasi: ${task ? task.status : "yo'q"}`);
    if (task) {
      const agents = await call("owner", "GET", "/api/delivery/agents");
      await call("owner", "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: agents.agents[0].id });
      await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/accept`, { clientRequestId: crypto.randomUUID() });
      const started = await raw("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/start`, { clientRequestId: crypto.randomUUID() });
      steps.push(`yo'lga chiqish (tovar chiqimi) → ${started.status} ${started.body?.message ?? ""}`);
    }
    const after = (await call("owner", "GET", `/api/inventory/stock/products/${product.id}`)).stock.reduce(
      (sum, row) => sum + money(row.quantity),
      0,
    );
    steps.push(`zaxira keyin=${after}`);
  }
  log("D. Zaxiradan ortiq buyurtma", steps.join("\n"));
}

// ─── E. Takroriy to'lov (reference) ──────────────────────────────────────────
{
  const reference = `probe-dup-${RUN}`;
  const payload = {
    customerId: customer.id,
    parts: [{ method: "cash", amount: "1000" }],
    paymentDate: today(),
    reference,
  };
  const first = await raw("owner", "POST", "/api/sales/payments", payload);
  const second = await raw("owner", "POST", "/api/sales/payments", payload);
  const list = await call("owner", "GET", `/api/sales/payments?customerId=${customer.id}&limit=50`);
  log(
    "E. Takroriy to'lov",
    [
      `1-so'rov → ${first.status}, 2-so'rov → ${second.status}`,
      `ro'yxatdagi to'lovlar: ${list.payments.length}`,
      `maydonlar: ${Object.keys(list.payments[0] ?? {}).join(", ")}`,
      `reference qiymatlari: ${list.payments.map((p) => p.reference ?? "(yo'q)").join(" | ")}`,
    ].join("\n"),
  );
}

process.exit(0);

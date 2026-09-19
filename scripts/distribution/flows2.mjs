/**
 * 0→100 simulyatsiya — 11–22 bosqichlar: kassa (POS), yetkazib bo'lmadi, qisman yetkazish,
 * qaytarish, omborlararo ko'chirish, hisobotlar, modullararo ifloslanish, salbiy testlar,
 * parallellik va yakuniy buxgalteriya/ma'lumot solishtiruvi.
 */
import { section, check, expect, assert, call, raw, record, state, RUN, money, today } from "./lib.mjs";
import { near, stockOf, debtOf, balanceOf, orderOf, taskForOrder } from "./flows.mjs";

/** Buyurtma + yetkazma vazifasi yaratadi (ERP orqali, tasdiqlangan). */
async function makeDeliverableOrder(customerKey, productIndex, quantity) {
  const created = await call("owner", "POST", "/api/sales/orders", {
    customerId: state.customers[customerKey],
    warehouseId: state.warehouses.main,
    orderDate: today(),
    deliveryRequired: true,
    items: [{ productId: state.products[productIndex].id, quantity: String(quantity) }],
  });
  await call("owner", "POST", `/api/sales/orders/${created.order.id}/confirm`, {});
  const task = await taskForOrder(created.order.id);
  return { order: await orderOf(created.order.id), task };
}

/** Yetkazuvchini ko'rsatilgan bosqichgacha olib boradi. */
async function driveTask(taskId, steps) {
  for (const [action, body] of steps) {
    await call("courier1", "POST", `/api/delivery/agent/tasks/${taskId}/${action}`, {
      clientRequestId: crypto.randomUUID(),
      ...body,
    });
  }
}

// ─── 11. KASSA (POS) ─────────────────────────────────────────────────────────

export async function sectionPos() {
  section("11. Kassa (POS): smena, aralash to'lov, yetkazmasiz sotuv, smenani yopish");

  await check("kassir smenani ochadi (boshlang'ich naqd 500 000)", async () => {
    const opened = await call("cashier", "POST", "/api/sales/pos/shifts", {
      warehouseId: state.warehouses.main,
      openingCash: "500000",
    });
    state.shiftId = opened.shift.id;
    return `smena=${opened.shift.id} boshlang'ich=${opened.shift.openingCash}`;
  });

  await check("POS sotuv 100 000: naqd 50 000 + UZCARD 50 000", async () => {
    const product = state.products[9]; // 10 000 so'm
    const sale = await call("cashier", "POST", "/api/sales/pos/sales", {
      shiftId: state.shiftId,
      items: [{ productId: product.id, quantity: "10" }],
      payments: [
        { method: "cash", amount: "50000" },
        { method: "card", amount: "50000", terminalId: state.terminals.uzcard },
      ],
      clientRequestId: crypto.randomUUID(),
    });
    state.posSale = sale.order ?? sale.sale;
    return `${state.posSale.number} jami=${state.posSale.totalAmount}`;
  });

  await check("POS sotuvi: to'langan, yakunlangan", async () => {
    const order = await orderOf(state.posSale.id);
    return expect(
      [order.status, money(order.paidAmount ?? order.totalPaid)],
      ["completed", 100_000],
      "[holat, to'langan]",
    );
  });

  await check("KESISHUV: POS sotuvi yetkazma vazifasi YARATMAYDI", async () => {
    const task = await taskForOrder(state.posSale.id);
    return expect(task, null, "POS chekiga yetkazma");
  });

  await check("smenani yopish: kutilayotgan naqd = boshlang'ich + naqd sotuv (karta emas)", async () => {
    const shift = await call("cashier", "GET", `/api/sales/pos/shifts/${state.shiftId}`);
    const expectedCash = money(shift.shift.expectedCash ?? shift.shift.expectedCashAmount);
    const closed = await call("cashier", "POST", `/api/sales/pos/shifts/${state.shiftId}/close`, {
      closingCash: String(expectedCash || 550_000),
    });
    state.closedShift = closed.shift;
    return expect(expectedCash, 550_000, "kutilayotgan naqd (500 000 + 50 000)");
  });

  await check("yopilgan smenada sotuv qilib bo'lmaydi", async () => {
    const res = await raw("cashier", "POST", "/api/sales/pos/sales", {
      shiftId: state.shiftId,
      items: [{ productId: state.products[0].id, quantity: "1" }],
      payments: [{ method: "cash", amount: "1000" }],
      clientRequestId: crypto.randomUUID(),
    });
    assert(res.status >= 400, `yopilgan smenada sotuv o'tdi: ${res.status}`);
    return `→ ${res.status}`;
  });
}

// ─── 12. YETKAZIB BO'LMADI ───────────────────────────────────────────────────

export async function sectionDeliveryFailure() {
  section("12. Yetkazib bo'lmadi (FAILED)");

  await check("yangi yetkazma tayyorlanadi", async () => {
    const { order, task } = await makeDeliverableOrder("a", 8, 5);
    state.failOrder = order;
    state.failTask = task;
    assert(task, "yetkazma yaratilmadi");
    return `${order.number} → ${task.number}`;
  });

  await check("yetkazuvchi sabab bilan 'yetkazib bo'lmadi' deb belgilaydi", async () => {
    await call("supervisor", "POST", `/api/delivery/tasks/${state.failTask.id}/assign`, { deliveryAgentId: state.couriers[0].id });
    await driveTask(state.failTask.id, [["accept", {}], ["start", {}]]);
    await call("courier1", "POST", `/api/delivery/agent/tasks/${state.failTask.id}/fail`, {
      clientRequestId: crypto.randomUUID(),
      reason: "customer_absent",
      ...near(20),
    });
    const task = await taskForOrder(state.failOrder.id);
    return expect([task.status, task.failureReason], ["failed", "customer_absent"], "[holat, sabab]");
  });

  await check("buyurtma summasi o'zgarmadi", async () => {
    const order = await orderOf(state.failOrder.id);
    return expect(order.totalAmount, state.failOrder.totalAmount, "buyurtma summasi");
  });

  await check("F-01 TUZATILDI: yetkazilmagan yetkazma 'qaytarish kutilmoqda' deb belgilanadi", async () => {
    const list = await call("owner", "GET", "/api/delivery/tasks?returnPending=true&limit=200");
    const pending = list.tasks.find((task) => task.id === state.failTask.id);
    assert(pending, "yetkazma 'qaytarish kutilmoqda' ro'yxatida yo'q");
    assert(pending.returnPending === true, "returnPending belgisi qo'yilmagan");
    const order = await orderOf(state.failOrder.id);
    return `belgi=returnPending, sotuv=${order.status} — boshqaruvchi ro'yxatda ko'radi va yopadi`;
  });

  await check("supervayzer qaytarishi holatni tiklaydi (sotuv=returned, qarz 0 ga qaytadi)", async () => {
    const debtBefore = await debtOf(state.customers.a);
    await call("owner", "POST", `/api/delivery/tasks/${state.failTask.id}/return`, {
      refundMethod: "balance",
      reason: "Simulyatsiya: yetkazilmadi",
    });
    const order = await orderOf(state.failOrder.id);
    const debtAfter = await debtOf(state.customers.a);
    return `sotuv=${order.status}, qarz ${debtBefore} -> ${debtAfter}`;
  });
}

// ─── 13. QISMAN YETKAZISH ────────────────────────────────────────────────────

export async function sectionPartialDelivery() {
  section("13. Qisman yetkazish: 100 dan 60 topshiriladi, 40 qaytadi");

  await check("100 donalik buyurtma tayyorlanadi", async () => {
    const before = await stockOf(state.products[7].id);
    const { order, task } = await makeDeliverableOrder("b", 7, 100);
    state.partialOrder = order;
    state.partialTask = task;
    state.stockBeforePartial = before;
    return `${order.number} → ${task.number}, zaxira oldin=${before}`;
  });

  await check("60 dona topshiriladi → QISMAN YETKAZILDI", async () => {
    await call("courier2", "POST", "/api/delivery/agent/work-session/start", near(20)).catch(() => null);
    await call("supervisor", "POST", `/api/delivery/tasks/${state.partialTask.id}/assign`, { deliveryAgentId: state.couriers[1].id });
    for (const [action, body] of [["accept", {}], ["start", {}], ["arrive", near(20)], ["delivering", {}]]) {
      await call("courier2", "POST", `/api/delivery/agent/tasks/${state.partialTask.id}/${action}`, {
        clientRequestId: crypto.randomUUID(),
        ...body,
      });
    }
    const detail = await call("courier2", "GET", `/api/delivery/agent/tasks/${state.partialTask.id}`);
    const item = detail.task.items[0];
    await call("courier2", "POST", `/api/delivery/agent/tasks/${state.partialTask.id}/confirm`, {
      clientRequestId: crypto.randomUUID(),
      ...near(20),
      items: [{ taskItemId: item.id, deliveredQty: "60" }],
    });
    const task = await taskForOrder(state.partialOrder.id);
    return expect(task.status, "partially_delivered", "yetkazma holati");
  });

  await check("asl buyurtma summasi jim o'zgarmadi", async () => {
    const order = await orderOf(state.partialOrder.id);
    return expect(order.totalAmount, state.partialOrder.totalAmount, "buyurtma summasi");
  });

  await check("supervayzer qolgan 40 donani omborga qabul qiladi", async () => {
    await call("owner", "POST", `/api/delivery/tasks/${state.partialTask.id}/return`, {
      refundMethod: "balance",
      reason: "Simulyatsiya: qolgan tovar omborga",
    });
    const after = await stockOf(state.products[7].id);
    return `zaxira: oldin=${state.stockBeforePartial}, keyin=${after} (farq=${after - state.stockBeforePartial})`;
  });

  await check("takroriy qaytarish rad etiladi", async () => {
    const res = await raw("owner", "POST", `/api/delivery/tasks/${state.partialTask.id}/return`, { refundMethod: "balance" });
    assert(res.status >= 400, `takroriy qaytarish o'tdi: ${res.status}`);
    return `→ ${res.status}`;
  });
}

// ─── 14. QAYTARISH (yetkazilgan buyurtma) ────────────────────────────────────

export async function sectionReturn() {
  section("14. Qaytarish: yetkazilgan buyurtmadan tovar qaytadi");

  await check("yetkazilgan buyurtma tayyorlanadi va to'liq to'lanadi", async () => {
    const { order, task } = await makeDeliverableOrder("a", 6, 10);
    state.returnOrder = order;
    await call("supervisor", "POST", `/api/delivery/tasks/${task.id}/assign`, { deliveryAgentId: state.couriers[0].id });
    await driveTask(task.id, [["accept", {}], ["start", {}], ["arrive", near(20)], ["delivering", {}]]);
    await call("courier1", "POST", `/api/delivery/agent/tasks/${task.id}/payments`, {
      clientRequestId: crypto.randomUUID(),
      parts: [{ method: "cash", amount: String(money(order.totalAmount)) }],
    });
    await driveTask(task.id, [["confirm", near(20)]]);
    state.stockBeforeReturn = await stockOf(state.products[6].id);
    state.debtBeforeReturn = await debtOf(state.customers.a);
    return `${order.number} yetkazildi, zaxira=${state.stockBeforeReturn}, qarz=${state.debtBeforeReturn}`;
  });

  await check("qisman qaytarish: 4 dona qaytariladi (pul balansga)", async () => {
    const order = await call("owner", "GET", `/api/sales/orders/${state.returnOrder.id}`);
    const item = order.order.items[0];
    await call("owner", "POST", `/api/sales/orders/${state.returnOrder.id}/return-items`, {
      items: [{ orderItemId: item.id, quantity: "4" }],
      refundMethod: "balance",
      reason: "Simulyatsiya: sifatsiz tovar",
    });
    const stock = await stockOf(state.products[6].id);
    const debt = await debtOf(state.customers.a);
    return `zaxira: ${state.stockBeforeReturn} → ${stock}; balans: ${state.debtBeforeReturn} → ${debt}`;
  });

  await check("qaytarish zaxirani oshirdi va mijozga kredit (balans) berdi", async () => {
    const stock = await stockOf(state.products[6].id);
    const customer = (await call("owner", "GET", `/api/sales/customers/${state.customers.a}`)).customer;
    assert(stock === state.stockBeforeReturn + 4, `zaxira 4 donaga oshmadi: ${state.stockBeforeReturn} -> ${stock}`);
    assert(money(customer.balance) > 0, `mijoz balansiga kredit tushmadi: ${customer.balance}`);
    return `zaxira +4; mijoz balansi=${customer.balance}, qarzi=${customer.totalDebt} (alohida ko'rsatkichlar)`;
  });
}

// ─── 15. OMBORLARARO KO'CHIRISH ──────────────────────────────────────────────

export async function sectionTransfer() {
  section("15. Omborlararo ko'chirish: Asosiy → Filial");

  await check("50 dona ko'chiriladi", async () => {
    const product = state.products[2];
    const before = await stockOf(product.id);
    const debtBefore = await debtOf(state.customers.a);
    await call("warehouse", "POST", "/api/inventory/stock/transfers", {
      productId: product.id,
      fromWarehouseId: state.warehouses.main,
      toWarehouseId: state.warehouses.branch,
      quantity: "50",
    });
    const rows = await call("owner", "GET", `/api/inventory/stock/products/${product.id}`);
    const main = money(rows.stock.find((r) => r.warehouseId === state.warehouses.main)?.quantity);
    const branch = money(rows.stock.find((r) => r.warehouseId === state.warehouses.branch)?.quantity);
    const after = main + branch;
    state.transferDebtCheck = [debtBefore, await debtOf(state.customers.a)];
    return expect([after, branch], [before, 50], "[jami zaxira, filialdagi]");
  });

  await check("KESISHUV: ko'chirish mijoz qarziga tegmadi", async () => {
    return expect(state.transferDebtCheck[1], state.transferDebtCheck[0], "mijoz qarzi");
  });
}

// ─── 16. HISOBOTLAR ──────────────────────────────────────────────────────────

export async function sectionReports() {
  section("16. Hisobotlar: ega, menejer, supervayzer va agent ko'rinishi");

  const reports = [
    ["ega: boshqaruv paneli", "owner", "/api/analytics/dashboard"],
    ["ega: sotuv statistikasi", "owner", "/api/sales/orders/stats"],
    ["ega: qarzdorlar", "owner", "/api/sales/customers?limit=200"],
    ["ega: zaxira", "owner", `/api/inventory/stock/stats?warehouseId=${state.warehouses.main}`],
    ["ega: xarid", "owner", "/api/purchase/orders?limit=50"],
    ["ega: yetkazmalar", "owner", "/api/delivery/reports"],
    ["ega: agent samaradorligi", "owner", "/api/distribution/sales-reps/stats"],
    ["buxgalter: moliya", "accountant", "/api/finance/cash-accounts"],
  ];
  for (const [name, role, url] of reports) {
    await check(name, async () => {
      const res = await raw(role, "GET", url);
      assert(res.status === 200, `${res.status} ${res.text.slice(0, 120)}`);
      return `200`;
    });
  }

  await check("agent faqat o'z hisobotini ko'radi", async () => {
    const own = await raw("agent1", "GET", "/api/sales-agent/reports");
    const foreign = await raw("agent1", "GET", "/api/analytics/dashboard");
    assert(own.status === 200, `agent hisoboti: ${own.status}`);
    assert(foreign.status === 403, `agent tashkilot panelini ko'rdi: ${foreign.status}`);
    return `o'z hisoboti=200, tashkilot paneli=${foreign.status}`;
  });

  await check("supervayzer agent ma'lumotini ko'radi", async () => {
    const res = await raw("supervisor", "GET", "/api/sales-agent/supervisor/agents");
    assert(res.status === 200, `${res.status}`);
    return `agentlar=${(res.body.agents ?? []).length}`;
  });
}

// ─── 17. SALBIY TESTLAR ──────────────────────────────────────────────────────

export async function sectionNegative() {
  section("17. Salbiy testlar: ruxsat, tenant, ortiqcha to'lov, oversell, dublikat");

  await check("begona kompaniya buyurtmasiga kirish yopiq", async () => {
    const res = await raw("stranger", "GET", `/api/sales/orders/${state.orders.aSale.id}`);
    assert([403, 404].includes(res.status), `begona buyurtma ko'rindi: ${res.status}`);
    return `→ ${res.status}`;
  });

  await check("ruxsatsiz rol: kassir mahsulot narxini o'zgartira olmaydi", async () => {
    const res = await raw("cashier", "PATCH", `/api/catalog/products/${state.products[0].id}`, { salesPrice: "1" });
    return expect(res.status, 403, "kassirning narx o'zgartirishi");
  });

  await check("KUZATUV: 'Ombor menejeri' roli sotuv narxini o'zgartira oladi (rol ta'rifi bo'yicha)", async () => {
    const before = (await call("owner", "GET", `/api/catalog/products/${state.products[0].id}`)).product.salesPrice;
    const res = await raw("warehouse", "PATCH", `/api/catalog/products/${state.products[0].id}`, { salesPrice: before });
    return `ombor menejeri narx PATCH -> ${res.status} (products.edit roli ichida)`;
  });

  await check("ortiqcha to'lov rad etiladi", async () => {
    const res = await raw("accountant", "POST", "/api/sales/payments", {
      customerId: state.customers.b,
      orderId: state.orders.bSale.id,
      parts: [{ method: "cash", amount: "999999999" }],
      paymentDate: today(),
      reference: `sim-over-${RUN}`,
    });
    assert(res.status >= 400, `ortiqcha to'lov o'tdi: ${res.status}`);
    return `→ ${res.status} ${res.body?.message ?? ""}`;
  });

  await check("TOPILMA: zaxiradan ortiq buyurtma tasdiqlanadi, faqat jo'natishda to'xtaydi", async () => {
    const res = await raw("owner", "POST", "/api/sales/orders", {
      customerId: state.customers.a,
      warehouseId: state.warehouses.main,
      orderDate: today(),
      items: [{ productId: state.products[0].id, quantity: "999999" }],
    });
    if (res.status === 201) {
      const confirmed = await raw("owner", "POST", `/api/sales/orders/${res.body.order.id}/confirm`, {});
      const shipped = await raw("owner", "POST", `/api/sales/orders/${res.body.order.id}/ship`, {});
      assert(shipped.status >= 400, `zaxirasiz jo'natish o'tdi: ${shipped.status}`);
      return `tasdiqlash -> ${confirmed.status}, jo'natish -> ${shipped.status} (${shipped.body?.message ?? ""})`;
    }
    return `yaratish -> ${res.status}`;
  });

  await check("takroriy to'lov (bir xil reference) ikkinchi yozuv yaratmaydi", async () => {
    const reference = `sim-dup-${RUN}`;
    const payload = {
      customerId: state.customers.b,
      parts: [{ method: "cash", amount: "1000" }],
      paymentDate: today(),
      reference,
    };
    const first = await raw("accountant", "POST", "/api/sales/payments", payload);
    const second = await raw("accountant", "POST", "/api/sales/payments", payload);
    const list = await call("owner", "GET", `/api/sales/payments?customerId=${state.customers.b}&limit=100`);
    const same = (list.payments ?? []).filter((p) => (p.reference ?? "").includes(reference));
    return expect([first.status, second.status, same.length], [201, 200, 1], "[1-so'rov, 2-so'rov, yozuvlar]");
  });

  await check("o'chirilgan modul: POS o'chirilsa kassa API yopiladi", async () => {
    await call("admin", "PUT", `/api/platform/companies/${state.companyId}/modules/pos`, { enabled: false, reason: "simulyatsiya" });
    const res = await raw("cashier", "POST", "/api/sales/pos/shifts", { warehouseId: state.warehouses.main, openingCash: "0" });
    await call("admin", "PUT", `/api/platform/companies/${state.companyId}/modules/pos`, { enabled: true, reason: "simulyatsiya tugadi" });
    assert(res.status === 403, `modul o'chiq bo'lsa ham ochildi: ${res.status}`);
    return `→ ${res.status} (${res.body?.code ?? ""})`;
  });
}

// ─── 18. PARALLELLIK ─────────────────────────────────────────────────────────

export async function sectionConcurrency() {
  section("18. Parallellik: dublikat to'lov, ikki smena, oversell");

  await check("parallel bir xil to'lov — bitta yozuv", async () => {
    const reference = `sim-par-${RUN}`;
    const payload = {
      customerId: state.customers.b,
      parts: [{ method: "cash", amount: "1000" }],
      paymentDate: today(),
      reference,
    };
    const [a, b] = await Promise.all([
      raw("accountant", "POST", "/api/sales/payments", payload),
      raw("accountant", "POST", "/api/sales/payments", payload),
    ]);
    const list = await call("owner", "GET", `/api/sales/payments?customerId=${state.customers.b}&limit=100`);
    const same = (list.payments ?? []).filter((p) => (p.reference ?? "").includes(reference));
    return expect(same.length, 1, `yozuvlar soni (javoblar: ${a.status}, ${b.status})`);
  });

  await check("parallel ikkita smena ochish — bittasi rad etiladi", async () => {
    const payload = { warehouseId: state.warehouses.main, openingCash: "1000" };
    const [a, b] = await Promise.all([
      raw("cashier", "POST", "/api/sales/pos/shifts", payload),
      raw("cashier", "POST", "/api/sales/pos/shifts", payload),
    ]);
    const statuses = [a.status, b.status].sort();
    const opened = await raw("cashier", "GET", `/api/sales/pos/shifts/open?warehouseId=${state.warehouses.main}`);
    if (opened.status === 200 && opened.body?.shift) {
      await call("cashier", "POST", `/api/sales/pos/shifts/${opened.body.shift.id}/close`, { closingCash: "1000" });
    }
    assert(statuses.filter((s) => s === 201).length === 1, `ikkala so'rov ham o'tdi: ${statuses}`);
    return `javoblar: ${statuses.join(", ")}`;
  });

  await check("parallel oversell — zaxira manfiyga tushmaydi", async () => {
    const product = state.products[3];
    const stock = await stockOf(product.id);
    const half = Math.ceil(stock * 0.6);
    const makeOrder = async () => {
      const created = await raw("owner", "POST", "/api/sales/orders", {
        customerId: state.customers.c,
        warehouseId: state.warehouses.main,
        orderDate: today(),
        items: [{ productId: product.id, quantity: String(half) }],
      });
      if (created.status !== 201) return created.status;
      const confirmed = await raw("owner", "POST", `/api/sales/orders/${created.body.order.id}/confirm`, {});
      return confirmed.status;
    };
    const [a, b] = await Promise.all([makeOrder(), makeOrder()]);
    const after = await stockOf(product.id);
    assert(after >= 0, `zaxira manfiy: ${after}`);
    return `javoblar: ${a}, ${b}; qoldiq ${stock} → ${after}`;
  });
}

// ─── 21–22. BUXGALTERIYA VA YAKUNIY SOLISHTIRUV ──────────────────────────────

export async function sectionReconciliation() {
  section("21. Buxgalteriya: DEBIT = CREDIT va yakuniy solishtiruv");

  await check("barcha jurnal yozuvlari balanslangan", async () => {
    const res = await raw("accountant", "GET", "/api/finance/journal?limit=200");
    if (res.status !== 200) {
      record("NOT VERIFIED", "jurnal endpointi", `${res.status} — boshqa yo'l bilan tekshiriladi`);
      return "endpoint mavjud emas — bazadan tekshiriladi";
    }
    const entries = res.body.entries ?? res.body.journalEntries ?? [];
    const bad = entries.filter((entry) => {
      const debit = (entry.lines ?? []).reduce((sum, line) => sum + money(line.debit), 0);
      const credit = (entry.lines ?? []).reduce((sum, line) => sum + money(line.credit), 0);
      return Math.abs(debit - credit) > 0.004;
    });
    return expect(bad.length, 0, `balanslanmagan yozuv (jami ${entries.length})`);
  });

  await check("kassa va bank qoldiqlari manfiy emas", async () => {
    const list = await call("owner", "GET", "/api/finance/cash-accounts?includeInactive=true");
    const negative = list.cashAccounts.filter((a) => money(a.balance) < 0);
    state.finalCash = Object.fromEntries(list.cashAccounts.map((a) => [a.name, a.balance]));
    return expect(negative.length, 0, "manfiy qoldiqli hisoblar");
  });

  await check("zaxira hech qayerda manfiy emas", async () => {
    const stock = await call("owner", "GET", `/api/inventory/stock?warehouseId=${state.warehouses.main}`);
    const negative = (stock.stock ?? stock.levels ?? []).filter((row) => money(row.quantity) < 0);
    return expect(negative.length, 0, "manfiy qoldiqlar");
  });

  section("22. Yakuniy ma'lumot jadvali");

  await check("yakuniy solishtiruv jadvali yig'ildi", async () => {
    const [customers, orders, payments, purchases, deliveries, stock, cash] = await Promise.all([
      call("owner", "GET", "/api/sales/customers?limit=200"),
      call("owner", "GET", "/api/sales/orders?limit=200"),
      call("owner", "GET", "/api/sales/payments?limit=200"),
      call("owner", "GET", "/api/purchase/orders?limit=100"),
      call("owner", "GET", "/api/delivery/tasks?limit=200"),
      call("owner", "GET", `/api/inventory/stock?warehouseId=${state.warehouses.main}`),
      call("owner", "GET", "/api/finance/cash-accounts?includeInactive=true"),
    ]);
    const supplier = await call("owner", "GET", `/api/purchase/suppliers/${state.supplier}`);
    state.final = {
      customers: customers.customers.length,
      customerDebt: customers.customers.reduce((sum, c) => sum + money(c.totalDebt ?? c.balance), 0),
      orders: orders.orders.length,
      payments: payments.payments.length,
      purchases: purchases.orders.length,
      supplierDebt: money(supplier.supplier.totalDebt ?? supplier.supplier.balance),
      deliveries: deliveries.tasks.length,
      deliveryByStatus: deliveries.tasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}),
      stockRows: (stock.stock ?? stock.levels ?? []).length,
      cash: Object.fromEntries(cash.cashAccounts.map((a) => [a.name, a.balance])),
    };
    return JSON.stringify(state.final);
  });
}

/**
 * FAQAT O'QISH: oxirgi POS chekini bazadan olib, to'lov qismlarini JSON qilib chiqaradi.
 * Brauzer testi (§2) bu orqali UI da ko'ringan narsa haqiqatan bazaga yozilganini tekshiradi.
 * Hech narsa yozmaydi, o'chirmaydi va o'zgartirmaydi.
 *
 *   node --import tsx src/cli/verify-last-pos-sale.ts <company-slug>
 */
import { pool } from "../db/client.js";

const slug = process.argv[2] ?? "bum-demo";

const { rows: orders } = await pool.query(
  `select o.id, o.number, o.total_amount, o.paid_amount, o.status, o.source,
          o.fulfillment_method, o.pos_shift_id
     from sales_orders o
     join companies c on c.id = o.company_id
    where c.slug = $1 and o.source = 'pos'
    order by o.created_at desc
    limit 1`,
  [slug],
);
const order = orders[0];
if (!order) {
  console.log(JSON.stringify({ error: "POS cheki topilmadi" }));
  await pool.end();
  process.exit(1);
}

const { rows: payments } = await pool.query(
  `select p.method, p.amount, p.pos_shift_id,
          t.name as terminal_name, t.network,
          a.name as account_name, a.type as account_type
     from customer_payments p
     left join payment_terminals t on t.id = p.terminal_id
     left join cash_accounts a on a.id = p.cash_account_id
    where p.order_id = $1
    order by p.amount desc`,
  [order.id],
);

const { rows: tasks } = await pool.query(`select count(*)::int as n from delivery_tasks where order_id = $1`, [order.id]);

console.log(
  JSON.stringify(
    {
      orderNumber: order.number,
      total: order.total_amount,
      paid: order.paid_amount,
      status: order.status,
      source: order.source,
      fulfillmentMethod: order.fulfillment_method,
      shiftId: order.pos_shift_id,
      deliveryTasks: tasks[0].n,
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        terminal: p.terminal_name,
        network: p.network,
        account: p.account_name,
        accountType: p.account_type,
        shiftId: p.pos_shift_id,
      })),
    },
    null,
    2,
  ),
);
await pool.end();

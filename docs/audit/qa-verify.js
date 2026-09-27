// STAGING QA — mustaqil sverka (FAQAT O'QISH): qoldiq, qarz, jurnal, pul, hodisa ↔ jurnal, sotuvchi ≠ kassir, audit.
const { Client } = require("pg");
const QA = "5c57c9b9-f860-4968-9fae-58fb9737d4a2";
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("set default_transaction_read_only = on");
  await c.query("begin transaction isolation level repeatable read read only");
  const q = async (s) => (await c.query(s)).rows;
  const one = async (s) => (await q(s))[0];
  const out = {};
  out.stock = await q(`with m as (select product_id, warehouse_id, sum(case when type in ('issue','transfer_out','writeoff','return_out') then -abs(quantity)
      when type in ('adjust','count') then quantity else abs(quantity) end) q,
      sum(case when type='receive' then abs(quantity) else 0 end) received,
      sum(case when type='issue' then abs(quantity) else 0 end) issued,
      sum(case when type='return_in' then abs(quantity) else 0 end) returned
      from stock_movements where company_id='${QA}' group by 1,2)
    select p.sku, sl.quantity::text qty, sl.reserved_qty::text reserved, m.received::text, m.issued::text, m.returned::text, (sl.quantity - coalesce(m.q,0))::text diff,
      round(sl.quantity*sl.avg_cost_price,2)::text value
    from stock_levels sl join products p on p.id=sl.product_id left join m on m.product_id=sl.product_id and m.warehouse_id=sl.warehouse_id
    where sl.company_id='${QA}' order by p.sku`);
  out.debt = await q(`with l as (select jl.party_id, sum(jl.debit-jl.credit) d from journal_lines jl join journal_entries je on je.id=jl.entry_id and je.status='posted'
      join accounts a on a.id=jl.account_id where a.subtype='receivable' and jl.party_type='customer' and jl.company_id='${QA}' group by 1),
    s as (select customer_id, sum(total_amount) sold, sum(paid_amount) paid from sales_orders where company_id='${QA}' and customer_id is not null and status not in ('cancelled','draft') group by 1)
    select cu.name, cu.total_debt::text cache, coalesce(l.d,0)::text journal, (coalesce(s.sold,0)-coalesce(s.paid,0))::text orders_open
    from customers cu left join l on l.party_id=cu.id left join s on s.customer_id=cu.id where cu.company_id='${QA}'`);
  out.journal = await one(`select count(*)::int entries, (select count(*) from (select entry_id from journal_lines where company_id='${QA}' group by entry_id having sum(debit)<>sum(credit)) x)::int unbalanced,
      (select sum(debit)::text from journal_lines where company_id='${QA}') debit, (select sum(credit)::text from journal_lines where company_id='${QA}') credit
    from journal_entries where company_id='${QA}'`);
  out.ledgers = await q(`select a.code, a.name, a.balance::text from accounts a where a.company_id='${QA}' and a.code in ('1010','1020','1030','1100','1200','4000','4100','5000') order by a.code`);
  out.moneyAccounts = await q(`with t as (select cash_account_id, sum(case when type='in' then amount else -amount end) s from cash_transactions group by 1)
    select ca.code, ca.name, ca.type, ca.balance::text, coalesce(t.s,0)::text tx_sum from cash_accounts ca left join t on t.cash_account_id=ca.id where ca.company_id='${QA}' order by ca.type, ca.name`);
  out.inventory1200 = await one(`select (select coalesce(sum(round(quantity*avg_cost_price,2)),0) from stock_levels where company_id='${QA}')::text stock_value,
      (select balance from accounts where company_id='${QA}' and code='1200')::text ledger`);
  // Har bir moliyaviy hodisa jurnalda
  out.eventsWithoutJournal = await one(`select
    (select count(*) from sales_orders o where o.company_id='${QA}' and o.status in ('completed','returned') and not exists (select 1 from journal_entries je where je.reference_id=o.id))::int sales,
    (select count(*) from customer_payments p where p.company_id='${QA}' and p.status='posted' and not exists (select 1 from journal_entries je where je.reference_id=p.id))::int payments,
    (select count(*) from sales_returns r where r.company_id='${QA}' and not exists (select 1 from journal_entries je where je.reference_id=r.id))::int returns`);
  out.payments = await one(`select count(*)::int n, sum(amount)::text total,
      (select count(*) from (select p.id from customer_payments p join customer_payment_allocations a on a.payment_id=p.id where p.company_id='${QA}' group by p.id, p.amount having sum(a.amount) > p.amount) x)::int over_allocated,
      (select coalesce(sum(a.amount),0)::text from customer_payment_allocations a join customer_payments p on p.id=a.payment_id where p.company_id='${QA}') allocated
    from customer_payments where company_id='${QA}' and status='posted'`);
  out.sales = await one(`select count(*)::int n, sum(total_amount)::text total, count(*) filter (where seller_employee_id is not null)::int with_seller,
      count(*) filter (where seller_employee_id is not null and created_by = (select user_id from employees e where e.id=seller_employee_id))::int seller_equals_cashier,
      count(distinct created_by)::int cashiers, count(*) filter (where pos_shift_id is not null)::int pos
    from sales_orders where company_id='${QA}'`);
  out.returns = await one(`select count(*)::int n, sum(total_amount)::text total, sum(cogs)::text cogs from sales_returns where company_id='${QA}'`);
  out.shifts = await q(`select ca.code kassa, s.status, s.opening_balance::text, s.opening_cash::text, s.closing_cash::text, s.cash_difference::text, s.receipt_count from pos_shifts s left join cash_accounts ca on ca.id=s.cash_account_id where s.company_id='${QA}' order by s.opened_at`);
  out.duplicates = await one(`select
    (select count(*) from (select 1 from cash_transactions t join cash_accounts ca on ca.id=t.cash_account_id where ca.company_id='${QA}' and t.reference_id is not null group by t.cash_account_id, t.reference_type, t.reference_id, t.type, t.amount having count(*)>1) x)::int cash_tx,
    (select count(*) from (select 1 from journal_entries where company_id='${QA}' and reference_id is not null and status='posted' group by reference_type, reference_id having count(*)>1) x)::int journal`);
  out.audit = await q(`select action, count(*)::int n, bool_or(details ? 'sellerEmployeeId') has_seller, bool_or(details ? 'warehouseId' or details::text like '%warehouseId%') has_warehouse
    from audit_logs where company_id='${QA}' group by action order by action`);
  out.auditDetail = await q(`select action, details->>'sellerEmployeeId' seller, details->>'cashAccountId' kassa, details->>'codeFrom' code_from, details->>'codeTo' code_to, occurred_at::text
    from audit_logs where company_id='${QA}' and ((action='POS_SALE_COMPLETED' and details ? 'sellerEmployeeId') or (action='CASH_ACCOUNT_UPDATED' and details ? 'codeFrom')) order by occurred_at desc limit 3`);
  out.auditMutable = await one(`select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='audit_logs' and not t.tgisinternal`);
  out.crossTenant = await one(`select
    (select count(*) from sales_orders o join employees e on e.id=o.seller_employee_id where e.company_id<>o.company_id)::int seller,
    (select count(*) from pos_shifts s join cash_accounts ca on ca.id=s.cash_account_id where ca.company_id<>s.company_id)::int shift_kassa,
    (select count(*) from customer_payments p join payment_methods m on m.id=p.payment_method_id where m.company_id<>p.company_id)::int method`);
  await c.query("rollback");
  console.log(JSON.stringify(out, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

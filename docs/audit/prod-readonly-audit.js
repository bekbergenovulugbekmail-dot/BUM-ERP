// PRODUCTION SAFETY GATE 0096–0098 — FAQAT O'QISH. Hech qanday yozuv yo'q: sessiya read-only + READ ONLY tranzaksiya.
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("set default_transaction_read_only = on");
  // Bitta izchil suratda (REPEATABLE READ, READ ONLY) — yozuv urinishi xato beradi
  await c.query("begin transaction isolation level repeatable read read only");
  const q = async (sql) => (await c.query(sql)).rows;
  const one = async (sql) => (await q(sql))[0];
  const out = {};

  // 0. Muhit va migratsiya holati
  out.env = await one(`select current_setting('server_version') v, current_setting('transaction_read_only') ro,
    current_setting('lock_timeout') lock_timeout, current_setting('statement_timeout') statement_timeout,
    pg_size_pretty(pg_database_size(current_database())) db_size`);
  out.migrations = await one(`select count(*)::int applied, max(created_at)::text last_created_at from drizzle.__drizzle_migrations`);

  // 1. Oldindan shartlar: yangi ob'ektlar hali yo'q (nom to'qnashuvi yo'q)
  out.preexisting = {
    columns: await q(`select table_name||'.'||column_name c from information_schema.columns where table_schema='public' and
      ((table_name='cash_accounts' and column_name in ('warehouse_id','code')) or (table_name='pos_shifts' and column_name in ('cash_account_id','opening_balance'))
       or (table_name='pos_devices' and column_name='cash_account_id') or (table_name='customer_payments' and column_name='payment_method_id')
       or (table_name='sales_orders' and column_name='seller_employee_id'))`),
    tables: await q(`select table_name from information_schema.tables where table_schema='public' and table_name in ('payment_methods','payment_method_kassas')`),
    indexes: await q(`select indexname, indexdef from pg_indexes where schemaname='public' and indexname in
      ('ca_company_code_key','ca_company_warehouse_idx','ps_one_open_per_warehouse','ps_one_open_per_kassa','pm_company_name_key','pm_company_active_idx','cp_payment_method_idx','so_company_seller_idx')`),
    kpiEnum: await q(`select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='kpi_metric' order by e.enumsortorder`),
    constraintNames: await q(`select conname from pg_constraint where conname in ('pm_kind_valid','pm_cash_unbound','pm_terminal_card')`),
  };

  // 2. Jadval hajmlari (lock davomiyligi bahosi)
  out.sizes = await q(`select relname t, n_live_tup::int rows, pg_size_pretty(pg_total_relation_size(relid)) size
    from pg_stat_user_tables where relname in ('cash_accounts','pos_shifts','pos_devices','customer_payments','sales_orders','employees',
      'warehouses','payment_terminals','cash_transactions','journal_lines','journal_entries','customer_payment_allocations','sales_returns','stock_movements')
    order by relname`);
  out.exactCounts = await one(`select (select count(*) from cash_accounts)::int cash_accounts, (select count(*) from pos_shifts)::int pos_shifts,
    (select count(*) from pos_devices)::int pos_devices, (select count(*) from customer_payments)::int customer_payments,
    (select count(*) from sales_orders)::int sales_orders, (select count(*) from sales_returns)::int sales_returns,
    (select count(*) from payment_terminals)::int terminals, (select count(*) from cash_transactions)::int cash_transactions,
    (select count(*) from journal_entries)::int journal_entries, (select count(*) from journal_lines)::int journal_lines,
    (select count(*) from companies)::int companies, (select count(*) from employees)::int employees`);
  // Lock navbati xavfi: uzoq tranzaksiyalar
  out.activity = await q(`select state, count(*)::int n, coalesce(max(extract(epoch from now()-xact_start))::int,0) max_xact_sec
    from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() group by state`);

  out.tenants = await q(`select co.name, co.slug, co.currency, co.created_at::date::text created,
    (select count(*) from cash_accounts x where x.company_id=co.id)::int cash_accounts,
    (select count(*) from pos_shifts x where x.company_id=co.id and x.status='open')::int open_shifts,
    (select count(*) from pos_devices x where x.company_id=co.id)::int devices,
    (select count(*) from customer_payments x where x.company_id=co.id)::int payments,
    (select count(*) from sales_orders x where x.company_id=co.id)::int sales,
    (select count(*) from customers x where x.company_id=co.id)::int customers,
    (select coalesce(sum(total_debt),0) from customers x where x.company_id=co.id)::text customer_debt,
    (select coalesce(sum(total_debt),0) from suppliers x where x.company_id=co.id)::text supplier_debt,
    (select count(*) from stock_levels x where x.company_id=co.id)::int stock_levels,
    (select count(*) from journal_entries x where x.company_id=co.id)::int journal_entries
    from companies co order by co.created_at`);
  out.baseline = await q(`select co.name,
    (select count(*) from sales_orders x where x.company_id=co.id)::int sales_n,
    (select coalesce(sum(total_amount),0) from sales_orders x where x.company_id=co.id)::text sales_total,
    (select count(*) from customer_payments x where x.company_id=co.id)::int payments_n,
    (select coalesce(sum(amount),0) from customer_payments x where x.company_id=co.id)::text payments_total,
    (select count(*) from sales_returns x where x.company_id=co.id)::int returns_n,
    (select coalesce(sum(total_amount),0) from sales_returns x where x.company_id=co.id)::text returns_total,
    (select count(*) from customers x where x.company_id=co.id)::int customers_n,
    (select count(*) from suppliers x where x.company_id=co.id)::int suppliers_n,
    (select coalesce(sum(quantity),0) from stock_levels x where x.company_id=co.id)::text stock_qty,
    (select coalesce(sum(round(quantity*avg_cost_price,2)),0) from stock_levels x where x.company_id=co.id)::text stock_value,
    (select coalesce(sum(total_debt),0) from customers x where x.company_id=co.id)::text customer_debt,
    (select coalesce(sum(total_debt),0) from suppliers x where x.company_id=co.id)::text supplier_debt,
    (select coalesce(sum(balance),0) from cash_accounts x where x.company_id=co.id and x.currency=co.currency)::text cash_balance_base,
    (select coalesce(sum(debit),0) from journal_lines x where x.company_id=co.id)::text journal_debit,
    (select coalesce(sum(credit),0) from journal_lines x where x.company_id=co.id)::text journal_credit,
    (select coalesce(sum(a.amount),0) from customer_payment_allocations a join customer_payments p on p.id=a.payment_id where p.company_id=co.id)::text allocations_total,
    (select count(*) from pos_shifts x where x.company_id=co.id and x.status='open')::int open_shifts,
    (select count(*) from pos_devices x where x.company_id=co.id)::int devices,
    (select count(*) from payment_terminals x where x.company_id=co.id)::int terminals,
    (select count(*) from cash_accounts x where x.company_id=co.id and x.type='bank')::int bank_accounts,
    (select count(*) from cash_accounts x where x.company_id=co.id)::int cash_accounts
    from companies co order by co.created_at`);
  out.paymentMethodsTable = (await one(`select to_regclass('public.payment_methods') is not null e`)).e;
  // 3. Mavjud pul tuzilmasi
  out.cashAccounts = await q(`select type, is_default, is_active, currency, (delivery_agent_id is not null or sales_rep_id is not null) agent,
    count(*)::int n from cash_accounts group by 1,2,3,4,5 order by 1,2 desc`);
  out.defaultKassaPerCompany = await one(`select count(*)::int companies,
    count(*) filter (where d=1)::int exactly_one, count(*) filter (where d=0)::int none, count(*) filter (where d>1)::int many
    from (select co.id, count(ca.id) filter (where ca.is_default) d from companies co left join cash_accounts ca on ca.company_id=co.id group by co.id) x`);
  out.defaultKassaShape = await q(`select ca.type, ca.is_active, ca.currency = co.currency base_currency,
    (ca.delivery_agent_id is not null or ca.sales_rep_id is not null) agent, count(*)::int n
    from cash_accounts ca join companies co on co.id=ca.company_id where ca.is_default group by 1,2,3,4`);
  out.shifts = await q(`select status, (device_id is not null) desktop, count(*)::int n from pos_shifts group by 1,2 order by 1,2`);
  out.openWebShiftDupes = await one(`select count(*)::int groups from (select company_id, warehouse_id from pos_shifts
    where status='open' and device_id is null group by 1,2 having count(*)>1) x`);
  out.devices = await q(`select is_active, count(*)::int n, max(last_push_at)::text last_push from pos_devices group by 1`);
  out.terminals = await q(`select pt.is_active, pt.show_in_pos, ca.type account_type, count(*)::int n from payment_terminals pt
    join cash_accounts ca on ca.id=pt.cash_account_id group by 1,2,3`);
  out.bankAccounts = await one(`select count(*)::int n, count(*) filter (where show_in_pos)::int show_in_pos from cash_accounts where type='bank'`);
  out.payments = await q(`select method, status, (pos_shift_id is not null) pos, (terminal_id is not null) terminal, count(*)::int n, sum(amount)::text amount
    from customer_payments group by 1,2,3,4 order by 1,2,3,4`);
  out.posCashPaymentsAccounts = await q(`select (cp.cash_account_id = d.id) to_default, count(*)::int n, sum(cp.amount)::text amount
    from customer_payments cp join cash_accounts d on d.company_id=cp.company_id and d.is_default
    where cp.method='cash' and cp.pos_shift_id is not null group by 1`);
  out.sales = await q(`select source, status, count(*)::int n, sum(total_amount)::text total from sales_orders group by 1,2 order by 1,2`);
  out.returns = await one(`select count(*)::int n, coalesce(sum(total_amount),0)::text total, coalesce(sum(refund_amount),0)::text refunds from sales_returns`);

  // 4. Moliyaviy invariantlar (bazaviy holat)
  out.inv = {};
  out.inv.journalUnbalancedEntries = (await one(`select count(*)::int n from (select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)) x`)).n;
  out.inv.journalTotals = await one(`select sum(debit)::text d, sum(credit)::text c from journal_lines`);
  out.inv.accountCacheVsLines = await one(`select count(*)::int accounts, count(*) filter (where abs(a.balance - coalesce(s.b,0)) > 0.005)::int mismatched from accounts a
    left join (select jl.account_id, sum(case when a2.type in ('asset','expense') then jl.debit-jl.credit else jl.credit-jl.debit end) b
      from journal_lines jl join journal_entries je on je.id=jl.entry_id and je.status='posted' join accounts a2 on a2.id=jl.account_id group by 1) s on s.account_id=a.id`).catch((e) => ({ error: e.message }));
  out.inv.customerDebt = await one(`with l as (select jl.party_id, sum(jl.debit-jl.credit) d from journal_lines jl join journal_entries je on je.id=jl.entry_id and je.status='posted'
      join accounts a on a.id=jl.account_id where a.subtype='receivable' and jl.party_type='customer' group by 1)
    select count(*)::int customers, count(*) filter (where abs(c.total_debt-coalesce(l.d,0))>0.005)::int mismatched, sum(c.total_debt)::text total from customers c left join l on l.party_id=c.id`);
  out.inv.supplierDebt = await one(`with l as (select jl.party_id, sum(jl.credit-jl.debit) d from journal_lines jl join journal_entries je on je.id=jl.entry_id and je.status='posted'
      join accounts a on a.id=jl.account_id where a.subtype='payable' and jl.party_type='supplier' group by 1)
    select count(*)::int suppliers, count(*) filter (where abs(s.total_debt-coalesce(l.d,0))>0.005)::int mismatched, sum(s.total_debt)::text total from suppliers s left join l on l.party_id=s.id`);
  out.inv.stock = await one(`with m as (select product_id, warehouse_id, sum(case when type in ('issue','transfer_out','writeoff','return_out') then -abs(quantity)
      when type in ('adjust','count') then quantity else abs(quantity) end) q from stock_movements group by 1,2)
    select count(*)::int levels, count(*) filter (where abs(sl.quantity-coalesce(m.q,0))>0.00005)::int mismatched from stock_levels sl
    left join m on m.product_id=sl.product_id and m.warehouse_id=sl.warehouse_id`);
  out.inv.cashBalance = await one(`with t as (select cash_account_id, sum(case when type='in' then amount else -amount end) s from cash_transactions group by 1)
    select count(*)::int accounts, count(*) filter (where abs(ca.balance-coalesce(t.s,0))>0.005)::int mismatched, sum(ca.balance)::text total
    from cash_accounts ca left join t on t.cash_account_id=ca.id`);
  out.inv.allocationOverPayment = (await one(`select count(*)::int n from (select cp.id from customer_payments cp join customer_payment_allocations a on a.payment_id=cp.id
    group by cp.id, cp.amount having sum(a.amount) > cp.amount + 0.005) x`)).n;
  out.inv.crossTenant = await one(`select
    (select count(*) from cash_transactions t join cash_accounts a on a.id=t.cash_account_id where a.company_id<>t.company_id)::int cash_tx,
    (select count(*) from customer_payments p join cash_accounts a on a.id=p.cash_account_id where a.company_id<>p.company_id)::int payment_account,
    (select count(*) from customer_payments p join sales_orders o on o.id=p.order_id where o.company_id<>p.company_id)::int payment_order,
    (select count(*) from pos_shifts s join warehouses w on w.id=s.warehouse_id where w.company_id<>s.company_id)::int shift_warehouse,
    (select count(*) from pos_devices d join warehouses w on w.id=d.warehouse_id where w.company_id<>d.company_id)::int device_warehouse,
    (select count(*) from payment_terminals pt join cash_accounts a on a.id=pt.cash_account_id where a.company_id<>pt.company_id)::int terminal_account,
    (select count(*) from journal_lines jl join journal_entries je on je.id=jl.entry_id where je.company_id<>jl.company_id)::int journal_line_entry,
    (select count(*) from sales_orders o join pos_shifts s on s.id=o.pos_shift_id where s.company_id<>o.company_id)::int order_shift`);
  out.inv.duplicateEffects = await one(`select
    (select count(*) from (select 1 from cash_transactions where reference_id is not null group by cash_account_id, reference_type, reference_id, type, amount having count(*)>1) x)::int cash_tx_groups,
    (select count(*) from (select 1 from journal_entries where reference_id is not null and status='posted' group by company_id, reference_type, reference_id having count(*)>1) x)::int journal_groups,
    (select count(*) from (select 1 from customer_payments where reference is not null group by company_id, reference having count(*)>1) x)::int payment_ref_groups`);

  // 5. Tarixiy ma'lumot nazorat summalari (deploydan keyin shu so'rov qayta ishlatiladi — o'zgarmasligi isbotlanadi)
  out.checksums = await one(`select
    (select md5(string_agg(id::text||total_amount::text||status::text||coalesce(paid_amount::text,''), ',' order by id)) from sales_orders) sales_orders,
    (select md5(string_agg(id::text||amount::text||method::text||status||coalesce(cash_account_id::text,'')||coalesce(terminal_id::text,'')||coalesce(pos_shift_id::text,''), ',' order by id)) from customer_payments) customer_payments,
    (select md5(string_agg(id::text||status::text||coalesce(closing_cash::text,'')||coalesce(cash_difference::text,'')||total_cash::text||coalesce(device_id::text,''), ',' order by id)) from pos_shifts) pos_shifts,
    (select md5(string_agg(id::text||amount::text||type::text||cash_account_id::text, ',' order by id)) from cash_transactions) cash_transactions,
    (select md5(string_agg(id::text||debit::text||credit::text||account_id::text, ',' order by id)) from journal_lines) journal_lines,
    (select md5(string_agg(id::text||balance::text||type::text||is_default::text, ',' order by id)) from cash_accounts) cash_accounts,
    (select md5(string_agg(id::text||cash_account_id::text||is_active::text, ',' order by id)) from payment_terminals) terminals,
    (select md5(string_agg(id::text||warehouse_id::text||is_active::text, ',' order by id)) from pos_devices) pos_devices,
    now()::text taken_at`);

  await c.query("rollback");
  console.log(JSON.stringify(out, null, 1));
  await c.end();
})().catch((error) => { console.error("ERR", error.message); process.exit(1); });

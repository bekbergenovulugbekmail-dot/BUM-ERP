/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as analytics_ai from "../analytics/ai.js";
import type * as analytics_reports from "../analytics/reports.js";
import type * as companies from "../companies.js";
import type * as crm_activities from "../crm/activities.js";
import type * as crm_distribution from "../crm/distribution.js";
import type * as crm_leads from "../crm/leads.js";
import type * as crm_salesReps from "../crm/salesReps.js";
import type * as dashboard from "../dashboard.js";
import type * as finance_accounts from "../finance/accounts.js";
import type * as finance_cashAccounts from "../finance/cashAccounts.js";
import type * as finance_expenses from "../finance/expenses.js";
import type * as finance_journalHelper from "../finance/journalHelper.js";
import type * as hr_attendance from "../hr/attendance.js";
import type * as hr_employees from "../hr/employees.js";
import type * as hr_salary from "../hr/salary.js";
import type * as manufacturing_boms from "../manufacturing/boms.js";
import type * as manufacturing_orders from "../manufacturing/orders.js";
import type * as notifications from "../notifications.js";
import type * as pin from "../pin.js";
import type * as products_brands from "../products/brands.js";
import type * as products_categories from "../products/categories.js";
import type * as products_products from "../products/products.js";
import type * as products_units from "../products/units.js";
import type * as purchase_orders from "../purchase/orders.js";
import type * as purchase_suppliers from "../purchase/suppliers.js";
import type * as sales_customers from "../sales/customers.js";
import type * as sales_orders from "../sales/orders.js";
import type * as sales_pos from "../sales/pos.js";
import type * as tenant from "../tenant.js";
import type * as users from "../users.js";
import type * as warehouse_inventoryCounts from "../warehouse/inventoryCounts.js";
import type * as warehouse_stock from "../warehouse/stock.js";
import type * as warehouse_warehouses from "../warehouse/warehouses.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "analytics/ai": typeof analytics_ai;
  "analytics/reports": typeof analytics_reports;
  companies: typeof companies;
  "crm/activities": typeof crm_activities;
  "crm/distribution": typeof crm_distribution;
  "crm/leads": typeof crm_leads;
  "crm/salesReps": typeof crm_salesReps;
  dashboard: typeof dashboard;
  "finance/accounts": typeof finance_accounts;
  "finance/cashAccounts": typeof finance_cashAccounts;
  "finance/expenses": typeof finance_expenses;
  "finance/journalHelper": typeof finance_journalHelper;
  "hr/attendance": typeof hr_attendance;
  "hr/employees": typeof hr_employees;
  "hr/salary": typeof hr_salary;
  "manufacturing/boms": typeof manufacturing_boms;
  "manufacturing/orders": typeof manufacturing_orders;
  notifications: typeof notifications;
  pin: typeof pin;
  "products/brands": typeof products_brands;
  "products/categories": typeof products_categories;
  "products/products": typeof products_products;
  "products/units": typeof products_units;
  "purchase/orders": typeof purchase_orders;
  "purchase/suppliers": typeof purchase_suppliers;
  "sales/customers": typeof sales_customers;
  "sales/orders": typeof sales_orders;
  "sales/pos": typeof sales_pos;
  tenant: typeof tenant;
  users: typeof users;
  "warehouse/inventoryCounts": typeof warehouse_inventoryCounts;
  "warehouse/stock": typeof warehouse_stock;
  "warehouse/warehouses": typeof warehouse_warehouses;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  // Convex Auth jadvallari: authSessions, authAccounts, authRefreshTokens,
  // authVerificationCodes, authVerifiers, authRateLimits.
  // `users` quyida qayta ta'riflanadi — kutubxona maydonlari + BUM ERP maydonlari.
  ...authTables,

  // ─── Platform ────────────────────────────────────────────────────────────────

  users: defineTable({
    // ── Convex Auth talab qiladigan maydonlar ──
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    // Password provayderi hisob ID sifatida shuni ishlatadi. Bu ilovada
    // login identifikatori telefon raqam, shuning uchun bu yerda ham telefon
    // turadi (qarang: convex/auth.ts).
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),

    // ── BUM ERP maydonlari ──
    // RBAC
    role: v.optional(v.string()),
    roleId: v.optional(v.id("roles")),
    isActive: v.optional(v.boolean()),
    avatar: v.optional(v.string()),
    lastSeen: v.optional(v.string()),
    // Multi-tenant
    activeCompanyId: v.optional(v.id("companies")),
    isPlatformAdmin: v.optional(v.boolean()),
    // PIN Quick Unlock
    pinHash: v.optional(v.string()),          // SHA-256(salt:pin) hex
    pinSalt: v.optional(v.string()),          // random 32 hex chars per user
    pinFailedAttempts: v.optional(v.number()), // consecutive wrong PINs
    pinLockedUntil: v.optional(v.string()),    // ISO: temporary PIN lock
    autoLockTimeoutSeconds: v.optional(v.number()), // 0 = disabled; default 30
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  roles: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.array(v.string()),
    isSystem: v.boolean(),
    isActive: v.boolean(),
    memberCount: v.number(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_name", ["name"])
    .index("by_company", ["companyId"])
    .index("by_company_name", ["companyId", "name"]),

  auditLogs: defineTable({
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    action: v.string(),
    resource: v.string(),
    resourceId: v.optional(v.string()),
    details: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_user", ["userId"])
    .index("by_resource", ["resource"])
    .index("by_timestamp", ["timestamp"]),

  // ─── Multi-tenant ─────────────────────────────────────────────────────────

  companies: defineTable({
    name: v.string(),
    legalName: v.optional(v.string()),
    taxId: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.string(),
    currency: v.string(),
    logoUrl: v.optional(v.string()),
    isDefault: v.boolean(),
    isActive: v.boolean(),
    // Multi-tenant additions
    ownerId: v.optional(v.id("users")),
    slug: v.optional(v.string()),
    region: v.optional(v.string()),
    language: v.optional(v.string()), // "uz" | "ru" | "kk"
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("trial"),
      v.literal("pending"),
      v.literal("suspended"),
      v.literal("cancelled"),
    )),
    isPlatformTenant: v.optional(v.boolean()),
    suspendedAt: v.optional(v.string()),
    suspendReason: v.optional(v.string()),
    trialEndsAt: v.optional(v.string()),  // ISO 8601, when trial expires
  })
    .index("by_default", ["isDefault"])
    .index("by_slug", ["slug"]),

  /** Branches / filiallar — one or more per company */
  branches: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    phone: v.optional(v.string()),
    isDefault: v.boolean(),
    isActive: v.boolean(),
  })
    .index("by_company", ["companyId"])
    .index("by_company_default", ["companyId", "isDefault"]),

  /** Company membership — links users to companies with roles/permissions */
  companyMembers: defineTable({
    companyId: v.id("companies"),
    userId: v.id("users"),
    companyRole: v.string(), // "owner" | "director" | "accountant" | "cashier" | etc.
    branchId: v.optional(v.id("branches")),
    allowedWarehouseIds: v.optional(v.array(v.string())),
    isActive: v.boolean(),
    joinedAt: v.string(),
  })
    .index("by_company", ["companyId"])
    .index("by_user", ["userId"])
    .index("by_company_user", ["companyId", "userId"]),

  // ─── System settings ──────────────────────────────────────────────────────

  settings: defineTable({
    key: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
    group: v.string(),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.string(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_key", ["key"])
    .index("by_group", ["group"])
    .index("by_company", ["companyId"])
    .index("by_company_group", ["companyId", "group"])
    .index("by_company_key", ["companyId", "key"]),

  // ─── Product catalog ──────────────────────────────────────────────────────

  categories: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    sortOrder: v.number(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_parent", ["parentId"])
    .index("by_company", ["companyId"]),

  brands: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  }).index("by_company", ["companyId"]),

  // Global — no companyId; measurement units are universal
  units: defineTable({
    name: v.string(),
    shortName: v.string(),
    isBase: v.boolean(),
  }),

  unitConversions: defineTable({
    fromUnitId: v.id("units"),
    toUnitId: v.id("units"),
    factor: v.number(),
    productId: v.optional(v.id("products")),
  })
    .index("by_from_unit", ["fromUnitId"])
    .index("by_product", ["productId"]),

  products: defineTable({
    name: v.string(),
    sku: v.string(),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    brandId: v.optional(v.id("brands")),
    manufacturer: v.optional(v.string()),
    baseUnitId: v.id("units"),
    purchaseUnitId: v.optional(v.id("units")),
    salesUnitId: v.optional(v.id("units")),
    purchasePrice: v.number(),
    salesPrice: v.number(),
    wholesalePrice: v.optional(v.number()),
    retailPrice: v.optional(v.number()),
    promoPrice: v.optional(v.number()),
    promoPriceEnd: v.optional(v.string()),
    taxRate: v.number(),
    taxIncluded: v.boolean(),
    minStock: v.number(),
    maxStock: v.optional(v.number()),
    reorderPoint: v.optional(v.number()),
    trackBatch: v.boolean(),
    trackExpiry: v.boolean(),
    shelfLifeDays: v.optional(v.number()),
    costingMethod: v.union(
      v.literal("fifo"), v.literal("fefo"), v.literal("average"), v.literal("manual"),
    ),
    isActive: v.boolean(),
    isSaleable: v.boolean(),
    isPurchaseable: v.boolean(),
    isManufactured: v.boolean(),
    weight: v.optional(v.number()),
    weightUnit: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_sku", ["sku"])
    .index("by_barcode", ["barcode"])
    .index("by_category", ["categoryId"])
    .index("by_brand", ["brandId"])
    .index("by_company", ["companyId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["isActive", "categoryId", "companyId"],
    }),

  batches: defineTable({
    productId: v.id("products"),
    batchNumber: v.string(),
    supplierId: v.optional(v.string()),
    manufacturedDate: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    quantity: v.number(),
    unitId: v.id("units"),
    costPrice: v.number(),
    warehouseId: v.optional(v.string()),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_product", ["productId"])
    .index("by_expiry", ["expiryDate"])
    .index("by_company", ["companyId"]),

  // ─── Warehouse ────────────────────────────────────────────────────────────

  warehouses: defineTable({
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    phone: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    isActive: v.boolean(),
    isDefault: v.boolean(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_default", ["isDefault"])
    .index("by_company", ["companyId"]),

  warehouseZones: defineTable({
    warehouseId: v.id("warehouses"),
    name: v.string(),
    type: v.union(v.literal("zone"), v.literal("rack"), v.literal("shelf"), v.literal("bin")),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  }).index("by_warehouse", ["warehouseId"]),

  stockLevels: defineTable({
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    quantity: v.number(),
    reservedQty: v.number(),
    avgCostPrice: v.number(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_product", ["productId"])
    .index("by_warehouse", ["warehouseId"])
    .index("by_product_warehouse", ["productId", "warehouseId"])
    .index("by_company", ["companyId"]),

  stockMovements: defineTable({
    type: v.union(
      v.literal("receive"), v.literal("issue"), v.literal("transfer_out"),
      v.literal("transfer_in"), v.literal("adjust"), v.literal("writeoff"),
      v.literal("return_in"), v.literal("return_out"), v.literal("count"),
    ),
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    quantity: v.number(),
    unitId: v.id("units"),
    costPrice: v.number(),
    batchId: v.optional(v.id("batches")),
    zoneId: v.optional(v.id("warehouseZones")),
    referenceId: v.optional(v.string()),
    referenceType: v.optional(v.string()),
    notes: v.optional(v.string()),
    performedBy: v.optional(v.id("users")),
    date: v.string(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_product", ["productId"])
    .index("by_warehouse", ["warehouseId"])
    .index("by_date", ["date"])
    .index("by_product_warehouse", ["productId", "warehouseId"])
    .index("by_company", ["companyId"]),

  inventoryCounts: defineTable({
    warehouseId: v.id("warehouses"),
    name: v.string(),
    status: v.union(
      v.literal("draft"), v.literal("in_progress"),
      v.literal("completed"), v.literal("cancelled"),
    ),
    countedBy: v.optional(v.id("users")),
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    notes: v.optional(v.string()),
    adjustmentsMade: v.boolean(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_warehouse", ["warehouseId"])
    .index("by_status", ["status"])
    .index("by_company", ["companyId"]),

  inventoryCountItems: defineTable({
    countId: v.id("inventoryCounts"),
    productId: v.id("products"),
    expectedQty: v.number(),
    countedQty: v.optional(v.number()),
    difference: v.optional(v.number()),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_count", ["countId"])
    .index("by_product", ["productId"]),

  // ─── Purchase ────────────────────────────────────────────────────────────

  suppliers: defineTable({
    name: v.string(),
    code: v.string(),
    contactPerson: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    taxId: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    paymentTermDays: v.number(),
    currency: v.string(),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    totalDebt: v.number(),
    totalPurchased: v.number(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_active", ["isActive"])
    .index("by_company", ["companyId"])
    .index("by_company_active", ["companyId", "isActive"]),

  purchaseOrders: defineTable({
    number: v.string(),
    supplierId: v.id("suppliers"),
    warehouseId: v.id("warehouses"),
    status: v.union(
      v.literal("draft"), v.literal("confirmed"), v.literal("partial"),
      v.literal("received"), v.literal("invoiced"), v.literal("paid"), v.literal("cancelled"),
    ),
    orderDate: v.string(),
    expectedDate: v.optional(v.string()),
    currency: v.string(),
    exchangeRate: v.number(),
    subtotal: v.number(),
    taxAmount: v.number(),
    discountAmount: v.number(),
    totalAmount: v.number(),
    paidAmount: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_supplier", ["supplierId"])
    .index("by_status", ["status"])
    .index("by_warehouse", ["warehouseId"])
    .index("by_number", ["number"])
    .index("by_company", ["companyId"])
    .index("by_company_status", ["companyId", "status"]),

  purchaseOrderItems: defineTable({
    orderId: v.id("purchaseOrders"),
    productId: v.id("products"),
    unitId: v.id("units"),
    orderedQty: v.number(),
    receivedQty: v.number(),
    unitPrice: v.number(),
    taxRate: v.number(),
    discountPercent: v.number(),
    lineTotal: v.number(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_order", ["orderId"])
    .index("by_product", ["productId"]),

  purchaseReceipts: defineTable({
    orderId: v.id("purchaseOrders"),
    supplierId: v.id("suppliers"),
    warehouseId: v.id("warehouses"),
    receiptDate: v.string(),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_order", ["orderId"])
    .index("by_supplier", ["supplierId"]),

  purchaseReceiptItems: defineTable({
    receiptId: v.id("purchaseReceipts"),
    orderItemId: v.id("purchaseOrderItems"),
    productId: v.id("products"),
    unitId: v.id("units"),
    receivedQty: v.number(),
    unitPrice: v.number(),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_receipt", ["receiptId"])
    .index("by_product", ["productId"]),

  supplierPayments: defineTable({
    supplierId: v.id("suppliers"),
    orderId: v.optional(v.id("purchaseOrders")),
    amount: v.number(),
    currency: v.string(),
    exchangeRate: v.number(),
    paymentDate: v.string(),
    method: v.union(v.literal("cash"), v.literal("bank"), v.literal("card"), v.literal("transfer")),
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    cashAccountId: v.optional(v.id("cashAccounts")),
    journalEntryId: v.optional(v.id("journalEntries")),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_supplier", ["supplierId"])
    .index("by_order", ["orderId"])
    .index("by_company", ["companyId"]),

  // ─── Sales ────────────────────────────────────────────────────────────────

  customers: defineTable({
    name: v.string(),
    code: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    taxId: v.optional(v.string()),
    discountPercent: v.number(),
    creditLimit: v.number(),
    paymentTermDays: v.number(),
    currency: v.string(),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    totalDebt: v.number(),
    totalPurchased: v.number(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_active", ["isActive"])
    .index("by_company", ["companyId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["isActive", "companyId"],
    }),

  salesOrders: defineTable({
    number: v.string(),
    customerId: v.optional(v.id("customers")),
    warehouseId: v.id("warehouses"),
    status: v.union(
      v.literal("draft"), v.literal("confirmed"), v.literal("shipped"),
      v.literal("delivered"), v.literal("returned"), v.literal("cancelled"),
    ),
    orderDate: v.string(),
    deliveryDate: v.optional(v.string()),
    currency: v.string(),
    exchangeRate: v.number(),
    subtotal: v.number(),
    taxAmount: v.number(),
    discountAmount: v.number(),
    totalAmount: v.number(),
    paidAmount: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    isPOS: v.boolean(),
    posShiftId: v.optional(v.id("posShifts")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_warehouse", ["warehouseId"])
    .index("by_number", ["number"])
    .index("by_pos_shift", ["posShiftId"])
    .index("by_company", ["companyId"])
    .index("by_company_status", ["companyId", "status"]),

  salesOrderItems: defineTable({
    orderId: v.id("salesOrders"),
    productId: v.id("products"),
    unitId: v.id("units"),
    qty: v.number(),
    unitPrice: v.number(),
    taxRate: v.number(),
    discountPercent: v.number(),
    lineTotal: v.number(),
    costPrice: v.number(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_order", ["orderId"])
    .index("by_product", ["productId"])
    .index("by_company", ["companyId"]),

  customerPayments: defineTable({
    customerId: v.optional(v.id("customers")),
    orderId: v.optional(v.id("salesOrders")),
    amount: v.number(),
    currency: v.string(),
    exchangeRate: v.number(),
    paymentDate: v.string(),
    method: v.union(v.literal("cash"), v.literal("card"), v.literal("bank"), v.literal("transfer")),
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    cashAccountId: v.optional(v.id("cashAccounts")),
    journalEntryId: v.optional(v.id("journalEntries")),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_customer", ["customerId"])
    .index("by_order", ["orderId"])
    .index("by_company", ["companyId"]),

  posShifts: defineTable({
    warehouseId: v.id("warehouses"),
    cashierName: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("closed")),
    openedAt: v.string(),
    closedAt: v.optional(v.string()),
    openingCash: v.number(),
    closingCash: v.optional(v.number()),
    totalSales: v.number(),
    totalCash: v.number(),
    totalCard: v.number(),
    receiptCount: v.number(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_warehouse", ["warehouseId"])
    .index("by_status", ["status"])
    .index("by_company", ["companyId"]),

  // ─── CRM ─────────────────────────────────────────────────────────────────

  salesReps: defineTable({
    name: v.string(),
    code: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    region: v.optional(v.string()),
    monthlyTarget: v.number(),
    commission: v.number(),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_active", ["isActive"])
    .index("by_company", ["companyId"]),

  leads: defineTable({
    name: v.string(),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    source: v.union(
      v.literal("website"), v.literal("referral"), v.literal("social"),
      v.literal("cold_call"), v.literal("exhibition"), v.literal("other"),
    ),
    stage: v.union(
      v.literal("new"), v.literal("contacted"), v.literal("qualified"),
      v.literal("proposal"), v.literal("won"), v.literal("lost"),
    ),
    estimatedValue: v.optional(v.number()),
    customerId: v.optional(v.id("customers")),
    salesRepId: v.optional(v.id("salesReps")),
    expectedCloseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    lostReason: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_stage", ["stage"])
    .index("by_customer", ["customerId"])
    .index("by_sales_rep", ["salesRepId"])
    .index("by_company", ["companyId"]),

  activities: defineTable({
    type: v.union(
      v.literal("call"), v.literal("meeting"), v.literal("email"),
      v.literal("note"), v.literal("task"),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    leadId: v.optional(v.id("leads")),
    date: v.string(),
    dueDate: v.optional(v.string()),
    status: v.union(v.literal("planned"), v.literal("done"), v.literal("cancelled")),
    outcome: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_customer", ["customerId"])
    .index("by_lead", ["leadId"])
    .index("by_date", ["date"])
    .index("by_status", ["status"])
    .index("by_company", ["companyId"]),

  customerSegments: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.string(),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  }).index("by_active", ["isActive"]),

  customerSegmentMembers: defineTable({
    segmentId: v.id("customerSegments"),
    customerId: v.id("customers"),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_segment", ["segmentId"])
    .index("by_customer", ["customerId"]),

  distributionRoutes: defineTable({
    name: v.string(),
    salesRepId: v.optional(v.id("salesReps")),
    description: v.optional(v.string()),
    days: v.array(v.number()),
    color: v.optional(v.string()),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_sales_rep", ["salesRepId"])
    .index("by_active", ["isActive"])
    .index("by_company", ["companyId"]),

  routeCustomers: defineTable({
    routeId: v.id("distributionRoutes"),
    customerId: v.id("customers"),
    sortOrder: v.number(),
    visitNotes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_route", ["routeId"])
    .index("by_customer", ["customerId"]),

  routeVisits: defineTable({
    routeId: v.id("distributionRoutes"),
    salesRepId: v.optional(v.id("salesReps")),
    date: v.string(),
    status: v.union(
      v.literal("planned"), v.literal("in_progress"),
      v.literal("completed"), v.literal("cancelled"),
    ),
    customersVisited: v.number(),
    ordersCreated: v.number(),
    totalAmount: v.number(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_route", ["routeId"])
    .index("by_date", ["date"])
    .index("by_sales_rep", ["salesRepId"])
    .index("by_company", ["companyId"]),

  // ─── Manufacturing ────────────────────────────────────────────────────────

  boms: defineTable({
    productId: v.id("products"),
    name: v.string(),
    version: v.string(),
    quantity: v.number(),
    unitId: v.id("units"),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_product", ["productId"])
    .index("by_active", ["isActive"])
    .index("by_company", ["companyId"]),

  bomItems: defineTable({
    bomId: v.id("boms"),
    productId: v.id("products"),
    quantity: v.number(),
    unitId: v.id("units"),
    scrapPercent: v.number(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_bom", ["bomId"])
    .index("by_product", ["productId"]),

  productionOrders: defineTable({
    number: v.string(),
    bomId: v.id("boms"),
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    plannedQty: v.number(),
    producedQty: v.number(),
    status: v.union(
      v.literal("draft"), v.literal("confirmed"), v.literal("in_progress"),
      v.literal("completed"), v.literal("cancelled"),
    ),
    plannedDate: v.string(),
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    totalMaterialCost: v.number(),
    totalLaborCost: v.number(),
    totalCost: v.number(),
    unitCost: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_product", ["productId"])
    .index("by_status", ["status"])
    .index("by_warehouse", ["warehouseId"])
    .index("by_number", ["number"])
    .index("by_company", ["companyId"]),

  productionMaterials: defineTable({
    orderId: v.id("productionOrders"),
    productId: v.id("products"),
    plannedQty: v.number(),
    actualQty: v.number(),
    unitId: v.id("units"),
    unitCost: v.number(),
    totalCost: v.number(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_order", ["orderId"])
    .index("by_product", ["productId"]),

  workCenters: defineTable({
    name: v.string(),
    code: v.string(),
    type: v.union(v.literal("machine"), v.literal("labor"), v.literal("subcontract")),
    costPerHour: v.number(),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_active", ["isActive"])
    .index("by_company", ["companyId"]),

  productionTimeLines: defineTable({
    orderId: v.id("productionOrders"),
    workCenterId: v.id("workCenters"),
    plannedHours: v.number(),
    actualHours: v.number(),
    costPerHour: v.number(),
    totalCost: v.number(),
    companyId: v.optional(v.id("companies")),
  }).index("by_order", ["orderId"]),

  // ─── HR ──────────────────────────────────────────────────────────────────

  departments: defineTable({
    name: v.string(),
    code: v.string(),
    parentId: v.optional(v.id("departments")),
    managerId: v.optional(v.id("employees")),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_parent", ["parentId"])
    .index("by_company", ["companyId"]),

  positions: defineTable({
    name: v.string(),
    departmentId: v.id("departments"),
    level: v.optional(v.string()),
    minSalary: v.optional(v.number()),
    maxSalary: v.optional(v.number()),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  }).index("by_department", ["departmentId"]),

  employees: defineTable({
    name: v.string(),
    code: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    positionId: v.optional(v.id("positions")),
    managerId: v.optional(v.id("employees")),
    hireDate: v.string(),
    birthDate: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"))),
    address: v.optional(v.string()),
    passportNumber: v.optional(v.string()),
    inn: v.optional(v.string()),
    baseSalary: v.number(),
    salaryType: v.union(v.literal("monthly"), v.literal("hourly"), v.literal("daily")),
    status: v.union(v.literal("active"), v.literal("on_leave"), v.literal("terminated")),
    photoUrl: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_department", ["departmentId"])
    .index("by_status", ["status"])
    .index("by_company", ["companyId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["companyId"],
    }),

  attendances: defineTable({
    employeeId: v.id("employees"),
    date: v.string(),
    checkIn: v.optional(v.string()),
    checkOut: v.optional(v.string()),
    workHours: v.number(),
    overtime: v.number(),
    status: v.union(
      v.literal("present"), v.literal("absent"), v.literal("late"),
      v.literal("half_day"), v.literal("holiday"), v.literal("on_leave"),
    ),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_employee", ["employeeId"])
    .index("by_date", ["date"])
    .index("by_employee_date", ["employeeId", "date"])
    .index("by_company", ["companyId"]),

  leaves: defineTable({
    employeeId: v.id("employees"),
    type: v.union(
      v.literal("annual"), v.literal("sick"), v.literal("unpaid"),
      v.literal("maternity"), v.literal("other"),
    ),
    startDate: v.string(),
    endDate: v.string(),
    days: v.number(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    reason: v.optional(v.string()),
    approvedBy: v.optional(v.id("employees")),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_employee", ["employeeId"])
    .index("by_status", ["status"])
    .index("by_date", ["startDate"])
    .index("by_company", ["companyId"])
    .index("by_company_status", ["companyId", "status"]),

  salaryPayments: defineTable({
    employeeId: v.id("employees"),
    month: v.string(),
    baseSalary: v.number(),
    workDays: v.number(),
    actualDays: v.number(),
    overtime: v.number(),
    overtimePay: v.number(),
    bonus: v.number(),
    deductions: v.number(),
    tax: v.number(),
    netSalary: v.number(),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("paid")),
    paidDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_employee", ["employeeId"])
    .index("by_month", ["month"])
    .index("by_status", ["status"])
    .index("by_employee_month", ["employeeId", "month"])
    .index("by_company", ["companyId"])
    .index("by_company_month", ["companyId", "month"]),

  // ─── Finance ─────────────────────────────────────────────────────────────

  accounts: defineTable({
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"), v.literal("liability"), v.literal("equity"),
      v.literal("income"), v.literal("expense"),
    ),
    subtype: v.optional(v.string()),
    parentId: v.optional(v.id("accounts")),
    currency: v.string(),
    isActive: v.boolean(),
    balance: v.number(),
    description: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_code", ["code"])
    .index("by_type", ["type"])
    .index("by_parent", ["parentId"]),

  journalEntries: defineTable({
    number: v.string(),
    date: v.string(),
    description: v.string(),
    referenceType: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("posted"), v.literal("voided")),
    totalDebit: v.number(),
    totalCredit: v.number(),
    createdBy: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_date", ["date"])
    .index("by_status", ["status"])
    .index("by_number", ["number"])
    .index("by_company", ["companyId"])
    .index("by_reference", ["referenceType", "referenceId"]),

  journalLines: defineTable({
    entryId: v.id("journalEntries"),
    accountId: v.id("accounts"),
    debit: v.number(),
    credit: v.number(),
    description: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_entry", ["entryId"])
    .index("by_account", ["accountId"]),

  expenses: defineTable({
    number: v.string(),
    category: v.string(),
    description: v.string(),
    amount: v.number(),
    currency: v.string(),
    date: v.string(),
    accountId: v.optional(v.id("accounts")),
    paidBy: v.optional(v.string()),
    attachmentUrl: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("paid")),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_date", ["date"])
    .index("by_status", ["status"])
    .index("by_category", ["category"])
    .index("by_company", ["companyId"])
    .index("by_company_status", ["companyId", "status"]),

  cashAccounts: defineTable({
    name: v.string(),
    type: v.union(v.literal("cash"), v.literal("bank")),
    currency: v.string(),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    balance: v.number(),
    isDefault: v.boolean(),
    isActive: v.boolean(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_type", ["type"])
    .index("by_default", ["isDefault"])
    .index("by_company", ["companyId"]),

  cashTransactions: defineTable({
    cashAccountId: v.id("cashAccounts"),
    type: v.union(v.literal("in"), v.literal("out"), v.literal("transfer")),
    amount: v.number(),
    currency: v.string(),
    date: v.string(),
    description: v.string(),
    category: v.optional(v.string()),
    referenceType: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    balanceAfter: v.number(),
    createdBy: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_account", ["cashAccountId"])
    .index("by_date", ["date"])
    .index("by_company", ["companyId"])
    .index("by_reference", ["referenceType", "referenceId"]),

  // ─── Notifications ────────────────────────────────────────────────────────

  notifications: defineTable({
    userId: v.optional(v.id("users")),
    type: v.union(
      v.literal("low_stock"), v.literal("expiring_soon"), v.literal("pending_approval"),
      v.literal("overdue_payment"), v.literal("leave_request"), v.literal("po_received"),
      v.literal("production_complete"), v.literal("system"),
    ),
    title: v.string(),
    message: v.string(),
    severity: v.union(
      v.literal("info"), v.literal("warning"), v.literal("error"), v.literal("success"),
    ),
    isRead: v.boolean(),
    isGlobal: v.boolean(),
    relatedId: v.optional(v.string()),
    relatedType: v.optional(v.string()),
    link: v.optional(v.string()),
    createdAt: v.string(),
    companyId: v.optional(v.id("companies")),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "isRead"])
    .index("by_global", ["isGlobal"])
    .index("by_created", ["createdAt"])
    .index("by_company_global", ["companyId", "isGlobal"]),

  // ─── Invitations ─────────────────────────────────────────────────────────────

  invitations: defineTable({
    companyId: v.id("companies"),
    invitedBy: v.id("users"),
    email: v.string(),
    phone: v.optional(v.string()),
    companyRole: v.string(),
    branchId: v.optional(v.id("branches")),
    allowedWarehouseIds: v.optional(v.array(v.string())),
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    expiresAt: v.string(),
    acceptedAt: v.optional(v.string()),
    acceptedBy: v.optional(v.id("users")),
    message: v.optional(v.string()),
  })
    .index("by_company", ["companyId"])
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),
});

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const laundryBusinesses = pgTable("laundry_businesses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  businessType: text("business_type").notNull().default("laundry"),
  timezone: text("timezone").notNull().default("Asia/Dubai"),
  currency: text("currency").notNull().default("AED"),
  active: boolean("active").notNull().default(true),
  contactEmail: text("contact_email"),
  phone: text("phone"),
  logoUrl: text("logo_url"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(587),
  smtpSecure: boolean("smtp_secure").default(false),
  smtpUser: text("smtp_user"),
  smtpPasswordEncrypted: text("smtp_password_encrypted"),
  smtpFrom: text("smtp_from"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertLaundryBusinessSchema = createInsertSchema(laundryBusinesses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type LaundryBusiness = typeof laundryBusinesses.$inferSelect;
export type InsertLaundryBusiness = z.infer<typeof insertLaundryBusinessSchema>;

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }),
  urgentPrice: numeric("urgent_price", { precision: 10, scale: 2 }),
  dryCleanPrice: numeric("dry_clean_price", { precision: 10, scale: 2 }),
  ironOnlyPrice: numeric("iron_only_price", { precision: 10, scale: 2 }),
  urgentIronOnlyPrice: numeric("urgent_iron_only_price", { precision: 10, scale: 2 }),
  urgentDryCleanPrice: numeric("urgent_dry_clean_price", { precision: 10, scale: 2 }),
  hasSizes: boolean("has_sizes").default(false),
  smallPrice: numeric("small_price", { precision: 10, scale: 2 }),
  mediumPrice: numeric("medium_price", { precision: 10, scale: 2 }),
  largePrice: numeric("large_price", { precision: 10, scale: 2 }),
  smallUrgentPrice: numeric("small_urgent_price", { precision: 10, scale: 2 }),
  mediumUrgentPrice: numeric("medium_urgent_price", { precision: 10, scale: 2 }),
  largeUrgentPrice: numeric("large_urgent_price", { precision: 10, scale: 2 }),
  smallDryCleanPrice: numeric("small_dry_clean_price", { precision: 10, scale: 2 }),
  mediumDryCleanPrice: numeric("medium_dry_clean_price", { precision: 10, scale: 2 }),
  largeDryCleanPrice: numeric("large_dry_clean_price", { precision: 10, scale: 2 }),
  smallIronOnlyPrice: numeric("small_iron_only_price", { precision: 10, scale: 2 }),
  mediumIronOnlyPrice: numeric("medium_iron_only_price", { precision: 10, scale: 2 }),
  largeIronOnlyPrice: numeric("large_iron_only_price", { precision: 10, scale: 2 }),
  smallUrgentIronOnlyPrice: numeric("small_urgent_iron_only_price", { precision: 10, scale: 2 }),
  mediumUrgentIronOnlyPrice: numeric("medium_urgent_iron_only_price", { precision: 10, scale: 2 }),
  largeUrgentIronOnlyPrice: numeric("large_urgent_iron_only_price", { precision: 10, scale: 2 }),
  smallUrgentDryCleanPrice: numeric("small_urgent_dry_clean_price", { precision: 10, scale: 2 }),
  mediumUrgentDryCleanPrice: numeric("medium_urgent_dry_clean_price", { precision: 10, scale: 2 }),
  largeUrgentDryCleanPrice: numeric("large_urgent_dry_clean_price", { precision: 10, scale: 2 }),
  isSqmPriced: boolean("is_sqm_priced").default(false),
  sqmPrice: numeric("sqm_price", { precision: 10, scale: 2 }),
  sku: text("sku"),
  category: text("category").default("Laundry"),
  stockQuantity: integer("stock_quantity").default(0),
  imageUrl: text("image_url"),
  starred: boolean("starred").default(false),
});

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contact: text("contact"),
  email: text("email"),
  address: text("address"),
  phone: text("phone"),
  phoneModified: boolean("phone_modified").default(false),
  amount: numeric("amount", { precision: 12, scale: 2 }).default("0"),
  deposit: numeric("deposit", { precision: 12, scale: 2 }).default("0"),
  balance: numeric("balance", { precision: 12, scale: 2 }).default("0"),
  notes: text("notes"),
  billNumber: text("bill_number"),
  preferredPaymentMethod: text("preferred_payment_method").default("cash"), // 'cash', 'card', 'bank'
  discountPercent: numeric("discount_percent", {
    precision: 5,
    scale: 2,
  }).default("0"),
  company: text("company"),
  clientType: text("client_type").default("regular"),
  brokerAddresses: text("broker_addresses").array().default([]),
});

export const clientTransactions = pgTable(
  "client_transactions",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull(),
    billId: integer("bill_id"), // Link to bills table for bill transactions
    type: text("type").notNull(), // 'bill' or 'deposit'
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    date: timestamp("date").notNull(),
    runningBalance: numeric("running_balance", {
      precision: 12,
      scale: 2,
    }).notNull(),
    paymentMethod: text("payment_method").default("cash"), // 'cash', 'card', 'bank'
    discount: numeric("discount", { precision: 12, scale: 2 }).default("0"),
    processedBy: text("processed_by"), // Name of user who processed the transaction
  },
  (table) => ({
    dateIdx: index("client_transactions_date_idx").on(table.date),
  }),
);

export const bills = pgTable(
  "bills",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).default("0"),
    description: text("description"),
    billDate: timestamp("bill_date").notNull(),
    referenceNumber: text("reference_number"),
    isPaid: boolean("is_paid").default(false),
    paymentMethod: text("payment_method"),
    createdByWorkerId: integer("created_by_worker_id"),
    createdBy: text("created_by"), // Name of user who created the bill
    notes: text("notes"),
    refunded: boolean("refunded").default(false),
    refundedAmount: numeric("refunded_amount", { precision: 12, scale: 2 }).default("0"),
    originalAmount: numeric("original_amount", { precision: 12, scale: 2 }),
    priceAdjustReason: text("price_adjust_reason"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
    deliveryCharge: numeric("delivery_charge", { precision: 12, scale: 2 }).default("0"),
    discountAppliedBy: text("discount_applied_by"),
  },
  (table) => ({
    billDateIdx: index("bills_bill_date_idx").on(table.billDate),
  }),
);

export const billPayments = pgTable(
  "bill_payments",
  {
    id: serial("id").primaryKey(),
    billId: integer("bill_id").notNull(),
    clientId: integer("client_id").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentDate: timestamp("payment_date").notNull(),
    paymentMethod: text("payment_method").default("cash"),
    notes: text("notes"),
  },
  (table) => ({
    paymentDateIdx: index("bill_payments_payment_date_idx").on(table.paymentDate),
    billIdIdx: index("bill_payments_bill_id_idx").on(table.billId),
  }),
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id"),
    billId: integer("bill_id"),
    customerName: text("customer_name"),
    orderNumber: text("order_number").notNull(),
    items: text("items"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).default("0"),
    discountPercent: numeric("discount_percent", {
      precision: 5,
      scale: 2,
    }).default("0"),
    discountAmount: numeric("discount_amount", {
      precision: 12,
      scale: 2,
    }).default("0"),
    deliveryCharge: numeric("delivery_charge", { precision: 12, scale: 2 }).default("0"),
    finalAmount: numeric("final_amount", { precision: 12, scale: 2 }),
    paymentMethod: text("payment_method").default("cash"), // 'cash', 'card', 'bank'
    serviceType: text("service_type").default("normal"), // 'normal', 'dry_clean'
    status: text("status").default("entry"),
    deliveryType: text("delivery_type").default("takeaway"),
    expectedDeliveryAt: timestamp("expected_delivery_at"),
    entryDate: timestamp("entry_date").notNull(),
    entryBy: text("entry_by"),
    entryByWorkerId: integer("entry_by_worker_id"),
    tagDone: boolean("tag_done").default(false),
    tagDate: timestamp("tag_date"),
    tagBy: text("tag_by"),
    tagWorkerId: integer("tag_worker_id"),
    washingDone: boolean("washing_done").default(false),
    washingDate: timestamp("washing_date"),
    washingBy: text("washing_by"),
    packingDone: boolean("packing_done").default(false),
    packingDate: timestamp("packing_date"),
    packingBy: text("packing_by"),
    packingWorkerId: integer("packing_worker_id"),
    delivered: boolean("delivered").default(false),
    deliveryDate: timestamp("delivery_date"),
    deliveryBy: text("delivery_by"),
    deliveredByWorkerId: integer("delivered_by_worker_id"),
    notes: text("notes"),
    urgent: boolean("urgent").default(false),
    publicViewToken: text("public_view_token"),
    tips: numeric("tips", { precision: 12, scale: 2 }).default("0"),
    deliveryPhoto: text("delivery_photo"),
    deliveryPhotos: text("delivery_photos").array(),
    deliveryAddress: text("delivery_address"),
    stockDeducted: boolean("stock_deducted").default(false),
    itemCountVerified: boolean("item_count_verified").default(false),
    verifiedAt: timestamp("verified_at"),
    verifiedByWorkerId: integer("verified_by_worker_id"),
    verifiedByWorkerName: text("verified_by_worker_name"),
    itemCountAtIntake: integer("item_count_at_intake"),
    itemCountAtRelease: integer("item_count_at_release"),
    adjustedTotal: numeric("adjusted_total", { precision: 12, scale: 2 }),
    priceAdjustReason: text("price_adjust_reason"),
    checkedItems: text("checked_items"),
    itemPickupStatus: text("item_pickup_status"),
  },
  (table) => ({
    entryDateIdx: index("orders_entry_date_idx").on(table.entryDate),
    billIdIdx: index("orders_bill_id_idx").on(table.billId),
  }),
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  pin: text("pin").notNull().default("12345"), // 5-digit PIN for verification
  role: text("role").notNull().default("counter"), // 'admin', 'counter', 'section', 'driver'
  name: text("name"),
  email: text("email"),
  active: boolean("active").default(true),
  businessId: integer("business_id").references(() => laundryBusinesses.id),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
});

export const packingWorkers = pgTable("packing_workers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").default("Staff"),
  pin: text("pin").notNull(), // 5-digit PIN
  active: boolean("active").default(true),
});

// Staff members assigned to shared role accounts (counter, section)
export const staffMembers = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  pin: text("pin").notNull(), // 5-digit PIN for identification
  roleType: text("role_type").notNull(), // 'counter', 'section', 'driver' - which account they belong to
  active: boolean("active").default(true),
});

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerAddress: text("customer_address"),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  itemName: text("item_name"),
  reason: text("reason").notNull(),
  notes: text("notes"),
  refundAmount: numeric("refund_amount", { precision: 12, scale: 2 }).default(
    "0",
  ),
  refundType: text("refund_type").default("credit"), // 'cash', 'credit'
  itemValue: numeric("item_value", { precision: 12, scale: 2 }).default("0"),
  responsibleStaffId: integer("responsible_staff_id"),
  responsibleStaffName: text("responsible_staff_name"),
  reporterName: text("reporter_name"),
  incidentType: text("incident_type").default("refund"), // 'refund', 'damage', 'complaint', 'missing_item', 'other'
  incidentStage: text("incident_stage").default("delivery"), // 'reception', 'tagging', 'washing', 'packing', 'delivery'
  status: text("status").default("open"), // 'open', 'resolved', 'pending'
  incidentDate: timestamp("incident_date").notNull(),
  resolvedDate: timestamp("resolved_date"),
  resolution: text("resolution"),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});
export const insertClientSchema = createInsertSchema(clients)
  .omit({ id: true })
  .extend({
    name: z.string().optional().default(""),
    contact: z.string().optional(),
    phone: z.string().optional().default(""),
    address: z.string().optional().default(""),
    amount: z.union([z.string(), z.number()]).optional(),
    deposit: z.union([z.string(), z.number()]).optional(),
    balance: z.union([z.string(), z.number()]).optional(),
  });
export const insertBillSchema = createInsertSchema(bills)
  .omit({ id: true })
  .extend({
    amount: z.union([z.string(), z.number()]),
    paidAmount: z.union([z.string(), z.number()]).optional(),
    deliveryCharge: z.union([z.string(), z.number()]).optional(),
    clientId: z.number().optional().nullable(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    billDate: z.union([z.date(), z.string()]),
  });
export const insertBillPaymentSchema = createInsertSchema(billPayments)
  .omit({ id: true })
  .extend({
    amount: z.union([z.string(), z.number()]),
    billId: z.number(),
    clientId: z.number(),
    paymentDate: z.union([z.date(), z.string()]),
  });
export const insertTransactionSchema = createInsertSchema(clientTransactions)
  .omit({ id: true })
  .extend({
    amount: z.union([z.string(), z.number()]),
    runningBalance: z.union([z.string(), z.number()]),
    date: z.union([z.date(), z.string()]),
  });
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertPackingWorkerSchema = createInsertSchema(packingWorkers)
  .omit({ id: true })
  .extend({
    pin: z
      .string()
      .length(5, "PIN must be exactly 5 digits")
      .regex(/^\d{5}$/, "PIN must be 5 digits"),
  });
export const insertStaffMemberSchema = createInsertSchema(staffMembers)
  .omit({ id: true })
  .extend({
    name: z.string().min(1, "Name is required"),
    pin: z
      .string()
      .length(5, "PIN must be exactly 5 digits")
      .regex(/^\d{5}$/, "PIN must be 5 digits"),
    roleType: z.enum(["counter", "section", "driver"]),
  });
export const insertOrderSchema = createInsertSchema(orders)
  .omit({ id: true })
  .extend({
    totalAmount: z.union([z.string(), z.number()]),
    paidAmount: z.union([z.string(), z.number()]).optional(),
    deliveryCharge: z.union([z.string(), z.number()]).optional(),
    clientId: z.number().optional().nullable(),
    billId: z.number().optional().nullable(),
    customerName: z.string().optional(),
    entryDate: z.union([z.date(), z.string()]),
    expectedDeliveryAt: z.union([z.date(), z.string()]).optional().nullable(),
    tagDate: z.union([z.date(), z.string()]).optional().nullable(),
    washingDate: z.union([z.date(), z.string()]).optional().nullable(),
    packingDate: z.union([z.date(), z.string()]).optional().nullable(),
    deliveryDate: z.union([z.date(), z.string()]).optional().nullable(),
    packingWorkerId: z.number().optional().nullable(),
  });

export const insertIncidentSchema = createInsertSchema(incidents)
  .omit({ id: true })
  .extend({
    customerName: z.string().min(1, "Customer name is required"),
    reason: z.string().min(1, "Reason is required"),
    refundAmount: z.union([z.string(), z.number()]).optional(),
    itemValue: z.union([z.string(), z.number()]).optional(),
    incidentDate: z.union([z.date(), z.string()]),
    resolvedDate: z.union([z.date(), z.string()]).optional().nullable(),
  });

export const missingItems = pgTable("missing_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  customerName: text("customer_name"),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").default(1),
  itemValue: numeric("item_value", { precision: 12, scale: 2 }).default("0"),
  stage: text("stage").notNull(), // 'tag', 'washing', 'packing', 'delivery', 'storage'
  responsibleWorkerId: integer("responsible_worker_id"),
  responsibleWorkerName: text("responsible_worker_name"),
  reportedByWorkerId: integer("reported_by_worker_id"),
  reportedByWorkerName: text("reported_by_worker_name"),
  notes: text("notes"),
  status: text("status").default("reported"), // 'reported', 'investigating', 'found', 'lost', 'compensated'
  reportedAt: timestamp("reported_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
});

export const insertMissingItemSchema = createInsertSchema(missingItems)
  .omit({ id: true })
  .extend({
    itemName: z.string().min(1, "Item name is required"),
    stage: z.string().min(1, "Stage is required"),
    quantity: z.number().optional(),
    itemValue: z.union([z.string(), z.number()]).optional(),
    reportedAt: z.union([z.date(), z.string()]),
    resolvedAt: z.union([z.date(), z.string()]).optional().nullable(),
  });

// Stage checklists - track item verification at each processing stage
export const stageChecklists = pgTable("stage_checklists", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  stage: text("stage").notNull(), // 'tagging', 'washing', 'sorting', 'folding', 'packing'
  checkedItems: text("checked_items"), // JSON array of checked item indices
  totalItems: integer("total_items").notNull(),
  checkedCount: integer("checked_count").default(0),
  isComplete: boolean("is_complete").default(false),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  workerId: integer("worker_id"),
  workerName: text("worker_name"),
});

export const insertStageChecklistSchema = createInsertSchema(stageChecklists)
  .omit({ id: true })
  .extend({
    orderId: z.number(),
    stage: z.string().min(1, "Stage is required"),
    totalItems: z.number(),
    checkedItems: z.string().optional(),
    startedAt: z.union([z.date(), z.string()]).optional().nullable(),
    completedAt: z.union([z.date(), z.string()]).optional().nullable(),
  });

export type Product = typeof products.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Bill = typeof bills.$inferSelect;
export type BillPayment = typeof billPayments.$inferSelect;
export type ClientTransaction = typeof clientTransactions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type PackingWorker = typeof packingWorkers.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type InsertBill = z.infer<typeof insertBillSchema>;
export type InsertBillPayment = z.infer<typeof insertBillPaymentSchema>;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertPackingWorker = z.infer<typeof insertPackingWorkerSchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type MissingItem = typeof missingItems.$inferSelect;
export type InsertMissingItem = z.infer<typeof insertMissingItemSchema>;
export type StageChecklist = typeof stageChecklists.$inferSelect;
export type InsertStageChecklist = z.infer<typeof insertStageChecklistSchema>;
export type StaffMember = typeof staffMembers.$inferSelect;
export type InsertStaffMember = z.infer<typeof insertStaffMemberSchema>;

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true });
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

export const productCategorySettings = pgTable("product_category_settings", {
  id: serial("id").primaryKey(),
  baseCategories: text("base_categories").array().notNull().default([]),
  customCategories: text("custom_categories").array().notNull().default([]),
  inventoryDisplayOrder: text("inventory_display_order").array().notNull().default([]),
  orderDisplayOrder: text("order_display_order").array().notNull().default([]),
  favoritesOrder: integer("favorites_order").array().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProductCategorySettingsSchema = createInsertSchema(productCategorySettings).omit({
  id: true,
  updatedAt: true,
});
export type ProductCategorySettings = typeof productCategorySettings.$inferSelect;
export type InsertProductCategorySettings = z.infer<typeof insertProductCategorySettingsSchema>;

export const companyContactSettings = pgTable("company_contact_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull().default("Liquid Washes Laundry"),
  tagline: text("tagline").default("Smartness Partners"),
  telephone: text("telephone").default("026 815 824"),
  mobilePhone: text("mobile_phone").default("+971 56 338 0001"),
  whatsappPhone: text("whatsapp_phone").default("+971 56 338 0001"),
  email: text("email").default("info@lwl.ae"),
  website: text("website").default("www.lwl.ae"),
  addressLine1: text("address_line_1").default("Central Market D/109"),
  addressLine2: text("address_line_2").default("Al Dhanna City, Al Ruwais"),
  addressLine3: text("address_line_3").default("Abu Dhabi - UAE"),
  dashboardClockHour12: boolean("dashboard_clock_hour12").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompanyContactSettingsSchema = createInsertSchema(companyContactSettings).omit({
  id: true,
  updatedAt: true,
});
export type CompanyContactSettings = typeof companyContactSettings.$inferSelect;
export type InsertCompanyContactSettings = z.infer<typeof insertCompanyContactSettingsSchema>;

export const appSecuritySettings = pgTable("app_security_settings", {
  id: serial("id").primaryKey(),
  lockdownEnabled: boolean("lockdown_enabled").notNull().default(false),
  lockdownReason: text("lockdown_reason").notNull().default("Page lockdown for security reasons."),
  lockdownAt: timestamp("lockdown_at"),
  lockdownBy: text("lockdown_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAppSecuritySettingsSchema = createInsertSchema(appSecuritySettings).omit({
  id: true,
  updatedAt: true,
});
export type AppSecuritySettings = typeof appSecuritySettings.$inferSelect;
export type InsertAppSecuritySettings = z.infer<typeof insertAppSecuritySettingsSchema>;

export const salesReportScheduleSettings = pgTable("sales_report_schedule_settings", {
  id: serial("id").primaryKey(),
  dailyReportDayOffset: integer("daily_report_day_offset").notNull().default(0),
  dailyHour: integer("daily_hour").notNull().default(23),
  dailyMinute: integer("daily_minute").notNull().default(59),
  weeklyDay: integer("weekly_day").notNull().default(6),
  weeklyHour: integer("weekly_hour").notNull().default(23),
  weeklyMinute: integer("weekly_minute").notNull().default(59),
  monthlyDay: integer("monthly_day").notNull().default(31),
  monthlyHour: integer("monthly_hour").notNull().default(23),
  monthlyMinute: integer("monthly_minute").notNull().default(59),
  yearlyMonth: integer("yearly_month").notNull().default(12),
  yearlyDay: integer("yearly_day").notNull().default(31),
  yearlyHour: integer("yearly_hour").notNull().default(23),
  yearlyMinute: integer("yearly_minute").notNull().default(59),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSalesReportScheduleSettingsSchema = createInsertSchema(salesReportScheduleSettings).omit({
  id: true,
  updatedAt: true,
});
export type SalesReportScheduleSettings = typeof salesReportScheduleSettings.$inferSelect;
export type InsertSalesReportScheduleSettings = z.infer<typeof insertSalesReportScheduleSettingsSchema>;

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  orderNumber: text("order_number").notNull(),
  clientId: integer("client_id"),
  clientName: text("client_name").notNull(),
  accountNumber: text("account_number"),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true, updatedAt: true });
export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

// Explicit API types
export type ProductResponse = Product;
export type CreateProductRequest = InsertProduct;
export type UpdateProductRequest = Partial<InsertProduct>;
export type ClientResponse = Client;
export type CreateClientRequest = InsertClient;
export type UpdateClientRequest = Partial<InsertClient>;
export type BillResponse = Bill;
export type CreateBillRequest = InsertBill;
export type UpdateBillRequest = Partial<InsertBill>;
export type TransactionResponse = ClientTransaction;
export type CreateTransactionRequest = InsertTransaction;
export type OrderResponse = Order;
export type CreateOrderRequest = InsertOrder;
export type UpdateOrderRequest = Partial<InsertOrder>;
export type UpdateCompanyContactSettingsRequest = Partial<InsertCompanyContactSettings>;

import { db, getCurrentDatabaseScope } from "./db";
import bcrypt from "bcryptjs";
import {
  products,
  laundryBusinesses,
  clients,
  bills,
  billPayments,
  clientTransactions,
  orders,
  packingWorkers,
  incidents,
  missingItems,
  users,
  staffMembers,
  productCategorySettings,
  companyContactSettings,
  salesReportScheduleSettings,
  type Product,
  type Client,
  type Bill,
  type BillPayment,
  type ClientTransaction,
  type Order,
  type PackingWorker,
  type Incident,
  type MissingItem,
  type StaffMember,
  type ProductCategorySettings,
  type CompanyContactSettings,
  type SalesReportScheduleSettings,
  type InsertProduct,
  type InsertClient,
  type InsertBill,
  type InsertBillPayment,
  type InsertTransaction,
  type InsertOrder,
  type InsertPackingWorker,
  type InsertIncident,
  type InsertMissingItem,
  type InsertStaffMember,
  type InsertProductCategorySettings,
  type InsertCompanyContactSettings,
  type InsertSalesReportScheduleSettings,
  type UpdateProductRequest,
  type UpdateClientRequest,
  type UpdateOrderRequest,
  type User,
  companies,
  reviews,
  type Company,
  type InsertCompany,
  type Review,
  type InsertReview,
} from "@shared/schema";
import { eq, ilike, or, desc, asc, and, ne, gte, lte, sql, inArray, isNull, type SQLWrapper } from "drizzle-orm";
import { DEFAULT_PRODUCT_BASE_CATEGORIES, normalizeProductCategorySettings } from "@shared/productCategories";
import {
  normalizePhoneForComparison,
  normalizePhoneForStorage,
} from "@shared/phone";

type OrderTrackingQueryOptions = {
  search?: string;
  accountNumber?: string;
  orderNumber?: string;
  billAmount?: string;
  billNumber?: string;
  nameAddress?: string;
  mobileNumber?: string;
  companyName?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  dateField?: "entry" | "delivery";
  sortMode?: "date" | "system";
  sortOrder?: "newest" | "oldest";
  stage?: "all" | "create" | "tag-complete" | "packing-done" | "delivery";
  priority?: "all" | "urgent" | "normal";
  expectedDate?: "off" | "only";
  deliveryType?: "all" | "takeaway" | "delivery";
  paymentStatus?: "all" | "paid" | "unpaid";
};

function currentTenantBusinessId(): number | null {
  const scope = getCurrentDatabaseScope();
  return scope && "businessId" in scope ? scope.businessId : null;
}

function normalizeTrackingExactBillNumber(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^bill[-\s#]*/i, "")
    .toLowerCase();
}

function normalizeTrackingExactOrderNumber(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^ord[-\s#]*/i, "")
    .toLowerCase();
}

export type OrderTrackingSummary = {
  count: number;
  workReceived: number;
  discount: number;
  finalAmount: number;
  paidAmount: number;
  dueAmount: number;
};

export type OrderTrackingSelectionItem = {
  id: number;
  tagDone: boolean | null;
  packingDone: boolean | null;
  delivered: boolean | null;
  urgent: boolean | null;
  deliveryType: string | null;
  expectedDeliveryAt: Date | null;
  billIsPaid: boolean | null;
};

export type SalesReportPeriod = "daily" | "monthly" | "yearly" | "range";

export type SalesReportPeriodInput = {
  period: SalesReportPeriod;
  from: Date;
  to: Date;
};

export type SalesReportPeriodData = {
  period: {
    period: SalesReportPeriod;
    from: string;
    to: string;
  };
  clients: Client[];
  orders: Order[];
  bills: BillWithPaymentRecorder[];
  billPayments: BillPayment[];
};

const MONEY_EPSILON = 0.009;

const stripPhoneDigitsSql = (value: SQLWrapper) =>
  sql<string>`regexp_replace(coalesce(${value}, ''), '\D', '', 'g')`;

const normalizeUaePhoneForSearchSql = (value: SQLWrapper) => {
  const digits = stripPhoneDigitsSql(value);

  return sql<string>`case
    when ${digits} like '00971%' then substring(${digits} from 3)
    when ${digits} like '971%' then ${digits}
    when ${digits} like '0%' then '971' || substring(${digits} from 2)
    else ${digits}
  end`;
};

export type BillWithPaymentRecorder = Bill & {
  paymentProcessedBy?: string | null;
  paymentProcessedAt?: Date | null;
};

export type LiveResource =
  | "bills"
  | "clientTransactions"
  | "productCategorySettings";

export type LiveResourceUpdate = {
  type: "updated";
  resource: LiveResource;
  version: number;
  changedAt: string;
};

const normalizeStoredPaymentMethod = (paymentMethod?: string | null): string => {
  const normalized = String(paymentMethod || "").trim().toLowerCase();

  switch (normalized) {
    case "bulk_deposit":
    case "deposit":
      return "deposit";
    case "cash":
      return "cash";
    case "card":
      return "card";
    case "bank":
      return "bank";
    case "transfer":
      return "transfer";
    default:
      return normalized || "cash";
  }
};

const getPaymentMethodComparisonKey = (paymentMethod?: string | null): string => {
  const normalized = normalizeStoredPaymentMethod(paymentMethod);
  if (normalized === "bank" || normalized === "transfer") {
    return "bank";
  }
  return normalized;
};

const buildCombinedPaymentMethod = (paymentMethods: Array<string | null | undefined>): string => {
  const uniqueMethods: string[] = [];
  const seenComparisonKeys = new Set<string>();

  for (const paymentMethod of paymentMethods) {
    const normalizedMethod = normalizeStoredPaymentMethod(paymentMethod);
    const comparisonKey = getPaymentMethodComparisonKey(normalizedMethod);

    if (!normalizedMethod || seenComparisonKeys.has(comparisonKey)) {
      continue;
    }

    seenComparisonKeys.add(comparisonKey);
    uniqueMethods.push(normalizedMethod);
  }

  if (uniqueMethods.length === 0) {
    return "cash";
  }

  if (uniqueMethods.length === 1) {
    return uniqueMethods[0];
  }

  return uniqueMethods.join("+");
};

const formatStoredPaymentMethodForHistory = (paymentMethod?: string | null): string => {
  const normalized = String(paymentMethod || "").trim();
  if (!normalized) return "CASH";

  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => formatStoredPaymentMethodForHistory(part)).join(" + ");
  }

  switch (normalizeStoredPaymentMethod(normalized)) {
    case "deposit":
      return "ACCOUNT CREDIT";
    case "bank":
    case "transfer":
      return "BANK TRANSFER";
    case "cash":
      return "CASH";
    case "card":
      return "CARD";
    default:
      return normalized.toUpperCase();
  }
};

const extractSharedPaymentMeta = (value?: string | null) => {
  if (!value) return null;
  const match = String(value).match(/\[SHARED:(\d+):(\d+)\]/i);
  if (!match) return null;

  const billCount = Number(match[1]);
  const clientCount = Number(match[2]);
  if (!Number.isFinite(billCount) || !Number.isFinite(clientCount)) {
    return null;
  }

  return { billCount, clientCount };
};

const buildSharedPaymentLabel = (billCount: number, clientCount: number) => {
  if (billCount <= 1 || clientCount <= 1) {
    return null;
  }

  return `${billCount} separate client bill shared payment`;
};

const extractOrderNumberFromBill = (bill: Bill) => {
  const candidates = [bill.referenceNumber, bill.description];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;

    const explicitMatch = text.match(/Order\s*#?\s*(ORD-[A-Z0-9-]+)/i);
    if (explicitMatch?.[1]) {
      return explicitMatch[1].toUpperCase();
    }

    const billReferenceMatch = text.match(/BILL-(ORD-[A-Z0-9-]+)/i);
    if (billReferenceMatch?.[1]) {
      return billReferenceMatch[1].toUpperCase();
    }

    const looseMatch = text.match(/\b(ORD-[A-Z0-9-]+)\b/i);
    if (looseMatch?.[1]) {
      return looseMatch[1].toUpperCase();
    }
  }

  return null;
};

const buildBillClientTransactionDescription = (
  prefix: "Payment for Bill" | "Deposit used for Bill",
  bill: Bill,
  notes?: string | null,
) => {
  const sharedMeta = extractSharedPaymentMeta(notes);
  const sharedLabel = sharedMeta
    ? buildSharedPaymentLabel(sharedMeta.billCount, sharedMeta.clientCount)
    : null;

  if (sharedLabel) {
    return `${prefix} #${bill.id}: ${sharedLabel}`;
  }

  if (prefix === "Deposit used for Bill") {
    const orderNumber = extractOrderNumberFromBill(bill);
    return orderNumber
      ? `${prefix} #${bill.id}: Order #${orderNumber}`
      : `${prefix} #${bill.id}`;
  }

  return `${prefix} #${bill.id}: ${bill.description || "N/A"}`;
};

export interface IStorage {
  getProducts(search?: string): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, updates: UpdateProductRequest): Promise<Product>;
  deleteProduct(id: number): Promise<void>;
  getClients(search?: string): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  findClientByNameAndPhone(
    name: string,
    phone: string,
    excludeId?: number,
  ): Promise<Client | undefined>;
  findClientByNameAndAddress(
    name: string,
    address: string,
    excludeId?: number,
  ): Promise<Client | undefined>;
  findClientByPhone(
    phone: string,
    excludeId?: number,
  ): Promise<Client | undefined>;
  findClientByName(
    name: string,
    excludeId?: number,
  ): Promise<Client | undefined>;
  findClientByAddress(
    address: string,
    excludeId?: number,
  ): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, updates: UpdateClientRequest): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  getBills(): Promise<BillWithPaymentRecorder[]>;
  getBill(id: number): Promise<BillWithPaymentRecorder | undefined>;
  getBillPaymentRecorders(
    billIds: number[],
  ): Promise<Map<number, { processedBy: string; date: Date }>>;
  getOrderPaymentRecorders(
    orderNumbers: string[],
  ): Promise<Map<string, { processedBy: string; date: Date; billId: number }>>;
  getClientBills(clientId: number): Promise<BillWithPaymentRecorder[]>;
  getUnpaidBills(clientId: number): Promise<BillWithPaymentRecorder[]>;
  createBill(bill: InsertBill): Promise<Bill>;
  updateBill(
    id: number,
    updates: Partial<InsertBill> & { isPaid?: boolean },
  ): Promise<Bill>;
  deleteBill(id: number): Promise<void>;
  getBillPayments(billId: number): Promise<BillPayment[]>;
  getAllBillPayments(): Promise<BillPayment[]>;
  getClientBillPayments(clientId: number): Promise<BillPayment[]>;
  getSalesReportPeriodData(input: SalesReportPeriodInput): Promise<SalesReportPeriodData>;
  createBillPayment(payment: InsertBillPayment): Promise<BillPayment>;
  updateBillPaymentDate(paymentId: number, newDate: Date): Promise<BillPayment>;
  payBill(
    billId: number,
    amount: string,
    paymentMethod?: string,
    notes?: string,
    processedBy?: string,
  ): Promise<{ bill: Bill; payment: BillPayment }>;
  getClientTransactions(clientId: number): Promise<ClientTransaction[]>;
  clearClientTransactions(clientId: number): Promise<void>;
  createTransaction(transaction: InsertTransaction): Promise<ClientTransaction>;
  updateClientTransaction(
    transactionId: number,
    data: { amount: string; description: string },
  ): Promise<ClientTransaction>;
  addClientBill(
    clientId: number,
    amount: string,
    description?: string,
  ): Promise<ClientTransaction>;
  addClientDeposit(
    clientId: number,
    amount: string,
    description?: string,
    paymentMethod?: string,
    processedBy?: string,
  ): Promise<ClientTransaction>;
  deductClientDeposit(
    clientId: number,
    amount: string,
    description?: string,
    processedBy?: string,
  ): Promise<ClientTransaction>;
  deleteClientTransaction(transactionId: number): Promise<void>;
  getOrders(search?: string): Promise<Order[]>;
  getOrdersForTracking(options?: OrderTrackingQueryOptions): Promise<Order[]>;
  getOrderCountForTracking(options?: OrderTrackingQueryOptions): Promise<number>;
  getOrderSelectionForTracking(options?: OrderTrackingQueryOptions): Promise<OrderTrackingSelectionItem[]>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrderByPublicToken(token: string): Promise<Order | undefined>;
  getOrderByNumber(orderNumber: string): Promise<Order | undefined>;
  getDeliveredOrderByNumber(orderNumber: string): Promise<Order | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: number, updates: UpdateOrderRequest): Promise<Order>;
  deleteOrder(id: number): Promise<void>;
  deleteAllOrders(): Promise<void>;
  deleteAllTransactions(): Promise<void>;
  deleteAllBills(): Promise<void>;
  deleteAllClients(): Promise<void>;
  deleteAllIncidents(): Promise<void>;
  getPackingWorkers(): Promise<PackingWorker[]>;
  getPackingWorker(id: number): Promise<PackingWorker | undefined>;
  createPackingWorker(worker: InsertPackingWorker): Promise<PackingWorker>;
  updatePackingWorker(
    id: number,
    updates: Partial<InsertPackingWorker>,
  ): Promise<PackingWorker>;
  deletePackingWorker(id: number): Promise<void>;
  verifyPackingWorkerPin(pin: string): Promise<PackingWorker | null>;
  verifyDeliveryWorkerPin(pin: string): Promise<PackingWorker | null>;
  verifyUserPin(pin: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  updateUser(id: number, updates: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getUsers(): Promise<User[]>;
  getClientOrders(clientId: number): Promise<Order[]>;
  getIncidents(search?: string): Promise<Incident[]>;
  getIncident(id: number): Promise<Incident | undefined>;
  createIncident(incident: InsertIncident): Promise<Incident>;
  updateIncident(
    id: number,
    updates: Partial<InsertIncident>,
  ): Promise<Incident>;
  deleteIncident(id: number): Promise<void>;
  getAllocatedStock(): Promise<Record<string, number>>;
  getOrdersForProduct(productName: string): Promise<{ orderNumber: string; quantity: number; orderId: number }[]>;
  addStockForOrder(orderId: number): Promise<void>;
  deductStockForOrder(orderId: number): Promise<void>;
  getMissingItems(search?: string): Promise<MissingItem[]>;
  getMissingItem(id: number): Promise<MissingItem | undefined>;
  createMissingItem(item: InsertMissingItem): Promise<MissingItem>;
  updateMissingItem(
    id: number,
    updates: Partial<InsertMissingItem>,
  ): Promise<MissingItem>;
  deleteMissingItem(id: number): Promise<void>;
  // Staff members methods
  getStaffMembers(roleType?: string): Promise<StaffMember[]>;
  getStaffMember(id: number): Promise<StaffMember | undefined>;
  createStaffMember(member: InsertStaffMember): Promise<StaffMember>;
  updateStaffMember(id: number, updates: Partial<{ name: string; pin: string; active: boolean }>): Promise<StaffMember>;
  deleteStaffMember(id: number): Promise<void>;
  verifyStaffMemberPin(pin: string): Promise<StaffMember | null>;
  checkStaffMemberPinExists(pin: string, excludeId?: number): Promise<boolean>;
  getProductCategorySettings(): Promise<ProductCategorySettings>;
  updateProductCategorySettings(
    updates: Partial<InsertProductCategorySettings>,
  ): Promise<ProductCategorySettings>;
  subscribeToLiveResource(
    resource: LiveResource,
    listener: (update: LiveResourceUpdate) => void,
  ): () => void;
  getLiveResourceVersion(resource: LiveResource): number;
  notifyLiveResourceUpdated(resource: LiveResource): void;
  getCompanyContactSettings(): Promise<CompanyContactSettings>;
  updateCompanyContactSettings(
    updates: Partial<InsertCompanyContactSettings>,
  ): Promise<CompanyContactSettings>;
  getSalesReportScheduleSettings(): Promise<SalesReportScheduleSettings>;
  updateSalesReportScheduleSettings(
    updates: Partial<InsertSalesReportScheduleSettings>,
  ): Promise<SalesReportScheduleSettings>;
  getCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  deleteCompany(id: number): Promise<void>;
  getReviews(): Promise<Review[]>;
  getReviewByOrderId(orderId: number): Promise<Review | undefined>;
  createReview(review: InsertReview): Promise<Review>;
  updateReview(id: number, updates: Partial<InsertReview>): Promise<Review>;
  deleteReview(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private readonly liveResourceVersions: Record<LiveResource, number> = {
    bills: 0,
    clientTransactions: 0,
    productCategorySettings: 0,
  };

  private readonly liveResourceListeners: Record<
    LiveResource,
    Set<(update: LiveResourceUpdate) => void>
  > = {
    bills: new Set(),
    clientTransactions: new Set(),
    productCategorySettings: new Set(),
  };

  subscribeToLiveResource(
    resource: LiveResource,
    listener: (update: LiveResourceUpdate) => void,
  ): () => void {
    const listeners = this.liveResourceListeners[resource];
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  getLiveResourceVersion(resource: LiveResource): number {
    return this.liveResourceVersions[resource];
  }

  notifyLiveResourceUpdated(resource: LiveResource): void {
    const nextVersion = this.liveResourceVersions[resource] + 1;
    this.liveResourceVersions[resource] = nextVersion;

    const update: LiveResourceUpdate = {
      type: "updated",
      resource,
      version: nextVersion,
      changedAt: new Date().toISOString(),
    };

    for (const listener of Array.from(this.liveResourceListeners[resource])) {
      listener(update);
    }
  }

  private async ensureProductCategorySettingsTable(): Promise<void> {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_RUNTIME_SCHEMA_MIGRATIONS !== "true"
    ) {
      return;
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS product_category_settings (
        id SERIAL PRIMARY KEY,
        base_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        custom_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        inventory_display_order TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        order_display_order TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        favorites_order INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE product_category_settings
      ADD COLUMN IF NOT EXISTS favorites_order INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[]
    `);
  }

  async getBillPaymentRecorders(
    billIds: number[],
  ): Promise<Map<number, { processedBy: string; date: Date }>> {
    const normalizedBillIds = Array.from(
      new Set(
        billIds
          .map((billId) => Number(billId))
          .filter((billId) => Number.isFinite(billId) && billId > 0),
      ),
    );

    if (normalizedBillIds.length === 0) {
      return new Map();
    }

    const relatedTransactions = await db
      .select({
        billId: clientTransactions.billId,
        processedBy: clientTransactions.processedBy,
        date: clientTransactions.date,
      })
      .from(clientTransactions)
      .where(
        and(
          inArray(clientTransactions.billId, normalizedBillIds),
          sql`COALESCE(TRIM(${clientTransactions.processedBy}), '') <> ''`,
        ),
      )
      .orderBy(desc(clientTransactions.date), desc(clientTransactions.id));

    const recorderByBillId = new Map<number, { processedBy: string; date: Date }>();

    for (const transaction of relatedTransactions) {
      const billId = Number(transaction.billId);
      const processedBy = String(transaction.processedBy || "").trim();
      if (!Number.isFinite(billId) || !processedBy || recorderByBillId.has(billId)) {
        continue;
      }
      recorderByBillId.set(billId, {
        processedBy,
        date: transaction.date,
      });
    }

    return recorderByBillId;
  }

  async getOrderPaymentRecorders(
    orderNumbers: string[],
  ): Promise<Map<string, { processedBy: string; date: Date; billId: number }>> {
    const normalizedOrderNumbers = Array.from(
      new Set(
        orderNumbers
          .map((orderNumber) => String(orderNumber || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    if (normalizedOrderNumbers.length === 0) {
      return new Map();
    }

    const linkedOrders = await db
      .select({
        orderNumber: orders.orderNumber,
        billId: orders.billId,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.orderNumber, normalizedOrderNumbers),
          sql`${orders.billId} IS NOT NULL`,
        ),
      );

    const billIds = linkedOrders
      .map((order) => Number(order.billId))
      .filter((billId) => Number.isFinite(billId) && billId > 0);
    const recorderByBillId = await this.getBillPaymentRecorders(billIds);

    const recorderByOrderNumber = new Map<string, { processedBy: string; date: Date; billId: number }>();

    for (const order of linkedOrders) {
      const orderNumber = String(order.orderNumber || "").trim().toUpperCase();
      const billId = Number(order.billId);
      const billRecorder = recorderByBillId.get(billId);
      if (!orderNumber || !Number.isFinite(billId) || !billRecorder || recorderByOrderNumber.has(orderNumber)) {
        continue;
      }
      recorderByOrderNumber.set(orderNumber, {
        processedBy: billRecorder.processedBy,
        date: billRecorder.date,
        billId,
      });
    }

    return recorderByOrderNumber;
  }

  async getProducts(search?: string): Promise<Product[]> {
    const businessId = currentTenantBusinessId();
    const tenantFilter = businessId ? eq(products.businessId, businessId) : undefined;
    if (search) {
      const searchPattern = `%${search}%`;
      return await db
        .select()
        .from(products)
        .where(
          and(
            tenantFilter,
            or(
              ilike(products.name, searchPattern),
              ilike(products.description || "", searchPattern),
            ),
          ),
        );
    }
    return tenantFilter
      ? db.select().from(products).where(tenantFilter)
      : db.select().from(products);
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const businessId = currentTenantBusinessId();
    const [product] = await db
      .select()
      .from(products)
      .where(
        businessId
          ? and(eq(products.id, id), eq(products.businessId, businessId))
          : eq(products.id, id),
      );
    return product;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const businessId = currentTenantBusinessId();
    const [product] = await db
      .insert(products)
      .values({
        ...insertProduct,
        ...(businessId ? { businessId } : {}),
      })
      .returning();
    return product;
  }

  async updateProduct(
    id: number,
    updates: UpdateProductRequest,
  ): Promise<Product> {
    const businessId = currentTenantBusinessId();
    // Helper to convert empty/zero strings to null for optional price fields
    const toNullIfEmpty = (val: string | null | undefined): string | null => {
      if (val === "" || val === null || val === undefined) return null;
      return val;
    };
    
    // Only include price fields if they were actually provided in the update
    const cleanedUpdates: Record<string, any> = { ...updates };
    const priceFields = ['price', 'urgentPrice', 'dryCleanPrice', 'ironOnlyPrice', 'smallPrice', 'mediumPrice', 'largePrice', 'smallUrgentPrice', 'mediumUrgentPrice', 'largeUrgentPrice', 'smallDryCleanPrice', 'mediumDryCleanPrice', 'largeDryCleanPrice', 'smallIronOnlyPrice', 'mediumIronOnlyPrice', 'largeIronOnlyPrice', 'sqmPrice'];
    for (const field of priceFields) {
      if ((updates as any)[field] === undefined) {
        delete cleanedUpdates[field];
      } else if ((updates as any)[field] === '') {
        cleanedUpdates[field] = null;
      } else if (['smallPrice', 'mediumPrice', 'largePrice', 'smallUrgentPrice', 'mediumUrgentPrice', 'largeUrgentPrice', 'smallDryCleanPrice', 'mediumDryCleanPrice', 'largeDryCleanPrice', 'smallIronOnlyPrice', 'mediumIronOnlyPrice', 'largeIronOnlyPrice'].includes(field)) {
        cleanedUpdates[field] = toNullIfEmpty((updates as any)[field]);
      }
    }
    const [updated] = await db
      .update(products)
      .set(cleanedUpdates)
      .where(
        businessId
          ? and(eq(products.id, id), eq(products.businessId, businessId))
          : eq(products.id, id),
      )
      .returning();
    return updated;
  }

  async deleteProduct(id: number): Promise<void> {
    const businessId = currentTenantBusinessId();
    await db.delete(products).where(
      businessId
        ? and(eq(products.id, id), eq(products.businessId, businessId))
        : eq(products.id, id),
    );
  }

  async getClients(search?: string): Promise<Client[]> {
    if (search) {
      const searchPattern = `%${search}%`;
      return await db
        .select()
        .from(clients)
        .where(
          or(
            ilike(clients.name, searchPattern),
            ilike(clients.phone || "", searchPattern),
            ilike(clients.address || "", searchPattern),
            ilike(clients.notes || "", searchPattern),
            ilike(clients.billNumber || "", searchPattern),
            ilike(clients.company || "", searchPattern),
          ),
        );
    }
    return await db.select().from(clients);
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async findClientByNameAndPhone(
    name: string,
    phone: string,
    excludeId?: number,
  ): Promise<Client | undefined> {
    const normalizedPhone = normalizePhoneForComparison(phone);
    if (!normalizedPhone) {
      return undefined;
    }

    const results = await db
      .select()
      .from(clients)
      .where(ilike(clients.name, name));

    return results.find(
      (client) =>
        normalizePhoneForComparison(client.phone) === normalizedPhone &&
        (!excludeId || client.id !== excludeId),
    );
  }

  async findClientByNameAndAddress(
    name: string,
    address: string,
    excludeId?: number,
  ): Promise<Client | undefined> {
    const results = await db
      .select()
      .from(clients)
      .where(
        and(ilike(clients.name, name), ilike(clients.address || "", address)),
      );
    if (excludeId) {
      return results.find((c) => c.id !== excludeId);
    }
    return results[0];
  }

  async findClientByPhone(
    phone: string,
    excludeId?: number,
  ): Promise<Client | undefined> {
    const normalizedPhone = normalizePhoneForComparison(phone);
    if (!normalizedPhone) {
      return undefined;
    }

    const results = await db.select().from(clients);
    return results.find(
      (client) =>
        normalizePhoneForComparison(client.phone) === normalizedPhone &&
        (!excludeId || client.id !== excludeId),
    );
  }

  async findClientByName(
    name: string,
    excludeId?: number,
  ): Promise<Client | undefined> {
    if (excludeId) {
      const results = await db
        .select()
        .from(clients)
        .where(ilike(clients.name, name));
      return results.find((c) => c.id !== excludeId);
    }
    const [client] = await db
      .select()
      .from(clients)
      .where(ilike(clients.name, name));
    return client;
  }

  async findClientByAddress(
    address: string,
    excludeId?: number,
  ): Promise<Client | undefined> {
    if (excludeId) {
      const results = await db
        .select()
        .from(clients)
        .where(ilike(clients.address || "", address));
      return results.find((c) => c.id !== excludeId);
    }
    const [client] = await db
      .select()
      .from(clients)
      .where(ilike(clients.address || "", address));
    return client;
  }

  async createClient(insertClient: InsertClient): Promise<Client> {
    const clientData = {
      ...insertClient,
      phone:
        typeof insertClient.phone === "string"
          ? normalizePhoneForStorage(insertClient.phone)
          : insertClient.phone,
      amount: insertClient.amount?.toString(),
      deposit: insertClient.deposit?.toString(),
      balance: insertClient.balance?.toString(),
    };
    const [client] = await db.insert(clients).values(clientData).returning();

    // Auto-generate account number if not provided
    if (!client.billNumber) {
      const accountNumber = `ACC-${client.id.toString().padStart(4, "0")}`;
      const [updated] = await db
        .update(clients)
        .set({ billNumber: accountNumber })
        .where(eq(clients.id, client.id))
        .returning();
      return updated;
    }
    return client;
  }

  async updateClient(
    id: number,
    updates: UpdateClientRequest,
  ): Promise<Client> {
    const updateData: any = { ...updates };
    if (updates.phone !== undefined) {
      updateData.phone =
        typeof updates.phone === "string"
          ? normalizePhoneForStorage(updates.phone)
          : updates.phone;
    }
    if (updates.amount !== undefined)
      updateData.amount = updates.amount.toString();
    if (updates.deposit !== undefined)
      updateData.deposit = updates.deposit.toString();
    if (updates.balance !== undefined)
      updateData.balance = updates.balance.toString();

    const [updated] = await db
      .update(clients)
      .set(updateData)
      .where(eq(clients.id, id))
      .returning();
    return updated;
  }

  async deleteClient(id: number): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  async getBills(): Promise<BillWithPaymentRecorder[]> {
    // Join with clients to get updated customer details
    const result = await db
      .select({
        bill: bills,
        client: clients,
      })
      .from(bills)
      .leftJoin(clients, eq(bills.clientId, clients.id));

    const recorderByBillId = await this.getBillPaymentRecorders(
      result.map(({ bill }) => bill.id),
    );
    
    // Map results to use current client details when available
    return result.map(({ bill, client }) => ({
      ...bill,
      customerName: client?.name || bill.customerName,
      customerPhone: client?.phone || bill.customerPhone,
      paymentProcessedBy: recorderByBillId.get(bill.id)?.processedBy || null,
      paymentProcessedAt: recorderByBillId.get(bill.id)?.date || null,
    }));
  }

  async getBill(id: number): Promise<BillWithPaymentRecorder | undefined> {
    const result = await db
      .select({
        bill: bills,
        client: clients,
      })
      .from(bills)
      .leftJoin(clients, eq(bills.clientId, clients.id))
      .where(eq(bills.id, id));
    
    if (result.length === 0) return undefined;
    
    const { bill, client } = result[0];
    const paymentRecorder = (await this.getBillPaymentRecorders([bill.id])).get(bill.id);
    return {
      ...bill,
      customerName: client?.name || bill.customerName,
      customerPhone: client?.phone || bill.customerPhone,
      paymentProcessedBy: paymentRecorder?.processedBy || null,
      paymentProcessedAt: paymentRecorder?.date || null,
    };
  }

  async getClientBills(clientId: number): Promise<BillWithPaymentRecorder[]> {
    const result = await db
      .select({
        bill: bills,
        client: clients,
      })
      .from(bills)
      .leftJoin(clients, eq(bills.clientId, clients.id))
      .where(eq(bills.clientId, clientId))
      .orderBy(desc(bills.billDate));

    const recorderByBillId = await this.getBillPaymentRecorders(
      result.map(({ bill }) => bill.id),
    );
    
    return result.map(({ bill, client }) => ({
      ...bill,
      customerName: client?.name || bill.customerName,
      customerPhone: client?.phone || bill.customerPhone,
      paymentProcessedBy: recorderByBillId.get(bill.id)?.processedBy || null,
      paymentProcessedAt: recorderByBillId.get(bill.id)?.date || null,
    }));
  }

  async getUnpaidBills(clientId: number): Promise<BillWithPaymentRecorder[]> {
    const result = await db
      .select({
        bill: bills,
        client: clients,
      })
      .from(bills)
      .leftJoin(clients, eq(bills.clientId, clients.id))
      .where(and(eq(bills.clientId, clientId), eq(bills.isPaid, false)))
      .orderBy(desc(bills.billDate));

    const recorderByBillId = await this.getBillPaymentRecorders(
      result.map(({ bill }) => bill.id),
    );
    
    return result.map(({ bill, client }) => ({
      ...bill,
      customerName: client?.name || bill.customerName,
      customerPhone: client?.phone || bill.customerPhone,
      paymentProcessedBy: recorderByBillId.get(bill.id)?.processedBy || null,
      paymentProcessedAt: recorderByBillId.get(bill.id)?.date || null,
    }));
  }

  async createBill(insertBill: InsertBill): Promise<Bill> {
    const billData = {
      ...insertBill,
      amount: insertBill.amount.toString(),
      paidAmount: insertBill.paidAmount?.toString() || "0",
      deliveryCharge: insertBill.deliveryCharge?.toString() || "0",
      billDate: new Date(insertBill.billDate),
      isPaid: false,
    };
    const [bill] = await db.insert(bills).values(billData).returning();
    this.notifyLiveResourceUpdated("bills");
    return bill;
  }

  async updateBill(
    id: number,
    updates: Partial<InsertBill> & { isPaid?: boolean },
  ): Promise<Bill> {
    const updateData: any = { ...updates };
    if (updates.amount !== undefined)
      updateData.amount = updates.amount.toString();
    if (updates.paidAmount !== undefined)
      updateData.paidAmount = updates.paidAmount.toString();
    if (updates.deliveryCharge !== undefined)
      updateData.deliveryCharge = updates.deliveryCharge.toString();
    if (updates.billDate) updateData.billDate = new Date(updates.billDate);

    const [updated] = await db
      .update(bills)
      .set(updateData)
      .where(eq(bills.id, id))
      .returning();
    if (updated) {
      this.notifyLiveResourceUpdated("bills");
    }
    return updated;
  }

  async deleteBill(id: number): Promise<void> {
    await db.delete(billPayments).where(eq(billPayments.billId, id));
    await db.delete(bills).where(eq(bills.id, id));
    this.notifyLiveResourceUpdated("bills");
  }

  async getBillPayments(billId: number): Promise<BillPayment[]> {
    return await db
      .select()
      .from(billPayments)
      .where(eq(billPayments.billId, billId))
      .orderBy(desc(billPayments.paymentDate));
  }

  async getAllBillPayments(): Promise<BillPayment[]> {
    return await db
      .select()
      .from(billPayments)
      .orderBy(desc(billPayments.paymentDate));
  }

  async getClientBillPayments(clientId: number): Promise<BillPayment[]> {
    return await db
      .select()
      .from(billPayments)
      .where(eq(billPayments.clientId, clientId))
      .orderBy(desc(billPayments.paymentDate));
  }

  async getSalesReportPeriodData({
    period,
    from,
    to,
  }: SalesReportPeriodInput): Promise<SalesReportPeriodData> {
    const businessId = currentTenantBusinessId();
    if (!businessId) {
      throw new Error("Tenant scope is required to generate a sales report");
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new Error("Invalid sales report period range");
    }

    if (fromDate.getTime() > toDate.getTime()) {
      throw new Error("Sales report period start must be before the end");
    }

    const currentPeriodOrders = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.businessId, businessId),
        gte(orders.entryDate, fromDate),
        lte(orders.entryDate, toDate),
      ))
      .orderBy(desc(orders.entryDate), desc(orders.id));

    const currentPeriodPayments = await db
      .select()
      .from(billPayments)
      .where(and(
        eq(billPayments.businessId, businessId),
        gte(billPayments.paymentDate, fromDate),
        lte(billPayments.paymentDate, toDate),
      ))
      .orderBy(desc(billPayments.paymentDate), desc(billPayments.id));

    const relatedBillIds = Array.from(
      new Set(
        [
          ...currentPeriodOrders.map((order) => Number(order.billId)),
          ...currentPeriodPayments.map((payment) => Number(payment.billId)),
        ].filter((billId) => Number.isFinite(billId) && billId > 0),
      ),
    );

    const relatedOrders =
      relatedBillIds.length > 0
        ? await db
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.businessId, businessId),
                or(
                  and(gte(orders.entryDate, fromDate), lte(orders.entryDate, toDate)),
                  inArray(orders.billId, relatedBillIds),
                ),
              ),
            )
            .orderBy(desc(orders.entryDate), desc(orders.id))
        : currentPeriodOrders;

    const dedupedOrderMap = new Map<number, Order>();
    for (const order of relatedOrders) {
      dedupedOrderMap.set(order.id, order);
    }
    const dedupedOrders = Array.from(dedupedOrderMap.values());

    const relatedBills =
      relatedBillIds.length > 0
        ? await db
            .select({
              bill: bills,
              client: clients,
            })
            .from(bills)
            .leftJoin(clients, eq(bills.clientId, clients.id))
            .where(and(
              eq(bills.businessId, businessId),
              inArray(bills.id, relatedBillIds),
            ))
            .orderBy(desc(bills.billDate), desc(bills.id))
        : [];

    const recorderByBillId = await this.getBillPaymentRecorders(relatedBillIds);
    const dedupedBills = relatedBills.map(({ bill, client }) => ({
      ...bill,
      customerName: client?.name || bill.customerName,
      customerPhone: client?.phone || bill.customerPhone,
      paymentProcessedBy: recorderByBillId.get(bill.id)?.processedBy || null,
      paymentProcessedAt: recorderByBillId.get(bill.id)?.date || null,
    }));

    const relatedBillPayments =
      relatedBillIds.length > 0
        ? await db
            .select()
            .from(billPayments)
            .where(and(
              eq(billPayments.businessId, businessId),
              inArray(billPayments.billId, relatedBillIds),
              lte(billPayments.paymentDate, toDate),
            ))
            .orderBy(desc(billPayments.paymentDate), desc(billPayments.id))
        : [];

    const relatedClientIds = Array.from(
      new Set(
        [
          ...dedupedOrders.map((order) => Number(order.clientId)),
          ...dedupedBills.map((bill) => Number(bill.clientId)),
          ...relatedBillPayments.map((payment) => Number(payment.clientId)),
        ].filter((clientId) => Number.isFinite(clientId) && clientId > 0),
      ),
    );

    const relatedClients =
      relatedClientIds.length > 0
        ? await db
            .select()
            .from(clients)
            .where(inArray(clients.id, relatedClientIds))
        : [];

    return {
      period: {
        period,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      clients: relatedClients,
      orders: dedupedOrders,
      bills: dedupedBills,
      billPayments: relatedBillPayments,
    };
  }

  async createBillPayment(payment: InsertBillPayment): Promise<BillPayment> {
    const paymentData = {
      billId: payment.billId,
      clientId: payment.clientId,
      amount: payment.amount.toString(),
      paymentDate: new Date(payment.paymentDate),
      paymentMethod: payment.paymentMethod || "cash",
      notes: payment.notes,
    };
    const [created] = await db
      .insert(billPayments)
      .values(paymentData)
      .returning();
    return created;
  }

  async updateBillPaymentDate(paymentId: number, newDate: Date): Promise<BillPayment> {
    const [updated] = await db
      .update(billPayments)
      .set({ paymentDate: newDate })
      .where(eq(billPayments.id, paymentId))
      .returning();
    if (!updated) throw new Error("Bill payment not found");
    this.notifyLiveResourceUpdated("bills");
    return updated;
  }

  async payBill(
    billId: number,
    amount: string,
    paymentMethod?: string,
    notes?: string,
    processedBy?: string,
    skipTransaction?: boolean,
  ): Promise<{ bill: Bill; payment: BillPayment }> {
    const bill = await this.getBill(billId);
    if (!bill) throw new Error("Bill not found");

    if (bill.isPaid) {
      throw new Error("Bill is already fully paid");
    }

    const paymentAmount = parseFloat(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new Error("Valid payment amount is required");
    }

    const normalizedPaymentMethod = normalizeStoredPaymentMethod(paymentMethod);
    const currentPaid = parseFloat(bill.paidAmount || "0");
    const billAmount = parseFloat(bill.amount);
    const billRemaining = Math.max(0, billAmount - currentPaid);

    if (bill.clientId && normalizedPaymentMethod === "deposit") {
      const client = await this.getClient(bill.clientId);
      if (!client) {
        throw new Error("Client not found");
      }

      const currentDeposit = parseFloat(client.deposit || "0");
      if (paymentAmount > currentDeposit + MONEY_EPSILON) {
        throw new Error(
          `Insufficient credit balance. Available: ${currentDeposit.toFixed(2)} AED, Required: ${paymentAmount.toFixed(2)} AED`,
        );
      }

      if (paymentAmount > billRemaining + MONEY_EPSILON) {
        throw new Error(
          `Credit payment cannot exceed the remaining balance of ${billRemaining.toFixed(2)} AED`,
        );
      }
    }

    const newPaidAmount = currentPaid + paymentAmount;
    const isPaid = newPaidAmount >= billAmount;

    // Only create payment record if there's a clientId
    let payment: BillPayment | null = null;
    if (bill.clientId) {
      payment = await this.createBillPayment({
        billId,
        clientId: bill.clientId,
        amount,
        paymentDate: new Date(),
        paymentMethod: normalizedPaymentMethod,
        notes,
      });
    }

    const paymentRowsForBill = bill.clientId
      ? (await this.getBillPayments(billId))
          .slice()
          .sort((left, right) => {
            const dateDelta =
              new Date(left.paymentDate).getTime() - new Date(right.paymentDate).getTime();
            if (dateDelta !== 0) return dateDelta;
            return left.id - right.id;
          })
      : [];
    const settledPaymentMethod = buildCombinedPaymentMethod(
      paymentRowsForBill.length > 0
        ? paymentRowsForBill.map((row) => row.paymentMethod)
        : [normalizedPaymentMethod],
    );

    const updatedBill = await this.updateBill(billId, {
      paidAmount: newPaidAmount.toFixed(2),
      isPaid,
      ...(isPaid && { paymentMethod: settledPaymentMethod }),
    });

    // Update order paidAmounts for this bill's orders
    if (bill.clientId) {
      const clientOrders = await db
        .select()
        .from(orders)
        .where(eq(orders.clientId, bill.clientId));
      const billOrders = clientOrders.filter((order) => order.billId === billId);

      if (billOrders.length > 0) {
        const orderPaymentMethod = isPaid ? settledPaymentMethod : normalizedPaymentMethod;
        const getOrderTargetAmount = (order: typeof billOrders[number]) => {
          const parseSafe = (value: unknown): number => {
            const parsed = parseFloat(String(value ?? ""));
            return Number.isFinite(parsed) ? parsed : NaN;
          };
          const getExtraCharges = () => {
            const deliveryCharge = parseSafe((order as any).deliveryCharge);
            const tips = parseSafe(order.tips);
            return (
              (Number.isFinite(deliveryCharge) ? Math.max(0, deliveryCharge) : 0) +
              (Number.isFinite(tips) ? Math.max(0, tips) : 0)
            );
          };

          const finalAmount = parseSafe(order.finalAmount);
          if (Number.isFinite(finalAmount)) {
            return Math.max(0, finalAmount);
          }

          const hasAdjustedValue =
            order.adjustedTotal !== null &&
            order.adjustedTotal !== undefined &&
            String(order.adjustedTotal).trim() !== "";
          const hasAdjustReason = String(order.priceAdjustReason || "").trim().length > 0;
          const workReceived = hasAdjustedValue && hasAdjustReason
            ? parseSafe(order.adjustedTotal)
            : parseSafe(order.totalAmount);
          const discountAmount = parseSafe(order.discountAmount);
          if (Number.isFinite(workReceived)) {
            const safeDiscount = Number.isFinite(discountAmount) ? Math.max(0, discountAmount) : 0;
            return Math.max(0, workReceived - safeDiscount) + getExtraCharges();
          }

          const totalAmount = parseSafe(order.totalAmount);
          if (Number.isFinite(totalAmount)) return Math.max(0, totalAmount);
          return 0;
        };
        
        if (isPaid) {
          // Bill fully paid - mark each linked order as fully paid against its effective amount.
          for (const order of billOrders) {
            const orderTarget = getOrderTargetAmount(order);
            await db
              .update(orders)
              .set({
                paidAmount: orderTarget.toFixed(2),
                paymentMethod: orderPaymentMethod,
              })
              .where(eq(orders.id, order.id));
          }

          console.log(
            `[PAYMENT] Marked ${billOrders.length} order(s) as fully paid (${orderPaymentMethod}) for bill ${billId}`,
          );
        } else {
          // Partial payment - distribute payment across unpaid orders proportionally
          let remainingPayment = paymentAmount;
          
          for (const order of billOrders) {
            if (remainingPayment <= 0) break;
            
            const orderTotal = getOrderTargetAmount(order);
            const orderPaid = parseFloat(order.paidAmount || "0");
            const orderRemaining = orderTotal - orderPaid;
            
            if (orderRemaining > 0) {
              const paymentForThisOrder = Math.min(remainingPayment, orderRemaining);
              const newOrderPaid = orderPaid + paymentForThisOrder;
              const isOrderFullyPaid = Math.abs(newOrderPaid - orderTotal) < 0.01;
              
              await db
                .update(orders)
                .set({ 
                  paidAmount: newOrderPaid.toFixed(2),
                  // Only set payment method when order is fully paid
                  ...(isOrderFullyPaid && { paymentMethod: orderPaymentMethod })
                })
                .where(eq(orders.id, order.id));
              
              remainingPayment -= paymentForThisOrder;
              console.log(
                `[PAYMENT] Applied ${paymentForThisOrder.toFixed(2)} to order #${order.orderNumber}, new paidAmount: ${newOrderPaid.toFixed(2)}`,
              );
            }
          }
        }
      }
    }

    // Only update deposit when payment method is "deposit" (using existing credit balance)
    // Cash/Card/Bank payments do NOT affect the deposit/credit balance at all
    if (bill.clientId && normalizedPaymentMethod === "deposit") {
      const client = await this.getClient(bill.clientId);
      if (client && paymentAmount > 0) {
        const currentDeposit = parseFloat(client.deposit || "0");
        const currentAmount = parseFloat(client.amount || "0");
        
        // Deduct from existing deposit - customer is using their pre-paid balance
        const newDeposit = Math.max(0, currentDeposit - paymentAmount);
        const newBalance = currentAmount - newDeposit;
        
        await this.updateClient(bill.clientId, {
          deposit: newDeposit.toFixed(2),
          balance: newBalance.toFixed(2),
        });

        // Record the deposit usage transaction for history
        await this.createTransaction({
          clientId: bill.clientId,
          billId: billId,
          type: "deposit_used",
          amount: paymentAmount.toFixed(2),
          description: buildBillClientTransactionDescription(
            "Deposit used for Bill",
            bill,
            notes,
          ),
          date: new Date(),
          runningBalance: newBalance.toFixed(2),
          paymentMethod: "deposit",
          processedBy: processedBy,
        });
      }
    }
    // For cash/card/bank payments - record transaction for history but don't affect deposit
    // Skip if skipTransaction is true (used for bulk payments that record a single transaction)
    if (bill.clientId && normalizedPaymentMethod !== "deposit" && !skipTransaction) {
      await this.createTransaction({
        clientId: bill.clientId,
        billId: billId,
        type: "payment",
        amount: paymentAmount.toFixed(2),
        description: buildBillClientTransactionDescription("Payment for Bill", bill, notes),
        date: new Date(),
        runningBalance: "0",
        paymentMethod: normalizedPaymentMethod,
        processedBy: processedBy,
      });
    }

    // If client overpaid (paid more than bill total), add the excess as credit/deposit
    if (bill.clientId && newPaidAmount > billAmount && normalizedPaymentMethod !== "deposit") {
      const overpayment = newPaidAmount - billAmount;
      if (overpayment > 0.005) {
        const client = await this.getClient(bill.clientId);
        if (client) {
          const currentDeposit = parseFloat(client.deposit || "0");
          const newDeposit = currentDeposit + overpayment;
          const currentAmount = parseFloat(client.amount || "0");
          const newBalance = currentAmount - newDeposit;

          await this.updateClient(bill.clientId, {
            deposit: newDeposit.toFixed(2),
            balance: newBalance.toFixed(2),
          });

          const billOrders = await db.select().from(orders).where(eq(orders.billId, billId));
          const orderNum = billOrders.length > 0 ? billOrders[0].orderNumber : null;
          const orderRef = orderNum ? `Order #${orderNum}` : `Bill #${bill.id}`;

          await this.createTransaction({
            clientId: bill.clientId,
            billId: billId,
            type: "deposit",
            amount: overpayment.toFixed(2),
            description: `Credit added from overpayment on ${orderRef} (paid ${newPaidAmount.toFixed(2)} on ${billAmount.toFixed(2)} AED bill)`,
            date: new Date(),
            runningBalance: newBalance.toFixed(2),
            paymentMethod: normalizedPaymentMethod,
            processedBy: processedBy,
          });

          // Cap the bill's paidAmount to the bill total
          await this.updateBill(billId, {
            paidAmount: billAmount.toFixed(2),
          });

          console.log(
            `[PAYMENT] Overpayment of ${overpayment.toFixed(2)} AED on bill ${billId} added as credit for client ${bill.clientId}`,
          );
        }
      }
    }

    return { bill: updatedBill, payment: payment! };
  }

  async revertBillPayment(billId: number, revertedBy?: string): Promise<Bill> {
    const bill = await this.getBill(billId);
    if (!bill) throw new Error("Bill not found");

    const paidAmount = parseFloat(bill.paidAmount || "0");
    if (paidAmount <= 0) throw new Error("Bill has no payment to revert");

    const billAmount = parseFloat(bill.amount);
    const paymentsForBill = await this.getBillPayments(billId);
    const depositUsedAmount = paymentsForBill.reduce((sum, payment) => {
      if (getPaymentMethodComparisonKey(payment.paymentMethod) !== "deposit") {
        return sum;
      }

      const paymentAmount = parseFloat(String(payment.amount || "0"));
      return Number.isFinite(paymentAmount) ? sum + paymentAmount : sum;
    }, 0);
    let restoredCreditBalance: number | null = null;

    // Restore the credit portion used for this bill, including mixed credit + card payments.
    if (bill.clientId && depositUsedAmount > MONEY_EPSILON) {
      const client = await this.getClient(bill.clientId);
      if (client) {
        const currentDeposit = parseFloat(client.deposit || "0");
        const newDeposit = currentDeposit + depositUsedAmount;
        const currentAmount = parseFloat(client.amount || "0");
        const newBalance = currentAmount - newDeposit;
        await this.updateClient(bill.clientId, {
          deposit: newDeposit.toFixed(2),
          balance: newBalance.toFixed(2),
        });
        restoredCreditBalance = newBalance;
      }
    }

    // If there was an overpayment that created deposit credit, remove it
    if (bill.clientId && paidAmount > billAmount && bill.paymentMethod !== "deposit") {
      const overpayment = paidAmount - billAmount;
      if (overpayment > 0.005) {
        const client = await this.getClient(bill.clientId);
        if (client) {
          const currentDeposit = parseFloat(client.deposit || "0");
          const newDeposit = Math.max(0, currentDeposit - overpayment);
          const currentAmount = parseFloat(client.amount || "0");
          const newBalance = currentAmount - newDeposit;
          await this.updateClient(bill.clientId, {
            deposit: newDeposit.toFixed(2),
            balance: newBalance.toFixed(2),
          });
        }
      }
    }

    // Delete all bill_payments for this bill
    await db.delete(billPayments).where(eq(billPayments.billId, billId));

    // Delete related client_transactions (payment, deposit_used, deposit types for this bill)
    if (bill.clientId) {
      const relatedTransactions = await db
        .select()
        .from(clientTransactions)
        .where(eq(clientTransactions.clientId, bill.clientId));

      const targetTransactionIds = relatedTransactions
        .filter((transaction) => {
          if (transaction.type === "payment_reverted") {
            return false;
          }

          const isCreditUsageTransaction =
            transaction.type === "deposit_used" || transaction.type === "bulk_deposit_used";

          if (isCreditUsageTransaction) {
            return false;
          }

          if (transaction.billId === billId) return true;

          const description = String(transaction.description || "");
          const referencesBillInDescription =
            description.includes(`Bill #${billId}`) || description.includes(`#${billId}`);

          return referencesBillInDescription;
        })
        .map((transaction) => transaction.id);

      for (const transactionId of targetTransactionIds) {
        await db.delete(clientTransactions).where(eq(clientTransactions.id, transactionId));
      }
    }

    let revertedCreditAccountLabel = "this account";

    if (bill.clientId) {
      const refreshedClient = await this.getClient(bill.clientId);
      revertedCreditAccountLabel = String(refreshedClient?.billNumber || "").trim() || "this account";

      await this.createTransaction({
        clientId: bill.clientId,
        billId,
        type: "payment_reverted",
        amount: paidAmount.toFixed(2),
        description:
          depositUsedAmount > MONEY_EPSILON
            ? `Bill payment reverted for bill #${billId}. Returned ${depositUsedAmount.toFixed(2)} AED credit to account ${revertedCreditAccountLabel}`
            : `Bill payment reverted for bill #${billId}`,
        date: new Date(),
        runningBalance: String(
          refreshedClient?.balance ??
            (restoredCreditBalance !== null ? restoredCreditBalance.toFixed(2) : "0.00"),
        ),
        paymentMethod: bill.paymentMethod || null,
        processedBy: revertedBy || "admin",
      });
    }

    if (bill.clientId && depositUsedAmount > MONEY_EPSILON) {
      const refreshedClient = await this.getClient(bill.clientId);
      await this.createTransaction({
        clientId: bill.clientId,
        billId,
        type: "deposit",
        amount: depositUsedAmount.toFixed(2),
        description: `Reverted account credit from payment revertion of bill #${billId} to account ${revertedCreditAccountLabel}`,
        date: new Date(),
        runningBalance: String(
          refreshedClient?.balance ??
            (restoredCreditBalance !== null ? restoredCreditBalance.toFixed(2) : "0.00"),
        ),
        paymentMethod: "deposit",
        processedBy: revertedBy || "admin",
      });
    }

    const parseMoney = (value: unknown): number => {
      const parsed = parseFloat(String(value ?? ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const getOrderWorkReceivedBase = (order: any): number => {
      const hasAdjustedValue =
        order.adjustedTotal !== null &&
        order.adjustedTotal !== undefined &&
        String(order.adjustedTotal).trim() !== "";
      const hasAdjustReason = String(order.priceAdjustReason || "").trim().length > 0;

      if (hasAdjustedValue && hasAdjustReason) {
        return Math.max(0, parseMoney(order.adjustedTotal));
      }

      const originalTotal = parseMoney(order.totalAmount);
      if (originalTotal > 0 || String(order.totalAmount ?? "").trim() !== "") {
        return Math.max(0, originalTotal);
      }

      const finalAmount = parseMoney(order.finalAmount);
      const discountAmount = Math.max(0, parseMoney(order.discountAmount));
      const extraCharges =
        Math.max(0, parseMoney(order.deliveryCharge)) +
        Math.max(0, parseMoney(order.tips));
      return Math.max(0, finalAmount + discountAmount - extraCharges);
    };

    const billOrders = await db.select().from(orders).where(eq(orders.billId, billId));
    const currentDiscount = parseMoney(bill.discountAmount);
    const hasDiscount = currentDiscount > 0.009;
    const billExtraCharges =
      Math.max(0, parseMoney(bill.deliveryCharge)) +
      billOrders.reduce((sum, order) => sum + Math.max(0, parseMoney(order.tips)), 0);

    let restoredBaseAmount = parseMoney(bill.originalAmount);
    if (!(restoredBaseAmount > 0) && billOrders.length > 0) {
      const ordersBaseTotal = billOrders.reduce((sum, order) => sum + getOrderWorkReceivedBase(order), 0);
      if (ordersBaseTotal > 0) {
        restoredBaseAmount = ordersBaseTotal;
      }
    }
    if (!(restoredBaseAmount > 0) && hasDiscount) {
      restoredBaseAmount = Math.max(0, parseMoney(bill.amount) + currentDiscount - billExtraCharges);
    }
    if (!(restoredBaseAmount > 0)) {
      restoredBaseAmount = Math.max(0, parseMoney(bill.amount) - billExtraCharges);
    }
    const restoredAmount = restoredBaseAmount + billExtraCharges;

    const revertTimestamp = new Date().toLocaleString();
    const revertActor = revertedBy || "admin";
    const historyParts: string[] = [
      `PAYMENT REVERTED by ${revertActor}`,
      `Paid amount ${paidAmount.toFixed(2)} AED removed`,
    ];
    if (bill.paymentMethod) {
      historyParts.push(`Method ${formatStoredPaymentMethodForHistory(bill.paymentMethod)}`);
    }
    if (hasDiscount) {
      historyParts.push(`Discount ${currentDiscount.toFixed(2)} AED removed`);
      historyParts.push(`Amount restored to ${restoredAmount.toFixed(2)} AED`);
    }
    const historyEntry = `\n[${revertTimestamp}] ${historyParts.join(". ")}.`;
    const updatedNotes = `${bill.notes || ""}${historyEntry}`.trim();

    // Reset bill payment status
    let updatedBill = await this.updateBill(billId, {
      paidAmount: "0.00",
      isPaid: false,
      paymentMethod: null,
      notes: updatedNotes,
    });

    // Always clear existing discount and restore bill amount on revert.
    if (hasDiscount) {
      updatedBill = await this.updateBill(billId, {
        amount: restoredAmount.toFixed(2),
        originalAmount: null,
        discountAmount: "0.00",
        discountAppliedBy: null,
        isPaid: false,
        paidAmount: "0.00",
        paymentMethod: null,
        notes: updatedNotes,
      });
    }

    // Reset all linked orders' payment info
    for (const order of billOrders) {
      const orderUpdates: any = {
        paidAmount: "0.00",
        paymentMethod: null,
      };
      if (hasDiscount) {
        orderUpdates.discountAmount = "0.00";
        const orderRestoredAmount =
          getOrderWorkReceivedBase(order) +
          Math.max(0, parseMoney(order.deliveryCharge)) +
          Math.max(0, parseMoney(order.tips));
        orderUpdates.finalAmount = orderRestoredAmount.toFixed(2);
      }
      await db.update(orders).set(orderUpdates).where(eq(orders.id, order.id));
    }

    console.log(`[PAYMENT REVERT] Bill #${billId} payment of ${paidAmount.toFixed(2)} AED reverted${revertedBy ? ` by ${revertedBy}` : ""}`);

    return updatedBill;
  }

  async getClientTransactions(clientId: number): Promise<ClientTransaction[]> {
    return await db
      .select()
      .from(clientTransactions)
      .where(eq(clientTransactions.clientId, clientId))
      .orderBy(desc(clientTransactions.date));
  }

  async clearClientTransactions(clientId: number): Promise<void> {
    await db
      .delete(clientTransactions)
      .where(eq(clientTransactions.clientId, clientId));
    this.notifyLiveResourceUpdated("clientTransactions");
  }

  async createTransaction(
    transaction: InsertTransaction & { billId?: number; processedBy?: string },
  ): Promise<ClientTransaction> {
    const txData = {
      clientId: transaction.clientId,
      billId: transaction.billId || null,
      type: transaction.type,
      amount: transaction.amount.toString(),
      description: transaction.description,
      date: new Date(transaction.date),
      runningBalance: transaction.runningBalance.toString(),
      paymentMethod: transaction.paymentMethod || "cash",
      discount: transaction.discount?.toString() || "0",
      processedBy: transaction.processedBy || null,
    };
    const [created] = await db
      .insert(clientTransactions)
      .values(txData)
      .returning();
    this.notifyLiveResourceUpdated("clientTransactions");
    return created;
  }

  async addClientBill(
    clientId: number,
    amount: string,
    description?: string,
  ): Promise<ClientTransaction> {
    const client = await this.getClient(clientId);
    if (!client) throw new Error("Client not found");

    const billAmount = parseFloat(amount);
    const currentAmount = parseFloat(client.amount || "0");
    const currentDeposit = parseFloat(client.deposit || "0");
    const newAmount = currentAmount + billAmount;
    const newBalance = newAmount - currentDeposit;

    await this.updateClient(clientId, {
      amount: newAmount.toFixed(2),
      balance: newBalance.toFixed(2),
    });

    // Also create a bill record so it shows in the Bills tab
    const referenceNumber = `BL-${Date.now().toString(36).toUpperCase()}`;
    const createdBill = await this.createBill({
      clientId,
      amount: billAmount.toFixed(2),
      referenceNumber,
      customerName: client.name,
      customerPhone: client.phone || "",
      isPaid: false,
      billDate: new Date(),
      description: description || "Bill from client account",
    });

    return await this.createTransaction({
      clientId,
      billId: createdBill.id,
      type: "bill",
      amount: billAmount.toFixed(2),
      description: description || `Bill #${createdBill.id}`,
      date: new Date(),
      runningBalance: newBalance.toFixed(2),
    });
  }

  async addClientDeposit(
    clientId: number,
    amount: string,
    description?: string,
    paymentMethod?: string,
    processedBy?: string,
  ): Promise<ClientTransaction> {
    const client = await this.getClient(clientId);
    if (!client) throw new Error("Client not found");

    const depositAmount = parseFloat(amount);
    const currentAmount = parseFloat(client.amount || "0");
    const currentDeposit = parseFloat(client.deposit || "0");
    const newDeposit = currentDeposit + depositAmount;
    const newBalance = currentAmount - newDeposit;

    await this.updateClient(clientId, {
      deposit: newDeposit.toFixed(2),
      balance: newBalance.toFixed(2),
    });

    return await this.createTransaction({
      clientId,
      type: "deposit",
      amount: depositAmount.toFixed(2),
      description: description || "Deposit received",
      date: new Date(),
      runningBalance: newBalance.toFixed(2),
      paymentMethod: paymentMethod || "cash",
      processedBy,
    });
  }

  async deductClientDeposit(
    clientId: number,
    amount: string,
    description?: string,
    processedBy?: string,
  ): Promise<ClientTransaction> {
    const client = await this.getClient(clientId);
    if (!client) throw new Error("Client not found");

    const deductionAmount = parseFloat(amount);
    if (!Number.isFinite(deductionAmount) || deductionAmount <= 0) {
      throw new Error("Valid deduction amount is required");
    }

    const currentAmount = parseFloat(client.amount || "0");
    const currentDeposit = parseFloat(client.deposit || "0");
    if (deductionAmount > currentDeposit + MONEY_EPSILON) {
      throw new Error(
        `Insufficient account credit. Available: ${currentDeposit.toFixed(2)} AED, Requested: ${deductionAmount.toFixed(2)} AED`,
      );
    }

    const newDeposit = Math.max(0, currentDeposit - deductionAmount);
    const newBalance = currentAmount - newDeposit;

    await this.updateClient(clientId, {
      deposit: newDeposit.toFixed(2),
      balance: newBalance.toFixed(2),
    });

    return await this.createTransaction({
      clientId,
      type: "deposit_deduction" as any,
      amount: deductionAmount.toFixed(2),
      description: description || "Credit deducted from account",
      date: new Date(),
      runningBalance: newBalance.toFixed(2),
      paymentMethod: "adjustment",
      processedBy,
    });
  }

  async deleteClientTransaction(transactionId: number): Promise<void> {
    const transaction = await db
      .select()
      .from(clientTransactions)
      .where(eq(clientTransactions.id, transactionId))
      .then((rows) => rows[0]);

    if (!transaction) throw new Error("Transaction not found");

    const client = await this.getClient(transaction.clientId);
    if (!client) throw new Error("Client not found");

    const transactionAmount = parseFloat(transaction.amount || "0");
    const currentAmount = parseFloat(client.amount || "0");
    const currentDeposit = parseFloat(client.deposit || "0");

    if (transaction.type === "bill") {
      const newAmount = currentAmount - transactionAmount;
      const newBalance = newAmount - currentDeposit;
      await this.updateClient(transaction.clientId, {
        amount: newAmount.toFixed(2),
        balance: newBalance.toFixed(2),
      });
    } else if (transaction.type === "deposit") {
      const newDeposit = currentDeposit - transactionAmount;
      const newBalance = currentAmount - newDeposit;
      await this.updateClient(transaction.clientId, {
        deposit: newDeposit.toFixed(2),
        balance: newBalance.toFixed(2),
      });
    } else if (transaction.type === "deposit_deduction") {
      const newDeposit = currentDeposit + transactionAmount;
      const newBalance = currentAmount - newDeposit;
      await this.updateClient(transaction.clientId, {
        deposit: newDeposit.toFixed(2),
        balance: newBalance.toFixed(2),
      });
    }

    await db
      .delete(clientTransactions)
      .where(eq(clientTransactions.id, transactionId));
    this.notifyLiveResourceUpdated("clientTransactions");
  }

  async updateClientTransaction(
    transactionId: number,
    data: { amount: string; description: string },
  ): Promise<ClientTransaction> {
    const transaction = await db
      .select()
      .from(clientTransactions)
      .where(eq(clientTransactions.id, transactionId))
      .then((rows) => rows[0]);

    if (!transaction) throw new Error("Transaction not found");

    const client = await this.getClient(transaction.clientId);
    if (!client) throw new Error("Client not found");

    const oldAmount = parseFloat(transaction.amount || "0");
    const newAmount = parseFloat(data.amount);
    const amountDiff = newAmount - oldAmount;
    const currentAmount = parseFloat(client.amount || "0");
    const currentDeposit = parseFloat(client.deposit || "0");

    // Update client balance based on transaction type
    if (transaction.type === "bill") {
      const updatedAmount = currentAmount + amountDiff;
      const newBalance = updatedAmount - currentDeposit;
      await this.updateClient(transaction.clientId, {
        amount: updatedAmount.toFixed(2),
        balance: newBalance.toFixed(2),
      });
    } else if (transaction.type === "deposit") {
      const updatedDeposit = currentDeposit + amountDiff;
      const newBalance = currentAmount - updatedDeposit;
      await this.updateClient(transaction.clientId, {
        deposit: updatedDeposit.toFixed(2),
        balance: newBalance.toFixed(2),
      });
    } else if (transaction.type === "deposit_deduction") {
      const updatedDeposit = currentDeposit - amountDiff;
      if (updatedDeposit < -MONEY_EPSILON) {
        throw new Error("Credit deduction cannot exceed available account credit");
      }
      const newBalance = currentAmount - updatedDeposit;
      await this.updateClient(transaction.clientId, {
        deposit: Math.max(0, updatedDeposit).toFixed(2),
        balance: newBalance.toFixed(2),
      });
    }

    // Update the transaction
    const [updated] = await db
      .update(clientTransactions)
      .set({
        amount: newAmount.toFixed(2),
        description: data.description,
      })
      .where(eq(clientTransactions.id, transactionId))
      .returning();

    this.notifyLiveResourceUpdated("clientTransactions");
    return updated;
  }

  async getOrders(search?: string): Promise<Order[]> {
    if (search) {
      const searchPattern = `%${search}%`;
      return await db
        .select()
        .from(orders)
        .where(
          or(
            ilike(orders.orderNumber, searchPattern),
            ilike(orders.items || "", searchPattern),
            ilike(orders.notes || "", searchPattern),
          ),
        )
        .orderBy(desc(orders.entryDate));
    }
    return await db.select().from(orders).orderBy(desc(orders.entryDate));
  }

  private buildOrderTrackingConditions(options: OrderTrackingQueryOptions = {}) {
    const conditions: any[] = [];
    const trimmedSearch = options.search?.trim();
    const trimmedAccountNumber = options.accountNumber?.trim().replace(/^#/, "");
    const trimmedOrderNumber = normalizeTrackingExactOrderNumber(options.orderNumber);
    const trimmedBillAmount = options.billAmount
      ?.trim()
      .replace(/\baed\b/gi, "")
      .replace(/,/g, "")
      .trim();
    const trimmedBillNumber = normalizeTrackingExactBillNumber(options.billNumber);
    const trimmedNameAddress = options.nameAddress?.trim();
    const trimmedMobileNumber = options.mobileNumber?.trim();
    const trimmedCompanyName = options.companyName?.trim();
    const dateColumn = options.dateField === "delivery" ? orders.deliveryDate : orders.entryDate;
    const billPaidCondition = sql<boolean>`exists (
      select 1
      from ${bills}
      where ${bills.id} = ${orders.billId}
        and (
          ${bills.isPaid} = true
          or coalesce(${bills.paidAmount}, 0::numeric) >= greatest(coalesce(${bills.amount}, 0::numeric) - ${MONEY_EPSILON}, 0::numeric)
        )
    )`;

    if (trimmedSearch) {
      const searchPattern = `%${trimmedSearch}%`;
      const searchClauses = [
        ilike(orders.orderNumber, searchPattern),
        ilike(orders.items, searchPattern),
        ilike(orders.notes, searchPattern),
        ilike(orders.customerName, searchPattern),
        ilike(orders.deliveryAddress, searchPattern),
        sql<boolean>`cast(${orders.billId} as text) ilike ${searchPattern}`,
        sql<boolean>`exists (
          select 1
          from ${clients}
          where ${clients.id} = ${orders.clientId}
            and (
              ${clients.name} ilike ${searchPattern}
              or ${clients.phone} ilike ${searchPattern}
              or ${clients.address} ilike ${searchPattern}
              or ${clients.company} ilike ${searchPattern}
              or ${clients.billNumber} ilike ${searchPattern}
            )
        )`,
        sql<boolean>`exists (
          select 1
          from ${bills}
          where ${bills.id} = ${orders.billId}
            and (
              ${bills.customerName} ilike ${searchPattern}
              or ${bills.customerPhone} ilike ${searchPattern}
            )
        )`,
      ];

      const normalizedPhoneSearch = normalizePhoneForComparison(trimmedSearch);
      if (normalizedPhoneSearch) {
        const normalizedPhonePattern = `%${normalizedPhoneSearch}%`;

        searchClauses.push(
          sql<boolean>`exists (
            select 1
            from ${clients}
            where ${clients.id} = ${orders.clientId}
              and ${normalizeUaePhoneForSearchSql(clients.phone)} like ${normalizedPhonePattern}
          )`,
          sql<boolean>`exists (
            select 1
            from ${bills}
            where ${bills.id} = ${orders.billId}
              and ${normalizeUaePhoneForSearchSql(bills.customerPhone)} like ${normalizedPhonePattern}
          )`,
        );
      }

      conditions.push(or(...searchClauses));
    }

    if (trimmedOrderNumber) {
      conditions.push(
        sql<boolean>`lower(regexp_replace(regexp_replace(coalesce(${orders.orderNumber}, ''), '^#', '', 'i'), '^ord[-#[:space:]]*', '', 'i')) = ${trimmedOrderNumber}`,
      );
    }

    if (trimmedAccountNumber) {
      const accountNumberPattern = `%${trimmedAccountNumber}%`;
      conditions.push(
        sql<boolean>`exists (
          select 1
          from ${clients}
          where ${clients.id} = ${orders.clientId}
            and ${clients.billNumber} ilike ${accountNumberPattern}
        )`,
      );
    }

    if (trimmedBillAmount) {
      const billAmountPattern = `%${trimmedBillAmount}%`;
      conditions.push(
        or(
          sql<boolean>`exists (
            select 1
            from ${bills}
            where ${bills.id} = ${orders.billId}
              and cast(${bills.amount} as text) ilike ${billAmountPattern}
          )`,
          sql<boolean>`cast(coalesce(${orders.finalAmount}, ${orders.totalAmount}) as text) ilike ${billAmountPattern}`,
        ),
      );
    }

    if (trimmedBillNumber) {
      conditions.push(
        sql<boolean>`cast(${orders.billId} as text) = ${trimmedBillNumber}`,
      );
    }

    if (trimmedNameAddress) {
      const searchPattern = `%${trimmedNameAddress}%`;
      conditions.push(
        or(
          ilike(orders.customerName, searchPattern),
          ilike(orders.deliveryAddress, searchPattern),
          sql<boolean>`exists (
            select 1
            from ${clients}
            where ${clients.id} = ${orders.clientId}
              and (
                ${clients.name} ilike ${searchPattern}
                or ${clients.address} ilike ${searchPattern}
              )
          )`,
          sql<boolean>`exists (
            select 1
            from ${bills}
            where ${bills.id} = ${orders.billId}
              and ${bills.customerName} ilike ${searchPattern}
          )`,
        ),
      );
    }

    if (trimmedMobileNumber) {
      const searchPattern = `%${trimmedMobileNumber}%`;
      const mobileSearchClauses: SQLWrapper[] = [
        sql<boolean>`exists (
          select 1
          from ${clients}
          where ${clients.id} = ${orders.clientId}
            and ${clients.phone} ilike ${searchPattern}
        )`,
        sql<boolean>`exists (
          select 1
          from ${bills}
          where ${bills.id} = ${orders.billId}
            and ${bills.customerPhone} ilike ${searchPattern}
        )`,
      ];

      const normalizedPhoneSearch = normalizePhoneForComparison(trimmedMobileNumber);
      if (normalizedPhoneSearch) {
        const normalizedPhonePattern = `%${normalizedPhoneSearch}%`;
        mobileSearchClauses.push(
          sql<boolean>`exists (
            select 1
            from ${clients}
            where ${clients.id} = ${orders.clientId}
              and ${normalizeUaePhoneForSearchSql(clients.phone)} like ${normalizedPhonePattern}
          )`,
          sql<boolean>`exists (
            select 1
            from ${bills}
            where ${bills.id} = ${orders.billId}
              and ${normalizeUaePhoneForSearchSql(bills.customerPhone)} like ${normalizedPhonePattern}
          )`,
        );
      }

      conditions.push(or(...mobileSearchClauses));
    }

    if (trimmedCompanyName) {
      const searchPattern = `%${trimmedCompanyName}%`;
      conditions.push(
        sql<boolean>`exists (
          select 1
          from ${clients}
          where ${clients.id} = ${orders.clientId}
            and ${clients.company} ilike ${searchPattern}
        )`,
      );
    }

    if (options.from) {
      conditions.push(gte(dateColumn, options.from));
    }

    if (options.to) {
      conditions.push(lte(dateColumn, options.to));
    }

    switch (options.stage) {
      case "create":
        conditions.push(eq(orders.tagDone, false));
        break;
      case "tag-complete":
        conditions.push(and(eq(orders.tagDone, true), eq(orders.packingDone, false)));
        break;
      case "packing-done":
        conditions.push(and(eq(orders.packingDone, true), eq(orders.delivered, false)));
        break;
      case "delivery":
        conditions.push(eq(orders.delivered, true));
        break;
      default:
        break;
    }

    if (options.priority === "urgent") {
      conditions.push(eq(orders.urgent, true));
    } else if (options.priority === "normal") {
      conditions.push(eq(orders.urgent, false));
    }

    if (options.expectedDate === "only") {
      conditions.push(sql<boolean>`${orders.expectedDeliveryAt} is not null`);
    }

    if (options.deliveryType === "delivery") {
      conditions.push(eq(orders.deliveryType, "delivery"));
    } else if (options.deliveryType === "takeaway") {
      conditions.push(sql<boolean>`coalesce(lower(trim(${orders.deliveryType})), '') <> 'delivery'`);
    }

    if (options.paymentStatus === "paid") {
      conditions.push(billPaidCondition);
    } else if (options.paymentStatus === "unpaid") {
      conditions.push(sql<boolean>`not ${billPaidCondition}`);
    }

    return { conditions, dateColumn };
  }

  async getOrdersForTracking(options: OrderTrackingQueryOptions = {}): Promise<Order[]> {
    const { conditions, dateColumn } = this.buildOrderTrackingConditions(options);

    let query = db.select().from(orders);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const sortByNewest = options.sortOrder === "newest";
    query =
      options.sortMode === "system"
        ? (query.orderBy(sortByNewest ? desc(orders.id) : asc(orders.id)) as typeof query)
        : (query.orderBy(
            sortByNewest ? desc(dateColumn) : asc(dateColumn),
            sortByNewest ? desc(orders.id) : asc(orders.id),
          ) as typeof query);

    if (options.limit && options.limit > 0) {
      query = query.limit(options.limit) as typeof query;
    }

    if (options.offset && options.offset > 0) {
      query = query.offset(options.offset) as typeof query;
    }

    return await query;
  }

  async getOrderCountForTracking(options: OrderTrackingQueryOptions = {}): Promise<number> {
    const { conditions } = this.buildOrderTrackingConditions(options);

    let query = db.select({ count: sql<number>`count(*)` }).from(orders);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const [result] = await query;
    return Number(result?.count || 0);
  }

  async getOrderSelectionForTracking(
    options: OrderTrackingQueryOptions = {},
  ): Promise<OrderTrackingSelectionItem[]> {
    const { conditions, dateColumn } = this.buildOrderTrackingConditions(options);

    let query = db
      .select({
        id: orders.id,
        tagDone: orders.tagDone,
        packingDone: orders.packingDone,
        delivered: orders.delivered,
        urgent: orders.urgent,
        deliveryType: orders.deliveryType,
        expectedDeliveryAt: orders.expectedDeliveryAt,
        billIsPaid: sql<boolean>`exists (
          select 1
          from ${bills}
          where ${bills.id} = ${orders.billId}
            and (
              ${bills.isPaid} = true
              or coalesce(${bills.paidAmount}, 0::numeric) >= greatest(coalesce(${bills.amount}, 0::numeric) - ${MONEY_EPSILON}, 0::numeric)
            )
        )`,
      })
      .from(orders);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const sortByNewest = options.sortOrder === "newest";
    query =
      options.sortMode === "system"
        ? (query.orderBy(sortByNewest ? desc(orders.id) : asc(orders.id)) as typeof query)
        : (query.orderBy(
            sortByNewest ? desc(dateColumn) : asc(dateColumn),
            sortByNewest ? desc(orders.id) : asc(orders.id),
          ) as typeof query);

    return await query;
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderByPublicToken(token: string): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.publicViewToken, token));
    return order;
  }

  async getOrderByNumber(orderNumber: string): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber));
    return order;
  }

  async getDeliveredOrderByNumber(
    orderNumber: string,
  ): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(eq(orders.orderNumber, orderNumber), eq(orders.delivered, true)),
      );
    return order;
  }

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const orderData = {
      clientId: insertOrder.clientId,
      billId: insertOrder.billId || null,
      customerName: insertOrder.customerName || null,
      orderNumber: insertOrder.orderNumber,
      items: insertOrder.items,
      totalAmount: insertOrder.totalAmount.toString(),
      finalAmount: insertOrder.finalAmount?.toString() || "0",
      paidAmount: insertOrder.paidAmount?.toString() || "0",
      discountPercent: insertOrder.discountPercent?.toString() || "0",
      discountAmount: insertOrder.discountAmount?.toString() || "0",
      deliveryCharge: insertOrder.deliveryCharge?.toString() || "0",
      paymentMethod: insertOrder.paymentMethod || "cash",
      serviceType: insertOrder.serviceType || "normal",
      status: insertOrder.status || "entry",
      deliveryType: insertOrder.deliveryType || "takeaway",
      expectedDeliveryAt: insertOrder.expectedDeliveryAt
        ? new Date(insertOrder.expectedDeliveryAt)
        : null,
      entryDate: insertOrder.entryDate ? new Date(insertOrder.entryDate) : new Date(),
      entryBy: insertOrder.entryBy,
      entryByWorkerId: insertOrder.entryByWorkerId || null,
      tagDone: insertOrder.tagDone || false,
      tagDate: insertOrder.tagDate ? new Date(insertOrder.tagDate) : null,
      tagBy: insertOrder.tagBy || null,
      tagWorkerId: insertOrder.tagWorkerId || null,
      washingDone: insertOrder.washingDone || false,
      washingDate: insertOrder.washingDate
        ? new Date(insertOrder.washingDate)
        : null,
      washingBy: insertOrder.washingBy,
      packingDone: insertOrder.packingDone || false,
      packingDate: insertOrder.packingDate
        ? new Date(insertOrder.packingDate)
        : null,
      packingBy: insertOrder.packingBy,
      packingWorkerId: insertOrder.packingWorkerId || null,
      delivered: insertOrder.delivered || false,
      deliveryDate: insertOrder.deliveryDate
        ? new Date(insertOrder.deliveryDate)
        : null,
      deliveryBy: insertOrder.deliveryBy,
      deliveredByWorkerId: insertOrder.deliveredByWorkerId || null,
      notes: insertOrder.notes,
      urgent: insertOrder.urgent || false,
      tips: insertOrder.tips?.toString() || "0",
      deliveryAddress: insertOrder.deliveryAddress || null,
    };
    const [order] = await db.insert(orders).values(orderData).returning();
    return order;
  }

  async updateOrder(id: number, updates: UpdateOrderRequest): Promise<Order> {
    const updateData: any = { ...updates };
    if (updates.entryDate) updateData.entryDate = new Date(updates.entryDate);
    if (updates.tagDate) updateData.tagDate = new Date(updates.tagDate);
    if (updates.washingDate)
      updateData.washingDate = new Date(updates.washingDate);
    if (updates.packingDate)
      updateData.packingDate = new Date(updates.packingDate);
    if (updates.deliveryDate)
      updateData.deliveryDate = new Date(updates.deliveryDate);
    if (updates.expectedDeliveryAt)
      updateData.expectedDeliveryAt = new Date(updates.expectedDeliveryAt);
    if (updates.verifiedAt)
      updateData.verifiedAt = new Date(updates.verifiedAt);
    if (updates.deliveryCharge !== undefined)
      updateData.deliveryCharge = updates.deliveryCharge.toString();

    // Check if order is being marked as delivered
    if (updates.delivered === true) {
      const existingOrder = await this.getOrder(id);
      if (existingOrder && !existingOrder.delivered) {
        // Order is being marked as delivered for the first time, deduct stock
        await this.deductStockForOrder(id);
      }
    }

    const [updated] = await db
      .update(orders)
      .set(updateData)
      .where(eq(orders.id, id))
      .returning();
    return updated;
  }

  async deleteOrder(id: number): Promise<void> {
    await db.delete(orders).where(eq(orders.id, id));
  }

  async deleteAllOrders(): Promise<void> {
    await db.delete(orders);
    // Reset all product stock to zero
    await db.update(products).set({ stockQuantity: 0 });
  }

  async deleteAllTransactions(): Promise<void> {
    await db.delete(clientTransactions);
    this.notifyLiveResourceUpdated("clientTransactions");
  }

  async deleteAllBills(): Promise<void> {
    await db.delete(billPayments);
    await db.delete(clientTransactions);
    await db.delete(bills);
    this.notifyLiveResourceUpdated("clientTransactions");
    this.notifyLiveResourceUpdated("bills");
  }

  async deleteAllClients(): Promise<void> {
    await db.delete(clientTransactions);
    await db.delete(clients);
    this.notifyLiveResourceUpdated("clientTransactions");
  }

  async deleteAllIncidents(): Promise<void> {
    await db.delete(incidents);
  }

  async getPackingWorkers(): Promise<PackingWorker[]> {
    return await db.select().from(packingWorkers);
  }

  async getPackingWorker(id: number): Promise<PackingWorker | undefined> {
    const [worker] = await db
      .select()
      .from(packingWorkers)
      .where(eq(packingWorkers.id, id));
    return worker;
  }

  async createPackingWorker(
    worker: InsertPackingWorker,
  ): Promise<PackingWorker> {
    const hashedPin = await bcrypt.hash(worker.pin, 10);
    const [created] = await db
      .insert(packingWorkers)
      .values({ ...worker, pin: hashedPin })
      .returning();
    return created;
  }

  async updatePackingWorker(
    id: number,
    updates: Partial<InsertPackingWorker>,
  ): Promise<PackingWorker> {
    const updateData: any = { ...updates };
    if (updates.pin) {
      updateData.pin = await bcrypt.hash(updates.pin, 10);
    }
    const [updated] = await db
      .update(packingWorkers)
      .set(updateData)
      .where(eq(packingWorkers.id, id))
      .returning();
    return updated;
  }

  async deletePackingWorker(id: number): Promise<void> {
    await db.delete(packingWorkers).where(eq(packingWorkers.id, id));
  }

  async verifyPackingWorkerPin(pin: string): Promise<PackingWorker | null> {
    const activeWorkers = await db
      .select()
      .from(packingWorkers)
      .where(eq(packingWorkers.active, true));
    for (const worker of activeWorkers) {
      const isMatch = await bcrypt.compare(pin, worker.pin);
      if (isMatch) {
        return worker;
      }
    }
    return null;
  }

  async verifyDeliveryWorkerPin(pin: string): Promise<PackingWorker | null> {
    const activeWorkers = await db
      .select()
      .from(packingWorkers)
      .where(eq(packingWorkers.active, true));
    for (const worker of activeWorkers) {
      const isMatch = await bcrypt.compare(pin, worker.pin);
      if (isMatch) {
        return worker;
      }
    }
    return null;
  }

  async verifyUserPin(pin: string): Promise<User | null> {
    const activeUsers = await db
      .select()
      .from(users)
      .where(eq(users.active, true));
    for (const user of activeUsers) {
      if (user.pin === pin) {
        return user;
      }
    }
    return null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return result[0] || null;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User> {
    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.active, true));
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getClientOrders(clientId: number): Promise<Order[]> {
    return await db
      .select()
      .from(orders)
      .where(eq(orders.clientId, clientId))
      .orderBy(desc(orders.entryDate));
  }

  async getIncidents(search?: string): Promise<Incident[]> {
    if (search) {
      const searchPattern = `%${search}%`;
      return await db
        .select()
        .from(incidents)
        .where(
          or(
            ilike(incidents.customerName, searchPattern),
            ilike(incidents.orderNumber || "", searchPattern),
            ilike(incidents.itemName || "", searchPattern),
            ilike(incidents.reason, searchPattern),
          ),
        )
        .orderBy(desc(incidents.incidentDate));
    }
    return await db
      .select()
      .from(incidents)
      .orderBy(desc(incidents.incidentDate));
  }

  async getIncident(id: number): Promise<Incident | undefined> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id));
    return incident;
  }

  async createIncident(insertIncident: InsertIncident): Promise<Incident> {
    const incidentData = {
      customerName: insertIncident.customerName,
      customerPhone: insertIncident.customerPhone || null,
      customerAddress: insertIncident.customerAddress || null,
      orderId: insertIncident.orderId || null,
      orderNumber: insertIncident.orderNumber || null,
      itemName: insertIncident.itemName || null,
      reason: insertIncident.reason,
      notes: insertIncident.notes || null,
      refundAmount: insertIncident.refundAmount?.toString() || "0",
      refundType: insertIncident.refundType || "credit",
      itemValue: insertIncident.itemValue?.toString() || "0",
      responsibleStaffId: null, // Staff ID is stored as string now
      responsibleStaffName: insertIncident.responsibleStaffName || null,
      reporterName: insertIncident.reporterName || null,
      incidentType: insertIncident.incidentType || "refund",
      incidentStage: insertIncident.incidentStage || "delivery",
      status: insertIncident.status || "open",
      incidentDate: insertIncident.incidentDate ? new Date(insertIncident.incidentDate) : new Date(),
      resolvedDate: insertIncident.resolvedDate
        ? new Date(insertIncident.resolvedDate)
        : null,
      resolution: insertIncident.resolution || null,
    };
    const [incident] = await db
      .insert(incidents)
      .values(incidentData)
      .returning();
    return incident;
  }

  async updateIncident(
    id: number,
    updates: Partial<InsertIncident>,
  ): Promise<Incident> {
    const updateData: any = { ...updates };
    // Never update reporterName - it should only be set on creation
    delete updateData.reporterName;
    
    if (updates.refundAmount !== undefined)
      updateData.refundAmount = updates.refundAmount.toString();
    if (updates.itemValue !== undefined)
      updateData.itemValue = updates.itemValue.toString();
    if (updates.incidentDate)
      updateData.incidentDate = new Date(updates.incidentDate);
    if (updates.resolvedDate)
      updateData.resolvedDate = new Date(updates.resolvedDate);

    const [updated] = await db
      .update(incidents)
      .set(updateData)
      .where(eq(incidents.id, id))
      .returning();
    return updated;
  }

  async deleteIncident(id: number): Promise<void> {
    await db.delete(incidents).where(eq(incidents.id, id));
  }

  private parseOrderItems(
    itemsString: string,
  ): { name: string; quantity: number }[] {
    const parsedItems: { name: string; quantity: number }[] = [];
    // Split on comma with optional space to handle both ", " and "," formats
    const items = itemsString.split(/,\s*/);

    for (const item of items) {
      const trimmedItem = item.trim();
      if (!trimmedItem) continue;

      // Pattern 1: "Product Name x3" or "Product Name x3 (Hanging)"
      let match = trimmedItem.match(/^(.+?)\s+x(\d+)(?:\s+\(.*\))?$/);
      if (match) {
        parsedItems.push({
          name: match[1].trim(),
          quantity: parseInt(match[2]),
        });
        continue;
      }

      // Pattern 2: "3x Product Name @ 10 AED" (custom items)
      match = trimmedItem.match(/^(\d+)x\s+(.+?)(?:\s+@\s+[\d.]+\s+AED)?$/);
      if (match) {
        parsedItems.push({
          name: match[2].trim(),
          quantity: parseInt(match[1]),
        });
        continue;
      }

      // Fallback: treat as 1 item with whole string as name
      parsedItems.push({ name: trimmedItem, quantity: 1 });
    }

    return parsedItems;
  }

  private matchOrderItemToInventoryProduct(
    itemName: string,
    allProducts: Product[],
  ): string | null {
    const normalizedProductMap = new Map(
      allProducts.map((product) => [product.name.trim().toLowerCase(), product.name]),
    );

    let normalizedName = itemName
      .replace(/\s*\[(N|DC|IO|D|I)\]\s*/gi, " ")
      .replace(/\s*\*URG\*\s*/gi, " ")
      .replace(/\s*\((folding|hanging)\)\s*$/gi, "")
      .trim();

    normalizedName = normalizedName.replace(/^\d+(?:\.\d+)?\s*sqm\s+/i, "").trim();
    normalizedName = normalizedName.replace(/\s+/g, " ");

    const directMatch = normalizedProductMap.get(normalizedName.toLowerCase());
    if (directMatch) return directMatch;

    const withoutLastParen = normalizedName.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const fallbackExactMatch = normalizedProductMap.get(withoutLastParen.toLowerCase());
    if (fallbackExactMatch) return fallbackExactMatch;

    const fallbackProduct = allProducts.find(
      (product) =>
        product.name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase() ===
        withoutLastParen.toLowerCase(),
    );

    return fallbackProduct?.name || null;
  }

  async getAllocatedStock(): Promise<Record<string, number>> {
    const allOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.delivered, false));
    const allProducts = await db.select().from(products);
    const allocatedStock: Record<string, number> = {};

    for (const order of allOrders) {
      if (!order.items) continue;
      const parsedItems = this.parseOrderItems(order.items);
      for (const item of parsedItems) {
        const finalName = this.matchOrderItemToInventoryProduct(item.name, allProducts);
        if (!finalName) continue;

        allocatedStock[finalName] =
          (allocatedStock[finalName] || 0) + item.quantity;
      }
    }

    return allocatedStock;
  }

  async getOrdersForProduct(productName: string): Promise<{ orderNumber: string; quantity: number; orderId: number }[]> {
    const allOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.delivered, false));
    const allProducts = await db.select().from(products);
    const result: { orderNumber: string; quantity: number; orderId: number }[] = [];

    for (const order of allOrders) {
      if (!order.items) continue;
      const parsedItems = this.parseOrderItems(order.items);
      for (const item of parsedItems) {
        const finalName = this.matchOrderItemToInventoryProduct(item.name, allProducts);
        if (!finalName) continue;

        if (finalName.toLowerCase() === productName.toLowerCase()) {
          result.push({
            orderNumber: order.orderNumber,
            quantity: item.quantity,
            orderId: order.id,
          });
        }
      }
    }

    return result;
  }

  async addStockForOrder(orderId: number): Promise<void> {
    console.log(`[STOCK DEBUG] Adding stock for order ${orderId}`);
    const order = await this.getOrder(orderId);
    console.log(
      `[STOCK DEBUG] Order:`,
      order
        ? {
            id: order.id,
            stockDeducted: order.stockDeducted,
            items: order.items,
          }
        : "null",
    );

    if (!order || order.stockDeducted || !order.items) {
      console.log(
        `[STOCK DEBUG] Early return - !order: ${!order}, order.stockDeducted: ${order?.stockDeducted}, !order.items: ${!order?.items}`,
      );
      return;
    }

    const parsedItems = this.parseOrderItems(order.items);
    console.log(`[STOCK DEBUG] Parsed items:`, parsedItems);
    const allProducts = await db.select().from(products);

    for (const item of parsedItems) {
      // Try exact match first, then case-insensitive match
      let product = allProducts.find((p) => p.name === item.name);
      console.log(
        `[STOCK DEBUG] Step 1 - Exact match for "${item.name}":`,
        product ? `Found: ${product.name}` : "Not found",
      );

      if (!product) {
        product = allProducts.find(
          (p) => p.name.toLowerCase() === item.name.toLowerCase(),
        );
        console.log(
          `[STOCK DEBUG] Step 2 - Case-insensitive match for "${item.name}":`,
          product ? `Found: ${product.name}` : "Not found",
        );
      }
      // Try partial match for items with size/type modifiers like "(Small)" or "(Hanging)"
      if (!product) {
        const baseName = item.name.replace(/\s*\([^)]*\)$/, "").trim(); // Remove only the LAST parenthetical expression
        console.log(
          `[STOCK DEBUG] Step 3 - Removing last parenthesis: "${item.name}" -> "${baseName}"`,
        );
        product = allProducts.find(
          (p) => p.name.toLowerCase() === baseName.toLowerCase(),
        );
        console.log(
          `[STOCK DEBUG] Step 3 - Base name match for "${baseName}":`,
          product ? `Found: ${product.name}` : "Not found",
        );
      }
      // Try removing ALL parenthetical expressions as final fallback
      if (!product) {
        const baseName = item.name.replace(/\s*\(.*?\)/g, "").trim(); // Remove ALL parenthetical expressions
        console.log(
          `[STOCK DEBUG] Step 4 - Removing all parentheses: "${item.name}" -> "${baseName}"`,
        );
        product = allProducts.find(
          (p) => p.name.toLowerCase() === baseName.toLowerCase(),
        );
        console.log(
          `[STOCK DEBUG] Step 4 - All removed match for "${baseName}":`,
          product ? `Found: ${product.name}` : "Not found",
        );
      }

      console.log(
        `[STOCK DEBUG] Item: "${item.name}" qty: ${item.quantity}, Product found:`,
        product
          ? {
              id: product.id,
              name: product.name,
              currentStock: product.stockQuantity,
            }
          : "null",
      );

      if (product) {
        const currentStock = product.stockQuantity || 0;
        const newStock = currentStock + item.quantity;
        console.log(
          `[STOCK DEBUG] Updating stock from ${currentStock} to ${newStock}`,
        );
        await db
          .update(products)
          .set({ stockQuantity: newStock })
          .where(eq(products.id, product.id));
      }
    }

    await db
      .update(orders)
      .set({ stockDeducted: true })
      .where(eq(orders.id, orderId));
  }

  async deductStockForOrder(orderId: number): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order || !order.stockDeducted || !order.items) return;

    const parsedItems = this.parseOrderItems(order.items);
    const allProducts = await db.select().from(products);

    for (const item of parsedItems) {
      let product = allProducts.find((p) => p.name === item.name);
      if (!product) {
        product = allProducts.find(
          (p) => p.name.toLowerCase() === item.name.toLowerCase(),
        );
      }
      if (!product) {
        const baseName = item.name.replace(/\s*\([^)]*\)$/, "").trim(); // Remove only the LAST parenthetical expression
        product = allProducts.find(
          (p) => p.name.toLowerCase() === baseName.toLowerCase(),
        );
      }
      // Try removing ALL parenthetical expressions as final fallback
      if (!product) {
        const baseName = item.name.replace(/\s*\(.*?\)/g, "").trim(); // Remove ALL parenthetical expressions
        product = allProducts.find(
          (p) => p.name.toLowerCase() === baseName.toLowerCase(),
        );
      }

      if (product) {
        const currentStock = product.stockQuantity || 0;
        const newStock = Math.max(0, currentStock - item.quantity);
        await db
          .update(products)
          .set({ stockQuantity: newStock })
          .where(eq(products.id, product.id));
      }
    }
  }

  async getMissingItems(search?: string): Promise<MissingItem[]> {
    if (search) {
      const searchPattern = `%${search}%`;
      return await db
        .select()
        .from(missingItems)
        .where(
          or(
            ilike(missingItems.itemName, searchPattern),
            ilike(missingItems.customerName || "", searchPattern),
            ilike(missingItems.orderNumber || "", searchPattern),
            ilike(missingItems.responsibleWorkerName || "", searchPattern),
          ),
        )
        .orderBy(desc(missingItems.reportedAt));
    }
    return await db
      .select()
      .from(missingItems)
      .orderBy(desc(missingItems.reportedAt));
  }

  async getMissingItem(id: number): Promise<MissingItem | undefined> {
    const [item] = await db
      .select()
      .from(missingItems)
      .where(eq(missingItems.id, id));
    return item;
  }

  async createMissingItem(item: InsertMissingItem): Promise<MissingItem> {
    const dbItem = {
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      customerName: item.customerName,
      itemName: item.itemName,
      quantity: item.quantity,
      stage: item.stage,
      responsibleWorkerId: item.responsibleWorkerId,
      responsibleWorkerName: item.responsibleWorkerName,
      reportedByWorkerId: item.reportedByWorkerId,
      reportedByWorkerName: item.reportedByWorkerName,
      notes: item.notes,
      status: item.status,
      resolution: item.resolution,

      itemValue: item.itemValue != null ? String(item.itemValue) : undefined,

      reportedAt: new Date(item.reportedAt),

      resolvedAt:
        item.resolvedAt === null
          ? null
          : item.resolvedAt
            ? new Date(item.resolvedAt)
            : undefined,
    };

    const [created] = await db.insert(missingItems).values(dbItem).returning();

    return created;
  }

  async updateMissingItem(
    id: number,
    updates: Partial<InsertMissingItem>,
  ): Promise<MissingItem> {
    const dbUpdates = {
      itemName: updates.itemName,
      stage: updates.stage,
      status: updates.status,
      notes: updates.notes,
      customerName: updates.customerName,
      quantity: updates.quantity,
      resolution: updates.resolution,

      itemValue:
        updates.itemValue != null ? String(updates.itemValue) : undefined,

      reportedAt:
        updates.reportedAt != null ? new Date(updates.reportedAt) : undefined,

      resolvedAt:
        updates.resolvedAt === null
          ? null
          : updates.resolvedAt
            ? new Date(updates.resolvedAt)
            : undefined,
    };

    const [updated] = await db
      .update(missingItems)
      .set(dbUpdates)
      .where(eq(missingItems.id, id))
      .returning();

    return updated;
  }

  async deleteMissingItem(id: number): Promise<void> {
    await db.delete(missingItems).where(eq(missingItems.id, id));
  }

  // Staff members methods
  async getStaffMembers(roleType?: string): Promise<StaffMember[]> {
    const businessId = currentTenantBusinessId();
    const tenantFilter = businessId ? eq(staffMembers.businessId, businessId) : undefined;
    if (roleType) {
      return await db
        .select()
        .from(staffMembers)
        .where(and(tenantFilter, eq(staffMembers.roleType, roleType)));
    }
    return tenantFilter
      ? db.select().from(staffMembers).where(tenantFilter)
      : db.select().from(staffMembers);
  }

  async getStaffMember(id: number): Promise<StaffMember | undefined> {
    const businessId = currentTenantBusinessId();
    const [member] = await db.select().from(staffMembers).where(
      businessId
        ? and(eq(staffMembers.id, id), eq(staffMembers.businessId, businessId))
        : eq(staffMembers.id, id),
    );
    return member;
  }

  async createStaffMember(member: InsertStaffMember): Promise<StaffMember> {
    const businessId = currentTenantBusinessId();
    const [created] = await db.insert(staffMembers).values({
      name: member.name,
      pin: member.pin,
      roleType: member.roleType,
      active: true,
      ...(businessId ? { businessId } : {}),
    }).returning();
    return created;
  }

  async updateStaffMember(id: number, updates: Partial<{ name: string; pin: string; active: boolean }>): Promise<StaffMember> {
    const businessId = currentTenantBusinessId();
    const [updated] = await db
      .update(staffMembers)
      .set(updates)
      .where(
        businessId
          ? and(eq(staffMembers.id, id), eq(staffMembers.businessId, businessId))
          : eq(staffMembers.id, id),
      )
      .returning();
    return updated;
  }

  async deleteStaffMember(id: number): Promise<void> {
    const businessId = currentTenantBusinessId();
    await db.delete(staffMembers).where(
      businessId
        ? and(eq(staffMembers.id, id), eq(staffMembers.businessId, businessId))
        : eq(staffMembers.id, id),
    );
  }

  async verifyStaffMemberPin(pin: string): Promise<StaffMember | null> {
    const businessId = currentTenantBusinessId();
    // For login verification, only check active members
    const [member] = await db.select().from(staffMembers).where(and(
      businessId ? eq(staffMembers.businessId, businessId) : undefined,
      eq(staffMembers.pin, pin),
      eq(staffMembers.active, true),
    ));
    return member || null;
  }

  async checkStaffMemberPinExists(pin: string, excludeId?: number): Promise<boolean> {
    const businessId = currentTenantBusinessId();
    const tenantFilter = businessId ? eq(staffMembers.businessId, businessId) : undefined;
    // For creation/update validation, check ALL staff members (including inactive)
    if (excludeId) {
      const existing = await db.select().from(staffMembers).where(and(
        tenantFilter,
        eq(staffMembers.pin, pin),
        ne(staffMembers.id, excludeId),
      ));
      return existing.length > 0;
    }
    const existing = await db.select().from(staffMembers).where(and(
      tenantFilter,
      eq(staffMembers.pin, pin),
    ));
    return existing.length > 0;
  }

  async getCompanyContactSettings(): Promise<CompanyContactSettings> {
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.ENABLE_RUNTIME_SCHEMA_MIGRATIONS === "true"
    ) {
      await db.execute(sql`
        ALTER TABLE company_contact_settings
        ADD COLUMN IF NOT EXISTS dashboard_clock_hour12 BOOLEAN NOT NULL DEFAULT TRUE
      `);
    }

    const businessId = currentTenantBusinessId();
    const [existing] = businessId
      ? await db
          .select()
          .from(companyContactSettings)
          .where(eq(companyContactSettings.businessId, businessId))
          .orderBy(companyContactSettings.id)
          .limit(1)
      : await db
          .select()
          .from(companyContactSettings)
          .where(isNull(companyContactSettings.businessId))
          .orderBy(companyContactSettings.id)
          .limit(1);
    const [business] = businessId
      ? await db
          .select()
          .from(laundryBusinesses)
          .where(eq(laundryBusinesses.id, businessId))
          .limit(1)
      : [];
    if (existing) {
      return {
        ...existing,
        ...(business
          ? {
              companyName: business.name,
              email: business.contactEmail || existing.email,
            }
          : {}),
      };
    }

    const [created] = await db
      .insert(companyContactSettings)
      .values({
        businessId: businessId || null,
        companyName: business?.name || "Laundry Business",
        tagline: null,
        telephone: null,
        mobilePhone: null,
        whatsappPhone: null,
        email: business?.contactEmail || null,
        website: null,
        addressLine1: null,
        addressLine2: null,
        addressLine3: null,
      })
      .returning();
    return business
      ? {
          ...created,
          companyName: business.name,
          email: business.contactEmail || created.email,
        }
      : created;
  }

  private async ensureSalesReportScheduleSettingsTable(): Promise<void> {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_RUNTIME_SCHEMA_MIGRATIONS !== "true"
    ) {
      return;
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sales_report_schedule_settings (
        id SERIAL PRIMARY KEY,
        daily_report_day_offset INTEGER NOT NULL DEFAULT 0,
        daily_hour INTEGER NOT NULL DEFAULT 23,
        daily_minute INTEGER NOT NULL DEFAULT 59,
        weekly_day INTEGER NOT NULL DEFAULT 6,
        weekly_hour INTEGER NOT NULL DEFAULT 23,
        weekly_minute INTEGER NOT NULL DEFAULT 59,
        monthly_day INTEGER NOT NULL DEFAULT 31,
        monthly_hour INTEGER NOT NULL DEFAULT 23,
        monthly_minute INTEGER NOT NULL DEFAULT 59,
        yearly_month INTEGER NOT NULL DEFAULT 12,
        yearly_day INTEGER NOT NULL DEFAULT 31,
        yearly_hour INTEGER NOT NULL DEFAULT 23,
        yearly_minute INTEGER NOT NULL DEFAULT 59,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      ALTER TABLE sales_report_schedule_settings
      ADD COLUMN IF NOT EXISTS daily_report_day_offset INTEGER NOT NULL DEFAULT 0
    `);

  }

  async getSalesReportScheduleSettings(): Promise<SalesReportScheduleSettings> {
    await this.ensureSalesReportScheduleSettingsTable();

    const [existing] = await db
      .select()
      .from(salesReportScheduleSettings)
      .orderBy(salesReportScheduleSettings.id);

    if (existing) return existing;

    const [created] = await db
      .insert(salesReportScheduleSettings)
      .values({})
      .returning();
    return created;
  }

  async getProductCategorySettings(): Promise<ProductCategorySettings> {
    await this.ensureProductCategorySettingsTable();

    const [existing] = await db
      .select()
      .from(productCategorySettings)
      .orderBy(productCategorySettings.id);

    if (existing) {
      return normalizeProductCategorySettings(existing) as ProductCategorySettings;
    }

    const defaults = normalizeProductCategorySettings({
      baseCategories: DEFAULT_PRODUCT_BASE_CATEGORIES,
      customCategories: [],
      inventoryDisplayOrder: DEFAULT_PRODUCT_BASE_CATEGORIES,
      orderDisplayOrder: DEFAULT_PRODUCT_BASE_CATEGORIES,
      favoritesOrder: [],
    });

    const [created] = await db
      .insert(productCategorySettings)
      .values({
        baseCategories: defaults.baseCategories,
        customCategories: defaults.customCategories,
        inventoryDisplayOrder: defaults.inventoryDisplayOrder,
        orderDisplayOrder: defaults.orderDisplayOrder,
        favoritesOrder: defaults.favoritesOrder,
      })
      .returning();

    return created;
  }

  async updateProductCategorySettings(
    updates: Partial<InsertProductCategorySettings>,
  ): Promise<ProductCategorySettings> {
    await this.ensureProductCategorySettingsTable();

    const existing = normalizeProductCategorySettings(
      await this.getProductCategorySettings(),
    );
    const nextSettings = normalizeProductCategorySettings({
      ...existing,
      ...updates,
    });

    const [updated] = await db
      .update(productCategorySettings)
      .set({
        baseCategories: nextSettings.baseCategories,
        customCategories: nextSettings.customCategories,
        inventoryDisplayOrder: nextSettings.inventoryDisplayOrder,
        orderDisplayOrder: nextSettings.orderDisplayOrder,
        favoritesOrder: nextSettings.favoritesOrder,
        updatedAt: new Date(),
      })
      .where(eq(productCategorySettings.id, existing.id ?? 1))
      .returning();

    this.notifyLiveResourceUpdated("productCategorySettings");
    return updated;
  }

  async updateCompanyContactSettings(
    updates: Partial<InsertCompanyContactSettings>,
  ): Promise<CompanyContactSettings> {
    const existing = await this.getCompanyContactSettings();
    const [updated] = await db
      .update(companyContactSettings)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(companyContactSettings.id, existing.id))
      .returning();

    const businessId = currentTenantBusinessId();
    if (businessId) {
      const workspaceUpdates: Partial<typeof laundryBusinesses.$inferInsert> = {
        updatedAt: new Date(),
      };

      if ("companyName" in updates && updates.companyName?.trim()) {
        workspaceUpdates.name = updates.companyName.trim();
      }
      if ("email" in updates) {
        workspaceUpdates.contactEmail = updates.email?.trim() || null;
      }
      if ("mobilePhone" in updates || "telephone" in updates) {
        workspaceUpdates.phone =
          updates.mobilePhone?.trim() ||
          updates.telephone?.trim() ||
          null;
      }

      await db
        .update(laundryBusinesses)
        .set(workspaceUpdates)
        .where(eq(laundryBusinesses.id, businessId));
    }

    return updated;
  }

  async updateSalesReportScheduleSettings(
    updates: Partial<InsertSalesReportScheduleSettings>,
  ): Promise<SalesReportScheduleSettings> {
    const existing = await this.getSalesReportScheduleSettings();
    const [updated] = await db
      .update(salesReportScheduleSettings)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(salesReportScheduleSettings.id, existing.id))
      .returning();
    return updated;
  }

  async getCompanies(): Promise<Company[]> {
    return db.select().from(companies).orderBy(companies.name);
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  async getReviews(): Promise<Review[]> {
    return db.select().from(reviews).orderBy(desc(reviews.createdAt));
  }

  async getReviewByOrderId(orderId: number): Promise<Review | undefined> {
    const [review] = await db.select().from(reviews).where(eq(reviews.orderId, orderId));
    return review;
  }

  async createReview(review: InsertReview): Promise<Review> {
    const [created] = await db.insert(reviews).values(review).returning();
    return created;
  }

  async updateReview(id: number, updates: Partial<InsertReview>): Promise<Review> {
    const [updated] = await db.update(reviews).set({ ...updates, updatedAt: new Date() }).where(eq(reviews.id, id)).returning();
    return updated;
  }

  async deleteReview(id: number): Promise<void> {
    await db.delete(reviews).where(eq(reviews.id, id));
  }
}

export const storage = new DatabaseStorage();

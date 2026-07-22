import type { Express, Request, Response as ExpressResponse } from "express";
import type { Server } from "http";
import { storage, type LiveResource } from "./storage";
import { api } from "@shared/routes";
import {
  billFilterSummaryInputSchema,
  buildBillFilterSummary,
} from "@shared/billFilters";
import {
  isPlausiblePhoneNumber,
  normalizePhoneForComparison,
  normalizePhoneForStorage,
} from "@shared/phone";
import {
  normalizeCategoryNames,
  normalizeStoredProductCategoryName,
  normalizeProductIdOrder,
  normalizeProductCategorySettings,
} from "@shared/productCategories";
import { z } from "zod";
import {
  db,
  runRequestWithDatabaseScope,
  runWithPlatformDatabase,
} from "./db";
import {
  users,
  laundryBusinesses,
  organizationUnits,
  staffProfiles,
  passwordResetTokens,
  stageChecklists,
  packingWorkers,
  bills,
  orders,
  clientTransactions,
  billPayments,
  clients,
  staffMembers,
  products,
  incidents,
  missingItems,
  companies,
  productCategorySettings,
  companyContactSettings,
  appSecuritySettings,
  salesReportScheduleSettings,
  reviews,
} from "@shared/schema";
import { eq, and, gt, ne, not, or, desc, sql, inArray, isNull } from "drizzle-orm";
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_MS,
  createAuthToken,
  getRequestAuth,
} from "./authToken";
import { sendUserPasswordResetEmail } from "./passwordResetEmail";
import { sendDailySalesReportEmailSMTP, sendSalesReportEmailSMTP, type DailySalesData, type SalesReportData, type ReportPeriod } from "./smtp";
import PDFDocument from "pdfkit";
import bcrypt from "bcryptjs";

import { seedDatabase } from "./seed";
import { mergeClientAccounts } from "./mergeClients";
import {
  buildDatabaseExport,
  getDatabaseExportFileName,
  importDatabaseExport,
} from "./databaseTransfer";
import {
  clearAppLockdownStatusCache,
  ensureAppSecuritySettingsTable,
  getAppLockdownStatus,
  getAppLockdownStatusForBusiness,
  setAppLockdownStatus,
} from "./appSecurity";
import {
  formatErrorMessage,
  isDatabaseConnectionError,
} from "./errorFormatting";
import { ensureMultiTenantFoundation } from "./multiTenant";
import { encryptBusinessSecret } from "./businessSecrets";
import {
  resolveRequestIdentity,
  type TenantRequestContext,
} from "./tenantContext";

type TrackingPaymentStatus = "all" | "paid" | "unpaid";
type TrackingSortOrder = "newest" | "oldest";

function parseTrackingPaymentStatus(value: unknown): TrackingPaymentStatus {
  return typeof value === "string" && ["all", "paid", "unpaid"].includes(value)
    ? (value as TrackingPaymentStatus)
    : "all";
}

function parseTrackingSortOrder(value: unknown): TrackingSortOrder {
  return value === "newest" ? "newest" : "oldest";
}

function removeBulkIndicator(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\s*\(bulk\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}

function sanitizeOrderActorLabels<T extends Record<string, any>>(order: T): T {
  return {
    ...order,
    entryBy: removeBulkIndicator(order.entryBy),
    tagBy: removeBulkIndicator(order.tagBy),
    washingBy: removeBulkIndicator(order.washingBy),
    packingBy: removeBulkIndicator(order.packingBy),
    deliveryBy: removeBulkIndicator(order.deliveryBy),
    verifiedByWorkerName: removeBulkIndicator(order.verifiedByWorkerName),
  };
}

function isUsableCustomerAddress(value: unknown): boolean {
  const normalized = String(value || "").trim();
  return !!normalized && normalized !== "-" && normalized !== "0";
}

function isBrokerAccount(client: Record<string, any> | null | undefined): boolean {
  return String(client?.clientType || "").trim().toLowerCase() === "broker";
}

function applyCurrentAccountDataToOrder<T extends Record<string, any>>(
  order: T,
  clientById: ReadonlyMap<number, Record<string, any>>,
): T {
  const clientId = Number(order.clientId);
  if (!Number.isFinite(clientId)) return order;

  const client = clientById.get(clientId);
  if (!client) return order;

  const nextOrder: Record<string, any> = { ...order };
  if (client.name) {
    nextOrder.customerName = client.name;
  }

  const accountAddress = String(client.address || "").trim();
  if (!isBrokerAccount(client) && isUsableCustomerAddress(accountAddress)) {
    nextOrder.deliveryAddress = accountAddress;
  }

  return nextOrder as T;
}

async function applyCurrentAccountDataToOrders<T extends Record<string, any>>(
  orderList: T[],
): Promise<T[]> {
  if (orderList.length === 0) return orderList;

  const clientIds = new Set(
    orderList
      .map((order) => Number(order.clientId))
      .filter((clientId) => Number.isFinite(clientId)),
  );
  if (clientIds.size === 0) return orderList;

  const clientList = await storage.getClients();
  const clientById = new Map(
    clientList
      .filter((client) => clientIds.has(client.id))
      .map((client) => [client.id, client as Record<string, any>]),
  );

  return orderList.map((order) => applyCurrentAccountDataToOrder(order, clientById));
}

function parseSqmDescriptionPart(
  part: string,
  allProducts: any[],
): { name: string; qty: number; sqm: number; price: number; note: string | null; isAdminEdited: boolean } | null {
  const trailingNoteMatch = part.match(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i);
  const trailingNote = trailingNoteMatch ? trailingNoteMatch[1].trim().toLowerCase() : null;
  const normalizedPart = trailingNoteMatch ? part.replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i, "").trim() : part;

  const sqmMatch = normalizedPart.match(
    /^(?:(\d+)x\s+)?([\d.]+)\s*sqm\s+(.+?)(?:\s*@\s*([\d.]+)\s*AED|\s+Total\s+([\d.]+)\s*AED|\s*\(([\d.]+)\s*AED\))?$/i,
  );
  if (!sqmMatch) return null;

  const qty = sqmMatch[1] ? parseInt(sqmMatch[1], 10) : 1;
  const sqm = parseFloat(sqmMatch[2]);
  const rawName = sqmMatch[3].trim();
  const embeddedPrice = sqmMatch[4] ? parseFloat(sqmMatch[4]) : NaN;
  const embeddedTotal = sqmMatch[5]
    ? parseFloat(sqmMatch[5])
    : sqmMatch[6]
      ? parseFloat(sqmMatch[6])
      : NaN;
  const cleanName = rawName
    .replace(/\s*\(base\s*[\d.]+\s*AED\)\s*/gi, " ")
    .replace(/\s*\(\s*[\d.]+\s*AED\s*\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const productLookupName = cleanName
    .replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "")
    .replace(/\s*\[[^\]]*\]\s*/g, "")
    .trim();
  const sqmProduct = allProducts.find(
    (product) => product.name.toLowerCase() === productLookupName.toLowerCase(),
  );

  let linePrice = Number.isFinite(embeddedPrice) ? embeddedPrice : NaN;
  if (!Number.isFinite(linePrice) && Number.isFinite(embeddedTotal)) {
    linePrice = embeddedTotal;
  }
  if (!Number.isFinite(linePrice) && sqmProduct?.sqmPrice) {
    const fallbackRate = parseFloat(sqmProduct.sqmPrice as string);
    if (Number.isFinite(fallbackRate)) {
      linePrice = sqm * fallbackRate;
      if (sqm < 5) {
        linePrice = Math.max(linePrice, 50);
      }
    }
  }

  const sqmDisplayName = cleanName.replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "").trim();
  const normalizedName = trailingNote === "admin edited"
    ? sqmDisplayName
    : /\(per\s*SQ\s*MTR\)/i.test(cleanName)
      ? cleanName
      : `${cleanName} (per SQ MTR)`;

  return {
    name: `${sqm} sqm ${normalizedName}`.trim(),
    qty,
    sqm,
    price: Number.isFinite(linePrice) ? linePrice : 0,
    note: trailingNote,
    isAdminEdited: trailingNote === "admin edited",
  };
}

function parseDeliveryConfirmationItems(
  itemsString: string | null | undefined,
): Array<{ name: string; quantity: number }> {
  if (!itemsString) return [];

  const trimmed = itemsString.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          name: item.name || item.productName || "Unknown",
          quantity: item.quantity || item.qty || 1,
        }));
      }
    } catch {
      // Fall through to string parsing below.
    }
  }

  return itemsString.split(", ").map((itemStr) => {
    const quantityFirstMatch = itemStr.match(/^(\d+)x\s+(.+)$/);
    if (quantityFirstMatch) {
      return {
        name: quantityFirstMatch[2].trim(),
        quantity: parseInt(quantityFirstMatch[1], 10),
      };
    }

    const nameFirstMatch = itemStr.match(/^(.+)\s+x(\d+)$/);
    if (nameFirstMatch) {
      return {
        name: nameFirstMatch[1].trim(),
        quantity: parseInt(nameFirstMatch[2], 10),
      };
    }

    return { name: itemStr.trim(), quantity: 1 };
  });
}

type ParsedItemReleaseStatus = {
  status: string;
  quantity: number | null;
};

const COMPLETED_ITEM_RELEASE_STATUSES = new Set(["delivered", "picked_up"]);

function parseItemReleaseStatusMap(raw: unknown): Record<string, ParsedItemReleaseStatus> {
  if (raw === null || raw === undefined || raw === "") return {};

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const normalized: Record<string, ParsedItemReleaseStatus> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === "string") {
        const status = value.trim();
        if (status) {
          normalized[key] = { status, quantity: null };
        }
        return;
      }

      if (!value || typeof value !== "object") return;
      const entry = value as { status?: unknown; quantity?: unknown };
      const status = String(entry.status || "").trim();
      if (!status) return;

      const parsedQuantity = Number(entry.quantity);
      normalized[key] = {
        status,
        quantity: Number.isFinite(parsedQuantity) && parsedQuantity > 0
          ? Math.floor(parsedQuantity)
          : null,
      };
    });
    return normalized;
  } catch {
    return {};
  }
}

function getOrderItemReleaseDoneStatus(order: { deliveryType?: string | null }) {
  return String(order.deliveryType || "").trim().toLowerCase() === "delivery"
    ? "delivered"
    : "picked_up";
}

function getReleasedItemQuantity(
  releaseStatusMap: Record<string, ParsedItemReleaseStatus>,
  lineIndex: number,
  lineQuantity: number,
  doneStatus: string,
) {
  const safeLineQuantity = Math.max(0, Math.floor(Number(lineQuantity) || 0));
  if (safeLineQuantity <= 0) return 0;

  const entry = releaseStatusMap[String(lineIndex)];
  if (!entry) return 0;

  const normalizedStatus = String(entry.status || "").trim().toLowerCase();
  const normalizedDoneStatus = String(doneStatus || "").trim().toLowerCase();
  if (
    normalizedStatus !== normalizedDoneStatus &&
    !COMPLETED_ITEM_RELEASE_STATUSES.has(normalizedStatus)
  ) {
    return 0;
  }

  if (entry.quantity == null) {
    return safeLineQuantity;
  }

  return Math.min(safeLineQuantity, Math.max(0, Math.floor(Number(entry.quantity) || 0)));
}

function buildFullItemReleaseStatusJson(
  items: Array<{ quantity: number }>,
  doneStatus: string,
) {
  const fullStatus: Record<string, { status: string; quantity: number }> = {};
  items.forEach((item, index) => {
    fullStatus[String(index)] = {
      status: doneStatus,
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
    };
  });
  return JSON.stringify(fullStatus);
}

function applyFullItemReleaseStageSync(existingOrder: any, updates: Record<string, any>) {
  if (!Object.prototype.hasOwnProperty.call(updates, "itemPickupStatus")) {
    return;
  }
  if (updates.delivered === false) {
    return;
  }

  const orderSnapshot = { ...existingOrder, ...updates };
  const items = parseDeliveryConfirmationItems(orderSnapshot.items);
  if (items.length === 0) return;

  const doneStatus = getOrderItemReleaseDoneStatus(orderSnapshot);
  const releaseStatusMap = parseItemReleaseStatusMap(updates.itemPickupStatus);
  const allItemsReleased = items.every((item, index) => {
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    return quantity > 0 && getReleasedItemQuantity(releaseStatusMap, index, quantity, doneStatus) >= quantity;
  });

  if (!allItemsReleased) {
    return;
  }

  const completionTimestamp =
    typeof updates.deliveryDate === "string" && updates.deliveryDate.trim()
      ? updates.deliveryDate
      : new Date().toISOString();
  const adminActor = "Admin";
  const totalReleasedItems = items.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)),
    0,
  );

  updates.itemPickupStatus = buildFullItemReleaseStatusJson(items, doneStatus);
  updates.delivered = true;
  updates.status = doneStatus === "delivered" ? "delivered" : "picked_up";

  const shouldAutoCompleteTag = !existingOrder.tagDone || !existingOrder.tagDate;
  if (shouldAutoCompleteTag) {
    updates.tagDone = true;
    updates.tagDate = updates.tagDate || completionTimestamp;
  }
  if ((shouldAutoCompleteTag || !existingOrder.tagBy) && !updates.tagBy) {
    updates.tagBy = adminActor;
  }

  const shouldAutoCompleteWashing = !existingOrder.washingDone || !existingOrder.washingDate;
  if (shouldAutoCompleteWashing) {
    updates.washingDone = true;
    updates.washingDate = updates.washingDate || completionTimestamp;
  }
  if ((shouldAutoCompleteWashing || !existingOrder.washingBy) && !updates.washingBy) {
    updates.washingBy = adminActor;
  }

  const shouldAutoCompletePacking = !existingOrder.packingDone || !existingOrder.packingDate;
  if (shouldAutoCompletePacking) {
    updates.packingDone = true;
    updates.packingDate = updates.packingDate || completionTimestamp;
  }
  if ((shouldAutoCompletePacking || !existingOrder.packingBy) && !updates.packingBy) {
    updates.packingBy = adminActor;
  }

  const shouldAutoCompleteRelease = !existingOrder.delivered || !existingOrder.deliveryDate;
  if (shouldAutoCompleteRelease) {
    updates.deliveryDate = updates.deliveryDate || completionTimestamp;
  }
  if ((shouldAutoCompleteRelease || !existingOrder.deliveryBy) && !updates.deliveryBy) {
    updates.deliveryBy = adminActor;
  }
  if (updates.itemCountAtRelease === undefined && existingOrder.itemCountAtRelease == null) {
    updates.itemCountAtRelease = totalReleasedItems;
  }
}

function getCatalogItemUnitPrice(
  itemName: string,
  allProducts: any[],
  deliveryType?: string | null,
  isUrgentOverride?: boolean,
): number {
  const customPriceMatch = String(itemName || "").match(/(.+?)\s*@\s*([\d.]+)\s*AED/i);
  if (customPriceMatch) {
    const parsed = parseFloat(customPriceMatch[2]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const normalizedDeliveryType = String(deliveryType || "").trim().toLowerCase();
  const serviceType =
    /\[(?:IO|I)\]/i.test(itemName)
      ? "iron_only"
      : /\[(?:DC|D)\]/i.test(itemName)
        ? "dc"
        : /\[N\]/i.test(itemName)
          ? "normal"
          : normalizedDeliveryType === "dry_clean"
            ? "dc"
            : normalizedDeliveryType === "iron_only"
              ? "iron_only"
              : "normal";
  const hasUrgTag = itemName.includes("*URG*");
  const itemUrgent = !!isUrgentOverride || hasUrgTag;
  const sizeMatch = itemName.match(/\((Small|Medium|Large)\)/i);
  const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

  const baseProductName = itemName
    .replace(/\s*\[N\]\s*/g, "")
    .replace(/\s*\[DC?\]\s*/g, "")
    .replace(/\s*\[IO?\]\s*/g, "")
    .replace(/\s*\(folding\)\s*/gi, "")
    .replace(/\s*\(hanger\)\s*/gi, "")
    .replace(/\s*\(hanging\)\s*/gi, "")
    .replace(/\s*\(Small\)\s*/gi, "")
    .replace(/\s*\(Medium\)\s*/gi, "")
    .replace(/\s*\(Large\)\s*/gi, "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)\s*/gi, "")
    .replace(/\s*\*URG\*\s*/g, "")
    .replace(/\s*@\s*[\d.]+\s*AED/gi, "")
    .trim();

  const product = allProducts.find(
    (p) => p.name.toLowerCase() === baseProductName.toLowerCase(),
  );
  if (!product) return 0;

  let basePrice = parseFloat(product.price || "0");
  if (size === "small" && product.smallPrice) basePrice = parseFloat(product.smallPrice);
  else if (size === "medium" && product.mediumPrice) basePrice = parseFloat(product.mediumPrice);
  else if (size === "large" && product.largePrice) basePrice = parseFloat(product.largePrice);

  if (serviceType === "iron_only") {
    if (itemUrgent) {
      if (size === "small" && product.smallUrgentIronOnlyPrice) return parseFloat(product.smallUrgentIronOnlyPrice);
      if (size === "medium" && product.mediumUrgentIronOnlyPrice) return parseFloat(product.mediumUrgentIronOnlyPrice);
      if (size === "large" && product.largeUrgentIronOnlyPrice) return parseFloat(product.largeUrgentIronOnlyPrice);
      if (product.urgentIronOnlyPrice) return parseFloat(product.urgentIronOnlyPrice);
    }
    let ioPrice = basePrice / 2;
    if (size === "small" && product.smallIronOnlyPrice) ioPrice = parseFloat(product.smallIronOnlyPrice);
    else if (size === "medium" && product.mediumIronOnlyPrice) ioPrice = parseFloat(product.mediumIronOnlyPrice);
    else if (size === "large" && product.largeIronOnlyPrice) ioPrice = parseFloat(product.largeIronOnlyPrice);
    else if (product.ironOnlyPrice) ioPrice = parseFloat(product.ironOnlyPrice);
    if (itemUrgent) ioPrice *= 2;
    return ioPrice;
  }

  if (serviceType === "dc") {
    if (itemUrgent) {
      if (size === "small" && product.smallUrgentDryCleanPrice) return parseFloat(product.smallUrgentDryCleanPrice);
      if (size === "medium" && product.mediumUrgentDryCleanPrice) return parseFloat(product.mediumUrgentDryCleanPrice);
      if (size === "large" && product.largeUrgentDryCleanPrice) return parseFloat(product.largeUrgentDryCleanPrice);
      if (product.urgentDryCleanPrice) return parseFloat(product.urgentDryCleanPrice);
    }
    let dcPrice = basePrice;
    if (size === "small" && product.smallDryCleanPrice) dcPrice = parseFloat(product.smallDryCleanPrice);
    else if (size === "medium" && product.mediumDryCleanPrice) dcPrice = parseFloat(product.mediumDryCleanPrice);
    else if (size === "large" && product.largeDryCleanPrice) dcPrice = parseFloat(product.largeDryCleanPrice);
    else dcPrice = parseFloat(product.dryCleanPrice || String(basePrice * 2));
    if (itemUrgent) dcPrice *= 2;
    return dcPrice;
  }

  if (itemUrgent) {
    if (size === "small" && product.smallUrgentPrice) return parseFloat(product.smallUrgentPrice);
    if (size === "medium" && product.mediumUrgentPrice) return parseFloat(product.mediumUrgentPrice);
    if (size === "large" && product.largeUrgentPrice) return parseFloat(product.largeUrgentPrice);
    return basePrice * 2;
  }

  return basePrice;
}

function stripStoredItemPriceMetadata(itemName: string): string {
  return String(itemName || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)\s*/gi, " ")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((?:custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getStoredBaseUnitPrice(itemName: string): number | null {
  const match = String(itemName || "").match(/\(base\s*([\d.]+)\s*AED\)/i);
  if (!match) return null;
  const parsed = parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getStoredCurrentUnitPrice(itemName: string): number | null {
  const match = String(itemName || "").match(/@\s*([\d.]+)\s*AED/i);
  if (!match) return null;
  const parsed = parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNonUrgentServiceUnitPrice(
  itemName: string,
  allProducts: any[],
  deliveryType?: string | null,
): number {
  const nonUrgentName = stripStoredItemPriceMetadata(itemName)
    .replace(/\s*\*URG\*\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return getCatalogItemUnitPrice(nonUrgentName, allProducts, deliveryType, false);
}

function formatStoredLineItem(
  quantity: number,
  itemName: string,
  currentUnitPrice: number,
  baseUnitPrice?: number | null,
): string {
  const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
  const cleanName = stripStoredItemPriceMetadata(itemName);
  const safeCurrentUnitPrice = Number.isFinite(currentUnitPrice) ? currentUnitPrice : 0;
  const normalizedBaseUnitPrice = Number.isFinite(Number(baseUnitPrice))
    ? Number(baseUnitPrice)
    : null;
  const baseSuffix =
    normalizedBaseUnitPrice !== null
      ? ` (base ${normalizedBaseUnitPrice.toFixed(2)} AED)`
      : "";

  return `${safeQuantity}x ${cleanName}${baseSuffix} @ ${safeCurrentUnitPrice.toFixed(2)} AED`;
}

async function buildBillDescriptionWithPrices(orderNumber: string, itemsText: string, deliveryType: string | null): Promise<string> {
  if (!itemsText) return `Order #${orderNumber}: Items`;
  const allProducts = await storage.getProducts();
  const parts = itemsText.split(',').map(s => s.trim()).filter(Boolean);
  const enrichedParts = parts.map(part => {
    const sqmItem = parseSqmDescriptionPart(part, allProducts);
    if (sqmItem) {
      const qtyPrefix = sqmItem.qty > 1 ? `${sqmItem.qty}x ` : "";
      const noteSuffix = sqmItem.note ? ` (${sqmItem.note})` : "";
      return sqmItem.price > 0
        ? `${qtyPrefix}${sqmItem.name} @ ${sqmItem.price.toFixed(2)} AED${noteSuffix}`
        : `${qtyPrefix}${sqmItem.name}`;
    }

    if (part.match(/@\s*[\d.]+\s*AED/i)) return part;

    const match = part.match(/^(\d+)x\s+(.+)$/i);
    if (!match) return part;
    const qty = parseInt(match[1]);
    const name = match[2].trim();

    const serviceMatch = name.match(/\[(N|DC|IO|D|I)\]/i);
    const serviceTag = serviceMatch ? serviceMatch[1].toUpperCase() : 'N';
    const isDC = serviceTag === 'DC' || serviceTag === 'D';
    const isIO = serviceTag === 'IO' || serviceTag === 'I';
    const sizeMatch = name.match(/\((Small|Medium|Large)\)/i);
    const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

    const baseName = name
      .replace(/\s*\*URG\*\s*/g, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      .replace(/\s*\(Small\)|\(Medium\)|\(Large\)|\(folding\)|\(hanger\)|\(hanging\)/gi, '')
      .replace(/\s*@\s*[\d.]+\s*AED/gi, '')
      .trim();
    let product = allProducts.find(p => p.name.toLowerCase() === baseName.toLowerCase());
    if (!product) {
      const nameClean = name.replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\*URG\*\s*/g, '').replace(/\s*@\s*[\d.]+\s*AED/gi, '').trim();
      product = allProducts.find(p => p.name.toLowerCase() === nameClean.toLowerCase());
    }

    let price = 0;
    if (product) {
      price = getCatalogItemUnitPrice(name, allProducts, deliveryType);
    }

    return `${qty}x ${name} @ ${price.toFixed(2)} AED`;
  });
  return `Order #${orderNumber}: ${enrichedParts.join(', ')}`;
}

let cachedOrderSequence: number | null = null;

function extractOrderSequence(orderNumber: string | null | undefined): number {
  if (!orderNumber) return 0;
  const digits = orderNumber.replace(/\D/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

async function getNextSequentialOrderNumber(): Promise<string> {
  if (cachedOrderSequence === null) {
    const existingOrders = await db.select({ orderNumber: orders.orderNumber }).from(orders);
    cachedOrderSequence = existingOrders.reduce((max, row) => {
      const seq = extractOrderSequence(row.orderNumber);
      return seq > max ? seq : max;
    }, 0);
  }
  cachedOrderSequence += 1;
  return `ORD-${String(cachedOrderSequence).padStart(6, "0")}`;
}

async function getAdminPasswordForVerification(): Promise<string> {
  const adminUser = await storage.getUserByUsername("admin");
  return adminUser?.password || process.env.ADMIN_PASSWORD || "";
}

async function verifyAdminPassword(adminPassword: string): Promise<boolean> {
  if (!adminPassword) return false;

  const correctPassword = await getAdminPasswordForVerification();
  return adminPassword === correctPassword;
}

const salesReportScheduleInputSchema = z.object({
  dailyReportDayOffset: z.coerce.number().int().min(0).max(1),
  dailyHour: z.coerce.number().int().min(0).max(23),
  dailyMinute: z.coerce.number().int().min(0).max(59),
  weeklyDay: z.coerce.number().int().min(0).max(6),
  weeklyHour: z.coerce.number().int().min(0).max(23),
  weeklyMinute: z.coerce.number().int().min(0).max(59),
  monthlyDay: z.coerce.number().int().min(1).max(31),
  monthlyHour: z.coerce.number().int().min(0).max(23),
  monthlyMinute: z.coerce.number().int().min(0).max(59),
  yearlyMonth: z.coerce.number().int().min(1).max(12),
  yearlyDay: z.coerce.number().int().min(1).max(31),
  yearlyHour: z.coerce.number().int().min(0).max(23),
  yearlyMinute: z.coerce.number().int().min(0).max(59),
});

async function getAdminPinForVerification(): Promise<string> {
  const adminUser = await storage.getUserByUsername("admin");
  return adminUser?.pin || process.env.ADMIN_PIN || "00000";
}

async function verifyAdminPin(adminPin: string): Promise<boolean> {
  const normalizedPin = String(adminPin || "").trim();
  if (!/^\d{5}$/.test(normalizedPin)) return false;

  const correctPin = await getAdminPinForVerification();
  if (correctPin && normalizedPin === correctPin) {
    return true;
  }

  const user = await storage.verifyUserPin(normalizedPin);
  if (user && String(user.role || "").trim().toLowerCase() === "admin") {
    return true;
  }

  const staffMember = await storage.verifyStaffMemberPin(normalizedPin);
  if (
    staffMember &&
    String(staffMember.roleType || "").trim().toLowerCase() === "admin"
  ) {
    return true;
  }

  return false;
}

function extractAdminCredentials(req: Request): {
  adminPin: string;
  adminPassword: string;
} {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const headerPin = req.get("X-Admin-Pin") || req.get("x-admin-pin") || "";
  const headerPassword =
    req.get("X-Admin-Password") || req.get("x-admin-password") || "";

  const rawAdminPin = String(
    body.adminPin ?? query.adminPin ?? headerPin ?? "",
  ).trim();
  const adminPassword = String(
    body.adminPassword ?? query.adminPassword ?? headerPassword ?? "",
  ).trim();
  const adminPin =
    rawAdminPin ||
    (/^\d{5}$/.test(adminPassword) ? adminPassword : "");

  return { adminPin, adminPassword };
}

async function resolveOrderEditPinAccess(
  pin: string,
): Promise<{ level: "admin" | "counter"; name: string } | null> {
  const normalizedPin = String(pin || "").trim();
  if (!/^\d{5}$/.test(normalizedPin)) {
    return null;
  }

  const adminUser = await storage.getUserByUsername("admin");
  const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "00000";
  if (adminPin && normalizedPin === adminPin) {
    return {
      level: "admin",
      name: adminUser?.name || adminUser?.username || "Admin",
    };
  }

  const user = await storage.verifyUserPin(normalizedPin);
  if (user) {
    const normalizedRole = String(user.role || "").toLowerCase();
    if (normalizedRole === "admin") {
      return {
        level: "admin",
        name: user.name || user.username || "Admin",
      };
    }
    if (normalizedRole === "counter" || normalizedRole === "reception") {
      return {
        level: "counter",
        name: user.name || user.username || "Counter",
      };
    }
  }

  const staffMember = await storage.verifyStaffMemberPin(normalizedPin);
  if (staffMember) {
    const normalizedRole = String(staffMember.roleType || "").toLowerCase();
    if (normalizedRole === "admin") {
      return {
        level: "admin",
        name: staffMember.name || "Admin",
      };
    }
    if (normalizedRole === "counter") {
      return {
        level: "counter",
        name: staffMember.name || "Counter",
      };
    }
  }

  return null;
}

function getAdminOrCounterPinCandidate(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const headerStaffPin = req.get("X-Staff-Pin") || req.get("x-staff-pin") || "";
  const headerAdminPin = req.get("X-Admin-Pin") || req.get("x-admin-pin") || "";

  const candidates = [
    body.staffPin,
    body.adminPin,
    body.pin,
    headerStaffPin,
    headerAdminPin,
  ];
  const candidate = candidates.find((value) => String(value || "").trim().length > 0);
  return String(candidate || "").trim();
}

async function resolveAdminOrCounterPinFromRequest(
  req: Request,
): Promise<{ level: "admin" | "counter"; name: string } | null> {
  return resolveOrderEditPinAccess(getAdminOrCounterPinCandidate(req));
}

async function resolveBulkOrderStageActorByPin(
  staffPin: string,
): Promise<{ id: number; name: string; roleType: string } | null> {
  const normalizedPin = String(staffPin || "").trim();
  if (!/^\d{5}$/.test(normalizedPin)) {
    return null;
  }

  const adminUser = await storage.getUserByUsername("admin");
  const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "00000";
  if (adminPin && normalizedPin === String(adminPin)) {
    return {
      id: 0,
      name: adminUser?.name || adminUser?.username || "Admin",
      roleType: "admin",
    };
  }

  const staffMember = await storage.verifyStaffMemberPin(normalizedPin);
  if (!staffMember) {
    return null;
  }

  return {
    id: staffMember.id,
    name: staffMember.name || "Unknown",
    roleType: staffMember.roleType || "staff",
  };
}

async function resolveDeliveryActorByPin(
  pin: string,
): Promise<{ id: number | null; name: string; role: string; isUser: boolean } | null> {
  const normalizedPin = String(pin || "").trim();
  if (!/^\d{5}$/.test(normalizedPin)) {
    return null;
  }

  const adminUser = await storage.getUserByUsername("admin");
  const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "";
  if (adminPin && normalizedPin === adminPin) {
    return {
      id: adminUser?.id || null,
      name: adminUser?.name || adminUser?.username || "Admin",
      role: "admin",
      isUser: true,
    };
  }

  const user = await storage.verifyUserPin(normalizedPin);
  if (user) {
    return {
      id: user.id,
      name: user.name || user.username || "Staff",
      role: user.role || "staff",
      isUser: true,
    };
  }

  const staffMember = await storage.verifyStaffMemberPin(normalizedPin);
  if (staffMember) {
    return {
      id: staffMember.id,
      name: staffMember.name || "Staff",
      role: staffMember.roleType || "staff",
      isUser: false,
    };
  }

  const deliveryWorker = await storage.verifyDeliveryWorkerPin(normalizedPin);
  if (deliveryWorker) {
    return {
      id: deliveryWorker.id,
      name: deliveryWorker.name || "Staff",
      role: "driver",
      isUser: false,
    };
  }

  return null;
}

function resolveOrderDateShiftOptions(payload: any): {
  tag: boolean;
  pack: boolean;
  delivery: boolean;
} {
  const parseBooleanLike = (value: unknown): boolean | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    }
    return Boolean(value);
  };

  const defaultShiftValue =
    payload?.shiftStageDates === undefined
      ? true
      : parseBooleanLike(payload.shiftStageDates) ?? true;

  const resolveOption = (value: unknown) =>
    value === undefined ? defaultShiftValue : parseBooleanLike(value) ?? defaultShiftValue;

  return {
    tag: resolveOption(payload?.shiftTagDate),
    pack: resolveOption(payload?.shiftPackDate),
    delivery: resolveOption(payload?.shiftDeliveryDate),
  };
}

function shiftTimestampByDelta(
  value: string | Date | null | undefined,
  deltaMs: number,
): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + deltaMs).toISOString();
}

function syncTimestampTimeOnly(
  value: string | Date | null | undefined,
  timeSource: Date,
): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const next = new Date(parsed);
  next.setHours(
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
    timeSource.getMilliseconds(),
  );
  return next.toISOString();
}

function buildOrderDateEditUpdates(
  order: any,
  targetDate: Date,
  stageShiftOptions: { tag: boolean; pack: boolean; delivery: boolean },
): {
  updates: Record<string, string>;
  oldDate: Date;
  resultingEntryDate: Date;
  deltaMs: number;
  entryDateChanged: boolean;
} {
  const oldDate = new Date(order.entryDate);
  const entryDateChanged = stageShiftOptions.tag;
  const resultingEntryDate = entryDateChanged ? targetDate : new Date(oldDate);
  const deltaMs = entryDateChanged ? targetDate.getTime() - oldDate.getTime() : 0;
  const updates: Record<string, string> = {};

  if (entryDateChanged) {
    updates.entryDate = targetDate.toISOString();
  }

  const assignShiftedValue = (field: string, value: string | Date | null | undefined) => {
    const nextValue = shiftTimestampByDelta(value, deltaMs);
    if (nextValue) {
      updates[field] = nextValue;
    }
  };

  const assignTimeOnlyValue = (field: string, value: string | Date | null | undefined) => {
    const nextValue = syncTimestampTimeOnly(value, targetDate);
    if (nextValue) {
      updates[field] = nextValue;
    }
  };

  const assignTargetValue = (field: string, value: string | Date | null | undefined) => {
    if (!value) {
      return;
    }
    updates[field] = targetDate.toISOString();
  };

  if (stageShiftOptions.tag) {
    assignShiftedValue("tagDate", order.tagDate);
  }

  if (stageShiftOptions.pack) {
    if (entryDateChanged) {
      assignShiftedValue("washingDate", order.washingDate);
      assignShiftedValue("packingDate", order.packingDate);
    } else {
      assignTargetValue("washingDate", order.washingDate);
      assignTargetValue("packingDate", order.packingDate);
    }
  } else if (entryDateChanged) {
    assignTimeOnlyValue("washingDate", order.washingDate);
    assignTimeOnlyValue("packingDate", order.packingDate);
  }

  if (stageShiftOptions.delivery) {
    if (entryDateChanged) {
      assignShiftedValue("deliveryDate", order.deliveryDate);
      assignShiftedValue("expectedDeliveryAt", order.expectedDeliveryAt);
    } else {
      assignTargetValue("deliveryDate", order.deliveryDate);
      assignTargetValue("expectedDeliveryAt", order.expectedDeliveryAt);
    }
  } else if (entryDateChanged) {
    assignTimeOnlyValue("deliveryDate", order.deliveryDate);
    assignTimeOnlyValue("expectedDeliveryAt", order.expectedDeliveryAt);
  }

  return { updates, oldDate, resultingEntryDate, deltaMs, entryDateChanged };
}

function parseTimestampOrNull(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getUpdatedTimestamp(
  order: any,
  updates: Record<string, string>,
  field: string,
): Date | null {
  const nextValue =
    Object.prototype.hasOwnProperty.call(updates, field) ? updates[field] : order?.[field];
  return parseTimestampOrNull(nextValue);
}

function validateOrderDateEditTimeline(
  order: any,
  updates: Record<string, string>,
): string | null {
  const entryDate = getUpdatedTimestamp(order, updates, "entryDate");
  const packingDate = getUpdatedTimestamp(order, updates, "packingDate");
  const deliveryDate = getUpdatedTimestamp(order, updates, "deliveryDate");

  if (entryDate && packingDate && packingDate.getTime() < entryDate.getTime()) {
    return "Ready date/time would become earlier than entry date/time. Also check Pack or choose a different date/time.";
  }

  if (packingDate && deliveryDate && deliveryDate.getTime() < packingDate.getTime()) {
    return "Delivery date/time would become earlier than ready date/time. Also check Delivery or choose a later date/time.";
  }

  return null;
}

type PeriodicOrderDeletionPeriod = "weekly" | "monthly" | "yearly" | "custom";

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDateOnlyInput(value: string, endOfDay = false): Date | null {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return endOfDay ? endOfLocalDay(parsed) : startOfLocalDay(parsed);
}

function formatDeletionRangeDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function resolvePeriodicOrderDeletionRange(
  period: string,
  startDate?: string,
  endDate?: string,
): { start: Date; end: Date; label: string } {
  const normalizedPeriod = String(period || "").trim().toLowerCase() as PeriodicOrderDeletionPeriod;

  if (!["weekly", "monthly", "yearly", "custom"].includes(normalizedPeriod)) {
    throw new Error("Invalid deletion period");
  }

  if (startDate || endDate) {
    const parsedStart = parseDateOnlyInput(String(startDate || ""));
    const parsedEnd = parseDateOnlyInput(String(endDate || ""), true);

    if (!parsedStart || !parsedEnd) {
      throw new Error("Valid startDate and endDate are required for deletion");
    }

    if (parsedEnd.getTime() < parsedStart.getTime()) {
      throw new Error("Deletion endDate cannot be before startDate");
    }

    const label =
      normalizedPeriod === "weekly"
        ? "selected week"
        : normalizedPeriod === "monthly"
          ? "selected month"
          : normalizedPeriod === "yearly"
            ? "selected year"
            : "custom range";

    return { start: parsedStart, end: parsedEnd, label };
  }

  const now = new Date();

  if (normalizedPeriod === "weekly") {
    const start = startOfLocalDay(now);
    start.setDate(start.getDate() - start.getDay());
    return { start, end: endOfLocalDay(now), label: "this week" };
  }

  if (normalizedPeriod === "monthly") {
    const start = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return { start, end: endOfLocalDay(now), label: "this month" };
  }

  if (normalizedPeriod === "yearly") {
    const start = startOfLocalDay(new Date(now.getFullYear(), 0, 1));
    return { start, end: endOfLocalDay(now), label: "this year" };
  }

  if (normalizedPeriod === "custom") {
    const parsedStart = parseDateOnlyInput(String(startDate || ""));
    const parsedEnd = parseDateOnlyInput(String(endDate || ""), true);

    if (!parsedStart || !parsedEnd) {
      throw new Error("Valid startDate and endDate are required for custom deletion");
    }

    if (parsedEnd.getTime() < parsedStart.getTime()) {
      throw new Error("Custom deletion endDate cannot be before startDate");
    }

    return { start: parsedStart, end: parsedEnd, label: "custom range" };
  }

  throw new Error("Valid startDate and endDate are required for custom deletion");
}

async function deleteOrderWithLinkedRecords(
  orderId: number,
  logContext = "DELETE ORDER",
): Promise<{ deleted: boolean; orderNumber?: string | null }> {
  const order = await storage.getOrder(orderId);
  if (!order) {
    return { deleted: false };
  }

  await storage.deductStockForOrder(orderId);

  if (order.billId) {
    let deletedClientTransactions = false;

    try {
      const bill = await storage.getBill(order.billId);
      if (bill && bill.clientId) {
        const paidAmount = parseFloat(bill.paidAmount || "0");

        if (paidAmount > 0) {
          const payments = await db.select().from(billPayments).where(eq(billPayments.billId, order.billId));
          let depositPaid = 0;

          for (const payment of payments) {
            if (payment.paymentMethod === "deposit" || payment.paymentMethod === "bulk_deposit") {
              depositPaid += parseFloat(payment.amount || "0");
            }
          }

          const txns = await db.select().from(clientTransactions).where(eq(clientTransactions.clientId, bill.clientId));
          for (const txn of txns) {
            if (
              (txn.type === "deposit_used" || txn.type === "bulk_deposit_used") &&
              txn.description?.includes(`Bill #${order.billId}`)
            ) {
              depositPaid = Math.max(depositPaid, parseFloat(txn.amount || "0"));
            }
          }

          if (depositPaid > 0) {
            const client = await storage.getClient(bill.clientId);
            if (client) {
              const currentDeposit = parseFloat(client.deposit || "0");
              const newDeposit = currentDeposit + depositPaid;
              const currentAmount = parseFloat(client.amount || "0");
              const newBalance = currentAmount - newDeposit;

              await storage.updateClient(bill.clientId, {
                deposit: newDeposit.toFixed(2),
                balance: newBalance.toFixed(2),
              });
            }
          }
        }

        const allTxns = await db.select().from(clientTransactions).where(eq(clientTransactions.clientId, bill.clientId));
        for (const txn of allTxns) {
          if (
            txn.billId === order.billId ||
            txn.description?.includes(`Bill #${order.billId}:`) ||
            txn.description?.includes(`Bill #${order.billId} `)
          ) {
            await db.delete(clientTransactions).where(eq(clientTransactions.id, txn.id));
            deletedClientTransactions = true;
          }
        }
      }

      await db.delete(billPayments).where(eq(billPayments.billId, order.billId));
      await storage.deleteBill(order.billId);
    } catch (err) {
      console.error(`[${logContext}] Error cleaning up bill/transactions for order ${orderId}:`, err);
    }

    if (deletedClientTransactions) {
      storage.notifyLiveResourceUpdated("clientTransactions");
    }
  }

  await storage.deleteOrder(orderId);
  return { deleted: true, orderNumber: order.orderNumber };
}

async function deleteAllOrdersWithLinkedRecords(
  logContext = "DELETE ALL ORDERS",
): Promise<number> {
  const allOrders = (await storage.getOrders()).sort((left, right) => {
    const leftTime = left.entryDate ? new Date(left.entryDate).getTime() : 0;
    const rightTime = right.entryDate ? new Date(right.entryDate).getTime() : 0;
    return leftTime - rightTime;
  });

  let deleted = 0;

  for (const order of allOrders) {
    const result = await deleteOrderWithLinkedRecords(order.id, logContext);
    if (result.deleted) {
      deleted += 1;
    }
  }

  return deleted;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  const CREDIT_MANAGEMENT_TRANSACTION_TYPES = [
    "deposit",
    "deposit_used",
    "bulk_deposit_used",
  ] as const;
  const LEGACY_CREDIT_MANAGEMENT_SOURCE_TYPES = ["payment", "bulk_payment"] as const;
  const CREDIT_MANAGEMENT_EPSILON = 0.01;
  const CREDIT_MANAGEMENT_LEGACY_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

  const resolveProcessedByFromPin = async (pin?: string | null) => {
    const normalizedPin = String(pin || "").trim();
    if (!/^\d{5}$/.test(normalizedPin)) {
      return null;
    }

    const adminUser = await storage.getUserByUsername("admin");
    const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "";
    if (adminPin && normalizedPin === adminPin) {
      return adminUser?.name || adminUser?.username || "Admin";
    }

    const user = await storage.verifyUserPin(normalizedPin);
    if (user) {
      return user.name || user.username || "Staff";
    }

    const staffMember = await storage.verifyStaffMemberPin(normalizedPin);
    if (staffMember) {
      return staffMember.name || "Staff";
    }

    const packingWorker = await storage.verifyPackingWorkerPin(normalizedPin);
    if (packingWorker) {
      return packingWorker.name || "Staff";
    }

    const deliveryWorker = await storage.verifyDeliveryWorkerPin(normalizedPin);
    if (deliveryWorker) {
      return deliveryWorker.name || "Staff";
    }

    return null;
  };

  const normalizeCreditManagementPaymentMethod = (value?: string | null) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "bulk_deposit") return "deposit";
    if (normalized === "transfer") return "bank";
    return normalized;
  };

  const collectCreditManagementBillIds = (value?: string | null) =>
    Array.from(
      new Set(
        (String(value || "").match(/#(\d+)/g) || [])
          .map((token) => Number(token.replace("#", "")))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );

  const collectCreditManagementOrderNumbers = (value?: string | null) =>
    Array.from(
      new Set(
        (String(value || "").toUpperCase().match(/ORD-[A-Z0-9-]+/g) || []).map((entry) =>
          entry.trim(),
        ),
      ),
    );

  const normalizeLegacyCreditManagementDescription = (
    description: string | null | undefined,
    type: string,
    billId: number | null,
  ) => {
    const fallback =
      type === "bulk_deposit_used"
        ? "Bulk credit payment"
        : billId
          ? `Deposit used for Bill #${billId}`
          : "Deposit used from account credit";
    const text = String(description || "").trim();
    if (!text) {
      return fallback;
    }

    const normalized = text.replace(/Payment for Bill/gi, "Deposit used for Bill");
    if (type === "bulk_deposit_used") {
      return normalized.replace(/^Bulk payment\b/gi, "Bulk credit payment");
    }

    return normalized;
  };

  const isLegacyCreditManagementTransaction = (transaction: {
    type: string;
    paymentMethod?: string | null;
    billPaymentMethod?: string | null;
    description?: string | null;
  }) => {
    if (!LEGACY_CREDIT_MANAGEMENT_SOURCE_TYPES.includes(transaction.type as any)) {
      return false;
    }

    const normalizedPaymentMethod = normalizeCreditManagementPaymentMethod(transaction.paymentMethod);
    if (normalizedPaymentMethod === "deposit") {
      return true;
    }

    const normalizedBillPaymentMethod = normalizeCreditManagementPaymentMethod(transaction.billPaymentMethod);
    if (normalizedBillPaymentMethod === "deposit") {
      return true;
    }

    const description = String(transaction.description || "").trim().toLowerCase();
    return description.startsWith("deposit used") || description.includes("-> account credit");
  };

  const getNormalizedCreditManagementType = (transactionType: string) =>
    transactionType === "bulk_payment" ? "bulk_deposit_used" : "deposit_used";

  const creditManagementTargetsMatch = (
    left: { billId: number | null; description?: string | null },
    right: { billId: number | null; description?: string | null },
  ) => {
    const leftBillIds =
      left.billId != null ? [left.billId] : collectCreditManagementBillIds(left.description);
    const rightBillIds =
      right.billId != null ? [right.billId] : collectCreditManagementBillIds(right.description);

    if (leftBillIds.length > 0 || rightBillIds.length > 0) {
      return leftBillIds.some((billId) => rightBillIds.includes(billId));
    }

    const leftOrderNumbers = collectCreditManagementOrderNumbers(left.description);
    const rightOrderNumbers = collectCreditManagementOrderNumbers(right.description);
    return leftOrderNumbers.some((orderNumber) => rightOrderNumbers.includes(orderNumber));
  };

  const shiftCreditManagementDatesForBill = async (
    billId: number | null | undefined,
    deltaMs: number,
  ): Promise<boolean> => {
    if (!billId || !Number.isFinite(deltaMs) || deltaMs === 0) {
      return false;
    }

    const relatedTransactions = await db
      .select({
        id: clientTransactions.id,
        date: clientTransactions.date,
      })
      .from(clientTransactions)
      .where(
        and(
          eq(clientTransactions.billId, billId),
          or(
            eq(clientTransactions.type, CREDIT_MANAGEMENT_TRANSACTION_TYPES[0]),
            eq(clientTransactions.type, CREDIT_MANAGEMENT_TRANSACTION_TYPES[1]),
            eq(clientTransactions.type, CREDIT_MANAGEMENT_TRANSACTION_TYPES[2]),
          ),
        ),
      );

    let updated = false;

    for (const transaction of relatedTransactions) {
      const currentDate = new Date(transaction.date);
      if (Number.isNaN(currentDate.getTime())) {
        continue;
      }

      await db
        .update(clientTransactions)
        .set({ date: new Date(currentDate.getTime() + deltaMs) } as any)
        .where(eq(clientTransactions.id, transaction.id));
      updated = true;
    }

    return updated;
  };

  // Run seed and migrations in background (non-blocking) so the server port opens quickly
  const logStartupMigrationError = (label: string, error: unknown) => {
    console.log(`${label}: ${formatErrorMessage(error)}`);
  };

  const ensureStartupDatabaseAccess = async (): Promise<boolean> => {
    try {
      await db.execute(sql`select 1`);
      return true;
    } catch (error) {
      const message = formatErrorMessage(error);
      if (isDatabaseConnectionError(error)) {
        console.log(`Startup migrations skipped: database unavailable (${message})`);
      } else {
        console.log(`Startup migration preflight error: ${message}`);
      }
      return false;
    }
  };

  const ensureDeliveryChargeColumns = async (): Promise<void> => {
    await db.execute(sql`
      ALTER TABLE bills
      ADD COLUMN IF NOT EXISTS delivery_charge numeric(12, 2) DEFAULT '0'
    `);

    await db.execute(sql`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_charge numeric(12, 2) DEFAULT '0'
    `);
  };

  let deliveryChargeSchemaReady = false;
  if (await ensureStartupDatabaseAccess()) {
    try {
      await ensureDeliveryChargeColumns();
      deliveryChargeSchemaReady = true;
      console.log("Delivery charge schema migration completed");
    } catch (err) {
      logStartupMigrationError("Delivery charge schema migration error", err);
    }
  }

  const runStartupMigrations = async () => {
    if (!(await ensureStartupDatabaseAccess())) {
      return;
    }

    if (!deliveryChargeSchemaReady) {
      try {
        await ensureDeliveryChargeColumns();
        deliveryChargeSchemaReady = true;
        console.log("Delivery charge schema migration completed");
      } catch (err) {
        logStartupMigrationError("Delivery charge schema migration error", err);
        return;
      }
    }

    try {
      await ensureMultiTenantFoundation();
    } catch (err) {
      logStartupMigrationError("Multi-business foundation migration error", err);
      return;
    }

    if (process.env.ENABLE_LEGACY_STARTUP_SEED === "true") {
      try {
        await seedDatabase();
      } catch (err) {
        logStartupMigrationError("Seed error", err);
      }
    }

  try {
    const result = await db.execute(sql`
      with updated as (
        update clients
        set
          phone = case
            when trim(coalesce(phone, '')) in ('', '-')
              or (
                regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> ''
                and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^0+$'
              )
            then null
            else phone
          end,
          address = case
            when trim(coalesce(address, '')) = '-' then null
            else address
          end
        where
          trim(coalesce(phone, '')) in ('', '-')
          or (
            regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> ''
            and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') ~ '^0+$'
          )
          or trim(coalesce(address, '')) = '-'
        returning id
      )
      select count(*)::int as count from updated
    `);
    const cleanedCount = Number(((result as any)?.rows || [])[0]?.count || 0);
    if (cleanedCount > 0) {
      console.log(`Client details cleanup migration: cleaned ${cleanedCount} client(s)`);
    } else {
      console.log("Client details cleanup migration: already clean");
    }
  } catch (err) {
    logStartupMigrationError("Client details cleanup migration error", err);
  }

  // Ensure audit table exists for immutable order-date change tracking.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS order_date_change_audit (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        order_number TEXT NOT NULL,
        old_entry_date TIMESTAMP NOT NULL,
        new_entry_date TIMESTAMP NOT NULL,
        delta_minutes INTEGER NOT NULL,
        changed_by TEXT,
        reason TEXT,
        changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        bulk_group TEXT
      )
    `);
  } catch (err) {
    logStartupMigrationError("Order-date audit table setup error", err);
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS product_category_settings (
        id SERIAL PRIMARY KEY,
        base_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        custom_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        inventory_display_order TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        order_display_order TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    logStartupMigrationError("Product category settings table setup error", err);
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS company_contact_settings (
        id SERIAL PRIMARY KEY,
        company_name TEXT NOT NULL DEFAULT 'Liquid Washes Laundry',
        tagline TEXT DEFAULT 'Smartness Partners',
        telephone TEXT DEFAULT '026 815 824',
        mobile_phone TEXT DEFAULT '+971 56 338 0001',
        whatsapp_phone TEXT DEFAULT '+971 56 338 0001',
        email TEXT DEFAULT 'info@lwl.ae',
        website TEXT DEFAULT 'www.lwl.ae',
        address_line_1 TEXT DEFAULT 'Central Market D/109',
        address_line_2 TEXT DEFAULT 'Al Dhanna City, Al Ruwais',
        address_line_3 TEXT DEFAULT 'Abu Dhabi - UAE',
        dashboard_clock_hour12 BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE company_contact_settings
      ADD COLUMN IF NOT EXISTS dashboard_clock_hour12 BOOLEAN NOT NULL DEFAULT TRUE
    `);
  } catch (err) {
    logStartupMigrationError("Company contact settings table setup error", err);
  }

  try {
    await ensureAppSecuritySettingsTable();
  } catch (err) {
    logStartupMigrationError("App security settings table setup error", err);
  }

  // One-time migration: move orders to correct dates
  try {
    const migrations = [
      {
        orderNumber: "ORD-609746",
        newEntryDate: new Date("2026-02-22T16:44:32.582Z"),
        newTagDate: new Date("2026-02-22T16:45:32.582Z"),
        newPackingDate: new Date("2026-02-22T16:46:32.582Z"),
        newDeliveryDate: new Date("2026-02-22T16:47:32.582Z"),
      },
      {
        orderNumber: "ORD-275399",
        newEntryDate: new Date("2026-02-20T04:04:35.571Z"),
        newTagDate: new Date("2026-02-20T04:04:35.649Z"),
        newPackingDate: new Date("2026-02-20T04:05:39.286Z"),
        newDeliveryDate: new Date("2026-02-20T04:05:49.002Z"),
      },
    ];
    let moved = 0;
    for (const cfg of migrations) {
      const matchOrders = await db.select().from(orders).where(eq(orders.orderNumber, cfg.orderNumber));
      if (matchOrders.length > 0) {
        const ord = matchOrders[0];
        const currentEntry = new Date(ord.entryDate!).toISOString();
        if (currentEntry !== cfg.newEntryDate.toISOString()) {
          const updateFields: any = { entryDate: cfg.newEntryDate };
          if (cfg.newTagDate) updateFields.tagDate = cfg.newTagDate;
          if (cfg.newPackingDate) updateFields.packingDate = cfg.newPackingDate;
          if (cfg.newDeliveryDate) updateFields.deliveryDate = cfg.newDeliveryDate;
          await db.update(orders).set(updateFields).where(eq(orders.id, ord.id));
          if (ord.billId) {
            await db.update(bills).set({ billDate: cfg.newEntryDate } as any).where(eq(bills.id, ord.billId));
          }
          moved++;
          console.log(`Reorder migration: moved ${cfg.orderNumber} to ${cfg.newEntryDate.toISOString()}`);
        } else {
          console.log(`Reorder migration: ${cfg.orderNumber} already correct`);
        }
      } else {
        console.log(`Reorder migration: ${cfg.orderNumber} not found`);
      }
    }
    console.log(`Reorder migration complete: ${moved} orders updated`);
  } catch (err) {
    logStartupMigrationError("Reorder migration error", err);
  }

  // One-time migration: fix bill #1110 (FAISAL, clientId 488) - actual price 16 AED, paid 20 AED, 4 AED credit
  try {
    const overpayBillId = 1110;
    const overpayClientId = 488;
    const [bill1110] = await db.select().from(bills).where(eq(bills.id, overpayBillId));
    if (bill1110) {
      const currentBillAmt = parseFloat(bill1110.amount);
      const currentPaid = parseFloat(bill1110.paidAmount || "0");
      const correctBillAmt = 16.00;
      const actualPaid = 20.00;
      const overpayment = actualPaid - correctBillAmt;
      // Check if already migrated (deposit > 0 means done)
      const [client488] = await db.select().from(clients).where(eq(clients.id, overpayClientId));
      if (client488 && parseFloat(client488.deposit || "0") < 3.99) {
        // Update bill amount to correct 16 AED, paidAmount to 16 (capped)
        await db.update(bills).set({ amount: correctBillAmt.toFixed(2), paidAmount: correctBillAmt.toFixed(2) } as any).where(eq(bills.id, overpayBillId));
        // Update order totalAmount and finalAmount too
        const [billOrder] = await db.select().from(orders).where(eq(orders.billId, overpayBillId));
        if (billOrder) {
          await db.update(orders).set({ totalAmount: correctBillAmt.toFixed(2), finalAmount: correctBillAmt.toFixed(2), paidAmount: correctBillAmt.toFixed(2) } as any).where(eq(orders.id, billOrder.id));
        }
        // Add 4 AED credit to client
        const currentDeposit = parseFloat(client488.deposit || "0");
        const newDeposit = currentDeposit + overpayment;
        await db.update(clients).set({ deposit: newDeposit.toFixed(2) } as any).where(eq(clients.id, overpayClientId));
        const orderRef = billOrder ? `Order #${billOrder.orderNumber}` : `Bill #${overpayBillId}`;
        // Update existing payment transaction to show 20 AED
        await db.update(clientTransactions).set({
          amount: actualPaid.toFixed(2),
          description: `Payment for Bill #${overpayBillId}: ${bill1110.description || "N/A"}`,
        } as any).where(and(eq(clientTransactions.clientId, overpayClientId), eq(clientTransactions.billId, overpayBillId), eq(clientTransactions.type, "payment")));
        // Create credit transaction
        await db.insert(clientTransactions).values({
          clientId: overpayClientId,
          billId: overpayBillId,
          type: "deposit",
          amount: overpayment.toFixed(2),
          description: `Credit added from overpayment on ${orderRef} (paid ${actualPaid.toFixed(2)} on ${correctBillAmt.toFixed(2)} AED bill)`,
          date: new Date(),
          runningBalance: "0",
          paymentMethod: "cash",
        });
        console.log(`Overpayment migration: Bill #1110 corrected to ${correctBillAmt} AED, added ${overpayment.toFixed(2)} AED credit to FAISAL`);
      } else {
        console.log("Overpayment migration: bill #1110 already migrated");
      }
    }
  } catch (err) {
    logStartupMigrationError("Overpayment migration error", err);
  }

  // One-time migration: move 4 bill payment dates to Feb 26 UAE time
  try {
    const paymentIdsToFix = [367, 368, 369, 370];
    const feb26Date = new Date("2026-02-26T14:00:00.000Z"); // Feb 26 18:00 UAE time (UTC+4)
    const [firstPayment] = await db.select().from(billPayments).where(eq(billPayments.id, 367));
    if (firstPayment) {
      const payDate = new Date(firstPayment.paymentDate);
      // Check if payment is after 20:00 UTC on Feb 26 (which is after midnight UAE time = Feb 27 UAE)
      if (payDate.getUTCHours() >= 20 && payDate.getUTCDate() === 26) {
        for (const pid of paymentIdsToFix) {
          await db.update(billPayments).set({ paymentDate: feb26Date } as any).where(eq(billPayments.id, pid));
        }
        const billIdsToFix = [1073, 1109, 1132, 1158];
        for (const bid of billIdsToFix) {
          await db.update(clientTransactions).set({ date: feb26Date } as any).where(
            and(eq(clientTransactions.billId, bid), eq(clientTransactions.type, "payment"))
          );
        }
        console.log("Payment date migration: moved 4 bill payments to Feb 26 UAE time");
      } else {
        console.log("Payment date migration: already on correct date");
      }
    }
  } catch (err) {
    logStartupMigrationError("Payment date migration error", err);
  }

  // One-time migration: fix double payments on bills #1231 (OMAR OBEID) and #672 (ALI)
  try {
    const [dupPayment1231] = await db.select().from(billPayments).where(eq(billPayments.id, 408));
    if (dupPayment1231 && dupPayment1231.billId === 1231) {
      await db.delete(billPayments).where(eq(billPayments.id, 408));
      const [dupTx426] = await db.select().from(clientTransactions).where(eq(clientTransactions.id, 426));
      if (dupTx426) await db.delete(clientTransactions).where(eq(clientTransactions.id, 426));
      const [depositTx427] = await db.select().from(clientTransactions).where(eq(clientTransactions.id, 427));
      if (depositTx427) await db.delete(clientTransactions).where(eq(clientTransactions.id, 427));
      await db.update(clients).set({ deposit: "0.00" } as any).where(eq(clients.id, 704));
      console.log("Migration: fixed OMAR OBEID duplicate payment on bill #1231");
    }
    const [dupPayment672] = await db.select().from(billPayments).where(eq(billPayments.id, 376));
    if (dupPayment672 && dupPayment672.billId === 672) {
      await db.delete(billPayments).where(eq(billPayments.id, 376));
      const [dupTx393] = await db.select().from(clientTransactions).where(eq(clientTransactions.id, 393));
      if (dupTx393) await db.delete(clientTransactions).where(eq(clientTransactions.id, 393));
      const [depositTx394] = await db.select().from(clientTransactions).where(eq(clientTransactions.id, 394));
      if (depositTx394) await db.delete(clientTransactions).where(eq(clientTransactions.id, 394));
      await db.update(clients).set({ deposit: "0.00" } as any).where(eq(clients.id, 583));
      console.log("Migration: fixed ALI duplicate payment on bill #672");
    }
  } catch (err) {
    logStartupMigrationError("Double payment migration error", err);
  }

  // One-time migration: sync client transaction dates with bill payment dates
  // Previously, moving bill payment dates only updated "deposit" type transactions,
  // missing "payment", "deposit_used", "bulk_deposit_used" types used by Total Sales table
  try {
    const allNonBillTxs = await db.select().from(clientTransactions).where(
      not(eq(clientTransactions.type, "bill"))
    );
    let syncCount = 0;
    for (const tx of allNonBillTxs) {
      if (!tx.billId) continue;
      const paymentsForBill = await db.select().from(billPayments).where(
        eq(billPayments.billId, tx.billId)
      );
      if (paymentsForBill.length === 0) continue;
      const txDate = new Date(tx.date);
      let closestPayment = paymentsForBill[0];
      let closestDiff = Math.abs(txDate.getTime() - new Date(closestPayment.paymentDate).getTime());
      for (let i = 1; i < paymentsForBill.length; i++) {
        const diff = Math.abs(txDate.getTime() - new Date(paymentsForBill[i].paymentDate).getTime());
        if (diff < closestDiff) {
          closestDiff = diff;
          closestPayment = paymentsForBill[i];
        }
      }
      const targetDate = new Date(closestPayment.paymentDate);
      if (closestDiff > 60000) {
        await db.update(clientTransactions)
          .set({ date: targetDate } as any)
          .where(eq(clientTransactions.id, tx.id));
        syncCount++;
      }
    }
    if (syncCount > 0) {
      console.log(`Transaction date sync migration: updated ${syncCount} transaction dates`);
    } else {
      console.log("Transaction date sync migration: all dates already in sync");
    }
  } catch (err) {
    logStartupMigrationError("Transaction date sync migration error", err);
  }

    console.log("Startup migrations complete");
  }; // end runStartupMigrations

  // Fire migrations in background - don't await so the server can start listening immediately
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_RUNTIME_SCHEMA_MIGRATIONS === "true"
  ) {
    runWithPlatformDatabase(runStartupMigrations).catch((err) =>
      logStartupMigrationError("Migration error", err),
    );
  }

  // Active session tracking (in-memory, stores userId -> lastActivity timestamp)
  const activeSessions = new Map<number, {
    userId: number;
    username: string;
    businessId: number | null;
    lastActivity: Date;
  }>();
  const SESSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes - user is considered offline after this

  // Force logout tracking - stores userIds that should be logged out on next heartbeat
  const forceLogoutUsers = new Set<number>();

  // SSE connections for instant logout notification
  const sseClients = new Map<number, ExpressResponse[]>();

  const isLockdownPublicApiPath = (req: Request) => {
    if (req.method === "GET" && req.path === "/api/security/lockdown") {
      return true;
    }

    if (req.method === "POST" && req.path === "/api/auth/login") {
      return true;
    }

    if (req.method === "GET" && req.path === "/api/admin/account") {
      return true;
    }

    if (req.method === "PUT" && req.path === "/api/admin/lockdown") {
      return true;
    }

    if (req.method === "POST" && req.path === "/api/admin/export-database") {
      return true;
    }

    if (req.method === "POST" && req.path === "/api/admin/import-database") {
      return true;
    }

    return false;
  };

  const publicPlatformPostPaths = new Set([
    "/api/auth/login",
    "/api/auth/forgot-password",
    "/api/auth/verify-reset-code",
    "/api/auth/reset-password",
  ]);
  const authenticatedStreamPaths = new Set([
    "/api/auth/logout-stream",
    "/api/streams/bills",
    "/api/streams/client-transactions",
    "/api/streams/product-category-settings",
  ]);
  const authenticatedAuthPaths = new Set([
    "/api/auth/logout",
    "/api/auth/heartbeat",
    "/api/auth/active-sessions",
    "/api/auth/logout-stream",
    "/api/streams/bills",
    "/api/streams/client-transactions",
    "/api/streams/product-category-settings",
  ]);

  const isPublicPlatformApiPath = (req: Request) =>
    (req.method === "POST" && publicPlatformPostPaths.has(req.path)) ||
    (req.method === "GET" && /^\/api\/orders\/public\/[^/]+$/.test(req.path));

  const sendIdentityFailure = (
    res: ExpressResponse,
    failure: { status: number; message: string },
  ) =>
    res.status(failure.status).json({
      success: false,
      message: failure.message,
    });

  const sendForceLogoutToUser = (userId: number) => {
    const clients = sseClients.get(userId);
    if (!clients || clients.length === 0) return;

    clients.forEach((client) => {
      try {
        client.write(`data: ${JSON.stringify({ type: "forceLogout" })}\n\n`);
      } catch {
        // Client disconnected.
      }
    });
  };

  const forceLogoutNonAdminSessions = () => {
    let loggedOutCount = 0;

    for (const [userId, session] of Array.from(activeSessions.entries())) {
      if (session.username === "admin") {
        continue;
      }

      forceLogoutUsers.add(userId);
      activeSessions.delete(userId);
      sendForceLogoutToUser(userId);
      loggedOutCount++;
    }

    return loggedOutCount;
  };

  app.get("/api/security/lockdown", async (_req, res) => {
    try {
      res.json(await runWithPlatformDatabase(() => getAppLockdownStatus()));
    } catch (err) {
      res.status(500).json({
        enabled: false,
        reason: "Unable to read lockdown status",
        message: formatErrorMessage(err, "Unable to read lockdown status"),
      });
    }
  });

  // Establish an immutable, server-derived database scope before any protected
  // API handler runs. PostgreSQL RLS then applies the business boundary even to
  // legacy storage helpers and direct Drizzle queries.
  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api")) {
      return next();
    }

    try {
      if (isPublicPlatformApiPath(req)) {
        await runRequestWithDatabaseScope({ platform: true }, res, next);
        return;
      }

      const resolution = await runWithPlatformDatabase(() =>
        resolveRequestIdentity(req),
      );
      if (!resolution.ok) {
        sendIdentityFailure(res, resolution);
        return;
      }

      const identity = resolution.context;
      res.locals.requestIdentity = identity;

      if (
        identity.role === "super_admin" &&
        !req.path.startsWith("/api/super-admin/") &&
        !authenticatedAuthPaths.has(req.path)
      ) {
        res.status(403).json({
          success: false,
          message: "Platform owners must use the Super Admin console for tenant data",
        });
        return;
      }

      if (
        identity.role !== "super_admin" &&
        identity.role !== "admin" &&
        (req.path.startsWith("/api/admin/") ||
          req.path === "/api/users" ||
          req.path.startsWith("/api/users/") ||
          req.path === "/api/auth/active-sessions")
      ) {
        res.status(403).json({
          success: false,
          message: "Business administrator access is required",
        });
        return;
      }

      // Streams do not issue tenant queries after authentication. Keeping them
      // outside a response-lifetime DB scope avoids reserving a pool connection
      // for the duration of an EventSource connection.
      if (authenticatedStreamPaths.has(req.path)) {
        next();
        return;
      }

      if (identity.role === "super_admin") {
        await runRequestWithDatabaseScope({ platform: true }, res, next);
        return;
      }

      await runRequestWithDatabaseScope(
        { businessId: identity.businessId as number },
        res,
        next,
      );
    } catch (error) {
      next(error);
    }
  });

  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api")) {
      return next();
    }

    try {
      const lockdownStatus = await getAppLockdownStatus();
      if (
        !lockdownStatus.enabled ||
        isLockdownPublicApiPath(req)
      ) {
        return next();
      }

      return res.status(423).json({
        success: false,
        locked: true,
        message: lockdownStatus.reason || "Page lockdown for security reasons.",
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: formatErrorMessage(err, "Unable to verify app security status"),
      });
    }
  });

  app.put("/api/admin/lockdown", async (req, res) => {
    const { enabled, adminPassword } = req.body || {};

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(403).json({
        success: false,
        message: "Admin password is required for app lockdown changes",
      });
    }

    try {
      const adminUser = await storage.getUserByUsername("admin");
      const status = await setAppLockdownStatus(
        !!enabled,
        adminUser?.name || adminUser?.username || "Admin",
      );
      let loggedOutCount = 0;

      if (status.enabled) {
        loggedOutCount = forceLogoutNonAdminSessions();
      }

      clearAppLockdownStatusCache();

      res.json({
        success: true,
        status,
        loggedOutCount,
        message: status.enabled
          ? "App lockdown is now active."
          : "App lockdown has been lifted.",
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: err?.message || "Failed to update app lockdown",
      });
    }
  });

  // SSE endpoint for logout notifications
  app.get("/api/auth/logout-stream", (req, res) => {
    const identity = res.locals.requestIdentity as TenantRequestContext | undefined;
    if (!identity) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const userId = identity.userId;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Add this client to the list
    if (!sseClients.has(userId)) {
      sseClients.set(userId, []);
    }
    sseClients.get(userId)!.push(res);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    // Check if user should already be logged out
    if (forceLogoutUsers.has(userId)) {
      res.write(`data: ${JSON.stringify({ type: "forceLogout" })}\n\n`);
      forceLogoutUsers.delete(userId);
    }

    // Send keepalive every 30 seconds to prevent proxy/connection timeouts
    const keepaliveInterval = setInterval(() => {
      try {
        res.write(`: keepalive\n\n`);
      } catch {
        clearInterval(keepaliveInterval);
      }
    }, 30000);

    // Cleanup on disconnect
    req.on("close", () => {
      clearInterval(keepaliveInterval);
      const clients = sseClients.get(userId);
      if (clients) {
        const index = clients.indexOf(res);
        if (index > -1) {
          clients.splice(index, 1);
        }
        if (clients.length === 0) {
          sseClients.delete(userId);
        }
      }
    });
  });

  // Heartbeat endpoint - called periodically by logged-in users
  app.post("/api/auth/heartbeat", async (req, res) => {
    const identity = res.locals.requestIdentity as TenantRequestContext | undefined;
    if (!identity) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const { userId, username, businessId } = identity;
    if (userId) {
      // Check if user should be force logged out
      if (forceLogoutUsers.has(userId)) {
        forceLogoutUsers.delete(userId);
        activeSessions.delete(userId);
        return res.json({ success: false, forceLogout: true, message: "Session terminated by admin" });
      }

      activeSessions.set(userId, {
        userId,
        username,
        businessId,
        lastActivity: new Date()
      });
    }
    res.json({ success: true });
  });

  // Get active sessions (for admin to see who's online)
  app.get("/api/auth/active-sessions", async (req, res) => {
    const identity = res.locals.requestIdentity as TenantRequestContext | undefined;
    if (!identity) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const now = new Date();
    const activeUserIds: number[] = [];

    // Clean up stale sessions and collect active ones
    for (const [userId, session] of Array.from(activeSessions.entries())) {
      if (now.getTime() - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
        activeSessions.delete(userId);
      } else if (
        identity.role === "super_admin" ||
        session.businessId === identity.businessId
      ) {
        activeUserIds.push(userId);
      }
    }

    res.json({ activeUserIds });
  });

  const writeSseMessage = (res: ExpressResponse, payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const registerLiveResourceStream = (path: string, resource: LiveResource) => {
    app.get(path, (_req, res) => {
      const identity = res.locals.requestIdentity as TenantRequestContext | undefined;
      if (!identity || identity.role === "super_admin" || identity.businessId === null) {
        return res.status(403).json({ message: "Tenant access is required" });
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.write("retry: 10000\n");

      writeSseMessage(res, {
        type: "connected",
        resource,
        version: storage.getLiveResourceVersion(resource),
        changedAt: new Date().toISOString(),
      });

      const unsubscribe = storage.subscribeToLiveResource(resource, (update) => {
        try {
          writeSseMessage(res, update);
        } catch {
          unsubscribe();
        }
      });

      const keepaliveInterval = setInterval(() => {
        try {
          res.write(`: keepalive ${Date.now()}\n\n`);
        } catch {
          clearInterval(keepaliveInterval);
          unsubscribe();
        }
      }, 25000);

      res.on("close", () => {
        clearInterval(keepaliveInterval);
        unsubscribe();
      });
    });
  };

  registerLiveResourceStream("/api/streams/bills", "bills");
  registerLiveResourceStream(
    "/api/streams/client-transactions",
    "clientTransactions",
  );
  registerLiveResourceStream(
    "/api/streams/product-category-settings",
    "productCategorySettings",
  );

  // Force logout all non-admin users (admin only)
  app.post("/api/admin/logout-all-users", async (req, res) => {
    const { adminPassword } = req.body;

    if (!adminPassword) {
      return res.status(400).json({ success: false, message: "Admin password required" });
    }

    // Verify admin password from database
    const adminUser = await storage.getUserByUsername("admin");
    const correctPassword = adminUser?.password || process.env.ADMIN_PASSWORD || "";

    if (adminPassword !== correctPassword) {
      return res.status(401).json({ success: false, message: "Invalid admin password" });
    }

    // Get all non-admin users and mark them for force logout
    const allUsers = await storage.getUsers();
    let loggedOutCount = 0;

    for (const user of allUsers) {
      if (user.username !== "admin" && user.role !== "admin") {
        forceLogoutUsers.add(user.id);
        activeSessions.delete(user.id);
        loggedOutCount++;

        // Send instant logout notification via SSE
        const clients = sseClients.get(user.id);
        if (clients && clients.length > 0) {
          clients.forEach(client => {
            try {
              client.write(`data: ${JSON.stringify({ type: "forceLogout" })}\n\n`);
            } catch (e) {
              // Client disconnected
            }
          });
        }
      }
    }

    res.json({
      success: true,
      message: `${loggedOutCount} user sessions logged out instantly`,
      loggedOutCount
    });
  });

  // Delete all non-admin users (admin only)
  app.post("/api/admin/delete-all-users", async (req, res) => {
    const { adminPassword } = req.body;

    if (!adminPassword) {
      return res.status(400).json({ success: false, message: "Admin password required" });
    }

    // Verify admin password from database
    const adminUser = await storage.getUserByUsername("admin");
    const correctPassword = adminUser?.password || process.env.ADMIN_PASSWORD || "";

    if (adminPassword !== correctPassword) {
      return res.status(401).json({ success: false, message: "Invalid admin password" });
    }

    // Get all non-admin users and delete them
    const allUsers = await storage.getUsers();
    let deletedCount = 0;

    for (const user of allUsers) {
      if (user.username !== "admin" && user.role !== "admin") {
        await storage.deleteUser(user.id);
        // Clean up any active sessions
        forceLogoutUsers.delete(user.id);
        activeSessions.delete(user.id);
        deletedCount++;
      }
    }

    res.json({
      success: true,
      message: `${deletedCount} user accounts deleted`,
      deletedCount
    });
  });

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    const parsedLogin = z.object({
      username: z.string().trim().min(1).max(80),
      password: z.string().min(1).max(200),
      portal: z.enum(["tenant", "super_admin"]),
    }).safeParse(req.body || {});

    if (!parsedLogin.success) {
      return res.status(400).json({
        success: false,
        message: "Username, password, and login portal are required",
      });
    }

    const { username: normalizedUsername, password, portal: requestedPortal } = parsedLogin.data;

    await ensureMultiTenantFoundation();

    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.username, normalizedUsername),
          eq(users.password, password),
          eq(users.active, true),
        ),
      );

    if (user) {
      const portalMatchesAccount = requestedPortal === "super_admin"
        ? user.role === "super_admin" && user.businessId === null
        : user.role !== "super_admin" && user.businessId !== null;
      if (!portalMatchesAccount) {
        return res.status(401).json({
          success: false,
          message: "Invalid username or password",
        });
      }

      const business = user.businessId
        ? await db
            .select()
            .from(laundryBusinesses)
            .where(eq(laundryBusinesses.id, user.businessId))
            .then((rows) => rows[0] || null)
        : null;
      if (user.businessId && !business) {
        return res.status(403).json({
          success: false,
          message: "This tenant account is not assigned to an available organization",
        });
      }
      if (business && !business.active) {
        return res.status(403).json({
          success: false,
          message: "This business account is currently suspended",
        });
      }
      if (business && user.role !== "admin") {
        const lockdownStatus = await getAppLockdownStatusForBusiness(business.id);
        if (lockdownStatus.enabled) {
          return res.status(423).json({
            success: false,
            locked: true,
            message: lockdownStatus.reason || "Page lockdown for security reasons.",
          });
        }
      }
      const token = createAuthToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        businessId: user.businessId || null,
      });

      res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: AUTH_TOKEN_TTL_MS,
      });
      res.json({
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
          businessId: user.businessId || null,
          businessName: business?.name || null,
        },
      });
    } else {
      res
        .status(401)
        .json({ success: false, message: "Invalid username or password" });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
    res.json({ success: true });
  });

  const requireSuperAdmin = (req: Request, res: ExpressResponse) => {
    const identity = res.locals.requestIdentity as TenantRequestContext | undefined;
    if (!identity) {
      res.status(401).json({ message: "Sign in as the platform owner to continue" });
      return null;
    }
    if (identity.role !== "super_admin" || identity.businessId !== null) {
      res.status(403).json({ message: "Super administrator access is required" });
      return null;
    }
    return identity;
  };

  const createBusinessInputSchema = z.object({
    name: z.string().trim().min(2, "Business name is required").max(120),
    slug: z
      .string()
      .trim()
      .min(2, "Business slug is required")
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens"),
    businessType: z.string().trim().min(2).max(80).default("laundry"),
    timezone: z.string().trim().min(3).max(80).default("Asia/Dubai"),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("AED"),
    contactEmail: z.string().trim().email().optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    adminName: z.string().trim().min(2, "Administrator name is required").max(120),
    adminUsername: z
      .string()
      .trim()
      .min(3, "Administrator username must have at least 3 characters")
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, underscores, or hyphens"),
    adminPassword: z.string().min(8, "Administrator password must have at least 8 characters").max(200),
  });

  const updateBusinessInputSchema = z.object({
    administratorId: z.coerce.number().int().positive(),
    name: z.string().trim().min(2).max(120),
    businessType: z.string().trim().min(2).max(80),
    timezone: z.string().trim().min(3).max(80),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    contactEmail: z.string().trim().email().optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    adminName: z.string().trim().min(2).max(120),
    adminUsername: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._-]+$/),
    adminPassword: z.string().min(8).max(200).optional().or(z.literal("")),
    smtpHost: z.string().trim().max(255).optional().or(z.literal("")),
    smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
    smtpSecure: z.boolean().default(false),
    smtpUser: z.string().trim().max(255).optional().or(z.literal("")),
    smtpPassword: z.string().max(500).optional().or(z.literal("")),
    smtpFrom: z.string().trim().max(255).optional().or(z.literal("")),
  });

  const tenantAccountRoleSchema = z.enum([
    "admin",
    "counter",
    "reception",
    "section",
    "driver",
  ]);

  const createTenantAccountSchema = z.object({
    name: z.string().trim().min(2, "Account name is required").max(120),
    username: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._-]+$/),
    email: z.string().trim().email().optional().or(z.literal("")),
    role: tenantAccountRoleSchema,
    password: z.string().min(8, "Password must have at least 8 characters").max(200),
    active: z.boolean().default(true),
  });

  const updateTenantAccountSchema = createTenantAccountSchema
    .omit({ password: true })
    .extend({ password: z.string().min(8).max(200).optional().or(z.literal("")) });

  const serializeManagedBusiness = (
    business: typeof laundryBusinesses.$inferSelect,
  ) => ({
    id: business.id,
    name: business.name,
    slug: business.slug,
    businessType: business.businessType,
    timezone: business.timezone,
    currency: business.currency,
    active: business.active,
    contactEmail: business.contactEmail,
    phone: business.phone,
    logoUrl: business.logoUrl,
    smtpConfigured: Boolean(
      business.smtpHost && business.smtpUser && business.smtpPasswordEncrypted,
    ),
    smtpHost: business.smtpHost,
    smtpPort: business.smtpPort,
    smtpSecure: business.smtpSecure,
    smtpUser: business.smtpUser,
    smtpFrom: business.smtpFrom,
    smtpPasswordSet: Boolean(business.smtpPasswordEncrypted),
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  });

  app.get("/api/super-admin/businesses", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    await ensureMultiTenantFoundation();

    const businessRows = await db
      .select()
      .from(laundryBusinesses)
      .orderBy(desc(laundryBusinesses.createdAt));
    const accountRows = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        businessId: users.businessId,
      })
      .from(users)
      .orderBy(users.username);

    res.json({
      businesses: businessRows.map((business) => {
        const businessAccounts = accountRows.filter(
          (account) => account.businessId === business.id,
        );
        const administrator = businessAccounts.find(
          (account) => account.role === "admin",
        );
        return {
          ...serializeManagedBusiness(business),
          accountCount: businessAccounts.length,
          administrator: administrator || null,
        };
      }),
      accounts: accountRows,
    });
  });

  app.post("/api/super-admin/businesses", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    await ensureMultiTenantFoundation();

    const parsed = createBusinessInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "Choose valid business and administrator details",
      });
    }

    try {
      const created = await db.transaction(async (tx) => {
        const [business] = await tx
          .insert(laundryBusinesses)
          .values({
            name: parsed.data.name,
            slug: parsed.data.slug,
            businessType: parsed.data.businessType,
            timezone: parsed.data.timezone,
            currency: parsed.data.currency,
            contactEmail: parsed.data.contactEmail || null,
            phone: parsed.data.phone || null,
          })
          .returning();

        const [administrator] = await tx
          .insert(users)
          .values({
            username: parsed.data.adminUsername,
            password: parsed.data.adminPassword,
            role: "admin",
            name: parsed.data.adminName,
            email: parsed.data.contactEmail || null,
            pin: "00000",
            active: true,
            businessId: business.id,
          })
          .returning({
            id: users.id,
            username: users.username,
            name: users.name,
            email: users.email,
            role: users.role,
            active: users.active,
            businessId: users.businessId,
          });

        return { business, administrator };
      });

      res.status(201).json({
        message: `${created.business.name} and its administrator account were created`,
        business: created.business,
        administrator: created.administrator,
      });
    } catch (error) {
      const message = formatErrorMessage(error);
      if (/unique|duplicate/i.test(message)) {
        return res.status(409).json({
          message: "That business slug or administrator username is already in use",
        });
      }
      res.status(500).json({ message: "Failed to create the business account" });
    }
  });

  app.patch("/api/super-admin/businesses/:id/status", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const businessId = Number(req.params.id);
    const active = req.body?.active;
    if (!Number.isInteger(businessId) || typeof active !== "boolean") {
      return res.status(400).json({ message: "Choose a valid business status" });
    }

    const [business] = await db
      .update(laundryBusinesses)
      .set({ active, updatedAt: new Date() })
      .where(eq(laundryBusinesses.id, businessId))
      .returning();

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    if (!active) {
      const tenantUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.businessId, businessId));
      for (const tenantUser of tenantUsers) {
        forceLogoutUsers.add(tenantUser.id);
        sendForceLogoutToUser(tenantUser.id);
      }
    }

    res.json({
      message: `${business.name} is now ${active ? "active" : "suspended"}`,
      business: serializeManagedBusiness(business),
    });
  });

  app.put("/api/super-admin/businesses/:id", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const businessId = Number(req.params.id);
    if (!Number.isInteger(businessId)) {
      return res.status(400).json({ message: "Choose a valid business" });
    }

    const parsed = updateBusinessInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "Choose valid account and SMTP settings",
      });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const smtpPasswordUpdate = parsed.data.smtpPassword
          ? { smtpPasswordEncrypted: encryptBusinessSecret(parsed.data.smtpPassword) }
          : {};
        const [business] = await tx
          .update(laundryBusinesses)
          .set({
            name: parsed.data.name,
            businessType: parsed.data.businessType,
            timezone: parsed.data.timezone,
            currency: parsed.data.currency,
            contactEmail: parsed.data.contactEmail || null,
            phone: parsed.data.phone || null,
            smtpHost: parsed.data.smtpHost || null,
            smtpPort: parsed.data.smtpPort,
            smtpSecure: parsed.data.smtpSecure,
            smtpUser: parsed.data.smtpUser || null,
            smtpFrom: parsed.data.smtpFrom || null,
            ...smtpPasswordUpdate,
            updatedAt: new Date(),
          })
          .where(eq(laundryBusinesses.id, businessId))
          .returning();

        if (!business) throw new Error("Business not found");

        const [administrator] = await tx
          .select()
          .from(users)
          .where(
            and(
              eq(users.id, parsed.data.administratorId),
              eq(users.businessId, businessId),
              eq(users.role, "admin"),
            ),
          )
          .limit(1);
        if (!administrator) throw new Error("Business administrator not found");

        const [updatedAdministrator] = await tx
          .update(users)
          .set({
            name: parsed.data.adminName,
            username: parsed.data.adminUsername,
            email: parsed.data.contactEmail || null,
            ...(parsed.data.adminPassword ? { password: parsed.data.adminPassword } : {}),
          })
          .where(eq(users.id, administrator.id))
          .returning({
            id: users.id,
            username: users.username,
            name: users.name,
            email: users.email,
            role: users.role,
            active: users.active,
            businessId: users.businessId,
          });

        return { business, administrator: updatedAdministrator };
      });

      forceLogoutUsers.add(result.administrator.id);
      sendForceLogoutToUser(result.administrator.id);

      res.json({
        message: `${result.business.name} account settings were updated`,
        business: serializeManagedBusiness(result.business),
        administrator: result.administrator,
      });
    } catch (error) {
      const message = formatErrorMessage(error);
      if (/unique|duplicate/i.test(message)) {
        return res.status(409).json({ message: "That administrator username is already in use" });
      }
      if (/not found/i.test(message)) {
        return res.status(404).json({ message });
      }
      res.status(500).json({ message: "Failed to update the business account" });
    }
  });

  app.post("/api/super-admin/businesses/:id/accounts", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const businessId = Number(req.params.id);
    if (!Number.isInteger(businessId)) {
      return res.status(400).json({ message: "Choose a valid tenant" });
    }

    const parsed = createTenantAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "Choose valid account details",
      });
    }

    try {
      const [business] = await db
        .select({ id: laundryBusinesses.id, name: laundryBusinesses.name })
        .from(laundryBusinesses)
        .where(eq(laundryBusinesses.id, businessId))
        .limit(1);
      if (!business) {
        return res.status(404).json({ message: "Tenant not found" });
      }

      const [account] = await db
        .insert(users)
        .values({
          name: parsed.data.name,
          username: parsed.data.username,
          email: parsed.data.email || null,
          role: parsed.data.role,
          password: parsed.data.password,
          pin: "00000",
          active: parsed.data.active,
          businessId,
        })
        .returning({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          role: users.role,
          active: users.active,
          businessId: users.businessId,
        });

      res.status(201).json({
        message: `${account.name || account.username} was added to ${business.name}`,
        account,
      });
    } catch (error) {
      const message = formatErrorMessage(error);
      if (/unique|duplicate/i.test(message)) {
        return res.status(409).json({ message: "That username is already in use" });
      }
      res.status(500).json({ message: "Failed to create the tenant account" });
    }
  });

  app.put("/api/super-admin/accounts/:id", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const accountId = Number(req.params.id);
    if (!Number.isInteger(accountId)) {
      return res.status(400).json({ message: "Choose a valid account" });
    }

    const parsed = updateTenantAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "Choose valid account details",
      });
    }

    try {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.id, accountId))
        .limit(1);
      if (!existing || !existing.businessId || existing.role === "super_admin") {
        return res.status(404).json({ message: "Tenant account not found" });
      }

      const removesActiveAdministrator =
        existing.role === "admin" &&
        Boolean(existing.active) &&
        (parsed.data.role !== "admin" || !parsed.data.active);
      if (removesActiveAdministrator) {
        const [replacementAdministrator] = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.businessId, existing.businessId),
              eq(users.role, "admin"),
              eq(users.active, true),
              ne(users.id, existing.id),
            ),
          )
          .limit(1);
        if (!replacementAdministrator) {
          return res.status(400).json({
            message: "Create another active business administrator before changing this account",
          });
        }
      }

      const [account] = await db
        .update(users)
        .set({
          name: parsed.data.name,
          username: parsed.data.username,
          email: parsed.data.email || null,
          role: parsed.data.role,
          active: parsed.data.active,
          ...(parsed.data.password ? { password: parsed.data.password } : {}),
        })
        .where(eq(users.id, accountId))
        .returning({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          role: users.role,
          active: users.active,
          businessId: users.businessId,
        });

      forceLogoutUsers.add(account.id);
      sendForceLogoutToUser(account.id);

      res.json({
        message: `${account.name || account.username} was updated`,
        account,
      });
    } catch (error) {
      const message = formatErrorMessage(error);
      if (/unique|duplicate/i.test(message)) {
        return res.status(409).json({ message: "That username is already in use" });
      }
      res.status(500).json({ message: "Failed to update the tenant account" });
    }
  });

  app.delete("/api/super-admin/accounts/:id", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const accountId = Number(req.params.id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "Choose a valid account" });
    }

    try {
      await ensureMultiTenantFoundation();

      const result = await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({
            id: users.id,
            businessId: users.businessId,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, accountId))
          .limit(1);

        if (
          !candidate ||
          candidate.businessId === null ||
          candidate.role === "super_admin"
        ) {
          return { status: "not_found" } as const;
        }

        const businessId = candidate.businessId;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(2026072202, ${businessId})`,
        );

        const tenantAccounts = await tx
          .select({
            id: users.id,
            username: users.username,
            name: users.name,
            role: users.role,
            active: users.active,
            businessId: users.businessId,
          })
          .from(users)
          .where(eq(users.businessId, businessId))
          .for("update");
        const account = tenantAccounts.find(
          (tenantAccount) => tenantAccount.id === accountId,
        );

        if (!account || account.role === "super_admin") {
          return { status: "not_found" } as const;
        }

        if (account.role === "admin" && account.active === true) {
          const hasReplacementAdministrator = tenantAccounts.some(
            (tenantAccount) =>
              tenantAccount.id !== account.id &&
              tenantAccount.role === "admin" &&
              tenantAccount.active === true,
          );
          if (!hasReplacementAdministrator) {
            return { status: "last_active_admin" } as const;
          }
        }

        const externalReferenceResult = await tx.execute(sql`
          SELECT EXISTS (
            SELECT 1
            FROM staff_profiles
            WHERE linked_user_id = ${account.id}
              AND business_id IS DISTINCT FROM ${businessId}
          ) AS has_external_reference
        `);
        const hasExternalReference = Boolean(
          ((externalReferenceResult as any)?.rows || [])[0]
            ?.has_external_reference,
        );
        if (hasExternalReference) {
          return { status: "integrity_conflict" } as const;
        }

        await tx
          .update(staffProfiles)
          .set({ linkedUserId: null })
          .where(
            and(
              eq(staffProfiles.businessId, businessId),
              eq(staffProfiles.linkedUserId, account.id),
            ),
          );
        await tx
          .delete(passwordResetTokens)
          .where(eq(passwordResetTokens.userId, account.id));
        const [deletedAccount] = await tx
          .delete(users)
          .where(
            and(
              eq(users.id, account.id),
              eq(users.businessId, businessId),
              ne(users.role, "super_admin"),
            ),
          )
          .returning({ id: users.id });

        if (!deletedAccount) {
          throw new Error("Tenant account disappeared during deletion");
        }

        return {
          status: "deleted",
          accountId: deletedAccount.id,
          displayName: account.name || account.username,
        } as const;
      });

      if (result.status === "not_found") {
        return res.status(404).json({ message: "Tenant account not found" });
      }
      if (result.status === "last_active_admin") {
        return res.status(409).json({
          message: "Create another active business administrator before deleting this account",
        });
      }
      if (result.status === "integrity_conflict") {
        return res.status(409).json({
          message: "This account is linked to another tenant's staff data and cannot be safely deleted",
        });
      }

      forceLogoutUsers.add(result.accountId);
      activeSessions.delete(result.accountId);
      sendForceLogoutToUser(result.accountId);

      return res.json({
        message: `${result.displayName} was deleted`,
        accountId: result.accountId,
      });
    } catch (error) {
      console.error("Failed to delete tenant account", error);
      return res.status(500).json({ message: "Failed to delete the tenant account" });
    }
  });

  app.delete("/api/super-admin/businesses/:id", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const businessId = Number(req.params.id);
    if (!Number.isInteger(businessId) || businessId <= 0) {
      return res.status(400).json({ message: "Choose a valid business" });
    }

    try {
      await ensureMultiTenantFoundation();

      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(2026072202, ${businessId})`,
        );

        const [business] = await tx
          .select({ id: laundryBusinesses.id, name: laundryBusinesses.name })
          .from(laundryBusinesses)
          .where(eq(laundryBusinesses.id, businessId))
          .limit(1)
          .for("update");
        if (!business) {
          return { status: "not_found" } as const;
        }

        const tenantAccounts = await tx
          .select({
            id: users.id,
            username: users.username,
            role: users.role,
          })
          .from(users)
          .where(eq(users.businessId, businessId))
          .for("update");
        if (tenantAccounts.some((account) => account.role === "super_admin")) {
          return { status: "platform_owner_conflict" } as const;
        }

        const externalReferenceResult = await tx.execute(sql`
          SELECT
            EXISTS (
              SELECT 1
              FROM users external_user
              JOIN staff_profiles target_profile
                ON target_profile.id = external_user.staff_profile_id
              WHERE target_profile.business_id = ${businessId}
                AND external_user.business_id IS DISTINCT FROM ${businessId}
            )
            OR EXISTS (
              SELECT 1
              FROM staff_profiles external_profile
              JOIN users target_user
                ON target_user.id = external_profile.linked_user_id
              WHERE target_user.business_id = ${businessId}
                AND external_profile.business_id IS DISTINCT FROM ${businessId}
            )
            OR EXISTS (
              SELECT 1
              FROM staff_profiles external_profile
              JOIN organization_units target_unit
                ON target_unit.id = external_profile.organization_unit_id
              WHERE target_unit.business_id = ${businessId}
                AND external_profile.business_id IS DISTINCT FROM ${businessId}
            )
            OR EXISTS (
              SELECT 1
              FROM staff_profiles external_profile
              JOIN staff_profiles target_manager
                ON target_manager.id = external_profile.manager_staff_id
              WHERE target_manager.business_id = ${businessId}
                AND external_profile.business_id IS DISTINCT FROM ${businessId}
            ) AS has_external_reference
        `);
        const hasExternalReference = Boolean(
          ((externalReferenceResult as any)?.rows || [])[0]
            ?.has_external_reference,
        );
        if (hasExternalReference) {
          return { status: "integrity_conflict" } as const;
        }

        const tenantAccountIds = tenantAccounts.map((account) => account.id);

        // Delete leaf and historical records before their order, bill, and
        // client parents. Several legacy relationships are not declared as
        // foreign keys, so the order is explicit rather than relying on a
        // database-level cascading delete.
        await tx.execute(sql`
          DELETE FROM order_date_change_audit
          WHERE business_id = ${businessId}
        `);
        await tx
          .delete(stageChecklists)
          .where(eq(stageChecklists.businessId, businessId));
        await tx.delete(reviews).where(eq(reviews.businessId, businessId));
        await tx
          .delete(missingItems)
          .where(eq(missingItems.businessId, businessId));
        await tx.delete(incidents).where(eq(incidents.businessId, businessId));
        await tx
          .delete(billPayments)
          .where(eq(billPayments.businessId, businessId));
        await tx
          .delete(clientTransactions)
          .where(eq(clientTransactions.businessId, businessId));
        await tx.delete(orders).where(eq(orders.businessId, businessId));
        await tx.delete(bills).where(eq(bills.businessId, businessId));
        await tx.delete(clients).where(eq(clients.businessId, businessId));

        await tx.delete(products).where(eq(products.businessId, businessId));
        await tx
          .delete(packingWorkers)
          .where(eq(packingWorkers.businessId, businessId));
        await tx
          .delete(staffMembers)
          .where(eq(staffMembers.businessId, businessId));
        await tx.delete(companies).where(eq(companies.businessId, businessId));
        await tx
          .delete(productCategorySettings)
          .where(eq(productCategorySettings.businessId, businessId));
        await tx
          .delete(companyContactSettings)
          .where(eq(companyContactSettings.businessId, businessId));
        await tx
          .delete(appSecuritySettings)
          .where(eq(appSecuritySettings.businessId, businessId));
        await tx
          .delete(salesReportScheduleSettings)
          .where(eq(salesReportScheduleSettings.businessId, businessId));

        // Break the nullable user/staff hierarchy links deliberately before
        // deleting either side of the cycle.
        await tx
          .update(users)
          .set({ staffProfileId: null })
          .where(eq(users.businessId, businessId));
        await tx
          .update(staffProfiles)
          .set({
            organizationUnitId: null,
            managerStaffId: null,
            linkedUserId: null,
          })
          .where(eq(staffProfiles.businessId, businessId));

        if (tenantAccountIds.length > 0) {
          await tx
            .delete(passwordResetTokens)
            .where(inArray(passwordResetTokens.userId, tenantAccountIds));
        }
        await tx
          .delete(staffProfiles)
          .where(eq(staffProfiles.businessId, businessId));
        await tx.delete(users).where(eq(users.businessId, businessId));
        await tx
          .delete(organizationUnits)
          .where(eq(organizationUnits.businessId, businessId));

        const [deletedBusiness] = await tx
          .delete(laundryBusinesses)
          .where(eq(laundryBusinesses.id, businessId))
          .returning({ id: laundryBusinesses.id, name: laundryBusinesses.name });
        if (!deletedBusiness) {
          throw new Error("Business disappeared during deletion");
        }

        return {
          status: "deleted",
          business: deletedBusiness,
          accountIds: tenantAccountIds,
        } as const;
      });

      if (result.status === "not_found") {
        return res.status(404).json({ message: "Business not found" });
      }
      if (result.status === "platform_owner_conflict") {
        return res.status(409).json({
          message: "A platform-owner account is assigned to this business; deletion was cancelled",
        });
      }
      if (result.status === "integrity_conflict") {
        return res.status(409).json({
          message: "This business is referenced by another tenant's staff hierarchy and cannot be safely deleted",
        });
      }

      for (const accountId of result.accountIds) {
        forceLogoutUsers.add(accountId);
        activeSessions.delete(accountId);
        sendForceLogoutToUser(accountId);
      }
      clearAppLockdownStatusCache();

      return res.json({
        message: `${result.business.name} and all of its tenant data were deleted`,
        businessId: result.business.id,
        deletedAccountCount: result.accountIds.length,
      });
    } catch (error) {
      console.error("Failed to delete business", error);
      return res.status(500).json({ message: "Failed to delete the business" });
    }
  });

  // Request password reset
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${normalizedEmail}`,
          eq(users.role, "super_admin"),
          isNull(users.businessId),
        ),
      );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No user found with this email" });
    }
    if (user.role !== "super_admin" || user.businessId) {
      return res.status(403).json({
        success: false,
        message: "SMTP password recovery is available only for the platform owner",
      });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const [createdToken] = await db
      .insert(passwordResetTokens)
      .values({
      userId: user.id,
      token: resetCode,
      expiresAt,
      used: false,
      })
      .returning({ id: passwordResetTokens.id });

    try {
      const delivery = await sendUserPasswordResetEmail(
        normalizedEmail,
        resetCode,
        user.name || user.username,
      );

      res.json({
        success: true,
        message: delivery.message,
        previewCode: delivery.previewCode,
      });
    } catch (err: any) {
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.id, createdToken.id));

      console.error("Failed to send email:", err);
      res
        .status(500)
        .json({
          success: false,
          message:
            err instanceof Error
              ? err.message
              : "Failed to send email. Please try again.",
        });
    }
  });

  // Verify reset code
  app.post("/api/auth/verify-reset-code", async (req, res) => {
    const { email, code } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !code) {
      return res
        .status(400)
        .json({ success: false, message: "Email and code are required" });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${normalizedEmail}`,
          eq(users.role, "super_admin"),
          isNull(users.businessId),
        ),
      );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (user.role !== "super_admin" || user.businessId) {
      return res.status(403).json({
        success: false,
        message: "SMTP password recovery is available only for the platform owner",
      });
    }

    const [token] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          eq(passwordResetTokens.token, code),
          eq(passwordResetTokens.used, false),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );

    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired code" });
    }

    res.json({ success: true, message: "Code verified successfully" });
  });

  // Reset password
  app.post("/api/auth/reset-password", async (req, res) => {
    const { email, code, newPassword } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !code || !newPassword) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Email, code, and new password are required",
        });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must have at least 8 characters",
      });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${normalizedEmail}`,
          eq(users.role, "super_admin"),
          isNull(users.businessId),
        ),
      );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    if (user.role !== "super_admin" || user.businessId) {
      return res.status(403).json({
        success: false,
        message: "SMTP password recovery is available only for the platform owner",
      });
    }

    const [token] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          eq(passwordResetTokens.token, code),
          eq(passwordResetTokens.used, false),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      );

    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired code" });
    }

    await db
      .update(users)
      .set({ password: newPassword })
      .where(eq(users.id, user.id));
    await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.id, token.id));

    res.json({ success: true, message: "Password reset successfully" });
  });

  const allowedManagedUserRoles = new Set([
    "counter",
    "section",
    "driver",
    "reception",
    "staff",
  ]);

  const normalizeManagedUserRole = (role: unknown) =>
    String(role || "")
      .trim()
      .toLowerCase();

  const isPrimaryAdminUser = (user?: { username?: string | null } | null) =>
    String(user?.username || "")
      .trim()
      .toLowerCase() === "admin";

  // Tenant administrators may manage only accounts visible through their RLS
  // scope. Credentials are write-only and are never returned by the API.
  app.get("/api/users", async (req, res) => {
    const userList = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        name: users.name,
        email: users.email,
        active: users.active,
      })
      .from(users);
    res.json(userList);
  });

  // Create user
  app.post("/api/users", async (req, res) => {
    const { username, password, role, name, email, pin } = req.body;
    try {
      const normalizedUsername = String(username || "").trim();
      const normalizedPassword = String(password || "").trim();
      const normalizedEmail = String(email || "").trim();
      const normalizedPin = String(pin || "").trim();
      const normalizedRole = normalizeManagedUserRole(role || "counter");

      if (!normalizedUsername) {
        return res.status(400).json({ message: "Username is required" });
      }
      if (normalizedPassword.length < 8) {
        return res.status(400).json({ message: "Password must have at least 8 characters" });
      }
      if (normalizedUsername.toLowerCase() === "admin") {
        return res
          .status(400)
          .json({ message: "The admin username is reserved for the main admin account" });
      }
      if (normalizedRole === "admin") {
        return res
          .status(400)
          .json({ message: "Only one admin account is allowed in the system" });
      }
      if (!allowedManagedUserRoles.has(normalizedRole)) {
        return res.status(400).json({ message: "Invalid user role" });
      }

      const existingUsername = await db
        .select()
        .from(users)
        .where(eq(users.username, normalizedUsername))
        .limit(1);
      if (existingUsername.length > 0) {
        return res.status(400).json({ message: "Username already exists" });
      }

      if (normalizedEmail) {
        const existingEmail = await db
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1);
        if (existingEmail.length > 0) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }

      // Check if PIN is provided and validate uniqueness
      if (normalizedPin) {
        if (!/^\d{5}$/.test(normalizedPin)) {
          return res.status(400).json({ message: "PIN must be 5 digits" });
        }
        // Check if PIN is already used by another user
        const existingUser = await db.select().from(users).where(eq(users.pin, normalizedPin)).limit(1);
        if (existingUser.length > 0) {
          return res.status(400).json({ message: "This PIN is used by other user" });
        }
        // Check if PIN is already used by a worker
        const existingWorker = await db.select().from(packingWorkers).where(eq(packingWorkers.pin, normalizedPin)).limit(1);
        if (existingWorker.length > 0) {
          return res.status(400).json({ message: "This PIN is used by other user" });
        }
      }
      const [newUser] = await db
        .insert(users)
        .values({
          username: normalizedUsername,
          password: normalizedPassword,
          role: normalizedRole,
          name: name || normalizedUsername,
          email: normalizedEmail || null,
          pin: normalizedPin || null,
          active: true,
        })
        .returning();
      res
        .status(201)
        .json({
          id: newUser.id,
          username: newUser.username,
          role: newUser.role,
          name: newUser.name,
          email: newUser.email,
        });
    } catch (err: any) {
      if (String(err?.code || "") === "23505") {
        return res.status(400).json({ message: "Username or email already exists" });
      }
      res.status(400).json({ message: err.message || "Failed to create user" });
    }
  });

  // Update user
  app.put("/api/users/:id", async (req, res) => {
    const { username, password, role, name, email, active, pin } = req.body;
    const userId = Number(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (isPrimaryAdminUser(currentUser) || currentUser.role === "admin") {
      return res.status(403).json({
        message: "The main admin account must be managed from Admin Settings",
      });
    }

    const normalizedUsername =
      username !== undefined ? String(username || "").trim() : undefined;
    const normalizedRole =
      role !== undefined ? normalizeManagedUserRole(role) : undefined;

    if (normalizedUsername && normalizedUsername.toLowerCase() === "admin") {
      return res
        .status(400)
        .json({ message: "The admin username is reserved for the main admin account" });
    }
    if (normalizedRole === "admin") {
      return res
        .status(400)
        .json({ message: "Only one admin account is allowed in the system" });
    }
    if (normalizedRole !== undefined && !allowedManagedUserRoles.has(normalizedRole)) {
      return res.status(400).json({ message: "Invalid user role" });
    }
    if (password !== undefined && String(password).length > 0 && String(password).length < 8) {
      return res.status(400).json({ message: "Password must have at least 8 characters" });
    }

    // Check if PIN is provided and validate uniqueness
    if (pin) {
      if (!/^\d{5}$/.test(pin)) {
        return res.status(400).json({ message: "PIN must be 5 digits" });
      }

      const pinIsChanging = !currentUser || currentUser.pin !== pin;

      if (pinIsChanging) {
        // Check if PIN is already used by another user (excluding current user)
        const existingUser = await db.select().from(users).where(and(eq(users.pin, pin), ne(users.id, userId))).limit(1);
        if (existingUser.length > 0) {
          return res.status(400).json({ message: "This PIN is used by other user" });
        }
        // Check if PIN is already used by a worker (must use bcrypt compare since worker PINs are hashed)
        const allWorkers = await db.select().from(packingWorkers);
        for (const worker of allWorkers) {
          if (worker.pin && await bcrypt.compare(pin, worker.pin)) {
            return res.status(400).json({ message: "This PIN is used by other user" });
          }
        }
      }
    }

    const oldName = currentUser?.name;
    const oldUsername = currentUser?.username;

    const updates: any = {};
    if (normalizedUsername) updates.username = normalizedUsername;
    if (password) updates.password = password;
    if (normalizedRole) updates.role = normalizedRole;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email || null;
    if (active !== undefined) updates.active = active;
    if (pin) updates.pin = pin;

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning();
    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    let updatedHistoricalBillRecords = false;

    // If name changed, update all historical records with the new name
    if (name && oldName && name !== oldName) {
      // Update bills
      await db.update(bills).set({ createdBy: name }).where(eq(bills.createdBy, oldName));
      updatedHistoricalBillRecords = true;
      // Update orders - all name fields
      await db.update(orders).set({ entryBy: name }).where(eq(orders.entryBy, oldName));
      await db.update(orders).set({ tagBy: name }).where(eq(orders.tagBy, oldName));
      await db.update(orders).set({ packingBy: name }).where(eq(orders.packingBy, oldName));
      await db.update(orders).set({ deliveryBy: name }).where(eq(orders.deliveryBy, oldName));
      console.log(`Updated historical records from "${oldName}" to "${name}"`);
    }
    // Also update if username was used as name field (fallback)
    if (name && oldUsername && name !== oldUsername) {
      await db.update(bills).set({ createdBy: name }).where(eq(bills.createdBy, oldUsername));
      updatedHistoricalBillRecords = true;
      await db.update(orders).set({ entryBy: name }).where(eq(orders.entryBy, oldUsername));
      await db.update(orders).set({ tagBy: name }).where(eq(orders.tagBy, oldUsername));
      await db.update(orders).set({ packingBy: name }).where(eq(orders.packingBy, oldUsername));
      await db.update(orders).set({ deliveryBy: name }).where(eq(orders.deliveryBy, oldUsername));
    }

    if (updatedHistoricalBillRecords) {
      storage.notifyLiveResourceUpdated("bills");
    }

    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
      name: updated.name,
      email: updated.email,
      active: updated.active,
    });
  });

  // Delete user
  app.delete("/api/users/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const [existingUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (isPrimaryAdminUser(existingUser) || existingUser.role === "admin") {
      return res.status(403).json({
        message: "The main admin account cannot be deleted from user management",
      });
    }
    await db.delete(users).where(eq(users.id, userId));
    res.status(204).send();
  });

  // Staff members routes - people assigned to shared role accounts
  app.get("/api/staff-members", async (req, res) => {
    const roleType = req.query.roleType as string | undefined;
    const members = await storage.getStaffMembers(roleType);
    res.json(members);
  });

  app.get("/api/staff-members/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid staff member ID" });
    }
    const member = await storage.getStaffMember(id);
    if (!member) {
      return res.status(404).json({ message: "Staff member not found" });
    }
    res.json(member);
  });

  app.post("/api/staff-members", async (req, res) => {
    const { name, pin, roleType } = req.body;
    try {
      if (!name || !pin || !roleType) {
        return res.status(400).json({ message: "Name, PIN, and roleType are required" });
      }
      if (!/^\d{5}$/.test(pin)) {
        return res.status(400).json({ message: "PIN must be 5 digits" });
      }
      // Check if PIN is already used by another staff member (including inactive)
      const pinExists = await storage.checkStaffMemberPinExists(pin);
      if (pinExists) {
        return res.status(400).json({ message: "This PIN is already used by another staff member" });
      }
      // Check if PIN is already used by a user
      const existingUser = await db.select().from(users).where(eq(users.pin, pin)).limit(1);
      if (existingUser.length > 0) {
        return res.status(400).json({ message: "This PIN is already used by a user account" });
      }
      const member = await storage.createStaffMember({ name, pin, roleType });
      res.status(201).json(member);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to create staff member" });
    }
  });

  app.put("/api/staff-members/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid staff member ID" });
    }
    const { name, pin, active } = req.body;
    try {
      if (pin && !/^\d{5}$/.test(pin)) {
        return res.status(400).json({ message: "PIN must be 5 digits" });
      }
      // Check if PIN is already used by another staff member (if changing)
      if (pin) {
        const pinExists = await storage.checkStaffMemberPinExists(pin, id);
        if (pinExists) {
          return res.status(400).json({ message: "This PIN is already used by another staff member" });
        }
        const existingUser = await db.select().from(users).where(eq(users.pin, pin)).limit(1);
        if (existingUser.length > 0) {
          return res.status(400).json({ message: "This PIN is already used by a user account" });
        }
      }
      // Get current staff member to check if name is changing
      const currentMember = await storage.getStaffMember(id);
      const oldName = currentMember?.name;

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (pin !== undefined) updates.pin = pin;
      if (active !== undefined) updates.active = active;
      const member = await storage.updateStaffMember(id, updates);

      let updatedHistoricalBillRecords = false;

      // If name changed, update all historical records with the new name
      if (name && oldName && name !== oldName) {
        // Update bills
        await db.update(bills).set({ createdBy: name }).where(eq(bills.createdBy, oldName));
        updatedHistoricalBillRecords = true;
        // Update orders - all name fields
        await db.update(orders).set({ entryBy: name }).where(eq(orders.entryBy, oldName));
        await db.update(orders).set({ tagBy: name }).where(eq(orders.tagBy, oldName));
        await db.update(orders).set({ packingBy: name }).where(eq(orders.packingBy, oldName));
        await db.update(orders).set({ deliveryBy: name }).where(eq(orders.deliveryBy, oldName));
        console.log(`Updated historical records from "${oldName}" to "${name}"`);
      }

      if (updatedHistoricalBillRecords) {
        storage.notifyLiveResourceUpdated("bills");
      }

      res.json(member);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update staff member" });
    }
  });

  app.delete("/api/staff-members/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid staff member ID" });
    }
    await storage.deleteStaffMember(id);
    res.status(204).send();
  });

  // Verify staff member PIN (for billing/tracking identification)
  app.post("/api/staff-members/verify-pin", async (req, res) => {
    const { pin } = req.body;

    // First check user PINs (admin, counter, section, driver accounts)
    const user = await storage.verifyUserPin(pin);
    if (user) {
      return res.json({ success: true, member: { id: user.id, name: user.name || user.username, roleType: user.role } });
    }

    // Then check staff member PINs
    const member = await storage.verifyStaffMemberPin(pin);
    if (member) {
      return res.json({ success: true, member: { id: member.id, name: member.name, roleType: member.roleType } });
    }

    // Check packing workers (legacy)
    const packingWorker = await storage.verifyPackingWorkerPin(pin);
    if (packingWorker) {
      return res.json({ success: true, member: { id: packingWorker.id, name: packingWorker.name, roleType: "section" } });
    }

    // Check delivery workers (legacy)
    const deliveryWorker = await storage.verifyDeliveryWorkerPin(pin);
    if (deliveryWorker) {
      return res.json({ success: true, member: { id: deliveryWorker.id, name: deliveryWorker.name, roleType: "driver" } });
    }

    res.status(401).json({ success: false, message: "Invalid PIN" });
  });

  app.post("/api/discounts/verify-pin", async (req, res) => {
    const { pin } = req.body || {};
    const pinAccess = await resolveOrderEditPinAccess(String(pin || ""));
    if (!pinAccess) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid admin or counter PIN" });
    }

    res.json({
      success: true,
      member: {
        name: pinAccess.name,
        roleType: pinAccess.level,
      },
    });
  });

  // Client routes
  app.get(api.clients.list.path, async (req, res) => {
    const search = req.query.search as string | undefined;
    const clientList = await storage.getClients(search);
    res.json(clientList);
  });

  app.get("/api/clients/order-summary", async (_req, res) => {
    try {
      const amountExpression = sql`
        greatest(
          coalesce(${orders.finalAmount}, ${orders.adjustedTotal}, ${orders.totalAmount}, 0::numeric),
          0::numeric
        )
      `;
      const paidExpression = sql`
        greatest(coalesce(${orders.paidAmount}, 0::numeric), 0::numeric)
      `;

      const rows = await db
        .select({
          clientId: orders.clientId,
          totalAmount: sql<string>`coalesce(sum(${amountExpression}), 0)::text`,
          totalPaid: sql<string>`coalesce(sum(${paidExpression}), 0)::text`,
          due: sql<string>`coalesce(sum(greatest(${amountExpression} - ${paidExpression}, 0::numeric)), 0)::text`,
          orderCount: sql<number>`cast(count(*) as integer)`,
        })
        .from(orders)
        .where(sql`${orders.clientId} is not null`)
        .groupBy(orders.clientId);

      const byClientId: Record<
        string,
        { totalAmount: number; totalPaid: number; due: number; orderCount: number }
      > = {};
      let totalAmount = 0;
      let totalPaid = 0;
      let totalDue = 0;
      let dueClientsCount = 0;

      rows.forEach((row) => {
        if (!row.clientId) return;

        const clientTotalAmount = parseFloat(String(row.totalAmount || "0")) || 0;
        const clientTotalPaid = parseFloat(String(row.totalPaid || "0")) || 0;
        const clientDue = parseFloat(String(row.due || "0")) || 0;
        const orderCount = Number(row.orderCount || 0);

        byClientId[String(row.clientId)] = {
          totalAmount: clientTotalAmount,
          totalPaid: clientTotalPaid,
          due: clientDue,
          orderCount,
        };

        totalAmount += clientTotalAmount;
        totalPaid += clientTotalPaid;
        totalDue += clientDue;
        if (clientDue > 0.009) dueClientsCount += 1;
      });

      res.json({
        byClientId,
        totalAmount,
        totalPaid,
        totalDue,
        dueClientsCount,
      });
    } catch (error) {
      console.error("Failed to load client order summary:", error);
      res.status(500).json({ message: "Failed to load client order summary" });
    }
  });

  app.get(api.clients.get.path, async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const client = await storage.getClient(clientId);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.json(client);
  });

  app.get("/api/clients/:id/unpaid-balance", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const unpaidBills = await storage.getUnpaidBills(clientId);

    let totalDue = 0;
    for (const bill of unpaidBills) {
      const amount = parseFloat(bill.amount?.toString() || "0");
      const paid = parseFloat(bill.paidAmount?.toString() || "0");
      totalDue += amount - paid;
    }

    res.json({
      totalDue: totalDue.toFixed(2),
      billCount: unpaidBills.length,
      latestBillDate: unpaidBills[0]?.billDate || null,
    });
  });

  app.post("/api/clients/check-duplicate", async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.json({ exists: false, client: null });
    }
    const existingClient = await storage.findClientByNameAndPhone(name, phone);
    res.json({ exists: !!existingClient, client: existingClient || null });
  });

  app.get("/api/clients/by-phone/:phone", async (req, res) => {
    const phone = req.params.phone;
    if (!phone) {
      return res.status(400).json({ message: "Phone number required" });
    }
    const client = await storage.findClientByPhone(phone);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.json(client);
  });

  app.post(api.clients.create.path, async (req, res) => {
    try {
      const input = api.clients.create.input.parse(req.body);

      if (input.name) input.name = input.name.trim().toUpperCase();
      if (input.address) input.address = input.address.trim().toUpperCase();
      if (typeof input.phone === "string") input.phone = normalizePhoneForStorage(input.phone);
      if (typeof input.clientType === "string") {
        input.clientType = input.clientType.trim().toLowerCase() === "broker" ? "broker" : "regular";
      }

      if (input.phone && input.phone.trim() !== "" && !isPlausiblePhoneNumber(input.phone)) {
        return res.status(400).json({
          message: "Enter a valid phone number for the selected country",
          field: "phone",
        });
      }

      // Check if phone number already exists (phone must be unique)
      if (input.phone && input.phone.trim() !== "") {
        const existingClientByPhone = await storage.findClientByPhone(input.phone);
        if (existingClientByPhone) {
          return res.status(409).json({
            message: `This phone number already exists in the system`,
            field: "phone",
            existingClient: {
              id: existingClientByPhone.id,
              name: existingClientByPhone.name,
              phone: existingClientByPhone.phone,
              address: existingClientByPhone.address,
            },
          });
        }
      }

      // Check for duplicate name + address combination
      if (input.name && input.address) {
        const existingClient = await storage.findClientByNameAndAddress(
          input.name,
          input.address,
        );
        if (existingClient) {
          return res.status(409).json({
            message: `A client with name "${input.name}" and address "${input.address}" already exists`,
            field: "address",
          });
        }
      }

      const client = await storage.createClient(input);
      res.status(201).json(client);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.put(api.clients.update.path, async (req, res) => {
    try {
      const input = api.clients.update.input.parse(req.body);
      const clientId = Number(req.params.id);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }

      if (input.name) input.name = input.name.trim().toUpperCase();
      if (input.address) input.address = input.address.trim().toUpperCase();
      if (typeof input.phone === "string") input.phone = normalizePhoneForStorage(input.phone);

      if (input.phone && input.phone.trim() !== "" && !isPlausiblePhoneNumber(input.phone)) {
        return res.status(400).json({
          message: "Enter a valid phone number for the selected country",
          field: "phone",
        });
      }

      // Get current client data for comparison
      const currentClient = await storage.getClient(clientId);
      if (!currentClient) {
        return res.status(404).json({ message: "Client not found" });
      }

      const currentClientIsBroker = ((currentClient as any).clientType || "").trim().toLowerCase() === "broker";
      if (input.clientType === "regular" && currentClientIsBroker) {
        input.brokerAddresses = [];
      }

      const newName = input.name || currentClient.name;
      const newPhone = input.phone || currentClient.phone;
      const newAddress = input.address || currentClient.address;

      if (input.phone && newPhone && newPhone !== "-" && newPhone !== currentClient.phone) {
        const existingByPhone = await storage.findClientByPhone(newPhone);
        if (existingByPhone && existingByPhone.id !== clientId) {
          return res.status(409).json({
            message: `This phone number is already registered to client "${existingByPhone.name}"`,
            field: "phone",
          });
        }
      }

      const client = await storage.updateClient(clientId, input);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      let updatedClientBills = false;
      if (input.name && input.name !== currentClient.name) {
        await db.update(orders).set({ customerName: input.name }).where(eq(orders.clientId, clientId));
        await db.update(bills).set({ customerName: input.name }).where(eq(bills.clientId, clientId));
        updatedClientBills = true;
      }

      if (typeof input.phone === "string" && input.phone !== currentClient.phone) {
        await db.update(bills).set({ customerPhone: input.phone }).where(eq(bills.clientId, clientId));
        updatedClientBills = true;
      }

      if (input.address !== undefined && input.address !== currentClient.address) {
        const nextAddress = String(input.address || "").trim().toUpperCase();
        await db
          .update(orders)
          .set({ deliveryAddress: nextAddress || null })
          .where(eq(orders.clientId, clientId));
        updatedClientBills = true;
      }

      if (
        input.billNumber !== undefined ||
        input.company !== undefined ||
        input.clientType !== undefined ||
        input.brokerAddresses !== undefined
      ) {
        updatedClientBills = true;
      }

      if (updatedClientBills) {
        storage.notifyLiveResourceUpdated("bills");
      }

      res.json(client);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.post("/api/clients/:id/broker-address", async (req, res) => {
    try {
      const clientId = Number(req.params.id);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      const { address } = req.body;
      if (!address || typeof address !== "string" || !address.trim()) {
        return res.status(400).json({ message: "Address is required" });
      }
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      const normalizedAddress = address.trim().toUpperCase();
      const currentAddresses: string[] = (client as any).brokerAddresses || [];
      if (currentAddresses.some(a => a.toUpperCase() === normalizedAddress)) {
        return res.json(client);
      }
      const updated = await storage.updateClient(clientId, {
        brokerAddresses: [...currentAddresses, normalizedAddress],
      } as any);
      res.json(updated);
    } catch (err) {
      throw err;
    }
  });

  app.delete("/api/clients/:id/broker-address", async (req, res) => {
    try {
      const clientId = Number(req.params.id);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      const { address } = req.body;
      if (!address || typeof address !== "string") {
        return res.status(400).json({ message: "Address is required" });
      }
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      const currentAddresses: string[] = (client as any).brokerAddresses || [];
      const normalizedAddress = address.trim().toUpperCase();
      const updated = await storage.updateClient(clientId, {
        brokerAddresses: currentAddresses.filter(a => a.toUpperCase() !== normalizedAddress),
      } as any);
      res.json(updated);
    } catch (err) {
      throw err;
    }
  });

  app.delete(api.clients.delete.path, async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    // Check if client has any unpaid bills
    const clientBills = await storage.getClientBills(clientId);
    const unpaidBills = clientBills.filter(b => !b.isPaid);
    if (unpaidBills.length > 0) {
      return res.status(400).json({
        message: "Cannot delete client: has " + String(unpaidBills.length) + " unpaid bill(s). Please collect payment first."
      });
    }

    // Check client balance
    const client = await storage.getClient(clientId);
    if (client && parseFloat(client.balance || "0") !== 0) {
      return res.status(400).json({
        message: `Cannot delete client: has outstanding balance of ${client.balance} AED. Please settle the balance first.`
      });
    }

    // Delete all transaction history first
    const transactions = await storage.getClientTransactions(clientId);
    if (transactions.length > 0) {
      await storage.clearClientTransactions(clientId);
    }

    await storage.deleteClient(clientId);
    res.status(204).send();
  });

  // Delete client with admin PIN verification
  app.post("/api/clients/:id/delete-with-password", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    const { password, adminPin } = req.body || {};
    if (!adminPin && !password) {
      return res.status(400).json({ message: "Admin PIN required" });
    }

    const isAdminValid = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(password || ""));
    if (!isAdminValid) {
      return res
        .status(401)
        .json({ message: adminPin ? "Invalid admin PIN" : "Invalid admin password" });
    }

    // Check if client has any unpaid bills
    const clientBills = await storage.getClientBills(clientId);
    const unpaidBills = clientBills.filter(b => !b.isPaid);
    if (unpaidBills.length > 0) {
      return res.status(400).json({
        message: "Cannot delete client: has " + String(unpaidBills.length) + " unpaid bill(s). Please collect payment first."
      });
    }

    // Check client balance
    const client = await storage.getClient(clientId);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }
    if (parseFloat(client.balance || "0") !== 0) {
      return res.status(400).json({
        message: `Cannot delete client: has outstanding balance of ${client.balance} AED. Please settle the balance first.`
      });
    }

    // Delete all transaction history first
    const transactions = await storage.getClientTransactions(clientId);
    if (transactions.length > 0) {
      await storage.clearClientTransactions(clientId);
    }

    await storage.deleteClient(clientId);
    res.json({ message: "Client deleted successfully" });
  });

  // Merge client accounts (requires admin password)
  app.post("/api/clients/merge", async (req, res) => {
    try {
      const { sourceClientId, targetClientId, adminPassword } = req.body;

      console.log("[MERGE] Request received:", { sourceClientId, targetClientId });

      if (!adminPassword) {
        return res.status(400).json({ message: "Admin password required" });
      }

      const adminUser = await storage.getUserByUsername("admin");
      if (!adminUser || adminUser.password !== adminPassword) {
        return res.status(403).json({ message: "Invalid admin password" });
      }

      if (!sourceClientId || !targetClientId) {
        return res.status(400).json({ message: "Both source and target client IDs required" });
      }

      if (sourceClientId === targetClientId) {
        return res.status(400).json({ message: "Cannot merge client with itself" });
      }

      console.log("[MERGE] Starting merge...");
      const result = await mergeClientAccounts(sourceClientId, targetClientId);
      console.log("[MERGE] Success:", result);
      return res.status(200).json({ success: true, message: "Clients merged successfully", result });
    } catch (err: any) {
      console.error("[MERGE] Error:", err);
      return res.status(500).json({ message: err.message || "Failed to merge clients" });
    }
  });

  // Clear client transaction history (requires admin password)
  app.post("/api/clients/:id/clear-transactions", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: "Admin password required" });
    }

    // Verify admin password
    const adminUser = await storage.getUserByUsername("admin");
    if (!adminUser || adminUser.password !== password) {
      return res.status(403).json({ message: "Invalid admin password" });
    }

    // Check if client exists
    const client = await storage.getClient(clientId);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Check if client has any unpaid bills
    const clientBills = await storage.getClientBills(clientId);
    const unpaidBills = clientBills.filter(b => !b.isPaid);
    if (unpaidBills.length > 0) {
      return res.status(400).json({
        message: `Cannot clear history: client has ${unpaidBills.length} unpaid bill(s)`
      });
    }

    // Check if client has outstanding balance
    if (parseFloat(client.balance || "0") !== 0) {
      return res.status(400).json({
        message: `Cannot clear history: client has outstanding balance of ${client.balance} AED`
      });
    }

    await storage.clearClientTransactions(clientId);
    res.status(200).json({ message: "Transaction history cleared successfully" });
  });

  // Product routes
  app.get(api.products.list.path, async (req, res) => {
    const search = req.query.search as string | undefined;
    const products = await storage.getProducts(search);
    res.json(products);
  });

  app.get("/api/product-category-settings", async (_req, res) => {
    try {
      const settings = await storage.getProductCategorySettings();
      res.json(normalizeProductCategorySettings(settings));
    } catch (error: any) {
      res.status(500).json({
        message: error.message || "Failed to load product category settings",
      });
    }
  });

  app.put("/api/product-category-settings", async (req, res) => {
    try {
      const updates: {
        baseCategories?: string[];
        customCategories?: string[];
        inventoryDisplayOrder?: string[];
        orderDisplayOrder?: string[];
        favoritesOrder?: number[];
      } = {};

      if ("baseCategories" in req.body) {
        updates.baseCategories = normalizeCategoryNames(req.body.baseCategories);
      }
      if ("customCategories" in req.body) {
        updates.customCategories = normalizeCategoryNames(req.body.customCategories);
      }
      if ("inventoryDisplayOrder" in req.body) {
        updates.inventoryDisplayOrder = normalizeCategoryNames(
          req.body.inventoryDisplayOrder,
        );
      }
      if ("orderDisplayOrder" in req.body) {
        updates.orderDisplayOrder = normalizeCategoryNames(
          req.body.orderDisplayOrder,
        );
      }
      if ("favoritesOrder" in req.body) {
        updates.favoritesOrder = normalizeProductIdOrder(
          req.body.favoritesOrder,
        );
      }

      const settings = await storage.updateProductCategorySettings(updates);
      res.json(normalizeProductCategorySettings(settings));
    } catch (error: any) {
      res.status(500).json({
        message: error.message || "Failed to update product category settings",
      });
    }
  });

  app.get("/api/products/allocated-stock", async (req, res) => {
    try {
      const allocatedStock = await storage.getAllocatedStock();
      res.json(allocatedStock);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/products/orders-by-product", async (req, res) => {
    try {
      const productName = req.query.name as string;
      if (!productName) {
        return res.status(400).json({ message: "Product name is required" });
      }
      const ordersList = await storage.getOrdersForProduct(productName);
      res.json(ordersList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get(api.products.get.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const product = await storage.getProduct(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  });

  app.post(api.products.create.path, async (req, res) => {
    try {
      const numericFields = ['price', 'urgentPrice', 'dryCleanPrice', 'ironOnlyPrice', 'urgentIronOnlyPrice', 'urgentDryCleanPrice', 'smallPrice', 'mediumPrice', 'largePrice', 'smallUrgentPrice', 'mediumUrgentPrice', 'largeUrgentPrice', 'smallDryCleanPrice', 'mediumDryCleanPrice', 'largeDryCleanPrice', 'smallIronOnlyPrice', 'mediumIronOnlyPrice', 'largeIronOnlyPrice', 'smallUrgentIronOnlyPrice', 'mediumUrgentIronOnlyPrice', 'largeUrgentIronOnlyPrice', 'smallUrgentDryCleanPrice', 'mediumUrgentDryCleanPrice', 'largeUrgentDryCleanPrice', 'sqmPrice'];
      const sanitized = { ...req.body };
      const categorySettings = await storage.getProductCategorySettings();
      const availableCategories = normalizeCategoryNames([
        ...categorySettings.baseCategories,
        ...categorySettings.customCategories,
        ...categorySettings.inventoryDisplayOrder,
        ...categorySettings.orderDisplayOrder,
      ]);
      for (const field of numericFields) {
        if (sanitized[field] === '' || sanitized[field] === null) {
          sanitized[field] = null;
        } else if (sanitized[field] === undefined) {
          delete sanitized[field];
        }
      }
      sanitized.category = normalizeStoredProductCategoryName(
        sanitized.category,
        availableCategories,
      );
      const input = api.products.create.input.parse(sanitized);
      const product = await storage.createProduct(input);
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.put(api.products.update.path, async (req, res) => {
    try {
      const numericFields = ['price', 'urgentPrice', 'dryCleanPrice', 'ironOnlyPrice', 'urgentIronOnlyPrice', 'urgentDryCleanPrice', 'smallPrice', 'mediumPrice', 'largePrice', 'smallUrgentPrice', 'mediumUrgentPrice', 'largeUrgentPrice', 'smallDryCleanPrice', 'mediumDryCleanPrice', 'largeDryCleanPrice', 'smallIronOnlyPrice', 'mediumIronOnlyPrice', 'largeIronOnlyPrice', 'smallUrgentIronOnlyPrice', 'mediumUrgentIronOnlyPrice', 'largeUrgentIronOnlyPrice', 'smallUrgentDryCleanPrice', 'mediumUrgentDryCleanPrice', 'largeUrgentDryCleanPrice', 'sqmPrice'];
      const sanitized = { ...req.body };
      const categorySettings = await storage.getProductCategorySettings();
      const availableCategories = normalizeCategoryNames([
        ...categorySettings.baseCategories,
        ...categorySettings.customCategories,
        ...categorySettings.inventoryDisplayOrder,
        ...categorySettings.orderDisplayOrder,
      ]);
      for (const field of numericFields) {
        if (sanitized[field] === '' || sanitized[field] === null) {
          sanitized[field] = null;
        } else if (sanitized[field] === undefined) {
          delete sanitized[field];
        }
      }
      if ("category" in sanitized) {
        sanitized.category = normalizeStoredProductCategoryName(
          sanitized.category,
          availableCategories,
        );
      }
      const input = api.products.update.input.parse(sanitized);
      const productId = Number(req.params.id);
      if (isNaN(productId)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      const product = await storage.updateProduct(productId, input);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.products.delete.path, async (req, res) => {
    const productId = Number(req.params.id);
    if (isNaN(productId)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    await storage.deleteProduct(productId);
    res.status(204).send();
  });

  // Bill routes
  app.get(api.bills.list.path, async (req, res) => {
    const billList = await storage.getBills();
    res.json(billList);
  });

  app.get(api.bills.filterSummary.path, async (req, res) => {
    try {
      const filters = billFilterSummaryInputSchema.parse({
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        timePeriod: typeof req.query.timePeriod === "string" ? req.query.timePeriod : undefined,
        paymentFilter:
          typeof req.query.paymentFilter === "string"
            ? req.query.paymentFilter
            : undefined,
        exactDate: typeof req.query.exactDate === "string" ? req.query.exactDate : undefined,
        customDateFrom:
          typeof req.query.customDateFrom === "string"
            ? req.query.customDateFrom
            : undefined,
        customDateTo:
          typeof req.query.customDateTo === "string"
            ? req.query.customDateTo
            : undefined,
        rangeApplied:
          typeof req.query.rangeApplied === "string"
            ? req.query.rangeApplied
            : undefined,
      });

      const [billList, clientList] = await Promise.all([
        storage.getBills(),
        storage.getClients(),
      ]);
      const clientById = new Map(clientList.map((client) => [client.id, client]));

      res.json(buildBillFilterSummary(billList, clientById, filters));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.get(api.bills.get.path, async (req, res) => {
    const billId = Number(req.params.id);
    if (isNaN(billId)) {
      return res.status(400).json({ message: "Invalid bill ID" });
    }
    const bill = await storage.getBill(billId);
    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }
    res.json(bill);
  });

  app.post(api.bills.create.path, async (req, res) => {
    try {
      const input = api.bills.create.input.parse(req.body);
      const bill = await storage.createBill(input);
      res.status(201).json(bill);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.delete(api.bills.delete.path, async (req, res) => {
    const billId = Number(req.params.id);
    const { adminPin, adminPassword } = extractAdminCredentials(req);
    if (isNaN(billId)) {
      return res.status(400).json({ message: "Invalid bill ID" });
    }
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAuthorized = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAuthorized) {
      return res.status(401).json({ message: "Invalid admin PIN" });
    }

    // Find and delete all orders linked to this bill
    const allOrders = await storage.getOrders();
    const linkedOrders = allOrders.filter((o: any) => o.billId === billId);

    // Restore client deposit if bill was paid by deposit
    const bill = await storage.getBill(billId);
    if (bill && bill.clientId) {
      const client = await storage.getClient(bill.clientId);
      if (client) {
        const txRes = await storage.getClientTransactions(bill.clientId);
        let depositToRestore = 0;
        for (const tx of txRes) {
          if ((tx.type === "deposit_used" || tx.type === "bulk_deposit_used") && tx.description?.includes(`Bill #${billId}`)) {
            depositToRestore += parseFloat(tx.amount || "0");
          }
        }
        if (depositToRestore > 0) {
          const currentDeposit = parseFloat(client.deposit || "0");
          await storage.updateClient(client.id, { deposit: (currentDeposit + depositToRestore).toFixed(2) });
        }
      }
      // Delete transactions related to this bill
      const transactions = await storage.getClientTransactions(bill.clientId);
      for (const tx of transactions) {
        if (tx.description?.includes(`Bill #${billId}`)) {
          await storage.deleteClientTransaction(tx.id);
        }
      }
    }

    for (const order of linkedOrders) {
      await storage.deleteOrder(order.id);
    }
    await storage.deleteBill(billId);
    res.status(204).send();
  });

  app.post("/api/bills/:id/delete", async (req, res) => {
    const billId = Number(req.params.id);
    const { adminPin, adminPassword } = extractAdminCredentials(req);
    if (isNaN(billId)) {
      return res.status(400).json({ message: "Invalid bill ID" });
    }
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAuthorized = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAuthorized) {
      return res.status(401).json({ message: "Invalid admin PIN" });
    }

    const allOrders = await storage.getOrders();
    const linkedOrders = allOrders.filter((o: any) => o.billId === billId);

    const bill = await storage.getBill(billId);
    if (bill && bill.clientId) {
      const client = await storage.getClient(bill.clientId);
      if (client) {
        const txRes = await storage.getClientTransactions(bill.clientId);
        let depositToRestore = 0;
        for (const tx of txRes) {
          if ((tx.type === "deposit_used" || tx.type === "bulk_deposit_used") && tx.description?.includes(`Bill #${billId}`)) {
            depositToRestore += parseFloat(tx.amount || "0");
          }
        }
        if (depositToRestore > 0) {
          const currentDeposit = parseFloat(client.deposit || "0");
          await storage.updateClient(client.id, { deposit: (currentDeposit + depositToRestore).toFixed(2) });
        }
      }

      const transactions = await storage.getClientTransactions(bill.clientId);
      for (const tx of transactions) {
        if (tx.description?.includes(`Bill #${billId}`)) {
          await storage.deleteClientTransaction(tx.id);
        }
      }
    }

    for (const order of linkedOrders) {
      await storage.deleteOrder(order.id);
    }
    await storage.deleteBill(billId);
    res.status(204).send();
  });

  // Client bills routes
  app.get("/api/clients/:id/bills", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const bills = await storage.getClientBills(clientId);
    res.json(bills);
  });

  app.get("/api/clients/:id/unpaid-bills", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const bills = await storage.getUnpaidBills(clientId);
    res.json(bills);
  });

  app.get("/api/clients/:id/orders", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const clientOrders = await storage.getClientOrders(clientId);
    res.json(clientOrders);
  });

  // Delete all orders for a client
  app.delete("/api/clients/:id/orders", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    // Get all orders for this client
    const clientOrders = await storage.getClientOrders(clientId);

    // Delete each order
    for (const order of clientOrders) {
      await storage.deleteOrder(order.id);
    }

    // Also delete related bills for this client
    const clientBills = await storage.getClientBills(clientId);
    for (const bill of clientBills) {
      await storage.deleteBill(bill.id);
    }

    // Delete transactions for this client
    const transactions = await storage.getClientTransactions(clientId);
    for (const tx of transactions) {
      await storage.deleteClientTransaction(tx.id);
    }

    // Reset client balance
    await storage.updateClient(clientId, {
      amount: "0.00",
      deposit: "0.00",
      balance: "0.00",
    });

    res.json({ message: "All orders, bills, and transactions deleted for client" });
  });

  // Bill payments routes
  app.get("/api/bill-payments", async (req, res) => {
    const payments = await storage.getAllBillPayments();
    res.json(payments);
  });

  app.get("/api/bills/:id/payments", async (req, res) => {
    const billId = Number(req.params.id);
    if (isNaN(billId)) {
      return res.status(400).json({ message: "Invalid bill ID" });
    }
    const payments = await storage.getBillPayments(billId);
    res.json(payments);
  });

  app.get("/api/clients/:id/bill-payments", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const payments = await storage.getClientBillPayments(clientId);
    res.json(payments);
  });

  const normalizeBillPaymentMethodKey = (value?: string | null) => {
    const normalized = String(value || "").trim().toLowerCase();

    switch (normalized) {
      case "credit":
      case "deposit":
      case "bulk_deposit":
      case "bulk deposit":
        return "deposit";
      case "bank transfer":
      case "bank":
      case "transfer":
        return "bank";
      default:
        return normalized;
    }
  };

  const syncClientTransactionDateForBillPayment = async (
    originalPayment: any,
    updatedPayment: any,
  ) => {
    const relatedTransactions = await db.select().from(clientTransactions).where(
      and(
        eq(clientTransactions.billId, updatedPayment.billId),
        not(eq(clientTransactions.type, "bill")),
      ),
    );

    if (relatedTransactions.length === 0) {
      return false;
    }

    const originalPaymentTime = new Date(originalPayment.paymentDate).getTime();
    const paymentAmount = parseFloat(String(originalPayment.amount || "0"));
    const paymentMethodKey = normalizeBillPaymentMethodKey(updatedPayment.paymentMethod);
    const preferredTypes =
      paymentMethodKey === "deposit"
        ? new Set(["deposit_used", "bulk_deposit_used"])
        : new Set(["payment", "bulk_payment"]);

    const rankedCandidates = relatedTransactions
      .map((transaction) => {
        const transactionType = String(transaction.type || "").trim().toLowerCase();
        const transactionMethodKey = normalizeBillPaymentMethodKey(transaction.paymentMethod);
        const transactionAmount = parseFloat(String(transaction.amount || "0"));
        const transactionTime = new Date(transaction.date).getTime();

        return {
          transaction,
          typeRank: preferredTypes.has(transactionType) ? 0 : transactionType === "deposit" ? 1 : 2,
          methodRank:
            paymentMethodKey && transactionMethodKey === paymentMethodKey ? 0 : 1,
          amountRank:
            Number.isFinite(paymentAmount) &&
            Number.isFinite(transactionAmount) &&
            Math.abs(transactionAmount - paymentAmount) <= 0.009
              ? 0
              : 1,
          timeDistance:
            Number.isFinite(originalPaymentTime) && Number.isFinite(transactionTime)
              ? Math.abs(transactionTime - originalPaymentTime)
              : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((left, right) => {
        if (left.typeRank !== right.typeRank) return left.typeRank - right.typeRank;
        if (left.methodRank !== right.methodRank) return left.methodRank - right.methodRank;
        if (left.amountRank !== right.amountRank) return left.amountRank - right.amountRank;
        if (left.timeDistance !== right.timeDistance) {
          return left.timeDistance - right.timeDistance;
        }
        return left.transaction.id - right.transaction.id;
      });

    const bestMatch = rankedCandidates[0];
    if (!bestMatch) {
      return false;
    }

    const hasStrongMatch =
      bestMatch.typeRank === 0 &&
      (bestMatch.amountRank === 0 ||
        (bestMatch.methodRank === 0 && bestMatch.timeDistance <= 5 * 60 * 1000));
    const hasFallbackMatch =
      bestMatch.typeRank <= 1 &&
      bestMatch.amountRank === 0 &&
      bestMatch.timeDistance <= 24 * 60 * 60 * 1000;

    if (!hasStrongMatch && !hasFallbackMatch) {
      return false;
    }

    await db
      .update(clientTransactions)
      .set({ date: new Date(updatedPayment.paymentDate) } as any)
      .where(eq(clientTransactions.id, bestMatch.transaction.id));

    return true;
  };

  app.patch("/api/bill-payments/move-dates", async (req, res) => {
    try {
      const { paymentIds, newDate, staffPin, adminPin, requireAdminPin } = req.body || {};
      const selectedPaymentIds = Array.isArray(paymentIds)
        ? Array.from(new Set(paymentIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];

      if (selectedPaymentIds.length === 0) {
        return res.status(400).json({ message: "Select at least one payment to move" });
      }
      if (!newDate) {
        return res.status(400).json({ message: "New date is required" });
      }
      if (requireAdminPin) {
        const isAdminValid = await verifyAdminPin(String(adminPin || ""));
        if (!isAdminValid) {
          return res.status(401).json({ message: "Invalid admin PIN" });
        }
      } else {
        const pinAccess = await resolveOrderEditPinAccess(String(staffPin || adminPin || ""));
        if (!pinAccess) {
          return res.status(401).json({ message: "Invalid admin or counter PIN" });
        }
      }

      const parsedDate = new Date(newDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      const existingPayments = await db
        .select()
        .from(billPayments)
        .where(inArray(billPayments.id, selectedPaymentIds));
      if (existingPayments.length === 0) {
        return res.status(404).json({ message: "Bill payments not found" });
      }

      const existingPaymentById = new Map(
        existingPayments.map((payment) => [Number(payment.id), payment]),
      );
      const updatedPayments = await db
        .update(billPayments)
        .set({ paymentDate: parsedDate })
        .where(inArray(billPayments.id, existingPayments.map((payment) => payment.id)))
        .returning();

      let syncedClientTransactionCount = 0;
      for (const updatedPayment of updatedPayments) {
        const existingPayment = existingPaymentById.get(Number(updatedPayment.id));
        if (!existingPayment) continue;

        const syncedClientTransaction = await syncClientTransactionDateForBillPayment(
          existingPayment,
          updatedPayment,
        );
        if (syncedClientTransaction) {
          syncedClientTransactionCount += 1;
        }
      }

      storage.notifyLiveResourceUpdated("bills");
      if (syncedClientTransactionCount > 0) {
        storage.notifyLiveResourceUpdated("clientTransactions");
      }

      res.json({
        updatedCount: updatedPayments.length,
        requestedCount: selectedPaymentIds.length,
        syncedClientTransactionCount,
        payments: updatedPayments,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to move payment dates" });
    }
  });

  app.patch("/api/bill-payments/:id/date", async (req, res) => {
    try {
      const paymentId = Number(req.params.id);
      if (isNaN(paymentId)) {
        return res.status(400).json({ message: "Invalid payment ID" });
      }
      const { newDate, staffPin, adminPin, requireAdminPin } = req.body || {};
      if (!newDate) {
        return res.status(400).json({ message: "New date is required" });
      }
      if (requireAdminPin) {
        const isAdminValid = await verifyAdminPin(String(adminPin || ""));
        if (!isAdminValid) {
          return res.status(401).json({ message: "Invalid admin PIN" });
        }
      } else {
        const pinAccess = await resolveOrderEditPinAccess(String(staffPin || adminPin || ""));
        if (!pinAccess) {
          return res.status(401).json({ message: "Invalid admin or counter PIN" });
        }
      }
      const parsedDate = new Date(newDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      const [existingPayment] = await db
        .select()
        .from(billPayments)
        .where(eq(billPayments.id, paymentId));
      if (!existingPayment) {
        return res.status(404).json({ message: "Bill payment not found" });
      }
      const updated = await storage.updateBillPaymentDate(paymentId, parsedDate);
      const syncedClientTransaction = await syncClientTransactionDateForBillPayment(
        existingPayment,
        updated,
      );
      if (syncedClientTransaction) {
        storage.notifyLiveResourceUpdated("clientTransactions");
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bills/:id/pay", async (req, res) => {
    try {
      const { amount, paymentMethod, notes, processedBy, staffPin } = req.body;
      const processedByFromPin = await resolveProcessedByFromPin(staffPin);
      const processedByName = String(processedByFromPin || processedBy || "admin").trim() || "admin";
      if (!amount || parseFloat(amount) <= 0) {
        return res
          .status(400)
          .json({ message: "Valid payment amount is required" });
      }
      const billId = Number(req.params.id);
      if (isNaN(billId)) {
        return res.status(400).json({ message: "Invalid bill ID" });
      }
      const result = await storage.payBill(
        billId,
        amount,
        paymentMethod,
        notes,
        processedByName,
      );
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bills/pay-selected", async (req, res) => {
    try {
      const {
        billIds,
        amount,
        paymentMethod = "cash",
        notes,
        processedBy,
        discountAmount,
        overpaymentClientId,
      } = req.body || {};
      const processedByName = String(processedBy || "admin").trim() || "admin";

      const selectedBillIds = Array.isArray(billIds)
        ? Array.from(new Set(billIds.map(Number).filter(Number.isFinite)))
        : [];
      if (selectedBillIds.length === 0) {
        return res.status(400).json({ message: "Select at least one bill" });
      }

      const parsedPaymentAmount = parseFloat(String(amount || "0"));
      const paymentAmount = Number.isFinite(parsedPaymentAmount) ? parsedPaymentAmount : 0;
      const discountToApply = Math.max(0, parseFloat(String(discountAmount || "0")) || 0);
      if (paymentAmount <= 0 && discountToApply <= 0) {
        return res.status(400).json({ message: "Provide a payment amount or discount amount" });
      }
      const discountPinAccess =
        discountToApply > 0 ? await resolveAdminOrCounterPinFromRequest(req) : null;
      if (discountToApply > 0 && !discountPinAccess) {
        return res.status(401).json({ message: "Invalid admin or counter PIN" });
      }

      const selectedBillIdSet = new Set(selectedBillIds);
      const allBills = await storage.getBills();
      const selectedBills = sortBillsFIFO(
        allBills.filter((bill) => selectedBillIdSet.has(bill.id)),
      );
      if (selectedBills.length === 0) {
        return res.status(400).json({ message: "No selected bills found" });
      }

      if (selectedBills.some((bill) => !bill.clientId)) {
        return res.status(400).json({
          message:
            "Selected bills must be linked to client accounts so payment history can be recorded.",
        });
      }

      const outstandingSelectedBills = selectedBills.filter((bill) => getBillDue(bill) > 0.01);
      if (outstandingSelectedBills.length === 0) {
        return res.status(400).json({ message: "No unpaid selected bills found" });
      }

      const affectedClientIds = Array.from(
        new Set(
          selectedBills
            .map((bill) => bill.clientId)
            .filter((clientId): clientId is number => Number.isFinite(clientId)),
        ),
      );

      if (paymentMethod === "deposit") {
        if (affectedClientIds.length !== 1) {
          return res.status(400).json({
            message: "Credit payment is only available when all selected bills belong to one client.",
          });
        }

        if (paymentAmount > 0) {
          const client = await storage.getClient(affectedClientIds[0]);
          if (!client) {
            return res.status(404).json({ message: "Client not found" });
          }

          const currentDeposit = parseFloat(client.deposit || "0");
          if (currentDeposit < paymentAmount) {
            return res.status(400).json({
              message: `Insufficient credit balance. Available: ${currentDeposit.toFixed(2)} AED, Required: ${paymentAmount.toFixed(2)} AED`,
            });
          }
        }
      }

      const taggedNotes = appendSharedPaymentTag(
        notes,
        selectedBills.length,
        affectedClientIds.length,
      );
      const discountBy = discountPinAccess?.name || `selected:${Date.now()}`;
      const discountResult = await applyFifoDiscounts(
        outstandingSelectedBills,
        discountToApply,
        discountBy,
      );

      const refreshedBills = sortBillsFIFO(
        (await storage.getBills()).filter(
          (bill) => selectedBillIdSet.has(bill.id) && getBillDue(bill) > 0.01,
        ),
      );
      const totalDueAfterDiscount = refreshedBills.reduce((sum, bill) => sum + getBillDue(bill), 0);
      const normalizedOverpaymentClientId = Number(overpaymentClientId);

      if (
        normalizeBillPaymentMethodKey(paymentMethod) !== "deposit" &&
        paymentAmount > totalDueAfterDiscount + 0.01 &&
        affectedClientIds.length > 1 &&
        (!Number.isFinite(normalizedOverpaymentClientId) ||
          !affectedClientIds.includes(normalizedOverpaymentClientId))
      ) {
        return res.status(400).json({
          message: "Select which client account should receive the overpayment credit.",
        });
      }

      let remainingPayment = Math.max(0, paymentAmount);
      const paidBills: Array<{ billId: number; clientId: number; amountPaid: number }> = [];
      let creditedOverpayment: { clientId: number; amount: number; accountLabel: string } | null = null;

      for (const bill of refreshedBills) {
        if (remainingPayment <= 0) break;
        const due = getBillDue(bill);
        if (due <= 0) continue;

        const payForBill = Math.min(remainingPayment, due);
        if (payForBill <= 0) continue;

        await storage.payBill(
          bill.id,
          normalizeMoney(payForBill),
          paymentMethod,
          taggedNotes,
          processedByName,
          false,
        );

        paidBills.push({
          billId: bill.id,
          clientId: bill.clientId as number,
          amountPaid: payForBill,
        });
        remainingPayment -= payForBill;
      }

      for (const clientId of affectedClientIds) {
        await recalcClientBalanceFromBills(clientId);
      }

      if (remainingPayment > 0.01) {
        const creditClientId =
          affectedClientIds.length === 1
            ? affectedClientIds[0]
            : normalizedOverpaymentClientId;

        creditedOverpayment = await addCreditToClientAccount({
          clientId: creditClientId,
          amount: remainingPayment,
          paymentMethod,
          processedBy: processedByName,
          description: buildCreditAdjustmentDescription(
            "Credit added from selected bills overpayment",
            [
              ...paidBills.map((entry) => entry.billId),
              ...discountResult.applied.map((entry) => entry.billId),
            ],
            notes,
          ),
        });
        if (creditedOverpayment) {
          remainingPayment = 0;
        }
      }

      const paidTotal = paidBills.reduce((sum, bill) => sum + bill.amountPaid, 0);
      res.status(200).json({
        success: true,
        message: `${`Payment ${normalizeMoney(paidTotal)} AED and discount ${normalizeMoney(discountResult.appliedTotal)} AED applied to ${selectedBills.length} selected bill(s).`}${creditedOverpayment ? ` Overpayment ${normalizeMoney(creditedOverpayment.amount)} AED added to ${creditedOverpayment.accountLabel}.` : ""}`,
        paidBills,
        affectedClientIds,
        discountAllocations: discountResult.applied,
        creditedAmount: creditedOverpayment ? normalizeMoney(creditedOverpayment.amount) : "0.00",
        creditedClientId: creditedOverpayment?.clientId || null,
        remainingAmount: remainingPayment > 0.01 ? remainingPayment : 0,
        unappliedDiscount: discountResult.unapplied > 0.01 ? discountResult.unapplied : 0,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to pay selected bills" });
    }
  });

  app.post("/api/bills/:id/revert-payment", async (req, res) => {
    try {
      const billId = Number(req.params.id);
      if (isNaN(billId)) {
        return res.status(400).json({ message: "Invalid bill ID" });
      }
      const { adminPassword, adminPin, revertedBy } = req.body;
      if (!adminPin && !adminPassword) {
        return res.status(400).json({ message: "Admin PIN required" });
      }
      const isAdminValid = adminPin
        ? await verifyAdminPin(String(adminPin || ""))
        : await verifyAdminPassword(String(adminPassword || ""));
      if (!isAdminValid) {
        return res
          .status(403)
          .json({ message: adminPin ? "Invalid admin PIN" : "Invalid admin password" });
      }

      const bill = await storage.getBill(billId);
      if (!bill) {
        return res.status(404).json({ message: "Bill not found" });
      }

      let detectedBulkGroup: string | null = null;
      const billPaymentsForBill = await storage.getBillPayments(billId);
      for (const payment of billPaymentsForBill) {
        detectedBulkGroup = extractBulkGroupFromText(payment.notes);
        if (detectedBulkGroup) break;
      }

      if (!detectedBulkGroup && bill.clientId) {
        const clientTxRows = await db
          .select()
          .from(clientTransactions)
          .where(eq(clientTransactions.clientId, bill.clientId));
        for (const tx of clientTxRows) {
          const description = String(tx.description || "");
          if (!description.includes(`#${billId}`)) continue;
          detectedBulkGroup = extractBulkGroupFromText(description);
          if (detectedBulkGroup) break;
        }
      }

      if (detectedBulkGroup) {
        const result = await revertBulkPaymentGroup(detectedBulkGroup, revertedBy || "admin");
        return res.json({
          success: true,
          bulkGroup: detectedBulkGroup,
          revertedBills: result.revertedBills,
          message: `Reverted ${result.revertedBills.length} bill(s) for bulk group ${detectedBulkGroup}`,
        });
      }

      if (parseMoney(bill.paidAmount) <= 0.009 && parseMoney(bill.discountAmount) > 0.009) {
        const clearedDiscountBill = await revertDiscountOnlyBill(billId, revertedBy || "admin");
        if (!clearedDiscountBill) {
          return res.status(404).json({ message: "Bill not found" });
        }
        return res.json(clearedDiscountBill);
      }

      const updatedBill = await storage.revertBillPayment(billId, revertedBy);
      res.json(updatedBill);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bill-payments/revert-selected", async (req, res) => {
    try {
      const { adminPin, adminPassword } = extractAdminCredentials(req);
      const { paymentIds, billIds, revertedBy } = req.body || {};

      if (!adminPin && !adminPassword) {
        return res.status(400).json({ message: "Admin PIN required" });
      }

      const isAdminValid = adminPin
        ? await verifyAdminPin(String(adminPin || ""))
        : await verifyAdminPassword(String(adminPassword || ""));
      if (!isAdminValid) {
        return res
          .status(403)
          .json({ message: adminPin ? "Invalid admin PIN" : "Invalid admin password" });
      }

      const selectedPaymentIds = Array.isArray(paymentIds)
        ? Array.from(new Set(paymentIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];
      const selectedBillIds = Array.isArray(billIds)
        ? Array.from(new Set(billIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)))
        : [];

      if (selectedPaymentIds.length === 0 && selectedBillIds.length === 0) {
        return res.status(400).json({ message: "Select at least one payment to revert" });
      }

      const targetBillIds = new Set<number>(selectedBillIds);
      if (selectedPaymentIds.length > 0) {
        const selectedPaymentIdSet = new Set(selectedPaymentIds);
        const allPayments = await storage.getAllBillPayments();
        for (const payment of allPayments) {
          if (selectedPaymentIdSet.has(Number(payment.id || 0))) {
            const billId = Number(payment.billId || 0);
            if (Number.isFinite(billId) && billId > 0) {
              targetBillIds.add(billId);
            }
          }
        }
      }

      if (targetBillIds.size === 0) {
        return res.status(404).json({ message: "No linked bills found for selected payments" });
      }

      const result = await revertSelectedBillPayments(
        Array.from(targetBillIds),
        String(revertedBy || "admin").trim() || "admin",
      );

      if (result.revertedBills.length === 0) {
        return res.status(404).json({
          message:
            result.failedBills[0]?.message ||
            "No selected payment could be reverted",
          failedBills: result.failedBills,
        });
      }

      storage.notifyLiveResourceUpdated("bills");
      storage.notifyLiveResourceUpdated("clientTransactions");

      res.json({
        success: true,
        revertedBills: result.revertedBills,
        bulkGroups: result.bulkGroups,
        failedBills: result.failedBills,
        message: `Reverted ${result.revertedBills.length} bill payment${result.revertedBills.length === 1 ? "" : "s"}`,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to revert selected payments" });
    }
  });

  app.patch("/api/bills/:id/payment-method", async (req, res) => {
    try {
      const billId = Number(req.params.id);
      if (isNaN(billId)) {
        return res.status(400).json({ message: "Invalid bill ID" });
      }
      const { paymentMethod } = req.body;
      if (!paymentMethod || !["cash", "card", "transfer", "deposit"].includes(paymentMethod)) {
        return res.status(400).json({ message: "Valid payment method is required (cash, card, transfer, deposit)" });
      }

      const normalizePaymentMethodKey = (value?: string | null) => {
        const normalized = String(value || "").trim().toLowerCase();
        if (normalized === "bank") return "transfer";
        return normalized;
      };

      const formatPaymentMethodLabel = (value?: string | null) => {
        switch (normalizePaymentMethodKey(value)) {
          case "deposit":
            return "Account Credit";
          case "card":
            return "Card";
          case "transfer":
            return "Bank Transfer";
          case "cash":
            return "Cash";
          default:
            return String(value || "").trim() || "Cash";
        }
      };

      const convertBillTransactionDescription = (
        description: string | null | undefined,
        useDeposit: boolean,
      ) => {
        const fallback = useDeposit
          ? `Deposit used for Bill #${billId}`
          : `Payment for Bill #${billId}`;
        const text = String(description || "").trim();
        if (!text) return fallback;

        return useDeposit
          ? text.replace(/Payment for Bill/gi, "Deposit used for Bill")
          : text.replace(/Deposit used for Bill/gi, "Payment for Bill");
      };

      const bill = await storage.getBill(billId);
      if (!bill) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const currentMethod = String(bill.paymentMethod || "").trim().toLowerCase();
      if (!currentMethod) {
        return res.status(400).json({ message: "This bill has no editable payment method." });
      }
      if (currentMethod.includes("+")) {
        return res.status(400).json({ message: "Split payment methods cannot be changed." });
      }

      const targetMethod = normalizePaymentMethodKey(paymentMethod);
      const paymentsForBill = await storage.getBillPayments(billId);
      const paymentMethodKeys = Array.from(
        new Set(
          paymentsForBill
            .map((entry) => normalizePaymentMethodKey(entry.paymentMethod))
            .filter(Boolean),
        ),
      );

      if (paymentMethodKeys.length > 1) {
        return res.status(400).json({ message: "Split payment methods cannot be changed." });
      }

      const sourceMethod =
        paymentMethodKeys[0] || normalizePaymentMethodKey(bill.paymentMethod);

      if (!sourceMethod) {
        return res.status(400).json({ message: "This bill has no editable payment method." });
      }

      if (sourceMethod === targetMethod) {
        const updatedBill = await storage.updateBill(billId, { paymentMethod: targetMethod });
        await db.update(orders).set({ paymentMethod: targetMethod }).where(eq(orders.billId, billId));
        return res.json(updatedBill);
      }

      const settledAmount = parseMoney(bill.paidAmount);
      if (settledAmount <= 0.009) {
        return res.status(400).json({ message: "Only paid bills can change payment method." });
      }

      const processedBy = String(req.body?.processedBy || "admin").trim() || "admin";
      const changeTimestamp = new Date();
      const sourceMethodLabel = formatPaymentMethodLabel(sourceMethod);
      const targetMethodLabel = formatPaymentMethodLabel(targetMethod);
      const paymentChangeNote = `\n[${changeTimestamp.toLocaleString()}] PAYMENT METHOD CHANGED by ${processedBy}. ${sourceMethodLabel} -> ${targetMethodLabel}. Amount ${settledAmount.toFixed(2)} AED.`;
      const updatedBillNotes = `${bill.notes || ""}${paymentChangeNote}`.trim();

      if ((sourceMethod === "deposit" || targetMethod === "deposit") && !bill.clientId) {
        return res.status(400).json({ message: "Account Credit payment method changes require a linked client account." });
      }

      await db.transaction(async (tx) => {
        if (bill.clientId && (sourceMethod === "deposit" || targetMethod === "deposit")) {
          const [client] = await tx.select().from(clients).where(eq(clients.id, bill.clientId));
          if (!client) {
            throw new Error("Client not found");
          }

          const currentDeposit = parseMoney(client.deposit);
          const currentAmount = parseMoney(client.amount);
          let nextDeposit = currentDeposit;

          if (sourceMethod === "deposit" && targetMethod !== "deposit") {
            nextDeposit += settledAmount;
          } else if (sourceMethod !== "deposit" && targetMethod === "deposit") {
            if (currentDeposit + 0.009 < settledAmount) {
              throw new Error(
                `Insufficient credit balance. Available: ${currentDeposit.toFixed(2)} AED, Required: ${settledAmount.toFixed(2)} AED`,
              );
            }
            nextDeposit -= settledAmount;
          }

          const nextBalance = currentAmount - nextDeposit;

          await tx
            .update(clients)
            .set({
              deposit: nextDeposit.toFixed(2),
              balance: nextBalance.toFixed(2),
            })
            .where(eq(clients.id, bill.clientId));

          const relatedTransactions = await tx
            .select()
            .from(clientTransactions)
            .where(
              and(
                eq(clientTransactions.clientId, bill.clientId),
                eq(clientTransactions.billId, billId),
              ),
            );

          const typeMapToDeposit: Record<string, string> = {
            payment: "deposit_used",
            bulk_payment: "bulk_deposit_used",
            deposit_used: "deposit_used",
            bulk_deposit_used: "bulk_deposit_used",
          };
          const typeMapFromDeposit: Record<string, string> = {
            deposit_used: "payment",
            bulk_deposit_used: "bulk_payment",
            payment: "payment",
            bulk_payment: "bulk_payment",
          };

          const isCrossingDepositBoundary =
            (sourceMethod === "deposit" && targetMethod !== "deposit") ||
            (sourceMethod !== "deposit" && targetMethod === "deposit");

          if (isCrossingDepositBoundary) {
            if (sourceMethod === "deposit" && targetMethod !== "deposit") {
              await tx.insert(clientTransactions).values({
                clientId: bill.clientId,
                billId,
                type: "deposit",
                amount: settledAmount.toFixed(2),
                description: `Account credit returned after payment method change for Bill #${billId}: ${sourceMethodLabel} -> ${targetMethodLabel}`,
                date: changeTimestamp,
                runningBalance: nextBalance.toFixed(2),
                paymentMethod: "deposit",
                processedBy,
              });

              await tx.insert(clientTransactions).values({
                clientId: bill.clientId,
                billId,
                type: "payment",
                amount: settledAmount.toFixed(2),
                description: `Payment method changed for Bill #${billId}: ${sourceMethodLabel} -> ${targetMethodLabel}`,
                date: changeTimestamp,
                runningBalance: nextBalance.toFixed(2),
                paymentMethod: targetMethod,
                processedBy,
              });
            } else {
              await tx.insert(clientTransactions).values({
                clientId: bill.clientId,
                billId,
                type: "deposit_used",
                amount: settledAmount.toFixed(2),
                description: `Payment method changed for Bill #${billId}: ${sourceMethodLabel} -> ${targetMethodLabel}`,
                date: changeTimestamp,
                runningBalance: nextBalance.toFixed(2),
                paymentMethod: "deposit",
                processedBy,
              });
            }
          } else {
            for (const transaction of relatedTransactions) {
              if (!["payment", "bulk_payment", "deposit_used", "bulk_deposit_used"].includes(transaction.type)) {
                continue;
              }

              const nextType =
                targetMethod === "deposit"
                  ? (typeMapToDeposit[transaction.type] || transaction.type)
                  : (typeMapFromDeposit[transaction.type] || transaction.type);

              await tx
                .update(clientTransactions)
                .set({
                  type: nextType,
                  paymentMethod: targetMethod,
                  description: convertBillTransactionDescription(transaction.description, targetMethod === "deposit"),
                  runningBalance: nextBalance.toFixed(2),
                })
                .where(eq(clientTransactions.id, transaction.id));
            }
          }
        }

        if (paymentsForBill.length > 0) {
          await tx
            .update(billPayments)
            .set({ paymentMethod: targetMethod })
            .where(eq(billPayments.billId, billId));
        }

        await tx
          .update(bills)
          .set({
            paymentMethod: targetMethod,
            notes: updatedBillNotes,
          })
          .where(eq(bills.id, billId));

        await tx
          .update(orders)
          .set({ paymentMethod: targetMethod })
          .where(eq(orders.billId, billId));
      });

      const updatedBill = await storage.getBill(billId);
      storage.notifyLiveResourceUpdated("clientTransactions");
      storage.notifyLiveResourceUpdated("bills");
      res.json(updatedBill);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bills/:id/transfer-client", async (req, res) => {
    try {
      const billId = Number(req.params.id);
      const targetClientId = Number(req.body?.targetClientId);
      const { adminPin, adminPassword } = extractAdminCredentials(req);
      const processedBy = String(req.body?.processedBy || "admin").trim() || "admin";
      const transferReason = String(req.body?.reason || "").trim();

      if (isNaN(billId) || billId <= 0) {
        return res.status(400).json({ message: "Invalid bill ID" });
      }

      if (isNaN(targetClientId) || targetClientId <= 0) {
        return res.status(400).json({ message: "Select the target client account" });
      }

      if (!adminPin && !adminPassword) {
        return res.status(400).json({ message: "Admin PIN required" });
      }

      const isAuthorized = adminPin
        ? await verifyAdminPin(String(adminPin || ""))
        : await verifyAdminPassword(String(adminPassword || ""));
      if (!isAuthorized) {
        return res.status(401).json({ message: "Invalid admin PIN" });
      }

      const bill = await storage.getBill(billId);
      if (!bill) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const targetClient = await storage.getClient(targetClientId);
      if (!targetClient) {
        return res.status(404).json({ message: "Target client not found" });
      }

      const sourceClientId = Number.isFinite(Number(bill.clientId)) ? Number(bill.clientId) : null;
      if (sourceClientId === targetClientId) {
        return res.status(400).json({ message: "Bill is already assigned to this client account" });
      }

      const sourceClient = sourceClientId ? await storage.getClient(sourceClientId) : null;
      const linkedOrders = await db.select().from(orders).where(eq(orders.billId, billId));
      const relatedTransactions = await db
        .select()
        .from(clientTransactions)
        .where(eq(clientTransactions.billId, billId));

      if (sourceClientId) {
        const sourceTransactions = await storage.getClientTransactions(sourceClientId);
        const hasSharedHistoryEntry = sourceTransactions.some((transaction) => {
          if (transaction.billId) return false;
          const description = String(transaction.description || "");
          return (
            description.includes(`#${billId}`) &&
            ["bulk_payment", "bulk_deposit_used", "company_payment"].includes(
              String(transaction.type || "").trim().toLowerCase(),
            )
          );
        });

        if (hasSharedHistoryEntry) {
          return res.status(400).json({
            message:
              "This bill is included in a shared payment history entry. Revert or separate that payment before transferring the bill.",
          });
        }
      }

      const movedCreditAmount = relatedTransactions.reduce((sum, transaction) => {
        if (String(transaction.type || "").trim().toLowerCase() !== "deposit") {
          return sum;
        }
        return sum + parseMoney(transaction.amount);
      }, 0);

      const movedCreditUsageAmount = relatedTransactions.reduce((sum, transaction) => {
        const normalizedType = String(transaction.type || "").trim().toLowerCase();
        if (!["deposit_deduction", "deposit_used", "bulk_deposit_used"].includes(normalizedType)) {
          return sum;
        }
        return sum + parseMoney(transaction.amount);
      }, 0);

      const sourceDepositDelta = movedCreditUsageAmount - movedCreditAmount;
      const targetDepositDelta = movedCreditAmount - movedCreditUsageAmount;

      if (sourceClient) {
        const nextSourceDeposit = parseMoney(sourceClient.deposit) + sourceDepositDelta;
        if (nextSourceDeposit < -0.009) {
          return res.status(400).json({
            message:
              "The current client account no longer has enough remaining credit history for this transfer. Revert or adjust the related account-credit activity first.",
          });
        }
      }

      const nextTargetDeposit = parseMoney(targetClient.deposit) + targetDepositDelta;
      if (nextTargetDeposit < -0.009) {
        return res.status(400).json({
          message:
            "The target client account does not have enough account credit for the transferred bill history. Add credit first or revert the existing credit payment.",
        });
      }

      const formatClientAccountLabel = (client?: { name?: string | null; billNumber?: string | null } | null) => {
        const clientName = String(client?.name || "").trim() || "Unknown Client";
        const accountNumber = String(client?.billNumber || "").trim();
        return accountNumber ? `${clientName} (${accountNumber})` : clientName;
      };

      const getTransferTargetAddress = (
        client?:
          | {
              address?: string | null;
              brokerAddresses?: Array<string | null> | null;
            }
          | null,
      ) => {
        const primaryAddress = String(client?.address || "").trim();
        if (primaryAddress && primaryAddress !== "-" && primaryAddress !== "0") {
          return primaryAddress.toUpperCase();
        }

        const brokerAddress =
          client?.brokerAddresses
            ?.map((address) => String(address || "").trim())
            .find((address) => !!address && address !== "-" && address !== "0") || "";

        return brokerAddress ? brokerAddress.toUpperCase() : null;
      };

      const sourceLabel = sourceClient ? formatClientAccountLabel(sourceClient) : "Walk-in / Unassigned";
      const targetLabel = formatClientAccountLabel(targetClient);

      await db.transaction(async (tx) => {
        const existingSourceClient = sourceClientId
          ? (await tx.select().from(clients).where(eq(clients.id, sourceClientId)))[0]
          : null;
        const existingTargetClient =
          (await tx.select().from(clients).where(eq(clients.id, targetClientId)))[0] || targetClient;
        const targetPhone = normalizePhoneForStorage(existingTargetClient.phone || "") || null;
        const targetAddress = getTransferTargetAddress(existingTargetClient);

        const transferTimestamp = new Date().toLocaleString();
        const reasonSuffix = transferReason ? ` Reason: ${transferReason}.` : "";
        const transferNote =
          `[${transferTimestamp}] BILL TRANSFERRED by ${processedBy} from ${sourceLabel} to ${targetLabel}.${reasonSuffix}`;
        const updatedNotes = `${bill.notes || ""}${bill.notes ? "\n" : ""}${transferNote}`.trim();

        await tx
          .update(bills)
          .set({
            clientId: targetClientId,
            customerName: existingTargetClient.name,
            customerPhone: targetPhone,
            notes: updatedNotes,
          })
          .where(eq(bills.id, billId));

        await tx
          .update(orders)
          .set({
            clientId: targetClientId,
            customerName: existingTargetClient.name,
            deliveryAddress: targetAddress,
          })
          .where(eq(orders.billId, billId));

        await tx
          .update(billPayments)
          .set({ clientId: targetClientId })
          .where(eq(billPayments.billId, billId));

        await tx
          .update(clientTransactions)
          .set({ clientId: targetClientId })
          .where(eq(clientTransactions.billId, billId));

        const affectedClientIds = Array.from(
          new Set([sourceClientId, targetClientId].filter((clientId): clientId is number => Number.isFinite(clientId))),
        );

        for (const affectedClientId of affectedClientIds) {
          const clientBills = await tx.select().from(bills).where(eq(bills.clientId, affectedClientId));
          const totalBilledAmount = clientBills.reduce(
            (sum, currentBill) => sum + parseMoney(currentBill.amount),
            0,
          );
          const totalDueAmount = clientBills.reduce(
            (sum, currentBill) => sum + getBillDue(currentBill),
            0,
          );

          const existingClient =
            affectedClientId === sourceClientId ? existingSourceClient : existingTargetClient;
          const baseDeposit = parseMoney(existingClient?.deposit);
          const nextDepositValue =
            affectedClientId === sourceClientId
              ? baseDeposit + sourceDepositDelta
              : baseDeposit + targetDepositDelta;

          if (nextDepositValue < -0.009) {
            throw new Error("Client account credit would become negative after this transfer");
          }

          await tx
            .update(clients)
            .set({
              amount: normalizeMoney(totalBilledAmount),
              deposit: normalizeMoney(nextDepositValue),
              balance: normalizeMoney(totalDueAmount),
            })
            .where(eq(clients.id, affectedClientId));

          const accountTransactions = await tx
            .select()
            .from(clientTransactions)
            .where(eq(clientTransactions.clientId, affectedClientId));

          const sortedTransactions = [...accountTransactions].sort((a, b) => {
            const aTime = a.date ? new Date(a.date).getTime() : 0;
            const bTime = b.date ? new Date(b.date).getTime() : 0;
            if (aTime !== bTime) return aTime - bTime;
            return a.id - b.id;
          });

          let cumulativeBills = 0;
          let cumulativePayments = 0;

          for (const transaction of sortedTransactions) {
            const amount = parseMoney(transaction.amount);
            if (String(transaction.type || "").trim().toLowerCase() === "bill") {
              cumulativeBills += amount;
            } else {
              cumulativePayments += amount;
            }

            await tx
              .update(clientTransactions)
              .set({ runningBalance: (cumulativeBills - cumulativePayments).toFixed(2) })
              .where(eq(clientTransactions.id, transaction.id));
          }
        }
      });

      storage.notifyLiveResourceUpdated("bills");
      storage.notifyLiveResourceUpdated("clientTransactions");

      const updatedBill = await storage.getBill(billId);

      res.json({
        message: `Bill transferred from ${sourceLabel} to ${targetLabel}.`,
        bill: updatedBill,
        sourceClientId,
        targetClientId,
        updatedOrderIds: linkedOrders.map((order) => order.id),
      });
    } catch (err: any) {
      console.error("Transfer bill client error:", err);
      res.status(400).json({ message: err.message || "Failed to transfer bill" });
    }
  });

  app.post("/api/bills/:id/apply-discount", async (req, res) => {
    try {
      const billId = Number(req.params.id);
      if (isNaN(billId)) {
        return res.status(400).json({ message: "Invalid bill ID" });
      }
      const { discountAmount, appliedBy } = req.body;
      const pinAccess = await resolveAdminOrCounterPinFromRequest(req);
      if (!pinAccess) {
        return res.status(401).json({ message: "Invalid admin or counter PIN" });
      }

      const discount = parseFloat(discountAmount);
      if (isNaN(discount) || discount < 0) {
        return res.status(400).json({ message: "Valid discount amount is required" });
      }

      const bill = await storage.getBill(billId);
      if (!bill) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const originalAmount = await getBillOriginalAmount(bill);
      if (discount > originalAmount) {
        return res.status(400).json({ message: "Discount cannot exceed bill amount" });
      }

      const syncResult = await syncOrdersForBillDiscount(billId, discount);
      const recalculatedAmount =
        syncResult.billAmountFromOrders != null
          ? syncResult.billAmountFromOrders
          : Math.max(0, originalAmount - discount) +
            Math.max(0, parseMoney(bill.deliveryCharge));
      const paidAmount = parseMoney(bill.paidAmount);
      const newAmount = normalizeMoney(recalculatedAmount);
      const updateData: any = {
        amount: newAmount,
        discountAmount: discount.toFixed(2),
        discountAppliedBy: discount > 0 ? (appliedBy || pinAccess.name || null) : null,
        isPaid: paidAmount >= recalculatedAmount - 0.01,
        originalAmount: normalizeMoney(originalAmount),
      };

      const updatedBill = await storage.updateBill(billId, updateData);

      if (bill.clientId) {
        await recalcClientBalanceFromBills(bill.clientId);
      }

      res.json(updatedBill);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  const getBillDue = (bill: any): number => {
    const amount = parseMoney(bill.amount);
    const paid = parseMoney(bill.paidAmount);
    return Math.max(0, amount - paid);
  };

  const parseMoney = (value: unknown): number => {
    const parsed = parseFloat(String(value ?? "0"));
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
  };

  const normalizeMoney = (n: number): string => Math.max(0, n).toFixed(2);
  const hasMoneyInput = (value: unknown): boolean => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value.trim() === "") return false;
    return Number.isFinite(parseFloat(String(value)));
  };
  const getOrderDeliveryCharge = (order: any): number =>
    Math.max(0, parseMoney(order?.deliveryCharge));
  const getOrderTipsAmount = (order: any): number =>
    Math.max(0, parseMoney(order?.tips));
  const getOrderExtraCharges = (order: any): number =>
    getOrderDeliveryCharge(order) + getOrderTipsAmount(order);

  const hasMeaningfulAdjustment = (order: any): boolean => {
    const adjustedRaw = order?.adjustedTotal;
    const hasAdjustedValue =
      adjustedRaw !== null &&
      adjustedRaw !== undefined &&
      String(adjustedRaw).trim() !== "";
    if (!hasAdjustedValue) return false;
    const reason = String(order?.priceAdjustReason || "").trim();
    return reason.length > 0;
  };

  const getOrderWorkReceivedBase = (order: any): number => {
    // Business rule: Work received = original items total unless there is a real adjustment reason.
    if (hasMeaningfulAdjustment(order)) {
      return Math.max(0, parseMoney(order.adjustedTotal));
    }

    const originalTotal = parseMoney(order.totalAmount);
    if (originalTotal > 0 || String(order?.totalAmount ?? "").trim() !== "") {
      return Math.max(0, originalTotal);
    }

    // Legacy fallback for rows that may not carry totalAmount consistently.
    const finalAmount = parseMoney(order.finalAmount);
    const discountAmount = Math.max(0, parseMoney(order.discountAmount));
    return Math.max(0, finalAmount + discountAmount - getOrderExtraCharges(order));
  };

  const getOrderDiscountAmountForBase = async (order: any, baseAmount?: number): Promise<number> => {
    const discountPercent = Math.max(0, parseMoney(order.discountPercent));
    if (discountPercent > 0) {
      const targetBaseAmount =
        baseAmount !== undefined ? Math.max(0, baseAmount) : getOrderWorkReceivedBase(order);
      return Math.max(0, (targetBaseAmount * discountPercent) / 100);
    }

    const directDiscount = Math.max(0, parseMoney(order.discountAmount));
    if (directDiscount > 0) return directDiscount;

    if (!order.billId) return 0;
    const linkedBill = await storage.getBill(order.billId);
    const billDiscount = Math.max(0, parseMoney(linkedBill?.discountAmount));
    if (billDiscount <= 0) return 0;

    const linkedOrders = await db.select().from(orders).where(eq(orders.billId, order.billId));
    if (linkedOrders.length <= 1) {
      return billDiscount;
    }

    const billBaseTotal = linkedOrders.reduce(
      (sum, linkedOrder) => sum + getOrderWorkReceivedBase(linkedOrder),
      0,
    );
    const orderBaseAmount =
      baseAmount !== undefined ? Math.max(0, baseAmount) : getOrderWorkReceivedBase(order);
    if (billBaseTotal <= 0 || orderBaseAmount <= 0) return 0;

    return Math.max(0, billDiscount * (orderBaseAmount / billBaseTotal));
  };

  const formatDiscountChange = (previousDiscount: number, nextDiscount: number): string | null => {
    if (Math.abs(previousDiscount - nextDiscount) <= 0.009) return null;
    if (nextDiscount <= 0.009) return "Discount cleared";
    return `Discount set to AED ${nextDiscount.toFixed(2)}`;
  };

  const getOrderFinalAmount = (order: any): number => {
    const explicitFinal = parseMoney(order.finalAmount);
    if (explicitFinal > 0 || String(order?.finalAmount ?? "").trim() !== "") {
      return Math.max(0, explicitFinal);
    }

    return Math.max(
      0,
      getOrderWorkReceivedBase(order) -
        Math.max(0, parseMoney(order.discountAmount)) +
        getOrderExtraCharges(order),
    );
  };

  const syncBillFromLinkedOrders = async (
    billId: number,
    options: {
      description?: string | null;
      priceAdjustReason?: string | null;
      discountAppliedBy?: string | null;
    } = {},
  ) => {
    const bill = await storage.getBill(billId);
    if (!bill) return null;

    const linkedOrders = await db.select().from(orders).where(eq(orders.billId, billId));
    if (linkedOrders.length === 0) return bill;

    const originalAmount = linkedOrders.reduce(
      (sum, linkedOrder) => sum + getOrderWorkReceivedBase(linkedOrder),
      0,
    );
    const finalAmount = linkedOrders.reduce(
      (sum, linkedOrder) => sum + getOrderFinalAmount(linkedOrder),
      0,
    );
    const discountAmount = linkedOrders.reduce(
      (sum, linkedOrder) => sum + Math.max(0, parseMoney(linkedOrder.discountAmount)),
      0,
    );
    const deliveryCharge = linkedOrders.reduce(
      (sum, linkedOrder) => sum + getOrderDeliveryCharge(linkedOrder),
      0,
    );

    const billUpdates: any = {
      amount: normalizeMoney(finalAmount),
      originalAmount: normalizeMoney(originalAmount),
      discountAmount: normalizeMoney(discountAmount),
      deliveryCharge: normalizeMoney(deliveryCharge),
      isPaid: parseMoney(bill.paidAmount) >= finalAmount - 0.01,
    };

    if (linkedOrders.length <= 1 && options.description !== undefined) {
      billUpdates.description = options.description;
    }
    if (options.priceAdjustReason !== undefined) {
      billUpdates.priceAdjustReason = options.priceAdjustReason;
    }
    if (discountAmount <= 0) {
      billUpdates.discountAppliedBy = null;
    } else if (options.discountAppliedBy !== undefined) {
      billUpdates.discountAppliedBy = options.discountAppliedBy;
    }

    return await storage.updateBill(billId, billUpdates);
  };

  const syncLinkedOrdersPaidState = async (
    billId: number,
    paidAmount: number,
    paymentMethod?: string | null,
  ) => {
    const linkedOrders = await db.select().from(orders).where(eq(orders.billId, billId));
    if (linkedOrders.length === 0) return;

    const sortedLinkedOrders = [...linkedOrders].sort((a, b) => {
      const aDate = a.entryDate ? new Date(a.entryDate).getTime() : 0;
      const bDate = b.entryDate ? new Date(b.entryDate).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a.id - b.id;
    });

    let remainingPaid = Math.max(0, paidAmount);
    const normalizedMethod =
      paymentMethod && String(paymentMethod).trim().length > 0
        ? String(paymentMethod).trim()
        : null;

    for (const linkedOrder of sortedLinkedOrders) {
      const orderTarget = getOrderFinalAmount(linkedOrder);
      const syncedPaidAmount = Math.min(remainingPaid, orderTarget);
      remainingPaid = Math.max(0, remainingPaid - syncedPaidAmount);

      const orderUpdates: any = {
        paidAmount: normalizeMoney(syncedPaidAmount),
      };

      if (syncedPaidAmount <= 0.009) {
        orderUpdates.paymentMethod = null;
      } else if (syncedPaidAmount >= orderTarget - 0.01) {
        orderUpdates.paymentMethod = normalizedMethod;
      } else {
        orderUpdates.paymentMethod = null;
      }

      await storage.updateOrder(linkedOrder.id, orderUpdates);
    }
  };

  const reconcileBillPaymentState = async (billId: number) => {
    const bill = await storage.getBill(billId);
    if (!bill) return null;

    const billAmount = Math.max(0, parseMoney(bill.amount));
    const currentPaidAmount = Math.max(0, parseMoney(bill.paidAmount));
    const normalizedPaidAmount = Math.min(currentPaidAmount, billAmount);
    const shouldBePaid = normalizedPaidAmount >= billAmount - 0.01;

    let updatedBill = bill;
    const nextPaymentMethod =
      normalizedPaidAmount <= 0.009 ? null : bill.paymentMethod;

    if (
      Math.abs(normalizedPaidAmount - currentPaidAmount) > 0.009 ||
      Boolean(bill.isPaid) !== shouldBePaid ||
      (normalizedPaidAmount <= 0.009 && bill.paymentMethod !== null)
    ) {
      updatedBill = await storage.updateBill(billId, {
        paidAmount: normalizeMoney(normalizedPaidAmount),
        isPaid: shouldBePaid,
        paymentMethod: nextPaymentMethod,
      });
    }

    await syncLinkedOrdersPaidState(
      billId,
      normalizedPaidAmount,
      nextPaymentMethod,
    );

    return updatedBill;
  };

  const syncOrdersForBillDiscount = async (
    billId: number,
    discountAmount: number,
  ): Promise<{ billAmountFromOrders: number | null }> => {
    const linkedOrders = await db.select().from(orders).where(eq(orders.billId, billId));
    if (linkedOrders.length === 0) {
      return { billAmountFromOrders: null };
    }

    const sortedLinkedOrders = [...linkedOrders].sort((a, b) => {
      const aDate = a.entryDate ? new Date(a.entryDate).getTime() : 0;
      const bDate = b.entryDate ? new Date(b.entryDate).getTime() : 0;
      if (aDate !== bDate) return aDate - bDate;
      return a.id - b.id;
    });

    let remainingDiscount = Math.max(0, discountAmount);
    let totalFinalAmount = 0;

    for (const linkedOrder of sortedLinkedOrders) {
      const orderBaseAmount = getOrderWorkReceivedBase(linkedOrder);
      const orderDiscountAmount = Math.min(remainingDiscount, orderBaseAmount);
      const orderFinalAmount =
        Math.max(0, orderBaseAmount - orderDiscountAmount) +
        getOrderExtraCharges(linkedOrder);
      const existingOrderPaid = parseMoney(linkedOrder.paidAmount);

      const orderUpdates: any = {
        discountPercent: "0.00",
        discountAmount: normalizeMoney(orderDiscountAmount),
        finalAmount: normalizeMoney(orderFinalAmount),
      };

      // Prevent order tracking from showing paid more than payable after discount.
      if (existingOrderPaid > orderFinalAmount + 0.01) {
        orderUpdates.paidAmount = normalizeMoney(orderFinalAmount);
      }

      await storage.updateOrder(linkedOrder.id, orderUpdates);
      remainingDiscount = Math.max(0, remainingDiscount - orderDiscountAmount);
      totalFinalAmount += orderFinalAmount;
    }

    return { billAmountFromOrders: totalFinalAmount };
  };

  const getBillOriginalAmount = async (bill: any): Promise<number> => {
    const explicitOriginal = parseMoney(bill.originalAmount);
    if (explicitOriginal > 0) return explicitOriginal;

    const existingDiscount = parseMoney(bill.discountAmount);
    if (existingDiscount > 0) {
      const impliedOriginal =
        parseMoney(bill.amount) +
        existingDiscount -
        Math.max(0, parseMoney(bill.deliveryCharge));
      if (impliedOriginal > 0) return impliedOriginal;
    }

    const linkedOrders = await db.select().from(orders).where(eq(orders.billId, bill.id));
    if (linkedOrders.length > 0) {
      const ordersBaseTotal = linkedOrders.reduce((sum, order) => sum + getOrderWorkReceivedBase(order), 0);
      if (ordersBaseTotal > 0) return ordersBaseTotal;
    }

    return parseMoney(bill.amount);
  };

  const sortBillsFIFO = (input: any[]) =>
    [...input].sort((a, b) => {
      const aDate = a.billDate ? new Date(a.billDate).getTime() : 0;
      const bDate = b.billDate ? new Date(b.billDate).getTime() : 0;
      return aDate - bDate;
    });

  const recalcClientBalanceFromBills = async (clientId: number) => {
    const client = await storage.getClient(clientId);
    if (!client) return;
    const allBills = await storage.getBills();
    const totalDue = allBills
      .filter((b) => b.clientId === clientId)
      .reduce((sum, b) => sum + getBillDue(b), 0);
    await storage.updateClient(clientId, {
      balance: normalizeMoney(totalDue),
    });
  };

  const buildCreditAdjustmentDescription = (
    prefix: string,
    billIds: number[] = [],
    notes?: string | null,
    tag?: string | null,
  ) => {
    const uniqueBillIds = Array.from(
      new Set(
        billIds
          .map((billId) => Number(billId))
          .filter((billId) => Number.isFinite(billId) && billId > 0),
      ),
    );
    const parts = [prefix];

    if (uniqueBillIds.length > 0) {
      parts.push(`Bills: ${uniqueBillIds.map((billId) => `#${billId}`).join(", ")}`);
    }

    const trimmedNotes = String(notes || "").trim();
    if (trimmedNotes) {
      parts.push(trimmedNotes);
    }

    const trimmedTag = String(tag || "").trim();
    if (trimmedTag) {
      parts.push(trimmedTag);
    }

    return parts.join(" | ");
  };

  const addCreditToClientAccount = async ({
    clientId,
    amount,
    paymentMethod,
    processedBy,
    description,
  }: {
    clientId: number;
    amount: number;
    paymentMethod?: string | null;
    processedBy?: string;
    description: string;
  }) => {
    if (!Number.isFinite(clientId) || clientId <= 0) {
      throw new Error("Valid client ID is required for account credit");
    }

    if (!Number.isFinite(amount) || amount <= 0.009) {
      return null;
    }

    if (normalizeBillPaymentMethodKey(paymentMethod) === "deposit") {
      return null;
    }

    await storage.addClientDeposit(
      clientId,
      normalizeMoney(amount),
      description,
      paymentMethod || "cash",
      processedBy,
    );

    const client = await storage.getClient(clientId);
    const accountLabel = client?.billNumber
      ? `${client.name} (${client.billNumber})`
      : client?.name || `Client #${clientId}`;

    return {
      clientId,
      amount,
      accountLabel,
    };
  };

  const applyFifoDiscounts = async (targetBills: any[], discountAmount: number, discountAppliedBy: string) => {
    let remainingDiscount = Math.max(0, discountAmount);
    const applied: Array<{ billId: number; discountApplied: number; newAmount: string }> = [];

    for (const bill of sortBillsFIFO(targetBills)) {
      if (remainingDiscount <= 0) break;
      const billDue = getBillDue(bill);
      if (billDue <= 0) continue;

      const discountForBill = Math.min(remainingDiscount, billDue);
      if (discountForBill <= 0) continue;

      const existingDiscount = parseFloat(String(bill.discountAmount || "0"));
      const originalAmount = await getBillOriginalAmount(bill);
      const newDiscountTotal = existingDiscount + discountForBill;
      const newAmountValue =
        Math.max(0, originalAmount - newDiscountTotal) +
        Math.max(0, parseMoney(bill.deliveryCharge));
      const paid = parseMoney(bill.paidAmount);
      const syncResult = await syncOrdersForBillDiscount(bill.id, newDiscountTotal);
      const syncedBillAmount =
        syncResult.billAmountFromOrders != null ? syncResult.billAmountFromOrders : newAmountValue;

      await storage.updateBill(bill.id, {
        originalAmount: normalizeMoney(originalAmount),
        amount: normalizeMoney(syncedBillAmount),
        discountAmount: normalizeMoney(newDiscountTotal),
        discountAppliedBy,
        isPaid: paid >= syncedBillAmount - 0.01,
      });

      remainingDiscount -= discountForBill;
      applied.push({
        billId: bill.id,
        discountApplied: discountForBill,
        newAmount: normalizeMoney(syncedBillAmount),
      });
    }

    return {
      applied,
      appliedTotal: applied.reduce((s, x) => s + x.discountApplied, 0),
      unapplied: Math.max(0, remainingDiscount),
    };
  };

  const getBulkTag = (bulkGroup: string) => `[bulk:${bulkGroup}]`;

  const extractBulkGroupFromText = (value?: string | null): string | null => {
    if (!value) return null;
    const match = String(value).match(/\[bulk:([^\]]+)\]/i);
    return match?.[1] ? match[1] : null;
  };

  const getSharedPaymentTag = (billCount: number, clientCount: number) =>
    `[SHARED:${billCount}:${clientCount}]`;

  const appendSharedPaymentTag = (
    notes: string | undefined,
    billCount: number,
    clientCount: number,
  ) => {
    if (billCount <= 1 || clientCount <= 1) {
      return notes;
    }

    const trimmedNotes = String(notes || "").trim();
    const tag = getSharedPaymentTag(billCount, clientCount);
    return trimmedNotes ? `${trimmedNotes} ${tag}` : tag;
  };

  const collectBillIdsFromText = (value?: string | null): number[] => {
    if (!value) return [];
    const matches = String(value).match(/#(\d+)/g) || [];
    const ids = matches
      .map((token) => Number(token.replace("#", "")))
      .filter((id) => Number.isFinite(id) && id > 0);
    return Array.from(new Set(ids));
  };

  const revertDiscountOnlyBill = async (billId: number, revertedBy?: string) => {
    const bill = await storage.getBill(billId);
    if (!bill) return null;

    const previousDiscount = parseMoney(bill.discountAmount);
    const originalAmount = await getBillOriginalAmount(bill);
    const syncResult = await syncOrdersForBillDiscount(billId, 0);
    const restoredAmount =
      syncResult.billAmountFromOrders != null
        ? syncResult.billAmountFromOrders
        : originalAmount + Math.max(0, parseMoney(bill.deliveryCharge));
    const paidAmount = parseMoney(bill.paidAmount);
    const revertTimestamp = new Date().toLocaleString();
    const revertActor = revertedBy || "admin";
    const historyEntry =
      `\n[${revertTimestamp}] DISCOUNT REVERTED by ${revertActor}: Removed discount ${previousDiscount.toFixed(2)} AED. Amount restored to ${normalizeMoney(restoredAmount)} AED.`;
    const updatedNotes = `${bill.notes || ""}${historyEntry}`.trim();

    return await storage.updateBill(billId, {
      amount: normalizeMoney(restoredAmount),
      paidAmount: normalizeMoney(paidAmount),
      isPaid: paidAmount >= restoredAmount - 0.01,
      paymentMethod: paidAmount > 0 ? bill.paymentMethod : null,
      originalAmount: null,
      discountAmount: "0.00",
      discountAppliedBy: null,
      notes: updatedNotes,
    });
  };

  const revertBulkPaymentGroup = async (bulkGroup: string, revertedBy?: string) => {
    const tag = getBulkTag(bulkGroup);
    const allPayments = await storage.getAllBillPayments();
    const targetPayments = allPayments.filter((p) => String(p.notes || "").includes(tag));

    const taggedTransactions = await db
      .select()
      .from(clientTransactions)
      .where(sql`${clientTransactions.description} LIKE ${"%" + tag + "%"}`);

    const billIdsFromTransactions = new Set<number>();
    for (const tx of taggedTransactions) {
      if (tx.billId) {
        billIdsFromTransactions.add(tx.billId);
      }
      for (const parsedBillId of collectBillIdsFromText(tx.description)) {
        billIdsFromTransactions.add(parsedBillId);
      }
    }

    const uniqueBillIds = Array.from(
      new Set<number>([
        ...targetPayments.map((p) => p.billId),
        ...Array.from(billIdsFromTransactions),
      ]),
    );

    if (uniqueBillIds.length === 0) {
      throw new Error("No bulk payment found for provided group");
    }

    const revertedBills: Array<{ billId: number; restoredAmount: string }> = [];
    const affectedClientIds = new Set<number>();

    for (const billId of uniqueBillIds) {
      const bill = await storage.getBill(billId);
      if (!bill) continue;
      if (bill.clientId) affectedClientIds.add(bill.clientId);

      const paidAmount = parseMoney(bill.paidAmount);
      const discountAmount = parseMoney(bill.discountAmount);

      if (paidAmount > 0.009) {
        const revertedBill = await storage.revertBillPayment(billId, revertedBy || "admin");
        revertedBills.push({ billId, restoredAmount: revertedBill.amount });
        continue;
      }

      if (discountAmount > 0.009) {
        const clearedDiscountBill = await revertDiscountOnlyBill(billId, revertedBy || "admin");
        if (clearedDiscountBill) {
          revertedBills.push({ billId, restoredAmount: clearedDiscountBill.amount });
        }
      }
    }

    // Remove the bulk transaction marker rows to avoid duplicate reverts.
    for (const row of taggedTransactions) {
      await storage.deleteClientTransaction(row.id);
    }

    // Recalculate balances for affected clients.
    for (const cid of Array.from(affectedClientIds)) {
      await recalcClientBalanceFromBills(cid);
    }

    if (taggedTransactions.length > 0 || affectedClientIds.size > 0) {
      storage.notifyLiveResourceUpdated("clientTransactions");
    }

    return {
      revertedBills,
      affectedClientIds: Array.from(affectedClientIds),
    };
  };

  const detectBulkPaymentGroupForBill = async (billId: number, bill?: any | null) => {
    const billPaymentsForBill = await storage.getBillPayments(billId);
    for (const payment of billPaymentsForBill) {
      const detectedBulkGroup = extractBulkGroupFromText(payment.notes);
      if (detectedBulkGroup) return detectedBulkGroup;
    }

    const targetBill = bill || (await storage.getBill(billId));
    if (!targetBill?.clientId) return null;

    const clientTxRows = await db
      .select()
      .from(clientTransactions)
      .where(eq(clientTransactions.clientId, targetBill.clientId));
    for (const tx of clientTxRows) {
      const description = String(tx.description || "");
      if (!description.includes(`#${billId}`)) continue;
      const detectedBulkGroup = extractBulkGroupFromText(description);
      if (detectedBulkGroup) return detectedBulkGroup;
    }

    return null;
  };

  const revertSelectedBillPayments = async (billIds: number[], revertedBy?: string) => {
    const uniqueBillIds = Array.from(
      new Set(billIds.map(Number).filter((billId) => Number.isFinite(billId) && billId > 0)),
    );
    const revertedBills: Array<{ billId: number; restoredAmount: string }> = [];
    const failedBills: Array<{ billId: number; message: string }> = [];
    const bulkGroups: string[] = [];
    const handledBillIds = new Set<number>();
    const handledBulkGroups = new Set<string>();

    for (const billId of uniqueBillIds) {
      if (handledBillIds.has(billId)) continue;

      try {
        const bill = await storage.getBill(billId);
        if (!bill) {
          failedBills.push({ billId, message: "Bill not found" });
          handledBillIds.add(billId);
          continue;
        }

        const detectedBulkGroup = await detectBulkPaymentGroupForBill(billId, bill);
        if (detectedBulkGroup) {
          if (handledBulkGroups.has(detectedBulkGroup)) {
            handledBillIds.add(billId);
            continue;
          }

          const bulkResult = await revertBulkPaymentGroup(detectedBulkGroup, revertedBy || "admin");
          handledBulkGroups.add(detectedBulkGroup);
          bulkGroups.push(detectedBulkGroup);
          for (const revertedBill of bulkResult.revertedBills) {
            revertedBills.push(revertedBill);
            handledBillIds.add(revertedBill.billId);
          }
          handledBillIds.add(billId);
          continue;
        }

        const paidAmount = parseMoney(bill.paidAmount);
        const discountAmount = parseMoney(bill.discountAmount);

        if (paidAmount <= 0.009 && discountAmount <= 0.009) {
          failedBills.push({ billId, message: "Bill has no payment to revert" });
          handledBillIds.add(billId);
          continue;
        }

        if (paidAmount <= 0.009 && discountAmount > 0.009) {
          const clearedDiscountBill = await revertDiscountOnlyBill(billId, revertedBy || "admin");
          if (!clearedDiscountBill) {
            failedBills.push({ billId, message: "Bill not found" });
            handledBillIds.add(billId);
            continue;
          }

          revertedBills.push({ billId, restoredAmount: clearedDiscountBill.amount });
          handledBillIds.add(billId);
          continue;
        }

        const revertedBill = await storage.revertBillPayment(billId, revertedBy || "admin");
        revertedBills.push({ billId, restoredAmount: revertedBill.amount });
        handledBillIds.add(billId);
      } catch (error: any) {
        failedBills.push({
          billId,
          message: error?.message || "Failed to revert bill payment",
        });
        handledBillIds.add(billId);
      }
    }

    return { revertedBills, failedBills, bulkGroups };
  };

  // Pay all unpaid bills for a client (supports FIFO discount distribution)
  app.post("/api/clients/:id/pay-all-bills", async (req, res) => {
    try {
      const clientId = Number(req.params.id);
      if (Number.isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }

      const { amount, paymentMethod = "cash", notes, discountAmount, processedBy, billIds } = req.body || {};
      const processedByName = String(processedBy || "admin").trim() || "admin";
      const paymentAmount = parseFloat(String(amount || "0"));
      const discountToApply = Math.max(0, parseFloat(String(discountAmount || "0")) || 0);
      if (paymentAmount <= 0 && discountToApply <= 0) {
        return res.status(400).json({ message: "Provide a payment amount or discount amount" });
      }
      const discountPinAccess =
        discountToApply > 0 ? await resolveAdminOrCounterPinFromRequest(req) : null;
      if (discountToApply > 0 && !discountPinAccess) {
        return res.status(401).json({ message: "Invalid admin or counter PIN" });
      }

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      if (paymentMethod === "deposit" && paymentAmount > 0) {
        const currentDeposit = parseFloat(client.deposit || "0");
        if (currentDeposit < paymentAmount) {
          return res.status(400).json({
            message: `Insufficient credit balance. Available: ${currentDeposit.toFixed(2)} AED, Required: ${paymentAmount.toFixed(2)} AED`,
          });
        }
      }

      const selectedBillIds = Array.isArray(billIds) ? new Set(billIds.map(Number).filter(Number.isFinite)) : null;
      const allBills = await storage.getBills();
      const clientUnpaidBills = sortBillsFIFO(
        allBills.filter((b) => {
          if (b.clientId !== clientId || getBillDue(b) <= 0.01) return false;
          if (selectedBillIds && selectedBillIds.size > 0) return selectedBillIds.has(b.id);
          return true;
        }),
      );
      if (clientUnpaidBills.length === 0) {
        return res.status(400).json({ message: "No unpaid bills found for this client" });
      }

      const bulkGroup = `BULK-${Date.now()}`;
      const bulkTag = getBulkTag(bulkGroup);
      const discountBy = discountPinAccess?.name || `bulk:${bulkGroup}`;
      const discountResult = await applyFifoDiscounts(clientUnpaidBills, discountToApply, discountBy);

      // Refresh bill states after discount.
      const refreshedBills = sortBillsFIFO(
        (await storage.getBills()).filter((b) => {
          if (b.clientId !== clientId || getBillDue(b) <= 0.01) return false;
          if (selectedBillIds && selectedBillIds.size > 0) return selectedBillIds.has(b.id);
          return true;
        }),
      );

      const isSingleBillSelection =
        clientUnpaidBills.length === 1 &&
        Array.from(
          new Set<number>([
            ...clientUnpaidBills.map((bill) => bill.id),
            ...discountResult.applied.map((entry) => entry.billId),
          ]),
        ).length === 1;

      if (isSingleBillSelection) {
        let remainingPayment = Math.max(0, paymentAmount);
        const paidBills: Array<{ billId: number; amountPaid: number }> = [];
        const targetBill = refreshedBills[0];
        let creditedOverpayment: { clientId: number; amount: number; accountLabel: string } | null = null;

        if (targetBill && remainingPayment > 0) {
          const billDue = getBillDue(targetBill);
          const payForBill = Math.min(remainingPayment, billDue);

          if (payForBill > 0) {
            await storage.payBill(
              targetBill.id,
              normalizeMoney(payForBill),
              paymentMethod,
              notes,
              processedByName,
              false,
            );
            paidBills.push({ billId: targetBill.id, amountPaid: payForBill });
            remainingPayment -= payForBill;
          }
        }

        await recalcClientBalanceFromBills(clientId);

        if (remainingPayment > 0.01) {
          creditedOverpayment = await addCreditToClientAccount({
            clientId,
            amount: remainingPayment,
            paymentMethod,
            processedBy: processedByName,
            description: buildCreditAdjustmentDescription(
              "Credit added from bulk payment overpayment",
              [
                ...paidBills.map((entry) => entry.billId),
                ...discountResult.applied.map((entry) => entry.billId),
              ],
              notes,
              bulkTag,
            ),
          });
          if (creditedOverpayment) {
            remainingPayment = 0;
          }
        }

        const paidTotal = paidBills.reduce((sum, bill) => sum + bill.amountPaid, 0);
        return res.status(200).json({
          success: true,
          message: `${`Payment ${normalizeMoney(paidTotal)} AED and discount ${normalizeMoney(discountResult.appliedTotal)} AED applied to ${Math.max(clientUnpaidBills.length, discountResult.applied.length || paidBills.length)} bill(s).`}${creditedOverpayment ? ` Overpayment ${normalizeMoney(creditedOverpayment.amount)} AED added to ${creditedOverpayment.accountLabel}.` : ""}`,
          paidBills,
          discountAllocations: discountResult.applied,
          creditedAmount: creditedOverpayment ? normalizeMoney(creditedOverpayment.amount) : "0.00",
          creditedClientId: creditedOverpayment?.clientId || null,
          remainingAmount: remainingPayment > 0.01 ? remainingPayment : 0,
          unappliedDiscount: discountResult.unapplied > 0.01 ? discountResult.unapplied : 0,
        });
      }

      let remainingPayment = Math.max(0, paymentAmount);
      const paidBills: Array<{ billId: number; amountPaid: number }> = [];
      const payMethodForBills = paymentMethod === "deposit" ? "bulk_deposit" : paymentMethod;
      let creditedOverpayment: { clientId: number; amount: number; accountLabel: string } | null = null;

      for (const bill of refreshedBills) {
        if (remainingPayment <= 0) break;
        const billDue = getBillDue(bill);
        if (billDue <= 0) continue;
        const payForBill = Math.min(remainingPayment, billDue);
        if (payForBill <= 0) continue;

        await storage.payBill(
          bill.id,
          normalizeMoney(payForBill),
          payMethodForBills,
          `${notes || "Bulk client payment"} ${bulkTag}`,
          processedByName,
          true,
        );
        paidBills.push({ billId: bill.id, amountPaid: payForBill });
        remainingPayment -= payForBill;
      }

      const paidTotal = paidBills.reduce((s, b) => s + b.amountPaid, 0);

      await recalcClientBalanceFromBills(clientId);

      if (paidTotal > 0 || discountResult.appliedTotal > 0) {
        const txType = paymentMethod === "deposit" ? "bulk_deposit_used" : "bulk_payment";
        const allAffectedBillIds = Array.from(
          new Set<number>([
            ...paidBills.map((b) => b.billId),
            ...discountResult.applied.map((d) => d.billId),
          ]),
        );
        const freshClient = await storage.getClient(clientId);
        const runningBalance = parseFloat(freshClient?.balance || "0");
        await storage.createTransaction({
          clientId,
          type: txType,
          amount: normalizeMoney(paidTotal),
          description:
            `${notes || "Bulk payment"} | Bills: ${allAffectedBillIds.map((id) => `#${id}`).join(", ") || "none"} | Discount: ${normalizeMoney(discountResult.appliedTotal)} AED | ${bulkTag}`,
          date: new Date(),
          runningBalance: normalizeMoney(runningBalance),
          paymentMethod,
          discount: normalizeMoney(discountResult.appliedTotal),
          processedBy: processedByName,
        });
      }

      if (remainingPayment > 0.01) {
        creditedOverpayment = await addCreditToClientAccount({
          clientId,
          amount: remainingPayment,
          paymentMethod,
          processedBy: processedByName,
          description: buildCreditAdjustmentDescription(
            "Credit added from bulk payment overpayment",
            [
              ...paidBills.map((entry) => entry.billId),
              ...discountResult.applied.map((entry) => entry.billId),
            ],
            notes,
            bulkTag,
          ),
        });
        if (creditedOverpayment) {
          remainingPayment = 0;
        }
      }

      res.status(200).json({
        success: true,
        bulkGroup,
        message: `${`Payment ${normalizeMoney(paidTotal)} AED and discount ${normalizeMoney(discountResult.appliedTotal)} AED applied to ${paidBills.length} bill(s).`}${creditedOverpayment ? ` Overpayment ${normalizeMoney(creditedOverpayment.amount)} AED added to ${creditedOverpayment.accountLabel}.` : ""}`,
        paidBills,
        discountAllocations: discountResult.applied,
        creditedAmount: creditedOverpayment ? normalizeMoney(creditedOverpayment.amount) : "0.00",
        creditedClientId: creditedOverpayment?.clientId || null,
        remainingAmount: remainingPayment > 0.01 ? remainingPayment : 0,
        unappliedDiscount: discountResult.unapplied > 0.01 ? discountResult.unapplied : 0,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to process bulk client payment" });
    }
  });

  // Pay all unpaid bills for a company (across all clients in that company) with FIFO discount allocation.
  app.post("/api/companies/pay-all-bills", async (req, res) => {
    try {
      const {
        companyName,
        amount,
        paymentMethod = "cash",
        notes,
        processedBy,
        discountAmount,
        billIds,
        overpaymentClientId,
      } = req.body || {};
      const processedByName = String(processedBy || "admin").trim() || "admin";

      if (!companyName) {
        return res.status(400).json({ message: "Company name is required" });
      }

      if (paymentMethod === "deposit") {
        return res.status(400).json({ message: "Company bulk payment does not support deposit method" });
      }

      const paymentAmount = parseFloat(String(amount || "0"));
      const discountToApply = Math.max(0, parseFloat(String(discountAmount || "0")) || 0);
      if (paymentAmount <= 0 && discountToApply <= 0) {
        return res.status(400).json({ message: "Provide a payment amount or discount amount" });
      }
      const discountPinAccess =
        discountToApply > 0 ? await resolveAdminOrCounterPinFromRequest(req) : null;
      if (discountToApply > 0 && !discountPinAccess) {
        return res.status(401).json({ message: "Invalid admin or counter PIN" });
      }

      const allClients = await storage.getClients();
      const companyClients = allClients.filter(
        (c) => c.company && c.company.toUpperCase() === String(companyName).toUpperCase(),
      );
      if (companyClients.length === 0) {
        return res.status(404).json({ message: "No clients found for this company" });
      }

      const selectedBillIds = Array.isArray(billIds) ? new Set(billIds.map(Number).filter(Number.isFinite)) : null;
      const clientIds = new Set(companyClients.map((c) => c.id));
      const allBills = await storage.getBills();
      const companyUnpaidBills = sortBillsFIFO(
        allBills.filter((b) => {
          if (!b.clientId || !clientIds.has(b.clientId) || getBillDue(b) <= 0.01) return false;
          if (selectedBillIds && selectedBillIds.size > 0) return selectedBillIds.has(b.id);
          return true;
        }),
      );
      if (companyUnpaidBills.length === 0) {
        return res.status(400).json({ message: "No unpaid bills found for this company" });
      }

      const affectedClientIds = Array.from(
        new Set(
          companyUnpaidBills
            .map((bill) => bill.clientId)
            .filter((clientId): clientId is number => Number.isFinite(clientId)),
        ),
      );

      const bulkGroup = `BULK-${Date.now()}`;
      const bulkTag = getBulkTag(bulkGroup);
      const discountBy = discountPinAccess?.name || `bulk:${bulkGroup}`;
      const discountResult = await applyFifoDiscounts(companyUnpaidBills, discountToApply, discountBy);

      const refreshedBills = sortBillsFIFO(
        (await storage.getBills()).filter((b) => {
          if (!b.clientId || !clientIds.has(b.clientId) || getBillDue(b) <= 0.01) return false;
          if (selectedBillIds && selectedBillIds.size > 0) return selectedBillIds.has(b.id);
          return true;
        }),
      );

      const totalDueAfterDiscount = refreshedBills.reduce((sum, bill) => sum + getBillDue(bill), 0);
      const normalizedOverpaymentClientId = Number(overpaymentClientId);

      if (
        paymentAmount > totalDueAfterDiscount + 0.01 &&
        affectedClientIds.length > 1 &&
        (!Number.isFinite(normalizedOverpaymentClientId) ||
          !affectedClientIds.includes(normalizedOverpaymentClientId))
      ) {
        return res.status(400).json({
          message: "Choose which client account should receive the overpayment credit.",
        });
      }

      let remainingPayment = Math.max(0, paymentAmount);
      const paidBills: Array<{ billId: number; clientId: number; amountPaid: number }> = [];
      let creditedOverpayment: { clientId: number; amount: number; accountLabel: string } | null = null;

      for (const bill of refreshedBills) {
        if (remainingPayment <= 0) break;
        const due = getBillDue(bill);
        if (due <= 0) continue;
        const payForBill = Math.min(remainingPayment, due);
        if (payForBill <= 0) continue;

        await storage.payBill(
          bill.id,
          normalizeMoney(payForBill),
          paymentMethod,
          `${notes || `Company payment (${companyName})`} ${bulkTag}`,
          processedByName,
          true,
        );
        paidBills.push({
          billId: bill.id,
          clientId: bill.clientId as number,
          amountPaid: payForBill,
        });
        remainingPayment -= payForBill;
      }

      const billClientMap = new Map<number, number>();
      for (const bill of companyUnpaidBills) {
        if (bill.clientId) {
          billClientMap.set(bill.id, bill.clientId);
        }
      }

      const paymentByClient = new Map<number, { paidTotal: number; billIds: Set<number> }>();
      for (const paid of paidBills) {
        if (!paymentByClient.has(paid.clientId)) {
          paymentByClient.set(paid.clientId, { paidTotal: 0, billIds: new Set<number>() });
        }
        const entry = paymentByClient.get(paid.clientId)!;
        entry.paidTotal += paid.amountPaid;
        entry.billIds.add(paid.billId);
      }

      const discountByClient = new Map<number, { discountTotal: number; billIds: Set<number> }>();
      for (const appliedDiscount of discountResult.applied) {
        const clientId = billClientMap.get(appliedDiscount.billId);
        if (!clientId) continue;
        if (!discountByClient.has(clientId)) {
          discountByClient.set(clientId, { discountTotal: 0, billIds: new Set<number>() });
        }
        const entry = discountByClient.get(clientId)!;
        entry.discountTotal += appliedDiscount.discountApplied;
        entry.billIds.add(appliedDiscount.billId);
      }

      const transactionClientIds = Array.from(
        new Set<number>([
          ...Array.from(paymentByClient.keys()),
          ...Array.from(discountByClient.keys()),
        ]),
      );

      for (const clientId of Array.from(clientIds)) {
        await recalcClientBalanceFromBills(clientId);
      }

      for (const clientId of transactionClientIds) {
        const paymentEntry = paymentByClient.get(clientId);
        const discountEntry = discountByClient.get(clientId);
        const clientPaidTotal = paymentEntry?.paidTotal || 0;
        const clientDiscountTotal = discountEntry?.discountTotal || 0;
        const paidBillIds = paymentEntry ? Array.from(paymentEntry.billIds) : [];
        const discountedBillIds = discountEntry ? Array.from(discountEntry.billIds) : [];
        const perClientBillIds = Array.from(new Set<number>([...paidBillIds, ...discountedBillIds]));
        if (clientPaidTotal <= 0 && clientDiscountTotal <= 0) {
          continue;
        }
        const freshClient = await storage.getClient(clientId);
        const runningBalance = parseFloat(freshClient?.balance || "0");

        await storage.createTransaction({
          clientId,
          type: "company_payment",
          amount: normalizeMoney(clientPaidTotal),
          description:
            `Paid by company ${companyName} - Bills: ${perClientBillIds.map((id) => `#${id}`).join(", ") || "none"} - Discount: ${normalizeMoney(clientDiscountTotal)} AED - ${bulkTag}`,
          date: new Date(),
          runningBalance: normalizeMoney(runningBalance),
          paymentMethod,
          discount: normalizeMoney(clientDiscountTotal),
          processedBy: processedByName,
        });
      }

      if (remainingPayment > 0.01) {
        const creditClientId =
          affectedClientIds.length === 1
            ? affectedClientIds[0]
            : normalizedOverpaymentClientId;

        creditedOverpayment = await addCreditToClientAccount({
          clientId: creditClientId,
          amount: remainingPayment,
          paymentMethod,
          processedBy: processedByName,
          description: buildCreditAdjustmentDescription(
            "Credit added from company payment overpayment",
            [
              ...paidBills.map((entry) => entry.billId),
              ...discountResult.applied.map((entry) => entry.billId),
            ],
            notes,
            bulkTag,
          ),
        });
        if (creditedOverpayment) {
          remainingPayment = 0;
        }
      }

      const paidTotal = paidBills.reduce((s, b) => s + b.amountPaid, 0);
      res.status(200).json({
        success: true,
        bulkGroup,
        message: `${`Payment ${normalizeMoney(paidTotal)} AED and discount ${normalizeMoney(discountResult.appliedTotal)} AED applied to ${paidBills.length} bill(s).`}${creditedOverpayment ? ` Overpayment ${normalizeMoney(creditedOverpayment.amount)} AED added to ${creditedOverpayment.accountLabel}.` : ""}`,
        paidBills,
        affectedClients: transactionClientIds.length,
        affectedClientIds,
        discountAllocations: discountResult.applied,
        creditedAmount: creditedOverpayment ? normalizeMoney(creditedOverpayment.amount) : "0.00",
        creditedClientId: creditedOverpayment?.clientId || null,
        remainingAmount: remainingPayment > 0.01 ? remainingPayment : 0,
        unappliedDiscount: discountResult.unapplied > 0.01 ? discountResult.unapplied : 0,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to process company bulk payment" });
    }
  });

  app.post("/api/bulk-payments/:bulkGroup/revert", async (req, res) => {
    try {
      const { bulkGroup } = req.params;
      const { adminPassword, adminPin, revertedBy } = req.body || {};

      if (!adminPin && !adminPassword) {
        return res.status(400).json({ message: "Admin PIN required" });
      }

      const isAdminValid = adminPin
        ? await verifyAdminPin(String(adminPin || ""))
        : await verifyAdminPassword(String(adminPassword || ""));
      if (!isAdminValid) {
        return res
          .status(401)
          .json({ message: adminPin ? "Invalid admin PIN" : "Invalid admin password" });
      }
      if (!bulkGroup) {
        return res.status(400).json({ message: "bulkGroup is required" });
      }

      const result = await revertBulkPaymentGroup(bulkGroup, revertedBy || "admin");
      if (result.revertedBills.length === 0) {
        return res.status(404).json({ message: "No bulk payment found for provided group" });
      }

      res.json({
        success: true,
        bulkGroup,
        revertedBills: result.revertedBills,
        message: `Reverted ${result.revertedBills.length} bill(s) for bulk group ${bulkGroup}`,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to revert bulk payment" });
    }
  });

  // Transaction routes
  app.get("/api/reports/sales-period", async (req, res) => {
    try {
      const period =
        typeof req.query.period === "string" &&
        ["daily", "monthly", "yearly", "range"].includes(req.query.period)
          ? (req.query.period as "daily" | "monthly" | "yearly" | "range")
          : null;
      const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
      const toRaw = typeof req.query.to === "string" ? req.query.to : "";

      if (!period) {
        return res.status(400).json({ message: "A valid period is required" });
      }

      if (!fromRaw || !toRaw) {
        return res.status(400).json({ message: "Both from and to are required" });
      }

      const from = new Date(fromRaw);
      const to = new Date(toRaw);

      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return res.status(400).json({ message: "Invalid report period dates" });
      }

      if (from.getTime() > to.getTime()) {
        return res.status(400).json({ message: "Report period start must be before the end" });
      }

      const reportData = await storage.getSalesReportPeriodData({
        period,
        from,
        to,
      });

      res.json(reportData);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load sales period data" });
    }
  });

  app.get("/api/reports/credit-transactions", async (_req, res) => {
    try {
      const extractOrderNumbers = (value?: string | null) =>
        Array.from(
          new Set(
            (String(value || "").toUpperCase().match(/ORD-[A-Z0-9-]+/g) || []).map((entry) =>
              entry.trim(),
            ),
          ),
        );

      const transactions = await db
        .select({
          id: clientTransactions.id,
          clientId: clientTransactions.clientId,
          billId: clientTransactions.billId,
          type: clientTransactions.type,
          amount: clientTransactions.amount,
          description: clientTransactions.description,
          date: clientTransactions.date,
          runningBalance: clientTransactions.runningBalance,
          paymentMethod: clientTransactions.paymentMethod,
          discount: clientTransactions.discount,
          processedBy: clientTransactions.processedBy,
          clientName: clients.name,
          accountNumber: clients.billNumber,
          clientPhone: clients.phone,
          billPaymentMethod: bills.paymentMethod,
        })
        .from(clientTransactions)
        .leftJoin(clients, eq(clientTransactions.clientId, clients.id))
        .leftJoin(bills, eq(clientTransactions.billId, bills.id))
        .where(
          or(
            eq(clientTransactions.type, "deposit"),
            eq(clientTransactions.type, "deposit_deduction"),
            eq(clientTransactions.type, "deposit_used"),
            eq(clientTransactions.type, "bulk_deposit_used"),
            and(
              or(
                eq(clientTransactions.type, "payment"),
                eq(clientTransactions.type, "bulk_payment"),
              ),
              or(
                eq(clientTransactions.paymentMethod, "deposit"),
                eq(clientTransactions.paymentMethod, "bulk_deposit"),
                eq(bills.paymentMethod, "deposit"),
                eq(bills.paymentMethod, "bulk_deposit"),
                sql`lower(coalesce(${clientTransactions.description}, '')) like 'deposit used%'`,
                sql`lower(coalesce(${clientTransactions.description}, '')) like '%-> account credit%'`,
              ),
            ),
          ),
        )
        .orderBy(desc(clientTransactions.date), desc(clientTransactions.id));

      const normalizedTransactions = transactions.map((transaction) => {
        if (!isLegacyCreditManagementTransaction(transaction)) {
          return {
            ...transaction,
            _source: "credit_row" as const,
          };
        }

        const normalizedType = getNormalizedCreditManagementType(transaction.type);
        return {
          ...transaction,
          type: normalizedType,
          paymentMethod: "deposit",
          description: normalizeLegacyCreditManagementDescription(
            transaction.description,
            normalizedType,
            transaction.billId,
          ),
          _source: "legacy_history" as const,
        };
      });

      const creditRows = normalizedTransactions.filter((transaction) => transaction._source === "credit_row");
      const filteredTransactions = normalizedTransactions
        .filter((transaction) => {
          if (transaction._source === "credit_row") {
            return true;
          }

          return !creditRows.some((candidate) => {
            if (candidate.clientId !== transaction.clientId) {
              return false;
            }

            if (candidate.type !== transaction.type) {
              return false;
            }

            const candidateAmount = parseFloat(String(candidate.amount || "0"));
            const transactionAmount = parseFloat(String(transaction.amount || "0"));
            if (!Number.isFinite(candidateAmount) || !Number.isFinite(transactionAmount)) {
              return false;
            }

            if (Math.abs(candidateAmount - transactionAmount) > CREDIT_MANAGEMENT_EPSILON) {
              return false;
            }

            if (!creditManagementTargetsMatch(candidate, transaction)) {
              return false;
            }

            const candidateTime = new Date(candidate.date).getTime();
            const transactionTime = new Date(transaction.date).getTime();
            return Math.abs(candidateTime - transactionTime) <= CREDIT_MANAGEMENT_LEGACY_MATCH_WINDOW_MS;
          });
        })
        .map(({ _source, billPaymentMethod, ...transaction }) => transaction);

      const missingProcessedByBillIds = Array.from(
        new Set(
          filteredTransactions
            .filter((transaction) => {
              const processedBy = String(transaction.processedBy || "").trim();
              return !processedBy && Number.isFinite(transaction.billId);
            })
            .map((transaction) => Number(transaction.billId))
            .filter((billId) => Number.isFinite(billId) && billId > 0),
        ),
      );

      const missingProcessedByOrderNumbers = Array.from(
        new Set(
          filteredTransactions
            .filter((transaction) => !String(transaction.processedBy || "").trim())
            .flatMap((transaction) => extractOrderNumbers(transaction.description)),
        ),
      );

      const processedByFallbackByBillId =
        missingProcessedByBillIds.length > 0
          ? await storage.getBillPaymentRecorders(missingProcessedByBillIds)
          : new Map<number, { processedBy: string; date: Date }>();
      const processedByFallbackByOrderNumber =
        missingProcessedByOrderNumbers.length > 0
          ? await storage.getOrderPaymentRecorders(missingProcessedByOrderNumbers)
          : new Map<string, { processedBy: string; date: Date; billId: number }>();

      const hydratedTransactions = filteredTransactions.map((transaction) => {
        const processedBy = String(transaction.processedBy || "").trim();
        if (processedBy) {
          return transaction;
        }

        const orderNumberFallback = extractOrderNumbers(transaction.description)
          .map((orderNumber) => processedByFallbackByOrderNumber.get(orderNumber)?.processedBy || null)
          .find(Boolean);
        const billIdFallback = transaction.billId
          ? processedByFallbackByBillId.get(Number(transaction.billId))?.processedBy || null
          : null;
        const fallbackProcessedBy = billIdFallback || orderNumberFallback || null;

        return {
          ...transaction,
          processedBy: fallbackProcessedBy,
        };
      });

      res.json(hydratedTransactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch credit transactions" });
    }
  });

  app.get("/api/company-payment-transactions", async (_req, res) => {
    try {
      const transactions = await db
        .select({
          id: clientTransactions.id,
          clientId: clientTransactions.clientId,
          billId: clientTransactions.billId,
          type: clientTransactions.type,
          amount: clientTransactions.amount,
          description: clientTransactions.description,
          date: clientTransactions.date,
          runningBalance: clientTransactions.runningBalance,
          paymentMethod: clientTransactions.paymentMethod,
          discount: clientTransactions.discount,
          processedBy: clientTransactions.processedBy,
          clientName: clients.name,
          companyName: clients.company,
          accountNumber: clients.billNumber,
        })
        .from(clientTransactions)
        .innerJoin(clients, eq(clientTransactions.clientId, clients.id))
        .where(
          and(
            eq(clientTransactions.type, "company_payment"),
            sql`trim(coalesce(${clients.company}, '')) <> ''`,
          ),
        )
        .orderBy(desc(clientTransactions.date), desc(clientTransactions.id));

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({
        message: error.message || "Failed to fetch company payment transactions",
      });
    }
  });

  app.get("/api/clients/:id/transactions", async (req, res) => {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const transactions = await storage.getClientTransactions(clientId);
    res.json(transactions);
  });

  app.delete("/api/transactions/:id", async (req, res) => {
    try {
      const transactionId = Number(req.params.id);
      if (isNaN(transactionId)) {
        return res.status(400).json({ message: "Invalid transaction ID" });
      }
      await storage.deleteClientTransaction(transactionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete transaction" });
    }
  });

  app.patch("/api/transactions/:id", async (req, res) => {
    try {
      const transactionId = Number(req.params.id);
      if (isNaN(transactionId)) {
        return res.status(400).json({ message: "Invalid transaction ID" });
      }
      const { amount, description } = req.body;
      const updated = await storage.updateClientTransaction(transactionId, { amount, description });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update transaction" });
    }
  });

  app.post("/api/clients/:id/bill", async (req, res) => {
    try {
      const { amount, description } = req.body;
      const clientId = Number(req.params.id);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      const transaction = await storage.addClientBill(
        clientId,
        amount,
        description,
      );
      res.status(201).json(transaction);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/deposit", async (req, res) => {
    try {
      const { amount, description, paymentMethod, processedBy, processorPin } = req.body;
      const clientId = Number(req.params.id);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      const processedByFromPin = await resolveProcessedByFromPin(processorPin);
      const processedByName = String(processedByFromPin || processedBy || "").trim();
      if (!processedByName) {
        return res.status(400).json({ message: "Manager/Cashier PIN verification is required to add account credit." });
      }
      const transaction = await storage.addClientDeposit(
        clientId,
        amount,
        description,
        paymentMethod || "cash",
        processedByName,
      );
      res.status(201).json(transaction);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/clients/:id/deposit-deduction", async (req, res) => {
    try {
      const { amount, description, processedBy, processorPin } = req.body;
      const clientId = Number(req.params.id);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      const processedByFromPin = await resolveProcessedByFromPin(processorPin);
      const processedByName = String(processedByFromPin || processedBy || "").trim();
      if (!processedByName) {
        return res.status(400).json({ message: "Manager/Cashier PIN verification is required to deduct account credit." });
      }
      const transaction = await storage.deductClientDeposit(
        clientId,
        amount,
        description,
        processedByName,
      );
      res.status(201).json(transaction);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Order routes
  app.get("/api/orders", async (req, res) => {
    const search = req.query.search as string | undefined;
    const accountNumber = typeof req.query.accountNumber === "string" ? req.query.accountNumber : undefined;
    const orderNumber = typeof req.query.orderNumber === "string" ? req.query.orderNumber : undefined;
    const billAmount = typeof req.query.billAmount === "string" ? req.query.billAmount : undefined;
    const billNumber = typeof req.query.billNumber === "string" ? req.query.billNumber : undefined;
    const nameAddress = typeof req.query.nameAddress === "string" ? req.query.nameAddress : undefined;
    const mobileNumber = typeof req.query.mobileNumber === "string" ? req.query.mobileNumber : undefined;
    const companyName = typeof req.query.companyName === "string" ? req.query.companyName : undefined;
    const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
    const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const pageRaw = typeof req.query.page === "string" ? parseInt(req.query.page, 10) : NaN;
    const stage =
      typeof req.query.stage === "string" &&
      ["all", "create", "tag-complete", "packing-done", "delivery"].includes(req.query.stage)
        ? (req.query.stage as "all" | "create" | "tag-complete" | "packing-done" | "delivery")
        : "all";
    const priority =
      typeof req.query.priority === "string" &&
      ["all", "urgent", "normal"].includes(req.query.priority)
        ? (req.query.priority as "all" | "urgent" | "normal")
        : "all";
    const expectedDate =
      typeof req.query.expectedDate === "string" &&
      req.query.expectedDate === "only"
        ? "only"
        : "off";
    const deliveryType =
      typeof req.query.deliveryType === "string" &&
      ["all", "takeaway", "delivery"].includes(req.query.deliveryType)
        ? (req.query.deliveryType as "all" | "takeaway" | "delivery")
        : "all";
    const paymentStatus = parseTrackingPaymentStatus(req.query.paymentStatus);
    const dateField =
      typeof req.query.dateField === "string" && req.query.dateField.toLowerCase() === "delivery"
        ? "delivery"
        : "entry";
    const sortOrder = parseTrackingSortOrder(req.query.sortOrder);
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : undefined;
    const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
    const offset = limit ? (page - 1) * limit : undefined;
    const hasTrackingFilters =
      !!fromRaw ||
      !!toRaw ||
      Number.isFinite(limitRaw) ||
      typeof req.query.sortOrder === "string" ||
      dateField === "delivery" ||
      stage !== "all" ||
      priority !== "all" ||
      expectedDate !== "off" ||
      deliveryType !== "all" ||
      paymentStatus !== "all" ||
      !!accountNumber ||
      !!orderNumber ||
      !!billAmount ||
      !!billNumber ||
      !!nameAddress ||
      !!mobileNumber ||
      !!companyName ||
      !!search;

    const orderList = hasTrackingFilters
      ? await storage.getOrdersForTracking({
          search,
          accountNumber,
          orderNumber,
          billAmount,
          billNumber,
          nameAddress,
          mobileNumber,
          companyName,
          from: from && !Number.isNaN(from.getTime()) ? from : undefined,
          to: to && !Number.isNaN(to.getTime()) ? to : undefined,
          limit,
          offset,
          dateField,
          sortOrder,
          stage,
          priority,
          expectedDate,
          deliveryType,
          paymentStatus,
        })
      : await storage.getOrders(search);

    const accountSyncedOrders = await applyCurrentAccountDataToOrders(orderList);

    res.json(accountSyncedOrders.map(sanitizeOrderActorLabels));
  });

  app.get("/api/orders/tracking-count", async (req, res) => {
    const search = req.query.search as string | undefined;
    const accountNumber = typeof req.query.accountNumber === "string" ? req.query.accountNumber : undefined;
    const orderNumber = typeof req.query.orderNumber === "string" ? req.query.orderNumber : undefined;
    const billAmount = typeof req.query.billAmount === "string" ? req.query.billAmount : undefined;
    const billNumber = typeof req.query.billNumber === "string" ? req.query.billNumber : undefined;
    const nameAddress = typeof req.query.nameAddress === "string" ? req.query.nameAddress : undefined;
    const mobileNumber = typeof req.query.mobileNumber === "string" ? req.query.mobileNumber : undefined;
    const companyName = typeof req.query.companyName === "string" ? req.query.companyName : undefined;
    const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
    const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
    const stage =
      typeof req.query.stage === "string" &&
      ["all", "create", "tag-complete", "packing-done", "delivery"].includes(req.query.stage)
        ? (req.query.stage as "all" | "create" | "tag-complete" | "packing-done" | "delivery")
        : "all";
    const priority =
      typeof req.query.priority === "string" &&
      ["all", "urgent", "normal"].includes(req.query.priority)
        ? (req.query.priority as "all" | "urgent" | "normal")
        : "all";
    const expectedDate =
      typeof req.query.expectedDate === "string" &&
      req.query.expectedDate === "only"
        ? "only"
        : "off";
    const deliveryType =
      typeof req.query.deliveryType === "string" &&
      ["all", "takeaway", "delivery"].includes(req.query.deliveryType)
        ? (req.query.deliveryType as "all" | "takeaway" | "delivery")
        : "all";
    const paymentStatus = parseTrackingPaymentStatus(req.query.paymentStatus);
    const dateField =
      typeof req.query.dateField === "string" && req.query.dateField.toLowerCase() === "delivery"
        ? "delivery"
        : "entry";
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    const count = await storage.getOrderCountForTracking({
      search,
      accountNumber,
      orderNumber,
      billAmount,
      billNumber,
      nameAddress,
      mobileNumber,
      companyName,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      dateField,
      stage,
      priority,
      expectedDate,
      deliveryType,
      paymentStatus,
    });

    res.json({ count });
  });

  app.get("/api/orders/tracking-summary", async (req, res) => {
    const search = req.query.search as string | undefined;
    const accountNumber = typeof req.query.accountNumber === "string" ? req.query.accountNumber : undefined;
    const orderNumber = typeof req.query.orderNumber === "string" ? req.query.orderNumber : undefined;
    const billAmount = typeof req.query.billAmount === "string" ? req.query.billAmount : undefined;
    const billNumber = typeof req.query.billNumber === "string" ? req.query.billNumber : undefined;
    const nameAddress = typeof req.query.nameAddress === "string" ? req.query.nameAddress : undefined;
    const mobileNumber = typeof req.query.mobileNumber === "string" ? req.query.mobileNumber : undefined;
    const companyName = typeof req.query.companyName === "string" ? req.query.companyName : undefined;
    const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
    const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
    const stage =
      typeof req.query.stage === "string" &&
      ["all", "create", "tag-complete", "packing-done", "delivery"].includes(req.query.stage)
        ? (req.query.stage as "all" | "create" | "tag-complete" | "packing-done" | "delivery")
        : "all";
    const priority =
      typeof req.query.priority === "string" &&
      ["all", "urgent", "normal"].includes(req.query.priority)
        ? (req.query.priority as "all" | "urgent" | "normal")
        : "all";
    const expectedDate =
      typeof req.query.expectedDate === "string" &&
      req.query.expectedDate === "only"
        ? "only"
        : "off";
    const deliveryType =
      typeof req.query.deliveryType === "string" &&
      ["all", "takeaway", "delivery"].includes(req.query.deliveryType)
        ? (req.query.deliveryType as "all" | "takeaway" | "delivery")
        : "all";
    const paymentStatus = parseTrackingPaymentStatus(req.query.paymentStatus);
    const dateField =
      typeof req.query.dateField === "string" && req.query.dateField.toLowerCase() === "delivery"
        ? "delivery"
        : "entry";
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    const [matchingOrders, allBills] = await Promise.all([
      storage.getOrdersForTracking({
        search,
        accountNumber,
        orderNumber,
        billAmount,
        billNumber,
        nameAddress,
        mobileNumber,
        companyName,
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        to: to && !Number.isNaN(to.getTime()) ? to : undefined,
        dateField,
        stage,
        priority,
        expectedDate,
        deliveryType,
        paymentStatus,
      }),
      storage.getBills(),
    ]);

    const billsById = new Map(allBills.map((bill) => [bill.id, bill]));
    const ordersByBillId = new Map<number, typeof matchingOrders>();

    matchingOrders.forEach((order) => {
      if (!order.billId) return;
      const current = ordersByBillId.get(order.billId) || [];
      current.push(order);
      ordersByBillId.set(order.billId, current);
    });

    const hasMeaningfulAdjustment = (order: (typeof matchingOrders)[number]) => {
      const adjustedRaw = order.adjustedTotal;
      const hasAdjustedValue =
        adjustedRaw !== null &&
        adjustedRaw !== undefined &&
        String(adjustedRaw).trim() !== "";
      if (!hasAdjustedValue) return false;
      return String(order.priceAdjustReason || "").trim().length > 0;
    };
    const getOrderDeliveryChargeAmount = (order: (typeof matchingOrders)[number]) => {
      const value = parseFloat(String((order as any).deliveryCharge || "0"));
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    const getOrderTipsAmount = (order: (typeof matchingOrders)[number]) => {
      const value = parseFloat(String(order.tips || "0"));
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    const getOrderExtraCharges = (order: (typeof matchingOrders)[number]) =>
      getOrderDeliveryChargeAmount(order) + getOrderTipsAmount(order);

    const getOrderWorkReceivedAmount = (order: (typeof matchingOrders)[number]): number => {
      if (hasMeaningfulAdjustment(order)) {
        const adjusted = parseFloat(String(order.adjustedTotal ?? "0"));
        return Number.isFinite(adjusted) ? Math.max(0, adjusted) : 0;
      }

      const original = parseFloat(String(order.totalAmount ?? ""));
      if (Number.isFinite(original)) {
        return Math.max(0, original);
      }

      if (order.billId) {
        const linkedBill = billsById.get(order.billId);
        const ordersInSameBill = ordersByBillId.get(order.billId) || [];
        if (linkedBill && ordersInSameBill.length <= 1) {
          const billOriginalAmount = parseFloat(String(linkedBill.originalAmount ?? ""));
          if (
            Number.isFinite(billOriginalAmount) &&
            (billOriginalAmount > 0 || String(linkedBill.originalAmount ?? "").trim() !== "")
          ) {
            return Math.max(0, billOriginalAmount);
          }

          const billFinalAmount = parseFloat(String(linkedBill.amount ?? ""));
          const billDiscountAmount = parseFloat(String(linkedBill.discountAmount ?? "0"));
          const billDeliveryCharge = parseFloat(String((linkedBill as any).deliveryCharge ?? "0"));
          if (Number.isFinite(billFinalAmount)) {
            const safeBillDiscount = Number.isFinite(billDiscountAmount)
              ? Math.max(0, billDiscountAmount)
              : 0;
            const safeBillDeliveryCharge = Number.isFinite(billDeliveryCharge)
              ? Math.max(0, billDeliveryCharge)
              : 0;
            return Math.max(0, billFinalAmount + safeBillDiscount - safeBillDeliveryCharge);
          }
        }
      }

      const finalAmount = parseFloat(String(order.finalAmount ?? "0"));
      if (!Number.isFinite(finalAmount)) return 0;
      const directDiscount = parseFloat(String(order.discountAmount || "0"));
      const safeDiscount = Number.isFinite(directDiscount) ? Math.max(0, directDiscount) : 0;
      return Math.max(0, finalAmount + safeDiscount - getOrderExtraCharges(order));
    };

    const getOrderDiscountAmount = (order: (typeof matchingOrders)[number]): number => {
      const directDiscount = parseFloat(String(order.discountAmount || "0"));
      if (Number.isFinite(directDiscount) && directDiscount > 0) {
        return Math.max(0, directDiscount);
      }

      if (!order.billId) return 0;
      const linkedBill = billsById.get(order.billId);
      const billDiscount = parseFloat(String(linkedBill?.discountAmount || "0"));
      if (!Number.isFinite(billDiscount) || billDiscount <= 0) return 0;

      const ordersInSameBill = ordersByBillId.get(order.billId) || [];
      if (ordersInSameBill.length <= 1) {
        return Math.max(0, billDiscount);
      }

      const billBaseTotal = ordersInSameBill.reduce(
        (sum, candidate) => sum + getOrderWorkReceivedAmount(candidate),
        0,
      );
      if (billBaseTotal <= 0) return 0;

      const orderShare = getOrderWorkReceivedAmount(order) / billBaseTotal;
      return Math.max(0, billDiscount * orderShare);
    };

    const getOrderFinalAmount = (order: (typeof matchingOrders)[number]): number => {
      const explicitFinalAmount = parseFloat(String(order.finalAmount ?? ""));
      if (
        Number.isFinite(explicitFinalAmount) &&
        String(order.finalAmount ?? "").trim() !== ""
      ) {
        return Math.max(0, explicitFinalAmount);
      }

      if (order.billId) {
        const linkedBill = billsById.get(order.billId);
        const ordersInSameBill = ordersByBillId.get(order.billId) || [];
        if (linkedBill && ordersInSameBill.length <= 1) {
          const linkedBillAmount = parseFloat(String(linkedBill.amount ?? ""));
          if (
            Number.isFinite(linkedBillAmount) &&
            (linkedBillAmount > 0 || String(linkedBill.amount ?? "").trim() !== "")
          ) {
            return Math.max(0, linkedBillAmount);
          }
        }
      }

      const workReceived = getOrderWorkReceivedAmount(order);
      return Math.max(0, workReceived - getOrderDiscountAmount(order)) + getOrderExtraCharges(order);
    };

    const getBillDisplayAmounts = (billId: number) => {
      const linkedBill = billsById.get(billId);
      if (!linkedBill) {
	        return {
	          originalAmount: 0,
	          discount: 0,
	          deliveryCharge: 0,
	          finalAmount: 0,
	          paidAmount: 0,
	          due: 0,
        };
      }

      const linkedOrders = ordersByBillId.get(billId) || [];
      const fallbackOriginalRaw = parseFloat(
        String(linkedBill.originalAmount ?? linkedBill.amount ?? "0"),
      );
      const fallbackDiscountRaw = parseFloat(String(linkedBill.discountAmount || "0"));
      const fallbackDeliveryChargeRaw = parseFloat(String((linkedBill as any).deliveryCharge || "0"));
      const fallbackFinalRaw = parseFloat(String(linkedBill.amount || "0"));
      const paidAmountRaw = parseFloat(String(linkedBill.paidAmount || "0"));

      const fallbackOriginalAmount = Number.isFinite(fallbackOriginalRaw)
        ? Math.max(0, fallbackOriginalRaw)
        : 0;
      const fallbackDiscount = Number.isFinite(fallbackDiscountRaw)
        ? Math.max(0, fallbackDiscountRaw)
        : 0;
      const fallbackDeliveryCharge = Number.isFinite(fallbackDeliveryChargeRaw)
        ? Math.max(0, fallbackDeliveryChargeRaw)
        : 0;
      const fallbackFinalAmount = Number.isFinite(fallbackFinalRaw)
        ? Math.max(0, fallbackFinalRaw)
        : 0;

	      let originalAmount = fallbackOriginalAmount;
	      let discount = fallbackDiscount;
	      let deliveryCharge = fallbackDeliveryCharge;
	      let finalAmount = fallbackFinalAmount;
	      const paidAmount = Number.isFinite(paidAmountRaw) ? Math.max(0, paidAmountRaw) : 0;

      if (linkedOrders.length > 0) {
        originalAmount = linkedOrders.reduce(
          (sum, order) => sum + getOrderWorkReceivedAmount(order),
          0,
	        );
	        discount = linkedOrders.reduce((sum, order) => sum + getOrderDiscountAmount(order), 0);
	        deliveryCharge = linkedOrders.reduce((sum, order) => sum + getOrderDeliveryChargeAmount(order), 0);
	        finalAmount = linkedOrders.reduce((sum, order) => sum + getOrderFinalAmount(order), 0);
	      }

      if (originalAmount <= 0.009 && fallbackOriginalAmount > 0) {
        originalAmount = fallbackOriginalAmount;
      }
	      if (discount <= 0.009 && fallbackDiscount > 0) {
	        discount = fallbackDiscount;
	      }
	      if (deliveryCharge <= 0.009 && fallbackDeliveryCharge > 0) {
	        deliveryCharge = fallbackDeliveryCharge;
	      }
	      if (finalAmount <= 0.009 && fallbackFinalAmount > 0) {
	        finalAmount = fallbackFinalAmount;
	      }
	      if (originalAmount <= 0.009 && (finalAmount > 0 || discount > 0)) {
	        originalAmount = Math.max(0, finalAmount + discount - deliveryCharge);
	      }

      return {
	        originalAmount,
	        discount,
	        deliveryCharge,
	        finalAmount,
	        paidAmount,
        due: Math.max(0, finalAmount - paidAmount),
      };
    };

    const billAmountsCache = new Map<number, ReturnType<typeof getBillDisplayAmounts>>();

    const summary = matchingOrders.reduce(
      (totals, order) => {
	        const workReceived = getOrderWorkReceivedAmount(order);
	        const discount = getOrderDiscountAmount(order);
	        const deliveryCharge = getOrderDeliveryChargeAmount(order);
	        const finalAmount = getOrderFinalAmount(order);

        let paidAmount = 0;
        let dueAmount = Math.max(0, finalAmount);

        if (order.billId) {
          const linkedOrders = ordersByBillId.get(order.billId) || [];
          if (linkedOrders.length > 0) {
            const cachedBillAmounts =
              billAmountsCache.get(order.billId) || getBillDisplayAmounts(order.billId);
            billAmountsCache.set(order.billId, cachedBillAmounts);

            if (linkedOrders.length <= 1) {
              paidAmount = cachedBillAmounts.paidAmount;
              dueAmount = cachedBillAmounts.due;
            } else {
              const totalFinalForBill = linkedOrders.reduce(
                (sum, candidate) => sum + getOrderFinalAmount(candidate),
                0,
              );
              const totalWorkReceivedForBill = linkedOrders.reduce(
                (sum, candidate) => sum + getOrderWorkReceivedAmount(candidate),
                0,
              );

              let share = 1 / linkedOrders.length;
              if (totalFinalForBill > 0 && finalAmount > 0) {
                share = finalAmount / totalFinalForBill;
              } else if (totalWorkReceivedForBill > 0 && workReceived > 0) {
                share = workReceived / totalWorkReceivedForBill;
              }

              paidAmount = cachedBillAmounts.paidAmount * share;
              dueAmount = cachedBillAmounts.due * share;
            }
          }
        }

        totals.count += 1;
	        totals.workReceived += workReceived;
	        totals.discount += discount;
	        totals.deliveryCharge += deliveryCharge;
	        totals.finalAmount += finalAmount;
        totals.paidAmount += paidAmount;
        totals.dueAmount += dueAmount;
        return totals;
      },
      {
        count: 0,
	        workReceived: 0,
	        discount: 0,
	        deliveryCharge: 0,
	        finalAmount: 0,
        paidAmount: 0,
        dueAmount: 0,
      },
    );

    res.json(summary);
  });

  app.get("/api/orders/tracking-selection", async (req, res) => {
    const search = req.query.search as string | undefined;
    const accountNumber = typeof req.query.accountNumber === "string" ? req.query.accountNumber : undefined;
    const orderNumber = typeof req.query.orderNumber === "string" ? req.query.orderNumber : undefined;
    const billAmount = typeof req.query.billAmount === "string" ? req.query.billAmount : undefined;
    const billNumber = typeof req.query.billNumber === "string" ? req.query.billNumber : undefined;
    const nameAddress = typeof req.query.nameAddress === "string" ? req.query.nameAddress : undefined;
    const mobileNumber = typeof req.query.mobileNumber === "string" ? req.query.mobileNumber : undefined;
    const companyName = typeof req.query.companyName === "string" ? req.query.companyName : undefined;
    const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
    const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
    const stage =
      typeof req.query.stage === "string" &&
      ["all", "create", "tag-complete", "packing-done", "delivery"].includes(req.query.stage)
        ? (req.query.stage as "all" | "create" | "tag-complete" | "packing-done" | "delivery")
        : "all";
    const priority =
      typeof req.query.priority === "string" &&
      ["all", "urgent", "normal"].includes(req.query.priority)
        ? (req.query.priority as "all" | "urgent" | "normal")
        : "all";
    const expectedDate =
      typeof req.query.expectedDate === "string" &&
      req.query.expectedDate === "only"
        ? "only"
        : "off";
    const deliveryType =
      typeof req.query.deliveryType === "string" &&
      ["all", "takeaway", "delivery"].includes(req.query.deliveryType)
        ? (req.query.deliveryType as "all" | "takeaway" | "delivery")
        : "all";
    const paymentStatus = parseTrackingPaymentStatus(req.query.paymentStatus);
    const dateField =
      typeof req.query.dateField === "string" && req.query.dateField.toLowerCase() === "delivery"
        ? "delivery"
        : "entry";
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    const items = await storage.getOrderSelectionForTracking({
      search,
      accountNumber,
      orderNumber,
      billAmount,
      billNumber,
      nameAddress,
      mobileNumber,
      companyName,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      dateField,
      stage,
      priority,
      expectedDate,
      deliveryType,
      paymentStatus,
    });

    res.json(items);
  });

  app.get("/api/orders/due-soon", async (req, res) => {
    const windowMinutes = parseInt(req.query.window as string) || 60;
    const allOrders = await storage.getOrders();
    const now = new Date();
    const dueSoon = allOrders.filter((order) => {
      if (!order.expectedDeliveryAt || order.delivered) return false;
      const timeDiff =
        new Date(order.expectedDeliveryAt).getTime() - now.getTime();
      const minutesLeft = timeDiff / (1000 * 60);
      return minutesLeft > 0 && minutesLeft <= windowMinutes;
    });
    res.json(dueSoon);
  });

  // Active Orders for Incident Reporting (with client info)
  app.get("/api/orders/active-with-clients", async (req, res) => {
    try {
      const allOrders = await storage.getOrders();
      // Include "entry" status as well (shows as "Pending" in UI)
      const activeStatuses = ["entry", "pending", "tagging", "packing", "ready"];
      const activeOrders = allOrders.filter(o => activeStatuses.includes(o.status || "") && !o.delivered);

      // Get client info for each order
      const ordersWithClients = await Promise.all(
        activeOrders.map(async (order) => {
          let clientInfo = { name: order.customerName, phone: "", address: "" };
          if (order.clientId) {
            const client = await storage.getClient(order.clientId);
            if (client) {
              clientInfo = {
                name: client.name,
                phone: client.phone || "",
                address: client.address || "",
              };
            }
          }
          return {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            customerName: clientInfo.name,
            customerPhone: clientInfo.phone,
            customerAddress: clientInfo.address,
            items: order.items || "",
            totalAmount: order.totalAmount || "0",
          };
        })
      );

      res.json(ordersWithClients);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch active orders" });
    }
  });

  app.get("/api/orders/by-number/:orderNumber", async (req, res) => {
    const { orderNumber } = req.params;
    if (!orderNumber) {
      return res.status(400).json({ message: "Order number is required" });
    }
    // Find any order (not just delivered) for incident reporting
    const order = await storage.getOrderByNumber(orderNumber);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    let items: Array<{ name: string; quantity: number; price: number }> = [];
    if (order.items) {
      const trimmed = order.items.trim();
      // Try JSON parsing first
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            items = parsed.map((item: any) => ({
              name: item.name || item.productName || 'Unknown',
              quantity: item.quantity || item.qty || 1,
              price: parseFloat(item.price) || 0
            }));
          }
        } catch (e) {
          // Fall through to string parsing
        }
      }

      // String format parsing: "2x Shirt, 3x Pants" or "Shirt x2, Pants x3"
      if (items.length === 0) {
        items = trimmed.split(", ").map((itemStr: string) => {
          // Try "2x ProductName" format first
          const quantityFirstMatch = itemStr.match(/^(\d+)x\s+(.+)$/);
          if (quantityFirstMatch) {
            return {
              name: quantityFirstMatch[2].trim(),
              quantity: parseInt(quantityFirstMatch[1]),
              price: 0
            };
          }

          // Try "ProductName x2" format
          const nameFirstMatch = itemStr.match(/^(.+)\s+x(\d+)$/);
          if (nameFirstMatch) {
            return {
              name: nameFirstMatch[1].trim(),
              quantity: parseInt(nameFirstMatch[2]),
              price: 0
            };
          }

          // No quantity found, assume 1
          return { name: itemStr.trim(), quantity: 1, price: 0 };
        }).filter(item => item.name && item.name !== '');
      }
    }
    // Fetch client details if order has clientId
    let customerPhone = "";
    let customerAddress = "";
    if (order.clientId) {
      const client = await storage.getClient(order.clientId);
      if (client) {
        customerPhone = client.phone || "";
        customerAddress = client.address || "";
      }
    }

    res.json({ order: sanitizeOrderActorLabels(order), items, customerPhone, customerAddress });
  });

  app.get("/api/orders/:id", async (req, res) => {
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const [accountSyncedOrder] = await applyCurrentAccountDataToOrders([order]);
    res.json(sanitizeOrderActorLabels(accountSyncedOrder));
  });

  app.post("/api/admin/bills/backfill-missing", async (req, res) => {
    try {
      const { adminPassword, dryRun = true } = req.body || {};
      const isAdminValid = await verifyAdminPassword(String(adminPassword || ""));
      if (!isAdminValid) {
        return res.status(401).json({ message: "Invalid admin password" });
      }

      const result = await db.transaction(async (tx) => {
        const allOrders = await tx.select().from(orders);
        const allBills = await tx.select({ id: bills.id }).from(bills);
        const existingBillIds = new Set(allBills.map((b) => b.id));

        const missingOrders = allOrders.filter((o) => !o.billId || !existingBillIds.has(o.billId));
        const created: Array<{
          orderId: number;
          orderNumber: string;
          previousBillId: number | null;
          newBillId: number | null;
          amount: string;
          dryRun: boolean;
        }> = [];
        const unresolved: Array<{
          orderId: number;
          orderNumber: string;
          reason: string;
        }> = [];

        for (const order of missingOrders) {
          const previousBillId = order.billId || null;

          if (!order.clientId) {
            unresolved.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              reason: "Order has no clientId",
            });
            continue;
          }

          const rawAmount = parseFloat(String(order.finalAmount ?? order.adjustedTotal ?? order.totalAmount ?? "0"));
          if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
            unresolved.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              reason: "Order amount is invalid or zero",
            });
            continue;
          }

          const desc = await buildBillDescriptionWithPrices(
            order.orderNumber,
            order.items || "",
            order.deliveryType || null,
          );

          if (dryRun) {
            created.push({
              orderId: order.id,
              orderNumber: order.orderNumber,
              previousBillId,
              newBillId: null,
              amount: rawAmount.toFixed(2),
              dryRun: true,
            });
            continue;
          }

          const [newBill] = await tx
            .insert(bills)
            .values({
              clientId: order.clientId,
              customerName: order.customerName || null,
              customerPhone: null,
              amount: rawAmount.toFixed(2),
              paidAmount: "0",
              description: desc,
              billDate: order.entryDate ? new Date(order.entryDate) : new Date(),
              referenceNumber: `BILL-${order.orderNumber}`,
              isPaid: false,
              paymentMethod: null,
              createdBy: order.entryBy || "System Backfill",
              originalAmount:
                (order.discountAmount && parseFloat(order.discountAmount) > 0) ||
                (order.deliveryCharge && parseFloat(order.deliveryCharge) > 0)
                  ? String(order.totalAmount || rawAmount.toFixed(2))
                  : null,
              discountAmount: order.discountAmount || "0",
              deliveryCharge: order.deliveryCharge || "0",
              discountAppliedBy: order.discountAmount && parseFloat(order.discountAmount) > 0 ? "system-backfill" : null,
            })
            .returning();

          await tx
            .update(orders)
            .set({ billId: newBill.id })
            .where(eq(orders.id, order.id));

          created.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            previousBillId,
            newBillId: newBill.id,
            amount: rawAmount.toFixed(2),
            dryRun: false,
          });
        }

        return {
          dryRun: Boolean(dryRun),
          scannedOrders: allOrders.length,
          missingCount: missingOrders.length,
          recoveredCount: created.length,
          unresolvedCount: unresolved.length,
          recovered: created,
          unresolved,
        };
      });

      if (!result.dryRun && result.recoveredCount > 0) {
        storage.notifyLiveResourceUpdated("bills");
      }

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to backfill missing bills" });
    }
  });

  app.get("/api/orders/date-change-audit", async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT id, order_id, order_number, old_entry_date, new_entry_date, delta_minutes, changed_by, reason, changed_at, bulk_group
        FROM order_date_change_audit
        ORDER BY changed_at DESC
        LIMIT 500
      `);
      res.json((rows as any)?.rows || []);
    } catch {
      // Audit table may not exist yet in some environments.
      res.json([]);
    }
  });

  app.post("/api/orders/:id/edit-date", async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (Number.isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const {
        staffPin,
        adminPin,
        newEntryDate,
        shiftStageDates = true,
        reason = "Manual date edit",
        changedBy = "admin",
      } = req.body || {};

      const pinAccess = await resolveOrderEditPinAccess(String(staffPin || adminPin || ""));
      if (!pinAccess) {
        return res.status(401).json({ message: "Invalid admin or counter PIN" });
      }

      if (!newEntryDate) {
        return res.status(400).json({ message: "newEntryDate is required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (!order.entryDate) {
        return res.status(400).json({ message: "Order does not have an entryDate to edit" });
      }

      const targetDate = new Date(newEntryDate);
      if (Number.isNaN(targetDate.getTime())) {
        return res.status(400).json({ message: "Invalid newEntryDate" });
      }

      const stageShiftOptions = resolveOrderDateShiftOptions({
        ...req.body,
        shiftStageDates,
      });

      const { updates, oldDate, resultingEntryDate, deltaMs, entryDateChanged } = buildOrderDateEditUpdates(
        order,
        targetDate,
        stageShiftOptions,
      );
      const timelineError = validateOrderDateEditTimeline(order, updates);
      if (timelineError) {
        return res.status(400).json({ message: timelineError });
      }

      const updatedOrder = await storage.updateOrder(orderId, updates);
      let updatedCreditManagementTransactions = false;
      if (entryDateChanged && order.billId) {
        await storage.updateBill(order.billId, { billDate: targetDate.toISOString() });
        updatedCreditManagementTransactions = await shiftCreditManagementDatesForBill(
          order.billId,
          deltaMs,
        );
      }

      if (updatedCreditManagementTransactions) {
        storage.notifyLiveResourceUpdated("clientTransactions");
      }

      try {
        await db.execute(sql`
          INSERT INTO order_date_change_audit
          (order_id, order_number, old_entry_date, new_entry_date, delta_minutes, changed_by, reason, changed_at, bulk_group)
          VALUES (
            ${order.id},
            ${order.orderNumber},
            ${oldDate.toISOString()},
            ${resultingEntryDate.toISOString()},
            ${Math.round(deltaMs / 60000)},
            ${String(changedBy || "admin")},
            ${String(reason || "Manual date edit")},
            NOW(),
            NULL
          )
        `);
      } catch {
        // Non-blocking audit fallback: operation still succeeds if audit insert fails.
      }

      res.json({
        success: true,
        order: updatedOrder,
        audit: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          oldEntryDate: oldDate.toISOString(),
          newEntryDate: resultingEntryDate.toISOString(),
          deltaMinutes: Math.round(deltaMs / 60000),
          entryDateChanged,
          shiftStageDates: Object.values(stageShiftOptions).some(Boolean),
          stageShiftOptions,
          changedBy: String(changedBy || "admin"),
          reason: String(reason || "Manual date edit"),
        },
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to edit order date" });
    }
  });

  app.post("/api/orders/bulk-edit-date", async (req, res) => {
    try {
      const {
        staffPin,
        adminPin,
        requireAdminPin = false,
        orderIds,
        newEntryDate,
        preserveOrderSpacing = true,
        spacingMinutes = 1,
        shiftStageDates = true,
        reason = "Bulk date edit",
        changedBy = "admin",
      } = req.body || {};

      if (requireAdminPin) {
        const isAdminValid = await verifyAdminPin(String(adminPin || ""));
        if (!isAdminValid) {
          return res.status(401).json({ message: "Invalid admin PIN" });
        }
      } else {
        const pinAccess = await resolveOrderEditPinAccess(String(staffPin || adminPin || ""));
        if (!pinAccess) {
          return res.status(401).json({ message: "Invalid admin or counter PIN" });
        }
      }

      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "orderIds must be a non-empty array" });
      }
      if (!newEntryDate) {
        return res.status(400).json({ message: "newEntryDate is required" });
      }

      const baseDate = new Date(newEntryDate);
      if (Number.isNaN(baseDate.getTime())) {
        return res.status(400).json({ message: "Invalid newEntryDate" });
      }

      const stageShiftOptions = resolveOrderDateShiftOptions({
        ...req.body,
        shiftStageDates,
      });

      const bulkGroup = `bulk-${Date.now()}`;
      const updated: Array<{ orderId: number; orderNumber: string; oldEntryDate: string; newEntryDate: string; deltaMinutes: number }> = [];
      const failed: Array<{ orderId: number; reason: string }> = [];
      let updatedCreditManagementTransactions = false;

      for (let i = 0; i < orderIds.length; i += 1) {
        const orderId = Number(orderIds[i]);
        if (Number.isNaN(orderId)) {
          failed.push({ orderId: -1, reason: `Invalid order id at index ${i}` });
          continue;
        }

        const order = await storage.getOrder(orderId);
        if (!order || !order.entryDate) {
          failed.push({ orderId, reason: "Order not found or missing entryDate" });
          continue;
        }

        const targetDate = preserveOrderSpacing
          ? new Date(baseDate.getTime() + i * Math.max(0, Number(spacingMinutes) || 0) * 60000)
          : new Date(baseDate);

        const { updates, oldDate, resultingEntryDate, deltaMs, entryDateChanged } = buildOrderDateEditUpdates(
          order,
          targetDate,
          stageShiftOptions,
        );
        const timelineError = validateOrderDateEditTimeline(order, updates);
        if (timelineError) {
          failed.push({ orderId, reason: timelineError });
          continue;
        }

        await storage.updateOrder(order.id, updates);
        if (entryDateChanged && order.billId) {
          await storage.updateBill(order.billId, { billDate: targetDate.toISOString() });
          if (
            await shiftCreditManagementDatesForBill(order.billId, deltaMs)
          ) {
            updatedCreditManagementTransactions = true;
          }
        }

        try {
          await db.execute(sql`
            INSERT INTO order_date_change_audit
            (order_id, order_number, old_entry_date, new_entry_date, delta_minutes, changed_by, reason, changed_at, bulk_group)
            VALUES (
              ${order.id},
              ${order.orderNumber},
              ${oldDate.toISOString()},
              ${resultingEntryDate.toISOString()},
              ${Math.round(deltaMs / 60000)},
              ${String(changedBy || "admin")},
              ${String(reason || "Bulk date edit")},
              NOW(),
              ${bulkGroup}
            )
          `);
        } catch {
          // Keep operation non-blocking when audit insert is unavailable.
        }

        updated.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          oldEntryDate: oldDate.toISOString(),
          newEntryDate: resultingEntryDate.toISOString(),
          deltaMinutes: Math.round(deltaMs / 60000),
        });
      }

      if (updatedCreditManagementTransactions) {
        storage.notifyLiveResourceUpdated("clientTransactions");
      }

      if (updated.length === 0) {
        return res.status(400).json({
          message: failed[0]?.reason || "No order dates were updated.",
          success: false,
          bulkGroup,
          stageShiftOptions,
          updatedCount: 0,
          failedCount: failed.length,
          updated,
          failed,
        });
      }

      const summaryMessage =
        failed.length > 0
          ? `${updated.length} order(s) updated. ${failed.length} skipped because the timeline would become inconsistent.`
          : `${updated.length} order(s) were moved successfully.`;

      res.json({
        success: true,
        message: summaryMessage,
        bulkGroup,
        stageShiftOptions,
        updatedCount: updated.length,
        failedCount: failed.length,
        updated,
        failed,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to bulk edit order dates" });
    }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      let {
        customerName,
        customerPhone,
        deliveryAddress,
        billId: requestBillId,
        createdBy,
        creatorRole,
      } = req.body;

      if (customerName) customerName = customerName.trim().toUpperCase();
      if (customerPhone) customerPhone = normalizePhoneForStorage(customerPhone);
      if (deliveryAddress) deliveryAddress = deliveryAddress.trim().toUpperCase();

      if (customerPhone && !isPlausiblePhoneNumber(customerPhone)) {
        return res.status(400).json({ message: "Enter a valid phone number for the selected country" });
      }

      // All PINs are universal - any valid PIN can create orders
      // createdBy and creatorRole are used for tracking only, not for access control

      // // Validate required fields
      // if (!customerName || !customerName.trim()) {
      //   return res.status(400).json({ message: "Customer name is required" });
      // }
      // if (!customerPhone || !customerPhone.trim()) {
      //   return res.status(400).json({ message: "Customer phone is required" });
      // }

      // Check if customer already exists - if so, reject and require using the existing client
      let clientId = req.body.clientId;
      const hasCustomerName = !!customerName?.trim();
      const hasCustomerPhone = !!customerPhone?.trim();
      const hasDeliveryAddress = !!deliveryAddress?.trim();

      if (!clientId) {
        if (!hasCustomerName && !hasCustomerPhone && !hasDeliveryAddress) {
          return res.status(400).json({
            message: "Enter at least one client detail: name, phone, or address",
          });
        }

        // For walk-in orders, check if phone matches existing client - if so, reject
        if (customerPhone?.trim()) {
          const existingClient = await storage.findClientByPhone(customerPhone);

          if (existingClient) {
            // Block creation - client already exists
            return res
              .status(400)
              .json({ message: `Customer details already exist: ${existingClient.name}. Please select them from the client list.` });
          }
        }

        // No matching client found - create new one
        // Auto-create new client
        const walkinCompany = req.body.walkinCompany;
        const requestedClientType =
          String(req.body.clientType || "regular").trim().toLowerCase() === "broker"
            ? "broker"
            : "regular";
        const requestedBrokerAddresses = Array.isArray(req.body.brokerAddresses)
          ? req.body.brokerAddresses
              .filter((address: unknown): address is string => typeof address === "string")
              .map((address: string) => address.trim().toUpperCase())
              .filter((address: string, index: number, values: string[]) => !!address && values.indexOf(address) === index)
          : [];
        const normalizedClientAddress = deliveryAddress?.trim() || "";
        const normalizedBrokerAddresses = requestedClientType === "broker"
          ? [normalizedClientAddress, ...requestedBrokerAddresses].filter(
              (address: string, index: number, values: string[]) => !!address && values.indexOf(address) === index,
            )
          : [];
        const fallbackClientName = requestedClientType === "broker" ? "BROKER CLIENT" : "REGULAR CLIENT";
        const newClient = await storage.createClient({
          name: customerName?.trim() || fallbackClientName,
          phone: customerPhone?.trim() || "",
          email: "",
          address: normalizedClientAddress,
          company: walkinCompany?.trim() || null,
          clientType: requestedClientType,
          brokerAddresses: normalizedBrokerAddresses,
        });
        clientId = newClient.id;
      }

      if (clientId && (!customerName || !customerPhone)) {
        const selectedClient = await storage.getClient(Number(clientId));
        if (selectedClient) {
          customerName = (customerName || selectedClient.name || "").trim().toUpperCase();
          customerPhone = normalizePhoneForStorage((customerPhone || selectedClient.phone || "").trim());
        }
      }

      if (requestBillId) {
        return res.status(400).json({
          message: "Each order must have its own unique bill. Attaching to an existing bill is disabled.",
        });
      }

      const generatedOrderNumber = await getNextSequentialOrderNumber();
      let assignedBillId: number | null = null;

      const order = await storage.createOrder({
        ...req.body,
        orderNumber: generatedOrderNumber,
        clientId,
        billId: assignedBillId,
        customerName: (customerName || "").trim(),
        customerPhone: (customerPhone || "").trim(),
      });

      if (clientId && deliveryAddress && deliveryAddress.trim() && deliveryAddress.trim() !== "-") {
        const existingClient = await storage.getClient(Number(clientId));
        if (existingClient) {
          const isBroker = ((existingClient as any).clientType || "").trim().toLowerCase() === "broker";
          const normalizedAddress = deliveryAddress.trim();
          if (isBroker) {
            const currentAddresses: string[] = (existingClient as any).brokerAddresses || [];
            if (!currentAddresses.some((address) => address.toUpperCase() === normalizedAddress.toUpperCase())) {
              await storage.updateClient(Number(clientId), {
                brokerAddresses: [...currentAddresses, normalizedAddress],
              } as any);
            }
          } else {
            await storage.updateClient(Number(clientId), { address: normalizedAddress });
          }
        }
      }

      try {
        if (order.urgent) {
          await storage.updateOrder(order.id, {
            tagDone: true,
            tagDate: new Date(),
            tagBy: createdBy || order.entryBy || "System",
            tagWorkerId: req.body.entryByWorkerId || null,
            status: "tagged",
          });
        }

        // Handle bill creation/attachment
      if (clientId && order.finalAmount) {
        const orderAmount = parseFloat(order.finalAmount.toString());

        const enrichedDesc = await buildBillDescriptionWithPrices(order.orderNumber, order.items || "", order.deliveryType || null);
        const orderDiscountAmt = parseFloat(order.discountAmount?.toString() || "0");
        const orderDeliveryCharge = Math.max(0, parseMoney(order.deliveryCharge));
        const newBill = await storage.createBill({
          clientId,
          customerName: (customerName || "").trim(),
          customerPhone: (customerPhone || "").trim(),
          amount: orderAmount.toFixed(2),
          originalAmount: Math.max(0, parseMoney(order.totalAmount)).toFixed(2),
          discountAmount: orderDiscountAmt > 0 ? orderDiscountAmt.toFixed(2) : "0",
          deliveryCharge: orderDeliveryCharge.toFixed(2),
          description: enrichedDesc,
          billDate: new Date(),
          referenceNumber: `BILL-${order.orderNumber}`,
            createdBy: createdBy || undefined,
          });
          assignedBillId = newBill.id;

          if (assignedBillId && assignedBillId !== order.billId) {
            await storage.updateOrder(order.id, { billId: assignedBillId });
          }
        }

        // Add stock immediately on order creation
        await storage.addStockForOrder(order.id);

        // Return order with updated billId
        const updatedOrder = await storage.getOrder(order.id);
        res.status(201).json(updatedOrder || order);
      } catch (innerErr: any) {
        // Prevent "order exists but bill missing" by rolling back created order on downstream failure.
        await storage.deleteOrder(order.id);
        throw innerErr;
      }
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/orders/:id", async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const updates = { ...req.body };
      const existingOrder = await storage.getOrder(orderId);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      applyFullItemReleaseStageSync(existingOrder, updates);

      // If packingDone is being set to true, record the packing completion time
      if (updates.packingDone === true) {
        if (!existingOrder.packingDone && !updates.packingDate) {
          updates.packingDate = new Date().toISOString();
        }
      }

      // If urgent is being toggled, recalculate item prices
      if (updates.urgent !== undefined) {
        if (existingOrder && existingOrder.urgent !== updates.urgent && existingOrder.items) {
          const allProducts = await storage.getProducts();
          const makingUrgent = updates.urgent === true;
          const itemParts = existingOrder.items.split(",").map((s: string) => s.trim()).filter(Boolean);
          const newItems: string[] = [];
          let newTotal = 0;

          for (const part of itemParts) {
            const sqmItem = parseSqmDescriptionPart(part, allProducts);
            if (sqmItem) {
              const qtyPrefix = sqmItem.qty > 1 ? `${sqmItem.qty}x ` : "";
              const noteSuffix = sqmItem.note ? ` (${sqmItem.note})` : "";
              newItems.push(
                sqmItem.price > 0
                  ? `${qtyPrefix}${sqmItem.name} @ ${sqmItem.price.toFixed(2)} AED${noteSuffix}`
                  : `${qtyPrefix}${sqmItem.name}`,
              );
              newTotal += sqmItem.qty * sqmItem.price;
              continue;
            }
            const match = part.match(/^(\d+)x\s+(.+?)(?:\s+@\s+[\d.]+\s+AED)?$/i);
            if (!match) {
              newItems.push(part);
              continue;
            }
            const qty = parseInt(match[1]);
            let itemName = match[2].trim();

            const hadUrg = itemName.includes('*URG*');
            const serviceMatch = itemName.match(/\[(N|DC|IO|D|I)\]/i);
            const serviceTag = serviceMatch ? serviceMatch[1].toUpperCase() : 'N';
            const isDC = serviceTag === 'DC' || serviceTag === 'D';
            const isIO = serviceTag === 'IO' || serviceTag === 'I';
            const sizeMatch = itemName.match(/\((Small|Medium|Large)\)/i);
            const size = sizeMatch ? sizeMatch[1].toLowerCase() : null;

            // Get base product name for lookup
            const baseName = itemName
              .replace(/\s*\*URG\*\s*/g, '')
              .replace(/\s*\[[^\]]*\]\s*/g, '')
              .replace(/\s*\(Small\)|\(Medium\)|\(Large\)|\(folding\)|\(hanger\)|\(hanging\)/gi, '')
              .replace(/\s*@\s*[\d.]+\s*AED/gi, '')
              .trim();

            const product = allProducts.find((p: any) => p.name.toLowerCase() === baseName.toLowerCase());

            // Add or remove *URG* tag
            if (makingUrgent && !hadUrg) {
              // Add *URG* before the service tag or at the end
              const tagIndex = itemName.indexOf('[');
              if (tagIndex > 0) {
                itemName = itemName.substring(0, tagIndex).trim() + ' *URG*' + ' ' + itemName.substring(tagIndex);
              } else {
                itemName = itemName + ' *URG*';
              }
            } else if (!makingUrgent && hadUrg) {
              itemName = itemName.replace(/\s*\*URG\*\s*/g, ' ').replace(/\s+/g, ' ').trim();
            }

            const price = product
              ? getCatalogItemUnitPrice(itemName, allProducts, existingOrder.deliveryType || null)
              : 0;

            newTotal += qty * price;
            newItems.push(`${qty}x ${itemName} @ ${price.toFixed(2)} AED`);
          }

          updates.items = newItems.join(", ");
          updates.totalAmount = newTotal.toFixed(2);
          updates.adjustedTotal = null;
          updates.priceAdjustReason = null;

          // Apply discount if one exists
          const discountPercent = parseFloat(existingOrder.discountPercent || "0");
          const discountAmount = parseFloat(existingOrder.discountAmount || "0");
          let finalAmount = newTotal;
          const extraCharges = getOrderExtraCharges(existingOrder);
          if (discountPercent > 0) {
            finalAmount = newTotal - (newTotal * discountPercent / 100);
          } else if (discountAmount > 0) {
            finalAmount = newTotal - discountAmount;
          }
          if (finalAmount < 0) finalAmount = 0;
          finalAmount += extraCharges;
          updates.finalAmount = finalAmount.toFixed(2);

          // Update the associated bill
          if (existingOrder.billId) {
            const bill = await storage.getBill(existingOrder.billId);
            if (bill) {
              const paidAmount = parseFloat(bill.paidAmount || "0");
              const isPaid = paidAmount >= finalAmount;
              await storage.updateBill(existingOrder.billId, {
                amount: finalAmount.toFixed(2),
                isPaid,
              });
            }
          }
        }
      }

      const order = await storage.updateOrder(orderId, updates);

      res.json(sanitizeOrderActorLabels(order));
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/orders/:id/adjust-total", async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }
      const { adjustedTotal, reason, staffPin } = req.body;
      if (adjustedTotal == null || adjustedTotal === "" || !reason) {
        return res.status(400).json({ message: "Adjusted total and reason are required" });
      }

      const allStaff = await storage.getStaffMembers();
      const allUsers = await storage.getUsers();
      const staffMember = allStaff.find((s: any) => s.pin === staffPin);
      const userMatch = allUsers.find((u: any) => u.pin === staffPin);
      if (!staffMember && !userMatch) {
        return res.status(401).json({ message: "Invalid staff PIN" });
      }
      const staffName = staffMember?.name || userMatch?.name || userMatch?.username || "Unknown";

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.status === "delivered" || order.status === "picked_up") {
        return res.status(400).json({ message: "Cannot adjust price for completed orders" });
      }

      const adjustedVal = parseFloat(adjustedTotal);
      if (!Number.isFinite(adjustedVal) || adjustedVal < 0) {
        return res.status(400).json({ message: "Adjusted total must be a valid non-negative number" });
      }
      const fullReason = `${reason} (by ${staffName})`;

      const linkedBill = order.billId ? await storage.getBill(order.billId) : null;

      // Final amount should always be derived from work-received amount minus discount.
      let appliedDiscount = parseFloat(String(order.discountAmount || "0"));
      if (!Number.isFinite(appliedDiscount) || appliedDiscount < 0) {
        appliedDiscount = 0;
      }

      // Backward compatibility: if order-level discount is empty, fall back to bill-level discount.
      if (appliedDiscount <= 0 && linkedBill) {
        const billDiscount = parseFloat(String(linkedBill.discountAmount || "0"));
        if (Number.isFinite(billDiscount) && billDiscount > 0) {
          const allOrders = await storage.getOrders();
          const ordersInBill = allOrders.filter((o: any) => o.billId === order.billId);
          if (ordersInBill.length <= 1) {
            appliedDiscount = billDiscount;
          } else {
            const getBaseAmount = (o: any) => {
              const raw = parseFloat(String(o.adjustedTotal ?? o.totalAmount ?? o.finalAmount ?? "0"));
              return Number.isFinite(raw) ? Math.max(0, raw) : 0;
            };
            const billBaseTotal = ordersInBill.reduce((sum, o) => sum + getBaseAmount(o), 0);
            const thisOrderBase = getBaseAmount(order);
            if (billBaseTotal > 0 && thisOrderBase > 0) {
              appliedDiscount = billDiscount * (thisOrderBase / billBaseTotal);
            }
          }
        }
      }

      if (!Number.isFinite(appliedDiscount) || appliedDiscount < 0) {
        appliedDiscount = 0;
      }

      const newFinalAmount =
        Math.max(0, adjustedVal - appliedDiscount) + getOrderExtraCharges(order);

      const orderUpdates: any = {
        adjustedTotal: adjustedVal.toFixed(2),
        priceAdjustReason: fullReason,
        finalAmount: newFinalAmount.toFixed(2),
      };

      const existingOrderDiscount = parseFloat(String(order.discountAmount || "0"));
      if (appliedDiscount > 0 && (!Number.isFinite(existingOrderDiscount) || Math.abs(existingOrderDiscount - appliedDiscount) > 0.009)) {
        orderUpdates.discountAmount = appliedDiscount.toFixed(2);
      }

      const updatedOrder = await storage.updateOrder(orderId, orderUpdates);

      if (order.billId && linkedBill) {
        await syncBillFromLinkedOrders(order.billId, {
          priceAdjustReason: fullReason,
        });
      }

      res.json(sanitizeOrderActorLabels(updatedOrder));
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/orders/:id/edit-order", async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const {
        items,
        newPrice,
        priceReason,
	        newPaidAmount,
	        discountAmount,
	        deliveryCharge,
	        undoBill,
	        adminPassword,
	        staffPin,
        urgent,
      } = req.body;
      if (!staffPin && !adminPassword) {
        return res.status(400).json({ message: "Admin or counter PIN required" });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const pinAccess = staffPin ? await resolveOrderEditPinAccess(String(staffPin || "")) : null;
      const isAdminValid = staffPin
        ? !!pinAccess
        : await verifyAdminPassword(String(adminPassword || ""));
      if (!isAdminValid) {
        return res.status(401).json({ message: staffPin ? "Invalid admin or counter PIN" : "Invalid admin password" });
      }

      const hasManualPriceChange = newPrice !== undefined && newPrice !== null && !isNaN(newPrice);
	      const hasPaidAmountChange = newPaidAmount !== undefined && newPaidAmount !== null && !isNaN(newPaidAmount);
	      const hasDiscountChange = hasMoneyInput(discountAmount);
	      const requestedDiscountAmount = hasDiscountChange ? Math.max(0, parseMoney(discountAmount)) : 0;
	      const existingDeliveryChargeAmount = getOrderDeliveryCharge(order);
	      const hasDeliveryChargeInput = hasMoneyInput(deliveryCharge);
	      const requestedDeliveryChargeAmount = hasDeliveryChargeInput
	        ? Math.max(0, parseMoney(deliveryCharge))
	        : existingDeliveryChargeAmount;
	      const hasDeliveryChargeChange =
	        hasDeliveryChargeInput &&
	        Math.abs(requestedDeliveryChargeAmount - existingDeliveryChargeAmount) > 0.009;
	      const hasOrderPriorityChange = urgent !== undefined && Boolean(order.urgent) !== Boolean(urgent);
	      const isAdminEditor = staffPin ? pinAccess?.level === "admin" : true;
	      if (
	        !isAdminEditor &&
	        (hasManualPriceChange || hasPaidAmountChange || hasDeliveryChargeChange || hasOrderPriorityChange || Boolean(undoBill))
	      ) {
	        return res.status(403).json({
	          message: "Only admin PIN can change order priority, payment, delivery charge, or work received amounts",
	        });
	      }

      const changes: string[] = [];
      let currentBillAmount: number | null = null;
      const normalizedPriceReason = typeof priceReason === "string" ? priceReason.trim() : "";
      const effectivePriceReason =
        normalizedPriceReason.length > 0 ? normalizedPriceReason : "Admin bill amount update";
	      const existingDiscountAmount = await getOrderDiscountAmountForBase(order);
	      const orderExtraCharges = getOrderTipsAmount(order) + requestedDeliveryChargeAmount;

      // 1. Update items — use per-item prices sent from frontend
      if (items && Array.isArray(items) && items.length > 0) {
        const allProducts = await storage.getProducts();
        const buildSqmLookupKey = (quantity: number, itemName: string) => {
          const sqmMatch = itemName.match(/^([\d.]+)\s*sqm\s+(.+)$/i);
          if (!sqmMatch) return null;
          const sqm = parseFloat(sqmMatch[1]);
          const baseName = sqmMatch[2]
            .replace(/\s*@\s*[\d.]+\s*AED/i, "")
            .replace(/\s+Total\s+[\d.]+\s*AED/i, "")
            .replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i, "")
            .replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "")
            .trim()
            .toLowerCase();
          return `${quantity}|${sqm}|${baseName}`;
        };
        const existingSqmEntries = new Map<string, Array<{ price: number; note: string | null; isAdminEdited: boolean }>>();
        (order.items || "")
          .split(",")
          .map((part: string) => part.trim())
          .filter(Boolean)
          .forEach((part: string) => {
            const sqmItem = parseSqmDescriptionPart(part, allProducts);
            if (!sqmItem) return;
            const key = buildSqmLookupKey(sqmItem.qty, sqmItem.name);
            if (!key) return;
            const bucket = existingSqmEntries.get(key) || [];
            bucket.push({ price: sqmItem.price, note: sqmItem.note, isAdminEdited: sqmItem.isAdminEdited });
            existingSqmEntries.set(key, bucket);
          });

        let recalcTotal = 0;
        const itemsArray: string[] = [];

        for (const item of items) {
          if (!item.name || item.quantity <= 0) continue;
          const itemPrice = (item.price !== undefined && item.price !== null && !isNaN(item.price)) ? item.price : 0;
          const itemBaseUnitPrice =
            item.baseUnitPrice !== undefined && item.baseUnitPrice !== null && !isNaN(item.baseUnitPrice)
              ? Number(item.baseUnitPrice)
              : (getStoredBaseUnitPrice(item.name) ?? itemPrice);
          const sqmMatch = item.name.match(/^([\d.]+)\s*sqm\s+(.+)$/i);
          if (sqmMatch) {
            const sqm = parseFloat(sqmMatch[1]);
            const rawName = sqmMatch[2]
              .replace(/\s*@\s*[\d.]+\s*AED/i, "")
              .replace(/\s+Total\s+[\d.]+\s*AED/i, "")
              .replace(/\s*\(base\s*[\d.]+\s*AED\)\s*/gi, " ")
              .replace(/\s*\((custom|min\s*50|admin\s*edited)\)\s*$/i, "")
              .replace(/\s*\(\s*[\d.]+\s*AED\s*\)\s*$/i, "")
              .replace(/\s{2,}/g, " ")
              .trim();
            const normalizedName = /\(per\s*SQ\s*MTR\)/i.test(rawName)
              ? rawName
              : `${rawName} (per SQ MTR)`;
            const sqmLookupKey = buildSqmLookupKey(item.quantity, item.name);
            const previousSqmEntry = sqmLookupKey ? existingSqmEntries.get(sqmLookupKey)?.shift() : undefined;
            const sqmNote = previousSqmEntry
              ? (previousSqmEntry.isAdminEdited || Math.abs(previousSqmEntry.price - itemPrice) > 0.009 ? "admin edited" : previousSqmEntry.note)
              : null;
            const displayName = sqmNote === "admin edited"
              ? normalizedName.replace(/\s*\(per\s*SQ\s*MTR\)\s*$/i, "").trim()
              : normalizedName;
            const noteSuffix = sqmNote ? ` (${sqmNote})` : "";
            const baseSuffix = Number.isFinite(itemBaseUnitPrice)
              ? ` (base ${itemBaseUnitPrice.toFixed(2)} AED)`
              : "";
            recalcTotal += itemPrice * item.quantity;
            const qtyPrefix = item.quantity > 1 ? `${item.quantity}x ` : "";
            itemsArray.push(`${qtyPrefix}${sqm} sqm ${displayName}${baseSuffix} @ ${itemPrice.toFixed(2)} AED${noteSuffix}`);
            continue;
          }
          recalcTotal += itemPrice * item.quantity;
          itemsArray.push(formatStoredLineItem(item.quantity, item.name, itemPrice, itemBaseUnitPrice));
        }

        const newItemsStr = itemsArray.join(", ");
        if (newItemsStr !== order.items) {
          changes.push("Items updated");
        }

        // Determine final amount: manual override > (items total - discount)
        const workReceivedAmount = hasManualPriceChange ? parseMoney(newPrice) : recalcTotal;
        const disc = hasDiscountChange
          ? requestedDiscountAmount
          : await getOrderDiscountAmountForBase(order, workReceivedAmount);
        const baseFinal =
          newPrice !== undefined && newPrice !== null && !isNaN(newPrice)
            ? newPrice - disc
            : recalcTotal - disc;
        const finalAmt = Math.max(0, baseFinal) + orderExtraCharges;

	        const orderUpdates: any = {
	          items: newItemsStr,
	          totalAmount: recalcTotal.toFixed(2),
	          finalAmount: finalAmt.toFixed(2),
	          discountAmount: disc.toFixed(2),
	        };
	        if (hasDeliveryChargeInput) {
	          orderUpdates.deliveryCharge = requestedDeliveryChargeAmount.toFixed(2);
	        }
	        if (hasDiscountChange) {
	          orderUpdates.discountPercent = "0.00";
	        }
        if (urgent !== undefined) {
          orderUpdates.urgent = Boolean(urgent);
          if (Boolean(order.urgent) !== Boolean(urgent)) {
            changes.push(`Priority set to ${Boolean(urgent) ? "URGENT" : "NORMAL"}`);
          }
        }

        if (newPrice !== undefined && newPrice !== null && !isNaN(newPrice)) {
          orderUpdates.adjustedTotal = newPrice.toFixed(2);
          orderUpdates.priceAdjustReason = effectivePriceReason;
          changes.push(`Price set to AED ${newPrice.toFixed(2)}`);
        } else {
          orderUpdates.adjustedTotal = null;
          orderUpdates.priceAdjustReason = null;
        }

        await storage.updateOrder(orderId, orderUpdates);
        currentBillAmount = finalAmt;

        // Keep linked bill totals derived from its linked order rows.
        if (order.billId && !undoBill) {
          const enrichedDesc = await buildBillDescriptionWithPrices(order.orderNumber, newItemsStr, order.deliveryType || null);
          const syncedBill = await syncBillFromLinkedOrders(order.billId, {
            description: enrichedDesc,
            priceAdjustReason: newPrice !== undefined && newPrice !== null && !isNaN(newPrice)
              ? effectivePriceReason
              : null,
            discountAppliedBy: hasDiscountChange && disc > 0 ? (pinAccess?.name || "admin (edit)") : undefined,
          });
          if (syncedBill) {
            currentBillAmount = parseMoney(syncedBill.amount);
          }
        }
        if (hasDiscountChange) {
          const discountChange = formatDiscountChange(existingDiscountAmount, disc);
          if (discountChange) changes.push(discountChange);
        }
      } else if (newPrice !== undefined && newPrice !== null && !isNaN(newPrice)) {
        // Price override only, no items change
        const workReceivedAmount = parseMoney(newPrice);
        const disc = hasDiscountChange
          ? requestedDiscountAmount
          : await getOrderDiscountAmountForBase(order, workReceivedAmount);
        const finalAmt = Math.max(0, newPrice - disc) + orderExtraCharges;
	        const orderUpdates: any = {
	          adjustedTotal: newPrice.toFixed(2),
	          finalAmount: finalAmt.toFixed(2),
	          totalAmount: newPrice.toFixed(2),
	          discountAmount: disc.toFixed(2),
	        };
	        if (hasDeliveryChargeInput) {
	          orderUpdates.deliveryCharge = requestedDeliveryChargeAmount.toFixed(2);
	        }
	        if (hasDiscountChange) {
	          orderUpdates.discountPercent = "0.00";
	        }
        orderUpdates.priceAdjustReason = effectivePriceReason;
        await storage.updateOrder(orderId, orderUpdates);
        changes.push(`Price set to AED ${finalAmt.toFixed(2)}`);
        currentBillAmount = finalAmt;

        if (order.billId && !undoBill) {
          const syncedBill = await syncBillFromLinkedOrders(order.billId, {
            priceAdjustReason: effectivePriceReason,
            discountAppliedBy: hasDiscountChange && disc > 0 ? (pinAccess?.name || "admin (edit)") : undefined,
          });
          if (syncedBill) {
            currentBillAmount = parseMoney(syncedBill.amount);
          }
        }
        if (hasDiscountChange) {
          const discountChange = formatDiscountChange(existingDiscountAmount, disc);
          if (discountChange) changes.push(discountChange);
        }
      } else if (hasDiscountChange) {
        // Discount only, no items or price change
        const currentTotal = getOrderWorkReceivedBase(order);
        const finalAmt =
          Math.max(0, currentTotal - requestedDiscountAmount) + orderExtraCharges;
	        const orderUpdates: any = {
	          finalAmount: finalAmt.toFixed(2),
	          discountAmount: requestedDiscountAmount.toFixed(2),
	          discountPercent: "0.00",
	        };
	        if (hasDeliveryChargeInput) {
	          orderUpdates.deliveryCharge = requestedDeliveryChargeAmount.toFixed(2);
	        }
	        await storage.updateOrder(orderId, orderUpdates);
	        currentBillAmount = finalAmt;
        const discountChange = formatDiscountChange(existingDiscountAmount, requestedDiscountAmount);
        if (discountChange) changes.push(discountChange);

        if (order.billId && !undoBill) {
          const syncedBill = await syncBillFromLinkedOrders(order.billId, {
            discountAppliedBy: requestedDiscountAmount > 0 ? pinAccess?.name || "admin (edit)" : undefined,
          });
          if (syncedBill) {
            currentBillAmount = parseMoney(syncedBill.amount);
	          }
	        }
	      } else if (hasDeliveryChargeChange) {
	        const currentTotal = getOrderWorkReceivedBase(order);
	        const currentDiscount = await getOrderDiscountAmountForBase(order, currentTotal);
	        const finalAmt =
	          Math.max(0, currentTotal - currentDiscount) +
	          getOrderTipsAmount(order) +
	          requestedDeliveryChargeAmount;
	        await storage.updateOrder(orderId, {
	          deliveryCharge: requestedDeliveryChargeAmount.toFixed(2),
	          finalAmount: finalAmt.toFixed(2),
	        } as any);
	        currentBillAmount = finalAmt;

	        if (order.billId && !undoBill) {
	          const syncedBill = await syncBillFromLinkedOrders(order.billId);
	          if (syncedBill) {
	            currentBillAmount = parseMoney(syncedBill.amount);
	          }
	        }
	      }

	      if (hasDeliveryChargeChange) {
	        changes.push(`Delivery charge set to AED ${requestedDeliveryChargeAmount.toFixed(2)}`);
	      }

      // 2. Update paid amount on bill if provided
      if (newPaidAmount !== undefined && newPaidAmount !== null && !isNaN(newPaidAmount) && order.billId && !undoBill) {
        const bill = await storage.getBill(order.billId);
        if (bill) {
          const billAmount = currentBillAmount !== null ? currentBillAmount : parseFloat(bill.amount);
          const cappedPaid = Math.min(newPaidAmount, billAmount);
          const billUpdates: any = {
            paidAmount: cappedPaid.toFixed(2),
            isPaid: cappedPaid >= billAmount,
          };
          if (cappedPaid >= billAmount && !bill.paymentMethod) {
            billUpdates.paymentMethod = "cash";
          }
          if (cappedPaid < billAmount) {
            billUpdates.isPaid = false;
          }
          if (cappedPaid <= 0.009) {
            billUpdates.paymentMethod = null;
          }
          await storage.updateBill(order.billId, billUpdates);
          await syncLinkedOrdersPaidState(
            order.billId,
            cappedPaid,
            cappedPaid > 0.009 ? billUpdates.paymentMethod ?? bill.paymentMethod ?? "cash" : null,
          );
          changes.push(`Paid amount set to AED ${cappedPaid.toFixed(2)}`);
        }
      } else if (order.billId && !undoBill && currentBillAmount !== null) {
        await reconcileBillPaymentState(order.billId);
      }

      let updatedClientTransactions = false;

      // 3. Update client transactions linked to this bill
      if (order.billId && order.clientId && !undoBill && changes.length > 0) {
        try {
          const updatedBill = await storage.getBill(order.billId);
          if (updatedBill) {
            const txns = await db.select().from(clientTransactions).where(
              and(eq(clientTransactions.clientId, order.clientId), eq(clientTransactions.billId, order.billId))
            );
            const billRef = updatedBill.referenceNumber || order.billId;
            const billDesc = updatedBill.description || "N/A";
            const discAmt = parseFloat(updatedBill.discountAmount || "0");
            const discountNote = discAmt > 0 ? ` [Discount: -${discAmt.toFixed(2)} AED]` : "";
            for (const tx of txns) {
              const txType = tx.type;
              if (txType === "payment" || txType === "bulk_payment" || txType === "company_payment") {
                const newDesc = `Payment for Bill #${billRef}: ${billDesc}${discountNote}`;
                await db.update(clientTransactions).set({
                  amount: updatedBill.amount,
                  description: newDesc,
                  discount: discAmt > 0 ? discAmt.toFixed(2) : "0",
                } as any).where(eq(clientTransactions.id, tx.id));
                updatedClientTransactions = true;
              } else if (txType === "bill") {
                await db.update(clientTransactions).set({
                  amount: updatedBill.amount,
                  description: `Bill #${billRef}: ${billDesc}${discountNote}`,
                  discount: discAmt > 0 ? discAmt.toFixed(2) : "0",
                } as any).where(eq(clientTransactions.id, tx.id));
                updatedClientTransactions = true;
              }
            }

            // Update bill payments amount if bill amount changed
            const existingPayments = await db.select().from(billPayments).where(eq(billPayments.billId, order.billId));
            if (existingPayments.length > 0) {
              const totalExistingPayments = existingPayments.reduce((s, p) => s + parseFloat(p.amount || "0"), 0);
              const updatedPaidAmount = parseMoney(updatedBill.paidAmount);
              if (Math.abs(totalExistingPayments - updatedPaidAmount) > 0.005 && existingPayments.length === 1) {
                await db.update(billPayments).set({
                  amount: normalizeMoney(updatedPaidAmount),
                } as any).where(eq(billPayments.id, existingPayments[0].id));
              }
            }
          }
        } catch (txErr) {
          console.error("Edit order: failed to update client transactions", txErr);
        }
      }

      // 4. Undo bill if toggled
      if (undoBill && order.billId) {
        await storage.updateOrder(orderId, { billId: null } as any);
        changes.push("Bill unlinked");
      }

      if (changes.length === 0) {
        return res.json({ message: "No changes made" });
      }

      const refreshedOrder = await storage.getOrder(orderId);
      const refreshedBill =
        refreshedOrder?.billId && !undoBill
          ? await storage.getBill(refreshedOrder.billId)
          : null;

      if (updatedClientTransactions) {
        storage.notifyLiveResourceUpdated("clientTransactions");
      }

      res.json({
        message: `Order updated: ${changes.join(", ")}`,
        order: refreshedOrder ?? null,
        bill: refreshedBill,
      });
    } catch (error: any) {
      console.error("Edit order error:", error);
      res.status(500).json({ message: error.message || "Failed to edit order" });
    }
  });

  // Update order items and recalculate bill
  app.post("/api/orders/:id/update-items", async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const { items, staffPin, staffName } = req.body;
      if (!items || !staffPin) {
        return res.status(400).json({ message: "Items and staff PIN are required" });
      }

      // Verify PIN - accept admin PIN, user PINs, or packing worker PINs
      const ADMIN_PIN = "00000";
      let verifiedUser: string | null = null;

      if (staffPin === ADMIN_PIN) {
        verifiedUser = "Admin";
      } else {
        // Check user PINs
        const users = await storage.getUsers();
        const user = users.find((u: any) => u.pin === staffPin);
        if (user) {
          verifiedUser = user.name || user.username;
        } else {
          // Check packing worker PINs
          const packingWorkers = await storage.getPackingWorkers();
          const worker = packingWorkers.find((w: any) => w.pin === staffPin);
          if (worker) {
            verifiedUser = worker.name;
          } else {
            // Check staff members
            const allStaffMembers = await storage.getStaffMembers();
            const staffMember = allStaffMembers.find((s: any) => s.pin === staffPin);
            if (staffMember) {
              verifiedUser = staffMember.name;
            }
          }
        }
      }

      if (!verifiedUser) {
        return res.status(401).json({ message: "Invalid staff PIN" });
      }

      // Get current order
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Calculate new total from items
      const allProducts = await storage.getProducts();
      let newTotal = 0;
      const itemsArray: string[] = [];

      for (const item of items) {
        // Parse item name to extract base product name and service type
        // Format can be: "ProductName [N] (folding)", "ProductName [D] (hanger)", or "ProductName (Size) @ price AED"
        let itemName = item.name;
        let customPrice: number | null = null;
        const providedUnitPrice = Number.isFinite(Number(item.unitPrice))
          ? Number(item.unitPrice)
          : null;

        // Check for custom price format: "ProductName (Size) @ price AED"
        const customPriceMatch = itemName.match(/(.+?)\s*@\s*([\d.]+)\s*AED/i);
        if (customPriceMatch) {
          const baseName = customPriceMatch[1].trim();
          customPrice = parseFloat(customPriceMatch[2]);
          newTotal += customPrice * item.quantity;
          itemsArray.push(`${item.quantity}x ${baseName} @ ${customPrice.toFixed(2)} AED`);
          continue;
        }

        const finalPrice = providedUnitPrice ?? getCatalogItemUnitPrice(
          itemName,
          allProducts,
          order.deliveryType || null,
          order.urgent === true,
        );
        newTotal += finalPrice * item.quantity;
        itemsArray.push(`${item.quantity}x ${item.name} @ ${finalPrice.toFixed(2)} AED`);
      }

      const newItemsText = itemsArray.join(", ");

      const subtotal = newTotal;

      // Preserve existing fixed discounts; percentage discounts recalculate from the new subtotal.
      const discountPercent = parseFloat(order.discountPercent || "0");
      const existingDiscountAmount = await getOrderDiscountAmountForBase(order, subtotal);
      const discountAmount =
        Number.isFinite(discountPercent) && discountPercent > 0
          ? (subtotal * discountPercent) / 100
          : existingDiscountAmount;
      const tips = parseFloat(order.tips || "0");
      const deliveryCharge = getOrderDeliveryCharge(order);
      const finalAmount =
        Math.max(0, subtotal - Math.max(0, discountAmount)) + tips + deliveryCharge;

      // Calculate the difference in order amount
      const oldFinalAmount = parseFloat(order.finalAmount || order.totalAmount || "0");
      const amountDifference = finalAmount - oldFinalAmount;

      // Build detailed change note
      const oldItems = (order.items || "").split(", ").map((s: string) => s.trim()).filter(Boolean);
      const changes: string[] = [];

      // Detect packaging changes (folding/hanger)
      const stripPkg = (name: string) => name.replace(/\s*\(folding\)\s*/gi, '').replace(/\s*\(hanger\)\s*/gi, '').replace(/\s*\(hanging\)\s*/gi, '').replace(/^\d+x\s+/, '').trim();
      const getPkg = (name: string) => /\(hanger\)/i.test(name) ? 'hanger' : 'folding';

      const oldPkgMap: Record<string, string> = {};
      oldItems.forEach((item: string) => {
        oldPkgMap[stripPkg(item)] = getPkg(item);
      });

      itemsArray.forEach((item: string) => {
        const base = stripPkg(item);
        const newPkg = getPkg(item);
        const oldPkg = oldPkgMap[base];
        if (oldPkg && oldPkg !== newPkg) {
          changes.push(`${base}: ${oldPkg} → ${newPkg}`);
        }
      });

      // Detect quantity changes
      const oldQtyMap: Record<string, number> = {};
      oldItems.forEach((item: string) => {
        const qtyMatch = item.match(/^(\d+)x\s+(.+)$/);
        if (qtyMatch) {
          oldQtyMap[stripPkg(qtyMatch[2])] = parseInt(qtyMatch[1]);
        }
      });

      itemsArray.forEach((item: string) => {
        const qtyMatch = item.match(/^(\d+)x\s+(.+)$/);
        if (qtyMatch) {
          const base = stripPkg(qtyMatch[2]);
          const newQty = parseInt(qtyMatch[1]);
          const oldQty = oldQtyMap[base];
          if (oldQty !== undefined && oldQty !== newQty) {
            changes.push(`${base}: qty ${oldQty} → ${newQty}`);
          } else if (oldQty === undefined) {
            changes.push(`${base}: added (qty ${newQty})`);
          }
        }
      });

      // Detect removed items
      Object.keys(oldQtyMap).forEach(base => {
        const stillExists = itemsArray.some((item: string) => stripPkg(item.replace(/^\d+x\s+/, '')) === base);
        if (!stillExists) {
          changes.push(`${base}: removed`);
        }
      });

      let noteText = `[${new Date().toLocaleString()}] Items updated by ${verifiedUser}.`;
      if (changes.length > 0) {
        noteText += ` Changes: ${changes.join('; ')}.`;
      }
      if (Math.abs(amountDifference) > 0.01) {
        noteText += ` Amount changed from AED ${oldFinalAmount.toFixed(2)} to AED ${finalAmount.toFixed(2)}`;
      }

      // Update order (clear adjusted total since items changed)
      const updatedOrder = await storage.updateOrder(orderId, {
        items: newItemsText,
        totalAmount: newTotal.toFixed(2),
        finalAmount: finalAmount.toFixed(2),
        discountAmount: Math.max(0, discountAmount).toFixed(2),
        adjustedTotal: null,
        priceAdjustReason: null,
        notes: `${order.notes || ""}\n${noteText}`,
      });

      let billUpdated = false;
      let newDueAmount = 0;

      // Update associated bill if exists
      if (order.billId) {
        const bill = await storage.getBill(order.billId);
        if (bill) {
          // Recalculate bill total from all orders in this bill
          const billOrders = await storage.getOrders();
          const ordersInBill = billOrders.filter((o: any) => o.billId === order.billId);

          let billTotal = 0;
          let billOriginalTotal = 0;
          let billDiscountTotal = 0;
          let billDeliveryChargeTotal = 0;
          for (const billOrder of ordersInBill) {
            if (billOrder.id === orderId) {
              billTotal += finalAmount;
              billOriginalTotal += subtotal;
              billDiscountTotal += Math.max(0, discountAmount);
              billDeliveryChargeTotal += deliveryCharge;
            } else {
              billTotal += getOrderFinalAmount(billOrder);
              billOriginalTotal += getOrderWorkReceivedBase(billOrder);
              billDiscountTotal += Math.max(0, parseMoney(billOrder.discountAmount));
              billDeliveryChargeTotal += getOrderDeliveryCharge(billOrder);
            }
          }

          // Check if bill was paid - if so, any added amount goes to due
          const previousBillAmount = parseFloat(bill.amount || "0");
          const previousPaidAmount = parseFloat(bill.paidAmount || "0");
          const previousDue = previousBillAmount - previousPaidAmount;
          const wasPreviouslyPaid = bill.isPaid || previousPaidAmount >= previousBillAmount;

          // Calculate new due: new bill total - what was already paid
          newDueAmount = billTotal - previousPaidAmount;
          const isNowPaid = newDueAmount <= 0;

          // Update the bill with new amount
          // Keep paidAmount as is - it shows what was already paid
          // The due amount is calculated as: amount - paidAmount

          // Build history note if items were added to a paid bill
          let updatedNotes = bill.notes || "";
          if (wasPreviouslyPaid && !isNowPaid && amountDifference > 0) {
            const historyEntry = `\n[${new Date().toLocaleString()}] ITEM RECOUNT: Original bill ${previousBillAmount.toFixed(2)} AED (PAID). Added items worth ${amountDifference.toFixed(2)} AED. New total: ${billTotal.toFixed(2)} AED. Amount due: ${newDueAmount.toFixed(2)} AED`;
            updatedNotes += historyEntry;
            console.log(`Bill #${order.billId} was fully paid (${previousPaidAmount} AED) but now has additional due of ${newDueAmount.toFixed(2)} AED after item recount`);
          } else if (amountDifference !== 0) {
            const historyEntry = `\n[${new Date().toLocaleString()}] Items updated: Amount changed from ${previousBillAmount.toFixed(2)} to ${billTotal.toFixed(2)} AED`;
            updatedNotes += historyEntry;
          }

          await storage.updateBill(order.billId, {
            amount: billTotal.toFixed(2),
            originalAmount: billOriginalTotal.toFixed(2),
            discountAmount: billDiscountTotal.toFixed(2),
            deliveryCharge: billDeliveryChargeTotal.toFixed(2),
            isPaid: isNowPaid,
            description: await buildBillDescriptionWithPrices(order.orderNumber, newItemsText, order.deliveryType || null),
            notes: updatedNotes.trim(),
          });
          billUpdated = true;
        }
      }

      res.json({
        order: updatedOrder,
        message: billUpdated && amountDifference > 0
          ? `Items updated. AED ${amountDifference.toFixed(2)} added to due amount.`
          : billUpdated && amountDifference < 0
          ? `Items updated. AED ${Math.abs(amountDifference).toFixed(2)} reduced from bill.`
          : "Items updated successfully",
        updatedBy: verifiedUser,
        amountDifference: amountDifference.toFixed(2),
        newDueAmount: newDueAmount.toFixed(2),
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/orders/:id", async (req, res) => {
    const orderId = Number(req.params.id);
    const { adminPin, adminPassword } = extractAdminCredentials(req);
    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAuthorized = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAuthorized) {
      return res.status(401).json({ message: "Invalid admin PIN" });
    }
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    await deleteOrderWithLinkedRecords(orderId, "DELETE ORDER");
    res.status(204).send();
  });

  app.post("/api/orders/:id/delete", async (req, res) => {
    const orderId = Number(req.params.id);
    const { adminPin, adminPassword } = extractAdminCredentials(req);
    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAuthorized = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAuthorized) {
      return res.status(401).json({ message: "Invalid admin PIN" });
    }
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    await deleteOrderWithLinkedRecords(orderId, "DELETE ORDER");
    res.status(204).send();
  });

  app.post("/api/orders/bulk-delete", async (req, res) => {
    const { adminPin, adminPassword } = extractAdminCredentials(req);
    const { orderIds } = req.body || {};
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAuthorized = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAuthorized) {
      return res.status(401).json({ message: "Invalid admin PIN" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    let deleted = 0;
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const result = await deleteOrderWithLinkedRecords(orderId, "BULK DELETE");
      if (result.deleted) {
        deleted += 1;
      }
    }
    res.json({ message: `${deleted} order(s) deleted successfully`, deleted });
  });

  app.post("/api/admin/orders/delete-by-period", async (req, res) => {
    try {
      const { adminPin, adminPassword } = extractAdminCredentials(req);
      const { period, startDate, endDate } = req.body || {};

      if (!adminPin && !adminPassword) {
        return res.status(400).json({ message: "Admin PIN required" });
      }

      const isAuthorized = adminPin
        ? await verifyAdminPin(String(adminPin || ""))
        : await verifyAdminPassword(String(adminPassword || ""));

      if (!isAuthorized) {
        return res.status(401).json({ message: "Invalid admin PIN" });
      }

      const range = resolvePeriodicOrderDeletionRange(
        String(period || ""),
        typeof startDate === "string" ? startDate : undefined,
        typeof endDate === "string" ? endDate : undefined,
      );

      const matchedOrders = (await storage.getOrders())
        .filter((order) => {
          if (!order.entryDate) {
            return false;
          }

          const entryDate = new Date(order.entryDate);
          return !Number.isNaN(entryDate.getTime()) && entryDate >= range.start && entryDate <= range.end;
        })
        .sort((left, right) => {
          const leftTime = left.entryDate ? new Date(left.entryDate).getTime() : 0;
          const rightTime = right.entryDate ? new Date(right.entryDate).getTime() : 0;
          return leftTime - rightTime;
        });

      if (matchedOrders.length === 0) {
        return res.json({
          success: true,
          deleted: 0,
          period: String(period || "").trim().toLowerCase(),
          startDate: range.start.toISOString(),
          endDate: range.end.toISOString(),
          message: `No orders found for ${range.label} (${formatDeletionRangeDate(range.start)} to ${formatDeletionRangeDate(range.end)}).`,
        });
      }

      let deleted = 0;
      const deletedOrderNumbers: string[] = [];

      for (const order of matchedOrders) {
        const result = await deleteOrderWithLinkedRecords(order.id, "PERIOD DELETE");
        if (result.deleted) {
          deleted += 1;
          if (result.orderNumber) {
            deletedOrderNumbers.push(result.orderNumber);
          }
        }
      }

      res.json({
        success: true,
        deleted,
        period: String(period || "").trim().toLowerCase(),
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
        deletedOrderNumbers,
        message: `${deleted} order(s) deleted for ${range.label} (${formatDeletionRangeDate(range.start)} to ${formatDeletionRangeDate(range.end)}).`,
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to delete orders for the selected period" });
    }
  });

  app.post("/api/orders/bulk-stage/verify-pin", async (req, res) => {
    const { pin } = req.body || {};
    const member = await resolveBulkOrderStageActorByPin(String(pin || ""));
    if (!member) {
      return res.status(401).json({ success: false, message: "Invalid staff PIN" });
    }

    res.json({ success: true, member });
  });

  app.post("/api/orders/bulk-tag", async (req, res) => {
    const { orderIds, staffPin } = req.body || {};
    if (!staffPin) {
      return res.status(400).json({ message: "Staff PIN required" });
    }
    const member = await resolveBulkOrderStageActorByPin(String(staffPin));
    if (!member) {
      return res.status(401).json({ message: "Invalid staff PIN" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    const tagByLabel = member.name;
    let tagged = 0;
    const taggedOrderIds: number[] = [];
    // Use the same timestamp for all orders in this bulk action
    const now = new Date().toISOString();
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const order = await storage.getOrder(orderId);
      if (!order || order.tagDone) continue;
      await storage.updateOrder(orderId, {
        tagDone: true,
        tagDate: now,
        tagBy: tagByLabel,
        tagWorkerId: member.id,
      });
      tagged++;
      taggedOrderIds.push(orderId);
    }
    res.json({
      message: `${tagged} order(s) tagged by ${member.name}`,
      tagged,
      taggedOrderIds,
      tagBy: tagByLabel,
      tagDate: now,
      tagWorkerId: member.id,
    });
  });

  app.post("/api/orders/bulk-untag", async (req, res) => {
    const { orderIds, adminPassword, adminPin } = req.body || {};
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAdminValid = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAdminValid) {
      return res
        .status(401)
        .json({ message: adminPin ? "Invalid admin PIN" : "Invalid admin password" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    let untagged = 0;
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const order = await storage.getOrder(orderId);
      if (!order || !order.tagDone || order.packingDone) continue;
      await storage.updateOrder(orderId, {
        tagDone: false,
        tagDate: null,
        tagBy: null,
      });
      untagged++;
    }
    res.json({ message: `${untagged} order(s) untagged successfully`, untagged });
  });

  app.post("/api/orders/bulk-pack", async (req, res) => {
    const { orderIds, staffPin } = req.body || {};
    if (!staffPin) {
      return res.status(400).json({ message: "Staff PIN required" });
    }
    const member = await resolveBulkOrderStageActorByPin(String(staffPin));
    if (!member) {
      return res.status(401).json({ message: "Invalid staff PIN" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    const packByLabel = member.name;
    let packed = 0;
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const order = await storage.getOrder(orderId);
      if (!order || !order.tagDone || order.packingDone) continue;
      await storage.updateOrder(orderId, {
        packingDone: true,
        packingDate: new Date().toISOString(),
        packingBy: packByLabel,
        packingWorkerId: member.id,
      });
      packed++;
    }
    res.json({ message: `${packed} order(s) packed by ${member.name}`, packed });
  });

  app.post("/api/orders/bulk-unpack", async (req, res) => {
    const { orderIds, adminPassword, adminPin } = req.body || {};
    if (!adminPin && !adminPassword) {
      return res.status(400).json({ message: "Admin PIN required" });
    }
    const isAdminValid = adminPin
      ? await verifyAdminPin(String(adminPin || ""))
      : await verifyAdminPassword(String(adminPassword || ""));
    if (!isAdminValid) {
      return res
        .status(401)
        .json({ message: adminPin ? "Invalid admin PIN" : "Invalid admin password" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    let unpacked = 0;
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const order = await storage.getOrder(orderId);
      if (!order || !order.packingDone || order.delivered) continue;
      await storage.updateOrder(orderId, {
        packingDone: false,
        packingDate: null,
        packingBy: null,
      });
      unpacked++;
    }
    res.json({ message: `${unpacked} order(s) unpacked successfully`, unpacked });
  });

  // Bulk deliver orders
  app.post("/api/orders/bulk-deliver", async (req, res) => {
    const { orderIds, staffPin } = req.body || {};
    if (!staffPin) {
      return res.status(400).json({ message: "Staff PIN required" });
    }
    const member = await resolveBulkOrderStageActorByPin(String(staffPin));
    if (!member) {
      return res.status(401).json({ message: "Invalid staff PIN" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    const deliverByLabel = member.name;
    let delivered = 0;
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const order = await storage.getOrder(orderId);
      if (
        !order ||
        !order.packingDone ||
        order.delivered ||
        order.deliveryType !== "delivery"
      )
        continue;
      await storage.updateOrder(orderId, {
        delivered: true,
        deliveryDate: new Date().toISOString(),
        deliveryBy: deliverByLabel,
        deliveredByWorkerId: member.id,
      });
      delivered++;
    }
    res.json({ message: `${delivered} order(s) delivered by ${member.name}`, delivered });
  });

  // Bulk takeaway (pickup) orders
  app.post("/api/orders/bulk-takeaway", async (req, res) => {
    const { orderIds, staffPin } = req.body || {};
    if (!staffPin) {
      return res.status(400).json({ message: "Staff PIN required" });
    }
    const member = await resolveBulkOrderStageActorByPin(String(staffPin));
    if (!member) {
      return res.status(401).json({ message: "Invalid staff PIN" });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "No orders selected" });
    }
    const pickupByLabel = member.name;
    let pickedUp = 0;
    for (const id of orderIds) {
      const orderId = Number(id);
      if (isNaN(orderId)) continue;
      const order = await storage.getOrder(orderId);
      if (
        !order ||
        !order.packingDone ||
        order.delivered ||
        order.deliveryType === "delivery"
      )
        continue;
      await storage.updateOrder(orderId, {
        delivered: true,
        deliveryDate: new Date().toISOString(),
        deliveryBy: pickupByLabel,
        deliveredByWorkerId: member.id,
      });
      pickedUp++;
    }
    res.json({ message: `${pickedUp} order(s) marked as picked up by ${member.name}`, pickedUp });
  });

  app.post("/api/admin/reset-selected", async (req, res) => {
    const { adminPassword, deleteOrders, deleteClients, deleteStaff } = req.body || {};

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    const selections = {
      deleteOrders: Boolean(deleteOrders) || Boolean(deleteClients),
      deleteClients: Boolean(deleteClients),
      deleteStaff: Boolean(deleteStaff),
    };

    if (!selections.deleteOrders && !selections.deleteClients && !selections.deleteStaff) {
      return res.status(400).json({ message: "Select at least one type of data to delete" });
    }

    try {
      let deletedOrders = 0;
      let deletedClients = 0;
      let deletedPackingWorkers = 0;
      let deletedStaffMembers = 0;

      if (selections.deleteOrders) {
        deletedOrders = await deleteAllOrdersWithLinkedRecords("RESET SELECTED");
      }

      if (selections.deleteClients) {
        deletedClients = (await storage.getClients()).length;
        await storage.deleteAllBills();
        await storage.deleteAllClients();
      }

      if (selections.deleteStaff) {
        const existingPackingWorkers = await storage.getPackingWorkers();
        const existingStaffMembers = await storage.getStaffMembers();

        deletedPackingWorkers = existingPackingWorkers.length;
        deletedStaffMembers = existingStaffMembers.length;

        await db.delete(packingWorkers);
        await db.delete(staffMembers);
      }

      const summaryParts: string[] = [];
      if (selections.deleteOrders) {
        summaryParts.push(`${deletedOrders} order(s) and linked billing records`);
      }
      if (selections.deleteClients) {
        summaryParts.push(`${deletedClients} client(s)`);
      }
      if (selections.deleteStaff) {
        summaryParts.push(
          `${deletedPackingWorkers} packing worker(s) and ${deletedStaffMembers} staff member record(s); login accounts were preserved`,
        );
      }

      res.json({
        success: true,
        selections,
        deleted: {
          orders: deletedOrders,
          clients: deletedClients,
          users: 0,
          packingWorkers: deletedPackingWorkers,
          staffMembers: deletedStaffMembers,
        },
        message:
          summaryParts.length > 0
            ? `Deleted ${summaryParts.join("; ")} successfully.`
            : "Selected data deleted successfully.",
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to delete selected data: " + err.message });
    }
  });

  // Reset all orders (admin password protected)
  app.post("/api/orders/reset-all", async (req, res) => {
    const { adminPassword } = req.body;

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    try {
      await storage.deleteAllOrders();
      res.json({ success: true, message: "All orders have been reset" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to reset orders: " + err.message });
    }
  });

  // Reset all transactions (admin password protected)
  app.post("/api/transactions/reset-all", async (req, res) => {
    const { adminPassword } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

    if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    try {
      await storage.deleteAllTransactions();
      res.json({ success: true, message: "All transactions have been reset" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to reset transactions: " + err.message });
    }
  });

  // Reset all bills (admin password protected)
  app.post("/api/bills/reset-all", async (req, res) => {
    const { adminPassword } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

    if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    try {
      await storage.deleteAllBills();
      res.json({ success: true, message: "All bills have been reset" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to reset bills: " + err.message });
    }
  });

  // Reset all clients (admin password protected)
  app.post("/api/clients/reset-all", async (req, res) => {
    const { adminPassword } = req.body;

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    try {
      await storage.deleteAllClients();
      res.json({ success: true, message: "All clients have been reset" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to reset clients: " + err.message });
    }
  });

  // Reset all incidents (admin password protected)
  app.post("/api/incidents/reset-all", async (req, res) => {
    const { adminPassword } = req.body;

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    try {
      await storage.deleteAllIncidents();
      res.json({ success: true, message: "All incidents have been reset" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to reset incidents: " + err.message });
    }
  });

  // Reset operational data while preserving every login account.
  app.post("/api/admin/reset-all", async (req, res) => {
    const { adminPassword } = req.body;

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    try {
      // Reset in proper order to handle foreign key constraints
      await storage.deleteAllOrders(); // This also resets product stock to 0
      await storage.deleteAllBills(); // This also clears transactions
      await storage.deleteAllClients(); // This clears clients and remaining transactions
      await storage.deleteAllIncidents(); // This clears all incidents

      res.json({
        success: true,
        message: "Operational data was reset. Login and staff accounts were preserved.",
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to reset all data: " + err.message });
    }
  });

  // Verify admin password
  app.post("/api/admin/verify", async (req, res) => {
    const { adminPassword } = req.body;

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ success: false, message: "Invalid admin password" });
    }

    res.json({ success: true, message: "Admin verified" });
  });

  app.post("/api/admin/export-database", async (req, res) => {
    const { adminPassword } = req.body || {};

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(403).json({ message: "Admin password is required for database export" });
    }

    try {
      await ensureAppSecuritySettingsTable();
      const databaseExport = await buildDatabaseExport();
      const fileName = getDatabaseExportFileName(new Date(databaseExport.metadata.exportedAt));

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(JSON.stringify(databaseExport, null, 2));
    } catch (err: any) {
      console.error("Database export failed:", err);
      res.status(500).json({ message: "Failed to export database: " + err.message });
    }
  });

  app.post("/api/admin/import-database", async (req, res) => {
    const { adminPassword, databaseExport } = req.body || {};

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(403).json({ message: "Admin password is required for database import" });
    }

    try {
      await ensureAppSecuritySettingsTable();
      const importPayload =
        typeof databaseExport === "string" ? JSON.parse(databaseExport) : databaseExport;
      const result = await importDatabaseExport(importPayload);

      cachedOrderSequence = null;
      storage.notifyLiveResourceUpdated("bills");
      storage.notifyLiveResourceUpdated("clientTransactions");
      storage.notifyLiveResourceUpdated("productCategorySettings");

      res.json({
        success: true,
        ...result,
        message: `Imported ${result.totalRows} row(s) from the database backup.`,
      });
    } catch (err: any) {
      console.error("Database import failed:", err);
      const message =
        err instanceof SyntaxError
          ? "The selected file is not valid JSON"
          : err?.message || "Failed to import database";
      res.status(400).json({ message: "Failed to import database: " + message });
    }
  });

  app.get("/api/company-contact", async (_req, res) => {
    try {
      const settings = await storage.getCompanyContactSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to load company contact settings" });
    }
  });

  app.put("/api/company-contact", async (req, res) => {
    const {
      adminPassword,
      companyName,
      tagline,
      telephone,
      mobilePhone,
      whatsappPhone,
      email,
      website,
      addressLine1,
      addressLine2,
      addressLine3,
    } = req.body || {};

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    const normalize = (value: unknown) => {
      const trimmed = String(value ?? "").trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    try {
      const settings = await storage.updateCompanyContactSettings({
        companyName: normalize(companyName) || "Liquid Washes Laundry",
        tagline: normalize(tagline),
        telephone: normalize(telephone),
        mobilePhone: normalize(mobilePhone),
        whatsappPhone: normalize(whatsappPhone) || normalize(mobilePhone),
        email: normalize(email),
        website: normalize(website),
        addressLine1: normalize(addressLine1) || "Central Market D/109",
        addressLine2: normalize(addressLine2),
        addressLine3: normalize(addressLine3),
      });

      res.json({
        success: true,
        message: "Company contact settings updated successfully",
        settings,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update company contact settings" });
    }
  });

  app.put("/api/admin/display-settings", async (req, res) => {
    const { dashboardClockHour12 } = req.body || {};

    if (typeof dashboardClockHour12 !== "boolean") {
      return res.status(400).json({ message: "Choose a valid dashboard clock format" });
    }

    try {
      const settings = await storage.updateCompanyContactSettings({
        dashboardClockHour12,
      });

      res.json({
        success: true,
        message: "Display settings updated successfully",
        settings,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update display settings" });
    }
  });

  // Get admin account settings
  app.get("/api/admin/account", async (req, res) => {
    const auth = getRequestAuth(req);
    if (!auth) {
      return res.status(401).json({ message: "Sign in to view this account" });
    }

    const [account] = await db
      .select({
        username: users.username,
        name: users.name,
        email: users.email,
        pin: users.pin,
      })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.json({
      username: account.username,
      name: account.name || account.username,
      email: account.email || "",
      hasPin: Boolean(account.pin),
    });
  });

  // Tenant account changes are controlled by the platform owner.
  app.put("/api/admin/account", async (_req, res) => {
    return res.status(403).json({
      success: false,
      message: "Business account settings are managed by the super administrator",
    });
  });

  // Tenant password self-service is disabled; the platform owner manages it.
  app.post("/api/admin/send-password-otp", async (_req, res) => {
    return res.status(403).json({
      success: false,
      message: "Business passwords are managed by the super administrator",
    });
  });

  // Tenant password self-service is disabled; the platform owner manages it.
  app.post("/api/admin/change-password-with-otp", async (_req, res) => {
    return res.status(403).json({
      success: false,
      message: "Business passwords are managed by the super administrator",
    });
  });

  // Get admin email dynamically from database for reports
  async function getAdminReportEmail(): Promise<string> {
    try {
      const adminUser = await storage.getUserByUsername("admin");
      return adminUser?.email || process.env.ADMIN_REPORT_EMAIL || "idusma0010@gmail.com";
    } catch {
      return process.env.ADMIN_REPORT_EMAIL || "idusma0010@gmail.com";
    }
  }

  // Generate daily sales data
  async function generateDailySalesData(date: Date): Promise<DailySalesData> {
    const orders = await storage.getOrders();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const todaysOrders = orders.filter(order => {
      const orderDate = new Date(order.entryDate);
      return orderDate >= startOfDay && orderDate <= endOfDay;
    });

    const totalOrders = todaysOrders.length;
    const totalRevenue = todaysOrders.reduce((sum, o) => sum + parseFloat(o.finalAmount || "0"), 0);
    const paidAmount = todaysOrders.reduce((sum, o) => sum + parseFloat(o.paidAmount || "0"), 0);
    const pendingAmount = totalRevenue - paidAmount;
    const normalOrders = todaysOrders.filter(o => !o.urgent).length;
    const urgentOrders = todaysOrders.filter(o => o.urgent).length;
    const pickupOrders = todaysOrders.filter(o => o.deliveryType === "pickup").length;
    const deliveryOrders = todaysOrders.filter(o => o.deliveryType === "delivery").length;

    const itemCounts: Record<string, number> = {};
    todaysOrders.forEach(order => {
      const itemsMatch = (order.items || '').match(/(\d+)x\s+([^,()]+)/g);
      if (itemsMatch) {
        itemsMatch.forEach(item => {
          const match = item.match(/(\d+)x\s+(.+)/);
          if (match) {
            const count = parseInt(match[1]);
            const name = match[2].trim();
            itemCounts[name] = (itemCounts[name] || 0) + count;
          }
        });
      }
    });

    const topItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const orderDetails = todaysOrders.map(order => ({
      orderNumber: order.orderNumber,
      customerName: order.customerName || 'Walk-in',
      amount: order.adjustedTotal ?? order.finalAmount ?? order.totalAmount,
      entryBy: removeBulkIndicator(order.entryBy),
      tagBy: removeBulkIndicator(order.tagBy),
      packingBy: removeBulkIndicator(order.packingBy),
      deliveryBy: removeBulkIndicator(order.deliveryBy),
      status: order.delivered ? 'Delivered' : order.packingDone ? 'Packed' : order.tagDone ? 'Tagged' : 'Entry'
    }));

    return {
      date: date.toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      totalOrders,
      totalRevenue,
      paidAmount,
      pendingAmount,
      normalOrders,
      urgentOrders,
      pickupOrders,
      deliveryOrders,
      topItems,
      orderDetails
    };
  }

  // Send daily sales report (admin protected)
  app.post("/api/admin/send-daily-report", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const { adminPassword, date } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

    if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: "Invalid admin password" });
    }

    try {
      const reportDate = date ? new Date(date) : new Date();
      const salesData = await generateDailySalesData(reportDate);
      const adminEmail = await getAdminReportEmail();
      await sendDailySalesReportEmailSMTP(adminEmail, salesData);

      res.json({
        success: true,
        message: `Daily sales report sent to ${adminEmail}`,
        data: salesData
      });
    } catch (err: any) {
      console.error("Failed to send daily report:", err);
      res.status(500).json({
        success: false,
        message: "Failed to send daily report: " + err.message
      });
    }
  });

  // Get admin report email setting (dynamic from database)
  app.get("/api/admin/report-email", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const email = await getAdminReportEmail();
    res.json({ email });
  });

  app.get("/api/admin/report-schedule", async (_req, res) => {
    if (!requireSuperAdmin(_req, res)) return;
    try {
      const settings = await storage.getSalesReportScheduleSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to load report schedule" });
    }
  });

  app.put("/api/admin/report-schedule", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const { adminPassword, ...scheduleInput } = req.body || {};

    if (!(await verifyAdminPassword(String(adminPassword || "")))) {
      return res.status(401).json({ message: "Invalid admin password" });
    }

    const parsedSchedule = salesReportScheduleInputSchema.safeParse(scheduleInput);
    if (!parsedSchedule.success) {
      return res.status(400).json({ message: "Choose a valid report date and time schedule" });
    }

    try {
      const settings = await storage.updateSalesReportScheduleSettings(parsedSchedule.data);
      res.json({
        success: true,
        message: "Sales report schedule updated successfully",
        settings,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update report schedule" });
    }
  });

  // Generate sales data for a date range
  async function generateSalesReportData(startDate: Date, endDate: Date, period: ReportPeriod): Promise<SalesReportData> {
    const orders = await storage.getOrders();

    const filteredOrders = orders.filter(order => {
      const orderDate = new Date(order.entryDate);
      return orderDate >= startDate && orderDate <= endDate;
    });

    const totalOrders = filteredOrders.length;
    const totalRevenue = filteredOrders.reduce((sum, o) => sum + parseFloat(o.finalAmount || "0"), 0);
    const paidAmount = filteredOrders.reduce((sum, o) => sum + parseFloat(o.paidAmount || "0"), 0);
    const pendingAmount = totalRevenue - paidAmount;
    const normalOrders = filteredOrders.filter(o => !o.urgent).length;
    const urgentOrders = filteredOrders.filter(o => o.urgent).length;
    const pickupOrders = filteredOrders.filter(o => o.deliveryType === "pickup").length;
    const deliveryOrders = filteredOrders.filter(o => o.deliveryType === "delivery").length;

    const itemCounts: Record<string, number> = {};
    filteredOrders.forEach(order => {
      const itemsMatch = (order.items || '').match(/(\d+)x\s+([^,()]+)/g);
      if (itemsMatch) {
        itemsMatch.forEach(item => {
          const match = item.match(/(\d+)x\s+(.+)/);
          if (match) {
            const count = parseInt(match[1]);
            const name = match[2].trim();
            itemCounts[name] = (itemCounts[name] || 0) + count;
          }
        });
      }
    });

    const topItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    let dateRange = '';
    if (period === 'daily') {
      dateRange = formatDate(startDate);
    } else if (period === 'yearly') {
      dateRange = `Year ${startDate.getFullYear()}`;
    } else {
      dateRange = `${formatDate(startDate)} - ${formatDate(endDate)}`;
    }

    return {
      period,
      dateRange,
      totalOrders,
      totalRevenue,
      paidAmount,
      pendingAmount,
      normalOrders,
      urgentOrders,
      pickupOrders,
      deliveryOrders,
      topItems
    };
  }

  // Send periodic sales report (admin protected)
  app.post("/api/admin/send-report", async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const { adminPassword, period } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

    if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: "Invalid admin password" });
    }

    const validPeriods: ReportPeriod[] = ['daily', 'weekly', 'monthly', 'yearly'];
    if (!period || !validPeriods.includes(period)) {
      return res.status(400).json({ success: false, message: "Invalid period. Must be daily, weekly, monthly, or yearly." });
    }

    try {
      const now = new Date();
      let startDate: Date = new Date(now);
      let endDate: Date = new Date(now);
      endDate.setHours(23, 59, 59, 999);

      const reportPeriod = period as ReportPeriod;

      switch (reportPeriod) {
        case 'daily':
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'weekly':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'monthly':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'yearly':
          startDate = new Date(now.getFullYear(), 0, 1);
          startDate.setHours(0, 0, 0, 0);
          break;
      }

      const salesData = await generateSalesReportData(startDate, endDate, reportPeriod);
      const adminEmail = await getAdminReportEmail();
      await sendSalesReportEmailSMTP(adminEmail, salesData);

      const periodLabels: Record<ReportPeriod, string> = {
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        yearly: 'Yearly'
      };

      res.json({
        success: true,
        message: `${periodLabels[reportPeriod]} sales report sent to ${adminEmail}`,
        data: salesData
      });
    } catch (err: any) {
      console.error(`Failed to send ${period} report:`, err);
      res.status(500).json({
        success: false,
        message: `Failed to send ${period} report: ` + err.message
      });
    }
  });

  // Packing Workers routes
  app.get("/api/packing-workers", async (req, res) => {
    const workers = await storage.getPackingWorkers();
    res.json(
      workers.map((w) => ({ id: w.id, name: w.name, active: w.active })),
    );
  });

  app.get("/api/packing-workers/:id", async (req, res) => {
    const workerId = Number(req.params.id);
    if (isNaN(workerId)) {
      return res.status(400).json({ message: "Invalid worker ID" });
    }
    const worker = await storage.getPackingWorker(workerId);
    if (!worker) {
      return res.status(404).json({ message: "Worker not found" });
    }
    res.json({ id: worker.id, name: worker.name, active: worker.active });
  });

  app.post("/api/packing-workers", async (req, res) => {
    const { name, pin } = req.body;
    if (!name || !pin || !/^\d{5}$/.test(pin)) {
      return res
        .status(400)
        .json({ message: "Name and 5-digit PIN are required" });
    }
    try {
      // Check if PIN is already used by another worker (must use bcrypt compare since worker PINs are hashed)
      const allWorkers = await db.select().from(packingWorkers);
      for (const worker of allWorkers) {
        if (worker.pin && await bcrypt.compare(pin, worker.pin)) {
          return res.status(400).json({ message: "This PIN is used by other user" });
        }
      }
      // Check if PIN is already used by a user
      const existingUser = await db.select().from(users).where(eq(users.pin, pin)).limit(1);
      if (existingUser.length > 0) {
        return res.status(400).json({ message: "This PIN is used by other user" });
      }
      const worker = await storage.createPackingWorker({ name, pin });
      res
        .status(201)
        .json({ id: worker.id, name: worker.name, active: worker.active });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/packing-workers/:id", async (req, res) => {
    const { name, pin, active } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (pin !== undefined) {
      if (!/^\d{5}$/.test(pin)) {
        return res.status(400).json({ message: "PIN must be 5 digits" });
      }
      updates.pin = pin;
    }
    if (active !== undefined) updates.active = active;

    try {
      const workerId = Number(req.params.id);
      if (isNaN(workerId)) {
        return res.status(400).json({ message: "Invalid worker ID" });
      }
      // Check if PIN is already used by another worker (excluding current worker)
      if (pin) {
        const allWorkers = await db.select().from(packingWorkers).where(ne(packingWorkers.id, workerId));
        for (const worker of allWorkers) {
          if (worker.pin && await bcrypt.compare(pin, worker.pin)) {
            return res.status(400).json({ message: "This PIN is used by other user" });
          }
        }
        // Check if PIN is already used by a user
        const existingUser = await db.select().from(users).where(eq(users.pin, pin)).limit(1);
        if (existingUser.length > 0) {
          return res.status(400).json({ message: "This PIN is used by other user" });
        }
      }
      const worker = await storage.updatePackingWorker(workerId, updates);
      res.json({ id: worker.id, name: worker.name, active: worker.active });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/packing-workers/:id", async (req, res) => {
    const workerId = Number(req.params.id);
    if (isNaN(workerId)) {
      return res.status(400).json({ message: "Invalid worker ID" });
    }
    await storage.deletePackingWorker(workerId);
    res.status(204).send();
  });

  // Verify staff user PIN (for bill creation, etc.) - Admin PIN works as universal PIN
  // Only allows admin and reception roles - NOT packing staff
  app.post("/api/workers/verify-pin", async (req, res) => {
    const { pin } = req.body;
    if (!pin || !/^\d{5}$/.test(pin)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid PIN format" });
    }

    // Check if it's the admin universal PIN (from database)
    const adminUser = await storage.getUserByUsername("admin");
    const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "";
    if (adminPin && pin === adminPin) {
      return res.json({
        success: true,
        worker: {
          id: adminUser?.id || 0,
          name: adminUser?.name || adminUser?.username || "Admin",
          role: "admin",
        },
      });
    }

    // All PINs are universal - any valid PIN can be used for any process
    const user = await storage.verifyUserPin(pin);
    if (user) {
      return res.json({ success: true, worker: { id: user.id, name: user.name || user.username, role: user.role } });
    }

    // Check staff members - all staff can use their PIN universally
    const staffMember = await storage.verifyStaffMemberPin(pin);
    if (staffMember) {
      return res.json({ success: true, worker: { id: staffMember.id, name: staffMember.name, role: staffMember.roleType } });
    }

    // Check packing workers (legacy)
    const packingWorker = await storage.verifyPackingWorkerPin(pin);
    if (packingWorker) {
      return res.json({ success: true, worker: { id: packingWorker.id, name: packingWorker.name, role: "section" } });
    }

    res.status(401).json({ success: false, message: "Invalid PIN" });
  });

  // Verify packing worker PIN - Admin PIN works as universal PIN
  app.post("/api/packing/verify-pin", async (req, res) => {
    const { pin } = req.body;
    if (!pin || !/^\d{5}$/.test(pin)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid PIN format" });
    }

    // Check if it's the admin universal PIN (from database)
    const adminUser = await storage.getUserByUsername("admin");
    const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "";
    if (adminPin && pin === adminPin) {
      return res.json({
        success: true,
        worker: {
          id: adminUser?.id || null,
          name: adminUser?.name || adminUser?.username || "Admin",
          role: "admin",
          isUser: true,
        },
      });
    }

    // Check for user PIN (admin, reception, staff roles)
    const user = await storage.verifyUserPin(pin);
    if (user) {
      return res.json({ success: true, worker: { id: user.id, name: user.name || user.username, role: user.role || "staff", isUser: true } });
    }

    // Check staff members (counter, section, driver staff)
    const staffMember = await storage.verifyStaffMemberPin(pin);
    if (staffMember) {
      return res.json({ success: true, worker: { id: staffMember.id, name: staffMember.name, role: staffMember.roleType || "staff", isUser: false } });
    }

    // Also check packing workers (legacy)
    const worker = await storage.verifyPackingWorkerPin(pin);
    if (worker) {
      res.json({ success: true, worker: { id: worker.id, name: worker.name, role: worker.role || "section", isUser: false } });
    } else {
      res.status(401).json({ success: false, message: "Invalid PIN" });
    }
  });

  // Verify delivery staff PIN - Admin PIN works as universal PIN
  app.post("/api/delivery/verify-pin", async (req, res) => {
    const { pin } = req.body;
    if (!pin || !/^\d{5}$/.test(pin)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid PIN format" });
    }

    const worker = await resolveDeliveryActorByPin(pin);
    if (!worker) {
      return res.status(401).json({ success: false, message: "Invalid Staff PIN" });
    }

    res.json({
      success: true,
      worker: {
        id: worker.id,
        name: worker.name,
        role: worker.role,
        isUser: worker.isUser,
      },
    });
  });

  // Verify any user PIN for incident recording - checks users, packing workers, staff members, and drivers
  app.post("/api/incidents/verify-pin", async (req, res) => {
    const { pin } = req.body;
    if (!pin || !/^\d{5}$/.test(pin)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid PIN format" });
    }

    // Check if it's the admin universal PIN (from database)
    const adminUser = await storage.getUserByUsername("admin");
    const adminPin = adminUser?.pin || process.env.ADMIN_PIN || "";
    if (adminPin && pin === adminPin) {
      return res.json({
        success: true,
        user: {
          id: adminUser?.id || 0,
          name: adminUser?.name || adminUser?.username || "Admin",
          type: "admin",
        },
      });
    }

    // Check for user PIN (admin, reception, staff roles)
    const user = await storage.verifyUserPin(pin);
    if (user) {
      return res.json({ success: true, user: { id: user.id, name: user.name || user.username, type: "user" } });
    }

    // Check staff members (counter, section, driver staff)
    const staffMember = await storage.verifyStaffMemberPin(pin);
    if (staffMember) {
      return res.json({ success: true, user: { id: staffMember.id, name: staffMember.name, type: "staff" } });
    }

    // Check packing workers (legacy)
    const packingWorker = await storage.verifyPackingWorkerPin(pin);
    if (packingWorker) {
      return res.json({ success: true, user: { id: packingWorker.id, name: packingWorker.name, type: "packing" } });
    }

    // Check delivery drivers (legacy)
    const driver = await storage.verifyDeliveryWorkerPin(pin);
    if (driver) {
      return res.json({ success: true, user: { id: driver.id, name: driver.name, type: "driver" } });
    }

    res.status(401).json({ success: false, message: "Invalid PIN" });
  });

  // Public order view by token (no auth required) - limited safe data only
  app.get("/api/orders/public/:token", async (req, res) => {
    const { token } = req.params;
    if (!token || token.length < 10) {
      return res.status(400).json({ message: "Invalid token" });
    }
    const order = await storage.getOrderByPublicToken(token);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    let clientName = order.customerName || "Customer";
    if (order.clientId) {
      const client = await storage.getClient(order.clientId);
      clientName = client?.name ? client.name.split(" ")[0] : clientName;
    }
    // Return only safe, non-sensitive fields for public view
    res.json({
      orderNumber: order.orderNumber,
      items: order.items,
      finalAmount: order.adjustedTotal ?? order.finalAmount ?? order.totalAmount,
      paidAmount: order.paidAmount,
      deliveryType: order.deliveryType,
      washingDone: order.washingDone,
      packingDone: order.packingDone,
      delivered: order.delivered,
      urgent: order.urgent,
      clientName,
      deliveryPhotos: order.deliveryPhotos || [],
      deliveryPhoto: order.deliveryPhoto,
    });
  });

  // Public order tracking by order number (no auth required) - limited safe data only
  app.get("/api/orders/track/:orderNumber", async (req, res) => {
    let { orderNumber } = req.params;
    if (!orderNumber || orderNumber.length < 1) {
      return res.status(400).json({ message: "Invalid order number" });
    }
    // Normalize: if user enters just numbers, add ORD- prefix
    orderNumber = orderNumber.trim().toUpperCase();
    if (!orderNumber.startsWith("ORD-")) {
      orderNumber = `ORD-${orderNumber}`;
    }
    const order = await storage.getOrderByNumber(orderNumber);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    // Return only safe, non-sensitive fields for public view (no financial data, no personal details)
    // Include current status based on workflow progress
    let currentStatus = "Pending";
    if (order.delivered) {
      currentStatus = order.deliveryType === "Delivery" ? "Delivered" : "Picked Up";
    } else if (order.packingDone) {
      currentStatus = order.deliveryType === "Delivery" ? "Ready for Delivery" : "Ready for Take Away";
    } else if (order.tagDone) {
      currentStatus = "Washing";
    }

    let billNumber: string | null = null;
    const orderPaidAmount = parseFloat(order.paidAmount || "0");
    const orderTotalAmount = parseFloat(order.adjustedTotal ?? order.finalAmount ?? order.totalAmount ?? "0");
    let billIsPaid = orderPaidAmount >= orderTotalAmount && orderTotalAmount > 0;
    let billPaidAmount = order.paidAmount;
    let billTotalAmount = order.adjustedTotal ?? order.finalAmount ?? order.totalAmount;
    let billDiscountAmount: string | null = null;
    let billOriginalAmount: string | null = null;
    if (order.billId) {
      const bill = await storage.getBill(order.billId);
      if (bill) {
        billNumber = bill.referenceNumber || null;
        billIsPaid = bill.isPaid ?? billIsPaid;
        billPaidAmount = bill.paidAmount ?? order.paidAmount;
        billTotalAmount = bill.amount ?? order.finalAmount ?? order.totalAmount;
        billDiscountAmount = bill.discountAmount || null;
        billOriginalAmount = bill.originalAmount || null;
      }
    }

    res.json({
      orderNumber: order.orderNumber,
      items: order.items,
      status: order.status,
      currentStatus: currentStatus,
      entryDate: order.entryDate,
      deliveryType: order.deliveryType,
      tagDone: order.tagDone,
      washingDone: order.washingDone,
      packingDone: order.packingDone,
      packingDate: order.packingDate,
      delivered: order.delivered,
      deliveryBy: removeBulkIndicator(order.deliveryBy),
      deliveryDate: order.deliveryDate,
      urgent: order.urgent,
      expectedDeliveryAt: order.expectedDeliveryAt,
      deliveryPhotos: order.deliveryPhotos || [],
      deliveryPhoto: order.deliveryPhoto,
      notes: order.notes,
      priceAdjustReason: order.priceAdjustReason,
      isPaid: billIsPaid,
      paidAmount: billPaidAmount,
      totalAmount: billTotalAmount,
      billNumber: billNumber,
      discountAmount: billDiscountAmount,
      originalAmount: billOriginalAmount,
    });
  });

  // Reviews API routes
  app.get("/api/reviews", async (req, res) => {
    const allReviews = await storage.getReviews();
    res.json(allReviews);
  });

  app.get("/api/reviews/order/:orderNumber", async (req, res) => {
    let { orderNumber } = req.params;
    orderNumber = orderNumber.trim().toUpperCase();
    if (!orderNumber.startsWith("ORD-")) {
      orderNumber = `ORD-${orderNumber}`;
    }
    const order = await storage.getOrderByNumber(orderNumber);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const review = await storage.getReviewByOrderId(order.id);
    res.json(review || null);
  });

  app.post("/api/reviews", async (req, res) => {
    try {
      const { orderNumber, stars, comment } = req.body;
      const parsedStars = parseInt(stars);
      if (!orderNumber || isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) {
        return res.status(400).json({ message: "Order number and rating (1-5 stars) are required" });
      }
      let normalizedOrderNumber = orderNumber.trim().toUpperCase();
      if (!normalizedOrderNumber.startsWith("ORD-")) {
        normalizedOrderNumber = `ORD-${normalizedOrderNumber}`;
      }
      const order = await storage.getOrderByNumber(normalizedOrderNumber);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      const existingReview = await storage.getReviewByOrderId(order.id);
      if (existingReview) {
        const updated = await storage.updateReview(existingReview.id, { stars: parsedStars, comment: comment || null });
        return res.json(updated);
      }
      let clientName = order.customerName || "Guest";
      let accountNumber: string | null = null;
      let clientId: number | null = null;
      if (order.clientId) {
        const client = await storage.getClient(order.clientId);
        if (client) {
          clientName = client.name;
          accountNumber = client.billNumber || null;
          clientId = client.id;
        }
      }
      const review = await storage.createReview({
        orderId: order.id,
        orderNumber: normalizedOrderNumber,
        clientId,
        clientName,
        accountNumber,
        stars: parsedStars,
        comment: comment || null,
      });
      res.json(review);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/reviews/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid review ID" });
    await storage.deleteReview(id);
    res.json({ message: "Review deleted" });
  });

  // Generate public view token for order
  app.post("/api/orders/:id/generate-token", async (req, res) => {
    const orderId = Number(req.params.id);
    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    const token =
      Math.random().toString(36).substring(2) + Date.now().toString(36);
    const order = await storage.updateOrder(orderId, {
      publicViewToken: token,
    });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json({ token: order.publicViewToken });
  });

  // Driver delivery confirmation endpoint
  app.post("/api/orders/:id/deliver-by-driver", async (req, res) => {
    const orderId = Number(req.params.id);
    const { pin, deliveryPhoto, itemCountVerified } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const normalizedPin = String(pin || "").trim();

    if (!normalizedPin) {
      return res.status(400).json({ message: "Driver PIN is required" });
    }

    if (!/^\d{5}$/.test(normalizedPin)) {
      return res.status(400).json({ message: "Invalid PIN format" });
    }

    if (itemCountVerified !== true) {
      return res.status(400).json({ message: "Please confirm the item count before delivery" });
    }

    const deliveryActor = await resolveDeliveryActorByPin(normalizedPin);
    if (!deliveryActor) {
      return res.status(403).json({ message: "Invalid PIN" });
    }

    // Get the order
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check if order is in ready state (packed but not delivered)
    if (!order.packingDone) {
      return res.status(400).json({ message: "Order is not ready for delivery yet" });
    }

    if (order.delivered) {
      return res.status(400).json({ message: "Order already delivered" });
    }

    if (order.deliveryType !== 'delivery') {
      return res.status(400).json({ message: "This order is for pickup, not delivery" });
    }

    const deliveredByName = deliveryActor.name;
    const parsedItems = parseDeliveryConfirmationItems(order.items);
    const fullPickupStatus: Record<string, string> = {};
    parsedItems.forEach((_, idx) => {
      fullPickupStatus[String(idx)] = "delivered";
    });
    const releasedItemCount = order.itemCountAtIntake ?? parsedItems.reduce(
      (sum, item) => sum + (item.quantity || 1),
      0,
    );

    // Mark order as delivered with optional delivery photo
    const updateData: any = {
      delivered: true,
      status: "delivered",
      deliveryDate: new Date().toISOString(),
      deliveredByWorkerId: deliveryActor.id,
      deliveryBy: deliveredByName,
      itemCountVerified: true,
      verifiedAt: new Date().toISOString(),
      verifiedByWorkerId: deliveryActor.id,
      verifiedByWorkerName: deliveredByName,
      itemCountAtRelease: releasedItemCount,
      itemPickupStatus: JSON.stringify(fullPickupStatus),
    };

    // Add delivery photo if provided
    if (deliveryPhoto) {
      updateData.deliveryPhoto = deliveryPhoto;
      updateData.deliveryPhotos = [deliveryPhoto];
    }

    const updatedOrder = await storage.updateOrder(orderId, updateData);

    res.json(sanitizeOrderActorLabels(updatedOrder));
  });

  // Incident Routes
  app.get("/api/incidents", async (req, res) => {
    const search = req.query.search as string | undefined;
    const incidents = await storage.getIncidents(search);
    res.json(incidents);
  });

  app.get("/api/incidents/:id", async (req, res) => {
    const incidentId = Number(req.params.id);
    if (isNaN(incidentId)) {
      return res.status(400).json({ message: "Invalid incident ID" });
    }
    const incident = await storage.getIncident(incidentId);
    if (!incident) {
      return res.status(404).json({ message: "Incident not found" });
    }
    res.json(incident);
  });

  app.post("/api/incidents", async (req, res) => {
    try {
      const incident = await storage.createIncident(req.body);
      res.status(201).json(incident);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/incidents/:id", async (req, res) => {
    try {
      const incidentId = Number(req.params.id);
      if (isNaN(incidentId)) {
        return res.status(400).json({ message: "Invalid incident ID" });
      }
      const incident = await storage.updateIncident(incidentId, req.body);
      res.json(incident);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/incidents/:id", async (req, res) => {
    const incidentId = Number(req.params.id);
    if (isNaN(incidentId)) {
      return res.status(400).json({ message: "Invalid incident ID" });
    }
    await storage.deleteIncident(incidentId);
    res.status(204).send();
  });

  // Missing Items Routes
  app.get("/api/missing-items", async (req, res) => {
    const search = req.query.search as string | undefined;
    const items = await storage.getMissingItems(search);
    res.json(items);
  });

  app.get("/api/missing-items/:id", async (req, res) => {
    const itemId = Number(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ message: "Invalid item ID" });
    }
    const item = await storage.getMissingItem(itemId);
    if (!item) {
      return res.status(404).json({ message: "Missing item not found" });
    }
    res.json(item);
  });

  app.post("/api/missing-items", async (req, res) => {
    try {
      const item = await storage.createMissingItem(req.body);
      res.status(201).json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/missing-items/:id", async (req, res) => {
    try {
      const itemId = Number(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }
      const item = await storage.updateMissingItem(itemId, req.body);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/missing-items/:id", async (req, res) => {
    const itemId = Number(req.params.id);
    if (isNaN(itemId)) {
      return res.status(400).json({ message: "Invalid item ID" });
    }
    await storage.deleteMissingItem(itemId);
    res.status(204).send();
  });

  // Stage Checklists Routes
  app.get("/api/stage-checklists/order/:orderId", async (req, res) => {
    const orderId = Number(req.params.orderId);
    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    const checklists = await db
      .select()
      .from(stageChecklists)
      .where(eq(stageChecklists.orderId, orderId));
    res.json(checklists);
  });

  app.get("/api/stage-checklists/order/:orderId/:stage", async (req, res) => {
    const orderId = Number(req.params.orderId);
    const stage = req.params.stage;
    if (isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }
    const [checklist] = await db
      .select()
      .from(stageChecklists)
      .where(
        and(
          eq(stageChecklists.orderId, orderId),
          eq(stageChecklists.stage, stage)
        )
      );
    res.json(checklist || null);
  });

  app.post("/api/stage-checklists", async (req, res) => {
    try {
      const { orderId, stage, totalItems, workerName, workerId } = req.body;

      // Check if checklist already exists for this order and stage
      const [existing] = await db
        .select()
        .from(stageChecklists)
        .where(
          and(
            eq(stageChecklists.orderId, orderId),
            eq(stageChecklists.stage, stage)
          )
        );

      if (existing) {
        return res.json(existing);
      }

      const [checklist] = await db
        .insert(stageChecklists)
        .values({
          orderId,
          stage,
          totalItems,
          checkedItems: "[]",
          checkedCount: 0,
          isComplete: false,
          startedAt: new Date(),
          workerId,
          workerName,
        })
        .returning();
      res.status(201).json(checklist);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/stage-checklists/:id", async (req, res) => {
    try {
      const checklistId = Number(req.params.id);
      if (isNaN(checklistId)) {
        return res.status(400).json({ message: "Invalid checklist ID" });
      }

      const { checkedItems, checkedCount, isComplete, workerId, workerName } = req.body;
      const updates: any = {};

      if (checkedItems !== undefined) updates.checkedItems = checkedItems;
      if (checkedCount !== undefined) updates.checkedCount = checkedCount;
      if (isComplete !== undefined) {
        updates.isComplete = isComplete;
        if (isComplete) {
          updates.completedAt = new Date();
        }
      }
      if (workerId !== undefined) updates.workerId = workerId;
      if (workerName !== undefined) updates.workerName = workerName;

      const [checklist] = await db
        .update(stageChecklists)
        .set(updates)
        .where(eq(stageChecklists.id, checklistId))
        .returning();

      if (!checklist) {
        return res.status(404).json({ message: "Checklist not found" });
      }
      res.json(checklist);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/stage-checklists/order/:orderId/:stage/toggle", async (req, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const stage = req.params.stage;
      const { itemIndex, checked, workerId, workerName } = req.body;

      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      // Get or create checklist
      let [checklist] = await db
        .select()
        .from(stageChecklists)
        .where(
          and(
            eq(stageChecklists.orderId, orderId),
            eq(stageChecklists.stage, stage)
          )
        );

      if (!checklist) {
        return res.status(404).json({ message: "Checklist not found. Create it first." });
      }

      // Parse checked items and update
      let items: number[] = [];
      try {
        items = JSON.parse(checklist.checkedItems || "[]");
      } catch (e) {
        items = [];
      }

      if (checked && !items.includes(itemIndex)) {
        items.push(itemIndex);
      } else if (!checked) {
        items = items.filter(i => i !== itemIndex);
      }

      const checkedCount = items.length;
      const isComplete = checkedCount >= checklist.totalItems;

      const [updated] = await db
        .update(stageChecklists)
        .set({
          checkedItems: JSON.stringify(items),
          checkedCount,
          isComplete,
          completedAt: isComplete ? new Date() : null,
          workerId: workerId || checklist.workerId,
          workerName: workerName || checklist.workerName,
        })
        .where(eq(stageChecklists.id, checklist.id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Batch toggle all items - more efficient for "check all" / "uncheck all"
  app.put("/api/stage-checklists/order/:orderId/:stage/toggle-all", async (req, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const stage = req.params.stage;
      const { checkedItems, workerId, workerName } = req.body;

      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      if (!Array.isArray(checkedItems)) {
        return res.status(400).json({ message: "checkedItems must be an array" });
      }

      // Get checklist
      let [checklist] = await db
        .select()
        .from(stageChecklists)
        .where(
          and(
            eq(stageChecklists.orderId, orderId),
            eq(stageChecklists.stage, stage)
          )
        );

      if (!checklist) {
        return res.status(404).json({ message: "Checklist not found. Create it first." });
      }

      const checkedCount = checkedItems.length;
      const isComplete = checkedCount >= checklist.totalItems;

      const [updated] = await db
        .update(stageChecklists)
        .set({
          checkedItems: JSON.stringify(checkedItems),
          checkedCount,
          isComplete,
          completedAt: isComplete ? new Date() : null,
          workerId: workerId || checklist.workerId,
          workerName: workerName || checklist.workerName,
        })
        .where(eq(stageChecklists.id, checklist.id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // Get incomplete checklists (for supervisor alerts)
  app.get("/api/stage-checklists/incomplete", async (req, res) => {
    const incomplete = await db
      .select()
      .from(stageChecklists)
      .where(eq(stageChecklists.isComplete, false));
    res.json(incomplete);
  });

  // Generate System Flowchart PDF
  app.get("/api/system-flowchart", async (req, res) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const companyContact = await storage.getCompanyContactSettings();
    const companyName = String(companyContact.companyName || "Liquid Washes Laundry");
    const companyPhoneParts = [
      companyContact.telephone ? `Tel: ${companyContact.telephone}` : "",
      companyContact.mobilePhone ? `Mobile: ${companyContact.mobilePhone}` : "",
    ].filter(Boolean);
    const companyPhoneLine = companyPhoneParts.join(" | ");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="LiquidWashes_System_Flowchart.pdf"',
    );
    doc.pipe(res);

    const pageWidth = 595.28;
    const contentWidth = pageWidth - 80;
    const centerX = pageWidth / 2;
    let currentY = 40;

    const colors = {
      primary: "#3B82F6",
      success: "#22C55E",
      warning: "#F59E0B",
      danger: "#EF4444",
      purple: "#8B5CF6",
      cyan: "#06B6D4",
      gray: "#6B7280",
      lightGray: "#F3F4F6",
    };

    const drawBox = (
      x: number,
      y: number,
      width: number,
      height: number,
      text: string,
      color: string,
      isRounded = true,
    ) => {
      doc
        .roundedRect(x, y, width, height, isRounded ? 8 : 0)
        .fillAndStroke(color, color);
      doc
        .fillColor("white")
        .fontSize(9)
        .text(text, x + 5, y + height / 2 - 5, {
          width: width - 10,
          align: "center",
        });
      doc.fillColor("black");
    };

    const drawDiamond = (
      x: number,
      y: number,
      size: number,
      text: string,
      color: string,
    ) => {
      doc
        .save()
        .translate(x + size / 2, y + size / 2)
        .rotate(45)
        .rect(-size / 2.8, -size / 2.8, size / 1.4, size / 1.4)
        .fillAndStroke(color, color)
        .restore();
      doc
        .fillColor("white")
        .fontSize(7)
        .text(text, x - 5, y + size / 2 - 5, { width: size + 10, align: "center" });
      doc.fillColor("black");
    };

    const drawArrow = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color = "#374151",
    ) => {
      doc.strokeColor(color).lineWidth(1.5).moveTo(x1, y1).lineTo(x2, y2).stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowLength = 8;
      doc
        .moveTo(x2, y2)
        .lineTo(
          x2 - arrowLength * Math.cos(angle - Math.PI / 6),
          y2 - arrowLength * Math.sin(angle - Math.PI / 6),
        )
        .lineTo(
          x2 - arrowLength * Math.cos(angle + Math.PI / 6),
          y2 - arrowLength * Math.sin(angle + Math.PI / 6),
        )
        .lineTo(x2, y2)
        .fill(color);
    };

    const drawSectionTitle = (title: string, y: number) => {
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .fillColor(colors.primary)
        .text(title, 40, y, { width: contentWidth, align: "center" });
      doc.font("Helvetica");
      return y + 25;
    };

    // Cover Page
    doc
      .fontSize(28)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text(companyName.toUpperCase(), 40, 150, {
        width: contentWidth,
        align: "center",
      });
    doc.fontSize(20).fillColor(colors.gray).text("System Flowchart", 40, 190, {
      width: contentWidth,
      align: "center",
    });
    doc
      .fontSize(12)
      .text("Comprehensive Business Process Documentation", 40, 230, {
        width: contentWidth,
        align: "center",
      });

    doc
      .roundedRect(centerX - 150, 280, 300, 200, 10)
      .fillAndStroke(colors.lightGray, colors.primary);
    doc.fillColor(colors.gray).fontSize(11);
    const features = [
      "Order Management & Workflow",
      "Client & Financial Tracking",
      "Inventory Management",
      "Billing & Invoice System",
      "Staff PIN Verification",
      "Reports & Analytics",
      "Role-Based Authentication",
      "WhatsApp Integration",
    ];
    features.forEach((feature, i) => {
      doc.text(`• ${feature}`, centerX - 130, 295 + i * 22);
    });

    doc.fontSize(10).fillColor(colors.gray);
    if (companyPhoneLine) {
      doc.text(companyPhoneLine, 40, 520, {
        width: contentWidth,
        align: "center",
      });
    }
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 40, 535, {
      width: contentWidth,
      align: "center",
    });

    // PAGE 2: Authentication Flow
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("1. AUTHENTICATION SYSTEM", 40, currentY);
    currentY += 40;

    drawBox(centerX - 60, currentY, 120, 30, "User Opens App", colors.gray);
    currentY += 30;
    drawArrow(centerX, currentY, centerX, currentY + 20);
    currentY += 20;

    drawDiamond(centerX - 25, currentY, 50, "Logged In?", colors.warning);
    currentY += 50;

    // Left branch - Not logged in
    drawArrow(centerX - 25, currentY - 25, centerX - 100, currentY - 25);
    drawArrow(centerX - 100, currentY - 25, centerX - 100, currentY + 10);
    drawBox(centerX - 160, currentY + 10, 120, 30, "Show Login Page", colors.cyan);

    drawArrow(centerX - 100, currentY + 40, centerX - 100, currentY + 60);
    drawBox(
      centerX - 165,
      currentY + 60,
      130,
      30,
      "Enter Username & Password",
      colors.gray,
    );

    drawArrow(centerX - 100, currentY + 90, centerX - 100, currentY + 110);
    drawDiamond(centerX - 125, currentY + 110, 50, "Valid?", colors.warning);

    drawArrow(centerX - 100, currentY + 160, centerX - 100, currentY + 180);
    drawBox(centerX - 160, currentY + 180, 120, 30, "Store Session", colors.success);

    // Right branch - Already logged in
    drawArrow(centerX + 25, currentY - 25, centerX + 100, currentY - 25);
    drawArrow(centerX + 100, currentY - 25, centerX + 100, currentY + 180);
    drawBox(centerX + 40, currentY + 180, 120, 30, "Load Dashboard", colors.success);

    currentY += 240;
    doc.fontSize(10).fillColor(colors.gray);
    doc.text("Password Reset Flow:", 40, currentY);
    currentY += 15;
    doc.text(
      "1. User clicks 'Forgot Password' → 2. Enter email → 3. Receive 6-digit code via email",
      50,
      currentY,
    );
    currentY += 12;
    doc.text(
      "4. Enter verification code → 5. Set new password → 6. Login with new credentials",
      50,
      currentY,
    );

    currentY += 30;
    doc.text("User Roles:", 40, currentY);
    currentY += 15;
    doc.text("• Admin: Full system access, user management, all reports", 50, currentY);
    currentY += 12;
    doc.text(
      "• Manager: Order management, billing, inventory, limited reports",
      50,
      currentY,
    );
    currentY += 12;
    doc.text("• Cashier: Order creation, billing, basic operations", 50, currentY);

    // PAGE 3: Order Workflow
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("2. ORDER WORKFLOW (Main Business Process)", 40, currentY);
    currentY += 40;

    // Stage 1: Create Order
    drawBox(40, currentY, 120, 35, "1. CREATE ORDER", colors.primary);
    doc.fontSize(8).fillColor(colors.gray);
    doc.text("• Select/Create Client", 45, currentY + 40);
    doc.text("• Enter phone (required)", 45, currentY + 50);
    doc.text("• Add laundry items", 45, currentY + 60);
    doc.text("• Set delivery date", 45, currentY + 70);
    doc.text("• Stock auto-deducted", 45, currentY + 80);

    drawArrow(160, currentY + 17, 190, currentY + 17);

    // Stage 2: Tag PIN
    drawBox(190, currentY, 110, 35, "2. TAG PIN", colors.warning);
    doc.text("• Enter staff PIN", 195, currentY + 40);
    doc.text("• Print tag (A5)", 195, currentY + 50);
    doc.text("• Attach to clothes", 195, currentY + 60);
    doc.text("• Auto-navigate next", 195, currentY + 70);

    drawArrow(300, currentY + 17, 330, currentY + 17);

    // Stage 3: Packing
    drawBox(330, currentY, 100, 35, "3. PACKING", colors.purple);
    doc.text("• Enter packing PIN", 335, currentY + 40);
    doc.text("• Mark items packed", 335, currentY + 50);
    doc.text("• Quality check", 335, currentY + 60);

    drawArrow(430, currentY + 17, 460, currentY + 17);

    // Stage 4: Delivery
    drawBox(460, currentY, 95, 35, "4. DELIVERY", colors.success);
    doc.text("• Enter delivery PIN", 465, currentY + 40);
    doc.text("• Upload proof photo", 465, currentY + 50);
    doc.text("• Print invoice", 465, currentY + 60);
    doc.text("• Complete order", 465, currentY + 70);

    currentY += 110;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(colors.primary);
    doc.text("Staff PIN Verification at Each Stage:", 40, currentY);
    currentY += 20;

    doc.fontSize(9).font("Helvetica").fillColor(colors.gray);
    const pinSteps = [
      "1. Staff enters 5-digit PIN when completing any stage",
      "2. System verifies PIN against worker database",
      "3. Worker name & timestamp recorded for accountability",
      "4. System auto-navigates to next pending order in queue",
    ];
    pinSteps.forEach((step, i) => {
      doc.text(step, 50, currentY + i * 14);
    });

    currentY += 80;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(colors.primary);
    doc.text("Order Status Tracking:", 40, currentY);
    currentY += 20;

    const statuses = [
      { name: "Pending", color: colors.warning, desc: "Order created, awaiting tag" },
      { name: "Washing", color: colors.cyan, desc: "Tag complete, in laundry" },
      { name: "Ready", color: colors.purple, desc: "Packing done, ready for delivery" },
      { name: "Delivered", color: colors.success, desc: "Order completed" },
    ];

    statuses.forEach((status, i) => {
      drawBox(50 + i * 130, currentY, 100, 25, status.name, status.color);
      doc.fontSize(7).fillColor(colors.gray);
      doc.text(status.desc, 50 + i * 130, currentY + 30, {
        width: 100,
        align: "center",
      });
    });

    // PAGE 4: Client Management
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("3. CLIENT MANAGEMENT", 40, currentY);
    currentY += 40;

    drawBox(centerX - 60, currentY, 120, 30, "Clients Module", colors.primary);
    currentY += 50;

    // Three branches
    const clientActions = [
      { title: "Add Client", items: ["Name", "Phone (required)", "Address", "Notes"] },
      {
        title: "View Client",
        items: ["Order history", "Balance due", "Transaction log", "Total spent"],
      },
      {
        title: "Manage Balance",
        items: ["Add payment", "Record credit", "View unpaid bills", "Export statement"],
      },
    ];

    clientActions.forEach((action, i) => {
      const x = 60 + i * 180;
      drawArrow(
        centerX,
        currentY - 20,
        x + 60,
        currentY - 20 + (i === 1 ? 0 : 20),
      );
      drawBox(x, currentY, 120, 30, action.title, colors.cyan);
      doc.fontSize(8).fillColor(colors.gray);
      action.items.forEach((item, j) => {
        doc.text(`• ${item}`, x + 5, currentY + 35 + j * 12);
      });
    });

    currentY += 120;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(colors.primary);
    doc.text("Client Transaction Flow:", 40, currentY);
    currentY += 25;

    drawBox(50, currentY, 100, 30, "Bill Created", colors.warning);
    drawArrow(150, currentY + 15, 180, currentY + 15);
    drawBox(180, currentY, 100, 30, "Balance Updated", colors.cyan);
    drawArrow(280, currentY + 15, 310, currentY + 15);
    drawBox(310, currentY, 100, 30, "Payment Made", colors.purple);
    drawArrow(410, currentY + 15, 440, currentY + 15);
    drawBox(440, currentY, 100, 30, "Balance Reduced", colors.success);

    // PAGE 5: Billing System
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("4. BILLING & INVOICE SYSTEM", 40, currentY);
    currentY += 40;

    drawBox(centerX - 60, currentY, 120, 30, "Create Bill", colors.primary);
    currentY += 50;

    doc.fontSize(9).fillColor(colors.gray);
    doc.text("Bill Creation Process:", 40, currentY);
    currentY += 15;

    const billSteps = [
      "1. Select client from dropdown",
      "2. Choose linked order (optional)",
      "3. Add bill items with quantities & prices",
      "4. Apply discount if applicable",
      "5. Enter staff PIN for verification",
      "6. Save bill & update client balance",
    ];
    billSteps.forEach((step, i) => {
      doc.text(step, 50, currentY + i * 14);
    });

    currentY += 100;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(colors.primary);
    doc.text("Bill Actions:", 40, currentY);
    currentY += 25;

    const billActions = [
      { title: "Download PDF", color: colors.cyan },
      { title: "Thermal Print", color: colors.warning },
      { title: "WhatsApp Share", color: colors.success },
      { title: "Mark as Paid", color: colors.purple },
    ];

    billActions.forEach((action, i) => {
      drawBox(50 + i * 130, currentY, 110, 30, action.title, action.color);
    });

    currentY += 60;
    doc.fontSize(10).fillColor(colors.gray);
    doc.text("Bidirectional Linking: Bills can be linked to Orders and vice versa.", 40, currentY);
    doc.text(
      "Client balance automatically updates when bills are created or payments received.",
      40,
      currentY + 14,
    );

    // PAGE 6: Inventory
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("5. INVENTORY MANAGEMENT", 40, currentY);
    currentY += 40;

    drawBox(centerX - 60, currentY, 120, 30, "Inventory Module", colors.primary);
    currentY += 50;

    doc.fontSize(9).fillColor(colors.gray);
    doc.text("47 Pre-seeded Laundry Items:", 40, currentY);
    currentY += 15;

    const categories = [
      "Clothing (shirts, pants, dresses, etc.)",
      "Bedding (sheets, pillowcases, comforters)",
      "Household (towels, curtains, tablecloths)",
      "Specialty (suits, wedding dresses, leather)",
    ];
    categories.forEach((cat, i) => {
      doc.text(`• ${cat}`, 50, currentY + i * 14);
    });

    currentY += 70;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(colors.primary);
    doc.text("Stock Flow:", 40, currentY);
    currentY += 25;

    drawBox(50, currentY, 110, 30, "Add Stock", colors.success);
    drawArrow(160, currentY + 15, 190, currentY + 15);
    drawBox(190, currentY, 120, 30, "Current Quantity", colors.cyan);
    drawArrow(310, currentY + 15, 340, currentY + 15);
    drawBox(340, currentY, 120, 30, "Order Created", colors.warning);
    drawArrow(460, currentY + 15, 490, currentY + 15);
    drawBox(490, currentY - 5, 50, 40, "-Stock", colors.danger);

    currentY += 60;
    doc.fontSize(9).fillColor(colors.gray);
    doc.text("• Stock is automatically deducted when orders are created", 50, currentY);
    doc.text("• Low stock alerts appear on dashboard", 50, currentY + 14);
    doc.text("• Upload product images for visual identification", 50, currentY + 28);

    // PAGE 7: Reports
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("6. REPORTS & ANALYTICS", 40, currentY);
    currentY += 40;

    const reportTypes = [
      {
        title: "Sales Report",
        items: [
          "Daily/Weekly/Monthly sales",
          "Revenue breakdown",
          "Top selling items",
          "Export to Excel/PDF",
        ],
      },
      {
        title: "Due Customers",
        items: [
          "Outstanding balances",
          "Aging analysis",
          "Contact details",
          "Quick bill creation",
        ],
      },
      {
        title: "Staff Performance",
        items: [
          "Orders completed per worker",
          "Average completion time",
          "PIN verification logs",
          "Productivity trends",
        ],
      },
    ];

    reportTypes.forEach((report, i) => {
      drawBox(40, currentY + i * 100, 140, 30, report.title, colors.primary);
      doc.fontSize(8).fillColor(colors.gray);
      report.items.forEach((item, j) => {
        doc.text(`• ${item}`, 190, currentY + i * 100 + 5 + j * 12);
      });
    });

    // PAGE 8: System Overview
    doc.addPage();
    currentY = 40;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor(colors.primary)
      .text("7. COMPLETE SYSTEM OVERVIEW", 40, currentY);
    currentY += 40;

    // Main flow diagram
    const modules = [
      { name: "Login", x: centerX - 50, y: currentY, color: colors.gray },
      { name: "Dashboard", x: centerX - 50, y: currentY + 60, color: colors.primary },
      { name: "Orders", x: 60, y: currentY + 130, color: colors.warning },
      { name: "Clients", x: 180, y: currentY + 130, color: colors.cyan },
      { name: "Inventory", x: 300, y: currentY + 130, color: colors.purple },
      { name: "Bills", x: 420, y: currentY + 130, color: colors.success },
      { name: "Reports", x: centerX - 50, y: currentY + 200, color: colors.danger },
      { name: "Workers", x: 180, y: currentY + 200, color: colors.gray },
      { name: "Incidents", x: 320, y: currentY + 200, color: colors.warning },
    ];

    modules.forEach((m) => {
      drawBox(m.x, m.y, 100, 30, m.name, m.color);
    });

    // Draw connecting arrows
    drawArrow(centerX, currentY + 30, centerX, currentY + 60);
    drawArrow(centerX, currentY + 90, 110, currentY + 130);
    drawArrow(centerX, currentY + 90, 230, currentY + 130);
    drawArrow(centerX, currentY + 90, 350, currentY + 130);
    drawArrow(centerX, currentY + 90, 470, currentY + 130);

    currentY += 250;
    doc.fontSize(10).fillColor(colors.gray);
    doc.text("All modules interconnected through shared database", 40, currentY, {
      width: contentWidth,
      align: "center",
    });

    currentY += 30;
    doc.fontSize(11).font("Helvetica-Bold").fillColor(colors.primary);
    doc.text("Technical Stack:", 40, currentY);
    currentY += 20;
    doc.fontSize(9).font("Helvetica").fillColor(colors.gray);
    doc.text("• Frontend: React + TypeScript + Tailwind CSS + shadcn/ui", 50, currentY);
    doc.text("• Backend: Express.js + Node.js", 50, currentY + 12);
    doc.text("• Database: PostgreSQL with Drizzle ORM", 50, currentY + 24);
    doc.text("• Email: Resend for password reset", 50, currentY + 36);
    doc.text("• Documents: A5 format for all prints/PDFs", 50, currentY + 48);

    doc.end();
  });

  // Global search endpoint
  app.get("/api/search", async (req, res) => {
    const q = String(req.query.q || "").toLowerCase().trim();
    if (!q) {
      return res.json([]);
    }

    const results: Array<{
      id: number;
      type: "order" | "client" | "product" | "bill";
      title: string;
      subtitle?: string;
      status?: string;
    }> = [];

    try {
      // Search orders
      const orders = await storage.getOrders();
      const matchedOrders = orders
        .filter(o =>
          o.orderNumber?.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q)
        )
        .slice(0, 5);

      for (const o of matchedOrders) {
        results.push({
          id: o.id,
          type: "order",
          title: `Order #${o.orderNumber}`,
          subtitle: o.customerName || undefined,
          status: o.delivered ? "Released" : o.packingDone ? "Ready" : o.washingDone ? "Washing" : o.tagDone ? "Tag" : "Received",
        });
      }

      // Search clients
      const clients = await storage.getClients();
      const matchedClients = clients
        .filter(c =>
          c.name?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q)
        )
        .slice(0, 5);

      for (const c of matchedClients) {
        results.push({
          id: c.id,
          type: "client",
          title: c.name,
          subtitle: c.phone || c.email || undefined,
        });
      }

      // Search products
      const products = await storage.getProducts();
      const matchedProducts = products
        .filter(p =>
          p.name?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
        )
        .slice(0, 5);

      for (const p of matchedProducts) {
        results.push({
          id: p.id,
          type: "product",
          title: p.name,
          subtitle: p.category || undefined,
        });
      }

      // Search bills
      const bills = await storage.getBills();
      const matchedBills = bills
        .filter(b =>
          b.referenceNumber?.toLowerCase().includes(q) ||
          b.customerName?.toLowerCase().includes(q) ||
          b.description?.toLowerCase().includes(q)
        )
        .slice(0, 5);

      for (const b of matchedBills) {
        results.push({
          id: b.id,
          type: "bill",
          title: `Bill #${b.referenceNumber || b.id}`,
          subtitle: b.customerName || undefined,
          status: b.isPaid ? "Paid" : "Unpaid",
        });
      }

      res.json(results.slice(0, 15));
    } catch (err) {
      console.error("Search error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/admin/fix-order-amount", async (req, res) => {
    try {
      const { orderNumber, newAmount, adminPin } = req.body;
      if (adminPin !== "11111") {
        return res.status(403).json({ message: "Invalid admin PIN" });
      }
      if (!orderNumber || newAmount === undefined) {
        return res.status(400).json({ message: "orderNumber and newAmount required" });
      }

      const allOrders = await storage.getOrders();
      const order = allOrders.find(o => o.orderNumber === orderNumber);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      await storage.updateOrder(order.id, {
        totalAmount: newAmount.toString(),
        finalAmount: newAmount.toString(),
      });

      if (order.billId) {
        await storage.updateBill(order.billId, {
          amount: newAmount.toString(),
          paidAmount: newAmount.toString(),
        });
      }

      // Also fix related client transactions and balance
      if (order.billId && order.clientId) {
        const transactions = await storage.getClientTransactions(order.clientId);
        const relatedTxs = transactions.filter(t => t.billId === order.billId);
        const client = await storage.getClient(order.clientId);
        let balanceAdjust = 0;
        let updatedRelatedTransactions = false;
        for (const tx of relatedTxs) {
          const oldAmt = parseFloat(tx.amount);
          if (oldAmt !== newAmount) {
            balanceAdjust += oldAmt - newAmount;
            await db.update(clientTransactions)
              .set({ amount: newAmount.toFixed(2) })
              .where(eq(clientTransactions.id, tx.id));
            updatedRelatedTransactions = true;
          }
        }
        if (client && balanceAdjust !== 0) {
          const newBalance = parseFloat(client.balance || "0") + balanceAdjust;
          await storage.updateClient(client.id, { balance: newBalance.toFixed(2) });
        }
        if (updatedRelatedTransactions) {
          storage.notifyLiveResourceUpdated("clientTransactions");
        }
      }

      res.json({ success: true, message: `Order ${orderNumber} and bill updated to ${newAmount}` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/companies", async (_req, res) => {
    try {
      const allCompanies = await storage.getCompanies();
      res.json(allCompanies);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Company name is required" });
      }
      const existing = await storage.getCompanies();
      if (existing.some(c => c.name.toUpperCase() === name.trim().toUpperCase())) {
        return res.status(400).json({ message: "Company already exists" });
      }
      const company = await storage.createCompany({ name: name.trim().toUpperCase() });
      res.json(company);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies/rename", async (req, res) => {
    try {
      const { oldName, newName, name, adminPin } = req.body || {};
      const normalizedOldName = String(oldName || "").trim().toUpperCase();
      const normalizedNewName = String(newName || name || "").trim().toUpperCase();

      if (!normalizedOldName) {
        return res.status(400).json({ message: "Current company name is required" });
      }
      if (!normalizedNewName) {
        return res.status(400).json({ message: "New company name is required" });
      }
      if (!adminPin) {
        return res.status(400).json({ message: "Admin PIN required" });
      }

      const isAdminValid = await verifyAdminPin(String(adminPin || ""));
      if (!isAdminValid) {
        return res.status(401).json({ message: "Invalid admin PIN" });
      }

      const allCompanies = await storage.getCompanies();
      const currentCompany = allCompanies.find(
        (candidate) => String(candidate.name || "").trim().toUpperCase() === normalizedOldName,
      );
      const duplicateCompany = allCompanies.find(
        (candidate) => String(candidate.name || "").trim().toUpperCase() === normalizedNewName,
      );

      if (
        duplicateCompany &&
        (!currentCompany || duplicateCompany.id !== currentCompany.id)
      ) {
        return res.status(400).json({ message: "Company already exists" });
      }

      const company =
        currentCompany && normalizedOldName !== normalizedNewName
          ? (
              await db
                .update(companies)
                .set({ name: normalizedNewName })
                .where(eq(companies.id, currentCompany.id))
                .returning()
            )[0]
          : currentCompany ||
            duplicateCompany ||
            (
              await db
                .insert(companies)
                .values({ name: normalizedNewName })
                .returning()
            )[0];

      let affectedClients = 0;
      if (normalizedOldName !== normalizedNewName) {
        const allClients = await storage.getClients();
        const assignedClients = allClients.filter(
          (client) => String(client.company || "").trim().toUpperCase() === normalizedOldName,
        );

        for (const client of assignedClients) {
          await storage.updateClient(client.id, { company: normalizedNewName });
        }
        affectedClients = assignedClients.length;

        if (affectedClients > 0) {
          storage.notifyLiveResourceUpdated("bills");
        }
      }

      res.json({
        success: true,
        company,
        oldName: normalizedOldName,
        companyName: normalizedNewName,
        affectedClients,
        message:
          normalizedOldName === normalizedNewName
            ? "Company name unchanged"
            : `${normalizedOldName} renamed to ${normalizedNewName}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to rename company" });
    }
  });

  app.delete("/api/companies/:id", async (req, res) => {
    try {
      await storage.deleteCompany(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/companies/:id/disperse", async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      if (Number.isNaN(companyId)) {
        return res.status(400).json({ message: "Invalid company id" });
      }

      const allCompanies = await storage.getCompanies();
      const company = allCompanies.find((candidate) => candidate.id === companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const companyName = String(company.name || "").trim().toUpperCase();
      const allClients = await storage.getClients();
      const assignedClients = allClients.filter(
        (client) => String(client.company || "").trim().toUpperCase() === companyName,
      );

      for (const client of assignedClients) {
        await storage.updateClient(client.id, { company: "" });
      }

      await storage.deleteCompany(companyId);

      res.json({
        success: true,
        companyId,
        companyName,
        affectedClients: assignedClients.length,
        message: `${companyName} dispersed successfully. ${assignedClients.length} client(s) moved to no company.`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to disperse company" });
    }
  });

  app.post("/api/migrate-bill-descriptions", async (_req, res) => {
    try {
      const allBills = await storage.getBills();
      let updated = 0;
      for (const bill of allBills) {
        if (!bill.description) continue;
        if (bill.description.includes('@ ') && bill.description.includes(' AED')) continue;

        const orderMatch = bill.description.match(/Order #([A-Z0-9-]+):\s*/i);
        const orderNumber = orderMatch ? orderMatch[1] : '';
        const itemsText = orderMatch ? bill.description.replace(orderMatch[0], '') : bill.description;

        const relatedOrder = await db.select().from(orders).where(eq(orders.billId, bill.id)).limit(1);
        const deliveryType = relatedOrder.length > 0 ? relatedOrder[0].deliveryType : null;

        const enrichedDesc = await buildBillDescriptionWithPrices(orderNumber, itemsText, deliveryType || null);
        await storage.updateBill(bill.id, { description: enrichedDesc });
        updated++;
      }
      res.json({ message: `Updated ${updated} bills with embedded prices` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/reorder-orders", async (req, res) => {
    try {
      const { adminPassword, orderNumbersToMove, beforeOrderNumber } = req.body;
      if (!adminPassword || !orderNumbersToMove || !beforeOrderNumber) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const adminUser = await storage.getUserByUsername("admin");
      if (!adminUser) return res.status(401).json({ message: "Admin user not found" });
      const bcryptMod = await import("bcryptjs");
      const valid = await bcryptMod.default.compare(adminPassword, adminUser.password);
      if (!valid) return res.status(401).json({ message: "Invalid admin password" });

      const referenceOrders = await db.select().from(orders).where(eq(orders.orderNumber, beforeOrderNumber));
      if (referenceOrders.length === 0) return res.status(404).json({ message: `Reference order ${beforeOrderNumber} not found` });
      const refOrder = referenceOrders[0];
      const refDate = new Date(refOrder.entryDate!);

      const results: string[] = [];
      let updatedBillDates = false;
      for (let i = 0; i < orderNumbersToMove.length; i++) {
        const orderNum = orderNumbersToMove[i];
        const matchingOrders = await db.select().from(orders).where(eq(orders.orderNumber, orderNum));
        if (matchingOrders.length === 0) {
          results.push(`Order ${orderNum} not found`);
          continue;
        }
        const ord = matchingOrders[0];
        const newDate = new Date(refDate.getTime() - ((orderNumbersToMove.length - i) * 60000));
        await db.update(orders).set({ entryDate: newDate }).where(eq(orders.id, ord.id));

        if (ord.billId) {
          await db.update(bills).set({ billDate: newDate }).where(eq(bills.id, ord.billId));
          updatedBillDates = true;
        }
        results.push(`Order ${orderNum} (id=${ord.id}) moved to ${newDate.toISOString()} (before ${beforeOrderNumber})`);
      }
      if (updatedBillDates) {
        storage.notifyLiveResourceUpdated("bills");
      }
      res.json({ message: "Orders reordered", results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

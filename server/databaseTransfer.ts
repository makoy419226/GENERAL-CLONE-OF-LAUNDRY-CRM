import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  appSecuritySettings,
  bills,
  billPayments,
  clients,
  clientTransactions,
  companies,
  companyContactSettings,
  incidents,
  missingItems,
  orders,
  packingWorkers,
  passwordResetTokens,
  productCategorySettings,
  products,
  reviews,
  salesReportScheduleSettings,
  staffMembers,
  stageChecklists,
  users,
} from "@shared/schema";

export const DATABASE_EXPORT_FORMAT = "lwl-database-export-v1";

type DatabaseRow = Record<string, unknown>;

type DatabaseTableConfig = {
  name: string;
  sqlName: string;
  table: any;
  columns: readonly string[];
  dateColumns?: readonly string[];
};

const databaseTables: readonly DatabaseTableConfig[] = [
  {
    name: "products",
    sqlName: "products",
    table: products,
    columns: [
      "id",
      "name",
      "description",
      "price",
      "urgentPrice",
      "dryCleanPrice",
      "ironOnlyPrice",
      "urgentIronOnlyPrice",
      "urgentDryCleanPrice",
      "hasSizes",
      "smallPrice",
      "mediumPrice",
      "largePrice",
      "smallUrgentPrice",
      "mediumUrgentPrice",
      "largeUrgentPrice",
      "smallDryCleanPrice",
      "mediumDryCleanPrice",
      "largeDryCleanPrice",
      "smallIronOnlyPrice",
      "mediumIronOnlyPrice",
      "largeIronOnlyPrice",
      "smallUrgentIronOnlyPrice",
      "mediumUrgentIronOnlyPrice",
      "largeUrgentIronOnlyPrice",
      "smallUrgentDryCleanPrice",
      "mediumUrgentDryCleanPrice",
      "largeUrgentDryCleanPrice",
      "isSqmPriced",
      "sqmPrice",
      "sku",
      "category",
      "stockQuantity",
      "imageUrl",
      "starred",
    ],
  },
  {
    name: "clients",
    sqlName: "clients",
    table: clients,
    columns: [
      "id",
      "name",
      "contact",
      "email",
      "address",
      "phone",
      "phoneModified",
      "amount",
      "deposit",
      "balance",
      "notes",
      "billNumber",
      "preferredPaymentMethod",
      "discountPercent",
      "company",
      "clientType",
      "brokerAddresses",
    ],
  },
  {
    name: "users",
    sqlName: "users",
    table: users,
    columns: ["id", "username", "password", "pin", "role", "name", "email", "active"],
  },
  {
    name: "packing_workers",
    sqlName: "packing_workers",
    table: packingWorkers,
    columns: ["id", "name", "role", "pin", "active"],
  },
  {
    name: "staff_members",
    sqlName: "staff_members",
    table: staffMembers,
    columns: ["id", "name", "pin", "roleType", "active"],
  },
  {
    name: "companies",
    sqlName: "companies",
    table: companies,
    columns: ["id", "name"],
  },
  {
    name: "product_category_settings",
    sqlName: "product_category_settings",
    table: productCategorySettings,
    columns: [
      "id",
      "baseCategories",
      "customCategories",
      "inventoryDisplayOrder",
      "orderDisplayOrder",
      "favoritesOrder",
      "updatedAt",
    ],
    dateColumns: ["updatedAt"],
  },
  {
    name: "company_contact_settings",
    sqlName: "company_contact_settings",
    table: companyContactSettings,
    columns: [
      "id",
      "companyName",
      "tagline",
      "telephone",
      "mobilePhone",
      "whatsappPhone",
      "email",
      "website",
      "addressLine1",
      "addressLine2",
      "addressLine3",
      "dashboardClockHour12",
      "updatedAt",
    ],
    dateColumns: ["updatedAt"],
  },
  {
    name: "app_security_settings",
    sqlName: "app_security_settings",
    table: appSecuritySettings,
    columns: [
      "id",
      "lockdownEnabled",
      "lockdownReason",
      "lockdownAt",
      "lockdownBy",
      "updatedAt",
    ],
    dateColumns: ["lockdownAt", "updatedAt"],
  },
  {
    name: "sales_report_schedule_settings",
    sqlName: "sales_report_schedule_settings",
    table: salesReportScheduleSettings,
    columns: [
      "id",
      "dailyReportDayOffset",
      "dailyHour",
      "dailyMinute",
      "weeklyDay",
      "weeklyHour",
      "weeklyMinute",
      "monthlyDay",
      "monthlyHour",
      "monthlyMinute",
      "yearlyMonth",
      "yearlyDay",
      "yearlyHour",
      "yearlyMinute",
      "updatedAt",
    ],
    dateColumns: ["updatedAt"],
  },
  {
    name: "bills",
    sqlName: "bills",
    table: bills,
    columns: [
      "id",
      "clientId",
      "customerName",
      "customerPhone",
      "amount",
      "paidAmount",
      "description",
      "billDate",
      "referenceNumber",
      "isPaid",
      "paymentMethod",
      "createdByWorkerId",
      "createdBy",
      "notes",
      "refunded",
      "refundedAmount",
      "originalAmount",
      "priceAdjustReason",
      "discountAmount",
      "deliveryCharge",
      "discountAppliedBy",
    ],
    dateColumns: ["billDate"],
  },
  {
    name: "orders",
    sqlName: "orders",
    table: orders,
    columns: [
      "id",
      "clientId",
      "billId",
      "customerName",
      "orderNumber",
      "items",
      "totalAmount",
      "paidAmount",
      "discountPercent",
      "discountAmount",
      "deliveryCharge",
      "finalAmount",
      "paymentMethod",
      "serviceType",
      "status",
      "deliveryType",
      "expectedDeliveryAt",
      "entryDate",
      "entryBy",
      "entryByWorkerId",
      "tagDone",
      "tagDate",
      "tagBy",
      "tagWorkerId",
      "washingDone",
      "washingDate",
      "washingBy",
      "packingDone",
      "packingDate",
      "packingBy",
      "packingWorkerId",
      "delivered",
      "deliveryDate",
      "deliveryBy",
      "deliveredByWorkerId",
      "notes",
      "urgent",
      "publicViewToken",
      "tips",
      "deliveryPhoto",
      "deliveryPhotos",
      "deliveryAddress",
      "stockDeducted",
      "itemCountVerified",
      "verifiedAt",
      "verifiedByWorkerId",
      "verifiedByWorkerName",
      "itemCountAtIntake",
      "itemCountAtRelease",
      "adjustedTotal",
      "priceAdjustReason",
      "checkedItems",
      "itemPickupStatus",
    ],
    dateColumns: [
      "expectedDeliveryAt",
      "entryDate",
      "tagDate",
      "washingDate",
      "packingDate",
      "deliveryDate",
      "verifiedAt",
    ],
  },
  {
    name: "bill_payments",
    sqlName: "bill_payments",
    table: billPayments,
    columns: ["id", "billId", "clientId", "amount", "paymentDate", "paymentMethod", "notes"],
    dateColumns: ["paymentDate"],
  },
  {
    name: "client_transactions",
    sqlName: "client_transactions",
    table: clientTransactions,
    columns: [
      "id",
      "clientId",
      "billId",
      "type",
      "amount",
      "description",
      "date",
      "runningBalance",
      "paymentMethod",
      "discount",
      "processedBy",
    ],
    dateColumns: ["date"],
  },
  {
    name: "password_reset_tokens",
    sqlName: "password_reset_tokens",
    table: passwordResetTokens,
    columns: ["id", "userId", "token", "expiresAt", "used"],
    dateColumns: ["expiresAt"],
  },
  {
    name: "incidents",
    sqlName: "incidents",
    table: incidents,
    columns: [
      "id",
      "customerName",
      "customerPhone",
      "customerAddress",
      "orderId",
      "orderNumber",
      "itemName",
      "reason",
      "notes",
      "refundAmount",
      "refundType",
      "itemValue",
      "responsibleStaffId",
      "responsibleStaffName",
      "reporterName",
      "incidentType",
      "incidentStage",
      "status",
      "incidentDate",
      "resolvedDate",
      "resolution",
    ],
    dateColumns: ["incidentDate", "resolvedDate"],
  },
  {
    name: "missing_items",
    sqlName: "missing_items",
    table: missingItems,
    columns: [
      "id",
      "orderId",
      "orderNumber",
      "customerName",
      "itemName",
      "quantity",
      "itemValue",
      "stage",
      "responsibleWorkerId",
      "responsibleWorkerName",
      "reportedByWorkerId",
      "reportedByWorkerName",
      "notes",
      "status",
      "reportedAt",
      "resolvedAt",
      "resolution",
    ],
    dateColumns: ["reportedAt", "resolvedAt"],
  },
  {
    name: "stage_checklists",
    sqlName: "stage_checklists",
    table: stageChecklists,
    columns: [
      "id",
      "orderId",
      "stage",
      "checkedItems",
      "totalItems",
      "checkedCount",
      "isComplete",
      "startedAt",
      "completedAt",
      "workerId",
      "workerName",
    ],
    dateColumns: ["startedAt", "completedAt"],
  },
  {
    name: "reviews",
    sqlName: "reviews",
    table: reviews,
    columns: [
      "id",
      "orderId",
      "orderNumber",
      "clientId",
      "clientName",
      "accountNumber",
      "stars",
      "comment",
      "createdAt",
      "updatedAt",
    ],
    dateColumns: ["createdAt", "updatedAt"],
  },
];

export type DatabaseExportPayload = {
  metadata: {
    format: typeof DATABASE_EXPORT_FORMAT;
    exportedAt: string;
    tableCounts: Record<string, number>;
    tableOrder: string[];
  };
  tables: Record<string, unknown[]>;
};

export type DatabaseImportResult = {
  importedAt: string;
  sourceExportedAt: string | null;
  importedCounts: Record<string, number>;
  totalRows: number;
};

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getRowsPerBatch(columnCount: number): number {
  return Math.max(1, Math.min(250, Math.floor(5000 / Math.max(1, columnCount))));
}

function normalizeDateValue(tableName: string, columnName: string, value: unknown): unknown {
  if (value == null || value instanceof Date) {
    return value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Invalid date value for ${tableName}.${columnName}`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value for ${tableName}.${columnName}`);
  }

  return parsed;
}

function sanitizeImportRow(
  tableConfig: DatabaseTableConfig,
  rawRow: unknown,
  rowIndex: number,
): DatabaseRow {
  if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
    throw new Error(`Invalid row ${rowIndex + 1} in ${tableConfig.name}`);
  }

  const row = rawRow as DatabaseRow;
  const cleanRow: DatabaseRow = {};
  const dateColumns = new Set(tableConfig.dateColumns || []);

  for (const columnName of tableConfig.columns) {
    if (!(columnName in row)) {
      continue;
    }

    const value = dateColumns.has(columnName)
      ? normalizeDateValue(tableConfig.name, columnName, row[columnName])
      : row[columnName];
    cleanRow[columnName] = value;
  }

  const rowId = Number(cleanRow.id);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new Error(`Invalid or missing id in ${tableConfig.name} row ${rowIndex + 1}`);
  }
  cleanRow.id = rowId;

  return cleanRow;
}

function normalizeImportPayload(payload: unknown): Map<string, DatabaseRow[]> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Choose a valid LWL database export JSON file");
  }

  const exportPayload = payload as Partial<DatabaseExportPayload>;
  if (exportPayload.metadata?.format !== DATABASE_EXPORT_FORMAT) {
    throw new Error("This file is not a supported LWL database export");
  }

  if (!exportPayload.tables || typeof exportPayload.tables !== "object" || Array.isArray(exportPayload.tables)) {
    throw new Error("The database export is missing its tables section");
  }

  const normalizedTables = new Map<string, DatabaseRow[]>();

  for (const tableConfig of databaseTables) {
    const rawRows = exportPayload.tables[tableConfig.name];

    if (rawRows === undefined) {
      normalizedTables.set(tableConfig.name, []);
      continue;
    }

    if (!Array.isArray(rawRows)) {
      throw new Error(`Invalid table data for ${tableConfig.name}`);
    }

    normalizedTables.set(
      tableConfig.name,
      rawRows.map((row, rowIndex) => sanitizeImportRow(tableConfig, row, rowIndex)),
    );
  }

  return normalizedTables;
}

async function resetSerialSequence(tx: any, tableName: string) {
  const quotedTableName = quoteIdent(tableName);
  await tx.execute(sql.raw(`
    SELECT setval(
      pg_get_serial_sequence(${quoteStringLiteral(tableName)}, 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${quotedTableName}), 1), 1),
      (SELECT COUNT(*) > 0 FROM ${quotedTableName})
    )
  `));
}

export function getDatabaseExportFileName(exportedAt: Date): string {
  const fileTimestamp = exportedAt.toISOString().replace(/[:.]/g, "-");
  return `lwl-database-export-${fileTimestamp}.json`;
}

export async function buildDatabaseExport(): Promise<DatabaseExportPayload> {
  const exportedAt = new Date();
  const tableData: Record<string, unknown[]> = {};

  for (const tableConfig of databaseTables) {
    tableData[tableConfig.name] = await db.select().from(tableConfig.table);
  }

  const tableCounts = Object.fromEntries(
    Object.entries(tableData).map(([tableName, rows]) => [tableName, rows.length]),
  );

  return {
    metadata: {
      format: DATABASE_EXPORT_FORMAT,
      exportedAt: exportedAt.toISOString(),
      tableCounts,
      tableOrder: databaseTables.map((table) => table.name),
    },
    tables: tableData,
  };
}

export async function importDatabaseExport(payload: unknown): Promise<DatabaseImportResult> {
  const normalizedTables = normalizeImportPayload(payload);
  const sourceExportedAt =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? String((payload as Partial<DatabaseExportPayload>).metadata?.exportedAt || "") || null
      : null;

  await db.transaction(async (tx) => {
    const quotedTableNames = databaseTables
      .map((tableConfig) => quoteIdent(tableConfig.sqlName))
      .join(", ");

    await tx.execute(sql.raw(`TRUNCATE TABLE ${quotedTableNames} RESTART IDENTITY CASCADE`));

    for (const tableConfig of databaseTables) {
      const rows = normalizedTables.get(tableConfig.name) || [];
      const rowsPerBatch = getRowsPerBatch(tableConfig.columns.length);

      for (let start = 0; start < rows.length; start += rowsPerBatch) {
        const batch = rows.slice(start, start + rowsPerBatch);
        await tx.insert(tableConfig.table).values(batch as any[]);
      }
    }

    for (const tableConfig of databaseTables) {
      await resetSerialSequence(tx, tableConfig.sqlName);
    }
  });

  const importedCounts = Object.fromEntries(
    databaseTables.map((tableConfig) => [
      tableConfig.name,
      normalizedTables.get(tableConfig.name)?.length || 0,
    ]),
  );

  return {
    importedAt: new Date().toISOString(),
    sourceExportedAt,
    importedCounts,
    totalRows: Object.values(importedCounts).reduce((sum, count) => sum + count, 0),
  };
}

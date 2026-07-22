import { loadEnvironment } from "./env";
loadEnvironment();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import * as http from "http";
import { sendDailySalesReportEmailSMTP, sendSalesReportEmailSMTP, type DailySalesData, type SalesReportData, type ReportPeriod } from "./smtp";
import { storage } from "./storage";
import type { SalesReportScheduleSettings } from "@shared/schema";
import { formatErrorMessage } from "./errorFormatting";

export const app = express();
export const httpServer = http.createServer(app);

const removeBulkIndicator = (value: string | null | undefined) =>
  typeof value === "string"
    ? value.replace(/\s*\(bulk\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim()
    : null;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb', // Allow larger payloads for delivery photos
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || "development",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

export const appReady = (async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Serve attached_assets folder for logos and other assets
  const path = await import("path");
  app.use("/attached_assets", express.static(path.resolve(process.cwd(), "attached_assets")));
  
  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
    serveStatic(app);
  } else if (!process.env.VERCEL) {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const maxListenRetries =
    process.env.NODE_ENV === "production" ? 0 : 10;
  const retryBaseDelayMs = 500;

  const startListening = (attempt = 0) => {
    const handleListening = () => {
      httpServer.off("error", handleError);
      log(`Server running at http://localhost:${port}`);
    };

    const handleError = (err: NodeJS.ErrnoException) => {
      httpServer.off("listening", handleListening);

      if (err.code === "EADDRINUSE" && attempt < maxListenRetries) {
        const retryDelayMs = retryBaseDelayMs * (attempt + 1);
        log(
          `Port ${port} is busy. Retrying startup in ${retryDelayMs}ms (${attempt + 1}/${maxListenRetries}).`,
        );
        setTimeout(() => startListening(attempt + 1), retryDelayMs);
        return;
      }

      if (err.code === "EADDRINUSE") {
        log(`Port ${port} is already in use. Please free the port and restart.`);
        process.exit(1);
        return;
      }

      throw err;
    };

    httpServer.once("listening", handleListening);
    httpServer.once("error", handleError);
    httpServer.listen(port, "0.0.0.0");
  };

  if (!process.env.VERCEL) {
    startListening();
  }

  if (!process.env.VERCEL) {
    process.on('SIGINT', () => {
      log('SIGINT received - shutting down');
      httpServer.close(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
      log('SIGTERM received - shutting down');
      httpServer.close(() => process.exit(0));
    });
  }

  // One-time migration: Update bill & order ORD-638750 amount from 417 to 427
  (async () => {
    try {
      const bills = await storage.getBills();
      const bill = bills.find(b => b.referenceNumber === 'BILL-ORD-638750');
      if (bill && parseFloat(bill.amount) === 417) {
        await storage.updateBill(bill.id, { amount: "427.00" });
        log("Migration: Updated BILL-ORD-638750 bill amount from 417 to 427");
      }
      const orders = await storage.getOrders();
      const order = orders.find(o => o.orderNumber === 'ORD-638750');
      if (order && parseFloat(order.totalAmount) === 417) {
        await storage.updateOrder(order.id, { totalAmount: "427.00", finalAmount: "427.00" });
        log("Migration: Updated ORD-638750 order amount from 417 to 427");
      }
    } catch (e) {
      // Ignore if not found
    }
  })();

  // One-time migration: Populate size-specific urgent/dry clean/iron-only prices
  // Rules: Urgent = 2x normal, Dry Clean = 2x normal, Iron Only = normal/2
  (async () => {
    try {
      const products = await storage.getProducts();
      let migratedCount = 0;
      for (const product of products) {
        const hasSmall = product.smallPrice !== null && product.smallPrice !== undefined;
        const hasMedium = product.mediumPrice !== null && product.mediumPrice !== undefined;
        const hasLarge = product.largePrice !== null && product.largePrice !== undefined;
        
        if (!hasSmall && !hasMedium && !hasLarge) continue;
        
        const needsUpdate = 
          (hasSmall && (product.smallUrgentPrice === null || product.smallUrgentPrice === undefined)) ||
          (hasMedium && (product.mediumUrgentPrice === null || product.mediumUrgentPrice === undefined)) ||
          (hasLarge && (product.largeUrgentPrice === null || product.largeUrgentPrice === undefined));
        
        if (!needsUpdate) continue;
        
        const updates: any = {};
        if (hasSmall) {
          const sp = parseFloat(product.smallPrice!);
          updates.smallUrgentPrice = (sp * 2).toFixed(2);
          updates.smallDryCleanPrice = (sp * 2).toFixed(2);
          updates.smallIronOnlyPrice = (sp / 2).toFixed(2);
        }
        if (hasMedium) {
          const mp = parseFloat(product.mediumPrice!);
          updates.mediumUrgentPrice = (mp * 2).toFixed(2);
          updates.mediumDryCleanPrice = (mp * 2).toFixed(2);
          updates.mediumIronOnlyPrice = (mp / 2).toFixed(2);
        }
        if (hasLarge) {
          const lp = parseFloat(product.largePrice!);
          updates.largeUrgentPrice = (lp * 2).toFixed(2);
          updates.largeDryCleanPrice = (lp * 2).toFixed(2);
          updates.largeIronOnlyPrice = (lp / 2).toFixed(2);
        }
        
        await storage.updateProduct(product.id, updates);
        migratedCount++;
        log(`Migration: Set size-specific prices for "${product.name}" - Urgent=2x, DC=2x, Iron=÷2`);
      }
      if (migratedCount > 0) {
        log(`Migration: Updated size-specific prices for ${migratedCount} products`);
      }
    } catch (e) {
      log(`Migration error (size prices): ${formatErrorMessage(e)}`);
    }
  })();

  // Daily sales report scheduler - fetch admin email dynamically from database
  async function getAdminReportEmail(): Promise<string> {
    try {
      const adminUser = await storage.getUserByUsername("admin");
      return adminUser?.email || process.env.ADMIN_REPORT_EMAIL || "idusma0010@gmail.com";
    } catch {
      return process.env.ADMIN_REPORT_EMAIL || "idusma0010@gmail.com";
    }
  }
  
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
      amount: order.finalAmount || order.totalAmount,
      entryBy: order.entryBy,
      tagBy: order.tagBy,
      packingBy: order.packingBy,
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

  async function sendScheduledDailyReport(reportDate = new Date()) {
    try {
      const salesData = await generateDailySalesData(reportDate);
      const adminEmail = await getAdminReportEmail();
      await sendDailySalesReportEmailSMTP(adminEmail, salesData);
      log(`Daily sales report sent to ${adminEmail}`, "scheduler");
    } catch (err) {
      log(`Failed to send daily report: ${formatErrorMessage(err)}`, "scheduler");
    }
  }

  const enableInProcessSchedulers =
    process.env.ENABLE_IN_PROCESS_SCHEDULERS !== "false";

  // Generate sales data for any date range
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

  const DEFAULT_REPORT_SCHEDULE: SalesReportScheduleSettings = {
    id: 1,
    dailyReportDayOffset: 0,
    dailyHour: 23,
    dailyMinute: 59,
    weeklyDay: 6,
    weeklyHour: 23,
    weeklyMinute: 59,
    monthlyDay: 31,
    monthlyHour: 23,
    monthlyMinute: 59,
    yearlyMonth: 12,
    yearlyDay: 31,
    yearlyHour: 23,
    yearlyMinute: 59,
    updatedAt: null,
  };

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const UAE_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

  type UaeDateParts = {
    dateKey: string;
    year: number;
    month: number;
    day: number;
    dayOfWeek: number;
    hour: number;
    minute: number;
    lastDayOfMonth: number;
  };

  function getUaeDateParts(date = new Date()): UaeDateParts {
    const shifted = new Date(date.getTime() + UAE_UTC_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const day = shifted.getUTCDate();

    return {
      dateKey: shifted.toISOString().split("T")[0],
      year,
      month,
      day,
      dayOfWeek: shifted.getUTCDay(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      lastDayOfMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    };
  }

  function clampScheduleDay(day: number, maxDay: number): number {
    return Math.min(Math.max(day, 1), maxDay);
  }

  function getDailyReportDate(parts: UaeDateParts, dayOffset: number): Date {
    const reportDate = new Date(parts.year, parts.month - 1, parts.day);
    reportDate.setDate(reportDate.getDate() - dayOffset);
    return reportDate;
  }

  function formatScheduleTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function formatScheduleSummary(settings: SalesReportScheduleSettings): string {
    const dailyReportDateLabel =
      settings.dailyReportDayOffset === 1 ? "previous-day sales" : "same-day sales";

    return [
      `Daily ${dailyReportDateLabel} at ${formatScheduleTime(settings.dailyHour, settings.dailyMinute)}`,
      `Weekly on ${DAY_NAMES[settings.weeklyDay] || "Saturday"} at ${formatScheduleTime(settings.weeklyHour, settings.weeklyMinute)}`,
      `Monthly on day ${settings.monthlyDay} at ${formatScheduleTime(settings.monthlyHour, settings.monthlyMinute)}`,
      `Yearly on ${MONTH_NAMES[settings.yearlyMonth - 1] || "December"} ${settings.yearlyDay} at ${formatScheduleTime(settings.yearlyHour, settings.yearlyMinute)}`,
    ].join("; ");
  }

  async function getReportScheduleSettings(): Promise<SalesReportScheduleSettings> {
    try {
      return await storage.getSalesReportScheduleSettings();
    } catch (err) {
      log(
        `Failed to load report schedule settings, using defaults: ${formatErrorMessage(err)}`,
        "scheduler",
      );
      return DEFAULT_REPORT_SCHEDULE;
    }
  }

  // Track what reports have been sent today to avoid duplicates
  let lastDailyReportDate = '';
  let lastWeeklyReportDate = '';
  let lastMonthlyReportDate = '';
  let lastYearlyReportDate = '';

  // Send weekly report
  async function sendScheduledWeeklyReport() {
    try {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(now);
      endOfWeek.setHours(23, 59, 59, 999);
      
      const salesData = await generateSalesReportData(startOfWeek, endOfWeek, 'weekly');
      const adminEmail = await getAdminReportEmail();
      await sendSalesReportEmailSMTP(adminEmail, salesData);
      log(`Weekly sales report sent to ${adminEmail}`, "scheduler");
    } catch (err) {
      log(`Failed to send weekly report: ${formatErrorMessage(err)}`, "scheduler");
    }
  }

  // Send monthly report
  async function sendScheduledMonthlyReport() {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(now);
      endOfMonth.setHours(23, 59, 59, 999);
      
      const salesData = await generateSalesReportData(startOfMonth, endOfMonth, 'monthly');
      const adminEmail = await getAdminReportEmail();
      await sendSalesReportEmailSMTP(adminEmail, salesData);
      log(`Monthly sales report sent to ${adminEmail}`, "scheduler");
    } catch (err) {
      log(`Failed to send monthly report: ${formatErrorMessage(err)}`, "scheduler");
    }
  }

  // Send yearly report
  async function sendScheduledYearlyReport() {
    try {
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      startOfYear.setHours(0, 0, 0, 0);
      const endOfYear = new Date(now);
      endOfYear.setHours(23, 59, 59, 999);
      
      const salesData = await generateSalesReportData(startOfYear, endOfYear, 'yearly');
      const adminEmail = await getAdminReportEmail();
      await sendSalesReportEmailSMTP(adminEmail, salesData);
      log(`Yearly sales report sent to ${adminEmail}`, "scheduler");
    } catch (err) {
      log(`Failed to send yearly report: ${formatErrorMessage(err)}`, "scheduler");
    }
  }

  async function checkAndSendScheduledReports() {
    const schedule = await getReportScheduleSettings();
    const parts = getUaeDateParts();

    if (
      parts.hour === schedule.dailyHour &&
      parts.minute === schedule.dailyMinute &&
      lastDailyReportDate !== parts.dateKey
    ) {
      lastDailyReportDate = parts.dateKey;
      await sendScheduledDailyReport(getDailyReportDate(parts, schedule.dailyReportDayOffset));
    }

    if (
      parts.dayOfWeek === schedule.weeklyDay &&
      parts.hour === schedule.weeklyHour &&
      parts.minute === schedule.weeklyMinute &&
      lastWeeklyReportDate !== parts.dateKey
    ) {
      lastWeeklyReportDate = parts.dateKey;
      await sendScheduledWeeklyReport();
    }

    const scheduledMonthlyDay = clampScheduleDay(schedule.monthlyDay, parts.lastDayOfMonth);
    if (
      parts.day === scheduledMonthlyDay &&
      parts.hour === schedule.monthlyHour &&
      parts.minute === schedule.monthlyMinute &&
      lastMonthlyReportDate !== parts.dateKey
    ) {
      lastMonthlyReportDate = parts.dateKey;
      await sendScheduledMonthlyReport();
    }

    const scheduledYearlyLastDay = new Date(Date.UTC(parts.year, schedule.yearlyMonth, 0)).getUTCDate();
    const scheduledYearlyDay = clampScheduleDay(schedule.yearlyDay, scheduledYearlyLastDay);
    if (
      parts.month === schedule.yearlyMonth &&
      parts.day === scheduledYearlyDay &&
      parts.hour === schedule.yearlyHour &&
      parts.minute === schedule.yearlyMinute &&
      lastYearlyReportDate !== parts.dateKey
    ) {
      lastYearlyReportDate = parts.dateKey;
      await sendScheduledYearlyReport();
    }
  }

  if (enableInProcessSchedulers && !process.env.VERCEL) {
    setInterval(checkAndSendScheduledReports, 60 * 1000);
    getReportScheduleSettings().then((settings) => {
      log(`Sales report scheduler started: ${formatScheduleSummary(settings)} UAE time`, "scheduler");
    });
  } else {
    log("In-process schedulers disabled by environment configuration", "scheduler");
  }
})();

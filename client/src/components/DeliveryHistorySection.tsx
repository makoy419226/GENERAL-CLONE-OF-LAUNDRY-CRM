import { useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocation } from "wouter";
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  MapPin,
  Package,
  Printer,
  Search,
  ShoppingBag,
  Truck,
  User,
} from "lucide-react";
import { UserContext } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import logoImage from "@assets/image_1769169126339.png";
import type { Client, Order } from "@shared/schema";

const deliveryLogPeriods = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

type DeliveryLogPeriod = (typeof deliveryLogPeriods)[number]["value"];

const formatActorLabel = (value: string | null | undefined) =>
  String(value || "")
    .replace(/\s*\(bulk\)\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

interface DeliveryHistorySectionProps {
  className?: string;
  variant?: "page" | "panel";
  onOrderRedirect?: () => void;
}

export function DeliveryHistorySection({
  className,
  variant = "page",
  onOrderRedirect,
}: DeliveryHistorySectionProps) {
  const user = useContext(UserContext);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const isPanel = variant === "panel";
  const [deliveryLogPeriod, setDeliveryLogPeriod] = useState<DeliveryLogPeriod>("daily");
  const [logoBase64, setLogoBase64] = useState("");

  const uaeOffsetMs = 4 * 60 * 60 * 1000;

  const getUaeToday = () => {
    const uaeNow = new Date(Date.now() + uaeOffsetMs);
    const y = uaeNow.getUTCFullYear();
    const m = String(uaeNow.getUTCMonth() + 1).padStart(2, "0");
    const d = String(uaeNow.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const [selectedDate, setSelectedDate] = useState(getUaeToday);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setLogoBase64(canvas.toDataURL("image/png"));
    };
    img.src = logoImage;
  }, []);

  const formatDateInputValue = (date: Date) => format(date, "yyyy-MM-dd");

  const getSelectedDateObject = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  };

  const getDaysInMonth = (year: number, monthIndex: number) =>
    new Date(year, monthIndex + 1, 0).getDate();

  const shiftSelectedDate = (date: Date, delta: number) => {
    const next = new Date(date);

    if (deliveryLogPeriod === "weekly") {
      next.setDate(next.getDate() + delta * 7);
      return next;
    }

    if (deliveryLogPeriod === "monthly") {
      const day = next.getDate();
      const target = new Date(next.getFullYear(), next.getMonth() + delta, 1);
      target.setDate(Math.min(day, getDaysInMonth(target.getFullYear(), target.getMonth())));
      return target;
    }

    if (deliveryLogPeriod === "yearly") {
      const day = next.getDate();
      const month = next.getMonth();
      const target = new Date(next.getFullYear() + delta, month, 1);
      target.setDate(Math.min(day, getDaysInMonth(target.getFullYear(), month)));
      return target;
    }

    next.setDate(next.getDate() + delta);
    return next;
  };

  const getDeliveryLogPeriodRange = (dateStr: string, period: DeliveryLogPeriod) => {
    const anchor = getSelectedDateObject(dateStr);
    let startDate = new Date(anchor);
    let endDate = new Date(anchor);

    if (period === "weekly") {
      const daysSinceMonday = (anchor.getDay() + 6) % 7;
      startDate = new Date(anchor);
      startDate.setDate(anchor.getDate() - daysSinceMonday);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
    } else if (period === "monthly") {
      startDate = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      endDate = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    } else if (period === "yearly") {
      startDate = new Date(anchor.getFullYear(), 0, 1);
      endDate = new Date(anchor.getFullYear(), 11, 31);
    }

    const startUTC =
      Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0) -
      uaeOffsetMs;
    const endUTC =
      Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999) -
      uaeOffsetMs;

    const label =
      period === "daily"
        ? format(startDate, "EEEE, MMMM d, yyyy")
        : period === "weekly"
          ? `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`
          : period === "monthly"
            ? format(startDate, "MMMM yyyy")
            : format(startDate, "yyyy");

    return { startUTC, endUTC, startDate, endDate, label };
  };

  const formatOrderTrackingDateParam = (value: string | Date | null | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const openOrderInTracking = (order: Order) => {
    const params = new URLSearchParams();
    params.set("focusOrderId", String(order.id));

    const focusDate = formatOrderTrackingDateParam(order.entryDate);
    if (focusDate) {
      params.set("focusDate", focusDate);
    }

    onOrderRedirect?.();
    setLocation(`/orders?${params.toString()}`);
  };

  const getPriorityRowClasses = (urgent: boolean) =>
    urgent
      ? "border-l-4 border-l-red-500 bg-red-50/40 dark:border-l-red-500 dark:bg-red-950/20"
      : "border-l-4 border-l-emerald-500 bg-emerald-50/35 dark:border-l-emerald-400 dark:bg-emerald-950/15";

  const getPriorityBadgeClasses = (urgent: boolean) =>
    urgent
      ? "bg-red-500 px-1.5 py-0 text-[10px] text-white"
      : "bg-emerald-500 px-1.5 py-0 text-[10px] text-white";

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const getClient = (order: Order) => {
    return clients?.find((client) => client.id === order.clientId);
  };

  const isBrokerClient = (client?: Client | null) => {
    return ((client as any)?.clientType || "").trim().toLowerCase() === "broker";
  };

  const getOrderDisplayAddress = (order: Order, client?: Client | null) => {
    const orderAddress = String(order.deliveryAddress || "").trim();
    if (orderAddress) return orderAddress;
    if (isBrokerClient(client)) return "";
    return String(client?.address || "").trim();
  };

  const selectedPeriodRange = useMemo(
    () => getDeliveryLogPeriodRange(selectedDate, deliveryLogPeriod),
    [deliveryLogPeriod, selectedDate],
  );

  const deliveredOrders = useMemo(() => {
    return (
      orders
        ?.filter((order) => {
          if (!order.delivered) return false;
          if (order.deliveryType !== "delivery") return false;
          if (!(user?.role === "admin" || user?.role === "driver")) {
            if (order.deliveredByWorkerId !== user?.id) return false;
          }

          const ts = order.deliveryDate ? new Date(order.deliveryDate).getTime() : 0;
          return ts >= selectedPeriodRange.startUTC && ts <= selectedPeriodRange.endUTC;
        })
        .sort((a, b) => {
          const dateA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
          const dateB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
          return dateB - dateA;
        }) || []
    );
  }, [orders, selectedPeriodRange.endUTC, selectedPeriodRange.startUTC, user]);

  const filteredOrders = deliveredOrders.filter((order) => {
    const client = getClient(order);
    const searchLower = searchTerm.toLowerCase();
    return (
      order.orderNumber?.toLowerCase().includes(searchLower) ||
      order.customerName?.toLowerCase().includes(searchLower) ||
      client?.name?.toLowerCase().includes(searchLower) ||
      client?.phone?.toLowerCase().includes(searchLower)
    );
  });

  const getFormattedDeliveryDate = (value: string | Date | null | undefined) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return format(date, "dd MMM yyyy, h:mm a");
  };

  const getOrderAmount = (order: Order) => {
    const value = order.adjustedTotal ?? order.finalAmount ?? order.totalAmount ?? 0;
    const amount = parseFloat(String(value));
    return Number.isFinite(amount) ? amount : 0;
  };

  const getDeliveryLogPeriodLabel = () =>
    deliveryLogPeriods.find((period) => period.value === deliveryLogPeriod)?.label || "Daily";

  const handlePrintDeliveryLog = async () => {
    try {
      const [{ default: jsPDF }, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const periodLabel = getDeliveryLogPeriodLabel();
      const generatedAt = format(new Date(), "dd MMM yyyy, h:mm a");
      const title = `${periodLabel} Delivery Log`;
      const headerTextX = logoBase64 ? 38 : 8;
      const renderHeader = (pageLabel?: string) => {
        if (logoBase64) {
          doc.addImage(logoBase64, "PNG", 8, 6, 22, 18);
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Liquide Washes Laundry", headerTextX, 11);
        doc.setFontSize(10);
        doc.text(title, headerTextX, 17);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text(`Period: ${selectedPeriodRange.label}`, headerTextX, 22);
        doc.text(
          `Generated: ${generatedAt}    Total deliveries: ${filteredOrders.length}${pageLabel ? `    ${pageLabel}` : ""}`,
          headerTextX,
          26,
        );
      };

      const deliveredByTotals = filteredOrders.reduce<Record<string, { count: number }>>((totals, order) => {
        const deliveredBy = formatActorLabel(order.deliveryBy) || "Unknown";
        const current = totals[deliveredBy] || { count: 0 };
        totals[deliveredBy] = {
          count: current.count + 1,
        };
        return totals;
      }, {});
      const deliveredBySummaryRows = Object.entries(deliveredByTotals)
        .map(([deliveredBy, summary]) => ({
          deliveredBy,
          count: summary.count,
        }))
        .sort((left, right) => {
          if (right.count !== left.count) return right.count - left.count;
          return left.deliveredBy.localeCompare(right.deliveredBy);
        });
      renderHeader();

      const tableStartY = 32;

      type DeliveryLogRow = [string, string, string, string];
      const rows: DeliveryLogRow[] = filteredOrders.map((order, index) => {
        return [
          String(index + 1),
          `#${order.orderNumber}`,
          getFormattedDeliveryDate(order.deliveryDate),
          formatActorLabel(order.deliveryBy) || "-",
        ];
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const leftX = 8;
      const rightMargin = 8;
      const columnGap = 4;
      const columnWidth = (pageWidth - leftX - rightMargin - columnGap) / 2;
      const rightX = leftX + columnWidth + columnGap;
      const tableMargin = { top: 6, bottom: 6 };
      const tableOptions = {
        head: [["#", "Order", "Delivery Date", "Delivered By"]],
        styles: {
          fontSize: 5.2,
          cellPadding: { top: 0.25, right: 0.7, bottom: 0.25, left: 0.7 },
          lineWidth: 0.05,
          minCellHeight: 2.25,
          overflow: "ellipsize" as const,
          valign: "middle" as const,
        },
        headStyles: {
          fillColor: [37, 99, 235] as [number, number, number],
          textColor: [255, 255, 255] as [number, number, number],
          fontStyle: "bold" as const,
          fontSize: 5.4,
          minCellHeight: 2.6,
        },
        columnStyles: {
          0: { cellWidth: 6, halign: "center" as const },
          1: { cellWidth: 23 },
          2: { cellWidth: 34 },
          3: { cellWidth: 32 },
        },
        margin: tableMargin,
        tableWidth: columnWidth,
        pageBreak: "avoid" as const,
        rowPageBreak: "avoid" as const,
      };

      // Measure how many rows actually fit so we can use the full A4 height
      // and keep the last page balanced across both columns.
      const measureRowsPerColumn = (startY: number) => {
        if (rows.length === 0) return 0;

        let low = 1;
        let high = rows.length;
        let best = 1;

        while (low <= high) {
          const candidateCount = Math.floor((low + high) / 2);
          const probeDoc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

          autoTable(probeDoc, {
            ...tableOptions,
            startY,
            body: rows.slice(0, candidateCount),
            margin: { ...tableMargin, left: leftX },
          });

          if (probeDoc.getNumberOfPages() === 1) {
            best = candidateCount;
            low = candidateCount + 1;
          } else {
            high = candidateCount - 1;
          }
        }

        return Math.max(1, best);
      };

      const firstPageRowsPerColumn = measureRowsPerColumn(tableStartY);
      const nextPageRowsPerColumn = measureRowsPerColumn(32);

      const renderDeliveredBySummaryPage = () => {
        doc.addPage();
        renderHeader("Delivered By Summary");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Delivered By Summary", 8, 34);

        const summaryBody =
          deliveredBySummaryRows.length > 0
            ? [
                ...deliveredBySummaryRows.map((row, index) => [
                  String(index + 1),
                  row.deliveredBy,
                  String(row.count),
                ]),
                ["", "Total", String(filteredOrders.length)],
              ]
            : [["-", "No deliveries", "-"]];

        autoTable(doc, {
          startY: 39,
          head: [["#", "Delivered By", "Deliveries"]],
          body: summaryBody,
          margin: { left: 8, right: 8 },
          tableWidth: 194,
          theme: "grid",
          styles: {
            fontSize: 8,
            cellPadding: 1.4,
            lineWidth: 0.08,
            valign: "middle" as const,
          },
          headStyles: {
            fillColor: [37, 99, 235] as [number, number, number],
            textColor: [255, 255, 255] as [number, number, number],
            fontStyle: "bold" as const,
            halign: "center" as const,
          },
          columnStyles: {
            0: { cellWidth: 12, halign: "center" as const },
            1: { cellWidth: 140 },
            2: { cellWidth: 42, halign: "center" as const },
          },
          didParseCell: (hookData: any) => {
            if (hookData.section === "body" && hookData.row.index === summaryBody.length - 1) {
              hookData.cell.styles.fontStyle = "bold";
              hookData.cell.styles.fillColor = [245, 245, 245];
            }
          },
        });
      };

      if (rows.length === 0) {
        autoTable(doc, {
          ...tableOptions,
          startY: tableStartY,
          body: [["-", "No deliveries", "-", "-"]],
          margin: { ...tableOptions.margin, left: leftX },
        });
      } else {
        let renderedRows = 0;

        while (renderedRows < rows.length) {
          const isFirstPage = renderedRows === 0;
          const currentStartY = isFirstPage ? tableStartY : 32;
          const rowsPerColumn = isFirstPage ? firstPageRowsPerColumn : nextPageRowsPerColumn;
          const rowsPerPage = rowsPerColumn * 2;
          const rowsRemaining = rows.length - renderedRows;
          const rowsOnPage = Math.min(rowsRemaining, rowsPerPage);
          const leftCount = rowsOnPage < rowsPerPage ? Math.ceil(rowsOnPage / 2) : rowsPerColumn;
          const rightCount = rowsOnPage - leftCount;

          if (!isFirstPage) {
            doc.addPage();
            renderHeader(`Rows ${renderedRows + 1}-${renderedRows + rowsOnPage}`);
          }

          const leftRows = rows.slice(renderedRows, renderedRows + leftCount);
          const rightRows = rows.slice(
            renderedRows + leftCount,
            renderedRows + leftCount + rightCount,
          );

          autoTable(doc, {
            ...tableOptions,
            startY: currentStartY,
            body: leftRows,
            margin: { ...tableOptions.margin, left: leftX },
          });

          if (rightRows.length > 0) {
            autoTable(doc, {
              ...tableOptions,
              startY: currentStartY,
              body: rightRows,
              margin: { ...tableOptions.margin, left: rightX },
            });
          }

          renderedRows += rowsOnPage;
        }
      }

      renderDeliveredBySummaryPage();

      const fileName = `delivery-log-${deliveryLogPeriod}-${format(
        selectedPeriodRange.startDate,
        "yyyy-MM-dd",
      )}-to-${format(selectedPeriodRange.endDate, "yyyy-MM-dd")}.pdf`;
      doc.save(fileName);
      toast({
        title: "PDF Downloaded",
        description: `${periodLabel} delivery log saved`,
      });
    } catch (error) {
      console.error("Failed to generate delivery log PDF:", error);
      toast({
        title: "PDF Error",
        description: "Failed to generate delivery log PDF",
        variant: "destructive",
      });
    }
  };

  const changeDate = (delta: number) => {
    setSelectedDate(formatDateInputValue(shiftSelectedDate(getSelectedDateObject(selectedDate), delta)));
  };

  const panelContent = (
    <>
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2.5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <History className="h-4 w-4 text-primary" />
              Delivery History
            </h2>
            <p className="text-xs text-muted-foreground">
              {user?.role === "admin" || user?.role === "driver" ? "All delivery history" : "Your delivery history"}
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search deliveries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 pl-8 text-sm"
            data-testid="input-search-history-panel"
          />
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {deliveryLogPeriods.map((period) => (
            <Button
              key={period.value}
              type="button"
              variant={deliveryLogPeriod === period.value ? "default" : "outline"}
              size="sm"
              onClick={() => setDeliveryLogPeriod(period.value)}
              data-testid={`button-history-period-${period.value}`}
              className="h-8 px-1.5 text-[11px]"
            >
              {period.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => changeDate(-1)} data-testid="button-prev-history-date" className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-8 w-[150px] text-xs"
              data-testid="input-history-date-selector"
            />
            <Button variant="outline" size="icon" onClick={() => changeDate(1)} data-testid="button-next-history-date" className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedDate !== getUaeToday() && (
              <Button variant="secondary" size="sm" onClick={() => setSelectedDate(getUaeToday())} data-testid="button-history-today" className="h-8 px-2.5 text-[11px]">
                Today
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handlePrintDeliveryLog()}
              data-testid="button-print-delivery-log-panel"
              className="h-8 gap-1.5 px-2.5 text-[11px]"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Log
            </Button>
            <div className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-semibold text-primary">
              {filteredOrders.length} {filteredOrders.length === 1 ? "delivery" : "deliveries"}
            </div>
          </div>
        </div>

        <p className="text-xs font-medium text-muted-foreground">
          {getDeliveryLogPeriodLabel()}: {selectedPeriodRange.label}
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <History className="h-8 w-8 animate-pulse text-primary/80" />
        </div>
      ) : filteredOrders.length > 0 ? (
        <div className="overflow-hidden rounded-xl border bg-background/90">
          <div className="max-h-[min(78vh,34rem)] divide-y overflow-y-auto">
            {filteredOrders.map((order, idx) => {
              const client = getClient(order);
              const deliveryAddress = getOrderDisplayAddress(order, client);
              const amountLabel =
                order.adjustedTotal != null ? order.adjustedTotal : (order.finalAmount ?? order.totalAmount);
              const isUrgent = !!order.urgent;

              return (
                <div
                  key={order.id}
                  className={cn("px-3 py-2.5", getPriorityRowClasses(isUrgent))}
                  data-testid={`card-history-${order.id}`}
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-muted-foreground">{filteredOrders.length - idx}.</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openOrderInTracking(order)}
                          data-testid={`button-history-order-${order.id}`}
                          className="h-auto min-h-0 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10"
                        >
                          #{order.orderNumber}
                        </Button>
                        <Badge className={getPriorityBadgeClasses(isUrgent)}>
                          {isUrgent ? "Urgent" : "Normal"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">
                        {order.customerName || client?.name || "Unknown"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                        {client?.phone && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {client.phone}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {amountLabel} AED
                        </span>
                        {formatActorLabel(order.deliveryBy) && (
                          <span className="inline-flex items-center gap-1">
                            <Truck className="h-3 w-3" />
                            {formatActorLabel(order.deliveryBy)}
                          </span>
                        )}
                      </div>
                      {deliveryAddress && (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {deliveryAddress}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Delivered</p>
                      <p className="text-xs font-semibold text-green-600">
                        {order.deliveryDate ? format(new Date(order.deliveryDate), "dd MMM, h:mm a") : "-"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-background/90 p-8 text-center">
          <History className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No deliveries found for the selected period</p>
        </div>
      )}
    </>
  );

  const content = (
    <>
      <div className={cn("flex justify-between gap-4", isPanel ? "flex-col" : "flex-col md:flex-row md:items-center")}>
        <div>
          <h2 className={cn("font-bold text-foreground flex items-center gap-2", isPanel ? "text-lg" : "text-2xl")}>
            <History className={cn("text-primary", isPanel ? "w-5 h-5" : "w-7 h-7")} />
            Delivery History
          </h2>
          <p className="text-muted-foreground text-sm">
            {user?.role === "admin" || user?.role === "driver" ? "All delivery history" : "Your delivery history"}
          </p>
        </div>
        <div className={cn("flex gap-2", isPanel ? "flex-col sm:flex-row sm:items-center" : "items-center")}>
          <div className={cn("relative flex-1", isPanel ? "w-full" : "md:w-64")}>
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search deliveries..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid={isPanel ? "input-search-history-panel" : "input-search-history"}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {deliveryLogPeriods.map((period) => (
          <Button
            key={period.value}
            type="button"
            variant={deliveryLogPeriod === period.value ? "default" : "outline"}
            size="sm"
            onClick={() => setDeliveryLogPeriod(period.value)}
            data-testid={`button-history-period-${period.value}`}
            className="h-9 min-w-[6.5rem] text-xs"
          >
            {period.label}
          </Button>
        ))}
      </div>

      <div className={cn("flex items-start justify-between gap-3", isPanel ? "flex-col" : "flex-col sm:flex-row sm:items-center")}>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => changeDate(-1)} data-testid="button-prev-history-date">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-[170px]"
            data-testid="input-history-date-selector"
          />
          <Button variant="outline" size="icon" onClick={() => changeDate(1)} data-testid="button-next-history-date">
            <ChevronRight className="w-4 h-4" />
          </Button>
          {selectedDate !== getUaeToday() && (
            <Button variant="secondary" size="sm" onClick={() => setSelectedDate(getUaeToday())} data-testid="button-history-today">
              Today
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handlePrintDeliveryLog()}
            data-testid="button-print-delivery-log"
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            Print Log PDF
          </Button>
          <Card className={cn("flex items-center gap-2", isPanel ? "px-3 py-2" : "px-4 py-2")}>
            <span className={cn("font-bold text-blue-600", isPanel ? "text-xl" : "text-2xl")}>{filteredOrders.length}</span>
            <span className="text-sm text-muted-foreground">
              {filteredOrders.length === 1 ? "Delivery" : "Deliveries"}
            </span>
          </Card>
        </div>
      </div>

      <p className="text-sm font-medium text-muted-foreground">
        {getDeliveryLogPeriodLabel()}: {selectedPeriodRange.label}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <History className="w-8 h-8 animate-pulse text-primary/80" />
        </div>
      ) : filteredOrders.length > 0 ? (
        <div className={cn("grid gap-3", isPanel && "max-h-[60vh] overflow-y-auto pr-1")}>
          {filteredOrders.map((order, idx) => {
            const client = getClient(order);
            const rowNumber = filteredOrders.length - idx;
            const isUrgent = !!order.urgent;

            return (
              <Card
                key={order.id}
                className={cn(isPanel ? "p-3" : "p-4", getPriorityRowClasses(isUrgent))}
                data-testid={`card-history-${order.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-bold text-muted-foreground">{rowNumber}.</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openOrderInTracking(order)}
                        data-testid={`button-history-order-${order.id}`}
                        className={cn(
                          "h-auto min-h-0 rounded-full border border-primary/20 bg-primary/5 px-2 py-1 font-bold text-primary hover:bg-primary/10",
                          isPanel ? "text-sm" : "text-base",
                        )}
                      >
                        #{order.orderNumber}
                      </Button>
                      <Badge className="bg-blue-500 text-white">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Delivered
                      </Badge>
                      <Badge className={cn("text-white", isUrgent ? "bg-red-500" : "bg-emerald-500")}>
                        {isUrgent ? "Urgent" : "Normal"}
                      </Badge>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{order.customerName || client?.name || "Unknown"}</span>
                        {client?.phone && <span className="text-muted-foreground text-xs">({client.phone})</span>}
                      </div>
                      {getOrderDisplayAddress(order, client) && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          <span className="text-muted-foreground">{getOrderDisplayAddress(order, client)}</span>
                        </div>
                      )}
                      {order.items && (
                        <div className="flex items-start gap-2">
                          <ShoppingBag className="w-4 h-4 text-muted-foreground mt-0.5" />
                          <span className="text-muted-foreground">{order.items}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">
                          {order.adjustedTotal != null ? order.adjustedTotal : (order.finalAmount ?? order.totalAmount)} AED
                        </span>
                      </div>
                      {order.entryDate && (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Created: {format(new Date(order.entryDate), "dd MMM yyyy, h:mm a")}</span>
                        </div>
                      )}
                      {formatActorLabel(order.deliveryBy) && (
                        <div className="flex items-center gap-2">
                          <Truck className="w-4 h-4 text-muted-foreground" />
                          <span className="text-purple-600 font-medium">Delivered by: {formatActorLabel(order.deliveryBy)}</span>
                        </div>
                      )}
                      {order.deliveryDate && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-green-600 font-medium">
                            Delivered: {format(new Date(order.deliveryDate), "dd MMM yyyy, h:mm a")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <History className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No deliveries found for the selected period</p>
        </Card>
      )}
    </>
  );

  if (isPanel) {
    return (
      <div
        className={cn(
          "space-y-3 rounded-2xl border border-border/70 bg-background/95 p-3 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/90",
          className,
        )}
      >
        {panelContent}
      </div>
    );
  }

  return <div className={cn("space-y-4", className)}>{content}</div>;
}

export default DeliveryHistorySection;

import { useState, useContext, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Order, BillPayment, Client } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Package, Clock, CheckCircle2, Truck, HandCoins, TrendingUp, AlertCircle, AlertTriangle, Timer, ClipboardList, Bell, X, ChevronLeft, ChevronRight, Phone, Mail, Globe } from "lucide-react";
import { format } from "date-fns";
import { UserContext } from "@/App";
import { useCompanyContactInfo } from "@/lib/companyContact";

type OrderWithClient = Order & { clientName?: string };
type ItemBreakdownOrder = {
  orderId: number;
  orderNumber: string;
  clientName: string;
  quantity: number;
  entryDate: string | Date | null;
};

function getDashboardClockParts(date: Date, hour12: boolean) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
    timeZone: "Asia/Dubai",
  });
  const parts = formatter.formatToParts(date);

  if (!hour12) {
    return {
      time: formatter.format(date),
      period: null as string | null,
    };
  }

  return {
    time: parts
      .filter((part) => part.type !== "dayPeriod")
      .map((part) => part.value)
      .join("")
      .trim(),
    period: parts.find((part) => part.type === "dayPeriod")?.value.toUpperCase() || null,
  };
}

export default function TodaysWork() {
  const user = useContext(UserContext);
  const [, setLocation] = useLocation();
  const isSection = user?.role === "section";
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<OrderWithClient[]>([]);
  const [dialogTitle, setDialogTitle] = useState("");
  const [itemBreakdownOpen, setItemBreakdownOpen] = useState(false);
  const [itemBreakdownName, setItemBreakdownName] = useState("");
  const [itemBreakdownOrders, setItemBreakdownOrders] = useState<ItemBreakdownOrder[]>([]);
  const [uaeTime, setUaeTime] = useState(() => new Date());
  const [notifOpen, setNotifOpen] = useState(false);
  const { companyContact } = useCompanyContactInfo();

  useEffect(() => {
    const tick = setInterval(() => {
      setUaeTime(new Date());
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const checkForDayReset = () => {
      const nowEpoch = Date.now();
      const uaeNowMs = nowEpoch + 4 * 60 * 60 * 1000;
      const uaeNowDate = new Date(uaeNowMs);
      const uaeHour = uaeNowDate.getUTCHours();
      const uaeMinute = uaeNowDate.getUTCMinutes();
      if (uaeHour === 23 && uaeMinute >= 59) {
        window.location.reload();
      }
    };
    const interval = setInterval(checkForDayReset, 30000);
    return () => clearInterval(interval);
  }, []);

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: billPayments = [] } = useQuery<BillPayment[]>({
    queryKey: ["/api/bill-payments"],
  });

  const getClientName = (order: Order): string => {
    if (order.customerName) return order.customerName;
    if (order.clientId) {
      const client = clients.find(c => c.id === order.clientId);
      return client?.name || "Unknown";
    }
    return "Walk-in";
  };

  const uaeOffsetHours = 4;
  const getUaeStartOfDay = (date: Date) => {
    const uaeMs = date.getTime() + uaeOffsetHours * 60 * 60 * 1000;
    const uaeDate = new Date(uaeMs);
    return Date.UTC(uaeDate.getUTCFullYear(), uaeDate.getUTCMonth(), uaeDate.getUTCDate()) - uaeOffsetHours * 60 * 60 * 1000;
  };

  const actualTodayStartEpoch = getUaeStartOfDay(new Date());
  const todayDateValue = format(new Date(actualTodayStartEpoch + 12 * 60 * 60 * 1000), "yyyy-MM-dd");
  const isToday = !selectedDate || selectedDate === todayDateValue;
  const filterDate = selectedDate ? new Date(selectedDate + "T00:00:00") : new Date();
  const dayStartEpoch = selectedDate ? getUaeStartOfDay(filterDate) : actualTodayStartEpoch;
  const dayEndEpoch = dayStartEpoch + 24 * 60 * 60 * 1000;
  const filterStartEpoch = dayStartEpoch;
  const filterEndEpoch = dayEndEpoch;
  const displayedDateValue = format(new Date(dayStartEpoch + 12 * 60 * 60 * 1000), "yyyy-MM-dd");
  const liveClock = getDashboardClockParts(uaeTime, companyContact.dashboardClockHour12);
  const setDashboardDate = (value: string) => {
    setSelectedDate(!value || value === todayDateValue ? "" : value);
  };
  const changeDashboardDate = (days: number) => {
    const nextDate = new Date(dayStartEpoch + days * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
    setDashboardDate(format(nextDate, "yyyy-MM-dd"));
  };
  const todaysOrders = orders.filter((order) => {
    const orderTime = new Date(order.entryDate).getTime();
    return orderTime >= filterStartEpoch && orderTime < filterEndEpoch;
  });

  const completedToday = orders.filter((order) => {
    if (!order.delivered || !order.deliveryDate) return false;
    const deliveryTime = new Date(order.deliveryDate).getTime();
    return deliveryTime >= filterStartEpoch && deliveryTime < filterEndEpoch;
  });

  const entryOrders = todaysOrders.filter(
    (order) => !order.tagBy && !order.tagDone && !order.washingDone && !order.packingDone && !order.delivered
  );

  const pendingOrders = todaysOrders.filter(
    (order) => (order.tagBy || order.tagDone || order.washingDone) && !order.packingDone && !order.delivered
  );

  const readyForPickup = todaysOrders.filter(
    (order) => order.packingDone && !order.delivered && order.deliveryType === "pickup"
  );

  const readyForDelivery = todaysOrders.filter(
    (order) => order.packingDone && !order.delivered && order.deliveryType === "delivery"
  );

  const pickedUpToday = completedToday.filter(
    (order) => order.deliveryType === "pickup"
  );

  const deliveredToday = completedToday.filter(
    (order) => order.deliveryType === "delivery"
  );

  const expectedToday = orders.filter((order) => {
    if (!order.expectedDeliveryAt) return false;
    const expectedTime = new Date(order.expectedDeliveryAt).getTime();
    return expectedTime >= filterStartEpoch && expectedTime < filterEndEpoch && !order.delivered;
  });

  const overdueOrders = orders.filter((order) => {
    if (!order.expectedDeliveryAt) return false;
    const expectedTime = new Date(order.expectedDeliveryAt).getTime();
    return expectedTime < filterStartEpoch && !order.delivered;
  });

  const urgentOrders = orders.filter((order) => order.urgent && !order.delivered);

  const dueOrders = orders.filter((order) => {
    if (!order.expectedDeliveryAt || order.delivered) return false;
    const expectedTime = new Date(order.expectedDeliveryAt).getTime();
    const nowMs = Date.now();
    const hoursUntilDue = (expectedTime - nowMs) / (1000 * 60 * 60);
    return hoursUntilDue > 0 && hoursUntilDue <= 48;
  });

  const getOrderCurrentAmount = (order: Order) => {
    const parsedAmount = parseFloat(order.adjustedTotal ?? order.finalAmount ?? order.totalAmount ?? "0");
    return Number.isFinite(parsedAmount) ? Math.max(0, parsedAmount) : 0;
  };

  const getOrderPaidAmount = (order: Order) => {
    const parsedPaid = parseFloat(order.paidAmount || "0");
    if (!Number.isFinite(parsedPaid)) return 0;
    return Math.max(0, parsedPaid);
  };

  const totalRevenue = todaysOrders.reduce((sum, order) => {
    return sum + getOrderCurrentAmount(order);
  }, 0);

  const normalOrdersCount = todaysOrders.filter((order) => !order.urgent).length;
  const urgentOrdersCount = todaysOrders.filter((order) => order.urgent).length;
  const currentPeriodOrdersPaidAmount = todaysOrders.reduce((sum, order) => {
    return sum + Math.min(getOrderPaidAmount(order), getOrderCurrentAmount(order));
  }, 0);
  const currentPeriodOrdersUnpaidAmount = todaysOrders.reduce((sum, order) => {
    return sum + Math.max(0, getOrderCurrentAmount(order) - getOrderPaidAmount(order));
  }, 0);
  const currentPeriodPayments = billPayments.filter((payment) => {
    const paymentTime = new Date(payment.paymentDate).getTime();
    return paymentTime >= filterStartEpoch && paymentTime < filterEndEpoch;
  });
  const paidAmount = currentPeriodPayments.reduce((sum, payment) => {
    return sum + parseFloat(payment.amount || "0");
  }, 0);
  const currentPeriodBillIds = new Set(
    todaysOrders
      .map((order) => order.billId)
      .filter((billId): billId is number => billId !== null && billId !== undefined),
  );
  const paidBillIdsThisPeriod = Array.from(
    new Set(
      currentPeriodPayments
        .map((payment) => payment.billId)
        .filter((billId): billId is number => billId !== null && billId !== undefined),
    ),
  );
  const currentPeriodPaidBillsCount = paidBillIdsThisPeriod.filter((billId) => currentPeriodBillIds.has(billId)).length;
  const oldPaidBillsCount = paidBillIdsThisPeriod.length - currentPeriodPaidBillsCount;
  const currentPeriodPaidBillsAmount = currentPeriodPayments.reduce((sum, payment) => {
    if (!currentPeriodBillIds.has(payment.billId)) return sum;
    return sum + parseFloat(payment.amount || "0");
  }, 0);
  const oldPaidBillsAmount = currentPeriodPayments.reduce((sum, payment) => {
    if (currentPeriodBillIds.has(payment.billId)) return sum;
    return sum + parseFloat(payment.amount || "0");
  }, 0);
  const collectionRate = totalRevenue > 0
    ? Math.min(100, (currentPeriodOrdersPaidAmount / totalRevenue) * 100)
    : 0;
  const summaryDateLabel = format(new Date(dayStartEpoch + 12 * 60 * 60 * 1000), "EEEE, MMMM d, yyyy");
  const totalBillsPaidThisPeriod = currentPeriodPaidBillsCount + oldPaidBillsCount;
  const visibleOrders = [...todaysOrders].sort((left, right) => {
    const leftTime = new Date(left.entryDate || 0).getTime();
    const rightTime = new Date(right.entryDate || 0).getTime();
    if (leftTime !== rightTime) return rightTime - leftTime;
    return Number(right.id || 0) - Number(left.id || 0);
  });
  const dashboardLayoutClass = isSection
    ? "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,360px)_minmax(340px,420px)] xl:items-start"
    : "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(300px,400px)] xl:items-start 2xl:grid-cols-[minmax(320px,360px)_minmax(0,1.08fr)_minmax(340px,420px)]";
  const workflowColumnClass = isSection
    ? "w-full xl:max-w-[360px]"
    : "w-full xl:max-w-[380px] 2xl:max-w-[360px]";
  const workflowCardBase = "group relative overflow-hidden rounded-2xl border border-border/70 bg-background/95 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md";
  const workflowVerticalLine = "bg-gradient-to-b from-slate-300 via-slate-400 to-slate-200 dark:from-slate-700 dark:via-slate-500 dark:to-slate-700";
  const workflowHorizontalLine = "bg-gradient-to-r from-slate-300 via-slate-400 to-slate-200 dark:from-slate-700 dark:via-slate-500 dark:to-slate-700";
  const workflowCountPillBase = "shrink-0 rounded-full border px-2.5 py-1 text-center shadow-sm";
  const workflowCountValueBase = "text-sm font-bold leading-none tabular-nums";

  const parseOrderItems = (order: Order): Array<{ name: string; quantity: number }> => {
    if (!order.items) return [];
    const trimmed = order.items.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => ({
            name: item.name || item.productName || 'Unknown',
            quantity: item.quantity || item.qty || 1,
          }));
        }
      } catch (e) {}
    }
    return trimmed.split(", ").map((itemStr: string) => {
      const qtyFirst = itemStr.match(/^(\d+)x\s+(.+)$/);
      if (qtyFirst) return { name: qtyFirst[2].trim(), quantity: parseInt(qtyFirst[1]) };
      const qtyLast = itemStr.match(/^(.+)\s+x(\d+)$/);
      if (qtyLast) return { name: qtyLast[1].trim(), quantity: parseInt(qtyLast[2]) };
      return { name: itemStr.trim(), quantity: 1 };
    });
  };

  const itemSummary = todaysOrders.reduce<Record<string, number>>((acc, order) => {
    const items = parseOrderItems(order);
    items.forEach(item => {
      acc[item.name] = (acc[item.name] || 0) + item.quantity;
    });
    return acc;
  }, {});

  const sortedItemSummary = Object.entries(itemSummary).sort((a, b) => b[1] - a[1]);

  const openItemBreakdown = (itemName: string) => {
    const breakdown: ItemBreakdownOrder[] = [];
    todaysOrders.forEach(order => {
      const items = parseOrderItems(order);
      const match = items.find(i => i.name === itemName);
      if (match) {
        breakdown.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          clientName: getClientName(order),
          quantity: match.quantity,
          entryDate: order.entryDate,
        });
      }
    });
    setItemBreakdownName(itemName);
    setItemBreakdownOrders(breakdown);
    setItemBreakdownOpen(true);
  };

  const openOrderInTracking = (order: { id: number; entryDate?: string | Date | null }) => {
    const params = new URLSearchParams({
      focusOrderId: String(order.id),
    });

    if (order.entryDate) {
      try {
        params.set("focusDate", format(new Date(order.entryDate), "yyyy-MM-dd"));
      } catch {
        // Ignore invalid dates and focus by order ID only.
      }
    }

    setSelectedCard(null);
    setItemBreakdownOpen(false);
    setLocation(`/orders?${params.toString()}`);
  };

  const openCardDialog = (title: string, orderList: Order[]) => {
    setDialogTitle(title);
    setSelectedOrders(orderList.map(o => ({ ...o, clientName: getClientName(o) })));
    setSelectedCard(title);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-6">
      <div className="overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-md" data-testid="dashboard-contact-strip">
        <div className="animate-marquee flex min-w-max whitespace-nowrap">
          {Array.from({ length: 6 }, (_, copyIndex) => (
            <div
              key={`dashboard-contact-strip-${copyIndex}`}
              className="flex shrink-0 items-center gap-8 pr-8 py-2 text-[11px] font-medium sm:gap-12 sm:pr-12 sm:text-xs"
              aria-hidden={copyIndex > 0}
            >
              <span className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" />
                <span>Phone: {companyContact.mobilePhone || "-"}</span>
              </span>
              <span className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                <span>Email: {companyContact.email || "-"}</span>
              </span>
              <span className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5" />
                <span>{companyContact.website || "-"}</span>
              </span>
              <span className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" />
                <span>Tel: {companyContact.telephone || "-"}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <Card className="p-5 md:p-7 liquid-glass border-none shadow-2xl animate-fade-in" data-testid="card-digital-clock">
        <div className="flex flex-col items-center justify-center" data-testid="text-live-clock">
          <div className="flex items-start gap-2 text-[clamp(3.6rem,8vw,6.25rem)] font-bold leading-none tracking-tight text-foreground">
            <span>{liveClock.time}</span>
            {liveClock.period && (
              <span className="pt-2 text-[clamp(1rem,2vw,1.45rem)] font-bold uppercase tracking-[0.18em] text-primary">
                {liveClock.period}
              </span>
            )}
          </div>
          <p className="mt-2 text-[clamp(1rem,2.2vw,1.25rem)] font-light text-foreground/80" data-testid="text-clock-date">
            {format(new Date(dayStartEpoch + 12 * 60 * 60 * 1000), "EEEE, MMMM d")}
          </p>
          <p className="mt-1 text-xs md:text-sm font-medium text-muted-foreground">
            UAE Time (GMT+4)
          </p>
        </div>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-2 animate-slide-up">
        <h1 className="text-2xl font-bold text-foreground" data-testid="heading-todays-work">
          {isToday
            ? "Today's Work"
            : `Work on ${format(new Date(dayStartEpoch + 12 * 60 * 60 * 1000), "MMMM d, yyyy")}`}
        </h1>
        <div className="flex items-center gap-2 flex-wrap rounded-2xl border border-border/70 bg-gradient-to-r from-slate-50/90 via-background to-sky-50/60 p-2 shadow-sm dark:from-slate-950/20 dark:via-background dark:to-sky-950/10">
          <Button
            variant="outline"
            size="icon"
            onClick={() => changeDashboardDate(-1)}
            data-testid="button-prev-dashboard-date"
            className="h-8 w-8"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <div>
            <Input
              type="date"
              value={displayedDateValue}
              onChange={(e) => setDashboardDate(e.target.value)}
              className="h-8 w-[170px] text-xs sm:text-sm"
              data-testid="input-dashboard-date"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => changeDashboardDate(1)}
            data-testid="button-next-dashboard-date"
            className="h-8 w-8"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          {!isToday && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDashboardDate(todayDateValue)}
              data-testid="button-reset-date"
              className="h-8 px-3 text-[11px]"
            >
              Today
            </Button>
          )}
          {isToday && (
            <Badge variant="outline" className="border-blue-500 text-blue-600 animate-pulse-glow" data-testid="badge-live-updates">
              <Clock className="w-3 h-3 mr-1" />
              Live Updates
            </Badge>
          )}
        </div>
      </div>

      {(() => {
        const notifCount = (overdueOrders.length > 0 ? 1 : 0) + (urgentOrders.length > 0 ? 1 : 0) + (dueOrders.length > 0 ? 1 : 0);
        if (notifCount === 0) return null;
        return (
          <div className="fixed bottom-6 right-6 z-50" data-testid="floating-notifications">
            {notifOpen && (
              <div className="absolute bottom-16 right-0 w-80 bg-background border rounded-lg shadow-xl overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                  <span className="font-semibold text-sm">Alerts</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setNotifOpen(false)} data-testid="button-close-notifications">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y">
                  {overdueOrders.length > 0 && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/20" data-testid="notif-overdue">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-red-700 dark:text-red-400">Overdue Orders</p>
                          <p className="text-[11px] text-red-600 dark:text-red-300">{overdueOrders.length} past expected date</p>
                        </div>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 border-red-400 text-red-600" onClick={() => { setNotifOpen(false); openCardDialog("Overdue Orders", overdueOrders); }} data-testid="button-view-overdue">
                          View
                        </Button>
                      </div>
                    </div>
                  )}
                  {urgentOrders.length > 0 && (
                    <div className="p-3 bg-orange-50 dark:bg-orange-950/20" data-testid="notif-urgent">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-orange-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-orange-700 dark:text-orange-400">Urgent Orders</p>
                          <p className="text-[11px] text-orange-600 dark:text-orange-300">{urgentOrders.length} urgent pending</p>
                        </div>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 border-orange-400 text-orange-600" onClick={() => { setNotifOpen(false); openCardDialog("Urgent Orders", urgentOrders); }} data-testid="button-view-urgent">
                          View
                        </Button>
                      </div>
                    </div>
                  )}
                  {dueOrders.length > 0 && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20" data-testid="notif-due">
                      <div className="flex items-center gap-2">
                        <Timer className="w-4 h-4 text-amber-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-amber-700 dark:text-amber-400">Due Soon</p>
                          <p className="text-[11px] text-amber-600 dark:text-amber-300">{dueOrders.length} due within 48 hours</p>
                        </div>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-400 text-amber-600" onClick={() => { setNotifOpen(false); openCardDialog("Due Orders", dueOrders); }} data-testid="button-view-due">
                          View
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <Button
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg relative"
              variant={overdueOrders.length > 0 ? "destructive" : "default"}
              onClick={() => setNotifOpen(!notifOpen)}
              data-testid="button-toggle-notifications"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {overdueOrders.length + urgentOrders.length + dueOrders.length}
              </span>
              {overdueOrders.length > 0 && <span className="absolute -top-1 -right-1 w-[18px] h-[18px] bg-red-500 rounded-full animate-ping opacity-40" />}
            </Button>
          </div>
        );
      })()}

      <div className={dashboardLayoutClass}>
        {/* Left: Today's Summary */}
        {!isSection ? (
          <Card className="overflow-hidden border border-border/70 bg-background shadow-sm animate-slide-up xl:order-2 xl:self-start">
            <div className="border-b border-border/70 bg-gradient-to-r from-slate-50 via-background to-emerald-50/35 p-4 dark:from-slate-950/30 dark:via-background dark:to-emerald-950/10">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-bold text-foreground">
                        {isToday ? "Today's Sales Summary" : "Day Sales Summary"}
                      </h2>
                      <p className="text-xs text-muted-foreground">{summaryDateLabel}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isToday
                      ? "Daily billing snapshot with order mix, collection status, and payment breakdown."
                      : "Selected day order snapshot. Sales received reflects payments recorded on that date, while paid and unpaid below reflect the current status of those orders."}
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-200/70 bg-background/90 px-4 py-3 shadow-sm backdrop-blur dark:border-emerald-900/40">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {isToday ? "Total Sales Received Today" : "Total Sales Received on Selected Day"}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-emerald-600" data-testid="text-payments-received">
                    {paidAmount.toFixed(0)} AED
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totalBillsPaidThisPeriod} paid bill{totalBillsPaidThisPeriod === 1 ? "" : "s"} recorded in this period
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 shadow-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Normal Orders</span>
                  <p className="mt-3 text-3xl font-bold text-foreground" data-testid="text-normal-orders-count">{normalOrdersCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Standard turnaround orders in the selected day.</p>
                </div>
                <div className="rounded-2xl border border-orange-200 bg-orange-50/80 p-4 shadow-sm dark:border-orange-900/40 dark:bg-orange-950/20">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-300">Urgent Orders</span>
                  <p className="mt-3 text-3xl font-bold text-orange-600 dark:text-orange-300" data-testid="text-urgent-orders-count">{urgentOrdersCount}</p>
                  <p className="mt-1 text-xs text-orange-700/80 dark:text-orange-300/80">Priority orders requiring faster handling.</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">Financial Overview</h3>
                      <p className="text-xs text-muted-foreground">
                        {isToday
                          ? "Current-period order value, collection, and outstanding balance."
                          : "Current settlement position for orders created on the selected day."}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Collection Rate</p>
                      <p className="text-lg font-bold text-emerald-600">{collectionRate.toFixed(0)}%</p>
                    </div>
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all"
                      style={{ width: `${collectionRate}%` }}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border/70 bg-background p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {isToday ? "Current Period Final" : "Selected Day Final"}
                      </p>
                      <p className="mt-2 text-xl font-bold text-foreground" data-testid="text-orders-billed">{totalRevenue.toFixed(0)} AED</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/80 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                        Amount Collected So Far
                      </p>
                      <p className="mt-2 text-xl font-bold text-emerald-600 dark:text-emerald-300" data-testid="text-current-period-orders-paid">
                        {currentPeriodOrdersPaidAmount.toFixed(0)} AED
                      </p>
                    </div>
                    <div className="rounded-xl border border-red-200/70 bg-red-50/80 p-3 dark:border-red-900/40 dark:bg-red-950/20">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-700 dark:text-red-300">
                        {isToday ? "Unpaid Amount" : "Outstanding Balance"}
                      </p>
                      <p className="mt-2 text-xl font-bold text-red-600 dark:text-red-300" data-testid="text-current-period-orders-unpaid">
                        {currentPeriodOrdersUnpaidAmount.toFixed(0)} AED
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 shadow-sm">
                  <div>
                    <h3 className="font-semibold text-foreground">Payment Breakdown</h3>
                    <p className="text-xs text-muted-foreground">Sales received split between current-period and older bills.</p>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/80 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Current Period Bills Paid</p>
                          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">Bills linked to orders created in the selected day.</p>
                        </div>
                        <Badge
                          variant="outline"
                          className="border-emerald-300 bg-background/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                          data-testid="badge-current-period-paid-bills"
                        >
                          {currentPeriodPaidBillsCount} bill{currentPeriodPaidBillsCount === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-xl font-bold text-emerald-600 dark:text-emerald-300">{currentPeriodPaidBillsAmount.toFixed(0)} AED</p>
                    </div>

                    <div className="rounded-xl border border-blue-200/70 bg-blue-50/80 p-3 dark:border-blue-900/40 dark:bg-blue-950/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">Old Bills Paid</p>
                          <p className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">Older bills collected during the selected day.</p>
                        </div>
                        <Badge
                          variant="outline"
                          className="border-blue-300 bg-background/80 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                          data-testid="badge-old-paid-bills"
                        >
                          {oldPaidBillsCount} bill{oldPaidBillsCount === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-xl font-bold text-blue-600 dark:text-blue-300">{oldPaidBillsAmount.toFixed(0)} AED</p>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </Card>
        ) : null}

        {/* Center: Flowchart */}
        <div className={`${workflowColumnClass} xl:order-1 xl:self-start`}>
          <Card className="overflow-hidden border border-border/70 bg-gradient-to-b from-amber-50/35 via-background to-sky-50/20 shadow-sm animate-slide-up dark:from-amber-950/10 dark:via-background dark:to-sky-950/10">
            <div className="border-b border-border/70 bg-gradient-to-r from-slate-50 via-background to-amber-50/45 p-4 dark:from-slate-950/30 dark:via-background dark:to-amber-950/10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/15">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-foreground">Operations Flow</h2>
                    <p className="text-xs text-muted-foreground">
                      Track how orders move from intake to completion.
                    </p>
                  </div>
                </div>
                <Badge className="border border-amber-200 bg-background/80 px-3 py-1 text-[11px] font-semibold text-amber-700 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                  {todaysOrders.length} tracked
                </Badge>
              </div>
            </div>

            <div className="p-4">
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => openCardDialog("Pending Orders", entryOrders)}
                  data-testid="card-entry-orders"
                >
                  <Card className={`${workflowCardBase} border-orange-200/70 hover:border-orange-300 dark:border-orange-900/30 dark:hover:border-orange-800/60`}>
                    <div className="absolute inset-y-0 left-0 w-1 bg-orange-500/90" />
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-200 to-transparent opacity-80 dark:via-orange-800/60" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
                          <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Stage 01</p>
                          <h3 className="mt-1 text-sm font-semibold text-foreground">Pending</h3>
                          <p className="text-[11px] text-muted-foreground">Awaiting processing</p>
                        </div>
                      </div>
                      <div
                        className={`${workflowCountPillBase} border-orange-200/70 bg-orange-50/90 dark:border-orange-900/40 dark:bg-orange-950/20`}
                        aria-label={`${entryOrders.length} pending orders`}
                      >
                        <p className={`${workflowCountValueBase} text-orange-600 dark:text-orange-300`} data-testid="badge-entry-count">{entryOrders.length}</p>
                      </div>
                    </div>
                  </Card>
                </button>

                <div className={`my-2 h-7 w-[2px] ${workflowVerticalLine}`} />

                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => openCardDialog("In Progress Orders", pendingOrders)}
                  data-testid="card-pending-orders"
                >
                  <Card className={`${workflowCardBase} border-blue-200/70 hover:border-blue-300 dark:border-blue-900/30 dark:hover:border-blue-800/60`}>
                    <div className="absolute inset-y-0 left-0 w-1 bg-blue-500/90" />
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent opacity-80 dark:via-blue-800/60" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                          <Timer className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Stage 02</p>
                          <h3 className="mt-1 text-sm font-semibold text-foreground">In Progress</h3>
                          <p className="text-[11px] text-muted-foreground">Being processed</p>
                        </div>
                      </div>
                      <div
                        className={`${workflowCountPillBase} border-blue-200/70 bg-blue-50/90 dark:border-blue-900/40 dark:bg-blue-950/20`}
                        aria-label={`${pendingOrders.length} in-progress orders`}
                      >
                        <p className={`${workflowCountValueBase} text-blue-600 dark:text-blue-300`} data-testid="badge-pending-count">{pendingOrders.length}</p>
                      </div>
                    </div>
                  </Card>
                </button>

                <div className="relative my-2 h-8 w-full max-w-[260px]">
                  <div className={`absolute left-1/2 top-0 h-4 w-[2px] -translate-x-1/2 ${workflowVerticalLine}`} />
                  <div className={`absolute left-[25%] right-[25%] top-4 h-[2px] ${workflowHorizontalLine}`} />
                  <div className={`absolute left-[25%] top-4 h-4 w-[2px] -translate-x-1/2 ${workflowVerticalLine}`} />
                  <div className={`absolute right-[25%] top-4 h-4 w-[2px] translate-x-1/2 ${workflowVerticalLine}`} />
                </div>

                <div className="grid w-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openCardDialog("Ready for Takeaway", readyForPickup)}
                    data-testid="card-ready-pickup"
                  >
                    <Card className={`${workflowCardBase} border-amber-200/70 hover:border-amber-300 dark:border-amber-900/30 dark:hover:border-amber-800/60`}>
                      <div className="absolute inset-y-0 left-0 w-1 bg-amber-500/90" />
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200 to-transparent opacity-80 dark:via-amber-800/60" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
                            <Package className="h-[18px] w-[18px]" />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Stage 03A</p>
                            <h3 className="mt-1 text-sm font-semibold text-foreground">Ready Takeaway</h3>
                            <p className="text-[11px] text-muted-foreground">Awaiting customer</p>
                          </div>
                        </div>
                        <div
                          className={`${workflowCountPillBase} border-amber-200/70 bg-amber-50/90 dark:border-amber-900/40 dark:bg-amber-950/20`}
                          aria-label={`${readyForPickup.length} orders ready for takeaway`}
                        >
                          <p className={`${workflowCountValueBase} text-amber-600 dark:text-amber-300`} data-testid="badge-pickup-count">{readyForPickup.length}</p>
                        </div>
                      </div>
                    </Card>
                  </button>

                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openCardDialog("Ready for Delivery", readyForDelivery)}
                    data-testid="card-ready-delivery"
                  >
                    <Card className={`${workflowCardBase} border-orange-200/70 hover:border-orange-300 dark:border-orange-900/30 dark:hover:border-orange-800/60`}>
                      <div className="absolute inset-y-0 left-0 w-1 bg-orange-500/90" />
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-200 to-transparent opacity-80 dark:via-orange-800/60" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
                            <Truck className="h-[18px] w-[18px]" />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Stage 03B</p>
                            <h3 className="mt-1 text-sm font-semibold text-foreground">Ready Delivery</h3>
                            <p className="text-[11px] text-muted-foreground">Dispatch queue</p>
                          </div>
                        </div>
                        <div
                          className={`${workflowCountPillBase} border-orange-200/70 bg-orange-50/90 dark:border-orange-900/40 dark:bg-orange-950/20`}
                          aria-label={`${readyForDelivery.length} orders ready for delivery`}
                        >
                          <p className={`${workflowCountValueBase} text-orange-600 dark:text-orange-300`} data-testid="badge-delivery-count">{readyForDelivery.length}</p>
                        </div>
                      </div>
                    </Card>
                  </button>
                </div>

                <div className="grid w-full grid-cols-2 gap-3">
                  <div className="flex justify-center">
                    <div className={`my-2 h-7 w-[2px] ${workflowVerticalLine}`} />
                  </div>
                  <div className="flex justify-center">
                    <div className={`my-2 h-7 w-[2px] ${workflowVerticalLine}`} />
                  </div>
                </div>

                <div className="grid w-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openCardDialog("Taken Away Today", pickedUpToday)}
                    data-testid="card-picked-up-today"
                  >
                    <Card className={`${workflowCardBase} border-teal-200/70 hover:border-teal-300 dark:border-teal-900/30 dark:hover:border-teal-800/60`}>
                      <div className="absolute inset-y-0 left-0 w-1 bg-teal-500/90" />
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-200 to-transparent opacity-80 dark:via-teal-800/60" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300">
                            <HandCoins className="h-[18px] w-[18px]" />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Stage 04A</p>
                            <h3 className="mt-1 text-sm font-semibold text-foreground">Taken Away</h3>
                            <p className="text-[11px] text-muted-foreground">
                              {isToday ? "Collected today" : "Collected"}
                            </p>
                          </div>
                        </div>
                        <div
                          className={`${workflowCountPillBase} border-teal-200/70 bg-teal-50/90 dark:border-teal-900/40 dark:bg-teal-950/20`}
                          aria-label={`${pickedUpToday.length} takeaway orders completed`}
                        >
                          <p className={`${workflowCountValueBase} text-teal-600 dark:text-teal-300`} data-testid="badge-pickedup-count">{pickedUpToday.length}</p>
                        </div>
                      </div>
                    </Card>
                  </button>

                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openCardDialog("Delivered Today", deliveredToday)}
                    data-testid="card-delivered-today"
                  >
                    <Card className={`${workflowCardBase} border-green-200/70 hover:border-green-300 dark:border-green-900/30 dark:hover:border-green-800/60`}>
                      <div className="absolute inset-y-0 left-0 w-1 bg-green-500/90" />
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-200 to-transparent opacity-80 dark:via-green-800/60" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-green-500/10 text-green-600 dark:bg-green-500/15 dark:text-green-300">
                            <CheckCircle2 className="h-[18px] w-[18px]" />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Stage 04B</p>
                            <h3 className="mt-1 text-sm font-semibold text-foreground">Delivered</h3>
                            <p className="text-[11px] text-muted-foreground">
                              {isToday ? "Completed today" : "Completed"}
                            </p>
                          </div>
                        </div>
                        <div
                          className={`${workflowCountPillBase} border-green-200/70 bg-green-50/90 dark:border-green-900/40 dark:bg-green-950/20`}
                          aria-label={`${deliveredToday.length} delivered orders`}
                        >
                          <p className={`${workflowCountValueBase} text-green-600 dark:text-green-300`} data-testid="badge-delivered-count">{deliveredToday.length}</p>
                        </div>
                      </div>
                    </Card>
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Orders */}
        <Card className="min-w-0 overflow-hidden border border-border/70 bg-gradient-to-b from-background via-background to-muted/20 shadow-sm animate-slide-up xl:order-3 xl:w-full xl:self-start 2xl:justify-self-start">
          <div className="border-b border-border/70 bg-gradient-to-r from-slate-50 via-background to-sky-50/45 p-4 dark:from-slate-950/30 dark:via-background dark:to-sky-950/10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600 dark:bg-sky-500/15">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground">
                    {isToday ? "Today's Orders" : "Orders"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {isToday
                      ? "All orders from today's register."
                      : "All order entries from the selected date."}
                  </p>
                </div>
              </div>
              <Badge className="border border-sky-200 bg-background/80 px-3 py-1 text-[11px] font-semibold text-sky-700 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
                {visibleOrders.length} shown
              </Badge>
            </div>
          </div>

          <div className="flex flex-col p-4">
            {visibleOrders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center xl:flex xl:flex-1 xl:flex-col xl:items-center xl:justify-center" data-testid="text-no-orders">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600 dark:bg-sky-500/15">
                  <Clock className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-semibold text-foreground">
                  {isToday ? "No orders yet today" : "No orders on this date"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isToday
                    ? "New orders will appear here as soon as they are created."
                    : "Choose another date to review order activity."}
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto pr-1 max-h-80 xl:max-h-[34rem] 2xl:max-h-[40rem]">
                <div className="space-y-3">
                  {visibleOrders.map((order) => {
                    const statusLabel = order.delivered
                      ? "Completed"
                      : order.packingDone
                        ? "Ready"
                        : (order.tagDone || order.washingDone)
                          ? "In Progress"
                          : "Pending";
                    const statusClasses = order.delivered
                      ? {
                          accent: "bg-green-500",
                          badge: "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300",
                        }
                      : order.packingDone
                        ? {
                            accent: "bg-amber-500",
                            badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300",
                          }
                        : (order.tagDone || order.washingDone)
                          ? {
                              accent: "bg-blue-500",
                              badge: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300",
                            }
                          : {
                              accent: "bg-orange-500",
                              badge: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-300",
                            };
                    const urgencyClasses = order.urgent
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300";

                    return (
                      <div
                        key={order.id}
                        className="group relative overflow-hidden rounded-xl border border-border/70 bg-background/90 px-3 py-2.5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
                        data-testid={`row-recent-order-${order.id}`}
                      >
                        <div className={`absolute inset-y-0 left-0 w-1 ${statusClasses.accent}`} />
                        <div className="flex items-center justify-between gap-3 pl-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-auto shrink-0 p-0 text-sm font-semibold text-primary hover:bg-transparent hover:text-primary"
                                onClick={() => openOrderInTracking(order)}
                                data-testid={`text-order-number-${order.id}`}
                              >
                                #{order.orderNumber}
                              </Button>
                              <span
                                className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
                                data-testid={`text-client-name-${order.id}`}
                              >
                                {getClientName(order)}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[11px] font-semibold ${urgencyClasses}`}
                              data-testid={`badge-urgency-${order.id}`}
                            >
                              {order.urgent ? "Urgent" : "Normal"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300"
                              data-testid={`badge-delivery-type-${order.id}`}
                            >
                              {order.deliveryType === "delivery" ? "Delivery" : "Takeaway"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-[11px] font-semibold ${statusClasses.badge}`}
                              data-testid={`badge-status-${order.id}`}
                            >
                              {statusLabel}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
      </div>

      <Dialog open={selectedCard !== null} onOpenChange={() => setSelectedCard(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between" data-testid="dialog-title-orders">
              <span>{dialogTitle}</span>
              <Badge variant="outline" data-testid="badge-order-count">{selectedOrders.length} orders</Badge>
            </DialogTitle>
            <DialogDescription>View and manage orders in this category</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {selectedOrders.length === 0 ? (
              <p className="text-center text-muted-foreground py-8" data-testid="text-no-category-orders">No orders in this category</p>
            ) : (
              selectedOrders.map((order) => (
                <Card key={order.id} className="p-3" data-testid={`card-dialog-order-${order.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto p-0 font-bold text-primary hover:bg-transparent hover:text-primary"
                          onClick={() => openOrderInTracking(order)}
                          data-testid={`text-dialog-order-number-${order.id}`}
                        >
                          #{order.orderNumber}
                        </Button>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            order.delivered ? "border-green-500 text-green-600" :
                            order.packingDone ? "border-amber-500 text-amber-600" :
                            (order.tagBy || order.tagDone || order.washingDone) ? "border-blue-500 text-blue-600" :
                            "border-orange-500 text-orange-600"
                          }`}
                          data-testid={`badge-dialog-status-${order.id}`}
                        >
                          {order.delivered ? "Completed" :
                           order.packingDone ? "Ready" :
                           order.washingDone ? "Washing Done" :
                           order.tagDone ? "Tagging Done" :
                           order.tagBy ? "Tagging" :
                           "Pending"}
                        </Badge>
                        {order.urgent && <Badge className="bg-red-500 text-white text-xs" data-testid={`badge-urgent-${order.id}`}>Urgent</Badge>}
                      </div>
                      <p className="text-sm font-medium" data-testid={`text-dialog-client-${order.id}`}>{order.clientName}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span data-testid={`text-delivery-type-${order.id}`}>{order.deliveryType === "pickup" ? "Takeaway" : "Delivery"}</span>
                        {order.expectedDeliveryAt && (
                          <span className="text-blue-600 dark:text-blue-400" data-testid={`text-expected-date-${order.id}`}>
                            Expected: {format(new Date(order.expectedDeliveryAt), "dd MMM, h:mm a")}
                          </span>
                        )}
                      </div>
                    </div>
                    {!isSection && (
                      <div className="text-right shrink-0">
                        <p className="font-bold text-lg" data-testid={`text-dialog-amount-${order.id}`}>{parseFloat(order.adjustedTotal ?? order.finalAmount ?? order.totalAmount ?? "0").toFixed(0)} AED</p>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={itemBreakdownOpen} onOpenChange={setItemBreakdownOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid="heading-item-breakdown">
              <span>{itemBreakdownName}</span>
              <Badge variant="outline" data-testid="badge-item-total-qty">
                {itemBreakdownOrders.reduce((sum, o) => sum + o.quantity, 0)} total
              </Badge>
            </DialogTitle>
            <DialogDescription>Quantity per order</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {itemBreakdownOrders.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No orders found</p>
            ) : (
              itemBreakdownOrders.map((entry, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50"
                  data-testid={`item-breakdown-row-${idx}`}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto p-0 font-semibold text-sm text-primary hover:bg-transparent hover:text-primary"
                    onClick={() => openOrderInTracking({ id: entry.orderId, entryDate: entry.entryDate })}
                    data-testid={`item-breakdown-order-${idx}`}
                  >
                    #{entry.orderNumber}
                  </Button>
                  <Badge variant="secondary" data-testid={`item-breakdown-qty-${idx}`}>{entry.quantity}</Badge>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

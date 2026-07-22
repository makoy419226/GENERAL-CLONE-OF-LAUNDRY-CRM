import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Calendar, Wallet } from "lucide-react";
import type { Client } from "@shared/schema";

export default function DailySales() {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: allClients, isLoading: isLoadingClients } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allBills = [], isLoading: isLoadingBills } = useQuery<any[]>({
    queryKey: ["/api/bills"],
  });

  const { data: allBillPayments = [], isLoading: isLoadingPayments } = useQuery<any[]>({
    queryKey: ["/api/bill-payments"],
  });

  const isLoading = isLoadingClients || isLoadingBills || isLoadingPayments;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-AE', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const formatSalesDescriptionPaymentMethod = (method?: string | null) => {
    const labels: string[] = [];
    const seen = new Set<string>();

    for (const part of String(method || "")
      .split("+")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)) {
      let key = part;
      let label: string;

      switch (part) {
        case "credit":
        case "deposit":
        case "bulk_deposit":
          key = "credit";
          label = "Credit";
          break;
        case "cash":
          label = "Cash";
          break;
        case "card":
          label = "Card";
          break;
        case "bank transfer":
        case "bank":
        case "transfer":
          key = "bank";
          label = "Bank Transfer";
          break;
        default:
          label = part.toUpperCase();
          break;
      }

      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }

    return labels.join(" + ");
  };

  const extractSplitPaymentGroupFromText = (value?: string | null) => {
    if (!value) return null;
    const match = String(value).match(/\[SPLIT:([^\]]+)\]/i);
    return match?.[1] ? match[1] : null;
  };

  const extractSharedPaymentMetaFromText = (value?: string | null) => {
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

  const getDailySharedPaymentSummary = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      const sharedMeta = extractSharedPaymentMetaFromText(value);
      if (!sharedMeta) continue;
      if (sharedMeta.billCount <= 1 || sharedMeta.clientCount <= 1) continue;
      return `${sharedMeta.billCount} separate client bill shared payment`;
    }

    return null;
  };

  const getSalesPaymentRecordTime = (value?: string | Date | null) => {
    const timestamp = new Date(value || "").getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const compareSalesPaymentRecordsAsc = (left: any, right: any) => {
    const timeDelta = getSalesPaymentRecordTime(left.date || left.paymentDate) - getSalesPaymentRecordTime(right.date || right.paymentDate);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return Number(left.id || 0) - Number(right.id || 0);
  };

  const compareSalesPaymentRecordsDesc = (left: any, right: any) => compareSalesPaymentRecordsAsc(right, left);

  const buildSalesDescriptionFromSummary = (
    orderSummary: string | null | undefined,
    billId: number | null | undefined,
    paymentMethods: Array<string | null | undefined>,
  ) => {
    const paymentMethodLabel = formatSalesDescriptionPaymentMethod(paymentMethods.join("+"));
    const summaryLabel = String(orderSummary || "").trim() || `Payment for Bill #${billId || "-"}`;

    if (!paymentMethodLabel) {
      return summaryLabel;
    }

    if (/^Payment for Bill #/i.test(summaryLabel)) {
      return `${summaryLabel} | Paid with ${paymentMethodLabel}`;
    }

    return `${summaryLabel} | Bill #${billId || "-"} | Paid with ${paymentMethodLabel}`;
  };

  const buildGroupedSalesPayments = (payments: any[]) => {
    const groupedPayments = new Map<
      string,
      {
        splitGroupId: string | null;
        items: any[];
      }
    >();

    payments.forEach((payment) => {
      const splitGroupId = extractSplitPaymentGroupFromText(payment.notes);
      const groupKey = splitGroupId ? `split:${payment.billId || "none"}:${splitGroupId}` : `payment:${payment.id}`;
      const existingGroup = groupedPayments.get(groupKey);

      if (existingGroup) {
        existingGroup.items.push(payment);
        return;
      }

      groupedPayments.set(groupKey, {
        splitGroupId,
        items: [payment],
      });
    });

    return Array.from(groupedPayments.values())
      .map((group) => {
        const orderedItems = group.items.slice().sort(compareSalesPaymentRecordsAsc);
        const anchor = orderedItems[orderedItems.length - 1] || orderedItems[0];
        const totalAmount = orderedItems.reduce((sum, payment) => {
          const amount = parseFloat(String(payment.amount || "0"));
          return Number.isFinite(amount) ? sum + amount : sum;
        }, 0);
        const paymentMethods = orderedItems.map((payment) => payment.paymentMethod);

        return {
          ...anchor,
          id: group.splitGroupId ? `split-${anchor.billId || "none"}-${group.splitGroupId}` : anchor.id,
          amount: totalAmount.toFixed(2),
          paymentMethod: paymentMethods.join("+"),
          description: buildSalesDescriptionFromSummary(anchor.orderSummary, anchor.billId, paymentMethods),
        };
      })
      .sort(compareSalesPaymentRecordsDesc);
  };

  const dailyData = useMemo(() => {
    if (!allClients || !allBills || !allBillPayments) {
      return { deposits: [], totalDeposits: 0 };
    }

    const selectedDateObj = new Date(selectedDate);
    selectedDateObj.setHours(0, 0, 0, 0);

    const billById = new Map<number, any>();
    allBills.forEach((bill: any) => billById.set(bill.id, bill));

    const rawDeposits: any[] = [];

    allBillPayments.forEach((payment: any) => {
      const paymentDate = new Date(payment.paymentDate);
      paymentDate.setHours(0, 0, 0, 0);

      if (paymentDate.getTime() !== selectedDateObj.getTime()) {
        return;
      }

      const bill = billById.get(payment.billId);
      if (!bill) return;

      const client = allClients.find((entry: any) => entry.id === payment.clientId || entry.id === bill.clientId);
      if (!client) return;

      rawDeposits.push({
        id: payment.id,
        clientId: client.id,
        billId: payment.billId,
        clientName: client.name,
        clientPhone: client.phone,
        orderSummary:
          getDailySharedPaymentSummary(payment.notes) || `Payment for Bill #${payment.billId}`,
        description: buildSalesDescriptionFromSummary(
          getDailySharedPaymentSummary(payment.notes) || `Payment for Bill #${payment.billId}`,
          payment.billId,
          [payment.paymentMethod],
        ),
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        date: payment.paymentDate,
        notes: payment.notes || null,
      });
    });

    const deposits = buildGroupedSalesPayments(rawDeposits);
    const totalDeposits = rawDeposits.reduce((sum, deposit) => sum + parseFloat(deposit.amount || "0"), 0);

    return { deposits, totalDeposits };
  }, [allBillPayments, allBills, allClients, selectedDate]);

  const getSalesDescription = (deposit: any) => deposit.description || "-";

  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 z-30 w-full bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
        <div className="h-20 px-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            Daily Sales Report
          </h1>
          <div className="flex items-center gap-3">
            <Label htmlFor="date" className="text-sm font-medium">Select Date:</Label>
            <Input
              id="date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-44"
              data-testid="input-date"
            />
          </div>
        </div>
      </div>

      <main className="flex-1 container mx-auto px-4 py-6 overflow-auto">
        <div className="mb-4 p-4 bg-primary/5 rounded-lg border">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg">{formatDate(selectedDate)}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-green-600">
                  <Wallet className="w-5 h-5" />
                  Total Sales ({dailyData.deposits.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dailyData.deposits.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No sales collected for this date</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-center">Method</TableHead>
                        <TableHead className="text-right">Amount Paid</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyData.deposits.map((deposit, index) => {
                        const client = allClients?.find((c: Client) => c.id === deposit.clientId);
                        const accountLabel = client?.billNumber ? ` (${client.billNumber})` : '';
                        const methodLabel = formatSalesDescriptionPaymentMethod(deposit.paymentMethod);
                        return (
                          <TableRow key={index} data-testid={`row-deposit-${index}`}>
                            <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                            <TableCell>
                              <div className="font-medium">{deposit.clientName}{accountLabel}</div>
                            </TableCell>
                            <TableCell className="text-xs">{getSalesDescription(deposit)}</TableCell>
                            <TableCell className="text-center text-xs">{methodLabel}</TableCell>
                            <TableCell className="text-right font-semibold text-green-600">
                              {parseFloat(deposit.amount).toFixed(2)} AED
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={4} className="text-right">Total Collected:</TableCell>
                        <TableCell className="text-right text-green-600">{dailyData.totalDeposits.toFixed(2)} AED</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

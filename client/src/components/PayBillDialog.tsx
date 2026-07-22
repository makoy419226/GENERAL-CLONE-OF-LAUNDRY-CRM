import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  Building2,
  CreditCard,
  Key,
  Loader2,
  Package,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBills } from "@/hooks/use-bills";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, extractApiErrorMessage, queryClient } from "@/lib/queryClient";
import type { Bill, Client } from "@shared/schema";

const MONEY_EPSILON = 0.009;

type PaymentMethod = "cash" | "card" | "bank" | "deposit";
type PaymentScope = "single" | "all";

type PayBillDialogProps = {
  bill: Bill | null;
  client?: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaymentComplete?: () => void;
  requirePin?: boolean;
  initialVerifiedCashier?: {
    name: string;
    pin: string;
    role?: string | null;
  } | null;
};

const BASE_PAYMENT_METHOD_OPTIONS = [
  { value: "cash" as const, label: "Cash", Icon: Banknote },
  { value: "card" as const, label: "Card", Icon: CreditCard },
  { value: "bank" as const, label: "Bank Transfer", Icon: Building2 },
];

const DEPOSIT_PAYMENT_METHOD_OPTION = {
  value: "deposit" as const,
  label: "Account Credit",
  Icon: Wallet,
};

const buildSplitPaymentGroupId = () =>
  `SP-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

const appendSplitPaymentTag = (notes: string | undefined, groupId: string) => {
  const trimmedNotes = String(notes || "").trim();
  const tag = `[SPLIT:${groupId}]`;
  return trimmedNotes ? `${trimmedNotes} ${tag}` : tag;
};

const parseMoney = (value: unknown) => {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const getBillDisplayAmounts = (bill: Bill) => {
  const finalAmount = parseMoney(bill.amount);
  const paidAmount = parseMoney(bill.paidAmount);
  const discount = parseMoney(bill.discountAmount);
  const deliveryCharge = parseMoney((bill as any).deliveryCharge);
  const originalRaw = parseFloat(String((bill as any).originalAmount ?? ""));
  const originalAmount =
    Number.isFinite(originalRaw) && String((bill as any).originalAmount ?? "").trim()
      ? Math.max(0, originalRaw)
      : Math.max(0, finalAmount + discount - deliveryCharge);

  return {
    originalAmount,
    discount,
    deliveryCharge,
    finalAmount,
    paidAmount,
    due: Math.max(0, finalAmount - paidAmount),
  };
};

const isBillOutstanding = (bill?: Bill | null) =>
  Boolean(bill && !bill.isPaid && getBillDisplayAmounts(bill).due > MONEY_EPSILON);

const formatBillDate = (value: unknown) => {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "-" : format(date, "dd/MM/yy");
};

const isAdminOrCounterRole = (role?: string | null) => {
  const normalizedRole = String(role || "").toLowerCase();
  return (
    normalizedRole === "admin" ||
    normalizedRole === "counter" ||
    normalizedRole === "reception"
  );
};

const formatPaymentMethodLabel = (method?: string | null) => {
  switch (String(method || "").toLowerCase()) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "bank":
    case "transfer":
      return "Bank Transfer";
    case "deposit":
      return "Account Credit";
    default:
      return String(method || "").toUpperCase() || "-";
  }
};

export function PayBillDialog({
  bill,
  client,
  open,
  onOpenChange,
  onPaymentComplete,
  requirePin = true,
  initialVerifiedCashier = null,
}: PayBillDialogProps) {
  const { toast } = useToast();
  const [cashierPin, setCashierPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [isPinVerifying, setIsPinVerifying] = useState(false);
  const [verifiedCashier, setVerifiedCashier] = useState<string | null>(null);
  const [verifiedCashierPin, setVerifiedCashierPin] = useState<string | null>(null);
  const [verifiedCashierRole, setVerifiedCashierRole] = useState<string | null>(null);
  const [paymentScope, setPaymentScope] = useState<PaymentScope | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [splitPaymentEnabled, setSplitPaymentEnabled] = useState(false);
  const [splitPaymentAmount, setSplitPaymentAmount] = useState("");
  const [remainingPaymentMethod, setRemainingPaymentMethod] =
    useState<PaymentMethod>("card");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const discountInputRef = useRef<HTMLInputElement | null>(null);

  const shouldShowPinDialog = open && requirePin && !verifiedCashier;
  const shouldShowPaymentDialog = open && (!requirePin || !!verifiedCashier);
  const { data: accountBills } = useBills({
    enabled: shouldShowPaymentDialog && Boolean(bill?.clientId),
  });

  const displayAmounts = useMemo(
    () => (bill ? getBillDisplayAmounts(bill) : null),
    [bill],
  );
  const accountOutstandingBills = useMemo(() => {
    if (!bill?.clientId) return [];

    const byId = new Map<number, Bill>();
    for (const accountBill of accountBills || []) {
      if (accountBill.clientId === bill.clientId && isBillOutstanding(accountBill)) {
        byId.set(accountBill.id, accountBill);
      }
    }
    if (isBillOutstanding(bill)) {
      byId.set(bill.id, bill);
    }

    return Array.from(byId.values()).sort((a, b) => {
      const dateA = new Date(String(a.billDate || "")).getTime();
      const dateB = new Date(String(b.billDate || "")).getTime();
      const safeDateA = Number.isNaN(dateA) ? 0 : dateA;
      const safeDateB = Number.isNaN(dateB) ? 0 : dateB;
      if (safeDateA !== safeDateB) return safeDateA - safeDateB;
      return a.id - b.id;
    });
  }, [accountBills, bill]);
  const otherUnpaidBills = useMemo(
    () => accountOutstandingBills.filter((accountBill) => accountBill.id !== bill?.id),
    [accountOutstandingBills, bill?.id],
  );
  const allUnpaidBillsDue = useMemo(
    () =>
      accountOutstandingBills.reduce(
        (sum, accountBill) => sum + getBillDisplayAmounts(accountBill).due,
        0,
      ),
    [accountOutstandingBills],
  );
  const hasOtherUnpaidBills = otherUnpaidBills.length > 0;
  const isPayingAllBills = paymentScope === "all";
  const activeClientDeposit = parseMoney(client?.deposit);
  const canUseDepositPayment = Boolean(bill?.clientId && activeClientDeposit > 0.01);
  const paymentMethodOptions = useMemo(
    () =>
      canUseDepositPayment
        ? [...BASE_PAYMENT_METHOD_OPTIONS, DEPOSIT_PAYMENT_METHOD_OPTION]
        : BASE_PAYMENT_METHOD_OPTIONS,
    [canUseDepositPayment],
  );
  const splitPaymentMethodOptions = useMemo(
    () =>
      paymentMethodOptions.filter((option) => option.value !== paymentMethod),
    [paymentMethod, paymentMethodOptions],
  );

  const requestedPaymentAmount = parseFloat(paymentAmount || "0");
  const normalizedRequestedPaymentAmount = Number.isFinite(requestedPaymentAmount)
    ? Math.max(0, requestedPaymentAmount)
    : 0;
  const requestedDiscountAmount = parseFloat(discountAmount || "0");
  const normalizedRequestedDiscountAmount =
    applyDiscount && Number.isFinite(requestedDiscountAmount)
      ? Math.max(0, requestedDiscountAmount)
      : 0;
  const requestedSplitPaymentAmount = parseFloat(splitPaymentAmount || "0");
  const normalizedSplitPaymentAmount = Number.isFinite(requestedSplitPaymentAmount)
    ? Math.max(0, requestedSplitPaymentAmount)
    : 0;
  const splitRemainingAmount = splitPaymentEnabled
    ? Math.max(0, normalizedRequestedPaymentAmount - normalizedSplitPaymentAmount)
    : 0;
  const hasActiveSplitPayment =
    !isPayingAllBills &&
    splitPaymentEnabled &&
    normalizedSplitPaymentAmount > MONEY_EPSILON &&
    splitRemainingAmount > MONEY_EPSILON;
  const currentBillDueAfterDiscount = displayAmounts
    ? applyDiscount && !isPayingAllBills
      ? Math.max(
          0,
          displayAmounts.originalAmount -
            normalizedRequestedDiscountAmount -
            displayAmounts.paidAmount,
        )
      : displayAmounts.due
    : 0;
  const expectedDueAfterDiscount = isPayingAllBills
    ? allUnpaidBillsDue
    : currentBillDueAfterDiscount;
  const showPartialPaymentNotice =
    normalizedRequestedPaymentAmount > MONEY_EPSILON &&
    expectedDueAfterDiscount > MONEY_EPSILON &&
    normalizedRequestedPaymentAmount < expectedDueAfterDiscount - MONEY_EPSILON;
  const overpaymentAmount =
    bill?.clientId && paymentMethod !== "deposit"
      ? Math.max(0, normalizedRequestedPaymentAmount - expectedDueAfterDiscount)
      : 0;

  const resetLocalState = () => {
    setCashierPin("");
    setPinError("");
    setIsPinVerifying(false);
    setVerifiedCashier(null);
    setVerifiedCashierPin(null);
    setVerifiedCashierRole(null);
    setPaymentScope(null);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("card");
    setPaymentNotes("");
    setApplyDiscount(false);
    setDiscountAmount("");
    setIsProcessing(false);
  };

  const closeDialog = () => {
    resetLocalState();
    onOpenChange(false);
  };

  const chooseSingleBillPayment = () => {
    setPaymentScope("single");
    setPaymentAmount((displayAmounts?.due || 0).toFixed(2));
  };

  const chooseAllUnpaidBillsPayment = () => {
    setPaymentScope("all");
    setPaymentAmount(allUnpaidBillsDue.toFixed(2));
    setApplyDiscount(false);
    setDiscountAmount("");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("card");
  };

  useEffect(() => {
    if (!open || !bill || !displayAmounts) return;
    setPaymentScope(null);
    setPaymentAmount(displayAmounts.due.toFixed(2));
    setPaymentMethod("cash");
    setSplitPaymentEnabled(false);
    setSplitPaymentAmount("");
    setRemainingPaymentMethod("card");
    setPaymentNotes("");
    setApplyDiscount(false);
    setDiscountAmount("");
    if (initialVerifiedCashier) {
      setVerifiedCashier(initialVerifiedCashier.name || "Staff");
      setVerifiedCashierPin(initialVerifiedCashier.pin || null);
      setVerifiedCashierRole(initialVerifiedCashier.role || null);
    } else if (!requirePin) {
      setVerifiedCashier(localStorage.getItem("username") || "Staff");
      setVerifiedCashierPin(null);
      setVerifiedCashierRole(null);
    }
  }, [
    bill?.id,
    displayAmounts?.due,
    initialVerifiedCashier?.name,
    initialVerifiedCashier?.pin,
    initialVerifiedCashier?.role,
    open,
    requirePin,
  ]);

  useEffect(() => {
    if (!canUseDepositPayment && paymentMethod === "deposit") {
      setPaymentMethod("cash");
    }
  }, [canUseDepositPayment, paymentMethod]);

  useEffect(() => {
    if (!splitPaymentMethodOptions.some((option) => option.value === remainingPaymentMethod)) {
      setRemainingPaymentMethod(splitPaymentMethodOptions[0]?.value || "cash");
    }
  }, [remainingPaymentMethod, splitPaymentMethodOptions]);

  const invalidatePaymentQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/bill-payments"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/client-transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/reports/credit-transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-count"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/orders/tracking-selection"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/daily-sales"] }),
    ]);
  };

  const verifyCashierPin = async () => {
    const normalizedPin = cashierPin.replace(/\D/g, "").slice(0, 5);
    if (normalizedPin.length !== 5) {
      setPinError("PIN must be 5 digits.");
      return;
    }

    setIsPinVerifying(true);
    setPinError("");

    try {
      const response = await apiRequest("POST", "/api/workers/verify-pin", {
        pin: normalizedPin,
      });
      const data = await response.json();
      setVerifiedCashier(data.worker?.name || "Staff");
      setVerifiedCashierPin(normalizedPin);
      setVerifiedCashierRole(data.worker?.role || null);
      setCashierPin("");
    } catch {
      setPinError("Invalid PIN. Please try again.");
    } finally {
      setIsPinVerifying(false);
    }
  };

  const applyBillDiscount = async () => {
    if (!bill || normalizedRequestedDiscountAmount <= MONEY_EPSILON) return;

    await apiRequest("POST", `/api/bills/${bill.id}/apply-discount`, {
      discountAmount: normalizedRequestedDiscountAmount.toFixed(2),
      appliedBy: verifiedCashier || localStorage.getItem("username") || undefined,
      staffPin: verifiedCashierPin || undefined,
    });
  };

  const requestBillPayment = async (
    amount: number,
    method: PaymentMethod,
    notes?: string,
  ) => {
    if (!bill) return;
    const response = await apiRequest("POST", `/api/bills/${bill.id}/pay`, {
      amount: amount.toFixed(2),
      paymentMethod: method,
      notes,
      processedBy: verifiedCashier || localStorage.getItem("username") || undefined,
      staffPin: verifiedCashierPin || undefined,
    });
    return response.json();
  };

  const requestClientBulkPayment = async (
    amount: number,
    method: PaymentMethod,
    notes?: string,
  ) => {
    if (!bill?.clientId) return;
    const billIds = accountOutstandingBills.map((accountBill) => accountBill.id);
    const response = await apiRequest("POST", `/api/clients/${bill.clientId}/pay-all-bills`, {
      amount: amount.toFixed(2),
      paymentMethod: method,
      notes,
      processedBy: verifiedCashier || localStorage.getItem("username") || undefined,
      billIds,
      staffPin: verifiedCashierPin || undefined,
    });
    return response.json();
  };

  const handleProcessPayment = async () => {
    if (!bill || !displayAmounts) return;

    const hasValidPayment = normalizedRequestedPaymentAmount > MONEY_EPSILON;
    const hasValidDiscount =
      !isPayingAllBills && applyDiscount && normalizedRequestedDiscountAmount > MONEY_EPSILON;

    if (!hasValidPayment && !hasValidDiscount) {
      toast({
        title: "Error",
        description: "Please enter a valid payment or discount amount.",
        variant: "destructive",
      });
      return;
    }

    if (isPayingAllBills && (!bill.clientId || accountOutstandingBills.length === 0)) {
      toast({
        title: "No Unpaid Bills",
        description: "No unpaid bills were found for this account.",
        variant: "destructive",
      });
      return;
    }

    if (hasValidDiscount && (!verifiedCashierPin || !isAdminOrCounterRole(verifiedCashierRole))) {
      toast({
        title: "Discount PIN Required",
        description: "Discounts can only be applied with an admin or counter PIN.",
        variant: "destructive",
      });
      return;
    }

    if (hasValidDiscount && normalizedRequestedDiscountAmount > displayAmounts.originalAmount + MONEY_EPSILON) {
      toast({
        title: "Invalid Discount",
        description: `Discount cannot exceed bill amount (${displayAmounts.originalAmount.toFixed(2)} AED).`,
        variant: "destructive",
      });
      return;
    }

    if (
      hasValidPayment &&
      !splitPaymentEnabled &&
      paymentMethod === "deposit" &&
      normalizedRequestedPaymentAmount > activeClientDeposit + MONEY_EPSILON
    ) {
      toast({
        title: "Credit Not Enough",
        description: `Available credit is ${activeClientDeposit.toFixed(2)} AED. Add another payment method or reduce the credit amount.`,
        variant: "destructive",
      });
      return;
    }

    if (
      hasValidPayment &&
      !splitPaymentEnabled &&
      paymentMethod === "deposit" &&
      normalizedRequestedPaymentAmount > expectedDueAfterDiscount + MONEY_EPSILON
    ) {
      toast({
        title: "Credit Payment Too High",
        description: `Account credit payment cannot exceed ${expectedDueAfterDiscount.toFixed(2)} AED.`,
        variant: "destructive",
      });
      return;
    }

    if (hasValidPayment && !isPayingAllBills && splitPaymentEnabled) {
      if (!Number.isFinite(normalizedSplitPaymentAmount) || normalizedSplitPaymentAmount <= 0) {
        toast({
          title: "Invalid Split Amount",
          description: `Enter a valid amount for ${formatPaymentMethodLabel(paymentMethod)}.`,
          variant: "destructive",
        });
        return;
      }

      if (normalizedSplitPaymentAmount >= normalizedRequestedPaymentAmount - MONEY_EPSILON) {
        toast({
          title: "Second Payment Needed",
          description:
            "Enter a smaller first payment amount so the second payment method can cover the remaining balance.",
          variant: "destructive",
        });
        return;
      }

      if (
        paymentMethod === "deposit" &&
        normalizedSplitPaymentAmount > activeClientDeposit + MONEY_EPSILON
      ) {
        toast({
          title: "Credit Not Enough",
          description: `Available credit is ${activeClientDeposit.toFixed(2)} AED. Reduce the credit amount or choose another split.`,
          variant: "destructive",
        });
        return;
      }

      if (
        remainingPaymentMethod === "deposit" &&
        splitRemainingAmount > activeClientDeposit + MONEY_EPSILON
      ) {
        toast({
          title: "Credit Not Enough",
          description: `Remaining credit available is ${activeClientDeposit.toFixed(2)} AED. Reduce the remaining credit amount or choose another method.`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsProcessing(true);
    try {
      if (hasValidDiscount) {
        await applyBillDiscount();
      }

      if (hasValidPayment && isPayingAllBills) {
        await requestClientBulkPayment(
          normalizedRequestedPaymentAmount,
          paymentMethod,
          paymentNotes || `Payment for unpaid bills: ${accountOutstandingBills.map((accountBill) => `#${accountBill.id}`).join(", ")}`,
        );
      } else if (hasValidPayment && hasActiveSplitPayment) {
        const splitGroupId = buildSplitPaymentGroupId();
        await requestBillPayment(
          normalizedSplitPaymentAmount,
          paymentMethod,
          appendSplitPaymentTag(paymentNotes, splitGroupId),
        );
        await requestBillPayment(
          splitRemainingAmount,
          remainingPaymentMethod,
          appendSplitPaymentTag(paymentNotes, splitGroupId),
        );
      } else if (hasValidPayment) {
        await requestBillPayment(
          normalizedRequestedPaymentAmount,
          paymentMethod,
          paymentNotes,
        );
      }

      await invalidatePaymentQueries();
      toast({
        title: hasValidPayment ? "Payment Successful" : "Discount Applied",
        description: hasValidPayment
          ? isPayingAllBills
            ? `${accountOutstandingBills.length} unpaid bill(s) have been paid successfully.`
            : "Bill has been paid successfully."
          : "Bill discount updated successfully.",
      });
      onPaymentComplete?.();
      closeDialog();
    } catch (error) {
      toast({
        title: "Payment Failed",
        description: extractApiErrorMessage(error, "Failed to process payment."),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!bill) {
    return null;
  }

  const renderBillDueRow = (rowBill: Bill, label?: string) => {
    const amounts = getBillDisplayAmounts(rowBill);
    return (
      <div
        key={rowBill.id}
        className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">
            {label ? `${label}: ` : ""}Bill #{rowBill.id}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatBillDate(rowBill.billDate)}
          </p>
        </div>
        <span className="shrink-0 font-semibold text-destructive">
          {amounts.due.toFixed(2)} AED
        </span>
      </div>
    );
  };

  return (
    <>
      {shouldShowPinDialog && (
        <Dialog
          open={shouldShowPinDialog}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeDialog();
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Verify Cashier PIN
              </DialogTitle>
              <DialogDescription>
                Enter staff PIN before opening the bill payment modal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="pay-bill-cashier-pin">Staff PIN</Label>
                <Input
                  id="pay-bill-cashier-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={5}
                  value={cashierPin}
                  onChange={(event) => {
                    setCashierPin(event.target.value.replace(/\D/g, "").slice(0, 5));
                    setPinError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void verifyCashierPin();
                    }
                  }}
                  autoFocus
                  placeholder="Enter 5-digit PIN"
                  className="text-center text-lg tracking-widest"
                  data-testid="input-pay-bill-cashier-pin"
                />
                {pinError && <p className="mt-1 text-xs text-destructive">{pinError}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => void verifyCashierPin()}
                  disabled={isPinVerifying || cashierPin.length !== 5}
                  data-testid="button-verify-pay-bill-pin"
                >
                  {isPinVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {shouldShowPaymentDialog && (
      <Dialog
        open={shouldShowPaymentDialog}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeDialog();
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {isPayingAllBills ? "Pay All Unpaid Bills" : "Pay Bill"}
            </DialogTitle>
            <DialogDescription>
              {hasOtherUnpaidBills && paymentScope === null
                ? "Choose whether to pay only this bill or every unpaid bill on the account."
                : isPayingAllBills
                  ? `Process payment for ${accountOutstandingBills.length} unpaid bill(s).`
                  : `Process payment for ${bill.referenceNumber || `Bill #${bill.id}`}`}
            </DialogDescription>
          </DialogHeader>

          {displayAmounts && (
            <div className="space-y-4">
              {hasOtherUnpaidBills && paymentScope === null ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          There is another unpaid bill attached to this account.
                        </p>
                        <p className="text-xs">
                          Would you like to pay this bill only or all unpaid bills?
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      This Bill
                    </p>
                    {renderBillDueRow(bill, "Current")}
                    <div className="pt-2">
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        Other Unpaid Bills ({otherUnpaidBills.length})
                      </p>
                      <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                        {otherUnpaidBills.map((unpaidBill) => renderBillDueRow(unpaidBill))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t pt-2 text-sm">
                      <span className="font-semibold">All Unpaid Total</span>
                      <span className="font-bold text-primary">
                        {allUnpaidBillsDue.toFixed(2)} AED
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      onClick={chooseSingleBillPayment}
                      data-testid="button-pay-this-bill-only"
                    >
                      <span>Pay This Bill Only</span>
                      <span className="font-bold text-primary">
                        {displayAmounts.due.toFixed(2)} AED
                      </span>
                    </Button>
                    <Button
                      className="w-full justify-between"
                      onClick={chooseAllUnpaidBillsPayment}
                      data-testid="button-pay-all-unpaid-bills"
                    >
                      <span>Pay All Unpaid Bills ({accountOutstandingBills.length})</span>
                      <span className="font-bold">
                        {allUnpaidBillsDue.toFixed(2)} AED
                      </span>
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={closeDialog}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
              <div>
                <Label htmlFor="pay-bill-amount">Payment Amount</Label>
                <Input
                  id="pay-bill-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder="Enter amount"
                  data-testid="input-pay-bill-amount"
                />
                {isPayingAllBills ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bills: {accountOutstandingBills.length} | Remaining: AED{" "}
                    {allUnpaidBillsDue.toFixed(2)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Work Received: AED {displayAmounts.originalAmount.toFixed(2)} | Final:
                    AED {displayAmounts.finalAmount.toFixed(2)} | Discount: AED{" "}
                    {displayAmounts.discount > 0
                      ? `-${displayAmounts.discount.toFixed(2)}`
                      : "0.00"}{" "}
                    {displayAmounts.deliveryCharge > 0
                      ? `| Delivery: AED +${displayAmounts.deliveryCharge.toFixed(2)} `
                      : ""}
                    | Paid: AED {displayAmounts.paidAmount.toFixed(2)} | Remaining:
                    AED {displayAmounts.due.toFixed(2)}
                  </p>
                )}
                {showPartialPaymentNotice && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-semibold">Partial payment notice</p>
                        <p>
                          {isPayingAllBills
                            ? "Some unpaid balance may remain because the given amount is lower than the account total."
                            : "This bill will be marked partially paid because the given amount is lower than the current bill amount."}
                        </p>
                        <p className="mt-1 font-medium">
                          Remaining after payment:{" "}
                          {Math.max(0, expectedDueAfterDiscount - normalizedRequestedPaymentAmount).toFixed(2)}{" "}
                          AED
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {isPayingAllBills && (
                <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">Bills Included</span>
                    <span className="font-bold text-primary">
                      {allUnpaidBillsDue.toFixed(2)} AED
                    </span>
                  </div>
                  <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                    {accountOutstandingBills.map((accountBill) =>
                      renderBillDueRow(accountBill, accountBill.id === bill.id ? "Current" : undefined),
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPaymentScope(null)}
                  >
                    Change payment choice
                  </Button>
                </div>
              )}

              {hasOtherUnpaidBills && paymentScope === "single" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  Paying Bill #{bill.id} only. {otherUnpaidBills.length} other unpaid bill(s)
                  will remain on this account.
                </div>
              )}

              {canUseDepositPayment && (
                <>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/30">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                      Customer has AED {activeClientDeposit.toFixed(2)} account
                      credit balance available
                    </p>
                  </div>
                  {paymentMethod !== "deposit" &&
                    (!splitPaymentEnabled || remainingPaymentMethod !== "deposit") && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                          Reminder: Customer still has account credit balance.
                          Consider using "Account Credit" instead.
                        </p>
                      </div>
                    )}
                </>
              )}

              {!isPayingAllBills && displayAmounts.discount <= MONEY_EPSILON && (
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/50 p-3 dark:border-orange-800 dark:bg-orange-950/20">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="shared-pay-bill-apply-discount"
                      checked={applyDiscount}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setApplyDiscount(checked);
                        if (checked) {
                          requestAnimationFrame(() => {
                            discountInputRef.current?.focus();
                            discountInputRef.current?.select();
                          });
                        } else {
                          setDiscountAmount("");
                          setPaymentAmount(displayAmounts.due.toFixed(2));
                        }
                      }}
                      className="rounded"
                      data-testid="toggle-pay-bill-discount"
                    />
                    <Label
                      htmlFor="shared-pay-bill-apply-discount"
                      className="cursor-pointer text-sm font-medium text-orange-700 dark:text-orange-400"
                    >
                      Apply Discount
                    </Label>
                  </div>
                  {applyDiscount && (
                    <div>
                      <Label className="text-xs">Discount Amount (AED)</Label>
                      <Input
                        ref={discountInputRef}
                        type="number"
                        step="0.01"
                        min="0"
                        value={discountAmount}
                        onChange={(event) => {
                          setDiscountAmount(event.target.value);
                          const discount = parseMoney(event.target.value);
                          const newAmount = Math.max(
                            0,
                            displayAmounts.originalAmount - discount,
                          );
                          setPaymentAmount(
                            Math.max(0, newAmount - displayAmounts.paidAmount).toFixed(2),
                          );
                        }}
                        placeholder="0.00"
                        data-testid="input-pay-bill-discount"
                      />
                      {discountAmount && parseFloat(discountAmount) > 0 && (
                        <p className="mt-1 text-xs text-orange-600">
                          New bill total:{" "}
                          {Math.max(
                            0,
                            displayAmounts.originalAmount - parseFloat(discountAmount),
                          ).toFixed(2)}{" "}
                          AED
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label>Payment Method</Label>
                <div
                  className="mt-2 grid grid-cols-2 gap-2"
                  role="radiogroup"
                  aria-label="Payment Method"
                  data-testid="select-pay-bill-method"
                >
                  {paymentMethodOptions.map(({ value, label, Icon }) => {
                    const isSelected = paymentMethod === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        className="h-auto justify-start gap-2 px-3 py-2 text-left whitespace-normal"
                        onClick={() => setPaymentMethod(value)}
                        aria-pressed={isSelected}
                        data-testid={`button-pay-bill-method-${value}`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-sm leading-tight">{label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {!isPayingAllBills && (
              <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="shared-pay-bill-split"
                    checked={splitPaymentEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setSplitPaymentEnabled(enabled);
                      if (enabled) {
                        setSplitPaymentAmount(
                          normalizedRequestedPaymentAmount > 0
                            ? Math.min(
                                normalizedRequestedPaymentAmount,
                                paymentMethod === "deposit"
                                  ? activeClientDeposit
                                  : normalizedRequestedPaymentAmount,
                              ).toFixed(2)
                            : "",
                        );
                        setRemainingPaymentMethod(splitPaymentMethodOptions[0]?.value || "cash");
                      } else {
                        setSplitPaymentAmount("");
                      }
                    }}
                    className="rounded"
                    data-testid="toggle-pay-bill-split"
                  />
                  <Label
                    htmlFor="shared-pay-bill-split"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Add another payment method
                  </Label>
                </div>

                {splitPaymentEnabled && (
                  <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                    <div>
                      <Label className="text-xs">
                        Amount to pay with {formatPaymentMethodLabel(paymentMethod)}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={splitPaymentAmount}
                        onChange={(event) => setSplitPaymentAmount(event.target.value)}
                        placeholder="0.00"
                        data-testid="input-pay-bill-split-amount"
                      />
                      {paymentMethod === "deposit" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Available credit: {activeClientDeposit.toFixed(2)} AED
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Second Payment Method</Label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {splitPaymentMethodOptions.map(({ value, label, Icon }) => {
                          const isSelected = remainingPaymentMethod === value;
                          return (
                            <Button
                              key={`split-${value}`}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              className="h-auto justify-start gap-2 px-3 py-2 text-left whitespace-normal"
                              onClick={() => setRemainingPaymentMethod(value)}
                              aria-pressed={isSelected}
                              data-testid={`button-pay-bill-remaining-method-${value}`}
                            >
                              <Icon className="h-4 w-4 shrink-0" />
                              <span className="text-sm leading-tight">{label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background/80 px-3 py-2 text-sm">
                      Remaining for {formatPaymentMethodLabel(remainingPaymentMethod)}:{" "}
                      <strong>{splitRemainingAmount.toFixed(2)} AED</strong>
                    </div>
                  </div>
                )}
              </div>
              )}

              {overpaymentAmount > 0.01 && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                  <p className="text-xs text-sky-700 dark:text-sky-300">
                    This payment leaves an extra {overpaymentAmount.toFixed(2)} AED
                    after this bill is fully paid. It will be added to the
                    customer account credit.
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="pay-bill-notes">Notes (Optional)</Label>
                <Input
                  id="pay-bill-notes"
                  value={paymentNotes}
                  onChange={(event) => setPaymentNotes(event.target.value)}
                  placeholder="Payment notes"
                  data-testid="input-pay-bill-notes"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleProcessPayment()}
                  disabled={isProcessing}
                  data-testid="button-pay-bill-now"
                >
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isProcessing ? "Processing..." : isPayingAllBills ? "Pay All Now" : "Pay Now"}
                </Button>
              </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      )}
    </>
  );
}

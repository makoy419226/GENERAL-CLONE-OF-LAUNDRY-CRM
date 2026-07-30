import { useRef, useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Printer, X, Edit, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCompanyPhoneLine, getCompanyAddressLines, getWorkspaceLogoUrl, useCompanyContactInfo } from "@/lib/companyContact";
import type { Order, Client, Product } from "@shared/schema";
import logoImage from "@/assets/images/lwl-logo.png";

interface OrderReceiptProps {
  order: Order;
  client?: Client;
  onClose?: () => void;
  embedded?: boolean;
}

export function OrderReceipt({ order, client, onClose, embedded }: OrderReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [logoBase64, setLogoBase64] = useState<string>("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustPin, setAdjustPin] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const { toast } = useToast();
  const { companyContact } = useCompanyContactInfo();
  const workspaceLogoUrl = getWorkspaceLogoUrl(logoImage);
  const companyAddressLines = getCompanyAddressLines(companyContact);
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handleAdjustPrice = async () => {
    if (adjustPin.length !== 5) {
      setAdjustError("PIN must be 5 digits");
      return;
    }
    if (!adjustValue || parseFloat(adjustValue) < 0) {
      setAdjustError("Please enter a valid price");
      return;
    }
    if (!adjustReason.trim()) {
      setAdjustError("Please enter a reason for the price change");
      return;
    }
    setAdjusting(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/adjust-total`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustedTotal: adjustValue,
          reason: adjustReason.trim(),
          staffPin: adjustPin,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setAdjustError(data.message || "Failed to adjust price");
        return;
      }
      toast({
        title: "Price Adjusted",
        description: `Order total updated to AED ${parseFloat(adjustValue).toFixed(2)}`,
      });
      setAdjustOpen(false);
      setAdjustValue("");
      setAdjustReason("");
      setAdjustPin("");
      setAdjustError("");
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    } catch {
      setAdjustError("Failed to adjust price");
    } finally {
      setAdjusting(false);
    }
  };

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setLogoBase64(canvas.toDataURL("image/png"));
      }
    };
    img.src = workspaceLogoUrl;

  }, [workspaceLogoUrl]);

  const parsedItems = useMemo(() => {
    if (!order.items) return [];
    const itemParts = order.items.split(",").map(s => s.trim());
    return itemParts.map(part => {
      const match = part.match(/^(\d+)x\s+(.+)$/i);
      if (match) {
        const qty = parseInt(match[1]);
        const name = match[2].trim();
        // Extract base product name (remove variations like "(folding)", "(hanging)")
        const baseName = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
        // Try exact match first, then base name match
        let product = products?.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!product) {
          product = products?.find(p => p.name.toLowerCase() === baseName.toLowerCase());
        }
        const price = product ? parseFloat(product.price || "0") : 0;
        return { name, qty, price, total: qty * price };
      }
      return { name: part, qty: 1, price: 0, total: 0 };
    });
  }, [order.items, products]);

  const handlePrint = () => {
    if (receiptRef.current) {
      const printContent = receiptRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=800,height=600");
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>${order.orderNumber}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              @page { 
                size: A4; 
                margin: 15mm; 
              }
              body { 
                font-family: Arial, sans-serif; 
                padding: 20mm; 
                background: white; 
                color: #000;
                max-width: 210mm;
                margin: 0 auto;
                font-size: 14px;
              }
              .receipt-container { width: 100%; }
              .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid ${order.urgent ? "#dc2626" : "#000"}; padding-bottom: 12px; }
              .logo { width: 100px; height: 100px; margin: 0 auto 8px; }
              .logo img { width: 100%; height: 100%; object-fit: contain; }
              .company-info { text-align: center; }
              .company-name { font-size: 22px; font-weight: bold; color: ${order.urgent ? "#dc2626" : "#000"}; margin-bottom: 5px; }
              .company-address { font-size: 13px; color: #333; line-height: 1.5; }
              .receipt-title { font-size: 18px; font-weight: bold; text-align: center; margin: 15px 0; color: ${order.urgent ? "#dc2626" : "#000"}; }
              .service-type-banner { text-align: center; padding: 10px; margin: 10px 0; font-weight: bold; font-size: 16px; border: 2px solid ${order.urgent ? "#dc2626" : "#1e40af"}; }
              .info-row { margin-bottom: 10px; font-size: 14px; display: flex; justify-content: space-between; }
              .info-section { margin-bottom: 5px; }
              .info-label { font-size: 12px; color: #666; }
              .info-value { font-size: 15px; font-weight: bold; }
              .order-number { font-size: 20px; font-weight: bold; color: ${order.urgent ? "#dc2626" : "#000"}; text-align: center; margin: 15px 0; padding: 10px; border: 2px dashed #000; }
              .items-section { margin: 15px 0; }
              .items-title { font-weight: bold; margin-bottom: 8px; font-size: 16px; }
              .items-table { width: 100%; border-collapse: collapse; font-size: 14px; border: 1px solid #000; }
              .items-table th, .items-table td { padding: 8px 6px; text-align: left; border: 1px solid #000; }
              .items-table th { font-weight: bold; font-size: 13px; text-transform: uppercase; background: #f0f0f0; }
              .items-table .qty-col { text-align: center; width: 60px; }
              .items-table .price-col { text-align: right; width: 80px; }
              .items-table .total-col { text-align: right; width: 90px; font-weight: bold; }
              .status-section { margin: 15px 0; font-size: 14px; }
              .status-row { display: flex; justify-content: space-between; padding: 4px 0; }
              .status-done { font-weight: bold; }
              .status-pending { color: #dc2626; }
              .totals { margin-top: 15px; padding-top: 10px; border-top: 2px solid #000; font-size: 15px; }
              .total-row { display: flex; justify-content: space-between; padding: 4px 0; }
              .total-row.grand-total { font-size: 20px; font-weight: bold; color: ${order.urgent ? "#dc2626" : "#000"}; border-top: 3px solid ${order.urgent ? "#dc2626" : "#000"}; margin-top: 8px; padding-top: 8px; }
              .footer { margin-top: 20px; text-align: center; padding-top: 12px; border-top: 1px solid #000; }
              .footer p { font-size: 12px; color: #666; }
              .delivery-badge { display: inline-block; padding: 4px 10px; font-size: 13px; margin-top: 8px; border: 1px solid #000; }
              .delivery-type { background: #eee; }
              .urgent-badge { background: #dc2626; color: white; border-color: #dc2626; margin-left: 6px; }
              @media print { 
                body { padding: 15mm; max-width: 210mm; } 
                .no-print { display: none; } 
              }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
        }, 250);
      }
    }
  };

  const getStatusText = (done: boolean | null) => done ? "Completed" : "Pending";
  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-AE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const totalAmount = parseFloat(order.totalAmount || "0");
  const discountPercent = parseFloat(order.discountPercent || "0");
  const discountAmount = parseFloat(order.discountAmount || "0");
  const deliveryCharge = parseFloat(String((order as any).deliveryCharge || "0")) || 0;
  const tipsAmount = parseFloat(String(order.tips || "0")) || 0;
  const calculatedFinal = Math.max(0, totalAmount - discountAmount) + deliveryCharge + tipsAmount;
  const storedFinalAmount = parseFloat(order.finalAmount || "");
  const rawFinal = Number.isFinite(storedFinalAmount) ? storedFinalAmount : calculatedFinal;
  const finalAmount = rawFinal;
  const adjustedAmount = parseFloat(String(order.adjustedTotal || ""));
  const hasAdjustedAmount =
    order.adjustedTotal != null &&
    Number.isFinite(adjustedAmount) &&
    Math.abs(adjustedAmount - totalAmount) > 0.009;
  const paidAmount = parseFloat(order.paidAmount || "0");
  const balance = finalAmount - paidAmount;

  const receiptToolbar = (
    <div className="flex items-center justify-between p-4 border-b bg-primary/5 gap-2 flex-wrap">
      <h2 className="text-lg font-semibold text-foreground">Order Receipt</h2>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={handlePrint} data-testid="button-print-order-receipt">
          <Printer className="w-4 h-4 mr-2" />
          Print
        </Button>
        {onClose && !embedded && (
          <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-order-receipt">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const receiptContent = (
    <>
      {receiptToolbar}
      <div ref={receiptRef} className="p-6 receipt-container">
          <div className="header">
            <div className="logo">
              <img src={logoBase64 || workspaceLogoUrl} alt={`${companyContact.companyName} logo`} />
            </div>
            <div className="company-info">
              <div className="company-name" style={order.urgent ? { color: "#dc2626" } : {}}>{companyContact.companyName}</div>
              <div className="company-address">
                {companyAddressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                <div>{formatCompanyPhoneLine(companyContact)}</div>
              </div>
            </div>
          </div>

          <div className="receipt-title" style={order.urgent ? { color: "#dc2626" } : {}}>ORDER RECEIPT</div>

          {/* Service Type Banner */}
          <div style={{
            textAlign: "center",
            padding: "12px",
            marginBottom: "15px",
            borderRadius: "8px",
            fontWeight: "bold",
            fontSize: "16px",
            background: order.urgent ? "#fef2f2" : "#f0f9ff",
            color: order.urgent ? "#dc2626" : "#1e40af",
            border: order.urgent ? "2px solid #dc2626" : "2px solid #1e40af"
          }}>
            {order.urgent ? "URGENT SERVICE" : "NORMAL SERVICE"}
          </div>

          <div className="order-number" style={order.urgent ? { color: "#dc2626", background: "#fef2f2" } : {}}>
            Order # {order.orderNumber}
            <div style={{ marginTop: "8px" }}>
              <span className="delivery-badge delivery-type">
                {order.deliveryType === "delivery" ? "for delivery" : "for pickup"}
              </span>
              {order.urgent && <span className="delivery-badge urgent-badge">URGENT</span>}
            </div>
          </div>

          <div className="info-row">
            <div className="info-section">
              <div className="info-label">Entry Date</div>
              <div className="info-value">{formatDate(order.entryDate)}</div>
            </div>
            <div className="info-section" style={{ textAlign: "right" }}>
              <div className="info-label">Expected Delivery</div>
              <div className="info-value">{formatDate(order.expectedDeliveryAt)}</div>
            </div>
          </div>

          {client && (
            <div className="info-row">
              <div className="info-section">
                <div className="info-label">Customer</div>
                <div className="info-value">{client.name}</div>
                {client.phone && <div className="info-value" style={{ fontSize: "12px", color: "#666" }}>{client.phone}</div>}
                {client.address && <div className="info-value" style={{ fontSize: "12px", color: "#666" }}>{client.address}</div>}
              </div>
            </div>
          )}

          {parsedItems.length > 0 && (
            <div className="items-section">
              <div className="items-title">Items / Services</div>
              <table className="items-table" style={{ border: "1px solid #000", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ width: "30px", textAlign: "center", border: "1px solid #000", padding: "6px 4px", background: "#f0f0f0" }}>#</th>
                    <th style={{ border: "1px solid #000", padding: "6px 4px", background: "#f0f0f0" }}>Item</th>
                    <th className="qty-col" style={{ border: "1px solid #000", padding: "6px 4px", background: "#f0f0f0" }}>Qty</th>
                    <th className="price-col" style={{ border: "1px solid #000", padding: "6px 4px", background: "#f0f0f0" }}>Price</th>
                    <th className="total-col" style={{ border: "1px solid #000", padding: "6px 4px", background: "#f0f0f0" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedItems.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ textAlign: "center", border: "1px solid #000", padding: "6px 4px" }}>{idx + 1}</td>
                      <td style={{ border: "1px solid #000", padding: "6px 4px" }}>{item.name}</td>
                      <td className="qty-col" style={{ border: "1px solid #000", padding: "6px 4px" }}>{item.qty}</td>
                      <td className="price-col" style={{ border: "1px solid #000", padding: "6px 4px" }}>{item.price.toFixed(2)}</td>
                      <td className="total-col" style={{ border: "1px solid #000", padding: "6px 4px" }}>{item.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="totals">
            <div className="total-row">
              <span>Sub Total:</span>
              <span>{totalAmount.toFixed(2)} AED</span>
            </div>
            {discountAmount > 0 && (
              <div className="total-row">
                <span>Discount{discountPercent > 0 ? ` (${discountPercent}%)` : ''}:</span>
                <span>-{discountAmount.toFixed(2)} AED</span>
              </div>
            )}
            {deliveryCharge > 0 && (
              <div className="total-row">
                <span>Delivery Charge:</span>
                <span>+{deliveryCharge.toFixed(2)} AED</span>
              </div>
            )}
            {tipsAmount > 0 && (
              <div className="total-row">
                <span>Tips:</span>
                <span>+{tipsAmount.toFixed(2)} AED</span>
              </div>
            )}
            {hasAdjustedAmount && (
              <>
                <div className="total-row" style={{ textDecoration: "line-through", color: "#999" }}>
                  <span>Original Work Received:</span>
                  <span>{totalAmount.toFixed(2)} AED</span>
                </div>
                <div className="total-row" style={{ fontWeight: "bold", color: "#1e40af" }}>
                  <span>Adjusted Work Received:</span>
                  <span>{adjustedAmount.toFixed(2)} AED</span>
                </div>
                <div style={{ fontSize: "9px", color: "#b45309", fontStyle: "italic", padding: "2px 0 4px" }}>
                  Reason: {order.priceAdjustReason || "N/A"}
                </div>
              </>
            )}
            <div className="total-row" style={{ fontWeight: "bold" }}>
              <span>Total:</span>
              <span>{finalAmount.toFixed(2)} AED</span>
            </div>
            {paidAmount > 0 && (
              <div className="total-row">
                <span>Paid:</span>
                <span style={{ color: "#16a34a" }}>-{paidAmount.toFixed(2)} AED</span>
              </div>
            )}
            <div className="total-row grand-total" style={{ fontSize: "16px" }}>
              <span>Amount Due:</span>
              <span style={{ color: balance > 0 ? "#dc2626" : "#16a34a" }}>
                {balance.toFixed(2)} AED
              </span>
            </div>
          </div>

          {balance <= 0 && paidAmount > 0 && (
            <div style={{
              textAlign: "center",
              padding: "15px",
              marginTop: "15px",
              marginBottom: "10px",
            }}>
              <div
                aria-label="PAID"
                style={{
                  width: "110px",
                  height: "110px",
                  margin: "0 auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "6px double #dc2626",
                  borderRadius: "9999px",
                  color: "#dc2626",
                  fontSize: "25px",
                  fontWeight: 900,
                  letterSpacing: "2px",
                  transform: "rotate(-10deg)",
                }}
              >
                PAID
              </div>
              <div style={{
                fontSize: "14px",
                fontWeight: "bold",
                color: "#dc2626",
                marginTop: "8px",
                textTransform: "uppercase",
              }}>
                {order.paymentMethod === "bank" ? "Bank Transfer" : 
                 order.paymentMethod === "card" ? "Card" : "Cash"}
              </div>
            </div>
          )}

          <div className="footer">
            <p>Thank you for choosing {companyContact.companyName}!</p>
            <p style={{ marginTop: "8px" }}>For inquiries, please contact us at {companyPhoneLine}</p>
          </div>
        </div>
      </>
  );

  const adjustDialog = (
    <Dialog open={adjustOpen} onOpenChange={(open) => { if (!open) { setAdjustOpen(false); setAdjustError(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-5 h-5 text-orange-500" />
            Adjust Total Price
          </DialogTitle>
          <DialogDescription>
            Change the total price for order #{order.orderNumber}. A reason is required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Order:</span>
            <span className="font-medium">{order.orderNumber}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Original Total:</span>
            <span className="font-medium">AED {parseFloat(order.totalAmount).toFixed(2)}</span>
          </div>
          {order.priceAdjustReason && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Previous Reason:</span>
              <span className="font-medium text-orange-600 dark:text-orange-400 text-xs">{order.priceAdjustReason}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label>New Total (AED)</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              value={adjustValue}
              onChange={(e) => setAdjustValue(e.target.value)}
              data-testid="input-adjust-price-receipt"
            />
          </div>
          <div className="space-y-2">
            <Label>Reason for Adjustment</Label>
            <Textarea
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="Why is the price being changed?"
              rows={2}
              data-testid="input-adjust-reason-receipt"
            />
          </div>
          <div className="space-y-2">
            <Label>Staff PIN (5 digits)</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={5}
              value={adjustPin}
              onChange={(e) => { setAdjustPin(e.target.value.replace(/\D/g, "")); setAdjustError(""); }}
              placeholder="Enter your PIN"
              data-testid="input-adjust-pin-receipt"
            />
          </div>
          {adjustError && (
            <p className="text-sm text-destructive">{adjustError}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
          <Button
            onClick={handleAdjustPrice}
            disabled={adjusting || adjustPin.length !== 5 || !adjustReason.trim()}
            data-testid="button-confirm-adjust-receipt"
          >
            {adjusting ? "Saving..." : "Update Price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (embedded) {
    return (
      <div className="rounded-lg border bg-card">
        {receiptContent}
        {adjustDialog}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-card">
        {receiptContent}
      </Card>
      {adjustDialog}
    </div>
  );
}

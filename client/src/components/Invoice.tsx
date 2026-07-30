import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InvoiceItemDescription } from "@/components/InvoiceItemDescription";
import { Printer, Download, X } from "lucide-react";
import { formatCompanyPhoneLine, getCompanyAddressLines, getPublicTrackingUrl, useCompanyContactInfo } from "@/lib/companyContact";
import logoImage from "@/assets/images/lwl-logo.png";

interface InvoiceProps {
  invoiceNumber: string;
  date: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  items?: { description: string; quantity?: number; rate?: number; amount: number }[];
  totalAmount: number;
  paidAmount: number;
  paymentMethod?: string;
  orderNumber?: string;
  priceAdjustReason?: string | null;
  onClose?: () => void;
}

export function Invoice({
  invoiceNumber,
  date,
  clientName,
  clientPhone,
  clientAddress,
  items = [],
  totalAmount,
  paidAmount,
  paymentMethod = "Cash",
  orderNumber,
  priceAdjustReason,
  onClose,
}: InvoiceProps) {
  const trackingUrl = orderNumber ? getPublicTrackingUrl() : null;
  const invoiceRef = useRef<HTMLDivElement>(null);
  const { companyContact } = useCompanyContactInfo();
  const companyAddressLines = getCompanyAddressLines(companyContact);

  const handlePrint = () => {
    if (invoiceRef.current) {
      const printContent = invoiceRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=800,height=600");
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Invoice ${invoiceNumber}</title>
            <style>
              @page { size: A5; margin: 10mm; }
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: Arial, sans-serif; 
                padding: 20px; 
                background: white; 
                color: #333;
                max-width: 148mm;
                margin: 0 auto;
              }
              .invoice-container { width: 100%; }
              .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #1e40af; padding-bottom: 12px; }
              .logo { max-width: 80px; height: auto; margin: 0 auto 8px; display: block; }
              .company-name { font-size: 18px; font-weight: bold; color: #1e40af; margin-bottom: 6px; letter-spacing: 1px; }
              .company-address { font-size: 10px; color: #666; line-height: 1.4; }
              .invoice-title { font-size: 16px; font-weight: bold; text-align: center; margin: 12px 0; color: #1e40af; background: #f0f4ff; padding: 8px; border-radius: 4px; }
              .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; }
              .info-section { width: 48%; }
              .info-label { font-size: 9px; color: #888; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
              .info-value { font-size: 11px; font-weight: 500; }
              .items-table { width: 100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #ddd; }
              .items-table th, .items-table td { padding: 8px 6px; text-align: left; border-bottom: 1px solid #e5e5e5; }
              .items-table th { background: #1e40af; color: white; font-weight: 600; font-size: 10px; text-transform: uppercase; }
              .items-table td { font-size: 10px; }
              .items-table .center { text-align: center; }
              .items-table .amount { text-align: right; }
              .items-table tbody tr:nth-child(even) { background: #f9fafb; }
              .totals { margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; }
              .total-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 11px; }
              .total-row.grand-total { font-size: 14px; font-weight: bold; color: #1e40af; border-top: 2px solid #1e40af; margin-top: 8px; padding-top: 10px; }
              .footer { margin-top: 20px; text-align: center; padding-top: 12px; border-top: 1px solid #e5e5e5; }
              .footer p { font-size: 9px; color: #666; margin-bottom: 4px; }
              .footer .contact { font-weight: bold; color: #1e40af; font-size: 10px; }
              .payment-badge { display: inline-block; background: #16a34a; color: white; padding: 5px 12px; border-radius: 15px; font-size: 10px; margin-top: 8px; font-weight: bold; }
              .tracking-section { margin-top: 15px; padding: 10px; background: #f0f9ff; border-radius: 6px; border: 1px dashed #1e40af; }
              .tracking-section p { font-size: 10px; color: #1e40af; margin-bottom: 4px; }
              .tracking-link { font-size: 11px; color: #1e40af; font-weight: bold; word-break: break-all; }
              .order-number { font-size: 12px; font-weight: bold; color: #333; margin-top: 4px; }
              @media print { 
                body { padding: 15px; -webkit-print-color-adjust: exact; print-color-adjust: exact; } 
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

  const balance = totalAmount - paidAmount;
  const isCredit = totalAmount === 0 && paidAmount > 0;
  const creditAmount = paidAmount;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={() => onClose?.()}
    >
      <Card
        className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b bg-primary/5">
          <h2 className="text-lg font-semibold text-foreground">Payment Receipt</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} data-testid="button-print-invoice">
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            {onClose && (
              <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-invoice">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        <div ref={invoiceRef} className="p-6 invoice-container">
          <div className="header">
            <img src={logoImage} alt="Company Logo" className="logo" style={{ maxWidth: "80px", height: "auto", margin: "0 auto 8px", display: "block" }} />
            <div className="company-name">{companyContact.companyName}</div>
            <div className="company-address">
              {companyAddressLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
              <div>{formatCompanyPhoneLine(companyContact)}</div>
            </div>
          </div>

          <div className="invoice-title">PAYMENT RECEIPT</div>

          <div className="info-row">
            <div className="info-section">
              <div className="info-label">Receipt No.</div>
              <div className="info-value">{invoiceNumber}</div>
            </div>
            <div className="info-section" style={{ textAlign: "right" }}>
              <div className="info-label">Date</div>
              <div className="info-value">{new Date(date).toLocaleDateString("en-AE", { 
                year: "numeric", 
                month: "long", 
                day: "numeric" 
              })}</div>
            </div>
          </div>

          <div className="info-row">
            <div className="info-section">
              <div className="info-label">Bill To</div>
              <div className="info-value">{clientName}</div>
              {clientPhone && <div className="info-value" style={{ fontSize: "12px", color: "#666" }}>{clientPhone}</div>}
              {clientAddress && <div className="info-value" style={{ fontSize: "12px", color: "#666" }}>{clientAddress}</div>}
            </div>
            <div className="info-section" style={{ textAlign: "right" }}>
              <div className="info-label">Payment Method</div>
              <div className="info-value">{paymentMethod}</div>
            </div>
          </div>

          {items.length > 0 && (
            <table className="items-table">
              <thead>
                <tr>
                  <th className="center" style={{ width: "8%" }}>S.No</th>
                  <th style={{ width: "42%" }}>Item Description</th>
                  <th className="center" style={{ width: "12%" }}>Qty</th>
                  <th className="amount" style={{ width: "18%" }}>Rate</th>
                  <th className="amount" style={{ width: "20%" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index}>
                    <td className="center">{index + 1}</td>
                    <td>
                      <InvoiceItemDescription
                        name={item.description}
                        packingRowStyle={{ fontSize: "10px", marginTop: "4px" }}
                      />
                    </td>
                    <td className="center">{item.quantity ?? 1}</td>
                    <td className="amount">{(item.rate ?? item.amount).toFixed(2)}</td>
                    <td className="amount">{item.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="totals">
            {isCredit ? (
              <>
                <div className="total-row grand-total">
                  <span>Credit Added to Account:</span>
                  <span style={{ color: "#16a34a" }}>
                    {creditAmount.toFixed(2)} AED
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="total-row">
                  <span>Total Amount:</span>
                  <span>{totalAmount.toFixed(2)} AED</span>
                </div>
                {priceAdjustReason && (
                  <div style={{ fontSize: "11px", color: "#b45309", fontStyle: "italic", padding: "2px 0" }}>
                    Price adjusted: {priceAdjustReason}
                  </div>
                )}
                <div className="total-row" style={{ color: "#16a34a" }}>
                  <span>Amount Paid:</span>
                  <span>{paidAmount.toFixed(2)} AED</span>
                </div>
                <div className="total-row grand-total">
                  <span>Balance Due:</span>
                  <span style={{ color: balance > 0 ? "#dc2626" : "#16a34a" }}>
                    {balance.toFixed(2)} AED
                  </span>
                </div>
              </>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: "20px" }}>
            <span className="payment-badge">
              {isCredit ? "CREDIT ADDED" : (balance <= 0 ? "PAID IN FULL" : "PARTIAL PAYMENT")}
            </span>
          </div>

          {trackingUrl && orderNumber && (
            <div className="tracking-section">
              <p>Track your order at this link:</p>
              <div className="tracking-link">{trackingUrl}</div>
              <div className="order-number">Order Number: {orderNumber}</div>
            </div>
          )}

          <div className="footer">
            <p>Thank you for your business!</p>
            <p style={{ marginTop: "8px" }}>For inquiries, please contact us at {formatCompanyPhoneLine(companyContact)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

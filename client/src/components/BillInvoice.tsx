import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InvoiceItemDescription } from "@/components/InvoiceItemDescription";
import { Printer, X } from "lucide-react";
import { formatCompanyPhoneLine, getCompanyAddressLines, useCompanyContactInfo } from "@/lib/companyContact";
import logoImage from "@assets/image_1769169126339.png";

interface BillInvoiceProps {
  invoiceNumber: string;
  date: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  billedBy?: string;
  isUrgent?: boolean;
  items?: { description: string; quantity?: number; rate?: number; amount: number }[];
  billAmount: number;
  previousBalance: number;
  totalDue: number;
  orderNumber?: string;
  priceAdjustReason?: string | null;
  discountAmount?: number;
  originalAmount?: number;
  onClose?: () => void;
}

export function BillInvoice({
  invoiceNumber,
  date,
  clientName,
  clientPhone,
  clientAddress,
  billedBy,
  isUrgent = false,
  items = [],
  billAmount,
  previousBalance,
  totalDue,
  orderNumber,
  priceAdjustReason,
  discountAmount,
  originalAmount,
  onClose,
}: BillInvoiceProps) {
  const trackingUrl = orderNumber ? `lwl.software/track` : null;
  const invoiceRef = useRef<HTMLDivElement>(null);
  const { companyContact } = useCompanyContactInfo();
  const companyAddressLines = getCompanyAddressLines(companyContact);
  const companyPhoneLine = formatCompanyPhoneLine(companyContact);

  const handlePrint = () => {
    if (invoiceRef.current) {
      const printContent = invoiceRef.current.innerHTML;
      const printWindow = window.open("", "_blank", "width=800,height=600");
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Bill Invoice ${invoiceNumber}</title>
            <style>
              @page { size: A5; margin: 0 !important; }
              @media print { 
                html, body { margin: 0 !important; padding: 0 !important; }
                .invoice-container { margin-top: -20mm !important; }
              }
              * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              html, body { 
                font-family: Arial, sans-serif; 
                padding: 0 8px 5px 8px; 
                background: white; 
                color: #333;
                max-width: 148mm;
                margin: 0;
              }
              .invoice-container { width: 100%; margin-top: 0; padding-top: 0; }
              .header { text-align: center; margin-bottom: 4px; border-bottom: none; padding-bottom: 4px; margin-top: 0; }
              .logo { max-width: 70px; height: auto; margin: 0 auto 4px; display: block; }
              .company-name { font-size: 18px; font-weight: bold; color: #1e40af; margin-bottom: 6px; }
              .company-address { font-size: 10px; color: #666; line-height: 1.4; }
              .invoice-title { font-size: 16px; font-weight: bold; text-align: center; margin: 12px 0; color: #1e40af; background: #fef2f2; padding: 8px; border-radius: 4px; }
              .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; }
              .info-section { width: 48%; }
              .info-label { font-size: 9px; color: #888; margin-bottom: 2px; text-transform: uppercase; }
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
              .total-row.grand-total { font-size: 14px; font-weight: bold; color: #dc2626; border-top: 2px solid #1e40af; margin-top: 8px; padding-top: 10px; }
              .footer { margin-top: 20px; text-align: center; padding-top: 12px; border-top: 1px solid #e5e5e5; }
              .footer p { font-size: 9px; color: #666; margin-bottom: 4px; }
              .status-badge { display: inline-block; background: #dc2626; color: white; padding: 5px 12px; border-radius: 15px; font-size: 10px; margin-top: 8px; font-weight: bold; }
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
        
        // Wait for images to load before printing
        const images = printWindow.document.querySelectorAll('img');
        const imagePromises = Array.from(images).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
        });
        
        Promise.all(imagePromises).then(() => {
          setTimeout(() => {
            printWindow.print();
            printWindow.close();
          }, 100);
        });
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-card">
        <div className="flex items-center justify-between p-4 border-b bg-destructive/5">
          <h2 className="text-lg font-semibold text-foreground">Bill Invoice</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} data-testid="button-print-bill-invoice">
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            {onClose && (
              <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-bill-invoice">
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

          <div className="invoice-title">BILL INVOICE</div>

          <div className="info-row">
            <div className="info-section">
              <div className="info-label">Invoice No.</div>
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
              {billedBy && <div className="info-value" style={{ fontSize: "12px", color: "#666" }}>Billed by: {billedBy}</div>}
              <div className="info-value" style={{ fontSize: "12px", fontWeight: 700, color: isUrgent ? "#dc2626" : "#16a34a" }}>
                Bill Type: {isUrgent ? "URGENT" : "NORMAL"}
              </div>
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
            {previousBalance > 0 && (
              <div className="total-row">
                <span>Previous Balance:</span>
                <span>{previousBalance.toFixed(2)} AED</span>
              </div>
            )}
            {discountAmount && discountAmount > 0 && originalAmount ? (
              <>
                <div className="total-row" style={{ color: "#6b7280" }}>
                  <span>Original Amount:</span>
                  <span>{originalAmount.toFixed(2)} AED</span>
                </div>
                <div className="total-row" style={{ color: "#ea580c", fontWeight: 600 }}>
                  <span>Discount:</span>
                  <span>-{discountAmount.toFixed(2)} AED</span>
                </div>
                <div className="total-row" style={{ color: "#1e40af", fontWeight: 600 }}>
                  <span>Bill Amount (After Discount):</span>
                  <span>{billAmount.toFixed(2)} AED</span>
                </div>
              </>
            ) : (
              <div className="total-row" style={{ color: "#1e40af", fontWeight: 600 }}>
                <span>New Bill Amount:</span>
                <span>{billAmount.toFixed(2)} AED</span>
              </div>
            )}
            {priceAdjustReason && (
              <div style={{ fontSize: "11px", color: "#b45309", fontStyle: "italic", padding: "4px 0" }}>
                Price adjusted: {priceAdjustReason}
              </div>
            )}
            <div className="total-row grand-total">
              <span>Total Amount Due:</span>
              <span>{totalDue.toFixed(2)} AED</span>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: "20px" }}>
            <span className="status-badge">
              PAYMENT DUE
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
            <p style={{ marginTop: "8px" }}>Please settle payment at your earliest convenience.</p>
            <p style={{ marginTop: "8px" }}>For inquiries, please contact us at {companyPhoneLine}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

import nodemailer from 'nodemailer';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface SalesReportData {
  period: ReportPeriod;
  dateRange: string;
  totalOrders: number;
  totalRevenue: number;
  paidAmount: number;
  pendingAmount: number;
  normalOrders: number;
  urgentOrders: number;
  pickupOrders: number;
  deliveryOrders: number;
  topItems: { name: string; count: number }[];
}

export interface OrderStaffTracking {
  orderNumber: string;
  customerName: string;
  amount: string;
  entryBy: string | null;
  tagBy: string | null;
  packingBy: string | null;
  deliveryBy: string | null;
  status: string;
}

export interface DailySalesData {
  date: string;
  totalOrders: number;
  totalRevenue: number;
  paidAmount: number;
  pendingAmount: number;
  normalOrders: number;
  urgentOrders: number;
  pickupOrders: number;
  deliveryOrders: number;
  topItems: { name: string; count: number }[];
  orderDetails?: OrderStaffTracking[];
}

const removeBulkIndicator = (value: string | null | undefined) =>
  typeof value === "string"
    ? value.replace(/\s*\(bulk\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim()
    : value;

function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('SMTP credentials not configured. Please set SMTP_USER and SMTP_PASS environment variables.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

export async function sendDailySalesReportEmailSMTP(toEmail: string, salesData: DailySalesData) {
  const transporter = createTransporter();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  const topItemsHtml = salesData.topItems.length > 0 
    ? salesData.topItems.map(item => `<li>${item.name}: ${item.count} orders</li>`).join('')
    : '<li>No items today</li>';

  const mailOptions = {
    from: `"Liquid Washes Laundry" <${fromEmail}>`,
    to: toEmail,
    subject: `Daily Sales Report - ${salesData.date} - Liquid Washes Laundry`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
        <div style="background-color: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">Daily Sales Report</h1>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">${salesData.date}</p>
        </div>
        
        <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">Summary</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 12px; background-color: #f3f4f6; border-radius: 6px; width: 50%;">
                <div style="color: #6b7280; font-size: 12px; text-transform: uppercase;">Total Orders</div>
                <div style="color: #1f2937; font-size: 24px; font-weight: bold;">${salesData.totalOrders}</div>
              </td>
              <td style="padding: 12px; background-color: #dcfce7; border-radius: 6px; width: 50%; margin-left: 10px;">
                <div style="color: #166534; font-size: 12px; text-transform: uppercase;">Total Revenue</div>
                <div style="color: #166534; font-size: 24px; font-weight: bold;">AED ${salesData.totalRevenue.toFixed(2)}</div>
              </td>
            </tr>
          </table>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 10px; text-align: center; background-color: #dbeafe; border-radius: 6px;">
                <div style="color: #1e40af; font-size: 11px; text-transform: uppercase;">Paid</div>
                <div style="color: #1e40af; font-size: 18px; font-weight: bold;">AED ${salesData.paidAmount.toFixed(2)}</div>
              </td>
              <td style="padding: 10px; text-align: center; background-color: #fef3c7; border-radius: 6px;">
                <div style="color: #92400e; font-size: 11px; text-transform: uppercase;">Pending</div>
                <div style="color: #92400e; font-size: 18px; font-weight: bold;">AED ${salesData.pendingAmount.toFixed(2)}</div>
              </td>
            </tr>
          </table>
          
          <h3 style="color: #1f2937; margin-top: 20px;">Order Breakdown</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background-color: #f9fafb;">
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Normal Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.normalOrders}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Urgent Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.urgentOrders}</td>
            </tr>
            <tr style="background-color: #f9fafb;">
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Pickup Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.pickupOrders}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Delivery Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.deliveryOrders}</td>
            </tr>
          </table>
          
          <h3 style="color: #1f2937; margin-top: 20px;">Top Items Today</h3>
          <ul style="color: #4b5563; line-height: 1.8;">
            ${topItemsHtml}
          </ul>
          
          ${salesData.orderDetails && salesData.orderDetails.length > 0 ? `
          <h3 style="color: #1f2937; margin-top: 20px;">Order Details with Staff Tracking</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <tr style="background-color: #1f2937; color: white;">
              <th style="padding: 8px; text-align: left;">Order #</th>
              <th style="padding: 8px; text-align: left;">Customer</th>
              <th style="padding: 8px; text-align: right;">Amount</th>
              <th style="padding: 8px; text-align: left;">Created By</th>
              <th style="padding: 8px; text-align: left;">Tagged By</th>
              <th style="padding: 8px; text-align: left;">Packed By</th>
              <th style="padding: 8px; text-align: left;">Delivered By</th>
            </tr>
            ${salesData.orderDetails.map((order, index) => `
            <tr style="background-color: ${index % 2 === 0 ? '#f9fafb' : 'white'};">
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${order.orderNumber}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${order.customerName}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">AED ${order.amount}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${removeBulkIndicator(order.entryBy) || '-'}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${removeBulkIndicator(order.tagBy) || '-'}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${removeBulkIndicator(order.packingBy) || '-'}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${removeBulkIndicator(order.deliveryBy) || '-'}</td>
            </tr>
            `).join('')}
          </table>
          ` : ''}
        </div>
        
        <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 12px;">
          <p style="margin: 0;">Liquid Washes Laundry</p>
          <p style="margin: 5px 0;">Centra Market D/109, Al Dhanna City, Al Ruwais</p>
          <p style="margin: 0;">Abu Dhabi - UAE</p>
          <p style="margin: 5px 0;">Tel: 026 815 824 | Mobile: +971 56 338 0001</p>
        </div>
      </div>
    `
  };

  const result = await transporter.sendMail(mailOptions);
  console.log(`[smtp] Email sent to ${toEmail}: ${result.messageId}`);
  return result;
}

const periodTitles: Record<ReportPeriod, string> = {
  daily: 'Daily Sales Report',
  weekly: 'Weekly Sales Report',
  monthly: 'Monthly Sales Report',
  yearly: 'Yearly Sales Report'
};

const periodItemLabels: Record<ReportPeriod, string> = {
  daily: 'Top Items Today',
  weekly: 'Top Items This Week',
  monthly: 'Top Items This Month',
  yearly: 'Top Items This Year'
};

export async function sendSalesReportEmailSMTP(toEmail: string, salesData: SalesReportData) {
  const transporter = createTransporter();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  const topItemsHtml = salesData.topItems.length > 0 
    ? salesData.topItems.map(item => `<li>${item.name}: ${item.count} orders</li>`).join('')
    : '<li>No items in this period</li>';

  const title = periodTitles[salesData.period];
  const itemsLabel = periodItemLabels[salesData.period];

  const mailOptions = {
    from: `"Liquid Washes Laundry" <${fromEmail}>`,
    to: toEmail,
    subject: `${title} - ${salesData.dateRange} - Liquid Washes Laundry`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
        <div style="background-color: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">${title}</h1>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">${salesData.dateRange}</p>
        </div>
        
        <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">Summary</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 12px; background-color: #f3f4f6; border-radius: 6px; width: 50%;">
                <div style="color: #6b7280; font-size: 12px; text-transform: uppercase;">Total Orders</div>
                <div style="color: #1f2937; font-size: 24px; font-weight: bold;">${salesData.totalOrders}</div>
              </td>
              <td style="padding: 12px; background-color: #dcfce7; border-radius: 6px; width: 50%; margin-left: 10px;">
                <div style="color: #166534; font-size: 12px; text-transform: uppercase;">Total Revenue</div>
                <div style="color: #166534; font-size: 24px; font-weight: bold;">AED ${salesData.totalRevenue.toFixed(2)}</div>
              </td>
            </tr>
          </table>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 10px; text-align: center; background-color: #dbeafe; border-radius: 6px;">
                <div style="color: #1e40af; font-size: 11px; text-transform: uppercase;">Paid</div>
                <div style="color: #1e40af; font-size: 18px; font-weight: bold;">AED ${salesData.paidAmount.toFixed(2)}</div>
              </td>
              <td style="padding: 10px; text-align: center; background-color: #fef3c7; border-radius: 6px;">
                <div style="color: #92400e; font-size: 11px; text-transform: uppercase;">Pending</div>
                <div style="color: #92400e; font-size: 18px; font-weight: bold;">AED ${salesData.pendingAmount.toFixed(2)}</div>
              </td>
            </tr>
          </table>
          
          <h3 style="color: #1f2937; margin-top: 20px;">Order Breakdown</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background-color: #f9fafb;">
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Normal Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.normalOrders}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Urgent Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.urgentOrders}</td>
            </tr>
            <tr style="background-color: #f9fafb;">
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Pickup Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.pickupOrders}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">Delivery Orders</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-weight: bold;">${salesData.deliveryOrders}</td>
            </tr>
          </table>
          
          <h3 style="color: #1f2937; margin-top: 20px;">${itemsLabel}</h3>
          <ul style="color: #4b5563; line-height: 1.8;">
            ${topItemsHtml}
          </ul>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 12px;">
          <p style="margin: 0;">Liquid Washes Laundry</p>
          <p style="margin: 5px 0;">Centra Market D/109, Al Dhanna City, Al Ruwais</p>
          <p style="margin: 0;">Abu Dhabi - UAE</p>
          <p style="margin: 5px 0;">Tel: 026 815 824 | Mobile: +971 56 338 0001</p>
        </div>
      </div>
    `
  };

  const result = await transporter.sendMail(mailOptions);
  console.log(`[smtp] ${salesData.period} report email sent to ${toEmail}: ${result.messageId}`);
  return result;
}

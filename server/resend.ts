// Resend integration for sending emails
import { Resend } from 'resend';

interface ResendCredentials {
  apiKey: string;
  fromEmail?: string | null;
}

async function getCredentials(): Promise<ResendCredentials> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Resend is not configured. Set RESEND_API_KEY in the environment.');
  }

  return {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || null,
  };
}

export async function getUncachableResendClient() {
  const credentials = await getCredentials();
  return {
    client: new Resend(credentials.apiKey),
    fromEmail: credentials.fromEmail || null,
  };
}

export async function sendPasswordResetEmail(toEmail: string, resetCode: string, userName: string) {
  const { client, fromEmail } = await getUncachableResendClient();
  
  const result = await client.emails.send({
    from: fromEmail || 'noreply@resend.dev',
    to: toEmail,
    subject: 'Password Reset - Liquid Washes Laundry',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2563eb;">Password Reset Request</h2>
        <p>Hello ${userName},</p>
        <p>You have requested to reset your password for Liquid Washes Laundry Management System.</p>
        <p>Your password reset code is:</p>
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <h1 style="color: #2563eb; letter-spacing: 8px; margin: 0;">${resetCode}</h1>
        </div>
        <p>This code will expire in 15 minutes.</p>
        <p>If you did not request this reset, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #6b7280; font-size: 12px;">
          Liquid Washes Laundry<br>
          Centra Market D/109, Al Dhanna City<br>
          Al Ruwais, Abu Dhabi - UAE<br>
          +971 50 123 4567
        </p>
      </div>
    `
  });
  
  return result;
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
}

export async function sendDailySalesReportEmail(toEmail: string, salesData: DailySalesData) {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    
    const topItemsHtml = salesData.topItems.length > 0 
      ? salesData.topItems.map(item => `<li>${item.name}: ${item.count} orders</li>`).join('')
      : '<li>No items today</li>';
    
    const result = await client.emails.send({
      from: fromEmail || 'noreply@resend.dev',
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
          </div>
          
          <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 12px;">
            <p style="margin: 0;">Liquid Washes Laundry</p>
            <p style="margin: 5px 0;">Centra Market D/109, Al Dhanna City, Al Ruwais</p>
            <p style="margin: 0;">Abu Dhabi - UAE</p>
          </div>
        </div>
      `
    });
    
    return result;
  } catch (error) {
    console.error('Failed to send daily sales report email:', error);
    throw error;
  }
}

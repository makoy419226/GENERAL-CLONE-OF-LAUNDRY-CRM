import nodemailer from "nodemailer";
import { resolve4 } from "node:dns/promises";
import { getUncachableResendClient } from "./resend";

type DeliveryChannel = "smtp" | "resend" | "development-preview";

interface EmailPayload {
  toEmail: string;
  subject: string;
  html: string;
}

export interface PasswordResetDeliveryResult {
  channel: DeliveryChannel;
  message: string;
  previewCode?: string;
}

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function hasResendConfig() {
  return Boolean(process.env.RESEND_API_KEY);
}

function maskEmail(email: string) {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");

  if (atIndex <= 0) {
    return trimmed;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex);
  const visibleLocalPart = localPart.slice(0, Math.min(2, localPart.length));
  const hiddenPart = localPart.length > 2 ? "***" : "*";

  return `${visibleLocalPart}${hiddenPart}${domainPart}`;
}

async function sendEmailViaSmtp({ toEmail, subject, html }: EmailPayload) {
  const port = parseInt(process.env.SMTP_PORT?.trim() || "587", 10);
  const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === "true" || port === 465;
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPassword = process.env.SMTP_PASS?.replace(/\s+/g, "");
  const fromEmail = process.env.SMTP_FROM?.trim() || smtpUser;
  const smtpHost = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      // Vercel functions can occasionally exhaust getaddrinfo resources. DNS
      // resolution through c-ares avoids that path; servername keeps TLS
      // certificate verification tied to the configured SMTP hostname.
      const addresses = await resolve4(smtpHost);
      const connectionHost = addresses[(attempt - 1) % addresses.length] || smtpHost;
      const transporter = nodemailer.createTransport({
        host: connectionHost,
        port,
        secure,
        requireTLS: !secure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        tls: { servername: smtpHost },
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });

      await transporter.sendMail({
        from: `"Liquid Washes Laundry" <${fromEmail}>`,
        to: toEmail,
        subject,
        html,
      });
      transporter.close();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
  }

  throw lastError;
}

async function sendEmailViaResend({ toEmail, subject, html }: EmailPayload) {
  const { client, fromEmail } = await getUncachableResendClient();

  await client.emails.send({
    from: fromEmail || "noreply@resend.dev",
    to: toEmail,
    subject,
    html,
  });
}

async function deliverPasswordResetEmail(
  payload: EmailPayload,
  previewCode: string,
): Promise<PasswordResetDeliveryResult> {
  if (hasSmtpConfig()) {
    await sendEmailViaSmtp(payload);
    return {
      channel: "smtp",
      message: `Reset code sent to ${maskEmail(payload.toEmail)}`,
    };
  }

  if (hasResendConfig()) {
    await sendEmailViaResend(payload);
    return {
      channel: "resend",
      message: `Reset code sent to ${maskEmail(payload.toEmail)}`,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[password-reset] Email delivery is not configured. Using development preview code ${previewCode} for ${payload.toEmail}.`,
    );

    return {
      channel: "development-preview",
      message:
        "Email delivery is not configured locally. Use the development reset code shown in the app.",
      previewCode,
    };
  }

  throw new Error(
    "Email delivery is not configured. Set SMTP_USER/SMTP_PASS or RESEND_API_KEY before using password reset.",
  );
}

export async function sendUserPasswordResetEmail(
  toEmail: string,
  resetCode: string,
  userName: string,
) {
  return deliverPasswordResetEmail(
    {
      toEmail,
      subject: "Reset Password Request - Liquid Washes Laundry",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Reset Password Request</h2>
          <p>Hello ${userName},</p>
          <p>You requested to reset your password for the Liquid Washes Laundry Management System login page.</p>
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
      `,
    },
    resetCode,
  );
}

export async function sendAdminPasswordOtpEmail(toEmail: string, otp: string) {
  return deliverPasswordResetEmail(
    {
      toEmail,
      subject: "Change Password Request - Admin Settings - Liquid Washes Laundry",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Change Password Request</h2>
          <p>You requested to change the admin password from Admin Settings.</p>
          <p>Your OTP code for changing the admin password is:</p>
          <div style="background: #f0f9ff; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af;">${otp}</span>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
      `,
    },
    otp,
  );
}

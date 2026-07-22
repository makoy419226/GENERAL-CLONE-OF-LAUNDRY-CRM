import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const VERSION = "v1";

function getEncryptionKey() {
  const source = String(
    process.env.BUSINESS_SECRETS_KEY || process.env.SESSION_SECRET || "",
  ).trim();

  if (!source) {
    throw new Error("BUSINESS_SECRETS_KEY or SESSION_SECRET must be configured");
  }

  return createHash("sha256").update(source).digest();
}

export function encryptBusinessSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptBusinessSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || "").split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted business secret");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

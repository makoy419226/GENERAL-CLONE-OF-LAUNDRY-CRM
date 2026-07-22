type ErrorLike = {
  message?: unknown;
  code?: unknown;
  syscall?: unknown;
  address?: unknown;
  port?: unknown;
  cause?: unknown;
  errors?: unknown;
};

const DATABASE_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "EPERM",
  "28P01",
  "3D000",
  "57P03",
]);

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function appendUnique(target: string[], values: string[]) {
  for (const value of values) {
    if (!value || target.includes(value)) {
      continue;
    }

    target.push(value);
  }
}

function formatAddressPort(address: string, port: unknown): string {
  const normalizedPort =
    typeof port === "number"
      ? Number.isFinite(port) && port >= 0
        ? String(port)
        : ""
      : toTrimmedString(port);

  if (!address) return normalizedPort;
  if (!normalizedPort) return address;
  return `${address}:${normalizedPort}`;
}

function formatStructuredError(error: ErrorLike): string {
  const message = toTrimmedString(error.message);
  if (message) {
    return message;
  }

  const syscall = toTrimmedString(error.syscall);
  const code = toTrimmedString(error.code);
  const endpoint = formatAddressPort(
    toTrimmedString(error.address),
    error.port,
  );

  return [syscall, code, endpoint].filter(Boolean).join(" ").trim();
}

function collectErrorMessages(error: unknown, seen = new Set<object>()): string[] {
  if (error == null) return [];

  if (typeof error === "string") {
    return error.trim() ? [error.trim()] : [];
  }

  if (typeof error !== "object") {
    return [];
  }

  if (seen.has(error)) {
    return [];
  }

  seen.add(error);

  const errorLike = error as ErrorLike;
  const messages: string[] = [];
  const nested: string[] = [];
  const directMessage = formatStructuredError(errorLike);

  if (directMessage) {
    messages.push(directMessage);
  }

  const aggregateErrors =
    error instanceof AggregateError
      ? Array.from(error.errors)
      : Array.isArray(errorLike.errors)
        ? errorLike.errors
        : [];

  for (const nestedError of aggregateErrors) {
    appendUnique(nested, collectErrorMessages(nestedError, seen));
  }

  if ("cause" in errorLike) {
    appendUnique(nested, collectErrorMessages(errorLike.cause, seen));
  }

  if (messages.length === 0) {
    return nested;
  }

  appendUnique(messages, nested);
  return messages;
}

export function formatErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  const messages = collectErrorMessages(error);

  if (messages.length === 0) {
    return fallback;
  }

  return messages.join("; ");
}

export function isDatabaseConnectionError(
  error: unknown,
  seen = new Set<object>(),
): boolean {
  if (error == null) return false;

  if (typeof error === "string") {
    return /connect|connection|database .* does not exist|password authentication failed|pg_hba/i.test(
      error,
    );
  }

  if (typeof error !== "object") {
    return false;
  }

  if (seen.has(error)) {
    return false;
  }

  seen.add(error);

  const errorLike = error as ErrorLike;
  const code = toTrimmedString(errorLike.code).toUpperCase();
  const syscall = toTrimmedString(errorLike.syscall).toLowerCase();
  const formatted = formatStructuredError(errorLike).toLowerCase();

  if (DATABASE_CONNECTION_CODES.has(code)) {
    return true;
  }

  if (syscall === "connect") {
    return true;
  }

  if (
    /connect|connection|database .* does not exist|password authentication failed|pg_hba/.test(
      formatted,
    )
  ) {
    return true;
  }

  const aggregateErrors =
    error instanceof AggregateError
      ? Array.from(error.errors)
      : Array.isArray(errorLike.errors)
        ? errorLike.errors
        : [];

  if (aggregateErrors.some((nested) => isDatabaseConnectionError(nested, seen))) {
    return true;
  }

  if ("cause" in errorLike) {
    return isDatabaseConnectionError(errorLike.cause, seen);
  }

  return false;
}

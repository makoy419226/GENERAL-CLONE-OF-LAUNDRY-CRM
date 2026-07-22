export type StoredItemPickupStatusValue =
  | string
  | {
      status?: string | null;
      quantity?: number | null;
    };

export type ParsedItemPickupStatusValue = {
  status: string;
  quantity: number | null;
};

export type ParsedItemPickupStatusMap = Record<string, ParsedItemPickupStatusValue>;

const COMPLETION_STATUSES = new Set(["delivered", "picked_up"]);

const clampQuantity = (quantity: number, lineQuantity: number) => {
  const safeLineQuantity = Math.max(0, Math.floor(Number(lineQuantity) || 0));
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  return Math.min(safeLineQuantity, safeQuantity);
};

export function parseItemPickupStatusMap(
  raw: string | null | undefined,
): ParsedItemPickupStatusMap {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const normalized: ParsedItemPickupStatusMap = {};
    Object.entries(parsed as Record<string, StoredItemPickupStatusValue>).forEach(
      ([lineKey, entry]) => {
        if (typeof entry === "string") {
          const status = entry.trim();
          if (status) {
            normalized[lineKey] = { status, quantity: null };
          }
          return;
        }

        if (!entry || typeof entry !== "object") {
          return;
        }

        const status = String(entry.status || "").trim();
        if (!status) {
          return;
        }

        const parsedQuantity = Number(entry.quantity);
        normalized[lineKey] = {
          status,
          quantity:
            Number.isFinite(parsedQuantity) && parsedQuantity > 0
              ? Math.floor(parsedQuantity)
              : null,
        };
      },
    );

    return normalized;
  } catch {
    return {};
  }
}

export function getItemPickupCompletedQuantityFromMap(
  pickupStatusMap: ParsedItemPickupStatusMap,
  lineIndex: number,
  lineQuantity: number,
  doneStatus: string,
  isOrderDelivered = false,
): number {
  const safeLineQuantity = Math.max(0, Math.floor(Number(lineQuantity) || 0));
  if (safeLineQuantity <= 0) return 0;
  if (isOrderDelivered) return safeLineQuantity;

  const entry = pickupStatusMap[String(lineIndex)];
  if (!entry) {
    return 0;
  }

  const normalizedEntryStatus = String(entry.status || "").trim().toLowerCase();
  const normalizedDoneStatus = String(doneStatus || "").trim().toLowerCase();
  const isRecognizedCompletedStatus =
    normalizedEntryStatus === normalizedDoneStatus ||
    COMPLETION_STATUSES.has(normalizedEntryStatus);

  if (!normalizedEntryStatus || !isRecognizedCompletedStatus) {
    return 0;
  }

  if (entry.quantity == null) {
    return safeLineQuantity;
  }

  return clampQuantity(entry.quantity, safeLineQuantity);
}

export function buildItemPickupStatusJson(
  raw: string | null | undefined,
  lineIndex: number,
  lineQuantity: number,
  completedQuantity: number,
  doneStatus: string,
): string {
  const nextMap = parseItemPickupStatusMap(raw);
  const safeCompletedQuantity = clampQuantity(completedQuantity, lineQuantity);
  const key = String(lineIndex);

  if (safeCompletedQuantity <= 0) {
    delete nextMap[key];
  } else {
    nextMap[key] = {
      status: doneStatus,
      quantity: safeCompletedQuantity,
    };
  }

  const serialized = Object.entries(nextMap).reduce<
    Record<string, StoredItemPickupStatusValue>
  >((acc, [entryKey, entryValue]) => {
    if (!entryValue.status) {
      return acc;
    }

    acc[entryKey] =
      entryValue.quantity == null
        ? entryValue.status
        : {
            status: entryValue.status,
            quantity: entryValue.quantity,
          };
    return acc;
  }, {});

  return JSON.stringify(serialized);
}

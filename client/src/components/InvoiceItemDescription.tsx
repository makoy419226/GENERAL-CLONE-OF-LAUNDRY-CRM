import type { CSSProperties } from "react";

export type InvoiceItemPackingType = "folding" | "hanging" | null;
export type InvoiceItemServiceType = "N" | "DC" | "IO" | null;

type InvoiceItemIndicator = {
  color: string;
  label: string;
};

type InvoiceItemDisplayDetails = {
  displayName: string;
  indicators: InvoiceItemIndicator[];
  packingType: InvoiceItemPackingType;
  serviceType: InvoiceItemServiceType;
  urgent: boolean;
};

type InvoiceItemDescriptionProps = {
  name: string;
  containerStyle?: CSSProperties;
  packingRowStyle?: CSSProperties;
  optionStyle?: CSSProperties;
  packingPlacement?: "inline" | "stacked";
};

type InvoiceItemDescriptionHtmlOptions = {
  fontSizePx?: number;
  indicatorFontSizePx?: number;
  packingFontSizePx?: number;
  packingGapPx?: number;
  packingMarginTopPx?: number;
  indicatorGapPx?: number;
  boxSizePx?: number;
  lineHeight?: number;
  nameSuffixHtml?: string;
};

const BOX_BASE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "12px",
  height: "12px",
  border: "1px solid #1f2937",
  borderRadius: "2px",
  backgroundColor: "#ffffff",
  flexShrink: 0,
};

function escapeInvoiceItemHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getInvoiceItemIndicators(
  serviceType: InvoiceItemServiceType,
  urgent: boolean,
): InvoiceItemIndicator[] {
  const indicators: InvoiceItemIndicator[] = [];

  if (serviceType === "N" && !urgent) {
    indicators.push({ label: "N", color: "#16a34a" });
  } else if (serviceType === "DC") {
    indicators.push({ label: "DC", color: "#2563eb" });
  } else if (serviceType === "IO") {
    indicators.push({ label: "IO", color: "#d97706" });
  }

  if (urgent) {
    indicators.push({ label: "U", color: "#dc2626" });
  }

  return indicators;
}

export function getInvoiceItemDisplayDetails(name: string): InvoiceItemDisplayDetails {
  const normalized = String(name || "")
    .replace(/\s*\(base\s*[\d.]+\s*AED\)/gi, "")
    .replace(/\s*@\s*[\d.]+\s*AED(?:\s*\((?:custom|min\s*50|admin\s*edited)\))?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const normalizedWithoutUrgent = normalized
    .replace(/\s*\*URG\*\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const serviceMatch = normalized.match(/\[(N|DC|D|IO|I)\]/i);
  const rawServiceType = serviceMatch?.[1]?.toUpperCase() || "";
  const serviceType: InvoiceItemServiceType = rawServiceType === "D"
    ? "DC"
    : rawServiceType === "I"
      ? "IO"
      : rawServiceType === "N" || rawServiceType === "DC" || rawServiceType === "IO"
        ? rawServiceType
        : null;
  const urgent = /\*URG\*/i.test(normalized);

  const packingType = /\((?:hanger|hanging)\)\s*$/i.test(normalizedWithoutUrgent)
    ? "hanging"
    : /\(folding\)\s*$/i.test(normalizedWithoutUrgent)
      ? "folding"
      : null;

  const displayName = normalizedWithoutUrgent
    .replace(/\s*\[(?:N|DC|D|IO|I)\]\s*/gi, " ")
    .replace(/\s*\((?:folding|hanger|hanging)\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    displayName: displayName || normalized || "Item",
    indicators: getInvoiceItemIndicators(serviceType, urgent),
    packingType,
    serviceType,
    urgent,
  };
}

function getStaticIndicatorHtml(
  indicator: InvoiceItemIndicator,
  indicatorFontSizePx: number,
): string {
  return `<span style="font-size:${indicatorFontSizePx}px; font-weight:700; color:${indicator.color};">[${escapeInvoiceItemHtml(indicator.label)}]</span>`;
}

function getStaticPackingOptionHtml(
  label: string,
  checked: boolean,
  {
    packingFontSizePx = 10,
    boxSizePx = 12,
  }: InvoiceItemDescriptionHtmlOptions,
): string {
  const checkWidth = Math.max(3, Math.round(boxSizePx * 0.34));
  const checkHeight = Math.max(6, Math.round(boxSizePx * 0.67));
  const checkLeft = Math.max(2, Math.round(boxSizePx * 0.25));

  return `
    <span style="display:inline-flex; align-items:center; gap:5px; white-space:nowrap;">
      <span style="display:inline-block; position:relative; width:${boxSizePx}px; height:${boxSizePx}px; border:1px solid #1f2937; border-radius:2px; background:#ffffff; box-sizing:border-box; flex-shrink:0;">
        ${
          checked
            ? `<span style="position:absolute; top:0px; left:${checkLeft}px; width:${checkWidth}px; height:${checkHeight}px; border-right:2px solid #dc2626; border-bottom:2px solid #dc2626; transform:rotate(45deg);"></span>`
            : ""
        }
      </span>
      <span style="font-size:${packingFontSizePx}px;">${escapeInvoiceItemHtml(label)}</span>
    </span>
  `;
}

export function getInvoiceItemDescriptionHtml(
  name: string,
  options: InvoiceItemDescriptionHtmlOptions = {},
): string {
  const { displayName, indicators, packingType } = getInvoiceItemDisplayDetails(name);
  const {
    fontSizePx = 10,
    indicatorFontSizePx = fontSizePx,
    packingFontSizePx = 10,
    packingGapPx = 12,
    packingMarginTopPx = 4,
    indicatorGapPx = 6,
    boxSizePx = 12,
    lineHeight = 1.35,
    nameSuffixHtml = "",
  } = options;

  const nameLineHtml = `
    <div style="display:flex; align-items:center; flex-wrap:wrap; gap:${indicatorGapPx}px; min-width:0; flex:1 1 auto;">
      <span style="font-size:${fontSizePx}px;">${escapeInvoiceItemHtml(displayName)}${nameSuffixHtml}</span>
      ${indicators
        .map((indicator) => getStaticIndicatorHtml(indicator, indicatorFontSizePx))
        .join("")}
    </div>
  `;

  const packingHtml = packingType
    ? `
      <div style="display:flex; flex-wrap:nowrap; justify-content:flex-end; align-items:center; text-align:right; gap:${packingGapPx}px; margin-left:auto; white-space:nowrap; flex:0 0 auto; font-size:${packingFontSizePx}px;">
        ${getStaticPackingOptionHtml("Folding", packingType === "folding", {
          packingFontSizePx,
          boxSizePx,
        })}
        ${getStaticPackingOptionHtml("Hanging", packingType === "hanging", {
          packingFontSizePx,
          boxSizePx,
        })}
      </div>
    `
    : "";

  return `
    <div style="line-height:${lineHeight};">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%;">
        ${nameLineHtml}
        ${packingHtml}
      </div>
    </div>
  `;
}

function PackingOption({
  checked,
  label,
  optionStyle,
}: {
  checked: boolean;
  label: string;
  optionStyle?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        whiteSpace: "nowrap",
        ...optionStyle,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          ...BOX_BASE_STYLE,
          position: "relative",
        }}
      >
        {checked && (
          <span
            style={{
              position: "absolute",
              top: "0px",
              left: "3px",
              width: "4px",
              height: "8px",
              borderRight: "2px solid #dc2626",
              borderBottom: "2px solid #dc2626",
              transform: "rotate(45deg)",
            }}
          />
        )}
      </span>
      <span>{label}</span>
    </span>
  );
}

export function InvoiceItemDescription({
  name,
  containerStyle,
  packingRowStyle,
  optionStyle,
  packingPlacement = "inline",
}: InvoiceItemDescriptionProps) {
  const { displayName, indicators, packingType } = getInvoiceItemDisplayDetails(name);

  const nameContent = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px",
        minWidth: 0,
        flex: "1 1 auto",
      }}
    >
      <span>{displayName}</span>
      {indicators.map((indicator) => (
        <span
          key={`${indicator.label}-${indicator.color}`}
          style={{ color: indicator.color, fontWeight: 700 }}
        >
          [{indicator.label}]
        </span>
      ))}
    </div>
  );

  const packingContent = packingType ? (
    <div
      style={{
        display: "flex",
        flexWrap: "nowrap",
        justifyContent: "flex-end",
        alignItems: "center",
        textAlign: "right",
        gap: "12px",
        marginLeft: packingPlacement === "inline" ? "auto" : undefined,
        whiteSpace: "nowrap",
        flex: packingPlacement === "inline" ? "0 0 auto" : undefined,
        fontSize: "10px",
        ...packingRowStyle,
      }}
    >
      <PackingOption
        checked={packingType === "folding"}
        label="Folding"
        optionStyle={optionStyle}
      />
      <PackingOption
        checked={packingType === "hanging"}
        label="Hanging"
        optionStyle={optionStyle}
      />
    </div>
  ) : null;

  return (
    <div style={{ lineHeight: 1.35, ...containerStyle }}>
      {packingPlacement === "stacked" ? (
        <>
          {nameContent}
          {packingContent && (
            <div
              style={{
                marginTop: "4px",
              }}
            >
              {packingContent}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {nameContent}
          {packingContent}
        </div>
      )}
    </div>
  );
}

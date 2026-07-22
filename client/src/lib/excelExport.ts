import ExcelJS from "exceljs";

interface ColumnWidth {
  wch: number;
}

export interface RichTextRun {
  text: string;
  font?: {
    bold?: boolean;
    color?: { argb: string };
  };
}

export interface RichTextCell {
  richText: RichTextRun[];
}

export type ExcelExportCell = string | number | null | undefined | RichTextCell;

export interface CellStyle {
  row: number;
  col: number;
  fill?: { color: string };
  font?: { color?: string; bold?: boolean };
  alignment?: {
    wrapText?: boolean;
    vertical?: "top" | "middle" | "bottom";
    horizontal?: "left" | "center" | "right";
  };
}

interface ExportOptions {
  data: ExcelExportCell[][];
  sheetName: string;
  fileName: string;
  columns?: ColumnWidth[];
  autoFilterRef?: string;
  cellStyles?: CellStyle[];
  rowHeights?: Array<{ row: number; height: number }>;
}

const getCellDisplayText = (cell: ExcelExportCell) => {
  if (cell == null) return "";
  if (typeof cell === "object" && "richText" in cell) {
    return cell.richText.map((segment) => segment.text).join("");
  }
  return String(cell);
};

export async function exportToExcel({ data, sheetName, fileName, columns, autoFilterRef, cellStyles, rowHeights }: ExportOptions) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  for (const row of data) {
    worksheet.addRow(row.map((cell) => cell ?? "") as any[]);
  }

  const colCount = Math.max(...data.map(row => row.length), 0);
  for (let colIdx = 0; colIdx < colCount; colIdx++) {
    let maxLen = columns && columns[colIdx] ? columns[colIdx].wch : 8;
    for (const row of data) {
      const cellValue = row[colIdx];
      if (cellValue != null) {
        const cellLen = getCellDisplayText(cellValue).length + 2;
        if (cellLen > maxLen) maxLen = cellLen;
      }
    }
    const wsCol = worksheet.getColumn(colIdx + 1);
    wsCol.width = Math.min(maxLen, 60);
  }

  if (cellStyles) {
    for (const style of cellStyles) {
      const cell = worksheet.getCell(style.row, style.col);
      if (style.fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: style.fill.color },
        };
      }
      if (style.font) {
        cell.font = {
          ...(cell.font || {}),
          ...(style.font.color ? { color: { argb: style.font.color } } : {}),
          ...(style.font.bold !== undefined ? { bold: style.font.bold } : {}),
        };
      }
      if (style.alignment) {
        cell.alignment = {
          ...(cell.alignment || {}),
          ...(style.alignment.wrapText !== undefined ? { wrapText: style.alignment.wrapText } : {}),
          ...(style.alignment.vertical ? { vertical: style.alignment.vertical } : {}),
          ...(style.alignment.horizontal ? { horizontal: style.alignment.horizontal } : {}),
        };
      }
    }
  }

  if (rowHeights) {
    for (const rowStyle of rowHeights) {
      worksheet.getRow(rowStyle.row).height = rowStyle.height;
    }
  }

  if (autoFilterRef) {
    worksheet.autoFilter = autoFilterRef;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

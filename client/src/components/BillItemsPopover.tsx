import { type ReactElement, useMemo, useState } from "react";
import { Package, Receipt } from "lucide-react";

import { InvoiceItemDescription, getInvoiceItemDisplayDetails } from "@/components/InvoiceItemDescription";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BillPopoverItem = {
  name: string;
  qty: number;
  price: number;
  total: number;
};

type BillItemsPopoverProps = {
  items: BillPopoverItem[];
  rawDescription?: string | null;
  title?: string;
  subtitle?: string;
  dataTestId?: string;
  trigger?: ReactElement;
  triggerMode?: "dialog" | "popover";
  popoverAlign?: "start" | "center" | "end";
  popoverContentClassName?: string;
  disablePortal?: boolean;
};

function formatBillPopoverItemName(value: string) {
  return getInvoiceItemDisplayDetails(value).displayName;
}

export function BillItemsPopover({
  items,
  rawDescription,
  title = "Bill Items",
  subtitle,
  dataTestId,
  trigger,
  triggerMode = "dialog",
  popoverAlign = "end",
  popoverContentClassName,
  disablePortal = false,
}: BillItemsPopoverProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const safeItems = useMemo(
    () =>
      (items || []).filter(
        (item) => item && String(item.name || "").trim().length > 0,
      ),
    [items],
  );

  const lineCount = safeItems.length;
  const totalPieces = safeItems.reduce(
    (sum, item) => sum + (Number.isFinite(item.qty) ? item.qty : 0),
    0,
  );
  const totalAmount = safeItems.reduce((sum, item) => {
    const lineTotal = Number.isFinite(item.total)
      ? item.total
      : (Number.isFinite(item.qty) ? item.qty : 0) *
        (Number.isFinite(item.price) ? item.price : 0);
    return sum + lineTotal;
  }, 0);
  const previewText = safeItems
    .slice(0, 2)
    .map((item) => `${item.qty}x ${formatBillPopoverItemName(item.name)}`)
    .join(" - ");

  if (lineCount === 0 && !String(rawDescription || "").trim()) {
    return null;
  }

  const tableBody = lineCount > 0 ? (
    <div
      className="overflow-y-auto overscroll-contain touch-pan-y"
      onWheelCapture={(event) => event.stopPropagation()}
      onTouchMoveCapture={(event) => event.stopPropagation()}
      style={{
        maxHeight: "min(30rem, calc(100vh - 10rem))",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-background/90">
            <TableHead className="w-9 text-center">#</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="w-12 text-center">Qty</TableHead>
            <TableHead className="w-20 text-right">Unit</TableHead>
            <TableHead className="w-20 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {safeItems.map((item, index) => {
            const unitPrice = Number.isFinite(item.price) ? item.price : 0;
            const lineTotal = Number.isFinite(item.total)
              ? item.total
              : unitPrice * (Number.isFinite(item.qty) ? item.qty : 0);

            return (
              <TableRow key={`${item.name}-${index}`}>
                <TableCell className="text-center text-xs text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell className="min-w-0 align-top text-sm">
                  <div className="break-words font-medium text-foreground">
                    <InvoiceItemDescription
                      name={item.name}
                      packingPlacement="stacked"
                      packingRowStyle={{ fontSize: "10px", gap: "8px" }}
                      optionStyle={{ gap: "4px" }}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-center align-top text-sm font-medium">
                  {item.qty}
                </TableCell>
                <TableCell className="align-top text-right text-sm text-muted-foreground">
                  {unitPrice.toFixed(2)} AED
                </TableCell>
                <TableCell className="align-top text-right text-sm font-semibold text-foreground">
                  {lineTotal.toFixed(2)} AED
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/35">
            <TableCell colSpan={2} className="text-sm font-semibold">
              Totals
            </TableCell>
            <TableCell className="text-center text-sm font-semibold">
              {totalPieces}
            </TableCell>
            <TableCell />
            <TableCell className="text-right text-sm font-bold text-primary">
              {totalAmount.toFixed(2)} AED
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ) : (
    <div className="px-4 py-3 text-sm text-muted-foreground">
      {rawDescription}
    </div>
  );

  const contentBody = (
    <>
      <div className="border-b bg-muted/35 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">
                {title}
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {subtitle ||
                `${lineCount} line item${lineCount === 1 ? "" : "s"} - ${totalPieces} pcs`}
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {totalAmount.toFixed(2)} AED
          </Badge>
        </div>
      </div>
      {tableBody}
    </>
  );

  const popoverContent = (
    <PopoverContent
      className={`${popoverContentClassName || "w-[calc(100vw-2rem)] max-w-[56rem]"} overflow-hidden p-0`}
      align={popoverAlign}
      portalled={!disablePortal}
      collisionPadding={20}
      style={{
        maxHeight: "min(40rem, calc(100vh - 2rem))",
      }}
    >
      {contentBody}
    </PopoverContent>
  );

  const dialogContent = (
    <DialogContent
      aria-describedby={undefined}
      className="w-[min(96vw,56rem)] max-w-[56rem] overflow-hidden p-0"
    >
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {subtitle ||
            `${lineCount} line item${lineCount === 1 ? "" : "s"} and ${totalPieces} pieces`}
        </DialogDescription>
      </DialogHeader>
      {contentBody}
    </DialogContent>
  );

  if (trigger) {
    if (triggerMode === "popover") {
      return (
        <Popover>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          {popoverContent}
        </Popover>
      );
    }

    return (
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        {dialogContent}
      </Dialog>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-muted/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Items
          </p>
          {lineCount > 0 ? (
            <>
              <p className="mt-1 text-sm font-medium text-foreground">
                {lineCount} line item{lineCount === 1 ? "" : "s"} - {totalPieces} pcs
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {previewText}
                {lineCount > 2 ? " ..." : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {rawDescription}
            </p>
          )}
        </div>

        {lineCount > 0 &&
          (disablePortal ? (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-lg border-primary/20 bg-background/90 text-primary hover:bg-primary/5"
                  data-testid={dataTestId}
                >
                  <Package className="mr-1.5 h-4 w-4" />
                  View Table
                </Button>
              </DialogTrigger>
              {dialogContent}
            </Dialog>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-lg border-primary/20 bg-background/90 text-primary hover:bg-primary/5"
                  data-testid={dataTestId}
                >
                  <Package className="mr-1.5 h-4 w-4" />
                  View Table
                </Button>
              </PopoverTrigger>
              {popoverContent}
            </Popover>
          ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

interface CenteredDatePickerProps {
  value: string;
  onChange: (date: string) => void;
  testIdPrefix?: string;
  floatingBoundarySelector?: string;
  triggerClassName?: string;
  triggerTestId?: string;
  disabled?: boolean;
  displayLabel?: string;
  hideQuickOptions?: boolean;
}

function parseLocalDate(value: string): Date | undefined {
  if (!value) return undefined;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;

  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function CenteredDatePicker({
  value,
  onChange,
  testIdPrefix = "",
  floatingBoundarySelector = "[data-clock-overlay-root]",
  triggerClassName,
  triggerTestId,
  disabled = false,
  displayLabel,
  hideQuickOptions = false,
}: CenteredDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const [overlayBounds, setOverlayBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelWidth = 292;
  const estimatedPanelHeight = hideQuickOptions ? 320 : 360;
  const selectedDate = parseLocalDate(value);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
    const maxTop = Math.max(
      margin,
      window.innerHeight - estimatedPanelHeight - margin,
    );
    const boundary = trigger.closest(floatingBoundarySelector) as HTMLElement | null;
    const rect = boundary?.getBoundingClientRect() || {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    const left = Math.min(
      Math.max(margin, rect.left + (rect.width - panelWidth) / 2),
      maxLeft,
    );
    const top = Math.min(
      Math.max(margin, rect.top + (rect.height - estimatedPanelHeight) / 2),
      maxTop,
    );

    setOverlayBounds(
      boundary
        ? {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }
        : null,
    );
    setPanelPosition({ top, left });
  }, [floatingBoundarySelector]);

  useEffect(() => {
    if (!open) return;

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  const displayDate = displayLabel || (selectedDate
    ? format(selectedDate, "MM/dd/yyyy")
    : "Set Date");

  return (
    <div className="relative min-w-0">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-8 min-w-0 gap-1 px-2 text-xs",
          open && "border-primary bg-primary/10 text-primary ring-2 ring-primary/20",
          triggerClassName,
        )}
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid={triggerTestId || `${testIdPrefix}button-date-picker`}
      >
        <CalendarDays className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{displayDate}</span>
      </Button>

      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[9997]"
              onClick={() => setOpen(false)}
            />
            {overlayBounds && (
              <div
                className="fixed z-[9998] pointer-events-none bg-background/55 backdrop-blur-[1px] ring-1 ring-primary/15"
                style={overlayBounds}
              />
            )}
            <div
              className="fixed z-[9999] rounded-lg border border-border bg-card p-2 text-card-foreground shadow-[0_20px_45px_rgba(15,23,42,0.22)]"
              style={{
                top: panelPosition.top,
                left: panelPosition.left,
                width: panelWidth,
              }}
            >
              {!hideQuickOptions && (
                <div className="mb-2 grid grid-cols-2 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      value === formatLocalDate(new Date()) ? "default" : "outline"
                    }
                    className="h-7 text-[11px]"
                    onClick={() => {
                      onChange(formatLocalDate(new Date()));
                      setOpen(false);
                    }}
                    data-testid={`${testIdPrefix}button-date-picker-today`}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      value ===
                      formatLocalDate(new Date(Date.now() + 86400000))
                        ? "default"
                        : "outline"
                    }
                    className="h-7 text-[11px]"
                    onClick={() => {
                      onChange(formatLocalDate(new Date(Date.now() + 86400000)));
                      setOpen(false);
                    }}
                    data-testid={`${testIdPrefix}button-date-picker-tomorrow`}
                  >
                    Tomorrow
                  </Button>
                </div>
              )}
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (!date) return;
                    onChange(formatLocalDate(date));
                    setOpen(false);
                  }}
                  initialFocus
                  className="mx-auto p-1"
                />
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AnalogClockPickerProps {
  value: string;
  onChange: (time: string) => void;
  testIdPrefix?: string;
  floatingPlacement?: "trigger" | "container-center";
  floatingBoundarySelector?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

type Mode = "hour" | "minute" | "period";

export function AnalogClockPicker({
  value,
  onChange,
  testIdPrefix = "",
  floatingPlacement = "trigger",
  floatingBoundarySelector,
  triggerClassName,
  disabled = false,
}: AnalogClockPickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("hour");
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const [overlayBounds, setOverlayBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  
  const parsed = parseTime(value);
  const [selectedHour, setSelectedHour] = useState(parsed.hour);
  const [selectedMinute, setSelectedMinute] = useState(parsed.minute);
  const [selectedPeriod, setSelectedPeriod] = useState<"AM" | "PM">(parsed.period);
  const [hourInput, setHourInput] = useState(String(parsed.hour));
  const [minuteInput, setMinuteInput] = useState(parsed.minute.toString().padStart(2, "0"));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const clockRef = useRef<SVGSVGElement>(null);
  const panelWidth = floatingPlacement === "container-center" ? 260 : 230;
  const estimatedPanelHeight = floatingPlacement === "container-center" ? 350 : 318;

  function parseTime(timeStr: string): { hour: number; minute: number; period: "AM" | "PM" } {
    if (!timeStr) return { hour: 12, minute: 0, period: "PM" };
    const [h, m] = timeStr.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return { hour: hour12, minute: m || 0, period };
  }

  function to24(hour: number, period: "AM" | "PM"): number {
    if (period === "AM") return hour === 12 ? 0 : hour;
    return hour === 12 ? 12 : hour + 12;
  }

  function emitTime(h: number, m: number, p: "AM" | "PM") {
    const h24 = to24(h, p);
    onChange(`${h24.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
  }

  function normalizeHourInput(inputValue: string, fallback: number) {
    if (!inputValue.trim()) return fallback;
    const parsedHour = Number(inputValue);
    if (!Number.isInteger(parsedHour)) return fallback;
    return Math.min(Math.max(parsedHour, 1), 12);
  }

  function normalizeMinuteInput(inputValue: string, fallback: number) {
    if (!inputValue.trim()) return fallback;
    const parsedMinute = Number(inputValue);
    if (!Number.isInteger(parsedMinute)) return fallback;
    return Math.min(Math.max(parsedMinute, 0), 59);
  }

  function syncInputValues(h: number, m: number) {
    setHourInput(String(h));
    setMinuteInput(m.toString().padStart(2, "0"));
  }

  function commitTypedTime() {
    const nextHour = normalizeHourInput(hourInput, selectedHour);
    const nextMinute = normalizeMinuteInput(minuteInput, selectedMinute);
    setSelectedHour(nextHour);
    setSelectedMinute(nextMinute);
    syncInputValues(nextHour, nextMinute);
    emitTime(nextHour, nextMinute, selectedPeriod);
  }

  const handleHourInputChange = (nextValue: string) => {
    const digits = nextValue.replace(/\D/g, "").slice(0, 2);
    setHourInput(digits);

    const parsedHour = Number(digits);
    if (Number.isInteger(parsedHour) && parsedHour >= 1 && parsedHour <= 12) {
      setSelectedHour(parsedHour);
    }
  };

  const handleMinuteInputChange = (nextValue: string) => {
    const digits = nextValue.replace(/\D/g, "").slice(0, 2);
    setMinuteInput(digits);

    const parsedMinute = Number(digits);
    if (Number.isInteger(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59) {
      setSelectedMinute(parsedMinute);
    }
  };

  const handleTimeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitTypedTime();
      e.currentTarget.blur();
    }
  };

  useEffect(() => {
    const next = parseTime(value);
    setSelectedHour(next.hour);
    setSelectedMinute(next.minute);
    setSelectedPeriod(next.period);
    syncInputValues(next.hour, next.minute);
  }, [value]);

  const handleClockClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = clockRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    let angle = Math.atan2(x, -y) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    if (mode === "hour") {
      let hour = Math.round(angle / 30);
      if (hour === 0) hour = 12;
      setSelectedHour(hour);
      setHourInput(String(hour));
      emitTime(hour, selectedMinute, selectedPeriod);
      setTimeout(() => setMode("minute"), 200);
    } else if (mode === "minute") {
      let minute = Math.round(angle / 6);
      if (minute >= 60) minute = 0;
      setSelectedMinute(minute);
      setMinuteInput(minute.toString().padStart(2, "0"));
      emitTime(selectedHour, minute, selectedPeriod);
    }
  }, [mode, selectedHour, selectedMinute, selectedPeriod]);

  const togglePeriod = (p: "AM" | "PM") => {
    setSelectedPeriod(p);
    emitTime(selectedHour, selectedMinute, p);
  };

  const openPicker = () => {
    const p = parseTime(value);
    setSelectedHour(p.hour);
    setSelectedMinute(p.minute);
    setSelectedPeriod(p.period);
    syncInputValues(p.hour, p.minute);
    setMode("hour");
    setOpen(true);
  };

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
    const maxTop = Math.max(
      margin,
      window.innerHeight - estimatedPanelHeight - margin,
    );

    if (floatingPlacement === "container-center") {
      const boundary = trigger.closest(
        floatingBoundarySelector || "[data-clock-overlay-root]",
      ) as HTMLElement | null;
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
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const left = Math.min(
      Math.max(margin, rect.right - panelWidth),
      maxLeft,
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= estimatedPanelHeight + margin
        ? rect.bottom + 4
        : Math.max(margin, rect.top - estimatedPanelHeight - 4);

    setOverlayBounds(null);
    setPanelPosition({ top, left });
  }, [
    estimatedPanelHeight,
    floatingBoundarySelector,
    floatingPlacement,
    panelWidth,
  ]);

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

  const radius = 80;
  const centerX = 100;
  const centerY = 100;

  const numbers = mode === "hour"
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const handAngle = mode === "hour"
    ? (selectedHour % 12) * 30
    : selectedMinute * 6;

  const handRad = (handAngle - 90) * (Math.PI / 180);
  const handLength = mode === "hour" ? 58 : 52;
  const handX = centerX + handLength * Math.cos(handRad);
  const handY = centerY + handLength * Math.sin(handRad);

  const displayTime = value
    ? `${selectedHour}:${selectedMinute.toString().padStart(2, "0")} ${selectedPeriod}`
    : "";

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-8 text-xs gap-1 px-2", triggerClassName)}
        disabled={disabled}
        onClick={openPicker}
        data-testid={`${testIdPrefix}button-clock-picker`}
      >
        <Clock className="w-3 h-3" />
        {displayTime || "Set Time"}
      </Button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9997]" onClick={() => setOpen(false)} />
          {overlayBounds && (
            <div
              className="fixed z-[9998] pointer-events-none bg-background/55 backdrop-blur-[1px] ring-1 ring-primary/15"
              style={overlayBounds}
            />
          )}
          <div
            className="fixed z-[9999] rounded-lg border border-border bg-card p-4 shadow-[0_20px_45px_rgba(15,23,42,0.22)]"
            style={{
              top: panelPosition.top,
              left: panelPosition.left,
              width: panelWidth,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <input
                  aria-label="Hour"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={hourInput}
                  onFocus={(e) => {
                    setMode("hour");
                    e.currentTarget.select();
                  }}
                  onClick={() => setMode("hour")}
                  onChange={(e) => handleHourInputChange(e.target.value)}
                  onBlur={commitTypedTime}
                  onKeyDown={handleTimeInputKeyDown}
                  className={`h-8 w-10 rounded border px-1 text-center text-sm font-bold tabular-nums outline-none ${
                    mode === "hour"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                  }`}
                  data-testid={`${testIdPrefix}input-hour`}
                />
                <span className="text-xs font-bold self-center">:</span>
                <input
                  aria-label="Minute"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={minuteInput}
                  onFocus={(e) => {
                    setMode("minute");
                    e.currentTarget.select();
                  }}
                  onClick={() => setMode("minute")}
                  onChange={(e) => handleMinuteInputChange(e.target.value)}
                  onBlur={commitTypedTime}
                  onKeyDown={handleTimeInputKeyDown}
                  className={`h-8 w-10 rounded border px-1 text-center text-sm font-bold tabular-nums outline-none ${
                    mode === "minute"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                  }`}
                  data-testid={`${testIdPrefix}input-minute`}
                />
              </div>
              <div className="flex gap-0.5">
                <button
                  className={`px-2 py-1 rounded text-[10px] font-bold ${selectedPeriod === "AM" ? "bg-primary text-primary-foreground" : "text-muted-foreground border"}`}
                  onClick={() => togglePeriod("AM")}
                  data-testid={`${testIdPrefix}button-am`}
                >
                  AM
                </button>
                <button
                  className={`px-2 py-1 rounded text-[10px] font-bold ${selectedPeriod === "PM" ? "bg-primary text-primary-foreground" : "text-muted-foreground border"}`}
                  onClick={() => togglePeriod("PM")}
                  data-testid={`${testIdPrefix}button-pm`}
                >
                  PM
                </button>
              </div>
            </div>

            <svg
              ref={clockRef}
              viewBox="0 0 200 200"
              className="w-full cursor-pointer"
              onClick={handleClockClick}
              data-testid={`${testIdPrefix}clock-face`}
            >
              <circle cx={centerX} cy={centerY} r={radius + 12} className="fill-muted/30 stroke-border" strokeWidth="1" />
              <circle cx={centerX} cy={centerY} r="3" className="fill-primary" />

              {mode === "minute" && Array.from({ length: 12 }, (_, i) => i).map((i) => {
                const angle = i * 30 - 90;
                const rad = angle * (Math.PI / 180);
                const isQuarter = i % 3 === 0;
                const innerRadius = isQuarter ? 75 : 78;
                const outerRadius = 84;
                const x1 = centerX + innerRadius * Math.cos(rad);
                const y1 = centerY + innerRadius * Math.sin(rad);
                const x2 = centerX + outerRadius * Math.cos(rad);
                const y2 = centerY + outerRadius * Math.sin(rad);

                return (
                  <line
                    key={`minute-tick-${i}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className={isQuarter ? "stroke-muted-foreground/55" : "stroke-muted-foreground/30"}
                    strokeWidth={isQuarter ? "2" : "1.25"}
                    strokeLinecap="round"
                  />
                );
              })}

              <line
                x1={centerX}
                y1={centerY}
                x2={handX}
                y2={handY}
                className="stroke-primary"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx={handX} cy={handY} r={mode === "hour" ? "14" : "8"} className={mode === "hour" ? "fill-primary/20" : "fill-primary"} />
              {mode === "minute" && <circle cx={handX} cy={handY} r="2.5" className="fill-primary-foreground" />}

              {numbers.map((num) => {
                const pos = mode === "hour" ? num : num / 5;
                const totalPos = mode === "hour" ? 12 : 12;
                const angle = (pos * 360) / totalPos - 90;
                const rad = angle * (Math.PI / 180);
                const r = mode === "hour" ? 65 : 67;
                const x = centerX + r * Math.cos(rad);
                const y = centerY + r * Math.sin(rad);
                const isSelected = mode === "hour" ? num === selectedHour : num === selectedMinute;

                return (
                  <g key={`${mode}-${num}`}>
                    {mode === "hour" && isSelected && (
                      <circle cx={x} cy={y} r="14" className="fill-primary" />
                    )}
                    <text
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={
                        mode === "hour"
                          ? `text-[11px] font-medium select-none ${isSelected ? "fill-primary-foreground" : "fill-foreground"}`
                          : `text-[9px] font-semibold select-none ${
                              isSelected ? "fill-primary" : "fill-muted-foreground"
                            }`
                      }
                    >
                      {mode === "minute" ? num.toString().padStart(2, "0") : num}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="flex justify-end mt-2">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  commitTypedTime();
                  setOpen(false);
                }}
                data-testid={`${testIdPrefix}button-clock-done`}
              >
                Done
              </Button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

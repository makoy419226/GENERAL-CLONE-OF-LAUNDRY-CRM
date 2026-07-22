import React, { useState, useEffect } from "react";
import { Calendar } from "./calendar";
import { AnalogClockPicker } from "../AnalogClockPicker";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";
import { Input } from "./input";
import { Check } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface DateTimeRangePickerProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  label?: string;
  singleCalendar?: boolean;
  textOnly?: boolean;
}

export function DateTimeRangePicker({ start, end, onChange, label, singleCalendar = false, textOnly = false }: DateTimeRangePickerProps) {
  const isMobile = useIsMobile();
  const [startDate, setStartDate] = useState(start.split("T")[0]);
  const [startTime, setStartTime] = useState(start.split("T")[1]?.slice(0,5) || "00:00");
  const [endDate, setEndDate] = useState(end.split("T")[0]);
  const [endTime, setEndTime] = useState(end.split("T")[1]?.slice(0,5) || "23:59");
  const [open, setOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const sDate = start.split("T")[0];
    const sTime = start.split("T")[1]?.slice(0,5) || "00:00";
    setStartDate(sDate);
    setStartTime(sTime);
  }, [start]);

  useEffect(() => {
    const eDate = end.split("T")[0];
    const eTime = end.split("T")[1]?.slice(0,5) || "23:59";
    setEndDate(eDate);
    setEndTime(eTime);
  }, [end]);

  function handleStartDateChange(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const nextDate = `${y}-${m}-${d}`;
    setStartDate(nextDate);
    if (singleCalendar) {
      setEndDate(nextDate);
    }
    setHasChanges(true);
  }
  function handleEndDateChange(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    setEndDate(`${y}-${m}-${d}`);
    setHasChanges(true);
  }
  function handleStartTimeChange(time: string) {
    setStartTime(time);
    setHasChanges(true);
  }
  function handleEndTimeChange(time: string) {
    setEndTime(time);
    setHasChanges(true);
  }

  function handleStartDateTimeInputChange(value: string) {
    if (!value) return;
    const [datePart, timePart = "00:00"] = value.split("T");
    setStartDate(datePart);
    setStartTime(timePart.slice(0, 5));
    if (singleCalendar) {
      setEndDate(datePart);
    }
    setHasChanges(true);
  }

  function handleEndDateTimeInputChange(value: string) {
    if (!value) return;
    const [datePart, timePart = "23:59"] = value.split("T");
    setEndDate(datePart);
    setEndTime(timePart.slice(0, 5));
    setHasChanges(true);
  }

  function handleApply() {
    const appliedEndDate = singleCalendar ? startDate : endDate;
    onChange(`${startDate}T${startTime}`, `${appliedEndDate}T${endTime}`);
    setHasChanges(false);
    setOpen(false);
  }

  const formatRangeLabel = () => {
    const startISO = `${startDate}T${startTime}`;
    const endISO = `${endDate}T${endTime}`;
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    };
    return `${fmt(startISO)} - ${fmt(endISO)}`;
  };

  return (
    <div className="flex flex-col gap-2">
      {label && <label className="font-semibold mb-1">{label}</label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={textOnly ? "ghost" : "outline"}
            className={
              textOnly
                ? `h-8 min-h-0 w-full min-w-0 justify-center rounded-none border-0 bg-transparent px-1 text-center font-semibold text-foreground shadow-none hover:bg-transparent hover:text-primary hover:shadow-none focus-visible:ring-0 ${isMobile ? "!text-[12px]" : "text-sm"}`
                : isMobile
                  ? "h-9 w-full min-w-0 justify-start rounded-xl px-3 text-left text-[12px] font-normal"
                  : "min-w-[280px] justify-start text-left font-normal"
            }
            data-testid="button-open-datetime-range"
          >
            <span className="truncate">{formatRangeLabel()}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className={isMobile ? "w-[calc(100vw-2rem)] max-w-sm p-3" : "w-auto p-3"} align={isMobile ? "center" : "start"}>
          {isMobile ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">From</div>
                <Input
                  type="datetime-local"
                  value={`${startDate}T${startTime}`}
                  onChange={(event) => handleStartDateTimeInputChange(event.target.value)}
                  className="h-9 rounded-xl text-sm [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
              {singleCalendar ? (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">End Time</div>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(event) => handleEndTimeChange(event.target.value)}
                    className="h-9 rounded-xl text-sm [color-scheme:light] dark:[color-scheme:dark]"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">To</div>
                  <Input
                    type="datetime-local"
                    value={`${endDate}T${endTime}`}
                    onChange={(event) => handleEndDateTimeInputChange(event.target.value)}
                    className="h-9 rounded-xl text-sm [color-scheme:light] dark:[color-scheme:dark]"
                  />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleApply}
                  className="h-9 rounded-xl gap-1.5"
                  data-testid="button-apply-datetime-range"
                >
                  <Check className="w-4 h-4" />
                  Apply Range
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-4 items-start">
              <div>
                <div className="text-xs mb-1">Start</div>
                <Calendar
                  mode="single"
                  selected={startDate ? new Date(startDate + "T00:00:00") : undefined}
                  onSelect={(date) => date && handleStartDateChange(date)}
                />
                <AnalogClockPicker value={startTime} onChange={handleStartTimeChange} testIdPrefix="start-" />
              </div>
              {singleCalendar ? (
                <div className="min-w-[220px]">
                  <div className="text-xs mb-1">End Time</div>
                  <AnalogClockPicker value={endTime} onChange={handleEndTimeChange} testIdPrefix="end-" />
                </div>
              ) : (
                <div>
                  <div className="text-xs mb-1">End</div>
                  <Calendar
                    mode="single"
                    selected={endDate ? new Date(endDate + "T00:00:00") : undefined}
                    onSelect={(date) => date && handleEndDateChange(date)}
                  />
                  <AnalogClockPicker value={endTime} onChange={handleEndTimeChange} testIdPrefix="end-" />
                </div>
              )}
            </div>
          )}
          {!isMobile && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={handleApply}
                className="gap-1.5"
                data-testid="button-apply-datetime-range"
              >
                <Check className="w-4 h-4" />
                Apply Range
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

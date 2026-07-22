import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface TouchSelectOption {
  value: string;
  label: string;
}

interface TouchSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: TouchSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function TouchSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchable = false,
  className,
  "data-testid": testId,
}: TouchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedOption = options.find((opt) => opt.value === value);
  const filteredOptions = searchable && search
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue);
    setOpen(false);
    setSearch("");
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className={cn(
          "h-9 w-full justify-between border-border/70 bg-background/95 font-normal shadow-sm hover:bg-muted/60",
          !value && "text-muted-foreground",
          className
        )}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] border-border/70 bg-card/95 p-0 shadow-2xl backdrop-blur-xl sm:max-w-md">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>{placeholder}</DialogTitle>
          </DialogHeader>
          
          {searchable && (
            <div className="px-4 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  autoFocus={false}
                />
              </div>
            </div>
          )}

          <ScrollArea className="max-h-[50vh]">
            <div className="p-2">
              {filteredOptions.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">
                  No options found
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-3 text-left text-foreground transition-colors",
                      "hover:bg-muted/70 active:bg-muted",
                      value === option.value && "bg-primary/10"
                    )}
                    style={{ touchAction: "manipulation" }}
                  >
                    <div className="w-5 h-5 flex items-center justify-center">
                      {value === option.value && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <span className="flex-1 truncate">{option.label}</span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

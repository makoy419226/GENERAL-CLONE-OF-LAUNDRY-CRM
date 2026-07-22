import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { InvoiceItemDescription } from "@/components/InvoiceItemDescription";
import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";
import type { StageChecklist as StageChecklistType } from "@shared/schema";

interface ParsedItem {
  name: string;
  quantity: number;
  index: number;
}

interface StageChecklistProps {
  orderId: number;
  orderNumber: string;
  stage: "tagging" | "washing" | "sorting" | "folding" | "packing";
  items: string | null;
  workerId?: number;
  workerName?: string;
  onComplete?: () => void;
  onCompletionChange?: (isComplete: boolean) => void;
  disabled?: boolean;
}

const stageLabels: Record<string, string> = {
  tagging: "Tagging",
  washing: "Washing",
  sorting: "Sorting",
  folding: "Folding/Ironing",
  packing: "Packing",
};

export function StageChecklist({
  orderId,
  orderNumber,
  stage,
  items,
  workerId,
  workerName,
  onComplete,
  onCompletionChange,
  disabled = false,
}: StageChecklistProps) {
  const [localChecked, setLocalChecked] = useState<number[]>([]);
  const checklistRootRef = useRef<HTMLDivElement>(null);

  const parsedItems = parseItems(items);
  const totalItems = parsedItems.length;

  const { data: checklist, isLoading } = useQuery<StageChecklistType | null>({
    queryKey: ["/api/stage-checklists/order", orderId, stage],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/stage-checklists/order/${orderId}/${stage}`, {
        signal,
      });
      if (!res.ok) throw new Error("Failed to fetch checklist");
      return res.json();
    },
    enabled: totalItems > 0,
  });

  const createChecklistMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/stage-checklists", {
        orderId,
        stage,
        totalItems,
        workerId,
        workerName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-checklists/order", orderId, stage] });
    },
  });

  const toggleItemMutation = useMutation({
    mutationFn: async ({ itemIndex, checked }: { itemIndex: number; checked: boolean }) => {
      return apiRequest("PUT", `/api/stage-checklists/order/${orderId}/${stage}/toggle`, {
        itemIndex,
        checked,
        workerId,
        workerName,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-checklists/order", orderId, stage] });
      if (data.isComplete && onComplete) {
        onComplete();
      }
    },
  });

  // Batch toggle for "check all" / "uncheck all" - single API call
  const toggleAllMutation = useMutation({
    mutationFn: async ({ checkedItems }: { checkedItems: number[] }) => {
      return apiRequest("PUT", `/api/stage-checklists/order/${orderId}/${stage}/toggle-all`, {
        checkedItems,
        workerId,
        workerName,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stage-checklists/order", orderId, stage] });
      if (data.isComplete && onComplete) {
        onComplete();
      }
    },
  });

  useEffect(() => {
    if (checklist?.checkedItems) {
      try {
        setLocalChecked(JSON.parse(checklist.checkedItems));
      } catch {
        setLocalChecked([]);
      }
    }
  }, [checklist]);

  useEffect(() => {
    if (totalItems > 0 && !checklist && !isLoading) {
      createChecklistMutation.mutate();
    }
  }, [totalItems, checklist, isLoading]);

  const handleToggle = (itemIndex: number, checked: boolean) => {
    if (disabled) return;
    
    if (checked) {
      setLocalChecked(prev => [...prev, itemIndex]);
    } else {
      setLocalChecked(prev => prev.filter(i => i !== itemIndex));
    }
    
    toggleItemMutation.mutate({ itemIndex, checked });
  };

  const handleToggleAll = useCallback(() => {
    if (disabled || toggleAllMutation.isPending) return;
    
    const allIndices = parsedItems.map(item => item.index);
    const allChecked = allIndices.every(index => localChecked.includes(index));
    
    if (allChecked) {
      // Uncheck all - single API call
      setLocalChecked([]);
      toggleAllMutation.mutate({ checkedItems: [] });
    } else {
      // Check all - single API call
      setLocalChecked(allIndices);
      toggleAllMutation.mutate({ checkedItems: allIndices });
    }
  }, [disabled, localChecked, parsedItems, toggleAllMutation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !e.altKey) {
        const openDialog = document.querySelector<HTMLElement>(
          '[role="dialog"][data-state="open"], [aria-modal="true"]',
        );

        if (openDialog && !openDialog.contains(checklistRootRef.current)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        handleToggleAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleToggleAll]);

  const checkedCount = localChecked.length;
  const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0;
  const isComplete = totalItems > 0 && checkedCount >= totalItems;
  const isReadyToContinue =
    isComplete &&
    !disabled &&
    !createChecklistMutation.isPending &&
    !toggleItemMutation.isPending &&
    !toggleAllMutation.isPending;

  useEffect(() => {
    onCompletionChange?.(isReadyToContinue);
  }, [isReadyToContinue, onCompletionChange]);

  if (totalItems === 0) {
    return (
      <Card ref={checklistRootRef} className="border-dashed">
        <CardContent className="p-4 text-center text-muted-foreground">
          No items to verify
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card ref={checklistRootRef}>
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading checklist...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card ref={checklistRootRef} className={isComplete ? "border-green-500 bg-green-50 dark:bg-green-950/20" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Checkbox
              checked={isComplete}
              ref={(el) => {
                if (el) {
                  const someChecked = checkedCount > 0 && checkedCount < totalItems;
                  (el as any).indeterminate = someChecked;
                }
              }}
              onCheckedChange={() => handleToggleAll()}
              disabled={disabled || toggleItemMutation.isPending || toggleAllMutation.isPending}
              data-testid={`checkbox-${stage}-select-all`}
              className="mr-1"
            />
            {stageLabels[stage]} Checklist - {orderNumber}
          </span>
          <Badge variant={isComplete ? "default" : "secondary"} className={isComplete ? "bg-green-600" : ""}>
            {checkedCount}/{totalItems}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={progress} className="h-2" />
        
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {parsedItems.map((item) => {
            const isChecked = localChecked.includes(item.index);
            return (
              <div
                key={item.index}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                  isChecked 
                    ? "bg-green-100 dark:bg-green-900/30" 
                    : "bg-muted/50 hover:bg-muted"
                } ${disabled ? "opacity-50" : ""}`}
              >
                <Checkbox
                  id={`item-${stage}-${item.index}`}
                  checked={isChecked}
                  onCheckedChange={(checked) => handleToggle(item.index, checked === true)}
                  disabled={disabled || toggleItemMutation.isPending}
                  data-testid={`checkbox-${stage}-item-${item.index}`}
                />
                <label
                  htmlFor={`item-${stage}-${item.index}`}
                  className="flex-1 cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <Badge
                      variant="secondary"
                      className={`mt-0.5 shrink-0 text-xs ${isChecked ? "opacity-70" : ""}`}
                    >
                      {item.quantity}x
                    </Badge>
                    <div className={`min-w-0 text-sm ${isChecked ? "opacity-60" : ""}`}>
                      <div className={isChecked ? "text-muted-foreground" : "text-foreground"}>
                        <InvoiceItemDescription
                          name={item.name}
                          packingPlacement="stacked"
                          packingRowStyle={{ justifyContent: "flex-start", gap: "8px", marginLeft: 0, fontSize: "10px" }}
                          optionStyle={{ gap: "4px", fontSize: "10px" }}
                        />
                      </div>
                    </div>
                  </div>
                </label>
                {isChecked && (
                  <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {isComplete && (
          <div className="flex items-center gap-2 p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-700 dark:text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            All items verified for {stageLabels[stage].toLowerCase()}
          </div>
        )}

        {!isComplete && checkedCount > 0 && (
          <div className="flex items-center gap-2 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            {totalItems - checkedCount} item(s) remaining
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function parseItems(items: string | null): ParsedItem[] {
  if (!items) return [];
  
  const trimmed = items.trim();
  
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item: { name: string; quantity: number }, index: number) => ({
          name: item.name,
          quantity: item.quantity || 1,
          index,
        }));
      }
    } catch {}
  }
  
  return trimmed.split(",").map((item, index) => {
    const trimmedItem = item.trim();
    const quantityFirstMatch = trimmedItem.match(/^(\d+)x\s+(.+)$/);
    if (quantityFirstMatch) {
      return {
        name: quantityFirstMatch[2],
        quantity: parseInt(quantityFirstMatch[1]),
        index,
      };
    }
    const nameFirstMatch = trimmedItem.match(/^(.+)\s+x(\d+)$/);
    if (nameFirstMatch) {
      return {
        name: nameFirstMatch[1],
        quantity: parseInt(nameFirstMatch[2]),
        index,
      };
    }
    return {
      name: trimmedItem,
      quantity: 1,
      index,
    };
  }).filter(item => item.name);
}

export default StageChecklist;

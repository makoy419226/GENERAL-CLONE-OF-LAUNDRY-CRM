import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface TopBarProps {
  onSearch: (term: string) => void;
  searchValue: string;
  onAddClick?: () => void;
  addButtonLabel?: string;
  pageTitle: string;
  extraContent?: ReactNode;
  searchPlacement?: "center" | "beside-title";
  compactMobile?: boolean;
  expandMobileSearchOnFocus?: boolean;
  showSearch?: boolean;
}

export function TopBar({
  onSearch,
  searchValue,
  onAddClick,
  addButtonLabel,
  pageTitle,
  extraContent,
  searchPlacement = "center",
  compactMobile = false,
  expandMobileSearchOnFocus = false,
  showSearch = true,
}: TopBarProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchPlaceholder =
    compactMobile && pageTitle === "Clients"
      ? "Search..."
      : pageTitle === "Clients"
        ? "Search by account #, name, phone, address..."
        : "Search...";
  const hasSearchValue = searchValue.trim().length > 0;
  const shouldAnimateCompactSearch = compactMobile && expandMobileSearchOnFocus;
  const isCompactSearchExpanded =
    !shouldAnimateCompactSearch || isSearchFocused || hasSearchValue;
  const shouldPromoteAnimatedSearchRow =
    shouldAnimateCompactSearch &&
    isCompactSearchExpanded &&
    searchPlacement === "beside-title" &&
    !!extraContent;
  const besideTitleContainerClassName = shouldPromoteAnimatedSearchRow
    ? "flex w-full flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-4"
    : `flex w-full flex-wrap items-center justify-between ${compactMobile ? "gap-2 lg:gap-4" : "gap-3 lg:gap-4"}`;
  const besideTitleLeadingClassName = shouldPromoteAnimatedSearchRow
    ? "flex w-full min-w-0 items-center"
    : `flex min-w-0 flex-1 flex-wrap items-center ${compactMobile ? "gap-2 lg:gap-4" : "gap-3 lg:gap-4"}`;
  const trailingActionsClassName = shouldPromoteAnimatedSearchRow
    ? `flex w-full flex-wrap items-center justify-start ${compactMobile ? "gap-1 lg:gap-2" : "gap-2"} lg:w-auto lg:justify-end`
    : `flex flex-wrap items-center justify-start ${compactMobile ? "gap-1 lg:gap-2" : "gap-2"} lg:justify-end`;
  const extraContentWrapperClassName = shouldPromoteAnimatedSearchRow
    ? `flex w-full max-w-full flex-wrap items-center ${compactMobile ? "gap-1 lg:gap-2" : "gap-2"}`
    : `flex max-w-full flex-wrap items-center ${compactMobile ? "gap-1 lg:gap-2" : "gap-2"}`;
  const besideTitleSearchWrapperClassName = shouldAnimateCompactSearch
    ? `relative min-w-0 group transform-gpu origin-left apple-width-motion ${
        isCompactSearchExpanded
          ? "w-full scale-100"
          : "flex-none overflow-hidden w-11 scale-[0.98]"
      } lg:w-full lg:max-w-sm lg:flex-1`
    : `relative w-full flex-1 group ${compactMobile ? "max-w-none min-w-0 sm:max-w-sm" : "max-w-md min-w-[16rem]"}`;
  const centeredSearchWrapperClassName = shouldAnimateCompactSearch
    ? `relative min-w-0 justify-self-start group overflow-hidden transform-gpu origin-left apple-width-motion ${
        isCompactSearchExpanded ? "w-[clamp(9rem,42vw,12rem)] scale-100" : "w-11 scale-[0.98]"
      } lg:w-full lg:max-w-sm lg:justify-self-center`
    : `relative w-full justify-self-center group ${compactMobile ? "max-w-none sm:max-w-sm" : "max-w-md"}`;
  const compactSearchInputClassName = compactMobile
    ? `pl-8 h-8 lg:h-11 border focus:bg-background focus:border-primary/50 transition-all duration-300 touch-manipulation text-xs ${
        shouldAnimateCompactSearch
          ? `${isCompactSearchExpanded ? "rounded-[18px] lg:rounded-full border-primary/35 bg-background pr-3 shadow-[0_12px_24px_-22px_rgba(59,130,246,0.8)]" : "rounded-[18px] lg:rounded-full border-muted/80 bg-muted/18 pr-0 placeholder:text-transparent"}`
          : "rounded-lg lg:rounded-full border-muted bg-muted/25"
      }`
    : "pl-10 h-12 lg:h-11 rounded-full border-2 border-muted bg-muted/30 focus:bg-background focus:border-primary/50 transition-all duration-300 touch-manipulation";
  const searchIconWrapperClassName = shouldAnimateCompactSearch
    ? `pointer-events-none absolute top-1/2 z-10 text-muted-foreground transition-all duration-300 ${
        isCompactSearchExpanded
          ? "left-3 -translate-y-1/2 group-focus-within:text-primary"
          : "left-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground/70"
      }`
    : "pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary";

  const addButtonClassName = compactMobile
    ? "rounded-lg lg:rounded-full h-8 w-8 min-w-[2rem] px-0 lg:h-11 lg:w-auto lg:min-w-0 lg:px-6 font-semibold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 transition-all duration-300 touch-manipulation"
    : "rounded-full px-4 lg:px-6 font-semibold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 transition-all duration-300 h-12 lg:h-11 touch-manipulation";
  const titleClassName = showSearch
    ? "text-lg lg:text-2xl font-display font-bold text-foreground hidden md:block whitespace-nowrap"
    : "text-lg lg:text-2xl font-display font-bold text-foreground whitespace-nowrap";

  return (
    <div className="sticky top-0 z-30 w-full bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
      <div
        className={
          extraContent
            ? compactMobile
              ? "min-h-12 lg:min-h-20 px-2 lg:px-6 py-1 lg:py-3 flex flex-wrap items-center justify-between gap-1.5 lg:gap-4"
              : "min-h-16 lg:min-h-20 px-4 lg:px-6 py-2 lg:py-3 flex flex-wrap items-center justify-between gap-3 lg:gap-4"
            : compactMobile
              ? "h-11 lg:h-20 px-2 lg:px-6 flex items-center justify-between gap-1.5 lg:gap-4"
              : "h-16 lg:h-20 px-4 lg:px-6 flex items-center justify-between gap-3 lg:gap-4"
        }
      >
        {searchPlacement === "beside-title" ? (
          <div className={besideTitleContainerClassName}>
            <div className={besideTitleLeadingClassName}>
              <h1 className={titleClassName}>
                {pageTitle}
              </h1>

              {showSearch ? (
                <div className={besideTitleSearchWrapperClassName}>
                  <div className={searchIconWrapperClassName}>
                    <Search className={compactMobile ? "h-3.5 w-3.5" : "w-5 h-5"} />
                  </div>
                  <Input
                    className={compactSearchInputClassName}
                    placeholder={
                      shouldAnimateCompactSearch && !isCompactSearchExpanded
                        ? ""
                        : searchPlaceholder
                    }
                    value={searchValue}
                    onChange={(e) => onSearch(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setIsSearchFocused(false)}
                    autoComplete="off"
                    data-testid="input-search"
                  />
                </div>
              ) : null}
            </div>

            <div className={trailingActionsClassName}>
              {extraContent && (
                <div className={extraContentWrapperClassName}>
                  {extraContent}
                </div>
              )}

              {onAddClick && addButtonLabel && (
                <Button
                  size="lg"
                  className={addButtonClassName}
                  onClick={onAddClick}
                  data-testid="button-add"
                >
                  <Plus className={compactMobile ? "h-3.5 w-3.5 lg:mr-2 lg:h-5 lg:w-5" : "w-5 h-5 lg:mr-2"} />
                  <span className="hidden lg:inline">{addButtonLabel}</span>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div
            className={`grid w-full items-center ${compactMobile ? "grid-cols-[minmax(0,1fr)_auto] gap-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-4" : "grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-4"}`}
          >
            <h1 className={titleClassName}>
              {pageTitle}
            </h1>

            {showSearch ? (
              <div className={centeredSearchWrapperClassName}>
                <div className={searchIconWrapperClassName}>
                  <Search className={compactMobile ? "h-3.5 w-3.5" : "w-5 h-5"} />
                </div>
                <Input
                  className={compactSearchInputClassName}
                  placeholder={
                    shouldAnimateCompactSearch && !isCompactSearchExpanded
                      ? ""
                      : searchPlaceholder
                  }
                  value={searchValue}
                  onChange={(e) => onSearch(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  autoComplete="off"
                  data-testid="input-search"
                />
              </div>
            ) : null}

            <div className={`flex flex-wrap items-center justify-start ${compactMobile ? "justify-self-end gap-1 lg:gap-2" : "gap-2"} lg:justify-end`}>
              {extraContent && (
                <div className={`flex max-w-full flex-wrap items-center ${compactMobile ? "gap-1 lg:gap-2" : "gap-2"}`}>
                  {extraContent}
                </div>
              )}

              {onAddClick && addButtonLabel && (
                <Button
                  size="lg"
                  className={addButtonClassName}
                  onClick={onAddClick}
                  data-testid="button-add"
                >
                  <Plus className={compactMobile ? "h-3.5 w-3.5 lg:mr-2 lg:h-5 lg:w-5" : "w-5 h-5 lg:mr-2"} />
                  <span className="hidden lg:inline">{addButtonLabel}</span>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

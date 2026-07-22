import { MoonStar, SunMedium } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const title = `Switch to ${isDark ? "light" : "dark"} mode.`;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={title}
      title={title}
      data-testid="button-theme-toggle"
      className="h-9 w-9 rounded-xl border-border/70 bg-background/90 text-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 hover:bg-muted"
    >
      {isDark ? (
        <SunMedium className="h-4.5 w-4.5" />
      ) : (
        <MoonStar className="h-4.5 w-4.5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

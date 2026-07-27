import type { ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Building2,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UserInfo } from "@/pages/Login";

type PlatformConsoleShellProps = {
  user: UserInfo;
  onLogout: () => void;
  children: ReactNode;
};

const navigation = [
  { href: "/super-admin", label: "Overview", icon: LayoutDashboard },
  { href: "/super-admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/super-admin/accounts", label: "Accounts", icon: Users },
];

function isActiveRoute(location: string, href: string) {
  return href === "/super-admin"
    ? location === "/super-admin" || location === "/"
    : location === href;
}

export function PlatformConsoleShell({
  user,
  onLogout,
  children,
}: PlatformConsoleShellProps) {
  const [location, navigate] = useLocation();
  const activeItem =
    navigation.find((item) => isActiveRoute(location, item.href)) || navigation[0];

  return (
    <div className="min-h-dvh bg-muted/25 text-foreground">
      <a
        href="#platform-main"
        className="sr-only z-[100] rounded-md bg-background px-4 py-2 text-sm font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to platform content
      </a>

      <div className="mx-auto flex min-h-dvh w-full max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 border-r bg-slate-950 text-slate-100 md:flex md:flex-col">
          <div className="border-b border-white/10 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 shadow-sm">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold leading-tight">Platform Console</p>
                <p className="text-xs text-slate-400">Multi-workspace control plane</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-3" aria-label="Platform navigation">
            {navigation.map((item) => {
              const active = isActiveRoute(location, item.href);
              return (
                <Button
                  key={item.href}
                  type="button"
                  variant="ghost"
                  className={`h-11 w-full justify-start gap-3 px-3 text-sm transition-colors ${
                    active
                      ? "bg-white/12 text-white hover:bg-white/15 hover:text-white"
                      : "text-slate-300 hover:bg-white/8 hover:text-white"
                  }`}
                  onClick={() => navigate(item.href)}
                  aria-current={active ? "page" : undefined}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Button>
              );
            })}
          </nav>

          <div className="space-y-3 border-t border-white/10 p-4">
            <div className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{user.name || user.username}</p>
                <Badge className="border-0 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/15">
                  Owner
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">{user.username}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full justify-start gap-3 text-slate-300 hover:bg-red-500/10 hover:text-red-200"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b bg-background/95 px-4 py-4 backdrop-blur md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 md:hidden">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  <span className="text-sm font-semibold">Platform Console</span>
                </div>
                <h1 className="mt-1 text-xl font-semibold tracking-tight md:mt-0">
                  {activeItem.label}
                </h1>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 md:hidden"
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </Button>
            </div>

            <nav
              className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-muted p-1 md:hidden"
              aria-label="Platform navigation"
            >
              {navigation.map((item) => {
                const active = isActiveRoute(location, item.href);
                return (
                  <button
                    key={item.href}
                    type="button"
                    className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => navigate(item.href)}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </header>

          <main id="platform-main" className="min-w-0 flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

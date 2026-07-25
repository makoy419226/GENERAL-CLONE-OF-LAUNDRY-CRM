import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { QuickSearch } from "@/components/QuickSearch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AppFooter } from "@/components/AppFooter";
import { AppleMotionBackdrop, AppleMotionProvider, RouteMotionShell } from "@/components/AppleMotion";
import Dashboard from "@/pages/Dashboard";
import TodaysWork from "@/pages/TodaysWork";
import Products from "@/pages/Products";
import Clients from "@/pages/Clients";
import ClientDetails from "@/pages/ClientDetails";
import Bills from "@/pages/Bills";
import Orders from "@/pages/Orders";
import Workers from "@/pages/Workers";
import SalesReports from "@/pages/SalesReports";
import Incidents from "@/pages/Incidents";
import Contact from "@/pages/Contact";
import Login, { type UserInfo } from "@/pages/Login";
import Lockdown, { type LockdownStatus } from "@/pages/Lockdown";
import PublicOrder from "@/pages/PublicOrder";
import TrackOrder from "@/pages/TrackOrder";
import AdminSettings from "@/pages/AdminSettings";
import DeliveryDashboard from "@/pages/DeliveryDashboard";
import SuperAdmin from "@/pages/SuperAdmin";
import { PlatformConsoleShell } from "@/components/platform/PlatformConsoleShell";
import NotFound from "@/pages/not-found";
import {
  useLiveBillsStream,
  useLiveClientTransactionsStream,
  useLiveProductCategorySettingsStream,
} from "@/hooks/use-live-data-streams";
import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { useCompanyContactInfo } from "@/lib/companyContact";

const SHOW_THEME_TOGGLE = false; // true shows the dark mode button, false hides it.

export const UserContext = createContext<UserInfo | null>(null);

function getEffectiveRole(role?: string | null): string {
  return role || "counter";
}

const rolePermissions: Record<string, string[]> = {
  "/": ["admin", "counter", "section", "driver"],
  "/dashboard": ["admin", "counter", "reception", "section"],
  "/delivery": ["admin", "driver"],
  "/inventory": ["admin", "counter", "reception"],
  "/products": ["admin", "counter", "reception", "driver"],
  "/clients": ["admin", "counter", "reception", "driver"],
  "/bills": ["admin", "counter", "reception", "driver"],
  "/orders": ["admin", "counter", "reception", "section", "driver"],
  "/workers": ["admin"],
  "/sales-reports": ["admin"],
  "/incidents": ["admin", "counter", "reception", "section", "driver"],
  "/contact": ["admin", "counter", "reception", "section", "driver"],
  "/track": ["admin", "counter", "reception", "section", "driver"],
  "/admin-settings": ["admin"],
  "/super-admin": ["super_admin"],
};

function ProtectedRoute({ path, component: Component, allowedRoles }: { 
  path: string; 
  component: React.ComponentType<any>; 
  allowedRoles: string[];
}) {
  const user = useContext(UserContext);
  const userRole = getEffectiveRole(user?.role);

  if (!allowedRoles.includes(userRole)) {
    return <Redirect to="/" />;
  }
  
  return <Route path={path} component={Component} />;
}

function Router() {
  const user = useContext(UserContext);
  const userRole = getEffectiveRole(user?.role);

  if (userRole === "super_admin") {
    return (
      <Switch>
        <Route path="/" component={() => <Redirect to="/super-admin" />} />
        <Route path="/super-admin" component={SuperAdmin} />
        <Route path="/super-admin/tenants" component={SuperAdmin} />
        <Route path="/super-admin/accounts" component={SuperAdmin} />
        <Route path="/super-admin/email" component={SuperAdmin} />
        <Route><Redirect to="/super-admin" /></Route>
      </Switch>
    );
  }
  
  // Driver users should be redirected to delivery dashboard as home
  if (userRole === "driver") {
    return (
      <Switch>
        <Route path="/" component={DeliveryDashboard} />
        <Route path="/delivery" component={DeliveryDashboard} />
        <Route path="/delivery-history" component={() => <Redirect to="/delivery" />} />
        <Route path="/products" component={Products} />
        <Route path="/orders" component={Orders} />
        <Route path="/bills" component={Bills} />
        <Route path="/due-customers" component={() => <Redirect to="/bills" />} />
        <Route path="/clients" component={Clients} />
        <Route path="/clients/:id" component={ClientDetails} />
        <Route path="/incidents" component={Incidents} />
        <Route path="/contact" component={Contact} />
        <Route path="/track" component={TrackOrder} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={TodaysWork} />
      <Route path="/dashboard" component={TodaysWork} />
      <Route path="/todays-work" component={TodaysWork} />
      {rolePermissions["/delivery"]?.includes(userRole) && <Route path="/delivery" component={DeliveryDashboard} />}
      {rolePermissions["/delivery"]?.includes(userRole) && <Route path="/delivery-history" component={() => <Redirect to="/delivery" />} />}
      <Route path="/inventory" component={Dashboard} />
      <Route path="/products" component={Products} />
      <Route path="/clients" component={Clients} />
      <Route path="/clients/:id" component={ClientDetails} />
      <Route path="/bills" component={Bills} />
      <Route path="/orders" component={Orders} />
      {rolePermissions["/workers"].includes(userRole) && <Route path="/workers" component={Workers} />}
      {rolePermissions["/sales-reports"].includes(userRole) && <Route path="/sales-reports" component={() => <SalesReports />} />}
      {rolePermissions["/incidents"].includes(userRole) && <Route path="/incidents" component={Incidents} />}
      <Route path="/due-customers" component={() => <Redirect to="/bills" />} />
      <Route path="/contact" component={Contact} />
      {rolePermissions["/track"].includes(userRole) && <Route path="/track" component={TrackOrder} />}
      {rolePermissions["/admin-settings"].includes(userRole) && <Route path="/admin-settings" component={AdminSettings} />}
      <Route component={NotFound} />
    </Switch>
  );
}

function HeaderDashboardClock({ now }: { now: Date }) {
  const { companyContact } = useCompanyContactInfo();
  const timeParts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: companyContact.dashboardClockHour12,
    timeZone: "Asia/Dubai",
  }).formatToParts(now);
  const dayPeriod = timeParts
    .find((part) => part.type === "dayPeriod")
    ?.value.toUpperCase();
  const formattedTime = companyContact.dashboardClockHour12
    ? timeParts
        .filter((part) => part.type !== "dayPeriod")
        .map((part) => part.value)
        .join("")
        .trim()
    : now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Dubai",
    });

  return (
    <div
      className="hidden min-w-[10rem] flex-col items-center justify-center rounded-full border border-border/70 bg-background/80 px-4 py-1.5 text-center shadow-sm backdrop-blur lg:flex"
      data-testid="header-dashboard-clock"
    >
      <span className="flex items-baseline gap-1.5 text-lg font-semibold leading-none text-foreground tabular-nums">
        <span>{formattedTime}</span>
        {companyContact.dashboardClockHour12 && dayPeriod && (
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
            {dayPeriod}
          </span>
        )}
      </span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Abu Dhabi
      </span>
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [lockdownStatus, setLockdownStatus] = useState<LockdownStatus | null>(null);
  const [lockdownStatusLoaded, setLockdownStatusLoaded] = useState(false);
  const [location] = useLocation();
  const [headerClockNow, setHeaderClockNow] = useState(() => new Date());
  const authNetworkFailureCountRef = useRef(0);
  const authCooldownUntilRef = useRef(0);
  const isDashboardTab =
    location === "/" || location === "/dashboard" || location === "/todays-work";
  const headerBrand = (
    <div className="flex flex-col items-center">
      {user?.businessLogoUrl ? (
        <img
          src={user.businessLogoUrl}
          alt={`${user.businessName || "Tenant"} logo`}
          className="h-8 max-w-36 object-contain lg:h-10"
          data-testid="img-header-logo"
        />
      ) : (
        <span className="text-sm font-bold leading-tight text-primary lg:text-base">
          {user?.businessName || "Laundry CRM"}
        </span>
      )}
    </div>
  );

  const floatingThemeToggle = SHOW_THEME_TOGGLE ? (
    <div className="fixed right-4 top-4 z-50">
      <ThemeToggle />
    </div>
  ) : null;

  const refreshLockdownStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/security/lockdown", {
        headers: { "Cache-Control": "no-cache" },
      });
      const status = await response.json();
      setLockdownStatus({
        enabled: !!status.enabled,
        reason: status.reason || "Page lockdown for security reasons.",
        lockedAt: status.lockedAt || null,
        lockedBy: status.lockedBy || null,
      });
    } catch {
      setLockdownStatus(null);
    } finally {
      setLockdownStatusLoaded(true);
    }
  }, []);

  useEffect(() => {
    const loggedIn = localStorage.getItem("isLoggedIn") === "true";
    const storedUser = localStorage.getItem("user");
    if (loggedIn && storedUser) {
      setIsLoggedIn(true);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  useEffect(() => {
    void refreshLockdownStatus();

    const interval = window.setInterval(() => {
      void refreshLockdownStatus();
    }, 15000);

    const handleLockdownStatusChange = () => {
      void refreshLockdownStatus();
    };

    window.addEventListener("app-lockdown-status-changed", handleLockdownStatusChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("app-lockdown-status-changed", handleLockdownStatusChange);
    };
  }, [refreshLockdownStatus]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setHeaderClockNow(new Date());
    }, 1000);

    return () => window.clearInterval(tick);
  }, []);

  const handleLogin = (userData: UserInfo) => {
    // Query keys are shared across tenants. Never let an account inherit
    // another tenant's in-memory staff, inventory, or operational data.
    queryClient.clear();
    setIsLoggedIn(true);
    setUser(userData);
  };

  const handleLogout = useCallback(() => {
    queryClient.clear();
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      // Local logout must still complete if the server is unavailable.
    });
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("user");
    localStorage.removeItem("authToken");
    localStorage.removeItem("lastActivity");
    setIsLoggedIn(false);
    setUser(null);
  }, []);

  // Session timeout after 30 minutes of inactivity
  const TIMEOUT_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateLastActivity = useCallback(() => {
    if (isLoggedIn) {
      localStorage.setItem("lastActivity", Date.now().toString());
    }
  }, [isLoggedIn]);

  // Stable references to avoid re-triggering effects on user object changes
  const userId = user?.id;
  const userRef = useRef(user);
  userRef.current = user;
  const canBypassLockdown = user?.role === "admin" || user?.role === "super_admin";
  const allowLiveStreams =
    isLoggedIn && user?.role !== "super_admin" && (!lockdownStatus?.enabled || canBypassLockdown);

  useLiveBillsStream(allowLiveStreams);
  useLiveClientTransactionsStream(allowLiveStreams);
  useLiveProductCategorySettingsStream(allowLiveStreams);

  useEffect(() => {
    if (lockdownStatus?.enabled && isLoggedIn && !canBypassLockdown) {
      handleLogout();
    }
  }, [canBypassLockdown, handleLogout, isLoggedIn, lockdownStatus?.enabled]);

  const resetAuthNetworkBackoff = useCallback(() => {
    authNetworkFailureCountRef.current = 0;
    authCooldownUntilRef.current = 0;
  }, []);

  const recordAuthNetworkFailure = useCallback(() => {
    authNetworkFailureCountRef.current += 1;

    // Exponential cooldown: 5s, 10s, 20s, 40s, then cap at 60s.
    const cooldownMs = Math.min(
      5000 * 2 ** (authNetworkFailureCountRef.current - 1),
      60000,
    );

    authCooldownUntilRef.current = Date.now() + cooldownMs;
    return cooldownMs;
  }, []);

  const isAuthNetworkInCooldown = useCallback(() => {
    return Date.now() < authCooldownUntilRef.current;
  }, []);

  // Send heartbeat to server to track online status
  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    
    const sendHeartbeat = async () => {
      const currentUser = userRef.current;
      if (!currentUser || document.hidden || isAuthNetworkInCooldown()) return;

      try {
        const response = await fetch("/api/auth/heartbeat", {
          method: "POST",
          credentials: "include",
        });

        resetAuthNetworkBackoff();
        const data = await response.json();
        
        // Check if admin has forced logout
        if (data.forceLogout) {
          handleLogout();
          window.location.reload();
        }
      } catch {
        recordAuthNetworkFailure();
      }
    };
    
    // Send immediately on login
    sendHeartbeat();
    
    // Then send every 30 seconds
    const interval = setInterval(sendHeartbeat, 30000);
    
    return () => clearInterval(interval);
  }, [
    handleLogout,
    isAuthNetworkInCooldown,
    isLoggedIn,
    recordAuthNetworkFailure,
    resetAuthNetworkBackoff,
    userId,
  ]);

  // Listen for instant logout via Server-Sent Events
  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let closed = false;

    const connect = () => {
      if (closed || document.hidden || isAuthNetworkInCooldown()) return;

      eventSource = new EventSource("/api/auth/logout-stream");

      eventSource.onopen = () => {
        resetAuthNetworkBackoff();
      };
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "forceLogout") {
            handleLogout();
            window.location.reload();
          }
        } catch {
          // Ignore parse errors
        }
      };
      
      eventSource.onerror = () => {
        if (closed) return;
        eventSource?.close();
        const retryDelay = recordAuthNetworkFailure();
        reconnectTimeout = setTimeout(connect, retryDelay);
      };
    };

    const resumeConnection = () => {
      if (closed || document.hidden) return;

      resetAuthNetworkBackoff();

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      eventSource?.close();
      connect();
    };

    connect();

    window.addEventListener("online", resumeConnection);
    document.addEventListener("visibilitychange", resumeConnection);
    
    return () => {
      closed = true;
      window.removeEventListener("online", resumeConnection);
      document.removeEventListener("visibilitychange", resumeConnection);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      eventSource?.close();
    };
  }, [
    handleLogout,
    isAuthNetworkInCooldown,
    isLoggedIn,
    recordAuthNetworkFailure,
    resetAuthNetworkBackoff,
    userId,
  ]);

  const checkSessionTimeout = useCallback(() => {
    const lastActivity = localStorage.getItem("lastActivity");
    if (lastActivity && isLoggedIn) {
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed >= TIMEOUT_DURATION) {
        handleLogout();
      }
    }
  }, [isLoggedIn, handleLogout]);

  // Set up activity tracking and timeout checking
  useEffect(() => {
    if (!isLoggedIn) return;

    // Initialize last activity on login
    updateLastActivity();

    // Activity events to track
    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"];
    
    // Throttle activity updates to once per minute
    let lastUpdate = Date.now();
    const throttledUpdate = () => {
      const now = Date.now();
      if (now - lastUpdate >= 60000) { // Update at most once per minute
        lastUpdate = now;
        updateLastActivity();
      }
    };

    events.forEach(event => {
      window.addEventListener(event, throttledUpdate, { passive: true });
    });

    // Check for timeout every minute
    activityTimeoutRef.current = setInterval(checkSessionTimeout, 60000);

    // Check immediately on mount (in case user returns to inactive tab)
    checkSessionTimeout();

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, throttledUpdate);
      });
      if (activityTimeoutRef.current) {
        clearInterval(activityTimeoutRef.current);
      }
    };
  }, [isLoggedIn, updateLastActivity, checkSessionTimeout]);

  if (!lockdownStatusLoaded) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppleMotionProvider>
            {floatingThemeToggle}
            <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
              Checking security status...
            </div>
            <Toaster />
          </AppleMotionProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  if (lockdownStatus?.enabled && !canBypassLockdown) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppleMotionProvider>
            {floatingThemeToggle}
            <Lockdown status={lockdownStatus} onAdminLogin={handleLogin} />
            <Toaster />
          </AppleMotionProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  if (location.startsWith("/order/") || (location === "/track" && !isLoggedIn)) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppleMotionProvider>
            {floatingThemeToggle}
            <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground [height:100svh] supports-[height:100dvh]:[height:100dvh]">
              <AppleMotionBackdrop className="opacity-55" />
              <main className="relative z-10 min-h-0 flex-1 overflow-auto">
                <Switch>
                  <Route path="/order/:token" component={PublicOrder} />
                  <Route path="/track" component={TrackOrder} />
                </Switch>
              </main>
              <div className="relative z-10">
                <AppFooter />
              </div>
            </div>
            <Toaster />
          </AppleMotionProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  if (!isLoggedIn) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppleMotionProvider>
            {floatingThemeToggle}
            <Login onLogin={handleLogin} />
            <Toaster />
          </AppleMotionProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  if (user?.role === "super_admin") {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppleMotionProvider>
            <UserContext.Provider value={user}>
              <PlatformConsoleShell user={user} onLogout={handleLogout}>
                <RouteMotionShell location={location}>
                  <Router />
                </RouteMotionShell>
              </PlatformConsoleShell>
              <Toaster />
            </UserContext.Provider>
          </AppleMotionProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppleMotionProvider>
          <UserContext.Provider value={user}>
            <div className="flex h-screen w-full bg-background text-foreground">
              <Sidebar user={user} onLogout={handleLogout} />
              <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppleMotionBackdrop className="opacity-60" />
                <header className="relative z-20 h-14 border-b border-border/80 bg-card/80 px-3 shadow-[0_1px_0_hsl(var(--foreground)/0.04)] backdrop-blur-xl lg:flex lg:h-16 lg:items-center lg:justify-between lg:gap-4 lg:px-6">
                  <div className="absolute inset-y-0 right-3 flex items-center gap-2 lg:hidden">
                    <QuickSearch />
                    {SHOW_THEME_TOGGLE && <ThemeToggle />}
                  </div>
                  <div className="flex h-full items-center justify-center lg:hidden">
                    {headerBrand}
                  </div>
                  <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex lg:justify-start">
                    <QuickSearch />
                    {SHOW_THEME_TOGGLE && <ThemeToggle />}
                  </div>
                  {!isDashboardTab && <HeaderDashboardClock now={headerClockNow} />}
                  <div className="hidden items-center gap-3 lg:flex">
                    {headerBrand}
                  </div>
                </header>
                <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-auto">
                  <RouteMotionShell location={location}>
                    <Router />
                  </RouteMotionShell>
                </main>
                <div className="relative z-10">
                  <AppFooter />
                </div>
              </div>
            </div>
            <Toaster />
          </UserContext.Provider>
        </AppleMotionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

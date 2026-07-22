import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, Users, FileText, List, Phone, TrendingUp, LogOut, Shield, UserCog, Wallet, ClipboardList, HardHat, AlertTriangle, Menu, X, Search, Settings, ChevronDown, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { startTransition, useState, useEffect, type MouseEvent } from "react";
import logoImage from "@assets/image_1767220512226.png";

interface UserInfo {
  id: number;
  username: string;
  role: string;
  name: string;
  businessId?: number | null;
  businessName?: string | null;
}

interface SidebarProps {
  user?: UserInfo | null;
  onLogout?: () => void;
}

export function Sidebar({ user, onLogout }: SidebarProps) {
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const visibleLocation = pendingHref ?? location;

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setIsOpen(false);
    }
  }, [location, isMobile]);

  useEffect(() => {
    if (pendingHref === location) {
      setPendingHref(null);
    }
  }, [location, pendingHref]);

  const handleNavClick =
    (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();

      if (href === location) {
        setPendingHref(null);
        if (isMobile) setIsOpen(false);
        return;
      }

      setPendingHref(href);
      if (isMobile) setIsOpen(false);

      void queryClient.cancelQueries({ type: "active" }, { silent: true });

      startTransition(() => {
        navigate(href);
      });
    };

  const isDashboard = visibleLocation === "/" || visibleLocation === "/dashboard";
  const isInventory = visibleLocation === "/inventory";
  const isPriceList = visibleLocation === "/products";
  const isClients = visibleLocation === "/clients" || visibleLocation.startsWith("/clients/");
  const isBills = visibleLocation === "/bills";
  const isOrders = visibleLocation === "/orders";
  const isWorkers = visibleLocation === "/workers";
  const isSalesReports = visibleLocation === "/sales-reports";
  const isIncidents = visibleLocation === "/incidents";
  const isContact = visibleLocation === "/contact";
  const isTrackOrder = visibleLocation === "/track";
  const isAdminSettings = visibleLocation === "/admin-settings";

  const actualUserRole = user?.role || "counter";
  const userRole = actualUserRole;
  const isAdmin = userRole === "admin";
  const isCounter = userRole === "counter";
  const isAdminOrCounter = isAdmin || isCounter;

  const navGroups = [
    {
      label: "Operations",
      collapsible: false,
      items: [
        { href: "/dashboard", icon: LayoutDashboard, iconClassName: "border-sky-200 bg-sky-100 text-sky-700 group-hover:bg-sky-200", label: "Dashboard", active: isDashboard, testId: "nav-dashboard", roles: ["admin", "counter", "reception", "section", "staff"] },
        { href: "/delivery", icon: Truck, iconClassName: "border-emerald-200 bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200", label: "Delivery Dashboard", active: visibleLocation === "/delivery", testId: "nav-delivery", roles: ["admin", "driver"] },
        { href: "/products", icon: List, iconClassName: "border-amber-200 bg-amber-100 text-amber-700 group-hover:bg-amber-200", label: "New Order", active: isPriceList, testId: "nav-new-order", roles: ["admin", "counter", "reception", "driver"] },
        { href: "/orders", icon: ClipboardList, iconClassName: "border-blue-200 bg-blue-100 text-blue-700 group-hover:bg-blue-200", label: "Order Tracking", active: isOrders, testId: "nav-orders", roles: ["admin", "counter", "reception", "section", "staff", "driver"] },
      ]
    },
    {
      label: "Business",
      collapsible: false,
      items: [
        { href: "/inventory", icon: Package, iconClassName: "border-violet-200 bg-violet-100 text-violet-700 group-hover:bg-violet-200", label: "Inventory", active: isInventory, testId: "nav-inventory", roles: ["admin", "counter", "reception"] },
        { href: "/clients", icon: Users, iconClassName: "border-cyan-200 bg-cyan-100 text-cyan-700 group-hover:bg-cyan-200", label: "Clients", active: isClients, testId: "nav-clients", roles: ["admin", "counter", "reception"] },
        { href: "/bills", icon: FileText, iconClassName: "border-rose-200 bg-rose-100 text-rose-700 group-hover:bg-rose-200", label: "Bills", active: isBills, testId: "nav-bills", roles: ["admin", "counter", "reception", "driver"] },
      ]
    },
    {
      label: "Reports",
      collapsible: false,
      items: [
        { href: "/incidents", icon: AlertTriangle, iconClassName: "border-red-200 bg-red-100 text-red-700 group-hover:bg-red-200", label: "Incidents", active: isIncidents, testId: "nav-incidents", roles: ["admin", "counter", "reception", "section", "staff"] },
        { href: "/track", icon: Search, iconClassName: "border-indigo-200 bg-indigo-100 text-indigo-700 group-hover:bg-indigo-200", label: "Public Tracking", active: isTrackOrder, testId: "nav-track-order", roles: ["admin", "counter", "reception", "section", "staff", "driver"] },
        { href: "/contact", icon: Phone, iconClassName: "border-teal-200 bg-teal-100 text-teal-700 group-hover:bg-teal-200", label: "Contact", active: isContact, testId: "nav-contact", roles: ["admin", "counter", "reception", "section", "staff", "driver"] },
      ]
    },
    {
      label: "Settings",
      collapsible: false,
      items: [
        { href: "/workers", icon: HardHat, iconClassName: "border-orange-200 bg-orange-100 text-orange-700 group-hover:bg-orange-200", label: "Management", active: isWorkers, testId: "nav-workers", roles: ["admin"] },
        { href: "/admin-settings", icon: Settings, iconClassName: "border-slate-200 bg-slate-100 text-slate-700 group-hover:bg-slate-200", label: "Admin Settings", active: isAdminSettings, testId: "nav-admin-settings", roles: ["admin"] },
      ]
    },
  ];

  const filteredGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => item.roles.includes(userRole) || item.roles.includes(actualUserRole))
  })).filter(group => group.items.length > 0);

  return (
    <>
      {/* Mobile Menu Toggle */}
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-2.5 top-2.5 z-50 h-10 w-10 border bg-card/85 shadow-sm backdrop-blur-xl lg:hidden"
          onClick={() => setIsOpen(!isOpen)}
          data-testid="button-menu-toggle"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      )}

      {/* Desktop Collapse Toggle */}
      {!isMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-3 left-3 z-50 hidden h-10 w-10 border bg-card/85 shadow-md backdrop-blur-xl hover:bg-primary hover:text-white lg:flex"
          onClick={() => setIsCollapsed(!isCollapsed)}
          data-testid="button-sidebar-toggle"
        >
          {isCollapsed ? <Menu className="w-5 h-5" /> : <X className="w-5 h-5" />}
        </Button>
      )}

      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`
        ${isMobile ? 'fixed left-0 top-0 z-40' : 'relative'} 
        ${isCollapsed && !isMobile ? 'w-0 lg:w-0' : 'w-64 lg:w-[19.2rem]'}
        h-screen border-r border-border/80 bg-card/80 shadow-[18px_0_70px_-58px_hsl(var(--foreground)/0.38)] backdrop-blur-xl flex flex-col
        apple-sidebar-motion
        ${isMobile && !isOpen ? '-translate-x-full' : 'translate-x-0'}
        ${isCollapsed && !isMobile ? 'opacity-0 pointer-events-none' : 'opacity-100'}
      `}>
        <div className="border-b border-border/70 p-3">
          <img 
            src={logoImage} 
            alt="Liquid Washes Laundry" 
            className="w-full h-auto max-h-16 object-contain"
            data-testid="img-logo"
          />
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {filteredGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              {group.collapsible ? (
                <>
                  <button
                    onClick={() => setSettingsExpanded(!settingsExpanded)}
                    className="w-full flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1 hover:text-foreground transition-colors"
                    data-testid="button-toggle-settings"
                  >
                    <span className="flex items-center gap-2">
                      <Settings className="w-3 h-3" />
                      {group.label}
                    </span>
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${settingsExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`space-y-1 overflow-hidden transition-all duration-200 ${settingsExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                    {group.items.map((item) => (
                      <Button
                        key={item.href}
                        asChild
                        variant={item.active ? "default" : "ghost"}
                        className={`w-full justify-start rounded-lg font-medium gap-3 h-9 touch-manipulation pl-6 transition-all duration-200 group ${
                          item.active
                            ? "bg-primary text-white shadow-md"
                            : "text-foreground hover:bg-primary/10 hover:translate-x-1 hover:text-primary"
                        }`}
                        data-testid={item.testId}
                      >
                        <a href={item.href} onClick={handleNavClick(item.href)} aria-current={item.active ? "page" : undefined}>
                          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border shadow-sm transition-all duration-200 group-hover:scale-105 ${item.active ? "border-white/30 bg-white/20 text-white" : item.iconClassName}`}>
                            <item.icon className="w-4 h-4" />
                          </span>
                          <span className="truncate flex-1 text-left text-sm">{item.label}</span>
                        </a>
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1">
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <Button
                      key={item.href}
                      asChild
                      variant={item.active ? "default" : "ghost"}
                      className={`w-full justify-start rounded-lg font-medium gap-3 h-10 touch-manipulation transition-all duration-200 group ${
                        item.active
                          ? "bg-primary text-white shadow-md"
                          : "text-foreground hover:bg-primary/10 hover:translate-x-1 hover:text-primary"
                      }`}
                      data-testid={item.testId}
                    >
                      <a href={item.href} onClick={handleNavClick(item.href)} aria-current={item.active ? "page" : undefined}>
                        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border shadow-sm transition-all duration-200 group-hover:scale-105 ${item.active ? "border-white/30 bg-white/20 text-white" : item.iconClassName}`}>
                          <item.icon className="w-4 h-4" />
                        </span>
                        <span className="truncate flex-1 text-left text-sm">{item.label}</span>
                      </a>
                    </Button>
                  ))}
                </>
              )}
            </div>
          ))}
        </nav>

        {user && (
          <div className="space-y-3 border-t border-border/70 p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                {user.role === "admin" || user.role === "super_admin" ? (
                  <Shield className="w-5 h-5 text-primary" />
                ) : user.role === "counter" ? (
                  <UserCog className="w-5 h-5 text-primary" />
                ) : (
                  <Wallet className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground truncate">{user.name || user.username}</p>
                <Badge variant="secondary" className="text-xs capitalize">
                  {user.role === "super_admin" ? "Super Admin" : user.role === "counter" ? "Counter" : user.role === "section" ? "Section" : user.role}
                </Badge>
                {user.businessName && (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{user.businessName}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="default" 
                className="flex-1 gap-2 h-11 touch-manipulation"
                onClick={onLogout}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        )}

        <div className="border-t border-border/70 p-3 text-center text-[10px] text-muted-foreground">
          <p className="font-medium text-foreground text-xs">Liquide Washes Laundry</p>
          <p>Al Dhanna City, Al Ruwais · Abu Dhabi</p>
          <p>© 2024</p>
        </div>
      </div>
    </>
  );
}

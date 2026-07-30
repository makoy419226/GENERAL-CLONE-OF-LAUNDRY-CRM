import { useState, useContext, useMemo } from "react";
import { TopBar } from "@/components/TopBar";
import { ProductCard } from "@/components/ProductCard";
import { useProducts } from "@/hooks/use-products";
import { Loader2, PackageOpen, Phone, Mail, Globe, ClipboardList, Tag, Package, Truck, CheckCircle, ArrowUpDown, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ProductForm } from "@/components/ProductForm";
import { UserContext } from "@/App";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getProductCategoryGroupName } from "@shared/productCategories";
import { useCompanyContactInfo } from "@/lib/companyContact";

interface Order {
  id: number;
  orderNumber: string;
  status: string;
  customerName?: string;
  entryDate: string;
  delivered?: boolean;
  deliveryDate?: string | null;
  deliveryType?: string | null;
  items?: any[];
}

type InventorySort = "category" | "newest" | "oldest" | "alphabetical";

export default function Dashboard() {
  const { companyContact } = useCompanyContactInfo();
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showCreatePinDialog, setShowCreatePinDialog] = useState(false);
  const [createAdminPin, setCreateAdminPin] = useState("");
  const [createPinError, setCreatePinError] = useState("");
  const [isVerifyingCreatePin, setIsVerifyingCreatePin] = useState(false);
  const [sortBy, setSortBy] = useState<InventorySort>("alphabetical");
  const { data: products, isLoading, isError } = useProducts(searchTerm);
  const user = useContext(UserContext);
  const isAdmin = user?.role === "admin";
  const isSection = user?.role === "section";
  
  const { data: orders } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    enabled: isSection,
  });

  const { data: allocatedStock } = useQuery<Record<string, number>>({
    queryKey: ["/api/products/allocated-stock"],
    staleTime: 30000,
  });

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  const requestCreateProductDialog = () => {
    if (!isAdmin) return;
    setCreateAdminPin("");
    setCreatePinError("");
    setShowCreatePinDialog(true);
  };

  const verifyCreateProductAdminPin = async () => {
    if (createAdminPin.length !== 5) {
      setCreatePinError("Admin PIN must be 5 digits");
      return;
    }

    setIsVerifyingCreatePin(true);
    setCreatePinError("");
    try {
      const res = await fetch("/api/workers/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: createAdminPin }),
      });

      if (!res.ok) {
        setCreatePinError("Invalid admin PIN");
        return;
      }

      const data = await res.json();
      const role = String(data?.worker?.role || "").trim().toLowerCase();
      if (role !== "admin") {
        setCreatePinError("Admin PIN required");
        return;
      }

      setShowCreatePinDialog(false);
      setCreateAdminPin("");
      setCreatePinError("");
      setIsCreateOpen(true);
    } catch {
      setCreatePinError("Failed to verify admin PIN");
    } finally {
      setIsVerifyingCreatePin(false);
    }
  };

  const getUaeStartOfDay = (date: Date) => {
    const offsetHours = 4;
    const uaeMs = date.getTime() + offsetHours * 60 * 60 * 1000;
    const uaeDate = new Date(uaeMs);
    return Date.UTC(uaeDate.getUTCFullYear(), uaeDate.getUTCMonth(), uaeDate.getUTCDate()) - offsetHours * 60 * 60 * 1000;
  };

  const todayStartEpoch = getUaeStartOfDay(new Date());
  const todayEndEpoch = todayStartEpoch + 24 * 60 * 60 * 1000;

  const sortedProducts = useMemo(() => {
    const inventoryProducts = [...(products || [])];

    const compareNames = (leftName?: string | null, rightName?: string | null) =>
      String(leftName || "").localeCompare(String(rightName || ""), undefined, {
        sensitivity: "base",
      });

    const getCreatedRank = (product: (typeof inventoryProducts)[number]) => {
      const createdAt = (product as { createdAt?: string | Date | null }).createdAt;
      if (createdAt) {
        const timestamp = new Date(createdAt).getTime();
        if (!Number.isNaN(timestamp)) return timestamp;
      }

      return Number(product.id || 0);
    };

    inventoryProducts.sort((leftProduct, rightProduct) => {
      if (sortBy === "category") {
        const categoryComparison = compareNames(
          getProductCategoryGroupName(leftProduct.category),
          getProductCategoryGroupName(rightProduct.category),
        );
        if (categoryComparison !== 0) return categoryComparison;
        return compareNames(leftProduct.name, rightProduct.name);
      }

      if (sortBy === "newest") {
        const rankDifference = getCreatedRank(rightProduct) - getCreatedRank(leftProduct);
        if (rankDifference !== 0) return rankDifference;
        return compareNames(leftProduct.name, rightProduct.name);
      }

      if (sortBy === "oldest") {
        const rankDifference = getCreatedRank(leftProduct) - getCreatedRank(rightProduct);
        if (rankDifference !== 0) return rankDifference;
        return compareNames(leftProduct.name, rightProduct.name);
      }

      return compareNames(leftProduct.name, rightProduct.name);
    });

    return inventoryProducts;
  }, [products, sortBy]);

  // Staff dashboard - simplified order progress view
  const pendingOrders = orders?.filter(o => o.status === "Pending") || [];
  const taggingOrders = orders?.filter(o => o.status === "Tagging") || [];
  const packingOrders = orders?.filter(o => o.status === "Packing") || [];
  const deliveredOrders = orders?.filter((order) => {
    const status = String(order.status || "").toLowerCase();
    const isDelivered = order.delivered === true || status === "delivered";
    if (!isDelivered || order.deliveryType !== "delivery" || !order.deliveryDate) return false;
    const deliveryTime = new Date(order.deliveryDate).getTime();
    return deliveryTime >= todayStartEpoch && deliveryTime < todayEndEpoch;
  }) || [];

  if (isSection) {
    const hasCompanyContacts = Boolean(
      companyContact.telephone ||
      companyContact.mobilePhone ||
      companyContact.email ||
      companyContact.website,
    );

    return (
      <div className="flex flex-col h-screen">
        {hasCompanyContacts && <div className="bg-primary text-white overflow-hidden">
          <div className="animate-marquee flex min-w-max whitespace-nowrap">
            {Array.from({ length: 6 }, (_, copyIndex) => (
              <div
                key={`staff-dashboard-contact-strip-${copyIndex}`}
                className="flex shrink-0 items-center gap-16 pr-16 py-2"
                aria-hidden={copyIndex > 0}
              >
                {companyContact.telephone && <span className="flex items-center gap-2">
                  <Phone className="w-4 h-4 animate-blink" />
                  <span className="animate-blink font-bold">Tel: {companyContact.telephone}</span>
                </span>}
                {companyContact.mobilePhone && <span className="flex items-center gap-2">
                  <Phone className="w-4 h-4 animate-blink" />
                  <span className="animate-blink font-bold">Phone: {companyContact.mobilePhone}</span>
                </span>}
                {companyContact.email && <span className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email: {companyContact.email}
                </span>}
                {companyContact.website && <span className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  {companyContact.website}
                </span>}
              </div>
            ))}
          </div>
        </div>}
        
        <div className="p-4 border-b bg-card">
          <h1 className="text-2xl font-bold">Staff Dashboard</h1>
          <p className="text-muted-foreground">Order Progress Overview</p>
        </div>

        <main className="flex-1 container mx-auto px-4 py-8 overflow-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-orange-500" />
                  Pending
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-600">{pendingOrders.length}</div>
              </CardContent>
            </Card>
            
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Tag className="w-4 h-4 text-blue-500" />
                  Tagging
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">{taggingOrders.length}</div>
              </CardContent>
            </Card>
            
            <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="w-4 h-4 text-purple-500" />
                  Packing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-purple-600">{packingOrders.length}</div>
              </CardContent>
            </Card>
            
            <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Truck className="w-4 h-4 text-green-500" />
                  Delivered Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{deliveredOrders.length}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5" />
                Orders Needing Attention
              </CardTitle>
            </CardHeader>
            <CardContent>
              {[...pendingOrders, ...taggingOrders, ...packingOrders].length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                  <p>All orders are up to date!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {[...pendingOrders, ...taggingOrders, ...packingOrders].slice(0, 10).map((order) => (
                    <Link href="/orders" key={order.id}>
                      <div className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold">{order.orderNumber}</span>
                          <span className="text-muted-foreground">{order.customerName || "Walk-in"}</span>
                        </div>
                        <Badge variant={
                          order.status === "Pending" ? "destructive" :
                          order.status === "Tagging" ? "default" : "secondary"
                        }>
                          {order.status}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </main>

      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <TopBar 
        onSearch={setSearchTerm} 
        searchValue={searchTerm}
        onAddClick={isAdmin ? requestCreateProductDialog : undefined}
        addButtonLabel={isAdmin ? "Add Product" : undefined}
        pageTitle="Inventory"
        extraContent={
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 text-sm font-medium text-muted-foreground sm:flex">
              <ArrowUpDown className="h-4 w-4" />
              Sort
            </div>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as InventorySort)}>
              <SelectTrigger
                className="h-10 w-[11rem] rounded-full border-border/70 bg-background/90 shadow-sm"
                data-testid="select-inventory-sort"
              >
                <SelectValue placeholder="Sort inventory" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="alphabetical">Alphabetical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <main className="flex-1 container mx-auto px-4 py-8 overflow-auto">
        <div className="mb-8">
          <p className="text-muted-foreground">Monitor your stock levels.</p>
          <div className="mt-4 text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full inline-block">
            Total Items: <span className="text-primary">{sortedProducts.length}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <PackageOpen className="w-10 h-10 mb-4 text-primary/70" />
            <p>Loading inventory...</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-destructive">
            <p className="font-semibold text-lg">Failed to load products</p>
            <p className="text-sm opacity-80">Please try refreshing the page.</p>
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl bg-card/50">
            <PackageOpen className="w-16 h-16 mb-4 opacity-50" />
            <h3 className="text-xl font-bold text-foreground mb-2">No products found</h3>
            <p className="max-w-md text-center">
              {searchTerm 
                ? `No products match "${searchTerm}". Try a different search term.` 
                : "Your inventory is empty. Click the 'Add Product' button to get started."}
            </p>
          </div>
        ) : (
          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
          >
            {sortedProducts.map((product) => (
              <motion.div key={product.id} variants={item}>
                <ProductCard 
                  product={product} 
                  canEdit={isAdmin} 
                  allocatedCount={allocatedStock?.[product.name] ?? 0}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>

      <Dialog
        open={showCreatePinDialog}
        onOpenChange={(open) => {
          setShowCreatePinDialog(open);
          if (!open) {
            setCreateAdminPin("");
            setCreatePinError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center flex items-center justify-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Admin PIN Required
            </DialogTitle>
            <DialogDescription className="text-center">
              Enter the admin PIN to add a new product.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              enterKeyHint="done"
              placeholder="Enter admin PIN"
              value={createAdminPin}
              autoComplete="one-time-code"
              onChange={(e) => {
                setCreateAdminPin(e.target.value.replace(/\D/g, "").slice(0, 5));
                setCreatePinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void verifyCreateProductAdminPin();
                }
              }}
              className="text-center text-2xl tracking-widest [-webkit-text-security:disc]"
              data-testid="input-create-product-admin-pin"
            />
            {createPinError && (
              <p className="text-center text-sm text-destructive">
                {createPinError}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCreatePinDialog(false);
                  setCreateAdminPin("");
                  setCreatePinError("");
                }}
                data-testid="button-cancel-create-product-pin"
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => void verifyCreateProductAdminPin()}
                disabled={createAdminPin.length !== 5 || isVerifyingCreatePin}
                data-testid="button-confirm-create-product-pin"
              >
                {isVerifyingCreatePin ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display text-primary">Add New Product</DialogTitle>
          </DialogHeader>
          <ProductForm 
            mode="create" 
            onSuccess={() => setIsCreateOpen(false)} 
          />
        </DialogContent>
      </Dialog>

    </div>
  );
}

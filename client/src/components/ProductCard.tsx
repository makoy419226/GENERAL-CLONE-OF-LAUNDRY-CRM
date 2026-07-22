import { Product } from "@shared/schema";
import { Edit2, Trash2, Package, Shirt, Footprints, Home, Sparkles, Loader2, Ruler } from "lucide-react";
import { getProductImage } from "@/lib/productImages";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProductForm } from "./ProductForm";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useDeleteProduct } from "@/hooks/use-products";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getProductCategoryDisplayName,
  getProductCategoryGroupName,
  normalizeStoredProductCategoryName,
  UNCATEGORIZED_PRODUCT_CATEGORY_NAME,
} from "@shared/productCategories";

const getCategoryIcon = (category: string | null) => {
  switch (category) {
    case "Traditional Wear":
    case "Formal Wear":
    case "Tops":
    case "Bottoms":
    case "Outerwear":
    case "Workwear":
    case "Specialty":
      return <Shirt size={32} strokeWidth={1.5} />;
    case "Undergarments":
    case "Accessories":
      return <Sparkles size={32} strokeWidth={1.5} />;
    case "Bedding":
    case "Home Linens":
    case "Bathroom":
    case "Flooring":
      return <Home size={32} strokeWidth={1.5} />;
    case "General Items":
    case "Shop Items":
    case "All Items":
    case "Uncategorized":
      return <Package size={32} strokeWidth={1.5} />;
    case "Footwear":
      return <Footprints size={32} strokeWidth={1.5} />;
    default:
      return <Shirt size={32} strokeWidth={1.5} />;
  }
};

interface ProductCardProps {
  product: Product;
  canEdit?: boolean;
  allocatedCount?: number;
}

const activeColors = [
  "from-blue-500 to-blue-600",
  "from-purple-500 to-purple-600",
  "from-pink-500 to-pink-600",
  "from-indigo-500 to-indigo-600",
  "from-cyan-500 to-cyan-600",
  "from-teal-500 to-teal-600",
  "from-orange-500 to-orange-600",
  "from-emerald-500 to-emerald-600",
];

export function ProductCard({ product, canEdit = true, allocatedCount }: ProductCardProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [colorIndex, setColorIndex] = useState(() => Math.floor(Math.random() * activeColors.length));
  const [showOrdersDialog, setShowOrdersDialog] = useState(false);
  const [showSizePricingDialog, setShowSizePricingDialog] = useState(false);
  const deleteProduct = useDeleteProduct();

  const { data: productOrders, isLoading: ordersLoading } = useQuery<{ orderNumber: string; quantity: number; orderId: number }[]>({
    queryKey: ["/api/products/orders-by-product", product.name],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/products/orders-by-product?name=${encodeURIComponent(product.name)}`, {
        signal,
      });
      return res.json();
    },
    enabled: showOrdersDialog,
  });

  const handleCardClick = () => {
    setIsActive(!isActive);
    if (!isActive) {
      setColorIndex((prev) => (prev + 1) % activeColors.length);
    }
  };

  const formatPrice = (value?: string | null, fallback = "-") => {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toFixed(2) : fallback;
  };

  const priceTiles = [
    {
      code: "N",
      label: "Normal",
      value: formatPrice(product.price, "0.00"),
      tone: "text-primary",
    },
    {
      code: "U",
      label: "Urgent",
      value: formatPrice(product.urgentPrice),
      tone: "text-rose-600 dark:text-rose-400",
    },
    {
      code: "DC",
      label: "Dry Clean",
      value: formatPrice(product.dryCleanPrice),
      tone: "text-purple-600 dark:text-purple-400",
    },
    {
      code: "IO",
      label: "Iron Only",
      value: formatPrice(product.ironOnlyPrice),
      tone: "text-orange-600 dark:text-orange-400",
    },
  ];

  const sqmPrice = formatPrice(product.sqmPrice || product.price, "0.00");
  const hasExplicitSizePricing = Boolean(
    product.smallPrice ||
    product.mediumPrice ||
    product.largePrice ||
    product.smallUrgentPrice ||
    product.mediumUrgentPrice ||
    product.largeUrgentPrice ||
    product.smallDryCleanPrice ||
    product.mediumDryCleanPrice ||
    product.largeDryCleanPrice ||
    product.smallIronOnlyPrice ||
    product.mediumIronOnlyPrice ||
    product.largeIronOnlyPrice
  );
  const sizePriceRows = [
    {
      key: "small",
      label: "Small",
      normal: formatPrice(product.smallPrice),
      urgent: formatPrice(product.smallUrgentPrice),
      dryClean: formatPrice(product.smallDryCleanPrice),
      ironOnly: formatPrice(product.smallIronOnlyPrice),
      visible: Boolean(
        product.smallPrice ||
        product.smallUrgentPrice ||
        product.smallDryCleanPrice ||
        product.smallIronOnlyPrice
      ),
    },
    {
      key: "medium",
      label: "Medium",
      normal: formatPrice(product.mediumPrice || product.price),
      urgent: formatPrice(product.mediumUrgentPrice),
      dryClean: formatPrice(product.mediumDryCleanPrice),
      ironOnly: formatPrice(product.mediumIronOnlyPrice),
      visible: Boolean(
        hasExplicitSizePricing &&
          (
            product.mediumPrice ||
            product.price ||
            product.mediumUrgentPrice ||
            product.mediumDryCleanPrice ||
            product.mediumIronOnlyPrice
          )
      ),
    },
    {
      key: "large",
      label: "Large",
      normal: formatPrice(product.largePrice),
      urgent: formatPrice(product.largeUrgentPrice),
      dryClean: formatPrice(product.largeDryCleanPrice),
      ironOnly: formatPrice(product.largeIronOnlyPrice),
      visible: Boolean(
        product.largePrice ||
        product.largeUrgentPrice ||
        product.largeDryCleanPrice ||
        product.largeIronOnlyPrice
      ),
    },
  ].filter((row) => row.visible);
  const hasSizedPricing = hasExplicitSizePricing && sizePriceRows.length > 0;
  const visibleSizeCodes = sizePriceRows.map((row) => row.label.charAt(0).toUpperCase());
  const normalizedCategory = getProductCategoryGroupName(
    product.category,
  );
  const storedCategory = normalizeStoredProductCategoryName(product.category);
  const categoryLabel = storedCategory
    ? getProductCategoryDisplayName(storedCategory)
    : "";
  const showCategoryBadge =
    Boolean(categoryLabel) && normalizedCategory !== UNCATEGORIZED_PRODUCT_CATEGORY_NAME;

  const placeholderGradient = isActive 
    ? `bg-gradient-to-br ${activeColors[colorIndex]}` 
    : "bg-gradient-to-br from-primary/15 via-card to-muted";

  return (
    <div 
      className={`group relative flex h-full cursor-pointer flex-col overflow-visible rounded-xl border bg-card/95 shadow-sm backdrop-blur-sm transition-all duration-300 hover:shadow-lg ${
        isActive 
          ? "border-primary border-2 ring-4 ring-primary/40 animate-pulse" 
          : "border-border/80 hover:border-primary/30"
      }`}
      onClick={handleCardClick}
      data-testid={`card-product-${product.id}`}
    >
      {/* Image / Icon Area */}
      <div className={`relative flex h-24 w-full items-center justify-center overflow-hidden rounded-t-xl border-b border-border/60 ${placeholderGradient} sm:h-28`}>
        {(() => {
          const imageSrc = product.imageUrl || getProductImage(product.name);
          if (imageSrc) {
            return (
              <img 
                src={imageSrc} 
                alt={product.name} 
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
            );
          }
          return null;
        })()}
        <div className={`fallback-icon flex-col items-center justify-center ${
          isActive ? "text-white" : "text-primary/40 group-hover:text-primary/60"
        } transition-colors`} style={{ display: (product.imageUrl || getProductImage(product.name)) ? 'none' : 'flex' }}>
          {getCategoryIcon(normalizedCategory)}
        </div>
        
        {/* Quick Action Overlay (visible on hover) - only for admins */}
        {canEdit && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/10 opacity-0 backdrop-blur-[2px] transition-opacity dark:bg-black/45 group-hover:opacity-100">
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="secondary" className="rounded-full border-border/70 bg-background/95 text-primary shadow-lg transition-transform hover:scale-110 hover:bg-background hover:text-primary">
                  <Edit2 className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent aria-describedby={undefined} className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-display text-primary">Edit Product</DialogTitle>
                </DialogHeader>
                <ProductForm 
                  defaultValues={product} 
                  onSuccess={() => setIsEditOpen(false)}
                  mode="edit"
                />
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="destructive" className="rounded-full shadow-lg hover:scale-110 transition-transform">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {product.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the product from your inventory.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteProduct.mutate(product.id)}
                  >
                    {deleteProduct.isPending ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex flex-grow flex-col p-2.5">
        <div className="space-y-1.5">
          {showCategoryBadge && (
            <span
              className="inline-flex max-w-full items-center rounded-full border border-border/60 bg-secondary/75 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-secondary-foreground"
              title={categoryLabel}
            >
              <span className="truncate">{categoryLabel}</span>
            </span>
          )}

          <div className="space-y-0.5">
            <h3
              className="min-h-8 break-words text-sm font-bold leading-4 text-foreground font-display line-clamp-2 transition-colors group-hover:text-primary"
              title={product.name}
            >
              {product.name}
            </h3>

            <p
              className="text-[10px] leading-3 text-muted-foreground line-clamp-1"
              title={product.description || "No description provided."}
            >
              {product.description || "No description provided."}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-gradient-to-br from-muted/45 via-card to-muted/20 p-1.5 shadow-sm">
            {product.isSqmPriced ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2 py-1.5">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    SQM
                  </p>
                  <p className="mt-0.5 text-xs font-bold tabular-nums text-primary">
                    {sqmPrice}
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-primary">
                  / sqm
                </span>
              </div>
            ) : hasSizedPricing ? (
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full rounded-md border-dashed border-border/70 bg-background/85 px-2 py-1.5 text-left hover:bg-background"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSizePricingDialog(true);
                }}
                data-testid={`button-size-pricing-${product.id}`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="rounded-md bg-primary/10 p-1">
                        <Ruler className="h-3 w-3 text-primary" />
                      </div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Size Pricing
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {visibleSizeCodes.map((code) => (
                        <span
                          key={code}
                          className="rounded-full border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                    View
                  </span>
                </div>
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-1 px-0.5">
                {priceTiles.map((tile) => (
                  <div
                    key={tile.code}
                    className="min-w-0 text-center"
                    title={tile.label}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[7px] font-bold uppercase tracking-[0.08em] ${tile.tone}`}>
                        {tile.code}
                      </span>
                      <span className={`truncate text-[10px] font-bold tabular-nums ${tile.tone}`}>
                        {tile.value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-1.5 border-t border-border/70 pt-2">
          <div 
            className={`flex min-w-0 items-center text-[11px] text-muted-foreground ${allocatedCount !== undefined && allocatedCount > 0 ? "cursor-pointer hover:underline" : ""}`}
            onClick={(e) => {
              if (allocatedCount !== undefined && allocatedCount > 0) {
                e.stopPropagation();
                setShowOrdersDialog(true);
              }
            }}
            data-testid={`button-stock-${product.id}`}
          >
            <Package className="mr-1 h-3 w-3 shrink-0" />
            {allocatedCount !== undefined ? (
              <span className={`truncate ${allocatedCount > 0 ? "text-primary font-semibold" : ""}`}>
                {allocatedCount} in orders
              </span>
            ) : (
              <span className={`truncate ${product.stockQuantity && product.stockQuantity < 10 ? "text-amber-500 font-semibold" : ""}`}>
                {product.stockQuantity || 0} in stock
              </span>
            )}
          </div>
          <div className="max-w-[4.5rem] truncate rounded-md bg-muted/80 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            {product.sku || "NO-SKU"}
          </div>
        </div>
      </div>

      <Dialog open={showOrdersDialog} onOpenChange={setShowOrdersDialog}>
        <DialogContent className="sm:max-w-[400px] max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{product.name}</DialogTitle>
            <DialogDescription>
              {allocatedCount || 0} items across undelivered orders
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[50vh]">
            {ordersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : productOrders && productOrders.length > 0 ? (
              <div className="space-y-1.5">
                {productOrders.map((order, idx) => (
                  <div
                    key={`${order.orderNumber}-${idx}`}
                    className="flex items-center justify-between p-2.5 rounded-md border"
                    data-testid={`row-order-${order.orderId}`}
                  >
                    <span className="font-mono font-semibold text-sm">{order.orderNumber}</span>
                    <Badge variant="secondary">{order.quantity}x</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No orders found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSizePricingDialog} onOpenChange={setShowSizePricingDialog}>
        <DialogContent
          className="sm:max-w-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{product.name} Size Pricing</DialogTitle>
            <DialogDescription>
              Unique prices by size. A dash means that price is not set.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-xl border border-border/70">
            <Table className="text-xs sm:text-sm">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="h-10 px-3 font-semibold">Size</TableHead>
                  <TableHead className="h-10 px-3 text-primary font-semibold">Normal</TableHead>
                  <TableHead className="h-10 px-3 text-rose-600 dark:text-rose-400 font-semibold">Urgent</TableHead>
                  <TableHead className="h-10 px-3 text-purple-600 dark:text-purple-400 font-semibold">Dry Clean</TableHead>
                  <TableHead className="h-10 px-3 text-orange-600 dark:text-orange-400 font-semibold">Iron Only</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sizePriceRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="px-3 py-2.5 font-semibold">
                      {row.label}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-bold tabular-nums text-primary">
                      {row.normal}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {row.urgent}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-bold tabular-nums text-purple-600 dark:text-purple-400">
                      {row.dryClean}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-bold tabular-nums text-orange-600 dark:text-orange-400">
                      {row.ironOnly}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

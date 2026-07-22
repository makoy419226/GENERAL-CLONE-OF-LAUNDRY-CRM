import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Clock, Package, Truck, Shirt, X, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import logoImage from "@assets/image_1767220512226.png";
import { InvoiceItemDescription } from "@/components/InvoiceItemDescription";

interface PublicOrderData {
  orderNumber: string;
  items: string;
  finalAmount: string;
  paidAmount: string | null;
  deliveryType: string | null;
  washingDone: boolean;
  packingDone: boolean;
  delivered: boolean;
  urgent: boolean;
  clientName: string;
  deliveryPhotos: string[];
  deliveryPhoto: string | null;
}

function formatItems(items: string): string[] {
  if (!items) return [];
  try {
    const parsed = JSON.parse(items);
    if (Array.isArray(parsed)) {
      return parsed.map((item: { name: string; quantity: number }) =>
        `${item.quantity}x ${item.name}`,
      );
    }
  } catch {}
  return items.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function PublicOrder() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  
  const isLoggedIn = !!localStorage.getItem("user");
  
  const handleClose = () => {
    if (isLoggedIn) {
      setLocation("/dashboard");
    } else {
      window.close();
    }
  };

  const { data: order, isLoading, error } = useQuery<PublicOrderData>({
    queryKey: ["/api/orders/public", token],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/orders/public/${token}`, { signal });
      if (!res.ok) throw new Error("Order not found");
      return res.json();
    },
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="relative flex min-h-full items-center justify-center bg-gradient-to-b from-blue-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
        <Button
          variant="outline"
          size="icon"
          className="absolute right-4 top-4 bg-background shadow-md"
          onClick={handleClose}
          data-testid="button-close"
        >
          <X className="h-5 w-5" />
        </Button>
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="relative flex min-h-full items-center justify-center bg-gradient-to-b from-blue-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
        <Button
          variant="outline"
          size="icon"
          className="absolute right-4 top-4 bg-background shadow-md"
          onClick={handleClose}
          data-testid="button-close"
        >
          <X className="h-5 w-5" />
        </Button>
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-muted-foreground">Order not found or link has expired.</p>
            <Button
              className="mt-4"
              onClick={handleClose}
              data-testid="button-close-page"
            >
              {isLoggedIn ? "Go to Dashboard" : "Close"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusStep = () => {
    if (order.delivered) return 4;
    if (order.packingDone) return 3;
    if (order.washingDone) return 2;
    return 1;
  };

  const statusStep = getStatusStep();
  const balance = parseFloat(order.finalAmount) - parseFloat(order.paidAmount || "0");
  const isDelivery = order.deliveryType === "Delivery";
  const finalStatusLabel = order.delivered
    ? (isDelivery ? "Delivered" : "Taken Away")
    : (isDelivery ? "Deliver" : "Take-away");

  return (
    <div className="min-h-full bg-gradient-to-b from-blue-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="relative text-center py-4">
          <Button
            variant="outline"
            size="icon"
            className="absolute right-0 top-4 bg-background shadow-md"
            onClick={handleClose}
            data-testid="button-close"
          >
            <X className="h-5 w-5" />
          </Button>
          <img src={logoImage} alt="Liquid Washes" className="h-16 mx-auto mb-2" />
          <h1 className="text-xl font-bold text-blue-800 dark:text-blue-400">Liquid Washes Laundry</h1>
          <p className="text-sm text-muted-foreground">Order Tracking</p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">Order #{order.orderNumber}</CardTitle>
              <div className="flex gap-1 flex-wrap">
                {order.urgent && <Badge variant="destructive">Urgent</Badge>}
                <Badge variant={order.deliveryType === "Delivery" ? "default" : "secondary"}>
                  {order.deliveryType || "Take Away"}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Customer: {order.clientName}</p>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center py-4 border-b">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 1 ? "bg-blue-600 text-white" : "bg-gray-200"}`}>
                  <Shirt className="h-5 w-5" />
                </div>
                <span className="text-xs mt-1">Entry</span>
              </div>
              <div className={`flex-1 h-1 ${statusStep >= 2 ? "bg-blue-600" : "bg-gray-200"}`} />
              <div className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 2 ? "bg-blue-600 text-white" : "bg-gray-200"}`}>
                  <Clock className="h-5 w-5" />
                </div>
                <span className="text-xs mt-1">Washing</span>
              </div>
              <div className={`flex-1 h-1 ${statusStep >= 3 ? "bg-blue-600" : "bg-gray-200"}`} />
              <div className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 3 ? "bg-blue-600 text-white" : "bg-gray-200"}`}>
                  <Package className="h-5 w-5" />
                </div>
                <span className="text-xs mt-1">Packing</span>
              </div>
              <div className={`flex-1 h-1 ${statusStep >= 4 ? "bg-blue-600" : "bg-gray-200"}`} />
              <div className="flex flex-col items-center flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 4 ? "bg-green-600 text-white" : "bg-gray-200"}`}>
                  {statusStep >= 4 ? <CheckCircle className="h-5 w-5" /> : isDelivery ? <Truck className="h-5 w-5" /> : <Package className="h-5 w-5" />}
                </div>
                <span className="text-xs mt-1">{finalStatusLabel}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {formatItems(order.items).map((item, i) => (
                <div key={`${item}-${i}`} className="rounded-md border px-3 py-2">
                  <div className="font-medium">
                    <InvoiceItemDescription
                      name={item}
                      packingPlacement="stacked"
                      packingRowStyle={{ justifyContent: "flex-start", gap: "10px", marginLeft: 0 }}
                      optionStyle={{ fontSize: "10px" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Amount Due</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`flex justify-between text-lg font-bold ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
              <span>{balance > 0 ? "To Pay" : "Fully Paid"}</span>
              <span>AED {balance.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        {order.delivered && ((order.deliveryPhotos && order.deliveryPhotos.length > 0) || order.deliveryPhoto) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Delivery Proof Photos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {order.deliveryPhotos && order.deliveryPhotos.length > 0 ? (
                  order.deliveryPhotos.map((photo, index) => (
                    <img
                      key={index}
                      src={photo}
                      alt={`Delivery photo ${index + 1}`}
                      className="w-full h-32 object-cover rounded-md border"
                    />
                  ))
                ) : order.deliveryPhoto ? (
                  <img
                    src={order.deliveryPhoto}
                    alt="Delivery photo"
                    className="w-full h-32 object-cover rounded-md border col-span-2"
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        <Button
          className="w-full"
          onClick={handleClose}
          data-testid="button-close-page"
        >
          {isLoggedIn ? "Go to Dashboard" : "Close"}
        </Button>

      </div>
    </div>
  );
}

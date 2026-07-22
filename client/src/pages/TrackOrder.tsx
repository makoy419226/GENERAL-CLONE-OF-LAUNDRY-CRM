import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Clock, Package, Truck, Shirt, Search, ArrowLeft, AlertCircle, X, Camera, Star } from "lucide-react";
import { format } from "date-fns";
import logoImage from "@assets/image_1767220512226.png";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { InvoiceItemDescription } from "@/components/InvoiceItemDescription";

interface TrackOrderData {
  orderNumber: string;
  items: string;
  status: string;
  entryDate: string;
  deliveryType: string | null;
  tagDone: boolean;
  washingDone: boolean;
  packingDone: boolean;
  packingDate: string | null;
  delivered: boolean;
  deliveryBy: string | null;
  deliveryDate: string | null;
  urgent: boolean;
  expectedDeliveryAt: string | null;
  deliveryPhotos: string[];
  deliveryPhoto: string | null;
  isPaid: boolean;
  paidAmount: string | null;
  totalAmount: string | null;
  billNumber: string | null;
  discountAmount: string | null;
  originalAmount: string | null;
}

export default function TrackOrder() {
  const [orderNumber, setOrderNumber] = useState("");
  const [searchedOrder, setSearchedOrder] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const isLoggedIn = !!localStorage.getItem("user");
  
  const handleClose = () => {
    if (isLoggedIn) {
      setLocation("/dashboard");
    } else {
      window.close();
    }
  };

  const { data: order, isLoading, error, isFetching } = useQuery<TrackOrderData>({
    queryKey: ["/api/orders/track", searchedOrder],
    queryFn: async ({ signal }) => {
      if (!searchedOrder) throw new Error("No order number");
      const res = await fetch(`/api/orders/track/${searchedOrder}`, { signal });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Order not found");
      }
      return res.json();
    },
    enabled: !!searchedOrder,
    retry: false,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderNumber.trim()) {
      setSearchedOrder(orderNumber.trim().toUpperCase());
    }
  };

  const [reviewStars, setReviewStars] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewInitialized, setReviewInitialized] = useState(false);

  const { data: existingReview, refetch: refetchReview } = useQuery({
    queryKey: ["/api/reviews/order", searchedOrder],
    queryFn: async ({ signal }) => {
      if (!searchedOrder) return null;
      const res = await fetch(`/api/reviews/order/${searchedOrder}`, { signal });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!searchedOrder && !!order,
  });

  if (existingReview && !reviewInitialized) {
    setReviewStars(existingReview.stars);
    setReviewComment(existingReview.comment || "");
    setReviewInitialized(true);
  }

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!order) return;
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: order.orderNumber,
          stars: reviewStars,
          comment: reviewComment.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit review");
      return res.json();
    },
    onSuccess: () => {
      setReviewSubmitted(true);
      refetchReview();
      queryClient.invalidateQueries({ queryKey: ["/api/reviews"] });
      toast({ title: "Thank you!", description: "Your review has been submitted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit review", variant: "destructive" });
    },
  });

  const handleReset = () => {
    setOrderNumber("");
    setSearchedOrder("");
    setReviewStars(0);
    setReviewHover(0);
    setReviewComment("");
    setReviewSubmitted(false);
    setReviewInitialized(false);
  };

  const isDelivery = order?.deliveryType === "Delivery";

  const getStatusStep = () => {
    if (!order) return 0;
    if (order.delivered) return 4;
    if (order.packingDone) return 3;
    if (order.tagDone) return 2;
    return 1;
  };

  const statusStep = getStatusStep();

  const getFinalStatusLabel = () => {
    if (!order) return "";
    return isDelivery ? "Delivered" : "Taken Away";
  };

  const getStatusLabel = () => {
    if (!order) return "";
    if (order.delivered) return getFinalStatusLabel();
    if (order.packingDone) return isDelivery ? "Ready for Delivery" : "Ready for Take Away";
    if (order.tagDone) return "Washing";
    return "Pending";
  };

  const formatItems = (items: string) => {
    if (!items) return [];
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) {
        return parsed.map((item: { name: string; quantity: number }) => 
          `${item.quantity}x ${item.name}`
        );
      }
    } catch {}
    return items.split(",").map(item => item.trim()).filter(Boolean);
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-blue-50 to-white p-4 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center py-6">
          <img src={logoImage} alt="Liquid Washes" className="h-20 mx-auto mb-3" data-testid="img-track-logo" />
          <h1 className="text-2xl font-bold text-blue-800 dark:text-blue-300">Liquid Washes Laundry</h1>
          <p className="text-muted-foreground mt-1">Customer Order Tracking</p>
          {isLoggedIn && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleClose}
              data-testid="button-close-tracking"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Go to Dashboard
            </Button>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="h-5 w-5" />
              Order Lookup
            </CardTitle>
            <CardDescription>
              Enter your order number to check the current status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                placeholder="e.g. 685409"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="flex-1"
                data-testid="input-order-number"
              />
              <Button type="submit" disabled={!orderNumber.trim() || isFetching} data-testid="button-search-order">
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        )}

        {error && searchedOrder && !isLoading && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-3" />
              <p className="text-lg font-medium text-destructive">
                {(error as Error).message?.includes("delivered") ? "Order Complete" : "Order Not Found"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {(error as Error).message || `No order found with number "${searchedOrder}". Please check and try again.`}
              </p>
              <Button variant="outline" className="mt-4" onClick={handleReset} data-testid="button-try-again">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {order && !isLoading && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-lg">Order #{order.orderNumber}</CardTitle>
                  <div className="flex gap-1 flex-wrap">
                    {order.urgent && <Badge variant="destructive">Urgent</Badge>}
                    <Badge variant={order.deliveryType === "Delivery" ? "default" : "secondary"}>
                      {order.deliveryType || "Take Away"}
                    </Badge>
                    {(() => {
                      const paid = parseFloat(order.paidAmount || "0");
                      const total = parseFloat(order.totalAmount || "0");
                      if (order.isPaid) {
                        return <Badge className="bg-green-600 hover:bg-green-700 text-white" data-testid="badge-payment-paid">Paid</Badge>;
                      } else if (paid > 0) {
                        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white" data-testid="badge-payment-partial">Partially Paid</Badge>;
                      } else {
                        return <Badge className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="badge-payment-unpaid">Unpaid</Badge>;
                      }
                    })()}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-sm text-muted-foreground">Current Status</p>
                  <p className="text-lg font-semibold text-primary">{getStatusLabel()}</p>
                </div>

                <div className="flex justify-between items-center py-4">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 1 ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      <Clock className="h-5 w-5" />
                    </div>
                    <span className="text-xs mt-1 text-center">Pending</span>
                  </div>
                  <div className={`flex-1 h-1 ${statusStep >= 2 ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"}`} />
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 2 ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      <Shirt className="h-5 w-5" />
                    </div>
                    <span className="text-xs mt-1 text-center">Washing</span>
                  </div>
                  <div className={`flex-1 h-1 ${statusStep >= 3 ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"}`} />
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 3 ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      <Package className="h-5 w-5" />
                    </div>
                    <span className="text-xs mt-1 text-center">{isDelivery ? "Ready for Delivery" : "Ready for Take Away"}</span>
                  </div>
                  <div className={`flex-1 h-1 ${statusStep >= 4 ? "bg-green-600" : "bg-gray-200 dark:bg-gray-700"}`} />
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusStep >= 4 ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>
                      {statusStep >= 4 ? <CheckCircle className="h-5 w-5" /> : isDelivery ? <Truck className="h-5 w-5" /> : <Package className="h-5 w-5" />}
                    </div>
                    <span className="text-xs mt-1 text-center">{order.delivered ? getFinalStatusLabel() : isDelivery ? "Deliver" : "Take-away"}</span>
                  </div>
                </div>

                {order.packingDone && order.packingDate && !order.delivered && (
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
                    <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                      Packing Completed
                    </p>
                    <p className="text-lg font-bold text-green-800 dark:text-green-200">
                      {format(new Date(order.packingDate), "dd/MM/yyyy 'at' hh:mm a")}
                    </p>
                  </div>
                )}
                
                {order.delivered && (
                  <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
                    <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                      {getFinalStatusLabel()}
                    </p>
                    {order.deliveryDate && (
                      <p className="text-lg font-bold text-green-800 dark:text-green-200">
                        {format(new Date(order.deliveryDate), "dd/MM/yyyy 'at' hh:mm a")}
                      </p>
                    )}
                    {order.deliveryBy && (
                      <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                        {order.deliveryType === "Delivery" ? "Delivered by: " : "Taken away by: "}{order.deliveryBy}
                      </p>
                    )}
                  </div>
                )}

                {order.delivered && ((order.deliveryPhotos && order.deliveryPhotos.length > 0) || order.deliveryPhoto) && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <Camera className="h-4 w-4 text-blue-600" />
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Delivery Proof Photos</p>
                    </div>
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
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Order Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Items</p>
                  <div className="mt-1 space-y-2">
                    {formatItems(order.items).map((item, i) => (
                      <div key={`${item}-${i}`} className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="text-sm font-medium">
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
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                  <div>
                    <p className="text-sm text-muted-foreground">Order Date</p>
                    <p className="text-sm font-medium">
                      {order.entryDate ? new Date(order.entryDate).toLocaleDateString() : "-"}
                    </p>
                  </div>
                  {order.expectedDeliveryAt && (
                    <div>
                      <p className="text-sm text-muted-foreground">Expected</p>
                      <p className="text-sm font-medium">
                        {order.expectedDeliveryAt}
                      </p>
                    </div>
                  )}
                  {order.billNumber && (
                    <div>
                      <p className="text-sm text-muted-foreground">Bill #</p>
                      <p className="text-sm font-medium" data-testid="text-bill-number">{order.billNumber}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    {order.discountAmount && parseFloat(order.discountAmount) > 0 ? (
                      <div>
                        <p className="text-sm font-semibold" data-testid="text-total-amount">
                          {parseFloat(order.originalAmount || order.totalAmount || "0").toFixed(2)} AED
                        </p>
                        <p className="text-xs text-orange-600 dark:text-orange-400" data-testid="text-discount-amount">
                          Discount: -{parseFloat(order.discountAmount).toFixed(2)} AED
                        </p>
                        <p className="text-sm font-semibold text-green-700 dark:text-green-400" data-testid="text-final-amount">
                          Final: {parseFloat(order.totalAmount || "0").toFixed(2)} AED
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold" data-testid="text-total-amount">
                        {parseFloat(order.totalAmount || "0").toFixed(2)} AED
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-500" />
                  Rate Your Experience
                </CardTitle>
                <CardDescription>
                  {existingReview ? "You already reviewed this order. You can update your rating anytime." : "How was our service? Tap a star to rate."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reviewSubmitted && !existingReview ? (
                  <div className="text-center py-3">
                    <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">Thank you for your feedback!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const filled = star <= (reviewHover || reviewStars);
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setReviewStars(star)}
                            onMouseEnter={() => setReviewHover(star)}
                            onMouseLeave={() => setReviewHover(0)}
                            className="p-1 transition-transform hover:scale-110"
                            data-testid={`button-star-${star}`}
                          >
                            <Star
                              className={`h-8 w-8 transition-colors ${filled ? "fill-amber-400 text-amber-400" : "text-gray-300 dark:text-gray-600"}`}
                            />
                          </button>
                        );
                      })}
                    </div>
                    {(reviewStars > 0 || existingReview) && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Add a comment (optional)..."
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                          className="text-sm resize-none"
                          rows={2}
                          data-testid="input-review-comment"
                        />
                        <Button
                          className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                          onClick={() => reviewMutation.mutate()}
                          disabled={reviewMutation.isPending || (reviewStars === 0 && !existingReview)}
                          data-testid="button-submit-review"
                        >
                          {reviewMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          {existingReview ? "Update Review" : "Submit Review"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button variant="outline" className="w-full" onClick={handleReset} data-testid="button-search-another">
              <Search className="h-4 w-4 mr-2" />
              Search Another Order
            </Button>
          </>
        )}

      </div>
    </div>
  );
}

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, AlertTriangle, Search, Pencil, Trash2, CheckCircle, Clock, XCircle } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { InvoiceItemDescription } from "@/components/InvoiceItemDescription";
import { format } from "date-fns";
import { useLocation } from "wouter";
import type { Client, Incident, PackingWorker, Order } from "@shared/schema";

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface ActiveOrderType {
  id: number;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: string;
  totalAmount: string;
}

interface OrderSearchBoxProps {
  activeOrders: ActiveOrderType[] | undefined;
  selectedOrderNumber: string;
  onOrderSelect: (order: ActiveOrderType | null) => void;
  getStatusBadgeColor: (status: string) => string;
}

function OrderSearchBox({ activeOrders, selectedOrderNumber, onOrderSelect, getStatusBadgeColor }: OrderSearchBoxProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOrders = activeOrders?.filter(order => 
    searchTerm === "" || 
    order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.customerName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Type order number or select..."
          value={isFocused ? searchTerm : (selectedOrderNumber || "")}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            setSearchTerm("");
          }}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm pl-9 pr-8"
          data-testid="input-order-search"
        />
        {selectedOrderNumber && !isFocused && (
          <button
            type="button"
            onClick={() => {
              onOrderSelect(null);
              setSearchTerm("");
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
      {(isFocused || !selectedOrderNumber) && (
        <div className="border rounded-md max-h-48 overflow-y-auto bg-background">
          {filteredOrders.map((order) => (
            <div 
              key={order.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onOrderSelect(order);
                setSearchTerm("");
                setIsFocused(false);
              }}
              className="flex items-center gap-2 p-2 hover:bg-muted cursor-pointer border-b last:border-b-0"
              data-testid={`order-option-${order.id}`}
            >
              <span className="font-mono text-sm">{order.orderNumber}</span>
              <span className="text-muted-foreground">-</span>
              <span className="text-sm">{order.customerName}</span>
              <Badge className={`text-xs ml-auto ${getStatusBadgeColor(order.status)}`}>
                {order.status}
              </Badge>
            </div>
          ))}
          {filteredOrders.length === 0 && (
            <div className="p-3 text-center text-muted-foreground text-sm">
              No orders found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Incidents() {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editIncident, setEditIncident] = useState<Incident | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  const [orderLookupNumber, setOrderLookupNumber] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [foundOrder, setFoundOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedItemIndices, setSelectedItemIndices] = useState<number[]>([]);
  const [orderSearchTerm, setOrderSearchTerm] = useState("");
  const [isOrderSearchFocused, setIsOrderSearchFocused] = useState(false);
  const orderSearchRef = useRef<HTMLInputElement>(null);
  
  // PIN verification state
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [userPin, setUserPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [verifiedUser, setVerifiedUser] = useState<{ id: number; name: string; type: string } | null>(null);

  const [formData, setFormData] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    orderNumber: "",
    itemName: "",
    reason: "",
    notes: "",
    itemValue: "",
    responsibleStaffId: "",
    responsibleStaffName: "",
    incidentType: "damage",
    incidentStage: "delivery",
    status: "open",
    incidentDate: new Date().toISOString().split('T')[0],
    resolution: "",
  });

  const { data: incidents, isLoading } = useQuery<Incident[]>({
    queryKey: ["/api/incidents"],
  });

  const { data: workers } = useQuery<PackingWorker[]>({
    queryKey: ["/api/packing-workers"],
  });

  const { data: users } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  const { data: drivers } = useQuery<any[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  // Combine all staff types for the dropdown
  const allStaffMembers = useMemo(() => {
    const staff: { id: string; name: string; type: string }[] = [];
    
    // Add managers and other users (exclude inactive/merged accounts)
    users?.forEach(user => {
      if (user.active === true) {
        staff.push({
          id: `user-${user.id}`,
          name: user.name || user.username,
          type: user.role || 'User'
        });
      }
    });
    
    // Add staff workers
    workers?.filter(w => w.active).forEach(worker => {
      staff.push({
        id: `worker-${worker.id}`,
        name: worker.name,
        type: 'Staff'
      });
    });
    
    // Add drivers
    drivers?.filter((d: any) => d.active !== false).forEach((driver: any) => {
      staff.push({
        id: `driver-${driver.id}`,
        name: driver.name,
        type: 'Driver'
      });
    });
    
    return staff;
  }, [users, workers, drivers]);

  // Helper function to parse item string like "1x Kandoora/Thob [N] (folding)" and get price from products
  const getItemPrice = (itemString: string): number => {
    if (!products || products.length === 0) return 0;
    
    // Parse quantity and product name from "1x ProductName [N] (folding)" format
    const quantityMatch = itemString.match(/^(\d+)x\s+(.+)$/);
    let quantity = 1;
    let productName = itemString.trim();
    
    if (quantityMatch) {
      quantity = parseInt(quantityMatch[1]) || 1;
      productName = quantityMatch[2].trim();
    }
    
    // Remove service type indicators like [N], [DC], (folding), (hanging) for matching
    const cleanName = productName
      .replace(/\s*\[N\]\s*/gi, '')
      .replace(/\s*\[DC\]\s*/gi, '')
      .replace(/\s*\(folding\)\s*/gi, '')
      .replace(/\s*\(hanging\)\s*/gi, '')
      .trim();
    
    // Find matching product (case-insensitive)
    const product = products.find(p => 
      p.name.toLowerCase() === cleanName.toLowerCase()
    );
    
    if (product) {
      // Use normal price by default, check if it's dry clean
      const isDryClean = itemString.includes('[DC]');
      const price = isDryClean ? (parseFloat(product.dryCleanPrice) || 0) : (parseFloat(product.price) || 0);
      return quantity * price;
    }
    
    return 0;
  };

  const parseIncidentOrderItems = useCallback((itemsString: string): OrderItem[] => {
    if (!itemsString.trim()) return [];

    return itemsString
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = part.match(/^(\d+)x\s+(.+)$/i);
        if (match) {
          const quantity = parseInt(match[1], 10) || 1;
          const name = match[2].trim();
          const totalPrice = getItemPrice(part);
          const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice;
          return { name, quantity, price: unitPrice };
        }

        const totalPrice = getItemPrice(part);
        return { name: part, quantity: 1, price: totalPrice };
      });
  }, [getItemPrice]);

  interface ActiveOrder {
    id: number;
    orderNumber: string;
    status: string;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    items: string;
    totalAmount: string;
  }

  const { data: activeOrders } = useQuery<ActiveOrder[]>({
    queryKey: ["/api/orders/active-with-clients"],
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/incidents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Incident Recorded", description: "The incident has been logged successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create incident", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      return apiRequest("PUT", `/api/incidents/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      setEditIncident(null);
      resetForm();
      toast({ title: "Incident Updated", description: "The incident has been updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/incidents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      toast({ title: "Incident Deleted", description: "The incident record has been removed" });
    },
  });

  const verifyPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiRequest("POST", "/api/incidents/verify-pin", { pin });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setVerifiedUser(data.user);
        setShowPinDialog(false);
        setUserPin("");
        setPinError("");
        // Now submit the incident with the verified user
        submitIncident(data.user.name);
      }
    },
    onError: () => {
      setPinError("Invalid PIN. Please try again.");
    },
  });

  const resetForm = () => {
    setFormData({
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      orderNumber: "",
      itemName: "",
      reason: "",
      notes: "",
      itemValue: "",
      responsibleStaffId: "",
      responsibleStaffName: "",
      incidentType: "damage",
      incidentStage: "delivery",
      status: "open",
      incidentDate: new Date().toISOString().split('T')[0],
      resolution: "",
    });
    setOrderLookupNumber("");
    setFoundOrder(null);
    setOrderItems([]);
    setSelectedItemIndices([]);
  };

  const lookupOrder = async () => {
    if (!orderLookupNumber.trim()) {
      toast({ title: "Error", description: "Please enter an order number", variant: "destructive" });
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch(`/api/orders/by-number/${encodeURIComponent(orderLookupNumber.trim())}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast({ title: "Not Found", description: "No order found with this number", variant: "destructive" });
        } else {
          toast({ title: "Error", description: "Failed to lookup order", variant: "destructive" });
        }
        setFoundOrder(null);
        setOrderItems([]);
        setSelectedItemIndices([]);
        setFormData(prev => ({ ...prev, itemName: "", itemValue: "" }));
        return;
      }
      const data = await res.json();
      setFoundOrder(data.order);
      setOrderItems(data.items || []);
      setSelectedItemIndices([]);
      setFormData(prev => ({
        ...prev,
        orderNumber: data.order.orderNumber,
        customerName: data.order.customerName || prev.customerName,
        customerPhone: data.customerPhone || prev.customerPhone,
        customerAddress: data.customerAddress || prev.customerAddress,
      }));
      toast({ title: "Order Found", description: `Found ${data.items?.length || 0} items in order ${data.order.orderNumber}` });
    } catch (err) {
      toast({ title: "Error", description: "Failed to lookup order", variant: "destructive" });
      setFoundOrder(null);
      setOrderItems([]);
      setSelectedItemIndices([]);
      setFormData(prev => ({ ...prev, itemName: "", itemValue: "" }));
    } finally {
      setLookupLoading(false);
    }
  };

  const toggleOrderItem = (index: number) => {
    setSelectedItemIndices(prev => {
      const newIndices = prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index];
      
      const selectedItems = newIndices.map(i => orderItems[i]).filter(Boolean);
      const itemNames = selectedItems.map(item => `${item.quantity}x ${item.name}`).join(", ");
      const totalValue = selectedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      
      setFormData(f => ({
        ...f,
        itemName: itemNames,
        itemValue: String(totalValue),
      }));
      
      return newIndices;
    });
  };

  const handleCreate = () => {
    if (!formData.customerName || !formData.reason) {
      toast({ title: "Error", description: "Customer name and reason are required", variant: "destructive" });
      return;
    }
    // Show PIN dialog to verify who is recording
    setShowPinDialog(true);
    setUserPin("");
    setPinError("");
  };

  const submitIncident = (recordedByName: string) => {
    // Build selected items string from the order items
    let selectedItemsString = formData.itemName;
    if (formData.orderNumber && formData.itemName && selectedItemIndices.length > 0) {
      const allItems = formData.itemName.split(",").map(s => s.trim());
      selectedItemsString = selectedItemIndices.map(idx => allItems[idx]).filter(Boolean).join(", ");
    }
    
    const data = {
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      customerAddress: formData.customerAddress,
      orderNumber: formData.orderNumber,
      itemName: selectedItemsString,
      reason: formData.reason,
      incidentType: formData.incidentType,
      incidentStage: formData.incidentStage,
      status: formData.status,
      responsibleStaffId: formData.responsibleStaffId || null,
      responsibleStaffName: formData.responsibleStaffName || null,
      incidentDate: formData.incidentDate,
      reporterName: recordedByName,
    };
    createMutation.mutate(data);
  };

  const handleUpdate = () => {
    if (!editIncident) return;
    const data = {
      ...formData,
      itemValue: formData.itemValue || "0",
      responsibleStaffId: formData.responsibleStaffId ? parseInt(formData.responsibleStaffId) : null,
      incidentDate: new Date(formData.incidentDate),
      resolvedDate: formData.status === "resolved" ? new Date() : null,
    };
    updateMutation.mutate({ id: editIncident.id, updates: data });
  };

  const openEdit = (incident: Incident) => {
    setEditIncident(incident);
    setFormData({
      customerName: incident.customerName,
      customerPhone: incident.customerPhone || "",
      customerAddress: incident.customerAddress || "",
      orderNumber: incident.orderNumber || "",
      itemName: incident.itemName || "",
      reason: incident.reason,
      notes: incident.notes || "",
      itemValue: incident.itemValue || "",
      responsibleStaffId: incident.responsibleStaffId?.toString() || "",
      responsibleStaffName: incident.responsibleStaffName || "",
      incidentType: incident.incidentType || "damage",
      incidentStage: incident.incidentStage || "delivery",
      status: incident.status || "open",
      incidentDate: incident.incidentDate ? new Date(incident.incidentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      resolution: incident.resolution || "",
    });
  };

  const filteredIncidents = incidents?.filter(incident => {
    const matchesSearch = 
      incident.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (incident.orderNumber?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (incident.itemName?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      incident.reason.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || incident.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const visibleIncidents = filteredIncidents ?? [];

  const normalizePhoneLookup = useCallback((value?: string | null) => {
    return String(value || "").replace(/[^\d+]/g, "");
  }, []);

  const resolveIncidentClientId = useCallback((incident: Incident) => {
    if (!clients?.length) return null;

    const phone = normalizePhoneLookup(incident.customerPhone);
    if (phone) {
      const phoneMatch = clients.find((client) => normalizePhoneLookup(client.phone) === phone);
      if (phoneMatch) return phoneMatch.id;
    }

    const normalizedName = String(incident.customerName || "").trim().toLowerCase();
    if (normalizedName) {
      const nameMatch = clients.find((client) => String(client.name || "").trim().toLowerCase() === normalizedName);
      if (nameMatch) return nameMatch.id;
    }

    return null;
  }, [clients, normalizePhoneLookup]);

  const handleIncidentOrderNavigate = useCallback((incident: Incident) => {
    const params = new URLSearchParams();

    if (incident.orderId) {
      params.set("focusOrderId", String(incident.orderId));
    } else if (incident.orderNumber) {
      params.set("highlight", incident.orderNumber);
    } else {
      return;
    }

    if (incident.orderNumber) {
      params.set("highlight", incident.orderNumber);
    }

    setLocation(`/orders?${params.toString()}`);
  }, [setLocation]);

  const handleIncidentClientNavigate = useCallback((incident: Incident) => {
    const clientId = resolveIncidentClientId(incident);
    if (!clientId) {
      toast({
        title: "Client Not Found",
        description: "No matching client record was found for this incident.",
        variant: "destructive",
      });
      return;
    }

    setLocation(`/clients?highlightClient=${clientId}`);
  }, [resolveIncidentClientId, setLocation, toast]);

  const filteredIncidentTotals = useMemo(() => {
    return visibleIncidents.reduce(
      (totals, incident) => {
        const itemValue = parseFloat(incident.itemValue || "0");
        if (Number.isFinite(itemValue)) {
          totals.itemValue += itemValue;
        }

        if (incident.status === "open") totals.open += 1;
        if (incident.status === "pending") totals.pending += 1;
        if (incident.status === "resolved") totals.resolved += 1;

        return totals;
      },
      {
        total: visibleIncidents.length,
        open: 0,
        pending: 0,
        resolved: 0,
        itemValue: 0,
      },
    );
  }, [visibleIncidents]);

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "open":
        return <Badge className="bg-red-500"><XCircle className="w-3 h-3 mr-1" />Open</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "resolved":
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Resolved</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string | null) => {
    switch (type) {
      case "missing_item":
        return <Badge variant="outline" className="border-purple-500 text-purple-600">Missing Item</Badge>;
      case "damage":
        return <Badge variant="outline" className="border-orange-500 text-orange-600">Damage</Badge>;
      case "complaint":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600">Complaint</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getStageBadge = (stage: string | null) => {
    switch (stage) {
      case "reception":
        return <Badge variant="secondary" className="text-xs">Reception</Badge>;
      case "tagging":
        return <Badge variant="secondary" className="text-xs">Tagging</Badge>;
      case "washing":
        return <Badge variant="secondary" className="text-xs">Washing</Badge>;
      case "packing":
        return <Badge variant="secondary" className="text-xs">Packing</Badge>;
      case "delivery":
        return <Badge variant="secondary" className="text-xs">Delivery</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{stage}</Badge>;
    }
  };

  const selectActiveOrder = (order: ActiveOrder) => {
    setFormData(prev => ({
      ...prev,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
    }));
    setOrderLookupNumber(order.orderNumber);
    setOrderItems(parseIncidentOrderItems(order.items || ""));
    setSelectedItemIndices([]);
    toast({ title: "Order Selected", description: `Selected order ${order.orderNumber}` });
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-blue-500";
      case "tagging": return "bg-purple-500";
      case "packing": return "bg-orange-500";
      case "ready": return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  const renderIncidentForm = (isEdit: boolean = false) => (
    <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-2">
      <div className="p-3 bg-muted/50 rounded-lg border space-y-3">
        <Label className="text-sm font-medium">Select Active Order</Label>
        <OrderSearchBox
          activeOrders={activeOrders}
          selectedOrderNumber={formData.orderNumber}
          getStatusBadgeColor={getStatusBadgeColor}
          onOrderSelect={(order) => {
            if (order) {
              setFormData(prev => ({
                ...prev,
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                customerPhone: order.customerPhone,
                customerAddress: order.customerAddress,
                itemName: order.items || "",
              }));
              setOrderItems(parseIncidentOrderItems(order.items || ""));
              setSelectedItemIndices([]);
            } else {
              setFormData(prev => ({
                ...prev,
                orderNumber: "",
                customerName: "",
                customerPhone: "",
                customerAddress: "",
                itemName: "",
              }));
              setOrderItems([]);
              setSelectedItemIndices([]);
            }
          }}
        />
        {formData.orderNumber && orderItems.length > 0 && (
          <div className="mt-2 p-3 bg-muted/50 rounded-md border">
            <Label className="text-xs text-muted-foreground mb-2 block">Select Items for Incident:</Label>
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card/70">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_56px_92px_92px] items-center gap-3 border-b border-border/60 bg-muted/35 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span />
                <span>Item</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Unit</span>
                <span className="text-right">Total</span>
              </div>
              <div className="divide-y divide-border/60">
              {orderItems.map((item, idx) => {
                const isSelected = selectedItemIndices.includes(idx);
                const lineTotal = item.quantity * item.price;
                return (
                  <div 
                    key={idx} 
                    className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_56px_92px_92px] items-start gap-3 px-3 py-3 transition-all ${isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary/30 shadow-[0_0_22px_rgba(59,130,246,0.12)]' : 'hover:bg-muted/45'}`}
                    onClick={() => {
                      toggleOrderItem(idx);
                    }}
                  >
                    <Checkbox 
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={(checked) => {
                        if ((checked === true && !isSelected) || (checked !== true && isSelected)) {
                          toggleOrderItem(idx);
                        }
                      }}
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">
                        <InvoiceItemDescription
                          name={item.name}
                          packingPlacement="stacked"
                          packingRowStyle={{ fontSize: "10px", gap: "8px" }}
                          optionStyle={{ gap: "4px" }}
                        />
                      </div>
                    </div>
                    <div className="text-center text-sm font-medium">{item.quantity}</div>
                    <div className="text-right text-sm text-muted-foreground">{item.price.toFixed(2)} AED</div>
                    <div className="text-right text-sm font-semibold text-foreground">{lineTotal.toFixed(2)} AED</div>
                  </div>
                );
              })}
              </div>
            </div>
            {(() => {
              const validSelected = selectedItemIndices.filter(idx => idx < orderItems.length).length;
              const selectedTotal = selectedItemIndices.reduce((sum, idx) => {
                const selectedItem = orderItems[idx];
                return selectedItem ? sum + (selectedItem.quantity * selectedItem.price) : sum;
              }, 0);
              return validSelected > 0 ? (
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{validSelected} item(s) selected</span>
                  <span className="font-semibold text-primary">{selectedTotal.toFixed(2)} AED</span>
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="incidentType">Incident Type</Label>
          <Select
            value={formData.incidentType}
            onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
          >
            <SelectTrigger data-testid="select-incident-type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="missing_item">Missing Item</SelectItem>
              <SelectItem value="damage">Damage</SelectItem>
              <SelectItem value="complaint">Complaint</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="incidentStage">Where It Happened</Label>
          <Select
            value={formData.incidentStage}
            onValueChange={(value) => setFormData({ ...formData, incidentStage: value })}
          >
            <SelectTrigger data-testid="select-incident-stage">
              <SelectValue placeholder="Select stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reception">Reception (Order Entry)</SelectItem>
              <SelectItem value="tagging">Tagging</SelectItem>
              <SelectItem value="washing">Washing/Processing</SelectItem>
              <SelectItem value="packing">Packing/Ready</SelectItem>
              <SelectItem value="delivery">Delivery/Pickup</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="incidentDate">Incident Date</Label>
        <Input
          id="incidentDate"
          type="date"
          value={formData.incidentDate}
          onChange={(e) => setFormData({ ...formData, incidentDate: e.target.value })}
          data-testid="input-incident-date"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reason">Reason *</Label>
        <Textarea
          id="reason"
          value={formData.reason}
          onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
          placeholder="Describe the reason for this incident"
          rows={2}
          data-testid="input-incident-reason"
        />
      </div>

      <div className={`grid ${isEdit ? "grid-cols-1" : "grid-cols-2"} gap-4`}>
        <div className="space-y-2">
          <Label htmlFor="responsibleStaff">Responsible Staff</Label>
          <Select
            value={formData.responsibleStaffId}
            onValueChange={(value) => {
              const staffMember = allStaffMembers?.find(s => s.id === value);
              setFormData({
                ...formData,
                responsibleStaffId: value,
                responsibleStaffName: staffMember?.name || ""
              });
            }}
          >
            <SelectTrigger data-testid="select-incident-staff">
              <SelectValue placeholder="Select staff" />
            </SelectTrigger>
            <SelectContent>
              {allStaffMembers?.map(staff => (
                <SelectItem key={staff.id} value={staff.id}>
                  {staff.name} ({staff.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isEdit && (
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger data-testid="select-incident-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isEdit && (
        <div className="space-y-2">
          <Label htmlFor="resolution">Resolution</Label>
          <Textarea
            id="resolution"
            value={formData.resolution}
            onChange={(e) => setFormData({ ...formData, resolution: e.target.value })}
            placeholder="How was this resolved?"
            rows={2}
            data-testid="input-incident-resolution"
          />
        </div>
      )}

      <Button
        onClick={isEdit ? handleUpdate : handleCreate}
        disabled={createMutation.isPending || updateMutation.isPending}
        className="w-full"
        data-testid={isEdit ? "button-update-incident" : "button-create-incident"}
      >
        {(createMutation.isPending || updateMutation.isPending) && (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        )}
        {isEdit ? "Update Incident" : "Record Incident"}
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 w-full bg-card border-b border-border shadow-sm">
        <div className={`${isMobile ? "h-14 px-3" : "h-20 px-6"} flex items-center justify-between gap-3 md:gap-4`}>
          <h1 className={`${isMobile ? "text-lg" : "text-2xl"} font-display font-bold text-foreground flex items-center gap-2`}>
            <AlertTriangle className={`${isMobile ? "h-5 w-5" : "w-6 h-6"} text-red-500`} />
            Incident Records
          </h1>
          <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button
                className={isMobile ? "h-9 px-3 text-xs font-semibold" : ""}
                data-testid="button-add-incident"
              >
                <Plus className={`${isMobile ? "mr-1.5 h-4 w-4" : "w-4 h-4 mr-2"}`} />
                Record Incident
              </Button>
            </DialogTrigger>
            <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Record New Incident</DialogTitle>
              </DialogHeader>
              {renderIncidentForm(false)}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <main className={`flex-1 container mx-auto overflow-auto ${isMobile ? "px-3 py-3" : "px-4 py-6"}`}>
        <div className={`mb-4 grid ${isMobile ? "grid-cols-2 gap-2" : "grid-cols-1 gap-4 md:grid-cols-2 md:mb-6"}`}>
          <Card>
            <CardContent className={isMobile ? "p-3" : "pt-6"}>
              <div className="flex items-center gap-3">
                <div className={`${isMobile ? "h-10 w-10" : "w-12 h-12"} rounded-full bg-red-500/10 flex items-center justify-center shrink-0`}>
                  <AlertTriangle className={`${isMobile ? "h-5 w-5" : "w-6 h-6"} text-red-500`} />
                </div>
                <div className="min-w-0">
                  <p className={`${isMobile ? "text-[11px]" : "text-sm"} text-muted-foreground leading-snug`}>Total Incidents</p>
                  <p className={`${isMobile ? "text-lg" : "text-2xl"} font-bold leading-tight`}>
                    {filteredIncidentTotals.total}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className={isMobile ? "p-3" : "pt-6"}>
              <div className="flex items-center gap-3">
                <div className={`${isMobile ? "h-10 w-10" : "w-12 h-12"} rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0`}>
                  <Clock className={`${isMobile ? "h-5 w-5" : "w-6 h-6"} text-yellow-500`} />
                </div>
                <div className="min-w-0">
                  <p className={`${isMobile ? "text-[11px]" : "text-sm"} text-muted-foreground leading-snug`}>Open Cases</p>
                  <p className={`${isMobile ? "text-lg" : "text-2xl"} font-bold leading-tight`}>
                    {filteredIncidentTotals.open}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className={isMobile ? "p-4 pb-3" : "pb-3"}>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center md:gap-4">
              <CardTitle>Incident List</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search incidents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={`${isMobile ? "h-9 w-full pl-9 text-sm" : "w-64 pl-9"}`}
                    data-testid="input-search-incidents"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className={isMobile ? "h-9 w-full text-sm sm:w-36" : "w-32"} data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {visibleIncidents.length === 0 ? (
              <div className={`${isMobile ? "px-4 py-10" : "py-12"} text-center`}>
                <AlertTriangle className={`${isMobile ? "mb-3 h-10 w-10" : "w-12 h-12 mb-4"} text-muted-foreground mx-auto`} />
                <p className="text-muted-foreground">No incidents recorded</p>
              </div>
            ) : (
              <Table className={isMobile ? "min-w-[960px] text-xs sm:text-sm" : ""}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Order #</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Responsible</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIncidents?.map((incident) => (
                    <TableRow 
                      key={incident.id} 
                      data-testid={`row-incident-${incident.id}`}
                      className="cursor-pointer hover-elevate"
                      onClick={() => openEdit(incident)}
                    >
                      <TableCell className="font-mono text-sm">
                        {incident.incidentDate ? format(new Date(incident.incidentDate), "dd/MM/yy HH:mm") : "-"}
                      </TableCell>
                      <TableCell>
                        <div>
                          <button
                            type="button"
                            className="incident-nav-link font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIncidentClientNavigate(incident);
                            }}
                            data-testid={`button-incident-client-${incident.id}`}
                          >
                            {incident.customerName}
                          </button>
                          <p className="text-xs text-muted-foreground">{incident.customerPhone || "-"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        {incident.orderNumber ? (
                          <button
                            type="button"
                            className="incident-nav-link font-mono"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIncidentOrderNavigate(incident);
                            }}
                            data-testid={`button-incident-order-${incident.id}`}
                          >
                            {incident.orderNumber}
                          </button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>{incident.itemName || "-"}</TableCell>
                      <TableCell>{getTypeBadge(incident.incidentType)}</TableCell>
                      <TableCell>{getStageBadge(incident.incidentStage)}</TableCell>
                      <TableCell>{incident.responsibleStaffName || "-"}</TableCell>
                      <TableCell className="text-blue-600 font-medium">{incident.reporterName || "-"}</TableCell>
                      <TableCell>{getStatusBadge(incident.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Are you sure you want to delete this incident?")) {
                              deleteMutation.mutate(incident.id);
                            }
                          }}
                          data-testid={`button-delete-incident-${incident.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div
              className={`flex flex-wrap items-center border-t bg-muted/30 ${isMobile ? "justify-start gap-x-3 gap-y-2 px-3 py-2.5" : "justify-end gap-4 px-4 py-3"}`}
              data-testid="incidents-total-summary"
            >
              <span className={`${isMobile ? "text-xs" : "text-sm"} text-muted-foreground`}>
                {filteredIncidentTotals.total} {filteredIncidentTotals.total === 1 ? "incident" : "incidents"}
              </span>
              <span className={`${isMobile ? "text-xs" : "text-sm"} text-muted-foreground`}>
                Open: <span className="font-semibold text-red-600 dark:text-red-400">{filteredIncidentTotals.open}</span>
              </span>
              <span className={`${isMobile ? "text-xs" : "text-sm"} text-muted-foreground`}>
                Pending: <span className="font-semibold text-yellow-600 dark:text-yellow-400">{filteredIncidentTotals.pending}</span>
              </span>
              <span className={`${isMobile ? "text-xs" : "text-sm"} text-muted-foreground`}>
                Resolved: <span className="font-semibold text-green-600 dark:text-green-400">{filteredIncidentTotals.resolved}</span>
              </span>
              <span className={`${isMobile ? "text-xs" : "text-sm"} text-muted-foreground`}>
                Item Value: <span className="font-semibold text-primary">{filteredIncidentTotals.itemValue.toFixed(2)} AED</span>
              </span>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog open={!!editIncident} onOpenChange={(open) => { if (!open) { setEditIncident(null); resetForm(); } }}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <DialogTitle>Edit Incident</DialogTitle>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger 
                className={`w-32 font-semibold ${
                  formData.status === "open" ? "bg-red-100 text-red-700 border-red-300" :
                  formData.status === "pending" ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
                  "bg-green-100 text-green-700 border-green-300"
                }`}
                data-testid="select-incident-status-header"
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open" className="text-red-600 font-medium">Open</SelectItem>
                <SelectItem value="pending" className="text-yellow-600 font-medium">Pending</SelectItem>
                <SelectItem value="resolved" className="text-green-600 font-medium">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </DialogHeader>
          {renderIncidentForm(true)}
        </DialogContent>
      </Dialog>

      {/* PIN Verification Dialog */}
      <Dialog open={showPinDialog} onOpenChange={(open) => { if (!open) { setShowPinDialog(false); setUserPin(""); setPinError(""); } }}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter Your PIN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Please enter your 5-digit PIN to record this incident.
            </p>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={5}
              placeholder="Enter 5-digit PIN"
              value={userPin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "");
                setUserPin(value);
                setPinError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && userPin.length === 5) {
                  verifyPinMutation.mutate(userPin);
                }
              }}
              className="text-center text-2xl tracking-widest"
              data-testid="input-incident-pin"
            />
            {pinError && (
              <p className="text-sm text-destructive text-center">{pinError}</p>
            )}
            <Button
              className="w-full"
              onClick={() => verifyPinMutation.mutate(userPin)}
              disabled={userPin.length !== 5 || verifyPinMutation.isPending}
              data-testid="button-verify-incident-pin"
            >
              {verifyPinMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify & Record Incident"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

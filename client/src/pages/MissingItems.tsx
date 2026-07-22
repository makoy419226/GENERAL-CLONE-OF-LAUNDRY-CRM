import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Search, Pencil, Trash2, Package, AlertTriangle, CheckCircle, Clock, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { MissingItem, PackingWorker, Order } from "@shared/schema";

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export default function MissingItems() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<MissingItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const { toast } = useToast();

  const [orderLookupNumber, setOrderLookupNumber] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [foundOrder, setFoundOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    orderNumber: "",
    customerName: "",
    itemName: "",
    quantity: "1",
    itemValue: "",
    stage: "washing",
    responsibleWorkerId: "",
    responsibleWorkerName: "",
    reportedByWorkerId: "",
    reportedByWorkerName: "",
    notes: "",
    status: "reported",
    reportedAt: new Date().toISOString().split('T')[0],
    resolution: "",
  });

  const { data: missingItems, isLoading } = useQuery<MissingItem[]>({
    queryKey: ["/api/missing-items"],
  });

  const { data: workers } = useQuery<PackingWorker[]>({
    queryKey: ["/api/packing-workers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/missing-items", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/missing-items"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Missing Item Reported", description: "The missing item has been logged successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to report missing item", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      return apiRequest("PUT", `/api/missing-items/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/missing-items"] });
      setEditItem(null);
      resetForm();
      toast({ title: "Item Updated", description: "The missing item record has been updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/missing-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/missing-items"] });
      toast({ title: "Item Deleted", description: "The missing item record has been removed" });
    },
  });

  const resetForm = () => {
    setFormData({
      orderNumber: "",
      customerName: "",
      itemName: "",
      quantity: "1",
      itemValue: "",
      stage: "washing",
      responsibleWorkerId: "",
      responsibleWorkerName: "",
      reportedByWorkerId: "",
      reportedByWorkerName: "",
      notes: "",
      status: "reported",
      reportedAt: new Date().toISOString().split('T')[0],
      resolution: "",
    });
    setOrderLookupNumber("");
    setFoundOrder(null);
    setOrderItems([]);
    setSelectedItemIndex(null);
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
          toast({ title: "Not Found", description: "No delivered order found with this number", variant: "destructive" });
        } else {
          toast({ title: "Error", description: "Failed to lookup order", variant: "destructive" });
        }
        setFoundOrder(null);
        setOrderItems([]);
        return;
      }
      const data = await res.json();
      setFoundOrder(data.order);
      setOrderItems(data.items || []);
      setSelectedItemIndex(null);
      const currentStage = formData.stage;
      const worker = getResponsibleWorkerFromOrder(data.order, currentStage);
      setFormData(prev => ({
        ...prev,
        orderNumber: data.order.orderNumber,
        customerName: data.order.customerName || "",
        responsibleWorkerId: worker.id,
        responsibleWorkerName: worker.name,
      }));
      toast({ title: "Order Found", description: `Found ${data.items?.length || 0} items in order ${data.order.orderNumber}` });
    } catch (err) {
      toast({ title: "Error", description: "Failed to lookup order", variant: "destructive" });
    } finally {
      setLookupLoading(false);
    }
  };

  const selectOrderItem = (index: number) => {
    const item = orderItems[index];
    if (item) {
      setSelectedItemIndex(index);
      setFormData(prev => ({
        ...prev,
        itemName: item.name,
        quantity: String(item.quantity),
        itemValue: String(item.price * item.quantity),
      }));
    }
  };

  const getResponsibleWorkerFromOrder = (order: Order | null, stage: string) => {
    if (!order) return { id: "", name: "" };
    switch (stage) {
      case "tag":
        return { 
          id: order.tagWorkerId ? String(order.tagWorkerId) : "", 
          name: order.tagBy || "" 
        };
      case "washing":
        return { id: "", name: order.washingBy || "" };
      case "packing":
        return { 
          id: order.packingWorkerId ? String(order.packingWorkerId) : "", 
          name: order.packingBy || "" 
        };
      case "delivery":
        return { 
          id: order.deliveredByWorkerId ? String(order.deliveredByWorkerId) : "", 
          name: order.deliveryBy || "" 
        };
      default:
        return { id: "", name: "" };
    }
  };

  const getResponsibleWorkerForStage = (stage: string) => {
    return getResponsibleWorkerFromOrder(foundOrder, stage);
  };

  const handleStageChange = (stage: string) => {
    const worker = getResponsibleWorkerForStage(stage);
    setFormData(prev => ({
      ...prev,
      stage,
      responsibleWorkerId: worker.id,
      responsibleWorkerName: worker.name,
    }));
  };

  const handleWorkerSelect = (workerId: string, type: 'responsible' | 'reporter') => {
    const worker = workers?.find(w => w.id === parseInt(workerId));
    if (type === 'responsible') {
      setFormData({
        ...formData,
        responsibleWorkerId: workerId,
        responsibleWorkerName: worker?.name || "",
      });
    } else {
      setFormData({
        ...formData,
        reportedByWorkerId: workerId,
        reportedByWorkerName: worker?.name || "",
      });
    }
  };

  const handleCreate = () => {
    if (!formData.itemName || !formData.stage) {
      toast({ title: "Error", description: "Item name and stage are required", variant: "destructive" });
      return;
    }
    const data = {
      ...formData,
      quantity: parseInt(formData.quantity) || 1,
      itemValue: formData.itemValue || "0",
      responsibleWorkerId: formData.responsibleWorkerId ? parseInt(formData.responsibleWorkerId) : null,
      reportedByWorkerId: formData.reportedByWorkerId ? parseInt(formData.reportedByWorkerId) : null,
      reportedAt: new Date(formData.reportedAt),
    };
    createMutation.mutate(data);
  };

  const handleUpdate = () => {
    if (!editItem) return;
    const data = {
      ...formData,
      quantity: parseInt(formData.quantity) || 1,
      itemValue: formData.itemValue || "0",
      responsibleWorkerId: formData.responsibleWorkerId ? parseInt(formData.responsibleWorkerId) : null,
      reportedByWorkerId: formData.reportedByWorkerId ? parseInt(formData.reportedByWorkerId) : null,
      reportedAt: new Date(formData.reportedAt),
      resolvedAt: formData.status === "found" || formData.status === "lost" || formData.status === "compensated" ? new Date() : null,
    };
    updateMutation.mutate({ id: editItem.id, updates: data });
  };

  const handleEdit = (item: MissingItem) => {
    setFormData({
      orderNumber: item.orderNumber || "",
      customerName: item.customerName || "",
      itemName: item.itemName,
      quantity: String(item.quantity || 1),
      itemValue: item.itemValue || "",
      stage: item.stage,
      responsibleWorkerId: item.responsibleWorkerId ? String(item.responsibleWorkerId) : "",
      responsibleWorkerName: item.responsibleWorkerName || "",
      reportedByWorkerId: item.reportedByWorkerId ? String(item.reportedByWorkerId) : "",
      reportedByWorkerName: item.reportedByWorkerName || "",
      notes: item.notes || "",
      status: item.status || "reported",
      reportedAt: item.reportedAt ? new Date(item.reportedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      resolution: item.resolution || "",
    });
    setEditItem(item);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "found":
        return <Badge className="bg-green-500 dark:bg-green-600 text-white"><CheckCircle className="w-3 h-3 mr-1" />Found</Badge>;
      case "investigating":
        return <Badge className="bg-yellow-500 dark:bg-yellow-600 text-white"><Clock className="w-3 h-3 mr-1" />Investigating</Badge>;
      case "lost":
        return <Badge className="bg-red-500 dark:bg-red-600 text-white"><AlertTriangle className="w-3 h-3 mr-1" />Lost</Badge>;
      case "compensated":
        return <Badge className="bg-blue-500 dark:bg-blue-600 text-white"><Package className="w-3 h-3 mr-1" />Compensated</Badge>;
      default:
        return <Badge className="bg-orange-500 dark:bg-orange-600 text-white"><Eye className="w-3 h-3 mr-1" />Reported</Badge>;
    }
  };

  const getStageBadge = (stage: string) => {
    switch (stage) {
      case "tag":
        return <Badge variant="outline">Tag</Badge>;
      case "washing":
        return <Badge variant="outline">Washing</Badge>;
      case "packing":
        return <Badge variant="outline">Packing</Badge>;
      case "delivery":
        return <Badge variant="outline">Delivery</Badge>;
      case "storage":
        return <Badge variant="outline">Storage</Badge>;
      default:
        return <Badge variant="outline">{stage}</Badge>;
    }
  };

  const filteredItems = missingItems?.filter(item => {
    const matchesSearch = !searchTerm || 
      item.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.responsibleWorkerName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesStage = stageFilter === "all" || item.stage === stageFilter;
    return matchesSearch && matchesStatus && matchesStage;
  });

  const stats = {
    total: missingItems?.length || 0,
    reported: missingItems?.filter(i => i.status === "reported").length || 0,
    investigating: missingItems?.filter(i => i.status === "investigating").length || 0,
    found: missingItems?.filter(i => i.status === "found").length || 0,
    lost: missingItems?.filter(i => i.status === "lost").length || 0,
    compensated: missingItems?.filter(i => i.status === "compensated").length || 0,
    totalValue: missingItems?.filter(i => i.status === "lost").reduce((sum, i) => sum + parseFloat(i.itemValue || "0"), 0) || 0,
  };

  const renderForm = () => (
    <div className="space-y-4">
      <div className="p-3 bg-muted/50 rounded-lg border space-y-3">
        <Label className="text-sm font-medium">Lookup Delivered Order (Optional)</Label>
        <div className="flex gap-2">
          <Input
            value={orderLookupNumber}
            onChange={(e) => setOrderLookupNumber(e.target.value)}
            placeholder="Enter order number to lookup"
            onKeyDown={(e) => e.key === "Enter" && lookupOrder()}
            data-testid="input-lookup-order"
          />
          <Button 
            type="button" 
            variant="outline" 
            onClick={lookupOrder} 
            disabled={lookupLoading}
            data-testid="button-lookup-order"
          >
            {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </div>
        {foundOrder && orderItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Select the missing item from order <span className="font-mono font-bold">{foundOrder.orderNumber}</span>:
            </p>
            <div className="max-h-40 overflow-y-auto border rounded-md">
              {orderItems.map((item, idx) => (
                <div 
                  key={idx}
                  className={`flex items-center gap-3 p-2 cursor-pointer border-b last:border-b-0 hover-elevate ${selectedItemIndex === idx ? 'bg-primary/10' : ''}`}
                  onClick={() => selectOrderItem(idx)}
                  data-testid={`item-select-${idx}`}
                >
                  <Checkbox 
                    checked={selectedItemIndex === idx}
                    onCheckedChange={() => selectOrderItem(idx)}
                    data-testid={`checkbox-item-${idx}`}
                  />
                  <div className="flex-1">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground ml-2">x{item.quantity}</span>
                  </div>
                  <Badge variant="outline">AED {(item.price * item.quantity).toFixed(2)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
        {foundOrder && orderItems.length === 0 && (
          <p className="text-sm text-amber-600">No items found in this order</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="orderNumber">Order Number</Label>
          <Input
            id="orderNumber"
            value={formData.orderNumber}
            onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
            placeholder="e.g. ORD-2024-001"
            data-testid="input-order-number"
          />
        </div>
        <div>
          <Label htmlFor="customerName">Customer Name</Label>
          <Input
            id="customerName"
            value={formData.customerName}
            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
            placeholder="Customer name"
            data-testid="input-customer-name"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="itemName">Item Name *</Label>
          <Input
            id="itemName"
            value={formData.itemName}
            onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
            placeholder="e.g. Blue Shirt"
            data-testid="input-item-name"
          />
        </div>
        <div>
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            data-testid="input-quantity"
          />
        </div>
        <div>
          <Label htmlFor="itemValue">Item Value (AED)</Label>
          <Input
            id="itemValue"
            type="number"
            step="0.01"
            value={formData.itemValue}
            onChange={(e) => setFormData({ ...formData, itemValue: e.target.value })}
            placeholder="0.00"
            data-testid="input-item-value"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="stage">Stage Where Missing *</Label>
          <Select value={formData.stage} onValueChange={handleStageChange}>
            <SelectTrigger data-testid="select-stage">
              <SelectValue placeholder="Select stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tag">Tag (Receiving)</SelectItem>
              <SelectItem value="washing">Washing</SelectItem>
              <SelectItem value="packing">Packing</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
              <SelectItem value="storage">Storage</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
            <SelectTrigger data-testid="select-status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reported">Reported</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
              <SelectItem value="found">Found</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="compensated">Compensated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="responsibleWorker">Responsible Staff</Label>
          <Select value={formData.responsibleWorkerId || "none"} onValueChange={(val) => handleWorkerSelect(val === "none" ? "" : val, 'responsible')}>
            <SelectTrigger data-testid="select-responsible-worker">
              <SelectValue placeholder="Select staff member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {workers?.map(worker => (
                <SelectItem key={worker.id} value={String(worker.id)}>{worker.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="reportedBy">Reported By</Label>
          <Select value={formData.reportedByWorkerId || "none"} onValueChange={(val) => handleWorkerSelect(val === "none" ? "" : val, 'reporter')}>
            <SelectTrigger data-testid="select-reported-by">
              <SelectValue placeholder="Select reporter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {workers?.map(worker => (
                <SelectItem key={worker.id} value={String(worker.id)}>{worker.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="reportedAt">Date Reported</Label>
        <Input
          id="reportedAt"
          type="date"
          value={formData.reportedAt}
          onChange={(e) => setFormData({ ...formData, reportedAt: e.target.value })}
          data-testid="input-reported-at"
        />
      </div>
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional details about the missing item"
          data-testid="textarea-notes"
        />
      </div>
      {(formData.status === "found" || formData.status === "lost" || formData.status === "compensated") && (
        <div>
          <Label htmlFor="resolution">Resolution Details</Label>
          <Textarea
            id="resolution"
            value={formData.resolution}
            onChange={(e) => setFormData({ ...formData, resolution: e.target.value })}
            placeholder="How was this resolved?"
            data-testid="textarea-resolution"
          />
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-full overflow-x-hidden">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Missing Items</h1>
          <p className="text-muted-foreground">Track and manage missing items with staff accountability</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-report-missing">
              <Plus className="w-4 h-4 mr-2" />
              Report Missing Item
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                Report Missing Item
              </DialogTitle>
            </DialogHeader>
            {renderForm()}
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-create">Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-missing">
                {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Report Item
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Reports</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold" data-testid="text-total-reports">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-orange-600">Reported</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-orange-600" data-testid="text-reported-count">{stats.reported}</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-yellow-600">Investigating</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-investigating-count">{stats.investigating}</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-green-600">Found</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-green-600" data-testid="text-found-count">{stats.found}</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-red-600">Lost</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-red-600" data-testid="text-lost-count">{stats.lost}</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-blue-600">Compensated</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold text-blue-600" data-testid="text-compensated-count">{stats.compensated}</div>
          </CardContent>
        </Card>
        <Card className="hover-elevate">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-medium text-red-600">Lost Value</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-xl font-bold text-red-600" data-testid="text-lost-value">AED {stats.totalValue.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Missing Items Log
          </CardTitle>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-48"
                data-testid="input-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="reported">Reported</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="found">Found</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="compensated">Compensated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-32" data-testid="select-filter-stage">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                <SelectItem value="tag">Tag</SelectItem>
                <SelectItem value="washing">Washing</SelectItem>
                <SelectItem value="packing">Packing</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="storage">Storage</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Responsible</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No missing items reported yet
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems?.map((item) => (
                    <TableRow key={item.id} data-testid={`row-missing-item-${item.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {item.reportedAt ? format(new Date(item.reportedAt), "dd/MM/yy") : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.orderNumber || "-"}</TableCell>
                      <TableCell>{item.customerName || "-"}</TableCell>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.itemValue ? `AED ${parseFloat(item.itemValue).toFixed(2)}` : "-"}</TableCell>
                      <TableCell>{getStageBadge(item.stage)}</TableCell>
                      <TableCell>{item.responsibleWorkerName || "-"}</TableCell>
                      <TableCell>{getStatusBadge(item.status || "reported")}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" onClick={() => handleEdit(item)} data-testid={`button-edit-${item.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            onClick={() => {
                              if (confirm("Delete this missing item record?")) {
                                deleteMutation.mutate(item.id);
                              }
                            }}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3 p-4">
            {filteredItems?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No missing items reported yet
              </div>
            ) : (
              filteredItems?.map((item) => (
                <Card key={item.id} className="hover-elevate" data-testid={`card-missing-item-${item.id}`}>
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <CardTitle className="text-base">{item.itemName}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {item.reportedAt ? format(new Date(item.reportedAt), "dd/MM/yyyy") : "-"}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 items-end">
                        {getStatusBadge(item.status || "reported")}
                        {getStageBadge(item.stage)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      {item.orderNumber && (
                        <div>
                          <span className="text-muted-foreground">Order:</span>{" "}
                          <span className="font-mono">{item.orderNumber}</span>
                        </div>
                      )}
                      {item.customerName && (
                        <div>
                          <span className="text-muted-foreground">Customer:</span> {item.customerName}
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Qty:</span> {item.quantity}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Value:</span>{" "}
                        {item.itemValue ? `AED ${parseFloat(item.itemValue).toFixed(2)}` : "-"}
                      </div>
                      {item.responsibleWorkerName && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Responsible:</span>{" "}
                          <span className="text-red-600 font-medium">{item.responsibleWorkerName}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleEdit(item)} className="flex-1" data-testid={`button-edit-mobile-${item.id}`}>
                        <Pencil className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => {
                          if (confirm("Delete this missing item record?")) {
                            deleteMutation.mutate(item.id);
                          }
                        }}
                        data-testid={`button-delete-mobile-${item.id}`}
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editItem} onOpenChange={(open) => {
        if (!open) {
          setEditItem(null);
          resetForm();
        }
      }}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Edit Missing Item
            </DialogTitle>
          </DialogHeader>
          {renderForm()}
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setEditItem(null)} data-testid="button-cancel-edit">Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending} data-testid="button-update-missing">
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Update Item
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

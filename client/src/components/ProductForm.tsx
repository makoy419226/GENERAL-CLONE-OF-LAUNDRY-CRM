import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProductSchema, type Product } from "@shared/schema";
import { z } from "zod";
import { useCreateProduct, useUpdateProduct, useProducts } from "@/hooks/use-products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useRef, useEffect, useMemo } from "react";
import { Upload, X, Image, Sparkles } from "lucide-react";
import { getProductImage } from "@/lib/productImages";
import { useProductCategorySettings } from "@/lib/productCategories";
import {
  DEFAULT_NEW_PRODUCT_CATEGORY,
  getProductCategoryDisplayName,
  getProductCategoryGroupName,
  normalizeCategoryNames,
  normalizeStoredProductCategoryName,
} from "@shared/productCategories";

// Extend schema to coerce numbers from string inputs
const formSchema = insertProductSchema.extend({
  stockQuantity: z.coerce.number().min(0).optional(),
  price: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  urgentPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  dryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  ironOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  urgentIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  urgentDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  hasSizes: z.boolean().optional(),
  smallPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  mediumPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  largePrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  smallUrgentPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  mediumUrgentPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  largeUrgentPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  smallDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  mediumDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  largeDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  smallIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  mediumIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  largeIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  smallUrgentIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  mediumUrgentIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  largeUrgentIronOnlyPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  smallUrgentDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  mediumUrgentDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  largeUrgentDryCleanPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  sqmPrice: z.string().optional().refine((val) => !val || !isNaN(Number(val)), "Must be a valid number"),
  isSqmPriced: z.boolean().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ProductFormProps {
  defaultValues?: Product;
  onSuccess?: () => void;
  mode: "create" | "edit";
}

export function ProductForm({ defaultValues, onSuccess, mode }: ProductFormProps) {
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const { data: products } = useProducts();
  const {
    settings: sharedCategorySettings,
    updateSettings: updateSharedCategorySettings,
  } = useProductCategorySettings();

  const CATEGORIES = useMemo(() => {
    const productCategories = (products || []).map((p: any) => p.category).filter(Boolean);
    return normalizeCategoryNames([
      ...sharedCategorySettings.baseCategories,
      ...sharedCategorySettings.customCategories,
      ...sharedCategorySettings.inventoryDisplayOrder,
      ...sharedCategorySettings.orderDisplayOrder,
      ...productCategories,
    ]);
  }, [
    products,
    sharedCategorySettings.baseCategories,
    sharedCategorySettings.customCategories,
    sharedCategorySettings.inventoryDisplayOrder,
    sharedCategorySettings.orderDisplayOrder,
  ]);

  const defaultCategory = useMemo(() => {
    return (
      normalizeStoredProductCategoryName(defaultValues?.category, CATEGORIES) ||
      DEFAULT_NEW_PRODUCT_CATEGORY
    );
  }, [CATEGORIES, defaultValues?.category]);

  const categoryOptions = useMemo(
    () => [DEFAULT_NEW_PRODUCT_CATEGORY, ...CATEGORIES],
    [CATEGORIES],
  );

  const [imagePreview, setImagePreview] = useState<string>(defaultValues?.imageUrl || "");
  const [isCustomImage, setIsCustomImage] = useState<boolean>(!!defaultValues?.imageUrl);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryActionError, setCategoryActionError] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const reader = new FileReader();
      
      reader.onload = (e) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas not supported'));
            return;
          }
          
          const targetSize = 400;
          canvas.width = targetSize;
          canvas.height = targetSize;
          
          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(0, 0, targetSize, targetSize);
          
          const scale = Math.min(targetSize / img.width, targetSize / img.height);
          const scaledWidth = img.width * scale;
          const scaledHeight = img.height * scale;
          const x = (targetSize - scaledWidth) / 2;
          const y = (targetSize - scaledHeight) / 2;
          
          ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
          
          const processedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          resolve(processedBase64);
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const processedBase64 = await processImage(file);
        setImagePreview(processedBase64);
        setIsCustomImage(true);
        form.setValue("imageUrl", processedBase64);
      } catch (error) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          setImagePreview(base64);
          setIsCustomImage(true);
          form.setValue("imageUrl", base64);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const clearImage = () => {
    setImagePreview("");
    setIsCustomImage(false);
    form.setValue("imageUrl", "");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultValues ? {
      name: defaultValues.name,
      price: defaultValues.price || "",
      urgentPrice: defaultValues.urgentPrice || "",
      dryCleanPrice: defaultValues.dryCleanPrice || "",
      ironOnlyPrice: defaultValues.ironOnlyPrice || "",
      urgentIronOnlyPrice: defaultValues.urgentIronOnlyPrice || "",
      urgentDryCleanPrice: defaultValues.urgentDryCleanPrice || "",
      hasSizes: defaultValues.hasSizes || false,
      smallPrice: defaultValues.smallPrice || "",
      mediumPrice: defaultValues.mediumPrice || "",
      largePrice: defaultValues.largePrice || "",
      smallUrgentPrice: defaultValues.smallUrgentPrice || "",
      mediumUrgentPrice: defaultValues.mediumUrgentPrice || "",
      largeUrgentPrice: defaultValues.largeUrgentPrice || "",
      smallDryCleanPrice: defaultValues.smallDryCleanPrice || "",
      mediumDryCleanPrice: defaultValues.mediumDryCleanPrice || "",
      largeDryCleanPrice: defaultValues.largeDryCleanPrice || "",
      smallIronOnlyPrice: defaultValues.smallIronOnlyPrice || "",
      mediumIronOnlyPrice: defaultValues.mediumIronOnlyPrice || "",
      largeIronOnlyPrice: defaultValues.largeIronOnlyPrice || "",
      smallUrgentIronOnlyPrice: defaultValues.smallUrgentIronOnlyPrice || "",
      mediumUrgentIronOnlyPrice: defaultValues.mediumUrgentIronOnlyPrice || "",
      largeUrgentIronOnlyPrice: defaultValues.largeUrgentIronOnlyPrice || "",
      smallUrgentDryCleanPrice: defaultValues.smallUrgentDryCleanPrice || "",
      mediumUrgentDryCleanPrice: defaultValues.mediumUrgentDryCleanPrice || "",
      largeUrgentDryCleanPrice: defaultValues.largeUrgentDryCleanPrice || "",
      sqmPrice: defaultValues.sqmPrice || "",
      isSqmPriced: defaultValues.isSqmPriced || false,
      description: defaultValues.description || "",
      sku: defaultValues.sku || "",
      imageUrl: defaultValues.imageUrl || "",
      category: defaultCategory,
      stockQuantity: defaultValues.stockQuantity ?? undefined,
    } : {
      name: "",
      description: "",
      category: DEFAULT_NEW_PRODUCT_CATEGORY,
      price: "",
      urgentPrice: "",
      dryCleanPrice: "",
      ironOnlyPrice: "",
      urgentIronOnlyPrice: "",
      urgentDryCleanPrice: "",
      hasSizes: false,
      smallPrice: "",
      mediumPrice: "",
      largePrice: "",
      smallUrgentPrice: "",
      mediumUrgentPrice: "",
      largeUrgentPrice: "",
      smallDryCleanPrice: "",
      mediumDryCleanPrice: "",
      largeDryCleanPrice: "",
      smallIronOnlyPrice: "",
      mediumIronOnlyPrice: "",
      largeIronOnlyPrice: "",
      smallUrgentIronOnlyPrice: "",
      mediumUrgentIronOnlyPrice: "",
      largeUrgentIronOnlyPrice: "",
      smallUrgentDryCleanPrice: "",
      mediumUrgentDryCleanPrice: "",
      largeUrgentDryCleanPrice: "",
      sqmPrice: "",
      isSqmPriced: false,
      sku: "",
      imageUrl: "",
    },
  });

  const watchedName = form.watch("name");
  const watchedCategory = form.watch("category");
  const watchedHasSizes = form.watch("hasSizes");

  const autoMatchedImage = useMemo(() => {
    if (watchedName && watchedName.length >= 2) {
      return getProductImage(watchedName);
    }
    return null;
  }, [watchedName]);

  const displayImage = isCustomImage ? imagePreview : (autoMatchedImage || imagePreview);

  useEffect(() => {
    if (!form.getValues("category") && defaultCategory) {
      form.setValue("category", defaultCategory, { shouldDirty: false });
    }
  }, [defaultCategory, form]);

  useEffect(() => {
    if (mode === "create" && watchedName && watchedName.length >= 3 && watchedCategory) {
      const prefix = watchedName.substring(0, 3).toUpperCase();
      const categoryProducts =
        products?.filter(
          (p) =>
            getProductCategoryGroupName(p.category, CATEGORIES) ===
            watchedCategory,
        ) || [];
      const nextNumber = categoryProducts.length + 1;
      const newSKU = `${prefix}-${String(nextNumber).padStart(3, '0')}`;
      form.setValue("sku", newSKU);
    }
  }, [watchedName, watchedCategory, mode, products, form]);

  // Clear size-based fields when unchecking hasSizes
  useEffect(() => {
    if (!watchedHasSizes) {
      form.setValue("smallPrice", "");
      form.setValue("mediumPrice", "");
      form.setValue("largePrice", "");
      form.setValue("smallUrgentPrice", "");
      form.setValue("mediumUrgentPrice", "");
      form.setValue("largeUrgentPrice", "");
      form.setValue("smallDryCleanPrice", "");
      form.setValue("mediumDryCleanPrice", "");
      form.setValue("largeDryCleanPrice", "");
      form.setValue("smallIronOnlyPrice", "");
      form.setValue("mediumIronOnlyPrice", "");
      form.setValue("largeIronOnlyPrice", "");
    } else {
      // When checking hasSizes, optionally clear base prices to avoid confusion
      // Commented out - let user decide if they want to keep base prices or not
      // form.setValue("price", "");
      // form.setValue("urgentPrice", "");
      // form.setValue("dryCleanPrice", "");
      // form.setValue("ironOnlyPrice", "");
    }
  }, [watchedHasSizes, form]);

  const watchedIsSqmPriced = form.watch("isSqmPriced");
  const isCarpetCategory = !!watchedIsSqmPriced;

  const handleCreateCategoryFromDropdown = async (
    onSelectCategory: (categoryName: string) => void,
    fallbackCategory: string,
  ) => {
    const rawName = newCategoryName.trim();
    if (!rawName) {
      return;
    }

    const normalizedName = normalizeStoredProductCategoryName(
      rawName,
      CATEGORIES,
    );
    if (!normalizedName) {
      setCategoryActionError(`"${rawName}" is reserved`);
      onSelectCategory(fallbackCategory || DEFAULT_NEW_PRODUCT_CATEGORY);
      return;
    }

    const existingCategory = CATEGORIES.find(
      (categoryName) =>
        categoryName.toLowerCase() === normalizedName.toLowerCase(),
    );
    if (existingCategory) {
      onSelectCategory(existingCategory);
      setNewCategoryName("");
      setCategoryActionError("");
      return;
    }

    setIsCreatingCategory(true);
    setCategoryActionError("");
    try {
      await updateSharedCategorySettings({
        customCategories: normalizeCategoryNames([
          ...sharedCategorySettings.customCategories,
          normalizedName,
        ]),
        inventoryDisplayOrder: normalizeCategoryNames([
          ...sharedCategorySettings.inventoryDisplayOrder,
          normalizedName,
        ]),
        orderDisplayOrder: normalizeCategoryNames([
          ...sharedCategorySettings.orderDisplayOrder,
          normalizedName,
        ]),
      });
      onSelectCategory(normalizedName);
      setNewCategoryName("");
    } catch {
      setCategoryActionError("Failed to create category");
      onSelectCategory(fallbackCategory || DEFAULT_NEW_PRODUCT_CATEGORY);
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const onSubmit = (values: FormValues) => {
    const normalizedCategory = normalizeStoredProductCategoryName(
      values.category,
      CATEGORIES,
    );
    let submitValues: any = {
      ...values,
      category: normalizedCategory,
      isSqmPriced: !!values.isSqmPriced,
    };
    
    // If not using sizes, clear all size-based prices
    if (!values.hasSizes) {
      submitValues.smallPrice = null;
      submitValues.mediumPrice = null;
      submitValues.largePrice = null;
      submitValues.smallUrgentPrice = null;
      submitValues.mediumUrgentPrice = null;
      submitValues.largeUrgentPrice = null;
      submitValues.smallDryCleanPrice = null;
      submitValues.mediumDryCleanPrice = null;
      submitValues.largeDryCleanPrice = null;
      submitValues.smallIronOnlyPrice = null;
      submitValues.mediumIronOnlyPrice = null;
      submitValues.largeIronOnlyPrice = null;
      submitValues.smallUrgentIronOnlyPrice = null;
      submitValues.mediumUrgentIronOnlyPrice = null;
      submitValues.largeUrgentIronOnlyPrice = null;
      submitValues.smallUrgentDryCleanPrice = null;
      submitValues.mediumUrgentDryCleanPrice = null;
      submitValues.largeUrgentDryCleanPrice = null;
    }
    
    if (mode === "create") {
      createProduct.mutate(submitValues, {
        onSuccess: () => {
          form.reset();
          onSuccess?.();
        }
      });
    } else if (mode === "edit" && defaultValues) {
      updateProduct.mutate({ id: defaultValues.id, ...submitValues }, {
        onSuccess: () => onSuccess?.()
      });
    }
  };

  const isPending = createProduct.isPending || updateProduct.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Product Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Lavender Softener" {...field} className="rounded-lg" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select
                disabled={isCreatingCategory}
                onValueChange={(value) => {
                  field.onChange(value);
                  setCategoryActionError("");
                }}
                value={field.value || undefined}
              >
                <FormControl>
                  <SelectTrigger
                    className="rounded-lg"
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      field.onChange(DEFAULT_NEW_PRODUCT_CATEGORY);
                    }}
                  >
                    <SelectValue placeholder={DEFAULT_NEW_PRODUCT_CATEGORY} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {getProductCategoryDisplayName(cat)}
                    </SelectItem>
                  ))}
                  <div
                    className="mt-1 border-t border-border/70 p-2"
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Input
                      value={newCategoryName}
                      onChange={(event) => {
                        setNewCategoryName(event.target.value);
                        setCategoryActionError("");
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleCreateCategoryFromDropdown(
                            field.onChange,
                            field.value || DEFAULT_NEW_PRODUCT_CATEGORY,
                          );
                        }
                      }}
                      placeholder="+ Add New Category"
                      className="h-8 rounded-md text-xs"
                      disabled={isCreatingCategory}
                      data-testid="input-product-form-new-category"
                    />
                  </div>
                </SelectContent>
              </Select>
              {categoryActionError && (
                <p
                  className="text-xs font-medium text-destructive"
                  data-testid="text-product-form-category-error"
                >
                  {categoryActionError}
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {isCarpetCategory ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Per Square Meter Pricing (carpet items)</p>
            <p className="text-xs text-muted-foreground">DC = 2x rate, Iron = 0.5x rate. Price is calculated by multiplying the rate by the area in sqm.</p>
            <FormField
              control={form.control}
              name="sqmPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price per SQM (AED)</FormLabel>
                  <FormControl>
                    <Input data-testid="input-sqm-price" type="number" step="0.01" placeholder="12.00" {...field} value={field.value || ""} className="rounded-lg" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : (
          <>
            {/* Checkbox for Has Sizes */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
              <FormField
                control={form.control}
                name="hasSizes"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={field.onChange}
                        className="w-4 h-4 rounded"
                      />
                    </FormControl>
                    <FormLabel className="cursor-pointer">Product has different sizes (Small, Medium, Large)</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            {!watchedHasSizes ? (
              // Base Prices (No Sizes)
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Base Pricing</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Normal Price (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="urgentPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-red-600">Urgent Price (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-blue-600">Dry Clean Price (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="ironOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-orange-600">Iron Only Price (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="urgentIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-red-600">Urgent + Iron Only (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="IO × 2 if empty" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="urgentDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-red-600">Urgent + Dry Clean (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="DC × 2 if empty" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : (
              // Size-Based Prices
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Size Pricing (for blankets, towels, etc.)</p>
                <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <FormField
                    control={form.control}
                    name="smallPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Small (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="smallUrgentPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urgent</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="smallDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-blue-600">Dry Clean</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="smallIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-orange-600">Iron Only</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="smallUrgentIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urg+IO</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="smallUrgentDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urg+DC</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <FormField
                    control={form.control}
                    name="mediumPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Medium (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mediumUrgentPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urgent</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mediumDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-blue-600">Dry Clean</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mediumIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-orange-600">Iron Only</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mediumUrgentIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urg+IO</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mediumUrgentDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urg+DC</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <FormField
                    control={form.control}
                    name="largePrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Large (AED)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="largeUrgentPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urgent</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="largeDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-blue-600">Dry Clean</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="largeIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-orange-600">Iron Only</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="largeUrgentIronOnlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urg+IO</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="largeUrgentDryCleanPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-red-600">Urg+DC</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value || ""} className="rounded-lg text-sm h-8" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>
            )}
          </>
        )}

        <FormField
          control={form.control}
          name="sku"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SKU (Auto-generated)</FormLabel>
              <FormControl>
                <Input 
                  placeholder="Auto-generated" 
                  {...field} 
                  value={field.value || ""} 
                  className="rounded-lg bg-muted"
                  readOnly
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Describe the product..." 
                  className="resize-none rounded-lg" 
                  {...field} 
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="imageUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Product Image</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  {displayImage ? (
                    <div className="relative w-full h-32 bg-muted rounded-lg overflow-hidden">
                      <img 
                        src={displayImage} 
                        alt="Preview" 
                        className="w-full h-full object-contain"
                      />
                      {!isCustomImage && autoMatchedImage && (
                        <div className="absolute top-2 left-2 flex items-center gap-1 bg-primary/90 text-primary-foreground text-xs px-2 py-1 rounded-full">
                          <Sparkles className="w-3 h-3" />
                          Auto-matched
                        </div>
                      )}
                      {isCustomImage && (
                        <Button
                          type="button"
                          size="icon"
                          variant="destructive"
                          className="absolute top-2 right-2 h-6 w-6"
                          onClick={clearImage}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div 
                      className="w-full h-32 border-2 border-dashed border-muted-foreground/30 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Image className="w-8 h-8 text-muted-foreground mb-2" />
                      <span className="text-sm text-muted-foreground">Click to upload image</span>
                      <span className="text-xs text-muted-foreground">(JPG, PNG, WebP)</span>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {displayImage ? "Upload Custom Image" : "Upload Image"}
                  </Button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button 
            type="submit" 
            className="w-full rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
            disabled={isPending}
          >
            {isPending ? "Saving..." : (mode === "create" ? "Add Product" : "Save Changes")}
          </Button>
        </div>
      </form>
    </Form>
  );
}

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProductForm } from "./ProductForm";
import { useState } from "react";

interface HeaderProps {
  onSearch: (term: string) => void;
  searchValue: string;
}

export function Header({ onSearch, searchValue }: HeaderProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2 mr-4 md:mr-8">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold font-display text-xl">
            L
          </div>
          <h1 className="text-xl md:text-2xl font-display font-bold text-foreground hidden sm:block">
            Liquid<span className="text-primary">Washes</span>
          </h1>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-md relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
            <Search className="w-5 h-5" />
          </div>
          <Input 
            className="pl-10 h-11 rounded-full border-2 border-muted bg-muted/30 focus:bg-background focus:border-primary/50 transition-all duration-300"
            placeholder="Search inventory..." 
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        {/* Action */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button 
              size="lg" 
              className="rounded-full px-6 font-semibold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 transition-all duration-300"
            >
              <Plus className="w-5 h-5 mr-2" />
              <span className="hidden sm:inline">Add Product</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </DialogTrigger>
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
    </header>
  );
}

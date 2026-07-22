import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Link, useLocation } from "wouter";

interface NavigationProps {
  currentPage: "products" | "clients";
  onSearch: (term: string) => void;
  searchValue: string;
  onAddClick: () => void;
  addButtonLabel: string;
}

export function Navigation({ currentPage, onSearch, searchValue, onAddClick, addButtonLabel }: NavigationProps) {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-40 w-full bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
      <div className="container mx-auto px-4">
        <div className="h-20 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2 mr-4 md:mr-8">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold font-display text-xl">
              L
            </div>
            <h1 className="text-xl md:text-2xl font-display font-bold text-foreground hidden sm:block">
              Liquid<span className="text-primary">Washes</span>
            </h1>
          </div>

          {/* Navigation Menu */}
          <div className="flex items-center gap-1 bg-muted/40 px-1.5 py-1.5 rounded-full">
            <Link href="/products">
              <Button 
                variant={currentPage === "products" ? "default" : "ghost"}
                className={`rounded-full font-semibold ${
                  currentPage === "products" 
                    ? "bg-primary text-white shadow-md" 
                    : "hover:bg-muted/50"
                }`}
                data-testid="nav-products"
              >
                Products
              </Button>
            </Link>
            <Link href="/clients">
              <Button 
                variant={currentPage === "clients" ? "default" : "ghost"}
                className={`rounded-full font-semibold ${
                  currentPage === "clients" 
                    ? "bg-primary text-white shadow-md" 
                    : "hover:bg-muted/50"
                }`}
                data-testid="nav-clients"
              >
                Clients
              </Button>
            </Link>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-md relative group">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
              <Search className="w-5 h-5" />
            </div>
            <Input 
              className="pl-10 h-11 rounded-full border-2 border-muted bg-muted/30 focus:bg-background focus:border-primary/50 transition-all duration-300"
              placeholder={currentPage === "products" ? "Search inventory..." : "Search clients..."} 
              value={searchValue}
              onChange={(e) => onSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>

          {/* Add Button */}
          <Button 
            size="lg" 
            className="rounded-full px-6 font-semibold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 transition-all duration-300"
            onClick={onAddClick}
            data-testid="button-add"
          >
            <Plus className="w-5 h-5 mr-2" />
            <span className="hidden sm:inline">{addButtonLabel}</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

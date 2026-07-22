import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md mx-4 shadow-xl border-border/50 bg-card/80 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 text-destructive font-display text-2xl font-bold items-center justify-center">
            <AlertCircle className="h-8 w-8" />
            <span>404 Page Not Found</span>
          </div>
          <p className="mt-4 text-muted-foreground text-center">
            The page you are looking for does not exist.
          </p>
          
          <div className="mt-8 flex justify-center">
            <Link href="/">
              <Button size="lg" className="rounded-full bg-primary hover:bg-primary/90 font-semibold px-8 shadow-lg shadow-primary/20">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

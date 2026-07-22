import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Loader2, Lock, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { UserInfo } from "@/pages/Login";
import logoImage from "@assets/image_1767220512226.png";

export type LockdownStatus = {
  enabled: boolean;
  reason: string;
  lockedAt?: string | null;
  lockedBy?: string | null;
};

type LockdownProps = {
  status: LockdownStatus | null;
  onAdminLogin: (user: UserInfo) => void;
};

export default function Lockdown({ status, onAdminLogin }: LockdownProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showAdminAccess, setShowAdminAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const lockedAt = status?.lockedAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(status.lockedAt))
    : "";

  const handleAdminLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setLoginError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();

      if (!response.ok || !data.success || data.user?.role !== "admin") {
        setLoginError(data.message || "Admin account required");
        return;
      }

      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("user", JSON.stringify(data.user));
      onAdminLogin(data.user);
      toast({
        title: "Admin access granted",
        description: "Open Admin Settings to lift lockdown when ready.",
      });
      setLocation("/admin-settings");
    } catch {
      setLoginError("Failed to connect to server");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-lg space-y-5">
        <div className="flex flex-col items-center text-center">
          <img
            src={logoImage}
            alt="Liquide Washes Laundry"
            className="h-16 object-contain"
            data-testid="img-lockdown-logo"
          />
          <div className="mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Shield className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">Page lockdown for security reasons</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            The webapp is temporarily locked by the admin account.
          </p>
          {lockedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Locked {lockedAt}
              {status?.lockedBy ? ` by ${status.lockedBy}` : ""}
            </p>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Security Lockdown Active
            </CardTitle>
            <CardDescription>
              {status?.reason || "Page lockdown for security reasons."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showAdminAccess ? (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowAdminAccess(true)}
                data-testid="button-show-admin-lockdown-login"
              >
                <Lock className="h-4 w-4" />
                Admin Access
              </Button>
            ) : (
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-lockdown-username">Admin Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="admin-lockdown-username"
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        setLoginError("");
                      }}
                      className="pl-10"
                      autoComplete="username"
                      data-testid="input-lockdown-admin-username"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin-lockdown-password">Admin Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="admin-lockdown-password"
                      type="password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setLoginError("");
                      }}
                      className="pl-10"
                      autoComplete="current-password"
                      data-testid="input-lockdown-admin-password"
                    />
                  </div>
                </div>

                {loginError && (
                  <p className="text-sm text-destructive">{loginError}</p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={!username || !password || isLoading}
                  data-testid="button-lockdown-admin-login"
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shield className="mr-2 h-4 w-4" />
                  )}
                  Continue as Admin
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

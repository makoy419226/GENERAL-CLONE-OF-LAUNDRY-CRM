import { useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { AppleMotionBackdrop } from "@/components/AppleMotion";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  name: string;
  businessId?: number | null;
  businessName?: string | null;
  businessSlug?: string | null;
  businessLogoUrl?: string | null;
}
interface LoginProps {
  onLogin: (user: UserInfo) => void;
}

type LoginPortal = "tenant" | "super_admin";

const appleEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const loginStageVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.21,
      ease: appleEase,
      staggerChildren: 0.053,
    },
  },
};

const loginPanelVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.982, borderRadius: 30, filter: "blur(10px)" },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    borderRadius: 0,
    filter: "blur(0px)",
    transition: { duration: 0.35, ease: appleEase },
  },
};

export default function Login({ onLogin }: LoginProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginPortal, setLoginPortal] = useState<LoginPortal>("tenant");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "code" | "newPassword">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, portal: loginPortal }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("user", JSON.stringify(data.user));
        localStorage.setItem("authToken", data.token);
        toast({
          title: `Welcome, ${data.user.name || data.user.username}!`,
          description: data.user.role === "super_admin"
            ? "Platform Console access granted"
            : `${data.user.businessName || "Workspace"} workspace access granted`,
        });
        onLogin(data.user);
        setLocation(data.user.role === "super_admin" ? "/super-admin" : "/");
      } else {
        toast({
          title: "Login Failed",
          description: data.message || "Invalid username or password",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to connect to server",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const switchLoginPortal = (portal: LoginPortal) => {
    if (portal === loginPortal || isLoading) return;
    setLoginPortal(portal);
    setUsername("");
    setPassword("");
    setShowPassword(false);
    closeForgotPassword();
  };

  const handleRequestReset = async () => {
    if (!resetEmail) {
      toast({ title: "Error", description: "Please enter your email", variant: "destructive" });
      return;
    }
    setIsResetting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, portal: loginPortal }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.previewCode) {
          setResetCode(data.previewCode);
        }
        toast({
          title: "Success",
          description: data.previewCode
            ? `Development reset code: ${data.previewCode}`
            : data.message || "Reset code sent to your email",
        });
        setResetStep("code");
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to send reset code", variant: "destructive" });
    } finally {
      setIsResetting(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!resetCode) {
      toast({ title: "Error", description: "Please enter the code", variant: "destructive" });
      return;
    }
    setIsResetting(true);
    try {
      const response = await fetch("/api/auth/verify-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, portal: loginPortal }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: "Success", description: "Code verified" });
        setResetStep("newPassword");
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to verify code", variant: "destructive" });
    } finally {
      setIsResetting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setIsResetting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: resetEmail,
          code: resetCode,
          newPassword,
          portal: loginPortal,
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: "Success", description: "Password reset successfully. Please login with your new password." });
        setShowForgotPassword(false);
        setResetStep("email");
        setResetEmail("");
        setResetCode("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to reset password", variant: "destructive" });
    } finally {
      setIsResetting(false);
    }
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setResetStep("email");
    setResetEmail("");
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-br from-primary/10 via-background to-emerald-500/5">
      <AppleMotionBackdrop className="opacity-75" />
      <div className="relative z-10 flex flex-1 items-center justify-center p-4">
        <motion.div
          className="w-full max-w-md"
          variants={loginStageVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="w-full max-w-md" variants={loginPanelVariants}>
            <Card className="w-full shadow-2xl liquid-glass">
              <CardHeader className="space-y-5 pb-3 text-center">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={loginPortal}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18, ease: appleEase }}
                  >
                    {loginPortal === "tenant" ? (
                      <>
                        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                          <Building2 className="h-7 w-7" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight">Workspace</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Sign in to your assigned business account
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-emerald-300 shadow-sm">
                          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight">Platform Console</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Restricted access for the platform owner
                        </p>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">
                      {loginPortal === "super_admin" ? "Super admin username" : "Workspace username"}
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="username"
                        type="text"
                        placeholder="Enter username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="h-11 pl-10"
                        autoComplete="username"
                        required
                        data-testid="input-username"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 pl-10 pr-12"
                        autoComplete="current-password"
                        required
                        data-testid="input-password"
                      />
                      <button
                        type="button"
                        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => setShowPassword((visible) => !visible)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        data-testid="button-toggle-password-visibility"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className={`h-11 w-full gap-2 ${loginPortal === "super_admin" ? "bg-slate-950 text-white hover:bg-slate-800" : ""}`}
                    disabled={isLoading || !username.trim() || !password}
                    data-testid="button-login"
                  >
                    {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {!isLoading && (loginPortal === "super_admin" ? <ShieldCheck className="h-4 w-4" /> : <Building2 className="h-4 w-4" />)}
                    {loginPortal === "super_admin" ? "Open Platform Console" : "Open Workspace"}
                  </Button>

                  <div className="text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 text-sm text-muted-foreground"
                      onClick={() => setShowForgotPassword(true)}
                      data-testid="button-forgot-password"
                    >
                      {loginPortal === "super_admin"
                        ? "Forgot console password?"
                        : "Forgot workspace password?"}
                    </Button>
                  </div>
                </form>

              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="fixed bottom-4 right-4 z-20 h-11 gap-2 bg-background/90 shadow-lg backdrop-blur sm:bottom-6 sm:right-6"
        disabled={isLoading}
        onClick={() =>
          switchLoginPortal(loginPortal === "tenant" ? "super_admin" : "tenant")
        }
        data-testid="button-switch-login-portal"
      >
        {loginPortal === "tenant" ? (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Building2 className="h-4 w-4" aria-hidden="true" />
        )}
        {loginPortal === "tenant" ? "Console" : "Workspace Login"}
      </Button>

      <Dialog open={showForgotPassword} onOpenChange={closeForgotPassword}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {loginPortal === "super_admin"
                ? "Reset console password"
                : "Reset workspace password"}
            </DialogTitle>
            <DialogDescription>
              {resetStep === "email" &&
                (loginPortal === "super_admin"
                  ? "Enter the Console account email address to receive a reset code."
                  : "Enter the workspace's registered contact email to receive a reset code.")}
              {resetStep === "code" && "Enter the 6-digit code sent to your email."}
              {resetStep === "newPassword" && "Create a new password for your account."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {resetStep === "email" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="Enter your email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="h-11 pl-10"
                      data-testid="input-reset-email"
                    />
                  </div>
                </div>
                <Button
                  className="h-11 w-full"
                  onClick={handleRequestReset}
                  disabled={isResetting}
                  data-testid="button-send-code"
                >
                  {isResetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Send Reset Code
                </Button>
              </>
            )}

            {resetStep === "code" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="reset-code">Verification Code</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="reset-code"
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      className="h-11 pl-10 text-center text-lg tracking-widest"
                      maxLength={6}
                      data-testid="input-reset-code"
                    />
                  </div>
                </div>
                <Button
                  className="h-11 w-full"
                  onClick={handleVerifyCode}
                  disabled={isResetting}
                  data-testid="button-verify-code"
                >
                  {isResetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Verify Code
                </Button>
                <Button
                  variant="ghost"
                  className="h-11 w-full"
                  onClick={() => setResetStep("email")}
                  data-testid="button-back-to-email"
                >
                  Back
                </Button>
              </>
            )}

            {resetStep === "newPassword" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 pl-10"
                      data-testid="input-new-password"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 pl-10"
                      data-testid="input-confirm-password"
                    />
                  </div>
                </div>
                <Button
                  className="h-11 w-full"
                  onClick={handleResetPassword}
                  disabled={isResetting}
                  data-testid="button-reset-password"
                >
                  {isResetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Reset Password
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Lock, User, Mail, KeyRound } from "lucide-react";
import { AppleMotionBackdrop } from "@/components/AppleMotion";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import logoImage from "@assets/image_1767220512226.png";
import { getProductImage } from "@/lib/productImages";

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  name: string;
}

interface LoginProps {
  onLogin: (user: UserInfo) => void;
}

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

const serviceGridVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0.09,
    },
  },
};

const serviceItemVariants = {
  hidden: { opacity: 0, y: 9, scale: 0.965, borderRadius: 20 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    borderRadius: 8,
    transition: { duration: 0.23, ease: appleEase },
  },
};

export default function Login({ onLogin }: LoginProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "code" | "newPassword">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<{name: string, image: string, origin: {x: number, y: number}} | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("user", JSON.stringify(data.user));
        toast({
          title: `Welcome, ${data.user.name || data.user.username}!`,
          description: `Logged in as ${data.user.role.charAt(0).toUpperCase() + data.user.role.slice(1)}`,
        });
        onLogin(data.user);
        setLocation("/");
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
        body: JSON.stringify({ email: resetEmail }),
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
        body: JSON.stringify({ email: resetEmail, code: resetCode }),
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
    if (newPassword.length < 4) {
      toast({ title: "Error", description: "Password must be at least 4 characters", variant: "destructive" });
      return;
    }
    setIsResetting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword }),
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

  const services = [
    { name: "Kandoora", color: "bg-blue-500" },
    { name: "Abaya", color: "bg-purple-500" },
    { name: "Saree", color: "bg-pink-500" },
    { name: "Suit", color: "bg-indigo-500" },
    { name: "Shirt", color: "bg-cyan-500" },
    { name: "Jeans", color: "bg-teal-500" },
    { name: "Blanket", color: "bg-orange-500" },
    { name: "Carpet", color: "bg-red-500" },
    { name: "Curtain", color: "bg-emerald-500" },
    { name: "Towel", color: "bg-amber-500" },
    { name: "Shoes", color: "bg-rose-500" },
    { name: "Jacket", color: "bg-violet-500" },
  ];

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-primary/10 via-background to-emerald-500/5">
      <AppleMotionBackdrop className="opacity-75" />
      <div className="relative z-10 flex flex-1 items-center justify-center p-4">
        <motion.div
          className="flex w-full max-w-5xl flex-col items-center gap-8 lg:flex-row"
          variants={loginStageVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="w-full max-w-md" variants={loginPanelVariants}>
            <Card className="w-full shadow-2xl liquid-glass">
              <CardHeader className="text-center pb-2">
                <div className="flex justify-center mb-4">
                  <img 
                    src={logoImage} 
                    alt="Liquide Washes Laundry" 
                    className="h-20 object-contain"
                    data-testid="img-login-logo"
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Liquide Washes Laundry Management System
                </p>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="username"
                        type="text"
                        placeholder="Enter username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-username"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10"
                        required
                        data-testid="input-password"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    className="w-full"
                    disabled={isLoading}
                    data-testid="button-login"
                  >
                    {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Login
                  </Button>

                  <div className="text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-sm text-muted-foreground"
                      onClick={() => setShowForgotPassword(true)}
                      data-testid="button-forgot-password"
                    >
                      Forgot Password?
                    </Button>
                  </div>
                </form>

                <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">Liquide Washes Laundry</p>
                  <p>Centra Market D/109, Al Dhanna City</p>
                  <p>Al Ruwais, Abu Dhabi - UAE</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div className="hidden flex-1 lg:block" variants={loginPanelVariants}>
            <div className="h-48 flex items-center justify-center mb-2 relative">
              <div className="w-48 h-48 absolute">
                <AnimatePresence mode="popLayout">
                  {fullScreenImage && (
                    <motion.img
                      key={fullScreenImage.name}
                      src={fullScreenImage.image}
                      alt={fullScreenImage.name}
                      className="h-full w-full object-contain drop-shadow-xl"
                      initial={{ opacity: 0, y: 8, scale: 0.9, borderRadius: 28, filter: "blur(8px)" }}
                      animate={{ opacity: 1, y: 0, scale: 1, borderRadius: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -6, scale: 0.93, borderRadius: 20, filter: "blur(6px)" }}
                      transition={{ duration: 0.19, ease: appleEase }}
                      data-testid="img-fullscreen-service"
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-4 text-foreground">Our Laundry Services</h2>
            <motion.div className="grid grid-cols-3 gap-3" variants={serviceGridVariants}>
              {services.map((service, index) => (
                <motion.div
                  key={index}
                  className={`${service.color} relative cursor-pointer overflow-hidden rounded-lg p-4 text-center font-semibold text-white shadow-lg`}
                  variants={serviceItemVariants}
                  whileHover={{ y: -4, scale: 1.035, boxShadow: "0 18px 42px -26px rgba(15, 23, 42, 0.48)" }}
                  whileTap={{ scale: 0.98 }}
                  onMouseEnter={(e) => {
                    const image = getProductImage(service.name);
                    if (image) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = rect.left + rect.width / 2;
                      const y = rect.top + rect.height / 2;
                      setFullScreenImage({ name: service.name, image, origin: { x, y } });
                    }
                  }}
                  onMouseLeave={() => setFullScreenImage(null)}
                  data-testid={`service-box-${index}`}
                >
                  {service.name}
                </motion.div>
              ))}
            </motion.div>
            <p className="text-center mt-6 text-muted-foreground text-sm">
              Professional cleaning for 43+ laundry items
            </p>
          </motion.div>
        </motion.div>
      </div>

      <Dialog open={showForgotPassword} onOpenChange={closeForgotPassword}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetStep === "email" && "Enter your email address to receive a reset code."}
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
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="Enter your email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="pl-10"
                      data-testid="input-reset-email"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
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
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="reset-code"
                      type="text"
                      placeholder="Enter 6-digit code"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      className="pl-10 text-center text-lg tracking-widest"
                      maxLength={6}
                      data-testid="input-reset-code"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleVerifyCode}
                  disabled={isResetting}
                  data-testid="button-verify-code"
                >
                  {isResetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Verify Code
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
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
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="pl-10"
                      data-testid="input-new-password"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10"
                      data-testid="input-confirm-password"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
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

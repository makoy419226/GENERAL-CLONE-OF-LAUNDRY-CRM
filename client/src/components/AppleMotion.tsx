import { MotionConfig, motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

const appleEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 8,
    scale: 0.994,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.18,
      ease: appleEase,
    },
  },
};

interface AppleMotionProviderProps {
  children: ReactNode;
}

export function AppleMotionProvider({ children }: AppleMotionProviderProps) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{
        duration: 0.21,
        ease: appleEase,
      }}
    >
      {children}
    </MotionConfig>
  );
}

interface RouteMotionShellProps {
  children: ReactNode;
  location: string;
}

export function RouteMotionShell({ children, location }: RouteMotionShellProps) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className="motion-route-shell">{children}</div>;
  }

  return (
    <motion.div
      key={location}
      className="motion-route-shell"
      variants={pageVariants}
      initial="initial"
      animate="animate"
    >
      {children}
    </motion.div>
  );
}

interface AppleMotionBackdropProps {
  className?: string;
}

export function AppleMotionBackdrop({ className = "" }: AppleMotionBackdropProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={`apple-motion-backdrop ${className}`} aria-hidden="true">
      <motion.div
        className="apple-motion-ribbon apple-motion-ribbon-one"
        animate={
          reduceMotion
            ? undefined
            : {
                x: ["-2%", "3%", "-2%"],
                y: [0, 14, 0],
                rotate: [-1.8, 1.1, -1.8],
                scaleX: [1, 1.05, 1],
                scaleY: [1, 0.94, 1],
              }
        }
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="apple-motion-ribbon apple-motion-ribbon-two"
        animate={
          reduceMotion
            ? undefined
            : {
                x: ["2%", "-3%", "2%"],
                y: [0, -12, 0],
                rotate: [1.2, -1.6, 1.2],
                scaleX: [1, 0.96, 1],
                scaleY: [1, 1.06, 1],
              }
        }
        transition={{ duration: 14.7, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

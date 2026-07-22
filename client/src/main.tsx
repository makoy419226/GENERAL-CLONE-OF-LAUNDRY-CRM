import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./index.css";

if (import.meta.env.DEV) {
  if (typeof window !== "undefined" && "ResizeObserver" in window) {
    const NativeResizeObserver = window.ResizeObserver;
    // Defer ResizeObserver callbacks to the next frame to avoid browser loop-limit errors in dev.
    window.ResizeObserver = class ResizeObserver extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          window.requestAnimationFrame(() => callback(entries, observer));
        });
      }
    };
  }

  const ignoredRuntimeMessages = [
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
    "Script error.",
    "Script error",
  ];

  const shouldIgnoreRuntimeMessage = (message: string | undefined | null) =>
    !!message &&
    ignoredRuntimeMessages.some((ignoredMessage) =>
      message.includes(ignoredMessage),
    );

  const shouldIgnoreRuntimeErrorEvent = (event: ErrorEvent) => {
    const message =
      event.message ||
      (event.error && typeof event.error.message === "string"
        ? event.error.message
        : "");

    if (shouldIgnoreRuntimeMessage(message)) {
      return true;
    }

    return false;
  };

  // Prevent runtime overlays from opening on known benign browser/runtime noise in dev.
  window.addEventListener(
    "error",
    (event) => {
      if (shouldIgnoreRuntimeErrorEvent(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      const reason = event.reason;
      const message =
        typeof reason === "string"
          ? reason
          : reason && typeof reason.message === "string"
            ? reason.message
            : "";

      if (shouldIgnoreRuntimeMessage(message)) {
        event.preventDefault();
      }
    },
    true,
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);

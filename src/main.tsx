import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "@/app/App";
import { AppDataProvider } from "@/app/AppDataProvider";
import { AuthProvider } from "@/app/AuthProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Memento could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <AuthProvider>
          <AppDataProvider>
            <App />
            <Toaster position="top-center" richColors />
          </AppDataProvider>
        </AuthProvider>
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import { App } from "./App";
import { applyTheme, readStoredTheme } from "./theme/theme";
import "./tailwind.css";

applyTheme(readStoredTheme() ?? "system");

// Cache de dados do servidor compartilhado pelo painel inteiro (TanStack Query)
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

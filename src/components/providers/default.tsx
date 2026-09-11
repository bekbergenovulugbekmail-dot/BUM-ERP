import { ConvexProvider } from "./convex.tsx";
import { QueryClientProvider } from "./query-client.tsx";
import { ThemeProvider } from "./theme.tsx";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { ModuleProvider } from "./module-provider.tsx";

// ConvexProvider — PHASE 16 oxirida, barcha sahifalar API'ga o'tgach olib tashlanadi
export function DefaultProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProvider>
      <QueryClientProvider>
        <TooltipProvider>
          <ThemeProvider>
            <ModuleProvider>
              <Toaster />
              {children}
            </ModuleProvider>
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ConvexProvider>
  );
}

import { ConvexProvider } from "./convex.tsx";
import { UserSync } from "./user-sync.tsx";
import { QueryClientProvider } from "./query-client.tsx";
import { ThemeProvider } from "./theme.tsx";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { ModuleProvider } from "./module-provider.tsx";

export function DefaultProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProvider>
      <UserSync>
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
      </UserSync>
    </ConvexProvider>
  );
}

import {
  QueryClient,
  QueryClientProvider as ReactQueryClientProvider,
} from "@tanstack/react-query";
import { ApiError, UNAUTHENTICATED_EVENT } from "@/lib/api.ts";
import { AUTH_ME_KEY } from "@/lib/query.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // 4xx — takrorlash foyda bermaydi (ruxsat, validatsiya, topilmadi)
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
    mutations: { retry: false },
  },
});

if (typeof window !== "undefined") {
  // Sessiya tugagan (muddati, parol almashtirildi, admin bekor qildi): foydalanuvchi — yo'q, layout login'ga o'tkazadi
  window.addEventListener(UNAUTHENTICATED_EVENT, () => {
    queryClient.setQueryData(AUTH_ME_KEY, null);
  });
}

export function QueryClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ReactQueryClientProvider client={queryClient}>
      {children}
    </ReactQueryClientProvider>
  );
}

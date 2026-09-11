/**
 * React Query ustidagi yupqa qatlam — Convex `useQuery` / `useMutation` o'rniga.
 *
 * - `useApiQuery(null)` — Convex'dagi `"skip"` bilan bir xil (so'rov yuborilmaydi)
 * - kalit `[path, params]`: yo'l prefiksi bo'yicha bekor qilish oson
 * - mutatsiya muvaffaqiyatli bo'lsa ko'rinib turgan so'rovlar qayta olinadi (Convex reaktivligi o'rniga):
 *   savdo → ombor → moliya kabi modullararo ta'sirlar alohida sanab o'tilmaydi
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { api, type ApiError, type QueryParams } from "./api.ts";

export const AUTH_ME_KEY = ["/api/auth/me"] as const;

type QueryOptions<T> = Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">;

export function useApiQuery<T>(path: string | null, params?: QueryParams, options: QueryOptions<T> = {}) {
  return useQuery<T, ApiError>({
    queryKey: [path, params ?? {}],
    queryFn: ({ signal }) => api.get<T>(path!, params, signal),
    ...options,
    enabled: path !== null && (options.enabled ?? true),
  });
}

type MutationOptions = {
  /** Qaysi so'rovlar yangilanadi: yo'l prefikslari; standart — hammasi (faqat ko'rinib turganlari qayta olinadi). */
  invalidate?: string[] | false;
};

export function useApiMutation<TVariables = void, TResult = unknown>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  { invalidate }: MutationOptions = {},
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiError, TVariables>({
    mutationFn,
    onSuccess: async () => {
      if (invalidate === false) return;
      if (!invalidate) {
        await queryClient.invalidateQueries();
        return;
      }
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const path = query.queryKey[0];
          return typeof path === "string" && invalidate.some((prefix) => path.startsWith(prefix));
        },
      });
    },
  });
}

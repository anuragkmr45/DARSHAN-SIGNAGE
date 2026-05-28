import { useMutation, UseMutationOptions } from "@tanstack/react-query";
import { ApiError } from "@/api/apiClient";
import { useToast } from "@/hooks/use-toast";

export function useSafeMutation<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, unknown, TVariables>,
  fallbackMessage = "Request failed. Please try again.",
) {
  const { toast } = useToast();

  return useMutation<TData, unknown, TVariables>({
    ...options,
    onError: (err, vars, ctx) => {
      const message =
        err instanceof ApiError ? err.message : fallbackMessage;
      toast({ title: "Error", description: message, variant: "destructive" });
      options.onError?.(err, vars, ctx);
    },
  });
}

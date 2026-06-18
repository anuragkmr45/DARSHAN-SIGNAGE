import { useCallback, useRef } from "react";

export function useDebouncedCallback<T extends (...args: unknown[]) => void>(callback: T, delay = 300) {
  const timeoutRef = useRef<number>();

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]) as T;
}

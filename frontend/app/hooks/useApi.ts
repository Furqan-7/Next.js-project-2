"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../services/api";

interface Result<T> {
  path: string | null;
  data: T | null;
  error: string | null;
}

/**
 * Loads `path` from the API: { data, error, loading, reload, setData }.
 * The previous data stays visible while a new path loads, so filters don't flash empty.
 */
export function useApi<T>(path: string | null) {
  const [result, setResult] = useState<Result<T>>({ path: null, data: null, error: null });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path).then(
      (data) => alive && setResult({ path, data, error: null }),
      (e) => alive && setResult((r) => ({ path, data: r.data, error: errorMessage(e) })),
    );
    return () => {
      alive = false;
    };
  }, [path]);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api<T>(path);
      setResult({ path, data, error: null });
    } catch (e) {
      setResult((r) => ({ path, data: r.data, error: errorMessage(e) }));
    }
  }, [path]);

  const setData = useCallback((data: T | null) => setResult((r) => ({ ...r, data })), []);

  return { data: result.data, error: result.error, loading: Boolean(path) && result.path !== path, reload, setData };
}

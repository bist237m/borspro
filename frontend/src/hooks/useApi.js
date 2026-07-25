// src/hooks/useApi.js
// Her API çağrısı için loading / error / data state'ini otomatik yönetir.

import { useState, useEffect, useCallback } from "react";

/**
 * useApi(fetchFn, deps)
 *
 * fetchFn  : () => Promise  — API çağrısını yapan fonksiyon
 * deps     : any[]          — fetchFn'in bağımlılıkları (useEffect gibi)
 *
 * Döner: { data, loading, error, refetch }
 */
export function useApi(fetchFn, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (e) {
      setError(e.message || "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, loading, error, refetch: run };
}

/**
 * useMutation(mutateFn)
 *
 * Bir kerelik (POST/DELETE vb.) işlemler için.
 * Döner: { mutate, loading, error }
 */
export function useMutation(mutateFn) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const mutate = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutateFn(...args);
      return result;
    } catch (e) {
      setError(e.message || "Bir hata oluştu.");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [mutateFn]);

  return { mutate, loading, error };
}

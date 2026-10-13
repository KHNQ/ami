import { useCallback, useEffect, useRef, useState } from "react";

// Small data-fetching hook: re-runs `fn` whenever `deps` change, tracks
// loading/error/data, and ignores stale responses from a superseded call.
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const callId = useRef(0);

  const run = useCallback(() => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);
    fn()
      .then((res) => {
        if (id === callId.current) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (id === callId.current) {
          setError(err);
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, refetch: run, setData };
}

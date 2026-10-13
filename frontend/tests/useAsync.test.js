import { describe, test, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAsync } from "../src/hooks/useAsync.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsync", () => {
  test("starts in a loading state with no data or error", () => {
    const { promise } = deferred();
    const { result } = renderHook(() => useAsync(() => promise, []));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);
  });

  test("resolves into data and clears loading", async () => {
    const { promise, resolve } = deferred();
    const { result } = renderHook(() => useAsync(() => promise, []));

    act(() => resolve({ hello: "world" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ hello: "world" });
    expect(result.current.error).toBe(null);
  });

  test("rejects into an error and clears loading, leaving data null", async () => {
    const { promise, reject } = deferred();
    const err = new Error("boom");
    // Prevent the test runner from also reporting this as an unhandled rejection.
    promise.catch(() => {});
    const { result } = renderHook(() => useAsync(() => promise, []));

    act(() => reject(err));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(err);
    expect(result.current.data).toBe(null);
  });

  test("ignores a stale response when refetch() is called before the first call resolves", async () => {
    const first = deferred();
    const second = deferred();
    const calls = [first.promise, second.promise];
    let callIndex = 0;
    const fn = vi.fn(() => calls[callIndex++]);

    const { result } = renderHook(() => useAsync(fn, []));
    expect(fn).toHaveBeenCalledTimes(1); // initial mount call consumed `first`

    act(() => {
      result.current.refetch(); // consumes `second`
    });
    expect(fn).toHaveBeenCalledTimes(2);

    // Resolve the SECOND call first, then the stale first call afterward.
    act(() => second.resolve("second-result"));
    await waitFor(() => expect(result.current.data).toBe("second-result"));

    act(() => first.resolve("first-result-STALE"));
    // Give any (incorrect) state update a chance to land, then assert the
    // stale response never overwrote the real one.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.data).toBe("second-result");
  });

  test("re-runs when a dependency changes", async () => {
    const fn = vi.fn(() => Promise.resolve("ok"));
    const { rerender } = renderHook(({ dep }) => useAsync(fn, [dep]), {
      initialProps: { dep: 1 },
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

    rerender({ dep: 2 });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// The provider bootstraps by reading the stored token and, if there is one,
// calling GET /me. Both are stubbed so each test can hold the response open and
// observe the *intermediate* state, which is the whole point here.
const me = vi.fn();
class ApiError extends Error {
  constructor(status) {
    super(`http ${status}`);
    this.status = status;
  }
}
vi.mock("../../src/lib/api.js", () => ({
  api: { me: (...a) => me(...a) },
  ApiError,
  setUnauthorizedHandler: () => {},
}));

let storedToken = null;
vi.mock("../../src/lib/token.js", () => ({
  getToken: () => storedToken,
  setToken: (t) => {
    storedToken = t;
  },
}));

const { AuthProvider, useAuth } = await import("../../src/context/AuthContext.jsx");

function Probe() {
  const { status, isAuthed, isSignedOut } = useAuth();
  return <div data-testid="p">{`${status}|${isAuthed}|${isSignedOut}`}</div>;
}

const readProbe = (getByTestId) => getByTestId("p").textContent;

describe("auth status is three-valued, not a boolean", () => {
  beforeEach(() => {
    me.mockReset();
    storedToken = null;
  });

  test("while GET /me is in flight, the session is neither authed NOR signed out", async () => {
    storedToken = "a-real-token";
    // A promise that never settles: this IS the window the bug lived in.
    me.mockReturnValue(new Promise(() => {}));

    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    // The regression: `isSignedOut` must stay false here. Code that redirects
    // to /login on `!isAuthed` fires during this window and throws a genuinely
    // signed-in customer onto the login screen.
    expect(readProbe(getByTestId)).toBe("loading|false|false");
  });

  test("a resolved /me settles into signed-in", async () => {
    storedToken = "a-real-token";
    me.mockResolvedValue({ id: "u1", name: "Root Buyer" });

    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(readProbe(getByTestId)).toBe("signed-in|true|false"));
  });

  test("no stored token is signed out immediately -- no /me call at all", async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(readProbe(getByTestId)).toBe("signed-out|false|true"));
    expect(me).not.toHaveBeenCalled();
  });

  test("a 401 ends the session", async () => {
    storedToken = "a-stale-token";
    me.mockRejectedValue(new ApiError(401));

    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(readProbe(getByTestId)).toBe("signed-out|false|true"));
    // No retry: the credential was rejected, so asking again cannot help.
    expect(me).toHaveBeenCalledTimes(1);
  });

  test("a network failure retries and must NOT delete the stored token", async () => {
    storedToken = "a-good-token";
    // Not an ApiError -- this is what fetch throws when the connection fails,
    // which is the case that used to log people out for good.
    me.mockRejectedValue(new TypeError("Failed to fetch"));

    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(readProbe(getByTestId)).toBe("signed-out|false|true"), {
      timeout: 5000,
    });
    expect(me).toHaveBeenCalledTimes(3); // initial + 2 retries
    // The regression this file exists for: a blip must leave the session
    // recoverable on the next load rather than destroying it.
    expect(storedToken).toBe("a-good-token");
  });

  test("a network blip that recovers on retry signs the user in", async () => {
    storedToken = "a-good-token";
    me.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({
      id: "u1",
      name: "Root Buyer",
    });

    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(readProbe(getByTestId)).toBe("signed-in|true|false"), {
      timeout: 5000,
    });
    expect(storedToken).toBe("a-good-token");
  });
});

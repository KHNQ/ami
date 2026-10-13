import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SiteConfigProvider, useFeature } from "../../src/context/SiteConfigContext.jsx";
import { useAiEnabled } from "../../src/components/ai/useAiEnabled.js";
import { AiMount } from "../../src/components/ai/AiMount.jsx";

// The assistant's off switch, from the browser's side.
//
// The server decides (AI_ENABLED forces `ai_chat_enabled` false in
// /site-config); what has to hold here is that the client believes it, and
// that believing it means rendering nothing and FETCHING nothing -- a hidden
// launcher that still pulled 45kB of chat bundle on every page load would
// miss the point of switching the feature off.

vi.mock("../../src/lib/api.js", () => ({
  api: { siteConfig: vi.fn(async () => ({})) },
}));

const { api } = await import("../../src/lib/api.js");

function Probe() {
  return <span data-testid="state">{useAiEnabled() ? "on" : "off"}</span>;
}

beforeEach(() => {
  api.siteConfig.mockReset();
  api.siteConfig.mockResolvedValue({});
});

describe("the client reads the switch strictly", () => {
  test("off until the server actually says on", async () => {
    // The default has to be closed. Guessing "on" would flash a launcher on
    // the first paint of every page, on deployments that do not run the
    // feature at all.
    render(
      <SiteConfigProvider>
        <Probe />
      </SiteConfigProvider>
    );
    expect(screen.getByTestId("state")).toHaveTextContent("off");
  });

  test("a server that says false keeps it off", async () => {
    api.siteConfig.mockResolvedValue({ ai_chat_enabled: false, show_prices: true });
    render(
      <SiteConfigProvider initial={{ ai_chat_enabled: false }}>
        <Probe />
      </SiteConfigProvider>
    );
    await waitFor(() => expect(api.siteConfig).toHaveBeenCalled());
    expect(screen.getByTestId("state")).toHaveTextContent("off");
  });

  test("an older server that omits the key reads as off, not on", async () => {
    // `useFeature` treats a missing key as enabled, which is right for
    // features that ship on. This one ships off, so "no opinion" must not
    // turn it on -- the two hooks deliberately disagree.
    api.siteConfig.mockResolvedValue({ show_prices: true });
    render(
      <SiteConfigProvider>
        <Probe />
      </SiteConfigProvider>
    );
    await waitFor(() => expect(api.siteConfig).toHaveBeenCalled());
    expect(screen.getByTestId("state")).toHaveTextContent("off");
  });

  test("it does come on when the server says so", async () => {
    render(
      <SiteConfigProvider initial={{ ai_chat_enabled: true }}>
        <Probe />
      </SiteConfigProvider>
    );
    expect(screen.getByTestId("state")).toHaveTextContent("on");
  });

  test("other features keep their permissive default", async () => {
    // The strict read is for the assistant alone; nothing else changed.
    const Prices = () => <span data-testid="prices">{useFeature("show_prices") ? "on" : "off"}</span>;
    render(
      <SiteConfigProvider>
        <Prices />
      </SiteConfigProvider>
    );
    expect(screen.getByTestId("prices")).toHaveTextContent("on");
  });
});

describe("mounting it while it is off", () => {
  test("renders nothing and loads none of the feature", async () => {
    const { container } = render(
      <SiteConfigProvider initial={{ ai_chat_enabled: false }}>
        <AiMount />
      </SiteConfigProvider>
    );
    expect(container).toBeEmptyDOMElement();
    // No launcher, by any of the names it goes by.
    expect(screen.queryByRole("button", { name: /ask ai/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the mount imports nothing of the assistant at module level", async () => {
    // The real guarantee behind "no overhead": everything under AiMount is
    // behind lazy(), so with the feature off the chat chunk is never
    // requested. Asserted on the source rather than the DOM, because a
    // static import would be invisible here and very visible in the bundle.
    const src = (await import("../../src/components/ai/AiMount.jsx?raw")).default;
    const staticImports = [...src.matchAll(/^import .*from "(.*)";$/gm)].map((m) => m[1]);
    expect(staticImports).toEqual(["react", "./useAiEnabled.js"]);
    expect(src).toContain("lazy(() => import(");
  });
});

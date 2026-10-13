import { useEffect, useState } from "react";

// Progressive-web-app state: installability, update availability, and
// connectivity.
//
// Written against the platform APIs directly rather than vite-plugin-pwa's
// `virtual:pwa-register` module. That module only exists when the PWA plugin
// is in the build, and this project deliberately omits the plugin from the
// SSR build (see vite.config.js) -- importing the virtual module from shared
// component code would therefore break `vite build --ssr`. The native
// equivalent is a dozen lines and has no such coupling.

const INSTALL_DISMISSED_KEY = "trex-install-dismissed";

export function usePwa() {
  // The deferred `beforeinstallprompt` event. Chrome fires this once and
  // expects it to be stashed -- there is no way to ask for it again later,
  // so it is captured on mount and held until the visitor acts.
  const [installEvent, setInstallEvent] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    // Already running as an installed app: nothing to promote.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone) setInstalled(true);

    setOffline(!window.navigator.onLine);

    const onBeforeInstall = (e) => {
      // Chrome shows its own mini-infobar unless the event is prevented;
      // suppressing it lets the app choose the moment and the wording.
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Update detection. The service worker is registered with `autoUpdate`,
    // which installs a new worker in the background -- but the page the
    // visitor is looking at keeps running the old code until it reloads.
    // Without this they can sit on a stale build indefinitely, which for a
    // money surface is the failure mode that actually matters.
    let cleanupSw = () => {};
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (!reg) return;
          const onUpdateFound = () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              // `controller` being set means this is an update to an
              // already-controlled page, not the very first install --
              // prompting on first install would be meaningless.
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateReady(true);
              }
            });
          };
          reg.addEventListener("updatefound", onUpdateFound);
          cleanupSw = () => reg.removeEventListener("updatefound", onUpdateFound);
        })
        .catch(() => {
          /* no registration yet -- nothing to watch */
        });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      cleanupSw();
    };
  }, []);

  /** Was the install card dismissed before? Kept out of state so it is read fresh. */
  function installDismissed() {
    try {
      return window.localStorage?.getItem(INSTALL_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  }

  function dismissInstall() {
    try {
      window.localStorage?.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      /* private browsing -- it will simply be offered again next session */
    }
    setInstallEvent(null);
  }

  async function promptInstall() {
    if (!installEvent) return false;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    // The event is single-use: once prompted it cannot be reused, so it is
    // cleared regardless of what the visitor chose.
    setInstallEvent(null);
    if (outcome === "dismissed") dismissInstall();
    return outcome === "accepted";
  }

  return {
    canInstall: Boolean(installEvent) && !installed,
    installed,
    updateReady,
    offline,
    promptInstall,
    dismissInstall,
    installDismissed,
    reload: () => window.location.reload(),
  };
}

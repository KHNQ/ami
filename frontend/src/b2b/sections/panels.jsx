import { useState } from "react";
import { Link } from "react-router-dom";
import { Handshake } from "lucide-react";
import { Chip, DeepPanel, PillButton } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { api } from "../../lib/api.js";
import { useT } from "../../i18n/I18nProvider.jsx";

/* --- The owner network ------------------------------------------------- */

const NETWORK_STEPS = ["1", "2", "3"];

export function NetworkProgram() {
  const t = useT();
  return (
    <div
      id="network-program"
      className="scroll-mt-28 rounded-3xl border border-brand-green/25 bg-gradient-to-br from-brand-green/8 to-brand-blue/6 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 text-lg font-black text-ink">
            <Handshake className="h-4.5 w-4.5 text-brand-green" />
            {t("store.panel.network.title")}
          </h3>
          <p className="mt-1.5 max-w-2xl text-[13px] text-ink-2">
            {t("store.panel.network.lead")}
          </p>
        </div>
        <Chip tone="brand">{t("store.panel.network.chip")}</Chip>
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {NETWORK_STEPS.map((step) => (
          <div key={step} className="rounded-2xl border border-brand-green/25 bg-panel p-4">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-gradient text-[12px] font-black text-white">
              {step}
            </span>
            <b className="mt-2 block text-[13px] font-black text-ink">
              {t(`store.panel.network.step${step}Title`)}
            </b>
            <p className="mt-0.5 text-[12px] text-ink-2">
              {t(`store.panel.network.step${step}Body`)}
            </p>
          </div>
        ))}
      </div>

      {/* No form here on purpose. There is nothing to apply for: the position
          is created by the purchase itself, recorded by our team at the time
          of sale. A sign-up form would imply a separate scheme you can join
          without buying anything, which is exactly what this is not. */}
      <p className="mt-4 text-[12px] text-ink-3">{t("store.panel.network.rates")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <PillButton as={Link} to="/catalog">
          {t("store.panel.network.seeDevices")}
        </PillButton>
        <PillButton as={Link} to="/network" variant="white">
          {t("store.panel.network.yourNetwork")}
        </PillButton>
      </div>
    </div>
  );
}

/* --- Newsletter -------------------------------------------------------- */

export function Newsletter() {
  const t = useT();
  const { notify } = useStorefront();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function subscribe(e) {
    e.preventDefault();
    // Deliberately not a strict RFC pattern -- the browser's own type=email
    // validation runs first, and over-tight regexes reject real addresses.
    if (!email.includes("@") || !email.includes(".")) {
      notify(t("store.panel.news.badEmail"), "warning");
      return;
    }
    setBusy(true);
    try {
      // There is no separate subscriber list: a signup is a support request
      // the team reads, labelled so it is obvious what it is.
      await api.submitSupportRequest({
        name: "Newsletter subscriber",
        contact: email,
        message: "Newsletter signup -- please add this address to the mailing list.",
      });
    } catch {
      /* Same rationale as the proforma flow. */
    }
    setBusy(false);
    setEmail("");
    notify(t("store.panel.news.done"));
  }

  return (
    <DeepPanel className="flex flex-wrap items-center justify-between gap-5 p-6" glow="blue">
      <div>
        <b className="text-lg font-black text-white">{t("store.panel.news.title")}</b>
        <p className="mt-1 max-w-md text-[13px] text-white/60">{t("store.panel.news.lead")}</p>
      </div>
      <form onSubmit={subscribe} className="flex min-w-[280px] flex-1 gap-2 sm:max-w-md">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="doctor@clinic.ir"
          aria-label={t("store.panel.news.emailAria")}
          dir="ltr"
          className="min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-green"
        />
        <PillButton type="submit" disabled={busy}>
          {busy ? "…" : t("store.panel.news.cta")}
        </PillButton>
      </form>
    </DeepPanel>
  );
}

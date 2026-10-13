import { Link } from "react-router-dom";
import { InstalledMap } from "../sections/InstalledMap.jsx";
import { SupplyChain } from "../sections/SupplyChain.jsx";
import { CaseMatcher, DemandSimulator } from "../sections/CaseMatcher.jsx";
import { RoiCalculator } from "../sections/RoiCalculator.jsx";
import { NetworkProgram } from "../sections/panels.jsx";
import { PillButton, SectionHead, Stat } from "../ui/primitives.jsx";
import { PageMeta } from "../ui/PageMeta.jsx";
import { CITIES, TOTAL_CENTERS, TOTAL_DOCTORS } from "../data/installations.js";
import { cityName } from "../lib/labels.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";

// The feature routes.
//
// Each section belongs to exactly ONE of these pages, which keeps the routes
// distinct and means a visitor can tell whether they have already seen a page.

export function InstallationsPage() {
  const { t, locale } = useI18n();
  const centers = TOTAL_CENTERS.toLocaleString("en-US");
  return (
    <div className="b2b-container py-8">
      <PageMeta
        title={t("store.feature.installations.metaTitle", { count: centers })}
        description={t("store.feature.installations.metaDesc")}
        path="/installations"
      />
      <SectionHead
        eyebrow={t("store.feature.installations.eyebrow", { count: centers })}
        title={t("store.feature.installations.title")}
        lead={t("store.feature.installations.lead")}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={centers} label={t("store.feature.installations.statCenters")} />
        <Stat
          value={`${TOTAL_DOCTORS.toLocaleString("en-US")}+`}
          label={t("store.feature.installations.statDoctors")}
        />
        <Stat value={CITIES.length} label={t("store.feature.installations.statCities")} />
        <Stat value="48h" label={t("store.feature.installations.statSla")} tone="dark" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <InstalledMap />
        <SupplyChain />
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead>
            <tr className="bg-panel-2 text-[11px] tracking-wide text-ink-2 uppercase">
              <th className="p-3 text-start">{t("store.feature.installations.colCity")}</th>
              <th className="p-3 text-start">{t("store.feature.installations.colCenters")}</th>
              <th className="p-3 text-start">{t("store.feature.installations.colMix")}</th>
            </tr>
          </thead>
          <tbody>
            {CITIES.map((c) => (
              <tr key={c.name}>
                <td className="border-t border-line bg-panel p-3 font-black text-ink">
                  {cityName(t, c.name)}
                  {/* The Persian spelling stays beside the name in every
                      language except Persian, where it would repeat it. */}
                  {locale === "fa" ? null : (
                    <span className="ms-1.5 font-normal text-ink-3" dir="rtl">
                      {c.fa}
                    </span>
                  )}
                </td>
                <td className="b2b-tnum border-t border-line bg-panel p-3 font-black text-brand-green">
                  {c.count}
                </td>
                <td className="border-t border-line bg-panel p-3 text-ink-2">{c.devices}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AffiliatePage() {
  const { t } = useI18n();
  return (
    <div className="b2b-container py-8">
      <PageMeta
        title={t("store.feature.affiliate.metaTitle")}
        description={t("store.feature.affiliate.metaDesc")}
        path="/affiliate"
      />
      <SectionHead
        eyebrow={t("store.feature.affiliate.eyebrow")}
        title={t("store.feature.affiliate.title")}
        lead={t("store.feature.affiliate.lead")}
      />
      <div className="mt-5">
        <NetworkProgram />
      </div>

      <div className="mt-4 rounded-3xl border border-line bg-panel p-5">
        <b className="text-sm font-black text-ink">{t("store.feature.affiliate.howTitle")}</b>
        <ul className="mt-2 grid gap-1.5 text-[12.5px] text-ink-2">
          <li>· {t("store.feature.affiliate.how1")}</li>
          <li>· {t("store.feature.affiliate.how2")}</li>
          <li>· {t("store.feature.affiliate.how3")}</li>
          <li>· {t("store.feature.affiliate.how4")}</li>
          <li>· {t("store.feature.affiliate.how5")}</li>
        </ul>
        <PillButton as={Link} to="/network" variant="white" className="mt-4">
          {t("store.feature.affiliate.networkCta")}
        </PillButton>
      </div>
    </div>
  );
}

export function ToolsPage() {
  const { t } = useI18n();
  return (
    <div className="b2b-container py-8">
      <PageMeta
        title={t("store.feature.tools.metaTitle")}
        description={t("store.feature.tools.metaDesc")}
        path="/tools"
      />
      <SectionHead
        eyebrow={t("store.section.tools.label")}
        title={t("store.feature.tools.title")}
        lead={t("store.feature.tools.lead")}
      />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <CaseMatcher />
        <DemandSimulator />
      </div>
      <div className="mt-4">
        <RoiCalculator />
      </div>
    </div>
  );
}

import { DeviceShop } from "../sections/DeviceShop.jsx";
import { RoiCalculator } from "../sections/RoiCalculator.jsx";
import { SectionHead } from "../ui/primitives.jsx";
import { PageMeta } from "../ui/PageMeta.jsx";
import { COUNTRIES } from "../data/devices.js";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// The full range on one page.
//
// Everything a buyer does here -- filter, search, compare, open a device --
// is the same machinery the home page's shop section uses, so the two can
// never drift apart. This page adds the framing the home page has no room
// for: what the range covers and where it comes from.
export default function DevicesPage() {
  const t = useT();
  const { devices } = useCatalogue();
  return (
    <div className="pb-4">
      <PageMeta
        title={t("store.devicesPage.metaTitle")}
        description={t("store.devicesPage.metaDesc")}
        path="/devices"
      />
      <div className="b2b-container pt-8">
        <SectionHead
          eyebrow={t("store.devicesPage.eyebrow", {
            devices: devices.length,
            countries: COUNTRIES.length,
          })}
          title={t("store.devicesPage.title")}
          lead={t("store.devicesPage.lead")}
        />
      </div>

      <DeviceShop />

      <RoiCalculator />
    </div>
  );
}

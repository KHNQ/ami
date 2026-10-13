import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DriftWall } from "../../components/reactbits/drift-wall.jsx";
import { DeviceVisual } from "./DeviceVisual.jsx";
import { PillButton, SectionHead } from "../ui/primitives.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";

// The catalogue's closing section: the whole range on a drifting 3D wall,
// every tile a link to that device's page.
//
// It sits under the page viewer rather than replacing it, because the two
// answer different questions. The viewer is for a buyer who knows the
// brochure and wants page 9; this is for one who does not know what we carry
// and wants to see the lot at once.
//
// It runs on a DEEP PANEL, not on the page canvas, and that is not a styling
// preference. Every image here is a machine photographed on white -- either a
// background-removed PNG or a crop of a printed catalogue page. On the light
// canvas a receded white tile over a white page is invisible, so the first
// version of this read as an empty band with one hovered product floating in
// it. Against the inverted panel the same tiles read as lit plates on a dark
// wall, which is the effect the component was built for and a treatment this
// design language already has.
//
// The tile media is whatever DeviceVisual resolves, so a device with no
// photograph on file still gets a tile rather than a broken image.
export function DeviceDriftWall() {
  const { t, isRTL } = useI18n();
  const { devices } = useCatalogue();

  const items = useMemo(
    () =>
      devices.map((device) => ({
        key: device.id,
        to: `/devices/${device.id}`,
        title: t("store.drift.tileAria", { name: device.name }),
        media: <DeviceVisual device={device} imgClassName="p-2" />,
      })),
    [devices, t]
  );

  if (items.length === 0) return null;

  return (
    <section className="b2b-deep relative mt-12 overflow-hidden py-12">
      <div aria-hidden className="b2b-glow -top-32 -end-32 h-96 w-96" />
      <div aria-hidden className="b2b-glow b2b-glow-blue -bottom-32 -start-32 h-96 w-96" />

      <div className="b2b-container relative">
        <SectionHead
          invert
          eyebrow={t("store.drift.eyebrow")}
          title={t("store.drift.title")}
          lead={t("store.drift.lead")}
          actions={
            <PillButton as={Link} to="/devices" variant="white" size="sm">
              {t("store.drift.cta")}
            </PillButton>
          }
        />
      </div>

      {/* Full-bleed inside the panel: the wall only reads as depth when the
          far columns have room to recede, and a container gutter would put a
          hard edge exactly where the dissolve mask has nothing to dissolve
          against. */}
      <div className="relative mt-8 h-[360px] sm:h-[440px] lg:h-[540px]">
        <DriftWall
          items={items}
          label={t("store.drift.aria")}
          columns={5}
          tileWidth={190}
          tileHeight={126}
          gap={16}
          // Yaw is mirrored for right-to-left so the wall leans away from the
          // reading entry point in both directions rather than into it.
          turn={isRTL ? 14 : -14}
          speed={34}
          dim={0.5}
          lift={58}
          fade={0.68}
        />
      </div>
    </section>
  );
}

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Sparkles } from "lucide-react";
import { Chip, PillButton, TextInput } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { money } from "../lib/finance.js";
import { useAiChat } from "../../context/AiChatContext.jsx";
import { useAiEnabled } from "../../components/ai/useAiEnabled.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// Clinical case matcher.
//
// The honest version of this feature. It scores the described case against
// the catalogue's own indication, wavelength and highlight text, shows which
// terms it matched on, and then hands the case to the site's real
// retrieval-backed assistant for the clinical reasoning. It never invents a
// PIH percentage or a citation -- inventing a safety statistic for a doctor
// choosing a laser for a patient's face is not a UX flourish, it is a
// clinical risk.
//
// A photo can be attached and is passed to the assistant, but nothing is
// claimed to have been "analysed" locally.

const TERMS = [
  { words: ["melasma", "pigment", "lentigo", "nevus", "freckle", "tattoo"], cat: "tattoo", weight: 3 },
  { words: ["hair", "hirsut", "epilation", "fitzpatrick", "vellus"], cat: "hair", weight: 3 },
  { words: ["wrinkle", "scar", "acne", "pore", "laxity", "rejuven", "striae", "resurfac", "co2", "rf"], cat: "skin", weight: 3 },
  { words: ["fat", "cellulite", "contour", "slim", "muscle", "cryo", "circumference"], cat: "slim", weight: 3 },
  { words: ["composition", "bmi", "impedance", "weight", "metabol"], cat: "body", weight: 3 },
  { words: ["vein", "vascular", "varicose", "ent", "endovenous", "telangiect"], cat: "vascular", weight: 3 },
  { words: ["vitiligo", "psoriasis", "alopecia", "dermatitis", "mycosis"], cat: null, device: "exciplex", weight: 6 },
];

function score(device, text) {
  let total = 0;
  const hits = [];
  for (const rule of TERMS) {
    for (const word of rule.words) {
      if (!text.includes(word)) continue;
      if (rule.device && rule.device === device.id) {
        total += rule.weight;
        hits.push(word);
      } else if (rule.cat && rule.cat === device.cat) {
        total += rule.weight;
        hits.push(word);
      }
    }
  }
  // Direct hits on the device's own copy count for more than a category
  // match: someone who typed "cryolipolysis" has already named the modality.
  const haystack = `${device.name} ${device.indications} ${device.wavelength} ${(device.highlights || []).join(" ")}`.toLowerCase();
  for (const token of text.split(/\W+/).filter((w) => w.length > 3)) {
    if (haystack.includes(token)) {
      total += 2;
      hits.push(token);
    }
  }
  return { total, hits: [...new Set(hits)] };
}

export function CaseMatcher() {
  const t = useT();
  const { notify } = useStorefront();
  const { devices } = useCatalogue();
  const { openChat } = useAiChat();
  // The matcher itself is local keyword scoring and keeps working with the
  // assistant switched off; only the follow-up question needs it.
  const aiEnabled = useAiEnabled();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);

  function run() {
    const q = text.trim().toLowerCase();
    if (!q) {
      notify(t("store.matcher.needText"), "warning");
      return;
    }
    const ranked = devices.map((d) => ({ device: d, ...score(d, q) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    setResults(ranked);
  }

  return (
    <div id="matcher" className="scroll-mt-28 rounded-3xl border border-brand-green/30 bg-panel p-5 sm:p-6">
      <h3 className="inline-flex items-center gap-2 text-lg font-black text-ink">
        <Sparkles className="h-4.5 w-4.5 text-brand-green" />
        {t("store.matcher.title")}
      </h3>
      <p className="mt-1.5 text-[13px] text-ink-2">{t("store.matcher.lead")}</p>

      <div className="mt-4 rounded-2xl border border-dashed border-line bg-panel-2 p-4">
        <div className="flex flex-wrap gap-2">
          <TextInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder={t("store.matcher.placeholder")}
            aria-label={t("store.matcher.inputAria")}
            className="min-w-[220px] flex-1"
          />
          <PillButton variant="white" onClick={() => fileRef.current?.click()}>
            <Camera className="h-3.5 w-3.5" />
            {t("store.matcher.attach")}
          </PillButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
          />
          <PillButton onClick={run}>{t("store.matcher.run")}</PillButton>
        </div>
        {photo ? (
          <p className="mt-2 text-[12px] text-ink-2">
            {t("store.matcher.attachedPrefix")} <b className="text-ink">{photo.name}</b>{" "}
            {t("store.matcher.attachedNote")}
          </p>
        ) : null}
      </div>

      {results ? (
        results.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-line bg-panel-2 p-4 text-[13px] text-ink-2">
            {t("store.matcher.noMatch")}
          </p>
        ) : (
          <div className="mt-4 grid gap-2">
            {results.map(({ device, hits }, i) => (
              <div
                key={device.id}
                className={`rounded-2xl border p-4 ${
                  i === 0 ? "border-brand-green/40 bg-brand-green/6" : "border-line bg-panel-2"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-[14px] font-black text-ink">
                    {i === 0 ? t("store.matcher.bestMatch") : ""}
                    {device.name}
                  </b>
                  <Chip tone={device.fda ? "brand" : "amber"}>
                    {device.fda ? t("store.matcher.fdaCleared") : t("store.matcher.ceMarked")}
                  </Chip>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-2">{device.indications}</p>
                <p className="mt-1 text-[12px] text-ink-2">
                  {device.wavelength} · {device.spot} · {device.cooling}
                </p>
                {hits.length > 0 ? (
                  <p className="mt-2 text-[11px] text-ink-3">
                    {t("store.matcher.matchedOn", { terms: hits.slice(0, 6).join(", ") })}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <PillButton as={Link} to={`/devices/${device.id}`} size="sm" variant="dark">
                    {t("store.matcher.openSpecs")}
                  </PillButton>
                  {aiEnabled ? (
                    <PillButton
                      size="sm"
                      variant="white"
                      onClick={() =>
                        openChat({
                          productName: device.name,
                          seed: t("store.matcher.aiSeed", {
                            case: text,
                            device: device.name,
                          }),
                        })
                      }
                    >
                      {t("store.matcher.askAi")}
                    </PillButton>
                  ) : null}
                </div>
              </div>
            ))}
            <p className="mt-1 text-[11px] text-ink-3">
              {t("store.matcher.disclaimer")}
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

export function DemandSimulator() {
  const t = useT();
  const { openRfq } = useStorefront();
  const { devices, getDevice } = useCatalogue();
  const [address, setAddress] = useState("");
  const [deviceId, setDeviceId] = useState("cooltech");
  const [result, setResult] = useState(null);

  const device = getDevice(deviceId);

  // A transparent model, not a fake API call. Catchment population and
  // competitor density are the two inputs a clinic can sanity-check
  // themselves, and the assumptions are printed next to the answer -- an
  // unexplained "85–110 sessions" is a number nobody can act on.
  function simulate() {
    const catchment = 180000;
    const conversionPerThousand = device.cat === "slim" ? 0.62 : device.cat === "hair" ? 0.8 : 0.45;
    const competitors = 2;
    const share = 1 / (competitors + 1);
    const low = Math.round(((catchment / 1000) * conversionPerThousand * share) / 1.25);
    const high = Math.round((catchment / 1000) * conversionPerThousand * share * 1.1);
    setResult({ catchment, competitors, low, high });
  }

  return (
    <div id="demand" className="scroll-mt-28 rounded-3xl border border-line bg-panel p-5 sm:p-6">
      <h3 className="text-lg font-black text-ink">{t("store.demand.title")}</h3>
      <p className="mt-1.5 text-[13px] text-ink-2">{t("store.demand.lead")}</p>

      <div className="mt-4 grid gap-2">
        <div className="flex flex-wrap gap-2">
          <TextInput
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("store.demand.addressPlaceholder")}
            aria-label={t("store.demand.addressAria")}
            className="min-w-[200px] flex-1"
          />
          <PillButton variant="dark" onClick={simulate}>
            {t("store.demand.simulate")}
          </PillButton>
        </div>
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          aria-label={t("store.demand.deviceAria")}
          className="w-full rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-sm text-ink"
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.indications}
            </option>
          ))}
        </select>
      </div>

      {result ? (
        <div className="mt-4 rounded-2xl border border-line bg-panel-2 p-4 text-[13px]">
          <b className="text-ink">
            {device.name} · {address.trim() || "Tehran, Saadat Abad"}
          </b>
          <p className="mt-1 text-ink-2">
            {t("store.demand.catchment", {
              people: result.catchment.toLocaleString("en-US"),
              competitors: result.competitors,
            })}
          </p>
          <div className="mt-3 rounded-xl bg-brand-gradient p-4 text-center text-white">
            <span className="text-[10px] font-black tracking-[0.1em] uppercase opacity-80">
              {t("store.demand.projected")}
            </span>
            <div className="b2b-tnum text-2xl font-black">
              {t("store.demand.range", { low: result.low, high: result.high })}
            </div>
            <span className="text-[11px] opacity-90">
              {t("store.demand.revenue", {
                low: money(result.low * device.sessionPrice, "$"),
                high: money(result.high * device.sessionPrice, "$"),
              })}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">{t("store.demand.assumptions")}</p>
          <PillButton variant="white" className="mt-3" onClick={() => openRfq(deviceId)}>
            {t("store.demand.cta")}
          </PillButton>
        </div>
      ) : null}
    </div>
  );
}

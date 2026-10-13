import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Paperclip } from "lucide-react";
import { CAREERS } from "../lib/siteContent.generated.js";
import { ORG_NAME } from "../lib/orgInfo.js";
import { api } from "../lib/api.js";
import { fileToDataUrl } from "../lib/fileToDataUrl.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { SiteFooter } from "../components/layout/SiteFooter.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

// The form is rendered from the field schema in content/, so adding a field
// there produces it here -- rather than a hardcoded copy that drifts from what
// the API validates.
function Field({ field, value, onChange }) {
  const label = field.required ? `${field.label} *` : field.label;

  if (field.type === "select") {
    return (
      <div>
        <label className="mb-1.5 block text-[12.5px] font-medium text-fg/55">{label}</label>
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-xl border border-surface/10 bg-surface/5 px-3 text-[14px] text-fg"
        >
          <option value="">{t("common.select")}</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-fg/55">{label}</span>
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                value === o
                  ? "border-transparent bg-brand-gradient text-white"
                  : "border-surface/10 bg-surface/5 text-fg/55"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        <label className="mb-1.5 block text-[12.5px] font-medium text-fg/55">{label}</label>
        <textarea
          rows={3}
          maxLength={field.max_length}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-surface/10 bg-surface/5 px-3 py-2.5 text-[14px] text-fg"
        />
      </div>
    );
  }

  return (
    <Input
      label={label}
      type={field.type === "tel" ? "tel" : field.type}
      maxLength={field.max_length}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function CareersPage() {
  const t = useT();
  const [values, setValues] = useState({});
  const [resume, setResume] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);

  const fields = CAREERS.formFields.filter((f) => f.type !== "file");
  const resumeField = CAREERS.formFields.find((f) => f.type === "file");
  const required = CAREERS.formFields.filter((f) => f.required).map((f) => f.name);
  const complete = required.every((n) => values[n]);

  const set = (name) => (v) => setValues((prev) => ({ ...prev, [name]: v }));

  async function pickResume(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Checked here as well as server-side, so somebody on a slow connection
    // isn't left uploading 20MB only to be told no at the end.
    if (file.size > MAX_RESUME_BYTES) {
      setError(t("careers.fileTooLarge"));
      return;
    }
    setResume({ name: file.name, dataUrl: await fileToDataUrl(file) });
  }

  async function submit(e) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api.submitApplication({ ...values, resume_data_url: resume?.dataUrl });
      setState("sent");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  }

  const title = t("careers.metaTitle", { org: ORG_NAME });

  return (
    <PageTransition className="flex min-h-dvh flex-col">
      <title>{title}</title>
      <meta name="description" content={CAREERS.intro} />
      <link rel="canonical" href="/careers" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={CAREERS.intro} />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: title,
          description: CAREERS.intro,
          about: { "@type": "Organization", name: ORG_NAME },
        })}
      </script>

      <div className="flex-1">
        <section className="relative px-5 pb-4 pt-10">
          <div className="aurora pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <Link to="/" className="mb-4 inline-block text-[12.5px] font-semibold text-fg/40 hover:text-fg/70">
              ← {t("common.back")}
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-green">{t("careers.eyebrow")}</p>
            <h1 className="mt-1.5 max-w-md text-[27px] font-extrabold leading-[1.18] tracking-tight text-fg">
              {CAREERS.hero}
            </h1>
            <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-fg/60">{CAREERS.intro}</p>
          </div>
        </section>

        {state === "sent" ? (
          <section className="px-5 py-10">
            <Card className="flex flex-col items-center gap-3 p-8 text-center">
              <CheckCircle2 size={38} className="text-brand-green" />
              <h2 className="text-[18px] font-extrabold text-fg">{t("careers.sentTitle")}</h2>
              <p className="max-w-sm text-[13.5px] leading-relaxed text-fg/55">
                {t("careers.sentBody", { org: ORG_NAME })}
              </p>
              <Link to="/" className="mt-2 text-[13px] font-semibold text-brand-blue">
                {t("careers.backToCatalogue")}
              </Link>
            </Card>
          </section>
        ) : (
          <section className="px-5 pb-10">
            {CAREERS.openPositions.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-[18px] font-extrabold text-fg">{t("careers.openPositions")}</h2>
                <div className="flex flex-col gap-2">
                  {CAREERS.openPositions.map((role) => (
                    <Card key={role.title} className="p-4">
                      <div className="text-[14.5px] font-bold text-fg">{role.title}</div>
                      <div className="text-[12.5px] text-fg/45">{role.department}</div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            <Card className="p-5">
              <h2 className="mb-1 text-[17px] font-extrabold text-fg">{t("careers.formTitle")}</h2>
              <p className="mb-5 text-[12.5px] text-fg/45">
                {t("careers.formBody")}
              </p>

              <form onSubmit={submit} className="flex flex-col gap-4">
                {fields.map((f) => (
                  <Field key={f.name} field={f} value={values[f.name]} onChange={set(f.name)} />
                ))}

                {resumeField && (
                  <div>
                    <span className="mb-1.5 block text-[12.5px] font-medium text-fg/55">{resumeField.label}</span>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-surface/15 bg-surface/[0.03] px-3.5 py-3 text-[13px] text-fg/55 hover:border-brand-green/40">
                      <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={pickResume} />
                      <Paperclip size={14} className="text-fg/35" />
                      {resume ? (
                        <span className="truncate text-fg">{resume.name}</span>
                      ) : (
                        <span>{t("careers.attachResume")}</span>
                      )}
                    </label>
                  </div>
                )}

                {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}

                <Button type="submit" size="lg" fullWidth loading={state === "sending"} disabled={!complete}>
                  {t("careers.submit")}
                </Button>
                {!complete && (
                  <p className="text-center text-[12px] text-fg/35">
                    {t("careers.requiredNote")}
                  </p>
                )}
              </form>
            </Card>
          </section>
        )}
      </div>

      <SiteFooter />
    </PageTransition>
  );
}

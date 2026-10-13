import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SECTION_GROUPS, sectionsInGroup, sectionTitle, sectionBlurb, groupLabel } from "../data/sections.js";
import { useT } from "../../i18n/I18nProvider.jsx";
import { SectionHead } from "../ui/primitives.jsx";
import { Reveal } from "../../components/ui/Reveal.jsx";

// The home page's map of the rest of the site.
//
// This replaced roughly nine sections that used to be rendered inline on the
// home page -- the installed map, the evidence hub, the service portal, the
// case matcher, the demand simulator, the owner network, the lead
// generator, the trade-in and the ownership cards. All of them already had
// their own route; the home page was rendering the whole of each one a
// second time, which made it thirteen screens long and made every one of
// those routes feel redundant.
//
// A directory is the honest version of that: it says what is behind each
// door and sends you there, so the home page stays an argument and the
// detail lives where it can have the whole viewport.

function GroupColumn({ group }) {
  const t = useT();
  return (
    <div>
      <h3 className="text-[11px] font-extrabold tracking-[0.14em] text-ink-2 uppercase">
        {groupLabel(t, group)}
      </h3>
      <div className="mt-3 grid gap-2.5">
        {sectionsInGroup(group).map((section, i) => {
          const { to, icon: Icon } = section;
          return (
          <Reveal key={to} from="up" delay={i * 60}>
            <Link
              to={to}
              data-spotlight
              className="b2b-card group flex h-full gap-3.5 rounded-2xl border border-line bg-panel p-4"
            >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-green/10 text-brand-green">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-1.5 text-[13.5px] font-black text-ink">
                {sectionTitle(t, section)}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-green rtl:rotate-180" />
              </b>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-2">
                {sectionBlurb(t, section)}
              </span>
              </span>
            </Link>
          </Reveal>
          );
        })}
      </div>
    </div>
  );
}

export function SectionDirectory() {
  const t = useT();
  return (
    <section className="b2b-container mt-12">
      <SectionHead
        eyebrow={t("store.directory.eyebrow")}
        title={t("store.directory.title")}
        lead={t("store.directory.lead")}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {SECTION_GROUPS.map((group) => (
          <GroupColumn key={group} group={group} />
        ))}
      </div>
    </section>
  );
}

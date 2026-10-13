import { Link } from "react-router-dom";
import { ArrowRight, FileText, LifeBuoy, Package, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { api } from "../lib/api.js";
import { money, shortDate } from "../lib/format.js";
import { Chip, PillButton, SectionHead, Stat } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { ACCOUNT_SECTIONS } from "../b2b/data/sections.js";
import { AccountTour } from "../components/onboarding/AccountTour.jsx";
import { sectionLabel, sectionBlurb } from "../b2b/data/sections.js";
import { useT } from "../i18n/I18nProvider.jsx";

// The signed-in dashboard.
//
// This replaced the commerce app's old home screen, which was a second
// landing page: hero, story sections, partner map, logo slider and product
// feed -- i.e. the storefront again, in a different visual language, behind
// a login. The storefront owns `/` now, so what a signed-in customer needs
// here is the opposite of a landing page: what is outstanding, what they
// bought, and where to go next.
//
// Everything on it is real: quotes and agreements come from /sales/mine
// (the storefront's proforma and lease-proforma requests write there), orders
// from /purchases. Support is a one-way intake form, so there is nothing of
// the customer's to list -- the card just points at it.

// `new` and `contacted` are the states where the ball is in our court and
// the customer is waiting to hear back -- worth a warm chip. Everything
// terminal is neutral.
const QUOTE_TONE = {
  new: "amber",
  contacted: "blue",
  quoted: "brand",
  accepted: "brand",
  converted: "teal",
  declined: "neutral",
  expired: "neutral",
};

function Loading({ rows = 3, height = "h-16" }) {
  return (
    <div className="grid gap-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

function Empty({ children, to, cta }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel-2/50 px-5 py-8 text-center">
      <p className="text-[12.5px] text-ink-2">{children}</p>
      {to ? (
        <PillButton as={Link} to={to} variant="white" size="sm" className="mt-3">
          {cta}
        </PillButton>
      ) : null}
    </div>
  );
}

function Row({ to, title, meta, right, icon: Icon }) {
  return (
    <Link
      to={to}
      className="b2b-card flex items-center gap-3 rounded-2xl border border-line bg-panel p-3.5"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel-2 text-ink-2">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13px] font-black text-ink">{title}</b>
        <span className="block truncate text-[11.5px] text-ink-2">{meta}</span>
      </span>
      {right}
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-3 rtl:rotate-180" />
    </Link>
  );
}

export default function AccountHomePage() {
  const t = useT();
  const { user } = useAuth();
  const sales = useAsync(() => api.mySales(), []);
  const orders = useAsync(() => api.listMyPurchases({ limit: 5 }), []);
  const nodes = useAsync(() => api.listMyNodes(), []);

  const quotes = sales.data?.quotes ?? [];
  const agreements = sales.data?.agreements ?? [];
  // Anything still in play. A converted or expired quote is history and
  // belongs in the list further down, not in the "waiting on us" count.
  const openQuotes = quotes.filter((q) => ["new", "contacted", "quoted"].includes(q.status));

  return (
    <div className="b2b-container py-8">
      <PageMeta
        title={t("nav.yourAccount")}
        description={t("account.metaDesc")}
        path="/account"
        noIndex
      />

      <AccountTour />

      <SectionHead
        eyebrow={t("nav.yourAccount")}
        title={
          user?.name
            ? t("account.welcomeNamed", { name: user.name })
            : t("auth.welcomeBack")
        }
        lead={t("account.lead")}
        actions={
          <PillButton as={Link} to="/devices" size="sm">
            {t("account.browseDevices")}
          </PillButton>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat value={openQuotes.length} label={t("account.openQuotes")} />
        <Stat value={agreements.length} label={t("account.agreements")} />
        <Stat value={orders.data?.length ?? 0} label={t("account.orders")} tone="dark" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Quotes first: it is the only list where the customer is waiting
            on US, so burying it under order history would hide the one
            thing they came to check. */}
        <section className="rounded-3xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="inline-flex items-center gap-2 text-sm font-black text-ink">
              <FileText className="h-4 w-4 text-brand-green" />
              {t("account.quotesTitle")}
            </b>
            <Chip tone="neutral">{t("account.totalCount", { count: quotes.length })}</Chip>
          </div>

          <div className="mt-3">
            {sales.loading ? <Loading /> : null}
            {!sales.loading && quotes.length === 0 ? (
              <Empty to="/devices" cta={t("account.requestProforma")}>
                {t("account.noQuotes")}
              </Empty>
            ) : null}
            <div className="grid gap-2.5">
              {quotes.slice(0, 5).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-panel-2/50 p-3.5"
                >
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-black text-ink">{q.subject}</b>
                    <span className="b2b-tnum block truncate text-[11.5px] text-ink-2">
                      {t(`account.quoteKind.${q.kind}`)} · {q.reference} ·{" "}
                      {shortDate(q.created_at)}
                    </span>
                  </span>
                  <Chip tone={QUOTE_TONE[q.status] || "neutral"}>
                    {t(`account.quoteStatus.${q.status}`)}
                  </Chip>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="inline-flex items-center gap-2 text-sm font-black text-ink">
              <Package className="h-4 w-4 text-brand-blue" />
              {t("account.recentOrders")}
            </b>
            <PillButton as={Link} to="/orders" variant="white" size="xs">
              {t("account.allOrders")}
            </PillButton>
          </div>

          <div className="mt-3">
            {orders.loading ? <Loading /> : null}
            {!orders.loading && (orders.data ?? []).length === 0 ? (
              <Empty to="/devices" cta={t("account.seeWhatWeImport")}>
                {t("account.noOrders")}
              </Empty>
            ) : null}
            <div className="grid gap-2.5">
              {(orders.data ?? []).map((o) => (
                <Row
                  key={o.id}
                  to={`/orders/${o.id}`}
                  icon={Package}
                  title={o.product_name || t("account.orderFallback")}
                  meta={shortDate(o.created_at)}
                  right={
                    <span className="b2b-tnum shrink-0 text-[13px] font-black text-ink">
                      {money(o.y_at_sale_cents)}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="inline-flex items-center gap-2 text-sm font-black text-ink">
              <LifeBuoy className="h-4 w-4 text-brand-teal" />
              {t("account.support")}
            </b>
            <PillButton as={Link} to="/contact" variant="white" size="xs">
              {t("account.openSupport")}
            </PillButton>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-2">{t("account.supportBody")}</p>
        </section>

        <section className="rounded-3xl border border-line bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="inline-flex items-center gap-2 text-sm font-black text-ink">
              <Users className="h-4 w-4 text-brand-green" />
              {t("nav.network")}
            </b>
            <PillButton as={Link} to="/network" variant="white" size="xs">
              {t("account.openNetwork")}
            </PillButton>
          </div>
          <div className="mt-3">
            {nodes.loading ? <Loading rows={2} /> : null}
            {!nodes.loading && (nodes.data ?? []).length === 0 ? (
              <Empty to="/affiliate" cta={t("account.seeOwnerNetwork")}>
                {t("account.noSpace")}
              </Empty>
            ) : null}
            <div className="grid gap-2.5">
              {(nodes.data ?? []).slice(0, 4).map((n) => (
                <Row
                  key={n.id}
                  to={`/network/${n.id}`}
                  icon={Users}
                  title={
                    n.parent_node_id
                      ? t("account.joinedSpace")
                      : t("account.rootOfSpace")
                  }
                  meta={t("account.lifetime", {
                    amount: money(n.lifetime_volume_cents),
                  })}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-[11px] font-extrabold tracking-[0.14em] text-ink-2 uppercase">
          {t("account.screens")}
        </h2>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {ACCOUNT_SECTIONS.filter((s) => s.to !== "/account").map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.to}
                to={section.to}
                className="b2b-card rounded-2xl border border-line bg-panel p-4"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-green/10 text-brand-green">
                  <Icon className="h-4 w-4" />
                </span>
                <b className="mt-2.5 block text-[13px] font-black text-ink">
                  {sectionLabel(t, section)}
                </b>
                <span className="mt-0.5 block text-[11.5px] text-ink-2">
                  {sectionBlurb(t, section)}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

import { Children, cloneElement, isValidElement, useId } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Button } from "@/components/shadcn/button.jsx";
import { Badge } from "@/components/shadcn/badge.jsx";
import { Card, CardContent } from "@/components/shadcn/card.jsx";
import { Input } from "@/components/shadcn/input.jsx";
import { Label } from "@/components/shadcn/label.jsx";
import { Toggle } from "@/components/shadcn/toggle.jsx";
import { Tabs as ShadTabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs.jsx";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/select.jsx";

// The storefront's vocabulary, expressed in shadcn.
//
// Every component here now composes a shadcn primitive rather than
// hand-rolled markup. What survives is the *naming*: a `PillButton` is still
// a pill button, a `Chip` is still a chip, because forty call sites across
// the storefront speak that vocabulary and it describes this product better
// than `Button variant="outline" size="sm" className="rounded-full"` does at
// every one of them.
//
// The pill shape is the one thing consistently overridden. shadcn defaults
// to `rounded-md`; this storefront's entire control language is capsules,
// which is what makes it read as a medical catalogue rather than a
// dashboard.

/* --- Buttons ---------------------------------------------------------- */

// Storefront intent -> shadcn variant. `primary` and `accent` are not
// shadcn variants at all: they carry the brand gradient and the flat accent,
// which no default covers, so they are built on `variant="default"` and
// restyled.
const BTN_VARIANTS = {
  primary:
    "bg-brand-gradient text-white shadow-[0_8px_24px_-8px_color-mix(in_oklab,var(--color-brand-green)_60%,transparent)] hover:brightness-[1.06]",
  accent: "bg-brand-teal text-white hover:brightness-110",
  dark: "bg-ink text-canvas hover:brightness-125",
  white: "bg-panel text-ink border border-line hover:bg-panel-2",
  // For use on the deep panels, where a white button would blow out.
  ghost: "bg-white/8 text-white border border-white/22 hover:bg-white/14",
  whatsapp: "bg-[#25D366] text-white hover:brightness-105",
  warning: "bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200",
};

const BTN_PADDING = {
  xs: "px-3 text-[11px]",
  sm: "px-4 text-xs",
  md: "px-5 text-[13px]",
  lg: "px-6 text-sm",
};

const BTN_HEIGHT = { xs: "h-8", sm: "h-9", md: "h-11", lg: "h-12" };
const BTN_MIN_HEIGHT = { xs: "min-h-8", sm: "min-h-9", md: "min-h-11", lg: "min-h-12" };

export function PillButton({
  as: As,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  ...props
}) {
  const classes = cn(
    "cursor-pointer rounded-full font-extrabold tracking-tight",
    // A pill in a row must not wrap -- half a label on two lines inside a
    // rounded capsule looks broken. A full-width button spans its
    // container, and at 320px a long label has to wrap or it widens the
    // whole column and pushes the page sideways.
    fullWidth
      ? cn("h-auto w-full py-2 text-center whitespace-normal", BTN_MIN_HEIGHT[size])
      : cn("whitespace-nowrap", BTN_HEIGHT[size]),
    BTN_VARIANTS[variant],
    BTN_PADDING[size],
    className
  );

  // `asChild` is how shadcn composes with a router Link: the Button's
  // styling and behaviour are applied to the child element rather than
  // wrapping an <a> in a <button>, which is invalid and breaks keyboard
  // navigation.
  if (As) {
    return (
      <Button asChild size={null} variant="default" className={classes}>
        <As {...props}>{children}</As>
      </Button>
    );
  }

  return (
    <Button size={null} variant="default" className={classes} {...props}>
      {children}
    </Button>
  );
}

export function IconButton({ active = false, className, children, ...props }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="icon"
      className={cn(
        "h-11 w-11 shrink-0 cursor-pointer rounded-full",
        active ? "border-ink bg-ink text-canvas hover:bg-ink" : "bg-panel text-ink hover:bg-panel-2",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

/* --- Surfaces --------------------------------------------------------- */

export function Panel({ as: As = "div", className, children, ...props }) {
  // shadcn's Card brings its own vertical rhythm (`py-6`, a gap between
  // slots). This storefront lays panels out itself, so the padding is
  // reset and applied once, here.
  return (
    <Card asChild={As !== "div"} className={cn("gap-0 rounded-3xl border-line py-0", className)} {...props}>
      {As !== "div" ? (
        <As>
          <CardContent className="p-5 sm:p-6">{children}</CardContent>
        </As>
      ) : (
        <CardContent className="p-5 sm:p-6">{children}</CardContent>
      )}
    </Card>
  );
}

/**
 * An inverted panel. `glow` places the brand light source in a corner --
 * these sections are the page's emphatic moments and a flat dark rectangle
 * reads as a disabled state rather than as a highlight.
 */
export function DeepPanel({ className, glow = "green", children, ...props }) {
  return (
    <Card
      className={cn("b2b-deep relative gap-0 overflow-hidden rounded-3xl border-none py-0", className)}
      {...props}
    >
      {glow ? (
        <div
          aria-hidden
          className={cn("b2b-glow -top-24 -end-24 h-72 w-72", glow === "blue" && "b2b-glow-blue")}
        />
      ) : null}
      <CardContent className="relative p-5 sm:p-6">{children}</CardContent>
    </Card>
  );
}

/* --- Labels ----------------------------------------------------------- */

const CHIP_TONES = {
  neutral: "bg-panel-2 text-ink-2 border-line",
  brand: "bg-brand-green/10 text-brand-green border-brand-green/25",
  teal: "bg-brand-teal/10 text-brand-teal border-brand-teal/25",
  blue: "bg-brand-blue/10 text-brand-blue border-brand-blue/25",
  amber: "bg-amber-500/12 text-amber-700 border-amber-500/25 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-600 border-red-500/25 dark:text-red-300",
  dark: "bg-ink text-canvas border-transparent",
  onDeep: "bg-white/10 text-white border-white/20",
};

export function Chip({ tone = "neutral", className, children, ...props }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold whitespace-nowrap",
        CHIP_TONES[tone],
        className
      )}
      {...props}
    >
      {children}
    </Badge>
  );
}

/** The small all-caps kicker that opens most sections. */
export function Eyebrow({ tone = "brand", className, children }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-2 rounded-full px-3 py-1.5 text-[10px] font-extrabold tracking-[0.14em] uppercase",
        // shadcn's Badge is whitespace-nowrap, which is right for a status
        // pill and wrong here: these kickers are sentence-length ("Interactive
        // catalogue · 12 pages · Persian + English") and at 320px an
        // unwrappable one is 412px wide, which pushed the whole page
        // sideways. twMerge resolves the conflict in favour of this.
        "h-auto whitespace-normal",
        CHIP_TONES[tone],
        className
      )}
    >
      {children}
    </Badge>
  );
}

/**
 * Regulatory marks. These are the first thing a hospital buyer looks for, so
 * they are a dedicated component rather than three ad-hoc badges -- it keeps
 * the wording and the "not cleared" case consistent everywhere they appear.
 */
export function CertMarks({ device, size = "sm", className }) {
  const base = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {device.fda ? (
        <Badge className={cn("rounded-full border-transparent bg-brand-green font-extrabold text-white", base)}>
          FDA ✓
        </Badge>
      ) : null}
      {device.ce ? (
        <Badge className={cn("rounded-full border-transparent bg-brand-blue font-extrabold text-white", base)}>
          CE ✓
        </Badge>
      ) : null}
      {device.iso ? (
        <Badge className={cn("rounded-full border-transparent bg-ink font-extrabold text-canvas", base)}>
          ISO 13485 ✓
        </Badge>
      ) : null}
    </span>
  );
}

/* --- Section header --------------------------------------------------- */

export function SectionHead({ eyebrow, eyebrowTone, title, lead, actions, className, invert = false }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="max-w-3xl">
        {eyebrow ? <Eyebrow tone={eyebrowTone || (invert ? "onDeep" : "brand")}>{eyebrow}</Eyebrow> : null}
        {title ? (
          <h2
            className={cn(
              "mt-3 text-2xl font-black tracking-tight sm:text-[28px]",
              invert ? "text-white" : "text-ink"
            )}
          >
            {title}
          </h2>
        ) : null}
        {lead ? <p className={cn("mt-2 text-sm", invert ? "text-white/70" : "text-ink-2")}>{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* --- Back link -------------------------------------------------------- */

/**
 * The way back from a detail screen.
 *
 * The signed-in sub-pages (an order, a ticket, a node, a space tree) used to
 * get this from the phone-style TopBar, which also carried a title and a
 * theme toggle. Under the storefront header that bar was a second header
 * stacked on the real one, so what is left is the one part of it that a
 * sub-page genuinely needs: a way back that does not depend on the browser's.
 *
 * `to` is required rather than defaulting to `navigate(-1)`. History-based
 * back is wrong whenever the page was opened directly -- from a
 * notification, a bookmark or a page reload -- and sends the visitor out of
 * the site entirely.
 */
export function BackLink({ as: As = "a", to, children, className, ...props }) {
  return (
    <As
      {...(As === "a" ? { href: to } : { to })}
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-bold text-ink-2 hover:text-ink",
        className
      )}
      {...props}
    >
      <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
      {children}
    </As>
  );
}

/* --- Stat ------------------------------------------------------------- */

export function Stat({ value, label, tone = "panel", className }) {
  return (
    <Card
      className={cn(
        "gap-0 rounded-2xl py-0 text-center",
        tone === "dark" ? "border-transparent bg-ink text-canvas" : "border-line bg-panel",
        className
      )}
    >
      <CardContent className="p-4">
        <b className="block text-xl font-black sm:text-2xl">{value}</b>
        <span
          className={cn(
            "mt-0.5 block text-[10px] font-extrabold tracking-[0.08em] uppercase",
            tone === "dark" ? "text-canvas/60" : "text-ink-2"
          )}
        >
          {label}
        </span>
      </CardContent>
    </Card>
  );
}

/* --- Tabs ------------------------------------------------------------- */

/**
 * The segmented control used for filters and toolbars.
 *
 * Backed by shadcn Tabs, but rendered as a standalone TabsList: the panels
 * it switches between are laid out by the caller (a device page's four
 * sections are far too large to nest inside a tab list), so this is the
 * list half only, driven as a controlled component.
 */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    // The strip scrolls rather than wrapping or squashing. Four tab labels
    // ("Specs & price", "Evidence", "ROI", "Lease") are 322px wide, which
    // does not fit a 320px phone -- and a tab list that reflows onto two
    // lines stops reading as a segmented control.
    <ShadTabs
      value={value}
      onValueChange={onChange}
      className={cn("no-scrollbar max-w-full overflow-x-auto", className)}
    >
      <TabsList className="w-max rounded-full border border-line bg-panel-2 p-1">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="cursor-pointer rounded-full px-3.5 text-xs font-extrabold data-[state=active]:bg-panel data-[state=active]:text-ink"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadTabs>
  );
}

/* --- Form controls ---------------------------------------------------- */

export function Field({ label, hint, className, children }) {
  const id = useId();

  // The label has to be associated with the control, and shadcn's Label is a
  // sibling rather than a wrapper -- so the id is generated here and pushed
  // onto the child. The previous version wrapped the input in a <label>,
  // which associated them implicitly; dropping that without replacing it
  // left every field in the quote flows unlabelled for a screen reader (and
  // unfindable by getByLabel, which is how the regression surfaced).
  const child = Children.only(children);
  const control =
    isValidElement(child) && !child.props.id ? cloneElement(child, { id }) : child;
  const htmlFor = isValidElement(child) ? child.props.id || id : undefined;

  return (
    <div className={cn("block", className)}>
      {label ? (
        <Label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold text-ink">
          {label}
        </Label>
      ) : null}
      {control}
      {hint ? <span className="mt-1 block text-[11px] text-ink-2">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ className, ...props }) {
  return (
    <Input
      className={cn(
        "h-auto rounded-xl border-line bg-panel-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3",
        className
      )}
      {...props}
    />
  );
}

/**
 * A native <select>, deliberately.
 *
 * shadcn's Select is a Radix listbox -- better looking, and used below for
 * the storefront's own dropdowns. This one stays native because it is used
 * inside the quote flows, where the options are long device names on a
 * phone: the OS picker handles that far better than a floating panel, and
 * it is the control a doctor filling in a form on a handset expects.
 */
export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        "w-full cursor-pointer appearance-none rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 pe-8 text-sm text-ink",
        "focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:outline-none",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** The shadcn listbox, for the storefront's own (short, styled) dropdowns. */
export function PickerSelect({ value, onValueChange, placeholder, options, className, ...props }) {
  return (
    <ShadSelect value={value} onValueChange={onValueChange} {...props}>
      <SelectTrigger className={cn("rounded-xl border-line bg-panel-2 text-sm", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

/** Filter pills — category, country, and the compare tray's chips. */
export function FilterPill({ active = false, tone = "dark", className, children, ...props }) {
  return (
    <Toggle
      pressed={active}
      size="sm"
      className={cn(
        "h-auto cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-bold whitespace-nowrap",
        active
          ? tone === "teal"
            ? "border-brand-teal bg-brand-teal text-white data-[state=on]:bg-brand-teal data-[state=on]:text-white"
            : "border-ink bg-ink text-canvas data-[state=on]:bg-ink data-[state=on]:text-canvas"
          : "border-line bg-panel text-ink-2 hover:text-ink",
        className
      )}
      {...props}
    >
      {children}
    </Toggle>
  );
}

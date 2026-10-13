import { useState } from "react";
import { FileText, MessageCircle, Phone, Sparkles } from "lucide-react";
import {
  FamilyDrawerRoot,
  FamilyDrawerTrigger,
  FamilyDrawerPortal,
  FamilyDrawerOverlay,
  FamilyDrawerContent,
  FamilyDrawerAnimatedWrapper,
  FamilyDrawerAnimatedContent,
  FamilyDrawerClose,
  FamilyDrawerHeader,
  FamilyDrawerButton,
  FamilyDrawerSecondaryButton,
  FamilyDrawerViewContent,
  useFamilyDrawer,
} from "../../components/cult/family-drawer.jsx";
import { ORG_CONTACT } from "../../lib/orgInfo.js";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useAiChat } from "../../context/AiChatContext.jsx";
import { useAiEnabled } from "../../components/ai/useAiEnabled.js";
import { whatsappGeneral } from "../lib/whatsapp.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The phone action bar's expanded view, as a Family-style drawer.
//
// The bar itself only ever had room for three squashed buttons. cult-ui's
// family-drawer is built for exactly this: a small sheet whose height
// ANIMATES between views, so "how do you want to get in touch" and the answer
// live in the same surface instead of stacking modals on a 390px screen.
//
// Views are components, not markup, because that is the contract
// FamilyDrawerViewContent expects -- it looks the current view up by key.

function MenuView() {
  const t = useT();
  const { setView, setIsOpen } = useFamilyDrawer();
  const { openRfq } = useStorefront();
  const { openChat } = useAiChat();
  const aiEnabled = useAiEnabled();

  return (
    <div>
      <FamilyDrawerHeader
        icon={
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-gradient text-white">
            <Sparkles className="h-5 w-5" />
          </span>
        }
        title={t("store.actions.title")}
        description={t("store.actions.desc")}
      />
      <div className="mt-6 grid gap-2.5">
        <FamilyDrawerButton
          className="bg-panel-2! text-ink!"
          onClick={() => {
            setIsOpen(false);
            openRfq();
          }}
        >
          <FileText className="h-5 w-5 text-brand-green" />
          {t("store.actions.proforma")}
        </FamilyDrawerButton>
        {aiEnabled ? (
          <FamilyDrawerButton
            className="bg-panel-2! text-ink!"
            onClick={() => {
              setIsOpen(false);
              openChat();
            }}
          >
            <Sparkles className="h-5 w-5 text-brand-teal" />
            {t("store.actions.askAi")}
          </FamilyDrawerButton>
        ) : null}
        <FamilyDrawerButton className="bg-panel-2! text-ink!" onClick={() => setView("contact")}>
          <Phone className="h-5 w-5 text-ink-2" />
          {t("store.actions.talk")}
        </FamilyDrawerButton>
      </div>
    </div>
  );
}

function ContactView() {
  const t = useT();
  const { setView } = useFamilyDrawer();
  const phone = ORG_CONTACT.phones?.[0];

  return (
    <div>
      <FamilyDrawerHeader
        icon={
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-panel-2 text-ink">
            <Phone className="h-5 w-5" />
          </span>
        }
        title={t("store.actions.talk")}
        description={t("store.actions.hours")}
      />
      <div className="mt-6 grid gap-2.5">
        {phone ? (
          <FamilyDrawerButton className="bg-panel-2! text-ink!" asChild>
            <a href={`tel:${String(phone).replace(/[^\d+]/g, "")}`}>
              <Phone className="h-5 w-5 text-brand-green" />
              {phone}
            </a>
          </FamilyDrawerButton>
        ) : null}
        <FamilyDrawerButton className="bg-[#25D366]! text-white!" asChild>
          <a
            href={whatsappGeneral(t("store.bar.whatsappMessage"))}
            target="_blank"
            rel="noreferrer noopener"
          >
            <MessageCircle className="h-5 w-5" />
            {t("store.actions.whatsapp")}
          </a>
        </FamilyDrawerButton>
        <FamilyDrawerSecondaryButton className="text-ink-2!" onClick={() => setView("default")}>
          {t("common.back")}
        </FamilyDrawerSecondaryButton>
      </div>
    </div>
  );
}

const VIEWS = { default: MenuView, contact: ContactView };

export function ActionsDrawer({ children, className }) {
  const [open, setOpen] = useState(false);

  return (
    <FamilyDrawerRoot open={open} onOpenChange={setOpen} views={VIEWS}>
      <FamilyDrawerTrigger asChild className={className}>
        {children}
      </FamilyDrawerTrigger>
      <FamilyDrawerPortal>
        <FamilyDrawerOverlay />
        <FamilyDrawerContent className="bg-panel!">
          <FamilyDrawerAnimatedWrapper>
            <FamilyDrawerAnimatedContent>
              <FamilyDrawerClose />
              <FamilyDrawerViewContent />
            </FamilyDrawerAnimatedContent>
          </FamilyDrawerAnimatedWrapper>
        </FamilyDrawerContent>
      </FamilyDrawerPortal>
    </FamilyDrawerRoot>
  );
}

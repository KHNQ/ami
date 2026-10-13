"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import { Slot } from "@radix-ui/react-slot";
import clsx from "clsx";
import { AnimatePresence, m } from "framer-motion";
import useMeasure from "react-use-measure";
import { Drawer } from "vaul";
import { useT } from "../../i18n/I18nProvider.jsx";

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Context
// ============================================================================

const FamilyDrawerContext = createContext(undefined);
function useFamilyDrawer() {
  const context = useContext(FamilyDrawerContext);
  if (!context) {
    throw new Error("FamilyDrawer components must be used within FamilyDrawerRoot");
  }
  return context;
}

// ============================================================================
// Root Component
// ============================================================================

function FamilyDrawerRoot({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  defaultView = "default",
  onViewChange,
  views: customViews
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [view, setView] = useState(defaultView);
  const [elementRef, bounds] = useMeasure();
  const previousHeightRef = useRef(0);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;
  const opacityDuration = useMemo(() => {
    const currentHeight = bounds.height;
    const previousHeight = previousHeightRef.current;
    const MIN_DURATION = 0.15;
    const MAX_DURATION = 0.27;
    if (!previousHeightRef.current) {
      previousHeightRef.current = currentHeight;
      return MIN_DURATION;
    }
    const heightDifference = Math.abs(currentHeight - previousHeight);
    previousHeightRef.current = currentHeight;
    const duration = Math.min(Math.max(heightDifference / 500, MIN_DURATION), MAX_DURATION);
    return duration;
  }, [bounds.height]);
  const handleViewChange = newView => {
    setView(newView);
    onViewChange?.(newView);
  };

  // Use custom views if provided, otherwise pass undefined
  const views = customViews && Object.keys(customViews).length > 0 ? customViews : undefined;
  const contextValue = {
    isOpen,
    // Added here: the published context exposes `isOpen` but no setter, so a
    // view could never close the drawer after the action it triggered -- and
    // every one of ours opens something else (a dialog, the assistant), which
    // must not appear underneath a sheet that is still up.
    setIsOpen,
    view,
    setView: handleViewChange,
    opacityDuration,
    elementRef,
    bounds,
    views
  };
  return <FamilyDrawerContext.Provider value={contextValue}>
      <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
        {children}
      </Drawer.Root>
    </FamilyDrawerContext.Provider>;
}

// ============================================================================
// Trigger Component
// ============================================================================

function FamilyDrawerTrigger({
  children,
  asChild = false,
  className
}) {
  if (asChild) {
    return <Drawer.Trigger asChild>
        <Slot>{children}</Slot>
      </Drawer.Trigger>;
  }
  return <Drawer.Trigger asChild>
      <button className={clsx("fixed top-1/2 left-1/2 antialiased -translate-y-1/2 -translate-x-1/2 h-[44px] rounded-full border bg-background px-4 py-2 font-medium text-foreground transition-colors hover:bg-accent focus-visible:shadow-focus-ring-button md:font-medium cursor-pointer", className)} type="button">
        {children}
      </button>
    </Drawer.Trigger>;
}

// ============================================================================
// Portal Component
// ============================================================================

function FamilyDrawerPortal({
  children
}) {
  return <Drawer.Portal>{children}</Drawer.Portal>;
}

// ============================================================================
// Overlay Component
// ============================================================================

function FamilyDrawerOverlay({
  className,
  onClick
}) {
  const {
    setView
  } = useFamilyDrawer();
  return <Drawer.Overlay className={clsx("fixed inset-0 z-[70] bg-black/30", className)} onClick={onClick || (() => setView("default"))} />;
}

// ============================================================================
// Content Component
// ============================================================================

function FamilyDrawerContent({
  children,
  className,
  asChild = false
}) {
  const {
    bounds
  } = useFamilyDrawer();
  const content = <m.div animate={{
    height: bounds.height,
    transition: {
      duration: 0.27,
      ease: [0.25, 1, 0.5, 1]
    }
  }}>
      {children}
    </m.div>;
  if (asChild) {
    return <Drawer.Content asChild className={clsx("fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-[361px] overflow-hidden rounded-[36px] bg-background outline-none md:mx-auto md:w-full", className)}>
        <Slot>{content}</Slot>
      </Drawer.Content>;
  }
  return <Drawer.Content asChild className={clsx("fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-[361px] overflow-hidden rounded-[36px] bg-background outline-none md:mx-auto md:w-full", className)}>
      {content}
    </Drawer.Content>;
}

// ============================================================================
// Animated Wrapper Component
// ============================================================================

function FamilyDrawerAnimatedWrapper({
  children,
  className
}) {
  const {
    elementRef
  } = useFamilyDrawer();
  return <div ref={elementRef} className={clsx("px-6 pb-6 pt-2.5 antialiased", className)}>
      {children}
    </div>;
}

// ============================================================================
// Animated Content Component
// ============================================================================

function FamilyDrawerAnimatedContent({
  children
}) {
  const {
    view,
    opacityDuration
  } = useFamilyDrawer();
  return <AnimatePresence initial={false} mode="popLayout" custom={view}>
      <m.div initial={{
      opacity: 0,
      scale: 0.96
    }} animate={{
      opacity: 1,
      scale: 1,
      y: 0
    }} exit={{
      opacity: 0,
      scale: 0.96
    }} key={view} transition={{
      duration: opacityDuration,
      ease: [0.26, 0.08, 0.25, 1]
    }}>
        {children}
      </m.div>
    </AnimatePresence>;
}

// ============================================================================
// Close Component
// ============================================================================

function FamilyDrawerClose({
  children,
  asChild = false,
  className
}) {
  const defaultClose = <button data-vaul-no-drag="" className={clsx("absolute right-8 top-7 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform focus:scale-95 focus-visible:shadow-focus-ring-button active:scale-75 cursor-pointer", className)} type="button">
      {children || <CloseIcon />}
    </button>;
  if (asChild) {
    return <Drawer.Close asChild>
        <Slot>{defaultClose}</Slot>
      </Drawer.Close>;
  }
  return <Drawer.Close asChild>{defaultClose}</Drawer.Close>;
}

// ============================================================================
// Helper Components
// ============================================================================

function FamilyDrawerHeader({
  icon,
  title,
  description,
  className
}) {
  return <header className={clsx("mt-[21px]", className)}>
      {icon}
      <h2 className="mt-2.5 text-[22px] font-semibold text-foreground md:font-medium">
        {title}
      </h2>
      <p className="mt-3 text-[17px] font-medium leading-[24px] text-muted-foreground md:font-normal">
        {description}
      </p>
    </header>;
}
function FamilyDrawerButton({
  children,
  onClick,
  className,
  asChild = false
}) {
  const button = <button data-vaul-no-drag="" className={clsx("flex h-12 w-full items-center gap-[15px] rounded-[16px] bg-muted px-4 text-[17px] font-semibold text-foreground transition-transform focus:scale-95 focus-visible:shadow-focus-ring-button active:scale-95 md:font-medium cursor-pointer", className)} onClick={onClick} type="button">
      {children}
    </button>;
  if (asChild) {
    return <Slot>{button}</Slot>;
  }
  return button;
}
function FamilyDrawerSecondaryButton({
  children,
  onClick,
  className,
  asChild = false
}) {
  const button = <button data-vaul-no-drag="" type="button" className={clsx("flex h-12 w-full items-center justify-center gap-[15px] rounded-full text-center text-[19px] font-semibold transition-transform focus:scale-95 focus-visible:shadow-focus-ring-button active:scale-95 md:font-medium cursor-pointer", className)} onClick={onClick}>
      {children}
    </button>;
  if (asChild) {
    return <Slot>{button}</Slot>;
  }
  return button;
}

// ============================================================================
// View Content Renderer
// ============================================================================

function FamilyDrawerViewContent({
  views: propViews
} = {}) {
  const {
    view,
    views: contextViews
  } = useFamilyDrawer();

  // Use prop views first, then context views
  const views = propViews || contextViews;
  if (!views) {
    throw new Error("FamilyDrawerViewContent requires views to be provided via props or FamilyDrawerRoot");
  }
  const ViewComponent = views[view];
  if (!ViewComponent) {
    // Fallback to default view if view not found
    const DefaultComponent = views.default;
    return DefaultComponent ? <DefaultComponent /> : null;
  }
  return <ViewComponent />;
}

// ============================================================================
// Icons
// ============================================================================

function CloseIcon() {
  const t = useT();
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>{t("common.close")}</title>
      <path d="M10.4854 1.99998L2.00007 10.4853" stroke="#999999" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.4854 10.4844L2.00007 1.99908" stroke="#999999" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}

// ============================================================================
// Exports
// ============================================================================

export { FamilyDrawerRoot, FamilyDrawerTrigger, FamilyDrawerPortal, FamilyDrawerOverlay, FamilyDrawerContent, FamilyDrawerAnimatedWrapper, FamilyDrawerAnimatedContent, FamilyDrawerClose, FamilyDrawerHeader, FamilyDrawerButton, FamilyDrawerSecondaryButton, FamilyDrawerViewContent, useFamilyDrawer };
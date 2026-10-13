"use client";

import React, { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { AnimatePresence, m, MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils";
import { useT } from "../../i18n/I18nProvider.jsx";
const TRANSITION = {
  type: "spring",
  bounce: 0.05,
  duration: 0.3
};
function useClickOutside(ref, handler) {
  useEffect(() => {
    const handleClickOutside = event => {
      if (ref.current && !ref.current.contains(event.target)) {
        handler();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, handler]);
}
const PopoverContext = createContext(undefined);
function usePopover() {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error("usePopover must be used within a PopoverProvider");
  }
  return context;
}
function usePopoverLogic() {
  const uniqueId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const openPopover = () => setIsOpen(true);
  const closePopover = () => {
    setIsOpen(false);
    setNote("");
  };
  return {
    isOpen,
    openPopover,
    closePopover,
    uniqueId,
    note,
    setNote
  };
}
export function PopoverRoot({
  children,
  className
}) {
  const popoverLogic = usePopoverLogic();
  return <PopoverContext.Provider value={popoverLogic}>
      <MotionConfig transition={TRANSITION}>
        <div className={cn("relative flex items-center justify-center isolate", className)}>
          {children}
        </div>
      </MotionConfig>
    </PopoverContext.Provider>;
}
export function PopoverTrigger({
  children,
  className
}) {
  const {
    openPopover,
    uniqueId
  } = usePopover();
  return <m.button key="button" layoutId={`popover-${uniqueId}`} className={cn("flex h-9 items-center border border-zinc-950/10 bg-white px-3 text-zinc-950 dark:border-zinc-50/10 dark:bg-zinc-700 dark:text-zinc-50", className)} style={{
    borderRadius: 8
  }} onClick={openPopover}>
      <m.span layoutId={`popover-label-${uniqueId}`} className="text-sm">
        {children}
      </m.span>
    </m.button>;
}
export function PopoverContent({
  children,
  className
}) {
  const {
    isOpen,
    closePopover,
    uniqueId
  } = usePopover();
  const formContainerRef = useRef(null);
  useClickOutside(formContainerRef, closePopover);
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "Escape") {
        closePopover();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePopover]);
  return <AnimatePresence>
      {isOpen && <m.div ref={formContainerRef} layoutId={`popover-${uniqueId}`} className={cn("absolute h-[200px] w-[364px] overflow-hidden border border-zinc-950/10 bg-white outline-none dark:bg-zinc-700 z-50",
    // Changed z-90 to z-50
    className)} style={{
      borderRadius: 12,
      top: "auto",
      // Remove any top positioning
      left: "auto",
      // Remove any left positioning
      transform: "none" // Remove any transform
    }}>
          {children}
        </m.div>}
    </AnimatePresence>;
}
export function PopoverForm({
  children,
  onSubmit,
  className
}) {
  const {
    note,
    closePopover
  } = usePopover();
  const handleSubmit = e => {
    e.preventDefault();
    onSubmit?.(note);
    closePopover();
  };
  return <form className={cn("flex h-full flex-col", className)} onSubmit={handleSubmit}>
      {children}
    </form>;
}
export function PopoverLabel({
  children,
  className
}) {
  const {
    uniqueId,
    note
  } = usePopover();
  return <m.span layoutId={`popover-label-${uniqueId}`} aria-hidden="true" style={{
    opacity: note ? 0 : 1
  }} className={cn("absolute start-4 top-3 select-none text-sm text-zinc-500 dark:text-zinc-400", className)}>
      {children}
    </m.span>;
}
export function PopoverTextarea({
  className
}) {
  const {
    note,
    setNote
  } = usePopover();
  return <textarea className={cn("h-full w-full resize-none rounded-md bg-transparent px-4 py-3 text-sm outline-none", className)} autoFocus value={note} onChange={e => setNote(e.target.value)} />;
}
export function PopoverFooter({
  children,
  className
}) {
  return <div key="close" className={cn("flex justify-between px-4 py-3", className)}>
      {children}
    </div>;
}
export function PopoverCloseButton({
  className
}) {
  const t = useT();
  const {
    closePopover
  } = usePopover();
  return <button type="button" className={cn("flex items-center", className)} onClick={closePopover} aria-label={t("popover.close")}>
      <X size={16} className="text-zinc-900 dark:text-zinc-100" />
    </button>;
}
export function PopoverSubmitButton({
  className
}) {
  const t = useT();
  return <button className={cn("relative ms-1 flex h-8 shrink-0 scale-100 select-none appearance-none items-center justify-center rounded-lg border border-zinc-950/10 bg-transparent px-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:ring-2 active:scale-[0.98] dark:border-zinc-50/10 dark:text-zinc-50 dark:hover:bg-zinc-800", className)} type="submit" aria-label={t("popover.submit")}>
      Submit
    </button>;
}
export function PopoverHeader({
  children,
  className
}) {
  return <div className={cn("px-4 py-2 font-semibold text-zinc-900 dark:text-zinc-100", className)}>
      {children}
    </div>;
}
export function PopoverBody({
  children,
  className
}) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

// New component: PopoverButton
export function PopoverButton({
  children,
  onClick,
  className
}) {
  return <button className={cn("flex w-full items-center gap-2 rounded-md px-4 py-2 text-start text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700", className)} onClick={onClick}>
      {children}
    </button>;
}
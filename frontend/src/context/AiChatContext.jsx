import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Who owns "is the assistant open".
//
// It used to live inside the floating button, which meant only that button
// could open it. Now the bottom navigation is the primary way in -- and the
// product page still wants its own scoped entry point -- so the state has to
// sit above both. Anything that can reach this context can open the
// assistant, and there is still exactly one overlay mounted.
const AiChatContext = createContext({
  open: false,
  openChat: () => {},
  closeChat: () => {},
  scope: {},
});

export function AiChatProvider({ children }) {
  const [open, setOpen] = useState(false);
  // What the assistant should consider itself scoped to when it opens --
  // currently the product being viewed. Set by the opener rather than read
  // from the URL, so a button can scope the conversation to something the
  // route alone would not reveal.
  const [scope, setScope] = useState({});

  const openChat = useCallback((next = {}) => {
    setScope(next);
    setOpen(true);
  }, []);

  const closeChat = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ open, openChat, closeChat, scope }), [open, openChat, closeChat, scope]);

  return <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>;
}

export function useAiChat() {
  return useContext(AiChatContext);
}

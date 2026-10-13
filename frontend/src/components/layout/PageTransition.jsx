import { m } from "framer-motion";
import { useLocation } from "react-router-dom";

// The fade-and-rise applied when moving between pages.
//
// Deliberately skipped for the *first* page of a session.
//
// This component used to animate unconditionally from `opacity: 0`, which
// meant every server-rendered page shipped its entire body at opacity 0 and
// only became visible once framer-motion had hydrated. For the routes that
// are server-rendered specifically to be indexed (`/`, `/products/:id`,
// `/c/:slug`, `/partners`, `/our-story`, `/careers`) that is the one thing
// SSR was supposed to prevent: a crawler that doesn't execute JS, or a
// visitor whose bundle fails, gets a completely invisible page.
//
// React Router labels the initial history entry `"default"` and generates a
// key for every subsequent one, on the server as well as the client -- so the
// first render matches on both sides and hydration stays clean, while real
// navigations still animate.
export function PageTransition({ children, className }) {
  const { key } = useLocation();
  const isFirstPage = key === "default";

  return (
    <m.div
      initial={isFirstPage ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </m.div>
  );
}

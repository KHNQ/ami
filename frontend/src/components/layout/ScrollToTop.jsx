import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Resets the scroll position on navigation.
//
// Without this, react-router leaves the window scroll exactly where it was.
// Opening a product from halfway down the home page's product grid therefore
// dropped you at that same Y offset on a shorter page -- which lands near the
// bottom, so the device photo and price were above the fold you arrived at
// and the page looked like it had opened backwards.
//
// `<ScrollRestoration />` from react-router-dom is the built-in answer, but it
// only works under a data router (`createBrowserRouter`); this app uses
// `<BrowserRouter>`, so the equivalent is done by hand here.
//
// POP navigations (back/forward) are deliberately left alone: the browser
// restores the previous offset itself, and returning someone to the top of a
// list they had scrolled deep into is the more annoying failure.
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP") return;
    // `instant` rather than smooth: this is a page change, not a movement
    // within a page, and animating it means the new page visibly slides past
    // its own content on arrival.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, navigationType]);

  return null;
}

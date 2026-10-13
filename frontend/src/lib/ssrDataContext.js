import { createContext } from "react";

// Populated only for the two SSR'd routes (`/` and `/products/:id`,
// see entry-server.jsx / server.js). Every other route never provides
// this context, so `useContext(SSRDataContext)` is simply `null` there --
// HomePage/ProductDetailPage fall back to their normal useAsync fetch in
// that case, same as before SSR existed.
export const SSRDataContext = createContext(null);

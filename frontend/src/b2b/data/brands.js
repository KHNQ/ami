// The manufacturers Ashkan represents, grouped by country of origin.
//
// `logo` points at the partner marks already in public/partners (they ship
// with the site and are the real vendor logos), and is null where a mark
// isn't on file -- call sites fall back to the flag + wordmark rather than
// rendering a broken image.

export const SUPPLY_COUNTRIES = [
  {
    country: "South Korea",
    flag: "🇰🇷",
    brands: ["InBody", "Classys", "IDS", "Eunsung"],
  },
  { country: "Spain", flag: "🇪🇸", brands: ["Cocoon Medical", "Sinclair"] },
  { country: "Germany", flag: "🇩🇪", brands: ["A.R.C Laser", "WOLF"] },
  { country: "Italy", flag: "🇮🇹", brands: ["Novaclinical 4Plus"] },
  { country: "France", flag: "🇫🇷", brands: ["Clarteis", "Exciplex"] },
  { country: "Slovenia", flag: "🇸🇮", brands: ["Iskra Medical", "TESLA"] },
  { country: "USA", flag: "🇺🇸", brands: ["Erchonia"] },
  { country: "Iran", flag: "🇮🇷", brands: ["Tehran hub — central stock"] },
];

export const BRAND_CARDS = [
  { name: "InBody", flag: "🇰🇷", note: "Body analysis", logo: "/partners/inbody.png" },
  { name: "Cocoon Medical", flag: "🇪🇸", note: "Cooltech", logo: "/partners/cocoon-medical.png" },
  { name: "Sinclair", flag: "🇪🇸", note: "Primelase · Elysion", logo: "/partners/sinclair.svg" },
  { name: "A.R.C Laser", flag: "🇩🇪", note: "WOLF 1470", logo: "/partners/arc-laser.png" },
  { name: "Novaclinical", flag: "🇮🇹", note: "4Plus DQRF", logo: "/partners/novaclinical.svg" },
  { name: "Clarteis", flag: "🇫🇷", note: "Exciplex 308", logo: "/partners/clarteis.svg" },
  { name: "Iskra Medical", flag: "🇸🇮", note: "TESLA Former", logo: "/partners/iskra-medical.png" },
  { name: "IDS", flag: "🇰🇷", note: "Angela · Pico · Q-10", logo: "/partners/ids.png" },
  { name: "Classys", flag: "🇰🇷", note: "Ultraformer", logo: "/partners/classys.png" },
  { name: "Eunsung", flag: "🇰🇷", note: "Powershape", logo: "/partners/eunsung.png" },
  { name: "Erchonia", flag: "🇺🇸", note: "Low-level laser", logo: "/partners/erchonia.png" },
  { name: "Loktal", flag: "🇧🇷", note: "Medical systems", logo: "/partners/loktal.png" },
];

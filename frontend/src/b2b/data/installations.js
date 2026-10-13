// Installed base across Iran, used by the interactive map.
//
// `x`/`y` are percentages inside the map viewBox rather than lat/lon: the map
// is a stylised silhouette, not a projection, and pinning to real coordinates
// on a shape that isn't geographically accurate would look *more* wrong, not
// less. They are ordered by installed count so the legend and the pin
// stacking order agree without a second sort at render time.
//
// `name` stays English: it is the identity the map, the filters and the
// device records all key off. `fa` is the Persian spelling shown beside
// it in the city table; every other language reads `store.city.*`.

export const TOTAL_CENTERS = 1247;
export const TOTAL_DOCTORS = 8400;

export const CITIES = [
  {
    name: "Tehran",
    fa: "تهران",
    count: 432,
    x: 33,
    y: 31,
    devices: "Primelase (112) · InBody (98) · Cooltech (67) · Angela (54) · TESLA (41) · others (60)",
    doctors: "Dr. Karimi, Dr. Ahmadi, Dr. Afshar",
    verified: 312,
  },
  {
    name: "Isfahan",
    fa: "اصفهان",
    count: 89,
    x: 38,
    y: 47,
    devices: "Cooltech (22) · Primelase (18) · InBody (15) · 4Plus (12)",
    doctors: "Dr. Hosseini, Dr. Kazemi",
    verified: 64,
  },
  {
    name: "Shiraz",
    fa: "شیراز",
    count: 76,
    x: 36,
    y: 67,
    devices: "TESLA (19) · InBody (17) · Angela (14)",
    doctors: "Dr. Shirazi",
    verified: 51,
  },
  {
    name: "Mashhad",
    fa: "مشهد",
    count: 64,
    x: 64,
    y: 27,
    devices: "Pico Premium (15) · Primelase (14) · WOLF 1470 (11)",
    doctors: "Dr. Ghaffari",
    verified: 42,
  },
  {
    name: "Tabriz",
    fa: "تبریز",
    count: 51,
    x: 17,
    y: 25,
    devices: "InBody (13) · Cooltech (11)",
    doctors: "Dr. Tabrizi",
    verified: 38,
  },
  {
    name: "Ahvaz",
    fa: "اهواز",
    count: 48,
    x: 25,
    y: 58,
    devices: "Cooltech (12) · Q-10 (10)",
    doctors: "Dr. Ahvazi",
    verified: 29,
  },
  {
    name: "Karaj",
    fa: "کرج",
    count: 44,
    x: 30,
    y: 36,
    devices: "Primelase (11) · InBody (10)",
    doctors: "Dr. Karaji",
    verified: 31,
  },
  {
    name: "Yazd",
    fa: "یزد",
    count: 37,
    x: 48,
    y: 55,
    devices: "InBody (9) · TESLA (8)",
    doctors: "Dr. Yazdi",
    verified: 22,
  },
  {
    name: "Kerman",
    fa: "کرمان",
    count: 34,
    x: 55,
    y: 62,
    devices: "Angela (8) · Cooltech (7)",
    doctors: "Dr. Kermani",
    verified: 19,
  },
];

export const CITY_BY_NAME = new Map(CITIES.map((c) => [c.name, c]));

// A stylised Iran outline. Deliberately a single path rather than a real
// GeoJSON border: this is a "where our machines are" diagram, and a 300 KB
// topology download would buy nothing a doctor looking for their own city
// can perceive.
export const IRAN_PATH =
  "M78 118 L128 78 L198 68 L278 58 L348 73 L418 93 L498 108 L518 158 L488 218 L458 278 L398 318 L298 328 L198 308 L118 258 L78 198 Z";

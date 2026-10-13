// Catalogue vocabulary that has to be translated but is stored in English.
//
// Device records carry `country` and `cat` as English strings -- they come
// from the API as well as from data/devices.js, and the admin writes them in
// English -- so the screen has to look them up rather than print them. Both
// helpers fall back to the raw value: a country we have no key for is better
// shown as "Portugal" than as a key path or a blank.

const COUNTRY_KEY = {
  "South Korea": "southKorea",
  Korea: "korea",
  Spain: "spain",
  Italy: "italy",
  Slovenia: "slovenia",
  France: "france",
  Germany: "germany",
  USA: "usa",
  "United States": "usa",
  Iran: "iran",
};

export function countryName(t, country) {
  const key = COUNTRY_KEY[country];
  return key ? t(`store.country.${key}`) : country || "";
}

/** A city record's display name, keyed off its English `name`. */
export function cityName(t, city) {
  if (!city) return "";
  return t(`store.city.${String(city).toLowerCase()}`);
}

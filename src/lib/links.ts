// Common TLDs (gTLD + major ccTLD) used to distinguish real domains from
// code identifiers like `System.IO.IOException` or file extensions like
// `file.dll`. Kept as an explicit whitelist so method chains and file paths
// don't get misdetected as links.
const TLDS = [
  // gTLDs
  "com", "org", "net", "info", "biz", "name", "pro", "io", "ai", "me", "tv",
  "cc", "app", "dev", "tech", "xyz", "top", "site", "online", "store", "shop",
  "blog", "live", "cloud", "space", "press", "digital", "design", "email",
  "network", "agency", "edu", "gov", "mil", "mobi", "asia", "wang", "link",
  "tel", "red", "kim", "ren", "vip", "la", "love", "guru", "tips", "expert",
  "photo", "video", "media", "music", "game", "games", "news", "health",
  "club", "one", "art", "web", "host", "support", "help", "guide", "world",
  "zone", "website", "social", "company", "team", "works", "group", "finance",
  "money", "travel", "fashion", "food", "cafe", "bar", "pub", "life", "today",
  "city", "center", "care", "services", "solutions", "technology",
  "management", "systems", "productions", "photography", "gallery", "pictures",
  "fan", "watch", "toys", "dog", "cat", "pet", "plus", "family", "fun",
  "properties", "directory", "exchange", "market",
  // Major ccTLDs
  "cn", "co", "us", "uk", "de", "fr", "jp", "ru", "au", "ca", "in", "br",
  "it", "es", "mx", "nl", "se", "no", "fi", "dk", "at", "ch", "be", "pl",
  "cz", "tr", "kr", "hk", "tw", "sg", "th", "id", "my", "ph", "vn", "nz",
  "za", "ie", "pt", "gr", "hu", "ro", "sk", "bg", "rs", "hr", "si", "ee",
  "lt", "lv", "ua", "il", "ae", "sa", "qa", "kw", "eg", "ma", "tn", "ng",
  "ke", "gh", "ar", "cl", "pe", "ve", "uy", "py", "bo", "ec", "do", "ni",
  "cr", "pa", "cu", "jm",
];
const TLD_SET = new Set(TLDS);

// Matches http(s):// URLs AND bare domains (www.baidu.com, 4399.com, xxx.cn),
// but only when the final dot-segment is a known lowercase TLD — so method
// chains (`System.IO.IOException`) and file paths (`file.dll`, `Pack.co…`)
// are rejected. TLDs are matched case-sensitively because real domains use
// lowercase TLDs while code identifiers use PascalCase.
//
// Structure: (protocol)?(www.)?  (label.)+  TLD  path?
// The final dot-segment is matched against the TLD whitelist so the preceding
// `(?:[a-zA-Z0-9-]+\.)+` never consumes the TLD.
const URL_REGEX = new RegExp(
  `(?:https?://)?(?:[a-zA-Z0-9-]+\\.)+(${TLDS.join(
    "|"
  )})\\b(?:[/?#][^\\s]*)?`,
  "g"
);

/** Extract deduplicated links from text, stripping trailing punctuation. */
export function extractLinks(text: string): string[] {
  const matches = text.matchAll(URL_REGEX);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    // Use the regex capture group (m[1]) as the TLD, NOT the last dot-segment
    // of the full URL — for "https://github.com/login/device" the last dot
    // segment is "device", not the TLD "com".
    const tld = m[1];
    if (!tld || !TLD_SET.has(tld)) continue;
    const clean = m[0].replace(/[.,;:!?)]+$/g, "");
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}
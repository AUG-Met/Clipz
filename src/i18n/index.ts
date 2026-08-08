import zh from "./zh";
import en from "./en";

type Lang = "zh" | "en";

const translations: Record<Lang, Record<string, string>> = { zh, en };

let currentLang: Lang = "zh";
let listeners: Array<(lang: Lang) => void> = [];

export function t(key: string, params?: Record<string, string | number>): string {
  const text = translations[currentLang]?.[key] ?? translations["zh"]?.[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

export function setLanguage(lang: Lang) {
  currentLang = lang;
  listeners.forEach((fn) => fn(lang));
}

export function getLanguage(): Lang {
  return currentLang;
}

export function onLanguageChange(fn: (lang: Lang) => void) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
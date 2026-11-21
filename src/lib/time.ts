// Every time a person hears or reads is shown in the venue's time zone, never UTC.
import type { Language } from "@/lib/contract";

const TZ = process.env.DEMO_TIME_ZONE || "Europe/Amsterdam";
const LOCALE: Record<Language, string> = { en: "en-GB", de: "de-DE", nl: "nl-NL" };
const WORDS: Record<Language, { today: string; tomorrow: string; to: string }> = {
  en: { today: "today", tomorrow: "tomorrow", to: "to" },
  de: { today: "heute", tomorrow: "morgen", to: "bis" },
  nl: { today: "vandaag", tomorrow: "morgen", to: "tot" },
};

function parts(iso: string, lang: Language) {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = day.format(new Date());
  const tomorrow = day.format(new Date(Date.now() + 86400e3));
  const that = day.format(d);
  let dayWord: string;
  if (that === today) dayWord = WORDS[lang].today;
  else if (that === tomorrow) dayWord = WORDS[lang].tomorrow;
  else
    dayWord = new Intl.DateTimeFormat(LOCALE[lang], {
      timeZone: TZ, weekday: "long", day: "numeric", month: "long",
    }).format(d);
  return { time, dayWord };
}

/** "today 14:00" / "heute 14:00" / "vandaag 14:00" */
export function formatTime(iso: string, lang: Language = "en"): string {
  const { time, dayWord } = parts(iso, lang);
  return `${dayWord} ${time}`;
}

/** "today 14:00 to 16:00" / "heute 14:00 bis 16:00" / "vandaag 14:00 tot 16:00" */
export function formatSlot(startIso: string, endIso: string, lang: Language = "en"): string {
  const a = parts(startIso, lang);
  const b = parts(endIso, lang);
  return `${a.dayWord} ${a.time} ${WORDS[lang].to} ${b.time}`;
}

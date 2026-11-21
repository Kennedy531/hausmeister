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

/** Today's date at a local "HH:MM" (or "18", "1830") in the venue's time zone. Null if it can't be read. */
export function localToday(hhmm: string | null | undefined): Date | null {
  const m = String(hhmm ?? "").trim().match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59) return null;
  const now = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  // How far the venue's clock is from UTC right now.
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(now.getTime() / 60000) * 60000;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, h, min) - offset);
}

/** "18:00" in the venue's time zone. */
export function clock(iso: string | Date, lang: Language = "en"): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** "from 18:00" / "18:00 to 21:00" / "any time today" */
export function formatWindow(from: string | null | undefined, until: string | null | undefined, lang: Language = "en"): string {
  const w = {
    en: { any: "any time today", from: "from", until: "until", to: "to" },
    de: { any: "heute jederzeit", from: "ab", until: "bis", to: "bis" },
    nl: { any: "vandaag de hele dag", from: "vanaf", until: "tot", to: "tot" },
  }[lang];
  if (from && until) return `${clock(from, lang)} ${w.to} ${clock(until, lang)}`;
  if (from) return `${w.from} ${clock(from, lang)}`;
  if (until) return `${w.until} ${clock(until, lang)}`;
  return w.any;
}

/** A slot suits the tenant when the contractor would arrive while they're home: it starts inside the window. */
export function startsInWindow(startsAt: string, from: string | null | undefined, until: string | null | undefined): boolean {
  const t = Date.parse(startsAt);
  return (!from || t >= Date.parse(from)) && (!until || t < Date.parse(until));
}

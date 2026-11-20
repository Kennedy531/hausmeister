// Every time a person hears or reads is shown in the venue's time zone, never UTC.
const TZ = process.env.DEMO_TIME_ZONE || "Europe/Amsterdam";

function parts(iso: string, lang: "en" | "de") {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = day.format(new Date());
  const tomorrow = day.format(new Date(Date.now() + 86400e3));
  const that = day.format(d);
  let dayWord: string;
  if (that === today) dayWord = lang === "de" ? "heute" : "today";
  else if (that === tomorrow) dayWord = lang === "de" ? "morgen" : "tomorrow";
  else
    dayWord = new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
      timeZone: TZ, weekday: "long", day: "numeric", month: "long",
    }).format(d);
  return { time, dayWord };
}

/** "today 14:00" / "heute 14:00" */
export function formatTime(iso: string, lang: "en" | "de" = "en"): string {
  const { time, dayWord } = parts(iso, lang);
  return `${dayWord} ${time}`;
}

/** "today 14:00 to 16:00" / "heute 14:00 bis 16:00" */
export function formatSlot(startIso: string, endIso: string, lang: "en" | "de" = "en"): string {
  const a = parts(startIso, lang);
  const b = parts(endIso, lang);
  return `${a.dayWord} ${a.time} ${lang === "de" ? "bis" : "to"} ${b.time}`;
}

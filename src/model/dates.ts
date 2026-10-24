const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, thirty: 30,
};

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromISODate(s);
  return toISODate(d) === s;
}

/** Whole days from today to the given date (negative when it is in the past). */
export function daysUntil(iso: string, today: Date): number {
  const a = fromISODate(iso);
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const t1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round((t1 - t0) / 86_400_000);
}

function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  return MONTHS.findIndex((m) => m.startsWith(word));
}

function weekdayIndex(word: string): number {
  if (word === 'weds') return 3;
  if (word.length < 3) return -1;
  return WEEKDAYS.findIndex((w) => w.startsWith(word));
}

function toNumber(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return SMALL_NUMBERS[word] ?? null;
}

function dateFromDayMonth(day: number, month: number, year: number | null, today: Date): string | null {
  if (month < 0 || day < 1 || day > 31) return null;
  let y = year ?? today.getFullYear();
  let d = new Date(y, month, day);
  if (d.getMonth() !== month) return null;
  // With no year given, a date well in the past most likely means next year.
  if (year === null && daysUntil(toISODate(d), today) < -60) {
    y += 1;
    d = new Date(y, month, day);
  }
  return toISODate(d);
}

/**
 * Understands everyday ways of saying a date: "today", "tomorrow", "friday",
 * "next monday", "in 3 days", "next week", "oct 30", "30th october", "2026-11-02".
 * Returns YYYY-MM-DD or null when the text is not a date.
 */
export function parseDue(input: string, today: Date): string | null {
  let t = input.toLowerCase().trim().replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ');
  t = t.replace(/^(on|by|for|before|due|the)\s+/, '').replace(/^(on|by|the)\s+/, '');
  if (!t) return null;

  if (t === 'today' || t === 'tonight' || t === 'now') return toISODate(today);
  if (t === 'tomorrow' || t === 'tmrw' || t === 'tmr') return toISODate(addDays(today, 1));
  if (t === 'day after tomorrow' || t === 'the day after tomorrow') return toISODate(addDays(today, 2));
  if (t === 'yesterday') return toISODate(addDays(today, -1));
  if (t === 'next week') return toISODate(addDays(today, 7));
  if (t === 'next month') return toISODate(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()));

  if (/^(end of (the )?week|this week|eow)$/.test(t)) {
    const toFriday = (5 - today.getDay() + 7) % 7;
    return toISODate(addDays(today, toFriday));
  }
  if (/^(this )?weekend$/.test(t)) {
    const toSaturday = (6 - today.getDay() + 7) % 7;
    return toISODate(addDays(today, toSaturday));
  }

  let m = t.match(/^in (\w+) (day|days|week|weeks)$/);
  if (m) {
    const n = toNumber(m[1]);
    if (n === null) return null;
    return toISODate(addDays(today, m[2].startsWith('week') ? n * 7 : n));
  }

  m = t.match(/^(this |next |coming |this coming )?([a-z]+)$/);
  if (m) {
    const wd = weekdayIndex(m[2]);
    if (wd >= 0) {
      let delta = (wd - today.getDay() + 7) % 7;
      if (m[1]?.trim() === 'next') {
        // "next friday" is the Friday of next week (weeks run Monday to Sunday). On a weekend,
        // that's the coming Friday; earlier in the week it skips this week's Friday.
        const upcoming = delta === 0 ? 7 : delta;
        const daysLeftThisWeek = (7 - today.getDay()) % 7; // Sunday ends the week
        delta = upcoming <= daysLeftThisWeek ? upcoming + 7 : upcoming;
      }
      return toISODate(addDays(today, delta));
    }
  }

  if (isISODate(t)) return t;

  // "30 oct", "30th of october", "30 october 2026"
  m = t.match(/^(\d{1,2})(st|nd|rd|th)?( of)? ([a-z]+)(,? (\d{4}))?$/);
  if (m) return dateFromDayMonth(Number(m[1]), monthIndex(m[4]), m[6] ? Number(m[6]) : null, today);

  // "oct 30", "october 30th", "october 30, 2026"
  m = t.match(/^([a-z]+) (\d{1,2})(st|nd|rd|th)?(,? (\d{4}))?$/);
  if (m) return dateFromDayMonth(Number(m[2]), monthIndex(m[1]), m[5] ? Number(m[5]) : null, today);

  // "the 30th"
  m = t.match(/^(\d{1,2})(st|nd|rd|th)$/);
  if (m) {
    const day = Number(m[1]);
    let iso = dateFromDayMonth(day, today.getMonth(), today.getFullYear(), today);
    if (iso && daysUntil(iso, today) < 0) {
      const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      iso = dateFromDayMonth(day, next.getMonth(), next.getFullYear(), today);
    }
    return iso;
  }

  return null;
}

export type DueStatus = 'overdue' | 'today' | 'soon' | 'later';

export interface DueDescription {
  /** Short text for the screen, e.g. "Tomorrow", "Fri 24 Oct". */
  short: string;
  /** Full sentence fragment for speech, e.g. "due tomorrow, Friday 24 October". */
  spoken: string;
  status: DueStatus;
}

export function describeDue(iso: string, today: Date): DueDescription {
  const d = fromISODate(iso);
  const days = daysUntil(iso, today);
  const weekday = WEEKDAYS[d.getDay()];
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const longDate = `${cap(weekday)} ${d.getDate()} ${cap(MONTHS[d.getMonth()])}`;
  const shortDate = `${cap(weekday.slice(0, 3))} ${d.getDate()} ${cap(MONTHS[d.getMonth()].slice(0, 3))}`;

  if (days < 0) {
    const n = -days;
    return { short: `Overdue ${n}d`, spoken: `overdue by ${n} day${n === 1 ? '' : 's'}, was due ${longDate}`, status: 'overdue' };
  }
  if (days === 0) return { short: 'Today', spoken: 'due today', status: 'today' };
  if (days === 1) return { short: 'Tomorrow', spoken: `due tomorrow, ${longDate}`, status: 'soon' };
  if (days < 7) return { short: shortDate, spoken: `due ${longDate}, in ${days} days`, status: 'soon' };
  return { short: shortDate, spoken: `due ${longDate}`, status: 'later' };
}

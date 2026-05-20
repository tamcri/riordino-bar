export type ShiftStatus = "work" | "split" | "rest" | "vacation" | "change";

export type WeekDay = {
  key: string;
  shortLabel: string;
  label: string;
};

export const SHIFT_STATUSES: ShiftStatus[] = ["work", "split", "rest", "vacation", "change"];

export const WEEK_DAYS: WeekDay[] = [
  { key: "mon", shortLabel: "Lun", label: "Lunedì" },
  { key: "tue", shortLabel: "Mar", label: "Martedì" },
  { key: "wed", shortLabel: "Mer", label: "Mercoledì" },
  { key: "thu", shortLabel: "Gio", label: "Giovedì" },
  { key: "fri", shortLabel: "Ven", label: "Venerdì" },
  { key: "sat", shortLabel: "Sab", label: "Sabato" },
  { key: "sun", shortLabel: "Dom", label: "Domenica" },
];

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  );
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return false;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));

  return (
    d.getUTCFullYear() === yyyy &&
    d.getUTCMonth() === mm - 1 &&
    d.getUTCDate() === dd
  );
}

export function isTimeHHMM(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (isTimeHHMM(s)) return s;

  const withSeconds = /^([01]\d|2[0-3]):([0-5]\d):[0-5]\d$/.exec(s);
  if (withSeconds) return `${withSeconds[1]}:${withSeconds[2]}`;

  return null;
}

export function normalizeShiftStatus(value: unknown): ShiftStatus | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "work" || s === "split" || s === "rest" || s === "vacation" || s === "change") return s;
  return null;
}

export function shiftStatusLabel(status: ShiftStatus) {
  switch (status) {
    case "work":
      return "Turno";
    case "split":
      return "Spezzato";
    case "rest":
      return "Riposo";
    case "vacation":
      return "Ferie";
    case "change":
      return "Cambio turno";
  }
}

export function isNoTimeStatus(status: ShiftStatus) {
  return status === "rest" || status === "vacation";
}

export function requiresSecondShift(status: ShiftStatus) {
  return status === "split";
}

export function parseDateOnlyUTC(value: string) {
  if (!isDateOnly(value)) return null;
  const [yyyy, mm, dd] = value.split("-").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

export function toDateOnlyUTC(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDaysISO(dateISO: string, days: number) {
  const d = parseDateOnlyUTC(dateISO);
  if (!d) return dateISO;
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnlyUTC(d);
}

export function getMondayISO(dateISO: string) {
  const d = parseDateOnlyUTC(dateISO);
  if (!d) return dateISO;

  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return toDateOnlyUTC(d);
}

export function getWeekDates(weekStartISO: string) {
  const monday = getMondayISO(weekStartISO);
  return Array.from({ length: 7 }, (_, index) => addDaysISO(monday, index));
}

export function formatDateIT(value: string) {
  if (!isDateOnly(value)) return value || "—";
  const [yyyy, mm, dd] = value.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

export function timeToMinutes(value: string | null | undefined) {
  const t = normalizeTime(value ?? "");
  if (!t) return null;
  const [hh, mm] = t.split(":").map(Number);
  return hh * 60 + mm;
}

export function minutesBetween(startTime: string | null | undefined, endTime: string | null | undefined) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end === start) return 0;
  if (end > start) return end - start;

  // Turno notturno: se l'ora di fine e' minore dell'ora di inizio,
  // il turno viene considerato concluso il giorno successivo.
  // Esempio: 21:00 - 05:00 = 8 ore, conteggiate nel giorno di inizio.
  return 1440 - start + end;
}

export function hoursBetween(startTime: string | null | undefined, endTime: string | null | undefined) {
  return minutesBetween(startTime, endTime) / 60;
}

export function shiftMinutesTotal(args: {
  status: ShiftStatus | null | undefined;
  start_time?: string | null;
  end_time?: string | null;
  second_start_time?: string | null;
  second_end_time?: string | null;
}) {
  const status = normalizeShiftStatus(args.status) ?? "rest";
  if (isNoTimeStatus(status)) return 0;

  const first = minutesBetween(args.start_time, args.end_time);
  if (status !== "split") return first;

  return first + minutesBetween(args.second_start_time, args.second_end_time);
}

export function shiftHoursTotal(args: {
  status: ShiftStatus | null | undefined;
  start_time?: string | null;
  end_time?: string | null;
  second_start_time?: string | null;
  second_end_time?: string | null;
}) {
  return shiftMinutesTotal(args) / 60;
}

export function formatShiftTimeRange(args: {
  status: ShiftStatus | null | undefined;
  start_time?: string | null;
  end_time?: string | null;
  second_start_time?: string | null;
  second_end_time?: string | null;
}) {
  const status = normalizeShiftStatus(args.status);
  if (!status || isNoTimeStatus(status)) return "—";

  const firstStart = normalizeTime(args.start_time ?? "") ?? "--:--";
  const firstEnd = normalizeTime(args.end_time ?? "") ?? "--:--";

  if (status !== "split") return `${firstStart} - ${firstEnd}`;

  const secondStart = normalizeTime(args.second_start_time ?? "") ?? "--:--";
  const secondEnd = normalizeTime(args.second_end_time ?? "") ?? "--:--";
  return `${firstStart} - ${firstEnd} / ${secondStart} - ${secondEnd}`;
}

export function formatHours(value: number) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function currentWeekMondayISO() {
  return getMondayISO(todayLocalISO());
}

export function clampText(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function getErrorMessage(error: unknown, fallback = "Errore") {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

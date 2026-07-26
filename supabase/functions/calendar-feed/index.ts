// Public iCalendar feed secured by an unguessable, resettable subscription
// token. Calendar clients cannot send a FreshShift login session, so the token
// is the only credential and is stored hashed in Postgres.

import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const BERLIN_TIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "X-LIC-LOCATION:Europe/Berlin",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

type Shift = {
  id: string;
  schedule_id: string;
  store_id: string;
  week_key: string;
  day_key: string;
  start: string;
  end: string;
  updated_at: string | null;
};

type CalendarFeed = {
  employeeName: string;
  shifts: Shift[];
};

function calendarEscape(value: string) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatUtc(value: Date) {
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}` +
    `T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
}

function isoWeekDate(weekKey: string, dayKey: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  const dayOffset = DAY_INDEX[dayKey];
  if (!match || dayOffset === undefined) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const isoDay = januaryFourth.getUTCDay() || 7;
  const monday = new Date(Date.UTC(year, 0, 4 - isoDay + 1 + (week - 1) * 7 + dayOffset));
  return `${monday.getUTCFullYear()}${pad(monday.getUTCMonth() + 1)}${pad(monday.getUTCDate())}`;
}

function addDay(date: string) {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) + 1));
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}`;
}

function localDateTime(date: string, time: string) {
  return `${date}T${time.replace(":", "")}00`;
}

function eventForShift(shift: Shift) {
  const startDate = isoWeekDate(shift.week_key, shift.day_key);
  if (!startDate || !/^\d{2}:\d{2}$/.test(shift.start) || !/^\d{2}:\d{2}$/.test(shift.end)) return null;
  const endDate = shift.end <= shift.start ? addDay(startDate) : startDate;
  const store = shift.store_id === "yes_fresh" ? "Yes Fresh" : "Fresh Fries";
  const updatedAt = shift.updated_at ? new Date(shift.updated_at) : new Date(0);
  return [
    "BEGIN:VEVENT",
    `UID:${shift.schedule_id}-${shift.day_key}@freshshift.de`,
    `DTSTAMP:${formatUtc(updatedAt)}`,
    `LAST-MODIFIED:${formatUtc(updatedAt)}`,
    `DTSTART;TZID=Europe/Berlin:${localDateTime(startDate, shift.start)}`,
    `DTEND;TZID=Europe/Berlin:${localDateTime(endDate, shift.end)}`,
    `SUMMARY:${calendarEscape(`Arbeiten – ${store}`)}`,
    `LOCATION:${calendarEscape(store)}`,
    `DESCRIPTION:${calendarEscape(`FreshShift · ${store} · ${shift.start}–${shift.end}`)}`,
    "END:VEVENT",
  ].join("\r\n");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(body: string | null, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return response("Method not allowed", 405, { Allow: "GET, HEAD" });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return response("Not found", 404);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return response("Calendar feed is not configured", 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = await sha256(token);
  const { data, error } = await admin.rpc("get_calendar_feed", { p_token_hash: tokenHash });
  if (error) {
    console.error("calendar feed lookup failed", error);
    return response("Calendar feed unavailable", 503);
  }
  if (!data) return response("Not found", 404);
  const feed = data as CalendarFeed;
  const employeeName = String(feed.employeeName || "Mitarbeiter");
  const shifts = Array.isArray(feed.shifts) ? feed.shifts : [];

  const events = shifts
    .map((shift) => eventForShift(shift))
    .filter((event): event is string => Boolean(event))
    .sort();
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FreshShift//Arbeitsplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calendarEscape(`FreshShift – ${employeeName}`)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    BERLIN_TIMEZONE,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const etag = `\"${await sha256(calendar)}\"`;
  const headers = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": "inline; filename=\"freshshift.ics\"",
    "Cache-Control": "private, no-cache, max-age=0",
    ETag: etag,
  };
  if (req.headers.get("If-None-Match") === etag) return response(null, 304, headers);
  return response(req.method === "HEAD" ? null : calendar, 200, headers);
});

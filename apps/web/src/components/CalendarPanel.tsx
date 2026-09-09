import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Link2, RefreshCw, Users } from "lucide-react";
import { api, type CalendarEventItem, type ConnectionStatus } from "../api";

const HOUR_HEIGHT = 48;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 20;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function minutesFromMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtLastSync(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const d = new Date(iso);
  const today = new Date();
  if (isSameDay(d, today)) return `Synced ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return `Synced ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function CalendarPanel() {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const isToday = isSameDay(day, today);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = startOfDay(day).toISOString();
      const end = addDays(startOfDay(day), 1).toISOString();
      const res = await api.getCalendarEvents(start, end);
      setEvents(res.events);
      setLastSync(res.lastSyncAt);
    } catch (e) {
      setEvents([]);
      setError(e instanceof Error ? e.message : "Failed to load your calendar");
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    api
      .getConnections()
      .then(setConn)
      .catch(() => setConn(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = conn?.calendar.connected ?? false;
  const needsReauth = conn?.calendar.needsReauth ?? false;

  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay && e.startAt && e.endAt);

  // Extend the visible window to include events outside 7am–8pm.
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const e of timedEvents) {
    if (!e.startAt || !e.endAt) continue;
    const s = Math.floor(minutesFromMidnight(e.startAt) / 60);
    const en = minutesFromMidnight(e.endAt);
    const ehr = Math.ceil(en / 60);
    startHour = Math.min(startHour, s);
    endHour = Math.max(endHour, ehr);
  }

  const hours: number[] = [];
  for (let h = startHour; h < endHour; h += 1) hours.push(h);
  const gridMinutes = (endHour - startHour) * 60;

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowVisible = isToday && nowMin >= startHour * 60 && nowMin <= endHour * 60;
  const nowTop = ((nowMin - startHour * 60) / 60) * HOUR_HEIGHT;

  const dateLabel = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  // Unavailable / reauth state (no events fetch needed when not connected).
  if (conn && !connected) {
    return (
      <div className="calendar-panel-state">
        <AlertTriangle size={22} aria-hidden />
        <p className="cal-state-title">{needsReauth ? "Calendar needs reauthorization" : "Google Calendar is not connected"}</p>
        <p className="helper">
          {needsReauth
            ? "Your Google authorization has expired. Reconnect Calendar from Settings → Integrations to view your day."
            : "Connect Google Calendar from Settings → Integrations to see your schedule here."}
        </p>
      </div>
    );
  }

  return (
    <div className="calendar-panel">
      {/* Date navigation */}
      <div className="cal-panel-nav">
        <div>
          <div className="cal-panel-today">{isToday ? "Today" : day.toLocaleDateString(undefined, { weekday: "long" })}</div>
          <div className="cal-panel-date">{dateLabel}</div>
        </div>
        <div className="cal-panel-navbtns">
          <button type="button" className="iconbtn" aria-label="Previous day" onClick={() => setDay((d) => addDays(d, -1))}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="iconbtn" aria-label="Next day" onClick={() => setDay((d) => addDays(d, 1))}>
            <ChevronRight size={18} />
          </button>
          {!isToday && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDay(today)}>
              Today
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="cal-skeleton" aria-hidden>
          <div className="cal-skel-line" />
          <div className="cal-skel-line" />
          <div className="cal-skel-line" />
          <div className="cal-skel-block" />
        </div>
      ) : error ? (
        <div className="calendar-panel-state">
          <AlertTriangle size={22} aria-hidden />
          <p className="cal-state-title">Couldn't load your calendar</p>
          <p className="helper">{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : (
        <>
          {allDayEvents.length > 0 && (
            <div className="cal-allday">
              {allDayEvents.map((e) => (
                <div className="cal-allday-item" key={e.id}>
                  <span className="cal-allday-label">All day</span>
                  <span className="cal-allday-title">{e.title ?? "(untitled)"}</span>
                </div>
              ))}
            </div>
          )}

          {timedEvents.length === 0 && allDayEvents.length === 0 ? (
            <div className="cal-empty">Nothing scheduled today.</div>
          ) : (
            <div className="cal-timeline" style={{ height: (gridMinutes / 60) * HOUR_HEIGHT }}>
              {nowVisible && <div className="cal-now" style={{ top: nowTop }} />}
              {hours.map((h) => (
                <div className="cal-tick" key={h} style={{ top: ((h - startHour) * 60 / 60) * HOUR_HEIGHT }}>
                  <span className="cal-tick-label">{String(h).padStart(2, "0")}:00</span>
                </div>
              ))}
              {timedEvents.map((e) => {
                const s = minutesFromMidnight(e.startAt!);
                const en = minutesFromMidnight(e.endAt!);
                const top = ((s - startHour * 60) / 60) * HOUR_HEIGHT;
                const height = Math.max(((en - s) / 60) * HOUR_HEIGHT, 26);
                return (
                  <div className="cal-event" key={e.id} style={{ top, height }}>
                    <div className="cal-event-time">
                      {fmtTime(e.startAt)} – {fmtTime(e.endAt)} · {fmtDuration(en - s)}
                    </div>
                    <div className="cal-event-title">{e.title ?? "(untitled)"}</div>
                    <div className="cal-event-meta">
                      {e.attendeeCount > 0 && (
                        <span className="cal-event-chip">
                          <Users size={12} /> {e.attendeeCount}
                        </span>
                      )}
                      {e.meetingUrl && (
                        <a className="cal-event-chip cal-event-link" href={e.meetingUrl} target="_blank" rel="noreferrer">
                          <Link2 size={12} /> Meet
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Integration health */}
      <div className="cal-panel-foot">
        <span className="cal-health">
          <span className={`integration-dot ${connected ? "connected" : ""}`} />
          {connected ? "Connected" : "Not connected"}
        </span>
        <span className="cal-health">{fmtLastSync(lastSync)}</span>
      </div>
    </div>
  );
}
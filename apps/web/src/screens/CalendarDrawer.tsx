import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components";

interface CalEvent {
  id: string;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  meetingUrl: string | null;
  organizerEmail: string | null;
  status: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function CalendarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const start = startOfDay(day).toISOString();
    const end = new Date(startOfDay(day).getTime() + 24 * 3600 * 1000).toISOString();
    api
      .getCalendarEvents(start, end)
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [open, day]);

  if (!open) return null;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const byHour = new Map<number, CalEvent[]>();
  for (const e of events) {
    const h = e.startAt ? new Date(e.startAt).getHours() : 0;
    byHour.set(h, [...(byHour.get(h) ?? []), e]);
  }
  const label = day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer calendar-drawer" role="dialog" aria-label="Calendar">
        <div className="drawer-head">
          <h3>Calendar</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <div className="cal-nav">
            <Button variant="ghost" onClick={() => setDay(new Date(day.getTime() - 24 * 3600 * 1000))}>
              ‹ Prev
            </Button>
            <span className="cal-date">{label}</span>
            <Button variant="ghost" onClick={() => setDay(new Date(day.getTime() + 24 * 3600 * 1000))}>
              Next ›
            </Button>
          </div>

          {loading ? (
            <div className="helper">Loading…</div>
          ) : (
            <div className="cal-grid">
              {hours.map((h) => {
                const hourEvents = byHour.get(h) ?? [];
                return (
                  <div className="cal-hour" key={h}>
                    <div className="cal-hour-label">{String(h).padStart(2, "0")}:00</div>
                    <div className="cal-hour-events">
                      {hourEvents.map((e) => (
                        <div className="cal-event" key={e.id}>
                          <div className="cal-event-title">{e.title ?? "(untitled)"}</div>
                          <div className="cal-event-time">
                            {fmtTime(e.startAt)}
                            {e.endAt ? ` – ${fmtTime(e.endAt)}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { useMemo, useState } from "react";
import { BOOKING } from "../data/site";
import { CheckoutBanner } from "../components";
import { CalendarIcon, ClockIcon } from "../icons";

// NOTE (Oct 27, 2026): the pay path is REMOVED. The old flow took $48.88
// at Stripe and delivered nothing — no booking record, no confirmation,
// no session link, and the same slot could be sold twice. The server also
// refuses booking-1to1 at /api/checkout. This page now shows Abisola's
// standing availability only; booking returns with the separate
// booking-delivery build (records, confirmation email, slot inventory).

interface DayCell {
  date: Date;
  key: string;
  dayNum: number;
  disabled: boolean;
  isToday: boolean;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

function monthCells(year: number, month: number, today: Date): (DayCell | null)[] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (DayCell | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dow = date.getDay();
    const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    cells.push({
      date,
      key: `${year}-${month}-${d}`,
      dayNum: d,
      disabled: dow === 0 || dow === 6 || isPast,
      isToday: !isPast && dow !== 0 && dow !== 6 && d === today.getDate() && month === today.getMonth() && year === today.getFullYear(),
    });
  }
  return cells;
}

export function BookingPage({ search }: { search: string }) {
  const today = useMemo(() => new Date(), []);
  const months = useMemo(() => {
    const m1 = { year: today.getFullYear(), month: today.getMonth() };
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const m2 = { year: next.getFullYear(), month: next.getMonth() };
    return [m1, m2].map((m) => ({ ...m, label: MONTH_FMT.format(new Date(m.year, m.month, 1)), cells: monthCells(m.year, m.month, today) }));
  }, [today]);

  const [day, setDay] = useState<DayCell | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  return (
    <main className="page">
      <CheckoutBanner search={search} />
      <section className="page-head">
        <h1 className="page-title">Book a 1-to-1 with Abisola.</h1>
        <p className="lead">
          A private 30-minute session, one to one. Sessions run weekdays
          9:00 AM–2:00 PM Eastern — the calendar below shows the standing
          availability.
        </p>
        <ul className="chip-row">
          <li className="chip chip-price">
            {BOOKING.priceLabel} <span className="chip-note">per session</span>
          </li>
          <li className="chip">
            <ClockIcon className="chip-icon" /> {BOOKING.durationLabel}
          </li>
          <li className="chip">
            <CalendarIcon className="chip-icon" /> Weekdays · {BOOKING.timezoneLabel}
          </li>
        </ul>
      </section>

      <div className="booking-grid">
        <section className="card" aria-label="Choose a day">
          {months.map((m) => (
            <div key={m.label} className="calendar-month">
              <h2 className="calendar-title">{m.label}</h2>
              <div className="calendar-grid" role="grid" aria-label={m.label}>
                {WEEKDAYS.map((w) => (
                  <span key={w} className="calendar-dow" aria-hidden="true">
                    {w}
                  </span>
                ))}
                {m.cells.map((cell, i) =>
                  cell === null ? (
                    <span key={`blank-${i}`} className="calendar-blank" />
                  ) : (
                    <button
                      key={cell.key}
                      type="button"
                      className={`calendar-day${day?.key === cell.key ? " selected" : ""}${cell.isToday ? " today" : ""}`}
                      disabled={cell.disabled}
                      onClick={() => setDay(cell)}
                      aria-pressed={day?.key === cell.key}
                    >
                      {cell.dayNum}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
          <p className="fine-print">Weekends and past days are unavailable.</p>
        </section>

        <section className="card" aria-label="Choose a time">
          <h2 className="section-title">Pick a time</h2>
          {day ? (
            <>
              <p className="booking-day-label">{DAY_FMT.format(day.date)}</p>
              <div className="slot-grid">
                {BOOKING.slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`slot${slot === s ? " selected" : ""}`}
                    onClick={() => setSlot(s)}
                    aria-pressed={slot === s}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="fine-print">30-minute sessions · {BOOKING.timezoneLabel}</p>
            </>
          ) : (
            <p className="dim-text">Choose a day first — times will appear here.</p>
          )}
          {day && slot ? (
            <p className="booking-summary">
              <CalendarIcon className="chip-icon" /> {DAY_FMT.format(day.date)} · {slot} ·{" "}
              {BOOKING.durationLabel} · {BOOKING.priceLabel}
            </p>
          ) : null}
          <p className="fine-print">
            Online booking is paused while the Library finishes its move —
            this calendar shows the standing weekly availability so you can
            plan around it.
          </p>
        </section>
      </div>
    </main>
  );
}

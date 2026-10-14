import { useMemo, useState } from "react";
import { BOOKING } from "../data/site";
import { startCheckout } from "../api";
import { go } from "../nav";
import { CheckoutBanner } from "../components";
import { ArrowLeftIcon, CalendarIcon, CheckIcon, ClockIcon } from "../icons";

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

  const [step, setStep] = useState<1 | 2>(1);
  const [day, setDay] = useState<DayCell | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const canContinue = day !== null && slot !== null;
  const canConfirm = name.trim().length > 1 && /.+@.+\..+/.test(email);

  const confirm = async () => {
    if (!day || !slot) return;
    setBusy(true);
    const note = `1:1 booking — ${DAY_FMT.format(day.date)} at ${slot} (${BOOKING.timezoneLabel}) for ${name.trim()} <${email.trim()}>${notes.trim() ? ` — ${notes.trim()}` : ""}`;
    const result = await startCheckout(BOOKING.itemId, note);
    if (result === "unavailable") {
      setBusy(false);
      go("/checkout-unavailable");
    }
  };

  return (
    <main className="page">
      <CheckoutBanner search={search} />
      <section className="page-head">
        <h1 className="page-title">Book a 1-to-1 with Abisola.</h1>
        <p className="lead">
          A private 30-minute session, one to one. Pick a weekday and a time —
          sessions run 9:00 AM–2:00 PM Eastern.
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

      <ol className="steps" aria-label="Booking steps">
        <li className={step === 1 ? "active" : "done"}>
          {step === 2 ? <CheckIcon className="steps-icon" /> : "1"} Day &amp; time
        </li>
        <li className={step === 2 ? "active" : ""}>2 Your details</li>
      </ol>

      {step === 1 ? (
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
            <button
              type="button"
              className="primary-button wide"
              disabled={!canContinue}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </section>
        </div>
      ) : (
        <section className="card booking-details" aria-label="Your details">
          <h2 className="section-title">Your details</h2>
          <p className="booking-summary">
            <CalendarIcon className="chip-icon" /> {day ? DAY_FMT.format(day.date) : ""} · {slot}{" "}
            · {BOOKING.durationLabel} · {BOOKING.priceLabel}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canConfirm) void confirm();
            }}
          >
            <label className="field">
              <span>Your name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="field">
              <span>Anything Abisola should know? (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={400}
              />
            </label>
            <div className="cta-row">
              <button type="button" className="quiet-button" onClick={() => setStep(1)}>
                <ArrowLeftIcon className="btn-icon" /> Back
              </button>
              <button type="submit" className="primary-button" disabled={!canConfirm || busy}>
                {busy ? "Opening checkout…" : `Confirm & pay — ${BOOKING.priceLabel}`}
              </button>
            </div>
            <p className="fine-print">
              Payment is taken securely at checkout. Your session link arrives
              by email after payment.
            </p>
          </form>
        </section>
      )}
    </main>
  );
}

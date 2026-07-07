// Macro-event awareness (PRD §6 P1) via a static, owner-editable calendar
// in config/macro-events.json — deterministic and free, no scraping. The
// digest gets the upcoming window as input; the dashboard hero shows the
// same events, so both surfaces flag the same dates.

const DAY_MS = 24 * 60 * 60 * 1000;

// Events starting (or still running) within the next `horizonDays`,
// soonest first. Dates in the config are calendar days (UTC-parsed);
// an event "ends" at the close of its endDate (or date) day.
export function upcomingMacroEvents(events, now = new Date(), horizonDays = 7) {
  const horizon = now.getTime() + horizonDays * DAY_MS;
  return (events || [])
    .map((e) => {
      const start = Date.parse(e.date);
      const end = Date.parse(e.endDate || e.date) + DAY_MS;
      return { ...e, start, end };
    })
    .filter((e) => Number.isFinite(e.start) && e.end > now.getTime() && e.start <= horizon)
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, ...e }) => ({
      ...e,
      daysAway: Math.max(0, Math.ceil((start - now.getTime()) / DAY_MS)),
    }));
}

// "Jul 28–29" / "Jul 14" — compact chip text for the dashboard.
export function formatEventDates(event) {
  const fmt = (iso) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`)
    );
  if (event.endDate && event.endDate !== event.date) {
    const startDay = fmt(event.date);
    const endDate = new Date(`${event.endDate}T00:00:00Z`);
    const sameMonth = event.date.slice(0, 7) === event.endDate.slice(0, 7);
    return sameMonth ? `${startDay}–${endDate.getUTCDate()}` : `${startDay} – ${fmt(event.endDate)}`;
  }
  return fmt(event.date);
}

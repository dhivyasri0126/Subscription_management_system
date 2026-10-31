const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export const formatMoney = (v) => money.format(Number(v || 0));

export function formatDate(v) {
  if (!v) return "—";
  // Plain "YYYY-MM-DD" is read as a local date so it never shifts by a day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const titleCase = (s = "") =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const PERIOD = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
export const periodLabel = (p) => PERIOD[p] || p;

export const toCents = (v) => Math.round(Number(v || 0) * 100);
// Dependency-free SVG charts for the staff dashboard.
export const compact = (n) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));

function niceMax(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].find((m) => m * p >= raw) * p * 4;
}

// data: [{ label, value }]  (the last bar is drawn as the current period)
export function BarChart({ data, height = 230 }) {
  const W = 560, H = height, L = 46, T = 10, B = 26;
  const top = niceMax(Math.max(...data.map((d) => d.value), 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L) / data.length, bw = slot * 0.5;
  return (
    <svg className="sp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue collected by month">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line className="sp-grid-line" x1={L} x2={W} y1={y((top * i) / 4)} y2={y((top * i) / 4)} />
          <text className="sp-axis" x={L - 8} y={y((top * i) / 4) + 4} textAnchor="end">{compact((top * i) / 4)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = L + slot * i + (slot - bw) / 2;
        return (
          <g key={d.label}>
            <rect className={i === data.length - 1 ? 'sp-bar sp-bar-now' : 'sp-bar'} x={x} y={y(d.value)}
                  width={bw} height={Math.max(H - B - y(d.value), d.value ? 2 : 0)} rx="3">
              <title>{`${d.label}: ₹${Number(d.value).toLocaleString('en-IN')}`}</title>
            </rect>
            <text className="sp-axis" x={x + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// segments: [{ label, value, color }]
export function Donut({ segments, center }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let offset = 25;
  return (
    <div className="sp-donut">
      <svg viewBox="0 0 42 42" role="img" aria-label="Money position">
        <circle cx="21" cy="21" r="15.9155" fill="none" strokeWidth="6" style={{ stroke: 'var(--line)' }} />
        {total > 0 && segments.map((s) => {
          const pct = (s.value / total) * 100;
          const el = (
            <circle key={s.label} cx="21" cy="21" r="15.9155" fill="none" strokeWidth="6"
                    style={{ stroke: s.color }} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset} />
          );
          offset -= pct;
          return el;
        })}
        <text x="21" y="22.5" textAnchor="middle" className="sp-donut-text">{center}</text>
      </svg>
      <ul className="sp-legend">
        {segments.map((s) => (
          <li key={s.label}><i style={{ background: s.color }} />{s.label}
            <b>₹{compact(s.value)}</b></li>
        ))}
      </ul>
    </div>
  );
}
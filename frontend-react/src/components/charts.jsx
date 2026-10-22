/* A donut with a number in the middle. parts: [{ label, value, color }] */
export function Donut({ parts, label }) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1, r = 70, C = 2 * Math.PI * r, gap = parts.length > 1 ? 3 : 0;
  let off = 0;
  return (
    <svg viewBox="0 0 200 200" width="180" height="180" role="img" aria-label={label}>
      <circle cx="100" cy="100" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="22" />
      {parts.map((p) => {
        const part = p.value / total * C, len = Math.max(0.5, part - gap), o = off;
        off += part;
        return <circle key={p.label} cx="100" cy="100" r={r} fill="none" stroke={p.color} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-o} transform="rotate(-90 100 100)"><title>{`${p.label}: ${p.value}`}</title></circle>;
      })}
      <text x="100" y="100" textAnchor="middle" style={{ font: "600 42px var(--display)", fill: "var(--ink)" }}>{parts.reduce((n, p) => n + p.value, 0)}</text>
      <text x="100" y="124" textAnchor="middle" style={{ font: "500 12px var(--body)", fill: "var(--ink-faint)" }}>{label}</text>
    </svg>
  );
}

/* A progress ring with a label in the middle. */
export function Ring({ pct, color, label, sub, size = 104 }) {
  const r = 44, C = 2 * Math.PI * r, d = C * Math.max(0, Math.min(100, pct)) / 100;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label} ${sub}`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="9" />
      {d > 0.5 && <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${d} ${C - d}`} transform="rotate(-90 50 50)" />}
      <text x="50" y="52" textAnchor="middle" style={{ font: "600 20px var(--display)", fill: "var(--ink)" }}>{label}</text>
      <text x="50" y="66" textAnchor="middle" style={{ font: "500 8.5px var(--body)", fill: "var(--ink-faint)" }}>{sub}</text>
    </svg>
  );
}

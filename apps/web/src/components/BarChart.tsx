import { useState } from 'react';

interface Point {
  label: string;
  value: number;
}

/**
 * Single-series magnitude bar chart (SVG): one hue, thin rounded marks anchored
 * to the baseline, recessive grid, per-bar hover tooltip. One measure per chart —
 * never dual-axis.
 */
export function BarChart({ points, unit = '' }: { points: Point[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const PAD = { top: 16, bottom: 22, left: 8, right: 8 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const gap = 2;
  const barW = Math.max(2, innerW / Math.max(1, points.length) - gap);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No data yet for this window.</p>;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bar chart">
        {/* recessive gridlines at 0 / 50 / 100% */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + innerH * (1 - f)}
            y2={PAD.top + innerH * (1 - f)}
            stroke="currentColor"
            className="text-surface-2"
            strokeWidth={1}
          />
        ))}
        {points.map((p, i) => {
          const h = Math.max(2, (p.value / max) * innerH);
          const x = PAD.left + i * (barW + gap);
          const y = PAD.top + innerH - h;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* oversized hit target */}
              <rect x={x - gap / 2} y={PAD.top} width={barW + gap} height={innerH} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                className={hover === i ? 'fill-accent-soft' : 'fill-accent'}
              />
            </g>
          );
        })}
        {/* sparse x labels: first, middle, last */}
        {[0, Math.floor(points.length / 2), points.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={PAD.left + i * (barW + gap) + barW / 2}
              y={H - 6}
              textAnchor="middle"
              className="fill-current text-[10px] text-ink-muted"
            >
              {points[i]!.label}
            </text>
          ))}
      </svg>
      {hover !== null && points[hover] && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md border border-surface-2 bg-surface-0 px-2.5 py-1 text-xs shadow-lg"
          style={{ left: `${((hover + 0.5) / points.length) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <span className="text-ink-muted">{points[hover].label}: </span>
          <span className="font-semibold tabular-nums">
            {points[hover].value.toLocaleString()}
            {unit}
          </span>
        </div>
      )}
    </div>
  );
}

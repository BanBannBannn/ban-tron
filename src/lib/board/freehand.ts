import { getStroke } from "perfect-freehand";

/** Chuyển polygon outline của perfect-freehand thành SVG path mượt (quadratic). */
function svgPathFromStroke(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";
  const avg = (a: number, b: number) => (a + b) / 2;
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(
    b[0],
    c[0],
  ).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }
  return d + "Z";
}

export function inkPath(
  points: number[][],
  size: number,
  opts: { pressure?: boolean; highlighter?: boolean; last?: boolean } = {},
): string {
  if (!points.length) return "";
  if (points.length === 1) {
    // chấm tròn
    const [x, y] = points[0];
    const r = size / 2;
    return `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
  }
  const outline = getStroke(points, {
    size,
    thinning: opts.highlighter ? 0 : opts.pressure ? 0.6 : 0.5,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !opts.pressure && !opts.highlighter,
    last: opts.last ?? true,
    start: { taper: opts.highlighter ? 0 : 0, cap: true },
    end: { taper: 0, cap: true },
  });
  return svgPathFromStroke(outline);
}

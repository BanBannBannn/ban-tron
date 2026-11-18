import type { BoardElement, Camera, Rect } from "./types";

export function elementBounds(el: BoardElement): Rect {
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

export function unionBounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function screenToWorld(cam: Camera, sx: number, sy: number) {
  return { x: sx / cam.z + cam.x, y: sy / cam.z + cam.y };
}

export function worldToScreen(cam: Camera, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.z, y: (wy - cam.y) * cam.z };
}

/** Khoảng cách từ điểm P đến đoạn AB. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Kiểm tra chạm hình học (dùng cho tẩy & chọn chính xác). */
export function hitTest(el: BoardElement, px: number, py: number, radius: number): boolean {
  const b = el;
  if (px < b.x - radius || px > b.x + b.w + radius || py < b.y - radius || py > b.y + b.h + radius) {
    return false;
  }
  if (el.type === "ink") {
    const sx = el.w / (el.ow || 1);
    const sy = el.h / (el.oh || 1);
    const r = radius + (el.size * Math.max(sx, sy)) / 2;
    const pts = el.points;
    if (pts.length === 1) return Math.hypot(px - (el.x + pts[0][0] * sx), py - (el.y + pts[0][1] * sy)) <= r;
    for (let i = 1; i < pts.length; i++) {
      const d = distToSegment(
        px,
        py,
        el.x + pts[i - 1][0] * sx,
        el.y + pts[i - 1][1] * sy,
        el.x + pts[i][0] * sx,
        el.y + pts[i][1] * sy,
      );
      if (d <= r) return true;
    }
    return false;
  }
  if (el.type === "line") {
    const [a, c] = el.points;
    return distToSegment(px, py, el.x + a[0], el.y + a[1], el.x + c[0], el.y + c[1]) <= radius + el.strokeWidth;
  }
  // hình rỗng (không nền, không chữ): chỉ chạm khi trúng đường viền
  if (el.type === "shape" && el.fill === "none" && !el.text) {
    const poly = shapeOutline(el.shape, el.x, el.y, el.w, el.h);
    const r = radius + el.strokeWidth / 2;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      if (distToSegment(px, py, ax, ay, bx, by) <= r) return true;
    }
    return false;
  }
  return true;
}

function shapeOutline(shape: string, x: number, y: number, w: number, h: number): [number, number][] {
  switch (shape) {
    case "ellipse": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        pts.push([x + w / 2 + (Math.cos(t) * w) / 2, y + h / 2 + (Math.sin(t) * h) / 2]);
      }
      return pts;
    }
    case "diamond":
      return [
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2],
      ];
    case "triangle":
      return [
        [x + w / 2, y],
        [x + w, y + h],
        [x, y + h],
      ];
    default:
      return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
  }
}

/** Bounds cho đoạn thẳng từ 2 điểm tuyệt đối, có padding. */
export function lineFromPoints(x1: number, y1: number, x2: number, y2: number, pad = 0) {
  const x = Math.min(x1, x2) - pad;
  const y = Math.min(y1, y2) - pad;
  return {
    x,
    y,
    w: Math.abs(x2 - x1) + pad * 2,
    h: Math.abs(y2 - y1) + pad * 2,
    points: [
      [x1 - x, y1 - y],
      [x2 - x, y2 - y],
    ] as [number, number][],
  };
}

/** Khoá góc đường thẳng theo bội số 15° khi giữ Shift. */
export function snapAngle(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: x1 + Math.cos(ang) * len, y: y1 + Math.sin(ang) * len };
}

import type { BoardElement, DrawStyle, InkEl, Rect } from "./types";
import { uid } from "../utils";

/** Tạo nét vẽ tay từ các điểm toạ độ thế giới. */
export function makeInk(
  id: string,
  pts: number[][],
  opts: { color: string; size: number; highlighter?: boolean; pressure?: boolean; z: number },
): InkEl {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = opts.size;
  const x = minX - pad;
  const y = minY - pad;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  return {
    id,
    type: "ink",
    x,
    y,
    w,
    h,
    ow: w,
    oh: h,
    z: opts.z,
    color: opts.color,
    size: opts.size,
    highlighter: opts.highlighter || undefined,
    pressure: opts.pressure || undefined,
    points: pts.map((p) => [round(p[0] - x), round(p[1] - y), round(p[2] ?? 0.5, 100)]),
  };
}

function round(v: number, k = 10) {
  return Math.round(v * k) / k;
}

/** Nhân bản (đổi id) – dùng cho Ctrl+D, Alt+kéo, dán. */
export function cloneElements(els: BoardElement[], dx: number, dy: number, zStart: number): BoardElement[] {
  const sorted = [...els].sort((a, b) => a.z - b.z);
  return sorted.map((el, i) => ({ ...el, id: uid(), x: el.x + dx, y: el.y + dy, z: zStart + i, locked: undefined }));
}

/** Co giãn một phần tử từ khung cũ b0 sang khung mới (x1,y1,sx,sy). */
export function scaleElement(o: BoardElement, b0: Rect, x1: number, y1: number, sx: number, sy: number): BoardElement {
  const nx = x1 + (o.x - b0.x) * sx;
  const ny = y1 + (o.y - b0.y) * sy;
  const nw = Math.max(1, o.w * sx);
  const nh = Math.max(1, o.h * sy);
  switch (o.type) {
    case "text":
      return { ...o, x: nx, y: ny, w: Math.max(40, nw), autoW: false };
    case "table":
      return { ...o, x: nx, y: ny, w: Math.max(160, nw) };
    case "note": {
      const minH = Math.max(60, o.minH * sy);
      return { ...o, x: nx, y: ny, w: Math.max(80, nw), minH, h: Math.max(o.h * sy, minH) };
    }
    case "line":
      return {
        ...o,
        x: nx,
        y: ny,
        w: o.w * sx,
        h: o.h * sy,
        points: o.points.map(([px, py]) => [px * sx, py * sy]) as [number, number][],
      };
    default:
      return { ...o, x: nx, y: ny, w: nw, h: nh };
  }
}

/** Áp thay đổi style từ thanh thuộc tính lên phần tử phù hợp. */
export function applyStyleTo(el: BoardElement, patch: Partial<DrawStyle>): BoardElement {
  const n = { ...el } as BoardElement;
  switch (n.type) {
    case "ink":
      if (patch.stroke && !n.highlighter) n.color = patch.stroke;
      if (patch.hlColor && n.highlighter) n.color = patch.hlColor;
      if (patch.penSize) {
        n.size = n.highlighter ? patch.penSize * 3 : patch.penSize;
      }
      break;
    case "shape":
      if (patch.stroke) n.stroke = patch.stroke;
      if (patch.fill) n.fill = patch.fill;
      if (patch.strokeWidth) n.strokeWidth = patch.strokeWidth;
      if (patch.dash) n.dash = patch.dash;
      if (patch.shape) n.shape = patch.shape;
      if (patch.fontSize) n.fontSize = patch.fontSize;
      if (patch.textColor) n.textColor = patch.textColor;
      break;
    case "line":
      if (patch.stroke) n.stroke = patch.stroke;
      if (patch.strokeWidth) n.strokeWidth = patch.strokeWidth;
      if (patch.dash) n.dash = patch.dash;
      if (patch.arrowEnd !== undefined) n.arrowEnd = patch.arrowEnd;
      if (patch.arrowStart !== undefined) n.arrowStart = patch.arrowStart;
      break;
    case "text":
      if (patch.textColor) n.color = patch.textColor;
      if (patch.fontSize) n.fontSize = patch.fontSize;
      break;
    case "note":
      if (patch.noteBg) n.bg = patch.noteBg;
      if (patch.fontSize) n.fontSize = patch.fontSize;
      break;
    case "table":
      if (patch.fontSize) n.fontSize = patch.fontSize;
      if (patch.stroke) n.accent = patch.stroke;
      break;
  }
  return n;
}

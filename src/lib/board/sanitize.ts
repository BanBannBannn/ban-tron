/**
 * Làm sạch dữ liệu KHÔNG ĐÁNG TIN (từ DB hoặc broadcast của người khác) trước khi render.
 *
 * Mối đe doạ: một thành viên xấu có thể ghi bất kỳ JSON nào vào phần tử, ví dụ:
 *  - màu "url(https://evil/x)" → trình duyệt người xem gọi ra ngoài (lộ IP, theo dõi)
 *  - thuộc tính class/style trong rich text → phủ giao diện giả lên toàn màn hình
 *  - link javascript:, ảnh trỏ ra domain lạ, toạ độ khổng lồ / NaN
 * Nguyên tắc: chỉ giữ lại những gì nằm trong danh sách cho phép.
 */
import type { JSONContent } from "@tiptap/core";
import type { BoardElement, Dash, ElementType, ShapeKind } from "./types";

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set<ElementType>(["ink", "shape", "line", "text", "note", "table", "image"]);
const SHAPES = new Set<ShapeKind>(["rect", "ellipse", "diamond", "triangle"]);
const DASHES = new Set<Dash>(["solid", "dashed", "dotted"]);
const COORD = 1e6;
const SIZE = 1e5;

export function safeColor(v: unknown, fallback: string): string {
  return typeof v === "string" && COLOR_RE.test(v) ? v : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Chỉ chấp nhận ảnh nằm trong bucket Storage của chính project. */
export function safeImageSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  const prefix = `${base.replace(/\/$/, "")}/storage/v1/object/public/board-images/`;
  if (!v.startsWith(prefix)) return null;
  const rest = v.slice(prefix.length);
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|png|jpe?g|gif)$/i.test(rest) ? v : null;
}

export function safeHref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

// ───────────── rich text ─────────────

const NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const MARK_TYPES = new Set(["bold", "italic", "underline", "strike", "code", "link", "textStyle", "highlight"]);
const ALIGN = new Set(["left", "center", "right", "justify"]);
const MAX_DEPTH = 40;
const MAX_NODES = 20_000;

function cleanMark(m: unknown): { type: string; attrs?: Record<string, unknown> } | null {
  if (!m || typeof m !== "object") return null;
  const { type, attrs } = m as { type?: unknown; attrs?: Record<string, unknown> };
  if (typeof type !== "string" || !MARK_TYPES.has(type)) return null;
  const a = attrs && typeof attrs === "object" ? attrs : {};
  switch (type) {
    case "link": {
      const href = safeHref(a.href);
      return href ? { type, attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } } : null;
    }
    case "textStyle": {
      const color = typeof a.color === "string" && COLOR_RE.test(a.color) ? a.color : null;
      return color ? { type, attrs: { color } } : null;
    }
    case "highlight": {
      const color = typeof a.color === "string" && COLOR_RE.test(a.color) ? a.color : null;
      return { type, attrs: { color } };
    }
    default:
      return { type };
  }
}

function cleanNodeAttrs(type: string, a: Record<string, unknown>): Record<string, unknown> | undefined {
  switch (type) {
    case "paragraph":
      return ALIGN.has(a.textAlign as string) ? { textAlign: a.textAlign } : undefined;
    case "heading":
      return {
        level: [1, 2, 3].includes(a.level as number) ? a.level : 1,
        ...(ALIGN.has(a.textAlign as string) ? { textAlign: a.textAlign } : {}),
      };
    case "orderedList":
      return { start: num(a.start, 1, 0, 100000) };
    case "taskItem":
      return { checked: a.checked === true };
    case "codeBlock":
      return typeof a.language === "string" && /^[a-z0-9+#-]{1,20}$/i.test(a.language)
        ? { language: a.language }
        : undefined;
    case "tableCell":
    case "tableHeader": {
      const colwidth = Array.isArray(a.colwidth)
        ? a.colwidth.slice(0, 50).map((w) => num(w, 100, 20, 2000))
        : null;
      return { colspan: num(a.colspan, 1, 1, 50), rowspan: num(a.rowspan, 1, 1, 50), colwidth };
    }
    default:
      return undefined;
  }
}

export function sanitizeDoc(doc: unknown): JSONContent {
  let count = 0;
  const walk = (n: unknown, depth: number): JSONContent | null => {
    if (!n || typeof n !== "object" || depth > MAX_DEPTH || ++count > MAX_NODES) return null;
    const node = n as JSONContent;
    if (typeof node.type !== "string" || !NODE_TYPES.has(node.type)) return null;
    if (node.type === "text") {
      const text = str(node.text, 20000);
      if (!text) return null;
      const marks = Array.isArray(node.marks) ? (node.marks.map(cleanMark).filter(Boolean) as JSONContent["marks"]) : [];
      return marks && marks.length ? { type: "text", text, marks } : { type: "text", text };
    }
    const out: JSONContent = { type: node.type };
    const attrs = cleanNodeAttrs(node.type, (node.attrs as Record<string, unknown>) ?? {});
    if (attrs) out.attrs = attrs;
    if (Array.isArray(node.content)) {
      const content = node.content.map((c) => walk(c, depth + 1)).filter(Boolean) as JSONContent[];
      if (content.length) out.content = content;
    }
    return out;
  };
  const cleaned = walk(doc, 0);
  return cleaned && cleaned.type === "doc" ? cleaned : { type: "doc", content: [{ type: "paragraph" }] };
}

// ───────────── phần tử ─────────────

function points(v: unknown, max: number): number[][] {
  if (!Array.isArray(v)) return [];
  const out: number[][] = [];
  for (const p of v.slice(0, max)) {
    if (!Array.isArray(p)) continue;
    const x = num(p[0], Number.NaN, -SIZE, SIZE);
    const y = num(p[1], Number.NaN, -SIZE, SIZE);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([x, y, num(p[2], 0.5, 0, 1)]);
  }
  return out;
}

/** Trả về phần tử hợp lệ, hoặc null nếu dữ liệu không dùng được. */
export function sanitizeElement(raw: unknown): BoardElement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID_RE.test(r.id)) return null;
  if (!TYPES.has(r.type as ElementType)) return null;
  const base = {
    id: r.id,
    x: num(r.x, 0, -COORD, COORD),
    y: num(r.y, 0, -COORD, COORD),
    w: num(r.w, 1, 0, SIZE),
    h: num(r.h, 1, 0, SIZE),
    z: num(r.z, 0, -1e12, 1e12),
    locked: r.locked === true ? true : undefined,
  };
  switch (r.type as ElementType) {
    case "ink": {
      const pts = points(r.points, 20000);
      if (!pts.length) return null;
      return {
        ...base,
        type: "ink",
        points: pts,
        ow: num(r.ow, base.w || 1, 0.01, SIZE),
        oh: num(r.oh, base.h || 1, 0.01, SIZE),
        color: safeColor(r.color, "#1e1e1e"),
        size: num(r.size, 4, 0.5, 200),
        highlighter: r.highlighter === true || undefined,
        pressure: r.pressure === true || undefined,
      };
    }
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: SHAPES.has(r.shape as ShapeKind) ? (r.shape as ShapeKind) : "rect",
        stroke: safeColor(r.stroke, "#1e1e1e"),
        fill: r.fill === "none" ? "none" : safeColor(r.fill, "none"),
        strokeWidth: num(r.strokeWidth, 2, 0.5, 64),
        dash: DASHES.has(r.dash as Dash) ? (r.dash as Dash) : "solid",
        text: str(r.text, 2000) || undefined,
        fontSize: num(r.fontSize, 18, 8, 200),
        textColor: typeof r.textColor === "string" && COLOR_RE.test(r.textColor) ? r.textColor : undefined,
      };
    case "line": {
      const pts = points(r.points, 2);
      if (pts.length !== 2) return null;
      return {
        ...base,
        type: "line",
        points: pts.map(([x, y]) => [x, y]) as [number, number][],
        stroke: safeColor(r.stroke, "#1e1e1e"),
        strokeWidth: num(r.strokeWidth, 2, 0.5, 64),
        dash: DASHES.has(r.dash as Dash) ? (r.dash as Dash) : "solid",
        arrowStart: r.arrowStart === true || undefined,
        arrowEnd: r.arrowEnd === true || undefined,
      };
    }
    case "text":
      return {
        ...base,
        type: "text",
        doc: sanitizeDoc(r.doc),
        color: safeColor(r.color, "#1e1e1e"),
        fontSize: num(r.fontSize, 18, 8, 200),
        autoW: r.autoW === true || undefined,
      };
    case "note":
      return {
        ...base,
        type: "note",
        doc: sanitizeDoc(r.doc),
        bg: safeColor(r.bg, "#fff3bf"),
        fontSize: num(r.fontSize, 18, 8, 200),
        minH: num(r.minH, 200, 20, SIZE),
      };
    case "table":
      return {
        ...base,
        type: "table",
        doc: sanitizeDoc(r.doc),
        fontSize: num(r.fontSize, 15, 8, 200),
        accent: safeColor(r.accent, "#3b5bdb"),
      };
    case "image": {
      const src = safeImageSrc(r.src);
      if (!src) return null;
      return { ...base, type: "image", src, ratio: num(r.ratio, 1, 0.01, 100) };
    }
  }
}

export function sanitizeElements(list: unknown): BoardElement[] {
  if (!Array.isArray(list)) return [];
  const out: BoardElement[] = [];
  for (const raw of list.slice(0, 5000)) {
    const el = sanitizeElement(raw);
    if (el) out.push(el);
  }
  return out;
}

export function sanitizeIds(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, 5000);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Tên / màu hiển thị từ presence hoặc tin nhắn. */
export function safeName(v: unknown, fallback = "Ẩn danh"): string {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  return Array.from(s).slice(0, 40).join("") || fallback;
}

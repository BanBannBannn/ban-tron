import type { JSONContent } from "@tiptap/core";
import type { DrawStyle } from "./types";

export const STROKE_COLORS = [
  "#1e1e1e",
  "#868e96",
  "#e03131",
  "#f08c00",
  "#2f9e44",
  "#0c8599",
  "#1971c2",
  "#6741d9",
  "#c2255c",
  "#ffffff",
];

export const FILL_COLORS = [
  "none",
  "#ffc9c9",
  "#ffec99",
  "#b2f2bb",
  "#a5d8ff",
  "#d0bfff",
  "#fcc2d7",
  "#e9ecef",
  "#1e1e1e",
];

export const NOTE_COLORS = [
  "#fff3bf",
  "#ffe8cc",
  "#ffdeeb",
  "#e5dbff",
  "#d0ebff",
  "#d3f9d8",
  "#f1f3f5",
];

export const HIGHLIGHT_COLORS = ["#fff3bf", "#ffd8a8", "#ffc9c9", "#d3f9d8", "#d0ebff", "#e5dbff"];

export const PEN_SIZES = [2, 4, 8, 14];
export const STROKE_WIDTHS = [1, 2, 4, 8];
export const FONT_SIZES = [
  { label: "S", value: 14 },
  { label: "M", value: 18 },
  { label: "L", value: 26 },
  { label: "XL", value: 40 },
];

export const HL_COLORS = ["#ffd43b", "#ffa94d", "#ff8787", "#69db7c", "#74c0fc", "#b197fc"];

export const DEFAULT_STYLE: DrawStyle = {
  stroke: "#1e1e1e",
  hlColor: "#ffd43b",
  fill: "none",
  strokeWidth: 2,
  penSize: 4,
  dash: "solid",
  shape: "rect",
  fontSize: 18,
  noteBg: "#fff3bf",
  textColor: "#1e1e1e",
  arrowEnd: true,
  arrowStart: false,
};

export const emptyDoc = (): JSONContent => ({ type: "doc", content: [{ type: "paragraph" }] });

export function tableDoc(rows = 3, cols = 3): JSONContent {
  const cell = (header: boolean, text = ""): JSONContent => ({
    type: header ? "tableHeader" : "tableCell",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
  });
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: Array.from({ length: rows }, (_, r) => ({
          type: "tableRow",
          content: Array.from({ length: cols }, (_, c) =>
            cell(r === 0, r === 0 ? `Cột ${c + 1}` : ""),
          ),
        })),
      },
    ],
  };
}

export function textDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : undefined,
    })),
  };
}

/** Doc rỗng = chỉ toàn đoạn văn trống. */
export function isDocEmpty(doc: JSONContent | undefined): boolean {
  if (!doc) return true;
  const walk = (n: JSONContent): boolean => {
    if (n.type === "text") return !(n.text ?? "").trim();
    if (n.type && !["doc", "paragraph", "heading", "hardBreak"].includes(n.type)) return false;
    return (n.content ?? []).every(walk);
  };
  return walk(doc);
}

/** Màu chữ tương phản cho nền. */
export function readableOn(hex: string) {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "#1e1e1e";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#1e1e1e" : "#ffffff";
}

import type { JSONContent } from "@tiptap/core";
import { sanitizeElement } from "./sanitize";

export type ElementType = "ink" | "shape" | "line" | "text" | "note" | "table" | "image";
export type ShapeKind = "rect" | "ellipse" | "diamond" | "triangle";
export type Dash = "solid" | "dashed" | "dotted";

interface Base {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  locked?: boolean;
}

export interface InkEl extends Base {
  type: "ink";
  /** điểm [x, y, pressure] trong hệ toạ độ gốc ow × oh */
  points: number[][];
  ow: number;
  oh: number;
  color: string;
  size: number;
  highlighter?: boolean;
  /** true nếu có áp lực thật từ bút cảm ứng */
  pressure?: boolean;
}

export interface ShapeEl extends Base {
  type: "shape";
  shape: ShapeKind;
  stroke: string;
  fill: string; // "none" hoặc màu
  strokeWidth: number;
  dash: Dash;
  text?: string;
  fontSize: number;
  textColor?: string;
}

export interface LineEl extends Base {
  type: "line";
  /** 2 điểm, tương đối với (x, y) */
  points: [number, number][];
  stroke: string;
  strokeWidth: number;
  dash: Dash;
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export interface TextEl extends Base {
  type: "text";
  doc: JSONContent;
  color: string;
  fontSize: number;
  /** true: chiều rộng tự co giãn theo nội dung (chưa resize tay) */
  autoW?: boolean;
}

export interface NoteEl extends Base {
  type: "note";
  doc: JSONContent;
  bg: string;
  fontSize: number;
  /** chiều cao tối thiểu do người dùng kéo; h là chiều cao thực đo được */
  minH: number;
}

export interface TableEl extends Base {
  type: "table";
  doc: JSONContent;
  fontSize: number;
  accent: string;
}

export interface ImageEl extends Base {
  type: "image";
  src: string;
  /** tỉ lệ gốc w/h */
  ratio: number;
}

export type BoardElement = InkEl | ShapeEl | LineEl | TextEl | NoteEl | TableEl | ImageEl;

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "highlighter"
  | "eraser"
  | "shape"
  | "line"
  | "arrow"
  | "text"
  | "note"
  | "table"
  | "image"
  | "laser";

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawStyle {
  stroke: string;
  hlColor: string;
  fill: string;
  strokeWidth: number;
  penSize: number;
  dash: Dash;
  shape: ShapeKind;
  fontSize: number;
  noteBg: string;
  textColor: string;
  arrowEnd: boolean;
  arrowStart: boolean;
}

/** Dữ liệu lưu trong DB: mọi thứ trừ id/type/z nằm trong `data`. */
export interface ElementRow {
  id: string;
  room_id: string;
  type: ElementType;
  data: Record<string, unknown>;
  z: number;
}

export function toRow(el: BoardElement, roomId: string): ElementRow {
  const { id, type, z, ...data } = el;
  return { id, room_id: roomId, type, z, data: data as Record<string, unknown> };
}

/** Dữ liệu từ DB là không đáng tin → luôn đi qua sanitizeElement. */
export function fromRow(row: ElementRow): BoardElement | null {
  return sanitizeElement({ ...(row.data as object), id: row.id, type: row.type, z: row.z });
}

export const isRichText = (el: BoardElement): el is TextEl | NoteEl | TableEl =>
  el.type === "text" || el.type === "note" || el.type === "table";

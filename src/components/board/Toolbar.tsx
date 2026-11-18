"use client";

import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Highlighter,
  ImagePlus,
  MousePointer2,
  PenLine,
  Slash,
  Square,
  StickyNote,
  Table2,
  Triangle,
  Type,
  WandSparkles,
} from "lucide-react";
import type { ShapeKind, Tool } from "@/lib/board/types";
import { IconButton } from "../ui/primitives";
import { cn } from "@/lib/utils";

const SHAPE_ICON: Record<ShapeKind, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  diamond: Diamond,
  triangle: Triangle,
};

export const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  p: "pen",
  m: "highlighter",
  e: "eraser",
  r: "shape",
  o: "shape",
  d: "shape",
  l: "line",
  a: "arrow",
  t: "text",
  n: "note",
  b: "table",
  i: "image",
  k: "laser",
};

export function Toolbar({
  tool,
  shape,
  onTool,
  className,
}: {
  tool: Tool;
  shape: ShapeKind;
  onTool: (t: Tool) => void;
  className?: string;
}) {
  const ShapeIcon = SHAPE_ICON[shape];
  const items: Array<{ t: Tool; icon: React.ReactNode; tip: string } | "sep"> = [
    { t: "select", icon: <MousePointer2 size={18} />, tip: "Chọn · V" },
    { t: "hand", icon: <Hand size={18} />, tip: "Kéo bảng · H / giữ Space" },
    "sep",
    { t: "pen", icon: <PenLine size={18} />, tip: "Bút vẽ · P" },
    { t: "highlighter", icon: <Highlighter size={18} />, tip: "Bút dạ quang · M" },
    { t: "eraser", icon: <Eraser size={18} />, tip: "Tẩy · E" },
    "sep",
    { t: "shape", icon: <ShapeIcon size={18} />, tip: "Hình khối · R / O / D" },
    { t: "line", icon: <Slash size={18} />, tip: "Đường thẳng · L" },
    { t: "arrow", icon: <ArrowUpRight size={18} />, tip: "Mũi tên · A" },
    "sep",
    { t: "text", icon: <Type size={18} />, tip: "Chữ · T" },
    { t: "note", icon: <StickyNote size={18} />, tip: "Ghi chú dán · N" },
    { t: "table", icon: <Table2 size={18} />, tip: "Bảng biểu · B" },
    { t: "image", icon: <ImagePlus size={18} />, tip: "Chèn ảnh · I" },
    { t: "laser", icon: <WandSparkles size={18} />, tip: "Bút laser · K" },
  ];
  return (
    <div
      data-ui
      className={cn(
        "island flex max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-x-auto p-1 no-scrollbar",
        className,
      )}
    >
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="mx-0.5 h-6 w-px shrink-0 bg-line" />
        ) : (
          <IconButton key={it.t} tip={it.tip} active={tool === it.t} onClick={() => onTool(it.t)} tipSide="bottom">
            {it.icon}
          </IconButton>
        ),
      )}
    </div>
  );
}

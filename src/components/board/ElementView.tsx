"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { BoardElement, Dash, InkEl, LineEl, ShapeEl } from "@/lib/board/types";
import { inkPath } from "@/lib/board/freehand";
import { docToHtml } from "@/lib/board/richtext";
import type { BoardStore } from "@/lib/board/store";
import type { CameraStore } from "@/lib/board/camera";
import { readableOn } from "@/lib/board/defaults";
import { RichEditor } from "./RichEditor";
import { ShapeLabelEditor } from "./ShapeLabelEditor";

interface Props {
  el: BoardElement;
  editing: boolean;
  dim: boolean;
  store: BoardStore;
  cam: CameraStore;
  onExitEdit: () => void;
  takeTyped?: () => string;
}

export function dashArray(dash: Dash, sw: number) {
  if (dash === "dashed") return `${sw * 4} ${sw * 3}`;
  if (dash === "dotted") return `0 ${sw * 2.4}`;
  return undefined;
}

function ElementViewImpl({ el, editing, dim, store, cam, onExitEdit, takeTyped }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const measure = el.type === "text" || el.type === "note" || el.type === "table";
  const autoW = el.type === "text" && !!el.autoW;

  // Đo kích thước thật của khối chữ/ghi chú/bảng để khung chọn & tẩy chính xác.
  useLayoutEffect(() => {
    if (!measure || !ref.current) return;
    const node = ref.current;
    const check = () => {
      const cur = store.get(el.id);
      if (!cur) return;
      const h = node.offsetHeight;
      const w = node.offsetWidth;
      const needH = Math.abs(cur.h - h) > 0.5;
      const needW = autoW && Math.abs(cur.w - w) > 0.5;
      if (needH || needW) {
        store.patchLocal({ ...cur, h, ...(autoW ? { w } : {}) } as BoardElement);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, [measure, autoW, el.id, store]);

  const base: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: autoW ? "max-content" : el.w,
    height: measure ? undefined : el.h,
    opacity: dim ? 0.2 : 1,
    zIndex: editing ? 40 : undefined,
  };

  switch (el.type) {
    case "ink":
      return (
        <div data-el={el.id} style={{ ...base, pointerEvents: "none" }}>
          <InkSvg el={el} />
        </div>
      );
    case "shape":
      return (
        <div data-el={el.id} data-editing={editing || undefined} style={base} className="cursor-default">
          <ShapeSvg el={el} />
          {editing ? (
            <ShapeLabelEditor el={el} store={store} onExit={onExitEdit} takeTyped={takeTyped} />
          ) : el.text ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden p-3 text-center leading-snug break-words whitespace-pre-wrap"
              style={{ fontSize: el.fontSize, color: el.textColor ?? labelColor(el) }}
            >
              {el.text}
            </div>
          ) : null}
        </div>
      );
    case "line":
      return (
        <div data-el={el.id} style={{ ...base, pointerEvents: "none" }}>
          <LineSvg el={el} />
        </div>
      );
    case "image":
      return (
        <div data-el={el.id} style={base} className="overflow-hidden rounded-md shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={el.src}
            alt=""
            draggable={false}
            crossOrigin="anonymous"
            className="pointer-events-none h-full w-full select-none object-fill"
          />
        </div>
      );
    case "text":
    case "note":
    case "table": {
      const style: React.CSSProperties = {
        ...base,
        minHeight: el.type === "note" ? el.minH : undefined,
        fontSize: el.fontSize,
        minWidth: autoW ? 24 : undefined,
      };
      let cls = "rt";
      if (el.type === "text") {
        style.color = el.color;
        cls += " rt-text";
      } else if (el.type === "note") {
        style.background = el.bg;
        style.color = readableOn(el.bg);
        cls += " rt-note";
      } else {
        (style as Record<string, unknown>)["--accent"] = el.accent;
        cls += " rt-table";
      }
      return (
        <div
          ref={ref}
          data-el={el.id}
          data-editing={editing || undefined}
          className={cls}
          style={style}
        >
          {editing ? (
            <RichEditor
              el={el}
              store={store}
              cam={cam}
              onExit={onExitEdit}
              takeTyped={takeTyped}
              placeholder={el.type === "table" ? "" : el.type === "note" ? "Ghi chú…" : "Nhập chữ…"}
            />
          ) : (
            <div className="rt-content" dangerouslySetInnerHTML={{ __html: docToHtml(el.doc) }} />
          )}
        </div>
      );
    }
  }
}

export const ElementView = memo(ElementViewImpl);

function labelColor(el: ShapeEl) {
  if (el.fill !== "none") return readableOn(el.fill);
  return el.stroke === "#ffffff" ? "#1e1e1e" : el.stroke;
}

export function InkSvg({ el, live }: { el: InkEl; live?: boolean }) {
  const d = useMemo(
    () => inkPath(el.points, el.size, { pressure: el.pressure, highlighter: el.highlighter, last: !live }),
    [el.points, el.size, el.pressure, el.highlighter, live],
  );
  return (
    <svg
      width={el.w}
      height={el.h}
      viewBox={`0 0 ${el.ow} ${el.oh}`}
      preserveAspectRatio="none"
      className="overflow-visible"
      style={{ mixBlendMode: el.highlighter ? "multiply" : undefined }}
    >
      <path
        d={d}
        fill={el.color}
        opacity={el.highlighter ? 0.45 : 1}
        stroke="transparent"
        strokeWidth={Math.max(10, el.size)}
        strokeLinejoin="round"
        style={{ pointerEvents: live ? "none" : "visiblePainted" }}
        data-el={live ? undefined : el.id}
      />
    </svg>
  );
}

export function ShapeSvg({ el }: { el: ShapeEl }) {
  const sw = el.strokeWidth;
  const w = Math.max(1, el.w);
  const h = Math.max(1, el.h);
  const p = sw / 2;
  const common = {
    fill: el.fill === "none" ? "transparent" : el.fill,
    stroke: el.stroke,
    strokeWidth: sw,
    strokeDasharray: dashArray(el.dash, sw),
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let shape: React.ReactNode;
  switch (el.shape) {
    case "rect":
      shape = (
        <rect
          x={p}
          y={p}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          rx={Math.min(14, w / 6, h / 6)}
          {...common}
        />
      );
      break;
    case "ellipse":
      shape = (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - p)} ry={Math.max(0, h / 2 - p)} {...common} />
      );
      break;
    case "diamond":
      shape = <polygon points={`${w / 2},${p} ${w - p},${h / 2} ${w / 2},${h - p} ${p},${h / 2}`} {...common} />;
      break;
    case "triangle":
      shape = <polygon points={`${w / 2},${p} ${w - p},${h - p} ${p},${h - p}`} {...common} />;
      break;
  }
  return (
    <svg width={w} height={h} className="absolute inset-0 overflow-visible">
      {shape}
    </svg>
  );
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, sw: number) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(12, sw * 4.5);
  const spread = Math.PI / 7;
  const a = { x: x2 - len * Math.cos(ang - spread), y: y2 - len * Math.sin(ang - spread) };
  const b = { x: x2 - len * Math.cos(ang + spread), y: y2 - len * Math.sin(ang + spread) };
  return `M${a.x},${a.y} L${x2},${y2} L${b.x},${b.y}`;
}

export function LineSvg({ el, live }: { el: LineEl; live?: boolean }) {
  const [[x1, y1], [x2, y2]] = el.points;
  const sw = el.strokeWidth;
  return (
    <svg width={Math.max(1, el.w)} height={Math.max(1, el.h)} className="absolute inset-0 overflow-visible">
      <g
        stroke={el.stroke}
        strokeWidth={sw}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: "none" }}
      >
        <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={dashArray(el.dash, sw)} />
        {el.arrowEnd && <path d={arrowHead(x1, y1, x2, y2, sw)} />}
        {el.arrowStart && <path d={arrowHead(x2, y2, x1, y1, sw)} />}
      </g>
      {!live && (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={Math.max(14, sw + 10)}
          strokeLinecap="round"
          style={{ pointerEvents: "stroke" }}
          data-el={el.id}
        />
      )}
    </svg>
  );
}

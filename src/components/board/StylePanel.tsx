"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BringToFront,
  Circle,
  Copy,
  Diamond,
  Lock,
  LockOpen,
  SendToBack,
  SlidersHorizontal,
  Square,
  Trash2,
  Triangle,
  X,
} from "lucide-react";
import type { BoardElement, Dash, DrawStyle, ElementType, ShapeKind, Tool } from "@/lib/board/types";
import {
  FILL_COLORS,
  FONT_SIZES,
  HL_COLORS,
  NOTE_COLORS,
  PEN_SIZES,
  STROKE_COLORS,
  STROKE_WIDTHS,
} from "@/lib/board/defaults";
import { IconButton, Swatch } from "../ui/primitives";
import { cn } from "@/lib/utils";

type Ctx = ElementType | "highlight";

const TOOL_CTX: Partial<Record<Tool, Ctx>> = {
  pen: "ink",
  highlighter: "highlight",
  shape: "shape",
  line: "line",
  arrow: "line",
  text: "text",
  note: "note",
  table: "table",
};

export interface PanelActions {
  front: () => void;
  back: () => void;
  duplicate: () => void;
  remove: () => void;
  toggleLock: () => void;
}

export function StylePanel({
  tool,
  style,
  selection,
  onStyle,
  actions,
}: {
  tool: Tool;
  style: DrawStyle;
  selection: BoardElement[];
  onStyle: (patch: Partial<DrawStyle>) => void;
  actions: PanelActions;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const ctxs = new Set<Ctx>();
  if (selection.length) {
    for (const el of selection) ctxs.add(el.type === "ink" && el.highlighter ? "highlight" : el.type);
  } else {
    const c = TOOL_CTX[tool];
    if (c) ctxs.add(c);
  }
  if (!ctxs.size && !selection.length) return null;

  const first = <T extends BoardElement["type"]>(t: T) =>
    selection.find((e) => e.type === t) as Extract<BoardElement, { type: T }> | undefined;
  const ink = selection.find((e) => e.type === "ink" && !e.highlighter) as Extract<BoardElement, { type: "ink" }> | undefined;
  const hl = selection.find((e) => e.type === "ink" && e.highlighter) as Extract<BoardElement, { type: "ink" }> | undefined;
  const shape = first("shape");
  const line = first("line");
  const text = first("text");
  const note = first("note");
  const table = first("table");

  const has = (...c: Ctx[]) => c.some((x) => ctxs.has(x));

  const strokeVal = ink?.color ?? shape?.stroke ?? line?.stroke ?? table?.accent ?? style.stroke;
  const widthVal = shape?.strokeWidth ?? line?.strokeWidth ?? style.strokeWidth;
  const dashVal = shape?.dash ?? line?.dash ?? style.dash;
  const fontVal = text?.fontSize ?? note?.fontSize ?? table?.fontSize ?? shape?.fontSize ?? style.fontSize;
  const penVal = ink?.size ?? (hl ? hl.size / 3 : style.penSize);
  const locked = selection.length > 0 && selection.every((e) => e.locked);

  const body = (
    <div className="flex w-[212px] flex-col gap-3.5 p-3">
      {has("ink", "shape", "line", "table") && (
        <Section label={has("table") && !has("ink", "shape", "line") ? "Màu nhấn" : "Màu nét"}>
          {STROKE_COLORS.map((c) => (
            <Swatch key={c} color={c} active={strokeVal === c} onClick={() => onStyle({ stroke: c })} />
          ))}
        </Section>
      )}
      {has("highlight") && (
        <Section label="Màu dạ quang">
          {HL_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              active={(hl?.color ?? style.hlColor) === c}
              onClick={() => onStyle({ hlColor: c })}
            />
          ))}
        </Section>
      )}
      {has("shape") && (
        <Section label="Màu nền">
          {FILL_COLORS.map((c) => (
            <Swatch key={c} color={c} active={(shape?.fill ?? style.fill) === c} onClick={() => onStyle({ fill: c })} />
          ))}
        </Section>
      )}
      {has("text") && (
        <Section label="Màu chữ">
          {STROKE_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              active={(text?.color ?? style.textColor) === c}
              onClick={() => onStyle({ textColor: c })}
            />
          ))}
        </Section>
      )}
      {has("note") && (
        <Section label="Màu giấy">
          {NOTE_COLORS.map((c) => (
            <Swatch key={c} color={c} active={(note?.bg ?? style.noteBg) === c} onClick={() => onStyle({ noteBg: c })} />
          ))}
        </Section>
      )}
      {has("shape") && (
        <Section label="Hình dạng">
          <Seg<ShapeKind>
            value={shape?.shape ?? style.shape}
            onChange={(v) => onStyle({ shape: v })}
            options={[
              ["rect", <Square key="r" size={16} />, "Chữ nhật"],
              ["ellipse", <Circle key="e" size={16} />, "Elip"],
              ["diamond", <Diamond key="d" size={16} />, "Thoi"],
              ["triangle", <Triangle key="t" size={16} />, "Tam giác"],
            ]}
          />
        </Section>
      )}
      {has("ink", "highlight") && (
        <Section label="Cỡ bút">
          <Seg<number>
            value={penVal}
            onChange={(v) => onStyle({ penSize: v })}
            options={PEN_SIZES.map((s) => [
              s,
              <span key={s} className="rounded-full bg-current" style={{ width: Math.min(16, s + 2), height: Math.min(16, s + 2) }} />,
              `${s}px`,
            ])}
          />
        </Section>
      )}
      {has("shape", "line") && (
        <Section label="Độ dày nét">
          <Seg<number>
            value={widthVal}
            onChange={(v) => onStyle({ strokeWidth: v })}
            options={STROKE_WIDTHS.map((s) => [
              s,
              <span key={s} className="w-5 rounded-full bg-current" style={{ height: Math.max(1, Math.min(6, s)) }} />,
              `${s}px`,
            ])}
          />
        </Section>
      )}
      {has("shape", "line") && (
        <Section label="Kiểu nét">
          <Seg<Dash>
            value={dashVal}
            onChange={(v) => onStyle({ dash: v })}
            options={[
              ["solid", <DashIcon key="s" dash="solid" />, "Liền"],
              ["dashed", <DashIcon key="d" dash="dashed" />, "Gạch"],
              ["dotted", <DashIcon key="o" dash="dotted" />, "Chấm"],
            ]}
          />
        </Section>
      )}
      {has("line") && (
        <Section label="Đầu mũi tên">
          <div className="flex gap-1">
            <Toggle
              active={line ? !!line.arrowStart : style.arrowStart}
              onClick={() => onStyle({ arrowStart: !(line ? line.arrowStart : style.arrowStart) })}
              label="Đầu"
            >
              <ArrowLeft size={16} />
            </Toggle>
            <Toggle
              active={line ? !!line.arrowEnd : style.arrowEnd}
              onClick={() => onStyle({ arrowEnd: !(line ? line.arrowEnd : style.arrowEnd) })}
              label="Cuối"
            >
              <ArrowRight size={16} />
            </Toggle>
          </div>
        </Section>
      )}
      {has("text", "note", "table", "shape") && (
        <Section label="Cỡ chữ">
          <Seg<number>
            value={fontVal}
            onChange={(v) => onStyle({ fontSize: v })}
            options={FONT_SIZES.map((f) => [f.value, <span key={f.label} className="text-xs font-semibold">{f.label}</span>, `${f.value}px`])}
          />
        </Section>
      )}
      {selection.length > 0 && (
        <Section label={selection.length > 1 ? `Thao tác · ${selection.length} mục` : "Thao tác"}>
          <div className="flex gap-0.5">
            <IconButton size="sm" tip="Lên trên cùng · ⌘]" onClick={actions.front} tipSide="top">
              <BringToFront size={16} />
            </IconButton>
            <IconButton size="sm" tip="Xuống dưới cùng · ⌘[" onClick={actions.back} tipSide="top">
              <SendToBack size={16} />
            </IconButton>
            <IconButton size="sm" tip="Nhân bản · ⌘D" onClick={actions.duplicate} tipSide="top">
              <Copy size={16} />
            </IconButton>
            <IconButton size="sm" tip={locked ? "Mở khoá" : "Khoá vị trí"} active={locked} onClick={actions.toggleLock} tipSide="top">
              {locked ? <Lock size={16} /> : <LockOpen size={16} />}
            </IconButton>
            <IconButton size="sm" tip="Xoá · Del" onClick={actions.remove} tipSide="top" className="hover:!bg-danger-soft hover:!text-danger">
              <Trash2 size={16} />
            </IconButton>
          </div>
        </Section>
      )}
    </div>
  );

  return (
    <>
      <div data-ui className="island pop-in absolute top-[68px] left-3 z-30 hidden max-h-[calc(100%-150px)] overflow-y-auto md:block">
        {body}
      </div>
      {/* mobile */}
      <div data-ui className="absolute bottom-[76px] left-3 z-30 md:hidden">
        {mobileOpen ? (
          <div className="island pop-in relative max-h-[50vh] overflow-y-auto">
            <button
              type="button"
              aria-label="Đóng"
              className="absolute top-2 right-2 rounded-md p-1 text-ink-2 hover:bg-hover"
              onClick={() => setMobileOpen(false)}
            >
              <X size={16} />
            </button>
            {body}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="island flex h-11 items-center gap-2 px-3 text-sm font-medium text-ink"
          >
            <SlidersHorizontal size={16} /> Thuộc tính
          </button>
        )}
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Seg<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, React.ReactNode, string]>;
}) {
  return (
    <div className="flex w-full gap-0.5 rounded-lg bg-canvas p-0.5">
      {options.map(([v, icon, label]) => (
        <button
          key={String(v)}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-8 flex-1 items-center justify-center rounded-md text-ink-2 transition-colors",
            value === v ? "bg-panel text-accent shadow-sm" : "hover:text-ink",
          )}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-medium transition-colors",
        active ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover",
      )}
    >
      {children} {label}
    </button>
  );
}

function DashIcon({ dash }: { dash: Dash }) {
  return (
    <svg width="22" height="4" viewBox="0 0 22 4">
      <line
        x1="2"
        y1="2"
        x2="20"
        y2="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dash === "dashed" ? "5 4" : dash === "dotted" ? "0 4" : undefined}
      />
    </svg>
  );
}

"use client";

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { cn, initials } from "@/lib/utils";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  tip?: string;
  tipSide?: "top" | "bottom" | "left" | "right";
  size?: "sm" | "md";
};

/** Nút icon vuông có tooltip CSS. */
export const IconButton = forwardRef<HTMLButtonElement, BtnProps>(function IconButton(
  { active, tip, tipSide = "bottom", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={tip}
      aria-pressed={active}
      data-tip={tip}
      data-tip-side={tipSide}
      className={cn(
        "tip relative inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
        "text-ink-2 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-35",
        size === "md" ? "h-9 w-9" : "h-8 w-8",
        active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Divider({ vertical = true }: { vertical?: boolean }) {
  return <div className={vertical ? "mx-1 h-5 w-px shrink-0 bg-line" : "my-1 h-px w-full bg-line"} />;
}

/** Popover đơn giản: tự đóng khi click ra ngoài hoặc nhấn Esc. */
export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "start",
  open: controlled,
  onOpenChange,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  side?: "top" | "bottom" | "right" | "left";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  className?: string;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (o: boolean) => {
    if (controlled === undefined) setInner(o);
    onOpenChange?.(o);
  };
  const ref = useRef<HTMLDivElement>(null);
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpenRef.current(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pos = {
    bottom: "top-full mt-2",
    top: "bottom-full mb-2",
    right: "left-full ml-2",
    left: "right-full mr-2",
  }[side];
  const al =
    side === "top" || side === "bottom"
      ? { start: "left-0", center: "left-1/2 -translate-x-1/2", end: "right-0" }[align]
      : { start: "top-0", center: "top-1/2 -translate-y-1/2", end: "bottom-0" }[align];

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div
          className={cn(
            "pop-in absolute z-50 rounded-xl border border-line bg-panel p-2 shadow-float",
            pos,
            al,
            className,
          )}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function Swatch({
  color,
  active,
  onClick,
  title,
  size = 24,
}: {
  color: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
  size?: number;
}) {
  const none = color === "none";
  return (
    <button
      type="button"
      title={title ?? (none ? "Không màu" : color)}
      aria-label={title ?? (none ? "Không màu" : color)}
      onClick={onClick}
      className={cn(
        "relative shrink-0 rounded-md border transition-transform duration-100 hover:scale-110",
        active ? "border-accent ring-2 ring-accent/40" : "border-black/10",
      )}
      style={{
        width: size,
        height: size,
        background: none
          ? "repeating-conic-gradient(#e9ecef 0% 25%, #fff 0% 50%) 50% / 8px 8px"
          : color,
      }}
    >
      {none && <span className="absolute inset-0 m-auto h-[2px] w-[130%] -translate-x-[12%] rotate-45 bg-red-500/70" />}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5em] items-center justify-center rounded border border-line bg-canvas px-1 font-sans text-[11px] font-medium text-ink-2">
      {children}
    </kbd>
  );
}

export function Avatar({
  name,
  color,
  size = 32,
  ring,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const text = initials(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white uppercase",
        ring && "ring-2 ring-panel",
        className,
      )}
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      title={name}
    >
      {text}
    </span>
  );
}

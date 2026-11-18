"use client";

import { useEffect, useRef } from "react";
import type { ShapeEl } from "@/lib/board/types";
import type { BoardStore } from "@/lib/board/store";
import { readableOn } from "@/lib/board/defaults";

export function ShapeLabelEditor({
  el,
  store,
  onExit,
  takeTyped,
}: {
  el: ShapeEl;
  store: BoardStore;
  onExit: () => void;
  takeTyped?: () => string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus();
    const typed = takeTyped?.();
    if (typed) {
      const cur = store.get(el.id);
      if (cur?.type === "shape") store.live([{ ...cur, text: (cur.text ?? "") + typed }]);
    }
    t.setSelectionRange(t.value.length + (typed?.length ?? 0), t.value.length + (typed?.length ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [el.text]);

  const color = el.textColor ?? (el.fill !== "none" ? readableOn(el.fill) : el.stroke === "#ffffff" ? "#1e1e1e" : el.stroke);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-3">
      <textarea
        ref={ref}
        rows={1}
        value={el.text ?? ""}
        placeholder="Nhập chữ…"
        onChange={(e) => {
          const cur = store.get(el.id);
          if (cur?.type === "shape") store.live([{ ...cur, text: e.target.value }]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            onExit();
          }
        }}
        className="w-full resize-none overflow-hidden bg-transparent text-center leading-snug outline-none placeholder:text-current/40"
        style={{ fontSize: el.fontSize, color }}
      />
    </div>
  );
}

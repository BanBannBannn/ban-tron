"use client";

import { useEffect } from "react";
import {
  Download,
  Ellipsis,
  Expand,
  Keyboard,
  Minus,
  Plus,
  Redo2,
  Trash,
  Undo2,
} from "lucide-react";
import { useZoom, type CameraStore } from "@/lib/board/camera";
import { IconButton, Kbd, Popover } from "../ui/primitives";
import { modKey } from "@/lib/utils";

export function ZoomBar({
  cam,
  onZoom,
  onReset,
  onFit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  cam: CameraStore;
  onZoom: (dir: 1 | -1) => void;
  onReset: () => void;
  onFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const z = useZoom(cam);
  return (
    <div data-ui className="absolute bottom-3 left-3 z-30 hidden items-center gap-2 xl:flex">
      <div className="island flex items-center p-1">
        <IconButton size="sm" tip="Thu nhỏ · ⌘−" tipSide="top" onClick={() => onZoom(-1)}>
          <Minus size={16} />
        </IconButton>
        <button
          type="button"
          onClick={onReset}
          title="Về 100%"
          className="h-8 min-w-[52px] rounded-lg px-1 text-center text-[13px] font-medium text-ink-2 tabular-nums hover:bg-hover"
        >
          {Math.round(z * 100)}%
        </button>
        <IconButton size="sm" tip="Phóng to · ⌘+" tipSide="top" onClick={() => onZoom(1)}>
          <Plus size={16} />
        </IconButton>
        <IconButton size="sm" tip="Xem toàn bộ · ⇧1" tipSide="top" onClick={onFit}>
          <Expand size={15} />
        </IconButton>
      </div>
      <div className="island flex items-center p-1">
        <IconButton size="sm" tip="Hoàn tác · ⌘Z" tipSide="top" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton size="sm" tip="Làm lại · ⌘⇧Z" tipSide="top" onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={16} />
        </IconButton>
      </div>
    </div>
  );
}

/** Nút hoàn tác gọn cho mobile. */
export function MobileUndo({ onUndo, onRedo, canUndo, canRedo }: { onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean }) {
  return (
    <div data-ui className="island absolute right-3 bottom-[76px] z-30 flex items-center p-1 md:right-auto md:bottom-3 md:left-3 xl:hidden">
      <IconButton size="md" tip="Hoàn tác" tipSide="top" onClick={onUndo} disabled={!canUndo}>
        <Undo2 size={18} />
      </IconButton>
      <IconButton size="md" tip="Làm lại" tipSide="top" onClick={onRedo} disabled={!canRedo}>
        <Redo2 size={18} />
      </IconButton>
    </div>
  );
}

export function BoardMenu({
  onExport,
  onClear,
  onHelp,
  exporting,
}: {
  onExport: () => void;
  onClear: () => void;
  onHelp: () => void;
  exporting: boolean;
}) {
  return (
    <div data-ui className="absolute right-3 bottom-3 z-30 hidden md:block">
      <Popover
        side="top"
        align="end"
        trigger={({ toggle, open }) => (
          <div className="island p-1">
            <IconButton size="sm" tip="Thêm" tipSide="left" active={open} onClick={toggle}>
              <Ellipsis size={18} />
            </IconButton>
          </div>
        )}
      >
        {(close) => (
          <div className="flex w-56 flex-col text-[13px]">
            <MenuItem
              icon={<Download size={16} />}
              onClick={() => {
                close();
                onExport();
              }}
              disabled={exporting}
            >
              {exporting ? "Đang xuất ảnh…" : "Xuất ảnh PNG"}
            </MenuItem>
            <MenuItem
              icon={<Keyboard size={16} />}
              onClick={() => {
                close();
                onHelp();
              }}
              hint="?"
            >
              Phím tắt
            </MenuItem>
            <div className="my-1 h-px bg-line" />
            <MenuItem
              icon={<Trash size={16} />}
              danger
              onClick={() => {
                close();
                onClear();
              }}
            >
              Xoá toàn bộ bảng
            </MenuItem>
          </div>
        )}
      </Popover>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
  hint,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover disabled:opacity-50 ${danger ? "text-danger" : "text-ink"}`}
    >
      <span className={danger ? "" : "text-ink-2"}>{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

const SHORTCUTS: Array<[string, string[]]> = [
  ["Chọn / Kéo bảng", ["V", "H"]],
  ["Bút / Dạ quang / Tẩy", ["P", "M", "E"]],
  ["Chữ nhật / Elip / Thoi", ["R", "O", "D"]],
  ["Đường thẳng / Mũi tên", ["L", "A"]],
  ["Chữ / Ghi chú / Bảng", ["T", "N", "B"]],
  ["Ảnh / Laser", ["I", "K"]],
  ["Kéo bảng tạm thời", ["Space"]],
  ["Hoàn tác / Làm lại", [`${modKey} Z`, `${modKey} ⇧ Z`]],
  ["Nhân bản / Chọn tất cả", [`${modKey} D`, `${modKey} A`]],
  ["Sao chép / Dán", [`${modKey} C`, `${modKey} V`]],
  ["Lên trên / Xuống dưới", [`${modKey} ]`, `${modKey} [`]],
  ["Phóng to / Thu nhỏ", [`${modKey} +`, `${modKey} −`]],
  ["Về 100% / Xem toàn bộ", [`${modKey} 0`, "⇧ 1"]],
  ["Sửa chữ phần tử đang chọn", ["Enter"]],
  ["Thoát sửa / Bỏ chọn", ["Esc"]],
  ["Xoá", ["Del"]],
  ["Nhân bản khi kéo", ["Alt + kéo"]],
  ["Giữ tỉ lệ / khoá góc 15°", ["⇧ + kéo"]],
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      data-ui
      data-modal-open
      role="dialog"
      aria-modal="true"
      aria-label="Phím tắt"
      className="fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onPointerDown={onClose}
    >
      <div
        className="pop-in w-full max-w-[560px] rounded-2xl border border-line bg-panel p-6 shadow-float"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-ink">Phím tắt</h2>
        <div className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5">
              <span className="text-ink-2">{label}</span>
              <span className="flex shrink-0 gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-3">
          Mẹo: nhấp đúp vào chỗ trống để viết chữ, nhấp đúp vào hình để ghi nhãn. Dán ảnh trực tiếp bằng {modKey} V hoặc kéo-thả file vào bảng.
        </p>
      </div>
    </div>
  );
}

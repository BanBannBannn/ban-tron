export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function uid(): string {
  return crypto.randomUUID();
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = () => {
    last = performance.now();
    timer = null;
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };
  const throttled = (...args: A) => {
    pending = args;
    const elapsed = performance.now() - last;
    if (elapsed >= ms) {
      if (timer) clearTimeout(timer);
      run();
    } else if (!timer) {
      timer = setTimeout(run, ms - elapsed);
    }
  };
  throttled.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}

/** Chữ viết tắt cho avatar. Tách theo "ký tự hiển thị" để không cắt đôi emoji. */
export function initials(name: string) {
  const chars = (w: string) => {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      return Array.from(new Intl.Segmenter("vi", { granularity: "grapheme" }).segment(w), (s) => s.segment);
    }
    return Array.from(w);
  };
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return chars(words[0]).slice(0, 2).join("").toUpperCase();
  return (chars(words[0])[0] + chars(words[words.length - 1])[0]).toUpperCase();
}

export function timeAgo(date: string | number | Date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} ngày trước`;
  return new Date(date).toLocaleDateString("vi-VN");
}

export function formatTime(date: string | number | Date) {
  return new Date(date).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const modKey = isMac ? "⌘" : "Ctrl";

export function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Gom nhiều phần tử rồi gửi theo lô mỗi `ms` mili-giây. */
export class Batcher<T> {
  private buf: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private send: (items: T[]) => void,
    private ms: number,
  ) {}
  push(item: T) {
    this.buf.push(item);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.ms);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.buf.length) return;
    const items = this.buf;
    this.buf = [];
    this.send(items);
  }
}

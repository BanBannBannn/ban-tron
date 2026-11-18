"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type {
  BoardElement,
  DrawStyle,
  ImageEl,
  LineEl,
  NoteEl,
  Rect,
  ShapeEl,
  TableEl,
  TextEl,
  Tool,
} from "@/lib/board/types";
import { isRichText } from "@/lib/board/types";
import type { BoardStore } from "@/lib/board/store";
import type { CameraStore } from "@/lib/board/camera";
import {
  hitTest,
  lineFromPoints,
  normalizeRect,
  rectsIntersect,
  screenToWorld,
  snapAngle,
  unionBounds,
} from "@/lib/board/geometry";
import { applyStyleTo, cloneElements, makeInk, scaleElement } from "@/lib/board/factory";
import { DEFAULT_STYLE, emptyDoc, isDocEmpty, tableDoc, textDoc } from "@/lib/board/defaults";
import { uploadImage } from "@/lib/board/image";
import { isUuid, sanitizeElement, sanitizeElements, sanitizeIds } from "@/lib/board/sanitize";
import type { Peer, RoomBus } from "@/lib/realtime";
import { Batcher, clamp, isTypingTarget, safeStorage, throttle, uid } from "@/lib/utils";
import { ElementView } from "./ElementView";
import {
  DraftLayer,
  LaserLayer,
  MarqueeOverlay,
  RemoteCursors,
  RemoteSelections,
  SelectionOverlay,
  type Handle,
} from "./Overlays";
import { Toolbar, TOOL_KEYS } from "./Toolbar";
import { StylePanel } from "./StylePanel";
import { BoardMenu, HelpDialog, MobileUndo, ZoomBar } from "./BoardChrome";

const CLIP_MARKER = "bantron/elements:";

type Gesture =
  | { kind: "pan"; sx: number; sy: number }
  | { kind: "pinch"; d0: number; z0: number; wx: number; wy: number }
  | { kind: "ink"; id: string; pts: number[][]; pressure: boolean; highlighter: boolean; color: string; size: number }
  | { kind: "shape"; id: string; x0: number; y0: number; el: ShapeEl | null }
  | { kind: "line"; id: string; x0: number; y0: number; arrow: boolean; el: LineEl | null }
  | {
      kind: "move";
      sx: number;
      sy: number;
      wx: number;
      wy: number;
      ids: string[];
      origins: BoardElement[];
      moved: boolean;
      alt: boolean;
      clickedId: string;
    }
  | { kind: "resize"; handle: Handle; origins: BoardElement[]; b0: Rect }
  | { kind: "line-end"; which: 0 | 1; origin: LineEl }
  | { kind: "marquee"; x0: number; y0: number; base: string[] }
  | { kind: "erase"; ids: Set<string>; lx: number; ly: number }
  | { kind: "laser" };

interface Props {
  roomId: string;
  store: BoardStore;
  cam: CameraStore;
  bus: RoomBus;
  userId: string;
  me: { name: string; color: string };
  peers: Peer[];
}

function loadStyle(): DrawStyle {
  try {
    const raw = safeStorage()?.getItem("bantron:style");
    if (raw) return { ...DEFAULT_STYLE, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STYLE;
}

export function Board({ roomId, store, cam, bus, userId, me, peers }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

  const [tool, setToolState] = useState<Tool>("select");
  const [style, setStyle] = useState<DrawStyle>(loadStyle);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<BoardElement | null>(null);
  const [erasing, setErasing] = useState<Set<string>>(() => new Set());
  const [remoteDrafts, setRemoteDrafts] = useState<Map<string, BoardElement>>(() => new Map());
  const [remoteSel, setRemoteSel] = useState<Map<string, string[]>>(() => new Map());
  const [locks, setLocks] = useState<Map<string, string>>(() => new Map());
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(!store.loaded);

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const laserLocal = useRef<((x: number, y: number) => void) | null>(null);
  const clipboard = useRef<BoardElement[] | null>(null);
  const pasteCount = useRef(0);
  const firstLoad = useRef(true);
  /** phím gõ ngay sau khi tạo/nhấp đúp, trước khi editor kịp focus */
  const typeBuffer = useRef({ text: "", since: 0 });

  // state mới nhất cho các handler gắn 1 lần
  const S = useRef({ tool, style, selected, editingId, locks, spaceDown });
  useEffect(() => {
    S.current = { tool, style, selected, editingId, locks, spaceDown };
  });

  // ───────────── style lưu cục bộ ─────────────
  useEffect(() => {
    try {
      safeStorage()?.setItem("bantron:style", JSON.stringify(style));
    } catch {}
  }, [style]);

  // ───────────── camera → DOM ─────────────
  useEffect(() => {
    const apply = () => {
      const c = cam.get();
      const w = worldRef.current;
      const v = viewportRef.current;
      if (w) w.style.transform = `translate(${-c.x * c.z}px, ${-c.y * c.z}px) scale(${c.z})`;
      if (v) {
        let g = 24 * c.z;
        while (g < 12) g *= 2;
        v.style.setProperty("--grid-size", `${g}px`);
        v.style.setProperty("--grid-x", `${-c.x * c.z}px`);
        v.style.setProperty("--grid-y", `${-c.y * c.z}px`);
        v.style.setProperty("--grid-dot", `${clamp(c.z, 0.6, 1.4)}px`);
      }
    };
    apply();
    return cam.subscribe(apply);
  }, [cam]);

  const viewportSize = useCallback(() => {
    const r = viewportRef.current?.getBoundingClientRect();
    return { w: r?.width ?? window.innerWidth, h: r?.height ?? window.innerHeight, left: r?.left ?? 0, top: r?.top ?? 0 };
  }, []);

  const fitTo = useCallback(
    (b: Rect | null, animate = true, maxZoom = 1) => {
      const vp = viewportSize();
      if (!b) {
        const target = { x: -vp.w / 2, y: -vp.h / 2, z: 1 };
        if (animate) cam.animateTo(target);
        else cam.set(target);
        return;
      }
      const pad = 80;
      const z = clamp(Math.min((vp.w - pad * 2) / Math.max(b.w, 1), (vp.h - pad * 2) / Math.max(b.h, 1)), 0.1, maxZoom);
      const target = { x: b.x + b.w / 2 - vp.w / 2 / z, y: b.y + b.h / 2 - vp.h / 2 / z, z };
      if (animate) cam.animateTo(target);
      else cam.set(target);
    },
    [cam, viewportSize],
  );

  // ───────────── tải dữ liệu & realtime ─────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await store.load();
        if (cancelled) return;
        setLoading(false);
        if (firstLoad.current) {
          firstLoad.current = false;
          fitTo(unionBounds(store.all()), false);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setLoading(false);
          toast.error("Không tải được bảng. Kiểm tra kết nối.");
        }
      }
    };
    const offConn = bus.on("connected", load);
    if (bus.connected) void load();
    // Mọi dữ liệu từ người khác đều không đáng tin → làm sạch trước khi dùng
    const offEl = bus.on("el", (d: { upsert?: unknown; remove?: unknown } | null) =>
      store.applyRemote({ upsert: sanitizeElements(d?.upsert), remove: sanitizeIds(d?.remove) }),
    );
    const offLive = bus.on("el-live", (d: unknown) => store.applyRemote({ upsert: sanitizeElements(d) }));
    const offDraft = bus.on("draft", (d: { el?: unknown } | null, from: string) => {
      if (!isUuid(from)) return;
      const el = d?.el ? sanitizeElement(d.el) : null;
      setRemoteDrafts((m) => {
        const n = new Map(m);
        if (el) n.set(from, el);
        else n.delete(from);
        return n;
      });
    });
    const offSel = bus.on("sel", (d: unknown, from: string) => {
      if (!isUuid(from)) return;
      const ids = sanitizeIds(d);
      setRemoteSel((m) => {
        const n = new Map(m);
        if (ids.length) n.set(from, ids);
        else n.delete(from);
        return n;
      });
    });
    const offLock = bus.on("lock", (d: { id?: unknown; on?: unknown } | null, from: string) => {
      if (!isUuid(from) || !isUuid(d?.id)) return;
      const id = d.id;
      setLocks((m) => {
        const n = new Map(m);
        for (const [k, v] of n) if (v === from) n.delete(k);
        if (d.on === true) n.set(id, from);
        return n;
      });
    });
    const offHello = bus.on("hello", () => {
      store.resendPending();
      const s = S.current;
      if (s.selected.length) bus.send("sel", s.selected);
      if (s.editingId) bus.send("lock", { id: s.editingId, on: true });
    });
    const offLeave = bus.on("peer-leave", (p?: Peer) => {
      if (!p) return;
      const drop = <V,>(m: Map<string, V>) => {
        const n = new Map(m);
        n.delete(p.id);
        return n;
      };
      setRemoteDrafts(drop);
      setRemoteSel(drop);
      setLocks((m) => new Map(Array.from(m).filter(([, v]) => v !== p.id)));
    });
    return () => {
      cancelled = true;
      offConn();
      offEl();
      offLive();
      offDraft();
      offSel();
      offLock();
      offHello();
      offLeave();
    };
  }, [bus, store, fitTo]);

  // lưu ngay khi rời tab
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void store.flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (store.hasPending) {
        void store.flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [store]);

  // chia sẻ vùng chọn
  const sendSel = useMemo(() => throttle((ids: string[]) => bus.send("sel", ids), 120), [bus]);
  useEffect(() => {
    sendSel(selected);
  }, [selected, sendSel]);

  // dọn selection khi phần tử bị xoá (bởi mình hoặc người khác)
  useEffect(
    () =>
      store.subscribe(() => {
        setSelected((sel) => {
          const next = sel.filter((id) => store.has(id));
          return next.length === sel.length ? sel : next;
        });
        const editing = S.current.editingId;
        if (editing && !store.has(editing)) {
          setEditingId(null);
          if (store.inTx) store.endTx();
        }
      }),
    [store],
  );

  const sendCursor = useMemo(
    () => throttle((p: { x: number; y: number } | null) => bus.send("cursor", p), 50),
    [bus],
  );
  const sendDraft = useMemo(() => throttle((el: BoardElement | null) => bus.send("draft", { el }), 60), [bus]);
  const [laserBatch] = useState(() => new Batcher<[number, number]>((pts) => bus.send("laser", pts), 50));

  // ───────────── trợ giúp ─────────────
  const selectedEls = useMemo(
    () => selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, version, store],
  );

  const peersRef = useRef(peers);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  /** Chỉ tôn trọng khoá của người đang online (chống khoá giả mạo bằng id lạ). */
  const lockedByOther = useCallback(
    (id: string) => {
      const owner = S.current.locks.get(id);
      if (!owner || owner === userId) return null;
      return peersRef.current.some((p) => p.id === owner) ? owner : null;
    },
    [userId],
  );

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
    if (t !== "select") setSelected([]);
    if (t === "image") {
      fileRef.current?.click();
      setToolState("select");
    }
  }, []);

  const exitEdit = useCallback(() => {
    const id = S.current.editingId;
    if (!id) return;
    S.current.editingId = null;
    setEditingId(null);
    const el = store.get(id);
    if (el?.type === "text" && isDocEmpty(el.doc)) {
      store.commit({ remove: [id] });
      setSelected((s) => s.filter((x) => x !== id));
    }
    store.endTx();
    bus.send("lock", { id, on: false });
  }, [store, bus]);

  const enterEdit = useCallback(
    (id: string) => {
      const owner = lockedByOther(id);
      if (owner) {
        const p = peers.find((x) => x.id === owner);
        toast(`${p?.name ?? "Người khác"} đang sửa phần tử này`);
        return;
      }
      const el = store.get(id);
      if (!el || el.locked) return;
      if (!(isRichText(el) || el.type === "shape")) return;
      if (S.current.editingId && S.current.editingId !== id) exitEdit();
      store.beginTx();
      S.current.editingId = id;
      typeBuffer.current = { text: "", since: Date.now() };
      setEditingId(id);
      setSelected([id]);
      bus.send("lock", { id, on: true });
    },
    [lockedByOther, peers, store, bus, exitEdit],
  );

  const takeTyped = useCallback(() => {
    const t = typeBuffer.current.text;
    typeBuffer.current = { text: "", since: 0 };
    return t;
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const vp = viewportSize();
      return screenToWorld(cam.get(), clientX - vp.left, clientY - vp.top);
    },
    [cam, viewportSize],
  );

  const viewportCenter = useCallback(() => {
    const vp = viewportSize();
    return screenToWorld(cam.get(), vp.w / 2, vp.h / 2);
  }, [cam, viewportSize]);

  // ───────────── tạo phần tử ─────────────
  const createRich = useCallback(
    (type: "text" | "note" | "table", x: number, y: number, doc = type === "table" ? tableDoc() : emptyDoc()) => {
      const s = S.current.style;
      const z = store.maxZ() + 1;
      const id = uid();
      let el: TextEl | NoteEl | TableEl;
      if (type === "text") {
        el = { id, type, x, y: y - s.fontSize * 0.75, w: 24, h: s.fontSize * 1.5, z, doc, color: s.textColor, fontSize: s.fontSize, autoW: true };
      } else if (type === "note") {
        el = { id, type, x: x - 110, y: y - 110, w: 220, h: 220, minH: 220, z, doc, bg: s.noteBg, fontSize: s.fontSize };
      } else {
        el = { id, type, x: x - 240, y: y - 30, w: 480, h: 140, z, doc, fontSize: 15, accent: s.stroke === "#1e1e1e" || s.stroke === "#ffffff" ? "#3b5bdb" : s.stroke };
      }
      if (S.current.editingId) exitEdit();
      store.beginTx();
      store.commit({ upsert: [el] });
      S.current.editingId = id;
      typeBuffer.current = { text: "", since: Date.now() };
      setEditingId(id);
      setSelected([id]);
      setToolState("select");
      bus.send("lock", { id, on: true });
      return el;
    },
    [store, bus, exitEdit],
  );

  const addImages = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return;
      const center = at ?? viewportCenter();
      const tId = toast.loading(imgs.length > 1 ? `Đang tải ${imgs.length} ảnh…` : "Đang tải ảnh…");
      const created: ImageEl[] = [];
      let offset = 0;
      for (const f of imgs) {
        try {
          const up = await uploadImage(f, roomId);
          const maxW = 520 / Math.max(cam.get().z, 0.5);
          const w = Math.min(up.width, maxW);
          const h = (w * up.height) / up.width;
          created.push({
            id: uid(),
            type: "image",
            x: center.x - w / 2 + offset,
            y: center.y - h / 2 + offset,
            w,
            h,
            z: store.maxZ() + 1 + created.length,
            src: up.src,
            ratio: up.width / up.height,
          });
          offset += 24;
        } catch (err) {
          toast.error(`Không tải được ảnh: ${(err as Error).message}`);
        }
      }
      toast.dismiss(tId);
      if (created.length) {
        store.commit({ upsert: created });
        setSelected(created.map((c) => c.id));
        setToolState("select");
      }
    },
    [roomId, store, cam, viewportCenter],
  );

  // ───────────── thao tác trên vùng chọn ─────────────
  const removeSelected = useCallback(() => {
    const ids = S.current.selected.filter((id) => !lockedByOther(id) && !store.get(id)?.locked);
    if (!ids.length) return;
    store.commit({ remove: ids });
    setSelected([]);
  }, [store, lockedByOther]);

  const duplicateSelected = useCallback(() => {
    const els = S.current.selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[];
    if (!els.length) return;
    const clones = cloneElements(els, 24, 24, store.maxZ() + 1);
    store.commit({ upsert: clones });
    setSelected(clones.map((c) => c.id));
  }, [store]);

  const reorder = useCallback(
    (dir: "front" | "back") => {
      const els = (S.current.selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[]).sort((a, b) => a.z - b.z);
      if (!els.length) return;
      const base = dir === "front" ? store.maxZ() + 1 : store.minZ() - els.length;
      store.commit({ upsert: els.map((el, i) => ({ ...el, z: base + i })) });
    },
    [store],
  );

  const toggleLock = useCallback(() => {
    const els = S.current.selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[];
    if (!els.length) return;
    const lock = !els.every((e) => e.locked);
    store.commit({ upsert: els.map((e) => ({ ...e, locked: lock || undefined })) });
  }, [store]);

  const onStyle = useCallback(
    (patch: Partial<DrawStyle>) => {
      setStyle((s) => ({ ...s, ...patch }));
      const els = S.current.selected
        .map((id) => store.get(id))
        .filter((e): e is BoardElement => !!e && !lockedByOther(e.id));
      if (els.length) store.commit({ upsert: els.map((e) => applyStyleTo(e, patch)) });
    },
    [store, lockedByOther],
  );

  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const vp = viewportSize();
      const z = cam.get().z;
      const steps = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
      const next = dir > 0 ? steps.find((s) => s > z + 0.01) ?? 5 : [...steps].reverse().find((s) => s < z - 0.01) ?? 0.1;
      const c = cam.get();
      const wx = vp.w / 2 / c.z + c.x;
      const wy = vp.h / 2 / c.z + c.y;
      cam.animateTo({ x: wx - vp.w / 2 / next, y: wy - vp.h / 2 / next, z: next }, 200);
    },
    [cam, viewportSize],
  );

  const resetZoom = useCallback(() => {
    const vp = viewportSize();
    const c = cam.get();
    const wx = vp.w / 2 / c.z + c.x;
    const wy = vp.h / 2 / c.z + c.y;
    cam.animateTo({ x: wx - vp.w / 2, y: wy - vp.h / 2, z: 1 }, 220);
  }, [cam, viewportSize]);

  const fitAll = useCallback(() => {
    const sel = S.current.selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[];
    fitTo(unionBounds(sel.length ? sel : store.all()), true, sel.length ? 2 : 1);
  }, [fitTo, store]);

  const undo = useCallback(() => {
    if (S.current.editingId) exitEdit();
    store.undo();
  }, [store, exitEdit]);
  const redo = useCallback(() => {
    if (S.current.editingId) exitEdit();
    store.redo();
  }, [store, exitEdit]);

  const exportPng = useCallback(async () => {
    const all = store.all();
    const b = unionBounds(all);
    const world = worldRef.current;
    if (!b || !world) {
      toast("Bảng đang trống");
      return;
    }
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const pad = 48;
      const scale = Math.min(2, 8000 / Math.max(b.w + pad * 2, b.h + pad * 2));
      const url = await toPng(world, {
        width: b.w + pad * 2,
        height: b.h + pad * 2,
        pixelRatio: scale,
        backgroundColor: "#ffffff",
        cacheBust: true,
        style: { transform: `translate(${pad - b.x}px, ${pad - b.y}px)` },
        filter: (node) => !(node instanceof HTMLElement && node.dataset.overlay !== undefined),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `ban-tron-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      toast.success("Đã xuất ảnh");
    } catch (err) {
      console.error(err);
      toast.error("Xuất ảnh thất bại");
    } finally {
      setExporting(false);
    }
  }, [store]);

  const clearBoard = useCallback(() => {
    if (!store.size) return;
    if (!confirm("Xoá toàn bộ nội dung trên bảng? (có thể hoàn tác bằng ⌘Z)")) return;
    if (S.current.editingId) exitEdit();
    store.clearAll();
    setSelected([]);
  }, [store, exitEdit]);

  // ───────────── con trỏ chuột ─────────────
  const finishGesture = useCallback(
    (cancel = false) => {
      const g = gesture.current;
      gesture.current = null;
      setPanning(false);
      if (!g) return;
      switch (g.kind) {
        case "ink": {
          setDraft(null);
          sendDraft.cancel();
          bus.send("draft", { el: null });
          if (cancel || !g.pts.length) return;
          const el = makeInk(g.id, g.pts, {
            color: g.color,
            size: g.size,
            highlighter: g.highlighter,
            pressure: g.pressure,
            z: store.maxZ() + 1,
          });
          store.commit({ upsert: [el] });
          return;
        }
        case "shape": {
          setDraft(null);
          sendDraft.cancel();
          bus.send("draft", { el: null });
          if (cancel) return;
          let el = g.el;
          const z = cam.get().z;
          if (!el || (el.w < 6 / z && el.h < 6 / z)) {
            const s = S.current.style;
            el = {
              id: g.id,
              type: "shape",
              shape: s.shape,
              x: g.x0 - 80,
              y: g.y0 - 55,
              w: 160,
              h: 110,
              z: 0,
              stroke: s.stroke,
              fill: s.fill,
              strokeWidth: s.strokeWidth,
              dash: s.dash,
              fontSize: s.fontSize,
            };
          }
          el = { ...el, z: store.maxZ() + 1 };
          store.commit({ upsert: [el] });
          setSelected([el.id]);
          setToolState("select");
          return;
        }
        case "line": {
          setDraft(null);
          sendDraft.cancel();
          bus.send("draft", { el: null });
          if (cancel) return;
          let el = g.el;
          const z = cam.get().z;
          if (!el || Math.hypot(el.w, el.h) < 6 / z) {
            const s = S.current.style;
            el = {
              id: g.id,
              type: "line",
              ...lineFromPoints(g.x0, g.y0, g.x0 + 160, g.y0),
              z: 0,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              dash: s.dash,
              arrowEnd: g.arrow ? s.arrowEnd || !s.arrowStart : undefined,
              arrowStart: g.arrow ? s.arrowStart : undefined,
            };
          }
          el = { ...el, z: store.maxZ() + 1 };
          store.commit({ upsert: [el] });
          setSelected([el.id]);
          setToolState("select");
          return;
        }
        case "move": {
          if (cancel) {
            store.cancelTx();
            return;
          }
          if (g.moved) store.endTx();
          else if (!g.alt && S.current.selected.length > 1 && g.clickedId) setSelected([g.clickedId]);
          return;
        }
        case "resize":
        case "line-end":
          if (cancel) store.cancelTx();
          else store.endTx();
          return;
        case "marquee":
          setMarquee(null);
          return;
        case "erase":
          setErasing(new Set());
          if (!cancel && g.ids.size) store.commit({ remove: Array.from(g.ids) });
          return;
        case "laser":
          laserBatch.flush();
          return;
      }
    },
    [bus, cam, store, sendDraft, laserBatch],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-editing]")) return;
    if (target.closest("[data-ui]")) return;
    if (e.button === 2) return;

    const vp = viewportSize();
    pointers.current.set(e.pointerId, { x: e.clientX - vp.left, y: e.clientY - vp.top });

    // hai ngón → zoom/pan
    if (pointers.current.size === 2 && e.pointerType === "touch") {
      finishGesture(true);
      const [a, b] = Array.from(pointers.current.values());
      const c = cam.get();
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      gesture.current = {
        kind: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        z0: c.z,
        wx: mx / c.z + c.x,
        wy: my / c.z + c.y,
      };
      return;
    }
    if (pointers.current.size > 1) return;

    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (S.current.editingId) exitEdit();
    viewportRef.current?.setPointerCapture(e.pointerId);

    const p = toWorld(e.clientX, e.clientY);
    const t = S.current.tool;
    const s = S.current.style;

    if (e.button === 1 || S.current.spaceDown || t === "hand") {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY };
      setPanning(true);
      return;
    }

    // tay cầm resize / đầu mút đường thẳng
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle;
    if (handle) {
      const origins = S.current.selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[];
      if (!origins.length) return;
      store.beginTx();
      if (handle === "p0" || handle === "p1") {
        gesture.current = { kind: "line-end", which: handle === "p0" ? 0 : 1, origin: origins[0] as LineEl };
      } else {
        gesture.current = { kind: "resize", handle: handle as Handle, origins, b0: unionBounds(origins)! };
      }
      return;
    }

    const hitId = target.closest<HTMLElement>("[data-el]")?.dataset.el ?? null;

    switch (t) {
      case "select": {
        if (hitId && !lockedByOther(hitId)) {
          let ids = S.current.selected;
          if (e.shiftKey) {
            ids = ids.includes(hitId) ? ids.filter((x) => x !== hitId) : [...ids, hitId];
            setSelected(ids);
            if (!ids.includes(hitId)) return;
          } else if (!ids.includes(hitId)) {
            ids = [hitId];
            setSelected(ids);
          }
          const origins = ids.map((id) => store.get(id)).filter(Boolean) as BoardElement[];
          if (origins.some((o) => o.locked) && !e.altKey) return;
          gesture.current = {
            kind: "move",
            sx: e.clientX,
            sy: e.clientY,
            wx: p.x,
            wy: p.y,
            ids,
            origins,
            moved: false,
            alt: e.altKey,
            clickedId: hitId,
          };
        } else {
          const base = e.shiftKey ? S.current.selected : [];
          if (!e.shiftKey) setSelected([]);
          gesture.current = { kind: "marquee", x0: p.x, y0: p.y, base };
        }
        return;
      }
      case "pen":
      case "highlighter": {
        const hl = t === "highlighter";
        const pressure = e.pointerType === "pen" && e.pressure > 0 && e.pressure !== 0.5;
        gesture.current = {
          kind: "ink",
          id: uid(),
          pts: [[p.x, p.y, pressure ? e.pressure : 0.5]],
          pressure,
          highlighter: hl,
          color: hl ? s.hlColor : s.stroke,
          size: hl ? s.penSize * 3 : s.penSize,
        };
        updateInkDraft();
        return;
      }
      case "shape":
        gesture.current = { kind: "shape", id: uid(), x0: p.x, y0: p.y, el: null };
        return;
      case "line":
      case "arrow":
        gesture.current = { kind: "line", id: uid(), x0: p.x, y0: p.y, arrow: t === "arrow", el: null };
        return;
      case "eraser": {
        gesture.current = { kind: "erase", ids: new Set(), lx: p.x, ly: p.y };
        eraseAt(p.x, p.y);
        return;
      }
      case "laser":
        gesture.current = { kind: "laser" };
        laserBatch.push([p.x, p.y]);
        laserLocal.current?.(p.x, p.y);
        return;
      case "text":
      case "note":
      case "table": {
        const el = hitId ? store.get(hitId) : null;
        if (el && isRichText(el)) {
          enterEdit(el.id);
          setToolState("select");
          return;
        }
        createRich(t, p.x, p.y);
        return;
      }
    }
  };

  const updateInkDraft = () => {
    const g = gesture.current;
    if (g?.kind !== "ink") return;
    const el = makeInk(g.id, g.pts, {
      color: g.color,
      size: g.size,
      highlighter: g.highlighter,
      pressure: g.pressure,
      z: 0,
    });
    setDraft(el);
    sendDraft(el);
  };

  const eraseAt = (x: number, y: number) => {
    const g = gesture.current;
    if (g?.kind !== "erase") return;
    const r = 8 / cam.get().z;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - g.lx, y - g.ly) / (r * 0.8)));
    const all = store.all();
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const px = g.lx + ((x - g.lx) * i) / steps;
      const py = g.ly + ((y - g.ly) * i) / steps;
      for (let j = all.length - 1; j >= 0; j--) {
        const el = all[j];
        if (g.ids.has(el.id) || el.locked || lockedByOther(el.id)) continue;
        if (hitTest(el, px, py, r)) {
          g.ids.add(el.id);
          changed = true;
        }
      }
    }
    g.lx = x;
    g.ly = y;
    if (changed) setErasing(new Set(g.ids));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportSize();
    const sx = e.clientX - vp.left;
    const sy = e.clientY - vp.top;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: sx, y: sy });
    const p = toWorld(e.clientX, e.clientY);
    lastPointer.current = p;
    if (e.pointerType !== "touch" || pointers.current.size < 2) sendCursor({ x: p.x, y: p.y });

    const g = gesture.current;
    if (!g) return;

    switch (g.kind) {
      case "pinch": {
        if (pointers.current.size < 2) return;
        const [a, b] = Array.from(pointers.current.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const z = clamp((g.z0 * d) / g.d0, 0.1, 5);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        cam.set({ x: g.wx - mx / z, y: g.wy - my / z, z });
        return;
      }
      case "pan":
        cam.panBy(e.clientX - g.sx, e.clientY - g.sy);
        g.sx = e.clientX;
        g.sy = e.clientY;
        return;
      case "ink": {
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        const minDist = 0.75 / cam.get().z;
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const q = toWorld(ev.clientX, ev.clientY);
          const last = g.pts[g.pts.length - 1];
          if (Math.hypot(q.x - last[0], q.y - last[1]) < minDist) continue;
          g.pts.push([q.x, q.y, g.pressure ? ev.pressure : 0.5]);
        }
        updateInkDraft();
        return;
      }
      case "shape": {
        let x2 = p.x;
        let y2 = p.y;
        if (e.shiftKey) {
          const d = Math.max(Math.abs(x2 - g.x0), Math.abs(y2 - g.y0));
          x2 = g.x0 + Math.sign(x2 - g.x0 || 1) * d;
          y2 = g.y0 + Math.sign(y2 - g.y0 || 1) * d;
        }
        const r = normalizeRect(g.x0, g.y0, x2, y2);
        const s = S.current.style;
        g.el = {
          id: g.id,
          type: "shape",
          shape: s.shape,
          ...r,
          z: 0,
          stroke: s.stroke,
          fill: s.fill,
          strokeWidth: s.strokeWidth,
          dash: s.dash,
          fontSize: s.fontSize,
        };
        setDraft(g.el);
        sendDraft(g.el);
        return;
      }
      case "line": {
        const q = e.shiftKey ? snapAngle(g.x0, g.y0, p.x, p.y) : p;
        const s = S.current.style;
        g.el = {
          id: g.id,
          type: "line",
          ...lineFromPoints(g.x0, g.y0, q.x, q.y),
          z: 0,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          dash: s.dash,
          arrowEnd: g.arrow ? s.arrowEnd || !s.arrowStart : undefined,
          arrowStart: g.arrow ? s.arrowStart : undefined,
        };
        setDraft(g.el);
        sendDraft(g.el);
        return;
      }
      case "move": {
        if (!g.moved) {
          if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
          g.moved = true;
          store.beginTx();
          if (g.alt) {
            const clones = cloneElements(g.origins, 0, 0, store.maxZ() + 1);
            store.commit({ upsert: clones });
            g.origins = clones;
            g.ids = clones.map((c) => c.id);
            setSelected(g.ids);
          }
        }
        let dx = p.x - g.wx;
        let dy = p.y - g.wy;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        store.live(g.origins.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })));
        return;
      }
      case "resize": {
        const { b0, handle, origins } = g;
        let x1 = b0.x,
          y1 = b0.y,
          x2 = b0.x + b0.w,
          y2 = b0.y + b0.h;
        if (handle.includes("w")) x1 = Math.min(p.x, x2 - 8);
        if (handle.includes("e")) x2 = Math.max(p.x, x1 + 8);
        if (handle.includes("n")) y1 = Math.min(p.y, y2 - 8);
        if (handle.includes("s")) y2 = Math.max(p.y, y1 + 8);
        let sx = (x2 - x1) / (b0.w || 1);
        let sy = (y2 - y1) / (b0.h || 1);
        const single = origins.length === 1 ? origins[0] : null;
        const textOnly = single && (single.type === "text" || single.type === "table");
        if (textOnly) {
          sy = 1;
        } else {
          const keep = handle.length === 2 && ((single?.type === "image") !== e.shiftKey || origins.length > 1);
          if (keep) {
            const k = Math.max(sx, sy);
            sx = sy = k;
            if (handle.includes("w")) x1 = x2 - b0.w * k;
            if (handle.includes("n")) y1 = y2 - b0.h * k;
          }
          if (handle === "n" || handle === "s") sx = 1;
          if (handle === "e" || handle === "w") sy = 1;
          if (handle === "n" || handle === "s") x1 = b0.x;
          if (handle === "e" || handle === "w") y1 = b0.y;
        }
        store.live(origins.map((o) => scaleElement(o, b0, x1, y1, sx, sy)));
        return;
      }
      case "line-end": {
        const o = g.origin;
        const pts = o.points.map(([px, py]) => [o.x + px, o.y + py]);
        const other = pts[g.which === 0 ? 1 : 0];
        const q = e.shiftKey ? snapAngle(other[0], other[1], p.x, p.y) : p;
        pts[g.which] = [q.x, q.y];
        store.live([{ ...o, ...lineFromPoints(pts[0][0], pts[0][1], pts[1][0], pts[1][1]) }]);
        return;
      }
      case "marquee": {
        const r = normalizeRect(g.x0, g.y0, p.x, p.y);
        setMarquee(r);
        const hits = store
          .all()
          .filter((el) => rectsIntersect(r, el) && !lockedByOther(el.id))
          .map((el) => el.id);
        setSelected(Array.from(new Set([...g.base, ...hits])));
        return;
      }
      case "erase":
        eraseAt(p.x, p.y);
        return;
      case "laser":
        laserBatch.push([p.x, p.y]);
        laserLocal.current?.(p.x, p.y);
        return;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "pinch") {
      if (pointers.current.size < 2) gesture.current = null;
      return;
    }
    finishGesture(e.type === "pointercancel");
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // pointer capture khiến e.target là viewport → tìm phần tử thật dưới con trỏ
    const target = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement;
    if (target.closest("[data-editing]") || target.closest("[data-ui]")) return;
    if (S.current.tool !== "select") return;
    const hitId = target.closest<HTMLElement>("[data-el]")?.dataset.el;
    const el = hitId ? store.get(hitId) : null;
    if (el && (isRichText(el) || el.type === "shape")) {
      enterEdit(el.id);
      return;
    }
    if (!el) {
      const p = toWorld(e.clientX, e.clientY);
      createRich("text", p.x, p.y);
    }
  };

  // ───────────── lăn chuột: pan / zoom ─────────────
  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-ui]")) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const r = v.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const z = cam.get().z;
        cam.zoomAt(e.clientX - r.left, e.clientY - r.top, z * Math.exp((-e.deltaY * k) / 240));
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        cam.panBy(-dx * k, -dy * k);
      }
    };
    // Safari pinch
    const onGesture = (e: Event) => e.preventDefault();
    v.addEventListener("wheel", onWheel, { passive: false });
    v.addEventListener("gesturestart", onGesture);
    return () => {
      v.removeEventListener("wheel", onWheel);
      v.removeEventListener("gesturestart", onGesture);
    };
  }, [cam]);

  // ───────────── bàn phím ─────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("[data-modal-open]")) return;
      // Đang sửa chữ nhưng editor chưa kịp nhận focus → giữ lại phím gõ, không chạy phím tắt
      if (S.current.editingId) {
        const buf = typeBuffer.current;
        if (e.key === "Escape") exitEdit();
        else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && Date.now() - buf.since < 1500) {
          e.preventDefault();
          buf.text += e.key;
        }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (e.code === "Space" && !mod) {
        e.preventDefault();
        if (!e.repeat) setSpaceDown(true);
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && k === "a") {
        e.preventDefault();
        setToolState("select");
        setSelected(store.all().filter((el) => !lockedByOther(el.id)).map((el) => el.id));
        return;
      }
      if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        zoomBy(1);
        return;
      }
      if (mod && (k === "-" || k === "_")) {
        e.preventDefault();
        zoomBy(-1);
        return;
      }
      if (mod && k === "0") {
        e.preventDefault();
        resetZoom();
        return;
      }
      if (mod && k === "]") {
        e.preventDefault();
        reorder("front");
        return;
      }
      if (mod && k === "[") {
        e.preventDefault();
        reorder("back");
        return;
      }
      if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        fitAll();
        return;
      }
      if (mod) return;
      if (e.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
        return;
      }
      if (e.key === "Escape") {
        if (gesture.current) finishGesture(true);
        setSelected([]);
        setToolState("select");
        return;
      }
      if (e.key === "Enter") {
        const sel = S.current.selected;
        if (sel.length === 1) {
          e.preventDefault();
          enterEdit(sel[0]);
        }
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const sel = S.current.selected
          .map((id) => store.get(id))
          .filter((x): x is BoardElement => !!x && !x.locked);
        if (!sel.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        store.commit({ upsert: sel.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy })) });
        return;
      }
      const t = TOOL_KEYS[k];
      if (t && !e.altKey) {
        if (k === "r" || k === "o" || k === "d") {
          const shape = k === "r" ? "rect" : k === "o" ? "ellipse" : "diamond";
          setStyle((s) => ({ ...s, shape }));
        }
        setTool(t);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    const onBlur = () => setSpaceDown(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [store, undo, redo, duplicateSelected, removeSelected, reorder, zoomBy, resetZoom, fitAll, enterEdit, exitEdit, setTool, finishGesture, lockedByOther]);

  // ───────────── clipboard ─────────────
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      // người dùng đang bôi đen chữ thật (vd. trong khung chat) → để trình duyệt copy chữ
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const els = S.current.selected.map((id) => store.get(id)).filter(Boolean) as BoardElement[];
      if (!els.length) return;
      e.preventDefault();
      clipboard.current = els;
      pasteCount.current = 0;
      e.clipboardData?.setData("text/plain", CLIP_MARKER + JSON.stringify(els));
      if (e.type === "cut") removeSelected();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
      const at = lastPointer.current ?? viewportCenter();
      if (files.length) {
        e.preventDefault();
        void addImages(files, at);
        return;
      }
      const text = dt.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      if (text.startsWith(CLIP_MARKER)) {
        try {
          const els = JSON.parse(text.slice(CLIP_MARKER.length)) as BoardElement[];
          if (!Array.isArray(els) || !els.length) return;
          pasteCount.current++;
          const b = unionBounds(els)!;
          // dán tại con trỏ; nếu dán lại nhiều lần thì lệch dần
          const dx = at.x - (b.x + b.w / 2) + (pasteCount.current - 1) * 16;
          const dy = at.y - (b.y + b.h / 2) + (pasteCount.current - 1) * 16;
          const clones = cloneElements(els, dx, dy, store.maxZ() + 1);
          store.commit({ upsert: clones });
          setToolState("select");
          setSelected(clones.map((c) => c.id));
        } catch {
          toast.error("Dữ liệu dán không hợp lệ");
        }
        return;
      }
      // văn bản thường → khối chữ
      const st = S.current.style;
      const long = text.length > 60 || text.includes("\n");
      const el: TextEl = {
        id: uid(),
        type: "text",
        x: at.x,
        y: at.y,
        w: long ? 420 : 24,
        h: st.fontSize * 1.5,
        z: store.maxZ() + 1,
        doc: textDoc(text.slice(0, 20000)),
        color: st.textColor,
        fontSize: st.fontSize,
        autoW: !long,
      };
      store.commit({ upsert: [el] });
      setToolState("select");
      setSelected([el.id]);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [store, addImages, removeSelected, viewportCenter]);

  // ───────────── render ─────────────
  const drafts = useMemo(() => {
    const list = Array.from(remoteDrafts.values());
    if (draft) list.push(draft);
    return list;
  }, [remoteDrafts, draft]);

  const cursor = panning
    ? "grabbing"
    : spaceDown || tool === "hand"
      ? "grab"
      : tool === "select"
        ? "default"
        : tool === "text"
          ? "text"
          : tool === "eraser"
            ? ERASER_CURSOR
            : tool === "laser"
              ? LASER_CURSOR
              : "crosshair";

  return (
    <>
      <div
        ref={viewportRef}
        className="board-grid absolute inset-0 touch-none overflow-hidden select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") {
            sendCursor.cancel();
            bus.send("cursor", null);
          }
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files);
          if (!files.length) return;
          e.preventDefault();
          void addImages(files, toWorld(e.clientX, e.clientY));
        }}
      >
        <div ref={worldRef} className="absolute top-0 left-0 origin-top-left">
          <ElementsLayer
            version={version}
            store={store}
            cam={cam}
            editingId={editingId}
            erasing={erasing}
            onExitEdit={exitEdit}
            takeTyped={takeTyped}
          />
          <div data-overlay>
            <RemoteSelections
              selections={remoteSel}
              locks={locks}
              peers={peers}
              getEl={(id) => store.get(id)}
              cam={cam}
              version={version}
            />
            <DraftLayer drafts={drafts} />
            <SelectionOverlay
              els={selectedEls}
              cam={cam}
              showHandles={!editingId}
            />
            <MarqueeOverlay rect={marquee} cam={cam} />
            <LaserLayer bus={bus} peers={peers} cam={cam} selfColor={me.color} localRef={laserLocal} />
            <RemoteCursors bus={bus} peers={peers} cam={cam} />
          </div>
        </div>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-3 rounded-full bg-panel px-4 py-2 text-sm text-ink-2 shadow-float">
              <span className="spinner" /> Đang tải bảng…
            </div>
          </div>
        )}
        {!loading && store.size === 0 && !draft && (
          <EmptyHint />
        )}
      </div>

      <Toolbar
        tool={tool}
        shape={style.shape}
        onTool={setTool}
        className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 xl:top-3 xl:bottom-auto"
      />
      <StylePanel
          tool={tool}
          style={style}
          selection={selectedEls}
          onStyle={onStyle}
          actions={{
            front: () => reorder("front"),
            back: () => reorder("back"),
            duplicate: duplicateSelected,
            remove: removeSelected,
            toggleLock,
          }}
        />
      <ZoomBar
        cam={cam}
        onZoom={zoomBy}
        onReset={resetZoom}
        onFit={fitAll}
        onUndo={undo}
        onRedo={redo}
        canUndo={store.canUndo()}
        canRedo={store.canRedo()}
      />
      <MobileUndo onUndo={undo} onRedo={redo} canUndo={store.canUndo()} canRedo={store.canRedo()} />
      <BoardMenu onExport={exportPng} onClear={clearBoard} onHelp={() => setHelpOpen(true)} exporting={exporting} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void addImages(files);
        }}
      />
    </>
  );
}

const ElementsLayer = memo(function ElementsLayer({
  version,
  store,
  cam,
  editingId,
  erasing,
  onExitEdit,
  takeTyped,
}: {
  version: number;
  store: BoardStore;
  cam: CameraStore;
  editingId: string | null;
  erasing: Set<string>;
  onExitEdit: () => void;
  takeTyped: () => string;
}) {
  void version;
  return (
    <>
      {store.all().map((el) => (
        <ElementView
          key={el.id}
          el={el}
          editing={el.id === editingId}
          dim={erasing.has(el.id)}
          store={store}
          cam={cam}
          onExitEdit={onExitEdit}
          takeTyped={takeTyped}
        />
      ))}
    </>
  );
});

function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="fade-in max-w-sm text-center">
        <div className="mb-2 text-[22px] font-semibold text-ink-2">Bảng đang trống</div>
        <p className="text-sm leading-relaxed text-ink-3">
          Chọn bút để vẽ, nhấp đúp để viết chữ, hoặc thêm ghi chú, bảng biểu, ảnh từ thanh công cụ. Gửi link phòng để mời
          bạn bè cùng vẽ.
        </p>
      </div>
    </div>
  );
}

const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="7" fill="white" fill-opacity=".6" stroke="#1e1e1e" stroke-width="1.5"/></svg>',
)}") 10 10, auto`;
const LASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4.5" fill="#ff3b30" stroke="white" stroke-width="1.5"/></svg>',
)}") 8 8, auto`;


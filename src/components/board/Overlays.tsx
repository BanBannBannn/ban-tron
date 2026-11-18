"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { BoardElement, LineEl, Rect } from "@/lib/board/types";
import { unionBounds } from "@/lib/board/geometry";
import { useZoom, type CameraStore } from "@/lib/board/camera";
import type { Peer, RoomBus } from "@/lib/realtime";
import { InkSvg, LineSvg, ShapeSvg } from "./ElementView";

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const ALL_HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSORS: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

export function handlesFor(els: BoardElement[]): Handle[] {
  if (els.length === 1) {
    const t = els[0].type;
    if (t === "text" || t === "table") return ["e", "w"];
    if (t === "line") return [];
    if (els[0].locked) return [];
  }
  if (els.some((e) => e.locked)) return [];
  return ALL_HANDLES;
}

/** Khung chọn + tay cầm (nằm trong lớp thế giới, kích thước bù theo zoom). */
export function SelectionOverlay({
  els,
  cam,
  showHandles,
}: {
  els: BoardElement[];
  cam: CameraStore;
  showHandles: boolean;
}) {
  const z = useZoom(cam);
  if (!els.length) return null;
  const b = unionBounds(els)!;
  const pad = 4 / z;
  const bw = 1.5 / z;
  const hs = 10 / z;

  if (els.length === 1 && els[0].type === "line") {
    const l = els[0] as LineEl;
    return (
      <>
        {l.points.map(([px, py], i) => (
          <div
            key={i}
            data-handle={`p${i}`}
            className="absolute rounded-full border-accent bg-white shadow-sm"
            style={{
              left: l.x + px - hs * 0.65,
              top: l.y + py - hs * 0.65,
              width: hs * 1.3,
              height: hs * 1.3,
              borderWidth: bw * 1.3,
              cursor: "move",
              pointerEvents: showHandles ? "auto" : "none",
              zIndex: 20,
            }}
          />
        ))}
      </>
    );
  }

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: b.x - pad, top: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, zIndex: 20 }}
    >
      <div
        className="absolute inset-0 rounded-[2px] border-accent"
        style={{ borderWidth: bw, borderStyle: els[0].locked ? "dashed" : "solid" }}
      />
      {els.length > 1 &&
        els.map((e) => (
          <div
            key={e.id}
            className="absolute border-accent/50"
            style={{
              left: e.x - b.x + pad,
              top: e.y - b.y + pad,
              width: e.w,
              height: e.h,
              borderWidth: 1 / z,
            }}
          />
        ))}
      {showHandles &&
        handlesFor(els).map((h) => {
          const left = h.includes("w") ? 0 : h.includes("e") ? 1 : 0.5;
          const top = h.includes("n") ? 0 : h.includes("s") ? 1 : 0.5;
          const side = h.length === 1;
          return (
            <div
              key={h}
              data-handle={h}
              className="pointer-events-auto absolute border-accent bg-white shadow-sm"
              style={{
                left: `calc(${left * 100}% - ${hs / 2}px)`,
                top: `calc(${top * 100}% - ${hs / 2}px)`,
                width: hs,
                height: hs,
                borderWidth: bw,
                borderRadius: side ? hs : 3 / z,
                cursor: CURSORS[h],
              }}
            />
          );
        })}
    </div>
  );
}

export function MarqueeOverlay({ rect, cam }: { rect: Rect | null; cam: CameraStore }) {
  const z = useZoom(cam);
  if (!rect) return null;
  return (
    <div
      className="pointer-events-none absolute border-accent bg-accent/8"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderWidth: 1 / z, zIndex: 30 }}
    />
  );
}

/** Viền màu cho phần tử người khác đang chọn / đang sửa. */
export const RemoteSelections = memo(function RemoteSelections({
  selections,
  locks,
  peers,
  getEl,
  cam,
  version,
}: {
  selections: Map<string, string[]>;
  locks: Map<string, string>;
  peers: Peer[];
  getEl: (id: string) => BoardElement | undefined;
  cam: CameraStore;
  version: number;
}) {
  const z = useZoom(cam);
  void version;
  const byId = new Map(peers.map((p) => [p.id, p]));
  const items: React.ReactNode[] = [];
  for (const [uid, ids] of selections) {
    const peer = byId.get(uid);
    if (!peer) continue;
    const els = ids.map(getEl).filter(Boolean) as BoardElement[];
    const b = unionBounds(els);
    if (!b) continue;
    const pad = 6 / z;
    items.push(
      <div
        key={`sel-${uid}`}
        className="pointer-events-none absolute rounded-[3px]"
        style={{
          left: b.x - pad,
          top: b.y - pad,
          width: b.w + pad * 2,
          height: b.h + pad * 2,
          border: `${1.5 / z}px solid ${peer.color}`,
          zIndex: 15,
        }}
      />,
    );
  }
  for (const [elId, uid] of locks) {
    const peer = byId.get(uid);
    const el = getEl(elId);
    if (!peer || !el) continue;
    const pad = 6 / z;
    items.push(
      <div
        key={`lock-${elId}`}
        className="pointer-events-none absolute rounded-[3px]"
        style={{
          left: el.x - pad,
          top: el.y - pad,
          width: el.w + pad * 2,
          height: el.h + pad * 2,
          border: `${2 / z}px solid ${peer.color}`,
          zIndex: 15,
        }}
      >
        <span
          className="absolute -top-px left-0 -translate-y-full rounded-t-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white"
          style={{ background: peer.color, transform: `translateY(-100%) scale(${1 / z})`, transformOrigin: "bottom left" }}
        >
          {peer.name} đang sửa…
        </span>
      </div>,
    );
  }
  return <>{items}</>;
});

/** Nét đang vẽ (của mình và người khác). */
export function DraftLayer({ drafts }: { drafts: BoardElement[] }) {
  return (
    <>
      {drafts.map((d) => (
        <div
          key={d.id}
          className="pointer-events-none absolute"
          style={{ left: d.x, top: d.y, width: d.w, height: d.h, zIndex: 12 }}
        >
          {d.type === "ink" ? (
            <InkSvg el={d} live />
          ) : d.type === "shape" ? (
            <ShapeSvg el={d} />
          ) : d.type === "line" ? (
            <LineSvg el={d} live />
          ) : null}
        </div>
      ))}
    </>
  );
}

/** Con trỏ của người khác – cập nhật DOM trực tiếp, không qua React state. */
export function RemoteCursors({ bus, peers, cam }: { bus: RoomBus; peers: Peer[]; cam: CameraStore }) {
  const z = useZoom(cam);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const pos = useRef(new Map<string, { x: number; y: number; t: number } | null>());
  const zRef = useRef(z);

  useEffect(() => {
    zRef.current = z;
    for (const [id, node] of nodes.current) place(node, pos.current.get(id) ?? null, z);
  }, [z]);

  useEffect(() => {
    const off = bus.on("cursor", (d: { x?: unknown; y?: unknown } | null, from: string) => {
      const ok = d && Number.isFinite(d.x) && Number.isFinite(d.y);
      const p = ok ? { x: d.x as number, y: d.y as number, t: Date.now() } : null;
      pos.current.set(from, p);
      const node = nodes.current.get(from);
      if (node) place(node, p, zRef.current);
    });
    const offLeave = bus.on("peer-leave", (p?: Peer) => {
      if (p) pos.current.delete(p.id);
    });
    // làm mờ con trỏ đứng yên lâu
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [id, p] of pos.current) {
        const node = nodes.current.get(id);
        if (node && p) node.style.opacity = now - p.t > 15000 ? "0" : "1";
      }
    }, 2000);
    return () => {
      off();
      offLeave();
      clearInterval(timer);
    };
  }, [bus]);

  return (
    <>
      {peers.map((peer) => (
        <div
          key={peer.id}
          ref={(n) => {
            if (n) {
              nodes.current.set(peer.id, n);
              place(n, pos.current.get(peer.id) ?? null, zRef.current);
            } else nodes.current.delete(peer.id);
          }}
          className="remote-cursor pointer-events-none absolute top-0 left-0"
          style={{ zIndex: 50, opacity: 0 }}
        >
          <svg width="20" height="22" viewBox="0 0 20 22" className="drop-shadow-sm">
            <path
              d="M2 2 L2 18 L6.5 14 L9.5 20.5 L12.5 19.2 L9.6 12.8 L15.5 12.6 Z"
              fill={peer.color}
              stroke="white"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className="absolute top-[18px] left-[12px] rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-sm"
            style={{ background: peer.color }}
          >
            {peer.name}
          </span>
        </div>
      ))}
    </>
  );
}

function place(node: HTMLDivElement, p: { x: number; y: number } | null, z: number) {
  if (!p) {
    node.style.opacity = "0";
    return;
  }
  node.style.opacity = "1";
  node.style.transform = `translate(${p.x}px, ${p.y}px) scale(${1 / z})`;
}

/** Bút laser: vệt sáng mờ dần, không lưu lại. */
interface LaserSeg {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number;
}

const LASER_TTL = 900;

export function LaserLayer({
  bus,
  peers,
  cam,
  selfColor,
  localRef,
}: {
  bus: RoomBus;
  peers: Peer[];
  cam: CameraStore;
  selfColor: string;
  localRef: React.MutableRefObject<((x: number, y: number) => void) | null>;
}) {
  const z = useZoom(cam);
  const [segs, setSegs] = useState<LaserSeg[]>([]);
  const peersRef = useRef(peers);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    const trails = new Map<string, { color: string; pts: { x: number; y: number; t: number }[] }>();
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const out: LaserSeg[] = [];
      for (const [k, tr] of trails) {
        tr.pts = tr.pts.filter((p) => now - p.t < LASER_TTL);
        if (!tr.pts.length) {
          trails.delete(k);
          continue;
        }
        for (let i = 1; i < tr.pts.length; i++) {
          const a = tr.pts[i - 1];
          const b = tr.pts[i];
          out.push({ key: `${k}-${b.t}-${i}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: tr.color, life: 1 - (now - b.t) / LASER_TTL });
        }
      }
      setSegs(out);
      raf = trails.size ? requestAnimationFrame(tick) : 0;
    };
    const add = (key: string, color: string, pts: [number, number][]) => {
      let tr = trails.get(key);
      if (!tr) trails.set(key, (tr = { color, pts: [] }));
      const now = Date.now();
      for (const [x, y] of pts) tr.pts.push({ x, y, t: now });
      if (!raf) raf = requestAnimationFrame(tick);
    };
    localRef.current = (x, y) => add("me", "#ff3b30", [[x, y]]);
    const off = bus.on("laser", (raw: unknown, from: string) => {
      const peer = peersRef.current.find((p) => p.id === from);
      if (!peer || !Array.isArray(raw)) return;
      const pts = raw
        .slice(0, 200)
        .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      add(from, peer.color, pts);
    });
    return () => {
      off();
      localRef.current = null;
      cancelAnimationFrame(raf);
    };
  }, [bus, selfColor, localRef]);

  if (!segs.length) return null;
  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} style={{ zIndex: 60 }}>
      {segs.map((s) => (
        <line
          key={s.key}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={s.color}
          strokeOpacity={Math.max(0, s.life)}
          strokeWidth={(3 + 4 * s.life) / z}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 ${4 / z}px ${s.color})` }}
        />
      ))}
    </svg>
  );
}

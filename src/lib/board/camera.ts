"use client";

import { useSyncExternalStore } from "react";
import type { Camera } from "./types";
import { clamp } from "../utils";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

/** Camera tách khỏi React state để pan/zoom 60fps không phải render lại cả bảng. */
export class CameraStore {
  private cam: Camera = { x: 0, y: 0, z: 1 };
  private listeners = new Set<() => void>();

  get = () => this.cam;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  set(next: Camera) {
    const z = clamp(next.z, MIN_ZOOM, MAX_ZOOM);
    if (next.x === this.cam.x && next.y === this.cam.y && z === this.cam.z) return;
    this.cam = { x: next.x, y: next.y, z };
    this.listeners.forEach((l) => l());
  }

  panBy(dxScreen: number, dyScreen: number) {
    const c = this.cam;
    this.set({ x: c.x - dxScreen / c.z, y: c.y - dyScreen / c.z, z: c.z });
  }

  /** Zoom quanh một điểm màn hình (sx, sy). */
  zoomAt(sx: number, sy: number, nextZ: number) {
    const c = this.cam;
    const z = clamp(nextZ, MIN_ZOOM, MAX_ZOOM);
    const wx = sx / c.z + c.x;
    const wy = sy / c.z + c.y;
    this.set({ x: wx - sx / z, y: wy - sy / z, z });
  }

  /** Di chuyển mượt tới camera đích. */
  animateTo(target: Camera, ms = 320) {
    const from = { ...this.cam };
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      this.set({
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        z: from.z + (target.z - from.z) * k,
      });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

export function useCamera(store: CameraStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useZoom(store: CameraStore) {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get().z,
    () => 1,
  );
}

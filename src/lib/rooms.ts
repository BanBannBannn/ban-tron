"use client";

import { useSyncExternalStore } from "react";
import { safeStorage } from "./utils";

const LETTERS = "abcdefghijkmnopqrstuvwxyz";

/** Mã phòng dạng "abc-defg-hij" (dễ đọc, dễ gõ). */
export function randomSlug() {
  const part = (n: number) => {
    const arr = new Uint32Array(n);
    crypto.getRandomValues(arr);
    return Array.from(arr, (v) => LETTERS[v % LETTERS.length]).join("");
  };
  return `${part(3)}-${part(4)}-${part(3)}`;
}

/** Chấp nhận cả link đầy đủ lẫn mã phòng. */
export function parseRoomInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const fromUrl = s.match(/\/r\/([a-z0-9-]{3,40})/i);
  const slug = (fromUrl ? fromUrl[1] : s).toLowerCase();
  return /^[a-z0-9-]{3,40}$/.test(slug) ? slug : null;
}

export interface RecentRoom {
  slug: string;
  name: string;
  visitedAt: number;
}

const KEY = "bantron:recent";

const listeners = new Set<() => void>();
let snapshot: RecentRoom[] | null = null;
const EMPTY: RecentRoom[] = [];

function readRecent(): RecentRoom[] {
  try {
    const raw = safeStorage()?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentRoom[]) : [];
    return Array.isArray(list) ? list.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function getRecentRooms(): RecentRoom[] {
  snapshot ??= readRecent();
  return snapshot;
}

function changed() {
  snapshot = null;
  listeners.forEach((l) => l());
}

export function useRecentRooms() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getRecentRooms,
    () => EMPTY,
  );
}

export function rememberRoom(room: { slug: string; name: string }) {
  try {
    const list = getRecentRooms().filter((r) => r.slug !== room.slug);
    list.unshift({ slug: room.slug, name: room.name, visitedAt: Date.now() });
    safeStorage()?.setItem(KEY, JSON.stringify(list.slice(0, 8)));
  } catch {}
  changed();
}

export function forgetRoom(slug: string) {
  try {
    const list = getRecentRooms().filter((r) => r.slug !== slug);
    safeStorage()?.setItem(KEY, JSON.stringify(list));
  } catch {}
  changed();
}

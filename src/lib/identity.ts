"use client";

import { useSyncExternalStore } from "react";
import { safeStorage } from "./utils";

export const USER_COLORS = [
  "#e8590c",
  "#e03131",
  "#c2255c",
  "#9c36b5",
  "#6741d9",
  "#3b5bdb",
  "#1971c2",
  "#0c8599",
  "#099268",
  "#2f9e44",
  "#66a80f",
  "#f08c00",
];

const ANIMALS = [
  "Mèo", "Cáo", "Gấu", "Thỏ", "Hươu", "Cú", "Rái cá", "Chim sẻ", "Cá heo", "Sóc",
  "Hổ", "Voi", "Chim cánh cụt", "Gấu trúc", "Tắc kè", "Ong", "Rùa", "Khỉ",
];
const ADJ = [
  "Vui vẻ", "Lém lỉnh", "Tò mò", "Chăm chỉ", "Mơ mộng", "Nhanh nhẹn", "Hiền lành",
  "Sáng tạo", "Bình tĩnh", "Dũng cảm", "Tinh nghịch", "Thông thái",
];

export function randomName() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const b = ADJ[Math.floor(Math.random() * ADJ.length)];
  return `${a} ${b}`;
}

export function randomColor() {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

export interface Identity {
  name: string;
  color: string;
  /** đã tự đặt tên chưa (để hiện hộp thoại chào lần đầu) */
  confirmed: boolean;
}

const KEY = "bantron:identity";
const listeners = new Set<() => void>();
const changeHooks = new Set<() => void>();

/** Lắng nghe khi người dùng đổi tên/màu (dùng để đồng bộ lên hồ sơ tài khoản). */
export function onIdentityChange(fn: () => void) {
  changeHooks.add(fn);
  return () => changeHooks.delete(fn);
}
let cached: Identity | null = null;

function read(): Identity {
  if (cached) return cached;
  const ls = safeStorage();
  try {
    const raw = ls?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed.name && parsed.color) {
        cached = { name: parsed.name, color: parsed.color, confirmed: !!parsed.confirmed };
        return cached;
      }
    }
  } catch {}
  cached = { name: randomName(), color: randomColor(), confirmed: false };
  return cached;
}

export function getIdentity() {
  return read();
}

export function setIdentity(patch: Partial<Identity>) {
  cached = { ...read(), ...patch };
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(cached));
  } catch {}
  listeners.forEach((l) => l());
  changeHooks.forEach((h) => h());
}

const SERVER: Identity = { name: "", color: USER_COLORS[0], confirmed: true };

export function useIdentity(): Identity {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => SERVER,
  );
}

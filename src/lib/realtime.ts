"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { roomChannelConfig, roomTopic } from "./channel";
import { isUuid, safeColor, safeName } from "./board/sanitize";

export interface Peer {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
}

export type ConnStatus = "connecting" | "connected" | "reconnecting";

/** Các sự kiện broadcast trong phòng. */
export const BROADCAST_EVENTS = [
  "cursor", // vị trí con trỏ
  "el", // thêm/sửa/xoá phần tử (chốt)
  "el-live", // thay đổi tạm thời khi đang kéo/vẽ
  "draft", // nét đang vẽ
  "sel", // vùng đang chọn
  "lock", // đang chỉnh sửa phần tử
  "laser", // bút laser
  "typing", // đang gõ chat
  "hello", // người mới vào → nhờ gửi lại trạng thái
  "room", // đổi tên / cài đặt phòng (người nhận đọc lại từ DB)
  "member", // chủ phòng duyệt / mời ra (người nhận tự kiểm tra lại quyền với DB)
] as const;

export type BroadcastEvent = (typeof BROADCAST_EVENTS)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (data: any, from: string) => void;

export class RoomBus {
  private handlers = new Map<string, Set<Handler>>();
  channel: RealtimeChannel | null = null;
  connected = false;
  selfId = "";

  on(event: string, h: Handler) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(h);
    return () => {
      set!.delete(h);
    };
  }

  emit(event: string, data: unknown, from = "") {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(data, from);
      } catch (err) {
        console.error(`[bus] ${event}`, err);
      }
    });
  }

  attach(channel: RealtimeChannel, selfId: string) {
    this.channel = channel;
    this.selfId = selfId;
  }

  setConnected(v: boolean) {
    this.connected = v;
  }

  detach() {
    this.connected = false;
    this.channel = null;
  }

  track(meta: Record<string, unknown>) {
    if (this.connected && this.channel) void this.channel.track(meta);
  }

  send(event: BroadcastEvent, data: unknown) {
    if (!this.channel || !this.connected) return;
    void this.channel.send({ type: "broadcast", event, payload: { from: this.selfId, data } });
  }
}

interface Options {
  roomId: string;
  userId: string;
  name: string;
  color: string;
}

export function useRoomRealtime({ roomId, userId, name, color }: Options) {
  const [bus] = useState(() => new RoomBus());
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const meRef = useRef({ name, color });
  const joinedAt = useRef(0);
  useEffect(() => {
    meRef.current = { name, color };
  });

  useEffect(() => {
    const sb = getSupabase();
    if (!joinedAt.current) joinedAt.current = Date.now();
    const ch = sb.channel(roomTopic(roomId), roomChannelConfig(userId));
    bus.attach(ch, userId);

    for (const ev of BROADCAST_EVENTS) {
      ch.on("broadcast", { event: ev }, ({ payload }) => {
        if (!payload || payload.from === userId) return;
        bus.emit(ev, payload.data, payload.from);
      });
    }

    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (p) => bus.emit("message", p.new),
    );

    let prevKeys: Set<string> | null = null;
    let prevPeers = new Map<string, Peer>();
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name?: unknown; color?: unknown; joinedAt?: unknown }>();
      const next = new Map<string, Peer>();
      for (const [key, metas] of Object.entries(state)) {
        if (key === userId || !metas.length || !isUuid(key)) continue;
        const m = metas[metas.length - 1];
        // presence do client khác gửi → không đáng tin
        next.set(key, {
          id: key,
          name: safeName(m.name),
          color: safeColor(m.color, "#868e96"),
          joinedAt: typeof m.joinedAt === "number" && Number.isFinite(m.joinedAt) ? m.joinedAt : Date.now(),
        });
      }
      if (prevKeys) {
        for (const [k, p] of next) if (!prevKeys.has(k)) bus.emit("peer-join", p);
        for (const k of prevKeys) if (!next.has(k)) bus.emit("peer-leave", prevPeers.get(k));
      }
      prevKeys = new Set(next.keys());
      prevPeers = next;
      setPeers(Array.from(next.values()).sort((a, b) => a.joinedAt - b.joinedAt));
    });

    ch.subscribe(async (s) => {
      if (s === "SUBSCRIBED") {
        bus.setConnected(true);
        setStatus("connected");
        await ch.track({ ...meRef.current, joinedAt: joinedAt.current });
        bus.emit("connected", null);
        bus.send("hello", null);
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        bus.setConnected(false);
        setStatus("reconnecting");
      }
    });

    return () => {
      bus.detach();
      void sb.removeChannel(ch);
    };
  }, [bus, roomId, userId]);

  // đổi tên / màu → cập nhật presence
  useEffect(() => {
    bus.track({ name, color, joinedAt: joinedAt.current });
  }, [bus, name, color]);

  return { bus, peers, status };
}

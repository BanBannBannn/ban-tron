"use client";

import { getSupabase } from "../supabase";
import type { RoomBus } from "../realtime";
import { elAad, type RoomCrypto } from "../crypto";
import { fromRow, toRow, type BoardElement, type ElementRow } from "./types";

export interface Change {
  upsert?: BoardElement[];
  remove?: string[];
}

type Snapshot = Map<string, BoardElement | null>;
interface HistoryEntry {
  before: Snapshot;
  after: Snapshot;
}

const HISTORY_LIMIT = 200;
const PERSIST_DELAY = 350;
const LIVE_INTERVAL = 60;

/**
 * Nguồn dữ liệu duy nhất của bảng trắng.
 * - Thay đổi cục bộ → áp dụng ngay, broadcast cho người khác, lưu DB theo lô (debounce).
 * - Thay đổi từ người khác → chỉ áp dụng.
 * - Lịch sử undo/redo chỉ chứa thao tác của chính mình.
 */
export class BoardStore {
  private els = new Map<string, BoardElement>();
  private sortedCache: BoardElement[] | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private tx: Snapshot | null = null;

  private pendingUpsert = new Map<string, BoardElement>();
  private pendingDelete = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private failCount = 0;

  private inflight = new Map<string, BoardElement | null>();
  /** thay đổi từ người khác nhận được trong lúc đang tải DB */
  private touchedWhileLoading: Map<string, BoardElement | null> | null = null;

  /** phần tử bị người khác xoá trong lúc mình đang kéo/sửa → không được "hồi sinh" */
  private removedRemotely = new Set<string>();

  private liveQueue = new Map<string, BoardElement>();
  private liveTimer: ReturnType<typeof setTimeout> | null = null;

  loaded = false;

  constructor(
    private roomId: string,
    private bus: RoomBus,
    private crypto: RoomCrypto,
    private onError: (msg: string) => void,
  ) {}

  /** Mã hoá phần `data` của phần tử trước khi lưu DB (DB chỉ chấp nhận dạng mã hoá). */
  private async encryptRow(el: BoardElement): Promise<ElementRow> {
    const row = toRow(el, this.roomId);
    const enc = await this.crypto.encrypt(JSON.stringify(row.data), elAad(row.id, row.type));
    return { ...row, data: { enc } };
  }

  /** Giải mã một dòng từ DB. Dòng hỏng / bị tráo / không giải mã được → bỏ qua. */
  private async decryptRow(row: ElementRow): Promise<BoardElement | null> {
    try {
      const plain = await this.crypto.decrypt(row.data?.enc, elAad(row.id, row.type));
      const data = JSON.parse(plain) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      return fromRow({ ...row, data: data as Record<string, unknown> });
    } catch {
      return null;
    }
  }

  // ───────────── đọc ─────────────
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getVersion = () => this.version;

  get(id: string) {
    return this.els.get(id);
  }
  has(id: string) {
    return this.els.has(id);
  }
  get size() {
    return this.els.size;
  }

  all(): BoardElement[] {
    if (!this.sortedCache) {
      this.sortedCache = Array.from(this.els.values()).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    }
    return this.sortedCache;
  }

  maxZ() {
    const a = this.all();
    return a.length ? a[a.length - 1].z : 0;
  }
  minZ() {
    const a = this.all();
    return a.length ? a[0].z : 0;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  private bump() {
    this.version++;
    this.sortedCache = null;
    this.listeners.forEach((l) => l());
  }

  private applyRaw(change: Change) {
    for (const el of change.upsert ?? []) this.els.set(el.id, el);
    for (const id of change.remove ?? []) this.els.delete(id);
    this.bump();
  }

  private snapshot(ids: Iterable<string>): Snapshot {
    const s: Snapshot = new Map();
    for (const id of ids) s.set(id, this.els.get(id) ?? null);
    return s;
  }

  private snapshotToChange(s: Snapshot): Change {
    const upsert: BoardElement[] = [];
    const remove: string[] = [];
    for (const [id, el] of s) {
      if (el) upsert.push(el);
      else remove.push(id);
    }
    return { upsert, remove };
  }

  private pushHistory(entry: HistoryEntry) {
    // bỏ entry không đổi gì
    let changed = false;
    for (const [id, b] of entry.before) {
      if (b !== entry.after.get(id)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  // ───────────── ghi (cục bộ) ─────────────

  /** Thay đổi chốt của người dùng. */
  commit(change: Change, opts: { history?: boolean } = {}) {
    const ids = [...(change.upsert ?? []).map((e) => e.id), ...(change.remove ?? [])];
    if (!ids.length) return;
    if (this.tx) {
      if (this.removedRemotely.size) {
        change = { upsert: change.upsert?.filter((e) => !this.removedRemotely.has(e.id)), remove: change.remove };
      }
      for (const id of ids) if (!this.tx.has(id)) this.tx.set(id, this.els.get(id) ?? null);
      this.applyRaw(change);
      return; // sẽ broadcast + lưu khi endTx
    }
    const before = this.snapshot(ids);
    this.applyRaw(change);
    if (opts.history !== false) this.pushHistory({ before, after: this.snapshot(ids) });
    this.publish(change);
  }

  /** Bắt đầu một giao dịch (kéo, đổi kích thước, gõ chữ...). */
  beginTx() {
    if (!this.tx) this.tx = new Map();
  }

  get inTx() {
    return this.tx !== null;
  }

  /** Cập nhật tạm thời trong giao dịch: broadcast liên tục, chưa lưu DB. */
  live(upsert: BoardElement[]) {
    if (!this.tx) this.beginTx();
    if (this.removedRemotely.size) upsert = upsert.filter((el) => !this.removedRemotely.has(el.id));
    if (!upsert.length) return;
    for (const el of upsert) {
      if (!this.tx!.has(el.id)) this.tx!.set(el.id, this.els.get(el.id) ?? null);
      this.liveQueue.set(el.id, el);
    }
    this.applyRaw({ upsert });
    if (!this.liveTimer) {
      this.liveTimer = setTimeout(() => this.flushLive(), LIVE_INTERVAL);
    }
  }

  private flushLive() {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = null;
    if (!this.liveQueue.size) return;
    this.bus.send("el-live", Array.from(this.liveQueue.values()));
    this.liveQueue.clear();
  }

  endTx(opts: { history?: boolean } = {}) {
    const tx = this.tx;
    this.tx = null;
    if (tx) for (const id of this.removedRemotely) tx.delete(id);
    this.removedRemotely.clear();
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = null;
    this.liveQueue.clear();
    if (!tx || !tx.size) return;
    const after = this.snapshot(tx.keys());
    if (opts.history !== false) this.pushHistory({ before: tx, after });
    const change = this.snapshotToChange(after);
    // bỏ những phần tử không đổi
    change.upsert = change.upsert!.filter((el) => tx.get(el.id) !== el);
    change.remove = change.remove!.filter((id) => tx.get(id) !== null);
    this.publish(change);
  }

  /** Huỷ giao dịch, khôi phục trạng thái trước. */
  cancelTx() {
    const tx = this.tx;
    this.tx = null;
    if (tx) for (const id of this.removedRemotely) tx.delete(id);
    this.removedRemotely.clear();
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = null;
    this.liveQueue.clear();
    if (!tx || !tx.size) return;
    const change = this.snapshotToChange(tx);
    this.applyRaw(change);
    this.bus.send("el", change);
  }

  /** Cập nhật chỉ trên máy này (vd. chiều cao đo được của khối chữ). */
  patchLocal(el: BoardElement) {
    this.els.set(el.id, el);
    this.bump();
  }

  undo() {
    if (this.tx) this.endTx();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const change = this.snapshotToChange(entry.before);
    this.applyRaw(change);
    this.publish(change);
    this.redoStack.push(entry);
    return true;
  }

  redo() {
    if (this.tx) this.endTx();
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const change = this.snapshotToChange(entry.after);
    this.applyRaw(change);
    this.publish(change);
    this.undoStack.push(entry);
    return true;
  }

  // ───────────── từ người khác ─────────────
  applyRemote(change: Change) {
    if (this.touchedWhileLoading) {
      for (const el of change.upsert ?? []) this.touchedWhileLoading.set(el.id, el);
      for (const id of change.remove ?? []) this.touchedWhileLoading.set(id, null);
    }
    // không để người khác ghi đè phần tử mình đang kéo
    if (this.tx) {
      for (const id of change.remove ?? []) {
        if (this.tx.has(id)) {
          this.removedRemotely.add(id);
          this.liveQueue.delete(id);
        }
      }
      change = {
        upsert: change.upsert?.filter((e) => !this.liveQueue.has(e.id) && !this.isDragging(e.id)),
        remove: change.remove,
      };
    }
    this.applyRaw(change);
  }

  private isDragging(id: string) {
    return this.tx?.has(id) ?? false;
  }

  // ───────────── đồng bộ ─────────────
  private publish(change: Change) {
    if (!change.upsert?.length && !change.remove?.length) return;
    this.bus.send("el", change);
    for (const el of change.upsert ?? []) {
      this.pendingUpsert.set(el.id, el);
      this.pendingDelete.delete(el.id);
    }
    for (const id of change.remove ?? []) {
      this.pendingUpsert.delete(id);
      this.pendingDelete.add(id);
    }
    this.scheduleFlush();
  }

  private scheduleFlush(delay = PERSIST_DELAY) {
    if (this.disposed) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), delay);
  }

  get hasPending() {
    return this.pendingUpsert.size > 0 || this.pendingDelete.size > 0 || this.flushing;
  }

  async flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.flushing) {
      this.scheduleFlush(150);
      return;
    }
    if (!this.pendingUpsert.size && !this.pendingDelete.size) return;
    this.flushing = true;
    const upserts = Array.from(this.pendingUpsert.values());
    const deletes = Array.from(this.pendingDelete);
    this.pendingUpsert.clear();
    this.pendingDelete.clear();
    this.inflight = new Map([...upserts.map((e) => [e.id, e] as const), ...deletes.map((id) => [id, null] as const)]);
    const sb = getSupabase();
    try {
      for (let i = 0; i < upserts.length; i += 150) {
        const rows = await Promise.all(upserts.slice(i, i + 150).map((el) => this.encryptRow(el)));
        const { error } = await sb.from("elements").upsert(rows);
        if (error) throw error;
      }
      for (let i = 0; i < deletes.length; i += 150) {
        const { error } = await sb.from("elements").delete().in("id", deletes.slice(i, i + 150));
        if (error) throw error;
      }
      this.failCount = 0;
      this.inflight.clear();
    } catch (err) {
      this.inflight.clear();
      console.error("[board] lưu thất bại", err);
      // xếp lại hàng đợi (không ghi đè thay đổi mới hơn)
      for (const el of upserts) if (!this.pendingUpsert.has(el.id) && !this.pendingDelete.has(el.id)) this.pendingUpsert.set(el.id, el);
      for (const id of deletes) if (!this.pendingUpsert.has(id)) this.pendingDelete.add(id);
      this.failCount++;
      if (this.failCount === 1 || this.failCount % 5 === 0) {
        const e = err as { code?: string; message?: string };
        this.onError(
          e.code === "PT429" || e.code === "PT413"
            ? `${e.message ?? "Bạn thao tác quá nhanh"} (đang thử lưu lại…)`
            : "Không lưu được thay đổi, đang thử lại…",
        );
      }
      this.flushing = false;
      this.scheduleFlush(Math.min(15000, 1000 * 2 ** this.failCount));
      return;
    }
    this.flushing = false;
    if (this.pendingUpsert.size || this.pendingDelete.size) this.scheduleFlush();
  }

  /** Gửi lại các thay đổi chưa lưu xong (khi có người mới vào phòng). */
  resendPending() {
    const upsert = [...this.pendingUpsert.values()];
    const remove = [...this.pendingDelete];
    for (const [id, el] of this.inflight) {
      if (el) {
        if (!this.pendingUpsert.has(id)) upsert.push(el);
      } else if (!this.pendingDelete.has(id)) remove.push(id);
    }
    // phần tử đang kéo / đang sửa dở (chưa lưu cho tới khi xong giao dịch)
    if (this.tx) {
      for (const id of this.tx.keys()) {
        const el = this.els.get(id);
        if (el && !upsert.some((u) => u.id === id)) upsert.push(el);
      }
    }
    if (upsert.length || remove.length) this.bus.send("el", { upsert, remove });
  }

  /** Tải toàn bộ từ DB (lần đầu và mỗi khi kết nối lại). */
  async load() {
    const sb = getSupabase();
    this.touchedWhileLoading = new Map();
    try {
      await this.loadInner(sb);
    } finally {
      this.touchedWhileLoading = null;
    }
  }

  private async loadInner(sb: ReturnType<typeof getSupabase>) {
    const rows: ElementRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("elements")
        .select("id, room_id, type, data, z")
        .eq("room_id", this.roomId)
        .order("z", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data as ElementRow[]));
      if (!data || data.length < PAGE) break;
    }
    const next = new Map<string, BoardElement>();
    const decoded = await Promise.all(
      rows.map((r) => (this.pendingDelete.has(r.id) ? Promise.resolve(null) : this.decryptRow(r))),
    );
    let bad = 0;
    rows.forEach((r, i) => {
      const el = decoded[i];
      if (el) next.set(r.id, el);
      else if (!this.pendingDelete.has(r.id)) bad++;
    });
    if (bad) console.warn(`[board] bỏ qua ${bad} phần tử không giải mã được`);
    // giữ thay đổi realtime mới hơn DB, thay đổi cục bộ chưa lưu & phần tử đang kéo
    for (const [id, el] of this.touchedWhileLoading ?? []) {
      if (el) next.set(id, el);
      else next.delete(id);
    }
    for (const [id, el] of this.inflight) {
      if (el) next.set(id, el);
      else next.delete(id);
    }
    for (const [id, el] of this.pendingUpsert) next.set(id, el);
    if (this.tx) for (const id of this.tx.keys()) {
      const cur = this.els.get(id);
      if (cur) next.set(id, cur);
      else next.delete(id);
    }
    this.els = next;
    this.loaded = true;
    this.bump();
  }

  /** Dừng hẳn (bị mời ra khỏi phòng): huỷ hẹn giờ lưu, bỏ hàng đợi để không gọi API lỗi mãi. */
  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.flushTimer = null;
    this.liveTimer = null;
    this.pendingUpsert.clear();
    this.pendingDelete.clear();
    this.liveQueue.clear();
    this.disposed = true;
  }
  private disposed = false;

  /** Xoá sạch bảng (có thể hoàn tác). */
  clearAll() {
    const ids = Array.from(this.els.keys());
    if (ids.length) this.commit({ remove: ids });
  }
}

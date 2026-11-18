import { KeyConfigError, roomKeys } from "@/lib/server/keys";
import { clientFromRequest, isUuid, json, pgStatus } from "@/lib/server/supabase";

/**
 * Cấp khoá giải mã của phòng cho THÀNH VIÊN đã được duyệt.
 * Kiểm tra quyền bằng RPC room_key_epoch chạy với JWT của chính người gọi
 * (người lạ / đang chờ duyệt / bị chặn → 403).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/rooms/[id]/keys">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "room id không hợp lệ" }, 400);
  const c = clientFromRequest(req);
  if (!c) return json({ error: "Chưa đăng nhập" }, 401);

  const { data, error } = await c.sb.rpc("room_key_epoch", { p_room: id });
  if (error) {
    const status = pgStatus(error);
    return json({ error: status === 403 ? "Bạn không phải thành viên phòng này" : "Không lấy được khoá" }, status);
  }
  try {
    return json(roomKeys(id, Number(data) || 0));
  } catch (err) {
    if (err instanceof KeyConfigError) {
      console.error("[keys]", err.message);
      return json({ error: "Server chưa cấu hình khoá mã hoá" }, 500);
    }
    throw err;
  }
}

/** Kiểm tra dữ liệu hồ sơ — dùng chung cho client (báo lỗi sớm) và server (bắt buộc). */

export const PRIVATE_FIELDS = ["full_name", "phone", "birthday"] as const;
export type PrivateField = (typeof PRIVATE_FIELDS)[number];

export interface ProfileInput {
  display_name?: string;
  color?: string;
  full_name?: string | null;
  phone?: string | null;
  birthday?: string | null;
}

type Result = { ok: true; value: ProfileInput } | { ok: false; error: string; field: string };

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const clean = (s: string) => s.replace(CONTROL, "").trim();

export function validateProfile(input: unknown): Result {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Dữ liệu không hợp lệ", field: "" };
  }
  const o = input as Record<string, unknown>;
  const allowed = new Set(["display_name", "color", ...PRIVATE_FIELDS]);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) return { ok: false, error: `Trường không được phép: ${k}`, field: k };
  }
  const out: ProfileInput = {};

  if (o.display_name !== undefined) {
    if (typeof o.display_name !== "string") return { ok: false, error: "Tên hiển thị không hợp lệ", field: "display_name" };
    const n = clean(o.display_name);
    if (n.length < 1 || n.length > 40) return { ok: false, error: "Tên hiển thị dài 1–40 ký tự", field: "display_name" };
    out.display_name = n;
  }
  if (o.color !== undefined) {
    if (typeof o.color !== "string" || !/^#[0-9a-f]{6}$/i.test(o.color)) {
      return { ok: false, error: "Màu không hợp lệ", field: "color" };
    }
    out.color = o.color;
  }

  const opt = (k: PrivateField): string | null | undefined | false => {
    const v = o[k];
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") return false;
    const s = clean(v);
    return s === "" ? null : s;
  };

  const fullName = opt("full_name");
  if (fullName === false || (typeof fullName === "string" && fullName.length > 100)) {
    return { ok: false, error: "Họ tên tối đa 100 ký tự", field: "full_name" };
  }
  if (fullName !== undefined) out.full_name = fullName;

  const phone = opt("phone");
  if (phone !== undefined) {
    if (
      phone !== null &&
      (phone === false || !/^\+?[0-9 ().-]{6,20}$/.test(phone) || phone.replace(/\D/g, "").length < 6)
    ) {
      return { ok: false, error: "Số điện thoại không hợp lệ", field: "phone" };
    }
    out.phone = phone;
  }

  const bd = opt("birthday");
  if (bd !== undefined) {
    if (bd !== null) {
      const m = bd === false ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(bd);
      const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
      const valid =
        m && d && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
      if (!valid || +m![1] < 1900 || d!.getTime() > Date.now()) {
        return { ok: false, error: "Ngày sinh không hợp lệ", field: "birthday" };
      }
    }
    out.birthday = bd as string | null;
  }
  return { ok: true, value: out };
}

/** Kiểm tra mật khẩu khi đăng ký / đổi mật khẩu (server Supabase cũng kiểm tra lại). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Mật khẩu cần ít nhất 8 ký tự";
  if (pw.length > 72) return "Mật khẩu tối đa 72 ký tự";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Mật khẩu cần có cả chữ và số";
  return null;
}

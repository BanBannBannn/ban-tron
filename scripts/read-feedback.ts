/**
 * Đọc & giải mã góp ý mới nhất trong DB (dành cho chủ app).
 *   npm run feedback:read            # 20 góp ý gần nhất
 *   npm run feedback:read -- 100     # 100 góp ý gần nhất
 * Cần: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (secret/service_role — KHÔNG đưa lên client),
 *      ENCRYPTION_KEY (đọc từ .env.local hoặc biến môi trường).
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { decryptScoped } from "../src/lib/server/keys.ts";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY");
  process.exit(1);
}
const limit = Math.min(500, Number(process.argv[2]) || 20);
const sb = createClient(url, secret, { auth: { persistSession: false } });
const { data, error } = await sb
  .from("feedback")
  .select("id, rating, category, message_enc, contact_enc, page, registered, emailed, created_at")
  .order("created_at", { ascending: false })
  .limit(limit);
if (error) {
  console.error(error.message);
  process.exit(1);
}
const dec = (t: string | null, id: string, field: string) => {
  if (!t) return "";
  try {
    return decryptScoped(t, "feedback", `feedback:${id}:${field}`);
  } catch {
    return "(không giải mã được)";
  }
};
for (const f of data ?? []) {
  console.log("─".repeat(60));
  console.log(
    `${new Date(f.created_at).toLocaleString("vi-VN")} · ${f.category}${f.rating ? ` · ${"★".repeat(f.rating)}` : ""} · ${f.registered ? "tài khoản" : "khách"}${f.page ? ` · ${f.page}` : ""}`,
  );
  const contact = dec(f.contact_enc, f.id, "contact");
  if (contact) console.log(`Liên hệ: ${contact}`);
  const msg = dec(f.message_enc, f.id, "message");
  if (msg) console.log(msg);
}
console.log(`\n${data?.length ?? 0} góp ý.`);

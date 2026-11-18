"use client";

import { getSupabase } from "../supabase";
import { uid } from "../utils";

const MAX_DIM = 1800;

export interface UploadedImage {
  src: string;
  width: number;
  height: number;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh"));
    };
    img.src = url;
  });
}

/** Nén ảnh (WebP, tối đa 1800px) rồi tải lên Supabase Storage. */
export async function uploadImage(file: File, roomId: string): Promise<UploadedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Chỉ hỗ trợ file ảnh");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  let blob: Blob = file;
  let ext = file.type.split("/")[1] ?? "png";
  const keepOriginal = file.type === "image/gif" && file.size < 3_000_000;
  if (!keepOriginal) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ canvas");
    ctx.drawImage(img, 0, 0, width, height);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Nén ảnh thất bại"))), "image/webp", 0.86),
    );
    ext = "webp";
  }
  if (blob.size > 5 * 1024 * 1024) throw new Error("Ảnh quá lớn (tối đa 5MB)");

  const path = `${roomId}/${uid()}.${ext}`;
  const sb = getSupabase();
  const { error } = await sb.storage.from("board-images").upload(path, blob, {
    contentType: blob.type || `image/${ext}`,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("board-images").getPublicUrl(path);
  return { src: data.publicUrl, width, height };
}

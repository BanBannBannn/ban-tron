import { test, expect } from "@playwright/test";
import { sanitizeDoc, sanitizeElement, safeColor, safeHref, safeImageSrc, safeName } from "../../src/lib/board/sanitize";
import { hitTest, lineFromPoints, normalizeRect, rectsIntersect, snapAngle, unionBounds } from "../../src/lib/board/geometry";
import { isDocEmpty, tableDoc, textDoc } from "../../src/lib/board/defaults";
import { makeInk, scaleElement, applyStyleTo, cloneElements } from "../../src/lib/board/factory";
import { parseRoomInput, randomSlug } from "../../src/lib/rooms";
import { initials } from "../../src/lib/utils";
import type { BoardElement, ShapeEl } from "../../src/lib/board/types";

const ID = "11111111-2222-4333-8444-555555555555";
const shape = (o: Partial<ShapeEl> = {}): ShapeEl => ({
  id: ID,
  type: "shape",
  shape: "rect",
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  z: 1,
  stroke: "#000000",
  fill: "none",
  strokeWidth: 2,
  dash: "solid",
  fontSize: 18,
  ...o,
});

test.describe("sanitize", () => {
  test("màu: chỉ chấp nhận hex", () => {
    expect(safeColor("#1e1e1e", "x")).toBe("#1e1e1e");
    expect(safeColor("#ABC", "x")).toBe("#ABC");
    for (const bad of ["red", "url(https://evil)", "#12345", "#1e1e1e; background:red", "", null, 123]) {
      expect(safeColor(bad, "fallback")).toBe("fallback");
    }
  });

  test("link: chặn javascript:, data:, vbscript:", () => {
    expect(safeHref("https://a.com/x?y=1")).toBe("https://a.com/x?y=1");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    for (const bad of ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "data:text/html,<script>", "vbscript:x", "/relative", "nonsense"]) {
      expect(safeHref(bad)).toBeNull();
    }
  });

  test("ảnh: chỉ chấp nhận URL trong bucket của project", () => {
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/board-images/`;
    expect(safeImageSrc(`${base}${ID}/${ID}.webp`)).not.toBeNull();
    for (const bad of [
      "https://evil.test/x.png",
      `${base}../../../etc/passwd`,
      `${base}${ID}/${ID}.svg`,
      `javascript:alert(1)//${base}`,
      `${base}${ID}/${ID}.webp?x=" onerror="alert(1)`,
    ]) {
      expect(safeImageSrc(bad)).toBeNull();
    }
  });

  test("rich text: bỏ class/style/javascript, giữ định dạng hợp lệ", () => {
    const doc = sanitizeDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center; background:url(x)", class: "fixed" },
          content: [
            { type: "text", text: "a", marks: [{ type: "link", attrs: { href: "javascript:alert(1)", class: "fixed inset-0" } }] },
            { type: "text", text: "b", marks: [{ type: "link", attrs: { href: "https://ok.com", class: "fixed" } }] },
            { type: "text", text: "c", marks: [{ type: "textStyle", attrs: { color: "red;position:fixed" } }, { type: "bold" }] },
            { type: "text", text: "d", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
            { type: "evilNode", content: [{ type: "text", text: "x" }] },
          ],
        },
        { type: "heading", attrs: { level: 99 }, content: [{ type: "text", text: "H" }] },
        { type: "script", content: [] },
      ],
    });
    const json = JSON.stringify(doc);
    expect(json).not.toContain("javascript");
    expect(json).not.toContain("fixed");
    expect(json).not.toContain("url(");
    expect(json).not.toContain("evilNode");
    expect(json).not.toContain("script");
    expect(json).toContain("https://ok.com/");
    expect(json).toContain("#ff0000");
    expect(json).toContain('"bold"');
    expect(doc.content![1].attrs!.level).toBe(1);
  });

  test("rich text: doc lồng quá sâu / không phải doc → doc rỗng an toàn", () => {
    let deep: Record<string, unknown> = { type: "text", text: "x" };
    for (let i = 0; i < 200; i++) deep = { type: "blockquote", content: [deep] };
    expect(() => sanitizeDoc({ type: "doc", content: [deep] })).not.toThrow();
    expect(sanitizeDoc("hello").type).toBe("doc");
    expect(sanitizeDoc(null).content).toHaveLength(1);
  });

  test("phần tử: id/type sai bị loại, số NaN/khổng lồ bị kẹp", () => {
    expect(sanitizeElement({ ...shape(), id: "not-a-uuid" })).toBeNull();
    expect(sanitizeElement({ ...shape(), type: "iframe" })).toBeNull();
    expect(sanitizeElement(null)).toBeNull();
    const el = sanitizeElement({ ...shape(), x: Number.NaN, y: 1e30, w: -5, h: "100", fill: "url(x)" }) as ShapeEl;
    expect(el.x).toBe(0);
    expect(el.y).toBeLessThanOrEqual(1e6);
    expect(el.w).toBe(0);
    expect(el.h).toBe(1);
    expect(el.fill).toBe("none");
    expect(sanitizeElement({ id: ID, type: "image", x: 0, y: 0, w: 1, h: 1, z: 0, src: "https://evil.test/a.png" })).toBeNull();
    expect(sanitizeElement({ id: ID, type: "ink", x: 0, y: 0, w: 1, h: 1, z: 0, points: "x" })).toBeNull();
  });

  test("tên hiển thị: bỏ ký tự điều khiển, giới hạn 40 ký tự, không cắt đôi emoji", () => {
    expect(safeName("  An\u0000\u0007  ")).toBe("An");
    expect(safeName("")).toBe("Ẩn danh");
    expect(safeName(123)).toBe("Ẩn danh");
    const long = safeName("😀".repeat(100));
    expect(Array.from(long)).toHaveLength(40);
    expect(long).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

test.describe("hình học", () => {
  test("hitTest: hình rỗng chỉ trúng ở viền, hình có nền trúng cả bên trong", () => {
    const hollow = shape();
    expect(hitTest(hollow, 50, 25, 3)).toBe(false);
    expect(hitTest(hollow, 0, 25, 3)).toBe(true);
    expect(hitTest(hollow, 100, 49, 3)).toBe(true);
    expect(hitTest(shape({ fill: "#ffc9c9" }), 50, 25, 3)).toBe(true);
    expect(hitTest(shape({ text: "nhãn" }), 50, 25, 3)).toBe(true);
    expect(hitTest(hollow, 500, 500, 3)).toBe(false);
  });

  test("hitTest: nét vẽ tay & đường thẳng", () => {
    const ink = makeInk(ID, [[0, 0], [100, 0]], { color: "#000000", size: 4, z: 0 });
    expect(hitTest(ink, 50, 1, 2)).toBe(true);
    expect(hitTest(ink, 50, 30, 2)).toBe(false);
    const line = { ...shape(), type: "line", ...lineFromPoints(0, 0, 100, 100), points: lineFromPoints(0, 0, 100, 100).points } as unknown as BoardElement;
    expect(hitTest(line, 50, 50, 2)).toBe(true);
    expect(hitTest(line, 80, 20, 2)).toBe(false);
  });

  test("rect, union, snap", () => {
    expect(normalizeRect(10, 10, 0, 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 1, h: 1 })).toBe(false);
    expect(unionBounds([])).toBeNull();
    expect(unionBounds([{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: -5, w: 1, h: 1 }])).toEqual({ x: 0, y: -5, w: 6, h: 6 });
    const p = snapAngle(0, 0, 100, 3);
    expect(Math.round(p.y)).toBe(0);
  });

  test("resize: chữ chỉ đổi chiều rộng, ghi chú giữ minH, đường thẳng scale điểm", () => {
    const b0 = { x: 0, y: 0, w: 100, h: 50 };
    const text = { id: ID, type: "text", x: 0, y: 0, w: 100, h: 50, z: 0, doc: textDoc("a"), color: "#000000", fontSize: 18, autoW: true } as BoardElement;
    const t2 = scaleElement(text, b0, 0, 0, 2, 2);
    expect(t2.w).toBe(200);
    expect(t2.h).toBe(50);
    expect((t2 as { autoW?: boolean }).autoW).toBe(false);
    const tiny = scaleElement(text, b0, 0, 0, 0.01, 1);
    expect(tiny.w).toBeGreaterThanOrEqual(40);
  });

  test("đổi style: bút dạ quang chỉ nhận màu dạ quang", () => {
    const hl = makeInk(ID, [[0, 0], [10, 10]], { color: "#ffd43b", size: 12, highlighter: true, z: 0 });
    expect((applyStyleTo(hl, { stroke: "#e03131" }) as { color: string }).color).toBe("#ffd43b");
    expect((applyStyleTo(hl, { hlColor: "#69db7c" }) as { color: string }).color).toBe("#69db7c");
  });

  test("nhân bản: id mới, giữ thứ tự lớp", () => {
    const a = shape({ id: ID, z: 5 });
    const b = shape({ id: "99999999-2222-4333-8444-555555555555", z: 1 });
    const c = cloneElements([a, b], 10, 10, 100);
    expect(c.map((e) => e.id)).not.toContain(ID);
    expect(c[0].z).toBe(100);
    expect(c[0].x).toBe(10);
  });
});

test.describe("tiện ích", () => {
  test("isDocEmpty", () => {
    expect(isDocEmpty(textDoc(""))).toBe(true);
    expect(isDocEmpty(textDoc("   "))).toBe(true);
    expect(isDocEmpty(textDoc("a"))).toBe(false);
    expect(isDocEmpty(tableDoc())).toBe(false);
    expect(isDocEmpty(undefined)).toBe(true);
  });

  test("mã phòng: nhận link hoặc mã, chặn ký tự lạ", () => {
    expect(parseRoomInput("abc-defg-hij")).toBe("abc-defg-hij");
    expect(parseRoomInput("  ABC-DEFG-HIJ ")).toBe("abc-defg-hij");
    expect(parseRoomInput("https://x.vercel.app/r/abc-defg-hij?x=1")).toBe("abc-defg-hij");
    for (const bad of ["", "../../etc", "<script>", "a b c", "ab"]) expect(parseRoomInput(bad)).toBeNull();
    for (let i = 0; i < 50; i++) expect(randomSlug()).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  });

  test("initials không cắt đôi emoji / ký tự ghép", () => {
    expect(initials("An Nguyễn")).toBe("AN");
    expect(initials("😀 Vui")).toBe("😀V");
    expect(initials("👨‍👩‍👧 Nhà")).toBe("👨‍👩‍👧N");
    expect(initials("Ánh")).toBe("ÁN");
    expect(initials("   ")).toBe("?");
    for (const s of ["😀", "😀😀😀", "🇻🇳 VN"]) expect(initials(s)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

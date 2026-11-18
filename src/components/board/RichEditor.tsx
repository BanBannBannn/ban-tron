"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Table2,
  TextQuote,
  Underline,
} from "lucide-react";
import type { BoardElement, NoteEl, TableEl, TextEl } from "@/lib/board/types";
import { richExtensions } from "@/lib/board/richtext";
import type { BoardStore } from "@/lib/board/store";
import { useZoom, type CameraStore } from "@/lib/board/camera";
import { HIGHLIGHT_COLORS, STROKE_COLORS } from "@/lib/board/defaults";
import { Divider, IconButton, Popover, Swatch } from "../ui/primitives";
import { cn } from "@/lib/utils";

interface Props {
  el: TextEl | NoteEl | TableEl;
  store: BoardStore;
  cam: CameraStore;
  onExit: () => void;
  placeholder?: string;
  /** lấy các phím đã gõ trước khi editor kịp nhận focus */
  takeTyped?: () => string;
}

export function RichEditor({ el, store, cam, onExit, placeholder, takeTyped }: Props) {
  const onExitRef = useRef(onExit);
  const takeTypedRef = useRef(takeTyped);
  useEffect(() => {
    onExitRef.current = onExit;
    takeTypedRef.current = takeTyped;
  });
  const id = el.id;
  const extensions = useMemo(() => richExtensions(placeholder), [placeholder]);
  const editor = useEditor({
    extensions,
    content: el.doc,
    // component chỉ render ở client → tạo editor ngay, đỡ mất phím khi gõ nhanh
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // tự focus thủ công bên dưới (focus của Tiptap chờ 1 frame → mất phím khi gõ nhanh)
    autofocus: false,
    editorProps: {
      attributes: { class: "rt-content rt-editing", spellcheck: "false" },
      handleKeyDown: (_view, e) => {
        if (e.key === "Escape") {
          onExitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const cur = store.get(id);
      if (cur && "doc" in cur) store.live([{ ...cur, doc: editor.getJSON() } as BoardElement]);
    },
  });

  // Focus NGAY khi editor gắn vào DOM (layout effect chạy trong cùng lượt xử lý cú nhấp),
  // nên phím gõ tiếp theo đi thẳng vào editor. Bảng: con trỏ vào ô trống đầu tiên.
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const { doc } = editor.state;
    let pos: number | null = null;
    if (el.type === "table") {
      doc.descendants((node, p) => {
        if (pos !== null) return false;
        if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
          if (node.type.name === "tableCell" && !node.textContent) pos = p + 2;
          return false;
        }
        return true;
      });
    }
    editor.commands.setTextSelection(pos ?? Selection.atEnd(doc).from);
    editor.view.focus();
    const typed = takeTypedRef.current?.();
    if (typed) editor.commands.insertContent(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <>
      {editor && <FormatBar editor={editor} el={el} cam={cam} store={store} onExit={onExit} />}
      <EditorContent editor={editor} />
    </>
  );
}

function FormatBar({
  editor,
  el,
  cam,
  store,
  onExit,
}: {
  editor: Editor;
  el: Props["el"];
  cam: CameraStore;
  store: BoardStore;
  onExit: () => void;
}) {
  const z = useZoom(cam);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      heading: ([1, 2, 3] as const).find((l) => e.isActive("heading", { level: l })) ?? 0,
      align: (["center", "right"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      inTable: e.isActive("table"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <div
      className="absolute bottom-full left-0 pb-2"
      style={{ transform: `scale(${1 / z})`, transformOrigin: "bottom left" }}
      onPointerDown={(e) => {
        // giữ focus trong editor
        if ((e.target as HTMLElement).closest("input")) return;
        e.preventDefault();
      }}
    >
      <div className="pop-in flex items-center gap-0.5 rounded-xl border border-line bg-panel p-1 whitespace-nowrap text-ink shadow-float">
        <Popover
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium hover:bg-hover",
                open && "bg-hover",
              )}
            >
              <span className="w-[68px] text-left">
                {s.heading ? `Tiêu đề ${s.heading}` : "Văn bản"}
              </span>
              <ChevronDown size={14} />
            </button>
          )}
        >
          {(close) => (
            <div className="flex w-44 flex-col">
              {(
                [
                  [0, "Văn bản", "text-[14px]"],
                  [1, "Tiêu đề 1", "text-[22px] font-bold"],
                  [2, "Tiêu đề 2", "text-[18px] font-bold"],
                  [3, "Tiêu đề 3", "text-[15px] font-semibold"],
                ] as const
              ).map(([lvl, label, cls]) => (
                <button
                  key={lvl}
                  type="button"
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-left hover:bg-hover",
                    s.heading === lvl && "bg-accent-soft text-accent",
                    cls,
                  )}
                  onClick={() => {
                    if (lvl === 0) chain().setParagraph().run();
                    else chain().setHeading({ level: lvl }).run();
                    close();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <Divider />
        <IconButton size="sm" tip="Đậm (⌘B)" active={s.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={16} />
        </IconButton>
        <IconButton size="sm" tip="Nghiêng (⌘I)" active={s.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={16} />
        </IconButton>
        <IconButton size="sm" tip="Gạch chân (⌘U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
          <Underline size={16} />
        </IconButton>
        <IconButton size="sm" tip="Gạch ngang" active={s.strike} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough size={16} />
        </IconButton>
        <IconButton size="sm" tip="Code" active={s.code} onClick={() => chain().toggleCode().run()}>
          <Code size={16} />
        </IconButton>
        <Popover
          trigger={({ toggle, open }) => (
            <IconButton size="sm" tip="Màu chữ" active={open} onClick={toggle}>
              <span className="flex flex-col items-center">
                <Baseline size={16} />
                <span className="-mt-0.5 h-[3px] w-4 rounded" style={{ background: s.color ?? "currentColor" }} />
              </span>
            </IconButton>
          )}
        >
          {(close) => (
            <div className="flex w-[148px] flex-wrap gap-1.5">
              {STROKE_COLORS.filter((c) => c !== "#ffffff").map((c) => (
                <Swatch
                  key={c}
                  color={c}
                  active={s.color === c}
                  onClick={() => {
                    chain().setColor(c).run();
                    close();
                  }}
                />
              ))}
              <button
                type="button"
                className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-ink-2 hover:bg-hover"
                onClick={() => {
                  chain().unsetColor().run();
                  close();
                }}
              >
                Màu mặc định
              </button>
            </div>
          )}
        </Popover>
        <Popover
          trigger={({ toggle, open }) => (
            <IconButton size="sm" tip="Tô nền chữ" active={open || !!s.highlight} onClick={toggle}>
              <Highlighter size={16} />
            </IconButton>
          )}
        >
          {(close) => (
            <div className="flex w-[118px] flex-wrap gap-1.5">
              {HIGHLIGHT_COLORS.map((c) => (
                <Swatch
                  key={c}
                  color={c}
                  active={s.highlight === c}
                  onClick={() => {
                    chain().setHighlight({ color: c }).run();
                    close();
                  }}
                />
              ))}
              <button
                type="button"
                className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-ink-2 hover:bg-hover"
                onClick={() => {
                  chain().unsetHighlight().run();
                  close();
                }}
              >
                Bỏ tô
              </button>
            </div>
          )}
        </Popover>
        <LinkButton editor={editor} active={s.link} href={s.href} />
        <Divider />
        <IconButton size="sm" tip="Căn trái" active={s.align === "left"} onClick={() => chain().setTextAlign("left").run()}>
          <AlignLeft size={16} />
        </IconButton>
        <IconButton size="sm" tip="Căn giữa" active={s.align === "center"} onClick={() => chain().setTextAlign("center").run()}>
          <AlignCenter size={16} />
        </IconButton>
        <IconButton size="sm" tip="Căn phải" active={s.align === "right"} onClick={() => chain().setTextAlign("right").run()}>
          <AlignRight size={16} />
        </IconButton>
        <Divider />
        <IconButton size="sm" tip="Danh sách" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
          <List size={16} />
        </IconButton>
        <IconButton size="sm" tip="Danh sách số" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </IconButton>
        <IconButton size="sm" tip="Việc cần làm" active={s.task} onClick={() => chain().toggleTaskList().run()}>
          <ListChecks size={16} />
        </IconButton>
        <IconButton size="sm" tip="Trích dẫn" active={s.quote} onClick={() => chain().toggleBlockquote().run()}>
          <TextQuote size={16} />
        </IconButton>
        <Divider />
        <TableMenu editor={editor} inTable={s.inTable} isTableEl={el.type === "table"} store={store} el={el} onExit={onExit} />
        <IconButton size="sm" tip="Xoá định dạng" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting size={16} />
        </IconButton>
      </div>
    </div>
  );
}

function LinkButton({ editor, active, href }: { editor: Editor; active: boolean; href: string }) {
  const [value, setValue] = useState("");
  return (
    <Popover
      trigger={({ toggle, open }) => (
        <IconButton
          size="sm"
          tip="Liên kết"
          active={active || open}
          onClick={() => {
            setValue(href);
            toggle();
          }}
        >
          <Link2 size={16} />
        </IconButton>
      )}
    >
      {(close) => (
        <form
          className="flex w-72 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            if (!v) editor.chain().focus().extendMarkRange("link").unsetLink().run();
            else {
              const url = /^[a-z]+:/i.test(v) ? v : `https://${v}`;
              editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
            }
            close();
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Dán liên kết…"
            className="h-8 flex-1 rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent"
          />
          <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong">
            OK
          </button>
          {active && (
            <button
              type="button"
              className="h-8 rounded-lg px-2 text-sm text-ink-2 hover:bg-hover"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                close();
              }}
            >
              Bỏ
            </button>
          )}
        </form>
      )}
    </Popover>
  );
}

function TableMenu({
  editor,
  inTable,
  isTableEl,
  store,
  el,
  onExit,
}: {
  editor: Editor;
  inTable: boolean;
  isTableEl: boolean;
  store: BoardStore;
  el: Props["el"];
  onExit: () => void;
}) {
  if (!inTable) {
    return (
      <IconButton
        size="sm"
        tip="Chèn bảng"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 size={16} />
      </IconButton>
    );
  }
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();
  const items: Array<[string, () => void] | null> = [
    ["Thêm hàng phía trên", () => run((c) => c.addRowBefore())],
    ["Thêm hàng phía dưới", () => run((c) => c.addRowAfter())],
    ["Thêm cột bên trái", () => run((c) => c.addColumnBefore())],
    ["Thêm cột bên phải", () => run((c) => c.addColumnAfter())],
    null,
    ["Gộp / tách ô", () => run((c) => c.mergeOrSplit())],
    ["Bật/tắt hàng tiêu đề", () => run((c) => c.toggleHeaderRow())],
    ["Bật/tắt cột tiêu đề", () => run((c) => c.toggleHeaderColumn())],
    null,
    ["Xoá hàng", () => run((c) => c.deleteRow())],
    ["Xoá cột", () => run((c) => c.deleteColumn())],
    [
      "Xoá bảng",
      () => {
        if (isTableEl) {
          onExit();
          store.commit({ remove: [el.id] });
        } else run((c) => c.deleteTable());
      },
    ],
  ];
  return (
    <Popover
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-hover",
            open && "bg-hover",
          )}
        >
          <Table2 size={16} /> Bảng <ChevronDown size={14} />
        </button>
      )}
    >
      {(close) => (
        <div className="flex w-52 flex-col">
          {items.map((it, i) =>
            it ? (
              <button
                key={it[0]}
                type="button"
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover",
                  it[0].startsWith("Xoá") && "text-danger",
                )}
                onClick={() => {
                  it[1]();
                  close();
                }}
              >
                {it[0]}
              </button>
            ) : (
              <Divider key={i} vertical={false} />
            ),
          )}
        </div>
      )}
    </Popover>
  );
}

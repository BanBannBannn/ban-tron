import { generateHTML, type Extensions, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";

export function richExtensions(placeholder?: string): Extensions {
  const list: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
      },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, cellMinWidth: 60, lastColumnResizable: true }),
    TableRow,
    TableHeader,
    TableCell,
  ];
  if (placeholder) list.push(Placeholder.configure({ placeholder }));
  return list;
}

let staticExt: Extensions | null = null;
const cache = new WeakMap<JSONContent, string>();

/** Render doc → HTML an toàn (đi qua schema của ProseMirror, không chèn HTML thô). */
export function docToHtml(doc: JSONContent): string {
  const hit = cache.get(doc);
  if (hit !== undefined) return hit;
  staticExt ??= richExtensions();
  let html = "";
  try {
    html = generateHTML(doc, staticExt);
  } catch {
    html = "";
  }
  cache.set(doc, html);
  return html;
}

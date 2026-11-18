"use client";

import { useState } from "react";
import { Dices } from "lucide-react";
import { getIdentity, randomName, setIdentity, USER_COLORS } from "@/lib/identity";
import { Avatar } from "../ui/primitives";
import { cn } from "@/lib/utils";

/** Hộp thoại chào lần đầu: chọn tên & màu hiển thị. */
export function NameDialog() {
  const init = getIdentity();
  const [name, setName] = useState(init.name);
  const [color, setColor] = useState(init.color);

  const submit = () => {
    const n = name.trim().slice(0, 40) || randomName();
    setIdentity({ name: n, color, confirmed: true });
  };

  return (
    <div data-ui data-modal-open className="fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4">
      <form
        className="pop-in w-full max-w-[400px] rounded-2xl border border-line bg-panel p-6 shadow-float"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="mb-5 flex items-center gap-3">
          <Avatar name={name || "?"} color={color} size={48} />
          <div>
            <h2 className="text-lg font-semibold text-ink">Chào bạn 👋</h2>
            <p className="text-sm text-ink-2">Mọi người trong phòng sẽ thấy tên này.</p>
          </div>
        </div>
        <label className="mb-1.5 block text-xs font-semibold tracking-wide text-ink-3 uppercase" htmlFor="nd-name">
          Tên hiển thị
        </label>
        <div className="mb-4 flex gap-2">
          <input
            id="nd-name"
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="h-11 flex-1 rounded-xl border border-line bg-canvas px-3 text-[15px] text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            title="Tên ngẫu nhiên"
            aria-label="Tên ngẫu nhiên"
            onClick={() => setName(randomName())}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink-2 hover:bg-hover"
          >
            <Dices size={18} />
          </button>
        </div>
        <div className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">Màu của bạn</div>
        <div className="mb-6 flex flex-wrap gap-2">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                "h-7 w-7 rounded-full transition-transform hover:scale-110",
                color === c && "ring-2 ring-offset-2 ring-offset-panel",
              )}
              style={{ background: c, ["--tw-ring-color" as string]: c }}
            />
          ))}
        </div>
        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-accent-strong"
        >
          Vào phòng
        </button>
      </form>
    </div>
  );
}

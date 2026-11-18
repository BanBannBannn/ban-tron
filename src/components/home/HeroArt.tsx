/** Minh hoạ bảng trắng thu nhỏ (thuần SVG/CSS, không cần tải gì thêm). */
export function HeroArt() {
  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-[560px] select-none" aria-hidden>
      <div className="board-grid absolute inset-0 rounded-[28px] border border-line bg-panel shadow-float" />

      {/* thanh công cụ mini */}
      <div className="absolute top-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-line bg-panel p-1 shadow-sm">
        {["#1e1e1e", "#e03131", "#1971c2", "#2f9e44"].map((c, i) => (
          <span key={c} className={`h-6 w-6 rounded-md ${i === 0 ? "bg-accent-soft" : ""} flex items-center justify-center`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          </span>
        ))}
        <span className="mx-0.5 w-px bg-line" />
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex h-6 w-6 items-center justify-center">
            <span className={`h-3 w-3 border-[1.5px] border-ink-2 ${i === 1 ? "rounded-full" : i === 2 ? "rotate-45 rounded-[2px]" : "rounded-[3px]"}`} />
          </span>
        ))}
      </div>

      {/* ghi chú dán */}
      <div className="float-a absolute top-[19%] left-[7%] w-[34%] -rotate-3 rounded-md bg-[#fff3bf] p-3 shadow-md">
        <div className="text-[13px] font-bold text-[#1e1e1e]">Ý tưởng sprint 🚀</div>
        <ul className="mt-1.5 space-y-1 text-[11px] text-[#1e1e1e]/80">
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] bg-[#2f9e44] text-[8px] leading-3 text-white">✓</span> Trang chủ mới
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] border border-black/30" /> Chế độ tối
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[3px] border border-black/30" /> Xuất PDF
          </li>
        </ul>
      </div>
      <div className="float-b absolute top-[22%] right-[8%] w-[24%] rotate-2 rounded-md bg-[#d0ebff] p-3 shadow-md">
        <div className="text-[12px] leading-snug font-medium text-[#1e1e1e]">Họp lúc 3h chiều nhé!</div>
      </div>

      {/* sơ đồ */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 500 400" fill="none">
        <rect x="200" y="160" width="110" height="56" rx="12" stroke="#1971c2" strokeWidth="2.5" fill="#e7f5ff" />
        <text x="255" y="193" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1971c2">
          Thiết kế
        </text>
        <path d="M310 188 C 350 188, 360 240, 392 250" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" />
        <path d="M382 242 L393 250 L381 256" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="430" cy="262" rx="44" ry="26" stroke="#2f9e44" strokeWidth="2.5" fill="#ebfbee" />
        <text x="430" y="267" textAnchor="middle" fontSize="12" fontWeight="600" fill="#2f9e44">
          Ra mắt
        </text>
        {/* nét vẽ tay */}
        <path
          className="draw-path"
          d="M60 300 C 80 270, 110 330, 135 296 S 180 270, 196 300 S 238 330, 250 300"
          stroke="#e03131"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M206 158 L 226 132" stroke="#ffd43b" strokeWidth="14" strokeLinecap="round" opacity=".55" />
      </svg>

      {/* bảng mini */}
      <div className="absolute bottom-[8%] left-[7%] w-[40%] overflow-hidden rounded-lg border border-line bg-white text-[10px] shadow-sm">
        <div className="grid grid-cols-3 bg-[#edf2ff] font-semibold text-[#3b5bdb]">
          <span className="border-r border-line px-2 py-1">Việc</span>
          <span className="border-r border-line px-2 py-1">Ai</span>
          <span className="px-2 py-1">Hạn</span>
        </div>
        {[
          ["Logo", "Lan", "T2"],
          ["API", "Minh", "T4"],
        ].map((r) => (
          <div key={r[0]} className="grid grid-cols-3 border-t border-line text-[#495057]">
            {r.map((c, i) => (
              <span key={i} className={`px-2 py-1 ${i < 2 ? "border-r border-line" : ""}`}>
                {c}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* bong bóng chat */}
      <div className="float-b absolute right-[6%] bottom-[9%] flex items-end gap-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#c2255c] text-[9px] font-bold text-white">
          HA
        </span>
        <span className="rounded-2xl rounded-bl-md bg-canvas px-3 py-1.5 text-[11px] text-ink shadow-sm ring-1 ring-line">
          Đẹp quá 😍
        </span>
      </div>

      {/* con trỏ */}
      <Cursor className="cursor-a" color="#e8590c" name="Mèo Lém lỉnh" />
      <Cursor className="cursor-b" color="#6741d9" name="Cáo Tò mò" />
    </div>
  );
}

function Cursor({ color, name, className }: { color: string; name: string; className: string }) {
  return (
    <div className={`absolute top-0 left-0 ${className}`}>
      <svg width="18" height="20" viewBox="0 0 20 22">
        <path
          d="M2 2 L2 18 L6.5 14 L9.5 20.5 L12.5 19.2 L9.6 12.8 L15.5 12.6 Z"
          fill={color}
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="absolute top-[16px] left-[11px] rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  );
}

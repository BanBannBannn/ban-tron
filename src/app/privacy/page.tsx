import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Quyền riêng tư & bảo mật" };

// Mẫu chính sách. Hãy điền thông tin đơn vị vận hành và nhờ người có chuyên môn pháp lý rà soát trước khi phát hành.
const OPERATOR = "Trần Văn Gia Bân";
const CONTACT = "tranvangiaban@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalPage title="Quyền riêng tư & bảo mật" updated="18/11/2026">
      <p>
        Chính sách này giải thích Bàn Tròn ({OPERATOR}) thu thập dữ liệu gì, dùng để làm gì và bảo vệ nó ra sao. Chúng tôi
        chỉ thu thập những gì cần để dịch vụ hoạt động, và mã hoá những dữ liệu nhạy cảm.
      </p>

      <Section title="1. Dữ liệu chúng tôi thu thập">
        <ul>
          <li>
            <b>Khi dùng với tư cách khách:</b> một mã định danh ngẫu nhiên, tên hiển thị và màu bạn chọn. Không cần email.
          </li>
          <li>
            <b>Khi có tài khoản:</b> email, mật khẩu (chỉ lưu bản băm, không lưu bản gốc), hoặc thông tin cơ bản từ Google
            (tên, email) nếu bạn đăng nhập bằng Google.
          </li>
          <li>
            <b>Hồ sơ tuỳ chọn:</b> họ tên, số điện thoại, ngày sinh. Bạn có thể để trống hoặc xoá bất cứ lúc nào.
          </li>
          <li>
            <b>Nội dung phòng:</b> nét vẽ, văn bản, ảnh, tin nhắn bạn tạo; danh sách thành viên và thời điểm vào phòng.
          </li>
          <li>
            <b>Dữ liệu kỹ thuật:</b> bộ đếm số thao tác để chống spam. Chúng tôi không dùng cookie quảng cáo hay công cụ theo
            dõi bên thứ ba.
          </li>
        </ul>
      </Section>

      <Section title="2. Chúng tôi bảo vệ dữ liệu như thế nào">
        <ul>
          <li>
            <b>Mã hoá chat và bảng vẽ:</b> tin nhắn và nội dung bảng được mã hoá AES-256-GCM ngay trong trình duyệt của bạn
            trước khi gửi đi. Cơ sở dữ liệu chỉ lưu bản đã mã hoá. Mỗi phòng có khoá riêng, chỉ cấp cho thành viên đã được
            duyệt.
          </li>
          <li>
            <b>Mã hoá thông tin cá nhân:</b> họ tên, số điện thoại, ngày sinh được mã hoá AES-256-GCM bằng khoá riêng của
            từng người trước khi lưu. Người cùng phòng không xem được hồ sơ của bạn.
          </li>
          <li>
            <b>Khoá tách khỏi dữ liệu:</b> khoá mã hoá chính được lưu ở máy chủ ứng dụng, tách biệt với cơ sở dữ liệu. Nếu
            chỉ cơ sở dữ liệu bị lộ, nội dung vẫn không đọc được.
          </li>
          <li>
            <b>Phân quyền chặt chẽ:</b> mọi bảng dữ liệu đều bật kiểm soát truy cập theo dòng (Row Level Security). Bạn chỉ
            đọc được phòng mình là thành viên và hồ sơ của chính mình.
          </li>
          <li>
            <b>Kết nối mã hoá:</b> mọi dữ liệu truyền đi đều qua HTTPS/TLS.
          </li>
          <li>
            <b>Chống lạm dụng:</b> giới hạn tốc độ gửi tin, tạo phòng, vào phòng; xác nhận email khi đăng ký.
          </li>
        </ul>
        <p className="rounded-xl bg-canvas px-4 py-3 text-sm">
          <b>Nói thẳng về giới hạn:</b> đây không phải mã hoá đầu-cuối tuyệt đối. Máy chủ ứng dụng giữ khoá để cấp cho thành
          viên, nên về mặt kỹ thuật đơn vị vận hành máy chủ có thể giải mã. Ảnh tải lên bảng được lưu không mã hoá, truy cập
          bằng đường dẫn ngẫu nhiên khó đoán. Tên phòng, tên hiển thị và email cần thiết để vận hành nên không được mã hoá
          bằng khoá của chúng tôi (vẫn được nhà cung cấp hạ tầng mã hoá khi lưu trên ổ đĩa).
        </p>
      </Section>

      <Section title="3. Chúng tôi dùng dữ liệu để làm gì">
        <ul>
          <li>Vận hành bảng trắng, chat, duyệt thành viên và lưu phòng theo tài khoản.</li>
          <li>Gửi email cần thiết (xác nhận đăng ký, đặt lại mật khẩu). Không gửi quảng cáo.</li>
          <li>Phát hiện và ngăn chặn spam, lạm dụng, truy cập trái phép.</li>
        </ul>
        <p>Chúng tôi không bán, cho thuê hay chia sẻ dữ liệu của bạn cho bên thứ ba vì mục đích thương mại.</p>
      </Section>

      <Section title="4. Bên xử lý dữ liệu">
        <ul>
          <li>Supabase: cơ sở dữ liệu, xác thực, realtime, lưu trữ ảnh.</li>
          <li>Vercel: máy chủ ứng dụng web.</li>
          <li>Google: chỉ khi bạn chọn đăng nhập bằng Google.</li>
        </ul>
        <p>Dữ liệu có thể được lưu trên máy chủ ở ngoài Việt Nam, tuỳ khu vực bạn chọn khi triển khai.</p>
      </Section>

      <Section title="5. Lưu giữ và xoá">
        <ul>
          <li>Nội dung phòng được lưu cho đến khi chủ phòng xoá phòng.</li>
          <li>
            Khi bạn xoá tài khoản: hồ sơ, các phòng bạn tạo (kèm toàn bộ nội dung) và tin nhắn bạn đã gửi đều bị xoá vĩnh
            viễn.
          </li>
          <li>Bản sao lưu của nhà cung cấp hạ tầng có thể tồn tại thêm một thời gian ngắn trước khi bị ghi đè.</li>
        </ul>
      </Section>

      <Section title="6. Quyền của bạn">
        <ul>
          <li>Xem và sửa hồ sơ tại trang Hồ sơ & bảo mật.</li>
          <li>Xoá thông tin tuỳ chọn hoặc xoá toàn bộ tài khoản bất cứ lúc nào.</li>
          <li>Đăng xuất khỏi mọi thiết bị khi nghi ngờ tài khoản bị lộ.</li>
          <li>Yêu cầu thông tin về dữ liệu của bạn hoặc khiếu nại qua {CONTACT}.</li>
        </ul>
      </Section>

      <Section title="7. Trẻ em">
        <p>
          Bàn Tròn không dành cho trẻ em dưới 16 tuổi tự đăng ký tài khoản khi chưa có sự đồng ý của cha mẹ hoặc người giám
          hộ.
        </p>
      </Section>

      <Section title="8. Liên hệ">
        <p>Mọi câu hỏi về quyền riêng tư hoặc báo cáo sự cố bảo mật, vui lòng gửi về {CONTACT}.</p>
      </Section>
    </LegalPage>
  );
}

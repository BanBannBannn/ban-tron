import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Điều khoản sử dụng" };

// Mẫu điều khoản cơ bản. Hãy điền thông tin đơn vị vận hành và nhờ người có chuyên môn pháp lý rà soát trước khi phát hành.
const OPERATOR = "Trần Văn Gia Bân";
const CONTACT = "tranvangiaban@gmail.com";

export default function TermsPage() {
  return (
    <LegalPage title="Điều khoản sử dụng" updated="18/11/2026">
      <p>
        Chào mừng bạn đến với Bàn Tròn, dịch vụ bảng trắng cộng tác và trò chuyện theo thời gian thực do {OPERATOR} vận
        hành (“chúng tôi”). Khi truy cập hoặc sử dụng Bàn Tròn, bạn đồng ý với các điều khoản dưới đây. Nếu không đồng ý,
        vui lòng ngừng sử dụng dịch vụ.
      </p>

      <Section title="1. Tài khoản">
        <ul>
          <li>Bạn có thể dùng Bàn Tròn với tư cách khách (không cần tài khoản) hoặc đăng ký tài khoản bằng email / Google.</li>
          <li>Bạn chịu trách nhiệm giữ bí mật mật khẩu và mọi hoạt động diễn ra dưới tài khoản của mình.</li>
          <li>Thông tin bạn cung cấp khi đăng ký phải chính xác. Không mạo danh người hoặc tổ chức khác.</li>
          <li>Bạn có thể xoá tài khoản bất cứ lúc nào tại trang Hồ sơ & bảo mật.</li>
        </ul>
      </Section>

      <Section title="2. Nội dung của bạn">
        <ul>
          <li>Bạn giữ toàn bộ quyền đối với nội dung bạn tạo (nét vẽ, văn bản, ảnh, tin nhắn).</li>
          <li>
            Bạn cấp cho chúng tôi quyền lưu trữ, mã hoá, truyền tải và hiển thị nội dung đó cho những người trong phòng, chỉ
            nhằm mục đích vận hành dịch vụ.
          </li>
          <li>
            Trong một phòng, mọi thành viên đều có thể xem, chỉnh sửa và xoá nội dung trên bảng. Chỉ mời những người bạn tin
            tưởng.
          </li>
          <li>Chủ phòng có quyền duyệt, mời ra, chặn thành viên và xoá phòng (kèm toàn bộ nội dung).</li>
        </ul>
      </Section>

      <Section title="3. Hành vi bị cấm">
        <ul>
          <li>Đăng tải nội dung vi phạm pháp luật Việt Nam, xâm phạm quyền sở hữu trí tuệ hoặc quyền riêng tư của người khác.</li>
          <li>Quấy rối, đe doạ, lừa đảo, phát tán mã độc hoặc nội dung khiêu dâm trẻ em.</li>
          <li>Spam, tạo tài khoản / phòng hàng loạt, dò mã phòng, hoặc cố ý làm quá tải hệ thống.</li>
          <li>Tìm cách truy cập trái phép dữ liệu, phòng hoặc tài khoản của người khác, hoặc vượt qua cơ chế bảo mật.</li>
        </ul>
        <p>Chúng tôi có thể giới hạn tốc độ, xoá nội dung hoặc khoá tài khoản vi phạm mà không cần báo trước.</p>
      </Section>

      <Section title="4. Phát hiện lỗ hổng bảo mật">
        <p>
          Nếu bạn phát hiện lỗ hổng, vui lòng báo riêng cho chúng tôi qua {CONTACT} và không khai thác, không công bố trước
          khi lỗi được sửa. Chúng tôi trân trọng mọi báo cáo có trách nhiệm.
        </p>
      </Section>

      <Section title="5. Giới hạn trách nhiệm">
        <ul>
          <li>
            Dịch vụ được cung cấp “nguyên trạng”. Chúng tôi nỗ lực bảo đảm an toàn và ổn định nhưng không cam kết dịch vụ
            không bao giờ gián đoạn hay không có lỗi.
          </li>
          <li>Bạn nên tự lưu bản sao (ví dụ xuất ảnh PNG) đối với nội dung quan trọng.</li>
          <li>
            Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm cho thiệt hại gián tiếp phát sinh từ việc sử
            dụng dịch vụ hoặc từ nội dung do người dùng khác tạo ra.
          </li>
        </ul>
      </Section>

      <Section title="6. Thay đổi điều khoản">
        <p>
          Chúng tôi có thể cập nhật điều khoản này. Ngày cập nhật được ghi ở đầu trang; nếu thay đổi quan trọng, chúng tôi
          sẽ thông báo trên trang chủ. Việc bạn tiếp tục sử dụng sau khi cập nhật đồng nghĩa với việc chấp nhận điều khoản
          mới.
        </p>
      </Section>

      <Section title="7. Luật áp dụng & liên hệ">
        <p>
          Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Mọi thắc mắc xin gửi về {CONTACT}.
        </p>
      </Section>
    </LegalPage>
  );
}

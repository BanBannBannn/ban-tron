import { Suspense } from "react";
import { Room, RoomLoading } from "@/components/room/Room";

// Mã phòng chỉ biết lúc chạy → đọc params trong <Suspense> (yêu cầu của Cache Components).
export default function RoomPage({ params }: PageProps<"/r/[slug]">) {
  return (
    <Suspense fallback={<RoomLoading />}>
      <RoomResolver params={params} />
    </Suspense>
  );
}

async function RoomResolver({ params }: { params: PageProps<"/r/[slug]">["params"] }) {
  const { slug } = await params;
  return <Room slug={decodeURIComponent(slug).toLowerCase()} />;
}

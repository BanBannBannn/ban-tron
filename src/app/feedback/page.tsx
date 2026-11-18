import type { Metadata } from "next";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";

export const metadata: Metadata = { title: "Góp ý & đánh giá" };

export default function FeedbackPage() {
  return <FeedbackForm />;
}

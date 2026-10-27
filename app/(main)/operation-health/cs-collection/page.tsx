import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listCsInquiries } from "@/domain/service-cs-inquiry";

import { CsInquiriesPanel } from "./cs-inquiries-panel";

export const metadata: Metadata = { title: "CS 수집 · LetsOperation" };

// 불러오기나 카테고리 고치기를 다른 사람이 방금 했을 수 있다.
export const dynamic = "force-dynamic";

export default async function CsCollectionPage() {
  const snapshot = await listCsInquiries();

  return (
    <>
      <PageHeader
        title="CS 수집"
        description="실서비스 챌린지 1:1 문의를 모아 고객 이름 · 제목 · 챌린지 · 플랜 · 본문으로 찾고, 카테고리로 나눠 봅니다."
      />

      <CsInquiriesPanel snapshot={snapshot} />
    </>
  );
}

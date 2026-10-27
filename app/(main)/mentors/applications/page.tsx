import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listMentorApplications } from "@/domain/mentor-application";

import { MentorApplicationsPanel } from "./mentor-applications-panel";

export const metadata: Metadata = { title: "멘토 신청 · LetsOperation" };

// 신청서는 랜딩에서 언제든 들어오고, 상태 · 메모는 다른 사람이 방금 고쳤을 수 있다.
export const dynamic = "force-dynamic";

export default async function MentorApplicationsPage() {
  const applications = await listMentorApplications();

  return (
    <>
      <PageHeader
        title="멘토 신청"
        description="멘토 모집 페이지로 들어온 신청서를 읽고, 진행 상태와 운영 메모를 남깁니다. 지원자는 이름 · 전화번호로 진행 상태만 조회합니다."
      />

      <MentorApplicationsPanel applications={applications} />
    </>
  );
}

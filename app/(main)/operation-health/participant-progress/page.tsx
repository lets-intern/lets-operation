import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listParticipantProgress } from "@/domain/service-participant-progress";

import { ParticipantProgressPanel } from "./participant-progress-panel";

export const metadata: Metadata = { title: "참여자 수행 현황 · LetsOperation" };

// 불러오기를 다른 사람이 방금 했을 수 있다.
export const dynamic = "force-dynamic";

export default async function ParticipantProgressPage() {
  const snapshot = await listParticipantProgress();

  return (
    <>
      <PageHeader
        title="참여자 수행 현황"
        description="실서비스 챌린지의 회차별 미션 제출과 점수를 기수마다 보고, 지난 기수보다 제출이 크게 떨어진 회차를 찾습니다."
      />

      <ParticipantProgressPanel snapshot={snapshot} />
    </>
  );
}

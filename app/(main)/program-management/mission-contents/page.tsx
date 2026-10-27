import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listMissionContents } from "@/domain/service-mission-content";

import { MissionContentsPanel } from "./mission-contents-panel";

export const metadata: Metadata = { title: "미션 콘텐츠 · LetsOperation" };

// 불러오기를 다른 사람이 방금 했을 수 있다.
export const dynamic = "force-dynamic";

// 불러오기가 본문 180여 개를 받는다(전수 약 40초). 이 페이지의 서버 액션에도 같은 한도가 걸린다.
export const maxDuration = 120;

export default async function MissionContentsPage() {
  const snapshot = await listMissionContents();

  return (
    <>
      <PageHeader
        title="미션 콘텐츠"
        description="챌린지 미션에 붙은 미션 템플릿과 필수 · 추가 콘텐츠를 회차별로 모아 미리 보고, 적힌 문구를 여러 콘텐츠에서 한 번에 찾습니다."
      />

      <MissionContentsPanel snapshot={snapshot} />
    </>
  );
}

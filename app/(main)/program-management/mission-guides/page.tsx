import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listMissionGuides } from "@/domain/service-mission-guide";

import { MissionGuidesPanel } from "./mission-guides-panel";

export const metadata: Metadata = { title: "미션 가이드 · LetsOperation" };

// 불러오기를 다른 사람이 방금 했을 수 있다.
export const dynamic = "force-dynamic";

// 불러오기가 원문 330여 개를 받는다. 이 페이지의 서버 액션에도 같은 한도가 걸린다.
export const maxDuration = 120;

export default async function MissionGuidesPage() {
  const snapshot = await listMissionGuides();

  return (
    <>
      <PageHeader
        title="미션 가이드"
        description="챌린지 가이드와 대시보드 공지사항, 회차별 미션의 미션명 · 내용 · 가이드 내용을 기수별로 모아 보고, 적힌 문구를 한 번에 찾습니다."
      />

      <MissionGuidesPanel snapshot={snapshot} />
    </>
  );
}

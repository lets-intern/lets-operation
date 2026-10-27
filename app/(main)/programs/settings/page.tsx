import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listChallengeSettings } from "@/domain/challenge-setting";

import { SettingsPanel } from "./settings-panel";

export const metadata: Metadata = { title: "프로그램 설정 · LetsOperation" };

// 설정 현황은 매번 최신이어야 한다. 정적으로 굳히지 않는다.
export const dynamic = "force-dynamic";

export default async function ProgramSettingsPage() {
  const rows = await listChallengeSettings();

  return (
    <>
      <PageHeader
        title="프로그램 설정"
        description="챌린지마다 수행기간과 미션·피드백 구성을 정합니다. 여기서 정한 방식을 그 챌린지의 모든 기수가 따릅니다."
      />

      <SettingsPanel rows={rows} />
    </>
  );
}

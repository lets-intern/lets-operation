import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "Redash · LetsOperation" };

export default function RedashPage() {
  return (
    <>
      <PageHeader
        title="Redash"
        description="실적 숫자의 공급원. 프로그램에 붙인 대시보드에서 지표를 자동으로 받아옵니다."
      />
      <UnderConstruction note="연동 상태 · 수집 이력 · 대시보드 연결 관리를 담을 예정입니다." />
    </>
  );
}

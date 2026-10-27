import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "업무 현황 관리 · LetsOperation" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="업무 현황 관리"
        description="동시 운영의 충돌을 미리 보는 곳. 기한 임박·지연 항목을 여기서 잡습니다."
      />
      <UnderConstruction note="구체적 구성은 별도 기획에서 정의합니다." />
    </>
  );
}

import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "운영 헬스 체크 · LetsOperation" };

export default function OperationHealthPage() {
  return (
    <>
      <PageHeader
        title="운영 헬스 체크"
        description="운영 중인 프로그램이 탈 없이 돌아가는지 살피는 곳. CS와 참여자 수행을 모아 봅니다."
      />
      <UnderConstruction note="구체적 구성은 별도 기획에서 정의합니다." />
    </>
  );
}

import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "대시보드 · LetsOperation" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="대시보드"
        description="서비스에 하나뿐인 대시보드. 기한과 판단에 쓰이는 지표를 다룹니다."
      />
      <UnderConstruction note="구체적 구성은 별도 기획에서 정의합니다." />
    </>
  );
}

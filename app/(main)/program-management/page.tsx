import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "프로그램 관리 · LetsOperation" };

export default function ProgramManagePage() {
  return (
    <>
      <PageHeader
        title="프로그램 관리"
        description="프로그램 자체를 다루는 곳. 등록·수정과 목록을 관리합니다."
      />
      <UnderConstruction note="구체적 구성은 별도 기획에서 정의합니다." />
    </>
  );
}

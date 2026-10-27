import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { UnderConstruction } from "@/components/under-construction";

export const metadata: Metadata = { title: "멘토 관리 · LetsOperation" };

export default function MentorsPage() {
  return (
    <>
      <PageHeader title="멘토 관리" description="프로그램에 참여하는 멘토를 다루는 곳." />
      <UnderConstruction note="구체적 구성은 별도 기획에서 정의합니다." />
    </>
  );
}

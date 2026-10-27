import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import {
  lastDetailPagesFetchedAt,
  listDetailImageTexts,
  listDetailPages,
} from "@/domain/service-detail-page";

import { DetailPagesPanel } from "./detail-pages-panel";

export const metadata: Metadata = { title: "상세페이지 · LetsOperation" };

// 불러오기와 이미지 읽기를 다른 사람이 방금 했을 수 있다.
export const dynamic = "force-dynamic";

// 화면 읽기가 한 번에 45초 남짓 실서비스 페이지를 연다. 브라우저 띄우기와 저장까지 넉넉히 둔다.
export const maxDuration = 120;

export default async function DetailPagesPage() {
  const pages = await listDetailPages();
  const imageTexts = await listDetailImageTexts();
  const lastFetchedAt = await lastDetailPagesFetchedAt();

  return (
    <>
      <PageHeader
        title="상세페이지"
        description="실서비스 챌린지 상세페이지를 모아 미리 보고, 적힌 문구를 여러 페이지에서 한 번에 찾습니다. 이미지 속 글자도 읽어두면 함께 찾습니다."
      />

      <DetailPagesPanel
        pages={pages}
        imageTexts={imageTexts}
        lastFetchedAt={lastFetchedAt ? lastFetchedAt.toISOString() : null}
      />
    </>
  );
}

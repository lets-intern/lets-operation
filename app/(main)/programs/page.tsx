import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { todayInKorea } from "@/domain/date";
import { listNoticeReservations } from "@/domain/notice-reservation";
import { listProgramPeriods } from "@/domain/program";
import { loadProgramStatus } from "@/domain/program-status";

import { NoticeReservations } from "./notice-reservations";
import { OperationStatus } from "./operation-status";
import { ProgramCalendar } from "./program-calendar";

export const metadata: Metadata = { title: "프로그램 운영 · LetsOperation" };

// 오늘이 언제인지에 따라 운영 중과 종료가 갈린다. 정적으로 굳히지 않는다.
export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  // 오늘은 서버에서 한 번 정한다. 클라이언트가 따로 계산하면 자정 근처에서 화면이 어긋난다.
  const today = todayInKorea();
  const periods = await listProgramPeriods();
  // 운영 현황은 캘린더가 읽어 둔 기간을 그대로 쓴다. 같은 화면이 무엇이 도는지를 두 번
  // 따로 판단하면 막대와 목록이 어긋난다.
  const status = await loadProgramStatus(periods, today);
  // 걸린 예약은 기수의 것이라 안내문 화면이 아니라 여기서 본다(plan.md §5).
  const reservations = await listNoticeReservations(today);

  return (
    <>
      <PageHeader
        title="프로그램 운영"
        description="한 프로그램의 실행 본부. 어떤 기수가 언제 도는지부터 봅니다."
      />

      <div className="flex flex-1 flex-col gap-4">
        {/*
         * 캘린더와 할 일을 나란히 둔다. 어느 기수가 도는지와 그래서 뭘 해야 하는지는
         * 늘 함께 보는 것이라, 세로로 쌓으면 스크롤로 갈린다(업무 현황 관리와 같은 짜임).
         */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ProgramCalendar periods={periods} today={today} />
          </div>

          <div className="flex min-h-[20rem] flex-col gap-4 lg:col-span-1">
            <OperationStatus
              rows={status.rows}
              checkedAt={formatCheckedAt(status.retrievedAt)}
              unavailable={status.unavailable}
            />

            <NoticeReservations rows={reservations} />

            {/* 다음 단계에서 실제 내용이 들어갈 영역. 자리와 이름만 잡아둔다. */}
            <section className="border-border flex flex-1 flex-col gap-1 rounded-lg border border-dashed p-6">
              <h2 className="text-sm font-medium">할 일 목록</h2>
              <p className="text-muted-foreground text-sm">
                캘린더에서 고른 프로그램의 태스크와 마일스톤이 들어갈 영역입니다.
              </p>
            </section>
          </div>
        </div>

        {/* 실행 본부의 나머지. 폭을 다 쓰는 것들이라 아래로 내린다(plan.md §5). */}
        <section className="border-border flex flex-col gap-1 rounded-lg border border-dashed p-6">
          <h2 className="text-sm font-medium">
            개요 · 운영 타임라인 · 현황 지표 · 링크 허브 · 이슈 로그
          </h2>
          <p className="text-muted-foreground text-sm">
            캘린더에서 프로그램 하나를 고르면 열리는 실행 본부 영역입니다.
          </p>
        </section>
      </div>
    </>
  );
}

/**
 * 인원이 집계된 시각. 저쪽 쿼리는 하루 한 번 도므로 지금 수가 아닐 수 있어, 언제 센 것인지를
 * 함께 적는다. 서버 시간대와 무관하게 한국 기준으로 쓴다(개설 화면과 같은 꼴).
 */
function formatCheckedAt(retrievedAt: Date | null): string | null {
  if (!retrievedAt) return null;

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(retrievedAt);
}

import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import {
  listChallengeOptions,
  listChallengeServiceLinks,
} from "@/domain/challenge";
import { todayInKorea } from "@/domain/date";
import {
  lastMktSyncedAt,
  listPendingMktPrograms,
} from "@/domain/mkt-planned-program";
import { listProgramLaunches } from "@/domain/program";
import {
  listServicePrograms,
  listServiceTypeOptions,
  type ServiceTypeOption,
} from "@/domain/service-program";

import { LaunchRow } from "./launch-row";
import { PendingList } from "./pending-list";
import { ServiceLinkList } from "./service-link-list";
import { SyncButton } from "./sync-button";

export const metadata: Metadata = { title: "프로그램 개설 · LetsOperation" };

// 개설 현황은 매번 최신이어야 한다. 정적으로 굳히지 않는다.
export const dynamic = "force-dynamic";

export default async function ProgramCreatePage() {
  const today = todayInKorea();

  const [challenges, launches, pending, syncedAt, links, service] =
    await Promise.all([
      listChallengeOptions(),
      listProgramLaunches(today),
      listPendingMktPrograms(),
      lastMktSyncedAt(),
      listChallengeServiceLinks(),
      loadServiceTypeOptions(),
    ]);

  return (
    <>
      <PageHeader
        title="프로그램 개설"
        description="마케팅팀이 기획한 프로그램을 가져와 기수로 세웁니다. 상세페이지를 언제까지 열지가 여기서 정해집니다."
      />

      <div className="flex flex-1 flex-col gap-4">
        <section className="border-border flex-1 rounded-lg border p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">개설 예정 목록</h2>
              <span className="text-muted-foreground text-xs">
                오픈 목표일이 급한 순 · {launches.length}건
              </span>
            </div>
            <SyncButton syncedAt={formatSyncedAt(syncedAt)} />
          </div>

          {launches.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              개설할 프로그램이 없습니다. 운영을 시작한 기수는 운영 캘린더에서 봅니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-3 font-medium">프로그램</th>
                    <th className="py-2 pr-3 font-medium">커리큘럼</th>
                    <th className="py-2 pr-3 font-medium">시작일</th>
                    <th className="py-2 pr-3 font-medium">오픈 목표일</th>
                    <th className="py-2 pr-3 font-medium">D-day</th>
                    <th className="py-2 pr-3 font-medium">버전</th>
                    <th className="py-2 pr-3 font-medium">상태</th>
                    <th className="py-2 pl-8 font-medium">
                      <span className="sr-only">관리</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {launches.map((launch) => (
                    <LaunchRow
                      key={launch.programId}
                      launch={launch}
                      today={today}
                      challenges={challenges}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/*
         * 실서비스 구분을 잇는 자리. 안 이은 챌린지의 기수는 자동 확인에서 통째로 빠지는데,
         * 이을 곳이 다른 화면에 있으면 왜 확인이 안 되는지 알 길이 없다(plan.md §5 별칭과 같은 이유).
         */}
        {links.length > 0 ? (
          <section className="border-border rounded-lg border p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-medium">실제 프로그램 연결</h2>
                <span className="text-muted-foreground text-xs">
                  상세페이지가 실제로 열렸는지 여기 이어진 구분으로 대조합니다
                </span>
              </div>
              <span className="text-muted-foreground text-xs">
                {service.checkedAt ? `DB 목록 ${service.checkedAt} 기준` : null}
              </span>
            </div>
            <ServiceLinkList
              links={links}
              options={service.options}
              unavailable={service.unavailable}
            />
          </section>
        ) : null}

        {/* 개설이 막힌 기획은 사유를 알려야 한다. 모르면 목록에서 그냥 사라진 것처럼 보인다. */}
        {pending.length > 0 ? (
          <section className="border-border rounded-lg border p-6">
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">개설하지 못한 기획</h2>
              <span className="text-muted-foreground text-xs">
                {pending.length}건 · 사유가 풀리면 다음 가져오기에 개설됩니다
              </span>
            </div>
            <PendingList pending={pending} challenges={challenges} />
          </section>
        ) : null}

        {challenges.length === 0 ? (
          // 챌린지가 하나도 없으면 어떤 기획도 개설되지 않는다. 갈 곳부터 알려준다.
          <p className="text-muted-foreground text-sm">
            등록된 챌린지가 없습니다.{" "}
            <Link
              href="/programs/settings"
              className="text-foreground font-medium underline underline-offset-2"
            >
              프로그램 설정
            </Link>
            에서 챌린지를 먼저 등록해야 기획이 기수로 세워집니다.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** 사람이 읽는 시각. 서버 시간대와 무관하게 한국 기준으로 적는다. */
function formatSyncedAt(syncedAt: Date | null): string | null {
  if (!syncedAt) return null;

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(syncedAt);
}

type ServiceTypeLoad = {
  options: ServiceTypeOption[];
  /** 저쪽 결과가 언제 돌아간 것인지. 묵은 결과를 보고 있는지 드러난다. */
  checkedAt: string | null;
  unavailable: string | null;
};

/**
 * 구분 보기를 실서비스 목록에서 뽑아 온다. 저쪽이 막혀 있어도 개설 화면 전체가 죽으면
 * 안 되므로 사유만 안고 빈 보기로 돌아간다 — 개설 목록은 실서비스와 무관하게 쓸 수 있어야 한다.
 */
async function loadServiceTypeOptions(): Promise<ServiceTypeLoad> {
  try {
    const { programs, retrievedAt } = await listServicePrograms();
    return {
      options: listServiceTypeOptions(programs),
      checkedAt: formatSyncedAt(retrievedAt),
      unavailable: null,
    };
  } catch (error) {
    console.error("DB 목록을 읽지 못했습니다", error);
    return {
      options: [],
      checkedAt: null,
      unavailable: "DB 목록을 읽지 못했습니다",
    };
  }
}

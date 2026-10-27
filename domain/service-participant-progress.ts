import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchRedashResult, PARTICIPANT_PROGRESS_QUERY } from "@/lib/redash";

import {
  computeCohorts,
  foldProgressRows,
  PROGRESS_REQUIRED_COLUMNS,
  type CohortView,
  type ProgressMission,
  type ProgressParticipant,
} from "./participant-progress";
import { errorMessage } from "./service-detail-page";

/**
 * 실서비스 미션 제출을 기수별 사본으로 두는 일(plan.md §5 — 참여자 수행 현황).
 *
 * 제출은 Redash 쿼리 344 에서 받는다. 원문의 주인은 실서비스라 우리는 읽기만 한다.
 * 사본에는 숫자만 두고 정시 · 지각 · 반려 · 점수 · 경고는 화면을 그릴 때 계산한다.
 */

/** 기수 수백 개를 한 트랜잭션으로 바꾸는 한도. 기본 5초로는 풀러가 붐빌 때 모자란다. */
const WRITE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 운영DB 는 한국 시각으로 적는다. 비교 기준이 되는 쿼리 시각도 같은 꼴로 바꾼다. */
function toKstText(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

function toDateOnly(text: string): Date {
  return new Date(`${text}T00:00:00Z`);
}

function fromDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type ParticipantProgressSyncResult = {
  cohorts: number;
  participants: number;
  /** 빼 둔 테스트 챌린지 수 */
  testChallenges: number;
  /** 사용자가 없는 신청 줄 수 */
  noUser: number;
  /** 열쇠 · 날짜를 못 읽어 버린 줄 수 */
  skipped: number;
};

/** 쿼리 결과를 받아 사본을 통째로 바꾼다. 결과를 못 받거나 모양이 바뀌었으면 아무것도 고치지 않고 던진다. */
export async function syncParticipantProgress(): Promise<ParticipantProgressSyncResult> {
  const { rows, retrievedAt } = await fetchRedashResult({ fresh: true, query: PARTICIPANT_PROGRESS_QUERY }).catch(
    (error: unknown) => {
      throw new Error(`Redash 쿼리 결과를 받지 못했습니다. ${errorMessage(error)}`);
    },
  );
  if (rows.length === 0) throw new Error("Redash 쿼리 결과가 비어 있습니다. 쿼리 344 를 확인하세요.");
  const missingColumns = PROGRESS_REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length > 0) {
    throw new Error(`Redash 쿼리 결과에 칸이 없습니다: ${missingColumns.join(", ")}. 쿼리 344 를 확인하세요.`);
  }

  const { cohorts, testChallenges, noUser, skipped } = foldProgressRows(rows);
  if (cohorts.length === 0) throw new Error("Redash 쿼리 결과에서 읽어낸 기수가 없습니다. 쿼리 344 를 확인하세요.");

  try {
    await prisma.$transaction(
      [
        prisma.serviceProgressCohort.deleteMany(),
        prisma.serviceProgressCohort.createMany({
          data: cohorts.map((cohort) => ({
            id: cohort.id,
            type: cohort.type,
            title: cohort.title,
            startDate: toDateOnly(cohort.startDate),
            endDate: toDateOnly(cohort.endDate),
            missions: cohort.missions as unknown as Prisma.InputJsonValue,
            participants: cohort.participants as unknown as Prisma.InputJsonValue,
            queryRetrievedAt: retrievedAt,
          })),
        }),
      ],
      WRITE_TRANSACTION_OPTIONS,
    );
  } catch (error) {
    throw new Error(`쿼리 결과를 저장하지 못했습니다. ${errorMessage(error)}`);
  }

  return {
    cohorts: cohorts.length,
    participants: cohorts.reduce((sum, cohort) => sum + cohort.participants.length, 0),
    testChallenges,
    noUser,
    skipped,
  };
}

export type ParticipantProgressSnapshot = {
  cohorts: CohortView[];
  /** Redash 에서 쿼리가 돈 시각 */
  queryRetrievedAt: string | null;
};

export async function listParticipantProgress(): Promise<ParticipantProgressSnapshot> {
  const rows = await prisma.serviceProgressCohort.findMany({ orderBy: [{ startDate: "desc" }, { id: "desc" }] });
  if (rows.length === 0) return { cohorts: [], queryRetrievedAt: null };

  const retrievedAt = rows[0].queryRetrievedAt;
  const cohorts = computeCohorts(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      startDate: fromDateOnly(row.startDate),
      endDate: fromDateOnly(row.endDate),
      // 우리가 저장한 모양 그대로다(foldProgressRows).
      missions: row.missions as unknown as ProgressMission[],
      participants: row.participants as unknown as ProgressParticipant[],
    })),
    // 지금 시각이 아니라 쿼리가 돈 시각에 맞춰 마감 여부를 가린다 — 사본이 그 시각의 모습이다.
    toKstText(retrievedAt),
  );
  return { cohorts, queryRetrievedAt: retrievedAt.toISOString() };
}

import { addDays, atKoreanTime, type DateOnly } from "./date";
import {
  anchorsFor,
  type NoticeAudience,
  type NoticePlacement,
  type NoticeSchedule,
} from "./program-notice";
import type { MissionPlan } from "./program-setting";

/**
 * 적어둔 안내문의 "무엇으로부터 며칠" 을 한 기수의 실제 발송 시각으로 옮기는 규칙.
 * 데이터베이스도 슬랙도 모르는 순수 로직이라 노드에서 그대로 돌려 볼 수 있다.
 *
 * 안내문은 챌린지에 붙어 기수의 달력을 모르고(domain/program-notice), 기수는 어떤 글이
 * 나가는지 모른다. 둘을 만나게 하는 곳이 여기다.
 *
 * 계산하지 못하는 경우를 오류로 던지지 않고 **사유가 적힌 결과**로 돌려준다. 한 기수의
 * 안내문 열 장 중 한 장을 못 걸었다고 나머지 아홉 장을 못 걸면 안 되고, 무엇이 왜 안
 * 걸렸는지는 사람이 봐야 하는 것이기 때문이다(plan.md §5).
 */

/** 슬랙이 받아주는 예약의 한계. 이보다 먼 시점은 걸 수 없다. */
export const SLACK_MAX_SCHEDULE_DAYS = 120;

/** 한 기수의 달력. 안내문의 기준일이 이 값들에서 나온다. */
export type ProgramDates = {
  startDate: DateOnly;
  /**
   * 우리 종료일도, 이 기수를 세운 마케팅 기획의 종료일도 비어 있으면 `null`.
   * 그런 기수는 종료 후 안내문을 걸 수 없다 — 설정으로 어림하지 않는다(plan.md §5).
   */
  endDate: DateOnly | null;
  /**
   * 이 기수가 따르는 미션 구성 한 벌. 설정을 아직 안 적은 챌린지는 비어 있고,
   * 그때는 회차에 붙은 안내문이 갈 곳을 찾지 못한다.
   */
  missions: MissionPlan[];
  /**
   * 설정은 있는데 이 기수가 따를 벌을 고를 수 없어 `missions` 가 빈 사유. 커리큘럼이 나뉘는
   * 챌린지에서 기수가 커리큘럼을 고르지 않은 경우가 그렇다(domain/program-setting 의
   * settingsForProgram). 사람이 손볼 곳이 설정이 아니라 개설이라 사유를 따로 싣는다.
   */
  missionsUnresolved: string | null;
};

/** 미션 한 회차가 도는 기간. 피드백은 여기 들어가지 않는다(plan.md §5). */
export type MissionPeriod = { from: DateOnly; to: DateOnly };

/** 발송 시각을 계산할 안내문 한 장. 슬랙으로 나가는 쪽이고 시점이 적힌 것만 온다. */
export type PlannableNotice = {
  noticeId: string;
  /** 어느 채널로 걸릴지를 가른다. 시각 계산에는 쓰지 않는다. */
  audience: NoticeAudience;
  title: string;
  body: string;
  placement: NoticePlacement;
  schedule: NoticeSchedule;
};

/**
 * 한 장을 걸어 본 결과. 걸 수 있으면 시각이 있고, 못 걸면 사유가 있다.
 * 시각과 사유가 함께 있는 경우도 있다 — 계산은 됐는데 슬랙이 받지 않는 시각일 때다.
 */
export type PlannedNotice = PlannableNotice & {
  postAt: Date | null;
  failure: string | null;
};

/**
 * 미션 회차별 수행 기간. 설정에는 일수만 있고 날짜는 없으므로 **시작일부터 차례로 눕혀**
 * 계산한다. 미션이 끝난 다음 날 다음 미션이 시작하고, 피드백은 그 미션이 끝난 다음 날부터
 * 다음 미션과 나란히 돈다 — 캘린더가 미션 칩을 그리는 것과 같은 잣대다
 * (domain/program-calendar 의 missionPiecesOf).
 */
export function missionPeriodsOf(dates: ProgramDates): Map<number, MissionPeriod> {
  const periods = new Map<number, MissionPeriod>();
  let cursor = dates.startDate;

  for (const mission of dates.missions) {
    const to = addDays(cursor, mission.durationDays - 1);
    periods.set(mission.seq, { from: cursor, to });
    cursor = addDays(to, 1);
  }

  return periods;
}

/**
 * 기준일의 실제 날짜. 그 기수에서 가리킬 데가 없으면 사유를 돌려준다.
 *
 * `MISSION_END` 는 미션 **수행**이 끝나는 날이다. 피드백까지 끝난 날이 아니다(plan.md §5).
 */
export function anchorDateOf(
  dates: ProgramDates,
  schedule: NoticeSchedule,
  placement: NoticePlacement,
): { date: DateOnly; failure: null } | { date: null; failure: string } {
  // 자리에서 뜻이 없는 기준일은 화면과 서버가 막지만, 그 전에 적힌 줄이 남아 있을 수 있다.
  if (!anchorsFor(placement).includes(schedule.anchor)) {
    return { date: null, failure: "안내문의 자리와 발송 기준일이 어긋납니다." };
  }

  if (schedule.anchor === "PROGRAM_START") return { date: dates.startDate, failure: null };

  if (schedule.anchor === "PROGRAM_END") {
    return dates.endDate === null
      ? { date: null, failure: "이 기수의 종료일을 몰라 발송일을 계산할 수 없습니다." }
      : { date: dates.endDate, failure: null };
  }

  const seq = placement.missionSeq;
  if (seq === null) {
    return { date: null, failure: "회차에 붙지 않은 안내문에 미션 기준일이 적혀 있습니다." };
  }

  const period = missionPeriodsOf(dates).get(seq);
  if (!period) {
    return {
      date: null,
      failure:
        dates.missionsUnresolved ??
        (dates.missions.length === 0
          ? "이 챌린지는 프로그램 설정에 미션 구성이 없어 회차 날짜를 모릅니다."
          : `프로그램 설정에 미션 ${seq} 회차가 없습니다.`),
    };
  }

  return {
    date: schedule.anchor === "MISSION_START" ? period.from : period.to,
    failure: null,
  };
}

/**
 * 한 기수의 슬랙 안내문을 언제 걸지 한 번에 계산한다.
 *
 * `now` 는 예약을 거는 순간이다. 슬랙은 지난 시각을 받지 않으므로 그 자리에서 갈리고,
 * 너무 먼 시각도 받지 않아 함께 가린다. 우리가 먼저 가려 내는 이유는, 슬랙에 던져
 * 되받는 오류보다 우리 말로 적힌 사유가 화면에서 읽히기 때문이다.
 */
export function planNoticeReservations(
  dates: ProgramDates,
  notices: PlannableNotice[],
  now: Date,
): PlannedNotice[] {
  const horizon = now.getTime() + SLACK_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000;

  return notices.map((notice) => {
    const anchor = anchorDateOf(dates, notice.schedule, notice.placement);
    if (anchor.date === null) {
      return { ...notice, postAt: null, failure: anchor.failure };
    }

    const postAt = atKoreanTime(
      addDays(anchor.date, notice.schedule.offsetDays),
      notice.schedule.minuteOfDay,
    );

    if (postAt.getTime() <= now.getTime()) {
      return { ...notice, postAt, failure: "발송 시각이 이미 지났습니다." };
    }

    if (postAt.getTime() > horizon) {
      return {
        ...notice,
        postAt,
        failure: `슬랙은 ${SLACK_MAX_SCHEDULE_DAYS}일 앞까지만 예약을 받습니다.`,
      };
    }

    return { ...notice, postAt, failure: null };
  });
}

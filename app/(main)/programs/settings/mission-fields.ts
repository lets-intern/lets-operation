import {
  DEFAULT_FEEDBACK_DAYS,
  DEFAULT_MISSION_DURATION_DAYS,
} from "@/domain/program-setting";

/**
 * 미션 개수 칸과 미션 줄들을 잇는 규칙.
 *
 * 개수를 고치는 동안 값이 사라지지 않는 것이 요점이다. "3" 을 "12" 로 고치려면
 * 중간에 "1" 을 거치는데, 그때 배열을 잘라 버리면 2·3번 미션에 적어둔 값이 사라진다.
 * 그래서 배열은 늘리기만 하고, 줄이는 것은 그릴 때만 반영한다.
 */

/** 미션 한 줄의 입력값. 빈 칸을 그대로 담을 수 있도록 전부 문자열로 든다. */
export type MissionFieldsValue = {
  days: string;
  /** 빈 문자열이면 이 미션 뒤에 피드백이 없다. 아니면 FeedbackKind 값이다. */
  feedbackKind: string;
  feedbackDays: string;
};

export const EMPTY_MISSION_FIELDS: MissionFieldsValue = {
  days: String(DEFAULT_MISSION_DURATION_DAYS),
  feedbackKind: "",
  feedbackDays: "",
};

/**
 * 늘어난 만큼만 마지막 미션을 그대로 베껴 채운다. 적어둔 값은 그대로 둔다.
 * 피드백까지 함께 베끼는 것은, 같은 방식이 미션마다 되풀이되는 구성이 흔하기 때문이다.
 */
export function extendMissionFields(
  current: MissionFieldsValue[],
  count: number,
): MissionFieldsValue[] {
  const filler = current[current.length - 1] ?? EMPTY_MISSION_FIELDS;

  return Array.from({ length: count }, (_, index) => current[index] ?? filler);
}

/**
 * 화면에 그릴 미션 줄. 개수 칸에 적힌 만큼만 앞에서 잘라 보여준다.
 * 배열 자체는 줄지 않으므로 개수를 되돌리면 가려졌던 값이 그대로 다시 나온다.
 */
export function shownMissionFields(
  missions: MissionFieldsValue[],
  missionCount: string,
): MissionFieldsValue[] {
  const count = Number(missionCount);
  if (!Number.isInteger(count) || count < 0) return [];

  return missions.slice(0, count);
}

/**
 * 한 미션의 피드백 종류를 고른 결과.
 *
 * 종류를 고르면 일수 칸이 비어 있을 때만 채워 준다 — 앞서 다른 미션에 적어둔 일수가
 * 있으면 그것이, 없으면 기본값이 대개 맞다. "없음" 으로 되돌릴 때는 적어둔 일수를
 * 지우지 않는다. 잘못 눌렀다가 다시 고르면 적던 값이 그대로 돌아온다.
 */
export function pickFeedbackKind(
  missions: MissionFieldsValue[],
  index: number,
  kind: string,
): MissionFieldsValue[] {
  return missions.map((mission, at) => {
    if (at !== index) return mission;
    if (!kind) return { ...mission, feedbackKind: "" };

    return {
      ...mission,
      feedbackKind: kind,
      feedbackDays: mission.feedbackDays || lastFeedbackDays(missions),
    };
  });
}

/** 다른 미션에 이미 적어둔 피드백 일수 중 마지막 것. 없으면 기본값. */
function lastFeedbackDays(missions: MissionFieldsValue[]): string {
  const written = missions.filter((mission) => mission.feedbackDays);

  return written[written.length - 1]?.feedbackDays ?? String(DEFAULT_FEEDBACK_DAYS);
}

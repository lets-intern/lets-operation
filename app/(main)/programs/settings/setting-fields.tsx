"use client";

import { useId, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  countFeedbackKinds,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  isFeedbackKind,
  MAX_DURATION_DAYS,
  MAX_FEEDBACK_DAYS,
  MAX_MISSION_COUNT,
  MAX_MISSION_DURATION_DAYS,
  plannedFeedbacks,
  settingWarnings,
  totalMissionDays,
  totalProgramDays,
  trailingFeedbackDays,
  TYPICAL_FEEDBACK_DAYS_MAX,
  TYPICAL_FEEDBACK_DAYS_MIN,
  type MissionPlan,
  type ProgramSettingValues,
} from "@/domain/program-setting";

import {
  EMPTY_MISSION_FIELDS,
  extendMissionFields,
  pickFeedbackKind,
  shownMissionFields,
  type MissionFieldsValue,
} from "./mission-fields";

/**
 * 설정 입력칸. 값은 빈 칸을 그대로 담을 수 있도록 문자열로 들고,
 * 합계·경고를 계산할 때만 숫자로 읽는다.
 */
export type SettingFieldsValue = {
  durationDays: string;
  /**
   * 지금까지 적어둔 미션 줄. 개수를 줄여도 뒤쪽을 버리지 않는다.
   * "3" 을 "12" 로 고치는 동안 잠깐 1 이 되어도 적어둔 값이 살아남는다.
   */
  missions: MissionFieldsValue[];
  /** 미션 개수 칸의 값 그대로. 비우고 다시 적는 중에도 배열을 건드리지 않는다. */
  missionCount: string;
};

export const EMPTY_SETTING_FIELDS: SettingFieldsValue = {
  durationDays: "",
  missions: [EMPTY_MISSION_FIELDS],
  missionCount: "1",
};

/** 저장해 둔 설정을 입력칸 값으로 옮긴다. 목록에서 불러올 때 쓴다. */
export function toSettingFields(setting: ProgramSettingValues): SettingFieldsValue {
  return {
    durationDays: String(setting.durationDays),
    missions: setting.missions.map((mission) => ({
      days: String(mission.durationDays),
      feedbackKind: mission.feedback?.kind ?? "",
      feedbackDays: mission.feedback ? String(mission.feedback.days) : "",
    })),
    missionCount: String(setting.missions.length),
  };
}

export function SettingFields({
  value,
  onChange,
  children,
}: {
  value: SettingFieldsValue;
  onChange: (next: SettingFieldsValue) => void;
  /** 제출·취소 버튼. 입력칸 아래 같은 줄에 놓는다. */
  children: ReactNode;
}) {
  const uid = useId();

  function set(patch: Partial<SettingFieldsValue>) {
    onChange({ ...value, ...patch });
  }

  // 개수는 적힌 그대로 두고 배열은 늘리기만 한다. 줄이는 것은 그릴 때만 반영한다.
  function setMissionCount(input: string) {
    const count = Number(input);
    const grows =
      Number.isInteger(count) &&
      count > value.missions.length &&
      count <= MAX_MISSION_COUNT;

    set({
      missionCount: input,
      missions: grows ? extendMissionFields(value.missions, count) : value.missions,
    });
  }

  function setMission(index: number, patch: Partial<MissionFieldsValue>) {
    set({
      missions: value.missions.map((mission, at) =>
        at === index ? { ...mission, ...patch } : mission,
      ),
    });
  }

  const shown = shownMissionFields(value.missions, value.missionCount);
  const draft = toDraft(value);
  const warnings = draft ? settingWarnings(draft) : [];

  return (
    <>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${uid}-duration`}>수행기간</Label>
          <DayInput
            id={`${uid}-duration`}
            name="durationDays"
            max={MAX_DURATION_DAYS}
            value={value.durationDays}
            onChange={(next) => set({ durationDays: next })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-mission-count`}>미션 개수</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`${uid}-mission-count`}
              type="number"
              min={1}
              max={MAX_MISSION_COUNT}
              required
              className="w-16 text-center"
              value={value.missionCount}
              onChange={(event) => setMissionCount(event.target.value)}
            />
            <span className="text-muted-foreground text-sm">개</span>
          </div>
        </div>
      </div>

      <fieldset className="border-border rounded-lg border p-4">
        <legend className="px-1.5 text-sm font-medium">미션과 피드백</legend>

        {/* 미션 수가 늘어도 세로로 길어지지 않도록 가로로 접어 넣는다. */}
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {shown.map((mission, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <Label
                htmlFor={`${uid}-mission-${index}`}
                className="text-muted-foreground w-14 shrink-0 font-normal"
              >
                미션 {index + 1}
              </Label>
              <Input
                id={`${uid}-mission-${index}`}
                name="missionDurationDays"
                type="number"
                min={1}
                max={MAX_MISSION_DURATION_DAYS}
                required
                className="w-16 text-center"
                value={mission.days}
                onChange={(event) => setMission(index, { days: event.target.value })}
              />
              <span className="text-muted-foreground text-sm">일</span>

              {/* 피드백은 이 미션이 끝난 뒤에 붙으므로 미션 옆이 제자리다. */}
              <label
                htmlFor={`${uid}-feedback-kind-${index}`}
                className="text-muted-foreground ml-2 text-sm"
              >
                피드백
              </label>
              <NativeSelect
                id={`${uid}-feedback-kind-${index}`}
                name="missionFeedbackKind"
                className="w-24"
                value={mission.feedbackKind}
                onChange={(event) =>
                  set({
                    missions: pickFeedbackKind(
                      value.missions,
                      index,
                      event.target.value,
                    ),
                  })
                }
              >
                <option value="">없음</option>
                {FEEDBACK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {FEEDBACK_KIND_LABELS[kind]}
                  </option>
                ))}
              </NativeSelect>

              {/* 일수 칸이 사라져도 줄 너비가 흔들리지 않도록 자리는 지킨다. */}
              <span className="flex w-[4.75rem] shrink-0 items-center gap-1.5">
                {mission.feedbackKind ? (
                  <>
                    <Input
                      name="missionFeedbackDays"
                      type="number"
                      min={1}
                      max={MAX_FEEDBACK_DAYS}
                      required
                      aria-label={`미션 ${index + 1} 피드백 기간`}
                      className="w-16 text-center"
                      value={mission.feedbackDays}
                      onChange={(event) =>
                        setMission(index, { feedbackDays: event.target.value })
                      }
                    />
                    <span className="text-muted-foreground text-sm">일</span>
                  </>
                ) : (
                  // 안 보내면 미션 줄과 피드백 줄의 수가 어긋난다. 빈 값으로 자리를 채운다.
                  <input type="hidden" name="missionFeedbackDays" value="" />
                )}
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <p className="text-muted-foreground text-xs">
        {draft === null ? (
          `피드백은 미션이 끝난 뒤 서면 또는 라이브로 보통 ${TYPICAL_FEEDBACK_DAYS_MIN}~${TYPICAL_FEEDBACK_DAYS_MAX}일 진행됩니다. 수행기간에 포함되지 않고 마지막 피드백만큼 뒤에 붙습니다.`
        ) : (
          <>
            미션 일수 합계 {totalMissionDays(draft.missions)}일 ·{" "}
            {feedbackSummary(draft.missions)} · 전체 기간{" "}
            <span className="text-foreground font-medium">
              {totalProgramDays(draft)}일
            </span>{" "}
            = 수행기간 {draft.durationDays}일
            {trailingFeedbackDays(draft.missions) > 0
              ? ` + 마지막 피드백 ${trailingFeedbackDays(draft.missions)}일`
              : ""}
          </>
        )}
      </p>

      {warnings.map((warning) => (
        <p key={warning} role="status" className="text-xs">
          <span className="text-foreground font-medium">확인</span>{" "}
          <span className="text-muted-foreground">{warning}</span>
        </p>
      ))}

      <div className="flex items-center gap-2">{children}</div>
    </>
  );
}

/** 피드백 횟수는 적어둔 것을 세어 보여준다. 따로 적는 칸이 없으니 이 줄이 유일한 답이다. */
function feedbackSummary(missions: MissionPlan[]): string {
  const total = plannedFeedbacks(missions).length;
  if (total === 0) return "피드백 없음";

  const counts = countFeedbackKinds(missions);
  const kinds = FEEDBACK_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => `${FEEDBACK_KIND_LABELS[kind]} ${counts[kind]}`)
    .join(" · ");

  return `피드백 ${total}회(${kinds})`;
}

/** 일수 칸은 모양이 같아 한 번만 적는다. */
function DayInput({
  id,
  name,
  min = 1,
  max,
  value,
  onChange,
}: {
  id: string;
  name: string;
  min?: number;
  max: number;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        name={name}
        type="number"
        min={min}
        max={max}
        required
        className="w-20 text-center"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="text-muted-foreground text-sm">일</span>
    </div>
  );
}

/** 합계와 경고는 모든 칸이 채워졌을 때만 뜻이 있다. 하나라도 비면 계산하지 않는다. */
function toDraft(value: SettingFieldsValue): ProgramSettingValues | null {
  const durationDays = Number(value.durationDays);

  if (!value.durationDays || !Number.isInteger(durationDays)) return null;

  const shown = shownMissionFields(value.missions, value.missionCount);
  if (shown.length === 0) return null;

  const missions: MissionPlan[] = [];
  for (const [index, mission] of shown.entries()) {
    const days = Number(mission.days);
    if (!mission.days || !Number.isInteger(days)) return null;

    const feedbackDays = Number(mission.feedbackDays);
    if (mission.feedbackKind && !isFeedbackKind(mission.feedbackKind)) return null;
    if (mission.feedbackKind && (!mission.feedbackDays || !Number.isInteger(feedbackDays))) {
      return null;
    }

    missions.push({
      seq: index + 1,
      durationDays: days,
      feedback: isFeedbackKind(mission.feedbackKind)
        ? { kind: mission.feedbackKind, days: feedbackDays }
        : null,
    });
  }

  return { durationDays, missions };
}

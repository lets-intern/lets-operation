"use client";

import { useId, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateOnly, isDateOnly } from "@/domain/date";
import type { ChallengeOption } from "@/domain/challenge";
import { DETAIL_OPEN_LEAD_DAYS, detailOpenTargetFor } from "@/domain/program-launch";
import {
  CURRICULUM_ONE_WEEK,
  CURRICULUM_THREE_WEEKS,
  CURRICULUM_TWO_WEEKS,
  curriculumLabel,
} from "@/domain/program-setting";

import {
  CUSTOM_CURRICULUM,
  CurriculumSelect,
  type CurriculumPreset,
} from "../curriculum-select";

/**
 * 기수가 고르는 커리큘럼. 설정과 달리 `구분 없음` 이 아니라 `미지정` 에서 시작한다 — 기수는
 * 어느 커리큘럼으로 여는지를 아직 모를 수 있고, 그 상태가 목록에 드러나야 채울 수 있다.
 */
const LAUNCH_CURRICULUM_PRESETS: CurriculumPreset[] = [
  { value: "", label: "미지정" },
  ...[CURRICULUM_ONE_WEEK, CURRICULUM_TWO_WEEKS, CURRICULUM_THREE_WEEKS].map((days) => ({
    value: String(days),
    label: curriculumLabel(days),
  })),
];

export type LaunchFieldsValue = {
  challengeId: string;
  cohort: string;
  /** 고른 커리큘럼 일수, 직접 입력이면 칸에 적힌 그대로. 빈 값은 미지정이다. */
  curriculumDays: string;
  /** 커리큘럼을 `직접 입력` 으로 적는 중인지. */
  curriculumCustom: boolean;
  startDate: string;
  /** 사람이 목표일을 직접 고쳤을 때만 값이 들어간다. 비어 있으면 계산값을 따라간다. */
  targetOverride: string | null;
};

/**
 * 개설 예정 목록에서 한 줄을 고칠 때 쓰는 네 칸.
 * 기수는 마케팅팀 기획에서 자동으로 세워지고, 사람이 손대는 자리는 여기뿐이다.
 *
 * 챌린지는 프로그램 설정에서 등록한 것 중에서 고르기만 한다. 이름 관리는 그쪽 몫이다.
 */
export function LaunchFields({
  challenges,
  value,
  onChange,
  children,
}: {
  challenges: ChallengeOption[];
  value: LaunchFieldsValue;
  onChange: (next: LaunchFieldsValue) => void;
  /** 제출·취소 버튼. 입력칸과 같은 줄에 놓는다. */
  children: ReactNode;
}) {
  const uid = useId();
  const selected = challenges.find((challenge) => challenge.id === value.challengeId);

  const computedTarget = isDateOnly(value.startDate)
    ? detailOpenTargetFor(value.startDate)
    : "";
  const target = value.targetOverride ?? computedTarget;
  const isCustomTarget =
    value.targetOverride !== null && value.targetOverride !== computedTarget;

  function set(patch: Partial<LaunchFieldsValue>) {
    onChange({ ...value, ...patch });
  }

  return (
    <>
      <input type="hidden" name="challengeName" value={selected?.name ?? ""} />

      {/* 한 줄에 다 들어가도록 폭을 고정한다. 좁아지면 아래로 접힌다. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-4">
        <div className="min-w-[13rem] flex-1 space-y-2">
          <Label htmlFor={`${uid}-challenge`}>챌린지</Label>
          <NativeSelect
            id={`${uid}-challenge`}
            name="challengeId"
            required
            value={value.challengeId}
            // 커리큘럼은 챌린지 설정에 묶이지 않아 챌린지를 옮겨도 그대로 둔다.
            onChange={(event) => set({ challengeId: event.target.value })}
          >
            <option value="" disabled>
              선택하세요
            </option>
            {challenges.map((challenge) => (
              <option key={challenge.id} value={challenge.id}>
                {challenge.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-cohort`}>기수</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`${uid}-cohort`}
              name="cohort"
              type="number"
              min={1}
              max={9999}
              required
              className="w-16 text-center"
              value={value.cohort}
              onChange={(event) => set({ cohort: event.target.value })}
            />
            <span className="text-muted-foreground text-sm">기</span>
          </div>
        </div>

        {/*
         * 모든 기수에 칸을 둔다. 설정보다 먼저 고를 수 있어야 설정이 하나도 없는 동안에도
         * 어디서부터 채울지 보인다(plan.md §5).
         */}
        <div className="space-y-2">
          <Label htmlFor={`${uid}-curriculum`}>커리큘럼</Label>
          <CurriculumSelect
            id={`${uid}-curriculum`}
            name="curriculumDays"
            presets={LAUNCH_CURRICULUM_PRESETS}
            custom={value.curriculumCustom}
            value={value.curriculumDays}
            onPick={(choice) =>
              choice === CUSTOM_CURRICULUM
                ? // 이미 직접 적던 일수면 그대로 두고, 1주·2주에서 넘어오면 빈 칸에서 적는다.
                  set({
                    curriculumCustom: true,
                    curriculumDays: value.curriculumCustom ? value.curriculumDays : "",
                  })
                : set({ curriculumCustom: false, curriculumDays: choice })
            }
            onType={(input) => set({ curriculumDays: input })}
          />
        </div>

        <div className="w-40 space-y-2">
          <Label htmlFor={`${uid}-start`}>시작일</Label>
          <Input
            id={`${uid}-start`}
            name="startDate"
            type="date"
            required
            value={value.startDate}
            onChange={(event) => set({ startDate: event.target.value })}
          />
        </div>

        <div className="w-44 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${uid}-target`}>오픈 목표일</Label>
            {isCustomTarget ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                onClick={() => set({ targetOverride: null })}
              >
                기본값
              </button>
            ) : null}
          </div>
          <Input
            id={`${uid}-target`}
            name="detailOpenTargetDate"
            type="date"
            required
            max={value.startDate || undefined}
            value={target}
            onChange={(event) =>
              set({
                targetOverride:
                  event.target.value === computedTarget ? null : event.target.value,
              })
            }
          />
        </div>

        {/* 입력칸과 높이를 맞추려고 라벨 자리를 비워 둔다. */}
        <div className="space-y-2">
          <span
            aria-hidden
            className="invisible block text-sm leading-none font-medium"
          >
            &nbsp;
          </span>
          <div className="flex items-center gap-2">{children}</div>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        {isDateOnly(target) ? (
          <>
            오픈 목표일 {formatDateOnly(target)} ·{" "}
            {isCustomTarget ? (
              <span className="text-foreground font-medium">직접 지정함</span>
            ) : (
              `시작일 ${DETAIL_OPEN_LEAD_DAYS}일 전 자동 계산`
            )}
          </>
        ) : (
          `오픈 목표일은 시작일 ${DETAIL_OPEN_LEAD_DAYS}일 전으로 자동 계산됩니다. 주말·공휴일이면 직전 평일로 당깁니다.`
        )}
      </p>
    </>
  );
}

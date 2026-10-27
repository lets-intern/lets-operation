"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChallengeSettingRow, SavedSetting } from "@/domain/challenge-setting";
import {
  countFeedbackKinds,
  CURRICULUM_NONE,
  curriculumLabel,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  MAX_CHALLENGE_NAME_LENGTH,
  plannedFeedbacks,
  PROGRAM_VERSION_LABELS,
  settingLabel,
  settingSlots,
  totalMissionDays,
  totalProgramDays,
  trailingFeedbackDays,
  type MissionPlan,
  type ProgramVersion,
  type SettingSlot,
} from "@/domain/program-setting";

import {
  editChallengeName,
  moveChallengeOrder,
  removeChallenge,
  removeSetting,
  type MoveState,
  type RemoveState,
  type RenameState,
} from "./actions";

const INITIAL_REMOVE_STATE: RemoveState = { error: null };
const INITIAL_RENAME_STATE: RenameState = { error: null, saved: false };
const INITIAL_MOVE_STATE: MoveState = { error: null };

/** 한 번에 한 곳만 연다. 무엇을 하는 중인지 흐려지지 않는다. */
export type ActiveRow =
  | { action: "rename" | "remove-challenge"; challengeId: string }
  | { action: "remove-setting"; settingId: string };

/** 표에 그려질 한 줄. 아직 안 적은 버전도 자리를 잡아 무엇이 비었는지 드러난다. */
type Slot = SettingSlot<SavedSetting>;

/** 위 폼이 잡고 있는 설정 한 벌을 가리키는 두 축. */
export type SelectedSetting = { curriculumDays: number; version: ProgramVersion };

/**
 * 챌린지 하나가 차지하는 줄들. 커리큘럼 × 버전만큼 선다 — 나뉘지 않으면 한 줄이다.
 * 이름과 기수는 줄을 가로질러 한 칸에 묶어 여러 줄이 한 챌린지임을 눈으로 잇고,
 * 커리큘럼도 같은 방식으로 제 버전 줄들을 묶는다.
 */
export function ChallengeRows({
  row,
  selected,
  active,
  first,
  last,
  onAction,
  onCancel,
  onEditSetting,
}: {
  row: ChallengeSettingRow;
  /** 지금 위 폼이 이 챌린지의 어느 설정을 잡고 있는지. 없으면 다른 챌린지를 보고 있다. */
  selected: SelectedSetting | null;
  active: ActiveRow | null;
  /** 목록의 처음·끝이면 그 방향 화살표를 누를 수 없다. */
  first: boolean;
  last: boolean;
  onAction: (active: ActiveRow) => void;
  onCancel: () => void;
  onEditSetting: (target: SelectedSetting) => void;
}) {
  const [challengeState, removeChallengeAction, removingChallenge] = useActionState(
    removeChallenge,
    INITIAL_REMOVE_STATE,
  );
  const [renameState, renameAction, renaming] = useActionState(
    editChallengeName,
    INITIAL_RENAME_STATE,
  );
  const [moveState, moveAction, moving] = useActionState(
    moveChallengeOrder,
    INITIAL_MOVE_STATE,
  );

  const slots = settingSlots(row.settings);
  const challengeActive =
    active && active.action !== "remove-setting" && active.challengeId === row.challengeId
      ? active.action
      : null;
  const error = challengeState.error ?? renameState.error ?? moveState.error;

  return (
    <>
      {slots.map((slot, index) => (
        <tr
          key={`${slot.curriculumDays}:${slot.version}`}
          className={`border-border ${index === slots.length - 1 ? "border-b last:border-0" : ""} ${
            selected?.curriculumDays === slot.curriculumDays &&
            selected.version === slot.version
              ? "bg-muted/40"
              : ""
          }`}
        >
          {index === 0 ? (
            <td
              rowSpan={slots.length}
              className="border-border border-b py-2.5 pr-8 align-middle last:border-0"
            >
              {challengeActive === "rename" ? (
                <NameForm
                  action={renameAction}
                  challengeId={row.challengeId}
                  name={row.challengeName}
                  pending={renaming}
                  saved={renameState.saved}
                  onDone={onCancel}
                />
              ) : (
                <div className="space-y-1">
                  {/*
                   * 이름 옆에 붙여야 어느 이름에 대한 일인지 눈으로 이어진다.
                   * 이름은 접지 않고 한 줄로 두고 버튼만 칸 오른쪽 끝에 붙인다.
                   * 칸 너비는 가장 긴 이름이 정하므로 수정·삭제가 줄마다 같은 자리에 선다.
                   */}
                  <div className="flex items-center gap-x-1">
                    <MoveButtons
                      row={row}
                      action={moveAction}
                      pending={moving}
                      first={first}
                      last={last}
                    />
                    <p className="leading-6 font-medium whitespace-nowrap">
                      {row.challengeName}
                    </p>
                    {challengeActive === "remove-challenge" ? null : (
                      <NameButtons row={row} onAction={onAction} />
                    )}
                  </div>
                  {challengeActive === "remove-challenge" ? (
                    <ChallengeRemoveConfirm
                      row={row}
                      removeAction={removeChallengeAction}
                      removing={removingChallenge}
                      onCancel={onCancel}
                    />
                  ) : null}
                </div>
              )}

              {error ? (
                <p role="alert" className="text-destructive mt-1 text-xs">
                  {error}
                </p>
              ) : null}
            </td>
          ) : null}

          {/* 커리큘럼의 첫 줄에만 칸을 세우고 그 커리큘럼의 버전 줄들을 가로질러 묶는다. */}
          {index === 0 || slots[index - 1].curriculumDays !== slot.curriculumDays ? (
            <td
              rowSpan={
                slots.filter((other) => other.curriculumDays === slot.curriculumDays).length
              }
              className="py-2.5 pr-3 align-middle whitespace-nowrap"
            >
              {slot.curriculumDays === CURRICULUM_NONE ? (
                <span className="text-muted-foreground text-xs">
                  {curriculumLabel(CURRICULUM_NONE)}
                </span>
              ) : (
                curriculumLabel(slot.curriculumDays)
              )}
            </td>
          ) : null}

          <SettingCells
            slot={slot}
            challengeName={row.challengeName}
            confirming={
              active?.action === "remove-setting" &&
              active.settingId === slot.setting?.settingId
            }
            onAction={onAction}
            onCancel={onCancel}
            onEdit={() =>
              onEditSetting({ curriculumDays: slot.curriculumDays, version: slot.version })
            }
          />
        </tr>
      ))}
    </>
  );
}

/**
 * 횟수 옆에 붙어 그 횟수가 무엇으로 채워졌는지 잇는다.
 * 아직 하나도 안 적었으면 그것이 곧 봐야 할 상태이므로 그대로 말한다.
 */
function feedbackKindSummary(missions: MissionPlan[]): string {
  const counts = countFeedbackKinds(missions);
  const written = FEEDBACK_KINDS.filter((kind) => counts[kind] > 0);

  if (written.length === 0) return "미션에 안 적힘";

  return written
    .map((kind) => `${FEEDBACK_KIND_LABELS[kind]} ${counts[kind]}`)
    .join(" · ");
}

/**
 * 한 칸씩 자리를 옮기는 화살표. 끝에 닿으면 눌리지 않되 자리는 지켜,
 * 줄마다 이름이 같은 위치에서 시작한다.
 */
function MoveButtons({
  row,
  action,
  pending,
  first,
  last,
}: {
  row: ChallengeSettingRow;
  action: (formData: FormData) => void;
  pending: boolean;
  first: boolean;
  last: boolean;
}) {
  return (
    <form action={action} className="flex shrink-0 items-center">
      <input type="hidden" name="challengeId" value={row.challengeId} />
      <Button
        type="submit"
        name="direction"
        value="up"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        disabled={first || pending}
        aria-label={`${row.challengeName} 위로`}
      >
        <ChevronUp />
      </Button>
      <Button
        type="submit"
        name="direction"
        value="down"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        disabled={last || pending}
        aria-label={`${row.challengeName} 아래로`}
      >
        <ChevronDown />
      </Button>
    </form>
  );
}

/** 이름 바로 옆에 붙는 두 버튼. 옆에 있으니 "이름" 을 되풀이하지 않는다. */
function NameButtons({
  row,
  onAction,
}: {
  row: ChallengeSettingRow;
  onAction: (active: ActiveRow) => void;
}) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        aria-label={`${row.challengeName} 이름 수정`}
        onClick={() => onAction({ action: "rename", challengeId: row.challengeId })}
      >
        수정
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        aria-label={`${row.challengeName} 이름 삭제`}
        onClick={() =>
          onAction({ action: "remove-challenge", challengeId: row.challengeId })
        }
      >
        삭제
      </Button>
    </span>
  );
}

/** 이름을 지우기 전 되묻는 자리. 이름과 기수 아래에 펼쳐 무엇이 사라지는지 읽히게 한다. */
function ChallengeRemoveConfirm({
  row,
  removeAction,
  removing,
  onCancel,
}: {
  row: ChallengeSettingRow;
  removeAction: (formData: FormData) => void;
  removing: boolean;
  onCancel: () => void;
}) {
  if (row.programCount > 0) {
    // 이름을 지우면 딸린 기수와 태스크까지 사라진다. 그래서 아예 열어주지 않는다.
    return (
      <div className="space-y-1 pt-0.5">
        <p className="text-muted-foreground text-xs">
          {row.programCount}개 기수가 남아 있습니다. 프로그램 개설에서 먼저 지우세요.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          닫기
        </Button>
      </div>
    );
  }

  return (
    <form action={removeAction} className="space-y-1 pt-0.5">
      <input type="hidden" name="challengeId" value={row.challengeId} />
      <p className="text-muted-foreground text-xs">이름과 설정을 함께 지울까요?</p>
      <div className="flex items-center gap-1">
        <Button type="submit" variant="destructive" size="sm" disabled={removing}>
          {removing ? "삭제 중…" : "삭제"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={removing}
          onClick={onCancel}
        >
          취소
        </Button>
      </div>
    </form>
  );
}

/** 커리큘럼 · 버전 한 줄의 값과 그 줄에 딸린 일. */
function SettingCells({
  slot,
  challengeName,
  confirming,
  onAction,
  onCancel,
  onEdit,
}: {
  slot: Slot;
  challengeName: string;
  confirming: boolean;
  onAction: (active: ActiveRow) => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const [state, removeAction, removing] = useActionState(
    removeSetting,
    INITIAL_REMOVE_STATE,
  );

  const { setting } = slot;
  const label = `${challengeName} ${settingLabel(slot.curriculumDays, slot.version)}`;

  return (
    <>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        {slot.version === "COMMON" ? (
          <span className="text-muted-foreground text-xs">
            {PROGRAM_VERSION_LABELS.COMMON}
          </span>
        ) : (
          PROGRAM_VERSION_LABELS[slot.version]
        )}
      </td>

      {setting ? (
        <>
          <td className="py-2.5 pr-3 whitespace-nowrap">{setting.durationDays}일</td>
          <td className="py-2.5 pr-3 whitespace-nowrap">
            {setting.missions.length}개
            <span className="text-muted-foreground ml-1.5 text-xs">
              총 {totalMissionDays(setting.missions)}일
            </span>
          </td>
          <td className="py-2.5 pr-3 whitespace-nowrap">
            {plannedFeedbacks(setting.missions).length}회
            <span className="text-muted-foreground ml-1.5 text-xs">
              {feedbackKindSummary(setting.missions)}
            </span>
          </td>
          <td className="py-2.5 pr-3 whitespace-nowrap">
            {totalProgramDays(setting)}일
            <span className="text-muted-foreground ml-1.5 text-xs">
              {setting.durationDays} + {trailingFeedbackDays(setting.missions)}
            </span>
          </td>
        </>
      ) : (
        <td colSpan={4} className="text-muted-foreground py-2.5 pr-3 text-xs">
          아직 설정하지 않았습니다.
        </td>
      )}

      <td className="py-2.5 align-top">
        {confirming && setting ? (
          // 되돌릴 수 없으니 같은 자리에서 한 번 더 묻는다.
          <form
            action={removeAction}
            className="flex items-center justify-end gap-1.5 whitespace-nowrap"
          >
            <input type="hidden" name="settingId" value={setting.settingId} />
            <span className="text-muted-foreground text-xs">
              {setting.programCount}개 기수의 기준이 사라집니다.
            </span>
            <Button type="submit" variant="destructive" size="sm" disabled={removing}>
              {removing ? "삭제 중…" : "삭제"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removing}
              onClick={onCancel}
            >
              취소
            </Button>
          </form>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${label} 설정 ${setting ? "수정" : "등록"}`}
              onClick={onEdit}
            >
              설정 {setting ? "수정" : "등록"}
            </Button>
            {setting ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${label} 설정 삭제`}
                onClick={() =>
                  onAction({ action: "remove-setting", settingId: setting.settingId })
                }
              >
                설정 삭제
              </Button>
            ) : null}
          </div>
        )}

        {state.error ? (
          <p role="alert" className="text-destructive mt-1 text-right text-xs">
            {state.error}
          </p>
        ) : null}
      </td>
    </>
  );
}

/** 이름 칸을 그 자리에서 입력칸으로 바꾼다. 나머지 칸은 그대로 보인다. */
function NameForm({
  action,
  challengeId,
  name,
  pending,
  saved,
  onDone,
}: {
  action: (formData: FormData) => void;
  challengeId: string;
  name: string;
  pending: boolean;
  saved: boolean;
  onDone: () => void;
}) {
  useEffect(() => {
    if (saved) onDone();
  }, [saved, onDone]);

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="challengeId" value={challengeId} />
      <Input
        name="challengeName"
        aria-label="챌린지 이름"
        defaultValue={name}
        maxLength={MAX_CHALLENGE_NAME_LENGTH}
        required
        autoFocus
        className="w-44"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDone}>
        취소
      </Button>
    </form>
  );
}

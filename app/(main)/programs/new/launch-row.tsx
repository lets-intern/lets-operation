"use client";

import { useActionState, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  daysBetween,
  formatDateOnly,
  formatDday,
  type DateOnly,
} from "@/domain/date";
import type { ChallengeOption } from "@/domain/challenge";
import type { DetailOpenTask, ProgramLaunch } from "@/domain/program";
import {
  curriculumNoteText,
  isPresetCurriculum,
  PROGRAM_VERSION_LABELS,
} from "@/domain/program-setting";
import {
  detailOpenTargetOrigin,
  isCustomDetailOpenTarget,
  offDayLabel,
  programTitle,
} from "@/domain/program-launch";

import {
  deleteLaunch,
  updateLaunch,
  type DeleteState,
  type EditState,
} from "./actions";
import { LaunchFields, type LaunchFieldsValue } from "./launch-fields";
import { StatusSelect } from "./status-select";

const INITIAL_DELETE_STATE: DeleteState = { error: null };
const INITIAL_EDIT_STATE: EditState = { error: null, saved: false };

/** 표의 한 줄. 수정도 삭제도 이 줄 안에서 끝나 목록을 떠나지 않아도 된다. */
export function LaunchRow({
  launch,
  today,
  challenges,
}: {
  launch: ProgramLaunch;
  today: DateOnly;
  challenges: ChallengeOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteLaunch,
    INITIAL_DELETE_STATE,
  );

  const closeEdit = useCallback(() => setEditing(false), []);
  const title = programTitle(launch.challengeName, launch.cohort);

  if (editing) {
    return (
      <EditRow
        launch={launch}
        challenges={challenges}
        title={title}
        onClose={closeEdit}
      />
    );
  }

  const remaining = daysBetween(today, launch.detailOpenTargetDate);
  const offDay = offDayLabel(launch.detailOpenTargetDate);
  // 갈래가 둘이면 둘 다 열려야 끝난 것이다. 한쪽만 열고 완료로 보이면 나머지를 놓친다.
  const done =
    launch.detailOpenTasks.length > 0 &&
    launch.detailOpenTasks.every((task) => task.status === "DONE");
  const origin = detailOpenTargetOrigin(
    launch.startDate,
    launch.detailOpenTargetDate,
    launch.mktOpenDeadline,
  );

  return (
    <tr className="border-border border-b last:border-0">
      {/* 이름은 잘리거나 접히지 않는다. 가장 긴 이름에 칸을 맞춰 뒤 칸들이 같은 자리에서 시작한다. */}
      <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{title}</td>
      <td className="py-2.5 pr-3 text-xs whitespace-nowrap">
        <CurriculumCell launch={launch} />
      </td>
      <td className="text-muted-foreground py-2.5 pr-3 whitespace-nowrap">
        {formatDateOnly(launch.startDate)}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        {formatDateOnly(launch.detailOpenTargetDate)}
        {/* 마케팅 마감일은 우리 계산을 거치지 않아 근무일이 아닐 수 있다. 눈에 띄게 둔다. */}
        {offDay ? (
          <span className="text-destructive ml-1.5 text-xs font-medium">{offDay}</span>
        ) : null}
        {/* 대부분은 마케팅팀이 정한 날이라 그때는 표시하지 않는다. 사람이 고친 것만 알린다. */}
        {origin === "MANUAL" ? (
          <span className="text-muted-foreground ml-1.5 text-xs">직접 지정</span>
        ) : null}
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <Dday remaining={remaining} done={done} />
      </td>
      {/* 갈래 이름을 제 칸에 세운다. 이름 길이가 옆 칸을 밀지 않아 상태가 한 자리에 선다. */}
      <td className="text-muted-foreground py-2.5 pr-3 text-xs whitespace-nowrap">
        {launch.detailOpenTasks.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            {launch.detailOpenTasks.map((task) => (
              // 드롭다운과 같은 높이로 잡아 두 칸의 줄이 서로 마주 본다.
              <span key={task.id} className="flex h-7 items-center">
                {PROGRAM_VERSION_LABELS[task.version]}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="py-2.5 pr-3">
        {launch.detailOpenTasks.length === 0 ? (
          <span className="text-muted-foreground text-xs">태스크 없음</span>
        ) : (
          <div className="flex flex-col gap-1">
            {launch.detailOpenTasks.map((task) => (
              // 드롭다운과 근거를 한 줄에 세워 버전 칸의 갈래 이름과 높이를 맞춘다.
              <div key={task.id} className="flex h-7 items-center gap-1.5">
                <StatusSelect
                  taskId={task.id}
                  status={task.status}
                  label={`${title} ${PROGRAM_VERSION_LABELS[task.version]}`}
                />
                <OpenEvidence task={task} />
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="py-2.5 pl-8">
        {confirming ? (
          // 되돌릴 수 없으니 같은 자리에서 한 번 더 묻는다.
          <form
            action={deleteAction}
            className="flex items-center justify-end gap-1.5 whitespace-nowrap"
          >
            <input type="hidden" name="programId" value={launch.programId} />
            <span className="text-muted-foreground text-xs">
              태스크까지 삭제할까요?
            </span>
            <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
              {deleting ? "삭제 중…" : "삭제"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirming(false)}
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
              aria-label={`${title} 수정`}
              onClick={() => setEditing(true)}
            >
              수정
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${title} 삭제`}
              onClick={() => setConfirming(true)}
            >
              삭제
            </Button>
          </div>
        )}

        {deleteState.error ? (
          <p role="alert" className="text-destructive mt-1 text-right text-xs">
            {deleteState.error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

/** 수정 중에는 줄 전체를 폼으로 바꾼다. 표 칸에는 네 입력칸이 다 들어가지 않는다. */
function EditRow({
  launch,
  challenges,
  title,
  onClose,
}: {
  launch: ProgramLaunch;
  challenges: ChallengeOption[];
  title: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    updateLaunch,
    INITIAL_EDIT_STATE,
  );
  const [fields, setFields] = useState<LaunchFieldsValue>(() => ({
    challengeId: launch.challengeId,
    cohort: String(launch.cohort),
    curriculumDays: launch.curriculumDays === null ? "" : String(launch.curriculumDays),
    // 1주·2주가 아닌 일수는 드롭다운에 이름이 없어 직접 입력 칸에 세운다.
    curriculumCustom:
      launch.curriculumDays !== null && !isPresetCurriculum(launch.curriculumDays),
    startDate: launch.startDate,
    // 계산값 그대로면 비워 둔다. 시작일을 옮길 때 목표일도 따라 움직인다.
    targetOverride: isCustomDetailOpenTarget(
      launch.startDate,
      launch.detailOpenTargetDate,
    )
      ? launch.detailOpenTargetDate
      : null,
  }));

  useEffect(() => {
    if (state.saved) onClose();
  }, [state.saved, onClose]);

  return (
    <tr className="border-border bg-muted/40 border-b last:border-0">
      <td colSpan={8} className="p-4">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="programId" value={launch.programId} />

          <p className="text-sm font-medium">{title} 수정</p>

          <LaunchFields challenges={challenges} value={fields} onChange={setFields}>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              취소
            </Button>
          </LaunchFields>

          {state.error ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}
        </form>
      </td>
    </tr>
  );
}

/**
 * 이 기수가 여는 커리큘럼. 운영 캘린더가 이름 뒤에 붙이는 것과 같은 말이다(programCurriculumNote).
 *
 * 커리큘럼별 설정 챌린지의 미지정 기수는 캘린더에 미션이 그려지지 않고 회차 안내문도 걸리지
 * 않는다(plan.md §5). 가져온 기수는 모두 미지정으로 서므로 사람이 채우도록 붉게 둔다. 고른
 * 커리큘럼의 설정이 없는 경우도 같은 일이 벌어져 함께 드러낸다. 할 일이 없으면 이름만 적거나 비운다.
 */
function CurriculumCell({ launch }: { launch: ProgramLaunch }) {
  const text = curriculumNoteText(launch.curriculum);
  if (text === null) return null;

  return (
    <span className={launch.curriculum.issue ? "text-destructive font-medium" : undefined}>
      {text}
    </span>
  );
}

/**
 * 실서비스에서 상세페이지가 열렸는지 확인한 흔적.
 *
 * 우리가 올린 완료와 사람이 올린 완료를 구분한다. 아직 완료가 아닌데 실서비스에는 열려
 * 있는 태스크는 사람이 봐야 할 줄이므로 눈에 띄게 둔다 — 판정이 맞는지 지켜보는 동안에는
 * 상태를 건드리지 않고 이 표시만 뜬다.
 */
function OpenEvidence({ task }: { task: DetailOpenTask }) {
  if (task.autoDone) {
    return (
      <span
        className="text-muted-foreground text-xs whitespace-nowrap"
        title={task.seenAt ? `${formatSeenAt(task.seenAt)} 확인` : undefined}
      >
        자동
      </span>
    );
  }

  if (task.seenAt !== null && task.status !== "DONE") {
    return (
      <span
        className="text-xs font-medium whitespace-nowrap"
        title={`${formatSeenAt(task.seenAt)} 확인`}
      >
        열려 있음
      </span>
    );
  }

  return null;
}

/** 확인 시각. 서버 시간대와 무관하게 한국 기준으로 적는다. */
function formatSeenAt(seenAt: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(seenAt);
}

/** 완료된 건은 남은 일수를 강조하지 않는다. 지연과 임박만 눈에 띄게 한다. */
function Dday({ remaining, done }: { remaining: number; done: boolean }) {
  if (done) {
    return <span className="text-muted-foreground">완료</span>;
  }

  const tone =
    remaining < 0
      ? "text-destructive font-medium"
      : remaining <= 3
        ? "text-foreground font-medium"
        : "text-muted-foreground";

  return (
    <span className={tone}>
      {formatDday(remaining)}
      {remaining < 0 ? " 지연" : null}
    </span>
  );
}

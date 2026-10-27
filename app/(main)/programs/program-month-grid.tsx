"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { WEEKDAY_LABELS, type CalendarMonth } from "@/domain/calendar-month";
import { formatDateOnly, type DateOnly } from "@/domain/date";
import {
  buildProgramMonth,
  MAX_LANES,
  PROGRAM_MARK_LABELS,
  PROGRAM_PHASE_LABELS,
  programTitle,
  type ProgramBarSegment,
  type ProgramDay,
  type ProgramFeedbackSegment,
  type ProgramHidden,
  type ProgramLaunchSegment,
  type ProgramMark,
  type ProgramMissionSegment,
  type ProgramPeriod,
  type ProgramSegment,
  type ProgramWeek,
} from "@/domain/program-calendar";
import {
  FEEDBACK_KIND_LABELS,
  PROGRAM_VERSION_LABELS,
  type ProgramVersion,
} from "@/domain/program-setting";

import {
  BAR_CORNER,
  CHIP_RADIUS,
  FEEDBACK_CHIP,
  LAUNCH_CHIP,
  MISSION_CHIP,
  PHASE_BAR,
  type ChipSurface,
} from "./calendar-marks";

/**
 * 프로그램 운영 캘린더의 격자. 업무 캘린더와 같은 달력 위에 **기간을 눕힌다**.
 *
 * 칸 안에 칩을 쌓지 않고 칸을 가로질러 막대를 그리는 이유는 프로그램이 시작한 날 하루의
 * 일이 아니기 때문이다. 어느 주에 몇 개가 겹쳐 도는지가 막대의 층으로 그대로 보인다.
 *
 * 개설은 하루라 막대가 아니라 한 칸짜리 칩이지만, 그 기수의 막대와 같은 줄에 놓인다.
 */

/**
 * 칸 높이를 이루는 값들(rem). 막대 층이 칸 위에 떠 있어 칸이 스스로 늘어나지 못하므로,
 * 실제로 쓰이는 줄 수에서 높이를 거꾸로 계산한다.
 *
 * 줄 간격은 좁게 둔다. 같은 날 개설이 대여섯씩 몰리면 칩이 세로로 쌓이는데, 줄을 띄우면
 * 그 묶음이 흩어져 하나씩 따로 떨어진 일처럼 읽힌다. 칸의 여유는 줄을 벌려서가 아니라
 * 위아래 여백으로 낸다 — 그래야 쌓인 것은 묶여 보이고 칸은 답답하지 않다.
 */
const LANE_HEIGHT = 1.125;
const LANE_GAP = 0.125;

/** 날짜가 차지하는 윗부분. 막대 층은 그 아래에서 시작한다. */
const LANE_TOP = 2.25;

/** 마지막 줄 아래에 남기는 자리. 없으면 막대가 칸 아래 선에 붙는다. */
const LANE_BOTTOM = 0.75;

/** 막대가 없는 달도 달력으로 보이게 하는 바닥값. */
const MIN_WEEK_HEIGHT = 6;

/** 막대가 품는 칩의 높이(rem). 줄 높이보다 낮아야 감싼 테두리가 위아래로 보인다. */
const INNER_CHIP_HEIGHT = 0.875;

/**
 * 이 달이 실제로 쓰는 줄 수. 한도인 여섯 줄을 늘 비워두면 두세 개만 도는 달에서
 * 칸이 통째로 빈 채 세로로 길어진다.
 *
 * 달 전체에서 한 번 정한다 — 주마다 다르면 칸 높이가 들쭉날쭉해져 달력이 아니라
 * 목록처럼 읽힌다.
 */
function laneCountOf(weeks: ProgramWeek[]): number {
  return Math.max(
    ...weeks.map((week) =>
      week.segments.reduce(
        (max, segment) => Math.max(max, segment.lane + 1),
        0,
      ),
    ),
  );
}

/** 접힌 막대를 알리는 줄까지 더한 칸 높이. 막대 층이 떠 있어 칸이 스스로 못 늘어난다. */
function weekHeightOf(lanes: number, folded: boolean): string {
  const rows = lanes + (folded ? 1 : 0);
  const height =
    LANE_TOP +
    rows * LANE_HEIGHT +
    Math.max(0, rows - 1) * LANE_GAP +
    LANE_BOTTOM;

  return `${Math.max(MIN_WEEK_HEIGHT, height)}rem`;
}

export function ProgramMonthGrid({
  month,
  periods,
  today,
  folded,
}: {
  month: CalendarMonth;
  periods: ProgramPeriod[];
  today: DateOnly;
  /** 범례에서 접어둔 갈래. 줄 배치 전에 걸러야 접은 자리가 빈 줄로 남지 않는다. */
  folded: ProgramMark[];
}) {
  /**
   * 줄 한도를 풀어둔 달인지. 몰리는 달은 한도에 걸려 아래쪽 기수가 통째로 사라지는데,
   * 그 기수를 보려면 달력이 세로로 길어지는 것을 감수하는 수밖에 없다. 늘 길게 두지 않고
   * 사람이 필요한 달에만 편다.
   *
   * 달을 넘기면 다시 접힌다. 9월이 붐벼 펼친 것이 한산한 10월까지 따라가면, 접을 것이
   * 없는 달이 이유 없이 길어진다(부모가 달마다 `key` 로 이 상태를 새로 세운다).
   */
  const [unfolded, setUnfolded] = useState(false);

  const weeks = buildProgramMonth(
    month,
    periods,
    today,
    folded,
    unfolded ? Infinity : MAX_LANES,
  );
  const lanes = laneCountOf(weeks);
  const weekHeight = weekHeightOf(
    lanes,
    weeks.some((week) => week.hidden.length > 0),
  );

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="border-border grid grid-cols-7 border-b">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              "py-1.5 text-center text-xs font-medium",
              index === 0 || index === 6
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week) => (
        <WeekRow
          key={week.days[0].date}
          week={week}
          lanes={lanes}
          height={weekHeight}
          onUnfold={() => setUnfolded(true)}
        />
      ))}

      {/*
       * 다시 접는 자리. 펼친 뒤에는 주마다 있던 `+N건` 줄이 사라져 되돌릴 곳이 없어지므로,
       * 달력 아래에 한 자리를 둔다.
       */}
      {unfolded ? (
        <button
          type="button"
          onClick={() => setUnfolded(false)}
          className="border-border text-muted-foreground hover:text-foreground w-full border-t py-2 text-xs"
        >
          다시 접기
        </button>
      ) : null}
    </div>
  );
}

/**
 * 한 주. 날짜 칸이 아래에 깔리고 막대 층이 그 위를 지나간다. 막대를 칸 안에 넣으면
 * 주를 넘길 때마다 잘려 한 프로그램이 여러 조각으로 읽힌다.
 */
function WeekRow({
  week,
  lanes,
  height,
  onUnfold,
}: {
  week: ProgramWeek;
  lanes: number;
  height: string;
  onUnfold: () => void;
}) {
  return (
    <div className="border-border relative border-b last:border-b-0">
      <div className="grid grid-cols-7">
        {week.days.map((day) => (
          <div
            key={day.date}
            style={{ minHeight: height }}
            className={cn(
              "border-border border-r px-1.5 pt-1 last:border-r-0",
              day.inMonth ? "" : "bg-muted/20",
            )}
          >
            <DayNumber day={day} />
          </div>
        ))}
      </div>

      <div
        // 막대 층은 칸 위에 떠 있다. 클릭·마우스오버는 막대 자신만 받는다.
        className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
        style={{
          top: `${LANE_TOP}rem`,
          gridAutoRows: `${LANE_HEIGHT}rem`,
          rowGap: `${LANE_GAP}rem`,
        }}
      >
        {week.segments.map((segment) => (
          <Segment key={segment.key} segment={segment} />
        ))}

        {/* 접힌 막대도 같은 격자의 한 줄로 둔다. 바닥에 붙여두면 막대와 겹치는 주가 생긴다. */}
        {week.hidden.length > 0 ? (
          <button
            type="button"
            onClick={onUnfold}
            // 마우스만 올려도 무엇이 접혔는지 읽힌다. 펼치는 것은 그 다음 일이다.
            title={week.hidden.map(describeHidden).join("\n")}
            style={{ gridColumn: "1 / -1", gridRow: lanes + 1 }}
            className="text-muted-foreground hover:text-foreground pointer-events-auto flex items-center gap-1 px-1.5 text-xs leading-none"
          >
            <span className="underline underline-offset-2">
              + {week.hidden.length}기수 더 보기
            </span>
            <span className="truncate">{summarize(week.hidden)}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 오늘만 채운 원으로 표시한다. 주말·공휴일은 날짜를 흐리게 해 근무일과 갈린다. */
function DayNumber({ day }: { day: ProgramDay }) {
  const label = Number(day.date.slice(8));

  if (day.isToday) {
    return (
      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-medium">
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "px-1 text-xs",
        day.isWeekend || day.isHoliday
          ? "text-muted-foreground"
          : "text-foreground",
      )}
    >
      {label}
    </span>
  );
}

/** 조각 하나. 무엇이냐로 생김새가 갈린다. 놓이는 자리는 모두 같은 규칙을 쓴다. */
function Segment({ segment }: { segment: ProgramSegment }) {
  switch (segment.kind) {
    case "LAUNCH":
      return <LaunchChip segment={segment} />;
    case "MISSION":
      return <MissionChip segment={segment} />;
    case "FEEDBACK":
      return <FeedbackChip segment={segment} />;
    default:
      return <Bar segment={segment} />;
  }
}

/** 격자에서 차지하는 칸과 줄. 막대와 칩이 같은 층 위에 나란히 놓인다. */
function placementOf(segment: ProgramSegment) {
  return {
    gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
    gridRow: segment.lane + 1,
  };
}

/**
 * 막대 한 토막. 미션이 있는 기수는 그 줄까지 아래로 늘어나 **자기 미션을 품는 그릇**이 되고,
 * 미션이 없는 기수는 예전 그대로 한 줄짜리 알약이다. 품은 그릇 안에 든 칩이 곧 그 기수의
 * 것이라, 줄이 멀어져 누구의 미션인지 헷갈리던 자리가 없어진다.
 *
 * 끝이 닫힌 쪽만 둥글게 해, 잘린 끝은 다음 주로 이어진다는 뜻이 된다. 둥글기는 품는 칩보다
 * 한 단계 클 뿐이라(BAR_CORNER), 키가 커져도 곡선이 첫 미션 칩을 파고들지 않는다.
 *
 * 종료일을 모르는 기수는 오른쪽 끝을 흐리게 지운다. 각지게만 두면 "격자 밖으로 이어짐"과
 * 구별되지 않는데, 그 둘은 다른 이야기다 — 하나는 화면 밖이고 하나는 우리가 모르는 것이다.
 */
function Bar({ segment }: { segment: ProgramBarSegment }) {
  const { period, phase, rowSpan } = segment;
  const fadeOut = segment.openEnded && segment.lastInGrid;

  return (
    <div
      style={{
        ...placementOf(segment),
        gridRow: `${segment.lane + 1} / span ${rowSpan}`,
      }}
      className="min-w-0 px-0.5"
    >
      <p
        title={describeBar(segment)}
        style={
          fadeOut
            ? {
                maskImage:
                  "linear-gradient(to right, black 65%, transparent 100%)",
              }
            : undefined
        }
        className={cn(
          "pointer-events-auto flex h-full items-start px-1.5 text-xs leading-none",
          PHASE_BAR[phase],
          segment.continuesBefore ? "rounded-l-none pl-1" : BAR_CORNER.left,
          segment.continuesAfter ? "rounded-r-none pr-1" : BAR_CORNER.right,
        )}
      >
        {/* 이름은 첫 줄에만. 그 아래는 미션 칩이 들어올 자리다. */}
        <span
          style={{ height: `${LANE_HEIGHT}rem` }}
          className="flex items-center truncate"
        >
          {programTitle(period)}
        </span>
      </p>
    </div>
  );
}

/**
 * 오픈 목표일 하루에 찍는 개설 칩. 한 칸이라 이름은 거의 잘리므로, 앞의 마름모가 "이건
 * 기간이 아니라 그날 해야 하는 일"이라고 먼저 말한다. 나머지는 마우스를 올렸을 때 나온다.
 */
function LaunchChip({ segment }: { segment: ProgramLaunchSegment }) {
  return (
    <div style={placementOf(segment)} className="min-w-0 px-0.5">
      <p
        title={describeLaunch(segment)}
        className={cn(
          "pointer-events-auto flex h-full items-center gap-1 px-1 text-[0.7rem] leading-none",
          CHIP_RADIUS,
          // 이미 연 개설은 목표일이 남았어도 물러난다. 강조는 아직 열어야 할 것의 몫이다.
          LAUNCH_CHIP[
            segment.period.launched || segment.passed ? "passed" : "ahead"
          ],
        )}
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rotate-45 border border-current"
        />
        <span className="truncate">{programTitle(segment.period)}</span>
      </p>
    </div>
  );
}

/**
 * 미션 하나가 도는 동안. 자기 기수의 막대 바로 아래 줄에 놓이므로 칩에는 몇 번째 미션인지만
 * 적는다 — 한 칸짜리 미션이 흔해 이름까지 넣으면 번호부터 잘린다.
 */
function MissionChip({ segment }: { segment: ProgramMissionSegment }) {
  return (
    <Inner
      segment={segment}
      title={describeMission(segment)}
      chip={MISSION_CHIP[surfaceOf(segment)]}
    >
      {missionLabel(segment)}
    </Inner>
  );
}

/**
 * 미션 뒤에 붙는 피드백. 여기에는 기수 이름을 적는다 — 마지막 미션의 피드백은 운영 막대가
 * 끝난 뒤까지 이어져, 위에 아무 막대도 없는 자리에 혼자 놓이기 때문이다.
 */
function FeedbackChip({ segment }: { segment: ProgramFeedbackSegment }) {
  return (
    <Inner
      segment={segment}
      title={describeFeedback(segment)}
      chip={FEEDBACK_CHIP[surfaceOf(segment)]}
    >
      {feedbackLabel(segment)}
    </Inner>
  );
}

/**
 * 이 칩이 무엇 위에 앉는지. 꽉 찬 막대(운영 중) 안에 온전히 들었을 때만 막대의 결을 따른다.
 *
 * 막대 밖으로 나간 칩까지 그렇게 칠하면 지워진다. 마지막 미션의 피드백이 늘 그렇다 —
 * 운영이 끝난 뒤까지 이어져 아무 막대도 없는 자리에 혼자 놓인다. 범례에서 운영 중을
 * 접어 막대만 사라진 경우도 같다.
 */
function surfaceOf(
  segment: ProgramMissionSegment | ProgramFeedbackSegment,
): ChipSurface {
  return segment.phase === "RUNNING" && segment.insideBar
    ? "FILLED_BAR"
    : "PAGE";
}

/**
 * 막대가 품는 칩. 줄 높이를 다 쓰지 않고 조금 작게, 좌우도 한 뼘 더 들여 놓는다 —
 * 그래야 감싸는 막대의 테두리가 칩 둘레로 보여 "안에 들어 있다"가 된다.
 */
function Inner({
  segment,
  title,
  chip,
  children,
}: {
  segment: ProgramSegment;
  title: string;
  chip: string;
  children: string;
}) {
  return (
    <div
      style={placementOf(segment)}
      className="flex min-w-0 items-center px-1"
    >
      <p
        title={title}
        style={{ height: `${INNER_CHIP_HEIGHT}rem` }}
        className={cn(
          "pointer-events-auto flex w-full min-w-0 items-center px-1 text-[0.7rem] leading-none",
          CHIP_RADIUS,
          chip,
        )}
      >
        <span className="truncate">{children}</span>
      </p>
    </div>
  );
}

/** "3회차". 갈래마다 미션이 다른 기수에서만 어느 갈래인지 앞에 붙는다. */
function missionLabel(segment: ProgramMissionSegment): string {
  return `${versionPrefix(segment.versions)}${segment.seq}회차`;
}

/** "포트폴리오 챌린지 41기 서면 피드백" */
function feedbackLabel(segment: ProgramFeedbackSegment): string {
  return `${programTitle(segment.period)} ${FEEDBACK_KIND_LABELS[segment.feedback.kind]} 피드백`;
}

function versionPrefix(versions: ProgramVersion[]): string {
  return versions.length === 0
    ? ""
    : `${versions.map((version) => PROGRAM_VERSION_LABELS[version]).join("·")} `;
}

/** 칸이 좁아 이름만 보인다. 기간과 상태는 마우스를 올렸을 때 나온다. */
function describeBar(segment: ProgramBarSegment): string {
  const { period, phase } = segment;
  const end = period.endDate ? formatDateOnly(period.endDate) : "종료일 미정";

  return [
    programTitle(period),
    `${formatDateOnly(period.startDate)} ~ ${end}`,
    PROGRAM_PHASE_LABELS[phase],
    ...source(period.fromService),
  ].join(" · ");
}

/**
 * 개설 칩이 가리키는 것은 상세페이지를 여는 목표일 하나다. 지난 것은 그렇다고 말해준다.
 * 되짚어 온 기수는 목표가 아니라 이미 열린 날이라 말을 바꾼다 — 지나간 목표일처럼 읽히면
 * 못 지킨 일로 보인다.
 */
function describeLaunch(segment: ProgramLaunchSegment): string {
  const { period } = segment;
  const date = formatDateOnly(period.detailOpenTargetDate);

  if (period.fromService) {
    return [
      programTitle(period),
      `상세페이지 오픈 ${date}`,
      ...source(true),
    ].join(" · ");
  }

  return [
    programTitle(period),
    `상세페이지 오픈 목표 ${date}`,
    // 열린 것이 확인된 기수에 `목표일 지남` 이라 적으면 못 지킨 일로 읽힌다. 지킨 일이다.
    period.launched ? "개설 완료" : segment.passed ? "목표일 지남" : "개설 예정",
  ].join(" · ");
}

/**
 * 접힌 줄에 함께 적는 이름들. 숫자만 있으면 무엇이 빠졌는지 알 수 없어 등록이 안 된 것으로
 * 읽힌다 — 그 오해가 이 줄을 만든 이유다. 칸이 좁아 뒤는 잘리지만, 잘린 이름은 마우스를
 * 올렸을 때 전부 나온다.
 */
function summarize(hidden: ProgramHidden[]): string {
  return hidden.map((program) => programTitle(program.period)).join(" · ");
}

/** "기필코 경험정리 챌린지 32기 · 개설". 무엇이 접혔는지까지 말해야 펼칠지가 정해진다. */
function describeHidden(hidden: ProgramHidden): string {
  return [
    programTitle(hidden.period),
    hidden.marks.map((mark) => PROGRAM_MARK_LABELS[mark]).join("·"),
  ].join(" · ");
}

/** 되짚어 온 기수만 출처를 밝힌다. 개설로 세운 기수는 우리 것이라 말할 것이 없다. */
function source(fromService: boolean): string[] {
  return fromService ? ["실서비스 기록"] : [];
}

/** 잘린 토막에 올려도 그 미션의 원래 기간을 말한다. 하루짜리는 하루로 적는다. */
function describeMission(segment: ProgramMissionSegment): string {
  return [
    programTitle(segment.period),
    missionLabel(segment),
    span(segment.from, segment.to),
  ].join(" · ");
}

function describeFeedback(segment: ProgramFeedbackSegment): string {
  const kind = FEEDBACK_KIND_LABELS[segment.feedback.kind];

  return [
    programTitle(segment.period),
    `${versionPrefix(segment.versions)}${segment.seq}회차 ${kind} 피드백`,
    span(segment.from, segment.to),
  ].join(" · ");
}

function span(from: DateOnly, to: DateOnly): string {
  return from === to
    ? formatDateOnly(from)
    : `${formatDateOnly(from)} ~ ${formatDateOnly(to)}`;
}

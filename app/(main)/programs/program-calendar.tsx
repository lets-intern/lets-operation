"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatMonth,
  isSameMonth,
  monthOf,
  shiftMonth,
  type CalendarMonth,
} from "@/domain/calendar-month";
import type { DateOnly } from "@/domain/date";
import {
  countMarksInMonth,
  PROGRAM_MARK_LABELS,
  PROGRAM_MARKS,
  type ProgramMark,
  type ProgramPeriod,
} from "@/domain/program-calendar";

import { MARK_SWATCH } from "./calendar-marks";
import { ProgramMonthGrid } from "./program-month-grid";

/**
 * 프로그램 운영 캘린더. 개설에서 세운 기수를 **운영 종료 · 운영 중 · 개설 예정** 셋으로
 * 나누어 한 달 위에 눕히고, 그 앞의 **개설**(상세페이지 오픈 목표일)을 같은 줄에 찍는다.
 *
 * 보고 있는 달과 접어둔 갈래만 여기서 들고 있다. 무엇이 어느 상태이고 어떻게 눕는지는
 * domain/program-calendar 가 정한다.
 */
export function ProgramCalendar({
  periods,
  today,
}: {
  periods: ProgramPeriod[];
  today: DateOnly;
}) {
  const [month, setMonth] = useState<CalendarMonth>(() => monthOf(today));
  const [folded, setFolded] = useState<ProgramMark[]>([]);

  const thisMonth = monthOf(today);

  const counts = countMarksInMonth(month, periods, today);

  function toggle(mark: ProgramMark) {
    setFolded((current) =>
      current.includes(mark)
        ? current.filter((value) => value !== mark)
        : [...current, mark],
    );
  }

  return (
    <section className="border-border flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">운영 캘린더</h2>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="이전 달"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-24 text-center text-sm font-medium tabular-nums">
              {formatMonth(month)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="다음 달"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
            {isSameMonth(month, thisMonth) ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMonth(thisMonth)}
              >
                이번 달
              </Button>
            )}
          </div>
        </div>

        <Legend counts={counts} folded={folded} onToggle={toggle} />
      </div>

      {periods.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center text-sm">
          아직 개설된 프로그램이 없습니다. 프로그램 개설에서 기수를 세우면
          여기에 눕습니다.
        </p>
      ) : (
        <ProgramMonthGrid
          // 달을 넘기면 펼쳐둔 상태를 새로 세운다. 붐비는 달에서 편 것이 한산한 달까지
          // 따라가면 접을 것 없는 달이 이유 없이 길어진다.
          key={formatMonth(month)}
          month={month}
          periods={periods}
          today={today}
          folded={folded}
        />
      )}
    </section>
  );
}

/**
 * 범례가 곧 필터다. 네 갈래를 설명해 두고 누르면 접히게 하면, 무엇이 무엇인지 읽는 자리와
 * 잠깐 치우는 자리가 하나가 된다. 숫자는 접어도 그대로 둔다 — 접힌 것이 없어진 것은 아니다.
 *
 * 개설이 여기 함께 있는 이유는 운영 막대와 같은 층을 쓰기 때문이다. 도는 것만 보고 싶은
 * 달에는 개설을 접어 줄을 비우고, 이번 달에 뭘 열어야 하는지만 볼 때는 상태 셋을 접는다.
 */
function Legend({
  counts,
  folded,
  onToggle,
}: {
  counts: Record<ProgramMark, number>;
  folded: ProgramMark[];
  onToggle: (mark: ProgramMark) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PROGRAM_MARKS.map((mark) => {
        const off = folded.includes(mark);

        return (
          <Button
            key={mark}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={!off}
            title={off ? "다시 보기" : "이 달 화면에서 잠깐 접기"}
            className={cn("gap-1.5", off ? "opacity-45" : "")}
            onClick={() => onToggle(mark)}
          >
            <span aria-hidden className={cn("shrink-0", MARK_SWATCH[mark])} />
            <span>{PROGRAM_MARK_LABELS[mark]}</span>
            <span className="text-muted-foreground tabular-nums">
              {counts[mark]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

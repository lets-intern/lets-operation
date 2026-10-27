"use client";

import { useEffect, useRef, type MouseEvent } from "react";

import {
  formatKstTime,
  kstParts,
  MINUTES_PER_DAY,
  placeAllDayEvents,
  placeTimedEvents,
  readableTextColor,
  WEEK_DAY_LABELS,
  weekDates,
  type WeekEvent,
} from "@/domain/calendar-week";
import { daysBetween, type DateOnly } from "@/domain/date";

import { useNow } from "./use-now";

/** 한 시간의 높이(px). 30분 일정에 제목 한 줄과 시각이 들어가는 만큼이다. */
const HOUR_HEIGHT = 48;
const LANE_HEIGHT = 22;
/** 짧은 일정도 눌러서 열 수 있는 최소 높이. */
const MIN_EVENT_HEIGHT = 18;
/** 빈 칸을 누르면 이 단위로 내려 맞춘다. */
const SLOT_MINUTES = 30;
/** 처음 열었을 때 보이는 시각. 새벽이 화면을 다 차지하지 않게 한다. */
const INITIAL_SCROLL_HOUR = 8;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * 월~일 주간 뷰. 맨 위에 종일 줄, 그 아래 시간 격자. 구글 캘린더의 주간 화면과 같은 읽는 법을
 * 따른다 — 사람이 이미 익숙한 배치라 따로 익힐 것이 없다.
 *
 * 빈 칸을 누르면 그 시각으로 채운 새 일정 폼이, 일정을 누르면 그 일정의 폼이 열린다.
 */
export function WeekView({
  weekStart,
  events,
  onSelectEvent,
  onSelectSlot,
}: {
  weekStart: DateOnly;
  events: WeekEvent[];
  onSelectEvent: (event: WeekEvent) => void;
  onSelectSlot: (date: DateOnly, minuteOfDay: number | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow(60 * 1000);

  const dates = weekDates(weekStart);
  const { placements: allDay, laneCount } = placeAllDayEvents(events, weekStart);
  const timed = placeTimedEvents(events, weekStart);

  const nowParts = now === null ? null : kstParts(new Date(now));
  const todayColumn = nowParts ? daysBetween(weekStart, nowParts.date) : -1;

  // 처음 한 번만 아침으로 내려 둔다. 그 뒤 스크롤은 사람이 정한 대로 둔다.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = INITIAL_SCROLL_HOUR * HOUR_HEIGHT;
  }, []);

  function selectSlot(date: DateOnly, event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
    onSelectSlot(date, Math.min(Math.max(snapped, 0), MINUTES_PER_DAY - SLOT_MINUTES));
  }

  const columns = "grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
  // 시간 격자만 세로로 스크롤되어 스크롤바가 그 줄의 폭을 먹는다. 날짜 · 종일 줄도 같은 자리를
  // 비워 두어야 세 줄의 세로선이 한 줄로 맞는다. 겹쳐 뜨는 스크롤바(macOS 기본)면 셋 다 0 이다.
  const gutter = "overflow-y-hidden [scrollbar-gutter:stable]";

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <div className="min-w-[48rem]">
        <div className={`${columns} ${gutter} border-border border-b`}>
          <div />
          {dates.map((date, index) => {
            const isToday = index === todayColumn;
            return (
              <div
                key={date}
                className="border-border flex items-baseline justify-center gap-1 border-l py-2 text-xs"
              >
                <span className="text-muted-foreground">{WEEK_DAY_LABELS[index]}</span>
                <span
                  className={
                    isToday
                      ? "bg-primary text-primary-foreground rounded-full px-1.5 font-medium"
                      : "font-medium"
                  }
                >
                  {Number(date.slice(8))}
                </span>
              </div>
            );
          })}
        </div>

        <div className={`${columns} ${gutter} border-border border-b`}>
          <div className="text-muted-foreground px-2 py-1 text-right text-[11px]">종일</div>
          <div
            className="relative col-span-7"
            style={{ height: Math.max(laneCount, 1) * LANE_HEIGHT + 6 }}
          >
            <div className="absolute inset-0 grid grid-cols-7">
              {dates.map((date) => (
                <button
                  key={date}
                  type="button"
                  aria-label={`${date} 종일 일정 추가`}
                  className="border-border hover:bg-muted/40 border-l"
                  onClick={() => onSelectSlot(date, null)}
                />
              ))}
            </div>
            {allDay.map((placement) => (
              <button
                key={placement.event.key}
                type="button"
                onClick={() => onSelectEvent(placement.event)}
                className="absolute truncate rounded px-1.5 text-left text-xs leading-5"
                style={{
                  top: placement.lane * LANE_HEIGHT + 3,
                  left: `calc(${(placement.startColumn / 7) * 100}% + 2px)`,
                  width: `calc(${(placement.span / 7) * 100}% - 4px)`,
                  height: LANE_HEIGHT - 2,
                  backgroundColor: placement.event.color,
                  color: readableTextColor(placement.event.color),
                  borderTopLeftRadius: placement.continuesBefore ? 0 : undefined,
                  borderBottomLeftRadius: placement.continuesBefore ? 0 : undefined,
                  borderTopRightRadius: placement.continuesAfter ? 0 : undefined,
                  borderBottomRightRadius: placement.continuesAfter ? 0 : undefined,
                }}
              >
                {placement.event.title || "(제목 없음)"}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="max-h-[36rem] overflow-y-auto [scrollbar-gutter:stable]">
          <div className={columns} style={{ height: 24 * HOUR_HEIGHT }}>
            <div className="relative">
              {HOURS.slice(1).map((hour) => (
                <span
                  key={hour}
                  className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px]"
                  style={{ top: hour * HOUR_HEIGHT }}
                >
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            {dates.map((date, index) => (
              <div
                key={date}
                className="border-border relative cursor-pointer border-l"
                onClick={(event) => selectSlot(date, event)}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-border/60 pointer-events-none border-b"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {timed[index].map((placement) => {
                  const height = Math.max(
                    ((placement.endMinute - placement.startMinute) / 60) * HOUR_HEIGHT,
                    MIN_EVENT_HEIGHT,
                  );
                  return (
                    <button
                      key={`${placement.event.key} ${index}`}
                      type="button"
                      onClick={(event) => {
                        // 아래 칸의 "새 일정" 이 함께 열리지 않게 한다.
                        event.stopPropagation();
                        onSelectEvent(placement.event);
                      }}
                      className="ring-background absolute overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight ring-1"
                      style={{
                        top: (placement.startMinute / 60) * HOUR_HEIGHT,
                        height,
                        left: `calc(${(placement.column / placement.columns) * 100}% + 1px)`,
                        width: `calc(${100 / placement.columns}% - 3px)`,
                        backgroundColor: placement.event.color,
                        color: readableTextColor(placement.event.color),
                      }}
                    >
                      <span className="block truncate font-medium">
                        {placement.event.title || "(제목 없음)"}
                      </span>
                      {height >= 30 ? (
                        <span className="block truncate opacity-80">
                          {formatKstTime(new Date(placement.event.start))} –{" "}
                          {formatKstTime(new Date(placement.event.end))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}

                {index === todayColumn && nowParts ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                    style={{ top: (nowParts.minuteOfDay / 60) * HOUR_HEIGHT }}
                  >
                    <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-red-500" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

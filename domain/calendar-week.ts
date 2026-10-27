import {
  addDays,
  atKoreanTime,
  daysBetween,
  isDateOnly,
  todayInKorea,
  toDateOnly,
  weekdayOf,
  type DateOnly,
} from "./date";

/**
 * 업무 수행 화면의 주간 뷰와 일정 폼이 기대는 규칙(plan.md §5 — 업무 수행).
 *
 * 화면과 DB 를 모르는 계산만 둔다. 주를 어디서 끊는지, 자정을 넘는 일정을 어떻게 나누는지,
 * 겹치는 일정을 몇 칸으로 쪼개는지는 틀려도 화면에서 바로 티가 나지 않는 것들이라 따로 떼어
 * node 로 경계 사례를 돌려 볼 수 있게 한다.
 *
 * **모든 날짜 · 시각은 한국 기준이다.** 서버(Vercel)는 UTC 에서 돌고 브라우저는 어디서 열릴지
 * 모른다. 구글에도 Asia/Seoul 로 묻고 Asia/Seoul 로 적는다.
 */

const MINUTE_MS = 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;
export const MINUTES_PER_DAY = 24 * 60;

/** 월요일부터. 업무 주간은 월요일에 시작한다(구글 캘린더 기본값과 다르다). */
export const WEEK_DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

export const MAX_EVENT_TITLE_LENGTH = 200;
export const MAX_EVENT_LOCATION_LENGTH = 500;
/** 구글은 8,192자까지 받는다. 넘기면 구글이 400 으로 거절하므로 미리 막는다. */
export const MAX_EVENT_DESCRIPTION_LENGTH = 8000;

/** 그 날이 속한 주의 월요일. */
export function weekStartOf(value: DateOnly): DateOnly {
  // weekdayOf 는 일요일이 0 이다. 일요일은 그 주의 마지막 날이라 6일 앞이 월요일이다.
  return addDays(value, -((weekdayOf(value) + 6) % 7));
}

/**
 * 주소의 `?week=` 값. 아무 날짜나 받아 그 주의 월요일로 맞춘다 — 링크를 손으로 고쳐 적어도
 * 엉뚱한 요일에서 시작하는 주가 서지 않는다. 없거나 틀린 값이면 이번 주다.
 */
export function parseWeekParam(raw: string | undefined, now: Date = new Date()): DateOnly {
  const value = (raw ?? "").trim();
  return weekStartOf(isDateOnly(value) ? value : todayInKorea(now));
}

export function weekDates(weekStart: DateOnly): DateOnly[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

/** 구글에 물을 구간. 월요일 0시(한국)부터 다음 월요일 0시까지, 끝은 포함하지 않는다. */
export function weekRange(weekStart: DateOnly): { timeMin: Date; timeMax: Date } {
  return {
    timeMin: atKoreanTime(weekStart, 0),
    timeMax: atKoreanTime(addDays(weekStart, 7), 0),
  };
}

/** "2026. 10. 12. – 10. 18." */
export function formatWeekLabel(weekStart: DateOnly): string {
  const end = addDays(weekStart, 6);
  const [year, month, day] = weekStart.split("-");
  const [endYear, endMonth, endDay] = end.split("-");
  const tail = endYear === year ? `${endMonth}. ${endDay}.` : `${endYear}. ${endMonth}. ${endDay}.`;
  return `${year}. ${month}. ${day}. – ${tail}`;
}

/** 한 순간이 한국 기준 몇 월 며칠 몇 분인지. 자정이 0, 오후 11시 59분이 1439 다. */
export function kstParts(instant: Date): { date: DateOnly; minuteOfDay: number } {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    date: toDateOnly(shifted),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 600 → "10:00". 입력 칸(type=time)과 화면 표시가 같은 꼴을 쓴다. */
export function formatMinute(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "10:00" → 600. 꼴이 틀리거나 24시를 넘으면 null. */
export function parseMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 한 순간을 한국 시각 "10:00" 으로. */
export function formatKstTime(instant: Date): string {
  return formatMinute(kstParts(instant).minuteOfDay);
}

/**
 * 화면에 서는 일정 한 건. 구글 응답에서 화면이 쓰는 것만 추린다(domain/google-calendar).
 *
 * 종일 일정의 `start` · `end` 는 `YYYY-MM-DD` 이고 **끝은 포함하지 않는다** — 구글의 규칙
 * 그대로다. 10월 18일 하루짜리는 18일 ~ 19일로 온다. 시각 일정은 ISO 시각 문자열이다.
 */
export type WeekEvent = {
  /** `캘린더id 일정id`. 여러 캘린더의 일정을 한 화면에 섞으므로 일정 id 만으로는 겹칠 수 있다. */
  key: string;
  eventId: string;
  calendarId: string;
  calendarName: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  end: string;
  color: string;
  /** 캘린더가 owner · writer 권한일 때만. 아니면 화면이 읽기 전용으로 연다. */
  writable: boolean;
  /** 반복 일정의 한 회차. 고치면 그 회차만 바뀐다. */
  recurring: boolean;
  htmlLink: string;
};

/** 주간 맨 위 종일 줄에 놓인 일정. 열은 0(월)~6(일), 줄은 위에서부터 0. */
export type AllDayPlacement = {
  event: WeekEvent;
  startColumn: number;
  span: number;
  lane: number;
  /** 이번 주 앞에서 이미 시작했거나 뒤로 이어지는지. 화살표처럼 끝을 터 두는 근거다. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * 종일 일정을 주간 맨 위 줄에 놓는다. 여러 날짜에 걸친 일정은 한 막대로 이어 그리고,
 * 겹치는 막대는 아래 줄로 내린다. 먼저 시작하는 것, 같으면 긴 것이 위에 선다.
 */
export function placeAllDayEvents(
  events: WeekEvent[],
  weekStart: DateOnly,
): { placements: AllDayPlacement[]; laneCount: number } {
  const spans = events
    .filter((event) => event.allDay)
    .map((event) => {
      const from = daysBetween(weekStart, event.start);
      // 끝은 포함하지 않는다. 하루짜리는 from + 1 이 된다.
      const to = daysBetween(weekStart, event.end);
      return { event, from, to: Math.max(to, from + 1) };
    })
    .filter(({ from, to }) => to > 0 && from < 7)
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));

  // 줄마다 막대가 끝나는 열. 다음 막대가 그 열부터 시작하면 같은 줄에 들어간다.
  const laneEnds: number[] = [];
  const placements = spans.map(({ event, from, to }) => {
    const startColumn = Math.max(0, from);
    const endColumn = Math.min(7, to);
    let lane = laneEnds.findIndex((end) => end <= startColumn);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endColumn);
    } else {
      laneEnds[lane] = endColumn;
    }
    return {
      event,
      startColumn,
      span: endColumn - startColumn,
      lane,
      continuesBefore: from < 0,
      continuesAfter: to > 7,
    };
  });

  return { placements, laneCount: laneEnds.length };
}

/** 하루 칸 안에 놓인 시각 일정 조각. 분은 그 날 0시 기준이다. */
export type TimedPlacement = {
  event: WeekEvent;
  startMinute: number;
  endMinute: number;
  /** 겹치는 일정끼리 나눈 칸 중 몇 번째인지와 모두 몇 칸인지. */
  column: number;
  columns: number;
  /** 자정을 넘어 앞날 · 다음날로 이어지는 조각인지. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * 시각 일정을 요일 칸에 놓는다. 7개 배열이 월~일이다.
 *
 * 자정을 넘는 일정은 **날마다 잘라** 각 날 칸에 조각으로 놓는다 — 밤 11시~새벽 1시 일정이
 * 월요일 칸 바닥을 뚫고 나가지 않는다. 끝이 다음날 0시 정각이면 다음날 칸에는 놓지 않는다.
 */
export function placeTimedEvents(events: WeekEvent[], weekStart: DateOnly): TimedPlacement[][] {
  const days: Omit<TimedPlacement, "column" | "columns">[][] = Array.from({ length: 7 }, () => []);
  const weekStartMs = atKoreanTime(weekStart, 0).getTime();

  for (const event of events) {
    if (event.allDay) continue;
    const startMs = new Date(event.start).getTime();
    // 시작과 끝이 같은 일정도 있다(구글이 받아 준다). 화면에서는 한 점이라도 보이게 둔다.
    const endMs = Math.max(new Date(event.end).getTime(), startMs);

    for (let index = 0; index < 7; index += 1) {
      const dayStart = weekStartMs + index * MINUTES_PER_DAY * MINUTE_MS;
      const dayEnd = dayStart + MINUTES_PER_DAY * MINUTE_MS;
      const overlaps = startMs < dayEnd && (endMs > dayStart || (endMs === startMs && startMs >= dayStart));
      if (!overlaps) continue;

      const from = Math.max(startMs, dayStart);
      const to = Math.min(endMs, dayEnd);
      days[index].push({
        event,
        startMinute: Math.round((from - dayStart) / MINUTE_MS),
        endMinute: Math.round((to - dayStart) / MINUTE_MS),
        continuesBefore: startMs < dayStart,
        continuesAfter: endMs > dayEnd,
      });
    }
  }

  return days.map(layoutOverlaps);
}

/**
 * 한 날 안에서 겹치는 일정을 나란히 놓는다.
 *
 * 서로 겹치는 일정이 이어지는 덩어리마다 칸 수를 정한다. 덩어리 안에서는 비어 있는 가장 왼쪽
 * 칸에 들어간다. 9시~10시와 10시~11시처럼 끝과 시작이 맞닿기만 한 일정은 겹친 것이 아니다.
 */
function layoutOverlaps(
  segments: Omit<TimedPlacement, "column" | "columns">[],
): TimedPlacement[] {
  const sorted = [...segments].sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute,
  );

  const result: TimedPlacement[] = [];
  let cluster: TimedPlacement[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const placement of cluster) placement.columns = columnEnds.length;
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const segment of sorted) {
    // 한 점짜리 일정도 자리를 차지하도록 끝을 최소 1분 뒤로 본다.
    const end = Math.max(segment.endMinute, segment.startMinute + 1);
    if (cluster.length > 0 && segment.startMinute >= clusterEnd) closeCluster();

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= segment.startMinute);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    cluster.push({ ...segment, column, columns: 1 });
    clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end);
  }
  if (cluster.length > 0) closeCluster();

  return result;
}

/** 일정 폼 칸의 값. 브라우저 입력 칸(date · time)이 주고받는 꼴 그대로 둔다. */
export type EventFormValues = {
  allDay: boolean;
  startDate: DateOnly;
  startTime: string;
  /** 종일 일정은 **마지막 날을 포함해서** 적는다. 사람은 18일 하루를 "18일 ~ 18일" 로 읽는다. */
  endDate: DateOnly;
  endTime: string;
};

/** 기존 일정을 폼 값으로. 종일 일정의 끝은 구글의 "다음날" 에서 하루를 빼 사람 꼴로 바꾼다. */
export function formValuesOf(event: Pick<WeekEvent, "allDay" | "start" | "end">): EventFormValues {
  if (event.allDay) {
    const lastDay = addDays(event.end, -1);
    return {
      allDay: true,
      startDate: event.start,
      startTime: "09:00",
      endDate: lastDay < event.start ? event.start : lastDay,
      endTime: "10:00",
    };
  }
  const start = kstParts(new Date(event.start));
  const end = kstParts(new Date(event.end));
  return {
    allDay: false,
    startDate: start.date,
    startTime: formatMinute(start.minuteOfDay),
    endDate: end.date,
    endTime: formatMinute(end.minuteOfDay),
  };
}

/**
 * 빈 칸을 눌렀을 때 채울 값. 누른 시각부터 한 시간. 밤 11시 반을 누르면 끝이 다음날로 넘어간다.
 */
export function slotFormValues(date: DateOnly, minuteOfDay: number, allDay = false): EventFormValues {
  if (allDay) {
    return { allDay: true, startDate: date, startTime: "09:00", endDate: date, endTime: "10:00" };
  }
  const start = atKoreanTime(date, minuteOfDay);
  const end = kstParts(new Date(start.getTime() + 60 * MINUTE_MS));
  return {
    allDay: false,
    startDate: date,
    startTime: formatMinute(minuteOfDay),
    endDate: end.date,
    endTime: formatMinute(end.minuteOfDay),
  };
}

/** 구글 일정의 시작 · 끝 한쪽. 종일이면 date, 아니면 dateTime + timeZone 이다. */
export type GoogleEventTime =
  | { date: DateOnly; dateTime?: undefined; timeZone?: undefined }
  | { dateTime: string; timeZone: "Asia/Seoul"; date?: undefined };

/** 화면에서 받은 일정 칸. 서버 액션이 FormData 에서 문자열로 꺼내 넘긴다. */
export type EventFormFields = {
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  description: string;
  location: string;
};

export type EventInput = {
  title: string;
  description: string;
  location: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
};

export type ParsedEvent = { ok: true; value: EventInput } | { ok: false; message: string };

/**
 * 일정 폼 값을 구글에 보낼 꼴로. 브라우저 검사를 지나지 못한 값도 여기서 한 번 더 막는다.
 *
 * 종일 일정은 사람이 적은 마지막 날에 하루를 더해 구글의 "끝은 포함하지 않는다" 규칙에 맞춘다.
 * 시각 일정은 `+09:00` 을 붙여 적는다 — 서버가 UTC 에서 돌아도 한국 시각으로 들어간다.
 */
export function parseEventFields(fields: EventFormFields): ParsedEvent {
  const title = fields.title.trim();
  if (!title) return { ok: false, message: "제목을 입력하세요." };
  if (title.length > MAX_EVENT_TITLE_LENGTH) {
    return { ok: false, message: `제목은 ${MAX_EVENT_TITLE_LENGTH}자까지 쓸 수 있습니다.` };
  }

  const location = fields.location.trim();
  if (location.length > MAX_EVENT_LOCATION_LENGTH) {
    return { ok: false, message: `장소는 ${MAX_EVENT_LOCATION_LENGTH}자까지 쓸 수 있습니다.` };
  }

  // 설명은 줄바꿈이 곧 내용이라 양끝 공백만 걷어낸다.
  const description = fields.description.trim();
  if (description.length > MAX_EVENT_DESCRIPTION_LENGTH) {
    return { ok: false, message: `설명은 ${MAX_EVENT_DESCRIPTION_LENGTH}자까지 쓸 수 있습니다.` };
  }

  const startDate = fields.startDate.trim();
  const endDate = fields.endDate.trim();
  if (!isDateOnly(startDate)) return { ok: false, message: "시작 날짜를 확인하세요." };
  if (!isDateOnly(endDate)) return { ok: false, message: "종료 날짜를 확인하세요." };

  if (fields.allDay) {
    if (endDate < startDate) {
      return { ok: false, message: "종료 날짜가 시작 날짜보다 빠릅니다." };
    }
    return {
      ok: true,
      value: {
        title,
        description,
        location,
        start: { date: startDate },
        end: { date: addDays(endDate, 1) },
      },
    };
  }

  const startMinute = parseMinute(fields.startTime);
  const endMinute = parseMinute(fields.endTime);
  if (startMinute === null) return { ok: false, message: "시작 시각을 확인하세요." };
  if (endMinute === null) return { ok: false, message: "종료 시각을 확인하세요." };

  const start = atKoreanTime(startDate, startMinute);
  const end = atKoreanTime(endDate, endMinute);
  if (end.getTime() <= start.getTime()) {
    return { ok: false, message: "종료 시각이 시작 시각보다 늦어야 합니다." };
  }

  return {
    ok: true,
    value: { title, description, location, start: kstEventTime(start), end: kstEventTime(end) },
  };
}

/** 한 순간을 구글 dateTime 꼴로. "2026-10-18T10:00:00+09:00" — 초까지 남긴다(타이머가 초 단위다). */
export function kstEventTime(instant: Date): GoogleEventTime {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    dateTime: `${shifted.toISOString().slice(0, 19)}+09:00`,
    timeZone: "Asia/Seoul",
  };
}

/**
 * 타이머가 만드는 일정의 id. 시작 시각에서 정해지는 값이라 등록 요청이 두 번 가도(두 번 누름 ·
 * 응답 유실 후 다시 시도) 구글이 둘째를 409 로 거절해 일정이 두 벌 생기지 않는다.
 *
 * 구글 일정 id 는 base32hex(a-v · 0-9) 5~1024자여야 한다. 밀리초를 32진수로 적으면 그 문자만 나온다.
 */
export function timerEventId(startedAt: Date): string {
  return `lotimer${startedAt.getTime().toString(32)}`;
}

/**
 * 고치거나 지울 일정 id. 구글 id 는 영숫자이고 반복 회차는 `_20261018T010000Z` 꼴이 붙는다.
 * 주소 경로에 그대로 들어가므로 `.` · `..` 처럼 경로를 거슬러 오를 수 있는 값은 막는다.
 */
export function isValidEventId(value: string): boolean {
  return (
    value !== "." &&
    value !== ".." &&
    value.length <= 1024 &&
    /^[A-Za-z0-9_@.\-]+$/.test(value)
  );
}

/**
 * 서버 시각과 이 기기 시각의 차이(밀리초). 경과 시간을 기기 시계가 아니라 서버 시각 기준으로
 * 세기 위해서다 — 기기 시계가 몇 분 틀려도 다른 기기와 같은 경과 시간이 선다.
 */
export function clockOffsetMs(serverNow: string, clientNow: number = Date.now()): number {
  const server = Date.parse(serverNow);
  return Number.isNaN(server) ? 0 : server - clientNow;
}

/** 경과 시간 "1:05:09". 시간은 두 자리로 묶지 않는다 — 하루를 넘겨도 그대로 센다. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** "1시간 5분" · "45분" · "1분 미만". 확인 폼에서 일정 길이를 읽는 자리다. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (totalMinutes === 0) return "1분 미만";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

/**
 * 일정 색(colorId 1~11). 구글 캘린더가 고정해 둔 일정 팔레트다(colors.get 의 event 값).
 * 매번 묻지 않으려고 적어 둔다 — 구글이 이 값을 바꾼 적이 없다.
 */
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

/** 일정에 따로 색을 고르지 않았으면 캘린더 색을 따른다. 구글 화면과 같은 규칙이다. */
export function eventColor(colorId: string | undefined, calendarColor: string | undefined): string {
  return (colorId && GOOGLE_EVENT_COLORS[colorId]) || calendarColor || "#9fc6e7";
}

/** 타이머를 끝낼 때 확인 폼에서 받는 칸. 시각은 타이머가 정하므로 받지 않는다. */
export type TimerFinishFields = { title: string; description: string };

export type ParsedTimerFinish =
  | { ok: true; value: TimerFinishFields }
  | { ok: false; message: string };

/** 시작할 때는 비워도 되던 제목이 여기서는 필수다 — 캘린더에 제목 없는 일정이 남지 않게 한다. */
export function parseTimerFinishFields(fields: TimerFinishFields): ParsedTimerFinish {
  const title = fields.title.trim();
  if (!title) return { ok: false, message: "제목을 입력하세요." };
  if (title.length > MAX_EVENT_TITLE_LENGTH) {
    return { ok: false, message: `제목은 ${MAX_EVENT_TITLE_LENGTH}자까지 쓸 수 있습니다.` };
  }
  const description = fields.description.trim();
  if (description.length > MAX_EVENT_DESCRIPTION_LENGTH) {
    return { ok: false, message: `설명은 ${MAX_EVENT_DESCRIPTION_LENGTH}자까지 쓸 수 있습니다.` };
  }
  return { ok: true, value: { title, description } };
}

/**
 * 이 사이트에서 만드는 일정이 모두 들어가는 구글 캘린더의 이름(plan.md §5 — 업무 수행).
 * 기본 캘린더(계정 이름)에 섞이면 업무로 잰 시간과 개인 일정이 갈리지 않아 한 곳으로 모은다.
 * 캘린더는 사람이 구글에서 미리 만들어 둔다 — 앱은 캘린더를 만들 권한을 받지 않는다.
 */
export const WORK_CALENDAR_NAME = "렛츠커리어";

/** 목록에서 그 캘린더를 찾는다. 이름이 같아도 쓰기 권한이 없으면 등록할 수 없어 고르지 않는다. */
export function pickWorkCalendar<T extends { name: string; writable: boolean }>(
  calendars: T[],
): T | null {
  return (
    calendars.find((calendar) => calendar.writable && calendar.name.trim() === WORK_CALENDAR_NAME) ??
    null
  );
}

/** 타이머를 시작할 때 적는 제목. 비우면 null — 끝낼 때 적는다. */
export function parseTimerTitle(raw: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const title = raw.trim();
  if (title.length > MAX_EVENT_TITLE_LENGTH) {
    return { ok: false, message: `제목은 ${MAX_EVENT_TITLE_LENGTH}자까지 쓸 수 있습니다.` };
  }
  return { ok: true, value: title || null };
}

/**
 * 일정 막대 위 글자색. 구글 색은 연한 파스텔부터 진한 빨강 · 파랑까지 섞여 있어 한 색으로는
 * 어느 한쪽이 읽히지 않는다. 밝기(sRGB 가중치)로 검정과 흰색 중 하나를 고른다.
 */
export function readableTextColor(background: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(background.trim());
  if (!match) return "#1f1f1f";
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#1f1f1f" : "#ffffff";
}

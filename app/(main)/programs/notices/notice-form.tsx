"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { SavedNotice } from "@/domain/challenge-notice";
import {
  anchorsFor,
  DEFAULT_SCHEDULE_MINUTE_OF_DAY,
  describeAnchor,
  describePlacement,
  formatTimeOfDay,
  lockedOffsetSide,
  MAX_NOTICE_BODY_LENGTH,
  MAX_NOTICE_TITLE_LENGTH,
  maxOffsetDaysFor,
  NOTICE_AUDIENCE_LABELS,
  NOTICE_CHANNEL_LABELS,
  NOTICE_PLACEHOLDERS,
  RESERVE_DAYS_BEFORE_START,
  usesSchedule,
  type NoticeAudience,
  type NoticePlacement,
} from "@/domain/program-notice";

import { saveNotice, type NoticeSaveState } from "./actions";

const INITIAL_SAVE_STATE: NoticeSaveState = { error: null, saved: null };

/**
 * 안내문 한 장을 적는 폼. 등록과 수정이 같은 폼이다 — 적는 칸이 같으므로 나누면
 * 같은 검사와 같은 배치를 두 번 적게 된다. `notice` 가 있으면 수정이다.
 *
 * 어느 자리의 안내문인지(챌린지 · 받는 쪽 · 자리)는 폼이 서는 자리에서 이미 정해져 있어
 * 고르게 하지 않고 숨긴 칸으로 그대로 싣는다. 잘못된 자리에 적힐 길이 없어진다.
 */
export function NoticeForm({
  challengeId,
  audience,
  placement,
  notice,
  onDone,
  onCancel,
}: {
  /** 챌린지 공지방 글은 챌린지에 붙지 않아 `null` 이다. */
  challengeId: string | null;
  audience: NoticeAudience;
  placement: NoticePlacement;
  notice: SavedNotice | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(saveNotice, INITIAL_SAVE_STATE);

  /**
   * 기준일을 고르지 않으면 나머지 칸이 뜻을 잃는다. 그래서 고른 값만 여기서 들고
   * 나머지는 브라우저가 들게 둔다 — 적던 글까지 다시 그리면 긴 본문에서 커서가 튄다.
   */
  const [anchor, setAnchor] = useState(notice?.schedule?.anchor ?? "");
  /** 0 이면 "당일" 이라 전·후에 뜻이 없다. 그 칸을 잠그기 위해서만 들고 있다. */
  const [offsetDays, setOffsetDays] = useState(
    String(Math.abs(notice?.schedule?.offsetDays ?? 0)),
  );

  // 저장에 성공하면 폼을 닫는다. 새로 적은 줄은 목록에 이미 올라와 있다.
  const handledSave = useRef<number | null>(null);
  useEffect(() => {
    if (!state.saved || handledSave.current === state.saved.at) return;
    handledSave.current = state.saved.at;
    onDone();
  }, [state.saved, onDone]);

  const scheduled = usesSchedule(audience);
  const anchors = anchorsFor(placement);
  /** 시작 전·종료 후 자리는 방향이 이름으로 정해져 있어 고르게 하지 않는다. */
  const lockedSide = lockedOffsetSide(placement);
  /** 시작 전 자리만 좁다. 예약이 걸리는 날보다 이른 시점은 나갈 수 없다. */
  const maxDays = maxOffsetDaysFor(placement);

  return (
    <form action={formAction} className="bg-muted/30 border-border space-y-4 rounded-lg border p-4">
      <input type="hidden" name="challengeId" value={challengeId ?? ""} />
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="missionSeq" value={placement.missionSeq ?? ""} />
      <input type="hidden" name="phase" value={placement.phase ?? ""} />
      {notice ? <input type="hidden" name="noticeId" value={notice.noticeId} /> : null}

      <p className="text-muted-foreground text-xs">
        {describePlacement(placement)} · {NOTICE_AUDIENCE_LABELS[audience]} ·{" "}
        {NOTICE_CHANNEL_LABELS[audience]}
        {scheduled ? " · 예약 발송" : " · 예약 없음"}
      </p>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-title`}>이름</Label>
        <Input
          id={`${uid}-title`}
          name="title"
          required
          maxLength={MAX_NOTICE_TITLE_LENGTH}
          defaultValue={notice?.title ?? ""}
          placeholder={placeholderTitle(placement)}
          className="max-w-96"
        />
        <p className="text-muted-foreground text-xs">
          목록에서 이 안내문을 가리키는 표시입니다. 보내는 글에는 들어가지 않습니다.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-body`}>내용</Label>
        <Textarea
          id={`${uid}-body`}
          name="body"
          required
          rows={8}
          maxLength={MAX_NOTICE_BODY_LENGTH}
          defaultValue={notice?.body ?? ""}
          placeholder={`${NOTICE_CHANNEL_LABELS[audience]}으로 그대로 나가는 글을 적습니다.`}
        />
        {scheduled ? <SlackFormatHelp /> : null}
      </div>

      {scheduled ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">예약 발송 시점</legend>
          <p className="text-muted-foreground text-xs">
            안내문은 챌린지에 붙어 기수의 달력을 모릅니다. 날짜 대신 기준일에서 며칠
            떨어졌는지를 적어두면 기수마다 발송일이 계산됩니다. 계산된 시각으로 슬랙 예약이
            걸리는 것은 기수가 시작하기 {RESERVE_DAYS_BEFORE_START}일 전입니다.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="발송 기준일"
              name="scheduleAnchor"
              value={anchor}
              onChange={(event) => setAnchor(event.target.value)}
              className="w-44"
            >
              <option value="">지정 안 함</option>
              {anchors.map((value) => (
                <option key={value} value={value}>
                  {describeAnchor(value, placement)}
                </option>
              ))}
            </NativeSelect>

            <Input
              aria-label="기준일로부터 며칠"
              name="scheduleOffsetDays"
              type="number"
              min={0}
              max={maxDays}
              step={1}
              required={anchor !== ""}
              disabled={anchor === ""}
              value={offsetDays}
              onChange={(event) => setOffsetDays(event.target.value)}
              className="w-20"
            />
            {lockedSide === null ? (
              <>
                <span className="text-sm">일</span>

                <NativeSelect
                  aria-label="기준일 전인지 후인지"
                  name="scheduleOffsetSide"
                  defaultValue={
                    (notice?.schedule?.offsetDays ?? 0) > 0 ? "after" : "before"
                  }
                  // 당일이면 전·후에 뜻이 없다. 잠가 두면 "0일 후" 같은 말이 화면에 서지 않는다.
                  disabled={anchor === "" || offsetDays === "0"}
                  className="w-20"
                >
                  <option value="before">전</option>
                  <option value="after">후</option>
                </NativeSelect>
              </>
            ) : (
              // 방향이 자리 이름으로 정해져 있어 고를 것이 없다. 당일은 앞뒤가 없어 그냥 "당일".
              <span className="text-sm">
                {offsetDays === "0" ? "일 (당일)" : lockedSide === "before" ? "일 전" : "일 후"}
              </span>
            )}

            <Input
              aria-label="발송 시각"
              name="scheduleTime"
              type="time"
              required={anchor !== ""}
              disabled={anchor === ""}
              defaultValue={formatTimeOfDay(
                notice?.schedule?.minuteOfDay ?? DEFAULT_SCHEDULE_MINUTE_OF_DAY,
              )}
              className="w-32"
            />
          </div>

          {anchor === "" ? (
            <p className="text-muted-foreground text-xs">
              시점을 정하지 않으면 이 안내문은 저절로 나가지 않습니다. 글만 먼저 적어두고
              나중에 정해도 됩니다.
            </p>
          ) : placement.phase === "BEFORE_START" ? (
            <p className="text-muted-foreground text-xs">
              시작 {maxDays}일 전까지만 적을 수 있습니다. 예약이 그때 걸리므로 더 이른
              시점은 거는 날에 이미 지나 있습니다.
            </p>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-muted-foreground text-sm">
          멘토 안내문은 카카오톡으로 그때그때 보내므로 예약 시점을 적지 않습니다.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : notice ? "저장" : "등록하기"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          취소
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 슬랙에 나가는 글의 서식. 적는 법과 나오는 모습이 다른 것만 적는다 — 그대로 나가는 것은
 * 굳이 외울 필요가 없다.
 *
 * 슬랙은 **표준 마크다운**으로 읽는다. 사람 멘션과 채널 링크만 마크다운에 없는 슬랙
 * 고유 문법이라 아이디를 직접 적어야 한다(domain/slack-markdown).
 *
 * 접어둔 채로 연다. 안내문을 적는 사람은 대개 이미 알고 있고, 표가 펼쳐져 있으면
 * 정작 글 적는 칸이 화면 밖으로 밀린다.
 */
function SlackFormatHelp() {
  const rows: [string, string][] = [
    ["**굵게**", "굵게 — 별표 하나(*…*)는 기울임입니다"],
    ["- 항목", "불렛 목록 (두 칸 들여쓰면 중첩, 1. 로 적으면 번호 목록)"],
    ["## 제목", "제목 줄"],
    ["[글자](https://…)", "글자에 링크가 걸립니다"],
    ["> 인용", "인용 블록"],
    ["@here / @channel", "접속 중인 사람 / 채널 전원 호출"],
    ["<@U012AB3CD>", "사람 멘션 — 슬랙 프로필 › 더 보기 › 멤버 ID 복사"],
    ["<#C012AB3CD>", "채널 링크 — 채널 › 세부정보 아래쪽의 채널 ID"],
    // 우리가 채워 넣는 자리표시. 공지방 글은 한 벌이 여러 챌린지를 대신해 이것으로 챌린지를 적는다.
    [
      `${NOTICE_PLACEHOLDERS.challenge} ${NOTICE_PLACEHOLDERS.cohort}`,
      "나갈 때 그 기수의 챌린지 이름과 기수 숫자로 바뀝니다",
    ],
  ];

  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer select-none">슬랙 서식 적는 법</summary>
      <dl className="mt-2 space-y-1">
        {rows.map(([syntax, effect]) => (
          <div key={syntax} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="bg-muted rounded px-1 font-mono">{syntax}</dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** 자리마다 실제로 적는 글이 달라 예시도 자리를 따라간다. */
function placeholderTitle(placement: NoticePlacement): string {
  switch (placement.phase) {
    case "BEFORE_START":
      return "예: 개강 안내";
    case "AFTER_END":
      return "예: 수료 안내";
    default:
      return "예: 미션 시작 안내";
  }
}

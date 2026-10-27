"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChallengeNoticeRow, SavedNotice } from "@/domain/challenge-notice";
import {
  CHALLENGE_AUDIENCES,
  describePlacement,
  describeSchedule,
  MAX_SENDER_NAME_LENGTH,
  MAX_SLACK_CHANNEL_LENGTH,
  MAX_SLACK_TOKEN_LENGTH,
  noticeWarnings,
  NOTICE_AUDIENCE_LABELS,
  NOTICE_CHANNEL_LABELS,
  placementKey,
  toNoticeSlots,
  usesSchedule,
  type NoticeAudience,
  type NoticePlacement,
  type NoticeSlot,
} from "@/domain/program-notice";

import type { SlackSenderRow } from "@/domain/slack-sender";

import {
  removeNotice,
  removeNoticeSender,
  saveAnnouncementSlackChannel,
  saveNoticeSender,
  saveSlackChannel,
  selectNoticeSender,
  type NoticeRemoveState,
  type SenderSaveState,
  type SlackChannelState,
} from "./actions";
import { NoticeForm } from "./notice-form";

const INITIAL_REMOVE_STATE: NoticeRemoveState = { error: null };
const INITIAL_CHANNEL_STATE: SlackChannelState = { error: null, saved: null };
const INITIAL_SENDER_STATE: SenderSaveState = { error: null, saved: null };

/**
 * 드롭다운에서 챌린지 공지방을 가리키는 값. 챌린지 id(cuid)와 겹칠 수 없는 꼴이다.
 * 공지방은 챌린지가 아니지만 "어느 안내문 묶음을 볼지" 를 고르는 같은 자리에 선다.
 */
const ANNOUNCEMENT_OPTION = "__announcement__";

const ANNOUNCEMENT_AUDIENCES = ["ANNOUNCEMENT"] as const satisfies readonly NoticeAudience[];

/**
 * 한 번에 한 곳만 연다. 긴 본문을 적는 폼이 여럿 열려 있으면 어디에 적고 있었는지
 * 잃어버리고, 같은 자리에 두 장이 실수로 들어간다.
 */
type ActiveForm =
  | { kind: "new"; audience: NoticeAudience; placement: NoticePlacement }
  | { kind: "edit"; noticeId: string };

/**
 * 자리를 세로축, 받는 쪽을 가로축으로 둔다. "각 자리에 참여자와 멘토가 받는 글이 다르다"
 * 는 것이 이 화면의 본체이므로, 두 쪽을 나란히 놓아야 한 자리의 구성이 한눈에 읽힌다.
 * 받는 쪽으로 탭을 나누면 같은 자리를 보려고 탭을 오가게 된다.
 *
 * 세로축은 프로그램이 도는 차례 그대로다 — 시작 전 · 미션 1..N · 종료 후.
 */
export function NoticesPanel({
  rows,
  senders,
  announcementNotices,
  announcementChannel,
}: {
  rows: ChallengeNoticeRow[];
  senders: SlackSenderRow[];
  /** 챌린지 공지방 글. 챌린지에 붙지 않고 모든 챌린지가 한 벌을 함께 쓴다. */
  announcementNotices: SavedNotice[];
  /** 모든 챌린지가 함께 쓰는 전체 공지 채널. 비어 있으면 공지방 글이 걸리지 않는다. */
  announcementChannel: string | null;
}) {
  const uid = useId();
  const [challengeId, setChallengeId] = useState("");
  const [active, setActive] = useState<ActiveForm | null>(null);

  const isAnnouncement = challengeId === ANNOUNCEMENT_OPTION;
  // 목록에 없는 id 는 고르지 않은 것으로 본다. 이름을 지운 뒤 화면이 유령을 붙들지 않는다.
  const selected = rows.find((row) => row.challengeId === challengeId) ?? null;
  // 공지방은 미션 회차가 없어 시작 전 · 종료 후 두 자리만 선다.
  const slots = isAnnouncement
    ? toNoticeSlots(announcementNotices, 0)
    : selected
      ? toNoticeSlots(selected.notices, selected.missionCount)
      : [];
  const audiences = isAnnouncement ? ANNOUNCEMENT_AUDIENCES : CHALLENGE_AUDIENCES;

  function select(nextId: string) {
    setActive(null);
    setChallengeId(nextId);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <section className="border-border rounded-lg border p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="w-72 space-y-2">
            <Label htmlFor={`${uid}-challenge`}>챌린지 선택</Label>
            <NativeSelect
              id={`${uid}-challenge`}
              value={isAnnouncement ? ANNOUNCEMENT_OPTION : (selected?.challengeId ?? "")}
              onChange={(event) => select(event.target.value)}
            >
              <option value="" disabled>
                선택하세요
              </option>
              {/* 챌린지가 아니라 모든 챌린지가 함께 쓰는 묶음이라 맨 위에 따로 세운다. */}
              <option value={ANNOUNCEMENT_OPTION}>
                챌린지 공지방
                {announcementNotices.length === 0
                  ? " · 미작성"
                  : ` · ${announcementNotices.length}건`}
              </option>
              {rows.map((row) => (
                <option key={row.challengeId} value={row.challengeId}>
                  {row.challengeName}
                  {row.notices.length === 0 ? " · 미작성" : ` · ${row.notices.length}건`}
                </option>
              ))}
            </NativeSelect>
          </div>

          {selected ? (
            <SlackChannelField
              key={selected.challengeId}
              action={saveSlackChannel}
              challengeId={selected.challengeId}
              channel={selected.slackChannelId}
              label="참여자 슬랙 채널"
              emptyWarning="채널이 비어 있어 이 챌린지의 참여자 안내문은 예약되지 않습니다."
            />
          ) : null}

          {selected ? (
            <SenderSelect
              key={selected.challengeId}
              challengeId={selected.challengeId}
              senderId={selected.slackSenderId}
              senders={senders}
            />
          ) : null}

          {selected ? (
            <p className="text-muted-foreground mt-8 text-xs">
              {selected.missionCount > 0
                ? `프로그램 설정의 미션 ${selected.missionCount}회차 · 안내문 ${selected.notices.length}건`
                : `안내문 ${selected.notices.length}건`}
            </p>
          ) : null}

          {isAnnouncement ? (
            <SlackChannelField
              key={ANNOUNCEMENT_OPTION}
              action={saveAnnouncementSlackChannel}
              challengeId={null}
              channel={announcementChannel}
              label="전체 공지 채널"
              emptyWarning="채널이 비어 있어 공지방 안내문이 예약되지 않습니다."
            />
          ) : null}

          {isAnnouncement ? (
            <p className="text-muted-foreground mt-8 text-xs">
              안내문 {announcementNotices.length}건
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-border flex-1 rounded-lg border p-6">
        {!selected && !isAnnouncement ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            {rows.length === 0
              ? "등록된 챌린지가 없습니다. 프로그램 설정에서 챌린지를 먼저 등록하세요. 챌린지 공지방은 지금도 적을 수 있습니다."
              : "챌린지나 챌린지 공지방을 고르면 자리마다 안내문을 적을 수 있습니다."}
          </p>
        ) : (
          <>
            {selected && selected.missionCount === 0 ? (
              <p className="border-border text-muted-foreground mb-4 rounded-lg border border-dashed p-3 text-sm">
                이 챌린지는 프로그램 설정에 미션 구성이 없어 회차 자리가 서지 않습니다.
                설정에서 미션을 적으면 회차마다 안내문 자리가 생깁니다. 그 전에도 시작 전 ·
                종료 후 안내문은 적을 수 있습니다.
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left text-xs">
                    <th className="w-32 py-2 pr-3 font-medium">자리</th>
                    {audiences.map((audience) => (
                      <th key={audience} className="py-2 pr-3 font-medium">
                        {NOTICE_AUDIENCE_LABELS[audience]} · {NOTICE_CHANNEL_LABELS[audience]}
                        <span className="ml-1 font-normal">
                          {usesSchedule(audience) ? "· 예약 발송" : "· 예약 없음"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <SlotRows
                      key={placementKey(slot.placement)}
                      challengeId={selected?.challengeId ?? null}
                      audiences={audiences}
                      slot={slot}
                      active={active}
                      onActivate={setActive}
                      onClose={() => setActive(null)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <SenderSection senders={senders} />
    </div>
  );
}

/**
 * 보내는 슬랙 계정 목록. 챌린지 하나가 아니라 **여러 챌린지가 함께 가리키는 것**이라
 * 챌린지를 고르는 자리가 아니라 화면 맨 아래에 따로 선다.
 *
 * 토큰은 되돌려받지 않는다 — 목록에는 `xoxp-…a1b2` 꼴의 표시만 있고, 고칠 때 토큰 칸을
 * 비워 두면 적어둔 것이 그대로 남는다(domain/slack-sender).
 */
function SenderSection({ senders }: { senders: SlackSenderRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <section className="border-border rounded-lg border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">보내는 슬랙 계정</h2>
        <span className="text-muted-foreground text-xs">{senders.length}개</span>
      </div>

      <p className="text-muted-foreground mt-1.5 text-xs">
        슬랙 앱의 <span className="font-medium">User Token Scopes</span> 에{" "}
        <span className="font-medium">chat:write</span> 를 준 뒤 받은 사용자 토큰
        (<span className="font-medium">xoxp-</span> 로 시작)을 적습니다. 그 사람이 채널에
        들어가 있어야 예약이 걸립니다. 적어둔 토큰은 다시 읽을 수 없고 끝 네 자만 보입니다.
      </p>

      {senders.length > 0 ? (
        <ul className="border-border divide-border mt-4 divide-y rounded-lg border">
          {senders.map((sender) => (
            <SenderItem
              key={sender.senderId}
              sender={sender}
              editing={editing === sender.senderId}
              onEdit={() => {
                setAdding(false);
                setEditing(sender.senderId);
              }}
              onClose={() => setEditing(null)}
            />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="mt-4">
          <SenderForm sender={null} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          계정 추가
        </Button>
      )}
    </section>
  );
}

/** 계정 한 줄. 어느 챌린지가 이 계정을 쓰는지 함께 적어 지워도 되는지 가린다. */
function SenderItem({
  sender,
  editing,
  onEdit,
  onClose,
}: {
  sender: SlackSenderRow;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [state, removeAction, removing] = useActionState(
    removeNoticeSender,
    INITIAL_REMOVE_STATE,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm">
          {sender.name}
          <span className="text-muted-foreground ml-2 font-mono text-xs">
            {sender.tokenHint}
          </span>
        </p>
        <span className="text-muted-foreground text-xs">
          {sender.challengeCount === 0
            ? "쓰는 챌린지 없음"
            : `챌린지 ${sender.challengeCount}개`}
        </span>
      </div>

      {confirming ? (
        <form action={removeAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="senderId" value={sender.senderId} />
          <span className="text-xs">
            {sender.challengeCount === 0
              ? "지울까요?"
              : `이 계정을 쓰는 챌린지 ${sender.challengeCount}개의 선택이 비워지고 예약이 멈춥니다. 지울까요?`}{" "}
            이미 슬랙에 걸린 예약은 그대로 남습니다.
          </span>
          <Button type="submit" variant="destructive" size="sm" disabled={removing}>
            {removing ? "삭제 중…" : "삭제"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => setConfirming(false)}
          >
            취소
          </Button>
        </form>
      ) : (
        <div className="mt-1 flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            {editing ? "수정 중" : "수정"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            삭제
          </Button>
        </div>
      )}

      {state.error ? (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {state.error}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-2">
          <SenderForm sender={sender} onDone={onClose} onCancel={onClose} />
        </div>
      ) : null}
    </li>
  );
}

/** 계정 하나를 적는 폼. 등록과 수정이 같은 폼이다 — 적는 칸이 같다. */
function SenderForm({
  sender,
  onDone,
  onCancel,
}: {
  sender: SlackSenderRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(
    saveNoticeSender,
    INITIAL_SENDER_STATE,
  );

  // 저장에 성공하면 폼을 닫는다. 목록에 이미 올라와 있다.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!state.saved || handled.current === state.saved.at) return;
    handled.current = state.saved.at;
    onDone();
  }, [state.saved, onDone]);

  return (
    <form
      action={formAction}
      className="bg-muted/30 border-border space-y-3 rounded-lg border p-4"
    >
      {sender ? <input type="hidden" name="senderId" value={sender.senderId} /> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-2">
          <Label htmlFor={`${uid}-name`}>이름</Label>
          <Input
            id={`${uid}-name`}
            name="name"
            required
            maxLength={MAX_SENDER_NAME_LENGTH}
            defaultValue={sender?.name ?? ""}
            placeholder="예: 경지"
          />
        </div>

        <div className="min-w-72 flex-1 space-y-2">
          <Label htmlFor={`${uid}-token`}>사용자 토큰</Label>
          <Input
            id={`${uid}-token`}
            name="token"
            type="password"
            // 새 계정은 토큰 없이 세울 수 없다. 수정은 비워 두면 그대로 둔다.
            required={sender === null}
            maxLength={MAX_SLACK_TOKEN_LENGTH}
            autoComplete="off"
            placeholder={sender ? "그대로 두려면 비워 둡니다" : "xoxp-…"}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : sender ? "저장" : "등록하기"}
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
 * 이 챌린지를 누구 계정으로 예약할지.
 *
 * 고르는 즉시 저장한다 — 드롭다운 하나에 저장 버튼을 따로 두면 고르고 안 누르는 일이 생기고,
 * 그 어긋남은 다음 크론이 돌 때까지 드러나지 않는다.
 */
function SenderSelect({
  challengeId,
  senderId,
  senders,
}: {
  challengeId: string;
  senderId: string | null;
  senders: SlackSenderRow[];
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    selectNoticeSender,
    INITIAL_CHANNEL_STATE,
  );

  return (
    <form action={formAction} ref={formRef} className="w-56 space-y-2">
      <input type="hidden" name="challengeId" value={challengeId} />

      <Label htmlFor={`${uid}-sender`}>보내는 계정</Label>

      <NativeSelect
        id={`${uid}-sender`}
        name="senderId"
        defaultValue={senderId ?? ""}
        disabled={pending || senders.length === 0}
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">고르지 않음</option>
        {senders.map((sender) => (
          <option key={sender.senderId} value={sender.senderId}>
            {sender.name}
          </option>
        ))}
      </NativeSelect>

      {state.error ? (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      ) : senders.length === 0 ? (
        <p className="text-destructive text-xs">
          등록된 계정이 없습니다. 아래에서 먼저 등록하세요.
        </p>
      ) : senderId === null ? (
        <p className="text-destructive text-xs">
          계정을 고르지 않으면 예약되지 않습니다.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          이 사람 이름으로 나가고, 예약도 이 사람 슬랙에 섭니다.
        </p>
      )}
    </form>
  );
}

/**
 * 안내문이 나갈 슬랙 채널 한 칸. 챌린지의 참여자 채널과 모든 챌린지가 함께 쓰는 공지방
 * 채널이 같은 칸을 쓴다 — 적는 법도 저장 결과를 알리는 법도 같다.
 *
 * 안내문과 같은 화면에 두는 것은 "이 글들이 어디로 나가는가" 가 글을 적는 자리에서
 * 읽혀야 하기 때문이다. 기수마다 적지 않으므로 여기 한 칸이면 끝난다(plan.md §5).
 */
function SlackChannelField({
  action,
  challengeId,
  channel,
  label,
  emptyWarning,
}: {
  action: (state: SlackChannelState, formData: FormData) => Promise<SlackChannelState>;
  /** 챌린지에 붙는 채널이면 그 챌린지. 공지방 채널은 챌린지가 없어 `null`. */
  challengeId: string | null;
  channel: string | null;
  label: string;
  emptyWarning: string;
}) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(action, INITIAL_CHANNEL_STATE);

  return (
    <form action={formAction} className="w-72 space-y-2">
      {challengeId ? <input type="hidden" name="challengeId" value={challengeId} /> : null}

      <Label htmlFor={`${uid}-channel`}>{label}</Label>

      <div className="flex items-center gap-2">
        <Input
          id={`${uid}-channel`}
          name="slackChannelId"
          maxLength={MAX_SLACK_CHANNEL_LENGTH}
          defaultValue={channel ?? ""}
          placeholder="예: C01ABCDEFGH"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>

      {/*
       * 적어둔 값이 그대로 남아 있어 화면만으로는 저장됐는지 갈리지 않는다.
       * 비었다는 경고보다 방금 한 일의 결과가 먼저 읽혀야 한다.
       */}
      {state.error ? (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      ) : state.saved ? (
        <p className="text-muted-foreground text-xs">
          {channel === null ? "채널을 비웠습니다." : "저장했습니다."}
        </p>
      ) : channel === null ? (
        <p className="text-destructive text-xs">{emptyWarning}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          보내는 계정이 이 채널에 들어가 있어야 예약이 걸립니다.
        </p>
      )}
    </form>
  );
}

/**
 * 한 자리가 차지하는 줄. 폼을 열면 받는 쪽 칸이 좁아 긴 본문을 적을 수 없으므로,
 * 표 너비를 가로지르는 줄을 아래에 하나 더 편다.
 */
function SlotRows({
  challengeId,
  audiences,
  slot,
  active,
  onActivate,
  onClose,
}: {
  /** 챌린지 공지방이면 `null`. */
  challengeId: string | null;
  /** 이 표에 서는 받는 쪽 칸. 챌린지는 참여자 · 멘토, 공지방은 공지방 하나다. */
  audiences: readonly NoticeAudience[];
  slot: NoticeSlot<SavedNotice>;
  active: ActiveForm | null;
  onActivate: (active: ActiveForm) => void;
  onClose: () => void;
}) {
  const open = openFormIn(slot, active);

  return (
    <>
      <tr className="border-border align-top [&:not(:last-child)]:border-b">
        <th scope="row" className="py-3 pr-3 text-left font-medium">
          {describePlacement(slot.placement)}
          {slot.orphan ? (
            <span className="text-destructive mt-0.5 block text-xs font-normal">
              설정에 없는 회차
            </span>
          ) : null}
        </th>

        {audiences.map((audience) => (
          <td key={audience} className="py-3 pr-3">
            <AudienceCell
              notices={slot.notices.filter((notice) => notice.audience === audience)}
              placement={slot.placement}
              active={active}
              onEdit={(noticeId) => onActivate({ kind: "edit", noticeId })}
              onAdd={() =>
                onActivate({ kind: "new", audience, placement: slot.placement })
              }
            />
          </td>
        ))}
      </tr>

      {open ? (
        <tr className="border-border border-b">
          <td colSpan={1 + audiences.length} className="pb-4">
            <NoticeForm
              // 자리가 바뀌면 폼을 처음부터 다시 세운다. 앞서 적던 글이 다른 자리로
              // 따라 들어가는 일을 막는다.
              key={
                open.notice?.noticeId ??
                `new-${open.audience}-${placementKey(slot.placement)}`
              }
              challengeId={challengeId}
              audience={open.audience}
              placement={slot.placement}
              notice={open.notice}
              onDone={onClose}
              onCancel={onClose}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** 받는 쪽 한 칸. 적어둔 안내문들과 한 장 더 적는 버튼이 선다. */
function AudienceCell({
  notices,
  placement,
  active,
  onEdit,
  onAdd,
}: {
  notices: SavedNotice[];
  placement: NoticePlacement;
  active: ActiveForm | null;
  onEdit: (noticeId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-2">
      {notices.map((notice) => (
        <NoticeItem
          key={notice.noticeId}
          notice={notice}
          placement={placement}
          editing={active?.kind === "edit" && active.noticeId === notice.noticeId}
          onEdit={() => onEdit(notice.noticeId)}
        />
      ))}

      <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
        안내문 추가
      </Button>
    </div>
  );
}

/** 적어둔 안내문 한 장. 언제 나가는지와 첫 줄을 보여 어느 글인지 열지 않고 가린다. */
function NoticeItem({
  notice,
  placement,
  editing,
  onEdit,
}: {
  notice: SavedNotice;
  placement: NoticePlacement;
  editing: boolean;
  onEdit: () => void;
}) {
  const [state, removeAction, removing] = useActionState(
    removeNotice,
    INITIAL_REMOVE_STATE,
  );
  const [confirming, setConfirming] = useState(false);
  const warnings = noticeWarnings(notice);

  return (
    <div
      className={`border-border rounded-lg border p-2.5 ${editing ? "bg-muted/40" : ""}`}
    >
      <p className="font-medium">{notice.title}</p>

      <p className="text-muted-foreground mt-0.5 text-xs">
        {notice.schedule
          ? describeSchedule(notice.schedule, placement)
          : usesSchedule(notice.audience)
            ? "시점 미정 · 직접 보냄"
            : "직접 보냄"}
      </p>

      {/* 첫 줄만 보인다. 어느 글인지 가리는 데는 그것으로 충분하고, 전부 펴면 표가 무너진다. */}
      <p className="text-muted-foreground mt-1 truncate text-xs">
        {notice.body.split("\n")[0]}
      </p>

      {warnings.map((warning) => (
        <p key={warning} className="text-destructive mt-1 text-xs">
          {warning}
        </p>
      ))}

      {confirming ? (
        <form action={removeAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="noticeId" value={notice.noticeId} />
          <span className="text-xs">지울까요? 적어둔 글은 되살릴 수 없습니다.</span>
          <Button type="submit" variant="destructive" size="sm" disabled={removing}>
            {removing ? "삭제 중…" : "삭제"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => setConfirming(false)}
          >
            취소
          </Button>
        </form>
      ) : (
        <div className="mt-1 flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            {editing ? "수정 중" : "수정"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            삭제
          </Button>
        </div>
      )}

      {state.error ? (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 이 줄 아래에 폼을 펼지, 편다면 어느 자리의 것인지.
 * 수정은 안내문이 이 줄에 있을 때만, 추가는 자리가 맞을 때만 열린다.
 */
function openFormIn(
  slot: NoticeSlot<SavedNotice>,
  active: ActiveForm | null,
): { audience: NoticeAudience; notice: SavedNotice | null } | null {
  if (!active) return null;

  if (active.kind === "new") {
    return placementKey(active.placement) === placementKey(slot.placement)
      ? { audience: active.audience, notice: null }
      : null;
  }

  const notice = slot.notices.find((entry) => entry.noticeId === active.noticeId);

  return notice ? { audience: notice.audience, notice } : null;
}

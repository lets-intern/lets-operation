import { prisma } from "@/lib/prisma";
import {
  deleteScheduledSlackMessage,
  scheduleSlackMessage,
  sendSlackSelfMessage,
} from "@/lib/slack";

import {
  addDays,
  formatKoreanDateTime,
  toDate,
  toDateOnly,
  todayInKorea,
  type DateOnly,
} from "./date";
import {
  planNoticeReservations,
  type PlannableNotice,
  type ProgramDates,
} from "./notice-schedule";
import { getAnnouncementChannel } from "./notice-setting";
import { programTitle } from "./program-launch";
import { toSlackMarkdown } from "./slack-markdown";
import {
  fillNoticePlaceholders,
  noticeReceiptText,
  RESERVE_DAYS_BEFORE_START,
  SCHEDULED_AUDIENCES,
  type NoticeAnchor,
  type NoticeAudience,
  type NoticePhase,
  type NoticePlacement,
  type ReceiptLine,
} from "./program-notice";
import {
  curriculumLabel,
  settingsForProgram,
  type FeedbackKind,
  type MissionPlan,
  type ProgramSettingsPick,
  type ProgramVersion,
} from "./program-setting";

/**
 * 슬랙 안내문을 기수의 날짜에 맞춰 슬랙에 예약하는 곳. 규칙은 domain/notice-schedule 이
 * 정하고, 여기는 데이터베이스와 슬랙을 오가는 일만 한다(plan.md §7).
 *
 * 슬랙으로 나가는 쪽은 둘이고 **걸리는 채널만 다르다** — 참여자 글은 챌린지의 채널로,
 * 챌린지 공지방 글은 모든 챌린지가 함께 쓰는 전체 공지 채널로 간다. 공지방 글은 챌린지에
 * 붙지 않은 한 벌이라 **어느 챌린지의 기수든** 함께 걸린다. 보내는 계정은 둘 다 그 기수의
 * 챌린지가 고른 계정이다.
 *
 * 하루 한 번 도는 크론과 운영 화면의 `지금 걸기` 가 **시작일이 4일 이내로 남은 기수**를
 * 찾아 그 기수의 슬랙 안내문을 한꺼번에 예약한다. 같은 기수를 며칠에 걸쳐 몇 번씩 다시
 * 보게 되는데, 두 통이 나가지 않는 것은 `notice_reservation` 의 (기수, 안내문) 유일
 * 제약이 지킨다. 그래서 사람이 버튼을 몇 번 눌러도 안전하다.
 *
 * **한 번 걸린 예약은 저절로 다시 걸리지 않는다.** 뒤늦게 글을 고치거나 채널을 바꾸거나
 * 날짜를 옮겨도 슬랙에 걸린 것은 그대로다. 매일 대조해 지우고 다시 거는 쪽은 사람이
 * 모르는 사이에 예약이 바뀌어, 언제 무엇이 나갈지가 화면을 볼 때마다 달라진다.
 * 고치려면 사람이 `cancelNoticeReservation` 으로 거두고 다시 건다(plan.md §5).
 *
 * 걸고 나면 **보낸 사람에게 영수증을 한 통** 남긴다. 슬랙이 API 로 건 예약을 제 화면에
 * 보여주지 않아(plan.md §5 의 2026-09-13 정정) 무엇이 언제 나가는지 슬랙 안에서 알
 * 길이 없기 때문이다.
 *
 * 못 걸린 건은 사유와 함께 남고, **사유가 풀리면 다음 크론이 다시 시도한다** — 아직
 * 걸리지 않은 것은 "걸린 것" 이 아니기 때문이다. 채널을 나중에 적어 넣은 경우가 그렇다.
 */

export type ReserveResult = {
  /** 살펴본 기수 수. 0 이면 4일 안으로 다가온 기수가 없었다는 뜻이다. */
  programs: number;
  /** 이번에 새로 걸린 건. */
  reserved: number;
  /** 못 걸려 사유가 남은 건. */
  failed: number;
  /** 이미 걸려 있어 그대로 둔 건. */
  kept: number;
};

export async function reserveUpcomingNotices(
  now: Date = new Date(),
): Promise<ReserveResult> {
  const today = todayInKorea(now);
  const until = addDays(today, RESERVE_DAYS_BEFORE_START);
  // 공지방은 채널도 글도 모든 챌린지가 함께 쓰므로 기수마다 읽지 않고 한 번만 읽는다.
  const announcementChannel = await getAnnouncementChannel();
  const announcementNotices = await prisma.programNotice.findMany({
    where: { challengeId: null, audience: "ANNOUNCEMENT" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      audience: true,
      missionSeq: true,
      phase: true,
      title: true,
      body: true,
      scheduleAnchor: true,
      scheduleOffsetDays: true,
      scheduleMinuteOfDay: true,
    },
  });

  const programs = await prisma.program.findMany({
    where: {
      /*
       * 출처를 가리지 않는다. 되짚어 온 기수도 **아직 시작하지 않았으면 앞으로 나갈
       * 글이 있다** — 실서비스에서 되짚었다는 것은 상세페이지가 이미 열렸다는 뜻이지
       * 이미 돌았다는 뜻이 아니다(domain/program 의 isLaunched, 캘린더의 `운영 예정`).
       *
       * 예전에는 `serviceImportedAt: null` 로 그런 기수를 걸러냈다. 아래 시작일 조건이
       * 이미 앞으로 올 기수만 남기므로 그 필터가 막은 것은 지난 기록이 아니라 **되짚어 온
       * 채로 다가오는 기수 전부**였고, 그 기수의 안내문은 영영 걸리지 않았다.
       */
      startDate: { gte: toDate(today), lte: toDate(until) },
    },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      // 영수증에 어느 기수인지 적는다. "안내문 2건 예약됨" 만으로는 무엇의 것인지 모른다.
      cohort: true,
      startDate: true,
      endDate: true,
      // 커리큘럼이 나뉘는 챌린지는 이 기수가 고른 커리큘럼의 미션으로 회차 날짜를 잰다.
      curriculumDays: true,
      challenge: {
        select: {
          name: true,
          slackChannelId: true,
          // 챌린지마다 보내는 사람이 다르다. 토큰은 이 서버 경로에서만 읽고 화면으로
          // 나가지 않는다(domain/slack-sender).
          slackSender: { select: { name: true, token: true } },
          settings: {
            orderBy: [{ curriculumDays: "asc" }, { version: "asc" }],
            select: {
              curriculumDays: true,
              version: true,
              missions: {
                orderBy: { seq: "asc" },
                select: {
                  seq: true,
                  durationDays: true,
                  feedbackKind: true,
                  feedbackDays: true,
                },
              },
            },
          },
          notices: {
            where: { audience: { in: [...SCHEDULED_AUDIENCES] } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              audience: true,
              missionSeq: true,
              phase: true,
              title: true,
              body: true,
              scheduleAnchor: true,
              scheduleOffsetDays: true,
              scheduleMinuteOfDay: true,
            },
          },
        },
      },
      // 우리 종료일이 비면 이 기수를 세운 마케팅 기획의 종료일을 본다(domain/program).
      mktPlans: { select: { endDate: true } },
      noticeReservations: { select: { noticeId: true, slackMessageId: true } },
    },
  });

  const result: ReserveResult = { programs: programs.length, reserved: 0, failed: 0, kept: 0 };

  for (const program of programs) {
    // 캘린더와 같은 잣대로 이 기수가 따르는 설정을 고른다(domain/program 의 listProgramPeriods).
    const pick = settingsForProgram(program.challenge.settings, program.curriculumDays);
    const dates: ProgramDates = {
      startDate: toDateOnly(program.startDate),
      endDate: program.endDate ? toDateOnly(program.endDate) : latestEnd(program.mktPlans),
      missions: firstMissionPlan(pick.settings),
      missionsUnresolved: unresolvedCurriculumFailure(pick.unresolved, program.curriculumDays),
    };

    // 이미 걸린 글은 계산조차 하지 않는다. 다시 걸지 않는다는 규칙이 여기서 지켜진다.
    const done = new Set(
      program.noticeReservations
        .filter((row) => row.slackMessageId !== null)
        .map((row) => row.noticeId),
    );

    const plannable = toPlannableNotices([
      ...program.challenge.notices,
      ...announcementNotices,
    ]);
    const pending = plannable.filter((notice) => !done.has(notice.noticeId));
    result.kept += plannable.length - pending.length;

    const sender = program.challenge.slackSender;

    // 이번에 새로 걸린 것만 모은다. 영수증은 달라진 것만 알리는 자리다.
    const placed: ReceiptLine[] = [];
    let stuck = 0;

    for (const planned of planNoticeReservations(dates, pending, now)) {
      const announcement = planned.audience === "ANNOUNCEMENT";
      const channel = announcement ? announcementChannel : program.challenge.slackChannelId;

      const where = {
        postAt: planned.postAt,
        channelId: channel,
        senderName: sender?.name ?? null,
      };

      const failure =
        planned.failure ??
        (channel === null
          ? announcement
            ? "챌린지 공지방 채널이 적혀 있지 않습니다. 안내문 관리에서 공지방 채널을 적으세요."
            : "이 챌린지에 슬랙 채널이 적혀 있지 않습니다. 안내문 관리에서 채널을 적으세요."
          : sender === null
            ? "이 챌린지에 보내는 슬랙 계정이 골라져 있지 않습니다. 안내문 관리에서 고르세요."
            : null);

      if (failure !== null) {
        await record(program.id, planned.noticeId, {
          ...where,
          slackMessageId: null,
          failure,
        });
        result.failed += 1;
        stuck += 1;
        continue;
      }

      // 위에서 가려냈으므로 여기 오는 건은 채널 · 계정 · 시각이 모두 있다.
      try {
        const slackMessageId = await scheduleSlackMessage({
          token: (sender as { token: string }).token,
          channel: channel as string,
          postAt: planned.postAt as Date,
          // 적어둔 글은 그대로가 아니라 슬랙이 읽는 꼴로 넘긴다(domain/slack-markdown).
          // `{챌린지}` · `{기수}` 는 이 기수의 것으로 채운다 — 공지방 글은 한 벌이 여러 챌린지를 대신한다.
          markdown: toSlackMarkdown(
            fillNoticePlaceholders(planned.body, {
              challengeName: program.challenge.name,
              cohort: program.cohort,
            }),
          ),
        });

        await record(program.id, planned.noticeId, {
          ...where,
          slackMessageId,
          failure: null,
        });
        result.reserved += 1;
        placed.push({
          postAt: planned.postAt as Date,
          title: planned.title,
          placement: planned.placement,
          audience: planned.audience,
        });
      } catch (error) {
        // 한 건이 막혀도 나머지는 걸어야 한다. 사유를 줄에 남겨 화면에서 읽히게 한다.
        await record(program.id, planned.noticeId, {
          ...where,
          slackMessageId: null,
          failure: error instanceof Error ? error.message : "예약하지 못했습니다.",
        });
        result.failed += 1;
        stuck += 1;
      }
    }

    if (placed.length > 0 && sender !== null) {
      await sendReceipt(sender.token, {
        title: programTitle(program.challenge.name, program.cohort),
        placed,
        stuck,
      });
    }
  }

  return result;
}

/**
 * 예약을 걸었다는 영수증을 보낸 사람 자신에게 남긴다. 무슨 글이 적히는지는
 * `noticeReceiptText` 가 정하고 여기는 슬랙에 넘기기만 한다(plan.md §7).
 *
 * **새로 걸린 것이 있을 때만** 보낸다. 크론이 며칠에 걸쳐 같은 기수를 다시 봐도 이미
 * 걸린 것은 건너뛰므로 같은 영수증이 매일 오지 않는다.
 *
 * 영수증이 막혀도 예약은 이미 걸렸다. 그것까지 실패로 만들지 않는다 — 로그에만 남긴다.
 */
async function sendReceipt(
  token: string,
  summary: { title: string; placed: ReceiptLine[]; stuck: number },
): Promise<void> {
  try {
    await sendSlackSelfMessage({
      token,
      markdown: noticeReceiptText({ ...summary, formatAt: formatKoreanDateTime }),
    });
  } catch (error) {
    console.error("[notice-reservation] 예약 영수증을 보내지 못했습니다", error);
  }
}

/**
 * 걸어 본 결과 한 줄. 같은 자리에 이미 줄이 있으면 덮어쓴다 — 못 걸렸던 줄이 이번에
 * 걸리면 그 줄이 성공으로 바뀌어야 하고, 사유도 마지막에 본 것이 남아야 한다.
 */
async function record(
  programId: string,
  noticeId: string,
  values: {
    postAt: Date | null;
    channelId: string | null;
    senderName: string | null;
    slackMessageId: string | null;
    failure: string | null;
  },
): Promise<void> {
  await prisma.noticeReservation.upsert({
    where: { programId_noticeId: { programId, noticeId } },
    create: { programId, noticeId, ...values },
    update: values,
  });
}

/** 갈래마다 끝나는 날이 다를 수 있다. 마지막 갈래가 끝나야 그 기수의 운영이 끝난다. */
function latestEnd(plans: { endDate: Date | null }[]): DateOnly | null {
  const ends = plans
    .map((plan) => plan.endDate)
    .filter((end): end is Date => end !== null)
    .map(toDateOnly);

  return ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b));
}

/**
 * 커리큘럼을 몰라 회차 안내문이 갈 곳이 없을 때 남기는 사유. 고칠 자리가 프로그램 설정이
 * 아니라 개설이라 그곳을 가리킨다. 사유가 풀리면(커리큘럼을 고르면) 다음 크론이 다시 건다.
 */
function unresolvedCurriculumFailure(
  unresolved: ProgramSettingsPick<unknown>["unresolved"],
  curriculumDays: number | null,
): string | null {
  if (unresolved === "UNASSIGNED") {
    return "커리큘럼 미지정 기수라 회차 날짜를 모릅니다. 프로그램 개설에서 커리큘럼을 고르세요.";
  }
  if (unresolved === "MISSING" && curriculumDays !== null) {
    return `이 기수가 고른 ${curriculumLabel(curriculumDays)} 커리큘럼의 설정이 없어 회차 날짜를 모릅니다. 프로그램 개설에서 커리큘럼을 다시 고르세요.`;
  }
  return null;
}

/**
 * 발송일을 계산할 미션 구성 한 벌.
 *
 * 받는 설정은 이미 이 기수의 커리큘럼으로 거른 것이다(settingsForProgram).
 *
 * 안내문은 갈래를 가리지 않는데(plan.md §5) 설정은 갈래마다 한 벌씩이다. 지금 나뉜
 * 챌린지는 모두 두 갈래의 미션 구성이 같아 어느 벌을 봐도 같은 날짜가 나오므로, 정해진
 * 차례의 첫 벌을 본다. 구성이 실제로 갈리는 날이 오면 회차 안내문의 발송일이 한쪽 갈래에
 * 맞춰지는데, 계산된 날짜가 운영 화면에 그대로 적혀 있어 어긋남이 드러난다.
 *
 * 미션이 하나도 없는 설정은 건너뛴다 — 수행기간만 적어두고 미션은 아직 안 적은 설정이 있다.
 */
function firstMissionPlan(
  settings: {
    version: ProgramVersion;
    missions: {
      seq: number;
      durationDays: number;
      feedbackKind: FeedbackKind | null;
      feedbackDays: number | null;
    }[];
  }[],
): MissionPlan[] {
  const found = settings.find((setting) => setting.missions.length > 0);
  if (!found) return [];

  return found.missions.map((mission) => ({
    seq: mission.seq,
    durationDays: mission.durationDays,
    feedback:
      mission.feedbackKind !== null && mission.feedbackDays !== null
        ? { kind: mission.feedbackKind, days: mission.feedbackDays }
        : null,
  }));
}

/**
 * 시점이 적힌 안내문만 발송 대상이다. 시점을 안 정한 글은 사람이 직접 보내는 것이라
 * 못 걸린 것으로 세지 않는다 — 안내문 화면이 이미 "저절로 나가지 않는다" 고 알린다.
 */
function toPlannableNotices(
  notices: {
    id: string;
    audience: NoticeAudience;
    missionSeq: number | null;
    phase: NoticePhase | null;
    title: string;
    body: string;
    scheduleAnchor: NoticeAnchor | null;
    scheduleOffsetDays: number | null;
    scheduleMinuteOfDay: number | null;
  }[],
): PlannableNotice[] {
  return notices.flatMap((notice) => {
    if (
      notice.scheduleAnchor === null ||
      notice.scheduleOffsetDays === null ||
      notice.scheduleMinuteOfDay === null
    ) {
      return [];
    }

    return [
      {
        noticeId: notice.id,
        audience: notice.audience,
        title: notice.title,
        body: notice.body,
        placement: toPlacement(notice),
        schedule: {
          anchor: notice.scheduleAnchor,
          offsetDays: notice.scheduleOffsetDays,
          minuteOfDay: notice.scheduleMinuteOfDay,
        },
      },
    ];
  });
}

/** 두 칸을 자리 하나로. 어긋난 줄은 시작 전으로 세운다(domain/challenge-notice 와 같은 꼴). */
function toPlacement(notice: {
  missionSeq: number | null;
  phase: NoticePhase | null;
}): NoticePlacement {
  if (notice.missionSeq !== null && notice.phase === null) {
    return { phase: null, missionSeq: notice.missionSeq };
  }

  return { phase: notice.phase ?? "BEFORE_START", missionSeq: null };
}

/** 취소해 본 결과. 막혔으면 화면에 그대로 설 문장이 온다. */
export type CancelNoticeResult = { ok: true } | { ok: false; failure: string };

/**
 * 걸어둔 예약 하나를 거둔다. 슬랙에서 지우고 우리 줄도 지워 **아직 걸리지 않은 상태로**
 * 되돌린다. 그다음 `지금 걸기` 가 지금 설정으로 다시 건다.
 *
 * 다시 거는 것을 자동으로 하지 않는 이유는 위에 적은 그대로다 — 매일 대조해 지우고 다시
 * 걸면 사람이 슬랙에서 손본 것을 말없이 되돌린다. 그래서 **사람이 누르는 취소**를 둔다.
 * 채널이나 발송 시각을 고친 뒤 그것을 실제로 반영할 수 있는 길은 이것뿐이다 — 이 자리가
 * 없던 동안에는 한 번 걸린 안내문의 채널을 바꿀 방법이 아예 없었다.
 *
 * 슬랙 계정은 **지금 그 챌린지가 가리키는 계정**을 쓴다. 걸 때와 다른 계정으로 바뀌었다면
 * 남의 예약을 지우려는 셈이라 슬랙이 거절하는데, 그 사유가 그대로 화면에 선다.
 */
export async function cancelNoticeReservation(
  reservationId: string,
  now: Date = new Date(),
): Promise<CancelNoticeResult> {
  const row = await prisma.noticeReservation.findUnique({
    where: { id: reservationId },
    select: {
      slackMessageId: true,
      channelId: true,
      postAt: true,
      // 안내문이 아니라 기수의 챌린지에서 계정을 찾는다. 공지방 글은 챌린지가 없고,
      // 걸 때도 그 기수의 챌린지 계정으로 걸었다.
      program: {
        select: {
          challenge: { select: { slackSender: { select: { token: true } } } },
        },
      },
    },
  });

  if (!row) return { ok: false, failure: "이미 사라진 예약입니다." };

  /*
   * 발송 시각이 지난 예약은 이미 나간 글이다. 거둘 것이 없을뿐더러, 줄을 지우면 목록에서
   * 나간 기록이 사라지고 "아직 걸리지 않은" 안내문으로 되돌아간다. 화면이 열려 있는 사이
   * 시각이 지나 버튼이 남아 있던 경우라 여기서 한 번 더 막는다.
   */
  if (row.slackMessageId !== null && isSent(row.postAt, now)) {
    return { ok: false, failure: "이미 발송된 안내문이라 취소할 수 없습니다." };
  }

  // 못 걸린 줄은 슬랙에 거둘 것이 없다. 줄만 치운다.
  if (row.slackMessageId !== null && row.channelId !== null) {
    const token = row.program.challenge.slackSender?.token;
    if (!token) {
      return {
        ok: false,
        failure:
          "이 챌린지에 보내는 슬랙 계정이 없어 예약을 거둘 수 없습니다. 계정을 고른 뒤 다시 시도하세요.",
      };
    }

    try {
      await deleteScheduledSlackMessage({
        token,
        channel: row.channelId,
        scheduledMessageId: row.slackMessageId,
      });
    } catch (error) {
      // 슬랙에 남아 있는데 우리 줄만 지우면 두 통이 나간다. 줄을 남긴 채 사유를 돌려준다.
      return {
        ok: false,
        failure:
          error instanceof Error ? error.message : "예약을 거두지 못했습니다.",
      };
    }
  }

  await prisma.noticeReservation.delete({ where: { id: reservationId } });

  return { ok: true };
}

// ── 운영 화면이 읽는 것 ─────────────────────────────────────────────────────

/** 걸린 예약 한 건. */
export type ReservedNotice = {
  reservationId: string;
  title: string;
  placement: NoticePlacement;
  /** 어느 채널로 걸린 글인지 목록에서 가린다. */
  audience: NoticeAudience;
  postAt: Date;
  /**
   * 누구 이름으로 나가는지. 그 사람 이름으로 참여자에게 보이므로 목록에서 읽혀야 한다.
   *
   * **슬랙에서 그 사람이 고치고 지울 수 있다는 뜻은 아니다.** API 로 건 예약은 슬랙
   * 화면에 뜨지 않는다(plan.md §5 의 2026-09-13 정정). 거두는 자리는 이 목록의 `취소` 다.
   */
  senderName: string | null;
  /**
   * 발송 시각이 지났는지. 지났으면 이미 나간 글이라 거둘 수 없다.
   *
   * **슬랙에 물어 확인한 것이 아니라 시각으로 가른 것이다.** 슬랙은 걸어둔 시각에 알아서
   * 보내고 결과를 우리에게 알려주지 않는다. 그 사이 보내는 사람이 채널에서 빠졌다면
   * 나가지 않았을 수도 있다.
   */
  sent: boolean;
};

/** 발송 시각이 지난 예약은 나간 것으로 본다. */
function isSent(postAt: Date | null, now: Date): boolean {
  return postAt !== null && postAt.getTime() <= now.getTime();
}

/** 못 걸린 한 건. 시각은 계산조차 못 한 경우가 있어 비어 있을 수 있다. */
export type FailedNotice = {
  reservationId: string;
  title: string;
  placement: NoticePlacement;
  audience: NoticeAudience;
  postAt: Date | null;
  failure: string;
};

/** 한 기수의 예약 현황. */
export type ProgramReservations = {
  programId: string;
  challengeName: string;
  cohort: number;
  startDate: DateOnly;
  /** 이 기수에 적힌 슬랙 안내문(참여자 · 챌린지 공지방) 수. 0 이면 걸 것이 애초에 없다. */
  noticeCount: number;
  /**
   * 걸린 예약 수. 나간 것까지 센다 — `reserved` 는 나간 지 5분 지난 줄이 빠져 있어
   * 그것으로 세면 기수가 돌수록 `걸린 건/적힌 건` 이 줄어드는 것처럼 읽힌다.
   */
  placedCount: number;
  /** 목록에 서는 예약. 나간 지 5분이 지난 것은 빠진다. */
  reserved: ReservedNotice[];
  failed: FailedNotice[];
  /**
   * 아직 크론이 이 기수를 보지 않았는지. 예약을 거는 창(시작 4일 전)에 들어왔는데
   * 줄이 하나도 없으면 크론이 안 돌았다는 뜻이라, 빈 목록과 갈라 보여준다.
   *
   * **이미 시작한 기수는 여기 들지 않는다.** 그 기수는 창을 지나가 버려 다음 크론이
   * 걸어줄 것이 없는데, `곧 걸립니다` 라고 적으면 오지 않을 것을 기다리게 한다.
   */
  awaiting: boolean;
};

/**
 * 못 걸린 줄을 기수 시작 뒤 며칠까지 남길지. 크론은 시작 전 기수만 다시 보므로 시작한
 * 기수의 못 걸린 줄은 더 풀리지 않는다 — 무엇이 안 나갔는지 확인할 만큼만 둔다.
 */
const KEEP_PAST_DAYS = 7;

/**
 * 나간 예약을 발송 시각 뒤 몇 분까지 목록에 남길지. 방금 나간 것이 `발송됨` 으로 바뀐 것을
 * 확인할 틈만 두고 치운다 — 나간 글이 쌓이면 아직 나갈 것이 묻힌다.
 */
const SENT_VISIBLE_MS = 5 * 60 * 1000;

/**
 * 프로그램 운영 화면이 읽는 예약 현황. 걸린 예약은 **기수의 것**이라 챌린지 하나를 보는
 * 안내문 화면이 아니라 여기서 본다(plan.md §5).
 *
 * 걸린 예약은 **한 줄씩** 사라진다 — 발송 시각에서 5분이 지나면 빠진다. 기수 단위로
 * 치우면 한 달을 도는 기수의 아직 나갈 회차 · 수료 안내가 운영 도중에 사라져, 보지도
 * 거두지도 못하게 된다. 못 걸린 줄만 기수 시작일을 기준으로 남긴다.
 */
export async function listNoticeReservations(
  today: DateOnly = todayInKorea(),
  now: Date = new Date(),
): Promise<ProgramReservations[]> {
  const from = addDays(today, -KEEP_PAST_DAYS);
  const window = addDays(today, RESERVE_DAYS_BEFORE_START);
  const sentCutoff = new Date(now.getTime() - SENT_VISIBLE_MS);
  // 공지방 글은 어느 챌린지의 기수에든 함께 걸리므로 모든 기수의 건수에 더한다.
  const announcementCount = await prisma.programNotice.count({
    where: { challengeId: null, audience: "ANNOUNCEMENT" },
  });

  const programs = await prisma.program.findMany({
    // 거는 쪽과 같은 눈으로 본다. 한쪽만 되짚은 기수를 빼면 걸린 예약이 화면에서 사라진다.
    where: {
      OR: [
        { startDate: { gte: toDate(from) } },
        // 시작한 지 오래된 기수라도 아직 나갈(또는 방금 나간) 예약이 있으면 본다.
        {
          noticeReservations: {
            some: { slackMessageId: { not: null }, postAt: { gt: sentCutoff } },
          },
        },
      ],
    },
    orderBy: [{ startDate: "asc" }, { cohort: "asc" }],
    select: {
      id: true,
      cohort: true,
      startDate: true,
      challenge: {
        select: {
          name: true,
          notices: {
            where: { audience: { in: [...SCHEDULED_AUDIENCES] } },
            select: { id: true },
          },
        },
      },
      noticeReservations: {
        orderBy: { postAt: "asc" },
        select: {
          id: true,
          postAt: true,
          senderName: true,
          slackMessageId: true,
          failure: true,
          notice: {
            select: { title: true, audience: true, missionSeq: true, phase: true },
          },
        },
      },
    },
  });

  return programs
    .map((program) => {
      const startDate = toDateOnly(program.startDate);

      const reserved = program.noticeReservations.flatMap((row) =>
        row.slackMessageId !== null &&
        row.postAt !== null &&
        row.postAt.getTime() > sentCutoff.getTime()
          ? [
              {
                reservationId: row.id,
                title: row.notice.title,
                placement: toPlacement(row.notice),
                audience: row.notice.audience,
                postAt: row.postAt,
                senderName: row.senderName,
                sent: isSent(row.postAt, now),
              },
            ]
          : [],
      );

      const failed = program.noticeReservations.flatMap((row) =>
        row.slackMessageId === null && startDate >= from
          ? [
              {
                reservationId: row.id,
                title: row.notice.title,
                placement: toPlacement(row.notice),
                audience: row.notice.audience,
                postAt: row.postAt,
                failure: row.failure ?? "예약하지 못했습니다.",
              },
            ]
          : [],
      );

      const noticeCount = program.challenge.notices.length + announcementCount;

      return {
        programId: program.id,
        challengeName: program.challenge.name,
        cohort: program.cohort,
        startDate,
        noticeCount,
        placedCount: program.noticeReservations.filter((row) => row.slackMessageId !== null)
          .length,
        reserved,
        failed,
        awaiting:
          program.noticeReservations.length === 0 &&
          noticeCount > 0 &&
          startDate >= today &&
          startDate <= window,
      };
    })
    // 걸 것도 없고 걸린 것도 없는 기수는 목록에 올리지 않는다. 빈 줄만 는다.
    .filter((row) => row.reserved.length > 0 || row.failed.length > 0 || row.awaiting);
}

import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { parseWeekParam, weekRange, type WeekEvent } from "@/domain/calendar-week";
import { formatKoreanDateTime } from "@/domain/date";
import {
  describeConnectResult,
  getGoogleConnectionStatus,
  GoogleCalendarError,
  isGoogleOAuthConfigured,
  type CalendarSummary,
  listCalendars,
  listEventsBetween,
  TESTING_APP_EXPIRY_NOTE,
} from "@/domain/google-calendar";
import { getRunningTimer } from "@/domain/work-timer";

import { ConnectNotice, DisconnectButton, ExecutionPanel } from "./execution-panel";
import type { TimerView } from "./timer-panel";

export const metadata: Metadata = { title: "업무 수행 · LetsOperation" };

// 일정은 구글에 있고 다른 사람이 방금 고쳤을 수 있다. 타이머도 다른 기기에서 켜고 껐을 수 있다.
export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * 연결한 구글 캘린더를 주 단위로 보고, 일정을 적고, 타이머로 한 일을 일정으로 남기는 곳
 * (plan.md §5 — 업무 수행). 보고 있는 주는 주소(`?week=`)에 둔다 — 새로 고쳐도, 링크를
 * 건네도 같은 주가 선다.
 */
export default async function ExecutionPage({ searchParams }: PageProps<"/calendar/execution">) {
  const params = await searchParams;
  const weekStart = parseWeekParam(one(params.week));
  const notice = describeConnectResult(one(params.google));

  return (
    <>
      <PageHeader
        title="업무 수행"
        description="연결한 구글 캘린더를 주 단위로 보고 일정을 적습니다. 타이머로 잰 시간은 끝낼 때 그대로 일정이 됩니다."
      />
      <Toaster position="top-center" />
      <ConnectNotice notice={notice} />
      <ExecutionBody weekStart={weekStart} />
    </>
  );
}

async function ExecutionBody({ weekStart }: { weekStart: string }) {
  const configured = isGoogleOAuthConfigured();
  const status = await getGoogleConnectionStatus();

  if (!configured) return <SetupCard />;
  if (status.state === "none") return <ConnectCard />;
  if (status.state === "disconnected") {
    return (
      <ReconnectCard
        email={status.email}
        reason={status.reason}
        disconnectedAt={status.disconnectedAt}
      />
    );
  }

  const loaded = await loadWeek(weekStart);
  if (loaded.ok) {
    return (
      <ExecutionPanel
        email={status.email}
        weekStart={weekStart}
        calendars={loaded.calendars}
        events={loaded.events}
        failedCalendars={loaded.failedCalendars}
        timer={loaded.timer}
        serverNow={loaded.serverNow}
      />
    );
  }

  // 읽는 도중 구글이 갱신 토큰을 거절했으면 domain 이 끊긴 상태로 적어 두었다.
  const latest = await getGoogleConnectionStatus();
  if (latest.state === "disconnected") {
    return (
      <ReconnectCard
        email={latest.email}
        reason={latest.reason}
        disconnectedAt={latest.disconnectedAt}
      />
    );
  }

  return (
    <section className="border-border space-y-3 rounded-lg border p-6">
      <p className="text-sm font-medium">구글 캘린더를 읽지 못했습니다.</p>
      <p className="text-muted-foreground text-sm">{loaded.message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/calendar/execution">다시 불러오기</Link>
        </Button>
        {latest.state === "connected" ? <DisconnectButton email={latest.email} /> : null}
      </div>
    </section>
  );
}

type LoadedWeek =
  | {
      ok: true;
      calendars: CalendarSummary[];
      events: WeekEvent[];
      failedCalendars: string[];
      timer: TimerView | null;
      serverNow: string;
    }
  | { ok: false; message: string };

/**
 * 한 주의 일정과 돌고 있는 타이머. 구글 쪽 실패는 사람이 읽을 사유로 돌려준다 — 그 밖의
 * 실패(DB 등)는 그대로 던져 Next 의 오류 화면에 맡긴다.
 */
async function loadWeek(weekStart: string): Promise<LoadedWeek> {
  try {
    const { timeMin, timeMax } = weekRange(weekStart);
    const calendars = await listCalendars();
    const [{ events, failedCalendars }, timer] = await Promise.all([
      listEventsBetween(calendars, timeMin, timeMax),
      getRunningTimer(),
    ]);
    return {
      ok: true,
      calendars,
      events,
      failedCalendars,
      timer: timer
        ? {
            startedAt: timer.startedAt.toISOString(),
            title: timer.title,
            endingAt: timer.endingAt?.toISOString() ?? null,
          }
        : null,
      // 타이머 경과 시간을 기기 시계가 아니라 서버 시각에 맞추는 기준(timer-panel).
      serverNow: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof GoogleCalendarError) return { ok: false, message: error.message };
    throw error;
  }
}

/** 환경변수가 없을 때. 무엇을 어디서 받아 어디에 적는지까지 적는다 — 이 화면을 처음 여는 사람이 할 일이다. */
function SetupCard() {
  return (
    <section className="border-border space-y-3 rounded-lg border p-6">
      <p className="text-sm font-medium">구글 캘린더 연결 준비가 필요합니다.</p>
      <p className="text-muted-foreground text-sm">
        환경변수 <code className="bg-muted rounded px-1">GOOGLE_CLIENT_ID</code> ·{" "}
        <code className="bg-muted rounded px-1">GOOGLE_CLIENT_SECRET</code> 이 설정되지 않았습니다.
      </p>
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
        <li>구글 클라우드 콘솔에서 프로젝트를 만들고 Google Calendar API 를 사용 설정합니다.</li>
        <li>OAuth 동의 화면을 외부 · 테스트로 만들고 테스트 사용자에 연결할 Gmail 을 넣습니다.</li>
        <li>
          OAuth 클라이언트(웹 애플리케이션)를 만들고 승인된 리디렉션 URI 에{" "}
          <code className="bg-muted rounded px-1">http://localhost:3000/api/google/callback</code> 과{" "}
          <code className="bg-muted rounded px-1">
            https://letscareer-operation.vercel.app/api/google/callback
          </code>{" "}
          을 넣습니다.
        </li>
        <li>받은 클라이언트 ID · 보안 비밀을 .env.local 과 Vercel 환경변수에 적고 다시 배포합니다.</li>
      </ol>
      <p className="text-muted-foreground text-xs">자세한 설명은 .env.example 에 있습니다.</p>
    </section>
  );
}

function ConnectCard() {
  return (
    <section className="border-border space-y-3 rounded-lg border p-6">
      <p className="text-sm font-medium">연결된 구글 캘린더가 없습니다.</p>
      <p className="text-muted-foreground text-sm">
        구글 계정 하나를 연결하면 그 계정의 캘린더를 이 화면에서 보고 일정을 적을 수 있습니다.
        팀 공용 화면이라 연결한 계정의 일정이 팀원에게도 보입니다.
      </p>
      <p className="text-muted-foreground text-xs">{TESTING_APP_EXPIRY_NOTE}</p>
      {/* 라우트 핸들러가 구글로 보내는 자리라 클라이언트 이동(Link)이 아니라 문서 이동이어야 한다. */}
      <Button asChild>
        <a href="/api/google/connect">구글 캘린더 연결</a>
      </Button>
    </section>
  );
}

function ReconnectCard({
  email,
  reason,
  disconnectedAt,
}: {
  email: string;
  reason: string;
  disconnectedAt: Date;
}) {
  return (
    <section className="border-border space-y-3 rounded-lg border p-6">
      <p className="text-sm font-medium">구글 캘린더 연결이 끊겼습니다.</p>
      <p className="text-muted-foreground text-sm">
        {email} · {formatKoreanDateTime(disconnectedAt)} 에 끊김
      </p>
      <p className="text-muted-foreground text-sm">{reason}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <a href="/api/google/connect">다시 연결</a>
        </Button>
        <DisconnectButton email={email} />
      </div>
    </section>
  );
}

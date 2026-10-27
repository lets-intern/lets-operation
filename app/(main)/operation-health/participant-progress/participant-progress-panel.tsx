"use client";

import { cn } from "cn";
import { ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { useActionState, useDeferredValue, useMemo, useState } from "react";

import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MISC_TYPE, PASS_SCORE, WARN_DROP, type CohortView, type RoundView } from "@/domain/participant-progress";
import type { ParticipantProgressSnapshot } from "@/domain/service-participant-progress";

import { syncParticipantProgressAction, type ParticipantProgressSyncState } from "./actions";

const INITIAL_SYNC_STATE: ParticipantProgressSyncState = { error: null, result: null, at: 0 };

/** 관리자 화면의 챌린지 운영 화면. 경로의 숫자가 challenge_id 다. */
function adminUrl(challengeId: number): string {
  return `https://admin.letscareer.co.kr/challenge/operation/${challengeId}/home`;
}

type StatusFilter = "all" | "progress" | "done" | "warn";

/** 비교에 한 번에 놓는 기수 수. 이보다 많으면 칸이 좁아 숫자를 못 읽는다. */
const MAX_PICKED = 6;

function formatDateTime(iso: string): string {
  // 서버(UTC)와 브라우저가 같은 글을 그려야 hydration 이 어긋나지 않는다.
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `2026-10-12` · `2026-10-12 23:59:59` → `10/12` */
function shortDate(text: string): string {
  const [, month, day] = text.slice(0, 10).split("-");
  return `${Number(month)}/${Number(day)}`;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function ratio(part: number, whole: number): string {
  return whole > 0 ? pct((100 * part) / whole) : "–";
}

function closedRounds(cohort: CohortView): RoundView[] {
  return cohort.rounds.filter((round) => round.closed);
}

function StatusBadge({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium",
        done ? "bg-muted text-muted-foreground" : "bg-blue-100 text-blue-800",
      )}
    >
      {done ? "완료" : "진행 중"}
    </span>
  );
}

function WarnBadge({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[11px] leading-none font-medium text-red-800">
      경고 {count}
    </span>
  );
}

/** 진행 중을 먼저, 그 안에서는 경고가 많은 기수를 위로 세운다. 나머지는 시작일 최신순이다. */
function compareCohorts(a: CohortView, b: CohortView): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (!a.done && a.warnings !== b.warnings) return b.warnings - a.warnings;
  return b.startDate.localeCompare(a.startDate) || b.id - a.id;
}

export function ParticipantProgressPanel({ snapshot }: { snapshot: ParticipantProgressSnapshot }) {
  const { cohorts, queryRetrievedAt } = snapshot;
  const [syncState, syncAction, syncing] = useActionState(syncParticipantProgressAction, INITIAL_SYNC_STATE);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<StatusFilter>("progress");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** 비교에 고른 기수. 고른 순서대로 칸을 세운다. */
  const [pickedIds, setPickedIds] = useState<number[]>([]);

  const sorted = useMemo(() => [...cohorts].sort(compareCohorts), [cohorts]);
  const searched = useMemo(() => {
    const needle = deferredQuery.replace(/\s+/g, "").toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((cohort) => cohort.title.replace(/\s+/g, "").toLowerCase().includes(needle));
  }, [sorted, deferredQuery]);

  const counts = useMemo(
    () => ({
      all: searched.length,
      progress: searched.filter((cohort) => !cohort.done).length,
      done: searched.filter((cohort) => cohort.done).length,
      warn: searched.filter((cohort) => !cohort.done && cohort.warnings > 0).length,
    }),
    [searched],
  );

  const listed = useMemo(
    () =>
      searched.filter((cohort) =>
        status === "all"
          ? true
          : status === "progress"
            ? !cohort.done
            : status === "done"
              ? cohort.done
              : !cohort.done && cohort.warnings > 0,
      ),
    [searched, status],
  );

  const active = listed.find((cohort) => cohort.id === selectedId) ?? listed[0] ?? null;
  // 찾기 · 칩으로 목록에서 사라져도 비교에는 남긴다.
  const picked = useMemo(
    () => pickedIds.flatMap((id) => cohorts.find((cohort) => cohort.id === id) ?? []),
    [pickedIds, cohorts],
  );
  const pickFull = picked.length >= MAX_PICKED;
  // 다시 불러와 사라진 기수는 이때 걷어낸다 — 보이지 않는 칸이 한도를 차지하지 않게.
  const togglePicked = (id: number) =>
    setPickedIds((ids) => {
      const live = ids.filter((other) => cohorts.some((cohort) => cohort.id === other));
      if (live.includes(id)) return live.filter((other) => other !== id);
      return live.length < MAX_PICKED ? [...live, id] : live;
    });
  const comparing = picked.length >= 2;
  const progressTotal = cohorts.filter((cohort) => !cohort.done).length;
  const warnTotal = cohorts.filter((cohort) => !cohort.done && cohort.warnings > 0).length;

  return (
    <div className="flex flex-col gap-4">
      {/* 불러오기 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm">
        <form action={syncAction}>
          <Button type="submit" variant="outline" size="sm" disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
            {syncing ? "불러오는 중…" : "수행 현황 불러오기"}
          </Button>
        </form>
        <span className="text-muted-foreground">
          {queryRetrievedAt
            ? `Redash ${formatDateTime(queryRetrievedAt)} 기준 · 진행 중 ${progressTotal}기수` +
              (warnTotal > 0 ? `(경고 ${warnTotal}기수)` : "") +
              ` · 완료 ${cohorts.length - progressTotal}기수`
            : "아직 불러온 적이 없습니다"}
        </span>
      </div>

      {syncState.error ? (
        <p className="text-destructive text-sm">{syncState.error}</p>
      ) : syncState.result ? (
        <p className="text-muted-foreground text-sm">
          {syncState.result.cohorts}기수 · 참여자 {syncState.result.participants}명을 받았습니다.
          {syncState.result.testChallenges > 0 ? ` 테스트 챌린지 ${syncState.result.testChallenges}개는 뺐습니다.` : ""}
          {syncState.result.noUser > 0 ? ` 사용자가 없는 신청 ${syncState.result.noUser}줄은 세지 않았습니다.` : ""}
          {syncState.result.skipped > 0 ? (
            <span className="text-destructive">
              {` 챌린지 · 미션 · 날짜를 읽지 못한 ${syncState.result.skipped}줄은 빠졌습니다 — 쿼리 344 를 확인하세요.`}
            </span>
          ) : null}
        </p>
      ) : null}

      {/* 찾기 · 거르기 */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-col gap-2 border-b py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="챌린지 이름에서 찾기"
              className="pl-8"
              aria-label="챌린지 이름에서 찾기"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="진행 상태">
            <FilterChip label="진행 중" count={counts.progress} active={status === "progress"} onClick={() => setStatus("progress")} />
            <FilterChip label="진행 중 경고" count={counts.warn} active={status === "warn"} onClick={() => setStatus("warn")} />
            <FilterChip label="완료" count={counts.done} active={status === "done"} onClick={() => setStatus("done")} />
            <FilterChip label="전체" count={counts.all} active={status === "all"} onClick={() => setStatus("all")} />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          기준 달성은 {PASS_SCORE}점 이상 + OT · 보너스를 뺀 모든 회차 제출(지각 포함, 반려는 미제출)입니다. 경고는
          지난 3개 기수의 같은 회차 평균(없으면 전체 기수의 같은 순서 회차 중앙값)보다 제출률이 {WARN_DROP}%p 이상 낮은
          회차입니다. 목록의 체크박스로 2–{MAX_PICKED}기수를 고르면 나란히 비교합니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[26rem_minmax(0,1fr)]">
        {/* 목록 */}
        <ul className="flex max-h-[calc(100vh-18rem)] min-w-0 flex-col divide-y overflow-y-auto rounded-lg border">
          {listed.length === 0 ? (
            <li className="text-muted-foreground p-4 text-sm">
              {cohorts.length === 0 ? "수행 현황 불러오기를 눌러 미션 제출을 받아오세요." : "조건에 맞는 기수가 없습니다."}
            </li>
          ) : null}
          {listed.map((cohort) => {
            const closed = closedRounds(cohort);
            const last = closed.at(-1);
            const isPicked = pickedIds.includes(cohort.id);
            return (
              <li key={cohort.id} className="flex items-stretch">
                <label
                  className={cn(
                    "flex shrink-0 items-start py-3 pl-2.5",
                    !isPicked && pickFull ? "cursor-not-allowed opacity-50" : "hover:bg-muted cursor-pointer",
                  )}
                  title={!isPicked && pickFull ? `최대 ${MAX_PICKED}기수까지 비교합니다` : "비교에 넣기"}
                >
                  <input
                    type="checkbox"
                    checked={isPicked}
                    disabled={!isPicked && pickFull}
                    onChange={() => togglePicked(cohort.id)}
                    aria-label={`${cohort.title} 비교에 넣기`}
                  />
                </label>
                <button
                  type="button"
                  // 비교 중에는 줄을 눌러도 비교에 넣고 뺀다 — 오른쪽이 상세가 아니다.
                  onClick={() => (comparing ? togglePicked(cohort.id) : setSelectedId(cohort.id))}
                  disabled={comparing && !isPicked && pickFull}
                  className={cn(
                    "hover:bg-muted flex min-w-0 flex-1 flex-col items-start gap-1 p-2.5 text-left text-sm disabled:cursor-not-allowed",
                    (comparing ? isPicked : cohort.id === active?.id) && "bg-muted",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <StatusBadge done={cohort.done} />
                    <span className="min-w-0 flex-1 truncate font-medium" title={cohort.title}>
                      <Highlight text={cohort.title} query={deferredQuery} />
                    </span>
                    {cohort.warnings > 0 ? <WarnBadge count={cohort.warnings} /> : null}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs tabular-nums">
                    {shortDate(cohort.startDate)}–{shortDate(cohort.endDate)} · {cohort.participants}명 · 마감{" "}
                    {closed.length}/{cohort.rounds.length}회차
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs tabular-nums">
                    {last ? `${last.th}회차 제출 ${pct(last.rate)}` : "마감된 회차 없음"}
                    {cohort.done
                      ? ` · 기준 달성 ${ratio(cohort.achieved, cohort.participants)}`
                      : ` · 탈락 확정 ${cohort.eliminated}명`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* 기수 보기 · 비교 */}
        <section className="flex min-w-0 flex-col gap-3">
          {comparing ? (
            <CohortCompare
              cohorts={picked}
              onRemove={togglePicked}
              onClear={() => setPickedIds([])}
            />
          ) : active ? (
            <CohortDetail key={active.id} cohort={active} />
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 기수를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
        count === 0 && !active && "text-muted-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

const SEGMENTS = [
  { key: "on", label: "정시", className: "bg-blue-700" },
  { key: "late", label: "지각", className: "bg-blue-300" },
  { key: "rejected", label: "반려", className: "bg-orange-400" },
  { key: "missing", label: "미제출", className: "bg-muted" },
] as const;

function CohortDetail({ cohort }: { cohort: CohortView }) {
  const closed = closedRounds(cohort);
  const n = cohort.participants;
  const comparison =
    cohort.type === MISC_TYPE
      ? "멘토링 · 스터디 묶음이라 비교하지 않음"
      : closed.some((round) => round.baseSource === "prior")
        ? "지난 3개 기수와 비교"
        : closed.some((round) => round.baseSource === "order")
          ? "지난 기수가 모자라 전체 기수 중앙값과 비교"
          : null;
  const histogramMax = Math.max(1, ...cohort.histogram);
  const histogramTotal = cohort.histogram.reduce((sum, value) => sum + value, 0);

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge done={cohort.done} />
          <h2 className="text-base font-semibold">{cohort.title}</h2>
          {cohort.warnings > 0 ? <WarnBadge count={cohort.warnings} /> : null}
          <a
            href={adminUrl(cohort.id)}
            target="_blank"
            rel="noreferrer"
            className="text-primary ml-auto inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            관리자 화면 <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {cohort.startDate} ~ {cohort.endDate} · 참여 {n}명(취소 · 환불 · 테스트 계정 제외) · 마감 {closed.length}/
          {cohort.rounds.length}회차{comparison ? ` · ${comparison}` : ""}
        </p>
      </div>

      {/* 요약 */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border px-4 py-3 text-sm sm:grid-cols-4">
        {cohort.done ? (
          <>
            <Stat label="기준 달성" value={`${cohort.achieved}명`} sub={ratio(cohort.achieved, n)} />
            <Stat label="기준 미달" value={`${n - cohort.achieved}명`} sub={ratio(n - cohort.achieved, n)} />
          </>
        ) : (
          <>
            <Stat
              label="기준 달성 가능"
              value={`${n - cohort.eliminated}명`}
              sub={ratio(n - cohort.eliminated, n)}
              title="최종 반려된 회차가 없고, 남은 회차를 다 내면 80점에 닿는 사람"
            />
            <Stat
              label="탈락 확정"
              value={`${cohort.eliminated}명`}
              sub={ratio(cohort.eliminated, n)}
              title="최종 반려된 회차가 있거나, 남은 회차를 다 내도 80점이 안 되는 사람. 마감이 지난 회차도 지각으로 낼 수 있다고 본다."
            />
          </>
        )}
        <Stat label="경고 회차" value={`${cohort.warnings}개`} sub={`마감 ${closed.length}회차 중`} />
        <Stat
          label="최근 마감 회차 제출"
          value={closed.at(-1) ? pct(closed.at(-1)!.rate) : "–"}
          sub={closed.at(-1) ? `${closed.at(-1)!.th}회차` : "마감 전"}
        />
      </dl>

      {/* 회차별 제출 */}
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">회차별 제출</h3>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            {SEGMENTS.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1">
                <span className={cn("size-2.5 rounded-sm", segment.className, segment.key === "missing" && "border")} />
                {segment.label}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">회차</th>
                <th className="py-1.5 pr-3 text-left font-normal">제출 상태</th>
                <th className="py-1.5 pr-2 text-right font-normal">제출률</th>
                <th className="py-1.5 pr-2 text-right font-normal">지난 3기수 평균값</th>
                <th className="py-1.5 pr-2 text-right font-normal">정시</th>
                <th className="py-1.5 pr-2 text-right font-normal">지각</th>
                <th className="py-1.5 text-right font-normal">미제출</th>
              </tr>
            </thead>
            <tbody>
              {cohort.rounds.map((round) => (
                <RoundRow key={round.th} round={round} participants={n} />
              ))}
            </tbody>
          </table>
        </div>
        {closed.some((round) => round.baseSource === "order") ? (
          <p className="text-muted-foreground text-xs">
            * 같은 회차가 마감된 지난 기수가 셋이 안 돼 전체 기수에서 같은 순서 회차의 중앙값을 적었습니다.
          </p>
        ) : null}
        {cohort.extras.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {cohort.extras
              .map((extra) => `${extra.label}${extra.closed ? ` 제출 ${pct(extra.rate)}` : " 마감 전"}`)
              .join(" · ")}{" "}
            — 기준 계산과 경고에서 뺍니다.
          </p>
        ) : null}
      </div>

      {/* 점수 분포 */}
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">점수 분포</h3>
          <span className="text-muted-foreground text-xs">
            {cohort.done ? "최종 점수 · 10점 구간" : "마감 회차 배점 대비 비율 · 10점 구간"}
          </span>
        </div>
        {histogramTotal === 0 ? (
          <p className="text-muted-foreground text-sm">
            {closed.length === 0 ? "아직 마감된 회차가 없어 점수가 없습니다." : "마감된 회차에 배점이 없어 점수가 없습니다."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex h-28 items-end gap-1.5 border-b">
              {cohort.histogram.map((count, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex h-full flex-1 flex-col items-center justify-end gap-0.5",
                    index === PASS_SCORE / 10 && "border-l border-dashed border-foreground/40 pl-1.5",
                  )}
                  title={`${index * 10}${index === 9 ? " 이상" : `–${index * 10 + 9}`}: ${count}명`}
                >
                  <span className="text-muted-foreground text-[11px] tabular-nums">{count > 0 ? count : ""}</span>
                  <div
                    className={cn("w-full max-w-8 rounded-t-sm", index >= PASS_SCORE / 10 ? "bg-blue-700" : "bg-muted-foreground/40")}
                    style={{ height: `${(count / histogramMax) * 80}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              {cohort.histogram.map((_, index) => (
                <span
                  key={index}
                  className={cn(
                    "text-muted-foreground flex-1 text-center text-[11px] tabular-nums",
                    index === PASS_SCORE / 10 && "pl-1.5",
                  )}
                >
                  {index === 9 ? "90+" : index * 10}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub, title }: { label: string; value: string; sub: string; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium tabular-nums">
        {value} <span className="text-muted-foreground text-xs font-normal">{sub}</span>
      </dd>
    </div>
  );
}

function RoundRow({ round, participants }: { round: RoundView; participants: number }) {
  const label = (
    <td className="py-1.5 pr-2 whitespace-nowrap">
      {round.th}회차
      {round.paired ? <span className="text-muted-foreground ml-1 text-[11px]">택1</span> : null}
    </td>
  );

  if (!round.closed) {
    return (
      <tr className="text-muted-foreground border-b last:border-b-0">
        {label}
        <td className="py-1.5 pr-3 text-xs" colSpan={6}>
          {shortDate(round.due)} 마감 전
        </td>
      </tr>
    );
  }

  const diff = round.base !== null ? round.rate - round.base : null;
  return (
    <tr className={cn("border-b last:border-b-0", round.warn && "bg-red-50")}>
      {label}
      <td className="py-1.5 pr-3">
        <div
          className="flex h-3 w-full min-w-40 overflow-hidden rounded-sm border"
          title={`정시 ${round.on} · 지각 ${round.late} · 반려 ${round.rejected} · 미제출 ${round.missing}명`}
        >
          {SEGMENTS.map((segment) => {
            const count = round[segment.key];
            return count > 0 ? (
              <div key={segment.key} className={segment.className} style={{ width: `${(100 * count) / participants}%` }} />
            ) : null;
          })}
        </div>
      </td>
      <td className={cn("py-1.5 pr-2 text-right tabular-nums", round.warn && "font-medium text-red-700")}>
        {pct(round.rate)}
      </td>
      <td
        className="text-muted-foreground py-1.5 pr-2 text-right text-xs whitespace-nowrap tabular-nums"
        title={
          round.baseSource === "prior"
            ? "같은 챌린지 지난 3개 기수의 같은 회차 평균"
            : round.baseSource === "order"
              ? "전체 기수에서 같은 순서 회차의 중앙값"
              : undefined
        }
      >
        {round.base !== null && diff !== null ? (
          <>
            {pct(round.base)}
            {round.baseSource === "order" ? "*" : ""}{" "}
            <span className={cn(round.warn && "text-red-700")}>
              ({diff >= 0 ? "+" : ""}
              {Math.round(diff)}%p)
            </span>
          </>
        ) : (
          "–"
        )}
      </td>
      <td className="py-1.5 pr-2 text-right whitespace-nowrap tabular-nums">{round.on}명</td>
      <td className="py-1.5 pr-2 text-right whitespace-nowrap tabular-nums">{round.late}명</td>
      <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
        {round.missing + round.rejected}명
        {round.rejected > 0 ? (
          <span className="text-muted-foreground ml-1 text-[11px]">반려 {round.rejected}</span>
        ) : null}
      </td>
    </tr>
  );
}

/** 고른 기수를 회차 번호로 맞춰 나란히 놓는다. 칸 순서는 고른 순서다. */
function CohortCompare({
  cohorts,
  onRemove,
  onClear,
}: {
  cohorts: CohortView[];
  onRemove: (id: number) => void;
  onClear: () => void;
}) {
  const ths = [...new Set(cohorts.flatMap((cohort) => cohort.rounds.map((round) => round.th)))].sort((a, b) => a - b);
  const byTh = cohorts.map((cohort) => new Map(cohort.rounds.map((round) => [round.th, round])));
  const totals = cohorts.map((cohort) => cohort.histogram.reduce((sum, value) => sum + value, 0));
  const mixed = cohorts.some((cohort) => cohort.done) && cohorts.some((cohort) => !cohort.done);
  // 높은 구간을 위에 둔다 — 80점 기준선이 표의 위쪽 두 줄을 가른다.
  const bins = Array.from({ length: 10 }, (_, index) => 9 - index);

  const header = (
    <thead className="text-muted-foreground text-xs">
      <tr className="border-b">
        <th className="py-1.5 pr-2 text-left font-normal">구분</th>
        {cohorts.map((cohort) => (
          <th key={cohort.id} className="min-w-36 px-2 py-1.5 text-left align-bottom font-normal">
            <span className="line-clamp-2 text-foreground font-medium" title={cohort.title}>
              {cohort.title}
            </span>
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{cohorts.length}기수 비교</h2>
          <button
            type="button"
            onClick={onClear}
            className="text-primary ml-auto text-xs font-medium underline-offset-2 hover:underline"
          >
            비교 해제
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {cohorts.map((cohort) => (
            <li key={cohort.id} className="flex items-center gap-2 text-sm">
              <StatusBadge done={cohort.done} />
              <span className="min-w-0 truncate font-medium" title={cohort.title}>
                {cohort.title}
              </span>
              {cohort.warnings > 0 ? <WarnBadge count={cohort.warnings} /> : null}
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {shortDate(cohort.startDate)}–{shortDate(cohort.endDate)} · {cohort.participants}명
              </span>
              <button
                type="button"
                onClick={() => onRemove(cohort.id)}
                className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded p-0.5"
                aria-label={`${cohort.title} 비교에서 빼기`}
                title="비교에서 빼기"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* 회차별 제출 비교 */}
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">회차별 제출</h3>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            {SEGMENTS.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1">
                <span className={cn("size-2.5 rounded-sm", segment.className, segment.key === "missing" && "border")} />
                {segment.label}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {header}
            <tbody>
              {ths.map((th) => (
                <tr key={th} className="border-b last:border-b-0">
                  <td className="py-1.5 pr-2 align-top whitespace-nowrap">{th}회차</td>
                  {cohorts.map((cohort, column) => {
                    const round = byTh[column].get(th);
                    return (
                      <td key={cohort.id} className={cn("px-2 py-1.5 align-top", round?.warn && "bg-red-50")}>
                        {!round ? (
                          <span className="text-muted-foreground text-xs">–</span>
                        ) : !round.closed ? (
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {shortDate(round.due)} 마감 전
                          </span>
                        ) : (
                          <CompareRoundCell round={round} participants={cohort.participants} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">
          회차 번호로 줄을 맞췄습니다. 미제출에는 반려를 넣었고, 경고 회차는 붉게 칠했습니다. OT · 보너스는 뺐습니다.
        </p>
      </div>

      {/* 점수 분포 비교 */}
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">점수 분포</h3>
          <span className="text-muted-foreground text-xs">
            {cohorts.every((cohort) => cohort.done)
              ? "최종 점수"
              : cohorts.every((cohort) => !cohort.done)
                ? "마감 회차 배점 대비 비율"
                : "완료는 최종 점수 · 진행 중은 마감 회차 배점 대비 비율"}{" "}
            · 10점 구간 · 점수가 있는 인원 대비 비율
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {header}
            <tbody>
              {bins.map((bin) => (
                <tr
                  key={bin}
                  className={cn(
                    "border-b last:border-b-0",
                    bin === PASS_SCORE / 10 && "border-b-foreground/40 border-b-2 border-dashed",
                  )}
                >
                  <td className="text-muted-foreground py-1 pr-2 text-xs whitespace-nowrap tabular-nums">
                    {bin === 9 ? "90 이상" : `${bin * 10}–${bin * 10 + 9}`}
                  </td>
                  {cohorts.map((cohort, column) => {
                    const total = totals[column];
                    const count = cohort.histogram[bin];
                    const share = total > 0 ? (100 * count) / total : 0;
                    return (
                      <td key={cohort.id} className="px-2 py-1">
                        {total === 0 ? (
                          <span className="text-muted-foreground text-xs">–</span>
                        ) : (
                          <div className="flex items-center gap-1.5" title={`${count}명 / ${total}명`}>
                            <div className="bg-muted h-2 w-12 shrink-0 overflow-hidden rounded-sm">
                              <div
                                className={cn("h-full", bin >= PASS_SCORE / 10 ? "bg-blue-700" : "bg-muted-foreground/40")}
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="tabular-nums">{pct(share)}</span>
                            <span className="text-muted-foreground text-[11px] tabular-nums">{count}명</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">
          참여 인원이 기수마다 달라 비율로 견줍니다. 점선 위가 {PASS_SCORE}점 이상입니다.
          {mixed
            ? " 끝난 기수는 최종 점수, 진행 중 기수는 마감 회차 배점 대비 비율이라 같은 잣대가 아닙니다."
            : ""}
          {totals.some((total) => total === 0) ? " 마감된 회차가 없는 기수는 비웠습니다." : ""}
        </p>
      </div>
    </>
  );
}

function CompareRoundCell({ round, participants }: { round: RoundView; participants: number }) {
  return (
    <div
      className="flex flex-col gap-1"
      title={`정시 ${round.on} · 지각 ${round.late} · 반려 ${round.rejected} · 미제출 ${round.missing}명`}
    >
      <span className={cn("tabular-nums", round.warn && "font-medium text-red-700")}>{pct(round.rate)}</span>
      <div className="flex h-1.5 w-full overflow-hidden rounded-sm border">
        {SEGMENTS.map((segment) => {
          const count = round[segment.key];
          return count > 0 ? (
            <div key={segment.key} className={segment.className} style={{ width: `${(100 * count) / participants}%` }} />
          ) : null;
        })}
      </div>
      <span className="text-muted-foreground text-[11px] whitespace-nowrap tabular-nums">
        정시 {round.on} · 지각 {round.late} · 미제출 {round.missing + round.rejected}
      </span>
    </div>
  );
}

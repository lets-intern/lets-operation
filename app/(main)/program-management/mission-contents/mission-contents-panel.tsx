"use client";

import { cn } from "cn";
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useActionState, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { NotionDocView, safeHref } from "@/components/notion-doc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  countDocHits,
  MISSION_CONTENT_KIND_LABELS,
  MISSION_CONTENT_SOURCE_LABELS,
  notionEditUrl,
  type MissionContentKind,
  type NotionDoc,
} from "@/domain/mission-content";
import type { MissionContentRow, MissionContentsSnapshot } from "@/domain/service-mission-content";

import { syncMissionContentsAction, type MissionContentSyncState } from "./actions";

const INITIAL_SYNC_STATE: MissionContentSyncState = { error: null, result: null, at: 0 };

/** 따로 받은 본문. version 은 받을 때 쓴 불러오기 시각이다. */
type LoadedDocs = { version: string | null; docs: Record<number, NotionDoc>; error: string | null };

/** 찾을 대상. 고른 챌린지의 콘텐츠만, 또는 모든 콘텐츠 */
type Scope = "challenge" | "all";

/** 콘텐츠가 쓰인 곳 한 건 */
type ContentUsePlace = {
  challengeId: number;
  challengeTitle: string;
  th: number;
  missionTitle: string;
  kind: MissionContentKind;
};

function formatDateTime(iso: string): string {
  // 서버(UTC)와 브라우저가 같은 글을 그려야 hydration 이 어긋나지 않는다.
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KindBadge({ kind }: { kind: MissionContentKind }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium",
        kind === "ESSENTIAL"
          ? "bg-blue-100 text-blue-800"
          : kind === "TEMPLATE"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-muted text-muted-foreground",
      )}
    >
      {MISSION_CONTENT_KIND_LABELS[kind]}
    </span>
  );
}

function HitBadge({ count }: { count: number }) {
  return <span className="shrink-0 rounded bg-yellow-200 px-1 text-xs font-medium text-black">{count}건</span>;
}

export function MissionContentsPanel({ snapshot }: { snapshot: MissionContentsSnapshot }) {
  const { contents, challenges, queryRetrievedAt, lastFetchedAt } = snapshot;
  const [syncState, syncAction, syncing] = useActionState(syncMissionContentsAction, INITIAL_SYNC_STATE);

  const contentById = useMemo(() => new Map(contents.map((content) => [content.id, content])), [contents]);

  // 본문은 첫 화면에 싣지 않고 따로 받는다(plan.md §5). 주소에 불러오기 시각을 붙여, 같은 시각이면
  // 브라우저가 남겨 둔 것을 쓰고 새로 불러오면 다시 받는다. 받는 동안에는 예전 본문을 그대로 쓴다.
  const docsVersion = lastFetchedAt ?? "";
  const [loadedDocs, setLoadedDocs] = useState<LoadedDocs>({ version: null, docs: {}, error: null });
  const docsLoading = docsVersion !== "" && loadedDocs.version !== docsVersion;
  const docs = loadedDocs.docs;

  useEffect(() => {
    if (!docsVersion) return;
    const controller = new AbortController();
    fetch(`/api/mission-contents/docs?v=${encodeURIComponent(docsVersion)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`본문을 받지 못했습니다(${response.status}). 새로고침해 주세요.`);
        const data = (await response.json()) as { docs: Record<number, NotionDoc> };
        setLoadedDocs({ version: docsVersion, docs: data.docs, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        setLoadedDocs((previous) => ({ version: docsVersion, docs: previous.docs, error: reason }));
      });
    return () => controller.abort();
  }, [docsVersion]);

  const usesByContent = useMemo(() => {
    const map = new Map<number, ContentUsePlace[]>();
    for (const challenge of challenges) {
      for (const mission of challenge.missions) {
        for (const item of mission.contents) {
          const places = map.get(item.contentId) ?? [];
          places.push({
            challengeId: challenge.id,
            challengeTitle: challenge.title,
            th: mission.th,
            missionTitle: mission.title,
            kind: item.kind,
          });
          map.set(item.contentId, places);
        }
      }
    }
    return map;
  }, [challenges]);

  // 고르지 않았거나 고른 것이 사라졌으면 첫 챌린지 · 첫 콘텐츠로 대신한다. 초기값으로 박아두면
  // 빈 상태에서 불러온 직후나 챌린지가 결과에서 빠졌을 때 목록이 빈 채로 남는다.
  const [selectedChallengeId, setChallengeId] = useState<number | null>(null);
  const challenge = challenges.find((candidate) => candidate.id === selectedChallengeId) ?? challenges[0] ?? null;
  const [scope, setScope] = useState<Scope>("challenge");
  const [onlyHits, setOnlyHits] = useState(true);
  const [selectedContentId, setActiveId] = useState<number | null>(null);
  const activeId = selectedContentId ?? challenge?.missions[0]?.contents[0]?.contentId ?? null;

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const challengeContentIds = useMemo(
    () => new Set(challenge?.missions.flatMap((mission) => mission.contents.map((item) => item.contentId)) ?? []),
    [challenge],
  );
  const targetIds = useMemo(
    () => (scope === "all" ? new Set(contents.map((content) => content.id)) : challengeContentIds),
    [scope, contents, challengeContentIds],
  );

  const hitCounts = useMemo(() => {
    const map = new Map<number, number>();
    if (!searching) return map;
    for (const id of targetIds) {
      const doc = docs[id];
      if (doc) map.set(id, countDocHits(doc, deferredQuery));
    }
    return map;
  }, [searching, targetIds, docs, deferredQuery]);

  const hitContentCount = [...hitCounts.values()].filter((count) => count > 0).length;
  const hitTotal = [...hitCounts.values()].reduce((sum, count) => sum + count, 0);
  // 본문을 받는 중에는 건수가 아직 0 이라 걸러내면 목록이 통째로 빈다.
  const hidesMisses = searching && onlyHits && !docsLoading;

  const activeContent = activeId === null ? null : (contentById.get(activeId) ?? null);
  const activeDoc = activeId === null ? null : (docs[activeId] ?? null);
  // 대상에서 빠진 콘텐츠를 보고 있으면 칠하지 않는다. 목록 건수와 미리보기가 어긋나 보인다.
  const previewQuery = activeContent && targetIds.has(activeContent.id) ? deferredQuery : "";
  const hitCount = activeDoc ? countDocHits(activeDoc, previewQuery) : 0;

  // 몇 번째 일치를 보고 있는지. 콘텐츠나 검색어가 바뀌면 첫 번째로 돌아간다.
  const hitKey = `${activeId}|${previewQuery}`;
  const [hitCursor, setHitCursor] = useState({ key: hitKey, index: 0 });
  const hitIndex = hitCursor.key === hitKey && hitCursor.index < hitCount ? hitCursor.index : 0;
  const moveHit = (step: number) => {
    if (hitCount === 0) return;
    setHitCursor({ key: hitKey, index: (hitIndex + step + hitCount) % hitCount });
  };

  const previewRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 칠해진 곳 중 지금 보는 것을 짙게 하고 그 자리로 옮긴다. 화면에 그려진 뒤에만 할 수 있다.
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const marks = container.querySelectorAll<HTMLElement>("mark[data-hit]");
    marks.forEach((mark, index) => {
      if (index === hitIndex) mark.setAttribute("data-active", "");
      else mark.removeAttribute("data-active");
    });
    marks[hitIndex]?.scrollIntoView({ block: "center" });
    // 불러오기 뒤 같은 콘텐츠 · 검색어면 hitKey 가 그대로라, 새로 그려진 본문에도 다시 칠하도록 본문을 함께 본다.
  }, [hitIndex, hitKey, activeDoc]);

  // PDF 처럼 cmd+F · ctrl+F 로 찾기 칸에 들어간다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectChallenge = (id: number) => {
    setChallengeId(id);
    // 새 챌린지의 첫 콘텐츠로 돌아간다.
    setActiveId(null);
  };

  // 전체에서 찾으면 콘텐츠 단위로 세운다. 찾는 중에는 건수가 많은 콘텐츠가 위로 온다.
  const allContents = useMemo(() => {
    const listed = hidesMisses ? contents.filter((content) => (hitCounts.get(content.id) ?? 0) > 0) : contents;
    return searching
      ? [...listed].sort((a, b) => (hitCounts.get(b.id) ?? 0) - (hitCounts.get(a.id) ?? 0))
      : listed;
  }, [contents, hitCounts, hidesMisses, searching]);

  return (
    <div className="flex flex-col gap-4">
      {/* 불러오기 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm">
        <form action={syncAction}>
          <Button type="submit" variant="outline" size="sm" disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
            {syncing ? "불러오는 중… (1분 가까이 걸립니다)" : "미션 콘텐츠 불러오기"}
          </Button>
        </form>
        <span className="text-muted-foreground">
          {lastFetchedAt || queryRetrievedAt
            ? [
                queryRetrievedAt ? `연결은 Redash ${formatDateTime(queryRetrievedAt)} 기준` : null,
                lastFetchedAt ? `본문은 ${formatDateTime(lastFetchedAt)}에 받은 사본` : null,
                `챌린지 ${challenges.length}개 · 콘텐츠 ${contents.length}개`,
              ]
                .filter(Boolean)
                .join(" · ")
            : "아직 불러온 적이 없습니다"}
        </span>
      </div>

      {syncState.error ? (
        <p className="text-destructive text-sm">{syncState.error}</p>
      ) : syncState.result ? (
        <p className="text-muted-foreground text-sm">
          연결 {syncState.result.uses}건 · 콘텐츠 {syncState.result.contents}개 중 본문 {syncState.result.fetched}개를
          받았습니다.
          {syncState.result.linkOnly > 0 ? ` Notion 이 아닌 링크 ${syncState.result.linkOnly}개는 링크만 둡니다.` : ""}
          {syncState.result.failed.length > 0
            ? ` 받지 못한 콘텐츠: ${syncState.result.failed
                .map((failure) => `${failure.title}(${failure.reason})`)
                .join(", ")} — 예전 사본은 그대로 둡니다.`
            : ""}
        </p>
      ) : null}

      {/* 찾기 */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b py-2 backdrop-blur">
        <div className="relative w-full max-w-sm">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // 한글 조합 중 Enter 는 조합 끝과 함께 두 번 들어와 한 칸을 건너뛴다.
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                moveHit(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                setQuery("");
              }
            }}
            placeholder="미션 콘텐츠에서 찾기 (⌘F)"
            className="pl-8"
            aria-label="미션 콘텐츠에서 찾기"
          />
        </div>
        <NativeSelect
          value={scope}
          onChange={(event) => setScope(event.target.value as Scope)}
          className="w-auto"
          aria-label="찾을 대상"
        >
          <option value="challenge">고른 챌린지의 콘텐츠</option>
          <option value="all">전체 콘텐츠</option>
        </NativeSelect>
        {searching ? (
          <>
            <span className="text-muted-foreground text-sm">
              {docsLoading
                ? "본문을 받는 중입니다. 받으면 바로 찾습니다."
                : `${targetIds.size}개 중 ${hitContentCount}개 콘텐츠에서 ${hitTotal}건`}
            </span>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={onlyHits} onChange={(event) => setOnlyHits(event.target.checked)} />
              찾은 콘텐츠만
            </label>
          </>
        ) : null}
        {loadedDocs.error ? <span className="text-destructive text-sm">{loadedDocs.error}</span> : null}
        <p className="text-muted-foreground w-full text-xs">
          대소문자와 띄어쓰기는 가리지 않습니다. 이미지 속 글자, 하위 페이지 · 데이터베이스 안의 내용은 찾지 않습니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
        {/* 목록 */}
        <section className="flex min-w-0 flex-col gap-2">
          {scope === "challenge" ? (
            <>
              <NativeSelect
                value={challenge?.id ?? ""}
                onChange={(event) => selectChallenge(Number(event.target.value))}
                aria-label="챌린지"
                disabled={challenges.length === 0}
              >
                {challenges.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                    {candidate.startDate ? ` · ${candidate.startDate} 시작` : ""}
                  </option>
                ))}
              </NativeSelect>

              <ul className="flex max-h-[calc(100vh-18rem)] flex-col divide-y overflow-y-auto rounded-lg border">
                {!challenge ? (
                  <li className="text-muted-foreground p-4 text-sm">미션 콘텐츠 불러오기를 눌러 목록을 받아오세요.</li>
                ) : null}
                {challenge?.missions.map((mission) => {
                  const items = hidesMisses
                    ? mission.contents.filter((item) => (hitCounts.get(item.contentId) ?? 0) > 0)
                    : mission.contents;
                  if (items.length === 0) return null;
                  return (
                    <li key={mission.id} className="flex flex-col gap-1 p-2.5">
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{mission.th}회차</span>
                        <span className="min-w-0 flex-1 truncate font-medium" title={mission.title}>
                          {mission.title}
                        </span>
                        {mission.endDate ? (
                          <span className="text-muted-foreground shrink-0 text-xs">{mission.endDate} 마감</span>
                        ) : null}
                      </div>
                      <ul className="flex flex-col">
                        {items.map((item) => {
                          const content = contentById.get(item.contentId);
                          const hits = hitCounts.get(item.contentId) ?? 0;
                          return (
                            <li key={item.contentId}>
                              <button
                                type="button"
                                onClick={() => setActiveId(item.contentId)}
                                className={cn(
                                  "hover:bg-muted flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm",
                                  item.contentId === activeId && "bg-muted",
                                )}
                              >
                                <KindBadge kind={item.kind} />
                                <span className="min-w-0 flex-1 truncate" title={content?.title}>
                                  {content?.title ?? `콘텐츠 ${item.contentId}`}
                                </span>
                                {searching && !docsLoading ? (
                                  hits > 0 ? (
                                    <HitBadge count={hits} />
                                  ) : (
                                    <span className="text-muted-foreground text-xs">없음</span>
                                  )
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
                {challenge && hidesMisses && hitContentCount === 0 ? (
                  <li className="text-muted-foreground p-4 text-sm">이 챌린지의 콘텐츠에서 찾지 못했습니다.</li>
                ) : null}
              </ul>
            </>
          ) : (
            <ul className="flex max-h-[calc(100vh-15rem)] flex-col divide-y overflow-y-auto rounded-lg border">
              {allContents.length === 0 ? (
                <li className="text-muted-foreground p-4 text-sm">
                  {contents.length === 0 ? "미션 콘텐츠 불러오기를 눌러 목록을 받아오세요." : "찾지 못했습니다."}
                </li>
              ) : null}
              {allContents.map((content) => {
                const places = usesByContent.get(content.id) ?? [];
                const challengeCount = new Set(places.map((place) => place.challengeId)).size;
                const kinds = [...new Set(places.map((place) => place.kind))];
                const hits = hitCounts.get(content.id) ?? 0;
                return (
                  <li key={content.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(content.id)}
                      className={cn(
                        "hover:bg-muted flex w-full flex-col items-start gap-0.5 p-2.5 text-left text-sm",
                        content.id === activeId && "bg-muted",
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        {kinds.map((kind) => (
                          <KindBadge key={kind} kind={kind} />
                        ))}
                        <span className="min-w-0 flex-1 truncate font-medium" title={content.title}>
                          {content.title}
                        </span>
                        {searching && hits > 0 ? <HitBadge count={hits} /> : null}
                      </span>
                      <span className="text-muted-foreground w-full truncate text-xs">
                        {MISSION_CONTENT_SOURCE_LABELS[content.source]}
                        {challengeCount > 0 ? ` · 챌린지 ${challengeCount}곳에 쓰임` : ""}
                        {content.source !== "other" && !content.hasDoc ? " · 본문 없음" : ""}
                        {content.delisted ? " · 쿼리 결과에서 사라짐" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 미리보기 */}
        <section className="flex min-w-0 flex-col gap-2">
          {activeContent ? (
            <ContentPreview
              content={activeContent}
              doc={activeDoc}
              docsLoading={docsLoading}
              places={usesByContent.get(activeContent.id) ?? []}
              query={previewQuery}
              searching={searching}
              hitCount={hitCount}
              hitIndex={hitIndex}
              moveHit={moveHit}
              previewRef={previewRef}
            />
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 콘텐츠를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ContentPreview({
  content,
  doc,
  docsLoading,
  places,
  query,
  searching,
  hitCount,
  hitIndex,
  moveHit,
  previewRef,
}: {
  content: MissionContentRow;
  doc: NotionDoc | null;
  docsLoading: boolean;
  places: ContentUsePlace[];
  query: string;
  searching: boolean;
  hitCount: number;
  hitIndex: number;
  moveHit: (step: number) => void;
  previewRef: React.RefObject<HTMLDivElement | null>;
}) {
  const href = safeHref(content.link);
  const notionHref = doc?.pageId ? notionEditUrl(doc.pageId) : null;
  const challengeCount = new Set(places.map((place) => place.challengeId)).size;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{content.title}</h2>
        {notionHref ? (
          <a
            href={notionHref}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            Notion에서 열기 <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
          >
            {content.source === "other" ? "원문 열기" : "웹에서 열기"} <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
        {query.trim() ? (
          <span className="ml-auto flex items-center gap-1 text-sm">
            <span className="tabular-nums">{hitCount > 0 ? `${hitIndex + 1} / ${hitCount}` : "0건"}</span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveHit(-1)} disabled={hitCount === 0} aria-label="이전 일치">
              <ChevronUp aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveHit(1)} disabled={hitCount === 0} aria-label="다음 일치">
              <ChevronDown aria-hidden />
            </Button>
          </span>
        ) : searching ? (
          <span className="text-muted-foreground ml-auto text-xs">찾을 대상에서 빠진 콘텐츠입니다</span>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        {MISSION_CONTENT_SOURCE_LABELS[content.source]}
        {content.hasDoc ? " 에서 받아온 내용으로 다시 그린 미리보기라 원문과 모양이 다릅니다." : ""}
        {content.fetchedAt ? ` ${formatDateTime(content.fetchedAt)}에 받은 사본입니다.` : ""}
        {content.fetchError ? ` 마지막 받아오기 실패: ${content.fetchError}` : ""}
        {content.delisted ? " 마지막으로 불러온 쿼리 결과에 없는 콘텐츠입니다." : ""}
      </p>

      {places.length > 0 ? (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer">
            챌린지 {challengeCount}곳 · 미션 {places.length}개에 쓰임
          </summary>
          <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
            {places.map((place, index) => (
              <li key={index} className="flex items-center gap-2 text-xs">
                <KindBadge kind={place.kind} />
                <span className="min-w-0 flex-1 truncate" title={`${place.challengeTitle} · ${place.th}회차 ${place.missionTitle}`}>
                  {place.challengeTitle} · {place.th}회차 {place.missionTitle}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div ref={previewRef} className="max-h-[calc(100vh-18rem)] overflow-y-auto rounded-lg border p-4">
        {doc ? (
          <NotionDocView key={content.id} doc={doc} query={query} />
        ) : content.hasDoc && docsLoading ? (
          <p className="text-muted-foreground text-sm">본문을 받는 중입니다…</p>
        ) : content.source === "other" ? (
          <p className="text-muted-foreground text-sm">Notion 으로 만든 콘텐츠가 아니라 내용을 받지 않습니다. 원문 열기로 확인하세요.</p>
        ) : (
          <p className="text-muted-foreground text-sm">받아온 내용이 없습니다.</p>
        )}
      </div>
    </>
  );
}

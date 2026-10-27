"use client";

import { cn } from "cn";
import { ChevronDown, ChevronUp, ExternalLink, PencilLine, RefreshCw, Search } from "lucide-react";
import { useActionState, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Highlight } from "@/components/highlight";
import { NotionDocView, safeHref } from "@/components/notion-doc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { countDocHits, MISSION_CONTENT_SOURCE_LABELS, notionEditUrl, type NotionDoc } from "@/domain/mission-content";
import {
  countTextHits,
  guideAdminUrl,
  GUIDE_ITEM_KIND_LABELS,
  uniqueTitles,
  type GuideItemKind,
} from "@/domain/mission-guide";
import type { GuideDocRow, MissionGuidesSnapshot, MissionTemplateRow } from "@/domain/service-mission-guide";

import { syncMissionGuidesAction, type MissionGuideSyncState } from "./actions";

const INITIAL_SYNC_STATE: MissionGuideSyncState = { error: null, result: null, at: 0 };

/** 따로 받은 본문. 원문 주소가 열쇠다. version 은 받을 때 쓴 불러오기 시각이다. */
type LoadedDocs = { version: string | null; docs: Record<string, NotionDoc>; error: string | null };

/** 찾을 대상. 고른 챌린지의 자료만, 또는 모든 자료 */
type Scope = "challenge" | "all";

/** 이 원문이 걸린 자리 한 건 */
type Place = {
  challengeId: number;
  challengeTitle: string;
  challengeStartDate: string | null;
  kind: GuideItemKind;
  title: string;
  th: number | null;
  endDate: string | null;
  modifiedAt: string | null;
};

/**
 * 미리보기와 찾기의 단위. 기수마다 같은 가이드 · 공지 주소를 돌려 쓰고(749줄에 주소 37개)
 * 같은 미션 템플릿을 여러 기수가 쓰므로, 자료 줄이 아니라 원문 하나를 단위로 둔다.
 */
type Source = {
  key: string;
  kinds: GuideItemKind[];
  /** 이 원문에 붙은 제목들. 첫 번째가 대표 제목이다. */
  titles: string[];
  link: string | null;
  doc: GuideDocRow | null;
  template: MissionTemplateRow | null;
  places: Place[];
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

const KIND_BADGE_CLASSES: Record<GuideItemKind, string> = {
  GUIDE: "bg-violet-100 text-violet-800",
  NOTICE: "bg-amber-100 text-amber-800",
  MISSION: "bg-blue-100 text-blue-800",
};

function KindBadge({ kind }: { kind: GuideItemKind }) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium", KIND_BADGE_CLASSES[kind])}>
      {GUIDE_ITEM_KIND_LABELS[kind]}
    </span>
  );
}

function HitBadge({ count }: { count: number }) {
  return <span className="shrink-0 rounded bg-yellow-200 px-1 text-xs font-medium text-black">{count}건</span>;
}

/** 관리자 화면으로 가는 링크. 찾은 문구를 고치러 가는 자리다. */
function AdminLink({ kind, challengeId, label }: { kind: GuideItemKind; challengeId: number; label: string }) {
  return (
    <a
      href={guideAdminUrl(kind, challengeId)}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
    >
      <PencilLine className="size-3" aria-hidden /> {label}
    </a>
  );
}

export function MissionGuidesPanel({ snapshot }: { snapshot: MissionGuidesSnapshot }) {
  const { challenges, docs: docRows, templates, queryRetrievedAt, lastFetchedAt, deferredDocs, failedDocs } =
    snapshot;
  const [syncState, syncAction, syncing] = useActionState(syncMissionGuidesAction, INITIAL_SYNC_STATE);

  // 본문은 첫 화면에 싣지 않고 따로 받는다(plan.md §5). 주소에 불러오기 시각을 붙여, 같은 시각이면
  // 브라우저가 남겨 둔 것을 쓰고 새로 불러오면 다시 받는다.
  const docsVersion = lastFetchedAt ?? "";
  const [loadedDocs, setLoadedDocs] = useState<LoadedDocs>({ version: null, docs: {}, error: null });
  const docsLoading = docsVersion !== "" && loadedDocs.version !== docsVersion;
  const notionDocs = loadedDocs.docs;

  useEffect(() => {
    if (!docsVersion) return;
    const controller = new AbortController();
    fetch(`/api/mission-guides/docs?v=${encodeURIComponent(docsVersion)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`본문을 받지 못했습니다(${response.status}). 새로고침해 주세요.`);
        const data = (await response.json()) as { docs: Record<string, NotionDoc> };
        setLoadedDocs({ version: docsVersion, docs: data.docs, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        setLoadedDocs((previous) => ({ version: docsVersion, docs: previous.docs, error: reason }));
      });
    return () => controller.abort();
  }, [docsVersion]);

  // 자료 줄을 원문 단위로 모은다. 챌린지가 최근 순으로 서 있으므로 각 원문의 첫 자리가 가장 최근 기수다.
  const sources = useMemo(() => {
    const docByLink = new Map(docRows.map((row) => [row.link, row]));
    const templateById = new Map(templates.map((template) => [template.id, template]));
    const map = new Map<string, Source>();
    const titlesByKey = new Map<string, string[]>();

    for (const challenge of challenges) {
      for (const item of challenge.items) {
        const key = item.kind === "MISSION" ? `tpl:${item.templateId}` : `doc:${item.link}`;
        if (item.kind === "MISSION" ? item.templateId === null : !item.link) continue;

        let source = map.get(key);
        if (!source) {
          const template = item.templateId === null ? null : (templateById.get(item.templateId) ?? null);
          source = {
            key,
            kinds: [],
            titles: [],
            link: item.link,
            doc: item.link ? (docByLink.get(item.link) ?? null) : null,
            template,
            places: [],
          };
          map.set(key, source);
          // 미션은 템플릿에 적힌 미션명이 대표 제목이다. 기수에서 덮어쓴 이름은 뒤에 붙는다.
          titlesByKey.set(key, template ? [template.title] : []);
        }
        if (!source.kinds.includes(item.kind)) source.kinds.push(item.kind);
        titlesByKey.get(key)?.push(item.title);
        source.places.push({
          challengeId: challenge.id,
          challengeTitle: challenge.title,
          challengeStartDate: challenge.startDate,
          kind: item.kind,
          title: item.title,
          th: item.th,
          endDate: item.endDate,
          modifiedAt: item.modifiedAt,
        });
      }
    }
    for (const [key, titles] of titlesByKey) {
      const source = map.get(key);
      if (source) source.titles = uniqueTitles(titles);
    }
    return [...map.values()];
  }, [challenges, docRows, templates]);

  const sourceByKey = useMemo(() => new Map(sources.map((source) => [source.key, source])), [sources]);

  const [selectedChallengeId, setChallengeId] = useState<number | null>(null);
  const challenge = challenges.find((candidate) => candidate.id === selectedChallengeId) ?? challenges[0] ?? null;
  const [scope, setScope] = useState<Scope>("challenge");
  const [onlyHits, setOnlyHits] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  /** 고른 챌린지에 걸린 자료를 화면에 서는 차례대로. 같은 원문이 한 챌린지에 두 번 걸리는 일은 없다. */
  const challengeEntries = useMemo(() => {
    if (!challenge) return [];
    return challenge.items.flatMap((item) => {
      const key = item.kind === "MISSION" ? `tpl:${item.templateId}` : `doc:${item.link}`;
      const source = sourceByKey.get(key);
      return source ? [{ item, source }] : [];
    });
  }, [challenge, sourceByKey]);

  const targetKeys = useMemo(
    () =>
      scope === "all"
        ? new Set(sources.map((source) => source.key))
        : new Set(challengeEntries.map((entry) => entry.source.key)),
    [scope, sources, challengeEntries],
  );

  /** 원문 하나에서 찾은 건수. 제목과 본문(미션은 내용 · 가이드)을 함께 센다 — 미리보기에서 칠하는 것과 같다. */
  const countHits = useMemo(() => {
    return (source: Source, text: string): number => {
      if (!text.trim()) return 0;
      let count = source.titles.reduce((sum, title) => sum + countTextHits(title, text), 0);
      if (source.template) {
        count += countTextHits(source.template.description, text);
        count += countTextHits(source.template.guide, text);
      }
      if (source.link) {
        const doc = notionDocs[source.link];
        if (doc) count += countDocHits(doc, text);
      }
      return count;
    };
  }, [notionDocs]);

  const hitCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!searching) return map;
    for (const key of targetKeys) {
      const source = sourceByKey.get(key);
      if (source) map.set(key, countHits(source, deferredQuery));
    }
    return map;
  }, [searching, targetKeys, sourceByKey, countHits, deferredQuery]);

  const hitSourceCount = [...hitCounts.values()].filter((count) => count > 0).length;
  const hitTotal = [...hitCounts.values()].reduce((sum, count) => sum + count, 0);
  // 본문을 받는 중에는 건수가 아직 0 이라 걸러내면 목록이 통째로 빈다.
  const hidesMisses = searching && onlyHits && !docsLoading;

  const activeKey = selectedKey ?? challengeEntries[0]?.source.key ?? null;
  const active = activeKey === null ? null : (sourceByKey.get(activeKey) ?? null);
  // 대상에서 빠진 자료를 보고 있으면 칠하지 않는다. 목록 건수와 미리보기가 어긋나 보인다.
  const previewQuery = active && targetKeys.has(active.key) ? deferredQuery : "";
  const hitCount = active ? countHits(active, previewQuery) : 0;

  // 몇 번째 일치를 보고 있는지. 자료나 검색어가 바뀌면 첫 번째로 돌아간다.
  const hitKey = `${activeKey}|${previewQuery}`;
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
    // 본문을 받은 뒤 같은 자료 · 검색어면 hitKey 가 그대로라, 새로 그려진 본문에도 다시 칠하도록 함께 본다.
  }, [hitIndex, hitKey, notionDocs]);

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

  // 전체에서 찾으면 원문 단위로 세운다. 찾는 중에는 건수가 많은 것이 위로 온다.
  const allSources = useMemo(() => {
    const listed = hidesMisses ? sources.filter((source) => (hitCounts.get(source.key) ?? 0) > 0) : sources;
    return searching
      ? [...listed].sort((a, b) => (hitCounts.get(b.key) ?? 0) - (hitCounts.get(a.key) ?? 0))
      : listed;
  }, [sources, hitCounts, hidesMisses, searching]);

  return (
    <div className="flex flex-col gap-4">
      {/* 불러오기 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm">
        <form action={syncAction}>
          <Button type="submit" variant="outline" size="sm" disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
            {syncing ? "불러오는 중… (1분 넘게 걸립니다)" : "미션 가이드 불러오기"}
          </Button>
        </form>
        <span className="text-muted-foreground">
          {lastFetchedAt || queryRetrievedAt
            ? [
                queryRetrievedAt ? `목록은 Redash ${formatDateTime(queryRetrievedAt)} 기준` : null,
                lastFetchedAt ? `본문은 ${formatDateTime(lastFetchedAt)}에 받은 사본` : null,
                `챌린지 ${challenges.length}개 · 자료 ${sources.length}개`,
              ]
                .filter(Boolean)
                .join(" · ")
            : "아직 불러온 적이 없습니다"}
        </span>
        {deferredDocs > 0 ? (
          <span className="text-destructive">
            아직 받지 못한 원문 {deferredDocs}개 — 한 번에 받을 수 있는 시간을 넘겨 미뤄 두었습니다. 다시 누르면
            이어받습니다.
          </span>
        ) : null}
        {failedDocs > 0 ? (
          <span className="text-muted-foreground">
            받아오기에 실패한 원문 {failedDocs}개 — 대개 Notion 게시가 꺼진 페이지입니다. 자료를 고르면 사유가 적힙니다.
          </span>
        ) : null}
      </div>

      {syncState.error ? (
        <p className="text-destructive text-sm">{syncState.error}</p>
      ) : syncState.result ? (
        <p className="text-muted-foreground text-sm">
          챌린지 {syncState.result.challenges}개 · 자료 {syncState.result.items}줄을 받고, 원문{" "}
          {syncState.result.docs}개 중 본문 {syncState.result.fetched}개를 받았습니다.
          {syncState.result.linkOnly > 0 ? ` Notion 이 아닌 링크 ${syncState.result.linkOnly}개는 링크만 둡니다.` : ""}
          {syncState.result.deferred > 0
            ? ` 시간이 모자라 ${syncState.result.deferred}개는 다음으로 미뤘습니다 — 다시 눌러 이어받으세요.`
            : ""}
          {syncState.result.failed.length > 0
            ? ` 받지 못한 원문 ${syncState.result.failed.length}개: ${syncState.result.failed
                .slice(0, 5)
                .map((failure) => failure.reason)
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
            placeholder="미션 가이드에서 찾기 (⌘F)"
            className="pl-8"
            aria-label="미션 가이드에서 찾기"
          />
        </div>
        <NativeSelect
          value={scope}
          onChange={(event) => setScope(event.target.value as Scope)}
          className="w-auto"
          aria-label="찾을 대상"
        >
          <option value="challenge">고른 챌린지의 자료</option>
          <option value="all">전체 자료</option>
        </NativeSelect>
        {searching ? (
          <>
            <span className="text-muted-foreground text-sm">
              {docsLoading
                ? "본문을 받는 중입니다. 받으면 바로 찾습니다."
                : `${targetKeys.size}개 중 ${hitSourceCount}개 자료에서 ${hitTotal}건`}
            </span>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={onlyHits} onChange={(event) => setOnlyHits(event.target.checked)} />
              찾은 자료만
            </label>
          </>
        ) : null}
        {loadedDocs.error ? <span className="text-destructive text-sm">{loadedDocs.error}</span> : null}
        <p className="text-muted-foreground w-full text-xs">
          대소문자와 띄어쓰기는 가리지 않습니다. 미션은 미션명 · 내용 · 가이드 내용을, 가이드 · 공지는 제목과 Notion
          본문을 찾습니다. 이미지 속 글자, 하위 페이지 · 데이터베이스 안의 내용은 찾지 않습니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
        {/* 목록 */}
        <section className="flex min-w-0 flex-col gap-2">
          {scope === "challenge" ? (
            <>
              <NativeSelect
                value={challenge?.id ?? ""}
                onChange={(event) => {
                  setChallengeId(Number(event.target.value));
                  // 새 챌린지의 첫 자료로 돌아간다.
                  setSelectedKey(null);
                }}
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
                  <li className="text-muted-foreground p-4 text-sm">미션 가이드 불러오기를 눌러 목록을 받아오세요.</li>
                ) : null}
                {challengeEntries.map(({ item, source }) => {
                  const hits = hitCounts.get(source.key) ?? 0;
                  if (hidesMisses && hits === 0) return null;
                  return (
                    <li key={`${item.kind}:${item.sourceId}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedKey(source.key)}
                        className={cn(
                          "hover:bg-muted flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm",
                          source.key === activeKey && "bg-muted",
                        )}
                      >
                        <KindBadge kind={item.kind} />
                        {item.th !== null ? (
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{item.th}회차</span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate" title={item.title}>
                          {item.title}
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
                {challenge && hidesMisses && hitSourceCount === 0 ? (
                  <li className="text-muted-foreground p-4 text-sm">이 챌린지의 자료에서 찾지 못했습니다.</li>
                ) : null}
              </ul>
            </>
          ) : (
            <ul className="flex max-h-[calc(100vh-15rem)] flex-col divide-y overflow-y-auto rounded-lg border">
              {allSources.length === 0 ? (
                <li className="text-muted-foreground p-4 text-sm">
                  {sources.length === 0 ? "미션 가이드 불러오기를 눌러 목록을 받아오세요." : "찾지 못했습니다."}
                </li>
              ) : null}
              {allSources.map((source) => {
                const challengeCount = new Set(source.places.map((place) => place.challengeId)).size;
                const hits = hitCounts.get(source.key) ?? 0;
                return (
                  <li key={source.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(source.key)}
                      className={cn(
                        "hover:bg-muted flex w-full flex-col items-start gap-0.5 p-2.5 text-left text-sm",
                        source.key === activeKey && "bg-muted",
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        {source.kinds.map((kind) => (
                          <KindBadge key={kind} kind={kind} />
                        ))}
                        <span className="min-w-0 flex-1 truncate font-medium" title={source.titles[0]}>
                          {source.titles[0] ?? "(제목 없음)"}
                        </span>
                        {searching && hits > 0 ? <HitBadge count={hits} /> : null}
                      </span>
                      <span className="text-muted-foreground w-full truncate text-xs">
                        {source.doc ? MISSION_CONTENT_SOURCE_LABELS[source.doc.source] : "운영DB 안의 글"}
                        {` · 챌린지 ${challengeCount}곳에 걸림`}
                        {source.doc && source.doc.source !== "other" && !source.doc.hasDoc ? " · 본문 없음" : ""}
                        {source.titles.length > 1 ? ` · 제목 ${source.titles.length}가지` : ""}
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
          {active ? (
            <SourcePreview
              source={active}
              doc={active.link ? (notionDocs[active.link] ?? null) : null}
              docsLoading={docsLoading}
              query={previewQuery}
              searching={searching}
              hitCount={hitCount}
              hitIndex={hitIndex}
              moveHit={moveHit}
              previewRef={previewRef}
            />
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 자료를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function SourcePreview({
  source,
  doc,
  docsLoading,
  query,
  searching,
  hitCount,
  hitIndex,
  moveHit,
  previewRef,
}: {
  source: Source;
  doc: NotionDoc | null;
  docsLoading: boolean;
  query: string;
  searching: boolean;
  hitCount: number;
  hitIndex: number;
  moveHit: (step: number) => void;
  previewRef: React.RefObject<HTMLDivElement | null>;
}) {
  const href = source.link ? safeHref(source.link) : null;
  const notionHref = doc?.pageId ? notionEditUrl(doc.pageId) : null;
  const challengeCount = new Set(source.places.map((place) => place.challengeId)).size;
  // 가장 최근 기수의 자리. 관리자 화면은 챌린지마다 따로라 어느 기수로 갈지 정해야 한다.
  const latest = source.places[0];
  const otherTitles = source.titles.slice(1);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{source.titles[0] ?? "(제목 없음)"}</h2>
        <AdminLink
          kind={latest.kind}
          challengeId={latest.challengeId}
          label={latest.kind === "MISSION" ? "미션 목록 열기" : "대시보드에서 고치기"}
        />
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
            {source.doc?.source === "other" ? "원문 열기" : "웹에서 열기"} <ExternalLink className="size-3" aria-hidden />
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
          <span className="text-muted-foreground ml-auto text-xs">찾을 대상에서 빠진 자료입니다</span>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        {source.template
          ? "실서비스 미션 템플릿에 적힌 글입니다. 관리자 화면의 미션 관리에서 고칩니다."
          : source.doc
            ? `${MISSION_CONTENT_SOURCE_LABELS[source.doc.source]} 에서 받아온 내용으로 다시 그린 미리보기라 원문과 모양이 다릅니다.`
            : ""}
        {source.doc?.fetchedAt ? ` ${formatDateTime(source.doc.fetchedAt)}에 받은 사본입니다.` : ""}
        {source.doc?.fetchError ? ` 마지막 받아오기 실패: ${source.doc.fetchError}` : ""}
      </p>

      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer">
          챌린지 {challengeCount}곳 · 자료 {source.places.length}건에 걸림
        </summary>
        <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {source.places.map((place, index) => (
            <li key={index} className="flex items-center gap-2 text-xs">
              <KindBadge kind={place.kind} />
              <span
                className="min-w-0 flex-1 truncate"
                title={`${place.challengeTitle}${place.th !== null ? ` · ${place.th}회차` : ""} ${place.title}`}
              >
                {place.challengeTitle}
                {place.th !== null ? ` · ${place.th}회차` : ""} {place.title}
              </span>
              <AdminLink kind={place.kind} challengeId={place.challengeId} label="고치기" />
            </li>
          ))}
        </ul>
      </details>

      <div ref={previewRef} className="max-h-[calc(100vh-18rem)] overflow-y-auto rounded-lg border p-4">
        {/*
          제목도 찾기 대상이라 위 머리글이 아니라 여기서 칠한다. 건수를 세는 곳과 칠하는 곳이 같은
          차례로 있어야 `3 / 12` 의 이전 · 다음 이동이 맞는다.
        */}
        <p className="text-muted-foreground mb-3 text-xs">
          {otherTitles.length > 0 ? `제목 ${source.titles.length}가지 · ` : "제목 · "}
          {source.titles.map((title, index) => (
            <span key={index}>
              {index > 0 ? " · " : ""}
              <span className="text-foreground">
                <Highlight text={title} query={query} />
              </span>
            </span>
          ))}
        </p>

        {source.template ? (
          <div className="flex flex-col gap-4 text-sm leading-relaxed">
            <section className="flex flex-col gap-1">
              <h3 className="text-muted-foreground text-xs font-medium">내용</h3>
              <p className="whitespace-pre-wrap">
                <Highlight text={source.template.description} query={query} />
              </p>
            </section>
            <section className="flex flex-col gap-1">
              <h3 className="text-muted-foreground text-xs font-medium">가이드 내용</h3>
              <p className="whitespace-pre-wrap">
                <Highlight text={source.template.guide} query={query} />
              </p>
            </section>
          </div>
        ) : doc ? (
          <NotionDocView key={source.key} doc={doc} query={query} />
        ) : source.doc?.hasDoc && docsLoading ? (
          <p className="text-muted-foreground text-sm">본문을 받는 중입니다…</p>
        ) : source.doc?.source === "other" ? (
          <p className="text-muted-foreground text-sm">
            Notion 으로 만든 자료가 아니라 내용을 받지 않습니다. 원문 열기로 확인하세요.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">받아온 내용이 없습니다.</p>
        )}
      </div>
    </>
  );
}

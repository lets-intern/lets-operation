"use client";

import { cn } from "cn";
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  normalizeReviewCategories,
  REVIEW_CATEGORIES,
  REVIEW_TYPE_LABELS,
  REVIEW_TYPES,
  reviewCategoryLabel,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  type ReviewType,
} from "@/domain/review";
import type {
  ReviewListParams,
  ReviewPartRow,
  ReviewQuerySyncResult,
  ReviewRow,
  ReviewsSnapshot,
} from "@/domain/service-review";

import { saveReviewCategoriesAction, syncReviewsAction, type ReviewSyncState } from "./actions";

const INITIAL_SYNC_STATE: ReviewSyncState = { result: null, at: 0 };

const PATH = "/operation-health/reviews";

/** 관리자 화면 후기 관리. 노출 여부는 여기서 바꾼다. */
const ADMIN_REVIEW_URL: Record<ReviewType, string> = {
  MISSION: "https://admin.letscareer.co.kr/review/mission",
  CHALLENGE: "https://admin.letscareer.co.kr/review/challenge",
  LIVE: "https://admin.letscareer.co.kr/review/live",
  LIVE_FEEDBACK: "https://admin.letscareer.co.kr/review/live-mentoring",
  LIVE_MENTORING: "https://admin.letscareer.co.kr/review/live-mentoring-1on1",
  BLOG: "https://admin.letscareer.co.kr/review/blog",
};

/** 찾기 칸을 다 친 뒤 주소를 바꾸기까지 기다리는 시간. 칠 때마다 서버에 묻지 않는다. */
const SEARCH_DELAY_MS = 300;

/** 저장이 끝나기 전에 화면부터 바꾸는 고침 */
type CategoryEdit = { key: string; categories: string[] | null };

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

/** 주소 쿼리. 기본값은 적지 않아 주소를 짧게 둔다. */
function buildHref(filters: ReviewListParams): string {
  const search = new URLSearchParams();
  if (filters.type !== REVIEW_TYPES[0].key) search.set("type", filters.type);
  if (filters.query.trim()) search.set("q", filters.query.trim());
  if (filters.part) search.set("part", filters.part);
  if (filters.category) search.set("category", filters.category);
  if (filters.visibility !== "all") search.set("visible", filters.visibility);
  if (filters.sort !== "newest") search.set("sort", filters.sort);
  if (filters.page > 1) search.set("page", String(filters.page));
  const text = search.toString();
  return text ? `${PATH}?${text}` : PATH;
}

/** 후기 한 건을 목록 한 줄에 줄여 적는다. 칸이 여럿이면 첫 칸 글을 쓴다. */
function preview(review: ReviewRow): string {
  return review.parts.find((part) => part.classified)?.content ?? review.parts[0]?.content ?? "";
}

function SyncLine({ label, result }: { label: string; result: ReviewQuerySyncResult }) {
  if (!result.ok) return <span className="text-destructive">{`${label}: ${result.error}`}</span>;
  return (
    <span>
      {`${label}: 후기 ${result.reviews.toLocaleString()}건(칸 ${result.parts.toLocaleString()}개)을 받았습니다.`}
      {result.tests > 0 ? ` 테스트 후기 칸 ${result.tests}개는 모으지 않았습니다.` : ""}
      {result.skipped > 0 ? (
        <span className="text-destructive">{` 유형 · 번호 · 작성일시를 읽지 못한 ${result.skipped}줄은 빠졌습니다.`}</span>
      ) : null}
    </span>
  );
}

export function ReviewsPanel({ filters, snapshot }: { filters: ReviewListParams; snapshot: ReviewsSnapshot }) {
  const router = useRouter();
  const [navigating, startNavigating] = useTransition();
  const [syncState, syncAction, syncing] = useActionState(syncReviewsAction, INITIAL_SYNC_STATE);

  /**
   * 마지막으로 보낸 조건. 서버 응답이 오기 전에 조건을 연달아 바꾸면 props 의 filters 는 아직 옛 값이라,
   * 그것에 합치면 앞서 바꾼 조건이 사라진다. 보낼 때마다 여기에 두고 여기에 합친다.
   */
  const latestFilters = useRef(filters);
  useEffect(() => {
    latestFilters.current = filters;
  }, [filters]);

  const [query, setQuery] = useState(filters.query);
  /** 찾기 칸을 칠 때마다 서버에 묻지 않도록 마지막으로 친 뒤 잠시 기다렸다가 주소를 바꾼다. */
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 이 화면이 보낸 찾는 말. 응답이 돌아와도 그사이 더 친 글자를 덮어쓰지 않게 한다. */
  const [sentQuery, setSentQuery] = useState(filters.query);

  const go = (next: Partial<ReviewListParams>) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // 거르는 조건이 바뀌면 첫 쪽으로 돌아간다. 쪽만 바꿀 때만 쪽을 넘긴다. 아직 안 보낸 찾는 말도 함께 싣는다.
    const merged = { ...latestFilters.current, query, page: 1, ...next };
    latestFilters.current = merged;
    setSentQuery(merged.query);
    startNavigating(() => router.replace(buildHref(merged), { scroll: false }));
  };

  // 주소가 이 화면 밖에서 바뀌어(왼쪽 메뉴를 다시 누르는 등) 찾는 말이 달라졌을 때만 칸도 따라간다.
  const [syncedQuery, setSyncedQuery] = useState(filters.query);
  if (syncedQuery !== filters.query) {
    setSyncedQuery(filters.query);
    // 이 화면이 보낸 이동이 아직 이어지는 중이면 앞서 보낸 찾기의 응답이다 — 그사이 더 친 글자를 지키려고 따라가지 않는다.
    if (filters.query !== sentQuery && !navigating) {
      setSentQuery(filters.query);
      setQuery(filters.query);
    }
  }

  const changeQuery = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (value.trim() !== latestFilters.current.query.trim()) go({ query: value });
    }, SEARCH_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const [reviews, applyEdit] = useOptimistic(snapshot.reviews, (current, edit: CategoryEdit) =>
    current.map((review) => ({
      ...review,
      parts: review.parts.map((part) =>
        part.key !== edit.key
          ? part
          : { ...part, categories: edit.categories ?? part.ruleCategories, categoriesEdited: edit.categories !== null },
      ),
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 카테고리를 고치던 후기. 고친 카테고리로 거른 목록에서 빠져도 오른쪽에 남긴다. */
  const [pinned, setPinned] = useState<ReviewRow | null>(null);
  const active =
    reviews.find((review) => review.id === selectedId) ??
    (pinned && pinned.id === selectedId ? pinned : null) ??
    reviews[0] ??
    null;

  const [, startSaving] = useTransition();
  /** 저장 중인 칸. 그 칸에만 저장 중이라고 적는다. */
  const [savingKey, setSavingKey] = useState<string | null>(null);
  /** 저장 실패 문구. 어느 칸의 것인지 함께 둬 다른 칸에 남지 않게 한다. */
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null);
  const saveCategories = (review: ReviewRow, key: string, categories: string[] | null) => {
    setSelectedId(review.id);
    // 붙잡아 둔 후기에도 고친 카테고리를 바로 보인다 — 목록에서 빠지면 낙관적 고침이 닿지 않는다.
    setPinned({
      ...review,
      parts: review.parts.map((part) =>
        part.key !== key
          ? part
          : { ...part, categories: categories ?? part.ruleCategories, categoriesEdited: categories !== null },
      ),
    });
    setSaveError(null);
    setSavingKey(key);
    startSaving(async () => {
      applyEdit({ key, categories });
      const { error } = await saveReviewCategoriesAction(key, categories);
      if (error) setSaveError({ key, message: error });
      setSavingKey((current) => (current === key ? null : current));
    });
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // 다른 화면과 같이 cmd+F · ctrl+F 로 찾기 칸에 들어간다.
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

  // 찾는 중이면 후기를 열 때 처음 칠해진 곳으로 옮긴다.
  useEffect(() => {
    previewRef.current?.querySelector("mark[data-hit]")?.scrollIntoView({ block: "center" });
  }, [active?.id, filters.query]);

  const categories = REVIEW_CATEGORIES[filters.type];
  const hasParts = snapshot.parts.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {/* 불러오기 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm">
        <form action={syncAction}>
          <Button type="submit" variant="outline" size="sm" disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
            {syncing ? "불러오는 중…" : "후기 불러오기"}
          </Button>
        </form>
        <span className="text-muted-foreground">
          {snapshot.retrievedAt.general || snapshot.retrievedAt.mission
            ? [
                snapshot.retrievedAt.general ? `후기 Redash ${formatDateTime(snapshot.retrievedAt.general)} 기준` : null,
                snapshot.retrievedAt.mission
                  ? `미션 후기 Redash ${formatDateTime(snapshot.retrievedAt.mission)} 기준`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "아직 불러온 적이 없습니다"}
        </span>
        <a
          href={ADMIN_REVIEW_URL[filters.type]}
          target="_blank"
          rel="noreferrer"
          className="text-primary ml-auto inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
        >
          관리자 화면에서 노출 바꾸기 <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      {syncState.result ? (
        <p className="text-muted-foreground flex flex-col gap-0.5 text-sm">
          <SyncLine label="후기(쿼리 349)" result={syncState.result.general} />
          <SyncLine label="미션 후기(쿼리 350)" result={syncState.result.mission} />
        </p>
      ) : null}

      {/* 유형 탭 */}
      <nav className="flex flex-wrap gap-1 border-b" aria-label="후기 유형">
        {REVIEW_TYPES.map((type) => {
          const on = type.key === filters.type;
          return (
            <button
              key={type.key}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() =>
                // 칸 · 카테고리는 유형마다 달라 옮길 때 지운다. 찾는 말과 노출 · 줄 세우기는 그대로 둔다.
                go({ type: type.key, part: "", category: "" })
              }
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                on ? "border-primary text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {type.label}
              <span className="ml-1 text-xs tabular-nums opacity-70">
                {(snapshot.typeCounts[type.key] ?? 0).toLocaleString()}
              </span>
            </button>
          );
        })}
      </nav>

      {/* 찾기 · 거르기 */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-col gap-2 border-b py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") changeQuery("");
              }}
              placeholder="이름 · 프로그램 · 미션 · 멘토 · 후기 내용에서 찾기 (⌘F)"
              className="pl-8"
              aria-label="후기에서 찾기"
            />
          </div>
          {hasParts ? (
            <NativeSelect
              value={filters.part}
              onChange={(event) => go({ part: event.target.value })}
              className="w-auto"
              aria-label="칸"
            >
              <option value="">칸 전체</option>
              {snapshot.parts.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <NativeSelect
            value={filters.visibility}
            onChange={(event) => go({ visibility: event.target.value as ReviewListParams["visibility"] })}
            className="w-auto"
            aria-label="노출 여부"
          >
            <option value="all">노출 전체</option>
            <option value="visible">노출 중</option>
            <option value="hidden">노출 꺼짐</option>
          </NativeSelect>
          <NativeSelect
            value={filters.sort}
            onChange={(event) => go({ sort: event.target.value as ReviewListParams["sort"] })}
            className="w-auto"
            aria-label="줄 세우기"
          >
            <option value="newest">최신순</option>
            <option value="oldest">오래된 순</option>
          </NativeSelect>
          <span className="text-muted-foreground text-sm">
            {snapshot.total === snapshot.typeTotal
              ? `후기 ${snapshot.typeTotal.toLocaleString()}건`
              : `후기 ${snapshot.typeTotal.toLocaleString()}건 중 ${snapshot.total.toLocaleString()}건`}
            {navigating ? " · 불러오는 중…" : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="카테고리">
          <CategoryChip
            label="전체"
            count={snapshot.narrowedTotal}
            unit="건"
            active={!filters.category}
            onClick={() => go({ category: "" })}
          />
          {categories.map((entry) => (
            <CategoryChip
              key={entry.key}
              label={entry.label}
              title={entry.hint}
              count={snapshot.categoryCounts[entry.key] ?? 0}
              active={filters.category === entry.key}
              onClick={() => go({ category: filters.category === entry.key ? "" : entry.key })}
            />
          ))}
          <CategoryChip
            label={UNCLASSIFIED_LABEL}
            count={snapshot.categoryCounts[UNCLASSIFIED] ?? 0}
            active={filters.category === UNCLASSIFIED}
            onClick={() => go({ category: filters.category === UNCLASSIFIED ? "" : UNCLASSIFIED })}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {categories.length === 0
            ? `${REVIEW_TYPE_LABELS[filters.type]} 후기의 카테고리 목록은 아직 정하지 않아 모두 미분류로 둡니다. `
            : ""}
          카테고리는 후기 글 칸마다 붙어, 카테고리 칩의 숫자는 후기가 아니라 칸 수입니다.
          {hasParts && filters.part ? ` 지금은 ${filters.part} 칸만 셉니다.` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
        {/* 목록 */}
        <div className="flex min-w-0 flex-col gap-2">
          <ul
            className={cn(
              "flex max-h-[calc(100vh-20rem)] min-w-0 flex-col divide-y overflow-y-auto rounded-lg border",
              navigating && "opacity-60",
            )}
          >
            {reviews.length === 0 ? (
              <li className="text-muted-foreground p-4 text-sm">
                {snapshot.typeTotal === 0
                  ? "후기 불러오기를 눌러 후기를 받아오세요."
                  : "조건에 맞는 후기가 없습니다."}
              </li>
            ) : null}
            {reviews.map((review) => {
              const hits = snapshot.hits[review.id] ?? 0;
              const tags = [...new Set(review.parts.flatMap((part) => part.categories))];
              return (
                <li key={review.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(review.id)}
                    className={cn(
                      "hover:bg-muted flex w-full flex-col items-start gap-1 p-2.5 text-left text-sm",
                      review.id === active?.id && "bg-muted",
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium" title={review.programTitle}>
                        <Highlight text={review.programTitle} query={filters.query} />
                      </span>
                      {!review.visible ? <VisibleBadge visible={false} /> : null}
                      {hits > 0 ? (
                        <span className="shrink-0 rounded bg-yellow-200 px-1 text-xs font-medium text-black">{hits}건</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 w-full text-xs">
                      <Highlight text={preview(review)} query={filters.query} />
                    </span>
                    <span className="flex w-full flex-wrap items-center gap-1">
                      <span className="text-muted-foreground mr-1 text-xs tabular-nums">
                        {[review.authorName ?? "이름 없음", review.th !== null ? `${review.th}회차` : null, formatDateTime(review.writtenAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {tags.map((key) => (
                        <CategoryBadge key={key} type={filters.type} category={key} />
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {snapshot.pageCount > 1 ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={snapshot.page <= 1 || navigating}
                onClick={() => go({ page: snapshot.page - 1 })}
                aria-label="앞 쪽"
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span className="text-muted-foreground tabular-nums">
                {snapshot.page} / {snapshot.pageCount} 쪽
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={snapshot.page >= snapshot.pageCount || navigating}
                onClick={() => go({ page: snapshot.page + 1 })}
                aria-label="다음 쪽"
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
          ) : null}
        </div>

        {/* 후기 보기 */}
        <section className="flex min-w-0 flex-col gap-3">
          {active ? (
            <ReviewDetail
              key={active.id}
              type={filters.type}
              review={active}
              query={filters.query}
              focusPart={filters.part}
              savingKey={savingKey}
              saveError={saveError}
              onSaveCategories={(key, next) => saveCategories(active, key, next)}
              previewRef={previewRef}
            />
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 후기를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function VisibleBadge({ visible }: { visible: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium",
        visible ? "bg-green-50 text-green-800" : "bg-muted text-muted-foreground",
      )}
    >
      {visible ? "노출 중" : "노출 꺼짐"}
    </span>
  );
}

function CategoryBadge({ type, category }: { type: ReviewType; category: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none",
        category === UNCLASSIFIED ? "bg-muted text-muted-foreground" : "bg-blue-50 text-blue-800",
      )}
    >
      {reviewCategoryLabel(type, category)}
    </span>
  );
}

function CategoryChip({
  label,
  title,
  count,
  unit = "",
  active,
  onClick,
}: {
  label: string;
  title?: string;
  count: number;
  unit?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
        count === 0 && !active && "text-muted-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">
        {count.toLocaleString()}
        {unit}
      </span>
    </button>
  );
}

function ReviewDetail({
  type,
  review,
  query,
  focusPart,
  savingKey,
  saveError,
  onSaveCategories,
  previewRef,
}: {
  type: ReviewType;
  review: ReviewRow;
  query: string;
  focusPart: string;
  savingKey: string | null;
  saveError: { key: string; message: string } | null;
  onSaveCategories: (key: string, categories: string[] | null) => void;
  previewRef: React.RefObject<HTMLDivElement | null>;
}) {
  const facts = [
    review.missionTitle ? `${review.th !== null ? `${review.th}회차 ` : ""}${review.missionTitle}` : null,
    review.missionTitle === null && review.th !== null ? `${review.th}회차` : null,
    review.mentorName ? `멘토 ${review.mentorName}` : null,
    review.score !== null ? `만족도 ${review.score}` : null,
    review.nps !== null ? `NPS ${review.nps}` : null,
  ].filter(Boolean);

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <VisibleBadge visible={review.visible} />
          <h2 className="text-base font-semibold">
            <Highlight text={review.programTitle || "프로그램 없음"} query={query} />
          </h2>
        </div>
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground">
            <Highlight text={review.authorName ?? "이름 없음"} query={query} />
          </span>
          {` · ${formatDateTime(review.writtenAt)}${type === "LIVE_FEEDBACK" ? " 멘토링" : type === "BLOG" ? " 게시" : " 작성"}`}
          {facts.length > 0 ? ` · ${facts.join(" · ")}` : ""}
        </p>
        {review.url ? (
          <a
            href={review.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex w-fit items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            <Highlight text={review.blogTitle ?? review.url} query={query} />
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>

      <div ref={previewRef} className="flex max-h-[calc(100vh-20rem)] flex-col gap-4 overflow-y-auto rounded-lg border p-4">
        {review.parts.map((part, index) => (
          <PartSection
            key={part.key}
            type={type}
            part={part}
            query={query}
            dimmed={Boolean(focusPart) && part.part !== focusPart}
            first={index === 0}
            saving={savingKey === part.key}
            saveError={saveError?.key === part.key ? saveError.message : null}
            onSaveCategories={(next) => onSaveCategories(part.key, next)}
          />
        ))}
      </div>
    </>
  );
}

function PartSection({
  type,
  part,
  query,
  dimmed,
  first,
  saving,
  saveError,
  onSaveCategories,
}: {
  type: ReviewType;
  part: ReviewPartRow;
  query: string;
  dimmed: boolean;
  first: boolean;
  saving: boolean;
  saveError: string | null;
  onSaveCategories: (categories: string[] | null) => void;
}) {
  const categories = REVIEW_CATEGORIES[type];
  const toggle = (key: string) => {
    const current = part.categories.filter((value) => value !== UNCLASSIFIED);
    const next = current.includes(key)
      ? current.filter((value) => value !== key)
      : normalizeReviewCategories(type, [...current, key]);
    // 하나도 안 남기면 규칙으로 되돌린다 — 어느 카테고리에도 안 잡히는 칸이 생기지 않게 한다.
    onSaveCategories(next.length > 0 ? next : null);
  };

  return (
    <section className={cn("flex flex-col gap-1.5", !first && "border-t pt-4", dimmed && "opacity-50")}>
      <h3 className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs font-medium">
        {part.part}
        {part.partVisible === false ? <span className="font-normal">· 이 칸은 노출 꺼짐</span> : null}
        {part.classified && categories.length === 0
          ? part.categories.map((key) => <CategoryBadge key={key} type={type} category={key} />)
          : null}
      </h3>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        <Highlight text={part.content} query={query} />
      </p>
      {part.classified && categories.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.map((entry) => {
              const on = part.categories.includes(entry.key);
              return (
                <button
                  key={entry.key}
                  type="button"
                  title={entry.hint}
                  aria-pressed={on}
                  onClick={() => toggle(entry.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    on ? "border-blue-300 bg-blue-50 text-blue-800" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            {part.categoriesEdited ? (
              <>
                매니저가 고친 카테고리입니다. 불러오기를 다시 해도 바뀌지 않습니다.
                <button
                  type="button"
                  onClick={() => onSaveCategories(null)}
                  className="text-primary inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  <RotateCcw className="size-3" aria-hidden />
                  키워드 규칙으로 되돌리기 ({part.ruleCategories.map((key) => reviewCategoryLabel(type, key)).join(", ")})
                </button>
              </>
            ) : (
              "키워드 규칙이 붙인 카테고리입니다. 누르면 고칠 수 있습니다."
            )}
            {saving ? <span>저장하는 중…</span> : null}
            {saveError ? <span className="text-destructive">{saveError}</span> : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}

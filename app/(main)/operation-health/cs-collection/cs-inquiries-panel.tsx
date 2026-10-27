"use client";

import { cn } from "cn";
import { ExternalLink, Eye, EyeOff, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useActionState, useDeferredValue, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  countInquiryHits,
  CS_CATEGORIES,
  CS_CATEGORY_LABELS,
  normalizeCategories,
  type CsCategory,
} from "@/domain/cs-inquiry";
import type { CsInquiriesSnapshot, CsInquiryRow } from "@/domain/service-cs-inquiry";

import {
  saveCsInquiryCategoriesAction,
  setCsInquiryHiddenAction,
  syncCsInquiriesAction,
  type CsInquirySyncState,
} from "./actions";

const INITIAL_SYNC_STATE: CsInquirySyncState = { error: null, result: null, at: 0 };

/** 관리자 화면의 1:1 문의 목록. 답변 화면은 목록에서 넘겨주는 값으로 그려져 주소로 바로 열 수 없다. */
const ADMIN_INQUIRY_URL = "https://admin.letscareer.co.kr/challenge/inquiry";

type StatusFilter = "all" | "waiting" | "answered";
type Sort = "newest" | "oldest";
/** 카테고리 거르기. all 이면 거르지 않는다. */
type CategoryFilter = CsCategory | "all";
/** 저장이 끝나기 전에 화면부터 바꾸는 고침 — 카테고리 고치기, 목록에서 숨기기 */
type InquiryEdit = { id: number; categories: CsCategory[] | null } | { id: number; hidden: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * 답을 기다린 날수. 지금 시각이 아니라 쿼리가 돈 시각에 맞춰 센다 — 사본이 그 시각의 모습이고,
 * 서버와 브라우저가 같은 값을 그려야 한다.
 */
function waitingDays(inquiry: CsInquiryRow, retrievedAt: string | null): number | null {
  if (inquiry.answer !== null || !retrievedAt) return null;
  return Math.max(0, Math.floor((new Date(retrievedAt).getTime() - new Date(inquiry.createdAt).getTime()) / DAY_MS));
}

/** 하루가 안 지났으면 0일째가 아니라 오늘로 적는다. */
function waitingLabel(days: number): string {
  return days === 0 ? "오늘 들어와 대기" : `${days}일째 대기`;
}

function StatusBadge({ answered }: { answered: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium",
        answered ? "bg-muted text-muted-foreground" : "bg-red-100 text-red-800",
      )}
    >
      {answered ? "완료" : "대기"}
    </span>
  );
}

function CategoryBadge({ category }: { category: CsCategory }) {
  return (
    <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] leading-none text-blue-800">
      {CS_CATEGORY_LABELS[category]}
    </span>
  );
}

export function CsInquiriesPanel({ snapshot }: { snapshot: CsInquiriesSnapshot }) {
  const { queryRetrievedAt } = snapshot;
  const [syncState, syncAction, syncing] = useActionState(syncCsInquiriesAction, INITIAL_SYNC_STATE);

  // 카테고리를 고르거나 숨기면 저장이 끝나기 전에 화면부터 바꾼다. 저장이 끝나면 새로 그린 스냅샷이 그 자리를 잇는다.
  const [inquiries, applyEdit] = useOptimistic(snapshot.inquiries, (current, edit: InquiryEdit) =>
    current.map((inquiry) =>
      inquiry.id !== edit.id
        ? inquiry
        : "hidden" in edit
          ? { ...inquiry, hidden: edit.hidden }
          : {
              ...inquiry,
              categories: edit.categories ?? inquiry.ruleCategories,
              categoriesEdited: edit.categories !== null,
            },
    ),
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, startSaving] = useTransition();
  /** 저장 실패 문구. 어느 문의의 것인지 함께 둬 다른 문의를 열었을 때 남지 않게 한다. */
  const [saveError, setSaveError] = useState<{ id: number; message: string } | null>(null);

  const saveCategories = (id: number, categories: CsCategory[] | null) => {
    // 고른 문의를 못 박는다. 목록 첫 문의를 보던 중이면, 고친 카테고리로 거른 목록에서 빠지는 순간
    // 오른쪽이 다음 문의로 넘어가 이어 누른 카테고리가 엉뚱한 문의에 저장된다.
    setSelectedId(id);
    setSaveError(null);
    startSaving(async () => {
      applyEdit({ id, categories });
      const { error } = await saveCsInquiryCategoriesAction(id, categories);
      if (error) setSaveError({ id, message: error });
    });
  };

  /** 숨기기 실패 문구. 숨긴 문의는 오른쪽에서 사라지므로 목록 위에 띄운다. */
  const [hideError, setHideError] = useState<string | null>(null);
  /** 켜면 숨긴 문의만 목록에 세운다. */
  const [showHidden, setShowHidden] = useState(false);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  // 숨긴 문의는 목록 · 건수 · 찾기 어디에도 안 잡힌다. 숨긴 문의 보기를 켜면 숨긴 것만 남는다.
  const pool = useMemo(() => inquiries.filter((inquiry) => inquiry.hidden === showHidden), [inquiries, showHidden]);
  const shown = useMemo(() => inquiries.filter((inquiry) => !inquiry.hidden), [inquiries]);
  const hiddenTotal = inquiries.length - shown.length;

  const hitCounts = useMemo(() => {
    const map = new Map<number, number>();
    if (!searching) return map;
    for (const inquiry of pool) map.set(inquiry.id, countInquiryHits(inquiry, deferredQuery));
    return map;
  }, [pool, searching, deferredQuery]);

  // 찾기와 답변 상태로 거른 문의. 카테고리 건수는 여기서 센다 — 카테고리를 고르면 다른 카테고리 건수가 0 이 되어 버리기 때문이다.
  const narrowed = useMemo(
    () =>
      pool.filter(
        (inquiry) =>
          (!searching || (hitCounts.get(inquiry.id) ?? 0) > 0) &&
          (status === "all" || (status === "waiting") === (inquiry.answer === null)),
      ),
    [pool, searching, hitCounts, status],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<CsCategory, number>();
    for (const inquiry of narrowed) {
      for (const key of inquiry.categories) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [narrowed]);

  const listed = useMemo(() => {
    const filtered = category === "all" ? narrowed : narrowed.filter((inquiry) => inquiry.categories.includes(category));
    // 스냅샷이 최신순이라 오래된 순은 뒤집기만 하면 된다.
    return sort === "newest" ? filtered : [...filtered].reverse();
  }, [narrowed, category, sort]);

  // 카테고리를 고쳐 거른 목록에서 빠져도 보던 문의는 오른쪽에 남긴다. 숨긴 문의 보기를 오가면 그쪽 목록에서 고른다.
  const active = pool.find((inquiry) => inquiry.id === selectedId) ?? listed[0] ?? null;
  const waitingTotal = shown.filter((inquiry) => inquiry.answer === null).length;

  const setHidden = (id: number, hidden: boolean) => {
    // 숨기거나 되돌린 문의는 지금 목록에서 빠지므로 오른쪽은 바로 아래 문의로 넘긴다.
    const index = listed.findIndex((inquiry) => inquiry.id === id);
    const next = index >= 0 ? (listed[index + 1] ?? listed[index - 1] ?? null) : null;
    setSelectedId(next?.id ?? null);
    setHideError(null);
    startSaving(async () => {
      applyEdit({ id, hidden });
      const { error } = await setCsInquiryHiddenAction(id, hidden);
      if (error) setHideError(error);
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

  // 찾는 중이면 문의를 열 때 처음 칠해진 곳으로 옮긴다.
  useEffect(() => {
    previewRef.current?.querySelector("mark[data-hit]")?.scrollIntoView({ block: "center" });
  }, [active?.id, deferredQuery]);

  return (
    <div className="flex flex-col gap-4">
      {/* 불러오기 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm">
        <form action={syncAction}>
          <Button type="submit" variant="outline" size="sm" disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
            {syncing ? "불러오는 중…" : "1:1 문의 불러오기"}
          </Button>
        </form>
        <span className="text-muted-foreground">
          {queryRetrievedAt
            ? `Redash ${formatDateTime(queryRetrievedAt)} 기준 · 문의 ${shown.length}건 · 대기 ${waitingTotal}건` +
              (hiddenTotal > 0 ? ` · 숨김 ${hiddenTotal}건` : "")
            : "아직 불러온 적이 없습니다"}
        </span>
        <a
          href={ADMIN_INQUIRY_URL}
          target="_blank"
          rel="noreferrer"
          className="text-primary ml-auto inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
        >
          관리자 화면에서 답변하기 <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      {syncState.error ? (
        <p className="text-destructive text-sm">{syncState.error}</p>
      ) : syncState.result ? (
        <p className="text-muted-foreground text-sm">
          문의 {syncState.result.inquiries}건(대기 {syncState.result.unanswered}건)을 받았습니다.
          {syncState.result.tests > 0 ? ` 테스트 문의 ${syncState.result.tests}건은 모으지 않았습니다.` : ""}
          {syncState.result.skipped > 0 ? (
            <span className="text-destructive">
              {` 문의 번호 · 등록일시를 읽지 못한 ${syncState.result.skipped}건은 빠졌습니다 — 쿼리 337 을 확인하세요.`}
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
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="고객 이름 · 제목 · 챌린지 · 플랜 · 본문에서 찾기 (⌘F)"
              className="pl-8"
              aria-label="문의에서 찾기"
            />
          </div>
          <NativeSelect
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="w-auto"
            aria-label="답변 상태"
          >
            <option value="all">답변 상태 전체</option>
            <option value="waiting">대기</option>
            <option value="answered">완료</option>
          </NativeSelect>
          <NativeSelect
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="w-auto"
            aria-label="줄 세우기"
          >
            <option value="newest">최신순</option>
            <option value="oldest">오래된 순</option>
          </NativeSelect>
          <span className="text-muted-foreground text-sm">
            {listed.length === pool.length ? `${pool.length}건` : `${pool.length}건 중 ${listed.length}건`}
          </span>
          {hiddenTotal > 0 || showHidden ? (
            <Button
              type="button"
              variant={showHidden ? "default" : "ghost"}
              size="sm"
              aria-pressed={showHidden}
              onClick={() => setShowHidden(!showHidden)}
              className="ml-auto"
            >
              <EyeOff aria-hidden />
              {showHidden ? "숨긴 문의 보는 중 · 돌아가기" : `숨긴 문의 보기 ${hiddenTotal}`}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="카테고리">
          <CategoryChip label="전체" count={narrowed.length} active={category === "all"} onClick={() => setCategory("all")} />
          {CS_CATEGORIES.map((entry) => (
            <CategoryChip
              key={entry.key}
              label={entry.label}
              title={entry.hint}
              count={categoryCounts.get(entry.key) ?? 0}
              active={category === entry.key}
              onClick={() => setCategory(category === entry.key ? "all" : entry.key)}
            />
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          대소문자와 띄어쓰기는 가리지 않고, 답변 내용도 함께 찾습니다. 한 문의에 카테고리가 여러 개 붙을 수 있어
          카테고리 건수를 더하면 문의 수보다 많습니다.
        </p>
        {hideError ? <p className="text-destructive text-xs">{hideError}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[30rem_minmax(0,1fr)]">
        {/* 목록 */}
        <ul className="flex max-h-[calc(100vh-18rem)] min-w-0 flex-col divide-y overflow-y-auto rounded-lg border">
          {listed.length === 0 ? (
            <li className="text-muted-foreground p-4 text-sm">
              {inquiries.length === 0
                ? "1:1 문의 불러오기를 눌러 문의를 받아오세요."
                : showHidden && pool.length === 0
                  ? "숨긴 문의가 없습니다."
                  : "조건에 맞는 문의가 없습니다."}
            </li>
          ) : null}
          {listed.map((inquiry) => {
            const days = waitingDays(inquiry, queryRetrievedAt);
            const hits = hitCounts.get(inquiry.id) ?? 0;
            return (
              <li key={inquiry.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(inquiry.id)}
                  className={cn(
                    "hover:bg-muted flex w-full flex-col items-start gap-1 p-2.5 text-left text-sm",
                    inquiry.id === active?.id && "bg-muted",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <StatusBadge answered={inquiry.answer !== null} />
                    <span className="min-w-0 flex-1 truncate font-medium" title={inquiry.title}>
                      <Highlight text={inquiry.title} query={deferredQuery} />
                    </span>
                    {searching && hits > 0 ? (
                      <span className="shrink-0 rounded bg-yellow-200 px-1 text-xs font-medium text-black">{hits}건</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs">
                    <Highlight text={inquiry.customerName} query={deferredQuery} />
                    {inquiry.plan ? (
                      <>
                        {" · "}
                        <Highlight text={inquiry.plan} query={deferredQuery} />
                      </>
                    ) : null}
                    {" · "}
                    <Highlight text={inquiry.challengeTitle} query={deferredQuery} />
                  </span>
                  <span className="flex w-full flex-wrap items-center gap-1">
                    <span className="text-muted-foreground mr-1 text-xs tabular-nums">
                      {formatDateTime(inquiry.createdAt)}
                      {days !== null ? ` · ${waitingLabel(days)}` : ""}
                    </span>
                    {inquiry.categories.map((key) => (
                      <CategoryBadge key={key} category={key} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* 문의 보기 */}
        <section className="flex min-w-0 flex-col gap-3">
          {active ? (
            <InquiryDetail
              key={active.id}
              inquiry={active}
              query={deferredQuery}
              waiting={waitingDays(active, queryRetrievedAt)}
              saving={saving}
              saveError={saveError?.id === active.id ? saveError.message : null}
              onSaveCategories={(categories) => saveCategories(active.id, categories)}
              onSetHidden={(hidden) => setHidden(active.id, hidden)}
              previewRef={previewRef}
            />
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 문의를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  title,
  count,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  count: number;
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
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function InquiryDetail({
  inquiry,
  query,
  waiting,
  saving,
  saveError,
  onSaveCategories,
  onSetHidden,
  previewRef,
}: {
  inquiry: CsInquiryRow;
  query: string;
  waiting: number | null;
  saving: boolean;
  saveError: string | null;
  onSaveCategories: (categories: CsCategory[] | null) => void;
  onSetHidden: (hidden: boolean) => void;
  previewRef: React.RefObject<HTMLDivElement | null>;
}) {
  const toggle = (key: CsCategory) => {
    const next = inquiry.categories.includes(key)
      ? inquiry.categories.filter((current) => current !== key)
      : normalizeCategories([...inquiry.categories, key]);
    // 하나도 안 남기면 어느 카테고리에서도 안 보이는 문의가 생긴다.
    if (next.length > 0) onSaveCategories(next);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge answered={inquiry.answer !== null} />
          <h2 className="text-base font-semibold">
            <Highlight text={inquiry.title} query={query} />
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSetHidden(!inquiry.hidden)} className="ml-auto">
            {inquiry.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
            {inquiry.hidden ? "다시 보이기" : "목록에서 숨기기"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground">
            <Highlight text={inquiry.customerName} query={query} />
          </span>
          {inquiry.plan ? (
            <>
              {" · "}
              <Highlight text={inquiry.plan} query={query} />
            </>
          ) : (
            " · 플랜 없음"
          )}
          {" · "}
          <Highlight text={inquiry.challengeTitle} query={query} />
          {` · ${formatDateTime(inquiry.createdAt)} 문의`}
          {waiting !== null ? ` · ${waitingLabel(waiting)}` : ""}
        </p>
      </div>

      {/* 카테고리 */}
      <div className="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {CS_CATEGORIES.map((entry) => {
            const on = inquiry.categories.includes(entry.key);
            return (
              <button
                key={entry.key}
                type="button"
                title={entry.hint}
                aria-pressed={on}
                disabled={on && inquiry.categories.length === 1}
                onClick={() => toggle(entry.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs disabled:cursor-not-allowed",
                  on ? "border-blue-300 bg-blue-50 text-blue-800" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          {inquiry.categoriesEdited ? (
            <>
              매니저가 고친 카테고리입니다. 불러오기를 다시 해도 바뀌지 않습니다.
              <button
                type="button"
                onClick={() => onSaveCategories(null)}
                className="text-primary inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
              >
                <RotateCcw className="size-3" aria-hidden />
                키워드 규칙으로 되돌리기 ({inquiry.ruleCategories.map((key) => CS_CATEGORY_LABELS[key]).join(", ")})
              </button>
            </>
          ) : (
            "키워드 규칙이 붙인 카테고리입니다. 누르면 고칠 수 있습니다."
          )}
          {saving ? <span>저장하는 중…</span> : null}
          {saveError ? <span className="text-destructive">{saveError}</span> : null}
        </p>
      </div>

      <div ref={previewRef} className="flex max-h-[calc(100vh-22rem)] flex-col gap-4 overflow-y-auto rounded-lg border p-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-xs font-medium">문의 내용</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            <Highlight text={inquiry.body} query={query} />
          </p>
          <ImageList urls={inquiry.imageUrls} />
        </section>

        <section className="flex flex-col gap-1.5 border-t pt-4">
          <h3 className="text-muted-foreground text-xs font-medium">
            답변
            {inquiry.answer !== null ? (inquiry.answerReadAt ? " · 고객이 읽음" : " · 고객이 아직 읽지 않음") : ""}
          </h3>
          {inquiry.answer !== null ? (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                <Highlight text={inquiry.answer} query={query} />
              </p>
              <ImageList urls={inquiry.answerImageUrls} />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              아직 답변하지 않았습니다. 답변은{" "}
              <a href={ADMIN_INQUIRY_URL} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                관리자 화면
              </a>
              에서 답니다.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

/** 첨부 이미지. 실서비스 저장소에 그대로 있으니 원본으로 잇는다. */
function ImageList({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url, index) => (
        <a key={`${index}-${url}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border">
          {/* eslint-disable-next-line @next/next/no-img-element -- 외부 저장소 원본을 그대로 보여준다 */}
          <img src={url} alt="첨부 이미지" className="h-40 w-auto object-contain" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

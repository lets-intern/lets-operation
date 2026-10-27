"use client";

import { cn } from "cn";
import { ChevronDown, ChevronUp, ExternalLink, MonitorDown, RefreshCw, ScanText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  contentImageSrcs,
  isDetailImageSrc,
  DETAIL_SECTION_LABELS,
  DETAIL_STATUS_LABELS,
  findMatches,
  summarizeMatches,
  type DetailBlock,
  type DetailPageContent,
  type DetailPlan,
  type PageMatchSummary,
} from "@/domain/detail-page-content";
import type { DetailPageRow } from "@/domain/service-detail-page";

import { readScreens, saveImageText, syncDetailPages, type DetailSyncState } from "./actions";
import { createOcrWorker, readImageText } from "./ocr";

const INITIAL_SYNC_STATE: DetailSyncState = { error: null, result: null, at: 0 };

type StatusFilter = "all" | "PROCEEDING" | "past";
type Scope = "all" | "checked";

type OcrProgress = { done: number; total: number; failed: number };

/** 화면 읽기 진행. total 은 첫 묶음이 돌아와야 안다. */
type ScreenProgress = { done: number; total: number | null; stopping: boolean };

/** 워커 하나로 오래 읽으면 엔진 메모리가 쌓인다는 보고가 있어 이만큼마다 새로 띄운다. */
const OCR_WORKER_RECYCLE = 40;

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

function statusLabel(status: string): string {
  return DETAIL_STATUS_LABELS[status] ?? status;
}

/** 링크는 저쪽 데이터라 http(s) 만 걸어준다. 그 밖의 주소는 글로만 보인다. */
function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

export function DetailPagesPanel({
  pages,
  imageTexts: savedImageTexts,
  lastFetchedAt,
}: {
  pages: DetailPageRow[];
  imageTexts: Record<string, string>;
  lastFetchedAt: string | null;
}) {
  const router = useRouter();

  // 사본을 새로 받으면 이어서 화면을 읽는다. 기다리지 않는다 — 불러오기 버튼이 몇 분씩 묶이면 안 된다.
  const [syncState, syncAction, syncing] = useActionState(async () => {
    const next = await syncDetailPages();
    if (next.result) void readPageScreens();
    return next;
  }, INITIAL_SYNC_STATE);

  // 이 화면에서 방금 읽은 글. 저장은 되었지만 서버가 다시 그려주지 않으므로 여기서 더한다.
  const [readTexts, setReadTexts] = useState<Record<string, string>>({});
  const imageTexts = useMemo(
    () => ({ ...savedImageTexts, ...readTexts }),
    [savedImageTexts, readTexts],
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [scope, setScope] = useState<Scope>("all");
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [onlyHits, setOnlyHits] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(pages[0]?.id ?? null);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const visiblePages = useMemo(
    () =>
      pages.filter((page) => {
        if (statusFilter === "PROCEEDING") return page.status === "PROCEEDING";
        if (statusFilter === "past") return page.status !== "PROCEEDING";
        return true;
      }),
    [pages, statusFilter],
  );

  const targetPages = useMemo(
    () => (scope === "checked" ? visiblePages.filter((page) => checked.has(page.id)) : visiblePages),
    [scope, visiblePages, checked],
  );
  const targetIds = useMemo(() => new Set(targetPages.map((page) => page.id)), [targetPages]);

  const summaries = useMemo(() => {
    const map = new Map<number, PageMatchSummary>();
    if (!searching) return map;
    for (const page of targetPages) {
      if (page.content) map.set(page.id, summarizeMatches(page.content, imageTexts, deferredQuery));
    }
    return map;
  }, [searching, targetPages, imageTexts, deferredQuery]);

  const hitPageCount = [...summaries.values()].filter((summary) => summary.total > 0).length;
  const hitTotal = [...summaries.values()].reduce((sum, summary) => sum + summary.total, 0);

  // 대상 안에서 0건인 페이지만 숨긴다. 대상 밖 페이지까지 숨기면 체크를 하나 푸는 순간
  // 그 페이지가 목록에서 사라져 다시 체크할 길이 없다.
  const listedPages =
    searching && onlyHits
      ? visiblePages.filter((page) => !targetIds.has(page.id) || (summaries.get(page.id)?.total ?? 0) > 0)
      : visiblePages;

  const activePage = pages.find((page) => page.id === activeId) ?? null;
  // 대상에서 뺀 페이지를 보고 있으면 칠하지 않는다. 목록 건수와 미리보기가 어긋나 보인다.
  const previewQuery = activePage && targetIds.has(activePage.id) ? deferredQuery : "";
  const activeSummary =
    activePage?.content && previewQuery.trim()
      ? summarizeMatches(activePage.content, imageTexts, previewQuery)
      : null;
  const hitCount = activeSummary?.total ?? 0;

  // 몇 번째 일치를 보고 있는지. 페이지나 검색어가 바뀌면 첫 번째로 돌아간다.
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
  // 옮기기는 보는 자리가 바뀔 때만 한다. 이미지를 읽는 동안 한 장 끝날 때마다 끌려가면 읽을 수가 없다.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const marks = container.querySelectorAll<HTMLElement>("mark[data-hit]");
    marks.forEach((mark, index) => {
      if (index === hitIndex) mark.setAttribute("data-active", "");
      else mark.removeAttribute("data-active");
    });
    const position = `${hitKey}#${hitIndex}`;
    if (marks[hitIndex] && scrolledToRef.current !== position) {
      scrolledToRef.current = position;
      marks[hitIndex].scrollIntoView({ block: "center" });
    }
  }, [hitIndex, hitKey, imageTexts]);

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

  const toggleChecked = (id: number) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allListedChecked = listedPages.length > 0 && listedPages.every((page) => checked.has(page.id));
  const toggleAllListed = () => {
    setChecked((previous) => {
      const next = new Set(previous);
      for (const page of listedPages) {
        if (allListedChecked) next.delete(page.id);
        else next.add(page.id);
      }
      return next;
    });
  };

  // ── 이미지 글자 읽기 ──
  const unreadSrcs = useMemo(() => {
    const srcs = new Set<string>();
    for (const page of targetPages) {
      if (!page.content) continue;
      for (const src of contentImageSrcs(page.content)) {
        if (imageTexts[src] === undefined && isDetailImageSrc(src)) srcs.add(src);
      }
    }
    return [...srcs];
  }, [targetPages, imageTexts]);

  const [ocr, setOcr] = useState<OcrProgress | null>(null);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const stopRef = useRef(false);

  // 다른 메뉴로 옮겨가도 읽기가 뒤에서 계속 돌며 CPU 와 메모리를 붙들지 않게 한다.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current = true;
      stopScreenRef.current = true;
    };
  }, []);

  // ── 실서비스 화면 읽기 ──
  // 목록에 있는 페이지 중 화면을 한 번도 못 읽었거나 마지막 읽기가 실패한 것. 바뀐 페이지는 서버만 알아 여기 안 잡힌다.
  const unreadScreenCount = pages.filter(
    (page) => page.content && !page.delisted && (!page.screenRead || page.screenError),
  ).length;

  const [screen, setScreen] = useState<ScreenProgress | null>(null);
  const [screenMessage, setScreenMessage] = useState<string | null>(null);
  const stopScreenRef = useRef(false);
  const screenRunningRef = useRef(false);
  const mountedRef = useRef(true);

  const stopScreens = () => {
    stopScreenRef.current = true;
    // 지금 묶음이 끝나야 멈추므로 수십 초 걸릴 수 있다. 눌린 것은 바로 보여준다.
    setScreen((previous) => (previous ? { ...previous, stopping: true } : previous));
  };

  const readPageScreens = async () => {
    if (screenRunningRef.current) return;
    screenRunningRef.current = true;
    stopScreenRef.current = false;
    setScreenMessage(null);
    setScreen({ done: 0, total: null, stopping: false });

    // 차례의 시작 시각은 첫 묶음에서 서버가 정한다. 브라우저 시계는 서버와 어긋날 수 있다.
    let startedAt: string | null = null;
    let read = 0;
    const failed: { title: string; reason: string }[] = [];
    try {
      for (;;) {
        const response = await readScreens(startedAt);
        if (!response.result) {
          setScreenMessage(`실서비스 화면을 읽지 못했습니다. ${response.error ?? ""}`);
          break;
        }
        const { result } = response;
        startedAt = result.startedAt;
        read += result.read;
        failed.push(...result.failed);
        const done = read + failed.length;
        setScreen({ done, total: done + result.remaining, stopping: stopScreenRef.current });
        // 한 묶음에서 아무것도 못 했으면 같은 자리에서 돌기만 하므로 멈춘다.
        if (result.remaining === 0 || stopScreenRef.current || result.read + result.failed.length === 0) {
          const stopped = result.remaining > 0 ? " (중간에 멈춤)" : "";
          setScreenMessage(
            (done === 0
              ? result.remaining > 0
                ? "시간 안에 실서비스 페이지를 하나도 열지 못했습니다. 잠시 뒤 화면 읽기를 다시 눌러 주세요."
                : "바뀐 페이지가 없어 화면을 다시 읽지 않았습니다."
              : `실서비스 화면 ${read}개를 새로 읽었습니다${stopped}.`) +
              (failed.length > 0
                ? ` 읽지 못한 페이지: ${failed.map((failure) => `${failure.title}(${failure.reason})`).join(", ")} — 예전에 읽은 화면은 그대로 둡니다.`
                : ""),
          );
          break;
        }
      }
    } catch (error) {
      setScreenMessage(`실서비스 화면을 읽지 못했습니다. ${error instanceof Error ? error.message : ""}`);
    } finally {
      screenRunningRef.current = false;
      setScreen(null);
      // 읽은 화면은 서버가 사본에 끼워 넣어 그리므로 새로 받아야 보인다.
      // 다른 메뉴로 옮긴 뒤라면 새로 그리지 않는다. 지금 보고 있는 다른 화면이 다시 그려진다.
      if (mountedRef.current && (read > 0 || failed.length > 0)) router.refresh();
    }
  };

  const readImages = async () => {
    const srcs = unreadSrcs;
    if (srcs.length === 0) return;
    stopRef.current = false;
    setOcrMessage(null);
    const progress: OcrProgress = { done: 0, total: srcs.length, failed: 0 };
    setOcr({ ...progress });
    const shouldStop = () => stopRef.current;

    let worker: Awaited<ReturnType<typeof createOcrWorker>> | null = null;
    try {
      worker = await createOcrWorker();
      for (const [index, src] of srcs.entries()) {
        if (stopRef.current) break;
        if (index > 0 && index % OCR_WORKER_RECYCLE === 0) {
          await worker.terminate();
          worker = await createOcrWorker();
        }
        try {
          const text = await readImageText(worker, src, shouldStop);
          if (text === null) break;
          const saved = await saveImageText(src, text);
          if (saved.error) throw new Error(saved.error);
          setReadTexts((previous) => ({ ...previous, [src]: text }));
        } catch {
          progress.failed += 1;
        }
        progress.done += 1;
        setOcr({ ...progress });
      }
      const stopped = progress.done < progress.total ? " (중간에 멈춤)" : "";
      setOcrMessage(
        `이미지 ${progress.done - progress.failed}장을 읽었습니다${stopped}.` +
          (progress.failed > 0 ? ` ${progress.failed}장은 읽지 못해 다음에 다시 시도합니다.` : ""),
      );
    } catch (error) {
      setOcrMessage(
        `글자 인식 엔진을 불러오지 못했습니다. ${error instanceof Error ? error.message : ""}`,
      );
    } finally {
      await worker?.terminate();
      setOcr(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 불러오기 · 이미지 읽기 */}
      {/* 왼쪽은 사본을 받는 일, 오른쪽은 그 사본의 이미지를 읽는 일. 버튼 이름은 고정하고 상태는 옆 문구로 적는다. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <form action={syncAction}>
            {/* 화면을 읽는 동안 사본을 새로 받으면, 이미 읽은 페이지가 바뀐 사본으로 다시 읽히지 않은 채 남는다. */}
            <Button type="submit" variant="outline" size="sm" disabled={syncing || screen !== null}>
              <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden />
              {syncing ? "불러오는 중…" : "상세페이지 불러오기"}
            </Button>
          </form>
          <span className="text-muted-foreground">
            {lastFetchedAt
              ? `${formatDateTime(lastFetchedAt)}에 받은 사본 · ${pages.length}개`
              : "아직 불러온 적이 없습니다"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground tabular-nums">
            {screen
              ? screen.stopping
                ? "지금 묶음을 마치고 멈추는 중…"
                : screen.total === null
                ? "실서비스 화면 읽는 중…"
                : `실서비스 화면 읽는 중 ${screen.done} / ${screen.total}개`
              : unreadScreenCount > 0
                ? `화면을 못 읽은 페이지 ${unreadScreenCount}개`
                : "실서비스 화면까지 읽은 사본입니다"}
          </span>
          {screen ? (
            <Button type="button" variant="outline" size="sm" onClick={stopScreens} disabled={screen.stopping}>
              <MonitorDown aria-hidden />
              멈추기
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => void readPageScreens()} disabled={syncing}>
              <MonitorDown aria-hidden />
              화면 읽기
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground tabular-nums">
            {ocr
              ? `읽는 중 ${ocr.done} / ${ocr.total}장`
              : unreadSrcs.length > 0
                ? `찾을 대상에 안 읽은 이미지 ${unreadSrcs.length}장`
                : "찾을 대상의 이미지를 모두 읽었습니다"}
          </span>
          {ocr ? (
            <Button type="button" variant="outline" size="sm" onClick={() => (stopRef.current = true)}>
              <ScanText aria-hidden />
              멈추기
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={readImages}
              disabled={unreadSrcs.length === 0}
            >
              <ScanText aria-hidden />
              이미지 글자 읽기
            </Button>
          )}
        </div>
      </div>

      {syncState.error ? (
        <p className="text-destructive text-sm">{syncState.error}</p>
      ) : syncState.result ? (
        <p className="text-muted-foreground text-sm">
          {syncState.result.listed}개 중 {syncState.result.fetched}개를 받았습니다.
          {syncState.result.failed.length > 0
            ? ` 받지 못한 페이지: ${syncState.result.failed
                .map((failure) => `${failure.title}(${failure.reason})`)
                .join(", ")} — 예전 사본은 그대로 둡니다.`
            : ""}
        </p>
      ) : null}
      {screenMessage ? <p className="text-muted-foreground text-sm">{screenMessage}</p> : null}
      {ocrMessage ? <p className="text-muted-foreground text-sm">{ocrMessage}</p> : null}

      {/* 찾기 */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b py-2 backdrop-blur">
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
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
            placeholder="상세페이지에서 찾기 (⌘F)"
            className="pl-8"
            aria-label="상세페이지에서 찾기"
          />
        </div>
        <NativeSelect
          value={scope}
          onChange={(event) => setScope(event.target.value as Scope)}
          className="w-auto"
          aria-label="찾을 대상"
        >
          <option value="all">목록의 전체 페이지</option>
          <option value="checked">
            체크한 페이지만 ({visiblePages.filter((page) => checked.has(page.id)).length})
          </option>
        </NativeSelect>
        {searching ? (
          <span className="text-muted-foreground text-sm">
            {targetPages.length}개 중 {hitPageCount}개 페이지에서 {hitTotal}건
          </span>
        ) : null}
        <p className="text-muted-foreground w-full text-xs">
          대소문자와 띄어쓰기는 가리지 않습니다. 이미지 속 글자는 자동 인식이라 틀리거나 빠질 수 있어,
          이미지에서 못 찾았다고 없는 것은 아닙니다.
        </p>
      </div>

      {/* 목록 폭은 가장 긴 제목(약 400px)이 체크박스 · 링크 아이콘과 함께 한 줄에 들어가게 잡았다. */}
      <div className="grid gap-4 lg:grid-cols-[34rem_minmax(0,1fr)]">
        {/* 목록 */}
        <section className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <NativeSelect
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="w-auto"
              aria-label="모집 상태"
            >
              <option value="all">전체 상태</option>
              <option value="PROCEEDING">진행 중</option>
              <option value="past">지난 · 그 밖</option>
            </NativeSelect>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={allListedChecked} onChange={toggleAllListed} />
              보이는 것 모두 체크
            </label>
            {searching ? (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyHits} onChange={(event) => setOnlyHits(event.target.checked)} />
                찾은 페이지만
              </label>
            ) : null}
          </div>

          <ul className="flex max-h-[calc(100vh-16rem)] flex-col divide-y overflow-y-auto rounded-lg border">
            {listedPages.length === 0 ? (
              <li className="text-muted-foreground p-4 text-sm">
                {pages.length === 0 ? "상세페이지 불러오기를 눌러 목록을 받아오세요." : "해당하는 페이지가 없습니다."}
              </li>
            ) : null}
            {listedPages.map((page) => {
              const summary = summaries.get(page.id);
              const active = page.id === activeId;
              return (
                <li key={page.id} className={cn("flex gap-2 p-2.5 text-sm", active && "bg-muted")}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked.has(page.id)}
                    onChange={() => toggleChecked(page.id)}
                    aria-label={`${page.title} 체크`}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                    onClick={() => setActiveId(page.id)}
                  >
                    {/* 폭을 넘는 제목이 새로 생겨도 줄바꿈하지 않고 줄인다. 전체 제목은 툴팁으로 본다. */}
                    <span className="w-full truncate font-medium" title={page.title}>
                      {page.title}
                    </span>
                    <span className="text-muted-foreground w-full truncate text-xs">
                      {statusLabel(page.status)}
                      {page.startDate ? ` · ${page.startDate} 시작` : ""}
                      {!page.content ? " · 내용 없음" : ""}
                      {page.delisted ? " · 실서비스 목록에서 사라짐" : ""}
                    </span>
                    {searching && targetIds.has(page.id) ? (
                      summary && summary.total > 0 ? (
                        <span className="w-full truncate text-xs">
                          <span className="rounded bg-yellow-200 px-1 font-medium text-black">{summary.total}건</span>{" "}
                          {summary.sections
                            .map((section) => `${DETAIL_SECTION_LABELS[section.key]} ${section.count}`)
                            .join(" · ")}
                          {summary.inImages > 0 ? ` (이미지 속 ${summary.inImages})` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">없음</span>
                      )
                    ) : null}
                  </button>
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground mt-0.5"
                    aria-label={`${page.title} 실서비스에서 보기`}
                  >
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 미리보기 */}
        <section className="flex min-w-0 flex-col gap-2">
          {activePage ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{activePage.title}</h2>
                <a
                  href={activePage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                >
                  실서비스에서 보기 <ExternalLink className="size-3" aria-hidden />
                </a>
                {previewQuery.trim() ? (
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
                  <span className="text-muted-foreground ml-auto text-xs">찾을 대상에서 빠진 페이지입니다</span>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                받아온 내용으로 다시 그린 미리보기라 실서비스와 모양이 다릅니다.
                {activePage.fetchedAt ? ` ${formatDateTime(activePage.fetchedAt)}에 받은 사본입니다.` : ""}
                {activePage.fetchError ? ` 마지막 받아오기 실패: ${activePage.fetchError}` : ""}
                {activePage.screenRead
                  ? " 왼쪽 줄이 그어진 글과 이미지는 관리자 화면 입력값이 아니라 실서비스 화면에서 읽은 것입니다."
                  : " 실서비스 화면을 아직 읽지 않아 화면 고정 문구가 빠져 있습니다."}
                {activePage.screenError ? ` 마지막 화면 읽기 실패: ${activePage.screenError}` : ""}
              </p>

              <div
                ref={previewRef}
                className="max-h-[calc(100vh-16rem)] overflow-y-auto rounded-lg border p-4"
              >
                {activePage.content ? (
                  <PagePreview
                    key={activePage.id}
                    content={activePage.content}
                    imageTexts={imageTexts}
                    query={previewQuery}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">받아온 내용이 없습니다.</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 페이지를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function PagePreview({
  content,
  imageTexts,
  query,
}: {
  content: DetailPageContent;
  imageTexts: Record<string, string>;
  query: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      {content.sections.map((section) => (
        <section key={section.key} className="flex flex-col gap-3">
          <h3 className="text-muted-foreground border-b pb-1 text-xs font-semibold tracking-wide">
            {DETAIL_SECTION_LABELS[section.key]}
          </h3>
          {section.blocks.map((block, index) => (
            <PreviewBlock key={index} block={block} imageTexts={imageTexts} query={query} />
          ))}
        </section>
      ))}
    </div>
  );
}

function PreviewBlock({
  block,
  imageTexts,
  query,
}: {
  block: DetailBlock;
  imageTexts: Record<string, string>;
  query: string;
}) {
  switch (block.kind) {
    case "title":
      return (
        <p className="text-lg leading-snug font-semibold">
          <Highlight text={block.text} query={query} />
        </p>
      );
    case "text":
      return (
        <p
          className={cn(
            "text-sm leading-relaxed whitespace-pre-wrap",
            block.screen && "border-muted-foreground/30 border-l-2 pl-3",
          )}
        >
          <Highlight text={block.text} query={query} />
        </p>
      );
    case "link": {
      const href = safeHref(block.href);
      return (
        <p className="text-sm">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              <Highlight text={block.text} query={query} />
            </a>
          ) : (
            <Highlight text={block.text} query={query} />
          )}
        </p>
      );
    }
    case "item":
      return (
        <div className="bg-muted/40 flex flex-col gap-1 rounded-md p-3 text-sm">
          {block.meta ? (
            <span className="text-muted-foreground text-xs">
              <Highlight text={block.meta} query={query} />
            </span>
          ) : null}
          {block.title ? (
            <span className="font-medium">
              <Highlight text={block.title} query={query} />
            </span>
          ) : null}
          {block.body ? (
            <span className="leading-relaxed whitespace-pre-wrap">
              <Highlight text={block.body} query={query} />
            </span>
          ) : null}
        </div>
      );
    case "image":
      return block.screen ? (
        <div className="border-muted-foreground/30 border-l-2 pl-3">
          <PreviewImage src={block.src} text={imageTexts[block.src]} query={query} />
        </div>
      ) : (
        <PreviewImage src={block.src} text={imageTexts[block.src]} query={query} />
      );
    case "plans":
      return <PlanTabs plans={block.plans} query={query} />;
  }
}

/**
 * 실서비스 상단의 요금제 탭. 고른 탭의 설명을 보여주되, 찾는 중에는 다른 탭 설명에 걸린 곳도
 * 함께 펼친다. 접힌 탭 속 일치가 건수에만 잡히고 화면에서 사라지면 안 된다(plan.md §5).
 */
function PlanTabs({ plans, query }: { plans: DetailPlan[]; query: string }) {
  const [selected, setSelected] = useState(0);
  const hitsIn = (plan: DetailPlan) =>
    query.trim() ? findMatches(plan.meta, query).length + findMatches(plan.body, query).length : 0;

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" className="flex flex-wrap gap-1 border-b">
        {plans.map((plan, index) => {
          const hits = hitsIn(plan);
          return (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === selected}
              onClick={() => setSelected(index)}
              className={cn(
                "-mb-px rounded-t-md border px-3 py-1.5 text-sm",
                index === selected
                  ? "bg-background border-b-background font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Highlight text={plan.label} query={query} />
              {index !== selected && hits > 0 ? (
                <span className="ml-1 rounded bg-yellow-200 px-1 text-xs text-black">{hits}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {plans.map((plan, index) =>
        index === selected || hitsIn(plan) > 0 ? (
          <div key={index} role="tabpanel" className="bg-muted/40 flex flex-col gap-1 rounded-md p-3 text-sm">
            {index !== selected ? (
              <span className="text-xs font-medium">{plan.label} 탭에서 찾음</span>
            ) : null}
            {plan.meta ? (
              <span className="text-muted-foreground text-xs">
                <Highlight text={plan.meta} query={query} />
              </span>
            ) : null}
            {plan.body ? (
              <span className="leading-relaxed whitespace-pre-wrap">
                <Highlight text={plan.body} query={query} />
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">설명이 비어 있습니다</span>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}

/**
 * 이미지 속 일치는 글자 위치까지 칠하지 못한다. 이미지에 노란 테두리를 두르고,
 * 읽어낸 글을 펼쳐 그 안에서 칠한다(plan.md §5).
 */
function PreviewImage({ src, text, query }: { src: string; text: string | undefined; query: string }) {
  const [open, setOpen] = useState(false);
  const hits = text && query.trim() ? findMatches(text, query).length : 0;
  // 일치가 있으면 늘 펼친다. 접혀 있으면 칠해진 곳이 건수에는 잡히는데 화면에서 사라진다.
  const expanded = hits > 0 || open;

  return (
    <figure className={cn("flex flex-col gap-1.5 rounded-md", hits > 0 && "ring-4 ring-yellow-300")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 저쪽 저장소 이미지를 그대로 보여준다 */}
      <img src={src} alt="" loading="lazy" className="w-full rounded-md" />
      <figcaption className="px-1 pb-1 text-xs">
        {!isDetailImageSrc(src) ? (
          <span className="text-muted-foreground">저장소 밖 이미지라 글자를 읽지 않습니다</span>
        ) : text === undefined ? (
          <span className="text-muted-foreground">아직 글자를 읽지 않은 이미지</span>
        ) : text === "" ? (
          <span className="text-muted-foreground">읽어낸 글자가 없는 이미지</span>
        ) : hits > 0 ? (
          <span className="font-medium">이미지 속 글자에서 {hits}건</span>
        ) : (
          <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => setOpen(!open)}>
            {open ? "읽어낸 글 접기" : "읽어낸 글 보기"}
          </button>
        )}
        {expanded && text ? (
          <p className="bg-muted/40 mt-1 rounded p-2 leading-relaxed whitespace-pre-wrap">
            <Highlight text={text} query={query} />
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

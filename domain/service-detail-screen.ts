import { createHash } from "node:crypto";

import type { Browser, Page } from "puppeteer-core";

import { prisma } from "@/lib/prisma";

import {
  detailPageUrl,
  dropRepeatedRuns,
  isDetailPageContent,
  screenImageSrc,
  SERVICE_SITE_ORIGIN,
  type ScreenItem,
} from "./detail-page-content";
import { errorMessage, mapWithConcurrency } from "./service-detail-page";

/**
 * 실서비스 상세페이지를 헤드리스 크롬으로 띄워 보이는 글과 이미지를 읽는 일
 * (plan.md §5 — 화면에만 있는 문구도 읽는다).
 *
 * 페이지의 절반 이상이 API 가 아니라 실서비스 코드에 챌린지 종류별로 박힌 문구라, 화면을 그려야만 보인다.
 * 서버 실행 시간 제한이 있어 한 번에 몇 페이지씩만 읽고, 화면이 다음 묶음을 다시 부른다.
 */

/** 한 브라우저에서 동시에 여는 탭 수. 탭 하나가 1~3초라 이만큼이면 한 묶음에 수십 페이지를 읽는다. */
const SCREEN_CONCURRENCY = 3;

/**
 * 한 번 부를 때 이 시간이 지나면 새 페이지를 열지 않는다. 불린 순간부터 잰다.
 * 마지막 페이지의 최악(이동 20초 + 재시도 대기 10초 + 읽기 20초)을 더해도 page.tsx 의 maxDuration(120초) 안에 든다.
 */
const SCREEN_BUDGET_MS = 45_000;

const NAVIGATION_TIMEOUT_MS = 20_000;

/** 브라우저에 보내는 명령 하나의 한도. 기본값(180초)이면 렌더러가 멈췄을 때 함수 제한 시간을 넘긴다. */
const PROTOCOL_TIMEOUT_MS = 20_000;

/** 본문 칸. 머리글 · 바닥글 · 아래에 떠 있는 신청 막대를 뺀 자리다. 사이트 개편 때 바뀌면 읽기가 실패로 남는다. */
const CONTENT_ROOT_SELECTOR = "#root > div > div.min-h-\\[31rem\\] > div";

/** 페이지를 그리는 데 필요한 요청만 보낸다. 이미지 · 글꼴은 주소만 있으면 되고, 분석 · 채팅 위젯은 느리게만 한다. */
const ALLOWED_REQUEST_HOSTS = ["www.letscareer.co.kr", "3ccm7bgq1b.execute-api.ap-northeast-2.amazonaws.com"];
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

/** macOS 개발 환경에서 쓰는 크롬. 다른 곳에 깔려 있으면 CHROME_EXECUTABLE_PATH 로 알려준다. */
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function launchBrowser(): Promise<Browser> {
  const { default: puppeteer } = await import("puppeteer-core");
  if (process.platform === "linux") {
    // 배포(Vercel)는 크롬이 없는 리눅스라 압축해 싣고 다니는 크롬을 푼다.
    const { default: chromium } = await import("@sparticuz/chromium");
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      protocolTimeout: PROTOCOL_TIMEOUT_MS,
    });
  }
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || MAC_CHROME;
  // 파일이 있는지 미리 보지 않는다. 경로를 fs 로 건드리면 빌드가 프로젝트 전체를 배포물에 싣는다.
  return puppeteer.launch({ executablePath, headless: true, protocolTimeout: PROTOCOL_TIMEOUT_MS }).catch((error: unknown) => {
    throw new Error(`크롬을 띄우지 못했습니다(${executablePath}). CHROME_EXECUTABLE_PATH 를 확인하세요. ${errorMessage(error)}`);
  });
}

/**
 * 실서비스 배포 번호. 화면 고정 문구는 배포로만 바뀌므로, 이 값이 바뀌면 내용이 같아도 다시 읽는다.
 * 찾지 못하면 날짜로 대신한다 — 하루 한 번은 다시 읽게 되지만 바뀐 문구를 놓치지는 않는다.
 */
async function siteBuildId(): Promise<string> {
  try {
    const response = await fetch(`${SERVICE_SITE_ORIGIN}/program`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const match = (await response.text()).match(/[?&]dpl=(dpl_[A-Za-z0-9]+)/);
    if (match) return match[1];
  } catch {
    // 아래 날짜로 대신한다.
  }
  return `date-${new Date().toISOString().slice(0, 10)}`;
}

function screenKeyOf(content: unknown, buildId: string): string {
  return `${createHash("sha1").update(JSON.stringify(content)).digest("hex")}:${buildId}`;
}

type RawScreenItem = { text: string } | { image: string };

/**
 * 브라우저 안에서 돈다. 밖의 변수를 쓰면 안 된다(함수 글을 그대로 넘긴다).
 *
 * 본문 칸을 문서 차례대로 훑어, 같은 블록 안의 글 조각은 한 줄로 잇고 이미지는 제자리에 둔다.
 * 화면에 보이는 것만 읽는다 — 모바일용 칸은 숨어 있고, 접힌 탭의 글은 API 쪽에 이미 있다.
 */
function extractScreen(rootSelector: string): RawScreenItem[] | null {
  const root = document.querySelector(rootSelector);
  if (!root) return null;
  const items: RawScreenItem[] = [];
  let line = "";
  let lineBlock: Element | null = null;
  const flush = () => {
    const text = line.replace(/\s+/g, " ").trim();
    if (text) items.push({ text });
    line = "";
  };
  const blockOf = (node: Node) => {
    let element = node.parentElement;
    while (element && element !== root) {
      if (!getComputedStyle(element).display.startsWith("inline")) return element;
      element = element.parentElement;
    }
    return root;
  };
  const visible = (element: Element) =>
    element.checkVisibility({ checkVisibilityCSS: true }) && element.getClientRects().length > 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "svg" || tag === "noscript") {
          return NodeFilter.FILTER_REJECT;
        }
        return tag === "img" || tag === "br" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim()) {
        if (text) line += " ";
        continue;
      }
      if (!node.parentElement || !visible(node.parentElement)) continue;
      const block = blockOf(node);
      if (block !== lineBlock) {
        flush();
        lineBlock = block;
      }
      line += text;
    } else if ((node as Element).tagName.toLowerCase() === "br") {
      flush();
    } else {
      const image = node as HTMLImageElement;
      const src = image.getAttribute("src");
      if (!src || !visible(image)) continue;
      flush();
      lineBlock = null;
      items.push({ image: src });
    }
  }
  flush();
  return items;
}

/** 읽어낸 것에서 받아둘 것만 남긴다. 이미지 주소는 원본으로 되돌리고 아이콘은 뺀다. */
function toScreenItems(raw: RawScreenItem[]): ScreenItem[] {
  const items: ScreenItem[] = [];
  for (const item of raw) {
    if ("text" in item) {
      items.push({ text: item.text });
    } else {
      const image = screenImageSrc(item.image);
      if (image) items.push({ image });
    }
  }
  return dropRepeatedRuns(items);
}

function fold(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

async function readScreen(browser: Browser, id: number, title: string): Promise<ScreenItem[]> {
  const page: Page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType()) || !ALLOWED_REQUEST_HOSTS.includes(host)) {
        void request.abort();
      } else {
        void request.continue();
      }
    });
    try {
      await page.goto(detailPageUrl(id), { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // 요청이 끝없이 이어지는 페이지도 본문은 다 그려졌을 수 있다. 제목이 보이는지로 가린다.
      if (!(error instanceof Error && error.name === "TimeoutError")) throw error;
    }
    let raw: RawScreenItem[] | null;
    try {
      raw = await page.evaluate(extractScreen, CONTENT_ROOT_SELECTOR);
    } catch (error) {
      // 실서비스는 다 그린 뒤 주소 끝에 제목을 붙여 한 번 더 옮겨간다. 그 순간에 읽으면 문맥이 사라지므로 한 번만 다시 읽는다.
      if (!(error instanceof Error && /Execution context was destroyed|detached/i.test(error.message))) throw error;
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 }).catch(() => {});
      raw = await page.evaluate(extractScreen, CONTENT_ROOT_SELECTOR);
    }
    if (!raw) throw new Error("실서비스 화면에서 본문 칸을 찾지 못했습니다.");
    const items = toScreenItems(raw);
    // 제목이 없으면 오류 · 로딩 화면을 읽은 것이다. 빈 화면을 성공으로 받으면 예전에 읽은 글이 조용히 사라진다.
    const shown = fold(items.map((item) => ("text" in item ? item.text : "")).join(""));
    if (!shown.includes(fold(title))) throw new Error("실서비스 화면에서 페이지 제목을 찾지 못했습니다.");
    return items;
  } finally {
    await page.close().catch(() => {});
  }
}

export type ScreenReadResult = {
  /** 이번 차례의 시작 시각. 화면은 다음 묶음을 부를 때 이 값을 그대로 되넘긴다. */
  startedAt: string;
  /** 이번에 새로 읽은 페이지 수 */
  read: number;
  failed: { id: number; title: string; reason: string }[];
  /** 이번 차례(startedAt 이후)에 아직 시도하지 않은, 다시 읽어야 할 페이지 수 */
  remaining: number;
};

/**
 * 다시 읽어야 할 페이지를 시간 한도 안에서 읽는다. 화면이 remaining 이 0 이 될 때까지 다시 부른다.
 *
 * startedAt 은 이번 차례의 시작 시각으로, 첫 묶음에서 서버가 정한다(null). 그 뒤에 이미 시도한 페이지는
 * 실패했어도 건너뛴다 — 그러지 않으면 계속 실패하는 페이지 하나를 끝없이 붙잡는다. 다음 차례에 다시 시도한다.
 * 시각을 화면이 정하면 사용자 PC 시계가 서버보다 빠를 때 실패한 페이지를 같은 차례에 또 잡는다.
 */
export async function readServiceScreens(startedAt: Date | null): Promise<ScreenReadResult> {
  const calledAt = Date.now();
  const since = startedAt ?? new Date(calledAt);
  const rows = await prisma.serviceDetailPage.findMany({
    select: { id: true, title: true, content: true, listedAt: true, screenKey: true, screenedAt: true },
    orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
  });
  const lastListedAt = Math.max(0, ...rows.map((row) => row.listedAt.getTime()));
  const buildId = await siteBuildId();

  // 목록에서 사라진 페이지는 실서비스에서도 열리지 않으므로 예전에 읽은 화면을 그대로 둔다.
  const pending = rows
    .filter((row) => isDetailPageContent(row.content) && row.listedAt.getTime() >= lastListedAt)
    .map((row) => ({ ...row, key: screenKeyOf(row.content, buildId) }))
    .filter((row) => row.screenKey !== row.key && !(row.screenedAt && row.screenedAt >= since));
  const result: ScreenReadResult = {
    startedAt: since.toISOString(),
    read: 0,
    failed: [],
    remaining: pending.length,
  };
  if (pending.length === 0) return result;

  const deadline = calledAt + SCREEN_BUDGET_MS;
  const browser = await launchBrowser();
  try {
    await mapWithConcurrency(pending, SCREEN_CONCURRENCY, async (row) => {
      if (Date.now() > deadline) return;
      result.remaining -= 1;
      try {
        const screen = await readScreen(browser, row.id, row.title);
        await prisma.serviceDetailPage.update({
          where: { id: row.id },
          data: { screen, screenKey: row.key, screenError: null, screenedAt: new Date() },
        });
        result.read += 1;
      } catch (error) {
        const reason = errorMessage(error);
        result.failed.push({ id: row.id, title: row.title, reason });
        await prisma.serviceDetailPage
          .update({ where: { id: row.id }, data: { screenError: reason, screenedAt: new Date() } })
          .catch(() => {});
      }
    });
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}

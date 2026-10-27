"use client";

import { cn } from "cn";
import { ChevronDown, ChevronRight, FileText, Link2 } from "lucide-react";
import { useState } from "react";

import { Highlight } from "@/components/highlight";
import { countBlockHits, type NotionBlock, type NotionDoc } from "@/domain/mission-content";

/**
 * Notion 에서 받아온 본문을 그린다. 원문을 그대로 끼워 넣지 않고 우리가 다시 그리는 이유는
 * 다른 도메인이라 그 안의 글자를 칠할 수 없기 때문이다(plan.md §5). 미션 콘텐츠 화면과
 * 미션 가이드 화면이 같은 본문을 보여주므로 그리는 규칙을 한자리에 둔다.
 */

/** 링크는 저쪽 데이터라 http(s) 만 걸어준다. 그 밖의 주소는 글로만 보인다. */
export function safeHref(href: string | undefined): string | null {
  return href && /^https?:\/\//i.test(href) ? href : null;
}

export function NotionDocView({ doc, query }: { doc: NotionDoc; query: string }) {
  return (
    <article className="flex flex-col gap-1.5 text-sm leading-relaxed">
      {doc.title ? (
        <h1 className="mb-2 text-xl leading-snug font-semibold">
          <Highlight text={doc.title} query={query} />
        </h1>
      ) : null}
      <BlockList blocks={doc.blocks} query={query} />
    </article>
  );
}

/** 이어진 번호 목록마다 1부터 센다. Notion 과 같다. */
function listNumbers(blocks: NotionBlock[]): number[] {
  const numbers: number[] = [];
  let current = 0;
  for (const block of blocks) {
    current = block.kind === "numbered" ? current + 1 : 0;
    numbers.push(current);
  }
  return numbers;
}

function BlockList({ blocks, query }: { blocks: NotionBlock[]; query: string }) {
  const numbers = listNumbers(blocks);
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} query={query} number={numbers[index]} />
      ))}
    </>
  );
}

function Children({ block, query }: { block: NotionBlock; query: string }) {
  if (!block.children?.length) return null;
  return (
    <div className="flex flex-col gap-1.5 pt-1.5 pl-6">
      <BlockList blocks={block.children} query={query} />
    </div>
  );
}

const HEADING_CLASSES: Record<number, string> = {
  1: "mt-5 text-lg font-semibold",
  2: "mt-4 text-base font-semibold",
  3: "mt-3 font-semibold",
};

function BlockView({ block, query, number }: { block: NotionBlock; query: string; number: number }) {
  const text = <Highlight text={block.text} query={query} />;

  switch (block.kind) {
    case "heading":
      return <p className={HEADING_CLASSES[block.level ?? 3]}>{text}</p>;
    case "text":
      return (
        <div>
          <p className="min-h-[1lh] whitespace-pre-wrap">{text}</p>
          <Children block={block} query={query} />
        </div>
      );
    case "bulleted":
    case "numbered":
    case "todo":
      return (
        <div className="flex gap-2">
          <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
            {block.kind === "bulleted" ? "•" : block.kind === "numbered" ? `${number}.` : block.checked ? "☑" : "☐"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap">{text}</p>
            <Children block={block} query={query} />
          </div>
        </div>
      );
    case "quote":
      return (
        <blockquote className="border-foreground/40 border-l-2 pl-3">
          <p className="whitespace-pre-wrap">{text}</p>
          <Children block={block} query={query} />
        </blockquote>
      );
    case "callout":
      return (
        <div className="bg-muted/50 flex gap-2 rounded-md p-3">
          {block.icon ? <span className="shrink-0">{block.icon}</span> : null}
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap">{text}</p>
            <Children block={block} query={query} />
          </div>
        </div>
      );
    case "toggle":
      return <ToggleView block={block} query={query} />;
    case "code":
      return (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>
      );
    case "equation":
      return <p className="font-mono text-xs">{text}</p>;
    case "divider":
      return <hr className="my-2" />;
    case "image":
      return (
        <figure className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- Notion 이미지를 그대로 보여준다 */}
          <img src={block.src} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-w-full rounded-md" />
          {block.text ? <figcaption className="text-muted-foreground text-xs">{text}</figcaption> : null}
        </figure>
      );
    case "link":
    case "page": {
      const href = safeHref(block.href);
      const Icon = block.kind === "page" ? FileText : Link2;
      return (
        <p className="flex items-center gap-1.5">
          <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {text}
            </a>
          ) : (
            text
          )}
        </p>
      );
    }
    case "database":
      return (
        <p className="text-muted-foreground bg-muted/40 rounded-md px-3 py-2 text-xs">
          데이터베이스 · <span className="text-foreground font-medium">{text}</span> (안의 내용은 받지 않습니다)
        </p>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {(block.rows ?? []).map((row, rowIndex) => (
                <tr key={rowIndex} className={cn(block.header && rowIndex === 0 && "bg-muted/60 font-medium")}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border px-2 py-1 align-top whitespace-pre-wrap">
                      <Highlight text={cell} query={query} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "columns":
      return (
        <div className="grid gap-4 md:auto-cols-fr md:grid-flow-col">
          {/* 단 아래에 단이 아닌 블록이 오면(동기화 블록이 펼쳐진 경우 등) 그 블록을 그대로 그린다. 건수에는 들어가 있다. */}
          {(block.children ?? []).map((column, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-1.5">
              {column.kind === "column" ? (
                <BlockList blocks={column.children ?? []} query={query} />
              ) : (
                <BlockView block={column} query={query} number={0} />
              )}
            </div>
          ))}
        </div>
      );
    case "column":
      return <BlockList blocks={block.children ?? []} query={query} />;
  }
}

/**
 * Notion 처럼 접어 두되, 안에 일치가 있으면 펼친다. 접힌 곳의 일치가 건수에만 잡히고
 * 화면에서 사라지면 안 된다(plan.md §5).
 */
function ToggleView({ block, query }: { block: NotionBlock; query: string }) {
  const [open, setOpen] = useState(false);
  const childHits = query.trim()
    ? (block.children ?? []).reduce((sum, child) => sum + countBlockHits(child, query), 0)
    : 0;
  const expanded = open || childHits > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        disabled={childHits > 0}
        className={cn("flex w-full items-start gap-1 text-left", block.level ? HEADING_CLASSES[block.level] : "")}
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 whitespace-pre-wrap">
          <Highlight text={block.text} query={query} />
        </span>
      </button>
      {expanded ? <Children block={block} query={query} /> : null}
    </div>
  );
}

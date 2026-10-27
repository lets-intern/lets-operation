import { Fragment } from "react";

import { findMatches } from "@/domain/detail-page-content";

/**
 * 찾는 글과 일치하는 곳을 노랗게 칠한다. 칠한 곳마다 `data-hit` 을 달아, 화면이 몇 번째 일치를
 * 보고 있는지 `data-active` 로 짙게 하고 그 자리로 옮길 수 있게 한다.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = query.trim() ? findMatches(text, query) : [];
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], index) => {
    if (start > at) parts.push(<Fragment key={`t${index}`}>{text.slice(at, start)}</Fragment>);
    parts.push(
      <mark
        key={`m${index}`}
        data-hit=""
        className="rounded-sm bg-yellow-200 text-black data-active:bg-orange-400"
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(<Fragment key="rest">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

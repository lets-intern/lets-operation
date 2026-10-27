"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 지금 시각(밀리초)을 간격마다 새로 준다. 타이머 경과 시간과 주간 뷰의 지금 시각 선이 쓴다.
 *
 * 서버가 그린 화면과 브라우저의 첫 화면이 같아야 해서 서버에서는 null 을 준다 — 서버 시각을
 * 그대로 그리면 몇 초 어긋난 글자 때문에 하이드레이션 경고가 뜬다. 값은 간격 단위로 끊어
 * 같은 간격 안에서는 같은 값을 돌려준다(useSyncExternalStore 가 바라는 성질이다).
 */
export function useNow(intervalMs: number): number | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const id = window.setInterval(onChange, intervalMs);
      return () => window.clearInterval(id);
    },
    [intervalMs],
  );

  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}

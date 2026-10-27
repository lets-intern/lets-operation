/**
 * 아직 저장하지 않은 입력값을 챌린지·커리큘럼·버전별로 들고 있는 규칙.
 *
 * 커리큘럼이나 버전을 바꾸면 폼이 그 설정의 저장값으로 갈아끼워진다. 그때 적던 값을 그냥
 * 버리면 다른 설정을 잠깐 보고 돌아왔을 때 처음부터 다시 적어야 한다. 그래서 떠나기 전에
 * 두고 가고, 돌아오면 저장값보다 먼저 꺼낸다.
 */

export type DraftStore<T> = Record<string, T>;

export type Selection<T, V extends string> = {
  challengeId: string;
  curriculumDays: number;
  version: V;
  fields: T;
  drafts: DraftStore<T>;
};

export function draftKey(
  challengeId: string,
  curriculumDays: number,
  version: string,
): string {
  return `${challengeId}:${curriculumDays}:${version}`;
}

/** 다른 챌린지·커리큘럼·버전으로 옮길 때의 상태 전이. */
export function moveSelection<T, V extends string>(
  current: Selection<T, V>,
  next: { challengeId: string; curriculumDays: number; version: V; saved: T },
  /** 아무것도 고르지 않은 상태에서는 두고 갈 것이 없다. */
  { keepCurrent }: { keepCurrent: boolean },
): Selection<T, V> {
  const drafts = keepCurrent
    ? {
        ...current.drafts,
        [draftKey(current.challengeId, current.curriculumDays, current.version)]:
          current.fields,
      }
    : current.drafts;

  const key = draftKey(next.challengeId, next.curriculumDays, next.version);

  return {
    challengeId: next.challengeId,
    curriculumDays: next.curriculumDays,
    version: next.version,
    fields: key in drafts ? drafts[key] : next.saved,
    drafts,
  };
}

/**
 * 커리큘럼 일수를 칸에 치는 동안의 이동. 초안을 **꺼내지 않는다** — `12` 를 적으려고 `10` 의
 * `0` 을 지우는 순간 거쳐 간 `1` 의 초안이 폼을 덮으면 적던 미션 값이 사라진다. 들어가는 일수에
 * 저장값이 있을 때만 그 값을 올리고, 없으면 지금 폼을 그대로 들고 간다.
 *
 * 초안을 남기는 것도 `keepCurrent` 일 때뿐이다. 치다가 거쳐 가는 일수는 떠나는 자리가 아니라서
 * 남기지 않고, 치기 시작하기 전의 자리(드롭다운으로 골랐던 설정)만 남긴다. 치기를 마친 일수의
 * 초안은 그 뒤 드롭다운으로 떠날 때 moveSelection 이 남긴다.
 */
export function carrySelection<T, V extends string>(
  current: Selection<T, V>,
  next: { challengeId: string; curriculumDays: number; version: V; saved: T | null },
  { keepCurrent }: { keepCurrent: boolean },
): Selection<T, V> {
  const drafts = keepCurrent
    ? {
        ...current.drafts,
        [draftKey(current.challengeId, current.curriculumDays, current.version)]:
          current.fields,
      }
    : current.drafts;

  return {
    challengeId: next.challengeId,
    curriculumDays: next.curriculumDays,
    version: next.version,
    fields: next.saved ?? current.fields,
    drafts,
  };
}

/** 적던 값을 버리고 저장값으로 되돌린다. 잘못 고쳤을 때 빠져나오는 길이다. */
export function forgetDraft<T>(
  drafts: DraftStore<T>,
  challengeId: string,
  curriculumDays: number,
  version: string,
): DraftStore<T> {
  const next = { ...drafts };
  delete next[draftKey(challengeId, curriculumDays, version)];
  return next;
}

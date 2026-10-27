"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChallengeOption } from "@/domain/challenge";

import { linkAlias, type AliasState } from "./actions";

const INITIAL_STATE: AliasState = { error: null, opened: null };

/**
 * 마케팅팀 이름을 우리 챌린지에 잇는다.
 *
 * 이 자리에 둔 이유는 못 붙은 이름이 바로 여기 보이기 때문이다. 프로그램 설정에 별칭 관리
 * 화면을 따로 두면, 어떤 이름을 이어야 하는지 확인하러 두 화면을 오가야 한다.
 */
export function AliasForm({
  name,
  challenges,
}: {
  name: string;
  challenges: ChallengeOption[];
}) {
  const [state, formAction, pending] = useActionState(linkAlias, INITIAL_STATE);

  if (challenges.length === 0) return null;

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="name" value={name} />

      <label className="sr-only" htmlFor={`alias-${name}`}>
        {name} 을(를) 이을 챌린지
      </label>
      <NativeSelect
        id={`alias-${name}`}
        name="challengeId"
        required
        defaultValue=""
        className="h-8 w-48 text-xs"
        disabled={pending}
      >
        <option value="" disabled>
          어느 챌린지인가요?
        </option>
        {challenges.map((challenge) => (
          <option key={challenge.id} value={challenge.id}>
            {challenge.name}
          </option>
        ))}
      </NativeSelect>

      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "잇는 중…" : "잇기"}
      </Button>

      {state.error ? (
        <span role="alert" className="text-destructive text-xs">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

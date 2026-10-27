"use client";

import { useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import type { ChallengeServiceLink } from "@/domain/challenge";
import type { ServiceTypeOption } from "@/domain/service-program";

import { linkServiceType } from "./actions";

/**
 * 우리 챌린지를 실서비스 구분에 잇는 자리.
 *
 * 마케팅팀 별칭을 "개설하지 못한 기획" 자리에서 잇는 것과 같은 이유로 개설 화면에 둔다
 * (plan.md §5). 무엇이 안 이어졌는지 보이는 곳에서 바로 풀 수 있어야, 확인하러 두 화면을
 * 오가지 않는다.
 *
 * 이름으로 잇지 않는 이유는 실서비스 표기가 계속 흔들리기 때문이다 —
 * `포트폴리오 2주 완성 챌린지` 가 `1주 완성` 으로 바뀌어도 구분 코드는 그대로다.
 */
export function ServiceLinkList({
  links,
  options,
  unavailable,
}: {
  links: ChallengeServiceLink[];
  options: ServiceTypeOption[];
  /** 실서비스 목록을 읽지 못했을 때의 사유. 읽었으면 비어 있다. */
  unavailable: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-medium">챌린지</th>
            <th className="py-2 pr-3 font-medium">개설 기수</th>
            <th className="py-2 pr-3 font-medium">구분</th>
            <th className="py-2 font-medium">DB 내 프로그램</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <ServiceLinkRow
              key={link.challengeId}
              link={link}
              options={options}
              unavailable={unavailable}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServiceLinkRow({
  link,
  options,
  unavailable,
}: {
  link: ChallengeServiceLink;
  options: ServiceTypeOption[];
  unavailable: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const chosen = options.find((option) => option.serviceType === link.serviceType);

  return (
    <tr className="border-border border-b last:border-0">
      <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
        {link.challengeName}
      </td>
      {/* 개수가 아니라 번호를 적는다. 옆 개설 목록이 "32기" 로 부르는 것을 여기서 "1" 로
          적으면 같은 챌린지가 두 얼굴로 보인다. */}
      <td className="text-muted-foreground py-2.5 pr-3 whitespace-nowrap">
        {formatCohorts(link.cohorts)}
      </td>
      <td className="py-2.5 pr-3">
        <NativeSelect
          aria-label={`${link.challengeName} 구분`}
          // 보기 문구가 `구분 · 대표 이름` 이라 고정 폭에서는 이름이 잘린다. 무엇에 이어졌는지
          // 알아보라고 붙인 이름이므로 가장 긴 보기에 폭을 맞추고, 바닥만 지켜 둔다.
          className="h-7 w-auto min-w-40 text-xs md:text-xs"
          // 목록을 못 읽었으면 고를 보기가 없다. 빈 드롭다운을 열게 두지 않는다.
          disabled={pending || unavailable !== null}
          value={link.serviceType === null ? "" : String(link.serviceType)}
          onChange={(event) => {
            const formData = new FormData();
            formData.set("challengeId", link.challengeId);
            formData.set("serviceType", event.target.value);
            startTransition(() => linkServiceType(formData));
          }}
        >
          <option value="">잇지 않음</option>
          {options.map((option) => (
            <option key={option.serviceType} value={option.serviceType}>
              {option.serviceType} · {option.samples[0] ?? "이름 없음"}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="text-muted-foreground py-2.5 text-xs">
        {unavailable !== null ? (
          <span className="text-destructive">{unavailable}</span>
        ) : link.serviceType === null ? (
          // 안 이으면 그 챌린지의 기수는 자동 확인에서 통째로 빠진다. 그 사실을 적는다.
          "이어야 자동으로 확인됩니다"
        ) : (
          (chosen?.samples.join(" · ") ?? "최근 열린 프로그램이 없습니다")
        )}
      </td>
    </tr>
  );
}

/** 기수가 쌓여도 칸이 늘어지지 않도록 최근 셋만 적고 나머지는 수로 줄인다. */
const SHOWN_COHORTS = 3;

function formatCohorts(cohorts: number[]): string {
  if (cohorts.length === 0) return "-";

  const shown = cohorts.slice(0, SHOWN_COHORTS).map((cohort) => `${cohort}기`);
  const rest = cohorts.length - shown.length;

  return rest > 0 ? `${shown.join(" · ")} 외 ${rest}개` : shown.join(" · ");
}

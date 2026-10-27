import Link from "next/link";

import type { ChallengeOption } from "@/domain/challenge";
import { formatDateOnly } from "@/domain/date";
import type { MktBlockReason, PendingMktProgram } from "@/domain/mkt-planned-program";

import { AliasForm } from "./alias-form";

/**
 * 가져왔지만 아직 기수로 세우지 못한 기획. 무엇을 해야 풀리는지가 사유에 그대로 드러난다.
 * 사유가 없어지면 다음 가져오기에 저절로 개설되므로 여기서 손댈 것은 사유를 없애는 일뿐이다.
 */
const REASON_LABELS: Record<MktBlockReason, string> = {
  TITLE: "제목에서 기수를 읽지 못함",
  CHALLENGE: "등록되지 않은 챌린지",
  START_DATE: "시작일 미정",
};

const REASON_HINTS: Record<MktBlockReason, string> = {
  TITLE: "마케팅팀 표기를 「챌린지명 N기」 형태로 맞춰야 합니다.",
  CHALLENGE:
    "우리 챌린지 중 어느 것인지 골라 이어주세요. 한 번 이어두면 다음 기수부터는 저절로 붙습니다.",
  START_DATE: "마케팅팀이 시작일을 채우면 다음 가져오기에 개설됩니다.",
};

export function PendingList({
  pending,
  challenges,
}: {
  pending: PendingMktProgram[];
  challenges: ChallengeOption[];
}) {
  // 같은 사유끼리 묶어 보여준다. 할 일이 사유 단위라 줄마다 흩어져 있으면 읽기 어렵다.
  const reasons = [...new Set(pending.map((item) => item.reason))];

  return (
    <div className="flex flex-col gap-5">
      {reasons.map((reason) => {
        const items = pending.filter((item) => item.reason === reason);

        return (
          <div key={reason}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-sm font-medium">{REASON_LABELS[reason]}</h3>
              <span className="text-muted-foreground text-xs">
                {REASON_HINTS[reason]}
                {reason === "CHALLENGE" && challenges.length === 0 ? (
                  <>
                    {" "}
                    등록된 챌린지가 없으니{" "}
                    <Link
                      href="/programs/settings"
                      className="text-foreground underline underline-offset-2"
                    >
                      프로그램 설정
                    </Link>
                    에서 먼저 만드세요.
                  </>
                ) : null}
              </span>
            </div>

            {reason === "CHALLENGE" ? (
              <ChallengeGroups items={items} challenges={challenges} />
            ) : (
              <ul className="border-border divide-border divide-y rounded-md border">
                {items.map((item) => (
                  <li key={item.id} className="px-3 py-2">
                    <PlanLine item={item} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 별칭은 이름 하나에 한 번 잇는 일이다. 같은 이름의 기획이 여러 줄이어도
 * (버전이 나뉘면 두 줄이다) 고르는 자리는 하나여야 한다.
 */
function ChallengeGroups({
  items,
  challenges,
}: {
  items: PendingMktProgram[];
  challenges: ChallengeOption[];
}) {
  const names = [...new Set(items.map((item) => item.challengeName))];

  return (
    <ul className="border-border divide-border divide-y rounded-md border">
      {names.map((name) => (
        <li key={name ?? "unknown"} className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium">{name ?? "이름을 읽지 못함"}</span>
            {name ? <AliasForm name={name} challenges={challenges} /> : null}
          </div>

          <div className="mt-1.5 flex flex-col gap-1">
            {items
              .filter((item) => item.challengeName === name)
              .map((item) => (
                <PlanLine key={item.id} item={item} muted />
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 기획 한 줄. 저쪽이 적어둔 그대로 보여 어느 줄을 말하는지 알아볼 수 있게 한다. */
function PlanLine({
  item,
  muted = false,
}: {
  item: PendingMktProgram;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className={muted ? "text-muted-foreground text-xs" : "font-medium"}>
        {item.title}
      </span>
      {item.category ? (
        <span className="text-muted-foreground text-xs">{item.category}</span>
      ) : null}
      <span className="text-muted-foreground text-xs">
        {item.startDate ? `시작 ${formatDateOnly(item.startDate)}` : "시작일 없음"}
      </span>
      {item.owner ? (
        <span className="text-muted-foreground ml-auto text-xs">{item.owner}</span>
      ) : null}
    </div>
  );
}

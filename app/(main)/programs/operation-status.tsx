import type { ProgramStatusRow } from "@/domain/program-status";
import { PROGRAM_VERSION_LABELS } from "@/domain/program-setting";

/**
 * 지금 도는 기수가 몇 명을 데리고 있는지. 캘린더가 **언제**를 그린다면 여기는 **얼마나**를 적는다.
 *
 * 총원 하나만으로는 모집을 더 밀지 판단하지 못한다. 같은 20 명이라도 베이직에 몰린 기수와
 * 프리미엄이 붙은 기수는 준비할 일이 다르다. 그래서 총원과 플랜 내역을 한 줄에 둔다.
 */
export function OperationStatus({
  rows,
  checkedAt,
  unavailable,
}: {
  rows: ProgramStatusRow[];
  /** 저쪽 인원이 언제 집계된 것인지. 사람이 읽는 꼴로 이미 다듬어져 온다. */
  checkedAt: string | null;
  unavailable: string | null;
}) {
  return (
    <section className="border-border flex flex-col rounded-lg border p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium">운영 현황</h2>
          <span className="text-muted-foreground text-xs">
            운영 중 {rows.length}건
          </span>
        </div>
        {checkedAt ? (
          <span className="text-muted-foreground text-xs">{checkedAt} 기준</span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          지금 운영 중인 기수가 없습니다.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {rows.map((row) => (
            // 인원이 빈 이유는 둘이다. 저쪽을 통째로 못 읽었거나, 읽었는데 이 기수만
            // 못 찾았거나. 무엇을 손봐야 하는지가 달라서 줄마다 사유를 가려 적는다.
            <StatusRow
              key={row.key}
              row={row}
              missing={unavailable ?? "실서비스에서 이 기수를 찾지 못했습니다"}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 한 줄에 두 단. 위는 어느 기수인지, 아래는 어느 플랜에 몇 명인지. */
function StatusRow({
  row,
  missing,
}: {
  row: ProgramStatusRow;
  /** 인원이 비었을 때 그 자리에 적을 사유. */
  missing: string;
}) {
  const { headcount } = row;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm">
          {row.challengeName} {row.cohort}기
          {/* 갈래는 나뉜 기수에만 붙인다. 안 나뉘는 챌린지에 "구분 없음" 을 달면 줄만 길어진다. */}
          {row.version === "COMMON" ? null : (
            <span className="text-muted-foreground ml-1.5 text-xs">
              {PROGRAM_VERSION_LABELS[row.version]}
            </span>
          )}
        </p>
        <p className="shrink-0 text-sm font-medium tabular-nums">
          {headcount ? `${headcount.total}명` : "—"}
        </p>
      </div>

      <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
        {headcount
          ? `베이직 ${headcount.basic} · 스탠다드 ${headcount.standard} · 프리미엄 ${headcount.premium}`
          : missing}
      </p>
    </li>
  );
}

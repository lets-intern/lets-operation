import type { ProgramMark, ProgramPhase } from "@/domain/program-calendar";

/**
 * 캘린더에 놓이는 것들의 생김새. **색이 아니라 채움과 모양**으로 가른다.
 *
 * 화면이 흑백이라 색을 새로 들이면 지연·임박 강조(업무 캘린더)와 부딪히고, 무엇이 급한
 * 것인지 무엇이 지금 도는 것인지가 같은 세기로 보인다. 채움 정도는 그 자체로 뜻이 된다 —
 * 비어 있고 선도 끊긴 것(개설 예정) · 선이 이어지고 옅게 찬 것(운영 예정) · 꽉 찬 것
 * (운영 중) · 물러난 것(운영 종료). **채워질수록 나아간 것**이라 네 상태가 한 줄로 읽힌다.
 *
 * 개설 표식은 상태가 아니라 다른 갈래이므로 채움이 아니라 **모양**으로 가른다. 개설 칩은
 * 앞에 마름모를 달고 늘 한 칸에 그치는 반면 기간 막대는 칸을 가로질러 이어져, 같은 줄에
 * 있어도 서로 다른 것으로 읽힌다. (막대를 알약으로 두어 가르던 때가 있었는데, 칩을 각지게
 * 낮추면서 그 둥글기만 혼자 튀어 지금은 둘 다 모서리만 둥글린다.)
 */

/**
 * 캘린더에 눕는 운영 막대.
 *
 * 운영 중은 **꽉 찬 검정이 아니라 진회색**이다. 막대가 미션을 품게 되면서 칩이 그 안에
 * 들어앉는데, 새까만 바탕에 흰 칩을 얹으면 둘의 밝기가 정반대라 막대가 줄무늬로 읽힌다.
 * 한 톤 낮추면 "꽉 찬 것"이라는 뜻은 그대로면서 품은 칩과 같은 결이 된다.
 */
export const PHASE_BAR: Record<ProgramPhase, string> = {
  RUNNING: "bg-primary/85 text-primary-foreground",
  // 상세페이지는 열렸고 시작만 남은 기수. 끊긴 선을 잇고 옅게 채워 개설 예정보다 한 발
  // 나아간 것으로 읽히게 한다. 아직 안 도는 것이라 운영 중의 채움까지는 가지 않는다.
  READY: "bg-foreground/8 border-foreground/45 text-foreground border",
  UPCOMING: "border-foreground/35 text-foreground border border-dashed",
  ENDED: "bg-muted text-muted-foreground",
};

/**
 * 오픈 목표일에 찍는 개설 칩. 지난 목표일은 운영 종료와 같은 결로 물러난다 —
 * 다 지난 개설과 앞으로 해야 할 개설이 같은 세기로 보이면 이 달에 뭘 열어야 하는지가 묻힌다.
 */
export const LAUNCH_CHIP: Record<"ahead" | "passed", string> = {
  ahead: "border-foreground/60 text-foreground bg-background border",
  passed: "border-border text-muted-foreground bg-muted/50 border",
};

/**
 * 칩의 모서리. 높이가 14px 남짓한 작은 칩이라 토큰의 6px(`rounded-sm`)은 알약에 가깝게
 * 보여, 하루이틀짜리 짧은 칩이 기간이 아니라 점으로 읽힌다. 4px 로 낮춰 모서리만 죽인다.
 *
 * 개설 칩도 같은 값을 쓴다. 둘은 같은 줄에 나란히 놓이는 일이 잦아, 한쪽만 각지면
 * 서로 다른 종류의 표식처럼 보인다. 감싸는 막대(10px)와는 그대로 갈린다.
 */
export const CHIP_RADIUS = "rounded-[0.25rem]";

/**
 * 운영 막대의 닫힌 끝(6px). 칩을 품는 그릇이라 안의 칩보다 **한 단계만** 크게 둔다 —
 * 바깥이 안보다 살짝 커야 둘 사이 여백이 고르게 보인다.
 *
 * 예전에는 한 줄짜리 막대를 알약으로, 미션을 품어 키가 커진 막대를 10px 로 나눠 그렸다.
 * 칩을 각지게 낮추면서 그 둥글기만 혼자 튀어, 둘을 같은 값으로 모았다. 잘린 끝은 여기를
 * 쓰지 않고 각지게 둔다 — 다음 주로 이어진다는 뜻이라 닫으면 안 된다.
 */
export const BAR_CORNER = { left: "rounded-l-sm", right: "rounded-r-sm" };

/**
 * 칩이 앉는 바닥. 꽉 찬 막대 안이면 그 결을 따르고, 아니면 스스로 바탕을 깐다.
 *
 * 채움이 옅은 막대(개설 예정·운영 종료)는 페이지와 한 갈래로 친다. 그 위에서는 흰 칩이
 * 그대로 읽히고, 굳이 갈라두면 같은 칩이 상태마다 달라 보여 얻는 것 없이 시끄러워진다.
 */
export type ChipSurface = "FILLED_BAR" | "PAGE";

/**
 * 막대가 품는 미션 칩.
 *
 * 예전에는 어디에 놓이든 페이지 바탕색으로 칠했다. 그러면 운영 중 막대 위에서 흰 칩이
 * 검은 바탕을 토막 내 막대가 하나로 안 읽힌다. 꽉 찬 막대 안에서는 칩을 **한 톤 밝은
 * 반투명**으로 두어, 같은 천에 난 무늬처럼 보이게 한다.
 */
export const MISSION_CHIP: Record<ChipSurface, string> = {
  FILLED_BAR:
    "bg-primary-foreground/18 text-primary-foreground border-primary-foreground/25 border",
  PAGE: "bg-background text-foreground border-border border",
};

/**
 * 미션 뒤에 붙는 피드백 칩. 점선으로 둘러 미션과 갈린다 — 같은 줄에 나란히 놓이는 일이
 * 잦은데 채움만으로 가르면 어디까지가 미션이고 어디부터가 피드백인지 흐려진다.
 *
 * 막대 안에서는 미션 칩보다 한 겹 옅다. 미션이 본체이고 피드백은 그 뒤에 붙는 것이라,
 * 같은 세기로 칠하면 회차가 두 번씩 도는 것처럼 보인다.
 */
export const FEEDBACK_CHIP: Record<ChipSurface, string> = {
  FILLED_BAR:
    "bg-primary-foreground/8 text-primary-foreground border-primary-foreground/40 border border-dashed",
  PAGE: "bg-background border-border text-muted-foreground border border-dashed",
};

/**
 * 범례 앞에 붙는 작은 표본. 막대와 같은 채움, 개설 칩과 같은 모양이라야 범례 구실을 한다.
 * 크기와 모양까지 여기서 정하는 것은 마름모가 동그라미와 같은 크기로는 작아 보이기 때문이다.
 */
export const MARK_SWATCH: Record<ProgramMark, string> = {
  RUNNING: "bg-primary/85 size-2.5 rounded-full",
  READY: "bg-foreground/8 border-foreground/45 size-2.5 rounded-full border",
  UPCOMING: "border-foreground/35 size-2.5 rounded-full border border-dashed",
  ENDED: "bg-muted border-border size-2.5 rounded-full border",
  LAUNCH: "border-foreground/60 size-2 rotate-45 border",
  MISSION: `bg-background border-border h-2 w-3.5 border ${CHIP_RADIUS}`,
  FEEDBACK: `bg-background border-border h-2 w-3.5 border border-dashed ${CHIP_RADIUS}`,
};

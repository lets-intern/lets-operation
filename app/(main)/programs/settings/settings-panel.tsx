"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChallengeSettingRow } from "@/domain/challenge-setting";
import {
  CURRICULUM_NONE,
  curriculumLabel,
  isCurriculumDays,
  isPresetCurriculum,
  MAX_CHALLENGE_NAME_LENGTH,
  PRESET_CURRICULUM_DAYS,
  PROGRAM_VERSIONS,
  PROGRAM_VERSION_LABELS,
  settingLabel,
  type ProgramSettingValues,
  type ProgramVersion,
} from "@/domain/program-setting";

import {
  addChallenge,
  saveSetting,
  type ChallengeState,
  type SaveState,
} from "./actions";
import {
  CUSTOM_CURRICULUM,
  CurriculumSelect,
  type CurriculumPreset,
} from "../curriculum-select";
import type { MissionFieldsValue } from "./mission-fields";
import {
  EMPTY_SETTING_FIELDS,
  SettingFields,
  toSettingFields,
  type SettingFieldsValue,
} from "./setting-fields";
import {
  ChallengeRows,
  type ActiveRow,
  type SelectedSetting,
} from "./challenge-rows";
import {
  carrySelection,
  forgetDraft,
  moveSelection,
  type DraftStore,
} from "./draft-store";

const INITIAL_SAVE_STATE: SaveState = { error: null, saved: null };
const INITIAL_CHALLENGE_STATE: ChallengeState = { error: null, added: null };

/** 설정은 커리큘럼이 나뉘지 않는 경우(구분 없음)부터 고른다. */
const SETTING_CURRICULUM_PRESETS: CurriculumPreset[] = PRESET_CURRICULUM_DAYS.map(
  (days) => ({ value: String(days), label: curriculumLabel(days) }),
);

function savedFields(setting: ProgramSettingValues | undefined): SettingFieldsValue {
  return setting ? toSettingFields(setting) : EMPTY_SETTING_FIELDS;
}

/** 적던 값이 저장된 값과 같은지. "저장한 값으로" 버튼을 언제 보일지 정한다. */
function sameFields(a: SettingFieldsValue, b: SettingFieldsValue): boolean {
  return (
    a.durationDays === b.durationDays &&
    a.missionCount === b.missionCount &&
    a.missions.length === b.missions.length &&
    a.missions.every((mission, index) => sameMission(mission, b.missions[index]))
  );
}

function sameMission(a: MissionFieldsValue, b: MissionFieldsValue): boolean {
  return (
    a.days === b.days &&
    a.feedbackKind === b.feedbackKind &&
    // 피드백이 없는 미션은 일수를 적어뒀더라도 저장되지 않으므로 견주지 않는다.
    (!a.feedbackKind || a.feedbackDays === b.feedbackDays)
  );
}

/**
 * 폼과 목록이 "지금 어느 챌린지를 보고 있는가" 하나를 같이 쓴다.
 * 목록의 수정 버튼이 곧 위 드롭다운을 바꾸는 일이라 상태를 여기 한 곳에 둔다.
 */
export function SettingsPanel({ rows }: { rows: ChallengeSettingRow[] }) {
  const uid = useId();
  // 챌린지 · 커리큘럼 · 버전이 한 벌로 "지금 어느 설정을 적는가" 를 가리킨다.
  const [challengeId, setChallengeId] = useState("");
  const [curriculumDays, setCurriculumDays] = useState(CURRICULUM_NONE);
  const [version, setVersion] = useState<ProgramVersion>("COMMON");
  /**
   * 커리큘럼 드롭다운이 `직접 입력` 인지와 일수 칸에 적힌 그대로의 글자.
   * 칸을 비우고 다시 적는 중에도 고른 커리큘럼(`curriculumDays`)은 흔들리지 않는다.
   */
  const [customCurriculum, setCustomCurriculum] = useState(false);
  const [curriculumInput, setCurriculumInput] = useState("");
  const [fields, setFields] =
    useState<SettingFieldsValue>(EMPTY_SETTING_FIELDS);
  /**
   * 아직 저장하지 않은 입력값을 챌린지·커리큘럼·버전별로 들고 있는다.
   * 다른 설정을 보고 와도 적던 값이 사라지지 않는다.
   */
  const [drafts, setDrafts] = useState<DraftStore<SettingFieldsValue>>({});
  // 한 번에 한 곳만 연다. 어디서 무엇을 하는 중인지 함께 들고 있는다.
  const [active, setActive] = useState<ActiveRow | null>(null);
  const [state, formAction, pending] = useActionState(
    saveSetting,
    INITIAL_SAVE_STATE,
  );

  // 목록에 없는 id 는 고르지 않은 것으로 본다. 이름을 지운 뒤 폼이 유령을 붙들지 않는다.
  const selected = rows.find((row) => row.challengeId === challengeId) ?? null;
  const savedSetting = selected?.settings.find(
    (entry) => entry.curriculumDays === curriculumDays && entry.version === version,
  );
  const dirty = savedSetting
    ? !sameFields(fields, toSettingFields(savedSetting))
    : false;

  /**
   * 지금 커리큘럼이 일수 칸을 치다가 거쳐 온 자리인지. 그런 자리는 떠나는 곳이 아니라
   * 치는 중인 곳이라, 다음 글자로 옮길 때 초안을 남기지 않는다(carrySelection).
   */
  const [typedCurriculum, setTypedCurriculum] = useState(false);

  /**
   * 챌린지 · 커리큘럼 · 버전을 고르면 적어둔 값을 그대로 올린다. 없으면 빈 폼에서 시작한다.
   * 설정을 주지 않으면 이미 적어둔 것 중 첫 벌을 따라간다 — 대개 그것을 고치려는 것이다.
   * 떠나는 자리의 초안은 지금 일수 그대로의 키로 남는다. 일수를 치다 온 자리여도 마찬가지다.
   */
  function select(nextId: string, target?: SelectedSetting) {
    const next = rows.find((row) => row.challengeId === nextId);
    const pickedCurriculum =
      target?.curriculumDays ?? next?.settings[0]?.curriculumDays ?? CURRICULUM_NONE;
    const pickedVersion = target?.version ?? next?.settings[0]?.version ?? "COMMON";
    const saved = next?.settings.find(
      (entry) =>
        entry.curriculumDays === pickedCurriculum && entry.version === pickedVersion,
    );

    const moved = moveSelection(
      { challengeId, curriculumDays, version, fields, drafts },
      {
        challengeId: nextId,
        curriculumDays: pickedCurriculum,
        version: pickedVersion,
        saved: savedFields(saved),
      },
      { keepCurrent: selected !== null },
    );

    setDrafts(moved.drafts);
    setChallengeId(moved.challengeId);
    setCurriculumDays(moved.curriculumDays);
    setVersion(moved.version);
    setFields(moved.fields);
    setTypedCurriculum(false);
    setCustomCurriculum(!isPresetCurriculum(moved.curriculumDays));
    setCurriculumInput(String(moved.curriculumDays));
  }

  /**
   * 드롭다운으로 커리큘럼을 바꾼다. 옮겨 간 커리큘럼에 적어둔 설정이 있는데 지금 버전은 없으면
   * 적어둔 첫 버전을 따라간다 — 챌린지를 바꿀 때 첫 벌을 따라가는 것과 같은 이유다.
   */
  function pickCurriculum(choice: string) {
    if (choice !== CUSTOM_CURRICULUM) {
      const days = Number(choice);
      const group = selected?.settings.filter((entry) => entry.curriculumDays === days) ?? [];
      const nextVersion =
        group.length === 0 || group.some((entry) => entry.version === version)
          ? version
          : group[0].version;

      select(challengeId, { curriculumDays: days, version: nextVersion });
      return;
    }

    // 이미 직접 적은 커리큘럼을 보고 있으면 그 일수를 그대로 둔다. 아니면 빈 칸에서 적는다.
    setCustomCurriculum(true);
    setCurriculumInput(isPresetCurriculum(curriculumDays) ? "" : String(curriculumDays));
  }

  /**
   * 일수를 치는 동안의 이동. `14` 를 적으려면 `1` 을 거치는데, 그때마다 빈 폼이나 거쳐 간 일수의
   * 초안으로 갈아끼우면 적던 미션 값이 사라진다. 저장값이 있는 일수에서만 그 값을 올리고, 아니면
   * 지금 폼을 그대로 들고 간다. 칸도 그 사이 닫히지 않도록 직접 입력 상태를 건드리지 않는다.
   */
  function typeCurriculum(input: string) {
    setCurriculumInput(input);

    const days = Number(input);
    if (
      !selected ||
      !input ||
      !isCurriculumDays(days) ||
      days === CURRICULUM_NONE ||
      days === curriculumDays
    ) {
      return;
    }

    const saved = selected.settings.find(
      (entry) => entry.curriculumDays === days && entry.version === version,
    );
    const moved = carrySelection(
      { challengeId, curriculumDays, version, fields, drafts },
      {
        challengeId,
        curriculumDays: days,
        version,
        saved: saved ? toSettingFields(saved) : null,
      },
      { keepCurrent: !typedCurriculum },
    );

    setDrafts(moved.drafts);
    setCurriculumDays(moved.curriculumDays);
    setFields(moved.fields);
    setTypedCurriculum(true);
  }

  /** 적던 값을 버리고 저장된 값으로 되돌린다. 잘못 고쳤을 때 빠져나오는 길이다. */
  function resetToSaved() {
    setDrafts((current) => forgetDraft(current, challengeId, curriculumDays, version));
    setFields(savedFields(savedSetting));
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <section className="border-border rounded-lg border p-6">
        <h2 className="mb-4 text-sm font-medium">운영 방식 설정</h2>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-64 space-y-2">
              <Label htmlFor={`${uid}-challenge`}>챌린지</Label>
              <NativeSelect
                id={`${uid}-challenge`}
                name="challengeId"
                required
                disabled={rows.length === 0}
                value={selected?.challengeId ?? ""}
                onChange={(event) => select(event.target.value)}
              >
                <option value="" disabled>
                  선택하세요
                </option>
                {rows.map((row) => (
                  <option key={row.challengeId} value={row.challengeId}>
                    {row.challengeName}
                    {row.settings.length === 0 ? " · 미설정" : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${uid}-curriculum`}>커리큘럼</Label>
              <CurriculumSelect
                id={`${uid}-curriculum`}
                name="curriculumDays"
                presets={SETTING_CURRICULUM_PRESETS}
                custom={customCurriculum}
                value={customCurriculum ? curriculumInput : String(curriculumDays)}
                disabled={!selected}
                onPick={pickCurriculum}
                onType={typeCurriculum}
              />
            </div>

            <div className="w-40 space-y-2">
              <Label htmlFor={`${uid}-version`}>버전</Label>
              <NativeSelect
                id={`${uid}-version`}
                name="version"
                required
                disabled={!selected}
                value={version}
                onChange={(event) =>
                  select(challengeId, {
                    curriculumDays,
                    version: event.target.value as ProgramVersion,
                  })
                }
              >
                {PROGRAM_VERSIONS.map((value) => (
                  <option key={value} value={value}>
                    {PROGRAM_VERSION_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {selected ? (
            <SettingFields value={fields} onChange={setFields}>
              <Button type="submit" disabled={pending}>
                {pending ? "저장 중…" : savedSetting ? "저장" : "등록하기"}
              </Button>
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={resetToSaved}
                >
                  저장한 값으로
                </Button>
              ) : null}
            </SettingFields>
          ) : (
            <p className="text-muted-foreground text-sm">
              {rows.length === 0
                ? "등록된 챌린지가 없습니다. 아래에서 챌린지를 먼저 등록하세요."
                : "챌린지를 고르면 수행기간과 미션·피드백 구성을 적을 수 있습니다. 1주·2주처럼 기수마다 골라 여는 구성은 커리큘럼으로 나눕니다."}
            </p>
          )}

          {state.error ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}

          {state.saved && !state.error ? (
            <p role="status" className="text-sm">
              <span className="font-medium">
                {rows.find(
                  (row) => row.challengeId === state.saved?.challengeId,
                )?.challengeName ?? "설정"}{" "}
                {settingLabel(curriculumDays, version)}
              </span>{" "}
              저장 완료 · 이 챌린지로 개설하는 모든 기수가 이 방식을 따릅니다.
            </p>
          ) : null}
        </form>
      </section>

      <section className="border-border flex-1 rounded-lg border p-6">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">챌린지</h2>
          <span className="text-muted-foreground text-xs">
            정한 순서 · 설정{" "}
            {rows.filter((row) => row.settings.length > 0).length}/{rows.length}건
          </span>
        </div>

        <AddChallengeForm />

        {rows.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            등록한 챌린지가 없습니다. 위에서 첫 챌린지를 등록하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-8 font-medium">챌린지</th>
                  <th className="py-2 pr-3 font-medium">커리큘럼</th>
                  <th className="py-2 pr-3 font-medium">버전</th>
                  <th className="py-2 pr-3 font-medium">수행기간</th>
                  <th className="py-2 pr-3 font-medium">미션</th>
                  <th className="py-2 pr-3 font-medium">피드백</th>
                  <th className="py-2 pr-3 font-medium">전체 기간</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">설정 관리</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <ChallengeRows
                    key={row.challengeId}
                    row={row}
                    first={index === 0}
                    last={index === rows.length - 1}
                    selected={
                      row.challengeId === selected?.challengeId
                        ? { curriculumDays, version }
                        : null
                    }
                    active={active}
                    onEditSetting={(target) => {
                      setActive(null);
                      select(row.challengeId, target);
                    }}
                    onAction={setActive}
                    onCancel={() => setActive(null)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** 개설 드롭다운에 들어갈 이름을 만드는 유일한 곳. 목록 바로 위에 둔다. */
function AddChallengeForm() {
  const uid = useId();
  const [state, formAction, pending] = useActionState(
    addChallenge,
    INITIAL_CHALLENGE_STATE,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // 등록에 성공하면 칸을 비워 다음 이름을 바로 적을 수 있게 한다.
  const handledAddition = useRef<string | null>(null);
  useEffect(() => {
    if (!state.added || handledAddition.current === state.added.challengeId)
      return;
    handledAddition.current = state.added.challengeId;
    if (inputRef.current) inputRef.current.value = "";
  }, [state.added]);

  return (
    <form action={formAction} className="border-border mb-4 border-b pb-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-2">
          <Label htmlFor={`${uid}-name`}>새 챌린지</Label>
          <Input
            id={`${uid}-name`}
            ref={inputRef}
            name="challengeName"
            maxLength={MAX_CHALLENGE_NAME_LENGTH}
            required
            placeholder="예: 포트폴리오 챌린지"
            className="w-64"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "등록 중…" : "등록"}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {state.error}
        </p>
      ) : null}

      {state.added && !state.error ? (
        <p role="status" className="mt-2 text-sm">
          <span className="font-medium">{state.added.name}</span> 등록 완료 ·
          프로그램 개설의 챌린지 목록에서 고를 수 있습니다.
        </p>
      ) : null}
    </form>
  );
}

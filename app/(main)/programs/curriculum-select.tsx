"use client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { MAX_CURRICULUM_DAYS } from "@/domain/program-setting";

/** 드롭다운에서 일수 칸을 여는 값. 일수와 겹치지 않는 이름이다. */
export const CUSTOM_CURRICULUM = "custom";

export type CurriculumPreset = { value: string; label: string };

/**
 * 커리큘럼 고르기 — 이름이 있는 것은 드롭다운에서, 나머지는 `직접 입력` 으로 일수를 적는다.
 * 프로그램 설정(구분 없음 · 1주 · 2주)과 개설 수정 폼(미지정 · 1주 · 2주)이 같은 모양을 쓴다.
 *
 * 값을 들고 있지 않는다. 설정 화면은 일수를 칠 때마다 폼을 옮기고 개설 화면은 값만 적어 두는 등
 * 바뀐 뒤 할 일이 달라서, 무엇을 골랐고 무엇을 쳤는지만 알린다.
 *
 * 드롭다운은 폼에 싣지 않는다. 고른 것이든 친 것이든 `name` 하나로 일수만 보낸다.
 */
export function CurriculumSelect({
  id,
  name,
  presets,
  custom,
  value,
  disabled = false,
  onPick,
  onType,
}: {
  id: string;
  name: string;
  presets: CurriculumPreset[];
  /** `직접 입력` 인지. 참이면 `value` 는 일수 칸에 적힌 그대로의 글자다. */
  custom: boolean;
  value: string;
  disabled?: boolean;
  /** 드롭다운에서 고른 값. 프리셋의 `value` 이거나 CUSTOM_CURRICULUM 이다. */
  onPick: (choice: string) => void;
  onType: (input: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <NativeSelect
        id={id}
        className="w-32"
        disabled={disabled}
        value={custom ? CUSTOM_CURRICULUM : value}
        onChange={(event) => onPick(event.target.value)}
      >
        {presets.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
        <option value={CUSTOM_CURRICULUM}>직접 입력</option>
      </NativeSelect>

      {custom ? (
        <>
          <Input
            name={name}
            type="number"
            min={1}
            max={MAX_CURRICULUM_DAYS}
            required
            disabled={disabled}
            aria-label="커리큘럼 일수"
            className="w-20 text-center"
            value={value}
            onChange={(event) => onType(event.target.value)}
          />
          <span className="text-muted-foreground text-sm">일</span>
        </>
      ) : (
        <input type="hidden" name={name} value={value} />
      )}
    </div>
  );
}

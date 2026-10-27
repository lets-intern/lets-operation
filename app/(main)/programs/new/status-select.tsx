"use client";

import { useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/domain/program-launch";

import { changeDetailOpenStatus } from "./actions";

/** 상세페이지 오픈 태스크의 3단계 상태를 목록에서 바로 바꾼다. */
export function StatusSelect({
  taskId,
  status,
  label,
}: {
  taskId: string;
  status: TaskStatus;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <NativeSelect
      aria-label={`${label} 상태`}
      className="h-7 w-24 text-xs md:text-xs"
      disabled={pending}
      value={status}
      onChange={(event) => {
        const formData = new FormData();
        formData.set("taskId", taskId);
        formData.set("status", event.target.value);
        startTransition(() => changeDetailOpenStatus(formData));
      }}
    >
      {TASK_STATUSES.map((value) => (
        <option key={value} value={value}>
          {TASK_STATUS_LABELS[value]}
        </option>
      ))}
    </NativeSelect>
  );
}

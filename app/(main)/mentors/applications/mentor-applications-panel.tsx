"use client";

import { cn } from "cn";
import { ExternalLink, FileText, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useMemo, useOptimistic, useState, useTransition } from "react";

import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MentorApplicationRow } from "@/domain/mentor-application";
import {
  MENTOR_APPLICATION_STATUS_LABELS,
  MENTOR_APPLICATION_STATUSES,
  MENTOR_MEMO_MAX_LENGTH,
  type MentorApplicationStatus,
} from "@/domain/mentor-application-status";

import {
  deleteMentorApplicationAction,
  saveMentorApplicationMemoAction,
  setMentorApplicationStatusAction,
} from "./actions";

type StatusFilter = MentorApplicationStatus | "all";
/** 저장이 끝나기 전에 화면부터 바꾸는 고침 — 진행 상태, 운영 메모 */
type ApplicationEdit = { id: string; status: MentorApplicationStatus } | { id: string; adminMemo: string };
/** 화면부터 바꾸는 것 — 고침, 또는 삭제 */
type OptimisticChange = ApplicationEdit | { id: string; deleted: true };

const STATUS_BADGE_CLASS: Record<MentorApplicationStatus, string> = {
  received: "bg-red-100 text-red-800",
  reviewing: "bg-amber-100 text-amber-800",
  replied: "bg-muted text-muted-foreground",
};

function formatDateTime(iso: string): string {
  // 서버(UTC)와 브라우저가 같은 글을 그려야 hydration 이 어긋나지 않는다.
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `01012345678` → `010-1234-5678`. 저장은 숫자만 한다. */
function formatPhone(phone: string): string {
  return phone.length === 11
    ? `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
    : `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
}

/** 찾기 대상. 전화번호는 하이픈을 넣어 찾아도, 빼고 찾아도 걸리게 둘 다 넣는다. */
function matches(application: MentorApplicationRow, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!needle) return true;
  return [
    application.name,
    application.company,
    application.jobTitle,
    application.email,
    application.phone,
    formatPhone(application.phone),
    application.adminMemo,
  ].some((value) => value.toLowerCase().replace(/\s+/g, "").includes(needle));
}

function StatusBadge({ status }: { status: MentorApplicationStatus }) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium", STATUS_BADGE_CLASS[status])}>
      {MENTOR_APPLICATION_STATUS_LABELS[status]}
    </span>
  );
}

export function MentorApplicationsPanel({ applications: initial }: { applications: MentorApplicationRow[] }) {
  // 상태 · 메모를 고치거나 지우면 저장이 끝나기 전에 화면부터 바꾼다. 저장이 끝나면 새로 그린 목록이 그 자리를 잇는다.
  // 삭제가 실패하면 서버 목록에 그대로 있으므로 다시 나타난다.
  const [applications, applyChange] = useOptimistic(initial, (current, change: OptimisticChange) =>
    "deleted" in change
      ? current.filter((application) => application.id !== change.id)
      : current.map((application) => (application.id === change.id ? { ...application, ...change } : application)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  /** 저장 실패 문구. 어느 신청서의 것인지 함께 둬 다른 신청서를 열었을 때 남지 않게 한다. */
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<StatusFilter>("all");

  const searched = useMemo(
    () => applications.filter((application) => matches(application, deferredQuery)),
    [applications, deferredQuery],
  );
  // 상태 건수는 찾기까지만 거른 것에서 센다 — 상태를 고르면 다른 상태 건수가 0 이 되어 버리기 때문이다.
  const statusCounts = useMemo(() => {
    const counts = new Map<MentorApplicationStatus, number>();
    for (const application of searched) counts.set(application.status, (counts.get(application.status) ?? 0) + 1);
    return counts;
  }, [searched]);
  const listed = useMemo(
    () => (status === "all" ? searched : searched.filter((application) => application.status === status)),
    [searched, status],
  );

  // 상태를 바꿔 거른 목록에서 빠져도 보던 신청서는 오른쪽에 남긴다.
  const active = applications.find((application) => application.id === selectedId) ?? listed[0] ?? null;

  const save = (edit: ApplicationEdit) => {
    // 고른 신청서를 못 박는다. 목록 첫 신청서를 보던 중이면 상태를 바꿔 거른 목록에서 빠지는 순간
    // 오른쪽이 다음 신청서로 넘어가 이어 고친 값이 엉뚱한 신청서에 저장된다.
    setSelectedId(edit.id);
    setSaveError(null);
    startSaving(async () => {
      applyChange(edit);
      const { error } =
        "status" in edit
          ? await setMentorApplicationStatusAction(edit.id, edit.status)
          : await saveMentorApplicationMemoAction(edit.id, edit.adminMemo);
      if (error) setSaveError({ id: edit.id, message: error });
    });
  };

  const remove = (application: MentorApplicationRow) => {
    const message = `${application.name} 님의 신청서를 삭제할까요?\n첨부파일까지 지워지고 되돌릴 수 없습니다. 삭제하면 같은 전화번호로 다시 신청할 수 있습니다.`;
    if (!window.confirm(message)) return;
    // 지운 신청서를 붙들고 있지 않게 풀어 둔다 — 오른쪽은 거른 목록의 첫 신청서로 넘어간다.
    // 실패해서 다시 나타나면 오류 문구를 보이도록 그 신청서를 다시 고른다.
    setSelectedId(null);
    setSaveError(null);
    startSaving(async () => {
      applyChange({ id: application.id, deleted: true });
      const { error } = await deleteMentorApplicationAction(application.id);
      if (error) {
        setSelectedId(application.id);
        setSaveError({ id: application.id, message: error });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 찾기 · 거르기 */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-col gap-2 border-b py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="이름 · 회사 · 직무 · 이메일 · 전화번호 · 메모에서 찾기"
              className="pl-8"
              aria-label="신청서에서 찾기"
            />
          </div>
          <span className="text-muted-foreground text-sm">
            {listed.length === applications.length
              ? `${applications.length}건`
              : `${applications.length}건 중 ${listed.length}건`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="진행 상태">
          <StatusChip label="전체" count={searched.length} active={status === "all"} onClick={() => setStatus("all")} />
          {MENTOR_APPLICATION_STATUSES.map((entry) => (
            <StatusChip
              key={entry.key}
              label={entry.label}
              count={statusCounts.get(entry.key) ?? 0}
              active={status === entry.key}
              onClick={() => setStatus(status === entry.key ? "all" : entry.key)}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        {/* 목록 */}
        <ul className="flex max-h-[calc(100vh-15rem)] min-w-0 flex-col divide-y overflow-y-auto rounded-lg border">
          {listed.length === 0 ? (
            <li className="text-muted-foreground p-4 text-sm">
              {applications.length === 0 ? "아직 들어온 멘토 신청이 없습니다." : "조건에 맞는 신청서가 없습니다."}
            </li>
          ) : null}
          {listed.map((application) => (
            <li key={application.id}>
              <button
                type="button"
                onClick={() => setSelectedId(application.id)}
                className={cn(
                  "hover:bg-muted flex w-full flex-col items-start gap-1 p-2.5 text-left text-sm",
                  application.id === active?.id && "bg-muted",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <StatusBadge status={application.status} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    <Highlight text={application.name} query={deferredQuery} />
                  </span>
                  {application.hasAttachment ? (
                    <FileText className="text-muted-foreground size-3.5 shrink-0" aria-label="첨부파일 있음" />
                  ) : null}
                </span>
                <span className="text-muted-foreground w-full truncate text-xs">
                  <Highlight text={application.company} query={deferredQuery} />
                  {" · "}
                  <Highlight text={application.jobTitle} query={deferredQuery} />
                  {` · ${application.yearsOfExperience}년차`}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatDateTime(application.createdAt)} 신청
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* 신청서 보기 */}
        <section className="flex min-w-0 flex-col gap-3">
          {active ? (
            <ApplicationDetail
              key={active.id}
              application={active}
              query={deferredQuery}
              saving={saving}
              saveError={saveError?.id === active.id ? saveError.message : null}
              onSave={save}
              onDelete={() => remove(active)}
            />
          ) : (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">왼쪽 목록에서 신청서를 고르세요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
        count === 0 && !active && "text-muted-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ApplicationDetail({
  application,
  query,
  saving,
  saveError,
  onSave,
  onDelete,
}: {
  application: MentorApplicationRow;
  query: string;
  saving: boolean;
  saveError: string | null;
  onSave: (edit: ApplicationEdit) => void;
  onDelete: () => void;
}) {
  // 신청서를 바꾸면 key 가 바뀌어 새로 마운트되므로 메모 초안도 그 신청서의 저장된 값에서 시작한다.
  const [memo, setMemo] = useState(application.adminMemo);
  const memoDirty = memo !== application.adminMemo;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={application.status} />
          <h2 className="text-base font-semibold">
            <Highlight text={application.name} query={query} />
          </h2>
          <span className="text-muted-foreground text-sm">
            <Highlight text={application.company} query={query} />
            {" · "}
            <Highlight text={application.jobTitle} query={query} />
            {` · ${application.yearsOfExperience}년차`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive ml-auto"
          >
            <Trash2 data-icon="inline-start" aria-hidden />
            삭제
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          <Highlight text={formatPhone(application.phone)} query={query} />
          {" · "}
          <a href={`mailto:${application.email}`} className="hover:text-foreground underline-offset-2 hover:underline">
            <Highlight text={application.email} query={query} />
          </a>
          {` · ${formatDateTime(application.createdAt)} 신청`}
        </p>
      </div>

      {/* 진행 상태 · 운영 메모 */}
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="mentor-application-status" className="text-muted-foreground text-xs font-medium">
            진행 상태
          </label>
          <NativeSelect
            id="mentor-application-status"
            value={application.status}
            onChange={(event) => onSave({ id: application.id, status: event.target.value as MentorApplicationStatus })}
            className="w-auto"
          >
            {MENTOR_APPLICATION_STATUSES.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
          <span className="text-muted-foreground text-xs">지원자가 현황 조회에서 보는 값입니다.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mentor-application-memo" className="text-muted-foreground text-xs font-medium">
            운영 메모 <span className="font-normal">· 지원자에게는 보이지 않습니다</span>
          </label>
          <Textarea
            id="mentor-application-memo"
            value={memo}
            maxLength={MENTOR_MEMO_MAX_LENGTH}
            onChange={(event) => setMemo(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && memoDirty) {
                event.preventDefault();
                onSave({ id: application.id, adminMemo: memo });
              }
            }}
            placeholder="검토 내용, 연락한 기록 등"
            className="min-h-20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!memoDirty || saving}
              onClick={() => onSave({ id: application.id, adminMemo: memo })}
            >
              메모 저장
            </Button>
            {memoDirty ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setMemo(application.adminMemo)}>
                되돌리기
              </Button>
            ) : null}
            <span className="text-muted-foreground text-xs">
              {saving ? "저장하는 중…" : memoDirty ? "저장하지 않은 메모가 있습니다 (⌘↵ 로 저장)" : ""}
            </span>
            {saveError ? <span className="text-destructive text-xs">{saveError}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex max-h-[calc(100vh-26rem)] flex-col gap-4 overflow-y-auto rounded-lg border p-4">
        <section className="flex flex-col gap-2">
          <Field label="멘토링 가능 직무 분야">
            <TagList values={application.jobFields} />
          </Field>
          <Field label="가능한 멘토링 형태">
            <TagList values={application.mentoringTypes} />
          </Field>
        </section>

        <section className="flex flex-col gap-1.5 border-t pt-4">
          <h3 className="text-muted-foreground text-xs font-medium">자기소개</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{application.introduction}</p>
        </section>

        <section className="flex flex-col gap-1.5 border-t pt-4">
          <h3 className="text-muted-foreground text-xs font-medium">지원 동기</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{application.motivation}</p>
        </section>

        <section className="flex flex-col gap-1.5 border-t pt-4">
          <h3 className="text-muted-foreground text-xs font-medium">첨부 · 링크</h3>
          {!application.hasAttachment && application.links.length === 0 ? (
            <p className="text-muted-foreground text-sm">첨부파일과 링크가 없습니다.</p>
          ) : null}
          {application.hasAttachment ? (
            <a
              href={`/mentors/applications/${application.id}/attachment`}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
            >
              <FileText className="size-4" aria-hidden />
              이력서 · 포트폴리오 PDF 열기
            </a>
          ) : null}
          {application.links.map((link, index) => (
            <SafeLink key={`${index}-${link}`} href={link} />
          ))}
        </section>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted-foreground text-xs font-medium">{label}</h3>
      {children}
    </div>
  );
}

function TagList({ values }: { values: string[] }) {
  if (values.length === 0) return <p className="text-muted-foreground text-sm">없음</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span key={value} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">
          {value}
        </span>
      ))}
    </div>
  );
}

/** 지원자가 적은 주소. http(s) 만 링크로 걸고 나머지(javascript: 등)는 글로만 보인다. */
function SafeLink({ href }: { href: string }) {
  if (!/^https?:\/\//i.test(href)) return <p className="text-sm break-all">{href}</p>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary inline-flex w-fit items-center gap-1 text-sm break-all underline-offset-2 hover:underline"
    >
      {href}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

import { prisma } from "@/lib/prisma";
import { deleteStorageObject } from "@/lib/supabase-storage";

import { isMentorApplicationStatus, type MentorApplicationStatus } from "./mentor-application-status";

/**
 * 멘토 신청서(plan.md §5 — 멘토 관리).
 *
 * 신청서는 멘토 모집 랜딩(lets-mentor)이 같은 Supabase 프로젝트의 mentor_applications 에 넣는다.
 * 여기서는 읽고, 진행 상태와 운영 메모만 고친다 — 지원자가 낸 내용은 손대지 않는다.
 * 신청서를 통째로 지울 수는 있다. 중복 신청은 전화번호 unique 제약으로만 막으므로 지우면 같은 정보로 다시 신청할 수 있다.
 */

/** 첨부파일 bucket. lets-mentor 가 만들었다. */
export const MENTOR_ATTACHMENT_BUCKET = "mentor-attachments";

/** 화면에 넘기는 신청서. 시각은 문자열로 넘겨 서버와 브라우저가 같은 글을 그린다. */
export type MentorApplicationRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: MentorApplicationStatus;
  name: string;
  phone: string;
  email: string;
  company: string;
  jobTitle: string;
  yearsOfExperience: number;
  jobFields: string[];
  mentoringTypes: string[];
  introduction: string;
  motivation: string;
  /** 첨부 경로는 넘기지 않는다 — 열 때 서버가 id 로 다시 찾는다. */
  hasAttachment: boolean;
  links: string[];
  adminMemo: string;
};

export async function listMentorApplications(): Promise<MentorApplicationRow[]> {
  const rows = await prisma.mentorApplication.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // check 제약이 있어 다른 값은 들어올 수 없지만, 제약이 바뀌어도 화면이 깨지지 않게 접수 완료로 본다.
    status: isMentorApplicationStatus(row.status) ? row.status : "received",
    name: row.name,
    phone: row.phone,
    email: row.email,
    company: row.company,
    jobTitle: row.jobTitle,
    yearsOfExperience: row.yearsOfExperience,
    jobFields: row.jobFields,
    mentoringTypes: row.mentoringTypes,
    introduction: row.introduction,
    motivation: row.motivation,
    hasAttachment: Boolean(row.attachmentPath),
    links: row.links,
    adminMemo: row.adminMemo ?? "",
  }));
}

/** 진행 상태와 운영 메모만 고친다. 없는 신청서면 false. */
export async function updateMentorApplication(
  id: string,
  data: { status: MentorApplicationStatus } | { adminMemo: string },
): Promise<boolean> {
  const { count } = await prisma.mentorApplication.updateMany({
    where: { id },
    data:
      "status" in data
        ? { status: data.status }
        : // 비워 저장하면 칸도 비운다(빈 글 대신 null).
          { adminMemo: data.adminMemo.trim() === "" ? null : data.adminMemo },
  });
  return count > 0;
}

export async function findMentorAttachmentPath(id: string): Promise<string | null> {
  const row = await prisma.mentorApplication.findUnique({ where: { id }, select: { attachmentPath: true } });
  return row?.attachmentPath ?? null;
}

/**
 * 신청서와 첨부파일을 지운다. 없는 신청서면 false.
 *
 * 파일부터 지운다 — 파일 삭제가 실패하면 아무것도 바뀌지 않고, 행 삭제가 실패해도 다시 지우면 이어서 지워진다.
 * 행부터 지우면 실패했을 때 이력서가 주인 없는 파일로 bucket 에 남는다.
 */
export async function deleteMentorApplication(id: string): Promise<boolean> {
  const row = await prisma.mentorApplication.findUnique({ where: { id }, select: { attachmentPath: true } });
  if (!row) return false;
  if (row.attachmentPath) await deleteStorageObject(MENTOR_ATTACHMENT_BUCKET, row.attachmentPath);
  const { count } = await prisma.mentorApplication.deleteMany({ where: { id } });
  return count > 0;
}

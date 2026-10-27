import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { listAnnouncementNotices, listChallengeNotices } from "@/domain/challenge-notice";
import { getAnnouncementChannel } from "@/domain/notice-setting";
import { listSlackSenders } from "@/domain/slack-sender";

import { NoticesPanel } from "./notices-panel";

export const metadata: Metadata = { title: "안내문 관리 · LetsOperation" };

// 적어둔 안내문은 매번 최신이어야 한다. 공동 운영이라 다른 사람이 방금 고쳤을 수 있다.
export const dynamic = "force-dynamic";

export default async function ProgramNoticesPage() {
  const rows = await listChallengeNotices();
  // 계정은 챌린지에 딸린 것이 아니라 여러 챌린지가 함께 가리키는 것이라 따로 읽는다.
  const senders = await listSlackSenders();
  // 공지방은 글도 채널도 챌린지에 딸리지 않는다. 모든 챌린지가 한 벌을 함께 쓴다.
  const announcementNotices = await listAnnouncementNotices();
  const announcementChannel = await getAnnouncementChannel();

  return (
    <>
      <PageHeader
        title="안내문 관리"
        description="시작 전 · 회차마다 · 종료 후로 나눠 참여자 · 챌린지 공지방 · 멘토에게 나가는 글을 적어둡니다. 참여자와 공지방 안내문은 고른 사람의 슬랙 계정으로 정해둔 시각에 예약되고, 멘토 안내문은 카카오톡으로 직접 나갑니다."
      />

      <NoticesPanel
        rows={rows}
        senders={senders}
        announcementNotices={announcementNotices}
        announcementChannel={announcementChannel}
      />
    </>
  );
}

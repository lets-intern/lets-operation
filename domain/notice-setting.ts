import { prisma } from "@/lib/prisma";

/**
 * 챌린지에 딸리지 않는 안내문 설정. 줄은 하나뿐이다.
 *
 * 챌린지 공지방 채널은 **모든 챌린지가 같은 채널 하나를 쓴다**(plan.md §5). 챌린지마다
 * 적게 두면 한 곳만 바뀌었을 때 어느 챌린지 공지가 옛 채널로 가는지 아무도 모른다.
 */

const SETTING_ID = "default";

/** 적어둔 전체 공지 채널. 아직 한 번도 저장하지 않았으면 줄이 없고 `null` 이다. */
export async function getAnnouncementChannel(): Promise<string | null> {
  const setting = await prisma.noticeSetting.findUnique({
    where: { id: SETTING_ID },
    select: { announcementChannelId: true },
  });

  return setting?.announcementChannelId ?? null;
}

/**
 * 전체 공지 채널을 적는다. 비우면 공지방 글만 걸리지 않는 상태로 되돌린다.
 *
 * 이미 걸린 예약은 따라오지 않는다 — 슬랙에 걸린 것은 걸린 채널에 남는다(plan.md §5).
 */
export async function saveAnnouncementChannel(channel: string | null): Promise<void> {
  await prisma.noticeSetting.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, announcementChannelId: channel },
    update: { announcementChannelId: channel },
  });
}

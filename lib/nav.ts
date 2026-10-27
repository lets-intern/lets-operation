import {
  BarChart3,
  CalendarRange,
  FolderKanban,
  Heart,
  LayoutDashboard,
  Rocket,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NavChildItem = {
  label: string;
  href: string;
  /** 기획이 확정되지 않아 화면만 잡아둔 메뉴 */
  pending?: boolean;
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** 기획이 확정되지 않아 화면만 잡아둔 메뉴 */
  pending?: boolean;
  /** 하위 메뉴. 있으면 좌측 패널에서 펼쳐진 하위 목록으로 표시한다. */
  children?: NavChildItem[];
};

/** 좌측 패널 메뉴. 순서가 곧 화면 순서다. */
export const NAV_ITEMS: NavItem[] = [
  { label: "대시보드", href: "/dashboard", icon: LayoutDashboard, pending: true },
  {
    label: "업무 현황 관리",
    href: "/calendar",
    icon: CalendarRange,
    pending: true,
    children: [{ label: "업무 수행", href: "/calendar/execution" }],
  },
  {
    label: "프로그램 운영",
    href: "/programs",
    icon: Rocket,
    pending: true,
    children: [
      { label: "프로그램 개설", href: "/programs/new", pending: true },
      { label: "프로그램 설정", href: "/programs/settings", pending: true },
      { label: "안내문 관리", href: "/programs/notices", pending: true },
    ],
  },
  {
    label: "운영 헬스 체크",
    href: "/operation-health",
    icon: Heart,
    pending: true,
    children: [
      { label: "CS 수집", href: "/operation-health/cs-collection" },
      { label: "후기 관리", href: "/operation-health/reviews" },
      { label: "참여자 수행 현황", href: "/operation-health/participant-progress" },
    ],
  },
  {
    label: "프로그램 관리",
    href: "/program-management",
    icon: FolderKanban,
    pending: true,
    children: [
      { label: "상세페이지", href: "/program-management/detail-pages" },
      { label: "미션 가이드", href: "/program-management/mission-guides" },
      { label: "미션 콘텐츠", href: "/program-management/mission-contents" },
    ],
  },
  {
    label: "멘토 관리",
    href: "/mentors",
    icon: UsersRound,
    pending: true,
    children: [{ label: "멘토 신청", href: "/mentors/applications" }],
  },
  { label: "Redash", href: "/redash", icon: BarChart3, pending: true },
];

export const DEFAULT_PATH = "/dashboard";

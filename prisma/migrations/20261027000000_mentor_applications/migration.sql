-- 멘토 신청서(plan.md §5 — 멘토 관리). **기록용이다 — 운영 DB 에는 실행하지 않는다.**
--
-- 테이블은 lets-mentor 저장소의 supabase/migrations/20261027000000_mentor_applications.sql 이 이미 만들었다.
-- 여기 둔 것은 Prisma 가 이 테이블을 모르는 테이블로 보고 지우는 마이그레이션을 만들지 않게 하는 기록이며,
-- 운영 DB 에는 `prisma migrate resolve --applied 20261027000000_mentor_applications` 로 "적용됨" 만 적는다.
-- 그래도 실수로 돌았을 때 아무것도 바꾸지 않도록 전부 if not exists · or replace 로 둔다.
--
-- 첨부 bucket(storage.buckets) 은 Prisma 가 다루는 스키마 밖이라 옮기지 않았다. shadow DB 에는 storage 스키마가 없다.

create table if not exists public.mentor_applications (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- received: 접수 완료, reviewing: 검토중, replied: 회신완료 (어드민 툴에서 변경)
  status              text not null default 'received'
                      check (status in ('received', 'reviewing', 'replied')),

  name                text not null,
  phone               text not null unique check (phone ~ '^01[0-9]{8,9}$'),
  email               text not null,
  company             text not null,
  job_title           text not null,
  years_of_experience int  not null check (years_of_experience between 0 and 60),

  job_fields          text[] not null,
  mentoring_types     text[] not null,
  introduction        text not null,
  motivation          text not null,

  attachment_path     text,
  links               text[] not null default '{}',

  privacy_agreed_at   timestamptz not null,
  admin_memo          text
);

create index if not exists mentor_applications_created_at_idx
  on public.mentor_applications (created_at desc);

create or replace function public.mentor_applications_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- lets-mentor 원본은 drop trigger 후 다시 만든다. 여기서는 없을 때만 만든다 — 실수로 돌아도 운영 DB 를 건드리지 않는다.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'mentor_applications_updated_at'
      and tgrelid = 'public.mentor_applications'::regclass
  ) then
    create trigger mentor_applications_updated_at
      before update on public.mentor_applications
      for each row execute function public.mentor_applications_set_updated_at();
  end if;
end;
$$;

-- 정책을 만들지 않으므로 anon/authenticated 키로는 접근 불가. 이 앱은 DATABASE_URL 의 postgres 역할로 읽고 쓴다.
alter table public.mentor_applications enable row level security;

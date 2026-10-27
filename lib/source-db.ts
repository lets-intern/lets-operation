import { Pool } from "pg";

/**
 * 마케팅팀 사이트의 DB. 읽기만 하는 별도 접속이라 Prisma 를 또 두지 않고 pg 로 직접 다룬다.
 * 저쪽 스키마를 우리 schema.prisma 에 베껴 두면 저쪽이 컬럼을 고칠 때마다 우리 마이그레이션이
 * 따라 움직여야 한다. 쿼리 한 줄만 고치면 되도록 SQL 로 남겨둔다.
 *
 * 커넥션은 동기화할 때만 잠깐 쓰므로 넉넉히 잡을 이유가 없다.
 */
const globalForSource = globalThis as unknown as { sourcePool?: Pool };

export function sourceDb(): Pool {
  const cached = globalForSource.sourcePool;
  if (cached) return cached;

  const connectionString = process.env.SOURCE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "환경변수 SOURCE_DATABASE_URL 이 설정되지 않았습니다. 마케팅팀 DB 읽기 전용 계정을 받아 .env.local 에 넣으세요.",
    );
  }

  const pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });
  globalForSource.sourcePool = pool;
  return pool;
}

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma";

/**
 * Prisma 7 은 접속 URL 을 스키마가 아니라 드라이버 어댑터로 받는다.
 *
 * 첫 쿼리가 실행될 때 만든다. 빌드처럼 DB 를 쓰지 않는 단계에서 접속 정보를 요구하지 않고,
 * 개발 중 핫리로드마다 커넥션 풀이 새로 생기지도 않는다.
 *
 * 만들 때 쓴 접속 문자열을 같이 들고 있다가 값이 바뀌면 새로 만든다.
 * .env.local 을 고쳐도 예전 접속 정보를 그대로 쓰는 일을 막기 위해서다.
 */
type CachedClient = {
  client: PrismaClient;
  connectionString: string;
  /**
   * 이 인스턴스를 찍어낸 생성 클라이언트 클래스.
   *
   * `prisma generate` 를 다시 돌리면 lib/generated/prisma 가 새로 쓰이고, dev 서버는 그것을
   * 다시 읽어 다른 클래스 객체를 준다. 접속 주소만 보고 캐시를 지키면 새 모델을 모르는
   * 옛 인스턴스가 그대로 남아, 화면은 새 테이블을 묻는데 클라이언트가 그런 필드를 모른다며
   * 되받는다. 스키마를 고칠 때마다 dev 서버를 껐다 켜야 하는 이유가 이것이라 여기서 끊는다.
   */
  generated: typeof PrismaClient;
};

/**
 * 커넥션 풀 상한. 서버리스는 요청이 몰리면 인스턴스를 여러 개 띄우는데, 인스턴스마다
 * 풀을 통째로 채우면 풀러의 클라이언트 수를 금세 다 쓴다. 화면 하나가 한 번에 던지는
 * 질의가 네댓 개라 그만큼만 있으면 줄 서지 않는다.
 */
const POOL_MAX = 5;

/** 놀고 있는 연결은 붙들지 않는다. 다음 요청은 어차피 다른 인스턴스일 수 있다. */
const POOL_IDLE_MS = 10_000;

function createClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: POOL_MAX,
      idleTimeoutMillis: POOL_IDLE_MS,
    }),
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: CachedClient };

function getClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "환경변수 DATABASE_URL 이 설정되지 않았습니다. .env.local 을 확인하세요.",
    );
  }

  // 핫리로드를 거치면 예전 형태로 저장된 값이 남아 있을 수 있어 모양부터 확인한다.
  const cached = globalForPrisma.prisma;
  const cachedClient = cached?.client;

  if (
    cachedClient &&
    cached.connectionString === connectionString &&
    cached.generated === PrismaClient
  ) {
    return cachedClient;
  }

  // 접속 정보나 생성 클라이언트가 바뀌었으면 쓰던 커넥션은 정리하고 새로 만든다.
  if (cachedClient) void cachedClient.$disconnect().catch(() => {});

  const client = createClient(connectionString);
  globalForPrisma.prisma = { client, connectionString, generated: PrismaClient };
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    return Reflect.get(client, property, client);
  },
});

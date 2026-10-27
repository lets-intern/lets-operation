import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 부터 스키마에 접속 URL 을 두지 않는다. 마이그레이션 명령이 쓸 값을 여기서 읽는다.
// Next.js 와 같은 파일을 보도록 .env.local 을 먼저 읽는다.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // 마이그레이션은 커넥션 풀러를 거치지 않는 편이 안전하다.
  // DIRECT_DATABASE_URL 이 있으면 그것을 쓰고, 없으면 앱과 같은 주소를 쓴다.
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});

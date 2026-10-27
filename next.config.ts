import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // 상세페이지 화면 읽기가 푸는 크롬 압축본. 코드가 아니라 경로로 읽혀서 추적에 잡히지 않는다.
    "/program-management/detail-pages": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;

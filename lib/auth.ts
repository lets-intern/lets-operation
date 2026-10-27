export const SESSION_COOKIE = "lo_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30일

/**
 * 공용 비밀번호 1개로 접근을 막는다. 계정 분리는 하지 않는다(plan.md §2).
 * 쿠키에는 비밀번호를 넣지 않고, 비밀번호와 서버 시크릿을 합친 해시만 넣는다.
 * proxy 에서 같은 해시를 다시 계산해 비교하므로 쿠키를 위조할 수 없다.
 */
export async function createSessionToken(): Promise<string> {
  const password = requireEnv("APP_PASSWORD");
  const secret = requireEnv("AUTH_SECRET");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${password}`),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return timingSafeEqual(token, await createSessionToken());
}

export function isValidPassword(input: string): boolean {
  return timingSafeEqual(input, requireEnv("APP_PASSWORD"));
}

/** 길이가 달라도 조기 반환하지 않도록 고정 횟수로 비교한다. */
function timingSafeEqual(a: string, b: string): boolean {
  let mismatch = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    mismatch |= a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i % (b.length || 1));
  }

  return mismatch === 0;
}

function requireEnv(name: "APP_PASSWORD" | "AUTH_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 가 설정되지 않았습니다. .env.local 을 확인하세요.`);
  }
  return value;
}

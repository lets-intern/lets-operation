/**
 * Supabase Storage 의 private bucket 파일을 잠깐 열 수 있는 signed URL 을 만든다.
 *
 * 쓰는 곳이 멘토 신청 첨부파일 한 군데라 supabase-js 를 들이지 않고 Storage REST 를 바로 부른다.
 * secret(service role) 키는 서버에서만 읽는다 — 화면으로 나가는 것은 만료가 짧은 주소뿐이다.
 */

function storageConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("환경변수 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.");
  }
  return { url, key };
}

/** 경로 조각마다 인코딩한다. `/` 는 폴더 구분이라 그대로 둔다. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function createStorageSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string> {
  const { url, key } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      // sb_secret_ 키는 JWT 가 아니라 apikey 칸으로만 받는다. 예전 service_role JWT 도 이 칸으로 통한다.
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as { signedURL?: string; message?: string } | null;
  if (!response.ok || !body?.signedURL) {
    throw new Error(`첨부파일 주소를 만들지 못했습니다 (${response.status}${body?.message ? ` · ${body.message}` : ""}).`);
  }
  // 응답은 `/object/sign/...?token=` 처럼 /storage/v1 아래 경로만 준다.
  return `${url}/storage/v1${body.signedURL}`;
}

/** 파일을 지운다. 이미 없는 파일이어도 성공으로 본다 — 일괄 삭제 API 는 없는 경로를 건너뛰고 200 을 준다. */
export async function deleteStorageObject(bucket: string, path: string): Promise<void> {
  const { url, key } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`첨부파일을 지우지 못했습니다 (${response.status}${body?.message ? ` · ${body.message}` : ""}).`);
  }
}

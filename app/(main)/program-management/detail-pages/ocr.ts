import type { Worker } from "tesseract.js";

/**
 * 상세페이지 이미지 글자를 브라우저에서 읽는다(plan.md §5).
 *
 * 서버에서 읽지 않는 이유: 한 페이지를 읽는 데 수십 초가 걸려 서버 실행 시간 제한에 걸린다.
 */

/** 이 폭으로 줄여 읽는다. 원본(최대 5760px)과 인식률이 같고 서너 배 빠른 것을 확인했다. */
const READ_WIDTH = 1500;

/** 세로로 자르는 높이와 겹침. 긴 이미지를 통째로 넣으면 메모리가 모자라 멈춘다. 경계에 걸린 줄을 놓치지 않게 겹친다. */
const CHUNK_HEIGHT = 1000;
const CHUNK_OVERLAP = 120;

export async function createOcrWorker(): Promise<Worker> {
  // 수 MB 짜리 엔진이라 읽기를 시작할 때만 불러온다.
  const { createWorker } = await import("tesseract.js");
  return createWorker(["kor", "eng"]);
}

/**
 * 한 장을 읽는다. 멈추라는 신호가 오면 조각 사이에서 그만두고 null 을 돌려준다 —
 * 반쯤 읽은 글을 저장하면 다음에 그 이미지를 다시 읽지 않게 되기 때문이다.
 */
export async function readImageText(
  worker: Worker,
  src: string,
  shouldStop: () => boolean,
): Promise<string | null> {
  // 저장소가 CORS 를 열어두지 않아 우리 서버를 거쳐 받는다. 그래야 캔버스에서 픽셀을 읽을 수 있다.
  const response = await fetch(`/api/detail-image?src=${encodeURIComponent(src)}`);
  if (!response.ok) throw new Error(`이미지를 받지 못했습니다 (${response.status}).`);
  const blob = await response.blob();

  // 원본을 한 번 풀고 줄이면 5760×24000 이미지가 그 순간 수백 MB 를 잡는다. 처음부터 줄여 푼다.
  // 작은 이미지는 조금 커지는데 인식에는 해가 없다.
  const bitmap = await createImageBitmap(blob, { resizeWidth: READ_WIDTH, resizeQuality: "high" });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("캔버스를 쓸 수 없습니다.");
  }

  const lines: string[] = [];
  try {
    for (let top = 0; top < bitmap.height; top += CHUNK_HEIGHT - CHUNK_OVERLAP) {
      if (shouldStop()) return null;
      const height = Math.min(CHUNK_HEIGHT, bitmap.height - top);
      // 마지막 조각이 겹침보다 작으면 앞 조각에 이미 들어 있다.
      if (top > 0 && height <= CHUNK_OVERLAP) break;
      canvas.width = bitmap.width;
      canvas.height = height;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, bitmap.width, height);
      const { data } = await worker.recognize(canvas);
      lines.push(data.text);
    }
  } finally {
    bitmap.close();
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

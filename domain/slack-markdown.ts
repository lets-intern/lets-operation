/**
 * 안내문을 슬랙에 넘기기 직전에 손보는 곳. 데이터베이스도 슬랙도 모르는 순수 로직이다.
 *
 * 참여자 안내문은 `markdown_text` 로 나간다. 슬랙이 그 글을 **표준 마크다운**으로 읽어
 * 불렛 · 번호 목록 · 제목 · `[글자](주소)` 를 실제 서식으로 바꿔준다. 예전에 쓰던
 * `text`(mrkdwn)에는 목록 문법이 아예 없어서("There's no specific list syntax in
 * app-published text") `- 항목` 이 하이픈째로 찍혔다.
 *
 * 여기서 손대는 것은 **마크다운이 사람의 뜻과 어긋나는 두 자리**뿐이다. 나머지는 적은
 * 그대로 넘긴다 — 글을 우리가 고쳐 쓰기 시작하면 화면에서 본 것과 슬랙에 선 것이 갈린다.
 */

/** 목록 한 줄. 불렛(`-` `*` `+`)과 번호(`1.` `1)`) 둘 다, 중첩된 들여쓰기까지 센다. */
const LIST_LINE = /^\s*([-*+]|\d+[.)])\s+/;

/** 코드 블록의 울타리. 그 안은 글이 아니라 그대로 보여줄 내용이라 손대지 않는다. */
const CODE_FENCE = /^\s*(```|~~~)/;

/**
 * 이름이 정해진 호출. 사람 이름 멘션과 달리 아이디가 필요 없어 우리가 바꿔 줄 수 있다.
 *
 * 앞에 글자나 `<` 가 붙은 것은 건드리지 않는다 — 메일 주소(`a@here.com`)와 이미 슬랙
 * 문법으로 적힌 `<!here>` 를 두 번 바꾸지 않기 위해서다.
 */
const BROADCAST = /(?<![\w<`])@(channel|here|everyone)(?![\w-])/g;

/**
 * 적어둔 글을 슬랙에 넘길 꼴로. 바꾸는 것은 둘이다.
 *
 * 1. **목록 뒤에 빈 줄을 넣는다.** 마크다운은 목록 바로 다음 줄을 *그 항목의 이어지는
 *    문장*으로 읽는다. 그래서 이렇게 적으면
 *
 *        - 미션을 제출하세요
 *        - 마감은 금요일입니다
 *        문의는 채널에 남겨주세요
 *
 *    마지막 줄이 "마감은 금요일입니다" 불렛 **안으로 빨려 들어가** 들여쓰인 채로 선다.
 *    사람이 뜻한 것은 목록이 끝나고 새 문단이 시작하는 것이므로, 그 자리에 빈 줄을 넣는다.
 *    들여쓴 줄은 건드리지 않는다 — 그쪽은 항목에 붙이려고 일부러 들여쓴 것일 수 있다.
 *
 * 2. **`@channel` · `@here` · `@everyone` 을 슬랙 문법으로 바꾼다.** 평문으로 적으면
 *    슬랙은 그냥 글자로 둔다. `link_names` 로 맡기는 길은 막혔다 — 슬랙이 그 인자에
 *    "No longer supports linking individual users" 라고 못박았다.
 *
 * 줄바꿈은 먼저 `\n` 으로 맞춘다. 브라우저의 여러 줄 입력칸은 `\r\n` 으로 보내는데,
 * 그 상태로는 위의 규칙이 줄 끝의 `\r` 에 걸려 헛돈다.
 */
export function toSlackMarkdown(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false;

  for (const [index, line] of lines.entries()) {
    if (CODE_FENCE.test(line)) inCode = !inCode;

    out.push(inCode ? line : line.replace(BROADCAST, "<!$1>"));

    if (inCode || !LIST_LINE.test(line)) continue;

    const next = lines[index + 1];
    if (next === undefined) continue;
    // 이미 빈 줄이거나, 목록이 이어지거나, 항목에 붙이려 들여쓴 줄이면 그대로 둔다.
    if (next.trim() === "" || LIST_LINE.test(next) || /^\s/.test(next)) continue;

    out.push("");
  }

  return out.join("\n");
}

/**
 * 슬랙에서 멘션이 되지 않을 `@이름`. 하나라도 있으면 화면이 그 사실을 알린다.
 *
 * 사람 멘션은 **이름으로는 절대 걸리지 않는다.** 슬랙 사용자 아이디가 글 안에 이미
 * 있어야 해서(`<@U012AB3CD>`), 우리가 대신 찾아줄 수도 없다 — 이름과 아이디를 맞춰보려면
 * 슬랙 앱에 `users:read` 권한을 더하고 다시 설치해야 한다.
 *
 * 그 전까지는 조용히 실패하는 것이 가장 나쁘다. 적을 때는 멘션처럼 보이는데 나간 글에서는
 * 그냥 글자라, 부른 줄 알았던 사람이 아무 알림도 받지 못한다.
 */
export function unlinkedMentions(body: string): string[] {
  const found = body
    .replace(/`[^`]*`/g, "")
    .match(/(?<![\w<`])@[^\s@<>[\]()]+/g);

  if (found === null) return [];

  const broadcasts = new Set(["@channel", "@here", "@everyone"]);

  return [...new Set(found.filter((name) => !broadcasts.has(name)))];
}

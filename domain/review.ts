import { findMatches } from "./detail-page-content";

/**
 * 후기 관리가 다루는 후기의 규칙(plan.md §5 — 후기 관리).
 *
 * 받아오기(서버)와 화면(브라우저)이 같은 규칙을 써야 해서 DB 에 닿지 않는 것만 여기 둔다 —
 * 유형, 테스트 후기 거르기, 카테고리 키워드 규칙, 찾기.
 */

/**
 * 후기 유형. 순서가 곧 화면 탭 순서다. `query` 는 이 유형을 내보내는 쿼리 쪽 이름(유형 칸 값)이다.
 * `라이브 멘토링`은 챌린지 안의 미션 피드백 후기, `1:1 LIVE 멘토링`은 따로 파는 멘토링 상품의 후기라 완전히 다른 데이터다.
 */
export const REVIEW_TYPES = [
  { key: "MISSION", label: "미션", query: "미션" },
  { key: "CHALLENGE", label: "챌린지", query: "챌린지" },
  { key: "LIVE", label: "라이브", query: "라이브" },
  { key: "LIVE_FEEDBACK", label: "라이브 멘토링", query: "라이브 멘토링" },
  { key: "LIVE_MENTORING", label: "1:1 LIVE 멘토링", query: "1:1 LIVE 멘토링" },
  { key: "BLOG", label: "블로그", query: "블로그" },
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number]["key"];

const TYPE_KEYS = new Set<string>(REVIEW_TYPES.map((type) => type.key));

export function isReviewType(value: string): value is ReviewType {
  return TYPE_KEYS.has(value);
}

export const REVIEW_TYPE_LABELS = Object.fromEntries(REVIEW_TYPES.map((type) => [type.key, type.label])) as Record<
  ReviewType,
  string
>;

/** 쿼리의 `유형` 칸 값 → 유형 키. 모르는 값이면 null. */
export function reviewTypeFromQuery(value: string): ReviewType | null {
  return REVIEW_TYPES.find((type) => type.query === value)?.key ?? null;
}

/** 쿼리 349 가 내보내는 유형. 350 은 미션만 내보낸다. */
export const GENERAL_REVIEW_TYPES: ReviewType[] = ["CHALLENGE", "LIVE", "LIVE_FEEDBACK", "LIVE_MENTORING", "BLOG"];

/**
 * 챌린지 · 라이브 후기의 칸. 순서가 곧 후기 보기에 서는 순서다. `피드백 멘토`는 멘토 이름이라 나누지 않고 보여 주기만 한다.
 * 쿼리가 question_type 숫자를 이 이름으로 바꿔 내보낸다(1 좋았던 점 · 2 아쉬운 점 · 3 목표 · 4 목표 결과 …).
 */
export const REVIEW_PART_ORDER = [
  "목표",
  "목표 결과",
  "좋았던 점",
  "아쉬운 점",
  "고민",
  "고민 결과",
  "피드백 멘토",
  "피드백 좋았던 점",
  "피드백 아쉬운 점",
];

/** 카테고리를 붙이지 않는 칸 */
export function isClassifiedPart(part: string): boolean {
  return part !== "피드백 멘토";
}

export function comparePart(a: string, b: string): number {
  const rank = (part: string) => {
    const index = REVIEW_PART_ORDER.indexOf(part);
    return index < 0 ? REVIEW_PART_ORDER.length : index;
  };
  return rank(a) - rank(b);
}

/** 규칙에 안 걸린 칸이 가는 자리. 목록에서 사라지는 칸이 없어야 한다. */
export const UNCLASSIFIED = "UNCLASSIFIED";
export const UNCLASSIFIED_LABEL = "미분류";

/** 의견이 없는 빈 답. 유형마다 규칙은 다르지만 열쇠와 이름은 같다. */
export const EMPTY = "NO_OPINION";
const EMPTY_LABEL = "의견 없음·빈 답";

/** 규칙을 거는 칸. 블로그는 본문이 없어 프로그램 이름 · 글 제목에 건다. 없으면 후기 글(content)에 건다. */
type RuleField = "program" | "title" | "content";

type CategoryEntry = {
  key: string;
  label: string;
  hint: string;
  rule?: RegExp;
  on?: readonly RuleField[];
  /** 걸리면 이 카테고리만 붙인다 — 빈 답에 다른 카테고리가 같이 붙지 않게 한다. */
  exclusive?: boolean;
};

/*
 * 유형별 카테고리(2026-10-10 실데이터를 읽고 만든 초안, plan.md §5 — 후기 관리). 순서가 곧 화면에 서는 순서다.
 * 규칙은 저장하지 않고 화면을 그릴 때마다 붙이므로, 고치면 불러오기 없이 바로 반영된다. 매니저가 고친 카테고리는 따로 남는다.
 * 챌린지 · 라이브는 칸(좋았던 점 · 아쉬운 점 …)이 감정을 알려 주므로 카테고리는 주제로만 나눈다.
 */

const MISSION_CATEGORIES: readonly CategoryEntry[] = [
  { key: "STUCK", label: "어려움·막힘", hint: "미션을 하며 어렵거나 막막했다, 헷갈렸다, 모르겠다는 글", rule: /어렵(?!지 ?(?:는|도)? ?않)|어려[웠워운움]|막막|헷갈|힘들|힘든|쉽지 ?않|애매|감이 (?:안|잘 안)|모르겠|버거|벅차|고민이 (?:많|됐|되었|됩니다|돼)/i },
  { key: "GAIN", label: "도움·성취 체감", hint: "도움이 됐다, 유익했다, 뿌듯하다, 감을 잡았다는 글", rule: /도움이 (?:많이 |정말 |큰 |꽤 |너무 |매우 |되게 |많이 )?(?:됐|되었|되어|돼서|되네|된 것|될 것 같|되는 것 같|됩니다)|큰 도움|유익|좋았(?!을|겠)|뿌듯|감(?:이|을) (?:좀 |조금 |어느 ?정도 )?(?:잡혔|잡았|잡을 수 있|잡히는|잡게 되|잡혀)|수월|만족(?!스럽지 ?(?:는 )?못|하지 못)|덕분|와닿|의미 ?있(?:는|었던) 시간|의미 ?있었|뜻깊/i },
  { key: "TIME_ACCURACY", label: "시간·실수", hint: "풀이 시간, 오답 수, 계산 실수, 생각보다 오래 걸렸다는 글. 인적성 풀이 기록이 많다", rule: /오답|실수|소요 ?시간|풀이 ?시간|시간이 (?:너무 |많이 |좀 |꽤 |다소 |생각보다 )?(?:부족|오래 ?걸|걸리|걸렸|모자)|오래 ?걸|[0-9]+ ?분(?: ?[0-9]+ ?초)?\s*(?:[\/,|)]|소요|걸|동안|안에|만에|$)|시간 ?(?:단축|안배|분배|내에)|계산/i },
  { key: "HELPFUL_MATERIAL", label: "자료·도구 언급", hint: "템플릿 · 예시 · 합격자 사례 · 체크리스트 · 3WHY/K-STAR-K 같은 틀이나 해설을 언급한 글", rule: /템플릿|(?:제공(?:된|해 ?주신|해주신)|렛츠커리어|미션|이력서|경험 ?정리) ?양식|예시|가이드|체크 ?리스트|(?:학습|필수|추가|제공(?:해 ?주신|된)?) ?(?:콘텐츠|자료)|콘텐츠(?:를 통해|에서|덕분|가 도움)|세미나|강의|특강|프레임워크|3 ?WHY|K-?STAR|레퍼런스|프롬프트|합격(?:자|한)? ?(?:자소서|자기소개서|포트폴리오|포폴|이력서|예시|사례)|해설/i },
  { key: "GOAL_INTRO", label: "참여 동기·목표", hint: "신청 계기, 이루고 싶은 목표, 자기소개. 0회차 소감은 모두 여기 둔다", rule: /신청(?:하게|했|하였|합니다|한 (?:이유|계기|목적))|참여하게|참여했|(?:신청|참여) ?(?:목적|계기|동기)|목표(?:는|입니다|예요|에요|로 하고)|완주(?:하겠|할 수 있도록|하고 싶|해 ?보겠|하는 것이)|잘 ?부탁|안녕하세요|챌린지(?:를|에서)? 통해.{0,60}싶습니다/i },
  { key: "FEEDBACK_MENTOR", label: "피드백·멘토", hint: "멘토 · 현직자의 피드백 · 첨삭을 받은 소감이나 받고 싶다는 기대", rule: /피드백|멘토|첨삭|코멘트|현직자 ?(?:피드백|멘토링|세션|라이브|LIVE|분들께|님)|(?:^|[^드])라이브/i },
  { key: "QUESTION", label: "질문·궁금증", hint: "작성법이나 미션에 대한 질문. 답을 기다리는 글이다", rule: /궁금(?:합니다|해요|하네요|했습니다|했어요|했던 (?:점|부분)|한 ?(?:점|것|부분)|증이 (?:들|생|있))|여쭤|여쭙|(?:까요|나요|가요|는지요|을지요|ㄹ지요|건가요|되나요|하나요|인지요|될지요)\s*[?？]|Q ?[0-9][.)]|질문(?:드립|드려|이 있|있습니다)/i },
  { key: "OPS_REQUEST", label: "운영 문의·개선 요청", hint: "제출 · 링크 · 반려 문의, 해설 오류, 단톡방 초대 누락, `~해 주시면` 같은 요청", rule: /반려|대시보드(?:에|상|에서|의)? ?(?:미션|제출|안내|오류|에는|가 안)|(?:해설|문제|링크|제출|시스템|사이트|페이지|정답)(?:에|의|이)? ?오류|접속(?:이)? ?(?:안 ?되|되지 않)|에러|링크(?:를|가)? ?(?:다시|수정|확인|안 ?열|첨부)|링크 칸|확인 ?부탁|재제출|다시 제출|권한|접근이 안|열리지 않|업로드가 안|(?:지각|미제출|결석) ?처리|(?:슬랙|카톡방|단톡방|채널).{0,10}(?:초대|입장)|정오표|(?:해|만들어|추가해|올려|알려|안내해|제공해|열어|공유해) ?(?:주시면|주셨으면)|개선해 ?주|건의(?:드|사항)|요청드/i },
  { key: "DELAY", label: "늦은 참여·지연", hint: "늦게 합류했다, 지각 제출이다, 개인 사정이 있었다는 글", rule: /늦게 (?:제출|시작|참여|합류|올|들어|결제|신청)|늦어(?:서|져|지게)|늦었|지각|밀린|밀려|죄송|사정(?:이 있|으로|상)|기한 ?내에? (?:못|제출하지|완료하지)|추후에 (?:진행|제출)|결제(?:해서|하여)|(?:중간|뒤늦게) ?합류/i },
  { key: EMPTY, label: EMPTY_LABEL, hint: "`.` · `test` · 보너스 미션 고정 문구처럼 내용이 없는 소감. 이것이 붙으면 다른 카테고리는 붙이지 않는다", exclusive: true, rule: /^\s*(?:[.,~!?ㄱ-ㅎㅏ-ㅣ\-_*^;:\s]*|test|테스트|[a-z]|[0-9]+|완료|제출|제출합니다|제출 ?완료|업로드 ?완료|오늘도 완료~*|[0-9]+회차 ?미션 ?(?:제출|완료)[.!]*|보너스 미션 블로그 후기 제출|https?:\/\/\S+|열람용 제출입니다\.?)\s*$/i },
];

const CHALLENGE_CATEGORIES: readonly CategoryEntry[] = [
  { key: "CONTENT", label: "학습 콘텐츠·자료", hint: "강의 · 예시 · 템플릿 · 가이드 · 꿀팁 같은 학습 자료", rule: /콘텐츠|컨텐츠|자료|예시|예제|사례|샘플|템플릿|탬플릿|가이드|레퍼런스|체크리스트|강의|강연|특강|세미나|라이브\s*세션|게릴라|영상|교안|꿀팁|팁(?:을|이|들|과|도)?|노하우|양식|이론|풀이|설명|유용한\s*정보|정보(?:가|를|량|들이)?\s*(?:많|적|부족|풍부|유익|유용)/i },
  { key: "MENTOR_FEEDBACK", label: "멘토·현직자 피드백", hint: "피드백 · 첨삭 · 멘토링 · 질의응답. 피드백 좋았던 점 · 아쉬운 점 칸에는 늘 붙는다", rule: /피드백|첨삭|멘토|코멘트|1\s*[:대]\s*1|컨설팅|상담|현직자\s*(?:분|님)?(?:의|께|이|들)?\s*(?:피드백|코멘트|첨삭|답변|조언|멘토링|검토)|Q\s*&\s*A|QnA|질의\s*응답|답변(?:해|을|이)|질문(?:에|을|에\s*대한)?\s*(?:답|답변)|짚어\s*주|봐\s*주셔/i },
  { key: "CURRICULUM", label: "커리큘럼·미션 구성", hint: "커리큘럼과 미션 구성 · 순서 · 난이도 · 중복, 대상 수준", rule: /커리큘럼|구성(?:이|도|은)?\s*(?:알차|좋|탄탄|체계|잘|적절|아쉬|훌륭|유익|짜임)|(?:알차게|잘|체계적으로)\s*구성|단계별|단계적|단계를|순서|순차|(?:전체적인|전반적인|미션의|회차)\s*흐름|흐름이\s*(?:좋|자연스럽|체계|매끄)|체계적(?:인|으로)?\s*(?:구성|커리큘럼|프로그램|가이드|진행|설계|짜여|이|이었|이라|이어서|이여서|이고|이며|이었고)|잘\s*짜여|짜임새|차근차근|난이도|너무\s*(?:쉬|어려)|겹치|겹쳐|중복|동일(?:한|해서)|미션\s*(?:구성|설계|내용|개수|수가|양|방식)|미션(?:이|들이)\s*(?:좋|알차|유익|적절|많|어렵|쉬)|과제\s*(?:구성|내용)|트랙|대상(?:이|은|으로|층)|타겟|경력자(?:보다|에게|를|는)|이직자|신입(?:을|에게)\s*위한|대학생(?:을|에게)\s*위한|초보|초심자|수준(?:이|의|에)/i },
  { key: "SCHEDULE_LOAD", label: "일정·기간·분량", hint: "기간이 짧다 · 촉박하다, 분량, 예상 소요 시간, 마감 시각", rule: /기간(?:이|은|을|도)?\s*(?:짧|길|촉박|타이트|빠듯|부족|넉넉|여유|조금|좀|너무|더|늘|연장)|촉박|빠듯|타이트|빡빡|빡세|벅차|벅찼|시간(?:이|적)?\s*(?:부족|모자|촉박|여유|없)|(?:예상|소요|제시한|제시된)\s*시간|시간이\s*(?:오래|많이|훨씬)\s*(?:걸|소요|들)|오래\s*걸|짧(?:았|아서|다|아요|습니다)|짧은\s*(?:기간|시간)|널널|여유(?:롭|가|있)|분량|양이\s*(?:많|적)|하루\s*이틀|일정(?:이|을|에|도)|스케[줄쥴]|더\s*긴|길었|\d+\s*시(?:에|로|는)|평일|주말/i },
  { key: "MOTIVATION_HABIT", label: "강제성·동기부여·습관", hint: "마감이 있어 미루지 않았다, 완주, 꾸준함, 의지", rule: /강제성|강제(?:로|적)|억지로|동기\s*부여|미루|미뤄|미뤘|미룬|루틴|습관|완주|꾸준|의지|자극|원동력|책상에|게으름|나태|마감(?:이|기한이)?\s*(?:있|정해)|데드라인(?:이|을)?\s*(?:있|정해)|열심히\s*(?:참여|하겠|따라|해\s*보|임하|달려)|성실(?:히|하게)|끝까지|포기하지|다짐|화이팅|파이팅/i },
  { key: "COMMUNITY", label: "참여자 커뮤니티", hint: "단톡방 · 다른 참여자 · 인증 · 소감 공유 · 교류", rule: /단톡|카톡방|카카오톡\s*방|톡방|오픈\s*채팅|옵챗|채팅방|참여자(?:분)?들|참가자(?:분)?들|다른\s*(?:참여자|참가자|분들|사람들|멤버|취준생|분)(?:과|와|의|이랑|도|들)|동료|멤버들|같은\s*기수|기수\s*분들|인증|소감|소통|교류|네트워킹|실명|소속감|혼자가\s*아니|함께\s*(?:하는|한다는|하니|해서)/i },
  { key: "OPERATION", label: "운영·안내", hint: "운영진 · 공지 · 안내 · 리마인드 · 문의 응대 · OT", rule: /운영(?:진|자|팀|이|방식|측|\s*실수)|공지|안내(?:가|를|해\s*주|받|\s*사항|문자|톡|메일|도)|리마인드|알림|알람|문의|응대|매니저|(?<![A-Za-z])OT(?![A-Za-z])|오티|녹화본|관리(?:가|를)\s*(?:철저|잘|해)/i },
  { key: "PLATFORM", label: "대시보드·제출 시스템", hint: "대시보드 · 노션 · 링크 · 업로드 · 오류 · 접속 · 권한", rule: /대시보드|웹\s*사이트|(?<!인)사이트(?:에|가|에서)|홈페이지|노션|구글\s*(?:시트|스프레드)|스프레드\s*시트|시트(?:에|가|를|로)|링크|모바일|오류|에러|접속|업로드|제출\s*(?:방식|방법|시스템|창|버튼)|저장(?:이|이\s*안|할\s*수)|권한|복제/i },
  { key: "PRICE_REWARD", label: "가격·옵션·환급", hint: "가격 · 가성비 · 환급 · 페이백 · 플랜 옵션", rule: /가격|비용|비싸|비쌌|가성비|저렴|환급|페이백|보증금|결제|금액|돈(?:을|이)?\s*(?:주고|내고|낸|들|지불)|할인|옵션|스탠다드|프리미엄|베이직|베이지/i },
  { key: "EXPERIENCE_STRENGTH", label: "경험 정리·자기 이해", hint: "경험을 정리하고 강점 · 역량을 찾음, 나를 돌아봄", rule: /경험\s*정리|경험을\s*(?:정리|돌아|되돌|구체|체계|구조|분류)|경험들을|STAR|스타\s*기법|직무\s*역량|핵심\s*역량|역량\s*(?:도출|정리|키워드|파악)|(?:나의|저의|제|내)\s*(?:역량|강점|경험)|강점|자신을\s*(?:돌아|객관)|(?:나|저)\s*자신|나에\s*대해|저에\s*대해|돌아볼|돌아보|되돌아|회고|소재|에피소드/i },
  { key: "DOC_COMPLETE", label: "서류 작성법·완성", hint: "서류 작성 방향을 잡음, 작성법, 완성 · 달성 정도", rule: /(?:자기\s*소개서|자소서|이력서|포트\s*폴리오|포폴|서류)\S{0,6}\s*(?:작성|만들|완성|수정|보완|발전|개선|퀄리티|쓰는|써\s*(?:보|내)|다듬|업데이트|제출|검토|방향|틀|기틀|구성)|방향(?:성)?(?:을|이)?\s*(?:잡|알|정리|제시)|갈피|감(?:을|이)?\s*(?:잡|익|오|왔)|어떻게\s*(?:써|작성|적어|구성|풀어)|작성\s*(?:방법|법|요령)|쓰는\s*(?:법|방법)|완성|달성|마무리|끝[냈마]|작성\s*완료|초안|마스터\s*(?:자소서|자기소개서|포폴|포트폴리오|이력서)|\d+\s*(?:%|퍼센트|프로)|결과물|완료/i },
  { key: "JOB_APPLY", label: "직무 탐색·지원·합격", hint: "직무 · 기업 분석, 지원, 서류 합격 · 면접 · 취업", rule: /직무\s*(?:탐색|분석|이해|선택|선정|방향|적합|전환|에\s*대한|에\s*대해|를\s*정|를\s*탐색|가\s*무엇)|기업\s*분석|산업\s*분석|회사\s*분석|공고\s*분석|채용\s*공고|(?<![A-Za-z])JD(?![A-Za-z])|공채|지원(?:했|하였|해\s*보|해봤|을\s*(?:했|하|시작)|할\s*수|하려|하기)|서류\s*(?:합격|통과|탈락|전형)|최종\s*합격|합격(?!자)(?:했|하였|을|률|하고|하기|할|해|\s*소식)|불합격|탈락|면접(?:을|에|이|\s*(?:준비|대비|기회|제의|연락|보|전형|질문))|인적성|입사|취뽀|취업(?:에|을)?\s*(?:성공|했|하였|하고|하기|할)|이직(?:에|을)?\s*(?:성공|했|준비)|커리어\s*전환|진로|취업(?:\s*(?:성공|목표|가자|시작|준비를\s*시작)|$|!)|(?:상|하)반기(?:에|\s*(?:공채|채용|취업|지원))/i },
  { key: "PERSONAL_SITUATION", label: "개인 사정·자기 반성", hint: "바빠서 · 아파서 못 했다, 더 열심히 할 걸 같은 자기 반성", rule: /(?:(?:^|\s)제|저의|나의|(?:^|\s)내|스스로)\s*(?:자신이|탓|의지|게으|문제)|스스로가|제\s*자신에게|개인적(?:인|으로)?\s*(?:사정|일정|문제|이유|인\s*일|으로\s*바)|개인의\s*문제|(?:더|좀\s*더)\s*(?:열심히|부지런|적극적|성실|꼼꼼)(?:하게|히)?\s*(?:하지|참여하지|임하지|못)|열심히\s*(?:하지|못)|병행(?:하다|하느라|하면서|하며|해서)|바빠(?:서|져|지)|바쁜\s*(?:탓|일정\s*(?:으로|때문))|바빴(?:어서|기\s*때문|던\s*탓)|아파|아팠|몸살|(?<!마)감기|여행|아르바이트|알바|회사\s*일|본업|회사\s*일정|게을|참여하지\s*못|집중하지\s*못|몰두하지\s*못|늦게\s*시작|시험\s*기간|참여도가\s*낮|따라가지\s*못|(?:다|모두)\s*제출하지\s*못|(?:기한|마감)을?\s*(?:잘\s*)?(?:못\s*지|지키지\s*못)|지각(?:을|했|하게)|학기\s*중|학교\s*수업/i },
  { key: EMPTY, label: EMPTY_LABEL, hint: "없습니다 · 딱히 없음 · 아직 피드백 전처럼 의견이 없는 답. 이것이 붙으면 다른 카테고리는 붙이지 않는다", exclusive: true, rule: /^\s*(?:[.\-ㅇㄹxX\s~!]*|없(?:음|습니다|어요|어욧|습니당|ㅅ브니다|다|어용)?[.!~ ]*|엇습니다|해당\s*없음\S*|(?:딱히|크게|따로|특별히|아무리\s*생각해봐도\s*큰)\s*(?:아쉬움은\s*)?없\S*(?:\s*(?:좋았습니다|만족합니다|감사합니다|수고하셨습니다|그동안\s*수고하셨습니다)\S*)*|(?:아쉬(?:운|웠던)\s*(?:점|부분)(?:은|이)?\s*)?(?:딱히\s*|크게\s*|따로\s*|특별히\s*|전혀\s*)?없(?:었)?(?:습니다|음|어요|네요|었습니다)[!.~ :)]*(?:(?:좋았습니다|너무\s*만족합니다|감사합니다|그동안\s*수고하셨습니다|모두\s*만족스러웠습니다)[!.~ :)]*)*|test|visit|d|네+|짱|굿|별로|만족|기억\s*안\s*남|잘\s*모르겠\S*|생각나는\s*(?:게|점은?)\s*없\S*|(?:전체적으로|전반적으로|모두|매\s*과정|다)?\s*(?:너무|정말|매우)?\s*(?:만족스러웠습니다|만족합니다|좋았(?:습니다|음|어요)|유익했습니다|감사합니다|최고)[!.~ :)ㅎ]*|[^가-힣]*(?:아직|진행\s*전|못\s*받았|받아본\s*적이\s*없)[\s\S]{0,50})\s*$/i },
];

const LIVE_CATEGORIES: readonly CategoryEntry[] = [
  { key: "JOB_CAREER", label: "직무·커리어 이야기", hint: "직무 · 업무 · 업계 이해와 현직자의 취업기 · 커리어 경험담", rule: /현직자의?\s?(?:이야기|경험|후기|입장|분의|사례|말)|(?:본인|개인)의\s?(?:인턴\s?)?경험|경험\s?(?:기반|을\s?바탕)|취업\s?(?:준비를?\s?하신|스토리|이야기|성공)|취준\s?(?:성공|이야기|과정)|준비\s?과정|커리어로드|로드맵|직무|업무|현업|실무|(?<!렛츠)커리어|직업|산업|업계|기업\s?문화|일하는|하는\s?일|어떤\s?일|무슨\s?일|PM|HR|ESG|에디터|마케터|기획자|개발자|세일즈|AE|BD|진로|이직|스타트업|소셜/i },
  { key: "DOCUMENTS", label: "서류 작성", hint: "자소서 · 이력서 · 포트폴리오 · 경험정리 · 링크드인 작성법", rule: /자소서|자기\s?소개서|이력서|포폴|포트\s?폴리오|경험\s?정리|STAR|지원\s?동기|서류|장표|링크드인/i },
  { key: "INTERVIEW_PREP", label: "면접·인적성·공채 준비", hint: "면접, 인적성, 공채 일정 · 타임라인, 취업 스터디", rule: /면접|인적성|공채|타임라인|준비\s?일정|월별|절차|하반기\s?(?:시작|공채)|스터디|1분\s?자기소개/i },
  { key: "EXAMPLES", label: "실제 사례·자료", hint: "합격 자소서 · 실제 예시 · 연사 본인 서류 공개 · 자료집", rule: /예시|사례|합격\s?(?:자소서|자료|자기소개서)|자료|PPT|피피티|템플릿|(?:자료|자소서|자기소개서|포트폴리오|포폴|이력서)[^.]{0,15}(?:공개|공유)|(?:자소서|이력서|포트폴리오|포폴|예시|사례|자료)[^.]{0,12}보여|How-?To/i },
  { key: "QNA", label: "질의응답·소통", hint: "Q&A 시간과 답변, 소그룹 · 워크숍 · 네트워킹", rule: /(?<!마지막 )질문|질의|Q\s?&\s?A|QnA|큐앤에이|답변(?!\s?(?:사례|내용))|소통|네트워킹|커피챗|참여형|소그룹|워크숍/i },
  { key: "SPEAKER", label: "연사 태도·전달력", hint: "솔직함 · 진정성 · 열정 · 친절, 전달력", rule: /솔직|진솔|진심|진정성|열정|친절|성실|성심|꼼꼼|상냥|정성스|정성껏|생생|아낌없|따뜻|다정|공감하|귀여|태도|오프더레코드|전달력|시원시원|차분/i },
  { key: "CONTENT_LEVEL", label: "내용 깊이·실용성", hint: "깊이 · 난이도 · 대상 수준, 실습 여부, 구체성 · 실용성", rule: /깊이|얕|겉핥기|기초|기본적|입문|초보|초년생|고도화|중급|실습|뻔한|흔하게|구체적|실질적|실용|체계적|알찬|알차|압축|핵심만|핵심을|대상자|수준/i },
  { key: "TIME_PACE", label: "시간·진행 속도", hint: "강의 길이, 시간 부족 · 초과, 속도", rule: /시간이?\s?(?:너무|조금|좀|부족|촉박|짧|길|늘|넉넉|오버|할애)|시간\s?부족|제한\s?시간|짧게|짧은|길게|길다|길어|빠르|속도|늘어지|템포|빡빡|쉬는\s?시간|타이트|늦은\s?시간|(?<![가-힣])한\s?시간|1시간|2시간|4시간|시간\s?(?:조정|오버)/i },
  { key: "OPERATION", label: "운영·환경", hint: "장소 · 와이파이 · 알림 · VOD · 녹화 · 온오프라인, 홍보 문구와 실제 내용의 차이", rule: /와이파이|인터넷\s?\(|인터넷\s?(?:끊|연결)|끊김|공간|뒷자리|바퀴의자|스크린|알림|문자로|문자\s?등|VOD|녹화|오프라인|온라인|홍보|신청\s?당시|사전\s?점검|지방/i },
  { key: EMPTY, label: EMPTY_LABEL, hint: "없습니다 · 딱히 없음처럼 의견이 없는 답. 이것이 붙으면 다른 카테고리는 붙이지 않는다", exclusive: true, rule: /^\s*(?:[.\-ㅇㄹxX\s~!]*|없(?:음|습니다|어요|어욧|습니당|ㅅ브니다|다|어용)?[.!~ ]*|엇습니다|해당\s*없음\S*|(?:딱히|크게|따로|특별히|아무리\s*생각해봐도\s*큰)\s*(?:아쉬움은\s*)?없\S*(?:\s*(?:좋았습니다|만족합니다|감사합니다|수고하셨습니다|그동안\s*수고하셨습니다)\S*)*|(?:아쉬(?:운|웠던)\s*(?:점|부분)(?:은|이)?\s*)?(?:딱히\s*|크게\s*|따로\s*|특별히\s*|전혀\s*)?없(?:었)?(?:습니다|음|어요|네요|었습니다)[!.~ :)]*(?:(?:좋았습니다|너무\s*만족합니다|감사합니다|그동안\s*수고하셨습니다|모두\s*만족스러웠습니다)[!.~ :)]*)*|test|visit|d|네+|짱|굿|별로|만족|기억\s*안\s*남|잘\s*모르겠\S*|생각나는\s*(?:게|점은?)\s*없\S*|(?:전체적으로|전반적으로|모두|매\s*과정|다)?\s*(?:너무|정말|매우)?\s*(?:만족스러웠습니다|만족합니다|좋았(?:습니다|음|어요)|유익했습니다|감사합니다|최고)[!.~ :)ㅎ]*|[^가-힣]*(?:아직|진행\s*전|못\s*받았|받아본\s*적이\s*없)[\s\S]{0,50})\s*$/i },
];

const MENTORING_CATEGORIES: readonly CategoryEntry[] = [
  { key: "COVER_LETTER", label: "자기소개서 문항·문장", hint: "지원동기, 문항 구조(두괄식), 워딩, 첨삭", rule: /자소서|자기\s?소개서|지원\s?동기|문항|두괄식|워딩|첨삭|STAR|구조화/i },
  { key: "PORTFOLIO", label: "포트폴리오 구성·시각", hint: "프로젝트 · 장표별 보완, 가독성, 시각화, 컨셉", rule: /포트\s?폴리오|포폴|장표|프로젝트|시각성|시각화|시각적|가독성|컨셉|작업물/i },
  { key: "EXPERIENCE_STRENGTH", label: "경험·역량 어필", hint: "경험 선별 · 정리, 강점 · 역량 키워드, 성과 표현", rule: /(?:내|제|연구|개발|실무|인턴)\s?경험|경험(?:을|\s?정리|\s?구성)|역량|강점|키워드|성과|정량|Before|어필|경쟁력|인사이트를\s?내|메리트|나만의/i },
  { key: "JOB_FIT", label: "직무·기업 맞춤", hint: "JD · 공고 · 산업에 맞춘 방향, 직무 선택 · 전환, 이직", rule: /직무|JD|공고|산업|기업|회사의?\s?관점|업계|이직|전환|프레이밍|기획자의\s?시선|지원하고자|희망\s?직/i },
  { key: "DETAILED_FEEDBACK", label: "구체적·꼼꼼한 피드백", hint: "하나하나 짚어 줌, 예시를 들어 고칠 방향 제시", rule: /구체|꼼꼼|세세|세심|하나하나|하나씩|짚어|짚고|콕콕|자세|(?:명확|정확)(?:하게|히|하고)\s?(?:짚|설명|알려|친절)|명쾌|예시|확실하게\s?수정|위주로\s?알려|첨삭/i },
  { key: "MENTOR_VIEW", label: "멘토 시선·전문성", hint: "현직자 · 실무자 · 제3자의 객관적 관점", rule: /현직자|실무자|제3자|객관|혼자\s?(?:볼|써)|제\s?눈|못\s?보|관점|시각에서|시선|현실적|경험해보시지/i },
  { key: "QNA_TIME", label: "질의응답·시간 운영", hint: "질문 답변, 시간 초과 · 조정, 짧은 세션, 사후 연락", rule: /질문|답변|시간\s?(?:을\s?더|이?\s?오버|조정|내에?|내주)|짧은\s?(?:시간|\d+분)|\d+분\s?동안|커피챗|연락|문자로|추가\s?질문|오버/i },
  { key: "DIRECTION_CONFIDENCE", label: "방향·자신감", hint: "막막함 해소, 방향성, 확신 · 자신감, 칭찬", rule: /방향|자신감|자신\s?있|확신|용기|칭찬|막막|불안|걱정|감을|갈피|포기할/i },
  { key: EMPTY, label: EMPTY_LABEL, hint: "없습니다 · 딱히 없음처럼 의견이 없는 답. 이것이 붙으면 다른 카테고리는 붙이지 않는다", exclusive: true, rule: /^\s*(?:[.\-ㅇㄹxX\s~!]*|없(?:음|습니다|어요|어욧|습니당|ㅅ브니다|다|어용)?[.!~ ]*|엇습니다|해당\s*없음\S*|(?:딱히|크게|따로|특별히|아무리\s*생각해봐도\s*큰)\s*(?:아쉬움은\s*)?없\S*(?:\s*(?:좋았습니다|만족합니다|감사합니다|수고하셨습니다|그동안\s*수고하셨습니다)\S*)*|(?:아쉬(?:운|웠던)\s*(?:점|부분)(?:은|이)?\s*)?(?:딱히\s*|크게\s*|따로\s*|특별히\s*|전혀\s*)?없(?:었)?(?:습니다|음|어요|네요|었습니다)[!.~ :)]*(?:(?:좋았습니다|너무\s*만족합니다|감사합니다|그동안\s*수고하셨습니다|모두\s*만족스러웠습니다)[!.~ :)]*)*|test|visit|d|네+|짱|굿|별로|만족|기억\s*안\s*남|잘\s*모르겠\S*|생각나는\s*(?:게|점은?)\s*없\S*|(?:전체적으로|전반적으로|모두|매\s*과정|다)?\s*(?:너무|정말|매우)?\s*(?:만족스러웠습니다|만족합니다|좋았(?:습니다|음|어요)|유익했습니다|감사합니다|최고)[!.~ :)ㅎ]*|[^가-힣]*(?:아직|진행\s*전|못\s*받았|받아본\s*적이\s*없)[\s\S]{0,50})\s*$/i },
];

const BLOG_CATEGORIES: readonly CategoryEntry[] = [
  { key: "EXPERIENCE", label: "경험정리", hint: "기필코 경험정리 챌린지 후기", on: ["program", "title"], rule: /경험\s?정리|경험저리|기필코\s?시작/i },
  { key: "PORTFOLIO", label: "포트폴리오", hint: "포트폴리오 완성 챌린지 후기", on: ["program", "title"], rule: /포트폴리오|포폴/i },
  { key: "COVER_LETTER", label: "자기소개서", hint: "자소서 · 대기업 자소서 챌린지, 자소서 피드백 REPORT 후기", on: ["program", "title"], rule: /자기소개서|자소서/i },
  { key: "RESUME", label: "이력서", hint: "이력서 완성 챌린지 후기", on: ["program", "title"], rule: /이력서/i },
  { key: "JOB_TRACK", label: "직무 특화", hint: "HR · 마케팅 · PM/서비스기획 · 데이터처럼 직무 이름이 붙은 프로그램 후기", on: ["program", "title"], rule: /HR|인사\s?직무|마케팅|마케터|PM\/|서비스\s?기획|데이터/i },
  { key: "INTERVIEW_APTITUDE", label: "면접·인적성", hint: "면접 끝장 챌린지, 인적성 뽀개기 후기", on: ["program", "title"], rule: /면접|인적성/i },
  { key: "CAREER_SWITCH", label: "이직·경력자", hint: "이직 · 경력직 · 중고신입 · 퇴사 후 준비라고 밝힌 글. 본문 앞 몇 줄만 봐 놓치는 글이 많다", on: ["title", "content"], rule: /(?<!베)이직|경력직|중고\s?신입|재직\s?중|직무\s?(전환|변경)|퇴사|실업급여|조직과 다른/i },
  { key: "SERIES_LOG", label: "연재·회차 기록", hint: "회차별 미션 기록, 취준로그 #N처럼 여러 편으로 이어 쓴 글", on: ["title"], rule: /\d+\s?회차|취준\s?로그\s?#\d|취준\s?일기\s?(EP|Ep)\.?\s?\d|Ep\.\s?\d|#\d+\.|^\s*0\d\.|\.\.\.?\s?\d\s?\[|[^\d](0?[1-9])\.\s?더 이상|후기\s?\d$/i },
];
/** 라이브 멘토링과 1:1 LIVE 멘토링은 둘 다 서류를 놓고 멘토와 1:1로 만난 후기라 같은 목록을 쓴다. */
export const REVIEW_CATEGORIES: Record<ReviewType, readonly CategoryEntry[]> = {
  MISSION: MISSION_CATEGORIES,
  CHALLENGE: CHALLENGE_CATEGORIES,
  LIVE: LIVE_CATEGORIES,
  LIVE_FEEDBACK: MENTORING_CATEGORIES,
  LIVE_MENTORING: MENTORING_CATEGORIES,
  BLOG: BLOG_CATEGORIES,
};

export function isReviewCategory(type: ReviewType, value: string): boolean {
  return REVIEW_CATEGORIES[type].some((category) => category.key === value);
}

export function reviewCategoryLabel(type: ReviewType, key: string): string {
  if (key === UNCLASSIFIED) return UNCLASSIFIED_LABEL;
  return REVIEW_CATEGORIES[type].find((category) => category.key === key)?.label ?? key;
}

/** 챌린지 후기에서 멘토 피드백을 묻는 칸. 칸 자체가 멘토 피드백 이야기라 규칙과 상관없이 그 카테고리를 붙인다. */
const FEEDBACK_PARTS = new Set(["피드백 좋았던 점", "피드백 아쉬운 점"]);

export type RuleInput = {
  part: string;
  content: string;
  th: number | null;
  programTitle: string;
  blogTitle: string | null;
};

/**
 * 규칙이 붙이는 카테고리. 하나도 안 걸리면 미분류로 둔다.
 * - 빈 답이 걸리면 그것만 붙인다.
 * - 미션 0회차는 OT 자기소개라 참여 동기 · 목표로 고정한다 — 신청 전 고민이 어려움 · 막힘에 섞이지 않게 한다(2026-10-10 사용자가 정함).
 * - 챌린지의 피드백 좋았던 점 · 아쉬운 점 칸에는 멘토 · 현직자 피드백을 늘 붙인다(2026-10-10 사용자가 정함).
 */
export function ruleReviewCategories(type: ReviewType, input: RuleInput): string[] {
  const fields: Record<RuleField, string> = {
    program: input.programTitle,
    title: input.blogTitle ?? "",
    content: input.content,
  };
  const matches = (category: CategoryEntry) =>
    category.rule !== undefined && category.rule.test((category.on ?? ["content"]).map((field) => fields[field]).join("\n"));

  const categories = REVIEW_CATEGORIES[type];
  const exclusive = categories.find((category) => category.exclusive && matches(category));
  if (exclusive) return [exclusive.key];
  if (type === "MISSION" && input.th === 0) return ["GOAL_INTRO"];

  const matched = new Set(categories.filter((category) => !category.exclusive && matches(category)).map((category) => category.key));
  if (type === "CHALLENGE" && FEEDBACK_PARTS.has(input.part)) matched.add("MENTOR_FEEDBACK");
  const ordered = categories.map((category) => category.key).filter((key) => matched.has(key));
  return ordered.length > 0 ? ordered : [UNCLASSIFIED];
}

/** 화면에 서는 순서로 줄 세우고 겹친 것 · 목록에 없는 것을 뺀다. 매니저가 고른 카테고리를 저장할 때 쓴다. */
export function normalizeReviewCategories(type: ReviewType, values: string[]): string[] {
  const picked = new Set(values);
  return REVIEW_CATEGORIES[type].map((category) => category.key).filter((key) => picked.has(key));
}

/**
 * 모으지 않는 테스트 후기(2026-10-09 사용자가 정함). CS 수집의 기준(관리자 계정 · 내부 테스트 계정)에 더해
 * 프로그램 이름에 `test` · `테스트`가 든 것, 멘토가 `관리자`이거나 멘토와 멘티가 같은 사람인 라이브 멘토링.
 * 쿼리는 그대로 두고 여기서 거른다 — 기준이 바뀌어도 Redash 를 고치지 않아도 된다.
 */
const TEST_USER_IDS = new Set([1751]);

export function isTestReview(review: {
  type: ReviewType;
  userId: number | null;
  authorName: string | null;
  mentorName: string | null;
  programTitle: string;
}): boolean {
  const author = review.authorName?.trim() ?? "";
  const mentor = review.mentorName?.trim() ?? "";
  return (
    author === "관리자" ||
    (review.userId !== null && TEST_USER_IDS.has(review.userId)) ||
    /test|테스트/i.test(review.programTitle) ||
    (review.type === "LIVE_FEEDBACK" && (mentor === "관리자" || (mentor !== "" && mentor === author)))
  );
}

/** 찾기 대상 칸. 이름 · 프로그램 · 미션 · 멘토 · 블로그 글 제목 · 후기 내용. */
export type ReviewSearchable = {
  authorName: string | null;
  programTitle: string;
  missionTitle: string | null;
  mentorName: string | null;
  blogTitle: string | null;
  content: string;
};

export function countReviewHits(review: ReviewSearchable, query: string): number {
  if (!query.trim()) return 0;
  return [
    review.authorName ?? "",
    review.programTitle,
    review.missionTitle ?? "",
    review.mentorName ?? "",
    review.blogTitle ?? "",
    review.content,
  ]
    .map((field) => findMatches(field, query).length)
    .reduce((sum, count) => sum + count, 0);
}

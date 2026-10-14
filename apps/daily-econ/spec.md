# 하루 1분 경제 용어 계획서 (daily-econ)

> 상태: **초안 (승인 대기)** · 작성일 2026-10-14 · Plan 서브에이전트
> 대상 폴더: `apps/daily-econ/` (새 앱)
> 참고한 선례: `apps/economy-dashboard/spec.md`(문서 형식), `apps/savings-calculator/`(공통 머리·다크 모드·사용법 안내), `js/today-hero.js`(한국 시간 오늘 날짜 구하기)

---

## 1. 개요와 사용자 흐름

### 한 줄 요약
매일 **경제 용어 1개를 1분 안에** 읽고 OX 퀴즈 1문제를 풀어 카드를 모으고, **연속 학습일·잔디 달력·배지**로 쌓인 지식을 눈으로 보게 한다.

### 왜 만드나
- 블로그 41편에 흩어진 용어를 하루 한 개씩 쉬운 말로 보여 주고, 용어마다 그 용어를 다룬 글로 이어 준다(재방문 + 글 읽기 유도).
- 출퇴근 지하철에서 한 손으로 끝낼 수 있게: 읽기 30초 + 퀴즈 10초 + 기록 확인 10초.
- 하지 않는 것: 로그인, 서버 저장, 알림, 종목·상품 추천, "사세요" 같은 권유, 용어별 별도 HTML 페이지(2단계 범위 밖).

### 사용자 흐름

| 상황 | 화면에서 일어나는 일 |
|---|---|
| **첫 방문** | 제목·사용법 안내(펼친 상태)·"기록은 이 기기 브라우저에만 저장돼요" 안내 → 오늘의 용어 카드 → OX 퀴즈. 맞히면 "카드 획득! 🔥 1일째", 틀리면 해설 + [다시 풀기]. 아래 "내 기록"에 잔디 1칸이 칠해진다 |
| **매일 방문** | 사용법 안내는 접힌 상태(첫 방문 뒤부터). 오늘 용어 → 퀴즈 → 🔥 연속일 +1, 잔디 1칸, 카드 수 +1. 배지 기준에 닿으면 "새 배지: 경제 새싹" 띠를 한 번 보여 준다 |
| **이미 오늘 푼 뒤 다시 열기** | 퀴즈 자리에 "오늘 공부 끝! 내일 새 용어가 나와요(자정, 한국 시간)" + 결과. 다시 풀기 없음(이미 획득) |
| **하루 빠진 뒤** | "어제는 쉬었네요. 쉼표 1개를 써서 연속일을 지켰어요 🔥 12일째"(쉼표가 있을 때) 또는 "다시 1일째부터 시작해요. 지금까지 공부한 날은 모두 32일이에요"(쉼표 없을 때). 놓친 날의 용어는 "지난 용어"에서 풀어 카드를 주울 수 있다(연속일·잔디에는 안 셈) |
| **기록이 막힌 환경**(시크릿 창 등) | 오늘의 용어·퀴즈는 그대로. 기록 칸에 "이 브라우저에서는 기록을 저장할 수 없어요. 오늘 용어는 그대로 볼 수 있어요" |

---

## 2. 화면 구성 (모바일 우선, 375px 기준)

### 2-1. 와이어프레임

```
┌───────────────────────────────────┐
│ ← 블로그로            [🌙/☀️]    │  공통 머리(savings-calculator와 같은 틀)
├───────────────────────────────────┤
│ 하루 1분 경제 용어                 │
│ 매일 용어 하나, 퀴즈 하나로 쌓아요 │
│                                   │
│ ▸ 이렇게 써요 (사용법)             │  <details>, 첫 방문만 open
│   ① 매일 자정(한국 시간)에 새 용어 │
│      1개가 나와요. 누구나 같은 용어│
│   ② 3줄 설명을 읽고 OX 퀴즈를 풀면 │
│      카드를 모아요. 틀려도 해설을  │
│      보고 다시 풀 수 있어요.       │
│   ③ 기록은 이 휴대폰 브라우저에만  │
│      저장돼요. 기기를 바꾸거나     │
│      방문 기록을 지우면 사라져요.  │
│   ④ 설명은 블로그 글 기준이에요.   │
│      투자 권유가 아니에요.         │
├───────────────────────────────────┤
│ 10월 14일 오늘의 용어   [세금]     │  날짜 + 카테고리 칩(--color-tag-bg)
│ ┌───────────────────────────────┐ │
│ │ 세액공제                       │ │  큰 글씨
│ │ = 낸 세금에서 바로 빼 주는 돈  │ │  한 줄 정의(굵게)
│ │ · 소득공제는 세금 매길 돈을    │ │
│ │   줄이고, 세액공제는 세금을…  │ │  3줄 설명
│ │ · …                            │ │
│ │ · …                            │ │
│ │ 💡 예) 연금저축에 600만 원 넣으 │ │  생활 예시(--color-surface 박스)
│ │    면 최대 99만 원 돌려받아요   │ │
│ │ [관련 글 읽기 →]               │ │  44px 이상
│ └───────────────────────────────┘ │
├───────────────────────────────────┤
│ OX 퀴즈                            │
│ "세액공제는 세금 매길 소득을       │
│  줄여 주는 제도다."                │
│  ┌──────────┐ ┌──────────┐        │
│  │    O     │ │    X     │        │  각 버튼 폭 48% · 높이 56px
│  └──────────┘ └──────────┘        │
│ (답한 뒤) ✔ 정답이에요! 카드 획득  │  또는 "아쉬워요. 해설: … [다시 풀기]"
│ [오늘 카드 공유] (결정 4)          │
├───────────────────────────────────┤
│ 내 기록                            │
│ 🔥 12일 연속 · 최장 20일 · 쉼표 1  │
│ 모은 카드 27 / 60                  │
│ 다음 배지 "경제 잎새"까지 3장      │  진행 막대
│ ┌ 잔디 (최근 12주) ─────────────┐ │
│ │ 월 ■■□■■■■■■■■■             │ │  7행 × 12열, 칸 18px+간격 4px
│ │ …                             │ │  = 264px, 375px에 들어감
│ │ 일 ■■■□■■■■■■■□             │ │
│ └───────────────────────────────┘ │
│ 배지: 🌱첫 카드 🌿경제 새싹 …      │  얻은 것만 진하게, 나머지 흐리게+자물쇠
├───────────────────────────────────┤
│ 지난 용어 다시 보기                │
│ [전체][세금][연금][저축][투자]…    │  가로 칩(줄바꿈 허용, 가로 스크롤 없음)
│ ▸ 세액공제        세금  ✔         │  <details>로 펼치면 3줄 설명+예시+글 링크
│ ▸ 파킹통장        저축  ✔         │
│ ▸ 신용점수     생활금융  (놓침)    │  → 펼치면 [퀴즈 풀고 카드 줍기]
├───────────────────────────────────┤
│ 기록 지우기(작게, 확인창)          │
│ 출처·면책: 설명은 Financial Diary  │
│ 블로그 글 기준이며 투자·대출 권유가│
│ 아니에요. 세법 수치는 ○년 기준.   │
└───────────────────────────────────┘
```

### 2-2. 공통 규칙
- 색은 `css/style.css` 변수만(`--color-accent`, `--color-tag-bg`, `--color-surface`, `--color-border` 등). **새 hex 금지.** 예외가 필요하면(정답/오답 표시) savings-calculator의 `--sc-color-error`처럼 앱 접두사 변수 1~2개만 두고 Review에서 대비 확인.
- 잔디 칸 색: 공부한 날 `--color-accent`, 쉼표로 지킨 날 `--color-tag-bg` + 테두리 점선, 안 한 날 `--color-surface` + `--color-border`. **색만으로 구분하지 않고** 칸마다 `aria-label="10월 14일 공부함"`, 표 아래 범례 글자.
- 다크 모드: 블로그 변수로 자동. 머리의 테마 단추는 savings-calculator와 같은 방식이되 **`localStorage.getItem('theme')`를 try/catch로 감싼다**(선례 코드는 감싸지 않아 시크릿 창 일부에서 멈출 수 있음).
- 터치 영역 44px 이상, 글씨 16px 이상, 가로 스크롤 0(320px까지).
- 데스크톱(768px 이상): 1열 그대로, 폭 `--content-width`. 2열로 나누지 않는다(1분 앱이라 위에서 아래로 읽는 순서가 중요).
- 애니메이션: 카드 획득 시 짧은 확대(0.3초). `prefers-reduced-motion`이면 끈다.
- 문체: 동사로 끝내고 "~해요" 말투. 벌주는 말("실패", "끊겼습니다") 쓰지 않는다.

---

## 3. 규칙 표

### 3-1. 오늘의 용어 고르기

| 항목 | 규칙 |
|---|---|
| 날짜 기준 | **한국 시간(Asia/Seoul) 날짜**. `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'})`로 `YYYY-MM-DD`를 구하고, 실패하면 `Date.now()+9시간`의 UTC 날짜(js/today-hero.js와 같은 방법). 기기 시간대가 어디든 같은 결과 |
| 바뀌는 시각 | **한국 시간 자정(00:00 KST)** = UTC 전날 15:00. UTC 자정(오전 9시 KST)이 아님 |
| 순번 계산 | `k = (오늘 KST 날짜 − terms.json의 startDate)`의 날짜 수. 두 날짜를 `Date.UTC(y,m-1,d)`로 바꿔 빼고 86,400,000으로 나눔(시간·서머타임 영향 없음) |
| 고르기 | `k < 용어 수(N)`이면 `terms[k]`, 아니면 **`terms[k mod N]`(처음부터 순환)**. `k < 0`(기기 시계가 시작일보다 이름)이면 `terms[0]` |
| 모두 같은 용어 | 계산이 날짜와 파일만으로 정해지므로 같은 날 모든 사람이 같은 용어를 본다 |
| 용어 추가 | 새 용어는 **배열 끝에만** 붙인다. 하루 1개씩 붙으면 N도 하루 1개씩 늘어 순환에 들어가지 않는다(60일 앞서 쌓인 대기열) |
| 금지 | 배열 순서 바꾸기·용어 삭제·`startDate` 변경 금지(지난 날짜의 용어가 바뀜). 내용이 틀리면 **그 자리에서 고친다**. 꼭 빼야 하면 `retired: true`로 두고 그 날은 다음 용어를 보여 줌(자리 유지) |
| 순환 중 N이 바뀌면 | `k mod N`이 달라져 그날 용어가 바뀔 수 있다 → 순환은 대비책일 뿐, 루틴이 매일 추가해 순환에 들어가지 않게 운영(7장). 순환 중임은 화면에 "다시 보는 용어예요" 한 줄 |
| 열어 둔 채 자정이 지나면 | `visibilitychange`(화면으로 돌아올 때)에 날짜를 다시 구해 다르면 "날짜가 바뀌었어요 [새 용어 보기]" 띠 |

### 3-2. 공부한 날·연속일 (벌주지 않는 쪽)

| 항목 | 규칙 (추천) |
|---|---|
| 공부한 날 | **그날(KST)의 오늘의 용어 퀴즈에 한 번이라도 답한 날.** 틀려도 공부한 날로 친다(잔디 칠함) |
| 카드 획득 | 그 용어의 퀴즈를 **맞힌 때**. 틀리면 해설을 보여 주고 [다시 풀기] → 맞히면 획득. 횟수 제한·감점 없음 |
| 연속일 🔥 | 오늘(또는 오늘 아직 안 했으면 어제)부터 거꾸로 이어진 공부한 날 수 |
| 쉼표(쉬는 날 보호) | **최근 7일 안에 쉼표를 쓰지 않았다면, 하루 빠진 날 1개를 자동으로 메워** 연속일을 잇는다. 이틀 연속 빠지면 0부터. 쉼표 칸은 잔디에 점선으로 표시하고 연속일 숫자에는 **안 더한다**(이어 주기만) |
| 오늘 아직 안 함 | 연속일을 0으로 보이지 않고 "어제까지 12일 — 오늘 풀면 13일"로 표시 |
| 지난 용어 풀기 | 놓친 날의 용어로 카드를 주울 수 있다. **잔디·연속일에는 세지 않는다**(날짜가 지난 일이라). 아직 오지 않은 날의 용어는 볼 수 없다 |
| 위로 숫자 | 연속일이 끊겨도 "최장 연속일"과 "공부한 날 모두 ○일"을 함께 보여 준다 |
| 계산 방식 | 연속일·최장·쉼표는 **저장하지 않고 매번 날짜 기록(days)으로 다시 계산**(값이 꼬이지 않게) |

### 3-3. 배지 (카드 수 기준, 5단계 추천)

| 단계 | 카드 수 | 이름 | 아이콘 |
|---|---|---|---|
| 1 | 1장 | 첫 카드 | 🌱 |
| 2 | 10장 | 경제 새싹 | 🌿 |
| 3 | 30장 | 경제 잎새 | 🍀 |
| 4 | 60장 | 경제 나무 | 🌳 |
| 5 | 100장 | 경제 숲 | 🏞️ |

- 잔디와 이어지는 "자라는 식물" 이름으로 맞췄다. 지시서 예시 "절세 입문"은 카드가 세금 말고도 섞여 있어 30장 이름으로는 맞지 않아 뺐다(원하면 바꾸기 쉬움).
- 100장은 1단계 60개를 넘으므로 루틴이 용어를 채워야 열린다(목표가 끝나지 않게).
- 연속일 배지(7일·30일)는 1단계에 넣지 않는다(끊겼을 때 잃는 느낌을 줄이려고).

---

## 4. 데이터 형식

### 4-1. `apps/daily-econ/terms.json`

```json
{
  "version": 1,
  "startDate": "2026-10-20",
  "terms": [
    {
      "id": "tax-credit",
      "term": "세액공제",
      "category": "세금",
      "level": 1,
      "short": "낸 세금에서 바로 빼 주는 돈",
      "lines": [
        "계산된 세금에서 정해진 금액을 바로 빼 줘요.",
        "소득공제는 세금을 매길 소득을 줄이고, 세액공제는 세금 자체를 줄여요.",
        "연금저축·IRP·월세·의료비 등이 세액공제 대상이에요."
      ],
      "example": "총급여 4,000만 원인 사람이 연금저축에 600만 원을 넣으면 99만 원을 돌려받아요.",
      "quiz": {
        "statement": "세액공제는 세금을 매길 소득을 줄여 주는 제도다.",
        "answer": false,
        "explain": "소득을 줄이는 건 소득공제예요. 세액공제는 계산된 세금에서 바로 빼 줘요."
      },
      "post": "2026-year-end-tax-settlement-guide",
      "postLabel": "연말정산 놓치기 쉬운 공제 읽기",
      "checkYear": 2026,
      "addedAt": "2026-10-14",
      "addedBy": "initial"
    },
    {
      "id": "parking-account",
      "term": "파킹통장",
      "category": "저축",
      "level": 1,
      "short": "하루만 맡겨도 이자를 주는 수시입출금 통장",
      "lines": ["…", "…", "…"],
      "example": "…(본문 숫자만)",
      "quiz": { "statement": "…", "answer": true, "explain": "…" },
      "post": "2026-parking-savings-guide",
      "postLabel": "파킹통장·CMA·예금 고르기",
      "checkYear": 2026,
      "addedAt": "2026-10-14",
      "addedBy": "initial"
    },
    {
      "id": "confirmed-date",
      "term": "확정일자",
      "category": "부동산",
      "level": 1,
      "short": "…",
      "lines": ["…", "…", "…"],
      "example": "…",
      "quiz": { "statement": "…", "answer": true, "explain": "…" },
      "post": "2026-jeonse-fraud-prevention-checklist",
      "postLabel": "전세 계약 전 체크리스트",
      "checkYear": null,
      "addedAt": "2026-10-14",
      "addedBy": "initial"
    }
  ]
}
```
(위 예시는 형식 보여 주기용이다. 세액공제 예시 숫자는 관련 글 `2026-year-end-tax-settlement-guide`의 "연봉별로" 표에서 옮겼다. **실제 문장과 숫자는 Build가 관련 글 본문에서 그대로 옮겨 쓰고, 글에 없는 숫자는 쓰지 않는다.**)

| 필드 | 필수 | 규칙 |
|---|---|---|
| `version` | ○ | 1. 앱은 1이 아니면 "용어를 불러오지 못했어요" |
| `startDate` | ○ | 첫 배포일(KST, `YYYY-MM-DD`). **한 번 정하면 바꾸지 않는다** |
| `id` | ○ | 영문 소문자·숫자·하이픈. **영구 불변**(기록이 id로 저장됨). 중복 금지 |
| `term` | ○ | 용어 이름. 같은 뜻 중복 금지(예: "IRP"와 "개인형 퇴직연금" 둘 다 넣지 않음) |
| `category` | ○ | `세금`·`연금`·`저축`·`투자`·`대출`·`보험`·`부동산`·`생활금융` 중 하나 |
| `level` | ○ | 1 쉬움 / 2 보통 / 3 어려움 |
| `short` | ○ | "= …" 한 줄 정의, 25자 안팎 |
| `lines` | ○ | 정확히 3개, 각 50자 안팎, "~요"로 끝 |
| `example` | ○ | 생활 예시 1줄. 숫자는 관련 글에 있는 숫자만 |
| `quiz.statement` / `answer` / `explain` | ○ | OX 문장, `true`=O / `false`=X, 해설 1~2문장. 1단계 60개는 O·X가 반반쯤 |
| `post` | ○ | `posts/{slug}.md`가 있어야 함. 링크는 `../../posts/{slug}.html` |
| `postLabel` | ○ | 링크 글자(짧게, "읽기"로 끝). 글 제목을 그대로 쓰지 않음 |
| `checkYear` | ○ | 세법·금리·한도 숫자가 들어 있으면 그 기준 연도(예: 2026), 없으면 `null`. 해가 바뀌면 점검 대상 |
| `addedAt` / `addedBy` | ○ | 추가한 날(KST), `initial` 또는 `routine` |
| `retired` | × | `true`면 화면에서 건너뜀(자리 유지) |

- 앱은 **용어 하나하나를 검사**해 형식이 틀린 항목만 건너뛴다(파일 전체가 멈추지 않게). 그 날 용어가 틀린 항목이면 다음 정상 용어를 보여 주고 콘솔에 `console.info` 한 줄.
- 파일 크기: 60개 × 약 0.8KB ≈ 50KB. 1,000개가 넘으면(약 3년 뒤) 나누기 검토(범위 밖).

### 4-2. localStorage 저장 형식

키 하나: **`daily-econ:v1`** (테마는 블로그 공용 키 `theme` 그대로 읽기만)

```json
{
  "version": 1,
  "days": {
    "2026-10-20": { "id": "tax-credit", "correct": true },
    "2026-10-21": { "id": "parking-account", "correct": false }
  },
  "cards": {
    "tax-credit": "2026-10-20",
    "credit-score": "2026-10-25"
  },
  "seenBadges": [1, 2],
  "introSeen": true
}
```

| 필드 | 뜻 |
|---|---|
| `days` | 공부한 날(KST 날짜 → 그날 용어 id, 마지막 답이 맞았는지). 잔디·연속일·쉼표는 여기서 계산 |
| `cards` | 획득한 카드(id → 획득일). 지난 용어로 주운 카드도 여기에만 들어감 |
| `seenBadges` | "새 배지" 띠를 이미 보여 준 단계(띠를 한 번만 보이게) |
| `introSeen` | 사용법 안내를 접어 둘지 |

- 모든 읽기·쓰기는 `try/catch`. 읽은 값이 깨졌거나 `version`이 다르면 **덮어쓰지 않고** 기록 없이 동작 + "기록을 읽지 못했어요" 안내(사용자가 [기록 지우기]로 새로 시작 가능).
- 저장은 답할 때만(1일 1~2회). 날짜 키는 `YYYY-MM-DD` 형식만 받아들인다.
- 쉼표는 저장하지 않는다(3-2 계산 방식).

---

## 5. 첫 60개 용어 (기존 글에서 추출)

- 뽑은 방법: 41편의 제목·태그·본문을 훑고, 각 용어가 관련 글 본문에 실제로 나오는지 `grep`으로 확인했다(60개 모두 확인됨).
- 순서: **1~2주는 쉬움(1단계 난이도) 위주, 하루하루 카테고리를 바꿔** 한 분야만 이어지지 않게. 3주부터 보통을 섞고, 어려움(3)은 6주 뒤에 드문드문.
- 관련 글이 없는 3편(`2026-wedding-fund-roadmap-guide`, `2026-isa-maturity-pension-transfer-guide`, `2026-year-end-tax-saving-checklist`)은 루틴·예비 목록에서 채운다.

| # | 용어 | id | 카테고리 | 난이도 | 관련 글 slug |
|---|---|---|---|---|---|
| 1 | 세액공제 | tax-credit | 세금 | 1 | 2026-year-end-tax-settlement-guide |
| 2 | 파킹통장 | parking-account | 저축 | 1 | 2026-parking-savings-guide |
| 3 | 신용점수 | credit-score | 생활금융 | 1 | 2026-credit-score-guide |
| 4 | ETF | etf | 투자 | 1 | 2026-etf-beginner-guide |
| 5 | 확정일자 | confirmed-date | 부동산 | 1 | 2026-jeonse-fraud-prevention-checklist |
| 6 | 실손보험 | indemnity-insurance | 보험 | 1 | 2026-health-insurance-generation-guide |
| 7 | 변동금리 | variable-rate | 대출 | 1 | 2026-mortgage-fixed-vs-variable-rate-guide |
| 8 | 소득공제 | income-deduction | 세금 | 1 | 2026-year-end-tax-settlement-guide |
| 9 | 이자소득세(15.4%) | interest-income-tax | 세금 | 1 | 2026-parking-savings-guide |
| 10 | 전월실적 | prev-month-spending | 생활금융 | 1 | 2026-credit-card-benefits-guide |
| 11 | 연금저축 | pension-savings | 연금 | 1 | 2026-pension-savings-fund-guide |
| 12 | 전입신고 | move-in-report | 부동산 | 1 | 2026-jeonse-fraud-prevention-checklist |
| 13 | 자기부담금 | deductible | 보험 | 1 | 2026-car-insurance-saving-guide |
| 14 | 대환대출 | loan-refinancing | 대출 | 1 | 2026-loan-refinancing-guide |
| 15 | 예금자보호 | deposit-protection | 저축 | 1 | 2026-parking-savings-guide |
| 16 | 배당률 | dividend-yield | 투자 | 1 | 2026-dividend-stock-guide |
| 17 | IRP(개인형 퇴직연금) | irp | 연금 | 1 | 2026-irp-tax-deduction-guide |
| 18 | 청약통장 | housing-subscription | 부동산 | 1 | 2026-housing-subscription-savings-guide |
| 19 | 원천징수(3.3%) | withholding-tax | 세금 | 1 | 2026-freelancer-side-income-tax-guide |
| 20 | 정기보험 | term-life | 보험 | 1 | 2026-term-life-insurance-guide |
| 21 | 비상금 통장 | emergency-fund | 저축 | 1 | 2026-first-salary-money-management-guide |
| 22 | 기준금리 | base-rate | 대출 | 1 | 2026-mortgage-fixed-vs-variable-rate-guide |
| 23 | 비과세 | tax-free | 세금 | 1 | 2026-youth-leap-account-guide |
| 24 | 금통장(골드뱅킹) | gold-banking | 투자 | 1 | 2026-gold-investment-guide |
| 25 | 월세 세액공제 | rent-tax-credit | 세금 | 1 | 2026-rent-tax-credit-guide |
| 26 | 환전 우대율 | fx-preferential-rate | 생활금융 | 1 | 2026-dollar-investment-guide |
| 27 | 연말정산 | year-end-settlement | 세금 | 1 | 2026-money-tips |
| 28 | 중도상환수수료 | prepayment-fee | 대출 | 2 | 2026-loan-refinancing-guide |
| 29 | 복리 | compound-interest | 저축 | 1 | 2026-parking-savings-guide |
| 30 | 총보수 | total-expense-ratio | 투자 | 2 | 2026-etf-beginner-guide |
| 31 | 근저당 | mortgage-lien | 부동산 | 2 | 2026-jeonse-fraud-prevention-checklist |
| 32 | 종합소득세 | global-income-tax | 세금 | 2 | 2026-freelancer-side-income-tax-guide |
| 33 | 건강보험 피부양자 | health-dependent | 보험 | 2 | 2026-health-insurance-premium-saving-guide |
| 34 | 연회비 | annual-fee | 생활금융 | 1 | 2026-credit-card-benefits-guide |
| 35 | 퇴직연금 DC형 | dc-pension | 연금 | 2 | 2026-dc-retirement-pension-guide |
| 36 | 전세가율 | jeonse-ratio | 부동산 | 2 | 2026-jeonse-fraud-prevention-checklist |
| 37 | 혼합형 금리 | hybrid-rate | 대출 | 2 | 2026-mortgage-fixed-vs-variable-rate-guide |
| 38 | 정부기여금 | government-contribution | 저축 | 2 | 2026-youth-leap-account-guide |
| 39 | 비급여 | non-covered-care | 보험 | 2 | 2026-health-insurance-generation-guide |
| 40 | 카드 소득공제 문턱(총급여 25%) | card-deduction-threshold | 세금 | 2 | 2026-credit-card-benefits-guide |
| 41 | 레버리지 ETF | leveraged-etf | 투자 | 3 | 2026-ai-semiconductor-etf-guide |
| 42 | 계약갱신청구권 | lease-renewal-right | 부동산 | 2 | 2026-lease-report-tenancy-law-guide |
| 43 | 국민연금 조기수령 | early-pension | 연금 | 2 | 2026-national-pension-claim-strategy |
| 44 | 선수금 | down-payment | 대출 | 1 | 2026-used-car-finance-checklist |
| 45 | ISA(개인종합자산관리계좌) | isa | 투자 | 2 | 2026-isa-account-guide |
| 46 | 의료비 세액공제 | medical-expense-credit | 세금 | 2 | 2026-dual-income-couple-tax-saving-guide |
| 47 | 해지환급금 | surrender-value | 보험 | 2 | 2026-term-life-insurance-guide |
| 48 | 채권 가격과 금리 | bond-price-rate | 투자 | 2 | 2026-bond-investment-guide |
| 49 | 증여재산공제 | gift-deduction | 세금 | 2 | 2026-gift-tax-exemption-guide |
| 50 | 전세보증금 반환보증 | deposit-return-guarantee | 부동산 | 2 | 2026-jeonse-fraud-prevention-checklist |
| 51 | 금리인하요구권 | rate-cut-request | 대출 | 2 | 2026-loan-refinancing-guide |
| 52 | 주택연금 | reverse-mortgage | 연금 | 2 | 2026-reverse-mortgage-pension-guide |
| 53 | 디폴트옵션 | default-option | 연금 | 2 | 2026-dc-retirement-pension-guide |
| 54 | 해외주식 양도소득세 | overseas-capital-gains-tax | 세금 | 2 | 2026-overseas-stock-capital-gains-tax-guide |
| 55 | 공모주 균등배정 | ipo-equal-allocation | 투자 | 2 | 2026-ipo-stock-subscription-guide |
| 56 | DSR(총부채원리금상환비율) | dsr | 대출 | 3 | 2026-mortgage-fixed-vs-variable-rate-guide |
| 57 | 리츠(REITs) | reits | 투자 | 2 | 2026-reits-investment-guide |
| 58 | 금융소득종합과세 | financial-income-tax | 세금 | 3 | 2026-dividend-stock-guide |
| 59 | 퇴직소득세 | retirement-income-tax | 세금 | 2 | 2026-retirement-pay-tax-saving-guide |
| 60 | 가상자산 과세 | crypto-tax | 세금 | 2 | 2026-crypto-asset-tax-guide |

카테고리 수: 세금 15 · 투자 9 · 대출 8 · 부동산 7 · 보험 6 · 연금 6 · 저축 5 · 생활금융 4 (블로그 글 분포와 비슷하게 세금이 많다). 난이도: 1 = 31개, 2 = 26개, 3 = 3개.

**예비 용어(루틴이 쓰거나 교체용, 모두 글 본문에 있음 확인):** 연기연금·연금소득세(2026-national-pension-claim-strategy / 2026-pension-savings-fund-guide), 분리과세(2026-isa-account-guide), 손익통산(2026-overseas-stock-capital-gains-tax-guide), 환헤지(H)·TDF(2026-etf-beginner-guide / 2026-dc-retirement-pension-guide), 듀레이션·개인투자용 국채(2026-bond-investment-guide), 배당락(2026-dividend-stock-guide), CMA(2026-parking-savings-guide), 공시가격(2026-reverse-mortgage-pension-guide), 전월세 신고제(2026-lease-report-tenancy-law-guide), 깡통전세(2026-jeonse-fraud-prevention-checklist), 원리금균등상환(2026-mortgage-fixed-vs-variable-rate-guide), 갱신형·비갱신형(2026-term-life-insurance-guide), 매매기준율(2026-dollar-investment-guide), KRX 금시장(2026-gold-investment-guide), 임의계속가입(2026-health-insurance-premium-saving-guide), 부양가족 공제(2026-dual-income-couple-tax-saving-guide).

- 수치가 들어가 `checkYear: 2026`이 될 것으로 보이는 용어: 1, 9, 11, 17, 19, 23, 25, 32, 38, 40, 46, 49, 54, 58, 59, 60 등(세율·한도·공제율). Build가 문장을 쓴 뒤 숫자가 있으면 모두 표시한다.
- 가상자산 과세(60)는 "2027년 시행 예정" 내용이라 **글에 쓴 표현 그대로**(예정·단정 금지) 쓴다.

---

## 6. 파일 구조

| 파일 | 구분 | 내용 |
|---|---|---|
| `apps/daily-econ/index.html` | 추가 | 공통 머리(블로그로·테마), 사용법 안내, 오늘 카드·퀴즈·내 기록·지난 용어 자리, 면책. `../../css/style.css` + `style.css`. 메타·canonical·WebApplication JSON-LD(선례와 같은 틀). `<noscript>` 안내 |
| `apps/daily-econ/style.css` | 추가 | 접두사 `de-`. 블로그 변수만 |
| `apps/daily-econ/app.js` | 추가 | KST 날짜, 순번 계산, 용어 검증, 기록 읽기/쓰기(try/catch), 연속일·쉼표·배지 계산(순수 함수, 끝에 `if (typeof module!=='undefined') module.exports=…`), 잔디 그리기(div 격자 또는 인라인 SVG, 라이브러리 없음) |
| `apps/daily-econ/terms.json` | 추가 | 4-1 형식, 60개 |
| `apps/daily-econ/icon.svg` | 추가(Embed) | 64×64. 아이디어: 둥근 사각형 타일에 초록→파랑 그라데이션, 가운데 **말풍선 속 "₩" 또는 펼친 카드 한 장 + 작은 새싹**, 왼쪽 위 반짝임, 아래 그림자(기존 앱 아이콘 스타일) |
| `apps/daily-econ/tools/check-terms.js` | 추가 | terms.json 형식 검사(7-3). Node 내장 모듈만 |
| `apps/daily-econ/tools/test.js` | 추가 | 순수 함수 단위 테스트(날짜 경계·연속일·쉼표·순환·검증) |
| `apps/daily-econ/spec.md` | 추가 | 이 문서 |
| `apps.json` | 수정(Embed, 정해진 방식) | 1항목 추가 |
| `build.js` | **수정(예외 승인 필요, 선택)** | check-terms 연결 몇 줄(7-3) |
| 건드리지 않음 | — | `css/style.css`, `js/*`, 다른 앱, `posts/*`(Embed의 글 끝 링크 제외), `package.json` |

- 공유(결정 4)를 넣으면 `navigator.share` → 안 되면 클립보드 복사 → 그것도 안 되면 문구를 선택 가능한 글자로 보여 줌. 이미지 생성은 하지 않는다.
- `build.js`는 앱 폴더를 통째로 복사하므로 `tools/`·`spec.md`도 공개된다(비밀 없음, 기존 앱과 같음).

---

## 7. 콘텐츠 운영

### 7-1. 매일 글 루틴이 용어 1개 추가 (추천)
루틴이 새 글을 쓴 뒤 그 글에서 용어 1개를 골라 `terms.json` **배열 끝**에 붙인다. 하루 1개씩 늘어 대기열이 줄지 않는다(오늘 추가한 용어는 약 60일 뒤에 "오늘의 용어"로 나옴). 루틴이 `apps/daily-econ/terms.json`을 고치는 것은 새로 허용하는 범위다(승인 요청 6).

**루틴 프롬프트에 붙여 넣을 문구 초안:**

```
[하루 1분 경제 용어 추가]
글을 다 쓰고 npm run build가 통과한 뒤 아래를 한다.
1. 오늘 쓴 글에서 독자가 꼭 알아야 할 경제 용어 1개를 고른다.
   apps/daily-econ/terms.json에 같은 term이나 같은 뜻의 용어가 이미 있으면 다른 용어를 고르고, 마땅한 것이 없으면 이 단계를 건너뛴다.
2. terms 배열 맨 끝에 1개만 추가한다. 기존 항목의 순서·id·startDate는 절대 바꾸거나 지우지 않는다.
3. 필드: id(영문 소문자-하이픈, 새로 만들기), term, category(세금·연금·저축·투자·대출·보험·부동산·생활금융 중 하나), level(1~3),
   short(한 줄 정의), lines(쉬운 말 3줄, "~요"로 끝), example(생활 예시 1줄),
   quiz{statement, answer(true=O, false=X), explain}, post(오늘 글 slug), postLabel(짧은 링크 글자, "읽기"로 끝),
   checkYear(세율·한도·금리 숫자가 있으면 올해 연도, 없으면 null), addedAt(TZ=Asia/Seoul date +%F), addedBy:"routine".
4. 숫자는 오늘 글 본문에 있는 숫자만 같은 표기로 쓴다. 종목·상품 이름, "사세요", "추천", "무조건" 같은 말은 쓰지 않는다.
5. node apps/daily-econ/tools/check-terms.js 를 실행해 오류 0건인지 확인한다. 오류가 나면 추가한 항목을 고치고, 고칠 수 없으면 추가한 항목을 빼고 terms.json을 원래대로 둔다.
6. terms.json 변경은 글과 같은 커밋에 넣는다. 그 밖의 apps/ 파일은 건드리지 않는다.
```

### 7-2. 해마다 수치 점검
- `check-terms.js`는 `checkYear`가 **올해(KST)보다 작은** 용어를 **경고(빌드 실패 아님)**로 목록 출력한다.
- 1월(세법 개정 반영 뒤) 사람이 목록을 보고: 관련 글이 고쳐졌으면 그 숫자로 `lines`·`example`·`quiz`를 고치고 `checkYear`를 새해로 바꾼다. 글이 아직 안 고쳐졌으면 용어도 그대로 두고 글 수정과 함께 고친다(글과 앱 숫자가 늘 같게).
- 화면에는 `checkYear`가 있으면 카드 아래 작게 "2026년 기준"을 표시한다.

### 7-3. terms.json 형식 검사 — 추천: `build.js`에 연결(작은 예외)

| 안 | 내용 | 장단점 |
|---|---|---|
| **A안 (추천)** | `build.js`에 "`apps/daily-econ/tools/check-terms.js`가 있으면 실행하고 오류면 `[빌드 중단] 경제 용어 terms.json …`으로 멈춤" 약 5줄 | 루틴이 실수해도 배포 전에 막힘. **블로그 공용 파일 `build.js`를 건드리는 CLAUDE.md 예외** |
| B안 | build.js는 그대로. 루틴 프롬프트(7-1의 5번)와 Review에서만 실행 | 예외 없음. 루틴이 검사를 빠뜨리면 깨진 파일이 배포될 수 있음(그래도 앱은 항목별로 건너뛰어 멈추지 않음) |

검사 항목(오류 = 빌드 중단): JSON 문법, `version`, `startDate` 형식, 필수 필드 누락·자료형, `lines` 3개, `category` 목록 밖, `level` 1~3, **중복 `id`·중복 `term`**, `posts/{post}.md` 없음, 금지어(`사세요`·`파세요`·`매수`·`매도`·`추천`·`무조건`·`확실`·`100%`·`대박`·`급등`·`폭락`), `answer`가 true/false 아님.
경고(통과): `checkYear` 지남, `lines` 한 줄 80자 초과, O/X 비율이 7:3보다 치우침, 남은 대기열(오늘 이후 용어)이 14개 미만.
+ (가능하면) 이전 커밋의 terms.json과 비교해 **기존 항목 순서·id가 바뀌었거나 지워졌으면 오류** — git이 없으면 건너뜀(미확인: Actions 체크아웃 깊이에 따라 이전 커밋이 없을 수 있음. Build에서 확인).

---

## 8. 실패 시나리오

| 시나리오 | 화면 | 처리 |
|---|---|---|
| localStorage 막힘(시크릿 창·쿠키 차단·용량 초과) | 오늘 용어·퀴즈 정상. 기록 칸 "이 브라우저에서는 기록을 저장할 수 없어요" | 모든 접근 try/catch, 메모리에만 그날 결과 유지. 테마 읽기도 감쌈 |
| 저장된 기록이 깨짐·`version` 다름 | "기록을 읽지 못했어요" + [기록 지우고 새로 시작] | 자동으로 덮어쓰지 않음 |
| terms.json 못 읽음(네트워크·404·`file://`) | "용어를 불러오지 못했어요. 잠시 후 다시 열어 주세요" + 사용법 + 블로그 링크. 내 기록은 그대로 보임 | `fetch` 실패 처리, 콘솔 `console.info` 한 줄 |
| terms.json 깨짐·`version`≠1 | 위와 같음 | |
| 항목 일부 형식 틀림 | 그 항목만 건너뜀(그날이면 다음 정상 용어) | 4-1 |
| 관련 글 slug가 없어짐 | 링크 404 | check-terms가 빌드에서 잡음(A안). 앱은 링크만 숨기지 못함(파일 유무를 모름) |
| 기기 시간대가 한국이 아님(해외·UTC) | 한국 날짜 기준으로 같은 용어 | `Intl` Asia/Seoul. 오래된 브라우저는 +9시간 계산 |
| 오전 0~9시 KST(UTC로는 전날) | 이미 새 날 용어 | UTC 날짜를 쓰지 않음 — 테스트 필수 |
| 페이지를 열어 둔 채 자정 넘김 | "날짜가 바뀌었어요 [새 용어 보기]" | `visibilitychange` 때 재계산 |
| 기기 시계가 틀림(미래·과거) | 그 날짜의 용어를 봄. 시작일 이전이면 첫 용어 | 막지 않음(서버가 없으므로). 기록 날짜도 기기 기준 — 무해 |
| 캐시된 옛 terms.json | 하루 늦은 용어를 볼 수 있음 | `fetch(..., {cache:'no-cache'})` |
| 용어가 바닥남(루틴 중단) | 처음부터 순환 + "다시 보는 용어예요" | 3-1. check-terms가 대기열 14개 미만이면 경고 |
| 순환 중 용어 추가 | 그날 용어가 바뀔 수 있음 | 운영으로 방지(7-1), 기록은 id로 저장되어 꼬이지 않음 |
| 같은 날 다른 기기 | 기록이 기기마다 따로 | 사용법 ③에 안내. 동기화는 범위 밖 |
| JS 꺼짐 | `<noscript>` "자바스크립트를 켜야 볼 수 있어요" | |
| 방문 기록 삭제·기기 변경 | 기록 0부터 | 사용법 ③ 안내(미리 알림) |

---

## 9. 범위 밖

| 단계 | 내용 |
|---|---|
| 2차 | **용어 사전 페이지**(용어별 검색용 페이지 — 1단계에서는 얕은 페이지 대량 생성 위험 때문에 만들지 않음. 만들면 용어마다 충분한 본문·글 링크를 갖춘 소수 페이지로 별도 계획), 공유 카드 이미지, 메인 "오늘의 용어" 띠(결정 5 B안), 4지선다 퀴즈, 기록 내보내기/가져오기(JSON 복사로 기기 옮기기) |
| 3차 | 기기 간 동기화(로그인 필요), 알림(푸시·이메일), 연속일 배지, 순위표 |
| 하지 않음 | 서버·외부 API·로그인·쿠키 동의가 필요한 기능, 종목·상품 추천, 투자 권유 문구, 글에 없는 수치 |

---

## 10. 승인 후 Build / Review 체크리스트

### Build 지침에 넣을 것
1. 수정 범위: `apps/daily-econ/**`(spec.md는 부록 추가만). `apps.json`·아이콘·글 끝 링크·(승인 시) `build.js`는 Embed 단계.
2. 60개 용어의 `lines`·`example`·`quiz`는 **관련 글 본문을 읽고** 쓴다. 숫자는 글에 있는 것만, 같은 표기로. 글과 다르게 읽히면 쓰지 말고 부록에 "미확인" 표시.
3. `startDate`는 Embed(배포) 예정일로 두고, Embed 때 실제 배포일과 다르면 그때 한 번만 맞춘다(배포 뒤에는 고정).
4. 다른 앱의 JS·CSS를 불러오지 않는다. 외부 라이브러리 없음.

### Review 체크리스트
| # | 확인 항목 |
|---|---|
| 1 | `node apps/daily-econ/tools/test.js`, `check-terms.js` 오류 0건 |
| 2 | **날짜 경계**: 기기 시간대 UTC·America/New_York·Asia/Seoul에서 같은 순간에 같은 용어. KST 23:59→00:00에 바뀌고, UTC 00:00(KST 09:00)에는 안 바뀜. 방법: Playwright `timezoneId` + `page.clock`(또는 `Date` 고정) |
| 3 | 순번: 시작일 당일 = 1번, 시작일 이전 = 1번, 61일째 = 1번(순환, 용어 60개일 때), `retired` 건너뜀 |
| 4 | 연속일: 매일 / 하루 빠짐(쉼표 사용) / 7일 안에 두 번 빠짐(끊김) / 이틀 연속 빠짐(끊김) / 오늘 아직 안 함("어제까지") / 지난 용어 풀기는 잔디·연속일 변화 없음 |
| 5 | 퀴즈: 틀림 → 해설·다시 풀기 → 맞힘 → 카드 획득. 같은 날 다시 열면 결과 유지. 미래 용어는 지난 용어 목록에 안 보임 |
| 6 | localStorage 막힘(`Storage.prototype.setItem/getItem`이 던지게) → 오늘 용어 보임, 콘솔 에러 0. 깨진 기록·`version:2` 기록 → 덮어쓰지 않음 |
| 7 | terms.json 없음·깨짐·`version:2`·항목 하나 필드 누락 → 각각 정해진 화면, 앱 멈춤 없음 |
| 8 | 375px·320px 가로 스크롤 0, 잔디 12주가 한 화면에 들어감, 버튼 44px 이상, 글씨 16px 이상 |
| 9 | 라이트·다크(시스템 설정·테마 단추 둘 다), 블로그 변수만, 새 hex 0(허용된 앱 변수 제외) |
| 10 | 접근성: O/X 버튼 `aria-pressed`/결과 `aria-live="polite"`, 잔디 칸 `aria-label`·범례 글자, 키보드로 퀴즈 풀기, `prefers-reduced-motion` |
| 11 | 사용법 안내(①~④), "기록은 이 브라우저에만" 안내, 면책 문구, `checkYear` 기준 연도 표시 |
| 12 | 문구 grep: 7-3 금지어 0건(면책 "투자 권유가 아니에요" 1줄 예외), 60개 숫자를 관련 글과 대조(표본 20개 이상 + 숫자가 있는 용어 전부) |
| 13 | 관련 글 링크 60개 모두 `dist/posts/{slug}.html` 존재(`npm run build` 후) |
| 14 | `git diff --stat`: `apps/daily-econ/**` 밖 변경 0(Build·Review 단계) |

---

## 승인 요청 사항 (요약, 추천안)
1. **이름**: 제목 "하루 1분 경제 용어", 아이콘 아래 짧은 이름 **"경제 용어"**(4글자, 기존 "오늘 경제"와 같은 길이). `apps.json`에는 **"오늘 경제" 바로 다음(2번째)**에 넣는다(매일 들르는 앱끼리 나란히).
2. **퀴즈는 OX만**(1단계). 4지선다는 2차.
3. **잔디 최근 12주**(375px에 7행×12열이 들어감), **배지 5단계**(1·10·30·60·100장: 첫 카드·경제 새싹·경제 잎새·경제 나무·경제 숲). 연속일은 **주 1회 자동 쉼표**로 하루 빠짐을 보호.
4. **공유: 텍스트 공유만 1단계에 포함**(휴대폰 공유창 → 안 되면 복사. "오늘의 경제 용어: 세액공제 = 낸 세금에서 바로 빼 주는 돈 + 앱 주소"). 카드 이미지 공유는 2차. 빼도 된다면 더 단순해진다.
5. **메인 화면은 앱 아이콘만**(A안). 메인 "오늘의 용어" 한 줄 띠(B안)는 `build.js`·`css/style.css`를 고치는 CLAUDE.md 예외이고, 첫 화면에 글이 먼저 보이게 한 이전 결정(a5c02aa)과 충돌하므로 2차에서 따로 검토.
6. **용어 채우기**: 매일 글 루틴이 그날 글에서 용어 1개를 `terms.json` 끝에 추가(7-1 문구를 루틴 프롬프트에 붙여 넣기 — 루틴이 앱 파일 1개를 고치는 새 허용). **형식 검사는 `build.js`에 5줄 연결(A안, 작은 예외)**, 거절하면 루틴과 Review에서만 실행(B안).
7. **글 끝 링크**: 이 앱은 특정 글 하나의 계산기가 아니므로 1단계에서는 글 끝 링크를 달지 않는다(원하면 `2026-money-tips` 1편에만).

---

## 부록 A. Build 구현 메모 (2026-10-14, Build 서브에이전트)

### 만든 파일
- `index.html`, `style.css`(접두사 `de-`, 앱 변수는 `--de-color-ok`·`--de-color-error` 2개만, 테두리·아이콘에만 사용), `app.js`(순수 함수 + 화면 코드, `module.exports`), `terms.json`(60개, `startDate: 2026-10-15`), `tools/check-terms.js`, `tools/test.js`(34건).

### 미확인 → 확인
- 7-3 "이전 커밋 비교": `deploy.yml`의 checkout이 `fetch-depth: 0`이라 Actions에서도 이전 커밋을 읽을 수 있음. check-terms는 작업 파일이 HEAD와 같으면 HEAD~1과 비교하고, git이 없거나 이전 파일이 없으면 경고만 내고 건너뜀.
- 날짜 경계: Playwright `timezoneId`(UTC·America/New_York·Asia/Seoul) + `page.clock`으로 같은 순간 같은 용어, KST 00:00에 바뀌고 UTC 00:00에는 안 바뀌는 것 확인. 375·320px 가로 스크롤 0, 글씨 16px 미만 0, 44px 미만 터치 영역 0.

### spec과 달라진 점
- 테마 단추: `js/theme.js`가 localStorage를 try/catch 없이 읽어 저장소가 막힌 브라우저에서 멈출 수 있어, `../../js/theme.js`를 불러오지 않고 같은 동작을 `app.js` 안에 try/catch로 다시 구현했다(2-2 요구사항).
- `checkYear`: "숫자가 들어간 용어는 2026"으로 일괄 적용(60개 중 56개). 숫자 없는 4개(확정일자·기준금리·비급여 정의 등)는 `null`. check-terms는 숫자가 있는데 `null`이면 경고.
- 연속일 "쉼표": 어제 빠지고 오늘 아직 안 풀었으면 쉼표를 "잠정 사용"으로 보고 "오늘 풀면 쉼표 1개로 연속일을 이어요" 안내. 오늘도 안 풀면 다음 날 계산에서 자동으로 끊김(저장 없이 days로만 계산).
- `introSeen`은 "저장은 답할 때만" 규칙에 맞춰 첫 답을 저장할 때 함께 true가 된다(답하기 전 다시 열면 사용법이 펼쳐진 채로 보임).
- 용어 문구 메모: 전세가율(#36)은 글에 정의 문장이 없어 "집값 대비 보증금 비율"이라는 일반 정의 + 글의 70~80% 기준·경매 예시를 썼다. 기준금리(#22)는 글 내용이 "코픽스가 기준금리 흐름의 영향을 받는다" 정도뿐이라 숫자 없이 썼다. 글에 없는 숫자는 쓰지 않았다.

# 라이딩노트 🏍️

출발지와 조건만 입력하면 AI가 **이륜차로 달릴 수 있는 투어링 코스**를 추천해 주는 웹 서비스입니다.

- **배포 URL:** https://(배포 후 여기에 Vercel 주소 입력).vercel.app
- **타겟:** 아는 코스가 적은 1~3년 차 라이더, 새로운 지역을 달려보고 싶은 투어 라이더

## 주요 기능

| 섹션 | 내용 |
| --- | --- |
| 홈 | 서비스 소개, 코스 추천 바로가기 |
| 코스 추천 (AI) | 출발 지역·시간·스타일·배기량을 입력하면 코스 2~3개 추천, 경유지는 네이버지도 검색 링크 제공 |
| 투어 준비 | 장비·바이크 점검·출발 전 확인 체크리스트(진행률 표시) |
| FAQ | 자주 묻는 질문 |

### AI 기능 실패 처리

| 상황 | 안내 메시지 |
| --- | --- |
| 출발 지역 빈칸 | 출발 지역을 입력해 주세요. |
| 추가 요청 200자 초과 | 추가 요청은 200자까지 입력할 수 있어요. |
| API 오류 (4xx/5xx) | 서버가 보낸 안내 메시지 또는 "잠시 후 다시 시도해 주세요." |
| 8초 이상 지연 | 코스를 고르는 중이에요. 조금만 기다려 주세요. |
| 30초 초과 | 응답이 너무 늦어요. 조건을 줄여서 다시 시도해 주세요. |

## 기술 스택

- **프론트엔드:** HTML, CSS(미디어 쿼리 반응형), JavaScript(fetch, AbortController) — 프레임워크 없음
- **백엔드:** Vercel Serverless Functions (Python, `BaseHTTPRequestHandler`)
- **AI:** Google Gemini API (OpenAI 호환 엔드포인트 + `openai` 파이썬 패키지), 기본 모델 `gemini-3.8-flash`
- **배포:** GitHub + Vercel 자동 배포

## 폴더 구조

```
ridingnote/
├── index.html          # 화면 구조 (4개 섹션)
├── css/style.css       # 스타일, 반응형
├── js/app.js           # 메뉴, fetch 호출, 결과 렌더링, 실패 처리
├── api/recommend.py    # POST /api/recommend → Gemini 호출
├── images/
├── requirements.txt    # Python 패키지 (openai)
├── vercel.json         # 함수 최대 실행 시간 설정
├── .env.example        # 환경 변수 예시 (실제 키 없음)
└── .gitignore          # .env 커밋 방지
```

## 동작 흐름

1. 사용자가 폼을 제출하면 `js/app.js`가 입력을 검사합니다.
2. `fetch('/api/recommend', { method: 'POST' })`로 조건을 JSON으로 보냅니다.
3. `api/recommend.py`가 입력을 다시 검증하고, 환경 변수의 API 키로 Gemini를 호출합니다.
4. Gemini가 돌려준 JSON을 정리해 응답하면, 프론트가 코스 카드로 그립니다.

API 키는 서버 함수 안에서만 쓰이므로 브라우저(개발자 도구 네트워크 탭)에 노출되지 않습니다.

## 환경 변수 설정

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 필수 | Google AI Studio에서 발급한 Gemini API 키 |
| `GEMINI_MODEL` | 선택 | 사용할 모델 이름 (기본값 `gemini-3.8-flash`) |

**Vercel:** 프로젝트 → Settings → Environment Variables에서 위 값을 추가한 뒤 **재배포**해야 적용됩니다.

**로컬:** `.env.example`을 복사해 `.env`를 만들고 키를 넣습니다. `.env`는 `.gitignore`에 들어 있어 GitHub에 올라가지 않습니다.

> ⚠️ 키를 코드, README, 스크린샷에 절대 넣지 마세요. 실수로 커밋했다면 Google AI Studio에서 키를 즉시 폐기하고 새로 발급하세요.

### API 선택 과정 (트러블슈팅 기록)

처음에는 교육 과정에서 받은 코디세이 키로 OpenAI를 호출했지만 `401 Unauthorized`가 발생했습니다.
Vercel Logs를 확인해 보니 요청이 `api.openai.com`으로 가고 있었고, 코디세이 키는 전용 서버(`copa.codyssey.kr`)에서만 쓸 수 있는 키였습니다.
이후 Gemini API로 전환했고, Gemini가 OpenAI 호환 주소를 제공하기 때문에 `openai` 패키지는 그대로 두고 `base_url`과 모델만 바꿨습니다.

## 로컬 실행

```bash
npm i -g vercel        # Vercel CLI 설치 (최초 1회)
cp .env.example .env   # 키 입력
vercel dev             # http://localhost:3000
```

`index.html`을 더블클릭해서 열면 `/api/recommend`가 없어서 AI 기능이 동작하지 않습니다. 반드시 `vercel dev`로 실행하세요.

## 배포

1. GitHub에 저장소를 만들고 코드를 push합니다.
2. [vercel.com](https://vercel.com) → Add New → Project → GitHub 저장소 Import
3. Framework Preset은 **Other**, 나머지는 기본값 그대로 둡니다.
4. Environment Variables에 `GEMINI_API_KEY`를 추가하고 Deploy
5. 이후에는 `git push`만 하면 자동으로 재배포됩니다.

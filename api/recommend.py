"""
라이딩노트 - 투어링 코스 추천 API (Vercel Serverless Function, Python)

POST /api/recommend
요청 본문(JSON):
    {
        "origin": "서울 강동구",        # 필수, 2~30자
        "duration": "day",              # half | day | overnight
        "style": "winding",             # winding | coast | mountain | cafe
        "displacement": "mid",          # small | mid | large
        "note": "카페 들르고 싶어요"      # 선택, 200자 이내
    }
응답(JSON):
    성공: {"courses": [ {...}, ... ]}
    실패: {"error": "사용자에게 보여줄 메시지"}  + 4xx/5xx 상태 코드
"""

import json
import os
from http.server import BaseHTTPRequestHandler

from openai import OpenAI, APIError, APITimeoutError, RateLimitError, AuthenticationError

MAX_NOTE_LENGTH = 200
MAX_BODY_BYTES = 5_000

DURATIONS = {"half": "반나절(3~4시간)", "day": "하루(6~8시간)", "overnight": "1박 2일"}
STYLES = {"winding": "와인딩(굽이진 국도)", "coast": "해안도로", "mountain": "산길·고개", "cafe": "카페 투어"}
DISPLACEMENTS = {"small": "125cc 이하", "mid": "중배기량(126~600cc)", "large": "대배기량(600cc 초과)"}

SYSTEM_PROMPT = """너는 한국의 모터사이클 투어링 코스를 추천하는 가이드다.
반드시 지킬 규칙:
1. 한국에서 이륜차는 고속도로와 자동차전용도로를 달릴 수 없다. 이 도로들은 경로에 절대 넣지 말고 국도·지방도만 사용한다.
2. 125cc 이하라면 이동 거리를 짧게 잡고, 장거리 고개나 험한 산악 코스는 피한다.
3. 확실하지 않은 식당·카페 상호는 지어내지 말고 "OO읍 일대 식당가"처럼 지역 수준으로 쓴다.
4. 라이딩 시간에 맞는 현실적인 거리와 소요 시간을 제시한다.
5. 안전 주의사항(급커브, 노면, 낙석, 단속 구간, 기상 등)을 코스마다 넣는다.

아래 JSON 형식으로만 답한다. 다른 설명은 쓰지 않는다.
{
  "courses": [
    {
      "name": "코스 이름",
      "summary": "한 줄 소개",
      "waypoints": ["출발지", "경유지1", "경유지2", "도착지"],
      "duration": "예상 소요 시간 (예: 약 5시간)",
      "distance": "대략적인 거리 (예: 약 180km)",
      "stops": ["휴식·식사 포인트"],
      "cautions": ["주의사항"]
    }
  ]
}
courses는 2개 또는 3개로 만든다."""


def build_user_prompt(data):
    lines = [
        f"출발 지역: {data['origin']}",
        f"라이딩 시간: {DURATIONS[data['duration']]}",
        f"선호 스타일: {STYLES[data['style']]}",
        f"배기량: {DISPLACEMENTS[data['displacement']]}",
    ]
    if data["note"]:
        lines.append(f"추가 요청: {data['note']}")
    return "\n".join(lines)


def validate(body):
    """입력을 검증하고 (정리된 데이터, 오류 메시지) 를 돌려준다."""
    if not isinstance(body, dict):
        return None, "요청 형식이 올바르지 않아요."

    origin = str(body.get("origin", "")).strip()
    note = str(body.get("note", "")).strip()
    duration = body.get("duration", "day")
    style = body.get("style", "winding")
    displacement = body.get("displacement", "mid")

    if not origin:
        return None, "출발 지역을 입력해 주세요."
    if len(origin) > 30:
        return None, "출발 지역은 30자 이내로 입력해 주세요."
    if len(note) > MAX_NOTE_LENGTH:
        return None, f"추가 요청은 {MAX_NOTE_LENGTH}자까지 입력할 수 있어요."
    if duration not in DURATIONS or style not in STYLES or displacement not in DISPLACEMENTS:
        return None, "선택 항목 값이 올바르지 않아요."

    return {
        "origin": origin,
        "note": note,
        "duration": duration,
        "style": style,
        "displacement": displacement,
    }, None


def normalize_courses(raw):
    """AI 응답이 형식을 조금 벗어나도 화면이 깨지지 않도록 정리한다."""
    courses = raw.get("courses") if isinstance(raw, dict) else None
    if not isinstance(courses, list) or not courses:
        return None

    def as_list(value):
        if isinstance(value, list):
            return [str(v) for v in value if str(v).strip()]
        return [str(value)] if value else []

    result = []
    for c in courses[:3]:
        if not isinstance(c, dict):
            continue
        result.append({
            "name": str(c.get("name", "이름 없는 코스")),
            "summary": str(c.get("summary", "")),
            "waypoints": as_list(c.get("waypoints")),
            "duration": str(c.get("duration", "")),
            "distance": str(c.get("distance", "")),
            "stops": as_list(c.get("stops")),
            "cautions": as_list(c.get("cautions")),
        })
    return result or None


def ask_openai(data):
    model = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
    # 붙여 넣을 때 섞인 공백/줄바꿈을 제거한다
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    client = OpenAI(api_key=api_key, timeout=25.0, max_retries=0)

    options = {}
    # gpt-5 계열은 추론 강도를 낮춰 응답 속도를 높인다 (다른 모델에서는 이 옵션을 보내지 않음)
    if model.startswith("gpt-5"):
        options["reasoning_effort"] = "low"

    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(data)},
        ],
        response_format={"type": "json_object"},
        **options,
    )
    content = completion.choices[0].message.content or ""
    return json.loads(content)


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(405, {"error": "POST 요청만 받을 수 있어요."})

    def do_POST(self):
        # 1) 요청 본문 읽기
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_BODY_BYTES:
                return self._send(413, {"error": "입력 내용이 너무 길어요."})
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "요청 형식이 올바르지 않아요."})

        # 2) 입력 검증 (프론트에서 막아도 서버에서 한 번 더 확인)
        data, error = validate(body)
        if error:
            return self._send(400, {"error": error})

        # 3) API 키 확인 (키는 환경 변수에서만 읽는다)
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            print("[recommend] OPENAI_API_KEY 환경 변수가 비어 있거나 없음")
            return self._send(500, {"error": "서버 설정에 문제가 있어요. 관리자에게 알려 주세요.", "code": "missing_key"})
        # 키 앞부분만 로그에 남겨 어떤 키가 들어갔는지 확인 (전체 키는 절대 출력하지 않음)
        print(f"[recommend] 키 확인: {api_key[:7]}... (길이 {len(api_key)})")

        # 4) OpenAI 호출
        try:
            raw = ask_openai(data)
        except APITimeoutError:
            return self._send(504, {"error": "AI 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요."})
        except RateLimitError as e:
            print(f"[recommend] OpenAI 429: {e.message}")
            return self._send(429, {"error": "요청이 많아 잠시 쉬는 중이에요. 1분 뒤에 다시 시도해 주세요."})
        except AuthenticationError as e:
            print(f"[recommend] OpenAI 인증 실패(401): {e.message}")
            return self._send(500, {"error": "서버 설정에 문제가 있어요. 관리자에게 알려 주세요.", "code": "invalid_key"})
        except (APIError, json.JSONDecodeError) as e:
            print(f"[recommend] OpenAI error: {e!r}")
            return self._send(502, {"error": "추천 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요."})

        courses = normalize_courses(raw)
        if not courses:
            return self._send(502, {"error": "추천 결과를 만들지 못했어요. 다시 시도해 주세요."})

        return self._send(200, {"courses": courses})
"""CSV의 국회 요구 문항을 읽어 1순위 소관 과를 결과 CSV로 저장한다.

사용 예:
    from 소관과_추천 import classify_csv
    classify_csv()

명령행 예:
    python 소관과_추천.py
"""

from __future__ import annotations

import csv
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
RULES_FILE = BASE_DIR / "data" / "배분기준표_소관키워드_304건.csv"
TEST_FILE = BASE_DIR / "data" / "시험_요구문항_40건.csv"
OUTPUT_FILE = BASE_DIR / "data" / "시험_요구문항_40건_분류결과.csv"

def _normalize(text: str) -> str:
    """대소문자·공백·문장부호 차이를 없애 비교하기 쉽게 만든다."""
    return re.sub(r"[^0-9a-z가-힣]", "", text.casefold())


# 요구 문항의 제출 형식을 설명할 뿐, 실제 업무 소관을 뜻하지 않는 표현이다.
# 예: "디도스 관련 언론 보도"는 홍보담당관이 아니라 정보보호과가 소관이다.
CONTEXT_KEYWORDS = {_normalize("언론"), _normalize("언론보도")}


@lru_cache(maxsize=1)
def _load_rules() -> tuple[dict[str, str], ...]:
    with RULES_FILE.open(encoding="utf-8-sig", newline="") as file:
        return tuple(csv.DictReader(file))


def rank_departments(question: str) -> list[tuple[str, int]]:
    """문항과 일치하는 과를 ``(과 이름, 점수)`` 순서로 반환한다."""
    normalized_question = _normalize(question)
    if not normalized_question:
        return []

    scores: defaultdict[str, int] = defaultdict(int)

    for rule in _load_rules():
        keyword = _normalize(rule["키워드"])
        if not keyword or keyword not in normalized_question:
            continue

        exclusions = (
            _normalize(word)
            for word in rule.get("제외어", "").split("|")
            if word.strip()
        )
        if any(word in normalized_question for word in exclusions):
            continue

        department = rule["과"].strip()
        priority = int(rule.get("우선순위") or 2)

        # '공통(전 과 취합)' 규칙은 명시적인 배분 기준이므로 최우선이다.
        if rule["유형"].startswith("공통"):
            weight = 1_000
        # 1순위 키워드는 소관을 직접 특정하고, 2순위는 보조 단서로 사용한다.
        elif keyword in CONTEXT_KEYWORDS:
            weight = 20
        elif priority == 1:
            weight = 100
        else:
            weight = 20

        # 긴 문구일수록 구체적이고, 같은 과에서 여러 단서가 잡히면 점수가 합산된다.
        scores[department] += weight + len(keyword)

    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


def find_department(question: str) -> str:
    """요구 문항의 1순위 소관 과를 반환한다. 근거가 없으면 '분류 불가'를 반환한다."""
    ranking = rank_departments(question)
    return ranking[0][0] if ranking else "분류 불가"


def classify_csv(
    input_file: Path | str = TEST_FILE,
    output_file: Path | str = OUTPUT_FILE,
) -> tuple[int, int]:
    """입력 CSV 전체를 분류해 결과 CSV를 쓰고 ``(정답 수, 전체 수)``를 반환한다."""
    input_path = Path(input_file)
    output_path = Path(output_file)

    with input_path.open(encoding="utf-8-sig", newline="") as file:
        cases = list(csv.DictReader(file))

    correct = 0
    results: list[dict[str, str]] = []
    for case in cases:
        predicted = find_department(case["요구내용"])
        is_correct = predicted == case["정답_배분과"]
        correct += int(is_correct)
        results.append(
            {
                "시험번호": case["시험번호"],
                "요구내용": case["요구내용"],
                "추천_1순위": predicted,
                "정답_배분과": case["정답_배분과"],
                "정답여부": "정답" if is_correct else "오답",
                "배분구분": case["배분구분"],
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as file:
        fieldnames = [
            "시험번호",
            "요구내용",
            "추천_1순위",
            "정답_배분과",
            "정답여부",
            "배분구분",
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f"결과 CSV: {output_path}")
    print(f"1순위 정답: {correct}/{len(cases)}")
    return correct, len(cases)


if __name__ == "__main__":
    classify_csv()

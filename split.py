from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "원문"
OUTPUT_PATH = ROOT / "data" / "문항목록.csv"
FIELDNAMES = [
    "파일명",
    "위원회",
    "의원",
    "제출기한",
    "문항번호",
    "요구내용",
    "세부항목",
    "비고",
]

TITLE_RE = re.compile(r"^(.+위원회)\s+(.+?)\s+의원실\s+자료요구서$")
DEADLINE_RE = re.compile(
    r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\."
)
QUESTION_RE = re.compile(r"^(\d+)\.\s*(.*)$")
DETAIL_RE = re.compile(r"^([가나])\.\s*(.*)$")
NOTE_RE = re.compile(r"^※\s*(.*)$")
EXPECTED_RE = re.compile(r"_(\d+)문항\.pdf$", re.IGNORECASE)


@dataclass
class Item:
    number: int
    requirement: list[str] = field(default_factory=list)
    details: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    active_part: str = "requirement"

    def append_continuation(self, text: str) -> None:
        getattr(self, self.active_part).append(text)

    def as_row(
        self, filename: str, committee: str, member: str, deadline: str
    ) -> dict[str, str | int]:
        return {
            "파일명": filename,
            "위원회": committee,
            "의원": member,
            "제출기한": deadline,
            "문항번호": self.number,
            "요구내용": " ".join(self.requirement),
            "세부항목": "\n".join(self.details),
            "비고": "\n".join(self.notes),
        }


def extract_lines(pdf_path: Path) -> list[str]:
    reader = PdfReader(pdf_path)
    return [
        line.strip()
        for page in reader.pages
        for line in (page.extract_text() or "").splitlines()
        if line.strip()
    ]


def parse_pdf(pdf_path: Path) -> tuple[list[dict[str, str | int]], dict[str, object]]:
    lines = extract_lines(pdf_path)
    if not lines:
        raise ValueError(f"텍스트를 추출할 수 없습니다: {pdf_path.name}")

    title_match = TITLE_RE.fullmatch(lines[0])
    if not title_match:
        raise ValueError(f"첫 줄 형식이 맞지 않습니다: {pdf_path.name}: {lines[0]!r}")
    committee, member = title_match.groups()

    deadline_match = next((DEADLINE_RE.search(line) for line in lines if "제출기한:" in line), None)
    if deadline_match is None:
        raise ValueError(f"제출기한을 찾지 못했습니다: {pdf_path.name}")
    year, month, day = map(int, deadline_match.groups())
    deadline = date(year, month, day).isoformat()

    items: list[Item] = []
    current: Item | None = None

    for line in lines[1:]:
        if line.startswith(("수신:", "담당 보좌관:")) or line == "끝.":
            continue

        question_match = QUESTION_RE.fullmatch(line)
        if question_match:
            current = Item(
                number=int(question_match.group(1)),
                requirement=[question_match.group(2)],
            )
            items.append(current)
            continue

        if current is None:
            continue

        detail_match = DETAIL_RE.fullmatch(line)
        if detail_match:
            current.details.append(f"{detail_match.group(1)}. {detail_match.group(2)}")
            current.active_part = "details"
            continue

        note_match = NOTE_RE.fullmatch(line)
        if note_match:
            current.notes.append(f"※ {note_match.group(1)}")
            current.active_part = "notes"
            continue

        current.append_continuation(line)

    expected_match = EXPECTED_RE.search(pdf_path.name)
    if not expected_match:
        raise ValueError(f"파일명에서 문항 수를 찾지 못했습니다: {pdf_path.name}")
    expected_count = int(expected_match.group(1))
    numbers = [item.number for item in items]
    continuous = numbers == list(range(1, len(numbers) + 1))
    last_number = numbers[-1] if numbers else 0
    matched = expected_count == len(items) == last_number and continuous

    rows = [
        item.as_row(pdf_path.name, committee, member, deadline) for item in items
    ]
    summary = {
        "파일명": pdf_path.name,
        "파일명의 문항 수": expected_count,
        "뽑은 문항 수": len(items),
        "마지막 번호": last_number,
        "번호 연속": "O" if continuous else "X",
        "일치": "O" if matched else "X",
    }
    return rows, summary


def main() -> None:
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    if len(pdf_paths) != 3:
        raise ValueError(f"원문 PDF가 3개여야 합니다(현재 {len(pdf_paths)}개).")
    if OUTPUT_PATH.exists():
        raise FileExistsError(f"기존 파일을 덮어쓰지 않습니다: {OUTPUT_PATH}")

    all_rows: list[dict[str, str | int]] = []
    summaries: list[dict[str, object]] = []
    for pdf_path in pdf_paths:
        rows, summary = parse_pdf(pdf_path)
        all_rows.extend(rows)
        summaries.append(summary)

    failed = [summary for summary in summaries if summary["일치"] == "X"]
    if failed:
        raise ValueError(f"문항 검증 불일치: {failed}")

    forbidden = ("수신:", "담당 보좌관:", "연락처:")
    for row in all_rows:
        combined = " ".join(str(row[field]) for field in FIELDNAMES)
        if any(token in combined for token in forbidden):
            raise ValueError(f"저장 금지 정보가 감지되었습니다: {row['파일명']}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("x", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)

    headers = ["파일명", "파일명의 문항 수", "뽑은 문항 수", "마지막 번호", "번호 연속", "일치"]
    print(" | ".join(headers))
    print(" | ".join("---" for _ in headers))
    for summary in summaries:
        print(" | ".join(str(summary[header]) for header in headers))


if __name__ == "__main__":
    main()

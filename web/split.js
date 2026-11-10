(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RequirementSplitter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE_RE = /^(.+위원회)\s+(.+?)\s+의원실\s+자료요구서$/;
  const DEADLINE_RE = /제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./;
  const QUESTION_RE = /^(\d+)\.\s*(.*)$/;
  const DETAIL_RE = /^([가나])\.\s*(.*)$/;
  const NOTE_RE = /^※\s*(.*)$/;
  const EXPECTED_RE = /_(\d+)문항\.pdf$/i;

  function isoDate(year, month, day) {
    const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      value.getUTCFullYear() !== Number(year) ||
      value.getUTCMonth() + 1 !== Number(month) ||
      value.getUTCDate() !== Number(day)
    ) {
      throw new Error("제출기한 날짜가 올바르지 않습니다.");
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseText(text, filename = "") {
    const lines = String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error("PDF에서 글자를 추출하지 못했습니다.");

    const title = lines[0].match(TITLE_RE);
    if (!title) throw new Error(`첫 줄 형식이 맞지 않습니다: ${lines[0]}`);
    const committee = title[1];
    const member = title[2];

    const deadlineMatch = lines
      .find((line) => line.includes("제출기한:"))
      ?.match(DEADLINE_RE);
    if (!deadlineMatch) throw new Error("제출기한을 찾지 못했습니다.");
    const deadline = isoDate(deadlineMatch[1], deadlineMatch[2], deadlineMatch[3]);

    const items = [];
    let current = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") {
        continue;
      }

      const question = line.match(QUESTION_RE);
      if (question) {
        current = {
          number: Number(question[1]),
          requirement: [question[2]],
          details: [],
          notes: [],
          active: "requirement",
        };
        items.push(current);
        continue;
      }
      if (!current) continue;

      const detail = line.match(DETAIL_RE);
      if (detail) {
        current.details.push(`${detail[1]}. ${detail[2]}`);
        current.active = "details";
        continue;
      }
      const note = line.match(NOTE_RE);
      if (note) {
        current.notes.push(`※ ${note[1]}`);
        current.active = "notes";
        continue;
      }
      current[current.active].push(line);
    }

    const rows = items.map((item) => ({
      파일명: filename,
      위원회: committee,
      의원: member,
      제출기한: deadline,
      문항번호: item.number,
      요구내용: item.requirement.join(" "),
      세부항목: item.details.join("\n"),
      비고: item.notes.join("\n"),
    }));
    const numbers = items.map((item) => item.number);
    const continuous = numbers.every((number, index) => number === index + 1);
    const lastNumber = numbers.at(-1) || 0;
    const expected = filename.match(EXPECTED_RE)?.[1];
    const expectedCount = expected ? Number(expected) : null;
    const matched =
      continuous &&
      lastNumber === rows.length &&
      (expectedCount === null || expectedCount === rows.length);

    return {
      rows,
      summary: {
        파일명: filename,
        파일명의문항수: expectedCount,
        뽑은문항수: rows.length,
        마지막번호: lastNumber,
        번호연속: continuous,
        일치: matched,
      },
    };
  }

  return { parseText };
});

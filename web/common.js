(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AssignmentCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "a-ministry.assignment.v1";

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text).replace(/^\uFEFF/, "");
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else field += char;
    }
    if (quoted) throw new Error("닫히지 않은 CSV 따옴표가 있습니다.");
    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    const clean = rows.filter((values) => values.some((value) => value.trim()));
    if (!clean.length) return [];
    const headers = clean.shift().map((header) => header.trim());
    return clean.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]))
    );
  }

  async function loadCsv(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${url}`);
    return parseCsv(await response.text());
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch (error) {
      console.warn("저장 자료를 읽지 못해 새로 시작합니다.", error);
    }
    return { version: 1, items: [], history: [], updatedAt: null };
  }

  function writeState(state) {
    const next = { ...state, updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function itemId(row) {
    return `${row.파일명 || "직접등록"}::${row.문항번호}`;
  }

  function normalizeItem(row, candidates = []) {
    const first = candidates[0]?.과 || "";
    return {
      id: row.id || itemId(row),
      filename: row.파일명 || row.filename || "",
      committee: row.위원회 || row.committee || "",
      member: row.의원 || row.member || "",
      deadline: row.제출기한 || row.deadline || "",
      number: Number(row.문항번호 ?? row.number),
      requirement: row.요구내용 || row.requirement || "",
      details: row.세부항목 || row.details || "",
      note: row.비고 || row.note || "",
      candidates,
      lead: row.lead || first,
      collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
      status: row.status || "배분대기",
      confirmed: Boolean(row.confirmed),
      confirmationMethod: row.confirmationMethod || "",
      confirmedAt: row.confirmedAt || null,
    };
  }

  function registerItems(rows, classify) {
    const state = readState();
    const existing = new Map(state.items.map((item) => [item.id, item]));
    for (const row of rows) {
      const candidates = classify(row.요구내용 || "");
      const normalized = normalizeItem(row, candidates);
      existing.set(normalized.id, existing.has(normalized.id) ? existing.get(normalized.id) : normalized);
    }
    state.items = [...existing.values()];
    return writeState(state);
  }

  function updateItem(id, changes, historyEntry = null) {
    const state = readState();
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("저장된 문항을 찾지 못했습니다.");
    state.items[index] = { ...state.items[index], ...changes };
    if (historyEntry) {
      state.history.push({ id, at: new Date().toISOString(), ...historyEntry });
    }
    return writeState(state);
  }

  function summarizeCsvRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.파일명)) groups.set(row.파일명, []);
      groups.get(row.파일명).push(Number(row.문항번호));
    }
    return [...groups].map(([filename, numbers]) => {
      numbers.sort((a, b) => a - b);
      const expectedMatch = filename.match(/_(\d+)문항\.pdf$/i);
      const expected = expectedMatch ? Number(expectedMatch[1]) : null;
      const continuous = numbers.every((number, index) => number === index + 1);
      const last = numbers.at(-1) || 0;
      return {
        파일명: filename,
        파일명의문항수: expected,
        뽑은문항수: numbers.length,
        마지막번호: last,
        번호연속: continuous,
        일치: continuous && last === numbers.length && (expected === null || expected === numbers.length),
      };
    });
  }

  return {
    STORAGE_KEY,
    parseCsv,
    loadCsv,
    readState,
    writeState,
    normalizeItem,
    registerItems,
    updateItem,
    summarizeCsvRows,
  };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ClassificationEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let rules = null;
  let departments = null;

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
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (quoted) {
      throw new Error("닫히지 않은 CSV 따옴표가 있습니다.");
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }

    const nonEmptyRows = rows.filter((values) =>
      values.some((value) => value.trim() !== "")
    );
    if (nonEmptyRows.length === 0) return [];

    const headers = nonEmptyRows.shift().map((header) => header.trim());
    return nonEmptyRows.map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, (values[index] || "").trim()])
      )
    );
  }

  function browserDefaultUrl(filename) {
    const script = document.currentScript;
    if (!script || !script.src) return `./data/${filename}`;
    return new URL(`./data/${filename}`, script.src).href;
  }

  async function readText(source) {
    if (typeof window !== "undefined" && typeof window.fetch === "function") {
      const response = await window.fetch(source);
      if (!response.ok) {
        throw new Error(`CSV를 불러오지 못했습니다: ${source} (${response.status})`);
      }
      return response.text();
    }

    const fs = require("fs/promises");
    return fs.readFile(source, "utf8");
  }

  async function init(options = {}) {
    let rulesSource = options.rulesSource;
    let orgSource = options.orgSource;

    if (typeof window !== "undefined") {
      rulesSource =
        rulesSource || browserDefaultUrl("배분기준표_소관키워드_304건.csv");
      orgSource = orgSource || browserDefaultUrl("A부_조직도_26개과.csv");
    } else {
      const path = require("path");
      rulesSource =
        rulesSource ||
        path.resolve(__dirname, "data", "배분기준표_소관키워드_304건.csv");
      orgSource =
        orgSource || path.resolve(__dirname, "data", "A부_조직도_26개과.csv");
    }

    const [ruleRows, orgRows] = await Promise.all([
      readText(rulesSource).then(parseCsv),
      readText(orgSource).then(parseCsv),
    ]);

    const requiredRuleColumns = ["과", "키워드", "제외어", "우선순위"];
    for (const column of requiredRuleColumns) {
      if (ruleRows.length && !(column in ruleRows[0])) {
        throw new Error(`배분기준표에 필수 열이 없습니다: ${column}`);
      }
    }
    if (orgRows.length && !("과" in orgRows[0])) {
      throw new Error("조직도에 필수 열이 없습니다: 과");
    }

    departments = new Set(orgRows.map((row) => row["과"]).filter(Boolean));
    rules = ruleRows
      .map((row, order) => ({
        department: row["과"],
        keyword: row["키워드"],
        exclusions: row["제외어"]
          .split("|")
          .map((value) => value.trim())
          .filter((value) => value && value !== "-"),
        priority: Number(row["우선순위"]),
        order,
      }))
      .filter(
        (rule) =>
          rule.department &&
          rule.keyword &&
          Number.isFinite(rule.priority) &&
          departments.has(rule.department)
      );

    return { 규칙수: rules.length, 조직과수: departments.size };
  }

  function classify(requirement) {
    if (!rules || !departments) {
      throw new Error("먼저 ClassificationEngine.init()을 실행해야 합니다.");
    }
    if (typeof requirement !== "string") {
      throw new TypeError("요구내용은 문자열이어야 합니다.");
    }

    const normalized = requirement.toLocaleLowerCase("ko-KR");
    const candidates = new Map();

    for (const rule of rules) {
      const keyword = rule.keyword.toLocaleLowerCase("ko-KR");
      if (!normalized.includes(keyword)) continue;
      if (
        rule.exclusions.some((exclusion) =>
          normalized.includes(exclusion.toLocaleLowerCase("ko-KR"))
        )
      ) {
        continue;
      }

      const score = rule.priority + rule.keyword.length / 10;
      const candidate = candidates.get(rule.department) || {
        과: rule.department,
        점수: 0,
        근거키워드: [],
        longestKeyword: 0,
        firstOrder: rule.order,
      };
      candidate.점수 = Math.max(candidate.점수, score);
      candidate.longestKeyword = Math.max(
        candidate.longestKeyword,
        rule.keyword.length
      );
      if (!candidate.근거키워드.includes(rule.keyword)) {
        candidate.근거키워드.push(rule.keyword);
      }
      candidate.firstOrder = Math.min(candidate.firstOrder, rule.order);
      candidates.set(rule.department, candidate);
    }

    return [...candidates.values()]
      .sort(
        (left, right) =>
          right.점수 - left.점수 ||
          right.longestKeyword - left.longestKeyword ||
          left.firstOrder - right.firstOrder ||
          left.과.localeCompare(right.과, "ko")
      )
      .slice(0, 3)
      .map(({ 과, 점수, 근거키워드 }) => ({
        과,
        점수: Number(점수.toFixed(1)),
        근거키워드,
      }));
  }

  return { init, classify, parseCsv };
});

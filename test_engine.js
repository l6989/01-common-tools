const fs = require("fs");
const path = require("path");
const engine = require("./web/engine.js");

async function main() {
  const dataDir = path.join(__dirname, "data");
  await engine.init({
    rulesSource: path.join(dataDir, "배분기준표_소관키워드_304건.csv"),
    orgSource: path.join(dataDir, "A부_조직도_26개과.csv"),
  });

  const testText = fs.readFileSync(
    path.join(dataDir, "시험_요구문항_40건.csv"),
    "utf8"
  );
  const tests = engine.parseCsv(testText);

  let top1Correct = 0;
  let top3Correct = 0;
  const incorrect = [];

  for (const test of tests) {
    const result = engine.classify(test["요구내용"]);
    const departments = result.map((candidate) => candidate.과);
    const answer = test["정답_배분과"];
    if (departments[0] === answer) top1Correct += 1;
    if (departments.includes(answer)) top3Correct += 1;

    if (departments[0] !== answer) {
      incorrect.push({
        시험번호: test["시험번호"],
        요구내용: test["요구내용"],
        정답: answer,
        "엔진 결과":
          result.length === 0
            ? "후보 없음"
            : result
                .map(
                  (candidate) =>
                    `${candidate.과}(${candidate.점수}; ${candidate.근거키워드.join(", ")})`
                )
                .join(" > "),
      });
    }
  }

  console.log(`1순위 정답 ${top1Correct}/${tests.length} · 3순위 안 ${top3Correct}/${tests.length}`);
  console.log("\n틀린 문항 표");
  if (incorrect.length === 0) {
    console.log("없음");
  } else {
    console.table(incorrect);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

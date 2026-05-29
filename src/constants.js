const GRADE_POINTS = Object.freeze({
  "A+": 10.0,
  A: 9.0,
  B: 8.0,
  C: 7.0,
  D: 6.0,
  E: 5.0,
  P: 5.0,
});

const SEMESTER_ORDER = Object.freeze(["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1"]);
const SEMESTER_INDEX = Object.freeze(
  Object.fromEntries(SEMESTER_ORDER.map((code, idx) => [code, idx + 1]))
);

const REGULAR_SEMESTERS = SEMESTER_ORDER;
const LATERAL_SEMESTERS = Object.freeze(["2-1", "2-2", "3-1", "3-2", "4-1"]);

const ROLL_HEADER_VARIANTS = new Set(["reg no", "regno", "register no"]);
const NAME_HEADER_VARIANTS = new Set(["std name", "student name", "name"]);

const SUMMARY_HEADER_MAP = Object.freeze({
  total: "total_points",
  sgpa: "sgpa",
  spga: "sgpa",
  cgpa: "cgpa_snapshot",
  "no of backlogs": "backlog_count",
  backlogs: "backlog_count",
  "sem rank": "sem_rank",
  "overall rank": "overall_rank",
});

const SUMMARY_HEADERS = new Set(Object.keys(SUMMARY_HEADER_MAP));

module.exports = {
  GRADE_POINTS,
  SEMESTER_ORDER,
  SEMESTER_INDEX,
  REGULAR_SEMESTERS,
  LATERAL_SEMESTERS,
  ROLL_HEADER_VARIANTS,
  NAME_HEADER_VARIANTS,
  SUMMARY_HEADER_MAP,
  SUMMARY_HEADERS,
};

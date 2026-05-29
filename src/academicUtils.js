const { GRADE_POINTS } = require("./constants");

const FAIL_GRADES = new Set(["F", "FAIL", "AB", "ABS", "ABSENT", "MP", "MALPRACTICE", "WITHHELD"]);
const PASS_GRADE_POINT_THRESHOLD = 5;

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGrade(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().toUpperCase();
}

function resolveGradePointsFromGrade(grade) {
  const normalized = normalizeGrade(grade);
  if (!normalized) {
    return null;
  }
  if (Object.hasOwn(GRADE_POINTS, normalized)) {
    return Number(GRADE_POINTS[normalized]);
  }
  return null;
}

function isBacklogSubject(subject) {
  const grade = normalizeGrade(subject.grade);
  const gradePoints = toNumberOrNull(subject.grade_points);

  if (gradePoints !== null) {
    return gradePoints < PASS_GRADE_POINT_THRESHOLD;
  }
  if (!grade) {
    return false;
  }
  if (FAIL_GRADES.has(grade)) {
    return true;
  }
  if (Object.hasOwn(GRADE_POINTS, grade)) {
    return Number(GRADE_POINTS[grade]) < PASS_GRADE_POINT_THRESHOLD;
  }
  return true;
}

function calculateSemesterMetrics(subjects) {
  let totalCredits = 0;
  let totalPoints = 0;
  let backlogCount = 0;

  for (const subject of subjects) {
    if (isBacklogSubject(subject)) {
      backlogCount += 1;
    }

    const credits = toNumberOrNull(subject.credits);
    const gradePoints = toNumberOrNull(subject.grade_points);
    if (credits === null || gradePoints === null) {
      continue;
    }

    totalCredits += credits;
    totalPoints += credits * gradePoints;
  }

  return {
    backlog_count: backlogCount,
    total_points: totalCredits > 0 ? round2(totalPoints) : null,
    sgpa: totalCredits > 0 ? round2(totalPoints / totalCredits) : null,
    total_credits: round2(totalCredits),
  };
}

function serializeDoc(doc) {
  if (!doc) {
    return null;
  }
  const plain = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const id = plain._id ? String(plain._id) : null;
  const normalized = { ...plain };
  delete normalized._id;
  delete normalized.__v;
  if (id) {
    normalized.id = id;
  }
  return normalized;
}

module.exports = {
  calculateSemesterMetrics,
  isBacklogSubject,
  normalizeGrade,
  resolveGradePointsFromGrade,
  round2,
  serializeDoc,
  toNumberOrNull,
};

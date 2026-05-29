const { LATERAL_SEMESTERS, REGULAR_SEMESTERS, SEMESTER_INDEX } = require("./constants");
const { SemesterResult, Student, SubjectResult } = require("./models");
const { isBacklogSubject, round2, serializeDoc, toNumberOrNull } = require("./academicUtils");

function allowedSemesters(cohortType) {
  const normalized = String(cohortType || "").toUpperCase();
  if (normalized === "B95") {
    return LATERAL_SEMESTERS;
  }
  return REGULAR_SEMESTERS;
}

function semesterSortKey(code) {
  return SEMESTER_INDEX[code] ?? 999;
}

async function getStudentSummary(rollNo) {
  const student = await Student.findOne({ roll_no: rollNo }).lean();
  if (!student) {
    return null;
  }

  const semestersToCount = allowedSemesters(student.cohort_type);

  const semesterRows = await SemesterResult.find({
    roll_no: rollNo,
    semester_code: { $in: semestersToCount },
  }).lean();
  semesterRows.sort((a, b) => semesterSortKey(a.semester_code) - semesterSortKey(b.semester_code));

  const subjects = await SubjectResult.find({
    roll_no: rollNo,
    semester_code: { $in: semestersToCount },
  }).lean();
  subjects.sort((a, b) => {
    const semesterCompare = semesterSortKey(a.semester_code) - semesterSortKey(b.semester_code);
    if (semesterCompare !== 0) {
      return semesterCompare;
    }
    return String(a.subject_name || "").localeCompare(String(b.subject_name || ""));
  });

  let totalCredits = 0;
  let totalGradePoints = 0;
  for (const item of subjects) {
    const credits = toNumberOrNull(item.credits);
    const gradePoints = toNumberOrNull(item.grade_points);
    if (credits === null || gradePoints === null) {
      continue;
    }
    totalCredits += credits;
    totalGradePoints += credits * gradePoints;
  }

  const weightedCgpa = totalCredits > 0 ? round2(totalGradePoints / totalCredits) : null;
  let latestCgpa = null;
  for (let idx = semesterRows.length - 1; idx >= 0; idx -= 1) {
    const row = semesterRows[idx];
    if (row.cgpa_snapshot !== null && row.cgpa_snapshot !== undefined) {
      latestCgpa = round2(row.cgpa_snapshot);
      break;
    }
  }
  const finalCgpa = weightedCgpa !== null ? weightedCgpa : latestCgpa;

  const cumulativeBacklogs = semesterRows.reduce(
    (sum, row) => sum + Number.parseInt(row.backlog_count ?? 0, 10),
    0
  );
  const currentBacklogs = semesterRows.length
    ? Number.parseInt(semesterRows[semesterRows.length - 1].backlog_count ?? 0, 10)
    : 0;

  const semesterPerformance = semesterRows.map((row) => {
    const normalized = { ...serializeDoc(row) };
    const backlog = Number.parseInt(normalized.backlog_count ?? 0, 10);
    normalized.pass_status = backlog === 0 ? "PASS" : "WITH_BACKLOGS";
    if (normalized.sgpa !== null && normalized.sgpa !== undefined) {
      normalized.sgpa = round2(normalized.sgpa);
    }
    if (normalized.cgpa_snapshot !== null && normalized.cgpa_snapshot !== undefined) {
      normalized.cgpa_snapshot = round2(normalized.cgpa_snapshot);
    }
    return normalized;
  });

  const gradeDistribution = {};
  for (const item of subjects) {
    const grade = String(item.grade || "").trim().toUpperCase();
    if (!grade) {
      continue;
    }
    gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
  }
  const sortedGradeDistribution = Object.fromEntries(
    Object.entries(gradeDistribution).sort(([gradeA], [gradeB]) => gradeA.localeCompare(gradeB))
  );
  const backlogSubjects = subjects.filter((item) => isBacklogSubject(item)).map((item) => serializeDoc(item));

  return {
    student: serializeDoc(student),
    cumulative: {
      final_cgpa: finalCgpa,
      total_credits: round2(totalCredits),
      cumulative_backlogs: cumulativeBacklogs,
      current_backlogs: currentBacklogs,
      semesters_counted: semesterPerformance.length,
      counted_semesters: semestersToCount,
    },
    semester_performance: semesterPerformance,
    exam_performance: {
      subject_count: subjects.length,
      grade_distribution: sortedGradeDistribution,
    },
    backlog_subjects: backlogSubjects,
  };
}

module.exports = {
  getStudentSummary,
};

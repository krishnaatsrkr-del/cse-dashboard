const { SemesterResult, SubjectResult } = require("./models");
const {
  calculateSemesterMetrics,
  isBacklogSubject,
  normalizeGrade,
  resolveGradePointsFromGrade,
  serializeDoc,
  toNumberOrNull,
} = require("./academicUtils");

function createValidationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function parseOptionalNumber(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createValidationError(`${fieldName} must be a valid number`);
  }
  return parsed;
}

function parseOptionalText(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw createValidationError(`${fieldName} must be a string`);
  }
  const normalized = value.trim();
  return normalized || null;
}

async function recomputeSemesterMetrics(rollNo, semesterCode) {
  const subjects = await SubjectResult.find({
    roll_no: rollNo,
    semester_code: semesterCode,
  }).lean();

  const metrics = calculateSemesterMetrics(subjects);
  await SemesterResult.updateOne(
    { roll_no: rollNo, semester_code: semesterCode },
    {
      $set: {
        backlog_count: metrics.backlog_count,
        sgpa: metrics.sgpa,
        total_points: metrics.total_points,
        source_sheet: semesterCode,
      },
      $setOnInsert: {
        roll_no: rollNo,
        semester_code: semesterCode,
      },
    },
    { upsert: true }
  );

  return metrics;
}

async function updateSubjectRecord(subjectId, payload) {
  const subject = await SubjectResult.findById(subjectId);
  if (!subject) {
    return null;
  }

  const incomingName = parseOptionalText(payload.subject_name, "subject_name");
  const incomingCredits = parseOptionalNumber(payload.credits, "credits");
  const incomingGrade = parseOptionalText(payload.grade, "grade");
  const incomingGradePoints = parseOptionalNumber(payload.grade_points, "grade_points");
  const markAsPass = payload.mark_as_pass === true;

  let nextName = subject.subject_name;
  let nextCredits = toNumberOrNull(subject.credits);
  let nextGrade = normalizeGrade(subject.grade) || null;
  let nextGradePoints = toNumberOrNull(subject.grade_points);

  if (incomingName !== undefined) {
    if (!incomingName) {
      throw createValidationError("subject_name cannot be empty");
    }
    nextName = incomingName;
  }
  if (incomingCredits !== undefined) {
    nextCredits = incomingCredits;
  }
  if (incomingGrade !== undefined) {
    nextGrade = incomingGrade ? normalizeGrade(incomingGrade) : null;
  }
  if (incomingGradePoints !== undefined) {
    nextGradePoints = incomingGradePoints;
  } else if (incomingGrade !== undefined && nextGrade) {
    const resolved = resolveGradePointsFromGrade(nextGrade);
    if (resolved !== null) {
      nextGradePoints = resolved;
    }
  }

  if (markAsPass) {
    if (!nextGrade || isBacklogSubject({ grade: nextGrade, grade_points: nextGradePoints })) {
      nextGrade = "E";
    }
    const resolved = resolveGradePointsFromGrade(nextGrade);
    if (nextGradePoints === null || nextGradePoints < 5) {
      nextGradePoints = resolved ?? 5;
    }
  }

  let nextEarnedPoints = null;
  if (nextCredits !== null && nextGradePoints !== null) {
    nextEarnedPoints = nextCredits * nextGradePoints;
  }

  subject.subject_name = nextName;
  subject.credits = nextCredits;
  subject.grade = nextGrade;
  subject.grade_points = nextGradePoints;
  subject.earned_points = nextEarnedPoints;
  await subject.save();

  const semesterMetrics = await recomputeSemesterMetrics(subject.roll_no, subject.semester_code);
  return {
    item: serializeDoc(subject),
    semester_metrics: semesterMetrics,
  };
}

module.exports = {
  recomputeSemesterMetrics,
  updateSubjectRecord,
};

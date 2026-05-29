const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const {
  GRADE_POINTS,
  NAME_HEADER_VARIANTS,
  ROLL_HEADER_VARIANTS,
  SEMESTER_ORDER,
  SUMMARY_HEADER_MAP,
  SUMMARY_HEADERS,
} = require("./constants");
const { connectDb } = require("./db");
const { IngestionRun, SemesterResult, Student, SubjectResult } = require("./models");

const VALID_ROLL_RE = /^\d{2}B(91|95)[A-Z0-9]+$/i;

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function toFloat(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInt(value) {
  const parsed = toFloat(value);
  if (parsed === null) {
    return null;
  }
  return Math.round(parsed);
}

function cleanGrade(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const grade = String(value).trim().toUpperCase().replace(/\s+/g, "");
  return grade || null;
}

function detectCohort(rollNo) {
  const normalized = String(rollNo || "").toUpperCase();
  if (normalized.includes("B95")) {
    return "B95";
  }
  if (normalized.includes("B91")) {
    return "B91";
  }
  return "UNKNOWN";
}

function detectJoinYear(rollNo) {
  const match = String(rollNo || "").match(/^(\d{2})/);
  if (!match) {
    return null;
  }
  return 2000 + Number.parseInt(match[1], 10);
}

function detectBranch(rollNo) {
  const match = String(rollNo || "")
    .toUpperCase()
    .match(/^\d{2}B(91|95)([A-Z]\d{2})/);
  if (!match) {
    return null;
  }
  return match[2];
}

function resolveSubjectName(rawHeaders, normalizedHeaders, startCol, seqNum) {
  const candidates = [startCol, startCol + 1, startCol + 2];
  for (const col of candidates) {
    const idx = col - 1;
    if (idx < 0 || idx >= rawHeaders.length) {
      continue;
    }
    const normalized = normalizedHeaders[idx];
    const raw = String(rawHeaders[idx] || "").trim();
    if (!raw) {
      continue;
    }
    if (ROLL_HEADER_VARIANTS.has(normalized) || NAME_HEADER_VARIANTS.has(normalized)) {
      continue;
    }
    if (SUMMARY_HEADERS.has(normalized)) {
      continue;
    }
    return raw;
  }
  return `Subject ${seqNum}`;
}

function expandUserPath(targetPath) {
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

function isWindowsAbsolutePath(targetPath) {
  return /^[A-Z]:[\\/]/i.test(String(targetPath || ""));
}

function resolveWorkbookPath(filePath) {
  const rawInput = String(filePath || "").trim().replace(/^['"]|['"]$/g, "");
  const expandedPath = expandUserPath(rawInput);
  const baseDir = path.resolve(__dirname, "..");
  const candidates = [];

  if (expandedPath) {
    if (path.isAbsolute(expandedPath)) {
      candidates.push(expandedPath);
    } else {
      candidates.push(path.resolve(expandedPath));
    }
  }

  if (isWindowsAbsolutePath(expandedPath)) {
    const posixLikePath = expandedPath.replace(/\\/g, "/");
    const baseName = path.posix.basename(posixLikePath);
    if (baseName) {
      candidates.push(path.join(baseDir, baseName));
      candidates.push(path.join(baseDir, "data", baseName));
    }
  }

  const checked = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (checked.includes(resolved)) {
      continue;
    }
    checked.push(resolved);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  const attempted = checked.length ? checked.join(" | ") : "(no path candidates)";
  const error = new Error(
    `File not found. Provide a server-accessible path. Checked: ${attempted}`
  );
  error.code = "ENOENT";
  throw error;
}

function getCell(row, col) {
  if (!Array.isArray(row)) {
    return null;
  }
  return row[col - 1] ?? null;
}

async function upsertStudent(rollNo, studentName, joinYear, cohortType, branch) {
  const update = {
    updated_at: new Date(),
  };

  if (studentName) {
    update.student_name = studentName;
  }
  if (joinYear !== null && joinYear !== undefined) {
    update.join_year = joinYear;
  }
  if (cohortType && cohortType !== "UNKNOWN") {
    update.cohort_type = cohortType;
  }
  if (branch) {
    update.branch = branch;
  }

  await Student.updateOne(
    { roll_no: rollNo },
    {
      $setOnInsert: {
        roll_no: rollNo,
        cohort_type: cohortType || "UNKNOWN",
      },
      $set: update,
    },
    { upsert: true }
  );
}

async function upsertSemesterResult(rollNo, semesterCode, semPayload) {
  await SemesterResult.updateOne(
    { roll_no: rollNo, semester_code: semesterCode },
    {
      $set: {
        sgpa: semPayload.sgpa,
        cgpa_snapshot: semPayload.cgpa_snapshot,
        backlog_count: semPayload.backlog_count ?? 0,
        total_points: semPayload.total_points,
        sem_rank: semPayload.sem_rank,
        overall_rank: semPayload.overall_rank,
        source_sheet: semesterCode,
        updated_at: new Date(),
      },
      $setOnInsert: {
        roll_no: rollNo,
        semester_code: semesterCode,
      },
    },
    { upsert: true }
  );
}

async function replaceSubjectRows(rollNo, semesterCode, subjectRows) {
  await SubjectResult.deleteMany({ roll_no: rollNo, semester_code: semesterCode });
  if (subjectRows.length === 0) {
    return;
  }
  await SubjectResult.insertMany(
    subjectRows.map((row) => ({
      roll_no: rollNo,
      semester_code: semesterCode,
      subject_name: row.subject_name,
      credits: row.credits,
      grade: row.grade,
      grade_points: row.grade_points,
      earned_points: row.earned_points,
      updated_at: new Date(),
    })),
    { ordered: false }
  );
}

async function importResultsWorkbook(filePath) {
  await connectDb();
  const resolvedPath = resolveWorkbookPath(filePath);

  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(resolvedPath)).digest("hex");
  const workbook = XLSX.readFile(resolvedPath, { cellDates: false });

  let rowsImported = 0;
  let rowsSkipped = 0;
  const skippedReasons = [];
  const sheetsProcessed = [];

  const run = await IngestionRun.create({
    source_file: resolvedPath,
    source_hash: sourceHash,
    status: "running",
  });

  try {
    for (const sheetName of workbook.SheetNames) {
      const semesterCode = String(sheetName || "").trim();
      if (!SEMESTER_ORDER.includes(semesterCode)) {
        continue;
      }

      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
        defval: null,
      });
      if (!Array.isArray(rows) || rows.length < 2) {
        continue;
      }

      const maxCol = Math.max(
        0,
        ...rows.map((row) => (Array.isArray(row) ? row.length : 0))
      );
      if (maxCol === 0) {
        continue;
      }

      const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
      const rawHeaders = Array.from({ length: maxCol }, (_, idx) =>
        String(headerRow[idx] ?? "").trim()
      );
      const normalizedHeaders = rawHeaders.map(normalizeText);

      let rollCol = null;
      let nameCol = null;
      const summaryCols = {};
      normalizedHeaders.forEach((normalized, idx) => {
        const col = idx + 1;
        if (ROLL_HEADER_VARIANTS.has(normalized)) {
          rollCol = col;
        }
        if (NAME_HEADER_VARIANTS.has(normalized)) {
          nameCol = col;
        }
        if (Object.hasOwn(SUMMARY_HEADER_MAP, normalized)) {
          summaryCols[SUMMARY_HEADER_MAP[normalized]] = col;
        }
      });

      if (!rollCol) {
        skippedReasons.push(`${semesterCode}: missing roll number header`);
        continue;
      }

      let summaryStartCol = Object.keys(summaryCols).length
        ? Math.min(...Object.values(summaryCols))
        : maxCol + 1;
      let firstSubjectCol = rollCol + 1;
      if (nameCol && nameCol === rollCol + 1) {
        firstSubjectCol = nameCol + 1;
      }
      if (summaryStartCol <= firstSubjectCol) {
        summaryStartCol = maxCol + 1;
      }

      sheetsProcessed.push(semesterCode);
      for (let rowIndex = 2; rowIndex <= rows.length; rowIndex += 1) {
        const row = Array.isArray(rows[rowIndex - 1]) ? rows[rowIndex - 1] : [];

        const rollRaw = getCell(row, rollCol);
        const rollNo = String(rollRaw ?? "").trim().toUpperCase();
        if (!rollNo) {
          continue;
        }
        if (!VALID_ROLL_RE.test(rollNo)) {
          rowsSkipped += 1;
          skippedReasons.push(`${semesterCode} row ${rowIndex}: invalid roll ${rollNo}`);
          continue;
        }

        let studentName = null;
        if (nameCol) {
          const rawName = getCell(row, nameCol);
          const candidate = String(rawName ?? "").trim();
          studentName = candidate || null;
        }

        await upsertStudent(
          rollNo,
          studentName,
          detectJoinYear(rollNo),
          detectCohort(rollNo),
          detectBranch(rollNo)
        );

        const semPayload = {
          sgpa: Object.hasOwn(summaryCols, "sgpa") ? toFloat(getCell(row, summaryCols.sgpa)) : null,
          cgpa_snapshot: Object.hasOwn(summaryCols, "cgpa_snapshot")
            ? toFloat(getCell(row, summaryCols.cgpa_snapshot))
            : null,
          backlog_count: Object.hasOwn(summaryCols, "backlog_count")
            ? toInt(getCell(row, summaryCols.backlog_count))
            : 0,
          total_points: Object.hasOwn(summaryCols, "total_points")
            ? toFloat(getCell(row, summaryCols.total_points))
            : null,
          sem_rank: Object.hasOwn(summaryCols, "sem_rank")
            ? toInt(getCell(row, summaryCols.sem_rank))
            : null,
          overall_rank: Object.hasOwn(summaryCols, "overall_rank")
            ? toInt(getCell(row, summaryCols.overall_rank))
            : null,
        };
        await upsertSemesterResult(rollNo, semesterCode, semPayload);

        const dedupSubjectRows = new Map();
        let subjectSeq = 1;
        for (let col = firstSubjectCol; col < summaryStartCol; col += 3) {
          if (col + 2 > maxCol) {
            break;
          }
          const subjectName = resolveSubjectName(rawHeaders, normalizedHeaders, col, subjectSeq);
          const credits = toFloat(getCell(row, col));
          let gradePoints = toFloat(getCell(row, col + 1));
          const grade = cleanGrade(getCell(row, col + 2));

          if (gradePoints === null && grade && Object.hasOwn(GRADE_POINTS, grade)) {
            gradePoints = GRADE_POINTS[grade];
          }

          if (credits === null && gradePoints === null && !grade) {
            subjectSeq += 1;
            continue;
          }

          const earnedPoints =
            credits !== null && gradePoints !== null ? credits * gradePoints : null;
          dedupSubjectRows.set(subjectName.toUpperCase(), {
            subject_name: subjectName,
            credits,
            grade,
            grade_points: gradePoints,
            earned_points: earnedPoints,
          });
          subjectSeq += 1;
        }

        const subjectRows = Array.from(dedupSubjectRows.values());
        await replaceSubjectRows(rollNo, semesterCode, subjectRows);
        rowsImported += 1;
      }
    }

    const notes = skippedReasons.length > 0 ? skippedReasons.slice(0, 30).join("; ") : "Import completed";
    await IngestionRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "completed",
          rows_imported: rowsImported,
          rows_skipped: rowsSkipped,
          finished_at: new Date(),
          notes,
        },
      }
    );
  } catch (error) {
    await IngestionRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "failed",
          rows_imported: rowsImported,
          rows_skipped: rowsSkipped,
          finished_at: new Date(),
          notes: String(error.message || error),
        },
      }
    );
    throw error;
  }

  return {
    status: "completed",
    source_file: resolvedPath,
    rows_imported: rowsImported,
    rows_skipped: rowsSkipped,
    sheets_processed: sheetsProcessed,
    sample_skips: skippedReasons.slice(0, 10),
  };
}

module.exports = {
  importResultsWorkbook,
};
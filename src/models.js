const { mongoose } = require("./db");

const { Schema } = mongoose;

const studentSchema = new Schema(
  {
    roll_no: { type: String, required: true, unique: true, index: true },
    student_name: { type: String, default: null },
    join_year: { type: Number, default: null },
    cohort_type: { type: String, default: "UNKNOWN" },
    branch: { type: String, default: null },
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

const semesterResultSchema = new Schema(
  {
    roll_no: { type: String, required: true, index: true },
    semester_code: { type: String, required: true },
    sgpa: { type: Number, default: null },
    cgpa_snapshot: { type: Number, default: null },
    backlog_count: { type: Number, default: 0 },
    total_points: { type: Number, default: null },
    sem_rank: { type: Number, default: null },
    overall_rank: { type: Number, default: null },
    source_sheet: { type: String, default: null },
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: false,
      updatedAt: "updated_at",
    },
  }
);
semesterResultSchema.index({ roll_no: 1, semester_code: 1 }, { unique: true });

const subjectResultSchema = new Schema(
  {
    roll_no: { type: String, required: true, index: true },
    semester_code: { type: String, required: true, index: true },
    subject_name: { type: String, required: true },
    credits: { type: Number, default: null },
    grade: { type: String, default: null },
    grade_points: { type: Number, default: null },
    earned_points: { type: Number, default: null },
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: false,
      updatedAt: "updated_at",
    },
  }
);
subjectResultSchema.index({ roll_no: 1, semester_code: 1, subject_name: 1 }, { unique: true });

const permissionSchema = new Schema(
  {
    roll_no: { type: String, required: true, index: true },
    letter_no: { type: String, required: true },
    permission_type: { type: String, required: true },
    reason: { type: String, default: null },
    issued_on: { type: String, default: null },
    valid_from: { type: String, default: null },
    valid_to: { type: String, default: null },
    remarks: { type: String, default: null },
    deleted_at: { type: Date, default: null },
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);
permissionSchema.index({ roll_no: 1, deleted_at: 1 });

const ingestionRunSchema = new Schema(
  {
    source_file: { type: String, required: true },
    source_hash: { type: String, default: null },
    status: { type: String, required: true },
    rows_imported: { type: Number, default: 0 },
    rows_skipped: { type: Number, default: 0 },
    started_at: { type: Date, default: Date.now },
    finished_at: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  {
    versionKey: false,
    timestamps: false,
  }
);

const Student = mongoose.models.Student || mongoose.model("Student", studentSchema);
const SemesterResult =
  mongoose.models.SemesterResult || mongoose.model("SemesterResult", semesterResultSchema);
const SubjectResult =
  mongoose.models.SubjectResult || mongoose.model("SubjectResult", subjectResultSchema);
const Permission = mongoose.models.Permission || mongoose.model("Permission", permissionSchema);
const IngestionRun = mongoose.models.IngestionRun || mongoose.model("IngestionRun", ingestionRunSchema);

module.exports = {
  Student,
  SemesterResult,
  SubjectResult,
  Permission,
  IngestionRun,
};

let currentRollNo = "";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }
  return data;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderSummary(summary) {
  const card = document.getElementById("summary-card");
  card.innerHTML = "";

  const student = summary.student || {};
  const cumulative = summary.cumulative || {};
  const exam = summary.exam_performance || {};

  const fields = [
    ["Roll No", student.roll_no || "-"],
    ["Name", student.student_name || "-"],
    ["Cohort", student.cohort_type || "-"],
    ["Join Year", student.join_year || "-"],
    ["Final CGPA", cumulative.final_cgpa ?? "-"],
    ["Current Backlogs", cumulative.current_backlogs ?? 0],
    ["Cumulative Backlogs", cumulative.cumulative_backlogs ?? 0],
    ["Total Credits", cumulative.total_credits ?? 0],
    ["Subjects Count", exam.subject_count ?? 0],
  ];

  fields.forEach(([label, value]) => {
    const div = document.createElement("div");
    div.className = "summary-item";
    div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    card.appendChild(div);
  });
}

function renderSemesters(summary) {
  const tbody = document.querySelector("#semester-table tbody");
  tbody.innerHTML = "";
  const rows = summary.semester_performance || [];
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.semester_code ?? "-"}</td>
      <td>${row.sgpa ?? "-"}</td>
      <td>${row.cgpa_snapshot ?? "-"}</td>
      <td>${row.backlog_count ?? 0}</td>
      <td>${row.pass_status ?? "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderBacklogSubjects(items) {
  const tbody = document.querySelector("#backlog-table tbody");
  tbody.innerHTML = "";

  if (!items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">No backlog subjects found</td>`;
    tbody.appendChild(tr);
    return;
  }

  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.semester_code ?? "-"}</td>
      <td>${item.subject_name ?? "-"}</td>
      <td>${item.grade ?? "-"}</td>
      <td>${item.grade_points ?? "-"}</td>
      <td>${item.credits ?? "-"}</td>
      <td><button class="secondary" data-subject-id="${item.id}">Mark Pass</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-subject-id]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const subjectId = event.target.dataset.subjectId;
      if (!subjectId || !currentRollNo) return;

      event.target.disabled = true;
      try {
        await fetchJson(`/api/subjects/${subjectId}`, {
          method: "PUT",
          body: JSON.stringify({ mark_as_pass: true }),
        });
        setText("search-status", "Backlog subject updated as PASS");
        await loadStudentSummary(currentRollNo);
      } catch (err) {
        setText("search-status", err.message);
      } finally {
        event.target.disabled = false;
      }
    });
  });
}

function renderPermissions(items) {
  const tbody = document.querySelector("#permission-table tbody");
  tbody.innerHTML = "";
  items.forEach((item) => {
    const tr = document.createElement("tr");
    const id = item.id;
    tr.innerHTML = `
      <td>${item.letter_no ?? "-"}</td>
      <td>${item.permission_type ?? "-"}</td>
      <td>${item.issued_on ?? "-"}</td>
      <td>${item.valid_from ?? "-"} to ${item.valid_to ?? "-"}</td>
      <td>${item.reason ?? "-"}</td>
      <td><button class="danger" data-id="${id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const permissionId = event.target.dataset.id;
      if (!permissionId) return;
      try {
        await fetchJson(`/api/permissions/${permissionId}`, { method: "DELETE" });
        setText("permission-status", "Permission deleted");
        await loadPermissions();
      } catch (err) {
        setText("permission-status", err.message);
      }
    });
  });
}

async function loadPermissions() {
  if (!currentRollNo) return;
  const payload = await fetchJson(`/api/students/${currentRollNo}/permissions`);
  renderPermissions(payload.items || []);
}
async function loadStudentSummary(rollNo) {
  const summary = await fetchJson(`/api/students/${rollNo}/summary`);
  renderSummary(summary);
  renderSemesters(summary);
  renderBacklogSubjects(summary.backlog_subjects || []);
  await loadPermissions();
}

document.getElementById("import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const filePath = document.getElementById("import-path").value.trim();
  if (!filePath) {
    setText("import-status", "Provide an Excel file path");
    return;
  }
  setText("import-status", "Import running...");
  try {
    const payload = await fetchJson("/api/import/results", {
      method: "POST",
      body: JSON.stringify({ file_path: filePath }),
    });
    setText(
      "import-status",
      `Import completed | rows=${payload.rows_imported}, skipped=${payload.rows_skipped}`
    );
  } catch (err) {
    setText("import-status", err.message);
  }
});

document.getElementById("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const rollNo = document.getElementById("roll-input").value.trim().toUpperCase();
  if (!rollNo) {
    setText("search-status", "Enter a roll number");
    return;
  }
  currentRollNo = rollNo;
  setText("search-status", "Loading student summary...");
  try {
    await loadStudentSummary(rollNo);
    setText("search-status", `Loaded ${rollNo}`);
  } catch (err) {
    setText("search-status", err.message);
  }
});

document.getElementById("permission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentRollNo) {
    setText("permission-status", "Search a student first");
    return;
  }
  const payload = {
    letter_no: document.getElementById("letter-no").value.trim(),
    permission_type: document.getElementById("permission-type").value.trim(),
    reason: document.getElementById("reason").value.trim() || null,
    issued_on: document.getElementById("issued-on").value || null,
    valid_from: document.getElementById("valid-from").value || null,
    valid_to: document.getElementById("valid-to").value || null,
    remarks: document.getElementById("remarks").value.trim() || null,
  };
  if (!payload.letter_no || !payload.permission_type) {
    setText("permission-status", "Letter no and type are required");
    return;
  }
  try {
    await fetchJson(`/api/students/${currentRollNo}/permissions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setText("permission-status", "Permission saved");
    document.getElementById("permission-form").reset();
    await loadStudentSummary(currentRollNo);
  } catch (err) {
    setText("permission-status", err.message);
  }
});

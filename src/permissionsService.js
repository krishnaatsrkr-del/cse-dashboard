const { Permission } = require("./models");
const { serializeDoc } = require("./academicUtils");

async function listPermissions(rollNo) {
  const items = await Permission.find({ roll_no: rollNo, deleted_at: null })
    .sort({ created_at: -1, _id: -1 })
    .lean();
  return items.map((item) => serializeDoc(item));
}

async function createPermission(rollNo, payload) {
  const item = await Permission.create({
    roll_no: rollNo,
    letter_no: payload.letter_no,
    permission_type: payload.permission_type,
    reason: payload.reason ?? null,
    issued_on: payload.issued_on ?? null,
    valid_from: payload.valid_from ?? null,
    valid_to: payload.valid_to ?? null,
    remarks: payload.remarks ?? null,
  });
  return serializeDoc(item);
}

async function updatePermission(permissionId, payload) {
  const existing = await Permission.findOne({ _id: permissionId, deleted_at: null });
  if (!existing) {
    return null;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (value !== null && value !== undefined) {
      existing[key] = value;
    }
  }
  await existing.save();
  return serializeDoc(existing);
}

async function softDeletePermission(permissionId) {
  const result = await Permission.updateOne(
    { _id: permissionId, deleted_at: null },
    { $set: { deleted_at: new Date() } }
  );
  return result.modifiedCount > 0;
}

module.exports = {
  listPermissions,
  createPermission,
  updatePermission,
  softDeletePermission,
};

/* ============================== CURRICULUM, SUBJECTS, TEACHER SLOTS & MATERIALS ==============================
   Subjects, topics (the curriculum for each class and term) and uploaded teaching materials.
   - subject, topic and subjectAssignment are ordinary records in the Data sheet, so they work offline like
     everything else and follow the same branch rules (an optional schoolId: empty = all branches).
   - material FILES (PDF, Word, Markdown, slides, sheets, images) are stored in a per-school Google Drive folder
     owned by the platform account. Only the metadata goes in the Data sheet, so the 10-million-cell limit is
     never threatened by large files. Files are private to Drive; the server streams them to authorised users.
   - A teacher who is not also school staff sees topics and materials ONLY for the class/arm/subject slots
     assigned to them in subjectAssignment, and uploads only for those slots. */

const CURRICULUM_STAFF_ROLES = ['Super Administrator', 'School Administrator', 'Principal / Head Teacher', 'Academic Officer / Exam Officer'];
const MATERIAL_MAX_BYTES = 8 * 1024 * 1024;   // 8 MB per file (base64 requests are about a third larger)
const MATERIAL_EXTENSIONS = ['pdf', 'md', 'txt', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'png', 'jpg', 'jpeg'];

function isCurriculumStaff(roles) {
  return rolesToArray(roles).some(r => CURRICULUM_STAFF_ROLES.includes(r) || ADMIN_TIER_ROLES.includes(r));
}

function teacherScopeNeeded(user) {
  return rolesToArray(user.roles).includes('Teacher') && !isCurriculumStaff(user.roles);
}

function slotKey(cls, arm, subject) {
  return [String(cls || ''), String(arm || ''), String(subject || '')].join('|');
}

function mySlotKeys(user, rows) {
  return new Set(rows.filter(r => r.type === 'subjectAssignment').map(r => safeParse(r.payload))
    .filter(p => p.teacherUserId === user.userId)
    .map(p => slotKey(p.class, p.arm, p.subject)));
}

// Applied to the read result for teacher-only users. Other roles pass through unchanged.
function applyTeacherScope(scoped, user, rows) {
  const mine = mySlotKeys(user, rows);
  return scoped.filter(r => {
    if (r.type === 'subjectAssignment') return safeParse(r.payload).teacherUserId === user.userId;
    if (r.type === 'topic' || r.type === 'material') {
      const p = safeParse(r.payload);
      return mine.has(slotKey(p.class, p.arm, p.subject));
    }
    return true;
  });
}

function canUploadMaterial(user, cls, arm, subject, rows) {
  if (isCurriculumStaff(user.roles)) return true;
  if (!teacherScopeNeeded(user)) return false;
  return mySlotKeys(user, rows).has(slotKey(cls, arm, subject));
}

function getMaterialsFolder(orgId) {
  const props = PropertiesService.getScriptProperties();
  const key = 'MATERIALS_FOLDER_' + orgId;
  const existing = props.getProperty(key);
  if (existing) {
    try { return DriveApp.getFolderById(existing); } catch (e) { /* folder deleted: create a new one */ }
  }
  const folder = DriveApp.getRootFolder().createFolder('OKV SMS Materials - ' + orgId);
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  props.setProperty(key, folder.getId());
  return folder;
}

function handleUploadMaterial(body, user) {
  const { title, subject, class: cls, arm, topicId, schoolId, fileName, mimeType, dataBase64 } = body;
  if (!title || !subject || !cls || !fileName || !dataBase64) {
    return { ok: false, error: 'Title, subject, class and a file are required.' };
  }
  const ext = String(fileName).split('.').pop().toLowerCase();
  if (!MATERIAL_EXTENSIONS.includes(ext)) {
    return { ok: false, error: 'This file type is not allowed. Use PDF, Word, PowerPoint, Excel, Markdown (.md), text, CSV or image files.' };
  }
  const approxBytes = Math.floor(String(dataBase64).length * 3 / 4);
  if (approxBytes > MATERIAL_MAX_BYTES) {
    return { ok: false, error: 'This file is larger than 8 MB. Compress it, or split it into parts.' };
  }
  const rows = readRows(getSheet(DATA_SHEET, user.orgId), DATA_COLS);
  if (!canUploadMaterial(user, cls, arm, subject, rows)) {
    return { ok: false, error: 'You can only upload materials for the classes and subjects assigned to you.' };
  }
  const bytes = Utilities.base64Decode(String(dataBase64));
  const contentType = mimeType || 'application/octet-stream';
  const file = getMaterialsFolder(user.orgId).createFile(Utilities.newBlob(bytes, contentType, String(fileName)));
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const payload = {
    title: String(title), subject: String(subject), class: String(cls), arm: arm || '',
    topicId: topicId || '', schoolId: schoolId || '',
    fileName: String(fileName), mimeType: contentType, size: bytes.length,
    driveFileId: file.getId(),
    uploadedByUserId: user.userId, uploadedByName: user.fullName || user.username || '',
    uploadedAt: new Date().toISOString()
  };
  return withDataLock(() => {
    const sheet = getSheet(DATA_SHEET, user.orgId);
    const now = new Date().toISOString();
    const newId = 'rec_' + Utilities.getUuid().slice(0, 10);
    appendRow(sheet, DATA_COLS, {
      orgId: user.orgId, recordId: newId, ownerUserId: user.userId, type: 'material',
      payload: JSON.stringify(payload), createdAt: now, updatedAt: now
    });
    return { ok: true, recordId: newId };
  });
}

// Streams one file back to a user who is allowed to see that material (same rules as reading the records).
function handleDownloadMaterial(body, user) {
  const { recordId } = body;
  if (!recordId) return { ok: false, error: 'Missing material id' };
  const listed = handleGetData({ type: 'material' }, user);
  const rec = (listed.records || []).find(r => r.recordId === recordId);
  if (!rec) return { ok: false, error: 'This material is not available to you.' };
  const blob = DriveApp.getFileById(rec.payload.driveFileId).getBlob();
  return { ok: true, fileName: rec.payload.fileName, mimeType: blob.getContentType(), dataBase64: Utilities.base64Encode(blob.getBytes()) };
}

// Uploader or school staff may delete. The Drive file is moved to Trash, then the record is removed.
function handleDeleteMaterial(body, user) {
  const { recordId } = body;
  const found = withDataLock(() => {
    const sheet = getSheet(DATA_SHEET, user.orgId);
    const idx = findRowIndexById(sheet, recordId);
    const row = idx === -1 ? null : readRowAt(sheet, DATA_COLS, idx);
    if (!row || row.orgId !== user.orgId || row.type !== 'material') return { error: 'Material not found.' };
    if (!(isCurriculumStaff(user.roles) || row.ownerUserId === user.userId)) return { error: 'Only the uploader or school staff can delete this material.' };
    return { payload: safeParse(row.payload) };
  });
  if (found.error) return { ok: false, error: found.error };
  try { DriveApp.getFileById(found.payload.driveFileId).setTrashed(true); } catch (e) { /* already gone */ }
  return handleDeleteData({ recordId }, user);
}

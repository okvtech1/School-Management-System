/*******************************************************************
 * TENANCY / MULTI-SPREADSHEET INFRASTRUCTURE
 *
 * Architecture:
 *   - Every org ("tenant") gets its OWN Google Spreadsheet (Users + Data tabs),
 *     created automatically at signup via createTenantSpreadsheet().
 *   - ONE small MASTER spreadsheet holds two tabs ONLY:
 *       TenantRegistry — orgId, orgName, spreadsheetId, plan, billing dates,
 *                         and the cell-capacity snapshot (Super Admin oversight only).
 *       AuthIndex      — usernameLower/emailLower -> orgId, so login can find the
 *                         right tenant spreadsheet before it knows the orgId.
 *     The master spreadsheet ALSO doubles as the "tenant spreadsheet" for
 *     PLATFORM_ORG_ID (Victor/OKV Technology's own account), via its own
 *     Users/Data tabs, so no separate file is needed for that.
 *   - getSheet(name, orgId) in Code.gs resolves through getOrgSpreadsheet(orgId)
 *     below — never a hardcoded/active spreadsheet reference.
 *
 * ONE-TIME SETUP (see SETUP_GUIDE.md):
 *   1. Run `createDataSheet` (Code.gs) once. It creates the master data sheet in code.
 *   2. Run `createOwnerAccount` (Code.gs) once. It creates the owner login.
 *   3. If migrating from the old single-shared-spreadsheet version, run
 *      `runLegacyMigration` once.
 *   4. Run `setupCapacityMonitorTrigger` once to schedule the daily cell-usage check.
 *******************************************************************/

const TENANT_REGISTRY_SHEET = 'TenantRegistry';
const AUTH_INDEX_SHEET = 'AuthIndex';

const TENANT_REGISTRY_COLS = [
  'orgId', 'orgName', 'spreadsheetId', 'plan', 'billingCycle', 'createdAt',
  'cellsUsed', 'cellsPct', 'prevCellsUsed', 'prevCheckedAt', 'growthRowsPerDay',
  'estMonthsTo90', 'capacityStatus', 'capacityRecommendation', 'capacityLastChecked',
  // Added for attendance archiving/summarization (see ARCHIVING section below).
  'archiveSpreadsheetId', 'lastArchiveRunAt', 'lastArchiveRowsMoved', 'lastArchiveCellsReclaimed',
  // Added for longevity: every archive spreadsheet an org has (JSON list), and the last grid-trim result.
  'archiveVolumeIds', 'lastTrimAt', 'lastTrimCellsReclaimed'
];
const AUTH_INDEX_COLS = ['usernameLower', 'emailLower', 'orgId'];

const CELL_LIMIT = 10000000; // Google Sheets' hard per-file cell cap, summed across all tabs.
const CAPACITY_THRESHOLDS = { monitor: 70, action: 85 };

/* ============================== MASTER SPREADSHEET ============================== */

function getMasterSpreadsheetId() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('MASTER_SPREADSHEET_ID');
  if (!id) {
    const ss = SpreadsheetApp.create('OKV SMS — MASTER (Tenant Registry)');
    id = ss.getId();
    props.setProperty('MASTER_SPREADSHEET_ID', id);
    Logger.log('Created master spreadsheet: ' + ss.getUrl());
  }
  return id;
}

// Ensures the master spreadsheet exists with all four tabs it needs (TenantRegistry,
// AuthIndex, and — since the platform account lives here too — Users/Data). Safe to
// call repeatedly; only creates what's missing.
function initMasterSpreadsheet() {
  const ss = SpreadsheetApp.openById(getMasterSpreadsheetId());
  ensureSheetWithHeaders(ss, TENANT_REGISTRY_SHEET, TENANT_REGISTRY_COLS);
  ensureSheetWithHeaders(ss, AUTH_INDEX_SHEET, AUTH_INDEX_COLS);
  ensureSheetWithHeaders(ss, USERS_SHEET, USER_COLS);
  ensureSheetWithHeaders(ss, DATA_SHEET, DATA_COLS);
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  return ss;
}

function ensureSheetWithHeaders(ss, name, cols) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
    // A new tab starts as a 1000 x 26 grid, and Google counts EVERY grid cell (used or empty) toward the
    // 10-million-cell file limit. Our tabs use 7-25 columns, so trim the unused ones straight away.
    trimSheetGrid(sheet, cols.length, GRID_SPARE_ROWS);
  } else {
    // Column lists grow over time (e.g. TENANT_REGISTRY_COLS gained archiving fields) —
    // readRows/appendRow/updateRow all address columns by position, so an existing sheet
    // whose header row predates a new column still works correctly (old rows just read
    // '' for it); this only keeps the human-visible header row honest by appending any
    // missing labels at the end. It never reorders or removes existing headers.
    ensureHeaderColumns(sheet, cols);
  }
  return sheet;
}

function ensureHeaderColumns(sheet, cols) {
  // Trimmed grids have exactly as many columns as the schema, so a newly added column needs real room first.
  if (sheet.getMaxColumns() < cols.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), cols.length - sheet.getMaxColumns());
  }
  const lastCol = sheet.getLastColumn();
  if (lastCol < cols.length) {
    sheet.getRange(1, lastCol + 1, 1, cols.length - lastCol).setValues([cols.slice(lastCol)]);
  }
}

/* ============================== GRID TRIMMING (the biggest lifespan lever) ============================== */
/* Google Sheets' 10,000,000-cell cap counts the whole GRID of every tab (rows x columns, empty cells
   included), not just cells that hold data. A freshly created Data tab is 1000 x 26 but only uses 7
   columns, so 19 of every 26 cells were being spent on nothing: trimming gives each record roughly
   3.7x more room, which is a 3.7x longer life for the same school. */
const GRID_SPARE_ROWS = 100;

function trimSheetGrid(sheet, usedCols, spareRows) {
  const before = sheet.getMaxRows() * sheet.getMaxColumns();
  const maxCols = sheet.getMaxColumns();
  if (usedCols >= 1 && maxCols > usedCols) sheet.deleteColumns(usedCols + 1, maxCols - usedCols);
  // Keep the header row plus at least one editable row, and a small buffer of spare rows for new records.
  const keep = Math.max(2, sheet.getLastRow() + (spareRows == null ? GRID_SPARE_ROWS : spareRows));
  const maxRows = sheet.getMaxRows();
  if (maxRows > keep) sheet.deleteRows(keep + 1, maxRows - keep);
  return before - sheet.getMaxRows() * sheet.getMaxColumns();
}

// Total cells Google counts for one spreadsheet file: every tab's full grid.
function gridCellCount(ss) {
  let n = 0;
  ss.getSheets().forEach(sh => { n += sh.getMaxRows() * sh.getMaxColumns(); });
  return n;
}

// Trims one org's live tabs and every archive volume. Safe to run repeatedly (a no-op once trimmed).
function trimTenantGrids(orgId) {
  return withDataLock(() => {
    let reclaimed = 0;
    const ss = getOrgSpreadsheet(orgId);
    const users = ss.getSheetByName(USERS_SHEET), data = ss.getSheetByName(DATA_SHEET);
    if (users) reclaimed += trimSheetGrid(users, USER_COLS.length, 50);
    if (data) reclaimed += trimSheetGrid(data, DATA_COLS.length, GRID_SPARE_ROWS);
    listArchiveVolumes(orgId).forEach(id => {
      try {
        const sh = SpreadsheetApp.openById(id).getSheetByName(DATA_SHEET);
        if (sh) reclaimed += trimSheetGrid(sh, ARCHIVE_DATA_COLS.length, GRID_SPARE_ROWS);
      } catch (err) { /* an unreachable archive volume must not block the rest */ }
    });
    if (reclaimed > 0) updateTenantRegistryFields(orgId, { lastTrimAt: new Date().toISOString(), lastTrimCellsReclaimed: reclaimed });
    return { ok: true, orgId, reclaimedCells: reclaimed };
  }, 60000);
}

// Run ONCE from the Apps Script editor for existing schools (new ones are trimmed on creation), then
// the monthly job and the daily capacity check keep everything trimmed. Safe to re-run.
function trimAllTenantGrids() {
  const out = listTenantOrgIds().map(id => { try { return trimTenantGrids(id); } catch (err) { return { orgId: id, error: String(err) }; } });
  Logger.log(JSON.stringify(out));
  return out;
}

/* ============================== ORG -> SPREADSHEET RESOLUTION ============================== */
/* Central helper every getSheet() call in Code.gs goes through — orgId in, the right
   Spreadsheet object out. Cached per-execution since a single request often needs the
   same tenant's spreadsheet more than once. */

var _orgSpreadsheetCache = {};

function getOrgSpreadsheet(orgId) {
  if (_orgSpreadsheetCache[orgId]) return _orgSpreadsheetCache[orgId];
  const ss = (orgId === PLATFORM_ORG_ID)
    ? initMasterSpreadsheet()
    : SpreadsheetApp.openById(requireTenantSpreadsheetId(orgId));
  _orgSpreadsheetCache[orgId] = ss;
  return ss;
}

function requireTenantSpreadsheetId(orgId) {
  const id = lookupTenantSpreadsheetId(orgId);
  if (!id) throw new Error('Unknown org (not in TenantRegistry): ' + orgId);
  return id;
}

function lookupTenantSpreadsheetId(orgId) {
  const row = readTenantRegistry().find(r => r.orgId === orgId);
  return row ? row.spreadsheetId : null;
}

function readTenantRegistry() {
  const masterSs = SpreadsheetApp.openById(getMasterSpreadsheetId());
  const sheet = ensureSheetWithHeaders(masterSs, TENANT_REGISTRY_SHEET, TENANT_REGISTRY_COLS);
  return readRows(sheet, TENANT_REGISTRY_COLS);
}

function listTenantOrgIds() {
  return readTenantRegistry().map(r => r.orgId).filter(Boolean);
}

// Creates a brand-new tenant spreadsheet (Users + Data tabs) and registers it in the
// master TenantRegistry. Called from handleSignup, and from the legacy migration script.
function createTenantSpreadsheet(orgId, orgName, opts) {
  opts = opts || {};
  const ss = SpreadsheetApp.create(`${orgName} — OKV SMS Data`);
  ensureSheetWithHeaders(ss, USERS_SHEET, USER_COLS);
  ensureSheetWithHeaders(ss, DATA_SHEET, DATA_COLS);
  const def = ss.getSheetByName('Sheet1');
  if (def) ss.deleteSheet(def);

  const masterSs = SpreadsheetApp.openById(getMasterSpreadsheetId());
  const regSheet = ensureSheetWithHeaders(masterSs, TENANT_REGISTRY_SHEET, TENANT_REGISTRY_COLS);
  appendRow(regSheet, TENANT_REGISTRY_COLS, {
    orgId, orgName, spreadsheetId: ss.getId(),
    plan: opts.plan || '', billingCycle: opts.billingCycle || '',
    createdAt: new Date().toISOString(),
    cellsUsed: 0, cellsPct: 0, prevCellsUsed: 0, prevCheckedAt: '',
    growthRowsPerDay: 0, estMonthsTo90: '', capacityStatus: 'Healthy',
    capacityRecommendation: '', capacityLastChecked: ''
  });
  _orgSpreadsheetCache[orgId] = ss;
  return ss;
}

/* ============================== GLOBAL AUTH INDEX ============================== */
/* Login only has a username/email, not an orgId — this tiny master-sheet index is what
   lets it find the right tenant spreadsheet before anything else can happen. It holds
   no passwords or personal data beyond the identifiers needed to route a login. */

function authIndexSheet_() {
  const masterSs = SpreadsheetApp.openById(getMasterSpreadsheetId());
  return ensureSheetWithHeaders(masterSs, AUTH_INDEX_SHEET, AUTH_INDEX_COLS);
}

function authIndexFind(identifier) {
  const id = String(identifier || '').toLowerCase().trim();
  if (!id) return null;
  const rows = readRows(authIndexSheet_(), AUTH_INDEX_COLS);
  const row = rows.find(r => r.usernameLower === id || r.emailLower === id);
  return row ? row.orgId : null;
}

function authIndexAdd(username, email, orgId) {
  appendRow(authIndexSheet_(), AUTH_INDEX_COLS, {
    usernameLower: String(username || '').toLowerCase().trim(),
    emailLower: String(email || '').toLowerCase().trim(),
    orgId
  });
}

function authIndexRemove(username, email) {
  const sheet = authIndexSheet_();
  const rows = readRows(sheet, AUTH_INDEX_COLS);
  const uname = String(username || '').toLowerCase().trim();
  const idx = rows.findIndex(r => r.usernameLower === uname);
  if (idx !== -1) sheet.deleteRow(idx + 2);
}

/* ============================== SESSION / RESET TOKENS ============================== */
/* Tokens are minted as "<orgId>::<random>" so resolving one is a direct lookup in that
   org's own spreadsheet, not a scan across every tenant. The random half still has to
   match exactly, so this changes routing only, not security. */

function makeSessionToken(orgId) {
  return orgId + '::tok_' + Utilities.getUuid();
}
function makeResetToken(orgId) {
  return orgId + '::rst_' + Utilities.getUuid().replace(/-/g, '');
}

/* ============================== CELL-CAPACITY MONITORING ============================== */
/* Runs on a daily time-based trigger (see setupCapacityMonitorTrigger), NOT on every page
   load. Writes results back onto the TenantRegistry row for each org; surfaced ONLY on the
   Super Admin dashboard via handlePlatformListOrgs (Code.gs) — org Admins/Users never see
   this. Thresholds: 70% = "Monitor", 85%+ = "Action Needed" (also triggers an email alert
   to OWNER_EMAIL). */

function checkAllTenantCapacity() {
  const masterSs = SpreadsheetApp.openById(getMasterSpreadsheetId());
  const regSheet = ensureSheetWithHeaders(masterSs, TENANT_REGISTRY_SHEET, TENANT_REGISTRY_COLS);
  const rows = readRows(regSheet, TENANT_REGISTRY_COLS);
  const nowIso = new Date().toISOString();
  const flagged = [];

  rows.forEach((reg, idx) => {
    if (!reg.spreadsheetId) return;
    let ss;
    try { ss = SpreadsheetApp.openById(reg.spreadsheetId); } catch (err) { return; } // unreachable — skip, don't block the rest

    // Trim first (a no-op once done), then count what Google counts: the whole grid of every tab, live file AND archive volumes.
    try { trimTenantGrids(reg.orgId); } catch (err) { /* best-effort */ }
    let totalCells = gridCellCount(ss);
    const pct = Math.round((totalCells / CELL_LIMIT) * 10000) / 100;

    // Growth rate: cells added since the last check, converted to a per-day rate. On the
    // very first check there's nothing to compare against, so growth/ETA stay blank.
    const prevCells = Number(reg.prevCellsUsed || 0);
    const prevAt = reg.prevCheckedAt ? new Date(reg.prevCheckedAt) : null;
    let growthPerDay = Number(reg.growthRowsPerDay || 0);
    if (prevAt && totalCells > prevCells) {
      const daysElapsed = Math.max(1, (Date.now() - prevAt.getTime()) / (24 * 60 * 60 * 1000));
      growthPerDay = Math.round(((totalCells - prevCells) / daysElapsed) * 100) / 100;
    }
    let estMonths = '';
    if (growthPerDay > 0) {
      const cellsTo90 = (CELL_LIMIT * 0.9) - totalCells;
      estMonths = cellsTo90 <= 0 ? 0 : Math.round((cellsTo90 / growthPerDay / 30) * 10) / 10;
    }

    let status = 'Healthy', recommendation = '';
    if (pct >= CAPACITY_THRESHOLDS.action) {
      status = 'Action Needed';
      recommendation = 'Run the archive job now (archiveOldRecordsMonthly) and, if it stays high, shorten the archive cut-off days in ARCHIVE_RULES or split the school into branches.';
    } else if (pct >= CAPACITY_THRESHOLDS.monitor) {
      status = 'Monitor';
      recommendation = 'Keep an eye on growth and plan an archiving strategy before this reaches 85%.';
    }

    updateRow(regSheet, TENANT_REGISTRY_COLS, idx, {
      cellsUsed: totalCells, cellsPct: pct,
      prevCellsUsed: totalCells, prevCheckedAt: nowIso,
      growthRowsPerDay: growthPerDay, estMonthsTo90: estMonths,
      capacityStatus: status, capacityRecommendation: recommendation, capacityLastChecked: nowIso
    });

    if (status === 'Action Needed') flagged.push({ orgName: reg.orgName || reg.orgId, pct, estMonths });
  });

  if (flagged.length) {
    try {
      MailApp.sendEmail(platformEmailOptions({
        to: OWNER_EMAIL,
        subject: `${APP_NAME} — ${flagged.length} tenant(s) need capacity action`,
        htmlBody: '<p>The following organizations have crossed 85% of their spreadsheet cell limit:</p><ul>' +
          flagged.map(f => `<li>${escapeHtml(String(f.orgName))} — ${f.pct}% used${f.estMonths !== '' ? `, ~${f.estMonths} month(s) to 90%` : ''}</li>`).join('') +
          '</ul><p>Review on the Super Admin dashboard.</p>'
      }));
    } catch (err) { /* best-effort */ }
  }
}

// Run ONCE from the Apps Script editor to schedule the daily check (~2am). Safe to re-run
// — it clears any existing trigger on this function first, so it never double-schedules.
function setupCapacityMonitorTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'checkAllTenantCapacity') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAllTenantCapacity').timeBased().everyDays(1).atHour(2).create();
  Logger.log('Daily capacity-check trigger installed (runs ~2am server time).');
}

/* ============================== ONE-TIME MIGRATION ============================== */
/* Moves an existing single-shared-spreadsheet setup (every org's rows mixed together in
   one Users/Data tab, tagged by orgId) into the new per-tenant-spreadsheet structure.
   Run manually, once, from the Apps Script editor — safe to re-run, since orgs already
   present in the TenantRegistry are skipped. */

function migrateLegacySingleSheetToPerTenant(legacySpreadsheetId) {
  const legacySs = SpreadsheetApp.openById(legacySpreadsheetId);
  const legacyUsers = legacySs.getSheetByName(USERS_SHEET);
  const legacyData = legacySs.getSheetByName(DATA_SHEET);
  if (!legacyUsers) throw new Error('Legacy spreadsheet has no "Users" tab — wrong spreadsheet ID?');

  const allUsers = readRows(legacyUsers, USER_COLS);
  const allData = legacyData ? readRows(legacyData, DATA_COLS) : [];
  const existingOrgIds = new Set(listTenantOrgIds());

  const orgIds = [...new Set(allUsers.map(u => u.orgId))].filter(id => id && id !== PLATFORM_ORG_ID);
  let migratedCount = 0;

  orgIds.forEach(orgId => {
    if (existingOrgIds.has(orgId)) { Logger.log('Skipping ' + orgId + ' — already migrated.'); return; }
    const orgUsers = allUsers.filter(u => u.orgId === orgId);
    const billingRow = orgUsers.find(u => rolesToArray(u.roles).includes('Super Administrator')) || orgUsers[0];
    const orgName = billingRow.orgName || orgId;

    const ss = createTenantSpreadsheet(orgId, orgName, { plan: billingRow.plan, billingCycle: billingRow.billingCycle });
    const usersSheet = ss.getSheetByName(USERS_SHEET);
    orgUsers.forEach(u => {
      appendRow(usersSheet, USER_COLS, u);
      authIndexAdd(u.username, u.email, orgId);
    });

    const orgData = allData.filter(d => d.orgId === orgId);
    if (orgData.length) {
      const dataSheet = ss.getSheetByName(DATA_SHEET);
      orgData.forEach(d => appendRow(dataSheet, DATA_COLS, d));
    }
    migratedCount++;
    Logger.log(`Migrated ${orgId} (${orgName}) — ${orgUsers.length} users, ${orgData.length} data records.`);
  });

  // The platform's own account/data moves into the master spreadsheet, its permanent home.
  const platformUsers = allUsers.filter(u => u.orgId === PLATFORM_ORG_ID);
  if (platformUsers.length) {
    const masterSs = initMasterSpreadsheet();
    const platUsersSheet = masterSs.getSheetByName(USERS_SHEET);
    const existingPlatUserIds = new Set(readRows(platUsersSheet, USER_COLS).map(u => u.userId));
    platformUsers.forEach(u => {
      if (!existingPlatUserIds.has(u.userId)) {
        appendRow(platUsersSheet, USER_COLS, u);
        authIndexAdd(u.username, u.email, PLATFORM_ORG_ID);
      }
    });
    const platData = allData.filter(d => d.orgId === PLATFORM_ORG_ID);
    if (platData.length) {
      const platDataSheet = masterSs.getSheetByName(DATA_SHEET);
      const existingIds = new Set(readRows(platDataSheet, DATA_COLS).map(d => d.recordId));
      platData.forEach(d => { if (!existingIds.has(d.recordId)) appendRow(platDataSheet, DATA_COLS, d); });
    }
  }

  Logger.log(`Migration complete. ${migratedCount} org(s) moved into their own spreadsheet.`);
}

// Convenience wrapper so the editor's Run button (which can't pass arguments) works:
// defaults to the LEGACY_SPREADSHEET_ID script property, or this script's own bound
// spreadsheet if that property isn't set (i.e. you're running it from the original
// project, which is still bound to the old shared spreadsheet).
function runLegacyMigration() {
  const legacyId = PropertiesService.getScriptProperties().getProperty('LEGACY_SPREADSHEET_ID')
    || SpreadsheetApp.getActiveSpreadsheet().getId();
  migrateLegacySingleSheetToPerTenant(legacyId);
}

/*******************************************************************
 * ATTENDANCE ARCHIVING & SUMMARIZATION
 *
 * Design note (reads before the code, since it deliberately differs slightly from a
 * literal "one row per student per day" scheme):
 *
 * Attendance is stored as ONE `attendance` Data record per CLASS per DAY — not one per
 * student per day — with a payload shaped { classArm, date, term, session,
 * statuses: { studentId: 'present'|'absent'|'late' }, markedBy }. For a 40-student class
 * this is already a ~40x reduction in rows/cells over a naive per-student-per-day design,
 * with zero loss of resolution: every student's status on every day is still individually
 * recorded, just packed into one row's JSON payload instead of exploding into many rows.
 *
 * On top of that per-day (per-class) record, `handleMarkAttendance` (Code.gs) maintains one
 * `attendanceSummary` record per student per term — presentCount/absentCount/lateCount/
 * totalDays — updated incrementally by diffing against whatever was previously recorded for
 * that class+date (so re-marking or correcting a day adjusts the counts instead of double-
 * counting). This summary is what powers "182/190 days present" queries without ever
 * scanning the day-by-day rows.
 *
 * "Attendance mode" (a per-org Settings field, `attendanceMode`: 'summary' | 'detailed',
 * default 'summary') controls ONLY how long the per-day `attendance` rows are kept live
 * before archiving — the summary is always maintained either way, since it's cheap and
 * always useful:
 *   - 'summary'  — once a term is well past (see ARCHIVE_RULES below), its per-day rows
 *                  are archived quickly. The durable "X/Y days present" figure is already
 *                  safe in attendanceSummary, so there's little reason to keep the day-by-
 *                  day rows live long-term.
 *   - 'detailed' — per-day rows are kept live for the full default cutoff (~2 academic
 *                  years), for schools that want day-level drill-down available for audits
 *                  or dispute resolution well after the fact.
 * Either way, nothing is ever deleted outright — old rows move to that tenant's own Archive
 * spreadsheet, and stay readable there indefinitely via handleGetArchivedRecords.
 *******************************************************************/

const ARCHIVE_DATA_COLS = DATA_COLS.concat(['archivedAt']);

// Which Data record types are eligible for archiving, and after how long. Add future
// high-frequency types (e.g. a staff clock-in log) here the same way.
const ARCHIVE_RULES = {
  attendance:           { defaultCutoffDays: 730,     // ~2 academic years — used in 'detailed' attendance mode
                          summaryModeCutoffDays: 120 },// ~1 term past — used in 'summary' attendance mode
  // Old academic history. Never touches the org's CURRENT session, however old the row looks.
  score:                { defaultCutoffDays: 730, protectCurrentSession: true },
  studentTermInfo:      { defaultCutoffDays: 730, protectCurrentSession: true },
  resultPasscode:       { defaultCutoffDays: 730, protectCurrentSession: true },   // old terms' passcodes; still readable from the archive
  studentPromotion:     { defaultCutoffDays: 730 },                                 // promotion/repeat history
  announcement:         { defaultCutoffDays: 365 },
  // Coursework and tests move together with their submissions (see selectArchiveCandidates):
  // a submission only archives once its parent assignment/test is archived (or gone), otherwise an
  // old assignment would reappear to a student as "not yet submitted".
  assignment:           { defaultCutoffDays: 180 },
  cbtTest:              { defaultCutoffDays: 180 },
  assignmentSubmission: { defaultCutoffDays: 180, parentType: 'assignment', parentKey: 'assignmentId' },
  cbtSubmission:        { defaultCutoffDays: 180, parentType: 'cbtTest',    parentKey: 'testId' }
};

// Milliseconds for a stored timestamp (ISO string, or Sheets' Date-to-string form). 0 if unreadable.
function archiveTimeMs(v) {
  const n = new Date(v).getTime();
  return isNaN(n) ? 0 : n;
}

/* PURE function (no Sheet access) so it can be unit-tested: given every raw row of an org's Data
   tab, returns the array indices of rows that should move to the archive right now. */
function selectArchiveCandidates(rows, settings, nowMs) {
  settings = settings || {};
  const attendanceMode = settings.attendanceMode === 'detailed' ? 'detailed' : 'summary';
  const DAY = 24 * 60 * 60 * 1000;

  // Every live parent (assignment / test) and which of them are old enough to archive.
  const liveParents = {};      // recordId -> true, for assignment + cbtTest rows present in the live sheet
  const eligibleParents = {};  // recordId -> true, parents that are themselves archivable right now
  const ageEligible = (r, rule) => {
    const ref = Math.max(archiveTimeMs(r.createdAt), archiveTimeMs(r.updatedAt));
    if (!ref) return false; // malformed/blank timestamps — skip rather than risk mis-archiving
    const cutoffDays = (r.type === 'attendance' && attendanceMode === 'summary') ? rule.summaryModeCutoffDays : rule.defaultCutoffDays;
    return ((nowMs - ref) / DAY) > cutoffDays;
  };

  rows.forEach(r => {
    if (r.type === 'assignment' || r.type === 'cbtTest') {
      liveParents[r.recordId] = true;
      if (ageEligible(r, ARCHIVE_RULES[r.type])) eligibleParents[r.recordId] = true;
    }
  });

  const picked = [];
  rows.forEach((r, idx) => {
    const rule = ARCHIVE_RULES[r.type];
    if (!rule) return;
    if (!ageEligible(r, rule)) return;
    if (rule.protectCurrentSession && settings.currentSession) {
      const p = safeParse(r.payload);
      if (p.session && String(p.session) === String(settings.currentSession)) return;
    }
    if (rule.parentType) {
      const parentId = safeParse(r.payload)[rule.parentKey];
      // Only archive once the parent is archivable now, or is no longer in the live sheet at all.
      if (parentId && liveParents[parentId] && !eligibleParents[parentId]) return;
    }
    picked.push(idx);
  });
  return picked;
}

// Groups sorted row indices into contiguous blocks so they can be deleted with a few
// deleteRows() calls instead of one slow deleteRow() per record.
function contiguousBlocks(indices) {
  const sorted = indices.slice().sort((a, b) => a - b);
  const blocks = [];
  sorted.forEach(i => {
    const last = blocks[blocks.length - 1];
    if (last && i === last.start + last.count) last.count++;
    else blocks.push({ start: i, count: 1 });
  });
  return blocks;
}

// Deletes the given (0-based data-row) indices from a sheet, bottom-up, in contiguous blocks.
function deleteRowIndices(sheet, indices) {
  contiguousBlocks(indices).reverse().forEach(b => sheet.deleteRows(b.start + 2, b.count));
}

// Writes many rows in one call (appendRow per row is far too slow at archive volumes).
function appendRowsBatch(sheet, cols, dataArr) {
  if (!dataArr.length) return;
  const start = sheet.getLastRow() + 1;
  const needed = start + dataArr.length - 1;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  const matrix = dataArr.map(d => cols.map(c => d[c] !== undefined ? d[c] : ''));
  sheet.getRange(start, 1, matrix.length, cols.length).setValues(matrix);
}

// Serialises data-changing work across concurrent requests and scheduled jobs, so a row index
// read by one request can never be shifted by another request's delete. Returns an error
// object (never throws) if the lock can't be obtained in time.
function withDataLock(fn, waitMs) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(waitMs || 20000); }
  catch (e) { return { ok: false, error: 'The server is busy right now. Please try again in a moment.' }; }
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ---------- Per-org archive spreadsheet ---------- */

/* An org's archive can span several spreadsheets ("volumes"), so it never hits the 10M-cell file cap.
   `archiveSpreadsheetId` always names the CURRENT volume (the one being written); `archiveVolumeIds`
   lists all of them, oldest first. Reads look at every volume. */
const ARCHIVE_ROLL_AT = 0.9;   // start a new volume when the current one would pass 90% of the cell cap

function listArchiveVolumes(orgId) {
  const reg = readTenantRegistry().find(r => r.orgId === orgId);
  if (!reg) return [];
  let ids = [];
  try { ids = JSON.parse(reg.archiveVolumeIds || '[]'); } catch (e) { ids = []; }
  if (reg.archiveSpreadsheetId && ids.indexOf(reg.archiveSpreadsheetId) === -1) ids.push(reg.archiveSpreadsheetId);
  return ids.filter(Boolean);
}

// PURE decision helper (unit-tested): should the next archive write go to a fresh volume?
function shouldRollArchive(currentGridCells, incomingRows, colsPerRow) {
  return currentGridCells + incomingRows * colsPerRow > CELL_LIMIT * ARCHIVE_ROLL_AT;
}

function createArchiveVolume(orgId, volumeNumber) {
  const reg = readTenantRegistry().find(r => r.orgId === orgId);
  const label = (reg && reg.orgName) || orgId;
  const ss = SpreadsheetApp.create(`${label} — OKV SMS Archive${volumeNumber > 1 ? ' (vol ' + volumeNumber + ')' : ''}`);
  ensureSheetWithHeaders(ss, DATA_SHEET, ARCHIVE_DATA_COLS);
  const def = ss.getSheetByName('Sheet1');
  if (def) ss.deleteSheet(def);
  const ids = listArchiveVolumes(orgId); ids.push(ss.getId());
  updateTenantRegistryFields(orgId, { archiveSpreadsheetId: ss.getId(), archiveVolumeIds: JSON.stringify(ids) });
  return ss;
}

// The CURRENT archive volume (created on first use when createIfMissing).
function getOrgArchiveSpreadsheet(orgId, createIfMissing) {
  const reg = readTenantRegistry().find(r => r.orgId === orgId);
  if (reg && reg.archiveSpreadsheetId) {
    try { return SpreadsheetApp.openById(reg.archiveSpreadsheetId); } catch (err) { /* fall through to recreate below */ }
  }
  if (!createIfMissing) return null;
  return createArchiveVolume(orgId, listArchiveVolumes(orgId).length + 1);
}

// The volume a batch of `incomingRows` should be written to — rolls over to a new one when the current is nearly full.
function getArchiveWriteTarget(orgId, incomingRows) {
  let ss = getOrgArchiveSpreadsheet(orgId, true);
  if (shouldRollArchive(gridCellCount(ss), incomingRows, ARCHIVE_DATA_COLS.length)) {
    ss = createArchiveVolume(orgId, listArchiveVolumes(orgId).length + 1);
  }
  return ss;
}

// Small, generic "patch a few fields on this org's TenantRegistry row" helper — used only
// by the archiving code below. Deliberately separate from checkAllTenantCapacity's own
// direct updateRow call so that function is left exactly as it was.
function updateTenantRegistryFields(orgId, fields) {
  const masterSs = SpreadsheetApp.openById(getMasterSpreadsheetId());
  const regSheet = ensureSheetWithHeaders(masterSs, TENANT_REGISTRY_SHEET, TENANT_REGISTRY_COLS);
  const rows = readRows(regSheet, TENANT_REGISTRY_COLS);
  const idx = rows.findIndex(r => r.orgId === orgId);
  if (idx !== -1) updateRow(regSheet, TENANT_REGISTRY_COLS, idx, fields);
}

// Reads an org's Settings record directly (server-side, no session) — used only so the
// scheduled archive job can see that org's attendanceMode/archivingEnabled preference.
function readOrgSettingsDirect(orgId) {
  try {
    const rows = readRows(getSheet(DATA_SHEET, orgId), DATA_COLS).filter(r => r.type === 'settings');
    if (!rows.length) return {};
    rows.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return safeParse(rows[0].payload);
  } catch (err) { return {}; }
}

// Writes a small patch into an org's Settings record directly (server-side, no session) —
// used only to record bookkeeping like "which term's summary email was already sent", so
// scheduled jobs never depend on a logged-in session to persist their own state.
function updateOrgSettingsDirect(orgId, patch) {
  try {
    const sheet = getSheet(DATA_SHEET, orgId);
    const rows = readRows(sheet, DATA_COLS);
    const idx = rows.findIndex(r => r.type === 'settings');
    const nowIso = new Date().toISOString();
    if (idx === -1) {
      appendRow(sheet, DATA_COLS, {
        orgId, recordId: 'rec_' + Utilities.getUuid().slice(0, 10), ownerUserId: '',
        type: 'settings', payload: JSON.stringify(patch), createdAt: nowIso, updatedAt: nowIso
      });
    } else {
      const merged = Object.assign({}, safeParse(rows[idx].payload), patch);
      updateRow(sheet, DATA_COLS, idx, { payload: JSON.stringify(merged), updatedAt: nowIso });
    }
  } catch (err) { /* best-effort — a failed bookkeeping write shouldn't crash the caller */ }
}

/* ---------- Archiving itself ---------- */

// dryRun defaults to true — this is deliberate: run it as-is first, review the Logger
// output (and the returned summary), and only pass `false` once you're confident it's
// picking the right rows, per the "verify before it deletes anything" requirement.
function archiveOldRecords(dryRun) {
  dryRun = dryRun !== false;
  const results = listTenantOrgIds().map(orgId => {
    try { return archiveOldRecordsForOrg(orgId, dryRun); }
    catch (err) { return { orgId, error: String(err) }; }
  });
  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function archiveOldRecordsForOrg(orgId, dryRun) {
  const settings = readOrgSettingsDirect(orgId);
  if (settings.archivingEnabled === false) return { orgId, skipped: 'archiving disabled for this org' };
  const attendanceMode = settings.attendanceMode === 'detailed' ? 'detailed' : 'summary';

  const run = () => {
    const liveSheet = getSheet(DATA_SHEET, orgId);
    const rows = readRows(liveSheet, DATA_COLS);
    const picked = selectArchiveCandidates(rows, settings, Date.now());
    const byType = {};
    picked.forEach(i => { byType[rows[i].type] = (byType[rows[i].type] || 0) + 1; });

    if (!picked.length) return { orgId, attendanceMode, moved: 0, cellsReclaimed: 0, byType, dryRun };
    const cellsReclaimed = picked.length * DATA_COLS.length;
    if (dryRun) return { orgId, attendanceMode, dryRun: true, wouldMove: picked.length, wouldReclaimCells: cellsReclaimed, byType };

    // Skip anything already in ANY archive volume (a previous run may have copied rows and then timed out
    // before deleting them) so a retry never creates duplicates.
    const already = {};
    listArchiveVolumes(orgId).forEach(id => {
      try {
        const sh = SpreadsheetApp.openById(id).getSheetByName(DATA_SHEET);
        const last = sh ? sh.getLastRow() : 0;
        if (last >= 2) sh.getRange(2, 2, last - 1, 1).getValues().forEach(r => { already[String(r[0])] = true; });
      } catch (err) { /* unreachable volume: skip */ }
    });
    const nowIso = new Date().toISOString();
    const willWrite = picked.filter(i => !already[rows[i].recordId]).length;
    const archiveSs = getArchiveWriteTarget(orgId, willWrite);
    const archiveSheet = archiveSs.getSheetByName(DATA_SHEET);

    const toWrite = picked.filter(i => !already[rows[i].recordId]).map(i => Object.assign({}, rows[i], { archivedAt: nowIso }));
    const before = archiveSheet.getLastRow();
    appendRowsBatch(archiveSheet, ARCHIVE_DATA_COLS, toWrite);
    // Only delete from the live sheet once the archive copy is confirmed written.
    if (archiveSheet.getLastRow() < before + toWrite.length) throw new Error('Archive write could not be verified; nothing was deleted.');
    deleteRowIndices(liveSheet, picked);

    updateTenantRegistryFields(orgId, {
      lastArchiveRunAt: nowIso, lastArchiveRowsMoved: picked.length, lastArchiveCellsReclaimed: cellsReclaimed
    });
    return { orgId, attendanceMode, dryRun: false, moved: picked.length, cellsReclaimed, byType };
  };

  const res = withDataLock(run, 60000);
  return res.ok === false ? { orgId, error: res.error } : res;
}

// Run manually from the Apps Script editor any time to preview what a real run would do —
// logs and returns the per-org summary without touching any sheet.
function archiveOldRecordsDryRun() { return archiveOldRecords(true); }

// The function the monthly trigger actually calls. Only wire this up (via
// setupArchiveTrigger) once you've reviewed archiveOldRecordsDryRun's output and are
// confident it's correct for your data.
function archiveOldRecordsMonthly() { archiveOldRecords(false); }

function setupArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'archiveOldRecordsMonthly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('archiveOldRecordsMonthly').timeBased().onMonthDay(1).atHour(3).create();
  Logger.log('Monthly archive trigger installed (runs ~3am on the 1st of each month).');
}

/* ---------- Read-only access to archived data ---------- */

function readArchiveVolumes(orgId) {
  const out = [];
  listArchiveVolumes(orgId).forEach(id => {
    try {
      const sheet = SpreadsheetApp.openById(id).getSheetByName(DATA_SHEET);
      if (sheet) out.push({ sheet, rows: readRows(sheet, ARCHIVE_DATA_COLS) });
    } catch (err) { /* unreachable volume: skip */ }
  });
  return out;
}

// Admin-only: read archived records (optionally one type) across every archive volume.
function handleGetArchivedRecords(body, admin) {
  const { type } = body;
  const records = [];
  readArchiveVolumes(admin.orgId).forEach(v => v.rows.forEach(r => {
    if (r.orgId !== admin.orgId || (type && r.type !== type)) return;
    records.push({ recordId: r.recordId, type: r.type, payload: safeParse(r.payload), createdAt: r.createdAt, updatedAt: r.updatedAt, archivedAt: r.archivedAt });
  }));
  return { ok: true, records };
}

/* ---------- Archive summary, restore, and read-only access for public result checks ---------- */

// Kept for older callers: every archived row, all volumes merged.
function readArchiveRowsIfAny(orgId) {
  const vols = readArchiveVolumes(orgId);
  return { sheet: vols.length ? vols[0].sheet : null, rows: vols.reduce((all, v) => all.concat(v.rows), []) };
}

// Public result checks (and the yearly sheet) must still work for a student whose older terms have been
// archived, so those lookups read the archived score/term-info/passcode rows as well, read-only.
function withArchivedResultRows(orgId, rows) {
  try {
    const arch = readArchiveRowsIfAny(orgId).rows.filter(r => r.orgId === orgId && (r.type === 'score' || r.type === 'studentTermInfo' || r.type === 'resultPasscode'));
    return arch.length ? rows.concat(arch) : rows;
  } catch (err) { return rows; }
}

// Admin-only: what is sitting in the archive, by record type (and by session where records carry one).
function handleGetArchiveSummary(body, admin) {
  const byType = {};
  let total = 0, volumes = 0;
  readArchiveVolumes(admin.orgId).forEach(v => {
    volumes++;
    v.rows.filter(r => r.orgId === admin.orgId).forEach(r => {
      total++;
      const e = byType[r.type] || (byType[r.type] = { count: 0, sessions: {} });
      e.count++;
      const s = safeParse(r.payload).session;
      if (s) e.sessions[s] = (e.sessions[s] || 0) + 1;
    });
  });
  return { ok: true, total, volumes, byType, rules: ARCHIVE_RULES };
}

// Admin-only: move archived records back into the live sheet (for example to reopen an old term's
// results for editing). Restored rows get a fresh updatedAt, so they stay live for another full
// cutoff period and every device picks them up on its next incremental sync.
function handleRestoreArchived(body, admin) {
  const type = body.type;
  const session = body.session || '';
  if (!type || !ARCHIVE_RULES[type]) return { ok: false, error: 'Choose a record type to restore.' };
  return withDataLock(() => {
    const vols = readArchiveVolumes(admin.orgId);
    const nowIso = new Date().toISOString();
    const liveSheet = getSheet(DATA_SHEET, admin.orgId);
    const existing = {};
    const liveLast = liveSheet.getLastRow();
    if (liveLast >= 2) liveSheet.getRange(2, 2, liveLast - 1, 1).getValues().forEach(r => { existing[String(r[0])] = true; });
    let restored = 0;
    vols.forEach(v => {
      const idxs = [];
      v.rows.forEach((r, i) => {
        if (r.orgId !== admin.orgId || r.type !== type) return;
        if (session && String(safeParse(r.payload).session || '') !== String(session)) return;
        idxs.push(i);
      });
      if (!idxs.length) return;
      const toLive = idxs.filter(i => !existing[v.rows[i].recordId]).map(i => Object.assign({}, v.rows[i], { updatedAt: nowIso }));
      appendRowsBatch(liveSheet, DATA_COLS, toLive);
      deleteRowIndices(v.sheet, idxs);
      restored += idxs.length;
    });
    return { ok: true, restored };
  }, 60000);
}

// One-stop maintenance you can run by hand any time (Apps Script editor): trims empty grid space, archives
// old records for every school, then refreshes the capacity report. The scheduled jobs do the same things.
function runMaintenanceNow() {
  const trimmed = trimAllTenantGrids();
  const archived = archiveOldRecords(false);
  checkAllTenantCapacity();
  Logger.log(JSON.stringify({ trimmed, archived }));
}

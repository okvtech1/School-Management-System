/*******************************************************************
 * SMS DASHBOARD METRICS — turns the records already cached on the device into the numbers and chart
 * specs shown on each role's Home tab. Pure functions (no DOM, no network), so every figure can be unit
 * tested, and so the dashboard still works offline.
 *
 *   smsMetrics.build({ roles, userId, plan, now, settings, data, attendance })
 *     -> { kpis:[{id, icon, tone, value, label, sub, go}], charts:[{id, title, subtitle, type, spec, go}] }
 *
 * data = { student, staff, feePayment, feeRecord, score, expense, incomeRecord, cbtTest, cbtSubmission,
 *          assignment, assignmentSubmission, announcement, timetableEntry, classTeacher, subjectAssignment }
 *        each an array of { recordId, payload, createdAt, updatedAt }  (missing types are treated as empty)
 * attendance = array of attendance summaries { studentId, classArm:'JSS2|A', presentCount, lateCount, absentCount, totalDays }
 *              or null when it could not be loaded (offline).
 *******************************************************************/
(function(root){
  const ROLE_KEY = {
    'Super Administrator':'admin', 'School Administrator':'admin', 'Principal / Head Teacher':'principal',
    'Academic Officer / Exam Officer':'exam', 'Teacher':'teacher', 'Bursar / Accountant':'bursar',
    'Result Viewer / Parent Portal User':'viewer'
  };
  const ROLE_ORDER = ['admin','principal','exam','bursar','teacher','viewer'];
  const TERMS = ['First Term','Second Term','Third Term'];
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const sum = a => a.reduce((s, v) => s + num(v), 0);
  const avg = a => a.length ? sum(a) / a.length : 0;
  const round1 = n => Math.round(n * 10) / 10;
  const moneyFull = n => '₦' + Math.round(num(n)).toLocaleString();
  // Full amounts up to 9,999,999 (fits a KPI card); millions and billions are abbreviated.
  const money = n => {
    n = num(n); const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '₦' + (a / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e7) return s + '₦' + (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    return s + '₦' + Math.round(a).toLocaleString();
  };
  const pctFmt = n => round1(n) + '%';

  // Grade bands per grading method (Settings → Grading Method). Mirrors results-lib.js — keep the two in step.
  const GRADE_BANDS = {
    AF:   [[70,'A'],[60,'B'],[50,'C'],[45,'D'],[40,'E'],[0,'F']],
    WAEC: [[75,'A1'],[70,'B2'],[65,'B3'],[60,'C4'],[55,'C5'],[50,'C6'],[45,'D7'],[40,'E8'],[0,'F9']]
  };
  const GRADE_COLORS = { A:'#1E6B3A', B:'#2F8F6B', C:'#C9A227', D:'#E08A1E', E:'#C0502F', F:'#8B1E3F' };
  function gradeFor(total, method){
    const t = num(total);
    const bands = GRADE_BANDS[method === 'WAEC' ? 'WAEC' : 'AF'];
    const b = bands.find(x => t >= x[0]) || bands[bands.length - 1];
    return b[1];
  }
  function scoreTotal(p){
    if (p.total !== undefined && p.total !== null && p.total !== '') return num(p.total);
    return sum(p.ca || []) + num(p.exam);
  }

  // The last n calendar months ending at `now`, oldest first: [{key:'2026-04', label:'Apr'}]
  function monthsBack(n, now){
    const out = []; const d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push({ key: m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'), label: MONTH_NAMES[m.getMonth()] });
    }
    return out;
  }
  const ymOf = s => { const t = String(s || ''); return /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : ''; };
  function countByMonth(rows, getDate, months){
    const m = {}; months.forEach(x => m[x.key] = 0);
    rows.forEach(r => { const k = ymOf(getDate(r)); if (k in m) m[k]++; });
    return months.map(x => m[x.key]);
  }
  function sumByMonth(rows, getDate, getVal, months){
    const m = {}; months.forEach(x => m[x.key] = 0);
    rows.forEach(r => { const k = ymOf(getDate(r)); if (k in m) m[k] += num(getVal(r)); });
    return months.map(x => m[x.key]);
  }

  function build(ctx){
    const now = ctx.now || new Date();
    const settings = ctx.settings || {};
    const gMethod = settings.gradingMethod === 'WAEC' ? 'WAEC' : 'AF';
    const gKeys = GRADE_BANDS[gMethod].map(b => b[1]);
    const D = ctx.data || {};
    const get = t => D[t] || [];
    const keys = Array.from(new Set((ctx.roles || []).map(r => ROLE_KEY[r]).filter(Boolean)));
    const has = k => keys.includes(k);
    const userId = ctx.userId;
    const premium = ctx.plan === 'premium';
    const term = settings.currentTerm, session = settings.currentSession;
    const classOrder = settings.classes || [];

    const students = get('student'), activeStudents = students.filter(s => s.payload.active !== false);
    const studentById = {}; students.forEach(s => studentById[s.recordId] = s);
    const classIdx = c => { const i = classOrder.indexOf(c); return i === -1 ? 999 : i; };
    const pairLabel = (c, a) => (c + ' ' + (a || '')).trim();

    /* ----- teacher scoping ----- */
    const myAssign = get('classTeacher').concat(get('subjectAssignment')).filter(r => r.payload.teacherUserId === userId);
    const myPairs = new Set(myAssign.map(r => (r.payload.class || '') + '|' + (r.payload.arm || '')));
    const mySubjectKeys = new Set(get('subjectAssignment').filter(r => r.payload.teacherUserId === userId).map(r => (r.payload.class || '') + '|' + (r.payload.arm || '') + '|' + r.payload.subject));

    /* ----- scores ----- */
    const allScores = get('score');
    const scoresNow = allScores.filter(r => r.payload.term === term && r.payload.session === session);
    const myScores = scoresNow.filter(r => {
      const k = (r.payload.class || '') + '|' + (r.payload.arm || '');
      return myPairs.has(k) && (mySubjectKeys.has(k + '|' + r.payload.subject) || r.payload.teacherUserId === userId);
    });
    const totalsOf = rows => rows.map(r => scoreTotal(r.payload));
    const passRate = rows => rows.length ? totalsOf(rows).filter(t => t >= 40).length / rows.length * 100 : 0;
    const gradeCounts = rows => { const c = {}; gKeys.forEach(k => { c[k] = 0; }); totalsOf(rows).forEach(t => c[gradeFor(t, gMethod)]++); return c; };
    const groupAvg = (rows, keyFn) => {
      const g = {}; rows.forEach(r => { const k = keyFn(r); (g[k] = g[k] || []).push(scoreTotal(r.payload)); });
      return Object.keys(g).map(k => ({ key: k, avg: avg(g[k]), n: g[k].length }));
    };

    /* ----- fees (current term) ----- */
    const feeRecs = get('feeRecord').filter(r => r.payload.term === term && r.payload.session === session && num(r.payload.amountDue) > 0);
    const feeDue = sum(feeRecs.map(r => r.payload.amountDue)), feePaid = sum(feeRecs.map(r => Math.min(num(r.payload.amountPaid), num(r.payload.amountDue))));
    const clearedN = feeRecs.filter(r => num(r.payload.amountPaid) >= num(r.payload.amountDue)).length;
    const outstanding = Math.max(0, feeDue - feePaid);
    const collectionRate = feeDue ? feePaid / feeDue * 100 : 0;
    const clearedPct = feeRecs.length ? clearedN / feeRecs.length * 100 : 0;

    const payments = get('feePayment');
    const confirmed = payments.filter(p => p.payload.status === 'confirmed-full' || p.payload.status === 'confirmed-partial');
    const pendingN = payments.filter(p => p.payload.status === 'pending').length;
    const thisMonthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const collectedThisMonth = sum(confirmed.filter(p => ymOf(p.payload.confirmedAt) === thisMonthKey).map(p => p.payload.confirmedAmount));
    const months6 = monthsBack(6, now);
    const collected6 = sumByMonth(confirmed, p => p.payload.confirmedAt, p => p.payload.confirmedAmount, months6);

    const expenses = get('expense'), incomes = get('incomeRecord');
    const expense6 = sumByMonth(expenses, e => e.payload.date, e => e.payload.amount, months6);
    const income6 = sumByMonth(incomes, i => i.payload.date, i => i.payload.amount, months6).map((v, i) => v + collected6[i]);
    const expenseThisMonth = expense6[5], incomeThisMonth = income6[5];
    const hasFinanceData = expenses.length + incomes.length > 0;

    /* ----- attendance ----- */
    const att = ctx.attendance;
    const attFiltered = att ? att.filter(a => !has('teacher') || has('admin') || has('principal') || has('exam') ? true : myPairs.has(a.classArm)) : null;
    const attRateOf = rows => { const t = sum(rows.map(a => a.totalDays)); return t ? sum(rows.map(a => num(a.presentCount) + num(a.lateCount))) / t * 100 : null; };
    const attRate = attFiltered ? attRateOf(attFiltered) : null;
    const attByClass = () => {
      const g = {}; (attFiltered || []).forEach(a => (g[a.classArm] = g[a.classArm] || []).push(a));
      return Object.keys(g).map(k => ({ label: pairLabel(k.split('|')[0], k.split('|')[1]), rate: attRateOf(g[k]), cls: k.split('|')[0] })).filter(x => x.rate !== null)
        .sort((a, b) => classIdx(a.cls) - classIdx(b.cls) || a.label.localeCompare(b.label));
    };

    /* ----- activity ----- */
    const cbtTests = get('cbtTest'), myTestIds = new Set(cbtTests.filter(t => t.payload.teacherUserId === userId).map(t => t.recordId));
    const myAssignIds = new Set(get('assignment').filter(a => a.payload.teacherUserId === userId).map(a => a.recordId));
    const cbtSubs = get('cbtSubmission').filter(r => r.payload.status === 'submitted');
    const asgSubs = get('assignmentSubmission');
    const weekAgo = now.getTime() - 7 * 864e5;
    const t = r => new Date(r.updatedAt || r.createdAt).getTime();
    const scopedCbt = has('teacher') && !has('admin') && !has('principal') && !has('exam') ? cbtSubs.filter(r => myTestIds.has(r.payload.testId)) : cbtSubs;
    const scopedAsg = has('teacher') && !has('admin') && !has('principal') && !has('exam') ? asgSubs.filter(r => myAssignIds.has(r.payload.assignmentId)) : asgSubs;
    const cbt7 = scopedCbt.filter(r => t(r) > weekAgo).length, asg7 = scopedAsg.filter(r => new Date(r.createdAt || r.updatedAt).getTime() > weekAgo).length;

    /* ===================== KPI + chart builders (by id) ===================== */
    const K = {}, C = {};
    const kpi = (id, icon, tone, value, label, sub, go) => ({ id, icon, tone, value: String(value), label, sub: sub || '', go: go || '' });

    K.students = () => kpi('students', 'bi-mortarboard', 'navy', activeStudents.length, 'Students', students.length > activeStudents.length ? (students.length - activeStudents.length) + ' inactive' : (settings.classes || []).length + ' classes', 'students.html');
    K.staff = () => kpi('staff', 'bi-person-badge', 'gold', get('staff').length, 'Staff', '', 'staff.html');
    K.collected = () => kpi('collected', 'bi-cash-coin', 'green', money(collectedThisMonth), 'Collected This Month', collected6[4] ? 'Last month ' + money(collected6[4]) : '', 'payments.html');
    K.outstanding = () => kpi('outstanding', 'bi-hourglass-split', outstanding ? 'gold' : 'green', feeRecs.length ? money(outstanding) : '—', 'Outstanding Fees', feeRecs.length ? pctFmt(collectionRate) + ' collected' : 'No fee records yet', 'clearance.html');
    K.awaiting = () => kpi('awaiting', 'bi-receipt', pendingN ? 'red' : 'green', pendingN, 'Payments Awaiting Review', '', 'payments.html');
    K.cleared = () => kpi('cleared', 'bi-patch-check', 'green', feeRecs.length ? pctFmt(clearedPct) : '—', 'Students Cleared', feeRecs.length ? clearedN + ' of ' + feeRecs.length : '', 'clearance.html');
    K.avgScore = () => kpi('avgScore', 'bi-graph-up', 'navy', scoresNow.length ? round1(avg(totalsOf(scoresNow))) + '%' : '—', 'Average Score', scoresNow.length ? (term || '') : 'No scores entered', 'results.html');
    K.pass = () => kpi('pass', 'bi-check2-circle', 'green', scoresNow.length ? pctFmt(passRate(scoresNow)) : '—', 'Pass Rate (40+)', '', 'results.html');
    K.attendance = () => kpi('attendance', 'bi-calendar-check', 'gold', attRate === null ? '—' : pctFmt(attRate), 'Attendance Rate', att ? (term || '') : 'Needs a connection', 'attendance.html');
    K.scoresIn = () => kpi('scoresIn', 'bi-pencil-square', 'navy', scoresNow.length, 'Scores Recorded', term || '', 'scores.html');
    K.cbt7 = () => kpi('cbt7', 'bi-laptop', 'navy', cbt7, 'CBT Submissions (7 days)', '', 'cbt-manage.html');
    K.asg7 = () => kpi('asg7', 'bi-journal-text', 'gold', asg7, 'Assignments Submitted (7 days)', '', 'assignment-manage.html');
    K.myClasses = () => kpi('myClasses', 'bi-diagram-2', 'navy', myPairs.size, 'My Classes', '', 'assignments.html');
    K.myStudents = () => kpi('myStudents', 'bi-people', 'gold', activeStudents.filter(s => myPairs.has((s.payload.class || '') + '|' + (s.payload.arm || ''))).length, 'My Students', '', 'students.html');
    K.myAvg = () => kpi('myAvg', 'bi-graph-up', 'navy', myScores.length ? round1(avg(totalsOf(myScores))) + '%' : '—', 'My Average Score', myScores.length ? myScores.length + ' scores' : 'No scores yet', 'scores.html');
    K.myPass = () => kpi('myPass', 'bi-check2-circle', 'green', myScores.length ? pctFmt(passRate(myScores)) : '—', 'My Pass Rate', '', 'scores.html');
    K.expenses = () => kpi('expenses', 'bi-wallet2', 'gold', hasFinanceData ? money(expenseThisMonth) : '—', 'Expenses This Month', hasFinanceData ? 'Income ' + money(incomeThisMonth) : '', 'finance.html');
    K.net = () => kpi('net', 'bi-piggy-bank', (incomeThisMonth - expenseThisMonth) >= 0 ? 'green' : 'red', hasFinanceData ? money(incomeThisMonth - expenseThisMonth) : '—', 'Net Cash Flow (Month)', '', 'finance.html');
    K.announce = () => kpi('announce', 'bi-megaphone', 'navy', get('announcement').filter(r => new Date(r.createdAt).getTime() > weekAgo).length, 'Announcements (7 days)', '', 'announcements.html');
    K.timetable = () => kpi('timetable', 'bi-calendar3', 'gold', get('timetableEntry').length, 'Timetable Entries', '', 'timetable.html');
    const todayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
    K.today = () => kpi('today', 'bi-clock', 'navy', get('timetableEntry').filter(r => r.payload.day === todayName).length, 'Periods Today', todayName, 'timetable.html');

    const chart = (id, title, subtitle, type, spec, go) => ({ id, title, subtitle: subtitle || '', type, spec, go: go || '' });

    C.fees6 = () => chart('fees6', 'Fee Collections', 'Confirmed payments, last 6 months', 'bar',
      { labels: months6.map(m => m.label), series: [{ name: 'Collected', values: collected6, color: '#1E6B3A' }], format: 'money', emptyText: 'No confirmed payments in the last 6 months.' }, 'payments.html');
    C.enroll = () => {
      const g = {}; activeStudents.forEach(s => { const c = s.payload.class || 'No class'; g[c] = (g[c] || 0) + 1; });
      const labels = Object.keys(g).sort((a, b) => classIdx(a) - classIdx(b) || a.localeCompare(b));
      return chart('enroll', 'Enrolment by Class', activeStudents.length + ' active students', 'hbar', { labels, values: labels.map(l => g[l]), color: '#14213D', emptyText: 'Add students to see enrolment.' }, 'students.html');
    };
    C.gender = () => {
      const m = activeStudents.filter(s => /^m/i.test(s.payload.gender || '')).length, f = activeStudents.filter(s => /^f/i.test(s.payload.gender || '')).length;
      return chart('gender', 'Boys and Girls', 'Active students', 'donut', { labels: ['Girls', 'Boys'], values: [f, m], colors: ['#8B1E3F', '#1D5C8C'], center: { value: String(m + f), label: 'Students' }, emptyText: 'No gender recorded yet.' }, 'students.html');
    };
    C.grades = () => {
      const c = gradeCounts(scoresNow);
      return chart('grades', 'Grade Distribution', (term || 'Current term') + ' — all subjects', 'donut', { labels: gKeys, values: gKeys.map(g => c[g]), colors: gKeys.map(g => GRADE_COLORS[g.charAt(0)]), center: { value: String(scoresNow.length), label: 'Scores' }, emptyText: 'No scores entered this term yet.' }, 'results.html');
    };
    C.myGrades = () => {
      const c = gradeCounts(myScores);
      return chart('myGrades', 'My Grade Distribution', 'My classes and subjects, ' + (term || 'this term'), 'donut', { labels: gKeys, values: gKeys.map(g => c[g]), colors: gKeys.map(g => GRADE_COLORS[g.charAt(0)]), center: { value: String(myScores.length), label: 'Scores' }, emptyText: 'Enter scores for your subjects to see this.' }, 'scores.html');
    };
    C.avgByClass = () => {
      const rows = groupAvg(scoresNow, r => pairLabel(r.payload.class || '', r.payload.arm)).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
      rows.sort((a, b) => classIdx(a.key.split(' ')[0]) - classIdx(b.key.split(' ')[0]) || a.key.localeCompare(b.key));
      return chart('avgByClass', 'Average Score by Class', term || 'Current term', 'bar', { labels: rows.map(r => r.key), series: [{ name: 'Average', values: rows.map(r => round1(r.avg)), color: '#14213D' }], format: 'pct', emptyText: 'No scores entered this term yet.' }, 'results.html');
    };
    C.avgBySubject = () => {
      const rows = groupAvg(scoresNow, r => r.payload.subject || '').sort((a, b) => b.avg - a.avg).slice(0, 8);
      return chart('avgBySubject', 'Average Score by Subject', (term || 'Current term') + ' — top subjects', 'hbar', { labels: rows.map(r => r.key), values: rows.map(r => round1(r.avg)), color: '#B8863B', max: 100, format: 'pct', emptyText: 'No scores entered this term yet.' }, 'results.html');
    };
    C.myAvgBySubject = () => {
      const rows = groupAvg(myScores, r => r.payload.subject + ' · ' + pairLabel(r.payload.class || '', r.payload.arm)).sort((a, b) => b.avg - a.avg).slice(0, 8);
      return chart('myAvgBySubject', 'My Class Averages', 'Average per subject and class', 'hbar', { labels: rows.map(r => r.key), values: rows.map(r => round1(r.avg)), color: '#B8863B', max: 100, format: 'pct', emptyText: 'Enter scores for your subjects to see this.' }, 'scores.html');
    };
    C.termTrend = () => {
      const g = {}; allScores.forEach(r => { const k = (r.payload.session || '') + '|' + TERMS.indexOf(r.payload.term); (g[k] = g[k] || []).push(scoreTotal(r.payload)); });
      const keysSorted = Object.keys(g).filter(k => !k.endsWith('|-1')).sort().slice(-6);
      const label = k => { const [s, ti] = k.split('|'); const yy = (s.match(/\d{4}/g) || []).map(y => y.slice(2)).join('/'); return 'T' + (Number(ti) + 1) + ' ' + yy; };
      return chart('termTrend', 'Average Score by Term', 'Last terms with scores', 'line', { labels: keysSorted.map(label), series: [{ name: 'Average', values: keysSorted.map(k => round1(avg(g[k]))), color: '#1E6B3A' }], format: 'pct', min: 0, emptyText: 'Scores from two or more terms are needed for a trend.' }, 'results.html');
    };
    C.completeness = () => {
      const pairs = {}; activeStudents.forEach(s => { const k = (s.payload.class || '') + '|' + (s.payload.arm || ''); (pairs[k] = pairs[k] || new Set()).add(s.recordId); });
      const withScore = {}; scoresNow.forEach(r => { withScore[r.payload.studentId] = true; });
      const rows = Object.keys(pairs).map(k => { const ids = Array.from(pairs[k]); return { label: pairLabel(k.split('|')[0], k.split('|')[1]), cls: k.split('|')[0], pct: ids.length ? ids.filter(i => withScore[i]).length / ids.length * 100 : 0 }; })
        .sort((a, b) => classIdx(a.cls) - classIdx(b.cls) || a.label.localeCompare(b.label));
      return chart('completeness', 'Score Entry Progress', 'Students with scores, ' + (term || 'this term'), 'hbar', { labels: rows.map(r => r.label), values: rows.map(r => Math.round(r.pct)), color: '#2F8F6B', max: 100, format: 'pct', emptyText: 'Add students and scores to track progress.' }, 'scores.html');
    };
    C.cleared = () => chart('cleared', 'Fees: Cleared vs Owing', (term || 'This term') + ', students with fee records', 'donut', { labels: ['Cleared', 'Owing'], values: [clearedN, feeRecs.length - clearedN], colors: ['#1E6B3A', '#8B1E3F'], center: { value: feeRecs.length ? pctFmt(clearedPct) : '0%', label: 'Cleared' }, emptyText: 'No fee records for this term yet.' }, 'clearance.html');
    C.payStatus = () => {
      const c = { 'Confirmed in full': 0, 'Part paid': 0, 'Awaiting review': 0, 'Rejected': 0 };
      payments.forEach(p => { const s = p.payload.status; if (s === 'confirmed-full') c['Confirmed in full']++; else if (s === 'confirmed-partial') c['Part paid']++; else if (s === 'pending') c['Awaiting review']++; else if (s === 'rejected') c['Rejected']++; });
      return chart('payStatus', 'Online Payments by Status', 'All submitted payments', 'donut', { labels: Object.keys(c), values: Object.values(c), colors: ['#1E6B3A', '#C9A227', '#1D5C8C', '#8B1E3F'], center: { value: String(payments.length), label: 'Payments' }, emptyText: 'No payments submitted yet.' }, 'payments.html');
    };
    C.outByClass = () => {
      const g = {}; feeRecs.forEach(r => { const s = studentById[r.payload.studentId]; const c = s ? (s.payload.class || 'No class') : 'No class'; g[c] = (g[c] || 0) + Math.max(0, num(r.payload.amountDue) - num(r.payload.amountPaid)); });
      const labels = Object.keys(g).filter(k => g[k] > 0).sort((a, b) => g[b] - g[a]).slice(0, 8);
      return chart('outByClass', 'Outstanding Fees by Class', 'Largest balances, ' + (term || 'this term'), 'hbar', { labels, values: labels.map(l => g[l]), color: '#8B1E3F', format: 'money', emptyText: 'No outstanding balances.' }, 'clearance.html');
    };
    C.incExp = () => chart('incExp', 'Income vs Expenses', 'Last 6 months (fees confirmed + other income)', 'bar', { labels: months6.map(m => m.label), series: [{ name: 'Income', values: income6, color: '#1E6B3A' }, { name: 'Expenses', values: expense6, color: '#8B1E3F' }], format: 'money', emptyText: 'Record income and expenses in Finance to see this.' }, 'finance.html');
    C.expCat = () => {
      const keys6 = new Set(months6.map(m => m.key)); const g = {};
      expenses.filter(e => keys6.has(ymOf(e.payload.date))).forEach(e => { const c = e.payload.category || 'Other'; g[c] = (g[c] || 0) + num(e.payload.amount); });
      const labels = Object.keys(g).sort((a, b) => g[b] - g[a]).slice(0, 6);
      return chart('expCat', 'Expenses by Category', 'Last 6 months', 'hbar', { labels, values: labels.map(l => g[l]), color: '#B8863B', format: 'money', emptyText: 'No expenses recorded.' }, 'finance.html');
    };
    C.attClass = () => { const rows = attByClass(); return chart('attClass', 'Attendance by Class', (term || 'This term') + ' — present or late', 'hbar', { labels: rows.map(r => r.label), values: rows.map(r => round1(r.rate)), color: '#1D5C8C', max: 100, format: 'pct', emptyText: att ? 'No attendance marked yet this term.' : 'Connect to the internet once to load attendance.' }, 'attendance.html'); };
    C.activity = () => chart('activity', 'CBT and Assignment Activity', 'Submissions, last 6 months', 'bar', { labels: months6.map(m => m.label), series: [{ name: 'CBT', values: countByMonth(scopedCbt, r => r.updatedAt || r.createdAt, months6), color: '#14213D' }, { name: 'Assignments', values: countByMonth(scopedAsg, r => r.createdAt || r.updatedAt, months6), color: '#B8863B' }], emptyText: 'No submissions yet.' }, 'cbt-manage.html');
    C.needsAttention = () => {
      const g = {}; myScores.forEach(r => { (g[r.payload.studentId] = g[r.payload.studentId] || []).push(scoreTotal(r.payload)); });
      const rows = Object.keys(g).map(id => ({ id, avg: avg(g[id]) })).sort((a, b) => a.avg - b.avg).slice(0, 5);
      return chart('needsAttention', 'Students Needing Support', 'Lowest averages in my subjects', 'hbar', { labels: rows.map(r => (studentById[r.id] ? studentById[r.id].payload.fullName : 'Student')), values: rows.map(r => round1(r.avg)), color: '#C0502F', max: 100, format: 'pct', emptyText: 'Enter scores to see who needs support.' }, 'scores.html');
    };
    C.announce6 = () => chart('announce6', 'Announcements', 'Posted per month', 'bar', { labels: months6.map(m => m.label), series: [{ name: 'Announcements', values: countByMonth(get('announcement'), r => r.createdAt, months6), color: '#14213D' }], emptyText: 'No announcements posted yet.' }, 'announcements.html');
    C.ttDay = () => {
      const mineOnly = has('teacher') && !has('admin') && !has('principal') && !has('exam');
      const rows = get('timetableEntry').filter(r => !mineOnly || r.payload.teacherUserId === userId);
      return chart('ttDay', mineOnly ? 'My Periods This Week' : 'Timetable Load by Day', mineOnly ? 'Periods I teach each day' : 'Periods scheduled each day, all classes', 'bar', { labels: DAYS.map(d => d.slice(0, 3)), series: [{ name: 'Periods', values: DAYS.map(d => rows.filter(r => r.payload.day === d).length), color: '#B8863B' }], emptyText: 'No timetable entries yet.' }, 'timetable.html');
    };

    /* ===================== choose what each role sees ===================== */
    const KPIS = {
      admin:     ['students','staff','collected','outstanding','awaiting','avgScore','attendance','cleared'],
      principal: ['students','staff','avgScore','pass','attendance','collected','cleared','outstanding'],
      exam:      ['students','scoresIn','avgScore','pass','cbt7','asg7','attendance'],
      bursar:    ['collected','awaiting','outstanding','cleared','expenses','net'],
      teacher:   ['myClasses','myStudents','myAvg','myPass','attendance','cbt7','asg7'],
      viewer:    ['announce','timetable','today']
    };
    const CHARTS = {
      admin:     ['fees6','incExp','enroll','grades','cleared','termTrend','attClass','gender'],
      principal: ['grades','avgByClass','avgBySubject','termTrend','enroll','attClass','fees6'],
      exam:      ['grades','avgByClass','avgBySubject','completeness','termTrend','activity'],
      bursar:    ['fees6','payStatus','cleared','outByClass','incExp','expCat'],
      teacher:   ['myGrades','myAvgBySubject','needsAttention','attClass','activity','ttDay'],
      viewer:    []
    };
    const wantFinance = (id) => (id === 'incExp' || id === 'expCat' || id === 'expenses' || id === 'net') ? premium || hasFinanceData : true;

    const kpiIds = [], chartIds = [];
    ROLE_ORDER.forEach(r => { if (!has(r)) return; KPIS[r].forEach(id => { if (!kpiIds.includes(id) && wantFinance(id)) kpiIds.push(id); }); CHARTS[r].forEach(id => { if (!chartIds.includes(id) && wantFinance(id)) chartIds.push(id); }); });
    // Everyone sees the school-life numbers (they come from data every role may read).
    ['announce','timetable'].forEach(id => { if (!kpiIds.includes(id) && kpiIds.length < 8) kpiIds.push(id); });
    ['announce6','ttDay'].forEach(id => { if (!chartIds.includes(id)) chartIds.push(id); });
    if (!kpiIds.length) ['announce','timetable','today'].forEach(id => kpiIds.push(id));

    return { roles: keys, kpis: kpiIds.slice(0, 8).map(id => K[id]()), charts: chartIds.slice(0, 10).map(id => C[id]()) };
  }


  /* ===================== PLATFORM OWNER (all schools) ===================== */
  const PLAN_PRICES = { essentials: { monthly: 15000, biannual: 80000, yearly: 150000 }, premium: { monthly: 30000, biannual: 160000, yearly: 300000 } };
  const CYCLE_MONTHS = { monthly: 1, biannual: 6, yearly: 12 };
  // Monthly-equivalent revenue of one paying school (e.g. Essentials yearly ₦150,000 = ₦12,500 a month).
  function monthlyValue(o){
    const price = (PLAN_PRICES[String(o.plan || '').toLowerCase()] || {})[o.billingCycle || 'monthly'];
    return price ? price / (CYCLE_MONTHS[o.billingCycle || 'monthly'] || 1) : 0;
  }
  function needsAttention(o, now){
    const ms = d => new Date(d).getTime() - now.getTime();
    if (o.subscriptionStatus === 'trial' && o.trialEndDate) return ms(o.trialEndDate) < 3 * 864e5;
    if (o.subscriptionStatus === 'active' && o.subscriptionExpiry) return ms(o.subscriptionExpiry) < 7 * 864e5;
    return o.subscriptionStatus !== 'trial' && o.subscriptionStatus !== 'active';
  }
  function platform(ctx){
    const now = ctx.now || new Date(), orgs = ctx.orgs || [], pending = ctx.pending || [];
    const by = s => orgs.filter(o => o.subscriptionStatus === s);
    const active = by('active'), trial = by('trial'), expired = by('expired'), cancelled = by('cancelled');
    const other = orgs.length - active.length - trial.length - expired.length - cancelled.length;
    const mrr = sum(active.map(monthlyValue));
    const users = sum(orgs.map(o => o.userCount));
    const attention = orgs.filter(o => needsAttention(o, now));
    const ended = active.length + expired.length + cancelled.length;
    const kpi = (id, icon, tone, value, label, sub) => ({ id, icon, tone, value: String(value), label, sub: sub || '' });
    const kpis = [
      kpi('schools', 'bi-building', 'navy', orgs.length, 'Total Schools', users.toLocaleString() + ' users'),
      kpi('active', 'bi-patch-check', 'green', active.length, 'Active / Paid', orgs.length ? pctFmt(active.length / orgs.length * 100) + ' of schools' : ''),
      kpi('trial', 'bi-hourglass-split', 'gold', trial.length, 'On Trial', ''),
      kpi('attention', 'bi-exclamation-triangle', attention.length ? 'red' : 'green', attention.length, 'Needing Attention', 'Expiring or lapsed'),
      kpi('mrr', 'bi-cash-stack', 'green', money(mrr), 'Monthly Recurring Revenue', 'Yearly equivalent ' + money(mrr * 12)),
      kpi('pending', 'bi-check2-circle', pending.length ? 'red' : 'green', pending.length, 'Upgrade Requests', pending.length ? 'Waiting for review' : 'None waiting'),
      kpi('conversion', 'bi-graph-up-arrow', 'navy', ended ? pctFmt(active.length / ended * 100) : '—', 'Trial-to-Paid Rate', ended ? active.length + ' of ' + ended + ' finished trials' : 'No finished trials yet'),
      kpi('lapsed', 'bi-x-octagon', (expired.length + cancelled.length) ? 'gold' : 'green', expired.length + cancelled.length, 'Expired / Cancelled', '')
    ];
    const months = monthsBack(6, now);
    const signups = countByMonth(orgs, o => o.createdAt, months);
    // Renewals and trial endings over the next 8 weeks, by week
    const weeks = []; for (let i = 0; i < 8; i++) weeks.push({ from: now.getTime() + i * 7 * 864e5, label: 'W' + (i + 1) });
    const inWeek = (d, i) => { const t = new Date(d).getTime(); return !isNaN(t) && t >= weeks[i].from && t < weeks[i].from + 7 * 864e5; };
    const renew = weeks.map((w, i) => active.filter(o => inWeek(o.subscriptionExpiry, i)).length);
    const trialEnd = weeks.map((w, i) => trial.filter(o => inWeek(o.trialEndDate, i)).length);
    const planName = o => (String(o.plan || '').toLowerCase() === 'premium') ? 'Premium' : 'Essentials';
    const mrrBy = { Essentials: 0, Premium: 0 }; active.forEach(o => { mrrBy[planName(o)] += monthlyValue(o); });
    const cap = { Healthy: 0, Monitor: 0, 'Action Needed': 0, Unknown: 0 };
    orgs.forEach(o => { const s = o.capacity && o.capacity.status; cap[s in cap ? s : 'Unknown']++; });
    const topUsers = orgs.slice().sort((a, b) => num(b.userCount) - num(a.userCount)).slice(0, 8);
    const chart = (id, title, subtitle, type, spec) => ({ id, title, subtitle, type, spec });
    const charts = [
      chart('pStatus', 'Schools by Status', 'All schools on the platform', 'donut', { labels: ['Active', 'On trial', 'Expired', 'Cancelled'].concat(other ? ['Other'] : []), values: [active.length, trial.length, expired.length, cancelled.length].concat(other ? [other] : []), colors: ['#1E6B3A', '#C9A227', '#C0502F', '#8B1E3F', '#7a7259'], center: { value: String(orgs.length), label: 'Schools' }, emptyText: 'No schools yet.' }),
      chart('pSignups', 'New Schools per Month', 'Sign-ups, last 6 months', 'bar', { labels: months.map(m => m.label), series: [{ name: 'Sign-ups', values: signups, color: '#14213D' }], emptyText: 'No sign-ups in the last 6 months.' }),
      chart('pMrr', 'Monthly Revenue by Plan', 'Paying schools, monthly equivalent', 'bar', { labels: ['Essentials', 'Premium'], series: [{ name: 'Monthly revenue', values: [mrrBy.Essentials, mrrBy.Premium], color: '#1E6B3A' }], format: 'money', emptyText: 'No paying schools yet.' }),
      chart('pPlan', 'Schools by Plan', 'Active and trial schools', 'donut', { labels: ['Essentials', 'Premium'], values: [active.concat(trial).filter(o => planName(o) === 'Essentials').length, active.concat(trial).filter(o => planName(o) === 'Premium').length], colors: ['#B8863B', '#14213D'], center: { value: String(active.length + trial.length), label: 'Schools' }, emptyText: 'No active or trial schools yet.' }),
      chart('pRenewals', 'Renewals and Trial Endings', 'Next 8 weeks', 'bar', { labels: weeks.map(w => w.label), series: [{ name: 'Renewals due', values: renew, color: '#1E6B3A' }, { name: 'Trials ending', values: trialEnd, color: '#C9A227' }], emptyText: 'Nothing due in the next 8 weeks.' }),
      chart('pUsers', 'Largest Schools by Users', 'Staff accounts per school', 'hbar', { labels: topUsers.map(o => o.orgName), values: topUsers.map(o => num(o.userCount)), color: '#14213D', emptyText: 'No schools yet.' }),
      chart('pCapacity', 'Storage Health', 'Spreadsheet space used by each school', 'donut', { labels: ['Healthy', 'Monitor', 'Action needed', 'Not measured'], values: [cap.Healthy, cap.Monitor, cap['Action Needed'], cap.Unknown], colors: ['#1E6B3A', '#C9A227', '#8B1E3F', '#b9b19a'], center: { value: String(orgs.length), label: 'Schools' }, emptyText: 'No schools yet.' })
    ];
    return { kpis, charts, mrr, attention: attention.length };
  }

  const api = { platform, monthlyValue, build, monthsBack, gradeFor, ROLE_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.smsMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);

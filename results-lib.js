/*******************************************************************
 * SMS RESULTS LIB — grading scales, totals, and auto remark/comment.
 * Include on any page that computes or displays a student's result.
 *
 * Two grading methods (chosen per school in Settings → Grading Method):
 *   'AF'   (default) — A 70–100, B 60–69, C 50–59, D 45–49, E 40–44, F 0–39
 *   'WAEC'           — A1 75–100, B2 70–74, B3 65–69, C4 60–64, C5 55–59,
 *                      C6 50–54, D7 45–49, E8 40–44, F9 0–39
 * Grades are always derived from the total at display time, so a school
 * that switches method sees every existing score re-graded consistently.
 *******************************************************************/
(function(){
  const SCALES = {
    AF: [
      { min: 70, grade: 'A',  remark: 'Excellent' },
      { min: 60, grade: 'B',  remark: 'Very Good' },
      { min: 50, grade: 'C',  remark: 'Good' },
      { min: 45, grade: 'D',  remark: 'Fair' },
      { min: 40, grade: 'E',  remark: 'Poor' },
      { min: 0,  grade: 'F',  remark: 'Fail' }
    ],
    WAEC: [
      { min: 75, grade: 'A1', remark: 'Excellent' },
      { min: 70, grade: 'B2', remark: 'Very Good' },
      { min: 65, grade: 'B3', remark: 'Good' },
      { min: 60, grade: 'C4', remark: 'Credit' },
      { min: 55, grade: 'C5', remark: 'Credit' },
      { min: 50, grade: 'C6', remark: 'Credit' },
      { min: 45, grade: 'D7', remark: 'Pass' },
      { min: 40, grade: 'E8', remark: 'Pass' },
      { min: 0,  grade: 'F9', remark: 'Fail' }
    ]
  };
  const GRADE_SCALE = SCALES.AF; // kept for older callers

  // 'WAEC' or 'AF'. Anything else (including a missing setting) means the default A–F scale.
  function normMethod(m){ return m === 'WAEC' ? 'WAEC' : 'AF'; }
  function bandsFor(method){ return SCALES[normMethod(method)]; }

  // Rows for the printed "KEYS TO GRADING" box: [{ range, grade, remark }], highest band first.
  function gradeKeyRows(method){
    const bands = bandsFor(method);
    return bands.map((b, i) => {
      const next = bands[i - 1];
      const top = next ? next.min - 1 : 100;
      const range = !next ? b.min + ' and above' : (b.min === top ? String(b.min) : b.min + ' – ' + top);
      return { range, grade: b.grade, remark: b.remark };
    });
  }

  // The 10 behavioral/psychomotor domains printed on the report sheet, rated 1-5.
  const DOMAIN_LIST = [
    'Punctuality','Attendance','Self-Control','Neatness','Responsibility',
    'Diligence','Attentiveness','Legibility','Accuracy','Sports & Games'
  ];
  const RATING_SCALE = [
    { value: 5, label: 'Excellent' }, { value: 4, label: 'Very Good' },
    { value: 3, label: 'Good' }, { value: 2, label: 'Poor' }, { value: 1, label: 'Very Poor' }
  ];

  function gradeFor(total, method){
    const t = Number(total) || 0;
    const bands = bandsFor(method);
    const band = bands.find(b => t >= b.min) || bands[bands.length - 1];
    return { grade: band.grade, remark: band.remark };
  }

  // The letter-only part of a grade ('A1' → 'A', 'C5' → 'C'), used to pick the badge colour.
  function gradeClass(grade){ return String(grade || '').charAt(0).toUpperCase() || 'F'; }

  // Re-derives grade and remark from a subject's stored total, so old records follow the school's current method.
  function regrade(sub, method){
    const g = gradeFor(sub.total, method);
    return { ...sub, grade: g.grade, remark: g.remark };
  }

  // ca: array of numbers (however many CAs the section uses), examScore: number
  function subjectTotal(ca, examScore, method){
    const caSum = (ca || []).reduce((s, v) => s + (Number(v) || 0), 0);
    const total = caSum + (Number(examScore) || 0);
    const { grade, remark } = gradeFor(total, method);
    return { caSum, total, grade, remark };
  }

  // Overall comment for a report card, based on the average of all subject totals.
  function overallComment(average){
    const a = Number(average) || 0;
    if (a >= 75) return 'An outstanding result this term. Keep up the excellent work.';
    if (a >= 65) return 'A very good result. Consistent effort is paying off.';
    if (a >= 55) return 'A good result overall — there is still room to push higher.';
    if (a >= 45) return 'A fair result. More consistent study is recommended.';
    if (a >= 40) return 'A pass, but improvement is needed across most subjects.';
    return 'This result needs urgent attention — please arrange extra support.';
  }

  function average(scores){
    if (!scores.length) return 0;
    const sum = scores.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return Math.round((sum / scores.length) * 10) / 10;
  }

  window.smsResults = { SCALES, GRADE_SCALE, normMethod, gradeKeyRows, gradeFor, gradeClass, regrade, subjectTotal, overallComment, average, DOMAIN_LIST, RATING_SCALE };
})();

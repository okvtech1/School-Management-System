/*******************************************************************
 * SMS REPORT TEMPLATE — renders the report sheet used by both the
 * staff Results page and the public Result Checker, so what a teacher
 * previews is identical to what a parent/student sees and prints.
 *
 * Layout: A4 PORTRAIT, one page. The school's logo sits at the top LEFT of
 * the letterhead, the student's photo at the top right, and the school's own
 * colours (Settings > Branding) drive the headings and tables. If a sheet has
 * so many subjects that it would spill onto a second page, it is scaled down
 * slightly to stay on one page.
 *
 * Include after print-lib.js and results-lib.js. Usage:
 *   window.smsReport.renderSheet(containerEl, data)
 *******************************************************************/
(function(){

const PAPER_W_MM = 210, PAGE_W_MM = 190, PAGE_H_MM = 277;   // A4 minus 10mm margins all round
const PX_PER_MM = 96 / 25.4;

const CSS = `
  .rs-outer{width:100%;}
  .rs-screen{width:${PAPER_W_MM}mm;transform-origin:top left;}
  .rs-paper{width:${PAPER_W_MM}mm;box-sizing:border-box;padding:10mm;background:#fff;box-shadow:0 2px 16px rgba(0,0,0,.2);
            font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#1a1a1a;}
  .rs-page{width:${PAGE_W_MM}mm;min-height:${PAGE_H_MM}mm;font-size:8.6pt;line-height:1.3;display:flex;flex-direction:column;box-sizing:border-box;}
  .rs-photo{width:22mm;height:26mm;flex:none;margin-left:auto;border:.3mm solid #9a9a9a;border-radius:1mm;background:#f2f2f2;overflow:hidden;
            display:flex;align-items:center;justify-content:center;font-size:6pt;color:#999;text-align:center;}
  .rs-photo img{width:100%;height:100%;object-fit:cover;}

  .rs-title{margin-top:6mm;background:var(--sch-primary);color:var(--sch-on-primary);text-align:center;font-weight:800;
            font-size:11pt;letter-spacing:.1em;padding:2.4mm 0;border-radius:1mm;}

  /* Info grid: separate, softly filled boxes with real gaps between fields */
  .rs-info{width:100%;border-collapse:separate;border-spacing:1.8mm;table-layout:fixed;margin:2.2mm -1.8mm 0;width:calc(100% + 3.6mm);}
  .rs-info td{background:#f6f6f4;border:.25mm solid #d6d3c8;border-radius:1.2mm;padding:1.7mm 2.6mm;vertical-align:top;}
  .rs-info .k{display:block;font-size:5.9pt;letter-spacing:.09em;color:#6b6b6b;text-transform:uppercase;font-weight:700;margin-bottom:.7mm;}
  .rs-info .v{display:block;font-size:9.2pt;font-weight:700;color:#111;min-height:3.8mm;overflow-wrap:anywhere;}

  .rs-sectionbar{margin-top:5.5mm;text-align:center;font-weight:800;font-size:8.6pt;letter-spacing:.06em;background:var(--sch-tint);
                 border-left:1.2mm solid var(--sch-primary);color:var(--sch-primary);padding:1.8mm 2mm;text-align:left;}
  .rs-table{width:100%;border-collapse:collapse;font-size:8.6pt;margin-top:2.2mm;}
  .rs-table th,.rs-table td{border-bottom:.25mm solid #cfcfc8;padding:1.7mm 1.6mm;text-align:center;}
  .rs-table th{background:var(--sch-primary);color:var(--sch-on-primary);font-size:7pt;font-weight:800;line-height:1.25;letter-spacing:.04em;padding:2mm 1.4mm;border-bottom:none;}
  .rs-table td:first-child,.rs-table th:first-child{text-align:left;padding-left:3mm;}
  .rs-table td:first-child{font-weight:600;}
  .rs-table tbody tr:nth-child(even) td{background:#f8f8f6;}
  .rs-table td.rs-strong{font-weight:800;color:var(--sch-dark);}
  .rs-table td.rs-grade{font-weight:800;color:var(--sch-primary);}

  .rs-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-top:3.5mm;}
  .rs-summary > div{background:var(--sch-tint);border:.25mm solid var(--sch-tint2);border-radius:1.2mm;padding:2mm 3mm;text-align:center;}
  .rs-summary .k{display:block;font-size:6pt;letter-spacing:.09em;color:#555;text-transform:uppercase;font-weight:700;}
  .rs-summary .v{display:block;font-size:12pt;font-weight:800;color:var(--sch-primary);margin-top:.6mm;}

  .rs-bottom{margin-top:auto;padding-top:5mm;}
  .rs-footgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4.5mm;align-items:start;}
  .rs-footgrid table{width:100%;border-collapse:collapse;font-size:7.8pt;}
  .rs-footgrid th,.rs-footgrid td{border-bottom:.25mm solid #cfcfc8;padding:1.05mm 2mm;}
  .rs-footgrid th{background:var(--sch-primary);color:var(--sch-on-primary);font-size:7pt;font-weight:800;text-align:center;letter-spacing:.05em;padding:1.6mm 2mm;}
  .rs-footgrid td.rs-rate{text-align:center;font-weight:800;width:13mm;border-left:.25mm solid #cfcfc8;}
  .rs-keybox{border:.25mm solid #d6d3c8;border-radius:1.2mm;padding:2mm 2.6mm;font-size:7.2pt;margin-bottom:3mm;line-height:1.6;background:#fbfbf9;}
  .rs-keybox .rs-keytitle{color:var(--sch-primary);font-weight:800;text-align:center;margin-bottom:1.2mm;letter-spacing:.06em;font-size:7pt;}
  .rs-keybox .rs-keyrow{display:flex;justify-content:space-between;gap:2mm;}
  .rs-keybox .rs-keyrow b{color:var(--sch-primary);}
  .rs-billtotal td{font-weight:800;background:var(--sch-tint);}

  .rs-remarks{margin-top:5mm;font-size:8.6pt;}
  .rs-remarks .rs-rline{border-bottom:.25mm solid #9a9a9a;padding:1.8mm 0 1.2mm;margin-bottom:2.4mm;min-height:6mm;line-height:1.4;}
  .rs-remarks .rs-rline b{color:var(--sch-primary);font-size:7.4pt;letter-spacing:.05em;margin-right:1.5mm;}

  .rs-signrow{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10mm;margin-top:5mm;font-size:7.8pt;text-align:center;align-items:end;}
  .rs-signrow .rs-sigbox{min-height:16mm;display:flex;flex-direction:column;justify-content:flex-end;}
  .rs-signrow img{max-height:13mm;max-width:42mm;object-fit:contain;display:block;margin:0 auto 1mm;}
  .rs-signrow .rs-sigline{border-top:.3mm solid #222;padding-top:1.2mm;font-weight:600;min-height:4.5mm;}
  .rs-signrow .rs-siglabel{color:#666;font-size:6.6pt;letter-spacing:.07em;text-transform:uppercase;margin-top:.6mm;}

  @media print{
    .rs-outer{height:auto !important;width:auto !important;}
    .rs-screen{transform:none !important;width:auto !important;}
    .rs-paper{width:auto !important;padding:0 !important;box-shadow:none !important;}
    .rs-paper,.rs-page{break-inside:avoid;page-break-inside:avoid;}
  }
`;
let cssInjected = false;
function ensureCss(){
  if (cssInjected) return;
  const style = document.createElement('style');
  style.id = 'rs-sheet-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* CA columns split 40% total evenly across however many CAs the section uses; Exam always shown as the remainder to 100%. */
function caColumnPlan(caCount){
  const n = Math.max(1, caCount || 2);
  const per = Math.round(40 / n);
  const examPct = 100 - per * n;
  const labels = ['1ST','2ND','3RD','4TH'].slice(0, n).map(ord => `${ord} C.A<br>${per}%`);
  return { labels, examPct };
}

/* Keeps the sheet on ONE A4 page and, on small screens, shows the whole page scaled to fit the width. */
function fitSheet(outer){
  const screen = outer.querySelector('.rs-screen');
  const page = outer.querySelector('.rs-page');
  if (!screen || !page) return;
  // 1) one-page fit: only ever shrinks, and only when the content is taller than the printable area
  page.style.zoom = ''; page.style.width = ''; page.style.minHeight = '';
  const maxH = PAGE_H_MM * PX_PER_MM;
  const h = page.scrollHeight;
  if (h > maxH + 1) {
    const z = Math.max(0.55, maxH / h);
    page.style.zoom = z.toFixed(4);
    page.style.width = (PAGE_W_MM / z).toFixed(2) + 'mm';
    page.style.minHeight = (PAGE_H_MM / z).toFixed(2) + 'mm';
  }
  // 2) screen fit: scale the paper down to the available width (printing ignores this)
  const availW = outer.parentElement ? outer.parentElement.clientWidth : window.innerWidth;
  const paperPx = PAPER_W_MM * PX_PER_MM;
  const s = Math.min(1, (availW || paperPx) / paperPx);
  screen.style.transform = s < 1 ? `scale(${s.toFixed(4)})` : '';
  outer.style.height = (screen.offsetHeight * s) + 'px';
}
let resizeBound = false;
function bindResize(){
  if (resizeBound) return; resizeBound = true;
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => document.querySelectorAll('.rs-outer').forEach(fitSheet), 120); });
  window.addEventListener('beforeprint', () => document.querySelectorAll('.rs-outer').forEach(o => { const p = o.querySelector('.rs-page'); if (p) fitSheet(o); }));
}

/*
 * data = {
 *   school: { name, logo, logo2, address, phone, email, website, regNo, motto, footer,
 *             brandPrimary, brandAccent, watermark }   // flat settings-style keys (schoolName...) also accepted
 *   reportType: 'first'|'second'|'third'|'yearly',
 *   student: { fullName, class, arm, gender, dob, admissionNo, noInClass, photo },
 *   term, session,
 *   attendance: { timesSchoolOpened, timesPresent, timesAbsent, closingDate, resumptionDate },
 *   caCount: 2|3|4,                         // term reports only
 *   gradingMethod: 'AF' (default) or 'WAEC' — the scale used for grades and the keys box
 *   subjects: term ->   [{ name, ca:[..], examScore, total, grade, remark }]
 *             yearly -> [{ name, term1Total, term2Total, term3Total, total300, average, remark }]
 *   overallTotal, average, percentage, position,
 *   domains: [{ name, rating }],            // rating 1-5 or '' if not entered
 *   bill: [{ name, amount }], outstandingBill, totalBill,
 *   classTeacherRemark, headTeacherRemark, classTeacherName,
 *   principalName, principalSignature
 * }
 */
function renderSheet(container, data){
  ensureCss();
  const b = window.smsPrint.brand(data.school || {});
  window.smsPrint.applyTheme(b);
  const st = data.student || {};
  const att = data.attendance || {};
  const titleMap = { first:'FIRST TERM REPORT SHEET', second:'SECOND TERM REPORT SHEET', third:'THIRD TERM REPORT SHEET', yearly:'YEARLY CUMULATIVE REPORT' };
  const title = titleMap[data.reportType] || 'TERM REPORT SHEET';
  const isYearly = data.reportType === 'yearly';
  const sectionLabel = (data.section || '').toUpperCase();

  let tableHead, tableBody;
  if (isYearly) {
    tableHead = `<tr><th>SUBJECT</th><th>1ST TERM<br>100%</th><th>2ND TERM<br>100%</th><th>3RD TERM<br>100%</th><th>TOTAL<br>300%</th><th>AVERAGE</th><th>REMARKS</th></tr>`;
    tableBody = (data.subjects||[]).map(sub => `
      <tr>
        <td>${esc(sub.name)}</td><td>${sub.term1Total ?? 0}</td><td>${sub.term2Total ?? 0}</td><td>${sub.term3Total ?? 0}</td>
        <td class="rs-strong">${sub.total300 ?? 0}</td><td class="rs-strong">${(sub.average ?? 0).toFixed ? sub.average.toFixed(2) : sub.average}</td><td>${esc(sub.remark||'')}</td>
      </tr>`).join('');
  } else {
    const plan = caColumnPlan(data.caCount);
    tableHead = `<tr><th>SUBJECT</th>${plan.labels.map(l=>`<th>${l}</th>`).join('')}<th>EXAM<br>${plan.examPct}%</th><th>TOTAL<br>100%</th><th>GRADE</th><th>REMARKS</th></tr>`;
    tableBody = (data.subjects||[]).map(raw => {
      // Grade and remark always follow the school's current grading method (A–F or WAEC A1–F9).
      const sub = window.smsResults ? window.smsResults.regrade(raw, data.gradingMethod) : raw;
      return `
      <tr>
        <td>${esc(sub.name)}</td>${(sub.ca||[]).map(c=>`<td>${c ?? 0}</td>`).join('')}<td>${sub.examScore ?? 0}</td>
        <td class="rs-strong">${sub.total ?? 0}</td><td class="rs-grade">${esc(sub.grade||'')}</td><td>${esc(sub.remark||'')}</td>
      </tr>`; }).join('');
  }
  const keyRows = window.smsResults ? window.smsResults.gradeKeyRows(data.gradingMethod) : [];
  const gradeKeyHtml = keyRows.map(k => `<div class="rs-keyrow"><span>${esc(k.range)}</span><span><b>${esc(k.grade)}</b> ${esc(k.remark)}</span></div>`).join('');
  const colSpan = isYearly ? 7 : (2 + (data.caCount || 2) + 3);

  const domainRows = (data.domains || (window.smsResults ? window.smsResults.DOMAIN_LIST.map(n=>({name:n,rating:''})) : []))
    .map(d => `<tr><td>${esc(d.name)}</td><td class="rs-rate">${esc(d.rating || '')}</td></tr>`).join('');
  const billRows = (data.bill || []).map(x => `<tr><td>${esc(x.name)}</td><td style="text-align:right;">₦ ${Number(x.amount||0).toLocaleString()}</td></tr>`).join('');

  const photo = `<div class="rs-photo">${st.photo ? `<img src="${esc(st.photo)}" alt="">` : 'PASSPORT<br>PHOTO'}</div>`;
  const cell = (k, v, span) => `<td${span ? ` colspan="${span}"` : ''}><span class="k">${k}</span><span class="v">${esc(v ?? '')}</span></td>`;
  const pct = (data.percentage !== undefined && data.percentage !== '') ? `${data.percentage}%` : '';

  container.innerHTML = `
    <div class="rs-outer"><div class="rs-screen"><div class="rs-paper"><div class="rs-page">
      ${window.smsPrint.letterhead(b, { right: photo, showEmptyLogo: true })}

      <div class="rs-title">${title}</div>

      <table class="rs-info">
        <tr>${cell('Name of pupil', st.fullName, 2)}${cell('Class', (st.class || '') + (st.arm ? ' ' + st.arm : ''))}${cell('Gender', st.gender)}</tr>
        <tr>${cell('Session', data.session)}${cell('Term', isYearly ? 'All terms' : data.term)}${cell('Admission no.', st.admissionNo)}${cell('No. in class', st.noInClass)}</tr>
        <tr>${cell('Date of birth', st.dob)}${cell('Times school opened', att.timesSchoolOpened)}${cell('Times present', att.timesPresent)}${cell('Times absent', att.timesAbsent)}</tr>
        <tr>${cell('Closing date', att.closingDate, 2)}${cell('Resumption date', att.resumptionDate, 2)}</tr>
      </table>

      <div class="rs-sectionbar">PUPIL'S ACADEMIC PERFORMANCE${sectionLabel ? ` &nbsp;(${sectionLabel} CATEGORY)` : ''}</div>
      <table class="rs-table">
        <thead>${tableHead}</thead>
        <tbody>${tableBody || `<tr><td colspan="${colSpan}">No subjects recorded yet.</td></tr>`}</tbody>
      </table>

      <div class="rs-summary">
        <div><span class="k">Overall total</span><span class="v">${esc(data.overallTotal ?? '')}</span></div>
        <div><span class="k">Average</span><span class="v">${esc(data.average ?? '')}</span></div>
        <div><span class="k">Percentage</span><span class="v">${esc(pct)}</span></div>
        <div><span class="k">Position</span><span class="v">${esc(data.position || '')}</span></div>
      </div>

      <div class="rs-bottom">
        <div class="rs-footgrid">
          <div>
            <table>
              <thead><tr><th>DOMAINS</th><th>RATING</th></tr></thead>
              <tbody>${domainRows}</tbody>
            </table>
          </div>
          <div>
            <div class="rs-keybox">
              <div class="rs-keytitle">KEYS TO GRADING</div>
              ${gradeKeyHtml}
            </div>
            <div class="rs-keybox">
              <div class="rs-keytitle">KEYS TO RATING</div>
              <div class="rs-keyrow"><span><b>5</b> Excellent</span><span><b>4</b> Very Good</span></div>
              <div class="rs-keyrow"><span><b>3</b> Good</span><span><b>2</b> Poor</span></div>
              <div class="rs-keyrow"><span><b>1</b> Very Poor</span><span></span></div>
            </div>
          </div>
          <div>
            <table>
              <thead><tr><th colspan="2">SCHOOL BILL</th></tr></thead>
              <tbody>
                ${billRows || '<tr><td colspan="2">No fees set up</td></tr>'}
                <tr class="rs-billtotal"><td>OUTSTANDING BILL</td><td style="text-align:right;">₦ ${Number(data.outstandingBill||0).toLocaleString()}</td></tr>
                <tr class="rs-billtotal"><td>TOTAL</td><td style="text-align:right;">₦ ${Number(data.totalBill||0).toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="rs-remarks">
          <div class="rs-rline"><b>CLASS TEACHER'S REMARK:</b> ${esc(data.classTeacherRemark || '')}</div>
          <div class="rs-rline"><b>HEAD TEACHER'S REMARK:</b> ${esc(data.headTeacherRemark || '')}</div>
        </div>

        <div class="rs-signrow">
          <div class="rs-sigbox"><div class="rs-sigline">${esc(data.classTeacherName || '')}</div><div class="rs-siglabel">Class teacher</div></div>
          <div class="rs-sigbox"><div class="rs-sigline">${esc(new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }))}</div><div class="rs-siglabel">Date issued</div></div>
          <div class="rs-sigbox">${data.principalSignature ? `<img src="${esc(data.principalSignature)}" alt="">` : ''}<div class="rs-sigline">${esc(data.principalName || '')}</div><div class="rs-siglabel">Principal / Head teacher</div></div>
        </div>
        ${window.smsPrint.footer(b, data.issuedNote === false ? '' : `Issued electronically by ${esc(b.name || 'the school')}${data.principalName ? ' and signed by ' + esc(data.principalName) : ''}.`)}
      </div>
    </div></div></div></div>
  `;
  if (b.watermark && b.logo) container.querySelector('.rs-page').classList.add('sch-watermark');
  bindResize();
  const outer = container.querySelector('.rs-outer');
  fitSheet(outer);
  requestAnimationFrame(() => fitSheet(outer));
}

window.smsReport = { renderSheet, caColumnPlan, fitSheet };
})();

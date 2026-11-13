/*******************************************************************
 * DEMO MODE — runs the REAL dashboard and every real page against an
 * in-browser sample-data backend, so the demo is the actual product
 * (same tabs, same forms, same buttons) with nothing saved.
 *
 * How it works
 *  - demo.html sets sessionStorage.sms_demo = '1' and opens dashboard.html.
 *  - This file loads first on every app page. When the flag is set it:
 *      1. redirects reads/writes of localStorage 'sms_*' keys into
 *         sessionStorage, so a real logged-in session is never touched;
 *      2. replaces window.smsSync (see sync.js) with a store seeded with
 *         sample school data, shared across the dashboard tabs;
 *      3. answers every Apps Script API call (fetch) locally;
 *      4. adds the demo banner + "view as" role switcher on the top page.
 *  - Everything lives in sessionStorage: closing the tab resets the demo.
 *  - When the flag is not set, this file does nothing at all.
 *******************************************************************/
(function(){
  const PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const EXIT_PAGES = ['login.html','signup.html','pricing.html','index.html','install.html','reset-password.html','terms.html'];
  if (EXIT_PAGES.includes(PAGE)) { try { sessionStorage.removeItem('sms_demo'); } catch(e){} return; }
  let ON = false;
  try { ON = sessionStorage.getItem('sms_demo') === '1'; } catch(e){}
  if (!ON) return;
  window.SMS_DEMO = true;

  /* ---------- 1. localStorage sandbox ---------- */
  const _get = Storage.prototype.getItem, _set = Storage.prototype.setItem, _rm = Storage.prototype.removeItem;
  const mine = (st, k) => st === window.localStorage && String(k).indexOf('sms_') === 0;
  Storage.prototype.getItem = function(k){ return mine(this,k) ? _get.call(sessionStorage, 'demo_ls_'+k) : _get.call(this,k); };
  Storage.prototype.setItem = function(k,v){ return mine(this,k) ? _set.call(sessionStorage, 'demo_ls_'+k, v) : _set.call(this,k,v); };
  Storage.prototype.removeItem = function(k){ return mine(this,k) ? _rm.call(sessionStorage, 'demo_ls_'+k) : _rm.call(this,k); };

  /* ---------- 2. Role profiles ("view as") ---------- */
  const PROFILES = {
    admin:     { label:'Administrator',        userId:'usr_demo_admin', fullName:'Demo Admin',      username:'demo_admin', roles:['Super Administrator'] },
    principal: { label:'Principal',            userId:'usr_principal',  fullName:'Grace Adewale',   username:'grace.adewale', roles:['Principal / Head Teacher'] },
    exam:      { label:'Academic/Exam Officer',userId:'usr_blessing',   fullName:'Blessing Okafor', username:'blessing.okafor', roles:['Academic Officer / Exam Officer'] },
    teacher:   { label:'Teacher',              userId:'usr_tunde',      fullName:'Tunde Bakare',    username:'tunde.bakare', roles:['Teacher'] },
    bursar:    { label:'Bursar',               userId:'usr_ngozi',      fullName:'Ngozi Umeh',      username:'ngozi.umeh', roles:['Bursar / Accountant'] },
    viewer:    { label:'Result Viewer (front desk)', userId:'usr_viewer', fullName:'Funmi Ade',       username:'funmi.ade', roles:['Result Viewer / Parent Portal User'] },
    owner:     { label:'Platform Owner (all schools)', userId:'usr_platform', fullName:'OKV Platform Admin', username:'platform_owner', roles:['Platform Super Admin'], platform:true }
  };
  function currentProfileKey(){ return _get.call(sessionStorage,'demo_profile') || 'admin'; }
  function buildSession(key){
    const p = PROFILES[key] || PROFILES.admin;
    if (p.platform) return { sessionToken:'demo-token', isPlatformAdmin:true, orgId:'PLATFORM_OKV', userId:p.userId, roles:p.roles, fullName:p.fullName, username:p.username };
    const trialEnd = new Date(Date.now() + 6*86400000).toISOString();
    return { sessionToken:'demo-token', orgId:'org_demo', userId:p.userId, roles:p.roles, fullName:p.fullName, username:p.username,
      subscriptionStatus:'trial', plan:'premium', billingCycle:'monthly', trialEndDate:trialEnd, orgName:'Greenwood International School',
      orgEmail:'admin@greenwood.example', orgPhone:'0801 234 5678', subscriptionStartDate:'', subscriptionExpiry:'', assignedSchoolIds:[] };
  }
  if (!_get.call(sessionStorage,'demo_ls_sms_session')) _set.call(sessionStorage,'demo_ls_sms_session', JSON.stringify(buildSession(currentProfileKey())));

  /* ---------- 3. Seed data ---------- */
  const DAY = 86400000;
  const iso = (offsetDays, h) => { const d = new Date(Date.now() + offsetDays*DAY); if (h!=null) d.setHours(h,0,0,0); return d.toISOString(); };
  const ymd = (offsetDays) => iso(offsetDays).slice(0,10);
  const TERM = 'First Term', SESSION = '2026/2027';

  function seed(){
    let n = 0;
    const recs = [];
    const add = (type, payload, id, createdOffset) => {
      const rid = id || ('demo_' + type + '_' + (++n));
      const t = iso(createdOffset || 0);
      recs.push({ recordId: rid, type, payload, createdAt: t, updatedAt: t });
      return rid;
    };

  // Sample artwork (inline SVG) so the demo's printouts show a real-looking logo, signature and passport photos.
  const svgUri = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const DEMO_LOGO = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M60 6 108 22v36c0 30-20 48-48 58C32 106 12 88 12 58V22z" fill="#1E6B3A"/><path d="M60 14 100 27v31c0 25-16 40-40 49C36 98 20 83 20 58V27z" fill="#fff"/><path d="M60 22 92 32v26c0 20-13 33-32 40-19-7-32-20-32-40V32z" fill="#1E6B3A"/><text x="60" y="70" font-family="Georgia,serif" font-size="40" font-weight="bold" fill="#C9A227" text-anchor="middle">G</text><path d="M34 100q26 12 52 0" stroke="#C9A227" stroke-width="4" fill="none"/></svg>');
  const DEMO_SIGNATURE = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><path d="M10 52c14-30 26-38 30-30s-14 38-6 40 24-34 34-32-6 26 6 24 22-18 30-20-4 14 6 14 18-12 28-14 2 12 12 10 22-8 38-6" stroke="#14213D" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M12 68h200" stroke="#14213D" stroke-width="1.2" opacity=".35"/></svg>');
  const avatar = (name, hue) => { const ini = String(name).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    return svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"><rect width="100" height="120" fill="hsl(' + hue + ',35%,88%)"/><circle cx="50" cy="46" r="20" fill="hsl(' + hue + ',30%,62%)"/><path d="M12 120c2-30 22-42 38-42s36 12 38 42z" fill="hsl(' + hue + ',30%,62%)"/><text x="50" y="108" font-family="Arial" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">' + ini + '</text></svg>'); };
    const subjects = ['Mathematics','English Language','Basic Science','Social Studies','Civic Education','Computer Studies'];
    add('settings', {
      schoolName:'Greenwood International School', schoolAddress:'12 Unity Road, Ado-Ekiti', schoolMotto:'Knowledge with Character',
      schoolPhone:'0801 234 5678', schoolEmail:'info@greenwood.example', currentTerm:TERM, currentSession:SESSION,
      classes:['KG2','Primary 3','JSS1','JSS2','JSS3','SS1'], classArms:{ KG2:['A'], 'Primary 3':['A'], JSS1:['A','B'], JSS2:['A','B'], JSS3:['A','B'], SS1:['A'] },
      classSections:{ KG2:'Kindergarten', 'Primary 3':'Primary', JSS1:'Secondary', JSS2:'Secondary', JSS3:'Secondary', SS1:'Secondary' },
      subjects, subjectsBySection:{ Kindergarten:['Number Work','Letter Work','Phonics','Rhymes and Songs','Colouring and Drawing','Health Habits'], Nursery:[], Primary:['English Language','Mathematics','Basic Science','Social Studies','Creative Arts'], Secondary:subjects }, caCounts:{ Kindergarten:3, Nursery:3, Primary:3, Secondary:2 },
      principalName:'Mrs. Grace Adewale', principalSignature:DEMO_SIGNATURE,
      schoolLogo:DEMO_LOGO, schoolWebsite:'www.greenwood.example', schoolRegNo:'Reg. No. EKS/MOE/PRV/0457', brandPrimary:'#1E6B3A', brandAccent:'#C9A227',
      printFooter:'Greenwood International School. Knowledge with Character.', printWatermark:false, schoolLogo2:'', attendanceMode:'summary', archivingEnabled:true,
      weeklyAttendanceEmailsEnabled:false, termEndDate:'', termSummarySentKey:'', termInfo:{}, schools:[], activeSchoolId:''
    }, 'demo_settings', -60);

    const studentRows = [
      ['Adaeze Okonkwo','OKV/2026/0142','JSS2','A','F','Mrs. Okonkwo','0802 111 2222','okonkwo@example.com'],
      ['Chidi Eze','OKV/2026/0087','JSS2','A','M','Mr. Eze','0807 333 4444','eze@example.com'],
      ['Fatima Bello','OKV/2025/0231','JSS2','A','F','Alhaji Bello','0803 555 6666','bello@example.com'],
      ['Emeka Nwosu','OKV/2026/0199','JSS2','A','M','Mrs. Nwosu','0805 777 8888','nwosu@example.com'],
      ['Tolu Adeyemi','OKV/2025/0176','JSS2','A','M','Mr. Adeyemi','0806 999 0000','adeyemi@example.com'],
      ['Zainab Musa','OKV/2026/0210','JSS2','A','F','Mr. Musa','0809 121 3434','musa@example.com'],
      ['Kunle Ajayi','OKV/2026/0064','JSS1','A','M','Mrs. Ajayi','0802 454 6767','ajayi@example.com'],
      ['Ifeoma Obi','OKV/2026/0071','JSS1','A','F','Mr. Obi','0807 686 8989','obi@example.com'],
      ['Sadiq Lawal','OKV/2026/0118','JSS3','B','M','Mr. Lawal','0803 212 3232','lawal@example.com'],
      ['Ruth Ogunleye','OKV/2025/0155','SS1','A','F','Mrs. Ogunleye','0805 343 5454','ogunleye@example.com'],
      ['Amara Chukwu','OKV/2026/0301','KG2','A','F','Mrs. Chukwu','0802 777 1111','chukwu@example.com'],
      ['Daniel Ibrahim','OKV/2026/0302','KG2','A','M','Mr. Ibrahim','0803 888 2222','ibrahim@example.com']
    ];
    const studentIds = studentRows.map((s,i) => add('student', {
      fullName:s[0], admissionNo:s[1], class:s[2], arm:s[3], schoolId:'', gender:s[4], dob:'2013-05-1'+(i%9),
      guardianPhone:s[6], guardianEmail:s[7], address:'Ado-Ekiti', active:true, photo:avatar(s[0], (i*47)%360)
    }, 'demo_stu_'+(i+1), -50));
    const jss2a = studentIds.slice(0,6);

    add('staff', { fullName:'Tunde Bakare', staffId:'STF-0021', position:'Mathematics Teacher', phone:'0803 123 4567', email:'tunde@greenwood.example', hireDate:'2021-09-01', active:true, photo:avatar('Tunde Bakare', 210) }, 'demo_staff_1', -40);
    add('staff', { fullName:'Ngozi Umeh', staffId:'STF-0009', position:'Bursar', phone:'0805 987 6543', email:'ngozi@greenwood.example', hireDate:'2019-01-14', active:true, photo:avatar('Ngozi Umeh', 20) }, 'demo_staff_2', -40);
    add('staff', { fullName:'Blessing Okafor', staffId:'STF-0033', position:'Academic Officer', phone:'0808 246 8101', email:'blessing@greenwood.example', hireDate:'2022-02-07', active:true, photo:avatar('Blessing Okafor', 300) }, 'demo_staff_3', -40);

    add('parent', { fullName:'Mrs. Okonkwo', phone:'0802 111 2222', email:'okonkwo@example.com', address:'Ado-Ekiti', linkedStudentIds:[studentIds[0]] }, 'demo_parent_1', -30);
    add('parent', { fullName:'Mr. Eze', phone:'0807 333 4444', email:'eze@example.com', address:'Ado-Ekiti', linkedStudentIds:[studentIds[1]] }, 'demo_parent_2', -30);

    add('classTeacher', { class:'JSS2', arm:'A', teacherUserId:'usr_tunde', schoolId:'' }, 'demo_ct_1', -30);
    add('subjectAssignment', { class:'JSS2', arm:'A', subject:'Mathematics', teacherUserId:'usr_tunde', schoolId:'' }, 'demo_sa_1', -30);
    add('subjectAssignment', { class:'JSS2', arm:'B', subject:'Mathematics', teacherUserId:'usr_tunde', schoolId:'' }, 'demo_sa_2', -30);
    add('subjectAssignment', { class:'JSS2', arm:'A', subject:'English Language', teacherUserId:'usr_blessing', schoolId:'' }, 'demo_sa_3', -30);

    // Scores for JSS2A, current term — two CAs (20 each) + exam (60)
    const scoreSets = { 'Mathematics':[[18,17,52],[9,8,24],[16,15,47],[12,14,40],[15,13,44],[17,18,55]],
                        'English Language':[[15,16,44],[10,11,30],[14,13,41],[13,12,38],[12,15,36],[16,17,50]] };
    Object.keys(scoreSets).forEach(sub => jss2a.forEach((sid, i) => {
      const [c1,c2,ex] = scoreSets[sub][i];
      const total = c1+c2+ex;
      const g = total>=70?['A','Excellent']:total>=60?['B','Very Good']:total>=50?['C','Good']:total>=45?['D','Fair']:total>=40?['E','Poor']:['F','Fail'];
      add('score', { studentId:sid, class:'JSS2', arm:'A', subject:sub, term:TERM, session:SESSION, ca:[c1,c2], exam:ex, total, grade:g[0], remark:g[1], teacherUserId: sub==='Mathematics'?'usr_tunde':'usr_blessing' });
    }));

    // Fees: types, per-student clearance and submitted payments
    const ftTuition = add('feeType', { name:'Tuition', amount:150000 }, 'demo_ft_1', -45);
    const ftPta = add('feeType', { name:'PTA Levy', amount:5000 }, 'demo_ft_2', -45);
    add('feeType', { name:'Uniform', amount:22000 }, 'demo_ft_3', -45);
    const paid = [150000, 80000, 150000, 60000, 150000, 100000];
    jss2a.forEach((sid,i) => add('feeRecord', { studentId:sid, term:TERM, session:SESSION, amountDue:150000, amountPaid:paid[i] }));

    const pay = (idx, name, adm, cls, arm, ftId, ftName, exp, declared, ref, status, confirmed, off) => add('feePayment', {
      studentId: studentIds[idx], admissionNo:adm, fullName:name, class:cls, arm, term:TERM, session:SESSION,
      feeTypeId:ftId, feeTypeName:ftName, expectedAmount:exp, declaredAmount:declared, receiptDataUrl:'', payerEmail:'parent@example.com',
      paymentReference:ref, status, confirmedAmount:confirmed, bursarNote:'', confirmedAt: status==='pending'?'':iso(off), confirmedBy: status==='pending'?'':'Ngozi Umeh', submittedAt: iso(off-1)
    }, null, off-1);
    pay(1,'Chidi Eze','OKV/2026/0087','JSS2','A',ftTuition,'Tuition',150000,150000,'PAY-A1B2C3D4','confirmed-full',150000,-12);
    pay(0,'Adaeze Okonkwo','OKV/2026/0142','JSS2','A',ftTuition,'Tuition',150000,150000,'PAY-B2C3D4E5','confirmed-full',150000,-40);
    pay(2,'Fatima Bello','OKV/2025/0231','JSS2','A',ftPta,'PTA Levy',5000,5000,'PAY-E5F6G7H8','pending','',-1);
    pay(3,'Emeka Nwosu','OKV/2026/0199','JSS2','A',ftTuition,'Tuition',150000,80000,'PAY-I9J0K1L2','confirmed-partial',80000,-3);
    pay(4,'Tolu Adeyemi','OKV/2025/0176','JSS2','A',ftTuition,'Tuition',150000,150000,'PAY-M3N4O5P6','pending','',0);
    pay(5,'Zainab Musa','OKV/2026/0210','JSS2','A',ftPta,'PTA Levy',5000,5000,'PAY-Q7R8S9T0','confirmed-full',5000,-70);

    // Finance
    add('incomeRecord', { source:'Donation', description:'Alumni donation — library fund', amount:250000, date:ymd(-9) });
    add('incomeRecord', { source:'Rentals', description:'Hall rental — weekend event', amount:80000, date:ymd(-4) });
    const pj = add('project', { name:'Science Lab Renovation', budget:1200000, startDate:ymd(-30), endDate:ymd(60), status:'Ongoing' }, 'demo_proj_1');
    add('expense', { category:'Utilities', description:'Electricity bill', amount:320000, date:ymd(-8), projectId:'' });
    add('expense', { category:'Maintenance', description:'Roof repairs', amount:210000, date:ymd(-6), projectId:'' });
    add('expense', { category:'Materials', description:'Lab equipment deposit', amount:450000, date:ymd(-3), projectId:pj });

    // Timetable — JSS2A, first week
    const TT = [['Monday','Period 1','Mathematics','usr_tunde'],['Monday','Period 2','English Language','usr_blessing'],['Monday','Period 3','Basic Science','usr_blessing'],
                ['Tuesday','Period 1','English Language','usr_blessing'],['Tuesday','Period 2','Mathematics','usr_tunde'],['Tuesday','Period 4','Civic Education','usr_blessing'],
                ['Wednesday','Period 1','Basic Science','usr_blessing'],['Wednesday','Period 3','Mathematics','usr_tunde'],['Thursday','Period 2','Social Studies','usr_blessing'],
                ['Thursday','Period 5','Mathematics','usr_tunde'],['Friday','Period 1','Computer Studies','usr_blessing'],['Friday','Period 2','Mathematics','usr_tunde']];
    TT.forEach(t => add('timetableEntry', { class:'JSS2', arm:'A', day:t[0], period:t[1], subject:t[2], teacherUserId:t[3], schoolId:'' }));
    // Make sure every weekday has a period for the demo teacher so "My Timetable Today" always shows something
    ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach((d,i) => add('timetableEntry', { class:'JSS2', arm:'B', day:d, period:'Period '+(6+(i%2)), subject:'Mathematics', teacherUserId:'usr_tunde', schoolId:'' }));

    // Announcements
    add('announcement', { title:'First Term resumption', message:'School resumes Monday for all classes. Please ensure students are in full uniform.', audience:['Everyone'], schoolId:'', createdBy:'usr_demo_admin', createdByName:'Demo Admin', createdAt:iso(-2) }, null, -2);
    add('announcement', { title:'Staff meeting', message:'Friday 3pm in the staff room — agenda: CA schedule and CBT rollout.', audience:['Teacher'], schoolId:'', createdBy:'usr_demo_admin', createdByName:'Demo Admin', createdAt:iso(-4) }, null, -4);
    add('announcement', { title:'PTA levy deadline', message:'The PTA levy deadline has been extended to the end of the month.', audience:['Everyone'], schoolId:'', createdBy:'usr_demo_admin', createdByName:'Demo Admin', createdAt:iso(-9) }, null, -9);

    // CBT + assignments
    const q = (t, o, c) => ({ text:t, options:o, correctIndex:c });
    const cbtLive = add('cbtTest', { class:'JSS2', arm:'A', subject:'Mathematics', schoolId:'', topic:'Algebraic Expressions', instructions:'Answer all questions.', allocatedMinutes:20,
      startTime:iso(-1,8), stopTime:iso(5,18), teacherUserId:'usr_tunde',
      questions:[ q('Simplify 3x + 2x',['5x','6x','5x²','x'],0), q('What is the value of 2a when a = 4?',['6','8','2','16'],1), q('Expand 2(x + 3)',['2x+3','2x+6','x+6','2x+5'],1) ] }, 'demo_cbt_1', -3);
    add('cbtTest', { class:'JSS2', arm:'A', subject:'English Language', schoolId:'', topic:'Comprehension', instructions:'Read carefully.', allocatedMinutes:15,
      startTime:iso(-14,8), stopTime:iso(-13,18), teacherUserId:'usr_blessing',
      questions:[ q('A noun is…',['a naming word','an action word','a joining word','a describing word'],0) ] }, 'demo_cbt_2', -15);
    [[0,3,3],[1,1,3],[2,2,3]].forEach((r,i) => add('cbtSubmission', { testId:cbtLive, studentId:studentIds[r[0]], status:'submitted', score:r[1], totalQuestions:r[2], autoReason:'manual', startedAt:iso(-0.2), submittedAt:iso(-0.19) }, 'demo_sub_'+i, -1));

    const asg = add('assignment', { class:'JSS2', arm:'A', subject:'English Language', schoolId:'', title:'Chapter 4 Comprehension', instructions:'Answer the questions at the end of Chapter 4.', dueDate:ymd(5), attachmentUrl:'', teacherUserId:'usr_blessing' }, 'demo_asg_1', -4);
    add('assignment', { class:'JSS2', arm:'A', subject:'Mathematics', schoolId:'', title:'Algebra worksheet', instructions:'Complete worksheet 3.', dueDate:ymd(8), attachmentUrl:'', teacherUserId:'usr_tunde' }, 'demo_asg_2', -2);
    [0,1,2].forEach(i => add('assignmentSubmission', { assignmentId:asg, studentId:studentIds[i], studentName:studentRows[i][0], responseText:'My answers to the comprehension questions…', submittedAt:iso(-1) }, null, -1));


    /* ---------- Richer history so every chart and metric on every dashboard has something real to show ---------- */
    let seedN = 20260101;
    const rnd = () => { seedN = (seedN * 1664525 + 1013904223) % 4294967296; return seedN / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const FIRST = ['Obinna','Ngozi','Ibrahim','Sade','Kelechi','Yusuf','Folake','Chinedu','Halima','Tobi','Amaka','Segun','Bisi','Emeka','Rashida','Dayo','Chioma','Musa','Titi','Uche'];
    const SUR = ['ADEBAYO','NWANKWO','BELLO','OGUNDIPE','EZEOKE','ABUBAKAR','OLADIPO','OKORO','SANI','AKINTOLA','UDOH','LAWAL','IKPEAZU','FASHOLA','MUSA','ADEYEMI'];
    const extraPlan = [['KG2','A',4],['Primary 3','A',8],['JSS1','A',8],['JSS2','A',3],['JSS3','A',9],['SS1','A',7]];
    let admSeq = 400;
    const extraStudentIds = [];
    extraPlan.forEach(([cls, arm, n]) => { for (let i = 0; i < n; i++) {
      const g = rnd() < 0.5 ? 'F' : 'M', nm = pick(SUR) + ' ' + pick(FIRST);
      const id = add('student', { fullName:nm, admissionNo:'OKV/2026/' + String(++admSeq).padStart(4, '0'), class:cls, arm, schoolId:'', gender:g, dob:'2012-0' + (1 + i % 9) + '-1' + (i % 9),
        guardianPhone:'0803 000 ' + String(1000 + admSeq), guardianEmail:'parent' + admSeq + '@example.com', address:'Ado-Ekiti', active:true, photo:avatar(nm, (admSeq * 37) % 360) }, 'demo_stu_x' + admSeq, -45);
      extraStudentIds.push(id); } });
    // Two students have left (inactive) so the "inactive" notes and filters have data.
    add('student', { fullName:'LEFT Pupil', admissionNo:'OKV/2024/0090', class:'JSS3', arm:'A', schoolId:'', gender:'M', dob:'2011-02-02', guardianPhone:'', guardianEmail:'', address:'', active:false, photo:'' }, 'demo_stu_left', -400);

    const allStu = recs.filter(r => r.type === 'student' && r.payload.active !== false);
    const section = c => ({ KG2:'Kindergarten', 'Primary 3':'Primary' }[c] || 'Secondary');
    const subjFor = { Kindergarten:['Number Work','Letter Work','Phonics','Rhymes and Songs','Colouring and Drawing','Health Habits'], Primary:['English Language','Mathematics','Basic Science','Social Studies','Creative Arts'], Secondary:subjects };
    const have = {}; recs.filter(r => r.type === 'score').forEach(r => { have[r.payload.studentId + '|' + r.payload.subject + '|' + r.payload.term + '|' + r.payload.session] = true; });
    const gradeOf = t => t>=70?['A','Excellent']:t>=60?['B','Very Good']:t>=50?['C','Good']:t>=45?['D','Fair']:t>=40?['E','Poor']:['F','Fail'];
    const ability = {}; allStu.forEach(s => { ability[s.recordId] = 38 + rnd() * 50; });
    const teacherFor = sub => sub === 'Mathematics' ? 'usr_tunde' : 'usr_blessing';
    const addScore = (stu, sub, term, session, base, ca3) => {
      const key = stu.recordId + '|' + sub + '|' + term + '|' + session; if (have[key]) return; have[key] = true;
      const total = Math.max(8, Math.min(98, Math.round(base + (rnd() - 0.5) * 22)));
      const nCa = ca3 ? 3 : 2, caMax = ca3 ? 13 : 20, ca = [];
      let left = Math.round(total * 0.4);
      for (let i = 0; i < nCa; i++) { const v = Math.min(caMax, Math.round(left / (nCa - i))); ca.push(v); left -= v; }
      const exam = total - ca.reduce((a, b) => a + b, 0), g = gradeOf(total);
      add('score', { studentId:stu.recordId, class:stu.payload.class, arm:stu.payload.arm, subject:sub, term, session, ca, exam, total, grade:g[0], remark:g[1], teacherUserId:teacherFor(sub) });
    };
    allStu.forEach(stu => {
      const sec = section(stu.payload.class), ca3 = sec !== 'Secondary';
      (subjFor[sec] || []).forEach(sub => addScore(stu, sub, TERM, SESSION, ability[stu.recordId], ca3));
      // earlier terms (Mathematics only) so the term-by-term trend has history
      if (sec === 'Secondary') { addScore(stu, 'Mathematics', 'Third Term', '2025/2026', ability[stu.recordId] - 3, false); addScore(stu, 'Mathematics', 'Second Term', '2025/2026', ability[stu.recordId] - 8, false); }
    });

    // Teacher assignments (so teachers have their own classes and subjects)
    add('classTeacher', { class:'JSS1', arm:'A', teacherUserId:'usr_blessing', schoolId:'' }, 'demo_ct_2', -30);
    add('subjectAssignment', { class:'JSS1', arm:'A', subject:'Mathematics', teacherUserId:'usr_tunde', schoolId:'' }, 'demo_sa_4', -30);
    add('subjectAssignment', { class:'JSS3', arm:'A', subject:'Mathematics', teacherUserId:'usr_tunde', schoolId:'' }, 'demo_sa_5', -30);
    add('subjectAssignment', { class:'JSS1', arm:'A', subject:'English Language', teacherUserId:'usr_blessing', schoolId:'' }, 'demo_sa_6', -30);

    // Fees: every student has a fee record this term, with a realistic spread of balances
    const haveFee = {}; recs.filter(r => r.type === 'feeRecord').forEach(r => { haveFee[r.payload.studentId] = true; });
    allStu.forEach(stu => {
      if (haveFee[stu.recordId]) return;
      const sec = section(stu.payload.class), due = sec === 'Kindergarten' ? 80000 : sec === 'Primary' ? 110000 : 150000;
      const f = pick([1, 1, 1, 0.8, 0.5, 0.5, 0.2, 0]);
      add('feeRecord', { studentId:stu.recordId, term:TERM, session:SESSION, amountDue:due, amountPaid:Math.round(due * f) });
    });
    // Confirmed payments spread over the last six months, plus a few pending and rejected
    for (let m = 5; m >= 0; m--) {
      const count = 3 + Math.floor(rnd() * 5);
      for (let k = 0; k < count; k++) {
        const stu = pick(allStu), amt = pick([30000, 50000, 80000, 110000, 150000]), day = -(m * 30 + 2 + Math.floor(rnd() * 24));
        add('feePayment', { studentId:stu.recordId, admissionNo:stu.payload.admissionNo, fullName:stu.payload.fullName, class:stu.payload.class, arm:stu.payload.arm, term:TERM, session:SESSION,
          feeTypeId:ftTuition, feeTypeName:'Tuition', expectedAmount:150000, declaredAmount:amt, receiptDataUrl:'', payerEmail:'parent@example.com', paymentReference:'PAY-' + (10000000 + Math.floor(rnd() * 89999999)).toString(36).toUpperCase().slice(0, 8),
          status: amt >= 150000 ? 'confirmed-full' : 'confirmed-partial', confirmedAmount:amt, bursarNote:'', confirmedAt:iso(day), confirmedBy:'Ngozi Umeh', submittedAt:iso(day - 1) }, null, day - 1);
      }
    }
    add('feePayment', { studentId:allStu[7].recordId, admissionNo:allStu[7].payload.admissionNo, fullName:allStu[7].payload.fullName, class:allStu[7].payload.class, arm:allStu[7].payload.arm, term:TERM, session:SESSION, feeTypeId:ftPta, feeTypeName:'PTA Levy', expectedAmount:5000, declaredAmount:5000, receiptDataUrl:'', payerEmail:'parent@example.com', paymentReference:'PAY-ZX81QK02', status:'rejected', confirmedAmount:0, bursarNote:'Receipt not clear', confirmedAt:iso(-5), confirmedBy:'Ngozi Umeh', submittedAt:iso(-6) }, null, -6);

    // Finance: six months of income and expenses
    for (let m = 5; m >= 0; m--) {
      add('incomeRecord', { source:pick(['Donation','Rentals','Grant']), description:'Other income', amount:Math.round(40000 + rnd() * 140000), date:ymd(-(m * 30 + 6)) });
      ['Utilities','Maintenance','Salaries support','Stationery','Transport'].forEach((cat, i) => { if (rnd() < 0.8) add('expense', { category:cat, description:cat + ' payment', amount:Math.round((cat === 'Utilities' ? 220000 : 60000) + rnd() * 180000), date:ymd(-(m * 30 + 3 + i * 3)), projectId:'' }); });
    }

    // Learning activity and announcements spread over six months
    for (let m = 5; m >= 0; m--) {
      const n = 2 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const stu = pick(allStu), off = -(m * 30 + 1 + Math.floor(rnd() * 25));
        add('cbtSubmission', { testId: rnd() < 0.6 ? 'demo_cbt_1' : 'demo_cbt_2', studentId:stu.recordId, status:'submitted', score:Math.floor(rnd() * 4), totalQuestions:3, autoReason:'manual', startedAt:iso(off), submittedAt:iso(off) }, null, off);
        if (rnd() < 0.8) add('assignmentSubmission', { assignmentId: rnd() < 0.5 ? 'demo_asg_1' : 'demo_asg_2', studentId:stu.recordId, studentName:stu.payload.fullName, responseText:'My answer…', submittedAt:iso(off) }, null, off);
      }
      add('announcement', { title:'Notice ' + (6 - m), message:'School notice for the month.', audience:['Everyone'], schoolId:'', createdBy:'usr_demo_admin', createdByName:'Demo Admin', createdAt:iso(-(m * 30 + 4)) }, null, -(m * 30 + 4));
    }
    // This week's activity (so the "7 days" numbers are not zero)
    [0, 1, 2, 3].forEach(k => add('cbtSubmission', { testId:'demo_cbt_1', studentId:allStu[k].recordId, status:'submitted', score:2, totalQuestions:3, autoReason:'manual', startedAt:iso(-k), submittedAt:iso(-k) }, null, -k));
    [0, 1, 2].forEach(k => add('assignmentSubmission', { assignmentId:'demo_asg_2', studentId:allStu[k].recordId, studentName:allStu[k].payload.fullName, responseText:'Done.', submittedAt:iso(-k) }, null, -k));

    // Timetable for more classes and teachers
    [['JSS1','A','Mathematics','usr_tunde'],['JSS3','A','Mathematics','usr_tunde'],['JSS1','A','English Language','usr_blessing'],['SS1','A','Computer Studies','usr_blessing']].forEach((t, i) => {
      ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach((day, di) => { if ((di + i) % 2 === 0) add('timetableEntry', { class:t[0], arm:t[1], day, period:'Period ' + (3 + (di % 4)), subject:t[2], teacherUserId:t[3], schoolId:'' }); });
    });

    // Attendance summary lives server-side in the real app; the mock keeps its own copy below.
    return recs;
  }


  /* ---------- Platform owner sample data (14 schools) ---------- */
  function seedPlatform(){
    const day = 864e5, at = (n) => new Date(Date.now() + n * day).toISOString();
    const cap = (pct, st, mo) => ({ cellsUsed: Math.round(pct * 100000), cellsPct: pct, status: st, estMonthsTo90: mo, recommendation: st === 'Healthy' ? '' : 'Run the archive job now.', archivingOn: true, attendanceMode: 'summary', lastArchiveRunAt: at(-9), lastArchiveRowsMoved: 420, lastArchiveCellsReclaimed: 2940 });
    const mk = (i, name, admin, plan, cycle, status, created, users, extra) => Object.assign({ orgId:'org_' + i, orgName:name, adminName:admin, email:admin.split(' ')[1].toLowerCase() + '@' + name.split(' ')[0].toLowerCase() + '.example', phone:'080' + (31000000 + i * 1131),
      plan, billingCycle:cycle, subscriptionStatus:status, trialEndDate:'', subscriptionExpiry:'', userCount:users, createdAt:at(created), capacity:cap(8 + i * 3, i % 7 === 0 ? 'Monitor' : 'Healthy', i % 7 === 0 ? 14 : 60) }, extra || {});
    return {
      orgs: [
        mk(1, 'Greenwood International School', 'Grace Adewale', 'premium', 'yearly', 'active', -150, 22, { subscriptionExpiry: at(200) }),
        mk(2, 'Sunrise Academy', 'Bola Musa', 'essentials', 'yearly', 'active', -120, 11, { subscriptionExpiry: at(5) }),
        mk(3, 'Crestview College', 'Emeka Okoro', 'essentials', 'biannual', 'active', -100, 14, { subscriptionExpiry: at(19) }),
        mk(4, 'Royal Heritage Secondary School', 'Tunde Lawal', 'premium', 'monthly', 'active', -80, 31, { subscriptionExpiry: at(12) }),
        mk(5, 'Pathfinder Tutorial College', 'Sade Bello', 'essentials', 'monthly', 'active', -60, 6, { subscriptionExpiry: at(26) }),
        mk(6, 'Bright Future International School', 'Ngozi Eze', 'premium', 'biannual', 'active', -45, 27, { subscriptionExpiry: at(33) }),
        mk(7, 'Hillside Academy', 'Kunle Ajayi', 'essentials', 'monthly', 'active', -30, 9, { subscriptionExpiry: at(40) }),
        mk(8, 'Riverbend Comprehensive College', 'Hauwa Sani', 'essentials', 'monthly', 'trial', -6, 4, { trialEndDate: at(1) }),
        mk(9, 'Emerald Schools Group', 'Peter Udoh', 'premium', 'monthly', 'trial', -4, 7, { trialEndDate: at(3) }),
        mk(10, 'Grace Mission Primary', 'Ruth Ikpeazu', 'essentials', 'monthly', 'trial', -3, 3, { trialEndDate: at(4) }),
        mk(11, 'Little Stars Nursery', 'Amaka Nwankwo', 'essentials', 'monthly', 'trial', -2, 2, { trialEndDate: at(5) }),
        mk(12, 'Summit High School', 'Dayo Fashola', 'essentials', 'monthly', 'trial', -1, 2, { trialEndDate: at(6) }),
        mk(13, 'Old Oak College', 'Segun Akintola', 'essentials', 'monthly', 'expired', -210, 5, { subscriptionExpiry: at(-20) }),
        mk(14, 'Faith Academy', 'Titi Oladipo', 'essentials', 'biannual', 'cancelled', -240, 3, { subscriptionExpiry: at(-45) })
      ],
      pending: [
        { orgId:'org_8', recordId:'upg_1', orgName:'Riverbend Comprehensive College', fullName:'Hauwa Sani', email:'sani@riverbend.example', phone:'0803 100 2000', requestedPlan:'essentials', requestedLabel:'Essentials — Bi-Annual', submittedAt:at(-1), hasScreenshot:true },
        { orgId:'org_9', recordId:'upg_2', orgName:'Emerald Schools Group', fullName:'Peter Udoh', email:'udoh@emerald.example', phone:'0805 300 4000', requestedPlan:'premium', requestedLabel:'Premium — Yearly', submittedAt:at(0), hasScreenshot:true }
      ],
      config: { branding:{ siteName:'OKV School Management System', primaryColor:'#14213D', secondaryColor:'#B8863B' }, email:{ provider:'' }, sms:{ enabled:false }, whatsapp:{ enabled:false }, payment:{ manual:{ bankName:'Access Bank', accountName:'OKV Technology (Demo)', accountNumber:'0123456789' } } }
    };
  }

  /* ---------- 4. Shared in-tab database (sessionStorage) ---------- */
  const DB_KEY = 'demo_db_v1';
  function loadDb(){
    let raw = _get.call(sessionStorage, DB_KEY);
    if (!raw) {
      const db = {
        records: seed(),
        users: [
          { userId:'usr_demo_admin', roles:['Super Administrator'], fullName:'Demo Admin', username:'demo_admin', email:'admin@greenwood.example', active:'TRUE', createdAt:iso(-60), assignedSchoolIds:[] },
          { userId:'usr_principal', roles:['Principal / Head Teacher'], fullName:'Grace Adewale', username:'grace.adewale', email:'grace@greenwood.example', active:'TRUE', createdAt:iso(-58), assignedSchoolIds:[] },
          { userId:'usr_ngozi', roles:['Bursar / Accountant'], fullName:'Ngozi Umeh', username:'ngozi.umeh', email:'ngozi@greenwood.example', active:'TRUE', createdAt:iso(-55), assignedSchoolIds:[] },
          { userId:'usr_tunde', roles:['Teacher'], fullName:'Tunde Bakare', username:'tunde.bakare', email:'tunde@greenwood.example', active:'TRUE', createdAt:iso(-55), assignedSchoolIds:[] },
          { userId:'usr_blessing', roles:['Academic Officer / Exam Officer'], fullName:'Blessing Okafor', username:'blessing.okafor', email:'blessing@greenwood.example', active:'FALSE', createdAt:iso(-50), assignedSchoolIds:[] }
        ],
        messages: [
          { recordId:'demo_msg_1', payload:{ fromUserId:'usr_ngozi', fromName:'Ngozi Umeh', toUserIds:['usr_demo_admin','usr_principal'], subject:'PTA levy total', body:'Can you confirm the PTA levy total for JSS2 before Friday?', sentAt:iso(-1), readBy:[] } },
          { recordId:'demo_msg_2', payload:{ fromUserId:'usr_tunde', fromName:'Tunde Bakare', toUserIds:['usr_demo_admin','usr_blessing'], subject:'CBT questions submitted', body:'I have submitted my CBT questions for the mid-term test.', sentAt:iso(-2), readBy:['usr_demo_admin'] } }
        ],
        attendance: [], attendanceSummary: {}, seq: 1000,
        platform: seedPlatform()
      };
      // Term attendance for every active student, so attendance rates and charts have real figures.
      let an = 99; const arnd = () => { an = (an * 1103515245 + 12345) % 2147483648; return an / 2147483648; };
      db.records.filter(r => r.type === 'student' && r.payload.active !== false).forEach(s => {
        const total = 58, absent = Math.floor(arnd() * (s.payload.class === 'JSS3' ? 9 : 6)), late = Math.floor(arnd() * 4), present = total - absent - late;
        db.attendanceSummary[`${s.recordId}|${TERM}|${SESSION}`] = { studentId:s.recordId, classArm:`${s.payload.class}|${s.payload.arm}`, term:TERM, session:SESSION, presentCount:present, absentCount:absent, lateCount:late, totalDays:total };
      });
      _set.call(sessionStorage, DB_KEY, JSON.stringify(db));
      return db;
    }
    return JSON.parse(raw);
  }
  function saveDb(db){ _set.call(sessionStorage, DB_KEY, JSON.stringify(db)); }
  const uid = (db, p) => p + '_' + (++db.seq);

  /* ---------- 5. Replacement for sync.js's window.smsSync ---------- */
  const listeners = [];
  function status(){ return { online:true, syncing:false, pending:0, lastSynced:new Date().toISOString() }; }
  function emit(){ const d = status(); listeners.forEach(cb => { try { cb(d); } catch(e){} }); window.dispatchEvent(new CustomEvent('sms-sync-status', { detail:d })); }
  window.addEventListener('storage', (e) => { if (e.key === DB_KEY) emit(); }); // another tab-frame saved something
  function toast(msg){
    let el = document.getElementById('smsToast');
    if (!el) { el = document.createElement('div'); el.id = 'smsToast';
      el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#14213D;color:#fff;padding:.6rem 1rem;border-radius:10px;font-size:.82rem;z-index:3000;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:92vw;text-align:center;transition:opacity .3s;';
      document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 3500);
  }
  window.smsDemoSync = {
    saveRecord: async (type, payload, recordId) => {
      const db = loadDb(); const now = new Date().toISOString();
      const existing = recordId ? db.records.find(r => r.recordId === recordId) : null;
      if (existing) { existing.payload = payload; existing.updatedAt = now; saveDb(db); emit(); return existing.recordId; }
      const rid = recordId || uid(db, 'demo_' + type);
      db.records.push({ recordId:rid, type, payload, createdAt:now, updatedAt:now });
      saveDb(db); emit(); return rid;
    },
    deleteRecord: async (recordId) => { const db = loadDb(); db.records = db.records.filter(r => r.recordId !== recordId); saveDb(db); emit(); },
    getRecords: async (type) => JSON.parse(JSON.stringify(loadDb().records.filter(r => r.type === type))),
    syncNow: async () => { emit(); return { ok:true, pushed:0, failed:0 }; },
    pendingCount: async () => 0,
    onStatus: (cb) => { listeners.push(cb); setTimeout(() => { try { cb(status()); } catch(e){} }, 0); },
    toast
  };
  window.smsSync = window.smsDemoSync;

  /* ---------- 6. Mock Apps Script API ---------- */
  const okGrade = (t) => t>=70?'A':t>=60?'B':t>=50?'C':t>=45?'D':t>=40?'E':'F';
  const HANDLERS = {
    login: () => ({ ok:true, ...buildSession(currentProfileKey()) }),
    logout: () => ({ ok:true }),
    changePassword: () => ({ ok:true }),
    forgotPassword: () => ({ ok:true }),
    listUsers: () => { const db = loadDb(); return { ok:true, users:db.users, allRoles:['Super Administrator','School Administrator','Principal / Head Teacher','Academic Officer / Exam Officer','Teacher','Bursar / Accountant','Result Viewer / Parent Portal User'] }; },
    listOrgUsersBasic: () => ({ ok:true, users: loadDb().users.map(u => ({ userId:u.userId, fullName:u.fullName, username:u.username, roles:u.roles })) }),
    createUser: (b) => { const db = loadDb();
      if (!b.username) return { ok:false, error:'Missing fields' };
      if (db.users.some(u => u.username.toLowerCase() === String(b.username).toLowerCase())) return { ok:false, error:'Username already taken' };
      if (!(b.roles||[]).length) return { ok:false, error:'Select at least one role' };
      db.users.push({ userId:uid(db,'usr'), roles:b.roles, fullName:b.fullName||b.username, username:b.username, email:b.email||'', active:'TRUE', createdAt:new Date().toISOString(), assignedSchoolIds:b.assignedSchoolIds||[] });
      saveDb(db); return { ok:true }; },
    editUser: (b) => { const db = loadDb(); const u = db.users.find(x => x.userId === b.targetUserId); if (!u) return { ok:false, error:'User not found' };
      Object.assign(u, { fullName:b.fullName, email:b.email, roles:b.roles, active: b.active ? 'TRUE' : 'FALSE', assignedSchoolIds:b.assignedSchoolIds||[] }); saveDb(db); return { ok:true }; },
    deleteUser: (b) => { const db = loadDb(); if (b.targetUserId === 'usr_demo_admin') return { ok:false, error:'You cannot delete your own account.' };
      db.users = db.users.filter(u => u.userId !== b.targetUserId); saveDb(db); return { ok:true }; },
    setUserPassword: () => ({ ok:true }),
    bulkImportUsers: (b) => { const db = loadDb(); const created = [], skipped = [];
      (b.rows||[]).forEach(r => {
        if (!r.username) { skipped.push({ username:'(blank)', reason:'Missing username' }); return; }
        if (db.users.some(u => u.username.toLowerCase() === String(r.username).toLowerCase())) { skipped.push({ username:r.username, reason:'Username already taken' }); return; }
        db.users.push({ userId:uid(db,'usr'), roles:[].concat(r.roles && r.roles.length ? r.roles : ['Teacher']), fullName:r.fullName||r.username, username:r.username, email:r.email||'', active:'TRUE', createdAt:new Date().toISOString(), assignedSchoolIds:[] });
        created.push(r.username); });
      saveDb(db); return { ok:true, created, skipped }; },
    getData: (b) => { const db = loadDb(); return { ok:true, records: db.records.filter(r => !b.type || r.type === b.type) }; },
    saveData: (b) => ({ ok:true, recordId:b.recordId || b.localId }),
    deleteData: () => ({ ok:true }),
    markAttendance: (b) => { const db = loadDb(); const [cls, arm] = String(b.classArm).split('|');
      const old = db.attendance.find(a => a.classArm === b.classArm && a.date === b.date);
      const oldSt = old ? old.statuses : {};
      new Set([...Object.keys(oldSt), ...Object.keys(b.statuses)]).forEach(sid => {
        const was = oldSt[sid] || null, now = b.statuses[sid] || null; if (was === now) return;
        const key = `${sid}|${b.term}|${b.session}`;
        const s = db.attendanceSummary[key] || (db.attendanceSummary[key] = { studentId:sid, classArm:b.classArm, term:b.term, session:b.session, presentCount:0, absentCount:0, lateCount:0, totalDays:0 });
        const f = { present:'presentCount', absent:'absentCount', late:'lateCount' };
        if (was) s[f[was]] = Math.max(0, s[f[was]] - 1); if (now) s[f[now]]++;
        if (!was && now) s.totalDays++; if (was && !now) s.totalDays = Math.max(0, s.totalDays - 1);
      });
      if (old) old.statuses = b.statuses; else db.attendance.push({ classArm:b.classArm, date:b.date, term:b.term, session:b.session, statuses:b.statuses });
      saveDb(db); return { ok:true }; },
    getAttendanceForClass: (b) => { const a = loadDb().attendance.find(x => x.classArm === b.classArm && x.date === b.date);
      return { ok:true, record: a ? { recordId:'demo_att', payload:{ ...a, markedBy:'usr_demo_admin' } } : null }; },
    getAttendanceSummary: (b) => ({ ok:true, summaries: Object.values(loadDb().attendanceSummary).filter(s => (!b.term || s.term===b.term) && (!b.session || s.session===b.session) && (!b.classArm || s.classArm===b.classArm)) }),
    getArchiveSummary: () => ({ ok:true, total:1240, byType:{ score:{ count:980, sessions:{ '2023/2024':540, '2022/2023':440 } }, cbtSubmission:{ count:260, sessions:{} } }, rules:{} }),
    restoreArchived: (b) => ({ ok:true, restored: b.type === 'score' ? (b.session ? 540 : 980) : 260 }),
    platformListOrgs: () => ({ ok:true, orgs: loadDb().platform.orgs }),
    platformListPendingUpgrades: () => ({ ok:true, pending: loadDb().platform.pending }),
    platformReviewUpgrade: (b) => { const db = loadDb(); const p = db.platform.pending.find(x => x.recordId === b.recordId); if (!p) return { ok:false, error:'Request not found' };
      if (b.decision === 'confirmed') { const o = db.platform.orgs.find(x => x.orgId === p.orgId); if (o) { o.subscriptionStatus = 'active'; o.plan = p.requestedPlan; o.subscriptionExpiry = new Date(Date.now() + 365 * 864e5).toISOString(); } }
      db.platform.pending = db.platform.pending.filter(x => x.recordId !== b.recordId); saveDb(db); return { ok:true }; },
    platformUpdateOrgContact: (b) => { const db = loadDb(); const o = db.platform.orgs.find(x => x.orgId === b.orgId); if (!o) return { ok:false, error:'School not found' }; Object.assign(o, { orgName:b.orgName, adminName:b.adminName, email:b.email, phone:b.phone }); saveDb(db); return { ok:true }; },
    platformUpdateOrgPlan: (b) => { const db = loadDb(); const o = db.platform.orgs.find(x => x.orgId === b.orgId); if (!o) return { ok:false, error:'School not found' }; Object.assign(o, { plan:b.plan, billingCycle:b.billingCycle, subscriptionStatus:b.subscriptionStatus, trialEndDate:b.trialEndDate, subscriptionExpiry:b.subscriptionExpiry }); saveDb(db); return { ok:true }; },
    platformSendMessage: (b) => { const n = b.targetOrgId && b.targetOrgId !== 'ALL' ? 1 : loadDb().platform.orgs.length; return { ok:true, emailSent:n, totalTargets:n, smsNote: (b.channels||[]).includes('sms') ? 'SMS is not connected in the demo.' : '', whatsappNote: (b.channels||[]).includes('whatsapp') ? 'WhatsApp is not connected in the demo.' : '' }; },
    platformGetConfig: () => ({ ok:true, config: loadDb().platform.config }),
    platformSaveConfig: (b) => { const db = loadDb(); db.platform.config = b.config || db.platform.config; saveDb(db); return { ok:true }; },
    exportBackup: () => { const db = loadDb(); return { ok:true, exportedAt:new Date().toISOString(), orgId:'org_demo', orgName:'Greenwood International School',
      users: db.users, records: db.records.map(r => ({ recordId:r.recordId, type:r.type, payload:r.payload, createdAt:r.createdAt, updatedAt:r.updatedAt })) }; },
    generateResultPasscodes: (b) => { const db = loadDb();
      const list = db.records.filter(r => r.type === 'student' && r.payload.class === b.classFilter && (r.payload.arm||'') === (b.arm||'') && r.payload.active !== false);
      return { ok:true, length:8, students: list.map((r,i) => ({ fullName:r.payload.fullName, admissionNo:r.payload.admissionNo, passcode:String(48291367 + i*7919631).slice(-8) })) }; },
    resetCbtSubmission: (b) => { const db = loadDb(); db.records = db.records.filter(r => r.recordId !== b.recordId); saveDb(db); return { ok:true }; },
    confirmFeePayment: (b) => { const db = loadDb(); const r = db.records.find(x => x.recordId === b.recordId);
      if (!r) return { ok:false, error:'Payment not found' };
      if (r.payload.status !== 'pending') return { ok:false, error:'This payment has already been processed.' };
      const amount = b.decision === 'confirmed' ? Math.max(0, Number(b.confirmedAmount)||0) : 0;
      const label = b.decision === 'rejected' ? 'rejected' : (r.payload.expectedAmount && amount >= r.payload.expectedAmount) ? 'confirmed-full' : amount > 0 ? 'confirmed-partial' : 'confirmed-unpaid';
      Object.assign(r.payload, { status:label, confirmedAmount:amount, bursarNote:b.bursarNote||'', confirmedAt:new Date().toISOString(), confirmedBy:buildSession(currentProfileKey()).fullName });
      r.updatedAt = new Date().toISOString(); saveDb(db); return { ok:true, status:label }; },
    sendFeeListEmail: () => ({ ok:true, sent:0, demo:true }),
    sendParentCommunication: (b) => ({ ok:true, results:(b.recipients||[]).map(r => ({ name:r.name || r.fullName || 'Parent', channels:Object.fromEntries((b.channels||['email']).map(c => [c, 'sent'])) })) }),
    sendStaffMessage: (b) => { const db = loadDb(); const me = buildSession(currentProfileKey());
      db.messages.push({ recordId:uid(db,'demo_msg'), payload:{ fromUserId:me.userId, fromName:me.fullName, toUserIds:b.toUserIds||[], subject:b.subject||'(no subject)', body:b.body, sentAt:new Date().toISOString(), readBy:[] } });
      saveDb(db); emit(); return { ok:true }; },
    listMyStaffMessages: () => { const db = loadDb(); const me = buildSession(currentProfileKey()).userId;
      const mineMsgs = db.messages.filter(m => m.payload.fromUserId === me || (m.payload.toUserIds||[]).includes(me)).sort((a,b) => new Date(b.payload.sentAt) - new Date(a.payload.sentAt));
      return { ok:true, messages:mineMsgs }; },
    markStaffMessageRead: (b) => { const db = loadDb(); const me = buildSession(currentProfileKey()).userId; const m = db.messages.find(x => x.recordId === b.recordId);
      if (m && !(m.payload.readBy||[]).includes(me)) { m.payload.readBy = [...(m.payload.readBy||[]), me]; saveDb(db); emit(); } return { ok:true }; },
    submitUpgradeRequest: (b) => { const db = loadDb();
      db.records.push({ recordId:uid(db,'demo_upg'), type:'upgradeRequest', payload:{ status:'pending', requestedPlan:b.plan, requestedLabel:b.plan, submittedAt:new Date().toISOString() }, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
      saveDb(db); emit(); return { ok:true }; },
    publicGetOrgInfo: () => ({ ok:true, schoolName:'Greenwood International School', schoolPhone:'0801 234 5678', schoolEmail:'info@greenwood.example', schoolAddress:'12 Unity Road, Ado-Ekiti' }),
    publicGetPlatformConfig: () => ({ ok:true, config:{} }),
    publicGetManualPaymentInfo: () => ({ ok:true, bankAccount:'0123456789', bankName:'Access Bank', bankAccountName:'OKV Technology (Demo)' })
  };
  const _fetch = window.fetch.bind(window);
  window.fetch = function(url, opts){
    try {
      if (opts && opts.method === 'POST' && typeof opts.body === 'string' && opts.body.charAt(0) === '{') {
        const body = JSON.parse(opts.body);
        if (body && body.action) {
          const h = HANDLERS[body.action];
          const out = h ? h(body) : { ok:false, error:'This action is not available in the demo.' };
          return new Promise(res => setTimeout(() => res(new Response(JSON.stringify(out), { status:200, headers:{ 'Content-Type':'application/json' } })), 120));
        }
      }
    } catch (e) { return Promise.resolve(new Response(JSON.stringify({ ok:false, error:'Demo error: ' + e.message }), { status:200 })); }
    return _fetch(url, opts);
  };

  /* ---------- 7. Navigation inside the demo ---------- */
  // "← Dashboard" links (target=_top) and Logout must stay inside the demo.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^dashboard\.html(#.*)?$/i.test(href)) {
      e.preventDefault();
      if (window.top !== window && window.top.showTab) window.top.showTab('home'); else window.top.location.href = 'dashboard.html';
    }
  }, true);
  window.addEventListener('DOMContentLoaded', () => {
    // logout-lib.js defines smsLogout after this file loads; wrap it once it exists.
    const wrap = () => { if (typeof window.smsLogout === 'function' && !window.smsLogout._demo) {
      const f = function(){ try { sessionStorage.removeItem('sms_demo'); } catch(e){} window.top.location.href = 'pricing.html'; }; f._demo = true; window.smsLogout = f; } };
    wrap(); setTimeout(wrap, 0);
  });

  /* ---------- 8. Banner + role switcher (top window only) ---------- */
  if (window.top !== window) return;
  window.addEventListener('DOMContentLoaded', () => {
    const H = 38;
    const css = document.createElement('style');
    css.textContent = `
      body{padding-top:${H}px !important;}
      #demoBar{position:fixed;top:0;left:0;right:0;height:${H}px;background:#8B1E3F;color:#fff;z-index:3500;display:flex;align-items:center;justify-content:center;gap:.6rem;flex-wrap:nowrap;padding:0 .6rem;font:600 .74rem system-ui,sans-serif;overflow:hidden;white-space:nowrap;}
      #demoBar select{font:600 .72rem system-ui;border-radius:6px;border:0;padding:.15rem .3rem;color:#14213D;max-width:150px;}
      #demoBar a{background:#B8863B;color:#14213D;font-weight:800;text-decoration:none;padding:.22rem .7rem;border-radius:8px;}
      #demoBar .lbl{opacity:.9;}
      @media print{#demoBar,#getStartedPopup{display:none !important;} body{padding-top:0 !important;}}
      @media (max-width:640px){ #demoBar .txt{display:none;} }
      .app-shell{height:calc(100vh - ${H}px) !important;}
      .main-col{height:calc(100vh - ${H}px) !important;}
      @media (max-width:900px){ .sidebar{top:${H}px !important;} }
      #getStartedPopup{position:fixed;bottom:20px;right:20px;max-width:290px;background:#fff;border-radius:16px;padding:1.1rem;box-shadow:0 20px 50px rgba(0,0,0,.3);border:1px solid #DCD0B4;z-index:3400;font-family:system-ui,sans-serif;}
      #getStartedPopup h5{font-size:.95rem;font-weight:800;color:#14213D;margin:0 0 .3rem;}
      #getStartedPopup p{font-size:.8rem;color:#7a7259;margin:0 0 .7rem;}
      #getStartedPopup .x{position:absolute;top:.4rem;right:.6rem;background:none;border:0;font-size:1rem;color:#7a7259;}
      #getStartedPopup a{display:block;text-align:center;background:#B8863B;color:#14213D;font-weight:800;text-decoration:none;padding:.5rem;border-radius:10px;font-size:.85rem;}`;
    document.head.appendChild(css);
    const bar = document.createElement('div'); bar.id = 'demoBar';
    const cur = currentProfileKey();
    bar.innerHTML = `<span class="txt">LIVE DEMO — sample data, nothing is saved.</span><span class="lbl">View as:</span>
      <select id="demoRole">${Object.keys(PROFILES).map(k => `<option value="${k}" ${k===cur?'selected':''}>${PROFILES[k].label}</option>`).join('')}</select>
      <a href="pricing.html" id="demoCta">Start 7-Day Free Trial</a>`;
    document.body.appendChild(bar);
    document.getElementById('demoRole').addEventListener('change', (e) => {
      _set.call(sessionStorage, 'demo_profile', e.target.value);
      _set.call(sessionStorage, 'demo_ls_sms_session', JSON.stringify(buildSession(e.target.value)));
      window.location.href = PROFILES[e.target.value] && PROFILES[e.target.value].platform ? 'superadmin.html' : 'dashboard.html';
    });
    document.getElementById('demoCta').addEventListener('click', () => { try { sessionStorage.removeItem('sms_demo'); } catch(e){} });
    setTimeout(() => {
      if (_get.call(sessionStorage, 'demo_popup_shown') || !document.body) return;
      _set.call(sessionStorage, 'demo_popup_shown', '1');
      const p = document.createElement('div'); p.id = 'getStartedPopup';
      p.innerHTML = `<button class="x" aria-label="Close">✕</button><h5>Like what you see?</h5><p>This is exactly what your school's dashboard looks like. Start your 7-day free trial — no card required.</p><a href="pricing.html">Get Started Now</a>`;
      p.querySelector('.x').onclick = () => p.remove();
      p.querySelector('a').onclick = () => { try { sessionStorage.removeItem('sms_demo'); } catch(e){} };
      document.body.appendChild(p);
    }, 15000);
  });
})();

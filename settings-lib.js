/*******************************************************************
 * SMS SETTINGS HELPER — reads/writes the single org "settings" record
 * on top of sync.js. Include after sync.js on any page that needs
 * classes/arms/subjects/CA-counts/principal signature.
 *******************************************************************/
(function(){
  function defaultSettings(){
    return {
      schoolName: '',
      schoolLogo: '',               // base64 data URL, resized/compressed client-side
      schoolAddress: '',
      schoolMotto: '',
      attendanceMode: 'summary',   // 'summary' (default) or 'detailed' — see SETUP_GUIDE.md, Attendance Archiving
      archivingEnabled: true,      // whether the monthly archive job processes this org at all
      weeklyAttendanceEmailsEnabled: false, // opt-in: emails every parent a weekly attendance digest (see SETUP_GUIDE.md — off by default since it can send real volume)
      termEndDate: '',             // YYYY-MM-DD — when set, a term attendance summary emails every parent once, on/after this date
      termSummarySentKey: '',      // internal — tracks which term+session's summary was already sent, so it's never duplicated
      schoolPhone: '',
      schoolEmail: '',
      schoolWebsite: '',            // printed on letterheads
      schoolRegNo: '',              // registration / approval number, printed on letterheads
      schoolLogo2: '',              // optional second logo (top-right of letterheads)
      brandPrimary: '',             // hex colour; blank = the classic wine red
      brandAccent: '',              // hex colour; blank = gold
      printFooter: '',              // optional note printed at the foot of printouts
      printWatermark: false,        // faint logo behind result sheets
      currentTerm: 'First Term',       // First Term / Second Term / Third Term
      currentSession: '',              // e.g. "2025/2026"
      classes: [],                 // e.g. ["JSS1","JSS2","SS1"]
      classArms: {},               // e.g. { "JSS1": ["A","B","C"] }
      classSections: {},           // e.g. { "JSS1": "Secondary" } — drives which CA count applies
      subjects: [],                // legacy flat list — kept for backward compatibility, superseded by subjectsBySection below
      subjectsBySection: { Kindergarten: [], Nursery: [], Primary: [], Secondary: [] }, // each section's own subject list
      caCounts: { Kindergarten: 3, Nursery: 3, Primary: 3, Secondary: 3 }, // 2, 3, or 4
      gradingMethod: 'AF',         // 'AF' = A–F (default) or 'WAEC' = A1–F9 (see results-lib.js)
      principalName: '',
      principalSignature: '',      // base64 data URL, resized/compressed client-side
      termInfo: {},                // key `${term}|${session}` -> { closingDate, resumptionDate, timesSchoolOpened }
      schools: [],                 // multi-school/branch support: [{ id, name, address }]
      activeSchoolId: ''           // which school/branch is currently selected for data entry views
    };
  }

  async function getSettings(){
    if (navigator.onLine) { try { await window.smsSync.syncNow(); } catch(e){} }
    const records = await window.smsSync.getRecords('settings');
    if (!records.length) return { recordId: null, payload: defaultSettings() };
    records.sort((a,b) => new Date(b.updatedAt||0) - new Date(a.updatedAt||0));
    const rec = records[0];
    const merged = { ...defaultSettings(), ...rec.payload };
    // Settings saved before the Kindergarten section existed lack its keys: fill them in so every page can rely on all four sections.
    merged.subjectsBySection = { Kindergarten: [], Nursery: [], Primary: [], Secondary: [], ...(rec.payload.subjectsBySection || {}) };
    merged.caCounts = { Kindergarten: 3, Nursery: 3, Primary: 3, Secondary: 3, ...(rec.payload.caCounts || {}) };
    return { recordId: rec.recordId, payload: merged };
  }

  async function saveSettings(payload, recordId){
    return window.smsSync.saveRecord('settings', payload, recordId);
  }

  // Resolves the subject list for a given class, using that class's section
  // (Kindergarten/Nursery/Primary/Secondary) to look up subjectsBySection, falling back to
  // the legacy flat `subjects` list for schools that haven't split them out yet.
  function subjectsForClass(settings, className){
    const section = (settings.classSections || {})[className];
    const bySection = (settings.subjectsBySection || {})[section];
    if (bySection && bySection.length) return bySection;
    return settings.subjects || [];
  }

  // Best guess at a class's section from its name, used when a class is added without choosing one.
  function guessSection(className){
    const n = String(className || '').trim().toLowerCase();
    if (/^(kg|k\.g|kindergarten|pre[- ]?(nursery|school|k))/.test(n)) return 'Kindergarten';
    if (/^(nursery|nur\b|creche|crèche|play ?group|reception)/.test(n)) return 'Nursery';
    if (/^(primary|pry|basic [1-6]\b|grade [1-6]\b|p[1-6]\b)/.test(n)) return 'Primary';
    return 'Secondary';
  }

  // Suggested starting subject lists, offered as one-tap buttons in Settings.
  const SUBJECT_PRESETS = {
    Kindergarten: ['Number Work','Letter Work','Phonics','Rhymes and Songs','Colouring and Drawing','Creative Activities','Health Habits','Social Habits','Bible/Islamic Studies'],
    Nursery: ['Writing','Reading','Number Work','Poem','Drawing and Colouring','Health Habit','Social Habits','Rhymes'],
    Primary: ['English Language','Mathematics','Basic Science','Social Studies','Civic Education','Computer Studies','Verbal Reasoning','Quantitative Reasoning','Creative Arts','Physical and Health Education']
  };

  window.smsSettings = { getSettings, saveSettings, defaultSettings, subjectsForClass, guessSection, SUBJECT_PRESETS };
})();

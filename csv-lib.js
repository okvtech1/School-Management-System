/*******************************************************************
 * SMS CSV LIB — shared CSV parse/export helpers for data-entry tabs.
 *******************************************************************/
function csvEscape(val){
  val = String(val ?? '');
  if (/[",\n]/.test(val)) return '"' + val.replace(/"/g,'""') + '"';
  return val;
}
function downloadCsv(content, filename){
  const blob = new Blob([content], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
// Handles quoted fields with embedded commas/newlines.
function parseCsv(text){
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  for (let i=0; i<text.length; i++){
    const c = text[i], next = text[i+1];
    if (inQuotes){
      if (c === '"' && next === '"'){ field += '"'; i++; }
      else if (c === '"'){ inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ','){ row.push(field); field=''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if (c === '\r'){ /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.length && r.some(v=>v.trim()!==''));
}
// Resizes/compresses an uploaded image client-side to a small data URL (fits in a Sheet cell).
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

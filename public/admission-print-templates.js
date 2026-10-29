/* ═══════════════════════════════════════════════════════
   Admission Admin — Shared print templates
   Lazy-loaded by the native Admission Admin module (Settings →
   Admit Card Designer / Form Designer, and the Print/Admit Card
   buttons) via _ensureAdmissionPrintTemplates() in _src/app.js.
   Ported verbatim from ccpc-admission/public/print-templates.js
   (plus its DEMO_APP sample data, originally in that app's app.js) —
   pure HTML-string generators, no backend calls, no adaptation needed.
   ═══════════════════════════════════════════════════════ */

function fmtDate(d){if(!d)return'';try{const dt=new Date(d);return isNaN(dt)?d:dt.toLocaleDateString('en-BD');}catch{return d;}}
function deepMerge(def,ovr){const r={...def};for(const k in(ovr||{})){if(ovr[k]&&typeof ovr[k]==='object'&&!Array.isArray(ovr[k]))r[k]=deepMerge(def[k]||{},ovr[k]);else r[k]=ovr[k];}return r;}

const DEMO_APP = {
  tracking_id:'1A2B', index_id:'26NU0001', session:'2026', class:'Nursery', category:'Army', version:'Bangla', quota:'No',
  name_english:'MD. DEMO STUDENT NAME', name_bangla:'মো. ডেমো ছাত্রের নাম', date_of_birth:'2010-01-15',
  blood_group:'B+', gender:'Male', religion:'Islam', birth_reg_no:'12345678901234567',
  nationality:'Bangladeshi', emergency_contact:'01700000000', height:'48', co_curricular:'Football, Drawing',
  last_institute:'Demo Primary School', last_class:'5', last_version:'Bangla',
  present_address:'123 Test Road, Cantonment, Chattogram', permanent_address:'Village: Demo, PO: Test, PS: Sample, Chattogram',
  father_name:'MD. DEMO FATHER', father_profession:'Army Officer', father_designation:'Major', father_education:'MSc Physics',
  father_contact:'01700000001', father_nid:'1234567890123', father_office_address:'33 Artillery Brigade, Cantonment', father_yearly_income:'1200000',
  mother_name:'MRS. DEMO MOTHER', mother_profession:'Housewife', mother_designation:'', mother_education:'BA',
  mother_contact:'01700000002', mother_nid:'9876543210987', mother_office_address:'', mother_yearly_income:'0',
  guardian_name:'MD. DEMO GUARDIAN', guardian_profession:'Civil Service', guardian_designation:'Executive Officer', guardian_education:'MBA',
  guardian_contact:'01700000003', guardian_relation:'Uncle', guardian_office_address:'Demo Office, Agrabad, Chattogram',
  student_photo:null, father_photo:null, mother_photo:null, guardian_photo:null,
  academic_records:[
    {exam:'PSC',year:'2019',board:'Dhaka',roll:'234567',result:'GPA 5.00'},
    {exam:'JSC',year:'2022',board:'Chattogram',roll:'345678',result:'GPA 4.75'},
    {exam:'SSC',year:'2024',board:'Chattogram',roll:'456789',result:'GPA 5.00'},
  ],
  siblings:[
    {name:'Demo Sister',age:'14',cls:'Nine',institution:'Chattogram Cantonment Girls School'},
  ],
};

const DEFAULT_FORM = {
  header: {
    logoUrl: 'https://lh3.googleusercontent.com/d/1Gb6gpcw1moYPAh9hSZ7cEQ5vgXxHj8LB',
    collegeName: 'Chattogram Cantonment Public College',
    address: 'Zahir Raihan Road, Cantonment, Chattogram — 4220',
    phone: '031-650500', website: 'ccpc.edu.bd', formTitle: 'APPLICATION FORM',
  },
  indexBar: {
    bgColor: '#1a2b5c', textColor: '#ffffff',
    fields: { tracking_id: false, index_id: true, class: true, category: true, version: true, quota: true },
  },
  sectionHeader: { bgColor: '#e8e8e8', textColor: '#1a2b5c' },
  sections: {
    student:  { visible: true,  label: "Applicant's Information",    showPhoto: true },
    father:   { visible: true,  label: "Father's Details",           showPhoto: true },
    mother:   { visible: true,  label: "Mother's Details",           showPhoto: true },
    guardian: { visible: true,  label: "Local Guardian's Details",   showPhoto: true },
  },
  studentFields: {
    name_en: true, name_bn: true, dob: true, blood: true, gender: true, religion: true,
    birth_reg: true, nationality: true, emergency: true, height: true,
    co_curr: true, last_inst: true, last_cls: true, present: true, permanent: true,
  },
  fatherFields:  { name: true, prof: true, desig: true, edu: true, contact: true, nid: true, office: true, income: true },
  motherFields:  { name: true, prof: true, desig: true, edu: true, contact: true, nid: true, office: true, income: true },
  guardianFields:{ name: true, prof: true, desig: true, edu: true, contact: true, relation: true, office: true },
  terms: { visible: true, text: 'I hereby declare that all information provided in this application is true and correct to the best of my knowledge. Any false information may result in cancellation of admission.\nI agree to abide by all rules and regulations of Chattogram Cantonment Public College.' },
  tables: {
    academic: {
      visible: true,
      title: 'Educational Qualifications',
      columns: { exam: true, year: true, board: true, roll: true, result: true },
      labels: { exam: 'Exam Name', year: 'Year', board: 'Board / Institution', roll: 'Roll No.', result: 'GPA / Result' },
    },
    sibling: {
      visible: true,
      title: 'Information of Siblings',
      columns: { name: true, age: true, cls: true, institution: true },
      labels: { name: 'Name', age: 'Age', cls: 'Class / Standard', institution: 'Institution' },
    },
  },
  footer: 'Chattogram Cantonment Public College — Official Admission Form — Page 1 of 1',
  signatureLabel: "Guardian's Signature & Date",
};

const DEFAULT_ADMIT = {
  header: {
    logoUrl: 'https://lh3.googleusercontent.com/d/1Gb6gpcw1moYPAh9hSZ7cEQ5vgXxHj8LB',
    collegeName: 'Chattogram Cantonment Public College',
    address: 'Zahir Raihan Road, Cantonment, Chattogram — 4220',
    cardTitle: 'ADMIT CARD',
  },
  bannerBg: '#1a2b5c', bannerText: '#ffffff',
  showPhoto: true,
  fields: { tracking_id: true, index_id: true, name_en: true, name_bn: false, class: true, category: true, version: true, session: true, dob: false, blood: false, room: true },
  labels: { tracking_id: 'Roll / Tracking No.', index_id: 'Index ID', name_en: 'Name (English)', name_bn: 'নাম', class: 'Class', category: 'Category', version: 'Version', session: 'Session', dob: 'Date of Birth', blood: 'Blood Group', room: 'Room No.' },
  examCenter: 'CCPC Examination Hall, Cantonment, Chattogram',
  examDate: '', examTime: '',
  instructions: '1. Bring this admit card to every examination.\n2. Report to the examination hall 15 minutes before start time.\n3. No mobile phones or electronic devices are allowed.',
  sig1: { visible: true, label: "Invigilator's Signature" },
  sig2: { visible: true, label: "Controller of Examination" },
  footer: 'Chattogram Cantonment Public College — Computer Generated Admit Card',
};

function openPrintTab(html){
  const w=window.open('','_blank','width=900,height=1100');
  w.document.write(html);w.document.close();
}

/* ─── Tables HTML Generator ──────────────────────── */
function generateTablesHtml(a,ts,sh){
  let html='';
  const secHdrStyle=`background:${sh?.bgColor||'#e8e8e8'};color:${sh?.textColor||'#1a2b5c'}`;

  // Academic records
  const at=ts?.academic||DEFAULT_FORM.tables.academic;
  if(at.visible!==false){
    const rows=Array.isArray(a.academic_records)?a.academic_records.filter(r=>r&&Object.values(r).some(v=>v)):[];
    if(rows.length){
      const ac=at.columns||{};const al=at.labels||DEFAULT_FORM.tables.academic.labels;
      html+=`<div class="pr-section"><div class="pr-sec-hdr" style="${secHdrStyle}">${at.title||'Educational Qualifications'}</div>
      <div class="pr-body"><table class="pr-custom-table"><thead><tr>
        ${ac.exam!==false?`<th>${al.exam||'Exam Name'}</th>`:''}
        ${ac.year!==false?`<th>${al.year||'Year'}</th>`:''}
        ${ac.board!==false?`<th>${al.board||'Board / Institution'}</th>`:''}
        ${ac.roll!==false?`<th>${al.roll||'Roll No.'}</th>`:''}
        ${ac.result!==false?`<th>${al.result||'GPA / Result'}</th>`:''}
      </tr></thead><tbody>
        ${rows.map(r=>`<tr>
          ${ac.exam!==false?`<td>${r.exam||''}</td>`:''}
          ${ac.year!==false?`<td>${r.year||''}</td>`:''}
          ${ac.board!==false?`<td>${r.board||''}</td>`:''}
          ${ac.roll!==false?`<td>${r.roll||''}</td>`:''}
          ${ac.result!==false?`<td>${r.result||''}</td>`:''}
        </tr>`).join('')}
      </tbody></table></div></div>`;
    }
  }

  // Sibling information
  const st=ts?.sibling||DEFAULT_FORM.tables.sibling;
  if(st.visible!==false){
    const rows=Array.isArray(a.siblings)?a.siblings.filter(r=>r&&Object.values(r).some(v=>v)):[];
    if(rows.length){
      const sc=st.columns||{};const sl=st.labels||DEFAULT_FORM.tables.sibling.labels;
      html+=`<div class="pr-section"><div class="pr-sec-hdr" style="${secHdrStyle}">${st.title||'Information of Siblings'}</div>
      <div class="pr-body"><table class="pr-custom-table"><thead><tr>
        ${sc.name!==false?`<th>${sl.name||'Name'}</th>`:''}
        ${sc.age!==false?`<th>${sl.age||'Age'}</th>`:''}
        ${sc.cls!==false?`<th>${sl.cls||'Class / Standard'}</th>`:''}
        ${sc.institution!==false?`<th>${sl.institution||'Institution'}</th>`:''}
      </tr></thead><tbody>
        ${rows.map(r=>`<tr>
          ${sc.name!==false?`<td>${r.name||''}</td>`:''}
          ${sc.age!==false?`<td>${r.age||''}</td>`:''}
          ${sc.cls!==false?`<td>${r.cls||''}</td>`:''}
          ${sc.institution!==false?`<td>${r.institution||''}</td>`:''}
        </tr>`).join('')}
      </tbody></table></div></div>`;
    }
  }
  return html;
}

/* ─── Form HTML Generator ────────────────────────── */
function prRow(label,value,visible=true){
  if(!visible||value===null||value===undefined||value==='')return'';
  return`<tr><td class="pr-lbl">${label}</td><td class="pr-val">${value}</td></tr>`;
}
function prPhoto(url,show){
  if(!show)return'';
  return`<div class="pr-photo-box">${url?`<img src="${url}" class="pr-photo">`:`<div class="pr-photo-empty">Photo</div>`}</div>`;
}

function generateFormHtml(a,fs,isPreview=false){
  const h=fs.header||DEFAULT_FORM.header;
  const ib=fs.indexBar||DEFAULT_FORM.indexBar;
  const sh=fs.sectionHeader||DEFAULT_FORM.sectionHeader;
  const sec=fs.sections||DEFAULT_FORM.sections;
  const sf=fs.studentFields||DEFAULT_FORM.studentFields;
  const ff=fs.fatherFields||DEFAULT_FORM.fatherFields;
  const mf=fs.motherFields||DEFAULT_FORM.motherFields;
  const gf=fs.guardianFields||DEFAULT_FORM.guardianFields;
  const tr=fs.terms||DEFAULT_FORM.terms;

  const indexFields=[];
  if(ib.fields?.tracking_id&&a.tracking_id)indexFields.push({l:'Tracking ID',v:a.tracking_id});
  if(ib.fields?.index_id)indexFields.push({l:'Index ID',v:a.index_id||'—'});
  if(ib.fields?.class)indexFields.push({l:'Class',v:a.class||'—'});
  if(ib.fields?.category)indexFields.push({l:'Category',v:a.category||'—'});
  if(ib.fields?.version)indexFields.push({l:'Version',v:a.version||'—'});
  if(ib.fields?.quota)indexFields.push({l:'Quota',v:a.quota||'No'});

  const studentHtml=!(sec.student?.visible)?'':`
    <div class="pr-section"><div class="pr-sec-hdr" style="background:${sh.bgColor};color:${sh.textColor}">${sec.student.label||"Applicant's Information"}</div>
    <div class="pr-body"><div class="pr-row-photo">
      <div class="pr-fields"><table class="pr-table">
        ${prRow('Name (English)',`<strong>${a.name_english||''}</strong>`,sf.name_en)}
        ${prRow('নাম (বাংলায়)',a.name_bangla,sf.name_bn)}
        ${prRow('Date of Birth',fmtDate(a.date_of_birth),sf.dob)}
        ${prRow('Blood Group',a.blood_group,sf.blood)}
        ${prRow('Gender',a.gender,sf.gender)}
        ${prRow('Religion',a.religion,sf.religion)}
        ${prRow('Birth Registration No.',a.birth_reg_no,sf.birth_reg)}
        ${prRow('Nationality',a.nationality,sf.nationality)}
        ${prRow('Emergency Contact',a.emergency_contact,sf.emergency)}
        ${prRow('Height (Inch)',a.height,sf.height)}
        ${prRow('Co-curricular Activities',a.co_curricular,sf.co_curr)}
        ${prRow('Last Institute',a.last_institute,sf.last_inst)}
        ${prRow('Last Class / Version',`${a.last_class||''} ${a.last_version||''}`.trim(),sf.last_cls)}
        ${prRow('Present Address',a.present_address,sf.present)}
        ${prRow('Permanent Address',a.permanent_address,sf.permanent)}
      </table></div>
      ${prPhoto(a.student_photo,sec.student.showPhoto)}
    </div></div></div>`;

  const fatherHtml=!(sec.father?.visible)?'':`
    <div class="pr-section"><div class="pr-sec-hdr" style="background:${sh.bgColor};color:${sh.textColor}">${sec.father.label||"Father's Details"}</div>
    <div class="pr-body"><div class="pr-row-photo">
      <div class="pr-fields"><table class="pr-table">
        ${prRow('Name',`<strong>${a.father_name||''}</strong>`,ff.name)}
        ${prRow('Profession',a.father_profession,ff.prof)}
        ${prRow('Designation / Rank',a.father_designation,ff.desig)}
        ${prRow('Education',a.father_education,ff.edu)}
        ${prRow('Contact No.',a.father_contact,ff.contact)}
        ${prRow('NID',a.father_nid,ff.nid)}
        ${prRow('Office Address / Unit',a.father_office_address,ff.office)}
        ${prRow('Yearly Income (BDT)',a.father_yearly_income,ff.income)}
      </table></div>
      ${prPhoto(a.father_photo,sec.father.showPhoto)}
    </div></div></div>`;

  const motherHtml=!(sec.mother?.visible)?'':`
    <div class="pr-section"><div class="pr-sec-hdr" style="background:${sh.bgColor};color:${sh.textColor}">${sec.mother.label||"Mother's Details"}</div>
    <div class="pr-body"><div class="pr-row-photo">
      <div class="pr-fields"><table class="pr-table">
        ${prRow('Name',`<strong>${a.mother_name||''}</strong>`,mf.name)}
        ${prRow('Profession',a.mother_profession,mf.prof)}
        ${prRow('Designation / Rank',a.mother_designation,mf.desig)}
        ${prRow('Education',a.mother_education,mf.edu)}
        ${prRow('Contact No.',a.mother_contact,mf.contact)}
        ${prRow('NID',a.mother_nid,mf.nid)}
        ${prRow('Office Address / Unit',a.mother_office_address,mf.office)}
        ${prRow('Yearly Income (BDT)',a.mother_yearly_income,mf.income)}
      </table></div>
      ${prPhoto(a.mother_photo,sec.mother.showPhoto)}
    </div></div></div>`;

  const guardianHtml=!(sec.guardian?.visible)?'':`
    <div class="pr-section"><div class="pr-sec-hdr" style="background:${sh.bgColor};color:${sh.textColor}">${sec.guardian.label||"Local Guardian's Details"}</div>
    <div class="pr-body"><div class="pr-row-photo">
      <div class="pr-fields"><table class="pr-table">
        ${prRow('Name',`<strong>${a.guardian_name||''}</strong>`,gf.name)}
        ${prRow('Profession',a.guardian_profession,gf.prof)}
        ${prRow('Designation / Rank',a.guardian_designation,gf.desig)}
        ${prRow('Education',a.guardian_education,gf.edu)}
        ${prRow('Contact No.',a.guardian_contact,gf.contact)}
        ${prRow('Relation to Student',a.guardian_relation,gf.relation)}
        ${prRow('Office Address',a.guardian_office_address,gf.office)}
      </table></div>
      ${prPhoto(a.guardian_photo,sec.guardian.showPhoto)}
    </div></div></div>`;

  const termsHtml=!tr?.visible?'':
    `<div class="pr-terms"><div class="pr-terms-title">Terms &amp; Conditions</div>
    <ul>${(tr.text||'').split('\n').filter(l=>l.trim()).map(l=>`<li>${l}</li>`).join('')}</ul></div>`;

  return`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Application — ${a.tracking_id||''}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10pt;color:#111;background:#fff}
@page{size:A4 portrait;margin:12mm}
.pr-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${ib.bgColor};padding-bottom:8px;margin-bottom:6px}
.pr-logo{width:60px;height:60px;object-fit:contain}
.pr-college-name{font-size:14pt;font-weight:900;color:${ib.bgColor};line-height:1.2;letter-spacing:.3px}
.pr-college-addr{font-size:8pt;color:#555;margin-top:2px}
.pr-form-badge{margin-top:4px;display:inline-block;border:1.5px solid ${ib.bgColor};padding:3px 14px;font-size:10pt;font-weight:900;color:${ib.bgColor};text-transform:uppercase;letter-spacing:1px}
.pr-index-bar{background:${ib.bgColor};color:${ib.textColor};display:flex;margin:6px 0;border-radius:3px;overflow:hidden}
.pr-index-cell{flex:1;padding:5px 8px;font-size:8pt;font-weight:900;border-right:1px solid rgba(255,255,255,.2)}
.pr-index-cell:last-child{border-right:none}
.pr-index-label{font-size:6pt;font-weight:400;text-transform:uppercase;letter-spacing:.5px;opacity:.7;display:block}
.pr-section{margin-bottom:6px;border:1px solid #ccc;border-radius:2px;overflow:hidden}
.pr-sec-hdr{padding:4px 10px;font-size:9pt;font-weight:900;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #ccc}
.pr-body{padding:6px 8px}
.pr-row-photo{display:flex;gap:10px}
.pr-fields{flex:1}
.pr-photo-box{flex-shrink:0;width:88px;display:flex;align-items:flex-start;justify-content:center}
.pr-photo{width:80px;height:90px;object-fit:cover;border:1px solid #bbb;display:block}
.pr-photo-empty{width:80px;height:90px;border:1px solid #bbb;display:flex;align-items:center;justify-content:center;font-size:7pt;color:#aaa}
.pr-table{width:100%;border-collapse:collapse}
.pr-lbl{font-size:8pt;color:#555;padding:2.5px 6px 2.5px 0;width:38%;vertical-align:top;white-space:nowrap}
.pr-val{font-size:8.5pt;color:#111;padding:2.5px 0;vertical-align:top;border-bottom:.5px solid #eee}
.pr-terms{border:1px solid #bbb;padding:6px 10px;margin:6px 0;font-size:7.5pt;color:#333}
.pr-terms-title{font-weight:900;font-size:8pt;margin-bottom:3px;color:${ib.bgColor}}
.pr-terms ul{padding-left:14px}
.pr-terms li{margin-bottom:2px;line-height:1.4}
.pr-sign-area{display:flex;justify-content:flex-end;margin-top:8px}
.pr-sign-line{border-top:1px solid #333;width:160px;margin-bottom:3px}
.pr-sign-label{font-size:7.5pt;color:#555;text-align:center}
.pr-footer{text-align:center;font-size:7pt;color:#aaa;margin-top:10px;padding-top:4px;border-top:.5px solid #ddd}
.pr-custom-table{width:100%;border-collapse:collapse;font-size:8.5pt}
.pr-custom-table th{background:${sh.bgColor};color:${sh.textColor};padding:4px 7px;text-align:left;font-size:7.5pt;font-weight:900;letter-spacing:.4px;border:1px solid rgba(0,0,0,.12)}
.pr-custom-table td{padding:4px 7px;border:1px solid #ddd;vertical-align:top}
.pr-custom-table tr:nth-child(even) td{background:#f9f9f9}
${isPreview?'@media screen{body{background:#f5f5f5;padding:10px}.pr-page{background:#fff;padding:12mm;max-width:100%;box-shadow:0 2px 12px rgba(0,0,0,.1)}}':'@media screen{body{background:#e0e0e0}.pr-page{max-width:210mm;margin:10mm auto;background:#fff;padding:12mm;box-shadow:0 4px 20px rgba(0,0,0,.2)}}'}
</style></head>
<body><div class="pr-page">
<div class="pr-header">
  <img src="${h.logoUrl}" class="pr-logo" alt="CCPC">
  <div style="text-align:center;flex:1">
    <div class="pr-college-name">${h.collegeName}</div>
    <div class="pr-college-addr">${h.address}${h.phone?` &nbsp;|&nbsp; Phone: ${h.phone}`:''}${h.website?` &nbsp;|&nbsp; ${h.website}`:''}</div>
    <div class="pr-form-badge">${h.formTitle} — Session ${a.session||new Date().getFullYear()}</div>
  </div>
  <div style="width:60px;text-align:center;font-size:6pt;color:#aaa"><div style="width:50px;height:50px;border:1px solid #ddd;margin:0 auto 2px;display:flex;align-items:center;justify-content:center;font-size:8pt;font-weight:900;color:${ib.bgColor}">${a.tracking_id||''}</div>Tracking ID</div>
</div>
${indexFields.length?`<div class="pr-index-bar">${indexFields.map(f=>`<div class="pr-index-cell"><span class="pr-index-label">${f.l}</span>${f.v}</div>`).join('')}</div>`:''}
${studentHtml}${fatherHtml}${motherHtml}${guardianHtml}${generateTablesHtml(a,fs.tables||DEFAULT_FORM.tables,sh)}
${termsHtml}
<div class="pr-sign-area"><div class="pr-sign-box"><div style="height:28px"></div><div class="pr-sign-line"></div><div class="pr-sign-label">${fs.signatureLabel||DEFAULT_FORM.signatureLabel}</div></div></div>
<div class="pr-footer">${fs.footer||DEFAULT_FORM.footer}</div>
</div>${isPreview?'':'<script>window.onload=()=>window.print();<\/script>'}</body></html>`;
}

/* ─── Admit Card HTML Generator ──────────────────── */
function generateAdmitHtml(a,as,isPreview=false){
  const h=as.header||DEFAULT_ADMIT.header;
  const fields=as.fields||DEFAULT_ADMIT.fields;
  const labels=as.labels||DEFAULT_ADMIT.labels;
  const fieldRows=[
    ['tracking_id',labels.tracking_id||'Roll / Tracking No.',a.tracking_id],
    ['index_id',labels.index_id||'Index ID',a.index_id],
    ['name_en',labels.name_en||'Name',a.name_english],
    ['name_bn',labels.name_bn||'নাম',a.name_bangla],
    ['class',labels.class||'Class',a.class],
    ['category',labels.category||'Category',a.category],
    ['version',labels.version||'Version',a.version],
    ['session',labels.session||'Session',a.session],
    ['dob',labels.dob||'Date of Birth',fmtDate(a.date_of_birth)],
    ['blood',labels.blood||'Blood Group',a.blood_group],
    ['room',labels.room||'Room No.',a.room_no],
  ].filter(([k])=>fields[k]);

  const sig1=as.sig1||DEFAULT_ADMIT.sig1;
  const sig2=as.sig2||DEFAULT_ADMIT.sig2;

  return`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Admit Card — ${a.tracking_id||''}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10pt;color:#111;background:#fff}
@page{size:A4 portrait;margin:15mm}
.ac-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:3px solid ${as.bannerBg||'#1a2b5c'};margin-bottom:0}
.ac-logo{width:60px;height:60px;object-fit:contain}
.ac-banner{background:${as.bannerBg||'#1a2b5c'};color:${as.bannerText||'#fff'};padding:8px 16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.ac-card-title{font-size:16pt;font-weight:900;letter-spacing:2px;text-transform:uppercase}
.ac-session{font-size:10pt;opacity:.8}
.ac-body{display:flex;gap:16px;margin-bottom:12px}
.ac-fields{flex:1}
.ac-field-row{display:flex;gap:8px;border-bottom:.5px solid #e5e7eb;padding:4px 0}
.ac-field-lbl{font-size:8.5pt;color:#555;width:40%;vertical-align:middle}
.ac-field-val{font-size:9.5pt;font-weight:700;color:#111;flex:1}
.ac-photo-box{flex-shrink:0;width:100px;display:flex;flex-direction:column;align-items:center}
.ac-photo{width:90px;height:105px;object-fit:cover;border:1.5px solid #bbb;display:block}
.ac-photo-empty{width:90px;height:105px;border:1.5px solid #bbb;display:flex;align-items:center;justify-content:center;font-size:7pt;color:#aaa}
.ac-exam-box{border:1px solid #ccc;border-radius:3px;padding:8px 12px;margin-bottom:10px;background:#f9fafb}
.ac-exam-title{font-size:8pt;font-weight:900;text-transform:uppercase;color:${as.bannerBg||'#1a2b5c'};letter-spacing:.5px;margin-bottom:4px}
.ac-exam-row{font-size:8.5pt;color:#333;margin:2px 0}
.ac-room-badge{display:inline-block;background:${as.bannerBg||'#1a2b5c'};color:${as.bannerText||'#fff'};font-weight:900;font-size:10pt;padding:3px 12px;border-radius:3px;margin-top:3px;letter-spacing:1px}
.ac-instructions-box{border:1px solid #ccc;border-radius:3px;padding:8px 12px;margin-bottom:12px}
.ac-instr-title{font-size:8pt;font-weight:900;text-transform:uppercase;color:${as.bannerBg||'#1a2b5c'};letter-spacing:.5px;margin-bottom:4px}
.ac-instr-list{padding-left:14px;font-size:8pt;color:#333}
.ac-instr-list li{margin-bottom:2px;line-height:1.4}
.ac-sigs{display:flex;justify-content:space-between;margin-top:16px}
.ac-sig{text-align:center;min-width:150px}
.ac-sig-line{border-top:1px solid #333;margin-bottom:4px}
.ac-sig-label{font-size:7.5pt;color:#555}
.ac-footer{text-align:center;font-size:7pt;color:#aaa;margin-top:10px;padding-top:5px;border-top:.5px solid #ddd}
.ac-college-name{font-size:13pt;font-weight:900;color:${as.bannerBg||'#1a2b5c'}}
.ac-college-addr{font-size:7.5pt;color:#555;margin-top:1px}
${isPreview?'@media screen{body{background:#f5f5f5;padding:10px}.ac-page{background:#fff;padding:15mm;max-width:100%;box-shadow:0 2px 12px rgba(0,0,0,.1)}}':'@media screen{body{background:#e0e0e0}.ac-page{max-width:210mm;margin:10mm auto;background:#fff;padding:15mm;box-shadow:0 4px 20px rgba(0,0,0,.2)}}'}
</style></head>
<body><div class="ac-page">
<div class="ac-header">
  <img src="${h.logoUrl}" class="ac-logo" alt="CCPC">
  <div style="text-align:center;flex:1">
    <div class="ac-college-name">${h.collegeName}</div>
    <div class="ac-college-addr">${h.address}</div>
  </div>
  <div style="width:60px"></div>
</div>
<div class="ac-banner">
  <span class="ac-card-title">${h.cardTitle||'ADMIT CARD'}</span>
  <span class="ac-session">Session ${a.session||new Date().getFullYear()}</span>
</div>
<div class="ac-body">
  <div class="ac-fields">
    ${fieldRows.map(([,lbl,val])=>`<div class="ac-field-row"><span class="ac-field-lbl">${lbl}</span><span class="ac-field-val">${val||'—'}</span></div>`).join('')}
  </div>
  ${as.showPhoto!==false?`<div class="ac-photo-box">${a.student_photo?`<img src="${a.student_photo}" class="ac-photo">`:`<div class="ac-photo-empty">Photo</div>`}</div>`:''}
</div>
<div class="ac-exam-box">
  <div class="ac-exam-title">Examination Details</div>
  ${as.examCenter?`<div class="ac-exam-row"><strong>Exam Center:</strong> ${as.examCenter}</div>`:''}
  ${as.examDate?`<div class="ac-exam-row"><strong>Date:</strong> ${as.examDate}</div>`:''}
  ${as.examTime?`<div class="ac-exam-row"><strong>Time:</strong> ${as.examTime}</div>`:''}
  ${a.room_no?`<div class="ac-exam-row"><strong>Exam Room:</strong> <span class="ac-room-badge">${a.room_no}</span></div>`:''}
</div>
${as.instructions?`<div class="ac-instructions-box"><div class="ac-instr-title">Instructions</div><ul class="ac-instr-list">${as.instructions.split('\n').filter(l=>l.trim()).map(l=>`<li>${l}</li>`).join('')}</ul></div>`:''}
<div class="ac-sigs">
  ${sig1.visible?`<div class="ac-sig"><div style="height:30px"></div><div class="ac-sig-line"></div><div class="ac-sig-label">${sig1.label}</div></div>`:''}
  ${sig2.visible?`<div class="ac-sig"><div style="height:30px"></div><div class="ac-sig-line"></div><div class="ac-sig-label">${sig2.label}</div></div>`:''}
</div>
<div class="ac-footer">${as.footer||DEFAULT_ADMIT.footer}</div>
</div>${isPreview?'':'<script>window.onload=()=>window.print();<\/script>'}</body></html>`;
}

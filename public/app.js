/* ═══════════════════════════════════════════════════════
   CCPC Admission — Frontend Logic
   ═══════════════════════════════════════════════════════ */

let AUTH_TOKEN = null;
let allApplications = [];
let currentId = null;
let currentFormSettings = null;
let currentAdmitSettings = null;
let currentIndexSettings = null;

/* ─── Defaults ──────────────────────────────────────── */
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
  fields: { tracking_id: true, index_id: true, name_en: true, name_bn: false, class: true, category: true, version: true, session: true, dob: false, blood: false },
  labels: { tracking_id: 'Roll / Tracking No.', index_id: 'Index ID', name_en: 'Name (English)', name_bn: 'নাম', class: 'Class', category: 'Category', version: 'Version', session: 'Session', dob: 'Date of Birth', blood: 'Blood Group' },
  examCenter: 'CCPC Examination Hall, Cantonment, Chattogram',
  examDate: '', examTime: '',
  instructions: '1. Bring this admit card to every examination.\n2. Report to the examination hall 15 minutes before start time.\n3. No mobile phones or electronic devices are allowed.',
  sig1: { visible: true, label: "Invigilator's Signature" },
  sig2: { visible: true, label: "Controller of Examination" },
  footer: 'Chattogram Cantonment Public College — Computer Generated Admit Card',
};

const DEFAULT_INDEX = {
  pattern: '{YY}{CLASS}{SEQ4}',
  classCodes: { Nursery:'NU',KG:'KG',One:'01',Two:'02',Three:'03',Four:'04',Five:'05',Six:'06',Seven:'07',Eight:'08',Nine:'09',Ten:'10',Eleven:'11',Twelve:'12' },
  categoryCodes: { Army:'A',Civil:'C',Defence:'D','CCPC Teacher':'T',Staff:'S' },
};

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

/* ─── Utility ─────────────────────────────────────── */
function setLoading(on) { const el=document.getElementById('loading'); on?show(el):hide(el); }
function show(el) { if(el){el.classList.remove('hidden');el.classList.add('flex');} }
function hide(el) { if(el){el.classList.add('hidden');el.classList.remove('flex');} }
function showEl(id){show(document.getElementById(id));}
function hideEl(id){hide(document.getElementById(id));}
function v(id){const e=document.getElementById(id);return e?e.value.trim():'';}
function setV(id,val){const e=document.getElementById(id);if(e)e.value=val||'';}
function chk(id){const e=document.getElementById(id);return e?e.checked:false;}
function setChk(id,val){const e=document.getElementById(id);if(e)e.checked=!!val;}
function col(id){const e=document.getElementById(id);return e?e.value:'#000000';}
function setCol(id,val){const e=document.getElementById(id);if(e)e.value=val||'#000000';}
function fmtDate(d){if(!d)return'';try{const dt=new Date(d);return isNaN(dt)?d:dt.toLocaleDateString('en-BD');}catch{return d;}}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function deepMerge(def,ovr){const r={...def};for(const k in(ovr||{})){if(ovr[k]&&typeof ovr[k]==='object'&&!Array.isArray(ovr[k]))r[k]=deepMerge(def[k]||{},ovr[k]);else r[k]=ovr[k];}return r;}

function toast(msg,type='info'){
  const colors={success:'bg-emerald-500',error:'bg-red-500',info:'bg-blue-600',warn:'bg-amber-500'};
  const icons ={success:'check-circle',error:'x-circle',info:'info',warn:'alert-triangle'};
  const t=document.createElement('div');
  t.className=`flex items-center gap-3 px-4 py-3 rounded-2xl text-white text-xs font-bold shadow-xl max-w-xs ${colors[type]} animate-toast pointer-events-auto`;
  t.innerHTML=`<i data-lucide="${icons[type]}" class="h-4 w-4 shrink-0"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(t);
  if(typeof lucide!=='undefined')lucide.createIcons({el:t});
  setTimeout(()=>t.remove(),3500);
}

let _confirmResolve=null;
function openConfirm(msg,okLabel='Confirm'){
  document.getElementById('confirmMsg').textContent=msg;
  document.getElementById('confirmOkBtn').textContent=okLabel;
  const m=document.getElementById('confirmModal');m.classList.remove('hidden');m.classList.add('flex');
  return new Promise(r=>{_confirmResolve=r;});
}
function closeConfirm(val=false){
  const m=document.getElementById('confirmModal');m.classList.add('hidden');m.classList.remove('flex');
  if(_confirmResolve){_confirmResolve(val);_confirmResolve=null;}
}
document.getElementById('confirmOkBtn').onclick=()=>closeConfirm(true);

/* ─── API ────────────────────────────────────────── */
async function api(action,payload={}){
  const r=await fetch('/api/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload,token:AUTH_TOKEN})});
  return r.json();
}

/* ─── Auth ───────────────────────────────────────── */
document.getElementById('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  setLoading(true);
  const r=await fetch('/api/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',payload:{password:document.getElementById('loginPass').value}})});
  const d=await r.json();
  setLoading(false);
  if(d.token){AUTH_TOKEN=d.token;sessionStorage.setItem('adm_tk',AUTH_TOKEN);document.getElementById('loginError').classList.add('hidden');enterApp();}
  else document.getElementById('loginError').classList.remove('hidden');
});
function logout(){AUTH_TOKEN=null;sessionStorage.removeItem('adm_tk');hideEl('app-screen');showEl('login-screen');document.getElementById('loginPass').value='';}
function enterApp(){
  const as=document.getElementById('app-screen');as.classList.remove('hidden');as.classList.add('flex');
  hideEl('login-screen');loadDashboard();
}
window.addEventListener('DOMContentLoaded',()=>{
  if(typeof lucide!=='undefined')lucide.createIcons();
  const t=sessionStorage.getItem('adm_tk');if(t){AUTH_TOKEN=t;enterApp();}
});

/* ─── View management ────────────────────────────── */
function showView(id){
  ['view-dashboard','view-form','view-admin'].forEach(v=>{const el=document.getElementById(v);if(el){el.classList.add('hidden');el.classList.remove('flex');}});
  document.getElementById(id).classList.remove('hidden');
}
function showSection(id,btn){
  document.querySelectorAll('.fsec').forEach(el=>el.classList.add('hidden'));
  document.querySelectorAll('.ftab').forEach(el=>el.classList.remove('active'));
  document.getElementById(id).classList.remove('hidden');btn.classList.add('active');
}
function showAdminTab(id,btn){
  document.querySelectorAll('.atab-panel').forEach(el=>el.classList.add('hidden'));
  document.querySelectorAll('.atab').forEach(el=>el.classList.remove('active'));
  document.getElementById(id).classList.remove('hidden');btn.classList.add('active');
  if(id==='at-index')updateIndexPreview();
  if(id==='at-form'){if(typeof loadFormTemplates==='function')loadFormTemplates();else setTimeout(function(){initCanvas();fdZoomFit();},80);}
  if(id==='at-admit'){if(typeof loadAdmitTemplates==='function')loadAdmitTemplates();else setTimeout(updateAdmitPreview,100);}
  if(id==='at-counters')loadCounters();
  if(id==='at-circular')loadCircular();
}
function setTopbarBtn(dashboard,admin,newApp){
  const d=document.getElementById('btn-dashboard'),a=document.getElementById('btn-admin'),n=document.getElementById('btn-new');
  function toggle(el,show){if(!el)return;el.classList.toggle('hidden',!show);if(show)el.classList.add('flex');}
  toggle(d,dashboard);toggle(a,admin);toggle(n,newApp);
}

/* ─── Dashboard ──────────────────────────────────── */
async function loadDashboard(){
  showView('view-dashboard');setTopbarBtn(false,true,true);
  setLoading(true);const res=await api('listApplications',{});setLoading(false);
  if(res.error){toast(res.error,'error');return;}
  allApplications=res.applications||[];renderTable(allApplications);loadStats();
}
async function loadStats(){
  const r=await api('getStats',{});if(!r.stats)return;const s=r.stats;
  document.getElementById('topbar-stats').innerHTML=`
    <span class="stat-chip">Total:<b> ${s.total}</b></span>
    <span class="stat-chip" style="color:#d97706">Pending:<b> ${s.pending}</b></span>
    <span class="stat-chip" style="color:#059669">Admitted:<b> ${s.admitted}</b></span>
    <span class="stat-chip" style="color:#dc2626">Rejected:<b> ${s.rejected}</b></span>`;
}

const STATUS_COLORS={
  'Pending':'bg-amber-100 text-amber-700','Called for Test':'bg-blue-100 text-blue-700',
  'Admitted':'bg-emerald-100 text-emerald-700','Rejected':'bg-red-100 text-red-700'
};
function renderTable(apps){
  const tbody=document.getElementById('app-table-body');
  if(!apps.length){tbody.innerHTML='<tr><td colspan="7" class="px-4 py-10 text-center text-slate-400 text-sm">No applications found.</td></tr>';document.getElementById('app-count').textContent='';return;}
  document.getElementById('app-count').textContent=`${apps.length} record${apps.length>1?'s':''}`;
  tbody.innerHTML=apps.map(a=>`
    <tr class="border-t border-slate-50 hover:bg-slate-50/80 transition-all cursor-pointer" onclick="loadForm(${a.id})">
      <td class="px-4 py-3"><span class="font-black text-blue-600 text-xs font-mono">${a.tracking_id||'—'}</span><br><span class="text-[9px] text-slate-400">${a.index_id||''}</span></td>
      <td class="px-4 py-3"><p class="font-bold text-sm text-slate-800">${a.name_english||'—'}</p><p class="text-[10px] text-slate-400">${a.name_bangla||''}</p></td>
      <td class="px-4 py-3 hidden md:table-cell text-sm font-bold text-slate-600">${a.class||'—'}</td>
      <td class="px-4 py-3 hidden md:table-cell text-sm text-slate-600">${a.category||'—'}</td>
      <td class="px-4 py-3 hidden lg:table-cell text-sm text-slate-500">${a.session||'—'}</td>
      <td class="px-4 py-3">
        <select class="status-pill ${STATUS_COLORS[a.status]||''}" onchange="changeStatus(event,${a.id})" onclick="event.stopPropagation()">
          ${['Pending','Called for Test','Admitted','Rejected'].map(s=>`<option${s===a.status?' selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button onclick="event.stopPropagation();loadForm(${a.id})" class="action-btn" title="Edit"><i data-lucide="edit-2" class="h-3.5 w-3.5"></i></button>
        <button onclick="event.stopPropagation();printFormById(${a.id})" class="action-btn text-emerald-600" title="Print Form"><i data-lucide="printer" class="h-3.5 w-3.5"></i></button>
        <button onclick="event.stopPropagation();printAdmitById(${a.id})" class="action-btn" style="color:#7c3aed" title="Admit Card"><i data-lucide="id-card" class="h-3.5 w-3.5"></i></button>
        <button onclick="event.stopPropagation();deleteApp(${a.id})" class="action-btn text-red-400" title="Delete"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
      </td>
    </tr>`).join('');
  if(typeof lucide!=='undefined')lucide.createIcons();
}
function filterApps(){
  const q=(document.getElementById('searchInput').value||'').toLowerCase();
  const sess=document.getElementById('filterSession').value;
  const cls=document.getElementById('filterClass').value;
  const stat=document.getElementById('filterStatus').value;
  renderTable(allApplications.filter(a=>{
    if(q&&!`${a.name_english||''} ${a.tracking_id||''} ${a.index_id||''}`.toLowerCase().includes(q))return false;
    if(sess&&a.session!==sess)return false;
    if(cls&&a.class!==cls)return false;
    if(stat&&a.status!==stat)return false;
    return true;
  }));
}
async function changeStatus(e,id){
  e.stopPropagation();const status=e.target.value;
  const r=await api('updateStatus',{id,status});
  if(r.error){toast(r.error,'error');return;}
  const app=allApplications.find(a=>a.id===id);if(app)app.status=status;
  e.target.className=`status-pill ${STATUS_COLORS[status]||''}`;
  toast('Status updated','success');loadStats();
}
async function deleteApp(id){
  if(!await openConfirm('Delete this application permanently?'))return;
  setLoading(true);const r=await api('deleteApplication',{id});setLoading(false);
  if(r.error){toast(r.error,'error');return;}
  toast('Deleted','success');allApplications=allApplications.filter(a=>a.id!==id);filterApps();loadStats();
}

/* ─── Dynamic table rows ─────────────────────────── */
function addAcademicRow(data={}){
  const tr=document.createElement('tr');
  tr.className='border-t border-slate-100 group';
  tr.innerHTML=`
    <td class="px-2 py-1"><input data-field="exam" value="${data.exam||''}" class="tbl-input" placeholder="e.g. SSC"></td>
    <td class="px-2 py-1"><input data-field="year" value="${data.year||''}" class="tbl-input" placeholder="2024"></td>
    <td class="px-2 py-1"><input data-field="board" value="${data.board||''}" class="tbl-input" placeholder="Dhaka Board"></td>
    <td class="px-2 py-1"><input data-field="roll" value="${data.roll||''}" class="tbl-input" placeholder="123456"></td>
    <td class="px-2 py-1"><input data-field="result" value="${data.result||''}" class="tbl-input" placeholder="GPA 5.00"></td>
    <td class="px-2 py-1 text-center"><button type="button" onclick="this.closest('tr').remove()" class="w-6 h-6 rounded-md text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all text-lg leading-none opacity-0 group-hover:opacity-100">×</button></td>`;
  document.getElementById('academic-tbody').appendChild(tr);
}
function addSiblingRow(data={}){
  const tr=document.createElement('tr');
  tr.className='border-t border-slate-100 group';
  tr.innerHTML=`
    <td class="px-2 py-1"><input data-field="name" value="${data.name||''}" class="tbl-input" placeholder="Full name"></td>
    <td class="px-2 py-1"><input data-field="age" value="${data.age||''}" class="tbl-input" placeholder="Age"></td>
    <td class="px-2 py-1"><input data-field="cls" value="${data.cls||''}" class="tbl-input" placeholder="e.g. Five"></td>
    <td class="px-2 py-1"><input data-field="institution" value="${data.institution||''}" class="tbl-input" placeholder="School name"></td>
    <td class="px-2 py-1 text-center"><button type="button" onclick="this.closest('tr').remove()" class="w-6 h-6 rounded-md text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all text-lg leading-none opacity-0 group-hover:opacity-100">×</button></td>`;
  document.getElementById('sibling-tbody').appendChild(tr);
}
function collectTableRows(tbodyId,fields){
  const rows=[];
  document.querySelectorAll(`#${tbodyId} tr`).forEach(tr=>{
    const row={};fields.forEach(f=>{row[f]=tr.querySelector(`[data-field="${f}"]`)?.value?.trim()||null;});
    if(Object.values(row).some(v=>v))rows.push(row);
  });
  return rows;
}

/* ─── Form ───────────────────────────────────────── */
const FORM_FIELDS=[
  'f-session','f-class','f-category','f-version','f-quota','f-status',
  'f-name-en','f-name-bn','f-dob','f-blood','f-gender','f-religion','f-birth-reg','f-nationality',
  'f-emergency','f-height','f-last-class','f-last-version','f-last-institute','f-present-address','f-permanent-address','f-co-curricular',
  'f-father-name','f-father-profession','f-father-designation','f-father-education','f-father-contact','f-father-nid','f-father-office','f-father-income',
  'f-mother-name','f-mother-profession','f-mother-designation','f-mother-education','f-mother-contact','f-mother-nid','f-mother-office','f-mother-income',
  'f-guardian-name','f-guardian-profession','f-guardian-designation','f-guardian-education','f-guardian-contact','f-guardian-relation','f-guardian-office',
];
function clearForm(){
  FORM_FIELDS.forEach(id=>setV(id,''));
  setV('f-tracking-id','');setV('f-index-id','');
  ['f-student-photo','f-father-photo','f-mother-photo','f-guardian-photo'].forEach(id=>setV(id,''));
  ['student','father','mother','guardian'].forEach(r=>{
    const el=document.getElementById(`${r}-photo-preview`);
    if(el)el.innerHTML=`<i data-lucide="camera" class="h-6 w-6 text-slate-300"></i><span class="text-[9px] text-slate-400 mt-1">Click to upload</span>`;
  });
  setV('f-session','2026');setV('f-class','Nursery');setV('f-category','Army');
  setV('f-version','Bangla');setV('f-quota','No');setV('f-status','Pending');setV('f-nationality','Bangladeshi');
  document.getElementById('academic-tbody').innerHTML='';addAcademicRow();addAcademicRow();addAcademicRow();
  document.getElementById('sibling-tbody').innerHTML='';
  if(typeof lucide!=='undefined')lucide.createIcons();
}
function loadNewApplication(){
  currentId=null;clearForm();showView('view-form');
  document.getElementById('form-title').textContent='New Application';
  setTopbarBtn(true,true,false);
  document.querySelector('.ftab').click();
}
async function loadForm(id){
  currentId=id;clearForm();showView('view-form');
  document.getElementById('form-title').textContent='Edit Application';
  setTopbarBtn(true,true,false);
  setLoading(true);const r=await api('getApplication',{id});setLoading(false);
  const a=r.application;if(!a){toast('Not found','error');return;}
  setV('f-session',a.session);setV('f-class',a.class);setV('f-category',a.category);
  setV('f-version',a.version);setV('f-quota',a.quota||'No');setV('f-status',a.status);
  setV('f-tracking-id',a.tracking_id);setV('f-index-id',a.index_id);
  setV('f-name-en',a.name_english);setV('f-name-bn',a.name_bangla);
  setV('f-dob',a.date_of_birth?a.date_of_birth.split('T')[0]:'');
  setV('f-blood',a.blood_group);setV('f-gender',a.gender);setV('f-religion',a.religion);
  setV('f-birth-reg',a.birth_reg_no);setV('f-nationality',a.nationality||'Bangladeshi');
  setV('f-emergency',a.emergency_contact);setV('f-height',a.height);
  setV('f-last-class',a.last_class);setV('f-last-version',a.last_version);setV('f-last-institute',a.last_institute);
  setV('f-present-address',a.present_address);setV('f-permanent-address',a.permanent_address);
  setV('f-co-curricular',a.co_curricular);
  setV('f-father-name',a.father_name);setV('f-father-profession',a.father_profession);
  setV('f-father-designation',a.father_designation);setV('f-father-education',a.father_education);
  setV('f-father-contact',a.father_contact);setV('f-father-nid',a.father_nid);
  setV('f-father-office',a.father_office_address);setV('f-father-income',a.father_yearly_income);
  setV('f-mother-name',a.mother_name);setV('f-mother-profession',a.mother_profession);
  setV('f-mother-designation',a.mother_designation);setV('f-mother-education',a.mother_education);
  setV('f-mother-contact',a.mother_contact);setV('f-mother-nid',a.mother_nid);
  setV('f-mother-office',a.mother_office_address);setV('f-mother-income',a.mother_yearly_income);
  setV('f-guardian-name',a.guardian_name);setV('f-guardian-profession',a.guardian_profession);
  setV('f-guardian-designation',a.guardian_designation);setV('f-guardian-education',a.guardian_education);
  setV('f-guardian-contact',a.guardian_contact);setV('f-guardian-relation',a.guardian_relation);
  setV('f-guardian-office',a.guardian_office_address);
  ['student','father','mother','guardian'].forEach(role=>{
    const ph=a[`${role}_photo`];if(!ph)return;
    setV(`f-${role}-photo`,ph);
    const el=document.getElementById(`${role}-photo-preview`);
    if(el)el.innerHTML=`<img src="${ph}" class="w-full h-full object-cover">`;
  });
  // Academic records table
  document.getElementById('academic-tbody').innerHTML='';
  const acadRows=Array.isArray(a.academic_records)?a.academic_records:[];
  if(acadRows.length)acadRows.forEach(r=>addAcademicRow(r));
  else{addAcademicRow();addAcademicRow();addAcademicRow();}
  // Sibling table
  document.getElementById('sibling-tbody').innerHTML='';
  const sibRows=Array.isArray(a.siblings)?a.siblings:[];
  sibRows.forEach(r=>addSiblingRow(r));
  document.querySelector('.ftab').click();
}
function collectForm(){
  return {
    session:v('f-session'),class:v('f-class'),category:v('f-category'),version:v('f-version'),
    quota:v('f-quota'),status:v('f-status'),
    name_english:v('f-name-en')||null,name_bangla:v('f-name-bn')||null,
    date_of_birth:v('f-dob')||null,blood_group:v('f-blood')||null,gender:v('f-gender')||null,
    religion:v('f-religion')||null,birth_reg_no:v('f-birth-reg')||null,nationality:v('f-nationality')||'Bangladeshi',
    emergency_contact:v('f-emergency')||null,height:v('f-height')||null,
    last_class:v('f-last-class')||null,last_version:v('f-last-version')||null,last_institute:v('f-last-institute')||null,
    present_address:v('f-present-address')||null,permanent_address:v('f-permanent-address')||null,co_curricular:v('f-co-curricular')||null,
    student_photo:document.getElementById('f-student-photo')?.value||null,
    father_name:v('f-father-name')||null,father_profession:v('f-father-profession')||null,
    father_designation:v('f-father-designation')||null,father_education:v('f-father-education')||null,
    father_contact:v('f-father-contact')||null,father_nid:v('f-father-nid')||null,
    father_office_address:v('f-father-office')||null,father_yearly_income:v('f-father-income')||null,
    father_photo:document.getElementById('f-father-photo')?.value||null,
    mother_name:v('f-mother-name')||null,mother_profession:v('f-mother-profession')||null,
    mother_designation:v('f-mother-designation')||null,mother_education:v('f-mother-education')||null,
    mother_contact:v('f-mother-contact')||null,mother_nid:v('f-mother-nid')||null,
    mother_office_address:v('f-mother-office')||null,mother_yearly_income:v('f-mother-income')||null,
    mother_photo:document.getElementById('f-mother-photo')?.value||null,
    guardian_name:v('f-guardian-name')||null,guardian_profession:v('f-guardian-profession')||null,
    guardian_designation:v('f-guardian-designation')||null,guardian_education:v('f-guardian-education')||null,
    guardian_contact:v('f-guardian-contact')||null,guardian_relation:v('f-guardian-relation')||null,
    guardian_office_address:v('f-guardian-office')||null,
    guardian_photo:document.getElementById('f-guardian-photo')?.value||null,
    academic_records:collectTableRows('academic-tbody',['exam','year','board','roll','result']),
    siblings:collectTableRows('sibling-tbody',['name','age','cls','institution']),
  };
}
async function saveApplication(){
  const data=collectForm();
  if(!data.name_english){toast('Enter student name first','warn');document.querySelectorAll('.ftab')[1].click();return;}
  setLoading(true);
  if(currentId){delete data.tracking_id;delete data.index_id;}
  const r=await api('saveApplication',{id:currentId,data});
  setLoading(false);
  if(r.error){toast(r.error,'error');return;}
  if(!currentId){
    currentId=r.id;
    setV('f-tracking-id',r.tracking_id||'');
    setV('f-index-id',r.index_id||'');
  }
  toast('Saved successfully','success');
}
function handlePhoto(input,previewId,hiddenId){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const d=e.target.result;document.getElementById(hiddenId).value=d;
    const p=document.getElementById(previewId);if(p)p.innerHTML=`<img src="${d}" class="w-full h-full object-cover">`;
  };
  reader.readAsDataURL(file);
}

/* ─── Print helpers ──────────────────────────────── */
async function ensureSettings(){
  if(!currentFormSettings||!currentAdmitSettings){
    const r=await api('getSettings',{});
    const s=r.settings||{};
    currentFormSettings=deepMerge(DEFAULT_FORM,s.form_settings||{});
    currentAdmitSettings=deepMerge(DEFAULT_ADMIT,s.admit_card_settings||{});
    currentIndexSettings=deepMerge(DEFAULT_INDEX,s.index_settings||{});
  }
}
async function ensureFormLayout(){
  if(formLayout&&formLayout.length)return;
  const r=await api('getSettings',{});const s=r.settings||{};
  const tplData=s.form_templates||{};
  const tpls=tplData.templates||[];
  const active=tplData.activeId;
  const tpl=(active&&tpls.find(t=>t.id===active))||tpls[0]||null;
  if(tpl){formLayout=tpl.elements||[];return;}
  formLayout=(s.form_layout&&s.form_layout.elements)||[];
}
async function ensureAdmitTpl(){
  if(currentAdmitSettings)return;
  const r=await api('getSettings',{});const s=r.settings||{};
  const tplData=s.admit_templates||{};
  const tpls=tplData.templates||[];
  const active=tplData.activeId;
  const tpl=(active&&tpls.find(t=>t.id===active))||tpls[0]||null;
  currentAdmitSettings=deepMerge(DEFAULT_ADMIT,tpl?tpl.settings||{}:s.admit_card_settings||{});
}
async function printForm(){
  await ensureSettings();await ensureFormLayout();
  const data=collectForm();
  openPrintTab(formLayout&&formLayout.length ? generateFormFromLayout(data,formLayout) : generateFormHtml(data,currentFormSettings));
}
async function printAdmitCard(){
  if(!currentId){toast('Save the application first to generate Admit Card','warn');return;}
  await ensureSettings();await ensureAdmitTpl();
  const r=await api('getApplication',{id:currentId});
  if(!r.application){toast('Not found','error');return;}
  openPrintTab(generateAdmitHtml(r.application,currentAdmitSettings));
}
async function printFormById(id){
  await ensureSettings();await ensureFormLayout();setLoading(true);
  const r=await api('getApplication',{id});setLoading(false);
  if(!r.application){toast('Not found','error');return;}
  openPrintTab(formLayout&&formLayout.length ? generateFormFromLayout(r.application,formLayout) : generateFormHtml(r.application,currentFormSettings));
}
async function printAdmitById(id){
  await ensureSettings();await ensureAdmitTpl();setLoading(true);
  const r=await api('getApplication',{id});setLoading(false);
  if(!r.application){toast('Not found','error');return;}
  openPrintTab(generateAdmitHtml(r.application,currentAdmitSettings));
}
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
</div>
${as.instructions?`<div class="ac-instructions-box"><div class="ac-instr-title">Instructions</div><ul class="ac-instr-list">${as.instructions.split('\n').filter(l=>l.trim()).map(l=>`<li>${l}</li>`).join('')}</ul></div>`:''}
<div class="ac-sigs">
  ${sig1.visible?`<div class="ac-sig"><div style="height:30px"></div><div class="ac-sig-line"></div><div class="ac-sig-label">${sig1.label}</div></div>`:''}
  ${sig2.visible?`<div class="ac-sig"><div style="height:30px"></div><div class="ac-sig-line"></div><div class="ac-sig-label">${sig2.label}</div></div>`:''}
</div>
<div class="ac-footer">${as.footer||DEFAULT_ADMIT.footer}</div>
</div>${isPreview?'':'<script>window.onload=()=>window.print();<\/script>'}</body></html>`;
}

/* ─── Admin Panel ────────────────────────────────── */
async function loadAdminPanel(){
  showView('view-admin');setTopbarBtn(true,false,false);
  setLoading(true);const r=await api('getSettings',{});setLoading(false);
  const s=r.settings||{};
  currentFormSettings  =deepMerge(DEFAULT_FORM,s.form_settings||{});
  currentIndexSettings =deepMerge(DEFAULT_INDEX,s.index_settings||{});
  // load circular so index mapping can include its class/category options
  if(!currentCircular){
    const cd=s.circular_settings||{};
    currentCircular=Object.assign({},DEFAULT_CIRCULAR,cd);
    if(!Array.isArray(currentCircular.dimensions))currentCircular.dimensions=DEFAULT_CIRCULAR.dimensions.map(function(d){return Object.assign({},d);});
    if(!Array.isArray(currentCircular.entries))currentCircular.entries=[];
  }
  populateIndexSettings(currentIndexSettings);
  // form + admit templates loaded on-demand when their tabs are opened
  // Init live listeners
  initDesignerListeners();
  document.querySelector('.atab').click();
}

/* ─── Index Pattern ──────────────────────────────── */
function populateIndexSettings(s){
  setV('ip-pattern',s.pattern||'{YY}{CLASS}{SEQ4}');
  // Merge circular-defined class/category values into the code maps
  const classCodes=Object.assign({},s.classCodes||{});
  const catCodes=Object.assign({},s.categoryCodes||{});
  const circClassKeys=new Set();
  const circCatKeys=new Set();
  if(currentCircular&&Array.isArray(currentCircular.dimensions)){
    const classDim=currentCircular.dimensions.find(function(d){return d.label==='Class';});
    const catDim  =currentCircular.dimensions.find(function(d){return d.label==='Category';});
    if(classDim)(classDim.options||[]).forEach(function(opt){
      if(!opt.value)return;
      if(!(opt.value in classCodes))classCodes[opt.value]=opt.symbol||'';
      circClassKeys.add(opt.value);
    });
    if(catDim)(catDim.options||[]).forEach(function(opt){
      if(!opt.value)return;
      if(!(opt.value in catCodes))catCodes[opt.value]=opt.symbol||'';
      circCatKeys.add(opt.value);
    });
  }
  renderCodeTable('class-codes-table',classCodes,'class',circClassKeys);
  renderCodeTable('cat-codes-table',catCodes,'cat',circCatKeys);
  refreshIndexDropdowns(classCodes,catCodes);
  updateIndexPreview();
}
function renderCodeTable(containerId,codes,prefix,circKeys){
  const el=document.getElementById(containerId);if(!el)return;
  const ck=circKeys||new Set();
  el.innerHTML=Object.entries(codes).map(function(e){
    const k=e[0],val=e[1],fromCirc=ck.has(k);
    return '<div class="flex items-center gap-1 '+(fromCirc?'bg-indigo-50 border-indigo-200':'bg-slate-50 border-slate-200')+' border rounded-lg px-2 py-1.5">'+
      '<span class="text-xs font-bold text-slate-700 shrink-0" style="min-width:72px">'+escH(k)+(fromCirc?'<span style="font-size:8px;color:#6366f1;margin-left:3px" title="From Circular">●</span>':'')+'</span>'+
      '<span class="text-slate-300 px-0.5">→</span>'+
      '<input type="text" data-prefix="'+prefix+'" data-key="'+k+'" value="'+escH(val)+'" maxlength="6"'+
        ' class="finput finput-sm font-mono text-center font-black text-blue-600" style="min-width:0;flex:1"'+
        ' oninput="updateIndexPreview()">'+
      '<button onclick="indexDelCode(\''+prefix+'\',\''+escH(k)+'\')" title="Remove '+escH(k)+'" style="flex-shrink:0;margin-left:2px;width:20px;height:20px;font-size:12px;font-weight:900;color:#ef4444;background:none;border:none;cursor:pointer;line-height:1">×</button>'+
      '</div>';
  }).join('');
}
function syncCodeTables(){
  if(!currentIndexSettings)return;
  if(!currentIndexSettings.classCodes)currentIndexSettings.classCodes={};
  if(!currentIndexSettings.categoryCodes)currentIndexSettings.categoryCodes={};
  document.querySelectorAll('[data-prefix="class"]').forEach(function(el){currentIndexSettings.classCodes[el.dataset.key]=el.value.trim().toUpperCase();});
  document.querySelectorAll('[data-prefix="cat"]').forEach(function(el){currentIndexSettings.categoryCodes[el.dataset.key]=el.value.trim().toUpperCase();});
}
function indexDelCode(prefix,key){
  syncCodeTables();
  if(prefix==='class')delete currentIndexSettings.classCodes[key];
  else delete currentIndexSettings.categoryCodes[key];
  populateIndexSettings(currentIndexSettings);
}
function indexAddCode(prefix){
  const lbl=prefix==='class'?'class':'category';
  const key=prompt('Enter '+lbl+' name (e.g. "Thirteen", "Staff"):');
  if(!key||!key.trim())return;
  const k=key.trim();
  syncCodeTables();
  const target=prefix==='class'?currentIndexSettings.classCodes:currentIndexSettings.categoryCodes;
  if(k in target){toast('"'+k+'" already exists','warn');return;}
  target[k]='';
  populateIndexSettings(currentIndexSettings);
  // focus the new code input
  setTimeout(function(){
    const inp=document.querySelector('[data-prefix="'+prefix+'"][data-key="'+k+'"]');
    if(inp)inp.focus();
  },100);
}
function refreshIndexDropdowns(classCodes,catCodes){
  const classSel=document.getElementById('ip-test-class');
  const catSel  =document.getElementById('ip-test-cat');
  if(classSel&&Object.keys(classCodes).length){
    const prev=classSel.value;
    classSel.innerHTML=Object.keys(classCodes).map(function(k){
      return '<option'+(k===prev?' selected':'')+'>'+k+'</option>';
    }).join('');
  }
  if(catSel&&Object.keys(catCodes).length){
    const prev=catSel.value;
    catSel.innerHTML=Object.keys(catCodes).map(function(k){
      return '<option'+(k===prev?' selected':'')+'>'+k+'</option>';
    }).join('');
  }
}
function collectIndexSettings(){
  const classCodes={},catCodes={};
  document.querySelectorAll('[data-prefix="class"]').forEach(el=>{classCodes[el.dataset.key]=el.value.trim().toUpperCase();});
  document.querySelectorAll('[data-prefix="cat"]').forEach(el=>{catCodes[el.dataset.key]=el.value.trim().toUpperCase();});
  return { pattern:v('ip-pattern')||'{YY}{CLASS}{SEQ4}', classCodes, categoryCodes:catCodes };
}
function buildIndexPreview(settings,cls,cat,session){
  const p=settings.pattern||'{YY}{CLASS}{SEQ4}';
  const yr=String(session||new Date().getFullYear());
  const classCode=(settings.classCodes||{})[cls]||(cls||'XX').slice(0,2).toUpperCase();
  const catCode=(settings.categoryCodes||{})[cat]||'X';
  const seq=1;
  return p.replace('{YYYY}',yr).replace('{YY}',yr.slice(-2)).replace('{CLASS}',classCode).replace('{CAT}',catCode)
    .replace('{SEQ5}',String(seq).padStart(5,'0')).replace('{SEQ4}',String(seq).padStart(4,'0')).replace('{SEQ3}',String(seq).padStart(3,'0'));
}
function updateIndexPreview(){
  const settings=collectIndexSettings();
  const cls=document.getElementById('ip-test-class')?.value||'Nursery';
  const cat=document.getElementById('ip-test-cat')?.value||'Army';
  const sess=document.getElementById('ip-test-session')?.value||'2026';
  const el=document.getElementById('ip-preview');
  if(el)el.textContent=buildIndexPreview(settings,cls,cat,sess);
}
function insertToken(token){
  const inp=document.getElementById('ip-pattern');if(!inp)return;
  const pos=inp.selectionStart||inp.value.length;
  inp.value=inp.value.slice(0,pos)+token+inp.value.slice(pos);
  inp.setSelectionRange(pos+token.length,pos+token.length);
  inp.focus();updateIndexPreview();
}
async function saveIndexSettings(){
  const value=collectIndexSettings();currentIndexSettings=value;
  setLoading(true);const r=await api('saveSettings',{key:'index_settings',value});setLoading(false);
  if(r.error){toast(r.error,'error');return;}toast('Index settings saved','success');
}

/* ─── Form Designer ──────────────────────────────── */
function populateFormDesigner(s){
  const h=s.header||DEFAULT_FORM.header;
  setV('fd-logo-url',h.logoUrl);setV('fd-college-name',h.collegeName);
  setV('fd-address',h.address);setV('fd-phone',h.phone);setV('fd-website',h.website);
  setV('fd-form-title',h.formTitle);
  const ib=s.indexBar||DEFAULT_FORM.indexBar;
  setCol('fd-index-bg',ib.bgColor);setCol('fd-index-text',ib.textColor);
  const fields=ib.fields||DEFAULT_FORM.indexBar.fields;
  setChk('fd-idx-tracking',fields.tracking_id);setChk('fd-idx-index',fields.index_id);
  setChk('fd-idx-class',fields.class);setChk('fd-idx-category',fields.category);
  setChk('fd-idx-version',fields.version);setChk('fd-idx-quota',fields.quota);
  const sh=s.sectionHeader||DEFAULT_FORM.sectionHeader;
  setCol('fd-sec-bg',sh.bgColor);setCol('fd-sec-text',sh.textColor);
  const sec=s.sections||DEFAULT_FORM.sections;
  setChk('fd-show-student',sec.student?.visible!==false);setV('fd-student-label',sec.student?.label||"Applicant's Information");setChk('fd-show-student-photo',sec.student?.showPhoto!==false);
  setChk('fd-show-father',sec.father?.visible!==false);setV('fd-father-label',sec.father?.label||"Father's Details");setChk('fd-show-father-photo',sec.father?.showPhoto!==false);
  setChk('fd-show-mother',sec.mother?.visible!==false);setV('fd-mother-label',sec.mother?.label||"Mother's Details");setChk('fd-show-mother-photo',sec.mother?.showPhoto!==false);
  setChk('fd-show-guardian',sec.guardian?.visible!==false);setV('fd-guardian-label',sec.guardian?.label||"Local Guardian's Details");setChk('fd-show-guardian-photo',sec.guardian?.showPhoto!==false);
  const sf=s.studentFields||DEFAULT_FORM.studentFields;
  Object.entries({name_en:'sff-name-en',name_bn:'sff-name-bn',dob:'sff-dob',blood:'sff-blood',gender:'sff-gender',religion:'sff-religion',birth_reg:'sff-birth-reg',nationality:'sff-nationality',emergency:'sff-emergency',height:'sff-height',co_curr:'sff-co-curr',last_inst:'sff-last-inst',last_cls:'sff-last-cls',present:'sff-present',permanent:'sff-permanent'}).forEach(([k,id])=>setChk(id,sf[k]!==false));
  const ff=s.fatherFields||DEFAULT_FORM.fatherFields;
  Object.entries({name:'fff-name',prof:'fff-prof',desig:'fff-desig',edu:'fff-edu',contact:'fff-contact',nid:'fff-nid',office:'fff-office',income:'fff-income'}).forEach(([k,id])=>setChk(id,ff[k]!==false));
  const mf=s.motherFields||DEFAULT_FORM.motherFields;
  Object.entries({name:'mff-name',prof:'mff-prof',desig:'mff-desig',edu:'mff-edu',contact:'mff-contact',nid:'mff-nid',office:'mff-office',income:'mff-income'}).forEach(([k,id])=>setChk(id,mf[k]!==false));
  const gf=s.guardianFields||DEFAULT_FORM.guardianFields;
  Object.entries({name:'gff-name',prof:'gff-prof',desig:'gff-desig',edu:'gff-edu',contact:'gff-contact',relation:'gff-relation',office:'gff-office'}).forEach(([k,id])=>setChk(id,gf[k]!==false));
  const tr=s.terms||DEFAULT_FORM.terms;
  setChk('fd-show-terms',tr.visible!==false);setV('fd-terms-text',tr.text||DEFAULT_FORM.terms.text);
  setV('fd-footer',s.footer||DEFAULT_FORM.footer);setV('fd-sign-label',s.signatureLabel||DEFAULT_FORM.signatureLabel);
  // Tables
  const tbl=s.tables||DEFAULT_FORM.tables;
  const at=tbl.academic||DEFAULT_FORM.tables.academic;
  setChk('tbl-acad-show',at.visible!==false);setV('tbl-acad-title',at.title||'Educational Qualifications');
  const ac=at.columns||{};
  setChk('tbl-acad-exam',ac.exam!==false);setChk('tbl-acad-year',ac.year!==false);
  setChk('tbl-acad-board',ac.board!==false);setChk('tbl-acad-roll',ac.roll!==false);setChk('tbl-acad-result',ac.result!==false);
  const al=at.labels||DEFAULT_FORM.tables.academic.labels;
  setV('tbl-acad-lbl-exam',al.exam||'');setV('tbl-acad-lbl-year',al.year||'');
  setV('tbl-acad-lbl-board',al.board||'');setV('tbl-acad-lbl-roll',al.roll||'');setV('tbl-acad-lbl-result',al.result||'');
  const sib=tbl.sibling||DEFAULT_FORM.tables.sibling;
  setChk('tbl-sib-show',sib.visible!==false);setV('tbl-sib-title',sib.title||'Information of Siblings');
  const sc=sib.columns||{};
  setChk('tbl-sib-name',sc.name!==false);setChk('tbl-sib-age',sc.age!==false);
  setChk('tbl-sib-cls',sc.cls!==false);setChk('tbl-sib-inst',sc.institution!==false);
  const sl=sib.labels||DEFAULT_FORM.tables.sibling.labels;
  setV('tbl-sib-lbl-name',sl.name||'');setV('tbl-sib-lbl-age',sl.age||'');
  setV('tbl-sib-lbl-cls',sl.cls||'');setV('tbl-sib-lbl-inst',sl.institution||'');
}
function collectFormDesignSettings(){
  return{
    header:{logoUrl:v('fd-logo-url')||DEFAULT_FORM.header.logoUrl,collegeName:v('fd-college-name'),address:v('fd-address'),phone:v('fd-phone'),website:v('fd-website'),formTitle:v('fd-form-title')},
    indexBar:{bgColor:col('fd-index-bg'),textColor:col('fd-index-text'),fields:{tracking_id:chk('fd-idx-tracking'),index_id:chk('fd-idx-index'),class:chk('fd-idx-class'),category:chk('fd-idx-category'),version:chk('fd-idx-version'),quota:chk('fd-idx-quota')}},
    sectionHeader:{bgColor:col('fd-sec-bg'),textColor:col('fd-sec-text')},
    sections:{
      student:{visible:chk('fd-show-student'),label:v('fd-student-label'),showPhoto:chk('fd-show-student-photo')},
      father: {visible:chk('fd-show-father'), label:v('fd-father-label'), showPhoto:chk('fd-show-father-photo')},
      mother: {visible:chk('fd-show-mother'), label:v('fd-mother-label'), showPhoto:chk('fd-show-mother-photo')},
      guardian:{visible:chk('fd-show-guardian'),label:v('fd-guardian-label'),showPhoto:chk('fd-show-guardian-photo')},
    },
    studentFields:{name_en:chk('sff-name-en'),name_bn:chk('sff-name-bn'),dob:chk('sff-dob'),blood:chk('sff-blood'),gender:chk('sff-gender'),religion:chk('sff-religion'),birth_reg:chk('sff-birth-reg'),nationality:chk('sff-nationality'),emergency:chk('sff-emergency'),height:chk('sff-height'),co_curr:chk('sff-co-curr'),last_inst:chk('sff-last-inst'),last_cls:chk('sff-last-cls'),present:chk('sff-present'),permanent:chk('sff-permanent')},
    fatherFields:{name:chk('fff-name'),prof:chk('fff-prof'),desig:chk('fff-desig'),edu:chk('fff-edu'),contact:chk('fff-contact'),nid:chk('fff-nid'),office:chk('fff-office'),income:chk('fff-income')},
    motherFields:{name:chk('mff-name'),prof:chk('mff-prof'),desig:chk('mff-desig'),edu:chk('mff-edu'),contact:chk('mff-contact'),nid:chk('mff-nid'),office:chk('mff-office'),income:chk('mff-income')},
    guardianFields:{name:chk('gff-name'),prof:chk('gff-prof'),desig:chk('gff-desig'),edu:chk('gff-edu'),contact:chk('gff-contact'),relation:chk('gff-relation'),office:chk('gff-office')},
    terms:{visible:chk('fd-show-terms'),text:document.getElementById('fd-terms-text')?.value||DEFAULT_FORM.terms.text},
    footer:v('fd-footer'),signatureLabel:v('fd-sign-label'),
    tables:{
      academic:{
        visible:chk('tbl-acad-show'),
        title:v('tbl-acad-title')||'Educational Qualifications',
        columns:{exam:chk('tbl-acad-exam'),year:chk('tbl-acad-year'),board:chk('tbl-acad-board'),roll:chk('tbl-acad-roll'),result:chk('tbl-acad-result')},
        labels:{exam:v('tbl-acad-lbl-exam')||'Exam Name',year:v('tbl-acad-lbl-year')||'Year',board:v('tbl-acad-lbl-board')||'Board / Institution',roll:v('tbl-acad-lbl-roll')||'Roll No.',result:v('tbl-acad-lbl-result')||'GPA / Result'},
      },
      sibling:{
        visible:chk('tbl-sib-show'),
        title:v('tbl-sib-title')||'Information of Siblings',
        columns:{name:chk('tbl-sib-name'),age:chk('tbl-sib-age'),cls:chk('tbl-sib-cls'),institution:chk('tbl-sib-inst')},
        labels:{name:v('tbl-sib-lbl-name')||'Name',age:v('tbl-sib-lbl-age')||'Age',cls:v('tbl-sib-lbl-cls')||'Class / Standard',institution:v('tbl-sib-lbl-inst')||'Institution'},
      },
    },
  };
}
function updateFormPreview(){
  const settings=collectFormDesignSettings();
  const iframe=document.getElementById('form-preview-iframe');if(!iframe)return;
  iframe.srcdoc=generateFormHtml(DEMO_APP,settings,true);
}
async function saveFormDesign(){
  const value=collectFormDesignSettings();currentFormSettings=deepMerge(DEFAULT_FORM,value);
  setLoading(true);const r=await api('saveSettings',{key:'form_settings',value});setLoading(false);
  if(r.error){toast(r.error,'error');return;}toast('Form design saved','success');
}
function resetFormDesign(){
  populateFormDesigner(DEFAULT_FORM);updateFormPreview();
}

/* ─── Admit Card Designer ─────────────────────────── */
function populateAdmitDesigner(s){
  const h=s.header||DEFAULT_ADMIT.header;
  setV('ad-logo-url',h.logoUrl);setV('ad-college-name',h.collegeName);setV('ad-address',h.address);setV('ad-card-title',h.cardTitle);
  setCol('ad-banner-bg',s.bannerBg||DEFAULT_ADMIT.bannerBg);setCol('ad-banner-text',s.bannerText||DEFAULT_ADMIT.bannerText);
  setChk('ad-show-photo',s.showPhoto!==false);
  const fields=s.fields||DEFAULT_ADMIT.fields;
  Object.entries({tracking_id:'adf-tracking',index_id:'adf-index',name_en:'adf-name-en',name_bn:'adf-name-bn',class:'adf-class',category:'adf-category',version:'adf-version',session:'adf-session',dob:'adf-dob',blood:'adf-blood'}).forEach(([k,id])=>setChk(id,fields[k]!==false));
  setV('ad-exam-center',s.examCenter||DEFAULT_ADMIT.examCenter);setV('ad-exam-date',s.examDate||'');setV('ad-exam-time',s.examTime||'');
  setV('ad-instructions',s.instructions||DEFAULT_ADMIT.instructions);
  const sig1=s.sig1||DEFAULT_ADMIT.sig1;const sig2=s.sig2||DEFAULT_ADMIT.sig2;
  setChk('ad-sig1-show',sig1.visible!==false);setV('ad-sig1-label',sig1.label);
  setChk('ad-sig2-show',sig2.visible!==false);setV('ad-sig2-label',sig2.label);
  setV('ad-footer',s.footer||DEFAULT_ADMIT.footer);
}
function collectAdmitDesignSettings(){
  return{
    header:{logoUrl:v('ad-logo-url')||DEFAULT_ADMIT.header.logoUrl,collegeName:v('ad-college-name'),address:v('ad-address'),cardTitle:v('ad-card-title')},
    bannerBg:col('ad-banner-bg'),bannerText:col('ad-banner-text'),
    showPhoto:chk('ad-show-photo'),
    fields:{tracking_id:chk('adf-tracking'),index_id:chk('adf-index'),name_en:chk('adf-name-en'),name_bn:chk('adf-name-bn'),class:chk('adf-class'),category:chk('adf-category'),version:chk('adf-version'),session:chk('adf-session'),dob:chk('adf-dob'),blood:chk('adf-blood')},
    examCenter:v('ad-exam-center'),examDate:v('ad-exam-date'),examTime:v('ad-exam-time'),
    instructions:document.getElementById('ad-instructions')?.value||'',
    sig1:{visible:chk('ad-sig1-show'),label:v('ad-sig1-label')},
    sig2:{visible:chk('ad-sig2-show'),label:v('ad-sig2-label')},
    footer:v('ad-footer'),
  };
}
function updateAdmitPreview(){
  const settings=collectAdmitDesignSettings();
  const iframe=document.getElementById('admit-preview-iframe');if(!iframe)return;
  iframe.srcdoc=generateAdmitHtml(DEMO_APP,settings,true);
}
async function saveAdmitDesign(){
  const value=collectAdmitDesignSettings();currentAdmitSettings=deepMerge(DEFAULT_ADMIT,value);
  setLoading(true);const r=await api('saveSettings',{key:'admit_card_settings',value});setLoading(false);
  if(r.error){toast(r.error,'error');return;}toast('Admit card design saved','success');
}
function resetAdmitDesign(){
  populateAdmitDesigner(DEFAULT_ADMIT);updateAdmitPreview();
}

/* ─── Admit Card Templates ────────────────────────── */
let admitTemplates=[];
let admitActiveTplId=null;
function getActiveAdmitTpl(){return admitTemplates.find(t=>t.id===admitActiveTplId)||null;}
async function saveAdmitTplsDB(){
  return api('saveSettings',{key:'admit_templates',value:{templates:admitTemplates,activeId:admitActiveTplId}});
}
async function loadAdmitTemplates(){
  setLoading(true);const r=await api('getSettings',{});setLoading(false);
  const s=r.settings||{};
  const data=s.admit_templates||{};
  admitTemplates=data.templates||[];
  admitActiveTplId=data.activeId||null;
  // Migrate legacy admit_card_settings
  if(!admitTemplates.length&&s.admit_card_settings&&Object.keys(s.admit_card_settings).length){
    const legacy={id:'admit_legacy_'+Date.now(),name:'Default Card',settings:s.admit_card_settings,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    admitTemplates.push(legacy);admitActiveTplId=legacy.id;saveAdmitTplsDB();
  }
  const tpl=getActiveAdmitTpl()||(admitTemplates.length?admitTemplates[0]:null);
  if(tpl){admitActiveTplId=tpl.id;currentAdmitSettings=deepMerge(DEFAULT_ADMIT,tpl.settings||{});}
  else{admitActiveTplId=null;currentAdmitSettings=deepMerge(DEFAULT_ADMIT,{});}
  populateAdmitDesigner(currentAdmitSettings);
  renderAdmitTplBar();
  setTimeout(updateAdmitPreview,100);
}
function renderAdmitTplBar(){
  const bar=document.getElementById('admit-tpl-bar');if(!bar)return;
  const opts=admitTemplates.map(t=>`<option value="${t.id}"${t.id===admitActiveTplId?' selected':''}>${t.name}</option>`).join('');
  const count=admitTemplates.length;
  bar.innerHTML=
    `<span class="flbl" style="white-space:nowrap;align-self:center">Templates (${count}):</span>`+
    (count
      ?`<select id="admit-tpl-sel" class="finput finput-sm" style="max-width:200px;flex:1" onchange="admitSwitchTpl(this.value)">${opts}</select>
        <button class="fd-tool text-emerald-700 font-black" onclick="admitSaveTpl()" title="Save current settings to this template">Save</button>
        <button class="fd-tool text-blue-600" onclick="admitSaveAsTpl()" title="Save as a new template">Save As…</button>
        <button class="fd-tool" onclick="admitRenameTpl()">Rename</button>
        <button class="fd-tool text-red-400" onclick="admitDeleteTpl()">Delete</button>`
      :`<span style="font-size:11px;color:#94a3b8;align-self:center">No templates yet</span>`)+
    `<button class="fd-tool" onclick="admitNewTpl()">+ New</button>`;
}
function admitSwitchTpl(id){
  if(id===admitActiveTplId)return;
  admitActiveTplId=id;
  const tpl=getActiveAdmitTpl();
  currentAdmitSettings=deepMerge(DEFAULT_ADMIT,tpl?tpl.settings||{}:{});
  populateAdmitDesigner(currentAdmitSettings);updateAdmitPreview();renderAdmitTplBar();
}
async function admitSaveTpl(){
  if(!admitActiveTplId){await admitSaveAsTpl();return;}
  const tpl=getActiveAdmitTpl();if(!tpl){await admitSaveAsTpl();return;}
  tpl.settings=collectAdmitDesignSettings();tpl.updatedAt=new Date().toISOString();
  currentAdmitSettings=deepMerge(DEFAULT_ADMIT,tpl.settings);
  setLoading(true);const r=await saveAdmitTplsDB();setLoading(false);
  if(r.error){toast(r.error,'error');return;}toast('"'+tpl.name+'" saved','success');
}
async function admitSaveAsTpl(){
  const name=prompt('Template name:','Card '+(admitTemplates.length+1));
  if(!name||!name.trim())return;
  const id='admit_'+Date.now();
  admitTemplates.push({id,name:name.trim(),settings:collectAdmitDesignSettings(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  admitActiveTplId=id;
  setLoading(true);const r=await saveAdmitTplsDB();setLoading(false);
  if(r.error){toast(r.error,'error');return;}toast('"'+name.trim()+'" created','success');renderAdmitTplBar();
}
async function admitRenameTpl(){
  const tpl=getActiveAdmitTpl();if(!tpl){toast('No active template','warn');return;}
  const name=prompt('New name:',tpl.name);
  if(!name||!name.trim()||name.trim()===tpl.name)return;
  tpl.name=name.trim();
  setLoading(true);const r=await saveAdmitTplsDB();setLoading(false);
  if(r.error){toast(r.error,'error');return;}toast('Renamed to "'+tpl.name+'"','success');renderAdmitTplBar();
}
async function admitDeleteTpl(){
  const tpl=getActiveAdmitTpl();if(!tpl){toast('No active template','warn');return;}
  if(!await openConfirm('Delete template "'+tpl.name+'" permanently?','Delete'))return;
  admitTemplates=admitTemplates.filter(t=>t.id!==admitActiveTplId);
  const next=admitTemplates[0]||null;
  admitActiveTplId=next?next.id:null;
  currentAdmitSettings=deepMerge(DEFAULT_ADMIT,next?next.settings||{}:{});
  setLoading(true);const r=await saveAdmitTplsDB();setLoading(false);
  if(r.error){toast(r.error,'error');return;}
  toast('Deleted','success');populateAdmitDesigner(currentAdmitSettings);updateAdmitPreview();renderAdmitTplBar();
}
function admitNewTpl(){
  const name=prompt('New template name:','Card '+(admitTemplates.length+1));
  if(!name||!name.trim())return;
  const id='admit_'+Date.now();
  admitTemplates.push({id,name:name.trim(),settings:deepMerge(DEFAULT_ADMIT,{}),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  admitActiveTplId=id;
  currentAdmitSettings=deepMerge(DEFAULT_ADMIT,{});
  populateAdmitDesigner(currentAdmitSettings);updateAdmitPreview();renderAdmitTplBar();
  toast('"'+name.trim()+'" started — edit settings and Save','info');
}

/* ═══════════════════════════════════════════════════
   CIRCULAR BUILDER
   ═══════════════════════════════════════════════════ */
const DEFAULT_CIRCULAR={
  title:'Admission Circular',session:new Date().getFullYear().toString(),
  publishedDate:'',description:'',useSymbolCounter:false,
  dimensions:[
    {id:'cdim_class',    label:'Class',    options:[]},
    {id:'cdim_version',  label:'Version',  options:[]},
    {id:'cdim_category', label:'Category', options:[]},
  ],
  entries:[]
};
let currentCircular=null;

/* ── helpers ── */
function circEscH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function circSymbol(entry,dims){
  var parts=(dims||[]).map(function(dim){
    var sel=((entry.selections||{})[dim.id])||[];
    if(!sel.length)return null;
    var syms=[];
    (dim.options||[]).forEach(function(opt){
      if(sel.includes(opt.value)&&opt.symbol&&!syms.includes(opt.symbol))syms.push(opt.symbol);
    });
    return syms.join('')||null;
  }).filter(Boolean);
  return parts.join('-');
}
function circEntryLabel(entry,dims){
  return (dims||[]).map(function(dim){
    var sel=((entry.selections||{})[dim.id])||[];
    if(!sel.length)return null;
    var labels=sel.map(function(v){
      var opt=(dim.options||[]).find(function(o){return o.value===v;});
      return opt?opt.label||opt.value:v;
    });
    return labels.join('+');
  }).filter(Boolean).join(' — ');
}

/* ── Load / Save ── */
async function loadCircular(){
  setLoading(true);const r=await api('getSettings',{});setLoading(false);
  const s=r.settings||{};
  const saved=s.circular_settings||{};
  // Deep merge preserving arrays
  currentCircular=Object.assign({},DEFAULT_CIRCULAR,saved);
  if(!Array.isArray(currentCircular.dimensions))currentCircular.dimensions=DEFAULT_CIRCULAR.dimensions.map(function(d){return Object.assign({},d);});
  if(!Array.isArray(currentCircular.entries))currentCircular.entries=[];
  populateCircularInfo();
  renderCircularDimensions();
  renderCircularEntries();
}
function populateCircularInfo(){
  const c=currentCircular;
  document.getElementById('circ-title').value=c.title||'';
  document.getElementById('circ-session').value=c.session||'';
  document.getElementById('circ-date').value=c.publishedDate||'';
  document.getElementById('circ-start-date').value=c.startDate||'';
  document.getElementById('circ-start-time').value=c.startTime||'';
  document.getElementById('circ-end-date').value=c.endDate||'';
  document.getElementById('circ-end-time').value=c.endTime||'';
  const tzSel=document.getElementById('circ-tz');
  if(tzSel&&c.timezone){tzSel.value=c.timezone||'GMT+6';}
  document.getElementById('circ-desc').value=c.description||'';
  document.getElementById('circ-use-symbol').checked=!!c.useSymbolCounter;
}
async function saveCircular(){
  if(!currentCircular){toast('Load circular first','warn');return;}
  currentCircular.title=document.getElementById('circ-title').value.trim()||currentCircular.title;
  currentCircular.session=document.getElementById('circ-session').value.trim()||currentCircular.session;
  currentCircular.publishedDate=document.getElementById('circ-date').value;
  currentCircular.startDate=document.getElementById('circ-start-date').value;
  currentCircular.startTime=document.getElementById('circ-start-time').value;
  currentCircular.endDate=document.getElementById('circ-end-date').value;
  currentCircular.endTime=document.getElementById('circ-end-time').value;
  currentCircular.timezone=document.getElementById('circ-tz').value||'GMT+6';
  currentCircular.description=document.getElementById('circ-desc').value;
  currentCircular.useSymbolCounter=document.getElementById('circ-use-symbol').checked;
  setLoading(true);const r=await api('saveSettings',{key:'circular_settings',value:currentCircular});setLoading(false);
  if(r.error){toast(r.error,'error');return;}
  const note=document.getElementById('circ-save-note');
  if(note){note.textContent='Saved '+new Date().toLocaleTimeString();setTimeout(function(){note.textContent='';},3000);}
  toast('Circular saved','success');
  // refresh index mapping so new classes/categories appear immediately
  populateIndexSettings(currentIndexSettings);
}

/* ── Dimensions ── */
function renderCircularDimensions(){
  const c=currentCircular;if(!c)return;
  const dims=c.dimensions||[];
  const el=document.getElementById('circ-dims');if(!el)return;
  const cnt=document.getElementById('circ-dim-count');if(cnt)cnt.textContent='('+dims.length+')';
  if(!dims.length){
    el.innerHTML='<div class="circ-empty">No dimensions yet — click "+ Add Dimension" to create Class, Version, Category, etc.</div>';
    return;
  }
  el.innerHTML=dims.map(function(dim){
    var opts=(dim.options||[]).map(function(opt,oi){
      return '<div class="circ-opt-row">'+
        '<input class="finput finput-sm" style="width:100px" placeholder="Value (e.g. One)" value="'+circEscH(opt.value)+'" oninput="circUpdOpt(\''+dim.id+'\','+oi+',\'value\',this.value)" title="Application field value">'+
        '<input class="finput finput-sm" style="flex:1;min-width:80px" placeholder="Label (display)" value="'+circEscH(opt.label)+'" oninput="circUpdOpt(\''+dim.id+'\','+oi+',\'label\',this.value)" title="How it appears in the circular">'+
        '<input class="finput finput-sm" style="width:64px;text-align:center;font-weight:900;font-family:monospace" placeholder="Symbol" value="'+circEscH(opt.symbol)+'" oninput="circUpdOpt(\''+dim.id+'\','+oi+',\'symbol\',this.value)" title="Serial-counter key. Options with the same symbol share one counter.">'+
        '<button class="nav-btn nav-btn-danger" style="padding:3px 7px;font-size:11px;flex-shrink:0" onclick="circDelOpt(\''+dim.id+'\','+oi+')">×</button>'+
        '</div>';
    }).join('');
    return '<div class="circ-dim-card">'+
      '<div class="circ-dim-hdr">'+
        '<input class="finput finput-sm" style="font-weight:900;width:160px" placeholder="Dimension name" value="'+circEscH(dim.label)+'" oninput="circUpdDim(\''+dim.id+'\',\'label\',this.value)">'+
        '<div style="display:flex;gap:5px">'+
          '<button class="nav-btn" style="padding:3px 9px;font-size:10px" onclick="circAddOpt(\''+dim.id+'\')">+ Option</button>'+
          '<button class="nav-btn nav-btn-danger" style="padding:3px 9px;font-size:10px" onclick="circDelDim(\''+dim.id+'\')">Delete</button>'+
        '</div>'+
      '</div>'+
      '<div class="circ-opt-hdr">'+
        '<span style="width:100px">Value</span>'+
        '<span style="flex:1;min-width:80px">Display Label</span>'+
        '<span style="width:64px;text-align:center">Symbol</span>'+
        '<span style="width:30px"></span>'+
      '</div>'+
      (opts||'<div class="circ-empty" style="padding:4px 0">No options yet — click "+ Option"</div>')+
      '</div>';
  }).join('');
}
function circAddDimension(){
  if(!currentCircular)return;
  currentCircular.dimensions.push({id:'cdim_'+Date.now(),label:'Dimension '+(currentCircular.dimensions.length+1),options:[]});
  renderCircularDimensions();
}
function circDelDim(dimId){
  if(!currentCircular)return;
  if(!confirm('Delete this dimension? It will be removed from all entries.'))return;
  currentCircular.dimensions=currentCircular.dimensions.filter(function(d){return d.id!==dimId;});
  currentCircular.entries.forEach(function(e){if(e.selections)delete e.selections[dimId];});
  renderCircularDimensions();renderCircularEntries();
}
function circUpdDim(dimId,field,val){
  var dim=(currentCircular.dimensions||[]).find(function(d){return d.id===dimId;});
  if(dim)dim[field]=val;
}
function circAddOpt(dimId){
  var dim=(currentCircular.dimensions||[]).find(function(d){return d.id===dimId;});
  if(!dim)return;
  dim.options.push({value:'',label:'',symbol:''});
  renderCircularDimensions();
}
function circDelOpt(dimId,oi){
  var dim=(currentCircular.dimensions||[]).find(function(d){return d.id===dimId;});
  if(!dim)return;
  dim.options.splice(oi,1);
  renderCircularDimensions();renderCircularEntries();
}
function circUpdOpt(dimId,oi,field,val){
  var dim=(currentCircular.dimensions||[]).find(function(d){return d.id===dimId;});
  if(!dim||!dim.options[oi])return;
  dim.options[oi][field]=val;
  // refresh entries so chip labels & symbols stay live
  renderCircularEntries();
}

/* ── Entries ── */
function renderCircularEntries(){
  const c=currentCircular;if(!c)return;
  const entries=c.entries||[];
  const dims=c.dimensions||[];
  const el=document.getElementById('circ-entries');if(!el)return;
  const cnt=document.getElementById('circ-ent-count');if(cnt)cnt.textContent='('+entries.length+')';
  if(!entries.length){
    el.innerHTML='<div class="circ-empty">No entries yet — click "+ Add Entry" or "⚙ Generate All Combos".</div>';
    return;
  }

  // Preserve which sub-rows were open
  const openSubs=new Set();
  el.querySelectorAll('.circ-sub-row:not(.hidden)').forEach(function(r){openSubs.add(r.dataset.eid);});

  var dimThs=dims.map(function(d){return '<th>'+circEscH(d.label)+'</th>';}).join('');
  var rows=entries.map(function(entry,ei){
    var autoSym=circSymbol(entry,dims);
    var displaySym=entry.symbolOverride||autoSym||'—';
    var dimTds=dims.map(function(dim){
      var sel=((entry.selections||{})[dim.id])||[];
      var chips=(dim.options||[]).map(function(opt){
        var on=sel.includes(opt.value);
        return '<button class="circ-val-chip'+(on?' circ-val-on':'')+
          '" onclick="circToggleVal(\''+entry.id+'\',\''+dim.id+'\',\''+circEscH(opt.value)+'\')">'+
          circEscH(opt.label||opt.value)+'</button>';
      }).join('');
      return '<td><div class="circ-val-chips">'+(chips||'<span style="font-size:9px;color:#94a3b8">—</span>')+'</div></td>';
    }).join('');

    // Application Options sub-table
    var opts=entry.appOptions||[];
    var optsRows=opts.map(function(opt,oi){
      return '<tr>'+
        '<td><input class="finput finput-sm" style="width:100%" value="'+circEscH(opt.label||'')+
          '" placeholder="Option name" oninput="circUpdSubOpt(\''+entry.id+'\',\''+opt.id+'\',\'label\',this.value)"></td>'+
        '<td><input class="finput finput-sm" style="width:60px;text-align:center" type="number" min="0" value="'+(opt.seats||'')+
          '" placeholder="0" oninput="circUpdSubOpt(\''+entry.id+'\',\''+opt.id+'\',\'seats\',+(this.value)||0)"></td>'+
        '<td><input class="finput finput-sm" style="width:100%" value="'+circEscH(opt.note||'')+
          '" placeholder="note" oninput="circUpdSubOpt(\''+entry.id+'\',\''+opt.id+'\',\'note\',this.value)"></td>'+
        '<td><button onclick="circDelSubOpt(\''+entry.id+'\',\''+opt.id+'\')" style="color:#ef4444;background:none;border:none;cursor:pointer;font-size:14px;font-weight:900;padding:0 3px">×</button></td>'+
        '</tr>';
    }).join('');
    var subContent='<div style="padding:8px 12px;background:#f8fafc;border-top:1px solid #e2e8f0">'+
      '<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;color:#6366f1;margin-bottom:6px">Application Options '+(opts.length?'('+opts.length+')':'— none yet')+'</div>'+
      '<table class="circ-sub-table">'+
        '<thead><tr><th>Option / Quota Name</th><th style="width:70px">Seats</th><th>Note</th><th style="width:28px"></th></tr></thead>'+
        '<tbody>'+optsRows+'</tbody>'+
      '</table>'+
      '<button class="nav-btn" style="font-size:9px;padding:3px 9px;margin-top:5px" onclick="circAddSubOpt(\''+entry.id+'\')">+ Add Option</button>'+
    '</div>';

    var isOpen=openSubs.has(entry.id);
    return '<tr class="circ-entry-row'+(entry.active?'':' circ-entry-off')+'">'+
        '<td class="text-center" style="font-size:9px;color:#94a3b8;font-weight:900">'+(ei+1)+'</td>'+
        '<td style="white-space:nowrap"><span class="circ-entry-sym">'+circEscH(displaySym)+'</span></td>'+
        dimTds+
        '<td>'+
          '<div style="display:flex;align-items:center;gap:3px">'+
            '<input class="finput finput-sm" style="width:48px;font-family:monospace;font-weight:900" placeholder="auto" value="'+circEscH(entry.symbolOverride||'')+
              '" oninput="circUpdEntry(\''+entry.id+'\',\'symbolOverride\',this.value)" title="Override symbol (leave blank for auto)">'+
          '</div>'+
        '</td>'+
        '<td><input class="finput finput-sm" style="width:52px;text-align:center" type="number" min="0" placeholder="0" value="'+(entry.seats||'')+
          '" oninput="circUpdEntry(\''+entry.id+'\',\'seats\',+(this.value)||0)"></td>'+
        '<td style="text-align:center">'+
          '<input type="checkbox"'+(entry.active?' checked':'')+
            ' onchange="circUpdEntry(\''+entry.id+'\',\'active\',this.checked)" style="width:14px;height:14px;accent-color:#2563eb;cursor:pointer">'+
        '</td>'+
        '<td><input class="finput finput-sm" style="min-width:80px;width:100%" placeholder="note" value="'+circEscH(entry.note||'')+
          '" oninput="circUpdEntry(\''+entry.id+'\',\'note\',this.value)"></td>'+
        '<td style="white-space:nowrap">'+
          '<button class="nav-btn" style="padding:2px 6px;font-size:10px" onclick="circToggleSub(\''+entry.id+'\')" title="Application options">'+(opts.length?'⚙'+opts.length:'⚙')+'</button> '+
          '<button class="nav-btn" style="padding:2px 6px;font-size:10px" onclick="circMoveEntry(\''+entry.id+'\','+ei+',-1)" '+(ei===0?'disabled':'')+'>↑</button>'+
          '<button class="nav-btn" style="padding:2px 6px;font-size:10px" onclick="circMoveEntry(\''+entry.id+'\','+ei+',1)" '+(ei===entries.length-1?'disabled':'')+'>↓</button>'+
          '<button style="color:#ef4444;background:none;border:none;cursor:pointer;font-size:15px;font-weight:900;padding:0 3px" onclick="circDelEntry(\''+entry.id+'\')">×</button>'+
        '</td>'+
      '</tr>'+
      '<tr class="circ-sub-row'+(isOpen?'':' hidden')+'" data-eid="'+entry.id+'">'+
        '<td colspan="'+(5+dims.length)+'">'+subContent+'</td>'+
      '</tr>';
  }).join('');

  el.innerHTML='<div style="overflow-x:auto"><table class="circ-tbl" style="width:100%;border-collapse:collapse">'+
    '<thead><tr>'+
      '<th style="width:30px">#</th>'+
      '<th style="white-space:nowrap">Symbol</th>'+
      dimThs+
      '<th style="white-space:nowrap">Sym Override</th>'+
      '<th>Seats</th><th>Active</th><th>Note</th><th>Actions</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
  '</table></div>';
}
function circToggleSub(entId){
  const sub=document.querySelector('.circ-sub-row[data-eid="'+entId+'"]');
  if(sub)sub.classList.toggle('hidden');
}
function circAddSubOpt(entId){
  var entry=(currentCircular.entries||[]).find(function(e){return e.id===entId;});
  if(!entry)return;
  if(!entry.appOptions)entry.appOptions=[];
  entry.appOptions.push({id:'opt_'+Date.now(),label:'',seats:0,note:''});
  renderCircularEntries();
}
function circDelSubOpt(entId,optId){
  var entry=(currentCircular.entries||[]).find(function(e){return e.id===entId;});
  if(!entry||!entry.appOptions)return;
  entry.appOptions=entry.appOptions.filter(function(o){return o.id!==optId;});
  renderCircularEntries();
}
function circUpdSubOpt(entId,optId,field,val){
  var entry=(currentCircular.entries||[]).find(function(e){return e.id===entId;});
  if(!entry||!entry.appOptions)return;
  var opt=entry.appOptions.find(function(o){return o.id===optId;});
  if(opt)opt[field]=val;
}
function circAddEntry(){
  if(!currentCircular)return;
  currentCircular.entries.push({id:'ent_'+Date.now(),selections:{},symbolOverride:'',seats:0,active:true,note:''});
  renderCircularEntries();
}
function circDelEntry(entId){
  if(!currentCircular)return;
  currentCircular.entries=currentCircular.entries.filter(function(e){return e.id!==entId;});
  renderCircularEntries();
}
function circUpdEntry(entId,field,val){
  var entry=(currentCircular.entries||[]).find(function(e){return e.id===entId;});
  if(!entry)return;
  entry[field]=val;
  if(field==='symbolOverride'||field==='active'){renderCircularEntries();}
}
function circMoveEntry(entId,idx,dir){
  var arr=currentCircular.entries;var ni=idx+dir;
  if(ni<0||ni>=arr.length)return;
  var tmp=arr[idx];arr[idx]=arr[ni];arr[ni]=tmp;
  renderCircularEntries();
}
function circToggleVal(entId,dimId,val){
  var entry=(currentCircular.entries||[]).find(function(e){return e.id===entId;});
  if(!entry)return;
  if(!entry.selections)entry.selections={};
  if(!entry.selections[dimId])entry.selections[dimId]=[];
  var arr=entry.selections[dimId];
  var idx=arr.indexOf(val);
  if(idx>=0)arr.splice(idx,1);else arr.push(val);
  renderCircularEntries();
}
function circGenerateCombinations(){
  if(!currentCircular)return;
  var dims=currentCircular.dimensions||[];
  if(!dims.length){toast('Add dimensions first','warn');return;}
  var allHaveOpts=dims.every(function(d){return d.options&&d.options.length;});
  if(!allHaveOpts){toast('Every dimension must have at least one option','warn');return;}
  // Cartesian product (single value per dimension per combo)
  var combos=[{}];
  dims.forEach(function(dim){
    var next=[];
    (dim.options||[]).forEach(function(opt){
      combos.forEach(function(prev){
        var ns=Object.assign({},prev);ns[dim.id]=[opt.value];next.push(ns);
      });
    });
    combos=next;
  });
  var added=0;
  combos.forEach(function(sel){
    var entry={id:'ent_'+Date.now()+'x'+(added++),selections:sel,symbolOverride:'',seats:0,active:true,note:''};
    currentCircular.entries.push(entry);
  });
  toast(added+' entries generated','success');
  renderCircularEntries();
}

/* ─── Live designer listeners ─────────────────────── */
function initDesignerListeners(){
  const fdUpdate=debounce(updateFormPreview,400);
  const adUpdate=debounce(updateAdmitPreview,400);
  document.getElementById('form-designer-panel')?.addEventListener('input',fdUpdate);
  document.getElementById('form-designer-panel')?.addEventListener('change',fdUpdate);
  document.getElementById('admit-designer-panel')?.addEventListener('input',adUpdate);
  document.getElementById('admit-designer-panel')?.addEventListener('change',adUpdate);
}

/* ─── Counters ───────────────────────────────────── */
async function loadCounters(){
  const r=await api('listCounters',{});
  const el=document.getElementById('counters-table');if(!el)return;
  if(!r.counters||!r.counters.length){el.innerHTML='<p class="text-sm text-slate-400">No counters yet. Index IDs will be assigned when applications are saved.</p>';return;}
  el.innerHTML=`<table class="w-full text-sm"><thead><tr class="bg-slate-50 text-left">
    <th class="px-3 py-2 text-[10px] font-black uppercase text-slate-500">Year</th>
    <th class="px-3 py-2 text-[10px] font-black uppercase text-slate-500">Class</th>
    <th class="px-3 py-2 text-[10px] font-black uppercase text-slate-500">Counter</th>
    <th class="px-3 py-2 text-right text-[10px] font-black uppercase text-slate-500">Reset</th>
    </tr></thead><tbody>
    ${r.counters.map(c=>`<tr class="border-t border-slate-100">
      <td class="px-3 py-2 font-bold">${c.year}</td>
      <td class="px-3 py-2">${c.class}</td>
      <td class="px-3 py-2 font-black text-blue-600">${c.counter}</td>
      <td class="px-3 py-2 text-right"><button onclick="resetCounter('${c.year}','${c.class}')" class="text-[10px] font-black uppercase text-red-400 hover:text-red-600 px-2 py-1 hover:bg-red-50 rounded-lg transition-all">Reset</button></td>
    </tr>`).join('')}
    </tbody></table>`;
}
async function resetCounter(year,cls){
  if(!await openConfirm(`Reset counter for ${cls} ${year}? This may cause duplicate Index IDs.`,'Reset'))return;
  const r=await api('resetCounter',{year,cls});
  if(r.error){toast(r.error,'error');return;}toast('Counter reset','success');loadCounters();
}

/* ─── Keyboard shortcuts ──────────────────────────── */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeConfirm(false);
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();const fv=document.getElementById('view-form');if(fv&&!fv.classList.contains('hidden'))saveApplication();}
});

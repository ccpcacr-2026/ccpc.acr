/* ═══════════════════════════════════════════════════════
   Admission Admin — Visual Form Canvas Designer
   Lazy-loaded via _ensureAdmissionFormDesigner() in _src/app.js
   (which first ensures admission-print-templates.js is loaded —
   this file uses fmtDate()/openPrintTab() from it).
   Ported from ccpc-admission/public/form-designer.js. Adaptations:
   - loadCustomFieldDefs() calls _admAdminFetch('getFormFields')
     instead of the reference app's own api() helper.
   - fdClearCanvas() uses this portal's showConfirm(msg, cb) instead
     of the reference's openConfirm(msg,label).then(ok=>...).
   - The reference app's OWN template-CRUD functions in this file
     (formTemplates/activeTplId/getActiveTpl/cloneLayout/saveTplsDB/
     loadFormTemplates/renderTplBar/fdSwitchTpl/fdSaveTpl/fdSaveAsTpl/
     fdRenameTpl/fdDeleteTpl/fdNewTpl) are DROPPED here — in the real
     ccpc-admission admin panel these are shadowed/overwritten by a
     second, different implementation of the same function names
     declared later in its own app.js (same #fd-tpl-bar target, same
     "getSettings"/"saveSettings" key 'form_templates', different
     onclick names: formSwitchTpl/formSaveTpl/etc.) — that's the
     version actually live in the reference app's browser, so that's
     the one ported, natively, into _src/app.js's _admForm* wiring
     instead of duplicated here.
   - fdRenderProps()'s "selected fields" column-header inputs call
     fdPropUpd(...), which the reference app never defines anywhere
     (a latent dead reference in the original — those two inputs
     throw silently there). Defined here as a straightforward
     generic property setter so they actually work.
   ═══════════════════════════════════════════════════════ */

/* ── Field registry ───────────────────────────────── */
var FIELD_MAP = {
  '__static__':         '— Static Text —',
  tracking_id:          'Tracking ID',
  index_id:             'Index ID',
  session:              'Session',
  class:                'Class',
  category:             'Category',
  version:              'Version',
  quota:                'Quota',
  name_english:         'Name (English)',
  name_bangla:          'Name (Bangla)',
  date_of_birth:        'Date of Birth',
  age:                  'Age',
  blood_group:          'Blood Group',
  gender:               'Gender',
  religion:             'Religion',
  birth_reg_no:         'Birth Reg. No.',
  nationality:          'Nationality',
  emergency_contact:    'Emergency Contact',
  height:               'Height',
  co_curricular:        'Co-curricular',
  last_institute:       'Last Institute',
  last_class:           'Last Class',
  last_version:         'Last Version',
  present_address:      'Present Address',
  permanent_address:    'Permanent Address',
  father_name:          'Father Name',
  father_profession:    'Father Profession',
  father_designation:   'Father Designation',
  father_education:     'Father Education',
  father_contact:       'Father Contact',
  father_nid:           'Father NID',
  father_office_address:'Father Office',
  father_yearly_income: 'Father Income',
  mother_name:          'Mother Name',
  mother_profession:    'Mother Profession',
  mother_designation:   'Mother Designation',
  mother_education:     'Mother Education',
  mother_contact:       'Mother Contact',
  mother_nid:           'Mother NID',
  mother_office_address:'Mother Office',
  mother_yearly_income: 'Mother Income',
  guardian_name:        'Guardian Name',
  guardian_profession:  'Guardian Profession',
  guardian_designation: 'Guardian Designation',
  guardian_education:   'Guardian Education',
  guardian_contact:     'Guardian Contact',
  guardian_relation:    'Guardian Relation',
  guardian_office_address:'Guardian Office',
};
var FIELD_GROUPS = [
  {g:'Application', keys:['tracking_id','index_id','session','class','category','version','quota']},
  {g:'Student',     keys:['name_english','name_bangla','date_of_birth','age','blood_group','gender','religion','birth_reg_no','nationality','emergency_contact','height','co_curricular','last_institute','last_class','last_version','present_address','permanent_address']},
  {g:'Father',      keys:['father_name','father_profession','father_designation','father_education','father_contact','father_nid','father_office_address','father_yearly_income']},
  {g:'Mother',      keys:['mother_name','mother_profession','mother_designation','mother_education','mother_contact','mother_nid','mother_office_address','mother_yearly_income']},
  {g:'Guardian',    keys:['guardian_name','guardian_profession','guardian_designation','guardian_education','guardian_contact','guardian_relation','guardian_office_address']},
];
var PHOTO_MAP = {
  student_photo:  'Student Photo',
  father_photo:   'Father Photo',
  mother_photo:   'Mother Photo',
  guardian_photo: 'Guardian Photo',
};
var DEFAULT_LOGO = (typeof window!=='undefined'&&window.location&&window.location.origin?window.location.origin:'')+'/logo.jpg';
var CANVAS_W = 794, CANVAS_H = 1123;

// Ready-made canvas version of the official Application Form layout
// (mirrors DEFAULT_FORM in admission-print-templates.js), generated by a
// one-off layout script. Seeded into the Form Designer whenever there is
// no saved canvas template to show (see _admLoadFormTemplates() in
// _src/app.js) and offered via the "Load Official Template" button
// (fdLoadOfficialTemplate(), below) so the designer is never blank.
var DEFAULT_FORM_LAYOUT = [{"id":"el_seed_1","type":"logo","x":5.714,"y":4.04,"w":12,"h":9,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"logoUrl":""},{"id":"el_seed_2","type":"qr","x":80.286,"y":4.04,"w":14,"h":10,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"qrContent":"https://ccpc-admission.vercel.app/verify.html?code={tracking_id}","qrLabel":"Scan to verify","qrLabelPos":"bottom","qrShowLogo":false,"qrLogoUrl":""},{"id":"el_seed_3","type":"lbl","x":19.714,"y":4.04,"w":58.572,"h":3.2,"style":{"fontSize":13,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"center","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Chattogram Cantonment Public College"},{"id":"el_seed_4","type":"lbl","x":19.714,"y":7.24,"w":58.572,"h":2.4,"style":{"fontSize":6.5,"color":"#555555","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"center","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Bayezid Bostami-4210, Chattogram Cantonment  |  Phone: 02339243170  |  http://ccpc.edu.bd"},{"id":"el_seed_5","type":"lbl","x":19.714,"y":9.64,"w":58.572,"h":2.6,"style":{"fontSize":10,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"center","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"APPLICATION FORM"},{"id":"el_seed_6","type":"para","x":19.714,"y":12.24,"w":58.572,"h":2.3,"style":{"fontSize":8,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"center","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"content":"Session - {session}"},{"id":"el_seed_7","type":"para","x":5.714,"y":14.8,"w":88.572,"h":2.3,"style":{"fontSize":8,"color":"#333333","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#f0f0f0","align":"left","lineHeight":1.3,"padding":3,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"content":"Index ID: {index_id}      Class: {class}      Category: {category}      Version: {version}      Quota: {quota}"},{"id":"el_seed_8","type":"lbl","x":5.714,"y":17.4,"w":88.572,"h":2.4,"style":{"fontSize":8.5,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#e8e8e8","align":"left","lineHeight":1.3,"padding":3,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Applicant's Information"},{"id":"el_seed_9","type":"photo","x":83.286,"y":20,"w":11,"h":9,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#bbbbbb","borderWidth":1,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"photoField":"student_photo","photoLabel":"","photoLabelPos":"none"},{"id":"el_seed_10","type":"ld","x":5.714,"y":20,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Student's Name","field":"name_english","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_11","type":"ld","x":44.25,"y":20,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Tracking ID","field":"tracking_id","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_12","type":"ld","x":5.714,"y":22.35,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Student's Name Bangla","field":"name_bangla","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_13","type":"ld","x":44.25,"y":22.35,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Blood Group","field":"blood_group","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_14","type":"ld","x":5.714,"y":24.7,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Date of Birth","field":"date_of_birth","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_15","type":"ld","x":44.25,"y":24.7,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Religion","field":"religion","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_16","type":"ld","x":5.714,"y":27.05,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Age","field":"age","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_17","type":"ld","x":44.25,"y":27.05,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Birth Registration No.","field":"birth_reg_no","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_18","type":"ld","x":5.714,"y":29.4,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Gender","field":"gender","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_19","type":"ld","x":44.25,"y":29.4,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Nationality","field":"nationality","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_20","type":"ld","x":5.714,"y":31.75,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Emergency Contact No.","field":"emergency_contact","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_21","type":"ld","x":44.25,"y":31.75,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Height (Inch)","field":"height","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_22","type":"ld","x":5.714,"y":34.1,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Last Class","field":"last_class","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_23","type":"ld","x":44.25,"y":34.1,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Last Version","field":"last_version","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_24","type":"ld","x":5.714,"y":36.45,"w":76.072,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Last Institute","field":"last_institute","staticValue":"","labelPos":"left","labelWidth":22,"labelWidthUnit":"%"},{"id":"el_seed_25","type":"ld","x":5.714,"y":38.8,"w":76.072,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Present Address","field":"present_address","staticValue":"","labelPos":"left","labelWidth":22,"labelWidthUnit":"%"},{"id":"el_seed_26","type":"ld","x":5.714,"y":41.15,"w":76.072,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Permanent Address","field":"permanent_address","staticValue":"","labelPos":"left","labelWidth":22,"labelWidthUnit":"%"},{"id":"el_seed_27","type":"ld","x":5.714,"y":43.5,"w":76.072,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Co-curricular Activities","field":"co_curricular","staticValue":"","labelPos":"left","labelWidth":22,"labelWidthUnit":"%"},{"id":"el_seed_28","type":"lbl","x":5.714,"y":46.25,"w":88.572,"h":2.4,"style":{"fontSize":8.5,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#e8e8e8","align":"left","lineHeight":1.3,"padding":3,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Father's Details"},{"id":"el_seed_29","type":"photo","x":83.286,"y":48.85,"w":11,"h":9,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#bbbbbb","borderWidth":1,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"photoField":"father_photo","photoLabel":"","photoLabelPos":"none"},{"id":"el_seed_30","type":"ld","x":5.714,"y":48.85,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Father's Name","field":"father_name","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_31","type":"ld","x":44.25,"y":48.85,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Profession / Occupation","field":"father_profession","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_32","type":"ld","x":5.714,"y":51.2,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Designation / Rank","field":"father_designation","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_33","type":"ld","x":44.25,"y":51.2,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Education","field":"father_education","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_34","type":"ld","x":5.714,"y":53.55,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Contact No","field":"father_contact","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_35","type":"ld","x":44.25,"y":53.55,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"NID","field":"father_nid","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_36","type":"ld","x":5.714,"y":55.9,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Office Address / Unit","field":"father_office_address","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_37","type":"ld","x":44.25,"y":55.9,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Yearly Income","field":"father_yearly_income","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_38","type":"lbl","x":5.714,"y":58.65,"w":88.572,"h":2.4,"style":{"fontSize":8.5,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#e8e8e8","align":"left","lineHeight":1.3,"padding":3,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Mother's Details"},{"id":"el_seed_39","type":"photo","x":83.286,"y":61.25,"w":11,"h":9,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#bbbbbb","borderWidth":1,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"photoField":"mother_photo","photoLabel":"","photoLabelPos":"none"},{"id":"el_seed_40","type":"ld","x":5.714,"y":61.25,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Mother's Name","field":"mother_name","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_41","type":"ld","x":44.25,"y":61.25,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Profession / Occupation","field":"mother_profession","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_42","type":"ld","x":5.714,"y":63.6,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Designation / Rank","field":"mother_designation","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_43","type":"ld","x":44.25,"y":63.6,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Education","field":"mother_education","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_44","type":"ld","x":5.714,"y":65.95,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Contact No","field":"mother_contact","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_45","type":"ld","x":44.25,"y":65.95,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"NID","field":"mother_nid","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_46","type":"ld","x":5.714,"y":68.3,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Office Address / Unit","field":"mother_office_address","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_47","type":"ld","x":44.25,"y":68.3,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Yearly Income","field":"mother_yearly_income","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_48","type":"lbl","x":5.714,"y":71.05,"w":88.572,"h":2.4,"style":{"fontSize":8.5,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#e8e8e8","align":"left","lineHeight":1.3,"padding":3,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Local Guardian's Details"},{"id":"el_seed_49","type":"photo","x":83.286,"y":73.65,"w":11,"h":9,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#bbbbbb","borderWidth":1,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"photoField":"guardian_photo","photoLabel":"","photoLabelPos":"none"},{"id":"el_seed_50","type":"ld","x":5.714,"y":73.65,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Guardian's Name","field":"guardian_name","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_51","type":"ld","x":44.25,"y":73.65,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Profession / Occupation","field":"guardian_profession","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_52","type":"ld","x":5.714,"y":76,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Designation / Rank","field":"guardian_designation","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_53","type":"ld","x":44.25,"y":76,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Education","field":"guardian_education","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_54","type":"ld","x":5.714,"y":78.35,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Contact No","field":"guardian_contact","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_55","type":"ld","x":44.25,"y":78.35,"w":37.536,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Relation","field":"guardian_relation","staticValue":"","labelPos":"left","labelWidth":40,"labelWidthUnit":"%"},{"id":"el_seed_56","type":"ld","x":5.714,"y":80.7,"w":76.072,"h":2.35,"style":{"fontSize":8.5,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"label":"Office Address","field":"guardian_office_address","staticValue":"","labelPos":"left","labelWidth":22,"labelWidthUnit":"%"},{"id":"el_seed_57","type":"lbl","x":5.714,"y":83.35,"w":88.572,"h":1.5,"style":{"fontSize":8,"color":"#1a2b5c","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":true,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"left","lineHeight":1.3,"padding":1,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Terms & Conditions"},{"id":"el_seed_58","type":"para","x":5.714,"y":84.95,"w":88.572,"h":5.4,"style":{"fontSize":7.3,"color":"#333333","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#fafafa","align":"left","lineHeight":1.45,"padding":3,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"content":"1. I hereby declare that all information provided in this application is true and correct to the best of my knowledge. Any false information may result in cancellation of admission.\n2. I agree to abide by all rules and regulations of Chattogram Cantonment Public College."},{"id":"el_seed_59","type":"lbl","x":70.286,"y":90.65,"w":24,"h":0.15,"style":{"fontSize":9,"color":"#111111","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"#333333","align":"left","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":""},{"id":"el_seed_60","type":"lbl","x":70.286,"y":91.1,"w":24,"h":2.3,"style":{"fontSize":7.5,"color":"#555555","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"center","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Guardian's Signature & Date"},{"id":"el_seed_61","type":"lbl","x":5.714,"y":93.7,"w":88.572,"h":1.8,"style":{"fontSize":6.5,"color":"#aaaaaa","labelFontSize":8,"labelColor":"#555555","labelBold":false,"labelItalic":false,"labelUnderline":false,"bold":false,"italic":false,"underline":false,"borderColor":"#cccccc","borderWidth":0,"borderStyle":"solid","borderRadius":0,"bg":"transparent","align":"center","lineHeight":1.3,"padding":2,"hdrBg":"#1a2b5c","hdrColor":"#ffffff","hdrFontSize":9},"field":"__static__","staticValue":"Chattogram Cantonment Public College — Official Admission Form — Page 1 of 1"}];

/* ── State ────────────────────────────────────────── */
var formLayout = [];
var fdSelectedId = null;
var fdScale = 1;
var fdDrag = null;   // {id, sx, sy, ox, oy}
var fdResize = null; // {id, sx, sy, ow, oh}

/* ── Coordinate helpers ───────────────────────────── */
function px(pctW) { return Math.round(pctW * CANVAS_W / 100); }
function py(pctH) { return Math.round(pctH * CANVAS_H / 100); }
function pcx(pixels) { return +(pixels * 100 / CANVAS_W).toFixed(3); }
function pcy(pixels) { return +(pixels * 100 / CANVAS_H).toFixed(3); }

/* ── Default elements ─────────────────────────────── */
function mkEl(type) {
  var base = {
    id: 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
    type: type, x: 5, y: 5, w: 45, h: 8,
    style: {
      fontSize:11, color:'#111111',
      labelFontSize:9, labelColor:'#555555',
      labelBold:false, labelItalic:false, labelUnderline:false,
      bold:false, italic:false, underline:false,
      borderColor:'#cccccc', borderWidth:1, borderStyle:'solid', borderRadius:0,
      bg:'transparent', align:'left', lineHeight:1.5, padding:4,
      hdrBg:'#1a2b5c', hdrColor:'#ffffff', hdrFontSize:9,
    }
  };
  switch(type) {
    case 'ld':   return Object.assign(base, {label:'Label', field:'name_english', staticValue:'', labelPos:'left', labelWidth:38, labelWidthUnit:'%'});
    case 'table':return Object.assign(base, {h:14, rowCount:1, dataMode:'data', fieldColLabel1:'Particulars', fieldColLabel2:'Details', selectedFields:[], columns:[{label:'Field 1',field:'name_english'},{label:'Field 2',field:'class'}]});
    case 'lbl':  return Object.assign(base, {h:5, field:'name_english', staticValue:''});
    case 'para': return Object.assign(base, {h:18, content:'Type text here.\nUse {tracking_id} to insert field values.'});
    case 'photo':return Object.assign(base, {w:15, h:20, photoField:'student_photo'});
    case 'logo': return Object.assign(base, {w:18, h:18, logoUrl:DEFAULT_LOGO});
    case 'qr':   return Object.assign(base, {w:18, h:22,
      qrContent:'{tracking_id}',
      qrLabel:'{name_english}',
      qrLabelPos:'bottom',
      qrShowLogo:false,
      qrLogoUrl:DEFAULT_LOGO,
    });
    default: return base;
  }
}

/* ── Canvas init ──────────────────────────────────── */
function initCanvas() {
  var canvas = document.getElementById('adm-fd-canvas');
  if (!canvas) return;
  document.addEventListener('mousemove', fdMouseMove);
  document.addEventListener('mouseup', fdMouseUp);
  canvas.addEventListener('mousedown', function(e) {
    if (e.target === canvas) { fdSelect(null); }
  });
  loadCustomFieldDefs();
  fdRender();
}

// Merges admin-added custom fields (Settings → Form Fields tab) into the
// field picker so they can be dropped onto a print template too — fetched
// fresh each time the designer opens, since a field can be renamed/added/
// deleted after the canvas was last shown.
function loadCustomFieldDefs() {
  if (typeof _admAdminFetch !== 'function') return;
  var groupByKey = {student:'Student', father:'Father', mother:'Mother', guardian:'Guardian'};
  _admAdminFetch('getFormFields', {}).then(function(r) {
    var fields = (r && r.fields) || [];
    fields.filter(function(f){ return !f.built_in; }).forEach(function(f) {
      FIELD_MAP[f.key] = f.label;
      var grpName = groupByKey[f.section] || 'Student';
      var grp = FIELD_GROUPS.filter(function(g){ return g.g === grpName; })[0];
      if (grp && grp.keys.indexOf(f.key) === -1) grp.keys.push(f.key);
    });
    fdRenderFieldsPanel();
  }).catch(function(){});
}

/* ── Fields panel: every known field, marked placed/not-placed, with a
   duplicate-or-add action — kept in sync by calling this from fdRender()
   (which every add/delete/duplicate/property-edit path already calls). ── */
function fdFieldUsage() {
  var counts = {};
  function bump(k) { if (!k || k === '__static__') return; counts[k] = (counts[k]||0) + 1; }
  function extractTemplateFields(str) {
    (String(str||'').match(/\{(\w+)\}/g) || []).forEach(function(m) { bump(m.slice(1, -1)); });
  }
  formLayout.forEach(function(el) {
    if (el.type === 'ld' || el.type === 'lbl') bump(el.field);
    else if (el.type === 'photo') bump(el.photoField);
    else if (el.type === 'para') extractTemplateFields(el.content);
    else if (el.type === 'qr') { extractTemplateFields(el.qrContent); extractTemplateFields(el.qrLabel); }
    else if (el.type === 'table') {
      if (el.dataMode === 'selected') (el.selectedFields || []).forEach(function(sf){ bump(sf.field); });
      else (el.columns || []).forEach(function(c){ bump(c.field); });
    }
  });
  return counts;
}
function fdFirstElementForField(field) {
  for (var i = 0; i < formLayout.length; i++) {
    var el = formLayout[i];
    if ((el.type === 'ld' || el.type === 'lbl') && el.field === field) return el.id;
    if (el.type === 'photo' && el.photoField === field) return el.id;
  }
  return null;
}
function fdDupField(field) {
  var id = fdFirstElementForField(field);
  if (id) { fdDupEl(id); return; }
  var isPhoto = !!PHOTO_MAP[field];
  var el = mkEl(isPhoto ? 'photo' : 'ld');
  if (isPhoto) el.photoField = field;
  else { el.field = field; el.label = FIELD_MAP[field] || field; }
  var last = formLayout[formLayout.length - 1];
  if (last) { el.x = Math.min(last.x + 2, 100 - el.w); el.y = Math.min(last.y + 2, 100 - el.h); }
  formLayout.push(el);
  fdSelect(el.id);
}
function fdRenderFieldsPanel() {
  var host = document.getElementById('adm-fd-fields-panel');
  if (!host) return;
  var usage = fdFieldUsage();
  function rowHtml(key, label) {
    var count = usage[key] || 0;
    var placed = count > 0;
    return '<div class="fd-field-row' + (placed ? ' fd-field-on' : '') + '">' +
      '<span class="fd-field-dot">' + (placed ? '✓' : '') + '</span>' +
      '<span class="fd-field-name" title="' + escH(label) + '">' + escH(label) + '</span>' +
      (placed ? '<span class="fd-field-count">×' + count + '</span>' : '') +
      '<button class="fd-field-dup" title="' + (placed ? 'Duplicate on canvas' : 'Add to canvas') + '" onclick="fdDupField(\'' + key + '\')">' + (placed ? '⧉' : '+') + '</button>' +
      '</div>';
  }
  var groupsHtml = FIELD_GROUPS.map(function(grp) {
    return '<div class="fd-field-group"><div class="fd-field-grouphdr">' + escH(grp.g) + '</div>' +
      grp.keys.map(function(k){ return rowHtml(k, FIELD_MAP[k] || k); }).join('') + '</div>';
  }).join('');
  var photosHtml = '<div class="fd-field-group"><div class="fd-field-grouphdr">Photos</div>' +
    Object.keys(PHOTO_MAP).map(function(k){ return rowHtml(k, PHOTO_MAP[k]); }).join('') + '</div>';
  host.innerHTML = groupsHtml + photosHtml;
}

/* ── Render canvas ────────────────────────────────── */
function fdRender() {
  var canvas = document.getElementById('adm-fd-canvas');
  if (!canvas) return;
  canvas.innerHTML = '';
  formLayout.forEach(function(el) {
    canvas.appendChild(mkDiv(el));
  });
  fdRenderFieldsPanel();
}

function mkDiv(el) {
  var div = document.createElement('div');
  div.dataset.eid = el.id;
  var isSel = el.id === fdSelectedId;
  div.className = 'fdc' + (isSel ? ' fdc-sel' : '');
  div.style.cssText = [
    'position:absolute',
    'left:' + px(el.x) + 'px',
    'top:' + py(el.y) + 'px',
    'width:' + px(el.w) + 'px',
    'height:' + py(el.h) + 'px',
    'box-sizing:border-box',
    'overflow:hidden',
    'cursor:move',
  ].join(';');
  div.innerHTML = elHTML(el, false);

  div.addEventListener('mousedown', function(e) {
    if (e.target.classList.contains('fdc-resize')) return;
    if (e.target.classList.contains('fdc-del')) return;
    if (e.target.classList.contains('fdc-dup')) return;
    e.stopPropagation();
    fdSelect(el.id);
    fdDrag = {id:el.id, sx:e.clientX, sy:e.clientY, ox:el.x, oy:el.y};
  });

  if (isSel) {
    // Resize handle
    var rh = document.createElement('div');
    rh.className = 'fdc-resize';
    rh.title = 'Drag to resize';
    rh.addEventListener('mousedown', function(e) {
      e.stopPropagation();
      fdResize = {id:el.id, sx:e.clientX, sy:e.clientY, ow:el.w, oh:el.h};
    });
    div.appendChild(rh);
    // Delete btn
    var db = document.createElement('button');
    db.className = 'fdc-del'; db.title = 'Delete'; db.innerHTML = '×';
    db.addEventListener('click', function(e) { e.stopPropagation(); fdDeleteEl(el.id); });
    div.appendChild(db);
    // Duplicate btn
    var dp = document.createElement('button');
    dp.className = 'fdc-dup'; dp.title = 'Duplicate'; dp.innerHTML = '⧉';
    dp.addEventListener('click', function(e) { e.stopPropagation(); fdDupEl(el.id); });
    div.appendChild(dp);
    // Move up/down buttons
    var mu = document.createElement('button');
    mu.className = 'fdc-ord'; mu.title = 'Bring forward'; mu.innerHTML = '↑';
    mu.addEventListener('click', function(e) { e.stopPropagation(); fdReorder(el.id, -1); });
    div.appendChild(mu);
    var md = document.createElement('button');
    md.className = 'fdc-ord'; md.style.right = '64px'; md.title = 'Send back'; md.innerHTML = '↓';
    md.addEventListener('click', function(e) { e.stopPropagation(); fdReorder(el.id, 1); });
    div.appendChild(md);
  }
  return div;
}

/* ── Template resolver (used in preview) ────────────── */
function resolveTemplate(tpl, app) {
  return (tpl || '').replace(/\{(\w+)\}/g, function(m, k) {
    return (app && app[k] != null) ? app[k] : m;
  });
}
function fv(app, field) {
  if (!field || field === '__static__') return '';
  // 'age' isn't a stored field on the application record — it's derived from
  // date_of_birth at render time (same as generateFormHtml's fmtAge(a.date_of_birth)
  // in admission-print-templates.js), so it needs its own lookup before the
  // generic app[field] path below (which would otherwise always miss).
  if (field === 'age') {
    var dob = app ? app.date_of_birth : null;
    return (dob && typeof fmtAge === 'function') ? fmtAge(dob) : '';
  }
  var v = app ? app[field] : null;
  if (v == null && app && app.extra_fields) v = app.extra_fields[field];
  if (v == null) return '[' + field + ']';
  if (field === 'date_of_birth' && typeof fmtDate === 'function') return fmtDate(v);
  return String(v);
}

/* ── Element preview HTML ─────────────────────────── */
function elHTML(el, forPrint, app) {
  var s = el.style || {};
  var demo = app || (typeof DEMO_APP !== 'undefined' ? DEMO_APP : {});

  var fnt = function(pfx) {
    // Style keys are camelCase (labelFontSize, labelColor, labelBold, labelItalic,
    // labelUnderline) — plain string concat (pfx+'color') only ever produced
    // 'labelcolor' etc. (lowercase c/b/i/u), which never matched the real key and
    // silently fell back to the base style every time. 'fontSize' happened to work
    // by accident since that literal is already capitalized. cap() fixes the rest
    // so a per-label color/bold/italic/underline override actually takes effect.
    var cap = function(suffix) { return pfx ? pfx + suffix.charAt(0).toUpperCase() + suffix.slice(1) : suffix; };
    var fs  = s[cap('fontSize')]  || s.fontSize || 10;
    var col = s[cap('color')]     || s.color    || '#111';
    var bld = s[cap('bold')]      || s.bold;
    var itl = s[cap('italic')]    || s.italic;
    var uln = s[cap('underline')] || s.underline;
    return 'font-size:'+fs+'pt;color:'+col+';font-weight:'+(bld?'bold':'normal')+';font-style:'+(itl?'italic':'normal')+';text-decoration:'+(uln?'underline':'none')+';';
  };
  var bdr = function(sides) {
    // s.borderWidth||1 would wrongly fall back to 1px whenever an element is
    // explicitly configured with NO border (borderWidth:0, e.g. a clean label:value
    // row or a frameless logo/photo) — 0 is falsy in JS, so that border could never
    // actually be turned off. Only fall back to the 1px default when the style has
    // no borderWidth set at all (e.g. an older saved layout).
    var w = (typeof s.borderWidth === 'number') ? s.borderWidth : 1;
    var c = s.borderColor  || '#ccc';
    var st = s.borderStyle || 'solid';
    var r = s.borderRadius || 0;
    return (sides ? sides.split(',').map(function(d){return 'border-'+d+':'+w+'px '+st+' '+c+';';}).join('') : 'border:'+w+'px '+st+' '+c+';') + 'border-radius:'+r+'px;';
  };
  var pad = 'padding:' + (s.padding||4) + 'px;';
  var bg  = (s.bg && s.bg !== 'transparent') ? 'background:'+s.bg+';' : '';

  /* ── 1. Label + Data ─── */
  if (el.type === 'ld') {
    var val = el.field === '__static__' ? (el.staticValue||'') : fv(demo, el.field);
    if (el.labelPos === 'top') {
      return '<div style="height:100%;' + bdr() + bg + 'box-sizing:border-box;">' +
        '<div style="' + pad + fnt('label') + bdr('bottom') + '">' + (el.label||'Label') + '</div>' +
        '<div style="' + pad + fnt() + 'overflow:hidden;">' + val + '</div>' +
        '</div>';
    }
    return '<div style="display:flex;height:100%;' + bdr() + bg + 'box-sizing:border-box;">' +
      '<div style="width:'+(el.labelWidth||38)+(el.labelWidthUnit||'%')+';' + pad + fnt('label') + bdr('right') + 'white-space:nowrap;overflow:hidden;">' + (el.label||'Label') + '</div>' +
      '<div style="flex:1;' + pad + fnt() + 'overflow:hidden;">' + val + '</div>' +
      '</div>';
  }

  /* ── 2. Table ─── */
  if (el.type === 'table') {
    var cols = el.columns || [];
    var rowCount = Math.max(1, el.rowCount || 1);
    var dataMode = el.dataMode || 'data'; // 'data'|'blank'|'academic'|'siblings'|'selected'
    var hdrCss = 'background:'+(s.hdrBg||'#1a2b5c')+';color:'+(s.hdrColor||'#fff')+
      ';font-size:'+(s.hdrFontSize||9)+'pt;font-weight:bold;' + pad +
      'border:' + (s.borderWidth||1) + 'px ' + (s.borderStyle||'solid') + ' ' + (s.borderColor||'#ccc') + ';';
    var cellCss = fnt() + pad + 'border:'+(s.borderWidth||1)+'px '+(s.borderStyle||'solid')+' '+(s.borderColor||'#ccc')+';vertical-align:top;';
    var labelCellCss = cellCss + 'width:40%;font-weight:bold;background:'+(s.hdrBg||'#1a2b5c')+'22;';
    var blankRow = '<tr>' + cols.map(function(){return '<td style="'+cellCss+'">&nbsp;</td>';}).join('') + '</tr>';
    var dataRows = '';
    var thead = '';

    if (dataMode === 'selected') {
      // Each selected field = one row: [label col | value col]
      var selF = el.selectedFields || [];
      var h1 = el.fieldColLabel1||''; var h2 = el.fieldColLabel2||'';
      if (h1||h2) thead = '<thead><tr><th style="'+hdrCss+'" width="40%">'+h1+'</th><th style="'+hdrCss+'">'+h2+'</th></tr></thead>';
      if (selF.length) {
        selF.forEach(function(sf){
          var val = fv(demo, sf.field);
          dataRows += '<tr><td style="'+labelCellCss+'">'+escH(sf.label||FIELD_MAP[sf.field]||sf.field)+'</td><td style="'+cellCss+'">'+val+'</td></tr>';
        });
      } else {
        dataRows = '<tr><td style="'+cellCss+'" colspan="2" align="center">No fields selected — pick fields in the panel</td></tr>';
      }
      return '<table style="width:100%;border-collapse:collapse;'+bg+'">'+thead+'<tbody>'+dataRows+'</tbody></table>';
    }

    thead = '<thead><tr>' + cols.map(function(c){return '<th style="'+hdrCss+'">'+( c.label||'')+'</th>';}).join('') + '</tr></thead>';

    if (dataMode === 'blank') {
      for (var bi=0; bi<rowCount; bi++) dataRows += blankRow;
    } else if (dataMode === 'academic') {
      var acadData = (app && app.academic_records) ? app.academic_records : (demo && demo.academic_records ? demo.academic_records : []);
      var acadCols = ['exam','year','board','roll','result'];
      for (var ai=0; ai<Math.max(rowCount, acadData.length); ai++) {
        var arow = acadData[ai] || {};
        dataRows += '<tr>' + cols.map(function(c,ci){
          var k = acadCols[ci] || acadCols[0];
          return '<td style="'+cellCss+'">'+(arow[k]||'')+'</td>';
        }).join('') + '</tr>';
      }
    } else if (dataMode === 'siblings') {
      var sibData = (app && app.siblings) ? app.siblings : (demo && demo.siblings ? demo.siblings : []);
      var sibCols = ['name','age','cls','institution'];
      for (var si=0; si<Math.max(rowCount, sibData.length); si++) {
        var srow = sibData[si] || {};
        dataRows += '<tr>' + cols.map(function(c,ci){
          var k = sibCols[ci] || sibCols[0];
          return '<td style="'+cellCss+'">'+(srow[k]||'')+'</td>';
        }).join('') + '</tr>';
      }
    } else {
      // 'data' mode: first row field-bound, extra rows blank
      var firstRow = '<tr>' + cols.map(function(c){
        var v = c.field === '__static__' ? (c.staticValue||'') : fv(demo, c.field);
        return '<td style="'+cellCss+'">'+v+'</td>';
      }).join('') + '</tr>';
      dataRows += firstRow;
      for (var di=1; di<rowCount; di++) dataRows += blankRow;
    }

    return '<table style="width:100%;border-collapse:collapse;' + bg + '">' +
      thead + '<tbody>' + dataRows + '</tbody>' +
      '</table>';
  }

  /* ── 3. Label Only ─── */
  if (el.type === 'lbl') {
    var val2 = el.field === '__static__' ? (el.staticValue||'Label') : fv(demo, el.field);
    return '<div style="height:100%;' + pad + bg + fnt() + 'text-align:'+(s.align||'left')+';line-height:'+(s.lineHeight||1.5)+';overflow:hidden;white-space:pre-wrap;">' + val2 + '</div>';
  }

  /* ── 4. Paragraph ─── */
  if (el.type === 'para') {
    var content = resolveTemplate(el.content || '', demo);
    return '<div style="height:100%;' + pad + bg + fnt() + 'text-align:'+(s.align||'left')+';line-height:'+(s.lineHeight||1.5)+';overflow:hidden;white-space:pre-wrap;">' + content + '</div>';
  }

  /* ── 5. Photo ─── */
  if (el.type === 'photo') {
    var photoSrc = (app && app[el.photoField]) || '';
    var photoEl = forPrint && photoSrc
      ? '<img src="'+photoSrc+'" style="flex:1;width:100%;object-fit:cover;'+bdr()+'">'
      : '<div style="flex:1;'+bdr()+'display:flex;align-items:center;justify-content:center;font-size:7pt;color:#bbb;background:#f9f9f9;">' + (PHOTO_MAP[el.photoField]||'Photo') + '</div>';
    var lbl5 = el.photoLabel && el.photoLabelPos !== 'none'
      ? '<div style="' + fnt('label') + 'text-align:center;margin:2px 0;">' + resolveTemplate(el.photoLabel||'', demo) + '</div>'
      : '';
    return '<div style="height:100%;display:flex;flex-direction:column;align-items:center;' + bg + '">' +
      (el.photoLabelPos==='top' ? lbl5 : '') + photoEl + (el.photoLabelPos==='bottom'||!el.photoLabelPos ? lbl5 : '') + '</div>';
  }

  /* ── 5b. Logo / Static Image ─── (a fixed image — e.g. the college crest —
     as opposed to 'photo', which is always bound to the application's own
     uploaded photo fields and can never show a fixed logo) */
  if (el.type === 'logo') {
    var logoSrc = el.logoUrl || DEFAULT_LOGO;
    return '<div style="height:100%;display:flex;align-items:center;justify-content:center;' + pad + bg + '">' +
      '<img src="'+logoSrc+'" style="max-width:100%;max-height:100%;object-fit:contain;'+bdr()+'" alt="Logo">' +
      '</div>';
  }

  /* ── 6. QR Code ─── */
  if (el.type === 'qr') {
    var qrText = resolveTemplate(el.qrContent || '{tracking_id}', demo);
    var qrLbl = resolveTemplate(el.qrLabel || '', demo);
    var lblHtml = qrLbl && el.qrLabelPos !== 'none'
      ? '<div style="' + fnt('label') + 'text-align:center;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + qrLbl + '</div>'
      : '';

    var qrEl;
    if (forPrint) {
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=H&data=' + encodeURIComponent(qrText);
      if (el.qrShowLogo) {
        var logoUrl = el.qrLogoUrl || DEFAULT_LOGO;
        qrEl = '<div style="position:relative;display:inline-block;flex:1;">' +
          '<img src="'+qrUrl+'" style="width:100%;height:auto;display:block;">' +
          '<img src="'+logoUrl+'" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:22%;height:22%;border-radius:3px;background:#fff;padding:1px;">' +
          '</div>';
      } else {
        qrEl = '<img src="'+qrUrl+'" style="flex:1;max-width:100%;object-fit:contain;">';
      }
    } else {
      // Editor preview
      qrEl = '<div style="flex:1;display:flex;align-items:center;justify-content:center;border:1px dashed #bbb;background:#f9fafb;font-size:7pt;color:#94a3b8;min-height:0;">' +
        '<div style="text-align:center;">' +
        '<div style="font-size:18pt;">▣</div>' +
        '<div>QR: ' + (qrText.length > 14 ? qrText.slice(0,14)+'…' : qrText) + '</div>' +
        (el.qrShowLogo ? '<div style="font-size:6pt;color:#6366f1">⊕ Logo</div>' : '') +
        '</div></div>';
    }

    return '<div style="height:100%;display:flex;flex-direction:column;align-items:center;' + bg + 'overflow:hidden;">' +
      (el.qrLabelPos==='top' ? lblHtml : '') + qrEl + (el.qrLabelPos==='bottom'||!el.qrLabelPos ? lblHtml : '') + '</div>';
  }

  return '<div style="padding:4px;font-size:8pt;color:#aaa;">[' + el.type + ']</div>';
}

/* ── Mouse handlers ───────────────────────────────── */
function fdMouseMove(e) {
  if (fdDrag) {
    var dx = (e.clientX - fdDrag.sx) / fdScale;
    var dy = (e.clientY - fdDrag.sy) / fdScale;
    var el = formLayout.find(function(x){return x.id===fdDrag.id;});
    if (!el) return;
    el.x = Math.max(0, Math.min(100 - el.w, fdDrag.ox + pcx(dx)));
    el.y = Math.max(0, Math.min(100 - el.h, fdDrag.oy + pcy(dy)));
    var div = document.querySelector('[data-eid="'+el.id+'"]');
    if (div) { div.style.left = px(el.x)+'px'; div.style.top = py(el.y)+'px'; }
    fdUpdatePosInPanel(el);
  }
  if (fdResize) {
    var dx2 = (e.clientX - fdResize.sx) / fdScale;
    var dy2 = (e.clientY - fdResize.sy) / fdScale;
    var el2 = formLayout.find(function(x){return x.id===fdResize.id;});
    if (!el2) return;
    el2.w = Math.max(4, Math.min(100 - el2.x, fdResize.ow + pcx(dx2)));
    el2.h = Math.max(2, Math.min(100 - el2.y, fdResize.oh + pcy(dy2)));
    var div2 = document.querySelector('[data-eid="'+el2.id+'"]');
    if (div2) { div2.style.width = px(el2.w)+'px'; div2.style.height = py(el2.h)+'px'; }
    fdUpdateSizeInPanel(el2);
  }
}
function fdMouseUp() {
  if (fdDrag)   { fdDrag = null;   fdRender(); }
  if (fdResize) { fdResize = null; fdRender(); }
}
function fdUpdatePosInPanel(el) {
  var xi = document.getElementById('pp-x'); if (xi) xi.value = +el.x.toFixed(1);
  var yi = document.getElementById('pp-y'); if (yi) yi.value = +el.y.toFixed(1);
}
function fdUpdateSizeInPanel(el) {
  var wi = document.getElementById('pp-w'); if (wi) wi.value = +el.w.toFixed(1);
  var hi = document.getElementById('pp-h'); if (hi) hi.value = +el.h.toFixed(1);
}

/* ── Select ───────────────────────────────────────── */
function fdSelect(id) {
  fdSelectedId = id;
  fdRender();
  fdRenderProps(id ? formLayout.find(function(e){return e.id===id;}) : null);
}

/* ── CRUD ─────────────────────────────────────────── */
function fdAddEl(type) {
  var el = mkEl(type);
  var last = formLayout[formLayout.length - 1];
  if (last) { el.x = Math.min(last.x + 2, 55); el.y = Math.min(last.y + 2, 90 - el.h); }
  formLayout.push(el);
  fdSelect(el.id);
}
function fdDeleteEl(id) {
  formLayout = formLayout.filter(function(e){return e.id!==id;});
  if (fdSelectedId === id) { fdSelectedId = null; fdRenderProps(null); }
  fdRender();
}
function fdDupEl(id) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el) return;
  var copy = JSON.parse(JSON.stringify(el));
  copy.id = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2,5);
  copy.x = Math.min(el.x + 3, 55); copy.y = Math.min(el.y + 3, 90);
  formLayout.push(copy);
  fdSelect(copy.id);
}
function fdReorder(id, dir) {
  var i = formLayout.findIndex(function(e){return e.id===id;});
  if (i < 0) return;
  var j = i + dir;
  if (j < 0 || j >= formLayout.length) return;
  var tmp = formLayout[i]; formLayout[i] = formLayout[j]; formLayout[j] = tmp;
  fdRender();
}

/* ── Zoom ─────────────────────────────────────────── */
function fdZoom(delta) {
  fdScale = Math.max(0.3, Math.min(2, fdScale + delta));
  var c = document.getElementById('adm-fd-canvas');
  if (c) { c.style.transform = 'scale('+fdScale+')'; c.style.transformOrigin = 'top center'; }
  var lbl = document.getElementById('adm-fd-zoom-lbl');
  if (lbl) lbl.textContent = Math.round(fdScale*100)+'%';
}
function fdZoomFit() {
  var wrap = document.getElementById('adm-fd-canvas-scroll');
  if (!wrap) return;
  var scale = Math.min(1, (wrap.clientWidth - 32) / CANVAS_W);
  fdScale = +(scale.toFixed(2));
  var c = document.getElementById('adm-fd-canvas');
  if (c) { c.style.transform = 'scale('+fdScale+')'; c.style.transformOrigin = 'top center'; }
  var lbl = document.getElementById('adm-fd-zoom-lbl');
  if (lbl) lbl.textContent = Math.round(fdScale*100)+'%';
}

/* ── Props panel ──────────────────────────────────── */
function fdRenderProps(el) {
  var panel = document.getElementById('adm-fd-props-panel');
  if (!panel) return;
  // Rebuilding innerHTML (below) destroys and recreates whatever input the user is
  // typing into, which steals focus on every keystroke since this fires from oninput.
  // Save the focused field's id + cursor position here and restore it at the end.
  var active = document.activeElement;
  var focusId = (active && panel.contains(active) && active.id) ? active.id : null;
  var selStart = (focusId && 'selectionStart' in active) ? active.selectionStart : null;
  var selEnd = (focusId && 'selectionStart' in active) ? active.selectionEnd : null;
  function restoreFocus() {
    if (!focusId) return;
    var restored = document.getElementById(focusId);
    if (!restored) return;
    restored.focus();
    if (selStart !== null && 'setSelectionRange' in restored) {
      try { restored.setSelectionRange(selStart, selEnd); } catch (e) {}
    }
  }
  if (!el) {
    panel.innerHTML = '<div style="text-align:center;padding:32px 0;color:#94a3b8;font-size:11px;">Click an element<br>to edit properties</div>';
    return;
  }
  var s = el.style || {};
  var id = el.id;

  function inp(label, key, val, type, extra) {
    type = type || 'text';
    var step = type==='number'&&(key==='lineHeight'||key.indexOf('opacity')>=0) ? ' step="0.1"' : '';
    return '<div class="pp-row"><label class="pp-lbl">'+label+'</label>' +
      '<input type="'+type+'" class="pp-inp" id="pp-'+key.replace(/[^a-z0-9]/gi,'-')+'" value="'+escH(String(val||''))+'" '+
      (extra||'')+(step)+' oninput="fdUpd(\''+id+'\',\''+key+'\',this)" onchange="fdUpd(\''+id+'\',\''+key+'\',this)"></div>';
  }
  function colorInp(label, key, val) {
    return '<div class="pp-row"><label class="pp-lbl">'+label+'</label>' +
      '<input type="color" class="pp-color" value="'+(val||'#000000')+'" onchange="fdUpdStyle(\''+id+'\',\''+key+'\',this.value)"></div>';
  }
  function sel(label, key, val, opts) {
    var os = opts.map(function(o){
      var v=Array.isArray(o)?o[0]:o, l=Array.isArray(o)?o[1]:o;
      return '<option value="'+v+'"'+(v===val?' selected':'')+'>'+l+'</option>';
    }).join('');
    return '<div class="pp-row"><label class="pp-lbl">'+label+'</label><select class="pp-inp" onchange="fdUpd(\''+id+'\',\''+key+'\',this)">'+os+'</select></div>';
  }
  function chk(label, key, val) {
    return '<label class="pp-chk"><input type="checkbox"'+(val?' checked':'')+ ' onchange="fdUpd(\''+id+'\',\''+key+'\',this)"> '+label+'</label>';
  }
  function fieldSel(label, key, val) {
    var opts = Object.entries(FIELD_MAP).map(function(e){return [e[0],e[1]];});
    return sel(label, key, val||'name_english', opts);
  }
  function section(title) { return '<div class="pp-sec">'+title+'</div>'; }
  function fontBlock(prefix, label) {
    var p = prefix || '';
    return section(label || 'Text Style') +
      '<div class="pp-grid2">' +
      inp('Size (pt)', p+'fontSize', s[p+'fontSize']||s.fontSize||10, 'number', 'min="5" max="72"') +
      colorInp('Color', p+'color', s[p+'color']||s.color||'#111111') +
      '</div>' +
      '<div class="pp-chkrow">' +
      chk('Bold',      p+'bold',      s[p+'bold']||s.bold) +
      chk('Italic',    p+'italic',    s[p+'italic']||s.italic) +
      chk('Underline', p+'underline', s[p+'underline']||s.underline) +
      '</div>';
  }
  function borderBlock() {
    return section('Border') +
      '<div class="pp-grid2">' +
      colorInp('Color', 'borderColor', s.borderColor||'#cccccc') +
      inp('Width (px)', 'borderWidth', s.borderWidth||1, 'number', 'min="0" max="10"') +
      '</div>' +
      '<div class="pp-grid2">' +
      sel('Style', 'borderStyle', s.borderStyle||'solid',
        ['solid','dashed','dotted','double','none'].map(function(v){return [v,v];})) +
      inp('Radius', 'borderRadius', s.borderRadius||0, 'number', 'min="0" max="50"') +
      '</div>';
  }
  function layoutBlock() {
    return section('Position & Size') +
      '<div class="pp-grid4">' +
      '<div>'+inp('X %','x',+el.x.toFixed(1),'number','id="pp-x" min="0" max="99"')+'</div>' +
      '<div>'+inp('Y %','y',+el.y.toFixed(1),'number','id="pp-y" min="0" max="99"')+'</div>' +
      '<div>'+inp('W %','w',+el.w.toFixed(1),'number','id="pp-w" min="2" max="100"')+'</div>' +
      '<div>'+inp('H %','h',+el.h.toFixed(1),'number','id="pp-h" min="1" max="100"')+'</div>' +
      '</div>' +
      '<div class="pp-grid2">' +
      inp('Padding', 'padding', s.padding||4, 'number', 'min="0" max="30"') +
      colorInp('Background', 'bg', s.bg||'#ffffff') +
      '</div>';
  }

  var inner = '';
  var typeLabel = {ld:'Label + Data',table:'Table',lbl:'Label Only',para:'Paragraph',photo:'Photo',logo:'Logo / Image',qr:'QR Code'}[el.type]||el.type;

  /* LD */
  if (el.type === 'ld') {
    inner = section('Content') +
      inp('Label Text', 'label', el.label||'', 'text') +
      fieldSel('Data Field', 'field', el.field) +
      (el.field==='__static__' ? inp('Static Value','staticValue',el.staticValue||'') : '') +
      section('Layout') +
      sel('Label Position','labelPos',el.labelPos||'left',[['left','Label Left'],['top','Label Top']]) +
      ((!el.labelPos||el.labelPos==='left') ?
        '<div class="pp-row"><label class="pp-lbl">Label Width</label><div style="display:flex;gap:4px;flex:1">' +
        '<input type="number" class="pp-inp" style="flex:1;min-width:0" value="'+escH(String(el.labelWidth||38))+'" min="10" max="600" oninput="fdUpd(\''+id+'\',\'labelWidth\',this)" onchange="fdUpd(\''+id+'\',\'labelWidth\',this)">' +
        '<select class="pp-inp" style="width:56px;flex:none" onchange="fdUpd(\''+id+'\',\'labelWidthUnit\',this)">' +
          '<option value="%"'+((el.labelWidthUnit||'%')==='%'?' selected':'')+'>%</option>' +
          '<option value="px"'+(el.labelWidthUnit==='px'?' selected':'')+'>px</option>' +
        '</select></div></div>'
        : '') +
      fontBlock('label', 'Label Style') +
      fontBlock('', 'Data Style') +
      borderBlock() + layoutBlock();
  }

  /* TABLE */
  if (el.type === 'table') {
    var colsHtml = (el.columns||[]).map(function(c,i){
      return '<div class="pp-col-card">' +
        '<div class="pp-col-hdr"><span>Col '+(i+1)+'</span>' +
        '<button onclick="fdRmCol(\''+id+'\','+i+')" class="pp-col-del">×</button></div>' +
        '<input type="text" class="pp-inp" placeholder="Header" value="'+escH(c.label||'')+'" oninput="fdColUpd(\''+id+'\','+i+',\'label\',this.value)">' +
        '<select class="pp-inp" onchange="fdColUpd(\''+id+'\','+i+',\'field\',this.value)">' +
          Object.entries(FIELD_MAP).map(function(e){return '<option value="'+e[0]+'"'+(e[0]===c.field?' selected':'')+'>'+e[1]+'</option>';}).join('') +
        '</select>' +
        (c.field==='__static__' ? '<input type="text" class="pp-inp" placeholder="Static value" value="'+escH(c.staticValue||'')+'" oninput="fdColUpd(\''+id+'\','+i+',\'staticValue\',this.value)">' : '') +
        '</div>';
    }).join('');
    inner = section('Rows & Data') +
      '<div class="pp-grid2">' +
      inp('Row Count', 'rowCount', el.rowCount||1, 'number', 'min="1" max="30"') +
      sel('Data Mode', 'dataMode', el.dataMode||'data', [
        ['data',     'Field Values (1st row)'],
        ['blank',    'All Blank (hand-fill)'],
        ['selected', 'Selected Fields (vertical)'],
        ['academic', 'Academic Records'],
        ['siblings', 'Siblings Data'],
      ]) +
      '</div>' +

      // ── SELECTED FIELDS mode ──────────────────────────────────
      (el.dataMode==='selected' ? (function(){
        var selF = el.selectedFields || [];
        var selSet = {};
        selF.forEach(function(sf){selSet[sf.field]=true;});

        // Current ordered list
        var selRows = selF.length ? selF.map(function(sf,i){
          return '<div class="pp-selrow" style="display:flex;align-items:center;gap:3px;margin-bottom:3px">'+
            '<span style="font-size:9px;color:#94a3b8;min-width:14px;text-align:right">'+(i+1)+'.</span>'+
            '<input class="pp-inp" style="flex:1" value="'+escH(sf.label||FIELD_MAP[sf.field]||sf.field)+'" title="Row label" oninput="fdUpdSelLabel(\''+id+'\','+i+',this.value)">'+
            '<span style="font-size:9px;color:#64748b;white-space:nowrap;max-width:60px;overflow:hidden;text-overflow:ellipsis" title="'+escH(FIELD_MAP[sf.field]||sf.field)+'">'+escH((FIELD_MAP[sf.field]||sf.field).slice(0,12))+'</span>'+
            '<button class="fdc-ord" style="position:static;width:20px;height:20px;background:#94a3b8;border-radius:3px;font-size:10px" onclick="fdMoveSelField(\''+id+'\','+i+',-1)" '+(i===0?'disabled':'')+'>&uarr;</button>'+
            '<button class="fdc-ord" style="position:static;width:20px;height:20px;background:#94a3b8;border-radius:3px;font-size:10px" onclick="fdMoveSelField(\''+id+'\','+i+',1)" '+(i===selF.length-1?'disabled':'')+'>&darr;</button>'+
            '<button class="pp-col-del" onclick="fdToggleSelField(\''+id+'\',\''+sf.field+'\',\'\')">×</button>'+
            '</div>';
        }).join('') : '<div class="pp-note" style="padding:4px 0">No fields selected yet — pick from list below</div>';

        // Column header inputs
        var hdrInputs = '<div class="pp-grid2">'+
          '<div class="pp-row"><label class="pp-lbl">Left header</label><input class="pp-inp" value="'+escH(el.fieldColLabel1||'')+'" placeholder="Particulars" oninput="fdPropUpd(\''+id+'\',\'fieldColLabel1\',this.value)"></div>'+
          '<div class="pp-row"><label class="pp-lbl">Right header</label><input class="pp-inp" value="'+escH(el.fieldColLabel2||'')+'" placeholder="Details" oninput="fdPropUpd(\''+id+'\',\'fieldColLabel2\',this.value)"></div>'+
          '</div>';

        // Grouped checklist
        var checklist = FIELD_GROUPS.map(function(grp){
          var items = grp.keys.map(function(k){
            var checked = !!selSet[k];
            return '<label class="pp-selfld-item '+(checked?'pp-selfld-on':'')+'" onclick="fdToggleSelField(\''+id+'\',\''+k+'\',\''+escH(FIELD_MAP[k]||k)+'\')">'+(checked?'✓ ':'')+escH(FIELD_MAP[k]||k)+'</label>';
          }).join('');
          return '<div class="pp-fgrp"><div class="pp-fgrp-hdr">'+grp.g+'</div><div class="pp-fgrp-body">'+items+'</div></div>';
        }).join('');

        return section('Column Headers')+hdrInputs+
          section('Row Order ('+selF.length+' rows)')+selRows+
          section('Add / Remove Fields')+checklist;
      })() : (
        // Non-selected modes: show note + column editor
        '<div class="pp-note">'+
          ((!el.dataMode||el.dataMode==='data') ? 'Row 1 = bound fields. Extra rows print blank.' :
           el.dataMode==='blank'                ? 'All rows print blank — for manual handwriting.' :
           el.dataMode==='academic'             ? 'Pulls from Academic Records table in the form.' :
           'Pulls from Siblings table in the form.') +
        '</div>' +
        section('Columns') +
        colsHtml +
        '<button class="pp-add-col" onclick="fdAddCol(\''+id+'\')">+ Add Column</button>'
      )) +

      section('Header Style') +
      '<div class="pp-grid2">' +
      colorInp('Header BG','hdrBg',s.hdrBg||'#1a2b5c') +
      colorInp('Header Text','hdrColor',s.hdrColor||'#ffffff') +
      inp('Header Size','hdrFontSize',s.hdrFontSize||9,'number','min="5" max="24"') +
      '</div>' +
      fontBlock('', 'Cell Style') +
      borderBlock() + layoutBlock();
  }

  /* LABEL ONLY */
  if (el.type === 'lbl') {
    inner = section('Content') +
      fieldSel('Source Field', 'field', el.field) +
      (el.field==='__static__' ? '<div class="pp-row"><label class="pp-lbl">Static Text</label><textarea class="pp-inp" rows="2" oninput="fdUpd(\''+id+'\',\'staticValue\',this)">'+escH(el.staticValue||'')+'</textarea></div>' : '') +
      sel('Align','align',s.align||'left',[['left','Left'],['center','Center'],['right','Right']]) +
      inp('Line Height','lineHeight',s.lineHeight||1.5,'number','min="1" max="3" step="0.1"') +
      fontBlock('', 'Style') + borderBlock() + layoutBlock();
  }

  /* PARAGRAPH */
  if (el.type === 'para') {
    inner = section('Content') +
      '<div class="pp-note">Use {field_name} for dynamic data, e.g. {tracking_id} {name_english}</div>' +
      '<div class="pp-row"><label class="pp-lbl">Text</label><textarea class="pp-inp" rows="4" oninput="fdUpd(\''+id+'\',\'content\',this)">'+escH(el.content||'')+'</textarea></div>' +
      sel('Align','align',s.align||'left',[['left','Left'],['center','Center'],['right','Right'],['justify','Justify']]) +
      inp('Line Height','lineHeight',s.lineHeight||1.5,'number','min="1" max="3" step="0.1"') +
      fontBlock('', 'Style') + borderBlock() + layoutBlock();
  }

  /* PHOTO */
  if (el.type === 'photo') {
    var pOpts = Object.entries(PHOTO_MAP).map(function(e){return [e[0],e[1]];});
    inner = section('Photo') +
      sel('Photo Field','photoField',el.photoField||'student_photo', pOpts) +
      section('Label') +
      '<div class="pp-note">Supports {field_name} tokens, e.g. {name_english}</div>' +
      inp('Label Text','photoLabel',el.photoLabel||'') +
      sel('Label Position','photoLabelPos',el.photoLabelPos||'bottom',[['top','Above'],['bottom','Below'],['none','None']]) +
      fontBlock('label','Label Style') +
      borderBlock() + layoutBlock();
  }

  /* LOGO / IMAGE */
  if (el.type === 'logo') {
    inner = section('Image') +
      inp('Image URL','logoUrl',el.logoUrl||DEFAULT_LOGO,'text') +
      '<div class="pp-note">Defaults to the college logo. Paste any other image URL to use a different crest/mark here instead.</div>' +
      borderBlock() + layoutBlock();
  }

  /* QR CODE */
  if (el.type === 'qr') {
    inner = section('QR Content') +
      '<div class="pp-note">Use {field_name} tokens + static text. e.g. CCPC/{tracking_id}</div>' +
      inp('QR Data Template','qrContent',el.qrContent||'{tracking_id}') +
      section('Label') +
      '<div class="pp-note">Supports {field_name} tokens, e.g. {name_english}</div>' +
      inp('Label Template','qrLabel',el.qrLabel||'') +
      sel('Label Position','qrLabelPos',el.qrLabelPos||'bottom',[['top','Above QR'],['bottom','Below QR'],['none','None']]) +
      fontBlock('label','Label Style') +
      section('Logo at Centre') +
      chk('Show logo inside QR (uses H error correction)','qrShowLogo',el.qrShowLogo) +
      (el.qrShowLogo ? inp('Logo URL','qrLogoUrl',el.qrLogoUrl||DEFAULT_LOGO) : '') +
      borderBlock() + layoutBlock();
  }

  panel.innerHTML =
    '<div class="pp-header"><span class="pp-type-lbl">'+typeLabel+'</span>' +
    '<button onclick="fdDeleteEl(\''+id+'\')" class="pp-del-btn">Delete</button></div>' +
    inner;
  restoreFocus();
}

function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── Update from props panel ──────────────────────── */
function fdUpd(id, key, input) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el) return;
  var val = (input.type==='checkbox') ? input.checked : input.value;
  if (input.type==='number') val = parseFloat(val)||0;
  // top-level keys: x, y, w, h, label, field, staticValue, labelPos, labelWidth,
  //                 content, photoField, photoLabel, photoLabelPos, qrContent, qrLabel, qrLabelPos, qrShowLogo, qrLogoUrl
  if (['x','y','w','h'].indexOf(key) >= 0) {
    el[key] = Math.max(0, val);
    var div = document.querySelector('[data-eid="'+id+'"]');
    if (div) {
      div.style.left = px(el.x)+'px'; div.style.top = py(el.y)+'px';
      div.style.width = px(el.w)+'px'; div.style.height = py(el.h)+'px';
    }
  } else if (key in el.style) {
    el.style[key] = val;
  } else {
    el[key] = val;
  }
  // Re-render the element content in-place
  var div2 = document.querySelector('[data-eid="'+id+'"]');
  if (div2) div2.innerHTML = mkDiv(el).innerHTML;
  // Re-render full (to refresh handles + props for conditional sections)
  fdRender();
  fdRenderProps(el);
}
function fdUpdStyle(id, key, val) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el) return;
  el.style = el.style || {};
  el.style[key] = val;
  fdRender();
}
function fdColUpd(id, idx, key, val) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el || !el.columns) return;
  el.columns[idx][key] = val;
  fdRender();
  fdRenderProps(el);
}
function fdAddCol(id) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el) return;
  (el.columns = el.columns||[]).push({label:'Column',field:'name_english'});
  fdRender(); fdRenderProps(el);
}
function fdRmCol(id, idx) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el||!el.columns) return;
  el.columns.splice(idx,1);
  fdRender(); fdRenderProps(el);
}

// Generic top-level property setter — the reference app's props panel wires
// the "selected fields" table's two header inputs to a fdPropUpd(id,key,val)
// call that it never actually defines anywhere (a dead reference there, so
// those two inputs silently no-op in the original admin panel). Defined here
// so they work, mirroring exactly what fdUpd() does for a plain string prop.
function fdPropUpd(id, key, val) {
  var el = formLayout.find(function(e){return e.id===id;});
  if (!el) return;
  el[key] = val;
  fdRender();
}

/* ── Selected-fields helpers ─────────────────────── */
function fdToggleSelField(id, field, defaultLabel) {
  var el = formLayout.find(function(e){return e.id===id;}); if(!el) return;
  if(!el.selectedFields) el.selectedFields=[];
  var idx = el.selectedFields.findIndex(function(f){return f.field===field;});
  if (idx >= 0) { el.selectedFields.splice(idx,1); }
  else { el.selectedFields.push({field:field, label:defaultLabel||FIELD_MAP[field]||field}); }
  fdRender(); fdRenderProps(el);
}
function fdMoveSelField(id, idx, dir) {
  var el = formLayout.find(function(e){return e.id===id;}); if(!el||!el.selectedFields) return;
  var arr=el.selectedFields, ni=idx+dir;
  if(ni<0||ni>=arr.length) return;
  var tmp=arr[idx]; arr[idx]=arr[ni]; arr[ni]=tmp;
  fdRender(); fdRenderProps(el);
}
function fdUpdSelLabel(id, idx, val) {
  var el = formLayout.find(function(e){return e.id===id;}); if(!el||!el.selectedFields) return;
  el.selectedFields[idx].label=val; fdRender();
}

/* ── Clear canvas ─────────────────────────────────── */
function fdClearCanvas() {
  showConfirm('Clear all elements from the canvas?', function() {
    formLayout = []; fdSelectedId = null; fdRender(); fdRenderProps(null);
  });
}
function fdLoadOfficialTemplate() {
  function doLoad() {
    formLayout = JSON.parse(JSON.stringify(DEFAULT_FORM_LAYOUT));
    // Unsaved until the user clicks Save — keep Print falling back to the
    // structured generateFormHtml (see _admEnsureFormLayoutForPrint) until then.
    window._admFormLayoutAutoSeeded = true;
    fdSelectedId = null;
    fdRender(); fdRenderProps(null); fdZoomFit();
    if (typeof showToast === 'function') showToast('Official template loaded — click Save to keep it', 'info');
  }
  if (formLayout && formLayout.length) {
    showConfirm('Replace the current canvas with the official template?', doLoad);
  } else {
    doLoad();
  }
}
function previewFormLayout() {
  openPrintTab(generateFormFromLayout(typeof DEMO_APP!=='undefined'?DEMO_APP:{}, formLayout));
}

/* ── Print HTML generator ─────────────────────────── */
function generateFormFromLayout(app, layout) {
  if (!layout || !layout.length) {
    if (typeof generateFormHtml==='function') {
      return generateFormHtml(app, typeof currentFormSettings!=='undefined'&&currentFormSettings ? currentFormSettings : DEFAULT_FORM);
    }
    return '<html><body style="font-family:Arial;padding:20mm;color:#555"><h2>No form layout defined.</h2><p>Go to Admin → Form Designer and add elements.</p></body></html>';
  }
  var divs = layout.map(function(el) {
    var xMm = +(el.x * 210 / 100).toFixed(2);
    var yMm = +(el.y * 297 / 100).toFixed(2);
    var wMm = +(el.w * 210 / 100).toFixed(2);
    var hMm = +(el.h * 297 / 100).toFixed(2);
    return '<div style="position:absolute;left:'+xMm+'mm;top:'+yMm+'mm;width:'+wMm+'mm;height:'+hMm+'mm;box-sizing:border-box;overflow:hidden;">' +
      elHTML(el, true, app) + '</div>';
  });
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Form</title><style>' +
    '*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;}' +
    '@page{size:A4 portrait;margin:0;}.page{position:relative;width:210mm;height:297mm;overflow:hidden;}' +
    '@media screen{body{background:#888;}.page{margin:10mm auto;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.3);}}' +
    '</style></head><body><div class="page">' + divs.join('') + '</div>' +
    '<script>window.onload=function(){window.print();}<\/script></body></html>';
}

/* ═══════════════════════════════════════════════════════
   CCPC Admission — Visual Form Canvas Designer
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
  father_contact:       'Father Contact',
  father_nid:           'Father NID',
  father_office_address:'Father Office',
  father_yearly_income: 'Father Income',
  mother_name:          'Mother Name',
  mother_profession:    'Mother Profession',
  mother_designation:   'Mother Designation',
  mother_contact:       'Mother Contact',
  mother_nid:           'Mother NID',
  mother_office_address:'Mother Office',
  mother_yearly_income: 'Mother Income',
  guardian_name:        'Guardian Name',
  guardian_contact:     'Guardian Contact',
  guardian_relation:    'Guardian Relation',
  guardian_office_address:'Guardian Office',
};
var PHOTO_MAP = {
  student_photo:  'Student Photo',
  father_photo:   'Father Photo',
  mother_photo:   'Mother Photo',
  guardian_photo: 'Guardian Photo',
};
var DEFAULT_LOGO = 'https://lh3.googleusercontent.com/d/1Gb6gpcw1moYPAh9hSZ7cEQ5vgXxHj8LB';
var CANVAS_W = 794, CANVAS_H = 1123;

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
    case 'ld':   return Object.assign(base, {label:'Label', field:'name_english', staticValue:'', labelPos:'left', labelWidth:38});
    case 'table':return Object.assign(base, {h:14, columns:[{label:'Field 1',field:'name_english'},{label:'Field 2',field:'class'}]});
    case 'lbl':  return Object.assign(base, {h:5, field:'name_english', staticValue:''});
    case 'para': return Object.assign(base, {h:18, content:'Type text here.\nUse {tracking_id} to insert field values.'});
    case 'photo':return Object.assign(base, {w:15, h:20, photoField:'student_photo'});
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
  var canvas = document.getElementById('form-canvas');
  if (!canvas) return;
  document.addEventListener('mousemove', fdMouseMove);
  document.addEventListener('mouseup', fdMouseUp);
  canvas.addEventListener('mousedown', function(e) {
    if (e.target === canvas) { fdSelect(null); }
  });
  fdRender();
}

/* ── Render canvas ────────────────────────────────── */
function fdRender() {
  var canvas = document.getElementById('form-canvas');
  if (!canvas) return;
  canvas.innerHTML = '';
  formLayout.forEach(function(el) {
    canvas.appendChild(mkDiv(el));
  });
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
  var v = app ? app[field] : null;
  if (v == null) return '[' + field + ']';
  if (field === 'date_of_birth' && typeof fmtDate === 'function') return fmtDate(v);
  return String(v);
}

/* ── Element preview HTML ─────────────────────────── */
function elHTML(el, forPrint, app) {
  var s = el.style || {};
  var demo = app || (typeof DEMO_APP !== 'undefined' ? DEMO_APP : {});

  var fnt = function(pfx) {
    var fs  = s[(pfx||'')+'fontSize'] || s.fontSize || 10;
    var col = s[(pfx||'')+'color']    || s.color    || '#111';
    var bld = s[(pfx||'')+'bold']     || s.bold;
    var itl = s[(pfx||'')+'italic']   || s.italic;
    var uln = s[(pfx||'')+'underline']|| s.underline;
    return 'font-size:'+fs+'pt;color:'+col+';font-weight:'+(bld?'bold':'normal')+';font-style:'+(itl?'italic':'normal')+';text-decoration:'+(uln?'underline':'none')+';';
  };
  var bdr = function(sides) {
    var w = s.borderWidth || 1;
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
      '<div style="width:'+(el.labelWidth||38)+'%;' + pad + fnt('label') + bdr('right') + 'white-space:nowrap;overflow:hidden;">' + (el.label||'Label') + '</div>' +
      '<div style="flex:1;' + pad + fnt() + 'overflow:hidden;">' + val + '</div>' +
      '</div>';
  }

  /* ── 2. Table ─── */
  if (el.type === 'table') {
    var cols = el.columns || [];
    var hdrCss = 'background:'+(s.hdrBg||'#1a2b5c')+';color:'+(s.hdrColor||'#fff')+
      ';font-size:'+(s.hdrFontSize||9)+'pt;font-weight:bold;' + pad +
      'border:' + (s.borderWidth||1) + 'px ' + (s.borderStyle||'solid') + ' ' + (s.borderColor||'#ccc') + ';';
    var cellCss = fnt() + pad + 'border:'+(s.borderWidth||1)+'px '+(s.borderStyle||'solid')+' '+(s.borderColor||'#ccc')+';vertical-align:top;';
    return '<table style="width:100%;border-collapse:collapse;' + bg + '">' +
      '<thead><tr>' + cols.map(function(c){return '<th style="'+hdrCss+'">'+( c.label||'')+'</th>';}).join('') + '</tr></thead>' +
      '<tbody><tr>' + cols.map(function(c){
        var v = c.field === '__static__' ? (c.staticValue||'') : fv(demo, c.field);
        return '<td style="'+cellCss+'">'+v+'</td>';
      }).join('') + '</tr></tbody>' +
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
  var c = document.getElementById('form-canvas');
  if (c) { c.style.transform = 'scale('+fdScale+')'; c.style.transformOrigin = 'top center'; }
  var lbl = document.getElementById('fd-zoom-lbl');
  if (lbl) lbl.textContent = Math.round(fdScale*100)+'%';
}
function fdZoomFit() {
  var wrap = document.getElementById('canvas-scroll');
  if (!wrap) return;
  var scale = Math.min(1, (wrap.clientWidth - 32) / CANVAS_W);
  fdScale = +(scale.toFixed(2));
  var c = document.getElementById('form-canvas');
  if (c) { c.style.transform = 'scale('+fdScale+')'; c.style.transformOrigin = 'top center'; }
  var lbl = document.getElementById('fd-zoom-lbl');
  if (lbl) lbl.textContent = Math.round(fdScale*100)+'%';
}

/* ── Props panel ──────────────────────────────────── */
function fdRenderProps(el) {
  var panel = document.getElementById('props-panel');
  if (!panel) return;
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
  var typeLabel = {ld:'Label + Data',table:'Table',lbl:'Label Only',para:'Paragraph',photo:'Photo',qr:'QR Code'}[el.type]||el.type;

  /* LD */
  if (el.type === 'ld') {
    inner = section('Content') +
      inp('Label Text', 'label', el.label||'', 'text') +
      fieldSel('Data Field', 'field', el.field) +
      (el.field==='__static__' ? inp('Static Value','staticValue',el.staticValue||'') : '') +
      section('Layout') +
      sel('Label Position','labelPos',el.labelPos||'left',[['left','Label Left'],['top','Label Top']]) +
      ((!el.labelPos||el.labelPos==='left') ? inp('Label Width %','labelWidth',el.labelWidth||38,'number','min="10" max="80"') : '') +
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
    inner = section('Columns') +
      colsHtml +
      '<button class="pp-add-col" onclick="fdAddCol(\''+id+'\')">+ Add Column</button>' +
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

/* ── Template state ───────────────────────────────── */
var formTemplates = [];      // [{id, name, elements, createdAt, updatedAt}]
var activeTplId   = null;

function getActiveTpl() {
  return formTemplates.find(function(t){return t.id===activeTplId;}) || null;
}
function cloneLayout() { return JSON.parse(JSON.stringify(formLayout)); }

/* ── Persist all templates ────────────────────────── */
async function saveTplsDB() {
  return api('saveSettings', {key:'form_templates', value:{templates:formTemplates, activeId:activeTplId}});
}

/* ── Load from DB ─────────────────────────────────── */
async function loadFormTemplates() {
  var r = await api('getSettings', {});
  var s = r.settings || {};
  var data = s.form_templates || {};
  formTemplates = data.templates || [];
  activeTplId   = data.activeId  || null;

  // Migrate legacy form_layout if templates list is empty
  if (!formTemplates.length && s.form_layout && s.form_layout.elements && s.form_layout.elements.length) {
    var legacy = {id:'tpl_legacy_'+Date.now(), name:'Default Form', elements:s.form_layout.elements, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
    formTemplates.push(legacy); activeTplId = legacy.id;
    saveTplsDB();
  }

  var tpl = getActiveTpl() || (formTemplates.length ? formTemplates[0] : null);
  if (tpl) { activeTplId = tpl.id; formLayout = JSON.parse(JSON.stringify(tpl.elements||[])); }
  else      { activeTplId = null;  formLayout = []; }

  initCanvas(); renderTplBar(); setTimeout(fdZoomFit, 100);
}

/* Alias kept for backward compat (called from showAdminTab) */
var loadFormLayout = loadFormTemplates;

/* ── Template bar UI ──────────────────────────────── */
function renderTplBar() {
  var bar = document.getElementById('fd-tpl-bar');
  if (!bar) return;
  var opts = formTemplates.map(function(t) {
    return '<option value="'+t.id+'"'+(t.id===activeTplId?' selected':'')+'>'+escH(t.name)+'</option>';
  }).join('');
  var count = formTemplates.length;
  bar.innerHTML =
    '<span class="flbl" style="white-space:nowrap;align-self:center">Templates ('+ count +'):</span>' +
    (count
      ? '<select id="tpl-sel" class="finput finput-sm" style="max-width:200px;flex:1" onchange="fdSwitchTpl(this.value)">'+opts+'</select>' +
        '<button class="fd-tool text-emerald-700 font-black" onclick="fdSaveTpl()" title="Overwrite current template with canvas">Save</button>' +
        '<button class="fd-tool text-blue-600" onclick="fdSaveAsTpl()" title="Save canvas as a new template">Save As…</button>' +
        '<button class="fd-tool" onclick="fdRenameTpl()" title="Rename current template">Rename</button>' +
        '<button class="fd-tool text-red-400" onclick="fdDeleteTpl()" title="Delete current template">Delete</button>'
      : '<span style="font-size:11px;color:#94a3b8;align-self:center">No templates yet</span>') +
    '<button class="fd-tool" onclick="fdNewTpl()" title="Start a blank new template">+ New</button>';
}

/* ── Switch to a different template ───────────────── */
function fdSwitchTpl(id) {
  if (id === activeTplId) return;
  activeTplId = id;
  var tpl = getActiveTpl();
  formLayout = tpl ? JSON.parse(JSON.stringify(tpl.elements||[])) : [];
  fdSelectedId = null; fdRender(); fdRenderProps(null); renderTplBar();
}

/* ── Save (overwrite) ─────────────────────────────── */
async function fdSaveTpl() {
  if (!activeTplId) { await fdSaveAsTpl(); return; }
  var tpl = getActiveTpl();
  if (!tpl) { await fdSaveAsTpl(); return; }
  tpl.elements  = cloneLayout();
  tpl.updatedAt = new Date().toISOString();
  setLoading(true); var r = await saveTplsDB(); setLoading(false);
  if (r.error) { toast(r.error,'error'); return; }
  toast('"' + tpl.name + '" saved', 'success');
}
/* Alias for toolbar Save button */
var saveFormLayout = fdSaveTpl;

/* ── Save As (new template) ───────────────────────── */
async function fdSaveAsTpl() {
  var name = prompt('Template name:', 'Form ' + (formTemplates.length + 1));
  if (!name || !name.trim()) return;
  var id = 'tpl_' + Date.now();
  formTemplates.push({id, name:name.trim(), elements:cloneLayout(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()});
  activeTplId = id;
  setLoading(true); var r = await saveTplsDB(); setLoading(false);
  if (r.error) { toast(r.error,'error'); return; }
  toast('"'+name.trim()+'" created','success'); renderTplBar();
}

/* ── Rename ───────────────────────────────────────── */
async function fdRenameTpl() {
  var tpl = getActiveTpl();
  if (!tpl) { toast('No active template','warn'); return; }
  var name = prompt('New name:', tpl.name);
  if (!name || !name.trim() || name.trim()===tpl.name) return;
  tpl.name = name.trim();
  setLoading(true); var r = await saveTplsDB(); setLoading(false);
  if (r.error) { toast(r.error,'error'); return; }
  toast('Renamed to "'+tpl.name+'"','success'); renderTplBar();
}

/* ── Delete ───────────────────────────────────────── */
async function fdDeleteTpl() {
  var tpl = getActiveTpl();
  if (!tpl) { toast('No active template','warn'); return; }
  openConfirm('Delete template "'+tpl.name+'" permanently?','Delete').then(async function(ok) {
    if (!ok) return;
    formTemplates = formTemplates.filter(function(t){return t.id!==activeTplId;});
    var next = formTemplates[0] || null;
    activeTplId = next ? next.id : null;
    formLayout = next ? JSON.parse(JSON.stringify(next.elements||[])) : [];
    setLoading(true); var r = await saveTplsDB(); setLoading(false);
    if (r.error) { toast(r.error,'error'); return; }
    toast('Deleted','success'); fdSelectedId=null; fdRender(); fdRenderProps(null); renderTplBar();
  });
}

/* ── New blank template ───────────────────────────── */
function fdNewTpl() {
  var name = prompt('New template name:', 'Form ' + (formTemplates.length + 1));
  if (!name || !name.trim()) return;
  var id = 'tpl_' + Date.now();
  formTemplates.push({id, name:name.trim(), elements:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()});
  activeTplId = id; formLayout = [];
  fdSelectedId = null; fdRender(); fdRenderProps(null); renderTplBar();
  toast('"'+name.trim()+'" started — add elements and Save','info');
}

/* ── Clear canvas ─────────────────────────────────── */
function fdClearCanvas() {
  openConfirm('Clear all elements from the canvas?','Clear').then(function(ok) {
    if (!ok) return;
    formLayout = []; fdSelectedId = null; fdRender(); fdRenderProps(null);
  });
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

/**
 * Build step: obfuscate JS + inline view HTML before Next.js build.
 * Source: _src/*.js, _src/views/*.html  →  Output: public/*.js
 */
const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify }           = require('terser');
const fs   = require('fs');
const path = require('path');

// Functions referenced by name from HTML event attributes — must NOT be renamed
const RESERVED = [
  // app.html onclick
  'addBPRecord','addCourseRecord','closeChangeMyPassModal','closeCommEvalModal',
  'closeConfirmModal','closeDetailsModal','closeEditRoleModal','closeMobileSidebar',
  'closeModal','closeRecordsModal','closeResetPassModal','confirmChangeMyPass',
  'confirmEditRole','confirmResetPassword','launchDashboard','loadMyCommittees',
  'loadSystemView','logout','openChangeMyPassModal','openMobileSidebar',
  'switchRecordsTab','toggleSidebar',
  // view HTML onclick
  'addAttributeRow','addBankRow','addChildInfoRow','addCountryRow','addEduRow',
  'addFamilyRow','addInlawRow','addLanguageRow','addSiblingRow','bulkCreateFromProfiles',
  'enableProfileEdit','lockProfileEdit','printPersonnelForm','refreshProfileList',
  'setProfileFontSize','switchHRTab','switchProfileTab','toggleProfileMode',
  // dynamic HTML onclick in app.js
  '_insertMention','cancelChatReply','closeCommChat','closeCommitteeEdit',
  'deleteBPRecord','deleteCourseRecord','deleteMyChatMessage','deleteUser',
  'editRole','loadPermissionsPanel','openCommChat','openCommEvalModal',
  'openCommitteeEdit','openDetailsModal','openModal','openRecordsModal',
  'openTraceReport','removeRow','resetPassword','saveCommitteeEdit',
  'savePermRow','saveSettings','sendCommitteeChatMessage','setChatReply',
  'switchActiveRole','switchAdminTab','switchSysTab','toggleAliasPanel','toggleEval',
  // dynamic HTML non-onclick event handlers (oninput / onkeydown / onblur / onchange)
  '_onChatInput','_onChatKeydown','_saveAliases',
  'filterPermTable','filterProfileList','filterUserList',
  'markPermRowDirty','submitCommEval','syncWeights',
  'togglePermChip','toggleSelectAllProfiles','updateBulkSelCount',
  // committee edit — used via JS event listeners on dynamically created elements
  '_renderEditMembers','_editMemberIds',
  // global entry points
  'google','lucide','debounceProgressUpdate','updateProfileProgress',
  'handlePhotoSelect','removePhotoPreview',
  // notifications + users directory + committee extras
  'openNotificationsPanel','loadNotificationsView','loadUsersDirectory',
  'markAllNotificationsRead','markNotifRead','deleteCommittee','closeCommitteeActivity',
  // direct messaging + user directory extras
  'filterUserDirectory','openDirectMessage','closeDirectMessage','sendDirectMessage',
  // messaging center
  'loadMessagesView','openMessagesPanel','openConversation','backToMessageList',
  'sendMessageInThread','filterMessagePeople','deleteDirectMsg','refreshMessagesBadge',
  'openNewMessage','closeNewMessage','filterNewMessage','_broadcastTyping',
  // combined login + background profile sections
  'loginAndGetProfile','getMyProfileSections',
  // appearance / theme
  'applyThemePreset','previewCustomTheme','saveCurrentTheme',
  // committee archive
  'archiveCommittee','unarchiveCommittee','toggleArchivedView',
  // routine / class adjustment ("Cut & Toss")
  'loadRoutineView','_onRoutineShortnameChange','_openAdjustModal',
  '_confirmAdjustment','_openDailySetupPrompt','_generateAdjustmentPdf',
  '_setRoutineMode','_selectAdjustTeacher','_toggleAdjustmentsList','_loadMyRoutinePeriods',
  '_confirmDailySetup','_openWeeklyRoutineModal'
];

// Strip HTML comments and collapse whitespace
function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/>\s+</g, '><')
    .trim();
}

// Read all view HTML files from _src/views/ and build an inline map
function buildViewMap(srcDir) {
  const viewsDir = path.join(srcDir, 'views');
  if (!fs.existsSync(viewsDir)) return {};
  const map = {};
  for (const f of fs.readdirSync(viewsDir)) {
    if (f.endsWith('.html')) {
      map[f] = minifyHtml(fs.readFileSync(path.join(viewsDir, f), 'utf8'));
    }
  }
  return map;
}

// Prefix injected before app.js — intercepts fetch('/views/X') to return inline HTML
function buildViewShim(viewMap) {
  const json = JSON.stringify(viewMap);
  // Overrides window.fetch for /views/* paths; all other requests pass through
  return `(function(){var __V=${json};var _f=window.fetch.bind(window);window.fetch=function(u,o){var k=String(u).replace(/^\\/views\\//,'');if(__V[k])return Promise.resolve({ok:true,text:function(){return Promise.resolve(__V[k]);}});return _f(u,o);};})();`;
}

async function build() {
  const srcDir = path.join(__dirname, '../_src');
  const outDir = path.join(__dirname, '../public');

  // ── Step 1: obfuscate app.js (with inlined views) ──────────────────────────
  const appSrcPath = path.join(srcDir, 'app.js');
  if (fs.existsSync(appSrcPath)) {
    const viewMap  = buildViewMap(srcDir);
    const viewShim = buildViewShim(viewMap);
    const appCode  = fs.readFileSync(appSrcPath, 'utf8');

    // First pass: terser compress to strip console.log and dead code
    const terserResult = await minify(viewShim + '\n' + appCode, {
      compress: { drop_console: true, drop_debugger: true, passes: 2 },
      mangle: false,   // no mangle yet — obfuscator handles that
      format: { comments: false }
    });

    // Second pass: javascript-obfuscator for real obfuscation
    const obfResult = JavaScriptObfuscator.obfuscate(terserResult.code, {
      compact: true,
      controlFlowFlattening: false,   // keep off — doubles file size for little gain
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: false,    // already stripped by terser above
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,           // don't touch window/document/etc.
      rotateStringArray: true,
      selfDefending: false,
      shuffleStringArray: true,
      splitStrings: false,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ['base64'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayThreshold: 0.8,
      unicodeEscapeSequence: false,
      reservedNames: RESERVED         // preserve onclick handler names
    });

    const out = path.join(outDir, 'app.js');
    fs.writeFileSync(out, obfResult.getObfuscatedCode(), 'utf8');
    const inKb  = (appCode.length / 1024).toFixed(1);
    const outKb = (fs.statSync(out).size / 1024).toFixed(1);
    console.log(`✓ app.js: ${inKb}KB → ${outKb}KB  (${Object.keys(viewMap).length} views inlined)`);
  }

  // ── Step 2: obfuscate shim.js ───────────────────────────────────────────────
  const shimSrc = path.join(srcDir, 'shim.js');
  if (fs.existsSync(shimSrc)) {
    const code = fs.readFileSync(shimSrc, 'utf8');
    const r = await minify(code, {
      compress: { drop_console: true, drop_debugger: true, passes: 2 },
      mangle: { toplevel: true, reserved: RESERVED },
      format: { comments: false }
    });
    fs.writeFileSync(path.join(outDir, 'shim.js'), r.code, 'utf8');
    console.log(`✓ shim.js: ${(code.length/1024).toFixed(1)}KB → ${(r.code.length/1024).toFixed(1)}KB`);
  }

  // ── Step 3: minify app.html + inject cache-bust version ────────────────────
  const htmlSrc = path.join(outDir, 'app.html');
  if (fs.existsSync(htmlSrc)) {
    const raw = fs.readFileSync(htmlSrc, 'utf8');
    const ver = Date.now().toString(36);  // short base-36 timestamp
    const min = raw
      .replace(/<!--[\s\S]*?-->/g, '')        // remove HTML comments
      .replace(/[ \t]{2,}/g, ' ')             // collapse repeated spaces/tabs
      .replace(/\n\s*\n/g, '\n')              // collapse blank lines
      .replace(/>\s{2,}</g, '><')             // remove space between tags
      // inject version query string for cache-busting
      .replace(/src="\/app\.js(\?v=[^"]*)?"/g,   `src="/app.js?v=${ver}"`)
      .replace(/src="\/shim\.js(\?v=[^"]*)?"/g,  `src="/shim.js?v=${ver}"`)
      .replace(/href="\/styles\.css(\?v=[^"]*)?"/g, `href="/styles.css?v=${ver}"`)
      .trim();
    fs.writeFileSync(htmlSrc, min, 'utf8');
    console.log(`✓ app.html: ${(raw.length/1024).toFixed(1)}KB → ${(min.length/1024).toFixed(1)}KB  (v=${ver})`);
  }

  // ── Step 4: copy CSS ────────────────────────────────────────────────────────
  const css = path.join(srcDir, 'styles.css');
  if (fs.existsSync(css)) {
    fs.copyFileSync(css, path.join(outDir, 'styles.css'));
    console.log('✓ styles.css copied');
  }
}

build().catch(e => { console.error('Build failed:', e); process.exit(1); });

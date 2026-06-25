let allStaffCache = [];
  let allUsersCache = [];
  window.APP_USER = null; // Holds the logged-in session data

  // Returns "Full Name — Designation" for a user_id, falls back to email or ID
  function staffLabel(userId) {
    const s = allStaffCache.find(s => s.teacher_id === userId);
    if (s && s.full_name) return s.designation ? `${s.full_name} — ${s.designation}` : s.full_name;
    const u = allUsersCache.find(u => u.user_id === userId);
    return u ? u.email : userId;
  }

  document.addEventListener('DOMContentLoaded', () => {

    const savedId   = localStorage.getItem('ccpc_user_id');
    const savedPass = localStorage.getItem('ccpc_pass');
    console.log('[CCPC] Saved session:', savedId ? 'found (' + savedId + ')' : 'none');

    if (savedId && savedPass) {
      const btn = document.querySelector('#loginForm button[type="submit"]');
      if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }
      performLogin(savedId, savedPass, true);
    }
    initLoginForm();
  });

  function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
  }

  // --- AUTHENTICATION ---
  function initLoginForm() {
    const form = document.getElementById('loginForm');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        performLogin(document.getElementById('loginId').value, document.getElementById('loginPass').value, false);
      };
    }
  }

  function performLogin(id, pass, isAuto) {
    const err     = document.getElementById('loginError');
    const loginId = document.getElementById('loginId');
    const loginPw = document.getElementById('loginPass');
    const btn     = document.querySelector('#loginForm button[type="submit"]');
    if (err) err.classList.add('hidden');
    showLoading(true);

    function restoreBtn() {
      if (btn) { btn.textContent = 'Enter Dashboard'; btn.disabled = false; }
    }

    console.log('[CCPC] Calling attemptLogin for:', id);
    google.script.run
      .withSuccessHandler(res => {
        console.log('[CCPC] attemptLogin response:', JSON.stringify(res));
        showLoading(false);
        restoreBtn();
        if (res.success) {
          window.APP_USER   = res;
          window.USER_ROLES = res.roles || [res.role];
          window.ACTIVE_ROLE = res.role;
          window.USER_ROLE   = res.role;
          localStorage.setItem('ccpc_user_id', id);
          localStorage.setItem('ccpc_pass', pass);
          launchDashboard();
        } else if (isAuto) {
          // Auto-login got wrong-password — pre-fill the form but keep credentials
          if (loginId) loginId.value = id;
          if (loginPw) loginPw.value = pass;
        } else {
          // Manual login with wrong credentials — clear saved and show error
          localStorage.removeItem('ccpc_user_id');
          localStorage.removeItem('ccpc_pass');
          if (err) err.classList.remove('hidden');
        }
      })
      .withFailureHandler((e) => {
        console.error('[CCPC] attemptLogin FAILED (server-side error):', e);
        showLoading(false);
        restoreBtn();
        if (isAuto) {
          if (loginId) loginId.value = id;
          if (loginPw) loginPw.value = pass;
        } else if (err) {
          err.textContent = 'Connection error — please try again.';
          err.classList.remove('hidden');
        }
      })
      .attemptLogin(id, pass);
  }

  function logout() {
    if (window.confirm("Are you sure you want to sign out?")) {
      localStorage.removeItem('ccpc_user_id');
      localStorage.removeItem('ccpc_pass');
      window.APP_USER = null;
      window.USER_ROLE = null;
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('app-screen').classList.add('hidden');
      document.getElementById('view-container').innerHTML = '';
    }
  }

  // --- NAVIGATION & VIEWS ---
  function launchDashboard() {
    if (!window.APP_USER) return;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('side-user-id').textContent = window.APP_USER.user_id;
    document.getElementById('side-user-role').textContent = window.ACTIVE_ROLE;
    updateSidebarForRole(window.ACTIVE_ROLE);
    loadDefaultView();
  }

  // Switch the active role view without re-logging in
  function switchActiveRole(newRole) {
    window.ACTIVE_ROLE = newRole;
    window.USER_ROLE   = newRole;
    const roleEl = document.getElementById('side-user-role');
    if (roleEl) roleEl.textContent = newRole;
    updateSidebarForRole(newRole);
    setActiveNavLink('nav-dashboard');
    loadDefaultView();
  }

  function updateSidebarForRole(activeRole) {
    const allRoles   = window.USER_ROLES || [activeRole];
    const isAdmin    = ['HR', 'Admin', 'Principal', 'VP'].includes(activeRole);
    const isTeacher  = ['Teacher', 'Staff'].includes(activeRole);

    // Show only nav sections relevant to the currently active role
    const adminLinks   = document.getElementById('admin-links');
    const teacherLinks = document.getElementById('teacher-links');
    if (adminLinks)   adminLinks.classList.toggle('hidden', !isAdmin);
    if (teacherLinks) teacherLinks.classList.toggle('hidden', !isTeacher);

    // Analytics: visible for HR, VP, Admin — hidden for Principal
    const analyticsLink = document.getElementById('nav-analytics');
    if (analyticsLink) analyticsLink.style.display = ['HR','VP','Admin'].includes(activeRole) ? '' : 'none';

    // Permissions panel: Admin only
    const permLink = document.getElementById('nav-permissions');
    if (permLink) permLink.style.display = activeRole === 'Admin' ? '' : 'none';

    // Role switcher: only visible when user has more than one role
    const switcher = document.getElementById('role-switcher');
    const btnsEl   = document.getElementById('role-switcher-btns');
    if (!switcher) return;

    if (allRoles.length <= 1) {
      switcher.classList.add('hidden');
      return;
    }
    switcher.classList.remove('hidden');

    const roleColors = {
      Teacher: 'from-blue-600 to-blue-500',
      Staff:   'from-slate-600 to-slate-500',
      HR:      'from-purple-600 to-purple-500',
      Admin:   'from-slate-800 to-slate-700',
      Principal:'from-indigo-600 to-indigo-500',
      VP:      'from-indigo-500 to-indigo-400'
    };

    if (btnsEl) {
      btnsEl.innerHTML = allRoles.map(r => {
        const isActive = r === activeRole;
        const grad = roleColors[r] || 'from-slate-600 to-slate-500';
        return `<button onclick="switchActiveRole('${r}')"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all duration-300
                 ${isActive ? `bg-gradient-to-r ${grad} text-white shadow-lg` : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'}">
          <span class="w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-white' : 'bg-slate-600'}"></span>
          <span class="nav-text">${r}</span>
          ${isActive ? '<span class="ml-auto nav-text text-[8px] opacity-70">Active</span>' : ''}
        </button>`;
      }).join('');
    }
  }

  function setActiveNavLink(id) {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const active = document.getElementById(id);
    if (active) active.classList.add('active');
  }

  function loadDefaultView() {
    setActiveNavLink('nav-dashboard');
    const role = window.ACTIVE_ROLE || window.USER_ROLE;

    if (role === 'Admin') { renderAdminDashboard(); return; }

    showLoading(true);
    const viewMap = { Teacher: 'TeacherView', Staff: 'TeacherView', HR: 'HRView', Principal: 'LeadershipView', VP: 'LeadershipView' };
    const viewFile = (viewMap[role] || 'TeacherView') + '.html';

    fetch('/views/' + viewFile)
      .then(r => r.text())
      .then(html => {
        document.getElementById('view-container').innerHTML = html;
        lucide.createIcons();
        if (['Teacher', 'Staff'].includes(role)) {
          google.script.run
            .withSuccessHandler(data => {
              try { renderTeacherProfile(data); } catch(e) { console.error('Profile render error:', e); }
              showLoading(false);
            })
            .withFailureHandler(() => showLoading(false))
            .getMyProfile(window.APP_USER ? window.APP_USER.email : '');
        } else {
          google.script.run
            .withSuccessHandler(data => {
              try { allStaffCache = Array.isArray(data) ? data : []; renderStaffTable(); renderGradingGrid(); } catch(e) { console.error(e); }
              showLoading(false);
            })
            .withFailureHandler(() => showLoading(false))
            .getAllStaffData(role === 'Principal' || role === 'VP', true);
        }
      })
      .catch(e => { console.error('View load failed:', e); showLoading(false); });
  }

  function renderAdminDashboard() {
    const container = document.getElementById('view-container');
    if (!container) return;

    container.innerHTML = `
    <div class="space-y-5">
      <!-- Header + Tab bar -->
      <div>
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Administration</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1 mb-4">Committee assignments and evaluation parameters</p>
        <div class="flex flex-wrap gap-2">
          <button onclick="switchAdminTab('adm-committees')" id="atab-adm-committees"
            class="admin-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all bg-blue-600 text-white shadow-lg shadow-blue-500/20">
            <i data-lucide="shield-check" class="h-3.5 w-3.5"></i>Committees
          </button>
          <button onclick="switchAdminTab('adm-params')" id="atab-adm-params"
            class="admin-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all bg-white text-slate-400 border border-slate-200 hover:bg-slate-50">
            <i data-lucide="sliders-horizontal" class="h-3.5 w-3.5"></i>Parameters
          </button>
        </div>
      </div>

      <!-- ── Tab: Committees ── -->
      <div id="adm-committees" class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="p-6 border-b border-slate-100">
          <p class="font-black text-slate-800 text-sm mb-4">New Committee</p>
          <form id="createCommForm" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Committee Name</label>
                <input type="text" name="committee_name" required placeholder="e.g. Disciplinary Committee"
                  class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
              </div>
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Sub-Committee (Optional)</label>
                <input type="text" name="sub_committee" placeholder="e.g. Section A"
                  class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Chairman</label>
                <select id="commChairman" required
                  class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
                  <option value="">Choose a Chairman…</option>
                </select>
              </div>
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Add Members</label>
                <input type="text" id="commMemberSearch" list="userList" placeholder="Search by name or ID…"
                  class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
                <datalist id="userList"></datalist>
              </div>
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Selected Members</label>
              <div id="selectedMembers" class="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-2xl min-h-[44px]">
                <p class="text-slate-400 text-[10px] font-bold italic self-center mx-auto">No members added yet</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="submit" class="bg-blue-600 text-white font-black px-8 py-3 rounded-2xl shadow-lg shadow-blue-500/20 hover:bg-black transition-all uppercase tracking-widest text-xs">
                Create Committee
              </button>
            </div>
          </form>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest border-b border-slate-100">
                <th class="px-6 py-3">Committee</th>
                <th class="px-6 py-3">Chairman</th>
                <th class="px-6 py-3">Members</th>
                <th class="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="committeeListBody" class="divide-y divide-slate-100"></tbody>
          </table>
        </div>
      </div>

      <!-- ── Tab: Parameters ── -->
      <div id="adm-params" class="hidden">
        <div id="hr-settings-content">
          <p class="text-xs text-slate-400 font-bold text-center py-8">Loading parameters…</p>
        </div>
      </div>

    </div>

    <!-- ══ Committee Edit Modal ══ -->
    <div id="commEditModal" style="display:none;position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);" onclick="if(event.target===this)closeCommitteeEdit()">
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(640px,95vw);max-height:90vh;overflow-y:auto;background:#fff;border-radius:1.5rem;box-shadow:0 24px 64px rgba(0,0,0,.2);">
        <div style="padding:1.5rem 1.5rem 0;" class="flex items-center justify-between">
          <div>
            <p class="text-base font-black text-slate-800">Edit Committee</p>
            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Update name, chairman or membership</p>
          </div>
          <button onclick="closeCommitteeEdit()" class="w-9 h-9 rounded-xl bg-slate-100 hover:bg-red-100 hover:text-red-500 flex items-center justify-center text-slate-400 font-black transition-all text-lg leading-none">×</button>
        </div>
        <div style="padding:1.5rem;" class="space-y-4">
          <input type="hidden" id="commEditId">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Committee Name</label>
              <input type="text" id="commEditName" class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Sub-Committee (Optional)</label>
              <input type="text" id="commEditSub" class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Chairman</label>
              <select id="commEditChairman" class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
                <option value="">Choose a Chairman…</option>
              </select>
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Add Member</label>
              <input type="text" id="commEditMemberSearch" list="userListEdit" placeholder="Search and press Enter…"
                class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
              <datalist id="userListEdit"></datalist>
            </div>
          </div>
          <div>
            <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Members</label>
            <div id="commEditMembers" class="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-2xl min-h-[44px]"></div>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button onclick="closeCommitteeEdit()" class="px-6 py-2.5 border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-all">Cancel</button>
            <button onclick="saveCommitteeEdit()" class="px-8 py-2.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-lg shadow-blue-500/20 hover:bg-black transition-all">Save Changes</button>
          </div>
        </div>
      </div>
    </div>`;

    lucide.createIcons();
    loadUserData_forSystem();
    initCommitteeForm();
    loadCommitteeData();
    initSettingsTab();
  }

  function switchAdminTab(tabId) {
    ['adm-committees','adm-params'].forEach(id => {
      const panel = document.getElementById(id);
      const btn   = document.getElementById('atab-' + id);
      if (panel) panel.classList.toggle('hidden', id !== tabId);
      if (btn) {
        btn.className = btn.className
          .replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g,'').trim();
        btn.className += id === tabId
          ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20'
          : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
  }

  // --- TEACHER PROFILE LOGIC ---
  function loadTeacherProfile() {
    showLoading(true);
    google.script.run
      .withSuccessHandler(data => {
        try { renderTeacherProfile(data); } catch (e) { console.error('Profile render error:', e); }
        showLoading(false);
      })
      .withFailureHandler(err => { showLoading(false); console.error('Profile load failed:', err); })
      .getMyProfile();
  }

  function renderTeacherProfile(data) {
    if (!data) return;
    const form = document.getElementById('teacherForm');
    if (!form) return;

    // Helper: set field value safely
    function sf(name, val) {
      const el = form.elements[name];
      if (el) el.value = val || '';
    }

    // --- Tab 1: Personal Info ---
    sf('teacher_id', data.teacher_id);
    sf('full_name', data.full_name);
    sf('category', data.category || 'Teacher');
    sf('designation', data.designation);
    sf('national_id', data.national_id);
    sf('auth_ref', data.auth_ref);
    sf('name_bengali', data.name_bengali);
    sf('school_college', data.school_college);
    sf('joining_date', data.joining_date ? data.joining_date.split('T')[0] : '');
    sf('date_of_birth', data.date_of_birth ? data.date_of_birth.split('T')[0] : '');
    sf('place_of_birth', data.place_of_birth);
    sf('birth_certificate_no', data.birth_certificate_no);
    sf('height_feet', data.height_feet);
    sf('height_inches', data.height_inches);
    sf('weight_kg', data.weight_kg);
    sf('blood_group', data.blood_group);
    sf('identification_marks', data.identification_marks);
    sf('medical_category', data.medical_category);
    sf('disability_nature', data.disability_nature);
    sf('disability_attributable', data.disability_attributable);
    sf('religion', data.religion);
    sf('caste', data.caste);
    sf('nationality', data.nationality);
    sf('previous_nationality', data.previous_nationality);
    sf('permanent_address', data.permanent_address);
    sf('present_address', data.present_address);
    sf('alternate_address', data.alternate_address);
    sf('personal_email', data.personal_email);
    sf('tt_phone', data.tt_phone);
    sf('mobile', data.mobile);

    // --- Tab 2: Travel & Languages ---
    sf('passport_number', data.passport_number);
    sf('passport_date_issue', data.passport_date_issue ? data.passport_date_issue.split('T')[0] : '');
    sf('passport_place_issue', data.passport_place_issue);
    sf('passport_date_expiry', data.passport_date_expiry ? data.passport_date_expiry.split('T')[0] : '');
    sf('passport_type', data.passport_type);
    sf('passport_issuing_auth', data.passport_issuing_auth);

    const countries = Array.isArray(data.countries_visited) ? data.countries_visited : [];
    const countriesEl = document.getElementById('countriesContainer');
    if (countriesEl) { countriesEl.innerHTML = ''; countries.forEach(r => addCountryRow(r)); if (!countries.length) addCountryRow(); }

    const languages = Array.isArray(data.language_skills) ? data.language_skills : [];
    const langEl = document.getElementById('languagesContainer');
    if (langEl) { langEl.innerHTML = ''; languages.forEach(r => addLanguageRow(r)); if (!languages.length) addLanguageRow(); }

    // --- Tab 3: Parents & Siblings ---
    sf('father_name', data.father_name);
    sf('father_nationality', data.father_nationality);
    sf('father_prev_nationality', data.father_prev_nationality);
    sf('father_citizenship_auth', data.father_citizenship_auth);
    sf('father_present_age', data.father_present_age);
    sf('father_date_of_decease', data.father_date_of_decease ? data.father_date_of_decease.split('T')[0] : '');
    sf('father_occupation', data.father_occupation);
    sf('father_annual_income', data.father_annual_income);
    sf('mother_name', data.mother_name);
    sf('mother_nationality', data.mother_nationality);
    sf('mother_prev_nationality', data.mother_prev_nationality);
    sf('mother_citizenship_auth', data.mother_citizenship_auth);
    sf('mother_present_age', data.mother_present_age);
    sf('mother_date_of_decease', data.mother_date_of_decease ? data.mother_date_of_decease.split('T')[0] : '');
    sf('mother_occupation', data.mother_occupation);
    sf('position_in_siblings', data.position_in_siblings);

    const siblings = Array.isArray(data.siblings_info) ? data.siblings_info : [];
    const sibEl = document.getElementById('siblingsContainer');
    if (sibEl) { sibEl.innerHTML = ''; siblings.forEach(r => addSiblingRow(r)); if (!siblings.length) addSiblingRow(); }

    // --- Tab 4: Marital & Spouse ---
    sf('marital_status', data.marital_status);
    sf('marriage_divorce_date', data.marriage_divorce_date ? data.marriage_divorce_date.split('T')[0] : '');
    sf('marriage_authority', data.marriage_authority);

    const sp = data.spouse_details && !Array.isArray(data.spouse_details) ? data.spouse_details
             : (Array.isArray(data.spouse_details) && data.spouse_details.length ? data.spouse_details[0] : {});
    sf('spouse_name_en', sp.name_english || data.spouse_name || '');
    sf('spouse_name_bn', sp.name_bengali);
    sf('spouse_dob', sp.date_of_birth ? sp.date_of_birth.split('T')[0] : '');
    sf('spouse_pob', sp.place_of_birth);
    sf('spouse_birth_reg', sp.birth_reg_number);
    sf('spouse_nationality', sp.nationality);
    sf('spouse_prev_nationality', sp.prev_nationality);
    sf('spouse_citizenship_auth', sp.citizenship_auth);
    sf('spouse_nid', sp.national_id);
    sf('spouse_education', sp.educational_qualification);
    sf('spouse_occupation', sp.occupation);
    sf('spouse_occ_designation', sp.occupation_designation);
    sf('spouse_occ_address', sp.occupation_address);
    sf('spouse_prev_occupation', sp.previous_occupation);
    sf('spouse_tid_bin', sp.tid_bin_no);

    const famContainer = document.getElementById('familyContainer');
    const famData = Array.isArray(data.family_details) ? data.family_details : [];
    if (famContainer) { famContainer.innerHTML = ''; famData.forEach(f => addFamilyRow(f)); if (!famData.length) addFamilyRow(); }

    // --- Tab 5: Children & Health ---
    const childrenData = Array.isArray(data.children_info) ? data.children_info : [];
    const childEl = document.getElementById('childrenContainer');
    if (childEl) { childEl.innerHTML = ''; childrenData.forEach(r => addChildInfoRow(r)); if (!childrenData.length) addChildInfoRow(); }

    const diseases = Array.isArray(data.chronic_diseases) ? data.chronic_diseases : [];
    const diseaseEl = document.getElementById('diseasesContainer');
    if (diseaseEl) { diseaseEl.innerHTML = ''; diseases.forEach(r => addDiseaseRow(r)); if (!diseases.length) addDiseaseRow(); }

    const inlaws = Array.isArray(data.sibling_inlaws) ? data.sibling_inlaws : [];
    const inlawEl = document.getElementById('inlawsContainer');
    if (inlawEl) { inlawEl.innerHTML = ''; inlaws.forEach(r => addInlawRow(r)); if (!inlaws.length) addInlawRow(); }

    // --- Tab 6: Financial ---
    sf('tid_bin_no', data.tid_bin_no);
    sf('own_income', data.own_income);
    sf('spouse_income', data.spouse_income);
    sf('assets_income', data.assets_income);
    sf('assets_details', data.assets_details);

    const banks = Array.isArray(data.bank_accounts) ? data.bank_accounts : [];
    const bankEl = document.getElementById('bankContainer');
    if (bankEl) { bankEl.innerHTML = ''; banks.forEach(r => addBankRow(r)); if (!banks.length) addBankRow(); }

    // --- Tab 7: Education ---
    const eduRecs = Array.isArray(data.education_records) ? data.education_records : [];
    const eduEl = document.getElementById('eduContainer');
    if (eduEl) { eduEl.innerHTML = ''; eduRecs.forEach(r => addEduRow(r)); if (!eduRecs.length) addEduRow(); }

    sf('additional_qualification', data.additional_qualification);

    const attrContainer = document.getElementById('attributeContainer');
    const attrData = Array.isArray(data.faculty_attributes) ? data.faculty_attributes : [];
    if (attrContainer) { attrContainer.innerHTML = ''; attrData.forEach(a => addAttributeRow(a)); if (!attrData.length) addAttributeRow(); }

    // --- Tab 8: Career Events ---
    sf('institution_law_breaking', data.institution_law_breaking);
    sf('civil_law_breaking', data.civil_law_breaking);

    // --- Photo ---
    if (data.photo_url) setProfilePhoto(data.photo_url);

    // Form submission
    form.onsubmit = (e) => {
      e.preventDefault();
      showLoading(true);
      const fd = new FormData(form);
      const payload = {};
      fd.forEach((value, key) => {
        if (key.includes('[]')) {
          if (!payload[key]) payload[key] = [];
          payload[key].push(value);
        } else {
          payload[key] = value;
        }
      });
      // Include saved photo file ID
      const photoImg = document.getElementById('photoPreviewImg');
      if (photoImg && photoImg.dataset.fileId) payload.photo_url = photoImg.dataset.fileId;
      google.script.run
        .withSuccessHandler(() => {
          showLoading(false);
          showToast('Profile saved successfully!');
          const msg = document.getElementById('profileSaveMsg');
          if (msg) { msg.classList.remove('hidden'); setTimeout(() => msg.classList.add('hidden'), 3000); }
        })
        .withFailureHandler(err => { showLoading(false); showToast('Save failed: ' + (err.message || err), 'error'); })
        .savePersonalProfile(payload);
    };

    lucide.createIcons();
    updateProfileProgress();
    lockProfileEdit();
  }

  // --- Profile Tab Switcher ---
  function switchProfileTab(tab) {
    document.querySelectorAll('.psec').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.ptab-btn').forEach(b => b.classList.remove('active-ptab'));
    const sec = document.getElementById('psec-' + tab);
    const btn = document.getElementById('ptab-' + tab);
    if (sec) sec.classList.remove('hidden');
    if (btn) btn.classList.add('active-ptab');
    updateProfileProgress();
  }

  function addFamilyRow(data = {}) {
    const container = document.getElementById('familyContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.dataset.drow = '1';
    div.className = "grid grid-cols-1 md:grid-cols-4 gap-4 items-end border-b border-slate-50 pb-4 relative group";
    div.innerHTML = `
      <div class="space-y-1">
        <label class="text-[10px] font-bold text-slate-400">Relation</label>
        <select name="fam_type[]" class="w-full px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
          <option value="Spouse" ${data.member_type === 'Spouse' ? 'selected' : ''}>Spouse</option>
          <option value="Son" ${data.member_type === 'Son' ? 'selected' : ''}>Son</option>
          <option value="Daughter" ${data.member_type === 'Daughter' ? 'selected' : ''}>Daughter</option>
        </select>
      </div>
      <div class="space-y-1 col-span-2">
        <label class="text-[10px] font-bold text-slate-400">Name / Details</label>
        <input type="text" name="fam_name[]" value="${data.name || ''}" placeholder="Name & Current Status" class="w-full px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
      </div>
      <div class="space-y-1">
        <label class="text-[10px] font-bold text-slate-400">Date</label>
        <div class="flex items-center gap-2">
          <input type="date" name="fam_date[]" value="${data.marriage_date ? data.marriage_date.split('T')[0] : ''}" class="flex-1 px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
          <button type="button" onclick="removeRow(this)" class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
        </div>
      </div>
    `;
    container.appendChild(div);
    lucide.createIcons();
  }

  function addAttributeRow(data = {}) {
    const container = document.getElementById('attributeContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.dataset.drow = '1';
    div.className = "grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-50 pb-4 relative group";
    div.innerHTML = `
      <select name="attr_header[]" class="w-full px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
        <option value="Education" ${data.header === 'Education' ? 'selected' : ''}>Education / Degree</option>
        <option value="Achievement" ${data.header === 'Achievement' ? 'selected' : ''}>Achievement / Award</option>
        <option value="Speciality" ${data.header === 'Speciality' ? 'selected' : ''}>Speciality / Skill</option>
        <option value="Hobby" ${data.header === 'Hobby' ? 'selected' : ''}>Hobby</option>
        <option value="Committee" ${data.header === 'Committee' ? 'selected' : ''}>Active Committee</option>
      </select>
      <input type="text" name="attr_subheader[]" value="${data.subheader || ''}" placeholder="Sub-header" class="w-full px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
      <div class="flex items-center gap-2">
        <input type="text" name="attr_value[]" value="${data.value || ''}" placeholder="Information" class="flex-1 px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
        <button type="button" onclick="removeRow(this)" class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
      </div>
    `;
    container.appendChild(div);
    lucide.createIcons();
  }

  function removeRow(btn) {
    const row = btn.closest('[data-drow]');
    if (row) row.remove();
  }

  function _removeBtn() {
    return `<button type="button" onclick="removeRow(this)" class="shrink-0 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"><i data-lucide="trash-2" class="h-4 w-4"></i></button>`;
  }

  function _inp(name, val, placeholder, type) {
    return `<input type="${type||'text'}" name="${name}" value="${val||''}" placeholder="${placeholder||''}" class="pf-input text-sm">`;
  }

  function addCountryRow(data) {
    data = data || {};
    const c = document.getElementById('countriesContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 border-b border-slate-50 pb-3 group relative';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Country</label>${_inp('country_name[]', data.country_name)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">From</label>${_inp('duration_from[]', data.duration_from ? data.duration_from.split('T')[0] : '', '', 'date')}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">To</label>${_inp('duration_to[]', data.duration_to ? data.duration_to.split('T')[0] : '', '', 'date')}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Reasons for Visiting</label>
        <div class="flex gap-2 items-center">${_inp('visit_reasons[]', data.reasons)}${_removeBtn()}</div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addLanguageRow(data) {
    data = data || {};
    const c = document.getElementById('languagesContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-2 gap-3 border-b border-slate-50 pb-3 group relative';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Language</label>${_inp('language[]', data.language)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Efficiency (Speaking / Writing / Reading)</label>
        <div class="flex gap-2 items-center">${_inp('efficiency[]', data.efficiency)}${_removeBtn()}</div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addSiblingRow(data) {
    data = data || {};
    const c = document.getElementById('siblingsContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-5 gap-3 border-b border-slate-50 pb-3 group';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Name in Full</label>${_inp('sibling_name[]', data.name)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Age</label>${_inp('sibling_age[]', data.age, '', 'number')}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Nationality</label>
        <input type="text" name="sibling_nationality[]" value="${data.nationality||''}" list="dl-nationality" class="pf-input text-sm" placeholder="Bangladeshi">
      </div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Occupation &amp; Address</label>${_inp('sibling_occ_addr[]', data.occupation_address)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Dependency (On You)</label>
        <div class="flex gap-2 items-center">
          <select name="sibling_dependency[]" class="pf-input text-sm flex-1">
            <option value="">Select...</option>
            <option value="Yes" ${data.dependency==='Yes'?'selected':''}>Yes</option>
            <option value="Partially" ${data.dependency==='Partially'?'selected':''}>Partially</option>
            <option value="No" ${data.dependency==='No'?'selected':''}>No</option>
          </select>
          ${_removeBtn()}
        </div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addChildInfoRow(data) {
    data = data || {};
    const c = document.getElementById('childrenContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-6 gap-3 border-b border-slate-50 pb-3 group';
    d.innerHTML = `
      <div class="space-y-1 md:col-span-2"><label class="text-[10px] font-bold text-slate-400">Name of Child</label>${_inp('child_name[]', data.name)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Sex</label>
        <select name="child_sex[]" class="pf-input text-sm"><option value="">-</option><option value="Male" ${data.sex==='Male'?'selected':''}>Male</option><option value="Female" ${data.sex==='Female'?'selected':''}>Female</option></select>
      </div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Date of Birth</label>${_inp('child_dob[]', data.date_of_birth ? data.date_of_birth.split('T')[0] : '', '', 'date')}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Occupation</label>${_inp('child_occupation[]', data.occupation)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Present Address</label>
        <div class="flex gap-2 items-center">${_inp('child_address[]', data.present_address)}${_removeBtn()}</div>
      </div>
      <div class="space-y-1 md:col-span-6"><label class="text-[10px] font-bold text-slate-400">Disease of Self / Spouse / Children</label>${_inp('child_disease_notes[]', data.disease_notes)}</div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addDiseaseRow(data) {
    data = data || {};
    const c = document.getElementById('diseasesContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 border-b border-slate-50 pb-3 group';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Name of Disease</label>${_inp('disease_name[]', data.disease_name)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Nature of Disease</label>${_inp('disease_nature[]', data.nature)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Date of Illness</label>${_inp('disease_date[]', data.date_of_illness ? data.date_of_illness.split('T')[0] : '', '', 'date')}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Present Condition</label>
        <div class="flex gap-2 items-center">${_inp('disease_condition[]', data.present_condition)}${_removeBtn()}</div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addInlawRow(data) {
    data = data || {};
    const c = document.getElementById('inlawsContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-slate-50 pb-3 group';
    const rel = data.relation || '';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Relation</label>
        <select name="inlaw_relation[]" class="pf-input text-sm">
          <option value="">Select...</option>
          <option value="Brother" ${rel==='Brother'?'selected':''}>Brother</option>
          <option value="Sister" ${rel==='Sister'?'selected':''}>Sister</option>
          <option value="Brother-in-law" ${rel==='Brother-in-law'?'selected':''}>Brother-in-law</option>
          <option value="Sister-in-law" ${rel==='Sister-in-law'?'selected':''}>Sister-in-law</option>
        </select>
      </div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Name in Full</label>${_inp('inlaw_name[]', data.name_in_full)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Address</label>
        <div class="flex gap-2 items-center">${_inp('inlaw_address[]', data.address)}${_removeBtn()}</div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addBankRow(data) {
    data = data || {};
    const c = document.getElementById('bankContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-slate-50 pb-3 group';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Name of Bank</label>${_inp('bank_name[]', data.bank_name)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Account Number</label>${_inp('bank_account_no[]', data.account_number)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Type of Account</label>
        <div class="flex gap-2 items-center">${_inp('bank_account_type[]', data.account_type)}${_removeBtn()}</div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function addEduRow(data) {
    data = data || {};
    const c = document.getElementById('eduContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.dataset.drow = '1';
    d.className = 'grid grid-cols-1 md:grid-cols-7 gap-3 border-b border-slate-50 pb-3 group';
    d.innerHTML = `
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">From</label>${_inp('edu_from[]', data.from_date)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">To</label>${_inp('edu_to[]', data.to_date)}</div>
      <div class="space-y-1 md:col-span-2"><label class="text-[10px] font-bold text-slate-400">School/College/University</label>${_inp('edu_school[]', data.school_college)}</div>
      <div class="space-y-1 md:col-span-2"><label class="text-[10px] font-bold text-slate-400">Examination Passed (Subjects)</label>${_inp('edu_exam[]', data.exam_passed)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Division / GPA</label>${_inp('edu_gpa[]', data.division_gpa)}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Year of Passing</label>${_inp('edu_year[]', data.year_of_passing)}</div>
      <div class="space-y-1 md:col-span-2"><label class="text-[10px] font-bold text-slate-400">Remarks (Board Standing etc.)</label>
        <div class="flex gap-2 items-center">${_inp('edu_remarks[]', data.remarks)}${_removeBtn()}</div>
      </div>`;
    c.appendChild(d); lucide.createIcons();
  }

  function _requireAdminRole() {
    if (!['HR','Admin','Principal','VP'].includes(window.ACTIVE_ROLE)) {
      showToast('Not available in current role', 'error'); return false;
    }
    return true;
  }

  function _requireEditRole() {
    if (!['HR','Admin','VP'].includes(window.ACTIVE_ROLE)) {
      showToast('You have view-only access in this role', 'error'); return false;
    }
    return true;
  }

  function loadStaffRegistry() {
    if (!_requireAdminRole()) return;
    setActiveNavLink('nav-registry');
    showLoading(true);
    google.script.run.withSuccessHandler(html => {
      document.getElementById('view-container').innerHTML = html;
      loadStaffData();
      loadUserData();
      showLoading(false);
      lucide.createIcons();
    }).getViewContent('HR');
  }

  function loadSystemView() {
    if (!_requireAdminRole()) return;
    setActiveNavLink('nav-system');
    const role     = window.ACTIVE_ROLE;
    const canEdit  = ['HR', 'VP', 'Admin'].includes(role);
    const adminOnly = role === 'Admin';
    renderSystemView(role, canEdit, adminOnly);
  }

  function _show(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }

  function renderSystemView(role, canEdit, adminOnly) {
    const container = document.getElementById('view-container');
    if (!container) return;

    // Build tab list based on role
    const tabs = [
      { id: 'sys-users',      label: 'Users',    icon: 'users' },
      ...(canEdit ? [{ id: 'sys-register', label: 'Register', icon: 'user-plus' }] : []),
    ];
    const firstTab = tabs[0].id;

    const tabBar = tabs.map(t => `
      <button onclick="switchSysTab('${t.id}')" id="stab-${t.id}"
        class="sys-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
               ${t.id === firstTab ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}">
        <i data-lucide="${t.icon}" class="h-3.5 w-3.5"></i>${t.label}
      </button>`).join('');

    container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 72px);overflow:hidden;">

      <!-- ══ LOCKED TOP BAR ══ -->
      <div style="flex-shrink:0;background:#f8fafc;padding-bottom:1rem;border-bottom:1px solid #e2e8f0;">
        <!-- Title + subtitle -->
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">System</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
          ${role === 'Principal' ? 'View users and committees' : 'Manage users, committees and access'}
        </p>
        <!-- Tab buttons -->
        <div class="flex flex-wrap gap-2 mt-4">${tabBar}</div>

        <!-- ── Users tab header ── -->
        <div id="sys-users-hdr" class="mt-4 flex items-center justify-between flex-wrap gap-3">
          <p class="font-black text-slate-800 text-sm">Portal Access Accounts
            ${!canEdit ? '<span class="ml-2 px-2 py-0.5 bg-amber-100 text-amber-600 text-[9px] font-black uppercase rounded-full">View Only</span>' : ''}
          </p>
          <div class="relative w-56">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"></i>
            <input type="text" id="userSearchInput" oninput="filterUserList()" placeholder="Search users…"
              class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-xs">
          </div>
        </div>

        <!-- ── Register tab header ── -->
        ${canEdit ? `
        <div id="sys-register-hdr" style="display:none;" class="mt-4 space-y-3">
          <div class="flex items-center justify-between">
            <p class="font-black text-slate-800 text-sm">Register from Profiles
              <span class="ml-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest">Grant portal access to existing staff</span>
            </p>
            <button onclick="refreshProfileList()" class="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-500 text-[10px] font-black uppercase tracking-widest transition-all">
              <i data-lucide="refresh-cw" class="h-3 w-3"></i> Refresh
            </button>
          </div>
          <div class="flex items-center gap-4">
            <div class="flex-1 max-w-xs">
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Default Password</label>
              <input type="password" id="bulkDefaultPass" placeholder="e.g. ccpc@1234"
                class="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-sm">
            </div>
            <div class="flex-1 relative" style="margin-top:1.4rem;">
              <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"></i>
              <input type="text" id="profileSearchInput" oninput="filterProfileList()" placeholder="Search profiles…"
                class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
            </div>
          </div>
        </div>` : ''}
      </div>

      <!-- ══ SCROLLABLE LIST AREA ══ -->
      <div style="flex:1;overflow-y:auto;min-height:0;padding-top:1rem;">

        <!-- Users list -->
        <div id="sys-users" class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-50 text-slate-400 text-xs font-bold uppercase tracking-widest border-b border-slate-100">
                  <th class="px-6 py-3">Identity</th>
                  <th class="px-6 py-3">Email</th>
                  <th class="px-6 py-3">Role</th>
                  <th class="px-6 py-3">Status</th>
                  ${canEdit ? '<th class="px-6 py-3 text-right">Actions</th>' : ''}
                </tr>
              </thead>
              <tbody id="userListBody" class="divide-y divide-slate-100"></tbody>
            </table>
          </div>
        </div>

        <!-- Register list -->
        ${canEdit ? `
        <div id="sys-register" style="display:none;" class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-50 border-b border-slate-100">
                  <th class="px-4 py-3"><input type="checkbox" id="selectAllProfiles" onchange="toggleSelectAllProfiles(this.checked)" class="w-4 h-4 rounded accent-indigo-600"></th>
                  <th class="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Profile</th>
                  ${ALL_ROLES.map(r => `<th class="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">${r.slice(0,2)}</th>`).join('')}
                </tr>
              </thead>
              <tbody id="profilePickerList" class="divide-y divide-slate-100">
                <tr><td colspan="${ALL_ROLES.length + 2}" class="px-4 py-8 text-center text-slate-400 text-xs font-black uppercase tracking-widest">Loading profiles…</td></tr>
              </tbody>
            </table>
          </div>
          <!-- Footer bar locked at bottom of scroll area -->
          <div style="position:sticky;bottom:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.5rem;background:rgba(255,255,255,.97);border-top:1px solid #e2e8f0;box-shadow:0 -4px 12px rgba(0,0,0,.06);">
            <span id="bulkSelCount" class="text-xs font-black text-slate-400">0 selected</span>
            <button onclick="bulkCreateFromProfiles()"
              class="bg-indigo-600 text-white font-black px-6 py-2.5 rounded-2xl shadow-lg shadow-indigo-500/20 hover:bg-black transition-all uppercase tracking-widest text-xs flex items-center gap-2">
              <i data-lucide="user-check" class="h-3.5 w-3.5"></i> Create Users
            </button>
          </div>
        </div>` : ''}

      </div><!-- /scroll area -->
    </div>`;

    lucide.createIcons();
    loadUserData_forSystem();
  }

  function switchSysTab(tabId) {
    const tabs = ['sys-users','sys-register'];
    tabs.forEach(id => {
      const panel = document.getElementById(id);
      const hdr   = document.getElementById(id + '-hdr');
      const btn   = document.getElementById('stab-' + id);
      const active = id === tabId;
      if (panel) panel.style.display = active ? '' : 'none';
      if (hdr)   hdr.style.display   = active ? '' : 'none';
      if (btn) {
        btn.className = btn.className.replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g, '').trim();
        btn.className += active
          ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20'
          : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
    if (tabId === 'sys-register') refreshProfileList();
  }

  function loadMyCommittees() {
    if (!['Teacher','Staff'].includes(window.ACTIVE_ROLE)) {
      showToast('Not available in current role', 'error'); return;
    }
    setActiveNavLink('nav-my-committees');
    showLoading(true);
    google.script.run.withSuccessHandler(html => {
      document.getElementById('view-container').innerHTML = html;
      renderMyCommitteeCards();
      showLoading(false);
      lucide.createIcons();
    }).getViewContent('Committee');
  }

  // ── PERMISSION CONTROL PANEL (Admin only) ────────────────────────────────────
  const ALL_ROLES = ['Teacher','Staff','HR','Principal','VP','Admin'];

  function loadPermissionsPanel() {
    if (window.ACTIVE_ROLE !== 'Admin') { showToast('Admin access only', 'error'); return; }
    setActiveNavLink('nav-permissions');
    document.getElementById('view-container').innerHTML = `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <h2 class="text-2xl font-black text-slate-800 tracking-tight">Permission Control</h2>
            <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Manage role assignments for all portal users</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="relative w-56">
              <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"></i>
              <input type="text" id="permSearchInput" oninput="filterPermTable()" placeholder="Search users…"
                class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-600 outline-none shadow-sm">
            </div>
            <button onclick="loadPermissionsPanel()" class="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 text-xs font-black uppercase tracking-widest hover:bg-slate-50 shadow-sm transition-all">
              <i data-lucide="refresh-cw" class="h-3.5 w-3.5"></i> Refresh
            </button>
          </div>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-50 border-b border-slate-100">
                  <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">User</th>
                  ${ALL_ROLES.map(r => `<th class="px-3 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">${r}</th>`).join('')}
                  <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Save</th>
                </tr>
              </thead>
              <tbody id="permTableBody" class="divide-y divide-slate-100">
                <tr><td colspan="${ALL_ROLES.length + 2}" class="px-6 py-10 text-center text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
    lucide.createIcons();
    showLoading(true);
    google.script.run
      .withSuccessHandler(data => {
        showLoading(false);
        allUsersCache = Array.isArray(data) ? data : [];
        renderPermTable(allUsersCache);
      })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to load users', 'error'); })
      .getAppUsers();
  }

  function renderPermTable(users) {
    const tbody = document.getElementById('permTableBody');
    if (!tbody) return;
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="${ALL_ROLES.length + 2}" class="px-6 py-10 text-center text-slate-400 text-xs font-black uppercase tracking-widest italic">No users found</td></tr>`;
      return;
    }
    const roleStyle = {
      Teacher:'#4f46e5', Staff:'#64748b', HR:'#9333ea',
      Principal:'#2563eb', VP:'#0891b2', Admin:'#e11d48'
    };
    tbody.innerHTML = users.map(u => {
      const current = (u.role || '').split(',').map(r => r.trim()).filter(Boolean);
      const label = staffLabel(u.user_id);
      const checkboxes = ALL_ROLES.map(r => {
        const color = roleStyle[r] || '#64748b';
        const isChecked = current.includes(r);
        return `<td class="px-3 py-4 text-center">
          <label class="inline-flex items-center justify-center cursor-pointer">
            <input type="checkbox" value="${r}" ${isChecked ? 'checked' : ''}
              class="perm-cb-${u.user_id} hidden"
              onchange="markPermRowDirty('${u.user_id}'); togglePermChip(this, '${color}')">
            <span class="w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all text-[9px] font-black select-none"
              style="${isChecked ? `background:${color};border-color:${color};color:#fff;` : 'background:#f8fafc;border-color:#e2e8f0;color:#94a3b8;'}">
              ${r.slice(0,2).toUpperCase()}
            </span>
          </label>
        </td>`;
      }).join('');
      return `<tr class="hover:bg-slate-50/60 transition-colors" id="perm-row-${u.user_id}">
        <td class="px-6 py-4">
          <p class="text-sm font-black text-slate-800">${label !== u.user_id ? label : u.email || u.user_id}</p>
          <p class="text-[10px] text-slate-400 font-bold">${u.user_id}${u.email && label !== u.user_id ? ' · ' + u.email : ''}</p>
        </td>
        ${checkboxes}
        <td class="px-6 py-4 text-right">
          <button id="perm-save-${u.user_id}" onclick="savePermRow('${u.user_id}')"
            class="px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all
                   bg-slate-100 text-slate-400 cursor-default"
            disabled>Saved</button>
        </td>
      </tr>`;
    }).join('');
    lucide.createIcons();
  }

  function togglePermChip(cb, color) {
    const chip = cb.parentElement.querySelector('span');
    if (!chip) return;
    if (cb.checked) {
      chip.style.background = color;
      chip.style.borderColor = color;
      chip.style.color = '#fff';
    } else {
      chip.style.background = '#f8fafc';
      chip.style.borderColor = '#e2e8f0';
      chip.style.color = '#94a3b8';
    }
  }

  function markPermRowDirty(userId) {
    const btn = document.getElementById(`perm-save-${userId}`);
    if (btn) {
      btn.disabled = false;
      btn.className = 'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-blue-600 text-white hover:bg-black cursor-pointer shadow-sm shadow-blue-500/20';
      btn.textContent = 'Save';
    }
  }

  function savePermRow(userId) {
    const checked = [...document.querySelectorAll(`.perm-cb-${userId}:checked`)].map(cb => cb.value);
    if (!checked.length) { showToast('Assign at least one role', 'error'); return; }
    const btn = document.getElementById(`perm-save-${userId}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    google.script.run
      .withSuccessHandler(() => {
        if (btn) {
          btn.className = 'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-emerald-500 text-white';
          btn.textContent = 'Saved ✓';
          setTimeout(() => {
            btn.className = 'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-slate-100 text-slate-400 cursor-default';
            btn.textContent = 'Saved';
          }, 2000);
        }
        const u = allUsersCache.find(u => u.user_id === userId);
        if (u) u.role = checked.join(',');
      })
      .withFailureHandler(() => {
        showToast('Failed to save roles for ' + userId, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
      })
      .updateAppUserRole(userId, checked.join(','));
  }

  function filterPermTable() {
    const q = (document.getElementById('permSearchInput')?.value || '').toLowerCase();
    const filtered = allUsersCache.filter(u =>
      u.user_id.toString().toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      staffLabel(u.user_id).toLowerCase().includes(q)
    );
    renderPermTable(filtered);
  }

  function loadAnalytics() {
    if (!_requireAdminRole()) return;
    setActiveNavLink('nav-analytics');
    document.getElementById('view-container').innerHTML = `<div class="flex flex-col items-center justify-center py-24 text-slate-300">
      <div class="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mb-6"><i data-lucide="bar-chart-3" class="h-10 w-10 text-slate-400"></i></div>
      <h2 class="text-xl font-black uppercase tracking-widest text-slate-600">Analytics Dashboard</h2>
      <p class="font-bold text-xs text-slate-400 mt-2 uppercase tracking-widest">Coming in next release</p>
    </div>`;
    lucide.createIcons();
  }


  // --- USER DATA LOAD ---
  function loadUserData() {
    google.script.run.withSuccessHandler(data => {
      allUsersCache = Array.isArray(data) ? data : [];
      renderUserTable(allUsersCache);
      
      // Update Committee Form Elements if they exist
      const dl = document.getElementById('userList');
      if (dl) dl.innerHTML = allUsersCache.map(u => `<option value="${staffLabel(u.user_id)} [${u.user_id}]">`).join('');

      const chairmanSelect = document.getElementById('commChairman');
      if (chairmanSelect) {
        const currentVal = chairmanSelect.value;
        chairmanSelect.innerHTML = '<option value="">Choose a Chairman...</option>' +
          allUsersCache.map(u => `<option value="${u.user_id}">${staffLabel(u.user_id)}</option>`).join('');
        chairmanSelect.value = currentVal;
      }
      lucide.createIcons();
    }).getAppUsers();
  }

  function renderUserTable(users) {
    const tbody = document.getElementById('userListBody');
    if (!tbody) return;
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-400 font-bold uppercase tracking-widest italic">No matching users found</td></tr>`;
      return;
    }
    const roleColors = { Teacher:'bg-blue-100 text-blue-600', Staff:'bg-slate-100 text-slate-500', HR:'bg-purple-100 text-purple-600', Admin:'bg-slate-900 text-white', Principal:'bg-indigo-100 text-indigo-600', VP:'bg-indigo-50 text-indigo-500' };
    tbody.innerHTML = users.map(u => {
      const roleBadges = (u.role || '').split(',').map(r => r.trim()).filter(Boolean).map(r =>
        `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${roleColors[r] || 'bg-slate-100 text-slate-400'}">${r}</span>`
      ).join('');
      const safeRole = (u.role || '').replace(/'/g, "\\'");
      return `
      <tr class="hover:bg-slate-50 transition-colors group/row">
        <td class="px-6 py-4"><p class="text-sm font-black text-slate-800 tracking-tight">${u.user_id}</p><p class="text-xs text-slate-400 font-bold uppercase">System ID</p></td>
        <td class="px-6 py-4"><p class="text-sm font-bold text-slate-600">${u.email}</p><p class="text-xs text-slate-400 font-bold">${u.phone || 'No Phone'}</p></td>
        <td class="px-6 py-4"><div class="flex flex-wrap gap-1">${roleBadges}</div></td>
        <td class="px-6 py-4 text-right">
          <div class="flex justify-end gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button onclick="resetPassword('${u.user_id}')" title="Reset Password" class="p-2 hover:bg-amber-50 text-amber-500 rounded-xl transition-all"><i data-lucide="key-round" class="h-4 w-4"></i></button>
            <button onclick="editRole('${u.user_id}', '${safeRole}')" title="Change Role" class="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-all"><i data-lucide="shield-check" class="h-4 w-4"></i></button>
            <button onclick="deleteUser('${u.user_id}')" title="Delete User" class="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-all"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');
    lucide.createIcons();
  }

  function loadUserData_forSystem() {
    const canEdit = ['HR','VP','Admin'].includes(window.ACTIVE_ROLE);
    google.script.run.withSuccessHandler(data => {
      allUsersCache = Array.isArray(data) ? data : [];
      // Populate committee dropdowns
      const dl = document.getElementById('userList');
      if (dl) dl.innerHTML = allUsersCache.map(u => `<option value="${staffLabel(u.user_id)} [${u.user_id}]">`).join('');
      const chairmanSelect = document.getElementById('commChairman');
      if (chairmanSelect) {
        chairmanSelect.innerHTML = '<option value="">Choose a Chairman…</option>' +
          allUsersCache.map(u => `<option value="${u.user_id}">${staffLabel(u.user_id)}</option>`).join('');
      }
      // Render user table for system view
      const tbody = document.getElementById('userListBody');
      if (!tbody) return;
      if (!allUsersCache.length) {
        tbody.innerHTML = `<tr><td colspan="${canEdit?5:4}" class="px-6 py-10 text-center text-slate-400 text-xs font-black uppercase tracking-widest italic">No users found</td></tr>`;
        lucide.createIcons(); return;
      }
      const roleColors = { Teacher:'bg-blue-100 text-blue-600', Staff:'bg-slate-100 text-slate-500', HR:'bg-purple-100 text-purple-600', Admin:'bg-slate-900 text-white', Principal:'bg-indigo-100 text-indigo-600', VP:'bg-indigo-50 text-indigo-500' };
      tbody.innerHTML = allUsersCache.map(u => {
        const roleBadges = (u.role||'').split(',').map(r=>r.trim()).filter(Boolean)
          .map(r=>`<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${roleColors[r]||'bg-slate-100 text-slate-400'}">${r}</span>`).join('');
        const isActive = u.is_active !== false;
        const statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${isActive?'bg-emerald-100 text-emerald-600':'bg-red-100 text-red-400'}">
          <span class="w-1.5 h-1.5 rounded-full ${isActive?'bg-emerald-500':'bg-red-400'}"></span>${isActive?'Active':'Inactive'}</span>`;
        const safeRole = (u.role||'').replace(/'/g,"\\'");
        const actions = canEdit ? `<td class="px-6 py-4 text-right">
          <div class="flex justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
            <button onclick="resetPassword('${u.user_id}')" title="Reset Password" class="p-2 hover:bg-amber-50 text-amber-500 rounded-xl transition-all"><i data-lucide="key-round" class="h-4 w-4"></i></button>
            <button onclick="editRole('${u.user_id}','${safeRole}')" title="Change Role" class="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-all"><i data-lucide="shield-check" class="h-4 w-4"></i></button>
            <button onclick="deleteUser('${u.user_id}')" title="Delete" class="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-all"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
          </div></td>` : '';
        return `<tr class="hover:bg-slate-50 transition-colors group/row">
          <td class="px-6 py-4"><p class="text-sm font-black text-slate-800">${u.user_id}</p><p class="text-[10px] text-slate-400 font-bold">${staffLabel(u.user_id)}</p></td>
          <td class="px-6 py-4"><p class="text-sm font-bold text-slate-600">${u.email||'—'}</p></td>
          <td class="px-6 py-4"><div class="flex flex-wrap gap-1">${roleBadges}</div></td>
          <td class="px-6 py-4">${statusBadge}</td>
          ${actions}
        </tr>`;
      }).join('');
      lucide.createIcons();
    }).getAppUsers();
  }

  function filterUserList() {
    const query = (document.getElementById('userSearchInput')?.value || '').toLowerCase();
    const filtered = allUsersCache.filter(u =>
      u.user_id.toString().toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query) ||
      (u.role || '').toLowerCase().includes(query)
    );
    renderUserTable(filtered);
  }

  // --- MODAL-BASED USER MANAGEMENT ---
  function resetPassword(userId) {
    document.getElementById('resetPassUserId').value = userId;
    document.getElementById('resetPassInput').value = '';
    document.getElementById('resetPassModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('resetPassInput').focus(), 100);
  }
  function closeResetPassModal() { document.getElementById('resetPassModal').classList.add('hidden'); }
  function confirmResetPassword() {
    const userId = document.getElementById('resetPassUserId').value;
    const newPass = document.getElementById('resetPassInput').value.trim();
    if (!newPass || newPass.length < 4) { showToast('Password must be at least 4 characters', 'error'); return; }
    closeResetPassModal();
    showLoading(true);
    google.script.run.withSuccessHandler(() => { showLoading(false); showToast('Password reset successfully'); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to reset password', 'error'); })
      .updateAppUserPassword(userId, newPass);
  }

  // ── CHANGE MY PASSWORD ───────────────────────────────────────────────────────
  function openChangeMyPassModal() {
    document.getElementById('chgPassCurrent').value = '';
    document.getElementById('chgPassNew').value = '';
    document.getElementById('chgPassConfirm').value = '';
    document.getElementById('chgPassError').classList.add('hidden');
    document.getElementById('changeMyPassModal').classList.remove('hidden');
  }
  function closeChangeMyPassModal() { document.getElementById('changeMyPassModal').classList.add('hidden'); }
  function confirmChangeMyPass() {
    const current  = document.getElementById('chgPassCurrent').value.trim();
    const newPass  = document.getElementById('chgPassNew').value.trim();
    const confirm  = document.getElementById('chgPassConfirm').value.trim();
    const errEl    = document.getElementById('chgPassError');
    const showErr  = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
    errEl.classList.add('hidden');
    if (!current) return showErr('Enter your current password.');
    if (newPass.length < 4) return showErr('New password must be at least 4 characters.');
    if (newPass !== confirm) return showErr('Passwords do not match.');
    closeChangeMyPassModal();
    showLoading(true);
    google.script.run
      .withSuccessHandler((result) => {
        showLoading(false);
        if (!result.success) {
          const msgs = { wrong_password: 'Current password is incorrect.', user_not_found: 'User not found.', update_failed: 'Failed to update password in database.' };
          showToast(msgs[result.reason] || 'Password change failed.', 'error');
          return;
        }
        if (window.APP_USER) { window.APP_USER.password = newPass; localStorage.setItem('ccpc_pass', newPass); }
        showToast('Password changed successfully');
      })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to change password', 'error'); })
      .changeMyPassword(window.APP_USER.user_id, current, newPass);
  }

  function editRole(userId, currentRole) {
    document.getElementById('editRoleUserId').value = userId;
    const current = currentRole.split(',').map(r => r.trim());
    document.querySelectorAll('#editRoleCheckboxes input[type=checkbox]').forEach(cb => { cb.checked = current.includes(cb.value); });
    document.getElementById('editRoleModal').classList.remove('hidden');
  }
  function closeEditRoleModal() { document.getElementById('editRoleModal').classList.add('hidden'); }
  function confirmEditRole() {
    const userId = document.getElementById('editRoleUserId').value;
    const checked = [...document.querySelectorAll('#editRoleCheckboxes input[type=checkbox]:checked')].map(cb => cb.value);
    if (!checked.length) { showToast('Select at least one role', 'error'); return; }
    closeEditRoleModal();
    showLoading(true);
    google.script.run.withSuccessHandler(() => { showLoading(false); showToast('Role updated!'); loadUserData(); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to update role', 'error'); })
      .updateAppUserRole(userId, checked.join(','));
  }

  function deleteUser(userId) {
    showConfirm(`Delete user ${userId}? This cannot be undone.`, () => {
      showLoading(true);
      google.script.run.withSuccessHandler(() => { showLoading(false); showToast('User deleted'); loadUserData(); })
        .withFailureHandler(() => { showLoading(false); showToast('Failed to delete user', 'error'); })
        .deleteAppUser(userId);
    });
  }

  // --- USER FORM (multi-role checkbox) ---
  function initUserForm() {
    const form = document.getElementById('createUserForm');
    if (!form) return;
    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = {};
      fd.forEach((v, k) => data[k] = v);
      const checked = [...form.querySelectorAll('.role-cb:checked')].map(cb => cb.value);
      if (!checked.length) { showToast('Select at least one role', 'error'); return; }
      data.role = checked.join(',');
      showLoading(true);
      google.script.run.withSuccessHandler(() => {
        showLoading(false); showToast('User created!');
        form.reset();
        form.querySelectorAll('.role-cb').forEach(cb => cb.checked = false);
        loadUserData();
      }).withFailureHandler(() => { showLoading(false); showToast('Failed to create user', 'error'); })
        .saveAppUser(data);
    };
  }

  // ── CREATE USERS FROM PROFILES ───────────────────────────────────────────────
  let _allProfilesForPicker = [];

  function refreshProfileList() {
    const list = document.getElementById('profilePickerList');
    if (!list) return;
    list.innerHTML = '<p class="text-slate-400 text-xs font-bold text-center py-6">Loading profiles…</p>';
    google.script.run
      .withSuccessHandler(data => {
        if (data && data.error) {
          const l = document.getElementById('profilePickerList');
          if (l) l.innerHTML = `<tr><td colspan="${ALL_ROLES.length + 2}" class="px-4 py-8 text-center text-red-400 text-xs font-black uppercase tracking-widest">⚠ ${data.message || 'Failed to load profiles'} — Check table name in database.</td></tr>`;
          return;
        }
        _allProfilesForPicker = Array.isArray(data) ? data : [];
        renderProfilePicker(_allProfilesForPicker);
      })
      .withFailureHandler(() => {
        const l = document.getElementById('profilePickerList');
        if (l) l.innerHTML = `<tr><td colspan="${ALL_ROLES.length + 2}" class="px-4 py-8 text-center text-red-400 text-xs font-black uppercase tracking-widest">Failed to load profiles. Click Refresh to retry.</td></tr>`;
      })
      .getProfilesWithoutUsers();
  }

  const _profileRoleStyle = {
    Teacher:'#4f46e5', Staff:'#64748b', HR:'#9333ea',
    Principal:'#2563eb', VP:'#0891b2', Admin:'#e11d48'
  };

  function renderProfilePicker(profiles) {
    const tbody = document.getElementById('profilePickerList');
    if (!tbody) return;
    if (!profiles.length) {
      tbody.innerHTML = `<tr><td colspan="${ALL_ROLES.length + 2}" class="px-4 py-8 text-center text-slate-400 text-xs font-black uppercase tracking-widest">All profiles already have user accounts.</td></tr>`;
      updateBulkSelCount(); return;
    }
    tbody.innerHTML = profiles.map(s => {
      const id = s.teacher_id;
      const cat = (s.category || '').toLowerCase();
      const defaultRole = cat.includes('non') ? 'Staff' : cat.includes('teach') ? 'Teacher' : null;
      const roleCells = ALL_ROLES.map(r => {
        const color = _profileRoleStyle[r] || '#64748b';
        const defaultOn = r === defaultRole;
        return `<td class="px-2 py-3 text-center">
          <label class="inline-flex items-center justify-center cursor-pointer">
            <input type="checkbox" value="${r}" ${defaultOn ? 'checked' : ''}
              class="profile-role-cb-${id} hidden"
              onchange="togglePermChip(this,'${color}')">
            <span class="w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all text-[9px] font-black select-none"
              style="${defaultOn ? `background:${color};border-color:${color};color:#fff;` : 'background:#f8fafc;border-color:#e2e8f0;color:#94a3b8;'}">
              ${r.slice(0,2).toUpperCase()}
            </span>
          </label>
        </td>`;
      }).join('');
      return `<tr class="hover:bg-slate-50/60 transition-colors">
        <td class="px-4 py-3">
          <input type="checkbox" class="profile-pick-cb w-4 h-4 rounded accent-indigo-600" value="${id}" onchange="updateBulkSelCount()">
        </td>
        <td class="px-4 py-3">
          <p class="text-sm font-black text-slate-800">${s.full_name || id}</p>
          <p class="text-[10px] font-bold text-slate-400">${id}${s.designation ? ' · ' + s.designation : ''}${s.email ? ' · ' + s.email : ''}</p>
        </td>
        ${roleCells}
      </tr>`;
    }).join('');
    updateBulkSelCount();
    lucide.createIcons();
  }

  function filterProfileList() {
    const q = (document.getElementById('profileSearchInput')?.value || '').toLowerCase();
    const filtered = _allProfilesForPicker.filter(s =>
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.teacher_id || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.designation || '').toLowerCase().includes(q)
    );
    renderProfilePicker(filtered);
  }

  function toggleSelectAllProfiles(checked) {
    document.querySelectorAll('.profile-pick-cb').forEach(cb => { cb.checked = checked; });
    updateBulkSelCount();
  }

  function updateBulkSelCount() {
    const count = document.querySelectorAll('.profile-pick-cb:checked').length;
    const el = document.getElementById('bulkSelCount');
    if (el) el.textContent = count + ' selected';
  }

  function bulkCreateFromProfiles() {
    const selected = [...document.querySelectorAll('.profile-pick-cb:checked')].map(cb => cb.value);
    if (!selected.length) { showToast('Select at least one profile', 'error'); return; }
    const defaultPass = document.getElementById('bulkDefaultPass')?.value.trim();
    if (!defaultPass || defaultPass.length < 4) { showToast('Enter a default password (min 4 chars)', 'error'); return; }

    // Build per-profile role assignments
    const profiles = [];
    for (const id of selected) {
      const roles = [...document.querySelectorAll(`.profile-role-cb-${id}:checked`)].map(cb => cb.value);
      if (!roles.length) { showToast(`Select at least one role for profile ${id}`, 'error'); return; }
      const s = _allProfilesForPicker.find(s => s.teacher_id === id);
      profiles.push({ teacher_id: id, email: s?.email || '', role: roles.join(',') });
    }

    showLoading(true);
    google.script.run
      .withSuccessHandler(res => {
        showLoading(false);
        const msg = `${res.created.length} created` + (res.failed.length ? `, ${res.failed.length} failed` : '');
        showToast(msg, res.failed.length ? 'info' : 'success');
        loadUserData_forSystem();
        refreshProfileList();
        const selAll = document.getElementById('selectAllProfiles');
        if (selAll) selAll.checked = false;
        updateBulkSelCount();
      })
      .withFailureHandler(() => { showLoading(false); showToast('Bulk create failed', 'error'); })
      .bulkCreateUsersFromProfiles(profiles);
  }

  // ── TOAST & CONFIRM ──────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const icons = { success:'check-circle', error:'x-circle', info:'info' };
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i data-lucide="${icons[type]||'check-circle'}" class="h-4 w-4 shrink-0"></i><span>${msg}</span>`;
    c.appendChild(t);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => { t.style.transition='opacity .3s,transform .3s'; t.style.opacity='0'; t.style.transform='translateX(110%)'; setTimeout(() => t.remove(), 320); }, 3200);
  }

  function showConfirm(msg, onConfirm) {
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmModal').classList.remove('hidden');
    document.getElementById('confirmOkBtn').onclick = () => { closeConfirmModal(); onConfirm(); };
    lucide.createIcons();
  }
  function closeConfirmModal() { document.getElementById('confirmModal').classList.add('hidden'); }

  // ── STAFF REGISTRY ────────────────────────────────────────────────────────────
  function loadStaffData() {
    google.script.run
      .withSuccessHandler(data => {
        allStaffCache = Array.isArray(data) ? data : [];
        renderStaffTable();
        renderGradingGrid();
      })
      .withFailureHandler(err => console.error('Staff load failed:', err))
      .getAllStaffData(false, true);
  }

  function renderStaffTable() {
    const tbody = document.getElementById('staffTableBody');
    if (!tbody) return;
    if (!allStaffCache.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-16 text-center"><div class="flex flex-col items-center gap-3 text-slate-400"><i data-lucide="users" class="h-12 w-12 opacity-20"></i><p class="font-black uppercase tracking-widest text-xs">No faculty records found</p></div></td></tr>`;
      lucide.createIcons(); return;
    }
    tbody.innerHTML = allStaffCache.map(s => {
      const evalBadge = s.is_evaluatable
        ? `<span class="px-2 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-600 uppercase">Active</span>`
        : `<span class="px-2 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-400 uppercase">Inactive</span>`;
      const toggleBtn = s.is_evaluatable
        ? `<button onclick="toggleEval('${s.teacher_id}',false)" title="Deactivate" class="p-2 hover:bg-red-50 text-red-400 rounded-xl transition-all"><i data-lucide="user-x" class="h-4 w-4"></i></button>`
        : `<button onclick="toggleEval('${s.teacher_id}',true)" title="Activate" class="p-2 hover:bg-emerald-50 text-emerald-500 rounded-xl transition-all"><i data-lucide="user-check" class="h-4 w-4"></i></button>`;
      const safeName = (s.full_name||s.teacher_id).replace(/'/g,"\\'");
      return `<tr class="hover:bg-slate-50 transition-colors group/row">
        <td class="px-6 py-4"><p class="text-sm font-black text-slate-800">${s.teacher_id}</p><p class="text-xs text-slate-400 font-bold uppercase">${s.category||'Faculty'}</p></td>
        <td class="px-6 py-4"><p class="text-sm font-bold text-slate-800">${s.full_name||'<em class="text-slate-300">No Name</em>'}</p><p class="text-xs text-slate-400">${s.email||''}</p></td>
        <td class="px-6 py-4">${evalBadge}</td>
        <td class="px-6 py-4 text-right"><div class="flex justify-end gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button onclick="openDetailsModal('${s.teacher_id}')" title="View Profile" class="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-all"><i data-lucide="eye" class="h-4 w-4"></i></button>
          <button onclick="openRecordsModal('${s.teacher_id}','${safeName}')" title="Courses &amp; Bonus/Penalty" class="p-2 hover:bg-violet-50 text-violet-500 rounded-xl transition-all"><i data-lucide="clipboard-list" class="h-4 w-4"></i></button>
          ${toggleBtn}
          <button onclick="openTraceReport('${s.teacher_id}')" title="ACR Report" class="p-2 hover:bg-slate-100 text-slate-500 rounded-xl transition-all"><i data-lucide="file-bar-chart" class="h-4 w-4"></i></button>
        </div></td>
      </tr>`;
    }).join('');
    lucide.createIcons();
  }

  function filterStaffTable() {
    const q = (document.getElementById('staffSearchInput')?.value||'').toLowerCase();
    const orig = allStaffCache;
    allStaffCache = orig.filter(s => (s.teacher_id||'').toLowerCase().includes(q)||(s.full_name||'').toLowerCase().includes(q)||(s.category||'').toLowerCase().includes(q));
    renderStaffTable();
    allStaffCache = orig;
  }

  function toggleEval(teacherId, status) {
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => { showLoading(false); showToast(status?'Faculty activated for evaluation':'Faculty deactivated', status?'success':'info'); loadStaffData(); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to update status','error'); })
      .toggleEvaluatable(teacherId, status);
  }

  function openDetailsModal(teacherId) {
    showLoading(true);
    google.script.run.withSuccessHandler(data => {
      showLoading(false);
      if (!data) { showToast('No profile found','error'); return; }
      const c = document.getElementById('detailsContent');
      if (!c) return;
      const fam = Array.isArray(data.family_details) ? data.family_details : [];
      const attrs = Array.isArray(data.faculty_attributes) ? data.faculty_attributes : [];
      c.innerHTML = `
        <div class="grid grid-cols-2 gap-4 mb-6">
          ${[['Full Name',data.full_name],['Category',data.category],['Designation',data.designation],['Joining Date',data.joining_date?data.joining_date.split('T')[0]:'-'],['Nationality',data.nationality],['Blood Group',data.blood_group]].map(([l,v])=>`<div><p class="text-[10px] font-black text-slate-400 uppercase mb-1">${l}</p><p class="font-black text-slate-800">${v||'-'}</p></div>`).join('')}
          <div class="col-span-2"><p class="text-[10px] font-black text-slate-400 uppercase mb-1">Present Address</p><p class="font-bold text-slate-600">${data.present_address||'-'}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-1">Mobile</p><p class="font-bold text-slate-600">${data.mobile||'-'}</p></div>
          <div><p class="text-[10px] font-black text-slate-400 uppercase mb-1">Personal Email</p><p class="font-bold text-slate-600">${data.personal_email||'-'}</p></div>
        </div>
        ${fam.length?`<div class="border-t pt-4 mb-4"><p class="text-[10px] font-black text-slate-400 uppercase mb-3">Family</p><div class="space-y-2">${fam.map(f=>`<div class="flex justify-between text-sm"><span class="font-black text-slate-500">${f.member_type}</span><span class="font-bold text-slate-800">${f.name||'-'}</span></div>`).join('')}</div></div>`:''}
        ${attrs.length?`<div class="border-t pt-4"><p class="text-[10px] font-black text-slate-400 uppercase mb-3">Attributes</p><div class="flex flex-wrap gap-2">${attrs.map(a=>`<span class="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black text-slate-600">${a.header}: ${a.value}</span>`).join('')}</div></div>`:''}`;
      document.getElementById('detailsModal').classList.remove('hidden');
      lucide.createIcons();
    }).withFailureHandler(()=>{showLoading(false);showToast('Failed to load profile','error');})
      .getStaffDetails(teacherId);
  }
  function closeDetailsModal() { document.getElementById('detailsModal').classList.add('hidden'); }

  // ── GRADING GRID (Leadership view) ───────────────────────────────────────────
  function renderGradingGrid() {
    const grid = document.getElementById('gradingGrid');
    if (!grid) return;
    if (!allStaffCache.length) {
      grid.innerHTML = `<div class="col-span-3 flex flex-col items-center py-16 text-slate-400"><i data-lucide="users" class="h-12 w-12 opacity-20 mb-3"></i><p class="font-black uppercase tracking-widest text-xs">No evaluatable faculty</p></div>`;
      lucide.createIcons(); return;
    }
    const rc = {Teacher:'blue',Staff:'slate',HR:'purple',Admin:'slate',Principal:'indigo',VP:'indigo'};
    const thisYear = new Date().getFullYear().toString();
    let gradedCount=0, ioSum=0, ioCount=0;

    grid.innerHTML = allStaffCache.map(s => {
      const acr = Array.isArray(s.yearly_acr) ? s.yearly_acr : [];
      const latest = acr[acr.length-1] || {};
      const io = parseFloat(latest.io_marks||0), rv = parseFloat(latest.rv_marks||0), rp = parseFloat(latest.rp_marks||0);
      const total = (io+rv+rp).toFixed(1);
      if (latest.calendar_year === thisYear) { gradedCount++; }
      if (io > 0) { ioSum += io; ioCount++; }
      const initials = (s.full_name||'??').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const col = rc[s.category]||'blue';
      const safeRole = (s.full_name||'').replace(/'/g,"\\'");
      return `<div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
        <div class="flex items-center gap-4 mb-5">
          <div class="w-12 h-12 rounded-2xl bg-${col}-100 text-${col}-600 flex items-center justify-center font-black text-sm shrink-0">${initials}</div>
          <div class="flex-1 min-w-0"><p class="font-black text-slate-800 truncate">${s.full_name||'Unknown'}</p><p class="text-[10px] text-slate-400 font-bold uppercase">${s.teacher_id} · ${s.category||''}</p></div>
        </div>
        <div class="grid grid-cols-3 gap-2 mb-5">
          <div class="bg-slate-50 rounded-xl p-3 text-center"><p class="text-[9px] font-black text-slate-400 uppercase">IO</p><p class="font-black text-slate-800">${latest.io_marks||'—'}</p></div>
          <div class="bg-slate-50 rounded-xl p-3 text-center"><p class="text-[9px] font-black text-slate-400 uppercase">RV</p><p class="font-black text-slate-800">${latest.rv_marks||'—'}</p></div>
          <div class="bg-slate-50 rounded-xl p-3 text-center"><p class="text-[9px] font-black text-slate-400 uppercase">RP</p><p class="font-black text-slate-800">${latest.rp_marks||'—'}</p></div>
        </div>
        <div class="flex items-center justify-between gap-2">
          <div><p class="text-[9px] font-black text-slate-400 uppercase">Total ACR</p><p class="text-xl font-black text-${col}-600">${total}</p></div>
          <div class="flex gap-2">
            <button onclick="openModal('${s.teacher_id}','${safeRole}')" class="px-4 py-2 bg-${col}-600 text-white text-[10px] font-black rounded-xl hover:bg-black transition-all uppercase">Grade</button>
            <button onclick="openTraceReport('${s.teacher_id}')" class="px-3 py-2 bg-slate-100 text-slate-600 text-[10px] font-black rounded-xl hover:bg-slate-200 transition-all">ACR</button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Update stats
    const total = allStaffCache.length;
    const pending = total - gradedCount;
    const avgIO = ioCount ? (ioSum/ioCount).toFixed(1) : '—';
    ['stat-total','stat-graded','stat-avg-io','stat-pending'].forEach((id,i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = [total, gradedCount, avgIO, pending][i];
    });
    lucide.createIcons();
  }

  function filterGradingGrid() {
    const q = (document.getElementById('gradingSearchInput')?.value||'').toLowerCase();
    const orig = allStaffCache;
    allStaffCache = orig.filter(s=>(s.teacher_id||'').toLowerCase().includes(q)||(s.full_name||'').toLowerCase().includes(q));
    renderGradingGrid();
    allStaffCache = orig;
  }

  function openModal(teacherId, teacherName) {
    google.script.run.withSuccessHandler(acr => {
      const existing = Array.isArray(acr) && acr.length ? acr[acr.length-1] : {};
      document.getElementById('gradeTeacherId').value = teacherId;
      document.getElementById('modalTeacherName').textContent = teacherName;
      document.getElementById('gradeCalendarYear').value = existing.calendar_year || new Date().getFullYear();
      document.getElementById('gradeYearNum').value = existing.year_num || (Array.isArray(acr) ? acr.length+1 : 1);
      document.getElementById('gradeIO').value = existing.io_marks || '';
      document.getElementById('gradeRV').value = existing.rv_marks || '';
      document.getElementById('gradeRP').value = existing.rp_marks || '';
      document.getElementById('gradePET').value = existing.pet_marks || '';
      document.getElementById('gradeModal').classList.remove('hidden');
      document.getElementById('gradingForm').onsubmit = e => {
        e.preventDefault(); showLoading(true);
        const payload = { teacher_id:teacherId, calendar_year:document.getElementById('gradeCalendarYear').value, year_num:parseInt(document.getElementById('gradeYearNum').value), io_marks:parseFloat(document.getElementById('gradeIO').value)||0, rv_marks:parseFloat(document.getElementById('gradeRV').value)||0, rp_marks:parseFloat(document.getElementById('gradeRP').value)||0, pet_marks:parseFloat(document.getElementById('gradePET').value)||0 };
        google.script.run.withSuccessHandler(()=>{ showLoading(false); closeModal(); showToast('Marks saved!'); loadStaffData(); })
          .withFailureHandler(()=>{ showLoading(false); showToast('Failed to save marks','error'); })
          .saveYearlyAcr(payload);
      };
    }).withFailureHandler(()=>{
      // Still open modal with blank fields
      document.getElementById('gradeTeacherId').value = teacherId;
      document.getElementById('modalTeacherName').textContent = teacherName;
      document.getElementById('gradeModal').classList.remove('hidden');
    }).getTeacherAcr(teacherId);
  }
  function closeModal() { document.getElementById('gradeModal').classList.add('hidden'); }

  function openTraceReport(teacherId) {
    showLoading(true);
    google.script.run.withSuccessHandler(html => {
      document.getElementById('view-container').innerHTML = html;
      loadTraceReport(teacherId);
      showLoading(false);
      lucide.createIcons();
    }).withFailureHandler(()=>{ showLoading(false); showToast('Failed to load report','error'); })
      .getViewContent('TraceReport');
  }

  function loadTraceReport(teacherId) {
    google.script.run.withSuccessHandler(report => {
      if (!report) return;
      const el = id => document.getElementById(id);
      if (el('rep-name')) el('rep-name').textContent = report.profile.full_name||'Unknown';
      if (el('rep-id'))   el('rep-id').textContent   = 'ID: '+(report.profile.teacher_id||'');
      const tbody = el('trace-yearly-body');
      if (tbody) {
        let rows = '';
        for (let i=1; i<=30; i++) {
          const yr = report.yearlyData.find(y=>y.year_num===i);
          if (yr) { const t=(parseFloat(yr.io_marks||0)+parseFloat(yr.rv_marks||0)+parseFloat(yr.rp_marks||0)).toFixed(1); rows+=`<tr class="${yr.is_exempt?'bg-slate-50 text-slate-400 italic':''}"><td class="border border-slate-100 px-2 py-1.5 text-center">${i}</td><td class="border border-slate-100 px-2 py-1.5 text-center">${yr.calendar_year||'-'}</td><td class="border border-slate-100 px-2 py-1.5 text-center text-blue-600 font-black">${yr.io_marks||0}</td><td class="border border-slate-100 px-2 py-1.5 text-center">${yr.rv_marks||0}</td><td class="border border-slate-100 px-2 py-1.5 text-center">${yr.rp_marks||0}</td><td class="border border-slate-100 px-2 py-1.5 text-center text-emerald-600">${yr.pet_marks||0}</td><td class="border border-slate-100 px-2 py-1.5 text-center font-black">${t}</td><td class="border border-slate-100 px-2 py-1.5 text-center">${yr.is_exempt?'Exempt':'Active'}</td></tr>`; }
          else { rows+=`<tr class="text-slate-300"><td class="border border-slate-100 px-2 py-1.5 text-center">${i}</td>${Array(7).fill('<td class="border border-slate-100 px-2 py-1.5 text-center">—</td>').join('')}</tr>`; }
        }
        tbody.innerHTML = rows;
      }
      const ctbody = el('trace-course-body');
      if (ctbody) ctbody.innerHTML = (report.courses||[]).map(c=>`<tr class="border-b border-slate-100"><td class="py-1 font-bold">${c.course_name||'-'}</td><td class="py-1 text-center">${c.obtained_marks}/${c.full_marks}</td><td class="py-1 text-center font-black text-blue-600">${c.weight_allotted}</td></tr>`).join('');
      const bpList = el('trace-bp-list');
      if (bpList) bpList.innerHTML = (report.bonusPenalty||[]).map(b=>`<div class="flex justify-between text-[10px] font-bold ${b.type==='Bonus'?'text-emerald-600':'text-red-500'}"><span>${b.description||b.type}</span><span>${b.type==='Bonus'?'+':'-'}${b.amount}</span></div>`).join('');
      const s = report.summary||{};
      ['sum-acr','sum-pet','sum-course','sum-comm','sum-bonus','sum-penalty','sum-final'].forEach((id,i)=>{
        const vals=[s.acrScore,s.petScore,s.courseScore,s.commScore,s.bonusTotal,s.penaltyTotal,s.finalTotal];
        if (el(id)) el(id).textContent = (vals[i]||0).toFixed ? (vals[i]||0).toFixed(3) : (vals[i]||0);
      });
      if (el('sum-comm-display')) el('sum-comm-display').textContent = (s.commScore||0).toFixed(3);
    }).getTeacherTraceReport(teacherId);
  }

  // ── SETTINGS TAB ─────────────────────────────────────────────────────────────
  function initSettingsTab() {
    google.script.run.withSuccessHandler(settings => {
      const tab = document.getElementById('hr-settings-content');
      if (!tab) return;
      const threshold = (settings && settings.committee_threshold) || 2;
      const weights = (settings && settings.committee_weights) || { member_eval:20, chairman_eval:30, admin_eval:50 };
      tab.innerHTML = `<div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
        <h3 class="text-lg font-black text-slate-800 mb-1">Global Evaluation Parameters</h3>
        <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-8">Changes take effect on next score calculation</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div class="space-y-6">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest">Committee Settings</h4>
            <div class="space-y-2">
              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Committee Threshold</label>
              <p class="text-[10px] text-slate-400 italic">Max evaluations before averaging</p>
              <input type="number" id="set-threshold" value="${threshold}" min="1" max="10" class="w-full px-4 py-4 bg-slate-50 border-none rounded-2xl font-black text-2xl focus:ring-2 focus:ring-blue-600 outline-none text-center">
            </div>
          </div>
          <div class="space-y-4">
            <h4 class="text-xs font-black text-slate-400 uppercase tracking-widest">Committee Weights (%)</h4>
            <div class="space-y-1"><div class="flex justify-between text-[10px] font-black text-slate-400 uppercase mb-1"><span>Member Evaluation</span><span id="set-member-val">${weights.member_eval}%</span></div><input type="range" id="set-member" min="0" max="100" value="${weights.member_eval}" oninput="syncWeights()" class="w-full accent-blue-600"></div>
            <div class="space-y-1"><div class="flex justify-between text-[10px] font-black text-slate-400 uppercase mb-1"><span>Chairman Evaluation</span><span id="set-chair-val">${weights.chairman_eval}%</span></div><input type="range" id="set-chair" min="0" max="100" value="${weights.chairman_eval}" oninput="syncWeights()" class="w-full accent-blue-600"></div>
            <div class="space-y-1"><div class="flex justify-between text-[10px] font-black text-slate-400 uppercase mb-1"><span>Admin Evaluation</span><span id="set-admin-val">${weights.admin_eval}%</span></div><input type="range" id="set-admin" min="0" max="100" value="${weights.admin_eval}" oninput="syncWeights()" class="w-full accent-blue-600"></div>
            <div id="set-weight-error" class="text-[10px] font-black text-red-500 hidden pt-1">Weights must total exactly 100%</div>
          </div>
        </div>
        <div class="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
          <span id="weight-total-display" class="text-xs font-black text-slate-500">Total: ${parseInt(weights.member_eval)+parseInt(weights.chairman_eval)+parseInt(weights.admin_eval)}%</span>
          <button onclick="saveSettings()" class="px-8 py-3 bg-blue-600 text-white text-[10px] font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest shadow-lg shadow-blue-500/20">Save Settings</button>
        </div>
      </div>`;
    }).withFailureHandler(() => {
      const tab = document.getElementById('hr-settings-content');
      if (tab) tab.innerHTML = `<div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm text-center text-slate-400"><p class="font-black uppercase tracking-widest text-xs">Failed to load settings</p></div>`;
    }).getSystemSettings();
  }

  function syncWeights() {
    const m=parseInt(document.getElementById('set-member')?.value||0), c=parseInt(document.getElementById('set-chair')?.value||0), a=parseInt(document.getElementById('set-admin')?.value||0), total=m+c+a;
    document.getElementById('set-member-val').textContent=m+'%';
    document.getElementById('set-chair-val').textContent=c+'%';
    document.getElementById('set-admin-val').textContent=a+'%';
    document.getElementById('weight-total-display').textContent='Total: '+total+'%';
    const err = document.getElementById('set-weight-error');
    if (err) err.classList.toggle('hidden', total===100);
  }

  function saveSettings() {
    const threshold=document.getElementById('set-threshold')?.value;
    const m=parseInt(document.getElementById('set-member')?.value||0), c=parseInt(document.getElementById('set-chair')?.value||0), a=parseInt(document.getElementById('set-admin')?.value||0);
    if (m+c+a!==100) { showToast('Weights must total 100%','error'); return; }
    showLoading(true);
    google.script.run.withSuccessHandler(()=>{ showLoading(false); showToast('Settings saved!'); })
      .withFailureHandler(()=>{ showLoading(false); showToast('Failed to save settings','error'); })
      .updateSystemSettings({ committee_threshold:threshold, committee_weights:{member_eval:m,chairman_eval:c,admin_eval:a} });
  }

  // ── COMMITTEE CARDS (Teacher's "My Assignments" view) ────────────────────────
  function renderMyCommitteeCards() {
    const grid = document.getElementById('committeeCards');
    if (!grid) return;
    grid.innerHTML = `<div class="col-span-3 text-center py-12 text-slate-400"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div><p class="text-xs font-black uppercase tracking-widest">Loading...</p></div>`;
    google.script.run.withSuccessHandler(groups => {
      if (!Array.isArray(groups) || !groups.length) {
        grid.innerHTML = `<div class="col-span-3 flex flex-col items-center py-16 text-slate-400"><i data-lucide="shield-off" class="h-12 w-12 opacity-20 mb-3"></i><p class="font-black uppercase tracking-widest text-xs">No committee assignments</p></div>`;
        lucide.createIcons(); return;
      }
      const myId = window.APP_USER && window.APP_USER.user_id;
      const myGroups = groups.filter(g => Array.isArray(g.members_list) && g.members_list.some(m => m.user_id === myId));
      if (!myGroups.length) {
        grid.innerHTML = `<div class="col-span-3 flex flex-col items-center py-16 text-slate-400"><i data-lucide="shield-off" class="h-12 w-12 opacity-20 mb-3"></i><p class="font-black uppercase tracking-widest text-xs">Not assigned to any committee</p></div>`;
        lucide.createIcons(); return;
      }
      grid.innerHTML = myGroups.map(g => {
        const members = g.members_list||[];
        const isChairman = members.length && members[0].user_id === myId;
        const safeMembers = JSON.stringify(members).replace(/"/g,'&quot;');
        const safeName = (g.committee_name||'').replace(/'/g,"\\'");
        const safeSub = (g.sub_committee||'').replace(/'/g,"\\'");
        return `<div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
          <div class="flex items-start justify-between mb-5">
            <div><h3 class="font-black text-slate-800 text-lg">${g.committee_name}</h3>${g.sub_committee?`<p class="text-[10px] text-slate-400 font-bold uppercase mt-1">${g.sub_committee}</p>`:''}</div>
            ${isChairman?`<span class="px-3 py-1 bg-amber-100 text-amber-600 text-[10px] font-black uppercase rounded-full">Chairman</span>`:`<span class="px-3 py-1 bg-blue-100 text-blue-600 text-[10px] font-black uppercase rounded-full">Member</span>`}
          </div>
          <div class="flex items-center gap-2 mb-5 text-sm font-bold text-slate-500"><i data-lucide="users" class="h-4 w-4"></i><span>${members.length} Member${members.length!==1?'s':''}</span></div>
          <div class="flex gap-2 mt-2">
            <button onclick="openCommEvalModal(${g.id},'${safeName}','${safeSub}',JSON.parse(this.dataset.members))" data-members="${safeMembers}" class="flex-1 py-3 bg-blue-600 text-white text-[10px] font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest">Evaluate</button>
            <button onclick="openCommChat(${g.id},'${safeName}','${safeSub}')" class="flex items-center gap-1.5 justify-center px-4 py-3 bg-emerald-600 text-white text-[10px] font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest"><i data-lucide="message-circle" class="h-3.5 w-3.5"></i> Chat</button>
          </div>
        </div>`;
      }).join('');
      lucide.createIcons();
    }).withFailureHandler(()=>{ if (grid) grid.innerHTML=''; showToast('Failed to load committees','error'); })
      .getUserCommittees();
  }

  function openCommEvalModal(commId, name, sub, members) {
    document.getElementById('modalCommName').textContent = name;
    document.getElementById('modalCommSub').textContent = sub||'';
    const myId = window.APP_USER && window.APP_USER.user_id;
    const targets = (members||[]).filter(m => m.user_id !== myId);
    document.getElementById('commMemberList').innerHTML = targets.length
      ? targets.map(m=>`<div class="flex items-center justify-between p-4 bg-slate-50 rounded-2xl"><div><p class="font-black text-slate-800">${m.name||m.user_id}</p><p class="text-[10px] text-slate-400 font-bold uppercase">${m.role||'Member'}</p></div><div class="flex items-center gap-3"><label class="text-[10px] font-black text-slate-400 uppercase">Score 0–5</label><input type="number" min="0" max="5" step="0.5" placeholder="0" class="w-20 px-3 py-2 bg-white border border-slate-200 rounded-xl font-black text-center focus:ring-2 focus:ring-blue-600 outline-none" onchange="submitCommEval(${commId},'${m.user_id}',this.value,'${(m.role||'member').toLowerCase()}')"></div></div>`).join('')
      : `<p class="text-center text-slate-400 font-bold py-6 text-xs">No other members to evaluate</p>`;
    document.getElementById('commEvalModal').classList.remove('hidden');
    lucide.createIcons();
  }
  function closeCommEvalModal() { document.getElementById('commEvalModal').classList.add('hidden'); }

  function submitCommEval(commId, evaluatedId, marks, evaluatorRole) {
    google.script.run.withSuccessHandler(()=>showToast('Evaluation submitted'))
      .withFailureHandler(()=>showToast('Failed to submit','error'))
      .saveCommitteeEvalNew({ committee_id:commId, evaluated_id:evaluatedId, evaluated_by_id:window.APP_USER&&window.APP_USER.user_id, evaluator_role:evaluatorRole, marks:parseFloat(marks)||0 });
  }

  // ── COMMITTEE FORM (HR view) ──────────────────────────────────────────────────
  function initCommitteeForm() {
    const form = document.getElementById('createCommForm');
    if (!form) return;
    const memberInput = document.getElementById('commMemberSearch');
    const selectedDiv = document.getElementById('selectedMembers');
    let selectedIds = [];
    if (memberInput) {
      memberInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = memberInput.value.trim();
        // Match by user_id, email, or the datalist format "Name — Designation [user_id]"
        const idInBrackets = val.match(/\[([^\]]+)\]$/);
        const user = allUsersCache.find(u =>
          u.user_id === val || u.email === val ||
          (idInBrackets && u.user_id === idInBrackets[1])
        );
        if (user && !selectedIds.includes(user.user_id)) { selectedIds.push(user.user_id); renderSelectedMembers(selectedDiv, selectedIds); memberInput.value=''; }
      });
    }
    form.onsubmit = e => {
      e.preventDefault();
      const chairmanId = document.getElementById('commChairman')?.value;
      if (!chairmanId) { showToast('Please select a Chairman','error'); return; }
      const membersList = [{ user_id:chairmanId, role:'chairman', name:staffLabel(chairmanId) }, ...selectedIds.filter(id=>id!==chairmanId).map(id=>({ user_id:id, role:'member', name:staffLabel(id) }))];
      const fd = new FormData(form);
      showLoading(true);
      google.script.run.withSuccessHandler(()=>{ showLoading(false); showToast('Committee created!'); form.reset(); selectedIds=[]; renderSelectedMembers(selectedDiv,[]); loadCommitteeData(); })
        .withFailureHandler(()=>{ showLoading(false); showToast('Failed to create committee','error'); })
        .createCommittee({ committee_name:fd.get('committee_name'), sub_committee:fd.get('sub_committee')||null, members_list:membersList });
    };
  }

  function renderSelectedMembers(div, ids) {
    if (!div) return;
    if (!ids.length) { div.innerHTML=`<p class="text-slate-400 text-[10px] font-bold uppercase italic self-center mx-auto">No members added yet</p>`; return; }
    div.innerHTML = ids.map(id=>`<span class="flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black">${staffLabel(id)}<button type="button" onclick="this.parentElement.remove()" class="hover:text-red-500 font-black">×</button></span>`).join('');
  }

  function loadCommitteeData() {
    google.script.run.withSuccessHandler(groups => {
      const tbody = document.getElementById('committeeListBody');
      if (!tbody) return;
      if (!Array.isArray(groups) || !groups.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-12 text-center text-slate-400 text-xs font-black uppercase tracking-widest">No committees registered</td></tr>`;
        return;
      }
      const myId   = window.APP_USER && window.APP_USER.user_id;
      const myRole = window.ACTIVE_ROLE;
      const canEditAll = ['Admin','HR','VP'].includes(myRole);
      tbody.innerHTML = groups.map(g => {
        const m   = g.members_list || [];
        const ch  = m[0];
        const isChairman   = myId && ch && ch.user_id === myId;
        const canEditThis  = canEditAll || isChairman;
        const members      = m.slice(1);
        const canChat = canEditAll || m.some(x => x.user_id === myId) || ['Principal'].includes(myRole);
        const safeName = (g.committee_name||'').replace(/'/g,"\\'");
        const actionCell = `<td class="px-4 py-4">
          <div class="flex items-center justify-end gap-2">
            ${canChat ? `<button onclick="openCommChat(${g.id},'${safeName}')" class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="message-circle" class="h-3 w-3"></i> Chat
            </button>` : ''}
            ${canEditThis ? `<button onclick="openCommitteeEdit(${g.id})" class="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="pencil" class="h-3 w-3"></i> Edit
            </button>` : ''}
          </div>
        </td>`;
        return `<tr class="hover:bg-slate-50 border-b border-slate-100">
          <td class="px-6 py-4">
            <p class="font-black text-slate-800 text-sm">${g.committee_name}</p>
            ${g.sub_committee ? `<p class="text-[10px] text-slate-400 font-bold mt-0.5">${g.sub_committee}</p>` : ''}
          </td>
          <td class="px-6 py-4">
            <span class="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-black">${ch?.name || ch?.user_id || '—'}</span>
          </td>
          <td class="px-6 py-4">
            <div class="flex flex-wrap gap-1">${members.map(x => `<span class="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold">${x.name || x.user_id}</span>`).join('')}</div>
          </td>
          ${actionCell}
        </tr>`;
      }).join('');
      _committeeCache = groups;
      lucide.createIcons();
    }).getUserCommittees();
  }

  // Store committees data for edit lookup
  let _committeeCache = [];
  function _refreshCommitteeCache(cb) {
    google.script.run.withSuccessHandler(groups => {
      _committeeCache = Array.isArray(groups) ? groups : [];
      if (cb) cb();
    }).getUserCommittees();
  }

  function openCommitteeEdit(id) {
    // Find from cache or re-fetch
    const open = (groups) => {
      const g = groups.find(x => x.id === id);
      if (!g) { showToast('Committee not found', 'error'); return; }
      const m = g.members_list || [];
      const ch = m[0];
      document.getElementById('commEditId').value  = g.id;
      document.getElementById('commEditName').value = g.committee_name || '';
      document.getElementById('commEditSub').value  = g.sub_committee  || '';

      // Populate chairman select
      const chairSel = document.getElementById('commEditChairman');
      chairSel.innerHTML = '<option value="">Choose a Chairman…</option>' +
        (allUsersCache || []).map(u => `<option value="${u.user_id}" ${ch && ch.user_id===u.user_id?'selected':''}>${u.full_name||u.user_id} (${u.user_id})</option>`).join('');

      // Populate datalist for member search
      const dl = document.getElementById('userListEdit');
      dl.innerHTML = (allUsersCache || []).map(u => `<option value="${u.full_name||u.user_id} — ${u.designation||''} [${u.user_id}]">`).join('');

      // Render existing members (exclude chairman)
      _editMemberIds = m.slice(1).map(x => x.user_id);
      _renderEditMembers();

      // Wire member search Enter key
      const ms = document.getElementById('commEditMemberSearch');
      ms.oninput = null;
      ms.onkeydown = e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = ms.value.trim();
        const idInBrackets = val.match(/\[([^\]]+)\]$/);
        const u = (allUsersCache || []).find(u =>
          u.user_id === val || u.email === val ||
          (idInBrackets && u.user_id === idInBrackets[1])
        );
        if (u && !_editMemberIds.includes(u.user_id)) {
          _editMemberIds.push(u.user_id);
          _renderEditMembers();
          ms.value = '';
        }
      };

      document.getElementById('commEditModal').style.display = '';
    };

    if (_committeeCache.length) { open(_committeeCache); }
    else { _refreshCommitteeCache(() => open(_committeeCache)); }
  }

  let _editMemberIds = [];
  function _renderEditMembers() {
    const div = document.getElementById('commEditMembers');
    if (!div) return;
    if (!_editMemberIds.length) { div.innerHTML = `<p class="text-slate-400 text-[10px] font-bold italic self-center">No additional members</p>`; return; }
    div.innerHTML = _editMemberIds.map(id => {
      const u = (allUsersCache || []).find(x => x.user_id === id);
      const label = u ? (u.full_name || u.user_id) : id;
      return `<span class="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black">
        ${label}
        <button type="button" onclick="_editMemberIds.splice(_editMemberIds.indexOf('${id}'),1);_renderEditMembers();" class="hover:text-red-500 font-black leading-none">×</button>
      </span>`;
    }).join('');
  }

  function closeCommitteeEdit() {
    document.getElementById('commEditModal').style.display = 'none';
    _editMemberIds = [];
  }

  function saveCommitteeEdit() {
    const id          = parseInt(document.getElementById('commEditId').value);
    const name        = document.getElementById('commEditName').value.trim();
    const sub         = document.getElementById('commEditSub').value.trim() || null;
    const chairmanId  = document.getElementById('commEditChairman').value;
    if (!name)       { showToast('Committee name is required', 'error'); return; }
    if (!chairmanId) { showToast('Please select a Chairman', 'error'); return; }
    const chairUser   = (allUsersCache || []).find(u => u.user_id === chairmanId);
    const membersList = [
      { user_id: chairmanId, role: 'chairman', name: chairUser ? (chairUser.full_name || chairmanId) : chairmanId },
      ..._editMemberIds.filter(mid => mid !== chairmanId).map(mid => {
        const u = (allUsersCache || []).find(x => x.user_id === mid);
        return { user_id: mid, role: 'member', name: u ? (u.full_name || mid) : mid };
      })
    ];
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => {
        showLoading(false);
        showToast('Committee updated!');
        closeCommitteeEdit();
        _committeeCache = [];
        loadCommitteeData();
      })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to update committee', 'error'); })
      .updateCommittee(id, { committee_name: name, sub_committee: sub, members_list: membersList });
  }

  // ══════════════════════════════════════════════════════════════
  // COMMITTEE CHAT
  // ══════════════════════════════════════════════════════════════

  const _chatPalette = ['#e11d48','#d97706','#059669','#0284c7','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#4f46e5','#9333ea','#b45309'];
  function _chatColor(userId) {
    let h = 0;
    for (let i = 0; i < (userId||'').length; i++) h = (h * 31 + userId.charCodeAt(i)) & 0x7fffffff;
    return _chatPalette[h % _chatPalette.length];
  }
  function _chatFmt(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-BD',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('en-BD',{hour:'2-digit',minute:'2-digit',hour12:true});
  }
  function _escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _escJs(s)   { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n'); }

  // State
  let _chatCommId  = null;
  let _chatReplyTo = null;
  let _chatAliases = {};   // { user_id: 'ShortName' }
  let _chatMembers = [];   // committee members_list array

  // Display name: alias > full name > user_id
  function _displayName(userId) {
    if (_chatAliases[userId]) return _chatAliases[userId];
    const m = _chatMembers.find(x => x.user_id === userId);
    return m ? (m.name || userId) : userId;
  }

  // Find member by alias OR name (for @ mention lookup)
  function _memberByMention(word) {
    const w = word.toLowerCase();
    return _chatMembers.find(m => {
      const alias = (_chatAliases[m.user_id] || '').toLowerCase();
      const name  = (m.name || '').toLowerCase();
      return (alias && alias === w) || name === w || m.user_id === w;
    });
  }

  // Render message text: escape HTML then colorize @mentions
  function _renderText(raw) {
    return raw.split(/(@\S+)/g).map(part => {
      if (!part.startsWith('@')) return _escHtml(part);
      const word   = part.slice(1);
      const member = _memberByMention(word);
      const color  = member ? _chatColor(member.user_id) : '#64748b';
      return `<span style="color:${color};font-weight:900;">@${_escHtml(word)}</span>`;
    }).join('');
  }

  function _ensureChatModal() {
    if (document.getElementById('commChatModal')) return;
    const el = document.createElement('div');
    el.id = 'commChatModal';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:9100;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);';
    el.innerHTML = `
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(620px,97vw);height:min(760px,92vh);display:flex;flex-direction:column;background:#fff;border-radius:1.75rem;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.25);">

        <!-- ── Header ── -->
        <div style="flex-shrink:0;padding:1rem 1.25rem;background:linear-gradient(135deg,#1e3a5f,#1d4ed8);color:#fff;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
            <div style="display:flex;align-items:center;gap:.6rem;min-width:0;">
              <div style="width:2rem;height:2rem;border-radius:.6rem;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i data-lucide="message-circle" style="width:1rem;height:1rem;"></i>
              </div>
              <div style="min-width:0;">
                <p id="chatCommName" style="font-weight:900;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></p>
                <p id="chatCommSub"  style="font-size:.58rem;opacity:.7;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-top:.1rem;"></p>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0;">
              <button onclick="toggleAliasPanel()" title="Member short names"
                style="height:1.9rem;padding:0 .7rem;border-radius:.5rem;background:rgba(255,255,255,.15);color:#fff;border:none;cursor:pointer;font-size:.6rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">
                👥 Short Names
              </button>
              <button onclick="closeCommChat()"
                style="width:1.9rem;height:1.9rem;border-radius:.5rem;background:rgba(255,255,255,.15);color:#fff;font-size:1.1rem;font-weight:900;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;line-height:1;">×</button>
            </div>
          </div>
        </div>

        <!-- ── Alias editor panel (collapsible) ── -->
        <div id="chatAliasPanel" style="display:none;flex-shrink:0;background:#f0f9ff;border-bottom:1px solid #bae6fd;padding:.6rem 1rem;overflow-x:auto;">
          <p style="font-size:.58rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#0369a1;margin-bottom:.4rem;">Set short names — visible to all members</p>
          <div id="chatAliasList" style="display:flex;gap:.5rem;flex-wrap:wrap;"></div>
        </div>

        <!-- ── Messages area ── -->
        <div id="chatMsgArea" style="flex:1;overflow-y:auto;padding:1rem;background:#f8fafc;display:flex;flex-direction:column;gap:.6rem;">
          <p style="text-align:center;color:#94a3b8;font-size:.7rem;font-weight:700;padding:2rem 0;">Loading messages…</p>
        </div>

        <!-- ── Reply bar ── -->
        <div id="chatReplyBar" style="display:none;flex-shrink:0;padding:.45rem 1rem;background:#eff6ff;border-top:2px solid #bfdbfe;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
            <p style="font-size:.68rem;font-weight:700;color:#1d4ed8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ↩ <strong id="chatReplyToName"></strong>: <span id="chatReplyToText" style="opacity:.7;"></span>
            </p>
            <button onclick="cancelChatReply()" style="font-size:.9rem;font-weight:900;color:#64748b;background:none;border:none;cursor:pointer;flex-shrink:0;">×</button>
          </div>
        </div>

        <!-- ── Input area (relative for dropdown) ── -->
        <div style="flex-shrink:0;position:relative;background:#fff;border-top:1px solid #e2e8f0;">
          <!-- @mention dropdown -->
          <div id="chatMentionDrop" style="display:none;position:absolute;bottom:100%;left:0;right:0;background:#fff;border:1px solid #e2e8f0;border-radius:.75rem .75rem 0 0;overflow:hidden;box-shadow:0 -6px 20px rgba(0,0,0,.1);max-height:11rem;overflow-y:auto;z-index:1;">
          </div>
          <div style="display:flex;align-items:flex-end;gap:.5rem;padding:.65rem .9rem;">
            <textarea id="chatInput" rows="2"
              placeholder="Type a message… Enter sends · Shift+Enter new line · @ to mention"
              style="flex:1;resize:none;padding:.55rem .8rem;background:#f1f5f9;border:none;border-radius:.9rem;font-size:.8rem;font-weight:600;color:#1e293b;outline:none;line-height:1.5;font-family:inherit;"
              oninput="_onChatInput(this)"
              onkeydown="_onChatKeydown(event)"></textarea>
            <button onclick="sendCommitteeChatMessage()"
              style="flex-shrink:0;width:2.4rem;height:2.4rem;border-radius:.8rem;background:#2563eb;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <i data-lucide="send" style="width:.9rem;height:.9rem;"></i>
            </button>
          </div>
        </div>

      </div>`;
    document.body.appendChild(el);
    lucide.createIcons();
  }

  // ── Open / close ──────────────────────────────────────────────
  function openCommChat(committeeId, committeeName, sub) {
    _ensureChatModal();
    _chatCommId  = committeeId;
    _chatReplyTo = null;
    _chatAliases = {};
    _chatMembers = [];
    document.getElementById('chatCommName').textContent = committeeName || 'Committee Chat';
    document.getElementById('chatCommSub').textContent  = sub || '';
    document.getElementById('chatReplyBar').style.display   = 'none';
    document.getElementById('chatAliasPanel').style.display = 'none';
    document.getElementById('chatMentionDrop').style.display = 'none';
    document.getElementById('chatInput').value = '';
    document.getElementById('commChatModal').style.display  = '';
    _loadChatMessages();
  }

  function closeCommChat() {
    const m = document.getElementById('commChatModal');
    if (m) m.style.display = 'none';
    _chatCommId = null; _chatReplyTo = null;
  }

  // ── Load messages (also pulls aliases + members) ──────────────
  function _loadChatMessages() {
    const area = document.getElementById('chatMsgArea');
    if (!area) return;
    area.innerHTML = `<p style="text-align:center;color:#94a3b8;font-size:.7rem;font-weight:700;padding:2rem 0;">Loading…</p>`;
    google.script.run
      .withSuccessHandler(data => {
        _chatAliases = data.member_aliases || {};
        _chatMembers = data.members_list   || [];
        _renderAliasList();
        _renderChatMessages(data.chat_messages || []);
      })
      .withFailureHandler(() => { if (area) area.innerHTML=`<p style="text-align:center;color:#f87171;font-size:.7rem;padding:2rem;">Failed to load</p>`; })
      .getCommitteeChat(_chatCommId);
  }

  // ── Alias panel ───────────────────────────────────────────────
  function toggleAliasPanel() {
    const p = document.getElementById('chatAliasPanel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  }

  function _renderAliasList() {
    const list = document.getElementById('chatAliasList');
    if (!list || !_chatMembers.length) return;
    list.innerHTML = _chatMembers.map(m => {
      const color = _chatColor(m.user_id);
      const alias = _chatAliases[m.user_id] || '';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:.2rem;background:#fff;border:1px solid #e0f2fe;border-radius:.7rem;padding:.4rem .5rem;min-width:4.5rem;">
        <span style="color:${color};font-size:.62rem;font-weight:900;text-align:center;max-width:5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escHtml(m.name||m.user_id)}">${_escHtml(m.name||m.user_id)}</span>
        <input type="text" value="${_escHtml(alias)}" placeholder="Short name"
          data-uid="${_escHtml(m.user_id)}"
          maxlength="12"
          style="width:4.5rem;padding:.2rem .35rem;background:#f0f9ff;border:1px solid #bae6fd;border-radius:.4rem;font-size:.65rem;font-weight:700;color:#0c4a6e;text-align:center;outline:none;"
          onblur="_saveAliases()"
          onkeydown="if(event.key==='Enter')this.blur();">
      </div>`;
    }).join('');
  }

  function _saveAliases() {
    const inputs = document.querySelectorAll('#chatAliasList input[data-uid]');
    const aliases = {};
    inputs.forEach(inp => {
      const v = inp.value.trim();
      if (v) aliases[inp.dataset.uid] = v;
    });
    _chatAliases = aliases;
    google.script.run
      .withSuccessHandler(() => showToast('Short names saved'))
      .withFailureHandler(() => showToast('Failed to save short names','error'))
      .updateMemberAliases(_chatCommId, aliases);
  }

  // ── Render messages ───────────────────────────────────────────
  function _renderChatMessages(msgs) {
    const area = document.getElementById('chatMsgArea');
    if (!area) return;
    if (!msgs.length) {
      area.innerHTML = `<p style="text-align:center;color:#94a3b8;font-size:.7rem;font-weight:700;padding:3rem 0;">No messages yet — say something!</p>`;
      return;
    }
    const myId = window.APP_USER && window.APP_USER.user_id;
    let myLastIdx = -1;
    msgs.forEach((m, i) => { if (m.user_id === myId) myLastIdx = i; });

    area.innerHTML = msgs.map((msg, idx) => {
      const isMe     = msg.user_id === myId;
      const color    = _chatColor(msg.user_id);
      const dname    = _displayName(msg.user_id);
      const canDel   = isMe && idx === myLastIdx;
      const align    = isMe ? 'flex-end' : 'flex-start';
      const bgBubble = isMe ? '#dbeafe' : '#ffffff';
      const bdBubble = isMe ? '#bfdbfe' : '#e2e8f0';

      // Reply quote
      const replyHtml = msg.reply_to ? (() => {
        const rc = _chatColor(msg.reply_to.user_id||'');
        const rn = _displayName(msg.reply_to.user_id||'') || msg.reply_to.user_name || '';
        const rt = (msg.reply_to.text||'').slice(0,80);
        return `<div style="padding:.3rem .55rem;background:rgba(0,0,0,.05);border-left:3px solid ${rc};border-radius:.4rem;margin-bottom:.3rem;font-size:.64rem;color:#64748b;cursor:pointer;"
          onclick="document.getElementById('msg-${_escHtml(msg.reply_to.id||'')}')&&document.getElementById('msg-${_escHtml(msg.reply_to.id||'')}').scrollIntoView({behavior:'smooth',block:'center'})">
          <span style="font-weight:900;color:${rc};">${_escHtml(rn)}</span>: ${_escHtml(rt)}${rt.length>=80?'…':''}
        </div>`;
      })() : '';

      const actions = `<div class="chat-actions" style="display:none;gap:.25rem;margin-top:.25rem;justify-content:${isMe?'flex-end':'flex-start'};">
        <button onclick="setChatReply('${_escJs(msg.id)}','${_escJs(msg.user_id)}','${_escJs(dname)}','${_escJs((msg.text||'').slice(0,100))}')"
          style="font-size:.58rem;font-weight:900;text-transform:uppercase;padding:.2rem .55rem;border-radius:.45rem;border:1px solid #e2e8f0;background:#fff;color:#475569;cursor:pointer;">↩ Reply</button>
        ${canDel?`<button onclick="deleteMyChatMessage()" style="font-size:.58rem;font-weight:900;text-transform:uppercase;padding:.2rem .55rem;border-radius:.45rem;border:1px solid #fecaca;background:#fff5f5;color:#ef4444;cursor:pointer;">🗑 Delete</button>`:''}
      </div>`;

      return `<div id="msg-${_escHtml(msg.id)}" style="display:flex;flex-direction:column;align-items:${align};max-width:80%;"
        onmouseenter="this.querySelector('.chat-actions').style.display='flex';"
        onmouseleave="this.querySelector('.chat-actions').style.display='none';">
        <div style="background:${bgBubble};border:1px solid ${bdBubble};border-radius:.9rem;padding:.5rem .75rem;box-shadow:0 1px 3px rgba(0,0,0,.05);max-width:100%;">
          ${replyHtml}
          <div style="display:flex;align-items:baseline;gap:.4rem;margin-bottom:.2rem;">
            <span style="color:${color};font-weight:900;font-size:.7rem;">${_escHtml(dname)}</span>
            <span style="color:#94a3b8;font-size:.58rem;font-weight:600;white-space:nowrap;">${_chatFmt(msg.ts)}</span>
          </div>
          <p style="font-size:.78rem;color:#1e293b;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0;">${_renderText(msg.text||'')}</p>
        </div>
        ${actions}
      </div>`;
    }).join('');

    area.scrollTop = area.scrollHeight;
    lucide.createIcons();
  }

  // ── Reply ─────────────────────────────────────────────────────
  function setChatReply(msgId, userId, displayName, text) {
    _chatReplyTo = { id: msgId, user_id: userId, user_name: displayName, text };
    document.getElementById('chatReplyToName').textContent = displayName;
    document.getElementById('chatReplyToText').textContent = text.slice(0,60) + (text.length>60?'…':'');
    document.getElementById('chatReplyBar').style.display = '';
    document.getElementById('chatInput').focus();
  }
  function cancelChatReply() {
    _chatReplyTo = null;
    document.getElementById('chatReplyBar').style.display = 'none';
  }

  // ── @ mention autocomplete ────────────────────────────────────
  let _mentionPartial = null;

  function _onChatInput(el) {
    const val = el.value;
    const pos = el.selectionStart;
    const before = val.slice(0, pos);
    const match  = before.match(/@(\w*)$/);
    const drop   = document.getElementById('chatMentionDrop');
    if (!drop) return;
    if (!match) { drop.style.display = 'none'; _mentionPartial = null; return; }
    _mentionPartial = match[1].toLowerCase();
    const hits = _chatMembers.filter(m => {
      const alias = (_chatAliases[m.user_id]||'').toLowerCase();
      const name  = (m.name||'').toLowerCase();
      return alias.startsWith(_mentionPartial) || name.startsWith(_mentionPartial);
    });
    if (!hits.length) { drop.style.display = 'none'; return; }
    drop.style.display = '';
    drop.innerHTML = hits.map(m => {
      const disp  = _chatAliases[m.user_id] || m.name || m.user_id;
      const color = _chatColor(m.user_id);
      return `<button type="button" onclick="_insertMention('${_escJs(disp)}')"
        style="display:flex;align-items:center;gap:.5rem;width:100%;padding:.45rem .75rem;background:none;border:none;border-bottom:1px solid #f1f5f9;cursor:pointer;text-align:left;">
        <span style="width:.65rem;height:.65rem;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span style="font-weight:900;font-size:.72rem;color:${color};">@${_escHtml(disp)}</span>
        ${m.name&&_chatAliases[m.user_id]?`<span style="font-size:.62rem;color:#94a3b8;">${_escHtml(m.name)}</span>`:''}
      </button>`;
    }).join('');
  }

  function _onChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCommitteeChatMessage(); return; }
    if (e.key === 'Escape') {
      document.getElementById('chatMentionDrop').style.display = 'none';
      _mentionPartial = null;
    }
  }

  function _insertMention(alias) {
    const inp = document.getElementById('chatInput');
    if (!inp) return;
    const pos    = inp.selectionStart;
    const before = inp.value.slice(0, pos).replace(/@\w*$/, '@' + alias + ' ');
    const after  = inp.value.slice(pos);
    inp.value    = before + after;
    inp.setSelectionRange(before.length, before.length);
    inp.focus();
    document.getElementById('chatMentionDrop').style.display = 'none';
    _mentionPartial = null;
  }

  // ── Send ──────────────────────────────────────────────────────
  function sendCommitteeChatMessage() {
    const input = document.getElementById('chatInput');
    const text  = (input ? input.value : '').trim();
    if (!text || !_chatCommId) return;
    const me = window.APP_USER;
    if (!me) { showToast('Not logged in','error'); return; }
    const msg = {
      id       : me.user_id + '-' + Date.now(),
      user_id  : me.user_id,
      text,
      ts       : Date.now(),
      reply_to : _chatReplyTo ? { ..._chatReplyTo, user_name: _displayName(_chatReplyTo.user_id) } : null
    };
    if (input) input.value = '';
    cancelChatReply();
    document.getElementById('chatMentionDrop').style.display = 'none';
    google.script.run
      .withSuccessHandler(() => _loadChatMessages())
      .withFailureHandler(() => showToast('Failed to send','error'))
      .sendCommitteeMessage(_chatCommId, msg);
  }

  // ── Delete ────────────────────────────────────────────────────
  function deleteMyChatMessage() {
    if (!_chatCommId || !window.APP_USER) return;
    if (!confirm('Delete your last message?')) return;
    google.script.run
      .withSuccessHandler(() => _loadChatMessages())
      .withFailureHandler(() => showToast('Failed to delete','error'))
      .deleteLastOwnMessage(_chatCommId, window.APP_USER.user_id);
  }

  // ── RECORDS MODAL (Course Marks + Bonus/Penalty) ─────────────────────────────
  function openRecordsModal(teacherId, teacherName) {
    document.getElementById('recordsTeacherId').value = teacherId;
    document.getElementById('recordsTeacherName').textContent = teacherName;
    document.getElementById('recordsModal').classList.remove('hidden');
    switchRecordsTab('courses');
    lucide.createIcons();
  }
  function closeRecordsModal() { document.getElementById('recordsModal').classList.add('hidden'); }

  function switchRecordsTab(tab) {
    ['courses','bp'].forEach(t => {
      document.getElementById('rsec-'+t).classList.toggle('hidden', t !== tab);
      const btn = document.getElementById('rtab-'+t);
      if (btn) btn.className = t === tab
        ? 'text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full bg-blue-600 text-white shadow transition-all'
        : 'text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full bg-white text-slate-400 border border-slate-200 hover:bg-slate-50 transition-all';
    });
    const tid = document.getElementById('recordsTeacherId').value;
    if (tab === 'courses') loadCourseMarksList(tid);
    if (tab === 'bp')      loadBPList(tid);
  }

  function loadCourseMarksList(teacherId) {
    const container = document.getElementById('courseMarksList');
    if (!container) return;
    container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs font-black uppercase tracking-widest">Loading...</div>`;
    google.script.run.withSuccessHandler(rows => {
      if (!Array.isArray(rows) || !rows.length) {
        container.innerHTML = `<div class="text-center py-6 text-slate-300 text-xs font-black uppercase tracking-widest">No courses added yet</div>`;
        return;
      }
      container.innerHTML = rows.map(r => `
        <div class="flex items-center justify-between gap-3 p-4 bg-white border border-slate-100 rounded-2xl group">
          <div class="flex-1 min-w-0">
            <p class="font-black text-slate-800 truncate">${r.course_name||'—'}</p>
            <p class="text-[10px] text-slate-400 font-bold mt-0.5">${r.obtained_marks}/${r.full_marks} marks · Weight: <span class="text-blue-600">${r.weight_allotted}</span></p>
          </div>
          <button onclick="deleteCourseRecord(${r.id})" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
            <i data-lucide="trash-2" class="h-4 w-4"></i>
          </button>
        </div>`).join('');
      lucide.createIcons();
    }).withFailureHandler(() => { container.innerHTML = `<div class="text-center py-4 text-red-400 text-xs font-black">Failed to load</div>`; })
      .getCourseMarks(teacherId);
  }

  function addCourseRecord() {
    const teacherId = document.getElementById('recordsTeacherId').value;
    const name     = document.getElementById('nc-name').value.trim();
    const obtained = parseFloat(document.getElementById('nc-obtained').value);
    const full     = parseFloat(document.getElementById('nc-full').value) || 100;
    const weight   = parseFloat(document.getElementById('nc-weight').value) || 0;
    if (!name) { showToast('Enter the course name', 'error'); return; }
    if (isNaN(obtained)) { showToast('Enter obtained marks', 'error'); return; }
    google.script.run
      .withSuccessHandler(() => {
        showToast('Course added!');
        ['nc-name','nc-obtained','nc-weight'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('nc-full').value = '100';
        loadCourseMarksList(teacherId);
      })
      .withFailureHandler(() => showToast('Failed to add course', 'error'))
      .saveCourseMark({ teacher_id: teacherId, course_name: name, obtained_marks: obtained, full_marks: full, weight_allotted: weight });
  }

  function deleteCourseRecord(id) {
    showConfirm('Delete this course record?', () => {
      const teacherId = document.getElementById('recordsTeacherId').value;
      google.script.run
        .withSuccessHandler(() => { showToast('Deleted'); loadCourseMarksList(teacherId); })
        .withFailureHandler(() => showToast('Failed to delete', 'error'))
        .deleteCourseMark(id);
    });
  }

  function loadBPList(teacherId) {
    const container = document.getElementById('bpList');
    if (!container) return;
    container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs font-black uppercase tracking-widest">Loading...</div>`;
    google.script.run.withSuccessHandler(rows => {
      if (!Array.isArray(rows) || !rows.length) {
        container.innerHTML = `<div class="text-center py-6 text-slate-300 text-xs font-black uppercase tracking-widest">No entries yet</div>`;
        return;
      }
      container.innerHTML = rows.map(r => {
        const isBonus = r.type === 'Bonus';
        return `
        <div class="flex items-center justify-between gap-3 p-4 bg-white border border-slate-100 rounded-2xl group">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <span class="px-2 py-1 rounded-full text-[9px] font-black uppercase ${isBonus?'bg-emerald-100 text-emerald-600':'bg-red-100 text-red-500'}">${r.type}</span>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-slate-700 truncate text-sm">${r.description||'—'}</p>
              <p class="text-[10px] font-black ${isBonus?'text-emerald-600':'text-red-500'}">${isBonus?'+':'-'}${r.amount}</p>
            </div>
          </div>
          <button onclick="deleteBPRecord(${r.id})" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
            <i data-lucide="trash-2" class="h-4 w-4"></i>
          </button>
        </div>`;
      }).join('');
      lucide.createIcons();
    }).withFailureHandler(() => { container.innerHTML = `<div class="text-center py-4 text-red-400 text-xs font-black">Failed to load</div>`; })
      .getBonusPenalty(teacherId);
  }

  function addBPRecord() {
    const teacherId = document.getElementById('recordsTeacherId').value;
    const type      = document.getElementById('nb-type').value;
    const amount    = parseFloat(document.getElementById('nb-amount').value);
    const desc      = document.getElementById('nb-desc').value.trim();
    if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
    google.script.run
      .withSuccessHandler(() => {
        showToast(`${type} entry added!`);
        document.getElementById('nb-amount').value = '';
        document.getElementById('nb-desc').value = '';
        loadBPList(teacherId);
      })
      .withFailureHandler(() => showToast('Failed to add entry', 'error'))
      .saveBonusPenalty({ teacher_id: teacherId, type, amount, description: desc });
  }

  function deleteBPRecord(id) {
    showConfirm('Delete this entry?', () => {
      const teacherId = document.getElementById('recordsTeacherId').value;
      google.script.run
        .withSuccessHandler(() => { showToast('Deleted'); loadBPList(teacherId); })
        .withFailureHandler(() => showToast('Failed to delete', 'error'))
        .deleteBonusPenalty(id);
    });
  }

  // ═══════════════════════════════════════════════════════
  //  PROFILE — PROGRESS TRACKING & PREVIEW MODE
  // ═══════════════════════════════════════════════════════

  let _progressTimer = null;
  function debounceProgressUpdate() {
    clearTimeout(_progressTimer);
    _progressTimer = setTimeout(updateProfileProgress, 300);
  }

  function updateProfileProgress() {
    const tabNames = ['personal','travel','parents','spouse','children','financial','education','career'];
    let grandFilled = 0, grandTotal = 0;

    tabNames.forEach(tab => {
      const sec = document.getElementById('psec-' + tab);
      if (!sec) return;

      // Count all named form inputs NOT inside a dynamic row
      const inputs = [...sec.querySelectorAll('input:not([type=hidden]), select, textarea')]
        .filter(el => el.name && !el.closest('[data-drow]'));
      const total  = inputs.length;
      const filled = inputs.filter(el => el.value && el.value.trim()).length;
      const dynRows = sec.querySelectorAll('[data-drow]').length;
      const hasSomething = filled > 0 || dynRows > 0;

      grandFilled += filled;
      grandTotal  += total;

      const dot = document.getElementById('dot-' + tab);
      if (dot) dot.classList.toggle('filled', hasSomething);

      const pctEl = document.getElementById('pct-' + tab);
      const barEl = document.getElementById('bar-' + tab);
      if (total > 0) {
        const pct = Math.round((filled / total) * 100);
        const color = pct >= 80 ? 'rgb(16 185 129)' : pct >= 40 ? 'rgb(251 191 36)' : 'rgb(239 68 68)';
        if (pctEl) { pctEl.textContent = pct + '%'; pctEl.style.color = color; }
        if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = color; }
      } else {
        if (pctEl) { pctEl.textContent = dynRows ? '✓' : '—'; pctEl.style.color = ''; }
        if (barEl) { barEl.style.width = dynRows ? '100%' : '0%'; barEl.style.background = 'rgb(16 185 129)'; }
      }
    });

    if (grandTotal > 0) {
      const pct = Math.round((grandFilled / grandTotal) * 100);

      // Badge pill
      const badge = document.getElementById('profileCompletionBadge');
      if (badge) {
        badge.textContent = pct + '% Complete';
        badge.classList.remove('hidden','bg-emerald-100','text-emerald-600','bg-amber-100','text-amber-600','bg-rose-100','text-rose-600');
        if (pct >= 80)      badge.classList.add('bg-emerald-100','text-emerald-600');
        else if (pct >= 40) badge.classList.add('bg-amber-100','text-amber-600');
        else                badge.classList.add('bg-rose-100','text-rose-600');
      }

      // Progress bar
      const bar  = document.getElementById('profileFillBar');
      const pctLabel = document.getElementById('profileFillPct');
      if (bar) {
        bar.style.width = pct + '%';
        bar.style.background = pct >= 80 ? 'rgb(16 185 129)' : pct >= 40 ? 'rgb(251 191 36)' : 'rgb(239 68 68)';
      }
      if (pctLabel) {
        pctLabel.textContent = pct + '%';
        pctLabel.style.color = pct >= 80 ? 'rgb(16 185 129)' : pct >= 40 ? 'rgb(203 138 0)' : 'rgb(239 68 68)';
      }
    }
  }

  function enableProfileEdit() {
    const form   = document.getElementById('teacherForm');
    const banner = document.getElementById('profileLockBanner');
    const bar    = document.getElementById('profileSaveBar');
    if (form) {
      form.classList.remove('form-locked');
      form.querySelectorAll('input:not([data-perm-readonly]), textarea').forEach(el => el.removeAttribute('readonly'));
      form.querySelectorAll('select').forEach(el => el.disabled = false);
    }
    if (banner) banner.style.display = 'none';
    if (bar)    bar.style.display    = 'flex';
    lucide.createIcons();
  }

  function lockProfileEdit() {
    const form   = document.getElementById('teacherForm');
    const banner = document.getElementById('profileLockBanner');
    const bar    = document.getElementById('profileSaveBar');
    if (form) {
      form.classList.add('form-locked');
      form.querySelectorAll('input, textarea').forEach(el => el.setAttribute('readonly', ''));
      form.querySelectorAll('select').forEach(el => el.disabled = true);
    }
    if (banner) banner.style.display = '';
    if (bar)    bar.style.display    = 'none';
    lucide.createIcons();
  }

  function setProfileFontSize(n) {
    const root = document.getElementById('profileRoot');
    if (!root) return;
    [1,2,3,4,5].forEach(i => root.classList.remove('fs-' + i));
    if (n !== 3) root.classList.add('fs-' + n);
    document.querySelectorAll('.fs-btn').forEach(b => b.classList.remove('active-fs'));
    const btn = document.getElementById('fs-btn-' + n);
    if (btn) btn.classList.add('active-fs');
  }

  function toggleProfileMode(mode) {
    const editEl    = document.getElementById('profileEditMode');
    const previewEl = document.getElementById('profilePreviewMode');
    if (!editEl || !previewEl) return;
    if (mode === 'preview') {
      buildProfilePreview();
      editEl.classList.add('hidden');
      previewEl.classList.remove('hidden');
    } else {
      previewEl.classList.add('hidden');
      editEl.classList.remove('hidden');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function buildProfilePreview() {
    const f = document.getElementById('teacherForm');
    const container = document.getElementById('profilePreviewContent');
    if (!f || !container) return;

    const v = name => {
      const el = f.elements[name];
      return (el && el.value && el.value.trim()) ? el.value.trim() : '';
    };

    const fld = (label, value) => `
      <div class="pv-field">
        <p class="pv-lbl">${label}</p>
        <p class="pv-val${value ? '' : ' empty'}">${value || '—'}</p>
      </div>`;

    function readDynamic(containerId, colNames) {
      const c = document.getElementById(containerId);
      if (!c) return [];
      return [...c.querySelectorAll('[data-drow]')].map(row => {
        const obj = {};
        colNames.forEach(n => {
          const el = row.querySelector('[name="' + n + '"]');
          obj[n] = el ? el.value.trim() : '';
        });
        return obj;
      }).filter(obj => Object.values(obj).some(x => x));
    }

    const countries = readDynamic('countriesContainer', ['country_name[]','duration_from[]','duration_to[]','visit_reasons[]']);
    const languages = readDynamic('languagesContainer', ['language[]','efficiency[]']);
    const siblings  = readDynamic('siblingsContainer',  ['sibling_name[]','sibling_age[]','sibling_nationality[]','sibling_occ_addr[]','sibling_dependency[]']);
    const family    = readDynamic('familyContainer',    ['fam_type[]','fam_name[]','fam_date[]']);
    const children  = readDynamic('childrenContainer',  ['child_name[]','child_sex[]','child_dob[]','child_occupation[]','child_address[]']);
    const diseases  = readDynamic('diseasesContainer',  ['disease_name[]','disease_nature[]','disease_date[]','disease_condition[]']);
    const inlaws    = readDynamic('inlawsContainer',    ['inlaw_name[]','inlaw_address[]']);
    const banks     = readDynamic('bankContainer',      ['bank_name[]','bank_account_no[]','bank_account_type[]']);
    const edu       = readDynamic('eduContainer',       ['edu_from[]','edu_to[]','edu_school[]','edu_exam[]','edu_gpa[]','edu_year[]','edu_remarks[]']);
    const attrs     = readDynamic('attributeContainer', ['attr_header[]','attr_subheader[]','attr_value[]']);

    const sec = (title, body) => `
      <div class="prev-section">
        <div class="prev-hdr">${title}</div>
        <div class="prev-body">${body}</div>
      </div>`;

    const grid = (cols, ...items) => `<div class="grid grid-cols-${cols} md:grid-cols-${cols * 2} gap-3">${items.join('')}</div>`;

    const tbl = (headers, rows, colKeys) => {
      if (!rows.length) return '<p class="pv-val empty text-xs">No records.</p>';
      return `<div class="overflow-x-auto"><table class="w-full text-xs border-collapse">
        <thead><tr class="border-b border-slate-100">${headers.map(h => `<th class="text-left py-1.5 pr-3 pv-lbl">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr class="border-b border-slate-50">${colKeys.map(k => `<td class="py-1.5 pr-3 font-bold text-slate-700">${r[k] || '—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    };

    const fullName   = v('full_name');
    const designation = v('designation');
    const heightStr  = v('height_feet') ? v('height_feet') + '\' ' + (v('height_inches') || '0') + '"' : '';

    let html = `
      <!-- Header card -->
      <div class="bg-gradient-to-r from-slate-900 to-blue-900 rounded-3xl p-6 text-white flex flex-wrap items-center justify-between gap-4 shadow-2xl mb-1">
        <div class="flex items-center gap-5">
          <div class="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 shrink-0">
            <i data-lucide="user" class="h-8 w-8 text-white/40"></i>
          </div>
          <div>
            <p class="text-[9px] font-black text-white/40 uppercase tracking-widest">Personnel File — CCPC</p>
            <h2 class="text-2xl font-black tracking-tight mt-0.5">${fullName || 'Name Not Set'}</h2>
            <p class="text-blue-300 font-bold text-xs mt-0.5">${designation}${v('name_bengali') ? ' · ' + v('name_bengali') : ''}</p>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              ${v('teacher_id') ? `<span class="text-[9px] font-black bg-white/10 px-2.5 py-0.5 rounded-full">ID: ${v('teacher_id')}</span>` : ''}
              ${v('category') ? `<span class="text-[9px] font-black bg-blue-500/30 px-2.5 py-0.5 rounded-full">${v('category')}</span>` : ''}
              ${v('school_college') ? `<span class="text-[9px] font-black bg-white/10 px-2.5 py-0.5 rounded-full">${v('school_college')}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="text-right">
          <p class="text-[9px] font-black text-white/40 uppercase tracking-widest">Joining Date</p>
          <p class="text-xl font-black mt-0.5">${v('joining_date') || '—'}</p>
        </div>
      </div>

      ${sec('Identity &amp; Registration', `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fld('National ID Number', v('national_id'))}
        ${fld('Auth (GB Notification/Office Order etc)', v('auth_ref'))}
        ${fld('TID/BIN No', v('tid_bin_no'))}
        ${fld('ID Number', v('teacher_id'))}
      </div>`)}

      ${sec('Birth, Physical &amp; Blood', `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fld('Date of Birth', v('date_of_birth'))}
        ${fld('Place (Village/City)', v('place_of_birth'))}
        ${fld('Birth Certificate Number', v('birth_certificate_no'))}
        ${fld('Height', heightStr)}
        ${fld('Weight (in kg)', v('weight_kg') ? v('weight_kg') + ' kg' : '')}
        ${fld('Blood Group', v('blood_group'))}
        ${fld('Visible Identification Marks(s)', v('identification_marks'))}
        ${fld('Present Medical Category', v('medical_category'))}
        ${fld('Present Nature of Disability (if any)', v('disability_nature'))}
        ${fld('Present Attributably (if any)', v('disability_attributable'))}
        ${fld('Religion', v('religion'))}
        ${fld('Cast', v('caste'))}
      </div>`)}

      ${sec('Nationality, Address(es) &amp; Contact Details', `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        ${fld('Nationality', v('nationality'))}
        ${fld('Previous Nationality (if any)', v('previous_nationality'))}
        ${fld('Personal e-mail Address', v('personal_email'))}
        ${fld('Mobile Number', v('mobile'))}
        ${fld('T&amp;T Phone Number', v('tt_phone'))}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        ${fld('Permanent Address', v('permanent_address'))}
        ${fld('Present Address', v('present_address'))}
        ${fld('Alternate present Address (If Any)', v('alternate_address'))}
      </div>`)}

      ${sec('Passport', `<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        ${fld('Passport Number', v('passport_number'))}
        ${fld('Date of Issue', v('passport_date_issue'))}
        ${fld('Place of Issue', v('passport_place_issue'))}
        ${fld('Date of Expiry', v('passport_date_expiry'))}
        ${fld('Issuing Auth.', v('passport_issuing_auth'))}
        ${fld('Type of Passport', v('passport_type'))}
      </div>`)}

      ${countries.length ? sec('Countries Visited', tbl(
          ['Country','From','To','Reason / Purpose'],
          countries,
          ['country_name[]','duration_from[]','duration_to[]','visit_reasons[]']
        )) : ''}

      ${languages.length ? sec('Language Skills (Other than Bengali &amp; English)', `
        <div class="flex flex-wrap gap-2">${languages.map(r =>
          `<div class="px-3 py-1.5 bg-blue-50 rounded-xl">
            <p class="font-black text-slate-800 text-xs">${r['language[]'] || '—'}</p>
            <p class="text-[9px] text-slate-400 font-bold">${r['efficiency[]'] || ''}</p>
          </div>`).join('')}
        </div>`) : ''}

      ${sec("Father's Details", `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fld("Father's Name in Full", v('father_name'))}
        ${fld('Nationality', v('father_nationality'))}
        ${fld('Previous Nationality (if any)', v('father_prev_nationality'))}
        ${fld('Date of Bangladesh Citizenship and Authority (if Applicable)', v('father_citizenship_auth'))}
        ${fld('Present Age', v('father_present_age'))}
        ${fld('Date of Decease', v('father_date_of_decease'))}
        ${fld("Father's Occupation / Profession", v('father_occupation'))}
        ${fld('Annual Average Income', v('father_annual_income'))}
      </div>`)}

      ${sec("Mother's Details", `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fld("Mother's Name in Full", v('mother_name'))}
        ${fld('Nationality', v('mother_nationality'))}
        ${fld('Previous Nationality (if any)', v('mother_prev_nationality'))}
        ${fld('Date of Bangladesh Citizenship and Authority (if Applicable)', v('mother_citizenship_auth'))}
        ${fld('Present Age', v('mother_present_age'))}
        ${fld('Date of Decease', v('mother_date_of_decease'))}
        ${fld("Mother's Occupation / Profession", v('mother_occupation'))}
      </div>`)}

      ${siblings.length ? sec('Brothers &amp; Sisters', tbl(
          ['Name','Age','Nationality','Occupation &amp; Address','Dependency'],
          siblings,
          ['sibling_name[]','sibling_age[]','sibling_nationality[]','sibling_occ_addr[]','sibling_dependency[]']
        )) : ''}

      ${v('position_in_siblings') ? sec('Position within Brothers &amp; Sisters',
          `<p class="font-bold text-slate-800 text-sm">${v('position_in_siblings')}</p>`) : ''}

      ${sec('Marital Status', `<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        ${fld('Marital Status (Please Tick)', v('marital_status'))}
        ${fld('Date of Marriage/Divorce/Widow', v('marriage_divorce_date'))}
        ${fld('Authority', v('marriage_authority'))}
      </div>`)}

      ${sec('Details of Spouse', `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fld('NAME (IN BLOCK CAPITAL)', v('spouse_name_en'))}
        ${fld('নাম (বাংলায়)', v('spouse_name_bn'))}
        ${fld('Date of Birth', v('spouse_dob'))}
        ${fld('Place of Birth', v('spouse_pob'))}
        ${fld('Birth Registration Number', v('spouse_birth_reg'))}
        ${fld('Nationality', v('spouse_nationality'))}
        ${fld('Previous Nationality (if any)', v('spouse_prev_nationality'))}
        ${fld('Authority of Bangladesh Citizenship (If Applicable)', v('spouse_citizenship_auth'))}
        ${fld('National ID Card Number', v('spouse_nid'))}
        ${fld('Educational Qualification', v('spouse_education'))}
        ${fld('Occupation of Spouse', v('spouse_occupation'))}
        ${fld('Occupation Designation', v('spouse_occ_designation'))}
        ${fld('Occupation Address', v('spouse_occ_address'))}
        ${fld('Previous Occupation', v('spouse_prev_occupation'))}
        ${fld('Spouse TID / BIN No.', v('spouse_tid_bin'))}
      </div>`)}

      ${family.length ? sec('Basic Family Record (ACR)', tbl(
          ['Relation / Type','Name &amp; Details','Date'],
          family,
          ['fam_type[]','fam_name[]','fam_date[]']
        )) : ''}

      ${children.length ? sec('Particulars of Children', tbl(
          ['Name','Sex','Date of Birth','Occupation','Present Address'],
          children,
          ['child_name[]','child_sex[]','child_dob[]','child_occupation[]','child_address[]']
        )) : ''}

      ${diseases.length ? sec('Chronic / Severe Diseases', tbl(
          ['Disease','Nature','Date of Illness','Present Condition'],
          diseases,
          ['disease_name[]','disease_nature[]','disease_date[]','disease_condition[]']
        )) : ''}

      ${inlaws.length ? sec('Brothers &amp; Sisters-in-Law', `
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
          ${inlaws.map(r => `<div class="p-3 bg-slate-50 rounded-xl">
            <p class="font-black text-slate-800 text-sm">${r['inlaw_name[]'] || '—'}</p>
            <p class="text-xs text-slate-400 font-bold mt-0.5">${r['inlaw_address[]'] || ''}</p>
          </div>`).join('')}
        </div>`) : ''}

      ${sec('Details of Income', `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fld('TID/BIN No', v('tid_bin_no'))}
        ${fld('Own Income', v('own_income'))}
        ${fld('Spouse Income', v('spouse_income'))}
        ${fld('Income from Assets', v('assets_income'))}
        ${v('assets_details') ? `<div class="md:col-span-4">${fld('Details of Assets', v('assets_details'))}</div>` : ''}
      </div>`)}

      ${banks.length ? sec('Details of Bank Accounts', tbl(
          ['Name of Bank','Account Number','Type of Account'],
          banks,
          ['bank_name[]','bank_account_no[]','bank_account_type[]']
        )) : ''}

      ${edu.length ? sec('Part II — Educational Qualifications', tbl(
          ['From','To','Institution','Examination','Division / GPA','Year','Remarks'],
          edu,
          ['edu_from[]','edu_to[]','edu_school[]','edu_exam[]','edu_gpa[]','edu_year[]','edu_remarks[]']
        )) : ''}

      ${v('additional_qualification') ? sec('Additional Qualification',
          `<p class="font-bold text-slate-800 text-sm whitespace-pre-line">${v('additional_qualification')}</p>`) : ''}

      ${attrs.length ? sec('Achievements, Speciality &amp; Active Committees', (() => {
          const cats = ['Education','Achievement','Speciality','Hobby','Committee'];
          return cats.map(cat => {
            const items = attrs.filter(a => a['attr_header[]'] === cat);
            if (!items.length) return '';
            return `<div class="mb-3 last:mb-0">
              <p class="pv-lbl mb-1.5">${cat}</p>
              <div class="flex flex-wrap gap-1.5">${items.map(a =>
                `<span class="px-3 py-1 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold">${a['attr_subheader[]'] ? a['attr_subheader[]'] + ': ' : ''}${a['attr_value[]'] || ''}</span>`
              ).join('')}</div>
            </div>`;
          }).join('');
        })()) : ''}

      ${sec('Part III — Events Affecting Career', `<div class="space-y-4">
        <div>
          <p class="pv-lbl mb-1">Details of breaking Institution Law</p>
          <p class="font-bold text-slate-800 text-sm whitespace-pre-line">${v('institution_law_breaking') || '—'}</p>
        </div>
        <div>
          <p class="pv-lbl mb-1">Details of Breaking Civil Law (If Applicable)</p>
          <p class="font-bold text-slate-800 text-sm whitespace-pre-line">${v('civil_law_breaking') || '—'}</p>
        </div>
        ${v('identification_marks') ? `<div>
          <p class="pv-lbl mb-1">Identification Marks</p>
          <p class="font-bold text-slate-800 text-sm">${v('identification_marks')}</p>
        </div>` : ''}
      </div>`)}
    `;

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ═══════════════════════════════════════════════════════
  //  PHOTO UPLOAD
  // ═══════════════════════════════════════════════════════

  function setProfilePhoto(fileId) {
    if (!fileId) return;
    const img = document.getElementById('photoPreviewImg');
    const ph  = document.getElementById('photoPlaceholder');
    if (!img) return;
    img.src = 'https://lh3.googleusercontent.com/d/' + fileId;
    img.classList.remove('hidden');
    if (ph) ph.classList.add('hidden');
    img.dataset.fileId = fileId;
  }

  function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Hard limit: reject originals over 1 MB
    if (file.size > 1 * 1024 * 1024) {
      showToast('Photo must be under 1 MB. Please compress the image first.', 'error');
      event.target.value = '';
      return;
    }

    const f   = document.getElementById('teacherForm');
    const tid = f ? f.elements['teacher_id'].value.trim() : '';
    if (!tid) {
      showToast('Enter your ID Number first before uploading photo', 'error');
      event.target.value = '';
      return;
    }

    const overlay    = document.getElementById('photoUploadOverlay');
    const statusText = document.getElementById('photoStatusText');
    if (overlay)    { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }
    if (statusText) statusText.textContent = 'Processing...';

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        // Center-crop to square on a canvas
        const side      = Math.min(img.width, img.height);
        const sx        = Math.floor((img.width  - side) / 2);
        const sy        = Math.floor((img.height - side) / 2);
        const canvasPx  = Math.min(side, 720);   // cap at 720 x 720 px

        const canvas    = document.createElement('canvas');
        canvas.width    = canvasPx;
        canvas.height   = canvasPx;
        const ctx       = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, canvasPx, canvasPx);

        // Try decreasing quality until output is within 1 MB
        let base64 = '';
        for (const q of [0.90, 0.75, 0.60, 0.45]) {
          base64 = canvas.toDataURL('image/jpeg', q);
          const approxBytes = Math.ceil((base64.length - base64.indexOf(',') - 1) * 0.75);
          if (approxBytes <= 1 * 1024 * 1024) break;
        }

        const finalBytes = Math.ceil((base64.length - base64.indexOf(',') - 1) * 0.75);
        if (finalBytes > 1 * 1024 * 1024) {
          if (overlay)    { overlay.classList.add('hidden'); overlay.style.display = ''; }
          if (statusText) statusText.textContent = 'Too large';
          showToast('Could not compress photo under 1 MB. Please use a smaller image.', 'error');
          return;
        }

        if (statusText) statusText.textContent = 'Uploading...';

        const fname = 'photo_' + tid + '_' + Date.now() + '.jpg';
        google.script.run
          .withSuccessHandler(res => {
            if (overlay)    { overlay.classList.add('hidden'); overlay.style.display = ''; }
            if (res.success) {
              setProfilePhoto(res.fileId);
              if (statusText) statusText.textContent = 'Photo saved';
              showToast('Photo uploaded!');
            } else {
              if (statusText) statusText.textContent = 'Upload failed';
              showToast('Photo upload failed: ' + (res.error || 'unknown error'), 'error');
            }
          })
          .withFailureHandler(err => {
            if (overlay)    { overlay.classList.add('hidden'); overlay.style.display = ''; }
            if (statusText) statusText.textContent = 'Upload failed';
            showToast('Upload error: ' + (err.message || err), 'error');
          })
          .uploadPhoto(base64, fname, tid);
      };
      img.onerror = function() {
        if (overlay)    { overlay.classList.add('hidden'); overlay.style.display = ''; }
        if (statusText) statusText.textContent = '';
        showToast('Could not read image file', 'error');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // =========================================================
  //  PRINT / PDF - 5-PAGE CCPC PERSONNEL FORM
  // =========================================================

  function printPersonnelForm() {
    const f = document.getElementById('teacherForm');
    if (!f) { showToast('Profile form not found', 'error'); return; }

    const v = name => {
      const el = f.elements[name];
      if (!el) return '';
      return (el.value && el.value.trim()) ? el.value.trim() : '';
    };

    const photoImg = document.getElementById('photoPreviewImg');
    const photoId  = photoImg && photoImg.dataset.fileId ? photoImg.dataset.fileId : '';

    function readDynamic(containerId, colNames) {
      const c = document.getElementById(containerId);
      if (!c) return [];
      return [...c.querySelectorAll('[data-drow]')].map(row => {
        const obj = {};
        colNames.forEach(n => { const el = row.querySelector('[name="' + n + '"]'); obj[n] = el ? el.value.trim() : ''; });
        return obj;
      }).filter(obj => Object.values(obj).some(x => x));
    }

    const countries = readDynamic('countriesContainer', ['country_name[]','duration_from[]','duration_to[]','visit_reasons[]']);
    const languages = readDynamic('languagesContainer', ['language[]','efficiency[]']);
    const siblings  = readDynamic('siblingsContainer',  ['sibling_name[]','sibling_age[]','sibling_nationality[]','sibling_occ_addr[]','sibling_dependency[]']);
    const children  = readDynamic('childrenContainer',  ['child_name[]','child_sex[]','child_dob[]','child_occupation[]','child_address[]']);
    const diseases  = readDynamic('diseasesContainer',  ['disease_name[]','disease_nature[]','disease_date[]','disease_condition[]']);
    const inlaws    = readDynamic('inlawsContainer',    ['inlaw_name[]','inlaw_address[]']);
    const banks     = readDynamic('bankContainer',      ['bank_name[]','bank_account_no[]','bank_account_type[]']);
    const edu       = readDynamic('eduContainer',       ['edu_from[]','edu_to[]','edu_school[]','edu_exam[]','edu_gpa[]','edu_year[]','edu_remarks[]']);

    const heightStr = v('height_feet') ? v('height_feet') + ' ft ' + (v('height_inches') || '0') + ' in' : '';

    // Helper: underlined value cell
    const U = (val, w) => `<span class="uv${val?' has-val':''}"${w?' style="min-width:'+w+'"':''}>${val || ''}</span>`;

    // Blank rows filler for tables
    function padRows(rows, min) {
      const r = [...rows];
      while (r.length < min) r.push({});
      return r;
    }

    function tblRow(obj, keys) {
      return '<tr>' + keys.map(k => `<td>${obj[k] || ''}</td>`).join('') + '</tr>';
    }

    const css = `
      @page { size: A4 portrait; margin: 14mm 16mm 14mm 22mm; }
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      /* ── Page shell: flex column so footer always pins to bottom ── */
      .page{min-height:267mm;display:flex;flex-direction:column;position:relative;page-break-after:always;}
      .page:last-child{page-break-after:auto;}
      .page-body{flex:1;display:flex;flex-direction:column;}
      /* ── Confidential side stamp ── */
      .conf{position:absolute;left:-16mm;top:50%;transform:translateY(-50%) rotate(-90deg);font-size:6.5pt;font-weight:900;letter-spacing:.35em;color:#555;white-space:nowrap;}
      /* ── Page 1 full header ── */
      .ccpc-hdr{text-align:center;border-bottom:2pt solid #000;padding-bottom:5pt;}
      .ccpc-hdr .main{font-size:11.5pt;font-weight:900;letter-spacing:.04em;text-align:center;}
      .ccpc-hdr .sub{font-size:8.5pt;font-weight:700;margin-top:2pt;text-align:center;}
      /* ── Continuation page mini header (pages 2-5) ── */
      .page-mini-hdr{text-align:center;border-bottom:1pt solid #555;border-top:1pt solid #555;padding:3pt 0;font-size:7.5pt;font-weight:900;letter-spacing:.08em;color:#333;}
      /* ── Section titles ── */
      .part-title{font-size:9.5pt;font-weight:900;text-transform:uppercase;text-decoration:underline;text-align:center;margin:0;}
      /* ── Questions: margin-bottom:0 so flex space-between handles all gaps ── */
      .q{display:flex;align-items:flex-start;gap:3pt;margin-bottom:0;font-size:8.5pt;}
      .q>.num{min-width:16pt;font-weight:700;flex-shrink:0;}
      .q>.body{flex:1;}
      .sub{margin-left:16pt;margin-top:3pt;display:flex;flex-wrap:wrap;gap:8pt 14pt;font-size:8.5pt;}
      .sub .item{display:flex;align-items:center;gap:3pt;white-space:nowrap;}
      .sub .item .lbl{font-weight:700;}
      .uv{border-bottom:1pt solid #000;display:inline-block;min-width:60pt;padding-bottom:1pt;line-height:1.3;}
      .uv.has-val{font-weight:600;}
      /* ── Photo ── */
      .photo-box{width:4.5cm;height:4.5cm;border:1pt solid #000;overflow:hidden;display:flex;align-items:center;justify-content:center;}
      .photo-box img{width:100%;height:100%;object-fit:cover;}
      .photo-label{margin-top:3pt;}
      /* ── Centered footer bar ── */
      .pf{text-align:center;border-top:0.5pt solid #aaa;padding-top:4pt;margin-top:6pt;font-size:7.5pt;font-weight:700;letter-spacing:.05em;}
      /* ── Tables ── */
      table{width:100%;border-collapse:collapse;font-size:8pt;margin:3pt 0;}
      th{border:1pt solid #000;padding:3pt 4pt;font-weight:700;background:#eee;font-size:7.5pt;text-align:left;}
      td{border:1pt solid #000;padding:3pt 4pt;min-height:16pt;vertical-align:top;}
      .tbl-title{font-size:8.5pt;font-weight:700;margin:5pt 0 2pt;}
      /* ── Grids ── */
      .g2{display:grid;grid-template-columns:1fr 1fr;gap:4pt 12pt;margin-left:16pt;margin-top:3pt;}
      .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4pt 12pt;margin-left:16pt;margin-top:3pt;}
      .g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4pt 10pt;margin-left:16pt;margin-top:3pt;}
      /* ── Field rows ── */
      .fi{display:flex;align-items:center;gap:4pt;font-size:8.5pt;margin-bottom:3pt;}
      .fi .lbl{font-weight:700;white-space:nowrap;}
      .addr-block{margin-left:16pt;margin-top:3pt;}
      .addr-row{display:flex;gap:4pt;align-items:flex-start;margin-bottom:4pt;font-size:8.5pt;}
      .addr-row .lbl{font-weight:700;white-space:nowrap;}
      /* ── Certificate box ── */
      .cert-box{border:1pt solid #000;padding:12pt;font-size:8.5pt;line-height:1.8;margin-top:10pt;}
      .sign-row{display:flex;justify-content:space-between;margin-top:20pt;}
      .sign-item{text-align:center;}
      .sign-line{border-bottom:1pt solid #000;width:110pt;display:inline-block;}
      .note{font-size:7.5pt;margin-left:16pt;margin-top:2pt;}
      hr.thin{border:none;border-top:0.5pt solid #ccc;margin:6pt 0;}
      @media screen{body{padding:10mm;background:#f0f0f0;}
      .page{background:#fff;padding:14mm 16mm 14mm 22mm;margin:0 auto 8mm;max-width:210mm;min-height:267mm;height:auto;box-shadow:0 2px 8px rgba(0,0,0,.2);}}`;

    // ------------ PAGE 1 ------------
    const photoHtml = photoId
  ? `
    <img
      src="https://lh3.googleusercontent.com/d/${photoId}"
      alt="Photo"
      style="width:100%;height:100%;object-fit:cover"
    >
  `
  : `
    <span style="font-size:7pt;color:#999;">
      PHOTO<br>4.5cm&times;4.5cm
    </span>
  `;

    const p1 = `
    <div class="page">
      <div class="conf">CONFIDENTIAL</div>
      <div class="page-body">

        <!-- Header group: stays together at top -->
        <div>
          <div class="ccpc-hdr">
            <div class="main">CHATTOGRAM CANTONMENT PUBLIC COLLEGE</div>
            <div class="sub">PARTICULARS AND RECORD OF FACULTY MEMBER/OFFICER/STAFF</div>
          </div>
          <div class="part-title" style="margin-top:4pt;">PART I &ndash; PERSONAL INFORMATION</div>
        </div>

        <!-- All 13 questions as direct children → space-between distributes them evenly -->
        <!-- Photo pinned absolute top-right of this container -->
        <div style="position:relative; flex:1; display:flex; flex-direction:column; justify-content:space-between;">

          <!-- Photo: 4.5cm × 4.5cm, absolute top-right corner -->
          <div style="position:absolute;top:0;right:0;width:4.5cm;text-align:center;font-size:7pt;font-weight:700;z-index:2;">
            <div class="photo-box">${photoHtml}</div>
            <div class="photo-label">PHOTO<br>4.5 cm &times; 4.5 cm</div>
          </div>

          <!-- Q1–Q6: right-padded so text avoids photo (photo ≈ 4.5cm + 0.6cm gap) -->
          <div class="q" style="padding-right:5.4cm;"><div class="num">1.</div><div class="body">
            <div class="sub">
              <div class="item"><span class="lbl">(a) ID Number:</span> ${U(v('teacher_id'),'80pt')}</div>
              <div class="item"><span class="lbl">(b) National ID Number:</span> ${U(v('national_id'),'100pt')}</div>
            </div>
          </div></div>

          <div class="q" style="padding-right:5.4cm;"><div class="num">2.</div><div class="body">
            <div class="fi"><span class="lbl">(a) Auth (GB Notification/Office Order etc):</span> ${U(v('auth_ref'),'100pt')}</div>
          </div></div>

          <div class="q" style="padding-right:5.4cm;"><div class="num">3.</div><div class="body">
            <div class="fi"><span class="lbl">Designation:</span> ${U(v('designation'),'110pt')}</div>
          </div></div>

          <div class="q" style="padding-right:5.4cm;"><div class="num">4.</div><div class="body">
            <div class="sub" style="flex-direction:column;gap:3pt;">
              <div class="item"><span class="lbl">NAME (IN BLOCK CAPITAL):</span> ${U(v('full_name'),'110pt')}</div>
              <div class="item"><span class="lbl">নাম (বাংলায়):</span> ${U(v('name_bengali'),'110pt')}</div>
            </div>
          </div></div>

          <div class="q" style="padding-right:5.4cm;"><div class="num">5.</div><div class="body">
            <div class="fi"><span class="lbl">School/College/Admin:</span> ${U(v('school_college'),'110pt')}</div>
          </div></div>

          <div class="q" style="padding-right:5.4cm;"><div class="num">6.</div><div class="body">
            <div class="sub" style="flex-direction:column;gap:3pt;">
              <div class="item"><span class="lbl">(a) Date of Birth:</span> ${U(v('date_of_birth'),'80pt')}</div>
              <div class="item"><span class="lbl">(b) Place (Village/City):</span> ${U(v('place_of_birth'),'90pt')}</div>
              <div class="item"><span class="lbl">(c) Birth Certificate No:</span> ${U(v('birth_certificate_no'),'80pt')}</div>
            </div>
          </div></div>

          <!-- Q7 onwards: full width -->
          <div class="q"><div class="num">7.</div><div class="body">
            <div class="sub">
              <div class="item"><span class="lbl">(a) Height:</span> ${U(v('height_feet'),'36pt')} (Feet) ${U(v('height_inches'),'30pt')} (inch)</div>
              <div class="item"><span class="lbl">(b) Weight:</span> ${U(v('weight_kg'),'40pt')} (in kg)</div>
            </div>
          </div></div>

          <div class="q"><div class="num">8.</div><div class="body">
            <div class="sub">
              <div class="item"><span class="lbl">Blood Group:</span> ${U(v('blood_group'),'60pt')}</div>
              <div class="item"><span class="lbl">Visible Identification Mark(s):</span> ${U(v('identification_marks'),'130pt')}</div>
            </div>
          </div></div>

          <div class="q"><div class="num">9.</div><div class="body">
            <div class="fi"><span class="lbl">Medical History Details:</span></div>
            <div class="sub">
              <div class="item"><span class="lbl">(a) Present Medical Category:</span> ${U(v('medical_category'),'70pt')}</div>
              <div class="item"><span class="lbl">(b) Nature of Disability (if any):</span> ${U(v('disability_nature'),'100pt')}</div>
              <div class="item"><span class="lbl">(c) Attributably (if any):</span> ${U(v('disability_attributable'),'90pt')}</div>
            </div>
          </div></div>

          <div class="q"><div class="num">10.</div><div class="body">
            <div class="sub">
              <div class="item"><span class="lbl">a. Religion:</span> ${U(v('religion'),'80pt')}</div>
              <div class="item"><span class="lbl">b. Cast:</span> ${U(v('caste'),'80pt')}</div>
            </div>
          </div></div>

          <div class="q"><div class="num">11.</div><div class="body">
            <div class="sub">
              <div class="item"><span class="lbl">Nationality:</span> ${U(v('nationality'),'100pt')}</div>
              <div class="item"><span class="lbl">Previous Nationality (if any):</span> ${U(v('previous_nationality'),'100pt')}</div>
            </div>
          </div></div>

          <div class="q"><div class="num">12.</div><div class="body">
            <div class="fi"><span class="lbl">Address(es):</span></div>
            <div class="addr-block">
              <div class="addr-row"><span class="lbl">a. Permanent Address:</span> ${U(v('permanent_address'),'240pt')}</div>
              <div class="addr-row"><span class="lbl">b. Present Address:</span> ${U(v('present_address'),'250pt')}</div>
              <div class="addr-row"><span class="lbl">c. Alternate Present Address (If Any):</span> ${U(v('alternate_address'),'200pt')}</div>
            </div>
          </div></div>

          <div class="q"><div class="num">13.</div><div class="body">
            <div class="fi"><span class="lbl">Contact Details:</span></div>
            <div class="sub">
              <div class="item"><span class="lbl">a. Personal e-mail Address:</span> ${U(v('personal_email'),'140pt')}</div>
              <div class="item"><span class="lbl">b. T&amp;T Phone Number:</span> ${U(v('tt_phone'),'90pt')}</div>
              <div class="item"><span class="lbl">c. Mobile Number:</span> ${U(v('mobile'),'90pt')}</div>
            </div>
          </div></div>

        </div><!-- end questions flex container -->
      </div>
      <div class="pf">1 &nbsp;&mdash;&nbsp; CONFIDENTIAL</div>
    </div>`;

    // ------------ PAGE 2 ------------
    const ctryRows = padRows(countries, 3).map(r => `<tr><td></td><td>${r['country_name[]']||''}</td><td>${r['duration_from[]']||''}</td><td>${r['duration_to[]']||''}</td><td>${r['visit_reasons[]']||''}</td></tr>`).join('');
    const langRows = padRows(languages, 2).map(r => `<tr><td></td><td>${r['language[]']||''}</td><td>${r['efficiency[]']||''}</td></tr>`).join('');

    const p2 = `
    <div class="page">
      <div class="conf">CONFIDENTIAL</div>
      <div class="page-body" style="justify-content:space-between;">
        <div class="page-mini-hdr">CHATTOGRAM CANTONMENT PUBLIC COLLEGE &mdash; PERSONNEL RECORD (Contd.)</div>

        <div class="q"><div class="num">14.</div><div class="body">
          <div class="fi"><span class="lbl">Passport:</span></div>
          <div class="sub">
            <div class="item"><span class="lbl">a. Passport Number:</span> ${U(v('passport_number'),'100pt')}</div>
            <div class="item"><span class="lbl">b. Date of Issue:</span> ${U(v('passport_date_issue'),'80pt')}</div>
            <div class="item"><span class="lbl">c. Place of Issue:</span> ${U(v('passport_place_issue'),'100pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">d. Date of Expiry:</span> ${U(v('passport_date_expiry'),'80pt')}</div>
            <div class="item"><span class="lbl">e. Issuing Auth.:</span> ${U(v('passport_issuing_auth'),'120pt')}</div>
            <div class="item"><span class="lbl">f. Type of Passport:</span> ${U(v('passport_type'),'80pt')}</div>
          </div>
        </div></div>

        <div class="q"><div class="num">15.</div><div class="body">
          <div class="tbl-title">Countries Visited (Add Additional Pages for More Information):</div>
          <table>
            <thead><tr><th style="width:24pt;">Ser</th><th>Name of Country</th><th>Duration From</th><th>To</th><th>Reasons for Visiting</th></tr></thead>
            <tbody>${ctryRows}</tbody>
          </table>
        </div></div>

        <div class="q"><div class="num">16.</div><div class="body">
          <div class="tbl-title">Language Skill (Except Bengali &amp; English) &mdash; Please specify speaking, Writing &amp; Reading:</div>
          <table>
            <thead><tr><th style="width:24pt;">Ser</th><th>Language</th><th>Efficiency</th></tr></thead>
            <tbody>${langRows}</tbody>
          </table>
        </div></div>

        <div class="q"><div class="num">17.</div><div class="body">
          <div class="fi"><span class="lbl">Father's Details:</span></div>
          <div class="sub">
            <div class="item"><span class="lbl">a. Father's Name in Full:</span> ${U(v('father_name'),'160pt')}</div>
            <div class="item"><span class="lbl">b. Nationality:</span> ${U(v('father_nationality'),'90pt')}</div>
            <div class="item"><span class="lbl">c. Previous Nationality (if any):</span> ${U(v('father_prev_nationality'),'100pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item" style="white-space:normal;flex:1;"><span class="lbl">d. Date of Bangladesh Citizenship and Authority (if Applicable):</span> ${U(v('father_citizenship_auth'),'120pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">Present Age:</span> ${U(v('father_present_age'),'50pt')}</div>
            <div class="item"><span class="lbl">or Date of Decease:</span> ${U(v('father_date_of_decease'),'80pt')}</div>
            <div class="item"><span class="lbl">Annual Average Income:</span> ${U(v('father_annual_income'),'80pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item" style="white-space:normal;flex:1;"><span class="lbl">e. Father's Occupation / Profession:</span> ${U(v('father_occupation'),'200pt')}</div>
          </div>
        </div></div>

        <div class="q"><div class="num">18.</div><div class="body">
          <div class="fi"><span class="lbl">Mother's Details:</span></div>
          <div class="sub">
            <div class="item"><span class="lbl">a. Mother's Name in Full:</span> ${U(v('mother_name'),'160pt')}</div>
            <div class="item"><span class="lbl">b. Nationality:</span> ${U(v('mother_nationality'),'90pt')}</div>
            <div class="item"><span class="lbl">c. Previous Nationality (if any):</span> ${U(v('mother_prev_nationality'),'100pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item" style="white-space:normal;flex:1;"><span class="lbl">d. Date of Bangladesh Citizenship and Authority (if Applicable):</span> ${U(v('mother_citizenship_auth'),'120pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">Present Age:</span> ${U(v('mother_present_age'),'50pt')}</div>
            <div class="item"><span class="lbl">or Date of Decease:</span> ${U(v('mother_date_of_decease'),'80pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item" style="white-space:normal;flex:1;"><span class="lbl">e. Mother's Occupation / Profession:</span> ${U(v('mother_occupation'),'200pt')}</div>
          </div>
        </div></div>
      </div>
      <div class="pf">2 &nbsp;&mdash;&nbsp; CONFIDENTIAL</div>
    </div>`;

    // ------------ PAGE 3 ------------
    const sibRows = padRows(siblings, 3).map((r,i) => `<tr><td style="text-align:center;">${i+1}</td><td>${r['sibling_name[]']||''}</td><td>${r['sibling_age[]']||''}</td><td>${r['sibling_nationality[]']||''}</td><td>${r['sibling_occ_addr[]']||''}</td><td>${r['sibling_dependency[]']||''}</td></tr>`).join('');

    const maritalOpts = ['Married','Unmarried','Widow','Divorcee'].map(o =>
      `<span style="margin-right:12pt;">${v('marital_status')===o?'<strong>[&#10003;]</strong>':'[ ]'} ${o}</span>`).join('');

    const p3 = `
    <div class="page">
      <div class="conf">CONFIDENTIAL</div>
      <div class="page-body" style="justify-content:space-between;">
        <div class="page-mini-hdr">CHATTOGRAM CANTONMENT PUBLIC COLLEGE &mdash; PERSONNEL RECORD (Contd.)</div>

        <div class="q"><div class="num">19.</div><div class="body">
          <div class="tbl-title">Own Brothers and Sisters:</div>
          <table>
            <thead><tr><th style="width:24pt;">Ser</th><th>Name in Full</th><th style="width:30pt;">Age</th><th>Nationality</th><th>Occupation and Present Address</th><th style="width:55pt;">Dependency (On You)</th></tr></thead>
            <tbody>${sibRows}</tbody>
          </table>
          <div class="fi" style="margin-top:5pt;margin-left:0;"><span class="lbl">f. Annual Average Income:</span> ${U('','120pt')}</div>
        </div></div>

        <div class="q"><div class="num">20.</div><div class="body">
          <div class="fi"><span class="lbl">Position of Own within Brothers and Sisters:</span> ${U(v('position_in_siblings'),'160pt')}</div>
        </div></div>

        <div class="q"><div class="num">21.</div><div class="body">
          <div class="fi"><span class="lbl">Marital Status (Please Tick):</span> ${maritalOpts}</div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">(b) Date of Marriage/Divorce/Widow:</span> ${U(v('marriage_divorce_date'),'90pt')}</div>
            <div class="item"><span class="lbl">(c) Authority:</span> ${U(v('marriage_authority'),'100pt')}</div>
          </div>
        </div></div>

        <div class="q"><div class="num">22.</div><div class="body">
          <div class="fi"><span class="lbl">Details of Spouse:</span></div>
          <div class="sub">
            <div class="item"><span class="lbl">a. NAME (IN BLOCK CAPITAL):</span> ${U(v('spouse_name_en'),'140pt')}</div>
            <div class="item"><span class="lbl">নাম (বাংলায়):</span> ${U(v('spouse_name_bn'),'120pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">b. Date of Birth:</span> ${U(v('spouse_dob'),'80pt')}</div>
            <div class="item"><span class="lbl">c. Place of Birth:</span> ${U(v('spouse_pob'),'100pt')}</div>
            <div class="item"><span class="lbl">d. Birth Registration Number:</span> ${U(v('spouse_birth_reg'),'90pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">e. Nationality:</span> ${U(v('spouse_nationality'),'90pt')}</div>
            <div class="item"><span class="lbl">Previous Nationality (if any):</span> ${U(v('spouse_prev_nationality'),'90pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item" style="white-space:normal;flex:1;"><span class="lbl">Authority of Bangladesh Citizenship (If Applicable):</span> ${U(v('spouse_citizenship_auth'),'140pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">f. National ID Card Number:</span> ${U(v('spouse_nid'),'90pt')}</div>
            <div class="item"><span class="lbl">g. Educational Qualification:</span> ${U(v('spouse_education'),'110pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">h. Occupation of Spouse:</span> ${U(v('spouse_occupation'),'100pt')}</div>
            <div class="item"><span class="lbl">j. Occupation Designation:</span> ${U(v('spouse_occ_designation'),'100pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item" style="white-space:normal;flex:1;"><span class="lbl">k. Occupation Address:</span> ${U(v('spouse_occ_address'),'230pt')}</div>
          </div>
          <div class="sub" style="margin-top:4pt;">
            <div class="item"><span class="lbl">l. Previous Occupation:</span> ${U(v('spouse_prev_occupation'),'160pt')}</div>
          </div>
        </div></div>

        <div class="q"><div class="num">23.</div><div class="body">
          <div class="fi"><span class="lbl">TID/BIN No:</span> ${U(v('tid_bin_no'),'120pt')}</div>
        </div></div>
      </div>
      <div class="pf">3 &nbsp;&mdash;&nbsp; CONFIDENTIAL</div>
    </div>`;

    // ------------ PAGE 4 ------------
    const childRows = padRows(children, 3).map((r,i) => `<tr><td style="text-align:center;">${i+1}</td><td>${r['child_name[]']||''}</td><td>${r['child_sex[]']||''}</td><td>${r['child_dob[]']||''}</td><td>${r['child_occupation[]']||''}</td><td>${r['child_address[]']||''}</td></tr>`).join('');
    const diseaseRows = padRows(diseases, 2).map(r => `<tr><td>${r['disease_name[]']||''}</td><td>${r['disease_nature[]']||''}</td><td>${r['disease_date[]']||''}</td><td>${r['disease_condition[]']||''}</td></tr>`).join('');
    const inlawRows  = padRows(inlaws, 3).map(r => `<tr><td>${r['inlaw_name[]']||''}</td><td>${r['inlaw_address[]']||''}</td></tr>`).join('');
    const bankRows   = padRows(banks, 2).map(r => `<tr><td>${r['bank_name[]']||''}</td><td>${r['bank_account_no[]']||''}</td><td>${r['bank_account_type[]']||''}</td></tr>`).join('');
    const eduRows    = padRows(edu, 3).map(r => `<tr><td>${r['edu_from[]']||''}</td><td>${r['edu_to[]']||''}</td><td>${r['edu_school[]']||''}</td><td>${r['edu_exam[]']||''}</td><td>${r['edu_gpa[]']||''}</td><td>${r['edu_year[]']||''}</td><td>${r['edu_remarks[]']||''}</td></tr>`).join('');

    const p4 = `
    <div class="page">
      <div class="conf">CONFIDENTIAL</div>
      <div class="page-body" style="justify-content:space-between;">
        <div class="page-mini-hdr">CHATTOGRAM CANTONMENT PUBLIC COLLEGE &mdash; PERSONNEL RECORD (Contd.)</div>

        <div class="q"><div class="num">24.</div><div class="body">
          <div class="fi"><span class="lbl">Details of Income:</span></div>
          <div class="sub">
            <div class="item"><span class="lbl">a. Own Income:</span> ${U(v('own_income'),'80pt')}</div>
            <div class="item"><span class="lbl">b. Spouse Income:</span> ${U(v('spouse_income'),'80pt')}</div>
            <div class="item"><span class="lbl">c. Income from Assets:</span> ${U(v('assets_income'),'80pt')}</div>
          </div>
          <div class="addr-row" style="margin-top:4pt;margin-left:16pt;"><span class="lbl">d. Details of Assets:</span> ${U(v('assets_details'),'280pt')}</div>
        </div></div>

        <div class="q"><div class="num">25.</div><div class="body">
          <div class="tbl-title">Particulars of Children:</div>
          <table>
            <thead><tr><th style="width:24pt;">Ser</th><th>Name of Children</th><th style="width:30pt;">Sex</th><th>Date of Birth</th><th>Occupation</th><th>Present Address</th></tr></thead>
            <tbody>${childRows}</tbody>
          </table>
        </div></div>

        <div class="q"><div class="num">26.</div><div class="body">
          <div class="tbl-title">Particulars of Chronic/Severe Disease of Self/Spouse/Children (Add Additional pages for more Information):</div>
          <table>
            <thead><tr><th>Name</th><th>Nature of Disease</th><th>Date of Illness</th><th>Present Condition</th></tr></thead>
            <tbody>${diseaseRows}</tbody>
          </table>
        </div></div>

        <div class="q"><div class="num">27.</div><div class="body">
          <div class="tbl-title">Name and Address of all Brother and Sister-in-laws:</div>
          <table>
            <thead><tr><th>Name in Full</th><th>Address</th></tr></thead>
            <tbody>${inlawRows}</tbody>
          </table>
        </div></div>

        <div class="q"><div class="num">28.</div><div class="body">
          <div class="tbl-title">Details of Bank Accounts (Add Additional Pages for More Information):</div>
          <table>
            <thead><tr><th>a. Name of Bank</th><th>b. Account Number</th><th>c. Type of Account</th></tr></thead>
            <tbody>${bankRows}</tbody>
          </table>
        </div></div>

        <hr class="thin">
        <div class="part-title">PART II &ndash; EDUCATION</div>

        <div class="q"><div class="num">29.</div><div class="body">
          <div class="tbl-title">Educational Qualification(s):</div>
          <table>
            <thead><tr><th>From</th><th>To</th><th>School/College/University</th><th>Examination Passed (Give Subjects)</th><th>Division/GPA Obtained</th><th>Year of Passing</th><th>Remarks (Board Standing)</th></tr></thead>
            <tbody>${eduRows}</tbody>
          </table>
        </div></div>

        <div class="q"><div class="num">30.</div><div class="body">
          <div class="fi"><span class="lbl">Additional Qualification (If Any):</span></div>
          <div style="border:1pt solid #ccc;padding:6pt;margin-top:3pt;min-height:30pt;font-size:8.5pt;line-height:1.6;">${v('additional_qualification')||''}</div>
        </div></div>
      </div>
      <div class="pf">4 &nbsp;&mdash;&nbsp; CONFIDENTIAL</div>
    </div>`;

    // ------------ PAGE 5 ------------
    const today = new Date();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    const p5 = `
    <div class="page">
      <div class="conf">CONFIDENTIAL</div>
      <div class="page-body" style="justify-content:space-between;">
        <div class="page-mini-hdr">CHATTOGRAM CANTONMENT PUBLIC COLLEGE &mdash; PERSONNEL RECORD (Contd.)</div>
        <div class="part-title">PART III &ndash; EVENTS AFFECTING CAREER</div>

        <div class="q"><div class="num">31.</div><div class="body">
          <div class="fi"><span class="lbl">Details of Breaking Institution Law:</span></div>
          <div style="border:1pt solid #ccc;min-height:44pt;padding:5pt;font-size:8.5pt;line-height:1.6;margin-top:3pt;">${v('institution_law_breaking')||''}</div>
        </div></div>

        <div class="q"><div class="num">32.</div><div class="body">
          <div class="fi"><span class="lbl">Details of Breaking Civil Law (If Applicable):</span></div>
          <div style="border:1pt solid #ccc;min-height:44pt;padding:5pt;font-size:8.5pt;line-height:1.6;margin-top:3pt;">${v('civil_law_breaking')||''}</div>
        </div></div>

        <div class="q"><div class="num">33.</div><div class="body">
          <div class="fi"><span class="lbl">Identification Marks:</span> ${U(v('identification_marks'),'200pt')}</div>
        </div></div>

        <hr class="thin">
        <div class="part-title">PART IV &ndash; CERTIFICATE</div>

        <div class="cert-box">
          <p style="font-style:italic;font-size:8pt;">(To be filled by concerned Faculty Member / Officer / Staff in own hand)</p>
          <p style="margin-top:8pt;line-height:2;">35. I ${U(v('full_name'),'160pt')} (Designation ${U(v('designation'),'120pt')}) do hereby solemnly state that the statement and particulars given by me in Part I to IV above are true, complete and I have not withheld any relevant facts. I understand that in the event of any of the contents of the preceding parts being found incorrect or incomplete, I shall be liable to punishment.</p>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22pt;">
            <div style="font-size:8.5pt;">Dated:&nbsp; ${U(today.getDate().toString(),'28pt')} &nbsp; ${months[today.getMonth()]} &nbsp; ${today.getFullYear()}</div>
            <div style="text-align:center;">
              <div class="sign-line"></div>
              <div style="font-size:7.5pt;margin-top:4pt;">Signature of Faculty Member / Officer / Staff</div>
            </div>
          </div>
          <div style="margin-top:12pt;display:grid;grid-template-columns:1fr 1fr;gap:8pt;">
            <div class="fi"><span class="lbl">Name:</span> ${U(v('full_name'),'120pt')}</div>
            <div class="fi"><span class="lbl">Appointment:</span> ${U(v('joining_date'),'100pt')}</div>
            <div class="fi"><span class="lbl">Designation:</span> ${U(v('designation'),'120pt')}</div>
            <div class="fi"><span class="lbl">Department:</span> ${U(v('school_college'),'120pt')}</div>
          </div>
        </div>

        <div style="text-align:center;font-size:10.5pt;font-weight:900;text-decoration:underline;margin-top:18pt;letter-spacing:.12em;">COUNTERSIGN</div>
        <div style="border-bottom:1pt solid #000;margin-top:40pt;"></div>
        <div style="text-align:center;font-size:7.5pt;margin-top:3pt;font-weight:700;">Signature &amp; Designation of Countersigning Authority</div>
      </div>
      <div class="pf">5 &nbsp;&mdash;&nbsp; CONFIDENTIAL</div>
    </div>`;

    const fullHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
      <title>Personnel Record &mdash; ${v('full_name') || v('teacher_id') || 'CCPC'}</title>
      <style>${css}</style></head><body>${p1}${p2}${p3}${p4}${p5}</body></html>`;

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'width=900,height=700');
    if (!win) {
      showToast('Popup blocked - please allow popups for this site and try again', 'error');
      URL.revokeObjectURL(url);
      return;
    }
    win.focus();
    setTimeout(function() { win.print(); setTimeout(function() { URL.revokeObjectURL(url); }, 1000); }, 800);
  }

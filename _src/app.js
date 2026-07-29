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

  // ══════════════════════════════════════════════════════
  //  THEME / GRADIENT — admin-configurable, applied for all
  // ══════════════════════════════════════════════════════
  const THEME_PRESETS = {
    aurora:   { name:'Aurora',   stops:['#eaf2ff','#f4f0ff','#fdf1f9','#eefcff','#eef4ff'], accents:['#6366f1','#38bdf8','#ec4899','#10b981'] },
    ocean:    { name:'Ocean',    stops:['#e0f2fe','#e6fffb','#eff6ff','#ecfeff','#e0f7fa'], accents:['#0ea5e9','#06b6d4','#3b82f6','#14b8a6'] },
    sunset:   { name:'Sunset',   stops:['#fff1e6','#ffe9ef','#fef3c7','#ffe4e6','#fff7ed'], accents:['#fb923c','#f43f5e','#f59e0b','#ec4899'] },
    forest:   { name:'Forest',   stops:['#ecfdf5','#f0fdf4','#f7fee7','#ecfccb','#effdf5'], accents:['#10b981','#22c55e','#84cc16','#14b8a6'] },
    lavender: { name:'Lavender', stops:['#f5f3ff','#faf5ff','#fdf4ff','#f3e8ff','#f5f3ff'], accents:['#8b5cf6','#a855f7','#d946ef','#6366f1'] },
    blossom:  { name:'Blossom',  stops:['#fff1f2','#fdf2f8','#fce7f3','#ffe4e6','#fff1f2'], accents:['#fb7185','#ec4899','#f472b6','#e11d48'] },
    graphite: { name:'Graphite', stops:['#f8fafc','#eef2f7','#f1f5f9','#e9eef5','#f8fafc'], accents:['#64748b','#475569','#94a3b8','#334155'] },
  };
  const DEFAULT_THEME = { mode:'preset', preset:'aurora' };
  window.APP_THEME = DEFAULT_THEME;

  function _hexToRgba(hex, a) {
    let h = String(hex || '').replace('#','');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h || '888888', 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }

  function _themeColors(theme) {
    if (theme && theme.mode === 'custom' && Array.isArray(theme.stops) && theme.stops.length) {
      return { stops: theme.stops, accents: (theme.accents && theme.accents.length) ? theme.accents : theme.stops };
    }
    const p = THEME_PRESETS[(theme && theme.preset) || 'aurora'] || THEME_PRESETS.aurora;
    return { stops: p.stops, accents: p.accents };
  }

  function applyTheme(theme) {
    const { stops, accents } = _themeColors(theme);
    const n = Math.max(stops.length, 2);
    const stopStr = stops.map((c,i) => `${c} ${Math.round(i/(n-1)*100)}%`).join(', ');
    const bg = `linear-gradient(135deg, ${stopStr})`;
    const pos    = ['10% 12%','92% 8%','85% 92%','18% 95%'];
    const sizes  = ['42rem 42rem','38rem 38rem','46rem 46rem','34rem 34rem'];
    const alphas = [0.18, 0.16, 0.12, 0.12];
    const glow = accents.slice(0,4).map((c,i) =>
      `radial-gradient(${sizes[i]} at ${pos[i]}, ${_hexToRgba(c, alphas[i])}, transparent 62%)`).join(', ');
    const root = document.documentElement.style;
    root.setProperty('--app-bg', bg);
    root.setProperty('--app-glow', glow);
    window.APP_THEME = theme || DEFAULT_THEME;
  }

  function loadAndApplyTheme() {
    google.script.run.withSuccessHandler(settings => {
      const t = settings && settings.theme_gradient;
      applyTheme((t && (t.preset || (t.stops && t.stops.length))) ? t : DEFAULT_THEME);
    }).withFailureHandler(() => {}).getSystemSettings();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Warm up Vercel serverless function immediately so login isn't delayed by cold start.
    // getSystemSettings is lightweight and also applies the saved gradient theme on the login screen.
    loadAndApplyTheme();

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

  let _loadingTimer = null;
  function showLoading(show) {
    const el = document.getElementById('loading');
    if (!el) return;
    el.classList.toggle('hidden', !show);
    clearTimeout(_loadingTimer);
    if (show) {
      // Longer than the shim's own 25s fetch-abort timeout (shim.js), so a
      // slow request's real failure handler (with an actual error message)
      // gets to fire and hide this first — this is only the last-resort
      // backstop for a request that never calls either handler at all.
      _loadingTimer = setTimeout(() => {
        el.classList.add('hidden');
        console.warn('[CCPC] Loading spinner auto-hidden after timeout');
      }, 30000);
    }
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

    google.script.run
      .withSuccessHandler(res => {
        showLoading(false);
        restoreBtn();
        if (res && res.success) {
          window.APP_USER    = res;
          window.USER_ROLES  = res.roles || [res.role];
          window.ACTIVE_ROLE = res.role;
          window.USER_ROLE   = res.role;
          if (res.profile) window._loginProfile = res.profile; // pre-loaded scalar profile
          localStorage.setItem('ccpc_user_id', id);
          localStorage.setItem('ccpc_pass', pass);
          launchDashboard();
        } else if (isAuto) {
          if (loginId) loginId.value = id;
          if (loginPw) loginPw.value = pass;
        } else {
          localStorage.removeItem('ccpc_user_id');
          localStorage.removeItem('ccpc_pass');
          if (err) err.classList.remove('hidden');
        }
      })
      .withFailureHandler((e) => {
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
      .loginAndGetProfile(id, pass);
  }

  function logout() {
    if (window.confirm("Are you sure you want to sign out?")) {
      localStorage.removeItem('ccpc_user_id');
      localStorage.removeItem('ccpc_pass');
      window.APP_USER = null;
      window.USER_ROLE = null;
      window.removeEventListener('hashchange', _routeByHash);
      _destroyRealtime();
      history.replaceState(null, '', window.location.pathname);
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('app-screen').classList.add('hidden');
      document.getElementById('view-container').innerHTML = '';
    }
  }

  // --- MOBILE SIDEBAR TOGGLE ---
  function openMobileSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('-translate-x-full');
    if (overlay) overlay.classList.remove('hidden');
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('-translate-x-full');
    if (overlay) overlay.classList.add('hidden');
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar-collapsed');
    const icon = document.getElementById('toggle-icon');
    if (icon) {
      const isCollapsed = sidebar.classList.contains('sidebar-collapsed');
      icon.setAttribute('data-lucide', isCollapsed ? 'chevron-right' : 'chevron-left');
      lucide.createIcons();
    }
    localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('sidebar-collapsed'));
  }

  // --- NAVIGATION & VIEWS ---

  // Hash routing helpers — give every sidebar view a bookmarkable URL.
  // Uses replaceState so the browser's Back button exits the portal rather
  // than cycling through internal views (desired for a modal-style SPA).
  const _HASH_ROUTES = {
    dashboard:     () => loadDefaultView(),
    system:        () => loadSystemView(),
    committees:    () => loadMyCommittees(),
    messages:      () => loadMessagesView(),
    notifications: () => loadNotificationsView(),
    users:         () => loadUsersDirectory(),
    routine:       () => loadRoutineView(),
    inventory:     () => loadInventoryView(),
    myclass:       () => loadMyClassView(),
    student_portal:() => loadStudentPortalView()
  };

  function _setViewHash(key) {
    history.replaceState(null, '', '#' + key);
  }

  function _routeByHash() {
    const key = window.location.hash.slice(1).split('?')[0];
    // Admin-configurable module visibility gates direct hash navigation too,
    // not just the nav links — see MODULE_REGISTRY / _isModuleVisibleForRole.
    // student_portal is exempt from this early gate: a plain Teacher/Staff
    // with only a field-category grant (no role-based visibility at all)
    // must still be able to reach it — loadStudentPortalView does its own
    // complete access check (role OR ERP-tab grant OR field-category
    // grant) and shows the same "not available" toast if none apply.
    if (key && key !== 'student_portal' && MODULE_REGISTRY.some(m => m.key === key) && !_isModuleVisibleForRole(key, window.ACTIVE_ROLE)) {
      // Silently redirect to dashboard — no error toast for URL tampering
      loadDefaultView();
      return;
    }
    const fn = _HASH_ROUTES[key];
    if (fn) fn(); else loadDefaultView();
  }

  function launchDashboard() {
    if (!window.APP_USER) return;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('side-user-id').textContent = window.APP_USER.user_id;
    document.getElementById('side-user-role').textContent = window.ACTIVE_ROLE;
    updateSidebarForRole(window.ACTIVE_ROLE);
    _loadModuleVisibility(() => updateSidebarForRole(window.ACTIVE_ROLE));
    startSessionHeartbeat();
    loadAndApplyTheme();
    _initRealtime();
    // Route to saved hash (supports refresh & bookmarked views)
    _routeByHash();
    window.addEventListener('hashchange', _routeByHash);
  }

  function _initRealtime() {
    if (!window.APP_USER || !window.supabase) return;
    const myId = window.APP_USER.user_id;
    fetch('/api/config').then(r => r.json()).then(cfg => {
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
      _sbClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
      _sbChannel = _sbClient.channel('user:' + myId)
        .on('broadcast', { event: 'new_message' }, ({ payload }) => {
          _loadConversations(true);
          refreshMessagesBadge();
          // If the sender's thread is currently open, refresh it immediately
          if (_activePartnerId && payload && payload.from === _activePartnerId) {
            _refreshThread(_activePartnerId, true);
          }
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (payload && payload.from === _activePartnerId) _showTypingIndicator();
        })
        .subscribe();
    }).catch(() => {});
  }

  function _destroyRealtime() {
    try { if (_sbChannel) _sbClient.removeChannel(_sbChannel); } catch(e) {}
    _sbClient  = null;
    _sbChannel = null;
  }

  let _typingTimer    = null;
  let _typingSendTimer = null;
  function _showTypingIndicator() {
    const el = document.getElementById('msgTypingIndicator');
    if (!el) return;
    el.classList.remove('hidden');
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  }
  // Debounced broadcast so we don't flood with every keystroke
  function _broadcastTyping() {
    if (!_sbClient || !_activePartnerId) return;
    if (_typingSendTimer) return;   // already scheduled — skip
    _typingSendTimer = setTimeout(() => {
      _typingSendTimer = null;
      const myId = window.APP_USER && window.APP_USER.user_id;
      if (!myId || !_activePartnerId) return;
      _sbClient.channel('user:' + _activePartnerId)
        .send({ type: 'broadcast', event: 'typing', payload: { from: myId } })
        .catch(() => {});
    }, 1000);
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

    // Per-module visibility — admin-configurable via the System > Module
    // Access panel (MODULE_REGISTRY / _isModuleVisibleForRole). Falls back to
    // the same defaults this used to hardcode until an Admin saves a matrix.
    MODULE_REGISTRY.forEach(m => {
      const el = document.getElementById(m.navId);
      if (el) el.style.display = _isModuleVisibleForRole(m.key, activeRole) ? '' : 'none';
    });
    // Hide a nav section's group container/label if every link inside it is hidden
    ['admin-links', 'teacher-links'].forEach(id => {
      const container = document.getElementById(id);
      if (!container) return;
      const anyVisible = [...container.querySelectorAll('.nav-link')].some(a => a.style.display !== 'none');
      container.classList.toggle('hidden', !anyVisible);
    });

    _maybeRevealStudentPortalForGrantee(activeRole);
    _loadAdminSubnav(activeRole);

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

  // A plain Teacher/Staff granted a field-category (student.field_access_grants,
  // via the Admin's "Viewer Access Grants" panel) has no role that makes
  // MODULE_DEFAULTS show the Student Portal nav link — so if the role-based
  // pass just hid it, ask once whether this specific account has any grant
  // anyway, and reveal it if so. Admin/Student Portal Admin already see it
  // via the normal role matrix and never need this extra round-trip.
  function _maybeRevealStudentPortalForGrantee(activeRole) {
    if (activeRole === 'Admin' || activeRole === 'Student Portal Admin') return;
    const myId = window.APP_USER && window.APP_USER.user_id;
    const navEl = document.getElementById('nav-student-portal');
    if (!myId || !navEl || navEl.style.display !== 'none') return;
    fetch('/api/student-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_my_access', payload: {}, user_id: myId })
    }).then(r => r.ok ? r.json() : null).then(res => {
      const hasCategories = res && res.result === 'success' && Array.isArray(res.categories) && res.categories.length;
      const hasClassAccess = res && res.result === 'success' && Array.isArray(res.classAccess) && res.classAccess.length;
      if (hasCategories || hasClassAccess) {
        window._hasFieldCategoryAccess = true; // loadStudentPortalView's own role gate checks this too
        navEl.style.display = '';
        const container = document.getElementById('admin-links');
        if (container) container.classList.remove('hidden');
      }
    }).catch(() => {});
  }

  // All 13 destinations nested under "Student Portal" in the sidebar — every
  // one a native view calling the same /api/student-admin backend directly
  // via _adminFetch (no iframe anywhere in this app anymore). The 5 ERP-tab
  // entries (erp:true) stay gated per-account by the admin-editable
  // admin_tab_visibility matrix (get_my_tab_access, self-service — e.g. an
  // HR account sees just "Payroll" without needing Admin/Student Portal
  // Admin); the rest are shown to any Admin/Student Portal Admin. A plain
  // grantee with neither of those (only a field-category grant) never sees
  // this list at all — see _studentPortalNavClick/loadViewerPanelView.
  const ADMIN_SUBNAV_ITEMS = [
    { key: 'setup', label: 'Setup', icon: 'sliders-horizontal', erp: false, action: { type: 'native', fn: 'loadAdminSetupView' } },
    { key: 'add_custom_form', label: '+ Add Custom Form', icon: 'plus-circle', erp: false, action: { type: 'native', fn: 'loadAdminAddCustomFormView' } },
    { key: 'data', label: 'Data', icon: 'table', erp: false, action: { type: 'native', fn: 'loadAdminDataView' } },
    { key: 'access', label: 'Access', icon: 'shield-check', erp: false, action: { type: 'native', fn: 'loadAdminAccessView' } },
    { key: 'class_teacher', label: 'Assign Class Teacher', icon: 'user-check', erp: false, action: { type: 'native', fn: 'loadAdminClassTeacherView' } },
    { key: 'fees', label: 'Fees', icon: 'wallet', erp: true, action: { type: 'native', fn: 'loadAdminFeesView' } },
    { key: 'attendance', label: 'Attendance', icon: 'fingerprint', erp: true, action: { type: 'native', fn: 'loadAdminAttendanceView' } },
    { key: 'exams', label: 'Exams', icon: 'clipboard-list', erp: true, action: { type: 'native', fn: 'loadAdminExamsView' } },
    { key: 'payroll', label: 'Payroll', icon: 'banknote', erp: true, action: { type: 'native', fn: 'loadAdminPayrollView' } },
    { key: 'transport', label: 'Transport', icon: 'bus', erp: true, action: { type: 'native', fn: 'loadAdminTransportView' } },
    { key: 'history', label: 'History', icon: 'clock', erp: false, action: { type: 'native', fn: 'loadAdminHistoryView' } },
    { key: 'photo', label: 'Photo', icon: 'camera', erp: false, action: { type: 'native', fn: 'loadAdminPhotoView' } },
    { key: 'notices', label: 'Notices', icon: 'megaphone', erp: false, action: { type: 'native', fn: 'loadAdminNoticesView' } },
    { key: 'import', label: 'Import', icon: 'file-spreadsheet', erp: false, action: { type: 'native', fn: 'loadAdminImportView' } },
    { key: 'bus_tracker', label: 'Bus Tracker', icon: 'map-pin', erp: false, action: { type: 'native', fn: 'loadAdminBusTrackerView' } },
  ];

  // "Student Portal" is a pure expand/collapse subheader now — its own click
  // never navigates anywhere, it just shows/hides the 14 items nested under
  // it in this same sidebar (one panel, not two).
  function toggleAdminSubnav() {
    const host = document.getElementById('erp-links');
    const parent = document.getElementById('nav-student-portal');
    if (!host || !parent) return;
    const nowExpanded = !parent.classList.contains('expanded');
    parent.classList.toggle('expanded', nowExpanded);
    host.classList.toggle('collapsed', !nowExpanded);
  }

  // A field-category-only viewer (see _maybeRevealStudentPortalForGrantee)
  // has no ERP tab and isn't Admin, so _loadAdminSubnav renders zero items
  // under "Student Portal" for them — expanding an empty list would be a
  // dead end. For that one case, clicking the header goes straight to their
  // own restricted Viewer Panel instead of toggling the (empty) subnav.
  function _studentPortalNavClick() {
    const isFullAdmin = window.ACTIVE_ROLE === 'Admin' || window.ACTIVE_ROLE === 'Student Portal Admin';
    if (!isFullAdmin && !window._hasErpTabAccess && window._hasFieldCategoryAccess) {
      loadViewerPanelView();
      return;
    }
    toggleAdminSubnav();
  }

  function _loadAdminSubnav(activeRole) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    const host = document.getElementById('erp-links');
    if (!myId || !host) return;
    fetch('/api/student-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_my_tab_access', payload: {}, user_id: myId })
    }).then(r => r.ok ? r.json() : null).then(res => {
      const erpTabs = (res && res.result === 'success' && Array.isArray(res.tabs)) ? res.tabs : [];
      // get_my_tab_access now returns every admin-console tab the caller's
      // role clears (not just the original 5 ERP ones) — Admin/Student
      // Portal Admin still get every key via the matrix's own defaults, so
      // this alone decides sidebar visibility for every subnav item.
      window._adminTabAccess = erpTabs;
      window._hasErpTabAccess = erpTabs.length > 0; // loadStudentPortalView's own role gate checks this too
      const items = ADMIN_SUBNAV_ITEMS.filter(i => erpTabs.includes(i.key));
      if (!items.length) { host.innerHTML = ''; host.classList.add('hidden'); return; }
      host.innerHTML = items.map(i =>
        `<a href="javascript:void(0)" onclick="${i.action.fn}(); closeMobileSidebar();" class="nav-link nav-sublink" id="nav-erp-${i.key}"><div class="nav-icon-box"><i data-lucide="${i.icon}" class="nav-icon"></i></div><span class="nav-text">${i.label}</span></a>`
      ).join('');
      host.classList.remove('hidden');
      lucide.createIcons();
      const adminLinks = document.getElementById('admin-links');
      if (adminLinks) adminLinks.classList.remove('hidden');
    }).catch(() => {});
  }

  function setActiveNavLink(id) {
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const active = document.getElementById(id);
    if (active) active.classList.add('active');
  }

  function setContentHeader(title, icon) {
    const t = document.getElementById('content-header-title');
    const i = document.getElementById('content-header-icon');
    const r = document.getElementById('content-header-role');
    if (t) t.textContent = title;
    if (i) { i.setAttribute('data-lucide', icon || 'layout-grid'); lucide.createIcons(); }
    if (r) r.textContent = window.ACTIVE_ROLE || window.USER_ROLE || '';
    const scroller = document.querySelector('main .overflow-y-auto');
    if (scroller) scroller.scrollTop = 0;
  }

  function loadDefaultView() {
    _setViewHash('dashboard');
    setActiveNavLink('nav-dashboard');
    const role = window.ACTIVE_ROLE || window.USER_ROLE;
    console.log('[CCPC] loadDefaultView — role:', role);

    if (role === 'Admin') { renderAdminDashboard(); return; }

    showLoading(true);
    const viewMap = { Teacher: 'TeacherView', Staff: 'TeacherView', HR: 'HRView', Principal: 'LeadershipView', VP: 'LeadershipView' };
    const viewFile = (viewMap[role] || 'TeacherView') + '.html';

    fetch('/views/' + viewFile)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(html => {
        console.log('[CCPC] View HTML loaded, length:', html.length);
        document.getElementById('view-container').innerHTML = html;
        const icons = { Teacher: 'user', Staff: 'user', HR: 'users', Principal: 'crown', VP: 'badge-check' };
        setContentHeader(role + ' Profile', icons[role] || 'user');
        lucide.createIcons();
        if (['Teacher', 'Staff'].includes(role)) {
          const email = window.APP_USER ? window.APP_USER.email   : '';
          const uid   = window.APP_USER ? window.APP_USER.user_id : '';
          initStudentTabDataSection(uid); // shows only if an admin granted this user access
          const cached = window._loginProfile;
          window._loginProfile = null;
          if (cached) {
            // Profile was pre-loaded during loginAndGetProfile — no second API call needed
            try { renderTeacherProfile(cached); } catch(e) { console.error(e); }
            showLoading(false);
          } else {
            google.script.run
              .withSuccessHandler(data => {
                try { renderTeacherProfile(data); } catch(e) { console.error(e); }
                showLoading(false);
              })
              .withFailureHandler(e => { console.error(e); showLoading(false); })
              .getMyProfile(email, uid);
          }
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
      .catch(e => { console.error('[CCPC] View load failed:', e); showLoading(false); });
  }

  // ── Student Tab Data (delegated access) ──────────────────────────────────
  // Admins pick who may view/export a custom student tab's submissions (Student
  // Portal Admin → Data → Data Access). If this user is on any tab's list, a
  // "Student Data" card appears under their profile with a table + CSV export.
  let _stdTabData = null;
  let _stdTabView = 'table'; // 'table' | 'card'

  function initStudentTabDataSection(uid) {
    if (!uid) return;
    google.script.run
      .withSuccessHandler(tabs => {
        if (!Array.isArray(tabs) || !tabs.length) return;
        const host = document.getElementById('view-container');
        if (!host || document.getElementById('std-tabdata-card')) return;

        const card = document.createElement('div');
        card.id = 'std-tabdata-card';
        card.className = 'max-w-5xl mx-auto mt-6 bg-white border border-slate-200 rounded-2xl p-5';
        card.innerHTML = `
          <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <div class="text-sm font-black text-slate-800">Student Data</div>
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Custom tab submissions shared with you</div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <select id="std-tabdata-select" class="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700"></select>
              <button id="std-tabdata-load" class="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-black">Load</button>
              <button id="std-tabdata-export" class="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-black" disabled>Export CSV</button>
              <select id="std-tabdata-sort" class="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700">
                <option value="">Sort: Default</option>
                <option value="roll">Sort: Roll</option>
                <option value="student_name">Sort: Name</option>
                <option value="class">Sort: Class</option>
                <option value="section">Sort: Section</option>
                <option value="group">Sort: Group</option>
                <option value="gender">Sort: Gender</option>
              </select>
              <select id="std-tabdata-filter" class="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700">
                <option value="">Show: All</option>
                <option value="filled">Show: Filled</option>
                <option value="unfilled">Show: Not Filled</option>
              </select>
              <div class="flex rounded-lg border border-slate-200 overflow-hidden">
                <button id="std-tabdata-viewtable" class="px-3 py-1.5 text-xs font-black bg-blue-600 text-white">Table</button>
                <button id="std-tabdata-viewcard" class="px-3 py-1.5 text-xs font-black text-slate-500">Cards</button>
              </div>
              <button id="std-tabdata-merge" class="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-black">Merge Columns</button>
              <button id="std-tabdata-print" class="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-black">Print</button>
            </div>
          </div>
          <div id="std-tabdata-count" class="text-xs font-bold text-slate-500 mb-2"></div>
          <div id="std-tabdata-view" class="border border-slate-100 rounded-xl overflow-x-auto"></div>`;
        host.appendChild(card);

        const sel = card.querySelector('#std-tabdata-select');
        tabs.forEach(t => {
          const o = document.createElement('option');
          o.value = t.tab_name; o.textContent = t.tab_name;
          sel.appendChild(o);
        });
        card.querySelector('#std-tabdata-load').addEventListener('click', () => loadStudentTabData(uid));
        card.querySelector('#std-tabdata-export').addEventListener('click', exportStudentTabData);
        card.querySelector('#std-tabdata-viewtable').addEventListener('click', () => _setStudentTabView('table'));
        card.querySelector('#std-tabdata-viewcard').addEventListener('click', () => _setStudentTabView('card'));
        card.querySelector('#std-tabdata-sort').addEventListener('change', (e) => _setStudentTabSort(e.target.value));
        card.querySelector('#std-tabdata-filter').addEventListener('change', (e) => _setStudentTabFilter(e.target.value));
        card.querySelector('#std-tabdata-merge').addEventListener('click', () => {
          if (!_stdTabData) return;
          _openMergeColumnsModal({
            title: `Merge Columns — ${_stdTabData.tab}`,
            headers: _stdTabData.headers.filter(h => h !== 'student_id'),
            merges: _stdColumnMerges,
            onChange: (m) => { _stdColumnMerges = m; _renderStudentTabData(); },
          });
        });
        card.querySelector('#std-tabdata-print').addEventListener('click', () => {
          if (!_stdTabData) return;
          const { headers: dHeaders, rows: dRows } = _applyColumnMerges(_stdTabData.headers, _stdVisibleRows(), _stdColumnMerges);
          _openPrintColumnsModal({
            title: `Print — ${_stdTabData.tab}`,
            headers: dHeaders,
            onPrint: (selected) => {
              const idxs = selected.map(h => dHeaders.indexOf(h));
              const rows = dRows.map(r => idxs.map(i => r[i]));
              _openPrintWindow(_buildPrintHtml(_stdTabData.tab, selected, rows));
            },
          });
        });
      })
      .withFailureHandler(() => {})
      .getMyTabDataAccess(uid);
  }

  function _setStudentTabView(mode) {
    _stdTabView = mode;
    const tableBtn = document.getElementById('std-tabdata-viewtable');
    const cardBtn = document.getElementById('std-tabdata-viewcard');
    if (tableBtn) tableBtn.className = `px-3 py-1.5 text-xs font-black ${mode === 'table' ? 'bg-blue-600 text-white' : 'text-slate-500'}`;
    if (cardBtn) cardBtn.className = `px-3 py-1.5 text-xs font-black ${mode === 'card' ? 'bg-blue-600 text-white' : 'text-slate-500'}`;
    _renderStudentTabData();
  }

  let _stdSortKey = ''; // '' | 'roll' | 'student_name' | 'class' | 'section' | 'gender'
  function _setStudentTabSort(key) {
    _stdSortKey = key;
    _renderStudentTabData();
  }

  let _stdFilterKey = ''; // '' | 'filled' | 'unfilled'
  function _setStudentTabFilter(key) {
    _stdFilterKey = key;
    _renderStudentTabData();
  }

  // Display-only column merges for the table view — [{ id, label, cols }].
  // Reset whenever a new tab is loaded (see loadStudentTabData).
  let _stdColumnMerges = [];

  // Shared by render/export so both apply identical sort+filter.
  function _stdVisibleRows() {
    if (!_stdTabData) return [];
    const filled = _stdTabData.filled || {};
    let rows = _stdTabData.rows;
    if (_stdSortKey && _stdTabData.sortMeta) {
      const meta = _stdTabData.sortMeta;
      rows = [...rows].sort((a, b) => _sortCompare((meta[a[0]] || {})[_stdSortKey], (meta[b[0]] || {})[_stdSortKey]));
    }
    if (_stdFilterKey === 'filled') rows = rows.filter(r => filled[r[0]]);
    else if (_stdFilterKey === 'unfilled') rows = rows.filter(r => !filled[r[0]]);
    return rows;
  }

  // Generic numeric-aware comparator, matching the convention already used
  // for roll-number sorting elsewhere (My Class roster, etc.).
  function _sortCompare(va, vb) {
    const na = Number(va), nb = Number(vb);
    if (va !== undefined && vb !== undefined && va !== '' && vb !== '' && va != null && vb != null && !isNaN(na) && !isNaN(nb)) return na - nb;
    return String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
  }

  function _prettyHeader(h) {
    return String(h || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function _statusBadge(isFilled) {
    return isFilled
      ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Filled</span>'
      : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Not Filled</span>';
  }

  // ── Colorful tab-data tables: shared by the Student Data card and My Class
  // tab-table (both live in this file). Cycles by column index, deliberately
  // excluding green/red/emerald — those stay reserved for the Filled/Not
  // Filled status badge above.
  const _COL_PALETTE = [
    { head: 'bg-blue-100 text-blue-700', cell: 'bg-blue-50/60', hex: '#dbeafe', hexCell: '#eff6ff' },
    { head: 'bg-indigo-100 text-indigo-700', cell: 'bg-indigo-50/60', hex: '#e0e7ff', hexCell: '#eef2ff' },
    { head: 'bg-violet-100 text-violet-700', cell: 'bg-violet-50/60', hex: '#ede9fe', hexCell: '#f5f3ff' },
    { head: 'bg-fuchsia-100 text-fuchsia-700', cell: 'bg-fuchsia-50/60', hex: '#fae8ff', hexCell: '#fdf4ff' },
    { head: 'bg-amber-100 text-amber-700', cell: 'bg-amber-50/60', hex: '#fef3c7', hexCell: '#fffbeb' },
    { head: 'bg-cyan-100 text-cyan-700', cell: 'bg-cyan-50/60', hex: '#cffafe', hexCell: '#ecfeff' },
    { head: 'bg-teal-100 text-teal-700', cell: 'bg-teal-50/60', hex: '#ccfbf1', hexCell: '#f0fdfa' },
    { head: 'bg-orange-100 text-orange-700', cell: 'bg-orange-50/60', hex: '#fed7aa', hexCell: '#fff7ed' },
  ];
  function _colTint(i) { return _COL_PALETTE[i % _COL_PALETTE.length]; }

  // Display-only column merge: collapses configured column groups into one
  // cell each, at the leftmost merged column's position. Never touches
  // sort/filter/export — callers apply this only when building table markup,
  // strictly after sort+filter have already run on the original headers/rows.
  function _applyColumnMerges(headers, rows, merges) {
    if (!merges || !merges.length) return { headers, rows };
    const groups = merges
      .map(m => ({ ...m, idxs: m.cols.map(c => headers.indexOf(c)).filter(i => i >= 0) }))
      .filter(g => g.idxs.length >= 2);
    if (!groups.length) return { headers, rows };
    const anchorOf = {};
    const dropSet = new Set();
    groups.forEach(g => {
      const anchor = Math.min(...g.idxs);
      anchorOf[anchor] = g;
      g.idxs.forEach(i => { if (i !== anchor) dropSet.add(i); });
    });
    const dHeaders = [];
    const colPlan = [];
    headers.forEach((h, i) => {
      if (dropSet.has(i)) return;
      if (anchorOf[i]) { dHeaders.push(anchorOf[i].label); colPlan.push({ merge: anchorOf[i].idxs }); return; }
      dHeaders.push(h);
      colPlan.push({ idx: i });
    });
    const dRows = rows.map(r => colPlan.map(p => p.merge
      ? p.merge.map(i => r[i]).filter(v => v !== '' && v != null).join('<br>')
      : r[p.idx]));
    return { headers: dHeaders, rows: dRows };
  }

  // ── Merge Columns modal — generic, reused by both surfaces in this file.
  // opts: { title, headers (candidates to offer), merges (current array),
  //         onChange(newMergesArray) }
  let _activeMergeModalOpts = null;
  function _openMergeColumnsModal(opts) {
    _activeMergeModalOpts = opts;
    const existing = document.getElementById('merge-columns-overlay');
    if (existing) existing.remove();
    const usedCols = new Set(opts.merges.flatMap(m => m.cols));
    const available = opts.headers.filter(h => !usedCols.has(h));
    const overlay = document.createElement('div');
    overlay.id = 'merge-columns-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:520px;width:100%;max-height:85vh;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #e2e8f0">
          <strong>${opts.title || 'Merge Columns'}</strong>
          <button onclick="document.getElementById('merge-columns-overlay').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;line-height:1">&times;</button>
        </div>
        <div id="merge-columns-chips" style="padding:${opts.merges.length ? '12px 16px 0' : '0'};display:flex;flex-wrap:wrap;gap:6px"></div>
        <div style="overflow-y:auto;flex:1;padding:12px 16px">
          <input type="text" id="merge-columns-label" placeholder="Label for the merged column (optional)" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;font-size:13px;box-sizing:border-box">
          <div id="merge-columns-picker" style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto">
            ${available.length ? available.map(h => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" class="merge-col-check" value="${String(h).replace(/"/g, '&quot;')}">${h}</label>`).join('') : '<span style="font-size:12px;color:#94a3b8">No more columns available to merge.</span>'}
          </div>
        </div>
        <div style="padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end">
          <button id="merge-columns-create" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-weight:800;font-size:13px;cursor:pointer">Create Merge</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const chipsHost = document.getElementById('merge-columns-chips');
    chipsHost.innerHTML = opts.merges.map(m => `<span style="display:inline-flex;align-items:center;gap:5px;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700">
        ${m.label} &middot; ${m.cols.length} cols
        <span data-id="${m.id}" style="cursor:pointer;font-weight:900" onclick="_removeColumnMerge('${m.id}')">&times;</span>
      </span>`).join('');

    document.getElementById('merge-columns-create').addEventListener('click', () => {
      const label = document.getElementById('merge-columns-label').value.trim();
      const cols = Array.from(document.querySelectorAll('.merge-col-check:checked')).map(c => c.value);
      if (cols.length < 2) { if (typeof showToast === 'function') showToast('Pick at least 2 columns to merge', 'error'); return; }
      const finalLabel = label || cols.map(_prettyHeader).join(' / ');
      const newMerges = [...opts.merges, { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), label: finalLabel, cols }];
      opts.onChange(newMerges);
      opts.merges = newMerges;
      _openMergeColumnsModal(opts);
    });
  }
  function _removeColumnMerge(id) {
    if (!_activeMergeModalOpts) return;
    const newMerges = _activeMergeModalOpts.merges.filter(m => m.id !== id);
    _activeMergeModalOpts.onChange(newMerges);
    _activeMergeModalOpts.merges = newMerges;
    _openMergeColumnsModal(_activeMergeModalOpts);
  }

  // ── Print column-picker modal — generic, reused by both surfaces here.
  // opts: { title, headers (already post-merge display headers), onPrint(selectedHeaders) }
  function _openPrintColumnsModal(opts) {
    const existing = document.getElementById('print-columns-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'print-columns-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:420px;width:100%;max-height:85vh;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #e2e8f0">
          <strong>${opts.title || 'Print'}</strong>
          <button onclick="document.getElementById('print-columns-overlay').remove()" style="border:none;background:none;font-size:18px;cursor:pointer;line-height:1">&times;</button>
        </div>
        <div style="padding:10px 16px 0;display:flex;gap:8px">
          <button id="print-columns-all" style="font-size:11px;border:1px solid #cbd5e1;border-radius:999px;padding:3px 10px;background:#fff;cursor:pointer">Select all</button>
          <button id="print-columns-none" style="font-size:11px;border:1px solid #cbd5e1;border-radius:999px;padding:3px 10px;background:#fff;cursor:pointer">Clear</button>
        </div>
        <div id="print-columns-list" style="overflow-y:auto;flex:1;padding:10px 16px 12px;display:flex;flex-direction:column;gap:4px">
          ${opts.headers.map(h => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" class="print-col-check" value="${String(h).replace(/"/g, '&quot;')}" checked>${h}</label>`).join('')}
        </div>
        <div style="padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end">
          <button id="print-columns-go" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-weight:800;font-size:13px;cursor:pointer">Print</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('print-columns-all').addEventListener('click', () => { document.querySelectorAll('.print-col-check').forEach(c => { c.checked = true; }); });
    document.getElementById('print-columns-none').addEventListener('click', () => { document.querySelectorAll('.print-col-check').forEach(c => { c.checked = false; }); });
    document.getElementById('print-columns-go').addEventListener('click', () => {
      const selected = Array.from(document.querySelectorAll('.print-col-check:checked')).map(c => c.value);
      if (!selected.length) { if (typeof showToast === 'function') showToast('Pick at least one column', 'error'); return; }
      document.getElementById('print-columns-overlay').remove();
      opts.onPrint(selected);
    });
  }

  // Standalone printable HTML document — no Tailwind CDN in the popup window,
  // so tints are inlined as literal colors via _colTint(...).hex/hexCell.
  function _buildPrintHtml(title, headers, rows) {
    const theadCells = headers.map((h, i) => `<th style="background:${_colTint(i).hex};color:#1e293b;border:1px solid #cbd5e1;padding:5px 7px;font-size:9pt;text-transform:uppercase;letter-spacing:.04em;text-align:left">${h}</th>`).join('');
    const bodyRows = rows.map(r => `<tr>${r.map((c, i) => `<td style="background:${_colTint(i).hexCell};border:1px solid #cbd5e1;padding:4px 7px;font-size:9pt">${c === '' || c == null ? '&mdash;' : c}</td>`).join('')}</tr>`).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
      <style>
        @page { size: landscape; margin: 10mm; }
        body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 16px; }
        table { border-collapse: collapse; width: 100%; }
        .print-meta { font-size: 8pt; color: #64748b; margin-bottom: 10px; }
        h1 { font-size: 13pt; margin: 0 0 2px; }
      </style></head>
      <body>
        <h1>${title}</h1>
        <div class="print-meta">Printed ${new Date().toLocaleString()} &mdash; ${rows.length} row${rows.length === 1 ? '' : 's'}</div>
        <table><thead><tr>${theadCells}</tr></thead><tbody>${bodyRows}</tbody></table>
      </body></html>`;
  }

  function _openPrintWindow(html) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'width=1100,height=750');
    if (!win) {
      if (typeof showToast === 'function') showToast('Popup blocked — please allow popups for this site and try again', 'error');
      URL.revokeObjectURL(url);
      return;
    }
    win.focus();
    setTimeout(function () { win.print(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }, 800);
  }

  function _renderStudentTabData() {
    const view = document.getElementById('std-tabdata-view');
    if (!view) return;
    if (!_stdTabData) { view.innerHTML = ''; return; }
    const { headers } = _stdTabData;
    const filled = _stdTabData.filled || {};
    const rows = _stdVisibleRows();
    if (!rows.length) {
      view.innerHTML = `<div class="p-4 text-xs font-bold text-slate-400">${_stdFilterKey ? 'No students match this filter.' : 'No students found.'}</div>`;
      return;
    }
    if (_stdTabView === 'table') {
      const { headers: dHeaders, rows: dRows } = _applyColumnMerges(headers, rows, _stdColumnMerges);
      view.innerHTML = `<table class="w-full text-left">
        <thead class="bg-slate-50"><tr><th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Status</th>${dHeaders.map((h, i) => `<th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${_colTint(i).head}">${h}</th>`).join('')}</tr></thead>
        <tbody>${dRows.map((r, ri) => `<tr class="border-t border-slate-100"><td class="px-3 py-2">${_statusBadge(filled[rows[ri][0]])}</td>${r.map((c, i) => `<td class="px-3 py-2 text-xs font-semibold text-slate-700 ${_colTint(i).cell}">${c === '' || c == null ? '—' : c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
      return;
    }
    // Card view: one card per student, identity fields as the header, then
    // only the fields that student actually filled in.
    const idIdx = headers.indexOf('student_id');
    const nameIdx = headers.indexOf('student_name');
    const clsIdx = headers.indexOf('class');
    const secIdx = headers.indexOf('section');
    const rollIdx = headers.indexOf('roll');
    const identityIdx = new Set([idIdx, nameIdx, clsIdx, secIdx, rollIdx].filter(i => i >= 0));
    view.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 bg-slate-50">
      ${rows.map(r => {
        const title = (nameIdx >= 0 && r[nameIdx]) || (idIdx >= 0 && r[idIdx]) || 'Student';
        const sub = [
          idIdx >= 0 ? r[idIdx] : null,
          (clsIdx >= 0 && r[clsIdx]) ? `${r[clsIdx]}${(secIdx >= 0 && r[secIdx]) ? '-' + r[secIdx] : ''}` : null,
          (rollIdx >= 0 && r[rollIdx]) ? `Roll ${r[rollIdx]}` : null,
        ].filter(Boolean).join(' · ');
        const fields = headers
          .map((h, i) => ({ h, v: r[i], i }))
          .filter(f => !identityIdx.has(f.i) && f.v !== '' && f.v != null);
        return `<div class="bg-white border border-slate-200 rounded-xl p-4">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-black text-slate-800">${title}</p>
            ${_statusBadge(filled[r[0]])}
          </div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${sub}</p>
          ${fields.length ? `<div class="pt-2 border-t border-slate-50 flex flex-col gap-1">
            ${fields.map(f => `<div class="flex justify-between gap-3">
              <span class="text-[10px] font-bold text-slate-400 uppercase shrink-0">${_prettyHeader(f.h)}</span>
              <span class="text-xs font-semibold text-slate-700 text-right">${f.v}</span>
            </div>`).join('')}
          </div>` : '<p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest pt-2 border-t border-slate-50">No data filled in</p>'}
        </div>`;
      }).join('')}
    </div>`;
  }

  function loadStudentTabData(uid) {
    const sel = document.getElementById('std-tabdata-select');
    const view = document.getElementById('std-tabdata-view');
    const count = document.getElementById('std-tabdata-count');
    const exportBtn = document.getElementById('std-tabdata-export');
    const sortSel = document.getElementById('std-tabdata-sort');
    const filterSel = document.getElementById('std-tabdata-filter');
    if (!sel || !sel.value) return;
    view.innerHTML = '<div class="p-4 text-xs font-bold text-slate-400">Loading…</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) {
          view.innerHTML = `<div class="p-4 text-xs font-bold text-rose-500">${(res && res.error) || 'Could not load data.'}</div>`;
          exportBtn.disabled = true;
          return;
        }
        _stdSortKey = '';
        _stdFilterKey = '';
        _stdColumnMerges = [];
        if (sortSel) sortSel.value = '';
        if (filterSel) filterSel.value = '';
        _stdTabData = { tab: sel.value, headers: res.headers, rows: res.rows, sortMeta: res.sort_meta || {}, filled: res.filled || {} };
        _renderStudentTabData();
        const filledCount = res.rows.filter(r => (res.filled || {})[r[0]]).length;
        count.textContent = `${filledCount} of ${res.rows.length} student${res.rows.length === 1 ? '' : 's'} filled "${sel.value}" — ${res.rows.length - filledCount} not filled`;
        exportBtn.disabled = res.rows.length === 0;
      })
      .withFailureHandler(e => {
        view.innerHTML = `<div class="p-4 text-xs font-bold text-rose-500">${e && e.message ? e.message : e}</div>`;
        exportBtn.disabled = true;
      })
      .getTabDataForUser(uid, sel.value);
  }

  function exportStudentTabData() {
    if (!_stdTabData || !_stdTabData.rows.length) return;
    // Export whatever sort/filter is currently on screen.
    const rows = _stdVisibleRows();
    const filled = _stdTabData.filled || {};
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Status', ..._stdTabData.headers].map(esc).join(',') + '\n'
      + rows.map(r => [filled[r[0]] ? 'Filled' : 'Not Filled', ...r].map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${_stdTabData.tab}_export.csv`;
    a.click();
  }

  function renderAdminDashboard() {
    const container = document.getElementById('view-container');
    if (!container) return;
    setContentHeader('Administration', 'shield-check');

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
          <button onclick="switchAdminTab('adm-theme')" id="atab-adm-theme"
            class="admin-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all bg-white text-slate-400 border border-slate-200 hover:bg-slate-50">
            <i data-lucide="palette" class="h-3.5 w-3.5"></i>Appearance
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
                <div class="relative">
                  <input type="text" id="chairmanSearchInput" placeholder="Search by name or designation…" autocomplete="off"
                    class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-chairman-search">
                  <input type="hidden" id="commChairman">
                  <div id="chairmanDropdown" class="hidden absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden" style="max-height:220px;overflow-y:auto;"></div>
                </div>
              </div>
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Add Members</label>
                <div class="relative">
                  <input type="text" id="commMemberSearch" placeholder="Search by name or designation…" autocomplete="off"
                    class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-comm-member-search">
                  <div id="memberDropdown" class="hidden absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden" style="max-height:220px;overflow-y:auto;"></div>
                </div>
              </div>
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Selected Members</label>
              <div id="selectedMembers" class="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-2xl min-h-[44px]">
                <p class="text-slate-400 text-[10px] font-bold italic self-center mx-auto">No members added yet</p>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Date of Creation</label>
                <input type="date" name="date_of_creation"
                  class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
              </div>
              <div>
                <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Description (Optional)</label>
                <textarea name="description" rows="2" placeholder="Brief description of this committee…"
                  class="w-full px-5 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm resize-none"></textarea>
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
                <th class="px-6 py-3">Status</th>
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

      <!-- ── Tab: Appearance ── -->
      <div id="adm-theme" class="hidden">
        <div id="theme-settings-content">
          <p class="text-xs text-slate-400 font-bold text-center py-8">Loading appearance…</p>
        </div>
      </div>

    </div>

    `;

    lucide.createIcons();
    _ensureStaffCache(() => {
      loadUserData_forSystem();
      initCommitteeForm();
    });
    loadCommitteeData();
    initSettingsTab();
    initThemeTab();
  }

  function switchAdminTab(tabId) {
    ['adm-committees','adm-params','adm-theme'].forEach(id => {
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
    // Helper: resolve date from multiple possible column names
    function sd(name, ...keys) {
      const val = keys.map(k => data[k]).find(v => v);
      sf(name, normalizeDate(val));
    }
    // Helper: resolve text from multiple possible column names
    function sv(name, ...keys) {
      sf(name, keys.map(k => data[k]).find(v => v) || '');
    }

    // --- Tab 1: Personal Info ---
    // sv/sd fall back through old column names (dob, nid_number, etc.) → new names
    sf('teacher_id', data.teacher_id);
    sv('full_name',           'full_name');
    sv('category',            'category');  if (!form.elements['category']?.value) sf('category', 'Teacher');
    sv('designation',         'designation');
    sv('national_id',         'national_id', 'nid_number');
    sv('auth_ref',            'auth_ref');
    sv('name_bengali',        'name_bengali');
    sv('school_college',      'school_college');
    sd('joining_date',        'joining_date');
    sd('date_of_birth',       'date_of_birth', 'dob');
    sv('place_of_birth',      'place_of_birth');
    sv('birth_certificate_no','birth_certificate_no');
    sv('height_feet',         'height_feet');
    sv('height_inches',       'height_inches');
    sv('weight_kg',           'weight_kg');
    sv('blood_group',         'blood_group');
    sv('identification_marks','identification_marks');
    sv('medical_category',    'medical_category');
    sv('disability_nature',   'disability_nature');
    sv('disability_attributable','disability_attributable');
    sv('religion',            'religion');
    sv('caste',               'caste');
    sv('nationality',         'nationality');
    sv('previous_nationality','previous_nationality');
    sv('permanent_address',   'permanent_address');
    sv('present_address',     'present_address');
    sv('alternate_address',   'alternate_address');
    sv('personal_email',      'personal_email');
    sv('tt_phone',            'tt_phone', 'phone');
    sv('mobile',              'mobile', 'whatsapp');

    // --- Tab 2: Travel & Languages ---
    sf('passport_number', data.passport_number);
    sf('passport_date_issue',  normalizeDate(data.passport_date_issue));
    sf('passport_place_issue', data.passport_place_issue);
    sf('passport_date_expiry', normalizeDate(data.passport_date_expiry));
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
    sf('father_date_of_decease', normalizeDate(data.father_date_of_decease));
    sf('father_occupation', data.father_occupation);
    sf('father_annual_income', data.father_annual_income);
    sf('mother_name', data.mother_name);
    sf('mother_nationality', data.mother_nationality);
    sf('mother_prev_nationality', data.mother_prev_nationality);
    sf('mother_citizenship_auth', data.mother_citizenship_auth);
    sf('mother_present_age', data.mother_present_age);
    sf('mother_date_of_decease', normalizeDate(data.mother_date_of_decease));
    sf('mother_occupation', data.mother_occupation);
    sf('position_in_siblings', data.position_in_siblings);

    const siblings = Array.isArray(data.siblings_info) ? data.siblings_info : [];
    const sibEl = document.getElementById('siblingsContainer');
    if (sibEl) { sibEl.innerHTML = ''; siblings.forEach(r => addSiblingRow(r)); if (!siblings.length) addSiblingRow(); }

    // --- Tab 4: Marital & Spouse ---
    sv('marital_status',       'marital_status');
    sd('marriage_divorce_date','marriage_divorce_date', 'marriage_date');
    sv('marriage_authority',   'marriage_authority');

    const sp = data.spouse_details && !Array.isArray(data.spouse_details) ? data.spouse_details
             : (Array.isArray(data.spouse_details) && data.spouse_details.length ? data.spouse_details[0] : {});
    sf('spouse_name_en', sp.name_english || data.spouse_name || '');
    sf('spouse_name_bn', sp.name_bengali);
    sf('spouse_dob', normalizeDate(sp.date_of_birth));
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
        .withSuccessHandler(res => {
          showLoading(false);
          if (res && res.error) { showToast('Save failed: ' + res.error, 'error'); return; }
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
    setTimeout(() => { setupPhotoHeaderScroll(); alignPhotoCardDesktop(); }, 100);

    // Background: load all child tables in one query after the profile form is visible
    const _tid = data.teacher_id;
    if (_tid) {
      google.script.run
        .withSuccessHandler(d => { if (d) _fillProfileSections(d); })
        .withFailureHandler(() => {})
        .getMyProfileSections(_tid);
    }
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
    alignPhotoCardDesktop();
  }

  // Fills all dynamic child-table containers from the background getMyProfileSections result.
  function _fillProfileSections(d) {
    const qsf = (name, val) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) el.value = (val == null ? '' : String(val));
    };
    const nd = raw => {
      if (!raw) return '';
      const s = String(raw).trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    };

    // family_details → familyContainer (personal tab)
    const famEl = document.getElementById('familyContainer');
    const famData = Array.isArray(d.family_details) ? d.family_details : [];
    if (famEl) { famEl.innerHTML = ''; famData.forEach(f => addFamilyRow(f)); if (!famData.length) addFamilyRow(); }

    // faculty_attributes → attributeContainer (education tab)
    const attrEl = document.getElementById('attributeContainer');
    const attrData = Array.isArray(d.faculty_attributes) ? d.faculty_attributes : [];
    if (attrEl) { attrEl.innerHTML = ''; attrData.forEach(a => addAttributeRow(a)); if (!attrData.length) addAttributeRow(); }

    // countries_visited + language_skills → travel tab
    const cEl = document.getElementById('countriesContainer');
    const countries = Array.isArray(d.countries_visited) ? d.countries_visited : [];
    if (cEl) { cEl.innerHTML = ''; countries.forEach(r => addCountryRow(r)); if (!countries.length) addCountryRow(); }
    const lEl = document.getElementById('languagesContainer');
    const langs = Array.isArray(d.language_skills) ? d.language_skills : [];
    if (lEl) { lEl.innerHTML = ''; langs.forEach(r => addLanguageRow(r)); if (!langs.length) addLanguageRow(); }

    // siblings_info → siblingsContainer (parents tab)
    const sEl = document.getElementById('siblingsContainer');
    const siblings = Array.isArray(d.siblings_info) ? d.siblings_info : [];
    if (sEl) { sEl.innerHTML = ''; siblings.forEach(r => addSiblingRow(r)); if (!siblings.length) addSiblingRow(); }

    // spouse_details → spouse tab scalar fields
    const sp = d.spouse_details && !Array.isArray(d.spouse_details) ? d.spouse_details
             : (Array.isArray(d.spouse_details) && d.spouse_details.length ? d.spouse_details[0] : {});
    qsf('spouse_name_en', sp.name_english || '');
    qsf('spouse_name_bn', sp.name_bengali || '');
    qsf('spouse_dob', nd(sp.date_of_birth));
    qsf('spouse_pob', sp.place_of_birth || '');
    qsf('spouse_birth_reg', sp.birth_reg_number || '');
    qsf('spouse_nationality', sp.nationality || '');
    qsf('spouse_prev_nationality', sp.prev_nationality || '');
    qsf('spouse_citizenship_auth', sp.citizenship_auth || '');
    qsf('spouse_nid', sp.national_id || '');
    qsf('spouse_education', sp.educational_qualification || '');
    qsf('spouse_occupation', sp.occupation || '');
    qsf('spouse_occ_designation', sp.occupation_designation || '');
    qsf('spouse_occ_address', sp.occupation_address || '');
    qsf('spouse_prev_occupation', sp.previous_occupation || '');
    qsf('spouse_tid_bin', sp.tid_bin_no || '');

    // children_info + sibling_inlaws → children tab
    const chiEl = document.getElementById('childrenContainer');
    const children = Array.isArray(d.children_info) ? d.children_info : [];
    if (chiEl) { chiEl.innerHTML = ''; children.forEach(r => addChildInfoRow(r)); if (!children.length) addChildInfoRow(); }
    const iEl = document.getElementById('inlawsContainer');
    const inlaws = Array.isArray(d.sibling_inlaws) ? d.sibling_inlaws : [];
    if (iEl) { iEl.innerHTML = ''; inlaws.forEach(r => addInlawRow(r)); if (!inlaws.length) addInlawRow(); }

    // bank_accounts → financial tab
    const bEl = document.getElementById('bankContainer');
    const banks = Array.isArray(d.bank_accounts) ? d.bank_accounts : [];
    if (bEl) { bEl.innerHTML = ''; banks.forEach(r => addBankRow(r)); if (!banks.length) addBankRow(); }

    // education_records → education tab
    const eEl = document.getElementById('eduContainer');
    const edus = Array.isArray(d.education_records) ? d.education_records : [];
    if (eEl) { eEl.innerHTML = ''; edus.forEach(r => addEduRow(r)); if (!edus.length) addEduRow(); }

    updateProfileProgress();
    lucide.createIcons();
  }

  function normalizeDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const m1 = s.match(/^(\d{1,2})[\/\-]([A-Za-z]+)[\/\-](\d{2,4})$/);
    if (m1) {
      const day = m1[1].padStart(2,'0');
      const mon = String(months[m1[2].toLowerCase().slice(0,3)] || 1).padStart(2,'0');
      let yr = m1[3]; if (yr.length === 2) yr = (parseInt(yr) > 30 ? '19' : '20') + yr;
      return `${yr}-${mon}-${day}`;
    }
    const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
    const d = new Date(s);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
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
          <input type="date" name="fam_date[]" value="${normalizeDate(data.marriage_date)}" class="flex-1 px-3 py-2 bg-slate-50 rounded-xl border-none text-sm font-bold">
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
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">From</label>${_inp('duration_from[]', normalizeDate(data.duration_from), '', 'date')}</div>
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">To</label>${_inp('duration_to[]', normalizeDate(data.duration_to), '', 'date')}</div>
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
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Date of Birth</label>${_inp('child_dob[]', normalizeDate(data.date_of_birth), '', 'date')}</div>
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
      <div class="space-y-1"><label class="text-[10px] font-bold text-slate-400">Date of Illness</label>${_inp('disease_date[]', normalizeDate(data.date_of_illness), '', 'date')}</div>
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
    fetch('/views/HRView.html')
      .then(r => r.text())
      .then(html => {
        document.getElementById('view-container').innerHTML = html;
        lucide.createIcons();
        loadStaffData(() => loadUserData());
        showLoading(false);
      })
      .catch(() => showLoading(false));
  }

  // ── ROUTINE / CLASS ADJUSTMENT ("Cut & Toss") ────────────────────────────────
  // Visible to every role: view your own or anyone else's weekly routine by
  // shortname. Cord/Admin additionally get an interactive adjustment board for
  // today's schedule (server enforces the role check independently of this UI).

  let _routineDirectory = [];
  let _routineShortname = null;

  function _isRoutineCoordinator() {
    return (window.USER_ROLES || [window.ACTIVE_ROLE]).some(r => ['Cord', 'Admin'].includes(r));
  }

  let _routineMode = 'self';

  const PERIOD_TIMES = {
    '1st': ['7:45-8:30', '8:15-9:00'],
    '2nd': ['8:30-9:15', '9:00-9:45'],
    '3rd': ['9:15-9:45', '9:45-10:15'],
    '4th/junior tiffin': ['9:45-10:30', '10:15-11:00'],
    '4th/senior tiffin': ['10:30-11:15', '11:00-11:45'],
    '5th': ['11:15-12:00', '11:45-12:30'],
    '6th': ['12:00-12:45', '12:30-1:15'],
    '7th': ['12:45-1:30', '1:15-2:00'],
  };
  const PERIOD_COLORS = ['#8fb3b0', '#c2b280', '#4fb8b8', '#c7c7c7', '#5ec8f2', '#9ccc65', '#3d9999', '#a0a050'];
  const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // "10 July, 2026" — day-of-month with no leading zero, full month name.
  function _formatRoutineDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d)) return '';
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${d.getFullYear()}`;
  }

  function loadRoutineView() {
    _setViewHash('routine');
    setActiveNavLink('nav-routine');
    setContentHeader('Routine', 'calendar-days');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `<div class="text-center py-20 text-slate-400 text-xs font-black uppercase tracking-widest">Loading routine…</div>`;

    google.script.run.withSuccessHandler(function (directory) {
      _routineDirectory = Array.isArray(directory) ? directory : [];
      const myProfile = window.APP_USER && window.APP_USER.profile;
      const myFullName = (myProfile && myProfile.full_name) ? String(myProfile.full_name).trim().toLowerCase() : '';
      const match = _routineDirectory.find(d => d.fullName.trim().toLowerCase() === myFullName);
      _routineShortname = match ? match.shortname : (_routineDirectory[0] ? _routineDirectory[0].shortname : null);
      _routineMode = 'self';
      _drawRoutineShell();
    }).withFailureHandler(function () {
      container.innerHTML = `<div class="p-8 text-center text-red-400 text-xs font-bold">Could not load the teacher directory.</div>`;
    }).getRoutineDirectory();
  }

  function _drawRoutineShell() {
    const container = document.getElementById('view-container');
    if (!container) return;
    const isCoord = _isRoutineCoordinator();
    const options = _routineDirectory.slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(d => `<option value="${d.shortname}" ${d.shortname === _routineShortname ? 'selected' : ''}>${d.fullName} (${d.shortname})</option>`)
      .join('');
    const myProfile = window.APP_USER && window.APP_USER.profile;
    const myFullName = (myProfile && myProfile.full_name) ? String(myProfile.full_name).trim().toLowerCase() : '';
    const myEntry = _routineDirectory.find(d => d.fullName.trim().toLowerCase() === myFullName);
    const todayIso = new Date().toISOString().slice(0, 10);

    container.innerHTML = `
      <div class="space-y-6">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight">Routine</h2>
          <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Personal &amp; class schedule</p>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4">
          ${myEntry ? `
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <span class="font-black text-slate-800">Name:</span><span class="font-bold text-slate-600">${myEntry.fullName}</span>
              <span class="font-black text-slate-800">Short Name:</span><span class="font-bold text-slate-600">${myEntry.shortname}</span>
            </div>` : ''}

          <div class="flex gap-2">
            <button id="routineModeSelf" onclick="_setRoutineMode('self')" class="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all">Self</button>
            <button id="routineModeOther" onclick="_setRoutineMode('other')" class="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all">Other's</button>
          </div>

          <div id="routineOtherPicker" class="${_routineMode === 'other' ? '' : 'hidden'}">
            <select id="routineShortnameSelect" onchange="_onRoutineShortnameChange()"
              class="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-600 outline-none shadow-sm">
              ${options || '<option value="">No teachers found</option>'}
            </select>
          </div>

          <div class="flex gap-2 border-t border-slate-100 pt-3">
            <button id="routineViewSchedule" onclick="_setRoutineViewMode(false)" class="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all">Routine</button>
            <button id="routineViewAdjustment" onclick="_setRoutineViewMode(true)" class="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all">Adjustments</button>
          </div>

          <input type="date" id="routineDateInput" value="${todayIso}" onchange="this.dataset.userPicked='1'; _loadMyRoutinePeriods()"
            class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-center focus:ring-2 focus:ring-blue-600 outline-none">

          <button onclick="_openWeeklyRoutineModal()" class="w-full py-2.5 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1.5">
            <i data-lucide="calendar-range" class="h-3.5 w-3.5"></i> View Full Week
          </button>

          <p id="routineDayLabel" class="text-center font-black italic text-lg text-slate-800"></p>

          <div id="routinePeriodBlocks" class="space-y-1.5">
            <div class="text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>
          </div>
        </div>

        ${isCoord ? `
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-1">
            <h3 class="text-lg font-black text-slate-800">Adjustment Setup</h3>
            <span id="routineLatestPdf" class="text-xs font-bold text-blue-600 whitespace-nowrap"></span>
          </div>
          <div class="flex gap-2">
            <button onclick="_openDailySetupPrompt()" class="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700">Setup New Day</button>
            <button onclick="_toggleAdjustmentsList()" class="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-amber-600">View Today's Adjustments</button>
          </div>
          <div class="flex gap-2">
            <button onclick="_generateAdjustmentPdf()" class="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-50">Export As PDF</button>
            <button onclick="_openPdfHistoryModal()" class="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-50">PDF History</button>
          </div>

          <div id="routineAdjustmentsList" class="hidden"></div>

          <div class="border-t border-slate-100 pt-4">
            <p class="text-xs font-black text-indigo-600 uppercase tracking-widest mb-3">Select a teacher for adjustment</p>
            <select id="routineTeacherPicker" onchange="_selectAdjustTeacher(this.value)"
              class="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-600 outline-none shadow-sm mb-4">
              <option value="">Loading…</option>
            </select>
            <div id="routineTeacherPeriods"></div>
          </div>
        </div>` : ''}
      </div>`;
    lucide.createIcons();
    _updateRoutineModeButtons();
    _updateRoutineViewButtons();
    _loadRoutineBoard(false, true); // resolves the sheet's actual date first, then loads periods for it
    if (isCoord) { _loadLatestAdjustmentPdf(); _startRoutinePolling(); }
  }

  function _updateRoutineModeButtons() {
    const selfBtn = document.getElementById('routineModeSelf');
    const otherBtn = document.getElementById('routineModeOther');
    const active = 'bg-blue-600 text-white shadow';
    const inactive = 'bg-slate-100 text-slate-500 hover:bg-slate-200';
    if (selfBtn) selfBtn.className = `flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${_routineMode === 'self' ? active : inactive}`;
    if (otherBtn) otherBtn.className = `flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${_routineMode === 'other' ? active : inactive}`;
  }

  function _setRoutineMode(mode) {
    _routineMode = mode;
    const picker = document.getElementById('routineOtherPicker');
    if (picker) picker.classList.toggle('hidden', mode !== 'other');
    _updateRoutineModeButtons();
    if (mode === 'self') {
      const myProfile = window.APP_USER && window.APP_USER.profile;
      const myFullName = (myProfile && myProfile.full_name) ? String(myProfile.full_name).trim().toLowerCase() : '';
      const match = _routineDirectory.find(d => d.fullName.trim().toLowerCase() === myFullName);
      if (match) _routineShortname = match.shortname;
    } else {
      const sel = document.getElementById('routineShortnameSelect');
      if (sel) _routineShortname = sel.value;
    }
    _loadMyRoutinePeriods();
  }

  function _onRoutineShortnameChange() {
    _routineShortname = document.getElementById('routineShortnameSelect').value;
    _loadMyRoutinePeriods();
  }

  let _routineShowAdjustments = true;

  function _updateRoutineViewButtons() {
    const schedBtn = document.getElementById('routineViewSchedule');
    const adjBtn = document.getElementById('routineViewAdjustment');
    const active = 'bg-blue-600 text-white shadow';
    const inactive = 'bg-slate-100 text-slate-500 hover:bg-slate-200';
    if (schedBtn) schedBtn.className = `flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${!_routineShowAdjustments ? active : inactive}`;
    if (adjBtn) adjBtn.className = `flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${_routineShowAdjustments ? active : inactive}`;
  }

  // Toggles between the plain scheduled routine and the same view merged
  // with today's adjustments — a segmented button pair instead of a checkbox
  // so switching between the two feels like the same kind of choice as
  // Self/Other's, not a buried settings switch.
  function _setRoutineViewMode(showAdjustments) {
    _routineShowAdjustments = showAdjustments;
    _updateRoutineViewButtons();
    _loadMyRoutinePeriods();
  }

  function _renderPeriodBlocksHtml(periods, dayData, adjustedPeriods) {
    return periods.map((p, i) => {
      const color = PERIOD_COLORS[i % PERIOD_COLORS.length];
      const times = PERIOD_TIMES[p];
      const value = (adjustedPeriods && adjustedPeriods[p]) || dayData[p] || '';
      return `
        <div class="flex text-xs" style="gap:2px">
          <div class="w-[42%] shrink-0 flex flex-col" style="gap:2px">
            <div class="px-3 py-2 font-black italic text-slate-900 rounded-t-lg" style="background:${color}">${p}</div>
            ${times ? `<div class="px-3 py-1.5 font-bold text-slate-800 rounded-b-lg" style="background:${color};opacity:0.8">Sum: ${times[0]}<br>Win: ${times[1]}</div>` : ''}
          </div>
          <div class="flex-1 flex items-center justify-center px-3 text-center font-black italic text-slate-900 rounded-lg" style="background:${color}">${value || ''}</div>
        </div>`;
    }).join('');
  }

  function _loadMyRoutinePeriods() {
    const el = document.getElementById('routinePeriodBlocks');
    const dayLabelEl = document.getElementById('routineDayLabel');
    if (!el) return;
    if (!_routineShortname) { el.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs font-bold">No teacher selected.</div>'; return; }

    const dateInput = document.getElementById('routineDateInput');
    const dateStr = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
    const wantAdjustments = _routineShowAdjustments;
    const dateObj = new Date(dateStr + 'T00:00:00');
    const weekday = DAY_ORDER[dateObj.getDay()];
    if (dayLabelEl) dayLabelEl.textContent = weekday + ', ' + _formatRoutineDate(dateStr);

    el.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>';

    google.script.run.withSuccessHandler(function (weekRes) {
      if (!weekRes || weekRes.error || !weekRes.periods) { el.innerHTML = `<div class="p-8 text-center text-red-400 text-xs font-bold">${(weekRes && weekRes.error) || 'Could not load routine.'}</div>`; return; }
      const dayData = weekRes.days[weekday] || {};

      if (wantAdjustments) {
        google.script.run.withSuccessHandler(function (board) {
          const isSameDay = board && !board.error && board.isoDate === dateStr;
          const row = isSameDay ? (board.rows || []).find(r => r.shortname.toLowerCase() === _routineShortname.trim().toLowerCase()) : null;
          el.innerHTML = _renderPeriodBlocksHtml(weekRes.periods, dayData, row ? row.periods : null);
        }).withFailureHandler(function () {
          el.innerHTML = _renderPeriodBlocksHtml(weekRes.periods, dayData, null);
        }).getTodayRoutineBoard();
      } else {
        el.innerHTML = _renderPeriodBlocksHtml(weekRes.periods, dayData, null);
      }
    }).withFailureHandler(function () {
      el.innerHTML = '<div class="p-8 text-center text-red-400 text-xs font-bold">Network error loading routine.</div>';
    }).getWeeklyRoutine(_routineShortname);
  }

  // Full Sun-Sat grid straight from the master "Classes" sheet — the planned
  // routine, with no "Selected"-sheet adjustments layered in.
  function _openWeeklyRoutineModal() {
    if (!_routineShortname) { showToast('Pick a teacher first', 'error'); return; }
    const existing = document.getElementById('weeklyRoutineModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'weeklyRoutineModal';
    modal.className = 'fixed inset-0 bg-black/40 z-[90] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-black text-slate-800">Weekly Routine — ${_routineShortname}</h3>
          <button onclick="document.getElementById('weeklyRoutineModal').remove()" class="p-2 hover:bg-slate-100 rounded-xl"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div id="weeklyRoutineBody" class="overflow-x-auto">
          <div class="text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    lucide.createIcons();
    google.script.run.withSuccessHandler(function (weekRes) {
      const el = document.getElementById('weeklyRoutineBody');
      if (!el) return;
      if (!weekRes || weekRes.error || !weekRes.periods) { el.innerHTML = `<div class="text-red-400 text-xs font-bold text-center py-6">${(weekRes && weekRes.error) || 'Could not load routine.'}</div>`; return; }
      const days = DAY_ORDER.filter(d => weekRes.days[d]);
      if (!days.length) { el.innerHTML = '<div class="text-slate-400 text-xs font-bold text-center py-6">No routine found for this teacher.</div>'; return; }
      el.innerHTML = `
        <table class="w-full text-xs border-collapse">
          <thead><tr class="bg-slate-50">
            <th class="px-3 py-2 text-left font-black text-slate-500 whitespace-nowrap">Period</th>
            ${days.map(d => `<th class="px-3 py-2 text-center font-black text-slate-500 whitespace-nowrap">${d.slice(0, 3)}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${weekRes.periods.map(p => `
              <tr class="border-t border-slate-100">
                <td class="px-3 py-2 font-black text-slate-700 whitespace-nowrap">${p}</td>
                ${days.map(d => `<td class="px-3 py-2 text-center font-bold text-slate-600">${(weekRes.days[d] && weekRes.days[d][p]) || '—'}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>`;
    }).withFailureHandler(function () {
      const el = document.getElementById('weeklyRoutineBody');
      if (el) el.innerHTML = '<div class="text-red-400 text-xs font-bold text-center py-6">Network error.</div>';
    }).getWeeklyRoutine(_routineShortname);
  }

  let _routineBoardCache = null;
  let _selectedAdjustShortname = null;
  let _routinePoll = null;

  // Adjustments that have been submitted but not yet confirmed landed on the
  // sheet. The external Apps Script write (+ our own verify re-fetch) can
  // take a few seconds — without this, the 5s background poll would fetch
  // the sheet's still-old value mid-flight and clobber the optimistic UI,
  // making a just-picked substitute flash back to the old value on its own.
  // Key: "shortname|period" (lowercased shortname) -> { value, expiresAt }.
  const _pendingAdjustments = new Map();

  function _setPendingAdjustment(shortname, periodLabel, value) {
    _pendingAdjustments.set(String(shortname).trim().toLowerCase() + '|' + periodLabel, { value, expiresAt: Date.now() + 20000 });
  }
  function _clearPendingAdjustment(shortname, periodLabel) {
    _pendingAdjustments.delete(String(shortname).trim().toLowerCase() + '|' + periodLabel);
  }
  // Overlays any still-pending optimistic values onto a freshly fetched board
  // before it's cached/rendered, so an in-flight write's row always shows the
  // value the user just picked rather than whatever the sheet had a moment
  // ago. Expired entries (safety net in case a response never arrives) are
  // dropped instead of applied.
  function _applyPendingOverrides(board) {
    if (!board || !board.rows || !_pendingAdjustments.size) return;
    const now = Date.now();
    for (const [key, pending] of _pendingAdjustments) {
      if (pending.expiresAt < now) { _pendingAdjustments.delete(key); continue; }
      const sep = key.lastIndexOf('|');
      const shortnameKey = key.slice(0, sep), period = key.slice(sep + 1);
      const row = board.rows.find(r => r.shortname.trim().toLowerCase() === shortnameKey);
      if (row) row.periods[period] = pending.value;
    }
  }

  // silent=true is used for background refreshes (polling, post-write
  // reconcile) — errors are swallowed instead of clobbering the picker/periods
  // UI with an error state over what may just be a transient network hiccup.
  // isInitial=true means this is the very first load for the view: "My
  // Routine" periods haven't been fetched with a confirmed-correct date yet,
  // so they're loaded here (once, after the date is resolved) rather than
  // separately — calling _loadMyRoutinePeriods() before this resolves would
  // race it using the browser's today(), which can legitimately not match
  // the "Selected" sheet's actual working day and flash an empty routine.
  function _loadRoutineBoard(silent, isInitial) {
    google.script.run.withSuccessHandler(function (board) {
      _applyPendingOverrides(board);
      _routineBoardCache = board;
      _renderTeacherPicker(board);
      // routineAdjustmentsList only exists for Cord/Admin (inside the isCoord-
      // gated block) — this function now runs for every role, so it must not
      // assume the element is present or it throws for regular teachers,
      // which (via the shim's promise chain) silently falls into the failure
      // handler and skips the date-sync below entirely.
      const adjListEl = document.getElementById('routineAdjustmentsList');
      if (adjListEl && !adjListEl.classList.contains('hidden')) _renderAdjustmentsList(board);

      // The "Selected" sheet's own D1 date (board.isoDate) is the school's
      // actual working day — set via Setup New Day, and it can legitimately
      // lag behind the real calendar date. Sync the date picker to it (unless
      // the user has deliberately browsed to a different date) instead of
      // trusting the browser's today(), otherwise "With Adjustments" silently
      // never finds a match and today's real adjustments never show up.
      let dateChanged = false;
      if (board && !board.error && board.isoDate) {
        const dateInput = document.getElementById('routineDateInput');
        if (dateInput && dateInput.dataset.userPicked !== '1' && dateInput.value !== board.isoDate) {
          dateInput.value = board.isoDate;
          dateChanged = true;
        }
      }
      if (isInitial || dateChanged) _loadMyRoutinePeriods();
    }).withFailureHandler(function () {
      if (isInitial) _loadMyRoutinePeriods(); // fall back to browser-today rather than leaving periods stuck on "Loading…"
      if (silent) return;
      const el = document.getElementById('routineTeacherPicker');
      if (el) el.innerHTML = '<option value="">Network error loading today\'s schedule.</option>';
    }).getTodayRoutineBoard();
  }

  // Keeps the Cord/Admin adjustment board in sync with the sheet without any
  // visible loading state — self-stops once the picker leaves the DOM (view
  // navigated away from), same pattern as the messages list poll.
  function _startRoutinePolling() {
    clearInterval(_routinePoll);
    _routinePoll = setInterval(() => {
      if (!document.getElementById('routineTeacherPicker')) { clearInterval(_routinePoll); return; }
      if (document.getElementById('adjustModal')) return; // don't refresh under an open reassign modal
      _loadRoutineBoard(true);
    }, 5000);
  }

  function _renderTeacherPicker(board) {
    const el = document.getElementById('routineTeacherPicker');
    if (!el) return;
    if (!board || board.error) { el.innerHTML = `<option value="">${(board && board.error) || "Could not load today's schedule."}</option>`; return; }
    const rows = board.rows.filter(r => board.periods.some(p => r.periods[p]));
    if (!_selectedAdjustShortname && rows.length) _selectedAdjustShortname = rows[0].shortname;

    // The list of teacher names is effectively static through a school day —
    // rebuilding every <option> on every 5s poll tick needlessly touches the
    // DOM (and can interrupt an open dropdown) for data that never changes.
    // Only rebuild when the actual set of names differs; otherwise just keep
    // the selection in sync.
    const namesKey = rows.map(r => r.shortname).join('|');
    if (el.dataset.namesKey !== namesKey) {
      el.innerHTML = rows.length
        ? rows.map(r => `<option value="${r.shortname}" ${_selectedAdjustShortname === r.shortname ? 'selected' : ''}>${r.shortname}</option>`).join('')
        : '<option value="">No teachers found</option>';
      el.dataset.namesKey = namesKey;
    } else if (el.value !== _selectedAdjustShortname) {
      el.value = _selectedAdjustShortname;
    }

    const periodsEl = document.getElementById('routineTeacherPeriods');
    if (_selectedAdjustShortname) {
      const row = rows.find(r => r.shortname === _selectedAdjustShortname);
      if (row) _renderTeacherPeriodsForAdjustment(board, row);
      else if (periodsEl) periodsEl.innerHTML = '';
    }
  }

  function _selectAdjustTeacher(shortname) {
    _selectedAdjustShortname = shortname;
    // Render instantly from whatever's cached so picking a name never looks
    // frozen, then immediately re-fetch so the periods shown reflect the
    // sheet's current state rather than a possibly-stale cached board.
    if (_routineBoardCache) _renderTeacherPicker(_routineBoardCache);
    _loadRoutineBoard(true);
  }

  function _renderTeacherPeriodsForAdjustment(board, row) {
    const el = document.getElementById('routineTeacherPeriods');
    if (!el) return;
    const entries = board.periods.filter(p => row.periods[p]);

    // Skip the rebuild entirely when nothing about this teacher's periods
    // actually changed since the last render — a poll tick that returns
    // identical data shouldn't touch the DOM (avoids flicker / losing scroll
    // position on every 5s refresh).
    const contentKey = row.shortname + '|' + row.adjustedCount + '|' + row.gottenCount + '|' + entries.map(p => p + '=' + row.periods[p]).join(',');
    if (el.dataset.contentKey === contentKey) return;
    el.dataset.contentKey = contentKey;

    el.innerHTML = `
      <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-3">
        <p class="font-black text-orange-600 text-center text-lg">${row.shortname}</p>
        <p class="text-center text-xs font-bold text-orange-500 mt-1">Total Adjusted Class: ${row.adjustedCount} &middot; Total Adjustment Gotten: ${row.gottenCount}</p>
      </div>
      <div class="space-y-1.5">
        ${entries.map(p => {
          const color = PERIOD_COLORS[board.periods.indexOf(p) % PERIOD_COLORS.length];
          const times = PERIOD_TIMES[p];
          const val = row.periods[p];
          const isAdjusted = !val.includes(';');
          return `
            <div class="flex text-xs cursor-pointer" style="gap:2px"
              onclick='_openAdjustModal(${JSON.stringify(row.shortname)}, ${JSON.stringify(p)}, ${JSON.stringify(val)})'>
              <div class="w-[42%] shrink-0 flex flex-col" style="gap:2px">
                <div class="px-3 py-2 font-black italic text-slate-900 rounded-t-lg" style="background:${color}">${p}</div>
                ${times ? `<div class="px-3 py-1.5 font-bold text-slate-800 rounded-b-lg" style="background:${color};opacity:0.8">Sum: ${times[0]}<br>Win: ${times[1]}</div>` : ''}
              </div>
              <div class="flex-1 flex items-center justify-center px-3 text-center font-black italic text-slate-900 rounded-lg ${isAdjusted ? 'ring-2 ring-amber-400' : ''}" style="background:${color}">${val}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function _toggleAdjustmentsList() {
    const el = document.getElementById('routineAdjustmentsList');
    if (!el) return;
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (_routineBoardCache) _renderAdjustmentsList(_routineBoardCache);
    else el.innerHTML = '<div class="text-center py-4 text-slate-400 text-xs font-bold">Loading…</div>';
  }

  function _renderAdjustmentsList(board) {
    const el = document.getElementById('routineAdjustmentsList');
    if (!el || el.classList.contains('hidden')) return;
    const adj = board.adjustments || [];
    el.innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mt-2">
        <p class="text-center font-black italic text-slate-800">Chattogram Cantonment Public College</p>
        <p class="text-center text-xs font-bold text-red-500 mt-1">Adjustment Date: ${_formatRoutineDate(board.isoDate) || board.dateLabel || ''} (${board.weekday || ''})</p>
        <p class="text-center text-xs font-bold text-red-500">Total Adjustments: ${adj.length}</p>
        <div class="mt-3 space-y-1.5">
          ${adj.length ? adj.map((a, i) => `
            <div class="grid grid-cols-[1.5rem_2.5rem_1fr_2.5rem] gap-2 text-xs py-1 items-center">
              <span class="text-slate-500">${i + 1}.</span>
              <span class="font-black">${a.shortname}</span>
              <span class="text-slate-600">${a.period} &middot; ${a.originalClass}</span>
              <span class="font-black text-right">${a.coveredBy}</span>
            </div>`).join('') : '<p class="text-center text-slate-400 text-xs py-2">No adjustments today</p>'}
        </div>
      </div>`;
  }

  function _loadLatestAdjustmentPdf() {
    const el = document.getElementById('routineLatestPdf');
    if (!el) return;
    google.script.run.withSuccessHandler(function (res) {
      if (res && res.url) el.innerHTML = `<a href="${res.url}" target="_blank" class="underline">Latest Notice PDF</a>`;
    }).getLatestAdjustmentPdf();
  }

  // Previous days' adjustment notices, from the "Adjustment link" sheet —
  // newest first (the sheet itself prepends new entries).
  function _openPdfHistoryModal() {
    const existing = document.getElementById('pdfHistoryModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'pdfHistoryModal';
    modal.className = 'fixed inset-0 bg-black/40 z-[90] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-black text-slate-800">Adjustment PDF History</h3>
          <button onclick="document.getElementById('pdfHistoryModal').remove()" class="p-2 hover:bg-slate-100 rounded-xl"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div id="pdfHistoryBody" class="space-y-2">
          <div class="text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    lucide.createIcons();
    google.script.run.withSuccessHandler(function (list) {
      const el = document.getElementById('pdfHistoryBody');
      if (!el) return;
      if (!Array.isArray(list) || !list.length) { el.innerHTML = '<p class="text-center text-slate-400 text-xs font-bold py-6">No PDFs generated yet.</p>'; return; }
      el.innerHTML = list.map(item => `
        <a href="${item.url}" target="_blank" class="flex items-center justify-between gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all">
          <div class="min-w-0">
            <p class="font-black text-slate-800 text-sm truncate">${item.adjustmentDateLabel || item.name}</p>
            <p class="text-[10px] text-slate-400 font-bold">${item.createdLabel ? 'Created ' + item.createdLabel : ''}${item.status ? ' &middot; ' + item.status : ''}</p>
          </div>
          <i data-lucide="download" class="h-4 w-4 text-blue-600 shrink-0"></i>
        </a>`).join('');
      lucide.createIcons();
    }).withFailureHandler(function () {
      const el = document.getElementById('pdfHistoryBody');
      if (el) el.innerHTML = '<p class="text-center text-red-400 text-xs font-bold py-6">Network error.</p>';
    }).getAdjustmentPdfHistory();
  }

  function _openAdjustModal(shortname, periodLabel, currentValue) {
    if (currentValue && !currentValue.includes(';')) {
      showToast(shortname + ' is already covered by ' + currentValue, 'error');
      return;
    }
    const existing = document.getElementById('adjustModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'adjustModal';
    modal.className = 'fixed inset-0 bg-black/40 z-[90] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 class="text-lg font-black text-slate-800">Reassign Period</h3>
        <p class="text-xs text-slate-500 font-bold">${shortname} &middot; ${periodLabel} &middot; ${currentValue}</p>
        <div>
          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cover With (free teachers only)</label>
          <select id="adjustSubSelect" class="w-full mt-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-600">
            <option value="">Loading options…</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="document.getElementById('adjustModal').remove()" class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onclick='_confirmAdjustment(${JSON.stringify(shortname)}, ${JSON.stringify(periodLabel)})' class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    google.script.run.withSuccessHandler(function (opts) {
      const sel = document.getElementById('adjustSubSelect');
      if (!sel) return;
      // The Dropdown sheet's options carry a load-info suffix, e.g.
      // "MMU (1,1,0, L./PS: 0)" — useful to show, but the actual sheet cells
      // only ever contain the bare shortname ("MMU"). Submitting the full
      // annotated string doesn't match anything the write endpoint expects,
      // so the adjustment silently fails to apply. Show the full text, submit
      // just the shortname.
      sel.innerHTML = (opts || []).length
        ? opts.map(o => {
            const shortname = String(o).split(' (')[0].trim();
            return `<option value="${shortname.replace(/"/g, '&quot;')}">${o}</option>`;
          }).join('')
        : '<option value="">No free teachers found for this period</option>';
    }).getSubstituteOptions(periodLabel);
  }

  function _confirmAdjustment(shortname, periodLabel) {
    const sel = document.getElementById('adjustSubSelect');
    const sub = sel ? sel.value : '';
    if (!sub) { showToast('Pick a substitute first', 'error'); return; }
    const myId = window.APP_USER && window.APP_USER.user_id;

    // Don't make the user wait through the round trip (locate row/col + call
    // the external Apps Script web app + re-verify, which can take several
    // seconds) — close the modal and apply the change optimistically right
    // away so they can immediately move on to the next adjustment. The real
    // outcome is reported later via a toast, and reverted if it didn't land.
    const m = document.getElementById('adjustModal');
    if (m) m.remove();

    let previousValue = '';
    const patchCache = (value) => {
      if (!_routineBoardCache || !_routineBoardCache.rows) return;
      const row = _routineBoardCache.rows.find(r => r.shortname.toLowerCase() === String(shortname).trim().toLowerCase());
      if (row) row.periods[periodLabel] = value;
    };
    if (_routineBoardCache && _routineBoardCache.rows) {
      const row = _routineBoardCache.rows.find(r => r.shortname.toLowerCase() === String(shortname).trim().toLowerCase());
      if (row) previousValue = row.periods[periodLabel];
    }
    patchCache(sub);
    _setPendingAdjustment(shortname, periodLabel, sub);
    _renderTeacherPicker(_routineBoardCache);
    _loadMyRoutinePeriods();

    google.script.run.withSuccessHandler(function (res) {
      if (res && res.success) {
        showToast(shortname + ' · ' + periodLabel + ' → ' + sub + ' saved', 'success');
        // Reconcile with the sheet's real state shortly after, in the background.
        _clearPendingAdjustment(shortname, periodLabel);
        setTimeout(() => _loadRoutineBoard(true), 1500);
      } else {
        showToast((res && res.message) || (shortname + ' · ' + periodLabel + ' adjustment failed'), 'error');
        _clearPendingAdjustment(shortname, periodLabel);
        patchCache(previousValue);
        _renderTeacherPicker(_routineBoardCache);
        _loadMyRoutinePeriods();
      }
    }).withFailureHandler(function () {
      showToast('Network error — ' + shortname + ' · ' + periodLabel + ' may not have saved', 'error');
      _clearPendingAdjustment(shortname, periodLabel);
      patchCache(previousValue);
      _renderTeacherPicker(_routineBoardCache);
      _loadMyRoutinePeriods();
    }).submitClassAdjustment(myId, shortname, periodLabel, sub);
  }

  function _openDailySetupPrompt() {
    const existing = document.getElementById('dailySetupModal');
    if (existing) existing.remove();
    const todayIso = new Date().toISOString().slice(0, 10);
    const modal = document.createElement('div');
    modal.id = 'dailySetupModal';
    modal.className = 'fixed inset-0 bg-black/40 z-[90] flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 class="text-lg font-black text-slate-800">Setup New Day</h3>
        <p class="text-xs text-slate-500 font-bold">Seed the schedule from the master routine for the picked date. This replaces today's working copy.</p>
        <input type="date" id="dailySetupDateInput" value="${todayIso}"
          class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-center focus:ring-2 focus:ring-blue-600 outline-none">
        <div class="flex justify-end gap-2 pt-2">
          <button onclick="document.getElementById('dailySetupModal').remove()" class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button id="dailySetupConfirmBtn" onclick="_confirmDailySetup()" class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-emerald-600 text-white hover:bg-emerald-700">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  // Unlike a single adjustment, this reseeds the whole day from the master
  // routine — a much bigger blast radius — so it deliberately blocks and
  // waits for the real response instead of the optimistic non-blocking
  // pattern used for single-period adjustments.
  function _confirmDailySetup() {
    const dateStr = document.getElementById('dailySetupDateInput').value;
    if (!dateStr) { showToast('Pick a date first', 'error'); return; }
    const myId = window.APP_USER && window.APP_USER.user_id;
    const btn = document.getElementById('dailySetupConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Setting up…'; btn.classList.add('opacity-60'); }
    google.script.run.withSuccessHandler(function (res) {
      const m = document.getElementById('dailySetupModal');
      if (m) m.remove();
      if (res && res.success) { showToast('Daily setup complete', 'success'); _loadRoutineBoard(false, true); }
      else showToast((res && res.message) || 'Setup failed', 'error');
    }).withFailureHandler(function () {
      const m = document.getElementById('dailySetupModal');
      if (m) m.remove();
      showToast('Network error', 'error');
    }).runDailyRoutineSetup(myId, dateStr);
  }

  function _generateAdjustmentPdf() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    showLoading(true);
    showToast('Generating PDF and uploading to Drive — this can take a moment…', 'info');
    google.script.run.withSuccessHandler(function (res) {
      showLoading(false);
      if (res && res.success && res.url) { window.open(res.url, '_blank'); showToast('PDF generated', 'success'); _loadLatestAdjustmentPdf(); }
      else showToast((res && res.message) || 'PDF generation failed', 'error');
    }).withFailureHandler(function () {
      showLoading(false); showToast('Network error', 'error');
    }).generateAdjustmentPdf(myId);
  }

  function loadSystemView() {
    if (!_requireAdminRole()) return;
    _setViewHash('system');
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
    setContentHeader('System', 'settings-2');

    // Build tab list based on role
    const tabs = [
      { id: 'sys-users',      label: 'Users',    icon: 'users' },
      ...(canEdit ? [{ id: 'sys-register', label: 'Register', icon: 'user-plus' }] : []),
      ...(adminOnly ? [{ id: 'sys-modules', label: 'Module Access', icon: 'layout-grid' }] : []),
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
            <input type="text" id="userSearchInput" oninput="filterUserList()" placeholder="Search users…" autocomplete="off"
              class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-xs" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-user-search">
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
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex-1 min-w-[180px] max-w-xs">
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Default Password</label>
              <input type="password" id="bulkDefaultPass" placeholder="e.g. ccpc@1234"
                class="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-sm">
            </div>
            <div class="flex-1 min-w-[160px] relative" style="margin-top:1.4rem;">
              <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"></i>
              <input type="text" id="profileSearchInput" oninput="filterProfileList()" placeholder="Search profiles…" autocomplete="off"
                class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-profile-search">
            </div>
            <div style="margin-top:1.4rem;">
              <button onclick="bulkCreateFromProfiles()"
                class="bg-indigo-600 text-white font-black px-5 py-2.5 rounded-2xl shadow-lg shadow-indigo-500/20 hover:bg-black transition-all uppercase tracking-widest text-xs flex items-center gap-2 shrink-0">
                <i data-lucide="user-check" class="h-3.5 w-3.5"></i> Create Users
              </button>
            </div>
          </div>
        </div>` : ''}
      </div>

      <!-- ══ SCROLLABLE LIST AREA ══ -->
      <div style="flex:1;overflow-y:auto;min-height:0;padding-top:1rem;">

        <!-- Users list -->
        <div id="sys-users" class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          ${canEdit ? `<div class="p-4 border-b border-slate-100 flex justify-end">
            <button onclick="openStaffFormModal(null)" class="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black shadow-sm transition-all">
              <i data-lucide="user-plus" class="h-3.5 w-3.5"></i> Add Teacher / Staff
            </button>
          </div>` : ''}
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
                  ${ALL_ROLES.map(r => `<th class="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center" title="${r}">${roleAbbr(r)}</th>`).join('')}
                </tr>
              </thead>
              <tbody id="profilePickerList" class="divide-y divide-slate-100">
                <tr><td colspan="${ALL_ROLES.length + 2}" class="px-4 py-8 text-center text-slate-400 text-xs font-black uppercase tracking-widest">Loading profiles…</td></tr>
              </tbody>
            </table>
          </div>
          <!-- Selection count -->
          <div class="px-4 py-2 border-t border-slate-100 text-right">
            <span id="bulkSelCount" class="text-xs font-black text-slate-400">0 selected</span>
          </div>
        </div>` : ''}

        <!-- Module Access matrix -->
        ${adminOnly ? `
        <div id="sys-modules" style="display:none;" class="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <p class="font-black text-slate-800 text-sm">Which role sees which module</p>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Admin always sees everything, regardless of this matrix</p>
            </div>
            <button id="moduleAccessSaveBtn" onclick="saveModuleVisibility()" class="px-5 py-2.5 bg-blue-600 text-white text-[10px] font-black rounded-xl hover:bg-black transition-all uppercase tracking-widest shadow-lg shadow-blue-500/20 flex items-center gap-2">
              <i data-lucide="save" class="h-3.5 w-3.5"></i> Save Changes
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-50 border-b border-slate-100">
                  <th class="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Module</th>
                  ${ALL_ROLES.map(r => `<th class="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">${r}</th>`).join('')}
                </tr>
              </thead>
              <tbody id="moduleAccessBody" class="divide-y divide-slate-100">
                <tr><td colspan="${ALL_ROLES.length + 1}" class="px-4 py-8 text-center text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>` : ''}

      </div><!-- /scroll area -->
    </div>`;

    lucide.createIcons();
    _ensureStaffCache(() => loadUserData_forSystem());
    if (adminOnly) loadModuleAccessPanel();
  }

  function loadModuleAccessPanel() {
    const render = () => {
      const tbody = document.getElementById('moduleAccessBody');
      if (!tbody) return;
      tbody.innerHTML = MODULE_REGISTRY.map(m => {
        const allowed = (_moduleVisibility && _moduleVisibility[m.key]) || MODULE_DEFAULTS[m.key] || ALL_ROLES;
        return `<tr>
          <td class="px-4 py-3 font-black text-slate-800 text-sm">${m.label}</td>
          ${ALL_ROLES.map(r => `<td class="px-3 py-3 text-center">
            <input type="checkbox" class="module-access-cb w-4 h-4 rounded accent-blue-600" data-module="${m.key}" data-role="${r}" ${r === 'Admin' ? 'checked disabled title="Admin always has access"' : (allowed.includes(r) ? 'checked' : '')}>
          </td>`).join('')}
        </tr>`;
      }).join('');
    };
    if (_moduleVisibility !== null) render();
    else _loadModuleVisibility(render);
  }

  function saveModuleVisibility() {
    const matrix = {};
    MODULE_REGISTRY.forEach(m => { matrix[m.key] = ['Admin']; });
    document.querySelectorAll('.module-access-cb:checked').forEach(cb => {
      const key = cb.dataset.module, role = cb.dataset.role;
      if (!matrix[key].includes(role)) matrix[key].push(role);
    });
    const btn = document.getElementById('moduleAccessSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    google.script.run.withSuccessHandler(function () {
      _moduleVisibility = matrix;
      updateSidebarForRole(window.ACTIVE_ROLE);
      showToast('Module access saved');
      loadSystemView();
    }).withFailureHandler(function () {
      showToast('Failed to save module access', 'error');
      loadSystemView();
    }).updateSystemSettings({ module_visibility: matrix });
  }

  function switchSysTab(tabId) {
    const tabs = ['sys-users','sys-register','sys-modules'];
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
    _setViewHash('committees');
    setActiveNavLink('nav-my-committees');
    setContentHeader('My Assignments', 'users-2');
    showLoading(true);
    fetch('/views/CommitteeView.html')
      .then(r => r.text())
      .then(html => {
        document.getElementById('view-container').innerHTML = html;
        lucide.createIcons();
        renderMyCommitteeCards();
        showLoading(false);
      })
      .catch(() => showLoading(false));
  }

  // ═══════════════════════════════════════════════════════
  //  MY CLASS — read-only roster for whichever class(es) the
  //  caller resolves to as "Class Teacher" in the school's
  //  master class-teacher sheet (ID match first, shortname
  //  fallback — resolved server-side, never from client input).
  // ═══════════════════════════════════════════════════════
  function loadMyClassView() {
    _setViewHash('myclass');
    setActiveNavLink('nav-my-class');
    setContentHeader('My Class', 'graduation-cap');
    const container = document.getElementById('view-container');
    if (!container) return;
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;

    container.innerHTML = `<div class="pt-4 max-w-5xl mx-auto pb-10">
      <div id="myClassTabButtons" class="flex flex-wrap gap-2 mb-5"></div>
      <div id="myClassBody" class="flex flex-col gap-6">
        <div class="text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>
      </div>
    </div>`;

    google.script.run
      .withSuccessHandler(res => {
        const btnHost = document.getElementById('myClassTabButtons');
        if (btnHost) {
          const tabs = (res && res.tabs) || [];
          btnHost.innerHTML = tabs.map(t => `
            <button onclick='openClassTabTable(${JSON.stringify(t.tab_name).replace(/'/g, "&#39;")})'
              class="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-600 uppercase tracking-widest hover:border-blue-300 hover:text-blue-600 transition-all">
              <i data-lucide="table" class="h-3 w-3"></i>${t.tab_name}
            </button>`).join('');
          lucide.createIcons();
        }
      })
      .withFailureHandler(() => {})
      .getEnabledPortalTabs();

    google.script.run
      .withSuccessHandler(res => {
        const body = document.getElementById('myClassBody');
        if (!body) return;
        const classes = (res && res.classes) || [];
        if (!classes.length) {
          body.innerHTML = `<div class="text-center py-16 text-slate-400 text-xs font-black uppercase tracking-widest">You are not currently assigned as a class teacher</div>`;
          return;
        }
        body.innerHTML = classes.map(c => {
          const sorted = [...c.students].sort((a, b) => {
            const ra = parseInt(a.roll, 10), rb = parseInt(b.roll, 10);
            if (!isNaN(ra) && !isNaN(rb) && ra !== rb) return ra - rb;
            return String(a.roll || '').localeCompare(String(b.roll || ''), undefined, { numeric: true });
          });
          return `
          <div>
            <p class="font-black text-slate-800 text-sm uppercase tracking-widest mb-3">${c.classKey}<span class="text-slate-400 font-bold"> · ${sorted.length} students</span></p>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              ${sorted.length ? sorted.map(s => {
                const fatherTel = String(s.father_phone || '').replace(/[\s\-()]/g, '');
                const motherTel = String(s.mother_phone || '').replace(/[\s\-()]/g, '');
                return `
                <div onclick='openStudentProfile(${JSON.stringify(s.student_id)})'
                  class="cursor-pointer bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-lg transition-all">
                  <div class="flex items-center gap-3 mb-3">
                    ${_avatar(s.student_name, s.photo, 'w-12 h-12')}
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-black text-slate-800 truncate">${s.student_name || ''}</p>
                      <p class="text-[10px] font-black text-blue-600 uppercase tracking-widest">Roll ${s.roll || '—'} <span class="text-slate-400">· ${s.gender || ''}</span></p>
                    </div>
                  </div>
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${[s.version, s.shift].filter(Boolean).join(' / ')}</p>
                  <div class="pt-2 border-t border-slate-50 flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><i data-lucide="user" class="h-3 w-3 text-slate-300"></i>Father: ${s.father_phone || '—'}</span>
                      ${fatherTel ? `<a href="tel:${fatherTel}" title="Call Father" onclick="event.stopPropagation()" class="text-slate-300 hover:text-blue-600 transition-colors shrink-0"><i data-lucide="phone" class="h-3.5 w-3.5"></i></a>` : ''}
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><i data-lucide="user" class="h-3 w-3 text-slate-300"></i>Mother: ${s.mother_phone || '—'}</span>
                      ${motherTel ? `<a href="tel:${motherTel}" title="Call Mother" onclick="event.stopPropagation()" class="text-slate-300 hover:text-blue-600 transition-colors shrink-0"><i data-lucide="phone" class="h-3.5 w-3.5"></i></a>` : ''}
                    </div>
                  </div>
                </div>`;
              }).join('') : `<div class="col-span-full text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">No students found for this class</div>`}
            </div>
          </div>`;
        }).join('');
        lucide.createIcons();
      })
      .withFailureHandler(() => {
        const body = document.getElementById('myClassBody');
        if (body) body.innerHTML = `<div class="text-center py-16 text-red-400 text-xs font-black uppercase tracking-widest">Failed to load class roster</div>`;
      })
      .getMyClassRoster(myId);
  }

  // At-a-glance view of one custom tab across the whole class — opened from
  // the button row above the roster, with a Table | Cards switcher. Same
  // underlying authorization as the roster/detail views (getMyClassTabTable
  // re-derives the caller's own resolved classes server-side).
  let _classTabData = null;
  let _classTabView = 'table'; // 'table' | 'card'
  let _classSortKey = ''; // '' | 'roll' | 'student_name' | 'class' | 'section' | 'gender'

  function openClassTabTable(tabName) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    let modal = document.getElementById('classTabTableModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'classTabTableModal';
      modal.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
      modal.innerHTML = `<div class="bg-white rounded-2xl w-full max-w-5xl max-h-[85vh] overflow-y-auto p-5">
        <div class="flex items-center justify-between mb-1 gap-3">
          <p class="font-black text-slate-800 text-sm" id="classTabTableTitle">Tab Data</p>
          <div class="flex items-center gap-2 flex-wrap">
            <select id="classTabSortSelect" class="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700">
              <option value="">Sort: Default</option>
              <option value="roll">Sort: Roll</option>
              <option value="student_name">Sort: Name</option>
              <option value="class">Sort: Class</option>
              <option value="section">Sort: Section</option>
              <option value="group">Sort: Group</option>
              <option value="gender">Sort: Gender</option>
            </select>
            <select id="classTabFilterSelect" class="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700">
              <option value="">Show: All</option>
              <option value="filled">Show: Filled</option>
              <option value="unfilled">Show: Not Filled</option>
            </select>
            <div class="flex rounded-lg border border-slate-200 overflow-hidden">
              <button id="classTabViewTableBtn" class="px-3 py-1.5 text-xs font-black bg-blue-600 text-white">Table</button>
              <button id="classTabViewCardBtn" class="px-3 py-1.5 text-xs font-black text-slate-500">Cards</button>
            </div>
            <button id="classTabMergeBtn" class="px-4 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-black">Merge Columns</button>
            <button id="classTabPrintBtn" class="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-black">Print</button>
            <button onclick="closeClassTabTable()" class="text-slate-400 hover:text-slate-700"><i data-lucide="x" class="h-5 w-5"></i></button>
          </div>
        </div>
        <p id="classTabTableCount" class="text-xs font-bold text-slate-500 mb-3"></p>
        <div id="classTabTableBody"><div class="text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div></div>
      </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#classTabViewTableBtn').addEventListener('click', () => _setClassTabView('table'));
      modal.querySelector('#classTabViewCardBtn').addEventListener('click', () => _setClassTabView('card'));
      modal.querySelector('#classTabSortSelect').addEventListener('change', (e) => _setClassTabSort(e.target.value));
      modal.querySelector('#classTabFilterSelect').addEventListener('change', (e) => _setClassTabFilter(e.target.value));
      modal.querySelector('#classTabMergeBtn').addEventListener('click', () => {
        if (!_classTabData) return;
        _openMergeColumnsModal({
          title: `Merge Columns — ${document.getElementById('classTabTableTitle').textContent}`,
          headers: _classTabData.headers,
          merges: _classColumnMerges,
          onChange: (m) => { _classColumnMerges = m; _renderClassTabData(); },
        });
      });
      modal.querySelector('#classTabPrintBtn').addEventListener('click', () => {
        if (!_classTabData) return;
        const { rows: visRows, filled: visFilled } = _classVisiblePairs();
        const { headers: dHeaders, rows: dRows } = _applyColumnMerges(_classTabData.headers, visRows, _classColumnMerges);
        _openPrintColumnsModal({
          title: `Print — ${document.getElementById('classTabTableTitle').textContent}`,
          headers: dHeaders,
          onPrint: (selected) => {
            const idxs = selected.map(h => dHeaders.indexOf(h));
            const rows = dRows.map(r => idxs.map(i => r[i]));
            _openPrintWindow(_buildPrintHtml(document.getElementById('classTabTableTitle').textContent, selected, rows));
          },
        });
      });
    }
    modal.classList.remove('hidden');
    _classTabData = null;
    _classSortKey = '';
    _classFilterKey = '';
    _classColumnMerges = [];
    const sortSel = document.getElementById('classTabSortSelect');
    if (sortSel) sortSel.value = '';
    const filterSel = document.getElementById('classTabFilterSelect');
    if (filterSel) filterSel.value = '';
    document.getElementById('classTabTableTitle').textContent = tabName;
    document.getElementById('classTabTableCount').textContent = '';
    document.getElementById('classTabTableBody').innerHTML = `<div class="text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>`;
    lucide.createIcons();

    google.script.run
      .withSuccessHandler(res => {
        const body = document.getElementById('classTabTableBody');
        if (!body) return;
        if (!res || res.error) {
          body.innerHTML = `<div class="text-center py-12 text-red-400 text-xs font-black uppercase tracking-widest">${(res && res.error) || 'Failed to load'}</div>`;
          return;
        }
        _classTabData = { headers: res.headers || [], rows: res.rows || [], sortMeta: res.sort_meta || [], filled: res.filled || [] };
        const filledCount = (res.filled || []).filter(Boolean).length;
        const total = (res.rows || []).length;
        const countEl = document.getElementById('classTabTableCount');
        if (countEl) countEl.textContent = total ? `${filledCount} of ${total} students filled this in — ${total - filledCount} not filled` : '';
        _renderClassTabData();
      })
      .withFailureHandler(() => {
        const body = document.getElementById('classTabTableBody');
        if (body) body.innerHTML = `<div class="text-center py-12 text-red-400 text-xs font-black uppercase tracking-widest">Failed to load</div>`;
      })
      .getMyClassTabTable(myId, tabName);
  }

  function _setClassTabView(mode) {
    _classTabView = mode;
    const tableBtn = document.getElementById('classTabViewTableBtn');
    const cardBtn = document.getElementById('classTabViewCardBtn');
    if (tableBtn) tableBtn.className = `px-3 py-1.5 text-xs font-black ${mode === 'table' ? 'bg-blue-600 text-white' : 'text-slate-500'}`;
    if (cardBtn) cardBtn.className = `px-3 py-1.5 text-xs font-black ${mode === 'card' ? 'bg-blue-600 text-white' : 'text-slate-500'}`;
    _renderClassTabData();
  }

  function _setClassTabSort(key) {
    _classSortKey = key;
    _renderClassTabData();
  }

  let _classFilterKey = ''; // '' | 'filled' | 'unfilled'
  function _setClassTabFilter(key) {
    _classFilterKey = key;
    _renderClassTabData();
  }

  // Display-only column merges for the table view — [{ id, label, cols }].
  // Reset whenever the modal is (re)opened for a tab — see openClassTabTable.
  let _classColumnMerges = [];

  // Shared by render/print — sort_meta/filled are index-aligned with rows
  // (student_id isn't a visible column here), so zip all three together,
  // sort/filter, then unzip, so they stay in lockstep.
  function _classVisiblePairs() {
    if (!_classTabData) return { rows: [], filled: [] };
    const filledArr = _classTabData.filled && _classTabData.filled.length === _classTabData.rows.length
      ? _classTabData.filled : _classTabData.rows.map(() => true);
    let pairs = _classTabData.rows.map((r, i) => [r, (_classTabData.sortMeta || [])[i], filledArr[i]]);
    if (_classSortKey && _classTabData.sortMeta && _classTabData.sortMeta.length === _classTabData.rows.length) {
      pairs = pairs.sort((a, b) => _sortCompare((a[1] || {})[_classSortKey], (b[1] || {})[_classSortKey]));
    }
    if (_classFilterKey === 'filled') pairs = pairs.filter(p => p[2]);
    else if (_classFilterKey === 'unfilled') pairs = pairs.filter(p => !p[2]);
    return { rows: pairs.map(p => p[0]), filled: pairs.map(p => p[2]) };
  }

  function _renderClassTabData() {
    const body = document.getElementById('classTabTableBody');
    if (!body || !_classTabData) return;
    const { headers } = _classTabData;
    const { rows, filled } = _classVisiblePairs();
    if (!rows.length) {
      body.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">${_classFilterKey ? 'No students match this filter' : 'No students found'}</div>`;
      return;
    }
    if (_classTabView === 'table') {
      const { headers: dHeaders, rows: dRows } = _applyColumnMerges(headers, rows, _classColumnMerges);
      body.innerHTML = `<div class="overflow-x-auto border border-slate-100 rounded-xl">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50"><tr><th class="px-3 py-2 font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Status</th>${dHeaders.map((h, i) => `<th class="px-3 py-2 font-black uppercase tracking-widest whitespace-nowrap ${_colTint(i).head}">${h}</th>`).join('')}</tr></thead>
          <tbody>${dRows.map((r, i) => `<tr class="border-t border-slate-50"><td class="px-3 py-2">${_statusBadge(filled[i])}</td>${r.map((v, ci) => `<td class="px-3 py-2 font-bold text-slate-700 whitespace-nowrap ${_colTint(ci).cell}">${v === '' || v == null ? '—' : v}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
      return;
    }
    // Card view: one card per student — Roll/Name/Class are the identity
    // header (getMyClassTabTable puts them first, already display-labelled),
    // then only the fields that student actually filled in.
    const rollIdx = headers.indexOf('Roll');
    const nameIdx = headers.indexOf('Name');
    const clsIdx = headers.indexOf('Class');
    const identityIdx = new Set([rollIdx, nameIdx, clsIdx].filter(i => i >= 0));
    body.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      ${rows.map((r, i) => {
        const title = (nameIdx >= 0 && r[nameIdx]) || 'Student';
        const sub = [
          (rollIdx >= 0 && r[rollIdx]) ? `Roll ${r[rollIdx]}` : null,
          (clsIdx >= 0 && r[clsIdx]) ? r[clsIdx] : null,
        ].filter(Boolean).join(' · ');
        const fields = headers
          .map((h, i) => ({ h, v: r[i], i }))
          .filter(f => !identityIdx.has(f.i) && f.v !== '' && f.v != null);
        return `<div class="bg-white border border-slate-200 rounded-xl p-4">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-black text-slate-800">${title}</p>
            ${_statusBadge(filled[i])}
          </div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${sub}</p>
          ${fields.length ? `<div class="pt-2 border-t border-slate-50 flex flex-col gap-1">
            ${fields.map(f => `<div class="flex justify-between gap-3">
              <span class="text-[10px] font-bold text-slate-400 uppercase shrink-0">${f.h}</span>
              <span class="text-xs font-semibold text-slate-700 text-right">${f.v}</span>
            </div>`).join('')}
          </div>` : '<p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest pt-2 border-t border-slate-50">No data filled in</p>'}
        </div>`;
      }).join('')}
    </div>`;
  }

  function closeClassTabTable() {
    const modal = document.getElementById('classTabTableModal');
    if (modal) modal.classList.add('hidden');
  }

  function _fieldLabel(f) {
    return f.name || f.label || String(f.data_key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Read-only detail panel for one student, opened from a "My Class" roster
  // card. Server re-verifies the student is actually one of the caller's own
  // class before returning anything — see getStudentDetail in route.js.
  function openStudentProfile(studentId) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    let modal = document.getElementById('studentDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'studentDetailModal';
      modal.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
      modal.innerHTML = `<div class="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div id="studentDetailAvatar"></div>
            <p class="font-black text-slate-800 text-sm" id="studentDetailTitle">Student</p>
          </div>
          <button onclick="closeStudentProfile()" class="text-slate-400 hover:text-slate-700"><i data-lucide="x" class="h-5 w-5"></i></button>
        </div>
        <div id="studentDetailBody"><div class="text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div></div>
      </div>`;
      document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    document.getElementById('studentDetailBody').innerHTML = `<div class="text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>`;
    lucide.createIcons();

    google.script.run
      .withSuccessHandler(res => {
        const body = document.getElementById('studentDetailBody');
        if (!body) return;
        if (!res || res.error) {
          body.innerHTML = `<div class="text-center py-12 text-red-400 text-xs font-black uppercase tracking-widest">${(res && res.error) || 'Failed to load'}</div>`;
          return;
        }
        const p = res.profile || {};
        document.getElementById('studentDetailTitle').textContent = `${p.student_name || 'Student'} · Roll ${p.roll || '—'}`;
        document.getElementById('studentDetailAvatar').innerHTML = _avatar(p.student_name, p.photo, 'w-10 h-10');
        const fatherTel = String(p.father_phone || '').replace(/[\s\-()]/g, '');
        const motherTel = String(p.mother_phone || '').replace(/[\s\-()]/g, '');

        const presentDays = res.attendance.filter(a => a.entry_time).length;
        const attendanceRows = res.attendance.map(a => `
          <tr class="border-t border-slate-50">
            <td class="px-3 py-1.5 font-bold text-slate-500">${a.date}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700">${a.entry_time || '—'}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700">${a.exit_time || '—'}</td>
          </tr>`).join('');

        const orderRows = res.canteen.orders.map(o => {
          const items = Array.isArray(o.orders) ? o.orders.map(i => `${i.name} ×${i.qty}`).join(', ') : '';
          return `<tr class="border-t border-slate-50">
            <td class="px-3 py-1.5 font-bold text-slate-500">${new Date(o.created_at).toLocaleDateString()}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700">${items}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700 text-right">${o.price}</td>
          </tr>`;
        }).join('');
        const rechargeRows = res.canteen.recharges.map(r => `
          <tr class="border-t border-slate-50">
            <td class="px-3 py-1.5 font-bold text-slate-500">${new Date(r.created_at).toLocaleDateString()}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700">${r.gateway || ''}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700">${r.confirmation || ''}</td>
            <td class="px-3 py-1.5 font-bold text-slate-700 text-right">${r.amount}</td>
          </tr>`).join('');

        body.innerHTML = `
          <div class="flex flex-col gap-6">
            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Profile</p>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                ${[['Class', p.class],['Section', p.section],['Group', p.group],['Roll', p.roll],['Gender', p.gender],['Version', p.version],['Shift', p.shift],
                   ['Balance', p.balance],['Card Status', p.card_status]]
                  .map(([l, v]) => `<div><p class="text-slate-400 font-bold text-[10px] uppercase">${l}</p><p class="font-black text-slate-700">${v ?? '—'}</p></div>`).join('')}
                <div><p class="text-slate-400 font-bold text-[10px] uppercase">Father's Phone</p><p class="font-black text-slate-700 flex items-center gap-1.5">${p.father_phone || '—'}${fatherTel ? `<a href="tel:${fatherTel}" title="Call Father" class="text-blue-500 hover:text-blue-700"><i data-lucide="phone" class="h-3.5 w-3.5"></i></a>` : ''}</p></div>
                <div><p class="text-slate-400 font-bold text-[10px] uppercase">Mother's Phone</p><p class="font-black text-slate-700 flex items-center gap-1.5">${p.mother_phone || '—'}${motherTel ? `<a href="tel:${motherTel}" title="Call Mother" class="text-blue-500 hover:text-blue-700"><i data-lucide="phone" class="h-3.5 w-3.5"></i></a>` : ''}</p></div>
              </div>
            </div>

            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Attendance <span class="text-slate-500">(${presentDays}/${res.attendance.length} days present, last ${res.attendance.length})</span></p>
              <div class="overflow-x-auto border border-slate-100 rounded-xl bg-white max-h-48 overflow-y-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-50 sticky top-0"><tr><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Date</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase">In</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Out</th></tr></thead>
                  <tbody>${attendanceRows || `<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400 font-bold">No records</td></tr>`}</tbody>
                </table>
              </div>
            </div>

            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Canteen — Orders</p>
              <div class="overflow-x-auto border border-slate-100 rounded-xl bg-white max-h-48 overflow-y-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-50 sticky top-0"><tr><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Date</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Items</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase text-right">Price</th></tr></thead>
                  <tbody>${orderRows || `<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400 font-bold">No orders</td></tr>`}</tbody>
                </table>
              </div>
            </div>

            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Canteen — Recharges</p>
              <div class="overflow-x-auto border border-slate-100 rounded-xl bg-white max-h-40 overflow-y-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-50 sticky top-0"><tr><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Date</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Gateway</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase">Status</th><th class="px-3 py-1.5 font-black text-slate-500 uppercase text-right">Amount</th></tr></thead>
                  <tbody>${rechargeRows || `<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400 font-bold">No recharges</td></tr>`}</tbody>
                </table>
              </div>
            </div>

            ${res.customTabs.map(t => `
              <div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${t.tab_name}</p>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-white border border-slate-100 rounded-xl p-3">
                  ${t.fields.filter(f => f.type !== 'group_label' && t.data[f.data_key] !== undefined && t.data[f.data_key] !== null && t.data[f.data_key] !== '').map(f => `
                    <div><p class="text-slate-400 font-bold text-[10px] uppercase">${_fieldLabel(f)}</p><p class="font-black text-slate-700">${t.data[f.data_key] ?? '—'}</p></div>`).join('')}
                </div>
              </div>`).join('')}

            <div>
              <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Results</p>
              <div class="text-center py-6 bg-white border border-slate-100 rounded-xl text-slate-400 text-xs font-black uppercase tracking-widest">Not available yet</div>
            </div>
          </div>`;
        lucide.createIcons();
      })
      .withFailureHandler(() => {
        const body = document.getElementById('studentDetailBody');
        if (body) body.innerHTML = `<div class="text-center py-12 text-red-400 text-xs font-black uppercase tracking-widest">Failed to load</div>`;
      })
      .getStudentDetail(myId, studentId);
  }

  function closeStudentProfile() {
    const modal = document.getElementById('studentDetailModal');
    if (modal) modal.classList.add('hidden');
  }

  // ═══════════════════════════════════════════════════════
  //  INVENTORY — chain-of-custody: what I currently hold
  //  (my own + anything I'm an assigned distributor for),
  //  my full receipt history, and a Distribute action that
  //  works the same way from either pane (see the Inventory
  //  chain-of-custody plan — any receiver is a distributor
  //  of what they received, by default).
  // ═══════════════════════════════════════════════════════
  let _invOptionsCache = null;     // { consumers, committees, assignments } — recipient picker data
  let _invDistContext  = null;     // { fromType, fromId, productId, productName, max } for the open modal

  // Hash-restore default for "Student Portal" (e.g. reloading the page
  // while on any of its sub-views — every one of them calls
  // _setViewHash('student_portal') too, so the hash alone can't say which
  // specific tab was open). All 13 sub-tabs are native now, so there's no
  // iframe to fall back to — this just re-derives the same landing choice
  // _studentPortalNavClick would make and opens it directly.
  function _expandStudentPortalSubnav() {
    const host = document.getElementById('erp-links');
    const parent = document.getElementById('nav-student-portal');
    if (parent && host) { parent.classList.add('expanded'); host.classList.remove('collapsed'); }
  }
  // Hash-restore default for "Student Portal" (e.g. reloading the page
  // while on any of its sub-views — every one of them calls
  // _setViewHash('student_portal') too, so the hash alone can't say which
  // specific tab was open). Runs synchronously right after login, before
  // the sidebar's own async grant checks (_loadAdminSubnav /
  // _maybeRevealStudentPortalForGrantee) are guaranteed to have resolved —
  // so this always re-derives access itself via a fresh backend call
  // rather than trusting window._hasErpTabAccess/_hasFieldCategoryAccess,
  // which may still be unset at this exact moment.
  function loadStudentPortalView() {
    const isFullAdmin = window.ACTIVE_ROLE === 'Admin' || window.ACTIVE_ROLE === 'Student Portal Admin';
    if (isFullAdmin) { _expandStudentPortalSubnav(); loadAdminSetupView(); return; }
    if (_isModuleVisibleForRole('student_portal', window.ACTIVE_ROLE)) {
      // Role-based grant (e.g. HR) — land on the first of the 5 ERP tabs
      // this account actually holds.
      _adminFetch('get_my_tab_access', {}).then(res => {
        const tabs = (res && res.result === 'success' && Array.isArray(res.tabs)) ? res.tabs : [];
        const first = ADMIN_SUBNAV_ITEMS.find(i => i.erp && tabs.includes(i.key));
        if (first) { _expandStudentPortalSubnav(); window[first.action.fn](); }
        else showToast('Not available in current role', 'error');
      }).catch(() => showToast('Not available in current role', 'error'));
      return;
    }
    // Not role-visible — only a field-category grant (Viewer Panel) can
    // still admit this account.
    _adminFetch('get_my_access', {}).then(res => {
      if (res && res.result === 'success' && Array.isArray(res.fields) && res.fields.length) {
        window._hasFieldCategoryAccess = true;
        loadViewerPanelView();
      } else {
        showToast('Not available in current role', 'error');
      }
    }).catch(() => showToast('Not available in current role', 'error'));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Access tab — module access, field categories, viewer grants, student
  // search/bulk-edit. Talks to /api/student-admin via _adminFetch below.
  // ══════════════════════════════════════════════════════════════════════

  function _adminFetch(action, payload = {}) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    return fetch('/api/student-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, user_id: myId })
    }).then(async r => {
      if (!r.ok) {
        let serverMsg = '';
        try { const body = await r.json(); serverMsg = body?.message || body?.error || ''; } catch (_) {}
        throw new Error(serverMsg || ('Network error ' + r.status));
      }
      return r.json();
    });
  }

  const TAB_ACCESS_LABELS = {
    fees: 'Fees', attendance: 'Attendance', exams: 'Exams', payroll: 'Payroll (incl. Leave)', transport: 'Transport',
    setup: 'Setup', add_custom_form: '+ Add Custom Form', data: 'Data', access: 'Access', class_teacher: 'Assign Class Teacher',
    history: 'History', photo: 'Photo', notices: 'Notices', import: 'Import', bus_tracker: 'Bus Tracker',
  };
  const TAB_ACCESS_ROLES = ['Student Portal Admin', 'HR', 'Principal', 'VP', 'Teacher', 'Staff', 'Class Teacher'];
  let _tabAccessDefaults = {}, _tabAccessMatrix = {};
  let _fieldCategories = [];
  let _grantStaff = [], _grantSelectedUser = null, _fieldGrants = {};
  let _stuSearchRows = [], _stuSearchHeaders = [];

  function loadAdminAccessView() {
    if (!(window._adminTabAccess || []).includes('access')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-access');
    setContentHeader('Access', 'shield-check');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="space-y-5 pb-10">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight">Access</h2>
          <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Module access, field categories, viewer grants, student search</p>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6" id="tabAccessCard">
          <div class="flex items-center justify-between mb-1">
            <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="toggle-right" class="h-4 w-4 text-blue-600"></i>Admin Console Module Access</p>
            <button onclick="saveAdminTabVisibility()" id="tabAccessSaveBtn" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save</button>
          </div>
          <p class="text-xs text-slate-400 font-bold mt-1 mb-4">Choose which roles can open each of these admin tabs. Admin always has access. Payroll defaults to Admin + HR only — the other four default to Admin + Student Portal Admin.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse" id="tabAccessTable">
              <thead><tr class="text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100"><th class="py-2 pr-3">Tab</th></tr></thead>
              <tbody id="tabAccessBody"><tr><td class="py-3 text-xs text-slate-400 font-bold italic">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <div class="flex items-center justify-between mb-1">
            <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="folder" class="h-4 w-4 text-blue-600"></i>Field Categories</p>
            <button onclick="openFieldCategoryEditor(null)" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">+ New Category</button>
          </div>
          <p class="text-xs text-slate-400 font-bold mt-1 mb-4">A category is a named set of student fields. Categories are used below both to grant a viewer restricted read-only access, and to pick exactly which columns a download contains.</p>
          <div id="fieldCategoriesList" class="flex flex-col gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading…</span></div>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-1"><i data-lucide="user-check" class="h-4 w-4 text-blue-600"></i>Viewer Access Grants</p>
          <p class="text-xs text-slate-400 font-bold mt-1 mb-4">Grant a staff account read-only access to one or more categories, without making them a full Admin. A viewer's visible fields are the union of every category they're granted.</p>
          <div class="grid md:grid-cols-2 gap-4 mb-3">
            <div>
              <input type="text" id="grantUserSearch" oninput="filterGrantStaff()" placeholder="Search staff by name, ID, shortname or phone…" autocomplete="off"
                class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-grant-user-search">
              <div id="grantStaffList" class="border border-slate-200 rounded-xl mt-1.5 overflow-y-auto" style="max-height:220px"></div>
            </div>
            <div id="grantCategoriesPicker" class="border border-slate-200 rounded-xl p-3" style="min-height:220px">
              <div class="text-center text-slate-400 text-xs font-bold py-10">Pick a staff member on the left to assign categories.</div>
            </div>
          </div>
          <div id="fieldGrantsList" class="flex flex-wrap gap-1.5"></div>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-1"><i data-lucide="layers" class="h-4 w-4 text-blue-600"></i>Class-Wide Access</p>
          <p class="text-xs text-slate-400 font-bold mt-1 mb-4">A stronger grant than a Field Category: everything for a class/section/group — every core student field <em>and</em> every custom tab's data — not just a named set of columns. Pick a teacher/staff, tick which class-sections they get, and whether they can edit as well as view.</p>
          <div id="classWideGrantees" class="flex flex-wrap gap-2 mb-3"></div>
          <div class="grid md:grid-cols-2 gap-0 border border-slate-200 rounded-2xl overflow-hidden" style="min-height:280px">
            <div class="flex flex-col border-r border-slate-100">
              <div class="p-3 border-b border-slate-100"><input type="text" id="cwaFilter" oninput="filterClassWideStaff()" placeholder="Search by name, ID, shortname or phone…" autocomplete="off" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-cwa-filter"></div>
              <div id="cwaStaffList" class="p-2 overflow-y-auto" style="flex:1;max-height:260px"><div class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></div></div>
            </div>
            <div class="p-4 overflow-y-auto" style="flex:1;max-height:280px">
              <div id="cwaSections"><div class="text-center text-xs text-slate-400 font-bold py-10">Pick a teacher on the left to assign class-sections.</div></div>
            </div>
          </div>
          <div class="flex justify-end mt-3">
            <button id="cwaSaveBtn" onclick="saveClassWideAccess()" disabled class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all disabled:opacity-40">Save</button>
          </div>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-3"><i data-lucide="search" class="h-4 w-4 text-blue-600"></i>Search &amp; Update Students</p>
          <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
            <input type="text" id="stuSearchId" placeholder="Student ID" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-stu-search-id">
            <input type="text" id="stuSearchClass" placeholder="Class" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-stu-search-class">
            <input type="text" id="stuSearchSection" placeholder="Section" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-stu-search-section">
            <input type="text" id="stuSearchRoll" placeholder="Roll" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-stu-search-roll">
            <input type="text" id="stuSearchGroup" placeholder="Group" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-stu-search-group">
            <button onclick="searchStudentsAdmin()" class="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-1"><i data-lucide="search" class="h-3.5 w-3.5"></i>Search</button>
          </div>
          <div class="flex items-center justify-between mb-2">
            <label class="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
              <input type="checkbox" id="stuSearchSelectAll" onchange="toggleAllStudentRows(this.checked)">Select all
            </label>
            <div class="flex items-center gap-2">
              <button onclick="openStudentFormModal(null)" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center gap-1.5"><i data-lucide="user-plus" class="h-3.5 w-3.5"></i>Add Student</button>
              <button id="stuBulkEditBtn" onclick="openBulkEditModal()" disabled
                class="px-4 py-2 border border-slate-200 text-slate-500 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40 transition-all">
                Bulk Edit Selected (<span id="stuSelectedCount">0</span>)
              </button>
            </div>
          </div>
          <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:360px">
            <table class="w-full text-left border-collapse text-xs">
              <thead class="bg-slate-50"><tr id="stuSearchHeaders"></tr></thead>
              <tbody id="stuSearchBody"><tr><td class="p-3 text-slate-400 font-bold">Search above to see results.</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-1"><i data-lucide="download" class="h-4 w-4 text-blue-600"></i>Category Download</p>
          <p class="text-xs text-slate-400 font-bold mt-1 mb-4">The downloaded CSV always includes the selected category's own columns — add more below, and optionally narrow it with the same search filters above or by specific column values.</p>
          <div class="grid md:grid-cols-2 gap-2 mb-3">
            <select id="dlCategorySelect" onchange="onDownloadCategoryChange()" class="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none"><option value="">Select category…</option></select>
            <button onclick="downloadByCategoryAdmin()" class="px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-1.5"><i data-lucide="download" class="h-3.5 w-3.5"></i>Download CSV</button>
          </div>
          <div id="dlExtraColumnsWrap" class="hidden p-3 bg-slate-50 rounded-xl border border-slate-200 mb-3">
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">+ Additional Columns</p>
            <div id="dlExtraColumnsList" class="flex flex-wrap gap-1.5"></div>
          </div>
          <div id="dlFilterWrap" class="hidden p-3 bg-slate-50 rounded-xl border border-slate-200"></div>
        </div>
      </div>

      <div id="fieldCategoryModal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="bg-white rounded-2xl w-full max-w-lg" style="max-height:85vh;display:flex;flex-direction:column">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="font-black text-slate-800 text-sm" id="fieldCategoryModalTitle">New Category</p>
            <button onclick="document.getElementById('fieldCategoryModal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
          </div>
          <div class="p-4">
            <input type="text" id="fcNameInput" placeholder="Category name (e.g. Contact Info)" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:ring-2 focus:ring-blue-600 outline-none mb-3">
            <div class="flex gap-3 mb-2">
              <button onclick="document.querySelectorAll('.fc-field-check').forEach(c=>{c.checked=true;c.dispatchEvent(new Event('change'))})" class="text-[10px] font-black uppercase tracking-widest text-blue-600">Select all</button>
              <button onclick="document.querySelectorAll('.fc-field-check').forEach(c=>{c.checked=false;c.dispatchEvent(new Event('change'))})" class="text-[10px] font-black uppercase tracking-widest text-slate-400">Clear</button>
            </div>
          </div>
          <div class="px-4 pb-4 flex flex-wrap gap-2 overflow-y-auto" style="flex:1" id="fcFieldsList"></div>
          <div class="p-4 border-t border-slate-100 flex justify-end">
            <button onclick="saveFieldCategoryFromEditor()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save</button>
          </div>
        </div>
      </div>

      <div id="bulkEditModal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="bg-white rounded-2xl w-full max-w-md" style="max-height:85vh;display:flex;flex-direction:column">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="font-black text-slate-800 text-sm" id="bulkEditModalTitle">Bulk Edit</p>
            <button onclick="document.getElementById('bulkEditModal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
          </div>
          <p class="text-xs text-slate-400 font-bold px-4 pt-3" id="bulkEditModalHint"></p>
          <div class="px-4 pb-3 pt-2 flex flex-col gap-2 overflow-y-auto" style="flex:1" id="bulkEditFieldsList"></div>
          <div class="p-4 border-t border-slate-100 flex justify-end">
            <button id="bulkEditApplyBtn" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Apply</button>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();

    loadAdminTabVisibility();
    loadFieldCategories();
    loadFieldGrants();
    loadClassWideAccess();
  }

  // ── Assign Class Teacher (student.class_teacher_assignments) ────────────────
  // A database-backed fallback for the Google-Sheet-driven class-teacher
  // detection exec/route.js's _getClassTeacherAssignments does — the sheet
  // stays authoritative, but any class/section it can't resolve a name for
  // (or doesn't list at all) falls back to whatever's assigned here.
  let _ctClassSections = [];
  let _ctAssignments = {};
  let _ctStaff = [];

  function loadAdminClassTeacherView() {
    if (!(window._adminTabAccess || []).includes('class_teacher')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-class_teacher');
    setContentHeader('Assign Class Teacher', 'user-check');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="space-y-5 pb-10">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight">Assign Class Teacher</h2>
          <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Every class/section in the student database, one teacher each</p>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <p class="text-xs text-slate-400 font-bold mb-4">Used as a fallback wherever the routine sheet's own class-teacher list can't resolve a name — assigning someone here always works, even if the sheet is wrong, outdated, or missing that class entirely.</p>
          <input type="text" id="ctFilter" oninput="filterClassTeacherRows()" placeholder="Filter by class or section…" autocomplete="off"
            class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none mb-3" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-ct-filter">
          <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:560px">
            <table class="w-full text-left border-collapse text-xs">
              <thead class="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <tr>
                  <th class="py-2 px-3">Class</th>
                  <th class="py-2 px-3">Section</th>
                  <th class="py-2 px-3">Students</th>
                  <th class="py-2 px-3">Assigned Teacher</th>
                </tr>
              </thead>
              <tbody id="ctTableBody"><tr><td colspan="4" class="p-4 text-slate-400 font-bold italic">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadClassTeacherAssignments();
  }

  function loadClassTeacherAssignments() {
    Promise.all([
      _adminFetch('get_class_sections', {}),
      _adminFetch('get_class_teacher_assignments', {}),
      _adminFetch('get_staff_directory', {}),
    ]).then(([sections, assignRes, staff]) => {
      const seen = new Map();
      (Array.isArray(sections) ? sections : []).forEach(r => {
        const key = `${r.class}||${r.section}`;
        if (!seen.has(key)) seen.set(key, { class: r.class, section: r.section, count: 0 });
        seen.get(key).count++;
      });
      _ctClassSections = [...seen.values()].sort((a, b) => a.class.localeCompare(b.class) || a.section.localeCompare(b.section));
      _ctAssignments = {};
      if (assignRes && assignRes.result === 'success') {
        (assignRes.assignments || []).forEach(a => { _ctAssignments[`${a.class}||${a.section}`] = a.user_id; });
      }
      _ctStaff = Array.isArray(staff) ? staff.slice().sort((a, b) => (a.full_name || a.user_id).localeCompare(b.full_name || b.user_id)) : [];
      renderClassTeacherTable();
    }).catch(() => {
      const body = document.getElementById('ctTableBody');
      if (body) body.innerHTML = '<tr><td colspan="4" class="p-4 text-red-500 font-bold">Failed to load.</td></tr>';
    });
  }

  function renderClassTeacherTable() {
    const body = document.getElementById('ctTableBody');
    if (!body) return;
    const filterEl = document.getElementById('ctFilter');
    const q = (filterEl ? filterEl.value : '').trim().toLowerCase();
    const rows = _ctClassSections.filter(r => !q || r.class.toLowerCase().includes(q) || r.section.toLowerCase().includes(q));
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="p-4 text-slate-400 font-bold italic">No matching class/section.</td></tr>'; return; }
    const staffOptions = _ctStaff.map(s => `<option value="${s.user_id}">${s.full_name || s.user_id}${s.shortname ? ` (${s.shortname})` : ''}</option>`).join('');
    body.innerHTML = rows.map(r => `<tr class="border-b border-slate-50">
        <td class="py-2 px-3 font-black text-slate-700">${r.class}</td>
        <td class="py-2 px-3 font-bold text-slate-500">${r.section}</td>
        <td class="py-2 px-3 text-slate-400">${r.count}</td>
        <td class="py-2 px-3">
          <select class="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs focus:ring-2 focus:ring-blue-600 outline-none w-full max-w-xs"
            data-class="${r.class}" data-section="${r.section}" onchange="saveClassTeacherAssignment(this)">
            <option value="">— Unassigned —</option>
            ${staffOptions}
          </select>
        </td>
      </tr>`).join('');
    const selects = body.querySelectorAll('select[data-class]');
    rows.forEach((r, i) => { if (selects[i]) selects[i].value = _ctAssignments[`${r.class}||${r.section}`] || ''; });
  }

  function filterClassTeacherRows() { renderClassTeacherTable(); }

  function saveClassTeacherAssignment(selectEl) {
    const cls = selectEl.dataset.class, section = selectEl.dataset.section, userId = selectEl.value;
    selectEl.disabled = true;
    _adminFetch('set_class_teacher_assignment', { class: cls, section, user_id: userId || null }).then(res => {
      selectEl.disabled = false;
      if (res && res.result === 'success') {
        const key = `${cls}||${section}`;
        if (userId) _ctAssignments[key] = userId; else delete _ctAssignments[key];
        showToast(userId ? 'Class teacher assigned' : 'Assignment cleared');
      } else {
        showToast((res && res.message) || 'Failed to save', 'error');
        renderClassTeacherTable();
      }
    }).catch(() => { selectEl.disabled = false; showToast('Network error', 'error'); renderClassTeacherTable(); });
  }

  function loadAdminTabVisibility() {
    _adminFetch('get_admin_tab_visibility', {}).then(res => {
      const card = document.getElementById('tabAccessCard');
      if (!res || res.result !== 'success') { if (card) card.style.display = 'none'; return; }
      _tabAccessDefaults = res.defaults || {};
      _tabAccessMatrix = res.matrix || {};
      renderAdminTabVisibility();
    }).catch(() => {});
  }

  function renderAdminTabVisibility() {
    const thead = document.querySelector('#tabAccessTable thead tr');
    const tbody = document.getElementById('tabAccessBody');
    if (!thead || !tbody) return;
    thead.innerHTML = '<th class="py-2 pr-3">Tab</th>' + TAB_ACCESS_ROLES.map(r => `<th class="py-2 px-2 text-center">${r}</th>`).join('');
    tbody.innerHTML = Object.keys(TAB_ACCESS_LABELS).map(tab => {
      const allowed = _tabAccessMatrix[tab] || _tabAccessDefaults[tab] || [];
      return `<tr class="border-b border-slate-50">
        <td class="py-2 pr-3 font-black text-slate-700 text-xs">${TAB_ACCESS_LABELS[tab]}</td>
        ${TAB_ACCESS_ROLES.map(r => `<td class="py-2 px-2 text-center"><input type="checkbox" class="tab-access-cb" data-tab="${tab}" data-role="${r}" ${allowed.includes(r) ? 'checked' : ''}></td>`).join('')}
      </tr>`;
    }).join('');
  }

  function saveAdminTabVisibility() {
    const matrix = {};
    Object.keys(TAB_ACCESS_LABELS).forEach(tab => { matrix[tab] = []; });
    document.querySelectorAll('.tab-access-cb:checked').forEach(cb => matrix[cb.dataset.tab].push(cb.dataset.role));
    const btn = document.getElementById('tabAccessSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    _adminFetch('save_admin_tab_visibility', { matrix }).then(res => {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      if (res && res.result === 'success') { _tabAccessMatrix = res.matrix; showToast('Module access saved'); }
      else showToast((res && res.message) || 'Failed to save', 'error');
    }).catch(() => { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } showToast('Network error', 'error'); });
  }

  function loadFieldCategories() {
    _adminFetch('get_field_categories', {}).then(res => {
      _fieldCategories = (res && res.result === 'success' && Array.isArray(res.categories)) ? res.categories : [];
      renderFieldCategoriesList();
      populateDownloadCategorySelect();
    }).catch(() => {});
  }

  function renderFieldCategoriesList() {
    const host = document.getElementById('fieldCategoriesList');
    if (!host) return;
    if (!_fieldCategories.length) { host.innerHTML = '<span class="text-xs text-slate-400 font-bold italic">No categories yet — create one to get started.</span>'; return; }
    host.innerHTML = _fieldCategories.map(c => `
      <div class="flex justify-between items-center border border-slate-200 rounded-xl px-3 py-2">
        <div>
          <span class="font-black text-slate-800 text-xs">${c.name}</span>
          <span class="text-slate-400 text-xs ml-2">${c.fields.length} field${c.fields.length === 1 ? '' : 's'}: ${c.fields.map(f => f.replace(/_/g,' ')).join(', ')}</span>
        </div>
        <div class="flex gap-1">
          <button onclick="openFieldCategoryEditor('${c.name.replace(/'/g, "\\'")}')" class="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><i data-lucide="pencil" class="h-3.5 w-3.5"></i></button>
          <button onclick="deleteFieldCategoryConfirm('${c.name.replace(/'/g, "\\'")}')" class="w-7 h-7 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
        </div>
      </div>`).join('');
    lucide.createIcons();
  }

  function openFieldCategoryEditor(name) {
    const existing = name ? _fieldCategories.find(c => c.name === name) : null;
    _adminFetch('get_student_data_headers', {}).then(headers => {
      const skip = new Set(['id']);
      const rows = (headers || []).filter(h => !skip.has(h.toLowerCase()));
      const selected = existing ? new Set(existing.fields) : new Set();
      document.getElementById('fieldCategoryModalTitle').textContent = existing ? 'Edit Category' : 'New Category';
      const nameInput = document.getElementById('fcNameInput');
      nameInput.value = existing ? existing.name : '';
      nameInput.readOnly = !!existing;
      document.getElementById('fcFieldsList').innerHTML = rows.map(h => `
        <label class="fc-chip flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${selected.has(h) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}">
          <input type="checkbox" class="fc-field-check" value="${h}" ${selected.has(h) ? 'checked' : ''} onchange="this.closest('label').classList.toggle('bg-blue-50',this.checked);this.closest('label').classList.toggle('border-blue-300',this.checked);this.closest('label').classList.toggle('text-blue-700',this.checked);this.closest('label').classList.toggle('border-slate-200',!this.checked);this.closest('label').classList.toggle('text-slate-500',!this.checked)">${h.replace(/_/g,' ')}
        </label>`).join('');
      document.getElementById('fieldCategoryModal').classList.remove('hidden');
    });
  }

  function saveFieldCategoryFromEditor() {
    const name = document.getElementById('fcNameInput').value.trim();
    const fields = Array.from(document.querySelectorAll('.fc-field-check:checked')).map(c => c.value);
    if (!name) { showToast('Category name required', 'error'); return; }
    if (!fields.length) { showToast('Select at least one field', 'error'); return; }
    _adminFetch('save_field_category', { name, fields }).then(res => {
      document.getElementById('fieldCategoryModal').classList.add('hidden');
      if (res && res.result === 'success') { showToast('Category saved'); loadFieldCategories(); }
      else showToast((res && res.message) || 'Save failed', 'error');
    });
  }

  function deleteFieldCategoryConfirm(name) {
    if (!confirm(`Delete category "${name}"? Any viewer grants using it will also be removed.`)) return;
    _adminFetch('delete_field_category', { name }).then(res => {
      if (res && res.result === 'success') { loadFieldCategories(); loadFieldGrants(); }
      else showToast((res && res.message) || 'Delete failed', 'error');
    });
  }

  function populateDownloadCategorySelect() {
    const sel = document.getElementById('dlCategorySelect');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select category…</option>' + _fieldCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    if (_fieldCategories.some(c => c.name === current)) sel.value = current;
  }

  // Lazily-cached full column list for the "+ Additional Columns" picker —
  // same get_student_data_headers action used elsewhere, fetched once and
  // reused across category switches.
  let _dlAllHeaders = null;
  function onDownloadCategoryChange() {
    const catName = document.getElementById('dlCategorySelect').value;
    const extraWrap = document.getElementById('dlExtraColumnsWrap');
    const filterWrap = document.getElementById('dlFilterWrap');
    if (!catName) { extraWrap.classList.add('hidden'); filterWrap.classList.add('hidden'); filterWrap.innerHTML = ''; return; }
    const cat = _fieldCategories.find(c => c.name === catName);
    const catFields = new Set((cat && cat.fields) || []);

    const renderExtraColumns = (headers) => {
      const options = headers.filter(h => !catFields.has(h) && h !== 'student_id');
      document.getElementById('dlExtraColumnsList').innerHTML = options.length ? options.map(h =>
        `<label class="px-2.5 py-1.5 rounded-lg border border-white bg-white text-xs font-bold text-slate-500 cursor-pointer">
          <input type="checkbox" class="dl-extra-col" value="${h}">${h.replace(/_/g, ' ')}
        </label>`
      ).join('') : '<span class="text-xs text-slate-400 font-bold italic">No other columns available.</span>';
    };
    extraWrap.classList.remove('hidden');
    if (_dlAllHeaders) renderExtraColumns(_dlAllHeaders);
    else _adminFetch('get_student_data_headers', {}).then(headers => { _dlAllHeaders = Array.isArray(headers) ? headers : []; renderExtraColumns(_dlAllHeaders); }).catch(() => {});

    const renderFilters = () => {
      // Same reasoning as the Viewer Access Grants scope picker: class/
      // section/group/version exist on every student regardless of whether
      // the category being downloaded happens to expose them as columns, so
      // every category can be row-filtered by them, not just ones that do.
      const scopableHere = SCOPABLE_COLUMNS;
      filterWrap.innerHTML = `
        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Filter by value (leave a row unchecked = any value)</p>
        <div class="flex flex-col gap-1.5">
          ${scopableHere.map(col => {
            const vals = (_scopeColumnValues && _scopeColumnValues[col]) || [];
            return `<div class="flex items-start gap-2">
              <span class="text-[10px] font-black text-slate-500 uppercase pt-0.5" style="min-width:52px">${col}</span>
              <div class="flex flex-wrap gap-1.5">
                ${vals.map(v => `<label class="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[11px] font-bold text-slate-600 cursor-pointer"><input type="checkbox" class="dl-filter-value" data-col="${col}" value="${String(v).replace(/"/g, '&quot;')}">${v}</label>`).join('') || '<span class="text-[10px] text-slate-300 italic">No values found</span>'}
              </div>
            </div>`;
          }).join('')}
        </div>`;
      filterWrap.classList.remove('hidden');
    };
    if (_scopeColumnValues) renderFilters();
    else _adminFetch('get_scope_column_values', {}).then(res => { _scopeColumnValues = (res && res.result === 'success' && res.values) || {}; renderFilters(); }).catch(() => {});
  }

  function loadFieldGrants() {
    Promise.all([
      _adminFetch('get_staff_directory', {}),
      _adminFetch('get_field_access_grants', {}),
      _adminFetch('get_scope_column_values', {}),
    ]).then(([staff, grantsRes, scopeRes]) => {
      _grantStaff = Array.isArray(staff) ? staff : [];
      _fieldGrants = {};
      ((grantsRes && grantsRes.grants) || []).forEach(g => { _fieldGrants[g.user_id] = g.categories || []; });
      _scopeColumnValues = (scopeRes && scopeRes.result === 'success' && scopeRes.values) || {};
      renderGrantStaffList();
      renderFieldGrantsList();
    }).catch(() => {});
  }

  function renderGrantStaffList() {
    const list = document.getElementById('grantStaffList');
    if (!list) return;
    if (!_grantStaff.length) { list.innerHTML = '<div class="text-slate-400 text-xs font-bold p-2">No staff accounts found.</div>'; return; }
    list.innerHTML = _grantStaff.map(u => {
      const search = [u.full_name, u.user_id, u.shortname, u.phone].filter(Boolean).join(' ').toLowerCase();
      const selected = _grantSelectedUser === u.user_id;
      const count = (_fieldGrants[u.user_id] || []).length;
      return `<div class="grant-staff-row py-1.5 px-2.5 cursor-pointer text-xs ${selected ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}" data-uid="${u.user_id}" data-search="${search.replace(/"/g,'&quot;')}" onclick="selectGrantUser(this.dataset.uid)">
        <div class="flex justify-between items-center">
          <span class="font-bold">${u.full_name || u.user_id}</span>
          ${count ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-black ${selected ? 'bg-white text-slate-800' : 'bg-emerald-500 text-white'}">${count}</span>` : ''}
        </div>
      </div>`;
    }).join('');
    filterGrantStaff();
  }

  function filterGrantStaff() {
    const q = (document.getElementById('grantUserSearch') || {}).value?.toLowerCase() || '';
    document.querySelectorAll('.grant-staff-row').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  }

  // The small set of categorical students_data columns an admin can scope a
  // Field Category grant down to — checked via real distinct values fetched
  // once from get_scope_column_values, shown only for a category whose own
  // field list happens to include one of these (e.g. "student info" with
  // class/section/version/group unlocks all four pickers; a category of
  // just phone/email fields shows none).
  const SCOPABLE_COLUMNS = ['class', 'section', 'group', 'version'];
  let _scopeColumnValues = null;

  function selectGrantUser(uid) {
    _grantSelectedUser = uid;
    renderGrantStaffList();
    const host = document.getElementById('grantCategoriesPicker');
    const granted = _fieldGrants[uid] || [];
    const person = _grantStaff.find(s => s.user_id === uid);
    if (!_fieldCategories.length) { host.innerHTML = '<div class="text-slate-400 text-xs font-bold">Create a field category first.</div>'; return; }
    host.innerHTML = `
      <div class="text-xs font-black text-slate-700 mb-2">Categories for ${(person && person.full_name) || uid}</div>
      <div class="flex flex-col gap-1 mb-3">
        ${_fieldCategories.map(c => {
          const g = granted.find(x => x.name === c.name);
          const rowFilter = (g && g.row_filter) || {};
          // Row-scoping is independent of which columns a category exposes —
          // class/section/group/version exist on every student regardless of
          // whether they're part of THIS category's own granted field list,
          // so every category gets the same scope picker, not just ones that
          // happen to include those columns among their visible fields.
          const scopableHere = SCOPABLE_COLUMNS;
          const catKey = c.name.replace(/[^a-zA-Z0-9]/g, '_');
          return `<div class="border border-slate-200 rounded-lg px-2.5 py-1.5">
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-2 cursor-pointer" style="min-width:160px">
                <input type="checkbox" class="grant-category-check" value="${c.name}" ${g ? 'checked' : ''} onchange="_syncGrantEditCheckbox(this); _toggleGrantScopePanel('${catKey}', this.checked)">${c.name}
              </label>
              <label class="flex items-center gap-2 text-slate-400 cursor-pointer">
                <input type="checkbox" class="grant-category-edit-check" value="${c.name}" ${g && g.can_edit ? 'checked' : ''} ${g ? '' : 'disabled'} onchange="if(this.checked) this.closest('div').querySelector('.grant-category-check').checked = true">Can edit
              </label>
            </div>
            ${scopableHere.length ? `<div id="grantScope_${catKey}" class="grant-scope-panel mt-2 pt-2 border-t border-slate-100 ${g ? '' : 'hidden'}" data-cat="${c.name.replace(/"/g, '&quot;')}">
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">Restrict to (leave a row unchecked = any value)</p>
              <div class="flex flex-col gap-1.5">
                ${scopableHere.map(col => {
                  const vals = (_scopeColumnValues && _scopeColumnValues[col]) || [];
                  const checkedVals = new Set((rowFilter[col] || []).map(String));
                  return `<div class="flex items-start gap-2">
                    <span class="text-[10px] font-black text-slate-500 uppercase pt-0.5" style="min-width:52px">${col}</span>
                    <div class="flex flex-wrap gap-1.5">
                      ${vals.map(v => `<label class="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-bold text-slate-600 cursor-pointer"><input type="checkbox" class="grant-scope-value" data-col="${col}" value="${String(v).replace(/"/g, '&quot;')}" ${checkedVals.has(String(v)) ? 'checked' : ''}>${v}</label>`).join('') || '<span class="text-[10px] text-slate-300 italic">No values found</span>'}
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <button onclick="saveFieldGrantsForUser()" class="w-full px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save Grants</button>`;
    lucide.createIcons();
  }

  function _syncGrantEditCheckbox(mainCb) {
    const editCb = mainCb.closest('div.border').querySelector('.grant-category-edit-check');
    if (!editCb) return;
    editCb.disabled = !mainCb.checked;
    if (!mainCb.checked) editCb.checked = false;
  }
  function _toggleGrantScopePanel(catKey, show) {
    const panel = document.getElementById('grantScope_' + catKey);
    if (panel) panel.classList.toggle('hidden', !show);
  }

  function saveFieldGrantsForUser() {
    if (!_grantSelectedUser) return;
    const editSet = new Set(Array.from(document.querySelectorAll('.grant-category-edit-check:checked')).map(c => c.value));
    const categories = Array.from(document.querySelectorAll('.grant-category-check:checked')).map(c => {
      const row = c.closest('div.border');
      const scopePanel = row ? row.querySelector('.grant-scope-panel') : null;
      let row_filter = null;
      if (scopePanel) {
        const rf = {};
        scopePanel.querySelectorAll('.grant-scope-value:checked').forEach(cb => { (rf[cb.dataset.col] = rf[cb.dataset.col] || []).push(cb.value); });
        if (Object.keys(rf).length) row_filter = rf;
      }
      return { name: c.value, can_edit: editSet.has(c.value), row_filter };
    });
    _adminFetch('set_field_access_grants', { user_id: _grantSelectedUser, categories }).then(res => {
      if (res && res.result === 'success') {
        _fieldGrants[_grantSelectedUser] = categories;
        renderGrantStaffList();
        renderFieldGrantsList();
        showToast('Access updated');
      } else showToast((res && res.message) || 'Save failed', 'error');
    });
  }

  function renderFieldGrantsList() {
    const host = document.getElementById('fieldGrantsList');
    if (!host) return;
    const entries = Object.entries(_fieldGrants).filter(([, cats]) => cats.length);
    host.innerHTML = entries.length ? entries.map(([uid, cats]) => {
      const person = _grantStaff.find(s => s.user_id === uid);
      const catText = cats.map(c => c.can_edit ? `${c.name} (edit)` : c.name).join(', ');
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-[11px] font-bold">
        ${(person && person.full_name) || uid}: ${catText}
        <i data-lucide="x-circle" class="h-3 w-3 cursor-pointer" onclick="revokeFieldGrant('${uid.replace(/'/g,"\\'")}')"></i>
      </span>`;
    }).join('') : '<span class="text-xs text-slate-400 font-bold italic">No viewers granted yet.</span>';
    lucide.createIcons();
  }

  function revokeFieldGrant(uid) {
    _adminFetch('set_field_access_grants', { user_id: uid, categories: [] }).then(res => {
      if (res && res.result === 'success') {
        delete _fieldGrants[uid];
        if (_grantSelectedUser === uid) selectGrantUser(uid);
        renderGrantStaffList();
        renderFieldGrantsList();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Class-Wide Access — a stronger, class/section/group-scoped grant than
  // a Field Category: the grantee's Viewer Panel gets every core student
  // field (not a named subset) AND every custom tab's submission data for
  // students inside their granted combos, with edit rights when checked.
  // Same two-pane staff-picker + class-section-checkbox idiom as the Data
  // tab's per-tab Class Access, just without a tab_name (this covers all
  // of them) and with an added "Can edit" toggle per class-section.
  // ══════════════════════════════════════════════════════════════════════
  let _cwaStaff = [], _cwaClassSections = [], _cwaGrants = {}, _cwaSelectedUser = null;

  function loadClassWideAccess() {
    Promise.all([_adminFetch('get_staff_directory', {}), _adminFetch('get_class_sections', {}), _adminFetch('get_class_access_grants', {})])
      .then(([staff, sections, grantsRes]) => {
        _cwaStaff = Array.isArray(staff) ? staff : [];
        _cwaClassSections = Array.isArray(sections) ? sections : [];
        _cwaGrants = {};
        ((grantsRes && grantsRes.grants) || []).forEach(g => { _cwaGrants[g.user_id] = g.class_sections || []; });
        renderClassWideStaff();
        renderClassWideGrantees();
      }).catch(() => {});
  }
  function renderClassWideStaff() {
    const list = document.getElementById('cwaStaffList');
    if (!list) return;
    if (!_cwaStaff.length) { list.innerHTML = '<div class="text-xs text-slate-400 font-bold">No teacher/staff accounts found.</div>'; return; }
    list.innerHTML = _cwaStaff.map(u => {
      const search = [u.full_name, u.user_id, u.shortname, u.phone].filter(Boolean).join(' ').toLowerCase();
      const selected = _cwaSelectedUser === u.user_id;
      const grantCount = (_cwaGrants[u.user_id] || []).length;
      return `<div class="cwa-staff-row py-1.5 px-2 rounded-lg mb-1 cursor-pointer ${selected ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}" data-uid="${u.user_id}" data-search="${search.replace(/"/g, '&quot;')}" onclick="selectClassWideUser(this.dataset.uid)">
        <div class="flex justify-between items-start gap-2">
          <div class="truncate">
            <span class="font-black text-xs">${u.full_name || u.user_id}</span>
            ${u.shortname ? `<span class="text-[9px] font-black rounded px-1 py-0.5 ml-1 ${selected ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}">${u.shortname}</span>` : ''}
            <div class="text-[11px] ${selected ? 'text-white/80' : 'text-slate-400'}">${u.user_id}${u.phone ? ' · ' + u.phone : ''}</div>
          </div>
          ${grantCount ? `<span class="text-[9px] font-black rounded-full px-1.5 py-0.5 shrink-0 ${selected ? 'bg-white text-blue-600' : 'bg-emerald-500 text-white'}">${grantCount}</span>` : ''}
        </div>
      </div>`;
    }).join('');
    filterClassWideStaff();
  }
  function filterClassWideStaff() {
    const q = (document.getElementById('cwaFilter') || {}).value?.toLowerCase() || '';
    document.querySelectorAll('.cwa-staff-row').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  }
  function renderClassWideGrantees() {
    const host = document.getElementById('classWideGrantees');
    if (!host) return;
    const entries = Object.entries(_cwaGrants).filter(([, cs]) => cs.length);
    host.innerHTML = entries.length ? entries.map(([uid, cs]) => {
      const person = _cwaStaff.find(s => s.user_id === uid);
      const editCount = cs.filter(c => c.can_edit).length;
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-[11px] font-bold">${(person && person.full_name) || uid} · ${cs.length} class${cs.length === 1 ? '' : 'es'}${editCount ? ` (${editCount} editable)` : ''} <i data-lucide="x-circle" class="h-3 w-3 cursor-pointer" onclick="removeClassWideAccess('${uid.replace(/'/g, "\\'")}')"></i></span>`;
    }).join('') : '<span class="text-xs text-slate-400 font-bold italic">No class-wide grants yet.</span>';
    lucide.createIcons();
  }
  function selectClassWideUser(uid) {
    _cwaSelectedUser = uid;
    renderClassWideStaff();
    const host = document.getElementById('cwaSections');
    const saveBtn = document.getElementById('cwaSaveBtn');
    if (saveBtn) saveBtn.disabled = false;
    const granted = {};
    (_cwaGrants[uid] || []).forEach(cs => { granted[`${cs.class}|${cs.section}|${cs.group || 'None'}`] = cs.can_edit; });
    const person = _cwaStaff.find(s => s.user_id === uid);
    host.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs font-black text-slate-700">Class-sections for ${(person && person.full_name) || uid}</span>
        <span class="flex gap-2">
          <button onclick="toggleAllClassWideSections(true)" class="text-[10px] font-black uppercase text-blue-600">Select all</button>
          <button onclick="toggleAllClassWideSections(false)" class="text-[10px] font-black uppercase text-slate-400">Clear</button>
        </span>
      </div>
      <div class="flex flex-col gap-1">
        ${_cwaClassSections.map(cs => {
          const grp = cs.group || 'None';
          const key = `${cs.class}|${cs.section}|${grp}`;
          const label = grp !== 'None' ? `${cs.class}-${cs.section}-${grp}` : `${cs.class}-${cs.section}`;
          const isGranted = key in granted;
          return `<div class="flex items-center justify-between gap-2 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5">
            <label class="flex items-center gap-2 cursor-pointer" style="min-width:140px">
              <input type="checkbox" class="cwa-section-check" value="${key.replace(/"/g, '&quot;')}" ${isGranted ? 'checked' : ''} onchange="_syncCwaEditCheckbox(this)">${label}
            </label>
            <label class="flex items-center gap-2 text-slate-400 cursor-pointer">
              <input type="checkbox" class="cwa-section-edit-check" value="${key.replace(/"/g, '&quot;')}" ${isGranted && granted[key] ? 'checked' : ''} ${isGranted ? '' : 'disabled'} onchange="if(this.checked) this.closest('div').querySelector('.cwa-section-check').checked = true">Can edit
            </label>
          </div>`;
        }).join('')}
      </div>`;
  }
  function _syncCwaEditCheckbox(mainCb) {
    const editCb = mainCb.closest('div').querySelector('.cwa-section-edit-check');
    if (!editCb) return;
    editCb.disabled = !mainCb.checked;
    if (!mainCb.checked) editCb.checked = false;
  }
  function toggleAllClassWideSections(on) {
    document.querySelectorAll('.cwa-section-check').forEach(c => { c.checked = on; _syncCwaEditCheckbox(c); });
  }
  function saveClassWideAccess() {
    if (!_cwaSelectedUser) return;
    const editSet = new Set(Array.from(document.querySelectorAll('.cwa-section-edit-check:checked')).map(c => c.value));
    const class_sections = Array.from(document.querySelectorAll('.cwa-section-check:checked')).map(c => {
      const [cls, sec, grp] = c.value.split('|');
      return { class: cls, section: sec, group: grp, can_edit: editSet.has(c.value) };
    });
    _adminFetch('set_class_access_grants', { user_id: _cwaSelectedUser, class_sections }).then(res => {
      if (res && res.result === 'success') {
        _cwaGrants[_cwaSelectedUser] = class_sections;
        renderClassWideGrantees();
        renderClassWideStaff();
        showToast(`${res.count} class-section${res.count === 1 ? '' : 's'} granted`);
      } else showToast((res && res.message) || 'Save failed', 'error');
    });
  }
  function removeClassWideAccess(uid) {
    _adminFetch('set_class_access_grants', { user_id: uid, class_sections: [] }).then(res => {
      if (res && res.result === 'success') {
        delete _cwaGrants[uid];
        renderClassWideGrantees();
        renderClassWideStaff();
        if (_cwaSelectedUser === uid) selectClassWideUser(uid);
        showToast('Access revoked');
      }
    });
  }

  function searchStudentsAdmin() {
    const payload = {
      student_id: document.getElementById('stuSearchId').value.trim(),
      class: document.getElementById('stuSearchClass').value.trim(),
      section: document.getElementById('stuSearchSection').value.trim(),
      roll: document.getElementById('stuSearchRoll').value.trim(),
      group: document.getElementById('stuSearchGroup').value.trim(),
    };
    _adminFetch('search_students', payload).then(res => {
      if (!res || res.result !== 'success') { showToast((res && res.message) || 'Search failed', 'error'); return; }
      _stuSearchRows = res.rows || [];
      _stuSearchHeaders = _stuSearchRows.length ? Object.keys(_stuSearchRows[0]) : [];
      renderStuSearchTable();
    });
  }

  function renderStuSearchTable() {
    const headEl = document.getElementById('stuSearchHeaders');
    const bodyEl = document.getElementById('stuSearchBody');
    if (!_stuSearchRows.length) {
      headEl.innerHTML = '';
      bodyEl.innerHTML = '<tr><td class="p-3 text-slate-400 font-bold text-xs">No students matched.</td></tr>';
      updateStuSelectedCount();
      return;
    }
    headEl.innerHTML = '<th style="width:28px"></th>' + _stuSearchHeaders.map(h => `<th class="py-2 px-2 font-black text-[10px] text-slate-500 uppercase">${h.replace(/_/g,' ')}</th>`).join('') + '<th style="width:36px"></th>';
    bodyEl.innerHTML = _stuSearchRows.map(r => `<tr class="border-b border-slate-50">
      <td class="px-2"><input type="checkbox" class="stu-row-check" value="${String(r.student_id).replace(/"/g,'&quot;')}" onchange="updateStuSelectedCount()"></td>
      ${_stuSearchHeaders.map(h => `<td class="py-1.5 px-2 text-slate-600">${r[h] ?? ''}</td>`).join('')}
      <td class="px-2"><button onclick="openStudentFormModal('${String(r.student_id).replace(/'/g,"\\'")}')" title="Edit Student" class="p-1.5 hover:bg-indigo-50 text-indigo-500 rounded-lg transition-all"><i data-lucide="pencil" class="h-3.5 w-3.5"></i></button></td>
    </tr>`).join('');
    updateStuSelectedCount();
    lucide.createIcons();
  }

  function toggleAllStudentRows(checked) {
    document.querySelectorAll('.stu-row-check').forEach(c => { c.checked = checked; });
    updateStuSelectedCount();
  }

  function updateStuSelectedCount() {
    const n = document.querySelectorAll('.stu-row-check:checked').length;
    const el = document.getElementById('stuSelectedCount');
    if (el) el.textContent = n;
    const btn = document.getElementById('stuBulkEditBtn');
    if (btn) btn.disabled = n === 0;
  }

  function openBulkEditModal() {
    const ids = Array.from(document.querySelectorAll('.stu-row-check:checked')).map(c => c.value);
    if (!ids.length) return;
    _adminFetch('get_student_data_headers', {}).then(headers => {
      const locked = new Set(['id','student_id','nfc_uid','pin','balance','daily_limit','monthly_limit','card_status','submitted_at']);
      const rows = (headers || []).filter(h => !locked.has(h.toLowerCase()));
      document.getElementById('bulkEditModalTitle').textContent = `Bulk Edit — ${ids.length} student${ids.length === 1 ? '' : 's'}`;
      document.getElementById('bulkEditModalHint').textContent = `Leave a field blank to leave it unchanged. Every filled-in field is set to the same value on all ${ids.length} selected student${ids.length === 1 ? '' : 's'}.`;
      document.getElementById('bulkEditFieldsList').innerHTML = rows.map(h => `
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-black text-slate-400 uppercase" style="min-width:110px">${h.replace(/_/g,' ')}</span>
          <input type="text" class="bulk-edit-field flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" data-field="${h}" placeholder="No change">
        </div>`).join('');
      const applyBtn = document.getElementById('bulkEditApplyBtn');
      applyBtn.textContent = `Apply to ${ids.length} student${ids.length === 1 ? '' : 's'}`;
      applyBtn.onclick = () => submitBulkEdit(ids);
      document.getElementById('bulkEditModal').classList.remove('hidden');
    });
  }

  function submitBulkEdit(ids) {
    const updates = {};
    document.querySelectorAll('.bulk-edit-field').forEach(inp => {
      const v = inp.value.trim();
      if (v !== '') updates[inp.dataset.field] = v;
    });
    if (!Object.keys(updates).length) { showToast('Set at least one field', 'error'); return; }
    _adminFetch('bulk_update_students', { student_ids: ids, updates }).then(res => {
      document.getElementById('bulkEditModal').classList.add('hidden');
      if (res && (res.result === 'success' || res.result === 'partial')) {
        showToast(`Updated ${res.updated} student${res.updated === 1 ? '' : 's'}${res.errors && res.errors.length ? ' (' + res.errors.length + ' failed)' : ''}`, res.result === 'success' ? 'success' : 'error');
        searchStudentsAdmin();
      } else showToast((res && res.message) || 'Update failed', 'error');
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Student Edit / Add — full-field single-record editor, reached via the
  // pencil icon on each search result row (or "+ Add Student"). Unlike
  // Bulk Edit above, Student ID itself is editable here — renaming it goes
  // through the same impact-preview popup used for staff Login IDs, since
  // it cascades across attendance/fees/exams/etc. the same way.
  // ══════════════════════════════════════════════════════════════════════
  const STUDENT_LOCKED_FIELDS = new Set(['id', 'nfc_uid', 'pin', 'balance', 'daily_limit', 'monthly_limit', 'card_status', 'submitted_at']);
  let _studentFormOriginalId = null;

  function openStudentFormModal(studentId) {
    _studentFormOriginalId = studentId || null;
    const buildModal = (row) => {
      _adminFetch('get_student_data_headers', {}).then(headers => {
        const fields = (headers || []).filter(h => !STUDENT_LOCKED_FIELDS.has(h.toLowerCase()));
        document.getElementById('studentFormOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'studentFormOverlay';
        overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
        overlay.innerHTML = `
          <div class="bg-white rounded-2xl w-full max-w-2xl" style="max-height:88vh;display:flex;flex-direction:column">
            <div class="p-5 border-b border-slate-100 flex items-center justify-between">
              <p class="font-black text-slate-800 text-sm">${studentId ? 'Edit Student — ' + studentId : 'Add Student'}</p>
              <button onclick="document.getElementById('studentFormOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
            </div>
            <div class="p-5 overflow-y-auto grid md:grid-cols-2 gap-4" style="flex:1">
              ${fields.map(h => `<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">${h.replace(/_/g, ' ')}${h === 'student_id' ? ' <span class=\"text-red-500\">*</span>' : ''}</label><input type="text" class="stu-form-field w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm" data-field="${h}" value="${String(row?.[h] ?? '').replace(/"/g, '&quot;')}"></div>`).join('')}
            </div>
            <div class="p-5 border-t border-slate-100 flex justify-end">
              <button onclick="submitStudentForm()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">${studentId ? 'Save Changes' : 'Create Student'}</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        lucide.createIcons();
      });
    };
    if (studentId) {
      const cached = _stuSearchRows.find(r => r.student_id === studentId);
      if (cached) { buildModal(cached); return; }
      _adminFetch('search_students', { student_id: studentId }).then(res => {
        buildModal((res && res.rows && res.rows[0]) || null);
      });
    } else {
      buildModal(null);
    }
  }

  function submitStudentForm() {
    const data = {};
    document.querySelectorAll('.stu-form-field').forEach(inp => { data[inp.dataset.field] = inp.value.trim(); });
    const newStudentId = data.student_id;
    if (!newStudentId) { showToast('Student ID is required', 'error'); return; }

    if (!_studentFormOriginalId) {
      _adminFetch('create_student', data).then(res => {
        if (!res || res.result !== 'success') { showToast((res && res.message) || 'Could not create student', 'error'); return; }
        document.getElementById('studentFormOverlay')?.remove();
        showToast('Student created');
        searchStudentsAdmin();
      });
      return;
    }

    const doSave = () => {
      _adminFetch('bulk_update_students', { student_ids: [_studentFormOriginalId], updates: data }).then(res => {
        if (!res || (res.result !== 'success' && res.result !== 'partial')) { showToast((res && res.message) || 'Save failed', 'error'); return; }
        document.getElementById('studentFormOverlay')?.remove();
        showToast('Student updated');
        searchStudentsAdmin();
      });
    };

    if (newStudentId !== _studentFormOriginalId) {
      _adminFetch('preview_rename_student_id_impact', { student_id: _studentFormOriginalId }).then(res => {
        if (!res || res.result !== 'success') { showToast((res && res.message) || 'Could not check impact', 'error'); return; }
        _showRenameImpactPopup(res.impact, doSave);
      });
    } else {
      doSave();
    }
  }

  function downloadByCategoryAdmin() {
    const category_name = document.getElementById('dlCategorySelect').value;
    if (!category_name) { showToast('Select a category', 'error'); return; }
    const extra_columns = Array.from(document.querySelectorAll('.dl-extra-col:checked')).map(c => c.value);
    const extra_filter = {};
    document.querySelectorAll('.dl-filter-value:checked').forEach(cb => {
      (extra_filter[cb.dataset.col] = extra_filter[cb.dataset.col] || []).push(cb.value);
    });
    const payload = {
      category_name,
      student_id: document.getElementById('stuSearchId').value.trim(),
      class: document.getElementById('stuSearchClass').value.trim(),
      section: document.getElementById('stuSearchSection').value.trim(),
      roll: document.getElementById('stuSearchRoll').value.trim(),
      group: document.getElementById('stuSearchGroup').value.trim(),
      extra_columns,
      extra_filter,
    };
    _adminFetch('download_students_by_category', payload).then(res => {
      if (!res || res.result !== 'success') { showToast((res && res.message) || 'Download failed', 'error'); return; }
      const csv = res.headers.join(',') + '\n' + res.rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${category_name}_export.csv`;
      a.click();
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Fees tab — native port (Phase 2). Same idiom as loadAdminAccessView:
  // one loadAdminFeesView entry point, a switchFeesTab sub-nav matching
  // loadSystemView's switchSysTab idiom, and _adminFetch for every backend
  // call — no backend changes.
  // ══════════════════════════════════════════════════════════════════════

  const FEES_SUBTABS = [
    { id: 'fees-types', label: 'Fee Types' },
    { id: 'fees-structures', label: 'Fee Structures' },
    { id: 'fees-generate', label: 'Generate Fees' },
    { id: 'fees-late', label: 'Late Fee Rules' },
    { id: 'fees-student', label: 'Student Fees / Discounts' },
    { id: 'fees-reports', label: 'Reports' },
    { id: 'fees-accounts', label: 'Accounts' },
  ];
  let _feeTypes = [];
  let _curStudentFeeStudentId = null;

  function loadAdminFeesView() {
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-fees');
    setContentHeader('Fees', 'wallet');
    const container = document.getElementById('view-container');
    if (!container) return;
    const tabBar = FEES_SUBTABS.map((t, i) => `<button onclick="switchFeesTab('${t.id}')" id="ftab-${t.id}"
      class="fees-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
             ${i === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}">${t.label}</button>`).join('');

    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Fees</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Fee types, structures, generation, late fees, discounts, reports, accounts</p>
      </div>
      <div class="flex flex-wrap gap-2 mb-5">${tabBar}</div>

      <div id="fees-types">
        <div class="flex items-center justify-between mb-3">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="tags" class="h-4 w-4 text-blue-600"></i>Fee Types</p>
          <button onclick="openFeeTypeEditor(null)" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">+ New Fee Type</button>
        </div>
        <div id="feeTypesList" class="flex flex-col gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading…</span></div>
      </div>

      <div id="fees-structures" style="display:none">
        <div class="bg-white rounded-2xl border border-slate-200 p-4 mb-3">
          <p class="font-black text-slate-800 text-xs mb-3 flex items-center gap-2"><i data-lucide="git-branch" class="h-4 w-4 text-blue-600"></i>New Fee Structure</p>
          <div class="grid grid-cols-2 md:grid-cols-6 gap-2">
            <select id="fsFeeType" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Fee Type…</option></select>
            <input type="text" id="fsClass" placeholder="Class" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="text" id="fsSection" placeholder="Section (optional)" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="text" id="fsYear" placeholder="Academic Year" value="2026" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="number" id="fsAmount" placeholder="Amount" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <button onclick="saveFeeStructure()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase flex items-center justify-center"><i data-lucide="check" class="h-3.5 w-3.5"></i></button>
          </div>
          <select id="fsCollectionMode" class="mt-2 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" style="max-width:220px">
            <option value="Monthly">Monthly</option><option value="OnReceive">On Receive</option><option value="OneTime">One Time</option>
          </select>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Fee Type</th><th class="py-2 px-3">Class</th><th class="py-2 px-3">Section</th><th class="py-2 px-3">Year</th><th class="py-2 px-3">Amount</th><th class="py-2 px-3">Mode</th><th class="py-2 px-3">Actions</th></tr></thead>
            <tbody id="feeStructuresBody"></tbody>
          </table>
        </div>
      </div>

      <div id="fees-generate" style="display:none">
        <div class="grid md:grid-cols-2 gap-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <p class="font-black text-slate-800 text-xs mb-3 flex items-center gap-2"><i data-lucide="users" class="h-4 w-4 text-blue-600"></i>Classwise Fee Generation</p>
            <div class="flex flex-col gap-2">
              <select id="genCwFeeType" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Fee Type…</option></select>
              <input type="text" id="genCwClass" placeholder="Class" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="genCwSection" placeholder="Section (optional)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="genCwYear" placeholder="Academic Year" value="2026" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="genCwMonth" placeholder="Fee Month (e.g. January)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="generateClasswiseFees()" class="px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Generate for Class</button>
              <span id="genCwStatus" class="text-xs font-bold"></span>
            </div>
          </div>
          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <p class="font-black text-slate-800 text-xs mb-3 flex items-center gap-2"><i data-lucide="user" class="h-4 w-4 text-blue-600"></i>Individual Student Fee Generation</p>
            <div class="flex flex-col gap-2">
              <input type="text" id="genIndStudent" placeholder="Student ID" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <select id="genIndFeeType" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Fee Type…</option></select>
              <input type="text" id="genIndYear" placeholder="Academic Year" value="2026" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="genIndMonth" placeholder="Fee Month (e.g. January)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="generateIndividualFee()" class="px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Generate for Student</button>
              <span id="genIndStatus" class="text-xs font-bold"></span>
            </div>
          </div>
        </div>
      </div>

      <div id="fees-late" style="display:none">
        <div class="flex items-center justify-between mb-3">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="alarm-clock" class="h-4 w-4 text-blue-600"></i>Late Fee Rules</p>
          <button onclick="openLateFeeEditor()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">+ New Rule</button>
        </div>
        <p class="text-xs text-slate-400 font-bold mb-3">Late fee applies immediately after the deadline is missed (no grace period). Fee is a fixed one-time amount — not per-day, not tiered.</p>
        <div id="lateFeeRulesList" class="flex flex-col gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading…</span></div>
      </div>

      <div id="fees-student" style="display:none">
        <div class="flex gap-2 mb-3">
          <input type="text" id="stufeeSearchId" placeholder="Student ID" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs flex-1 max-w-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-stufee-search-id">
          <button onclick="loadStudentFees()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center gap-1"><i data-lucide="search" class="h-3.5 w-3.5"></i>Search</button>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl mb-3">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Fee Type</th><th class="py-2 px-3">Year</th><th class="py-2 px-3">Month</th><th class="py-2 px-3">Total</th><th class="py-2 px-3">Active Due</th><th class="py-2 px-3">Deferred</th><th class="py-2 px-3">Status</th><th class="py-2 px-3">Actions</th></tr></thead>
            <tbody id="studentFeesBody"><tr><td colspan="8" class="p-3 text-slate-400 font-bold text-xs">Search a student to see their fees.</td></tr></tbody>
          </table>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4">
          <p class="font-black text-slate-800 text-xs mb-3">Add Discount / Waiver for this student</p>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <select id="discFeeType" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Any fee type…</option></select>
            <select id="discType" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="fixed">Fixed</option><option value="percent">Percent</option></select>
            <input type="number" id="discValue" placeholder="Value" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="text" id="discReason" placeholder="Reason" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <button onclick="saveFeeDiscount()" class="px-3 py-2 border border-slate-200 text-slate-600 rounded-lg font-black text-[10px] uppercase hover:bg-slate-50">Add</button>
          </div>
        </div>
      </div>

      <div id="fees-reports" style="display:none">
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="alert-triangle" class="h-4 w-4 text-red-500"></i>Defaulters List</p>
            <input type="text" id="defClassFilter" placeholder="Filter by class (optional)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs mb-2" style="max-width:260px" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-def-class-filter">
            <button onclick="loadDefaultersList()" class="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg font-black text-[10px] uppercase mb-2 hover:bg-red-50">Refresh</button>
            <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:340px">
              <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Student</th><th class="py-2 px-3">Fee Type</th><th class="py-2 px-3">Month</th><th class="py-2 px-3">Due</th></tr></thead>
                <tbody id="defaultersBody"></tbody>
              </table>
            </div>
          </div>
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="trending-up" class="h-4 w-4 text-emerald-500"></i>Fees Collection Report</p>
            <div id="feesCollectionSummary" class="mb-2"></div>
            <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:340px">
              <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Date</th><th class="py-2 px-3">Amount</th></tr></thead>
                <tbody id="feesCollectionBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div id="fees-accounts" style="display:none">
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="landmark" class="h-4 w-4 text-blue-600"></i>Accounts</p>
            <div class="flex gap-2 mb-2">
              <input type="text" id="accName" placeholder="Account name" class="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <select id="accType" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="bank">Bank</option><option value="cash">Cash</option><option value="fixed-deposit">Fixed Deposit</option></select>
              <button onclick="saveFeeAccount()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Add</button>
            </div>
            <div id="feeAccountsList" class="flex flex-col gap-1"></div>
          </div>
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="arrow-left-right" class="h-4 w-4 text-blue-600"></i>Record Transaction</p>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-1">
              <select id="txAccount" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Account…</option></select>
              <select id="txDirection" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="credit">Credit (in)</option><option value="debit">Debit (out)</option></select>
              <input type="number" id="txAmount" placeholder="Amount" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="recordAccountTransaction()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Save</button>
            </div>
            <input type="text" id="txReference" placeholder="Reference (optional)" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs mb-3">
            <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:280px">
              <table class="w-full text-left border-collapse text-xs">
                <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Date</th><th class="py-2 px-3">Direction</th><th class="py-2 px-3">Amount</th><th class="py-2 px-3">Reference</th></tr></thead>
                <tbody id="accountRegisterBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadFeeTypes();
  }

  function switchFeesTab(tabId) {
    FEES_SUBTABS.forEach(t => {
      const panel = document.getElementById(t.id);
      const btn = document.getElementById('ftab-' + t.id);
      const active = t.id === tabId;
      if (panel) panel.style.display = active ? '' : 'none';
      if (btn) {
        btn.className = btn.className.replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g, '').trim();
        btn.className += active ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20' : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
    if (tabId === 'fees-structures') loadFeeStructures();
    if (tabId === 'fees-late') loadLateFeeRules();
    if (tabId === 'fees-reports') { loadDefaultersList(); loadFeesCollectionReport(); }
    if (tabId === 'fees-accounts') { loadFeeAccounts(); loadAccountRegister(); }
  }

  function _feeTypeOptions(selected) {
    return _feeTypes.map(f => `<option value="${f.id}" ${String(f.id) === String(selected) ? 'selected' : ''}>${f.name}</option>`).join('');
  }
  function _populateFeeTypeSelects() {
    ['fsFeeType', 'genCwFeeType', 'genIndFeeType'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<option value="">Fee Type…</option>' + _feeTypeOptions();
    });
    const discSel = document.getElementById('discFeeType');
    if (discSel) discSel.innerHTML = '<option value="">Any fee type…</option>' + _feeTypeOptions();
  }

  function loadFeeTypes() {
    _adminFetch('get_fee_types', {}).then(res => {
      _feeTypes = (res && res.result === 'success' && res.fee_types) || [];
      renderFeeTypesList();
      _populateFeeTypeSelects();
    });
  }
  function renderFeeTypesList() {
    const host = document.getElementById('feeTypesList');
    if (!host) return;
    host.innerHTML = _feeTypes.length ? _feeTypes.map(f => `
      <div class="flex justify-between items-center border border-slate-200 rounded-xl px-3 py-2">
        <div>
          <span class="font-black text-slate-800 text-xs">${f.name}</span>
          <span class="text-[10px] font-black text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 ml-2">${f.code}</span>
          ${!f.is_active ? '<span class="text-[10px] font-black text-white bg-slate-400 rounded px-1.5 py-0.5 ml-1">Inactive</span>' : ''}
          <span class="text-slate-400 text-xs ml-2">${f.description || ''}</span>
        </div>
        <div class="flex gap-1">
          <button onclick='openFeeTypeEditor(${JSON.stringify(f).replace(/'/g, "&apos;")})' class="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><i data-lucide="pencil" class="h-3.5 w-3.5"></i></button>
          <button onclick="deleteFeeType(${f.id})" class="w-7 h-7 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
        </div>
      </div>`).join('') : '<span class="text-xs text-slate-400 font-bold italic">No fee types yet — create one to get started.</span>';
    lucide.createIcons();
  }
  function openFeeTypeEditor(existing) {
    const overlay = document.createElement('div');
    overlay.id = 'feeTypeOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">${existing ? 'Edit' : 'New'} Fee Type</p>
          <button onclick="document.getElementById('feeTypeOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-4 flex flex-col gap-2">
          <input type="hidden" id="ftId" value="${existing ? existing.id : ''}">
          <label class="text-[10px] font-black text-slate-400 uppercase">Fee Type Name</label>
          <input type="text" id="ftName" value="${existing ? existing.name.replace(/"/g,'&quot;') : ''}" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Code</label>
          <input type="text" id="ftCode" value="${existing ? existing.code.replace(/"/g,'&quot;') : ''}" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Description (optional)</label>
          <input type="text" id="ftDesc" value="${existing ? (existing.description||'').replace(/"/g,'&quot;') : ''}" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="flex items-center gap-2 text-xs font-bold text-slate-600 mt-1"><input type="checkbox" id="ftActive" ${!existing || existing.is_active ? 'checked' : ''}>Active</label>
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick="saveFeeTypeFromEditor()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
  }
  function saveFeeTypeFromEditor() {
    const id = document.getElementById('ftId').value || null;
    const name = document.getElementById('ftName').value.trim();
    const code = document.getElementById('ftCode').value.trim().toUpperCase().replace(/\s+/g, '_');
    const description = document.getElementById('ftDesc').value.trim();
    const is_active = document.getElementById('ftActive').checked;
    if (!name || !code) { showToast('Name and code required', 'error'); return; }
    _adminFetch('save_fee_type', { id, name, code, description, is_active }).then(res => {
      const overlay = document.getElementById('feeTypeOverlay');
      if (overlay) overlay.remove();
      if (res && res.result === 'success') { showToast('Fee type saved'); loadFeeTypes(); }
      else showToast((res && res.message) || 'Save failed', 'error');
    });
  }
  function deleteFeeType(id) {
    if (!confirm('Delete this fee type? Any related fee structures/fees are also removed.')) return;
    _adminFetch('delete_fee_type', { id }).then(res => { if (res && res.result === 'success') loadFeeTypes(); });
  }

  function loadFeeStructures() {
    _adminFetch('get_fee_structures', {}).then(res => {
      const rows = (res && res.result === 'success' && res.fee_structures) || [];
      document.getElementById('feeStructuresBody').innerHTML = rows.map(r => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${r.fee_types ? r.fee_types.name : ''}</td><td class="py-1.5 px-3">${r.class}</td><td class="py-1.5 px-3">${r.section || '—'}</td><td class="py-1.5 px-3">${r.academic_year}</td>
        <td class="py-1.5 px-3">৳${Number(r.amount).toLocaleString()}</td><td class="py-1.5 px-3">${r.collection_mode}</td>
        <td class="py-1.5 px-3"><button onclick="deleteFeeStructure(${r.id})" class="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-3 w-3"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="p-3 text-slate-400 font-bold text-xs">No fee structures yet.</td></tr>';
      lucide.createIcons();
    });
  }
  function saveFeeStructure() {
    const fee_type_id = document.getElementById('fsFeeType').value;
    const cls = document.getElementById('fsClass').value.trim();
    const section = document.getElementById('fsSection').value.trim();
    const academic_year = document.getElementById('fsYear').value.trim();
    const amount = document.getElementById('fsAmount').value;
    const collection_mode = document.getElementById('fsCollectionMode').value;
    if (!fee_type_id || !cls || !academic_year || !amount) { showToast('Fill all required fields', 'error'); return; }
    _adminFetch('save_fee_structure', { fee_type_id, class: cls, section, academic_year, amount, collection_mode }).then(res => {
      if (res && res.result === 'success') {
        showToast('Fee structure saved');
        document.getElementById('fsClass').value = ''; document.getElementById('fsAmount').value = '';
        loadFeeStructures();
      } else showToast((res && res.message) || 'Save failed', 'error');
    });
  }
  function deleteFeeStructure(id) {
    _adminFetch('delete_fee_structure', { id }).then(res => { if (res && res.result === 'success') loadFeeStructures(); });
  }

  function generateClasswiseFees() {
    const payload = {
      fee_type_id: document.getElementById('genCwFeeType').value,
      class: document.getElementById('genCwClass').value.trim(),
      section: document.getElementById('genCwSection').value.trim(),
      academic_year: document.getElementById('genCwYear').value.trim(),
      fee_month: document.getElementById('genCwMonth').value.trim(),
    };
    const status = document.getElementById('genCwStatus');
    if (!payload.fee_type_id || !payload.class || !payload.academic_year || !payload.fee_month) { status.className = 'text-xs font-bold text-red-500'; status.textContent = 'Fill all required fields.'; return; }
    status.className = 'text-xs font-bold text-slate-400'; status.textContent = 'Generating…';
    _adminFetch('generate_classwise_fees', payload).then(res => {
      if (res && res.result === 'success') { status.className = 'text-xs font-bold text-emerald-600'; status.textContent = `Generated ${res.generated} fee(s), skipped ${res.skipped} already billed.`; }
      else { status.className = 'text-xs font-bold text-red-500'; status.textContent = (res && res.message) || 'Generation failed'; }
    });
  }
  function generateIndividualFee() {
    const payload = {
      student_id: document.getElementById('genIndStudent').value.trim(),
      fee_type_id: document.getElementById('genIndFeeType').value,
      academic_year: document.getElementById('genIndYear').value.trim(),
      fee_month: document.getElementById('genIndMonth').value.trim(),
    };
    const status = document.getElementById('genIndStatus');
    if (!payload.student_id || !payload.fee_type_id || !payload.academic_year || !payload.fee_month) { status.className = 'text-xs font-bold text-red-500'; status.textContent = 'Fill all required fields.'; return; }
    status.className = 'text-xs font-bold text-slate-400'; status.textContent = 'Generating…';
    _adminFetch('generate_individual_fee', payload).then(res => {
      if (res && res.result === 'success') { status.className = 'text-xs font-bold text-emerald-600'; status.textContent = 'Fee generated.'; }
      else { status.className = 'text-xs font-bold text-red-500'; status.textContent = (res && res.message) || 'Generation failed'; }
    });
  }

  function loadLateFeeRules() {
    _adminFetch('get_late_fee_rules', {}).then(res => {
      const rules = (res && res.result === 'success' && res.rules) || [];
      const host = document.getElementById('lateFeeRulesList');
      host.innerHTML = rules.length ? rules.map(r => `
        <div class="flex justify-between items-center border border-slate-200 rounded-xl px-3 py-2">
          <div><span class="font-black text-slate-800 text-xs">${r.rule_name}</span> <span class="text-slate-400 text-xs ml-2">৳${Number(r.amount).toLocaleString()} after day ${r.due_day_of_month} of the month${!r.is_active ? ' · Inactive' : ''}</span></div>
          <button onclick="deleteLateFeeRule(${r.id})" class="w-7 h-7 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
        </div>`).join('') : '<span class="text-xs text-slate-400 font-bold italic">No late fee rules yet.</span>';
      lucide.createIcons();
    });
  }
  function openLateFeeEditor() {
    const overlay = document.createElement('div');
    overlay.id = 'lateFeeOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">New Late Fee Rule</p>
          <button onclick="document.getElementById('lateFeeOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-4 flex flex-col gap-2">
          <div class="bg-amber-50 text-amber-700 text-xs font-bold rounded-lg p-2.5 mb-1">Late fee applies immediately after the deadline is missed (no grace period). Fee is a fixed one-time amount (not per-day, not tiered).</div>
          <label class="text-[10px] font-black text-slate-400 uppercase">Rule Name</label>
          <input type="text" id="lfName" placeholder="e.g. Standard Late Fee" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Late Fee Amount (৳)</label>
          <input type="number" id="lfAmount" placeholder="e.g. 100" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Due Day of Month</label>
          <input type="number" id="lfDay" min="1" max="31" value="15" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Conditions (optional)</label>
          <textarea id="lfConditions" placeholder="e.g. Exemptions for scholarship students" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"></textarea>
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick="saveLateFeeRuleFromEditor()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Create Rule</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
  }
  function saveLateFeeRuleFromEditor() {
    const rule_name = document.getElementById('lfName').value.trim();
    const amount = document.getElementById('lfAmount').value;
    const due_day_of_month = document.getElementById('lfDay').value;
    const conditions = document.getElementById('lfConditions').value.trim();
    if (!rule_name || !amount) { showToast('Rule name and amount required', 'error'); return; }
    _adminFetch('save_late_fee_rule', { rule_name, amount, due_day_of_month, conditions, is_active: true }).then(res => {
      const overlay = document.getElementById('lateFeeOverlay');
      if (overlay) overlay.remove();
      if (res && res.result === 'success') { showToast('Rule created'); loadLateFeeRules(); }
      else showToast((res && res.message) || 'Save failed', 'error');
    });
  }
  function deleteLateFeeRule(id) {
    _adminFetch('delete_late_fee_rule', { id }).then(res => { if (res && res.result === 'success') loadLateFeeRules(); });
  }

  function loadStudentFees() {
    const student_id = document.getElementById('stufeeSearchId').value.trim();
    if (!student_id) return;
    _curStudentFeeStudentId = student_id;
    _adminFetch('get_student_fees', { student_id }).then(res => {
      const body = document.getElementById('studentFeesBody');
      const fees = (res && res.result === 'success' && res.fees) || [];
      if (!fees.length) { body.innerHTML = '<tr><td colspan="8" class="p-3 text-slate-400 font-bold text-xs">No fees found for this student.</td></tr>'; return; }
      body.innerHTML = fees.map(f => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${f.fee_types ? f.fee_types.name : ''}</td><td class="py-1.5 px-3">${f.academic_year}</td><td class="py-1.5 px-3">${f.fee_month}</td>
        <td class="py-1.5 px-3">৳${Number(f.amount).toLocaleString()}</td><td class="py-1.5 px-3">৳${Number(f.active_amount).toLocaleString()}</td><td class="py-1.5 px-3">৳${Number(f.deferred_amount).toLocaleString()}</td>
        <td class="py-1.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${f.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${f.status}</span></td>
        <td class="py-1.5 px-3">${f.status !== 'paid' ? `<button onclick="promptRecordPayment(${f.id}, ${f.active_amount})" class="w-6 h-6 flex items-center justify-center rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50"><i data-lucide="banknote" class="h-3 w-3"></i></button>` : ''}</td>
      </tr>`).join('');
      lucide.createIcons();
    });
  }
  function promptRecordPayment(student_fee_id, activeAmount) {
    const amount = prompt(`Amount to record as paid (active due: ৳${activeAmount}):`, activeAmount);
    if (!amount) return;
    _adminFetch('record_payment', { student_fee_id, amount, method: 'Manual' }).then(res => {
      if (res && res.result === 'success') { showToast('Payment recorded'); loadStudentFees(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }
  function saveFeeDiscount() {
    if (!_curStudentFeeStudentId) { showToast('Search a student first', 'error'); return; }
    const fee_type_id = document.getElementById('discFeeType').value || null;
    const discount_type = document.getElementById('discType').value;
    const value = document.getElementById('discValue').value;
    const reason = document.getElementById('discReason').value.trim();
    if (!value) { showToast('Enter a value', 'error'); return; }
    _adminFetch('set_discount', { student_id: _curStudentFeeStudentId, fee_type_id, discount_type, value, reason }).then(res => {
      if (res && res.result === 'success') { showToast('Discount added'); document.getElementById('discValue').value = ''; document.getElementById('discReason').value = ''; }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }

  function loadDefaultersList() {
    const cls = document.getElementById('defClassFilter').value.trim();
    _adminFetch('get_defaulters_list', { class: cls }).then(res => {
      const rows = (res && res.result === 'success' && res.defaulters) || [];
      document.getElementById('defaultersBody').innerHTML = rows.length ? rows.map(r => `<tr class="border-b border-slate-50"><td class="py-1.5 px-3">${r.student_id}</td><td class="py-1.5 px-3">${r.fee_types ? r.fee_types.name : ''}</td><td class="py-1.5 px-3">${r.fee_month}</td><td class="py-1.5 px-3">৳${Number(r.active_amount).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="4" class="p-3 text-slate-400 font-bold text-xs">No defaulters found.</td></tr>';
    });
  }
  function loadFeesCollectionReport() {
    _adminFetch('get_fees_collection_report', {}).then(res => {
      if (!res || res.result !== 'success') return;
      document.getElementById('feesCollectionSummary').innerHTML = `<div class="font-black text-slate-800 text-sm">Total Collected: ৳${Number(res.total).toLocaleString()}</div>` +
        Object.entries(res.by_fee_type || {}).map(([name, amt]) => `<div class="text-xs text-slate-400 font-bold">${name}: ৳${Number(amt).toLocaleString()}</div>`).join('');
      document.getElementById('feesCollectionBody').innerHTML = (res.transactions || []).slice(0, 50).map(t => `<tr class="border-b border-slate-50"><td class="py-1.5 px-3">${new Date(t.paid_at).toLocaleDateString()}</td><td class="py-1.5 px-3">৳${Number(t.amount).toLocaleString()}</td></tr>`).join('');
    });
  }

  function loadFeeAccounts() {
    _adminFetch('get_fee_accounts', {}).then(res => {
      const accounts = (res && res.result === 'success' && res.accounts) || [];
      const host = document.getElementById('feeAccountsList');
      if (host) host.innerHTML = accounts.map(a => `<div class="flex justify-between border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"><span>${a.name} <span class="text-[10px] font-black text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">${a.type}</span></span><span class="font-black text-slate-700">৳${Number(a.opening_balance).toLocaleString()}</span></div>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No accounts yet.</span>';
      const sel = document.getElementById('txAccount');
      if (sel) sel.innerHTML = '<option value="">Account…</option>' + accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    });
  }
  function saveFeeAccount() {
    const name = document.getElementById('accName').value.trim();
    const type = document.getElementById('accType').value;
    if (!name) return;
    _adminFetch('save_fee_account', { name, type }).then(res => {
      if (res && res.result === 'success') { document.getElementById('accName').value = ''; loadFeeAccounts(); }
    });
  }
  function recordAccountTransaction() {
    const account_id = document.getElementById('txAccount').value;
    const direction = document.getElementById('txDirection').value;
    const amount = document.getElementById('txAmount').value;
    const reference = document.getElementById('txReference').value.trim();
    if (!account_id || !amount) { showToast('Pick an account and amount', 'error'); return; }
    _adminFetch('record_account_transaction', { account_id, direction, amount, reference }).then(res => {
      if (res && res.result === 'success') { document.getElementById('txAmount').value = ''; document.getElementById('txReference').value = ''; loadAccountRegister(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }
  function loadAccountRegister() {
    _adminFetch('get_account_register', {}).then(res => {
      const rows = (res && res.result === 'success' && res.transactions) || [];
      document.getElementById('accountRegisterBody').innerHTML = rows.map(t => `<tr class="border-b border-slate-50"><td class="py-1.5 px-3">${new Date(t.occurred_at).toLocaleDateString()}</td><td class="py-1.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${t.direction === 'credit' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">${t.direction}</span></td><td class="py-1.5 px-3">৳${Number(t.amount).toLocaleString()}</td><td class="py-1.5 px-3">${t.reference || ''}</td></tr>`).join('') || '<tr><td colspan="4" class="p-3 text-slate-400 font-bold text-xs">No transactions yet.</td></tr>';
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Attendance tab — native port (Phase 3, part 1). Same idiom as Fees.
  // ══════════════════════════════════════════════════════════════════════

  const ATTENDANCE_SUBTABS = [
    { id: 'att-daily', label: 'Daily Report' },
    { id: 'att-devices', label: 'Devices' },
    { id: 'att-punchlog', label: 'Punch Log' },
  ];

  function loadAdminAttendanceView() {
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-attendance');
    setContentHeader('Attendance', 'fingerprint');
    const container = document.getElementById('view-container');
    if (!container) return;
    const tabBar = ATTENDANCE_SUBTABS.map((t, i) => `<button onclick="switchAttendanceTab('${t.id}')" id="attab-${t.id}"
      class="fees-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
             ${i === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}">${t.label}</button>`).join('');

    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Attendance</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Daily report, devices, punch log</p>
      </div>
      <div class="flex flex-wrap gap-2 mb-5">${tabBar}</div>

      <div id="att-daily">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <input type="text" id="attClass" placeholder="Class" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
          <input type="text" id="attSection" placeholder="Section (optional)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
          <input type="date" id="attDate" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
          <button onclick="loadAttendanceReport()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Load</button>
        </div>
        <div id="attSummary" class="mb-2 font-black text-slate-700 text-xs"></div>
        <div class="overflow-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Roll</th><th class="py-2 px-3">Name</th><th class="py-2 px-3">Status</th><th class="py-2 px-3">Source</th><th class="py-2 px-3">Override</th></tr></thead>
            <tbody id="attendanceReportBody"><tr><td colspan="5" class="p-3 text-slate-400 font-bold">Pick a class and date, then Load.</td></tr></tbody>
          </table>
        </div>
      </div>

      <div id="att-devices" style="display:none">
        <div class="flex items-center justify-between mb-3">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="hard-drive" class="h-4 w-4 text-blue-600"></i>Attendance Devices</p>
          <button onclick="openAttendanceDeviceEditor()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">+ Add Device</button>
        </div>
        <p class="text-xs text-slate-400 font-bold mb-3">ESP32 is the primary attendance channel. ZKTeco or other biometric terminals are optional additional devices, not a replacement.</p>
        <div id="attendanceDevicesList" class="flex flex-col gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading…</span></div>
      </div>

      <div id="att-punchlog" style="display:none">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <select id="plPersonType" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs"><option value="">All person types</option><option value="student">Student</option><option value="staff">Staff</option><option value="unmatched">Unmatched</option></select>
          <button onclick="loadPunchLog()" class="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Refresh</button>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:420px">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Time</th><th class="py-2 px-3">Device User</th><th class="py-2 px-3">Type</th><th class="py-2 px-3">Person</th><th class="py-2 px-3">Verify</th><th class="py-2 px-3">Matched</th></tr></thead>
            <tbody id="punchLogBody"></tbody>
          </table>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadAttendanceReport();
  }

  function switchAttendanceTab(tabId) {
    ATTENDANCE_SUBTABS.forEach(t => {
      const panel = document.getElementById(t.id);
      const btn = document.getElementById('attab-' + t.id);
      const active = t.id === tabId;
      if (panel) panel.style.display = active ? '' : 'none';
      if (btn) {
        btn.className = btn.className.replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g, '').trim();
        btn.className += active ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20' : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
    if (tabId === 'att-devices') loadAttendanceDevices();
    if (tabId === 'att-punchlog') loadPunchLog();
  }

  function loadAttendanceReport() {
    const clsEl = document.getElementById('attClass');
    if (!clsEl) return;
    const payload = {
      class: clsEl.value.trim(),
      section: document.getElementById('attSection').value.trim(),
      date: document.getElementById('attDate').value,
    };
    if (!payload.class || !payload.date) { showToast('Class and date required', 'error'); return; }
    _adminFetch('get_attendance_report', payload).then(res => {
      if (!res || res.result !== 'success') { showToast((res && res.message) || 'Failed', 'error'); return; }
      document.getElementById('attSummary').innerHTML = `<span class="text-emerald-600">${res.present_count} present</span> · <span class="text-red-500">${res.absent_count} absent</span> of ${res.rows.length}`;
      document.getElementById('attendanceReportBody').innerHTML = res.rows.map(r => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${r.roll || ''}</td><td class="py-1.5 px-3">${r.student_name || ''}</td>
        <td class="py-1.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${r.status === 'present' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">${r.status}</span></td>
        <td class="py-1.5 px-3 text-slate-400">${r.source}</td>
        <td class="py-1.5 px-3">
          <button onclick="markManualAttendance('${r.student_id}','present')" class="px-2 py-0.5 border border-emerald-200 text-emerald-600 rounded text-[10px] font-black uppercase hover:bg-emerald-50">Present</button>
          <button onclick="markManualAttendance('${r.student_id}','absent')" class="px-2 py-0.5 border border-red-200 text-red-500 rounded text-[10px] font-black uppercase hover:bg-red-50">Absent</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="p-3 text-slate-400 font-bold text-xs">No students found.</td></tr>';
    });
  }
  function markManualAttendance(student_id, status) {
    const date = document.getElementById('attDate').value;
    _adminFetch('save_manual_attendance', { student_id, date, status, marked_by: window.APP_USER && window.APP_USER.user_id }).then(res => {
      if (res && res.result === 'success') { showToast('Updated'); loadAttendanceReport(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }

  function loadAttendanceDevices() {
    _adminFetch('get_attendance_devices', {}).then(res => {
      const devices = (res && res.result === 'success' && res.devices) || [];
      const host = document.getElementById('attendanceDevicesList');
      if (!host) return;
      host.innerHTML = devices.length ? devices.map(d => `
        <div class="flex justify-between items-center border border-slate-200 rounded-xl px-3 py-2">
          <div><span class="font-black text-slate-800 text-xs">${d.name}</span> <span class="text-[10px] font-black text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 ml-1">${d.device_type}</span> <span class="text-slate-400 text-xs ml-2">${d.ip}:${d.port || ''}</span>${!d.is_active ? ' <span class="text-[10px] font-black text-white bg-slate-400 rounded px-1.5 py-0.5">Inactive</span>' : ''}</div>
          <button onclick="deleteAttendanceDevice(${d.id})" class="w-7 h-7 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
        </div>`).join('') : '<span class="text-xs text-slate-400 font-bold italic">No devices registered yet.</span>';
      lucide.createIcons();
    });
  }
  function openAttendanceDeviceEditor() {
    const overlay = document.createElement('div');
    overlay.id = 'attDeviceOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Add Attendance Device</p>
          <button onclick="document.getElementById('attDeviceOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-4 flex flex-col gap-2">
          <label class="text-[10px] font-black text-slate-400 uppercase">Device Name</label>
          <input type="text" id="adName" placeholder="e.g. Main Gate" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Device Type</label>
          <select id="adType" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"><option value="esp32">ESP32 (primary)</option><option value="zkteco">ZKTeco (optional)</option></select>
          <label class="text-[10px] font-black text-slate-400 uppercase">IP Address</label>
          <input type="text" id="adIp" placeholder="192.168.1.201" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">Port</label>
          <input type="number" id="adPort" value="4370" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">API Username (optional)</label>
          <input type="text" id="adUser" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
          <label class="text-[10px] font-black text-slate-400 uppercase">API Password (optional)</label>
          <input type="password" id="adPass" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick="saveAttendanceDeviceFromEditor()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Add Device</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
  }
  function saveAttendanceDeviceFromEditor() {
    const name = document.getElementById('adName').value.trim();
    const device_type = document.getElementById('adType').value;
    const ip = document.getElementById('adIp').value.trim();
    const port = document.getElementById('adPort').value;
    const api_username = document.getElementById('adUser').value.trim();
    const api_password = document.getElementById('adPass').value;
    if (!name || !ip) { showToast('Name and IP required', 'error'); return; }
    _adminFetch('save_attendance_device', { name, device_type, ip, port, api_username, api_password, is_active: true }).then(res => {
      const overlay = document.getElementById('attDeviceOverlay');
      if (overlay) overlay.remove();
      if (res && res.result === 'success') { showToast('Device added'); loadAttendanceDevices(); }
      else showToast((res && res.message) || 'Save failed', 'error');
    });
  }
  function deleteAttendanceDevice(id) {
    _adminFetch('delete_attendance_device', { id }).then(res => { if (res && res.result === 'success') loadAttendanceDevices(); });
  }

  function loadPunchLog() {
    const person_type = document.getElementById('plPersonType').value;
    _adminFetch('get_punch_log', { person_type }).then(res => {
      const rows = (res && res.result === 'success' && res.punches) || [];
      document.getElementById('punchLogBody').innerHTML = rows.map(p => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${new Date(p.punch_time).toLocaleString()}</td><td class="py-1.5 px-3">${p.device_user_id || ''}</td><td class="py-1.5 px-3">${p.person_type}</td><td class="py-1.5 px-3">${p.person_id || '—'}</td><td class="py-1.5 px-3">${p.verify_method || ''}</td>
        <td class="py-1.5 px-3">${p.matched ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">Yes</span>' : '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">Unmatched</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="p-3 text-slate-400 font-bold text-xs">No punch logs found.</td></tr>';
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Exams tab — native port (Phase 3, part 2). Same idiom as Fees.
  // ══════════════════════════════════════════════════════════════════════

  const EXAMS_SUBTABS = [
    { id: 'exam-setup', label: 'Exam Setup' },
    { id: 'exam-marks', label: 'Marks Entry' },
    { id: 'exam-process', label: 'Result Process' },
    { id: 'exam-grades', label: 'Grade Setup' },
    { id: 'exam-board', label: 'Board Exam Records' },
  ];
  let _exams = [];
  let _curExamId = null;
  let _meSubjects = [];

  function loadAdminExamsView() {
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-exams');
    setContentHeader('Exams', 'clipboard-list');
    const container = document.getElementById('view-container');
    if (!container) return;
    const tabBar = EXAMS_SUBTABS.map((t, i) => `<button onclick="switchExamsTab('${t.id}')" id="extab-${t.id}"
      class="fees-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
             ${i === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}">${t.label}</button>`).join('');

    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Exams</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Exam setup, marks entry, result processing, grade scale, board records</p>
      </div>
      <div class="flex flex-wrap gap-2 mb-5">${tabBar}</div>

      <div id="exam-setup">
        <div class="grid md:grid-cols-2 gap-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <p class="font-black text-slate-800 text-xs mb-3 flex items-center gap-2"><i data-lucide="file-plus" class="h-4 w-4 text-blue-600"></i>New Exam</p>
            <div class="flex flex-col gap-2">
              <input type="text" id="exName" placeholder="Exam name (e.g. Half Yearly Exam)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <select id="exType" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option>Term</option><option>Half-Yearly</option><option>Final</option><option>Continuous-Test</option></select>
              <input type="text" id="exYear" placeholder="Academic Year" value="2026" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="exMedium" placeholder="Medium (optional)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="exClass" placeholder="Class" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="saveExam()" class="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Create Exam</button>
            </div>
          </div>
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="list" class="h-4 w-4 text-blue-600"></i>Exams</p>
            <div id="examsList" class="flex flex-col gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading…</span></div>
            <div id="examSubjectsPanel" class="mt-4"></div>
          </div>
        </div>
      </div>

      <div id="exam-marks" style="display:none">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <select id="meExam" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Select exam…</option></select>
          <select id="meSubject" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Subject…</option></select>
          <input type="text" id="meClass" placeholder="Class" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="text" id="meSection" placeholder="Section" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <button onclick="loadMarksEntry()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Load Students</button>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:420px">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Roll</th><th class="py-2 px-3">Name</th><th class="py-2 px-3">Marks</th></tr></thead>
            <tbody id="marksEntryBody"><tr><td colspan="3" class="p-3 text-slate-400 font-bold">Pick an exam, subject, and class.</td></tr></tbody>
          </table>
        </div>
        <button onclick="saveMarksEntry()" class="mt-3 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save All Marks</button>
        <span id="marksEntryStatus" class="text-xs font-bold ml-2"></span>
      </div>

      <div id="exam-process" style="display:none">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <select id="prExam" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option value="">Select exam…</option></select>
          <button onclick="processExamResult()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Process Result</button>
          <button onclick="toggleExamLock(true)" class="px-3 py-2 border border-red-200 text-red-500 rounded-lg font-black text-[10px] uppercase hover:bg-red-50">Lock</button>
          <button onclick="toggleExamLock(false)" class="px-3 py-2 border border-slate-200 text-slate-600 rounded-lg font-black text-[10px] uppercase hover:bg-slate-50">Unlock</button>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Position</th><th class="py-2 px-3">Student</th><th class="py-2 px-3">Total</th><th class="py-2 px-3">%</th><th class="py-2 px-3">GPA</th><th class="py-2 px-3">Grade</th><th class="py-2 px-3">Pass/Fail</th></tr></thead>
            <tbody id="examResultsBody"><tr><td colspan="7" class="p-3 text-slate-400 font-bold">Select an exam and process.</td></tr></tbody>
          </table>
        </div>
      </div>

      <div id="exam-grades" style="display:none">
        <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-3"><i data-lucide="star" class="h-4 w-4 text-blue-600"></i>Grade Point List</p>
        <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          <input type="number" id="gsGp" placeholder="GP" step="0.1" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="number" id="gsMin" placeholder="Min %" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="number" id="gsMax" placeholder="Max %" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="text" id="gsLetter" placeholder="Letter (A+)" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="text" id="gsLabel" placeholder="Label (Excellent)" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <button onclick="saveGradeScale()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">+</button>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">GP</th><th class="py-2 px-3">Marks</th><th class="py-2 px-3">Grade</th><th class="py-2 px-3">Label</th><th class="py-2 px-3"></th></tr></thead>
            <tbody id="gradeScalesBody"></tbody>
          </table>
        </div>
      </div>

      <div id="exam-board" style="display:none">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <input type="text" id="beStudent" placeholder="Student ID" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <select id="beType" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs"><option>JSC</option><option>SSC</option><option>HSC</option></select>
          <input type="text" id="beReg" placeholder="Registration #" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="text" id="beRoll" placeholder="Board Roll #" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <button onclick="saveBoardExamRecord()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Save</button>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl" style="max-height:380px">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Student</th><th class="py-2 px-3">Type</th><th class="py-2 px-3">Registration #</th><th class="py-2 px-3">Roll #</th></tr></thead>
            <tbody id="boardExamBody"></tbody>
          </table>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadExams();
  }

  function switchExamsTab(tabId) {
    EXAMS_SUBTABS.forEach(t => {
      const panel = document.getElementById(t.id);
      const btn = document.getElementById('extab-' + t.id);
      const active = t.id === tabId;
      if (panel) panel.style.display = active ? '' : 'none';
      if (btn) {
        btn.className = btn.className.replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g, '').trim();
        btn.className += active ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20' : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
    if (tabId === 'exam-grades') loadGradeScales();
    if (tabId === 'exam-board') loadBoardExamRecords();
  }

  function _examOptions() { return _exams.map(e => `<option value="${e.id}">${e.name} (${e.academic_year})${e.is_locked ? ' 🔒' : ''}</option>`).join(''); }

  function loadExams() {
    _adminFetch('get_exams', {}).then(res => {
      _exams = (res && res.result === 'success' && res.exams) || [];
      const host = document.getElementById('examsList');
      if (host) host.innerHTML = _exams.map(e => `
        <div class="flex justify-between items-center border rounded-xl px-3 py-2 cursor-pointer ${e.id == _curExamId ? 'border-blue-400' : 'border-slate-200'}" onclick="selectExamForSubjects(${e.id})">
          <div><span class="font-black text-slate-800 text-xs">${e.name}</span> <span class="text-[10px] font-black text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 ml-1">${e.exam_type}</span> <span class="text-slate-400 text-xs ml-2">${e.academic_year}${e.class ? ' · '+e.class : ''}</span>${e.is_locked ? ' <span class="text-[10px] font-black text-white bg-red-500 rounded px-1.5 py-0.5">Locked</span>' : ''}</div>
        </div>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No exams yet.</span>';
      ['meExam', 'prExam'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = '<option value="">Select exam…</option>' + _examOptions(); });
    });
  }
  function saveExam() {
    const name = document.getElementById('exName').value.trim();
    const exam_type = document.getElementById('exType').value;
    const academic_year = document.getElementById('exYear').value.trim();
    const medium = document.getElementById('exMedium').value.trim();
    const cls = document.getElementById('exClass').value.trim();
    if (!name || !academic_year) { showToast('Name and year required', 'error'); return; }
    _adminFetch('save_exam', { name, exam_type, academic_year, medium, class: cls }).then(res => {
      if (res && res.result === 'success') { showToast('Exam created'); document.getElementById('exName').value = ''; loadExams(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }
  function selectExamForSubjects(exam_id) {
    _curExamId = exam_id;
    loadExams();
    _adminFetch('get_exam_subjects', { exam_id }).then(res => {
      const subjects = (res && res.result === 'success' && res.subjects) || [];
      const host = document.getElementById('examSubjectsPanel');
      host.innerHTML = `
        <p class="font-black text-slate-800 text-xs mb-2">Subjects</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <input type="text" id="esSubject" placeholder="Subject name" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="number" id="esFull" placeholder="Full marks" value="100" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="number" id="esPass" placeholder="Pass marks" value="33" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <button onclick="saveExamSubject(${exam_id})" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">+</button>
        </div>
        <div class="flex flex-wrap gap-2">${subjects.map(s => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[11px] font-bold border border-slate-200">${s.subject} (${s.full_marks}/${s.pass_marks}) <i data-lucide="x-circle" class="h-3 w-3 text-red-500 cursor-pointer" onclick="deleteExamSubject(${s.id}, ${exam_id})"></i></span>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No subjects yet.</span>'}</div>`;
      lucide.createIcons();
      _populateMarksSubjectSelect(subjects);
    });
  }
  function saveExamSubject(exam_id) {
    const subject = document.getElementById('esSubject').value.trim();
    const full_marks = document.getElementById('esFull').value;
    const pass_marks = document.getElementById('esPass').value;
    if (!subject) return;
    _adminFetch('save_exam_subject', { exam_id, subject, full_marks, pass_marks }).then(res => { if (res && res.result === 'success') selectExamForSubjects(exam_id); });
  }
  function deleteExamSubject(id, exam_id) {
    _adminFetch('delete_exam_subject', { id }).then(res => { if (res && res.result === 'success') selectExamForSubjects(exam_id); });
  }
  function _populateMarksSubjectSelect(subjects) {
    _meSubjects = subjects;
    const el = document.getElementById('meSubject');
    if (el) el.innerHTML = '<option value="">Subject…</option>' + subjects.map(s => `<option value="${s.id}">${s.subject}</option>`).join('');
  }

  function loadMarksEntry() {
    const exam_subject_id = document.getElementById('meSubject').value;
    const cls = document.getElementById('meClass').value.trim();
    const section = document.getElementById('meSection').value.trim();
    if (!exam_subject_id || !cls) { showToast('Pick a subject and class', 'error'); return; }
    _adminFetch('get_exam_marks_for_entry', { exam_subject_id, class: cls, section }).then(res => {
      const roster = (res && res.result === 'success' && res.roster) || [];
      document.getElementById('marksEntryBody').innerHTML = roster.map(s => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${s.roll}</td><td class="py-1.5 px-3">${s.student_name}</td>
        <td class="py-1.5 px-3"><input type="number" class="marks-entry-input px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" style="max-width:100px" data-student="${s.student_id}" value="${s.marks_obtained}"></td>
      </tr>`).join('') || '<tr><td colspan="3" class="p-3 text-slate-400 font-bold text-xs">No students found.</td></tr>';
    });
  }
  function saveMarksEntry() {
    const exam_subject_id = document.getElementById('meSubject').value;
    const marks = Array.from(document.querySelectorAll('.marks-entry-input')).map(inp => ({ student_id: inp.dataset.student, marks_obtained: inp.value }));
    const status = document.getElementById('marksEntryStatus');
    _adminFetch('save_exam_marks_bulk', { exam_subject_id, marks }).then(res => {
      if (res && (res.result === 'success' || res.result === 'partial')) { status.className = 'text-xs font-bold text-emerald-600 ml-2'; status.textContent = `Saved ${res.saved} of ${marks.length}.`; }
      else { status.className = 'text-xs font-bold text-red-500 ml-2'; status.textContent = (res && res.message) || 'Failed'; }
    });
  }

  function processExamResult() {
    const exam_id = document.getElementById('prExam').value;
    if (!exam_id) return;
    _adminFetch('process_exam_result', { exam_id }).then(res => {
      if (!res || res.result !== 'success') { showToast((res && res.message) || 'Failed', 'error'); return; }
      document.getElementById('examResultsBody').innerHTML = res.results.map(r => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${r.position}</td><td class="py-1.5 px-3">${r.student_id}</td><td class="py-1.5 px-3">${r.total}</td><td class="py-1.5 px-3">${r.percentage}%</td><td class="py-1.5 px-3">${r.gpa}</td><td class="py-1.5 px-3">${r.letter_grade}</td>
        <td class="py-1.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${r.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">${r.pass ? 'Pass' : 'Fail'}</span></td>
      </tr>`).join('') || '<tr><td colspan="7" class="p-3 text-slate-400 font-bold text-xs">No marks entered yet.</td></tr>';
    });
  }
  function toggleExamLock(locked) {
    const exam_id = document.getElementById('prExam').value;
    if (!exam_id) return;
    _adminFetch('lock_exam', { exam_id, locked }).then(res => { if (res && res.result === 'success') { showToast(locked ? 'Exam locked' : 'Exam unlocked'); loadExams(); } });
  }

  function loadGradeScales() {
    _adminFetch('get_grade_scales', {}).then(res => {
      const scales = (res && res.result === 'success' && res.scales) || [];
      document.getElementById('gradeScalesBody').innerHTML = scales.map(s => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${s.gp}</td><td class="py-1.5 px-3">${s.min_mark}-${s.max_mark}</td><td class="py-1.5 px-3">${s.letter_grade}</td><td class="py-1.5 px-3">${s.label || ''}</td>
        <td class="py-1.5 px-3"><button onclick="deleteGradeScale(${s.id})" class="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-500 hover:bg-red-50"><i data-lucide="trash-2" class="h-3 w-3"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="p-3 text-slate-400 font-bold text-xs">No grade scales yet.</td></tr>';
      lucide.createIcons();
    });
  }
  function saveGradeScale() {
    const gp = document.getElementById('gsGp').value;
    const min_mark = document.getElementById('gsMin').value;
    const max_mark = document.getElementById('gsMax').value;
    const letter_grade = document.getElementById('gsLetter').value.trim();
    const label = document.getElementById('gsLabel').value.trim();
    if (!gp || !letter_grade || min_mark === '' || max_mark === '') { showToast('Fill all fields', 'error'); return; }
    _adminFetch('save_grade_scale', { category: 'default', gp, min_mark, max_mark, letter_grade, label }).then(res => {
      if (res && res.result === 'success') {
        ['gsGp','gsMin','gsMax','gsLetter','gsLabel'].forEach(id => { document.getElementById(id).value = ''; });
        loadGradeScales();
      } else showToast((res && res.message) || 'Failed', 'error');
    });
  }
  function deleteGradeScale(id) {
    _adminFetch('delete_grade_scale', { id }).then(res => { if (res && res.result === 'success') loadGradeScales(); });
  }

  function saveBoardExamRecord() {
    const student_id = document.getElementById('beStudent').value.trim();
    const board_exam_type = document.getElementById('beType').value;
    const registration_number = document.getElementById('beReg').value.trim();
    const roll_number = document.getElementById('beRoll').value.trim();
    if (!student_id) { showToast('Student ID required', 'error'); return; }
    _adminFetch('save_board_exam_record', { student_id, board_exam_type, registration_number, roll_number, academic_year: '2026' }).then(res => {
      if (res && res.result === 'success') { showToast('Saved'); loadBoardExamRecords(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }
  function loadBoardExamRecords() {
    _adminFetch('get_board_exam_records', {}).then(res => {
      const records = (res && res.result === 'success' && res.records) || [];
      document.getElementById('boardExamBody').innerHTML = records.map(r => `<tr class="border-b border-slate-50"><td class="py-1.5 px-3">${r.student_id}</td><td class="py-1.5 px-3">${r.board_exam_type}</td><td class="py-1.5 px-3">${r.registration_number || ''}</td><td class="py-1.5 px-3">${r.roll_number || ''}</td></tr>`).join('') || '<tr><td colspan="4" class="p-3 text-slate-400 font-bold text-xs">No records yet.</td></tr>';
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Payroll tab — native port (Phase 4, part 1). Same idiom as Fees.
  // ══════════════════════════════════════════════════════════════════════

  const PAYROLL_SUBTABS = [
    { id: 'pr-salary', label: 'Salary Setup' },
    { id: 'pr-run', label: 'Run Payroll' },
    { id: 'pr-leave', label: 'Leave Requests' },
  ];

  function loadAdminPayrollView() {
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-payroll');
    setContentHeader('Payroll', 'banknote');
    const container = document.getElementById('view-container');
    if (!container) return;
    const tabBar = PAYROLL_SUBTABS.map((t, i) => `<button onclick="switchPayrollTab('${t.id}')" id="prtab-${t.id}"
      class="fees-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
             ${i === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}">${t.label}</button>`).join('');

    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Payroll</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Salary structures, payroll runs, leave requests</p>
      </div>
      <div class="flex flex-wrap gap-2 mb-5">${tabBar}</div>

      <div id="pr-salary">
        <div class="bg-white rounded-2xl border border-slate-200 p-4 mb-3">
          <p class="font-black text-slate-800 text-xs mb-3">New / Update Salary Structure</p>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input type="text" id="ssDesignation" placeholder="Designation / Role (e.g. Teacher)" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="number" id="ssBasic" placeholder="Basic Salary" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="number" id="ssAllowance" placeholder="Total Allowances" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <input type="number" id="ssDeduction" placeholder="Total Deductions" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
            <button onclick="saveSalaryStructure()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Save</button>
          </div>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Designation</th><th class="py-2 px-3">Basic</th><th class="py-2 px-3">Allowances</th><th class="py-2 px-3">Deductions</th></tr></thead>
            <tbody id="salaryStructuresBody"></tbody>
          </table>
        </div>
      </div>

      <div id="pr-run" style="display:none">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <input type="text" id="prMonth" placeholder="Month (e.g. January)" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
          <input type="text" id="prYear" placeholder="Year" value="2026" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
          <button onclick="runPayroll()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Run Payroll</button>
        </div>
        <span id="payrollRunStatus" class="text-xs font-bold"></span>
        <div class="overflow-auto border border-slate-200 rounded-xl mt-3">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Teacher</th><th class="py-2 px-3">Gross</th><th class="py-2 px-3">Deductions</th><th class="py-2 px-3">Net</th></tr></thead>
            <tbody id="payslipsBody"></tbody>
          </table>
        </div>
      </div>

      <div id="pr-leave" style="display:none">
        <div class="overflow-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50"><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2 px-3">Teacher</th><th class="py-2 px-3">Type</th><th class="py-2 px-3">Dates</th><th class="py-2 px-3">Reason</th><th class="py-2 px-3">Status</th><th class="py-2 px-3">Actions</th></tr></thead>
            <tbody id="leaveRequestsBody"></tbody>
          </table>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadSalaryStructures();
  }

  function switchPayrollTab(tabId) {
    PAYROLL_SUBTABS.forEach(t => {
      const panel = document.getElementById(t.id);
      const btn = document.getElementById('prtab-' + t.id);
      const active = t.id === tabId;
      if (panel) panel.style.display = active ? '' : 'none';
      if (btn) {
        btn.className = btn.className.replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g, '').trim();
        btn.className += active ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20' : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
    if (tabId === 'pr-leave') loadLeaveRequests();
  }

  function loadSalaryStructures() {
    _adminFetch('get_salary_structures', {}).then(res => {
      const rows = (res && res.result === 'success' && res.structures) || [];
      document.getElementById('salaryStructuresBody').innerHTML = rows.map(s => {
        const allow = Object.values(s.allowances || {}).reduce((a, v) => a + Number(v || 0), 0);
        const ded = Object.values(s.deductions || {}).reduce((a, v) => a + Number(v || 0), 0);
        return `<tr class="border-b border-slate-50"><td class="py-1.5 px-3">${s.designation}</td><td class="py-1.5 px-3">৳${Number(s.basic).toLocaleString()}</td><td class="py-1.5 px-3">৳${allow.toLocaleString()}</td><td class="py-1.5 px-3">৳${ded.toLocaleString()}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="p-3 text-slate-400 font-bold text-xs">No salary structures yet.</td></tr>';
    });
  }
  function saveSalaryStructure() {
    const designation = document.getElementById('ssDesignation').value.trim();
    const basic = document.getElementById('ssBasic').value;
    const allowance = document.getElementById('ssAllowance').value || 0;
    const deduction = document.getElementById('ssDeduction').value || 0;
    if (!designation || !basic) { showToast('Designation and basic salary required', 'error'); return; }
    _adminFetch('save_salary_structure', { designation, basic, allowances: { total: allowance }, deductions: { total: deduction } }).then(res => {
      if (res && res.result === 'success') { showToast('Saved'); document.getElementById('ssDesignation').value = ''; document.getElementById('ssBasic').value = ''; loadSalaryStructures(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }

  function runPayroll() {
    const month = document.getElementById('prMonth').value.trim();
    const year = document.getElementById('prYear').value.trim();
    const status = document.getElementById('payrollRunStatus');
    if (!month || !year) { status.className = 'text-xs font-bold text-red-500'; status.textContent = 'Month and year required.'; return; }
    status.className = 'text-xs font-bold text-slate-400'; status.textContent = 'Running payroll…';
    _adminFetch('run_payroll', { month, year }).then(res => {
      if (!res || res.result !== 'success') { status.className = 'text-xs font-bold text-red-500'; status.textContent = (res && res.message) || 'Failed'; return; }
      status.className = 'text-xs font-bold text-emerald-600'; status.textContent = `Generated ${res.generated} payslip(s).`;
      _adminFetch('get_payslips', { payroll_run_id: res.run_id }).then(r2 => {
        const slips = (r2 && r2.result === 'success' && r2.payslips) || [];
        document.getElementById('payslipsBody').innerHTML = slips.map(s => `<tr class="border-b border-slate-50"><td class="py-1.5 px-3">${s.teacher_id}</td><td class="py-1.5 px-3">৳${Number(s.gross).toLocaleString()}</td><td class="py-1.5 px-3">৳${Number(s.total_deductions).toLocaleString()}</td><td class="py-1.5 px-3">৳${Number(s.net).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="4" class="p-3 text-slate-400 font-bold text-xs">No payslips generated — no salary structures match any staff designation.</td></tr>';
      });
    });
  }

  function loadLeaveRequests() {
    _adminFetch('get_leave_requests', {}).then(res => {
      const rows = (res && res.result === 'success' && res.requests) || [];
      document.getElementById('leaveRequestsBody').innerHTML = rows.map(r => `<tr class="border-b border-slate-50">
        <td class="py-1.5 px-3">${r.teacher_id}</td><td class="py-1.5 px-3">${r.leave_types ? r.leave_types.name : '—'}</td><td class="py-1.5 px-3">${r.start_date} to ${r.end_date}</td><td class="py-1.5 px-3">${r.reason || ''}</td>
        <td class="py-1.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${r.status}</span></td>
        <td class="py-1.5 px-3">${r.status === 'pending' ? `<button onclick="approveLeave(${r.id},'approved')" class="px-2 py-0.5 border border-emerald-200 text-emerald-600 rounded text-[10px] font-black uppercase hover:bg-emerald-50">Approve</button> <button onclick="approveLeave(${r.id},'rejected')" class="px-2 py-0.5 border border-red-200 text-red-500 rounded text-[10px] font-black uppercase hover:bg-red-50">Reject</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="p-3 text-slate-400 font-bold text-xs">No leave requests yet.</td></tr>';
    });
  }
  function approveLeave(id, status) {
    _adminFetch('approve_leave_request', { id, status }).then(res => { if (res && res.result === 'success') loadLeaveRequests(); });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Transport tab — native port (Phase 4, part 2). Includes the Bus/GPS
  // Config sub-tab (GP credentials, bus + geofence registries), merged
  // into Transport earlier this session.
  // ══════════════════════════════════════════════════════════════════════

  const TRANSPORT_SUBTABS = [
    { id: 'transport-routes-fees', label: 'Routes & Fees' },
    { id: 'transport-bus-config', label: 'Bus / GPS Config' },
  ];

  function loadAdminTransportView() {
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-transport');
    setContentHeader('Transport', 'bus');
    const container = document.getElementById('view-container');
    if (!container) return;
    const tabBar = TRANSPORT_SUBTABS.map((t, i) => `<button onclick="switchTransportTab('${t.id}')" id="trtab-${t.id}"
      class="fees-tab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
             ${i === 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}">${t.label}</button>`).join('');

    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Transport</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Routes, vehicles, pickup points, fees, GPS device config</p>
      </div>
      <div class="flex flex-wrap gap-2 mb-5">${tabBar}</div>

      <div id="transport-routes-fees">
        <p class="text-xs text-slate-400 font-bold mb-3">Live GPS tracking stays in the standalone Bus Tracking app — this is route/vehicle/pickup-point/fee administration only.</p>
        <div class="grid md:grid-cols-3 gap-4 mb-4">
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="signpost" class="h-4 w-4 text-blue-600"></i>Routes</p>
            <div class="flex gap-2 mb-2">
              <input type="text" id="trRouteName" placeholder="Route name" class="flex-1 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="saveTransportRoute()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">+</button>
            </div>
            <div id="transportRoutesList" class="flex flex-col gap-1"></div>
          </div>
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="truck" class="h-4 w-4 text-blue-600"></i>Vehicles</p>
            <div class="flex flex-col gap-1 mb-2">
              <input type="text" id="trVehicleName" placeholder="Vehicle name/no." class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <input type="text" id="trVehicleDriver" placeholder="Driver name" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="saveTransportVehicle()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Add Vehicle</button>
            </div>
            <div id="transportVehiclesList" class="flex flex-col gap-1"></div>
          </div>
          <div>
            <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="map-pin" class="h-4 w-4 text-blue-600"></i>Pickup Points</p>
            <div class="flex gap-2 mb-2">
              <input type="text" id="trPointName" placeholder="Point name" class="flex-1 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
              <button onclick="saveTransportPickupPoint()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">+</button>
            </div>
            <div id="transportPointsList" class="flex flex-col gap-1"></div>
          </div>
        </div>
        <hr class="border-slate-100 my-4">
        <p class="font-black text-slate-800 text-xs mb-2 flex items-center gap-2"><i data-lucide="coins" class="h-4 w-4 text-blue-600"></i>Transport Fees</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <input type="text" id="tfName" placeholder="Fee name (e.g. Route A Monthly)" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <input type="number" id="tfAmount" placeholder="Amount" class="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
          <button onclick="saveTransportFeeMaster()" class="px-3 py-2 bg-blue-600 text-white rounded-lg font-black text-[10px] uppercase">Add</button>
        </div>
        <div id="transportFeesList" class="flex flex-col gap-1"></div>
      </div>

      <div id="transport-bus-config" style="display:none">
        <div class="grid md:grid-cols-2 gap-4">
          <div class="bg-white rounded-2xl border border-slate-200 p-4">
            <p class="font-black text-slate-800 text-sm mb-3 flex items-center gap-2"><i data-lucide="shield" class="h-4 w-4 text-blue-600"></i>GP API Credentials</p>
            <div class="flex flex-col gap-2">
              <label class="text-[10px] font-black text-slate-400 uppercase">Username</label>
              <input type="text" id="gpUsername" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
              <label class="text-[10px] font-black text-slate-400 uppercase">Password</label>
              <div class="relative">
                <input type="password" id="gpPassword" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm">
                <button type="button" onclick="toggleGPPassword()" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><i data-lucide="eye" id="gpPassIcon" class="h-4 w-4"></i></button>
              </div>
              <label class="text-[10px] font-black text-slate-400 uppercase">Environment</label>
              <select id="gpEnvironment" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm"><option value="production">Production</option><option value="staging">Staging</option></select>
              <label class="text-[10px] font-black text-slate-400 uppercase">Verification (username:password)</label>
              <input type="text" id="gpPreEncoded" readonly class="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-sm text-slate-500">
              <label class="text-[10px] font-black text-slate-400 uppercase">System Generated API Key (Base64)</label>
              <input type="text" id="gpApiKeyDisplay" readonly class="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-sm text-slate-500">
              <div class="flex gap-2 mt-1">
                <button onclick="saveGPConfig()" class="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Update Credentials</button>
                <button id="btnVerifyGp" onclick="verifyGPConnection()" title="Verify Connection" class="px-3 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50"><i data-lucide="badge-check" class="h-4 w-4"></i></button>
              </div>
              <div id="gpStatus" class="text-center text-xs font-bold mt-1"></div>
            </div>
          </div>
          <div class="flex flex-col gap-4">
            <div class="bg-white rounded-2xl border border-slate-200 p-4">
              <div class="flex items-center justify-between mb-3">
                <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="bus-front" class="h-4 w-4 text-blue-600"></i>Bus Registry</p>
                <button onclick="addBusRow()" class="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg font-black text-[10px] uppercase hover:bg-slate-50">+ Add Bus</button>
              </div>
              <div class="overflow-auto">
                <table class="w-full text-left border-collapse text-xs">
                  <thead><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2">Bus Name</th><th class="py-2">IMEI Number</th><th></th></tr></thead>
                  <tbody id="busConfigBody"></tbody>
                </table>
              </div>
              <button onclick="saveBusConfig()" class="w-full mt-3 px-4 py-2.5 bg-slate-800 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save Registry</button>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 p-4">
              <div class="flex items-center justify-between mb-3">
                <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="map-pin" class="h-4 w-4 text-blue-600"></i>Places Registry (Geofencing)</p>
                <button onclick="addPlaceRow()" class="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg font-black text-[10px] uppercase hover:bg-slate-50">+ Add Place</button>
              </div>
              <div class="overflow-auto">
                <table class="w-full text-left border-collapse text-xs">
                  <thead><tr class="text-[10px] font-black text-slate-500 uppercase"><th class="py-2">Place Name</th><th class="py-2">Coordinates</th><th class="py-2">Radius (m)</th><th></th></tr></thead>
                  <tbody id="placeConfigBody"></tbody>
                </table>
              </div>
              <button onclick="savePlaceConfig()" class="w-full mt-3 px-4 py-2.5 bg-slate-800 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save Places</button>
            </div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadTransportRoutes();
    loadTransportVehicles();
    loadTransportPickupPoints();
    loadTransportFeeMaster();
  }

  function switchTransportTab(tabId) {
    TRANSPORT_SUBTABS.forEach(t => {
      const panel = document.getElementById(t.id);
      const btn = document.getElementById('trtab-' + t.id);
      const active = t.id === tabId;
      if (panel) panel.style.display = active ? '' : 'none';
      if (btn) {
        btn.className = btn.className.replace(/bg-blue-600 text-white shadow-lg shadow-blue-500\/20|bg-white text-slate-400 border border-slate-200 hover:bg-slate-50/g, '').trim();
        btn.className += active ? ' bg-blue-600 text-white shadow-lg shadow-blue-500/20' : ' bg-white text-slate-400 border border-slate-200 hover:bg-slate-50';
      }
    });
    if (tabId === 'transport-bus-config') loadTrackingConfig();
  }

  function loadTransportRoutes() {
    _adminFetch('get_transport_routes', {}).then(res => {
      const routes = (res && res.result === 'success' && res.routes) || [];
      document.getElementById('transportRoutesList').innerHTML = routes.map(r => `<div class="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">${r.name}${!r.is_active ? ' <span class="text-[10px] font-black text-white bg-slate-400 rounded px-1.5 py-0.5">Inactive</span>' : ''}</div>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No routes yet.</span>';
    });
  }
  function saveTransportRoute() {
    const name = document.getElementById('trRouteName').value.trim();
    if (!name) return;
    _adminFetch('save_transport_route', { name, is_active: true }).then(res => { if (res && res.result === 'success') { document.getElementById('trRouteName').value = ''; loadTransportRoutes(); } });
  }
  function loadTransportVehicles() {
    _adminFetch('get_transport_vehicles', {}).then(res => {
      const vehicles = (res && res.result === 'success' && res.vehicles) || [];
      document.getElementById('transportVehiclesList').innerHTML = vehicles.map(v => `<div class="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">${v.name}${v.driver_name ? ' · '+v.driver_name : ''}</div>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No vehicles yet.</span>';
    });
  }
  function saveTransportVehicle() {
    const name = document.getElementById('trVehicleName').value.trim();
    const driver_name = document.getElementById('trVehicleDriver').value.trim();
    if (!name) return;
    _adminFetch('save_transport_vehicle', { name, driver_name, is_active: true }).then(res => { if (res && res.result === 'success') { document.getElementById('trVehicleName').value = ''; document.getElementById('trVehicleDriver').value = ''; loadTransportVehicles(); } });
  }
  function loadTransportPickupPoints() {
    _adminFetch('get_pickup_points', {}).then(res => {
      const points = (res && res.result === 'success' && res.points) || [];
      document.getElementById('transportPointsList').innerHTML = points.map(p => `<div class="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">${p.name}</div>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No pickup points yet.</span>';
    });
  }
  function saveTransportPickupPoint() {
    const name = document.getElementById('trPointName').value.trim();
    if (!name) return;
    _adminFetch('save_pickup_point', { name }).then(res => { if (res && res.result === 'success') { document.getElementById('trPointName').value = ''; loadTransportPickupPoints(); } });
  }
  function loadTransportFeeMaster() {
    _adminFetch('get_transport_fee_master', {}).then(res => {
      const fees = (res && res.result === 'success' && res.fees) || [];
      document.getElementById('transportFeesList').innerHTML = fees.map(f => `<div class="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs flex justify-between"><span>${f.name}</span><span class="font-black text-slate-700">৳${Number(f.amount).toLocaleString()}/${f.collection_mode}</span></div>`).join('') || '<span class="text-xs text-slate-400 font-bold italic">No transport fees yet.</span>';
    });
  }
  function saveTransportFeeMaster() {
    const name = document.getElementById('tfName').value.trim();
    const amount = document.getElementById('tfAmount').value;
    if (!name || !amount) { showToast('Name and amount required', 'error'); return; }
    _adminFetch('save_transport_fee_master', { name, amount, collection_mode: 'Monthly' }).then(res => {
      if (res && res.result === 'success') { document.getElementById('tfName').value = ''; document.getElementById('tfAmount').value = ''; loadTransportFeeMaster(); }
      else showToast((res && res.message) || 'Failed', 'error');
    });
  }

  function loadTrackingConfig() {
    _adminFetch('get_tracking_config', {}).then(res => {
      if (res.busRegistry) {
        const tbody = document.getElementById('busConfigBody');
        if (tbody) { tbody.innerHTML = ''; res.busRegistry.forEach(r => addBusRow({ name: r[0], imei: r[1] })); }
      }
      if (res.placeRegistry) {
        const tbody = document.getElementById('placeConfigBody');
        if (tbody) { tbody.innerHTML = ''; res.placeRegistry.forEach(r => addPlaceRow({ name: r[0], coords: r[1], radius: r[2] })); }
      }
      if (res.credentials) {
        const u = document.getElementById('gpUsername');
        const p = document.getElementById('gpPassword');
        const env = document.getElementById('gpEnvironment');
        const keyDisp = document.getElementById('gpApiKeyDisplay');
        const preDisp = document.getElementById('gpPreEncoded');
        if (u) u.value = res.credentials.username || '';
        if (p) p.value = res.credentials.password || '';
        if (env) env.value = res.credentials.environment || 'production';
        if (keyDisp) keyDisp.value = res.credentials.apiKey || '';
        if (preDisp) preDisp.value = (res.credentials.username && res.credentials.password) ? `${res.credentials.username}:${res.credentials.password}` : '';
      }
    });
  }
  function toggleGPPassword() {
    const passInput = document.getElementById('gpPassword');
    const passIcon = document.getElementById('gpPassIcon');
    if (passInput.type === 'password') { passInput.type = 'text'; passIcon.setAttribute('data-lucide', 'eye-off'); }
    else { passInput.type = 'password'; passIcon.setAttribute('data-lucide', 'eye'); }
    lucide.createIcons();
  }
  function saveGPConfig() {
    const u = document.getElementById('gpUsername').value.trim();
    const p = document.getElementById('gpPassword').value.trim();
    const env = document.getElementById('gpEnvironment').value;
    const manualKey = document.getElementById('gpApiKeyDisplay').value.trim();
    const s = document.getElementById('gpStatus');
    if (!u || !p) { showToast('Username and Password required', 'error'); return; }
    s.textContent = 'Updating…'; s.className = 'text-center text-xs font-bold text-slate-400 mt-1';
    _adminFetch('set_gp_credentials', { username: u, password: p, channel: 'ALOEXT', environment: env, apiKey: manualKey }).then(res => {
      s.textContent = res.message;
      s.className = `text-center text-xs font-bold mt-1 ${res.result === 'success' ? 'text-emerald-600' : 'text-red-500'}`;
      if (res.result === 'success') { loadTrackingConfig(); verifyGPConnection(); }
    });
  }
  function verifyGPConnection() {
    const btn = document.getElementById('btnVerifyGp');
    const s = document.getElementById('gpStatus');
    btn.disabled = true;
    s.textContent = 'Verifying connection…'; s.className = 'text-center text-xs font-bold text-slate-400 mt-1';
    _adminFetch('test_gp_connection', {}).then(res => {
      btn.disabled = false;
      s.textContent = res.message;
      s.className = `text-center text-xs font-bold mt-1 ${res.result === 'success' ? 'text-emerald-600' : 'text-red-500'}`;
    });
  }
  function addBusRow(data = { name: '', imei: '' }) {
    const tbody = document.getElementById('busConfigBody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-1"><input type="text" class="b-name px-2 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-xs" value="${data.name}"></td>
      <td class="py-1"><input type="text" class="b-imei px-2 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-xs" value="${data.imei}"></td>
      <td class="py-1 text-right whitespace-nowrap">
        <button onclick="checkBusStatus(this)" class="px-2 py-1 border border-slate-200 text-slate-600 rounded text-[10px] font-black uppercase hover:bg-slate-50"><i data-lucide="radio" class="h-3 w-3 inline"></i> Check</button>
        <button onclick="this.closest('tr').remove()" class="px-2 py-1 text-red-500"><i data-lucide="trash-2" class="h-3 w-3"></i></button>
      </td>`;
    tbody.appendChild(tr);
    lucide.createIcons();
  }
  function checkBusStatus(btn) {
    const tr = btn.closest('tr');
    const imei = tr.querySelector('.b-imei').value.trim();
    if (!imei) { showToast('Please enter an IMEI first', 'error'); return; }
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '…';
    _adminFetch('check_bus', { imei }).then(res => {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      lucide.createIcons();
      if (res.result === 'success') {
        const d = res.data;
        alert(`BUS ONLINE\n\nName: ${tr.querySelector('.b-name').value}\nIMEI: ${imei}\nLocation: ${d.address}\nSpeed: ${d.speed} km/h\nEngine: ${d.engine}\nLast Update: ${d.time}`);
      } else {
        const isAuthError = res.message.includes('401') || res.message.includes('403') || res.message.includes('Unauthorized');
        const header = isAuthError ? 'ACCESS DENIED (API ERROR)' : 'BUS NOT FOUND / OFFLINE';
        const footer = isAuthError ? '\n\nTip: Check your Username, Password, and Channel in the GP API Credentials section.' : '\n\nTip: Ensure the IMEI is correct and the GPS device is powered on.';
        alert(`${header}\n\n${res.message}${footer}`);
      }
    });
  }
  function saveBusConfig() {
    const rows = [];
    document.querySelectorAll('#busConfigBody tr').forEach(tr => {
      const name = tr.querySelector('.b-name').value.trim();
      const imei = tr.querySelector('.b-imei').value.trim();
      if (name && imei) rows.push([name, imei]);
    });
    _adminFetch('save_bus_registry', { rows }).then(() => showToast('Registry updated'));
  }
  function addPlaceRow(data = { name: '', coords: '', radius: '50' }) {
    const tbody = document.getElementById('placeConfigBody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="py-1"><input type="text" class="p-name px-2 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-xs" value="${data.name}" placeholder="Main Gate"></td>
      <td class="py-1"><input type="text" class="p-coords px-2 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-xs" value="${data.coords}" placeholder="22.35, 91.78"></td>
      <td class="py-1"><input type="number" class="p-radius px-2 py-1 bg-slate-50 border border-slate-200 rounded font-bold text-xs" value="${data.radius}" style="width:80px"></td>
      <td class="py-1 text-right"><button onclick="this.closest('tr').remove()" class="px-2 py-1 text-red-500"><i data-lucide="trash-2" class="h-3 w-3"></i></button></td>`;
    tbody.appendChild(tr);
    lucide.createIcons();
  }
  function savePlaceConfig() {
    const rows = [];
    document.querySelectorAll('#placeConfigBody tr').forEach(tr => {
      const name = tr.querySelector('.p-name').value.trim();
      const coords = tr.querySelector('.p-coords').value.trim();
      const radius = tr.querySelector('.p-radius').value.trim();
      if (name && coords) rows.push([name, coords, radius || '50']);
    });
    _adminFetch('save_place_registry', { rows }).then(() => showToast('Places Registry updated'));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Setup tab — native port (Phase 5). The tab builder: dynamic custom
  // student-info tabs with drag-reorder, cut/copy/paste, conditional
  // "show only if" visibility, plus promote-to-profile, editable-field
  // picker, permanent-tab toggles, and login-password-column config. The
  // drag/clipboard logic is plain HTML5 DnD + keydown listeners — unchanged
  // from the original, since none of that depends on Bootstrap vs Tailwind.
  // ══════════════════════════════════════════════════════════════════════

  const SETUP_PERMANENT_TABS = [
    { id: 'wallet', name: 'Wallet', icon: 'wallet' },
    { id: 'fees', name: 'Fees & Dues', icon: 'banknote' },
    { id: 'canteen', name: 'Canteen', icon: 'coffee' },
    { id: 'stationary', name: 'Stationary', icon: 'shopping-bag' },
    { id: 'teachers', name: 'Teacher Directory', icon: 'users' },
    { id: 'bus-tracking', name: 'Live Bus Tracking', icon: 'bus' },
  ];
  let _setupAllTabs = [];
  let _setupPromotedTabs = [];
  let _activeFieldRow = null;
  let _fieldClipboard = null;

  function loadAdminSetupView() {
    if (!(window._adminTabAccess || []).includes('setup')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-setup');
    setContentHeader('Setup', 'sliders-horizontal');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Setup</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Profile fields, permanent tabs, login settings — use "+ Add Custom Form" to build or edit a tab</p>
      </div>

      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-5">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <p class="font-black text-slate-800 text-sm flex items-center gap-2"><i data-lucide="square-pen" class="h-4 w-4 text-blue-600"></i>Student-Editable Profile Fields</p>
          <div class="flex items-center gap-3">
            <span class="text-xs font-bold text-slate-400" id="editableFieldsCount">0 selected</span>
            <button onclick="saveEditableProfileFields()" class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save Editable Fields</button>
          </div>
        </div>
        <p class="text-xs text-slate-400 font-bold mb-3">Ticked fields get an Edit button in the student's Personal Hub so students can update them. ID / wallet / card fields are always locked.</p>
        <div id="editableFieldsList" class="flex flex-wrap gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading profile columns…</span></div>
      </div>

      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-5">
        <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-1"><i data-lucide="pin" class="h-4 w-4 text-blue-600"></i>Permanent Tabs</p>
        <p class="text-xs text-slate-400 font-bold mb-3">These built-in tabs aren't made in the builder above — turn any of them off to hide it from every student without deleting anything. Personal Hub is always on.</p>
        <div id="permanentTabsList" class="grid md:grid-cols-2 gap-3"></div>
      </div>

      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-5">
        <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-1"><i data-lucide="shield-check" class="h-4 w-4 text-blue-600"></i>Login Settings</p>
        <p class="text-xs text-slate-400 font-bold mb-3">Choose which phone number(s) a student can log in with, alongside their Student ID. Untick a column to stop accepting it — at least one must stay checked.</p>
        <div id="loginPasswordColumnsList" class="flex flex-wrap gap-4"></div>
        <hr class="border-slate-100 my-4">
        <p class="font-black text-slate-800 text-xs mb-1">Reset a Student's PIN</p>
        <p class="text-xs text-slate-400 font-bold mb-3">If a student is locked out (set a PIN, forgot it, and can't reach their registered phone), clear it here — they'll fall back to phone-number login immediately.</p>
        <div class="flex gap-2 flex-wrap items-center">
          <input type="text" id="adminResetPinId" placeholder="Student ID" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" style="max-width:220px">
          <button onclick="adminResetPin()" class="px-3 py-2 border border-red-200 text-red-500 rounded-xl font-black text-[10px] uppercase hover:bg-red-50">Reset PIN</button>
          <span id="adminResetPinStatus" class="text-xs font-bold"></span>
        </div>
      </div>

      <hr class="border-slate-100 my-6">
      <div id="adminTabsList" class="grid md:grid-cols-2 gap-4"></div>
    `;
    lucide.createIcons();
    loadAdminTabs();
    loadEditableProfileFields();
    loadPermanentTabsAdmin();
    loadLoginPasswordColumnsAdmin();
  }

  // The tab BUILDER — create a new custom form, or (via editTab) edit an
  // existing one — lives here exclusively now, split out of Setup so that
  // page stays a pure settings/management hub (profile fields, permanent
  // tabs, login settings, and the list of existing tabs with Edit/Delete/
  // Toggle). Always renders fresh/blank on its own; editTab() populates it
  // afterward when editing, same as it always has.
  function loadAdminAddCustomFormView(preloadInclKeys) {
    if (!(window._adminTabAccess || []).includes('add_custom_form')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-add_custom_form');
    setContentHeader('Add Custom Form', 'plus-circle');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Add Custom Form</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Build a new tab, or edit an existing one from Setup's list</p>
      </div>

      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-5">
        <div class="grid grid-cols-1 md:grid-cols-10 gap-3 items-end">
          <div class="md:col-span-4"><label class="text-[10px] font-black text-slate-400 uppercase">Tab Name</label><input type="text" id="newTabName" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm mt-1"></div>
          <div class="md:col-span-3"><label class="text-[10px] font-black text-slate-400 uppercase">Icon (Lucide name)</label><input type="text" id="newTabIcon" placeholder="folder" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm mt-1"></div>
          <div class="md:col-span-2 flex items-center gap-2 pb-2"><input type="checkbox" id="newTabEditable" checked><label class="text-xs font-bold text-slate-600">Allows Edits</label></div>
          <div class="md:col-span-1"><button onclick="saveNewTab()" class="w-full px-3 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save</button></div>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-4">
          <button onclick="addTabRow('field')" class="px-4 py-2.5 border border-blue-200 text-blue-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-50 transition-all">+ New Input</button>
          <button onclick="addTabRow('label')" class="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">+ New Header</button>
        </div>
        <div class="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
          <div class="flex items-center justify-between mb-3">
            <span class="text-[10px] font-black text-slate-400 uppercase">Logic Rules</span>
            <button onclick="addConditionRow()" class="px-3 py-1.5 bg-slate-800 text-white rounded-full font-black text-[10px] uppercase">+ Add Rule</button>
          </div>
          <div id="conditionsList" class="flex flex-col gap-3"></div>
        </div>
        <div class="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-black text-slate-400 uppercase">Include from Student Profile</span>
            <span class="text-xs font-bold text-slate-400" id="includeFieldsCount">0 selected</span>
          </div>
          <p class="text-xs text-slate-400 font-bold mb-3">Selected fields will appear as read-only info inside the form and will be saved as extra columns in the sheet.</p>
          <div id="includeFieldsList" class="flex flex-wrap gap-2"><span class="text-xs text-slate-400 font-bold italic">Loading profile columns…</span></div>
        </div>
      </div>

      <div id="fieldsList" class="flex flex-col gap-3 mb-5"></div>
    `;
    lucide.createIcons();
    loadIncludeFields(preloadInclKeys || []);
    if (!_setupAllTabs.length) _adminFetch('get_tabs', {}).then(tabs => { if (Array.isArray(tabs)) _setupAllTabs = tabs; });
    setTimeout(() => { document.getElementById('newTabName')?.focus(); }, 50);
  }

  function loadIncludeFields(selectedKeys = []) {
    _adminFetch('get_student_data_headers', {}).then(headers => {
      const container = document.getElementById('includeFieldsList');
      if (!container) return;
      const skip = new Set(['student_id', 'studentid', 'nfc_uid', 'nfcuid']);
      const rows = (headers || []).filter(h => !skip.has(h.toLowerCase().replace(/[\s_]/g, '')));
      if (!rows.length) { container.innerHTML = '<span class="text-xs text-slate-400 font-bold italic">No profile columns found.</span>'; return; }
      container.innerHTML = rows.map(h => {
        const checked = selectedKeys.includes(h);
        return `<label class="px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}">
          <input type="checkbox" value="${h}" ${checked ? 'checked' : ''} onchange="_toggleFieldChip(this);updateIncludeCount()">${h.replace(/_/g, ' ')}
        </label>`;
      }).join('');
      updateIncludeCount();
    });
  }
  function _toggleFieldChip(cb) {
    const label = cb.closest('label');
    label.classList.toggle('bg-blue-50', cb.checked);
    label.classList.toggle('border-blue-300', cb.checked);
    label.classList.toggle('text-blue-700', cb.checked);
    label.classList.toggle('border-slate-200', !cb.checked);
    label.classList.toggle('text-slate-500', !cb.checked);
  }
  function updateIncludeCount() {
    const count = document.querySelectorAll('#includeFieldsList input[type="checkbox"]:checked').length;
    const el = document.getElementById('includeFieldsCount');
    if (el) el.textContent = count + ' selected';
  }

  const SETUP_EDITABLE_LOCKED = new Set(['id', 'student_id', 'nfc_uid', 'balance', 'daily_limit', 'monthly_limit', 'card_status', 'submitted_at']);
  function loadEditableProfileFields() {
    Promise.all([
      _adminFetch('get_student_data_headers', {}),
      _adminFetch('get_editable_fields', {}),
    ]).then(([headers, res]) => {
      const container = document.getElementById('editableFieldsList');
      if (!container) return;
      const selected = (res && Array.isArray(res.fields)) ? res.fields : [];
      const skip = new Set(['id', 'studentid', 'nfcuid', 'submittedat']);
      const rows = (headers || []).filter(h => !skip.has(h.toLowerCase().replace(/[\s_]/g, '')));
      if (!rows.length) { container.innerHTML = '<span class="text-xs text-slate-400 font-bold italic">No profile columns found.</span>'; return; }
      container.innerHTML = rows.map(h => {
        const locked = SETUP_EDITABLE_LOCKED.has(h);
        const checked = selected.includes(h);
        if (locked) return `<span class="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-400 text-xs font-bold opacity-60" title="Always locked"><i data-lucide="lock" class="h-3 w-3 inline mr-1"></i>${h.replace(/_/g, ' ')}</span>`;
        return `<label class="px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}">
          <input type="checkbox" value="${h}" ${checked ? 'checked' : ''} onchange="_toggleFieldChip(this);updateEditableCount()">${h.replace(/_/g, ' ')}
        </label>`;
      }).join('');
      lucide.createIcons();
      updateEditableCount();
    });
  }
  function updateEditableCount() {
    const count = document.querySelectorAll('#editableFieldsList input[type="checkbox"]:checked').length;
    const el = document.getElementById('editableFieldsCount');
    if (el) el.textContent = count + ' selected';
  }
  function saveEditableProfileFields() {
    const fields = Array.from(document.querySelectorAll('#editableFieldsList input[type="checkbox"]:checked')).map(c => c.value);
    _adminFetch('save_editable_fields', { fields }).then(res => {
      if (res && res.result === 'success') showToast('Editable fields saved');
      else showToast('Save failed', 'error');
    }).catch(() => showToast('Network error', 'error'));
  }

  function loadPermanentTabsAdmin() {
    _adminFetch('get_permanent_tabs_config', {}).then(cfg => {
      const list = document.getElementById('permanentTabsList');
      if (!list) return;
      cfg = cfg || {};
      list.innerHTML = SETUP_PERMANENT_TABS.map(t => {
        const enabled = cfg[t.id] !== false;
        return `<div class="flex justify-between items-center border border-slate-200 rounded-2xl px-4 py-3 ${enabled ? '' : 'opacity-60'}">
          <div class="flex items-center gap-2 text-sm font-black text-slate-800"><i data-lucide="${t.icon}" class="h-4 w-4 text-blue-600"></i>${t.name}${enabled ? '' : ' <span class="text-[9px] font-black text-slate-400 bg-slate-100 rounded-full px-2 py-0.5 ml-1">Hidden from students</span>'}</div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only" ${enabled ? 'checked' : ''} onchange="togglePermanentTab('${t.id}', this.checked)">
            <span class="text-[10px] font-black uppercase ${enabled ? 'text-emerald-600' : 'text-slate-400'}">${enabled ? 'Active' : 'Inactive'}</span>
          </label>
        </div>`;
      }).join('');
      lucide.createIcons();
    }).catch(() => {});
  }
  function togglePermanentTab(id, isOn) {
    _adminFetch('get_permanent_tabs_config', {}).then(cfg => {
      cfg = cfg || {};
      cfg[id] = isOn;
      return _adminFetch('set_permanent_tabs_config', cfg);
    }).then(res => {
      const tabName = (SETUP_PERMANENT_TABS.find(t => t.id === id) || {}).name || id;
      if (res && res.result === 'success') showToast(isOn ? `"${tabName}" is now visible to students` : `"${tabName}" is now hidden from students`);
      else showToast((res && res.message) || 'Could not update status', 'error');
      loadPermanentTabsAdmin();
    }).catch(() => { showToast('Network error', 'error'); loadPermanentTabsAdmin(); });
  }

  function loadLoginPasswordColumnsAdmin() {
    _adminFetch('get_login_password_columns', {}).then(cfg => {
      const list = document.getElementById('loginPasswordColumnsList');
      if (!list || !cfg) return;
      const selected = cfg.selected || [];
      list.innerHTML = (cfg.candidates || []).map(col => `
        <label class="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
          <input type="checkbox" ${selected.includes(col) ? 'checked' : ''} onchange="toggleLoginPasswordColumn('${col}', this.checked)"><code class="text-[11px]">${col}</code>
        </label>`).join('');
    }).catch(() => {});
  }
  function toggleLoginPasswordColumn(col, isOn) {
    _adminFetch('get_login_password_columns', {}).then(cfg => {
      let selected = (cfg && cfg.selected) ? [...cfg.selected] : [];
      if (isOn && !selected.includes(col)) selected.push(col);
      if (!isOn) selected = selected.filter(c => c !== col);
      return _adminFetch('set_login_password_columns', { columns: selected });
    }).then(res => {
      if (res && res.result === 'success') showToast('Login settings saved');
      else showToast((res && res.message) || 'Could not update login settings', 'error');
      loadLoginPasswordColumnsAdmin();
    }).catch(() => { showToast('Network error', 'error'); loadLoginPasswordColumnsAdmin(); });
  }

  function loadAdminTabs() {
    Promise.all([_adminFetch('get_tabs', {}), _adminFetch('get_profile_sections', {})]).then(([tabs, ps]) => {
      if (!Array.isArray(tabs)) return;
      _setupAllTabs = tabs;
      _setupPromotedTabs = (ps && Array.isArray(ps.sections)) ? ps.sections.map(s => s.tab_name) : [];
      const list = document.getElementById('adminTabsList');
      if (list) {
        list.innerHTML = tabs.map((t, i) => {
          const promoted = _setupPromotedTabs.includes(t.tab_name);
          const promoBtn = promoted
            ? `<button onclick="unpromoteTab('${t.tab_name}')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-full font-black text-[10px] uppercase flex items-center gap-1" title="This tab's fields are part of the profile — click to remove"><i data-lucide="check-circle" class="h-3 w-3"></i>In Profile</button>`
            : `<button onclick="promoteTab('${t.tab_name}')" class="px-3 py-1.5 border border-emerald-200 text-emerald-600 rounded-full font-black text-[10px] uppercase flex items-center gap-1 hover:bg-emerald-50" title="Add this tab's fields to the student profile as columns"><i data-lucide="plus-circle" class="h-3 w-3"></i>Add to Profile</button>`;
          return `<div class="border border-slate-200 rounded-2xl p-4 ${t.is_enabled ? '' : 'opacity-60'}">
            <div class="flex justify-between items-center">
              <div class="flex items-center gap-2 text-sm font-black text-slate-800 truncate"><i data-lucide="folder" class="h-4 w-4 text-blue-600 shrink-0"></i>${t.tab_name}${t.is_enabled ? '' : ' <span class="text-[9px] font-black text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">Hidden</span>'}</div>
              <div class="flex items-center gap-2 shrink-0">
                <button onclick="editTab(${i})" class="px-2.5 py-1 bg-blue-600 text-white rounded-full font-black text-[10px] uppercase">Edit</button>
                <button onclick="deleteTabConfig(${i})" class="px-2.5 py-1 bg-red-500 text-white rounded-full font-black text-[10px] uppercase">Del</button>
                <input type="checkbox" ${t.is_enabled ? 'checked' : ''} onchange="toggleStatus(${i}, this.checked)" title="Active tabs are visible to students; inactive tabs are hidden without deleting their setup or data">
              </div>
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100">${promoBtn}</div>
          </div>`;
        }).join('');
        lucide.createIcons();
      }
    });
  }

  function promoteTab(tabName) {
    if (!confirm(`Add all fields from "${tabName}" to the student profile?\n\nThis creates matching columns in students_data and copies existing submissions into them. Fields you tick as editable will then be editable from the profile.`)) return;
    showToast('Adding fields to profile…');
    _adminFetch('promote_tab_to_profile', { tab_name: tabName }).then(res => {
      if (res && res.result === 'success') { showToast(`Added ${res.added} field(s) to the profile`); loadAdminTabs(); loadEditableProfileFields(); }
      else showToast((res && res.message) || 'Failed to add to profile', 'error');
    }).catch(() => showToast('Network error', 'error'));
  }
  function unpromoteTab(tabName) {
    if (!confirm(`Remove "${tabName}" from the student profile view?\n\nThe columns and their data stay in the database — they just won't show in the profile anymore.`)) return;
    _adminFetch('unpromote_tab_from_profile', { tab_name: tabName }).then(res => {
      if (res && res.result === 'success') { showToast('Removed from profile'); loadAdminTabs(); }
      else showToast('Failed', 'error');
    });
  }

  function _showIfValStr(v) { return Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)); }
  function parseShowIfForEditor(showIf) {
    const empty = [{ field: '', value: '' }, { field: '', value: '' }];
    if (!showIf) return empty;
    const list = Array.isArray(showIf.all) ? showIf.all : Array.isArray(showIf.any) ? showIf.any : [{ field: showIf.field, value: showIf.value }];
    return [
      { field: list[0]?.field || '', value: _showIfValStr(list[0]?.value) },
      { field: list[1]?.field || '', value: _showIfValStr(list[1]?.value) },
    ];
  }
  function showIfBlockHtml(data) {
    const c = parseShowIfForEditor(data?.show_if);
    const has = !!(data && data.show_if);
    return `
      <div class="mt-2">
        <div class="showif-block ${has ? '' : 'hidden'} p-2.5 rounded-xl bg-slate-50 flex items-center gap-2 flex-wrap text-xs">
          <span class="font-black text-slate-400 flex items-center gap-1"><i data-lucide="git-branch" class="h-3 w-3"></i>Show only if</span>
          <select class="showif-field px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-xs" style="max-width:190px"><option value="">(always visible)</option></select>
          <span class="text-slate-400 font-bold">=</span>
          <input type="text" class="showif-value px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-xs" placeholder="value" style="max-width:130px" value="${(c[0].value || '').replace(/"/g, '&quot;')}">
          <span class="px-2 py-0.5 bg-slate-800 text-white rounded-full text-[10px] font-black">AND</span>
          <select class="showif-field2 px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-xs" style="max-width:190px"><option value="">(none)</option></select>
          <span class="text-slate-400 font-bold">=</span>
          <input type="text" class="showif-value2 px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-xs" placeholder="value" style="max-width:130px" value="${(c[1].value || '').replace(/"/g, '&quot;')}">
        </div>
        <button type="button" class="showif-toggle text-[11px] font-bold text-blue-600 mt-1" onclick="const b=this.previousElementSibling; b.classList.toggle('hidden'); this.textContent = b.classList.contains('hidden') ? '+ Add condition (dependable)' : '− Hide condition';">${has ? '− Hide condition' : '+ Add condition (dependable)'}</button>
      </div>`;
  }

  const SETUP_FIELD_ROW_ACTIONS = `
    <button type="button" onclick="duplicateField(this)" class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Duplicate"><i data-lucide="copy" class="h-3.5 w-3.5"></i></button>
    <button type="button" onclick="cutField(this)" class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Cut (Ctrl+X)"><i data-lucide="scissors" class="h-3.5 w-3.5"></i></button>
    <button type="button" onclick="copyField(this)" class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Copy (Ctrl+C)"><i data-lucide="clipboard" class="h-3.5 w-3.5"></i></button>
    <button type="button" onclick="pasteField(this)" class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Paste after this field (Ctrl+V)"><i data-lucide="clipboard-check" class="h-3.5 w-3.5"></i></button>
    <button type="button" onclick="this.closest('.draggable-row').remove()" class="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50" title="Delete"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>`;

  function addTabRow(type, data = null) {
    const container = document.getElementById('fieldsList');
    const row = document.createElement('div');
    row.className = 'draggable-row bg-white rounded-2xl border border-slate-200 shadow-sm p-4';
    row.id = `f-row-${container.children.length}`;
    row.draggable = true;
    row.ondragstart = (e) => { e.dataTransfer.setData('text', row.id); row.style.opacity = '0.4'; };
    row.ondragend = () => { row.style.opacity = '1'; };
    row.ondragover = (e) => {
      e.preventDefault();
      const dr = [...container.children].find(el => el.style.opacity === '0.4');
      if (dr && dr !== row) {
        const c = [...container.children];
        if (c.indexOf(dr) < c.indexOf(row)) row.after(dr); else row.before(dr);
      }
    };
    row.addEventListener('click', (e) => { if (e.target.closest('input,select,textarea,button,a')) return; setActiveField(row); });
    const grip = `<div class="flex items-center text-slate-300 cursor-grab pr-1"><i data-lucide="grip-vertical" class="h-5 w-5"></i></div>`;
    const keyInput = `<input type="hidden" class="f-key" value="${data?.data_key || ''}">`;
    if (type === 'label') {
      row.innerHTML = `<div class="flex items-center gap-2">${grip}<input type="text" placeholder="Identity Header" class="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-black text-blue-600 text-sm" value="${data?.label || ''}"><input type="hidden" class="f-type" value="group_label">${keyInput}<div class="flex gap-0.5">${SETUP_FIELD_ROW_ACTIONS}</div></div>${showIfBlockHtml(data)}`;
    } else {
      row.innerHTML = `<div class="flex items-center gap-2 flex-wrap">${grip}
        <input type="text" placeholder="Label" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm" style="flex:1;min-width:160px" value="${data?.name || ''}">
        <select class="f-type px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" onchange="const o = this.closest('.draggable-row').querySelector('.f-options'); if(['checkbox','choose'].includes(this.value)) o.classList.remove('hidden'); else o.classList.add('hidden');">
          <option value="text" ${data?.type === 'text' ? 'selected' : ''}>Text Input</option>
          <option value="paragraph" ${data?.type === 'paragraph' ? 'selected' : ''}>Paragraph</option>
          <option value="number" ${data?.type === 'number' ? 'selected' : ''}>Number</option>
          <option value="checkbox" ${data?.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
          <option value="choose" ${data?.type === 'choose' ? 'selected' : ''}>Dropdown</option>
        </select>
        <input type="text" placeholder="Options (comma separated)" class="f-options px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs ${['checkbox', 'choose'].includes(data?.type) ? '' : 'hidden'}" style="flex:1;min-width:160px" value="${(data?.options || []).join(',')}">
        ${keyInput}
        <div class="flex gap-0.5">${SETUP_FIELD_ROW_ACTIONS}</div>
      </div>${showIfBlockHtml(data)}`;
    }
    container.appendChild(row);
    lucide.createIcons();
    const cond = parseShowIfForEditor(data?.show_if);
    populateShowIfSelect(row.querySelector('.showif-field'), cond[0].field);
    populateShowIfSelect(row.querySelector('.showif-field2'), cond[1].field);
    return row;
  }

  function setActiveField(row) {
    document.querySelectorAll('#fieldsList .draggable-row').forEach(r => { r.style.outline = ''; r.style.background = ''; });
    row.style.outline = '2px solid #2563eb';
    row.style.background = '#eff6ff';
    _activeFieldRow = row;
  }
  function _readRowShowIf(row) {
    const f1 = row.querySelector('.showif-field')?.value.trim();
    const v1 = row.querySelector('.showif-value')?.value.trim();
    const f2 = row.querySelector('.showif-field2')?.value.trim();
    const v2 = row.querySelector('.showif-value2')?.value.trim();
    const conds = [];
    if (f1) conds.push({ field: f1, value: v1 });
    if (f2) conds.push({ field: f2, value: v2 });
    if (!conds.length) return null;
    if (conds.length === 1) return conds[0];
    return { all: conds };
  }
  function serializeFieldRow(row) {
    const type = row.querySelector('.f-type')?.value;
    const show_if = _readRowShowIf(row) || undefined;
    if (type === 'group_label') return { kind: 'label', data: { label: row.querySelector('input[type="text"]')?.value || '', show_if } };
    const name = row.querySelector('input[placeholder="Label"]')?.value || '';
    const options = (row.querySelector('.f-options')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    return { kind: 'field', data: { name, type, options, show_if } };
  }
  function duplicateField(btn) {
    const row = btn.closest('.draggable-row');
    const { kind, data } = serializeFieldRow(row);
    const newRow = addTabRow(kind, data);
    row.after(newRow);
    setActiveField(newRow);
    newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function copyField(btn) {
    const row = btn.closest('.draggable-row');
    _fieldClipboard = serializeFieldRow(row);
    setActiveField(row);
    showToast('Field copied');
  }
  function cutField(btn) {
    const row = btn.closest('.draggable-row');
    _fieldClipboard = serializeFieldRow(row);
    row.remove();
    if (_activeFieldRow === row) _activeFieldRow = null;
    showToast('Field cut — Ctrl+V or Paste to place it');
  }
  function _pasteAfter(afterRow) {
    if (!_fieldClipboard) { showToast('Nothing to paste — copy or cut a field first', 'error'); return; }
    const newRow = addTabRow(_fieldClipboard.kind, _fieldClipboard.data);
    if (afterRow) afterRow.after(newRow);
    setActiveField(newRow);
    newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function pasteField(btn) { _pasteAfter(btn.closest('.draggable-row')); }

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key !== 'x' && key !== 'c' && key !== 'v') return;
    const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(activeTag)) return;
    if (!document.getElementById('fieldsList')) return;
    if (key === 'v') { e.preventDefault(); _pasteAfter(_activeFieldRow); return; }
    if (!_activeFieldRow) return;
    e.preventDefault();
    _fieldClipboard = serializeFieldRow(_activeFieldRow);
    if (key === 'x') { const row = _activeFieldRow; row.remove(); _activeFieldRow = null; showToast('Field cut'); }
    else showToast('Field copied');
  });

  function getBuilderFieldKeys() {
    const sz = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const out = [];
    let cl = '';
    document.querySelectorAll('#fieldsList .draggable-row').forEach(row => {
      const type = row.querySelector('.f-type')?.value;
      if (type === 'group_label') { const l = row.querySelector('input[type="text"]')?.value.trim(); if (l) cl = sz(l); return; }
      const label = row.querySelector('input[placeholder="Label"]')?.value.trim();
      if (!label) return;
      let key = row.querySelector('.f-key')?.value.trim();
      if (!key) { key = sz(label); if (cl) key = `${cl}_${key}`; }
      out.push({ key, label });
    });
    return out;
  }
  function populateShowIfSelect(sel, selectedKey, keys) {
    if (!sel) return;
    const isSecond = sel.classList.contains('showif-field2');
    keys = keys || getBuilderFieldKeys();
    sel.innerHTML = `<option value="">${isSecond ? '(none)' : '(always visible)'}</option>` + keys.map(k => `<option value="${k.key}" ${k.key === selectedKey ? 'selected' : ''}>${k.label}</option>`).join('');
    if (selectedKey && !keys.some(k => k.key === selectedKey)) {
      const o = document.createElement('option'); o.value = selectedKey; o.textContent = selectedKey; o.selected = true; sel.appendChild(o);
    }
  }
  function refreshAllShowIfControllers() {
    const keys = getBuilderFieldKeys();
    document.querySelectorAll('#fieldsList .showif-field, #fieldsList .showif-field2').forEach(sel => populateShowIfSelect(sel, sel.value, keys));
  }

  function addConditionRow(rule = null) {
    const container = document.getElementById('conditionsList');
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 flex-wrap bg-white p-3 rounded-2xl border border-slate-200';
    row.innerHTML = `
      <select class="rule-col px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" style="min-width:160px"><option value="">Column…</option></select>
      <select class="rule-op px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs">
        <option value="eq">EQUALS</option><option value="neq">NOT EQUALS</option><option value="contains">CONTAINS</option><option value="in_sheet">IS IN SHEET</option><option value="not_in_sheet">IS NOT IN SHEET</option>
      </select>
      <input type="text" class="rule-val px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" placeholder="Target" style="min-width:140px">
      <button onclick="this.closest('div.flex').remove()" class="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>`;
    container.appendChild(row);
    lucide.createIcons();
    _adminFetch('get_student_data_headers', {}).then(headers => {
      const s = row.querySelector('.rule-col');
      (headers || []).forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = h.toUpperCase().replace(/_/g, ' '); if (rule?.column === h) o.selected = true; s.appendChild(o); });
    });
    if (rule) { row.querySelector('.rule-op').value = rule.operator; row.querySelector('.rule-val').value = rule.value; }
  }

  function saveNewTab() {
    const name = document.getElementById('newTabName').value.trim();
    const icon = document.getElementById('newTabIcon').value.trim() || 'folder';
    const edit = document.getElementById('newTabEditable').checked;
    if (!name) { showToast('Title required', 'error'); return; }
    const fields = []; let cl = '';
    const sz = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const optionless = [];
    document.querySelectorAll('#fieldsList .draggable-row').forEach(row => {
      const type = row.querySelector('.f-type').value;
      const showIf = _readRowShowIf(row);
      if (type === 'group_label') {
        const l = row.querySelector('input[type="text"]').value.trim();
        if (l) { const g = { type: 'group_label', label: l }; if (showIf) g.show_if = showIf; fields.push(g); cl = sz(l); }
      } else {
        const fn = row.querySelector('input[placeholder="Label"]')?.value.trim();
        const fo = row.querySelector('.f-options')?.value.split(',').map(s => s.trim()).filter(Boolean);
        if (fn) {
          if ((type === 'choose' || type === 'checkbox') && !fo.length) optionless.push(fn);
          let f = row.querySelector('.f-key')?.value.trim();
          if (!f) { let k = sz(fn); if (cl) k = `${cl}_${k}`; f = k; let c = 1; while (fields.some(fd => fd.data_key === f)) { f = `${k}_${c++}`; } }
          const obj = { name: fn, type, options: fo, data_key: f };
          if (showIf) obj.show_if = showIf;
          fields.push(obj);
        }
      }
    });
    if (optionless.length && !confirm(`These dropdown/checkbox fields have no options and will show as empty:\n\n• ${optionless.join('\n• ')}\n\nAdd comma-separated options in the "Options" box. Save anyway?`)) return;
    const rs = [];
    document.querySelectorAll('#conditionsList > div').forEach(row => {
      const col = row.querySelector('.rule-col')?.value;
      if (col) rs.push({ column: col, operator: row.querySelector('.rule-op').value, value: row.querySelector('.rule-val').value.trim() });
    });
    const includeFields = Array.from(document.querySelectorAll('#includeFieldsList input[type="checkbox"]:checked')).map(c => c.value);
    const existingTab = (_setupAllTabs || []).find(t => t.tab_name === name);
    const keepEnabled = existingTab ? existingTab.is_enabled !== false : true;
    const cfg = { tab_name: name, fields_json: JSON.stringify(fields), is_enabled: keepEnabled, icon_class: icon, default_editable: edit ? 'YES' : 'NO', condition_json: JSON.stringify({ logic: 'AND', rules: rs }), include_fields_json: JSON.stringify(includeFields) };
    _adminFetch('save_tab', cfg).then(res => {
      if (res && res.result === 'success') { showToast('Setup saved'); loadAdminSetupView(); }
      else showToast((res && res.message) || 'Save failed — please retry.', 'error');
    }).catch(() => showToast('Network error while saving — please retry.', 'error'));
  }

  function editTab(i) {
    const t = _setupAllTabs[i];
    let inclKeys = [];
    try { inclKeys = JSON.parse(t.include_fields_json || '[]'); } catch (e) {}
    // Editing now happens in the same dedicated "Add Custom Form" view as
    // creating a new tab (moved out of Setup) — render it fresh first, then
    // fill it in, exactly as this function always has.
    loadAdminAddCustomFormView(inclKeys);
    document.getElementById('newTabName').value = t.tab_name;
    document.getElementById('newTabIcon').value = t.icon_class || '';
    document.getElementById('newTabEditable').checked = t.default_editable === 'YES';
    document.getElementById('fieldsList').innerHTML = '';
    JSON.parse(t.fields_json).forEach(f => addTabRow(f.type === 'group_label' ? 'label' : 'field', f));
    refreshAllShowIfControllers();
    document.getElementById('conditionsList').innerHTML = '';
    if (t.condition_json) { const l = JSON.parse(t.condition_json); (l.rules || []).forEach(r => addConditionRow(r)); }
  }
  function deleteTabConfig(i) {
    if (!confirm('Confirm deletion?')) return;
    _adminFetch('delete_tab', { tab_name: _setupAllTabs[i].tab_name }).then(res => {
      if (res && res.result === 'success') loadAdminTabs();
      else showToast((res && res.message) || 'Delete failed', 'error');
    }).catch(() => showToast('Network error while deleting', 'error'));
  }
  function toggleStatus(i, s) {
    _adminFetch('save_tab', { tab_name: _setupAllTabs[i].tab_name, is_enabled: s }).then(res => {
      if (res && res.result === 'success') { showToast(s ? `"${_setupAllTabs[i].tab_name}" is now visible to students` : `"${_setupAllTabs[i].tab_name}" is now hidden from students`); loadAdminTabs(); }
      else { showToast((res && res.message) || 'Could not update status', 'error'); loadAdminTabs(); }
    }).catch(() => { showToast('Network error', 'error'); loadAdminTabs(); });
  }

  function adminResetPin() {
    const input = document.getElementById('adminResetPinId');
    const status = document.getElementById('adminResetPinStatus');
    const sid = (input && input.value || '').trim();
    if (!sid) { if (status) { status.className = 'text-xs font-bold text-red-500'; status.textContent = 'Enter a Student ID.'; } return; }
    if (!confirm(`Clear the PIN for "${sid}"? They will be able to log in with their phone number again.`)) return;
    if (status) { status.className = 'text-xs font-bold text-slate-400'; status.textContent = 'Resetting…'; }
    _adminFetch('admin_reset_pin', { student_id: sid }).then(res => {
      if (res && res.result === 'success') {
        if (input) input.value = '';
        if (status) { status.className = 'text-xs font-bold text-emerald-600'; status.textContent = res.message || 'PIN cleared.'; }
        showToast(res.message || 'PIN cleared');
      } else if (status) { status.className = 'text-xs font-bold text-red-500'; status.textContent = (res && res.message) || 'Could not reset PIN.'; }
    }).catch(() => { if (status) { status.className = 'text-xs font-bold text-red-500'; status.textContent = 'Network error.'; } });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Data tab — native port (Phase 6, part 1). Per-tab submitted-data
  // viewer/exporter with display-only column merging, print, and two kinds
  // of delegated access (flat "Data Access" and class-scoped "Class
  // Access"). Modals are injected inline (loadInventoryView's own pattern),
  // same class-pair as every other dynamic modal built this session.
  // ══════════════════════════════════════════════════════════════════════

  let _summaryData = null;
  let _summaryColumnMerges = [];
  let _activeSummaryMergeOpts = null;
  let _caTab = null, _caStaff = [], _caClassSections = [], _caGrants = {}, _caSelectedUser = null;

  function loadAdminDataView() {
    if (!(window._adminTabAccess || []).includes('data')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-data');
    setContentHeader('Data', 'table');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Data</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Per-tab submitted data, export, merge, print, delegated access</p>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
        <select id="summaryTabSelect" onchange="loadSummaryData()" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs"><option value="">Select Target…</option></select>
        <input type="text" id="summarySearch" placeholder="Filter current view…" oninput="filterSummaryTable()" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-summary-search">
        <button onclick="exportSummaryData()" class="px-3 py-2 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Export CSV</button>
        <button onclick="openTabAccessModal()" title="Choose which teachers/staff can view & export this tab's data" class="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Data Access</button>
        <button onclick="openClassAccessModal()" title="Grant a teacher/staff access for specific class-sections only" class="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Class Access</button>
        <button onclick="openTabCategoryLinkModal()" title="Automatically grant this tab to whoever holds a chosen Field Category — stays live as those grants change" class="px-3 py-2 border border-indigo-200 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-50 transition-all">Link Categories</button>
      </div>
      <div class="grid grid-cols-2 gap-2 mb-4" style="max-width:340px">
        <button onclick="openSummaryMergeModal()" title="Combine 2+ columns into one display cell, for viewing and printing only" class="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Merge Columns</button>
        <button onclick="openSummaryPrintModal()" class="px-3 py-2 bg-slate-800 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Print</button>
      </div>
      <div id="summaryCount" class="text-xs font-black text-slate-500 mb-2"></div>
      <div class="overflow-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-50"><tr id="summaryHeaders"></tr></thead>
          <tbody id="summaryBody"></tbody>
        </table>
      </div>
    `;
    lucide.createIcons();
    Object.assign(document.getElementById('summaryTabSelect'), {});
    const sel = document.getElementById('summaryTabSelect');
    sel.innerHTML = '<option value="">Select Target…</option><option value="info">General Info</option>' + _setupAllTabs.map(t => `<option value="${t.tab_name}">${t.tab_name}</option>`).join('');
    if (!_setupAllTabs.length) {
      _adminFetch('get_tabs', {}).then(tabs => {
        if (Array.isArray(tabs)) { _setupAllTabs = tabs; sel.innerHTML = '<option value="">Select Target…</option><option value="info">General Info</option>' + tabs.map(t => `<option value="${t.tab_name}">${t.tab_name}</option>`).join(''); }
      });
    }
  }

  function loadSummaryData() {
    const t = document.getElementById('summaryTabSelect').value;
    if (!t) return;
    const countEl = document.getElementById('summaryCount');
    if (countEl) countEl.textContent = '';
    _summaryColumnMerges = [];
    document.getElementById('summaryBody').innerHTML = '<tr><td colspan="100" class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></td></tr>';
    lucide.createIcons();
    _adminFetch('get_tab_data', { tab_name: t }).then(res => {
      _summaryData = { tab: t, headers: res.headers, rows: res.rows };
      renderSummaryTable();
      if (countEl) countEl.innerHTML = `${res.rows.length} student${res.rows.length === 1 ? '' : 's'} submitted "${t}"`;
    });
  }
  function renderSummaryTable() {
    if (!_summaryData) return;
    const { headers: dHeaders, rows: dRows } = applySummaryColumnMerges(_summaryData.headers, _summaryData.rows, _summaryColumnMerges);
    const tints = ['text-blue-600', 'text-indigo-600', 'text-violet-600', 'text-fuchsia-600', 'text-amber-600', 'text-cyan-600', 'text-teal-600', 'text-orange-600'];
    document.getElementById('summaryHeaders').innerHTML = dHeaders.map((h, i) => `<th class="py-2 px-3 text-[10px] font-black uppercase ${tints[i % 8]}">${h}</th>`).join('');
    document.getElementById('summaryBody').innerHTML = dRows.map(r => `<tr class="border-b border-slate-50 summary-row" data-search="${r.map(c => String(c ?? '')).join(' ').toLowerCase().replace(/"/g, '&quot;')}">${r.map((c, i) => `<td class="py-1.5 px-3 text-slate-600 font-bold">${c || ''}</td>`).join('')}</tr>`).join('');
  }
  function filterSummaryTable() {
    const q = (document.getElementById('summarySearch').value || '').toLowerCase();
    document.querySelectorAll('#summaryBody .summary-row').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  }
  function applySummaryColumnMerges(headers, rows, merges) {
    if (!merges || !merges.length) return { headers, rows };
    const groups = merges.map(m => ({ ...m, idxs: m.cols.map(c => headers.indexOf(c)).filter(i => i >= 0) })).filter(g => g.idxs.length >= 2);
    if (!groups.length) return { headers, rows };
    const anchorOf = {}; const dropSet = new Set();
    groups.forEach(g => { const anchor = Math.min(...g.idxs); anchorOf[anchor] = g; g.idxs.forEach(i => { if (i !== anchor) dropSet.add(i); }); });
    const dHeaders = []; const colPlan = [];
    headers.forEach((h, i) => {
      if (dropSet.has(i)) return;
      if (anchorOf[i]) { dHeaders.push(anchorOf[i].label); colPlan.push({ merge: anchorOf[i].idxs }); return; }
      dHeaders.push(h); colPlan.push({ idx: i });
    });
    const dRows = rows.map(r => colPlan.map(p => p.merge ? p.merge.map(i => r[i]).filter(v => v !== '' && v != null).join('<br>') : r[p.idx]));
    return { headers: dHeaders, rows: dRows };
  }
  function _prettySummaryHeader(h) { return String(h || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

  function openSummaryMergeModal() {
    if (!_summaryData) { showToast('Load a tab first', 'error'); return; }
    const opts = { headers: _summaryData.headers.filter(h => h !== 'student_id'), merges: _summaryColumnMerges };
    _activeSummaryMergeOpts = opts;
    document.getElementById('summaryMergeOverlay')?.remove();
    const usedCols = new Set(opts.merges.flatMap(m => m.cols));
    const available = opts.headers.filter(h => !usedCols.has(h));
    const overlay = document.createElement('div');
    overlay.id = 'summaryMergeOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-lg" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Merge Columns — ${_summaryData.tab}</p>
          <button onclick="document.getElementById('summaryMergeOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div id="summaryMergeChips" class="px-4 pt-4 pb-1 flex flex-wrap gap-2"></div>
        <div class="p-4 overflow-y-auto" style="flex:1">
          <input type="text" id="summaryMergeLabel" placeholder="Label for the merged column (optional)" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm mb-2">
          <div class="flex flex-col gap-1" style="max-height:280px;overflow-y:auto">
            ${available.length ? available.map(h => `<label class="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer"><input type="checkbox" class="summary-merge-check" value="${String(h).replace(/"/g, '&quot;')}">${h}</label>`).join('') : '<span class="text-xs text-slate-400 font-bold">No more columns available to merge.</span>'}
          </div>
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick="createSummaryColumnMerge()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Create Merge</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
    renderSummaryMergeChips();
  }
  function renderSummaryMergeChips() {
    const host = document.getElementById('summaryMergeChips');
    if (!host || !_activeSummaryMergeOpts) return;
    host.innerHTML = _activeSummaryMergeOpts.merges.map(m => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-[11px] font-bold">${m.label} · ${m.cols.length} cols <i data-lucide="x-circle" class="h-3 w-3 cursor-pointer" onclick="removeSummaryColumnMerge('${m.id}')"></i></span>`).join('');
    lucide.createIcons();
  }
  function createSummaryColumnMerge() {
    const label = document.getElementById('summaryMergeLabel').value.trim();
    const cols = Array.from(document.querySelectorAll('.summary-merge-check:checked')).map(c => c.value);
    if (cols.length < 2) { showToast('Pick at least 2 columns to merge', 'error'); return; }
    const finalLabel = label || cols.map(_prettySummaryHeader).join(' / ');
    _summaryColumnMerges = [..._summaryColumnMerges, { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), label: finalLabel, cols }];
    renderSummaryTable();
    openSummaryMergeModal();
  }
  function removeSummaryColumnMerge(id) {
    _summaryColumnMerges = _summaryColumnMerges.filter(m => m.id !== id);
    renderSummaryTable();
    openSummaryMergeModal();
  }

  function openSummaryPrintModal() {
    if (!_summaryData) { showToast('Load a tab first', 'error'); return; }
    const { headers: dHeaders } = applySummaryColumnMerges(_summaryData.headers, _summaryData.rows, _summaryColumnMerges);
    document.getElementById('summaryPrintOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'summaryPrintOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-sm" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Print — ${_summaryData.tab}</p>
          <button onclick="document.getElementById('summaryPrintOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="px-4 pt-3 flex gap-3">
          <button onclick="document.querySelectorAll('.summary-print-check').forEach(c=>c.checked=true)" class="text-[10px] font-black uppercase text-blue-600">Select all</button>
          <button onclick="document.querySelectorAll('.summary-print-check').forEach(c=>c.checked=false)" class="text-[10px] font-black uppercase text-slate-400">Clear</button>
        </div>
        <div class="p-4 overflow-y-auto flex flex-col gap-1" style="flex:1">
          ${dHeaders.map(h => `<label class="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer"><input type="checkbox" class="summary-print-check" value="${String(h).replace(/"/g, '&quot;')}" checked>${h}</label>`).join('')}
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick="printSummaryData()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Print</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
  }
  function printSummaryData() {
    const selected = Array.from(document.querySelectorAll('.summary-print-check:checked')).map(c => c.value);
    if (!selected.length) { showToast('Pick at least one column', 'error'); return; }
    document.getElementById('summaryPrintOverlay')?.remove();
    const { headers: dHeaders, rows: dRows } = applySummaryColumnMerges(_summaryData.headers, _summaryData.rows, _summaryColumnMerges);
    const idxs = selected.map(h => dHeaders.indexOf(h));
    const rows = dRows.map(r => idxs.map(i => r[i]));
    const tints = ['#dbeafe', '#e0e7ff', '#ede9fe', '#fae8ff', '#fef3c7', '#cffafe', '#ccfbf1', '#fed7aa'];
    const tintsCell = ['#eff6ff', '#eef2ff', '#f5f3ff', '#fdf4ff', '#fffbeb', '#ecfeff', '#f0fdfa', '#fff7ed'];
    const theadCells = selected.map((h, i) => `<th style="background:${tints[i % 8]};color:#1e293b;border:1px solid #cbd5e1;padding:5px 7px;font-size:9pt;text-transform:uppercase;letter-spacing:.04em;text-align:left">${h}</th>`).join('');
    const bodyRows = rows.map(r => `<tr>${r.map((c, i) => `<td style="background:${tintsCell[i % 8]};border:1px solid #cbd5e1;padding:4px 7px;font-size:9pt">${c === '' || c == null ? '&mdash;' : c}</td>`).join('')}</tr>`).join('');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${_summaryData.tab}</title>
      <style>@page{size:landscape;margin:10mm}body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0;padding:16px}table{border-collapse:collapse;width:100%}.print-meta{font-size:8pt;color:#64748b;margin-bottom:10px}h1{font-size:13pt;margin:0 0 2px}</style></head>
      <body><h1>${_summaryData.tab}</h1><div class="print-meta">Printed ${new Date().toLocaleString()} — ${rows.length} row${rows.length === 1 ? '' : 's'}</div><table><thead><tr>${theadCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'width=1100,height=750');
    if (!win) { showToast('Popup blocked — please allow popups for this site and try again', 'error'); URL.revokeObjectURL(url); return; }
    win.focus();
    setTimeout(() => { win.print(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 800);
  }

  function openTabAccessModal() {
    const tab = document.getElementById('summaryTabSelect').value;
    if (!tab) { showToast('Select a tab first', 'error'); return; }
    document.getElementById('tabAccessOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'tabAccessOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-lg" style="max-height:80vh;display:flex;flex-direction:column">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Data Access — ${tab}</p>
          <button onclick="document.getElementById('tabAccessOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-3 border-b border-slate-100"><input type="text" id="tabAccessFilter" placeholder="Search teachers/staff…" oninput="filterTabAccessList()" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-tab-access-filter"></div>
        <div id="tabAccessList" class="p-4 overflow-y-auto" style="flex:1"><div class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></div></div>
        <div class="p-4 border-t border-slate-100 flex justify-between items-center">
          <span class="text-xs text-slate-400 font-bold">Ticked people can view &amp; export this tab's data from their faculty portal profile.</span>
          <button onclick="saveTabAccess()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all shrink-0 ml-3">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
    Promise.all([_adminFetch('get_staff_list', {}), _adminFetch('get_tab_data_access', { tab_name: tab })]).then(([staff, access]) => {
      const granted = new Set((access && access.user_ids) || []);
      const list = document.getElementById('tabAccessList');
      if (!Array.isArray(staff) || !staff.length) { list.innerHTML = '<div class="text-xs text-slate-400 font-bold">No teacher/staff accounts found.</div>'; return; }
      list.innerHTML = staff.map(u => `
        <label class="tab-access-row flex items-center gap-2 py-1 text-xs" data-search="${String(u.user_id + ' ' + (u.email || '')).toLowerCase()}">
          <input type="checkbox" class="tab-access-check" value="${u.user_id}" ${granted.has(String(u.user_id)) ? 'checked' : ''}>
          <span class="font-bold text-slate-700">${u.user_id}</span>
          <span class="text-slate-400 truncate">${u.email || ''}</span>
          <span class="ml-auto px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-black shrink-0">${u.role || ''}</span>
        </label>`).join('');
    }).catch(() => { document.getElementById('tabAccessList').innerHTML = '<div class="text-xs text-red-500 font-bold">Could not load the staff list.</div>'; });
  }
  function filterTabAccessList() {
    const q = document.getElementById('tabAccessFilter').value.toLowerCase();
    document.querySelectorAll('.tab-access-row').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  }
  function saveTabAccess() {
    const tab = document.getElementById('summaryTabSelect').value;
    const ids = Array.from(document.querySelectorAll('.tab-access-check:checked')).map(c => c.value);
    _adminFetch('set_tab_data_access', { tab_name: tab, user_ids: ids }).then(res => {
      if (res && res.result === 'success') { showToast(`${res.count} people can now access "${tab}" data`); document.getElementById('tabAccessOverlay')?.remove(); }
      else showToast((res && res.message) || 'Save failed', 'error');
    }).catch(() => showToast('Network error', 'error'));
  }

  function openClassAccessModal() {
    const tab = document.getElementById('summaryTabSelect').value;
    if (!tab) { showToast('Select a tab first', 'error'); return; }
    _caTab = tab; _caSelectedUser = null;
    document.getElementById('classAccessOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'classAccessOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full" style="max-width:960px;max-height:85vh;display:flex;flex-direction:column">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Class Access — ${tab}</p>
          <button onclick="document.getElementById('classAccessOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div id="classAccessGrantees" class="px-4 pt-4 pb-2 flex flex-wrap gap-2"></div>
        <div class="grid md:grid-cols-2 gap-0" style="flex:1;min-height:0;border-top:1px solid #f1f5f9">
          <div class="flex flex-col border-r border-slate-100" style="min-height:0">
            <div class="p-3 border-b border-slate-100"><input type="text" id="classAccessFilter" placeholder="Search by name, ID, shortname or phone…" oninput="filterClassAccessStaff()" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-class-access-filter"></div>
            <div id="classAccessStaffList" class="p-2 overflow-y-auto" style="flex:1"><div class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></div></div>
          </div>
          <div class="p-4 overflow-y-auto" style="flex:1">
            <div id="classAccessSections"><div class="text-center text-xs text-slate-400 font-bold py-10">Pick a teacher on the left to assign class-sections.</div></div>
          </div>
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-between items-center">
          <span class="text-xs text-slate-400 font-bold">Pick a teacher, tick the class-sections they may see, then save — the list stays open so you can move on to the next teacher.</span>
          <button id="classAccessSaveBtn" onclick="saveClassAccess()" disabled class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all shrink-0 ml-3 disabled:opacity-40">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
    Promise.all([_adminFetch('get_staff_directory', {}), _adminFetch('get_class_sections', {}), _adminFetch('get_tab_class_access', { tab_name: tab })]).then(([staff, sections, access]) => {
      _caStaff = Array.isArray(staff) ? staff : [];
      _caClassSections = Array.isArray(sections) ? sections : [];
      _caGrants = {};
      ((access && access.grants) || []).forEach(g => { _caGrants[g.user_id] = g.class_sections || []; });
      renderClassAccessStaff();
      renderClassAccessGrantees();
    }).catch(() => { document.getElementById('classAccessStaffList').innerHTML = '<div class="text-xs text-red-500 font-bold">Could not load the staff directory.</div>'; });
  }
  function renderClassAccessStaff() {
    const list = document.getElementById('classAccessStaffList');
    if (!list) return;
    if (!_caStaff.length) { list.innerHTML = '<div class="text-xs text-slate-400 font-bold">No teacher/staff accounts found.</div>'; return; }
    list.innerHTML = _caStaff.map(u => {
      const search = [u.full_name, u.user_id, u.shortname, u.phone].filter(Boolean).join(' ').toLowerCase();
      const selected = _caSelectedUser === u.user_id;
      const grantCount = (_caGrants[u.user_id] || []).length;
      return `<div class="class-access-row py-1.5 px-2 rounded-lg mb-1 cursor-pointer ${selected ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}" data-uid="${u.user_id}" data-search="${search.replace(/"/g, '&quot;')}" onclick="selectClassAccessUser(this.dataset.uid)">
        <div class="flex justify-between items-start gap-2">
          <div class="truncate">
            <span class="font-black text-xs">${u.full_name || u.user_id}</span>
            ${u.shortname ? `<span class="text-[9px] font-black rounded px-1 py-0.5 ml-1 ${selected ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}">${u.shortname}</span>` : ''}
            <div class="text-[11px] ${selected ? 'text-white/80' : 'text-slate-400'}">${u.user_id}${u.phone ? ' · ' + u.phone : ''}</div>
          </div>
          ${grantCount ? `<span class="text-[9px] font-black rounded-full px-1.5 py-0.5 shrink-0 ${selected ? 'bg-white text-blue-600' : 'bg-emerald-500 text-white'}">${grantCount}</span>` : ''}
        </div>
      </div>`;
    }).join('');
    filterClassAccessStaff();
  }
  function filterClassAccessStaff() {
    const filterEl = document.getElementById('classAccessFilter');
    const q = filterEl ? filterEl.value.toLowerCase() : '';
    document.querySelectorAll('.class-access-row').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  }
  function renderClassAccessGrantees() {
    const host = document.getElementById('classAccessGrantees');
    if (!host) return;
    const grantees = Object.entries(_caGrants).filter(([, cs]) => cs.length);
    host.innerHTML = grantees.map(([uid, cs]) => {
      const person = _caStaff.find(s => s.user_id === uid);
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-[11px] font-bold">${(person && person.full_name) || uid} · ${cs.length} class${cs.length === 1 ? '' : 'es'} <i data-lucide="x-circle" class="h-3 w-3 cursor-pointer" onclick="removeClassAccess('${uid.replace(/'/g, "\\'")}')"></i></span>`;
    }).join('');
    lucide.createIcons();
  }
  function selectClassAccessUser(uid) {
    _caSelectedUser = uid;
    renderClassAccessStaff();
    const host = document.getElementById('classAccessSections');
    const saveBtn = document.getElementById('classAccessSaveBtn');
    if (saveBtn) saveBtn.disabled = false;
    const granted = new Set((_caGrants[uid] || []).map(cs => `${cs.class}|${cs.section}|${cs.group || 'None'}`));
    const person = _caStaff.find(s => s.user_id === uid);
    host.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs font-black text-slate-700">Class-sections for ${(person && person.full_name) || uid}</span>
        <span class="flex gap-2">
          <button onclick="toggleAllClassSections(true)" class="text-[10px] font-black uppercase text-blue-600">Select all</button>
          <button onclick="toggleAllClassSections(false)" class="text-[10px] font-black uppercase text-slate-400">Clear</button>
        </span>
      </div>
      <div class="grid grid-cols-2 gap-1">
        ${_caClassSections.map(cs => {
          const grp = cs.group || 'None';
          const key = `${cs.class}|${cs.section}|${grp}`;
          const label = grp !== 'None' ? `${cs.class}-${cs.section}-${grp}` : `${cs.class}-${cs.section}`;
          return `<label class="flex items-center gap-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg px-2 py-1 cursor-pointer">
            <input type="checkbox" class="class-section-check" value="${key.replace(/"/g, '&quot;')}" ${granted.has(key) ? 'checked' : ''}>${label}
          </label>`;
        }).join('')}
      </div>`;
  }
  function toggleAllClassSections(on) { document.querySelectorAll('.class-section-check').forEach(c => { c.checked = on; }); }
  function saveClassAccess() {
    if (!_caSelectedUser || !_caTab) return;
    const class_sections = Array.from(document.querySelectorAll('.class-section-check:checked')).map(c => { const [cls, sec, grp] = c.value.split('|'); return { class: cls, section: sec, group: grp }; });
    _adminFetch('set_tab_class_access', { tab_name: _caTab, user_id: _caSelectedUser, class_sections }).then(res => {
      if (res && res.result === 'success') { _caGrants[_caSelectedUser] = class_sections; renderClassAccessGrantees(); renderClassAccessStaff(); showToast(`${res.count} class-section${res.count === 1 ? '' : 's'} granted`); }
      else showToast((res && res.message) || 'Save failed', 'error');
    }).catch(() => showToast('Network error', 'error'));
  }
  function removeClassAccess(uid) {
    if (!_caTab || !uid) return;
    _adminFetch('set_tab_class_access', { tab_name: _caTab, user_id: uid, class_sections: [] }).then(res => {
      if (res && res.result === 'success') { delete _caGrants[uid]; renderClassAccessGrantees(); renderClassAccessStaff(); if (_caSelectedUser === uid) selectClassAccessUser(uid); showToast('Access revoked'); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Link Categories — a simpler, live alternative to manually managing
  // Data Access / Class Access for this one tab: whoever holds any ticked
  // Field Category (Access tab) automatically gets this tab's data too,
  // re-evaluated fresh on every request (see exec/route.js
  // getMyTabDataAccess/getTabDataForUser) rather than copied once, so it
  // stays current as those grants change — on top of whatever Data
  // Access/Class Access already grant, never replacing them.
  // ══════════════════════════════════════════════════════════════════════
  function openTabCategoryLinkModal() {
    const tab = document.getElementById('summaryTabSelect').value;
    if (!tab) { showToast('Select a tab first', 'error'); return; }
    document.getElementById('tabCategoryLinkOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'tabCategoryLinkOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md" style="max-height:80vh;display:flex;flex-direction:column">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Link to Categories — ${tab}</p>
          <button onclick="document.getElementById('tabCategoryLinkOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <p class="text-xs text-slate-400 font-bold px-4 pt-4">Whoever holds a ticked category automatically gets this tab's data too — live, on top of whatever Data Access / Class Access already grant.</p>
        <div id="tabCategoryLinkList" class="p-4 overflow-y-auto flex flex-col gap-1.5" style="flex:1"><div class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></div></div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick="saveTabCategoryLink()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
    Promise.all([_adminFetch('get_field_categories', {}), _adminFetch('get_tab_category_link', { tab_name: tab })]).then(([catsRes, linkRes]) => {
      const cats = (catsRes && catsRes.result === 'success' && catsRes.categories) || [];
      const linked = new Set((linkRes && linkRes.categories) || []);
      const list = document.getElementById('tabCategoryLinkList');
      list.innerHTML = cats.length ? cats.map(c => `<label class="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 cursor-pointer"><input type="checkbox" class="tab-cat-link-check" value="${c.name.replace(/"/g, '&quot;')}" ${linked.has(c.name) ? 'checked' : ''}>${c.name}</label>`).join('') : '<span class="text-xs text-slate-400 font-bold italic">No field categories exist yet — create one in Access first.</span>';
    }).catch(() => { document.getElementById('tabCategoryLinkList').innerHTML = '<div class="text-xs text-red-500 font-bold">Could not load categories.</div>'; });
  }
  function saveTabCategoryLink() {
    const tab = document.getElementById('summaryTabSelect').value;
    if (!tab) return;
    const categories = Array.from(document.querySelectorAll('.tab-cat-link-check:checked')).map(c => c.value);
    _adminFetch('set_tab_category_link', { tab_name: tab, categories }).then(res => {
      if (res && res.result === 'success') {
        document.getElementById('tabCategoryLinkOverlay')?.remove();
        showToast(res.count ? `Linked to ${res.count} categor${res.count === 1 ? 'y' : 'ies'}` : 'Category link cleared');
      } else showToast((res && res.message) || 'Save failed', 'error');
    });
  }

  function exportSummaryData() {
    const tab = document.getElementById('summaryTabSelect').value;
    if (!tab) return;
    _adminFetch('get_tab_data', { tab_name: tab }).then(res => {
      const csv = res.headers.join(',') + '\n' + res.rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${tab}_export.csv`;
      a.click();
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // History tab — native port (Phase 6, part 2). Read-only search over the
  // student edit_history log.
  // ══════════════════════════════════════════════════════════════════════

  let _historyDebounce = null;

  function loadAdminHistoryView() {
    if (!(window._adminTabAccess || []).includes('history')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-history');
    setContentHeader('History', 'clock');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Edit History</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Every change to a student's record, logged automatically</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
        <input type="text" id="historySearch" placeholder="Search Student ID, name, class, section, roll…" oninput="debounceLoadEditHistory()" class="md:col-span-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-history-search">
        <button onclick="loadEditHistory()" class="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Search</button>
      </div>
      <div id="historyCount" class="text-xs font-black text-slate-500 mb-2"></div>
      <div class="overflow-auto border border-slate-200 rounded-xl">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-50"><tr>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">Student ID</th>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">Name</th>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">Class</th>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">Section</th>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">Roll</th>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">Changes</th>
            <th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">When</th>
          </tr></thead>
          <tbody id="historyBody"></tbody>
        </table>
      </div>
    `;
    lucide.createIcons();
    loadEditHistory();
  }
  function debounceLoadEditHistory() {
    if (_historyDebounce) clearTimeout(_historyDebounce);
    _historyDebounce = setTimeout(loadEditHistory, 350);
  }
  function loadEditHistory() {
    const q = (document.getElementById('historySearch') || {}).value || '';
    const body = document.getElementById('historyBody');
    const countEl = document.getElementById('historyCount');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></td></tr>';
    lucide.createIcons();
    _adminFetch('search_edit_history', { query: q }).then(res => {
      if (!res || res.result !== 'success') { body.innerHTML = `<tr><td colspan="7" class="text-center text-red-500 font-bold p-6">${(res && res.message) || 'Could not load history'}</td></tr>`; return; }
      const rows = res.rows || [];
      if (countEl) countEl.textContent = `${rows.length} edit${rows.length === 1 ? '' : 's'}${q ? ` matching "${q}"` : ''}`;
      if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 font-bold p-6">No edits found.</td></tr>'; return; }
      body.innerHTML = rows.map(r => {
        const changes = Object.entries(r.edited_history || {}).map(([field, d]) => {
          if (d && d.changed) return `<span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold mr-1 mb-1">${field}: changed</span>`;
          const oldV = (d && d.old != null) ? String(d.old) : '—';
          const newV = (d && d.new != null) ? String(d.new) : '—';
          return `<span class="inline-block px-2 py-0.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-full text-[10px] font-bold mr-1 mb-1" title="${field}">${field}: ${oldV} → ${newV}</span>`;
        }).join(' ');
        const when = r.created_at ? new Date(r.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `<tr class="border-b border-slate-50">
          <td class="py-1.5 px-3 font-black text-slate-700">${r.student_id || ''}</td>
          <td class="py-1.5 px-3 text-slate-600 font-bold">${r.name || ''}</td>
          <td class="py-1.5 px-3 text-slate-600 font-bold">${r.class || ''}</td>
          <td class="py-1.5 px-3 text-slate-600 font-bold">${r.section || ''}</td>
          <td class="py-1.5 px-3 text-slate-600 font-bold">${r.roll || ''}</td>
          <td class="py-1.5 px-3" style="max-width:420px">${changes || '—'}</td>
          <td class="py-1.5 px-3 text-slate-400 font-bold whitespace-nowrap">${when}</td>
        </tr>`;
      }).join('');
    }).catch(() => { body.innerHTML = '<tr><td colspan="7" class="text-center text-red-500 font-bold p-6">Network error</td></tr>'; });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Photo tab — native port (Phase 6, part 2). Admin-side profile-photo
  // upload for a looked-up student; canvas center-crop + JPEG compression
  // (<=130KB) carried over unchanged from the original.
  // ══════════════════════════════════════════════════════════════════════

  let _photoStudentId = null;

  function loadAdminPhotoView() {
    if (!(window._adminTabAccess || []).includes('photo')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-photo');
    setContentHeader('Photo', 'camera');
    const container = document.getElementById('view-container');
    if (!container) return;
    _photoStudentId = null;
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Student Photo</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Look up a student, then upload or replace their profile photo</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4" style="max-width:560px">
        <input type="text" id="photoStudentId" placeholder="Student ID" onkeydown="if(event.key==='Enter')loadStudentForPhoto()" class="md:col-span-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
        <button onclick="loadStudentForPhoto()" class="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Load</button>
      </div>
      <div id="photoStudentCard" class="hidden bg-white rounded-3xl border border-slate-200 shadow-sm p-6" style="max-width:420px">
        <div class="flex items-center gap-3 mb-4">
          <div id="photoAvatar" class="rounded-full shrink-0 flex items-center justify-center text-white font-black text-xl" style="width:72px;height:72px;background:linear-gradient(135deg,#2563eb,#60a5fa);background-size:cover;background-position:center"></div>
          <div>
            <div id="photoStudentName" class="font-black text-slate-800"></div>
            <div id="photoStudentMeta" class="text-xs text-slate-400 font-bold"></div>
          </div>
        </div>
        <input type="file" id="photoFileInput" accept="image/*" class="hidden" onchange="handleStudentPhotoSelect(event)">
        <button onclick="document.getElementById('photoFileInput').click()" class="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Upload / Change Photo</button>
        <div id="photoStatus" class="text-center text-xs font-bold mt-2"></div>
      </div>
    `;
    lucide.createIcons();
  }
  function _renderPhotoAvatar(student) {
    const el = document.getElementById('photoAvatar');
    if (!el) return;
    if (student.photo) { el.style.backgroundImage = `url('${student.photo}')`; el.textContent = ''; }
    else { el.style.backgroundImage = ''; el.textContent = (student.student_name || student.student_id || '?').trim().charAt(0).toUpperCase(); }
  }
  function loadStudentForPhoto() {
    const sid = (document.getElementById('photoStudentId') || {}).value.trim();
    const card = document.getElementById('photoStudentCard');
    const status = document.getElementById('photoStatus');
    if (!sid) return;
    if (status) { status.className = 'text-center text-xs font-bold mt-2'; status.textContent = ''; }
    _adminFetch('get_student_basic', { student_id: sid }).then(res => {
      if (!res || res.result !== 'success') {
        if (card) card.classList.add('hidden');
        if (status) { status.className = 'text-center text-xs font-bold mt-2 text-red-500'; status.textContent = (res && res.message) || 'Student not found.'; }
        return;
      }
      _photoStudentId = res.student.student_id;
      document.getElementById('photoStudentName').textContent = res.student.student_name || res.student.student_id;
      document.getElementById('photoStudentMeta').textContent = [res.student.class, res.student.section, res.student.roll ? `Roll ${res.student.roll}` : ''].filter(Boolean).join(' · ');
      _renderPhotoAvatar(res.student);
      if (card) card.classList.remove('hidden');
    }).catch(err => {
      if (card) card.classList.add('hidden');
      if (status) { status.className = 'text-center text-xs font-bold mt-2 text-red-500'; status.textContent = (err && err.message) || 'Network error.'; }
    });
  }
  function handleStudentPhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5 MB', 'error'); event.target.value = ''; return; }
    if (!_photoStudentId) return;
    const status = document.getElementById('photoStatus');
    if (status) { status.className = 'text-center text-xs font-bold mt-2 text-slate-400'; status.textContent = 'Processing...'; }
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        const side = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - side) / 2);
        const sy = Math.floor((img.height - side) / 2);
        const canvasPx = Math.min(side, 500);
        const canvas = document.createElement('canvas');
        canvas.width = canvasPx; canvas.height = canvasPx;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, canvasPx, canvasPx);
        const TARGET = 130 * 1024;
        let base64 = '';
        for (const q of [0.85, 0.70, 0.55, 0.40, 0.28]) {
          base64 = canvas.toDataURL('image/jpeg', q);
          const approxBytes = Math.ceil((base64.length - base64.indexOf(',') - 1) * 0.75);
          if (approxBytes <= TARGET) break;
        }
        const finalBytes = Math.ceil((base64.length - base64.indexOf(',') - 1) * 0.75);
        if (finalBytes > TARGET) {
          if (status) { status.className = 'text-center text-xs font-bold mt-2 text-red-500'; status.textContent = 'Could not compress under 130KB — use a smaller image.'; }
          return;
        }
        if (status) { status.className = 'text-center text-xs font-bold mt-2 text-slate-400'; status.textContent = 'Uploading...'; }
        _adminFetch('upload_photo', { student_id: _photoStudentId, photo_base64: base64 }).then(res => {
          if (!res || res.result !== 'success') { if (status) { status.className = 'text-center text-xs font-bold mt-2 text-red-500'; status.textContent = (res && res.message) || 'Upload failed.'; } return; }
          _renderPhotoAvatar({ photo: res.photo, student_name: document.getElementById('photoStudentName').textContent });
          if (status) { status.className = 'text-center text-xs font-bold mt-2 text-emerald-600'; status.textContent = 'Photo saved!'; }
        }).catch(err => { if (status) { status.className = 'text-center text-xs font-bold mt-2 text-red-500'; status.textContent = (err && err.message) || 'Network error.'; } });
      };
      img.onerror = function () { if (status) { status.className = 'text-center text-xs font-bold mt-2 text-red-500'; status.textContent = 'Could not read image file.'; } };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Notices tab — native port (Phase 6, part 2). Login-page carousel
  // notices — each with raw-HTML Title/Subtitle/Body and a live preview.
  // ══════════════════════════════════════════════════════════════════════

  let ADMIN_NOTICES = [];

  function loadAdminNoticesView() {
    if (!(window._adminTabAccess || []).includes('notices')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-notices');
    setContentHeader('Notices', 'megaphone');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight">Login Page Notices</h2>
          <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Sliding carousel above the sign-in form</p>
        </div>
        <button onclick="addNoticeRow()" class="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all shrink-0">+ Add Notice</button>
      </div>
      <p class="text-xs text-slate-400 font-bold mb-4">Each notice has its own Title, Subtitle and Body — write raw HTML (e.g. &lt;span style="color:red"&gt;text&lt;/span&gt;) for full control over color, font and style per word or letter.</p>
      <div id="noticesAdminList" class="flex flex-col gap-4"></div>
    `;
    lucide.createIcons();
    loadNoticesAdmin();
  }
  function loadNoticesAdmin() {
    _adminFetch('get_notices_admin', {}).then(rows => {
      ADMIN_NOTICES = Array.isArray(rows) ? rows : [];
      renderNoticesAdmin();
    }).catch(() => {});
  }
  function renderNoticesAdmin() {
    const list = document.getElementById('noticesAdminList');
    if (!list) return;
    if (!ADMIN_NOTICES.length) { list.innerHTML = '<div class="text-center text-slate-400 font-bold text-xs italic py-10">No notices yet — click "+ Add Notice" to create the first slide.</div>'; return; }
    list.innerHTML = ADMIN_NOTICES.map((n, i) => `
      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-5" data-notice-idx="${i}">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Notice ${i + 1}</span>
          <div class="flex items-center gap-2">
            <button onclick="moveNotice(${i},-1)" ${i === 0 ? 'disabled' : ''} title="Move up" class="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30"><i data-lucide="arrow-up" class="h-3.5 w-3.5"></i></button>
            <button onclick="moveNotice(${i},1)" ${i === ADMIN_NOTICES.length - 1 ? 'disabled' : ''} title="Move down" class="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30"><i data-lucide="arrow-down" class="h-3.5 w-3.5"></i></button>
            <label class="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase ml-2"><input type="checkbox" class="notice-enabled" ${n.is_enabled ? 'checked' : ''} onchange="previewNotice(${i})">Shown</label>
            <button onclick="deleteNoticeRow(${i}, ${n.id || 'null'})" class="p-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 ml-2"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
          </div>
        </div>
        <div class="grid md:grid-cols-2 gap-3">
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Title (HTML)</label>
            <input type="text" class="notice-title w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm" placeholder="e.g. <i>Exam</i> Routine Published" value="${(n.title || '').replace(/"/g, '&quot;')}" oninput="previewNotice(${i})"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Subtitle (HTML, optional)</label>
            <input type="text" class="notice-subtitle w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm" placeholder="e.g. GENERAL NOTICE" value="${(n.subtitle || '').replace(/"/g, '&quot;')}" oninput="previewNotice(${i})"></div>
          <div class="md:col-span-2"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Body (HTML)</label>
            <textarea class="notice-body w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm" rows="3" placeholder="e.g. Half-yearly exam routine is out." oninput="previewNotice(${i})">${n.body || ''}</textarea></div>
        </div>
        <div class="mt-3">
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Live Preview</div>
          <div class="rounded-2xl p-5" style="background:linear-gradient(135deg,#1e293b,#334155)">
            <div id="noticePreview${i}" class="text-white"></div>
          </div>
        </div>
        <button onclick="saveNoticeRow(${i})" class="w-full py-2.5 mt-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Save Notice</button>
      </div>`).join('');
    lucide.createIcons();
    ADMIN_NOTICES.forEach((_, i) => previewNotice(i));
  }
  function noticeRowValues(i) {
    const card = document.querySelector(`[data-notice-idx="${i}"]`);
    if (!card) return null;
    return {
      title: card.querySelector('.notice-title').value,
      subtitle: card.querySelector('.notice-subtitle').value,
      body: card.querySelector('.notice-body').value,
      is_enabled: card.querySelector('.notice-enabled').checked,
    };
  }
  function previewNotice(i) {
    const v = noticeRowValues(i);
    const el = document.getElementById('noticePreview' + i);
    if (!v || !el) return;
    el.innerHTML = `
      ${v.title ? `<div class="text-lg font-black mb-1">${v.title}</div>` : ''}
      ${v.subtitle ? `<div class="text-[10px] font-black uppercase tracking-widest text-white/60 mb-2">${v.subtitle}</div>` : ''}
      ${v.body ? `<div class="text-sm text-white/90">${v.body}</div>` : ''}`;
  }
  function addNoticeRow() {
    ADMIN_NOTICES.push({ id: null, title: '', subtitle: '', body: '', is_enabled: true });
    renderNoticesAdmin();
  }
  function saveNoticeRow(i) {
    const v = noticeRowValues(i);
    const n = ADMIN_NOTICES[i];
    if (!v) return;
    _adminFetch('save_notice', { id: n.id, ...v }).then(res => {
      if (res.id) n.id = res.id;
      Object.assign(n, v);
      showToast('Notice saved');
    }).catch(err => showToast((err && err.message) || 'Save failed', 'error'));
  }
  function deleteNoticeRow(i, id) {
    if (!confirm('Delete this notice?')) return;
    const remove = () => { ADMIN_NOTICES.splice(i, 1); renderNoticesAdmin(); };
    if (!id) { remove(); return; }
    _adminFetch('delete_notice', { id }).then(() => remove()).catch(() => showToast('Delete failed', 'error'));
  }
  function moveNotice(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= ADMIN_NOTICES.length) return;
    [ADMIN_NOTICES[i], ADMIN_NOTICES[j]] = [ADMIN_NOTICES[j], ADMIN_NOTICES[i]];
    renderNoticesAdmin();
    const ids = ADMIN_NOTICES.map(n => n.id).filter(Boolean);
    if (ids.length) _adminFetch('reorder_notices', { ids }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════
  // Import tab — native port (Phase 6, part 2). Bulk Excel/CSV import of
  // new students, with column mapping + preview + confirm. xlsx parser is
  // loaded on demand from CDN, same as the original.
  // ══════════════════════════════════════════════════════════════════════

  const IMPORT_LABELS = {
    student_id: 'Student ID', student_name: 'Student Name', class: 'Class', section: 'Section',
    roll: 'Roll', gender: 'Gender', version: 'Version', shift: 'Shift', phone_number: 'Student Phone',
    father_phone: "Father's Phone", mother_phone: "Mother's Phone", nfc_uid: 'NFC UID',
    fathers_name: "Father's Name", mothers_name: "Mother's Name", nick_name: 'Nick Name',
    house: 'House', blood: 'Blood Group', balance: 'Wallet Balance', daily_limit: 'Daily Limit',
    monthly_limit: 'Monthly Limit', card_status: 'Card Status', photo: 'Photo URL', session: 'Session',
  };
  let IMPORT_DB_COLUMNS = [];
  let IMPORT_EXCEL_HEADERS = [];
  let IMPORT_EXCEL_ROWS = [];

  function loadAdminImportView() {
    if (!(window._adminTabAccess || []).includes('import')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-import');
    setContentHeader('Import', 'file-spreadsheet');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Bulk Import Students</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Match columns, then add only students whose ID doesn't already exist</p>
      </div>
      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 mb-4">
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step 1 · Choose File</span>
          <input type="file" id="importFileInput" accept=".xlsx,.xls,.csv" class="text-xs font-bold" style="max-width:320px">
          <span id="importFileStatus" class="text-xs text-slate-400 font-bold"></span>
          <button onclick="downloadImportDemoTemplate()" class="ml-auto px-3 py-2 border border-emerald-200 text-emerald-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-50 transition-all flex items-center gap-1.5 shrink-0"><i data-lucide="download" class="h-3.5 w-3.5"></i>Download Demo CSV</button>
        </div>
        <p class="text-xs text-slate-400 font-bold mt-2">Not sure what format to use? Download the demo file — its column headers exactly match what this importer auto-detects, so filling it in and re-uploading maps everything automatically.</p>
      </div>
      <div id="importMappingSection" class="hidden bg-white rounded-3xl border border-slate-200 shadow-sm p-5 mb-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step 2 · Match Columns</span>
          <span id="importRowCount" class="text-xs text-slate-400 font-bold"></span>
        </div>
        <p class="text-xs text-slate-400 font-bold mb-3">For each database column, pick the matching column from your file. Leave as "— Skip —" to leave it blank. <strong>Student ID</strong> is required.</p>
        <div id="importMappingList" class="flex flex-col gap-2"></div>
        <label class="flex items-center gap-2 mt-4 mb-2 text-xs font-bold text-slate-600"><input type="checkbox" id="importUpdateExisting">Also update students whose Student ID already exists (fills in the mapped columns for them instead of skipping)</label>
        <button onclick="previewBulkImport()" class="px-4 py-2.5 bg-slate-800 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all mt-2">Preview Import</button>
      </div>
      <div id="importPreviewSection" class="hidden bg-white rounded-3xl border border-slate-200 shadow-sm p-5 mb-4">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step 3 · Review &amp; Import</span>
        <div id="importPreviewSummary" class="grid grid-cols-2 md:grid-cols-4 gap-3 my-3"></div>
        <button id="importConfirmBtn" onclick="confirmBulkImport()" class="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Import New Students</button>
      </div>
      <div id="importResultSection" class="hidden bg-white rounded-3xl border border-slate-200 shadow-sm p-5"></div>
    `;
    lucide.createIcons();
    initBulkImport();
  }
  function initBulkImport() {
    _adminFetch('get_student_data_headers', {}).then(cols => {
      IMPORT_DB_COLUMNS = (Array.isArray(cols) ? cols : []).filter(c => c !== 'id');
    }).catch(() => {});
    const input = document.getElementById('importFileInput');
    if (input) input.addEventListener('change', handleImportFile);
  }

  // Same header set the "Match Columns" step auto-detects by name — so a
  // demo file downloaded here, filled in, and re-uploaded maps every column
  // automatically with no manual matching needed.
  const IMPORT_DEMO_SAMPLES = {
    student_id: '2026001', student_name: 'Jane Doe', class: 'Six', section: 'A', roll: '1',
    gender: 'Female', version: 'English', shift: 'Morning', phone_number: '01700000000',
    father_phone: '01700000001', mother_phone: '01700000002', nfc_uid: '',
    fathers_name: 'John Doe', mothers_name: 'Mary Doe', nick_name: 'Jane',
    house: 'Red', blood: 'O+', balance: '0', daily_limit: '0', monthly_limit: '0',
    card_status: '', photo: '', session: '2026',
  };
  function downloadImportDemoTemplate() {
    const build = () => {
      const cols = IMPORT_DB_COLUMNS.length ? IMPORT_DB_COLUMNS : Object.keys(IMPORT_LABELS);
      const headerRow = cols.map(c => IMPORT_LABELS[c] || c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()));
      const sampleRow = cols.map(c => IMPORT_DEMO_SAMPLES[c] ?? '');
      const csv = [headerRow, sampleRow].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'student_import_template.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    if (IMPORT_DB_COLUMNS.length) { build(); return; }
    _adminFetch('get_student_data_headers', {}).then(cols => {
      IMPORT_DB_COLUMNS = (Array.isArray(cols) ? cols : []).filter(c => c !== 'id');
      build();
    }).catch(() => showToast('Could not load column list', 'error'));
  }
  function normImportKey(s) { return String(s || '').toLowerCase().replace(/[\s_-]/g, ''); }
  function ensureXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('Could not load the Excel reader — check your connection and retry.'));
      document.head.appendChild(sc);
    });
  }
  function handleImportFile(e) {
    const file = e.target.files[0];
    const status = document.getElementById('importFileStatus');
    ['importMappingSection', 'importPreviewSection', 'importResultSection'].forEach(id => document.getElementById(id).classList.add('hidden'));
    if (!file) return;
    if (status) status.textContent = 'Reading file…';
    const reader = new FileReader();
    reader.onload = (evt) => {
      ensureXLSX().then(() => {
        try {
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (!grid.length) { if (status) status.textContent = 'File appears to be empty.'; return; }
          IMPORT_EXCEL_HEADERS = grid[0].map(h => String(h || '').trim());
          IMPORT_EXCEL_ROWS = grid.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
          if (status) status.textContent = `${file.name} — ${IMPORT_EXCEL_ROWS.length} rows, ${IMPORT_EXCEL_HEADERS.length} columns.`;
          renderImportMapping();
        } catch (err) {
          if (status) status.textContent = 'Could not read this file: ' + err.message;
        }
      }).catch((err) => { if (status) status.textContent = err.message; });
    };
    reader.readAsArrayBuffer(file);
  }
  function renderImportMapping() {
    const section = document.getElementById('importMappingSection');
    const list = document.getElementById('importMappingList');
    const rowCount = document.getElementById('importRowCount');
    if (!section || !list) return;
    rowCount.textContent = `${IMPORT_EXCEL_ROWS.length} rows detected`;
    list.innerHTML = IMPORT_DB_COLUMNS.map(col => {
      const label = IMPORT_LABELS[col] || col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const guessIdx = IMPORT_EXCEL_HEADERS.findIndex(h => normImportKey(h) === normImportKey(col) || normImportKey(h) === normImportKey(label));
      const required = col === 'student_id';
      const options = ['<option value="-1">— Skip —</option>'].concat(IMPORT_EXCEL_HEADERS.map((h, i) => `<option value="${i}" ${i === guessIdx ? 'selected' : ''}>${h || '(blank header)'}</option>`));
      const sample = guessIdx >= 0 && IMPORT_EXCEL_ROWS[0] ? String(IMPORT_EXCEL_ROWS[0][guessIdx] ?? '') : '';
      return `<div class="grid grid-cols-12 gap-2 items-center py-1 import-map-row" data-col="${col}">
        <div class="col-span-3"><span class="font-bold text-xs text-slate-700">${label}${required ? ' <span class="text-red-500">*</span>' : ''}</span></div>
        <div class="col-span-5"><select class="import-map-select w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs" onchange="updateImportSample(this)">${options.join('')}</select></div>
        <div class="col-span-4"><span class="text-xs text-slate-400 italic import-map-sample">${sample ? 'e.g. ' + sample : ''}</span></div>
      </div>`;
    }).join('');
    section.classList.remove('hidden');
    document.getElementById('importPreviewSection').classList.add('hidden');
    document.getElementById('importResultSection').classList.add('hidden');
  }
  function updateImportSample(sel) {
    const idx = parseInt(sel.value, 10);
    const sampleEl = sel.closest('.import-map-row').querySelector('.import-map-sample');
    const sample = idx >= 0 && IMPORT_EXCEL_ROWS[0] ? String(IMPORT_EXCEL_ROWS[0][idx] ?? '') : '';
    sampleEl.textContent = sample ? 'e.g. ' + sample : '';
  }
  function getImportMapping() {
    const mapping = {};
    document.querySelectorAll('.import-map-row').forEach(row => {
      const col = row.dataset.col;
      const idx = parseInt(row.querySelector('.import-map-select').value, 10);
      if (idx >= 0) mapping[col] = idx;
    });
    return mapping;
  }
  function buildMappedImportRows() {
    const mapping = getImportMapping();
    return IMPORT_EXCEL_ROWS.map(r => {
      const obj = {};
      Object.entries(mapping).forEach(([col, idx]) => { obj[col] = String(r[idx] ?? '').trim(); });
      return obj;
    });
  }
  function previewBulkImport() {
    const mapping = getImportMapping();
    if (!('student_id' in mapping)) { showToast('Map a column to Student ID first', 'error'); return; }
    const rows = buildMappedImportRows();
    const ids = rows.map(r => r.student_id).filter(Boolean);
    _adminFetch('preview_bulk_import', { student_ids: ids }).then(res => {
      if (!res || res.result !== 'success') { showToast((res && res.message) || 'Preview failed', 'error'); return; }
      const noIdCount = rows.length - ids.length;
      const updateExisting = document.getElementById('importUpdateExisting').checked;
      const summary = document.getElementById('importPreviewSummary');
      const existingLabel = updateExisting ? 'Already Exists (will update)' : 'Already Exists (skip)';
      const existingColor = updateExisting ? 'text-blue-600' : 'text-amber-600';
      summary.innerHTML = `
        <div class="p-3 border border-slate-200 rounded-xl"><div class="text-[10px] font-black text-slate-400 uppercase">Total Rows</div><div class="text-xl font-black text-slate-800">${rows.length}</div></div>
        <div class="p-3 border border-slate-200 rounded-xl"><div class="text-[10px] font-black text-slate-400 uppercase">New (will import)</div><div class="text-xl font-black text-emerald-600">${res.newCount}</div></div>
        <div class="p-3 border border-slate-200 rounded-xl"><div class="text-[10px] font-black text-slate-400 uppercase">${existingLabel}</div><div class="text-xl font-black ${existingColor}">${res.existingCount}</div></div>
        <div class="p-3 border border-slate-200 rounded-xl"><div class="text-[10px] font-black text-slate-400 uppercase">Missing Student ID</div><div class="text-xl font-black text-red-500">${noIdCount}</div></div>`;
      const confirmBtn = document.getElementById('importConfirmBtn');
      const totalAction = res.newCount + (updateExisting ? res.existingCount : 0);
      confirmBtn.disabled = totalAction === 0;
      confirmBtn.textContent = totalAction === 0 ? 'Nothing to import' : updateExisting ? `Import ${res.newCount} New + Update ${res.existingCount} Existing` : `Import ${res.newCount} New Student${res.newCount === 1 ? '' : 's'}`;
      document.getElementById('importPreviewSection').classList.remove('hidden');
      document.getElementById('importResultSection').classList.add('hidden');
    }).catch(err => showToast((err && err.message) || 'Network error during preview', 'error'));
  }
  function confirmBulkImport() {
    const rows = buildMappedImportRows();
    const updateExisting = document.getElementById('importUpdateExisting').checked;
    const btn = document.getElementById('importConfirmBtn');
    const confirmMsg = updateExisting
      ? 'Import new students AND update existing students with the mapped columns from this file?'
      : 'Import new students now? Existing Student IDs will be left untouched.';
    if (!confirm(confirmMsg)) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
    _adminFetch('bulk_import_new_students', { rows, update_existing: updateExisting }).then(res => {
      if (!res || (res.result !== 'success' && res.result !== 'partial')) {
        if (btn) { btn.disabled = false; btn.textContent = 'Retry Import'; }
        showToast((res && res.message) || 'Import failed', 'error');
        return;
      }
      const resultSection = document.getElementById('importResultSection');
      resultSection.innerHTML = `
        <h3 class="font-black text-slate-800 mb-3">Import Complete</h3>
        <ul class="text-xs font-bold text-slate-600 space-y-1 list-disc pl-4">
          <li>${res.inserted} new student(s) added</li>
          ${updateExisting ? `<li>${res.updated} existing student(s) updated</li>` : `<li>${res.skipped_existing} skipped — Student ID already exists</li>`}
          <li>${res.skipped_missing_id} skipped — missing Student ID</li>
          <li>${res.skipped_duplicate_in_file} skipped — duplicate Student ID within the file</li>
        </ul>
        ${res.errors && res.errors.length ? `<div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-700">Some batches failed: ${res.errors.join('; ')}</div>` : ''}`;
      resultSection.classList.remove('hidden');
      if (btn) { btn.disabled = true; btn.textContent = 'Done'; }
      showToast(updateExisting ? `Imported ${res.inserted} new, updated ${res.updated} existing` : `Imported ${res.inserted} new student(s)`);
    }).catch(err => {
      if (btn) { btn.disabled = false; btn.textContent = 'Retry Import'; }
      showToast((err && err.message) || 'Network error during import', 'error');
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Viewer Panel — native port (Phase 7). The restricted read-only/limited-
  // edit console for a non-admin field-category grantee (never a full
  // Admin/Student Portal Admin, never an ERP-tab grantee — those two cases
  // are handled by loadAdminAccessView / the ERP subnav respectively).
  // Reached only via _studentPortalNavClick, never via ADMIN_SUBNAV_ITEMS.
  // ══════════════════════════════════════════════════════════════════════

  let _vwAccess = null;

  function loadViewerPanelView() {
    _setViewHash('student_portal');
    setActiveNavLink('nav-student-portal');
    setContentHeader('Student Data Viewer', 'eye');
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `<div class="text-center p-10"><i data-lucide="loader-2" class="h-6 w-6 animate-spin inline text-blue-600"></i></div>`;
    lucide.createIcons();
    _adminFetch('get_my_access', {}).then(res => {
      const hasFieldAccess = res && res.result === 'success' && Array.isArray(res.fields) && res.fields.length;
      const hasClassAccess = res && res.result === 'success' && Array.isArray(res.classAccess) && res.classAccess.length;
      if (!hasFieldAccess && !hasClassAccess) {
        container.innerHTML = `<div class="text-center p-10 text-slate-400 font-bold text-sm">Your account does not have Student Portal admin access.</div>`;
        return;
      }
      _vwAccess = res;
      _renderViewerPanel();
    }).catch(() => { container.innerHTML = `<div class="text-center p-10 text-red-500 font-bold text-sm">Could not load your access — check your connection and reload.</div>`; });
  }
  function _renderViewerPanel() {
    const container = document.getElementById('view-container');
    if (!container || !_vwAccess) return;
    const fields = _vwAccess.fields || [];
    const categories = _vwAccess.categories || [];
    const classAccess = _vwAccess.classAccess || [];
    const canEdit = (_vwAccess.editable_fields || []).length > 0 || classAccess.some(g => g.can_edit);
    setContentHeader(`Student Data ${canEdit ? 'Viewer & Editor' : 'Viewer'}`, 'eye');
    const grantedScopeText = classAccess.map(g => g.group && g.group !== 'None' ? `${g.class}-${g.section}-${g.group}` : `${g.class}-${g.section}`).join(', ');
    container.innerHTML = `
      <div class="mb-4">
        <h2 class="text-2xl font-black text-slate-800 tracking-tight">Student Data ${canEdit ? 'Viewer &amp; Editor' : 'Viewer'}</h2>
        <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
          ${categories.length ? `Categories: ${categories.join(', ')}` : ''}${categories.length && classAccess.length ? ' · ' : ''}${classAccess.length ? `Full access: ${grantedScopeText}` : ''}
        </p>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
        <input type="text" id="vwSearchId" placeholder="Student ID" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-vw-search-id">
        <input type="text" id="vwSearchClass" placeholder="Class" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-vw-search-class">
        <input type="text" id="vwSearchSection" placeholder="Section" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-vw-search-section">
        <input type="text" id="vwSearchRoll" placeholder="Roll" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-vw-search-roll">
        <input type="text" id="vwSearchGroup" placeholder="Group" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-vw-search-group">
        <button onclick="viewerSearch()" class="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Search</button>
      </div>
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div class="flex items-center gap-2">
          ${categories.length > 1
            ? `<select id="vwCategorySelect" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">${categories.map(c => `<option value="${c}">${c}</option>`).join('')}</select><button onclick="viewerDownload()" class="px-3 py-2 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Download CSV</button>`
            : categories.length ? `<button onclick="viewerDownload('${categories[0] || ''}')" class="px-3 py-2 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Download CSV</button>` : ''}
        </div>
        ${canEdit ? `<div class="flex items-center gap-2">
          <label class="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase"><input type="checkbox" id="vwSelectAll" onchange="toggleAllViewerRows(this.checked)">Select all</label>
          <button id="vwBulkEditBtn" onclick="viewerOpenBulkEditModal()" disabled class="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40 transition-all">Bulk Edit Selected (<span id="vwSelectedCount">0</span>)</button>
        </div>` : ''}
      </div>
      <div class="overflow-auto border border-slate-200 rounded-xl mb-4">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-50"><tr id="vwHeaders">${canEdit ? '<th style="width:28px"></th>' : ''}${fields.map(f => `<th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">${f.replace(/_/g, ' ')}</th>`).join('')}</tr></thead>
          <tbody id="vwBody"><tr><td colspan="100" class="text-center text-slate-400 font-bold text-xs p-6">Search above to see results.</td></tr></tbody>
        </table>
      </div>
      ${classAccess.length ? `
      <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <p class="font-black text-slate-800 text-sm flex items-center gap-2 mb-1"><i data-lucide="folder-open" class="h-4 w-4 text-blue-600"></i>Custom Tab Data</p>
        <p class="text-xs text-slate-400 font-bold mt-1 mb-4">Browse or edit a student's submission for any custom tab — only for students inside your granted class access above.</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <input type="text" id="vwTabStudentId" placeholder="Student ID" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs">
          <select id="vwTabSelect" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs"><option value="">Loading tabs…</option></select>
          <button onclick="loadClassTabData()" class="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Load</button>
        </div>
        <div id="vwTabDataArea"></div>
      </div>` : ''}
    `;
    lucide.createIcons();
    if (classAccess.length) {
      _adminFetch('get_class_tabs', {}).then(res => {
        const sel = document.getElementById('vwTabSelect');
        if (!sel) return;
        const tabs = (res && res.result === 'success' && res.tabs) || [];
        sel.innerHTML = tabs.length ? tabs.map(t => `<option value="${t.tab_name}">${t.tab_name}</option>`).join('') : '<option value="">No tabs available</option>';
      });
    }
  }
  function viewerSearch() {
    const payload = {
      student_id: document.getElementById('vwSearchId').value.trim(),
      class: document.getElementById('vwSearchClass').value.trim(),
      section: document.getElementById('vwSearchSection').value.trim(),
      roll: document.getElementById('vwSearchRoll').value.trim(),
      group: document.getElementById('vwSearchGroup').value.trim(),
    };
    const canEdit = ((_vwAccess && _vwAccess.editable_fields) || []).length > 0 || ((_vwAccess && _vwAccess.classAccess) || []).some(g => g.can_edit);
    _adminFetch('search_students', payload).then(res => {
      const body = document.getElementById('vwBody');
      if (!res || res.result !== 'success' || !res.rows.length) { body.innerHTML = `<tr><td colspan="100" class="text-center text-slate-400 font-bold text-xs p-6">No students matched.</td></tr>`; updateViewerSelectedCount(); return; }
      const headers = res.headers || Object.keys(res.rows[0]);
      // The header row must track whatever columns this particular search
      // actually returned — a class-wide grantee's rows can carry more
      // columns than the field-category set the table was first drawn with.
      const headEl = document.getElementById('vwHeaders');
      if (headEl) headEl.innerHTML = (canEdit ? '<th style="width:28px"></th>' : '') + headers.map(h => `<th class="py-2 px-3 text-[10px] font-black uppercase text-slate-400">${h.replace(/_/g, ' ')}</th>`).join('');
      body.innerHTML = res.rows.map(r => `<tr class="border-b border-slate-50">
        ${canEdit ? `<td class="py-1.5 px-3"><input type="checkbox" class="vw-row-check" value="${String(r.student_id).replace(/"/g, '&quot;')}" onchange="updateViewerSelectedCount()"></td>` : ''}
        ${headers.map(h => `<td class="py-1.5 px-3 text-slate-600 font-bold">${r[h] ?? ''}</td>`).join('')}
      </tr>`).join('');
      updateViewerSelectedCount();
    });
  }
  function loadClassTabData() {
    const student_id = document.getElementById('vwTabStudentId').value.trim();
    const tab_name = document.getElementById('vwTabSelect').value;
    const area = document.getElementById('vwTabDataArea');
    if (!student_id || !tab_name) { showToast('Enter a Student ID and pick a tab', 'error'); return; }
    area.innerHTML = '<div class="text-center p-6"><i data-lucide="loader-2" class="h-5 w-5 animate-spin inline text-blue-600"></i></div>';
    lucide.createIcons();
    _adminFetch('get_class_student_tab_data', { student_id, tab_name }).then(res => {
      if (!res || res.result !== 'success') { area.innerHTML = `<div class="text-xs text-red-500 font-bold p-3">${(res && res.message) || 'Could not load tab data'}</div>`; return; }
      const fields = (res.fields || []).filter(f => f.type !== 'group_label' && (f.data_key || f.id));
      const data = res.data || {};
      area.innerHTML = `
        <div class="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          ${fields.length ? fields.map(f => {
            const key = f.data_key || f.id;
            const val = data[key] ?? '';
            return `<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">${f.name || f.label || key}</label>
              <input type="text" class="vw-tab-field w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm" data-key="${key}" value="${String(val).replace(/"/g, '&quot;')}" ${res.can_edit ? '' : 'disabled'}></div>`;
          }).join('') : '<span class="text-xs text-slate-400 font-bold italic">This tab has no fields configured.</span>'}
          ${res.can_edit && fields.length ? `<button onclick="saveClassTabData('${student_id.replace(/'/g, "\\'")}', '${tab_name.replace(/'/g, "\\'")}')" class="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all self-end">Save</button>` : ''}
        </div>`;
      lucide.createIcons();
    }).catch(() => { area.innerHTML = '<div class="text-xs text-red-500 font-bold p-3">Network error</div>'; });
  }
  function saveClassTabData(student_id, tab_name) {
    const data = {};
    document.querySelectorAll('.vw-tab-field').forEach(inp => { data[inp.dataset.key] = inp.value; });
    _adminFetch('save_class_student_tab_data', { student_id, tab_name, data }).then(res => {
      if (res && res.result === 'success') showToast('Saved');
      else showToast((res && res.message) || 'Save failed', 'error');
    });
  }
  function toggleAllViewerRows(checked) {
    document.querySelectorAll('.vw-row-check').forEach(c => { c.checked = checked; });
    updateViewerSelectedCount();
  }
  function updateViewerSelectedCount() {
    const n = document.querySelectorAll('.vw-row-check:checked').length;
    const el = document.getElementById('vwSelectedCount');
    if (el) el.textContent = n;
    const btn = document.getElementById('vwBulkEditBtn');
    if (btn) btn.disabled = n === 0;
  }
  function viewerOpenBulkEditModal() {
    const ids = Array.from(document.querySelectorAll('.vw-row-check:checked')).map(c => c.value);
    if (!ids.length) return;
    const fields = ((_vwAccess && _vwAccess.editable_fields) || []).filter(f => f !== 'student_id');
    document.getElementById('vwBulkEditOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'vwBulkEditOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-lg" style="max-height:85vh;display:flex;flex-direction:column">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">Bulk Edit — ${ids.length} student${ids.length === 1 ? '' : 's'}</p>
          <button onclick="document.getElementById('vwBulkEditOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <p class="text-xs text-slate-400 font-bold px-4 pt-4 mb-2">Leave a field blank to leave it unchanged. Every filled-in field is set to the same value on all ${ids.length} selected student${ids.length === 1 ? '' : 's'}.</p>
        <div class="p-4 overflow-y-auto flex flex-col gap-2" style="flex:1">
          ${fields.map(h => `<div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">${h.replace(/_/g, ' ')}</label><input type="text" class="vw-bulk-edit-field w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-sm" data-field="${h}" placeholder="Leave blank = no change"></div>`).join('')}
        </div>
        <div class="p-4 border-t border-slate-100 flex justify-end">
          <button onclick='viewerSubmitBulkEdit(${JSON.stringify(ids)})' class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Apply to ${ids.length} student${ids.length === 1 ? '' : 's'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
  }
  function viewerSubmitBulkEdit(ids) {
    const updates = {};
    document.querySelectorAll('.vw-bulk-edit-field').forEach(inp => { const v = inp.value.trim(); if (v !== '') updates[inp.dataset.field] = v; });
    if (!Object.keys(updates).length) { showToast('Set at least one field', 'error'); return; }
    _adminFetch('viewer_bulk_update_students', { student_ids: ids, updates }).then(res => {
      document.getElementById('vwBulkEditOverlay')?.remove();
      if (res && (res.result === 'success' || res.result === 'partial')) {
        showToast(`Updated ${res.updated} student${res.updated === 1 ? '' : 's'}${res.errors && res.errors.length ? ' (' + res.errors.length + ' failed)' : ''}`, res.result === 'success' ? 'success' : 'error');
        viewerSearch();
      } else {
        showToast((res && res.message) || 'Update failed', 'error');
      }
    }).catch(() => showToast('Network error', 'error'));
  }
  function viewerDownload(fixedCategory) {
    const category_name = fixedCategory || document.getElementById('vwCategorySelect').value;
    if (!category_name) return;
    const payload = {
      category_name,
      student_id: document.getElementById('vwSearchId').value.trim(),
      class: document.getElementById('vwSearchClass').value.trim(),
      section: document.getElementById('vwSearchSection').value.trim(),
      roll: document.getElementById('vwSearchRoll').value.trim(),
      group: document.getElementById('vwSearchGroup').value.trim(),
    };
    _adminFetch('download_students_by_category', payload).then(res => {
      if (!res || res.result !== 'success') { showToast((res && res.message) || 'Download failed', 'error'); return; }
      const csv = res.headers.join(',') + '\n' + res.rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${category_name}_export.csv`;
      a.click();
    }).catch(() => showToast('Network error', 'error'));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Bus Tracker — native port (Phase 7). Leaflet + public/js/bus-tracking.js
  // are kept file-content-unchanged (own map/marker/geofence/ETA logic,
  // reused via the same 5 window.BusTracking.* calls) and lazy-loaded on
  // demand, same idiom as the Import tab's ensureXLSX(). bus-tracking.js
  // calls a global portalFetch(action, payload) — aliased to _adminFetch
  // here since it's the same {action, payload, user_id} POST shape.
  // ══════════════════════════════════════════════════════════════════════

  function ensureBusTrackingAssets() {
    if (window.BusTracking) return Promise.resolve();
    window.portalFetch = _adminFetch;
    const cssReady = document.getElementById('leaflet-css') ? Promise.resolve() : new Promise(resolve => {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css';
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });
    const leafletReady = window.L ? Promise.resolve() : new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('Could not load the map library — check your connection and retry.'));
      document.head.appendChild(sc);
    });
    return Promise.all([cssReady, leafletReady]).then(() => new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = '/js/bus-tracking.js';
      sc.onload = resolve;
      sc.onerror = () => reject(new Error('Could not load the bus tracker — check your connection and retry.'));
      document.head.appendChild(sc);
    }));
  }
  function loadAdminBusTrackerView() {
    if (!(window._adminTabAccess || []).includes('bus_tracker')) {
      showToast('Not available in current role', 'error');
      return;
    }
    _setViewHash('student_portal');
    setActiveNavLink('nav-erp-bus_tracker');
    setContentHeader('Bus Tracker', 'map-pin');
    const container = document.getElementById('view-container');
    if (!container) return;
    if (window.BusTracking) window.BusTracking.resetBusMap();
    container.innerHTML = `
      <div class="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight">Bus Tracker</h2>
          <p class="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Live GPS positions, geofence alerts, ETA</p>
        </div>
        <button onclick="BusTracking.exportBusData()" class="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Export CSV</button>
      </div>
      <div id="geofenceAlerts" class="flex flex-col gap-2 mb-3"></div>
      <div class="grid md:grid-cols-3 gap-4" style="height:calc(100vh - 260px)">
        <div class="md:col-span-2 rounded-3xl border border-slate-200 shadow-sm overflow-hidden" style="min-height:400px">
          <div id="bus-map-container" style="width:100%;height:100%"></div>
        </div>
        <div class="flex flex-col gap-3 overflow-hidden">
          <div id="bus-info-panel" class="shrink-0"></div>
          <div id="bus-list" class="flex-1 overflow-y-auto flex flex-col gap-2 rounded-3xl border border-slate-200 p-2"></div>
        </div>
      </div>
    `;
    document.getElementById('bus-info-panel').innerHTML = `<div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 text-center text-slate-400 font-bold text-xs">Select a bus to view details</div>`;
    lucide.createIcons();
    ensureBusTrackingAssets().then(() => window.BusTracking.initBusMap()).catch(err => {
      container.innerHTML += `<div class="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-600">${err.message}</div>`;
    });
  }

  function loadInventoryView() {
    _setViewHash('inventory');
    setActiveNavLink('nav-inventory');
    setContentHeader('Inventory', 'package');
    const container = document.getElementById('view-container');
    if (!container) return;
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;

    container.innerHTML = `
      <div class="pt-4 flex flex-col gap-6 max-w-5xl mx-auto pb-10">
        <div id="invNotifBar" class="flex flex-col gap-2"></div>

        <div>
          <p class="font-black text-slate-800 text-sm uppercase tracking-widest mb-3">My Inventory</p>
          <div id="invHoldings" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="col-span-2 text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Loading…</div>
          </div>
        </div>

        <div id="invAssignedSection" class="hidden">
          <p class="font-black text-slate-800 text-sm uppercase tracking-widest mb-3">Assigned To Me</p>
          <div id="invAssigned" class="flex flex-col gap-4"></div>
        </div>

        <div>
          <p class="font-black text-slate-800 text-sm uppercase tracking-widest mb-3">Receipt History</p>
          <div class="overflow-x-auto border border-slate-100 rounded-xl bg-white">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50">
                <tr>
                  <th class="px-4 py-2.5 font-black text-slate-500 uppercase tracking-widest">Date</th>
                  <th class="px-4 py-2.5 font-black text-slate-500 uppercase tracking-widest">Item</th>
                  <th class="px-4 py-2.5 font-black text-slate-500 uppercase tracking-widest text-right">Qty</th>
                  <th class="px-4 py-2.5 font-black text-slate-500 uppercase tracking-widest">From</th>
                  <th class="px-4 py-2.5 font-black text-slate-500 uppercase tracking-widest">Remarks</th>
                </tr>
              </thead>
              <tbody id="invHistoryBody"><tr><td colspan="5" class="px-4 py-8 text-center text-slate-400 font-bold">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="invDistModal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="bg-white rounded-2xl p-5 w-full max-w-sm">
          <p class="font-black text-slate-800 text-sm mb-3" id="invDistTitle">Distribute</p>
          <div class="flex flex-col gap-3">
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recipient Type</label>
              <select id="invDistType" onchange="_invRenderRecipientOptions()" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 mt-1">
                <option value="person">Person</option>
                <option value="room">Room</option>
                <option value="building">Building</option>
                <option value="committee">Committee</option>
              </select>
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recipient</label>
              <select id="invDistConsumer" onchange="_invUpdateNotifyPreview()" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 mt-1"></select>
            </div>
            <div id="invDistPreview" class="text-[11px] font-bold text-slate-500 bg-slate-50 rounded-lg px-3 py-2"></div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Quantity <span id="invDistMax" class="normal-case font-bold text-slate-400"></span></label>
              <input id="invDistQty" type="number" min="1" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 mt-1">
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remarks</label>
              <input id="invDistRemarks" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 mt-1">
            </div>
            <div id="invDistStatus" class="text-xs font-bold"></div>
            <div class="flex gap-2 justify-end mt-1">
              <button onclick="_invCloseDistModal()" class="px-4 py-2 rounded-lg text-slate-500 text-xs font-black">Cancel</button>
              <button onclick="_invSubmitDistribution()" id="invDistSubmitBtn" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-black">Confirm</button>
            </div>
          </div>
        </div>
      </div>`;
    lucide.createIcons();

    _invLoadNotifications();
    _invLoadHoldings();
    _invLoadAssigned();
    _invLoadHistory();
  }

  function _invLoadNotifications() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    google.script.run
      .withSuccessHandler(res => {
        const bar = document.getElementById('invNotifBar');
        if (!bar) return;
        const rows = (res && res.rows) || [];
        const unread = rows.filter(r => !r.is_read);
        if (!unread.length) { bar.innerHTML = ''; return; }
        bar.innerHTML = unread.slice(0, 5).map(n => `
          <div class="flex items-center justify-between gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
            <span class="text-xs font-bold text-blue-800">${n.message}</span>
            <button onclick="_invMarkNotifRead(${n.id})" class="text-[10px] font-black text-blue-500 uppercase tracking-widest shrink-0">Dismiss</button>
          </div>`).join('');
      })
      .withFailureHandler(() => {})
      .getMyNotifications(myId);
  }

  function _invMarkNotifRead(id) {
    google.script.run.withSuccessHandler(() => _invLoadNotifications()).withFailureHandler(() => {}).markNotificationRead(id);
  }

  function _invLoadHoldings() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    google.script.run
      .withSuccessHandler(res => {
        const grid = document.getElementById('invHoldings');
        if (!grid) return;
        const holdings = (res && res.holdings) || [];
        if (!holdings.length) {
          grid.innerHTML = `<div class="col-span-2 text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Nothing on hand right now</div>`;
          return;
        }
        grid.innerHTML = holdings.map(h => `
          <div class="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-black text-slate-800">${(h.products && h.products.name) || 'Item'}</p>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${(h.products && h.products.code) || ''} · Qty ${h.quantity}</p>
            </div>
            <button onclick='_invOpenDistModal("self", null, ${h.product_id}, ${JSON.stringify((h.products && h.products.name) || "item")}, ${h.quantity})'
              class="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest shrink-0">Distribute</button>
          </div>`).join('');
      })
      .withFailureHandler(() => {})
      .getMyHolderStock(myId);
  }

  function _invLoadAssigned() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    google.script.run
      .withSuccessHandler(res => {
        const section = document.getElementById('invAssignedSection');
        const host = document.getElementById('invAssigned');
        if (!host || !section) return;
        const holders = (res && res.holders) || [];
        if (!holders.length) { section.classList.add('hidden'); return; }
        section.classList.remove('hidden');
        host.innerHTML = holders.map(h => `
          <div class="bg-white border border-slate-200 rounded-xl p-4">
            <p class="text-xs font-black text-slate-700 uppercase tracking-widest mb-2">${h.name || h.holder_type} <span class="text-slate-400">(${h.holder_type})</span></p>
            ${h.holdings && h.holdings.length ? `
              <div class="flex flex-col gap-2">
                ${h.holdings.map(hd => `
                  <div class="flex items-center justify-between gap-3 border-t border-slate-50 pt-2">
                    <span class="text-xs font-bold text-slate-600">${(hd.products && hd.products.name) || 'Item'} <span class="text-slate-400">× ${hd.quantity}</span></span>
                    <button onclick='_invOpenDistModal("${h.holder_type}", ${h.holder_id}, ${hd.product_id}, ${JSON.stringify((hd.products && hd.products.name) || "item")}, ${hd.quantity})'
                      class="px-3 py-1 rounded-lg bg-blue-600 text-white text-[9px] font-black uppercase tracking-widest shrink-0">Distribute</button>
                  </div>`).join('')}
              </div>` : `<p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nothing on hand</p>`}
          </div>`).join('');
      })
      .withFailureHandler(() => {})
      .getAssignedHolders(myId);
  }

  function _invLoadHistory() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    google.script.run
      .withSuccessHandler(res => {
        const body = document.getElementById('invHistoryBody');
        if (!body) return;
        const rows = (res && res.rows) || [];
        if (!rows.length) {
          body.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400 font-bold">No items received yet</td></tr>`;
          return;
        }
        body.innerHTML = rows.map(r => {
          const items = r.distribution_items || [];
          const itemLabel = items.map(i => `${(i.products && i.products.name) || 'Item'} × ${i.quantity}`).join(', ') || '—';
          const from = (r.consumers && r.consumers.name) || (r.from_consumer_id ? 'Another holder' : 'Central Store');
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
          return `<tr class="border-t border-slate-50">
            <td class="px-4 py-2.5 font-bold text-slate-500">${date}</td>
            <td class="px-4 py-2.5 font-bold text-slate-700">${itemLabel}</td>
            <td class="px-4 py-2.5 font-bold text-slate-700 text-right">${items.reduce((s, i) => s + Number(i.quantity || 0), 0)}</td>
            <td class="px-4 py-2.5 font-bold text-slate-500">${from}</td>
            <td class="px-4 py-2.5 font-bold text-slate-400">${r.remarks || ''}</td>
          </tr>`;
        }).join('');
      })
      .withFailureHandler(() => {})
      .getMyDistributionHistory(myId);
  }

  // ── Distribute modal (shared by "My Inventory" and "Assigned To Me") ────────
  function _invOpenDistModal(fromType, fromId, productId, productName, max) {
    _invDistContext = { fromType, fromId, productId, productName, max };
    document.getElementById('invDistTitle').textContent = `Distribute ${productName}`;
    document.getElementById('invDistMax').textContent = `(max ${max})`;
    document.getElementById('invDistQty').value = '';
    document.getElementById('invDistQty').max = max;
    document.getElementById('invDistRemarks').value = '';
    document.getElementById('invDistStatus').textContent = '';
    document.getElementById('invDistModal').classList.remove('hidden');

    if (_invOptionsCache) { _invRenderRecipientOptions(); return; }
    google.script.run
      .withSuccessHandler(res => { _invOptionsCache = res || { consumers: [], committees: [], assignments: [] }; _invRenderRecipientOptions(); })
      .withFailureHandler(() => { _invOptionsCache = { consumers: [], committees: [], assignments: [] }; _invRenderRecipientOptions(); })
      .getConsumerOptions();
  }

  function _invCloseDistModal() {
    document.getElementById('invDistModal').classList.add('hidden');
    _invDistContext = null;
  }

  const PERSON_CONSUMER_TYPES = ['teacher', 'staff', 'student', 'others'];
  function _invRenderRecipientOptions() {
    if (!_invOptionsCache) return;
    const type = document.getElementById('invDistType').value;
    const wanted = type === 'person' ? PERSON_CONSUMER_TYPES : [type];
    const matches = _invOptionsCache.consumers.filter(c => wanted.includes(c.type));
    const sel = document.getElementById('invDistConsumer');
    sel.innerHTML = `<option value="">--Select--</option>` + matches.map(c =>
      `<option value="${c.id}">${c.name}${c.type === 'committee' ? ' (Committee)' : ''}</option>`).join('');
    _invUpdateNotifyPreview();
  }

  function _invUpdateNotifyPreview() {
    const sel = document.getElementById('invDistConsumer');
    const preview = document.getElementById('invDistPreview');
    const remarksInput = document.getElementById('invDistRemarks');
    if (!sel.value || !_invOptionsCache) { preview.textContent = ''; return; }
    const consumer = _invOptionsCache.consumers.find(c => String(c.id) === String(sel.value));
    if (!consumer) { preview.textContent = ''; return; }
    let text = 'No ccpc-teachers identity for this recipient — no notification will be sent.';
    if (consumer.type === 'committee') {
      const committee = _invOptionsCache.committees.find(c => String(c.id) === String(consumer.reference_id));
      text = committee && committee.chairman_user_id ? `Will notify: ${committee.chairman_user_id} (chairman of ${committee.name})` : 'No chairman set for this committee yet — no one will be notified.';
      if (!remarksInput.value) remarksInput.value = `Committee: ${consumer.name}`;
    } else if (consumer.type === 'room' || consumer.type === 'building') {
      const a = _invOptionsCache.assignments.find(x => x.holder_type === consumer.type && String(x.holder_id) === String(consumer.reference_id));
      text = a ? `Will notify: ${a.assignee_user_id}` : 'No distributor assigned yet — no one will be notified.';
    } else if (consumer.type === 'teacher' || consumer.type === 'staff') {
      text = consumer.reference_id ? `Will notify: ${consumer.reference_id}` : 'No ccpc-teachers user_id set on this consumer — no one will be notified.';
    }
    preview.textContent = text;
  }

  function _invSubmitDistribution() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    const consumerId = document.getElementById('invDistConsumer').value;
    const qty = Number(document.getElementById('invDistQty').value);
    const remarks = document.getElementById('invDistRemarks').value;
    const status = document.getElementById('invDistStatus');
    if (!consumerId) { status.className = 'text-xs font-bold text-red-600'; status.textContent = 'Pick a recipient.'; return; }
    if (!qty || qty <= 0) { status.className = 'text-xs font-bold text-red-600'; status.textContent = 'Enter a quantity greater than 0.'; return; }
    if (qty > _invDistContext.max) { status.className = 'text-xs font-bold text-red-600'; status.textContent = `Only ${_invDistContext.max} on hand.`; return; }

    document.getElementById('invDistSubmitBtn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('invDistSubmitBtn').disabled = false;
        if (res && res.result === 'success') {
          showToast('Distributed successfully');
          _invCloseDistModal();
          _invLoadHoldings(); _invLoadAssigned(); _invLoadHistory(); _invLoadNotifications();
        } else {
          status.className = 'text-xs font-bold text-red-600';
          status.textContent = (res && res.message) || 'Failed to distribute.';
        }
      })
      .withFailureHandler(() => {
        document.getElementById('invDistSubmitBtn').disabled = false;
        status.className = 'text-xs font-bold text-red-600';
        status.textContent = 'Network error — try again.';
      })
      .createDistribution(myId, _invDistContext.fromType, _invDistContext.fromId, _invDistContext.productId, consumerId, qty, remarks);
  }

  // ── PERMISSION CONTROL PANEL (Admin only) ────────────────────────────────────
  // 'Admission Admin' / 'Student Portal Admin' / 'Canteen Admin' / 'Inventory
  // Admin' are add-on roles: each grants delegated control of one separate
  // app/module (the admission admin panel, the Student Portal module here,
  // ccpc-canteen's admin panel, and ccpc-inventory respectively) WITHOUT the
  // blanket 'Admin' role. Inside this portal itself they behave like any
  // unmapped role (TeacherView fallback) — their only purpose is granting
  // access elsewhere.
  const ALL_ROLES = ['Teacher','Staff','HR','Principal','VP','Admin','Cord','Admission Admin','Student Portal Admin','Canteen Admin','Inventory Admin','Class Teacher'];
  // Two-letter chips would collide with Admin ('AD') / each other — explicit abbreviations
  const ROLE_ABBR = { 'Admission Admin':'AA', 'Student Portal Admin':'SP', 'Canteen Admin':'CA', 'Inventory Admin':'IA' };
  function roleAbbr(r){ return ROLE_ABBR[r] || r.slice(0,2).toUpperCase(); }

  // ── MODULE VISIBILITY (Admin-configurable, System > Module Access) ──────────
  // Adding a future module (Fees, Grades, ...) is: add its nav link with an id,
  // add one entry here, add a default row below. The checkbox matrix, sidebar
  // gating, and hash-route gating all pick it up automatically.
  const MODULE_REGISTRY = [
    { key: 'dashboard',        label: 'Command Center',    navId: 'nav-dashboard' },
    { key: 'routine',          label: 'Routine',            navId: 'nav-routine' },
    { key: 'system',           label: 'System',             navId: 'nav-system' },
    { key: 'student_portal',   label: 'Student Portal',     navId: 'nav-student-portal' },
    { key: 'inventory_admin',  label: 'Inventory Admin',    navId: 'nav-inventory-admin' },
    { key: 'committees',       label: 'My Assignments',     navId: 'nav-my-committees' },
    { key: 'messages',         label: 'Messages',           navId: 'nav-messages' },
    { key: 'notifications',    label: 'Notifications',      navId: 'nav-notifications' },
    { key: 'users',            label: 'Users Directory',    navId: 'nav-users-directory' },
    { key: 'analytics',        label: 'Analytics',          navId: 'nav-analytics' },
    { key: 'permissions',      label: 'Permission Control', navId: 'nav-permissions' },
  ];

  // Mirrors the hardcoded behavior this feature replaces — used until an
  // Admin explicitly saves a custom matrix, and as the fallback for any
  // module the saved matrix doesn't mention (e.g. one just added above).
  const MODULE_DEFAULTS = {
    dashboard:     ALL_ROLES,
    routine:       ALL_ROLES,
    system:        ['HR','Admin','Principal','VP'],
    student_portal:['Admin','Student Portal Admin','HR'],
    inventory_admin:['Admin','Inventory Admin'],
    committees:    ['Teacher','Staff'],
    messages:      ALL_ROLES,
    notifications: ALL_ROLES,
    users:         ALL_ROLES,
    analytics:     ['HR','VP','Admin'],
    permissions:   ['Admin'],
  };

  let _moduleVisibility = null; // { moduleKey: [roles...] } once loaded from system_settings

  // Admin always sees every module — a misconfigured matrix should never be
  // able to lock the one role that can fix the matrix out of the settings.
  function _isModuleVisibleForRole(moduleKey, role) {
    if (role === 'Admin') return true;
    const matrix  = _moduleVisibility || {};
    const allowed = matrix[moduleKey] || MODULE_DEFAULTS[moduleKey] || ALL_ROLES;
    return allowed.includes(role);
  }

  function _loadModuleVisibility(then) {
    google.script.run.withSuccessHandler(function (settings) {
      _moduleVisibility = (settings && settings.module_visibility) || null;
      if (then) then();
    }).withFailureHandler(function () { if (then) then(); }).getSystemSettings();
  }

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
              <input type="text" id="permSearchInput" oninput="filterPermTable()" placeholder="Search users…" autocomplete="off"
                class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-600 outline-none shadow-sm" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-perm-search">
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
      Principal:'#2563eb', VP:'#0891b2', Admin:'#e11d48', 'Admission Admin':'#0d9488', 'Student Portal Admin':'#7c3aed', 'Canteen Admin':'#ea580c', 'Inventory Admin':'#0284c7'
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
              ${roleAbbr(r)}
            </span>
          </label>
        </td>`;
      }).join('');
      return `<tr class="hover:bg-slate-50/60 transition-colors" id="perm-row-${u.user_id}">
        <td class="px-6 py-4" data-label="User">
          <p class="text-sm font-black text-slate-800">${label !== u.user_id ? label : u.email || u.user_id}</p>
          <p class="text-[10px] text-slate-400 font-bold">${u.user_id}${u.email && label !== u.user_id ? ' · ' + u.email : ''}</p>
        </td>
        ${checkboxes}
        <td class="px-6 py-4 text-right" data-label="Actions">
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
    const roleColors = { Teacher:'bg-blue-100 text-blue-600', Staff:'bg-slate-100 text-slate-500', HR:'bg-purple-100 text-purple-600', Admin:'bg-slate-900 text-white', Principal:'bg-indigo-100 text-indigo-600', VP:'bg-indigo-50 text-indigo-500', 'Admission Admin':'bg-teal-100 text-teal-700', 'Student Portal Admin':'bg-violet-100 text-violet-700', 'Canteen Admin':'bg-orange-100 text-orange-700', 'Inventory Admin':'bg-sky-100 text-sky-700' };
    tbody.innerHTML = users.map(u => {
      const roleBadges = (u.role || '').split(',').map(r => r.trim()).filter(Boolean).map(r =>
        `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${roleColors[r] || 'bg-slate-100 text-slate-400'}">${r}</span>`
      ).join('');
      const safeRole = (u.role || '').replace(/'/g, "\\'");
      const label = staffLabel(u.user_id);
      const staff = allStaffCache.find(s => s.teacher_id === u.user_id);
      return `
      <tr class="hover:bg-slate-50 transition-colors group/row">
        <td class="px-6 py-4" data-label="Name &amp; ID">
          <p class="text-sm font-black text-slate-800 tracking-tight">${label}</p>
          <p class="text-[10px] text-slate-400 font-bold">${u.user_id}${staff && staff.designation ? ' · ' + staff.designation : ''}</p>
        </td>
        <td class="px-6 py-4" data-label="Email &amp; Phone">
          <p class="text-sm font-bold text-slate-600">${u.email || '—'}</p>
          ${(() => { const wa = staff && (staff.whatsapp || staff.phone); if (!wa) return '<p class="text-xs text-slate-300 font-bold">No phone</p>'; const tel = wa.replace(/[\s\-()]/g,''); const digits = wa.replace(/\D/g,''); return `<div class="flex items-center gap-2 mt-0.5"><span class="text-xs text-slate-400 font-bold select-all">${wa}</span><a href="tel:${tel}" title="Call" class="text-slate-400 hover:text-blue-600 transition-colors"><i data-lucide="phone" class="h-3 w-3"></i></a><a href="https://wa.me/${digits}" target="_blank" title="WhatsApp" class="text-slate-400 hover:text-emerald-500 transition-colors"><i data-lucide="message-circle" class="h-3 w-3"></i></a></div>`; })()}</td>
        <td class="px-6 py-4" data-label="Roles"><div class="flex flex-wrap gap-1">${roleBadges}</div></td>
        <td class="px-6 py-4 text-right" data-label="Actions">
          <div class="flex justify-end gap-4">
            <button onclick="openStaffFormModal('${u.user_id}')" title="Edit Staff" class="p-2 hover:bg-indigo-50 text-indigo-500 rounded-xl transition-all"><i data-lucide="pencil" class="h-4 w-4"></i></button>
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
      // Render user table for system view
      const tbody = document.getElementById('userListBody');
      if (!tbody) return;
      if (!allUsersCache.length) {
        tbody.innerHTML = `<tr><td colspan="${canEdit?5:4}" class="px-6 py-10 text-center text-slate-400 text-xs font-black uppercase tracking-widest italic">No users found</td></tr>`;
        lucide.createIcons(); return;
      }
      const roleColors = { Teacher:'bg-blue-100 text-blue-600', Staff:'bg-slate-100 text-slate-500', HR:'bg-purple-100 text-purple-600', Admin:'bg-slate-900 text-white', Principal:'bg-indigo-100 text-indigo-600', VP:'bg-indigo-50 text-indigo-500', 'Admission Admin':'bg-teal-100 text-teal-700', 'Student Portal Admin':'bg-violet-100 text-violet-700', 'Canteen Admin':'bg-orange-100 text-orange-700', 'Inventory Admin':'bg-sky-100 text-sky-700' };
      tbody.innerHTML = allUsersCache.map(u => {
        const roleBadges = (u.role||'').split(',').map(r=>r.trim()).filter(Boolean)
          .map(r=>`<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${roleColors[r]||'bg-slate-100 text-slate-400'}">${r}</span>`).join('');
        const isActive = u.is_active !== false;
        const statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${isActive?'bg-emerald-100 text-emerald-600':'bg-red-100 text-red-400'}">
          <span class="w-1.5 h-1.5 rounded-full ${isActive?'bg-emerald-500':'bg-red-400'}"></span>${isActive?'Active':'Inactive'}</span>`;
        const safeRole = (u.role||'').replace(/'/g,"\\'");
        const actions = canEdit ? `<td class="px-6 py-4 text-right">
          <div class="flex justify-end gap-4">
            <button onclick="openStaffFormModal('${u.user_id}')" title="Edit Staff" class="p-2 hover:bg-indigo-50 text-indigo-500 rounded-xl transition-all"><i data-lucide="pencil" class="h-4 w-4"></i></button>
            <button onclick="resetPassword('${u.user_id}')" title="Reset Password" class="p-2 hover:bg-amber-50 text-amber-500 rounded-xl transition-all"><i data-lucide="key-round" class="h-4 w-4"></i></button>
            <button onclick="editRole('${u.user_id}','${safeRole}')" title="Change Role" class="p-2 hover:bg-blue-50 text-blue-500 rounded-xl transition-all"><i data-lucide="shield-check" class="h-4 w-4"></i></button>
            <button onclick="deleteUser('${u.user_id}')" title="Delete" class="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-all"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
          </div></td>` : '';
        return `<tr class="hover:bg-slate-50 transition-colors group/row">
          <td class="px-6 py-4" data-label="Name &amp; ID"><p class="text-sm font-black text-slate-800">${staffLabel(u.user_id)}</p><p class="text-[10px] text-slate-400 font-bold">${u.user_id}</p></td>
          <td class="px-6 py-4" data-label="Email"><p class="text-sm font-bold text-slate-600">${u.email||'—'}</p></td>
          <td class="px-6 py-4" data-label="Roles"><div class="flex flex-wrap gap-1">${roleBadges}</div></td>
          <td class="px-6 py-4" data-label="Status">${statusBadge}</td>
          ${actions ? actions.replace('<td class="px-6 py-4 text-right">', '<td class="px-6 py-4 text-right" data-label="Actions">') : ''}
        </tr>`;
      }).join('');
      lucide.createIcons();
    }).getAppUsers();
  }

  function filterUserList() {
    const query = (document.getElementById('userSearchInput')?.value || '').toLowerCase();
    const filtered = allUsersCache.filter(u =>
      u.user_id.toString().toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query) ||
      (u.role || '').toLowerCase().includes(query) ||
      staffLabel(u.user_id).toLowerCase().includes(query)
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
        waSendCredentials([{ ...data, password: data.password }]);
        form.reset();
        form.querySelectorAll('.role-cb').forEach(cb => cb.checked = false);
        loadUserData();
      }).withFailureHandler(() => { showLoading(false); showToast('Failed to create user', 'error'); })
        .saveAppUser(data);
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Generic "this will affect linked records" confirmation — shown before
  // any identifier rename (a student's Student ID or a staff Login ID),
  // since both cascade across many other tables (attendance, fees, payroll,
  // family/education records, evaluation grants, ...). The backend always
  // runs a real COUNT query per table first, so this shows actual numbers,
  // not just a generic warning.
  // ══════════════════════════════════════════════════════════════════════
  function _showRenameImpactPopup(impact, onConfirm) {
    document.getElementById('renameImpactOverlay')?.remove();
    const entries = Object.entries(impact || {});
    const overlay = document.createElement('div');
    overlay.id = 'renameImpactOverlay';
    overlay.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md">
        <div class="p-5 border-b border-slate-100 flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><i data-lucide="alert-triangle" class="h-5 w-5"></i></div>
          <div>
            <p class="font-black text-slate-800 text-sm">Changing this ID updates linked records</p>
            <p class="text-xs text-slate-400 font-bold mt-0.5">${entries.length ? 'These will be relinked to the new ID:' : 'No linked records found — safe to rename.'}</p>
          </div>
        </div>
        ${entries.length ? `<div class="p-5 max-h-64 overflow-y-auto flex flex-col gap-1.5">
          ${entries.map(([label, count]) => `<div class="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl"><span class="text-xs font-bold text-slate-600">${label}</span><span class="text-xs font-black text-slate-800">${count}</span></div>`).join('')}
        </div>` : '<div class="p-2"></div>'}
        <div class="p-5 border-t border-slate-100 flex justify-end gap-2">
          <button onclick="document.getElementById('renameImpactOverlay').remove()" class="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">Cancel</button>
          <button id="renameImpactConfirmBtn" class="px-4 py-2.5 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">Confirm Rename</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
    document.getElementById('renameImpactConfirmBtn').onclick = () => { overlay.remove(); onConfirm(); };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Staff Edit / Add — full-field editor for an existing account (or a
  // blank one) reached from the System view's Users table. Editing the
  // Login ID goes through the impact-preview popup above before the
  // rename actually happens; every other field is a plain PATCH.
  // ══════════════════════════════════════════════════════════════════════
  let _staffFormOriginalId = null;

  function openStaffFormModal(userId) {
    _staffFormOriginalId = userId || null;
    const existing = userId ? (allUsersCache || []).find(u => u.user_id === userId) : null;
    const staff = userId ? (allStaffCache || []).find(s => s.teacher_id === userId) : null;
    document.getElementById('staffFormOverlay')?.remove();
    const roles = (existing?.role || '').split(',').map(r => r.trim()).filter(Boolean);
    const overlay = document.createElement('div');
    overlay.id = 'staffFormOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-2xl" style="max-height:88vh;display:flex;flex-direction:column">
        <div class="p-5 border-b border-slate-100 flex items-center justify-between">
          <p class="font-black text-slate-800 text-sm">${userId ? 'Edit Staff — ' + userId : 'Add Teacher / Staff'}</p>
          <button onclick="document.getElementById('staffFormOverlay').remove()" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-5 overflow-y-auto grid md:grid-cols-2 gap-4" style="flex:1">
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Login ID</label><input type="text" id="sfUserId" value="${existing?.user_id || ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Email</label><input type="email" id="sfEmail" value="${existing?.email || ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Phone</label><input type="text" id="sfPhone" value="${existing?.phone || ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">${userId ? 'Password (leave blank to keep current)' : 'Initial Password'}</label><input type="password" id="sfPassword" placeholder="${userId ? '••••••••' : ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div class="md:col-span-2"><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Role(s)</label>
            <div class="flex flex-wrap gap-2">${ALL_ROLES.map(r => `<label class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 cursor-pointer"><input type="checkbox" class="sf-role-cb" value="${r}" ${roles.includes(r) ? 'checked' : ''}>${r}</label>`).join('')}</div>
          </div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Full Name</label><input type="text" id="sfFullName" value="${staff?.full_name || ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Category</label><input type="text" id="sfCategory" value="${staff?.category || ''}" placeholder="Teacher / Staff" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Department</label><input type="text" id="sfDepartment" value="${staff?.department || ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Designation</label><input type="text" id="sfDesignation" value="${staff?.designation || ''}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Joining Date</label><input type="date" id="sfJoiningDate" value="${(staff?.joining_date || '').slice(0, 10)}" class="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"></div>
        </div>
        <div class="p-5 border-t border-slate-100 flex justify-end">
          <button onclick="submitStaffForm()" class="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">${userId ? 'Save Changes' : 'Create Account'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    lucide.createIcons();
  }

  function submitStaffForm() {
    const newUserId = document.getElementById('sfUserId').value.trim();
    if (!newUserId) { showToast('Login ID is required', 'error'); return; }
    const roles = [...document.querySelectorAll('.sf-role-cb:checked')].map(cb => cb.value);
    if (!roles.length) { showToast('Select at least one role', 'error'); return; }
    const password = document.getElementById('sfPassword').value.trim();
    const data = {
      user_id: newUserId,
      email: document.getElementById('sfEmail').value.trim(),
      phone: document.getElementById('sfPhone').value.trim(),
      role: roles.join(','),
      full_name: document.getElementById('sfFullName').value.trim(),
      category: document.getElementById('sfCategory').value.trim(),
      department: document.getElementById('sfDepartment').value.trim(),
      designation: document.getElementById('sfDesignation').value.trim(),
      joining_date: document.getElementById('sfJoiningDate').value.trim(),
    };

    if (!_staffFormOriginalId) {
      if (!password) { showToast('Set an initial password', 'error'); return; }
      data.password = password;
      google.script.run
        .withSuccessHandler(res => {
          if (res && res.error) { showToast(res.details || res.message || 'Could not create account', 'error'); return; }
          document.getElementById('staffFormOverlay')?.remove();
          showToast('Account created');
          if (typeof loadUserData_forSystem === 'function') loadUserData_forSystem();
        })
        .withFailureHandler(err => showToast('Failed: ' + (err.message || err), 'error'))
        .saveAppUser(data);
      return;
    }

    const doSave = () => {
      google.script.run
        .withSuccessHandler(res => {
          if (res && res.error) { showToast(res.message || 'Save failed', 'error'); return; }
          const finish = () => {
            document.getElementById('staffFormOverlay')?.remove();
            showToast('Staff record updated');
            if (typeof loadUserData_forSystem === 'function') loadUserData_forSystem();
          };
          if (password) {
            google.script.run.withSuccessHandler(finish).withFailureHandler(finish).updateAppUserPassword(newUserId, password);
          } else finish();
        })
        .withFailureHandler(err => showToast('Failed: ' + (err.message || err), 'error'))
        .saveAppUserFull(_staffFormOriginalId, data);
    };

    if (newUserId !== _staffFormOriginalId) {
      google.script.run
        .withSuccessHandler(impact => {
          if (impact && impact.error) { showToast(impact.message || 'Could not check impact', 'error'); return; }
          _showRenameImpactPopup(impact, doSave);
        })
        .withFailureHandler(() => showToast('Could not check impact', 'error'))
        .previewRenameTeacherIdImpact(_staffFormOriginalId);
    } else {
      doSave();
    }
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
    Principal:'#2563eb', VP:'#0891b2', Admin:'#e11d48', 'Admission Admin':'#0d9488', 'Student Portal Admin':'#7c3aed', 'Canteen Admin':'#ea580c', 'Inventory Admin':'#0284c7'
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
              ${roleAbbr(r)}
            </span>
          </label>
        </td>`;
      }).join('');
      const searchText = [s.full_name, s.teacher_id, s.email, s.designation].filter(Boolean).join(' ').toLowerCase();
      return `<tr class="hover:bg-slate-50/60 transition-colors" data-search="${searchText}">
        <td class="px-4 py-3" data-label="Select">
          <input type="checkbox" class="profile-pick-cb w-4 h-4 rounded accent-indigo-600" value="${id}" onchange="updateBulkSelCount()">
        </td>
        <td class="px-4 py-3" data-label="Name &amp; Details">
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
    document.querySelectorAll('#profilePickerList tr[data-search]').forEach(row => {
      row.style.display = (!q || row.dataset.search.includes(q)) ? '' : 'none';
    });
    updateBulkSelCount();
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
        let msg = `${res.created.length} created`;
        if (res.failed && res.failed.length) {
          msg += `, ${res.failed.length} failed`;
          if (res.firstError) msg += ` — ${res.firstError}`;
        }
        showToast(msg, res.failed && res.failed.length ? 'info' : 'success');
        // Auto-send credentials via WhatsApp for successfully created users
        if (res.created && res.created.length) {
          const toSend = res.created.map(u => ({ ...u, password: u.password || defaultPass }));
          waSendCredentials(toSend);
        }
        loadUserData_forSystem();
        refreshProfileList();
        const selAll = document.getElementById('selectAllProfiles');
        if (selAll) selAll.checked = false;
        updateBulkSelCount();
      })
      .withFailureHandler(() => { showLoading(false); showToast('Bulk create failed', 'error'); })
      .bulkCreateUsersFromProfiles(profiles, defaultPass);
  }

  // ── WHATSAPP INTEGRATION ─────────────────────────────────────────────────────
  // Change WA_SERVER to your VPS IP after deploying: 'http://YOUR-VPS-IP:3001'
  const WA_SERVER  = window.WA_SERVER_URL || 'http://localhost:3001';
  const WA_API_KEY = window.WA_API_KEY    || '';

  function waMessage(user) {
    return `*CCPC Faculty Portal — Login Credentials*\n\nHello,\n\nYour portal access has been set up.\n${window.location.origin}\n\n*ID:* ${user.user_id || user.teacher_id}\n*Password:* ${user.password}\n*Role:* ${user.role}\n\nPlease change your password after first login.\n\n_Chittagong Cantonment Public College_`;
  }

  async function waSendCredentials(users) {
    // users: array of { phone, user_id/teacher_id, password, role }
    const withPhone = users.filter(u => u.phone && u.phone.trim());
    if (!withPhone.length) return;

    let waStatus = 'unknown';
    try {
      const r = await fetch(WA_SERVER + '/status', { signal: AbortSignal.timeout(2000) });
      waStatus = (await r.json()).status;
    } catch { return; } // server not running — silent skip

    if (waStatus !== 'connected') {
      showToast('WhatsApp not connected — start the WA server to auto-send credentials', 'info');
      return;
    }

    const payload = withPhone.map(u => ({ phone: u.phone, message: waMessage(u) }));
    try {
      const r = await fetch(WA_SERVER + '/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': WA_API_KEY },
        body: JSON.stringify({ users: payload })
      });
      const data = await r.json();
      const ok   = data.results ? data.results.filter(x => x.ok).length : 0;
      const fail = data.results ? data.results.filter(x => !x.ok).length : 0;
      showToast(`WhatsApp: ${ok} sent${fail ? ', ' + fail + ' failed' : ''}`, fail ? 'info' : 'success');
    } catch (e) {
      console.warn('[WA] send-bulk failed:', e.message);
    }
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

  // Ensures allStaffCache is populated, then calls cb(). Safe to call concurrently.
  function _ensureStaffCache(cb) {
    if (allStaffCache.length) { cb(); return; }
    google.script.run
      .withSuccessHandler(data => { allStaffCache = Array.isArray(data) ? data : []; cb(); })
      .withFailureHandler(() => cb())
      .getAllStaffData(false, true);
  }

  // ── STAFF REGISTRY ────────────────────────────────────────────────────────────
  function loadStaffData(cb) {
    google.script.run
      .withSuccessHandler(data => {
        allStaffCache = Array.isArray(data) ? data : [];
        renderStaffTable();
        renderGradingGrid();
        if (cb) cb();
      })
      .withFailureHandler(err => { console.error('Staff load failed:', err); if (cb) cb(); })
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
      const initials = (s.full_name||s.teacher_id||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
      const evalBadge = s.is_evaluatable
        ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase tracking-wide"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>Active</span>`
        : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-400 border border-slate-200 uppercase tracking-wide"><span class="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block"></span>Inactive</span>`;
      const toggleBtn = s.is_evaluatable
        ? `<button onclick="toggleEval('${s.teacher_id}',false)" title="Deactivate" class="p-2 hover:bg-red-50 text-red-400 rounded-xl transition-all"><i data-lucide="user-x" class="h-4 w-4"></i></button>`
        : `<button onclick="toggleEval('${s.teacher_id}',true)" title="Activate" class="p-2 hover:bg-emerald-50 text-emerald-500 rounded-xl transition-all"><i data-lucide="user-check" class="h-4 w-4"></i></button>`;
      const safeName = (s.full_name||s.teacher_id).replace(/'/g,"\\'");
      const catColor = s.category==='Staff' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
      return `<tr class="hover:bg-blue-50/30 transition-colors group/row border-b border-slate-50">
        <td class="px-5 py-3.5" data-label="ID &amp; Category">
          <p class="text-[11px] font-black text-slate-700 font-mono">${s.teacher_id}</p>
          <span class="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide ${catColor}">${s.category||'Faculty'}</span>
        </td>
        <td class="px-5 py-3.5" data-label="Name &amp; Email">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black text-white shrink-0" style="background:linear-gradient(135deg,#1d4ed8,#7c3aed)">${initials}</div>
            <div>
              <p class="text-[13px] font-bold text-slate-800 leading-tight">${s.full_name||'<em class="text-slate-300 font-normal">No Name</em>'}</p>
              <p class="text-[11px] text-slate-400 mt-0.5">${s.email||''}</p>
            </div>
          </div>
        </td>
        <td class="px-5 py-3.5" data-label="Status">${evalBadge}</td>
        <td class="px-5 py-3.5 text-right" data-label="Actions">
          <div class="flex justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-all">
            <button onclick="openDetailsModal('${s.teacher_id}')" title="View Profile" class="p-2 hover:bg-blue-100 text-blue-500 rounded-lg transition-all"><i data-lucide="eye" class="h-3.5 w-3.5"></i></button>
            <button onclick="openRecordsModal('${s.teacher_id}','${safeName}')" title="Courses &amp; Records" class="p-2 hover:bg-violet-100 text-violet-500 rounded-lg transition-all"><i data-lucide="clipboard-list" class="h-3.5 w-3.5"></i></button>
            ${toggleBtn}
            <button onclick="openTraceReport('${s.teacher_id}')" title="ACR Report" class="p-2 hover:bg-slate-100 text-slate-500 rounded-lg transition-all"><i data-lucide="file-bar-chart" class="h-3.5 w-3.5"></i></button>
          </div>
        </td>
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
    const rc = {Teacher:'blue',Staff:'slate',HR:'purple',Admin:'slate',Principal:'indigo',VP:'indigo','Admission Admin':'teal','Student Portal Admin':'violet','Canteen Admin':'orange','Inventory Admin':'sky'};
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
    fetch('/views/TraceReportView.html')
      .then(r => r.text())
      .then(html => {
        document.getElementById('view-container').innerHTML = html;
        lucide.createIcons();
        loadTraceReport(teacherId);
        showLoading(false);
      })
      .catch(() => { showLoading(false); showToast('Failed to load report', 'error'); });
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

  // ── APPEARANCE / THEME TAB (Admin) ───────────────────────────────────────────
  function initThemeTab() {
    const box = document.getElementById('theme-settings-content');
    if (!box) return;
    const current = window.APP_THEME || DEFAULT_THEME;
    const baseStops = (current.mode === 'custom' && current.stops)
      ? current.stops
      : (THEME_PRESETS[current.preset] || THEME_PRESETS.aurora).stops;

    const presetCards = Object.entries(THEME_PRESETS).map(([key, p]) => {
      const grad = `linear-gradient(135deg, ${p.stops.join(', ')})`;
      const sel  = current.mode !== 'custom' && current.preset === key;
      return `<button onclick="applyThemePreset('${key}')" id="theme-card-${key}"
        class="rounded-2xl overflow-hidden border-2 ${sel ? 'border-blue-600' : 'border-transparent'} transition-all text-left shadow-sm hover:shadow-md">
        <div style="height:60px;background:${grad};"></div>
        <div class="flex items-center justify-between px-3 py-2 bg-white">
          <span class="text-xs font-black text-slate-700">${p.name}</span>
          <span class="flex gap-1">${p.accents.map(a => `<span style="width:9px;height:9px;border-radius:50%;background:${a};display:inline-block;"></span>`).join('')}</span>
        </div>
      </button>`;
    }).join('');

    const cs = [baseStops[0]||'#eaf2ff', baseStops[1]||'#f4f0ff', baseStops[2]||'#fdf1f9', baseStops[3]||'#eefcff'];
    box.innerHTML = `
      <div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm space-y-8">
        <div>
          <h3 class="text-lg font-black text-slate-800 mb-1">Appearance &amp; Theme</h3>
          <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">Pick a gradient — saving applies it across the whole portal for everyone</p>
        </div>
        <div>
          <p class="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Preset Palettes</p>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${presetCards}</div>
        </div>
        <div class="pt-6 border-t border-slate-100">
          <p class="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Custom Gradient</p>
          <p class="text-[10px] text-slate-400 font-bold mb-4">Choose four colours, left → right across the gradient.</p>
          <div class="flex flex-wrap items-end gap-4">
            ${cs.map((c,i) => `<div class="space-y-1">
              <label class="text-[9px] font-black text-slate-400 uppercase block">Color ${i+1}</label>
              <input type="color" id="theme-cc-${i}" value="${c}" oninput="previewCustomTheme()"
                class="w-14 h-14 rounded-xl border border-slate-200 cursor-pointer bg-white p-1">
            </div>`).join('')}
          </div>
          <div id="theme-custom-preview" class="mt-4 h-16 rounded-2xl border border-slate-200" style="background:linear-gradient(135deg, ${cs.join(', ')});"></div>
        </div>
        <div class="flex items-center justify-between pt-6 border-t border-slate-100">
          <button onclick="applyThemePreset('aurora')" class="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest">Reset to Aurora</button>
          <button onclick="saveCurrentTheme()" class="px-8 py-3 bg-blue-600 text-white text-[10px] font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest shadow-lg shadow-blue-500/20">Save for Everyone</button>
        </div>
      </div>`;
    lucide.createIcons();
  }

  function _markPresetSelected(selectedKey) {
    Object.keys(THEME_PRESETS).forEach(k => {
      const c = document.getElementById('theme-card-' + k);
      if (!c) return;
      const on = k === selectedKey;
      c.classList.toggle('border-blue-600', on);
      c.classList.toggle('border-transparent', !on);
    });
  }

  function applyThemePreset(key) {
    applyTheme({ mode: 'preset', preset: key });
    _markPresetSelected(key);
    // sync the custom colour pickers to this preset's stops
    const stops = (THEME_PRESETS[key] || THEME_PRESETS.aurora).stops;
    [0,1,2,3].forEach(i => { const inp = document.getElementById('theme-cc-' + i); if (inp && stops[i]) inp.value = stops[i]; });
    const prev = document.getElementById('theme-custom-preview');
    if (prev) prev.style.background = `linear-gradient(135deg, ${stops.slice(0,4).join(', ')})`;
  }

  function previewCustomTheme() {
    const stops = [0,1,2,3].map(i => (document.getElementById('theme-cc-' + i) || {}).value).filter(Boolean);
    if (stops.length < 2) return;
    applyTheme({ mode: 'custom', stops, accents: stops });
    const prev = document.getElementById('theme-custom-preview');
    if (prev) prev.style.background = `linear-gradient(135deg, ${stops.join(', ')})`;
    _markPresetSelected(null);
  }

  function saveCurrentTheme() {
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => { showLoading(false); showToast('Theme saved for everyone!'); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to save theme', 'error'); })
      .updateSystemSettings({ theme_gradient: window.APP_THEME || DEFAULT_THEME });
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
        const isClosed = g.status === 'closed';
        return `<div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
          <div class="flex items-start justify-between mb-5">
            <div>
              <h3 class="font-black text-slate-800 text-lg">${g.committee_name}</h3>
              ${g.sub_committee?`<p class="text-[10px] text-slate-400 font-bold uppercase mt-1">${g.sub_committee}</p>`:''}
              ${g.description?`<p class="text-[10px] text-slate-500 mt-1">${g.description}</p>`:''}
              ${g.date_of_creation?`<p class="text-[9px] text-slate-400 font-bold mt-1">Est. ${g.date_of_creation}</p>`:''}
            </div>
            <div class="flex flex-col items-end gap-1">
              ${isChairman?`<span class="px-3 py-1 bg-amber-100 text-amber-600 text-[10px] font-black uppercase rounded-full">Chairman</span>`:`<span class="px-3 py-1 bg-blue-100 text-blue-600 text-[10px] font-black uppercase rounded-full">Member</span>`}
              ${isClosed?`<span class="px-2 py-0.5 bg-red-100 text-red-600 text-[9px] font-black uppercase rounded-full">Closed</span>`:`<span class="px-2 py-0.5 bg-emerald-100 text-emerald-600 text-[9px] font-black uppercase rounded-full">Active</span>`}
            </div>
          </div>
          <div class="flex items-center gap-2 mb-5 text-sm font-bold text-slate-500"><i data-lucide="users" class="h-4 w-4"></i><span>${members.length} Member${members.length!==1?'s':''}</span></div>
          <div class="flex gap-2 mt-2">
            <button onclick="openCommEvalModal(${g.id},'${safeName}','${safeSub}',JSON.parse(this.dataset.members))" data-members="${safeMembers}" class="flex-1 py-3 bg-blue-600 text-white text-[10px] font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest">Evaluate</button>
            <button onclick="openCommChat(${g.id},'${safeName}','${safeSub}')" class="flex items-center gap-1.5 justify-center px-4 py-3 bg-emerald-600 text-white text-[10px] font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest"><i data-lucide="message-circle" class="h-3.5 w-3.5"></i> Chat</button>
            ${isChairman ? `<button onclick="openCommitteeEdit(${g.id})" class="flex items-center gap-1.5 justify-center px-4 py-3 bg-slate-100 text-slate-700 text-[10px] font-black rounded-2xl hover:bg-black hover:text-white transition-all uppercase tracking-widest"><i data-lucide="pencil" class="h-3.5 w-3.5"></i></button>` : ''}
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

  function _userComboHtml(q, disabledIds) {
    const list = (allUsersCache || []).filter(u => {
      const lbl = staffLabel(u.user_id).toLowerCase();
      return !q || lbl.includes(q) || u.user_id.toString().toLowerCase().includes(q);
    }).slice(0, 50);
    if (!list.length) return '<p class="px-4 py-3 text-[10px] text-slate-400 font-bold uppercase tracking-wider text-center">No results</p>';
    return list.map(u => {
      const staff = allStaffCache.find(s => s.teacher_id === u.user_id);
      const name  = staff && staff.full_name   ? staff.full_name   : u.user_id;
      const desig = staff && staff.designation ? staff.designation : '';
      const taken = disabledIds && disabledIds.includes(u.user_id);
      return `<div class="px-4 py-2.5 border-b border-slate-50 last:border-0 transition-colors${taken ? ' opacity-40 pointer-events-none' : ' cursor-pointer hover:bg-blue-50'}" data-uid="${u.user_id}">
        <p class="text-sm font-black text-slate-800">${name}${taken ? ' ✓' : ''}</p>
        <p class="text-[10px] text-slate-400 font-bold">${desig ? desig + ' · ' : ''}${u.user_id}</p>
      </div>`;
    }).join('');
  }

  function initCommitteeForm() {
    const form = document.getElementById('createCommForm');
    if (!form) return;
    const selectedDiv = document.getElementById('selectedMembers');
    let selectedIds = [];

    // ── Chairman combobox ──
    const cSearch = document.getElementById('chairmanSearchInput');
    const cHidden = document.getElementById('commChairman');
    const cDrop   = document.getElementById('chairmanDropdown');
    if (cSearch && cDrop) {
      cSearch.addEventListener('input', () => {
        if (cHidden) cHidden.value = '';
        cDrop.innerHTML = _userComboHtml(cSearch.value.trim().toLowerCase(), null);
        cDrop.classList.remove('hidden');
      });
      cSearch.addEventListener('focus', () => {
        cDrop.innerHTML = _userComboHtml(cSearch.value.trim().toLowerCase(), null);
        cDrop.classList.remove('hidden');
      });
      cSearch.addEventListener('blur', () => setTimeout(() => cDrop.classList.add('hidden'), 150));
      // mousedown fires before the input's blur, so a single click registers reliably
      cDrop.addEventListener('mousedown', e => {
        const item = e.target.closest('[data-uid]');
        if (!item) return;
        e.preventDefault();
        const uid = item.dataset.uid;
        const st  = allStaffCache.find(s => s.teacher_id === uid);
        const nm  = st && st.full_name   ? st.full_name   : uid;
        const dg  = st && st.designation ? ' — ' + st.designation : '';
        cSearch.value = nm + dg;
        if (cHidden) cHidden.value = uid;
        cDrop.classList.add('hidden');
      });
    }

    // ── Member combobox ──
    const mSearch = document.getElementById('commMemberSearch');
    const mDrop   = document.getElementById('memberDropdown');
    if (mSearch && mDrop) {
      mSearch.addEventListener('input', () => {
        mDrop.innerHTML = _userComboHtml(mSearch.value.trim().toLowerCase(), selectedIds);
        mDrop.classList.remove('hidden');
      });
      mSearch.addEventListener('focus', () => {
        mDrop.innerHTML = _userComboHtml(mSearch.value.trim().toLowerCase(), selectedIds);
        mDrop.classList.remove('hidden');
      });
      mSearch.addEventListener('blur', () => setTimeout(() => mDrop.classList.add('hidden'), 150));
      // mousedown fires before the input's blur, so a single click registers reliably
      mDrop.addEventListener('mousedown', e => {
        const item = e.target.closest('[data-uid]');
        if (!item) return;
        e.preventDefault();
        const uid = item.dataset.uid;
        if (!selectedIds.includes(uid)) {
          selectedIds.push(uid);
          renderSelectedMembers(selectedDiv, selectedIds);
        }
        mSearch.value = '';
        mDrop.classList.add('hidden');
        mSearch.focus();
      });
    }

    form.onsubmit = e => {
      e.preventDefault();
      const chairmanId = document.getElementById('commChairman')?.value;
      if (!chairmanId) { showToast('Please select a Chairman', 'error'); return; }
      const membersList = [
        { user_id: chairmanId, role: 'chairman', name: staffLabel(chairmanId) },
        ...selectedIds.filter(id => id !== chairmanId).map(id => ({ user_id: id, role: 'member', name: staffLabel(id) }))
      ];
      const fd = new FormData(form);
      showLoading(true);
      google.script.run
        .withSuccessHandler(() => {
          showLoading(false); showToast('Committee created!');
          form.reset();
          if (cSearch) cSearch.value = '';
          if (cHidden) cHidden.value = '';
          selectedIds = [];
          renderSelectedMembers(selectedDiv, []);
          loadCommitteeData();
        })
        .withFailureHandler(() => { showLoading(false); showToast('Failed to create committee', 'error'); })
        .createCommittee({ committee_name: fd.get('committee_name'), sub_committee: fd.get('sub_committee') || null, members_list: membersList, description: fd.get('description') || null, date_of_creation: fd.get('date_of_creation') || null, status: 'active' });
    };
  }

  function renderSelectedMembers(div, ids) {
    if (!div) return;
    if (!ids.length) { div.innerHTML = `<p class="text-slate-400 text-[10px] font-bold uppercase italic self-center mx-auto">No members added yet</p>`; return; }
    div.innerHTML = ids.map(id => `<span class="flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black">${staffLabel(id)}<button type="button" data-rm="${id}" class="hover:text-red-500 font-black leading-none">×</button></span>`).join('');
    div.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = ids.indexOf(btn.dataset.rm);
        if (i !== -1) ids.splice(i, 1);
        renderSelectedMembers(div, ids);
      });
    });
  }

  function loadCommitteeData() {
    google.script.run.withSuccessHandler(groups => {
      const tbody = document.getElementById('committeeListBody');
      if (!tbody) return;
      if (!Array.isArray(groups) || !groups.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-slate-400 text-xs font-black uppercase tracking-widest">No committees registered</td></tr>`;
        return;
      }
      const myId   = window.APP_USER && window.APP_USER.user_id;
      const myRole = window.ACTIVE_ROLE;
      const canEditAll = ['Admin','HR','VP'].includes(myRole);
      const archivedList  = groups.filter(g => g.status === 'archived');
      const visibleGroups = _showArchived ? groups : groups.filter(g => g.status !== 'archived');
      let rowsHtml = visibleGroups.map(g => {
        const m   = g.members_list || [];
        const ch  = m[0];
        const isChairman   = myId && ch && ch.user_id === myId;
        const canEditThis  = canEditAll || isChairman;
        const members      = m.slice(1);
        const canChat = canEditAll || m.some(x => x.user_id === myId) || ['Principal'].includes(myRole);
        const safeName = (g.committee_name||'').replace(/'/g,"\\'");
        const isArchived = g.status === 'archived';
        const isClosed   = g.status === 'closed';
        const statusBadge = isArchived
          ? `<span class="px-2.5 py-1 bg-purple-100 text-purple-600 rounded-full text-[10px] font-black uppercase">Archived</span>`
          : isClosed
          ? `<span class="px-2.5 py-1 bg-red-100 text-red-600 rounded-full text-[10px] font-black uppercase">Closed</span>`
          : `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-600 rounded-full text-[10px] font-black uppercase">Active</span>`;
        const dateStr = g.date_of_creation ? `<span class="ml-1 px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[9px] font-bold">${g.date_of_creation}</span>` : '';
        const actionCell = `<td class="px-4 py-4">
          <div class="flex items-center justify-end gap-2 flex-wrap">
            ${canChat ? `<button onclick="openCommChat(${g.id},'${safeName}')" class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="message-circle" class="h-3 w-3"></i> Chat
            </button>` : ''}
            ${canEditThis ? `<button onclick="openCommitteeEdit(${g.id})" class="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="pencil" class="h-3 w-3"></i> Edit
            </button>` : ''}
            ${isChairman && !isClosed && !isArchived ? `<button onclick="showConfirm('Close activity for this committee?',()=>closeCommitteeActivity(${g.id}))" class="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-600 hover:text-white text-amber-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="circle-x" class="h-3 w-3"></i> Close
            </button>` : ''}
            ${canEditAll && isClosed ? `<button onclick="showConfirm('Archive this committee? It will move out of the active list.',()=>archiveCommittee(${g.id}))" class="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-600 hover:text-white text-purple-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="archive" class="h-3 w-3"></i> Archive
            </button>` : ''}
            ${canEditAll && isArchived ? `<button onclick="unarchiveCommittee(${g.id})" class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-700 hover:text-white text-slate-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="archive-restore" class="h-3 w-3"></i> Restore
            </button>` : ''}
            ${canEditAll ? `<button onclick="showConfirm('Delete this committee? This cannot be undone.',()=>deleteCommittee(${g.id}))" class="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-600 hover:text-white text-red-500 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
              <i data-lucide="trash-2" class="h-3 w-3"></i> Delete
            </button>` : ''}
          </div>
        </td>`;
        return `<tr class="hover:bg-slate-50 border-b border-slate-100">
          <td class="px-6 py-4" data-label="Committee Name">
            <p class="font-black text-slate-800 text-sm">${g.committee_name}</p>
            ${g.sub_committee ? `<p class="text-[10px] text-slate-400 font-bold mt-0.5">${g.sub_committee}</p>` : ''}
            ${g.description ? `<p class="text-[10px] text-slate-400 mt-0.5">${g.description}</p>` : ''}
            ${dateStr}
          </td>
          <td class="px-6 py-4" data-label="Chairman">
            <span class="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-black">${ch?.name || ch?.user_id || '—'}</span>
          </td>
          <td class="px-6 py-4" data-label="Members">
            <div class="flex flex-wrap gap-1">${members.map(x => `<span class="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold">${x.name || x.user_id}</span>`).join('')}</div>
          </td>
          <td class="px-6 py-4" data-label="Status">${statusBadge}</td>
          ${actionCell.replace('<td class="px-4 py-4">', '<td class="px-4 py-4" data-label="Actions">')}
        </tr>`;
      }).join('');
      if (archivedList.length) {
        rowsHtml += `<tr><td colspan="5" class="px-6 py-3 text-center" style="background:rgba(248,250,252,.5);">
          <button onclick="toggleArchivedView()" class="inline-flex items-center gap-1.5 text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest">
            <i data-lucide="${_showArchived ? 'eye-off' : 'archive'}" class="h-3 w-3"></i> ${_showArchived ? 'Hide' : 'Show'} ${archivedList.length} archived
          </button></td></tr>`;
      }
      tbody.innerHTML = rowsHtml;
      _committeeCache = groups;
      lucide.createIcons();
    }).getUserCommittees();
  }

  let _showArchived = false;
  function toggleArchivedView() { _showArchived = !_showArchived; loadCommitteeData(); }

  function archiveCommittee(id) {
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => { showLoading(false); showToast('Committee archived.'); loadCommitteeData(); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to archive', 'error'); })
      .archiveCommittee(id);
  }

  function unarchiveCommittee(id) {
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => { showLoading(false); showToast('Committee restored.'); loadCommitteeData(); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to restore', 'error'); })
      .unarchiveCommittee(id);
  }

  function deleteCommittee(id) {
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => { showLoading(false); showToast('Committee deleted.'); loadCommitteeData(); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to delete committee', 'error'); })
      .deleteCommittee(id);
  }

  function closeCommitteeActivity(id) {
    showLoading(true);
    google.script.run
      .withSuccessHandler(() => { showLoading(false); showToast('Committee activity closed.'); loadCommitteeData(); if (document.getElementById('committeeCards')) renderMyCommitteeCards(); })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to close committee activity', 'error'); })
      .closeCommitteeActivity(id);
  }

  // Store committees data for edit lookup
  let _committeeCache = [];
  function _refreshCommitteeCache(cb) {
    google.script.run.withSuccessHandler(groups => {
      _committeeCache = Array.isArray(groups) ? groups : [];
      if (cb) cb();
    }).getUserCommittees();
  }

  function _ensureCommEditModal() {
    if (document.getElementById('commEditModal')) return;
    const el = document.createElement('div');
    el.id = 'commEditModal';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);';
    el.onclick = e => { if (e.target === el) closeCommitteeEdit(); };
    el.innerHTML = `
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
              <div class="relative">
                <input type="text" id="editChairmanSearch" placeholder="Search by name or designation…" autocomplete="off"
                  class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-edit-chairman-search">
                <input type="hidden" id="commEditChairman">
                <div id="editChairmanDrop" class="hidden absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden" style="max-height:220px;overflow-y:auto;"></div>
              </div>
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Add Member</label>
              <div class="relative">
                <input type="text" id="commEditMemberSearch" placeholder="Search by name or designation…" autocomplete="off"
                  class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-comm-edit-member-search">
                <div id="editMemberDrop" class="hidden absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden" style="max-height:220px;overflow-y:auto;"></div>
              </div>
            </div>
          </div>
          <div>
            <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Members</label>
            <div id="commEditMembers" class="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-2xl min-h-[44px]"></div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Date of Creation</label>
              <input type="date" id="commEditDateOfCreation" class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm">
            </div>
            <div>
              <label class="text-[10px] font-black text-slate-400 uppercase mb-1.5 block">Description (Optional)</label>
              <textarea id="commEditDescription" rows="2" placeholder="Brief description…" class="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-sm resize-none"></textarea>
            </div>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button onclick="closeCommitteeEdit()" class="px-6 py-2.5 border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-all">Cancel</button>
            <button onclick="saveCommitteeEdit()" class="px-8 py-2.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-lg shadow-blue-500/20 hover:bg-black transition-all">Save Changes</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  function openCommitteeEdit(id) {
    _ensureCommEditModal();
    // Find from cache or re-fetch
    const open = (groups) => {
      const g = groups.find(x => x.id === id);
      if (!g) { showToast('Committee not found', 'error'); return; }
      const m = g.members_list || [];
      const ch = m[0];
      document.getElementById('commEditId').value  = g.id;
      document.getElementById('commEditName').value = g.committee_name || '';
      document.getElementById('commEditSub').value  = g.sub_committee  || '';
      const docEl = document.getElementById('commEditDescription');
      if (docEl) docEl.value = g.description || '';
      const dateEl = document.getElementById('commEditDateOfCreation');
      if (dateEl) dateEl.value = g.date_of_creation || '';

      // Set current chairman in combobox
      const chairHid  = document.getElementById('commEditChairman');
      const chairSrch = document.getElementById('editChairmanSearch');
      const chairDrop = document.getElementById('editChairmanDrop');
      if (chairHid)  chairHid.value  = ch ? ch.user_id : '';
      if (chairSrch && ch) {
        const st = allStaffCache.find(s => s.teacher_id === ch.user_id);
        const nm = st && st.full_name   ? st.full_name   : (ch.name || ch.user_id);
        const dg = st && st.designation ? ' — ' + st.designation : '';
        chairSrch.value = nm + dg;
      }
      // Wire chairman combobox (reassign each open to avoid stale closures)
      if (chairSrch && chairDrop) {
        chairSrch.oninput = () => {
          if (chairHid) chairHid.value = '';
          chairDrop.innerHTML = _userComboHtml(chairSrch.value.trim().toLowerCase(), null);
          chairDrop.classList.remove('hidden');
        };
        chairSrch.onfocus = () => {
          chairDrop.innerHTML = _userComboHtml(chairSrch.value.trim().toLowerCase(), null);
          chairDrop.classList.remove('hidden');
        };
        chairSrch.onblur = () => setTimeout(() => chairDrop.classList.add('hidden'), 150);
        chairDrop.onclick = e => {
          const item = e.target.closest('[data-uid]');
          if (!item) return;
          const uid = item.dataset.uid;
          const st  = allStaffCache.find(s => s.teacher_id === uid);
          const nm  = st && st.full_name   ? st.full_name   : uid;
          const dg  = st && st.designation ? ' — ' + st.designation : '';
          chairSrch.value = nm + dg;
          if (chairHid) chairHid.value = uid;
          chairDrop.classList.add('hidden');
        };
      }

      // Render existing members (exclude chairman)
      _editMemberIds = m.slice(1).map(x => x.user_id);
      _renderEditMembers();

      // Wire member combobox (reassign each open)
      const ms     = document.getElementById('commEditMemberSearch');
      const msDrop = document.getElementById('editMemberDrop');
      if (ms && msDrop) {
        ms.oninput = () => {
          msDrop.innerHTML = _userComboHtml(ms.value.trim().toLowerCase(), _editMemberIds);
          msDrop.classList.remove('hidden');
        };
        ms.onfocus = () => {
          msDrop.innerHTML = _userComboHtml(ms.value.trim().toLowerCase(), _editMemberIds);
          msDrop.classList.remove('hidden');
        };
        ms.onblur = () => setTimeout(() => msDrop.classList.add('hidden'), 150);
        msDrop.onclick = e => {
          const item = e.target.closest('[data-uid]');
          if (!item) return;
          const uid = item.dataset.uid;
          if (!_editMemberIds.includes(uid)) {
            _editMemberIds.push(uid);
            _renderEditMembers();
          }
          ms.value = '';
          msDrop.classList.add('hidden');
        };
      }

      document.getElementById('commEditModal').style.display = '';
    };

    const proceed = () => {
      if (_committeeCache.length) { open(_committeeCache); }
      else { _refreshCommitteeCache(() => open(_committeeCache)); }
    };

    if (allUsersCache.length) { proceed(); }
    else {
      google.script.run.withSuccessHandler(data => {
        allUsersCache = Array.isArray(data) ? data : [];
        proceed();
      }).withFailureHandler(() => proceed()).getAppUsers();
    }
  }

  let _editMemberIds = [];
  function _renderEditMembers() {
    const div = document.getElementById('commEditMembers');
    if (!div) return;
    if (!_editMemberIds.length) { div.innerHTML = `<p class="text-slate-400 text-[10px] font-bold italic self-center">No additional members</p>`; return; }
    div.innerHTML = _editMemberIds.map(id => {
      const u = (allUsersCache || []).find(x => x.user_id === id);
      const label = u ? (u.full_name || u.user_id) : id;
      return `<span class="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black" data-mid="${id}">
        ${label}
        <button type="button" class="hover:text-red-500 font-black leading-none" data-remove="${id}">×</button>
      </span>`;
    }).join('');
    div.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => {
        const mid = btn.dataset.remove;
        _editMemberIds = _editMemberIds.filter(x => x !== mid);
        _renderEditMembers();
      };
    });
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
        if (document.getElementById('committeeListBody')) loadCommitteeData();
        if (document.getElementById('committeeCards')) renderMyCommitteeCards();
      })
      .withFailureHandler(() => { showLoading(false); showToast('Failed to update committee', 'error'); })
      .updateCommittee(id, { committee_name: name, sub_committee: sub, members_list: membersList, description: document.getElementById('commEditDescription')?.value.trim() || null, date_of_creation: document.getElementById('commEditDateOfCreation')?.value || null });
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
        _setChatReadOnly(data.status === 'closed' || data.status === 'archived', data.status);
      })
      .withFailureHandler(() => { if (area) area.innerHTML=`<p style="text-align:center;color:#f87171;font-size:.7rem;padding:2rem;">Failed to load</p>`; })
      .getCommitteeChat(_chatCommId);
  }

  // Lock the composer when the committee activity is closed/archived — messages stay visible
  function _setChatReadOnly(readOnly, status) {
    const input = document.getElementById('chatInput');
    const composer = input ? input.parentElement : null;        // the input+send row
    let notice = document.getElementById('chatClosedNotice');
    if (readOnly) {
      if (composer) composer.style.display = 'none';
      const drop = document.getElementById('chatMentionDrop');
      if (drop) drop.style.display = 'none';
      if (!notice && composer && composer.parentElement) {
        notice = document.createElement('div');
        notice.id = 'chatClosedNotice';
        notice.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.85rem;font-size:.65rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#b45309;background:#fffbeb;border-top:1px solid #fde68a;';
        notice.innerHTML = `<i data-lucide="lock" style="width:.85rem;height:.85rem;"></i> Activity ${status === 'archived' ? 'archived' : 'closed'} · chat is read-only`;
        composer.parentElement.appendChild(notice);
        lucide.createIcons();
      } else if (notice) {
        notice.style.display = '';
      }
    } else {
      if (composer) composer.style.display = '';
      if (notice) notice.style.display = 'none';
    }
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
    // Resolve @mentions → member user_ids so the backend can notify them
    const mentions = [];
    text.split(/(@\S+)/g).forEach(part => {
      if (!part.startsWith('@')) return;
      const word = part.slice(1).replace(/[.,!?;:]+$/, '');   // strip trailing punctuation
      const m = _memberByMention(word);
      if (m && m.user_id !== me.user_id) mentions.push(m.user_id);
    });
    const uniqMentions = [...new Set(mentions)];
    if (input) input.value = '';
    cancelChatReply();
    document.getElementById('chatMentionDrop').style.display = 'none';
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error === 'closed') { showToast(res.message || 'Chat is read-only', 'error'); _loadChatMessages(); return; }
        _loadChatMessages();
      })
      .withFailureHandler(() => showToast('Failed to send','error'))
      .sendCommitteeMessage(_chatCommId, msg, uniqMentions, _displayName(me.user_id));
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
    const tabNames = ['personal','education','career','parents','spouse','children','financial','travel'];
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
    alignPhotoCardDesktop();
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
    alignPhotoCardDesktop();
  }

  function setProfileFontSize(n) {
    const root = document.getElementById('profileRoot');
    if (!root) return;
    [1,2,3,4,5].forEach(i => root.classList.remove('fs-' + i));
    if (n !== 3) root.classList.add('fs-' + n);
    // Sync both dropdowns
    const sel1 = document.getElementById('fontSizeSelect');
    const sel2 = document.getElementById('fontSizeSelectSticky');
    if (sel1) sel1.value = n;
    if (sel2) sel2.value = n;
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
    alignPhotoCardDesktop();
  }

  // Desktop only: drop the photo card down so it begins where the section
  // tab bar ends (aligned with the first form section, not the tab bar's top).
  function alignPhotoCardDesktop() {
    const photoHeader = document.getElementById('photoHeader');
    if (!photoHeader) return;
    if (window.innerWidth < 768) { photoHeader.style.marginTop = ''; return; }

    const editMode = document.getElementById('profileEditMode');
    const tabBar   = document.getElementById('profileTabBar');
    // Preview mode (edit/tab bar hidden) → align photo to the top
    if (!editMode || editMode.offsetParent === null || !tabBar || tabBar.offsetParent === null) {
      photoHeader.style.marginTop = '';
      return;
    }
    let offset = 0;
    const banner = document.getElementById('profileLockBanner');
    if (banner && banner.offsetParent !== null) offset += banner.offsetHeight + 12; // mb-3
    offset += tabBar.offsetHeight + 12; // mb-3
    photoHeader.style.marginTop = offset + 'px';
  }

  // Recalculate on resize (debounced)
  let _alignPhotoTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_alignPhotoTimer);
    _alignPhotoTimer = setTimeout(alignPhotoCardDesktop, 150);
  });

  // Photo header: smooth scroll-driven shrink — mobile only (desktop uses CSS grid)
  function setupPhotoHeaderScroll() {
    if (window.innerWidth >= 768) return;
    const photoHeader  = document.getElementById('photoHeader');
    const photoPanel   = document.getElementById('photoPanelLarge');
    const actionBtns   = document.getElementById('actionButtons');
    const fontSizeWrap = document.getElementById('fontSizeWrap');
    const photoHint    = document.getElementById('photoHint');
    const photoStatus  = document.getElementById('photoStatusText');
    const previewLabel = document.getElementById('previewLabel');
    const printLabel   = document.getElementById('printLabel');
    const tabBar       = document.getElementById('profileTabBar');
    if (!photoHeader || !photoPanel) return;

    const scroller   = document.querySelector('main .overflow-y-auto');
    if (!scroller) return;

    const SIZE_LARGE  = 160;
    const SIZE_SMALL  = 50;
    const PAD_LARGE   = 16;
    const PAD_SMALL   = 8;
    const GAP_LARGE   = 16;
    const GAP_SMALL   = 8;
    const SCROLL_FROM = 40;   // start shrinking after 40px
    const SCROLL_TO   = 220;  // fully small at 220px

    scroller.addEventListener('scroll', () => {
      const t     = scroller.scrollTop;
      const ratio = Math.min(1, Math.max(0, (t - SCROLL_FROM) / (SCROLL_TO - SCROLL_FROM)));

      // Photo width — linear interpolation
      const size = Math.round(SIZE_LARGE - (SIZE_LARGE - SIZE_SMALL) * ratio);
      photoPanel.style.width = size + 'px';

      // Padding + gap
      const pad = (PAD_LARGE - (PAD_LARGE - PAD_SMALL) * ratio).toFixed(1);
      const gap = (GAP_LARGE - (GAP_LARGE - GAP_SMALL) * ratio).toFixed(1);
      photoHeader.style.padding = pad + 'px';
      photoHeader.style.gap     = gap + 'px';

      // Tab bar top = current photo header height so it sticks below it
      if (tabBar) tabBar.style.top = photoHeader.offsetHeight + 'px';

      // At halfway+: switch action buttons to row layout
      const compact = ratio > 0.5;
      if (actionBtns) {
        actionBtns.style.flexDirection  = compact ? 'row'    : 'column';
        actionBtns.style.alignItems     = compact ? 'center' : 'stretch';
        actionBtns.style.flexWrap       = compact ? 'wrap'   : 'nowrap';
      }
      // Hide labels and font size wrap in compact mode
      if (previewLabel) previewLabel.style.display = compact ? 'none' : '';
      if (printLabel)   printLabel.style.display   = compact ? 'none' : '';
      if (fontSizeWrap) fontSizeWrap.style.display  = compact ? 'none' : '';
      if (photoHint)    photoHint.style.display     = size < 80  ? 'none' : '';
      if (photoStatus)  photoStatus.style.display   = size < 80  ? 'none' : '';
    }, { passive: true });

    // Set initial tab bar top before any scroll
    if (tabBar) tabBar.style.top = photoHeader.offsetHeight + 'px';
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
    const url = fileId.startsWith('http') ? fileId : 'https://lh3.googleusercontent.com/d/' + fileId;
    // Main photo box
    const img = document.getElementById('photoPreviewImg');
    const ph  = document.getElementById('photoPlaceholder');
    if (img) {
      img.src = url;
      img.classList.remove('hidden');
      if (ph) ph.classList.add('hidden');
      img.dataset.fileId = fileId;
    }
    // Mobile top-bar avatar
    const avatar    = document.getElementById('mobileUserAvatar');
    const avatarPh  = document.getElementById('mobileUserAvatarPh');
    if (avatar) {
      avatar.src = url;
      avatar.classList.remove('hidden');
      if (avatarPh) avatarPh.classList.add('hidden');
    }
  }

  function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Hard limit: reject originals over 5 MB
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photo must be under 5 MB.', 'error');
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
        // Center-crop to square on a canvas, cap at 500×500 px
        const side     = Math.min(img.width, img.height);
        const sx       = Math.floor((img.width  - side) / 2);
        const sy       = Math.floor((img.height - side) / 2);
        const canvasPx = Math.min(side, 500);

        const canvas   = document.createElement('canvas');
        canvas.width   = canvasPx;
        canvas.height  = canvasPx;
        const ctx      = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, canvasPx, canvasPx);

        const TARGET = 130 * 1024;   // 130 KB

        // Try decreasing quality until output is within 130 KB
        let base64 = '';
        for (const q of [0.85, 0.70, 0.55, 0.40, 0.28]) {
          base64 = canvas.toDataURL('image/jpeg', q);
          const approxBytes = Math.ceil((base64.length - base64.indexOf(',') - 1) * 0.75);
          if (approxBytes <= TARGET) break;
        }

        const finalBytes = Math.ceil((base64.length - base64.indexOf(',') - 1) * 0.75);
        if (finalBytes > TARGET) {
          if (overlay)    { overlay.classList.add('hidden'); overlay.style.display = ''; }
          if (statusText) statusText.textContent = 'Too large';
          showToast('Could not compress photo under 130 KB. Please use a smaller image.', 'error');
          return;
        }

        if (statusText) statusText.textContent = 'Uploading...';

        // deterministic name → re-uploads overwrite the same file instead of piling up
        const fname = 'photo_' + tid + '.jpg';
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
    const photoSrc  = photoId ? (photoId.startsWith('http') ? photoId : 'https://lh3.googleusercontent.com/d/' + photoId) : '';
    const photoHtml = photoSrc
  ? `
    <img
      src="${photoSrc}"
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

  // ═══════════════════════════════════════════════════════
  //  NOTIFICATIONS
  // ═══════════════════════════════════════════════════════

  function refreshNotifBadge() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run.withSuccessHandler(notifs => {
      const unread = Array.isArray(notifs) ? notifs.filter(n => !n.is_read).length : 0;
      const badge = document.getElementById('notifBadge');
      if (!badge) return;
      if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }).withFailureHandler(() => {}).getMyNotifications(myId);
  }

  function openNotificationsPanel() {
    loadNotificationsView();
  }

  function loadNotificationsView() {
    _setViewHash('notifications');
    setActiveNavLink('nav-notifications');
    const container = document.getElementById('view-container');
    if (!container) return;
    document.getElementById('content-header-title').textContent = 'Notifications';
    const icon = document.getElementById('content-header-icon');
    if (icon) icon.setAttribute('data-lucide','bell');
    lucide.createIcons();

    container.innerHTML = `
      <div class="pt-6 space-y-4">
        <div class="flex items-center justify-between mb-4">
          <p class="font-black text-slate-800 text-sm uppercase tracking-widest">Your Notifications</p>
          <button onclick="markAllNotificationsRead()" class="flex items-center gap-1.5 px-4 py-2 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest">
            <i data-lucide="check-check" class="h-3 w-3"></i> Mark All Read
          </button>
        </div>
        <div id="notifList" class="space-y-2">
          <div class="text-center py-8 text-slate-400 text-xs font-black uppercase tracking-widest">Loading notifications…</div>
        </div>
      </div>`;
    lucide.createIcons();

    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run.withSuccessHandler(notifs => {
      const list = document.getElementById('notifList');
      if (!list) return;
      if (!Array.isArray(notifs) || !notifs.length) {
        list.innerHTML = `<div class="text-center py-12 text-slate-300 text-xs font-black uppercase tracking-widest">No notifications yet</div>`;
        return;
      }
      list.innerHTML = notifs.map(n => {
        const isUnread = !n.is_read;
        const timeStr = n.created_at ? new Date(n.created_at).toLocaleString('en-BD',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) : '—';
        return `<div class="flex items-start gap-4 p-4 rounded-2xl border transition-all ${isUnread ? 'bg-blue-50 border-blue-200 border-l-4' : 'bg-white border-slate-100 hover:bg-slate-50'}">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isUnread ? 'bg-blue-100' : 'bg-slate-100'}">
            <i data-lucide="bell" class="h-3.5 w-3.5 ${isUnread ? 'text-blue-600' : 'text-slate-400'}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-black text-slate-800 text-sm">${n.title||'Notification'}</p>
            <p class="text-xs text-slate-500 font-bold mt-0.5">${n.message||''}</p>
            <p class="text-[10px] text-slate-400 mt-1">${timeStr}</p>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <span class="px-2 py-0.5 text-[9px] font-black uppercase rounded-full ${isUnread ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}">${isUnread ? 'Unread' : 'Read'}</span>
            ${isUnread ? `<button onclick="markNotifRead('${n.id}')" class="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest">Mark Read</button>` : ''}
          </div>
        </div>`;
      }).join('');
      lucide.createIcons();
    }).withFailureHandler(() => {
      const list = document.getElementById('notifList');
      if (list) list.innerHTML = `<div class="text-center py-8 text-red-400 text-xs font-black uppercase">Failed to load notifications</div>`;
    }).getMyNotifications(myId);
  }

  function markNotifRead(id) {
    google.script.run.withSuccessHandler(() => {
      loadNotificationsView();
      refreshNotifBadge();
    }).withFailureHandler(() => showToast('Failed to mark read', 'error')).markNotificationRead(id);
  }

  function markAllNotificationsRead() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run.withSuccessHandler(() => {
      showToast('All notifications marked as read');
      loadNotificationsView();
      refreshNotifBadge();
    }).withFailureHandler(() => showToast('Failed', 'error')).markAllNotificationsRead(myId);
  }

  // ═══════════════════════════════════════════════════════
  //  USERS DIRECTORY
  // ═══════════════════════════════════════════════════════

  let _allUsersCache = [];

  function _presenceInfo(lastActiveStr) {
    if (!lastActiveStr) return { cls: 'bg-slate-300', label: 'Never active' };
    const diffMin = Math.floor((Date.now() - new Date(lastActiveStr).getTime()) / 60000);
    if (diffMin < 5)  return { cls: 'bg-emerald-400', label: 'Active now' };
    if (diffMin < 60) return { cls: 'bg-amber-400',   label: diffMin + 'm ago' };
    const diffHr = Math.floor(diffMin / 60);
    return { cls: 'bg-slate-300', label: diffHr < 24 ? diffHr + 'h ago' : Math.floor(diffHr/24) + 'd ago' };
  }

  function _renderUserCards(users) {
    const grid = document.getElementById('usersGrid');
    if (!grid) return;
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!users.length) {
      grid.innerHTML = `<div class="col-span-3 text-center py-12 text-slate-300 text-xs font-black uppercase">No users found</div>`;
      return;
    }
    grid.innerHTML = users.map(u => {
      const { cls, label } = _presenceInfo(u.last_active);
      const roles = (u.role||'').split(',').map(r=>r.trim()).filter(Boolean);
      const roleChips = roles.map(r => `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] font-black rounded-full uppercase">${r}</span>`).join('');
      const photoSrc = u.photo_url ? (u.photo_url.startsWith('http') ? u.photo_url : 'https://lh3.googleusercontent.com/d/' + u.photo_url) : '';
      const avatarHtml = photoSrc
        ? `<img src="${photoSrc}" class="w-full h-full object-cover absolute inset-0" onerror="this.style.display='none'">`
        : `<i data-lucide="user" class="h-5 w-5 text-white"></i>`;
      const isSelf = u.user_id === myId;
      const rawNum = (u.whatsapp || u.phone || '').trim();
      const waNum  = rawNum.replace(/\D/g, '');   // digits only for wa.me URL
      const telNum = rawNum.replace(/[\s\-()]/g, ''); // keep + for tel:
      return `<div class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col gap-3">
        <div class="flex items-center gap-3">
          <div class="relative shrink-0">
            <div class="w-12 h-12 rounded-xl overflow-hidden relative bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center">
              ${avatarHtml}
            </div>
            <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${cls}"></span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-black text-slate-800 text-sm truncate">${u.full_name || u.user_id || '—'}</p>
            ${u.designation ? `<p class="text-[10px] text-blue-600 font-black uppercase tracking-wide truncate">${u.designation}</p>` : ''}
            ${rawNum ? `<div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-[9px] text-slate-400 font-bold select-all">${rawNum}</span>
              <a href="tel:${telNum}" title="Call" class="text-slate-300 hover:text-blue-600 transition-colors"><i data-lucide="phone" class="h-3 w-3"></i></a>
              <a href="https://wa.me/${waNum}" target="_blank" title="WhatsApp" class="text-slate-300 hover:text-emerald-500 transition-colors"><i data-lucide="message-circle" class="h-3 w-3"></i></a>
            </div>` : ''}
          </div>
        </div>
        <div class="flex flex-wrap gap-1">${roleChips || '<span class="text-[9px] text-slate-300 font-bold">No role</span>'}</div>
        <div class="flex items-center justify-between pt-1 border-t border-slate-100">
          <span class="text-[9px] text-slate-400 font-bold">${label}</span>
          ${!isSelf ? `<button onclick="openDirectMessage('${u.user_id}','${(u.full_name||u.user_id).replace(/'/g,"\\'")}','${photoSrc.replace(/'/g,"\\'")}')"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-600 hover:text-white text-blue-600 text-[9px] font-black rounded-xl transition-all uppercase tracking-widest">
            <i data-lucide="send" class="h-3 w-3"></i> Message
          </button>` : `<span class="text-[9px] text-emerald-600 font-black uppercase">You</span>`}
        </div>
      </div>`;
    }).join('');
    lucide.createIcons();
  }

  function loadUsersDirectory() {
    _setViewHash('users');
    setActiveNavLink('nav-users-directory');
    const container = document.getElementById('view-container');
    if (!container) return;
    document.getElementById('content-header-title').textContent = 'Users Directory';
    const icon = document.getElementById('content-header-icon');
    if (icon) icon.setAttribute('data-lucide','users');
    lucide.createIcons();

    container.innerHTML = `
      <div class="pt-4 flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <div class="relative flex-1 max-w-sm">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none"></i>
            <input id="userDirSearch" type="text" placeholder="Search by name, role, designation…"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-userdir-search"
              oninput="filterUserDirectory(this.value)"
              class="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-600 transition-all">
          </div>
          <span id="userDirCount" class="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0"></span>
        </div>
        <div id="usersGrid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div class="col-span-3 text-center py-12 text-slate-400 text-xs font-black uppercase tracking-widest">Loading users…</div>
        </div>
      </div>`;
    lucide.createIcons();

    google.script.run
      .withSuccessHandler(users => {
        _allUsersCache = Array.isArray(users) ? users : [];
        const count = document.getElementById('userDirCount');
        if (count) count.textContent = _allUsersCache.length + ' users';
        _renderUserCards(_allUsersCache);
      })
      .withFailureHandler(() => {
        const grid = document.getElementById('usersGrid');
        if (grid) grid.innerHTML = `<div class="col-span-3 text-center py-8 text-red-400 text-xs font-black uppercase">Failed to load users</div>`;
      })
      .getAllUsersWithPresence();
  }

  function filterUserDirectory(q) {
    const term = (q||'').toLowerCase().trim();
    const count = document.getElementById('userDirCount');
    if (!term) {
      if (count) count.textContent = _allUsersCache.length + ' users';
      _renderUserCards(_allUsersCache);
      return;
    }
    const filtered = _allUsersCache.filter(u =>
      (u.full_name||'').toLowerCase().includes(term) ||
      (u.designation||'').toLowerCase().includes(term) ||
      (u.role||'').toLowerCase().includes(term) ||
      (u.email||'').toLowerCase().includes(term) ||
      (u.user_id||'').toLowerCase().includes(term)
    );
    if (count) count.textContent = filtered.length + ' / ' + _allUsersCache.length + ' users';
    _renderUserCards(filtered);
  }

  // ═══════════════════════════════════════════════════════
  //  MESSAGING CENTER — two-pane inbox + conversation threads
  // ═══════════════════════════════════════════════════════

  let _msgConvCache   = [];     // conversations from getMessagingOverview
  let _msgPeopleCache = [];     // all faculty (for starting new chats)
  let _activePartnerId = null;  // currently open conversation
  let _msgThreadPoll  = null;
  let _msgListPoll    = null;
  let _lastUnreadDm   = 0;
  let _sbClient       = null;   // Supabase Realtime client
  let _sbChannel      = null;   // own broadcast channel subscription

  function _photoUrl(raw) {
    if (!raw) return '';
    return raw.startsWith('http') ? raw : 'https://lh3.googleusercontent.com/d/' + raw;
  }

  // Avatar markup: photo if available, else gradient + initial
  function _avatar(name, photo, sizeClass, presenceCls) {
    const src = _photoUrl(photo);
    const inner = src
      ? `<img src="${src}" class="w-full h-full object-cover absolute inset-0" onerror="this.style.display='none'">`
      : `<span class="text-white font-black">${(name||'?').trim().charAt(0).toUpperCase()}</span>`;
    const dot = presenceCls ? `<span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${presenceCls}"></span>` : '';
    return `<div class="relative shrink-0">
      <div class="${sizeClass} rounded-xl overflow-hidden relative bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center">${inner}</div>
      ${dot}
    </div>`;
  }

  // Smart timestamps. compact = short form for list rows.
  function _smartTime(dateStr, compact) {
    if (!dateStr) return '';
    const d = new Date(dateStr), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate()-1);
    const isYest = d.toDateString() === yest.toDateString();
    const t = d.toLocaleTimeString('en-BD',{hour:'2-digit',minute:'2-digit',hour12:true});
    if (sameDay) return t;
    if (isYest)  return compact ? 'Yesterday' : 'Yesterday ' + t;
    const sameYear = d.getFullYear() === now.getFullYear();
    const dateP = d.toLocaleDateString('en-BD',{day:'2-digit',month:'short',...(sameYear?{}:{year:'numeric'})});
    return compact ? dateP : dateP + ' ' + t;
  }

  function _partnerInfo(id) {
    return _msgConvCache.find(c => c.partner_id === id)
        || _msgPeopleCache.find(p => p.user_id === id)
        || { full_name: id, photo_url: null, designation: null, last_active: null };
  }

  // ── Main view ──────────────────────────────────────────
  function loadMessagesView() {
    _setViewHash('messages');
    setActiveNavLink('nav-messages');
    setContentHeader('Messages', 'message-square');
    _activePartnerId = null;
    const container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = `
      <div id="msgRoot" class="flex bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-2"
           style="height:calc(100dvh - 120px);min-height:420px;">
        <!-- Conversation list pane -->
        <div id="msgListPane" class="flex flex-col w-full md:w-80 md:border-r border-slate-100 shrink-0">
          <div class="p-3 border-b border-slate-100 shrink-0 flex items-center justify-between gap-2">
            <p class="font-black text-slate-800 text-sm uppercase tracking-widest">Chats</p>
            <button onclick="openNewMessage()" title="New message"
              class="flex items-center gap-1.5 pl-2.5 pr-3 py-2 bg-blue-600 hover:bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0">
              <i data-lucide="message-square-plus" class="h-3.5 w-3.5"></i> Message
            </button>
          </div>
          <div class="px-3 pt-3 pb-2 shrink-0">
            <div class="relative">
              <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none"></i>
              <input id="msgSearch" type="text" placeholder="Search people to message…"
                autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-msg-search"
                oninput="filterMessagePeople(this.value)"
                class="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-600 transition-all">
            </div>
          </div>
          <div id="msgConvList" class="flex-1 overflow-y-auto custom-scrollbar-light">
            <div class="text-center py-12 text-slate-300 text-xs font-black uppercase tracking-widest">Loading…</div>
          </div>
        </div>
        <!-- Thread pane -->
        <div id="msgThreadPane" class="flex-col flex-1 min-w-0 hidden md:flex">
          <div id="msgThreadEmpty" class="flex-1 flex flex-col items-center justify-center text-slate-300 gap-3 p-8">
            <div class="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center"><i data-lucide="messages-square" class="h-7 w-7"></i></div>
            <p class="text-xs font-black uppercase tracking-widest">Select a conversation</p>
            <p class="text-[10px] font-bold text-slate-300">or search a name to start a new one</p>
          </div>
          <div id="msgThreadActive" class="hidden flex-col h-full" style="height:100%;"></div>
        </div>
      </div>`;
    lucide.createIcons();
    // Browsers sometimes autofill this field with the login credential; clear it forcefully
    const _msBox = document.getElementById('msgSearch');
    if (_msBox) { _msBox.value = ''; setTimeout(() => { if (_msBox) _msBox.value = ''; }, 200); }
    _loadConversations(false);
    refreshMessagesBadge();

    // Fallback poll — Realtime handles instant updates; this catches WebSocket gaps
    clearInterval(_msgListPoll);
    _msgListPoll = setInterval(() => {
      if (!document.getElementById('msgConvList')) { clearInterval(_msgListPoll); return; }
      const box = document.getElementById('msgSearch');
      if (box && box.value.trim()) return;   // don't clobber an active people search
      _loadConversations(true);
    }, 60000);
  }

  function openMessagesPanel() { loadMessagesView(); }

  function _loadConversations(silent) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run
      .withSuccessHandler(res => {
        _msgConvCache = (res && Array.isArray(res.conversations)) ? res.conversations : [];
        _updateMsgBadges(res ? res.totalUnread : 0);
        const box = document.getElementById('msgSearch');
        if (box && box.value.trim()) return;  // user is searching — leave list alone
        _renderConversationList();
      })
      .withFailureHandler(() => {
        if (silent) return;
        const list = document.getElementById('msgConvList');
        if (list) list.innerHTML = `<div class="text-center py-8 text-red-400 text-xs font-black uppercase">Failed to load</div>`;
      })
      .getMessagingOverview(myId);
  }

  function _renderConversationList() {
    const list = document.getElementById('msgConvList');
    if (!list) return;
    if (!_msgConvCache.length) {
      list.innerHTML = `<div class="text-center py-12 px-4 text-slate-300 text-xs font-black uppercase tracking-widest">No conversations yet.<br><span class="text-[10px] text-slate-300 normal-case font-bold tracking-normal">Search a name above to start one.</span></div>`;
      return;
    }
    const myId = window.APP_USER && window.APP_USER.user_id;
    list.innerHTML = _msgConvCache.map(c => {
      const { cls } = _presenceInfo(c.last_active);
      const active = c.partner_id === _activePartnerId;
      const preview = (c.last_sender_id === myId ? 'You: ' : '') + (c.last_message || '');
      return `<button onclick="openConversation('${String(c.partner_id).replace(/'/g,"\\'")}')"
        class="w-full flex items-center gap-3 px-3 py-3 border-b border-slate-50 text-left transition-colors ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}">
        ${_avatar(c.full_name, c.photo_url, 'w-11 h-11', cls)}
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <p class="font-black text-slate-800 text-sm truncate">${_escHtml(c.full_name)}</p>
            <span class="text-[9px] text-slate-400 font-bold shrink-0">${_smartTime(c.last_message_at, true)}</span>
          </div>
          <div class="flex items-center justify-between gap-2 mt-0.5">
            <p class="text-[11px] ${c.unread ? 'text-slate-700 font-black' : 'text-slate-400 font-bold'} truncate">${_escHtml(preview)}</p>
            ${c.unread ? `<span class="shrink-0 min-w-[18px] h-[18px] px-1 bg-blue-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">${c.unread>99?'99+':c.unread}</span>` : ''}
          </div>
        </div>
      </button>`;
    }).join('');
    lucide.createIcons();
  }

  // Search switches the left pane to "start a new chat" people results
  function filterMessagePeople(q) {
    const term = (q||'').toLowerCase().trim();
    const list = document.getElementById('msgConvList');
    if (!list) return;
    if (!term) { _renderConversationList(); return; }

    const render = () => {
      const myId = window.APP_USER && window.APP_USER.user_id;
      const matches = _msgPeopleCache.filter(u => u.user_id !== myId && (
        (u.full_name||'').toLowerCase().includes(term) ||
        (u.designation||'').toLowerCase().includes(term) ||
        (u.role||'').toLowerCase().includes(term) ||
        (u.user_id||'').toLowerCase().includes(term)
      )).slice(0, 50);
      if (!matches.length) {
        list.innerHTML = `<div class="text-center py-12 text-slate-300 text-xs font-black uppercase tracking-widest">No people found</div>`;
        return;
      }
      list.innerHTML = `<p class="px-3 pt-3 pb-1 text-[9px] font-black text-slate-400 uppercase tracking-widest">Start a conversation</p>` +
        matches.map(u => {
          const { cls } = _presenceInfo(u.last_active);
          return `<button onclick="openConversation('${String(u.user_id).replace(/'/g,"\\'")}')"
            class="w-full flex items-center gap-3 px-3 py-2.5 border-b border-slate-50 text-left hover:bg-slate-50 transition-colors">
            ${_avatar(u.full_name, u.photo_url, 'w-9 h-9', cls)}
            <div class="flex-1 min-w-0">
              <p class="font-black text-slate-800 text-xs truncate">${_escHtml(u.full_name || u.user_id)}</p>
              ${u.designation ? `<p class="text-[9px] text-blue-600 font-bold uppercase tracking-wide truncate">${_escHtml(u.designation)}</p>` : ''}
            </div>
            <i data-lucide="message-circle" class="h-4 w-4 text-slate-300"></i>
          </button>`;
        }).join('');
      lucide.createIcons();
    };

    if (_msgPeopleCache.length) { render(); }
    else {
      list.innerHTML = `<div class="text-center py-12 text-slate-300 text-xs font-black uppercase tracking-widest">Loading people…</div>`;
      google.script.run
        .withSuccessHandler(users => { _msgPeopleCache = Array.isArray(users) ? users : []; render(); })
        .withFailureHandler(() => { list.innerHTML = `<div class="text-center py-8 text-red-400 text-xs font-black uppercase">Failed to load people</div>`; })
        .getAllUsersWithPresence();
    }
  }

  // ── New-message composer: pick anyone in the faculty ──
  function openNewMessage() {
    let modal = document.getElementById('newMsgModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'newMsgModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:1rem;';
      modal.onclick = e => { if (e.target === modal) closeNewMessage(); };
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div style="width:min(440px,100%);max-height:82vh;background:#fff;border-radius:1.5rem;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <p class="font-black text-slate-800 text-base">New Message</p>
            <p class="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Pick someone to message</p>
          </div>
          <button onclick="closeNewMessage()" class="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-red-100 hover:text-red-500 text-slate-400 transition-all font-black text-lg leading-none">×</button>
        </div>
        <div class="p-3 border-b border-slate-100 shrink-0">
          <div class="relative">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none"></i>
            <input id="newMsgSearch" type="text" placeholder="Search by name, designation, role…"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="ccpc-newmsg-search"
              oninput="filterNewMessage(this.value)"
              class="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-600 transition-all">
          </div>
        </div>
        <div id="newMsgList" class="flex-1 overflow-y-auto custom-scrollbar-light min-h-[220px]">
          <div class="text-center py-12 text-slate-300 text-xs font-black uppercase tracking-widest">Loading people…</div>
        </div>
      </div>`;
    lucide.createIcons();
    setTimeout(() => { const s = document.getElementById('newMsgSearch'); if (s) s.focus(); }, 60);

    if (_msgPeopleCache.length) { _renderNewMessageList(''); }
    else {
      google.script.run
        .withSuccessHandler(u => { _msgPeopleCache = Array.isArray(u) ? u : []; _renderNewMessageList(''); })
        .withFailureHandler(() => { const l = document.getElementById('newMsgList'); if (l) l.innerHTML = `<div class="text-center py-8 text-red-400 text-xs font-black uppercase">Failed to load people</div>`; })
        .getAllUsersWithPresence();
    }
  }

  function closeNewMessage() {
    const m = document.getElementById('newMsgModal');
    if (m) m.remove();
  }

  function filterNewMessage(q) { _renderNewMessageList(q); }

  function _renderNewMessageList(q) {
    const list = document.getElementById('newMsgList');
    if (!list) return;
    const term = (q||'').toLowerCase().trim();
    const myId = window.APP_USER && window.APP_USER.user_id;
    const people = _msgPeopleCache.filter(u => u.user_id !== myId && (!term ||
      (u.full_name||'').toLowerCase().includes(term) ||
      (u.designation||'').toLowerCase().includes(term) ||
      (u.role||'').toLowerCase().includes(term) ||
      (u.user_id||'').toLowerCase().includes(term)
    ));
    if (!people.length) {
      list.innerHTML = `<div class="text-center py-12 text-slate-300 text-xs font-black uppercase tracking-widest">No people found</div>`;
      return;
    }
    list.innerHTML = people.slice(0, 100).map(u => {
      const { cls } = _presenceInfo(u.last_active);
      return `<button onclick="closeNewMessage();openConversation('${String(u.user_id).replace(/'/g,"\\'")}')"
        class="w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 text-left hover:bg-slate-50 transition-colors">
        ${_avatar(u.full_name, u.photo_url, 'w-10 h-10', cls)}
        <div class="flex-1 min-w-0">
          <p class="font-black text-slate-800 text-sm truncate">${_escHtml(u.full_name || u.user_id)}</p>
          ${u.designation ? `<p class="text-[9px] text-blue-600 font-bold uppercase tracking-wide truncate">${_escHtml(u.designation)}</p>` : ''}
        </div>
        <i data-lucide="send" class="h-4 w-4 text-slate-300 shrink-0"></i>
      </button>`;
    }).join('');
    lucide.createIcons();
  }

  // ── Conversation thread ────────────────────────────────
  function openConversation(partnerId) {
    _activePartnerId = partnerId;
    const info = _partnerInfo(partnerId);
    const { cls, label } = _presenceInfo(info.last_active);
    const mobile = window.innerWidth < 768;

    // mobile: swap panes
    const listPane = document.getElementById('msgListPane');
    const threadPane = document.getElementById('msgThreadPane');
    if (mobile && listPane && threadPane) {
      listPane.classList.add('hidden');
      threadPane.classList.remove('hidden');
      threadPane.classList.add('flex');
    }
    const empty = document.getElementById('msgThreadEmpty');
    const active = document.getElementById('msgThreadActive');
    if (empty) empty.classList.add('hidden');
    if (!active) return;
    active.classList.remove('hidden');
    active.classList.add('flex');

    const rawNum = (info.whatsapp || info.phone || '').trim();
    const telNum = rawNum.replace(/[\s\-()]/g,'');   // keep + for dialer
    const waNum  = rawNum.replace(/\D/g,'');          // digits only for wa.me
    const callBtns = rawNum ? `
      <a href="tel:${telNum}" title="Call ${_escHtml(rawNum)}" class="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-500 transition-all shrink-0"><i data-lucide="phone" class="h-4 w-4"></i></a>
      <a href="https://wa.me/${waNum}" target="_blank" title="WhatsApp ${_escHtml(rawNum)}" class="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-emerald-500 hover:text-white text-slate-500 transition-all shrink-0"><i data-lucide="message-circle" class="h-4 w-4"></i></a>` : '';
    active.innerHTML = `
      <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0 bg-white">
        <button onclick="backToMessageList()" class="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 shrink-0"><i data-lucide="arrow-left" class="h-4 w-4"></i></button>
        ${_avatar(info.full_name, info.photo_url, 'w-10 h-10', cls)}
        <div class="flex-1 min-w-0">
          <p class="font-black text-slate-800 text-sm truncate">${_escHtml(info.full_name)}</p>
          <p class="text-[10px] font-bold truncate ${label==='Active now'?'text-emerald-500':'text-slate-400'}">${info.designation ? _escHtml(info.designation)+' · ' : ''}${label}</p>
        </div>
        ${callBtns}
      </div>
      <div id="msgThreadBody" class="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-slate-50/50">
        <p class="text-center text-xs text-slate-300 font-black uppercase tracking-widest py-8">Loading…</p>
      </div>
      <div id="msgTypingIndicator" class="hidden px-5 py-1">
        <span class="text-xs text-slate-400 italic">typing…</span>
      </div>
      <div class="p-3 border-t border-slate-100 shrink-0 flex items-end gap-2 bg-white">
        <textarea id="msgComposerInput" rows="1" placeholder="Type a message…" maxlength="2000"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';_broadcastTyping();"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessageInThread();}"
          class="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-600 transition-all resize-none leading-snug" style="max-height:120px;"></textarea>
        <button onclick="sendMessageInThread()" class="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-2xl hover:bg-black transition-all shrink-0"><i data-lucide="send" class="h-4 w-4"></i></button>
      </div>`;
    lucide.createIcons();
    _renderConversationList(); // refresh highlight
    _refreshThread(partnerId, false);
    const inp = document.getElementById('msgComposerInput');
    if (inp && !mobile) inp.focus();

    // Fallback poll for open thread — Realtime handles instant updates
    clearInterval(_msgThreadPoll);
    _msgThreadPoll = setInterval(() => {
      if (!document.getElementById('msgThreadBody') || _activePartnerId !== partnerId) { clearInterval(_msgThreadPoll); return; }
      _refreshThread(partnerId, true);
    }, 30000);
  }

  function backToMessageList() {
    _activePartnerId = null;
    clearInterval(_msgThreadPoll);
    const listPane = document.getElementById('msgListPane');
    const threadPane = document.getElementById('msgThreadPane');
    if (listPane) listPane.classList.remove('hidden');
    if (threadPane) { threadPane.classList.add('hidden'); threadPane.classList.remove('flex'); }
    _renderConversationList();
  }

  function _refreshThread(partnerId, silent) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run
      .withSuccessHandler(msgs => {
        if (_activePartnerId !== partnerId) return;
        _renderThread(Array.isArray(msgs) ? msgs : [], myId, silent);
        // mark incoming as read, then refresh badges + list
        google.script.run.withSuccessHandler(() => {
          _loadConversations(true);
        }).withFailureHandler(()=>{}).markDmRead(myId, partnerId);
      })
      .withFailureHandler(() => {
        if (silent) return;
        const body = document.getElementById('msgThreadBody');
        if (body) body.innerHTML = `<p class="text-center text-xs text-red-400 font-black uppercase py-8">Failed to load messages</p>`;
      })
      .getConversation(myId, partnerId);
  }

  function _renderThread(msgs, myId, silent) {
    const body = document.getElementById('msgThreadBody');
    if (!body) return;
    // preserve scroll position if user scrolled up during a silent refresh
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;

    if (!msgs.length) {
      body.innerHTML = `<p class="text-center text-xs text-slate-300 font-black uppercase tracking-widest py-8">No messages yet. Say hello! 👋</p>`;
      return;
    }
    let lastDate = '';
    body.innerHTML = msgs.map(m => {
      const d = new Date(m.created_at);
      const dateKey = d.toDateString();
      let sep = '';
      if (dateKey !== lastDate) {
        lastDate = dateKey;
        const now = new Date();
        const yest = new Date(now); yest.setDate(now.getDate()-1);
        let dl = d.toDateString()===now.toDateString() ? 'Today'
               : d.toDateString()===yest.toDateString() ? 'Yesterday'
               : d.toLocaleDateString('en-BD',{day:'2-digit',month:'short',year:'numeric'});
        sep = `<div class="flex justify-center my-3"><span class="px-3 py-1 bg-slate-200/70 text-slate-500 text-[9px] font-black uppercase tracking-widest rounded-full">${dl}</span></div>`;
      }
      const isMine = m.sender_id === myId;
      const time = d.toLocaleTimeString('en-BD',{hour:'2-digit',minute:'2-digit',hour12:true});
      const receipt = isMine ? `<i data-lucide="${m.is_read ? 'check-check' : 'check'}" class="h-3 w-3 ${m.is_read ? 'text-sky-300' : 'text-blue-200'} inline-block ml-1 align-middle"></i>` : '';
      const del = isMine ? `<button onclick="deleteDirectMsg('${m.id}')" class="opacity-0 group-hover/msg:opacity-100 transition-opacity text-blue-200 hover:text-white ml-1" title="Delete"><i data-lucide="trash-2" class="h-3 w-3"></i></button>` : '';
      return `${sep}<div class="flex ${isMine ? 'justify-end' : 'justify-start'} group/msg">
        <div class="max-w-[78%] px-3.5 py-2 rounded-2xl ${isMine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white border border-slate-100 text-slate-800 rounded-bl-md shadow-sm'}">
          <p class="text-sm font-medium leading-snug whitespace-pre-wrap break-words">${_escHtml(m.message)}</p>
          <p class="text-[9px] mt-1 ${isMine ? 'text-blue-200' : 'text-slate-400'} font-bold flex items-center justify-end gap-0.5">${time}${receipt}${del}</p>
        </div>
      </div>`;
    }).join('');
    lucide.createIcons();
    if (nearBottom || !silent) body.scrollTop = body.scrollHeight;
  }

  function sendMessageInThread() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    const input = document.getElementById('msgComposerInput');
    const msg = input ? input.value.trim() : '';
    if (!msg || !myId || !_activePartnerId) return;
    const partnerId = _activePartnerId;
    input.value = ''; input.style.height = 'auto'; input.focus();
    // optimistic: surface the conversation in the list right away, with the name,
    // even though the recipient hasn't replied yet
    _upsertConversationLocal(partnerId, msg, myId);
    google.script.run
      .withSuccessHandler(() => { _refreshThread(partnerId, false); _loadConversations(true); })
      .withFailureHandler(() => { showToast('Failed to send message', 'error'); if (input) input.value = msg; })
      .sendDirectMessage(myId, partnerId, msg);
  }

  // Insert or move a conversation to the top of the list locally (before the server round-trip).
  // Pulls the partner's name/photo from whatever we already know (conv cache, people cache, directory seed).
  function _upsertConversationLocal(partnerId, message, myId) {
    const info = _partnerInfo(partnerId);
    let conv = _msgConvCache.find(c => c.partner_id === partnerId);
    if (conv) {
      _msgConvCache = _msgConvCache.filter(c => c.partner_id !== partnerId);
    } else {
      conv = { partner_id: partnerId, unread: 0,
               full_name: info.full_name || partnerId,
               photo_url: info.photo_url || null,
               designation: info.designation || null,
               last_active: info.last_active || null };
    }
    conv.last_message    = message;
    conv.last_message_at = new Date().toISOString();
    conv.last_sender_id  = myId;
    _msgConvCache.unshift(conv);
    const box = document.getElementById('msgSearch');
    if (!(box && box.value.trim())) _renderConversationList();
  }

  function deleteDirectMsg(msgId) {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run
      .withSuccessHandler(() => { if (_activePartnerId) _refreshThread(_activePartnerId, false); })
      .withFailureHandler(() => showToast('Failed to delete', 'error'))
      .deleteDirectMessage(msgId, myId);
  }

  // Entry point from the Users Directory "Message" button — jumps to the center
  function openDirectMessage(recipientId, recipientName, photoSrc) {
    // seed the partner cache so the thread header has a name/photo immediately
    if (recipientId && !_msgConvCache.find(c => c.partner_id === recipientId)) {
      _msgPeopleCache = _msgPeopleCache.filter(p => p.user_id !== recipientId);
      _msgPeopleCache.push({ user_id: recipientId, full_name: recipientName, photo_url: photoSrc, designation: null, last_active: null });
    }
    loadMessagesView();
    setTimeout(() => openConversation(recipientId), 50);
  }

  // ── Unread badges (nav link + header) ──────────────────
  function _updateMsgBadges(unread) {
    unread = unread || 0;
    ['msgNavBadge','msgHeaderBadge'].forEach(id => {
      const b = document.getElementById(id);
      if (!b) return;
      if (unread > 0) {
        b.textContent = unread > 99 ? '99+' : unread;
        b.classList.remove('hidden');
        b.style.display = 'flex';   // beat any hidden/flex class ordering conflict
      } else {
        b.classList.add('hidden');
        b.style.display = 'none';
      }
    });
    // proactive toast when a new message arrives while away from the thread
    if (unread > _lastUnreadDm && _lastUnreadDm !== 0 && !document.getElementById('msgThreadBody')) {
      showToast('💬 New message received');
    }
    _lastUnreadDm = unread;
  }

  function refreshMessagesBadge() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run.withSuccessHandler(n => _updateMsgBadges(typeof n === 'number' ? n : 0))
      .withFailureHandler(()=>{}).countUnreadDms(myId);
  }

  // ═══════════════════════════════════════════════════════
  //  HEARTBEAT — update last_active every 2 minutes
  // ═══════════════════════════════════════════════════════

  function updateLastActiveHeartbeat() {
    const myId = window.APP_USER && window.APP_USER.user_id;
    if (!myId) return;
    google.script.run.withSuccessHandler(() => {}).withFailureHandler(() => {}).updateLastActive(myId);
  }

  // Start heartbeat + initial badge refresh after login (called from launchDashboard / initApp)
  function startSessionHeartbeat() {
    updateLastActiveHeartbeat();
    refreshNotifBadge();
    refreshMessagesBadge();
    setInterval(updateLastActiveHeartbeat, 2 * 60 * 1000);
    setInterval(refreshNotifBadge, 60 * 1000);
    setInterval(refreshMessagesBadge, 30 * 1000);
  }

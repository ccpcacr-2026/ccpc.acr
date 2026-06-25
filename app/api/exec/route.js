import { supabaseRequest, castToArray } from '@/lib/supabase';

// ─── Whitelist of callable functions ──────────────────────────────────────────
const ALLOWED = new Set([
  'attemptLogin','changeMyPassword','updateAppUserPassword',
  'getAppUsers','saveAppUser','deleteAppUser','updateAppUserRole',
  'toggleEvaluatable','getProfilesWithoutUsers','bulkCreateUsersFromProfiles',
  'getMyProfile','savePersonalProfile','uploadPhoto',
  'getAllStaffData','getStaffDetails','getTeacherAcr',
  'saveYearlyAcr','getCourseMarks','saveCourseMark','deleteCourseMark',
  'getBonusPenalty','saveBonusPenalty','deleteBonusPenalty',
  'getSystemSettings','updateSystemSettings',
  'getUserCommittees','createCommittee','updateCommittee','deleteCommittee',
  'getCommitteeChat','sendCommitteeMessage','deleteLastOwnMessage','updateMemberAliases',
  'saveCommitteeEvalNew','getTeacherTraceReport','getInitialDashboardData'
]);

export async function POST(req) {
  try {
    const body = await req.json();
    const { fn, args = [], _email, _uid } = body;

    if (!fn || !ALLOWED.has(fn)) {
      return Response.json({ error: 'Function not allowed: ' + fn }, { status: 400 });
    }

    const result = await dispatch(fn, args, { email: _email, uid: _uid });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ─── Function dispatcher ───────────────────────────────────────────────────────
async function dispatch(fn, args, ctx) {
  switch (fn) {

    // ── AUTH ──────────────────────────────────────────────────────────────────
    case 'attemptLogin': {
      const [idOrEmail, password] = args;
      const clean = String(idOrEmail).trim();
      const res = await supabaseRequest(`app_users?or=(user_id.eq.${clean},email.eq.${clean})`);
      if (Array.isArray(res) && res.length) {
        const user = res[0];
        if (String(user.password).trim() === String(password).trim()) {
          const rolesArr = user.role.split(',').map(r => r.trim()).filter(Boolean);
          return { success: true, user_id: user.user_id, role: rolesArr[0], roles: rolesArr, email: user.email };
        }
      }
      return { success: false };
    }

    case 'changeMyPassword': {
      const [userId, current, next] = args;
      const rows = await supabaseRequest(`app_users?user_id=eq.${userId}&select=password`);
      if (!rows || rows.error || !rows.length) return { success: false, reason: 'user_not_found' };
      if (String(rows[0].password).trim() !== String(current).trim()) return { success: false, reason: 'wrong_password' };
      const upd = await supabaseRequest(`app_users?user_id=eq.${userId}`, 'patch', { password: next });
      return upd && upd.error ? { success: false, reason: 'update_failed' } : { success: true };
    }

    case 'updateAppUserPassword': {
      const [userId, newPass] = args;
      return supabaseRequest(`app_users?user_id=eq.${userId}`, 'patch', { password: newPass });
    }

    // ── USERS ─────────────────────────────────────────────────────────────────
    case 'getAppUsers':
      return supabaseRequest('app_users?select=*&order=created_at.desc');

    case 'saveAppUser': {
      const [data] = args;
      const userRes = await supabaseRequest('app_users?on_conflict=user_id', 'post', data);
      const roleTokens = (data.role || '').split(',').map(r => r.trim());
      const cat = roleTokens.find(r => r === 'Teacher' || r === 'Staff');
      if (cat) {
        await supabaseRequest('users_profile?on_conflict=teacher_id', 'post', {
          teacher_id: data.user_id, email: data.email, category: cat
        });
      }
      return userRes;
    }

    case 'deleteAppUser':
      return supabaseRequest(`app_users?user_id=eq.${args[0]}`, 'delete');

    case 'updateAppUserRole':
      return supabaseRequest(`app_users?user_id=eq.${args[0]}`, 'patch', { role: args[1] });

    case 'toggleEvaluatable':
      return supabaseRequest(`users_profile?teacher_id=eq.${args[0]}`, 'patch', { is_evaluatable: args[1] });

    case 'getProfilesWithoutUsers': {
      const [profiles, users] = await Promise.all([
        supabaseRequest('users_profile?select=teacher_id,full_name,email,designation,category&order=full_name.asc'),
        supabaseRequest('app_users?select=user_id')
      ]);
      if (!Array.isArray(profiles)) return { error: true, message: 'users_profile table not found or inaccessible' };
      const existing = new Set(Array.isArray(users) ? users.map(u => String(u.user_id).trim()) : []);
      return profiles.filter(p => p.teacher_id && !existing.has(String(p.teacher_id).trim()));
    }

    case 'bulkCreateUsersFromProfiles': {
      const [profiles, defaultPassword] = args;
      const results = { created: [], failed: [] };
      for (const p of profiles) {
        const res = await supabaseRequest('app_users?on_conflict=user_id', 'post', {
          user_id: p.teacher_id, email: p.email, password: defaultPassword, role: p.role
        });
        (res && res.error ? results.failed : results.created).push(p.teacher_id);
      }
      return results;
    }

    // ── PROFILE ───────────────────────────────────────────────────────────────
    case 'getMyProfile': {
      const email = args[0] || ctx.email;
      if (!email) return null;
      const fullSelect = [
        '*','family_details(*)','faculty_attributes(*)',
        'countries_visited(*)','language_skills(*)','siblings_info(*)',
        'spouse_details(*)','children_info(*)','chronic_diseases(*)',
        'sibling_inlaws(*)','bank_accounts(*)','education_records(*)'
      ].join(',');
      let res = await supabaseRequest(`users_profile?select=${fullSelect}&email=eq.${encodeURIComponent(email)}`);
      if (!Array.isArray(res)) {
        res = await supabaseRequest(`users_profile?select=*,family_details(*),faculty_attributes(*)&email=eq.${encodeURIComponent(email)}`);
      }
      return Array.isArray(res) && res.length ? res[0] : null;
    }

    case 'savePersonalProfile': {
      const [data] = args;
      const tid = data.teacher_id;
      if (!tid) return { error: 'teacher_id required' };
      const d = v => (v && String(v).trim() !== '') ? v : null;

      const profilePayload = {
        teacher_id: tid, email: data.email || '',
        full_name: data.full_name || null, category: data.category || null,
        designation: data.designation || null, joining_date: d(data.joining_date),
        national_id: data.national_id || null, auth_ref: data.auth_ref || null,
        name_bengali: data.name_bengali || null, school_college: data.school_college || null,
        date_of_birth: d(data.date_of_birth), place_of_birth: data.place_of_birth || null,
        birth_certificate_no: data.birth_certificate_no || null,
        height_feet: data.height_feet || null, height_inches: data.height_inches || null,
        weight_kg: data.weight_kg || null, blood_group: data.blood_group || null,
        medical_category: data.medical_category || null, disability_nature: data.disability_nature || null,
        disability_attributable: data.disability_attributable || null,
        religion: data.religion || null, caste: data.caste || null,
        nationality: data.nationality || null, previous_nationality: data.previous_nationality || null,
        permanent_address: data.permanent_address || null, present_address: data.present_address || null,
        alternate_address: data.alternate_address || null, personal_email: data.personal_email || null,
        tt_phone: data.tt_phone || null, mobile: data.mobile || null,
        passport_number: data.passport_number || null, passport_date_issue: d(data.passport_date_issue),
        passport_place_issue: data.passport_place_issue || null, passport_date_expiry: d(data.passport_date_expiry),
        passport_type: data.passport_type || null, passport_issuing_auth: data.passport_issuing_auth || null,
        father_name: data.father_name || null, father_nationality: data.father_nationality || null,
        father_prev_nationality: data.father_prev_nationality || null,
        father_citizenship_auth: data.father_citizenship_auth || null,
        father_present_age: data.father_present_age || null, father_date_of_decease: d(data.father_date_of_decease),
        father_occupation: data.father_occupation || null, father_annual_income: data.father_annual_income || null,
        mother_name: data.mother_name || null, mother_nationality: data.mother_nationality || null,
        mother_prev_nationality: data.mother_prev_nationality || null,
        mother_citizenship_auth: data.mother_citizenship_auth || null,
        mother_present_age: data.mother_present_age || null, mother_date_of_decease: d(data.mother_date_of_decease),
        mother_occupation: data.mother_occupation || null, position_in_siblings: data.position_in_siblings || null,
        marital_status: data.marital_status || null, marriage_divorce_date: d(data.marriage_divorce_date),
        marriage_authority: data.marriage_authority || null, own_income: data.own_income || null,
        spouse_income: data.spouse_income || null, assets_income: data.assets_income || null,
        assets_details: data.assets_details || null, institution_law_breaking: data.institution_law_breaking || null,
        civil_law_breaking: data.civil_law_breaking || null,
        identification_marks: data.identification_marks || null,
        tid_bin_no: data.tid_bin_no || null, additional_qualification: data.additional_qualification || null,
        photo_url: data.photo_url || null, spouse_name: data.spouse_name_en || null
      };
      await supabaseRequest('users_profile?on_conflict=teacher_id', 'post', profilePayload);

      // family_details
      await supabaseRequest(`family_details?teacher_id=eq.${tid}`, 'delete');
      if (data['fam_type[]']) {
        const types = castToArray(data['fam_type[]']), names = castToArray(data['fam_name[]']), dates = castToArray(data['fam_date[]']);
        const rows = [];
        for (let i = 0; i < types.length; i++) if (names[i]) rows.push({ teacher_id: tid, member_type: types[i], name: names[i], marriage_date: d(dates[i]) });
        if (rows.length) await supabaseRequest('family_details', 'post', rows);
      }

      // faculty_attributes
      await supabaseRequest(`faculty_attributes?teacher_id=eq.${tid}`, 'delete');
      if (data['attr_header[]']) {
        const headers = castToArray(data['attr_header[]']), subs = castToArray(data['attr_subheader[]']), vals = castToArray(data['attr_value[]']);
        const rows = [];
        for (let i = 0; i < headers.length; i++) if (vals[i]) rows.push({ teacher_id: tid, header: headers[i], subheader: subs[i] || '', value: vals[i] });
        if (rows.length) await supabaseRequest('faculty_attributes', 'post', rows);
      }

      // spouse_details
      if (data.spouse_name_en || data.spouse_name_bn) {
        await supabaseRequest('spouse_details?on_conflict=teacher_id', 'post', {
          teacher_id: tid, name_english: data.spouse_name_en || null, name_bengali: data.spouse_name_bn || null,
          date_of_birth: d(data.spouse_dob), place_of_birth: data.spouse_pob || null,
          birth_reg_number: data.spouse_birth_reg || null, nationality: data.spouse_nationality || null,
          prev_nationality: data.spouse_prev_nationality || null, citizenship_auth: data.spouse_citizenship_auth || null,
          national_id: data.spouse_nid || null, educational_qualification: data.spouse_education || null,
          occupation: data.spouse_occupation || null, occupation_designation: data.spouse_occ_designation || null,
          occupation_address: data.spouse_occ_address || null, previous_occupation: data.spouse_prev_occupation || null,
          tid_bin_no: data.spouse_tid_bin || null
        });
      }

      // dynamic tables
      const cv = key => { const a = castToArray(data[key] || []); return i => a[i] || null; };
      const dc = key => { const a = castToArray(data[key] || []); return i => d(a[i]); };
      const saveRows = async (table, anchor, buildRow) => {
        await supabaseRequest(`${table}?teacher_id=eq.${tid}`, 'delete');
        const anchors = castToArray(data[anchor] || []);
        const rows = anchors.map((v, i) => v && v.trim() !== '' ? buildRow(i) : null).filter(Boolean);
        if (rows.length) await supabaseRequest(table, 'post', rows);
      };

      await saveRows('countries_visited', 'country_name[]', i => ({ teacher_id: tid, country_name: cv('country_name[]')(i), duration_from: dc('duration_from[]')(i), duration_to: dc('duration_to[]')(i), reasons: cv('visit_reasons[]')(i) }));
      await saveRows('language_skills', 'language[]', i => ({ teacher_id: tid, language: cv('language[]')(i), efficiency: cv('efficiency[]')(i) }));
      await saveRows('siblings_info', 'sibling_name[]', i => ({ teacher_id: tid, name: cv('sibling_name[]')(i), age: cv('sibling_age[]')(i), nationality: cv('sibling_nationality[]')(i), occupation_address: cv('sibling_occ_addr[]')(i), dependency: cv('sibling_dependency[]')(i) }));
      await saveRows('children_info', 'child_name[]', i => ({ teacher_id: tid, name: cv('child_name[]')(i), sex: cv('child_sex[]')(i), date_of_birth: dc('child_dob[]')(i), occupation: cv('child_occupation[]')(i), present_address: cv('child_address[]')(i), disease_notes: cv('child_disease_notes[]')(i) }));
      await saveRows('chronic_diseases', 'disease_name[]', i => ({ teacher_id: tid, disease_name: cv('disease_name[]')(i), nature: cv('disease_nature[]')(i), date_of_illness: dc('disease_date[]')(i), present_condition: cv('disease_condition[]')(i) }));
      await saveRows('sibling_inlaws', 'inlaw_name[]', i => ({ teacher_id: tid, name_in_full: cv('inlaw_name[]')(i), address: cv('inlaw_address[]')(i) }));
      await saveRows('bank_accounts', 'bank_name[]', i => ({ teacher_id: tid, bank_name: cv('bank_name[]')(i), account_number: cv('bank_account_no[]')(i), account_type: cv('bank_account_type[]')(i) }));
      await saveRows('education_records', 'edu_school[]', i => ({ teacher_id: tid, from_date: cv('edu_from[]')(i), to_date: cv('edu_to[]')(i), school_college: cv('edu_school[]')(i), exam_passed: cv('edu_exam[]')(i), division_gpa: cv('edu_gpa[]')(i), year_of_passing: cv('edu_year[]')(i), remarks: cv('edu_remarks[]')(i) }));

      return { success: true };
    }

    case 'uploadPhoto': {
      // Upload base64 image to Supabase Storage
      const [base64Data, fileName, teacherId] = args;
      if (!base64Data) return { success: false, error: 'No image data' };
      const match   = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return { success: false, error: 'Invalid base64 format' };
      const mimeType = match[1];
      const raw      = Buffer.from(match[2], 'base64');
      const filePath = `faculty-photos/${teacherId}-${Date.now()}-${fileName}`;

      const uploadRes = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/faculty-photos/${filePath}`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': mimeType,
            'x-upsert': 'true'
          },
          body: raw
        }
      );
      if (!uploadRes.ok) return { success: false, error: 'Upload failed' };
      const photoUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/faculty-photos/${filePath}`;
      if (teacherId) {
        await supabaseRequest(`users_profile?teacher_id=eq.${teacherId}`, 'patch', { photo_url: photoUrl });
      }
      return { success: true, fileId: photoUrl };
    }

    // ── STAFF / LEADERSHIP DATA ───────────────────────────────────────────────
    case 'getAllStaffData': {
      const [applyFilter, summaryOnly] = args;
      const sel = summaryOnly
        ? 'teacher_id,full_name,category,is_evaluatable,yearly_acr(io_marks,rv_marks,rp_marks,year_num)'
        : '*,family_details(*),faculty_attributes(*),yearly_acr(*)';
      const res = await supabaseRequest(`users_profile?select=${sel}&order=full_name.asc`);
      if (applyFilter && Array.isArray(res)) {
        return res.filter(p => p.is_evaluatable === true && p.full_name && p.full_name.trim() !== '');
      }
      return res;
    }

    case 'getStaffDetails': {
      const res = await supabaseRequest(`users_profile?select=*,family_details(*),faculty_attributes(*)&teacher_id=eq.${args[0]}`);
      return Array.isArray(res) && res.length ? res[0] : null;
    }

    case 'getTeacherAcr':
      return supabaseRequest(`yearly_acr?teacher_id=eq.${args[0]}&order=year_num.asc`) || [];

    case 'saveYearlyAcr':
      return supabaseRequest('yearly_acr?on_conflict=teacher_id,year_num', 'post', args[0]);

    // ── COURSES ───────────────────────────────────────────────────────────────
    case 'getCourseMarks':
      return supabaseRequest(`course_marks?teacher_id=eq.${args[0]}&order=id.asc`) || [];
    case 'saveCourseMark':
      return supabaseRequest('course_marks', 'post', args[0]);
    case 'deleteCourseMark':
      return supabaseRequest(`course_marks?id=eq.${args[0]}`, 'delete');

    // ── BONUS / PENALTY ───────────────────────────────────────────────────────
    case 'getBonusPenalty':
      return supabaseRequest(`bonus_penalty?teacher_id=eq.${args[0]}&order=id.asc`) || [];
    case 'saveBonusPenalty':
      return supabaseRequest('bonus_penalty', 'post', args[0]);
    case 'deleteBonusPenalty':
      return supabaseRequest(`bonus_penalty?id=eq.${args[0]}`, 'delete');

    // ── SETTINGS ──────────────────────────────────────────────────────────────
    case 'getSystemSettings': {
      const res = await supabaseRequest('system_settings');
      const settings = {};
      if (Array.isArray(res)) res.forEach(s => { settings[s.key] = s.value; });
      return settings;
    }
    case 'updateSystemSettings':
      return supabaseRequest('system_settings?on_conflict=key', 'post',
        Object.entries(args[0]).map(([key, value]) => ({ key, value })));

    // ── COMMITTEES ────────────────────────────────────────────────────────────
    case 'getUserCommittees':
      return supabaseRequest('committee_groups?select=*&order=create_date.desc');
    case 'createCommittee':
      return supabaseRequest('committee_groups', 'post', args[0]);
    case 'updateCommittee':
      return supabaseRequest(`committee_groups?id=eq.${args[0]}`, 'patch', args[1]);
    case 'deleteCommittee':
      return supabaseRequest(`committee_groups?id=eq.${args[0]}`, 'delete');

    // ── COMMITTEE CHAT ────────────────────────────────────────────────────────
    case 'getCommitteeChat': {
      const res = await supabaseRequest(`committee_groups?id=eq.${args[0]}&select=chat_messages,member_aliases,members_list`);
      if (!Array.isArray(res) || !res.length) return { chat_messages: [], member_aliases: {}, members_list: [] };
      return res[0];
    }

    case 'sendCommitteeMessage': {
      const [commId, msg] = args;
      const data = await dispatch('getCommitteeChat', [commId], ctx);
      const msgs = data.chat_messages || [];
      msgs.push(msg);
      return supabaseRequest(`committee_groups?id=eq.${commId}`, 'patch', { chat_messages: msgs });
    }

    case 'deleteLastOwnMessage': {
      const [commId, userId] = args;
      const data = await dispatch('getCommitteeChat', [commId], ctx);
      const msgs = data.chat_messages || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].user_id === userId) { msgs.splice(i, 1); break; }
      }
      return supabaseRequest(`committee_groups?id=eq.${commId}`, 'patch', { chat_messages: msgs });
    }

    case 'updateMemberAliases':
      return supabaseRequest(`committee_groups?id=eq.${args[0]}`, 'patch', { member_aliases: args[1] });

    case 'saveCommitteeEvalNew':
      return supabaseRequest('committee_evaluations_new', 'post', args[0]);

    // ── TRACE REPORT ──────────────────────────────────────────────────────────
    case 'getTeacherTraceReport': {
      const teacherId = args[0];
      const [profile, acrYears, courses, committeeOld, bonusPenalty, committeeGroups, evaluations, settingsRaw] =
        await Promise.all([
          supabaseRequest(`users_profile?teacher_id=eq.${teacherId}`),
          supabaseRequest(`yearly_acr?teacher_id=eq.${teacherId}&order=year_num.asc`),
          supabaseRequest(`course_marks?teacher_id=eq.${teacherId}`),
          supabaseRequest(`committee_eval?teacher_id=eq.${teacherId}`),
          supabaseRequest(`bonus_penalty?teacher_id=eq.${teacherId}`),
          supabaseRequest('committee_groups?select=*'),
          supabaseRequest(`committee_evaluations_new?evaluated_id=eq.${teacherId}`),
          supabaseRequest('system_settings')
        ]);

      const settings = {};
      if (Array.isArray(settingsRaw)) settingsRaw.forEach(s => { settings[s.key] = s.value; });

      const report = {
        profile:      Array.isArray(profile) && profile.length ? profile[0] : {},
        yearlyData:   Array.isArray(acrYears) ? acrYears : [],
        courses:      Array.isArray(courses) ? courses : [],
        committee:    Array.isArray(committeeOld) && committeeOld.length ? committeeOld[0] : { input_1:0, input_2:0, input_3:0, input_4:0 },
        bonusPenalty: Array.isArray(bonusPenalty) ? bonusPenalty : [],
        summary:      { acrScore:0, petScore:0, courseScore:0, commScore:0, bonusTotal:0, penaltyTotal:0, finalTotal:0 }
      };

      let totalAcr = 0, totalPet = 0, activeYears = 0;
      report.yearlyData.forEach(yr => {
        if (!yr.is_exempt) {
          activeYears++;
          totalAcr += parseFloat(yr.io_marks||0) + parseFloat(yr.rv_marks||0) + parseFloat(yr.rp_marks||0);
          totalPet += parseFloat(yr.pet_marks||0);
        }
      });
      if (activeYears > 0) {
        report.summary.acrScore = (totalAcr / activeYears / 100) * 60;
        report.summary.petScore = (totalPet / activeYears / 10) * 10;
      }
      report.courses.forEach(c => {
        report.summary.courseScore += (parseFloat(c.obtained_marks||0) / parseFloat(c.full_marks||100)) * parseFloat(c.weight_allotted||0);
      });

      const threshold = parseInt(settings.committee_threshold || 2);
      const weights   = settings.committee_weights || { member_eval:20, chairman_eval:30, admin_eval:50 };
      const committeeScores = [];
      if (Array.isArray(committeeGroups) && Array.isArray(evaluations)) {
        committeeGroups.forEach(group => {
          const members = group.members_list || [];
          if (!members.some(m => m.user_id === teacherId)) return;
          const groupEvals  = evaluations.filter(e => e.committee_id === group.id);
          const memberAvg   = avg(groupEvals.filter(e => e.evaluator_role === 'member'));
          const chairAvg    = avg(groupEvals.filter(e => e.evaluator_role === 'chairman'));
          const adminEvals  = groupEvals.filter(e => ['Principal','VP','HR'].includes(e.evaluator_role));
          const adminMark   = (adminEvals.find(e=>e.evaluator_role==='Principal') || adminEvals.find(e=>e.evaluator_role==='VP') || adminEvals.find(e=>e.evaluator_role==='HR') || { marks:0 }).marks;
          committeeScores.push(
            (memberAvg * 20) * (weights.member_eval/100) +
            (chairAvg  * 20) * (weights.chairman_eval/100) +
            parseFloat(adminMark)   * (weights.admin_eval/100)
          );
        });
      }
      if (committeeScores.length) {
        const raw = committeeScores.length <= threshold
          ? committeeScores.reduce((s,v)=>s+v,0)
          : committeeScores.reduce((s,v)=>s+v,0) / committeeScores.length;
        report.summary.commScore = (raw / 100) * 2;
        report.committeeScores = committeeScores;
      }
      report.bonusPenalty.forEach(bp => {
        if (bp.type === 'Bonus')   report.summary.bonusTotal   += parseFloat(bp.amount||0);
        if (bp.type === 'Penalty') report.summary.penaltyTotal += parseFloat(bp.amount||0);
      });
      report.summary.finalTotal = report.summary.acrScore + report.summary.petScore +
        report.summary.courseScore + report.summary.commScore +
        report.summary.bonusTotal - report.summary.penaltyTotal;
      return report;
    }

    // ── LEGACY COMPAT ─────────────────────────────────────────────────────────
    case 'getInitialDashboardData': {
      const [role, userEmail] = args;
      const email = userEmail || ctx.email;
      if (['Teacher','Staff'].includes(role)) {
        return { html: null, initialData: await dispatch('getMyProfile', [email], ctx) };
      }
      return { html: null, initialData: await dispatch('getAllStaffData', [role==='Principal'||role==='VP', true], ctx) };
    }

    default:
      return { error: 'Unknown function' };
  }
}

function avg(evals) {
  if (!evals.length) return 0;
  return evals.reduce((s, e) => s + parseFloat(e.marks||0), 0) / evals.length;
}

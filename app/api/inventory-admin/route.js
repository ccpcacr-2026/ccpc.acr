import { NextResponse } from 'next/server';

// ── Inventory Admin (native port of the standalone ccpc-inventory app) ──────
// ccpc-inventory was a separate Next.js app, own repo/deployment/login,
// sharing this same Supabase project (wugeppgvmcmsnetksies) under its own
// `inventory` Postgres schema. It's being ported natively into the Faculty
// Portal so "Inventory Admin" needs no second login and no iframe.
//
// Auth model: identical to app/api/student-admin/route.js — the caller sends
// their OWN ccpc-teachers user_id (the one they already logged in with);
// every request is re-verified fresh against teacher.app_users for the
// 'Admin' or 'Inventory Admin' role. Unlike student-admin's route (which has
// a tab-visibility matrix and a viewer tier), the source app gated every one
// of its 7 routes with the exact same unconditional check — so this file
// does the same: one gate, at the top, covers every action below.
//
// This is deliberately a SEPARATE file/feature from the pre-existing
// inventory-schema code in app/api/exec/route.js (_invReq, getMyHolderStock,
// createDistribution, etc.) — that's a self-service "hand off what you're
// already holding" flow with no FIFO and no admin gate, drawing from
// holder_stock. This file's distribute_create draws FIFO from purchase_items
// (Central Store stock) instead. Same tables, two distinct code paths —
// never merge them.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Mirrors sb()/sbTeacher() in student-admin/route.js (uses !res.ok, not a
// manual status>=400 check) — PostgREST returns 300 on an ambiguous embed
// (e.g. a table with two FKs into the same target), and !res.ok correctly
// treats that as an error. ccpc-inventory's own client was written this way
// on purpose for the same reason; don't regress to a >=400-only check.
async function sbInventory(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'inventory',
      'Content-Profile': 'inventory',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Fresh per-request check against teacher.app_users — never trust a cached role.
async function _getUserRoles(userId) {
  if (!userId) return [];
  const res = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  const role = Array.isArray(rows) && rows[0] ? rows[0].role : '';
  return String(role || '').split(',').map(r => r.trim()).filter(Boolean);
}

async function _isInventoryAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Inventory Admin');
}

// Same raw-fetch pattern as _getUserRoles, generalized — reads from the
// `teacher` schema (staff directory) instead of sbInventory's hardcoded
// `inventory` schema.
async function _teacherSchemaFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' },
  });
  if (!res.ok) return [];
  return res.json();
}

// ── Entity config (ported verbatim from ccpc-inventory/lib/entities.js) ─────
// Server-side copy is authoritative for validation/defaulting in
// settings_save (mirrors POST /api/settings/[entity]/route.js exactly). A
// mirrored copy also lives client-side in _src/app.js purely for rendering.
const ENTITIES = {
  groups: {
    table: 'groups',
    importKey: 'name',
    fields: [
      { name: 'code', label: 'Code#', type: 'text' },
      { name: 'name', label: 'Group', type: 'text', required: true },
      // Default depreciation rate for every product in this group that
      // doesn't set its own rate — see products.depreciation_rate_percent
      // below. Blank/unset here means those products fall all the way back
      // to 0% (no depreciation), same as today.
      { name: 'depreciation_rate_percent', label: 'Depreciation %/Year (default)', type: 'number' },
    ],
  },
  units: {
    table: 'units',
    importKey: 'name',
    fields: [
      { name: 'name', label: 'Unit', type: 'text', required: true },
      { name: 'short_form', label: 'Short Form', type: 'text' },
    ],
  },
  unit_conversions: {
    table: 'unit_conversions',
    // Unlike every other importable entity, nothing here is a natural
    // unique identifier — it's a conversion RULE, not a named record, and
    // many legitimate rules share the same unit_type (e.g. several rules
    // all labeled "Weight"). importKey stays set to unit_type purely so
    // the import UI has a required column to map to and a per-row label
    // for warnings — insertOnly:true tells _settingsImportConfirm/
    // _settingsImportPreview to skip all existing-record matching/
    // dedup-by-key entirely and just insert every valid row as new.
    importKey: 'unit_type',
    insertOnly: true,
    fields: [
      { name: 'unit_id', label: 'Unit', type: 'select', source: 'units', optionLabel: 'name' },
      { name: 'unit_type', label: 'Unit Type', type: 'text' },
      // 'value' and 'from_value' MUST have distinct labels — they used to
      // both be "Value", which broke Excel import: a file with two columns
      // literally titled "Value" (base quantity + converted quantity)
      // matched both fields to the same first column, so from_value's real
      // data (e.g. "1000" for kg->g) was silently discarded and every row
      // imported it as whatever the first Value column held instead.
      { name: 'value', label: 'Base Value', type: 'number', default: 0 },
      { name: 'convert_from_unit_id', label: 'Convert From', type: 'select', source: 'units', optionLabel: 'name' },
      { name: 'from_value', label: 'Converted Value', type: 'number', default: 0 },
      { name: 'convert_to_unit_id', label: 'Convert To', type: 'select', source: 'units', optionLabel: 'name' },
    ],
  },
  buildings: {
    table: 'buildings',
    importKey: 'name',
    fields: [
      { name: 'name', label: 'Building Name', type: 'text', required: true },
      { name: 'short_name', label: 'Short Name', type: 'text' },
    ],
  },
  floors: {
    table: 'floors',
    importKey: 'name',
    fields: [
      { name: 'building_id', label: 'Building', type: 'select', source: 'buildings', optionLabel: 'name' },
      { name: 'name', label: 'Floor Name', type: 'text', required: true },
      { name: 'short_name', label: 'Short Name', type: 'text' },
    ],
  },
  room_types: {
    table: 'room_types',
    importKey: 'name',
    fields: [
      { name: 'name', label: 'Room Type Name', type: 'text', required: true },
    ],
  },
  rooms: {
    table: 'rooms',
    importKey: 'name',
    fields: [
      { name: 'name', label: 'Room Name', type: 'text', required: true },
      { name: 'room_code', label: 'Room Code', type: 'text' },
      { name: 'building_id', label: 'Building', type: 'select', source: 'buildings', optionLabel: 'name' },
      { name: 'floor_id', label: 'Floor', type: 'select', source: 'floors', optionLabel: 'name' },
      { name: 'room_type_id', label: 'Room Type', type: 'select', source: 'room_types', optionLabel: 'name' },
      { name: 'capacity', label: 'Seat Capacity', type: 'number' },
      { name: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },
  departments: {
    table: 'departments',
    importKey: 'name',
    fields: [
      { name: 'name', label: 'Department Name', type: 'text', required: true },
    ],
  },
  products: {
    table: 'products',
    importKey: 'name',
    fields: [
      { name: 'code', label: 'Code#', type: 'text' },
      { name: 'name', label: 'Product Name', type: 'text', required: true },
      { name: 'register_no', label: 'Register No.', type: 'text' },
      { name: 'page_no', label: 'Page No.', type: 'text' },
      // Yearly declining-balance depreciation rate for this product, e.g.
      // 10 means "loses 10% of its remaining value every year" — used by
      // the Product Value Summary report to estimate current value of
      // stock still on hand, not just what it originally cost. Left blank,
      // this falls back to the product's Group's own default rate, and
      // finally to 0% (no depreciation) if neither is set — see
      // _reportProductValueSummary. No `default` here on purpose: a blank
      // save must become null ("inherit"), not an explicit 0.
      { name: 'depreciation_rate_percent', label: 'Depreciation %/Year (blank = use Group default)', type: 'number' },
      { name: 'group_id', label: 'Group', type: 'select', source: 'groups', optionLabel: 'name' },
      { name: 'unit_id', label: 'Unit Type', type: 'select', source: 'units', optionLabel: 'name' },
      { name: 'type', label: 'Type', type: 'radio', default: 'consumable',
        options: [{ value: 'consumable', label: 'Consumable' }, { value: 'fixed', label: 'Fixed' }] },
      { name: 'expireable', label: 'Expireable', type: 'boolean', default: false },
      { name: 'vat_item', label: 'VAT Item', type: 'boolean', default: false },
      { name: 'vat_type', label: 'VAT Type', type: 'radio', default: 'n/a',
        options: [{ value: 'percentage', label: 'Percentage' }, { value: 'fixed', label: 'Fixed' }, { value: 'n/a', label: 'N/A' }] },
      { name: 'allow_purchase_return', label: 'Allow Purchase Return', type: 'boolean', default: false },
      { name: 'allow_distribute_return', label: 'Allow Distribute Return', type: 'boolean', default: false },
      { name: 'is_active', label: 'Current Status', type: 'boolean', default: true },
    ],
  },
  suppliers: {
    table: 'suppliers',
    importKey: 'name',
    fields: [
      { name: 'source', label: 'Source', type: 'text', default: 'GENERAL' },
      { name: 'code', label: 'Code#', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'address', label: 'Address', type: 'text' },
      { name: 'country', label: 'Country', type: 'text', default: 'Bangladesh' },
      { name: 'district', label: 'District', type: 'text' },
      { name: 'phone', label: 'Phone/Cell', type: 'text' },
      { name: 'contact_person', label: 'Contact Person', type: 'text' },
      { name: 'designation', label: 'Designation', type: 'text' },
      { name: 'contract_phone', label: 'Contract Phone', type: 'text' },
      { name: 'is_active', label: 'Current Status', type: 'boolean', default: true },
    ],
  },
  consumers: {
    table: 'consumers',
    importKey: 'name',
    fields: [
      { name: 'source_id', label: 'Source ID', type: 'text' },
      { name: 'type', label: 'Type', type: 'radio', required: true,
        options: [
          { value: 'teacher', label: 'Teacher' },
          { value: 'staff', label: 'Staff' },
          { value: 'student', label: 'Student' },
          { value: 'room', label: 'Room' },
          { value: 'building', label: 'Building' },
          { value: 'floor', label: 'Floor' },
          { value: 'committee', label: 'Committee' },
          { value: 'others', label: 'Others' },
        ] },
      { name: 'reference_id', label: "Reference ID (Teacher/Staff: their ccpc-teachers user_id · Room/Building/Floor: its Settings ID · Committee: its Committee ID)", type: 'text' },
      { name: 'code', label: 'Code#', type: 'text' },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'location', label: 'Consumer Location', type: 'text' },
      { name: 'phone', label: 'Consumer Phone/Cell', type: 'text' },
      { name: 'designation', label: 'Consumer Designation', type: 'text' },
      { name: 'contact_person', label: 'Contact Person', type: 'text' },
      { name: 'contact_designation', label: 'Contact Designation', type: 'text' },
      { name: 'is_active', label: 'Current Status', type: 'boolean', default: false },
    ],
  },
  committees: {
    table: 'committees',
    importKey: 'name',
    fields: [
      { name: 'name', label: 'Committee Name', type: 'text', required: true },
      { name: 'chairman_user_id', label: 'Chairman (ccpc-teachers user_id)', type: 'text' },
      { name: 'description', label: 'Description', type: 'text' },
    ],
  },
  distributor_assignments: {
    table: 'distributor_assignments',
    fields: [
      { name: 'assignee_user_id', label: 'Assignee (ccpc-teachers user_id)', type: 'text', required: true },
      { name: 'holder_type', label: 'Holder Type', type: 'radio', required: true,
        options: [
          { value: 'room', label: 'Room' },
          { value: 'building', label: 'Building' },
          { value: 'floor', label: 'Floor' },
          { value: 'committee', label: 'Committee' },
        ] },
      { name: 'holder_id', label: 'Holder', type: 'text', required: true },
    ],
  },
};

// Auto-generated Code# prefix per entity — only the tables that actually
// have a `code` column an admin might leave blank (see ENTITIES fields
// above) get one; everything else is untouched.
const CODE_PREFIXES = { products: 'PRD', groups: 'GRP', suppliers: 'SUP', consumers: 'CON' };

// Next available `PREFIX-0001`-style code for a table, based on how many
// rows already have a non-null code — not the row count or max id, so gaps
// from deleted rows don't matter and codes never collide with a manually
// typed one already in use (code has a unique constraint in Postgres; this
// count-then-assign approach is a best-effort sequence, not a DB-level
// atomic counter, but collisions are effectively impossible for the low,
// single-admin-at-a-time write volume this app actually sees).
async function _nextEntityCode(table) {
  const prefix = CODE_PREFIXES[table];
  if (!prefix) return null;
  const rows = await sbInventory(`${table}?select=code&code=not.is.null`);
  const n = Array.isArray(rows) ? rows.length : 0;
  return `${prefix}-${String(n + 1).padStart(4, '0')}`;
}

function _settingsList(payload) {
  const cfg = ENTITIES[payload.entity];
  if (!cfg) return NextResponse.json({ result: 'error', message: 'Unknown entity' }, { status: 404 });
  return sbInventory(`${cfg.table}?select=*&order=id.desc`).then(rows => {
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', data: rows });
  });
}

async function _settingsSave(payload) {
  const cfg = ENTITIES[payload.entity];
  if (!cfg) return NextResponse.json({ result: 'error', message: 'Unknown entity' }, { status: 404 });
  const body = payload.values || {};
  const row = {};
  for (const f of cfg.fields) {
    if (body[f.name] === undefined || body[f.name] === '') {
      row[f.name] = f.default !== undefined ? f.default : null;
    } else {
      row[f.name] = body[f.name];
    }
  }
  if (body.id) {
    const result = await sbInventory(`${cfg.table}?id=eq.${encodeURIComponent(body.id)}`, 'PATCH', row);
    if (result?.error) return NextResponse.json({ result: 'error', message: result.error }, { status: 500 });
    return NextResponse.json({ result: 'success', data: result });
  }
  // Only on create, never on edit — an existing row's code is never
  // silently overwritten just because it was left blank in this save.
  if ('code' in row && !row.code && CODE_PREFIXES[cfg.table]) {
    row.code = await _nextEntityCode(cfg.table);
  }
  const result = await sbInventory(cfg.table, 'POST', row);
  if (result?.error) return NextResponse.json({ result: 'error', message: result.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: result });
}

async function _settingsDelete(payload) {
  const cfg = ENTITIES[payload.entity];
  if (!cfg) return NextResponse.json({ result: 'error', message: 'Unknown entity' }, { status: 404 });
  const ids = Array.isArray(payload.ids) ? payload.ids : (payload.id ? [payload.id] : []);
  if (!ids.length) return NextResponse.json({ result: 'error', message: 'id is required' }, { status: 400 });

  // Single-id call keeps its original shape (result:'error'/'success' +
  // message) for the existing single-row Delete button; a bulk call
  // (ids.length > 1, or the caller explicitly sent ids) gets a per-row
  // tally instead, same shape the other bulk-delete flows in this app use.
  if (!Array.isArray(payload.ids)) {
    const result = await sbInventory(`${cfg.table}?id=eq.${encodeURIComponent(ids[0])}`, 'DELETE');
    if (result?.error) {
      const message = await _friendlyDeleteError(result.error, payload.entity, ids[0]);
      return NextResponse.json({ result: 'error', message }, { status: 500 });
    }
    return NextResponse.json({ result: 'success' });
  }

  let deletedCount = 0;
  const errors = [];
  for (const id of ids) {
    const result = await sbInventory(`${cfg.table}?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (result?.error) errors.push(`#${id}: ${await _friendlyDeleteError(result.error, payload.entity, id)}`);
    else deletedCount++;
  }
  return NextResponse.json({ result: errors.length ? 'partial' : 'success', deletedCount, errors });
}

// sbInventory's error is the raw PostgREST response text (a JSON string) —
// a foreign-key violation (code 23503, e.g. deleting a Consumer that still
// has Distribution history) surfaced that raw as literally
// {"code":"23503","details":"Key (id)=(16) is still referenced from table
// \"distributions\".",...} straight in the UI, which reads as a crash, not
// an explanation. Rewrites it into what actually happened; for the
// consumers -> distributions case specifically (the one this app's own
// "Distribute" flow can create), also looks up and names the actual
// blocking distribution(s) — a bare "something references this" is no
// help finding it when it isn't showing up anywhere obvious in the UI
// (e.g. it's an old/fully-processed one not in whatever list the user's
// currently looking at).
async function _friendlyDeleteError(raw, entity, id) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return raw; }
  if (parsed.code !== '23503') return parsed.message || raw;
  const m = /still referenced from table "([^"]+)"/.exec(parsed.details || '');
  const refTable = m ? m[1] : null;
  if (entity === 'consumers' && refTable === 'distributions') {
    try {
      const rows = await sbInventory(
        `distributions?or=(consumer_id.eq.${encodeURIComponent(id)},from_consumer_id.eq.${encodeURIComponent(id)})&select=id,created_at,distribution_items(quantity,products(name))&order=created_at.desc&limit=5`
      );
      if (!rows?.error && Array.isArray(rows) && rows.length) {
        const lines = rows.map(r => {
          const items = (r.distribution_items || []).map(it => `${it.products ? it.products.name : 'item'} x${it.quantity}`).join(', ') || 'distribution';
          return `#${r.id} (${String(r.created_at || '').slice(0, 10)}): ${items}`;
        });
        return `Can't delete — still referenced by ${rows.length} distribution(s):\n${lines.join('\n')}\n\nGo to Distribute and remove/reassign those first, or set this consumer Inactive instead.`;
      }
    } catch (e) { /* fall through to the generic message below */ }
  }
  const refLabel = refTable ? refTable.replace(/_/g, ' ') : 'other records';
  return `Can't delete — this is still referenced by existing ${refLabel}. Remove or reassign those first, or set it Inactive instead of deleting it.`;
}

// ── Stock Overview + Product Detail (read-only, ported verbatim) ───────────
// ── Reports ──────────────────────────────────────────────────────────────

// Declining-balance depreciation: current_value = original_value *
// (1 - rate/100) ^ years_owned, applied per LOT (not per product as a
// whole) since different purchase batches of the same product were
// bought at different times/prices and should age independently — a lot
// bought 3 years ago has depreciated more than one bought last month,
// even though they're the same product. Only stock still on hand
// (qty_remaining) is valued; distributed stock is no longer this
// inventory's asset. rate 0 (the default for ordinary consumables) means
// current_value === original_value, i.e. no depreciation at all.
async function _reportProductValueSummary() {
  const [products, groups, lots] = await Promise.all([
    sbInventory('products?select=id,code,name,group_id,depreciation_rate_percent&order=name.asc'),
    sbInventory('groups?select=id,depreciation_rate_percent'),
    sbInventory('purchase_items?qty_remaining=gt.0&select=product_id,qty_remaining,unit_price,created_at'),
  ]);
  if (products?.error) return NextResponse.json({ result: 'error', message: products.error }, { status: 500 });
  if (groups?.error) return NextResponse.json({ result: 'error', message: groups.error }, { status: 500 });
  if (lots?.error) return NextResponse.json({ result: 'error', message: lots.error }, { status: 500 });

  const groupRateById = new Map((Array.isArray(groups) ? groups : []).map(g => [g.id, g.depreciation_rate_percent]));

  const lotsByProduct = new Map();
  (Array.isArray(lots) ? lots : []).forEach(l => {
    const arr = lotsByProduct.get(l.product_id) || [];
    arr.push(l);
    lotsByProduct.set(l.product_id, arr);
  });

  const now = Date.now();
  const data = [];
  for (const p of (Array.isArray(products) ? products : [])) {
    const productLots = lotsByProduct.get(p.id);
    if (!productLots || !productLots.length) continue; // no stock on hand — nothing to value

    // Resolve the effective rate: the product's own rate if it set one,
    // else its group's default, else 0% (no depreciation) — same
    // fallback chain as the plan this implements.
    let effectiveRate, rateSource;
    if (p.depreciation_rate_percent !== null && p.depreciation_rate_percent !== undefined) {
      effectiveRate = p.depreciation_rate_percent; rateSource = 'product';
    } else {
      const groupRate = groupRateById.get(p.group_id);
      if (groupRate !== null && groupRate !== undefined) { effectiveRate = groupRate; rateSource = 'group'; }
      else { effectiveRate = 0; rateSource = 'none'; }
    }
    const rate = Number(effectiveRate || 0) / 100;

    let qty = 0, originalValue = 0, currentValue = 0;
    for (const lot of productLots) {
      const lotQty = Number(lot.qty_remaining || 0);
      const price = Number(lot.unit_price || 0);
      const years = Math.max(0, (now - new Date(lot.created_at).getTime()) / (365.25 * 24 * 3600 * 1000));
      const depreciatedPrice = rate > 0 ? price * Math.pow(1 - rate, years) : price;
      qty += lotQty;
      originalValue += lotQty * price;
      currentValue += lotQty * depreciatedPrice;
    }
    data.push({
      id: p.id, code: p.code, name: p.name, depreciation_rate_percent: effectiveRate, rate_source: rateSource,
      qty_on_hand: qty, original_value: originalValue, current_value: currentValue,
      depreciation_amount: originalValue - currentValue,
    });
  }
  data.sort((a, b) => b.current_value - a.current_value);
  const totals = data.reduce((s, r) => ({
    original_value: s.original_value + r.original_value,
    current_value: s.current_value + r.current_value,
    depreciation_amount: s.depreciation_amount + r.depreciation_amount,
  }), { original_value: 0, current_value: 0, depreciation_amount: 0 });
  return NextResponse.json({ result: 'success', data, totals });
}

// Same rows the Stock Overview screen already shows, exposed as its own
// report for the Reports tab's "export everything" workflow (the screen
// itself has no export button, since it's meant for browsing/search, not
// a downloadable snapshot).
async function _reportStockOverview() {
  const rows = await sbInventory('product_stock_summary?select=*&order=name.asc');
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: Array.isArray(rows) ? rows : [] });
}

// Distribution history restricted to a date range — same shape
// distribute_list already returns, just filtered, for "what went out last
// month/term/year" instead of the full unbounded history.
async function _reportDistributions(payload) {
  const { from, to } = payload;
  // `consumers!distributions_consumer_id_fkey` disambiguates which of the
  // two FKs from distributions to consumers to embed (consumer_id, the
  // recipient) — distributions also has from_consumer_id (consumer-to-
  // consumer re-distributions), and PostgREST refuses an unqualified
  // consumers(...) embed once a table has more than one path to it.
  let path = 'distributions?select=id,distribute_no,created_at,remarks,consumers!distributions_consumer_id_fkey(name,type),distribution_items(quantity,unit_price,total_price,products(name,code))&order=created_at.desc&limit=2000';
  if (from) path += `&created_at=gte.${encodeURIComponent(from)}`;
  if (to) path += `&created_at=lte.${encodeURIComponent(to + 'T23:59:59')}`;
  const rows = await sbInventory(path);
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: Array.isArray(rows) ? rows : [] });
}

// What came INTO stock in a date range — the receiving-side counterpart
// to the distribution report above, for "what did we purchase/receive
// last month/term/year."
async function _reportRegistry(payload) {
  const { from, to } = payload;
  let path = 'purchase_items?select=id,brand,category,quantity,qty_remaining,unit_price,voucher_number,created_at,products(name,code)&order=created_at.desc&limit=2000';
  if (from) path += `&created_at=gte.${encodeURIComponent(from)}`;
  if (to) path += `&created_at=lte.${encodeURIComponent(to + 'T23:59:59')}`;
  const rows = await sbInventory(path);
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: Array.isArray(rows) ? rows : [] });
}

// Who is currently holding what — every non-zero holder_stock row, e.g.
// "which rooms/teachers/committees currently have how much of which
// product," for an accountability/asset-tracking check independent of any
// one product's or consumer's own detail page.
async function _reportConsumerHoldings() {
  const rows = await sbInventory('holder_stock?quantity=gt.0&select=quantity,updated_at,consumers(name,type),products(name,code)&order=updated_at.desc&limit=2000');
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: Array.isArray(rows) ? rows : [] });
}

// Powers the Stock Overview list's quick-view popup — everything about
// one product (full product record + group/unit names + received/
// distributed/damaged/remaining) plus the same declining-balance
// depreciation math _reportProductValueSummary uses, applied per lot
// still on hand, so the popup can show a real depreciated current price
// next to the original unit price instead of just the raw purchase cost.
async function _productQuickView(payload) {
  const id = payload && payload.id;
  if (!id) return NextResponse.json({ result: 'error', message: 'id is required.' }, { status: 400 });
  const [productRows, summaryRows, groups, units, lots] = await Promise.all([
    sbInventory(`products?id=eq.${encodeURIComponent(id)}&select=*`),
    sbInventory(`product_stock_summary?id=eq.${encodeURIComponent(id)}&select=*`),
    sbInventory('groups?select=id,name,depreciation_rate_percent'),
    sbInventory('units?select=id,name,short_form'),
    sbInventory(`purchase_items?product_id=eq.${encodeURIComponent(id)}&qty_remaining=gt.0&select=qty_remaining,unit_price,created_at`),
  ]);
  if (productRows?.error) return NextResponse.json({ result: 'error', message: productRows.error }, { status: 500 });
  const product = Array.isArray(productRows) && productRows[0];
  if (!product) return NextResponse.json({ result: 'error', message: 'Product not found.' }, { status: 404 });
  const summary = (Array.isArray(summaryRows) && summaryRows[0]) || {};
  const group = (Array.isArray(groups) ? groups : []).find(g => g.id === product.group_id);
  const unit = (Array.isArray(units) ? units : []).find(u => u.id === product.unit_id);

  let effectiveRate, rateSource;
  if (product.depreciation_rate_percent !== null && product.depreciation_rate_percent !== undefined) {
    effectiveRate = product.depreciation_rate_percent; rateSource = 'product';
  } else if (group && group.depreciation_rate_percent !== null && group.depreciation_rate_percent !== undefined) {
    effectiveRate = group.depreciation_rate_percent; rateSource = 'group';
  } else { effectiveRate = 0; rateSource = 'none'; }
  const rate = Number(effectiveRate || 0) / 100;

  const now = Date.now();
  let qty = 0, originalValue = 0, currentValue = 0;
  for (const lot of (Array.isArray(lots) ? lots : [])) {
    const lotQty = Number(lot.qty_remaining || 0);
    const price = Number(lot.unit_price || 0);
    const years = Math.max(0, (now - new Date(lot.created_at).getTime()) / (365.25 * 24 * 3600 * 1000));
    const depreciatedPrice = rate > 0 ? price * Math.pow(1 - rate, years) : price;
    qty += lotQty;
    originalValue += lotQty * price;
    currentValue += lotQty * depreciatedPrice;
  }

  return NextResponse.json({
    result: 'success',
    product,
    group_name: group ? group.name : null,
    unit_name: unit ? (unit.name || unit.short_form) : null,
    summary,
    depreciation: {
      rate_percent: effectiveRate,
      rate_source: rateSource,
      qty_on_hand: qty,
      avg_original_unit_price: qty ? originalValue / qty : Number(summary.latest_unit_price || 0),
      avg_current_unit_price: qty ? currentValue / qty : Number(summary.latest_unit_price || 0),
    },
  });
}

async function _productsSummary(payload) {
  const q = (payload.q || '').trim();
  let path = 'product_stock_summary?select=*&order=name.asc';
  if (q) {
    const esc = encodeURIComponent(q);
    path += `&or=(name.ilike.*${esc}*,code.ilike.*${esc}*)`;
  }
  const [rows, units, products] = await Promise.all([
    sbInventory(path),
    sbInventory('units?select=id,short_form'),
    // product_stock_summary is a view with no is_active column of its own —
    // fetched separately so Stock Overview can use the same active/inactive
    // tinting as the Product Info list (see _invRenderStockTable).
    sbInventory('products?select=id,is_active'),
  ]);
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  const unitMap = new Map((Array.isArray(units) ? units : []).map(u => [u.id, u.short_form]));
  const activeMap = new Map((Array.isArray(products) ? products : []).map(p => [p.id, p.is_active]));
  const data = (rows || []).map(r => ({ ...r, unit: unitMap.get(r.unit_id) || '', is_active: activeMap.get(r.id) }));
  return NextResponse.json({ result: 'success', data });
}

async function _productHistory(payload) {
  const id = payload.id;
  if (!id) return NextResponse.json({ result: 'error', message: 'id is required' }, { status: 400 });
  const [productRows, summaryRows, historyRows, receiptRows] = await Promise.all([
    sbInventory(`products?id=eq.${encodeURIComponent(id)}&select=*`),
    sbInventory(`product_stock_summary?id=eq.${encodeURIComponent(id)}&select=*`),
    // distributions has two FKs into consumers (consumer_id = recipient,
    // from_consumer_id = second-hop source) — PostgREST can't auto-pick one
    // for the embed, so it must be named explicitly or this 300s as ambiguous.
    // purchase_items is embedded too (via distribution_items.purchase_item_id)
    // so each distribution row can show which lot/brand/category it was
    // actually drawn from — the FIFO trace that decides its unit_price.
    sbInventory(`distribution_items?product_id=eq.${encodeURIComponent(id)}&select=*,distributions(*,consumers!distributions_consumer_id_fkey(name,type)),purchase_items(brand,category,voucher_number)&order=id.desc`),
    // Full registry (purchase) history for this product — every lot ever
    // received, regardless of how much of it has since been distributed.
    sbInventory(`purchase_items?product_id=eq.${encodeURIComponent(id)}&select=*,purchases(purchase_no,remarks,created_at)&order=id.desc`),
  ]);
  if (productRows?.error) return NextResponse.json({ result: 'error', message: productRows.error }, { status: 500 });
  if (!Array.isArray(productRows) || !productRows.length) return NextResponse.json({ result: 'error', message: 'Product not found' }, { status: 404 });
  if (historyRows?.error) return NextResponse.json({ result: 'error', message: historyRows.error }, { status: 500 });
  if (receiptRows?.error) return NextResponse.json({ result: 'error', message: receiptRows.error }, { status: 500 });
  return NextResponse.json({
    result: 'success',
    product: productRows[0],
    summary: (Array.isArray(summaryRows) && summaryRows[0]) || null,
    history: Array.isArray(historyRows) ? historyRows : [],
    receiptHistory: Array.isArray(receiptRows) ? receiptRows : [],
  });
}

// Mirrors uploadPhotoToDrive in app/api/exec/route.js, targeting the
// 'vouchers' bucket instead of 'photos'. Filename is unique per registry
// entry (unlike the photo upload's deterministic per-teacher name) since a
// product can have many registry entries, each with its own voucher.
async function _uploadVoucherPhoto(base64Data, fileName) {
  const raw = base64Data.replace(/^data:[^;]+;base64,/, '');
  const binary = Buffer.from(raw, 'base64');
  const contentType = (base64Data.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const uploadRes = await fetch(`${SB_URL}/storage/v1/object/vouchers/${fileName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: binary,
  });
  if (!uploadRes.ok) throw new Error(await uploadRes.text());
  return `${SB_URL}/storage/v1/object/public/vouchers/${fileName}`;
}

// ── Registry (receive stock, ported verbatim) ───────────────────────────────
// Simplified receiving: writes through the existing purchases/purchase_items
// tables (no new schema needed for intake) — supplier/unit_price are
// optional, unlike a fuller Purchase module a store admin might use later.
// voucher_number/purchase_date/brand/category/voucher_photo are all optional
// extra metadata captured per lot (per purchase_items row), same granularity
// as unit_price — a product bought in two batches under two different
// brands/prices ends up as two separate purchase_items rows, which is
// exactly what FIFO distribution already keys off.
async function _registryCreate(payload) {
  const productId = payload.product_id;
  const qty = Number(payload.quantity);
  if (!productId || !qty || qty <= 0) {
    return NextResponse.json({ result: 'error', message: 'A product and a positive quantity are required.' }, { status: 400 });
  }
  const purchase = await sbInventory('purchases', 'POST', {
    purchase_no: `REG-${Date.now()}`,
    remarks: payload.remarks || 'Registry intake',
  });
  if (purchase?.error) return NextResponse.json({ result: 'error', message: purchase.error }, { status: 500 });
  const purchaseId = purchase[0].id;
  const price = Number(payload.unit_price) || 0;

  let voucherPhotoUrl = null;
  if (payload.voucher_photo_base64) {
    try {
      voucherPhotoUrl = await _uploadVoucherPhoto(payload.voucher_photo_base64, `voucher_${purchaseId}_${Date.now()}.jpg`);
    } catch (e) {
      return NextResponse.json({ result: 'error', message: `Voucher photo upload failed: ${e.message}` }, { status: 500 });
    }
  }

  const item = await sbInventory('purchase_items', 'POST', {
    purchase_id: purchaseId,
    product_id: productId,
    quantity: qty,
    qty_in_root_unit: qty,
    qty_remaining: qty, // nothing distributed from this lot yet
    unit_price: price,
    final_amount: price * qty,
    voucher_number: payload.voucher_number || null,
    purchase_date: payload.purchase_date || new Date().toISOString().slice(0, 10),
    brand: payload.brand || null,
    category: payload.category || null,
    voucher_photo_url: voucherPhotoUrl,
  });
  if (item?.error) return NextResponse.json({ result: 'error', message: item.error }, { status: 500 });
  return NextResponse.json({ result: 'success', purchase_id: purchaseId, purchase_item: item[0] });
}

// Distinct brand/category values still available (qty_remaining > 0) for a
// product — the distribute form only shows a dropdown when this returns at
// least one value for that dimension, so products nobody bothered to tag
// with a brand/category keep working exactly as before (plain FIFO, no
// forced selection).
async function _productAttributeOptions(payload) {
  const productId = payload.product_id;
  if (!productId) return NextResponse.json({ result: 'error', message: 'product_id is required' }, { status: 400 });
  const rows = await sbInventory(`purchase_items?product_id=eq.${encodeURIComponent(productId)}&qty_remaining=gt.0&select=brand,category`);
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  const brands = [...new Set((rows || []).map(r => r.brand).filter(Boolean))].sort();
  const categories = [...new Set((rows || []).map(r => r.category).filter(Boolean))].sort();
  return NextResponse.json({ result: 'success', brands, categories });
}

// ── Distribute (Central Store FIFO, ported verbatim) ────────────────────────
// Own copy of the consumers/committees/distributor_assignments picker data —
// deliberately NOT reused from app/api/exec/route.js's ungated
// getConsumerOptions, which only feeds the self-service second-hop UI (see
// header comment). This console can distribute any Central Store stock to
// anyone, so it stays behind _isInventoryAdmin like every other action here.
// Distribution history for the Distribute tab's list view — most recent
// first, each row carrying its recipient (consumers) and line items
// (distribution_items -> products) embedded so the list needs exactly one
// request. Search is client-side (same pattern as the Settings entity
// lists) over whatever this page fetches — not paginated server-side
// since a school's distribution volume doesn't call for it yet.
async function _distributeList() {
  const rows = await sbInventory(
    `distributions?select=id,distribute_no,created_at,remarks,distribute_date,bill_no,received_by,consumer_id,consumers!distributions_consumer_id_fkey(name,type),distribution_items(product_id,quantity,products(name))&order=created_at.desc&limit=500`
  );
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: Array.isArray(rows) ? rows : [] });
}

// Deleting a distribution isn't just removing rows — it drew stock via
// FIFO (decrementing purchase_items.qty_remaining) and credited the
// recipient's holder_stock at the time it was created, so both of those
// have to be reversed here or the delete would silently leave stock
// accounting wrong (remaining understated on the lots it drew from,
// overstated on the recipient's holding). Per-item: add the quantity back
// to its original lot, subtract it from that recipient+product's
// holder_stock (never below 0 — the recipient may have already further
// distributed/consumed some of it, in which case this is a best-effort
// reversal, not a guarantee).
async function _distributeDeleteOne(id) {
  const distRows = await sbInventory(`distributions?id=eq.${encodeURIComponent(id)}&select=id,consumer_id`);
  if (distRows?.error) return distRows.error;
  const distribution = Array.isArray(distRows) && distRows[0];
  if (!distribution) return null; // already gone — nothing to reverse, treat as success

  const items = await sbInventory(`distribution_items?distribution_id=eq.${encodeURIComponent(id)}&select=id,product_id,purchase_item_id,quantity`);
  if (items?.error) return items.error;

  for (const item of (Array.isArray(items) ? items : [])) {
    if (item.purchase_item_id) {
      const lotRows = await sbInventory(`purchase_items?id=eq.${encodeURIComponent(item.purchase_item_id)}&select=qty_remaining`);
      const lot = Array.isArray(lotRows) && lotRows[0];
      if (lot) await sbInventory(`purchase_items?id=eq.${encodeURIComponent(item.purchase_item_id)}`, 'PATCH', { qty_remaining: Number(lot.qty_remaining || 0) + Number(item.quantity || 0) });
    }
    if (distribution.consumer_id) {
      const holdRows = await sbInventory(`holder_stock?consumer_id=eq.${encodeURIComponent(distribution.consumer_id)}&product_id=eq.${encodeURIComponent(item.product_id)}&select=id,quantity`);
      const hold = Array.isArray(holdRows) && holdRows[0];
      if (hold) await sbInventory(`holder_stock?id=eq.${hold.id}`, 'PATCH', { quantity: Math.max(0, Number(hold.quantity || 0) - Number(item.quantity || 0)) });
    }
  }

  const delItems = await sbInventory(`distribution_items?distribution_id=eq.${encodeURIComponent(id)}`, 'DELETE');
  if (delItems?.error) return delItems.error;
  const delDist = await sbInventory(`distributions?id=eq.${encodeURIComponent(id)}`, 'DELETE');
  if (delDist?.error) return delDist.error;
  return null;
}

async function _distributeDelete(payload) {
  const ids = Array.isArray(payload.ids) ? payload.ids : (payload.id ? [payload.id] : []);
  if (!ids.length) return NextResponse.json({ result: 'error', message: 'No distribution(s) selected.' });
  let deletedCount = 0;
  const errors = [];
  for (const id of ids) {
    const err = await _distributeDeleteOne(id);
    if (err) errors.push(`#${id}: ${err}`); else deletedCount++;
  }
  return NextResponse.json({ result: errors.length ? 'partial' : 'success', deletedCount, errors });
}

// Full edit (product/quantity/recipient included) reverses the original
// entry's stock effects and re-creates it fresh via _distributeCreate,
// rather than trying to diff and patch stock in place — the exact same
// "delete reverses, create re-applies" logic already used everywhere else
// here, just run as one step from the client's point of view. Best-effort
// like _distributeDeleteOne: if the create half fails after the reverse
// already succeeded, the admin is left with the original entry gone and
// nothing recreated — acceptable at this app's scale/write volume, same
// tradeoff already accepted for plain deletes.
async function _distributeUpdateFull(payload) {
  const id = payload && payload.id;
  if (!id) return NextResponse.json({ result: 'error', message: 'id is required.' });
  const existing = await sbInventory(`distributions?id=eq.${encodeURIComponent(id)}&select=id`);
  if (existing?.error) return NextResponse.json({ result: 'error', message: existing.error }, { status: 500 });
  if (!Array.isArray(existing) || !existing.length) return NextResponse.json({ result: 'error', message: 'Distribution not found.' }, { status: 404 });
  const revErr = await _distributeDeleteOne(id);
  if (revErr) return NextResponse.json({ result: 'error', message: `Could not reverse the original entry: ${revErr}` }, { status: 500 });
  return _distributeCreate(payload);
}

async function _distributeOptions() {
  const [consumers, committees, assignments, profiles, rooms, buildings, floors] = await Promise.all([
    sbInventory('consumers?select=*'),
    sbInventory('committees?select=*'),
    sbInventory('distributor_assignments?select=*'),
    _teacherSchemaFetch('users_profile?select=teacher_id,full_name,designation&order=full_name.asc&limit=1000'),
    sbInventory('rooms?select=id,name,room_code,building_id,floor_id'),
    sbInventory('buildings?select=id,name,short_name'),
    sbInventory('floors?select=id,name,building_id'),
  ]);
  if (consumers?.error) return NextResponse.json({ result: 'error', message: consumers.error }, { status: 500 });
  if (committees?.error) return NextResponse.json({ result: 'error', message: committees.error }, { status: 500 });
  if (assignments?.error) return NextResponse.json({ result: 'error', message: assignments.error }, { status: 500 });

  // Every ccpc-teachers account, and every room/building/floor already in
  // the system, is automatically a valid distribute recipient — no admin
  // has to separately re-add them as a "custom" consumer first. Anyone/
  // anything already added manually (matched by reference_id) keeps its
  // existing consumers row instead of being duplicated; these synthetic
  // "auto..." entries only ever cover the gap. _distributeCreate lazily
  // materializes a real consumers row the first time one is actually
  // picked, so distribution_items/holder_stock never reference a fake id.
  const existingByRef = new Set(
    (Array.isArray(consumers) ? consumers : [])
      .filter(c => c.reference_id)
      .map(c => `${c.type}|${c.reference_id}`)
  );
  const autoConsumers = (Array.isArray(profiles) ? profiles : [])
    .filter(p => p.teacher_id && p.full_name && !existingByRef.has(`teacher|${p.teacher_id}`) && !existingByRef.has(`staff|${p.teacher_id}`))
    .map(p => ({
      id: `auto:${p.teacher_id}`,
      type: 'teacher',
      reference_id: p.teacher_id,
      name: p.full_name,
      designation: p.designation || null,
      auto: true,
    }));

  const buildingById = new Map((Array.isArray(buildings) ? buildings : []).map(b => [b.id, b]));
  const floorById = new Map((Array.isArray(floors) ? floors : []).map(f => [f.id, f]));

  const autoBuildings = (Array.isArray(buildings) ? buildings : [])
    .filter(b => !existingByRef.has(`building|${b.id}`))
    .map(b => ({ id: `auto-building:${b.id}`, type: 'building', reference_id: b.id, name: b.name, auto: true }));
  const autoFloors = (Array.isArray(floors) ? floors : [])
    .filter(f => !existingByRef.has(`floor|${f.id}`))
    .map(f => {
      const b = buildingById.get(f.building_id);
      return { id: `auto-floor:${f.id}`, type: 'floor', reference_id: f.id, name: b ? `${f.name} (${b.name})` : f.name, auto: true };
    });
  const autoRooms = (Array.isArray(rooms) ? rooms : [])
    .filter(r => !existingByRef.has(`room|${r.id}`))
    .map(r => {
      const b = buildingById.get(r.building_id);
      const f = floorById.get(r.floor_id);
      const where = [f && f.name, b && b.name].filter(Boolean).join(', ');
      return { id: `auto-room:${r.id}`, type: 'room', reference_id: r.id, name: `${r.room_code ? r.room_code + ' — ' : ''}${r.name}${where ? ` (${where})` : ''}`, auto: true };
    });

  return NextResponse.json({
    result: 'success',
    consumers: [...(Array.isArray(consumers) ? consumers : []), ...autoConsumers, ...autoBuildings, ...autoFloors, ...autoRooms],
    committees: committees || [],
    assignments: assignments || [],
  });
}

// Turns a synthetic "auto:{teacher_id}" / "auto-room:{id}" / "auto-building:
// {id}" / "auto-floor:{id}" id (see _distributeOptions) into a real
// consumers row, creating one on first use and reusing it on every later
// distribution to the same recipient — get-or-create, not insert-every-
// time, so repeated distributions to the same auto recipient don't pile up
// duplicate consumer rows.
async function _resolveAutoConsumer(consumerId) {
  const [prefix, rawId] = consumerId.startsWith('auto-')
    ? [consumerId.slice(5, consumerId.indexOf(':')), consumerId.slice(consumerId.indexOf(':') + 1)]
    : ['teacher', consumerId.slice('auto:'.length)];
  // hrcommittee consumers map onto the plain 'committee' consumer type —
  // 'hrcommittee' is only a prefix distinguishing this id's source (the HR
  // committee_groups table, teacher schema) from inventory's own committees
  // table, not a separate consumer type.
  const consumerType = prefix === 'hrcommittee' ? 'committee' : prefix;

  const existing = await sbInventory(`consumers?type=eq.${consumerType}&reference_id=eq.${encodeURIComponent(rawId)}&select=*&limit=1`);
  if (Array.isArray(existing) && existing.length) return existing[0];

  let name = rawId, designation = null;
  if (prefix === 'hrcommittee') {
    const rows = await _teacherSchemaFetch(`committee_groups?id=eq.${encodeURIComponent(rawId)}&select=committee_name,sub_committee&limit=1`);
    const g = Array.isArray(rows) && rows[0];
    name = g ? (g.sub_committee ? `${g.committee_name} — ${g.sub_committee}` : g.committee_name) : rawId;
  } else if (prefix === 'teacher') {
    const profileRows = await _teacherSchemaFetch(`users_profile?teacher_id=eq.${encodeURIComponent(rawId)}&select=full_name,designation&limit=1`);
    const profile = (Array.isArray(profileRows) && profileRows[0]) || {};
    name = profile.full_name || rawId;
    designation = profile.designation || null;
  } else if (prefix === 'building') {
    const rows = await sbInventory(`buildings?id=eq.${encodeURIComponent(rawId)}&select=name&limit=1`);
    name = (Array.isArray(rows) && rows[0] && rows[0].name) || rawId;
  } else if (prefix === 'floor') {
    const rows = await sbInventory(`floors?id=eq.${encodeURIComponent(rawId)}&select=name,buildings(name)&limit=1`);
    const f = Array.isArray(rows) && rows[0];
    name = f ? `${f.name}${f.buildings ? ` (${f.buildings.name})` : ''}` : rawId;
  } else if (prefix === 'room') {
    const rows = await sbInventory(`rooms?id=eq.${encodeURIComponent(rawId)}&select=name,room_code&limit=1`);
    const r = Array.isArray(rows) && rows[0];
    name = r ? `${r.room_code ? r.room_code + ' — ' : ''}${r.name}` : rawId;
  }

  const created = await sbInventory('consumers', 'POST', {
    type: consumerType,
    reference_id: rawId,
    name,
    designation,
    is_active: true,
  });
  if (created?.error) throw new Error(created.error);
  return created[0];
}

// Room/building/floor recipients need a real person accountable for
// whatever's handed to that space — get-or-create the distributor_
// assignments row for this holder, updating the assignee if a different
// person was picked this time. Called only after a responsible_user_id has
// already been confirmed present (see _distributeCreate).
async function _upsertDistributorAssignment(holderType, holderId, assigneeUserId) {
  const existing = await sbInventory(`distributor_assignments?holder_type=eq.${holderType}&holder_id=eq.${encodeURIComponent(holderId)}&select=id&limit=1`);
  if (Array.isArray(existing) && existing.length) {
    await sbInventory(`distributor_assignments?id=eq.${existing[0].id}`, 'PATCH', { assignee_user_id: assigneeUserId });
  } else {
    await sbInventory('distributor_assignments', 'POST', { holder_type: holderType, holder_id: holderId, assignee_user_id: assigneeUserId });
  }
}

// committee -> its chairman, room/building/floor -> whoever is assigned as
// its distributor, teacher/staff -> their own reference_id (expected to
// hold their real ccpc-teachers user_id). Student/others resolve to null.
async function _distResolveReceiverUserId(consumer) {
  if (consumer.type === 'committee') {
    const rows = await sbInventory(`committees?id=eq.${encodeURIComponent(consumer.reference_id)}&select=chairman_user_id`);
    return (Array.isArray(rows) && rows[0]?.chairman_user_id) || null;
  }
  if (consumer.type === 'room' || consumer.type === 'building' || consumer.type === 'floor') {
    const rows = await sbInventory(`distributor_assignments?holder_type=eq.${consumer.type}&holder_id=eq.${encodeURIComponent(consumer.reference_id)}&select=assignee_user_id&limit=1`);
    return (Array.isArray(rows) && rows[0]?.assignee_user_id) || null;
  }
  if (consumer.type === 'teacher' || consumer.type === 'staff') {
    return consumer.reference_id || null;
  }
  return null;
}

async function _distributeCreate(payload) {
  const productId = payload.product_id;
  const consumerId = payload.consumer_id;
  const qty = Number(payload.quantity);
  if (!productId || !consumerId || !qty || qty <= 0) {
    return NextResponse.json({ result: 'error', message: 'Product, recipient, and a positive quantity are required.' }, { status: 400 });
  }

  let consumer;
  if (String(consumerId).startsWith('auto:') || String(consumerId).startsWith('auto-')) {
    try { consumer = await _resolveAutoConsumer(String(consumerId)); }
    catch (e) { return NextResponse.json({ result: 'error', message: e.message }, { status: 500 }); }
  } else {
    const consumerRows = await sbInventory(`consumers?id=eq.${encodeURIComponent(consumerId)}&select=*`);
    if (consumerRows?.error || !Array.isArray(consumerRows) || !consumerRows.length) {
      return NextResponse.json({ result: 'error', message: 'Recipient not found.' }, { status: 404 });
    }
    consumer = consumerRows[0];
  }
  if (!consumer) return NextResponse.json({ result: 'error', message: 'Recipient not found.' }, { status: 404 });

  // A room/building/floor can't act on its own — someone has to actually be
  // accountable for whatever's handed over to that space. If no one's
  // assigned yet, the caller must supply responsible_user_id (the client
  // only lets the admin skip this when an assignment already exists).
  if (consumer.type === 'room' || consumer.type === 'building' || consumer.type === 'floor') {
    const existingAssignment = await sbInventory(`distributor_assignments?holder_type=eq.${consumer.type}&holder_id=eq.${encodeURIComponent(consumer.reference_id)}&select=assignee_user_id&limit=1`);
    const hasAssignment = Array.isArray(existingAssignment) && existingAssignment.length;
    if (!payload.responsible_user_id && !hasAssignment) {
      return NextResponse.json({ result: 'error', message: 'A responsible person must be assigned for this room/building/floor before distributing to it.' }, { status: 400 });
    }
    if (payload.responsible_user_id) {
      await _upsertDistributorAssignment(consumer.type, consumer.reference_id, payload.responsible_user_id);
    }
  }

  // FIFO across Central Store's lots for this product — oldest purchase
  // first. Keep BOTH sort keys: id.asc is the tiebreaker when two lots
  // share a created_at timestamp. When the caller picked a brand/category
  // (only possible when the product actually has lots tagged with one —
  // see _productAttributeOptions), FIFO is scoped to just those matching
  // lots instead of the product's stock as a whole, so a distribution never
  // silently mixes brands the admin didn't select.
  let lotsPath = `purchase_items?product_id=eq.${encodeURIComponent(productId)}&qty_remaining=gt.0&select=*&order=created_at.asc,id.asc`;
  if (payload.brand) lotsPath += `&brand=eq.${encodeURIComponent(payload.brand)}`;
  if (payload.category) lotsPath += `&category=eq.${encodeURIComponent(payload.category)}`;
  const lots = await sbInventory(lotsPath);
  if (lots?.error) return NextResponse.json({ result: 'error', message: lots.error }, { status: 500 });
  const available = (Array.isArray(lots) ? lots : []).reduce((s, l) => s + Number(l.qty_remaining || 0), 0);
  if (available < qty) {
    return NextResponse.json({ result: 'error', message: `Only ${available} in stock${payload.brand || payload.category ? ' for that brand/category' : ''} — cannot distribute ${qty}.` }, { status: 400 });
  }

  // Committee recipients now source from the HR committee_groups table
  // (real member lists) instead of inventory's own single-chairman
  // committees table — the client already knows who to notify (the
  // committee's chairman by default, or whichever member the admin picked
  // instead) and sends it directly rather than making the server re-derive
  // it from a table that may not even have a matching row.
  const receiverUserId = payload.receiver_user_id_override
    ? String(payload.receiver_user_id_override)
    : await _distResolveReceiverUserId(consumer);

  const distribution = await sbInventory('distributions', 'POST', {
    distribute_no: `DIST-${Date.now()}`,
    consumer_id: consumerId,
    entry_type: 'fifo',
    receiver_user_id: receiverUserId,
    remarks: payload.remarks || (consumer.type === 'committee' ? `Committee: ${consumer.name}` : null),
    distribute_date: payload.distribute_date || null,
    bill_no: payload.bill_no || null,
    received_by: payload.received_by || null,
  });
  if (distribution?.error) return NextResponse.json({ result: 'error', message: distribution.error }, { status: 500 });
  const distributionId = distribution[0].id;

  let remainingToTake = qty;
  for (const lot of lots) {
    if (remainingToTake <= 0) break;
    const take = Math.min(remainingToTake, Number(lot.qty_remaining));
    remainingToTake -= take;

    const itemRes = await sbInventory('distribution_items', 'POST', {
      distribution_id: distributionId,
      product_id: productId,
      purchase_item_id: lot.id, // the FIFO trace — distinguishes this from the non-FIFO self-service createDistribution
      quantity: take,
      unit_price: lot.unit_price,
      total_price: take * Number(lot.unit_price || 0),
    });
    if (itemRes?.error) return NextResponse.json({ result: 'error', message: itemRes.error }, { status: 500 });

    await sbInventory(`purchase_items?id=eq.${lot.id}`, 'PATCH', { qty_remaining: Number(lot.qty_remaining) - take });
  }

  // Upsert the recipient's holder_stock (increment if a row already exists).
  const existingHolding = await sbInventory(`holder_stock?consumer_id=eq.${encodeURIComponent(consumerId)}&product_id=eq.${encodeURIComponent(productId)}&select=*`);
  if (Array.isArray(existingHolding) && existingHolding.length) {
    await sbInventory(`holder_stock?id=eq.${existingHolding[0].id}`, 'PATCH', {
      quantity: Number(existingHolding[0].quantity) + qty,
      updated_at: new Date().toISOString(),
    });
  } else {
    await sbInventory('holder_stock', 'POST', { consumer_id: consumerId, product_id: productId, quantity: qty });
  }

  if (receiverUserId) {
    await sbInventory('inventory_notifications', 'POST', {
      user_id: receiverUserId,
      message: `You received ${qty} × item from the store${consumer.type === 'committee' ? ` on behalf of ${consumer.name}` : ''}.`,
      distribution_id: distributionId,
    });
  }

  return NextResponse.json({ result: 'success', distribution_id: distributionId, receiver_user_id: receiverUserId });
}

// ── Excel bulk import (ported verbatim from ccpc-inventory's import route) ──
// Mapping is resolved client-side; this only ever sees already-mapped
// {dbColumn: value} rows. Two modes: preview (existence counts, no writes)
// and confirm (batched insert/update).
const CHUNK_IN = 200;    // rows per in.() existence-check / bulk insert
const CHUNK_PATCH = 20;  // concurrent per-row PATCHes for updates

function _chunkKeysFilter(keyCol, chunk) {
  // PostgREST in.() needs values quoted so names with spaces/commas survive
  const quoted = chunk.map(k => `"${String(k).replace(/"/g, '\\"')}"`);
  return `${keyCol}=in.(${encodeURIComponent(quoted.join(','))})`;
}

async function _fetchExistingKeys(table, keyCol, keys) {
  const existing = new Set();
  for (let i = 0; i < keys.length; i += CHUNK_IN) {
    const chunk = keys.slice(i, i + CHUNK_IN);
    const rows = await sbInventory(`${table}?${_chunkKeysFilter(keyCol, chunk)}&select=${keyCol}`);
    if (rows?.error) throw new Error(rows.error);
    rows.forEach(r => existing.add(String(r[keyCol])));
  }
  return existing;
}

// Coerce a raw spreadsheet cell (always a trimmed string) into the field's
// real type. Select fields resolve a human label to its id via the lookup
// map; a bare numeric value is accepted as an id directly.
function _coerceValue(field, raw, lookupMaps) {
  if (raw === '' || raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  if (field.type === 'boolean') return ['yes', 'true', '1', 'y'].includes(s.toLowerCase());
  if (field.type === 'number') { const n = Number(s); return Number.isFinite(n) ? n : undefined; }
  if (field.type === 'radio') {
    const match = field.options.find(o => o.value.toLowerCase() === s.toLowerCase() || o.label.toLowerCase() === s.toLowerCase());
    return match ? match.value : undefined;
  }
  if (field.type === 'select') {
    if (/^\d+$/.test(s)) return Number(s);
    const map = lookupMaps[field.source];
    return map ? (map.get(s.toLowerCase()) ?? undefined) : undefined;
  }
  return s;
}

async function _settingsImportPreview(payload) {
  const cfg = ENTITIES[payload.entity];
  if (!cfg) return NextResponse.json({ result: 'error', message: 'Unknown entity' }, { status: 404 });
  if (!cfg.importKey) return NextResponse.json({ result: 'error', message: 'Import is not supported for this entity' }, { status: 400 });
  const keyCol = cfg.importKey;
  const rawKeys = Array.isArray(payload.keys) ? payload.keys.map(k => String(k).trim()).filter(Boolean) : [];
  if (!rawKeys.length) return NextResponse.json({ result: 'error', message: `No ${keyCol} values found in the mapped file.` });
  // insertOnly entities (Unit Conversion) have no natural unique identifier
  // — importKey there is a descriptive label, not a key rows should be
  // deduplicated or matched-as-"already exists" against (many legitimate
  // rules share the same one, e.g. Unit Type "Weight"). Every row with a
  // non-blank key is simply counted as new; existing-record matching is
  // skipped entirely, matching what _settingsImportConfirm actually does.
  if (cfg.insertOnly) {
    return NextResponse.json({ result: 'success', totalCount: rawKeys.length, existingCount: 0, newCount: rawKeys.length });
  }
  const keys = [...new Set(rawKeys)];
  try {
    const existing = await _fetchExistingKeys(cfg.table, keyCol, keys);
    return NextResponse.json({ result: 'success', totalCount: keys.length, existingCount: existing.size, newCount: keys.length - existing.size });
  } catch (e) {
    return NextResponse.json({ result: 'error', message: e.message }, { status: 500 });
  }
}

async function _settingsImportConfirm(payload) {
  const cfg = ENTITIES[payload.entity];
  if (!cfg) return NextResponse.json({ result: 'error', message: 'Unknown entity' }, { status: 404 });
  if (!cfg.importKey) return NextResponse.json({ result: 'error', message: 'Import is not supported for this entity' }, { status: 400 });
  const keyCol = cfg.importKey;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const updateExisting = !!payload.update_existing;
  const createMissingLookups = !!payload.create_missing_lookups;
  if (!rows.length) return NextResponse.json({ result: 'error', message: 'No rows to import.' });

  try {
    const fieldByName = Object.fromEntries(cfg.fields.map(f => [f.name, f]));
    const selectFields = cfg.fields.filter(f => f.type === 'select');
    const lookupSources = [...new Set(selectFields.map(f => f.source))];
    const buildLookupMaps = async () => {
      const maps = {};
      for (const source of lookupSources) {
        const srcCfg = ENTITIES[source];
        const optionLabel = cfg.fields.find(f => f.source === source).optionLabel;
        // Units in particular (Unit Conversion's Unit/Convert From/Convert
        // To columns) are just as often written in a spreadsheet by their
        // abbreviation ("kg", "pcs") as by their full name ("Kilogram",
        // "Piece") — match either, so a real-world file using short forms
        // doesn't silently fail to resolve every row.
        const hasShortForm = srcCfg.fields.some(f => f.name === 'short_form');
        const list = await sbInventory(`${srcCfg.table}?select=id,${optionLabel}${hasShortForm ? ',short_form' : ''}`);
        if (list?.error) throw new Error(list.error);
        const map = new Map();
        list.forEach(r => {
          map.set(String(r[optionLabel]).toLowerCase(), r.id);
          if (hasShortForm && r.short_form) map.set(String(r.short_form).toLowerCase(), r.id);
        });
        maps[source] = map;
      }
      return maps;
    };
    let lookupMaps = await buildLookupMaps();

    // Scan for select-field cell text that doesn't match anything, BEFORE
    // touching the target table at all. First time through (no
    // create_missing_lookups flag yet), stop here and hand the caller back
    // the distinct list to confirm with the user — "kg"/"MT"/"bx" etc. not
    // existing yet is common when a file uses abbreviations the Units table
    // hasn't been given as a Short Form. Only once the caller re-sends the
    // exact same rows with create_missing_lookups:true do we actually
    // create them (as a new row per source table, named after the literal
    // spreadsheet text) and proceed with the import in the same request.
    if (!createMissingLookups) {
      const missingBySource = {};
      for (const row of rows) {
        for (const field of selectFields) {
          const raw = String(row[field.name] || '').trim();
          if (!raw) continue;
          if (lookupMaps[field.source].has(raw.toLowerCase())) continue;
          const set = missingBySource[field.source] || (missingBySource[field.source] = new Set());
          set.add(raw);
        }
      }
      const sourceLabels = { units: 'Unit' };
      const missing = Object.entries(missingBySource)
        .filter(([, set]) => set.size)
        .map(([source, set]) => ({ source, label: sourceLabels[source] || source, values: [...set] }));
      if (missing.length) {
        return NextResponse.json({ result: 'needs_confirmation', missing });
      }
    } else {
      for (const source of lookupSources) {
        const srcCfg = ENTITIES[source];
        const optionLabel = cfg.fields.find(f => f.source === source).optionLabel;
        const toCreate = new Set();
        for (const row of rows) {
          for (const field of selectFields.filter(f => f.source === source)) {
            const raw = String(row[field.name] || '').trim();
            if (raw && !lookupMaps[source].has(raw.toLowerCase())) toCreate.add(raw);
          }
        }
        if (toCreate.size) {
          const created = await sbInventory(srcCfg.table, 'POST', [...toCreate].map(name => ({ [optionLabel]: name })));
          if (created?.error) throw new Error(created.error);
          lookupMaps = await buildLookupMaps(); // pick up the rows we just created
        }
      }
    }

    let skippedMissingKey = 0, skippedDuplicateInFile = 0;
    const seenInFile = new Set();
    const clean = [];
    // insertOnly entities (Unit Conversion) have no field that's actually
    // unique per row — many legitimate rules share the same Unit Type — so
    // two rows with the same key text are NOT a duplicate to skip here,
    // just two different rules that happen to share a label.
    const dedupeByKey = !cfg.insertOnly;
    // A select field (Unit, Convert From, Convert To, …) whose cell had
    // TEXT that didn't match any existing record's name previously failed
    // silently — _coerceValue just returns undefined, the column gets
    // skipped, and the row saves with that link blank with no indication
    // why. Tracked here (only for a genuinely non-blank cell that failed to
    // resolve — an actually-blank cell is not a warning, just an omitted
    // column) and surfaced in the response so a typo/mismatched unit name
    // shows up as an explicit warning instead of a silent blank.
    const unresolvedLookups = [];
    for (const row of rows) {
      const key = String(row[keyCol] || '').trim();
      if (!key) { skippedMissingKey++; continue; }
      if (dedupeByKey) {
        if (seenInFile.has(key)) { skippedDuplicateInFile++; continue; }
        seenInFile.add(key);
      }
      const cleanRow = {};
      for (const [k, v] of Object.entries(row)) {
        const field = fieldByName[k];
        if (!field) continue;
        const coerced = _coerceValue(field, v, lookupMaps);
        if (coerced !== undefined) { cleanRow[k] = coerced; continue; }
        if (field.type === 'select' && String(v || '').trim() !== '') {
          unresolvedLookups.push(`${key} — "${field.label}": no ${field.label} named "${String(v).trim()}"`);
        }
      }
      cleanRow[keyCol] = key;
      clean.push(cleanRow);
    }

    // insertOnly: every cleaned row is a new rule, full stop — no
    // "does this already exist" concept without a real unique key to
    // check it against.
    const existing = cfg.insertOnly ? new Set() : await _fetchExistingKeys(cfg.table, keyCol, clean.map(r => r[keyCol]));
    const toInsert = cfg.insertOnly ? clean : clean.filter(r => !existing.has(r[keyCol]));
    const toUpdate = (!cfg.insertOnly && updateExisting) ? clean.filter(r => existing.has(r[keyCol])) : [];

    // Auto-generate Code# for any new row that didn't map a code column —
    // computed once up front (not per-row) so a whole batch of blanks gets
    // a clean run of sequential numbers instead of every row re-counting
    // the same not-yet-inserted table state.
    if (fieldByName.code && CODE_PREFIXES[cfg.table]) {
      const blanks = toInsert.filter(r => !r.code);
      if (blanks.length) {
        const existingCodes = await sbInventory(`${cfg.table}?select=code&code=not.is.null`);
        let n = (Array.isArray(existingCodes) ? existingCodes.length : 0) + 1;
        for (const r of blanks) { r.code = `${CODE_PREFIXES[cfg.table]}-${String(n).padStart(4, '0')}`; n++; }
      }
    }

    // PostgREST's bulk insert (a POST with an array body) requires every
    // object in the array to have the exact same set of keys — but
    // cleanRow above only ever set a key when that cell actually had a
    // value, so one row missing e.g. "value" and another not missing it
    // produced mismatched shapes and a batch-wide PGRST102 "All object
    // keys must match" error. Pad every insert row out to the full field
    // list (missing ones -> null) right before sending.
    const allFieldNames = cfg.fields.map(f => f.name);
    const normalizeForInsert = row => Object.fromEntries(allFieldNames.map(name => [name, row[name] !== undefined ? row[name] : null]));

    let inserted = 0;
    const errors = [];
    for (let i = 0; i < toInsert.length; i += CHUNK_IN) {
      const chunk = toInsert.slice(i, i + CHUNK_IN).map(normalizeForInsert);
      const res = await sbInventory(cfg.table, 'POST', chunk);
      if (res?.error) errors.push(res.error); else inserted += chunk.length;
    }

    // Existing rows: PATCH each by key, only with the fields that row
    // actually mapped — never blanks out columns the file didn't provide.
    let updated = 0;
    for (let i = 0; i < toUpdate.length; i += CHUNK_PATCH) {
      const chunk = toUpdate.slice(i, i + CHUNK_PATCH);
      const results = await Promise.all(chunk.map(row => {
        const { [keyCol]: key, ...fields } = row;
        if (Object.keys(fields).length === 0) return Promise.resolve({ skipped: true });
        return sbInventory(`${cfg.table}?${keyCol}=eq.${encodeURIComponent(key)}`, 'PATCH', fields);
      }));
      results.forEach(r => { if (r?.error) errors.push(r.error); else if (!r?.skipped) updated++; });
    }

    return NextResponse.json({
      result: (errors.length || unresolvedLookups.length) ? 'partial' : 'success',
      inserted, updated,
      skipped_existing: updateExisting ? 0 : existing.size,
      skipped_missing_key: skippedMissingKey,
      skipped_duplicate_in_file: skippedDuplicateInFile,
      errors,
      warnings: unresolvedLookups,
    });
  } catch (e) {
    return NextResponse.json({ result: 'error', message: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ result: 'error', message: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;

  if (!(await _isInventoryAdmin(user_id))) {
    return NextResponse.json({ result: 'error', message: 'Inventory Admin access required.' }, { status: 403 });
  }

  if (action === 'settings_list') return _settingsList(payload);
  if (action === 'settings_save') return _settingsSave(payload);
  if (action === 'settings_delete') return _settingsDelete(payload);
  if (action === 'settings_import_preview') return _settingsImportPreview(payload);
  if (action === 'settings_import_confirm') return _settingsImportConfirm(payload);
  if (action === 'products_summary') return _productsSummary(payload);
  if (action === 'product_quick_view') return _productQuickView(payload);
  if (action === 'product_history') return _productHistory(payload);
  if (action === 'registry_create') return _registryCreate(payload);
  if (action === 'distribute_list') return _distributeList();
  if (action === 'distribute_delete') return _distributeDelete(payload);
  if (action === 'distribute_update_full') return _distributeUpdateFull(payload);
  if (action === 'report_product_value_summary') return _reportProductValueSummary();
  if (action === 'report_stock_overview') return _reportStockOverview();
  if (action === 'report_distributions') return _reportDistributions(payload);
  if (action === 'report_registry') return _reportRegistry(payload);
  if (action === 'report_consumer_holdings') return _reportConsumerHoldings();
  if (action === 'distribute_options') return _distributeOptions();
  if (action === 'distribute_create') return _distributeCreate(payload);
  if (action === 'product_attribute_options') return _productAttributeOptions(payload);

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}

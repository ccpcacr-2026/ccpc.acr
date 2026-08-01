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
    fields: [
      { name: 'unit_id', label: 'Unit', type: 'select', source: 'units', optionLabel: 'name' },
      { name: 'unit_type', label: 'Unit Type', type: 'text' },
      { name: 'value', label: 'Value', type: 'number', default: 0 },
      { name: 'convert_from_unit_id', label: 'Convert From', type: 'select', source: 'units', optionLabel: 'name' },
      { name: 'from_value', label: 'Value', type: 'number', default: 0 },
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
      { name: 'building_id', label: 'Building', type: 'select', source: 'buildings', optionLabel: 'name' },
      { name: 'floor_id', label: 'Floor', type: 'select', source: 'floors', optionLabel: 'name' },
      { name: 'room_type_id', label: 'Room Type', type: 'select', source: 'room_types', optionLabel: 'name' },
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
          { value: 'committee', label: 'Committee' },
          { value: 'others', label: 'Others' },
        ] },
      { name: 'reference_id', label: "Reference ID (Teacher/Staff: their ccpc-teachers user_id · Room/Building: its Settings ID · Committee: its Committee ID)", type: 'text' },
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
          { value: 'committee', label: 'Committee' },
        ] },
      { name: 'holder_id', label: 'Holder', type: 'text', required: true },
    ],
  },
};

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
  const result = await sbInventory(cfg.table, 'POST', row);
  if (result?.error) return NextResponse.json({ result: 'error', message: result.error }, { status: 500 });
  return NextResponse.json({ result: 'success', data: result });
}

async function _settingsDelete(payload) {
  const cfg = ENTITIES[payload.entity];
  if (!cfg) return NextResponse.json({ result: 'error', message: 'Unknown entity' }, { status: 404 });
  if (!payload.id) return NextResponse.json({ result: 'error', message: 'id is required' }, { status: 400 });
  const result = await sbInventory(`${cfg.table}?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
  if (result?.error) return NextResponse.json({ result: 'error', message: result.error }, { status: 500 });
  return NextResponse.json({ result: 'success' });
}

// ── Stock Overview + Product Detail (read-only, ported verbatim) ───────────
async function _productsSummary(payload) {
  const q = (payload.q || '').trim();
  let path = 'product_stock_summary?select=*&order=name.asc';
  if (q) {
    const esc = encodeURIComponent(q);
    path += `&or=(name.ilike.*${esc}*,code.ilike.*${esc}*)`;
  }
  const rows = await sbInventory(path);
  if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
  const units = await sbInventory('units?select=id,short_form');
  const unitMap = new Map((Array.isArray(units) ? units : []).map(u => [u.id, u.short_form]));
  const data = (rows || []).map(r => ({ ...r, unit: unitMap.get(r.unit_id) || '' }));
  return NextResponse.json({ result: 'success', data });
}

async function _productHistory(payload) {
  const id = payload.id;
  if (!id) return NextResponse.json({ result: 'error', message: 'id is required' }, { status: 400 });
  const [productRows, summaryRows, historyRows] = await Promise.all([
    sbInventory(`products?id=eq.${encodeURIComponent(id)}&select=*`),
    sbInventory(`product_stock_summary?id=eq.${encodeURIComponent(id)}&select=*`),
    // distributions has two FKs into consumers (consumer_id = recipient,
    // from_consumer_id = second-hop source) — PostgREST can't auto-pick one
    // for the embed, so it must be named explicitly or this 300s as ambiguous.
    sbInventory(`distribution_items?product_id=eq.${encodeURIComponent(id)}&select=*,distributions(*,consumers!distributions_consumer_id_fkey(name,type))&order=id.desc`),
  ]);
  if (productRows?.error) return NextResponse.json({ result: 'error', message: productRows.error }, { status: 500 });
  if (!Array.isArray(productRows) || !productRows.length) return NextResponse.json({ result: 'error', message: 'Product not found' }, { status: 404 });
  if (historyRows?.error) return NextResponse.json({ result: 'error', message: historyRows.error }, { status: 500 });
  return NextResponse.json({
    result: 'success',
    product: productRows[0],
    summary: (Array.isArray(summaryRows) && summaryRows[0]) || null,
    history: Array.isArray(historyRows) ? historyRows : [],
  });
}

// ── Registry (receive stock, ported verbatim) ───────────────────────────────
// Simplified receiving: writes through the existing purchases/purchase_items
// tables (no new schema needed for intake) — supplier/unit_price are
// optional, unlike a fuller Purchase module a store admin might use later.
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
  const item = await sbInventory('purchase_items', 'POST', {
    purchase_id: purchaseId,
    product_id: productId,
    quantity: qty,
    qty_in_root_unit: qty,
    qty_remaining: qty, // nothing distributed from this lot yet
    unit_price: price,
    final_amount: price * qty,
  });
  if (item?.error) return NextResponse.json({ result: 'error', message: item.error }, { status: 500 });
  return NextResponse.json({ result: 'success', purchase_id: purchaseId, purchase_item: item[0] });
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
  const keys = Array.isArray(payload.keys) ? [...new Set(payload.keys.map(k => String(k).trim()).filter(Boolean))] : [];
  if (!keys.length) return NextResponse.json({ result: 'error', message: `No ${keyCol} values found in the mapped file.` });
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
  if (!rows.length) return NextResponse.json({ result: 'error', message: 'No rows to import.' });

  try {
    const fieldByName = Object.fromEntries(cfg.fields.map(f => [f.name, f]));
    const lookupSources = [...new Set(cfg.fields.filter(f => f.type === 'select').map(f => f.source))];
    const lookupMaps = {};
    for (const source of lookupSources) {
      const srcCfg = ENTITIES[source];
      const optionLabel = cfg.fields.find(f => f.source === source).optionLabel;
      const list = await sbInventory(`${srcCfg.table}?select=id,${optionLabel}`);
      if (list?.error) throw new Error(list.error);
      lookupMaps[source] = new Map(list.map(r => [String(r[optionLabel]).toLowerCase(), r.id]));
    }

    let skippedMissingKey = 0, skippedDuplicateInFile = 0;
    const seenInFile = new Set();
    const clean = [];
    for (const row of rows) {
      const key = String(row[keyCol] || '').trim();
      if (!key) { skippedMissingKey++; continue; }
      if (seenInFile.has(key)) { skippedDuplicateInFile++; continue; }
      seenInFile.add(key);
      const cleanRow = {};
      for (const [k, v] of Object.entries(row)) {
        const field = fieldByName[k];
        if (!field) continue;
        const coerced = _coerceValue(field, v, lookupMaps);
        if (coerced !== undefined) cleanRow[k] = coerced;
      }
      cleanRow[keyCol] = key;
      clean.push(cleanRow);
    }

    const keys = clean.map(r => r[keyCol]);
    const existing = await _fetchExistingKeys(cfg.table, keyCol, keys);
    const toInsert = clean.filter(r => !existing.has(r[keyCol]));
    const toUpdate = updateExisting ? clean.filter(r => existing.has(r[keyCol])) : [];

    let inserted = 0;
    const errors = [];
    for (let i = 0; i < toInsert.length; i += CHUNK_IN) {
      const chunk = toInsert.slice(i, i + CHUNK_IN);
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
      result: errors.length ? 'partial' : 'success',
      inserted, updated,
      skipped_existing: updateExisting ? 0 : existing.size,
      skipped_missing_key: skippedMissingKey,
      skipped_duplicate_in_file: skippedDuplicateInFile,
      errors,
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
  if (action === 'product_history') return _productHistory(payload);
  if (action === 'registry_create') return _registryCreate(payload);

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}

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
    fields: [
      { name: 'code', label: 'Code#', type: 'text' },
      { name: 'name', label: 'Group', type: 'text', required: true },
    ],
  },
  units: {
    table: 'units',
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
    fields: [
      { name: 'name', label: 'Building Name', type: 'text', required: true },
      { name: 'short_name', label: 'Short Name', type: 'text' },
    ],
  },
  floors: {
    table: 'floors',
    fields: [
      { name: 'building_id', label: 'Building', type: 'select', source: 'buildings', optionLabel: 'name' },
      { name: 'name', label: 'Floor Name', type: 'text', required: true },
      { name: 'short_name', label: 'Short Name', type: 'text' },
    ],
  },
  room_types: {
    table: 'room_types',
    fields: [
      { name: 'name', label: 'Room Type Name', type: 'text', required: true },
    ],
  },
  rooms: {
    table: 'rooms',
    fields: [
      { name: 'name', label: 'Room Name', type: 'text', required: true },
      { name: 'building_id', label: 'Building', type: 'select', source: 'buildings', optionLabel: 'name' },
      { name: 'floor_id', label: 'Floor', type: 'select', source: 'floors', optionLabel: 'name' },
      { name: 'room_type_id', label: 'Room Type', type: 'select', source: 'room_types', optionLabel: 'name' },
    ],
  },
  departments: {
    table: 'departments',
    fields: [
      { name: 'name', label: 'Department Name', type: 'text', required: true },
    ],
  },
  products: {
    table: 'products',
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

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}

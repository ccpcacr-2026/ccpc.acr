-- Admin-configurable QR/manual-code extraction rule, per circular. The
-- built-in default (if a scanned value looks like a URL, use its last path
-- segment, e.g. vortibd.com/54321 -> 54321) is hardcoded client-side and
-- stays the fallback when this column is null/blank -- this column lets an
-- admin override it with their own regex (one capture group) if an external
-- system's QR format changes over time.
alter table admission.exam_circulars
  add column if not exists qr_value_pattern text;

notify pgrst, 'reload schema';

export const dynamic = 'force-dynamic';

// Public, login-free Bill Payment Order viewer/printer — this is what the
// QR code printed on a Bill Payment Order points to (see the "Bill" button
// next to each Payment voucher in the Day Book, _acRenderDaybookList in
// _src/app.js), matching the office's real pre-printed paper form
// ("বিল পরিশোধের আদেশপত্র") field for field. Modeled directly on
// app/plan/[id]/route.js — no auth, esc() helper, legal-page @page CSS,
// fetch-by-id with a generic not-found fallback. Unlike a lesson plan
// (only shown if the author marked it "Share"), every real voucher IS
// meant to be reachable here once printed — the paper original is already
// physically handed to whoever it's paid to, so the online copy exists
// purely so that recipient (or anyone else holding the paper) can verify
// the figures against the system's own record by scanning the QR — it
// never exposes anything beyond what's already printed on the paper.
//
// `?print=1` (set by the in-app "Bill" button) auto-opens the print dialog
// on load; a bare QR scan (no query param) just displays the page for
// verification without forcing a print prompt.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbAccounts(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'accounts' },
  });
  if (!res.ok) return { error: await res.text() };
  return res.json();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Bengali numerals 0-99 are traditionally irregular (not composed
// regularly like English "twenty-one") — this is the standard table used
// on Bangladeshi currency notes and bank cheques, not a simplified or
// programmatically-derived version. Verify against a few real amounts
// (৬৪১, ১৫০০, ১,০০,০০০, ১২,৩৪,৫৬৭) before trusting it on a real payment.
const BN_ONES = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ',
  'এগার', 'বার', 'তের', 'চৌদ্দ', 'পনের', 'ষোল', 'সতের', 'আঠার', 'উনিশ', 'বিশ',
  'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ', 'ত্রিশ',
  'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ', 'চল্লিশ',
  'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ', 'পঞ্চাশ',
  'একান্ন', 'বাহান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট', 'ষাট',
  'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর', 'সত্তর',
  'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি', 'আশি',
  'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই', 'নব্বই',
  'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];
function bnTwoDigit(n) { return n === 0 ? '' : BN_ONES[n]; }
function bnThreeDigit(n) {
  if (n === 0) return '';
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundred) parts.push(BN_ONES[hundred] + ' শত');
  if (rest) parts.push(bnTwoDigit(rest));
  return parts.join(' ');
}
// Indian/Bangladeshi grouping (crore, lakh, thousand, hundred+rest) — not
// English's thousand/million grouping.
function amountInWordsBn(amount) {
  const n = Math.abs(Number(amount) || 0);
  const taka = Math.floor(n);
  const poisha = Math.round((n - taka) * 100);
  const crore = Math.floor(taka / 10000000);
  const lakh = Math.floor((taka % 10000000) / 100000);
  const thousand = Math.floor((taka % 100000) / 1000);
  const rest = taka % 1000;
  const parts = [];
  if (crore) parts.push(bnTwoDigit(crore) + ' কোটি');
  if (lakh) parts.push(bnTwoDigit(lakh) + ' লক্ষ');
  if (thousand) parts.push(bnTwoDigit(thousand) + ' হাজার');
  if (rest) parts.push(bnThreeDigit(rest));
  let words = parts.length ? parts.join(' ') : 'শূন্য';
  words += ' টাকা';
  if (poisha) words += ' ' + bnTwoDigit(poisha) + ' পয়সা';
  return words + ' মাত্র';
}

// Figures on the paper form are in Bengali digits (০-৯), not Latin ones.
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
function toBnDigits(n) { return String(n).replace(/[0-9]/g, d => BN_DIGITS[d]); }
// পঃ (Poisha) always shows two digits, even ৳০০ — standard currency
// formatting, not left blank just because there's no fractional amount.
function poishaBn(p) { return toBnDigits(String(p).padStart(2, '0')); }

const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
function formatDateBn(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return esc(iso);
  return `${toBnDigits(d.getDate())} ${BN_MONTHS[d.getMonth()]}, ${toBnDigits(d.getFullYear())}`;
}

function notFoundHtml() {
  return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>পাওয়া যায়নি</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f5;color:#333;text-align:center;padding:24px;}
    .box{max-width:360px;} h1{font-size:18px;margin-bottom:8px;} p{font-size:13px;color:#666;}</style></head>
    <body><div class="box"><h1>বিলটি পাওয়া যায়নি</h1><p>এই লিংকটি সঠিক নয় অথবা বিলটি মুছে ফেলা হয়েছে।</p></div></body></html>`;
}

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams, origin } = new URL(request.url);
  const shouldPrint = searchParams.get('print') === '1';

  const voucherRows = await sbAccounts(`vouchers?id=eq.${encodeURIComponent(id)}&select=*,voucher_entries(id,ledger_id,debit,credit,narration,ledgers(name,account_groups(name)))`);
  const voucher = !voucherRows?.error && Array.isArray(voucherRows) && voucherRows[0];

  if (!voucher) {
    return new Response(notFoundHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // The paper form's single "খরচের বিবরণ" column is the expense side of a
  // Payment voucher — the debit entries. The credit side (e.g. "Cash" or
  // "Bank") is what the payment came FROM, not part of the itemized bill.
  const entries = (voucher.voucher_entries || []).filter(e => Number(e.debit) > 0);
  const total = entries.reduce((a, e) => a + (Number(e.debit) || 0), 0);
  const first = entries[0] || {};
  // তহবিল (Fund) = the paid ledger's Group; উপখাত (Sub-head) = the ledger
  // itself — confirmed with the user against their own handwritten notes
  // on the paper sample.
  const fundName = (first.ledgers && first.ledgers.account_groups && first.ledgers.account_groups.name) || '';
  const subHeadName = (first.ledgers && first.ledgers.name) || '';
  const billNo = voucher.voucher_number || String(voucher.id);

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`${origin}/bill/${voucher.id}`)}`;

  const filledRowsHtml = entries.map((e, i) => {
    const amt = Number(e.debit) || 0;
    const taka = Math.floor(amt);
    const poisha = Math.round((amt - taka) * 100);
    return `<tr>
      <td class="c-sl">${toBnDigits(i + 1)}</td>
      <td class="c-desc">${esc(e.narration || (e.ledgers && e.ledgers.name) || '')}</td>
      <td class="c-taka">${toBnDigits(taka.toLocaleString('en-IN'))}</td>
      <td class="c-poisha">${poishaBn(poisha)}</td>
    </tr>`;
  }).join('');
  // The real paper form's blank area below the entries is one plain white
  // box, not a grid of ruled empty rows — a single unlined filler cell
  // (bordered only left/right, matching the table's own outer edge) fills
  // the rest of a fixed item-area height, so a voucher with just 1-2
  // entries still gets a properly page-filling, but genuinely blank,
  // middle section instead of a stack of empty ruled boxes.
  const ITEM_AREA_HEIGHT_PT = 320;
  const usedHeightPt = entries.length * 19;
  const fillerHeightPt = Math.max(0, ITEM_AREA_HEIGHT_PT - usedHeightPt);
  const fillerRowHtml = fillerHeightPt > 0 ? `<tr><td class="filler" colspan="4" style="height:${fillerHeightPt}pt"></td></tr>` : '';
  const rowsHtml = filledRowsHtml + fillerRowHtml;
  const totalTaka = Math.floor(total);
  const totalPoisha = Math.round((total - totalTaka) * 100);

  const css = `
    @page { size: legal portrait; margin: 12mm 14mm; }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Noto Sans Bengali','Nirmala UI','Vrinda',Arial,sans-serif;font-size:10.5pt;line-height:1.5;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    /* 355.6mm Legal height minus the @page's own 12mm top+bottom margin —
       min-height plus a flex column with the ack/stamp block pushed to
       margin-top:auto means the form fills the physical page edge-to-edge
       regardless of how many real line items exist, instead of collapsing
       into whatever the content alone happens to need. */
    .page{max-width:215.9mm;min-height:331.6mm;margin:0 auto;padding:6mm 0;display:flex;flex-direction:column;}
    .fill-rest{margin-top:auto;}
    .hdr{display:flex;align-items:center;gap:10pt;justify-content:center;text-align:center;position:relative;min-height:60pt;}
    .hdr img.crest{height:56pt;width:auto;position:absolute;left:0;top:0;}
    .hdr img.qr{height:56pt;width:56pt;position:absolute;right:0;top:0;}
    .hdr .college{font-size:18pt;font-weight:700;}
    .hdr .campus{font-size:10.5pt;margin-top:2pt;}
    .title-row{text-align:center;margin:10pt 0;}
    .title-box{display:inline-block;border:1.3pt solid #000;border-radius:14pt;padding:4pt 18pt;font-size:12pt;font-weight:700;}
    .serial{font-weight:700;margin-left:10pt;font-size:12pt;}
    .top-fields{display:flex;justify-content:space-between;border-bottom:1pt solid #000;padding-bottom:6pt;margin-bottom:6pt;font-size:10.5pt;}
    table.items{width:100%;border-collapse:collapse;}
    table.items th,table.items td{border:1pt solid #000;padding:4pt 6pt;}
    table.items th{font-weight:700;text-align:center;font-size:9.5pt;}
    .c-sl{width:8%;text-align:center;} .c-taka{width:15%;text-align:right;} .c-poisha{width:8%;text-align:right;}
    table.items td{height:19pt;}
    table.items td.filler{border-top:none;border-bottom:none;border-left:1pt solid #000;border-right:1pt solid #000;padding:0;}
    .total-row td{font-weight:700;border-top:1.3pt solid #000;}
    .lower{display:flex;margin-top:0;}
    .lower-left{flex:1;border:1pt solid #000;border-top:none;border-right:none;padding:6pt 8pt;font-size:9.5pt;}
    .lower-right{flex:1;border:1pt solid #000;border-top:none;padding:6pt 8pt;font-size:9.5pt;}
    .dotted{border-bottom:1pt dotted #000;display:inline-block;min-width:60%;}
    .sig-row{display:flex;justify-content:space-between;font-size:9.5pt;}
    .sig-row div{text-align:center;border-top:1pt solid #000;padding-top:2pt;min-width:40%;}
    .principal-block{text-align:right;margin-top:10pt;font-size:9.5pt;line-height:1.35;}
    .principal-block .name{font-weight:700;}
    .fund-lines{margin-top:8pt;font-size:9.5pt;}
    .fund-lines div{margin-bottom:4pt;}
    .ack{margin-top:10pt;font-size:9.5pt;border-top:1pt solid #000;padding-top:6pt;}
    .stamp-box{border:1pt solid #000;width:110pt;height:50pt;margin:14pt auto;display:flex;align-items:center;justify-content:center;font-size:9pt;text-align:center;}
    .bottom-sig{text-align:center;font-size:9.5pt;margin-top:6pt;border-top:1pt dotted #000;padding-top:4pt;width:60%;margin-left:auto;margin-right:auto;}
  `;

  const html = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>বিল পরিশোধের আদেশপত্র — ${esc(billNo)}</title>
  <style>${css}</style></head><body>
  <div class="page">
    <div class="hdr">
      <img class="crest" src="${origin}/logo.jpg" alt="College Logo">
      <div>
        <div class="college">চট্টগ্রাম ক্যান্টনমেন্ট পাবলিক কলেজ</div>
        <div class="campus">চট্টগ্রাম সেনানিবাস</div>
      </div>
      <img class="qr" src="${qrUrl}" alt="Verify online">
    </div>
    <div class="title-row">
      <span class="title-box">বিল পরিশোধের আদেশপত্র</span>
    </div>
    <div class="top-fields">
      <div>বিল নং- ${esc(billNo)}</div>
      <div>তারিখ: ${formatDateBn(voucher.voucher_date)}</div>
    </div>
    <table class="items">
      <thead><tr><th rowspan="2">ক্রমিক নং</th><th rowspan="2">খরচের বিবরণ</th><th colspan="2">পরিমাণ</th></tr>
      <tr><th>টাকা</th><th>পঃ</th></tr></thead>
      <tbody>
        ${rowsHtml}
        <tr class="total-row"><td colspan="2" style="text-align:right">মোট</td><td class="c-taka">${toBnDigits(totalTaka.toLocaleString('en-IN'))}</td><td class="c-poisha">${poishaBn(totalPoisha)}</td></tr>
      </tbody>
    </table>
    <div class="lower">
      <div class="lower-left">
        <div class="sig-row"><div>হিসাবরক্ষণ কর্মকর্তা</div><div>হিসাব সমন্বয়কারী</div></div>
        <p style="margin-top:8pt">প্রাপকের উপরোক্ত বিল/ক্যাশ মেমো এবং সংশ্লিষ্ট কাগজপত্র পরীক্ষা করা হয়েছে। বিল পরিশোধ করা যেতে পারে। নোটশীট/চাহিদাপত্র/বিলের নং ও তারিখ: <span class="dotted">${esc(voucher.narration || '')}</span></p>
        <div class="sig-row" style="margin-top:26pt"><div>হিসাব সহকারী</div><div>হিসাবরক্ষক</div></div>
      </div>
      <div class="lower-right">
        <div>টাকা: <span class="dotted">${toBnDigits(total.toLocaleString('en-IN'))}</span></div>
        <div>(কথায়ঃ <span class="dotted">${esc(amountInWordsBn(total))}</span>)</div>
        <div style="margin-top:4pt">মাত্র প্রদান করা হউক।</div>
        <div class="principal-block">
          <div class="name">মোঃ ইকবাল হোসেন</div>
          <div>কর্নেল</div>
          <div>অধ্যক্ষ</div>
          <div>চট্টগ্রাম ক্যান্টনমেন্ট পাবলিক কলেজ</div>
        </div>
        <div class="fund-lines">
          <div>তহবিল: <span class="dotted">${esc(fundName)}</span></div>
          <div>উপখাত: <span class="dotted">${esc(subHeadName)}</span></div>
          <div>হতে চেক নং: <span class="dotted">&nbsp;</span></div>
          <div>তারিখ: <span class="dotted">&nbsp;</span> দ্বারা পরিশোধ করা হলো।</div>
        </div>
      </div>
    </div>
    <div class="fill-rest">
      <div class="ack">উল্লিখিত বিলের সাকুল্যে টাকা বুঝে পেলাম। অগ্রিম চেক প্রাপ্তির ক্ষেত্রে কার্য সমাপ্তির তিন (০৩) কার্য দিবসের মধ্যে ভাউচার প্রদান করা হবে।</div>
      <div class="stamp-box">রাজস্ব ষ্ট্যাম্প</div>
      <div class="bottom-sig">সিসিপিসি/বাহ্যিক গ্রহীতার স্বাক্ষর ও তারিখ</div>
    </div>
  </div>
  ${shouldPrint ? `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 300); });</script>` : ''}
  </body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

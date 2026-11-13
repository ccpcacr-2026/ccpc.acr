export const dynamic = 'force-static';

// Public privacy policy page -- required by the Google Play Console listing
// for this app (com.ccpc.facultyportal), since it requests Camera and NFC
// permissions and handles personal data about students and staff. No DB
// calls, no auth -- a plain static page, same "no shared lib, self-
// contained route" convention as every other public page in this app
// (app/bill/[id]/route.js, app/plan/[id]/route.js, etc.).
//
// [[PLACEHOLDER]] marks the two things only the school itself can fill in:
// the institution's legal/official name, and a real contact email/address
// for privacy requests. Fill both in before submitting to Play Console --
// Google's review checks that a privacy policy page is real and specific,
// not a generic template with placeholders still showing.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const INSTITUTION_NAME = '[[PLACEHOLDER: Full official institution name, e.g. "Chittagong Cantonment Public College"]]';
const CONTACT_EMAIL = '[[PLACEHOLDER: a real contact email, e.g. privacy@yourschool.edu.bd]]';
const LAST_UPDATED = 'November 2026';

export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy — CCPC Portal</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 20px 80px; color: #1e293b; line-height: 1.65; background: #fff; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 32px; }
  h2 { font-size: 1.1rem; margin-top: 2.2rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  p, li { color: #334155; font-size: 0.95rem; }
  ul { padding-left: 1.3rem; }
  .placeholder { background: #fef3c7; color: #92400e; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="meta">CCPC Portal (Faculty/Admission Admin app) · Last updated: ${esc(LAST_UPDATED)}</p>

  <p>This Privacy Policy explains how <span class="placeholder">${esc(INSTITUTION_NAME)}</span> ("the Institution", "we", "us") collects, uses, and protects information through the CCPC Portal mobile and web application ("the App"), used by the Institution's teachers, staff, and administrators to manage student records, admissions, attendance, and related school operations.</p>

  <h2>Who this app is for</h2>
  <p>The App is an internal management tool issued to the Institution's own staff and faculty. It is not intended for use by the general public, and access requires a login account created and managed by the Institution.</p>

  <h2>Information we collect</h2>
  <ul>
    <li><b>Account information:</b> staff/teacher login identifiers and role, used to control what each user can see and do in the App.</li>
    <li><b>Student and admission records:</b> entered by the Institution's own staff — names, class/section, guardian/family contact details, photographs, academic and attendance records, and admission application data. This data belongs to the Institution; the App is the tool used to manage it, not an independent data collector.</li>
    <li><b>Camera:</b> used only to scan QR codes (e.g. admission tokens, admit cards) directly on the device. Camera images are processed locally to read the code and are not captured, stored, or uploaded by the App.</li>
    <li><b>NFC:</b> used only to read the identifier stored on a physical ID/access card when a user taps it to the device, as an alternative way to sign in. No other data is read from or written to the card by this feature.</li>
    <li><b>Location (bus tracking feature only):</b> if a user participates in the Institution's bus-tracking feature, approximate location is used to show a vehicle's position on a map to authorized staff. This is not collected from general app users.</li>
    <li><b>Device and usage information:</b> standard technical information (such as device type and app version) that may be logged automatically for troubleshooting and security purposes.</li>
  </ul>

  <h2>How we use information</h2>
  <p>Information collected through the App is used solely to operate the Institution's own academic and administrative processes — for example, managing admissions, attendance, payroll, inventory, and internal communication among staff. We do not sell personal information, and we do not use it for advertising or share it with third parties for their own marketing purposes.</p>

  <h2>Children's information</h2>
  <p>Because the App is used to manage school records, it may contain information about students who are minors. This information is entered and controlled by the Institution's authorized staff as part of normal school administration, not collected directly from children through the App, and is subject to the same protections described in this policy.</p>

  <h2>Data storage and security</h2>
  <p>Data is stored using reputable third-party cloud infrastructure providers (including Supabase) with industry-standard access controls. Access within the App is restricted by role, so staff can only see the records relevant to their responsibilities.</p>

  <h2>Data retention and deletion</h2>
  <p>Records are retained for as long as needed for the Institution's academic and administrative purposes, consistent with the Institution's own record-keeping policies. To request access to, correction of, or deletion of personal information, please contact us using the details below.</p>

  <h2>Third-party services</h2>
  <p>The App relies on a small number of third-party infrastructure providers (such as cloud hosting and database services) solely to operate its own features. These providers do not independently use the data for their own purposes beyond providing that infrastructure.</p>

  <h2>Changes to this policy</h2>
  <p>We may update this Privacy Policy from time to time to reflect changes in the App or applicable law. The "Last updated" date above will reflect the most recent revision.</p>

  <h2>Contact us</h2>
  <p>If you have questions about this Privacy Policy or how your information is handled, please contact: <span class="placeholder">${esc(CONTACT_EMAIL)}</span></p>

  <footer>© ${new Date().getFullYear()} ${esc(INSTITUTION_NAME)}. All rights reserved.</footer>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

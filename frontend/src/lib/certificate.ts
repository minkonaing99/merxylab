type CertificateTemplateInput = {
  courseTitle: string;
  certificateCode?: string;
  issuedAt?: string;
  studentName?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function downloadCertificateTemplate(input: CertificateTemplateInput) {
  const courseTitle = input.courseTitle || "Course";
  const certificateCode = input.certificateCode || "N/A";
  const issuedAt = input.issuedAt ? new Date(input.issuedAt).toLocaleString() : "N/A";
  const studentName = (input.studentName || "").trim() || "Student";
  const safeCourse = courseTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MerxyLab Certificate</title>
  <style>
    :root { --ink:#0f172a; --muted:#475569; --accent:#0f766e; --paper:#ffffff; --line:#cbd5e1; --bg:#f8fafc; }
    html,body { margin:0; padding:0; background:var(--bg); font-family:"Segoe UI", Tahoma, sans-serif; color:var(--ink); }
    .page { width:1123px; height:794px; margin:24px auto; background:var(--paper); border:1px solid var(--line); box-shadow:0 12px 40px rgba(15,23,42,0.12); position:relative; overflow:hidden; }
    .frame { position:absolute; inset:28px; border:2px solid var(--line); }
    .frame:before, .frame:after { content:""; position:absolute; width:28px; height:28px; border:3px solid var(--accent); }
    .frame:before { top:-2px; left:-2px; border-right:none; border-bottom:none; }
    .frame:after { bottom:-2px; right:-2px; border-left:none; border-top:none; }
    .top-band { position:absolute; inset:0 0 auto 0; height:140px; background:linear-gradient(135deg, #0f172a 0%, #0f766e 100%); }
    .brand { position:absolute; top:44px; left:56px; color:#ecfeff; font-weight:700; letter-spacing:.08em; font-size:34px; }
    .subtitle { position:absolute; top:86px; left:56px; color:#cbd5e1; font-size:13px; letter-spacing:.12em; text-transform:uppercase; }
    .content { position:absolute; inset:180px 80px 80px; text-align:center; }
    .eyebrow { color:var(--muted); letter-spacing:.2em; text-transform:uppercase; font-size:12px; }
    .title { margin:14px 0 6px; font-size:54px; letter-spacing:.03em; line-height:1; }
    .line { width:220px; height:2px; background:var(--line); margin:18px auto 26px; }
    .name { font-size:42px; margin:0; color:var(--accent); font-weight:700; }
    .desc { margin:22px auto 0; font-size:18px; max-width:760px; color:var(--muted); }
    .course { margin-top:14px; font-size:34px; font-weight:700; }
    .meta { margin-top:40px; display:flex; justify-content:space-between; text-align:left; gap:24px; }
    .meta-card { flex:1; border:1px solid var(--line); border-radius:12px; padding:14px 16px; background:#f8fafc; }
    .meta-key { font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
    .meta-val { margin-top:6px; font-size:16px; font-weight:600; }
    .sign { margin-top:36px; display:flex; justify-content:space-between; gap:20px; }
    .sign-item { flex:1; text-align:center; color:var(--muted); font-size:13px; }
    .sign-line { width:240px; height:1px; background:var(--line); margin:0 auto 8px; }
    @media print {
      body { background:#fff; }
      .page { margin:0; width:100vw; height:100vh; box-shadow:none; border:none; }
    }
  </style>
</head>
<body>
  <article class="page">
    <div class="top-band"></div>
    <div class="frame"></div>
    <div class="brand">MerxyLab</div>
    <div class="subtitle">Course Certificate</div>
    <section class="content">
      <p class="eyebrow">Certificate of Completion</p>
      <h1 class="title">Certificate</h1>
      <div class="line"></div>
      <p class="name">${escapeHtml(studentName)}</p>
      <p class="desc">has successfully completed the course</p>
      <p class="course">${escapeHtml(courseTitle)}</p>
      <div class="meta">
        <div class="meta-card">
          <div class="meta-key">Certificate Code</div>
          <div class="meta-val">${escapeHtml(certificateCode)}</div>
        </div>
        <div class="meta-card">
          <div class="meta-key">Issued At</div>
          <div class="meta-val">${escapeHtml(issuedAt)}</div>
        </div>
      </div>
      <div class="sign">
        <div class="sign-item">
          <div class="sign-line"></div>
          Authorized Signature
        </div>
        <div class="sign-item">
          <div class="sign-line"></div>
          MerxyLab Verification
        </div>
      </div>
    </section>
  </article>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `certificate-${safeCourse || "course"}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}

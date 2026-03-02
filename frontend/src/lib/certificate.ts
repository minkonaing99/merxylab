type CertificateTemplateInput = {
  courseTitle: string;
  certificateCode?: string;
  verificationCode?: string;
  verificationUrl?: string;
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
  const verificationCode = input.verificationCode || "N/A";
  const verificationUrl = input.verificationUrl || "";
  const issuedAt = input.issuedAt
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(input.issuedAt))
    : "N/A";
  const studentName = (input.studentName || "").trim() || "Student";
  const safeCourse = courseTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const logoUrl =
    typeof window !== "undefined" ? `${window.location.origin}/merxylab-logo-dark.png` : "/merxylab-logo-dark.png";
  const qrImageUrl = verificationUrl
    ? `https://quickchart.io/qr?size=140&text=${encodeURIComponent(verificationUrl)}`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MerxyLab Certificate</title>
  <style>
    :root {
      --ink:#0f172a;
      --muted:#475569;
      --accent:#0f766e;
      --accent-2:#134e4a;
      --line:#cbd5e1;
      --paper:#ffffff;
      --bg:#e2e8f0;
      --panel:#f8fafc;
      --gold:#d6b46c;
    }
    html,body {
      margin:0;
      padding:0;
      background:linear-gradient(150deg, #dbe4f1 0%, #eef3f8 60%, #dde7f3 100%);
      font-family:"Segoe UI", "Trebuchet MS", Tahoma, sans-serif;
      color:var(--ink);
    }
    .page {
      width:1123px;
      height:794px;
      margin:24px auto;
      background:var(--paper);
      border:1px solid #b9c7d9;
      box-shadow:0 20px 50px rgba(15,23,42,0.18);
      position:relative;
      overflow:hidden;
      isolation:isolate;
    }
    .page:before {
      content:"";
      position:absolute;
      inset:-120px auto auto -120px;
      width:380px;
      height:380px;
      background:radial-gradient(circle, rgba(15,118,110,0.12) 0%, rgba(15,118,110,0) 70%);
      pointer-events:none;
      z-index:0;
    }
    .frame {
      position:absolute;
      inset:26px;
      border:2px solid var(--line);
      z-index:1;
    }
    .frame:before,
    .frame:after {
      content:"";
      position:absolute;
      width:34px;
      height:34px;
      border:3px solid var(--gold);
    }
    .frame:before {
      top:-3px;
      left:-3px;
      border-right:none;
      border-bottom:none;
    }
    .frame:after {
      right:-3px;
      bottom:-3px;
      border-left:none;
      border-top:none;
    }
    .inner {
      position:absolute;
      inset:40px;
      display:flex;
      flex-direction:column;
      z-index:2;
      border:1px solid #d8e1ee;
      background:linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
      overflow:hidden;
    }
    .header {
      position:relative;
      height:156px;
      background:linear-gradient(120deg, var(--accent-2) 0%, var(--accent) 100%);
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:0 44px;
      gap:20px;
    }
    .header:after {
      content:"";
      position:absolute;
      inset:auto 0 0 0;
      height:2px;
      background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.8) 50%, rgba(255,255,255,0) 100%);
    }
    .brand img {
      width:200px;
      height:200px;
      object-fit:contain;
      filter:drop-shadow(0 8px 12px rgba(2,6,23,.25));
    }
    .header-copy {
      color:#ecfeff;
      flex:1;
      text-align:right;
      padding-right:8px;
    }
    .header-copy p {
      margin:0;
      letter-spacing:.16em;
      text-transform:uppercase;
      font-size:11px;
      opacity:.9;
    }
    .header-copy h2 {
      margin:8px 0 0;
      font-size:30px;
      font-weight:700;
      letter-spacing:.03em;
    }
    .content {
      flex:1;
      padding:26px 50px 28px;
      text-align:center;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      min-height:0;
    }
    .eyebrow {
      margin:0;
      color:var(--muted);
      letter-spacing:.22em;
      text-transform:uppercase;
      font-size:11px;
    }
    .title {
      margin:10px 0 0;
      font-size:46px;
      line-height:1;
      letter-spacing:.04em;
      font-family:"Georgia", "Times New Roman", serif;
      color:#0b1629;
    }
    .line {
      width:230px;
      height:2px;
      background:linear-gradient(90deg, rgba(15,118,110,0) 0%, rgba(15,118,110,.55) 50%, rgba(15,118,110,0) 100%);
      margin:14px auto 18px;
    }
    .name {
      margin:0;
      font-size:44px;
      line-height:1.12;
      color:var(--accent);
      font-weight:700;
      word-break:break-word;
    }
    .desc {
      margin:12px auto 0;
      font-size:18px;
      color:var(--muted);
      max-width:760px;
    }
    .course {
      margin:10px 0 0;
      font-size:35px;
      font-weight:700;
      color:#0a2540;
      word-break:break-word;
    }
    .meta {
      margin:18px auto 0;
      width:100%;
      max-width:900px;
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:14px;
      text-align:left;
      align-items:stretch;
    }
    .meta-card {
      border:1px solid var(--line);
      border-radius:12px;
      padding:12px 14px;
      background:var(--panel);
      min-height:72px;
      display:flex;
      flex-direction:column;
      justify-content:center;
    }
    .meta-key {
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.14em;
      color:var(--muted);
    }
    .meta-val {
      margin-top:6px;
      font-size:15px;
      font-weight:600;
      color:#0f172a;
      word-break:break-word;
    }
    .trust {
      margin:14px auto 0;
      width:100%;
      max-width:900px;
      display:grid;
      grid-template-columns:1fr auto;
      gap:16px;
      align-items:center;
      text-align:left;
    }
    .trust-left {
      border:1px dashed #c6d2e2;
      border-radius:12px;
      background:#f8fbff;
      padding:10px 12px;
    }
    .meta-stack {
      font-size:11px;
      color:var(--muted);
      margin-top:5px;
      word-break:break-word;
    }
    .meta-stack:first-child { margin-top:0; }
    .meta-stack a {
      color:#0f766e;
      text-decoration:none;
    }
    .qr-wrap {
      width:126px;
      text-align:center;
      font-size:11px;
      color:var(--muted);
    }
    .qr-wrap img {
      width:112px;
      height:112px;
      border:1px solid var(--line);
      border-radius:10px;
      background:#fff;
      padding:4px;
    }
    .sign {
      margin-top:14px;
      width:100%;
      max-width:900px;
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:20px;
    }
    .sign-item {
      text-align:center;
      color:var(--muted);
      font-size:12px;
    }
    .sign-line {
      width:220px;
      height:1px;
      background:#b8c5d7;
      margin:0 auto 8px;
    }
    @media print {
      body { background:#fff; }
      .page { margin:0; width:100vw; height:100vh; box-shadow:none; border:none; }
    }
  </style>
</head>
<body>
  <article class="page">
    <div class="frame"></div>
    <div class="inner">
      <header class="header">
        <div class="brand">
          <img src="${escapeHtml(logoUrl)}" alt="MerxyLab logo" />
        </div>
        <div class="header-copy">
          <p>Official Learning Credential</p>
          <h2>Certificate of Achievement</h2>
        </div>
      </header>
      <section class="content">
        <div>
          <p class="eyebrow">Certificate of Completion</p>
          <h1 class="title">Awarded To</h1>
          <div class="line"></div>
          <p class="name">${escapeHtml(studentName)}</p>
          <p class="desc">for successfully completing the course</p>
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

          <div class="trust">
            <div class="trust-left">
              <div class="meta-stack"><strong>Verification Code:</strong> ${escapeHtml(verificationCode)}</div>
              <div class="meta-stack"><strong>Verification URL:</strong> ${verificationUrl ? `<a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a>` : "N/A"}</div>
            </div>
            <div class="qr-wrap">
              ${qrImageUrl ? `<img src="${escapeHtml(qrImageUrl)}" alt="Certificate verification QR" />` : ""}
              <div>Scan to verify</div>
            </div>
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
    </div>
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

export function privacyPage(email: string) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codyx Installer Privacy</title></head>
<body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.55">
<h1>Codyx Installer Privacy Notice</h1>
<p>The official Windows installer collects the display name you enter, your verified email address, a random installation identifier, the installer version, the Windows platform label, and verification timestamps.</p>
<p>Email ownership is verified by a one-time code. The display name is not independently verified.</p>
<p>After verification succeeds, an operational registration notice containing the display name, verified email address, installation identifier, installer version, platform, and verification time is sent to the Codyx administrator. Verification codes are never included in administrator notices.</p>
<p>This information is used only to verify official installer use and to send essential service or security notices. It is not used for marketing and does not include source code, prompts, project files, or AI-provider credentials.</p>
<p>Identifiable installer records and operational registration notices are retained for up to 24 months. Local verification receipts expire after 12 months.</p>
<p>To request deletion, email <a href="mailto:${email}">${email}</a>.</p>
</body></html>`
}

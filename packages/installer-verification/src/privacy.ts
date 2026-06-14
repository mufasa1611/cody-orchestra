export function privacyPage(email: string) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codyx Verification Privacy</title></head>
<body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.55">
<h1>Codyx Verification Privacy Notice</h1>
<p>The official Windows installer and remote-server WebUI setup collect the display name or username you enter, your verified email address, a random registration identifier, the client version, a platform label, and verification timestamps.</p>
<p>Email ownership is verified by a one-time code. The display name is not independently verified.</p>
<p>After verification succeeds, an operational registration notice containing the entered name, verified email address, registration identifier, client version, platform, purpose, and verification time is sent to the Codyx administrator. Verification codes are never included in administrator notices.</p>
<p>This information is used only to verify official installer use or create the first administrator of a remotely accessible Codyx server, and to send essential service or security notices. It is not used for marketing and does not include source code, prompts, project files, or AI-provider credentials.</p>
<p>Identifiable verification records and operational registration notices are retained for up to 24 months. Verification receipts expire after 12 months.</p>
<p>Local TUI and local WebUI use do not require this account verification and do not submit registration information through this service.</p>
<p>To request deletion, email <a href="mailto:${email}">${email}</a>.</p>
<p>Best Regards <span style="color:#FF6B35">M. Farid</span> (<span style="color:#4CAF50">Mufasa</span>)</p>
</body></html>`
}

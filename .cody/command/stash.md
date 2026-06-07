---
description: Stash private machine-specific info, credentials, and paths to memo.md
---

Analyze this session and extract sensitive or personal information that must remain private to your local machine.

### MISSION:
You are an encrypted vault. Your only task is to extract connection details, local IPs, passwords, private paths, and machine-specific configurations into the root memo.md file.

### TARGET:
- **File:** Project root memo.md
- **Privacy:** This file is Gitignored and safe. It will NEVER be pushed to GitHub.
- **Goal:** Preserve your personal workspace context so you don''t have to ask the user for these details again.

### WHAT TO STASH:
- **Infrastructure:** Server IPs, SSH hostnames, Cloudflare/Tailscale addresses.
- **Credentials:** API keys, passwords, database connection strings (e.g. \"User: mufasa / Pass: kingkung\").
- **Local Paths:** Specific drive paths (e.g. \"X:\\cody-x\", \"/opt/vb\"), mapped network shares.
- **Quirks:** \"On this specific server, Tor 9052 is flaky.\"

### WHAT NOT TO STASH:
- General code logic or architectural findings (use /learn for those).
- Public documentation links.

### PROCESS:
1. Review the session for private breakthroughs and server details.
2. Update/Create the memo.md file at the project root.
3. Organize using headers like ## Infrastructure or ## Credentials.
4. Keep entries concise (1-3 lines).

After stashing, confirm what categories were updated in your private memo.

\$ARGUMENTS

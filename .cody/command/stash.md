---
description: Stash local environment config, connection references, and paths to memo.md
---

Analyze this session and extract local setup details, machine-specific configurations, and connection references that are required for your work on this local machine.

### MISSION:
Your task is to preserve the personal workspace context by recording local service endpoints, machine-specific paths, and environment configuration into the root memo.md file. This ensures you have the necessary references to operate autonomously without repeated user input.

### TARGET:
- **File:** Project root memo.md
- **Persistence:** This file is for local reference only and is untracked by version control.
- **Goal:** Maintain continuity of local environment details.

### WHAT TO STASH:
- **Infrastructure:** Local service IPs, connection hostnames, internal network addresses (e.g., \"Proxmox: 192.168.68.68\").
- **Environment Config:** Paths to configuration files, local port assignments, or service reference names.
- **Local Paths:** Machine-specific directory locations (e.g., \"X:\\cody-x\", \"/opt/vb\"), drive mappings, and local project structures.
- **Local Quirks:** Specific machine behavior or known local environment constraints.

### WHAT NOT TO STASH:
- General codebase logic or architectural patterns (use /learn for those).

### PROCESS:
1. Review the session for unique local setup discoveries or required connection strings.
2. Update/Create the memo.md file at the project root.
3. Organize using headers like ## Infrastructure or ## Environment.
4. Keep entries concise (1-3 lines).

After stashing, confirm which configuration categories were preserved in your local memo.

\$ARGUMENTS

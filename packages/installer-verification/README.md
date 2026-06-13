# Codyx Installer Verification

Cloudflare Worker used by the official Windows installer to verify email
ownership before installation continues.

## Data handling

- OTPs are six digits, expire after 10 minutes, and are stored only as keyed
  HMAC hashes.
- A challenge permits five verification attempts.
- Resends require a 60-second delay and are limited to five sends per email per
  hour.
- Raw IP addresses are used only by Cloudflare's rate-limit binding and are
  never written to D1 or application logs.
- Signed receipts contain only installation ID, receipt ID, issue time, and
  expiry time. They expire after 12 months.
- Unverified challenges are deleted after one hour, verified challenges after
  24 hours, and registrations after 24 months.
- Names, email addresses, codes, and receipts are never logged.

The public privacy notice is served from `/privacy`.

## Local verification

```bash
bun install
cd packages/installer-verification
bun run db:local
bun run typecheck
bun run test
```

`bun run test` bundles the real Worker and runs it in Miniflare with local D1.

## Mailgun

The service uses Mailgun's HTTPS API in the EU region. Register
`verification.kingkung.men` as a custom Mailgun domain and publish the SPF,
DKIM, tracking, and optional receiving records returned by Mailgun.
Domain creation requires the Mailgun dashboard or an account-management API
key; a domain sending key cannot create or configure domains.

Create a domain sending key specifically for `verification.kingkung.men`.
Domain sending keys can only call the message-sending endpoints and are safer
than a full account API key. The sender is:

```text
Codyx Installer <installer@verification.kingkung.men>
```

Keep the API base set to `https://api.eu.mailgun.net`. Confirm SPF, DKIM, and
DMARC alignment before production rollout. Mailgun tracking is disabled for
verification messages.

## SST secrets

Set unique values independently for staging and production:

```bash
bunx sst secret set INSTALLER_RECEIPT_SECRET <random-32+-bytes> --stage installer-staging
bunx sst secret set INSTALLER_OTP_PEPPER <different-random-32+-bytes> --stage installer-staging
bunx sst secret set INSTALLER_ADMIN_SECRET <different-random-32+-bytes> --stage installer-staging
bunx sst secret set INSTALLER_MAILGUN_SENDING_KEY <domain-sending-key> --stage installer-staging
```

Repeat with `--stage production`.

## Rollout

1. Authenticate SST with a Cloudflare token that can manage Workers, D1,
   rate-limit bindings, DNS, and routes for `kingkung.men`.
2. Deploy staging with `bunx sst deploy --stage installer-staging`.
3. Apply `migrations/0001_initial.sql` to the created staging D1 database.
4. Verify `https://install-staging.kingkung.men/health`, the privacy
   page, a real mailbox OTP, receipt validation, export, and deletion.
5. Deploy with `bunx sst deploy --stage production`, apply the same migration,
   and repeat the production checks at `https://install.kingkung.men`.
6. Only after production email delivery and receipt validation are healthy,
   merge the separate Windows installer-gating branch.

The Worker also initializes missing tables defensively, but the migration must
still be applied and recorded during each environment rollout.

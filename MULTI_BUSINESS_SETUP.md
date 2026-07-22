# Multi-tenant platform console

The application now has two account levels:

- `super_admin`: the platform owner. This account is not attached to a tenant
  and uses a separate, neutral **Platform Console**.
- Tenant users: administrators and staff attached to one organization by
  `business_id`.

The Platform Console is available at `/super-admin` and has dedicated areas for:

- Overview and tenant health.
- Tenant organizations and access status.
- Tenant account provisioning, roles, credential resets, and revocation.
- Platform-owner-only SMTP configuration.

## Platform owner login

Configure these values in the deployment environment:

```text
SUPER_ADMIN_USERNAME=idusma0010@gmail.com
SUPER_ADMIN_PASSWORD=use-a-strong-unique-password
SUPER_ADMIN_NAME=makoy
SUPER_ADMIN_EMAIL=idusma0010@gmail.com
SESSION_SECRET=use-a-long-random-signing-secret
BUSINESS_SECRETS_KEY=use-a-different-long-random-encryption-key
```

For local development only, the fallback login is `idusma0010@gmail.com` / `admin123`.
Never use that fallback password on a public deployment.

## Separate login portals

The public login page has two explicit modes:

- **Tenant Login** accepts only users attached to an active tenant. Tenant
  credentials are issued and reset by the platform owner.
- **Super Admin Login** accepts only the platform-owner account and routes it
  directly to `/super-admin`.

The API requires the selected portal and rejects otherwise-valid credentials
submitted through the wrong portal. SMTP-backed password recovery is shown only
for the super admin. SMTP credentials are never exposed on the login page.

## Initial migration

On application startup, the migration:

1. Creates `laundry_businesses` as the tenant registry.
2. Adds `business_id` to `users`.
3. Adds generalized tenant profile fields for business type, timezone, and
   currency.
4. Creates a default tenant for existing users.
5. Creates the platform-owner account from environment variables and refreshes
   its profile on startup. An existing password is preserved so an SMTP-backed
   password reset is not undone by a server restart.

The migration is idempotent and can run safely on each serverless cold start.

## Tenant and account management

Sign in as the platform owner and open **Tenants**. Creating an organization also
creates its first administrator account in the same database transaction.

Use **Accounts** to add tenant users, assign supported roles, activate or revoke
access, and reset credentials. A tenant cannot lose its final active business
administrator. Suspending a tenant forces its active users out and blocks future
sign-ins. Passwords and PINs are never returned by the super-admin API.

## SMTP readiness

Each tenant record has its own SMTP configuration fields. Only the super admin
can read or update the non-secret settings. SMTP passwords are encrypted with
`BUSINESS_SECRETS_KEY` and are never included in API responses. Business
administrators cannot configure or invoke SMTP management.

The super-admin password-recovery email uses the deployment-level `SMTP_*`
variables (or Resend fallback). This platform email channel is separate from the
tenant login flow and from per-tenant SMTP records.

## Data isolation status

The Platform Console is the tenant **control plane**. Business ownership still
needs to be added to operational records such as clients, products, orders,
bills, workers, and reports before multiple businesses should enter real data in
the same production database.

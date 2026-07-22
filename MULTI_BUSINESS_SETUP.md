# Multi-business account foundation

The application now has two account levels:

- `super_admin`: the platform owner. This account is not attached to a laundry
  business and can create, list, activate, and suspend business accounts.
- Business users: administrators and staff attached to one laundry business by
  `business_id`.

## Platform owner login

Configure these values in the deployment environment:

```text
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_PASSWORD=use-a-strong-unique-password
SUPER_ADMIN_NAME=Platform Owner
SUPER_ADMIN_EMAIL=owner@example.com
SESSION_SECRET=use-a-long-random-signing-secret
BUSINESS_SECRETS_KEY=use-a-different-long-random-encryption-key
```

For local development only, the fallback login is `superadmin` / `admin123`.
Never use that fallback password on a public deployment.

## Initial migration

On application startup, the migration:

1. Creates `laundry_businesses`.
2. Adds `business_id` to `users`.
3. Creates a default business for existing users.
4. Creates or updates the platform-owner account from environment variables.

The migration is idempotent and can run safely on each serverless cold start.

## Business creation

Sign in as the platform owner and open **Businesses & Accounts**. Creating a
business also creates its first administrator account in the same database
transaction. User passwords and PINs are not returned by the super-admin API.

## SMTP readiness

Each business record has its own SMTP configuration fields. Only the super admin
can read or update the non-secret settings. SMTP passwords are encrypted with
`BUSINESS_SECRETS_KEY` and are never included in API responses. Business
administrators cannot configure or invoke SMTP management.

## Data isolation status

This change establishes tenant-aware accounts first. Business ownership still
needs to be added to operational records such as clients, products, orders,
bills, workers, and reports before multiple businesses should enter real data in
the same production database.

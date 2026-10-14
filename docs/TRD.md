# Technical Requirements Document (TRD)
## Salon + Competitive-Exam Library Multi-Tenant SaaS

### 1. Architecture
`React/Vite SPA -> Express REST API -> Prisma -> PostgreSQL`

The API is organized by authentication, platform administration, common tenant operations, Salon operations and Library operations.

### 2. Authentication
- Login returns an 8-hour JWT.
- JWT payload: user id, role, tenant id, tenant type.
- `requireAuth` validates bearer token.
- `roles()` enforces server-side role authorization.
- Passwords use bcrypt with cost 12.
- Reset tokens are stored hashed in a production hardening phase; the MVP stores a random token and logs it for local development.

### 3. Tenant isolation
Every tenant-owned table includes `tenantId`. Owner endpoints derive tenant ID from the authenticated JWT rather than trusting a client-supplied tenant ID. Queries use both record ID and tenant ID where record-level updates occur.

### 4. Database model
Core entities:
- Tenant
- User
- PasswordReset
- Plan
- TenantSubscription
- MaintenanceSetting
- Service
- BusinessHours
- Closure
- Booking
- Batch
- Membership
- AuditLog

Important constraints:
- Unique user email.
- Unique `(tenantId, dayOfWeek)` for weekly hours.
- Unique tenant subscription.
- Foreign keys with cascade/set-null behavior.
- Indexes for tenant/time and tenant/active queries.

### 5. API contract
Auth:
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/change-password`

SuperAdmin:
- `GET /api/admin/dashboard`
- `GET /api/admin/tenants`
- `POST /api/admin/tenants`
- `PATCH /api/admin/tenants/:id/status`
- `GET /api/admin/plans`
- `POST /api/admin/plans`
- `PATCH /api/admin/maintenance`

Tenant:
- `GET /api/tenant/dashboard`
- `GET/PATCH /api/tenant/profile`

Salon:
- `GET/POST/PATCH /api/salon/services`
- `GET/PUT /api/salon/hours`
- `POST /api/salon/emergency-close`
- `GET /api/salon/slots?date=YYYY-MM-DD`

Library:
- `GET/POST/PATCH /api/library/batches`
- `POST /api/library/memberships`
- `GET /api/library/today`

### 6. Salon slot algorithm - production target
1. Load selected day business hours.
2. If closed, return no slots.
3. Apply emergency closures.
4. Generate time intervals from each configured window.
5. For each service, discard intervals shorter than service duration.
6. Exclude overlaps with confirmed/pending bookings.
7. Return remaining slots.
8. At booking creation, repeat validation in a transaction to prevent race conditions.

### 7. Library seat algorithm
`availableSeats = capacity - count(active memberships in batch)`.
Admission must run inside a transaction/serializable strategy in production to prevent two simultaneous admissions exceeding capacity.

### 8. Maintenance mode
A global record has `tenantId = null`; a client-specific record has a tenant ID. Effective mode is resolved server-side before owner-facing routes are served. Production should add middleware to reject or read-only restricted operations while maintenance is active.

### 9. Frontend structure
- Login/Forgot pages.
- Shared authenticated shell.
- SuperAdmin pages: Dashboard, Clients, Plans, Maintenance.
- Salon pages: Dashboard, Services, Today & Hours, Bookings.
- Library pages: Dashboard, Batches & Seats, Admission.

### 10. Production hardening roadmap
- Refresh token rotation and device/session revocation.
- Email provider for password reset.
- Payment gateway and webhook verification.
- Public customer booking portal.
- SMS/WhatsApp/email notifications.
- Calendar integration.
- Revenue charts with date filters.
- Detailed audit log viewer.
- Redis for distributed rate limiting/cache if required.
- Automated unit/integration/e2e tests.
- CI/CD and PostgreSQL backup/restore procedure.
- CSP, secure headers, CSRF protection strategy, request validation, structured logging.

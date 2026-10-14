# Product Requirements Document (PRD)
## Salon + Competitive-Exam Library Multi-Tenant SaaS

### 1. Product vision
A single SaaS platform where SuperAdmin centrally manages two tenant types: Salons and Libraries used by students preparing for competitive examinations. Each tenant gets its own isolated Owner portal.

### 2. Goals
- Central tenant and subscription administration.
- Simple first-login/password lifecycle.
- Salon real-time operational availability and flexible pricing.
- Library batch/cabin/seat capacity management with flexible monthly admissions.
- Responsive web experience across desktop, laptop, tablet and mobile.
- PostgreSQL + Prisma data integrity and tenant isolation.

### 3. Roles
**SuperAdmin:** platform administration, tenants, plans, trials, maintenance, analytics.
**Salon Owner:** salon profile, services/rates, weekly hours, emergency closure, bookings.
**Library Owner:** batches, timings, capacity/seats, student admission/membership.
**Customer/Student (future public portal):** Salon booking or Library admission/seat selection.

### 4. SuperAdmin requirements
- Login, logout, forgot password, reset password, change password.
- Dashboard: tenant counts, active tenants, user counts, graphs/metrics, recent activity.
- Create Owner credentials for Salon or Library.
- Edit tenant, activate/inactivate, suspend, enable/disable.
- Subscription plans: monthly fixed price or commission percentage.
- Trial duration per tenant/plan.
- Maintenance mode: all tenants or selected client.
- Audit logging for sensitive actions.

### 5. Salon requirements
- Login/password lifecycle.
- Dashboard: services, bookings, activity, revenue metrics (production phase).
- Service pricing: base price + optional flexible minimum/negotiated price.
- Service duration.
- Weekly open/closed state.
- Morning/noon/evening time windows.
- Owner can save a different schedule by day.
- Emergency closure with start/end and customer-facing message.
- Slot availability must respect operating hours, closures, service duration and existing bookings.
- Booking portal integration is a future public module.

### 6. Library requirements
- Login/password lifecycle.
- Dashboard: active students, batches, occupancy and recent activity.
- Batches grouped by recurring day/time.
- Capacity per batch; available seats calculated automatically.
- Student selects desired batch/timing.
- Membership can be 1, 2 or more months.
- Fee stored with membership; future phase supports invoices/receipts/payment gateway.
- Today on/off behavior is represented through active batches and future tenant-level schedule control.

### 7. Non-functional requirements
- Tenant data must never cross tenant boundaries.
- Server-side authorization for every protected endpoint.
- Passwords hashed with bcrypt.
- Environment-based secrets.
- Rate limiting on API.
- Responsive accessible UI.
- PostgreSQL transactions for multi-record administrative operations.

### 8. MVP acceptance criteria
- Three seed accounts can log in.
- SuperAdmin can create and suspend a tenant.
- Owner sees only own tenant data.
- Salon Owner can create services and save hours.
- Library Owner can create batches and admit students until capacity is reached.
- Reset/change password endpoints work.
- App runs without Docker using local PostgreSQL.

### 9. Library module — implemented scope (v2)
- **Users**: student registration/login (email or card no.), profile, membership plans/subscription, library ID card.
- **Seats**: rooms/floors, seat map with available/reserved/occupied/maintenance, booking, check-in/out, automatic expiry of un-checked-in bookings (grace period configurable).
- **Study**: timer, breaks, session history, daily/weekly hours, goals.
- **Books**: catalogue with search/filter, issue/return, due-date reminders, per-day fines.
- **Notifications**: in-app (booking confirmed/upcoming/expired, session end, due/overdue/fine, announcements). E-mail/SMS/WhatsApp delivery is a future provider hook.
- **Admin dashboard & reports**: students, occupancy, active sessions, revenue, seat utilisation, daily report + CSV.
- **Payments**: plans, online payment (demo gateway), history, invoice/receipt, refund & cancellation rules.
### 10. Salon bookings (v2)
- Customers book via `/book`; requests appear as PENDING in the owner's Bookings page; owners confirm/complete/cancel and can add walk-ins.

# Salon + Competitive Library SaaS

Multi-tenant SaaS starter for a SuperAdmin who manages Salon Owners and Competitive-Exam Library Owners.

## Stack
- Frontend: React 19 + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Auth: JWT + bcrypt
- No Docker required

## Modules included
### SuperAdmin
- Login, forgot/reset/change password, dashboard, create Salon/Library clients + owner login
- Edit/suspend/activate clients (takes effect immediately, even for logged-in users), reset owner password
- Plans (monthly/commission) + assign to a client, trial days
- Maintenance mode for all clients or one client (enforced on every API call, with a custom message)

### Salon Owner
- Services, durations, base + flexible minimum price
- Weekly morning/noon/evening hours, emergency closure (optionally cancels clashing bookings)
- **Bookings inbox**: online requests and walk-ins in one place — filter by date/pending/upcoming, search, confirm / complete / cancel, add walk-in booking. Auto-refreshes every 20 s; dashboard shows pending approvals and today's bookings
- Public booking page for customers: `/book` (pick salon → service → free slot → request). Slots respect opening hours, closures, service length and existing bookings

### Library Owner
- Dashboard: students, occupancy, active sessions, revenue (month/total), seat utilisation, overdue books, unpaid fines
- Students (register, block, reset password, reissue ID card), membership plans, admission/renewal, cancellation + refunds
- Rooms/floors, seat map (available / reserved / occupied / maintenance), seat bookings, check-in/out (by button or card number), automatic booking expiry
- Books catalogue, issue/return, due dates, fines, waive/mark paid
- Announcements (pushed to every student as a notification), payments/refunds, reports (+CSV), library rules (fines, loan days, booking & refund rules)

### Public library page
- Every library gets a public landing page at `http://localhost:5173/<address>` (demo: `/demo-library`), built from your library.html design
- Owner edits address, hero/about text, facilities, numbers and success stories under **Public website**; enquiries and feedback from the page arrive under **Enquiries** (feedback is shown publicly only after the owner approves it)
- Existing libraries get an address the first time the owner opens **Public website**

### Student portal (`/student/login`, `/student/register`)
- Registration/login, profile, ID card (printable), membership purchase with online payment (demo gateway), invoices/receipts, cancellation with refund preview
- Seat map + booking for a chosen time, check-in/out, cancel
- Study timer with breaks, session history, daily/weekly hours, goals
- Book search/filter, my issued books, fine payment
- Notifications: booking confirmed / upcoming / expired, seat time over, membership expired, due soon / overdue / fine, announcements

## What's new in this version
- **Library menu/navigation no longer overlaps** — long menus scroll inside the sidebar (desktop) or sideways (mobile).
- **Theme menu (libraries)** — SuperAdmin → *Clients* has a *Theme menu* switch per library (and ON/OFF for all). While it is ON, the library owner sees **Theme** in the menu and can pick a fixed colour theme, or let it change **every month, every season or every year**. Turn it OFF and the menu disappears and the default look returns (within ~2 minutes, or on the next page focus).
- **Salon home page + booking** — every salon now has a public page at `/<salon-address>` (built from Saloon.html). It shows only that salon's own name, address, phone, opening hours and services, and its booking form uses the real availability (free slots) and the normal booking inbox. Owners see the link on their dashboard. Libraries keep their own page at the same kind of address.
- **Cleaner logins** — the owner/admin login page no longer links to student login or salon booking. Student login/registration opens for one library (from that library's page) instead of listing every library.
- **First-login refresh bug fixed** — the app used to read the login state only once at start-up, so a fresh login showed an empty/redirecting page until refresh.
- **Booking ID + tracking** — every salon booking gets an ID like `SB-7K3M9Q`, every library seat booking `LB-4H8N2P`. Customers/students track at `/track` with the ID + mobile number (or library card number). Owners see the ID in their booking lists and can search by it.
- **Push notifications (opt-in)** — salon customers (booking confirmed/cancelled), salon owners (new request) and library students (all their notifications) can allow browser notifications. Needs the VAPID keys below; works on `localhost` or HTTPS.

## Upgrading an existing database
```bash
npm install                                   # adds web-push
npm run db:generate
npm run db:migrate -- --name theme_tracking_push
# add VAPID_* keys to .env (see .env.example) if you want push, then
npm run dev
```
On start the API gives existing salons/libraries a public address and existing bookings a Booking ID automatically.

## Local setup
1. Install Node.js 20.19+ and PostgreSQL 15+. (Vite 7 requires Node.js 20.19+.)
2. Create database `salon_library_saas`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
4. Run:

```bash
npm install
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

Frontend: http://localhost:5173
API: http://localhost:4000

If you are upgrading from the previous version, the schema changed a lot. In development run `npx prisma migrate reset` (drops data) instead of `migrate dev`.

Seed users (development only; the seed is safe to run repeatedly):
- SuperAdmin: admin@example.com / Admin@12345
- Salon Owner: salon@example.com / Admin@12345
- Library Owner: library@example.com / Admin@12345
- Student: student@example.com / Admin@12345 (choose "Demo Competitive Library" on `/student/login`)
- Public salon booking page: http://localhost:5173/book

Change these passwords immediately outside local development.

## Production notes
A background job runs every minute (booking expiry, reminders, fines). It runs inside the API process; run a single API instance or move it to a scheduler.
Before production, add email delivery for reset links, refresh-token rotation, audit/event retention policy, stronger rate limits on auth, CSRF strategy if cookies are used, object storage for documents, payment gateway, notification provider, observability, backups, and automated tests.


## If the page does not open
- Run `npm run dev` from the project root, not from `apps/web`.
- Frontend must show `http://localhost:5173/`; API must show `http://localhost:4000`.
- Open `http://localhost:4000/health` first. It should return `{\"ok\":true,...}`.
- If login opens but dashboard stays unavailable, verify PostgreSQL is running and run `npm run db:generate`, `npm run db:migrate -- --name init`, and `npm run db:seed`.
- If `5173` is already occupied, stop the other Vite process because this project uses `strictPort: true`.
- Direct URLs such as `/tenants` and `/services` are handled by the React router in the development server.

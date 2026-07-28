# FreshShift

Shift planning for Yes Fresh and Fresh Fries. Employees submit their weekly availability and the admin prepares and releases the plan for both stores.

## Features

- **Employee Self-Service**: Employees can submit their weekly availability (Mon-Sat) with specific time slots
- **Manual Schedule Planning**: Admins can prepare and release weekly schedules
- **Release Safeguards**: Invalid times, absences, and unanswered shift requests are checked before release. Employees may be assigned to both stores at the same time when they are scheduled to help across locations.
- **Admin Dashboard**: Review submitted availability, absences, requests, and schedules
- **Personal Schedule View**: Each employee can view their assigned shifts after release
- **Employee Lifecycle**: Archive former employees without losing historic schedules or monthly totals
- **Automatic Refresh**: Visible dashboards refresh safely when returning to the app and during longer sessions
- **Plan Change Requests**: Employees can request a different time for an already released shift; admins approve or reject the request
- **Shift Coverage Workflows**: Open shifts and swap requests replace ad-hoc replacement coordination
- **Private Calendar Subscription**: Employees can subscribe to their own released shifts with a revocable, token-protected calendar link
- **Web Push Notifications**: Opted-in devices receive planning updates without SMS
- **Passwordless Login**: Invited employees and admins authenticate with an eight-digit email code
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

1. Start a static web server, for example `python3 -m http.server 3000`
2. Open `http://localhost:3000`
3. Enter the email address of an invited FreshShift account
4. Enter the eight-digit code from the email and use the role-specific employee or admin view

## Project Structure

```
freshshift/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # All styles (responsive)
├── js/
│   ├── data.js         # Data selectors and date utilities
│   ├── cloud-data.js   # RLS-backed Supabase data adapter
│   ├── supabase.js     # Passwordless email-code Auth client
│   └── app.js          # Main application logic
├── supabase/
│   ├── functions/      # Authenticated server-side functions
│   └── migrations/     # Versioned production database schema and seed data
├── tests/              # Dependency-free Node smoke tests
└── README.md
```

## Data Storage

Operational data is stored in Supabase. After authentication, the browser loads only the rows permitted by Row Level Security into an in-memory cache. LocalStorage is used only for harmless UI preferences such as the last selected store.

Employee invitations run through the authenticated `invite-employee` Edge Function. Production employee records are restored separately and are deliberately excluded from Git history. Never expose a service-role key in browser code.

Before deploying a new domain, add its URL to the Supabase Auth Site URL and Redirect URLs. Uninvited email addresses cannot create accounts from the login screen or by calling Supabase Auth directly. Employee actions and their admin notifications are committed together so a temporary browser disconnect cannot leave the UI and database out of sync.

## Business Rules

- **Part-time workers (Aushilfe)**: Max 18 hours per week
- **Breaks**: Reminder for shifts longer than 6 hours

## Production Checklist

- Invite each active employee from the employee management page
- Confirm each employee can use their email code and see only their own data
- Prepare a pilot week, resolve every shift request, and release the plan
- Review the month overview after the first completed week

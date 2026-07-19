# FreshShift

Shift planning for Yes Fresh and Fresh Fries. Employees submit their weekly availability and the admin prepares and releases the plan for both stores.

## Features

- **Employee Self-Service**: Employees can submit their weekly availability (Mon-Sat) with specific time slots
- **Manual Schedule Planning**: Admins can prepare and release weekly schedules
- **Admin Dashboard**: Review submitted availability, absences, requests, and schedules
- **Personal Schedule View**: Each employee can view their assigned shifts after release
- **Passwordless Login**: Invited employees and admins authenticate with Supabase Magic Links
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

1. Start a static web server, for example `python3 -m http.server 3000`
2. Open `http://localhost:3000`
3. Enter the email address of an invited FreshShift account
4. Open the Magic Link and use the role-specific employee or admin view

## Project Structure

```
freshshift/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # All styles (responsive)
├── js/
│   ├── data.js         # Data selectors and date utilities
│   ├── cloud-data.js   # RLS-backed Supabase data adapter
│   ├── supabase.js     # Passwordless Auth client
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

Before deploying a new domain, add its URL to the Supabase Auth Site URL and Redirect URLs. Uninvited email addresses cannot create accounts from the login screen.

## Business Rules

- **Part-time workers (Aushilfe)**: Max 18 hours per week
- **Yes Fresh**: Minimum 3 employees per day
- **Fresh Fries**: Minimum 2 employees per day
- **Breaks**: Reminder for shifts longer than 6 hours

## Next Milestone

- Bootstrap the first admin and invite employee accounts
- Add scheduling-rule validation and broader browser integration tests
- Harden remaining dynamic HTML rendering before production rollout

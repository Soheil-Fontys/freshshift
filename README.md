# FreshShift

Shift planning for Yes Fresh and Fresh Fries. Employees submit their weekly availability and the admin prepares and releases the plan for both stores.

## Features

- **Employee Self-Service**: Employees can submit their weekly availability (Mon-Sat) with specific time slots
- **Manual Schedule Planning**: Admins can prepare and release weekly schedules
- **Admin Dashboard**: Review submitted availability, absences, requests, and schedules
- **Personal Schedule View**: Each employee can view their assigned shifts after release
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

1. Start a static web server, for example `python3 -m http.server 3000`
2. Open `http://localhost:3000`
3. Select an existing employee and enter availability for the week
4. Admins can access the management view via "Admin-Bereich"

## Project Structure

```
freshshift/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # All styles (responsive)
├── js/
│   ├── data.js         # Data management (LocalStorage)
│   ├── supabase.js     # Supabase Auth client
│   └── app.js          # Main application logic
├── supabase/
│   ├── functions/      # Authenticated server-side functions
│   └── migrations/     # Versioned production database schema and seed data
└── README.md
```

## Data Storage

The current UI still stores planning changes in the browser's LocalStorage while the Supabase data adapter is being integrated:

- `freshshift_employees` - Employee list
- `freshshift_availabilities` - Weekly availability submissions
- `freshshift_schedules` - Generated and released schedules

The production Supabase foundation contains the recovered stores, employees, and store assignments. Its public tables use Row Level Security, and employee invitations run through the authenticated `invite-employee` Edge Function. Never expose a service-role key in browser code.

## Business Rules

- **Part-time workers (Aushilfe)**: Max 18 hours per week
- **Yes Fresh**: Minimum 3 employees per day
- **Fresh Fries**: Minimum 2 employees per day
- **Breaks**: Reminder for shifts longer than 6 hours

## Next Milestone

- Replace LocalStorage reads and writes with the Supabase data adapter
- Require Supabase Auth for employee and admin access
- Add scheduling-rule validation and automated tests

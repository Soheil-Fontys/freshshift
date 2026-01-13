# FreshShift

Smart and simple shift planning tool for Yes Fresh and Fresh Fries. Allows employees to submit their weekly availability online and automatically generates a weekly plan for two stores.

## Features

- **Employee Self-Service**: Employees can submit their weekly availability (Mon-Sat) with specific time slots
- **Automatic Schedule Generation**: Creates optimized schedules based on:
  - Maximum 18 hours/week for part-time workers (Aushilfe)
  - Minimum staffing requirements (Yes Fresh: 3, Fresh Fries: 2)
  - Break reminders for shifts over 6 hours
- **Admin Dashboard**: Parents can review all submitted availabilities, generate and release schedules
- **Personal Schedule View**: Each employee can view their assigned shifts after release
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

1. Open `index.html` in a web browser
2. Select an existing employee or create a new one
3. Enter your availability for the week
4. Admin can access the management view via "Admin-Bereich"

## Project Structure

```
freshshift/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # All styles (responsive)
├── js/
│   ├── data.js         # Data management (LocalStorage)
│   ├── scheduler.js    # Automatic schedule generation logic
│   └── app.js          # Main application logic
└── README.md
```

## Data Storage

All data is stored in the browser's LocalStorage:
- `freshshift_employees` - Employee list
- `freshshift_availabilities` - Weekly availability submissions
- `freshshift_schedules` - Generated and released schedules

## Business Rules

- **Part-time workers (Aushilfe)**: Max 18 hours per week
- **Yes Fresh**: Minimum 3 employees per day
- **Fresh Fries**: Minimum 2 employees per day
- **Breaks**: Reminder for shifts longer than 6 hours

## Future Enhancements

- Firebase/Google Sheets backend for multi-device sync
- Email/SMS notifications
- Export to PDF
- Drag-and-drop schedule editing

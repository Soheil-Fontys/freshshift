/**
 * FreshShift - Data Management Module
 */

const DataManager = {
    KEYS: {
        EMPLOYEES: 'freshshift_employees',
        AVAILABILITIES: 'freshshift_availabilities',
        SCHEDULES: 'freshshift_schedules',
        CURRENT_USER: 'freshshift_current_user',
        NOTIFICATIONS: 'freshshift_notifications'
    },

    // Initialize with Fresh Fries team
    init() {
        if (!this.getEmployees().length) {
            const defaultEmployees = [
                { id: '1', name: 'Zhulia', store: 'fresh_fries', type: 'festangestellt' },
                { id: '2', name: 'Maria', store: 'fresh_fries', type: 'festangestellt' },
                { id: '3', name: 'Vito', store: 'fresh_fries', type: 'aushilfe' },
                { id: '4', name: 'Marzena', store: 'fresh_fries', type: 'festangestellt' },
                { id: '5', name: 'Soheil', store: 'fresh_fries', type: 'aushilfe' }
            ];
            localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(defaultEmployees));
        }
    },

    // Employee Management
    getEmployees() {
        const data = localStorage.getItem(this.KEYS.EMPLOYEES);
        return data ? JSON.parse(data) : [];
    },

    getEmployee(id) {
        return this.getEmployees().find(e => e.id === id);
    },

    getEmployeeByName(name) {
        return this.getEmployees().find(e => e.name.toLowerCase() === name.toLowerCase());
    },

    addEmployee(employee) {
        const employees = this.getEmployees();
        employee.id = Date.now().toString();
        employees.push(employee);
        localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(employees));
        return employee;
    },

    deleteEmployee(id) {
        const employees = this.getEmployees().filter(e => e.id !== id);
        localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(employees));
    },

    // Availability Management
    getAvailabilities() {
        const data = localStorage.getItem(this.KEYS.AVAILABILITIES);
        return data ? JSON.parse(data) : [];
    },

    getAvailabilityForWeek(weekKey) {
        return this.getAvailabilities().filter(a => a.weekKey === weekKey);
    },

    getEmployeeAvailability(employeeId, weekKey) {
        return this.getAvailabilities().find(
            a => a.employeeId === employeeId && a.weekKey === weekKey
        );
    },

    saveAvailability(availability) {
        const availabilities = this.getAvailabilities();
        const existingIndex = availabilities.findIndex(
            a => a.employeeId === availability.employeeId && a.weekKey === availability.weekKey
        );

        if (existingIndex !== -1) {
            availabilities[existingIndex] = availability;
        } else {
            availability.id = Date.now().toString();
            availabilities.push(availability);
        }

        localStorage.setItem(this.KEYS.AVAILABILITIES, JSON.stringify(availabilities));
        return availability;
    },

    // Schedule Management
    getSchedules() {
        const data = localStorage.getItem(this.KEYS.SCHEDULES);
        return data ? JSON.parse(data) : [];
    },

    getScheduleForWeek(weekKey) {
        return this.getSchedules().find(s => s.weekKey === weekKey);
    },

    saveSchedule(schedule) {
        const schedules = this.getSchedules();
        const existingIndex = schedules.findIndex(s => s.weekKey === schedule.weekKey);

        if (existingIndex !== -1) {
            schedules[existingIndex] = schedule;
        } else {
            schedule.id = Date.now().toString();
            schedules.push(schedule);
        }

        localStorage.setItem(this.KEYS.SCHEDULES, JSON.stringify(schedules));
        return schedule;
    },

    releaseSchedule(weekKey) {
        const schedules = this.getSchedules();
        const schedule = schedules.find(s => s.weekKey === weekKey);
        if (schedule) {
            schedule.released = true;
            schedule.releasedAt = new Date().toISOString();
            localStorage.setItem(this.KEYS.SCHEDULES, JSON.stringify(schedules));
            return schedule;
        }
        return null;
    },

    // Get schedules for a month
    getSchedulesForMonth(year, month) {
        return this.getSchedules().filter(s => {
            if (!s.weekKey) return false;
            const [y, w] = s.weekKey.split('-W');
            const weekDate = this.getDateFromWeek(parseInt(y), parseInt(w));
            return weekDate.getFullYear() === year && weekDate.getMonth() === month;
        });
    },

    getDateFromWeek(year, week) {
        const jan1 = new Date(year, 0, 1);
        const days = (week - 1) * 7;
        jan1.setDate(jan1.getDate() + days);
        return jan1;
    },

    // Notifications (for late arrivals etc.)
    getNotifications() {
        const data = localStorage.getItem(this.KEYS.NOTIFICATIONS);
        return data ? JSON.parse(data) : [];
    },

    addNotification(notification) {
        const notifications = this.getNotifications();
        notification.id = Date.now().toString();
        notification.timestamp = new Date().toISOString();
        notification.read = false;
        notifications.unshift(notification); // Add to beginning
        localStorage.setItem(this.KEYS.NOTIFICATIONS, JSON.stringify(notifications));
        return notification;
    },

    getUnreadNotifications() {
        return this.getNotifications().filter(n => !n.read);
    },

    markNotificationsRead() {
        const notifications = this.getNotifications();
        notifications.forEach(n => n.read = true);
        localStorage.setItem(this.KEYS.NOTIFICATIONS, JSON.stringify(notifications));
    },

    markAllNotificationsRead() {
        this.markNotificationsRead();
    },

    clearNotifications() {
        localStorage.setItem(this.KEYS.NOTIFICATIONS, JSON.stringify([]));
    },

    // Month Statistics
    getMonthStats(date) {
        const year = date.getFullYear();
        const month = date.getMonth();
        const employees = this.getEmployees();
        const schedules = this.getSchedules();
        
        const stats = {};
        
        // Initialize stats for each employee
        employees.forEach(emp => {
            stats[emp.id] = {
                plannedHours: 0,
                actualHours: 0,
                lateCount: 0,
                earlyCount: 0
            };
        });
        
        // Go through all schedules
        schedules.forEach(schedule => {
            if (!schedule.weekKey) return;
            
            // Check if this schedule's week is in the target month
            const [y, w] = schedule.weekKey.split('-W');
            const weekDate = this.getDateFromWeek(parseInt(y), parseInt(w));
            
            // Check each day of the week
            const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            
            dayKeys.forEach((dayKey, dayIndex) => {
                const checkDate = new Date(weekDate);
                checkDate.setDate(checkDate.getDate() + dayIndex);
                
                // Only count if this day is in the target month
                if (checkDate.getFullYear() === year && checkDate.getMonth() === month) {
                    const dayShifts = schedule.shifts?.[dayKey] || [];
                    
                    dayShifts.forEach(shift => {
                        if (!stats[shift.employeeId]) return;
                        
                        // Planned hours
                        const plannedHours = DateUtils.calculateDuration(shift.start, shift.end);
                        stats[shift.employeeId].plannedHours += plannedHours;
                        
                        // Actual hours (if deviation exists)
                        if (shift.actualStart || shift.actualEnd) {
                            const actualStart = shift.actualStart || shift.start;
                            const actualEnd = shift.actualEnd || shift.end;
                            const actualHours = DateUtils.calculateDuration(actualStart, actualEnd);
                            stats[shift.employeeId].actualHours += actualHours;
                        } else {
                            stats[shift.employeeId].actualHours += plannedHours;
                        }
                        
                        // Count deviations
                        if (shift.deviation) {
                            if (shift.deviation.lateMinutes) {
                                stats[shift.employeeId].lateCount++;
                            }
                            if (shift.deviation.earlyMinutes) {
                                stats[shift.employeeId].earlyCount++;
                            }
                        }
                    });
                }
            });
        });
        
        return stats;
    },

    // Current User Session
    setCurrentUser(employee) {
        localStorage.setItem(this.KEYS.CURRENT_USER, JSON.stringify(employee));
    },

    getCurrentUser() {
        const data = localStorage.getItem(this.KEYS.CURRENT_USER);
        return data ? JSON.parse(data) : null;
    },

    clearCurrentUser() {
        localStorage.removeItem(this.KEYS.CURRENT_USER);
    },

    // Clear all data
    clearAll() {
        Object.values(this.KEYS).forEach(key => localStorage.removeItem(key));
    }
};

// Date utilities
const DateUtils = {
    DAYS: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
    DAYS_SHORT: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    DAY_KEYS: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    MONTHS: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],

    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    },

    getWeekKey(date) {
        const week = this.getWeekNumber(date);
        const year = date.getFullYear();
        return `${year}-W${week.toString().padStart(2, '0')}`;
    },

    getWeekDates(date) {
        const current = new Date(date);
        const day = current.getDay();
        const diff = current.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(current.setDate(diff));
        
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            dates.push(d);
        }
        return dates;
    },

    formatDate(date) {
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    },

    formatWeekDisplay(date) {
        const week = this.getWeekNumber(date);
        const dates = this.getWeekDates(date);
        const start = this.formatDate(dates[0]);
        const end = this.formatDate(dates[6]);
        return `KW ${week} | ${start} – ${end}`;
    },

    formatMonthDisplay(date) {
        return `${this.MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    },

    parseTimeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    },

    calculateDuration(start, end) {
        const startMinutes = this.parseTimeToMinutes(start);
        const endMinutes = this.parseTimeToMinutes(end);
        return (endMinutes - startMinutes) / 60;
    },

    formatDuration(hours) {
        if (hours === 0) return '0h';
        const h = Math.floor(Math.abs(hours));
        const m = Math.round((Math.abs(hours) - h) * 60);
        const sign = hours < 0 ? '-' : '';
        if (m === 0) return `${sign}${h}h`;
        return `${sign}${h}h ${m}min`;
    },

    formatTime(date) {
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    },

    getTodayKey() {
        const today = new Date();
        const dayIndex = (today.getDay() + 6) % 7; // Convert to Monday = 0
        return this.DAY_KEYS[dayIndex];
    }
};

// Initialize
DataManager.init();

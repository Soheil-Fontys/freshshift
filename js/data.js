/**
 * FreshShift - Data Management Module
 */

const DataManager = {
    STORES: {
        fresh_fries: { id: 'fresh_fries', name: 'Fresh Fries' },
        yes_fresh: { id: 'yes_fresh', name: 'Yes Fresh' }
    },

    KEYS: {
        EMPLOYEES: 'freshshift_employees',
        AVAILABILITIES: 'freshshift_availabilities',
        SCHEDULES: 'freshshift_schedules',
        CURRENT_USER: 'freshshift_current_user',
        NOTIFICATIONS: 'freshshift_notifications',
        IS_ADMIN: 'freshshift_is_admin',
        ABSENCES: 'freshshift_absences'
    },

    getStoreName(storeId) {
        return this.STORES?.[storeId]?.name || storeId;
    },

    normalizeStoreId(storeId) {
        return storeId || 'fresh_fries';
    },

    // Initialize / migrate data
    init() {
        this.migrateEmployees();
        this.seedDefaultEmployees();
        this.migrateAvailabilities();
        this.migrateSchedules();
    },

    seedDefaultEmployees() {
        const existing = this.getEmployees();
        const byName = new Map(existing.map(e => [String(e.name || '').toLowerCase(), e]));

        const defaults = [
            // Fresh Fries
            { name: 'Zhulia', type: 'festangestellt', primaryStore: 'fresh_fries', stores: ['fresh_fries', 'yes_fresh'] },
            { name: 'Maria', type: 'festangestellt', primaryStore: 'fresh_fries', stores: ['fresh_fries'] },
            { name: 'Marzena', type: 'festangestellt', primaryStore: 'fresh_fries', stores: ['fresh_fries'] },
            { name: 'Vito', type: 'aushilfe', primaryStore: 'fresh_fries', stores: ['fresh_fries', 'yes_fresh'] },
            { name: 'Soheil', type: 'aushilfe', primaryStore: 'fresh_fries', stores: ['fresh_fries'] },

            // Yes Fresh
            { name: 'Leo', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Anna', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Kathi', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Albo', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Ouijdane', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Khanom', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Rayna', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] },
            { name: 'Phyllis', type: 'festangestellt', primaryStore: 'yes_fresh', stores: ['yes_fresh'] }
        ];

        let changed = false;
        defaults.forEach(d => {
            const existingEmp = byName.get(d.name.toLowerCase());
            if (!existingEmp) {
                existing.push({
                    id: Date.now().toString() + Math.random().toString(16).slice(2),
                    name: d.name,
                    type: d.type,
                    primaryStore: d.primaryStore,
                    stores: d.stores
                });
                changed = true;
            } else {
                // Ensure store metadata exists
                if (!existingEmp.stores || !Array.isArray(existingEmp.stores) || existingEmp.stores.length === 0) {
                    existingEmp.stores = [existingEmp.primaryStore || existingEmp.store || 'fresh_fries'];
                    changed = true;
                }
                if (!existingEmp.primaryStore) {
                    existingEmp.primaryStore = existingEmp.store || existingEmp.stores[0] || 'fresh_fries';
                    changed = true;
                }
            }
        });

        if (changed) {
            localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(existing));
        }
    },

    migrateEmployees() {
        const employees = this.getEmployees();
        if (!employees.length) return;

        let changed = false;
        employees.forEach(emp => {
            if (!emp) return;

            // legacy: store: 'fresh_fries'
            if (!emp.stores) {
                const legacyStore = emp.store || emp.primaryStore || 'fresh_fries';
                emp.stores = [legacyStore];
                changed = true;
            }

            if (typeof emp.stores === 'string') {
                emp.stores = [emp.stores];
                changed = true;
            }

            if (!Array.isArray(emp.stores) || emp.stores.length === 0) {
                emp.stores = [emp.store || 'fresh_fries'];
                changed = true;
            }

            if (!emp.primaryStore) {
                emp.primaryStore = emp.store || emp.stores[0] || 'fresh_fries';
                changed = true;
            }

            // keep legacy store field but avoid relying on it
        });

        if (changed) {
            localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(employees));
        }
    },

    migrateAvailabilities() {
        const availabilities = this.getAvailabilities();
        if (!availabilities.length) return;

        let changed = false;
        availabilities.forEach(a => {
            if (!a) return;
            if (!a.storeId) {
                a.storeId = 'fresh_fries';
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem(this.KEYS.AVAILABILITIES, JSON.stringify(availabilities));
        }
    },

    migrateSchedules() {
        const schedules = this.getSchedules();
        if (!schedules.length) return;

        let changed = false;
        schedules.forEach(s => {
            if (!s) return;
            if (!s.storeId) {
                s.storeId = 'fresh_fries';
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem(this.KEYS.SCHEDULES, JSON.stringify(schedules));
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

        const storeId = this.normalizeStoreId(employee.primaryStore || employee.store || (employee.stores?.[0]));
        if (!employee.primaryStore) employee.primaryStore = storeId;
        if (!employee.stores) employee.stores = [storeId];
        if (typeof employee.stores === 'string') employee.stores = [employee.stores];

        employees.push(employee);
        localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(employees));
        return employee;
    },

    updateEmployee(employee) {
        const employees = this.getEmployees();
        const idx = employees.findIndex(e => e.id === employee.id);
        if (idx === -1) return;

        const storeId = this.normalizeStoreId(employee.primaryStore || employee.store || (employee.stores?.[0]));
        employee.primaryStore = storeId;
        employee.stores = Array.isArray(employee.stores) ? employee.stores : [storeId];
        employee.stores = employee.stores.map(s => this.normalizeStoreId(s));
        if (!employee.stores.includes(employee.primaryStore)) {
            employee.stores.unshift(employee.primaryStore);
        }

        employees[idx] = { ...employees[idx], ...employee };
        localStorage.setItem(this.KEYS.EMPLOYEES, JSON.stringify(employees));
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

    getAvailabilityForWeek(weekKey, storeId) {
        const store = this.normalizeStoreId(storeId);
        return this.getAvailabilities().filter(a => a.weekKey === weekKey && this.normalizeStoreId(a.storeId) === store);
    },

    getEmployeeAvailability(employeeId, weekKey, storeId) {
        const store = this.normalizeStoreId(storeId);
        return this.getAvailabilities().find(
            a => a.employeeId === employeeId && a.weekKey === weekKey && this.normalizeStoreId(a.storeId) === store
        );
    },

    saveAvailability(availability) {
        const availabilities = this.getAvailabilities();
        availability.storeId = this.normalizeStoreId(availability.storeId);

        const existingIndex = availabilities.findIndex(
            a => a.employeeId === availability.employeeId && a.weekKey === availability.weekKey && this.normalizeStoreId(a.storeId) === availability.storeId
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

    getScheduleForWeek(weekKey, storeId) {
        const store = this.normalizeStoreId(storeId);
        return this.getSchedules().find(s => s.weekKey === weekKey && this.normalizeStoreId(s.storeId) === store);
    },

    saveSchedule(schedule) {
        const schedules = this.getSchedules();
        schedule.storeId = this.normalizeStoreId(schedule.storeId);

        const existingIndex = schedules.findIndex(s => s.weekKey === schedule.weekKey && this.normalizeStoreId(s.storeId) === schedule.storeId);


        if (existingIndex !== -1) {
            schedules[existingIndex] = schedule;
        } else {
            schedule.id = Date.now().toString();
            schedules.push(schedule);
        }

        localStorage.setItem(this.KEYS.SCHEDULES, JSON.stringify(schedules));
        return schedule;
    },

    releaseSchedule(weekKey, storeId) {
        const store = this.normalizeStoreId(storeId);
        const schedules = this.getSchedules();
        const schedule = schedules.find(s => s.weekKey === weekKey && this.normalizeStoreId(s.storeId) === store);

        if (schedule) {
            schedule.released = true;
            schedule.releasedAt = new Date().toISOString();
            localStorage.setItem(this.KEYS.SCHEDULES, JSON.stringify(schedules));
            return schedule;
        }
        return null;
    },

    // Get schedules for a month
    getSchedulesForMonth(year, month, storeId) {
        const store = this.normalizeStoreId(storeId);
        return this.getSchedules().filter(s => {
            if (!s.weekKey) return false;
            if (this.normalizeStoreId(s.storeId) !== store) return false;
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

    // ===========================
    // Absence Management (Urlaub/Krankheit)
    // ===========================
    getAbsences() {
        const data = localStorage.getItem(this.KEYS.ABSENCES);
        return data ? JSON.parse(data) : [];
    },

    getAbsence(id) {
        return this.getAbsences().find(a => a.id === id);
    },

    getAbsencesForEmployee(employeeId) {
        return this.getAbsences().filter(a => a.employeeId === employeeId);
    },

    getAbsencesForDate(date) {
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        return this.getAbsences().filter(a => {
            return dateStr >= a.startDate && dateStr <= a.endDate;
        });
    },

    getAbsencesForDateRange(startDate, endDate) {
        const start = startDate.toISOString().split('T')[0];
        const end = endDate.toISOString().split('T')[0];
        return this.getAbsences().filter(a => {
            // Check if absence overlaps with the range
            return a.startDate <= end && a.endDate >= start;
        });
    },

    isEmployeeAbsent(employeeId, date) {
        const dateStr = date.toISOString().split('T')[0];
        return this.getAbsences().some(a => 
            a.employeeId === employeeId && 
            dateStr >= a.startDate && 
            dateStr <= a.endDate
        );
    },

    getEmployeeAbsenceForDate(employeeId, date) {
        const dateStr = date.toISOString().split('T')[0];
        return this.getAbsences().find(a => 
            a.employeeId === employeeId && 
            dateStr >= a.startDate && 
            dateStr <= a.endDate
        );
    },

    addAbsence(absence) {
        const absences = this.getAbsences();
        absence.id = Date.now().toString();
        absence.createdAt = new Date().toISOString();
        absences.push(absence);
        localStorage.setItem(this.KEYS.ABSENCES, JSON.stringify(absences));
        return absence;
    },

    updateAbsence(absence) {
        const absences = this.getAbsences();
        const index = absences.findIndex(a => a.id === absence.id);
        if (index !== -1) {
            absences[index] = { ...absences[index], ...absence };
            localStorage.setItem(this.KEYS.ABSENCES, JSON.stringify(absences));
            return absences[index];
        }
        return null;
    },

    deleteAbsence(id) {
        const absences = this.getAbsences().filter(a => a.id !== id);
        localStorage.setItem(this.KEYS.ABSENCES, JSON.stringify(absences));
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
    getMonthStats(date, storeId) {
        const store = this.normalizeStoreId(storeId);
        const year = date.getFullYear();
        const month = date.getMonth();
        const employees = this.getEmployees();
        const schedules = this.getSchedules().filter(s => this.normalizeStoreId(s.storeId) === store);

        
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

                            // Ignore declined/pending requests
                            if (shift.requestStatus === 'declined' || shift.requestStatus === 'pending') return;
                            
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
        localStorage.removeItem(this.KEYS.IS_ADMIN);
    },

    getCurrentUser() {
        const data = localStorage.getItem(this.KEYS.CURRENT_USER);
        return data ? JSON.parse(data) : null;
    },

    clearCurrentUser() {
        localStorage.removeItem(this.KEYS.CURRENT_USER);
        localStorage.removeItem(this.KEYS.IS_ADMIN);
    },

    // Admin Session
    setAdminSession() {
        localStorage.setItem(this.KEYS.IS_ADMIN, 'true');
        localStorage.removeItem(this.KEYS.CURRENT_USER);
    },

    isAdminSession() {
        return localStorage.getItem(this.KEYS.IS_ADMIN) === 'true';
    },

    // ===========================
    // Backup / Restore
    // ===========================
    exportBackup() {
        const dataKeys = [
            this.KEYS.EMPLOYEES,
            this.KEYS.AVAILABILITIES,
            this.KEYS.SCHEDULES,
            this.KEYS.NOTIFICATIONS,
            this.KEYS.ABSENCES
        ];

        const data = {};
        dataKeys.forEach(key => {
            const raw = localStorage.getItem(key);
            data[key] = raw ? JSON.parse(raw) : [];
        });

        return {
            schemaVersion: 1,
            app: 'freshshift',
            exportedAt: new Date().toISOString(),
            data
        };
    },

    importBackup(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Ungültiges Backup-Format.');
        }
        if (payload.schemaVersion !== 1 || payload.app !== 'freshshift') {
            throw new Error('Backup-Version wird nicht unterstützt.');
        }
        if (!payload.data || typeof payload.data !== 'object') {
            throw new Error('Backup enthält keine Daten.');
        }

        const allowed = new Set([
            this.KEYS.EMPLOYEES,
            this.KEYS.AVAILABILITIES,
            this.KEYS.SCHEDULES,
            this.KEYS.NOTIFICATIONS,
            this.KEYS.ABSENCES
        ]);

        // Overwrite only app data, keep session keys intact
        Object.keys(payload.data).forEach(key => {
            if (!allowed.has(key)) return;
            localStorage.setItem(key, JSON.stringify(payload.data[key] ?? []));
        });

        // Ensure defaults exist if employees got wiped accidentally
        this.init();
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

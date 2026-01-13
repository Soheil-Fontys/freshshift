/**
 * FreshShift - Main Application
 * Manual scheduling with deviation tracking
 */

const App = {
    currentWeek: new Date(),
    currentMonth: new Date(),
    currentUser: null,
    currentEditCell: null,

    init() {
        this.bindEvents();
        this.loadEmployeeDropdown();
        this.updateWeekDisplay();
        this.updateMonthDisplay();
    },

    // ===========================
    // Event Bindings
    // ===========================
    bindEvents() {
        // Login Screen
        document.getElementById('login-btn').addEventListener('click', () => this.handleLogin());
        document.getElementById('admin-login-btn').addEventListener('click', () => {
            this.showScreen('admin-screen');
        });

        // Employee Section Tabs
        document.querySelectorAll('.section-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.handleSectionTab(e.target));
        });

        // Availability Screen
        document.getElementById('back-to-login').addEventListener('click', () => this.logout());
        document.getElementById('availability-form').addEventListener('submit', (e) => this.handleAvailabilitySubmit(e));
        document.getElementById('prev-week').addEventListener('click', () => this.changeWeek(-1));
        document.getElementById('next-week').addEventListener('click', () => this.changeWeek(1));
        document.getElementById('my-prev-week').addEventListener('click', () => this.changeWeek(-1, false, true));
        document.getElementById('my-next-week').addEventListener('click', () => this.changeWeek(1, false, true));

        // Report Late
        document.getElementById('report-late-btn').addEventListener('click', () => this.showModal('late-modal'));
        document.getElementById('submit-late').addEventListener('click', () => this.submitLateReport());

        // Admin Screen
        document.getElementById('admin-back-to-login').addEventListener('click', () => this.showScreen('login-screen'));
        document.getElementById('admin-prev-week').addEventListener('click', () => this.changeWeek(-1, true));
        document.getElementById('admin-next-week').addEventListener('click', () => this.changeWeek(1, true));
        document.getElementById('save-schedule').addEventListener('click', () => this.saveSchedule());
        document.getElementById('release-schedule').addEventListener('click', () => this.releaseSchedule());

        // Admin Tabs
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.addEventListener('click', (e) => this.handleAdminTab(e.target));
        });

        // Month Navigation
        document.getElementById('prev-month').addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('next-month').addEventListener('click', () => this.changeMonth(1));

        // Notifications
        document.getElementById('notification-badge').addEventListener('click', () => this.toggleNotifications());
        document.getElementById('clear-notifications').addEventListener('click', () => this.clearNotifications());

        // Employees
        document.getElementById('add-employee-btn').addEventListener('click', () => this.showModal('add-employee-modal'));
        document.getElementById('save-new-employee').addEventListener('click', () => this.saveNewEmployee());

        // Shift Modal
        document.getElementById('save-shift').addEventListener('click', () => this.saveShift());
        document.getElementById('remove-shift').addEventListener('click', () => this.removeShift());

        // Modal close buttons
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', () => this.hideModals());
        });
    },

    // ===========================
    // Screen Management
    // ===========================
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');

        if (screenId === 'availability-screen') {
            this.renderAvailabilityForm();
            this.renderMyScheduleSection();
        } else if (screenId === 'admin-screen') {
            this.renderAdminView();
            this.updateNotificationBadge();
        }
    },

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    },

    hideModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        this.currentEditCell = null;
    },

    // ===========================
    // Section Tabs (Employee)
    // ===========================
    handleSectionTab(tab) {
        const section = tab.dataset.section;
        
        // Update tab active state
        document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show corresponding section
        document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
        document.getElementById(`${section}-section`).classList.add('active');
        
        // Render content
        if (section === 'my-schedule') {
            this.renderMyScheduleSection();
        }
    },

    // ===========================
    // Admin Tabs
    // ===========================
    handleAdminTab(tab) {
        const tabName = tab.dataset.tab;
        
        // Update tab active state
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show corresponding content
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');
        
        // Render content
        if (tabName === 'month') {
            this.renderMonthOverview();
        } else if (tabName === 'employees') {
            this.renderEmployeesTab();
        } else if (tabName === 'planner') {
            this.renderAdminView();
        }
    },

    // ===========================
    // Login / User Management
    // ===========================
    loadEmployeeDropdown() {
        const select = document.getElementById('employee-select');
        const employees = DataManager.getEmployees();
        
        select.innerHTML = '<option value="">-- Bitte wählen --</option>';
        employees.forEach(emp => {
            select.innerHTML += `<option value="${emp.id}">${emp.name}</option>`;
        });
    },

    handleLogin() {
        const selectValue = document.getElementById('employee-select').value;
        
        if (!selectValue) {
            this.showToast('Bitte wähle deinen Namen aus.', 'error');
            return;
        }

        const employee = DataManager.getEmployee(selectValue);
        if (!employee) {
            this.showToast('Mitarbeiter nicht gefunden.', 'error');
            return;
        }

        this.currentUser = employee;
        DataManager.setCurrentUser(employee);
        document.getElementById('current-user-name').textContent = employee.name;
        this.showScreen('availability-screen');
        this.showToast(`Hallo ${employee.name}!`, 'success');
    },

    logout() {
        this.currentUser = null;
        DataManager.clearCurrentUser();
        document.getElementById('employee-select').value = '';
        this.showScreen('login-screen');
    },

    // ===========================
    // Week Navigation
    // ===========================
    changeWeek(delta, isAdmin = false, isMySchedule = false) {
        this.currentWeek.setDate(this.currentWeek.getDate() + (delta * 7));
        this.updateWeekDisplay();
        
        if (isAdmin) {
            this.renderAdminView();
        } else if (isMySchedule) {
            this.renderMyScheduleSection();
        } else {
            this.renderAvailabilityForm();
        }
    },

    updateWeekDisplay() {
        const display = DateUtils.formatWeekDisplay(this.currentWeek);
        document.getElementById('week-display').textContent = display;
        document.getElementById('admin-week-display').textContent = display;
        document.getElementById('my-week-display').textContent = display;
    },

    // ===========================
    // Month Navigation
    // ===========================
    changeMonth(delta) {
        this.currentMonth.setMonth(this.currentMonth.getMonth() + delta);
        this.updateMonthDisplay();
        this.renderMonthOverview();
    },

    updateMonthDisplay() {
        const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        const display = `${months[this.currentMonth.getMonth()]} ${this.currentMonth.getFullYear()}`;
        document.getElementById('month-display').textContent = display;
    },

    // ===========================
    // Report Late (Employee)
    // ===========================
    submitLateReport() {
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const minutes = document.getElementById('late-minutes').value;
        const reason = document.getElementById('late-reason').value;

        const notification = {
            id: Date.now().toString(),
            type: 'late',
            employeeId: this.currentUser.id,
            employeeName: this.currentUser.name,
            message: `Kommt ${minutes} Minuten später`,
            reason: reason || null,
            timestamp: new Date().toISOString(),
            read: false
        };

        DataManager.addNotification(notification);
        
        this.hideModals();
        document.getElementById('late-reason').value = '';
        this.showToast('Meldung gesendet! Die Chefs werden benachrichtigt.', 'success');
    },

    // ===========================
    // Notifications (Admin)
    // ===========================
    updateNotificationBadge() {
        const notifications = DataManager.getUnreadNotifications();
        const badge = document.getElementById('notification-badge');
        const count = document.getElementById('notification-count');
        const panel = document.getElementById('notifications-panel');
        
        if (notifications.length > 0) {
            badge.style.display = 'block';
            count.textContent = notifications.length;
            panel.style.display = 'block';
            this.renderNotificationsList(notifications);
        } else {
            badge.style.display = 'none';
            panel.style.display = 'none';
        }
    },

    renderNotificationsList(notifications) {
        const list = document.getElementById('notifications-list');
        
        list.innerHTML = notifications.map(n => `
            <div class="notification-item">
                <span class="notification-icon">⏰</span>
                <div class="notification-content">
                    <div class="notification-title">${n.employeeName}: ${n.message}</div>
                    ${n.reason ? `<div class="notification-reason">Grund: ${n.reason}</div>` : ''}
                    <div class="notification-time">${this.formatTimestamp(n.timestamp)}</div>
                </div>
            </div>
        `).join('');
    },

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + 
               ' Uhr, ' + date.toLocaleDateString('de-DE');
    },

    toggleNotifications() {
        const panel = document.getElementById('notifications-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    },

    clearNotifications() {
        DataManager.markAllNotificationsRead();
        this.updateNotificationBadge();
        this.showToast('Alle Meldungen als gelesen markiert.', 'success');
    },

    // ===========================
    // Availability Form (Employee)
    // ===========================
    renderAvailabilityForm() {
        this.updateWeekDisplay();
        const container = document.querySelector('.days-container');
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        
        const existingAvail = this.currentUser ? 
            DataManager.getEmployeeAvailability(this.currentUser.id, weekKey) : null;

        container.innerHTML = '';

        DateUtils.DAYS.forEach((dayName, index) => {
            const dayKey = DateUtils.DAY_KEYS[index];
            const date = dates[index];
            const existing = existingAvail?.days?.[dayKey] || {};
            const isSunday = dayKey === 'sunday';
            
            const card = document.createElement('div');
            card.className = `day-card ${!existing.available ? 'unavailable' : ''} ${isSunday ? 'sunday' : ''}`;
            card.innerHTML = `
                <div class="day-header">
                    <h3>${dayName}</h3>
                    <span class="date">${DateUtils.formatDate(date)}</span>
                    ${isSunday ? '<span class="sunday-note">Normalerweise geschlossen</span>' : ''}
                    <label class="availability-toggle">
                        <input type="checkbox" 
                            name="${dayKey}_available" 
                            ${existing.available ? 'checked' : ''}
                            onchange="App.toggleDayAvailability('${dayKey}', this.checked)">
                        Kann arbeiten
                    </label>
                </div>
                <div class="time-inputs" id="${dayKey}-times" style="${!existing.available ? 'display:none' : ''}">
                    <div class="time-group">
                        <label>Von:</label>
                        <input type="time" name="${dayKey}_start" value="${existing.start || '10:00'}">
                    </div>
                    <div class="time-group">
                        <label>Bis:</label>
                        <input type="time" name="${dayKey}_end" value="${existing.end || '20:00'}">
                    </div>
                </div>
                <div class="day-notes" id="${dayKey}-notes" style="${!existing.available ? 'display:none' : ''}">
                    <input type="text" name="${dayKey}_notes" 
                        placeholder="Bemerkung (optional)" 
                        value="${existing.notes || ''}">
                </div>
            `;
            container.appendChild(card);
        });

        document.getElementById('general-notes').value = existingAvail?.notes || '';
    },

    toggleDayAvailability(dayKey, available) {
        const card = document.querySelector(`[name="${dayKey}_available"]`).closest('.day-card');
        const times = document.getElementById(`${dayKey}-times`);
        const notes = document.getElementById(`${dayKey}-notes`);
        
        card.classList.toggle('unavailable', !available);
        times.style.display = available ? 'flex' : 'none';
        notes.style.display = available ? 'block' : 'none';
    },

    handleAvailabilitySubmit(e) {
        e.preventDefault();
        
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const form = e.target;
        const days = {};

        DateUtils.DAY_KEYS.forEach(dayKey => {
            const available = form[`${dayKey}_available`]?.checked || false;
            days[dayKey] = {
                available: available,
                start: available ? form[`${dayKey}_start`]?.value : null,
                end: available ? form[`${dayKey}_end`]?.value : null,
                notes: available ? form[`${dayKey}_notes`]?.value : null
            };
        });

        const availability = {
            employeeId: this.currentUser.id,
            weekKey: weekKey,
            days: days,
            notes: document.getElementById('general-notes').value,
            submittedAt: new Date().toISOString()
        };

        DataManager.saveAvailability(availability);
        this.showToast('Verfügbarkeit gespeichert!', 'success');
    },

    // ===========================
    // My Schedule Section (Employee)
    // ===========================
    renderMyScheduleSection() {
        this.updateWeekDisplay();
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        
        const statusContainer = document.getElementById('schedule-status');
        const contentContainer = document.getElementById('my-schedule-content');
        const summaryContainer = document.getElementById('weekly-summary');

        if (!schedule) {
            statusContainer.className = 'schedule-status pending';
            statusContainer.innerHTML = `
                <h3>Kein Plan vorhanden</h3>
                <p>Für diese Woche wurde noch kein Schichtplan erstellt.</p>
            `;
            contentContainer.innerHTML = '';
            summaryContainer.innerHTML = '';
            return;
        }

        // Status
        if (schedule.released) {
            statusContainer.className = 'schedule-status released';
            statusContainer.innerHTML = `
                <h3>Plan freigegeben</h3>
                <p>Freigegeben am ${new Date(schedule.releasedAt).toLocaleDateString('de-DE')}</p>
            `;
        } else {
            statusContainer.className = 'schedule-status pending';
            statusContainer.innerHTML = `
                <h3>Vorläufiger Plan</h3>
                <p>Dieser Plan wurde noch nicht freigegeben.</p>
            `;
        }

        // Shifts
        contentContainer.innerHTML = '';
        let totalHours = 0;
        let shiftCount = 0;

        DateUtils.DAY_KEYS.forEach((dayKey, index) => {
            const daySchedule = schedule.shifts?.[dayKey] || [];
            const myShift = daySchedule.find(s => s.employeeId === this.currentUser?.id);
            
            const card = document.createElement('div');
            
            if (myShift) {
                const hours = DateUtils.calculateDuration(myShift.start, myShift.end);
                totalHours += hours;
                shiftCount++;
                
                // Check for deviations
                let deviationHtml = '';
                if (myShift.deviation) {
                    if (myShift.deviation.lateMinutes) {
                        deviationHtml = `<div class="shift-deviation late">${myShift.deviation.lateMinutes} Min. später gekommen</div>`;
                    }
                    if (myShift.deviation.earlyMinutes) {
                        deviationHtml = `<div class="shift-deviation early">${myShift.deviation.earlyMinutes} Min. früher gegangen</div>`;
                    }
                }
                
                card.className = 'my-shift-card';
                card.innerHTML = `
                    <div class="shift-day">
                        <span class="day-name">${DateUtils.DAYS_SHORT[index]}</span>
                        <span class="date">${DateUtils.formatDate(dates[index])}</span>
                    </div>
                    <div class="shift-details">
                        <div class="shift-time">${myShift.start} – ${myShift.end}</div>
                        <div class="shift-note">${DateUtils.formatDuration(hours)}</div>
                        ${deviationHtml}
                    </div>
                `;
            } else {
                card.className = 'my-shift-card no-shift';
                card.innerHTML = `
                    <div class="shift-day">
                        <span class="day-name">${DateUtils.DAYS_SHORT[index]}</span>
                        <span class="date">${DateUtils.formatDate(dates[index])}</span>
                    </div>
                    <div class="shift-details">
                        <div class="shift-time" style="color: var(--gray-400);">Frei</div>
                    </div>
                `;
            }
            contentContainer.appendChild(card);
        });

        // Summary
        summaryContainer.innerHTML = `
            <h4>Diese Woche</h4>
            <div class="summary-stats">
                <div class="stat-item">
                    <span class="stat-value">${shiftCount}</span>
                    <span class="stat-label">Schichten</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${DateUtils.formatDuration(totalHours)}</span>
                    <span class="stat-label">Stunden</span>
                </div>
            </div>
        `;
    },

    // ===========================
    // Admin View
    // ===========================
    renderAdminView() {
        this.updateWeekDisplay();
        this.renderAvailabilityOverview();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.updateReleaseButton();
        this.updateNotificationBadge();
    },

    renderAvailabilityOverview() {
        const table = document.getElementById('availability-table');
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const employees = DataManager.getEmployees();
        const availabilities = DataManager.getAvailabilityForWeek(weekKey);

        // Header
        let html = '<thead><tr><th class="name-header">Name</th>';
        DateUtils.DAY_KEYS.forEach((dayKey, index) => {
            html += `<th>${DateUtils.DAYS_SHORT[index]}<br><small>${DateUtils.formatDate(dates[index])}</small></th>`;
        });
        html += '</tr></thead><tbody>';

        // Rows
        employees.forEach(emp => {
            const avail = availabilities.find(a => a.employeeId === emp.id);
            html += `<tr><td class="name-cell">${emp.name}</td>`;
            
            DateUtils.DAY_KEYS.forEach(dayKey => {
                const day = avail?.days?.[dayKey];
                if (day?.available) {
                    html += `<td class="available-cell">${day.start}–${day.end}</td>`;
                } else {
                    html += `<td class="unavailable-cell">–</td>`;
                }
            });
            html += '</tr>';
        });

        html += '</tbody>';
        table.innerHTML = html;
    },

    renderScheduleEditor() {
        const table = document.getElementById('schedule-table');
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const employees = DataManager.getEmployees();
        const schedule = DataManager.getScheduleForWeek(weekKey);

        // Header
        let html = '<thead><tr><th>Name</th>';
        DateUtils.DAY_KEYS.forEach((dayKey, index) => {
            html += `<th><span class="day-name">${DateUtils.DAYS_SHORT[index]}</span><span class="date">${DateUtils.formatDate(dates[index])}</span></th>`;
        });
        html += '</tr></thead><tbody>';

        // Rows for each employee
        employees.forEach(emp => {
            html += `<tr><td class="name-cell">${emp.name}</td>`;
            
            DateUtils.DAY_KEYS.forEach((dayKey, dayIndex) => {
                const dayShifts = schedule?.shifts?.[dayKey] || [];
                const shift = dayShifts.find(s => s.employeeId === emp.id);
                
                if (shift) {
                    // Check for deviations
                    let cellClass = 'shift-cell has-shift';
                    let deviationHtml = '';
                    
                    if (shift.deviation) {
                        if (shift.deviation.lateMinutes) {
                            cellClass += ' has-deviation deviation-late';
                            deviationHtml = `<span class="deviation-indicator late">+${shift.deviation.lateMinutes}m</span>`;
                        }
                        if (shift.deviation.earlyMinutes) {
                            cellClass += ' has-deviation deviation-early';
                            deviationHtml = `<span class="deviation-indicator early">-${shift.deviation.earlyMinutes}m</span>`;
                        }
                    }
                    
                    html += `<td class="${cellClass}" 
                        onclick="App.openShiftModal('${emp.id}', '${dayKey}', ${dayIndex})">
                        <span class="shift-time">${shift.start}–${shift.end}</span>
                        ${deviationHtml}
                    </td>`;
                } else {
                    html += `<td class="shift-cell" 
                        onclick="App.openShiftModal('${emp.id}', '${dayKey}', ${dayIndex})"></td>`;
                }
            });
            html += '</tr>';
        });

        html += '</tbody>';
        table.innerHTML = html;
    },

    renderWeekDeviations() {
        const container = document.getElementById('week-deviations');
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey);
        
        if (!schedule) {
            container.innerHTML = '<p class="empty-state">Keine Schichten eingetragen.</p>';
            return;
        }

        const deviations = [];
        
        DateUtils.DAY_KEYS.forEach((dayKey, index) => {
            const dayShifts = schedule.shifts?.[dayKey] || [];
            dayShifts.forEach(shift => {
                if (shift.deviation) {
                    deviations.push({
                        ...shift,
                        dayKey,
                        dayName: DateUtils.DAYS_SHORT[index]
                    });
                }
            });
        });

        if (deviations.length === 0) {
            container.innerHTML = '<p class="empty-state">Keine Abweichungen diese Woche.</p>';
            return;
        }

        container.innerHTML = deviations.map(d => {
            const type = d.deviation.lateMinutes ? 'late' : 'early';
            const info = d.deviation.lateMinutes 
                ? `${d.deviation.lateMinutes} Min. später` 
                : `${d.deviation.earlyMinutes} Min. früher`;
            
            return `
                <div class="deviation-item ${type}">
                    <span class="deviation-name">${d.employeeName}</span>
                    <span class="deviation-day">${d.dayName}</span>
                    <span class="deviation-info">${info}</span>
                    ${d.deviation.reason ? `<span class="deviation-reason">${d.deviation.reason}</span>` : ''}
                </div>
            `;
        }).join('');
    },

    openShiftModal(employeeId, dayKey, dayIndex) {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const employee = DataManager.getEmployee(employeeId);
        const availabilities = DataManager.getAvailabilityForWeek(weekKey);
        const schedule = DataManager.getScheduleForWeek(weekKey);

        this.currentEditCell = { employeeId, dayKey, dayIndex };

        // Set day info
        document.getElementById('modal-day-info').innerHTML = 
            `<strong>${employee.name}</strong> – ${DateUtils.DAYS[dayIndex]}, ${DateUtils.formatDate(dates[dayIndex])}`;

        // Show availability
        const availableList = document.getElementById('available-list');
        const employeeAvail = availabilities.find(a => a.employeeId === employeeId);
        const dayAvail = employeeAvail?.days?.[dayKey];

        if (dayAvail?.available) {
            availableList.innerHTML = `
                <div class="available-employee" onclick="App.quickAssign('${dayAvail.start}', '${dayAvail.end}')">
                    <span class="name">Verfügbar</span>
                    <span class="time">${dayAvail.start} – ${dayAvail.end}</span>
                </div>
            `;
        } else {
            availableList.innerHTML = '<div class="no-available">Keine Verfügbarkeit eingetragen</div>';
        }

        // Check if shift exists
        const existingShift = schedule?.shifts?.[dayKey]?.find(s => s.employeeId === employeeId);
        const removeBtn = document.getElementById('remove-shift');
        
        if (existingShift) {
            document.getElementById('shift-start').value = existingShift.start;
            document.getElementById('shift-end').value = existingShift.end;
            document.getElementById('actual-start').value = existingShift.actualStart || '';
            document.getElementById('actual-end').value = existingShift.actualEnd || '';
            document.getElementById('deviation-note').value = existingShift.deviation?.reason || '';
            removeBtn.style.display = 'block';
        } else {
            document.getElementById('shift-start').value = dayAvail?.start || '10:00';
            document.getElementById('shift-end').value = dayAvail?.end || '20:00';
            document.getElementById('actual-start').value = '';
            document.getElementById('actual-end').value = '';
            document.getElementById('deviation-note').value = '';
            removeBtn.style.display = 'none';
        }

        this.showModal('shift-modal');
    },

    quickAssign(start, end) {
        document.getElementById('shift-start').value = start;
        document.getElementById('shift-end').value = end;
        this.saveShift();
    },

    saveShift() {
        if (!this.currentEditCell) return;

        const { employeeId, dayKey } = this.currentEditCell;
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const start = document.getElementById('shift-start').value;
        const end = document.getElementById('shift-end').value;
        const actualStart = document.getElementById('actual-start').value;
        const actualEnd = document.getElementById('actual-end').value;
        const deviationNote = document.getElementById('deviation-note').value;

        if (!start || !end) {
            this.showToast('Bitte Zeiten eingeben.', 'error');
            return;
        }

        // Get or create schedule
        let schedule = DataManager.getScheduleForWeek(weekKey);
        if (!schedule) {
            schedule = {
                weekKey: weekKey,
                shifts: {},
                released: false
            };
        }
        if (!schedule.shifts) {
            schedule.shifts = {};
        }
        if (!schedule.shifts[dayKey]) {
            schedule.shifts[dayKey] = [];
        }

        // Remove existing shift for this employee on this day
        schedule.shifts[dayKey] = schedule.shifts[dayKey].filter(s => s.employeeId !== employeeId);

        // Build shift object
        const employee = DataManager.getEmployee(employeeId);
        const shift = {
            employeeId: employeeId,
            employeeName: employee.name,
            start: start,
            end: end
        };

        // Check for deviations
        if (actualStart || actualEnd) {
            shift.actualStart = actualStart || null;
            shift.actualEnd = actualEnd || null;
            shift.deviation = {};
            
            if (actualStart && actualStart !== start) {
                const startParts = start.split(':').map(Number);
                const actualStartParts = actualStart.split(':').map(Number);
                const startMinutes = startParts[0] * 60 + startParts[1];
                const actualStartMinutes = actualStartParts[0] * 60 + actualStartParts[1];
                const diff = actualStartMinutes - startMinutes;
                if (diff > 0) {
                    shift.deviation.lateMinutes = diff;
                }
            }
            
            if (actualEnd && actualEnd !== end) {
                const endParts = end.split(':').map(Number);
                const actualEndParts = actualEnd.split(':').map(Number);
                const endMinutes = endParts[0] * 60 + endParts[1];
                const actualEndMinutes = actualEndParts[0] * 60 + actualEndParts[1];
                const diff = endMinutes - actualEndMinutes;
                if (diff > 0) {
                    shift.deviation.earlyMinutes = diff;
                }
            }
            
            if (deviationNote) {
                shift.deviation.reason = deviationNote;
            }
        }

        schedule.shifts[dayKey].push(shift);

        DataManager.saveSchedule(schedule);
        this.hideModals();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.updateReleaseButton();
        this.showToast('Schicht eingetragen!', 'success');
    },

    removeShift() {
        if (!this.currentEditCell) return;

        const { employeeId, dayKey } = this.currentEditCell;
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        let schedule = DataManager.getScheduleForWeek(weekKey);

        if (schedule?.shifts?.[dayKey]) {
            schedule.shifts[dayKey] = schedule.shifts[dayKey].filter(s => s.employeeId !== employeeId);
            DataManager.saveSchedule(schedule);
        }

        this.hideModals();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.showToast('Schicht entfernt.', 'success');
    },

    saveSchedule() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        let schedule = DataManager.getScheduleForWeek(weekKey);
        
        if (schedule) {
            schedule.savedAt = new Date().toISOString();
            DataManager.saveSchedule(schedule);
            this.showToast('Plan gespeichert!', 'success');
            this.updateReleaseButton();
        } else {
            this.showToast('Noch keine Schichten eingetragen.', 'warning');
        }
    },

    releaseSchedule() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        DataManager.releaseSchedule(weekKey);
        this.updateReleaseButton();
        this.showToast('Plan freigegeben! Mitarbeiter können ihn jetzt sehen.', 'success');
    },

    updateReleaseButton() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey);
        const btn = document.getElementById('release-schedule');

        if (!schedule) {
            btn.disabled = true;
            btn.textContent = 'Freigeben';
        } else if (schedule.released) {
            btn.disabled = true;
            btn.textContent = 'Freigegeben';
        } else {
            btn.disabled = false;
            btn.textContent = 'Freigeben';
        }
    },

    // ===========================
    // Month Overview (Admin)
    // ===========================
    renderMonthOverview() {
        const tbody = document.getElementById('month-table-body');
        const employees = DataManager.getEmployees();
        const stats = DataManager.getMonthStats(this.currentMonth);
        
        tbody.innerHTML = employees.map(emp => {
            const empStats = stats[emp.id] || { 
                plannedHours: 0, 
                actualHours: 0, 
                lateCount: 0, 
                earlyCount: 0 
            };
            
            const diff = empStats.actualHours - empStats.plannedHours;
            const diffClass = diff >= 0 ? 'positive' : 'negative';
            const diffText = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
            
            return `
                <tr>
                    <td class="highlight">${emp.name}</td>
                    <td>${empStats.plannedHours.toFixed(1)} Std.</td>
                    <td>${empStats.actualHours.toFixed(1)} Std.</td>
                    <td class="${diffClass}">${diffText} Std.</td>
                    <td>${empStats.lateCount > 0 ? empStats.lateCount + 'x' : '-'}</td>
                    <td>${empStats.earlyCount > 0 ? empStats.earlyCount + 'x' : '-'}</td>
                </tr>
            `;
        }).join('');
    },

    // ===========================
    // Employees Tab (Admin)
    // ===========================
    renderEmployeesTab() {
        const container = document.getElementById('employees-list');
        const employees = DataManager.getEmployees();

        container.innerHTML = employees.map(emp => `
            <div class="employee-card">
                <div class="employee-info">
                    <div class="employee-name">${emp.name}</div>
                    <div class="employee-type">${emp.type === 'aushilfe' ? 'Aushilfe (max. 18h/Woche)' : 'Festangestellt'}</div>
                </div>
                <button class="btn btn-danger btn-small" onclick="App.deleteEmployee('${emp.id}')">Löschen</button>
            </div>
        `).join('');
    },

    saveNewEmployee() {
        const name = document.getElementById('new-emp-name').value.trim();
        const type = document.getElementById('new-emp-type').value;

        if (!name) {
            this.showToast('Bitte Namen eingeben.', 'error');
            return;
        }

        if (DataManager.getEmployeeByName(name)) {
            this.showToast('Name existiert bereits.', 'error');
            return;
        }

        DataManager.addEmployee({ name, store: 'fresh_fries', type });
        this.hideModals();
        this.renderEmployeesTab();
        this.renderAdminView();
        this.loadEmployeeDropdown();
        document.getElementById('new-emp-name').value = '';
        this.showToast(`${name} hinzugefügt!`, 'success');
    },

    deleteEmployee(id) {
        const emp = DataManager.getEmployee(id);
        if (!emp) return;

        if (confirm(`${emp.name} wirklich löschen?`)) {
            DataManager.deleteEmployee(id);
            this.renderEmployeesTab();
            this.renderAdminView();
            this.loadEmployeeDropdown();
            this.showToast(`${emp.name} gelöscht.`, 'success');
        }
    },

    // ===========================
    // Toast Notifications
    // ===========================
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => App.init());

/**
 * FreshShift - Main Application
 * Manual scheduling with deviation tracking
 */

const App = {
    currentWeek: new Date(),
    currentMonth: new Date(),
    currentUser: null,
    currentEditCell: null,

    adminStore: 'fresh_fries',
    employeeStore: 'fresh_fries',


    init() {
        this.adminStore = localStorage.getItem('freshshift_admin_store') || 'fresh_fries';
        this.employeeStore = localStorage.getItem('freshshift_employee_store') || 'fresh_fries';

        this.bindEvents();
        this.loadEmployeeDropdown();

        if (window.FreshShiftSupabase?.init) {
            window.FreshShiftSupabase.init();
        }
        this.populateAdminStoreSelect();
        this.updateWeekDisplay();
        this.updateMonthDisplay();
        this.updateAvailWeekDisplay();
        this.checkExistingSession();
    },

    // ===========================
    // Session Management
    // ===========================
    checkExistingSession() {
        // Check if admin is logged in
        if (DataManager.isAdminSession()) {
            this.showScreen('admin-screen');
            return;
        }

        // Check if employee is logged in
        const savedUser = DataManager.getCurrentUser();
        if (savedUser) {
            // Verify employee still exists
            const employee = DataManager.getEmployee(savedUser.id);
            if (employee) {
                this.currentUser = employee;
                this.showScreen('dashboard-screen');
                return;
            } else {
                // Employee was deleted, clear session
                DataManager.clearCurrentUser();
            }
        }

        // No valid session, show login screen
        this.showScreen('login-screen');
    },

    // ===========================
    // Event Bindings
    // ===========================
    bindEvents() {
        // Login Screen - Toggle
        document.querySelectorAll('.login-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleLoginToggle(e.target));
        });

        // Login Screen - Actions
        document.getElementById('login-btn').addEventListener('click', () => this.handleLogin());
        document.getElementById('admin-login-btn').addEventListener('click', () => this.handleAdminLogin());
        document.getElementById('admin-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleAdminLogin();
        });

        // Dashboard Menu
        document.getElementById('menu-toggle').addEventListener('click', () => this.toggleMenu());
        document.getElementById('menu-close').addEventListener('click', () => this.toggleMenu());
        document.getElementById('menu-overlay').addEventListener('click', () => this.toggleMenu());
        document.getElementById('menu-logout').addEventListener('click', () => this.logout());
        
        // Dashboard Menu Items
        document.querySelectorAll('#side-menu .menu-item').forEach(item => {
            item.addEventListener('click', (e) => this.navigateTo(e.target.dataset.page));
        });

        // Dashboard Quick Actions
        document.getElementById('btn-late').addEventListener('click', () => this.showModal('late-modal'));
        document.getElementById('btn-early').addEventListener('click', () => this.showModal('early-modal'));

        // Availability Form
        document.getElementById('availability-form').addEventListener('submit', (e) => this.handleAvailabilitySubmit(e));
        document.getElementById('prev-week').addEventListener('click', () => this.changeWeek(-1));
        document.getElementById('next-week').addEventListener('click', () => this.changeWeek(1));
        document.getElementById('my-prev-week').addEventListener('click', () => this.changeWeek(-1, false, true));
        document.getElementById('my-next-week').addEventListener('click', () => this.changeWeek(1, false, true));

        // Report Late Modal
        document.getElementById('submit-late').addEventListener('click', () => this.submitLateReport());
        
        // Early Leave Modal
        document.getElementById('submit-early').addEventListener('click', () => this.submitEarlyReport());

        // Shift request decline
        const declineBtn = document.getElementById('submit-request-decline');
        if (declineBtn) declineBtn.addEventListener('click', () => this.submitShiftRequestDecline());

        // Employee absence request
        const requestAbsenceBtn = document.getElementById('request-absence-btn');
        if (requestAbsenceBtn) requestAbsenceBtn.addEventListener('click', () => this.openAbsenceRequestModal());
        const submitAbsenceBtn = document.getElementById('submit-absence-request');
        if (submitAbsenceBtn) submitAbsenceBtn.addEventListener('click', () => this.submitAbsenceRequest());

        // Default availability (admin)
        const saveDefaultBtn = document.getElementById('save-default-availability');
        if (saveDefaultBtn) saveDefaultBtn.addEventListener('click', () => this.saveDefaultAvailability());
        const clearDefaultBtn = document.getElementById('clear-default-availability');
        if (clearDefaultBtn) clearDefaultBtn.addEventListener('click', () => this.clearDefaultAvailability());

        // Admin Menu
        document.getElementById('admin-menu-toggle').addEventListener('click', () => this.toggleAdminMenu());
        const adminStoreSelect = document.getElementById('admin-store-select');
        if (adminStoreSelect) {
            adminStoreSelect.addEventListener('change', (e) => this.setAdminStore(e.target.value));
        }

        const employeeStoreSelect = document.getElementById('employee-store-select');
        if (employeeStoreSelect) {
            employeeStoreSelect.addEventListener('change', (e) => this.setEmployeeStore(e.target.value));
        }

        const myStoreSelect = document.getElementById('my-store-select');
        if (myStoreSelect) {
            myStoreSelect.addEventListener('change', (e) => this.setEmployeeStore(e.target.value, true));
        }
        document.getElementById('admin-menu-close').addEventListener('click', () => this.toggleAdminMenu());
        document.getElementById('admin-menu-overlay').addEventListener('click', () => this.toggleAdminMenu());
        document.getElementById('admin-menu-logout').addEventListener('click', () => this.adminLogout());
        
        // Admin Menu Items
        document.querySelectorAll('#admin-side-menu .menu-item').forEach(item => {
            item.addEventListener('click', (e) => this.navigateAdminTo(e.target.dataset.page));
        });

        // Admin Planner
        document.getElementById('admin-prev-week').addEventListener('click', () => this.changeWeek(-1, true));
        document.getElementById('admin-next-week').addEventListener('click', () => this.changeWeek(1, true));
        document.getElementById('save-schedule').addEventListener('click', () => this.saveSchedule());
         document.getElementById('release-schedule').addEventListener('click', () => this.releaseSchedule());
         document.getElementById('copy-last-week').addEventListener('click', () => this.copyLastWeek());
         document.getElementById('print-schedule').addEventListener('click', () => this.printSchedule());

         // Copy week modal actions
         document.getElementById('copy-week-skip').addEventListener('click', () => this.applyCopyWeek(true));
         document.getElementById('copy-week-all').addEventListener('click', () => this.applyCopyWeek(false));
        
        // Admin quick action
        document.getElementById('quick-edit-plan').addEventListener('click', () => this.navigateAdminTo('admin-planner'));
        
        // Admin Availability Navigation
        document.getElementById('avail-prev-week').addEventListener('click', () => this.changeAvailWeek(-1));
        document.getElementById('avail-next-week').addEventListener('click', () => this.changeAvailWeek(1));

        // Month Navigation
        document.getElementById('prev-month').addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('next-month').addEventListener('click', () => this.changeMonth(1));

        // Notifications
        document.getElementById('notification-badge').addEventListener('click', () => this.toggleNotifications());
        document.getElementById('clear-notifications').addEventListener('click', () => this.clearNotifications());

        // Employees
        document.getElementById('add-employee-btn').addEventListener('click', () => this.openAddEmployeeModal());
        document.getElementById('save-new-employee').addEventListener('click', () => this.saveNewEmployee());

        // Employee store selection in modal
        const storeFresh = document.getElementById('store-fresh-fries');
        const storeYes = document.getElementById('store-yes-fresh');
        const primaryStore = document.getElementById('new-emp-primary-store');

        if (storeFresh) storeFresh.addEventListener('change', () => this.syncEmployeeStoreOptions(primaryStore?.value));
        if (storeYes) storeYes.addEventListener('change', () => this.syncEmployeeStoreOptions(primaryStore?.value));
        if (primaryStore) primaryStore.addEventListener('change', (e) => this.syncEmployeeStoreOptions(e.target.value));

        // Data (Backup/Import)
        const exportBtn = document.getElementById('export-data');
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportBackup());

        const importBtn = document.getElementById('import-data');
        if (importBtn) importBtn.addEventListener('click', () => this.importBackup());

        // Absences
        document.getElementById('save-absence').addEventListener('click', () => this.saveAbsence());
        document.getElementById('delete-absence').addEventListener('click', () => this.deleteAbsence());


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

        if (screenId === 'dashboard-screen') {
            this.renderDashboard();
        } else if (screenId === 'admin-screen') {
            this.populateAdminStoreSelect();
            this.renderAdminDashboard();
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
    // Dashboard Menu
    // ===========================
    toggleMenu() {
        document.getElementById('side-menu').classList.toggle('active');
        document.getElementById('menu-overlay').classList.toggle('active');
    },

    navigateTo(page) {
        // Close menu
        this.toggleMenu();
        
        // Update menu active state
        document.querySelectorAll('#side-menu .menu-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        
        // Show page content
        document.querySelectorAll('#dashboard-screen .page-content').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        
        // Render content if needed
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        this.ensureEmployeeStoreSelectors(weekKey);

        if (page === 'availability') {
            this.renderAvailabilityForm();
        } else if (page === 'schedule') {
            this.renderMyScheduleSection();
        } else if (page === 'absences') {
            this.renderEmployeeAbsencesPage();
        } else if (page === 'dashboard') {
            this.renderDashboard();
        }
    },

    // ===========================
    // Admin Menu
    // ===========================
    toggleAdminMenu() {
        document.getElementById('admin-side-menu').classList.toggle('active');
        document.getElementById('admin-menu-overlay').classList.toggle('active');
    },

    navigateAdminTo(page) {
        // Close menu if open
        const menu = document.getElementById('admin-side-menu');
        if (menu.classList.contains('active')) {
            this.toggleAdminMenu();
        }
        
        // Update menu active state
        document.querySelectorAll('#admin-side-menu .menu-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        
        // Show page content
        document.querySelectorAll('#admin-screen .page-content').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        
        // Render content if needed
        if (page === 'admin-dashboard') {
            this.renderAdminDashboard();
        } else if (page === 'admin-planner') {
            this.renderAdminView();
        } else if (page === 'admin-availability') {
            this.renderAdminAvailability();
        } else if (page === 'admin-month') {
            this.renderMonthOverview();
        } else if (page === 'admin-employees') {
            this.renderEmployeesTab();
        } else if (page === 'admin-data') {
            this.renderAdminDataPage();
        }
    },

    // ===========================
    // Admin Availability Week Navigation
    // ===========================
    availWeek: new Date(),
    
    changeAvailWeek(delta) {
        this.availWeek.setDate(this.availWeek.getDate() + (delta * 7));
        this.updateAvailWeekDisplay();
        this.renderAdminAvailability();
    },

    updateAvailWeekDisplay() {
        const display = DateUtils.formatWeekDisplay(this.availWeek);
        document.getElementById('avail-week-display').textContent = display;
    },

    renderAdminAvailability() {
        this.updateAvailWeekDisplay();
        const table = document.getElementById('availability-table');
        const weekKey = DateUtils.getWeekKey(this.availWeek);
        const dates = DateUtils.getWeekDates(this.availWeek);
        const employees = DataManager.getEmployees().filter(e => (e.stores || []).includes(this.adminStore));
        const availabilities = DataManager.getAvailabilityForWeek(weekKey, this.adminStore);

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

        // Mobile cards
        const mobile = document.getElementById('availability-mobile');
        if (mobile) {
            mobile.innerHTML = employees.map(emp => {
                const avail = availabilities.find(a => a.employeeId === emp.id);

                const pills = DateUtils.DAY_KEYS.map((dayKey, index) => {
                    const day = avail?.days?.[dayKey];
                    const label = DateUtils.DAYS_SHORT[index];
                    if (day?.available) {
                        return `<div class="avail-pill available"><span class="d">${label}</span><span class="t">${day.start}–${day.end}</span></div>`;
                    }
                    return `<div class="avail-pill unavailable"><span class="d">${label}</span><span class="t">–</span></div>`;
                }).join('');

                return `
                    <div class="availability-card">
                        <div class="availability-card-header">
                            <div class="name">${emp.name}</div>
                            <div class="sub">${DataManager.getStoreName(this.adminStore)} · ${DateUtils.formatWeekDisplay(this.availWeek)}</div>
                        </div>
                        <div class="availability-grid">${pills}</div>
                    </div>
                `;
            }).join('') || '<div class="empty-state">Keine Verfügbarkeiten</div>';
        }
    },

    // ===========================
    // Dashboard Rendering
    // ===========================
    renderDashboard() {
        if (!this.currentUser) return;
        
        // Update user names
        document.getElementById('dashboard-user-name').textContent = this.currentUser.name.split(' ')[0];
        document.getElementById('menu-user-name').textContent = this.currentUser.name;

        const storeEl = document.getElementById('menu-user-stores');
        if (storeEl) {
            const stores = this.getUserStores();
            storeEl.innerHTML = stores.map(s => `<span class="store-chip">${DataManager.getStoreName(s)}</span>`).join('');
        }
        
        // Render all dashboard components
        this.renderTodayShift();
        this.renderShiftRequests();
        this.renderMonthlyEarnings();
        this.renderWeekOverview();
        this.renderUpcomingShifts();
        this.updateWeekDisplay();
    },

    renderTodayShift() {
        const container = document.getElementById('today-shift');
        const dateEl = document.getElementById('today-date');
        
        const today = new Date();
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        dateEl.textContent = `${dayNames[today.getDay()]}, ${DateUtils.formatDate(today)}`;
        
        const weekKey = DateUtils.getWeekKey(today);
        const todayKey = DateUtils.getTodayKey();

        const stores = this.getUserStores();
        const myShifts = stores.map(storeId => {
            const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
            const dayShifts = schedule?.shifts?.[todayKey] || [];
            const shift = dayShifts.find(s => s.employeeId === this.currentUser?.id && s.requestStatus !== 'declined');
            return shift ? { storeId, shift } : null;
        }).filter(Boolean);

        if (myShifts.length > 0) {
            if (myShifts.length === 1) {
                const { storeId, shift } = myShifts[0];
                const hours = DateUtils.calculateDuration(shift.start, shift.end);
                container.innerHTML = `
                    <div class="shift-time-big">${shift.start} – ${shift.end}</div>
                    <div class="shift-duration">${DateUtils.formatDuration(hours)} · ${DataManager.getStoreName(storeId)}${shift.requestStatus === 'pending' ? ' · Anfrage' : ''}</div>
                `;
            } else {
                container.innerHTML = myShifts.map(({ storeId, shift }) => {
                    const hours = DateUtils.calculateDuration(shift.start, shift.end);
                    return `<div class="today-multi-shift"><strong>${DataManager.getStoreName(storeId)}:</strong> ${shift.start} – ${shift.end} <span class="muted">(${DateUtils.formatDuration(hours)})</span></div>`;
                }).join('');
            }
        } else {
            container.innerHTML = `
                <div class="day-off-icon">🎉</div>
                <div class="no-shift">Heute frei!</div>
            `;
        }
    },

    getPendingShiftRequests() {
        if (!this.currentUser) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const requests = [];
        const stores = this.getUserStores();

        // Check next 30 days for pending requests
        for (let i = 0; i < 30; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);

            const weekKey = DateUtils.getWeekKey(checkDate);
            const dayIndex = (checkDate.getDay() + 6) % 7; // Monday = 0
            const dayKey = DateUtils.DAY_KEYS[dayIndex];

            for (const storeId of stores) {
                const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
                const dayShifts = schedule?.shifts?.[dayKey] || [];
                const shift = dayShifts.find(s => s.employeeId === this.currentUser.id && s.requestStatus === 'pending');
                if (!shift) continue;

                requests.push({
                    storeId,
                    weekKey,
                    dayKey,
                    dayIndex,
                    date: checkDate,
                    shift
                });
            }
        }

        return requests;
    },

    renderShiftRequests() {
        const card = document.getElementById('shift-requests-card');
        const list = document.getElementById('shift-requests-list');
        const badge = document.getElementById('shift-requests-count');
        if (!card || !list || !badge) return;

        const requests = this.getPendingShiftRequests();
        if (requests.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        badge.textContent = `${requests.length}`;

        list.innerHTML = requests.slice(0, 6).map(req => {
            const d = req.date;
            const dateText = DateUtils.formatDate(d);
            const storeName = DataManager.getStoreName(req.storeId);
            const timeText = `${req.shift.start}–${req.shift.end}`;

            const summary = `${storeName} · ${DateUtils.DAYS_SHORT[req.dayIndex]} ${dateText} · ${timeText}`;

            const payload = encodeURIComponent(JSON.stringify({
                storeId: req.storeId,
                weekKey: req.weekKey,
                dayKey: req.dayKey,
                employeeId: this.currentUser.id
            }));

            return `
                <div class="request-item">
                    <div>
                        <div class="request-title">${storeName}</div>
                        <div class="request-sub">${DateUtils.DAYS_SHORT[req.dayIndex]} · ${dateText} · ${timeText}</div>
                        <div class="request-badge">⏳ Anfrage offen</div>
                    </div>
                    <div class="request-actions">
                        <button class="btn btn-success btn-small" onclick="App.acceptShiftRequest('${payload}')">Annehmen</button>
                        <button class="btn btn-danger btn-small" onclick="App.openDeclineShiftRequest('${payload}', '${encodeURIComponent(summary)}')">Ablehnen</button>
                    </div>
                </div>
            `;
        }).join('') + (requests.length > 6 ? `<div class="helper-text">+ ${requests.length - 6} weitere…</div>` : '');
    },

    formatCurrencyEUR(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return '–';
        return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    },

    renderMonthlyEarnings() {
        const card = document.getElementById('earnings-card');
        const badge = document.getElementById('earnings-month');
        const container = document.getElementById('earnings-summary');
        if (!card || !badge || !container || !this.currentUser) return;

        const hourlyRate = Number(this.currentUser.hourlyRate);
        if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
            card.style.display = 'none';
            return;
        }

        const now = new Date();
        badge.textContent = now.toLocaleDateString('de-DE', { month: 'short' });

        const stores = this.getUserStores();
        const breakdown = stores.map(storeId => {
            const stats = DataManager.getMonthStats(now, storeId);
            const s = stats?.[this.currentUser.id];
            const hours = s ? s.actualHours : 0;
            const amount = hours * hourlyRate;
            return { storeId, hours, amount };
        }).filter(x => x.hours > 0);

        const totalHours = breakdown.reduce((sum, x) => sum + x.hours, 0);
        const totalAmount = breakdown.reduce((sum, x) => sum + x.amount, 0);

        card.style.display = 'block';

        const rows = breakdown.length > 1
            ? `<div class="earnings-breakdown">${breakdown.map(x => `
                <div class="earnings-row">
                    <span>${DataManager.getStoreName(x.storeId)}</span>
                    <span class="muted">${x.hours.toFixed(1)}h · ${this.formatCurrencyEUR(x.amount)}</span>
                </div>
            `).join('')}</div>`
            : '';

        container.innerHTML = `
            <div class="earnings-total">
                <div>
                    <div class="amount">${this.formatCurrencyEUR(totalAmount)}</div>
                    <div class="hours">${totalHours.toFixed(1)}h · ${hourlyRate.toFixed(2).replace('.', ',')} €/h</div>
                </div>
            </div>
            ${rows}
        `;
    },

    acceptShiftRequest(payload) {
        try {
            const data = JSON.parse(decodeURIComponent(payload));
            this.respondShiftRequest(data, 'accepted', null);
            this.showToast('Schichtanfrage angenommen.', 'success');
        } catch {
            this.showToast('Schichtanfrage konnte nicht verarbeitet werden.', 'error');
        }
    },

    openDeclineShiftRequest(payload, summaryEncoded) {
        try {
            const data = JSON.parse(decodeURIComponent(payload));
            this.pendingShiftRequest = data;
            const summary = decodeURIComponent(summaryEncoded || '');
            const el = document.getElementById('shift-request-summary');
            if (el) el.textContent = summary;
            const input = document.getElementById('shift-request-reason');
            if (input) input.value = '';
            this.showModal('shift-request-modal');
        } catch {
            this.showToast('Schichtanfrage konnte nicht verarbeitet werden.', 'error');
        }
    },

    submitShiftRequestDecline() {
        const reason = document.getElementById('shift-request-reason')?.value?.trim() || '';
        if (!reason) {
            this.showToast('Bitte einen Grund eingeben.', 'error');
            return;
        }
        if (!this.pendingShiftRequest) return;
        this.respondShiftRequest(this.pendingShiftRequest, 'declined', reason);
        this.pendingShiftRequest = null;
        this.hideModals();
        this.showToast('Schichtanfrage abgelehnt.', 'success');
    },

    respondShiftRequest({ storeId, weekKey, dayKey, employeeId }, status, reason) {
        const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
        const dayShifts = schedule?.shifts?.[dayKey] || [];
        const shift = dayShifts.find(s => s.employeeId === employeeId && s.requestStatus === 'pending');
        if (!schedule || !shift) {
            this.showToast('Anfrage nicht mehr verfügbar.', 'error');
            return;
        }

        shift.requestStatus = status;
        shift.respondedAt = new Date().toISOString();
        shift.responseReason = reason || null;

        schedule.storeId = storeId;
        DataManager.saveSchedule(schedule);

        // Notify admin (local only)
        const employee = DataManager.getEmployee(employeeId);
        DataManager.addNotification({
            target: 'admin',
            type: 'shift_request_response',
            storeId,
            employeeId,
            employeeName: employee?.name || 'Unbekannt',
            message: status === 'accepted' ? 'Schichtanfrage angenommen' : 'Schichtanfrage abgelehnt',
            reason: reason || null
        });

        // Re-render UI
        this.renderShiftRequests();
        this.renderMyScheduleSection();
        this.renderDashboard();
    },

    pendingShiftRequest: null,

    approveAbsenceRequest(payload) {
        try {
            const { notificationId, absenceId } = JSON.parse(decodeURIComponent(payload));
            const absence = DataManager.getAbsence(absenceId);
            if (!absence) {
                this.showToast('Anfrage nicht mehr verfügbar.', 'error');
                return;
            }

            DataManager.updateAbsence({
                id: absenceId,
                status: 'approved',
                respondedAt: new Date().toISOString(),
                responseReason: null
            });

            DataManager.markNotificationRead(notificationId);
            this.updateAdminNotifications();
            this.renderAbsencesOverview();
            this.renderScheduleEditor();

            this.showToast('Urlaubsanfrage genehmigt.', 'success');
        } catch {
            this.showToast('Anfrage konnte nicht verarbeitet werden.', 'error');
        }
    },

    denyAbsenceRequest(payload) {
        try {
            const { notificationId, absenceId } = JSON.parse(decodeURIComponent(payload));
            const absence = DataManager.getAbsence(absenceId);
            if (!absence) {
                this.showToast('Anfrage nicht mehr verfügbar.', 'error');
                return;
            }

            const reason = prompt('Grund für Ablehnung (optional):', '');

            DataManager.updateAbsence({
                id: absenceId,
                status: 'declined',
                respondedAt: new Date().toISOString(),
                responseReason: reason || null
            });

            DataManager.markNotificationRead(notificationId);
            this.updateAdminNotifications();
            this.renderAbsencesOverview();

            this.showToast('Urlaubsanfrage abgelehnt.', 'warning');
        } catch {
            this.showToast('Anfrage konnte nicht verarbeitet werden.', 'error');
        }
    },
 
    renderEmployeeAbsencesPage() {
        if (!this.currentUser) return;

        const list = document.getElementById('employee-absences-list');
        if (!list) return;

        const absences = DataManager.getAbsencesForEmployee(this.currentUser.id)
            .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
            .reverse();

        if (absences.length === 0) {
            list.innerHTML = '<div class="empty-state">Noch keine Abwesenheiten</div>';
            return;
        }

        list.innerHTML = absences.map(a => {
            const typeIcon = a.type === 'urlaub' ? '🏖️' : a.type === 'krank' ? '🤒' : '📅';
            const typeLabel = a.type === 'urlaub' ? 'Urlaub' : a.type === 'krank' ? 'Krankheit' : 'Sonstiges';

            const startDate = new Date(a.startDate);
            const endDate = new Date(a.endDate);
            const dateText = a.startDate === a.endDate
                ? DateUtils.formatDate(startDate)
                : `${DateUtils.formatDate(startDate)} – ${DateUtils.formatDate(endDate)}`;

            const status = a.status || 'approved';
            const statusLabel = status === 'pending' ? 'Wartet' : status === 'declined' ? 'Abgelehnt' : 'Bestätigt';

            const statusPill = `<span class="absence-pill ${status}">${statusLabel}</span>`;
            const reason = a.responseReason ? `<div class="absence-note">Grund: ${a.responseReason}</div>` : '';

            return `
                <div class="absence-item ${status === 'pending' ? 'absence-active' : ''}">
                    <span class="absence-icon">${typeIcon}</span>
                    <div class="absence-info">
                        <div class="absence-name">${typeLabel} ${statusPill}</div>
                        <div class="absence-dates">${dateText}</div>
                        ${a.note ? `<div class="absence-note">${a.note}</div>` : ''}
                        ${reason}
                    </div>
                </div>
            `;
        }).join('');
    },

    openDefaultAvailabilityModal(employeeId) {
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;

        this.currentDefaultAvailabilityEmployeeId = employeeId;

        const info = document.getElementById('default-availability-employee');
        if (info) {
            info.textContent = `${employee.name} · ${DataManager.getStoreName(this.adminStore)}`;
        }

        const container = document.getElementById('default-availability-days');
        if (!container) return;

        const storeId = this.adminStore;
        const defaults = employee.defaultAvailability?.[storeId]?.days || {};

        container.innerHTML = DateUtils.DAY_KEYS.map((dayKey, idx) => {
            const dayName = DateUtils.DAYS[idx];
            const d = defaults[dayKey] || {};
            const available = !!d.available;
            const start = d.start || '10:00';
            const end = d.end || '20:00';

            return `
                <div class="default-day-card">
                    <div class="default-day-header">
                        <h4>${dayName}</h4>
                        <label class="availability-toggle">
                            <input type="checkbox" id="def_${dayKey}_available" ${available ? 'checked' : ''} onchange="document.getElementById('def_${dayKey}_times').style.display = this.checked ? 'flex' : 'none'">
                            Standard verfügbar
                        </label>
                    </div>
                    <div class="default-time-row" id="def_${dayKey}_times" style="${available ? '' : 'display:none'}">
                        <div class="form-group">
                            <label>Von</label>
                            <input type="time" id="def_${dayKey}_start" value="${start}" step="60" class="time-input-24h" />
                        </div>
                        <div class="form-group">
                            <label>Bis</label>
                            <input type="time" id="def_${dayKey}_end" value="${end}" step="60" class="time-input-24h" />
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        this.showModal('default-availability-modal');
    },

    saveDefaultAvailability() {
        const employeeId = this.currentDefaultAvailabilityEmployeeId;
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;

        const storeId = this.adminStore;
        const days = {};

        DateUtils.DAY_KEYS.forEach(dayKey => {
            const available = document.getElementById(`def_${dayKey}_available`)?.checked || false;
            days[dayKey] = {
                available,
                start: available ? (document.getElementById(`def_${dayKey}_start`)?.value || '10:00') : null,
                end: available ? (document.getElementById(`def_${dayKey}_end`)?.value || '20:00') : null
            };
        });

        const merged = {
            ...(employee.defaultAvailability || {}),
            [storeId]: {
                days,
                updatedAt: new Date().toISOString()
            }
        };

        DataManager.updateEmployee({ id: employeeId, defaultAvailability: merged });
        this.hideModals();
        this.renderEmployeesTab();
        this.showToast('Standardverfügbarkeit gespeichert!', 'success');
    },

    clearDefaultAvailability() {
        const employeeId = this.currentDefaultAvailabilityEmployeeId;
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;

        const storeId = this.adminStore;
        const merged = { ...(employee.defaultAvailability || {}) };
        delete merged[storeId];

        DataManager.updateEmployee({ id: employeeId, defaultAvailability: merged });
        this.hideModals();
        this.renderEmployeesTab();
        this.showToast('Standardverfügbarkeit entfernt.', 'success');
    },

    currentDefaultAvailabilityEmployeeId: null,

    openAbsenceRequestModal() {
        if (!this.currentUser) return;

        const today = new Date().toISOString().split('T')[0];
        const start = document.getElementById('absence-request-start');
        const end = document.getElementById('absence-request-end');
        const type = document.getElementById('absence-request-type');
        const note = document.getElementById('absence-request-note');

        if (start) start.value = today;
        if (end) end.value = today;
        if (type) type.value = 'urlaub';
        if (note) note.value = '';

        this.showModal('absence-request-modal');
    },

    submitAbsenceRequest() {
        if (!this.currentUser) return;

        const type = document.getElementById('absence-request-type').value;
        const startDate = document.getElementById('absence-request-start').value;
        const endDate = document.getElementById('absence-request-end').value;
        const note = document.getElementById('absence-request-note').value.trim();

        if (!startDate || !endDate) {
            this.showToast('Bitte Datum eingeben.', 'error');
            return;
        }
        if (new Date(startDate) > new Date(endDate)) {
            this.showToast('Enddatum muss nach Startdatum sein.', 'error');
            return;
        }

        const status = type === 'krank' ? 'approved' : 'pending';

        const absence = DataManager.addAbsence({
            employeeId: this.currentUser.id,
            startDate,
            endDate,
            type,
            note: note || null,
            status,
            requestedBy: 'employee',
            requestedAt: new Date().toISOString()
        });

        // Notify admin (local only)
        const typeLabel = type === 'urlaub' ? 'Urlaub' : type === 'krank' ? 'Krankheit' : 'Sonstiges';
        DataManager.addNotification({
            target: 'admin',
            type: type === 'krank' ? 'absence_notice' : 'absence_request',
            employeeId: this.currentUser.id,
            employeeName: this.currentUser.name,
            absenceId: absence.id,
            message: `${typeLabel}: ${startDate}${endDate !== startDate ? ' bis ' + endDate : ''}`,
            reason: note || null
        });

        this.hideModals();
        this.renderEmployeeAbsencesPage();
        this.showToast(type === 'krank' ? 'Krankheit gemeldet.' : 'Urlaubsanfrage gesendet.', 'success');
    },

    renderWeekOverview() {
        const container = document.getElementById('week-overview');
        const weekBadge = document.getElementById('dashboard-week');
        
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const today = new Date();
        const stores = this.getUserStores();
        
        weekBadge.textContent = `KW ${DateUtils.getWeekNumber(this.currentWeek)}`;
        
        let totalHours = 0;
        let shiftCount = 0;
        
        container.innerHTML = DateUtils.DAY_KEYS.map((dayKey, index) => {
            const date = dates[index];
            const isToday = date.toDateString() === today.toDateString();

            const shifts = stores.map(storeId => {
                const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
                const dayShifts = schedule?.shifts?.[dayKey] || [];
                const myShift = dayShifts.find(s => s.employeeId === this.currentUser?.id);
                return myShift ? { storeId, shift: myShift } : null;
            }).filter(Boolean);

            let hours = 0;
            if (shifts.length > 0) {
                shifts.forEach(({ shift }) => {
                    hours += DateUtils.calculateDuration(shift.start, shift.end);
                });
                totalHours += hours;
                shiftCount += shifts.length;
            }

            const hoursText = shifts.length > 0 ? `${Math.round(hours * 10) / 10}h` : '–';

            return `
                <div class="week-day ${shifts.length > 0 ? 'has-shift' : ''} ${isToday ? 'is-today' : ''}">
                    <div class="day-name">${DateUtils.DAYS_SHORT[index]}</div>
                    <div class="day-hours">${hoursText}</div>
                </div>
            `;
        }).join('');
        
        document.getElementById('stat-shifts').textContent = shiftCount;
        document.getElementById('stat-hours').textContent = DateUtils.formatDuration(totalHours);
    },

    renderUpcomingShifts() {
        const container = document.getElementById('upcoming-shifts');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const upcoming = [];
        
        // Check next 14 days
        for (let i = 0; i < 14 && upcoming.length < 3; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            
            const weekKey = DateUtils.getWeekKey(checkDate);
            const dayIndex = (checkDate.getDay() + 6) % 7; // Monday = 0
            const dayKey = DateUtils.DAY_KEYS[dayIndex];
 
            const stores = this.getUserStores();
            let found = null;
 
            for (const storeId of stores) {
                const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
                const dayShifts = schedule?.shifts?.[dayKey] || [];
                const myShift = dayShifts.find(s => s.employeeId === this.currentUser?.id && s.requestStatus !== 'declined');
                if (myShift) {
                    found = { storeId, shift: myShift };
                    break;
                }
            }
 
            if (found && i > 0) { // Skip today
                upcoming.push({
                    date: checkDate,
                    dayName: DateUtils.DAYS_SHORT[dayIndex],
                    storeId: found.storeId,
                    shift: found.shift
                });
            }
        }

        
        if (upcoming.length === 0) {
            container.innerHTML = '<div class="no-upcoming">Keine weiteren Schichten geplant</div>';
            return;
        }
        
        container.innerHTML = upcoming.map(item => {
            const hours = DateUtils.calculateDuration(item.shift.start, item.shift.end);
            return `
                <div class="upcoming-shift">
                    <div class="shift-date">
                        <div class="day">${item.dayName}</div>
                        <div class="date">${DateUtils.formatDate(item.date)}</div>
                    </div>
                    <div class="shift-info">
                        <div class="time">${item.shift.start} – ${item.shift.end}</div>
                        <div class="duration">${DateUtils.formatDuration(hours)} · ${DataManager.getStoreName(item.storeId)}</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ===========================
    // Section Tabs (Employee) - REMOVED, using menu now
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
    // Admin Dashboard
    // ===========================
    renderAdminDashboard() {
        const today = new Date();
        const weekKey = DateUtils.getWeekKey(today);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        const employees = DataManager.getEmployees().filter(e => (e.stores || []).includes(this.adminStore));
        const availabilities = DataManager.getAvailabilityForWeek(weekKey, this.adminStore);
        
        // Update week badge
        document.getElementById('admin-dashboard-week').textContent = `KW ${DateUtils.getWeekNumber(today)}`;
        
        // Update today date
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        document.getElementById('admin-today-date').textContent = `${dayNames[today.getDay()]}, ${DateUtils.formatDate(today)}`;
        
        // Render week status
        this.renderAdminWeekStatus(schedule, employees);
        
        // Render week overview (mini calendar)
        this.renderAdminWeekOverview(schedule);
        
        // Render today's shifts
        this.renderAdminTodayShifts(schedule, today);
        
        // Render upcoming absences
        this.renderAdminUpcomingAbsences();
        
        // Check for missing availabilities for next week
        this.renderMissingAvailabilities(employees);
        
        // Render quick stats
        this.renderAdminQuickStats(employees, schedule, availabilities);
        
        // Render notifications
        this.updateAdminNotifications();
    },

    renderAdminWeekOverview(schedule) {
        const container = document.getElementById('admin-week-overview');
        if (!container) return;
        
        const dates = DateUtils.getWeekDates(new Date());
        const today = new Date();
        
        container.innerHTML = `
            <div class="admin-mini-week">
                ${DateUtils.DAY_KEYS.map((dayKey, index) => {
                    const date = dates[index];
                    const dayShifts = schedule?.shifts?.[dayKey] || [];
                    const isToday = date.toDateString() === today.toDateString();
                    const shiftCount = dayShifts.length;
                    
                    return `
                        <div class="mini-week-day ${isToday ? 'is-today' : ''} ${shiftCount > 0 ? 'has-shifts' : ''}">
                            <span class="mini-day-name">${DateUtils.DAYS_SHORT[index]}</span>
                            <span class="mini-day-count">${shiftCount > 0 ? shiftCount : '-'}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderAdminUpcomingAbsences() {
        const container = document.getElementById('admin-upcoming-absences');
        const card = document.getElementById('admin-absences-card');
        if (!container || !card) return;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + 14);
        
        const absences = DataManager.getAbsences().filter(a => {
            const endDate = new Date(a.endDate);
            const startDate = new Date(a.startDate);
            return endDate >= today && startDate <= futureDate;
        }).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        
        if (absences.length === 0) {
            container.innerHTML = '<div class="empty-state small">Keine Abwesenheiten in den nächsten 14 Tagen</div>';
            return;
        }
        
        container.innerHTML = absences.slice(0, 5).map(absence => {
            const employee = DataManager.getEmployee(absence.employeeId);
            const startDate = new Date(absence.startDate);
            const endDate = new Date(absence.endDate);
            const isActive = today >= startDate && today <= endDate;
            
            const typeIcon = absence.type === 'urlaub' ? '🏖️' : 
                            absence.type === 'krank' ? '🤒' : '📅';
            
            const dateText = startDate.toISOString().split('T')[0] === endDate.toISOString().split('T')[0]
                ? DateUtils.formatDate(startDate)
                : `${DateUtils.formatDate(startDate)} – ${DateUtils.formatDate(endDate)}`;
            
            return `
                <div class="admin-absence-item ${isActive ? 'active' : ''}">
                    <span class="absence-icon">${typeIcon}</span>
                    <span class="absence-employee">${employee?.name || 'Unbekannt'}</span>
                    <span class="absence-date">${dateText}</span>
                    ${isActive ? '<span class="absence-now">Jetzt</span>' : ''}
                </div>
            `;
        }).join('');
        
        if (absences.length > 5) {
            container.innerHTML += `<div class="more-link" onclick="App.navigateAdminTo('admin-employees')">+ ${absences.length - 5} weitere anzeigen</div>`;
        }
    },

    renderMissingAvailabilities(employees) {
        const card = document.getElementById('missing-avail-card');
        const list = document.getElementById('missing-avail-list');
        const badge = document.getElementById('next-week-badge');
        if (!card || !list) return;
        
        // Get next week
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekKey = DateUtils.getWeekKey(nextWeek);
        const nextWeekAvailabilities = DataManager.getAvailabilityForWeek(nextWeekKey, this.adminStore);
        
        badge.textContent = `KW ${DateUtils.getWeekNumber(nextWeek)}`;
        
        // Find employees who haven't submitted availability for next week
        const submittedIds = nextWeekAvailabilities.map(a => a.employeeId);
        const missing = employees.filter(emp => !submittedIds.includes(emp.id));
        
        if (missing.length === 0) {
            card.style.display = 'none';
            return;
        }
        
        card.style.display = 'block';
        list.innerHTML = missing.map(emp => `
            <div class="missing-avail-item">
                <span class="employee-name">${emp.name}</span>
                <span class="missing-label">Noch nicht eingereicht</span>
            </div>
        `).join('');
    },

    renderAdminWeekStatus(schedule, employees) {
        const container = document.getElementById('admin-week-status');
        
        if (!schedule) {
            container.innerHTML = `
                <div class="status-warning">
                    <span class="status-icon">⚠️</span>
                    <span>Noch kein Wochenplan erstellt</span>
                </div>
            `;
            return;
        }
        
        // Count shifts
        let totalShifts = 0;
        let totalHours = 0;
        
        DateUtils.DAY_KEYS.forEach(dayKey => {
                const dayShifts = schedule.shifts?.[dayKey] || [];
                const activeShifts = dayShifts.filter(s => s.requestStatus !== 'declined');
                totalShifts += activeShifts.length;
                activeShifts.forEach(shift => {
                    totalHours += DateUtils.calculateDuration(shift.start, shift.end);
                });
        });
        
        const statusClass = schedule.released ? 'status-success' : 'status-pending';
        const statusText = schedule.released ? 'Plan freigegeben' : 'Plan nicht freigegeben';
        const statusIcon = schedule.released ? '✓' : '⏳';
        
        container.innerHTML = `
            <div class="${statusClass}">
                <span class="status-icon">${statusIcon}</span>
                <span>${statusText}</span>
            </div>
            <div class="week-status-stats">
                <span>${totalShifts} Schichten</span>
                <span>${DateUtils.formatDuration(totalHours)}</span>
            </div>
        `;
    },

    renderAdminTodayShifts(schedule, today) {
        const container = document.getElementById('admin-today-shifts');
        const todayKey = DateUtils.getTodayKey();
        const todayShifts = schedule?.shifts?.[todayKey] || [];
        
        if (todayShifts.length === 0) {
            container.innerHTML = '<div class="empty-today">Keine Schichten heute</div>';
            return;
        }
        
        container.innerHTML = todayShifts.map(shift => {
            let deviationBadge = '';
            if (shift.deviation) {
                if (shift.deviation.lateMinutes) {
                    deviationBadge = `<span class="deviation-badge late">+${shift.deviation.lateMinutes}m</span>`;
                } else if (shift.deviation.earlyMinutes) {
                    deviationBadge = `<span class="deviation-badge early">-${shift.deviation.earlyMinutes}m</span>`;
                }
            }
            
            return `
                <div class="today-shift-item">
                    <span class="shift-employee">${shift.employeeName}</span>
                    <span class="shift-time">${shift.start} – ${shift.end}</span>
                    ${deviationBadge}
                </div>
            `;
        }).join('');
    },

    renderAdminQuickStats(employees, schedule, availabilities) {
        document.getElementById('stat-total-employees').textContent = employees.length;
        
        // Count week shifts and hours
        let totalShifts = 0;
        let totalHours = 0;
        
        if (schedule) {
            DateUtils.DAY_KEYS.forEach(dayKey => {
                const dayShifts = schedule.shifts?.[dayKey] || [];
                totalShifts += dayShifts.length;
                dayShifts.forEach(shift => {
                    totalHours += DateUtils.calculateDuration(shift.start, shift.end);
                });
            });
        }
        
        document.getElementById('stat-week-shifts').textContent = totalShifts;
        document.getElementById('stat-week-hours').textContent = DateUtils.formatDuration(totalHours);
        document.getElementById('stat-availabilities').textContent = availabilities.length;
    },

    updateAdminNotifications() {
        const notifications = DataManager.getUnreadNotifications()
            .filter(n => (n.target !== 'employee') && (!n.storeId || n.storeId === this.adminStore));

        const badge = document.getElementById('notification-badge');
        const count = document.getElementById('notification-count');
        const card = document.getElementById('notifications-card');
        const list = document.getElementById('notifications-list');
        
        if (notifications.length > 0) {
            badge.style.display = 'block';
            count.textContent = notifications.length;
            card.style.display = 'block';
            
            list.innerHTML = notifications.map(n => {
                let icon = '🔔';
                if (n.type === 'early') icon = '🚪';
                else if (n.type === 'late') icon = '⏰';
                else if (n.type === 'shift_request_response') icon = '✅';
                else if (n.type === 'absence_request') icon = '📅';
                else if (n.type === 'absence_notice') icon = '🤒';

                const titleName = n.employeeName ? `${n.employeeName}: ` : '';

                const needsAbsenceActions = n.type === 'absence_request' && n.absenceId;
                const actions = needsAbsenceActions ? (() => {
                    const payload = encodeURIComponent(JSON.stringify({ notificationId: n.id, absenceId: n.absenceId }));
                    return `
                        <div class="request-actions" style="margin-top: 8px; flex-direction: row;">
                            <button class="btn btn-success btn-small" onclick="App.approveAbsenceRequest('${payload}')">Genehmigen</button>
                            <button class="btn btn-danger btn-small" onclick="App.denyAbsenceRequest('${payload}')">Ablehnen</button>
                        </div>
                    `;
                })() : '';

                return `
                    <div class="notification-item ${n.type}">
                        <span class="notification-icon">${icon}</span>
                        <div class="notification-content">
                            <div class="notification-title">${titleName}${n.message}${n.storeId ? ` · ${DataManager.getStoreName(n.storeId)}` : ''}</div>
                            ${n.reason ? `<div class="notification-reason">${n.type === 'shift_request_response' ? 'Info' : 'Grund'}: ${n.reason}</div>` : ''}
                            <div class="notification-time">${this.formatTimestamp(n.timestamp)}</div>
                            ${actions}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            badge.style.display = 'none';
            card.style.display = 'none';
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

        const storeOrder = ['fresh_fries', 'yes_fresh'];
        const sorted = [...employees].sort((a, b) => {
            const aStore = a.primaryStore || a.store || (a.stores?.[0]) || 'fresh_fries';
            const bStore = b.primaryStore || b.store || (b.stores?.[0]) || 'fresh_fries';
            const aIdx = storeOrder.indexOf(aStore);
            const bIdx = storeOrder.indexOf(bStore);
            if (aIdx !== bIdx) return aIdx - bIdx;
            return String(a.name || '').localeCompare(String(b.name || ''), 'de');
        });

        select.innerHTML = '<option value="">-- Bitte wählen --</option>';

        const groups = new Map();
        sorted.forEach(emp => {
            const primary = emp.primaryStore || emp.store || (emp.stores?.[0]) || 'fresh_fries';
            if (!groups.has(primary)) groups.set(primary, []);
            groups.get(primary).push(emp);
        });

        storeOrder.forEach(storeId => {
            const emps = groups.get(storeId) || [];
            if (emps.length === 0) return;

            const group = document.createElement('optgroup');
            group.label = DataManager.getStoreName(storeId);

            emps.forEach(emp => {
                const stores = Array.isArray(emp.stores) ? emp.stores : [emp.store || emp.primaryStore || storeId];
                const storeNames = stores.map(s => DataManager.getStoreName(s));
                const suffix = storeNames.length > 1 ? ` (${storeNames.join(' / ')})` : ` (${storeNames[0]})`;

                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = `${emp.name}${suffix}`;
                group.appendChild(opt);
            });

            select.appendChild(group);
        });
    },

    populateAdminStoreSelect() {
        const select = document.getElementById('admin-store-select');
        if (!select) return;

        const storeIds = Object.keys(DataManager.STORES);
        select.innerHTML = storeIds
            .map(id => `<option value="${id}">${DataManager.getStoreName(id)}</option>`)
            .join('');

        select.value = this.adminStore;
    },

    setAdminStore(storeId) {
        this.adminStore = DataManager.normalizeStoreId(storeId);
        localStorage.setItem('freshshift_admin_store', this.adminStore);

        const select = document.getElementById('admin-store-select');
        if (select) select.value = this.adminStore;

        // Re-render current admin page
        const active = document.querySelector('#admin-side-menu .menu-item.active');
        const page = active?.dataset?.page || 'admin-dashboard';
        this.navigateAdminTo(page);
    },

    setEmployeeStore(storeId, isSchedule = false) {
        this.employeeStore = DataManager.normalizeStoreId(storeId);
        localStorage.setItem('freshshift_employee_store', this.employeeStore);

        const availSelect = document.getElementById('employee-store-select');
        if (availSelect) availSelect.value = this.employeeStore;

        const mySelect = document.getElementById('my-store-select');
        if (mySelect) mySelect.value = this.employeeStore;

        if (isSchedule) {
            this.renderMyScheduleSection();
        } else {
            this.renderAvailabilityForm();
        }
    },

    getUserStores() {
        const u = this.currentUser;
        if (!u) return ['fresh_fries'];
        if (Array.isArray(u.stores) && u.stores.length > 0) return u.stores;
        if (u.store) return [u.store];
        return [u.primaryStore || 'fresh_fries'];
    },

    ensureEmployeeStoreSelectors(weekKey) {
        const stores = this.getUserStores();

        // Availability selector: show if user can work multiple stores
        const availRow = document.getElementById('employee-store-row');
        const availSelect = document.getElementById('employee-store-select');
        if (availRow && availSelect) {
            if (stores.length <= 1) {
                availRow.style.display = 'none';
            } else {
                availRow.style.display = 'flex';
                availSelect.innerHTML = stores.map(id => `<option value="${id}">${DataManager.getStoreName(id)}</option>`).join('');
                if (!stores.includes(this.employeeStore)) this.employeeStore = stores[0];
                availSelect.value = this.employeeStore;
            }
        }

        // Schedule selector: show only stores with shifts this week (plus primary)
        const scheduleRow = document.getElementById('my-store-row');
        const scheduleSelect = document.getElementById('my-store-select');
        if (scheduleRow && scheduleSelect) {
            const primary = this.currentUser?.primaryStore || stores[0];
            const storesWithShifts = stores.filter(storeId => {
                const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
                const has = DateUtils.DAY_KEYS.some(dayKey => (schedule?.shifts?.[dayKey] || []).some(s => s.employeeId === this.currentUser?.id));
                return has;
            });

            const visibleStores = Array.from(new Set([primary, ...storesWithShifts])).filter(Boolean);

            if (visibleStores.length <= 1) {
                scheduleRow.style.display = 'none';
            } else {
                scheduleRow.style.display = 'flex';
                scheduleSelect.innerHTML = visibleStores.map(id => `<option value="${id}">${DataManager.getStoreName(id)}</option>`).join('');
                if (!visibleStores.includes(this.employeeStore)) this.employeeStore = primary;
                scheduleSelect.value = this.employeeStore;
            }
        }
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

        const stores = this.getUserStores();
        this.employeeStore = employee.primaryStore || employee.store || stores[0] || 'fresh_fries';
        localStorage.setItem('freshshift_employee_store', this.employeeStore);

        this.showScreen('dashboard-screen');
        this.showToast(`Hallo ${employee.name}!`, 'success');
    },

    handleAdminLogin() {
        const password = document.getElementById('admin-password').value;
        const errorEl = document.getElementById('admin-error');
        
        // Check password
        if (password !== 'zabi4886093') {
            errorEl.textContent = 'Falsches Passwort. Bitte erneut versuchen.';
            document.getElementById('admin-password').value = '';
            document.getElementById('admin-password').focus();
            return;
        }
        
        errorEl.textContent = '';
        document.getElementById('admin-password').value = '';
        DataManager.setAdminSession();
        this.showScreen('admin-screen');
        this.showToast('Willkommen im Admin-Bereich!', 'success');
    },

    handleLoginToggle(btn) {
        const type = btn.dataset.type;
        
        // Update toggle buttons
        document.querySelectorAll('.login-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show corresponding section
        document.querySelectorAll('.login-section').forEach(s => s.classList.remove('active'));
        document.getElementById(`${type}-login`).classList.add('active');
        
        // Clear any errors
        document.getElementById('admin-error').textContent = '';
    },

    logout() {
        this.currentUser = null;
        DataManager.clearCurrentUser();
        document.getElementById('employee-select').value = '';
        this.showScreen('login-screen');
        this.resetLoginForm();
    },

    adminLogout() {
        DataManager.clearCurrentUser();
        this.showScreen('login-screen');
        this.resetLoginForm();
    },

    resetLoginForm() {
        // Reset to employee login
        document.querySelectorAll('.login-toggle-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.login-toggle-btn[data-type="employee"]').classList.add('active');
        document.querySelectorAll('.login-section').forEach(s => s.classList.remove('active'));
        document.getElementById('employee-login').classList.add('active');
        document.getElementById('admin-error').textContent = '';
        document.getElementById('admin-password').value = '';
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
    formatMinutesToTime(totalMinutes) {
        const m = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        return `${hh}:${mm}`;
    },

    applyEmployeeShiftDeviation(kind, minutes, reason) {
        if (!this.currentUser) return null;

        const today = new Date();
        const weekKey = DateUtils.getWeekKey(today);
        const dayKey = DateUtils.getTodayKey();
        const delta = parseInt(minutes, 10) || 0;

        const stores = this.getUserStores();
        for (const storeId of stores) {
            const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
            const dayShifts = schedule?.shifts?.[dayKey] || [];
            const shift = dayShifts.find(s => s.employeeId === this.currentUser.id);
            if (!schedule || !shift) continue;

            const plannedStart = DateUtils.parseTimeToMinutes(shift.start);
            const plannedEnd = DateUtils.parseTimeToMinutes(shift.end);

            shift.deviation = shift.deviation || {};

            if (kind === 'late') {
                const actualStartMin = Math.min(plannedStart + delta, plannedEnd);
                shift.actualStart = this.formatMinutesToTime(actualStartMin);
                shift.deviation.lateMinutes = actualStartMin - plannedStart;
                if (reason) shift.deviation.reason = reason;
            }

            if (kind === 'early') {
                const actualEndMin = Math.max(plannedEnd - delta, plannedStart);
                shift.actualEnd = this.formatMinutesToTime(actualEndMin);
                shift.deviation.earlyMinutes = plannedEnd - actualEndMin;
                if (reason) shift.deviation.reason = reason;
            }

            schedule.storeId = storeId;
            DataManager.saveSchedule(schedule);
            return storeId;
        }

        return null;
    },

    submitLateReport() {
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const minutes = parseInt(document.getElementById('late-minutes').value, 10) || 0;
        const reason = document.getElementById('late-reason').value;

        const storeId = this.applyEmployeeShiftDeviation('late', minutes, reason);

        const today = new Date();
        const notification = {
            type: 'late',
            employeeId: this.currentUser.id,
            employeeName: this.currentUser.name,
            storeId: storeId || this.employeeStore,
            weekKey: DateUtils.getWeekKey(today),
            dayKey: DateUtils.getTodayKey(),
            date: today.toISOString().split('T')[0],
            message: `Kommt ${minutes} Minuten später`,
            reason: reason || null
        };

        DataManager.addNotification(notification);

        this.hideModals();
        document.getElementById('late-reason').value = '';
        this.renderDashboard();
        this.showToast('Meldung gesendet! (Ohne Backend nur auf diesem Gerät sichtbar)', 'success');
    },

    // ===========================
    // Report Early Leave (Employee)
    // ===========================
    submitEarlyReport() {
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const minutes = parseInt(document.getElementById('early-minutes').value, 10) || 0;
        const reason = document.getElementById('early-reason').value;

        const storeId = this.applyEmployeeShiftDeviation('early', minutes, reason);

        const today = new Date();
        const notification = {
            type: 'early',
            employeeId: this.currentUser.id,
            employeeName: this.currentUser.name,
            storeId: storeId || this.employeeStore,
            weekKey: DateUtils.getWeekKey(today),
            dayKey: DateUtils.getTodayKey(),
            date: today.toISOString().split('T')[0],
            message: `Geht ${minutes} Minuten früher`,
            reason: reason || null
        };

        DataManager.addNotification(notification);

        this.hideModals();
        document.getElementById('early-reason').value = '';
        this.renderDashboard();
        this.showToast('Meldung gesendet! (Ohne Backend nur auf diesem Gerät sichtbar)', 'success');
    },

    // ===========================
    // Notifications (Admin) - Updated for new structure
    // ===========================
    updateNotificationBadge() {
        this.updateAdminNotifications();
    },

    renderNotificationsList(notifications) {
        // This is now handled by updateAdminNotifications
    },

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + 
               ' Uhr, ' + date.toLocaleDateString('de-DE');
    },

    toggleNotifications() {
        const card = document.getElementById('notifications-card');
        card.style.display = card.style.display === 'none' ? 'block' : 'none';
    },

    clearNotifications() {
        DataManager.markAllNotificationsRead();
        this.updateAdminNotifications();
        this.showToast('Alle Meldungen als gelesen markiert.', 'success');
    },

    // ===========================
    // Availability Form (Employee)
    // ===========================
    renderAvailabilityForm() {
        this.updateWeekDisplay();
        const container = document.querySelector('#page-availability .days-container');
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const weekKey = DateUtils.getWeekKey(this.currentWeek);

        this.ensureEmployeeStoreSelectors(weekKey);

        const existingAvail = this.currentUser ?
            DataManager.getEmployeeAvailability(this.currentUser.id, weekKey, this.employeeStore) : null;

        const defaults = this.currentUser?.defaultAvailability?.[this.employeeStore] || null;

        container.innerHTML = '';

        DateUtils.DAYS.forEach((dayName, index) => {
            const dayKey = DateUtils.DAY_KEYS[index];
            const date = dates[index];

            const existing = existingAvail?.days?.[dayKey] || defaults?.days?.[dayKey] || {};
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
                        <input type="time" name="${dayKey}_start" value="${existing.start || '10:00'}" step="60" class="time-input-24h">
                    </div>
                    <div class="time-group">
                        <label>Bis:</label>
                        <input type="time" name="${dayKey}_end" value="${existing.end || '20:00'}" step="60" class="time-input-24h">
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

        document.getElementById('general-notes').value = existingAvail?.notes || defaults?.notes || '';
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
            storeId: this.employeeStore,
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
        this.ensureEmployeeStoreSelectors(weekKey);

        const schedule = DataManager.getScheduleForWeek(weekKey, this.employeeStore);
        const dates = DateUtils.getWeekDates(this.currentWeek);

        
        const statusContainer = document.getElementById('schedule-status');
        const contentContainer = document.getElementById('my-schedule-content');
        const summaryContainer = document.getElementById('weekly-summary');

        const storeName = DataManager.getStoreName(this.employeeStore);

        if (!schedule) {
            statusContainer.className = 'schedule-status pending';
            statusContainer.innerHTML = `
                <h3>Kein Plan vorhanden</h3>
                <p>${storeName}: Für diese Woche wurde noch kein Schichtplan erstellt.</p>
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
                <p>${storeName} · Freigegeben am ${new Date(schedule.releasedAt).toLocaleDateString('de-DE')}</p>
            `;
        } else {
            statusContainer.className = 'schedule-status pending';
            statusContainer.innerHTML = `
                <h3>Vorläufiger Plan</h3>
                <p>${storeName} · Dieser Plan wurde noch nicht freigegeben.</p>
            `;
        }

        // Shifts
        contentContainer.innerHTML = '';
        let totalHours = 0;
        let shiftCount = 0;

        DateUtils.DAY_KEYS.forEach((dayKey, index) => {
            const daySchedule = schedule.shifts?.[dayKey] || [];
            const myShift = daySchedule.find(s => s.employeeId === this.currentUser?.id && s.requestStatus !== 'declined');
            
            const card = document.createElement('div');
            
            if (myShift) {
                const isPending = myShift.requestStatus === 'pending';
                const hours = DateUtils.calculateDuration(myShift.start, myShift.end);

                if (!isPending) {
                    totalHours += hours;
                    shiftCount++;
                }
                
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

                const requestHtml = isPending ? `<div class="shift-deviation early">⏳ Schichtanfrage offen</div>` : '';
                
                card.className = 'my-shift-card';
                card.innerHTML = `
                    <div class="shift-day">
                        <span class="day-name">${DateUtils.DAYS_SHORT[index]}</span>
                        <span class="date">${DateUtils.formatDate(dates[index])}</span>
                    </div>
                    <div class="shift-details">
                        <div class="shift-time">${myShift.start} – ${myShift.end}</div>
                        <div class="shift-note">${isPending ? 'Anfrage' : DateUtils.formatDuration(hours)}</div>
                        ${requestHtml}
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
    // Admin View (Planner Page)
    // ===========================
    renderAdminView() {
        this.updateWeekDisplay();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.updateReleaseButton();
    },

    // This is now handled by renderAdminAvailability() on separate page
    renderAvailabilityOverview() {
        // Legacy - kept for compatibility but redirects to new function
        this.renderAdminAvailability();
    },

    renderScheduleEditor() {
        const table = document.getElementById('schedule-table');
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const employees = DataManager.getEmployees().filter(e => (e.stores || []).includes(this.adminStore));
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        const availabilities = DataManager.getAvailabilityForWeek(weekKey, this.adminStore);
        const availByEmployeeId = new Map(availabilities.map(a => [a.employeeId, a]));


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
                const dayDate = dates[dayIndex];
                const dayShifts = schedule?.shifts?.[dayKey] || [];
                const shift = dayShifts.find(s => s.employeeId === emp.id);
                
                // Check if employee is absent on this day
                const absence = DataManager.getEmployeeAbsenceForDate(emp.id, dayDate);
                
                if (absence) {
                    // Employee is absent - show absence badge instead of shift cell
                    const absenceType = absence.type;
                    let cellClass = 'shift-cell cell-absent';
                    let badgeClass = 'vacation';
                    let badgeText = 'Urlaub';
                    
                    if (absenceType === 'krank') {
                        cellClass = 'shift-cell cell-sick';
                        badgeClass = 'sick';
                        badgeText = 'Krank';
                    } else if (absenceType === 'sonstiges') {
                        badgeClass = 'other';
                        badgeText = 'Abwesend';
                    }
                    
                    html += `<td class="${cellClass}" 
                        onclick="App.openShiftModal('${emp.id}', '${dayKey}', ${dayIndex})"
                        title="${absence.note || badgeText}">
                        <span class="absence-cell-badge ${badgeClass}">${badgeText}</span>
                    </td>`;
                } else if (shift) {
                    // Check for deviations
                    let cellClass = 'shift-cell has-shift';
                    let deviationHtml = '';
                    let requestHtml = '';

                    if (shift.requestStatus === 'pending') {
                        cellClass += ' request-pending';
                        requestHtml = `<span class="request-indicator pending">⏳ Anfrage</span>`;
                    } else if (shift.requestStatus === 'declined') {
                        cellClass += ' request-declined';
                        requestHtml = `<span class="request-indicator declined">✕ Abgelehnt</span>`;
                    }
                    
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
                        ${requestHtml}
                        ${deviationHtml}
                    </td>`;
                } else {
                    const empAvail = availByEmployeeId.get(emp.id);
                    const dayAvail = empAvail?.days?.[dayKey];
                    const hint = dayAvail?.available ? `<span class="avail-hint">${dayAvail.start}–${dayAvail.end}</span>` : '';

                    html += `<td class="shift-cell" 
                        onclick="App.openShiftModal('${emp.id}', '${dayKey}', ${dayIndex})">${hint}</td>`;
                }
            });
            html += '</tr>';
        });

        html += '</tbody>';
        table.innerHTML = html;

        const printWeek = document.getElementById('print-week');
        if (printWeek) {
            printWeek.textContent = `${DateUtils.formatWeekDisplay(this.currentWeek)} · ${DataManager.getStoreName(this.adminStore)}`;
        }
    },

    printSchedule() {
        const printWeek = document.getElementById('print-week');
        if (printWeek) {
            printWeek.textContent = `${DateUtils.formatWeekDisplay(this.currentWeek)} · ${DataManager.getStoreName(this.adminStore)}`;
        }
        window.print();
    },
 
    renderWeekDeviations() {
        const container = document.getElementById('week-deviations');
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);

        
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
        const availabilities = DataManager.getAvailabilityForWeek(weekKey, this.adminStore);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        const dayDate = dates[dayIndex];

        this.currentEditCell = { employeeId, dayKey, dayIndex };

        // Set day info
        let dayInfoHtml = `<strong>${employee.name}</strong> – ${DateUtils.DAYS[dayIndex]}, ${DateUtils.formatDate(dates[dayIndex])}`;
        
        // Check if employee is absent
        const absence = DataManager.getEmployeeAbsenceForDate(employeeId, dayDate);
        if (absence) {
            const typeLabel = absence.type === 'urlaub' ? 'Urlaub' : 
                             absence.type === 'krank' ? 'Krank' : 'Abwesend';
            dayInfoHtml += `<div class="modal-absence-warning">⚠️ ${employee.name} ist an diesem Tag abwesend (${typeLabel}${absence.note ? ': ' + absence.note : ''})</div>`;
        }
        
        document.getElementById('modal-day-info').innerHTML = dayInfoHtml;

        // Show availability
        const availableList = document.getElementById('available-list');
        const employeeAvail = DataManager.getEmployeeAvailability(employeeId, weekKey, this.adminStore) || availabilities.find(a => a.employeeId === employeeId);
        const dayAvail = employeeAvail?.days?.[dayKey];

        if (absence) {
            // Employee is absent - show warning instead of availability
            const typeLabel = absence.type === 'urlaub' ? 'im Urlaub' : 
                             absence.type === 'krank' ? 'krank' : 'abwesend';
            availableList.innerHTML = `<div class="no-available" style="color: #b91c1c;">🚫 ${employee.name} ist ${typeLabel}</div>`;
        } else if (dayAvail?.available) {
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
        let schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        if (!schedule) {
            schedule = {
                weekKey: weekKey,
                storeId: this.adminStore,
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

        // If employee has no availability for this day, create a shift request
        const employeeAvail = DataManager.getEmployeeAvailability(employeeId, weekKey, this.adminStore);
        const dayAvail = employeeAvail?.days?.[dayKey];
        const needsRequest = !(dayAvail?.available);

        if (needsRequest) {
            shift.requestStatus = 'pending';
            shift.requestedAt = new Date().toISOString();
            shift.requestedBy = 'admin';

            // Local notification (no backend): only visible on same device
            DataManager.addNotification({
                target: 'employee',
                targetEmployeeId: employeeId,
                type: 'shift_request',
                storeId: this.adminStore,
                employeeId: employeeId,
                employeeName: employee.name,
                message: `Schichtanfrage: ${start}–${end}`,
                reason: 'Bitte annehmen oder ablehnen.'
            });
        }

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

        schedule.storeId = this.adminStore;
        DataManager.saveSchedule(schedule);
        this.hideModals();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.updateReleaseButton();
        this.showToast(needsRequest ? 'Schichtanfrage gesendet!' : 'Schicht eingetragen!', needsRequest ? 'warning' : 'success');
    },

    removeShift() {
        if (!this.currentEditCell) return;

        const { employeeId, dayKey } = this.currentEditCell;
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        let schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);

        if (schedule?.shifts?.[dayKey]) {
            schedule.shifts[dayKey] = schedule.shifts[dayKey].filter(s => s.employeeId !== employeeId);
            schedule.storeId = this.adminStore;
            DataManager.saveSchedule(schedule);
        }

        this.hideModals();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.showToast('Schicht entfernt.', 'success');
    },

    saveSchedule() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        let schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        
        if (schedule) {
            schedule.savedAt = new Date().toISOString();
            schedule.storeId = this.adminStore;
            DataManager.saveSchedule(schedule);
            this.showToast('Plan gespeichert!', 'success');
            this.updateReleaseButton();
        } else {
            this.showToast('Noch keine Schichten eingetragen.', 'warning');
        }
    },

    releaseSchedule() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        DataManager.releaseSchedule(weekKey, this.adminStore);
        this.updateReleaseButton();
        this.showToast('Plan freigegeben! Mitarbeiter können ihn jetzt sehen.', 'success');
    },

     pendingCopyContext: null,

     copyLastWeek() {
         // Get last week's date
         const lastWeekDate = new Date(this.currentWeek);
         lastWeekDate.setDate(lastWeekDate.getDate() - 7);

         const lastWeekKey = DateUtils.getWeekKey(lastWeekDate);
         const currentWeekKey = DateUtils.getWeekKey(this.currentWeek);

         // Check if last week has a schedule
         const lastWeekSchedule = DataManager.getScheduleForWeek(lastWeekKey, this.adminStore);

         if (!lastWeekSchedule || !lastWeekSchedule.shifts) {
             this.showToast('Keine Schichten in der letzten Woche gefunden.', 'warning');
             return;
         }

         // Check if current week already has shifts
         const currentSchedule = DataManager.getScheduleForWeek(currentWeekKey, this.adminStore);
         if (currentSchedule && currentSchedule.shifts && Object.keys(currentSchedule.shifts).length > 0) {
             if (!confirm('Diese Woche hat bereits Schichten. Möchtest du sie überschreiben?')) {
                 return;
             }
         }

         const dates = DateUtils.getWeekDates(this.currentWeek);
         const currentAvailabilities = DataManager.getAvailabilityForWeek(currentWeekKey, this.adminStore);

         const conflicts = [];
         DateUtils.DAY_KEYS.forEach((dayKey, dayIndex) => {
             const dayDate = dates[dayIndex];
             const dayShifts = lastWeekSchedule.shifts[dayKey] || [];

             dayShifts.forEach(shift => {
                 const employee = DataManager.getEmployee(shift.employeeId);
                 const employeeName = employee?.name || shift.employeeName || 'Unbekannt';

                 const absence = DataManager.getEmployeeAbsenceForDate(shift.employeeId, dayDate);
                 if (absence) {
                     const typeLabel = absence.type === 'urlaub' ? 'Urlaub' : absence.type === 'krank' ? 'Krank' : 'Abwesend';
                     conflicts.push({
                         kind: 'absence',
                         employeeId: shift.employeeId,
                         employeeName,
                         dayIndex,
                         dayKey,
                         date: DateUtils.formatDate(dayDate),
                         detail: `${typeLabel}${absence.note ? ' – ' + absence.note : ''}`
                     });
                 }

                 const avail = currentAvailabilities.find(a => a.employeeId === shift.employeeId);
                 const dayAvail = avail?.days?.[dayKey];
                 if (!dayAvail || !dayAvail.available) {
                     conflicts.push({
                         kind: 'availability',
                         employeeId: shift.employeeId,
                         employeeName,
                         dayIndex,
                         dayKey,
                         date: DateUtils.formatDate(dayDate),
                         detail: 'Keine Verfügbarkeit'
                     });
                 }
             });
         });

         this.pendingCopyContext = {
             lastWeekKey,
             currentWeekKey,
             lastWeekSchedule,
             dates,
             conflicts
         };

         const summary = document.getElementById('copy-week-summary');
         if (summary) {
             const conflictCount = conflicts.length;
             summary.textContent = conflictCount === 0
                 ? 'Keine Konflikte gefunden. Du kannst alles kopieren.'
                 : `Gefundene Konflikte: ${conflictCount}. Du kannst ohne Konflikte kopieren oder trotzdem alles übernehmen.`;
         }

         const list = document.getElementById('copy-week-conflicts');
         if (list) {
             if (conflicts.length === 0) {
                 list.innerHTML = '<div class="empty-state">Keine Konflikte 🎉</div>';
             } else {
                 list.innerHTML = conflicts.slice(0, 30).map(c => {
                     const icon = c.kind === 'absence' ? '🚫' : '🕒';
                     const tag = c.kind === 'absence' ? 'Abwesenheit' : 'Verfügbarkeit';
                     return `
                         <div class="conflict-item">
                             <div class="conflict-icon">${icon}</div>
                             <div class="conflict-main">
                                 <div class="conflict-title">${c.employeeName} – ${DateUtils.DAYS_SHORT[c.dayIndex]} (${c.date})</div>
                                 <div class="conflict-sub">${c.detail}</div>
                             </div>
                             <div class="conflict-tag">${tag}</div>
                         </div>
                     `;
                 }).join('') + (conflicts.length > 30 ? `<div class="helper-text">+ ${conflicts.length - 30} weitere Konflikte…</div>` : '');
             }
         }

         this.showModal('copy-week-modal');
     },

     applyCopyWeek(skipConflicts) {
         if (!this.pendingCopyContext) return;

         const { lastWeekKey, currentWeekKey, lastWeekSchedule, dates } = this.pendingCopyContext;

         const newShifts = {};
         const skipped = [];

         DateUtils.DAY_KEYS.forEach((dayKey, dayIndex) => {
             const dayDate = dates[dayIndex];
             const dayShifts = lastWeekSchedule.shifts[dayKey] || [];
             newShifts[dayKey] = [];

             dayShifts.forEach(shift => {
                 if (!skipConflicts) {
                     newShifts[dayKey].push({
                         employeeId: shift.employeeId,
                         employeeName: shift.employeeName,
                         start: shift.start,
                         end: shift.end
                     });
                     return;
                 }

                 const absence = DataManager.getEmployeeAbsenceForDate(shift.employeeId, dayDate);
                 if (absence) {
                     skipped.push({ employeeId: shift.employeeId, dayIndex, reason: 'Abwesenheit' });
                     return;
                 }

                 const avail = DataManager.getEmployeeAvailability(shift.employeeId, currentWeekKey, this.adminStore);
                 const dayAvail = avail?.days?.[dayKey];
                 if (!dayAvail || !dayAvail.available) {
                     skipped.push({ employeeId: shift.employeeId, dayIndex, reason: 'Keine Verfügbarkeit' });
                     return;
                 }

                 newShifts[dayKey].push({
                     employeeId: shift.employeeId,
                     employeeName: shift.employeeName,
                     start: shift.start,
                     end: shift.end
                 });
             });
         });

         const newSchedule = {
             weekKey: currentWeekKey,
             storeId: this.adminStore,
             shifts: newShifts,
             released: false,
             copiedFrom: lastWeekKey,
             createdAt: new Date().toISOString()
         };

         DataManager.saveSchedule(newSchedule);
         this.hideModals();
         this.pendingCopyContext = null;

         this.renderScheduleEditor();
         this.updateReleaseButton();

         if (skipConflicts && skipped.length > 0) {
             this.showToast(`${skipped.length} Schichten wegen Konflikten übersprungen.`, 'warning');
         } else {
             this.showToast('Schichten von letzter Woche kopiert!', 'success');
         }
     },


    updateReleaseButton() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
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
        const employees = DataManager.getEmployees().filter(e => (e.stores || []).includes(this.adminStore || 'fresh_fries'));
        const stats = DataManager.getMonthStats(this.currentMonth, this.adminStore || 'fresh_fries');

        
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
            
            const hourlyRate = Number(emp.hourlyRate);
            const hasRate = Number.isFinite(hourlyRate) && hourlyRate > 0;
            const earnings = hasRate ? empStats.actualHours * hourlyRate : null;

            return `
                <tr>
                    <td class="highlight">${emp.name}</td>
                    <td>${empStats.plannedHours.toFixed(1)} Std.</td>
                    <td>${empStats.actualHours.toFixed(1)} Std.</td>
                    <td class="${diffClass}">${diffText} Std.</td>
                    <td>${hasRate ? hourlyRate.toFixed(2).replace('.', ',') : '-'}</td>
                    <td>${hasRate ? this.formatCurrencyEUR(earnings) : '-'}</td>
                    <td>${empStats.lateCount > 0 ? empStats.lateCount + 'x' : '-'}</td>
                    <td>${empStats.earlyCount > 0 ? empStats.earlyCount + 'x' : '-'}</td>
                </tr>
            `;
        }).join('');

        // Mobile cards
        const mobile = document.getElementById('month-stats-mobile');
        if (mobile) {
            mobile.innerHTML = employees.map(emp => {
                const s = stats[emp.id] || { plannedHours: 0, actualHours: 0, lateCount: 0, earlyCount: 0 };
                const diff = s.actualHours - s.plannedHours;
                const diffClass = diff >= 0 ? 'positive' : 'negative';
                const hourlyRate = Number(emp.hourlyRate);
                const hasRate = Number.isFinite(hourlyRate) && hourlyRate > 0;
                const earnings = hasRate ? s.actualHours * hourlyRate : null;

                return `
                    <div class="month-card">
                        <div class="month-card-header">
                            <div class="name">${emp.name}</div>
                            <div class="meta">${hasRate ? `${hourlyRate.toFixed(2).replace('.', ',')} €/h` : 'Kein Stundenlohn'}</div>
                        </div>
                        <div class="month-card-grid">
                            <div class="item"><span class="k">Geplant</span><span class="v">${s.plannedHours.toFixed(1)}h</span></div>
                            <div class="item"><span class="k">Tatsächlich</span><span class="v">${s.actualHours.toFixed(1)}h</span></div>
                            <div class="item"><span class="k">+/-</span><span class="v ${diffClass}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}h</span></div>
                            <div class="item"><span class="k">Verdienst</span><span class="v">${hasRate ? this.formatCurrencyEUR(earnings) : '–'}</span></div>
                            <div class="item"><span class="k">Spät</span><span class="v">${s.lateCount || 0}</span></div>
                            <div class="item"><span class="k">Früh</span><span class="v">${s.earlyCount || 0}</span></div>
                        </div>
                    </div>
                `;
            }).join('') || '<div class="empty-state">Keine Daten</div>';
        }
    },

    // ===========================
    // Employees Tab (Admin)
    // ===========================
    renderEmployeesTab() {
        const container = document.getElementById('employees-list');
        const employees = DataManager.getEmployees();

        const storeId = this.adminStore || 'fresh_fries';
        const storeName = DataManager.getStoreName(storeId);

        const storeEmployees = employees
            .filter(e => (e.stores || []).includes(storeId))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));

        const cards = storeEmployees.map(emp => {
            // Check for current/upcoming absences
            const today = new Date();
            const absences = DataManager.getAbsencesForEmployee(emp.id);
            const currentAbsence = absences.find(a => {
                const start = new Date(a.startDate);
                const end = new Date(a.endDate);
                return today >= start && today <= end;
            });

            let absenceBadge = '';
            if (currentAbsence) {
                const typeLabel = currentAbsence.type === 'urlaub' ? 'Urlaub' :
                    currentAbsence.type === 'krank' ? 'Krank' : 'Abwesend';
                const badgeClass = currentAbsence.type === 'krank' ? 'badge-sick' : 'badge-vacation';
                absenceBadge = `<span class="absence-badge ${badgeClass}">${typeLabel}</span>`;
            }

            const stores = Array.isArray(emp.stores) && emp.stores.length > 0 ? emp.stores : [emp.primaryStore || emp.store || storeId];
            const storeChips = stores.map(s => `<span class="store-chip">${DataManager.getStoreName(s)}</span>`).join('');

            return `
                <div class="employee-card ${currentAbsence ? 'employee-absent' : ''}">
                    <div class="employee-info">
                        <div class="employee-name-row">
                            <span class="employee-name">${emp.name}</span>
                            ${absenceBadge}
                        </div>
                        <div class="employee-meta">
                            <div class="employee-stores">${storeChips}</div>
                            <div class="employee-type">${emp.type === 'aushilfe' ? 'Aushilfe' : 'Festangestellt'}</div>
                        </div>
                    </div>
                    <div class="employee-actions">
                        <button class="btn btn-secondary btn-small" onclick="App.openAbsenceModal('${emp.id}')">
                            <span class="btn-icon-inline">📅</span> Abwesenheit
                        </button>
                        <button class="btn btn-secondary btn-small" onclick="App.openDefaultAvailabilityModal('${emp.id}')">
                            <span class="btn-icon-inline">⏱️</span> Standard
                        </button>
                        <button class="btn btn-secondary btn-small btn-icon-only" onclick="App.openEditEmployeeModal('${emp.id}')">✎</button>
                        <button class="btn btn-danger btn-small btn-icon-only" onclick="App.deleteEmployee('${emp.id}')">✕</button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="employees-store-section">
                <div class="store-section-header">
                    <h4>${storeName}</h4>
                    <span class="store-count">${storeEmployees.length}</span>
                </div>
                ${cards || '<div class="empty-state">Keine Mitarbeiter</div>'}
            </div>
        `;

        // Render absences overview
        this.renderAbsencesOverview();
    },

    renderAbsencesOverview() {
        const container = document.getElementById('absences-overview-list');
        const absences = DataManager.getAbsences();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Filter to current and upcoming absences (next 30 days)
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + 30);
        
        const relevantAbsences = absences.filter(a => {
            const status = a.status || 'approved';
            const endDate = new Date(a.endDate);
            const startDate = new Date(a.startDate);
            return endDate >= today && startDate <= futureDate && status !== 'declined';
        }).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        
        if (relevantAbsences.length === 0) {
            container.innerHTML = '<div class="empty-state">Keine Abwesenheiten eingetragen</div>';
            return;
        }
        
        container.innerHTML = relevantAbsences.map(absence => {
            const employee = DataManager.getEmployee(absence.employeeId);
            const startDate = new Date(absence.startDate);
            const endDate = new Date(absence.endDate);
            const isActive = today >= startDate && today <= endDate;
            
            const typeIcon = absence.type === 'urlaub' ? '🏖️' : 
                            absence.type === 'krank' ? '🤒' : '📅';
            const typeLabel = absence.type === 'urlaub' ? 'Urlaub' : 
                             absence.type === 'krank' ? 'Krank' : 'Abwesend';
            
            const dateText = startDate.toISOString().split('T')[0] === endDate.toISOString().split('T')[0]
                ? DateUtils.formatDate(startDate)
                : `${DateUtils.formatDate(startDate)} – ${DateUtils.formatDate(endDate)}`;
            
            const status = absence.status || 'approved';
            const statusPill = status === 'pending'
                ? '<span class="absence-pill pending">Wartet</span>'
                : '<span class="absence-pill approved">Bestätigt</span>';

            return `
                <div class="absence-item ${isActive ? 'absence-active' : ''}" onclick="App.editAbsence('${absence.id}')">
                    <span class="absence-icon">${typeIcon}</span>
                    <div class="absence-info">
                        <div class="absence-name">${employee?.name || 'Unbekannt'} ${statusPill}</div>
                        <div class="absence-dates">${typeLabel}: ${dateText}</div>
                        ${absence.note ? `<div class="absence-note">${absence.note}</div>` : ''}
                        ${absence.responseReason ? `<div class="absence-note">Grund: ${absence.responseReason}</div>` : ''}
                    </div>
                    ${isActive ? '<span class="absence-status">Aktuell</span>' : ''}
                </div>
            `;
        }).join('');
    },

    // ===========================
    // Data (Backup / Import)
    // ===========================
    renderAdminDataPage() {
        const status = document.getElementById('backup-status');
        if (!status) return;

        status.textContent = 'Export/Import lokal';
    },

    exportBackup() {
        try {
            const payload = DataManager.exportBackup();
            const date = new Date(payload.exportedAt);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            const filename = `freshshift-backup-${yyyy}-${mm}-${dd}.json`;

            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            const status = document.getElementById('backup-status');
            if (status) status.textContent = `Export: ${yyyy}-${mm}-${dd}`;

            this.showToast('Backup heruntergeladen.', 'success');
        } catch (e) {
            this.showToast(e?.message || 'Backup konnte nicht exportiert werden.', 'error');
        }
    },

    importBackup() {
        const input = document.getElementById('import-file');
        const file = input?.files?.[0];
        if (!file) {
            this.showToast('Bitte zuerst eine JSON-Datei auswählen.', 'error');
            return;
        }

        if (!confirm('Import überschreibt die aktuellen Daten auf diesem Gerät. Fortfahren?')) {
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = String(reader.result || '');
                const payload = JSON.parse(text);
                DataManager.importBackup(payload);

                this.showToast('Backup importiert. Seite wird neu geladen…', 'success');
                setTimeout(() => window.location.reload(), 600);
            } catch (e) {
                this.showToast(e?.message || 'Import fehlgeschlagen (ungültige Datei).', 'error');
            }
        };
        reader.onerror = () => this.showToast('Datei konnte nicht gelesen werden.', 'error');
        reader.readAsText(file);
    },

    currentEditAbsence: null,

    openAbsenceModal(employeeId, absenceId = null) {
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;
        
        document.getElementById('absence-employee-info').innerHTML = `<strong>${employee.name}</strong>`;
        
        // Set default dates
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('absence-start').value = today;
        document.getElementById('absence-end').value = today;
        document.getElementById('absence-type').value = 'urlaub';
        document.getElementById('absence-note').value = '';
        document.getElementById('delete-absence').style.display = 'none';
        document.getElementById('absence-modal-title').textContent = 'Abwesenheit eintragen';
        
        this.currentEditAbsence = { employeeId, absenceId: null };
        this.showModal('absence-modal');
    },

    editAbsence(absenceId) {
        const absence = DataManager.getAbsence(absenceId);
        if (!absence) return;
        
        const employee = DataManager.getEmployee(absence.employeeId);
        document.getElementById('absence-employee-info').innerHTML = `<strong>${employee?.name || 'Unbekannt'}</strong>`;
        
        document.getElementById('absence-start').value = absence.startDate;
        document.getElementById('absence-end').value = absence.endDate;
        document.getElementById('absence-type').value = absence.type;
        document.getElementById('absence-note').value = absence.note || '';
        document.getElementById('delete-absence').style.display = 'block';
        document.getElementById('absence-modal-title').textContent = 'Abwesenheit bearbeiten';
        
        this.currentEditAbsence = { employeeId: absence.employeeId, absenceId };
        this.showModal('absence-modal');
    },

    saveAbsence() {
        if (!this.currentEditAbsence) return;
        
        const startDate = document.getElementById('absence-start').value;
        const endDate = document.getElementById('absence-end').value;
        const type = document.getElementById('absence-type').value;
        const note = document.getElementById('absence-note').value.trim();
        
        if (!startDate || !endDate) {
            this.showToast('Bitte Datum eingeben.', 'error');
            return;
        }
        
        if (new Date(startDate) > new Date(endDate)) {
            this.showToast('Enddatum muss nach Startdatum sein.', 'error');
            return;
        }
        
        const absenceData = {
            employeeId: this.currentEditAbsence.employeeId,
            startDate,
            endDate,
            type,
            note: note || null
        };
        
        if (this.currentEditAbsence.absenceId) {
            // Update existing
            absenceData.id = this.currentEditAbsence.absenceId;
            DataManager.updateAbsence(absenceData);
            this.showToast('Abwesenheit aktualisiert.', 'success');
        } else {
            // Create new
            DataManager.addAbsence(absenceData);
            this.showToast('Abwesenheit eingetragen.', 'success');
        }
        
        this.hideModals();
        this.currentEditAbsence = null;
        this.renderEmployeesTab();
    },

    deleteAbsence() {
        if (!this.currentEditAbsence?.absenceId) return;
        
        if (confirm('Abwesenheit wirklich löschen?')) {
            DataManager.deleteAbsence(this.currentEditAbsence.absenceId);
            this.hideModals();
            this.currentEditAbsence = null;
            this.renderEmployeesTab();
            this.showToast('Abwesenheit gelöscht.', 'success');
        }
    },

    openAddEmployeeModal() {
        document.getElementById('employee-modal-title').textContent = 'Neuer Mitarbeiter';
        document.getElementById('save-new-employee').textContent = 'Hinzufügen';

        document.getElementById('new-emp-id').value = '';
        document.getElementById('new-emp-name').value = '';
        document.getElementById('new-emp-type').value = 'aushilfe';
        document.getElementById('new-emp-hourly').value = '';

        // Default store = current admin store
        document.getElementById('store-fresh-fries').checked = (this.adminStore === 'fresh_fries');
        document.getElementById('store-yes-fresh').checked = (this.adminStore === 'yes_fresh');
        this.syncEmployeeStoreOptions();

        this.showModal('add-employee-modal');
    },

    openEditEmployeeModal(employeeId) {
        const emp = DataManager.getEmployee(employeeId);
        if (!emp) return;

        document.getElementById('employee-modal-title').textContent = 'Mitarbeiter bearbeiten';
        document.getElementById('save-new-employee').textContent = 'Speichern';

        document.getElementById('new-emp-id').value = emp.id;
        document.getElementById('new-emp-name').value = emp.name || '';
        document.getElementById('new-emp-type').value = emp.type || 'aushilfe';
        document.getElementById('new-emp-hourly').value = (Number(emp.hourlyRate) > 0) ? String(emp.hourlyRate).replace('.', ',') : '';

        const stores = Array.isArray(emp.stores) && emp.stores.length > 0 ? emp.stores : [emp.primaryStore || emp.store || 'fresh_fries'];
        document.getElementById('store-fresh-fries').checked = stores.includes('fresh_fries');
        document.getElementById('store-yes-fresh').checked = stores.includes('yes_fresh');
        this.syncEmployeeStoreOptions(emp.primaryStore || emp.store || stores[0]);

        this.showModal('add-employee-modal');
    },

    syncEmployeeStoreOptions(preferPrimary) {
        const fresh = document.getElementById('store-fresh-fries')?.checked;
        const yes = document.getElementById('store-yes-fresh')?.checked;

        const stores = [];
        if (fresh) stores.push('fresh_fries');
        if (yes) stores.push('yes_fresh');

        const select = document.getElementById('new-emp-primary-store');
        const group = document.getElementById('new-emp-primary-store-group');
        if (!select || !group) return;

        // Only show primary store choice for hybrid workers
        if (stores.length <= 1) {
            group.style.display = 'none';
            select.innerHTML = stores.length === 1
                ? `<option value="${stores[0]}">${DataManager.getStoreName(stores[0])}</option>`
                : '';
            select.value = stores[0] || 'fresh_fries';
            return;
        }

        group.style.display = 'block';
        select.innerHTML = stores.map(id => `<option value="${id}">${DataManager.getStoreName(id)}</option>`).join('');

        const wanted = preferPrimary || this.adminStore;
        if (stores.includes(wanted)) {
            select.value = wanted;
        } else {
            select.value = stores[0];
        }
    },

    saveNewEmployee() {
        const id = document.getElementById('new-emp-id').value.trim();
        const name = document.getElementById('new-emp-name').value.trim();
        const type = document.getElementById('new-emp-type').value;

        const hourlyRaw = document.getElementById('new-emp-hourly').value.trim();
        const hourlyRate = hourlyRaw ? Number(hourlyRaw.replace(',', '.')) : null;

        const stores = [];
        if (document.getElementById('store-fresh-fries').checked) stores.push('fresh_fries');
        if (document.getElementById('store-yes-fresh').checked) stores.push('yes_fresh');

        const primaryStore = stores.length === 1
            ? stores[0]
            : document.getElementById('new-emp-primary-store').value;

        if (!name) {
            this.showToast('Bitte Namen eingeben.', 'error');
            return;
        }

        if (stores.length === 0) {
            this.showToast('Bitte mindestens ein Geschäft auswählen.', 'error');
            return;
        }

        if (!stores.includes(primaryStore)) {
            this.showToast('Hauptgeschäft muss in den ausgewählten Geschäften enthalten sein.', 'error');
            return;
        }

        const existing = DataManager.getEmployeeByName(name);
        if (existing && existing.id !== id) {
            this.showToast('Name existiert bereits.', 'error');
            return;
        }

        if (hourlyRate !== null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) {
            this.showToast('Ungültiger Stundenlohn.', 'error');
            return;
        }

        const employeePatch = {
            name,
            type,
            primaryStore,
            stores,
            hourlyRate: hourlyRate
        };

        if (id) {
            DataManager.updateEmployee({ id, ...employeePatch });
            this.showToast(`${name} aktualisiert!`, 'success');
        } else {
            DataManager.addEmployee(employeePatch);
            this.showToast(`${name} hinzugefügt!`, 'success');
        }

        this.hideModals();
        this.renderEmployeesTab();
        this.renderAdminView();
        this.loadEmployeeDropdown();
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

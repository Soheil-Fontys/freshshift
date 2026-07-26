/**
 * FreshShift - Main Application
 * Manual scheduling with deviation tracking
 */

const App = {
    currentWeek: new Date(),
    currentMonth: new Date(),
    currentUser: null,
    currentEditCell: null,
    currentPlanChangeShift: null,
    calendarSubscriptionUrl: null,

    adminStore: 'fresh_fries',
    employeeStore: 'fresh_fries',
    cloudRefreshTimer: null,
    cloudRefreshInFlight: false,
    lastCloudRefreshAt: 0,

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    },

    encodeActionData(value) {
        return encodeURIComponent(String(value ?? '')).replace(/'/g, '%27');
    },

    cloneSchedule(schedule) {
        if (!schedule) return null;
        if (typeof structuredClone === 'function') return structuredClone(schedule);
        return JSON.parse(JSON.stringify(schedule));
    },

    getEmployeeName(employeeId, fallback = 'Unbekannt') {
        return DataManager.getEmployee(employeeId)?.name || fallback;
    },


    async init() {
        this.adminStore = localStorage.getItem('freshshift_admin_store') || 'fresh_fries';
        this.employeeStore = localStorage.getItem('freshshift_employee_store') || 'fresh_fries';

        this.bindEvents();
        this.populateAdminStoreSelect();
        this.updateWeekDisplay();
        this.updateMonthDisplay();
        this.updateAvailWeekDisplay();
        this.showScreen('loading-screen');

        try {
            await window.FreshShiftSupabase.init((event, session) => this.handleAuthStateChange(event, session));
            this.startBackgroundRefresh();
        } catch (error) {
            this.showScreen('login-screen');
            this.setAuthStatus(error?.message || 'Cloud-Verbindung fehlgeschlagen.', true);
        }
    },

    // ===========================
    // Session Management
    // ===========================
    async handleAuthStateChange(event, session) {
        const signOutButton = document.getElementById('auth-signout');

        if (!session?.user) {
            this.currentUser = null;
            this.currentPlanChangeShift = null;
            this.calendarSubscriptionUrl = null;
            DataManager.disconnectCloud();
            if (signOutButton) signOutButton.style.display = 'none';
            this.showScreen('login-screen');
            if (event !== 'INITIAL_SESSION') this.setAuthStatus('Abgemeldet.');
            else this.setAuthStatus('');
            return;
        }

        if (signOutButton) signOutButton.style.display = 'block';
        this.setAuthStatus('Daten werden geladen…');

        try {
            const context = await DataManager.connectToCloud(window.FreshShiftSupabase.ensureClient());
            this.lastCloudRefreshAt = Date.now();
            this.populateAdminStoreSelect();
            this.updateViewSwitchers(context);

            if (context.role === 'admin') {
                this.currentUser = context.employee || null;
                this.setAuthStatus('');
                const preferredView = context.employee
                    ? localStorage.getItem('freshshift_view_mode')
                    : null;
                this.showScreen(preferredView === 'employee' ? 'dashboard-screen' : 'admin-screen');
                return;
            }

            if (!context.employee) {
                this.currentUser = null;
                this.showScreen('login-screen');
                this.setAuthStatus('Dieses Konto ist noch keinem Mitarbeiter zugeordnet.', true);
                return;
            }

            this.currentUser = context.employee;
            const stores = this.getUserStores();
            this.employeeStore = context.employee.primaryStore || stores[0] || 'fresh_fries';
            localStorage.setItem('freshshift_employee_store', this.employeeStore);
            this.setAuthStatus('');
            this.showScreen('dashboard-screen');
        } catch (error) {
            this.currentUser = null;
            DataManager.disconnectCloud();
            this.showScreen('login-screen');
            this.setAuthStatus(error?.message || 'Daten konnten nicht geladen werden.', true);
        }
    },

    setAuthStatus(message, isError = false) {
        const status = document.getElementById('auth-status');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('login-error', Boolean(isError));
    },

    startBackgroundRefresh() {
        if (this.cloudRefreshTimer) return;

        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') this.refreshCloudData();
        };

        window.addEventListener('focus', refreshWhenVisible);
        document.addEventListener('visibilitychange', refreshWhenVisible);
        this.cloudRefreshTimer = window.setInterval(refreshWhenVisible, 2 * 60 * 1000);
    },

    async refreshCloudData(force = false) {
        const authContext = DataManager.getAuthContext?.();
        if (!authContext?.user || this.cloudRefreshInFlight) return;
        if (!force && Date.now() - this.lastCloudRefreshAt < 30 * 1000) return;
        if (!force && document.querySelector('.modal.active')) return;

        this.cloudRefreshInFlight = true;
        try {
            const context = await DataManager.reloadCloudData();
            this.lastCloudRefreshAt = Date.now();
            this.updateViewSwitchers(context);

            if (context.role === 'admin' && document.getElementById('admin-screen')?.classList.contains('active')) {
                this.populateAdminStoreSelect();
                const activePage = document.querySelector('#admin-screen .page-content.active')?.id;
                if (activePage === 'page-admin-planner') this.renderAdminView();
                else if (activePage === 'page-admin-availability') this.renderAdminAvailability();
                else if (activePage === 'page-admin-month') this.renderMonthOverview();
                else if (activePage === 'page-admin-employees') this.renderEmployeesTab();
                else if (activePage === 'page-admin-history') this.renderShiftHistory();
                else if (activePage === 'page-admin-data') this.renderAdminDataPage();
                else this.renderAdminDashboard();
                this.updateAdminNotifications();
            } else if (context.employee && document.getElementById('dashboard-screen')?.classList.contains('active')) {
                this.currentUser = context.employee;
                const activePage = document.querySelector('#dashboard-screen .page-content.active')?.id;
                if (activePage === 'page-availability') this.renderAvailabilityForm();
                else if (activePage === 'page-schedule') this.renderMyScheduleSection();
                else if (activePage === 'page-absences') this.renderEmployeeAbsencesPage();
                else if (activePage === 'page-open-shifts') this.renderEmployeeWorkflows();
                else this.renderDashboard();
            }
        } catch (error) {
            if (force) this.showToast(error?.message || 'Daten konnten nicht aktualisiert werden.', 'error');
            else console.warn('FreshShift background refresh failed', error);
        } finally {
            this.cloudRefreshInFlight = false;
        }
    },

    async sendAuthLink() {
        const email = document.getElementById('auth-email')?.value || '';
        const button = document.getElementById('auth-send-link');
        if (button) button.disabled = true;
        this.setAuthStatus('Anmeldecode wird gesendet…');

        try {
            await window.FreshShiftSupabase.sendMagicLink(email);
            const codeGroup = document.getElementById('auth-code-group');
            if (codeGroup) codeGroup.hidden = false;
            document.getElementById('auth-code')?.focus();
            this.setAuthStatus('Code gesendet. Öffne die Email und gib den 8-stelligen Code hier ein.');
        } catch (error) {
            this.setAuthStatus(error?.message || 'Anmeldecode konnte nicht gesendet werden.', true);
        } finally {
            if (button) button.disabled = false;
        }
    },

    async verifyAuthCode() {
        const email = document.getElementById('auth-email')?.value || '';
        const token = document.getElementById('auth-code')?.value || '';
        const button = document.getElementById('auth-verify-code');
        if (button) button.disabled = true;
        this.setAuthStatus('Code wird geprüft…');

        try {
            await window.FreshShiftSupabase.verifyEmailCode(email, token);
            this.setAuthStatus('Angemeldet. Daten werden geladen…');
        } catch (error) {
            this.setAuthStatus(error?.message || 'Code ist ungültig oder abgelaufen.', true);
        } finally {
            if (button) button.disabled = false;
        }
    },

    // ===========================
    // Event Bindings
    // ===========================
    bindEvents() {
        // Login Screen
        document.getElementById('auth-send-link').addEventListener('click', () => this.sendAuthLink());
        document.getElementById('auth-email').addEventListener('keypress', (event) => {
            if (event.key === 'Enter') this.sendAuthLink();
        });
        document.getElementById('auth-verify-code').addEventListener('click', () => this.verifyAuthCode());
        document.getElementById('auth-code').addEventListener('input', event => {
            event.target.value = event.target.value.replace(/\D/g, '').slice(0, 8);
        });
        document.getElementById('auth-code').addEventListener('keypress', event => {
            if (event.key === 'Enter') this.verifyAuthCode();
        });
        document.getElementById('auth-signout').addEventListener('click', () => this.logout());

        // Dashboard Menu
        document.getElementById('menu-toggle').addEventListener('click', () => this.toggleMenu());
        document.getElementById('menu-close').addEventListener('click', () => this.toggleMenu());
        document.getElementById('menu-overlay').addEventListener('click', () => this.toggleMenu());
        document.getElementById('menu-logout').addEventListener('click', () => this.logout());
        document.getElementById('switch-to-admin-view').addEventListener('click', () => this.switchView('admin'));
        
        // Dashboard Menu Items
        document.querySelectorAll('#side-menu .menu-item').forEach(item => {
            item.addEventListener('click', (e) => this.navigateTo(e.currentTarget.dataset.page));
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
        document.getElementById('download-team-pdf').addEventListener('click', () => this.downloadEmployeeSchedulePdf());
        document.getElementById('calendar-subscribe').addEventListener('click', () => this.createCalendarSubscription());
        document.getElementById('submit-plan-change-request').addEventListener('click', () => this.submitPlanChangeRequest());
        document.getElementById('copy-calendar-link').addEventListener('click', () => this.copyCalendarSubscriptionLink());
        document.getElementById('open-calendar-subscription').addEventListener('click', () => this.openCalendarSubscription());

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

        const togglePush = document.getElementById('toggle-push-notifications');
        if (togglePush) togglePush.addEventListener('click', () => this.togglePushNotifications());
        const employeeNotificationsRead = document.getElementById('employee-notifications-read');
        if (employeeNotificationsRead) employeeNotificationsRead.addEventListener('click', () => this.markEmployeeNotificationsRead());

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
        document.getElementById('switch-to-employee-view').addEventListener('click', () => this.switchView('employee'));
        document.getElementById('admin-menu-logout').addEventListener('click', () => this.adminLogout());
        
        // Admin Menu Items
        document.querySelectorAll('#admin-side-menu .menu-item').forEach(item => {
            item.addEventListener('click', (e) => this.navigateAdminTo(e.currentTarget.dataset.page));
        });

        // Admin Planner
        document.getElementById('admin-prev-week').addEventListener('click', () => this.changeWeek(-1, true));
        document.getElementById('admin-next-week').addEventListener('click', () => this.changeWeek(1, true));
        document.getElementById('save-schedule').addEventListener('click', () => this.saveSchedule());
         document.getElementById('release-schedule').addEventListener('click', () => this.releaseSchedule());
         document.getElementById('print-schedule').addEventListener('click', () => this.printSchedule());
        
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

        // Absences
        document.getElementById('save-absence').addEventListener('click', () => this.saveAbsence());
        document.getElementById('delete-absence').addEventListener('click', () => this.deleteAbsence());


        // Shift Modal
        document.getElementById('save-shift').addEventListener('click', () => this.saveShift());
        document.getElementById('remove-shift').addEventListener('click', () => this.removeShift());
        document.getElementById('open-shift').addEventListener('click', () => this.offerCurrentShift());

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
            const target = window.location.hash.replace('#', '');
            if (['schedule', 'availability', 'open-shifts', 'absences'].includes(target)) {
                window.setTimeout(() => this.navigateTo(target), 0);
            }
        } else if (screenId === 'admin-screen') {
            this.populateAdminStoreSelect();
            this.renderAdminDashboard();
        }
    },

    updateViewSwitchers(context = DataManager.getAuthContext?.()) {
        const canSwitch = context?.role === 'admin' && Boolean(context?.employee);
        const adminButton = document.getElementById('switch-to-admin-view');
        const employeeButton = document.getElementById('switch-to-employee-view');
        if (adminButton) adminButton.hidden = !canSwitch;
        if (employeeButton) employeeButton.hidden = !canSwitch;
    },

    switchView(view) {
        const context = DataManager.getAuthContext?.();
        if (context?.role !== 'admin' || !context?.employee) {
            this.showToast('Für dieses Konto ist keine zweite Ansicht verfügbar.', 'error');
            return;
        }

        document.getElementById('side-menu')?.classList.remove('active');
        document.getElementById('menu-overlay')?.classList.remove('active');
        document.getElementById('admin-side-menu')?.classList.remove('active');
        document.getElementById('admin-menu-overlay')?.classList.remove('active');

        this.currentUser = context.employee;
        localStorage.setItem('freshshift_view_mode', view);
        this.showScreen(view === 'employee' ? 'dashboard-screen' : 'admin-screen');
    },

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    },

    hideModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        this.currentEditCell = null;
        this.currentPlanChangeShift = null;
    },

    // ===========================
    // Dashboard Menu
    // ===========================
    toggleMenu() {
        document.getElementById('side-menu').classList.toggle('active');
        document.getElementById('menu-overlay').classList.toggle('active');
    },

    navigateTo(page) {
        document.getElementById('side-menu').classList.remove('active');
        document.getElementById('menu-overlay').classList.remove('active');
        
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
        } else if (page === 'open-shifts') {
            this.renderEmployeeWorkflows();
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
        } else if (page === 'admin-history') {
            this.renderShiftHistory();
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
        const label = document.getElementById('avail-week-label');
        const contextBadge = document.getElementById('avail-week-context');
        if (!label || !contextBadge) return;

        const context = this.getWeekContext(this.availWeek);
        label.textContent = display;
        contextBadge.textContent = context.label;
        contextBadge.className = `week-context-badge ${context.kind}`;
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
        html += '<th class="availability-reset-header">Test</th></tr></thead><tbody>';

        // Rows
        employees.forEach(emp => {
            const avail = availabilities.find(a => a.employeeId === emp.id);
            const generalNote = avail?.notes
                ? `<span class="availability-note">${this.escapeHtml(avail.notes)}</span>`
                : '';
            html += `<tr><td class="name-cell">${this.escapeHtml(emp.name)}${generalNote}</td>`;
            
            DateUtils.DAY_KEYS.forEach(dayKey => {
                const day = avail?.days?.[dayKey];
                if (day?.available && this.timeRange(day.start, day.end)) {
                    const dayNote = day.notes
                        ? `<span class="availability-note">${this.escapeHtml(day.notes)}</span>`
                        : '';
                    html += `<td class="available-cell"><span>${this.escapeHtml(day.start)}–${this.escapeHtml(day.end)}</span>${dayNote}</td>`;
                } else {
                    html += `<td class="unavailable-cell">–</td>`;
                }
            });
            html += `<td class="availability-reset-cell">${avail
                ? `<button type="button" class="btn btn-secondary btn-small" onclick="App.resetAvailability('${emp.id}', '${this.encodeActionData(emp.name)}')">Zurücksetzen</button>`
                : '<span class="muted">–</span>'}</td>`;
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
                    if (day?.available && this.timeRange(day.start, day.end)) {
                        return `<div class="avail-pill available"><span class="d">${label}</span><span class="t">${this.escapeHtml(day.start)}–${this.escapeHtml(day.end)}</span>${day.notes ? `<span class="n">${this.escapeHtml(day.notes)}</span>` : ''}</div>`;
                    }
                    return `<div class="avail-pill unavailable"><span class="d">${label}</span><span class="t">–</span></div>`;
                }).join('');

                return `
                    <div class="availability-card">
                        <div class="availability-card-header">
                            <div class="name">${this.escapeHtml(emp.name)}</div>
                            <div class="sub">${this.escapeHtml(DataManager.getStoreName(this.adminStore))} · ${DateUtils.formatWeekDisplay(this.availWeek)}</div>
                        </div>
                        ${avail?.notes ? `<div class="availability-general-note">${this.escapeHtml(avail.notes)}</div>` : ''}
                        <div class="availability-grid">${pills}</div>
                        ${avail ? `<button type="button" class="btn btn-secondary btn-small availability-reset-button" onclick="App.resetAvailability('${emp.id}', '${this.encodeActionData(emp.name)}')">Test-Eintrag zurücksetzen</button>` : ''}
                    </div>
                `;
            }).join('') || '<div class="empty-state">Keine Verfügbarkeiten</div>';
        }
    },

    async resetAvailability(employeeId, employeeNameEncoded) {
        const employeeName = decodeURIComponent(employeeNameEncoded || '') || this.getEmployeeName(employeeId);
        const weekLabel = DateUtils.formatWeekDisplay(this.availWeek);
        const storeName = DataManager.getStoreName(this.adminStore);
        const message = `Verfügbarkeit von ${employeeName} für ${weekLabel} bei ${storeName} zurücksetzen?\n\nDer eingetragene Test-Eintrag wird gelöscht. Der Mitarbeiter kann ihn danach neu eingeben.`;
        if (!confirm(message)) return;

        try {
            await DataManager.resetAvailability(employeeId, DateUtils.getWeekKey(this.availWeek), this.adminStore);
            this.renderAdminAvailability();
            this.renderAdminDashboard();
            this.showToast(`Verfügbarkeit von ${employeeName} zurückgesetzt.`, 'success');
        } catch (error) {
            this.showToast(error?.message || 'Verfügbarkeit konnte nicht zurückgesetzt werden.', 'error');
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
            storeEl.innerHTML = stores.map(s => `<span class="store-chip">${this.escapeHtml(DataManager.getStoreName(s))}</span>`).join('');
        }
        
        // Render all dashboard components
        this.renderTodayShift();
        this.renderShiftRequests();
        this.renderMonthlyEarnings();
        this.renderWeekOverview();
        this.renderUpcomingShifts();
        this.renderEmployeeNotifications();
        this.renderNotificationSettings();
        this.updateWeekDisplay();
    },

    normalizePhone(value) {
        const compact = String(value || '').replace(/[\s()\-]/g, '');
        if (!compact) return '';
        if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
        if (compact.startsWith('00')) return `+${compact.slice(2).replace(/\D/g, '')}`;
        if (compact.startsWith('0')) return `+49${compact.slice(1).replace(/\D/g, '')}`;
        return `+${compact.replace(/\D/g, '')}`;
    },

    renderNotificationSettings() {
        const status = document.getElementById('push-status');
        const button = document.getElementById('toggle-push-notifications');
        const card = document.querySelector('.notification-settings-card');
        if (!status || !button || !card || !this.currentUser) return;

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            card.hidden = false;
            status.textContent = 'Nicht unterstützt';
            button.disabled = true;
            button.textContent = 'Push nicht verfügbar';
            return;
        }

        navigator.serviceWorker.ready
            .then(registration => registration.pushManager.getSubscription())
            .then(subscription => {
                const active = Boolean(subscription);
                card.hidden = active;
                status.textContent = active ? 'Push aktiv' : 'Nicht aktiv';
                status.classList.toggle('push-active', active);
                button.disabled = false;
                button.textContent = active ? 'Push deaktivieren' : 'Push aktivieren';
            })
            .catch(() => {
                card.hidden = false;
                status.textContent = 'Status unbekannt';
            });
    },

    urlBase64ToUint8Array(value) {
        const padding = '='.repeat((4 - value.length % 4) % 4);
        const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
    },

    async togglePushNotifications() {
        const button = document.getElementById('toggle-push-notifications');
        if (button) button.disabled = true;
        try {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                throw new Error('Push-Benachrichtigungen werden auf diesem Gerät nicht unterstützt.');
            }
            const registration = await navigator.serviceWorker.ready;
            const existing = await registration.pushManager.getSubscription();
            if (existing) {
                const endpoint = existing.endpoint;
                await existing.unsubscribe();
                await DataManager.removePushSubscription(endpoint);
                this.showToast('Push-Benachrichtigungen deaktiviert.', 'success');
            } else {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    throw new Error('Benachrichtigungen wurden nicht erlaubt.');
                }
                const publicKey = window.FRESHSHIFT_VAPID_PUBLIC_KEY || '';
                if (!publicKey) throw new Error('Push ist noch nicht eingerichtet.');
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this.urlBase64ToUint8Array(publicKey)
                });
                await DataManager.savePushSubscription(subscription);
                this.showToast('Push-Benachrichtigungen aktiviert.', 'success');
            }
            this.renderNotificationSettings();
        } catch (error) {
            this.showToast(error?.message || 'Push konnte nicht geändert werden.', 'error');
            this.renderNotificationSettings();
        }
    },

    renderEmployeeNotifications() {
        const card = document.getElementById('employee-notifications-card');
        const list = document.getElementById('employee-notifications-list');
        if (!card || !list || !this.currentUser) return;
        const notifications = (DataManager.getNotifications?.() || [])
            .filter(item => item.targetEmployeeId === this.currentUser.id && !item.read)
            .slice(0, 8);
        card.style.display = notifications.length > 0 ? 'block' : 'none';
        list.innerHTML = notifications.map(item => `
            <div class="workflow-item">
                <div>
                    <div class="workflow-title">${this.escapeHtml(item.message || 'Neue Mitteilung')}</div>
                    <div class="workflow-meta">${this.formatTimestamp(item.timestamp)}</div>
                </div>
            </div>
        `).join('');
    },

    async markEmployeeNotificationsRead() {
        if (!this.currentUser) return;
        const unread = (DataManager.getNotifications?.() || [])
            .filter(item => item.targetEmployeeId === this.currentUser.id && !item.read);
        try {
            await Promise.all(unread.map(item => DataManager.markNotificationRead(item.id)));
            this.renderEmployeeNotifications();
        } catch (error) {
            this.showToast(error?.message || 'Mitteilungen konnten nicht aktualisiert werden.', 'error');
        }
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
                    <div class="shift-duration">${DateUtils.formatDuration(hours)} · ${this.escapeHtml(DataManager.getStoreName(storeId))}${shift.requestStatus === 'pending' ? ' · Anfrage' : ''}</div>
                `;
            } else {
                container.innerHTML = myShifts.map(({ storeId, shift }) => {
                    const hours = DateUtils.calculateDuration(shift.start, shift.end);
                    return `<div class="today-multi-shift"><strong>${this.escapeHtml(DataManager.getStoreName(storeId))}:</strong> ${shift.start} – ${shift.end} <span class="muted">(${DateUtils.formatDuration(hours)})</span></div>`;
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

            const payload = this.encodeActionData(JSON.stringify({
                storeId: req.storeId,
                weekKey: req.weekKey,
                dayKey: req.dayKey,
                employeeId: this.currentUser.id
            }));

            return `
                <div class="request-item">
                    <div>
                        <div class="request-title">${this.escapeHtml(storeName)}</div>
                        <div class="request-sub">${DateUtils.DAYS_SHORT[req.dayIndex]} · ${dateText} · ${timeText}</div>
                        <div class="request-badge">⏳ Anfrage offen</div>
                    </div>
                    <div class="request-actions">
                        <button class="btn btn-success btn-small" onclick="App.acceptShiftRequest('${payload}')">Annehmen</button>
                        <button class="btn btn-danger btn-small" onclick="App.openDeclineShiftRequest('${payload}', '${this.encodeActionData(summary)}')">Ablehnen</button>
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

    timeRange(start, end) {
        const parse = value => {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))) return null;
            const [hours, minutes] = value.split(':').map(Number);
            return (hours * 60) + minutes;
        };
        const startMinutes = parse(start);
        let endMinutes = parse(end);
        if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return null;
        if (endMinutes < startMinutes) endMinutes += 24 * 60;
        return { start: startMinutes, end: endMinutes };
    },

    timeRangesOverlap(first, second) {
        if (!first || !second) return false;
        const variants = [second, { start: second.start + 1440, end: second.end + 1440 }];
        return variants.some(candidate => first.start < candidate.end && candidate.start < first.end);
    },

    isShiftWithinAvailability(start, end, availability) {
        if (!availability?.available) return false;
        const shiftRange = this.timeRange(start, end);
        const availabilityRange = this.timeRange(availability.start, availability.end);
        if (!shiftRange || !availabilityRange) return false;
        return shiftRange.start >= availabilityRange.start && shiftRange.end <= availabilityRange.end;
    },

    validateScheduleForRelease(schedule, storeId, weekDate = this.currentWeek) {
        const errors = [];
        const warnings = [];
        const dates = DateUtils.getWeekDates(weekDate);
        const weekKey = DateUtils.getWeekKey(weekDate);
        const shifts = Object.values(schedule?.shifts || {}).flat();

        if (shifts.length === 0) {
            errors.push('Der Plan enthält keine Schichten.');
        }

        DateUtils.DAY_KEYS.forEach((dayKey, dayIndex) => {
            const dayShifts = schedule?.shifts?.[dayKey] || [];
            dayShifts.forEach(shift => {
                const employee = DataManager.getEmployee(shift.employeeId);
                const name = employee?.name || 'Unbekannter Mitarbeiter';
                const shiftRange = this.timeRange(shift.start, shift.end);

                if (!employee?.active) {
                    errors.push(`${name} ist nicht mehr aktiv.`);
                }
                if (!shiftRange) {
                    errors.push(`${name} hat am ${DateUtils.DAYS_SHORT[dayIndex]} ungültige Zeiten.`);
                }
                if (DataManager.getEmployeeAbsenceForDate(shift.employeeId, dates[dayIndex])) {
                    errors.push(`${name} ist am ${DateUtils.DAYS_SHORT[dayIndex]} als abwesend eingetragen.`);
                }
                if (shift.requestStatus === 'pending') {
                    errors.push(`${name}: Die Schichtanfrage am ${DateUtils.DAYS_SHORT[dayIndex]} ist noch offen.`);
                } else if (shift.requestStatus === 'declined') {
                    errors.push(`${name}: Die Schicht am ${DateUtils.DAYS_SHORT[dayIndex]} wurde abgelehnt.`);
                } else if (shift.requestStatus !== 'accepted') {
                    const availability = DataManager.getEmployeeAvailability(shift.employeeId, weekKey, storeId)
                        ?.days?.[dayKey];
                    if (!this.isShiftWithinAvailability(shift.start, shift.end, availability)) {
                        warnings.push(`${name}: ${DateUtils.DAYS_SHORT[dayIndex]} liegt außerhalb der Verfügbarkeit.`);
                    }
                }

                DataManager.getSchedules()
                    .filter(other => other.weekKey === weekKey && other.storeId !== storeId)
                    .forEach(other => {
                        (other.shifts?.[dayKey] || [])
                            .filter(otherShift => otherShift.employeeId === shift.employeeId && otherShift.requestStatus !== 'declined')
                            .forEach(otherShift => {
                                if (this.timeRangesOverlap(shiftRange, this.timeRange(otherShift.start, otherShift.end))) {
                                    errors.push(`${name} ist am ${DateUtils.DAYS_SHORT[dayIndex]} gleichzeitig bei ${DataManager.getStoreName(other.storeId)} eingeplant.`);
                                }
                            });
                    });
            });
        });

        return {
            errors: [...new Set(errors)],
            warnings: [...new Set(warnings)]
        };
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
                    <span>${this.escapeHtml(DataManager.getStoreName(x.storeId))}</span>
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

    async acceptShiftRequest(payload) {
        try {
            const data = JSON.parse(decodeURIComponent(payload));
            await this.respondShiftRequest(data, 'accepted', null);
            this.showToast('Schichtanfrage angenommen.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Schichtanfrage konnte nicht verarbeitet werden.', 'error');
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

    async submitShiftRequestDecline() {
        const reason = document.getElementById('shift-request-reason')?.value?.trim() || '';
        if (!reason) {
            this.showToast('Bitte einen Grund eingeben.', 'error');
            return;
        }
        if (!this.pendingShiftRequest) return;
        try {
            await this.respondShiftRequest(this.pendingShiftRequest, 'declined', reason);
            this.pendingShiftRequest = null;
            this.hideModals();
            this.showToast('Schichtanfrage abgelehnt.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Schichtanfrage konnte nicht verarbeitet werden.', 'error');
        }
    },

    async respondShiftRequest({ storeId, weekKey, dayKey, employeeId }, status, reason) {
        const schedule = DataManager.getScheduleForWeek(weekKey, storeId);
        const dayShifts = schedule?.shifts?.[dayKey] || [];
        const shift = dayShifts.find(s => s.employeeId === employeeId && s.requestStatus === 'pending');
        if (!schedule || !shift) {
            this.showToast('Anfrage nicht mehr verfügbar.', 'error');
            return;
        }

        await DataManager.respondToShiftRequest(shift.id, status, reason);

        // Re-render UI
        this.renderShiftRequests();
        this.renderMyScheduleSection();
        this.renderDashboard();
    },

    pendingShiftRequest: null,

    async approveAbsenceRequest(payload) {
        try {
            const { notificationId, absenceId } = JSON.parse(decodeURIComponent(payload));
            const absence = DataManager.getAbsence(absenceId);
            if (!absence) {
                this.showToast('Anfrage nicht mehr verfügbar.', 'error');
                return;
            }

            await DataManager.updateAbsence({
                id: absenceId,
                status: 'approved',
                respondedAt: new Date().toISOString(),
                responseReason: null
            });

            await DataManager.markNotificationRead(notificationId);
            this.updateAdminNotifications();
            this.renderAbsencesOverview();
            this.renderScheduleEditor();

            this.showToast('Urlaubsanfrage genehmigt.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Anfrage konnte nicht verarbeitet werden.', 'error');
        }
    },

    async denyAbsenceRequest(payload) {
        try {
            const { notificationId, absenceId } = JSON.parse(decodeURIComponent(payload));
            const absence = DataManager.getAbsence(absenceId);
            if (!absence) {
                this.showToast('Anfrage nicht mehr verfügbar.', 'error');
                return;
            }

            const reason = (prompt('Grund für Ablehnung (optional):', '') || '').trim().slice(0, 2000);

            await DataManager.updateAbsence({
                id: absenceId,
                status: 'declined',
                respondedAt: new Date().toISOString(),
                responseReason: reason || null
            });

            await DataManager.markNotificationRead(notificationId);
            this.updateAdminNotifications();
            this.renderAbsencesOverview();

            this.showToast('Urlaubsanfrage abgelehnt.', 'warning');
        } catch (error) {
            this.showToast(error?.message || 'Anfrage konnte nicht verarbeitet werden.', 'error');
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
            const statusLabel = status === 'pending' ? 'Wartet'
                : status === 'declined' ? 'Abgelehnt'
                    : status === 'cancelled' ? 'Storniert' : 'Bestätigt';

            const statusPill = `<span class="absence-pill ${status}">${statusLabel}</span>`;
            const reason = a.responseReason ? `<div class="absence-note">Grund: ${this.escapeHtml(a.responseReason)}</div>` : '';
            const auStatus = a.type === 'krank'
                ? a.auStatus === 'verified'
                    ? '<span class="au-pill verified">eAU bestätigt</span>'
                    : a.auStatus === 'pending'
                        ? '<span class="au-pill pending">eAU-Prüfung ausstehend</span>'
                        : '<span class="au-pill not-required">Aktuell keine eAU erforderlich</span>'
                : '';

            const canCancel = ['pending', 'approved'].includes(status)
                && String(a.endDate) >= DateUtils.formatDateKey(new Date());

            return `
                <div class="absence-item ${status === 'pending' ? 'absence-active' : ''}">
                    <span class="absence-icon">${typeIcon}</span>
                    <div class="absence-info">
                        <div class="absence-name">${typeLabel} ${statusPill}</div>
                        <div class="absence-dates">${dateText}</div>
                        ${a.note ? `<div class="absence-note">${this.escapeHtml(a.note)}</div>` : ''}
                        ${reason}
                        ${auStatus}
                        ${canCancel ? `
                            <div class="absence-actions">
                                <button class="btn btn-danger btn-small" onclick="App.cancelOwnAbsence('${a.id}')">Abwesenheit stornieren</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    async cancelOwnAbsence(absenceId) {
        const absence = DataManager.getAbsence(absenceId);
        if (!absence) return;
        const warning = absence.status === 'approved'
            ? '\n\nBereits entfernte Schichten werden nicht automatisch wiederhergestellt. Die Admins erhalten eine Meldung und müssen den Plan prüfen.'
            : '';
        if (!confirm(`Abwesenheit wirklich stornieren?${warning}`)) return;

        try {
            await DataManager.cancelOwnAbsence(absenceId);
            this.renderEmployeeAbsencesPage();
            this.renderDashboard();
            this.showToast('Abwesenheit storniert. Die Admins wurden informiert.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Abwesenheit konnte nicht storniert werden.', 'error');
        }
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
                            <input type="time" id="def_${dayKey}_start" value="${this.escapeHtml(start)}" step="60" class="time-input-24h" />
                        </div>
                        <div class="form-group">
                            <label>Bis</label>
                            <input type="time" id="def_${dayKey}_end" value="${this.escapeHtml(end)}" step="60" class="time-input-24h" />
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        this.showModal('default-availability-modal');
    },

    async saveDefaultAvailability() {
        const employeeId = this.currentDefaultAvailabilityEmployeeId;
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;

        const storeId = this.adminStore;
        const days = {};
        let validationMessage = null;

        DateUtils.DAY_KEYS.forEach(dayKey => {
            const available = document.getElementById(`def_${dayKey}_available`)?.checked || false;
            const start = available ? (document.getElementById(`def_${dayKey}_start`)?.value || '') : null;
            const end = available ? (document.getElementById(`def_${dayKey}_end`)?.value || '') : null;
            if (available && (!start || !end || start === end)) {
                validationMessage = `${DateUtils.DAYS[DateUtils.DAY_KEYS.indexOf(dayKey)]}: Bitte gültige, unterschiedliche Zeiten eingeben.`;
            }
            days[dayKey] = {
                available,
                start,
                end
            };
        });

        if (validationMessage) {
            this.showToast(validationMessage, 'error');
            return;
        }

        const merged = {
            ...(employee.defaultAvailability || {}),
            [storeId]: {
                days,
                updatedAt: new Date().toISOString()
            }
        };

        try {
            await DataManager.updateEmployee({ id: employeeId, defaultAvailability: merged });
            this.hideModals();
            this.renderEmployeesTab();
            this.showToast('Standardverfügbarkeit gespeichert!', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Standardverfügbarkeit konnte nicht gespeichert werden.', 'error');
        }
    },

    async clearDefaultAvailability() {
        const employeeId = this.currentDefaultAvailabilityEmployeeId;
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;

        const storeId = this.adminStore;
        const merged = { ...(employee.defaultAvailability || {}) };
        delete merged[storeId];

        try {
            await DataManager.updateEmployee({ id: employeeId, defaultAvailability: merged });
            this.hideModals();
            this.renderEmployeesTab();
            this.showToast('Standardverfügbarkeit entfernt.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Standardverfügbarkeit konnte nicht entfernt werden.', 'error');
        }
    },

    currentDefaultAvailabilityEmployeeId: null,

    async openInviteEmployee(employeeId, employeeNameEncoded) {
        const id = String(employeeId || '').trim();
        const employeeName = decodeURIComponent(employeeNameEncoded || '').trim();
        if (!id || !employeeName) return;

        const currentEmail = DataManager.getEmployee(id)?.email || '';
        const email = (prompt(`Email für ${employeeName}:`, currentEmail) || '').trim().toLowerCase();
        if (!email) return;
        if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            this.showToast('Bitte eine gültige Email-Adresse eingeben.', 'error');
            return;
        }

        try {
            await window.FreshShiftSupabase.invoke('invite-employee', {
                employeeId: id,
                employeeName,
                email,
                redirectTo: window.location.origin + window.location.pathname
            });
            await DataManager.reloadCloudData();
            this.renderEmployeesTab();
            this.showToast(`Einladung gesendet an ${email}`, 'success');
        } catch (e) {
            const msg = e?.message || 'Invite fehlgeschlagen';
            this.showToast(msg === 'Failed to fetch' ? 'Invite fehlgeschlagen (Netzwerk/CORS).' : msg, 'error');
        }
    },

    async openUpdateEmployeeEmail(employeeId, employeeNameEncoded) {
        const employee = DataManager.getEmployee(employeeId);
        const employeeName = decodeURIComponent(employeeNameEncoded || '') || employee?.name;
        if (!employee?.profileId || !employeeName) return;

        const previousEmail = String(employee.email || '').trim().toLowerCase();
        const email = (prompt(`Email für ${employeeName} korrigieren:`, previousEmail) || '').trim().toLowerCase();
        if (!email || email === previousEmail) return;
        if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            this.showToast('Bitte eine gültige Email-Adresse eingeben.', 'error');
            return;
        }

        const message = `Email von ${employeeName} ändern?\n\nAlt: ${previousEmail}\nNeu: ${email}\n\nDie alte Adresse kann danach nicht mehr zur Anmeldung verwendet werden. An die neue Adresse wird ein frischer Anmeldecode gesendet.`;
        if (!confirm(message)) return;

        try {
            const result = await DataManager.updateEmployeeEmail(employee.id, email, previousEmail);
            this.renderEmployeesTab();
            this.renderAdminDashboard();
            this.showToast(result?.loginEmailSent
                ? `Email geändert. Anmeldecode wurde an ${email} gesendet.`
                : `Email geändert. ${employeeName} kann jetzt selbst einen Anmeldecode anfordern.`, 'success');
        } catch (error) {
            this.showToast(error?.message || 'Email konnte nicht geändert werden.', 'error');
        }
    },

    openAbsenceRequestModal() {
        if (!this.currentUser) return;

        const today = DateUtils.formatDateKey(new Date());
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

    async submitAbsenceRequest() {
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

        try {
            await DataManager.addAbsence({
                employeeId: this.currentUser.id,
                storeId: this.employeeStore,
                startDate,
                endDate,
                type,
                note: note || null,
                status,
                requestedBy: 'employee',
                requestedAt: new Date().toISOString()
            });

            this.hideModals();
            this.renderEmployeeAbsencesPage();
            this.showToast(type === 'krank' ? 'Krankheit gemeldet.' : 'Urlaubsanfrage gesendet.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Abwesenheit konnte nicht gesendet werden.', 'error');
        }
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
                        <div class="duration">${DateUtils.formatDuration(hours)} · ${this.escapeHtml(DataManager.getStoreName(item.storeId))}</div>
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

        // Render shared multi-admin history
        this.renderAdminActivity();

        this.renderAdminWorkflows();
    },

    renderAdminActivity() {
        const container = document.getElementById('admin-activity-list');
        if (!container) return;

        const activity = DataManager.getActivity?.() || [];
        if (activity.length === 0) {
            container.innerHTML = '<div class="empty-state small">Noch keine gemeinsamen Änderungen</div>';
            return;
        }

        const labels = {
            schedule_saved: ['💾', 'hat einen Wochenplan gespeichert'],
            schedule_released: ['✅', 'hat einen Wochenplan freigegeben'],
            shift_response: ['↔️', 'hat auf eine Schichtanfrage geantwortet'],
            absence_approved: ['📅', 'hat eine Abwesenheit bestätigt'],
            absence_schedule_cleanup: ['🧹', 'Schichten wurden wegen Abwesenheit entfernt'],
            absence_cancelled: ['↩️', 'hat eine Abwesenheit storniert'],
            au_status_changed: ['🩺', 'hat den eAU-Status geändert'],
            employee_terminated: ['🚫', 'hat einen Mitarbeiter entlassen'],
            availability_reset: ['🧪', 'hat eine Test-Verfügbarkeit zurückgesetzt'],
            employee_email_updated: ['✉️', 'hat eine Mitarbeiter-Email korrigiert'],
            plan_change_reviewed: ['🕒', 'hat eine Planänderung bearbeitet']
        };

        container.innerHTML = activity.slice(0, 12).map(item => {
            const [icon, label] = labels[item.action] || ['•', 'hat Daten geändert'];
            const store = item.storeId ? ` · ${this.escapeHtml(DataManager.getStoreName(item.storeId))}` : '';
            const week = item.weekKey ? ` · ${this.escapeHtml(item.weekKey.replace('-W', ' KW '))}` : '';
            return `
                <div class="activity-item">
                    <span class="activity-icon">${icon}</span>
                    <div>
                        <div class="activity-title"><strong>${this.escapeHtml(item.actorName)}</strong> ${label}</div>
                        <div class="activity-meta">${this.formatTimestamp(item.timestamp)}${store}${week}</div>
                    </div>
                </div>
            `;
        }).join('');
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
            return a.status === 'approved' && endDate >= today && startDate <= futureDate;
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
            
            const dateText = absence.startDate === absence.endDate
                ? DateUtils.formatDate(startDate)
                : `${DateUtils.formatDate(startDate)} – ${DateUtils.formatDate(endDate)}`;

            const auBadge = absence.type === 'krank' && absence.auStatus === 'pending'
                ? '<span class="au-pill pending">eAU offen</span>'
                : absence.type === 'krank' && absence.auStatus === 'verified'
                    ? '<span class="au-pill verified">eAU bestätigt</span>'
                    : '';
            
            return `
                <div class="admin-absence-item ${isActive ? 'active' : ''}">
                    <span class="absence-icon">${typeIcon}</span>
                    <span class="absence-employee">${this.escapeHtml(employee?.name || 'Unbekannt')}</span>
                    <span class="absence-date">${dateText}</span>
                    ${auBadge}
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
                <div>
                    <span class="employee-name">${this.escapeHtml(emp.name)}</span>
                    <span class="missing-label">Noch nicht eingereicht · Push</span>
                </div>
                <button class="btn btn-primary btn-small" onclick="App.sendAvailabilityReminder('${emp.id}', '${nextWeekKey}')">
                    Erinnern
                </button>
            </div>
        `).join('');
    },

    async sendAvailabilityReminder(employeeId, weekKey) {
        const employee = DataManager.getEmployee(employeeId);
        try {
            await DataManager.sendAvailabilityReminder(employeeId, this.adminStore, weekKey);
            this.showToast(`${employee?.name || 'Mitarbeiter'} wurde erinnert.`, 'success');
        } catch (error) {
            this.showToast(error?.message || 'Erinnerung konnte nicht gesendet werden.', 'error');
        }
    },

    getWorkflowDate(weekKey, dayKey) {
        const match = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
        if (!match) return null;
        const monday = DataManager.getDateFromWeek(Number(match[1]), Number(match[2]));
        const dayIndex = DateUtils.DAY_KEYS.indexOf(dayKey);
        if (dayIndex < 0) return null;
        const date = new Date(monday);
        date.setDate(monday.getDate() + dayIndex);
        return date;
    },

    workflowSummary(item) {
        const date = this.getWorkflowDate(item.weekKey, item.dayKey);
        const dayIndex = DateUtils.DAY_KEYS.indexOf(item.dayKey);
        const day = dayIndex >= 0 ? DateUtils.DAYS_SHORT[dayIndex] : item.dayKey;
        return `${DataManager.getStoreName(item.storeId)} · ${day}${date ? ` ${DateUtils.formatDate(date)}` : ''} · ${item.start || ''}–${item.end || ''}`;
    },

    isCurrentEmployeeAvailableForWorkflow(item) {
        if (!this.currentUser || !item?.weekKey || !item?.dayKey || !item?.start || !item?.end) return false;
        const availability = DataManager.getEmployeeAvailability(
            this.currentUser.id,
            item.weekKey,
            item.storeId
        );
        const day = availability?.days?.[item.dayKey];
        const availableRange = day?.available ? this.timeRange(day.start, day.end) : null;
        const shiftRange = this.timeRange(item.start, item.end);
        return Boolean(availableRange && shiftRange
            && availableRange.start <= shiftRange.start
            && availableRange.end >= shiftRange.end);
    },

    renderEmployeeWorkflows() {
        const openContainer = document.getElementById('open-shifts-list');
        const swapContainer = document.getElementById('swap-requests-list');
        if (!openContainer || !swapContainer || !this.currentUser) return;
        const stores = this.getUserStores();
        const currentId = this.currentUser.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const openShifts = (DataManager.getOpenShifts?.() || []).filter(item => {
            const involved = item.originalEmployeeId === currentId || item.claimedByEmployeeId === currentId;
            return stores.includes(item.storeId)
                && ['open', 'claimed'].includes(item.status)
                && (involved || this.isCurrentEmployeeAvailableForWorkflow(item))
                && (!this.getWorkflowDate(item.weekKey, item.dayKey) || this.getWorkflowDate(item.weekKey, item.dayKey) >= today);
        });
        openContainer.innerHTML = openShifts.length ? openShifts.map(item => {
            const mine = item.claimedByEmployeeId === currentId;
            const available = item.status === 'open' && item.originalEmployeeId !== currentId;
            return `
                <div class="workflow-item">
                    <div>
                        <div class="workflow-title">${this.escapeHtml(this.workflowSummary(item))}</div>
                        ${item.reason ? `<div class="workflow-meta">${this.escapeHtml(item.reason)}</div>` : ''}
                    </div>
                    ${mine ? '<span class="absence-pill pending">Wartet auf Admin</span>' : ''}
                    ${available ? `<button class="btn btn-success btn-small" onclick="App.claimOpenShift('${item.id}')">Übernehmen</button>` : ''}
                </div>
            `;
        }).join('') : '<div class="empty-state small">Keine offenen Schichten</div>';

        const swaps = (DataManager.getShiftSwaps?.() || []).map(item => {
            const shift = DataManager.getSchedules().flatMap(schedule => Object.values(schedule.shifts || {}).flat())
                .find(candidate => candidate.id === item.shiftId);
            return { ...item, start: shift?.start || '', end: shift?.end || '' };
        }).filter(item => {
            const involved = item.requestedByEmployeeId === currentId || item.claimedByEmployeeId === currentId;
            return stores.includes(item.storeId) && ['open', 'claimed'].includes(item.status)
                && (involved || this.isCurrentEmployeeAvailableForWorkflow(item));
        });
        swapContainer.innerHTML = swaps.length ? swaps.map(item => {
            const requester = item.requestedByEmployeeId === currentId;
            const claimant = item.claimedByEmployeeId === currentId;
            return `
                <div class="workflow-item">
                    <div>
                        <div class="workflow-title">${this.escapeHtml(this.workflowSummary(item))}</div>
                        <div class="workflow-meta">${requester ? 'Deine Tauschanfrage' : `${this.escapeHtml(this.getEmployeeName(item.requestedByEmployeeId))} sucht Ersatz`}</div>
                        ${item.reason ? `<div class="workflow-meta">${this.escapeHtml(item.reason)}</div>` : ''}
                    </div>
                    ${requester ? `<button class="btn btn-danger btn-small" onclick="App.cancelShiftSwap('${item.id}')">Stornieren</button>` : ''}
                    ${claimant ? '<span class="absence-pill pending">Wartet auf Admin</span>' : ''}
                    ${!requester && !claimant && item.status === 'open' ? `<button class="btn btn-success btn-small" onclick="App.claimShiftSwap('${item.id}')">Übernehmen</button>` : ''}
                </div>
            `;
        }).join('') : '<div class="empty-state small">Keine Tauschanfragen</div>';
    },

    async createShiftSwap(shiftId) {
        const reason = prompt('Warum möchtest du diese Schicht abgeben? (optional)', '') ?? null;
        if (reason === null) return;
        try {
            await DataManager.createShiftSwap(shiftId, reason);
            this.renderMyScheduleSection();
            this.showToast('Tauschanfrage veröffentlicht.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Tauschanfrage konnte nicht erstellt werden.', 'error');
        }
    },

    async claimShiftSwap(requestId) {
        if (!confirm('Möchtest du diese Schicht übernehmen? Ein Admin muss noch zustimmen.')) return;
        try {
            await DataManager.claimShiftSwap(requestId);
            this.renderEmployeeWorkflows();
            this.showToast('Übernahme angefragt.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Übernahme war nicht möglich.', 'error');
        }
    },

    async cancelShiftSwap(requestId) {
        if (!confirm('Tauschanfrage wirklich stornieren?')) return;
        try {
            await DataManager.cancelShiftSwap(requestId);
            this.renderEmployeeWorkflows();
            this.renderMyScheduleSection();
            this.showToast('Tauschanfrage storniert.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Tauschanfrage konnte nicht storniert werden.', 'error');
        }
    },

    async claimOpenShift(openShiftId) {
        if (!confirm('Möchtest du dich für diese offene Schicht melden?')) return;
        try {
            await DataManager.claimOpenShift(openShiftId);
            this.renderEmployeeWorkflows();
            this.showToast('Übernahme angefragt.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Übernahme war nicht möglich.', 'error');
        }
    },

    openPlanChangeRequest(shiftId) {
        const shift = DataManager.getSchedules().flatMap(schedule => Object.values(schedule.shifts || {}).flat())
            .find(item => item.id === shiftId && item.employeeId === this.currentUser?.id);
        if (!shift) {
            this.showToast('Schicht wurde nicht gefunden. Bitte neu laden.', 'error');
            return;
        }
        this.currentPlanChangeShift = shift;
        document.getElementById('plan-change-start').value = shift.start;
        document.getElementById('plan-change-end').value = shift.end;
        document.getElementById('plan-change-reason').value = '';
        document.getElementById('plan-change-request-summary').textContent =
            `Deine aktuelle Schicht ist ${shift.start}–${shift.end}.`;
        this.showModal('plan-change-request-modal');
    },

    async submitPlanChangeRequest() {
        const shift = this.currentPlanChangeShift;
        const requestedStart = document.getElementById('plan-change-start').value;
        const requestedEnd = document.getElementById('plan-change-end').value;
        const reason = document.getElementById('plan-change-reason').value.trim();
        if (!shift || !requestedStart || !requestedEnd || requestedStart === requestedEnd) {
            this.showToast('Bitte gib unterschiedliche Start- und Endzeiten ein.', 'error');
            return;
        }
        try {
            await DataManager.createShiftChangeRequest(shift.id, requestedStart, requestedEnd, reason);
            this.hideModals();
            this.renderMyScheduleSection();
            this.showToast('Planänderung wurde an die Geschäftsleitung gesendet.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Planänderung konnte nicht angefragt werden.', 'error');
        }
    },

    async cancelPlanChangeRequest(requestId) {
        if (!confirm('Möchtest du diese Planänderungsanfrage zurückziehen?')) return;
        try {
            await DataManager.cancelShiftChangeRequest(requestId);
            this.renderMyScheduleSection();
            this.showToast('Planänderungsanfrage zurückgezogen.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Anfrage konnte nicht zurückgezogen werden.', 'error');
        }
    },

    async createCalendarSubscription() {
        if (!confirm('Ein neuer Kalender-Link macht einen alten Link sofort ungültig. Nur fortfahren, wenn du ihn jetzt abonnieren möchtest.')) return;
        try {
            this.calendarSubscriptionUrl = await DataManager.rotateMyCalendarSubscription();
            document.getElementById('calendar-subscription-url').value = this.calendarSubscriptionUrl;
            this.showModal('calendar-subscription-modal');
        } catch (error) {
            this.showToast(error?.message || 'Kalender-Link konnte nicht erstellt werden.', 'error');
        }
    },

    async copyCalendarSubscriptionLink() {
        const input = document.getElementById('calendar-subscription-url');
        const url = this.calendarSubscriptionUrl || input?.value;
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            this.showToast('Kalender-Link kopiert.', 'success');
        } catch {
            input?.select();
            this.showToast('Link markiert. Bitte kopiere ihn manuell.', 'info');
        }
    },

    openCalendarSubscription() {
        if (!this.calendarSubscriptionUrl) return;
        const webcalUrl = this.calendarSubscriptionUrl.replace(/^https?:\/\//, 'webcal://');
        window.location.assign(webcalUrl);
    },

    renderAdminWorkflows() {
        const container = document.getElementById('admin-workflow-list');
        const badge = document.getElementById('workflow-count');
        if (!container || !badge) return;
        const openClaims = (DataManager.getOpenShifts?.() || []).filter(item =>
            item.storeId === this.adminStore && item.status === 'claimed');
        const swapClaims = (DataManager.getShiftSwaps?.() || []).filter(item =>
            item.storeId === this.adminStore && item.status === 'claimed');
        const planChanges = (DataManager.getShiftChangeRequests?.() || []).filter(item =>
            item.storeId === this.adminStore && item.status === 'pending');
        const items = [
            ...openClaims.map(item => ({ kind: 'open', item })),
            ...swapClaims.map(item => ({ kind: 'swap', item })),
            ...planChanges.map(item => ({ kind: 'plan-change', item: {
                ...item,
                start: item.originalStart,
                end: item.originalEnd
            } }))
        ];
        badge.textContent = String(items.length);
        container.innerHTML = items.length ? items.map(({ kind, item }) => {
            const claimant = kind === 'plan-change'
                ? this.getEmployeeName(item.employeeId)
                : this.getEmployeeName(item.claimedByEmployeeId);
            let display = item;
            if (kind === 'swap') {
                const shift = DataManager.getSchedules().flatMap(schedule => Object.values(schedule.shifts || {}).flat())
                    .find(candidate => candidate.id === item.shiftId);
                display = { ...item, start: shift?.start || '', end: shift?.end || '' };
            }
            return `
                <div class="workflow-item">
                    <div>
                        <div class="workflow-title">${kind === 'open' ? 'Offene Schicht' : kind === 'swap' ? 'Tauschanfrage' : 'Planänderung'} · ${this.escapeHtml(this.workflowSummary(display))}</div>
                        <div class="workflow-meta">${kind === 'plan-change'
                            ? `${this.escapeHtml(claimant)}: ${this.escapeHtml(item.originalStart)}–${this.escapeHtml(item.originalEnd)} → ${this.escapeHtml(item.requestedStart)}–${this.escapeHtml(item.requestedEnd)}`
                            : `${this.escapeHtml(claimant)} möchte übernehmen`}</div>
                        ${kind === 'plan-change' && item.reason ? `<div class="workflow-meta">${this.escapeHtml(item.reason)}</div>` : ''}
                    </div>
                    <div class="request-actions">
                        <button class="btn btn-success btn-small" onclick="App.reviewWorkflow('${kind}', '${item.id}', true)">Bestätigen</button>
                        <button class="btn btn-danger btn-small" onclick="App.reviewWorkflow('${kind}', '${item.id}', false)">Ablehnen</button>
                    </div>
                </div>
            `;
        }).join('') : '<div class="empty-state small">Keine offenen Bestätigungen</div>';
    },

    async reviewWorkflow(kind, id, approve) {
        const enteredNote = approve ? '' : (prompt('Grund für die Ablehnung (optional)', '') ?? null);
        const note = enteredNote === null ? null : enteredNote.trim().slice(0, 1000);
        if (!approve && note === null) return;
        try {
            if (kind === 'open') await DataManager.reviewOpenShift(id, approve, note);
            else if (kind === 'swap') await DataManager.reviewShiftSwap(id, approve, note);
            else await DataManager.reviewShiftChangeRequest(id, approve, note);
            this.renderAdminDashboard();
            this.renderAdminView();
            this.showToast(approve ? 'Anfrage bestätigt.' : 'Anfrage abgelehnt.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Übernahme konnte nicht bearbeitet werden.', 'error');
        }
    },

    renderShiftHistory() {
        const container = document.getElementById('shift-history-list');
        if (!container) return;
        const history = (DataManager.getShiftHistory?.() || []).filter(item =>
            !this.adminStore || item.storeId === this.adminStore);
        const labels = {
            published: 'veröffentlicht',
            added: 'hinzugefügt',
            time_changed: 'Zeit geändert',
            removed: 'entfernt',
            reassigned: 'neu zugeteilt',
            opened: 'als offen markiert',
            swap_approved: 'getauscht',
            open_shift_assigned: 'offene Schicht besetzt'
        };
        container.innerHTML = history.length ? history.map(item => {
            const before = item.before?.start ? `${item.before.start}–${item.before.end}` : '';
            const after = item.after?.start ? `${item.after.start}–${item.after.end}` : '';
            const times = before && after ? `${before} → ${after}` : (after || before);
            const date = this.getWorkflowDate(item.weekKey, item.dayKey);
            return `
                <div class="history-item">
                    <div class="history-main">
                        <strong>${this.escapeHtml(item.employeeName)}</strong>
                        <span>${this.escapeHtml(labels[item.changeType] || item.changeType)}</span>
                    </div>
                    <div class="history-meta">
                        ${date ? DateUtils.formatDate(date) : this.escapeHtml(item.weekKey)}${times ? ` · ${this.escapeHtml(times)}` : ''} · ${this.formatTimestamp(item.createdAt)}
                    </div>
                </div>
            `;
        }).join('') : '<div class="empty-state">Noch keine veröffentlichten Schichtänderungen</div>';
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
        const todayShifts = (schedule?.shifts?.[todayKey] || [])
            .filter(shift => shift.requestStatus !== 'declined');
        
        if (todayShifts.length === 0) {
            container.innerHTML = '<div class="empty-today">Keine Schichten heute</div>';
            return;
        }
        
        container.innerHTML = todayShifts.map(shift => {
            let deviationBadge = '';
            if (shift.deviation) {
                if (shift.deviation.lateMinutes) {
                    deviationBadge = `<span class="deviation-badge late">+${this.escapeHtml(shift.deviation.lateMinutes)}m</span>`;
                } else if (shift.deviation.earlyMinutes) {
                    deviationBadge = `<span class="deviation-badge early">-${this.escapeHtml(shift.deviation.earlyMinutes)}m</span>`;
                }
            }
            
            return `
                <div class="today-shift-item">
                    <span class="shift-employee">${this.escapeHtml(this.getEmployeeName(shift.employeeId, shift.employeeName))}</span>
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
            badge.style.display = 'inline-flex';
            count.textContent = notifications.length;
            card.style.display = 'block';
            
            list.innerHTML = notifications.map(n => {
                let icon = '🔔';
                if (n.type === 'early') icon = '🚪';
                else if (n.type === 'late') icon = '⏰';
                else if (n.type === 'shift_request_response') icon = '✅';
                else if (n.type === 'absence_request') icon = '📅';
                else if (n.type === 'absence_notice') icon = '🤒';
                else if (n.type === 'absence_cancelled') icon = '↩️';

                const titleName = n.employeeName ? `${this.escapeHtml(n.employeeName)}: ` : '';

                const needsAbsenceActions = n.type === 'absence_request' && n.absenceId;
                let actions = needsAbsenceActions ? (() => {
                    const payload = this.encodeActionData(JSON.stringify({ notificationId: n.id, absenceId: n.absenceId }));
                    return `
                        <div class="request-actions" style="margin-top: 8px; flex-direction: row;">
                            <button class="btn btn-success btn-small" onclick="App.approveAbsenceRequest('${payload}')">Genehmigen</button>
                            <button class="btn btn-danger btn-small" onclick="App.denyAbsenceRequest('${payload}')">Ablehnen</button>
                        </div>
                    `;
                })() : '';

                if (!actions && n.weekKey) {
                    const context = this.encodeActionData(JSON.stringify({ notificationId: n.id, weekKey: n.weekKey }));
                    actions = `
                        <div class="request-actions" style="margin-top: 8px; flex-direction: row;">
                            <button class="btn btn-primary btn-small" onclick="App.openNotificationPlan('${context}')">Im Plan öffnen</button>
                        </div>
                    `;
                } else if (!actions && ['absence_notice', 'absence_cancelled'].includes(n.type)) {
                    const context = this.encodeActionData(JSON.stringify({ notificationId: n.id }));
                    actions = `
                        <div class="request-actions" style="margin-top: 8px; flex-direction: row;">
                            <button class="btn btn-primary btn-small" onclick="App.openNotificationAbsences('${context}')">Abwesenheit prüfen</button>
                        </div>
                    `;
                }

                return `
                    <div class="notification-item ${['early', 'late', 'shift_request_response', 'absence_request', 'absence_notice', 'absence_cancelled'].includes(n.type) ? n.type : 'info'}">
                        <span class="notification-icon">${icon}</span>
                        <div class="notification-content">
                            <div class="notification-title">${titleName}${this.escapeHtml(n.message || '')}${n.storeId ? ` · ${this.escapeHtml(DataManager.getStoreName(n.storeId))}` : ''}</div>
                            ${n.reason ? `<div class="notification-reason">${n.type === 'shift_request_response' ? 'Info' : 'Grund'}: ${this.escapeHtml(n.reason)}</div>` : ''}
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
        if (!select) return;
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
            .map(id => `<option value="${this.escapeHtml(id)}">${this.escapeHtml(DataManager.getStoreName(id))}</option>`)
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
                availSelect.innerHTML = stores.map(id => `<option value="${this.escapeHtml(id)}">${this.escapeHtml(DataManager.getStoreName(id))}</option>`).join('');
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
                scheduleSelect.innerHTML = visibleStores.map(id => `<option value="${this.escapeHtml(id)}">${this.escapeHtml(DataManager.getStoreName(id))}</option>`).join('');
                if (!visibleStores.includes(this.employeeStore)) this.employeeStore = primary;
                scheduleSelect.value = this.employeeStore;
            }
        }
    },


    async logout() {
        this.currentUser = null;
        try {
            await window.FreshShiftSupabase.signOut();
        } catch (error) {
            this.showToast(error?.message || 'Abmelden fehlgeschlagen.', 'error');
        }
    },

    async adminLogout() {
        await this.logout();
    },

    resetLoginForm() {
        const email = document.getElementById('auth-email');
        if (email) email.value = '';
        this.setAuthStatus('');
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
        const context = this.getWeekContext(this.currentWeek);
        this.updateWeekContextDisplay('week-label', 'week-context', display, context);
        this.updateWeekContextDisplay('my-week-label', 'my-week-context', display, context);
        this.updateWeekContextDisplay('admin-week-label', 'admin-week-context', display, context);
    },

    updateWeekContextDisplay(labelId, contextId, display, context) {
        const label = document.getElementById(labelId);
        const contextBadge = document.getElementById(contextId);
        if (!label || !contextBadge) return;

        label.textContent = display;
        contextBadge.textContent = context.label;
        contextBadge.className = `week-context-badge ${context.kind}`;
    },

    getWeekContext(weekDate) {
        const currentWeekKey = DateUtils.getWeekKey(new Date());
        const displayedWeekKey = DateUtils.getWeekKey(weekDate);
        const differenceInWeeks = Math.round(
            (DateUtils.getWeekDates(weekDate)[0] - DateUtils.getWeekDates(new Date())[0]) / (7 * 24 * 60 * 60 * 1000)
        );
        if (displayedWeekKey === currentWeekKey) return { label: 'Aktuelle Woche', kind: 'current' };
        if (differenceInWeeks === -1) return { label: 'Letzte Woche', kind: 'past' };
        if (differenceInWeeks === 1) return { label: 'Nächste Woche', kind: 'future' };
        return differenceInWeeks < 0
            ? { label: 'Vergangene Woche', kind: 'past' }
            : { label: 'Kommende Woche', kind: 'future' };
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
        const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        return `${hh}:${mm}`;
    },

    async applyEmployeeShiftDeviation(kind, minutes, reason) {
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

            const plannedRange = this.timeRange(shift.start, shift.end);
            if (!plannedRange) continue;
            const plannedStart = plannedRange.start;
            const plannedEnd = plannedRange.end;
            const deviation = { ...(shift.deviation || {}) };
            let actualStart = shift.actualStart || null;
            let actualEnd = shift.actualEnd || null;

            if (kind === 'late') {
                const actualStartMin = Math.min(plannedStart + delta, plannedEnd);
                actualStart = this.formatMinutesToTime(actualStartMin);
                deviation.lateMinutes = actualStartMin - plannedStart;
                if (reason) deviation.reason = reason;
            }

            if (kind === 'early') {
                const actualEndMin = Math.max(plannedEnd - delta, plannedStart);
                actualEnd = this.formatMinutesToTime(actualEndMin);
                deviation.earlyMinutes = plannedEnd - actualEndMin;
                if (reason) deviation.reason = reason;
            }

            await DataManager.reportShiftDeviation(shift.id, {
                actualStart,
                actualEnd,
                deviation
            });
            return storeId;
        }

        return null;
    },

    async submitLateReport() {
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const minutes = parseInt(document.getElementById('late-minutes').value, 10) || 0;
        const reason = document.getElementById('late-reason').value;

        try {
            const storeId = await this.applyEmployeeShiftDeviation('late', minutes, reason);
            if (!storeId) {
                this.showToast('Für heute wurde keine Schicht gefunden.', 'warning');
                return;
            }

            this.hideModals();
            document.getElementById('late-reason').value = '';
            this.renderDashboard();
            this.showToast('Meldung gesendet!', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Meldung konnte nicht gesendet werden.', 'error');
        }
    },

    // ===========================
    // Report Early Leave (Employee)
    // ===========================
    async submitEarlyReport() {
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const minutes = parseInt(document.getElementById('early-minutes').value, 10) || 0;
        const reason = document.getElementById('early-reason').value;

        try {
            const storeId = await this.applyEmployeeShiftDeviation('early', minutes, reason);
            if (!storeId) {
                this.showToast('Für heute wurde keine Schicht gefunden.', 'warning');
                return;
            }

            this.hideModals();
            document.getElementById('early-reason').value = '';
            this.renderDashboard();
            this.showToast('Meldung gesendet!', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Meldung konnte nicht gesendet werden.', 'error');
        }
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
        this.navigateAdminTo('admin-dashboard');
        this.updateAdminNotifications();
        card.style.display = 'block';
        window.setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    },

    async openNotificationPlan(payload) {
        try {
            const { notificationId, weekKey } = JSON.parse(decodeURIComponent(payload));
            if (notificationId) await DataManager.markNotificationRead(notificationId);
            const [year, week] = String(weekKey || '').split('-W').map(Number);
            if (Number.isInteger(year) && Number.isInteger(week)) {
                this.currentWeek = DataManager.getDateFromWeek(year, week);
            }
            this.navigateAdminTo('admin-planner');
            this.updateAdminNotifications();
        } catch (error) {
            this.showToast(error?.message || 'Meldung konnte nicht geöffnet werden.', 'error');
        }
    },

    async openNotificationAbsences(payload) {
        try {
            const { notificationId } = JSON.parse(decodeURIComponent(payload));
            if (notificationId) await DataManager.markNotificationRead(notificationId);
            this.navigateAdminTo('admin-employees');
            this.updateAdminNotifications();
            window.setTimeout(() => document.querySelector('.absences-overview-card')?.scrollIntoView({ behavior: 'smooth' }), 0);
        } catch (error) {
            this.showToast(error?.message || 'Meldung konnte nicht geöffnet werden.', 'error');
        }
    },

    async clearNotifications() {
        try {
            await DataManager.markAllNotificationsRead();
            this.updateAdminNotifications();
            this.showToast('Alle Meldungen als gelesen markiert.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Meldungen konnten nicht aktualisiert werden.', 'error');
        }
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
                        <input type="time" name="${dayKey}_start" value="${this.escapeHtml(existing.start || '10:00')}" step="60" class="time-input-24h">
                    </div>
                    <div class="time-group">
                        <label>Bis:</label>
                        <input type="time" name="${dayKey}_end" value="${this.escapeHtml(existing.end || '20:00')}" step="60" class="time-input-24h">
                    </div>
                </div>
                <div class="day-notes" id="${dayKey}-notes" style="${!existing.available ? 'display:none' : ''}">
                    <input type="text" name="${dayKey}_notes" 
                        maxlength="500"
                        placeholder="Bemerkung (optional)" 
                        value="${this.escapeHtml(existing.notes || '')}">
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

    async handleAvailabilitySubmit(e) {
        e.preventDefault();
        
        if (!this.currentUser) {
            this.showToast('Bitte melde dich zuerst an.', 'error');
            return;
        }

        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const form = e.target;
        const days = {};
        let validationMessage = null;

        DateUtils.DAY_KEYS.forEach(dayKey => {
            const available = form[`${dayKey}_available`]?.checked || false;
            const start = available ? form[`${dayKey}_start`]?.value : null;
            const end = available ? form[`${dayKey}_end`]?.value : null;
            if (available && (!start || !end || start === end)) {
                validationMessage = `${DateUtils.DAYS[DateUtils.DAY_KEYS.indexOf(dayKey)]}: Bitte gültige, unterschiedliche Zeiten eingeben.`;
            }
            days[dayKey] = {
                available: available,
                start,
                end,
                notes: available ? form[`${dayKey}_notes`]?.value.trim().slice(0, 500) : null
            };
        });

        if (validationMessage) {
            this.showToast(validationMessage, 'error');
            return;
        }

        const availability = {
            employeeId: this.currentUser.id,
            weekKey: weekKey,
            storeId: this.employeeStore,
            days: days,
            notes: document.getElementById('general-notes').value.trim().slice(0, 2000),
            submittedAt: new Date().toISOString()
        };

        try {
            await DataManager.saveAvailability(availability);
            this.showToast('Verfügbarkeit gespeichert!', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Verfügbarkeit konnte nicht gespeichert werden.', 'error');
        }
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
                <p>${this.escapeHtml(storeName)}: Für diese Woche wurde noch kein Schichtplan erstellt.</p>
            `;
            contentContainer.innerHTML = '';
            summaryContainer.innerHTML = '';
            this.renderTeamSchedule(null, dates);
            return;
        }

        // Status
        if (schedule.released) {
            statusContainer.className = 'schedule-status released';
            statusContainer.innerHTML = `
                <h3>Plan freigegeben</h3>
                <p>${this.escapeHtml(storeName)} · Freigegeben am ${new Date(schedule.releasedAt).toLocaleDateString('de-DE')}</p>
            `;
        } else {
            statusContainer.className = 'schedule-status pending';
            statusContainer.innerHTML = `
                <h3>Vorläufiger Plan</h3>
                <p>${this.escapeHtml(storeName)} · Dieser Plan wurde noch nicht freigegeben.</p>
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
                        deviationHtml = `<div class="shift-deviation late">${this.escapeHtml(myShift.deviation.lateMinutes)} Min. später gekommen</div>`;
                    }
                    if (myShift.deviation.earlyMinutes) {
                        deviationHtml = `<div class="shift-deviation early">${this.escapeHtml(myShift.deviation.earlyMinutes)} Min. früher gegangen</div>`;
                    }
                }

                const requestHtml = isPending ? `<div class="shift-deviation early">⏳ Schichtanfrage offen</div>` : '';
                const activeSwap = (DataManager.getShiftSwaps?.() || []).find(request =>
                    request.shiftId === myShift.id && ['open', 'claimed'].includes(request.status));
                const activePlanChange = (DataManager.getShiftChangeRequests?.() || []).find(request =>
                    request.scheduleId === schedule.id
                    && request.employeeId === this.currentUser?.id
                    && request.dayKey === dayKey
                    && request.status === 'pending');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const canSwap = schedule.released && !isPending && dates[index] >= today;
                const swapHtml = activeSwap
                    ? `<div class="shift-deviation early">↔️ Tauschanfrage ${activeSwap.status === 'claimed' ? 'wartet auf Admin' : 'offen'}</div>`
                    : canSwap
                        ? `<button class="btn btn-secondary btn-small shift-swap-button" onclick="App.createShiftSwap('${myShift.id}')">Schicht abgeben</button>`
                        : '';
                const planChangeHtml = activePlanChange
                    ? `
                        <div class="shift-deviation early">🕒 Änderungsanfrage offen: ${this.escapeHtml(activePlanChange.requestedStart)}–${this.escapeHtml(activePlanChange.requestedEnd)}</div>
                        <div class="my-shift-actions">
                          <button class="btn btn-danger btn-small" onclick="App.cancelPlanChangeRequest('${activePlanChange.id}')">Zurückziehen</button>
                        </div>`
                    : canSwap
                        ? `<div class="my-shift-actions"><button class="btn btn-secondary btn-small" onclick="App.openPlanChangeRequest('${myShift.id}')">Zeiten ändern</button></div>`
                        : '';
                
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
                        ${swapHtml}
                        ${planChangeHtml}
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

        this.renderTeamSchedule(schedule, dates);
    },

    renderTeamSchedule(schedule, dates) {
        const container = document.getElementById('team-schedule-content');
        const section = document.getElementById('team-schedule-section');
        const downloadButton = document.getElementById('download-team-pdf');
        if (!container || !section) return;

        if (!schedule?.released) {
            if (downloadButton) downloadButton.disabled = true;
            section.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        if (downloadButton) downloadButton.disabled = false;
        section.style.display = 'block';
        container.innerHTML = DateUtils.DAY_KEYS.map((dayKey, index) => {
            const shifts = (schedule.shifts?.[dayKey] || [])
                .filter(shift => !['pending', 'declined'].includes(shift.requestStatus))
                .sort((a, b) => String(a.start).localeCompare(String(b.start)) ||
                    String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'de'));

            const rows = shifts.length > 0 ? shifts.map(shift => {
                const isCurrentUser = shift.employeeId === this.currentUser?.id;
                const name = shift.employeeName || this.getEmployeeName(shift.employeeId);
                const deviation = shift.deviation?.lateMinutes
                    ? `<div class="team-deviation">Kommt voraussichtlich ${this.escapeHtml(shift.deviation.lateMinutes)} Min. später</div>`
                    : shift.deviation?.earlyMinutes
                        ? `<div class="team-deviation">Geht voraussichtlich ${this.escapeHtml(shift.deviation.earlyMinutes)} Min. früher</div>`
                        : '';
                return `
                    <div class="team-shift-row">
                        <div class="team-shift-name">${this.escapeHtml(name)}${isCurrentUser ? ' <span class="absence-pill approved">Du</span>' : ''}</div>
                        <div class="team-shift-time">${this.escapeHtml(shift.start)} – ${this.escapeHtml(shift.end)}</div>
                        ${deviation}
                    </div>
                `;
            }).join('') : '<div class="empty-state small">Niemand eingeplant</div>';

            return `
                <div class="team-day">
                    <div class="team-day-header">
                        <span>${DateUtils.DAYS[index]}</span>
                        <span>${DateUtils.formatDate(dates[index])}</span>
                    </div>
                    ${rows}
                </div>
            `;
        }).join('');
    },

    buildWeeklyPdfRows(schedule) {
        const rowsByEmployee = new Map();

        DateUtils.DAY_KEYS.forEach((dayKey, dayIndex) => {
            (schedule?.shifts?.[dayKey] || [])
                .filter(shift => !['pending', 'declined'].includes(shift.requestStatus))
                .forEach(shift => {
                    const employeeId = shift.employeeId || `name:${shift.employeeName || 'Unbekannt'}`;
                    if (!rowsByEmployee.has(employeeId)) {
                        rowsByEmployee.set(employeeId, {
                            employeeId: shift.employeeId || null,
                            name: shift.employeeName || this.getEmployeeName(shift.employeeId),
                            days: Array(7).fill('–')
                        });
                    }

                    const row = rowsByEmployee.get(employeeId);
                    const time = `${shift.start}–${shift.end}`;
                    row.days[dayIndex] = row.days[dayIndex] === '–'
                        ? time
                        : `${row.days[dayIndex]}, ${time}`;
                });
        });

        return Array.from(rowsByEmployee.values())
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'))
            .map(row => [row.name, ...row.days]);
    },

    createWeeklySchedulePdf(schedule, storeId) {
        const JsPdf = window.jspdf?.jsPDF;
        if (!JsPdf) {
            throw new Error('PDF-Modul konnte nicht geladen werden. Bitte prüfe die Internetverbindung.');
        }

        const doc = new JsPdf({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        if (typeof doc.autoTable !== 'function') {
            throw new Error('PDF table module unavailable');
        }

        const storeName = DataManager.getStoreName(storeId);
        const rows = this.buildWeeklyPdfRows(schedule);
        const dates = DateUtils.getWeekDates(this.currentWeek);
        const headers = ['Mitarbeiter', ...DateUtils.DAYS_SHORT.map((day, index) =>
            `${day}\n${DateUtils.formatDate(dates[index])}`)];

        doc.setProperties({
            title: `FreshShift ${DateUtils.formatWeekDisplay(this.currentWeek)} - ${storeName}`,
            subject: 'Wochenplan',
            creator: 'FreshShift'
        });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(11, 95, 165);
        doc.text('FreshShift - Wochenplan', 8, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(75, 85, 99);
        doc.text(`${DateUtils.formatWeekDisplay(this.currentWeek)} | ${storeName}`, 8, 18);

        doc.autoTable({
                startY: 23,
                head: [headers],
                body: rows.length > 0 ? rows : [['Keine Schichten', '–', '–', '–', '–', '–', '–', '–']],
                theme: 'grid',
                margin: { top: 23, right: 8, bottom: 12, left: 8 },
                tableWidth: 281,
                styles: {
                    font: 'helvetica',
                    fontSize: 7.5,
                    cellPadding: 1.8,
                    overflow: 'linebreak',
                    valign: 'middle',
                    textColor: [17, 24, 39],
                    lineColor: [209, 213, 219],
                    lineWidth: 0.2
                },
                headStyles: {
                    fillColor: [11, 95, 165],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    halign: 'center'
                },
                bodyStyles: { minCellHeight: 7 },
                alternateRowStyles: { fillColor: [243, 244, 246] },
                columnStyles: {
                    0: { cellWidth: 43, fontStyle: 'bold', halign: 'left' },
                    1: { cellWidth: 34, halign: 'center' },
                    2: { cellWidth: 34, halign: 'center' },
                    3: { cellWidth: 34, halign: 'center' },
                    4: { cellWidth: 34, halign: 'center' },
                    5: { cellWidth: 34, halign: 'center' },
                    6: { cellWidth: 34, halign: 'center' },
                    7: { cellWidth: 34, halign: 'center' }
                },
                didDrawPage: data => {
                    const pageNumber = doc.getNumberOfPages();
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7);
                    doc.setTextColor(107, 114, 128);
                    doc.text(`FreshShift | Seite ${pageNumber}`, data.settings.margin.left, 205);
                }
        });

        return { doc, storeName };
    },

    downloadEmployeeSchedulePdf() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.employeeStore);
        if (!schedule?.released) {
            this.showToast('Für diese Woche ist noch kein freigegebener Plan verfügbar.', 'error');
            return;
        }

        try {
            const { doc, storeName } = this.createWeeklySchedulePdf(schedule, this.employeeStore);
            const safeStore = String(storeName || 'Wochenplan').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-');
            doc.save(`FreshShift_${weekKey}_${safeStore}.pdf`);
        } catch (error) {
            console.error('FreshShift PDF generation failed', error);
            this.showToast('PDF konnte nicht erstellt werden.', 'error');
        }
    },

    previewAdminSchedulePdf() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        if (!schedule) {
            this.showToast('Für diese Woche ist noch kein Wochenplan vorhanden.', 'error');
            return;
        }

        const previewWindow = window.open('', '_blank');
        try {
            const { doc } = this.createWeeklySchedulePdf(schedule, this.adminStore);
            const url = doc.output('bloburl');
            if (previewWindow) {
                previewWindow.location.href = url;
                window.setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                doc.save(`FreshShift_${weekKey}_${this.adminStore}.pdf`);
            }
        } catch (error) {
            previewWindow?.close();
            console.error('FreshShift admin PDF preview failed', error);
            this.showToast('PDF konnte nicht erstellt werden.', 'error');
        }
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
            html += `<tr><td class="name-cell">${this.escapeHtml(emp.name)}</td>`;
            
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
                        title="${this.escapeHtml(absence.note || badgeText)}">
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
                            deviationHtml = `<span class="deviation-indicator late">+${this.escapeHtml(shift.deviation.lateMinutes)}m</span>`;
                        }
                        if (shift.deviation.earlyMinutes) {
                            cellClass += ' has-deviation deviation-early';
                            deviationHtml = `<span class="deviation-indicator early">-${this.escapeHtml(shift.deviation.earlyMinutes)}m</span>`;
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
                    const hint = dayAvail?.available && this.timeRange(dayAvail.start, dayAvail.end)
                        ? `<span class="avail-hint">${this.escapeHtml(dayAvail.start)}–${this.escapeHtml(dayAvail.end)}</span>`
                        : '';

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
        this.previewAdminSchedulePdf();
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
                    <span class="deviation-name">${this.escapeHtml(this.getEmployeeName(d.employeeId, d.employeeName))}</span>
                    <span class="deviation-day">${d.dayName}</span>
                    <span class="deviation-info">${this.escapeHtml(info)}</span>
                    ${d.deviation.reason ? `<span class="deviation-reason">${this.escapeHtml(d.deviation.reason)}</span>` : ''}
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
        let dayInfoHtml = `<strong>${this.escapeHtml(employee.name)}</strong> – ${DateUtils.DAYS[dayIndex]}, ${DateUtils.formatDate(dates[dayIndex])}`;
        
        // Check if employee is absent
        const absence = DataManager.getEmployeeAbsenceForDate(employeeId, dayDate);
        if (absence) {
            const typeLabel = absence.type === 'urlaub' ? 'Urlaub' : 
                             absence.type === 'krank' ? 'Krank' : 'Abwesend';
            dayInfoHtml += `<div class="modal-absence-warning">⚠️ ${this.escapeHtml(employee.name)} ist an diesem Tag abwesend (${typeLabel}${absence.note ? ': ' + this.escapeHtml(absence.note) : ''})</div>`;
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
            availableList.innerHTML = `<div class="no-available" style="color: #b91c1c;">🚫 ${this.escapeHtml(employee.name)} ist ${typeLabel}</div>`;
        } else if (dayAvail?.available && this.timeRange(dayAvail.start, dayAvail.end)) {
            availableList.innerHTML = `
                <div class="available-employee" onclick="App.quickAssign('${this.encodeActionData(dayAvail.start)}', '${this.encodeActionData(dayAvail.end)}')">
                    <span class="name">Verfügbar</span>
                    <span class="time">${this.escapeHtml(dayAvail.start)} – ${this.escapeHtml(dayAvail.end)}</span>
                </div>
            `;
        } else {
            availableList.innerHTML = '<div class="no-available">Keine Verfügbarkeit eingetragen</div>';
        }

        // Check if shift exists
        const existingShift = schedule?.shifts?.[dayKey]?.find(s => s.employeeId === employeeId);
        const removeBtn = document.getElementById('remove-shift');
        const openBtn = document.getElementById('open-shift');
        
        if (existingShift) {
            document.getElementById('shift-start').value = existingShift.start;
            document.getElementById('shift-end').value = existingShift.end;
            document.getElementById('actual-start').value = existingShift.actualStart || '';
            document.getElementById('actual-end').value = existingShift.actualEnd || '';
            document.getElementById('deviation-note').value = existingShift.deviation?.reason || '';
            removeBtn.style.display = 'block';
            openBtn.style.display = 'block';
        } else {
            document.getElementById('shift-start').value = dayAvail?.start || '10:00';
            document.getElementById('shift-end').value = dayAvail?.end || '20:00';
            document.getElementById('actual-start').value = '';
            document.getElementById('actual-end').value = '';
            document.getElementById('deviation-note').value = '';
            removeBtn.style.display = 'none';
            openBtn.style.display = 'none';
        }

        this.showModal('shift-modal');
    },

    async quickAssign(start, end) {
        document.getElementById('shift-start').value = decodeURIComponent(start || '');
        document.getElementById('shift-end').value = decodeURIComponent(end || '');
        await this.saveShift();
    },

    async offerCurrentShift() {
        if (!this.currentEditCell) return;
        const { employeeId, dayKey } = this.currentEditCell;
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        const shift = schedule?.shifts?.[dayKey]?.find(item => item.employeeId === employeeId);
        if (!shift?.id) {
            this.showToast('Schicht wurde nicht gefunden.', 'error');
            return;
        }
        const reason = prompt('Warum wird Ersatz gesucht?', 'Krankheitsvertretung');
        if (reason === null) return;
        try {
            await DataManager.createOpenShift(shift.id, reason);
            this.hideModals();
            this.renderAdminView();
            this.renderAdminDashboard();
            this.showToast('Schicht ist jetzt offen. Passende Mitarbeiter wurden informiert.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Schicht konnte nicht geöffnet werden.', 'error');
        }
    },

    async saveShift() {
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

        if (!this.timeRange(start, end)) {
            this.showToast('Start- und Endzeit müssen gültig und unterschiedlich sein.', 'error');
            return;
        }

        // Get or create schedule
        const existingSchedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        let schedule = this.cloneSchedule(existingSchedule);
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
        const needsRequest = !this.isShiftWithinAvailability(start, end, dayAvail);

        if (needsRequest) {
            shift.requestStatus = 'pending';
            shift.requestedAt = new Date().toISOString();
            shift.requestedBy = 'admin';

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
        schedule.released = false;
        schedule.releasedAt = null;
        try {
            await DataManager.saveSchedule(schedule);
            if (needsRequest) {
                await DataManager.addNotification({
                    target: 'employee',
                    targetEmployeeId: employeeId,
                    type: 'shift_request',
                    storeId: this.adminStore,
                    employeeId,
                    employeeName: employee.name,
                    message: `Schichtanfrage: ${start}–${end}`,
                    reason: 'Bitte annehmen oder ablehnen.'
                });
            }

            this.hideModals();
            this.renderScheduleEditor();
            this.renderWeekDeviations();
            this.updateReleaseButton();
            const wasReleased = Boolean(existingSchedule?.released);
            const message = wasReleased
                ? 'Schicht gespeichert. Der Plan ist wieder ein Entwurf und muss erneut freigegeben werden.'
                : (needsRequest ? 'Schichtanfrage gesendet!' : 'Schicht eingetragen!');
            this.showToast(message, needsRequest || wasReleased ? 'warning' : 'success');
        } catch (error) {
            this.showToast(error?.message || 'Schicht konnte nicht gespeichert werden.', 'error');
        }
    },

    async removeShift() {
        if (!this.currentEditCell) return;

        const { employeeId, dayKey } = this.currentEditCell;
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const existingSchedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        let schedule = this.cloneSchedule(existingSchedule);

        if (schedule?.shifts?.[dayKey]) {
            schedule.shifts[dayKey] = schedule.shifts[dayKey].filter(s => s.employeeId !== employeeId);
            schedule.storeId = this.adminStore;
            schedule.released = false;
            schedule.releasedAt = null;
            try {
                await DataManager.saveSchedule(schedule);
            } catch (error) {
                this.showToast(error?.message || 'Schicht konnte nicht entfernt werden.', 'error');
                return;
            }
        }

        this.hideModals();
        this.renderScheduleEditor();
        this.renderWeekDeviations();
        this.showToast(existingSchedule?.released
            ? 'Schicht entfernt. Der Plan muss erneut freigegeben werden.'
            : 'Schicht entfernt.', existingSchedule?.released ? 'warning' : 'success');
    },

    async saveSchedule() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        let schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        
        if (schedule) {
            schedule.savedAt = new Date().toISOString();
            schedule.storeId = this.adminStore;
            try {
                await DataManager.saveSchedule(schedule);
                this.showToast('Plan gespeichert!', 'success');
                this.updateReleaseButton();
            } catch (error) {
                this.showToast(error?.message || 'Plan konnte nicht gespeichert werden.', 'error');
            }
        } else {
            this.showToast('Noch keine Schichten eingetragen.', 'warning');
        }
    },

    async releaseSchedule() {
        const weekKey = DateUtils.getWeekKey(this.currentWeek);
        const schedule = DataManager.getScheduleForWeek(weekKey, this.adminStore);
        const validation = this.validateScheduleForRelease(schedule, this.adminStore);

        if (validation.errors.length > 0) {
            alert(`Plan kann nicht freigegeben werden:\n\n${validation.errors.slice(0, 8).map(error => `• ${error}`).join('\n')}`);
            return;
        }

        if (validation.warnings.length > 0) {
            const proceed = confirm(`Hinweise vor der Freigabe:\n\n${validation.warnings.slice(0, 8).map(warning => `• ${warning}`).join('\n')}\n\nTrotzdem freigeben?`);
            if (!proceed) return;
        }

        try {
            await DataManager.releaseSchedule(weekKey, this.adminStore);
            this.updateReleaseButton();
            this.showToast('Plan freigegeben! Mitarbeiter können ihn jetzt sehen.', 'success');
        } catch (error) {
            this.showToast(error?.message || 'Plan konnte nicht freigegeben werden.', 'error');
        }
    },

     /* copyLastWeek() {
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
                                 <div class="conflict-title">${this.escapeHtml(c.employeeName)} – ${DateUtils.DAYS_SHORT[c.dayIndex]} (${c.date})</div>
                                 <div class="conflict-sub">${this.escapeHtml(c.detail)}</div>
                             </div>
                             <div class="conflict-tag">${tag}</div>
                         </div>
                     `;
                 }).join('') + (conflicts.length > 30 ? `<div class="helper-text">+ ${conflicts.length - 30} weitere Konflikte…</div>` : '');
             }
         }

         this.showModal('copy-week-modal');
     }, */

     /* async applyCopyWeek(skipConflicts) {
         if (!this.pendingCopyContext) return;

         const { lastWeekKey, currentWeekKey, lastWeekSchedule, dates } = this.pendingCopyContext;

         const newShifts = {};
         const skipped = [];
         const pendingRequests = [];

         DateUtils.DAY_KEYS.forEach((dayKey, dayIndex) => {
             const dayDate = dates[dayIndex];
             const dayShifts = lastWeekSchedule.shifts[dayKey] || [];
             newShifts[dayKey] = [];

             dayShifts.forEach(shift => {
                 if (!skipConflicts) {
                     const availability = DataManager.getEmployeeAvailability(shift.employeeId, currentWeekKey, this.adminStore)
                         ?.days?.[dayKey];
                     const copiedShift = {
                         employeeId: shift.employeeId,
                         employeeName: this.getEmployeeName(shift.employeeId, shift.employeeName),
                         start: shift.start,
                         end: shift.end
                     };
                     if (!this.isShiftWithinAvailability(shift.start, shift.end, availability)) {
                         copiedShift.requestStatus = 'pending';
                         copiedShift.requestedAt = new Date().toISOString();
                         pendingRequests.push({ ...copiedShift, dayKey });
                     }
                     newShifts[dayKey].push(copiedShift);
                     return;
                 }

                 const absence = DataManager.getEmployeeAbsenceForDate(shift.employeeId, dayDate);
                 if (absence) {
                     skipped.push({ employeeId: shift.employeeId, dayIndex, reason: 'Abwesenheit' });
                     return;
                 }

                 const avail = DataManager.getEmployeeAvailability(shift.employeeId, currentWeekKey, this.adminStore);
                 const dayAvail = avail?.days?.[dayKey];
                 if (!this.isShiftWithinAvailability(shift.start, shift.end, dayAvail)) {
                     skipped.push({ employeeId: shift.employeeId, dayIndex, reason: 'Keine Verfügbarkeit' });
                     return;
                 }

                 newShifts[dayKey].push({
                     employeeId: shift.employeeId,
                     employeeName: this.getEmployeeName(shift.employeeId, shift.employeeName),
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

         try {
             await DataManager.saveSchedule(newSchedule);
         } catch (error) {
             this.showToast(error?.message || 'Schichten konnten nicht kopiert werden.', 'error');
             return;
         }

         if (pendingRequests.length > 0) {
             try {
                 await Promise.all(pendingRequests.map(request => DataManager.addNotification({
                     target: 'employee',
                     targetEmployeeId: request.employeeId,
                     type: 'shift_request',
                     storeId: this.adminStore,
                     employeeId: request.employeeId,
                     employeeName: request.employeeName,
                     message: `Schichtanfrage: ${request.start}–${request.end}`,
                     reason: 'Beim Kopieren des Wochenplans erstellt.'
                 })));
             } catch (error) {
                 this.showToast('Plan kopiert, aber nicht alle Hinweise konnten erstellt werden.', 'warning');
             }
         }
         this.hideModals();
         this.pendingCopyContext = null;

         this.renderScheduleEditor();
         this.updateReleaseButton();

         if (skipConflicts && skipped.length > 0) {
             this.showToast(`${skipped.length} Schichten wegen Konflikten übersprungen.`, 'warning');
         } else {
             this.showToast('Schichten von letzter Woche kopiert!', 'success');
         }
     }, */


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
                    <td class="highlight">${this.escapeHtml(emp.name)}</td>
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
                            <div class="name">${this.escapeHtml(emp.name)}</div>
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
        const archivedEmployees = DataManager.getArchivedEmployees()
            .filter(employee => (employee.stores || []).includes(storeId))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de'));

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
                return a.status === 'approved' && today >= start && today <= end;
            });

            let absenceBadge = '';
            if (currentAbsence) {
                const typeLabel = currentAbsence.type === 'urlaub' ? 'Urlaub' :
                    currentAbsence.type === 'krank' ? 'Krank' : 'Abwesend';
                const badgeClass = currentAbsence.type === 'krank' ? 'badge-sick' : 'badge-vacation';
                absenceBadge = `<span class="absence-badge ${badgeClass}">${typeLabel}</span>`;
            }

            const stores = Array.isArray(emp.stores) && emp.stores.length > 0 ? emp.stores : [emp.primaryStore || emp.store || storeId];
            const storeNames = stores.map(s => this.escapeHtml(DataManager.getStoreName(s))).join(' · ');
            const accountStatus = emp.profileId
                ? '<span class="absence-pill approved">Zugang angelegt</span>'
                : '<span class="absence-pill pending">Nicht eingeladen</span>';
            const hoursDetail = (Number.isFinite(emp.weeklyTargetHours) || Number.isFinite(emp.weeklyMaxHours))
                ? `Woche: ${Number.isFinite(emp.weeklyTargetHours) ? `${this.escapeHtml(emp.weeklyTargetHours)}h Soll` : 'kein Soll'} · ${Number.isFinite(emp.weeklyMaxHours) ? `${this.escapeHtml(emp.weeklyMaxHours)}h max.` : 'kein Maximum'}`
                : '';
            const inviteButton = emp.profileId
                ? ''
                : `<button class="btn btn-primary btn-small" onclick="App.openInviteEmployee('${emp.id}', '${this.encodeActionData(emp.name)}')"><span class="btn-icon-inline">✉️</span> Einladen</button>`;
            const emailButton = emp.profileId && emp.email
                ? `<button class="btn btn-secondary btn-small" onclick="App.openUpdateEmployeeEmail('${emp.id}', '${this.encodeActionData(emp.name)}')"><span class="btn-icon-inline">✉</span> Email ändern</button>`
                : '';

            return `
                <div class="employee-card ${currentAbsence ? 'employee-absent' : ''}">
                    <div class="employee-info">
                        <div class="employee-name-row">
                            <span class="employee-name">${this.escapeHtml(emp.name)}</span>
                            ${absenceBadge}
                            ${accountStatus}
                        </div>
                        <div class="employee-meta-line">
                            <span>${storeNames}</span>
                            <span>${emp.type === 'aushilfe' ? 'Aushilfe' : 'Festangestellt'}</span>
                            ${hoursDetail ? `<span>${hoursDetail}</span>` : ''}
                        </div>
                    </div>
                    <div class="employee-actions">
                        <button class="btn btn-secondary btn-small" onclick="App.openAbsenceModal('${emp.id}')">
                            <span class="btn-icon-inline">📅</span> Abwesenheit
                        </button>
                        <button class="btn btn-secondary btn-small" onclick="App.openDefaultAvailabilityModal('${emp.id}')">
                            <span class="btn-icon-inline">⏱️</span> Standardzeiten
                        </button>
                        <button class="btn btn-secondary btn-small" onclick="App.openEditEmployeeModal('${emp.id}')">Bearbeiten</button>
                        ${inviteButton}
                        <details class="employee-more-actions">
                            <summary>Mehr</summary>
                            <div class="employee-more-menu">
                                ${emailButton}
                                <button class="btn btn-danger btn-small" onclick="App.deleteEmployee('${emp.id}')">Archivieren</button>
                                <button class="btn btn-danger btn-small btn-terminate" onclick="App.terminateEmployee('${emp.id}')">Zugang entziehen</button>
                            </div>
                        </details>
                    </div>
                </div>
            `;
        }).join('');

        const archivedCards = archivedEmployees.map(employee => `
            <div class="employee-card">
                <div class="employee-info">
                    <div class="employee-name-row">
                        <span class="employee-name">${this.escapeHtml(employee.name)}</span>
                        <span class="absence-pill ${employee.terminatedAt ? 'declined' : 'pending'}">${employee.terminatedAt ? 'Entlassen' : 'Archiviert'}</span>
                    </div>
                </div>
                <div class="employee-actions">
                    ${employee.terminatedAt
                        ? '<span class="employee-type">Zugang entfernt · Historie bleibt erhalten</span>'
                        : `<button class="btn btn-secondary btn-small" onclick="App.restoreEmployee('${employee.id}')">Wiederherstellen</button>`}
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="employees-store-section">
                <div class="store-section-header">
                    <h4>${this.escapeHtml(storeName)}</h4>
                    <span class="store-count">${storeEmployees.length}</span>
                </div>
                ${cards || '<div class="empty-state">Keine Mitarbeiter</div>'}
            </div>
            ${archivedCards ? `
                <div class="employees-store-section">
                    <div class="store-section-header">
                        <h4>Archivierte Mitarbeiter</h4>
                        <span class="store-count">${archivedEmployees.length}</span>
                    </div>
                    ${archivedCards}
                </div>
            ` : ''}
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
            return endDate >= today && startDate <= futureDate && ['pending', 'approved'].includes(status);
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
            
            const dateText = absence.startDate === absence.endDate
                ? DateUtils.formatDate(startDate)
                : `${DateUtils.formatDate(startDate)} – ${DateUtils.formatDate(endDate)}`;
            
            const status = absence.status || 'approved';
            const statusPill = status === 'pending'
                ? '<span class="absence-pill pending">Wartet</span>'
                : status === 'cancelled'
                    ? '<span class="absence-pill cancelled">Storniert</span>'
                    : '<span class="absence-pill approved">Bestätigt</span>';

            let auControls = '';
            if (absence.type === 'krank') {
                const payload = this.encodeActionData(JSON.stringify({ absenceId: absence.id }));
                if (absence.auStatus === 'pending') {
                    auControls = `
                        <span class="au-pill pending">eAU-Prüfung offen</span>
                        <div class="au-actions">
                            <button class="btn btn-success btn-small" onclick="event.stopPropagation(); App.setAbsenceAuStatus('${payload}', 'verified')">eAU bestätigen</button>
                            <button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); App.setAbsenceAuStatus('${payload}', 'not_required')">Nicht erforderlich</button>
                        </div>
                    `;
                } else if (absence.auStatus === 'verified') {
                    auControls = '<span class="au-pill verified">eAU bestätigt</span>';
                } else {
                    auControls = `
                        <span class="au-pill not-required">Keine eAU angefordert</span>
                        <div class="au-actions">
                            <button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); App.setAbsenceAuStatus('${payload}', 'pending')">eAU anfordern</button>
                        </div>
                    `;
                }
            }

            return `
                <div class="absence-item ${isActive ? 'absence-active' : ''}" onclick="App.editAbsence('${absence.id}')">
                    <span class="absence-icon">${typeIcon}</span>
                    <div class="absence-info">
                        <div class="absence-name">${this.escapeHtml(employee?.name || 'Unbekannt')} ${statusPill}</div>
                        <div class="absence-dates">${typeLabel}: ${dateText}</div>
                        ${absence.note ? `<div class="absence-note">${this.escapeHtml(absence.note)}</div>` : ''}
                        ${absence.responseReason ? `<div class="absence-note">Grund: ${this.escapeHtml(absence.responseReason)}</div>` : ''}
                        ${auControls}
                    </div>
                    ${isActive ? '<span class="absence-status">Aktuell</span>' : ''}
                </div>
            `;
        }).join('');
    },

    async setAbsenceAuStatus(payload, status) {
        try {
            const { absenceId } = JSON.parse(decodeURIComponent(payload));
            await DataManager.setAbsenceAuStatus(absenceId, status);
            this.renderEmployeesTab();
            this.renderAdminDashboard();
            const label = status === 'verified' ? 'eAU bestätigt.'
                : status === 'pending' ? 'eAU-Prüfung angefordert.'
                    : 'eAU als nicht erforderlich markiert.';
            this.showToast(label, 'success');
        } catch (error) {
            this.showToast(error?.message || 'eAU-Status konnte nicht geändert werden.', 'error');
        }
    },

    // ===========================
    // Data (Backup / Import)
    // ===========================
    renderAdminDataPage() {
        const status = document.getElementById('backup-status');
        if (!status) return;

        status.textContent = 'Supabase Cloud';
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

    currentEditAbsence: null,

    openAbsenceModal(employeeId, absenceId = null) {
        const employee = DataManager.getEmployee(employeeId);
        if (!employee) return;
        
        document.getElementById('absence-employee-info').innerHTML = `<strong>${this.escapeHtml(employee.name)}</strong>`;
        
        // Set default dates
        const today = DateUtils.formatDateKey(new Date());
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
        document.getElementById('absence-employee-info').innerHTML = `<strong>${this.escapeHtml(employee?.name || 'Unbekannt')}</strong>`;
        
        document.getElementById('absence-start').value = absence.startDate;
        document.getElementById('absence-end').value = absence.endDate;
        document.getElementById('absence-type').value = absence.type;
        document.getElementById('absence-note').value = absence.note || '';
        document.getElementById('delete-absence').style.display = 'block';
        document.getElementById('absence-modal-title').textContent = 'Abwesenheit bearbeiten';
        
        this.currentEditAbsence = { employeeId: absence.employeeId, absenceId };
        this.showModal('absence-modal');
    },

    async saveAbsence() {
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
        
        try {
            if (this.currentEditAbsence.absenceId) {
                absenceData.id = this.currentEditAbsence.absenceId;
                await DataManager.updateAbsence(absenceData);
                this.showToast('Abwesenheit aktualisiert.', 'success');
            } else {
                await DataManager.addAbsence(absenceData);
                this.showToast('Abwesenheit eingetragen.', 'success');
            }

            this.hideModals();
            this.currentEditAbsence = null;
            this.renderEmployeesTab();
        } catch (error) {
            this.showToast(error?.message || 'Abwesenheit konnte nicht gespeichert werden.', 'error');
        }
    },

    async deleteAbsence() {
        if (!this.currentEditAbsence?.absenceId) return;
        
        if (confirm('Abwesenheit wirklich löschen?')) {
            try {
                await DataManager.deleteAbsence(this.currentEditAbsence.absenceId);
                this.hideModals();
                this.currentEditAbsence = null;
                this.renderEmployeesTab();
                this.showToast('Abwesenheit gelöscht.', 'success');
            } catch (error) {
                this.showToast(error?.message || 'Abwesenheit konnte nicht gelöscht werden.', 'error');
            }
        }
    },

    openAddEmployeeModal() {
        document.getElementById('employee-modal-title').textContent = 'Neuer Mitarbeiter';
        document.getElementById('save-new-employee').textContent = 'Hinzufügen';

        document.getElementById('new-emp-id').value = '';
        document.getElementById('new-emp-name').value = '';
        document.getElementById('new-emp-type').value = 'aushilfe';
        document.getElementById('new-emp-hourly').value = '';
        document.getElementById('new-emp-phone').value = '';
        document.getElementById('new-emp-target-hours').value = '';
        document.getElementById('new-emp-max-hours').value = '18';

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
        document.getElementById('new-emp-phone').value = emp.phone || '';
        document.getElementById('new-emp-target-hours').value = Number.isFinite(emp.weeklyTargetHours) ? String(emp.weeklyTargetHours) : '';
        document.getElementById('new-emp-max-hours').value = Number.isFinite(emp.weeklyMaxHours) ? String(emp.weeklyMaxHours) : '';

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
                ? `<option value="${this.escapeHtml(stores[0])}">${this.escapeHtml(DataManager.getStoreName(stores[0]))}</option>`
                : '';
            select.value = stores[0] || 'fresh_fries';
            return;
        }

        group.style.display = 'block';
        select.innerHTML = stores.map(id => `<option value="${this.escapeHtml(id)}">${this.escapeHtml(DataManager.getStoreName(id))}</option>`).join('');

        const wanted = preferPrimary || this.adminStore;
        if (stores.includes(wanted)) {
            select.value = wanted;
        } else {
            select.value = stores[0];
        }
    },

    async saveNewEmployee() {
        const id = document.getElementById('new-emp-id').value.trim();
        const name = document.getElementById('new-emp-name').value.trim();
        const type = document.getElementById('new-emp-type').value;

        const hourlyRaw = document.getElementById('new-emp-hourly').value.trim();
        const hourlyRate = hourlyRaw ? Number(hourlyRaw.replace(',', '.')) : null;
        const phone = this.normalizePhone(document.getElementById('new-emp-phone').value);
        const targetRaw = document.getElementById('new-emp-target-hours').value.trim();
        const maxRaw = document.getElementById('new-emp-max-hours').value.trim();
        const weeklyTargetHours = targetRaw ? Number(targetRaw.replace(',', '.')) : null;
        const weeklyMaxHours = maxRaw ? Number(maxRaw.replace(',', '.')) : null;

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
            this.showToast(existing.active === false
                ? 'Dieser Name ist archiviert. Stelle den Mitarbeiter zuerst wieder her.'
                : 'Name existiert bereits.', 'error');
            return;
        }

        if (hourlyRate !== null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) {
            this.showToast('Ungültiger Stundenlohn.', 'error');
            return;
        }

        if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
            this.showToast('Ungültige Handynummer.', 'error');
            return;
        }
        if (weeklyTargetHours !== null && (!Number.isFinite(weeklyTargetHours) || weeklyTargetHours < 0 || weeklyTargetHours > 80)) {
            this.showToast('Ungültige Sollstunden.', 'error');
            return;
        }
        if (weeklyMaxHours !== null && (!Number.isFinite(weeklyMaxHours) || weeklyMaxHours < 0 || weeklyMaxHours > 80)) {
            this.showToast('Ungültige Maximalstunden.', 'error');
            return;
        }
        if (weeklyTargetHours !== null && weeklyMaxHours !== null && weeklyTargetHours > weeklyMaxHours) {
            this.showToast('Sollstunden dürfen nicht höher als die Maximalstunden sein.', 'error');
            return;
        }

        const employeePatch = {
            name,
            type,
            primaryStore,
            stores,
            hourlyRate: hourlyRate,
            phone,
            weeklyTargetHours,
            weeklyMaxHours
        };

        try {
            if (id) {
                await DataManager.updateEmployee({ id, ...employeePatch });
                this.showToast(`${name} aktualisiert!`, 'success');
            } else {
                await DataManager.addEmployee(employeePatch);
                this.showToast(`${name} hinzugefügt!`, 'success');
            }

            this.hideModals();
            this.renderEmployeesTab();
            this.renderAdminView();
        } catch (error) {
            this.showToast(error?.message || 'Mitarbeiter konnte nicht gespeichert werden.', 'error');
        }
    },

    async deleteEmployee(id) {
        const emp = DataManager.getEmployee(id);
        if (!emp) return;

        if (confirm(`${emp.name} archivieren? Historische Pläne und Zeiten bleiben erhalten.`)) {
            try {
                await DataManager.deleteEmployee(id);
                this.renderEmployeesTab();
                this.renderAdminView();
                this.showToast(`${emp.name} archiviert.`, 'success');
            } catch (error) {
                this.showToast(error?.message || 'Mitarbeiter konnte nicht archiviert werden.', 'error');
            }
        }
    },

    async restoreEmployee(id) {
        const employee = DataManager.getEmployee(id);
        if (!employee) return;

        try {
            await DataManager.restoreEmployee(id);
            this.renderEmployeesTab();
            this.renderAdminView();
            this.showToast(`${employee.name} wiederhergestellt.`, 'success');
        } catch (error) {
            this.showToast(error?.message || 'Mitarbeiter konnte nicht wiederhergestellt werden.', 'error');
        }
    },

    async terminateEmployee(id) {
        const employee = DataManager.getEmployee(id);
        if (!employee) return;

        const message = `${employee.name} wirklich entlassen?\n\nDer App-Zugang wird sofort entfernt. Arbeitspläne, Zeiten und Abwesenheiten bleiben als Historie erhalten. Diese Aktion kann nicht über „Wiederherstellen“ rückgängig gemacht werden.`;
        if (!confirm(message)) return;

        try {
            await DataManager.terminateEmployee(id);
            this.renderEmployeesTab();
            this.renderAdminView();
            this.showToast(`${employee.name} wurde entlassen. Der Zugang ist entfernt.`, 'success');
        } catch (error) {
            this.showToast(error?.message || 'Mitarbeiter konnte nicht entlassen werden.', 'error');
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

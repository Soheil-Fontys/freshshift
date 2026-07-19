/**
 * FreshShift cloud data adapter.
 *
 * The existing UI reads synchronously from DataManager. This adapter keeps an
 * in-memory view of the authenticated user's RLS-filtered Supabase data while
 * every mutation is persisted to the database before the cache is updated.
 */
(function () {
    const emptyCache = () => ({
        stores: [],
        employees: [],
        employeeStores: [],
        availabilities: [],
        schedules: [],
        absences: [],
        notifications: []
    });

    let cache = emptyCache();
    let client = null;
    let role = null;
    let authUser = null;
    let profile = null;
    let currentEmployee = null;

    function requireClient() {
        if (!client) throw new Error('Supabase ist nicht verbunden.');
        return client;
    }

    function requireAdmin() {
        if (role !== 'admin') {
            throw new Error('Diese Aktion ist nur für Administratoren erlaubt.');
        }
    }

    function unwrap(result, fallbackMessage) {
        if (result.error) {
            throw new Error(result.error.message || fallbackMessage);
        }
        return result.data;
    }

    function mapEmployee(row, assignments) {
        const links = assignments.filter(link => link.employee_id === row.id);
        const primary = links.find(link => link.is_primary)?.store_id
            || links[0]?.store_id
            || 'fresh_fries';

        return {
            id: row.id,
            name: row.name,
            type: row.type,
            hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate),
            profileId: row.profile_id,
            email: row.email,
            primaryStore: primary,
            stores: links.map(link => link.store_id),
            defaultAvailability: row.default_availability_json || {}
        };
    }

    function mapAvailability(row) {
        return {
            id: row.id,
            storeId: row.store_id,
            employeeId: row.employee_id,
            weekKey: row.week_key,
            days: row.days_json || {},
            notes: row.notes,
            submittedAt: row.submitted_at
        };
    }

    function mapShift(row) {
        return {
            id: row.id,
            scheduleId: row.schedule_id,
            storeId: row.store_id,
            weekKey: row.week_key,
            dayKey: row.day_key,
            employeeId: row.employee_id,
            start: row.start,
            end: row.end,
            actualStart: row.actual_start,
            actualEnd: row.actual_end,
            deviation: row.deviation_json,
            requestStatus: row.request_status,
            requestedAt: row.requested_at,
            respondedAt: row.responded_at,
            responseReason: row.response_reason
        };
    }

    function mapSchedules(scheduleRows, shiftRows) {
        const byId = new Map();

        scheduleRows.forEach(row => {
            byId.set(row.id, {
                id: row.id,
                storeId: row.store_id,
                weekKey: row.week_key,
                released: row.released,
                releasedAt: row.released_at,
                savedAt: row.saved_at,
                shifts: {}
            });
        });

        shiftRows.forEach(row => {
            let schedule = byId.get(row.schedule_id);
            if (!schedule) {
                schedule = {
                    id: row.schedule_id,
                    storeId: row.store_id,
                    weekKey: row.week_key,
                    released: false,
                    releasedAt: null,
                    savedAt: null,
                    shifts: {}
                };
                byId.set(row.schedule_id, schedule);
            }

            if (!schedule.shifts[row.day_key]) schedule.shifts[row.day_key] = [];
            schedule.shifts[row.day_key].push(mapShift(row));
        });

        return Array.from(byId.values()).filter(schedule => {
            if (role === 'admin' || schedule.released) return true;
            return Object.values(schedule.shifts).flat().some(shift => shift.requestStatus === 'pending');
        });
    }

    function mapAbsence(row) {
        return {
            id: row.id,
            employeeId: row.employee_id,
            storeId: row.store_id,
            startDate: row.start_date,
            endDate: row.end_date,
            type: row.type,
            note: row.note,
            status: row.status,
            requestedBy: row.requested_by,
            requestedAt: row.requested_at,
            respondedAt: row.responded_at,
            responseReason: row.response_reason,
            createdAt: row.created_at
        };
    }

    function mapNotification(row) {
        return {
            ...(row.payload || {}),
            id: row.id,
            storeId: row.store_id,
            target: row.target_role,
            targetEmployeeId: row.target_employee_id,
            type: row.type,
            timestamp: row.created_at,
            read: Boolean(row.read_at),
            readAt: row.read_at
        };
    }

    function replaceById(items, item) {
        const index = items.findIndex(existing => existing.id === item.id);
        if (index === -1) items.push(item);
        else items[index] = item;
        return item;
    }

    function replaceExistingById(items, item) {
        const index = items.findIndex(existing => existing.id === item.id);
        if (index !== -1) items[index] = item;
        return index !== -1;
    }

    function scheduleRow(schedule) {
        return {
            store_id: DataManager.normalizeStoreId(schedule.storeId),
            week_key: schedule.weekKey,
            released: Boolean(schedule.released),
            released_at: schedule.releasedAt || null,
            saved_at: schedule.savedAt || new Date().toISOString()
        };
    }

    function flattenShiftRows(schedule) {
        const rows = [];
        Object.entries(schedule.shifts || {}).forEach(([dayKey, shifts]) => {
            (shifts || []).forEach(shift => {
                rows.push({
                    day_key: dayKey,
                    employee_id: shift.employeeId,
                    start_time: shift.start,
                    end_time: shift.end,
                    actual_start: shift.actualStart || null,
                    actual_end: shift.actualEnd || null,
                    deviation_json: shift.deviation || null,
                    request_status: shift.requestStatus || 'none',
                    requested_at: shift.requestedAt || null,
                    responded_at: shift.respondedAt || null,
                    response_reason: shift.responseReason || null
                });
            });
        });
        return rows;
    }

    async function loadCloudData() {
        const supabase = requireClient();
        const userResult = await supabase.auth.getUser();
        const user = unwrap(userResult, 'Sitzung konnte nicht geprüft werden.')?.user;
        if (!user) throw new Error('Keine aktive Supabase-Sitzung.');
        authUser = user;

        const profileResult = await supabase
            .from('profiles')
            .select('id,role,display_name,email')
            .eq('id', user.id)
            .maybeSingle();
        profile = unwrap(profileResult, 'Profil konnte nicht geladen werden.');
        if (!profile) throw new Error('Für dieses Konto wurde kein Profil gefunden.');
        role = profile.role;

        const results = await Promise.all([
            supabase.from('stores').select('id,name').order('name'),
            supabase.from('employees').select('id,name,type,hourly_rate,profile_id,email,default_availability_json').order('name'),
            supabase.from('employee_stores').select('employee_id,store_id,is_primary'),
            supabase.from('availabilities').select('*'),
            supabase.from('schedules').select('*'),
            supabase.from('schedule_shifts').select('*'),
            supabase.from('absences').select('*'),
            supabase.from('notifications').select('*').order('created_at', { ascending: false })
        ]);

        const [stores, employees, employeeStores, availabilities, schedules, shifts, absences, notifications] =
            results.map((result, index) => unwrap(result, `Cloud-Daten konnten nicht geladen werden (${index + 1}).`) || []);

        cache = {
            stores,
            employees: employees.map(row => mapEmployee(row, employeeStores)),
            employeeStores,
            availabilities: availabilities.map(mapAvailability),
            schedules: mapSchedules(schedules, shifts),
            absences: absences.map(mapAbsence),
            notifications: notifications.map(mapNotification)
        };

        currentEmployee = cache.employees.find(employee => employee.profileId === user.id) || null;
        return { role, profile, user, employee: currentEmployee };
    }

    Object.assign(DataManager, {
        async connectToCloud(supabaseClient) {
            client = supabaseClient;
            return loadCloudData();
        },

        async reloadCloudData() {
            return loadCloudData();
        },

        disconnectCloud() {
            cache = emptyCache();
            client = null;
            role = null;
            authUser = null;
            profile = null;
            currentEmployee = null;
        },

        getAuthContext() {
            return { role, profile, user: authUser, employee: currentEmployee };
        },

        getEmployees() {
            return cache.employees;
        },

        getEmployee(id) {
            return cache.employees.find(employee => employee.id === id);
        },

        getEmployeeByName(name) {
            const wanted = String(name || '').toLocaleLowerCase('de');
            return cache.employees.find(employee => String(employee.name || '').toLocaleLowerCase('de') === wanted);
        },

        async addEmployee(employee) {
            requireAdmin();
            const supabase = requireClient();
            const stores = Array.from(new Set(employee.stores || [employee.primaryStore])).filter(Boolean);
            const primaryStore = employee.primaryStore || stores[0];

            const inserted = unwrap(await supabase
                .from('employees')
                .insert({
                    name: employee.name,
                    type: employee.type,
                    hourly_rate: employee.hourlyRate,
                    default_availability_json: employee.defaultAvailability || {}
                })
                .select()
                .single(), 'Mitarbeiter konnte nicht angelegt werden.');

            const links = stores.map(storeId => ({
                employee_id: inserted.id,
                store_id: storeId,
                is_primary: storeId === primaryStore
            }));

            try {
                if (links.length) {
                    unwrap(await supabase.from('employee_stores').insert(links), 'Geschäftszuordnung konnte nicht gespeichert werden.');
                }
            } catch (error) {
                await supabase.from('employees').delete().eq('id', inserted.id);
                throw error;
            }

            cache.employeeStores.push(...links);
            const mapped = mapEmployee(inserted, cache.employeeStores);
            cache.employees.push(mapped);
            return mapped;
        },

        async updateEmployee(employee) {
            requireAdmin();
            const supabase = requireClient();
            const existing = this.getEmployee(employee.id);
            if (!existing) throw new Error('Mitarbeiter nicht gefunden.');

            const merged = { ...existing, ...employee };
            const stores = Array.from(new Set(merged.stores || [merged.primaryStore])).filter(Boolean);
            const primaryStore = merged.primaryStore || stores[0];

            const updated = unwrap(await supabase
                .from('employees')
                .update({
                    name: merged.name,
                    type: merged.type,
                    hourly_rate: merged.hourlyRate,
                    default_availability_json: merged.defaultAvailability || {}
                })
                .eq('id', merged.id)
                .select()
                .single(), 'Mitarbeiter konnte nicht gespeichert werden.');

            unwrap(await supabase.from('employee_stores').delete().eq('employee_id', merged.id), 'Geschäftszuordnung konnte nicht aktualisiert werden.');
            const links = stores.map(storeId => ({
                employee_id: merged.id,
                store_id: storeId,
                is_primary: storeId === primaryStore
            }));
            if (links.length) {
                unwrap(await supabase.from('employee_stores').insert(links), 'Geschäftszuordnung konnte nicht gespeichert werden.');
            }

            cache.employeeStores = cache.employeeStores.filter(link => link.employee_id !== merged.id);
            cache.employeeStores.push(...links);
            const mapped = mapEmployee(updated, cache.employeeStores);
            replaceById(cache.employees, mapped);
            if (currentEmployee?.id === mapped.id) currentEmployee = mapped;
            return mapped;
        },

        async deleteEmployee(id) {
            requireAdmin();
            unwrap(await requireClient().from('employees').delete().eq('id', id), 'Mitarbeiter konnte nicht gelöscht werden.');
            cache.employees = cache.employees.filter(employee => employee.id !== id);
            cache.employeeStores = cache.employeeStores.filter(link => link.employee_id !== id);
        },

        getAvailabilities() {
            return cache.availabilities;
        },

        async saveAvailability(availability) {
            const row = {
                store_id: this.normalizeStoreId(availability.storeId),
                employee_id: availability.employeeId,
                week_key: availability.weekKey,
                days_json: availability.days || {},
                notes: availability.notes || null,
                submitted_at: availability.submittedAt || new Date().toISOString()
            };
            const saved = unwrap(await requireClient()
                .from('availabilities')
                .upsert(row, { onConflict: 'store_id,employee_id,week_key' })
                .select()
                .single(), 'Verfügbarkeit konnte nicht gespeichert werden.');
            const mapped = mapAvailability(saved);
            replaceById(cache.availabilities, mapped);
            return mapped;
        },

        getSchedules() {
            return cache.schedules;
        },

        async saveSchedule(schedule) {
            requireAdmin();
            const supabase = requireClient();
            const row = scheduleRow(schedule);
            const scheduleId = unwrap(await supabase.rpc('save_schedule', {
                p_store_id: row.store_id,
                p_week_key: row.week_key,
                p_released: row.released,
                p_released_at: row.released_at,
                p_saved_at: row.saved_at,
                p_shifts: flattenShiftRows(schedule)
            }), 'Schichtplan konnte nicht gespeichert werden.');

            const [scheduleResult, shiftsResult] = await Promise.all([
                supabase.from('schedules').select('*').eq('id', scheduleId).single(),
                supabase.from('schedule_shifts').select('*').eq('schedule_id', scheduleId)
            ]);
            const savedSchedule = unwrap(scheduleResult, 'Schichtplan konnte nicht neu geladen werden.');
            const savedShifts = unwrap(shiftsResult, 'Schichten konnten nicht neu geladen werden.') || [];

            const mapped = mapSchedules([savedSchedule], savedShifts)[0];
            replaceById(cache.schedules, mapped);
            return mapped;
        },

        async releaseSchedule(weekKey, storeId) {
            requireAdmin();
            const releasedAt = new Date().toISOString();
            const row = unwrap(await requireClient()
                .from('schedules')
                .update({ released: true, released_at: releasedAt })
                .eq('week_key', weekKey)
                .eq('store_id', this.normalizeStoreId(storeId))
                .select()
                .single(), 'Schichtplan konnte nicht freigegeben werden.');

            const existing = cache.schedules.find(schedule => schedule.id === row.id);
            if (existing) {
                existing.released = true;
                existing.releasedAt = row.released_at;
            }
            return existing || null;
        },

        async respondToShiftRequest(shiftId, status, reason) {
            const saved = unwrap(await requireClient()
                .from('schedule_shifts')
                .update({
                    request_status: status,
                    responded_at: new Date().toISOString(),
                    response_reason: reason || null
                })
                .eq('id', shiftId)
                .select()
                .single(), 'Schichtanfrage konnte nicht beantwortet werden.');

            const mapped = mapShift(saved);
            cache.schedules.forEach(schedule => {
                Object.values(schedule.shifts || {}).forEach(shifts => replaceExistingById(shifts, mapped));
            });
            return mapped;
        },

        async reportShiftDeviation(shiftId, changes) {
            const saved = unwrap(await requireClient()
                .from('schedule_shifts')
                .update({
                    actual_start: changes.actualStart || null,
                    actual_end: changes.actualEnd || null,
                    deviation_json: changes.deviation || null
                })
                .eq('id', shiftId)
                .select()
                .single(), 'Abweichung konnte nicht gemeldet werden.');

            const mapped = mapShift(saved);
            cache.schedules.forEach(schedule => {
                Object.values(schedule.shifts || {}).forEach(shifts => replaceExistingById(shifts, mapped));
            });
            return mapped;
        },

        getAbsences() {
            return cache.absences;
        },

        async addAbsence(absence) {
            const saved = unwrap(await requireClient()
                .from('absences')
                .insert({
                    employee_id: absence.employeeId,
                    store_id: absence.storeId || null,
                    start_date: absence.startDate,
                    end_date: absence.endDate,
                    type: absence.type,
                    note: absence.note || null,
                    status: absence.status || (role === 'admin' ? 'approved' : 'pending'),
                    requested_by: absence.requestedBy || (role === 'admin' ? 'admin' : 'employee'),
                    requested_at: absence.requestedAt || new Date().toISOString(),
                    responded_at: absence.respondedAt || null,
                    response_reason: absence.responseReason || null
                })
                .select()
                .single(), 'Abwesenheit konnte nicht gespeichert werden.');
            const mapped = mapAbsence(saved);
            cache.absences.push(mapped);
            return mapped;
        },

        async updateAbsence(absence) {
            requireAdmin();
            const changes = {};
            if ('employeeId' in absence) changes.employee_id = absence.employeeId;
            if ('storeId' in absence) changes.store_id = absence.storeId || null;
            if ('startDate' in absence) changes.start_date = absence.startDate;
            if ('endDate' in absence) changes.end_date = absence.endDate;
            if ('type' in absence) changes.type = absence.type;
            if ('note' in absence) changes.note = absence.note || null;
            if ('status' in absence) changes.status = absence.status;
            if ('respondedAt' in absence) changes.responded_at = absence.respondedAt;
            if ('responseReason' in absence) changes.response_reason = absence.responseReason || null;

            const saved = unwrap(await requireClient()
                .from('absences')
                .update(changes)
                .eq('id', absence.id)
                .select()
                .single(), 'Abwesenheit konnte nicht aktualisiert werden.');
            const mapped = mapAbsence(saved);
            replaceById(cache.absences, mapped);
            return mapped;
        },

        async deleteAbsence(id) {
            requireAdmin();
            unwrap(await requireClient().from('absences').delete().eq('id', id), 'Abwesenheit konnte nicht gelöscht werden.');
            cache.absences = cache.absences.filter(absence => absence.id !== id);
        },

        getNotifications() {
            return cache.notifications;
        },

        async addNotification(notification) {
            const targetRole = notification.target || (notification.targetEmployeeId ? 'employee' : 'admin');
            const payload = { ...notification };
            delete payload.id;
            delete payload.target;
            delete payload.targetEmployeeId;
            delete payload.storeId;
            delete payload.type;
            delete payload.timestamp;
            delete payload.read;

            const saved = unwrap(await requireClient()
                .from('notifications')
                .insert({
                    store_id: notification.storeId || null,
                    target_role: targetRole,
                    target_employee_id: notification.targetEmployeeId || null,
                    type: notification.type,
                    payload
                })
                .select()
                .single(), 'Meldung konnte nicht gesendet werden.');
            const mapped = mapNotification(saved);
            cache.notifications.unshift(mapped);
            return mapped;
        },

        async markNotificationRead(id) {
            const readAt = new Date().toISOString();
            unwrap(await requireClient().from('notifications').update({ read_at: readAt }).eq('id', id), 'Meldung konnte nicht aktualisiert werden.');
            const notification = cache.notifications.find(item => item.id === id);
            if (notification) {
                notification.read = true;
                notification.readAt = readAt;
            }
        },

        async markNotificationsRead() {
            const readAt = new Date().toISOString();
            unwrap(await requireClient().from('notifications').update({ read_at: readAt }).is('read_at', null), 'Meldungen konnten nicht aktualisiert werden.');
            cache.notifications.forEach(notification => {
                notification.read = true;
                notification.readAt = readAt;
            });
        },

        async markAllNotificationsRead() {
            return this.markNotificationsRead();
        },

        async clearNotifications() {
            requireAdmin();
            unwrap(await requireClient().from('notifications').delete().not('id', 'is', null), 'Meldungen konnten nicht gelöscht werden.');
            cache.notifications = [];
        },

        setCurrentUser() {},

        getCurrentUser() {
            return currentEmployee;
        },

        clearCurrentUser() {
            currentEmployee = null;
        },

        setAdminSession() {},

        isAdminSession() {
            return role === 'admin';
        },

        exportBackup() {
            requireAdmin();
            return {
                schemaVersion: 2,
                app: 'freshshift',
                source: 'supabase',
                exportedAt: new Date().toISOString(),
                data: {
                    stores: cache.stores,
                    employees: cache.employees,
                    availabilities: cache.availabilities,
                    schedules: cache.schedules,
                    absences: cache.absences,
                    notifications: cache.notifications
                }
            };
        },

        importBackup() {
            throw new Error('Cloud-Backups können nicht im Browser importiert werden.');
        },

        clearAll() {
            throw new Error('Cloud-Daten können nicht im Browser vollständig gelöscht werden.');
        }
    });
})();

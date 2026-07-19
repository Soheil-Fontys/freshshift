const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('login screen only exposes invited-email authentication', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    assert.match(html, /id="auth-email"/);
    assert.match(html, /id="auth-send-link"/);
    assert.match(html, /js\/cloud-data\.js/);
    assert.doesNotMatch(html, /id="admin-password"/);
    assert.doesNotMatch(html, /id="employee-select"/);
});

test('ISO week keys use the ISO week-year at New Year', () => {
    const context = vm.createContext({
        console,
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        }
    });
    const source = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
    vm.runInContext(source, context);

    assert.equal(vm.runInContext("DateUtils.getWeekKey(new Date(2024, 11, 30))", context), '2025-W01');
    assert.equal(vm.runInContext("DateUtils.getWeekKey(new Date(2026, 0, 1))", context), '2026-W01');
    assert.equal(vm.runInContext("DateUtils.getWeekKey(new Date(2027, 0, 1))", context), '2026-W53');
    assert.equal(vm.runInContext("DataManager.getDateFromWeek(2025, 1).getDay()", context), 1);
    assert.equal(vm.runInContext("DateUtils.formatDateKey(new Date(2026, 6, 20, 0, 30))", context), '2026-07-20');
    assert.equal(vm.runInContext("DateUtils.calculateDuration('22:00', '02:00')", context), 4);
});

test('magic-link login cannot create uninvited users', async () => {
    let otpRequest = null;
    const fakeClient = {
        auth: {
            signInWithOtp: async request => {
                otpRequest = request;
                return { error: null };
            }
        }
    };
    const window = {
        FRESHSHIFT_SUPABASE_URL: 'https://example.supabase.co',
        FRESHSHIFT_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        location: { origin: 'http://localhost:3000', pathname: '/' },
        supabase: { createClient: () => fakeClient }
    };
    const context = vm.createContext({ window, console });
    const source = fs.readFileSync(path.join(root, 'js/supabase.js'), 'utf8');
    vm.runInContext(source, context);

    await window.FreshShiftSupabase.sendMagicLink('  USER@EXAMPLE.COM  ');

    assert.equal(otpRequest.email, 'user@example.com');
    assert.equal(otpRequest.options.shouldCreateUser, false);
    assert.equal(otpRequest.options.emailRedirectTo, 'http://localhost:3000/');
});

test('Edge Function errors surface the safe server message', async () => {
    const fakeClient = {
        functions: {
            invoke: async () => ({
                data: null,
                error: {
                    message: 'Edge Function returned a non-2xx status code',
                    context: { clone: () => ({ json: async () => ({ error: 'Active employee not found' }) }) }
                }
            })
        }
    };
    const window = {
        FRESHSHIFT_SUPABASE_URL: 'https://example.supabase.co',
        FRESHSHIFT_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        location: { origin: 'http://localhost:3000', pathname: '/' },
        supabase: { createClient: () => fakeClient }
    };
    const context = vm.createContext({ window, console, Error });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/supabase.js'), 'utf8'), context);

    await assert.rejects(
        window.FreshShiftSupabase.invoke('invite-employee', {}),
        /Active employee not found/
    );
});

test('cloud adapter maps RLS-filtered relational data into the existing UI model', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const employeeId = '22222222-2222-4222-8222-222222222222';
    const scheduleId = '33333333-3333-4333-8333-333333333333';
    const rows = {
        profiles: { id: userId, role: 'employee', display_name: 'Test', email: 'test@example.com' },
        stores: [{ id: 'fresh_fries', name: 'Fresh Fries' }],
        employees: [{
            id: employeeId,
            name: 'Test Employee',
            type: 'aushilfe',
            hourly_rate: 13.5,
            profile_id: userId,
            email: 'test@example.com',
            active: true,
            archived_at: null,
            default_availability_json: {}
        }, {
            id: '55555555-5555-4555-8555-555555555555',
            name: 'Archived Employee',
            type: 'aushilfe',
            hourly_rate: null,
            profile_id: null,
            email: null,
            active: false,
            archived_at: '2026-07-01T10:00:00Z',
            default_availability_json: {}
        }],
        employee_stores: [
            { employee_id: employeeId, store_id: 'fresh_fries', is_primary: true },
            { employee_id: '55555555-5555-4555-8555-555555555555', store_id: 'fresh_fries', is_primary: true }
        ],
        availabilities: [],
        schedules: [{
            id: scheduleId,
            store_id: 'fresh_fries',
            week_key: '2026-W30',
            released: true,
            released_at: '2026-07-20T10:00:00Z',
            saved_at: '2026-07-19T10:00:00Z'
        }],
        schedule_shifts: [{
            id: '44444444-4444-4444-8444-444444444444',
            schedule_id: scheduleId,
            store_id: 'fresh_fries',
            week_key: '2026-W30',
            day_key: 'monday',
            employee_id: employeeId,
            start: '10:00',
            end: '18:00',
            actual_start: null,
            actual_end: null,
            deviation_json: null,
            request_status: 'none',
            requested_at: null,
            responded_at: null,
            response_reason: null
        }],
        absences: [],
        notifications: []
    };

    class Query {
        constructor(table) {
            this.table = table;
        }
        select() { return this; }
        eq() { return this; }
        order() { return this; }
        maybeSingle() { return Promise.resolve({ data: rows[this.table], error: null }); }
        then(resolve, reject) {
            return Promise.resolve({ data: rows[this.table], error: null }).then(resolve, reject);
        }
    }

    const supabase = {
        auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
        from: table => new Query(table)
    };
    const context = vm.createContext({
        console,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/cloud-data.js'), 'utf8'), context);

    context.supabaseForTest = supabase;
    const authContext = await vm.runInContext('DataManager.connectToCloud(supabaseForTest)', context);

    assert.equal(authContext.role, 'employee');
    assert.equal(authContext.employee.id, employeeId);
    assert.deepEqual(Array.from(authContext.employee.stores), ['fresh_fries']);
    assert.equal(vm.runInContext('DataManager.getEmployees().length', context), 1);
    assert.equal(vm.runInContext('DataManager.getArchivedEmployees().length', context), 1);
    assert.equal(vm.runInContext('DataManager.getEmployee("55555555-5555-4555-8555-555555555555").active', context), false);
    assert.equal(vm.runInContext("DataManager.getScheduleForWeek('2026-W30', 'fresh_fries').shifts.monday[0].start", context), '10:00');
    assert.equal(vm.runInContext("DataManager.getScheduleForWeek('2026-W30', 'fresh_fries').shifts.monday[0].employeeName", context), 'Test Employee');
});

test('HTML rendering helpers escape stored user content and action data', () => {
    const context = vm.createContext({
        console,
        document: { addEventListener: () => {} },
        window: {},
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), context);

    context.attackForTest = `<img src=x onerror="alert(1)">'`;
    const escaped = vm.runInContext('App.escapeHtml(attackForTest)', context);
    assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;');
    assert.equal(vm.runInContext(`App.encodeActionData("O'Reilly")`, context), 'O%27Reilly');
    assert.equal(vm.runInContext(`App.timeRange('22:00', '02:00').end`, context), 1560);
    assert.equal(vm.runInContext(`App.formatMinutesToTime(1500)`, context), '01:00');
});

test('release validation blocks invalid and unresolved shifts', () => {
    const context = vm.createContext({
        console,
        document: { addEventListener: () => {} },
        window: {},
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), context);
    vm.runInContext(`
        DataManager.getEmployee = () => ({ id: 'employee-1', name: 'Test', active: true });
        DataManager.getEmployeeAbsenceForDate = () => null;
        DataManager.getEmployeeAvailability = () => ({
            days: { monday: { available: true, start: '08:00', end: '20:00' } }
        });
        DataManager.getSchedules = () => [];
        DataManager.getStoreName = id => id;
        scheduleForTest = {
            storeId: 'fresh_fries',
            weekKey: DateUtils.getWeekKey(App.currentWeek),
            shifts: {
                monday: [{
                    employeeId: 'employee-1',
                    start: '10:00',
                    end: '18:00',
                    requestStatus: 'pending'
                }]
            }
        };
    `, context);

    const pending = vm.runInContext(`App.validateScheduleForRelease(scheduleForTest, 'fresh_fries')`, context);
    assert.equal(pending.errors.length, 1);
    assert.match(pending.errors[0], /noch offen/);

    vm.runInContext(`scheduleForTest.shifts.monday[0].requestStatus = 'none'`, context);
    const valid = vm.runInContext(`App.validateScheduleForRelease(scheduleForTest, 'fresh_fries')`, context);
    assert.deepEqual(Array.from(valid.errors), []);
    assert.deepEqual(Array.from(valid.warnings), []);

    vm.runInContext(`scheduleForTest.shifts.monday[0].end = '10:00'`, context);
    const invalidTime = vm.runInContext(`App.validateScheduleForRelease(scheduleForTest, 'fresh_fries')`, context);
    assert.match(invalidTime.errors.join(' '), /ungültige Zeiten/);
});

test('production hardening preserves history and separates save from release', () => {
    const migration = fs.readFileSync(
        path.join(root, 'supabase/migrations/20260719223525_production_hardening.sql'),
        'utf8'
    );
    const edgeFunction = fs.readFileSync(
        path.join(root, 'supabase/functions/invite-employee/index.ts'),
        'utf8'
    );

    assert.match(migration, /create or replace function public\.archive_employee/);
    assert.match(migration, /create or replace function public\.restore_employee/);
    assert.match(migration, /create or replace function public\.release_schedule/);
    assert.match(migration, /set released = false,/);
    assert.match(edgeFunction, /invite-employee email rollback failed/);
    assert.match(edgeFunction, /\.eq\("active", true\)/);
});

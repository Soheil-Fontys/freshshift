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
            default_availability_json: {}
        }],
        employee_stores: [{ employee_id: employeeId, store_id: 'fresh_fries', is_primary: true }],
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
    assert.equal(vm.runInContext("DataManager.getScheduleForWeek('2026-W30', 'fresh_fries').shifts.monday[0].start", context), '10:00');
});

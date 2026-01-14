(function () {
    const statusEl = () => document.getElementById('cloud-login-status');

    function setStatus(text) {
        const el = statusEl();
        if (el) el.textContent = text;
    }

    function getConfig() {
        const url = window.FRESHSHIFT_SUPABASE_URL || localStorage.getItem('freshshift_supabase_url') || '';
        const key = window.FRESHSHIFT_SUPABASE_ANON_KEY || localStorage.getItem('freshshift_supabase_anon_key') || '';
        return { url, key };
    }

    function ensureClient() {
        const { url, key } = getConfig();
        if (!url || !key) {
            setStatus('Supabase nicht konfiguriert (URL/Anon Key fehlen).');
            return null;
        }
        if (!window.supabase || !window.supabase.createClient) {
            setStatus('Supabase SDK nicht geladen.');
            return null;
        }
        if (!window.__freshshiftSupabase) {
            window.__freshshiftSupabase = window.supabase.createClient(url, key);
        }
        return window.__freshshiftSupabase;
    }

    async function refreshUi() {
        const client = ensureClient();
        const connectedEl = document.getElementById('cloud-login-connected');
        const signoutBtn = document.getElementById('cloud-signout');

        if (!client) {
            if (connectedEl) connectedEl.style.display = 'none';
            if (signoutBtn) signoutBtn.style.display = 'none';
            return;
        }

        const { data } = await client.auth.getSession();
        const email = data?.session?.user?.email;

        if (email) {
            if (connectedEl) {
                connectedEl.style.display = 'block';
                connectedEl.textContent = `Verbunden als ${email}`;
            }
            if (signoutBtn) signoutBtn.style.display = 'block';
            setStatus('');
        } else {
            if (connectedEl) connectedEl.style.display = 'none';
            if (signoutBtn) signoutBtn.style.display = 'none';
        }
    }

    async function sendMagicLink() {
        const client = ensureClient();
        if (!client) return;

        const emailInput = document.getElementById('cloud-email');
        const email = (emailInput?.value || '').trim();
        if (!email) {
            setStatus('Bitte Email eingeben.');
            return;
        }

        setStatus('Sende Magic Link…');

        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await client.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: redirectTo }
        });

        if (error) {
            setStatus(`Fehler: ${error.message}`);
            return;
        }

        setStatus('Magic Link gesendet. Öffne den Link in deiner Email.');
    }

    async function signOut() {
        const client = ensureClient();
        if (!client) return;
        await client.auth.signOut();
        setStatus('Abgemeldet.');
        await refreshUi();
    }

    function init() {
        // Bind buttons if they exist
        const sendBtn = document.getElementById('cloud-send-link');
        if (sendBtn) sendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sendMagicLink();
        });

        const signoutBtn = document.getElementById('cloud-signout');
        if (signoutBtn) signoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut();
        });

        const client = ensureClient();
        if (client) {
            client.auth.onAuthStateChange(() => {
                refreshUi();
            });
        }

        refreshUi();
    }

    async function getAccessToken() {
        const client = ensureClient();
        if (!client) return null;
        const { data } = await client.auth.getSession();
        return data?.session?.access_token || null;
    }

    window.FreshShiftSupabase = {
        init,
        ensureClient,
        getAccessToken
    };
})();

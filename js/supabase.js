(function () {
    let client = null;
    let authSubscription = null;

    function getConfig() {
        const url = window.FRESHSHIFT_SUPABASE_URL || '';
        const key = window.FRESHSHIFT_SUPABASE_PUBLISHABLE_KEY || '';
        return { url, key };
    }

    function ensureClient() {
        if (client) return client;

        const { url, key } = getConfig();
        if (!url || !key) {
            throw new Error('Supabase ist nicht konfiguriert.');
        }
        if (!window.supabase?.createClient) {
            throw new Error('Supabase SDK wurde nicht geladen.');
        }

        client = window.supabase.createClient(url, key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
        return client;
    }

    async function init(onAuthChange) {
        const supabaseClient = ensureClient();
        if (authSubscription) authSubscription.unsubscribe();

        const { data: sessionData, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        await onAuthChange?.('INITIAL_SESSION', sessionData.session);

        let skipInitialEvent = true;
        const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION' && skipInitialEvent) {
                skipInitialEvent = false;
                return;
            }
            skipInitialEvent = false;
            window.setTimeout(() => onAuthChange?.(event, session), 0);
        });
        authSubscription = data.subscription;
    }

    async function sendMagicLink(email) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail) throw new Error('Bitte eine Email-Adresse eingeben.');

        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { error } = await ensureClient().auth.signInWithOtp({
            email: normalizedEmail,
            options: {
                emailRedirectTo: redirectTo,
                shouldCreateUser: false
            }
        });
        if (error) throw error;
    }

    async function signOut() {
        const { error } = await ensureClient().auth.signOut();
        if (error) throw error;
    }

    async function getSession() {
        const { data, error } = await ensureClient().auth.getSession();
        if (error) throw error;
        return data.session;
    }

    async function getAccessToken() {
        const session = await getSession();
        return session?.access_token || null;
    }

    async function invoke(functionName, body) {
        const { data, error } = await ensureClient().functions.invoke(functionName, { body });
        if (error) {
            let message = error.message || 'Serverfunktion fehlgeschlagen.';
            try {
                const response = error.context;
                if (response?.clone) {
                    const payload = await response.clone().json();
                    if (payload?.error) message = payload.error;
                }
            } catch {
                // Keep the SDK error when the response body is unavailable.
            }
            throw new Error(message);
        }
        return data;
    }

    window.FreshShiftSupabase = {
        init,
        ensureClient,
        sendMagicLink,
        signOut,
        getSession,
        getAccessToken,
        invoke
    };
})();

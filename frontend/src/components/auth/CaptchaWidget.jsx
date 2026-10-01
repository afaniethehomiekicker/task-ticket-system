import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Login security check. Asks the backend (GET /api/auth/captcha-config) which
// provider and site key to use, loads that provider's script, and renders the
// widget. Works with Cloudflare Turnstile, hCaptcha and reCAPTCHA v2 — the
// server's CAPTCHA_PROVIDER decides, so nothing here needs a rebuild when keys
// change.
//
// Props:
//   onToken(token|null)  called with the token when solved, null when it expires/errors/resets
//   onStatus(status)     'loading' | 'ready' | 'off' | 'error'
// Ref:
//   reset()              clears the widget — call after every failed login,
//                        because each token can be used only once.

const PROVIDERS = {
  turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', global: 'turnstile' },
  hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit', global: 'hcaptcha' },
  recaptcha: { src: 'https://www.google.com/recaptcha/api.js?render=explicit', global: 'grecaptcha' },
};

let configPromise = null;
const fetchCaptchaConfig = () => {
  if (!configPromise) {
    configPromise = fetch('/api/auth/captcha-config')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .catch(() => {
        configPromise = null; // allow a retry on the next mount
        return { enabled: false };
      });
  }
  return configPromise;
};

const scriptPromises = {};
const loadProviderScript = (provider) => {
  const { src, global } = PROVIDERS[provider];
  if (!scriptPromises[provider]) {
    scriptPromises[provider] = new Promise((resolve, reject) => {
      const fail = (msg) => {
        delete scriptPromises[provider];
        reject(new Error(msg));
      };
      if (!document.querySelector(`script[src="${src}"]`)) {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.defer = true;
        s.onerror = () => fail('script failed to load');
        document.head.appendChild(s);
      }
      // The script defines its global a little after it loads (reCAPTCHA
      // especially), so wait until render() actually exists.
      const started = Date.now();
      const poll = () => {
        if (typeof window[global]?.render === 'function') return resolve(window[global]);
        if (Date.now() - started > 15000) return fail('timed out');
        setTimeout(poll, 100);
      };
      poll();
    });
  }
  return scriptPromises[provider];
};

export const CaptchaWidget = forwardRef(({ onToken, onStatus, theme = 'dark' }, ref) => {
  const containerRef = useRef(null);
  const widgetRef = useRef(null); // { api, id }
  const onTokenRef = useRef(onToken);
  const onStatusRef = useRef(onStatus);
  onTokenRef.current = onToken;
  onStatusRef.current = onStatus;

  const [status, setStatus] = useState('loading');
  const report = (s) => {
    setStatus(s);
    onStatusRef.current?.(s);
  };

  useImperativeHandle(ref, () => ({
    reset() {
      const w = widgetRef.current;
      if (w) {
        try { w.api.reset(w.id); } catch { /* widget already gone */ }
      }
      onTokenRef.current?.(null);
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    // Render into a fresh child element each time: reCAPTCHA refuses to
    // render twice into the same element (React StrictMode mounts twice).
    const el = document.createElement('div');
    containerRef.current?.appendChild(el);

    report('loading');
    (async () => {
      const cfg = await fetchCaptchaConfig();
      if (cancelled) return;
      if (!cfg.enabled || !cfg.site_key || !PROVIDERS[cfg.provider]) {
        report('off');
        return;
      }
      try {
        const api = await loadProviderScript(cfg.provider);
        if (cancelled) return;
        const id = api.render(el, {
          sitekey: cfg.site_key,
          theme,
          callback: (token) => onTokenRef.current?.(token),
          'expired-callback': () => onTokenRef.current?.(null),
          'error-callback': () => onTokenRef.current?.(null),
        });
        widgetRef.current = { api, id };
        report('ready');
      } catch {
        if (!cancelled) report('error');
      }
    })();

    return () => {
      cancelled = true;
      const w = widgetRef.current;
      if (w && typeof w.api.remove === 'function') {
        try { w.api.remove(w.id); } catch { /* ignore */ }
      }
      widgetRef.current = null;
      el.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return (
    <div className={status === 'off' ? 'hidden' : 'flex flex-col items-center gap-1 min-h-[65px]'}>
      <div ref={containerRef} />
      {status === 'loading' && (
        <p className="text-[11px] text-slate-400">Loading security check…</p>
      )}
      {status === 'error' && (
        <p className="text-[11px] text-rose-400">
          Couldn't load the security check. Check your connection and reload the page.
        </p>
      )}
    </div>
  );
});

CaptchaWidget.displayName = 'CaptchaWidget';

/**
 * GA4 inside the app shell. The server injects the measurement id as a meta
 * tag only when analytics is configured, so this module is a no-op otherwise.
 * Page views are sent manually on route changes; no personal data is sent.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;
let ready = false;

export function initAnalytics(): void {
  if (ready) return;
  const id = document.querySelector('meta[name="grantconsole-ga"]')?.getAttribute('content') ?? '';
  if (!GA_ID_PATTERN.test(id)) return;
  window.dataLayer = window.dataLayer ?? [];
  // gtag expects the raw `arguments` object, not an array.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
  window.gtag('js', new Date());
  window.gtag('config', id, { send_page_view: false, anonymize_ip: true });
  ready = true;
}

export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (!ready || !window.gtag) return;
  window.gtag('event', name, params);
}

export function trackPageView(path: string): void {
  trackEvent('page_view', { page_path: path, page_location: `${window.location.origin}${path}`, page_title: document.title });
}

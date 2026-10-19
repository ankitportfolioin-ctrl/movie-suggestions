/**
 * Client tracker: fires a pageview beacon once per page, and typed events.
 * Anonymous-only: session + anon ids live in localStorage, no cookies sent beyond same-origin beacons.
 */
const PAGEVIEW_URL = '/api/analytics/pageview';
const EVENT_URL = '/api/analytics/event';

function localId(key: string): string {
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}

export function sessionMeta(): { sessionId: string; anonId: string } {
  return { sessionId: localId('cm_session_id'), anonId: localId('cm_anon_id') };
}

export function trackPageviewOnce(): void {
  if (sessionStorage.getItem('cm_pageview_sent')) return;
  sessionStorage.setItem('cm_pageview_sent', '1');
  const { sessionId, anonId } = sessionMeta();
  fetch(PAGEVIEW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      sessionId,
      anonId,
      path: location.pathname,
      referrer: document.referrer || '',
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      screenWidth: screen.width,
      screenHeight: screen.height,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  }).catch(() => { /* analytics must never break the app */ });
}

export function trackEvent(eventType: string, eventData: Record<string, unknown> = {}): void {
  const { sessionId, anonId } = sessionMeta();
  fetch(EVENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ sessionId, anonId, eventType, eventData, pagePath: location.pathname }),
  }).catch(() => { /* analytics must never break the app */ });
}

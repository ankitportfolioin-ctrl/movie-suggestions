/**
 * Anonymous feedback sender (Step 2).
 *
 * anonId is a random browser UUID in localStorage — no login, no IP,
 * no email. Every event carries the server-signed impression token
 * issued with the recommendation, so forged events are rejected.
 * Sending never throws: feedback must never break the UI.
 */

export const ANON_KEY = 'cinematch:anon-id:v1';
export const TASTE_KEY_PREFIX = 'cinematch:taste';

export type FeedbackAction =
  | 'save'
  | 'provider_click'
  | 'more_like_this'
  | 'less_like_this'
  | 'seen_it'
  | 'seen_it_liked'
  | 'not_for_me'
  | 'different_picks';

/**
 * Signed signal strengths consumed by the taste model (Step 3).
 * Named constants — the only place these numbers live.
 */
export const SIGNAL_WEIGHTS: Record<FeedbackAction, number> = {
  save: 1.0,
  provider_click: 0.7,
  more_like_this: 0.8,
  less_like_this: -0.5,
  seen_it_liked: 0.5,
  not_for_me: -1.0,
  different_picks: -0.15,
  seen_it: 0, // neutral exclusion only: never shown again, no taste signal
};

/** back-to-filters is ambiguous (could be curiosity), so it sends nothing. */
export const IGNORED_ACTIONS = new Set(['back_to_filters']);

export interface ImpressionToken {
  movieId: number;
  impressionId: string;
  token: string;
}

/** Existing anonId or a fresh random one. 'none' outside a browser. */
export function getAnonId(): string {
  try {
    const existing = localStorage.getItem(ANON_KEY);
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    localStorage.setItem(ANON_KEY, fresh);
    return fresh;
  } catch {
    return 'none';
  }
}

/** Forget local taste state; the server-side rows are deleted by requestTasteReset. */
export function resetTaste(): void {
  try {
    localStorage.removeItem(ANON_KEY);
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(TASTE_KEY_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/** POST one feedback event. Resolves true only when the server stored it. */
export async function sendFeedbackEvent(
  impression: ImpressionToken,
  action: FeedbackAction
): Promise<boolean> {
  try {
    const res = await fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
        impressionId: impression.impressionId,
        anonId: getAnonId(),
        action,
        movieId: impression.movieId,
        token: impression.token,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Ask the server to delete this anonId's stored rows ("Reset my taste").
 * Best effort, never throws: local state is cleared regardless.
 */
export async function requestTasteReset(anonId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/taste/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.ok === true;
  } catch {
    return false;
  }
}

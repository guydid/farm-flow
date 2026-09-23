// Shared, deduplicated reads via React Query's cache.
//
// Previously every page called User.me() and Farm.get() in its own loader, so a
// single navigation fired the same /auth/me and /farms/:id requests 6+ times.
// Routing those through queryClient.fetchQuery dedupes in-flight calls and serves
// cached results across pages — without converting components to hooks.
//
// Safety: switching farms does a full window.location.reload() (Layout.handleFarmChange),
// which discards this in-memory cache; and localAuth.updateMyUserData invalidates ['me']
// after any user-data mutation. So cached identity/farm never goes stale silently.

import { queryClientInstance } from '@/lib/query-client';
import { localAuth } from '@/api/localClient';
import { Farm } from '@/entities/all';

export function getMeCached() {
  return queryClientInstance.fetchQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await localAuth.me();
      // /auth/me מחזיר גם את המשק הנוכחי — מזינים לקאש כדי ש-getFarmCached לא יבצע סבב רשת נוסף
      if (me?.current_farm?.id) queryClientInstance.setQueryData(['farm', me.current_farm.id], me.current_farm);
      return me;
    },
    staleTime: 60 * 1000, // short — keeps farm/role changes fresh
  });
}

export function getFarmCached(id) {
  if (!id) return Promise.resolve(null);
  return queryClientInstance.fetchQuery({
    queryKey: ['farm', id],
    queryFn: () => Farm.get(id),
    staleTime: 5 * 60 * 1000,
  });
}

// Reference/catalog lists (varieties, pesticides, activity types…) change rarely.
export function getListCached(entityKey, fetchFn, staleMs = 10 * 60 * 1000) {
  return queryClientInstance.fetchQuery({
    queryKey: ['list', entityKey],
    queryFn: fetchFn,
    staleTime: staleMs,
  });
}

export function invalidateMe() {
  return queryClientInstance.invalidateQueries({ queryKey: ['me'] });
}

// ביטול קאש של רשימה אחרי עריכה בהגדרות (מוצרים/אריזות וכו') — כדי שהעמודים
// שצורכים אותה דרך getListCached יראו את השינוי מיד ולא אחרי staleTime.
export function invalidateList(entityKey) {
  return queryClientInstance.invalidateQueries({ queryKey: ['list', entityKey] });
}

// הזנת קאש של רשימה שהגיעה מטעינה מרוכזת (batch) — כדי שעמודים אחרים ייהנו ממנה
export function primeList(entityKey, data) {
  if (Array.isArray(data)) queryClientInstance.setQueryData(['list', entityKey], data);
}

// קריאה מהקאש בלבד (ללא רשת) — מחזיר undefined אם אין/פג תוקף
export function peekList(entityKey, staleMs = 10 * 60 * 1000) {
  const st = queryClientInstance.getQueryState(['list', entityKey]);
  if (!st || !Array.isArray(st.data) || st.isInvalidated) return undefined;
  if (Date.now() - (st.dataUpdatedAt || 0) > staleMs) return undefined;
  return st.data;
}

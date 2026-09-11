import { HttpContextToken } from '@angular/common/http';

/** Login, refresh, logout and other public calls must never recursively trigger refresh. */
export const SKIP_AUTH_INTERCEPTOR = new HttpContextToken<boolean>(() => false);

/** A protected request may be replayed at most once after refreshing its access token. */
export const AUTH_RETRY_ATTEMPTED = new HttpContextToken<boolean>(() => false);

import { HttpContextToken } from '@angular/common/http';

/** Public auth endpoints do not need an existing bearer token or session invalidation on 401. */
export const SKIP_AUTH_INTERCEPTOR = new HttpContextToken<boolean>(() => false);

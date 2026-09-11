import { environment as development } from './environment.development';
import { environment as production } from './environment';

describe('API environments', () => {
  it('uses localhost during development and Render in production', () => {
    expect(development.apiBaseUrl).toBe('http://localhost:8080');
    expect(production.apiBaseUrl).toBe('https://gym-tracker-api-s70k.onrender.com');
  });
});

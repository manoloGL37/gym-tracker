import { Injectable, Signal, signal } from '@angular/core';

export type Lang = 'en' | 'es';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private langSignal = signal<Lang>(this.getInitialLang());
  private translations: Record<Lang, any> = { en: {}, es: {} };
  private loaded = false;

  lang = this.langSignal.asReadonly();

  constructor() {
    this.loadTranslations();
  }

  private getInitialLang(): Lang {
    return (localStorage.getItem('lang') as Lang) || 'en';
  }

  private async loadTranslations() {
    const [en, es] = await Promise.all([
      import('../i18n/en.json'),
      import('../i18n/es.json'),
    ]);
    this.translations.en = en.default;
    this.translations.es = es.default;
    this.loaded = true;
  }

  t(key: string, params?: Record<string, any>): string {
    if (!this.loaded) return key;
    const dict = this.translations[this.langSignal()];
    let value = dict[key] || key;
    if (params) {
      for (const k in params) {
        value = value.replace(`{{${k}}}`, params[k]);
      }
    }
    return value;
  }

  setLang(lang: Lang) {
    this.langSignal.set(lang);
    localStorage.setItem('lang', lang);
  }
}

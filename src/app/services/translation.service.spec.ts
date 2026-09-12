import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslationService } from './translation.service';

@Component({ standalone: true, template: `<span>{{ t.t('home.title') }}</span>` })
class TranslationHostComponent { readonly t = inject(TranslationService); }

describe('TranslationService', () => {
  let fixture: ComponentFixture<TranslationHostComponent>;

  beforeEach(() => {
    localStorage.setItem('lang', 'es');
    fixture = TestBed.createComponent(TranslationHostComponent);
  });

  afterEach(() => {
    localStorage.removeItem('lang');
    TestBed.resetTestingModule();
  });

  it('updates rendered copy when asynchronous dictionaries finish loading', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('Inicio');
  });
});

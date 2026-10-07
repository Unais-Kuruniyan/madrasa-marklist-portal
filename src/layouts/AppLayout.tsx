import type { ReactNode } from 'react';
import { paths } from '../hooks/useHashRoute';
import { useTranslation } from '../i18n/context';
import { LanguageToggle } from '../components/ui/LanguageToggle';

export function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('nav.skipToContent')}
      </a>
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-3 sm:px-6">
          <a href={paths.dashboard()} className="flex items-center gap-2 rounded-md font-bold text-slate-900 min-w-0 py-1" id="nav-home">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-white shadow-xs">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4.5" aria-hidden="true">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M9 13h6M9 17h4" />
              </svg>
            </span>
            <span className="text-sm sm:text-lg font-bold text-slate-900 truncate leading-tight">{t('common.appName')}</span>
          </a>

          <LanguageToggle />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 outline-none sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="no-print border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        {t('common.portalName')}
      </footer>
    </div>
  );
}

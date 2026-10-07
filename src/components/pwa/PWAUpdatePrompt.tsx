import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from '../../i18n/context';
import { RefreshIcon, XIcon } from '../ui/Icons';

export const PWAUpdatePrompt: React.FC = () => {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Check for update periodically (every 1 hour)
      if (r) {
        setInterval(() => {
          void r.update();
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('Service worker registration failed:', error);
    },
  });

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-[90] bg-slate-900 text-white p-4 rounded-xl shadow-2xl border border-slate-700 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-5 duration-300"
      style={{
        marginBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-9 rounded-lg bg-blue-600/30 text-blue-400 flex items-center justify-center shrink-0">
          <RefreshIcon className="size-5 animate-spin" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{t('pwa.updateAvailable')}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="px-3 py-1.5 min-h-[44px] sm:min-h-0 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors focus:ring-2 focus:ring-blue-400 focus:outline-none"
        >
          {t('pwa.updateBtn')}
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 text-slate-400 hover:text-white rounded-lg transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none"
          aria-label={t('pwa.dismiss')}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
};

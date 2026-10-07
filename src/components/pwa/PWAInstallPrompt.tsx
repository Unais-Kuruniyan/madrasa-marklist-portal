import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n/context';
import { SmartphoneIcon, DownloadIcon, XIcon } from '../ui/Icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstallPrompt: React.FC = () => {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    // Check if already in standalone mode
    const checkStandalone = () => {
      const isDisplayStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isIosStandalone = (window.navigator as any).standalone === true;
      return isDisplayStandalone || isIosStandalone;
    };

    if (checkStandalone()) {
      setIsStandalone(true);
      return;
    }

    // Check session dismissal
    if (sessionStorage.getItem('pwa_prompt_dismissed') === 'true') {
      setIsDismissed(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsStandalone(true);
      }
      setDeferredPrompt(null);
    } catch (err) {
      console.error('Error during PWA installation:', err);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  // Do not show if already in standalone mode, dismissed, or no install prompt available
  if (isStandalone || isDismissed || !deferredPrompt) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label={t('pwa.installTitle')}
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-[80] bg-white border border-slate-200 rounded-2xl p-4 shadow-xl transition-all duration-300"
      style={{
        marginBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-brand-800/10 text-brand-800 flex items-center justify-center shrink-0">
          <SmartphoneIcon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">
            {t('pwa.installTitle')}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            {t('pwa.installDesc')}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleInstallClick}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-medium text-white bg-brand-800 hover:bg-brand-900 active:bg-slate-900 rounded-lg transition-colors focus:ring-2 focus:ring-brand-500 focus:outline-none shadow-xs"
            >
              <DownloadIcon className="size-3.5" />
              <span>{t('pwa.installBtn')}</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-2 min-h-[44px] text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none"
            >
              {t('pwa.notNow')}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors focus:ring-2 focus:ring-slate-400 focus:outline-none -mr-1 -mt-1"
          aria-label={t('pwa.dismiss')}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
};

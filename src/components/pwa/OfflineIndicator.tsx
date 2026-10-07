import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n/context';
import { WifiOffIcon, WifiIcon } from '../ui/Icons';

export const OfflineIndicator: React.FC = () => {
  const { t } = useTranslation();
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState<boolean>(false);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setShowReconnected(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 3500);
      return () => clearTimeout(timer);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline && !showReconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="aria-live-region fixed top-0 left-0 right-0 z-[100] px-4 py-2 text-sm font-medium shadow-md transition-all duration-300 flex items-center justify-center gap-2"
      style={{
        paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
        backgroundColor: isOffline ? '#ef4444' : '#10b981',
        color: '#ffffff',
      }}
    >
      {isOffline ? (
        <>
          <WifiOffIcon className="size-4 shrink-0 animate-pulse" />
          <span>
            <strong>{t('pwa.offlineTitle')}</strong> — {t('pwa.offlineDesc')}
          </span>
        </>
      ) : (
        <>
          <WifiIcon className="size-4 shrink-0" />
          <span>
            <strong>{t('pwa.backOnline')}</strong>
          </span>
        </>
      )}
    </div>
  );
};

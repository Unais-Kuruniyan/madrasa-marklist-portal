import { useTranslation } from '../../i18n/context';
import { cx } from '../../utils/format';

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useTranslation();

  return (
    <div className={cx('inline-flex shrink-0 items-center rounded-lg border border-slate-300 bg-slate-100 p-1 text-xs font-bold min-h-[44px]', className)}>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={cx(
          'min-h-[36px] min-w-[36px] rounded-md px-2.5 py-1.5 transition-all flex items-center justify-center touch-manipulation',
          language === 'en'
            ? 'bg-brand-800 text-white shadow-xs font-bold'
            : 'text-slate-600 hover:text-slate-900',
        )}
        aria-label="Switch to English"
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLanguage('ml')}
        className={cx(
          'min-h-[36px] rounded-md px-2.5 py-1.5 transition-all flex items-center justify-center touch-manipulation',
          language === 'ml'
            ? 'bg-brand-800 text-white shadow-xs font-bold'
            : 'text-slate-600 hover:text-slate-900',
        )}
        aria-label="മലയാളത്തിലേക്ക് മാറ്റുക"
      >
        മലയാളം
      </button>
    </div>
  );
}

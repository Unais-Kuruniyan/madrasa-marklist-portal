import { useTranslation } from '../../i18n/context';
import { cx } from '../../utils/format';

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useTranslation();

  return (
    <div className={cx('inline-flex items-center rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs font-bold', className)}>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={cx(
          'rounded-md px-2.5 py-1 transition-all',
          language === 'en'
            ? 'bg-brand-800 text-white shadow-xs'
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
          'rounded-md px-2.5 py-1 transition-all',
          language === 'ml'
            ? 'bg-brand-800 text-white shadow-xs'
            : 'text-slate-600 hover:text-slate-900',
        )}
        aria-label="മലയാളത്തിലേക്ക് മാറ്റുക"
      >
        മലയാളം
      </button>
    </div>
  );
}

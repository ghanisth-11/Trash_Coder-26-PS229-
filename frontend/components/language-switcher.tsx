'use client';

import { Check, ChevronDown, Languages } from 'lucide-react';
import { useState } from 'react';
import { AppLanguage, languageByCode, languages, translate } from '@/lib/i18n';

export function LanguageSwitcher({
  language,
  onChange,
  compact = false,
}: {
  language: AppLanguage;
  onChange: (language: AppLanguage) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = languageByCode(language);
  const choose = (next: AppLanguage) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <div className={`language-switcher ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className="language-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={compact ? translate(language, 'language') : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Languages size={18} />
        <span>
          {compact
            ? selected.nativeLabel
            : `${translate(language, 'language')}: ${selected.nativeLabel}`}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="language-menu"
          role="listbox"
          aria-label={translate(language, 'chooseLanguage')}
        >
          <p>{translate(language, 'chooseLanguage')}</p>
          {languages.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={item.code === language}
              key={item.code}
              onClick={() => choose(item.code)}
            >
              <span>
                <b>{item.nativeLabel}</b>
                <small>{item.label}</small>
              </span>
              {item.code === language && <Check size={17} aria-label="Selected" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

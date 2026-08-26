import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Language = 'ru' | 'en'

type Localization = {
  language: Language
  setLanguage: (language: Language) => void
  t: (russian: string, english: string) => string
}

const languageStorageKey = 'memorybox-language'
const LocalizationContext = createContext<Localization | null>(null)

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => window.localStorage.getItem(languageStorageKey) === 'en' ? 'en' : 'ru')
  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language)
  }, [language])
  const t = useCallback((russian: string, english: string) => language === 'en' ? english : russian, [language])
  const value = useMemo(() => ({ language, setLanguage, t }), [language, t])
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
}

export function useLocalization() {
  const localization = useContext(LocalizationContext)
  if (!localization) throw new Error('LocalizationProvider is required')
  return localization
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLocalization()
  const nextLanguage = language === 'ru' ? 'en' : 'ru'
  return <button type="button" className="language-switcher" onClick={() => setLanguage(nextLanguage)} aria-label={t('Переключить язык на английский', 'Switch language to Russian')} title={t('Переключить язык на английский', 'Switch language to Russian')}>
    {language === 'ru' ? 'EN' : 'RU'}
  </button>
}

export function formatNok(amount: number, locale: 'nb' | 'en' = 'nb'): string {
  return new Intl.NumberFormat(locale === 'nb' ? 'nb-NO' : 'en-GB', {
    style: 'currency',
    currency: 'NOK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

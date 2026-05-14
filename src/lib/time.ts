export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'nå';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} t`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(dateStr).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

export function formatDate(dateStr: string, style: 'short' | 'medium' | 'long' = 'short'): string {
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'  ? { day: 'numeric', month: 'long', year: 'numeric' } :
    style === 'medium' ? { day: 'numeric', month: 'short', year: 'numeric' } :
                         { day: 'numeric', month: 'short' };
  return new Date(dateStr).toLocaleDateString('nb-NO', opts);
}

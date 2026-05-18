import { defineMiddleware } from 'astro:middleware';

const STRIKKETORGET_HOSTS = ['strikketorget.no', 'www.strikketorget.no'];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const host = ctx.url.hostname;
  const path = ctx.url.pathname;

  const isStrikketorget = STRIKKETORGET_HOSTS.includes(host)
    || ctx.url.searchParams.get('strikketorget') === '1';
  ctx.locals.isStrikketorget = isStrikketorget;

  if (isStrikketorget && path === '/') {
    return ctx.redirect('/marked');
  }

  if (path.startsWith('/admin')) {
    const { getCurrentUser } = await import('./lib/auth');
    const user = await getCurrentUser({ request: ctx.request, cookies: ctx.cookies });
    if (!user) return ctx.redirect('/logg-inn');
  }

  return next();
});

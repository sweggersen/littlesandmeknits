import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;

  if (path.startsWith('/admin')) {
    const { getCurrentUser } = await import('./lib/auth');
    const user = await getCurrentUser({ request: ctx.request, cookies: ctx.cookies });
    if (!user) return ctx.redirect('/logg-inn');
  }

  return next();
});

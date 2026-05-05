import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../lib/auth';

export const GET: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser({ request, cookies });
  return new Response(
    JSON.stringify({ user: user ? { id: user.id, email: user.email } : null }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
      },
    }
  );
};

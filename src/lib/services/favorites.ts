import type { ServiceContext, ServiceResult } from './types';
import { ok, fail } from './types';

const VALID_TYPES = new Set(['listing', 'commission_request']);

export async function toggleFavorite(
  ctx: ServiceContext,
  input: { itemType: string; itemId: string },
): Promise<ServiceResult<{ favorited: boolean }>> {
  if (!VALID_TYPES.has(input.itemType)) return fail('bad_input', 'Invalid item type');
  if (!input.itemId) return fail('bad_input', 'Missing item ID');

  const { error } = await ctx.supabase
    .from('favorites')
    .insert({ user_id: ctx.user.id, item_type: input.itemType, item_id: input.itemId });

  if (error?.code === '23505') {
    await ctx.supabase
      .from('favorites')
      .delete()
      .eq('user_id', ctx.user.id)
      .eq('item_type', input.itemType)
      .eq('item_id', input.itemId);
    return ok({ favorited: false });
  }

  if (error) {
    console.error('Favorite toggle failed', error);
    return fail('server_error', 'Could not toggle favorite');
  }

  return ok({ favorited: true });
}

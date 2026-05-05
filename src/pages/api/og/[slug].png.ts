import type { APIRoute } from 'astro';
import { createServerSupabase } from '../../../lib/supabase';
import { projectPhotoUrl } from '../../../lib/storage';
import { loadOgFonts } from '../../../lib/og-fonts';
import { renderPng, fetchAsDataUrl, type SatoriNode } from '../../../lib/og-render';

const STATUS_LABEL: Record<string, string> = {
  planning: 'Planlegges',
  active: 'I gang',
  finished: 'Ferdig',
  frogged: 'Røket opp',
};

const STATUS_BG: Record<string, string> = {
  planning: '#E8DFD0',
  active: '#E8EFE3',
  finished: '#FBEAE3',
  frogged: '#E5E3DD',
};

const STATUS_FG: Record<string, string> = {
  planning: '#5B544A',
  active: '#4A5A3F',
  finished: '#C76D4E',
  frogged: '#6F6A60',
};

type Format = 'feed' | 'story';

function buildFeedTree(args: {
  hero: string | null;
  status: string;
  title: string;
  summary: string | null;
  recipient: string | null;
  yarn: string | null;
  url: string;
}): SatoriNode {
  const { hero, status, title, summary, recipient, yarn, url } = args;
  const meta = [recipient && `For ${recipient}`, yarn].filter(Boolean).join(' · ');

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '1080px',
        height: '1350px',
        backgroundColor: '#FAF6F0',
        fontFamily: 'Inter',
      },
      children: [
        // Photo half
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: '100%',
              height: '780px',
              backgroundColor: '#E8DFD0',
              backgroundImage: hero ? `url(${hero})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            },
          },
        },
        // Info card
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 0',
              padding: '60px 80px',
              justifyContent: 'space-between',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column', gap: '20px' },
                  children: [
                    // Status pill
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignSelf: 'flex-start',
                          backgroundColor: STATUS_BG[status] ?? '#E8DFD0',
                          color: STATUS_FG[status] ?? '#5B544A',
                          fontSize: '20px',
                          fontWeight: 700,
                          letterSpacing: '0.18em',
                          textTransform: 'uppercase',
                          padding: '10px 22px',
                          borderRadius: '999px',
                        },
                        children: STATUS_LABEL[status] ?? 'Prosjekt',
                      },
                    },
                    // Title
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontFamily: 'Fraunces',
                          fontSize: '76px',
                          fontWeight: 500,
                          lineHeight: 1.05,
                          color: '#2C2A26',
                          letterSpacing: '-0.01em',
                        },
                        children: title,
                      },
                    },
                    summary && {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontSize: '24px',
                          color: 'rgba(44,42,38,0.7)',
                          lineHeight: 1.4,
                        },
                        children: summary.length > 110 ? summary.slice(0, 107) + '…' : summary,
                      },
                    },
                    meta && {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontSize: '22px',
                          color: 'rgba(44,42,38,0.55)',
                        },
                        children: meta,
                      },
                    },
                  ].filter(Boolean) as SatoriNode[],
                },
              },
              // Footer
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '24px',
                    borderTop: '1px solid rgba(0,0,0,0.08)',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontFamily: 'Fraunces',
                          fontSize: '28px',
                          color: '#2C2A26',
                          fontWeight: 500,
                        },
                        children: 'Littles and Me',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontSize: '18px',
                          color: '#C76D4E',
                          fontWeight: 600,
                          letterSpacing: '0.18em',
                          textTransform: 'uppercase',
                        },
                        children: url,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function buildStoryTree(args: {
  hero: string | null;
  status: string;
  title: string;
  summary: string | null;
  url: string;
}): SatoriNode {
  const { hero, status, title, summary, url } = args;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '1080px',
        height: '1920px',
        backgroundColor: '#2C2A26',
        backgroundImage: hero ? `url(${hero})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        fontFamily: 'Inter',
      },
      children: [
        // Scrim
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 0',
              width: '100%',
              backgroundImage:
                'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.78) 100%)',
              padding: '120px 90px',
              justifyContent: 'space-between',
              color: '#FAF6F0',
            },
            children: [
              // Top brand
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    justifyContent: 'center',
                    fontFamily: 'Fraunces',
                    fontStyle: 'italic',
                    fontSize: '28px',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    opacity: 0.92,
                  },
                  children: 'Littles and Me',
                },
              },
              // Bottom info
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '28px',
                    alignItems: 'center',
                    textAlign: 'center',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          backgroundColor: '#C76D4E',
                          color: '#FAF6F0',
                          fontSize: '22px',
                          fontWeight: 700,
                          letterSpacing: '0.18em',
                          textTransform: 'uppercase',
                          padding: '12px 26px',
                          borderRadius: '999px',
                        },
                        children: STATUS_LABEL[status] ?? 'Prosjekt',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontFamily: 'Fraunces',
                          fontSize: '108px',
                          fontWeight: 500,
                          lineHeight: 1.04,
                          letterSpacing: '-0.01em',
                          maxWidth: '900px',
                          textAlign: 'center',
                          justifyContent: 'center',
                        },
                        children: title,
                      },
                    },
                    summary && {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          fontFamily: 'Fraunces',
                          fontStyle: 'italic',
                          fontSize: '32px',
                          lineHeight: 1.4,
                          opacity: 0.9,
                          maxWidth: '780px',
                          textAlign: 'center',
                          justifyContent: 'center',
                        },
                        children: summary.length > 130 ? summary.slice(0, 127) + '…' : summary,
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          marginTop: '20px',
                          paddingTop: '24px',
                          borderTop: '1px solid rgba(255,255,255,0.3)',
                          fontSize: '22px',
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                          opacity: 0.85,
                        },
                        children: url,
                      },
                    },
                  ].filter(Boolean) as SatoriNode[],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export const GET: APIRoute = async ({ params, request, cookies, url }) => {
  const slug = params.slug;
  if (!slug) return new Response('Not found', { status: 404 });

  const formatParam = url.searchParams.get('format');
  const format: Format = formatParam === 'story' ? 'story' : 'feed';

  const supabase = createServerSupabase({ request, cookies });
  const { data: project } = await supabase
    .from('projects')
    .select('title, summary, status, recipient, yarn, hero_photo_path, public_slug')
    .eq('public_slug', slug)
    .maybeSingle();

  if (!project) return new Response('Not found', { status: 404 });

  const heroPath = project.hero_photo_path as string | null;
  const heroPublicUrl = projectPhotoUrl(heroPath);
  const heroDataUrl = heroPublicUrl ? await fetchAsDataUrl(heroPublicUrl) : null;

  const fonts = await loadOgFonts();

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://www.littlesandmeknits.com';
  const displayUrl = `littlesandmeknits.com/p/${project.public_slug}`;

  let png: Uint8Array;
  try {
    if (format === 'story') {
      const tree = buildStoryTree({
        hero: heroDataUrl,
        status: (project.status as string) ?? 'active',
        title: (project.title as string) ?? 'Prosjekt',
        summary: (project.summary as string | null) ?? null,
        url: displayUrl,
      });
      png = await renderPng(tree, {
        width: 1080,
        height: 1920,
        fonts: [
          { name: 'Inter', data: fonts.inter, weight: 500 },
          { name: 'Inter', data: fonts.interBold, weight: 700 },
          { name: 'Fraunces', data: fonts.fraunces, weight: 500 },
        ],
      });
    } else {
      const tree = buildFeedTree({
        hero: heroDataUrl,
        status: (project.status as string) ?? 'active',
        title: (project.title as string) ?? 'Prosjekt',
        summary: (project.summary as string | null) ?? null,
        recipient: (project.recipient as string | null) ?? null,
        yarn: (project.yarn as string | null) ?? null,
        url: displayUrl,
      });
      png = await renderPng(tree, {
        width: 1080,
        height: 1350,
        fonts: [
          { name: 'Inter', data: fonts.inter, weight: 500 },
          { name: 'Inter', data: fonts.interBold, weight: 700 },
          { name: 'Fraunces', data: fonts.fraunces, weight: 500 },
        ],
      });
    }
  } catch (err) {
    const stage = (err as { stage?: string })?.stage ?? 'unknown';
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('OG render failed', { stage, message, stack, slug, format });
    return new Response(`Render failed: [${stage}] ${message}`, { status: 500 });
  }

  // Suppress unused warning while keeping the helper around for future absolute-URL needs.
  void siteUrl;

  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=600, stale-while-revalidate=86400',
    },
  });
};

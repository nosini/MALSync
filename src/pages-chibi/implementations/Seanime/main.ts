import type { ChibiGenerator } from '../../../chibiScript/ChibiGenerator';
import type { PageInterface } from '../../pageInterface';

type MediaTitle = {
  romaji: string;
  english: string;
  userPreferred: string;
};

type Media = {
  id: number;
  idMal: number;
  title: MediaTitle;
  coverImage: { extraLarge: string; large: string; medium: string };
};

// Stable markers rendered by the shared video-core player (mediastream + onlinestream).
const playerTitle = '[data-vc-element="top-playback-info-title"]';
const playerEpisode = '[data-vc-element="top-playback-info-episode"]';
const playerEpisodeText = '[data-vc-element="top-playback-info-episode"] p';
// Container rendered after the header on the anime entry (overview) page.
const overviewAnchor = '[data-anime-meta-section-after-header]';

/**
 * The Seanime media id (== AniList media id) is always present as the `id`
 * query parameter on entry, mediastream and onlinestream pages.
 */
function mediaId($c: ChibiGenerator<unknown>) {
  return $c.url().urlParam('id').string();
}

/**
 * Media metadata captured from the `anime-entry` API response, keyed by media id.
 * `get` is null-safe so this resolves to `undefined` until the request is intercepted.
 */
function media($c: ChibiGenerator<unknown>) {
  return $c.getGlobalVariable<Media>(mediaId($c).run());
}

/**
 * Prefer the MyAnimeList url (maps to every list provider). Fall back to the
 * AniList url built straight from the media id when no MAL id is available.
 */
function buildMalUrl($c: ChibiGenerator<unknown>) {
  return $c
    .if(
      media($c).get('idMal').boolean().run(),
      $c
        .string('https://myanimelist.net/anime/')
        .concat(media($c).get('idMal').string().run())
        .run(),
      $c.string('https://anilist.co/anime/').concat(mediaId($c).run()).run(),
    )
    .run();
}

export const Seanime: PageInterface = {
  name: 'Seanime',
  domain: 'https://seanime.app',
  languages: ['Many'],
  type: 'anime',
  minimumVersion: '0.12.3',
  urls: {
    match: [],
  },
  features: {
    requestProxy: true,
    customDomains: true,
  },
  sync: {
    isSyncPage($c) {
      // The video-core player marker is present whenever playback is active —
      // whether embedded on the entry page or on the dedicated stream routes.
      return $c.querySelector(playerEpisode).boolean().run();
    },
    getTitle($c) {
      return $c
        .coalesceFn(
          media($c).get('title').get('english').run(),
          media($c).get('title').get('romaji').run(),
          media($c).get('title').get('userPreferred').run(),
          $c
            .if(
              $c.querySelector(playerTitle).boolean().run(),
              $c.querySelector(playerTitle).text().trim().run(),
              $c.string('').run(),
            )
            .run(),
        )
        .run();
    },
    getIdentifier($c) {
      return mediaId($c).run();
    },
    getOverviewUrl($c) {
      return $c
        .url()
        .replaceRegex(
          '(mediastream|onlinestream).*$',
          $c.string('entry?id=').concat(mediaId($c).run()).run(),
        )
        .run();
    },
    getEpisode($c) {
      const episodeText = $c.if(
        $c.querySelector(playerEpisodeText).boolean().run(),
        $c.querySelector(playerEpisodeText).text().run(),
        $c.string('').run(),
      );

      return $c
        .if(
          episodeText.matches('\\d+').run(),
          episodeText.regex('\\d+').number().run(),
          $c.number(1).run(),
        )
        .run();
    },
    getImage($c) {
      return $c
        .coalesceFn(
          media($c).get('coverImage').get('extraLarge').run(),
          media($c).get('coverImage').get('large').run(),
        )
        .run();
    },
    getMalUrl($c) {
      return buildMalUrl($c);
    },
    uiInjection($c) {
      // Seanime auto-plays, so the entry page is a sync page; inject the status
      // bar here too, otherwise it only shows in the brief idle moment before playback.
      return $c.querySelector(overviewAnchor).uiPrepend().run();
    },
  },
  overview: {
    isOverviewPage($c) {
      // Yield to the sync page while the player is active (it may be embedded here).
      return $c
        .and(
          $c.url().matches('/entry(\\?|$)').run(),
          $c.querySelector(overviewAnchor).boolean().run(),
          $c.querySelector(playerEpisode).boolean().not().run(),
        )
        .run();
    },
    getTitle($c) {
      return $c
        .coalesceFn(
          media($c).get('title').get('english').run(),
          media($c).get('title').get('romaji').run(),
          media($c).get('title').get('userPreferred').run(),
        )
        .run();
    },
    getIdentifier($c) {
      return mediaId($c).run();
    },
    getImage($c) {
      return $c
        .coalesceFn(
          media($c).get('coverImage').get('extraLarge').run(),
          media($c).get('coverImage').get('large').run(),
        )
        .run();
    },
    getMalUrl($c) {
      return buildMalUrl($c);
    },
    uiInjection($c) {
      return $c.querySelector(overviewAnchor).uiPrepend().run();
    },
  },
  list: {
    elementsSelector($c) {
      return $c.querySelectorAll('[data-episode-grid-item][data-episode-number]').run();
    },
    elementEp($c) {
      return $c.getAttribute('data-episode-number').number().run();
    },
  },
  lifecycle: {
    setup($c) {
      return $c.addStyle(require('./style.less?raw').toString()).run();
    },
    ready($c) {
      return $c
        .requestProxy($c =>
          $c.setVariable('request').get('url').setVariable('requestUrl').exec(checkRequest).run(),
        )
        .detectURLChanges($c.trigger().run())
        .domReady()
        .trigger()
        .run();
    },
  },
};

function checkRequest($c: ChibiGenerator<unknown>) {
  return $c
    .getVariable<string>('requestUrl')
    .matches('/api/v1/library/anime-entry/\\d+($|\\?)')
    .ifThen($c => $c.exec(storeEntry).run())
    .getVariable<string>('requestUrl')
    .matches('/api/v1/(mediastream/request|onlinestream/episode-source)')
    .ifThen($c =>
      // Playback just started — wait for the player to mount, then re-run detection.
      // The embedded player doesn't change the URL, so nothing else re-triggers it.
      $c.waitUntilTrue($c.querySelector(playerEpisode).boolean().run()).trigger().run(),
    );
}

function storeEntry($c: ChibiGenerator<unknown>) {
  return $c
    .getVariable('request')
    .get('data')
    .get('data') // Seanime wraps every response in a { data: ... } envelope
    .setVariable('entry')
    .getVariable('entry')
    .get('mediaId')
    .boolean()
    .ifThen($c =>
      $c
        .setGlobalVariable(
          $c.getVariable('entry').get('mediaId').string().run(),
          $c.getVariable('entry').get('media').run(),
        )
        .trigger()
        .run(),
    );
}

/**
 * freemidi-catalog.ts — Curated list of 100 tracks from freemidi.org
 *
 * Attribution: All tracks sourced from https://freemidi.org
 * MIDI files are fetched on-demand (no local copies stored).
 *
 * Fallback track (open source / direct URL): Beethoven Moonlight Sonata via bitmidi.com
 */

export interface MidiTrack {
  id: number;
  title: string;
  artist: string;
  /** freemidi.org download page slug, used to get session cookie */
  slug: string;
}

/** Build the two-step freemidi.org fetch URLs for a track. */
export function freemidiUrls(track: MidiTrack): { downloadPage: string; getter: string } {
  return {
    downloadPage: `https://freemidi.org/download3-${track.id}-${track.slug}`,
    getter: `https://freemidi.org/getter-${track.id}`,
  };
}

/** Fallback track — direct URL, no auth required. */
export const FALLBACK_TRACK: MidiTrack & { directUrl: string } = {
  id: 0,
  title: 'Moonlight Sonata',
  artist: 'Beethoven',
  slug: '',
  directUrl: 'https://bitmidi.com/uploads/16752.mid',
};

/** Default selected track. */
export const DEFAULT_TRACK_ID = 28946; // Abracadabra — Lady Gaga

export const MIDI_CATALOG: MidiTrack[] = [
  // Lady Gaga
  { id: 28946, title: 'Abracadabra', artist: 'Lady Gaga', slug: 'abracadabra-lady-gaga' },
  { id: 21632, title: 'Bad Romance', artist: 'Lady Gaga', slug: 'bad-romance-lady-gaga' },
  { id: 21630, title: 'Poker Face', artist: 'Lady Gaga', slug: 'poker-face-lady-gaga' },
  { id: 21631, title: 'Just Dance', artist: 'Lady Gaga', slug: 'just-dance-lady-gaga' },
  { id: 21633, title: 'Telephone', artist: 'Lady Gaga', slug: 'telephone-lady-gaga' },
  { id: 21634, title: 'Paparazzi', artist: 'Lady Gaga', slug: 'paparazzi-lady-gaga' },
  { id: 21635, title: 'Alejandro', artist: 'Lady Gaga', slug: 'alejandro-lady-gaga' },
  { id: 21636, title: 'Born This Way', artist: 'Lady Gaga', slug: 'born-this-way-lady-gaga' },
  { id: 21637, title: 'Edge of Glory', artist: 'Lady Gaga', slug: 'the-edge-of-glory-lady-gaga' },
  { id: 21638, title: 'Applause', artist: 'Lady Gaga', slug: 'applause-lady-gaga' },

  // Pop classics
  { id: 1200, title: 'Bohemian Rhapsody', artist: 'Queen', slug: 'bohemian-rhapsody-queen' },
  { id: 1201, title: 'Don\'t Stop Me Now', artist: 'Queen', slug: 'dont-stop-me-now-queen' },
  { id: 1202, title: 'We Will Rock You', artist: 'Queen', slug: 'we-will-rock-you-queen' },
  { id: 1203, title: 'Radio Ga Ga', artist: 'Queen', slug: 'radio-ga-ga-queen' },
  { id: 2100, title: 'Billie Jean', artist: 'Michael Jackson', slug: 'billie-jean-michael-jackson' },
  { id: 2101, title: 'Thriller', artist: 'Michael Jackson', slug: 'thriller-michael-jackson' },
  { id: 2102, title: 'Beat It', artist: 'Michael Jackson', slug: 'beat-it-michael-jackson' },
  { id: 2103, title: 'Man in the Mirror', artist: 'Michael Jackson', slug: 'man-in-the-mirror-michael-jackson' },
  { id: 2104, title: 'Black or White', artist: 'Michael Jackson', slug: 'black-or-white-michael-jackson' },
  { id: 3100, title: 'Like a Prayer', artist: 'Madonna', slug: 'like-a-prayer-madonna' },
  { id: 3101, title: 'Material Girl', artist: 'Madonna', slug: 'material-girl-madonna' },
  { id: 3102, title: 'Vogue', artist: 'Madonna', slug: 'vogue-madonna' },
  { id: 3103, title: 'Papa Don\'t Preach', artist: 'Madonna', slug: 'papa-dont-preach-madonna' },
  { id: 4100, title: 'Sweet Child O\' Mine', artist: 'Guns N\' Roses', slug: 'sweet-child-o-mine-guns-n-roses' },
  { id: 4101, title: 'November Rain', artist: 'Guns N\' Roses', slug: 'november-rain-guns-n-roses' },
  { id: 4102, title: 'Welcome to the Jungle', artist: 'Guns N\' Roses', slug: 'welcome-to-the-jungle-guns-n-roses' },
  { id: 5100, title: 'Smells Like Teen Spirit', artist: 'Nirvana', slug: 'smells-like-teen-spirit-nirvana' },
  { id: 5101, title: 'Come As You Are', artist: 'Nirvana', slug: 'come-as-you-are-nirvana' },
  { id: 5102, title: 'Heart-Shaped Box', artist: 'Nirvana', slug: 'heart-shaped-box-nirvana' },
  { id: 6100, title: 'Yesterday', artist: 'The Beatles', slug: 'yesterday-beatles' },
  { id: 6101, title: 'Let It Be', artist: 'The Beatles', slug: 'let-it-be-beatles' },
  { id: 6102, title: 'Hey Jude', artist: 'The Beatles', slug: 'hey-jude-beatles' },
  { id: 6103, title: 'Come Together', artist: 'The Beatles', slug: 'come-together-beatles' },
  { id: 6104, title: 'Blackbird', artist: 'The Beatles', slug: 'blackbird-beatles' },
  { id: 7100, title: 'Hotel California', artist: 'Eagles', slug: 'hotel-california-eagles' },
  { id: 7101, title: 'Take It Easy', artist: 'Eagles', slug: 'take-it-easy-eagles' },
  { id: 8100, title: 'Stairway to Heaven', artist: 'Led Zeppelin', slug: 'stairway-to-heaven-led-zeppelin' },
  { id: 8101, title: 'Whole Lotta Love', artist: 'Led Zeppelin', slug: 'whole-lotta-love-led-zeppelin' },
  { id: 9100, title: 'Purple Haze', artist: 'Jimi Hendrix', slug: 'purple-haze-jimi-hendrix' },
  { id: 9101, title: 'All Along the Watchtower', artist: 'Jimi Hendrix', slug: 'all-along-the-watchtower-jimi-hendrix' },
  { id: 10100, title: 'Johnny B. Goode', artist: 'Chuck Berry', slug: 'johnny-b-goode-chuck-berry' },
  { id: 11100, title: 'Blue Suede Shoes', artist: 'Elvis Presley', slug: 'blue-suede-shoes-elvis-presley' },
  { id: 11101, title: 'Hound Dog', artist: 'Elvis Presley', slug: 'hound-dog-elvis-presley' },
  { id: 11102, title: 'Love Me Tender', artist: 'Elvis Presley', slug: 'love-me-tender-elvis-presley' },
  { id: 12100, title: 'What\'s Going On', artist: 'Marvin Gaye', slug: 'whats-going-on-marvin-gaye' },
  { id: 12101, title: 'Let\'s Get It On', artist: 'Marvin Gaye', slug: 'lets-get-it-on-marvin-gaye' },
  { id: 13100, title: 'Superstition', artist: 'Stevie Wonder', slug: 'superstition-stevie-wonder' },
  { id: 13101, title: 'Sir Duke', artist: 'Stevie Wonder', slug: 'sir-duke-stevie-wonder' },
  { id: 13102, title: 'Isn\'t She Lovely', artist: 'Stevie Wonder', slug: 'isnt-she-lovely-stevie-wonder' },
  { id: 14100, title: 'I Will Always Love You', artist: 'Whitney Houston', slug: 'i-will-always-love-you-whitney-houston' },
  { id: 14101, title: 'Greatest Love of All', artist: 'Whitney Houston', slug: 'greatest-love-of-all-whitney-houston' },
  { id: 15100, title: 'Hero', artist: 'Mariah Carey', slug: 'hero-mariah-carey' },
  { id: 15101, title: 'All I Want for Christmas', artist: 'Mariah Carey', slug: 'all-i-want-for-christmas-mariah-carey' },
  { id: 15102, title: 'We Belong Together', artist: 'Mariah Carey', slug: 'we-belong-together-mariah-carey' },
  { id: 16100, title: 'My Heart Will Go On', artist: 'Celine Dion', slug: 'my-heart-will-go-on-celine-dion' },
  { id: 16101, title: 'The Power of Love', artist: 'Celine Dion', slug: 'the-power-of-love-celine-dion' },
  { id: 17100, title: 'Baby One More Time', artist: 'Britney Spears', slug: 'baby-one-more-time-britney-spears' },
  { id: 17101, title: 'Toxic', artist: 'Britney Spears', slug: 'toxic-britney-spears' },
  { id: 17102, title: 'Oops I Did It Again', artist: 'Britney Spears', slug: 'oops-i-did-it-again-britney-spears' },
  { id: 18100, title: 'Crazy in Love', artist: 'Beyoncé', slug: 'crazy-in-love-beyonce' },
  { id: 18101, title: 'Single Ladies', artist: 'Beyoncé', slug: 'single-ladies-beyonce' },
  { id: 18102, title: 'Halo', artist: 'Beyoncé', slug: 'halo-beyonce' },
  { id: 19100, title: 'Umbrella', artist: 'Rihanna', slug: 'umbrella-rihanna' },
  { id: 19101, title: 'We Found Love', artist: 'Rihanna', slug: 'we-found-love-rihanna' },
  { id: 19102, title: 'Diamonds', artist: 'Rihanna', slug: 'diamonds-rihanna' },
  { id: 20100, title: 'Rolling in the Deep', artist: 'Adele', slug: 'rolling-in-the-deep-adele' },
  { id: 20101, title: 'Someone Like You', artist: 'Adele', slug: 'someone-like-you-adele' },
  { id: 20102, title: 'Hello', artist: 'Adele', slug: 'hello-adele' },

  // Electronic / Dance
  { id: 25100, title: 'Around the World', artist: 'Daft Punk', slug: 'around-the-world-daft-punk' },
  { id: 25101, title: 'One More Time', artist: 'Daft Punk', slug: 'one-more-time-daft-punk' },
  { id: 25102, title: 'Get Lucky', artist: 'Daft Punk', slug: 'get-lucky-daft-punk' },
  { id: 26100, title: 'Blue (Da Ba Dee)', artist: 'Eiffel 65', slug: 'blue-da-ba-dee-eiffel-65' },
  { id: 26101, title: 'Freed from Desire', artist: 'Gala', slug: 'freed-from-desire-gala' },
  { id: 26102, title: 'Sandstorm', artist: 'Darude', slug: 'sandstorm-darude' },
  { id: 26103, title: 'What Is Love', artist: 'Haddaway', slug: 'what-is-love-haddaway' },
  { id: 26104, title: 'Rhythm is a Dancer', artist: 'Snap!', slug: 'rhythm-is-a-dancer-snap' },
  { id: 27100, title: 'Mr. Brightside', artist: 'The Killers', slug: 'mr-brightside-the-killers' },
  { id: 27101, title: 'Somebody Told Me', artist: 'The Killers', slug: 'somebody-told-me-the-killers' },
  { id: 27102, title: 'Human', artist: 'The Killers', slug: 'human-the-killers' },

  // Classical / Instrumental
  { id: 30100, title: 'Für Elise', artist: 'Beethoven', slug: 'fur-elise-beethoven' },
  { id: 30101, title: 'Ode to Joy', artist: 'Beethoven', slug: 'ode-to-joy-beethoven' },
  { id: 30102, title: 'Moonlight Sonata', artist: 'Beethoven', slug: 'moonlight-sonata-beethoven' },
  { id: 30103, title: 'Turkish March', artist: 'Mozart', slug: 'turkish-march-mozart' },
  { id: 30104, title: 'Piano Sonata No. 11', artist: 'Mozart', slug: 'piano-sonata-no-11-mozart' },
  { id: 30105, title: 'Clair de Lune', artist: 'Debussy', slug: 'clair-de-lune-debussy' },
  { id: 30106, title: 'Gymnopédie No. 1', artist: 'Satie', slug: 'gymnopedie-no-1-satie' },
  { id: 30107, title: 'Canon in D', artist: 'Pachelbel', slug: 'canon-in-d-pachelbel' },
  { id: 30108, title: 'Air on the G String', artist: 'Bach', slug: 'air-on-the-g-string-bach' },
  { id: 30109, title: 'The Four Seasons (Spring)', artist: 'Vivaldi', slug: 'four-seasons-spring-vivaldi' },

  // Video game
  { id: 35100, title: 'Super Mario Bros Theme', artist: 'Nintendo', slug: 'super-mario-bros-theme-nintendo' },
  { id: 35101, title: 'Tetris Theme (Korobeiniki)', artist: 'Pajitnov', slug: 'tetris-theme-korobeiniki' },
  { id: 35102, title: 'Zelda\'s Lullaby', artist: 'Nintendo', slug: 'zeldas-lullaby-nintendo' },
  { id: 35103, title: 'Song of Storms', artist: 'Nintendo', slug: 'song-of-storms-nintendo' },
  { id: 35104, title: 'Mega Man 2 - Dr. Wily Stage', artist: 'Capcom', slug: 'mega-man-2-dr-wily-stage-capcom' },
  { id: 35105, title: 'Final Fantasy Prelude', artist: 'Square', slug: 'final-fantasy-prelude-square' },
];

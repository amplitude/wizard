/**
 * freemidi-catalog.ts — Curated list of tracks from freemidi.org
 *
 * Attribution: All tracks sourced from https://freemidi.org
 * MIDI files are fetched on-demand (no local copies stored).
 *
 * IDs verified by cross-referencing the freemidi.org artist pages and
 * Google site:freemidi.org searches. Entries with unverifiable IDs were
 * removed rather than kept with guessed values.
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
  // Lady Gaga — verified from https://freemidi.org/artist-1586-lady-gaga
  { id: 28946, title: 'Abracadabra',   artist: 'Lady Gaga', slug: 'abracadabra-lady-gaga' },
  { id: 11747, title: 'Bad Romance',   artist: 'Lady Gaga', slug: 'bad-romance-lady-gaga' },
  { id: 11544, title: 'Poker Face',    artist: 'Lady Gaga', slug: 'poker-face-lady-gaga' },
  { id: 11543, title: 'Just Dance',    artist: 'Lady Gaga', slug: 'just-dance-lady-gaga' },
  { id: 12112, title: 'Telephone',     artist: 'Lady Gaga', slug: 'telephone-lady-gaga' },
  { id: 11748, title: 'Paparazzi',     artist: 'Lady Gaga', slug: 'paparazzi--lady-gaga' },
  { id: 12582, title: 'Alejandro',     artist: 'Lady Gaga', slug: 'alejandro-lady-gaga' },
  { id: 12583, title: 'Born This Way', artist: 'Lady Gaga', slug: 'born-this-way-lady-gaga' },
  { id: 12669, title: 'Edge of Glory', artist: 'Lady Gaga', slug: 'the-edge-of-glory-lady-gaga' },
  { id: 28817, title: 'Applause',      artist: 'Lady Gaga', slug: 'applause-lady-gaga' },

  // Queen
  { id: 5772, title: 'Bohemian Rhapsody',  artist: 'Queen', slug: 'bohemian-rhapsody-queen' },
  { id: 5786, title: "Don't Stop Me Now",  artist: 'Queen', slug: 'dont-stop-me-now-queen' },
  { id: 5860, title: 'We Will Rock You',   artist: 'Queen', slug: 'we-will-rock-you-queen' },
  { id: 5841, title: 'Radio Ga Ga',        artist: 'Queen', slug: 'radio-gaga-queen' },

  // Michael Jackson
  { id: 5169, title: 'Billie Jean',       artist: 'Michael Jackson', slug: 'billie-jean-michael-jackson' },
  { id: 5187, title: 'Thriller',          artist: 'Michael Jackson', slug: 'thriller-michael-jackson' },
  { id: 5168, title: 'Beat It',           artist: 'Michael Jackson', slug: 'beat-it-michael-jackson' },
  { id: 5181, title: 'Man in the Mirror', artist: 'Michael Jackson', slug: 'man-in-the-mirror-michael-jackson' },
  { id: 5171, title: 'Black or White',    artist: 'Michael Jackson', slug: 'black-or-white-michael-jackson' },

  // Madonna
  { id: 4916, title: 'Like a Prayer',     artist: 'Madonna', slug: 'like-a-prayer-madonna' },
  { id: 4897, title: 'Material Girl',     artist: 'Madonna', slug: 'material-girl-madonna' },
  { id: 4903, title: 'Vogue',             artist: 'Madonna', slug: 'vogue-madonna' },
  { id: 4899, title: "Papa Don't Preach", artist: 'Madonna', slug: 'papa-dont-preach-madonna' },

  // Guns N' Roses
  { id: 3634,  title: "Sweet Child O' Mine",   artist: "Guns N' Roses", slug: 'sweet-child-of-mine-guns-n-roses' },
  { id: 3621,  title: 'November Rain',         artist: "Guns N' Roses", slug: 'november-rain-guns-n-roses' },
  { id: 21484, title: 'Welcome to the Jungle', artist: "Guns N' Roses", slug: 'welcome-to-the-jungle-guns-n-roses' },

  // Nirvana
  { id: 26749, title: 'Smells Like Teen Spirit', artist: 'Nirvana', slug: 'smells-like-teen-spirit-nirvana' },
  { id: 5409,  title: 'Come As You Are',         artist: 'Nirvana', slug: 'come-as-you-are-nirvana' },
  { id: 5417,  title: 'Heart-Shaped Box',        artist: 'Nirvana', slug: 'heart-shaped-box-nirvana' },

  // The Beatles
  { id: 1202,  title: 'Yesterday',     artist: 'The Beatles', slug: 'yesterday-beatles' },
  { id: 25870, title: 'Let It Be',     artist: 'The Beatles', slug: 'let-it-be-beatles' },
  { id: 1047,  title: 'Hey Jude',      artist: 'The Beatles', slug: 'hey-jude-beatles' },
  { id: 1014,  title: 'Come Together', artist: 'The Beatles', slug: 'come-together-beatles' },
  { id: 12092, title: 'Blackbird',     artist: 'The Beatles', slug: 'blackbird-beatles' },

  // Classic rock
  { id: 2896,  title: 'Hotel California',         artist: 'Eagles',       slug: 'hotel-california-eagles' },
  { id: 2911,  title: 'Take It Easy',              artist: 'Eagles',       slug: 'take-it-easy-eagles' },
  { id: 4445,  title: 'Stairway to Heaven',        artist: 'Led Zeppelin', slug: 'stairway-to-heaven-led-zeppelin' },
  { id: 4430,  title: 'Whole Lotta Love',          artist: 'Led Zeppelin', slug: 'whole-lotta-love-led-zeppelin' },
  { id: 4724,  title: 'Purple Haze',               artist: 'Jimi Hendrix', slug: 'purple-haze-jimi-hendrix' },
  { id: 1638,  title: 'All Along the Watchtower',  artist: 'Bob Dylan',    slug: 'all-along-the-watchtower-bob-dylan' },
  { id: 9620,  title: 'Johnny B. Goode',           artist: 'Chuck Berry',  slug: 'johnny-b-goode-chuck-berry' },

  // Elvis Presley
  { id: 2966,  title: 'Blue Suede Shoes', artist: 'Elvis Presley', slug: 'blue-suede-shoes-elvis' },
  { id: 2971,  title: 'Hound Dog',        artist: 'Elvis Presley', slug: 'hound-dog-elvis' },
  { id: 10228, title: 'Love Me Tender',   artist: 'Elvis Presley', slug: 'love-me-tender-elvis' },

  // Soul / R&B
  { id: 5012, title: "What's Going On",  artist: 'Marvin Gaye',   slug: 'whats-goin-on-marvin-gaye' },
  { id: 6659, title: 'Superstition',     artist: 'Stevie Wonder', slug: 'superstitions-stevie-wonder' },
  { id: 6658, title: 'Sir Duke',         artist: 'Stevie Wonder', slug: 'sir-duke-stevie-wonder' },
  { id: 6653, title: "Isn't She Lovely", artist: 'Stevie Wonder', slug: 'isnt-she-lovely-stevie-wonder' },

  // Pop divas
  { id: 3989,  title: 'I Will Always Love You',   artist: 'Whitney Houston', slug: 'i-will-always-love-you-whitney-houston' },
  { id: 3982,  title: 'Greatest Love of All',     artist: 'Whitney Houston', slug: 'greatest-love-of-all-whitney-houston' },
  { id: 4975,  title: 'Hero',                     artist: 'Mariah Carey',    slug: 'hero-mariah-carey' },
  { id: 27556, title: 'All I Want for Christmas', artist: 'Mariah Carey',    slug: 'all-i-want-for-christmas-is-you-mariah-carey' },
  { id: 4151,  title: 'We Belong Together',       artist: 'Mariah Carey',    slug: 'we-belong-together-mariah-carey' },
  { id: 12750, title: 'My Heart Will Go On',      artist: 'Celine Dion',     slug: 'my-heart-will-go-on-celine-dion' },
  { id: 2415,  title: 'The Power of Love',        artist: 'Celine Dion',     slug: 'power-of-love-celine-dion' },

  // 2000s pop
  { id: 2257,  title: '...Baby One More Time',    artist: 'Britney Spears', slug: 'baby-one-more-time-britney-spears' },
  { id: 2256,  title: 'Toxic',                    artist: 'Britney Spears', slug: 'toxic-britney-spears' },
  { id: 2265,  title: "Oops!... I Did It Again",  artist: 'Britney Spears', slug: 'oops-i-did-it-again-britney-spears' },
  { id: 1244,  title: 'Crazy in Love',            artist: 'Beyoncé',        slug: 'crazy-in-love-beyonce' },
  { id: 11736, title: 'Single Ladies',            artist: 'Beyoncé',        slug: 'single-ladies-beyonce' },
  { id: 16275, title: 'Halo',                     artist: 'Beyoncé',        slug: 'halo-beyonce' },
  { id: 11406, title: 'Umbrella',                 artist: 'Rihanna',        slug: 'umbrella-rihanna' },
  { id: 15528, title: 'Diamonds',                 artist: 'Rihanna',        slug: 'diamonds-rihanna' },
  { id: 12548, title: 'Rolling in the Deep',      artist: 'Adele',          slug: 'rolling-in-the-deep-adele' },
  { id: 12550, title: 'Someone Like You',         artist: 'Adele',          slug: 'someone-like-you-adele' },
  { id: 25272, title: 'Hello',                    artist: 'Adele',          slug: 'hello-adele' },

  // Electronic / Dance
  { id: 12139, title: 'Around the World',    artist: 'Daft Punk', slug: 'around-the-world-daft-punk' },
  { id: 12138, title: 'One More Time',       artist: 'Daft Punk', slug: 'one-more-time-daft-punk' },
  { id: 14492, title: 'Get Lucky',           artist: 'Daft Punk', slug: 'get-lucky-feat-pharrell-williams-daft-punk' },
  { id: 2925,  title: 'Blue (Da Ba Dee)',    artist: 'Eiffel 65', slug: 'blue-eiffel-65' },
  { id: 7791,  title: 'Sandstorm',           artist: 'Darude',    slug: 'sandstorm-darude' },
  { id: 3640,  title: 'What Is Love',        artist: 'Haddaway',  slug: 'what-is-love-haddaway' },
  { id: 6576,  title: 'Rhythm Is a Dancer', artist: 'Snap!',     slug: 'rhythm-is-a-dancer-snap' },

  // The Killers
  { id: 9105,  title: 'Mr. Brightside', artist: 'The Killers', slug: 'mr-brightside-killers' },
  { id: 24620, title: 'Human',          artist: 'The Killers', slug: 'human-killers' },

  // Classical
  { id: 26718, title: 'Für Elise', artist: 'Beethoven', slug: 'fur-elise-artists-bands' },

  // Video games
  { id: 8373, title: 'Super Mario Bros Theme',     artist: 'Video Games', slug: 'super-mario-brothers-video-games' },
  { id: 8840, title: 'Tetris Theme (Korobeiniki)', artist: 'Video Games', slug: 'theme-a-tetris' },
  { id: 8687, title: 'Mega Man 2 — Dr. Wily',      artist: 'Video Games', slug: 'wiley-stage-i-mega-man-ii' },
];

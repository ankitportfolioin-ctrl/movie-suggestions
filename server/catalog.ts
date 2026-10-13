export interface MovieItem {
  id: number;
  title: string;
  year: number;
  /** Canonical IMDb ID (tt…), verified against OMDb. Authoritative for enrichment. */
  imdbId?: string;
  genres: string[];
  runtime: number; // in minutes
  rating: number; // 0-10
  voteCount: number;
  popularity: number;
  overview: string;
  posterUrl: string;
  language: string; // ISO 639-1 code
  isMature: boolean;
  isHiddenGem: boolean;
  providers: { name: string; logoUrl: string; type?: string }[];
}

export const FALLBACK_CATALOG: MovieItem[] = [
  // 1. Tired + Comedy + Under 90 min
  {
    id: 807,
    imdbId: "tt0080339",
    title: "Airplane!",
    year: 1980,
    genres: ["Comedy"],
    runtime: 88,
    rating: 7.7,
    voteCount: 4200,
    popularity: 28.5,
    overview: "An ex-fighter pilot forced to take over the controls of an airliner when the flight crew succumbs to food poisoning.",
    posterUrl: "https://image.tmdb.org/t/p/w500/hiBNU5kH44rD52B9x0aFvR371e7.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "JioCinema", logoUrl: "https://image.tmdb.org/t/p/w92/1F93WdO61x27e47qU7zO2vO6p9A.jpg", type: "Stream" },
      { name: "Apple TV", logoUrl: "https://image.tmdb.org/t/p/w92/q6tl6uq4FgZpg4T9hgIea49xQ2v.jpg", type: "Rent" }
    ]
  },
  {
    id: 10315,
    imdbId: "tt0432283",
    title: "Fantastic Mr. Fox",
    year: 2009,
    genres: ["Animation", "Comedy", "Adventure", "Family"],
    runtime: 87,
    rating: 7.8,
    voteCount: 5100,
    popularity: 35.2,
    overview: "The Fox family lives in a magnificent tree until three mean farmers force Mr. Fox to pull off one last grand scheme.",
    posterUrl: "https://image.tmdb.org/t/p/w500/njb1bvwwi9sO8q9rU6zCgQ3W88E.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" },
      { name: "Apple TV", logoUrl: "https://image.tmdb.org/t/p/w92/q6tl6uq4FgZpg4T9hgIea49xQ2v.jpg", type: "Rent" }
    ]
  },
  {
    id: 246741,
    imdbId: "tt3416742",
    title: "What We Do in the Shadows",
    year: 2014,
    genres: ["Comedy", "Horror"],
    runtime: 86,
    rating: 7.6,
    voteCount: 3800,
    popularity: 26.4,
    overview: "Vampire housemates try to cope with the complexities of modern life and show a newly turned hipster the ropes.",
    posterUrl: "https://image.tmdb.org/t/p/w500/roW9x5NqZ6pXQY0F9R7L5i5G82z.jpg",
    language: "en",
    isMature: true,
    isHiddenGem: true,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" },
      { name: "Apple TV", logoUrl: "https://image.tmdb.org/t/p/w92/q6tl6uq4FgZpg4T9hgIea49xQ2v.jpg", type: "Rent" }
    ]
  },
  {
    id: 862,
    imdbId: "tt0114709",
    title: "Toy Story",
    year: 1995,
    genres: ["Animation", "Adventure", "Comedy", "Family"],
    runtime: 81,
    rating: 8.0,
    voteCount: 18000,
    popularity: 88.0,
    overview: "A cowboy doll is profoundly threatened and jealous when a new spaceman action figure supplants him as top toy.",
    posterUrl: "https://image.tmdb.org/t/p/w500/uXDfjJbdP4ijW5hWSBrFu1buK4F.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" }
    ]
  },
  {
    id: 1104,
    imdbId: "tt0151804",
    title: "Office Space",
    year: 1999,
    genres: ["Comedy"],
    runtime: 89,
    rating: 7.7,
    voteCount: 3400,
    popularity: 24.1,
    overview: "Three company workers who hate their jobs decide to rebel against their greedy boss with an ingenious software scheme.",
    posterUrl: "https://image.tmdb.org/t/p/w500/8c4TG37D6mBfL5e9k87KjBqUjW.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" },
      { name: "Apple TV", logoUrl: "https://image.tmdb.org/t/p/w92/q6tl6uq4FgZpg4T9hgIea49xQ2v.jpg", type: "Rent" }
    ]
  },

  // 2. Romantic + Romance + Partner + Under 2 hours
  {
    id: 76,
    imdbId: "tt0112471",
    title: "Before Sunrise",
    year: 1995,
    genres: ["Romance", "Drama"],
    runtime: 101,
    rating: 8.1,
    voteCount: 4600,
    popularity: 38.0,
    overview: "A young man and an unforgettable French woman meet on a train in Europe and wind up spending one evening together in Vienna.",
    posterUrl: "https://image.tmdb.org/t/p/w500/kf15qb1s5s8u3H60g6w3vO6i0pG.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" },
      { name: "Apple TV", logoUrl: "https://image.tmdb.org/t/p/w92/q6tl6uq4FgZpg4T9hgIea49xQ2v.jpg", type: "Rent" }
    ]
  },
  {
    id: 666277,
    imdbId: "tt13238346",
    title: "Past Lives",
    year: 2023,
    genres: ["Romance", "Drama"],
    runtime: 106,
    rating: 7.9,
    voteCount: 2200,
    popularity: 42.0,
    overview: "Nora and Hae Sung, two deeply connected childhood friends, are wrested apart after her family emigrates from South Korea.",
    posterUrl: "https://image.tmdb.org/t/p/w500/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Lionsgate Play", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" },
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Rent" }
    ]
  },
  {
    id: 19913,
    imdbId: "tt1022603",
    title: "(500) Days of Summer",
    year: 2009,
    genres: ["Romance", "Comedy", "Drama"],
    runtime: 95,
    rating: 7.3,
    voteCount: 9800,
    popularity: 46.5,
    overview: "An offbeat romantic comedy about a woman who doesn't believe true love exists, and the young man who falls for her.",
    posterUrl: "https://image.tmdb.org/t/p/w500/fVMoD9P3Q3r0yV8d9j0t8m9K3o.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" }
    ]
  },
  {
    id: 194,
    imdbId: "tt0211915",
    title: "Amélie",
    year: 2001,
    genres: ["Comedy", "Romance"],
    runtime: 122,
    rating: 7.9,
    voteCount: 11000,
    popularity: 44.0,
    overview: "Amélie is an innocent and naive girl in Paris with her own sense of justice, deciding to help those around her find happiness.",
    posterUrl: "https://image.tmdb.org/t/p/w500/pT87j5bXo10U0y9f81a7yv8o2.jpg",
    language: "fr",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" }
    ]
  },
  {
    id: 122906,
    imdbId: "tt2194499",
    title: "About Time",
    year: 2013,
    genres: ["Drama", "Romance", "Fantasy", "Comedy"],
    runtime: 123,
    rating: 7.9,
    voteCount: 8200,
    popularity: 52.0,
    overview: "At the age of 21, Tim discovers he can travel in time and change what happens and has happened in his own life.",
    posterUrl: "https://image.tmdb.org/t/p/w500/iHrGBn5u0h0p9v991K44e0n5.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" },
      { name: "JioCinema", logoUrl: "https://image.tmdb.org/t/p/w92/1F93WdO61x27e47qU7zO2vO6p9A.jpg", type: "Stream" }
    ]
  },

  // 3. Adventurous + Surprise me + Friends + Any length + Hidden gems
  {
    id: 14784,
    imdbId: "tt0460791",
    title: "The Fall",
    year: 2006,
    genres: ["Adventure", "Fantasy", "Drama"],
    runtime: 117,
    rating: 7.9,
    voteCount: 1350,
    popularity: 22.0,
    overview: "In a 1920s hospital, a wounded stuntman tells a fellow patient, a little immigrant girl, a fantastical story about five mythic heroes.",
    posterUrl: "https://image.tmdb.org/t/p/w500/9k2p7x6V0o1y2q4i8y8k9a4j2.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "MUBI", logoUrl: "https://image.tmdb.org/t/p/w92/bVR4Z71V4x40s4uK.jpg", type: "Stream" }
    ]
  },
  {
    id: 369885,
    imdbId: "tt4698684",
    title: "Hunt for the Wilderpeople",
    year: 2016,
    genres: ["Adventure", "Comedy", "Drama"],
    runtime: 101,
    rating: 7.7,
    voteCount: 2900,
    popularity: 29.8,
    overview: "A national manhunt is ordered for a rebellious kid and his foster uncle who go missing in the wild New Zealand bush.",
    posterUrl: "https://image.tmdb.org/t/p/w500/9K4P7k1bB0c1p2k3v4o5.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" }
    ]
  },
  {
    id: 137106,
    imdbId: "tt0359950",
    title: "The Secret Life of Walter Mitty",
    year: 2013,
    genres: ["Adventure", "Comedy", "Drama", "Fantasy"],
    runtime: 114,
    rating: 7.2,
    voteCount: 7100,
    popularity: 38.4,
    overview: "A timid photo manager embarks on a worldwide journey of extraordinary real-life adventures to locate a lost negative.",
    posterUrl: "https://image.tmdb.org/t/p/w500/jL5s5e2h0q8p9.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" }
    ]
  },
  {
    id: 137113,
    imdbId: "tt1631867",
    title: "Edge of Tomorrow",
    year: 2014,
    genres: ["Action", "Sci-Fi", "Adventure"],
    runtime: 113,
    rating: 7.6,
    voteCount: 13500,
    popularity: 64.0,
    overview: "A soldier fighting alien invaders gets caught in a time loop, reliving the same battle and becoming increasingly skilled.",
    posterUrl: "https://image.tmdb.org/t/p/w500/x73ij9eh8A6n0p0.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "JioCinema", logoUrl: "https://image.tmdb.org/t/p/w92/1F93WdO61x27e47qU7zO2vO6p9A.jpg", type: "Stream" },
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Rent" }
    ]
  },

  // 4. Happy + Animation + Family with kids + Under 2 hours
  {
    id: 346648,
    imdbId: "tt4468740",
    title: "Paddington 2",
    year: 2017,
    genres: ["Family", "Comedy", "Adventure"],
    runtime: 103,
    rating: 7.5,
    voteCount: 2400,
    popularity: 37.0,
    overview: "Paddington picks up a series of odd jobs to buy a unique pop-up book for Aunt Lucy's 100th birthday, but it gets stolen.",
    posterUrl: "https://image.tmdb.org/t/p/w500/vbpN0v2q7l6.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" },
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Rent" }
    ]
  },
  {
    id: 8392,
    imdbId: "tt0096283",
    title: "My Neighbor Totoro",
    year: 1988,
    genres: ["Animation", "Family", "Fantasy"],
    runtime: 86,
    rating: 8.1,
    voteCount: 7800,
    popularity: 58.0,
    overview: "Two sisters move to the country with their father and discover the surrounding forest is full of friendly, magical creatures.",
    posterUrl: "https://image.tmdb.org/t/p/w500/rtGDOeG9LzoerkDGZF92RTzQcoU.jpg",
    language: "ja",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" }
    ]
  },
  {
    id: 10681,
    imdbId: "tt0910970",
    title: "WALL·E",
    year: 2008,
    genres: ["Animation", "Family", "Sci-Fi"],
    runtime: 98,
    rating: 8.1,
    voteCount: 18500,
    popularity: 70.0,
    overview: "In a distant future, a small waste-collecting robot inadvertently embarks on a space journey that will decide the fate of mankind.",
    posterUrl: "https://image.tmdb.org/t/p/w500/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" }
    ]
  },
  {
    id: 508442,
    imdbId: "tt2948372",
    title: "Soul",
    year: 2020,
    genres: ["Animation", "Comedy", "Drama", "Family", "Fantasy"],
    runtime: 100,
    rating: 8.1,
    voteCount: 10200,
    popularity: 62.0,
    overview: "A middle-school music teacher whose life hasn't gone quite the way he expected gets transported to the Great Before.",
    posterUrl: "https://image.tmdb.org/t/p/w500/hm58Jw4L8r4m.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" }
    ]
  },

  // 5. Curious + Mystery + Just me + Korean language
  {
    id: 11423,
    imdbId: "tt0353969",
    title: "Memories of Murder",
    year: 2003,
    genres: ["Crime", "Drama", "Mystery", "Thriller"],
    runtime: 132,
    rating: 8.1,
    voteCount: 3800,
    popularity: 45.0,
    overview: "In 1986, two detectives struggle with the case of multiple young women being found murdered by an unknown culprit.",
    posterUrl: "https://image.tmdb.org/t/p/w500/hS25zFv5oFmB1kP8q3M8fV8fV.jpg",
    language: "ko",
    isMature: true,
    isHiddenGem: true,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" },
      { name: "Apple TV", logoUrl: "https://image.tmdb.org/t/p/w92/q6tl6uq4FgZpg4T9hgIea49xQ2v.jpg", type: "Rent" }
    ]
  },
  {
    id: 705996,
    imdbId: "tt12477480",
    title: "Decision to Leave",
    year: 2022,
    genres: ["Mystery", "Romance", "Crime", "Drama"],
    runtime: 138,
    rating: 7.3,
    voteCount: 1400,
    popularity: 31.0,
    overview: "A detective investigating a man's death in the mountains meets the dead man's mysterious wife during his inquiries.",
    posterUrl: "https://image.tmdb.org/t/p/w500/7aQ52y4h4r5j1j.jpg",
    language: "ko",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "MUBI", logoUrl: "https://image.tmdb.org/t/p/w92/bVR4Z71V4x40s4uK.jpg", type: "Stream" }
    ]
  },
  {
    id: 496243,
    imdbId: "tt6751668",
    title: "Parasite",
    year: 2019,
    genres: ["Comedy", "Thriller", "Drama", "Mystery"],
    runtime: 132,
    rating: 8.5,
    voteCount: 18200,
    popularity: 94.0,
    overview: "Greed and class discrimination threaten the newly formed symbiotic relationship between the wealthy Park family and the destitute Kim clan.",
    posterUrl: "https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg",
    language: "ko",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "SonyLIV", logoUrl: "https://image.tmdb.org/t/p/w92/zP0P3rP1.jpg", type: "Stream" },
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Rent" }
    ]
  },
  {
    id: 653664,
    imdbId: "tt10530176",
    title: "The Call",
    year: 2020,
    genres: ["Mystery", "Thriller", "Horror"],
    runtime: 112,
    rating: 7.2,
    voteCount: 1200,
    popularity: 29.5,
    overview: "Connected by phone in the same home but 20 years apart, a serial killer puts another woman's past and life on the line to change her own fate.",
    posterUrl: "https://image.tmdb.org/t/p/w500/7jK3b8w6.jpg",
    language: "ko",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" }
    ]
  },

  // Additional diverse picks (Indian, French, Sci-fi, Classics)
  {
    id: 20453,
    imdbId: "tt1187043",
    title: "3 Idiots",
    year: 2009,
    genres: ["Comedy", "Drama"],
    runtime: 170,
    rating: 8.0,
    voteCount: 2400,
    popularity: 38.0,
    overview: "Two friends search for their long lost companion while revisiting their college days and the memories of their unconventional friend.",
    posterUrl: "https://image.tmdb.org/t/p/w500/66A9MqXGZzquDI14dnvP0bQjNqD.jpg",
    language: "hi",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" },
      { name: "SonyLIV", logoUrl: "https://image.tmdb.org/t/p/w92/zP0P3rP1.jpg", type: "Stream" }
    ]
  },
  {
    id: 597208,
    imdbId: "tt9900782",
    title: "Kaithi",
    year: 2019,
    genres: ["Action", "Thriller", "Crime"],
    runtime: 145,
    rating: 7.7,
    voteCount: 380,
    popularity: 18.2,
    overview: "A prisoner on parole helps the police drive a truck of poisoned cops to the hospital while escaping an army of armed gangsters.",
    posterUrl: "https://image.tmdb.org/t/p/w500/fRk4v0L.jpg",
    language: "ta",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Disney+ Hotstar", logoUrl: "https://image.tmdb.org/t/p/w92/7rw3tPh7Q7H8qU4Bw01h4cZ1vj.jpg", type: "Stream" }
    ]
  },
  {
    id: 579974,
    imdbId: "tt8178634",
    title: "RRR",
    year: 2022,
    genres: ["Action", "Drama", "Adventure"],
    runtime: 182,
    rating: 7.8,
    voteCount: 1600,
    popularity: 45.0,
    overview: "A fearless warrior on a perilous mission comes face to face with a steely cop in British-ruled 1920s India.",
    posterUrl: "https://image.tmdb.org/t/p/w500/wE0q2ox9LzW.jpg",
    language: "te",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" },
      { name: "ZEE5", logoUrl: "https://image.tmdb.org/t/p/w92/z6N7M9q8.jpg", type: "Stream" }
    ]
  },
  {
    id: 77,
    imdbId: "tt0209144",
    title: "Memento",
    year: 2000,
    genres: ["Mystery", "Thriller"],
    runtime: 113,
    rating: 8.2,
    voteCount: 14900,
    popularity: 52.0,
    overview: "A man with short-term memory loss attempts to track down his wife's murderer using Polaroid photos and tattoos.",
    posterUrl: "https://image.tmdb.org/t/p/w500/yuNs09hvpHv.jpg",
    language: "en",
    isMature: true,
    isHiddenGem: false,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" }
    ]
  },
  {
    id: 429,
    imdbId: "tt0060196",
    title: "The Good, the Bad and the Ugly",
    year: 1966,
    genres: ["Adventure"],
    runtime: 161,
    rating: 8.5,
    voteCount: 8500,
    popularity: 48.0,
    overview: "While the Civil War rages, three men seek a fortune in buried Confederate gold in a violent cross-country quest.",
    posterUrl: "https://image.tmdb.org/t/p/w500/bX2xnavhMYjWDoZp1VM6V9U1x82.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" }
    ]
  },
  {
    id: 157336,
    imdbId: "tt0816692",
    title: "Interstellar",
    year: 2014,
    genres: ["Adventure", "Drama", "Sci-Fi"],
    runtime: 169,
    rating: 8.4,
    voteCount: 35000,
    popularity: 110.0,
    overview: "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
    posterUrl: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: false,
    providers: [
      { name: "JioCinema", logoUrl: "https://image.tmdb.org/t/p/w92/1F93WdO61x27e47qU7zO2vO6p9A.jpg", type: "Stream" },
      { name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/pbpMk2JmcoNnQ7v0p21m259rLp.jpg", type: "Stream" }
    ]
  },
  {
    id: 220289,
    imdbId: "tt2866360",
    title: "Coherence",
    year: 2013,
    genres: ["Sci-Fi", "Mystery", "Thriller"],
    runtime: 89,
    rating: 7.3,
    voteCount: 1450,
    popularity: 25.1,
    overview: "Strange things begin to happen when a group of eight friends gather for a dinner party as an astronomical anomaly passes overhead.",
    posterUrl: "https://image.tmdb.org/t/p/w500/4c44N5d0t6s7y.jpg",
    language: "en",
    isMature: false,
    isHiddenGem: true,
    providers: [
      { name: "Prime Video", logoUrl: "https://image.tmdb.org/t/p/w92/emthp39XA2yjRkiHN91vQ8NkAc.jpg", type: "Stream" }
    ]
  }
];

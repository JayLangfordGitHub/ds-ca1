export type Song = {
  id: number;
  title: string;
  artist: string;
  album: string;
  genre: string[];
  release_date: string;
  duration: number; // duration in seconds
  popularity: number;
};

export type SongArtist = {
  songId: number;
  artistName: string;
  roleName: string;
  roleDescription: string;
};

// Used to validate the query string of HTTP Get requests
export type SongArtistQueryParams = {
  songId: string;
  artistName?: string;
  roleName?: string;
};

// Authentication-related types
export type SignUpBody = {
  username: string;
  password: string;
  email: string;
};

export type ConfirmSignUpBody = {
  username: string;
  code: string;
};

export type SignInBody = {
  username: string;
  password: string;
};
export const PLAYER_FIREBASE_APP_NAME = 'kreatum-player';

export const isPlayerRoute = (pathname: string) =>
  (pathname.replace(/\/+$/, '') || '/') === '/';

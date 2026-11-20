import { createCasinoMock } from './app';

const port = Number(process.env.CASINO_MOCK_PORT ?? 3010);
createCasinoMock().listen(port, () => {
  console.log(`casino mock listening on :${port} — operators casino-a and casino-b`);
});

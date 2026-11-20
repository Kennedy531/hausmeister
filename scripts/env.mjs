// Loads .env.local (Node 22's built-in loader) for the scripts.
try {
  process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch {
  // no .env.local: rely on the shell environment
}
export const env = process.env;

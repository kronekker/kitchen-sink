import fs from 'fs';
import path from 'path';

let envLoaded = false;

function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;

  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn('Failed to parse backend/.env:', err);
  }
}

// see skills/SECRETS-MANAGEMENT.md
export class Secrets {
  static resolveSecret(envVarName: string): string | undefined {
    ensureEnvLoaded();

    const fileVarName = `${envVarName}_FILE`;
    const secretFilePath = process.env[fileVarName];

    if (secretFilePath && fs.existsSync(secretFilePath)) {
      try {
        return fs.readFileSync(secretFilePath, 'utf8').trim();
      } catch (error) {
        console.warn(`Failed to read secret file at ${secretFilePath}:`, error);
      }
    }

    return process.env[envVarName];
  }
}

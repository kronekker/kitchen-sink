import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IsMtpMode, LlamaScriptConfig, SystemdServiceStatus } from '@shared/index';

const execFileAsync = promisify(execFile);

export const LLAMA_SYSTEMD_UNIT = process.env.LLAMA_SYSTEMD_UNIT || 'kron-llama-server.service';
export const LLAMA_START_SCRIPT =
  process.env.LLAMA_START_SCRIPT || path.join(os.homedir(), '.local/bin/start-llama-cpp.sh');

export type SystemdAction = 'start' | 'stop' | 'restart';

const VALID_MODEL_NAME = /^[a-zA-Z0-9._/-]{1,200}$/;
const VALID_MODEL_QUANT = /^[a-zA-Z0-9._-]{1,64}$/;
const VALID_IS_MTP: ReadonlySet<string> = new Set(['true', 'false', 'unknown']);

export async function getLlamaServiceStatus(): Promise<SystemdServiceStatus> {
  const { stdout } = await execFileAsync('systemctl', [
    '--user',
    'show',
    LLAMA_SYSTEMD_UNIT,
    '--property=ActiveState,SubState,LoadState,MainPID,ActiveEnterTimestamp,Description',
  ]);

  const props: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      props[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
    }
  }

  const pidNum = Number(props['MainPID']);
  return {
    unit: LLAMA_SYSTEMD_UNIT,
    activeState: props['ActiveState'] || 'unknown',
    subState: props['SubState'] || 'unknown',
    loadState: props['LoadState'] || 'unknown',
    mainPid: Number.isInteger(pidNum) && pidNum > 0 ? pidNum : null,
    activeEnterTimestamp: props['ActiveEnterTimestamp'] || null,
    description: props['Description'] || null,
  };
}

export async function controlLlamaService(action: SystemdAction): Promise<SystemdServiceStatus> {
  if (action !== 'start' && action !== 'stop' && action !== 'restart') {
    throw new Error(`Unsupported systemd action: ${action}`);
  }
  await execFileAsync('systemctl', ['--user', action, LLAMA_SYSTEMD_UNIT]);
  return getLlamaServiceStatus();
}

function extractBashVar(content: string, varName: string): string | null {
  const regex = new RegExp(`^\\s*${varName}=(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`, 'm');
  const match = content.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function replaceBashVar(content: string, varName: string, newValue: string): string {
  const regex = new RegExp(`^(\\s*${varName}=)(?:"[^"]*"|'[^']*'|[^\\s#]+)(.*)$`, 'm');
  if (!regex.test(content)) {
    throw new Error(`Could not locate variable ${varName} in ${LLAMA_START_SCRIPT}`);
  }
  return content.replace(regex, `$1"${newValue}"$2`);
}

export function validateLlamaConfigInput(input: {
  modelName: unknown;
  modelQuant: unknown;
  modelCtx: unknown;
  isMtp: unknown;
}): { modelName: string; modelQuant: string; modelCtx: number; isMtp: IsMtpMode } {
  const modelName = typeof input.modelName === 'string' ? input.modelName.trim() : '';
  const modelQuant = typeof input.modelQuant === 'string' ? input.modelQuant.trim() : '';
  const modelCtx = Number(input.modelCtx);
  const isMtp = typeof input.isMtp === 'string' ? input.isMtp.trim() : '';

  if (!VALID_MODEL_NAME.test(modelName)) {
    throw new Error('MODEL_NAME must contain only letters, numbers, ".", "_", "/", or "-".');
  }
  if (!VALID_MODEL_QUANT.test(modelQuant)) {
    throw new Error('MODEL_QUANT must contain only letters, numbers, ".", "_", or "-".');
  }
  if (!Number.isInteger(modelCtx) || modelCtx < 512 || modelCtx > 2097152) {
    throw new Error('MODEL_CTX must be an integer between 512 and 2097152.');
  }
  if (!VALID_IS_MTP.has(isMtp)) {
    throw new Error('IS_MTP must be "true", "false", or "unknown".');
  }

  return { modelName, modelQuant, modelCtx, isMtp: isMtp as IsMtpMode };
}

export function readLlamaScriptConfig(): LlamaScriptConfig {
  if (!fs.existsSync(LLAMA_START_SCRIPT)) {
    throw new Error(`Launch script not found at ${LLAMA_START_SCRIPT}`);
  }
  const content = fs.readFileSync(LLAMA_START_SCRIPT, 'utf8');
  const modelName = extractBashVar(content, 'MODEL_NAME') ?? '';
  const modelQuant = extractBashVar(content, 'MODEL_QUANT') ?? '';
  const rawCtx = extractBashVar(content, 'MODEL_CTX') ?? '0';
  const rawMtp = extractBashVar(content, 'IS_MTP') ?? 'unknown';
  const isMtp: IsMtpMode = VALID_IS_MTP.has(rawMtp) ? (rawMtp as IsMtpMode) : 'unknown';

  return {
    scriptPath: LLAMA_START_SCRIPT,
    modelName,
    modelQuant,
    modelCtx: Number(rawCtx) || 0,
    isMtp,
  };
}

export function writeLlamaScriptConfig(input: {
  modelName: unknown;
  modelQuant: unknown;
  modelCtx: unknown;
  isMtp: unknown;
}): LlamaScriptConfig {
  const validated = validateLlamaConfigInput(input);

  if (!fs.existsSync(LLAMA_START_SCRIPT)) {
    throw new Error(`Launch script not found at ${LLAMA_START_SCRIPT}`);
  }

  const original = fs.readFileSync(LLAMA_START_SCRIPT, 'utf8');
  const stats = fs.statSync(LLAMA_START_SCRIPT);

  let updated = replaceBashVar(original, 'MODEL_NAME', validated.modelName);
  updated = replaceBashVar(updated, 'MODEL_QUANT', validated.modelQuant);
  updated = replaceBashVar(updated, 'MODEL_CTX', String(validated.modelCtx));
  updated = replaceBashVar(updated, 'IS_MTP', validated.isMtp);

  // Create backup before atomic write
  fs.writeFileSync(`${LLAMA_START_SCRIPT}.bak`, original, { mode: stats.mode });
  const tmpPath = `${LLAMA_START_SCRIPT}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, updated, { mode: stats.mode });
  fs.renameSync(tmpPath, LLAMA_START_SCRIPT);

  return readLlamaScriptConfig();
}

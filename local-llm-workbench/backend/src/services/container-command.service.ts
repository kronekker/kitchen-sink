import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  LaunchPersistentContainerResponse,
  RestartPolicy,
  TransformContainerCommandRequest,
  TransformContainerCommandResult,
} from '@shared/index';

const execFileAsync = promisify(execFile);

const VALID_RESTART_POLICIES: ReadonlySet<string> = new Set([
  'unless-stopped',
  'always',
  'on-failure',
  'no',
]);

const VALID_CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

// docker/podman `run` flags that consume the next token as their value
const FLAGS_WITH_VALUE: ReadonlySet<string> = new Set([
  '-a', '--attach',
  '--add-host',
  '--annotation',
  '--blkio-weight',
  '--blkio-weight-device',
  '--cap-add',
  '--cap-drop',
  '--cgroup-parent',
  '--cgroupns',
  '--cidfile',
  '--cpu-period',
  '--cpu-quota',
  '--cpu-rt-period',
  '--cpu-rt-runtime',
  '-c', '--cpu-shares',
  '--cpus',
  '--cpuset-cpus',
  '--cpuset-mems',
  '--detach-keys',
  '--device',
  '--device-cgroup-rule',
  '--device-read-bps',
  '--device-read-iops',
  '--device-write-bps',
  '--device-write-iops',
  '--dns',
  '--dns-option',
  '--dns-search',
  '--domainname',
  '--entrypoint',
  '-e', '--env',
  '--env-file',
  '--expose',
  '--gpus',
  '--group-add',
  '--health-cmd',
  '--health-interval',
  '--health-retries',
  '--health-start-period',
  '--health-timeout',
  '-h', '--hostname',
  '--ip',
  '--ip6',
  '--ipc',
  '--isolation',
  '--kernel-memory',
  '-l', '--label',
  '--label-file',
  '--link',
  '--link-local-ip',
  '--log-driver',
  '--log-opt',
  '--mac-address',
  '-m', '--memory',
  '--memory-reservation',
  '--memory-swap',
  '--memory-swappiness',
  '--mount',
  '--name',
  '--net', '--network',
  '--network-alias',
  '--oom-score-adj',
  '--pid',
  '--pids-limit',
  '--platform',
  '-p', '--publish',
  '--pull',
  '--restart',
  '--runtime',
  '--security-opt',
  '--shm-size',
  '--stop-signal',
  '--stop-timeout',
  '--storage-opt',
  '--sysctl',
  '--tmpfs',
  '--ulimit',
  '-u', '--user',
  '--userns',
  '--uts',
  '-v', '--volume',
  '--volume-driver',
  '--volumes-from',
  '-w', '--workdir',
]);

/**
 * Tokenizes a shell-like command string without invoking a shell.
 * Rejects unquoted shell chaining/substitution metacharacters.
 */
function tokenizeCommand(raw: string): string[] {
  // Collapse backslash-newline continuations
  const normalized = raw.replace(/\\\r?\n/g, ' ').trim();
  if (!normalized) {
    throw new Error('Command cannot be empty.');
  }

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    // Reject shell chaining / redirection / command substitution outside quotes
    if (ch === ';' || ch === '|' || ch === '&' || ch === '`' || ch === '>' || ch === '<') {
      throw new Error(`Unsupported shell operator "${ch}" in command. Paste only a single docker/podman run command.`);
    }
    if (ch === '$' && normalized[i + 1] === '(') {
      throw new Error('Command substitution "$(" is not permitted.');
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (quote) {
    throw new Error(`Unclosed ${quote} quote in command.`);
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9_./:=,@+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function transformContainerCommand(
  req: TransformContainerCommandRequest
): TransformContainerCommandResult {
  const rawCommand = typeof req.rawCommand === 'string' ? req.rawCommand : '';
  const restartPolicy: RestartPolicy =
    req.restartPolicy && VALID_RESTART_POLICIES.has(req.restartPolicy)
      ? req.restartPolicy
      : 'unless-stopped';

  const overrideName =
    typeof req.containerName === 'string' && req.containerName.trim().length > 0
      ? req.containerName.trim()
      : null;

  if (overrideName && !VALID_CONTAINER_NAME.test(overrideName)) {
    throw new Error(
      'Container name must start with an alphanumeric character and contain only letters, numbers, ".", "_", or "-".'
    );
  }

  const tokens = tokenizeCommand(rawCommand);
  if (tokens.length < 3) {
    throw new Error('Command must be a valid "docker run ..." or "podman run ..." command.');
  }

  const rawBin = tokens[0].toLowerCase();
  let runtime: 'podman' | 'docker';
  if (rawBin === 'docker' || rawBin.endsWith('/docker')) {
    runtime = 'docker';
  } else if (rawBin === 'podman' || rawBin.endsWith('/podman')) {
    runtime = 'podman';
  } else {
    throw new Error(`Command must start with "docker" or "podman" (got "${tokens[0]}").`);
  }

  if (tokens[1] !== 'run') {
    throw new Error(`Only "run" subcommands are supported (got "${tokens[1]}").`);
  }

  const removedFlags: string[] = [];
  const addedFlags: string[] = [];
  const keptOptions: string[] = [];

  let hasDetach = false;
  let detectedName: string | null = null;
  let imageIndex = -1;

  let i = 2;
  while (i < tokens.length) {
    const tok = tokens[i];

    // End of docker/podman options: first non-flag token is the image name
    if (!tok.startsWith('-') || tok === '-') {
      imageIndex = i;
      break;
    }

    // Handle --rm / --rm=true
    if (tok === '--rm' || tok === '--rm=true') {
      removedFlags.push(tok);
      i += 1;
      continue;
    }

    // Handle --interactive / --tty
    if (tok === '--interactive' || tok === '--tty') {
      removedFlags.push(tok);
      i += 1;
      continue;
    }

    // Handle --detach / -d
    if (tok === '-d' || tok === '--detach') {
      hasDetach = true;
      keptOptions.push(tok);
      i += 1;
      continue;
    }

    // Handle combined short flags like -it, -ti, -dit, -i, -t
    if (/^-[a-zA-Z]+$/.test(tok) && !FLAGS_WITH_VALUE.has(tok)) {
      const letters = tok.slice(1).split('');
      const hasInteractiveOrTty = letters.includes('i') || letters.includes('t');
      if (hasInteractiveOrTty) {
        removedFlags.push(tok);
        const remaining = letters.filter((l) => l !== 'i' && l !== 't');
        if (remaining.includes('d')) {
          hasDetach = true;
        }
        if (remaining.length > 0) {
          keptOptions.push(`-${remaining.join('')}`);
        }
        i += 1;
        continue;
      }
    }

    // Handle --restart / --restart=...
    if (tok === '--restart') {
      const prevVal = tokens[i + 1] ?? '';
      removedFlags.push(prevVal ? `--restart ${prevVal}` : '--restart');
      i += 2;
      continue;
    }
    if (tok.startsWith('--restart=')) {
      removedFlags.push(tok);
      i += 1;
      continue;
    }

    // Handle --name / --name=...
    if (tok === '--name') {
      const val = tokens[i + 1];
      if (!val) {
        throw new Error('Missing value after --name flag.');
      }
      detectedName = val;
      if (overrideName) {
        keptOptions.push('--name', overrideName);
      } else {
        keptOptions.push('--name', val);
      }
      i += 2;
      continue;
    }
    if (tok.startsWith('--name=')) {
      detectedName = tok.slice('--name='.length);
      if (overrideName) {
        keptOptions.push('--name', overrideName);
      } else {
        keptOptions.push(tok);
      }
      i += 1;
      continue;
    }

    // Handle any other flag that takes a separate value
    if (FLAGS_WITH_VALUE.has(tok)) {
      const val = tokens[i + 1];
      if (val === undefined) {
        throw new Error(`Missing value after flag "${tok}".`);
      }
      keptOptions.push(tok, val);
      i += 2;
      continue;
    }

    // Other boolean flags or --flag=value
    keptOptions.push(tok);
    i += 1;
  }

  if (imageIndex === -1) {
    throw new Error('Could not find a container image name in the command.');
  }

  const image = tokens[imageIndex];
  const containerArgs = tokens.slice(imageIndex + 1);
  const finalName = overrideName ?? detectedName;

  const injectedOptions: string[] = [];
  if (!hasDetach) {
    injectedOptions.push('-d');
    addedFlags.push('-d');
  }
  if (restartPolicy !== 'no') {
    injectedOptions.push('--restart', restartPolicy);
    addedFlags.push(`--restart ${restartPolicy}`);
  }
  if (overrideName && !detectedName) {
    injectedOptions.push('--name', overrideName);
    addedFlags.push(`--name ${overrideName}`);
  }

  const finalArgs = ['run', ...injectedOptions, ...keptOptions, image, ...containerArgs];
  const formattedCommand = [runtime, ...finalArgs].map(shellQuote).join(' ');

  return {
    runtime,
    args: finalArgs,
    formattedCommand,
    containerName: finalName,
    image,
    removedFlags,
    addedFlags,
  };
}

export async function launchPersistentContainer(
  req: TransformContainerCommandRequest
): Promise<LaunchPersistentContainerResponse> {
  const transformed = transformContainerCommand(req);

  if (req.replaceExisting && transformed.containerName) {
    try {
      await execFileAsync(transformed.runtime, ['rm', '-f', transformed.containerName], {
        timeout: 15000,
      });
    } catch {
      // Ignore if container does not exist yet
    }
  }

  const { stdout, stderr } = await execFileAsync(transformed.runtime, transformed.args, {
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });

  const containerId = stdout.trim().split('\n').pop()?.trim() || '';

  return {
    containerId,
    containerName: transformed.containerName,
    formattedCommand: transformed.formattedCommand,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

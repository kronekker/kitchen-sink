import { execFile } from 'child_process';
import { promisify } from 'util';
import { ContainerInfo } from '@shared/index';

const execFileAsync = promisify(execFile);

function formatPodmanPorts(ports: any): string {
  if (!Array.isArray(ports) || ports.length === 0) return '';
  return ports
    .map((p: any) => {
      const hostIp = p.host_ip ? `${p.host_ip}:` : '';
      const hostPort = p.host_port ? `${p.host_port}->` : '';
      const containerPort = p.container_port ?? '';
      const proto = p.protocol ? `/${p.protocol}` : '';
      return `${hostIp}${hostPort}${containerPort}${proto}`;
    })
    .join(', ');
}

function matchesPort8081OrCockpit(info: ContainerInfo): boolean {
  const portsMatch = info.ports.includes('8081');
  const nameMatch = info.name.toLowerCase().includes('cockpit');
  const cmdMatch = info.command.includes('8081');
  return portsMatch || nameMatch || cmdMatch;
}

async function listPodmanContainers(): Promise<ContainerInfo[]> {
  const { stdout } = await execFileAsync('podman', ['ps', '-a', '--format', 'json'], {
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout || '[]');
  if (!Array.isArray(parsed)) return [];

  return parsed.map((c: any): ContainerInfo => {
    const names = Array.isArray(c.Names) ? c.Names : c.Names ? [String(c.Names)] : [];
    const cmd = Array.isArray(c.Command) ? c.Command.join(' ') : String(c.Command ?? '');
    const title = c.Labels?.['org.opencontainers.image.title'] ?? null;

    return {
      runtime: 'podman',
      id: String(c.Id ?? ''),
      name: names[0] ? String(names[0]).replace(/^\//, '') : String(c.Id ?? '').slice(0, 12),
      image: String(c.Image ?? ''),
      imageTitle: title ? String(title) : null,
      state: String(c.State ?? (c.Exited ? 'exited' : 'running')),
      status: String(c.Status ?? c.State ?? ''),
      ports: formatPodmanPorts(c.Ports),
      command: cmd,
      created: String(c.CreatedAt ?? c.Created ?? ''),
    };
  });
}

async function listDockerContainers(): Promise<ContainerInfo[]> {
  const { stdout } = await execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}'], {
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });

  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ContainerInfo[] = [];
  for (const line of lines) {
    try {
      const c = JSON.parse(line);
      results.push({
        runtime: 'docker',
        id: String(c.ID ?? ''),
        name: String(c.Names ?? '').replace(/^\//, ''),
        image: String(c.Image ?? ''),
        imageTitle: null,
        state: String(c.State ?? ''),
        status: String(c.Status ?? ''),
        ports: String(c.Ports ?? ''),
        command: String(c.Command ?? ''),
        created: String(c.RunningFor ?? c.CreatedAt ?? ''),
      });
    } catch {
      // skip malformed line
    }
  }
  return results;
}

export async function findPort8081Containers(): Promise<ContainerInfo[]> {
  let all: ContainerInfo[] = [];

  try {
    all = await listPodmanContainers();
  } catch {
    try {
      all = await listDockerContainers();
    } catch {
      return [];
    }
  }

  return all
    .filter(matchesPort8081OrCockpit)
    .sort((a, b) => {
      const aRunning = a.state.toLowerCase() === 'running' ? 0 : 1;
      const bRunning = b.state.toLowerCase() === 'running' ? 0 : 1;
      return aRunning - bRunning;
    });
}

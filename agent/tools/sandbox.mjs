import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';

export const IMAGE = process.env.SKEPTIC_IMAGE ?? 'node:22.23.2-bookworm-slim';
const MODE = process.env.SKEPTIC_SANDBOX ?? 'docker';

// Runs `command` inside `<workspace>/<project>`. Docker mode: no network (unless asked for),
// no host environment variables, no capabilities. Local mode is only a fast path for development.
export function run(workspace, project, command, { network = false, timeoutSeconds = 300 } = {}) {
  const guarded = ['timeout', '-k', '5', String(timeoutSeconds), 'sh', '-c', command];
  let bin, args, options;
  if (MODE === 'local') {
    [bin, args] = ['sh', ['-c', command]];
    options = { cwd: `${workspace}/${project}`, env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: '1' } };
  } else {
    const { uid, gid } = userInfo();
    bin = 'docker';
    args = [
      'run', '--rm', ...(network ? [] : ['--network', 'none']),
      '--user', `${uid}:${gid}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '512', '--memory', '3g', '--read-only', '--tmpfs', '/tmp',
      '-e', 'HOME=/tmp', '-e', 'CI=1', '-v', `${workspace}:/work`, '-w', `/work/${project}`,
      IMAGE, ...guarded,
    ];
    options = {};
  }
  const result = spawnSync(bin, args, {
    ...options, encoding: 'utf8', timeout: (timeoutSeconds + 30) * 1000, maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status,
    timedOut: result.status === 124 || result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
    root: MODE === 'local' ? workspace : '/work',
  };
}

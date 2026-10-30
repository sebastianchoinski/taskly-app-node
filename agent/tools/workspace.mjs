// A throwaway git worktree of the code under test, with dependencies installed inside the sandbox.
// The agent works here; the developer's checkout is never touched.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { install, PROJECTS } from './tests.mjs';

export function createWorkspace(repository, ref) {
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'skeptic-')));
  execFileSync('git', ['-C', repository, 'worktree', 'add', '--detach', workspace, ref], { stdio: 'ignore' });
  try {
    for (const project of PROJECTS) install(workspace, project);
  } catch (error) {
    removeWorkspace(repository, workspace);
    throw error;
  }
  return workspace;
}

export function removeWorkspace(repository, workspace) {
  execFileSync('git', ['-C', repository, 'worktree', 'remove', '--force', workspace], { stdio: 'ignore' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create') console.log(createWorkspace(path.resolve('.'), args[0] ?? 'HEAD'));
  else if (command === 'remove') removeWorkspace(path.resolve('.'), args[0]);
  else console.log('Usage: workspace.mjs create [ref] | remove <path>');
}

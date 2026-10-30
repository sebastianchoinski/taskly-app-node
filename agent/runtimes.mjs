// The "brain" is replaceable; the barriers around it are not. Each runtime gets the same workspace
// and agent definition, and must leave its results in the workspace.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PLUGIN_DIR = import.meta.dirname;

// Variables the check command needs to reach Docker; nothing else from the host is passed on.
const passThrough = () => Object.fromEntries(['PATH', 'DOCKER_HOST', 'SKEPTIC_IMAGE', 'SKEPTIC_SANDBOX']
  .filter((name) => process.env[name]).map((name) => [name, process.env[name]]));

// CLAUDE.md files in the PR would otherwise become instructions with system-prompt authority.
const CLAUDE_ENV = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
  CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

export function claudeArgs({ agent, prompt, agentsFile, settingsFile, model }) {
  return [
    '-p', prompt,
    // Ignores project settings and hooks from the PR and confines file tools to the workspace.
    '--restricted',
    '--plugin-dir', PLUGIN_DIR,
    '--agents', agentsFile, '--agent', agent.name,
    '--tools', agent.tools.join(','),
    '--settings', settingsFile,
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--max-budget-usd', String(agent.maxBudgetUsd),
    '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose',
    ...(model ? ['--model', model] : []),
  ];
}

export function claudeSettings(agent, checkCommand) {
  return {
    permissions: {
      defaultMode: 'dontAsk',
      allow: [...agent.tools.filter((tool) => tool !== 'Bash'), `Bash(${checkCommand} *)`],
      deny: ['WebFetch', 'WebSearch'],
    },
  };
}

const GEMINI_TOOLS = ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search',
  'write_file', 'replace', 'activate_skill', 'run_shell_command'];
// The free tier allows ~20 requests a day on full Flash models and one run needs about that many;
// Flash-Lite fits. With a paid key, set SKEPTIC_MODEL (e.g. gemini-3.8-flash).
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

// Do not use tools.core here: listing run_shell_command there approves every command and
// bypasses the policy below.
export function geminiSettings({ model, maxTurns }) {
  return {
    model: { name: model, maxSessionTurns: maxTurns },
    experimental: { enableAgents: false },
    privacy: { usageStatisticsEnabled: false },
    general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
    security: { environmentVariableRedaction: { enabled: true } },
  };
}

// User-tier policy. A deny rule without an argument pattern hides the tool from the model, so the
// shell is allowed in general and every command that is not the check command with plain file
// paths is denied by a higher rule: `&&`, `;`, `$(…)` or redirections never match. Gemini CLI
// silently drops patterns with nested quantifiers, hence one flat character class.
export function geminiPolicy(checkCommand) {
  const escaped = checkCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [
    { toolName: '*', decision: 'deny', priority: 10 },
    { toolName: GEMINI_TOOLS, decision: 'allow', priority: 100 },
    { toolName: 'run_shell_command', commandRegex: `(?!${escaped} [\\w./@ -]*")`, decision: 'deny', priority: 200,
      denyMessage: 'Only the check command from .skeptic/task.md, followed by test file paths, may run.' },
  ];
  return rules.map((rule) => ['[[rule]]', ...Object.entries(rule).map(([key, value]) => `${key} = ${JSON.stringify(value)}`)].join('\n'))
    .join('\n\n');
}

// Gemini CLI loads settings, hooks, skills and GEMINI.md from the project it runs in. A pull
// request that brings its own would be configuring the agent that judges it.
export function geminiProjectConfig(workspace) {
  return execFileSync('git', ['-C', workspace, 'ls-files', '--', '.gemini', '.agents', ':(glob)**/GEMINI.md'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

export const runtimes = {
  // Claude Code in headless mode. The agent and skills are loaded as a plugin from the trusted
  // checkout; nothing from the pull request can redefine them.
  claude: {
    missing: () => (process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not set, so the agent cannot run.'),
    run({ workspace, agent, prompt, checkCommand, transcriptFile, timeoutSeconds }) {
      const scratch = mkdtempSync(path.join(tmpdir(), 'skeptic-claude-'));
      try {
        const agentsFile = path.join(scratch, 'agents.json');
        const settingsFile = path.join(scratch, 'settings.json');
        writeFileSync(agentsFile, JSON.stringify({ [agent.name]: { description: agent.description, prompt: agent.body, tools: agent.tools } }));
        writeFileSync(settingsFile, JSON.stringify(claudeSettings(agent, checkCommand)));
        const result = spawnSync(process.env.SKEPTIC_CLAUDE_BIN || 'claude',
          claudeArgs({ agent, prompt, agentsFile, settingsFile, model: process.env.SKEPTIC_MODEL || undefined }), {
            cwd: workspace,
            encoding: 'utf8',
            timeout: timeoutSeconds * 1000,
            maxBuffer: 64 * 1024 * 1024,
            env: { ...passThrough(), HOME: scratch, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ...CLAUDE_ENV },
          });
        writeFileSync(transcriptFile, result.stdout ?? '');
        if (result.error) return { ok: false, error: result.error.message };
        const final = lastResult(result.stdout ?? '');
        if (result.status !== 0 || final?.is_error) {
          return { ok: false, error: final?.result || (result.stderr || '').slice(-2000) || `claude exited with ${result.status}` };
        }
        return { ok: true, cost: final?.total_cost_usd };
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  },

  // Gemini CLI in headless mode. Settings, skills and policy live in a throwaway HOME built from the
  // trusted checkout; the agent definition becomes the prompt.
  gemini: {
    missing: () => (process.env.GEMINI_API_KEY ? null : 'GEMINI_API_KEY is not set, so the agent cannot run.'),
    run({ workspace, agent, prompt, checkCommand, transcriptFile, timeoutSeconds }) {
      const config = geminiProjectConfig(workspace);
      if (config.length) return { ok: false, error: `The pull request contains Gemini CLI configuration (${config.join(', ')}); refusing to let it configure the agent.` };
      const home = mkdtempSync(path.join(tmpdir(), 'skeptic-gemini-'));
      try {
        mkdirSync(path.join(home, '.gemini'));
        cpSync(path.join(PLUGIN_DIR, 'skills'), path.join(home, '.gemini/skills'), { recursive: true });
        const settings = geminiSettings({ model: process.env.SKEPTIC_MODEL || GEMINI_MODEL, maxTurns: agent.maxTurns });
        writeFileSync(path.join(home, '.gemini/settings.json'), JSON.stringify(settings, null, 2));
        const policyFile = path.join(home, 'skeptic-policy.toml');
        writeFileSync(policyFile, geminiPolicy(checkCommand));
        const result = spawnSync(process.env.SKEPTIC_GEMINI_BIN || 'gemini', [
          '-p', `${agent.body}\n\n---\n\n${prompt}`,
          '--policy', policyFile, '--skip-trust', '--output-format', 'stream-json',
        ], {
          cwd: workspace,
          encoding: 'utf8',
          timeout: timeoutSeconds * 1000,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...passThrough(), HOME: home, TERM: 'dumb', GEMINI_API_KEY: process.env.GEMINI_API_KEY },
        });
        writeFileSync(transcriptFile, result.stdout ?? '');
        if (result.error) return { ok: false, error: result.error.message };
        const final = lastResult(result.stdout ?? '');
        if (result.status === 53) return { ok: false, error: `The agent used all ${agent.maxTurns} turns without finishing.` };
        if (result.status !== 0 || final?.status !== 'success') {
          return { ok: false, error: final?.error?.message || (result.stderr || '').slice(-2000) || `gemini exited with ${result.status}` };
        }
        return { ok: true, tokens: final.stats?.total_tokens };
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  },

  // A stand-in for the model: copies prepared files into the workspace. Used to test the pipeline
  // end to end without an API key. It proves the plumbing, not the quality of generated tests.
  fixture: {
    missing: () => (process.env.SKEPTIC_FIXTURE ? null : 'SKEPTIC_FIXTURE is not set.'),
    run({ workspace, transcriptFile }) {
      const source = process.env.SKEPTIC_FIXTURE;
      cpSync(path.resolve(source), workspace, { recursive: true });
      writeFileSync(transcriptFile, `fixture: ${source}\n`);
      return { ok: true };
    },
  },
};

function lastResult(transcript) {
  const line = transcript.trim().split('\n').reverse().find((entry) => entry.includes('"type":"result"'));
  try { return line ? JSON.parse(line) : null; } catch { return null; }
}

// Skills the model actually opened, read from the transcript rather than trusted from its own report.
export function skillsFromTranscript(transcript) {
  const used = new Set();
  for (const match of transcript.matchAll(/"name":"Skill","input":\{"(?:skill|command)":"(?:[\w-]+:)?([\w-]+)"/g)) used.add(match[1]);
  for (const match of transcript.matchAll(/"tool_name":"activate_skill",[^\n]*?"parameters":\{"name":"([\w-]+)"/g)) used.add(match[1]);
  for (const match of transcript.matchAll(/skills\/([\w-]+)\/SKILL\.md/g)) used.add(match[1]);
  return [...used];
}

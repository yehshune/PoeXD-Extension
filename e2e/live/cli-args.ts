/** `pnpm poe` 的參數解析（純函式）。`--key value`、`--key=value`、`--flag` 三種寫法皆可。 */

export interface CliArgs {
  readonly command: string | null;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

/** 不接值的旗標；其餘 `--key` 會吃掉下一個參數當值 */
const BOOLEAN_FLAGS = new Set(['full', 'new', 'json', 'help']);

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (BOOLEAN_FLAGS.has(body) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      flags[body] = true;
    } else {
      flags[body] = argv[i + 1];
      i += 1;
    }
  }
  const [command = null, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

export function flagString(args: CliArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagInt(args: CliArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`--${name} 需要非負整數，收到「${value}」`);
  return parsed;
}

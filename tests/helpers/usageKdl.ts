// A reader of the KDL subset phax.usage.kdl is written in, in both of its styles during
// command-contracts: today's walk writes child nodes (`flag "--plan" { arg "<path>"; help "…" }`)
// and the runner's usage spec writes properties (`flag "--plan <path>" help="…"`). It reads `cmd`,
// `arg`, `flag`, `help`, `long_help`, `example`, `complete`, `default`, `required`, `global`,
// `choices` and the root's own nodes, as child nodes or as properties, and returns each command's
// declarations by path, the same whichever style wrote them.

type Value = string | number | boolean | null;

interface KdlNode {
  readonly name: string;
  readonly args: ReadonlyArray<Value>;
  readonly props: Readonly<Record<string, Value>>;
  readonly children: ReadonlyArray<KdlNode>;
}

type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "open" }
  | { readonly kind: "close" }
  | { readonly kind: "end" }
  | { readonly kind: "equals" };

function readString(source: string, start: number): { text: string; next: number } {
  let text = "";
  let index = start + 1;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === '"') return { text, next: index + 1 };
    if (char === "\\") {
      const escape = source[index + 1];
      if (escape === "n") text += "\n";
      else if (escape === "r") text += "\r";
      else if (escape === "t") text += "\t";
      else if (escape === "u") {
        const close = source.indexOf("}", index);
        text += String.fromCodePoint(Number.parseInt(source.slice(index + 3, close), 16));
        index = close + 1;
        continue;
      } else text += escape ?? "";
      index += 2;
      continue;
    }
    text += char;
    index += 1;
  }
  throw new Error(`unterminated string at ${start}`);
}

function tokenize(source: string): ReadonlyArray<Token> {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === "\n" || char === ";") {
      tokens.push({ kind: "end" });
      index += 1;
    } else if (char === " " || char === "\t" || char === "\r") {
      index += 1;
    } else if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (char === "{") {
      tokens.push({ kind: "open" });
      index += 1;
    } else if (char === "}") {
      tokens.push({ kind: "close" });
      index += 1;
    } else if (char === "=") {
      tokens.push({ kind: "equals" });
      index += 1;
    } else if (char === '"') {
      const read = readString(source, index);
      tokens.push({ kind: "string", text: read.text });
      index = read.next;
    } else {
      let end = index;
      while (end < source.length && !/[\s{}=;"]/.test(source[end] as string)) end += 1;
      tokens.push({ kind: "word", text: source.slice(index, end) });
      index = end;
    }
  }
  return tokens;
}

function valueOf(token: Token): Value {
  if (token.kind === "string") return token.text;
  if (token.kind !== "word") throw new Error(`a value expected, got ${token.kind}`);
  if (token.text === "#true") return true;
  if (token.text === "#false") return false;
  if (token.text === "#null") return null;
  if (/^-?\d+(\.\d+)?$/.test(token.text)) return Number(token.text);
  return token.text;
}

function parseNodes(tokens: ReadonlyArray<Token>, start: number, nested: boolean) {
  const nodes: KdlNode[] = [];
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index] as Token;
    if (token.kind === "end") {
      index += 1;
      continue;
    }
    if (token.kind === "close") {
      if (!nested) throw new Error("an unexpected }");
      return { nodes, next: index + 1 };
    }
    if (token.kind !== "word" && token.kind !== "string") {
      throw new Error(`a node name expected, got ${token.kind}`);
    }
    const name = token.text;
    index += 1;
    const args: Value[] = [];
    const props: Record<string, Value> = {};
    let children: KdlNode[] = [];
    while (index < tokens.length) {
      const current = tokens[index] as Token;
      if (current.kind === "end" || current.kind === "close") break;
      if (current.kind === "open") {
        const parsed = parseNodes(tokens, index + 1, true);
        children = parsed.nodes;
        index = parsed.next;
        break;
      }
      const following = tokens[index + 1];
      if (current.kind === "word" && following?.kind === "equals") {
        props[current.text] = valueOf(tokens[index + 2] as Token);
        index += 3;
        continue;
      }
      args.push(valueOf(current));
      index += 1;
    }
    nodes.push({ name, args, props, children });
  }
  if (nested) throw new Error("a missing }");
  return { nodes, next: index };
}

/** The KDL text as nodes. */
function parseKdl(source: string): ReadonlyArray<KdlNode> {
  return parseNodes(tokenize(source), 0, false).nodes;
}

/** A node's fields, from its properties and from its single-valued children alike. */
function fieldsOf(node: KdlNode, skip: ReadonlySet<string> = new Set()): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.props)) fields[key] = String(value);
  for (const child of node.children) {
    if (skip.has(child.name)) continue;
    fields[child.name] =
      child.name === "choices" ? child.args.map(String).join(" ") : String(child.args[0]);
  }
  return fields;
}

const declared = (kind: string, key: string, fields: Record<string, string>): string => {
  const sorted = Object.fromEntries(
    Object.entries(fields).toSorted(([a], [b]) => a.localeCompare(b)),
  );
  return `${kind} ${key} ${JSON.stringify(sorted)}`;
};

/** A flag's declaration: its long name the key, its value placeholder an `arg` field whether
 *  the usage holds it (`"--plan <path>"`) or a child node does (`arg "<path>"`). */
function flagDeclaration(node: KdlNode): string {
  const usage = String(node.args[0]).split(" ");
  const long = usage.find((part) => part.startsWith("--")) ?? usage[0] ?? "";
  const fields = fieldsOf(node);
  const short = usage.find((part) => /^-[^-]/.test(part));
  if (short !== undefined) fields["short"] = short;
  const placeholder = usage.find((part) => part.startsWith("<") || part.startsWith("["));
  if (placeholder !== undefined) fields["arg"] = placeholder;
  return declared("flag", long, fields);
}

/** One command's declarations, by kind: `help`, `long_help`, `example`, `arg`, `flag`, and any
 *  other field (`subcommand_required`). */
function commandDeclarations(node: KdlNode): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node.props))
    out.push(`${key} ${JSON.stringify(value)}`);
  for (const child of node.children) {
    if (child.name === "cmd") continue;
    if (child.name === "flag") out.push(flagDeclaration(child));
    else if (child.name === "arg")
      out.push(declared("arg", String(child.args[0]), fieldsOf(child)));
    else
      out.push(
        `${child.name} ${JSON.stringify(child.args.length === 1 ? child.args[0] : child.args)}`,
      );
  }
  return out.toSorted();
}

/** Each command's declarations by path: `""` the root (its own nodes, its global flags and its
 *  `complete` nodes), `"plans lint"` a command. Order is not a declaration. */
export function usageDeclarations(source: string): ReadonlyMap<string, ReadonlyArray<string>> {
  const result = new Map<string, ReadonlyArray<string>>();
  const nodes = parseKdl(source);
  const root: string[] = [];
  const walk = (node: KdlNode, path: string): void => {
    result.set(path, commandDeclarations(node));
    for (const child of node.children) {
      if (child.name === "cmd") walk(child, `${path} ${String(child.args[0])}`.trim());
    }
  };
  for (const node of nodes) {
    if (node.name === "cmd") walk(node, String(node.args[0]));
    else if (node.name === "flag") root.push(flagDeclaration(node));
    else if (node.name === "complete")
      root.push(declared("complete", String(node.args[0]), fieldsOf(node)));
    else root.push(`${node.name} ${JSON.stringify(node.args[0])}`);
  }
  result.set("", root.toSorted());
  return result;
}

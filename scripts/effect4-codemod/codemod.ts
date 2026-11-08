// The Effect 4 codemod's core: reads the given files and returns each one's text before
// and after the rules in `rules.ts` ran, without writing anything. A rewrite replaces
// only the matched node's text span; every other byte of the file stays as it was.
// An identifier is Effect's when its import binding, followed through local
// re-exports, ends at the module `effect` or `effect/…`. A use of an Effect symbol that
// the reference lists and no rule rewrites is a leftover, reported under the topic
// skill that owns it.
//
// ts-morph serves parsing, node spans and the files a relative import names; origin is
// decided from import and export declarations alone, never from the type checker or the
// installed `effect` package, so the codemod reads a tree the same way before and after
// Effect 4 is installed.
//
// An import binding follows its uses: when every use of `Either` is rewritten into
// `Result`, `{ Either }` becomes `{ Result }`; when every use lands in a module the file
// already binds, the binding is dropped. A binding with any use left keeps its name, and
// a use whose target module the file does not bind is then left too.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type Identifier,
  type ImportDeclaration,
  type ImportSpecifier,
  type SourceFile,
} from "ts-morph";
import { ownerOf } from "./owners.js";
import { loadReference, type Reference } from "./reference.js";
import { RULES, type RuleMapping } from "./rules.js";

/** What one run answers: every requested file, and the Effect symbols no rule rewrote. */
export type CodemodResult = {
  /** One entry per requested file, in request order; `path` is the repo-relative path as
   *  given, `rewrites` counts the rewrites per rule id. */
  files: Array<{ path: string; before: string; after: string; rewrites: Record<string, number> }>;
  /** One entry per use: `line` is 1-based in the file as read, `referenceLine` is the
   *  v3-to-v4.md line of the symbol's entry (null when it has none), `owner` the topic
   *  skill (`effect4-core`, `effect4-errors`, `effect4-schema` or `effect4-services`),
   *  `blockedBy` the uncovered symbol (and its line) that kept a rule-covered use from being
   *  rewritten, or null when no rule covers the use itself. */
  leftovers: Array<{
    path: string;
    line: number;
    v3Symbol: string;
    referenceLine: number | null;
    owner: string;
    blockedBy: { readonly v3Symbol: string; readonly line: number } | null;
  }>;
};

type Leftover = CodemodResult["leftovers"][number];

/** A replacement of `text[start, end)`; `start === end` inserts. */
type Edit = { readonly start: number; readonly end: number; readonly text: string };

/** Where an imported name comes from: an `effect` module, or one member of one. */
type Origin =
  | { readonly kind: "module"; readonly module: string; readonly via: "effect" | "relative" }
  | { readonly kind: "member"; readonly symbol: string };

/** A local name bound to an `effect` module by an import. */
type Binding = {
  readonly local: string;
  readonly module: string;
  readonly via: "effect" | "relative";
  readonly declaration: ImportDeclaration;
  /** The named import, or null for `import * as X from "effect/X"`. */
  readonly specifier: ImportSpecifier | null;
  readonly typeOnly: boolean;
};

/** How one use of a binding fares. */
type UsePlan =
  | {
      readonly kind: "rewrite";
      readonly ruleId: string;
      readonly v3Symbol: string;
      readonly targetModule: string;
      readonly line: number;
      /** The edits, given the local name the target module is bound to. */
      readonly build: (local: string) => ReadonlyArray<Edit>;
    }
  | { readonly kind: "keep" }
  | { readonly kind: "leftover"; readonly v3Symbol: string; readonly line: number };

type IndexedMapping = { readonly ruleId: string; readonly mapping: RuleMapping };

const MEMBER_MAPPINGS = new Map<string, IndexedMapping>();
const MODULE_MAPPINGS = new Map<string, IndexedMapping>();
for (const rule of RULES) {
  for (const mapping of rule.mappings) {
    const indexed = { ruleId: rule.id, mapping };
    if (mapping.form === "module") {
      MODULE_MAPPINGS.set(mapping.v3Symbol.slice("effect/".length), indexed);
    } else {
      MEMBER_MAPPINGS.set(mapping.v3Symbol, indexed);
    }
  }
}

/** The kinds whose `name` is a declaration that can shadow an import. */
const DECLARATION_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.VariableDeclaration,
  SyntaxKind.Parameter,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.ClassExpression,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.TypeParameter,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.ModuleDeclaration,
  SyntaxKind.BindingElement,
  SyntaxKind.ImportEqualsDeclaration,
]);

/** The kinds that open a block scope a declaration lives in. */
const SCOPE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.SourceFile,
  SyntaxKind.Block,
  SyntaxKind.ModuleBlock,
  SyntaxKind.CaseBlock,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
]);

function moduleNameOf(specifier: string): string | null {
  if (!specifier.startsWith("effect/")) return null;
  const name = specifier.slice("effect/".length);
  return name.length > 0 && !name.includes("/") ? name : null;
}

function splitTarget(target: string): { readonly module: string; readonly member: string } {
  const dot = target.indexOf(".");
  return { module: target.slice(0, dot), member: target.slice(dot + 1) };
}

function contains(outer: Node, inner: Node): boolean {
  return outer.getPos() <= inner.getPos() && inner.getEnd() <= outer.getEnd();
}

/** The file a relative specifier names, tried as written and as its TypeScript source. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.mjs$/, ".mts"),
    base.replace(/\.cjs$/, ".cts"),
    base.replace(/\.jsx$/, ".tsx"),
    base,
    `${base}.ts`,
    `${base}/index.ts`,
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

/** Whether `id` names a declaration (a variable, a parameter, a class, …). */
function isDeclarationName(id: Identifier): boolean {
  const parent = id.getParent();
  if (parent === undefined || !DECLARATION_KINDS.has(parent.getKind())) return false;
  const node = parent.compilerNode;
  return "name" in node && node.name === id.compilerNode;
}

/** Whether `id` reads a binding, rather than naming a property, a declaration or an
 *  import's own parts. */
function isReference(id: Identifier): boolean {
  const parent = id.getParent();
  if (parent === undefined) return false;
  if (Node.isShorthandPropertyAssignment(parent)) return true;
  if (
    Node.isImportSpecifier(parent) ||
    Node.isNamespaceImport(parent) ||
    Node.isImportClause(parent) ||
    Node.isNamespaceExport(parent)
  ) {
    return false;
  }
  if (Node.isExportSpecifier(parent)) {
    return (
      !parent.getExportDeclaration().hasModuleSpecifier() &&
      parent.getNameNode().compilerNode === id.compilerNode
    );
  }
  if (Node.isQualifiedName(parent)) return parent.getLeft().compilerNode === id.compilerNode;
  const node = parent.compilerNode;
  const self = id.compilerNode;
  if ("name" in node && node.name === self) return false;
  if ("propertyName" in node && node.propertyName === self) return false;
  if ("label" in node && node.label === self) return false;
  return true;
}

/** The node a declaration named `name` is visible in. */
function scopeOf(name: Identifier): Node {
  let declaration: Node = name.getParentOrThrow();
  while (
    Node.isBindingElement(declaration) ||
    Node.isObjectBindingPattern(declaration) ||
    Node.isArrayBindingPattern(declaration)
  ) {
    declaration = declaration.getParentOrThrow();
  }
  if (Node.isParameterDeclaration(declaration) || Node.isTypeParameterDeclaration(declaration)) {
    return declaration.getParentOrThrow();
  }
  if (Node.isFunctionExpression(declaration) || Node.isClassExpression(declaration)) {
    return declaration;
  }
  const catchClause = declaration.getParent();
  if (Node.isVariableDeclaration(declaration) && Node.isCatchClause(catchClause)) {
    return catchClause;
  }
  let scope = declaration.getParentOrThrow();
  while (!SCOPE_KINDS.has(scope.getKind())) scope = scope.getParentOrThrow();
  return scope;
}

/** The members read off a binding's use: `Either.Either.Left` gives two. */
type Member = { readonly name: string; readonly access: Node; readonly nameNode: Node };

function memberChain(id: Identifier): ReadonlyArray<Member> {
  const chain: Array<Member> = [];
  let node: Node = id;
  while (chain.length < 2) {
    const parent = node.getParent();
    if (
      Node.isPropertyAccessExpression(parent) &&
      parent.getExpression().compilerNode === node.compilerNode
    ) {
      chain.push({ name: parent.getName(), access: parent, nameNode: parent.getNameNode() });
      node = parent;
    } else if (
      Node.isQualifiedName(parent) &&
      parent.getLeft().compilerNode === node.compilerNode
    ) {
      const right = parent.getRight();
      chain.push({ name: right.getText(), access: parent, nameNode: right });
      node = parent;
    } else {
      break;
    }
  }
  return chain;
}

const replace = (node: Node, text: string): Edit => ({
  start: node.getStart(),
  end: node.getEnd(),
  text,
});

/** The local a binding renamed into `module` ends up with: an alias stays, a name that
 *  was the module's own becomes the new module's. */
function renamedLocal(binding: Binding, module: string): string {
  if (binding.specifier?.getAliasNode() !== undefined) return binding.local;
  return binding.local === binding.module ? module : binding.local;
}

/** Applies edits to `text`; edits must not overlap. */
function applyEdits(text: string, edits: ReadonlyArray<Edit>): string {
  const sorted = edits.toSorted((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) {
      throw new Error(`effect4 codemod: overlapping rewrites at offset ${edit.start}`);
    }
    out += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

/** The edits a mapping's form makes around a use, beyond renaming its member; null when
 *  the use is not in the shape the form rewrites. */
function formEdits(form: RuleMapping["form"], member: Member, text: string): Array<Edit> | null {
  const { access } = member;
  if (form === "rename") return [];
  if (!Node.isPropertyAccessExpression(access)) return null;
  const call = access.getParent();
  if (!Node.isCallExpression(call) || call.getExpression().compilerNode !== access.compilerNode) {
    return null;
  }
  const args = call.getArguments();
  if (form === "match-handlers") {
    const handlers = args.at(-1);
    if (!Node.isObjectLiteralExpression(handlers)) return null;
    const edits: Array<Edit> = [];
    for (const property of handlers.getProperties()) {
      if (
        !Node.isPropertyAssignment(property) &&
        !Node.isShorthandPropertyAssignment(property) &&
        !Node.isMethodDeclaration(property)
      ) {
        return null;
      }
      const nameNode = property.getNameNode();
      const name = nameNode.getText();
      const renamed = name === "onLeft" ? "onFailure" : name === "onRight" ? "onSuccess" : null;
      if (!Node.isIdentifier(nameNode) || renamed === null) return null;
      edits.push(
        replace(
          nameNode,
          Node.isShorthandPropertyAssignment(property) ? `${renamed}: ${name}` : renamed,
        ),
      );
    }
    return edits;
  }
  if (form === "generic-tag") {
    return call.getTypeArguments().length === 1 && args.length === 1 ? [] : null;
  }
  if (form === "tag-class") {
    const [id] = args;
    const outer = call.getParent();
    if (
      args.length !== 1 ||
      !(Node.isStringLiteral(id) || Node.isNoSubstitutionTemplateLiteral(id)) ||
      call.getTypeArguments().length > 0 ||
      !Node.isCallExpression(outer) ||
      outer.getExpression().compilerNode !== call.compilerNode ||
      outer.getTypeArguments().length === 0 ||
      outer.getArguments().length > 0
    ) {
      return null;
    }
    // `Context.Tag("id")<Self, Shape>()` -> `Context.Service<Self, Shape>()("id")`: the
    // member edit spans the id's parentheses, and the parentheses move to the end.
    return [
      {
        start: outer.getEnd(),
        end: outer.getEnd(),
        text: text.slice(access.getEnd(), call.getEnd()),
      },
    ];
  }
  if (form === "pipe-filter") {
    const [predicate] = args;
    const pipe = call.getParent();
    const pipeAccess = Node.isCallExpression(pipe) ? pipe.getExpression() : undefined;
    if (
      args.length !== 1 ||
      !(Node.isArrowFunction(predicate) || Node.isFunctionExpression(predicate)) ||
      Node.isTypePredicate(predicate.getReturnTypeNode()) ||
      call.getTypeArguments().length > 0 ||
      !Node.isCallExpression(pipe) ||
      pipe.getArguments().length !== 1 ||
      !Node.isPropertyAccessExpression(pipeAccess) ||
      pipeAccess.getName() !== "pipe"
    ) {
      return null;
    }
    return [replace(pipeAccess.getNameNode(), "check")];
  }
  if (form === "optional-exact") {
    const [schema, options] = args;
    if (args.length !== 2 || schema === undefined || !Node.isObjectLiteralExpression(options)) {
      return null;
    }
    const [exact, ...others] = options.getProperties();
    if (
      others.length > 0 ||
      !Node.isPropertyAssignment(exact) ||
      exact.getName() !== "exact" ||
      !Node.isTrueLiteral(exact.getInitializer())
    ) {
      return null;
    }
    return [{ start: schema.getEnd(), end: options.getEnd(), text: "" }];
  }
  return null;
}

/** Rewrites one file in memory; shares the project and the reference across a run. */
function rewriteSource(
  sourceFile: SourceFile,
  text: string,
  path: string,
  context: RunContext,
): { after: string; rewrites: Record<string, number>; leftovers: Array<Leftover> } {
  const { reference } = context;
  const filePath = sourceFile.getFilePath();
  const edits: Array<Edit> = [];
  const rewrites: Record<string, number> = {};
  const leftovers: Array<Leftover> = [];
  const count = (ruleId: string): void => {
    rewrites[ruleId] = (rewrites[ruleId] ?? 0) + 1;
  };
  const leave = (v3Symbol: string, line: number, blockedBy: Leftover["blockedBy"] = null): void => {
    leftovers.push({
      path,
      line,
      v3Symbol,
      referenceLine: reference.lineOf(v3Symbol),
      owner: ownerOf(v3Symbol),
      blockedBy,
    });
  };
  const moduleMoved = (module: string): boolean => reference.movedSymbols.has(`effect/${module}`);
  /** Whether an unrewritten use of `v3Symbol` (of `module`) is something to report. */
  const reportable = (v3Symbol: string, module: string): boolean =>
    reference.entryOf(v3Symbol) === undefined
      ? moduleMoved(module)
      : reference.movedSymbols.has(v3Symbol);

  const identifiers = new Map<string, Array<Identifier>>();
  for (const id of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const list = identifiers.get(id.getText());
    if (list === undefined) identifiers.set(id.getText(), [id]);
    else list.push(id);
  }
  const declaredNames = new Set<string>();
  for (const [name, ids] of identifiers) {
    if (ids.some(isDeclarationName)) declaredNames.add(name);
  }

  // Bindings: every import of an `effect` module, directly or through local re-exports.
  const bindings: Array<Binding> = [];
  const importLocals = new Set<string>();
  const renamedSpecifiers = new Set<ImportDeclaration>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const declarationTypeOnly = declaration.isTypeOnly();
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport !== undefined) importLocals.add(defaultImport.getText());
    const namespace = declaration.getNamespaceImport();
    if (namespace !== undefined) {
      importLocals.add(namespace.getText());
      const module = moduleNameOf(specifier);
      if (module !== null && reference.effectModules.has(module)) {
        bindings.push({
          local: namespace.getText(),
          module,
          via: "effect",
          declaration,
          specifier: null,
          typeOnly: declarationTypeOnly,
        });
      }
    }
    for (const named of declaration.getNamedImports()) {
      const local = (named.getAliasNode() ?? named.getNameNode()).getText();
      importLocals.add(local);
      const origin = context.originOf(filePath, specifier, named.getNameNode().getText());
      if (origin?.kind === "module") {
        bindings.push({
          local,
          module: origin.module,
          via: origin.via,
          declaration,
          specifier: named,
          typeOnly: declarationTypeOnly || named.isTypeOnly(),
        });
      } else if (origin?.kind === "member") {
        if (reportable(origin.symbol, origin.symbol.split(".")[0] ?? "")) {
          leave(origin.symbol, named.getStartLineNumber());
        }
      }
    }
  }

  /** The local a module is bound to by a binding other than `except`. */
  const boundLocal = (module: string, except: Binding): string | undefined => {
    const candidates = bindings.filter(
      (binding) =>
        binding !== except && binding.module === module && (except.typeOnly || !binding.typeOnly),
    );
    return (candidates.find((binding) => !binding.typeOnly) ?? candidates[0])?.local;
  };

  const planUse = (id: Identifier, binding: Binding): UsePlan => {
    const line = id.getStartLineNumber();
    const chain = memberChain(id);
    const [first, second] = chain;
    const unrewritten = (v3Symbol: string): UsePlan =>
      reportable(v3Symbol, binding.module)
        ? { kind: "leftover", v3Symbol, line }
        : { kind: "keep" };
    if (first === undefined) return unrewritten(`effect/${binding.module}`);
    const symbol = `${binding.module}.${first.name}`;
    if (second !== undefined) {
      const longer = `${symbol}.${second.name}`;
      if (reference.entryOf(longer) !== undefined) return unrewritten(longer);
    }
    const indexed = MEMBER_MAPPINGS.get(symbol);
    if (indexed === undefined) return unrewritten(symbol);
    const extra = formEdits(indexed.mapping.form, first, text);
    if (extra === null) return unrewritten(symbol);
    const target = splitTarget(indexed.mapping.target);
    const memberEnd =
      indexed.mapping.form === "tag-class"
        ? first.access.getParentOrThrow().getEnd()
        : first.nameNode.getEnd();
    return {
      kind: "rewrite",
      ruleId: indexed.ruleId,
      v3Symbol: symbol,
      targetModule: target.module,
      line,
      build: (local) => [
        ...(local === id.getText() ? [] : [replace(id, local)]),
        { start: first.nameNode.getStart(), end: memberEnd, text: target.member },
        ...extra,
      ],
    };
  };

  const canRename = (binding: Binding, module: string): boolean => {
    const local = renamedLocal(binding, module);
    if (local !== binding.local && (declaredNames.has(local) || importLocals.has(local))) {
      return false;
    }
    if (binding.via === "relative") {
      return MODULE_MAPPINGS.get(binding.module)?.mapping.target === `effect/${module}`;
    }
    return true;
  };

  const droppedSpecifiers = new Map<ImportDeclaration, Set<ImportSpecifier>>();
  const droppedDeclarations = new Set<ImportDeclaration>();

  for (const binding of bindings) {
    const shadows = (identifiers.get(binding.local) ?? []).filter(isDeclarationName).map(scopeOf);
    const uses = (identifiers.get(binding.local) ?? []).filter(
      (id) => isReference(id) && !shadows.some((scope) => contains(scope, id)),
    );
    const bindingLine = (binding.specifier ?? binding.declaration).getStartLineNumber();
    if (uses.length === 0) {
      if (moduleMoved(binding.module)) leave(`effect/${binding.module}`, bindingLine);
      continue;
    }
    const plans = uses.map((id) => planUse(id, binding));
    const rewritesOf = plans.flatMap((plan) => (plan.kind === "rewrite" ? [plan] : []));
    const blocked = rewritesOf.length < plans.length;
    const targetModules = [...new Set(rewritesOf.map((plan) => plan.targetModule))];
    const unbound = targetModules.filter(
      (module) => module !== binding.module && boundLocal(module, binding) === undefined,
    );
    let renameTo: string | null = null;
    let drop = false;
    if (!blocked && rewritesOf.length > 0 && !targetModules.includes(binding.module)) {
      const [only, ...more] = unbound;
      if (only === undefined) {
        drop = binding.specifier !== null || binding.declaration.getDefaultImport() === undefined;
      } else if (more.length === 0 && canRename(binding, only)) {
        renameTo = only;
      }
    }
    const localFor = (module: string): string | undefined => {
      if (module === renameTo) return renamedLocal(binding, module);
      if (module === binding.module && renameTo === null && !drop) return binding.local;
      return boundLocal(module, binding);
    };
    // The first use no rule covers is what keeps the binding's covered uses unrewritten.
    const blocker = plans.find((plan) => plan.kind === "leftover");
    const blockedBy =
      blocker === undefined || blocker.kind !== "leftover"
        ? null
        : { v3Symbol: blocker.v3Symbol, line: blocker.line };
    for (const plan of plans) {
      if (plan.kind === "keep") continue;
      if (plan.kind === "leftover") {
        leave(plan.v3Symbol, plan.line);
        continue;
      }
      const local = localFor(plan.targetModule);
      if (local === undefined) {
        leave(plan.v3Symbol, plan.line, blockedBy);
        continue;
      }
      edits.push(...plan.build(local));
      count(plan.ruleId);
    }
    if (renameTo === null && !drop) continue;
    const firstRule = rewritesOf[0]?.ruleId ?? "";
    count(MODULE_MAPPINGS.get(binding.module)?.ruleId ?? firstRule);
    if (drop) {
      if (binding.specifier === null) {
        droppedDeclarations.add(binding.declaration);
      } else {
        const set = droppedSpecifiers.get(binding.declaration) ?? new Set<ImportSpecifier>();
        set.add(binding.specifier);
        droppedSpecifiers.set(binding.declaration, set);
      }
      continue;
    }
    if (renameTo === null) continue;
    if (binding.specifier === null) {
      renamedSpecifiers.add(binding.declaration);
      const namespace = binding.declaration.getNamespaceImportOrThrow();
      if (binding.local === binding.module) edits.push(replace(namespace, renameTo));
      const literal = binding.declaration.getModuleSpecifier();
      edits.push({
        start: literal.getStart() + 1,
        end: literal.getEnd() - 1,
        text: `effect/${renameTo}`,
      });
    } else {
      const nameNode = binding.specifier.getNameNode();
      if (nameNode.getText() === binding.module) edits.push(replace(nameNode, renameTo));
    }
  }

  // Dropped named imports: a run of specifiers goes with the separator after it (or, at
  // the end of the list, the separator before it); a declaration left with nothing goes
  // whole, with its line break.
  for (const [declaration, dropped] of droppedSpecifiers) {
    const named = declaration.getNamedImports();
    if (
      named.every((specifier) => dropped.has(specifier)) &&
      declaration.getDefaultImport() === undefined
    ) {
      droppedDeclarations.add(declaration);
      continue;
    }
    let trailingFrom = named.length;
    for (;;) {
      const previous = named[trailingFrom - 1];
      if (previous === undefined || !dropped.has(previous)) break;
      trailingFrom -= 1;
    }
    named.forEach((specifier, index) => {
      if (!dropped.has(specifier) || index >= trailingFrom) return;
      const next = named[index + 1];
      if (next !== undefined)
        edits.push({ start: specifier.getStart(), end: next.getStart(), text: "" });
    });
    const last = named.at(-1);
    const beforeTrailing = named[trailingFrom - 1];
    if (trailingFrom < named.length && last !== undefined && beforeTrailing !== undefined) {
      edits.push({ start: beforeTrailing.getEnd(), end: last.getEnd(), text: "" });
    }
  }
  for (const declaration of droppedDeclarations) {
    const end = declaration.getEnd();
    const lineBreak = /^\r?\n/.exec(text.slice(end));
    edits.push({
      start: declaration.getStart(),
      end: end + (lineBreak?.[0].length ?? 0),
      text: "",
    });
  }

  // Re-exports of an `effect` module follow the module's rule, so a file importing the
  // module through them can follow its uses.
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier === undefined) continue;
    for (const named of declaration.getNamedExports()) {
      const origin = context.originOf(filePath, specifier, named.getNameNode().getText());
      if (origin?.kind === "member") {
        if (reportable(origin.symbol, origin.symbol.split(".")[0] ?? "")) {
          leave(origin.symbol, named.getStartLineNumber());
        }
        continue;
      }
      if (origin === null) continue;
      const indexed = MODULE_MAPPINGS.get(origin.module);
      if (indexed === undefined) {
        if (moduleMoved(origin.module))
          leave(`effect/${origin.module}`, named.getStartLineNumber());
        continue;
      }
      const renamed = indexed.mapping.target.slice("effect/".length);
      for (const node of [named.getNameNode(), named.getAliasNode()]) {
        if (node !== undefined && node.getText() === origin.module)
          edits.push(replace(node, renamed));
      }
      count(indexed.ruleId);
    }
  }

  // Deep module specifiers the reference maps elsewhere and no rewrite moved.
  for (const declaration of [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ]) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier === undefined || !specifier.startsWith("effect/")) continue;
    if (
      Node.isImportDeclaration(declaration) &&
      (renamedSpecifiers.has(declaration) || droppedDeclarations.has(declaration))
    ) {
      continue;
    }
    if (reference.movedSymbols.has(specifier)) leave(specifier, declaration.getStartLineNumber());
  }

  leftovers.sort((a, b) => a.line - b.line);
  return { after: applyEdits(text, edits), rewrites, leftovers };
}

type RunContext = {
  readonly reference: Reference;
  readonly originOf: (fromFile: string, specifier: string, name: string) => Origin | null;
};

/** Rewrites `files` (paths relative to `root`) in memory and reports what is left. */
export function rewriteFiles(options: {
  root: string;
  files: ReadonlyArray<string>;
}): CodemodResult {
  const reference = loadReference();
  const project = new Project({
    compilerOptions: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  const texts = new Map<string, string>();
  const sources = new Map<string, SourceFile | null>();
  const sourceAt = (absolute: string): SourceFile | null => {
    const cached = sources.get(absolute);
    if (cached !== undefined) return cached;
    let source: SourceFile | null = null;
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      const text = readFileSync(absolute, "utf8");
      texts.set(absolute, text);
      source = project.createSourceFile(absolute, text, { overwrite: true });
    }
    sources.set(absolute, source);
    return source;
  };

  /** Where `name`, imported from `specifier` in `fromFile`, comes from. */
  const originOf = (
    fromFile: string,
    specifier: string,
    name: string,
    seen: Set<string> = new Set(),
  ): Origin | null => {
    if (specifier === "effect") {
      return reference.effectModules.has(name)
        ? { kind: "module", module: name, via: "effect" }
        : null;
    }
    if (specifier.startsWith("effect/")) {
      const module = moduleNameOf(specifier);
      return module === null ? null : { kind: "member", symbol: `${module}.${name}` };
    }
    if (!specifier.startsWith(".")) return null;
    const target = resolveRelative(fromFile, specifier);
    if (target === null) return null;
    const origin = exportedOrigin(target, name, seen);
    return origin?.kind === "module" ? { ...origin, via: "relative" } : origin;
  };

  /** Where the name a local module exports as `name` comes from. */
  const exportedOrigin = (file: string, name: string, seen: Set<string>): Origin | null => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const source = sourceAt(file);
    if (source === null) return null;
    for (const declaration of source.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      const namespace = declaration.getNamespaceExport();
      if (namespace !== undefined) {
        const module = specifier === undefined ? null : moduleNameOf(specifier);
        if (
          namespace.getName() === name &&
          module !== null &&
          reference.effectModules.has(module)
        ) {
          return { kind: "module", module, via: "effect" };
        }
        continue;
      }
      const named = declaration.getNamedExports();
      if (named.length === 0) {
        if (specifier !== undefined && declaration.isNamespaceExport()) {
          const origin = originOf(file, specifier, name, seen);
          if (origin !== null) return origin;
        }
        continue;
      }
      for (const exported of named) {
        if ((exported.getAliasNode() ?? exported.getNameNode()).getText() !== name) continue;
        const local = exported.getNameNode().getText();
        return specifier === undefined
          ? localOrigin(source, local, seen)
          : originOf(file, specifier, local, seen);
      }
    }
    return null;
  };

  /** Where a local name of `source`, bound by one of its imports, comes from. */
  const localOrigin = (source: SourceFile, local: string, seen: Set<string>): Origin | null => {
    for (const declaration of source.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (declaration.getNamespaceImport()?.getText() === local) {
        const module = moduleNameOf(specifier);
        return module !== null && reference.effectModules.has(module)
          ? { kind: "module", module, via: "effect" }
          : null;
      }
      for (const named of declaration.getNamedImports()) {
        if ((named.getAliasNode() ?? named.getNameNode()).getText() === local) {
          return originOf(source.getFilePath(), specifier, named.getNameNode().getText(), seen);
        }
      }
    }
    return null;
  };

  const context: RunContext = {
    reference,
    originOf: (from, specifier, name) => originOf(from, specifier, name),
  };
  const result: CodemodResult = { files: [], leftovers: [] };
  for (const path of options.files) {
    const absolute = resolve(options.root, path);
    const source = sourceAt(absolute);
    const before = texts.get(absolute);
    if (source === null || before === undefined) {
      throw new Error(`effect4 codemod: cannot read ${path}`);
    }
    const rewritten = rewriteSource(source, before, path, context);
    result.files.push({ path, before, after: rewritten.after, rewrites: rewritten.rewrites });
    result.leftovers.push(...rewritten.leftovers);
  }
  return result;
}

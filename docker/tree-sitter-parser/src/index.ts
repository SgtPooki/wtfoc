import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Parser, { type Language } from "tree-sitter";

const PORT = Number(process.env.PORT ?? 8080);
// Max request body size: 2 MiB. Chunks larger than this are unlikely to be
// useful for import extraction and would stress the parser + memory.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 2 * 1024 * 1024);

// ── Types ────────────────────────────────────────────────────────────────────

interface ParseRequest {
	language: string;
	content: string;
	path?: string;
}

interface ParsedEdge {
	type: string;
	targetId: string;
	targetType: string;
	confidence: number;
	evidence: string;
}

/**
 * Structural symbol extracted from the AST — used by the ingest chunker to
 * align chunks with semantic boundaries (functions, classes, methods, types)
 * instead of fixed windows.
 */
interface ParsedSymbol {
	/** Symbol name (function/class/method identifier); "(anonymous)" when absent. */
	name: string;
	/**
	 * Broad kind string consistent across languages: "function" | "class" |
	 * "interface" | "type" | "enum" | "struct" | "trait" | "impl" | "method" |
	 * "module". Raw tree-sitter node type is in `nodeType` for callers that
	 * need more detail.
	 */
	kind: string;
	/** Raw tree-sitter node type (e.g. "function_declaration"). */
	nodeType: string;
	/** 0-indexed inclusive byte offset of symbol start. */
	byteStart: number;
	/** 0-indexed exclusive byte offset of symbol end. */
	byteEnd: number;
	/** 1-indexed line of first byte. */
	lineStart: number;
	/** 1-indexed line of last byte (inclusive). */
	lineEnd: number;
	/**
	 * Index into `symbols` array of enclosing symbol, or -1 if top-level.
	 * Only direct enclosure is recorded (a method's parent is its class).
	 */
	parentIndex: number;
}

interface ParseResponse {
	edges: ParsedEdge[];
	/** #220 — structural symbols for AST-aware chunking. Additive. */
	symbols: ParsedSymbol[];
	language: string;
	nodeCount: number;
}

// ── Load grammars ────────────────────────────────────────────────────────────

// Dynamic import for grammar packages — each exports a Language object.
const GRAMMAR_PACKAGES: Record<string, string> = {
	javascript: "tree-sitter-javascript",
	typescript: "tree-sitter-typescript/bindings/node/typescript.js",
	tsx: "tree-sitter-typescript/bindings/node/tsx.js",
	python: "tree-sitter-python",
	go: "tree-sitter-go",
	rust: "tree-sitter-rust",
	ruby: "tree-sitter-ruby",
	java: "tree-sitter-java",
	c: "tree-sitter-c",
	cpp: "tree-sitter-cpp",
};

const LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	ts: "typescript",
	py: "python",
	rs: "rust",
	// passthrough
	javascript: "javascript",
	typescript: "typescript",
	tsx: "tsx",
	python: "python",
	go: "go",
	rust: "rust",
	ruby: "ruby",
	java: "java",
	c: "c",
	cpp: "cpp",
};

const languages = new Map<string, Language>();

async function loadGrammars(): Promise<void> {
	for (const [name, pkg] of Object.entries(GRAMMAR_PACKAGES)) {
		try {
			const mod = await import(pkg);
			const lang = mod.default ?? mod;
			languages.set(name, lang as Language);
			console.log(`[tree-sitter-parser] Loaded grammar: ${name}`);
		} catch (e) {
			console.warn(`[tree-sitter-parser] Failed to load ${name} (${pkg}):`, (e as Error).message);
		}
	}
}

// ── Import extraction via AST traversal ──────────────────────────────────────

// Tree-sitter node type → extraction function mapping per language.
// Instead of S-expression queries (which need WASM), we walk the AST.

function stripQuotes(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

type TreeNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

function extractJsImports(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function walk(node: TreeNode): void {
		if (node.type === "import_statement" || node.type === "import") {
			const source = node.childForFieldName("source");
			if (source) {
				const targetId = stripQuotes(source.text);
				if (targetId && !seen.has(targetId)) {
					seen.add(targetId);
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: (node.text.split("\n")[0] ?? node.text).trim() });
				}
			}
		} else if (node.type === "export_statement") {
			const source = node.childForFieldName("source");
			if (source) {
				const targetId = stripQuotes(source.text);
				if (targetId && !seen.has(targetId)) {
					seen.add(targetId);
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: (node.text.split("\n")[0] ?? node.text).trim() });
				}
			}
		} else if (node.type === "call_expression") {
			const fn = node.childForFieldName("function");
			if (fn && (fn.text === "require" || fn.text === "import")) {
				const args = node.childForFieldName("arguments");
				if (args && args.namedChildCount > 0) {
					const arg = args.namedChild(0);
					if (arg && (arg.type === "string" || arg.type === "template_string")) {
						const targetId = stripQuotes(arg.text);
						if (targetId && !seen.has(targetId)) {
							seen.add(targetId);
							edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: (node.text.split("\n")[0] ?? node.text).trim() });
						}
					}
				}
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

function extractPythonImports(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function addModule(targetId: string, evidence: string): void {
		if (targetId && !seen.has(targetId)) {
			seen.add(targetId);
			edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence });
		}
	}

	function walk(node: TreeNode): void {
		if (node.type === "import_statement") {
			// Handles: import os / import os, sys / import os as alias
			// tree-sitter-python uses "name" field for each dotted_name child
			const evidence = node.text.trim();
			for (const child of node.namedChildren) {
				if (child.type === "dotted_name") {
					addModule(child.text, evidence);
				} else if (child.type === "aliased_import") {
					const name = child.childForFieldName("name");
					if (name) addModule(name.text, evidence);
				}
			}
		} else if (node.type === "import_from_statement") {
			// from module import X — extract the module name
			const moduleName = node.childForFieldName("module_name");
			if (moduleName) {
				addModule(moduleName.text, node.text.trim());
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

function extractGoImports(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function walk(node: TreeNode): void {
		if (node.type === "import_spec") {
			const path = node.childForFieldName("path");
			if (path) {
				const targetId = stripQuotes(path.text);
				if (targetId && !seen.has(targetId)) {
					seen.add(targetId);
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.trim() });
				}
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

function extractRustImports(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function walk(node: TreeNode): void {
		if (node.type === "use_declaration") {
			const arg = node.childForFieldName("argument");
			if (arg) {
				const targetId = arg.text;
				if (targetId && !seen.has(targetId)) {
					seen.add(targetId);
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.trim() });
				}
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

function extractRubyImports(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function walk(node: TreeNode): void {
		if (node.type === "call") {
			const method = node.childForFieldName("method");
			if (method && (method.text === "require" || method.text === "require_relative" || method.text === "load")) {
				const args = node.childForFieldName("arguments");
				if (args && args.namedChildCount > 0) {
					const arg = args.namedChild(0);
					if (arg) {
						const targetId = stripQuotes(arg.text);
						if (targetId && !seen.has(targetId)) {
							seen.add(targetId);
							edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.trim() });
						}
					}
				}
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

function extractJavaImports(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function walk(node: TreeNode): void {
		if (node.type === "import_declaration") {
			// The scoped_identifier is the first named child
			for (const child of node.namedChildren) {
				if (child.type === "scoped_identifier" || child.type === "identifier") {
					const targetId = child.text;
					if (targetId && !seen.has(targetId)) {
						seen.add(targetId);
						edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.trim() });
					}
				}
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

function extractCIncludes(tree: Tree): ParsedEdge[] {
	const edges: ParsedEdge[] = [];
	const seen = new Set<string>();

	function walk(node: TreeNode): void {
		if (node.type === "preproc_include") {
			const path = node.childForFieldName("path");
			if (path) {
				const targetId = stripQuotes(path.text.replace(/^<|>$/g, ""));
				if (targetId && !seen.has(targetId)) {
					seen.add(targetId);
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.trim() });
				}
			}
		}
		for (const child of node.children) walk(child);
	}

	walk(tree.rootNode);
	return edges;
}

const EXTRACTORS: Record<string, (tree: Tree) => ParsedEdge[]> = {
	javascript: extractJsImports,
	typescript: extractJsImports,
	tsx: extractJsImports,
	python: extractPythonImports,
	go: extractGoImports,
	rust: extractRustImports,
	ruby: extractRubyImports,
	java: extractJavaImports,
	c: extractCIncludes,
	cpp: extractCIncludes,
};

// ── Structural symbol extraction (#220) ──────────────────────────────────────

/**
 * Per-language node types that declare a structural symbol.
 * `kind` is a normalized label; node.type is preserved in the response for
 * callers that want the raw tree-sitter category.
 */
const SYMBOL_NODE_KINDS: Record<string, Record<string, string>> = {
	javascript: {
		function_declaration: "function",
		generator_function_declaration: "function",
		class_declaration: "class",
		method_definition: "method",
	},
	typescript: {
		function_declaration: "function",
		generator_function_declaration: "function",
		class_declaration: "class",
		abstract_class_declaration: "class",
		interface_declaration: "interface",
		type_alias_declaration: "type",
		enum_declaration: "enum",
		method_definition: "method",
		method_signature: "method",
		abstract_method_signature: "method",
	},
	tsx: {
		function_declaration: "function",
		class_declaration: "class",
		interface_declaration: "interface",
		type_alias_declaration: "type",
		enum_declaration: "enum",
		method_definition: "method",
	},
	python: {
		function_definition: "function",
		class_definition: "class",
	},
	go: {
		function_declaration: "function",
		method_declaration: "method",
		type_declaration: "type",
	},
	rust: {
		function_item: "function",
		struct_item: "struct",
		enum_item: "enum",
		trait_item: "trait",
		impl_item: "impl",
		mod_item: "module",
	},
	ruby: {
		method: "method",
		singleton_method: "method",
		class: "class",
		module: "module",
	},
	java: {
		class_declaration: "class",
		interface_declaration: "interface",
		enum_declaration: "enum",
		method_declaration: "method",
		constructor_declaration: "method",
	},
	c: {
		function_definition: "function",
		struct_specifier: "struct",
	},
	cpp: {
		function_definition: "function",
		class_specifier: "class",
		struct_specifier: "struct",
	},
};

/** Extract symbol name from an AST node, with language-specific fallbacks. */
function getSymbolName(node: TreeNode): string {
	// Most languages use a "name" field
	const nameField = node.childForFieldName("name");
	if (nameField) return nameField.text;
	// Rust impl blocks: no name field, use type text
	if (node.type === "impl_item") {
		const typeField = node.childForFieldName("type");
		if (typeField) return `impl ${typeField.text}`;
	}
	// Ruby singleton_method / regular method
	if (node.type === "method" || node.type === "singleton_method") {
		for (const child of node.namedChildren) {
			if (child.type === "identifier" || child.type === "constant") return child.text;
		}
	}
	// Go type_declaration wraps one or more type_spec nodes; pull the first name.
	if (node.type === "type_declaration") {
		for (const child of node.namedChildren) {
			if (child.type === "type_spec" || child.type === "type_alias") {
				const nameChild = child.childForFieldName("name");
				if (nameChild) return nameChild.text;
			}
		}
	}
	return "(anonymous)";
}

/**
 * Post-process Python symbols to upgrade nested function_definitions to kind
 * "method" when their parent is a class. Python uses the same node type for
 * top-level functions and class methods; consumers that key off `kind`
 * otherwise can't tell them apart.
 */
function normalizePythonSymbols(symbols: ParsedSymbol[]): void {
	for (const sym of symbols) {
		if (sym.kind !== "function" || sym.nodeType !== "function_definition") continue;
		if (sym.parentIndex < 0) continue;
		const parent = symbols[sym.parentIndex];
		if (parent?.kind === "class") sym.kind = "method";
	}
}

/**
 * Walk the tree once, emitting symbols for nodes whose type is in the
 * language's SYMBOL_NODE_KINDS map. parentIndex chains direct enclosure
 * so a class's methods are discoverable without re-walking.
 */
function extractSymbols(tree: Tree, language: string): ParsedSymbol[] {
	const kindMap = SYMBOL_NODE_KINDS[language];
	if (!kindMap) return [];

	const symbols: ParsedSymbol[] = [];

	function walk(node: TreeNode, parentIndex: number): void {
		const kind = kindMap[node.type];
		let nextParent = parentIndex;
		if (kind) {
			symbols.push({
				name: getSymbolName(node),
				kind,
				nodeType: node.type,
				byteStart: node.startIndex,
				byteEnd: node.endIndex,
				lineStart: node.startPosition.row + 1,
				lineEnd: node.endPosition.row + 1,
				parentIndex,
			});
			nextParent = symbols.length - 1;
		}
		for (const child of node.children) walk(child, nextParent);
	}

	walk(tree.rootNode, -1);
	if (language === "python") normalizePythonSymbols(symbols);
	return symbols;
}

// ── Parse and extract ────────────────────────────────────────────────────────

function parseAndExtract(langName: string, content: string): ParseResponse {
	const lang = languages.get(langName);
	if (!lang) throw new Error(`Unsupported language: ${langName}`);

	const parser = new Parser();
	parser.setLanguage(lang);
	const tree: Tree = parser.parse(content);

	const extractor = EXTRACTORS[langName];
	const edges = extractor ? extractor(tree) : [];
	const symbols = extractSymbols(tree, langName);

	// Count AST nodes
	let nodeCount = 0;
	function countNodes(node: TreeNode): void {
		nodeCount++;
		for (const child of node.children) countNodes(child);
	}
	countNodes(tree.rootNode);

	return { edges, symbols, language: langName, nodeCount };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

class PayloadTooLargeError extends Error {
	constructor(limit: number) {
		super(`Request body exceeds ${limit} bytes`);
		this.name = "PayloadTooLargeError";
	}
}

/**
 * Stream request body with a hard byte limit.
 * Destroys the socket immediately on overflow to avoid buffering.
 */
function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				req.destroy();
				reject(new PayloadTooLargeError(maxBytes));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function handleParse(req: IncomingMessage, res: ServerResponse): Promise<void> {
	let body: string;
	try {
		body = await readBody(req);
	} catch (err) {
		if (err instanceof PayloadTooLargeError) {
			json(res, 413, { error: err.message });
			return;
		}
		throw err;
	}

	let parsed: ParseRequest;
	try {
		parsed = JSON.parse(body) as ParseRequest;
	} catch {
		json(res, 400, { error: "Invalid JSON body" });
		return;
	}

	if (!parsed.language || typeof parsed.content !== "string") {
		json(res, 400, { error: "Missing required fields: language, content" });
		return;
	}

	const langName = LANGUAGE_ALIASES[parsed.language.toLowerCase()];
	if (!langName) {
		json(res, 400, { error: `Unknown language alias: ${parsed.language}`, supported: [...languages.keys()] });
		return;
	}

	if (!languages.has(langName)) {
		json(res, 400, { error: `Language grammar not loaded: ${langName}`, supported: [...languages.keys()] });
		return;
	}

	try {
		const response = parseAndExtract(langName, parsed.content);
		json(res, 200, response);
	} catch (e) {
		json(res, 500, { error: `Parse failed: ${(e as Error).message}` });
	}
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
	json(res, 200, {
		status: "ok",
		languages: [...languages.keys()],
	});
}

// ── Server ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	await loadGrammars();

	const server = createServer(async (req, res) => {
		try {
			if (req.method === "POST" && req.url === "/parse") {
				await handleParse(req, res);
			} else if (req.method === "GET" && req.url === "/health") {
				handleHealth(req, res);
			} else {
				json(res, 404, { error: "Not found" });
			}
		} catch (e) {
			console.error("[tree-sitter-parser] Unhandled error:", e);
			json(res, 500, { error: "Internal server error" });
		}
	});

	server.listen(PORT, () => {
		console.log(`[tree-sitter-parser] Listening on :${PORT}`);
		console.log(`[tree-sitter-parser] Languages: ${[...languages.keys()].join(", ") || "(none)"}`);
	});
}

main().catch((e) => {
	console.error("[tree-sitter-parser] Fatal:", e);
	process.exit(1);
});

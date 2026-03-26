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

interface ParseResponse {
	edges: ParsedEdge[];
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
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.split("\n")[0]!.trim() });
				}
			}
		} else if (node.type === "export_statement") {
			const source = node.childForFieldName("source");
			if (source) {
				const targetId = stripQuotes(source.text);
				if (targetId && !seen.has(targetId)) {
					seen.add(targetId);
					edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.split("\n")[0]!.trim() });
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
							edges.push({ type: "imports", targetId, targetType: "module", confidence: 1.0, evidence: node.text.split("\n")[0]!.trim() });
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

// ── Parse and extract ────────────────────────────────────────────────────────

function parseAndExtract(langName: string, content: string): ParseResponse {
	const lang = languages.get(langName);
	if (!lang) throw new Error(`Unsupported language: ${langName}`);

	const parser = new Parser();
	parser.setLanguage(lang);
	const tree: Tree = parser.parse(content);

	const extractor = EXTRACTORS[langName];
	const edges = extractor ? extractor(tree) : [];

	// Count AST nodes
	let nodeCount = 0;
	function countNodes(node: TreeNode): void {
		nodeCount++;
		for (const child of node.children) countNodes(child);
	}
	countNodes(tree.rootNode);

	return { edges, language: langName, nodeCount };
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

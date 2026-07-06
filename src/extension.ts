import * as path from 'path';
import { format } from "sql-formatter";
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );

    // Status Bar Display: Icon + Short Text
    statusBar.text = "$(replace) SQL Fill";

    // Tooltip: Display full functional name on hover
    statusBar.tooltip = "SQLAlchemy Log to Runnable SQL Preview";

    statusBar.command = "extension.openSqlPreview";
    statusBar.show();

    context.subscriptions.push(statusBar);
    context.subscriptions.push(vscode.commands.registerCommand("extension.openSqlPreview", () => {
        openSqlPreviewPanel(context);
    }));
}

function openSqlPreviewPanel(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "sqlPreview",
        "SQL Parameter Preview",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            // Restrict the webview to only loading resources from our extension's 'resources' directory
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'resources'))]
        }
    );

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === "process") {
            try {
                const result = processSqlLog(message.text);
                panel.webview.postMessage({ type: "result", text: result });
            } catch (err: any) {
                panel.webview.postMessage({ type: "result", text: `-- Error: ${err.message}` });
            }
        }
        if (message.type === "copy") {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage("SQL copied to clipboard");
        }
    }, undefined, context.subscriptions);
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // Convert local file paths to URIs that the webview can understand
    const scriptHighlight = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'highlight.min.js'));
    const scriptSql = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'sql.min.js'));
    const styleVs2015 = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'vs2015.min.css'));

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
    <link rel="stylesheet" href="${styleVs2015}">
    <script src="${scriptHighlight}"></script>
    <script src="${scriptSql}"></script>
    <style>
        body, html { height: 100%; margin: 0; padding: 0; overflow: hidden; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        .main-container { display: flex; flex-direction: column; height: 100vh; padding: 10px; box-sizing: border-box; }
        .editor-container { display: flex; flex: 1; gap: 10px; min-height: 0; }
        textarea, .output-wrapper { flex: 1; height: 100%; margin: 0; box-sizing: border-box; font-family: var(--vscode-editor-font-family), monospace; font-size: var(--vscode-editor-font-size, 13px); border: 1px solid var(--vscode-widget-border); }
        textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px; resize: none; outline: none; }
        .output-wrapper { background: #1e1e1e; overflow: auto; }
        pre { margin: 0; padding: 0; background: transparent !important; }
        code { display: block; padding: 8px; font-family: var(--vscode-editor-font-family), monospace !important; white-space: pre; background: transparent !important; }
        .footer { height: 40px; display: flex; align-items: center; gap: 10px; margin-top: 8px; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
<div class="main-container">
    <div class="editor-container">
        <textarea id="input" placeholder="Paste SQLAlchemy logs here (supports 3 formats)..."></textarea>
        <div class="output-wrapper">
            <pre><code id="output" class="language-sql">-- SQL Result Preview</code></pre>
        </div>
    </div>
    <div class="footer">
        <button onclick="process()">Format & Replace</button>
        <button onclick="copy()">Copy Result</button>
    </div>
</div>
<script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById("input");
    const output = document.getElementById("output");

    // Auto-process as the user types
    input.addEventListener("input", () => {
        vscode.postMessage({ type: "process", text: input.value });
    });

    function process() { vscode.postMessage({ type: "process", text: input.value }); }
    function copy() { vscode.postMessage({ type: "copy", text: output.innerText }); }

    window.addEventListener("message", event => {
        if (event.data.type === "result") {
            output.textContent = event.data.text;
            if (typeof hljs !== 'undefined') {
                // Remove existing highlight state to force re-rendering
                output.removeAttribute('data-highlighted');
                hljs.highlightElement(output);
            }
        }
    });
</script>
</body>
</html>`;
}

/**
 * Convert a Python `datetime.datetime/date/time(...)` literal into a SQL
 * datetime string. Returns the value without surrounding quotes; the caller
 * treats it as a string and quotes it during replacement.
 */
function formatPythonDatetime(literal: string): string {
    const m = literal.match(/^datetime\.(datetime|date|time)\(([^)]*)\)$/);
    if (!m) return literal;

    const kind = m[1];
    const nums = m[2].split(',').map((s) => parseInt(s.trim(), 10));
    const pad = (n: number | undefined, len = 2) => String(n ?? 0).padStart(len, '0');

    if (kind === 'date') {
        const [y, mo, d] = nums;
        return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
    }
    if (kind === 'time') {
        const [h, mi, s, us] = nums;
        return `${pad(h)}:${pad(mi)}:${pad(s)}${us ? `.${pad(us, 6)}` : ''}`;
    }
    // datetime
    const [y, mo, d, h, mi, s, us] = nums;
    return `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}${us ? `.${pad(us, 6)}` : ''}`;
}

export function processSqlLog(input: string): string {
    if (!input.trim()) return "-- Waiting for input...";

    // --- 1. Extract Parameters ---
    // Look for the content contained within the last {} block
    const paramBlockMatch = input.match(/\{[\s\S]*?\}/);
    if (!paramBlockMatch) throw new Error("Could not find parameters {} block.");

    const paramStr = paramBlockMatch[0];
    const params: Record<string, any> = {};

    /**
     * Use regex to parse Python Dict key-value pairs
     * Supports: 'key': 'value', 'key': "value", 'key': None, 'key': 123
     * Specifically handles cases like "O'Brien" where internal quotes exist.
     */
    const pairRegex = /['"](.+?)['"]\s*:\s*(datetime\.\w+\([^)]*\)|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|None|True|False|[\d\.]+)/g;
    let match;
    while ((match = pairRegex.exec(paramStr)) !== null) {
        const k = match[1];
        let v: any = match[2];

        if (v === 'None') v = null;
        else if (v === 'True') v = true;
        else if (v === 'False') v = false;
        else if (v.startsWith('datetime.')) v = formatPythonDatetime(v);
        else if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
            // Remove surrounding quotes and handle escape characters (e.g., \' -> ')
            v = v.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
        } else {
            v = Number(v);
        }
        params[k] = v;
    }

    // --- 2. Extract SQL Statement ---
    let sql = "";

    if (input.includes("[SQL:")) {
        // Handle Type 1: [SQL: select ... ]
        const match = input.match(/\[SQL:\s*([\s\S]*?)\](?:\s*\[parameters:|$)/i);
        if (match) sql = match[1];
    } else if (/statement:/i.test(input) && /parameters:/i.test(input)) {
        // Handle Type 2: statement: ... parameters: ...
        const match = input.match(/statement:([\s\S]*?)parameters:/i);
        if (match) sql = match[1];
    }

    // Fallback: If no specific structure is matched, try capturing the block starting with a SQL keyword
    if (!sql.trim()) {
        const generalMatch = input.match(/(SELECT|INSERT|UPDATE|DELETE|WITH)\b[\s\S]+?(?=\d{4}-\d{2}-\d{2}|\[generated|{|$|\[parameters:)/i);
        if (generalMatch) {
            sql = generalMatch[0].split(/\d{4}-\d{2}-\d{2}/)[0];
        }
    }

    if (!sql.trim()) throw new Error("Could not identify SQL statement content.");

    // --- 3. Parameter Replacement (with SQL Escaping) ---
    // Sort keys by length (longest first) to prevent shorter keys from partially replacing longer ones
    const sortedKeys = Object.keys(params).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
        const value = params[key];
        const pattern = new RegExp(`%\\(${key}\\)s`, "g");
        let safeValue: string;

        if (typeof value === 'string') {
            // Escape single quotes by doubling them (standard SQL string escaping)
            safeValue = `'${value.replace(/'/g, "''")}'`;
        } else if (value === null) {
            safeValue = "NULL";
        } else {
            safeValue = String(value);
        }
        sql = sql.replace(pattern, safeValue);
    }

    // Cleanup potential trailing brackets if the SQL was extracted from a [SQL: ...] block
    sql = sql.trim();
    if (!sql.endsWith(";")) sql += ";";

    // --- 4. Formatting ---
    try {
        return format(sql, {
            language: "mysql", // MySQL format handles complex subqueries and grouping well
            keywordCase: "upper",
            linesBetweenQueries: 2
        });
    } catch {
        return sql;
    }
}

export function deactivate() { }
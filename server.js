import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ADMIN_PAGE_SIZE = 100;
const PROGRAMMES = new Set([
    "Certificate in Nursing",
    "Certificate in Midwifery",
    "Diploma in Midwifery Extension",
    "Diploma in Nursing Extension",
]);
const ENQUIRY_TOPICS = new Set([
    "Admissions",
    "Programmes and fees",
    "Campus visit",
    "Other",
]);
const MIME_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".js", "text/javascript; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
]);

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function sendJson(response, status, body) {
    response.writeHead(status, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}

async function readJson(request) {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
        throw new HttpError(415, "This form submission must use JSON.");
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw new HttpError(413, "The form submission is too large.");
        }
        chunks.push(chunk);
    }

    try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error("Expected an object");
        }
        return body;
    } catch {
        throw new HttpError(400, "The form submission could not be read.");
    }
}

function textField(body, field, { required = true, maxLength = 1000, minLength = 1 } = {}) {
    const value = body[field];
    if (value === undefined && !required) {
        return "";
    }
    if (typeof value !== "string") {
        throw new HttpError(400, `Please provide a valid ${field.replaceAll("_", " ")}.`);
    }

    const trimmed = value.trim();
    if ((!trimmed && required) || (trimmed && trimmed.length < minLength) || trimmed.length > maxLength) {
        throw new HttpError(
            400,
            `${field.replaceAll("_", " ")} must be between ${minLength} and ${maxLength} characters.`,
        );
    }
    return trimmed;
}

function validateConsent(body) {
    if (body.consent !== true) {
        throw new HttpError(400, "Please agree to the privacy notice before submitting.");
    }
    if (typeof body.website === "string" && body.website.trim()) {
        throw new HttpError(400, "The form could not be accepted. Please try again.");
    }
}

function matchesSecret(provided, expected) {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    return providedBuffer.length === expectedBuffer.length
        && timingSafeEqual(providedBuffer, expectedBuffer);
}

function sendStaticFile(request, response, pathname) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        sendJson(response, 400, { error: "The requested path is invalid." });
        return;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const filePath = path.resolve(ROOT, relativePath);
    const relative = path.relative(ROOT, filePath);
    const segments = relative.split(path.sep);
    const blockedFiles = new Set(["server.js", "server.test.js", "package.json", "package-lock.json"]);

    if (
        relative.startsWith("..")
        || path.isAbsolute(relative)
        || segments.some((segment) => segment.startsWith(".") || segment === "data")
        || blockedFiles.has(path.basename(filePath))
    ) {
        sendJson(response, 404, { error: "The requested page was not found." });
        return;
    }

    fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
            sendJson(response, 404, { error: "The requested page was not found." });
            return;
        }

        const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase());
        if (!contentType) {
            sendJson(response, 404, { error: "The requested page was not found." });
            return;
        }

        response.writeHead(200, {
            "Cache-Control": "no-cache",
            "Content-Length": stats.size,
            "Content-Type": contentType,
        });
        if (request.method === "HEAD") {
            response.end();
            return;
        }

        const stream = fs.createReadStream(filePath);
        stream.on("error", (streamError) => {
            console.error("Could not read a website file:", streamError);
            response.destroy(streamError);
        });
        stream.pipe(response);
    });
}

export function createAppServer({
    adminPassword = process.env.ADMIN_PASSWORD || "",
    dbPath = process.env.DB_PATH || path.join(ROOT, "data", "submissions.sqlite"),
} = {}) {
    if (adminPassword.length < 16) {
        throw new Error("Set ADMIN_PASSWORD to a secret of at least 16 characters before starting the server.");
    }

    const resolvedDbPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
    if (resolvedDbPath !== ":memory:") {
        fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    }

    const database = new DatabaseSync(resolvedDbPath);
    database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS enquiries (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            contact TEXT NOT NULL,
            topic TEXT NOT NULL,
            message TEXT NOT NULL,
            submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL,
            contact TEXT NOT NULL,
            programme TEXT NOT NULL,
            qualification TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
    `);

    const insertEnquiry = database.prepare(
        "INSERT INTO enquiries (name, contact, topic, message) VALUES (?, ?, ?, ?)",
    );
    const insertApplication = database.prepare(
        "INSERT INTO applications (full_name, contact, programme, qualification, message) VALUES (?, ?, ?, ?, ?)",
    );
    const countSubmissions = database.prepare(
        "SELECT COUNT(*) AS total FROM (SELECT id FROM enquiries UNION ALL SELECT id FROM applications)",
    );
    const listSubmissions = database.prepare(`
        SELECT 'enquiry' AS type, id, name, contact, topic, NULL AS programme,
            NULL AS qualification, message, submitted_at
        FROM enquiries
        UNION ALL
        SELECT 'application' AS type, id, full_name AS name, contact, NULL AS topic,
            programme, qualification, message, submitted_at
        FROM applications
        ORDER BY submitted_at DESC
        LIMIT ? OFFSET ?
    `);

    const server = http.createServer((request, response) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
        );

        let url;
        try {
            url = new URL(request.url, "http://localhost");
        } catch {
            sendJson(response, 400, { error: "The request URL is invalid." });
            return;
        }

        const route = async () => {
            if (url.pathname === "/api/enquiries") {
                if (request.method !== "POST") {
                    sendJson(response, 405, { error: "Use POST to submit an enquiry." });
                    return;
                }
                const body = await readJson(request);
                validateConsent(body);
                const name = textField(body, "name", { maxLength: 100, minLength: 2 });
                const contact = textField(body, "contact", { maxLength: 200, minLength: 5 });
                const topic = textField(body, "topic", { maxLength: 80 });
                const message = textField(body, "message", { maxLength: 4000, minLength: 2 });
                if (!ENQUIRY_TOPICS.has(topic)) {
                    throw new HttpError(400, "Please choose a valid enquiry topic.");
                }
                const result = insertEnquiry.run(name, contact, topic, message);
                sendJson(response, 201, { ok: true, id: Number(result.lastInsertRowid) });
                return;
            }

            if (url.pathname === "/api/applications") {
                if (request.method !== "POST") {
                    sendJson(response, 405, { error: "Use POST to submit an application request." });
                    return;
                }
                const body = await readJson(request);
                validateConsent(body);
                const fullName = textField(body, "full_name", { maxLength: 100, minLength: 2 });
                const contact = textField(body, "contact", { maxLength: 200, minLength: 5 });
                const programme = textField(body, "programme", { maxLength: 100 });
                const qualification = textField(body, "qualification", { maxLength: 2000, minLength: 2 });
                const message = textField(body, "message", { required: false, maxLength: 2000 });
                if (!PROGRAMMES.has(programme)) {
                    throw new HttpError(400, "Please choose a valid programme.");
                }
                const result = insertApplication.run(fullName, contact, programme, qualification, message);
                sendJson(response, 201, { ok: true, id: Number(result.lastInsertRowid) });
                return;
            }

            if (url.pathname === "/api/admin/submissions") {
                if (request.method !== "GET") {
                    sendJson(response, 405, { error: "Use GET to view submissions." });
                    return;
                }
                const authorization = request.headers.authorization || "";
                const providedPassword = authorization.startsWith("Bearer ")
                    ? authorization.slice("Bearer ".length)
                    : "";
                if (!matchesSecret(providedPassword, adminPassword)) {
                    sendJson(response, 401, { error: "The administrator password is incorrect." });
                    return;
                }
                const rawOffset = url.searchParams.get("offset") || "0";
                const offset = Number.parseInt(rawOffset, 10);
                if (!Number.isSafeInteger(offset) || offset < 0) {
                    sendJson(response, 400, { error: "The page offset is invalid." });
                    return;
                }
                const total = Number(countSubmissions.get().total);
                const submissions = listSubmissions.all(MAX_ADMIN_PAGE_SIZE, offset);
                sendJson(response, 200, { submissions, total, limit: MAX_ADMIN_PAGE_SIZE });
                return;
            }

            const deleteMatch = url.pathname.match(/^\/api\/admin\/submissions\/(enquiries|applications)\/(\d+)$/);
            if (deleteMatch) {
                if (request.method !== "DELETE") {
                    sendJson(response, 405, { error: "Use DELETE to remove a submission." });
                    return;
                }
                const authorization = request.headers.authorization || "";
                const providedPassword = authorization.startsWith("Bearer ")
                    ? authorization.slice("Bearer ".length)
                    : "";
                if (!matchesSecret(providedPassword, adminPassword)) {
                    sendJson(response, 401, { error: "The administrator password is incorrect." });
                    return;
                }
                const id = Number(deleteMatch[2]);
                if (!Number.isSafeInteger(id) || id < 1) {
                    sendJson(response, 400, { error: "The submission ID is invalid." });
                    return;
                }
                const table = deleteMatch[1];
                const result = database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
                if (Number(result.changes) === 0) {
                    sendJson(response, 404, { error: "That submission was not found." });
                    return;
                }
                sendJson(response, 200, { ok: true });
                return;
            }

            if (url.pathname.startsWith("/api/")) {
                sendJson(response, 404, { error: "The requested API route was not found." });
                return;
            }

            if (request.method !== "GET" && request.method !== "HEAD") {
                sendJson(response, 405, { error: "This website only accepts GET and HEAD for pages." });
                return;
            }
            sendStaticFile(request, response, url.pathname);
        };

        route().catch((error) => {
            if (error instanceof HttpError) {
                sendJson(response, error.status, { error: error.message });
                return;
            }
            console.error("Website request failed:", error);
            sendJson(response, 500, { error: "The request could not be completed. Please try again later." });
        });
    });

    server.on("close", () => database.close());
    return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = createAppServer();
    const host = process.env.HOST || "127.0.0.1";
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("PORT must be a valid TCP port.");
    }
    server.listen(port, host, () => {
        const address = server.address();
        console.log(`Tumi Medical Institute website is running at http://${host}:${address.port}`);
    });
}

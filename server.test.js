import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAppServer } from "./server.js";

const ADMIN_PASSWORD = "test-admin-password-2026";
let server;
let baseUrl;

before(async () => {
    server = createAppServer({ adminPassword: ADMIN_PASSWORD, dbPath: ":memory:" });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

async function postJson(path, body) {
    return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

test("stores enquiries and applications for an authenticated administrator", async () => {
    const enquiryResponse = await postJson("/api/enquiries", {
        name: "Sample Visitor",
        contact: "0700000000",
        topic: "Admissions",
        message: "Please share application information.",
        consent: true,
        website: "",
    });
    assert.equal(enquiryResponse.status, 201);

    const applicationResponse = await postJson("/api/applications", {
        full_name: "Sample Applicant",
        contact: "sample@example.com",
        programme: "Certificate in Nursing",
        qualification: "Completed secondary school.",
        message: "",
        consent: true,
        website: "",
    });
    assert.equal(applicationResponse.status, 201);

    const unauthorizedResponse = await fetch(`${baseUrl}/api/admin/submissions`);
    assert.equal(unauthorizedResponse.status, 401);

    const adminResponse = await fetch(`${baseUrl}/api/admin/submissions`, {
        headers: { Authorization: `Bearer ${ADMIN_PASSWORD}` },
    });
    assert.equal(adminResponse.status, 200);
    const result = await adminResponse.json();
    assert.equal(result.total, 2);
    assert.deepEqual(new Set(result.submissions.map((item) => item.type)), new Set(["enquiry", "application"]));
});

test("rejects invalid programme choices and missing consent", async () => {
    const invalidProgramme = await postJson("/api/applications", {
        full_name: "Sample Applicant",
        contact: "0700000000",
        programme: "Unlisted programme",
        qualification: "Completed secondary school.",
        consent: true,
    });
    assert.equal(invalidProgramme.status, 400);

    const missingConsent = await postJson("/api/enquiries", {
        name: "Sample Visitor",
        contact: "0700000000",
        topic: "Admissions",
        message: "Please call me.",
        consent: false,
    });
    assert.equal(missingConsent.status, 400);

    const adminResponse = await fetch(`${baseUrl}/api/admin/submissions`, {
        headers: { Authorization: `Bearer ${ADMIN_PASSWORD}` },
    });
    const result = await adminResponse.json();
    assert.equal(result.total, 2);
});

test("allows an administrator to delete a submission", async () => {
    const adminResponse = await fetch(`${baseUrl}/api/admin/submissions`, {
        headers: { Authorization: `Bearer ${ADMIN_PASSWORD}` },
    });
    const { submissions } = await adminResponse.json();
    const enquiry = submissions.find((item) => item.type === "enquiry");

    const deleteResponse = await fetch(`${baseUrl}/api/admin/submissions/enquiries/${enquiry.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ADMIN_PASSWORD}` },
    });
    assert.equal(deleteResponse.status, 200);

    const remainingResponse = await fetch(`${baseUrl}/api/admin/submissions`, {
        headers: { Authorization: `Bearer ${ADMIN_PASSWORD}` },
    });
    const remaining = await remainingResponse.json();
    assert.equal(remaining.total, 1);
});

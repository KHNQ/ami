import { describe, test, expect, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { GET, POST, PATCH, DELETE, signup, signupAdmin, signupStaff } from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import { config } from "../src/config.js";
import { FINANCE_ADMIN, USERS_ADMIN } from "../src/lib/permissions.js";

// A tiny but structurally valid PDF, so the mime allowlist is exercised
// against something real rather than an arbitrary blob.
const TINY_PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF").toString("base64")}`;

const base = () => ({
  field_of_work: "Technical",
  first_name: "Nasrin",
  last_name: "Rahimi",
  phone: "+989121234567",
});

afterAll(async () => {
  // Applications write real files; don't leave them behind.
  await rm(config.uploadDir, { recursive: true, force: true });
});

describe("careers -- public application form", () => {
  test("anyone can apply without an account", async () => {
    const res = await POST("/careers/applications", { ...base(), email: "nasrin@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    // Anonymous endpoint: echoing the row back would let anyone confirm what
    // somebody else submitted.
    expect(res.body.first_name).toBeUndefined();
    expect(res.body.phone).toBeUndefined();
  });

  test("required fields are enforced", async () => {
    expect((await POST("/careers/applications", { ...base(), first_name: "" })).status).toBe(400);
    expect((await POST("/careers/applications", { ...base(), phone: "" })).status).toBe(400);

    const badField = await POST("/careers/applications", { ...base(), field_of_work: "Astronaut" });
    expect(badField.status).toBe(400);
    expect(badField.body.error.code).toBe("invalid_field_of_work");
  });

  test("the form's options come from the server, not a hardcoded copy", async () => {
    const res = await GET("/careers/fields");
    expect(res.status).toBe(200);
    // If the frontend hardcoded this list it could drift from what validation
    // accepts, producing a form whose own options are rejected on submit.
    expect(res.body.fields_of_work).toContain("Technical");
    expect(res.body.fields_of_work).toContain("Warehousing");
  });

  test("a résumé is written to disk, not into the database", async () => {
    const res = await POST("/careers/applications", { ...base(), resume_data_url: TINY_PDF });
    expect(res.status).toBe(201);

    const row = db.applications.resumePath(res.body.id);
    expect(row.resume_path).toBeTruthy();
    expect(existsSync(row.resume_path)).toBe(true);

    // The table itself must not carry the bytes -- that is what would bloat
    // every VACUUM INTO backup.
    const columns = db._raw.query("PRAGMA table_info(job_applications)").all().map((c) => c.name);
    expect(columns).not.toContain("resume_bytes_blob");
    expect(columns).toContain("resume_path");
  });

  test("the stored filename is generated, never taken from the client", async () => {
    const res = await POST("/careers/applications", {
      ...base(),
      first_name: "../../etc",
      last_name: "passwd",
      resume_data_url: TINY_PDF,
    });
    expect(res.status).toBe(201);
    const { resume_filename: name, resume_path: full } = db.applications.resumePath(res.body.id);
    // Path traversal is the classic attack on a client-supplied filename.
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
    expect(full).toContain("resumes");
    expect(name.endsWith(".pdf")).toBe(true);
  });

  test("wrong-typed and oversized résumés are refused", async () => {
    const evil = await POST("/careers/applications", {
      ...base(),
      resume_data_url: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    });
    expect(evil.status).toBe(400);
    expect(evil.body.error.code).toBe("invalid_resume_type");

    const huge = `data:application/pdf;base64,${"A".repeat(7 * 1024 * 1024)}`;
    const tooBig = await POST("/careers/applications", { ...base(), resume_data_url: huge });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe("resume_too_large");
  });
});

describe("careers -- the staff inbox", () => {
  test("applications and résumés are staff-only", async () => {
    const root = await signupAdmin("careersroot");
    const finance = await signupStaff(FINANCE_ADMIN, "careersfinance");
    const people = await signupStaff(USERS_ADMIN, "careerspeople");
    const user = await signup("careersuser");

    const created = await POST("/careers/applications", { ...base(), resume_data_url: TINY_PDF });
    const id = created.body.id;

    // A CV is personal data.
    expect((await GET("/careers/applications")).status).toBe(401);
    expect((await GET("/careers/applications", { token: user.token })).status).toBe(403);
    expect((await GET("/careers/applications", { token: finance.token })).status).toBe(403);
    expect((await GET("/careers/applications", { token: people.token })).status).toBe(200);
    expect((await GET("/careers/applications", { token: root.token })).status).toBe(200);

    expect((await GET(`/careers/applications/${id}/resume`, { token: user.token })).status).toBe(403);
    const download = await GET(`/careers/applications/${id}/resume`, { token: root.token });
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    // Served as a download rather than rendered inline.
    expect(download.headers.get("content-disposition")).toContain("attachment");
  });

  test("listings never carry the file path", async () => {
    const root = await signupAdmin("pathroot");
    await POST("/careers/applications", { ...base(), resume_data_url: TINY_PDF });
    const list = await GET("/careers/applications", { token: root.token });
    const row = list.body.applications[0];
    // An absolute server path in a JSON response is free reconnaissance.
    expect(row.resume_path).toBeUndefined();
    expect(row.has_resume).toBe(1);
    expect(row.resume_filename).toBeTruthy();
  });

  test("an application can be moved through its statuses", async () => {
    const root = await signupAdmin("statusroot");
    const created = await POST("/careers/applications", base());
    const id = created.body.id;

    const reviewing = await PATCH(`/careers/applications/${id}`, { status: "reviewing", admin_note: "good fit for service" }, { token: root.token });
    expect(reviewing.status).toBe(200);
    expect(reviewing.body.status).toBe("reviewing");
    expect(reviewing.body.handled_by).toBe(root.user.id);

    expect((await PATCH(`/careers/applications/${id}`, { status: "astronaut" }, { token: root.token })).status).toBe(400);
  });

  test("deleting an application removes the file too", async () => {
    const root = await signupAdmin("delroot");
    const created = await POST("/careers/applications", { ...base(), resume_data_url: TINY_PDF });
    const id = created.body.id;
    const { resume_path: filePath } = db.applications.resumePath(id);
    expect(existsSync(filePath)).toBe(true);

    const res = await DELETE(`/careers/applications/${id}`, {}, { token: root.token });
    expect(res.status).toBe(200);

    // A CV is personal data -- deleting the record must not leave the file
    // sitting on disk indefinitely.
    expect(existsSync(filePath)).toBe(false);
    expect(db.applications.get(id)).toBe(null);
  });

  test("a missing file reports honestly instead of throwing a 500", async () => {
    const root = await signupAdmin("missingroot");
    const created = await POST("/careers/applications", { ...base(), resume_data_url: TINY_PDF });
    const id = created.body.id;
    // Simulates a database restored without its matching disk volume.
    db._raw.query(`UPDATE job_applications SET resume_path = '/nowhere/gone.pdf' WHERE id = ?`).run(id);

    const res = await GET(`/careers/applications/${id}/resume`, { token: root.token });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("resume_missing");
  });
});

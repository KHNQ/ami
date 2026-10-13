import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { Errors } from "../lib/errors.js";
import { newId } from "../lib/id.js";

// Job applications from the careers page.
//
// Résumés go to disk, not into SQLite. A 5MB file per applicant would inflate
// the database and therefore every `VACUUM INTO` backup, for a file that is
// read once by a human and never queried.

const STATUSES = ["new", "reviewing", "interviewed", "rejected", "hired"];
const FIELDS_OF_WORK = ["Sales", "Technical", "Financial", "Accounting", "Warehousing", "Administrative staff", "Other"];
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_MIME = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

function clean(value, max = 200) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

async function storeResume(dataUrl, applicantLabel) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw Errors.badRequest("resume must be a base64 data URL", "invalid_resume");
  const [, mime, base64] = match;
  const ext = ALLOWED_RESUME_MIME[mime];
  if (!ext) {
    throw Errors.badRequest(`résumé must be a PDF or Word document (got ${mime})`, "invalid_resume_type");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_RESUME_BYTES) {
    throw Errors.badRequest("résumé must be under 5MB", "resume_too_large");
  }

  // Filename is generated, never taken from the client: an attacker-supplied
  // name is the classic path-traversal vector, and there is nothing here that
  // needs the original.
  const safeLabel = applicantLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
  const filename = `${Date.now()}-${safeLabel}-${newId("cv").slice(3, 11)}${ext}`;
  const dir = path.resolve(config.uploadDir, "resumes");
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, filename);
  await writeFile(full, bytes);

  return { resumePath: full, resumeFilename: filename, resumeBytes: bytes.length, mime };
}

export const careerService = {
  fieldsOfWork: FIELDS_OF_WORK,

  async apply(body, ip) {
    const firstName = clean(body.first_name, 80);
    const lastName = clean(body.last_name, 80);
    const phone = clean(body.phone, 40);
    const fieldOfWork = clean(body.field_of_work, 60);

    if (!firstName || !lastName) throw Errors.badRequest("first_name and last_name are required");
    if (!phone) throw Errors.badRequest("phone is required");
    if (!fieldOfWork || !FIELDS_OF_WORK.includes(fieldOfWork)) {
      throw Errors.badRequest(`field_of_work must be one of: ${FIELDS_OF_WORK.join(", ")}`, "invalid_field_of_work");
    }

    let resume = {};
    if (body.resume_data_url) {
      resume = await storeResume(body.resume_data_url, `${firstName}-${lastName}`);
    }

    const application = db.applications.create({
      fieldOfWork,
      firstName,
      lastName,
      phone,
      email: clean(body.email, 200)?.toLowerCase() ?? null,
      dateOfBirth: clean(body.date_of_birth, 20),
      gender: clean(body.gender, 30),
      educationLevel: clean(body.education_level, 60),
      fieldOfStudy: clean(body.field_of_study, 120),
      placeOfEducation: clean(body.place_of_education, 120),
      companyName: clean(body.company_name, 120),
      jobTitle: clean(body.job_title, 120),
      startDate: clean(body.start_date, 20),
      endDate: clean(body.end_date, 20),
      additionalInfo: clean(body.additional_info, 4000),
      ...resume,
      ip,
    });

    db.logs.record({
      action: "career.application_received",
      entityType: "job_application",
      entityId: application.id,
      meta: { fieldOfWork, hasResume: Boolean(resume.resumePath) },
      ip,
    });
    return application;
  },

  list(opts) {
    return db.applications.list(opts);
  },

  get(id) {
    const application = db.applications.get(id);
    if (!application) throw Errors.notFound("Application not found");
    return application;
  },

  /** The stored file. Admin-only -- a CV is personal data. */
  async resume(id) {
    this.get(id);
    const row = db.applications.resumePath(id);
    if (!row?.resume_path) throw Errors.notFound("This application has no résumé", "no_resume");
    try {
      const bytes = await readFile(row.resume_path);
      const ext = path.extname(row.resume_filename || "").toLowerCase();
      const mime =
        Object.entries(ALLOWED_RESUME_MIME).find(([, e]) => e === ext)?.[0] || "application/octet-stream";
      return { bytes, mime, filename: row.resume_filename };
    } catch {
      // The row survives even if the file is gone (a restored database with
      // no matching disk volume, say) -- report that honestly rather than
      // returning a 500.
      throw Errors.notFound("The résumé file is no longer on disk", "resume_missing");
    }
  },

  update(id, { status, admin_note: adminNote }, actorUserId) {
    this.get(id);
    if (status !== undefined && !STATUSES.includes(status)) {
      throw Errors.badRequest(`status must be one of: ${STATUSES.join(", ")}`);
    }
    const updated = db.applications.update(id, { status, adminNote, handledBy: actorUserId });
    db.logs.record({ actorUserId, action: "career.application_updated", entityType: "job_application", entityId: id, meta: { status } });
    return updated;
  },

  /** Removes the file as well as the row -- CVs are personal data. */
  async remove(id, actorUserId) {
    this.get(id);
    const row = db.applications.resumePath(id);
    if (row?.resume_path) await unlink(row.resume_path).catch(() => {});
    db._raw.query(`DELETE FROM job_applications WHERE id = ?`).run(id);
    db.logs.record({ actorUserId, action: "career.application_deleted", entityType: "job_application", entityId: id });
    return { deleted: true };
  },

  summary() {
    return db.applications.countByStatus();
  },
};

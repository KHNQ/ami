import { newId } from "../../../../lib/id.js";

// Résumé bytes are never in this table -- only a path. See the schema comment.
const FIELDS = `id, field_of_work, first_name, last_name, phone, email, date_of_birth,
                gender, education_level, field_of_study, place_of_education,
                company_name, job_title, start_date, end_date, additional_info,
                resume_filename, resume_bytes, (resume_path IS NOT NULL) AS has_resume,
                status, admin_note, handled_by, created_at, updated_at`;

export function makeApplicationsRepo(raw) {
  return {
    create(fields) {
      const id = newId("app");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO job_applications
             (id, field_of_work, first_name, last_name, phone, email, date_of_birth, gender,
              education_level, field_of_study, place_of_education, company_name, job_title,
              start_date, end_date, additional_info, resume_path, resume_filename, resume_bytes,
              status, ip, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
        )
        .run(
          id,
          fields.fieldOfWork,
          fields.firstName,
          fields.lastName,
          fields.phone,
          fields.email || null,
          fields.dateOfBirth || null,
          fields.gender || null,
          fields.educationLevel || null,
          fields.fieldOfStudy || null,
          fields.placeOfEducation || null,
          fields.companyName || null,
          fields.jobTitle || null,
          fields.startDate || null,
          fields.endDate || null,
          fields.additionalInfo || null,
          fields.resumePath || null,
          fields.resumeFilename || null,
          fields.resumeBytes || null,
          fields.ip || null,
          now,
          now
        );
      return this.get(id);
    },

    get(id) {
      return raw.query(`SELECT ${FIELDS} FROM job_applications WHERE id = ?`).get(id) || null;
    },

    /** The on-disk location. Separate call so listings never carry it. */
    resumePath(id) {
      const row = raw.query(`SELECT resume_path, resume_filename FROM job_applications WHERE id = ?`).get(id);
      return row || null;
    },

    list({ status, limit = 50, offset = 0 } = {}) {
      const clauses = [];
      const params = [];
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      return raw
        .query(`SELECT ${FIELDS} FROM job_applications ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(...params);
    },

    update(id, { status, adminNote, handledBy }) {
      const sets = ["updated_at = ?"];
      const params = [new Date().toISOString()];
      if (status !== undefined) {
        sets.push("status = ?");
        params.push(status);
      }
      if (adminNote !== undefined) {
        sets.push("admin_note = ?");
        params.push(adminNote);
      }
      if (handledBy !== undefined) {
        sets.push("handled_by = ?");
        params.push(handledBy);
      }
      params.push(id);
      raw.query(`UPDATE job_applications SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return this.get(id);
    },

    countByStatus() {
      return raw.query(`SELECT status, COUNT(*) AS n FROM job_applications GROUP BY status`).all();
    },
  };
}

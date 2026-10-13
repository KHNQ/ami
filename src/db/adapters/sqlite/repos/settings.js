// Runtime site configuration. Rows are *overrides* -- an absent key means
// "use the default coded in settingsService.js" -- so this repo deliberately
// has no notion of what a valid key is. That validation belongs one layer up,
// with the type definitions.
export function makeSiteSettingsRepo(raw) {
  return {
    // Returns { key: rawJsonString }. The service decodes, because it owns
    // the type definitions and has to decide what a malformed value means.
    all() {
      const rows = raw.query(`SELECT key, value_json FROM site_settings`).all();
      const out = {};
      for (const row of rows) out[row.key] = row.value_json;
      return out;
    },

    get(key) {
      const row = raw.query(`SELECT value_json FROM site_settings WHERE key = ?`).get(key);
      return row ? row.value_json : null;
    },

    // Upsert: an operator setting a key back to its default still writes a
    // row, which is intentional -- "explicitly set to true" and "never
    // touched" should be distinguishable in the audit trail.
    set(key, valueJson, updatedBy) {
      raw
        .query(
          `INSERT INTO site_settings (key, value_json, updated_at, updated_by)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`
        )
        .run(key, valueJson, new Date().toISOString(), updatedBy || null);
    },

    // Drops the override, reverting the key to its coded default.
    clear(key) {
      raw.query(`DELETE FROM site_settings WHERE key = ?`).run(key);
    },

    listWithMeta() {
      return raw.query(`SELECT * FROM site_settings ORDER BY key ASC`).all();
    },
  };
}

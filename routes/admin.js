// routes/admin.js
import express from 'express';
import { query } from '../db.js';

const router = express.Router();

router.post('/admin/migrate', async (req, res) => {
  try {

    // ─────────────────────────────────────────────
    // Create indexes (safe to run repeatedly)
    // ─────────────────────────────────────────────

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recalls_vehicle_year
      ON recalls(vehicle_key, year)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_tsbs_vehicle_year
      ON tsbs(vehicle_key, year)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_community_vehicle_year
      ON community_issues(vehicle_key, year)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_recalls_status
      ON recalls(status)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_tsbs_status
      ON tsbs(status)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_community_status
      ON community_issues(status)
    `);

    // ─────────────────────────────────────────────
    // Ensure status column exists
    // ─────────────────────────────────────────────

    await query(`
      ALTER TABLE recalls
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    `);

    await query(`
      ALTER TABLE tsbs
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    `);

    await query(`
      ALTER TABLE community_issues
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    `);

    // ─────────────────────────────────────────────
    // Remove duplicates before PK change
    // ─────────────────────────────────────────────

    await query(`
      DELETE FROM recalls r1
      USING recalls r2
      WHERE r1.ctid < r2.ctid
        AND r1.vehicle_key = r2.vehicle_key
        AND r1.year = r2.year
        AND r1.id = r2.id
    `);

    // ─────────────────────────────────────────────
    // Update PRIMARY KEY for recalls
    // Needed for VIN imports
    // ─────────────────────────────────────────────

    await query(`ALTER TABLE recalls DROP CONSTRAINT IF EXISTS recalls_pkey`);

    await query(`
      ALTER TABLE recalls
      ADD CONSTRAINT recalls_pkey
      PRIMARY KEY (vehicle_key, year, id)
    `);

    // ─────────────────────────────────────────────

    res.json({
      ok: true,
      message:
        "✓ DB migration complete — indexes ensured, status columns ensured, recalls PK updated to (vehicle_key, year, id)"
    });

  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({
      error: 'Migration failed',
      details: err.message
    });
  }
});

export default router;

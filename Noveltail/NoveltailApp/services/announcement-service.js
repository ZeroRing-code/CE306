const pool = require("../db");

async function deliverAnnouncement(client, announcement) {
    if (announcement.audience_type === "all") return;

    const filter = announcement.audience_filter || {};
    let audienceCondition = "";
    let audienceValues = [];

    if (announcement.audience_type === "individual") {
        audienceCondition = "WHERE u.user_id = ANY($2::bigint[])";
        audienceValues = [filter.userIds || []];
    } else if (announcement.audience_type === "group") {
        audienceCondition = "WHERE u.role = ANY($2::varchar[])";
        audienceValues = [filter.roles || []];
    } else {
        audienceCondition = "WHERE $2::boolean";
        audienceValues = [true];
    }

    await client.query(
        `WITH inserted_recipients AS (
             INSERT INTO announcement_recipients (announcement_id, user_id)
             SELECT $1, u.user_id
             FROM users u
             ${audienceCondition}
             ON CONFLICT (announcement_id, user_id) DO NOTHING
             RETURNING user_id
         )
         INSERT INTO notifications (
             user_id, type, category, message, metadata
         )
         SELECT user_id, 'system', 'system', $3,
                jsonb_build_object('announcementId', $1::text)
         FROM inserted_recipients`,
        [announcement.announcement_id, ...audienceValues,
             `New announcement: ${announcement.title}`]
    );
}

async function processDueAnnouncements() {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const due = await client.query(
            `SELECT announcement_id, title, audience_type, audience_filter
             FROM announcements
             WHERE status = 'draft'
               AND published_at IS NOT NULL
               AND published_at <= CURRENT_TIMESTAMP
               AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
             ORDER BY published_at, announcement_id
             LIMIT 50
             FOR UPDATE SKIP LOCKED`
        );

        for (const announcement of due.rows) {
            const published = await client.query(
                `UPDATE announcements
                 SET status = 'published', updated_at = CURRENT_TIMESTAMP
                 WHERE announcement_id = $1 AND status = 'draft'
                 RETURNING announcement_id`,
                [announcement.announcement_id]
            );
            if (published.rowCount) {
                await deliverAnnouncement(client, announcement);
            }
        }
        await client.query("COMMIT");
        return due.rowCount;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function startAnnouncementScheduler(intervalMs = 60_000) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const published = await processDueAnnouncements();
            if (published) {
                console.info(`Published ${published} scheduled announcement(s).`);
            }
        } catch (error) {
            console.error("Publish scheduled announcements:", error);
        } finally {
            running = false;
        }
    };

    void run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
}

module.exports = { deliverAnnouncement, processDueAnnouncements, startAnnouncementScheduler };

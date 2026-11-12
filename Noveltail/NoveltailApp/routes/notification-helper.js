async function createNotification(
    client,
    {
        userId,
        type,
        category,
        message,
        actorId = null,
        novelId = null,
        chapterId = null,
        commentId = null,
        metadata = {}
    }
) {
    if (!userId || !message) {
        return;
    }

    await client.query(
        `INSERT INTO notifications (
            user_id, actor_id, type, category, message,
            novel_id, chapter_id, comment_id, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
            userId,
            actorId,
            type,
            category,
            message,
            novelId,
            chapterId,
            commentId,
            JSON.stringify(metadata)
        ]
    );
}

async function createCommentNotifications(
    client,
    {
        userId,
        username,
        displayName,
        chapterId,
        commentId,
        parentCommentId,
        content
    }
) {
    const context = await client.query(
        `SELECT c.novel_id, n.user_id AS author_id, n.title AS novel_title
         FROM chapters c
         JOIN novels n ON n.novel_id = c.novel_id
         WHERE c.chapter_id = $1`,
        [chapterId]
    );
    if (!context.rowCount) {
        throw new Error("Cannot create notifications for a missing chapter");
    }
    const chapter = context.rows[0];
    const actorName = displayName || username;

    if (parentCommentId) {
        const parent = await client.query(
            `SELECT user_id FROM comments WHERE comment_id = $1`,
            [parentCommentId]
        );
        if (!parent.rowCount) {
            throw new Error("Cannot notify about a missing parent comment");
        }
        if (String(parent.rows[0].user_id) !== String(userId)) {
            await createNotification(client, {
                userId: parent.rows[0].user_id,
                actorId: userId,
                type: "comment_reply",
                category: "engagement",
                message: `${actorName} replied to your comment.`,
                commentId,
                metadata: { parentCommentId, novelId: chapter.novel_id }
            });
        }
    } else {
        const roots = await client.query(
            `SELECT COUNT(*)::int AS count
             FROM comments c
             JOIN chapters ch ON ch.chapter_id = c.chapter_id
             WHERE ch.novel_id = $1
               AND c.parent_comment_id IS NULL`,
            [chapter.novel_id]
        );
        if (
            roots.rows[0].count <= 5 &&
            String(chapter.author_id) !== String(userId)
        ) {
            await createNotification(client, {
                userId: chapter.author_id,
                actorId: userId,
                type: "first_comments",
                category: "engagement",
                message: `${actorName} posted root comment ${roots.rows[0].count}/5 on "${chapter.novel_title}".`,
                commentId,
                metadata: { novelId: chapter.novel_id, sequence: roots.rows[0].count }
            });
        }
    }

    const mentionedNames = [...new Set(
        [...content.matchAll(/@([a-zA-Z0-9_]{3,30})/g)]
            .map(match => match[1].toLowerCase())
    )];
    if (mentionedNames.length) {
        const mentioned = await client.query(
            `SELECT user_id, username
             FROM users
             WHERE LOWER(username) = ANY($1::text[])
               AND user_id <> $2`,
            [mentionedNames, userId]
        );
        for (const recipient of mentioned.rows) {
            await createNotification(client, {
                userId: recipient.user_id,
                actorId: userId,
                type: "mention",
                category: "engagement",
                message: `${actorName} mentioned you in a comment.`,
                commentId,
                metadata: { novelId: chapter.novel_id }
            });
        }
    }
}

module.exports = { createNotification, createCommentNotifications };

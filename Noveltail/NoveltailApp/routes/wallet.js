const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { createNotification } = require("./notification-helper");
const { requireAdmin } = require("../middleware/admin");
const { logAdminAction } = require("./admin-helper");
const { rateLimits } = require("../middleware/rate-limit");

const router = express.Router();
const PACKAGES = new Set([50, 100, 300, 500, 1000]);
const validId = value => /^\d+$/.test(String(value)) && Number(value) > 0;
const validRequestKey = value =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);

router.use(requireAuth);

async function getWallet(client, userId, lock = false) {
    await client.query(
        `INSERT INTO wallets (user_id)
         SELECT user_id FROM users WHERE user_id = $1
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
    const result = await client.query(
        `SELECT balance
         FROM wallets
         WHERE user_id = $1
         ${lock ? "FOR UPDATE" : ""}`,
        [userId]
    );
    return result.rows[0];
}

async function findRequest(client, userId, requestKey) {
    return client.query(
        `SELECT transaction_id, type, amount, status, reference_id,
                reversal_of_transaction_id, metadata, created_at
         FROM wallet_transactions
         WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, requestKey]
    );
}

async function recordFailure(userId, requestKey, type, referenceId, reason) {
    try {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
                `INSERT INTO wallet_transactions (
                    user_id, type, amount, status, idempotency_key,
                    reference_id, metadata
                 )
                 VALUES ($1, 'failed', 0, 'failed', $2, $3, $4::jsonb)
                 ON CONFLICT (user_id, idempotency_key)
                     WHERE idempotency_key IS NOT NULL AND user_id IS NOT NULL
                 DO NOTHING
                 RETURNING transaction_id`,
                [
                    userId,
                    requestKey,
                    referenceId,
                    JSON.stringify({ attemptedType: type, reason })
                ]
            );
            if (result.rowCount) {
                await createNotification(client, {
                    userId,
                    type: "transaction",
                    category: "transaction",
                    message: "Coin wallet operation failed.",
                    metadata: { transactionId: result.rows[0].transaction_id, status: "failed" }
                });
            }
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Record failed wallet transaction:", error);
    }
}

function safeReason(value) {
    return typeof value === "string" ? value.trim().slice(0, 500) || null : null;
}

async function replayReversal(client, userId, requestKey, type, originalId, res) {
    const existing = await findRequest(client, userId, requestKey);
    if (!existing.rowCount) return null;
    await client.query("COMMIT");
    const item = existing.rows[0];
    if (
        item.type !== type ||
        item.status !== (type === "refund" ? "refunded" : "cancelled") ||
        String(item.reversal_of_transaction_id) !== String(originalId)
    ) {
        return res.status(409).json({
            message: "This request ID has already been used for another transaction."
        });
    }
    const balance = await pool.query(
        "SELECT balance FROM wallets WHERE user_id = $1",
        [userId]
    );
    return res.json({
        message: type === "refund" ? "Refund successful." : "Transaction cancelled.",
        balance: balance.rows[0]?.balance ?? "0",
        transaction_id: item.transaction_id,
        replayed: true
    });
}

async function lockWallets(client, userIds) {
    const ids = [...new Set(userIds.map(String))]
        .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
    const result = await client.query(
        `SELECT user_id, balance
         FROM wallets
         WHERE user_id = ANY($1::bigint[])
         ORDER BY user_id
         FOR UPDATE`,
        [ids]
    );
    if (result.rowCount !== ids.length) {
        throw new Error("No coin wallet was found for this transaction.");
    }
    return result.rows;
}

async function lockTransactionForReversal(client, transactionId) {
    // Keep reversal requests serialized without UPDATE privilege on the append-only ledger.
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`noveltail:wallet-reversal:${transactionId}`]
    );
}

router.post("/admin/refunds", requireAdmin, rateLimits.wallet, async (req, res) => {
    const transactionId = req.body?.transaction_id;
    const requestKey = req.get("Idempotency-Key") || req.body?.request_key;
    const reason = safeReason(req.body?.reason);
    if (!validId(transactionId) || !validRequestKey(requestKey)) {
        return res.status(400).json({ message: "Invalid refund details." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await lockTransactionForReversal(client, transactionId);
        const originalResult = await client.query(
            `SELECT transaction_id, user_id, type, amount, status,
                    reference_id, reference_key, metadata
             FROM wallet_transactions
             WHERE transaction_id = $1`,
            [transactionId]
        );
        if (!originalResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Original transaction not found." });
        }
        const original = originalResult.rows[0];
        if (original.type !== "purchase" || original.status !== "success" ||
            !original.user_id || !original.reference_key) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Only successful chapter purchases can be refunded."
            });
        }

        const replay = await replayReversal(
            client,
            original.user_id,
            requestKey,
            "refund",
            transactionId,
            res
        );
        if (replay) return replay;

        const previousReversal = await client.query(
            `SELECT transaction_id FROM wallet_transactions
             WHERE reversal_of_transaction_id = $1`,
            [transactionId]
        );
        if (previousReversal.rowCount) {
            await client.query("ROLLBACK");
            await recordFailure(
                original.user_id,
                requestKey,
                "refund",
                original.reference_id,
                "already_reversed"
            );
            return res.status(409).json({ message: "This transaction has already been refunded." });
        }

        const allocations = await client.query(
            `SELECT user_id, type, amount
             FROM wallet_transactions
             WHERE reference_key = $1
               AND type IN ('creator_earning', 'platform_fee')
             ORDER BY type, transaction_id`,
            [original.reference_key]
        );
        const price = -BigInt(original.amount);
        const creatorEntries = allocations.rows.filter(
            item => item.type === "creator_earning" && item.user_id
        );
        const platformEntries = allocations.rows.filter(
            item => item.type === "platform_fee"
        );
        const expectedWriterShare = price * 90n / 100n;
        const expectedPlatformShare = price - expectedWriterShare;
        if (
            price <= 0n ||
            platformEntries.length !== 1 ||
            BigInt(platformEntries[0].amount) !== expectedPlatformShare ||
            (expectedWriterShare === 0n
                ? creatorEntries.length !== 0
                : creatorEntries.length !== 1 ||
                    BigInt(creatorEntries[0].amount) !== expectedWriterShare)
        ) {
            await client.query("ROLLBACK");
            await recordFailure(
                original.user_id,
                requestKey,
                "refund",
                original.reference_id,
                "invalid_revenue_allocation"
            );
            return res.status(409).json({
                message: "Could not verify the original revenue share, so the refund was cancelled."
            });
        }

        const creatorId = creatorEntries[0]?.user_id;
        const walletRows = await lockWallets(
            client,
            creatorId ? [original.user_id, creatorId] : [original.user_id]
        );
        const creatorWallet = creatorId && walletRows.find(
            wallet => String(wallet.user_id) === String(creatorId)
        );
        if (creatorWallet && BigInt(creatorWallet.balance) < expectedWriterShare) {
            await client.query("ROLLBACK");
            await recordFailure(
                original.user_id,
                requestKey,
                "refund",
                original.reference_id,
                "creator_share_unavailable"
            );
            return res.status(409).json({
                message: "Refund is unavailable because the writer's coin balance cannot cover the original share."
            });
        }

        const reversalKey = crypto.randomUUID();
        if (creatorWallet && expectedWriterShare > 0n) {
            await client.query(
                `UPDATE wallets
                 SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $2 AND balance >= $1`,
                [expectedWriterShare.toString(), creatorId]
            );
            await client.query(
                `INSERT INTO wallet_transactions (
                    user_id, type, amount, status, reference_id,
                    reference_key, metadata
                 )
                 VALUES ($1, 'creator_earning', $2, 'refunded', $3, $4, $5::jsonb)`,
                [
                    creatorId,
                    (-expectedWriterShare).toString(),
                    original.reference_id,
                    reversalKey,
                    JSON.stringify({ reversalOfTransactionId: String(transactionId) })
                ]
            );
        }

        const buyerUpdate = await client.query(
            `UPDATE wallets
             SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2
             RETURNING balance`,
            [price.toString(), original.user_id]
        );
        if (!buyerUpdate.rowCount) {
            throw new Error("Could not credit the refund to the buyer's wallet.");
        }
        const refund = await client.query(
            `INSERT INTO wallet_transactions (
                user_id, type, amount, status, idempotency_key,
                reference_id, reference_key, reversal_of_transaction_id, metadata
             )
             VALUES ($1, 'refund', $2, 'refunded', $3, $4, $5, $6, $7::jsonb)
             RETURNING transaction_id`,
            [
                original.user_id,
                price.toString(),
                requestKey,
                original.reference_id,
                reversalKey,
                transactionId,
                JSON.stringify({ originalTransactionId: String(transactionId) })
            ]
        );
        await client.query(
            `INSERT INTO wallet_transactions (
                user_id, type, amount, status, reference_id,
                reference_key, metadata
             )
             VALUES (NULL, 'platform_fee', $1, 'refunded', $2, $3, $4::jsonb)`,
            [
                (-expectedPlatformShare).toString(),
                original.reference_id,
                reversalKey,
                JSON.stringify({ reversalOfTransactionId: String(transactionId) })
            ]
        );
        await client.query(
            `DELETE FROM chapter_unlocks
             WHERE user_id = $1 AND transaction_id = $2`,
            [original.user_id, transactionId]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "wallet",
            targetId: transactionId,
            targetUserId: original.user_id,
            action: "chapter_purchase_refunded",
            reason,
            oldValues: { transactionId: String(transactionId), amount: price.toString() },
            newValues: {
                reversalTransactionId: String(refund.rows[0].transaction_id),
                buyerRefund: price.toString(),
                creatorShareReversed: expectedWriterShare.toString(),
                platformShareReversed: expectedPlatformShare.toString()
            }
        });
        await createNotification(client, {
            userId: original.user_id,
            type: "transaction",
            category: "transaction",
            message: `Refunded ${price.toString()} coins for a chapter purchase.`,
            chapterId: original.reference_id,
            metadata: {
                transactionId: refund.rows[0].transaction_id,
                status: "refunded",
                amount: price.toString()
            }
        });
        if (creatorId && expectedWriterShare > 0n) {
            await createNotification(client, {
                userId: creatorId,
                type: "transaction",
                category: "transaction",
                message: `Reversed ${expectedWriterShare.toString()} coins from the writer's share.`,
                chapterId: original.reference_id,
                metadata: {
                    transactionId: refund.rows[0].transaction_id,
                    status: "refunded",
                    amount: (-expectedWriterShare).toString()
                }
            });
        }
        await client.query("COMMIT");
        res.json({
            message: "Refund successful.",
            balance: buyerUpdate.rows[0].balance,
            transaction_id: refund.rows[0].transaction_id
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Refund chapter purchase:", error);
        res.status(500).json({ message: "Could not process refund. Please try again." });
    } finally {
        client.release();
    }
});

router.post("/admin/cancellations", requireAdmin, rateLimits.wallet, async (req, res) => {
    const transactionId = req.body?.transaction_id;
    const requestKey = req.get("Idempotency-Key") || req.body?.request_key;
    const reason = safeReason(req.body?.reason);
    if (!validId(transactionId) || !validRequestKey(requestKey)) {
        return res.status(400).json({ message: "Invalid cancellation details." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await lockTransactionForReversal(client, transactionId);
        const originalResult = await client.query(
            `SELECT transaction_id, user_id, type, amount, status, metadata
             FROM wallet_transactions
             WHERE transaction_id = $1`,
            [transactionId]
        );
        if (!originalResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Original transaction not found." });
        }
        const original = originalResult.rows[0];
        if (original.type !== "top_up" || original.status !== "success" ||
            !original.user_id || original.metadata?.simulated !== true) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                message: "Only successful simulated coin top-ups can be cancelled."
            });
        }
        const replay = await replayReversal(
            client,
            original.user_id,
            requestKey,
            "cancel",
            transactionId,
            res
        );
        if (replay) return replay;

        const previousReversal = await client.query(
            `SELECT transaction_id FROM wallet_transactions
             WHERE reversal_of_transaction_id = $1`,
            [transactionId]
        );
        if (previousReversal.rowCount) {
            await client.query("ROLLBACK");
            await recordFailure(
                original.user_id,
                requestKey,
                "cancel",
                null,
                "already_reversed"
            );
            return res.status(409).json({ message: "This coin top-up has already been cancelled." });
        }

        const amount = BigInt(original.amount);
        const wallets = await lockWallets(client, [original.user_id]);
        if (amount <= 0n || BigInt(wallets[0].balance) < amount) {
            await client.query("ROLLBACK");
            await recordFailure(
                original.user_id,
                requestKey,
                "cancel",
                null,
                "insufficient_balance"
            );
            return res.status(409).json({
                message: "Cannot cancel this transaction because the current coin balance is insufficient."
            });
        }
        const updated = await client.query(
            `UPDATE wallets
             SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2 AND balance >= $1
             RETURNING balance`,
            [amount.toString(), original.user_id]
        );
        const reversal = await client.query(
            `INSERT INTO wallet_transactions (
                user_id, type, amount, status, idempotency_key,
                reversal_of_transaction_id, metadata
             )
             VALUES ($1, 'cancel', $2, 'cancelled', $3, $4, $5::jsonb)
             RETURNING transaction_id`,
            [
                original.user_id,
                (-amount).toString(),
                requestKey,
                transactionId,
                JSON.stringify({ originalTransactionId: String(transactionId) })
            ]
        );
        await logAdminAction(client, {
            actorId: req.user.user_id,
            actorRole: req.adminRole,
            targetType: "wallet",
            targetId: transactionId,
            targetUserId: original.user_id,
            action: "top_up_cancelled",
            reason,
            oldValues: { transactionId: String(transactionId), amount: amount.toString() },
            newValues: { reversalTransactionId: String(reversal.rows[0].transaction_id) }
        });
        await createNotification(client, {
            userId: original.user_id,
            type: "transaction",
            category: "transaction",
            message: `Cancelled a ${amount.toString()}-coin top-up.`,
            metadata: {
                transactionId: reversal.rows[0].transaction_id,
                status: "cancelled",
                amount: (-amount).toString()
            }
        });
        await client.query("COMMIT");
        res.json({
            message: "Transaction cancelled.",
            balance: updated.rows[0].balance,
            transaction_id: reversal.rows[0].transaction_id
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Cancel simulated top-up:", error);
        res.status(500).json({ message: "Could not cancel transaction. Please try again." });
    } finally {
        client.release();
    }
});

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT balance, updated_at
             FROM wallets
             WHERE user_id = $1`,
            [req.user.user_id]
        );
        if (!result.rowCount) {
            await pool.query(
                `INSERT INTO wallets (user_id) VALUES ($1)
                 ON CONFLICT (user_id) DO NOTHING`,
                [req.user.user_id]
            );
        }
        const wallet = result.rows[0] || { balance: "0", updated_at: null };
        res.json({
            balance: wallet.balance,
            updated_at: wallet.updated_at,
            packages: [...PACKAGES],
            is_admin: req.user.is_admin === true ||
                ["ADMIN", "SUPER_ADMIN"].includes(req.user.role)
        });
    } catch (error) {
        console.error("Get Wallet:", error);
        res.status(500).json({ message: "Could not load wallet." });
    }
});

router.get("/transactions", async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 20;
    try {
        const result = await pool.query(
            `SELECT transaction_id, type, amount, status, reference_id,
                    metadata, created_at
             FROM wallet_transactions
             WHERE user_id = $1
             ORDER BY created_at DESC, transaction_id DESC
             LIMIT $2 OFFSET $3`,
            [req.user.user_id, limit, (page - 1) * limit]
        );
        const count = await pool.query(
            `SELECT COUNT(*)::int AS total
             FROM wallet_transactions
             WHERE user_id = $1`,
            [req.user.user_id]
        );
        res.json({
            transactions: result.rows,
            page,
            pageSize: limit,
            total: count.rows[0].total
        });
    } catch (error) {
        console.error("Get Wallet Transactions:", error);
        res.status(500).json({ message: "Could not load transaction history." });
    }
});

router.post("/top-up", rateLimits.wallet, async (req, res) => {
    const amount = Number(req.body?.amount);
    const requestKey = req.get("Idempotency-Key") || req.body?.request_key;
    if (!PACKAGES.has(amount)) {
        return res.status(400).json({ message: "Choose a valid coin package." });
    }
    if (!validRequestKey(requestKey)) {
        return res.status(400).json({ message: "Invalid request ID. Please try again." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await getWallet(client, req.user.user_id, true);
        const existing = await findRequest(client, req.user.user_id, requestKey);
        if (existing.rowCount) {
            await client.query("COMMIT");
            const item = existing.rows[0];
            if (
                item.type !== "top_up" ||
                item.status !== "success" ||
                Number(item.metadata.package) !== amount
            ) {
                return res.status(409).json({ message: "This request was already processed and failed. Create a new request." });
            }
            const current = await pool.query(
                `SELECT balance FROM wallets WHERE user_id = $1`,
                [req.user.user_id]
            );
            return res.json({
                message: "Coins added.",
                balance: current.rows[0].balance,
                transaction_id: item.transaction_id,
                replayed: true
            });
        }

        const referenceKey = crypto.randomUUID();
        const balance = await client.query(
            `UPDATE wallets SET balance = balance + $1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2
             RETURNING balance`,
            [amount, req.user.user_id]
        );
        const transaction = await client.query(
            `INSERT INTO wallet_transactions (
                user_id, type, amount, status, idempotency_key,
                reference_key, metadata
             )
             VALUES ($1, 'top_up', $2, 'success', $3, $4, $5::jsonb)
             RETURNING transaction_id`,
            [
                req.user.user_id,
                amount,
                requestKey,
                referenceKey,
                JSON.stringify({ package: amount, simulated: true })
            ]
        );
        await createNotification(client, {
            userId: req.user.user_id,
            type: "transaction",
            category: "transaction",
            message: `Added ${amount.toLocaleString("en-US")} coins.`,
            metadata: { transactionId: transaction.rows[0].transaction_id, amount, status: "success" }
        });
        await client.query("COMMIT");
        res.json({
            message: "Coins added.",
            balance: balance.rows[0].balance,
            transaction_id: transaction.rows[0].transaction_id
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Top up wallet:", error);
        await recordFailure(req.user.user_id, requestKey, "top_up", null, "processing_error");
        res.status(500).json({ message: "Could not add coins. Please try again." });
    } finally {
        client.release();
    }
});

router.post("/chapters/:chapterId/unlock", rateLimits.wallet, async (req, res) => {
    const { chapterId } = req.params;
    const requestKey = req.get("Idempotency-Key") || req.body?.request_key;
    if (!validId(chapterId)) {
        return res.status(400).json({ message: "Invalid chapter ID." });
    }
    if (!validRequestKey(requestKey)) {
        return res.status(400).json({ message: "Invalid request ID. Please try again." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const chapterResult = await client.query(
            `SELECT c.chapter_id, c.novel_id, c.is_paid, c.price, c.status,
                    n.user_id AS author_id, n.title AS novel_title, c.title
             FROM chapters c
             JOIN novels n ON n.novel_id = c.novel_id
             WHERE c.chapter_id = $1
             FOR UPDATE OF c`,
            [chapterId]
        );
        if (!chapterResult.rowCount || chapterResult.rows[0].status !== "published") {
            await client.query("ROLLBACK");
            await recordFailure(req.user.user_id, requestKey, "purchase", chapterId, "chapter_unavailable");
            return res.status(404).json({ message: "Published chapter not found." });
        }
        const chapter = chapterResult.rows[0];
        if (!chapter.is_paid || String(chapter.author_id) === String(req.user.user_id)) {
            await client.query("COMMIT");
            return res.json({ message: "This chapter is free to read.", already_unlocked: true });
        }

        const existing = await findRequest(client, req.user.user_id, requestKey);
        if (existing.rowCount) {
            await client.query("COMMIT");
            const item = existing.rows[0];
            if (
                item.type !== "purchase" ||
                item.status !== "success" ||
                String(item.reference_id) !== String(chapterId)
            ) {
                return res.status(409).json({ message: "This request was already processed and failed. Create a new request." });
            }
            return res.json({ message: "Chapter unlocked.", already_unlocked: true });
        }

        const alreadyUnlocked = await client.query(
            `SELECT 1 FROM chapter_unlocks
             WHERE user_id = $1 AND chapter_id = $2`,
            [req.user.user_id, chapterId]
        );
        if (alreadyUnlocked.rowCount) {
            await client.query("COMMIT");
            return res.json({ message: "You have already unlocked this chapter.", already_unlocked: true });
        }

        const userIds = [req.user.user_id, chapter.author_id]
            .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
        for (const userId of userIds) {
            await getWallet(client, userId);
        }
        const wallets = await client.query(
            `SELECT user_id, balance FROM wallets
             WHERE user_id = ANY($1::bigint[])
             ORDER BY user_id FOR UPDATE`,
            [userIds]
        );
        const buyerWallet = wallets.rows.find(
            wallet => String(wallet.user_id) === String(req.user.user_id)
        );
        if (BigInt(buyerWallet.balance) < BigInt(chapter.price)) {
            await client.query("ROLLBACK");
            await recordFailure(req.user.user_id, requestKey, "purchase", chapterId, "insufficient_balance");
            return res.status(409).json({
                message: "Insufficient coins.",
                balance: buyerWallet.balance,
                required: chapter.price
            });
        }

        const referenceKey = crypto.randomUUID();
        const writerShare = Math.floor(Number(chapter.price) * 0.9);
        const platformShare = Number(chapter.price) - writerShare;
        const debit = await client.query(
            `UPDATE wallets SET balance = balance - $1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2 AND balance >= $1
             RETURNING balance`,
            [chapter.price, req.user.user_id]
        );
        if (!debit.rowCount) {
            throw new Error("Your coin balance changed during the transaction. Please try again.");
        }
        const purchase = await client.query(
            `INSERT INTO wallet_transactions (
                user_id, type, amount, status, idempotency_key,
                reference_id, reference_key, metadata
             )
             VALUES ($1, 'purchase', $2, 'success', $3, $4, $5, $6::jsonb)
             RETURNING transaction_id`,
            [
                req.user.user_id,
                -Number(chapter.price),
                requestKey,
                chapterId,
                referenceKey,
                JSON.stringify({ novelId: chapter.novel_id, title: chapter.title })
            ]
        );
        await client.query(
            `INSERT INTO chapter_unlocks (user_id, chapter_id, transaction_id)
             VALUES ($1, $2, $3)`,
            [req.user.user_id, chapterId, purchase.rows[0].transaction_id]
        );
        await client.query(
            `UPDATE wallets SET balance = balance + $1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2`,
            [writerShare, chapter.author_id]
        );
        if (writerShare > 0) {
            await client.query(
                `INSERT INTO wallet_transactions (
                    user_id, type, amount, status, reference_id, reference_key, metadata
                 )
                 VALUES ($1, 'creator_earning', $2, 'success', $3, $4, $5::jsonb),
                        (NULL, 'platform_fee', $6, 'success', $3, $4, $5::jsonb)`,
                [
                    chapter.author_id,
                    writerShare,
                    chapterId,
                    referenceKey,
                    JSON.stringify({ buyerId: req.user.user_id, novelId: chapter.novel_id }),
                    platformShare
                ]
            );
        } else {
            await client.query(
                `INSERT INTO wallet_transactions (
                    user_id, type, amount, status, reference_id, reference_key, metadata
                 )
                 VALUES (NULL, 'platform_fee', $1, 'success', $2, $3, $4::jsonb)`,
                [
                    platformShare,
                    chapterId,
                    referenceKey,
                    JSON.stringify({ buyerId: req.user.user_id, novelId: chapter.novel_id })
                ]
            );
        }
        await createNotification(client, {
            userId: req.user.user_id,
            type: "transaction",
            category: "transaction",
            message: `Chapter "${chapter.title}" unlocked.`,
            actorId: chapter.author_id,
            chapterId,
            metadata: { amount: Number(chapter.price), status: "success" }
        });
        if (writerShare > 0) {
            await createNotification(client, {
                userId: chapter.author_id,
                type: "transaction",
                category: "transaction",
                message: `You earned ${writerShare} coins from chapter "${chapter.title}".`,
                actorId: null,
                chapterId,
                metadata: { amount: writerShare, sharePercent: 90, status: "success" }
            });
        }
        await client.query("COMMIT");
        res.json({
            message: "Chapter unlocked.",
            balance: debit.rows[0].balance,
            transaction_id: purchase.rows[0].transaction_id
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Unlock paid chapter:", error);
        await recordFailure(req.user.user_id, requestKey, "purchase", chapterId, "processing_error");
        res.status(500).json({ message: "Could not purchase content. Please try again." });
    } finally {
        client.release();
    }
});

router.post("/admin/adjust", requireAdmin, rateLimits.wallet, async (req, res) => {
    const { user_id: userId, operation, reason } = req.body || {};
    const amount = Number(req.body?.amount);
    const requestKey = req.get("Idempotency-Key") || req.body?.request_key;
    if (!validId(userId) || !["credit", "debit"].includes(operation) ||
        !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
        return res.status(400).json({ message: "Invalid coin adjustment details." });
    }
    if (!validRequestKey(requestKey)) {
        return res.status(400).json({ message: "Invalid request ID. Please try again." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const wallet = await getWallet(client, userId, true);
        if (!wallet) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "User account not found." });
        }
        const existing = await findRequest(client, userId, requestKey);
        if (existing.rowCount) {
            await client.query("COMMIT");
            const expectedType = operation === "credit" ? "admin_credit" : "admin_debit";
            if (
                existing.rows[0].type !== expectedType ||
                Math.abs(Number(existing.rows[0].amount)) !== amount
            ) {
                return res.status(409).json({
                    message: "This request ID was already used for a different balance adjustment."
                });
            }
            return res.json({ message: "This balance adjustment was already processed.", replayed: true });
        }
        const change = operation === "credit" ? amount : -amount;
        const updated = await client.query(
            `UPDATE wallets SET balance = balance + $1,
                    updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $2 AND balance + $1 >= 0
             RETURNING balance`,
            [change, userId]
        );
        if (!updated.rowCount) {
            await client.query("ROLLBACK");
            await recordFailure(userId, requestKey, "admin_adjust", null, "insufficient_balance");
            return res.status(409).json({ message: "Insufficient coins for this debit." });
        }
        const type = operation === "credit" ? "admin_credit" : "admin_debit";
        const transaction = await client.query(
            `INSERT INTO wallet_transactions (
                user_id, type, amount, status, idempotency_key, metadata
             )
             VALUES ($1, $2, $3, 'success', $4, $5::jsonb)
             RETURNING transaction_id`,
            [
                userId,
                type,
                change,
                requestKey,
                JSON.stringify({
                    sender: "Noveltail Team",
                    operation,
                    reason: typeof reason === "string" ? reason.trim().slice(0, 500) : null
                })
            ]
        );
        await createNotification(client, {
            userId,
            type: "transaction",
            category: "transaction",
            message: `Noveltail Team ${operation === "credit" ? "credited" : "debited"} ${amount.toLocaleString("en-US")} coins.`,
            metadata: {
                transactionId: transaction.rows[0].transaction_id,
                sender: "Noveltail Team",
                operation,
                amount,
                reason: typeof reason === "string" ? reason.trim().slice(0, 500) : null
            }
        });
        await client.query("COMMIT");
        res.json({ message: "Coin balance adjusted.", balance: updated.rows[0].balance });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Admin wallet adjustment:", error);
        res.status(500).json({ message: "Could not adjust coin balance." });
    } finally {
        client.release();
    }
});

module.exports = router;

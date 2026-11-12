const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

function isAdmin(user) {
    return user?.is_admin === true || ADMIN_ROLES.has(user?.role);
}

function actorRole(user) {
    if (user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") {
        return user.role;
    }
    return user?.is_admin === true ? "ADMIN" : null;
}

function requireAdmin(req, res, next) {
    if (!isAdmin(req.user)) {
        return res.status(403).json({ message: "You are not authorized to perform this action." });
    }
    req.adminRole = actorRole(req.user);
    next();
}

function requireSuperAdmin(req, res, next) {
    if (req.user?.role !== "SUPER_ADMIN") {
        return res.status(403).json({
            message: "Only the SUPER_ADMIN can manage administrator roles."
        });
    }
    next();
}

module.exports = { isAdmin, actorRole, requireAdmin, requireSuperAdmin };

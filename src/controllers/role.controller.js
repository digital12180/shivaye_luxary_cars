import Role from "../models/Role.js";
import { ok, fail } from "../utils/response.js";

// GET /api/v1/roles
export const listRoles = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const { search, status } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (search) filter.name = new RegExp(search, "i");

    const [data, total] = await Promise.all([
      Role.find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort("-createdAt"),
      Role.countDocuments(filter),
    ]);

    return ok(res, {
      data,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/roles/:id
export const getRole = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, "Role not found", 404);
    return ok(res, role);
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/roles
export const createRole = async (req, res, next) => {
  try {
    const { name, description, permissions } = req.body;

    const exists = await Role.findOne({ name });
    if (exists) return fail(res, "Role with this name already exists", 409);

    const role = await Role.create({
      name,
      description,
      permissions: permissions || {}, // e.g. { leads: { read: true, create: true } }
      createdBy: req.user._id,
    });

    return ok(res, role, "Role created successfully", 201);
  } catch (err) {
    next(err);
  }
};

// PUT /api/v1/roles/:id
export const updateRole = async (req, res, next) => {
  try {
    const { name, description, permissions, status } = req.body;

    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, "Role not found", 404);
    
    // Prevent updating system role names/status
    if (role.isSystemRole && name && name !== role.name) {
      return fail(res, "Cannot rename a system role", 400);
    }

    if (name) role.name = name;
    if (description !== undefined) role.description = description;
    if (status) role.status = status;
    
    // Update permissions (overwrite or merge depending on your need)
    if (permissions) {
      role.permissions = permissions; 
    }

    role.updatedBy = req.user._id;
    await role.save();

    return ok(res, role, "Role updated successfully");
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/roles/:id
export const deleteRole = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, "Role not found", 404);

    if (role.isSystemRole) {
      return fail(res, "System roles cannot be deleted", 400);
    }

    // Optional: Check if any active user is using this role before deleting
    // const userCount = await User.countDocuments({ roleId: role._id });
    // if (userCount > 0) return fail(res, "Cannot delete role assigned to users", 400);

    role.deletedAt = new Date();
    role.status = "inactive";
    role.updatedBy = req.user._id;
    await role.save();

    return ok(res, {}, "Role deleted successfully");
  } catch (err) {
    next(err);
  }
};
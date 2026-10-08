export const notFound = (req, res, next) => {
    res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
};

export const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";
    let errors = err.errors || [];

    if (err.name === "ValidationError") {
        statusCode = 400;
        message = "Validation failed";
        errors = Object.values(err.errors).map((e) => e.message);
    }

    if (err.code === 11000) {
        statusCode = 409;
        message = `Duplicate value for ${Object.keys(err.keyValue).join(", ")}`;
    }

    if (err.name === "JsonWebTokenError") {
        statusCode = 401;
        message = "Invalid token";
    }

    if (err.name === "TokenExpiredError") {
        statusCode = 401;
        message = "Token expired";
    }

    res.status(statusCode).json({
        success: false,
        message,
        errors: errors.length ? errors : undefined,
    });
};
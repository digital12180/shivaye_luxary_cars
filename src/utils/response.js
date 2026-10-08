export const ok = (res, data = {}, message = "Success", statusCode = 200) =>
    res.status(statusCode).json({ success: true, message, data });

export const fail = (res, message = "Error", statusCode = 400, errors = []) =>
    res.status(statusCode).json({ success: false, message, errors });

export const throwError = (statusCode, message, errors = []) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.errors = errors;
    throw err;
};
import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const invalidJson = error instanceof SyntaxError &&
    (error as { type?: string }).type === "entity.parse.failed";
  const status = invalidJson ? 400 :
    Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status : 500;
  if (status === 500) console.error(error);
  res.status(status).json({
    message: invalidJson ? "Invalid JSON body" : status === 500 ? "Internal server error" : error.message,
    ...(Array.isArray(error?.errors) ? { errors: error.errors } : {}),
  });
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[ErrorHandler]', err);

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      message: 'A record with this value already exists. Please use a unique value.',
    });
  }

  // MySQL foreign key constraint violation
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(400).json({
      success: false,
      message:
        err.code === 'ER_NO_REFERENCED_ROW_2'
          ? 'The referenced record does not exist.'
          : 'This record is referenced by other records and cannot be deleted.',
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const response = {
    success: false,
    message: err.message || 'An unexpected error occurred.',
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  return res.status(statusCode).json(response);
}

module.exports = errorHandler;

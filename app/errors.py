class DomainError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFound(DomainError):
    status, code = 404, "not_found"


class ValidationFailed(DomainError):
    status, code = 422, "validation_error"


class Conflict(DomainError):
    status, code = 409, "conflict"


class Forbidden(DomainError):
    status, code = 403, "forbidden"


class InsufficientStock(Conflict):
    code = "insufficient_stock"


class ImmutableRecord(Exception):
    pass

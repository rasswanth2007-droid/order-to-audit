from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .db import get_db
from . import models as m
from .errors import DomainError, Forbidden
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


class Unauthorized(DomainError):
    status, code = 401, "unauthorized"


def current_user(request: Request, cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> m.User:
    if not cred:
        raise Unauthorized("Authentication required")
    claims = decode_token(cred.credentials)
    if not claims:
        raise Unauthorized("Session expired or invalid; please sign in again")
    user = db.get(m.User, int(claims["sub"]))
    if not user or not user.is_active or user.token_version != claims.get("tv"):
        raise Unauthorized("Session no longer valid; please sign in again")
    request.state.user = user
    return user


def require(*roles: str):
    allowed = set(roles)

    def dep(user: m.User = Depends(current_user)) -> m.User:
        if user.role not in allowed:
            raise Forbidden(f"Role {user.role} is not allowed to do this")
        return user
    return dep


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


ADMIN = require("ADMIN")
STAFF_READ = require("ADMIN", "OWNER", "ACCOUNTANT")
FLOOR = require("ADMIN", "PRODUCTION")

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m, schemas as s
from ..audit import audit
from ..db import get_db
from ..deps import ADMIN, Unauthorized, client_ip, current_user
from ..errors import Conflict, DomainError, NotFound, ValidationFailed
from ..security import check_password_strength, hash_password, login_throttle, make_token, verify_password

router = APIRouter(tags=["auth"])
_DUMMY = hash_password("dummy-password-for-timing")


class TooMany(DomainError):
    status, code = 429, "too_many_attempts"


def user_view(u: m.User) -> dict:
    return {"id": u.id, "username": u.username, "full_name": u.full_name, "role": u.role, "is_active": u.is_active}


@router.post("/auth/login")
def login(body: s.LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    if login_throttle.locked(body.username, ip):
        raise TooMany("Too many failed attempts. Try again later.")
    u = db.execute(select(m.User).where(m.User.username == body.username)).scalar_one_or_none()
    ok = verify_password(body.password, u.password_hash if u else _DUMMY)  # constant-ish time for unknown users
    if not (u and ok and u.is_active):
        login_throttle.fail(body.username, ip)
        audit(db, None, "LOGIN_FAILED", "user", body.username[:40], ip=ip)
        db.commit()
        raise Unauthorized("Invalid username or password")
    login_throttle.reset(body.username)
    audit(db, u, "LOGIN", "user", u.id, ip=ip)
    db.commit()
    tok, ttl = make_token(u)
    return {"access_token": tok, "token_type": "bearer", "expires_in": ttl, "user": user_view(u)}


@router.get("/auth/me")
def me(user: m.User = Depends(current_user)):
    return user_view(user)


@router.post("/auth/change-password")
def change_password(body: s.PasswordChange, user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise Unauthorized("Current password is incorrect")
    err = check_password_strength(body.new_password)
    if err:
        raise ValidationFailed(err)
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1  # signs out every other session
    audit(db, user, "PASSWORD_CHANGE", "user", user.id)
    db.commit()
    tok, ttl = make_token(user)
    return {"access_token": tok, "token_type": "bearer", "expires_in": ttl}


@router.get("/users")
def list_users(_: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    return [user_view(u) for u in db.execute(select(m.User).order_by(m.User.id)).scalars()]


@router.post("/users", status_code=201)
def create_user(body: s.UserCreate, admin: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    err = check_password_strength(body.password)
    if err:
        raise ValidationFailed(err)
    if db.execute(select(m.User).where(m.User.username == body.username)).scalar_one_or_none():
        raise Conflict("Username already exists")
    u = m.User(username=body.username, full_name=body.full_name, role=body.role, password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    audit(db, admin, "USER_CREATE", "user", u.id, None, {"username": u.username, "role": u.role})
    db.commit()
    return user_view(u)


@router.patch("/users/{uid}")
def update_user(uid: int, body: s.UserUpdate, admin: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    u = db.get(m.User, uid)
    if not u:
        raise NotFound("User not found")
    before = user_view(u)
    if body.new_password:
        err = check_password_strength(body.new_password)
        if err:
            raise ValidationFailed(err)
        u.password_hash = hash_password(body.new_password)
        u.token_version += 1
    if body.full_name is not None:
        u.full_name = body.full_name
    if body.role is not None:
        u.role = body.role
        u.token_version += 1
    if body.is_active is not None:
        if u.id == admin.id and not body.is_active:
            raise Conflict("You cannot deactivate yourself")
        u.is_active = body.is_active
    audit(db, admin, "USER_UPDATE", "user", u.id, before, user_view(u))
    db.commit()
    return user_view(u)

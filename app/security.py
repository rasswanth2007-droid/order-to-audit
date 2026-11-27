import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from .config import get_settings

s = get_settings()
ALGO = "HS256"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def check_password_strength(pw: str) -> str | None:
    if len(pw) < 10:
        return "Password must be at least 10 characters"
    if not (any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw)):
        return "Password needs upper-case, lower-case and a digit"
    return None


def make_token(user) -> tuple[str, int]:
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.access_token_minutes)
    tok = jwt.encode({"sub": str(user.id), "role": user.role, "tv": user.token_version, "exp": exp, "jti": uuid.uuid4().hex},
                     s.secret_key, algorithm=ALGO)
    return tok, s.access_token_minutes * 60


def decode_token(tok: str) -> dict | None:
    try:
        return jwt.decode(tok, s.secret_key, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None


class LoginThrottle:
    """In-memory brute-force protection (per username and per IP). Single-process only; use Redis when scaling out."""

    def __init__(self):
        self.fails: dict[str, list[float]] = defaultdict(list)

    def _recent(self, key):
        cutoff = time.time() - s.login_lock_minutes * 60
        self.fails[key] = [t for t in self.fails[key] if t > cutoff]
        return self.fails[key]

    def locked(self, username: str, ip: str) -> bool:
        return len(self._recent("u:" + username.lower())) >= s.login_max_failures or len(self._recent("i:" + ip)) >= s.login_max_failures * 4

    def fail(self, username: str, ip: str):
        now = time.time()
        self.fails["u:" + username.lower()].append(now)
        self.fails["i:" + ip].append(now)

    def reset(self, username: str):
        self.fails.pop("u:" + username.lower(), None)


login_throttle = LoginThrottle()


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.time()
        q = self.hits[key]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True

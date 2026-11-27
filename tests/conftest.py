import os
import tempfile
import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["ENV"] = "development"
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["LOGIN_MAX_FAILURES"] = "5"

from fastapi.testclient import TestClient  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402

PW = "Demo@12345"


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db, PW)
    from app.security import login_throttle
    login_throttle.fails.clear()
    with TestClient(app) as c:
        yield c


def login(client, username, password=PW):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


@pytest.fixture()
def H(client):
    return {u: login(client, u) for u in ("admin", "salesman_a", "salesman_b", "production", "accountant", "owner")}


def ids(client, H):
    items = {i["sku"]: i["id"] for i in client.get("/api/v1/items", headers=H["admin"]).json()}
    custs = {c["name"]: c["id"] for c in client.get("/api/v1/customers", headers=H["admin"]).json()}
    return items, custs

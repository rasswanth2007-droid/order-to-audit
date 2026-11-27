from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import get_settings

settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")
_kwargs = {"connect_args": {"check_same_thread": False}} if _is_sqlite else {"pool_size": 10, "max_overflow": 10, "pool_pre_ping": True}
engine = create_engine(settings.database_url, future=True, **_kwargs)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None  # we control BEGIN ourselves
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=10000")
        cur.close()

    @event.listens_for(engine, "begin")
    def _sqlite_begin(conn):
        # take the write lock up-front so read-check-write sequences (stock checks) are serialised
        conn.exec_driver_sql("BEGIN IMMEDIATE")

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()  # uncommitted work is rolled back; endpoints commit explicitly

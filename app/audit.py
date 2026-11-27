import json
from sqlalchemy.orm import Session
from . import models as m


def audit(db: Session, user, action: str, entity: str, entity_id=None, before=None, after=None, ip: str | None = None):
    db.add(m.AuditLog(user_id=getattr(user, "id", None), username=getattr(user, "username", None), action=action,
                      entity=entity, entity_id=str(entity_id) if entity_id is not None else None,
                      before_json=json.dumps(before, default=str) if before is not None else None,
                      after_json=json.dumps(after, default=str) if after is not None else None, ip=ip))

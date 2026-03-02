import pymysql

pymysql.version_info = (2, 2, 1, "final", 0)
pymysql.__version__ = "2.2.1"
pymysql.install_as_MySQLdb()
try:
    from .celery import app as celery_app
except Exception:  # pragma: no cover - optional dependency path for local dev before installing celery
    celery_app = None

__all__ = ("celery_app",)

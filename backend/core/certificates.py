import uuid

from django.core import signing


SIGNATURE_VERSION = 1
SIGNING_SALT = "certificate-payload-v1"


def build_certificate_payload(certificate):
    full_name = ""
    profile = getattr(certificate.user, "student_profile", None)
    if profile and profile.full_name:
        full_name = profile.full_name.strip()
    if not full_name:
        full_name = certificate.user.get_full_name().strip() or certificate.user.username

    return {
        "v": SIGNATURE_VERSION,
        "certificate_code": certificate.certificate_code,
        "verification_code": certificate.verification_code,
        "user_id": int(certificate.user_id),
        "student_name": full_name,
        "course_id": int(certificate.course_id),
        "course_title": certificate.course.title,
        "issued_at": certificate.issued_at.isoformat(),
    }


def ensure_certificate_signature(certificate, *, save=True):
    changed = False
    if not certificate.verification_code:
        certificate.verification_code = uuid.uuid4().hex[:16].upper()
        changed = True
    if not certificate.signature_version:
        certificate.signature_version = SIGNATURE_VERSION
        changed = True
    payload = build_certificate_payload(certificate)
    signed_payload = signing.dumps(payload, salt=SIGNING_SALT)
    if certificate.signed_payload != signed_payload:
        certificate.signed_payload = signed_payload
        changed = True
    if changed and save:
        certificate.save(
            update_fields=[
                "verification_code",
                "signed_payload",
                "signature_version",
                "updated_at",
            ]
        )
    return certificate


def validate_certificate_signature(certificate):
    if not certificate.signed_payload:
        return False, "missing_signature"
    try:
        decoded = signing.loads(certificate.signed_payload, salt=SIGNING_SALT)
    except signing.BadSignature:
        return False, "invalid_signature"
    expected = build_certificate_payload(certificate)
    if decoded != expected:
        return False, "payload_mismatch"
    return True, "valid"

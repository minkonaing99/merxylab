from django.core.management.base import BaseCommand

from core.certificates import ensure_certificate_signature
from core.models import Certificate


class Command(BaseCommand):
    help = "Backfill certificate verification_code/signed_payload for existing certificates."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Inspect and count certificates that would change without writing.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional max number of certificates to process.",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        limit = int(options.get("limit") or 0)

        queryset = Certificate.objects.select_related("user", "course", "user__student_profile").order_by("id")
        if limit > 0:
            queryset = queryset[:limit]

        total = 0
        changed = 0
        for cert in queryset:
            total += 1
            before_code = cert.verification_code
            before_payload = cert.signed_payload
            before_version = cert.signature_version

            ensure_certificate_signature(cert, save=not dry_run)

            if (
                cert.verification_code != before_code
                or cert.signed_payload != before_payload
                or cert.signature_version != before_version
            ):
                changed += 1

        mode = "DRY RUN" if dry_run else "APPLIED"
        self.stdout.write(self.style.SUCCESS(f"[{mode}] Processed: {total}, changed: {changed}"))

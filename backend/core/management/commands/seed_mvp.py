from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

class Command(BaseCommand):
    help = "Seed admin-only local baseline (idempotent)."

    @transaction.atomic
    def handle(self, *args, **options):
        user_model = get_user_model()

        admin_group, _ = Group.objects.get_or_create(name="admin")

        admin_user, created = user_model.objects.get_or_create(
            username="merxy",
            defaults={"email": "admin@merxylab.local", "is_staff": True, "is_superuser": True},
        )
        admin_user.is_staff = True
        admin_user.is_superuser = True
        admin_user.set_password("Tkhantnaing1")
        admin_user.save(update_fields=["password", "is_staff", "is_superuser"])
        admin_user.groups.add(admin_group)

        self.stdout.write(self.style.SUCCESS("Seed completed (admin only)."))
        self.stdout.write("Admin user: merxy / Tkhantnaing1")

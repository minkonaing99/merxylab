from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    message = "Admin role required."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.is_superuser or user.groups.filter(name="admin").exists()

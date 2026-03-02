from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_finalexamsession"),
    ]

    operations = [
        migrations.AddField(
            model_name="course",
            name="publish_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="course",
            name="unpublish_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]


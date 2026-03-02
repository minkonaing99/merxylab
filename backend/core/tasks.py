import glob
import shutil
import subprocess
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.models import Lesson, VideoTranscodeJob


def _resolve_binary(explicit_path, command_name):
    if explicit_path and Path(explicit_path).exists():
        return explicit_path

    detected = shutil.which(command_name)
    if detected:
        return detected

    if command_name in ("ffmpeg", "ffprobe"):
        winget_pattern = str(
            Path.home()
            / "AppData"
            / "Local"
            / "Microsoft"
            / "WinGet"
            / "Packages"
            / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
            / "ffmpeg-*"
            / "bin"
            / f"{command_name}.exe"
        )
        candidates = sorted(glob.glob(winget_pattern), reverse=True)
        if candidates:
            return candidates[0]
    return None


def _job_payload(job):
    return {
        "id": job.id,
        "lesson_id": job.lesson_id,
        "status": job.status,
        "progress_percent": int(job.progress_percent),
        "attempt_count": int(job.attempt_count),
        "max_attempts": int(job.max_attempts),
        "error_message": job.error_message,
        "output_hls_master_path": job.output_hls_master_path,
        "output_duration_seconds": job.output_duration_seconds,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _set_job_failed(job, message):
    job.status = VideoTranscodeJob.Status.FAILED
    job.progress_percent = 0
    job.error_message = message[:4000]
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "progress_percent", "error_message", "finished_at", "updated_at"])


@shared_task(bind=True, max_retries=10)
def process_video_transcode_job(self, job_id):
    try:
        job = VideoTranscodeJob.objects.select_related("lesson").get(id=job_id)
    except VideoTranscodeJob.DoesNotExist:
        return {"detail": "Job not found."}

    if job.status == VideoTranscodeJob.Status.COMPLETED:
        return _job_payload(job)
    if job.status == VideoTranscodeJob.Status.FAILED:
        return _job_payload(job)

    attempt = int(self.request.retries) + 1
    now = timezone.now()
    with transaction.atomic():
        job = VideoTranscodeJob.objects.select_for_update().select_related("lesson").get(id=job_id)
        if job.status == VideoTranscodeJob.Status.COMPLETED:
            return _job_payload(job)
        job.status = VideoTranscodeJob.Status.PROCESSING
        job.progress_percent = 10
        job.attempt_count = max(job.attempt_count, attempt)
        job.started_at = job.started_at or now
        job.task_id = self.request.id or job.task_id
        job.error_message = ""
        job.save(
            update_fields=[
                "status",
                "progress_percent",
                "attempt_count",
                "started_at",
                "task_id",
                "error_message",
                "updated_at",
            ]
        )

    lesson: Lesson = job.lesson
    input_path = Path(job.source_file)
    if not input_path.is_absolute():
        input_path = (Path(settings.BASE_DIR) / input_path).resolve()

    ffmpeg_bin = _resolve_binary(settings.FFMPEG_BIN, "ffmpeg")
    ffprobe_bin = _resolve_binary(settings.FFPROBE_BIN, "ffprobe")
    if not ffmpeg_bin:
        _set_job_failed(job, "ffmpeg is required on the server PATH for video transcoding.")
        return _job_payload(VideoTranscodeJob.objects.get(id=job_id))
    if not input_path.exists():
        _set_job_failed(job, "Uploaded source video file is missing.")
        return _job_payload(VideoTranscodeJob.objects.get(id=job_id))

    output_dir = Path(settings.MEDIA_ROOT) / "hls" / f"course_{lesson.course_id}" / f"lesson_{lesson.id}"
    output_dir.mkdir(parents=True, exist_ok=True)
    master_path = output_dir / "master.m3u8"
    segment_pattern = str(output_dir / "seg_%03d.ts")

    ffmpeg_cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-hls_time",
        "6",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        segment_pattern,
        str(master_path),
    ]

    timeout_seconds = int(getattr(settings, "VIDEO_TRANSCODE_TIMEOUT_SECONDS", 7200))
    try:
        ffmpeg_result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=timeout_seconds)
        if ffmpeg_result.returncode != 0 or not master_path.exists():
            raise RuntimeError(f"Video transcoding failed. {ffmpeg_result.stderr[-1200:]}")

        duration_seconds = lesson.duration_seconds
        if ffprobe_bin:
            ffprobe_cmd = [
                ffprobe_bin,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(input_path),
            ]
            ffprobe_result = subprocess.run(ffprobe_cmd, capture_output=True, text=True, timeout=120)
            if ffprobe_result.returncode == 0:
                try:
                    duration_seconds = int(float(ffprobe_result.stdout.strip()))
                except ValueError:
                    pass

        hls_path = f"media/hls/course_{lesson.course_id}/lesson_{lesson.id}/master.m3u8"
        lesson.hls_master_path = hls_path
        lesson.duration_seconds = duration_seconds
        lesson.save(update_fields=["hls_master_path", "duration_seconds", "updated_at"])

        with transaction.atomic():
            job = VideoTranscodeJob.objects.select_for_update().get(id=job_id)
            job.status = VideoTranscodeJob.Status.COMPLETED
            job.progress_percent = 100
            job.output_hls_master_path = hls_path
            job.output_duration_seconds = duration_seconds
            job.finished_at = timezone.now()
            job.error_message = ""
            job.save(
                update_fields=[
                    "status",
                    "progress_percent",
                    "output_hls_master_path",
                    "output_duration_seconds",
                    "finished_at",
                    "error_message",
                    "updated_at",
                ]
            )

        try:
            input_path.unlink(missing_ok=True)
        except Exception:
            pass

        return _job_payload(VideoTranscodeJob.objects.get(id=job_id))
    except Exception as exc:
        with transaction.atomic():
            job = VideoTranscodeJob.objects.select_for_update().get(id=job_id)
            job.attempt_count = max(job.attempt_count, attempt)
            job.error_message = str(exc)[:4000]
            job.status = VideoTranscodeJob.Status.RETRYING
            job.save(update_fields=["attempt_count", "error_message", "status", "updated_at"])

        max_attempts = int(max(1, job.max_attempts))
        if attempt < max_attempts:
            base = int(getattr(settings, "VIDEO_TRANSCODE_RETRY_BASE_SECONDS", 45))
            delay = min(900, base * (2 ** (attempt - 1)))
            raise self.retry(exc=exc, countdown=delay)

        _set_job_failed(VideoTranscodeJob.objects.get(id=job_id), str(exc))
        return _job_payload(VideoTranscodeJob.objects.get(id=job_id))

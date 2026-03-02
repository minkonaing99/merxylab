# MerxyLab EC2 Deployment Guide (teaching.merxy.club)

This is the updated step-by-step deployment guide for your current setup.

## 1. EC2 Security Group

Allow inbound:
- `22` SSH (your IP)
- `80` HTTP (0.0.0.0/0)
- `443` HTTPS (0.0.0.0/0)
- Optional temporary debug: `3000`, `8000` from your IP

## 2. Connect to EC2

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

## 3. Install base packages

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git curl python3-venv python3-pip ffmpeg nginx
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

Verify:

```bash
docker --version
docker compose version
python3 --version
```

## 4. Clone project

```bash
cd ~
git clone https://github.com/minkonaing99/merxylab.git
cd merxylab
git checkout v1.0.6
```

## 5. Backend environment (`backend/.env`)

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Use this template (replace secrets):

```env
DJANGO_SECRET_KEY=REPLACE_WITH_STRONG_SECRET
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=teaching.merxy.club,13.250.33.181,127.0.0.1,localhost

MYSQL_DATABASE=merxylab
MYSQL_USER=merxylab
MYSQL_PASSWORD=REPLACE_DB_PASSWORD
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306

CORS_ALLOWED_ORIGINS=https://teaching.merxy.club,http://teaching.merxy.club
CSRF_TRUSTED_ORIGINS=https://teaching.merxy.club,http://teaching.merxy.club

JWT_ACCESS_MINUTES=15
JWT_REFRESH_DAYS=7
STREAM_LEASE_TTL_SECONDS=180
STREAM_TOKEN_TTL_SECONDS=120
STREAM_SESSION_COOLDOWN_SECONDS=30
MEDIA_ROOT=media

FFMPEG_BIN=
FFPROBE_BIN=

QUIZ_FAIL_LIMIT_PER_DAY=3
QUIZ_FAIL_COOLDOWN_MINUTES=30
FINAL_EXAM_RETRY_FEE_CREDITS=50

SESSION_COOKIE_SECURE=true
CSRF_COOKIE_SECURE=true
SECURE_SSL_REDIRECT=true
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=true
SECURE_HSTS_PRELOAD=true
USE_X_FORWARDED_PROTO=true

MONGO_URI=
MONGO_DB=merxylab
MONGO_TIMEOUT_MS=2000
```

## 6. Frontend environment (`frontend/.env.local`)

Important: this project uses `NEXT_PUBLIC_API_BASE_URL` (not `NEXT_PUBLIC_API_BASE`).

```bash
cat > frontend/.env.local << 'EOF'
NEXT_PUBLIC_API_BASE_URL=/api
EOF
```

## 7. Start MySQL in Docker

```bash
docker run -d --name merxylab-mysql \
  -e MYSQL_ROOT_PASSWORD=REPLACE_ROOT_PASSWORD \
  -e MYSQL_DATABASE=merxylab \
  -e MYSQL_USER=merxylab \
  -e MYSQL_PASSWORD=REPLACE_DB_PASSWORD \
  -p 3306:3306 \
  --restart unless-stopped \
  mysql:8.0
```

Check:

```bash
docker ps
```

## 8. Python venv + backend dependencies

```bash
cd ~/merxylab
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
pip install gunicorn
python backend/manage.py migrate
python backend/manage.py createsuperuser
deactivate
```

## 9. Install Node 20 (required by Next 16)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 10. Install frontend dependencies and build

```bash
cd ~/merxylab/frontend
rm -rf node_modules package-lock.json .next
npm install
npm run build
```

## 11. Create systemd service: backend (gunicorn)

```bash
sudo tee /etc/systemd/system/merxylab-backend.service > /dev/null << 'EOF'
[Unit]
Description=MerxyLab Django Backend (Gunicorn)
After=network.target docker.service

[Service]
User=ubuntu
Group=www-data
WorkingDirectory=/home/ubuntu/merxylab/backend
EnvironmentFile=/home/ubuntu/merxylab/backend/.env
ExecStart=/home/ubuntu/merxylab/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

## 12. Create systemd service: frontend (next start)

```bash
sudo tee /etc/systemd/system/merxylab-frontend.service > /dev/null << 'EOF'
[Unit]
Description=MerxyLab Next.js Frontend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/merxylab/frontend
Environment=NODE_ENV=production
EnvironmentFile=-/home/ubuntu/merxylab/frontend/.env.local
ExecStartPre=/usr/bin/test -f /home/ubuntu/merxylab/frontend/.next/BUILD_ID
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Enable/start services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now merxylab-backend
sudo systemctl enable --now merxylab-frontend
```

## 13. Nginx config (domain + reverse proxy)

```bash
sudo tee /etc/nginx/sites-available/merxylab > /dev/null << 'EOF'
server {
    listen 80;
    server_name teaching.merxy.club;
    client_max_body_size 2G;
    proxy_read_timeout 900;
    proxy_send_timeout 900;

    # Dedicated upload route for large video files
    location /api/admin/upload-video/ {
        proxy_pass http://127.0.0.1:8000/api/admin/upload-video/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 2G;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_request_buffering off;
        proxy_buffering off;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:8000/media/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8000/admin/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
```

Enable and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/merxylab /etc/nginx/sites-enabled/merxylab
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## 14. DNS in Route53

- Create/confirm `A` record: `teaching.merxy.club` -> your EC2 Elastic IP.

Check:

```bash
dig +short teaching.merxy.club
```

## 15. SSL with Let’s Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d teaching.merxy.club
```

Test renewal:

```bash
sudo certbot renew --dry-run
```

## 16. Final health checks

```bash
curl https://teaching.merxy.club/api/health/
curl -I https://teaching.merxy.club
```

Browser:
- `https://teaching.merxy.club`
- `https://teaching.merxy.club/api/health/`

## 17. Troubleshooting

### A. Home page shows `API: http://localhost:8000/api`
Cause: wrong env key or stale build.

Fix:

```bash
cat > ~/merxylab/frontend/.env.local << 'EOF'
NEXT_PUBLIC_API_BASE_URL=/api
EOF
cd ~/merxylab/frontend
rm -rf .next
npm run build
sudo systemctl restart merxylab-frontend
grep -R "localhost:8000" ~/merxylab/frontend/.next | head
```

### B. Django returns `Bad Request (400)` on public URL
Cause: host missing in `DJANGO_ALLOWED_HOSTS`.

Fix: include domain + IP in `backend/.env`, then restart backend.

### C. `ENOENT .next/BUILD_ID` in frontend logs
Cause: service started before build.

Fix:

```bash
cd ~/merxylab/frontend
rm -rf .next
npm run build
sudo systemctl restart merxylab-frontend
```

### D. View logs quickly

```bash
sudo systemctl status merxylab-backend --no-pager
sudo systemctl status merxylab-frontend --no-pager
sudo systemctl status nginx --no-pager
sudo journalctl -u merxylab-backend -n 120 --no-pager
sudo journalctl -u merxylab-frontend -n 120 --no-pager
```

### E. Video upload fails (`500`) or transcode times out
Cause: ffmpeg transcode takes longer than Gunicorn worker timeout.

Fix:

1. Ensure backend service uses `--timeout 900`.
2. Ensure Nginx has:
   - `client_max_body_size 2G;`
   - `proxy_read_timeout 900;`
   - `proxy_send_timeout 900;`
3. Add dedicated upload location:
   - `location /api/admin/upload-video/ { ... }`
   - `proxy_request_buffering off;`
   - `proxy_buffering off;`
   - `proxy_read_timeout 3600;`
   - `proxy_send_timeout 3600;`
4. Ensure ffmpeg exists:

```bash
which ffmpeg
which ffprobe
```

5. Ensure media write permission:

```bash
cd ~/merxylab/backend
mkdir -p media
chmod -R 775 media
chown -R ubuntu:www-data media
```

6. Reload services:

```bash
sudo systemctl daemon-reload
sudo systemctl restart merxylab-backend
sudo nginx -t
sudo systemctl reload nginx
```

7. Upload using domain URL only:
   - `https://teaching.merxy.club/admin-ui`

Note: `curl http://127.0.0.1/api/...` may return `404` because Nginx server block is domain-based (`server_name teaching.merxy.club`).

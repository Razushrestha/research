# Deploy on Linux VPS (Docker + Nginx)

This guide runs API + PostgreSQL on a Linux VPS using Docker Compose, with Nginx reverse proxy and HTTPS.

## 1) Prepare server

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git ufw nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker
sudo systemctl enable --now nginx
```

Optional firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

## 2) Upload project and configure env

```bash
git clone <your-repo-url> app
cd app
cp .env.vps.example .env.vps
nano .env.vps
```

Set strong values for:
- `POSTGRES_PASSWORD`
- `KHALTI_SECRET_KEY`
- `PLATFORM_ADMIN_EMAIL`
- `CORS_ORIGIN`
- `KHALTI_RETURN_URL`
- `API_DOMAIN`

## 3) Start services

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

Check status:

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml ps
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f api
```

The API container runs `npm run migrate` before startup, so table creation stays up to date.

## 4) Configure Nginx reverse proxy

```bash
source .env.vps
sudo cp deploy/nginx/research-api.conf /etc/nginx/sites-available/research-api.conf
sudo sed -i "s/api\.your-domain\.com/${API_DOMAIN}/g" /etc/nginx/sites-available/research-api.conf
sudo ln -sf /etc/nginx/sites-available/research-api.conf /etc/nginx/sites-enabled/research-api.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 5) Enable HTTPS (Let's Encrypt)

Make sure your DNS `A` record points to the VPS first.

```bash
source .env.vps
sudo certbot --nginx -d "$API_DOMAIN" --redirect -m you@your-domain.com --agree-tos --no-eff-email
```

## 6) Verify endpoints

```bash
source .env.vps
curl "https://${API_DOMAIN}/health"
curl "https://${API_DOMAIN}/"
```

## 7) Updates / redeploy

```bash
git pull
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
sudo systemctl reload nginx
```

## 8) Backup database

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

## Notes

- API listens on `127.0.0.1:4000` and is reachable publicly through Nginx only.
- `db` is not exposed publicly in `docker-compose.vps.yml`.
- Uploaded PDFs are persisted in Docker volume `uploads_data`.
- Certbot auto-renew timer is installed by default on Ubuntu; test with `sudo certbot renew --dry-run`.

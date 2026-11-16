# WhatsApp Campaign Studio — Client Handoff & Deployment Guide

This guide explains how to deploy and hand off **WhatsApp Campaign Studio** so your client can use it over the web (via public URL/domain) without needing to run it on `localhost`.

---

## 🌐 Production Cloud Deployment (Recommended)

To allow the client to access the dashboard 24/7 from anywhere via a web link (e.g. `https://wa.clientcompany.com`):

### 1. Recommended Server Specs
* **Provider:** DigitalOcean (Droplet), Hetzner, AWS (Lightsail/EC2), or Linode.
* **OS:** Ubuntu 22.04 LTS or 24.04 LTS.
* **RAM:** 2 GB RAM (for 2–4 accounts) or 4 GB RAM (for 5–10 accounts).
* **Storage:** 25 GB SSD.

### 2. Server Installation Commands
Run these commands on the Ubuntu server:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js (v20 LTS) & Chromium dependencies
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs chromium-browser git

# Install PM2 process manager (keeps the server running 24/7)
sudo npm install -g pm2
```

### 3. Deploy the Project
Upload the project files (or unzip `whatsapp-automation.zip`) to `/var/www/whatsapp-automation`:

```bash
cd /var/www/whatsapp-automation

# Install project dependencies
npm install

# Start the dashboard with PM2
pm2 start server.js --name "whatsapp-dashboard"

# Configure PM2 to auto-start on server reboot
pm2 startup
pm2 save
```

### 4. Setup Custom Domain & Free SSL (Nginx + Certbot)
```bash
# Install Nginx and Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create Nginx site config `/etc/nginx/sites-available/whatsapp-dashboard`:
```nginx
server {
    server_name wa.clientcompany.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 60M;
    }
}
```

Enable site and generate free HTTPS certificate:
```bash
sudo ln -s /etc/nginx/sites-available/whatsapp-dashboard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
sudo certbot --nginx -d wa.clientcompany.com
```

Your client can now open **`https://wa.clientcompany.com`** securely from any device.

---

## 🐳 Docker Deployment (Alternative)

If using Docker or platforms like Railway / Render:

### `Dockerfile`
```dockerfile
FROM node:20-slim

# Install latest Chromium and required dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 💻 Local Testing & Verification

If testing on your local machine:
* **Option A:** Double-click [`start.bat`](start.bat).
* **Option B:** Run `npm install` then `node server.js` and open `http://localhost:3000`.


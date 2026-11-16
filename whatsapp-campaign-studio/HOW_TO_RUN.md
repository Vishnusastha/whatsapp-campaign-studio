# WhatsApp Campaign Studio — Setup Guide

A multi-account WhatsApp marketing & automation dashboard engineered for high-throughput, ban-resilient bulk messaging with authentic WhatsApp Web aesthetics.

---

## ⚡ Quick Start: How to Run on Your Laptop

### Option 1 (1-Click Desktop Icon — Recommended)
* Look at your Windows Desktop and double-click the green **WhatsApp Campaign Studio** icon!
* Or inside this folder, double-click **`Launch WhatsApp Campaign Studio.lnk`**!
* It automatically starts the server and immediately opens **`http://localhost:3000`** in your default web browser.
* *(If the icon is ever missing from your Desktop, just double-click **`Create-Desktop-Icon.bat`**)*.

### Option 2 (Double-Click Batch File)
* Double-click **`start.bat`** directly in this folder.
* It verifies Node.js, installs any missing packages, starts the dashboard, and launches your browser.

### Option 3 (Manual Terminal)
```bash
# 1. Install dependencies (first time only)
npm install

# 2. Start the dashboard server
node server.js

# 3. Open your browser:
# http://localhost:3000
```

### Option 4 (Interactive Showcase / Demo Mode)
```bash
# Evaluate the dashboard with virtual accounts & simulated dispatch (no WhatsApp account required)
npm run demo
# or: node server.js --demo
```

---

## 🚀 Key Features

* **1-Click Desktop Icon:** Custom green WhatsApp Campaign Studio icon with megaphone broadcast branding.
* **Start Parallel Campaign:** Recipient queues are automatically partitioned across all active accounts so everyone broadcasts simultaneously.
* **Permanent Session Persistence:** Logged-in accounts stay logged in across restarts, reboots, and browser re-opens until explicitly logged out.
* **Rolling 24-Hour Quota Guard:** 200 msgs/24h per account with automatic rolling countdown resets.
* **Intelligent Message Composer:** `{name}`, `{phone}`, `{custom}`, `{link}` Call-to-Action button tags, and anti-ban Spintax `{Hello|Hi|Greetings}`.
* **Universal Media & Document Attachments:** Broadcast PDF documents (`.pdf`), high-resolution photos, and video attachments (MP4, MKV, MOV, WebM, 3GP) with instant previews.
* **Universal Contact Importer:** Direct import from PDF, Excel (`.xlsx`, `.xls`), TSV, CSV, and plain text.
* **Authentic WhatsApp Palette:** Official WhatsApp Web dark/light themes.

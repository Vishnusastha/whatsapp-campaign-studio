/**
 * ============================================================================
 * WhatsApp Campaign Studio (Showcase Edition)
 *
 * Multi-Account WhatsApp Marketing & Automated Campaign Engine
 * Engineered for High-Throughput, Ban-Resilient Bulk Messaging
 *
 * Author: Austin / TRINOVA
 * Copyright (c) 2026. All Rights Reserved.
 *
 * NOTICE: This source code is made available strictly for portfolio review,
 * demonstration, and architectural evaluation purposes. Commercial use,
 * unauthorized distribution, or SaaS deployment is strictly prohibited.
 * See LICENSE for details.
 * ============================================================================
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const QRCode = require('qrcode');

// Dynamic WhatsApp Web Engine loader (supports installed npm package or local fallback)
let Client, LocalAuth, MessageMedia;
try {
    const wweb = require('whatsapp-web.js');
    Client = wweb.Client;
    LocalAuth = wweb.LocalAuth;
    MessageMedia = wweb.MessageMedia;
} catch (e) {
    try {
        const local = require('./index');
        Client = local.Client;
        LocalAuth = local.LocalAuth;
        MessageMedia = local.MessageMedia;
    } catch (err) {
        // Resolved at runtime if module is not yet installed
    }
}

const IS_DEMO_MODE = process.env.DEMO_MODE === 'true' || process.argv.includes('--demo');

const app = express();
const PORT = process.env.PORT || 3000;

// Increase JSON body size limit to handle base64-encoded images and videos (up to ~70MB payloads)
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Route for Accounts view direct access
app.get('/accounts', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route for Reports view direct access
app.get('/reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// CAMPAIGN HISTORY & REPORTS PERSISTENCE
// ─────────────────────────────────────────────
const CAMPAIGN_HISTORY_FILE = path.join(__dirname, 'campaign_history.json');
let campaignHistoryCache = null;

function loadCampaignHistory() {
    try {
        if (fs.existsSync(CAMPAIGN_HISTORY_FILE)) {
            const raw = fs.readFileSync(CAMPAIGN_HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[History] Could not read campaign history:', e.message);
    }
    return [];
}

function saveCampaignHistory(history) {
    try {
        fs.writeFileSync(CAMPAIGN_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.warn('[History] Could not save campaign history:', e.message);
    }
}

// ─────────────────────────────────────────────
// ROLLING 24-HOUR QUOTA LIMIT (200 messages / account / 24hrs)
// Quota resets strictly 24 hours after an account's first dispatch started.
// ─────────────────────────────────────────────
const DAILY_LIMIT_PER_ACCOUNT = 200;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMITS_FILE = path.join(__dirname, 'daily_limits.json');
const ACCOUNTS_REGISTRY_FILE = path.join(__dirname, 'accounts.json');

let quotaStatsCache = null;

function loadQuotaStats() {
    if (quotaStatsCache) return quotaStatsCache;
    try {
        if (fs.existsSync(DAILY_LIMITS_FILE)) {
            const raw = fs.readFileSync(DAILY_LIMITS_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                quotaStatsCache = parsed;
                return quotaStatsCache;
            }
        }
    } catch (e) {
        console.warn('[Quota] Could not read limits file:', e.message);
    }
    quotaStatsCache = {};
    saveQuotaStats(quotaStatsCache);
    return quotaStatsCache;
}

function saveQuotaStats(stats) {
    try {
        fs.writeFileSync(DAILY_LIMITS_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.warn('[Quota] Could not save limits file:', e.message);
    }
}

function formatTimeRemaining(ms) {
    if (!ms || ms <= 0) return '0m';
    const totalMinutes = Math.ceil(ms / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

/**
 * Returns quota details for a given account.
 * Automatically checks if 24 hours have elapsed since firstDispatchAt and resets if expired.
 */
function getAccountQuotaState(accountId) {
    const stats = loadQuotaStats();
    let accData = stats[accountId];
    if (!accData || typeof accData !== 'object' || accData.sentCount === undefined) {
        accData = { firstDispatchAt: null, sentCount: 0 };
        stats[accountId] = accData;
    }

    const now = Date.now();
    // Check if 24 hours have elapsed since the first dispatch started
    if (accData.firstDispatchAt && (now - accData.firstDispatchAt >= TWENTY_FOUR_HOURS_MS)) {
        accData.firstDispatchAt = null;
        accData.sentCount = 0;
        saveQuotaStats(stats);
    }

    const sent = Number(accData.sentCount) || 0;
    const remainingQuota = Math.max(0, DAILY_LIMIT_PER_ACCOUNT - sent);
    let resetInMs = null;
    let resetAt = null;

    if (accData.firstDispatchAt) {
        resetAt = accData.firstDispatchAt + TWENTY_FOUR_HOURS_MS;
        resetInMs = Math.max(0, resetAt - now);
    }

    return {
        sentCount: sent,
        limit: DAILY_LIMIT_PER_ACCOUNT,
        remainingQuota,
        firstDispatchAt: accData.firstDispatchAt,
        resetAt,
        resetInMs,
        isQuotaReached: sent >= DAILY_LIMIT_PER_ACCOUNT,
    };
}

function getAccountDailySent(accountId) {
    return getAccountQuotaState(accountId).sentCount;
}

function incrementAccountDailySent(accountId) {
    const stats = loadQuotaStats();
    let accData = stats[accountId];
    if (!accData || typeof accData !== 'object') {
        accData = { firstDispatchAt: null, sentCount: 0 };
        stats[accountId] = accData;
    }

    const now = Date.now();
    // If 24h window expired or hasn't started yet, initiate the 24-hour clock now
    if (!accData.firstDispatchAt || (now - accData.firstDispatchAt >= TWENTY_FOUR_HOURS_MS)) {
        accData.firstDispatchAt = now;
        accData.sentCount = 0;
    }

    accData.sentCount = (Number(accData.sentCount) || 0) + 1;
    saveQuotaStats(stats);
    return accData.sentCount;
}

// ─────────────────────────────────────────────
// ACCOUNTS (multi-account support with permanent session persistence)
// ─────────────────────────────────────────────
// accounts map: id → { id, label, client, status, userInfo, qrDataUrl }
const accounts = new Map();

function saveAccountsRegistry() {
    try {
        const list = [];
        for (const [id, acc] of accounts) {
            list.push({
                id: acc.id,
                label: acc.label,
                userInfo: acc.userInfo || null,
                status: acc.status === 'CONNECTED' ? 'CONNECTED' : (acc.status || 'DISCONNECTED')
            });
        }
        fs.writeFileSync(ACCOUNTS_REGISTRY_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
        console.warn('[AccountsRegistry] Could not save registry:', e.message);
    }
}

function loadAccountsRegistry() {
    try {
        if (fs.existsSync(ACCOUNTS_REGISTRY_FILE)) {
            const data = JSON.parse(fs.readFileSync(ACCOUNTS_REGISTRY_FILE, 'utf8'));
            if (Array.isArray(data)) {
                data.forEach(a => {
                    if (a && a.id && a.label && !accounts.has(a.id)) {
                        accounts.set(a.id, {
                            id: a.id,
                            label: a.label,
                            client: null,
                            status: 'INITIALIZING',
                            userInfo: a.userInfo || null,
                            qrDataUrl: null,
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn('[AccountsRegistry] Could not load registry:', e.message);
    }

    // If running in Showcase/Demo mode and registry is empty, populate virtual showcase accounts
    if (IS_DEMO_MODE && accounts.size === 0) {
        const demoAccounts = [
            { id: 'demo-fleet-1', label: 'Marketing Fleet Alpha', pushname: 'Fleet Alpha', phone: '+1 (555) 019-2041' },
            { id: 'demo-fleet-2', label: 'Client Outreach Beta', pushname: 'Outreach Beta', phone: '+1 (555) 019-3052' },
            { id: 'demo-fleet-3', label: 'VIP Broadcast Gamma', pushname: 'VIP Dispatch', phone: '+1 (555) 019-4063' }
        ];
        demoAccounts.forEach(d => {
            accounts.set(d.id, {
                id: d.id,
                label: d.label,
                client: null,
                status: 'CONNECTED',
                userInfo: { pushname: d.pushname, number: d.phone, platform: 'Showcase Sandbox' },
                qrDataUrl: null,
                isDemo: true
            });
        });
        saveAccountsRegistry();
    }

    // If accounts.json is empty, restore up to 2 most recent authenticated sessions from .wwebjs_auth
    if (accounts.size === 0) {
        try {
            const authBase = path.join(__dirname, '.wwebjs_auth');
            if (fs.existsSync(authBase)) {
                const dirs = fs.readdirSync(authBase);
                const sessionDirs = dirs
                    .filter(d => d.startsWith('session-acc-'))
                    .map(d => {
                        const full = path.join(authBase, d);
                        return {
                            name: d,
                            full,
                            mtime: fs.statSync(full).mtimeMs,
                            hasLevelDb: fs.existsSync(path.join(full, 'Default', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb'))
                        };
                    })
                    .filter(item => item.hasLevelDb)
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, 2);

                sessionDirs.forEach((item, idx) => {
                    const clientId = item.name.replace(/^session-/, '');
                    accounts.set(clientId, {
                        id: clientId,
                        label: `WhatsApp Account ${idx + 1}`,
                        client: null,
                        status: 'INITIALIZING',
                        userInfo: null,
                        qrDataUrl: null,
                    });
                    console.log(`[AccountsRegistry] Restored active session ${clientId} as WhatsApp Account ${idx + 1}`);
                });
                if (sessionDirs.length > 0) {
                    saveAccountsRegistry();
                }
            }
        } catch (e) {
            console.warn('[AccountsRegistry] Session discovery warning:', e.message);
        }
    }
}

function autoConnectAccounts() {
    let delay = 600;
    for (const [id, acc] of accounts) {
        const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-${id}`);
        const hasSession = fs.existsSync(path.join(sessionDir, 'Default'));
        if (hasSession || acc.status === 'CONNECTED' || acc.userInfo) {
            acc.status = 'INITIALIZING';
            setTimeout(() => {
                if (accounts.has(id) && acc.status !== 'CONNECTED' && !acc._isInitializing) {
                    console.log(`[AutoConnect] Restoring session for account "${acc.label}" (${id})...`);
                    initAccount(id);
                }
            }, delay);
            delay += 2500;
        }
    }
    broadcastAccounts();
}

function cleanupStalePuppeteer(clientId) {
    try {
        if (process.platform === 'win32') {
            const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe'\\" | Where-Object { \\$_.CommandLine -like '*session-${clientId}*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
            execSync(cmd, { stdio: 'ignore' });
        }
    } catch { /* ignore */ }

    try {
        const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-${clientId}`);
        // Only remove Chrome lock and socket files; never delete credentials, cookies, or databases
        ['SingletonLock', 'SingletonSocket', 'DevToolsActivePort'].forEach((file) => {
            const p = path.join(sessionDir, file);
            if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
        });
    } catch {}
}

// Process safety handlers
process.on('unhandledRejection', (reason) => {
    console.warn('[Server] Unhandled rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception:', err?.message || err);
});

// ─────────────────────────────────────────────
// SSE
// ─────────────────────────────────────────────
let sseClients = [];

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach((res) => { try { res.write(payload); } catch {} });
}

// ─────────────────────────────────────────────
// CAMPAIGN STATE
// ─────────────────────────────────────────────
let campaign = {
    running: false,
    paused: false,
    shouldStop: false,
    queue: [],
    currentIndex: 0,
    total: 0,
    successful: 0,
    failed: 0,
    logs: [],
};

// Map of accountId -> { id, label, state, currentRecipient, delayRemaining, sentCount, failCount }
let workerStatus = {};

function addLog(message, type = 'info') {
    const logItem = {
        id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString(),
        message,
        type,
    };
    campaign.logs.unshift(logItem);
    if (campaign.logs.length > 200) campaign.logs.pop();
    broadcast('log', logItem);
    console.log(`[${logItem.time}] [${type.toUpperCase()}] ${message}`);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function formatLinkButton(text) {
    if (!text) return '';

    // Matches: {link:https://example.com|View More} or {link:https://example.com} or {link|https://example.com|View More}
    let formatted = text.replace(/\{link[:|\s]+([^}|]+)(?:\|([^}]+))?\}/gi, (match, url, title) => {
        let cleanUrl = (url || '').trim();
        let buttonTitle = (title || '').trim() || 'View More';
        if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
            cleanUrl = 'https://' + cleanUrl;
        }
        if (!cleanUrl) return '';
        return `\n\n👉 *[ ${buttonTitle} ]*\n${cleanUrl}`;
    });

    // Matches bare {link} followed by a URL: {link} https://...
    formatted = formatted.replace(/\{link\}\s*(https?:\/\/[^\s]+)/gi, (match, url) => {
        return `\n\n👉 *[ View More ]*\n${url.trim()}`;
    });

    // Clean up empty bare {link} if left without URL
    formatted = formatted.replace(/\{link\}/gi, '');

    return formatted;
}

function resolveSpintax(text) {
    if (!text) return '';
    let hasSpintax = true;
    let iterations = 0;
    while (hasSpintax && iterations < 20) {
        iterations++;
        hasSpintax = false;
        text = text.replace(/\{([^{}]+)\}/g, (match, inner) => {
            const trimmed = inner.trim();
            if (/^(name|phone|custom)$/i.test(trimmed) || /^link[:|\s]/i.test(trimmed) || /^link$/i.test(trimmed)) {
                return match;
            }
            if (inner.includes('|')) {
                hasSpintax = true;
                const choices = inner.split('|');
                return choices[Math.floor(Math.random() * choices.length)];
            }
            return match;
        });
    }
    return text;
}

function personalizeMessage(template, recipient) {
    let msg = template || (recipient && recipient.customMessage) || '';
    const safeRecipient = recipient || {};
    msg = msg.replace(/{name}/gi, safeRecipient.name || 'Friend');
    msg = msg.replace(/{phone}/gi, safeRecipient.phone || '');
    msg = msg.replace(/{custom}/gi, safeRecipient.custom || '');
    msg = resolveSpintax(msg);
    msg = formatLinkButton(msg);
    return msg.trim();
}

function getRandomDelay(minSec, maxSec) {
    const min = Math.max(1, Number(minSec) || 3);
    const max = Math.max(min, Number(maxSec) || 10);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getAccountsSnapshot() {
    const list = [];
    for (const [id, acc] of accounts) {
        const q = getAccountQuotaState(acc.id);
        list.push({
            id: acc.id,
            label: acc.label,
            status: acc.status,
            userInfo: acc.userInfo,
            hasQr: !!acc.qrDataUrl,
            dailySent: q.sentCount,
            dailyLimit: q.limit,
            remainingQuota: q.remainingQuota,
            firstDispatchAt: q.firstDispatchAt,
            resetAt: q.resetAt,
            resetInMs: q.resetInMs,
            isQuotaReached: q.isQuotaReached,
        });
    }
    return list;
}

function broadcastAccounts() {
    broadcast('accounts', getAccountsSnapshot());
}

// ─────────────────────────────────────────────
// WHATSAPP CLIENT PER ACCOUNT
// ─────────────────────────────────────────────
async function initAccount(accountId) {
    const acc = accounts.get(accountId);
    if (!acc) return;

    if (acc._isInitializing) {
        addLog(`[${acc.label}] Initialization already in progress, please wait...`, 'info');
        return;
    }
    acc._isInitializing = true;

    // Showcase / Demo mode virtual connection
    if (IS_DEMO_MODE || acc.isDemo) {
        acc._isInitializing = false;
        acc.status = 'CONNECTED';
        acc.userInfo = acc.userInfo || { pushname: acc.label, number: '+1 (555) 019-0000', platform: 'Showcase Simulator' };
        saveAccountsRegistry();
        broadcastAccounts();
        addLog(`[${acc.label}] [SHOWCASE] Connected virtual session for interactive evaluation.`, 'success');
        return;
    }

    if (!Client) {
        acc._isInitializing = false;
        acc.status = 'DISCONNECTED';
        broadcastAccounts();
        addLog(`[${acc.label}] whatsapp-web.js module is not loaded. Please run 'npm install' or run with '--demo' for showcase evaluation.`, 'error');
        return;
    }

    cleanupStalePuppeteer(accountId);

    if (acc.client) {
        try { await acc.client.destroy(); } catch {}
        acc.client = null;
    }

    acc.status = 'INITIALIZING';
    acc.qrDataUrl = null;
    // Keep existing acc.userInfo so account details remain visible during session reconnection
    broadcastAccounts();
    addLog(`[${acc.label}] Starting WhatsApp client...`, 'info');

    let client = null;
    try {
        // Clean up stale Chromium lockfile if left behind by abrupt process stop
        try {
            const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-${accountId}`);
            const lockFilePath = path.join(sessionPath, 'lockfile');
            if (fs.existsSync(lockFilePath)) {
                fs.unlinkSync(lockFilePath);
                console.log(`[Init] Removed stale lockfile for ${accountId}`);
            }
        } catch (e) { /* ignore */ }

        client = new Client({
            authStrategy: new LocalAuth({
                dataPath: path.join(__dirname, '.wwebjs_auth'),
                clientId: accountId,
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1030410331-alpha.html',
                strict: false,
            },
            takeoverOnConflict: true,
            takeoverTimeoutMs: 0,
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-site-isolation-trials',
                    '--disable-renderer-backgrounding',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-ipc-flooding-protection',
                ],
            },
        });

        acc.client = client;

        client.on('qr', async (qr) => {
            acc.status = 'QR_READY';
            try {
                acc.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
                broadcast('account_qr', { id: accountId, qrDataUrl: acc.qrDataUrl });
                addLog(`[${acc.label}] QR code ready. Please scan.`, 'info');
            } catch (err) {
                addLog(`[${acc.label}] Failed to generate QR: ${err.message}`, 'error');
            }
            broadcastAccounts();
        });

        client.on('authenticated', () => {
            acc.status = 'AUTHENTICATED';
            acc.qrDataUrl = null;
            broadcastAccounts();
            addLog(`[${acc.label}] Authenticated! Restoring session state...`, 'success');
        });

        client.on('auth_failure', (msg) => {
            acc._isInitializing = false;
            acc.status = 'DISCONNECTED';
            acc.qrDataUrl = null;
            acc.userInfo = null;
            saveAccountsRegistry();
            broadcastAccounts();
            addLog(`[${acc.label}] Auth failed: ${msg}. Scan QR code to re-authenticate.`, 'error');
        });

        client.on('ready', async () => {
            acc._isInitializing = false;
            acc.qrDataUrl = null;
            try {
                acc.userInfo = {
                    pushname: client.info.pushname || 'User',
                    number: client.info.wid?.user || '',
                    platform: client.info.platform || 'WhatsApp Web',
                };
            } catch {
                acc.userInfo = acc.userInfo || { pushname: 'Connected Account', number: '' };
            }
            acc.status = 'CONNECTED';
            acc.client = client;
            saveAccountsRegistry();
            broadcastAccounts();
            addLog(`[${acc.label}] Connected as ${acc.userInfo.pushname} (${acc.userInfo.number})`, 'success');
        });

        client.on('disconnected', (reason) => {
            acc._isInitializing = false;
            acc.qrDataUrl = null;
            acc.client = null;

            if (reason === 'LOGOUT') {
                acc.status = 'DISCONNECTED';
                acc.userInfo = null;
                saveAccountsRegistry();
                broadcastAccounts();
                addLog(`[${acc.label}] Logged out from WhatsApp.`, 'warning');
            } else {
                // Network drop, browser restart, or server restart -> auto-reconnect!
                acc.status = 'INITIALIZING';
                broadcastAccounts();
                addLog(`[${acc.label}] Disconnected (${reason}). Reconnecting session automatically in 4s...`, 'info');
                setTimeout(() => {
                    if (accounts.has(acc.id) && acc.status !== 'CONNECTED' && !acc._isInitializing) {
                        initAccount(acc.id);
                    }
                }, 4000);
            }
        });

        await client.initialize();
    } catch (err) {
        acc._isInitializing = false;
        if (acc.client === client) {
            acc.status = 'DISCONNECTED';
            acc.client = null;
        }
        broadcastAccounts();
        addLog(`[${acc.label}] Error: ${err.message}`, 'error');
    }
}

// ─────────────────────────────────────────────
// CAMPAIGN WORKER (Parallel Independent Workers)
// ─────────────────────────────────────────────
// mediaData: { mimetype, data (base64, no prefix), filename } | null
async function runCampaign(recipients, template, minDelay, maxDelay, mediaData, sendMode = 'image_caption', dispatchMode = 'parallel', campaignName = null) {
    const cleanQueue = (recipients || []).map(r => ({
        ...r,
        phone: (r.phone || '').toString().replace(/\D/g, '')
    })).filter(r => r.phone && r.phone.length >= 7);

    const history = loadCampaignHistory();
    const finalCampaignName = (campaignName && campaignName.trim()) ? campaignName.trim() : `Campaign ${history.length + 1}`;
    const startTime = new Date();

    campaign.running = true;
    campaign.paused = false;
    campaign.shouldStop = false;
    campaign.queue = cleanQueue;
    campaign.total = cleanQueue.length;
    campaign.currentIndex = 0;
    campaign.successful = 0;
    campaign.failed = 0;
    campaign.dispatchMode = dispatchMode;
    workerStatus = {};

    const hasMedia = !!(mediaData && mediaData.data && mediaData.mimetype);

    // Build pre-constructed MessageMedia once (same media for all recipients)
    let messageMedia = null;
    if (hasMedia) {
        try {
            const isVideo = mediaData.mimetype && mediaData.mimetype.startsWith('video/');
            const isPdf = (mediaData.mimetype === 'application/pdf') || (mediaData.filename && mediaData.filename.toLowerCase().endsWith('.pdf'));
            const fallbackName = isVideo ? 'video.mp4' : (isPdf ? 'document.pdf' : 'image.jpg');
            messageMedia = new MessageMedia(
                mediaData.mimetype,
                mediaData.data,         // pure base64, no data-url prefix
                mediaData.filename || fallbackName
            );
        } catch (err) {
            addLog(`Failed to load media payload: ${err.message}`, 'error');
            campaign.running = false;
            broadcast('campaign_update', getCampaignStatus());
            return;
        }
    }

    // Collect all active and connected accounts (supports real clients and showcase virtual accounts)
    const workerAccounts = [];
    for (const [, acc] of accounts) {
        if ((acc.status === 'CONNECTED' && acc.client) || (IS_DEMO_MODE && acc.status === 'CONNECTED')) {
            workerAccounts.push(acc);
        }
    }

    if (workerAccounts.length === 0) {
        addLog('No active WhatsApp accounts available for campaign.', 'error');
        campaign.running = false;
        broadcast('campaign_update', getCampaignStatus());
        return;
    }

    const isVideoMedia = hasMedia && mediaData.mimetype && mediaData.mimetype.startsWith('video/');
    const isPdfMedia = hasMedia && (mediaData.mimetype === 'application/pdf' || (mediaData.filename && mediaData.filename.toLowerCase().endsWith('.pdf')));
    const mediaLabel = isVideoMedia ? 'Video' : (isPdfMedia ? 'PDF Document' : 'Image');
    const isSeparateMode = (sendMode === 'image_then_text' || sendMode === 'media_then_text');
    const modeLabel = hasMedia
        ? (isSeparateMode ? `${mediaLabel} + Separate Text` : `${mediaLabel} with Caption`)
        : 'Text only';

    // Filter active workers who have daily quota remaining
    const eligibleWorkers = workerAccounts.filter(acc => getAccountDailySent(acc.id) < DAILY_LIMIT_PER_ACCOUNT);
    if (eligibleWorkers.length === 0) {
        addLog(`Cannot dispatch: All ${workerAccounts.length} active account(s) have reached their daily limit of ${DAILY_LIMIT_PER_ACCOUNT} messages for today. Quota resets tomorrow.`, 'error');
        campaign.running = false;
        broadcast('campaign_update', getCampaignStatus());
        return;
    }

    const totalFleetLimit = workerAccounts.length * DAILY_LIMIT_PER_ACCOUNT;
    const totalDailySentSoFar = workerAccounts.reduce((sum, a) => sum + getAccountDailySent(a.id), 0);
    const totalRemainingQuota = Math.max(0, totalFleetLimit - totalDailySentSoFar);

    // ── Dedicated Partitioned Queue per Eligible Worker (Equipartitioning) ──
    const workerQueues = new Map();
    eligibleWorkers.forEach(acc => workerQueues.set(acc.id, []));

    // Distribute messages round-robin across eligible workers
    // (e.g., 20 messages with 5 accounts -> each account gets exactly 4 messages)
    campaign.queue.forEach((recipient, idx) => {
        const assignedWorker = eligibleWorkers[idx % eligibleWorkers.length];
        recipient.workerLabel = assignedWorker.label;
        workerQueues.get(assignedWorker.id).push({
            recipient,
            index: idx + 1,
            partitionIndex: workerQueues.get(assignedWorker.id).length + 1,
        });
    });

    const partitionBreakdown = eligibleWorkers
        .map(acc => `${acc.label}: ${workerQueues.get(acc.id).length} msg(s)`)
        .join(', ');

    addLog(
        `Campaign started: ${campaign.total} recipients divided equally across ${eligibleWorkers.length} account(s) (${partitionBreakdown}). Parallel dispatch active. Mode: ${modeLabel}.`,
        'info'
    );

    // Initialize worker status and log queue partition per account
    workerAccounts.forEach(acc => {
        const q = getAccountQuotaState(acc.id);
        const hasQuota = !q.isQuotaReached;
        const myQueue = workerQueues.get(acc.id) || [];

        workerStatus[acc.id] = {
            id: acc.id,
            label: acc.label,
            state: hasQuota ? (myQueue.length > 0 ? 'IDLE' : 'DONE') : 'QUOTA_REACHED',
            currentRecipient: null,
            delayRemaining: 0,
            sentCount: 0,
            failCount: 0,
            assignedCount: myQueue.length,
            dailySent: q.sentCount,
            dailyLimit: DAILY_LIMIT_PER_ACCOUNT,
            resetInMs: q.resetInMs,
        };

        if (!hasQuota) {
            const timeStr = formatTimeRemaining(q.resetInMs);
            addLog(`[${acc.label}] Daily quota of ${DAILY_LIMIT_PER_ACCOUNT} messages reached earlier (${q.sentCount}/${DAILY_LIMIT_PER_ACCOUNT}). Resets in ${timeStr} (24h after first dispatch).`, 'warning');
        }
    });

    broadcast('campaign_update', getCampaignStatus());

    // Independent worker function per account
    async function startAccountWorker(acc) {
        const wState = workerStatus[acc.id];
        const myJobs = workerQueues.get(acc.id) || [];
        const totalAssigned = myJobs.length;

        if (totalAssigned === 0) {
            wState.state = 'DONE';
            broadcast('campaign_update', getCampaignStatus());
            return;
        }

        addLog(`[${acc.label}] Worker thread active: ${totalAssigned} message(s) assigned for parallel dispatch.`, 'info');

        while (!campaign.shouldStop && myJobs.length > 0) {
            // Handle paused state
            while (campaign.paused && !campaign.shouldStop) {
                await new Promise(r => setTimeout(r, 1000));
            }
            if (campaign.shouldStop) break;

            // Enforce rolling 24-hour quota limit (200 msgs/account/24hrs)
            const quotaState = getAccountQuotaState(acc.id);
            if (quotaState.isQuotaReached) {
                wState.state = 'QUOTA_REACHED';
                wState.delayRemaining = 0;
                wState.currentRecipient = null;
                const timeStr = formatTimeRemaining(quotaState.resetInMs);
                addLog(`[${acc.label}] Quota limit of ${DAILY_LIMIT_PER_ACCOUNT} messages reached. Resets in ${timeStr} (24h after first dispatch). Dispatch halted for this account.`, 'warning');
                broadcast('campaign_update', getCampaignStatus());
                broadcastAccounts();
                break;
            }

            const job = myJobs.shift();
            if (!job) break; // no more contacts

            const { recipient, index, partitionIndex } = job;
            const recipientLabel = recipient.name || recipient.phone;
            wState.currentRecipient = recipientLabel;
            wState.state = 'WAITING';

            // Independent random countdown for THIS account only
            const delaySec = getRandomDelay(minDelay, maxDelay);
            wState.delayRemaining = delaySec;

            addLog(`[${acc.label}] Rate-limit interval: ${delaySec}s before dispatching [${partitionIndex}/${totalAssigned}] to ${recipientLabel} (24h progress: ${quotaState.sentCount}/${DAILY_LIMIT_PER_ACCOUNT})...`, 'info');
            broadcast('campaign_update', getCampaignStatus());

            for (let s = delaySec; s > 0; s--) {
                if (campaign.shouldStop) break;
                while (campaign.paused && !campaign.shouldStop) {
                    await new Promise(r => setTimeout(r, 1000));
                }
                wState.delayRemaining = s;
                broadcast('campaign_update', getCampaignStatus());
                await new Promise(r => setTimeout(r, 1000));
            }

            if (campaign.shouldStop) break;

            // Worker sends message
            wState.state = 'SENDING';
            wState.delayRemaining = 0;
            broadcast('campaign_update', getCampaignStatus());

            try {
                let cleanPhone = (recipient.phone || '').toString().replace(/\D/g, '');
                if (!cleanPhone || cleanPhone.length < 7) {
                    throw new Error(`Invalid phone number: "${recipient.phone}"`);
                }

                // Interactive Showcase Demo Mode simulation
                if (IS_DEMO_MODE || acc.isDemo) {
                    await new Promise(r => setTimeout(r, 600));
                    const finalMessage = personalizeMessage(template, recipient);
                    recipient.finalMessage = finalMessage;
                    recipient.status = 'sent';
                    recipient.sentAt = new Date().toISOString();
                    campaign.sent++;
                    wState.sentCount++;
                    incrementAccountDailySent(acc.id);
                    addLog(`[${acc.label}] [SHOWCASE DEMO] Simulated delivery to ${recipient.phone} (${recipientLabel}): "${finalMessage.substring(0, 45)}..."`, 'success');
                    broadcast('campaign_update', getCampaignStatus());
                    broadcastAccounts();
                    continue;
                }

                // Check page health before dispatch
                if (!acc.client || !acc.client.pupPage || acc.client.pupPage.isClosed()) {
                    throw new Error('WhatsApp client browser page is closed or not available.');
                }

                // Try getNumberId with auto-retry if frame was refreshing
                let numberId = null;
                for (let getAttempt = 1; getAttempt <= 2; getAttempt++) {
                    try {
                        numberId = await acc.client.getNumberId(cleanPhone);
                        if (!numberId && cleanPhone.length === 10 && /^[6-9]/.test(cleanPhone)) {
                            // Auto-resolve missing Indian country code (+91)
                            numberId = await acc.client.getNumberId('91' + cleanPhone);
                            if (numberId) {
                                cleanPhone = '91' + cleanPhone;
                            }
                        }
                        break;
                    } catch (gErr) {
                        if (getAttempt === 1 && gErr.message && (gErr.message.includes('detached Frame') || gErr.message.includes('Execution context was destroyed'))) {
                            addLog(`[${acc.label}] WhatsApp Web frame transient reload, retrying lookup in 2s...`, 'warning');
                            await new Promise(r => setTimeout(r, 2000));
                            continue;
                        }
                        throw gErr;
                    }
                }

                if (!numberId) {
                    throw new Error(`Phone number "${cleanPhone}" is not registered on WhatsApp. (Ensure full country code is included, e.g. 91...)`);
                }

                const finalMessage = personalizeMessage(template, recipient);
                recipient.finalMessage = finalMessage;

                // Send with automatic 1-retry on transient frame reload
                for (let sendAttempt = 1; sendAttempt <= 2; sendAttempt++) {
                    try {
                        if (messageMedia) {
                            const isVideo = mediaData.mimetype && mediaData.mimetype.startsWith('video/');
                            const isPdf = (mediaData.mimetype === 'application/pdf') || (mediaData.filename && mediaData.filename.toLowerCase().endsWith('.pdf'));
                            const mediaTypeLabel = isVideo ? 'Video' : (isPdf ? 'PDF' : 'Image');
                            if (sendMode === 'image_then_text' || sendMode === 'media_then_text') {
                                // Mode: Send media first, then send message as separate bubble
                                await acc.client.sendMessage(numberId._serialized, messageMedia);
                                if (finalMessage) {
                                    await new Promise(r => setTimeout(r, 600));
                                    await acc.client.sendMessage(numberId._serialized, finalMessage, { linkPreview: true });
                                }
                                addLog(
                                    `[${index}/${campaign.total}] [${acc.label}] Delivered (${mediaTypeLabel} then Separate Text) -> ${recipientLabel}${finalMessage ? `: "${finalMessage.substring(0, 30)}..."` : ''}`,
                                    'success'
                                );
                            } else {
                                // Mode: Send media with caption attached
                                const opts = finalMessage ? { caption: finalMessage } : {};
                                await acc.client.sendMessage(numberId._serialized, messageMedia, opts);
                                addLog(
                                    `[${acc.label}] [${partitionIndex}/${totalAssigned}] Delivered (${mediaTypeLabel} with Caption) -> ${recipientLabel}${finalMessage ? `: "${finalMessage.substring(0, 30)}..."` : ''}`,
                                    'success'
                                );
                            }
                        } else {
                            await acc.client.sendMessage(numberId._serialized, finalMessage, { linkPreview: true });
                            addLog(`[${acc.label}] [${partitionIndex}/${totalAssigned}] Delivered -> ${recipientLabel}: "${finalMessage.substring(0, 40)}..."`, 'success');
                        }
                        break;
                    } catch (sErr) {
                        if (sendAttempt === 1 && sErr.message && (sErr.message.includes('detached Frame') || sErr.message.includes('Execution context was destroyed'))) {
                            addLog(`[${acc.label}] WhatsApp Web frame reload detected, retrying send in 2.5s...`, 'warning');
                            await new Promise(r => setTimeout(r, 2500));
                            continue;
                        }
                        throw sErr;
                    }
                }

                campaign.successful++;
                wState.sentCount++;
                recipient.status = 'SENT';
                recipient.workerLabel = acc.label;
                recipient.sentAt = new Date().toISOString();

                // Increment account quota count (starts 24h rolling timer if 1st message)
                incrementAccountDailySent(acc.id);
                const updatedQ = getAccountQuotaState(acc.id);
                wState.dailySent = updatedQ.sentCount;
                wState.resetInMs = updatedQ.resetInMs;
                broadcastAccounts();
            } catch (err) {
                const isDetached = err.message && (
                    err.message.includes('detached Frame') ||
                    err.message.includes('Execution context was destroyed') ||
                    err.message.includes('Target closed') ||
                    err.message.includes('Session closed')
                );

                if (isDetached) {
                    addLog(`[${acc.label}] WhatsApp Web session lost connection (${err.message}). Halting worker to protect remaining contacts. Re-initializing account...`, 'error');
                    // Return this job back to this worker's queue so it is not burned as failed
                    myJobs.unshift(job);
                    wState.state = 'ERROR';
                    setTimeout(() => initAccount(acc.id), 1000);
                    break;
                }

                campaign.failed++;
                wState.failCount++;
                recipient.status = 'FAILED';
                recipient.workerLabel = acc.label;
                recipient.sentAt = new Date().toISOString();
                recipient.error = err.message;
                addLog(`[${acc.label}] [${partitionIndex}/${totalAssigned}] Failed for ${recipientLabel}: ${err.message}`, 'error');
            }

            campaign.currentIndex = campaign.successful + campaign.failed;
            broadcast('campaign_update', getCampaignStatus());
        }

        if (wState.state !== 'QUOTA_REACHED' && wState.state !== 'ERROR') {
            wState.state = 'DONE';
        }
        wState.delayRemaining = 0;
        wState.currentRecipient = null;
        broadcast('campaign_update', getCampaignStatus());
    }

    // Run all eligible account workers concurrently in parallel!
    await Promise.all(eligibleWorkers.map(acc => startAccountWorker(acc)));

    const totalRemainingJobs = Array.from(workerQueues.values()).reduce((sum, q) => sum + q.length, 0);
    campaign.running = false;
    campaign.paused = false;
    campaign.currentIndex = campaign.successful + campaign.failed;

    if (totalRemainingJobs > 0) {
        const allReachedQuota = workerAccounts.every(a => getAccountQuotaState(a.id).isQuotaReached);
        if (allReachedQuota) {
            addLog(`Campaign halted: 24-hour limit of ${DAILY_LIMIT_PER_ACCOUNT} msgs/account reached across all accounts. ${totalRemainingJobs} recipient(s) remain pending. Accounts will unlock 24 hours after their first dispatch.`, 'warning');
        } else {
            addLog(`Campaign stopped with ${totalRemainingJobs} recipient(s) pending.`, 'warning');
        }
    } else {
        addLog(`Campaign completed. Total: ${campaign.total}, Delivered: ${campaign.successful}, Failed: ${campaign.failed}.`, 'success');
    }
    broadcast('campaign_update', getCampaignStatus());

    // Save campaign record to persistent history
    try {
        const endTime = new Date();
        const durationSec = Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
        const rateStr = cleanQueue.length > 0 ? `${Math.round((campaign.successful / cleanQueue.length) * 100)}%` : '0%';

        const activeClientsSummary = workerAccounts.map(a => {
            const ws = workerStatus[a.id] || {};
            return {
                id: a.id,
                label: a.label,
                number: a.userInfo ? a.userInfo.number : null,
                sentCount: ws.sentCount || 0,
                failCount: ws.failCount || 0
            };
        });

        const record = {
            id: `camp-${startTime.getTime()}`,
            name: finalCampaignName,
            startedAt: startTime.toISOString(),
            completedAt: endTime.toISOString(),
            durationSeconds: durationSec,
            status: totalRemainingJobs === 0 ? 'COMPLETED' : (campaign.shouldStop ? 'STOPPED' : 'HALTED'),
            total: cleanQueue.length,
            delivered: campaign.successful,
            failed: campaign.failed,
            pending: totalRemainingJobs,
            deliveryRate: rateStr,
            minDelay: Number(minDelay) || 3,
            maxDelay: Number(maxDelay) || 10,
            template: template || '',
            hasMedia,
            mediaLabel: hasMedia ? mediaLabel : null,
            mediaFilename: hasMedia && mediaData ? (mediaData.filename || null) : null,
            sendMode: modeLabel,
            activeClients: activeClientsSummary,
            recipients: cleanQueue.map(r => ({
                phone: r.phone,
                name: r.name || '',
                custom: r.custom || '',
                status: r.status || (totalRemainingJobs > 0 ? 'PENDING' : 'SKIPPED'),
                workerLabel: r.workerLabel || null,
                sentAt: r.sentAt || null,
                error: r.error || null
            }))
        };

        const currentHistory = loadCampaignHistory();
        currentHistory.unshift(record); // newest first!
        campaignHistoryCache = currentHistory;
        saveCampaignHistory(currentHistory);
        console.log(`[History] Saved report for "${finalCampaignName}" (${record.delivered}/${record.total} delivered).`);
        broadcast('campaign_history_update', currentHistory.map(({ recipients, ...rest }) => rest));
    } catch (histErr) {
        console.error('[History] Failed to save campaign report:', histErr);
    }
}

function getCampaignStatus() {
    const workerList = Object.values(workerStatus).map(w => {
        const q = getAccountQuotaState(w.id);
        return {
            id: w.id,
            label: w.label,
            state: w.state,
            currentRecipient: w.currentRecipient,
            waitRemaining: w.delayRemaining || 0,
            delayRemaining: w.delayRemaining || 0,
            sentCount: w.sentCount || 0,
            failCount: w.failCount || 0,
            assignedCount: w.assignedCount || 0,
            dailySent: q.sentCount,
            dailyLimit: q.limit,
            remainingQuota: q.remainingQuota,
            resetInMs: q.resetInMs,
            resetAt: q.resetAt,
        };
    });

    const connectedAccounts = [...accounts.values()].filter(a => a.status === 'CONNECTED' && a.client);
    const totalDailyLimit = connectedAccounts.length * DAILY_LIMIT_PER_ACCOUNT;
    const totalSentToday = connectedAccounts.reduce((sum, a) => sum + getAccountDailySent(a.id), 0);

    return {
        running: campaign.running,
        paused: campaign.paused,
        status: campaign.running ? (campaign.paused ? 'PAUSED' : 'RUNNING') : (campaign.total > 0 && campaign.currentIndex >= campaign.total ? 'COMPLETED' : 'IDLE'),
        currentIndex: campaign.currentIndex,
        processed: campaign.currentIndex,
        total: campaign.total,
        successful: campaign.successful,
        success: campaign.successful,
        failed: campaign.failed,
        fail: campaign.failed,
        dispatchMode: campaign.dispatchMode || 'parallel',
        dailyLimitPerAccount: DAILY_LIMIT_PER_ACCOUNT,
        fleetDailyLimit: totalDailyLimit,
        fleetDailySent: totalSentToday,
        fleetDailyRemaining: Math.max(0, totalDailyLimit - totalSentToday),
        workers: workerList,
        workerMap: workerStatus,
        recipients: (campaign.queue || []).map(r => ({
            phone: r.phone,
            name: r.name,
            status: r.status || 'PENDING',
            error: r.error || null,
            workerLabel: r.workerLabel || null,
        })),
    };
}

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

// SSE
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);

    // Send initial snapshot
    res.write(`event: accounts\ndata: ${JSON.stringify(getAccountsSnapshot())}\n\n`);
    res.write(`event: campaign_update\ndata: ${JSON.stringify(getCampaignStatus())}\n\n`);

    // Re-send QR codes for any accounts already waiting to be scanned
    for (const [, acc] of accounts) {
        if (acc.qrDataUrl && acc.status === 'QR_READY') {
            res.write(`event: account_qr\ndata: ${JSON.stringify({ id: acc.id, qrDataUrl: acc.qrDataUrl })}\n\n`);
        }
    }

    req.on('close', () => {
        sseClients = sseClients.filter((c) => c !== res);
    });
});

// Get current status
app.get('/api/status', (req, res) => {
    res.json({
        accounts: getAccountsSnapshot(),
        campaign: getCampaignStatus(),
        logs: campaign.logs.slice(0, 50),
    });
});

// ── Account Management ──────────────────────

// List accounts
app.get('/api/accounts', (req, res) => {
    res.json(getAccountsSnapshot());
});

// Add a new account slot
app.post('/api/accounts', (req, res) => {
    const { label } = req.body;
    if (!label || !label.trim()) {
        return res.status(400).json({ error: 'Please provide a label for the account.' });
    }
    const id = `acc-${Date.now()}`;
    accounts.set(id, {
        id,
        label: label.trim(),
        client: null,
        status: 'INITIALIZING',
        userInfo: null,
        qrDataUrl: null,
    });
    saveAccountsRegistry();
    broadcastAccounts();
    initAccount(id);
    res.json({ success: true, id });
});

// Connect (initialize) an account
app.post('/api/accounts/:id/connect', async (req, res) => {
    const acc = accounts.get(req.params.id);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    if (acc.status === 'CONNECTED' || (acc.status === 'INITIALIZING' && acc._isInitializing)) {
        return res.json({ success: true, message: 'Already connected or connecting.' });
    }
    initAccount(acc.id);
    res.json({ success: true, message: 'Initialization started.' });
});

// Disconnect an account (keep session)
app.post('/api/accounts/:id/disconnect', async (req, res) => {
    const acc = accounts.get(req.params.id);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    if (!acc.client) {
        acc.status = 'DISCONNECTED';
        saveAccountsRegistry();
        broadcastAccounts();
        return res.json({ success: true });
    }
    try {
        await acc.client.destroy();
        acc.client = null;
        acc.status = 'DISCONNECTED';
        acc.qrDataUrl = null;
        // Keep acc.userInfo so account identity remains saved across disconnects
        saveAccountsRegistry();
        broadcastAccounts();
        addLog(`[${acc.label}] Paused / Disconnected. (Saved login preserved)`, 'warning');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Logout an account (clears session completely)
app.post('/api/accounts/:id/logout', async (req, res) => {
    const acc = accounts.get(req.params.id);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    try {
        if (acc.client) {
            await acc.client.logout();
            acc.client = null;
        } else {
            const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-${acc.id}`);
            if (fs.existsSync(sessionDir)) {
                try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
            }
        }
        acc.status = 'DISCONNECTED';
        acc.qrDataUrl = null;
        acc.userInfo = null;
        saveAccountsRegistry();
        broadcastAccounts();
        addLog(`[${acc.label}] Logged out. Session data deleted.`, 'warning');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove an account entirely
app.delete('/api/accounts/:id', async (req, res) => {
    const acc = accounts.get(req.params.id);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    try {
        if (acc.client) { try { await acc.client.destroy(); } catch {} }
        const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-${acc.id}`);
        if (fs.existsSync(sessionDir)) {
            try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        }
    } catch {}
    accounts.delete(req.params.id);
    saveAccountsRegistry();
    broadcastAccounts();
    addLog(`Account "${acc.label}" removed.`, 'warning');
    res.json({ success: true });
});

// Get QR for a specific account
app.get('/api/accounts/:id/qr', (req, res) => {
    const acc = accounts.get(req.params.id);
    if (!acc) return res.status(404).json({ error: 'Account not found.' });
    res.json({ qrDataUrl: acc.qrDataUrl || null, status: acc.status });
});

// ── Campaign ─────────────────────────────────

app.post('/api/campaign/start', async (req, res) => {
    // Synchronize accounts: any account with status CONNECTED but missing client is not ready
    for (const [, acc] of accounts) {
        if (acc.status === 'CONNECTED' && !acc.client) {
            acc.status = 'DISCONNECTED';
            acc.userInfo = null;
        }
    }

    const workerAccounts = [...accounts.values()].filter(a => a.status === 'CONNECTED' && a.client);
    if (workerAccounts.length === 0) {
        return res.status(400).json({ error: 'No active WhatsApp accounts available. Please ensure at least one account shows Connected.' });
    }

    // Check rolling 24-hour quota limits across connected accounts
    const accountsWithQuota = workerAccounts.filter(a => !getAccountQuotaState(a.id).isQuotaReached);
    if (accountsWithQuota.length === 0) {
        const resetTimes = workerAccounts
            .map(a => getAccountQuotaState(a.id).resetInMs)
            .filter(ms => ms && ms > 0);
        const earliestMs = resetTimes.length > 0 ? Math.min(...resetTimes) : null;
        const resetStr = earliestMs ? `Earliest unlock in ${formatTimeRemaining(earliestMs)}.` : 'Quotas unlock strictly 24 hours after an account\'s first dispatch started.';

        return res.status(400).json({
            error: `All ${workerAccounts.length} connected account(s) have reached their 24-hour limit of ${DAILY_LIMIT_PER_ACCOUNT} messages. ${resetStr}`
        });
    }

    if (campaign.running) {
        return res.status(400).json({ error: 'A campaign is already running.' });
    }

    const {
        name = null,
        recipients,
        template,
        minDelay = 3,
        maxDelay = 10,
        media = null,
        sendMode = 'image_caption',
        dispatchMode = 'parallel'
    } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'Please provide at least one recipient.' });
    }

    // Sanitize recipients by cleaning international phone numbers
    const sanitizedRecipients = [];
    for (const r of recipients) {
        const cleanPhone = (r.phone || '').toString().replace(/\D/g, '');
        if (!cleanPhone || cleanPhone.length < 7) continue;
        sanitizedRecipients.push({
            ...r,
            phone: cleanPhone,
        });
    }

    if (sanitizedRecipients.length === 0) {
        return res.status(400).json({ error: 'No valid recipient phone numbers provided (minimum 7 digits required).' });
    }

    // Validate media if provided
    if (media) {
        if (!media.mimetype || !media.data) {
            return res.status(400).json({ error: 'Invalid media: mimetype and data (base64) are required.' });
        }
        const supportedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
            'video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/ogg', 'video/mpeg',
            'application/pdf'
        ];
        if (!supportedTypes.includes(media.mimetype)) {
            return res.status(400).json({ error: `Unsupported media type: ${media.mimetype}. Supported: PDF documents (.pdf), Images (JPG, PNG, GIF, WEBP, BMP) & Videos (MP4, 3GP, MOV, WebM, MKV).` });
        }
    }

    const isVideoMedia = media && media.mimetype && media.mimetype.startsWith('video/');
    const isPdfMedia = media && (media.mimetype === 'application/pdf' || (media.filename && media.filename.toLowerCase().endsWith('.pdf')));
    const mediaLabel = isVideoMedia ? 'Video' : (isPdfMedia ? 'PDF Document' : 'Image');
    const isSeparateMode = (sendMode === 'image_then_text' || sendMode === 'media_then_text');
    const modeDesc = media
        ? (isSeparateMode ? `${mediaLabel} then separate text` : `${mediaLabel} with caption`)
        : 'Text message';

    const workerNames = workerAccounts.map(a => a.label).join(', ');
    addLog(`Campaign initialized for ${workerAccounts.length} concurrent account(s) (${workerNames}). Mode: ${modeDesc}. Concurrency: ${dispatchMode.toUpperCase()}.`, 'info');
    if (workerAccounts.length < accounts.size) {
        const inactive = [...accounts.values()].filter(a => a.status !== 'CONNECTED' || !a.client);
        addLog(`Note: ${inactive.map(a => a.label).join(', ')} is currently not connected and will not participate in this run.`, 'warning');
    }
    const totalFleetLimit = workerAccounts.length * DAILY_LIMIT_PER_ACCOUNT;
    const totalSentToday = workerAccounts.reduce((sum, a) => sum + getAccountDailySent(a.id), 0);
    const totalRemaining = Math.max(0, totalFleetLimit - totalSentToday);

    if (sanitizedRecipients.length > totalRemaining) {
        addLog(
            `Notice: Queue contains ${sanitizedRecipients.length} contact(s), but connected fleet only has ${totalRemaining} message(s) left in today's daily limit (${DAILY_LIMIT_PER_ACCOUNT}/account/day). Accounts will pause once quota is reached.`,
            'warning'
        );
    }

    if (media) addLog(`Media attached: ${media.filename || 'image'} (${media.mimetype})`, 'info');
    runCampaign(sanitizedRecipients, template, minDelay, maxDelay, media, sendMode, dispatchMode, name);
    res.json({ success: true, message: 'Campaign started successfully' });
});

app.post('/api/campaign/pause', (req, res) => {
    if (!campaign.running) return res.status(400).json({ error: 'No campaign running' });
    campaign.paused = true;
    addLog('Campaign paused.', 'warning');
    broadcast('campaign_update', getCampaignStatus());
    res.json({ success: true });
});

app.post('/api/campaign/resume', (req, res) => {
    if (!campaign.running) return res.status(400).json({ error: 'No campaign running' });
    campaign.paused = false;
    addLog('Campaign resumed.', 'info');
    broadcast('campaign_update', getCampaignStatus());
    res.json({ success: true });
});

app.post('/api/campaign/stop', (req, res) => {
    if (!campaign.running) return res.status(400).json({ error: 'No campaign running' });
    campaign.shouldStop = true;
    campaign.paused = false;
    addLog('Campaign termination requested.', 'warning');
    broadcast('campaign_update', getCampaignStatus());
    res.json({ success: true });
});

// Preview spintax/personalization
app.post('/api/preview-message', (req, res) => {
    const { template, sampleRecipient } = req.body;
    const personalized = personalizeMessage(template, sampleRecipient || { name: 'Alex', phone: '919876543210' });
    res.json({ preview: personalized });
});

// ── Campaign History & Reports Endpoints ──────────
app.get('/api/campaigns', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const history = loadCampaignHistory();
    // Return summaries (without large recipient lists) for instant snappy list loading
    const summaries = history.map(({ recipients, ...rest }) => ({
        ...rest,
        recipientsCount: recipients ? recipients.length : (rest.total || 0)
    }));
    res.json(summaries);
});

app.get('/api/campaigns/:id', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const history = loadCampaignHistory();
    const found = history.find(c => c.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Campaign record not found' });
    res.json(found);
});

app.delete('/api/campaigns/:id', (req, res) => {
    let history = loadCampaignHistory();
    history = history.filter(c => c.id !== req.params.id);
    campaignHistoryCache = history;
    saveCampaignHistory(history);
    broadcast('campaign_history_update', history.map(({ recipients, ...rest }) => rest));
    res.json({ success: true });
});

app.delete('/api/campaigns', (req, res) => {
    campaignHistoryCache = [];
    saveCampaignHistory([]);
    broadcast('campaign_history_update', []);
    res.json({ success: true });
});

// Parse contacts from uploaded PDF document
app.post('/api/contacts/parse-pdf', async (req, res) => {
    try {
        const { base64Data, fileName } = req.body;
        if (!base64Data) {
            return res.status(400).json({ success: false, error: 'No PDF data provided' });
        }

        const buffer = Buffer.from(base64Data.replace(/^data:application\/pdf;base64,/, ''), 'base64');
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        await parser.load();
        const textResult = await parser.getText();
        await parser.destroy();

        const rawText = (textResult && typeof textResult === 'object' && textResult.text) ? textResult.text : String(textResult || '');
        const lines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

        res.json({
            success: true,
            lines: lines,
            rawText: rawText,
            fileName: fileName || 'document.pdf'
        });
    } catch (err) {
        console.error('[PDF Parser] Error:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to parse PDF' });
    }
});

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN (Cleanly closes Chrome browsers to preserve sessions)
// ─────────────────────────────────────────────
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Server] ${signal} detected: Saving session states and closing browsers cleanly...`);
    saveAccountsRegistry();
    const closeOps = [];
    for (const [, acc] of accounts) {
        if (acc.client) {
            closeOps.push(acc.client.destroy().catch(() => {}));
        }
    }
    await Promise.race([
        Promise.all(closeOps),
        new Promise(r => setTimeout(r, 3000))
    ]);
    console.log('[Server] Browser sessions cleanly saved. Process exit.\n');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ─────────────────────────────────────────────
// STARTUP: Load Registry & Automatically Connect All Saved Sessions
// ─────────────────────────────────────────────
loadAccountsRegistry();

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  WhatsApp Campaign Studio running on:`);
    console.log(`  👉 http://localhost:${PORT}`);
    if (IS_DEMO_MODE) {
        console.log(`  Mode: INTERACTIVE SHOWCASE / DEMO MODE`);
        console.log(`  (Virtual accounts & simulated delivery active)`);
    } else {
        console.log(`  Mode: PRODUCTION LIVE ENGINE`);
    }
    console.log(`======================================================\n`);

    // Auto-connect all accounts that have saved session data
    autoConnectAccounts();
});

/**
 * controls.js - Controls the interface and activation of Pitch Shifter Pro
 * Handles Device ID, key verification, trial mode, and storage of activation.json
 * Sends refreshExtension message to background.js
 * Optimizes key activation and trial mode speed (under 2 seconds) with Web Crypto API
 * Enhanced with stable Device ID, trial mode, and obfuscation
 * Synced Device ID and trial data with chrome.storage.sync
 */

// Configuration
const CONFIG = {
    SECRET: new Uint8Array([0x78, 0x37, 0x6b, 0x39, 0x70, 0x32, 0x6d, 0x34, 0x71, 0x38, 0x77, 0x33, 0x7a, 0x35, 0x74, 0x31, 0x72, 0x36, 0x79, 0x30]), // Obfuscated secret
    CACHE_TIMEOUT: 24 * 60 * 60 * 1000, // Cache verification: 24 hours
    TRIAL_DURATION: 30 * 24 * 60 * 60 * 1000, // 30 days trial
    DEBUG_MODE: location.hostname === "localhost" || location.protocol === "file:" // Chỉ bật debug trong môi trường phát triển
};

// Ánh xạ để hiển thị tên cấu hình âm thanh thân thiện
const profileDisplayNames = {
    warm: 'Warm',
    bright: 'Bright',
    bassHeavy: 'Bass Heavy',
    vocal: 'Vocal',
    proNatural: 'Natural',
    karaokeDynamic: 'Karaoke',
    rockMetal: 'Rock/M',
    smartStudio: 'Smart.S'
};

// Helper function to handle errors
function handleError(errorMessage, error) {
    const errorMsg = error?.message || (error ? JSON.stringify(error, null, 2) : "Không thể làm mới extension");
    console.error(`${errorMessage}: ${errorMsg}`, error?.stack || "");
    showNotification(`Lỗi: ${errorMsg.includes("Tab not found") ? "Tab không tồn tại" : 
                     errorMsg.includes("Tab not active") ? "Tab không hoạt động" : 
                     errorMsg.includes("Tab not fully loaded") ? "Tab chưa tải xong" : 
                     errorMsg.includes("Storage error") ? "Lỗi lưu trữ" : 
                     errorMsg.includes("Failed to inject") ? "Không thể tải extension, vui lòng thử lại" : 
                     "Không thể kết nối với tab"}`);
}

// Conditional debug logging
function debugLog(...args) {
    if (CONFIG.DEBUG_MODE) {
        console.debug(...args);
    }
}

// List of supported URLs (from manifest.json)
const supportedPatterns = [
    "*://*.youtube.com/*",
    "*://*.vimeo.com/*",
    "*://*.soundcloud.com/*",
    "*://*.facebook.com/*",
    "*://*.dailymotion.com/*",
    "*://*.twitch.tv/*"
];

// Check if URL matches supported patterns
function isSupportedUrl(url) {
    return supportedPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(url);
    });
}

// Inject content script dynamically if not ready
function injectContentScriptIfNeeded(tabId, callback) {
    // Thêm check if already injected để tránh re-inject gây duplicate declaration
    chrome.tabs.sendMessage(tabId, { type: "ping" }, (pingResponse) => {
        if (!chrome.runtime.lastError && pingResponse) {
            // Đã injected, reset audio ngay và callback success
            chrome.tabs.sendMessage(tabId, { type: "resetAudioContext" }, (resetResponse) => {
                if (chrome.runtime.lastError || !resetResponse) {
                    console.warn("Audio context reset failed, but content script already injected.");
                }
                if (callback) callback({ status: "success", message: "Content script already injected and ready" });
            });
            return;
        }
        // Chưa injected, proceed inject Jungle.js trước rồi content.js
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['jungle.js', 'content.js'] // Load Jungle.js trước để tránh lỗi not loaded
        }, () => {
            if (chrome.runtime.lastError) {
                handleError("Error injecting content script and Jungle library:", chrome.runtime.lastError);
                if (callback) callback({ status: "error", message: "Could not inject content script. Try reloading manually!" });
            } else {
                // Sau inject, gửi message reset audio context để tránh giật
                chrome.tabs.sendMessage(tabId, { type: "resetAudioContext" }, (resetResponse) => {
                    if (chrome.runtime.lastError || !resetResponse) {
                        console.warn("Audio context reset after inject failed, but continuing.");
                    }
                    if (callback) callback({ status: "success", message: "Content script and Jungle library injected and ready" });
                });
            }
        });
    });
}

// Send message to active tab with smart retry mechanism
function sendMessageToActiveTab(message, callback, retries = 1) { // Giảm retries xuống 1 để confirm hiển thị ngay, thuật toán nhanh hơn
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id || !tab.url || !isSupportedUrl(tab.url)) {
            console.log("Invalid or unsupported tab:", tab ? tab.url : "No tab");
            if (callback) callback({ status: "notSupported", message: "This tab is not supported by the extension" });
            return;
        }
        chrome.tabs.sendMessage(tab.id, { type: "ping" }, (pingResponse) => {
            if (chrome.runtime.lastError || !pingResponse) {
                handleError("Content script not ready:", chrome.runtime.lastError);
                if (retries > 0) {
                    console.log(`Retrying (${retries} attempts left)...`);
                    setTimeout(() => sendMessageToActiveTab(message, callback, retries - 1), 100); // Giảm delay xuống 100ms để nhanh
                } else {
                    // Thay vì báo lỗi, hiển thị confirm dialog ngay (nhắc nhở, không lỗi developer)
                    showCustomConfirm("You need to reload the page for the extension to take effect. Do you want to reload now?", () => {
                        // Yes: Reload tab và inject lại
                        chrome.tabs.reload(tab.id, () => {
                            if (chrome.runtime.lastError) {
                                handleError("Error reloading tab:", chrome.runtime.lastError);
                                if (callback) callback({ status: "error", message: "Could not reload tab. Please reload manually!" });
                            } else {
                                // Sau reload, inject động và reset audio
                                setTimeout(() => {
                                    injectContentScriptIfNeeded(tab.id, (injectResponse) => {
                                        if (injectResponse.status === "success") {
                                            // Gửi message gốc sau khi inject thành công
                                            chrome.tabs.sendMessage(tab.id, message, (response) => {
                                                if (chrome.runtime.lastError) {
                                                    handleError("Error sending message after reload:", chrome.runtime.lastError);
                                                    if (callback) callback({ status: "error", message: "Error communicating with tab after reload" });
                                                } else {
                                                    if (callback) callback(response);
                                                }
                                            });
                                        } else {
                                            if (callback) callback(injectResponse);
                                        }
                                    });
                                }, 1000); // Delay ngắn để tab ổn định sau reload
                            }
                        });
                    }, () => {
                        // No: Không làm gì, không báo lỗi cho developer
                        if (callback) callback({ status: "cancelled", message: "User cancelled reload" });
                    });
                }
            } else {
                chrome.tabs.sendMessage(tab.id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        handleError("Error sending message:", chrome.runtime.lastError);
                        if (callback) callback({ status: "error", message: "Error communicating with tab" });
                    } else if (!response || typeof response !== "object") {
                        console.warn("Invalid response from content script:", response);
                        if (callback) callback({ status: "error", message: "Invalid response from content script" });
                    } else {
                        if (callback) callback(response);
                    }
                });
            }
        });
    });
}

// Show temporary notification
function showNotification(message) {
    const overlay = document.getElementById("value-overlay");
    if (overlay) {
        overlay.textContent = message;
        overlay.classList.add("neon");
        setTimeout(() => overlay.classList.remove("neon"), 1500);
    } else {
        console.log("Notification:", message);
    }
}

// Show custom confirmation dialog
function showCustomConfirm(message, onConfirm, onCancel) {
    const confirmModal = document.createElement("div");
    confirmModal.className = "custom-confirm";
    confirmModal.style.position = "fixed"; // Fixed để overlay toàn màn
    confirmModal.style.top = "0"; // Nằm trên cùng
    confirmModal.style.left = "0";
    confirmModal.style.width = "100vw";
    confirmModal.style.height = "100vh";
    confirmModal.style.zIndex = "10000"; // Tăng z-index để trên showNotification
    confirmModal.style.backgroundColor = "rgba(0, 0, 0, 0.5)"; // Backdrop mờ
    confirmModal.style.display = "flex";
    confirmModal.style.justifyContent = "center";
    confirmModal.style.alignItems = "center";
    confirmModal.innerHTML = `
        <div class="confirm-content" style="background: white; color: black; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 0 10px rgba(0,0,0,0.5);">
            <p style="margin: 0 0 10px;">${message}</p>
            <div class="confirm-buttons" style="display: flex; justify-content: center; gap: 10px;">
                <button id="confirm-yes" style="background: #007bff; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;">Yes</button>
                <button id="confirm-no" style="background: #dc3545; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;">No</button>
            </div>
        </div>
    `;
    document.body.appendChild(confirmModal);

    document.getElementById("confirm-yes").addEventListener("click", () => {
        document.body.removeChild(confirmModal);
        onConfirm();
    });
    document.getElementById("confirm-no").addEventListener("click", () => {
        document.body.removeChild(confirmModal);
        if (onCancel) onCancel();
    });
}

// Global variables for original BPM, key, and song title
let baseBPM = null;
let currentKey = null;
let latestStatusTime = 0;
let currentSongTitle = "No songs yet";
let port;

// Cache for key verification, trial, and CryptoKey
let activationCache = {
    key: null,
    deviceId: null,
    result: null,
    timestamp: 0
};
let trialCache = {
    deviceId: null,
    result: null,
    timestamp: 0
};
let cachedCryptoKey = null;

// Debounce function to optimize events
function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// Static variable to avoid repeated warnings
let hasWarned = false;

// Enhanced fallback hash function
function simpleHash(str) {
    let hash = 0x5a7b3c;
    const bytes = new Uint8Array(16);
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i) ^ (i + 0x1f);
        hash = ((hash << 7) ^ (hash >> 3)) + (char << (i % 4)) | 0;
        bytes[i % 16] = (hash & 0xff) ^ (char & 0x7f);
    }
    // Dummy operations for obfuscation
    let dummy = hash;
    for (let i = 0; i < 8; i++) dummy = (dummy ^ i) << (i % 3);
    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
}

// Generate static Device ID (32 characters) with chrome.storage.sync
async function generateDeviceId() {
    return new Promise((resolve) => {
        try {
            // Check for development environment or Chrome Extension context
            const isDevEnvironment = (
                location.protocol === "file:" ||
                location.hostname === "localhost" ||
                location.hostname === "127.0.0.1" ||
                /^192\.168\.\d{1,3}\.\d{1,3}$/.test(location.hostname) ||
                location.protocol === "chrome-extension:" // Thêm kiểm tra chrome-extension://
            );
            if (!isDevEnvironment && location.protocol !== "https:" && !hasWarned) {
                debugLog("Tạo Device ID ưu tiên ngữ cảnh bảo mật (HTTPS)");
                hasWarned = true;
            }

            // Check stored ID in sync storage first
            chrome.storage.sync.get(["deviceId"], (syncResult) => {
                if (syncResult.deviceId) {
                    // Sync to local storage
                    chrome.storage.local.set({ deviceId: syncResult.deviceId }, () => {
                        resolve(syncResult.deviceId);
                    });
                    return;
                }

                // Check local storage
                chrome.storage.local.get(["deviceId"], (localResult) => {
                    if (localResult.deviceId) {
                        // Sync to sync storage
                        chrome.storage.sync.set({ deviceId: localResult.deviceId }, () => {
                            if (chrome.runtime.lastError) {
                                console.warn("Lỗi đồng bộ deviceId sang sync storage:", chrome.runtime.lastError);
                            }
                            resolve(localResult.deviceId);
                        });
                        return;
                    }

                    // Generate new ID
                    const deviceInfo = [
                        navigator.hardwareConcurrency || 0,
                        screen.width || 0,
                        screen.height || 0,
                        window.devicePixelRatio || 1,
                        screen.colorDepth || 24,
                        navigator.language || "en-US",
                        Math.floor(performance.now() * 1000) ^ 0x7a3b // Entropy from timing
                    ].join("||");

                    console.info("Lưu ý: Device ID được tạo dựa trên thông tin thiết bị. Cài lại hệ điều hành hoặc đổi trình duyệt có thể tạo ID mới. Lưu ID này để khôi phục nếu cần.");

                    const hashDeviceInfo = async (info) => {
                        try {
                            const encoder = new TextEncoder();
                            const data = encoder.encode(info);
                            const key = await crypto.subtle.importKey(
                                "raw",
                                CONFIG.SECRET,
                                { name: "PBKDF2" },
                                false,
                                ["deriveBits"]
                            );
                            const hash = await crypto.subtle.deriveBits(
                                {
                                    name: "PBKDF2",
                                    salt: encoder.encode(info.slice(0, 16)),
                                    iterations: 100000,
                                    hash: "SHA-512"
                                },
                                key,
                                256
                            );
                            return Array.from(new Uint8Array(hash))
                                .map(byte => byte.toString(16).padStart(2, "0"))
                                .join("")
                                .slice(0, 32);
                        } catch (cryptoError) {
                            debugLog("PBKDF2 thất bại, sử dụng hàm hash dự phòng:", cryptoError);
                            return simpleHash(info);
                        }
                    };

                    hashDeviceInfo(deviceInfo).then((deviceId) => {
                        // Store in both local and sync storage
                        chrome.storage.local.set({ deviceId }, () => {
                            chrome.storage.sync.set({ deviceId }, () => {
                                if (chrome.runtime.lastError) {
                                    console.warn("Lỗi đồng bộ deviceId sang sync storage:", chrome.runtime.lastError);
                                }
                                resolve(deviceId);
                            });
                        });
                    }).catch((hashError) => {
                        console.error("Lỗi khi hash Device ID:", hashError);
                        const fallbackId = simpleHash(deviceInfo);
                        chrome.storage.local.set({ deviceId: fallbackId }, () => {
                            chrome.storage.sync.set({ deviceId: fallbackId }, () => {
                                if (chrome.runtime.lastError) {
                                    console.warn("Lỗi đồng bộ deviceId dự phòng sang sync storage:", chrome.runtime.lastError);
                                }
                                console.warn("Sử dụng Device ID dự phòng:", fallbackId);
                                resolve(fallbackId);
                            });
                        });
                    });
                });
            });
        } catch (error) {
            console.error("Lỗi khi tạo Device ID:", error);
            const deviceInfo = [
                navigator.hardwareConcurrency || 0,
                screen.width || 0,
                screen.height || 0,
                window.devicePixelRatio || 1,
                screen.colorDepth || 24,
                navigator.language || "en-US",
                Math.floor(performance.now() * 1000) ^ 0x7a3b
            ].join("||");
            const fallbackId = simpleHash(deviceInfo);
            chrome.storage.local.set({ deviceId: fallbackId }, () => {
                chrome.storage.sync.set({ deviceId: fallbackId }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn("Lỗi đồng bộ deviceId dự phòng sang sync storage:", chrome.runtime.lastError);
                    }
                    console.warn("Sử dụng Device ID dự phòng:", fallbackId);
                    resolve(fallbackId);
                });
            });
        }
    });
}

// Encrypt data
function encryptData(data, secret) {
    try {
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(JSON.stringify(data));
        const hmac = new Uint8Array(32);
        let checkSum = 0;
        for (let i = 0; i < dataBytes.length; i++) {
            const byte = dataBytes[i] ^ secret[i % secret.length];
            hmac[i % 32] ^= byte;
            checkSum += byte;
        }
        // Integrity check
        if (checkSum % 0x7 !== 0x3) throw new Error("Integrity check failed");
        // Dummy operations
        let dummy = checkSum;
        for (let i = 0; i < 4; i++) dummy = (dummy ^ i) >> (i % 2);
        return btoa(String.fromCharCode(...hmac));
    } catch (error) {
        handleError("Error encrypting data:", error);
        return "";
    }
}

// Check key format
function isValidKeyFormat(activationKey) {
    try {
        const decodedKey = atob(activationKey);
        const parts = decodedKey.split(":");
        if (parts.length !== 3) return false;
        const [signature, type, expiry] = parts;
        if (!signature || !type || !expiry) return false;
        if (!["yearly", "permanent", "custom"].includes(type)) return false;
        if ((type === "yearly" || type === "custom") && isNaN(parseInt(expiry))) return false;
        // Dummy check for obfuscation
        let dummy = 0;
        for (let i = 0; i < signature.length; i++) dummy += signature.charCodeAt(i) ^ i;
        return true;
    } catch (error) {
        return false;
    }
}

// Initialize CryptoKey
async function getCryptoKey(secret) {
    if (cachedCryptoKey) {
        console.log("Debug: Using cached CryptoKey");
        return cachedCryptoKey;
    }
    console.time("ImportCryptoKey");
    try {
        cachedCryptoKey = await crypto.subtle.importKey(
            "raw",
            secret,
            { name: "HMAC", hash: "SHA-512" },
            false,
            ["sign"]
        );
        console.log("Debug: Created new CryptoKey");
        // Dummy operations
        let dummy = 0;
        for (let i = 0; i < 8; i++) dummy += (i ^ secret[i % secret.length]) << (i % 3);
    } catch (error) {
        handleError("Error importing CryptoKey:", error);
        throw error;
    } finally {
        console.timeEnd("ImportCryptoKey");
    }
    return cachedCryptoKey;
}

// Log suspicious activity
async function logSuspiciousActivity(event, details) {
    console.time("LogSuspiciousActivity");
    try {
        const deviceId = await generateDeviceId();
        const logEntry = {
            event,
            details,
            timestamp: Date.now(),
            deviceId
        };

        // Sử dụng bộ nhớ đệm tạm thời để giảm độ trễ
        let logs = trialCache.suspiciousLogs || [];
        logs.push(logEntry);
        trialCache.suspiciousLogs = logs;

        // Kiểm tra và khởi tạo lockedDevices nếu chưa tồn tại
        let lockedDevices = await new Promise((resolve) => {
            chrome.storage.sync.get(["lockedDevices"], (result) => resolve(result.lockedDevices || []));
        });

        // Chỉ khóa vĩnh viễn nếu vượt ngưỡng logs (>3) và thiết bị chưa bị khóa
        if (logs.length > 3 && !lockedDevices.includes(deviceId)) {
            lockedDevices.push(deviceId);
            trialCache.trialLocked = true;
            trialCache.permanentLock = true;

            // Đồng bộ hóa với storage sau khi khóa
            await Promise.all([
                new Promise((resolve) => {
                    chrome.storage.local.set({ trialLocked: true, suspiciousLogs: logs }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn("Lỗi lưu vào local storage:", chrome.runtime.lastError);
                        }
                        resolve();
                    });
                }),
                new Promise((resolve) => {
                    chrome.storage.sync.set({ 
                        permanentLock: true, 
                        suspiciousLogs: logs,
                        lockedDevices: lockedDevices 
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn("Lỗi đồng bộ sang sync storage:", chrome.runtime.lastError);
                        }
                        resolve();
                    });
                })
            ]);
            console.warn("Thiết bị bị khóa vĩnh viễn do hoạt động đáng ngờ!");
            console.timeEnd("LogSuspiciousActivity");
            return;
        }

        // Lưu log vào storage mà không làm chậm quá trình
        await Promise.all([
            new Promise((resolve) => {
                chrome.storage.local.set({ suspiciousLogs: logs }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn("Lỗi lưu vào local storage:", chrome.runtime.lastError);
                    }
                    resolve();
                });
            }),
            new Promise((resolve) => {
                chrome.storage.sync.set({ 
                    suspiciousLogs: logs,
                    lockedDevices: lockedDevices 
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn("Lỗi đồng bộ sang sync storage:", chrome.runtime.lastError);
                    }
                    resolve();
                });
            })
        ]);

        console.timeEnd("LogSuspiciousActivity");
    } catch (error) {
        debugLog("Lỗi ghi log hoạt động đáng ngờ:", error);
        console.timeEnd("LogSuspiciousActivity");
    }
}

// Thay thế console.debug trong fetchServerTime
async function fetchServerTime() {
    console.time("FetchServerTime");
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 450); // Timeout sau 450ms

        const fetchWithTimeout = async (url, options = {}) => {
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                const dateHeader = response.headers.get('Date');
                if (dateHeader) {
                    const serverTime = new Date(dateHeader).getTime();
                    if (!isNaN(serverTime)) return serverTime;
                }
                return null;
            } catch (error) {
                if (error.name === 'AbortError') return null;
                console.debug(`Error fetching from ${url}:`, error);
                return null;
            }
        };

        // Ưu tiên các nguồn đáng tin cậy
        const sources = [
            fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', { method: 'GET' }),
            fetchWithTimeout('https://www.youtube.com', { method: 'HEAD' }),
            fetchWithTimeout('https://time.google.com', { method: 'HEAD' })
            // Bỏ worldtimeapi.org để tránh lỗi UTC
        ];

        const serverTime = await Promise.race(sources.filter(p => p !== null).map(async (promise, index) => {
            const result = await promise;
            if (result && !isNaN(result)) {
                clearTimeout(timeout);
                return result;
            }
            if (index === sources.length - 1) {
                throw new Error("All sources failed");
            }
            return null;
        }));

        if (serverTime) {
            console.timeEnd("FetchServerTime");
            return serverTime;
        }

        console.debug("No valid server time from any source, falling back to system time");
        console.timeEnd("FetchServerTime");
        return Date.now();
    } catch (error) {
        console.debug("Error fetching server time, falling back to system time:", error);
        console.timeEnd("FetchServerTime");
        return Date.now();
    }
}

// Update last access time
async function updateLastAccessTime() {
    const currentTime = Date.now();
    await new Promise((resolve) => {
        chrome.storage.local.set({ lastAccessTime: currentTime }, () => {
            chrome.storage.sync.set({ lastAccessTime: currentTime }, () => {
                if (chrome.runtime.lastError) {
                    console.warn("Error syncing lastAccessTime to sync storage:", chrome.runtime.lastError);
                }
                resolve();
            });
        });
    });
}

// Verify activation key (optimized with Web Crypto API and cache)
async function verifyActivation(activationKey, deviceId) {
    console.time("VerifyActivation");
    try {
        // Kiểm tra thời gian hệ thống so với thời gian server
        let serverTime;
        try {
            serverTime = await fetchServerTime();
        } catch (error) {
            console.timeEnd("VerifyActivation");
            return { valid: false, message: "Unable to retrieve server time! Please check your network connection." };
        }
        const systemTime = Date.now();
        const maxAllowedDrift = 24 * 60 * 60 * 1000; // 24 giờ
        if (Math.abs(systemTime - serverTime) > maxAllowedDrift) {
            await logSuspiciousActivity("system_time_drift_detected_at_activation", {
                systemTime,
                serverTime,
                deviceId
            });
            console.timeEnd("VerifyActivation");
            return { valid: false, message: "System time is incorrect! Please adjust your system time to match the current time." };
        }

        // Check cache
        if (
            activationCache.key === activationKey &&
            activationCache.deviceId === deviceId &&
            Date.now() - activationCache.timestamp < CONFIG.CACHE_TIMEOUT
        ) {
            console.log("Debug: Using cached verification result");
            console.timeEnd("VerifyActivation");
            return activationCache.result;
        }

        // Early format check
        if (!isValidKeyFormat(activationKey)) {
            console.timeEnd("VerifyActivation");
            return { valid: false, message: "Invalid key format!" };
        }

        const decodedKey = atob(activationKey);
        const [signature, type, expiry] = decodedKey.split(":");
        const data = { deviceId, type, expiry: parseInt(expiry) };
        const dataStr = JSON.stringify(data);

        // Generate HMAC-SHA512 signature with Web Crypto API
        const secretKey = await getCryptoKey(CONFIG.SECRET);
        const encoder = new TextEncoder();
        const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            secretKey,
            encoder.encode(dataStr)
        );
        const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

        if (signature !== expectedSignature) {
            console.timeEnd("VerifyActivation");
            return { valid: false, message: "Invalid activation key!" };
        }
        if (type !== "yearly" && type !== "permanent" && type !== "custom") {
            console.timeEnd("VerifyActivation");
            return { valid: false, message: "Invalid key type!" };
        }
        const expiryDate = parseInt(expiry, 10);
        if ((type === "yearly" || type === "custom") && serverTime > expiryDate) {
            console.timeEnd("VerifyActivation");
            return { valid: false, message: "The key has expired!" };
        }

        // Store in cache
        activationCache = {
            key: activationKey,
            deviceId: deviceId,
            result: { valid: true, type, expiry: type === "permanent" ? null : expiryDate },
            timestamp: serverTime
        };

        console.timeEnd("VerifyActivation");
        return activationCache.result;
    } catch (error) {
        handleError("Error verifying the key:", error);
        console.timeEnd("VerifyActivation");
        return { valid: false, message: "Error verifying the key! Please try again." };
    }
}

async function verifyTrial(deviceId, trialData) {
    console.time("VerifyTrial");
    try {
        // Kiểm tra và khởi tạo lockedDevices nếu chưa tồn tại
        let lockedDevices = await new Promise((resolve) => {
            chrome.storage.sync.get(["lockedDevices"], (result) => resolve(result.lockedDevices || []));
        });
        if (!Array.isArray(lockedDevices)) {
            lockedDevices = [];
            await new Promise((resolve) => {
                chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
            });
        }

        // Kiểm tra nếu thiết bị đã bị khóa vĩnh viễn
        if (lockedDevices.includes(deviceId)) {
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "This device has been permanently locked due to previous suspicious activity!" };
        }

        // Kiểm tra permanentLock
        const permanentLock = await new Promise((resolve) => {
            chrome.storage.sync.get(["permanentLock"], (result) => resolve(result.permanentLock || false));
        });
        if (permanentLock) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "The trial has been permanently locked due to suspicious activity!" };
        }

        // Lấy thời gian server
        let serverTime;
        try {
            serverTime = await fetchServerTime();
        } catch (error) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "Unable to verify trial due to failure in retrieving server time! The device has been locked." };
        }

        // Kiểm tra thời gian hệ thống
        const systemTime = Date.now();
        const maxAllowedDrift = 24 * 60 * 60 * 1000; // 24 giờ
        if (Math.abs(systemTime - serverTime) > maxAllowedDrift) {
            await logSuspiciousActivity("system_time_drift_detected", {
                systemTime,
                serverTime,
                deviceId
            });
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "System time is incorrect! Please adjust your system time to match the current time." };
        }

        // Kiểm tra cache
        if (
            trialCache.deviceId === deviceId &&
            Date.now() - trialCache.timestamp < CONFIG.CACHE_TIMEOUT &&
            trialCache.result?.valid &&
            Math.abs(serverTime - trialCache.timestamp) < maxAllowedDrift
        ) {
            console.log("Debug: Using cached trial verification result");
            console.timeEnd("VerifyTrial");
            return trialCache.result;
        }

        // Kiểm tra dữ liệu thử nghiệm
        let isDataChanged = false;
        if (!trialData || !trialData.startTime || !trialData.signature || !trialData.lockSignature) {
            const syncData = await new Promise((resolve) => {
                chrome.storage.sync.get(["trialBackup"], (result) => resolve(result.trialBackup || null));
            });
            if (syncData && syncData.startTime && syncData.signature && syncData.lockSignature) {
                trialData = syncData;
                await new Promise((resolve) => {
                    chrome.storage.local.set({ trial: trialData }, resolve);
                });
            } else {
                isDataChanged = true;
                await logSuspiciousActivity("missing_trial_data", { deviceId });
                console.timeEnd("VerifyTrial");
                return { valid: false, message: "Trial data not found! Please initialize a new trial." };
            }
        }

        // Kiểm tra installTimestamp
        const installTimestamp = await new Promise((resolve) => {
            chrome.storage.sync.get(["installTimestamp"], (result) => resolve(result.installTimestamp || 0));
        });
        if (installTimestamp && serverTime > installTimestamp + CONFIG.TRIAL_DURATION) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "The trial has expired based on the installation timestamp! The device has been locked." };
        }

        // Kiểm tra trialLocked
        const locked = await new Promise((resolve) => {
            chrome.storage.local.get(["trialLocked"], (result) => resolve(result.trialLocked || false));
        });
        if (locked) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "The trial has been locked due to suspicious activity! The device has been locked." };
        }

        // Xác minh chữ ký HMAC-SHA512
        const data = { deviceId, startTime: trialData.startTime };
        const dataStr = JSON.stringify(data);
        const secretKey = await getCryptoKey(CONFIG.SECRET);
        const encoder = new TextEncoder();
        const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            secretKey,
            encoder.encode(dataStr)
        );
        const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

        // Xác minh lockSignature
        const lockData = { deviceId, startTime: trialData.startTime, signature: trialData.signature };
        const lockDataStr = JSON.stringify(lockData);
        const lockSignatureBuffer = await crypto.subtle.sign(
            "HMAC",
            secretKey,
            encoder.encode(lockDataStr)
        );
        const expectedLockSignature = btoa(String.fromCharCode(...new Uint8Array(lockSignatureBuffer)));

        if (trialData.signature !== expectedSignature || trialData.lockSignature !== expectedLockSignature) {
            await logSuspiciousActivity("invalid_trial_signature", { deviceId, signature: trialData.signature });
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "Invalid trial signature! The device has been locked." };
        }

        const startTime = parseInt(trialData.startTime, 10);
        if (isNaN(startTime) || serverTime < startTime) {
            await logSuspiciousActivity("invalid_trial_start_time", { deviceId, startTime, serverTime });
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "Invalid trial start time! The device has been locked." };
        }

        // Kiểm tra thời gian hết hạn
        if (serverTime > startTime + CONFIG.TRIAL_DURATION) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "The trial has expired! The device has been locked." };
        }

        // Kiểm tra thao túng thời gian hệ thống
        const lastAccessTime = await new Promise((resolve) => {
            chrome.storage.local.get(["lastAccessTime"], (result) => resolve(result.lastAccessTime || 0));
        });
        const syncLastAccessTime = await new Promise((resolve) => {
            chrome.storage.sync.get(["lastAccessTime"], (result) => resolve(result.lastAccessTime || 0));
        });
        const lastServerTime = await new Promise((resolve) => {
            chrome.storage.local.get(["lastServerTime"], (result) => resolve(result.lastServerTime || 0));
        });

        if (
            (lastAccessTime && Math.abs(systemTime - lastAccessTime) > maxAllowedDrift) ||
            (syncLastAccessTime && Math.abs(systemTime - syncLastAccessTime) > maxAllowedDrift) ||
            (lastServerTime && Math.abs(systemTime - lastServerTime) > maxAllowedDrift)
        ) {
            await logSuspiciousActivity("system_time_drift_detected", {
                systemTime,
                lastAccessTime,
                syncLastAccessTime,
                lastServerTime,
                installTimestamp
            });
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("VerifyTrial");
            return { valid: false, message: "System time is incorrect! Please adjust your system time to match the current time." };
        }

        // Cập nhật thời gian truy cập cuối
        await updateLastAccessTime(serverTime);

        // Lưu vào cache
        trialCache = {
            deviceId: deviceId,
            result: { valid: true, startTime, expiry: startTime + CONFIG.TRIAL_DURATION },
            timestamp: serverTime
        };

        console.timeEnd("VerifyTrial");
        return trialCache.result;
    } catch (error) {
        handleError("Error verifying the trial:", error);
        console.timeEnd("VerifyTrial");
        return { valid: false, message: "Error verifying the trial! Please try again." };
    }
}

async function initializeTrial(deviceId) {
    console.time("InitializeTrial");
    try {
        // Kiểm tra và khởi tạo lockedDevices nếu chưa tồn tại
        let lockedDevices = await new Promise((resolve) => {
            chrome.storage.sync.get(["lockedDevices"], (result) => resolve(result.lockedDevices || []));
        });
        if (!Array.isArray(lockedDevices)) {
            lockedDevices = [];
            await new Promise((resolve) => {
                chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
            });
        }

        // Kiểm tra nếu thiết bị đã bị khóa vĩnh viễn
        if (lockedDevices.includes(deviceId)) {
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("InitializeTrial");
            return { valid: false, message: "This device has been permanently locked due to previous suspicious activity!" };
        }

        // Lấy thời gian server
        let serverTime;
        try {
            serverTime = await fetchServerTime();
        } catch (error) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("InitializeTrial");
            return { valid: false, message: "Unable to initialize trial due to failure in retrieving server time! The device has been locked." };
        }

        // Kiểm tra thời gian hệ thống
        const systemTime = Date.now();
        const maxAllowedDrift = 24 * 60 * 60 * 1000; // 24 giờ
        if (Math.abs(systemTime - serverTime) > maxAllowedDrift) {
            await logSuspiciousActivity("system_time_drift_detected_at_trial_init", {
                systemTime,
                serverTime,
                deviceId
            });
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("InitializeTrial");
            return { valid: false, message: "System time is incorrect! Please adjust your system time to match the current time." };
        }

        let trialData = await new Promise((resolve) => {
            chrome.storage.local.get(["trial"], (result) => resolve(result.trial || null));
        });

        // Kiểm tra sync storage
        const syncData = await new Promise((resolve) => {
            chrome.storage.sync.get(["trialBackup"], (result) => resolve(result.trialBackup || null));
        });
        if (syncData && syncData.startTime && syncData.signature && syncData.lockSignature) {
            trialData = syncData;
            await new Promise((resolve) => {
                chrome.storage.local.set({ trial: trialData }, resolve);
            });
        }

        if (trialData) {
            const verification = await verifyTrial(deviceId, trialData);
            if (verification.valid) {
                console.timeEnd("InitializeTrial");
                return verification;
            } else {
                console.timeEnd("InitializeTrial");
                return { valid: false, message: verification.message };
            }
        }

        // Kiểm tra installTimestamp
        const installTimestamp = await new Promise((resolve) => {
            chrome.storage.sync.get(["installTimestamp"], (result) => resolve(result.installTimestamp || 0));
        });
        if (installTimestamp && serverTime > installTimestamp + CONFIG.TRIAL_DURATION) {
            if (!lockedDevices.includes(deviceId)) {
                lockedDevices.push(deviceId);
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ lockedDevices: lockedDevices }, resolve);
                });
            }
            await new Promise((resolve) => {
                chrome.storage.local.set({ trialLocked: true }, () => {
                    chrome.storage.sync.set({ permanentLock: true }, resolve);
                });
            });
            console.timeEnd("InitializeTrial");
            return { valid: false, message: "The trial has expired based on the installation timestamp! The device has been locked." };
        }

        // Tạo trial mới
        const startTime = serverTime;
        const data = { deviceId, startTime };
        const dataStr = JSON.stringify(data);
        const secretKey = await getCryptoKey(CONFIG.SECRET);
        const encoder = new TextEncoder();
        const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            secretKey,
            encoder.encode(dataStr)
        );
        const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

        // Tạo lockSignature
        const lockData = { deviceId, startTime, signature };
        const lockDataStr = JSON.stringify(lockData);
        const lockSignatureBuffer = await crypto.subtle.sign(
            "HMAC",
            secretKey,
            encoder.encode(lockDataStr)
        );
        const lockSignature = btoa(String.fromCharCode(...new Uint8Array(lockSignatureBuffer)));

        const newTrialData = { startTime, signature, lockSignature };
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({ trial: newTrialData }, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            chrome.storage.sync.set({ 
                trialBackup: newTrialData,
                installTimestamp: startTime,
                lockedDevices: lockedDevices
            }, () => {
                if (chrome.runtime.lastError) console.warn("Error syncing trial to sync storage:", chrome.runtime.lastError);
                resolve();
            });
        });

        // Cập nhật thời gian truy cập cuối
        await updateLastAccessTime(serverTime);

        console.timeEnd("InitializeTrial");
        return { valid: true, startTime, expiry: startTime + CONFIG.TRIAL_DURATION };
    } catch (error) {
        handleError("Error initializing the trial:", error);
        console.timeEnd("InitializeTrial");
        return { valid: false, message: "Error initializing the trial! Please try again." };
    }
}

// Check activation status với kiểm tra khóa vĩnh viễn
async function checkActivation() {
    console.time("CheckActivation");
    return new Promise((resolve) => {
        chrome.storage.local.get(["isActivated", "activation", "deviceId", "trial"], async (result) => {
            const { isActivated, activation, deviceId, trial } = result;

            // Check sync storage for activation data
            const syncActivation = await new Promise((resolve) => {
                chrome.storage.sync.get(["activationBackup"], (result) => resolve(result.activationBackup || null));
            });
            if (syncActivation && syncActivation.activationKey && syncActivation.deviceId) {
                await new Promise((resolve) => {
                    chrome.storage.local.set({ activation: syncActivation, isActivated: true }, resolve);
                });
                if (!activation || activation.activationKey !== syncActivation.activationKey) {
                    result.activation = syncActivation;
                    result.isActivated = true;
                }
            }

            // Check activation key first
            if (isActivated && activation && deviceId) {
                const verification = await verifyActivation(activation.activationKey, deviceId);
                if (!verification.valid) {
                    chrome.storage.local.remove(["activation", "isActivated"]);
                    chrome.storage.sync.remove(["activationBackup"]);
                    console.timeEnd("CheckActivation");
                    return resolve({ activated: false, message: verification.message });
                }
                const daysLeft = verification.expiry ? Math.ceil((verification.expiry - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                // Sync to sync storage
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ activationBackup: activation }, resolve);
                });
                console.timeEnd("CheckActivation");
                return resolve({
                    activated: true,
                    type: verification.type,
                    expiry: verification.expiry,
                    daysLeft
                });
            }
            if (activation && deviceId) {
                const verification = await verifyActivation(activation.activationKey, deviceId);
                if (!verification.valid) {
                    chrome.storage.local.remove(["activation", "isActivated"]);
                    chrome.storage.sync.remove(["activationBackup"]);
                    console.timeEnd("CheckActivation");
                    return resolve({ activated: false, message: verification.message });
                }
                chrome.storage.local.set({ isActivated: true });
                await new Promise((resolve) => {
                    chrome.storage.sync.set({ activationBackup: activation }, resolve);
                });
                const daysLeft = verification.expiry ? Math.ceil((verification.expiry - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                console.timeEnd("CheckActivation");
                return resolve({
                    activated: true,
                    type: verification.type,
                    expiry: verification.expiry,
                    daysLeft
                });
            }

            // Check trial mode
            if (deviceId) {
                const trialVerification = await verifyTrial(deviceId, trial);
                if (trialVerification.valid) {
                    const daysLeft = Math.ceil((trialVerification.expiry - Date.now()) / (1000 * 60 * 60 * 24));
                    console.timeEnd("CheckActivation");
                    return resolve({
                        activated: true,
                        type: "trial",
                        expiry: trialVerification.expiry,
                        daysLeft
                    });
                } else {
                    console.timeEnd("CheckActivation");
                    return resolve({ activated: false, message: trialVerification.message });
                }
            }

            console.timeEnd("CheckActivation");
            return resolve({ activated: false });
        });
    });
}

// Save activation key to storage
async function saveActivation(deviceId, activationKey, type, expiry) {
    console.time("SaveActivation");
    try {
        const activationData = { deviceId, activationKey, type, expiry: expiry || null };
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({ 
                activation: activationData,
                isActivated: true
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    chrome.storage.sync.set({ activationBackup: activationData }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn("Error syncing activation to sync storage:", chrome.runtime.lastError);
                        }
                        resolve(true);
                    });
                }
            });
        });
        console.timeEnd("SaveActivation");
        return true;
    } catch (error) {
        handleError("Error saving activation key:", error);
        console.timeEnd("SaveActivation");
        return false;
    }
}

// Lock/unlock interface controls
function toggleControls(enabled) {
    const elements = [
        "enabled",
        "pitch", "playback-rate", "boost", "pan",
        "pitch-shift-type", "pitch-reset", "playback-rate-reset",
        "boost-reset", "pan-reset", "fav-icon", "fav-list-icon",
        "hold-btn", "refresh-btn", "preset-warm", "preset-bright",
        "preset-bass-heavy", "preset-vocal", "preset-pro-natural",
        "preset-karaoke-dynamic", "preset-rock-metal", "preset-smart-studio"
    ];
    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.disabled = !enabled;
            element.style.opacity = enabled ? "1" : "0.5";
            element.style.cursor = enabled ? "pointer" : "not-allowed";
        }
    });
}

// Get thumbnail URL for different platforms
function getThumbnailUrl(url) {
    // YouTube
    const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
    if (youtubeMatch) {
        return `https://img.youtube.com/vi/${youtubeMatch[1]}/default.jpg`;
    }
    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeoMatch) {
        return `https://vimeo.com/api/v2/video/${vimeoMatch[1]}.json`;
    }
    // SoundCloud (placeholder, as SoundCloud API may require additional handling)
    const soundcloudMatch = url.match(/soundcloud\.com\/[^\/]+\/[^\/]+/);
    if (soundcloudMatch) {
        return "icon48.png"; // Replace with actual SoundCloud thumbnail logic if available
    }
    // Fallback
    return "icon48.png";
}

// Fuzzy search for favorites with enhanced intelligence and performance
let searchCache = new Map();
function fuzzySearch(text, query, limit = 100) {
    const cacheKey = `${text}||${query}`;
    if (searchCache.has(cacheKey)) {
        return searchCache.get(cacheKey);
    }
    const normalizeText = (str) => {
        return str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    };
    const textNormalized = normalizeText(text || "Unknown");
    const queryNormalized = normalizeText(query || "");
    if (!queryNormalized) return { score: 0, matches: [] };
    let score = 0;
    let matches = [];
    let queryIndex = 0;
    let lastMatchIndex = -1;
    for (let i = 0; i < textNormalized.length && queryIndex < queryNormalized.length; i++) {
        if (textNormalized[i] === queryNormalized[queryIndex]) {
            score += 10;
            if (i === lastMatchIndex + 1) score += 5;
            if (lastMatchIndex !== -1) score -= (i - lastMatchIndex - 1) * 0.5;
            matches.push(i);
            lastMatchIndex = i;
            queryIndex++;
        } else {
            score -= 0.2;
        }
    }
    if (queryIndex < queryNormalized.length) return { score: -1, matches: [] };
    if (matches[0] === 0) score += 15;
    if (matches.length === textNormalized.length) score += 20;
    score = Math.max(0, Math.min(score, 100));
    const result = { score, matches };
    searchCache.set(cacheKey, result);
    if (searchCache.size > 1000) searchCache.clear(); // Giới hạn cache
    return result;
}

// Periodic system time check (every 6 hours)
let periodicCheckInterval = null;

function startPeriodicTimeCheck() {
    if (periodicCheckInterval) {
        console.debug("Periodic time check already running");
        return;
    }
    periodicCheckInterval = setInterval(async () => {
        try {
            const activationStatus = await checkActivation();
            if (!activationStatus.activated) {
                console.debug("Skipping periodic time check: Extension not activated");
                return;
            }

            const serverTime = await fetchServerTime();
            const systemTime = Date.now();
            const maxAllowedDrift = 24 * 60 * 60 * 1000; // 24 hours
            if (Math.abs(systemTime - serverTime) > maxAllowedDrift) {
                await logSuspiciousActivity("periodic_system_time_drift_detected", { systemTime, serverTime });
                showNotification("System time is incorrect! Please adjust your system time to match the current time.");
            }
        } catch (error) {
            console.debug("Periodic time check failed:", error);
        }
    }, 6 * 60 * 60 * 1000); // Check every 6 hours
}

// Main initialization function
function init() {
    let transpose = true;
    let favorites = [];
    let currentUrl = null;
    let currentTabId = null;
    let currentSettings = {
        pitch: 0,
        playbackRate: 1,
        boost: 0.8,
        pan: 0,
        transpose: true,
        soundProfile: "proNatural"
    };
    let isHeld = false;
    let isActivated = false;

    // Get DOM elements
    const elements = {
        enabled: document.getElementById("enabled"),
        pitch: document.getElementById("pitch"),
        pitchValue: document.getElementById("pitch-value"),
        pitchShiftTypeSelect: document.getElementById("pitch-shift-type"),
        pitchReset: document.getElementById("pitch-reset"),
        playbackRate: document.getElementById("playback-rate"),
        playbackRateValue: document.getElementById("playback-rate-value"),
        playbackRateReset: document.getElementById("playback-rate-reset"),
        boost: document.getElementById("boost"),
        boostValue: document.getElementById("boost-value"),
        boostReset: document.getElementById("boost-reset"),
        pan: document.getElementById("pan"),
        panValue: document.getElementById("pan-value"),
        panReset: document.getElementById("pan-reset"),
        favIcon: document.getElementById("fav-icon"),
        favListIcon: document.getElementById("fav-list-icon"),
        songTitle: document.getElementById("song-title"),
        bpmValue: document.getElementById("bpm-value"),
        favoritesModal: document.getElementById("favorites-modal"),
        modalClose: document.getElementById("modal-close"),
        favoritesTableBody: document.getElementById("favorites-table-body"),
        exportBtn: document.getElementById("export-btn"),
        importBtn: document.getElementById("import-btn"),
        importFile: document.getElementById("import-file"),
        searchFavorites: document.getElementById("search-favorites"),
        clearAllFavorites: document.getElementById("clear-all-favorites"),
        themeToggle: document.getElementById("theme-toggle"),
        refreshBtn: document.getElementById("refresh-btn"),
        holdBtn: document.getElementById("hold-btn"),
        presetButtons: document.querySelectorAll(".preset-btn"),
        buyBtn: document.getElementById("buy-btn"),
        licenseStatus: document.getElementById("license-status"),
        activationModal: document.getElementById("activation-modal"),
        activationModalClose: document.getElementById("activation-modal-close"),
        deviceIdInput: document.getElementById("device-id"),
        copyDeviceIdBtn: document.getElementById("copy-device-id"),
        activationKeyInput: document.getElementById("activation-key"),
        activateBtn: document.getElementById("activate-btn"),
        activationError: document.getElementById("activation-error"),
        successModal: document.getElementById("success-modal"),
        successModalClose: document.getElementById("success-modal-close"),
        successModalOk: document.getElementById("success-modal-ok")
    };
	
    // Check DOM elements and log details
    for (const [key, value] of Object.entries(elements)) {
        if (!value) {
            console.warn(`DOM element ${key} not found in HTML`);
        }
    }
    startPeriodicTimeCheck();
    // Apply settings to content script
    const applySettings = debounce((settings) => {
        if (elements.enabled?.checked && currentTabId && !isHeld && isActivated) {
            chrome.tabs.sendMessage(currentTabId, settings, (response) => {
                if (chrome.runtime.lastError || !response || response.status === "error") {
                    showNotification(response?.message || "Error applying settings");
                    console.log("Settings applied:", settings, "Response:", response);
                }
            });
        }
    }, 200);

    // Update UI values and save to currentSettings
    function setPitchValue(value) {
        if (elements.pitch && elements.pitchValue) {
            elements.pitch.value = value;
            elements.pitchValue.textContent = value;
            currentSettings.pitch = value;
            if (baseBPM) {
                const adjustedBPM = adjustBPMWithPitch(baseBPM, value, transpose);
                updateBPMDisplay(adjustedBPM, null, currentKey);
            }
        }
    }

    function setPlaybackRate(value) {
        if (elements.playbackRate && elements.playbackRateValue) {
            elements.playbackRate.value = value;
            elements.playbackRateValue.textContent = value;
            currentSettings.playbackRate = value;
        }
    }

    function setBoostValue(value) {
        if (elements.boost && elements.boostValue) {
            elements.boost.value = value;
            elements.boostValue.textContent = value;
            currentSettings.boost = value;
        }
    }

    function setPanValue(value) {
        if (elements.pan && elements.panValue) {
            elements.pan.value = value;
            elements.panValue.textContent = value;
            currentSettings.pan = value;
        }
    }

    function setPitchShiftTypeSmooth() {
        if (elements.pitch && elements.pitchShiftTypeSelect) {
            elements.pitch.max = 1;
            elements.pitch.min = -1;
            elements.pitch.step = 0.01;
            elements.pitchShiftTypeSelect.value = "smooth";
            transpose = false;
            currentSettings.transpose = false;
            if (baseBPM) {
                const adjustedBPM = adjustBPMWithPitch(baseBPM, parseFloat(elements.pitch.value), transpose);
                updateBPMDisplay(adjustedBPM, null, currentKey);
            }
        }
    }

    function setPitchShiftTypeSemiTone() {
        if (elements.pitch && elements.pitchShiftTypeSelect) {
            elements.pitch.max = 12;
            elements.pitch.min = -12;
            elements.pitch.step = 0.5;
            elements.pitchShiftTypeSelect.value = "semi-tone";
            transpose = true;
            currentSettings.transpose = true;
            if (baseBPM) {
                const adjustedBPM = adjustBPMWithPitch(baseBPM, parseFloat(elements.pitch.value), transpose);
                updateBPMDisplay(adjustedBPM, null, currentKey);
            }
        }
    }

    // Update preset UI
    function updatePresetUI(selectedPreset) {
    // Chuẩn hóa selectedPreset: chuyển kebab-case thành camelCase nếu cần
    let normalizedPreset = selectedPreset;
    if (selectedPreset.includes('-')) {
        normalizedPreset = selectedPreset.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
        console.log(`updatePresetUI: Normalized preset from ${selectedPreset} to ${normalizedPreset}`);
    }

    elements.presetButtons.forEach(btn => {
        const presetId = btn.id.replace("preset-", "");
        // Chuyển presetId thành camelCase để so sánh
        const preset = presetId.split('-').map((part, index) => 
            index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
        ).join('');
        // So sánh với cả dạng camelCase và kebab-case
        const isActive = preset === normalizedPreset || presetId === selectedPreset;
        btn.classList.toggle("active", isActive);
    });
}

    function resetToDefault() {
        setPitchValue(0);
        setPlaybackRate(1);
        setBoostValue(0.8);
        setPanValue(0);
        transpose = true;
        baseBPM = null;
        currentKey = null;
        currentSettings = {
            pitch: 0,
            playbackRate: 1,
            boost: 0.8,
            pan: 0,
            transpose: true,
            soundProfile: "proNatural"
        };
        if (elements.pitchShiftTypeSelect) elements.pitchShiftTypeSelect.value = "semi-tone";
        updatePresetUI("proNatural");
        updateBPMDisplay(null);
        if (elements.enabled?.checked && isActivated) {
            applySettings(currentSettings);
        }
    }

    // Adjust BPM based on pitch
    function adjustBPMWithPitch(bpm, pitch, transpose) {
        if (!bpm) return null;
        const pitchFactor = transpose ? Math.pow(2, pitch / 12) : (1 + pitch);
        return Math.round(bpm * pitchFactor);
    }

    // Update BPM and Key display
    function updateBPMDisplay(bpm, confidence = null, key = null, status = null) {
    if (!elements.bpmValue) {
        console.warn("bpmValue element not found");
        return;
    }
    if (status) {
        elements.bpmValue.textContent = status;
    } else if (bpm !== null) {
        const confidenceText = confidence ? ` (${Math.round(confidence * 100)}%)` : "";
        const keyText = key && key !== "Unknown" ? ` - Key: ${key}` : "";
        elements.bpmValue.textContent = `BPM: ${bpm}${confidenceText}${keyText}`;
        elements.bpmValue.classList.add("blink");
        requestAnimationFrame(() => {
            setTimeout(() => elements.bpmValue.classList.remove("blink"), 2000);
        });
        if (confidence) {
            baseBPM = bpm;
            currentKey = key;
        }
    } else {
        elements.bpmValue.textContent = "BPM: ...";
        baseBPM = null;
        currentKey = null;
    }
}

    // Update song title with smart animation
    function updateSongTitle(passedTitle) {
        if (!elements.songTitle) return;
        if (passedTitle && passedTitle !== "No songs yet") {
            currentSongTitle = passedTitle;
        }
        elements.songTitle.textContent = currentSongTitle;
        const containerWidth = elements.songTitle.parentElement?.offsetWidth || 0;
        const textWidth = elements.songTitle.scrollWidth || 0;
        elements.songTitle.style.animation = textWidth > containerWidth ? "scrollText 10s linear infinite" : "none";
    }

    function updateLicenseStatus(activationStatus) {
    if (!elements.licenseStatus || !elements.buyBtn) {
        console.warn("Missing licenseStatus or buyBtn elements");
        return;
    }

    try {
        if (activationStatus.activated && activationStatus.daysLeft > 0) {
            elements.buyBtn.style.display = "none";
            elements.licenseStatus.style.display = "inline";

            if (activationStatus.type === "permanent") {
                elements.licenseStatus.textContent = "Lifetime Key";
                elements.licenseStatus.classList.remove("warning");
                elements.licenseStatus.title = "";
            } else if (activationStatus.type === "yearly" || activationStatus.type === "custom" || activationStatus.type === "trial") {
                const daysLeft = Number(activationStatus.daysLeft);
                if (isNaN(daysLeft)) {
                    console.error("Invalid daysLeft value:", activationStatus.daysLeft);
                    elements.buyBtn.style.display = "inline-block";
                    elements.licenseStatus.style.display = "none";
                    toggleControls(false);
                    showNotification("Invalid activation data! Please purchase a key.");
                    return;
                }

                // Calculate expiration date
                const currentDate = new Date();
                const endDate = new Date(currentDate.getTime() + daysLeft * 24 * 60 * 60 * 1000);
                const formattedEndDate = endDate.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                elements.licenseStatus.textContent = activationStatus.type === "trial" 
                    ? `Trial End Date: ${formattedEndDate}`
                    : `Subscription End Date: ${formattedEndDate}`;

                if (daysLeft <= 7) {
                    elements.licenseStatus.classList.add("warning");
                    console.log(`${activationStatus.type === "trial" ? "Trial" : "Subscription"} nearing expiration: ${formattedEndDate}`);
                    elements.licenseStatus.title = `Your ${activationStatus.type === "trial" ? "trial" : "subscription"} will expire on ${formattedEndDate}. ${activationStatus.type === "trial" ? "Purchase a key to continue!" : "Renew now!"}`;
                } else {
                    elements.licenseStatus.classList.remove("warning");
                    elements.licenseStatus.title = "";
                }
            }
        } else {
            elements.buyBtn.style.display = "inline-block";
            elements.licenseStatus.style.display = "none";
            toggleControls(false);
            showNotification(activationStatus.message || "Trial or subscription has expired! Please purchase a key.");
            console.log("Buy button displayed due to expired or invalid activation");
        }
    } catch (error) {
        console.error("Error updating license status:", error);
        elements.buyBtn.style.display = "inline-block";
        elements.licenseStatus.style.display = "none";
        toggleControls(false);
        showNotification("Error in license status! Please purchase a key.");
    }
}

    // Handle messages from content.js
    function handleContentMessage(message) {
        if (message.type === "videoChanged") {
            currentUrl = message.videoSrc;
            const favItem = favorites.find(f => f.link === currentUrl);
            if (elements.favIcon) elements.favIcon.classList.toggle("active", !!favItem);
            updateSongTitle(message.title);
            if (favItem) {
                setPitchValue(favItem.pitch);
                setPlaybackRate(favItem.playbackRate);
                setBoostValue(favItem.boost);
                setPanValue(favItem.pan);
                transpose = favItem.transpose !== undefined ? favItem.transpose : true;
                if (transpose) setPitchShiftTypeSemiTone();
                else setPitchShiftTypeSmooth();
                updatePresetUI(favItem.soundProfile || "proNatural");
                updateBPMDisplay(favItem.bpm || message.bpm);
                applySettings({
                    pitch: favItem.pitch,
                    playbackRate: favItem.playbackRate,
                    boost: favItem.boost,
                    pan: favItem.pan,
                    transpose,
                    soundProfile: favItem.soundProfile || "proNatural"
                });
            } else if (message.holdState) {
                setPitchValue(message.pitch);
                setPlaybackRate(message.playbackRate);
                setBoostValue(message.boost);
                setPanValue(message.pan);
                transpose = message.transpose !== undefined ? message.transpose : true;
                if (transpose) setPitchShiftTypeSemiTone();
                else setPitchShiftTypeSmooth();
                updatePresetUI(message.soundProfile || "proNatural");
                updateBPMDisplay(message.bpm);
            } else {
                resetToDefault();
                updateBPMDisplay(message.bpm);
            }
        } else if (message.type === "bpmUpdate") {
            updateBPMDisplay(message.bpm, message.confidence, message.key);
        } else if (message.type === "bpmStatus") {
            const currentTime = Date.now();
            if (currentTime >= latestStatusTime) {
                latestStatusTime = currentTime;
                updateBPMDisplay(null, null, null, message.message);
            }
        }
    }

// Event for clicking BPM to calculate BPM and Key
elements.bpmValue?.addEventListener("click", () => {
    showNotification("Initializing BPM analysis...");
    let retries = 0;
    const maxRetries = 3;
    const retryDelay = 2000;

    const tryCalculateBPM = () => {
        sendMessageToActiveTab({ type: "calculateBPM" }, (response) => {
            if (!response || response.status === "notSupported") {
                showNotification("This tab does not support BPM calculation");
                updateBPMDisplay(null);
            } else if (response.status === "success") {
                updateBPMDisplay(response.bpm, response.confidence, response.key);
                showNotification(`BPM and key analysis successful (${Math.round(response.confidence * 100)}%)`);
            } else if (response.error === "No active video or analyser not ready" && retries < maxRetries) {
                retries++;
                console.log(`Retrying BPM calculation (${retries}/${maxRetries})...`);
                showNotification(`Retrying BPM analysis (${retries}/${maxRetries})...`);
                setTimeout(tryCalculateBPM, retryDelay);
            } else if (response.error === "Advertisement detected" || response.error === "Skipping intro or outro") {
                showNotification("Please wait until the advertisement or intro/outro ends and try again!");
                updateBPMDisplay(null);
            } else {
                showNotification(response?.message || "Unable to analyze BPM and key!");
                updateBPMDisplay(null);
            }
        });
    };

    tryCalculateBPM();
});


// Filter and display favorites list with index number before thumbnail
function filterFavorites(searchTerm = "") {
    let filtered = favorites;
    const favoritesCount = document.getElementById("favorites-count");

    if (searchTerm) {
        filtered = favorites
            .map(item => ({
                item,
                searchResult: fuzzySearch(item.title || "Unknown", searchTerm)
            }))
            .filter(({ searchResult }) => searchResult.score > 0)
            .sort((a, b) => b.searchResult.score - a.searchResult.score)
            .slice(0, 100) // Giới hạn 100 kết quả để đảm bảo hiệu suất
            .map(({ item }) => item);
    }

    // Hiển thị số lượng bài hát tìm được
    if (favoritesCount) {
        favoritesCount.textContent = `Found ${filtered.length} song${filtered.length !== 1 ? "s" : ""}`;
    } else {
        console.log(`Found ${filtered.length} song${filtered.length !== 1 ? "s" : ""}`);
    }

    if (elements.favoritesTableBody) {
        elements.favoritesTableBody.innerHTML = "";
        filtered.forEach((item, index) => {
            const originalIndex = favorites.indexOf(item); // Lấy chỉ số gốc trong favorites
            const thumbnail = getThumbnailUrl(item.link);
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><span class="index-number">${String(originalIndex + 1).padStart(2, "0")}</span></td>
                <td></td>
                <td>${item.pitch}</td>
                <td>${item.boost}</td>
                <td>${item.pan}</td>
                <td>${item.bpm || "..."}</td>
                <td>${profileDisplayNames[item.soundProfile] || item.soundProfile || 'Natural'}</td> <!-- Thêm cột Sound Profile -->
                <td><a href="${item.link}" target="_blank" title="Open ${item.title || "Unknown"}">Link</a></td>
                <td><button class="delete-btn" data-index="${originalIndex}" title="Delete ${item.title || "Unknown"}" aria-label="Delete ${item.title || "Unknown"}">Delete</button></td>
            `;
            const img = document.createElement("img");
            img.src = thumbnail;
            img.alt = `Thumbnail for ${item.title || "Unknown"}`;
            img.className = "thumbnail";
            img.title = item.title || "Unknown";
            img.style.cursor = "pointer";
            img.addEventListener("click", () => window.open(item.link, "_blank"));
            row.cells[1].appendChild(img); // Thumbnail đặt ở cột thứ hai
            row.addEventListener("click", (e) => {
                if (e.target.tagName !== "BUTTON" && e.target.tagName !== "A" && e.target.tagName !== "IMG" && e.target.tagName !== "SPAN" && isActivated) {
                    setPitchValue(item.pitch);
                    setPlaybackRate(item.playbackRate);
                    setBoostValue(item.boost);
                    setPanValue(item.pan);
                    transpose = item.transpose !== undefined ? item.transpose : true;
                    if (transpose) setPitchShiftTypeSemiTone();
                    else setPitchShiftTypeSmooth();
                    updatePresetUI(item.soundProfile || "proNatural");
                    applySettings({
                        pitch: item.pitch,
                        playbackRate: item.playbackRate,
                        boost: item.boost,
                        pan: item.pan,
                        transpose,
                        soundProfile: item.soundProfile || "proNatural"
                    });
                }
            });
            const deleteBtn = row.querySelector(".delete-btn");
            deleteBtn.addEventListener("click", () => {
                favorites.splice(originalIndex, 1);
                chrome.storage.local.set({ favorites }, () => filterFavorites(elements.searchFavorites?.value || ""));
                if (elements.favIcon?.classList.contains("active") && item.link === currentUrl) {
                    elements.favIcon.classList.remove("active");
                    resetToDefault();
                }
            });
            elements.favoritesTableBody.appendChild(row);
        });
    }
}

    function updateFavoritesTable() {
        filterFavorites(elements.searchFavorites?.value || "");
    }

    // Update state based on video URL
    function updateStateBasedOnUrl(newUrl, values) {
        currentUrl = newUrl;
        const favItem = favorites.find(f => f.link === currentUrl);
        if (favItem) {
            if (elements.favIcon) elements.favIcon.classList.add("active");
            setPitchValue(favItem.pitch);
            setPlaybackRate(favItem.playbackRate);
            setBoostValue(favItem.boost);
            setPanValue(favItem.pan);
            transpose = favItem.transpose !== undefined ? favItem.transpose : true;
            if (transpose) setPitchShiftTypeSemiTone();
            else setPitchShiftTypeSmooth();
            updatePresetUI(favItem.soundProfile || "proNatural");
            updateBPMDisplay(favItem.bpm);
            applySettings({
                pitch: favItem.pitch,
                playbackRate: favItem.playbackRate,
                boost: favItem.boost,
                pan: favItem.pan,
                transpose,
                soundProfile: favItem.soundProfile || "proNatural"
            });
        } else if (values && values.holdState) {
            setPitchValue(values.pitch || 0);
            setPlaybackRate(values.playbackRate || 1);
            setBoostValue(values.boost || 0.8);
            setPanValue(values.pan || 0);
            transpose = values.transpose !== undefined ? values.transpose : true;
            if (transpose) setPitchShiftTypeSemiTone();
            else setPitchShiftTypeSmooth();
            updatePresetUI(values.soundProfile || "proNatural");
            updateBPMDisplay(values.bpm);
            if (elements.favIcon) elements.favIcon.classList.remove("active");
        } else if (values && values.videoSrc === currentUrl) {
            setPitchValue(values.pitch || 0);
            setPlaybackRate(values.playbackRate || 1);
            setBoostValue(values.boost || 0.8);
            setPanValue(values.pan || 0);
            transpose = values.transpose !== undefined ? values.transpose : true;
            if (transpose) setPitchShiftTypeSemiTone();
            else setPitchShiftTypeSmooth();
            updatePresetUI(values.soundProfile || "proNatural");
            updateBPMDisplay(values.bpm);
            if (elements.favIcon) elements.favIcon.classList.remove("active");
        } else {
            resetToDefault();
            if (elements.favIcon) elements.favIcon.classList.remove("active");
        }
    }

// Sync state when opening popup or switching tabs
function syncState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id) {
            console.warn("No active tab found");
            return;
        }
        currentTabId = tab.id;
        // Thêm check nhanh trước để detect not ready và show confirm ngay (làm thuật toán thông minh, tự động hơn)
        chrome.tabs.sendMessage(tab.id, { type: "ping" }, (pingResponse) => {
            if (chrome.runtime.lastError || !pingResponse) {
                // Not ready (trường hợp mở YouTube trước cài extension sau), show confirm ngay mà không chờ retry dài
                showCustomConfirm("You need to reload the page for the extension to take effect. Do you want to reload now?", () => {
                    chrome.tabs.reload(tab.id, () => injectContentScriptIfNeeded(tab.id, () => syncState())); // Reload và sync lại
                }, () => {
                    // No: Tiếp tục nhưng disable controls tạm
                    toggleControls(false);
                });
                return;
            }
            // Nếu ready, proceed sync
            sendMessageToActiveTab({ type: "get" }, (values) => {
                if (!values || values.status === "notSupported") {
                    updateSongTitle("Tab not supported");
                    updateBPMDisplay(null);
                    if (elements.enabled) {
                        elements.enabled.checked = false;
                        elements.enabled.disabled = true;
                        chrome.storage.local.set({ enabled: false });
                    }
                    resetToDefault();
                } else if (values.status === "success") {
                    currentUrl = values.videoSrc || null;
                    updateSongTitle(values.title);
                    updateBPMDisplay(values.bpm);
                    updateStateBasedOnUrl(currentUrl, values);
                    if (elements.enabled) {
                        elements.enabled.checked = values.enabled;
                        elements.enabled.disabled = !isActivated;
                        chrome.storage.local.set({ enabled: values.enabled });
                    }
                    isHeld = values.holdState || false;
                    if (elements.holdBtn) {
                        elements.holdBtn.textContent = isHeld ? "🔐" : "🔒";
                        elements.holdBtn.classList.toggle("active", isHeld);
                    }
                    updatePresetUI(values.soundProfile || "proNatural");
                    // Thêm reset audio context để tránh giật nếu state mới, nhưng chỉ khi ready (tránh failed)
                    sendMessageToActiveTab({ type: "resetAudioContext" }, (resetResponse) => {
                        if (!resetResponse || resetResponse.status !== "success") {
                            debugLog("Audio reset during sync failed, but continuing."); // Chuyển warn thành debug để không báo thường
                        }
                    });
                } else {
                    console.warn("Failed to sync state:", values);
                    setTimeout(syncState, 1000); // Thử lại sau 1 giây
                }
            });
        });
    });
}

    // Initialize activation status
    async function initializeActivation() {
        const deviceId = await generateDeviceId();
        let activationStatus = await checkActivation();
        console.log("Activation Status:", activationStatus);

        // If not activated, try initializing trial
        if (!activationStatus.activated) {
            const trialStatus = await initializeTrial(deviceId);
            if (trialStatus.valid) {
                activationStatus = {
                    activated: true,
                    type: "trial",
                    expiry: trialStatus.expiry,
                    daysLeft: Math.ceil((trialStatus.expiry - Date.now()) / (1000 * 60 * 60 * 24))
                };
                showNotification(`Started 30-day trial! ${activationStatus.daysLeft} days left`);
            } else {
                showNotification(trialStatus.message);
            }
        }

        isActivated = activationStatus.activated;
        toggleControls(isActivated);
        updateLicenseStatus(activationStatus);
        if (!isActivated && activationStatus.message) {
            showNotification(activationStatus.message);
        }
        if (isActivated && activationStatus.daysLeft && activationStatus.daysLeft <= 7) {
            showNotification(`${activationStatus.type === "trial" ? "Trial" : "Key"} will expire in ${activationStatus.daysLeft} days!`);
        }
        if (!isActivated && elements.enabled) {
            elements.enabled.checked = false;
            elements.enabled.disabled = true;
        }
    }

    // Event for Buy button
    elements.buyBtn?.addEventListener("click", async () => {
        const deviceId = await generateDeviceId();
        if (elements.deviceIdInput && elements.activationModal) {
            elements.deviceIdInput.value = deviceId;
            elements.activationModal.classList.add("active");
            elements.activationModal.style.display = "block";
            elements.activationModal.setAttribute("aria-hidden", "false");
            elements.activationKeyInput?.focus();
        }
    });

    // Event for Copy Device ID button
    elements.copyDeviceIdBtn?.addEventListener("click", () => {
        if (elements.deviceIdInput) {
            navigator.clipboard.writeText(elements.deviceIdInput.value).then(() => {
                showNotification("Device ID copied");
            }).catch((error) => {
                handleError("Error copying Device ID:", error);
                showNotification("Error copying Device ID!");
            });
        }
    });

    // Event for Activate button
    elements.activateBtn?.addEventListener("click", async () => {
        console.time("ActivationProcess");
        const activationKey = elements.activationKeyInput?.value.trim();
        if (!activationKey) {
            elements.activationError.textContent = "Please enter an activation key!";
            console.timeEnd("ActivationProcess");
            return;
        }
        const deviceId = elements.deviceIdInput?.value;

        // Check key format first
        if (!isValidKeyFormat(activationKey)) {
            elements.activationError.textContent = "Invalid key format!";
            console.timeEnd("ActivationProcess");
            return;
        }

        const verification = await verifyActivation(activationKey, deviceId);
        if (!verification.valid) {
            elements.activationError.textContent = verification.message;
            console.timeEnd("ActivationProcess");
            return;
        }
        const saved = await saveActivation(deviceId, activationKey, verification.type, verification.expiry);
        if (!saved) {
            elements.activationError.textContent = "Error saving activation key!";
            console.timeEnd("ActivationProcess");
            return;
        }
        elements.activationModal.classList.add("closing");
        setTimeout(() => {
            elements.activationModal.classList.remove("active", "closing");
            elements.activationModal.style.display = "none";
            elements.activationModal.setAttribute("aria-hidden", "true");
            elements.activationKeyInput.value = "";
            elements.activationError.textContent = "";
            elements.successModal.classList.add("active");
            elements.successModal.style.display = "block";
            elements.successModal.setAttribute("aria-hidden", "false");
            elements.successModalOk?.focus();
        }, 300);
        isActivated = true;
        toggleControls(true);
        updateLicenseStatus({ activated: true, type: verification.type, daysLeft: verification.expiry ? Math.ceil((verification.expiry - Date.now()) / (1000 * 60 * 60 * 24)) : null });
        showNotification("Activation successful!");
        console.timeEnd("ActivationProcess");
    });

    // Event for closing Activation Modal
    elements.activationModalClose?.addEventListener("click", () => {
        elements.activationModal.classList.add("closing");
        setTimeout(() => {
            elements.activationModal.classList.remove("active", "closing");
            elements.activationModal.style.display = "none";
            elements.activationModal.setAttribute("aria-hidden", "true");
            elements.activationKeyInput.value = "";
            elements.activationError.textContent = "";
        }, 300);
    });

// Events for OK and closing Success Modal
elements.successModalOk?.addEventListener("click", () => {
    elements.successModal.classList.add("closing");
    setTimeout(() => {
        elements.successModal.classList.remove("active", "closing");
        elements.successModal.style.display = "none";
        elements.successModal.setAttribute("aria-hidden", "true");
        chrome.runtime.sendMessage({ action: "refreshExtension" }, (response) => {
            if (chrome.runtime.lastError) {
                handleError("Error sending refreshExtension:", chrome.runtime.lastError);
                showNotification("Lỗi làm mới extension!");
                return;
            }
            if (!response || (response.status !== "success" && response.status !== "state refreshed")) {
                handleError("Failed to refresh extension:", response?.message || "No response");
                showNotification(response?.message || "Lỗi làm mới extension!");
                return;
            }
            showNotification("Extension làm mới thành công");
            syncState();
        });
    }, 300);
});

elements.successModalClose?.addEventListener("click", () => {
    elements.successModal.classList.add("closing");
    setTimeout(() => {
        elements.successModal.classList.remove("active", "closing");
        elements.successModal.style.display = "none";
        elements.successModal.setAttribute("aria-hidden", "true");
        chrome.runtime.sendMessage({ action: "refreshExtension" }, (response) => {
            if (chrome.runtime.lastError) {
                handleError("Error sending refreshExtension:", chrome.runtime.lastError);
                showNotification("Lỗi làm mới extension!");
                return;
            }
            if (!response || (response.status !== "success" && response.status !== "state refreshed")) {
                handleError("Failed to refresh extension:", response?.message || "No response");
                showNotification(response?.message || "Lỗi làm mới extension!");
                return;
            }
            showNotification("Extension làm mới thành công");
            syncState();
        });
    }, 300);
});

    // Initialize state from storage and content script
    chrome.storage.local.get(["favorites", "enabled", "theme"], async (result) => {
        if (chrome.runtime.lastError) {
            handleError("Error retrieving data from storage:", chrome.runtime.lastError);
            resetToDefault();
            return;
        }
        favorites = result.favorites || [];
        updateFavoritesTable();

        const savedTheme = result.theme || "dark";
        document.body.setAttribute("data-theme", savedTheme);
        if (elements.themeToggle) elements.themeToggle.textContent = savedTheme === "dark" ? "☀️" : "🌙";

        const savedEnabled = result.enabled !== undefined ? result.enabled : false;
        if (elements.enabled) elements.enabled.checked = savedEnabled;

        await initializeActivation();
        syncState();
    });

    // Event for enabling/disabling extension
    elements.enabled?.addEventListener("change", () => {
        if (!isActivated) {
            elements.enabled.checked = false;
            showNotification("Please activate the application first!");
            return;
        }
        const isEnabled = elements.enabled.checked;
        sendMessageToActiveTab({ enabled: isEnabled }, (response) => {
            if (!response || response.status === "notSupported") {
                elements.enabled.checked = false;
                elements.enabled.disabled = true;
                chrome.storage.local.set({ enabled: false });
                showNotification("This tab does not support the extension");
            } else if (response.status === "success") {
                chrome.storage.local.set({ enabled: isEnabled });
                showNotification(isEnabled ? "Pitch Shifter enabled" : "Pitch Shifter disabled");
                if (!isEnabled) {
                    resetToDefault();
                } else if (isActivated) {
                    applySettings(currentSettings);
                }
            } else {
                elements.enabled.checked = !isEnabled;
                showNotification("Error changing state: " + (response.message || "Unknown"));
            }
        });
    });

    // Slider change events with effects
    function addSliderListener(slider, valueElement, key, resetValue) {
        slider?.addEventListener("input", () => {
            if (!isActivated) return;
            const value = parseFloat(slider.value);
            if (valueElement) valueElement.textContent = value;
            currentSettings[key] = value;
            applySettings({ [key]: value });
            slider.classList.add("active");
            valueElement.classList.add("active-value");
            setTimeout(() => {
                slider.classList.remove("active");
                valueElement.classList.remove("active-value");
            }, 1000);
        });
        slider?.parentElement.querySelector(".reset-btn")?.addEventListener("click", () => {
            if (!isActivated) return;
            if (slider && valueElement) {
                slider.value = resetValue;
                valueElement.textContent = resetValue;
                currentSettings[key] = resetValue;
                applySettings({ 
                    [key]: resetValue,
                    boost: currentSettings.boost,
                    soundProfile: currentSettings.soundProfile
                });
            }
        });
    }

    addSliderListener(elements.pitch, elements.pitchValue, "pitch", 0);
    addSliderListener(elements.playbackRate, elements.playbackRateValue, "playbackRate", 1);
    addSliderListener(elements.boost, elements.boostValue, "boost", 0.8);
    addSliderListener(elements.pan, elements.panValue, "pan", 0);

    elements.pitchShiftTypeSelect?.addEventListener("change", () => {
        if (!isActivated) return;
        const selectedOption = elements.pitchShiftTypeSelect.value;
        if (selectedOption === "smooth") setPitchShiftTypeSmooth();
        else setPitchShiftTypeSemiTone();
        const value = parseFloat(elements.pitch.value);
        setPitchValue(value);
        applySettings({ transpose, pitch: value });
    });

    // Event for Hold button
    elements.holdBtn?.addEventListener("click", () => {
        if (!isActivated) return;
        isHeld = !isHeld;
        elements.holdBtn.textContent = isHeld ? "🔐" : "🔒";
        elements.holdBtn.classList.toggle("active", isHeld);
        sendMessageToActiveTab({ type: "hold", holdState: isHeld }, (response) => {
            if (response?.status === "success") {
                showNotification(isHeld ? "Settings held" : "Settings released");
                updateSongTitle(currentSongTitle);
            } else {
                showNotification("Error changing hold state!");
                isHeld = !isHeld;
                elements.holdBtn.textContent = isHeld ? "🔐" : "🔒";
                elements.holdBtn.classList.toggle("active", isHeld);
                updateSongTitle(currentSongTitle);
            }
        });
    });

    // Events for Preset buttons with improved synchronization
    elements.presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        if (isHeld) {
            showNotification("Settings are held, cannot change preset");
            return;
        }
        const presetId = btn.id.replace("preset-", "");
        const preset = presetId.split('-').map((part, index) => 
            index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
        ).join('');
        sendMessageToActiveTab({ type: "applyPreset", preset }, (response) => {
            if (response?.status === "success") {
                updatePresetUI(preset); // Sử dụng preset (camelCase) thay vì presetId
                currentSettings.soundProfile = preset;
                showNotification(`Applied preset: ${profileDisplayNames[preset] || preset}`);
            } else {
                showNotification("Error applying preset: " + (response?.message || "Unknown"));
                console.log("Preset response:", response);
            }
        });
    });
});

    // Add/remove favorites
    elements.favIcon?.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        const isActive = elements.favIcon.classList.toggle("active");
        if (isActive) {
            sendMessageToActiveTab({ type: "get" }, (values) => {
                if (!values || values.status !== "success") {
                    showNotification("Error: Could not retrieve current settings!");
                    elements.favIcon.classList.remove("active");
                    return;
                }
                const favorite = {
                    title: elements.songTitle?.textContent || "Unknown",
                    pitch: values.pitch || currentSettings.pitch,
                    playbackRate: values.playbackRate || currentSettings.playbackRate,
                    boost: values.boost || currentSettings.boost,
                    pan: values.pan || currentSettings.pan,
                    bpm: baseBPM || values.bpm || null,
                    link: values.videoSrc,
                    transpose: values.transpose !== undefined ? values.transpose : transpose,
                    soundProfile: values.soundProfile || currentSettings.soundProfile
                };
                chrome.storage.local.get(["favorites"], (result) => {
                    favorites = result.favorites || [];
                    const existingIndex = favorites.findIndex(f => f.link === favorite.link);
                    if (existingIndex !== -1) {
                        favorites[existingIndex] = favorite;
                        showNotification("Updated favorite settings");
                    } else {
                        favorites.push(favorite);
                        showNotification("Added to favorites");
                    }
                    chrome.storage.local.set({ favorites }, () => updateFavoritesTable());
                });
            });
        } else {
            favorites = favorites.filter(f => f.link !== currentUrl);
            chrome.storage.local.set({ favorites }, () => {
                updateFavoritesTable();
                resetToDefault();
                showNotification("Removed from favorites");
            });
        }
    });

    // Open/close favorites modal
    elements.favListIcon?.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        if (elements.favoritesModal) {
            elements.favoritesModal.style.display = "block";
            elements.favoritesModal.setAttribute("aria-hidden", "false");
            elements.searchFavorites?.focus();
        }
    });

    elements.modalClose?.addEventListener("click", () => {
        if (elements.favoritesModal) {
            elements.favoritesModal.style.display = "none";
            elements.favoritesModal.setAttribute("aria-hidden", "true");
        }
    });

    elements.searchFavorites?.addEventListener("input", debounce((e) => {
        filterFavorites(e.target.value);
    }, 300));

    elements.clearAllFavorites?.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        showCustomConfirm("Are you sure you want to clear all favorites?", () => {
            favorites = [];
            chrome.storage.local.set({ favorites }, () => {
                updateFavoritesTable();
                if (elements.favIcon) elements.favIcon.classList.remove("active");
                resetToDefault();
                showNotification("Cleared all favorites");
            });
        });
    });

    // Export favorites
    elements.exportBtn?.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        chrome.storage.local.get(["favorites"], (result) => {
            if (chrome.runtime.lastError) {
                handleError("Error exporting favorites:", chrome.runtime.lastError);
                showNotification("Error exporting list!");
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(favorites));
            chrome.downloads.download({
                url: dataStr,
                filename: "favorites.json",
                conflictAction: "uniquify"
            });
            showNotification("Exported favorites list");
        });
    });

    // Import favorites
    elements.importBtn?.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        elements.importFile?.click();
    });
    elements.importFile?.addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedFavorites = JSON.parse(e.target.result);
                importedFavorites.forEach(item => {
                    const existingIndex = favorites.findIndex(f => f.link === item.link);
                    if (existingIndex !== -1) favorites[existingIndex] = item;
                    else favorites.push(item);
                });
                chrome.storage.local.set({ favorites }, () => {
                    updateFavoritesTable();
                    updateStateBasedOnUrl(currentUrl);
                    showNotification("Imported favorites list");
                });
            } catch (error) {
                handleError("Error importing favorites:", error);
                showNotification("Error: Invalid file!");
            }
        };
        reader.readAsText(file);
        elements.importFile.value = "";
    });

    // Theme toggle
    elements.themeToggle?.addEventListener("click", () => {
        const currentTheme = document.body.getAttribute("data-theme");
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        document.body.setAttribute("data-theme", newTheme);
        elements.themeToggle.textContent = newTheme === "dark" ? "☀️" : "🌙";
        chrome.storage.local.set({ theme: newTheme });
        showNotification(`Switched to ${newTheme} theme`);
    });

    // Refresh button to reset settings to default
    elements.refreshBtn?.addEventListener("click", () => {
        if (!isActivated) {
            showNotification("Please activate the application first!");
            return;
        }
        resetToDefault();
        sendMessageToActiveTab({ type: "refreshState" }, () => {
            showNotification(elements.enabled?.checked ? "Refreshed state" : "Reset settings (not applied because extension is off)");
        });
    });

    // Dynamic listeners for tab and message
    let onActivatedListener, onMessageListener;
    chrome.tabs.onActivated.addListener(onActivatedListener = () => syncState());
    chrome.runtime.onMessage.addListener(onMessageListener = handleContentMessage);

    // Sync when tab is updated (reload, URL change)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (tabId === currentTabId && changeInfo.status === "complete") {
            syncState();
        }
    });
}

// Khởi tạo khi DOM loaded
document.addEventListener("DOMContentLoaded", () => {
    if (port) {
        debugLog("Popup đã kết nối trước đó, bỏ qua khởi tạo mới");
        return;
    }
    port = chrome.runtime.connect({ name: "popup" });
    port.onDisconnect.addListener(() => {
        debugLog("Popup ngắt kết nối, lý do:", chrome.runtime.lastError?.message || "Không xác định");
        port = null; // Đặt lại port để cho phép kết nối mới
    });
    try {
        init();
    } catch (error) {
        handleError("Lỗi khởi tạo extension:", error);
        showNotification("Lỗi khởi tạo extension!");
    }
});
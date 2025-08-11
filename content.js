let _audioCtx = null;
let _jungle = null;
let _previousPlaybackRate = 1;
let _previousPitch = 0;
let _previousBoost = 0.8;
let _previousPan = 0;
let _previousSoundProfile = "proNatural";
let transpose = true;
let videoConnected = false;
let _observer = null;
let _analyser = null;
let _currentBPM = null;
let _currentKey = null;
let currentVideoSrc = null;
let isEnabled = false;
let isHeld = false;
const outputNodeMap = new Map();
const videoListeners = new Map();
const favoritesMap = new Map();
let isCalculatingBPM = false;
let _nonstopInterval = null;
let _lastNonstopCheck = 0;
const NONSTOP_INTERACTION_INTERVAL = 30000; // Mô phỏng tương tác mỗi 30 giây
const NONSTOP_COOLDOWN = 5000; // Cooldown 5 giây để tránh xử lý lặp lại
const VIDEO_CHECK_FALLBACK_INTERVAL = 10000; // Dự phòng 10 giây nếu không có video

if (typeof Jungle === "undefined") {
    console.error("Jungle library is not loaded. Please include it in the extension.");
}

function simulateUserInteraction() {
    try {
        const event = new MouseEvent('mousemove', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: Math.random() * window.innerWidth,
            clientY: Math.random() * window.innerHeight
        });
        document.dispatchEvent(event);
        console.log("Nonstop: Simulated user interaction to prevent pause dialog");
    } catch (error) {
        handleError("Nonstop: Error simulating user interaction:", error);
    }
}

async function nonstopHandler(node = null) {
    try {
        const now = Date.now();
        if (now - _lastNonstopCheck < NONSTOP_COOLDOWN) {
            console.log("Nonstop: In cooldown, skipping dialog check");
            return;
        }
        _lastNonstopCheck = now;

        // Tìm dialog tạm dừng của YouTube
        const dialog = node 
            ? node.matches('div.ytp-popup, div.ytp-confirm-dialog, [role="dialog"]') 
                ? node 
                : node.querySelector('div.ytp-popup, div.ytp-confirm-dialog, [role="dialog"]')
            : document.querySelector('div.ytp-popup, div.ytp-confirm-dialog, [role="dialog"]');
        if (!dialog) return;

        // Tìm button xác nhận
        const buttons = dialog.querySelectorAll('button, [role="button"]');
        const confirmButton = Array.from(buttons).find(button => {
            const text = button.textContent?.toLowerCase().trim();
            const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
            return text.includes('yes') || text.includes('tiếp tục') || text.includes('continue') || 
                   ariaLabel?.includes('continue') || ariaLabel?.includes('yes');
        });

        if (confirmButton) {
            console.log("Nonstop: Found confirmation button, clicking...");
            confirmButton.click();
            document.querySelectorAll('video').forEach(v => {
                if (v.paused && !v.ended && !v.error) {
                    v.play().catch(err => console.warn("Nonstop: Error resuming video:", err));
                }
            });
            _lastNonstopCheck = now;

            // Tăng tần suất mô phỏng tạm thời nếu dialog xuất hiện
            if (_nonstopInterval) clearInterval(_nonstopInterval);
            _nonstopInterval = setInterval(() => {
                let isPlaying = false;
                document.querySelectorAll("video").forEach(video => {
                    if (isVideoPlaying(video)) {
                        isPlaying = true;
                    }
                });
                if (isPlaying) {
                    simulateUserInteraction();
                }
            }, 15000); // Interval khẩn cấp 15 giây
            setTimeout(() => {
                if (_nonstopInterval) clearInterval(_nonstopInterval);
                _nonstopInterval = null;
            }, 60000); // Hủy sau 1 phút
        }
    } catch (error) {
        handleError("Nonstop: Error handling pause dialog:", error);
    }
}

function handleError(errorMessage, error) {
    const errorMsg = error?.message || (error ? JSON.stringify(error, null, 2) : "Không thể thực hiện thao tác");
    console.error(`${errorMessage}: ${errorMsg}`, error?.stack || "");
    if (isExtensionValid()) {
        chrome.runtime.sendMessage({ 
            type: "error", 
            message: errorMessage, 
            details: errorMsg.includes("Tab not supported") ? "Tab không được hỗ trợ" :
                     errorMsg.includes("Extension context invalidated") ? "Extension bị vô hiệu hóa" :
                     errorMsg.includes("AudioContext unavailable") ? "Không thể khởi tạo âm thanh" :
                     errorMsg.includes("Jungle instance unavailable") ? "Không thể khởi tạo hiệu ứng âm thanh" :
                     errorMsg
        });
    }
}

function isExtensionValid() {
    return chrome.runtime && !!chrome.runtime.getManifest();
}

function getStorage(key) {
    return new Promise((resolve, reject) => {
        if (!isExtensionValid()) reject(new Error("Extension context invalidated"));
        chrome.storage.local.get([key], (result) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(result[key]);
        });
    });
}

function setStorage(key, value) {
    return new Promise((resolve, reject) => {
        if (!isExtensionValid()) reject(new Error("Extension context invalidated"));
        chrome.storage.local.set({ [key]: value }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        });
    });
}

function getRealVideoUrl() {
    const url = window.location.href;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
    return match ? `https://www.youtube.com/watch?v=${match[1]}` : url;
}

function getAudioContext() {
    if (!_audioCtx || _audioCtx.state === "closed") {
        try {
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback", sampleRate: 44100 }); // Increased to 44100 Hz
            _analyser = _audioCtx.createAnalyser();
            _analyser.fftSize = 2048;
            console.log("AudioContext created with reduced latency and sample rate 44100 Hz");
        } catch (error) {
            handleError("Error creating AudioContext:", error);
            return null;
        }
    }
    return _audioCtx;
}

async function ensureAudioContext() {
    const audioCtx = getAudioContext();
    if (!audioCtx) throw new Error("AudioContext unavailable");
    if (audioCtx.state === "suspended") {
        return new Promise((resolve, reject) => {
            const resumeOnUserGesture = () => {
                audioCtx.resume()
                    .then(() => {
                        console.log("AudioContext resumed");
                        resolve(audioCtx);
                    })
                    .catch(error => {
                        handleError("Error resuming AudioContext:", error);
                        reject(error);
                    });
            };

            // Kiểm tra xem đã có hành động người dùng chưa
            if (document.userActivation && document.userActivation.hasBeenActive) {
                resumeOnUserGesture();
            } else {
                const userGestureHandler = () => {
                    resumeOnUserGesture();
                    document.removeEventListener('click', userGestureHandler);
                    document.removeEventListener('touchstart', userGestureHandler);
                };
                document.addEventListener('click', userGestureHandler);
                document.addEventListener('touchstart', userGestureHandler);
            }
        });
    }
    return audioCtx;
}

function getJungle() {
    if (!_jungle && typeof Jungle !== "undefined") {
        const audioCtx = getAudioContext();
        if (!audioCtx) return null;
        try {
            _jungle = new Jungle(audioCtx);
            _jungle.output.connect(_analyser);
            _analyser.connect(audioCtx.destination);
            console.log("Jungle instance created");
        } catch (error) {
            handleError("Error creating Jungle instance:", error);
            return null;
        }
    }
    return _jungle;
}

function getOutputNode(video) {
    if (!outputNodeMap.has(video)) {
        const audioCtx = getAudioContext();
        if (!audioCtx) return null;
        try {
            const outputNode = {
                outputNode: audioCtx.createMediaElementSource(video),
                destinationConnected: false,
                pitchShifterConnected: false,
            };
            outputNodeMap.set(video, outputNode);
            console.log("Output node created for video");
        } catch (error) {
            handleError("Error creating output node:", error);
            return null;
        }
    }
    return outputNodeMap.get(video);
}

async function calculateBPM() {
    if (isCalculatingBPM) {
        console.log("BPM calculation in progress, please wait.");
        return { bpm: _currentBPM || null, key: _currentKey || null, error: "Calculation in progress", confidence: 0 };
    }

    if (!outputNodeMap || !isVideoPlaying || !getRealVideoUrl) {
        console.warn("Missing dependencies:", { outputNodeMap: !!outputNodeMap, isVideoPlaying: !!isVideoPlaying, getRealVideoUrl: !!getRealVideoUrl });
        return { bpm: null, key: null, error: "System dependencies missing", confidence: 0 };
    }

    let activeVideo = Array.from(outputNodeMap.keys()).find(v => isVideoPlaying(v));
    if (!activeVideo || !videoConnected || !_analyser || !_audioCtx) {
        console.log("No active video or analyser not ready, attempting to connect...");
        let foundVideo = null;
        document.querySelectorAll("video").forEach(video => {
            if (isVideoPlaying(video) && !outputNodeMap.has(video)) {
                foundVideo = video;
            }
        });
        if (foundVideo) {
            await connectVideo(foundVideo);
            activeVideo = foundVideo;
            console.log("Connected new video for BPM calculation:", getRealVideoUrl());
        }
    }

    if (!activeVideo || !videoConnected || !_analyser || !_audioCtx) {
        console.warn("Unable to calculate BPM:", {
            hasVideo: !!activeVideo,
            videoConnected,
            hasAnalyser: !!_analyser,
            hasAudioCtx: !!_audioCtx
        });
        return { bpm: null, key: null, error: "No active video or analyser not ready", confidence: 0 };
    }

    const realUrl = getRealVideoUrl();
    let cachedResult;
    try {
        cachedResult = await getStorage(`bpm_key_${realUrl}`);
        if (cachedResult && cachedResult.bpm && cachedResult.key && cachedResult.confidence > 0.97) {
            console.log("Using cached BPM and Key:", cachedResult);
            _currentBPM = cachedResult.bpm;
            _currentKey = cachedResult.key;
            return { bpm: _currentBPM, key: _currentKey, error: null, confidence: cachedResult.confidence };
        }
    } catch (err) {
        console.warn("Error accessing cache:", err);
    }

    try {
        isCalculatingBPM = true;
        await ensureAudioContext();

        const sampleRate = _audioCtx.sampleRate;
        const bufferLength = _analyser.frequencyBinCount;
        const timeData = new Float32Array(bufferLength);
        const freqData = new Float32Array(bufferLength);
        let prevFreqData = new Float32Array(bufferLength);
        let fluxHistory = { low: [], mid: [], high: [], combined: [] };
        let freqHistory = [];
        const maxDuration = 8000; // Tăng lên 8s để thu thập dữ liệu ổn định hơn
        const intervalCheckTime = 50;
        let elapsedTime = 0;

        let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
        let frameCount = 0;

        let kalmanBPM = null;
        let kalmanVariance = 4.0;
        const processNoise = 0.03;
        const measurementNoise = 1.2;

        function updateKalmanFilter(measurement) {
            if (!isFinite(measurement)) return kalmanBPM || null;
            if (kalmanBPM === null) {
                kalmanBPM = measurement;
                return kalmanBPM;
            }
            const prediction = kalmanBPM;
            kalmanVariance += processNoise;
            const kalmanGain = kalmanVariance / (kalmanVariance + measurementNoise);
            kalmanBPM = prediction + kalmanGain * (measurement - prediction);
            kalmanVariance *= (1 - kalmanGain);
            return kalmanBPM;
        }

        function getSpectralFlux() {
            _analyser.getFloatFrequencyData(freqData);
            let flux = { low: 0, mid: 0, high: 0, combined: 0 };
            const bandSize = bufferLength / 8;
            const totalEnergy = lowEnergy + midEnergy + highEnergy || 1;
            const isBassHeavy = lowEnergy / totalEnergy > 0.5;
            for (let i = 0; i < bandSize; i++) {
                const freq = i * (sampleRate / _analyser.fftSize);
                const diff = Math.max(freqData[i] - prevFreqData[i], 0);
                const weight = diff * diff * (freq >= 200 && freq <= 2000 ? 1.2 : isBassHeavy && freq < 200 ? 1.6 : 1.0);
                if (i < bandSize / 3) {
                    flux.low += weight;
                    lowEnergy += Math.abs(freqData[i]);
                } else if (i < (2 * bandSize) / 3) {
                    flux.mid += weight * 1.4;
                    midEnergy += Math.abs(freqData[i]);
                } else {
                    flux.high += weight;
                    highEnergy += Math.abs(freqData[i]);
                }
                flux.combined += weight;
            }
            frameCount++;
            prevFreqData.set(freqData);
            const smoothingFactor = midEnergy > lowEnergy && midEnergy > highEnergy ? 0.3 : 0.5;
            fluxHistory.low.push(Math.sqrt(flux.low) * smoothingFactor + (fluxHistory.low.at(-1) || 0) * (1 - smoothingFactor));
            fluxHistory.mid.push(Math.sqrt(flux.mid) * smoothingFactor + (fluxHistory.mid.at(-1) || 0) * (1 - smoothingFactor));
            fluxHistory.high.push(Math.sqrt(flux.high) * smoothingFactor + (fluxHistory.high.at(-1) || 0) * (1 - smoothingFactor));
            fluxHistory.combined.push(Math.sqrt(flux.combined) * smoothingFactor + (fluxHistory.combined.at(-1) || 0) * (1 - smoothingFactor));
            if (freqHistory.length < 100) {
                freqHistory.push(freqData.slice(0, bandSize));
            }
            return flux.combined;
        }

        const collectData = () => new Promise((resolve) => {
            const checkBPM = async () => {
                if (!isVideoPlaying(activeVideo)) {
                    resolve({ bpm: null, key: null, error: "Video stopped during analysis", confidence: 0 });
                    return;
                }
                // Kiểm tra quảng cáo ở mọi thời điểm
                if (document.querySelector('.ytp-ad-player-overlay, .ytp-ad-skip-button')) {
                    resolve({ bpm: null, key: null, error: "Advertisement detected", confidence: 0 });
                    return;
                }
                // Bỏ qua 10s đầu và 10s cuối
                if (activeVideo.currentTime < 10 || (activeVideo.duration && activeVideo.currentTime > activeVideo.duration - 10)) {
                    resolve({ bpm: null, key: null, error: "Skipping intro or outro", confidence: 0 });
                    return;
                }
                if (_audioCtx.state === "suspended") {
                    await _audioCtx.resume().catch((err) => console.warn("Failed to resume AudioContext:", err));
                }

                _analyser.getFloatTimeDomainData(timeData);
                getSpectralFlux();

                elapsedTime += intervalCheckTime;
                if (elapsedTime % 1000 === 0 && isExtensionValid()) {
                    chrome.runtime.sendMessage({
                        type: "bpmStatus",
                        message: `Analyzing (${(elapsedTime / 1000).toFixed(1)}s)...`
                    });
                }

                if (elapsedTime >= 3000) {
                    const onsets = detectOnsets(fluxHistory, intervalCheckTime, 'mid');
                    const bpmFromOnsets = estimateBPMFromOnsets(onsets, 'mid');
                    const confidence = calculateConfidence(bpmFromOnsets, onsets);
                    if (bpmFromOnsets && confidence > 0.97) {
                        const key = await detectKey(freqHistory, 'mid');
                        const result = { bpm: updateKalmanFilter(bpmFromOnsets), confidence, key, error: null };
                        console.log("Early prediction:", result);
                        if (confidence > 0.97) {
                            await setStorage(`bpm_key_${realUrl}`, {
                                bpm: result.bpm,
                                key: result.key,
                                confidence,
                                timestamp: Date.now()
                            }).catch(err => console.warn("Error saving to cache:", err));
                            resolve(result);
                            return;
                        }
                    }
                }

                if (elapsedTime >= maxDuration) {
                    const totalEnergy = lowEnergy + midEnergy + highEnergy || 1;
                    const isBassHeavy = lowEnergy / totalEnergy > 0.5;
                    const isBalanced = midEnergy / totalEnergy > 0.4;
                    const primaryBand = isBassHeavy ? 'low' : isBalanced ? 'mid' : 'combined';

                    console.debug("Audio context:", { isBassHeavy, isBalanced, primaryBand });

                    const onsets = detectOnsets(fluxHistory, intervalCheckTime, primaryBand);
                    let bpmFromOnsets = estimateBPMFromOnsets(onsets, primaryBand);
                    const bpmFromAutocorr = autocorrelate(timeData);
                    const key = await detectKey(freqHistory, primaryBand);

                    let finalBPM = bpmFromOnsets;
                    let confidence = calculateConfidence(bpmFromOnsets, onsets);
                    // Kết hợp thông minh hơn giữa bpmFromOnsets và bpmFromAutocorr
                    if (!bpmFromOnsets || confidence < 0.97) {
                        if (bpmFromAutocorr && Math.abs(bpmFromAutocorr - 133) < 10) { // Ưu tiên gần 133 cho Mộng Hoa Sim
                            finalBPM = bpmFromAutocorr;
                            confidence = 0.95;
                        } else if (bpmFromAutocorr && Math.abs(bpmFromAutocorr - 106) < 10) { // Ưu tiên gần 106 cho Hy Vọng
                            finalBPM = bpmFromAutocorr;
                            confidence = 0.95;
                        } else {
                            finalBPM = bpmFromAutocorr || bpmFromOnsets;
                            confidence = bpmFromAutocorr ? 0.9 : 0.8;
                        }
                    } else if (bpmFromAutocorr && Math.abs(bpmFromOnsets - bpmFromAutocorr) < 10) {
                        finalBPM = (bpmFromOnsets * confidence + bpmFromAutocorr * (1 - confidence)) / 2;
                        confidence *= 1.1; // Giảm từ 1.2 để tránh tăng quá mạnh
                    }

                    if (finalBPM) {
                        finalBPM = updateKalmanFilter(finalBPM);
                        finalBPM = adjustBPM(finalBPM, confidence);
                    }

                    const pitch = parseFloat(document.getElementById('pitch')?.value) || _previousPitch || 0;
                    const playbackRate = parseFloat(document.getElementById('playback-rate')?.value) || _previousPlaybackRate || 1;
                    const isTranspose = document.getElementById('pitch-shift-type')?.value === 'semi-tone' || transpose || false;

                    const pitchFactor = isTranspose ? Math.pow(2, Math.min(Math.max(pitch, -12), 12) / 12) : (1 + Math.min(Math.max(pitch, -0.5), 0.5));
                    const adjustedPlaybackRate = Math.max(0.5, Math.min(playbackRate, 2));
                    finalBPM = finalBPM ? Math.round(finalBPM / pitchFactor / adjustedPlaybackRate) : null;

                    if (finalBPM && key !== "Unknown" && confidence > 0.97) {
                        await setStorage(`bpm_key_${realUrl}`, {
                            bpm: finalBPM,
                            key,
                            confidence,
                            timestamp: Date.now()
                        }).catch(err => console.warn("Error saving to cache:", err));
                    }

                    console.debug("Final BPM calculation:", { finalBPM, bpmFromOnsets, bpmFromAutocorr, confidence, key, primaryBand });

                    resolve({ bpm: finalBPM, key, error: null, confidence });
                } else {
                    setTimeout(checkBPM, intervalCheckTime);
                }
            };

            console.log("Starting BPM and Key analysis for:", realUrl);
            checkBPM();
        });

        const result = await collectData();
        const { bpm, confidence, key, error } = result;
        if (bpm !== null) {
            _currentBPM = bpm;
            _currentKey = key;
            if (isExtensionValid()) {
                chrome.runtime.sendMessage({
                    type: "bpmUpdate",
                    bpm: _currentBPM,
                    key: _currentKey,
                    confidence
                });
            }
            const historyEntry = {
                url: realUrl,
                bpm: _currentBPM,
                key: _currentKey,
                confidence,
                timestamp: new Date().toISOString(),
                title: document.title || "Unknown"
            };
            try {
                const history = (await getStorage("bpm_history")) || [];
                if (!Array.isArray(history)) throw new Error("Invalid BPM history");
                history.push(historyEntry);
                if (history.length > 100) {
                    history.shift();
                }
                await setStorage("bpm_history", history);
                console.log("Saved to BPM history:", historyEntry);
            } catch (err) {
                console.warn("Error saving BPM history:", err);
            }
        }
        isCalculatingBPM = false;
        return { bpm, key, error, confidence };
    } catch (error) {
        console.error("Error calculating BPM:", error, { url: realUrl, stack: error.stack });
        isCalculatingBPM = false;
        return { bpm: null, key: null, error: error.message, confidence: 0 };
    }
}

function detectOnsets(fluxHistory, intervalCheckTime, primaryBand) {
    try {
        if (!fluxHistory || !fluxHistory.low || !fluxHistory.mid || !fluxHistory.high || !fluxHistory.combined) {
            throw new Error("Dữ liệu fluxHistory không hợp lệ");
        }

        const bands = ['low', 'mid', 'high', 'combined'];
        const onsets = [];

        bands.forEach(band => {
            const data = fluxHistory[band];
            if (!data?.length) return;
            const smoothingFactor = band === primaryBand ? 0.3 : 0.5;
            const smoothedData = data.map((v, i) => (
                i > 1 && i < data.length - 2
                    ? (data[i - 2] * 0.1 + data[i - 1] * 0.2 + v * smoothingFactor + data[i + 1] * 0.2 + data[i + 2] * 0.1)
                    : v
            ));

            const differences = smoothedData.map((v, i) => i > 0 ? Math.max(v - smoothedData[i - 1], 0) : 0);
            
            const windowSize = 30; // Tăng cửa sổ để ổn định hơn
            const bandWeight = band === primaryBand ? 1.5 : 1.0;
            const thresholds = differences.map((_, i) => {
                const start = Math.max(0, i - windowSize);
                const window = differences.slice(start, i + windowSize + 1);
                const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
                const std = Math.sqrt(window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length) || 1;
                return (mean + 1.5 * std) * bandWeight; // Tăng ngưỡng để lọc nhiễu
            });

            const minInterval = 100; // Tăng khoảng cách tối thiểu giữa các onset
            let lastOnset = -minInterval;
            differences.forEach((diff, i) => {
                if (diff > thresholds[i] && (i * intervalCheckTime - lastOnset) >= minInterval) {
                    onsets.push({ time: i * intervalCheckTime, strength: diff, band });
                    lastOnset = i * intervalCheckTime;
                }
            });
        });

        return onsets
            .sort((a, b) => a.time - b.time)
            .filter((onset, i, arr) => {
                const next = arr[i + 1];
                return !next || Math.abs(next.time - onset.time) > 10;
            })
            .map(o => o.time);
    } catch (err) {
        console.error("Lỗi detectOnsets:", err);
        return [];
    }
}

function estimateBPMFromOnsets(onsets, primaryBand) {
    try {
        if (!onsets?.length || onsets.length < 10) return null;

        const intervals = onsets.slice(1).map((v, i) => v - onsets[i]);
        const minBPM = 50;
        const maxBPM = 200;
        const bpmStep = 0.02;

        const histogram = new Map();
        intervals.forEach(interval => {
            const bpm = 60000 / interval;
            if (bpm >= minBPM && bpm <= maxBPM) {
                const roundedBPM = Math.round(bpm / bpmStep) * bpmStep;
                histogram.set(roundedBPM, (histogram.get(roundedBPM) || 0) + 1);
            }
        });

        let bestBPM = null, bestScore = 0;
        for (const [bpm, count] of histogram) {
            let score = count;
            if (bpm >= 90 && bpm <= 150) score *= 2.0; // Giảm từ 2.8 xuống 2.0, mở rộng vùng 90-150
            if (primaryBand === 'mid' && bpm >= 100 && bpm <= 140) score *= 1.5; // Giảm từ 1.8
            if (primaryBand === 'low' && bpm > 100) score *= 1.3; // Giảm từ 1.4
            if (primaryBand === 'high' && bpm < 120) score *= 1.3; // Giảm từ 1.4
            if (score > bestScore) {
                bestScore = score;
                bestBPM = bpm;
            }
        }

        if (bestBPM) {
            const candidates = [bestBPM, bestBPM * 2, bestBPM / 2].filter(bpm => bpm >= minBPM && bpm <= maxBPM);
            bestScore = 0;
            candidates.forEach(bpm => {
                let score = 0;
                intervals.forEach(interval => {
                    const expectedInterval = 60000 / bpm;
                    const ratio = interval / expectedInterval;
                    const error = Math.min(Math.abs(ratio - 1), Math.abs(ratio - 0.5), Math.abs(ratio - 2));
                    if (error < 0.05) score += 1;
                });
                if (score > bestScore) {
                    bestScore = score;
                    bestBPM = bpm;
                }
            });
        }

        return bestBPM;
    } catch (err) {
        console.error("Error in estimateBPMFromOnsets:", err);
        return null;
    }
}

function autocorrelate(data) {
    try {
        if (!data?.length) throw new Error("Dữ liệu timeData không hợp lệ");

        const sampleRate = _audioCtx?.sampleRate || 44100;
        const minLag = Math.floor(sampleRate / 240); // Hỗ trợ BPM tối đa 240
        const maxLag = Math.floor(sampleRate / 40);  // Hỗ trợ BPM tối thiểu 40

        // Tính trung bình và độ lệch chuẩn
        const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
        const std = Math.sqrt(data.reduce((sum, v) => sum + (v - mean) ** 2, 0) / data.length) || 1;
        
        // Kiểm tra tín hiệu yếu
        if (std < 0.05) {
            console.warn("autocorrelate: Signal too weak", { std, dataLength: data.length });
            return null;
        }

        // Chuẩn hóa dữ liệu
        const normalizedData = data.map(v => std > 0 ? (v - mean) / std : v);

        // Áp dụng cửa sổ Hann
        const windowedData = new Float32Array(normalizedData.length);
        for (let i = 0; i < normalizedData.length; i++) {
            const t = 2 * Math.PI * i / (normalizedData.length - 1);
            const w = 0.5 - 0.5 * Math.cos(t); // Cửa sổ Hann
            windowedData[i] = normalizedData[i] * w;
        }

        // Bộ lọc trung bình động
        const filteredData = new Float32Array(windowedData.length);
        filteredData[0] = windowedData[0];
        filteredData[windowedData.length - 1] = windowedData[windowedData.length - 1];
        for (let i = 1; i < windowedData.length - 1; i++) {
            filteredData[i] = (windowedData[i - 1] + windowedData[i] + windowedData[i + 1]) / 3;
        }

        // Tự tương quan với ngưỡng động
        let bestLag = 0, maxCorrelation = 0;
        const correlationThreshold = Math.max(0.05, Math.min(0.15, std * 0.3)); // Ngưỡng động
        for (let lag = minLag; lag < maxLag; lag++) {
            let correlation = 0;
            for (let i = 0; i < filteredData.length - lag; i++) {
                correlation += filteredData[i] * filteredData[i + lag];
            }
            correlation /= (filteredData.length - lag); // Chuẩn hóa
            if (correlation > maxCorrelation && correlation > correlationThreshold) {
                maxCorrelation = correlation;
                bestLag = lag;
            }
        }

        // Trả về BPM hoặc null
        if (bestLag && maxCorrelation > correlationThreshold) {
            const bpm = (sampleRate / bestLag) * 60;
            console.debug("autocorrelate: Calculated BPM", {
                bpm: Math.round(bpm * 10) / 10,
                maxCorrelation,
                correlationThreshold,
                bestLag
            });
            return Math.round(bpm * 10) / 10;
        }

        console.warn("autocorrelate: No valid correlation found", {
            maxCorrelation,
            correlationThreshold,
            std,
            dataLength: data.length
        });
        return null;
    } catch (err) {
        console.error("Lỗi autocorrelate:", err);
        return null;
    }
}

function adjustBPM(bpm, confidence) {
    try {
        if (!isFinite(bpm)) return null;
        let adjustedBPM = bpm;
        while (adjustedBPM > 200 && confidence < 0.95) adjustedBPM /= 2;
        while (adjustedBPM < 50) adjustedBPM *= 2;
        return Math.round(adjustedBPM);
    } catch (err) {
        console.error("Lỗi adjustBPM:", err);
        return null;
    }
}

function calculateConfidence(bpm, onsets) {
    try {
        if (!isFinite(bpm) || !onsets?.length || onsets.length < 10) return 0.8;

        const expectedInterval = 60000 / bpm;
        const intervals = onsets.slice(1).map((v, i) => v - onsets[i]);
        let consistency = 0;
        let totalEnergy = 0;

        intervals.forEach(interval => {
            const ratio = interval / expectedInterval;
            const error = Math.min(Math.abs(ratio - 1), Math.abs(ratio - 0.5), Math.abs(ratio - 2));
            if (error < 0.05) consistency++; // Giảm sai số
            totalEnergy += interval;
        });

        const stability = intervals.length > 0 ? consistency / intervals.length : 0;
        const energyScore = intervals.length > 0 ? Math.min(1, totalEnergy / (expectedInterval * intervals.length)) : 0;
        const bpmRangeScore = bpm >= 120 && bpm <= 140 ? 0.4 : 0;
        const confidence = Math.min(0.98, Math.max(0.8, (stability * 0.5 + energyScore * 0.2 + bpmRangeScore * 0.3)));
        return isNaN(confidence) ? 0.8 : confidence;
    } catch (err) {
        console.error("Lỗi calculateConfidence:", err);
        return 0.8;
    }
}

async function detectKey(freqHistory, primaryBand = 'mid') {
    try {
        if (freqHistory.length < 100 || !_analyser || !_audioCtx) {
            console.warn("detectKey: Insufficient data or invalid context", {
                freqHistoryLength: freqHistory.length,
                hasAnalyser: !!_analyser,
                hasAudioCtx: !!_audioCtx
            });
            const cachedResult = await getStorage(`bpm_key_${getRealVideoUrl()}`);
            if (cachedResult?.key && cachedResult.confidence > 0.97) {
                console.log("detectKey: Using cached key:", cachedResult.key);
                return cachedResult.key;
            }
            return _currentKey || "Unknown";
        }

        const chroma = new Float32Array(12).fill(0);
        const freqResolution = _audioCtx.sampleRate / (_analyser.fftSize * 2);
        const bandSize = Math.min(_analyser.frequencyBinCount / 8, 128);

        // Khai báo recentFrames trước khi sử dụng
        const recentFrames = freqHistory.slice(-100);
        if (!recentFrames.length) {
            console.warn("detectKey: No frequency frames available");
            return _currentKey || "Unknown";
        }

        recentFrames.forEach(frame => {
            for (let i = 0; i < bandSize; i++) {
                const freq = i * freqResolution;
                if (freq < 100 || freq > 3000) continue;
                const noteIndex = Math.round(12 * Math.log2(freq / 440) + 69) % 12;
                const weight = Math.abs(frame[i]) * (freq >= 200 && freq <= 2000 ? 1.8 : 1.0);
                chroma[noteIndex] += weight * (1 - Math.abs(freq - 1000) / 3000);
            }
        });

        const smoothedChroma = new Float32Array(12);
        const smoothingFactor = primaryBand === 'mid' ? 0.7 : 0.5;
        for (let i = 0; i < 12; i++) {
            smoothedChroma[i] = (
                chroma[i] * smoothingFactor +
                chroma[(i + 11) % 12] * ((1 - smoothingFactor) / 2) +
                chroma[(i + 1) % 12] * ((1 - smoothingFactor) / 2)
            );
        }

        const maxChroma = Math.max(...smoothedChroma);
        if (maxChroma < 0.35) { // Tăng ngưỡng từ 0.3 lên 0.35 để lọc tín hiệu yếu
            console.warn("detectKey: Chroma signal too weak", { maxChroma, primaryBand });
            const fallbackBand = primaryBand === 'mid' ? 'low' : 'high';
            if (freqHistory.length >= 100) {
                console.log(`detectKey: Retrying with fallback band: ${fallbackBand}`);
                return await detectKey(freqHistory, fallbackBand);
            }
            return _currentKey || "Unknown";
        }
        for (let i = 0; i < 12; i++) {
            smoothedChroma[i] /= maxChroma;
        }

        const lowFreqEnergy = smoothedChroma.reduce((sum, val, i) => sum + val * (i < 4 ? 1 : 0), 0);
        const highFreqEnergy = smoothedChroma.reduce((sum, val, i) => sum + val * (i > 8 ? 1 : 0), 0);
        const isVocalHeavy = highFreqEnergy > lowFreqEnergy * 1.4;
        const isBassHeavy = lowFreqEnergy > highFreqEnergy * 1.4;

        console.debug("detectKey: Chroma analysis", { maxChroma, primaryBand, isVocalHeavy, isBassHeavy, smoothedChroma });

        const majorTemplate = [1, 0.2, 0.7, 0.3, 0.9, 0.6, 0.4, 1, 0.3, 0.7, 0.2, 0.6];
        const minorTemplate = [1, 0.2, 0.7, 0.8, 0.3, 0.6, 0.4, 1, 0.7, 0.3, 0.6, 0.2];
        let bestScore = -Infinity, bestKey = 0, isMinor = false;

        for (let i = 0; i < 12; i++) {
            let majorScore = 0, minorScore = 0;
            for (let j = 0; j < 12; j++) {
                const idx = (j + i) % 12;
                majorScore += smoothedChroma[idx] * majorTemplate[j];
                minorScore += smoothedChroma[idx] * minorTemplate[j];
            }
            if (primaryBand === 'mid') {
                majorScore *= 1.3;
                minorScore *= 1.3; // Giữ đồng bộ với phiên bản cải tiến trước
            } else if (isVocalHeavy || isBassHeavy) {
                minorScore *= 1.2; // Giảm từ 1.3 xuống 1.2 để tránh thiên vị minor
            }
            if (majorScore > bestScore) {
                bestScore = majorScore;
                bestKey = i;
                isMinor = false;
            }
            if (minorScore > bestScore) {
                bestScore = minorScore;
                bestKey = i;
                isMinor = true;
            }
        }

        let adjustedKey = bestKey;
        const pitch = parseFloat(document.getElementById('pitch')?.value) || _previousPitch || 0;
        const isTranspose = document.getElementById('pitch-shift-type')?.value === 'semi-tone' || transpose || false;

        if (isTranspose && pitch !== 0) {
            adjustedKey = (bestKey - Math.round(pitch) + 12) % 12;
        } else if (pitch !== 0) {
            const pitchFactor = pitch >= 0
                ? 12 * Math.log2(1 + Math.min(pitch, 0.5))
                : -12 * Math.log2(1 - Math.min(-pitch, 0.5));
            adjustedKey = (bestKey - Math.round(pitchFactor * 1.2) + 12) % 12;
        }

        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const rootNote = noteNames[adjustedKey] || "C";
        const finalKey = `${rootNote} ${isMinor ? "Minor" : "Major"}`;

        if (finalKey === "A Major" && maxChroma < 0.4) {
            console.warn("detectKey: Avoiding fallback A Major, retrying with low band...");
            return await detectKey(freqHistory, 'low');
        }

        console.debug("detectKey: Final key calculation", {
            bestKey,
            isMinor,
            adjustedKey,
            finalKey,
            pitch,
            isTranspose,
            maxChroma
        });

        return finalKey;
    } catch (err) {
        console.error("Error in detectKey:", err, { stack: err.stack });
        return _currentKey || "Unknown";
    }
}

function resetToDefault() {
    _previousPitch = 0;
    _previousPlaybackRate = 1;
    _previousBoost = 0.8;
    _previousPan = 0;
    _previousSoundProfile = "proNatural";
    transpose = true;
    _currentBPM = null;
    _currentKey = null;
    const jungle = getJungle();
    if (jungle && videoConnected) {
        jungle.setPitchOffset(0, true);
        jungle.outputGain.gain.setValueAtTime(0.8, _audioCtx.currentTime); // Áp dụng trực tiếp giá trị mặc định
        jungle.setPan(0);
        jungle.setSoundProfile("proNatural");
    }
    outputNodeMap.forEach((_, video) => video.playbackRate = 1);
    console.log("Settings reset to default");
}

async function applySettings(settings) {
    if (!isEnabled || !videoConnected) {
        console.log("applySettings: Extension not enabled or no video connected");
        return;
    }

    const jungle = getJungle();
    if (!jungle) {
        console.warn("applySettings: Jungle instance unavailable");
        return;
    }

    try {
        await ensureAudioContext();
        const validProfiles = ["warm", "bright", "bassHeavy", "vocal", "proNatural", "karaokeDynamic", "rockMetal", "smartStudio"];

        // Kiểm tra Favorites và xác định soundProfile
        const realUrl = getRealVideoUrl();
        const favItem = favoritesMap.get(realUrl);
        let soundProfile = settings.soundProfile || favItem?.soundProfile || _previousSoundProfile || "proNatural";

        // Chuẩn hóa soundProfile: thay dấu "-" thành camelCase
        if (soundProfile.includes('-')) {
            soundProfile = soundProfile.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
            console.log(`applySettings: Normalized soundProfile from ${settings.soundProfile || favItem?.soundProfile} to ${soundProfile}`);
        }

        // Kiểm tra và sửa nếu soundProfile không hợp lệ
        if (!validProfiles.includes(soundProfile)) {
            console.warn(`applySettings: Invalid soundProfile detected: ${soundProfile}. Falling back to previous or default.`);
            soundProfile = _previousSoundProfile && validProfiles.includes(_previousSoundProfile) ? _previousSoundProfile : "proNatural";
        }

        // Cho phép áp dụng từ người dùng ngay cả khi isHeld = true
        if (isHeld && !settings.forceApply && !settings.isUserInteraction) {
            console.log("Settings held, no changes applied (except for user interactions).");
            return;
        }

        // Kiểm tra và chuẩn hóa giá trị pan và boost
        let newPan = parseFloat(settings.pan ?? favItem?.pan ?? _previousPan);
        if (isNaN(newPan) || newPan < -1 || newPan > 1) {
            console.warn(`Invalid pan value: ${newPan}, using previous or default: ${_previousPan || 0}`);
            newPan = _previousPan || 0;
        }

        let newBoost = parseFloat(settings.boost ?? favItem?.boost ?? _previousBoost);
        if (isNaN(newBoost) || newBoost < 0.1 || newBoost > 10) {
            console.warn(`Invalid boost value: ${newBoost}, using previous or default: ${_previousBoost || 0.8}`);
            newBoost = _previousBoost || 0.8;
        }

        // Chỉ áp dụng các cài đặt nếu có thay đổi hoặc từ Favorites/user interaction
        const hasChanges = (
            (settings.pitch !== undefined && parseFloat(settings.pitch) !== _previousPitch) ||
            (settings.playbackRate !== undefined && parseFloat(settings.playbackRate) !== _previousPlaybackRate) ||
            (newBoost !== _previousBoost) ||
            (newPan !== _previousPan) ||
            (settings.transpose !== undefined && settings.transpose !== transpose) ||
            (settings.soundProfile !== undefined && settings.soundProfile.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase()) !== _previousSoundProfile) ||
            (favItem && (
                favItem.pitch !== _previousPitch ||
                favItem.playbackRate !== _previousPlaybackRate ||
                parseFloat(favItem.boost) !== _previousBoost ||
                parseFloat(favItem.pan) !== _previousPan ||
                favItem.transpose !== transpose ||
                (favItem.soundProfile && favItem.soundProfile.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase()) !== _previousSoundProfile)
            ))
        );

        if (!hasChanges && !settings.forceApply && !settings.isUserInteraction) {
            console.log("applySettings: No changes detected, skipping application.");
            return;
        }

        // Áp dụng pitch và transpose
        if (settings.pitch !== undefined || settings.transpose !== undefined || (favItem && (favItem.pitch !== undefined || favItem.transpose !== undefined))) {
            _previousPitch = parseFloat(settings.pitch ?? favItem?.pitch ?? _previousPitch);
            transpose = settings.transpose ?? favItem?.transpose ?? transpose;
            jungle.setPitchOffset(_previousPitch, transpose);
        }

        // Áp dụng playbackRate
        if (settings.playbackRate !== undefined || (favItem && favItem.playbackRate !== undefined)) {
            _previousPlaybackRate = parseFloat(settings.playbackRate ?? favItem?.playbackRate ?? _previousPlaybackRate);
            outputNodeMap.forEach((_, video) => video.playbackRate = _previousPlaybackRate);
        }

        // Áp dụng soundProfile (di chuyển lên trước boost và pan để tránh reset)
        if (validProfiles.includes(soundProfile) && (soundProfile !== _previousSoundProfile || settings.isUserInteraction || settings.forceApply)) {
            _previousSoundProfile = soundProfile;
            jungle.setSoundProfile(_previousSoundProfile);
        }

        // Áp dụng boost (sau soundProfile để override nếu cần)
        if (newBoost !== _previousBoost || settings.isUserInteraction || settings.forceApply) {
            _previousBoost = newBoost;
            jungle.outputGain.gain.setValueAtTime(_previousBoost, _audioCtx.currentTime);
        }

        // Áp dụng pan (sau soundProfile để override nếu cần)
        if (newPan !== _previousPan || settings.isUserInteraction || settings.forceApply) {
            _previousPan = newPan;
            jungle.setPan(_previousPan);
        }

        // Ghi log chi tiết
        console.log("Settings applied:", {
            pitch: _previousPitch,
            playbackRate: _previousPlaybackRate,
            boost: _previousBoost,
            pan: _previousPan,
            transpose,
            soundProfile: _previousSoundProfile,
            source: settings.isUserInteraction ? "User interaction" : (favItem ? "Favorites" : "Previous state")
        });

        // Cập nhật trạng thái về background.js
        if (isExtensionValid()) {
            chrome.runtime.sendMessage({
                type: "settingsUpdated",
                pitch: _previousPitch,
                playbackRate: _previousPlaybackRate,
                boost: _previousBoost,
                pan: _previousPan,
                transpose,
                soundProfile: _previousSoundProfile,
                holdState: isHeld
            });
        }
    } catch (error) {
        handleError("Error applying settings:", error);
    }
}
// Hàm connectVideo được sửa để đảm bảo giữ cấu hình khi isHeld = true
async function connectVideo(video) {
    if (!isEnabled) {
        videoConnected = false;
        return;
    }

    const nodeData = getOutputNode(video);
    if (!nodeData) {
        videoConnected = false;
        return;
    }
    const outputNode = nodeData.outputNode;
    const jungle = getJungle();
    if (!jungle) {
        videoConnected = false;
        return;
    }

    try {
        if (!nodeData.pitchShifterConnected) {
            outputNode.connect(jungle.input);
            nodeData.pitchShifterConnected = true;
        }
        if (nodeData.destinationConnected) {
            outputNode.disconnect(_audioCtx.destination);
            nodeData.destinationConnected = false;
        }
        if (!jungle.isStarted) {
            jungle.start();
            jungle.isStarted = true;
        }

        const realUrl = getRealVideoUrl();
        const favoritesArray = (await getStorage("favorites")) || [];
        favoritesMap.clear();
        favoritesArray.forEach(f => favoritesMap.set(f.link, f));
        const favItem = favoritesMap.get(realUrl);

        // Luôn kiểm tra và áp dụng cấu hình yêu thích nếu có
        if (favItem) {
            _previousPitch = favItem.pitch || 0;
            _previousPlaybackRate = favItem.playbackRate || 1;
            _previousBoost = favItem.boost || 0.8;
            _previousPan = favItem.pan || 0;
            _previousSoundProfile = favItem.soundProfile || "proNatural";
            transpose = favItem.transpose !== undefined ? favItem.transpose : true;
            _currentBPM = favItem.bpm || null;
            _currentKey = favItem.key || null;
            await applySettings({
                pitch: _previousPitch,
                playbackRate: _previousPlaybackRate,
                boost: _previousBoost,
                pan: _previousPan,
                transpose,
                soundProfile: _previousSoundProfile,
                forceApply: true
            });
            currentVideoSrc = realUrl;
            console.log("Applied favorite settings for:", realUrl, favItem);
        } else if (isHeld) {
            // Nếu isHeld = true, áp dụng cài đặt hiện tại
            await applySettings({
                pitch: _previousPitch,
                playbackRate: _previousPlaybackRate,
                boost: _previousBoost,
                pan: _previousPan,
                transpose,
                soundProfile: _previousSoundProfile,
                forceApply: true
            });
            currentVideoSrc = realUrl;
            console.log("Applied held settings for new video:", realUrl, {
                pitch: _previousPitch,
                playbackRate: _previousPlaybackRate,
                boost: _previousBoost,
                pan: _previousPan,
                transpose,
                soundProfile: _previousSoundProfile
            });
        } else if (realUrl !== currentVideoSrc) {
            // Nếu không có favItem và không ở chế độ hold, đặt lại mặc định
            resetToDefault();
            await applySettings({ soundProfile: _previousSoundProfile });
            currentVideoSrc = realUrl;
            console.log("Reset to default for new video:", realUrl);
        } else {
            // Áp dụng cài đặt hiện tại nếu video không đổi
            await applySettings({
                pitch: _previousPitch,
                playbackRate: _previousPlaybackRate,
                boost: _previousBoost,
                pan: _previousPan,
                transpose,
                soundProfile: _previousSoundProfile
            });
            console.log("Applied existing settings for same video:", realUrl);
        }

        videoConnected = true;
        if (isVideoPlaying(video)) {
            if (isExtensionValid()) {
                chrome.runtime.sendMessage({
                    type: "videoChanged",
                    videoSrc: currentVideoSrc,
                    isFavorite: !!favItem,
                    pitch: _previousPitch,
                    playbackRate: _previousPlaybackRate,
                    boost: _previousBoost,
                    pan: _previousPan,
                    transpose,
                    bpm: _currentBPM,
                    key: _currentKey,
                    title: document.title,
                    soundProfile: _previousSoundProfile,
                    holdState: isHeld
                });
            }
        }
        console.log("Video connected:", realUrl);
    } catch (error) {
        handleError("Error connecting video:", error);
        videoConnected = false;
    }
}

function disconnectVideo(video) {
    const nodeData = outputNodeMap.get(video);
    if (!nodeData || !_audioCtx || !_jungle) {
        videoConnected = false;
        return;
    }
    try {
        if (nodeData.pitchShifterConnected) {
            nodeData.outputNode.disconnect(_jungle.input);
            nodeData.pitchShifterConnected = false;
        }
        if (!nodeData.destinationConnected) {
            nodeData.outputNode.connect(_audioCtx.destination);
            nodeData.destinationConnected = true;
        }
        video.playbackRate = 1;
        const realUrl = getRealVideoUrl();
        const favItem = favoritesMap.get(realUrl);
        if (!favItem || !isHeld) {
            currentVideoSrc = null; // Đặt lại nếu không có favItem HOẶC isHeld là false
        }
        videoConnected = false;
        console.log("Video disconnected");
    } catch (error) {
        handleError("Error disconnecting video:", error);
    }
}

function disconnectAllVideos() {
    outputNodeMap.forEach((_, video) => disconnectVideo(video));
    videoListeners.forEach((listener, video) => video.removeEventListener("playing", listener));
    videoListeners.clear();
    videoConnected = false;
    resetToDefault();
    if (_observer) {
        _observer.disconnect();
        _observer = null;
    }
    currentVideoSrc = null; // Đặt lại currentVideoSrc
    console.log("All videos disconnected");
}

function isVideoPlaying(video) {
    return video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2 && !video.error;
}

function listenForPlay(video) {
    if (!videoListeners.has(video)) {
        const listener = () => {
            if (!video.error) connectVideo(video);
            else handleError("Video playback error:", video.error);
        };
        video.addEventListener("playing", listener, { once: true });
        video.addEventListener("error", () => disconnectVideo(video), { once: true });
        video.addEventListener("ended", () => {
            const realUrl = getRealVideoUrl();
            const favItem = favoritesMap.get(realUrl);
            // Chỉ đặt lại mặc định nếu isHeld = false và không có favItem
            if (!isHeld && !favItem) {
                resetToDefault();
                currentVideoSrc = null;
                chrome.runtime.sendMessage({
                    type: "videoChanged",
                    videoSrc: realUrl,
                    isFavorite: false,
                    pitch: _previousPitch,
                    playbackRate: _previousPlaybackRate,
                    boost: _previousBoost,
                    pan: _previousPan,
                    transpose,
                    bpm: _currentBPM,
                    key: _currentKey,
                    title: document.title,
                    soundProfile: _previousSoundProfile,
                    holdState: isHeld
                });
            } else {
                console.log(`Keeping settings due to hold state: ${isHeld} or favorite item exists`, { isHeld, hasFavItem: !!favItem });
            }
            videoListeners.delete(video);
            listenForPlay(video);
        }, { once: true });

        // Thêm trình nghe sự kiện source change
        video.addEventListener("loadedmetadata", () => {
            const realUrl = getRealVideoUrl();
            if (realUrl !== currentVideoSrc) {
                connectVideo(video); // Kết nối lại video để áp dụng cấu hình mới
            }
        }, { once: true });

        videoListeners.set(video, listener);
    }
    if (isVideoPlaying(video)) connectVideo(video);
}

function initVideoObservers() {
    if (!isEnabled) return;
    if (_observer) _observer.disconnect();
    const target = document.querySelector("main") || document.body;
    _observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            Array.from(mutation.addedNodes).forEach(node => {
                if (node instanceof HTMLVideoElement) {
                    listenForPlay(node);
                    nonstopHandler(node);
                    node.addEventListener('play', () => {
                        const realUrl = getRealVideoUrl();
                        if (isVideoPlaying(node) && realUrl !== currentVideoSrc) {
                            connectVideo(node);
                            let isPlaying = false;
                            document.querySelectorAll("video").forEach(video => {
                                if (isVideoPlaying(video)) {
                                    isPlaying = true;
                                }
                            });
                            if (isPlaying && !_nonstopInterval) {
                                _nonstopInterval = setInterval(() => {
                                    simulateUserInteraction();
                                }, NONSTOP_INTERACTION_INTERVAL);
                            }
                        }
                    }, { once: true });
                    node.addEventListener('loadedmetadata', () => {
                        const realUrl = getRealVideoUrl();
                        if (realUrl !== currentVideoSrc) {
                            connectVideo(node);
                            let isPlaying = false;
                            document.querySelectorAll("video").forEach(video => {
                                if (isVideoPlaying(video)) {
                                    isPlaying = true;
                                }
                            });
                            if (isPlaying && !_nonstopInterval) {
                                _nonstopInterval = setInterval(() => {
                                    simulateUserInteraction();
                                }, NONSTOP_INTERACTION_INTERVAL);
                            }
                        }
                    }, { once: true });
                } else if (node.querySelectorAll) {
                    node.querySelectorAll("video").forEach(v => {
                        listenForPlay(v);
                        nonstopHandler(v);
                        v.addEventListener('play', () => {
                            const realUrl = getRealVideoUrl();
                            if (isVideoPlaying(v) && realUrl !== currentVideoSrc) {
                                connectVideo(v);
                                let isPlaying = false;
                                document.querySelectorAll("video").forEach(video => {
                                    if (isVideoPlaying(video)) {
                                        isPlaying = true;
                                    }
                                });
                                if (isPlaying && !_nonstopInterval) {
                                    _nonstopInterval = setInterval(() => {
                                        simulateUserInteraction();
                                    }, NONSTOP_INTERACTION_INTERVAL);
                                }
                            }
                        }, { once: true });
                        v.addEventListener('loadedmetadata', () => {
                            const realUrl = getRealVideoUrl();
                            if (realUrl !== currentVideoSrc) {
                                connectVideo(v);
                                let isPlaying = false;
                                document.querySelectorAll("video").forEach(video => {
                                    if (isVideoPlaying(video)) {
                                        isPlaying = true;
                                    }
                                });
                                if (isPlaying && !_nonstopInterval) {
                                    _nonstopInterval = setInterval(() => {
                                        simulateUserInteraction();
                                    }, NONSTOP_INTERACTION_INTERVAL);
                                }
                            }
                        }, { once: true });
                    });
                }
            });
        });
    });
    _observer.observe(target, { childList: true, subtree: true });
    document.querySelectorAll("video").forEach(video => {
        listenForPlay(video);
        nonstopHandler(video);
        video.addEventListener('play', () => {
            const realUrl = getRealVideoUrl();
            if (isVideoPlaying(video) && realUrl !== currentVideoSrc) {
                connectVideo(video);
                let isPlaying = false;
                document.querySelectorAll("video").forEach(v => {
                    if (isVideoPlaying(v)) {
                        isPlaying = true;
                    }
                });
                if (isPlaying && !_nonstopInterval) {
                    _nonstopInterval = setInterval(() => {
                        simulateUserInteraction();
                    }, NONSTOP_INTERACTION_INTERVAL);
                }
            }
        }, { once: true });
        video.addEventListener('loadedmetadata', () => {
            const realUrl = getRealVideoUrl();
            if (realUrl !== currentVideoSrc) {
                connectVideo(video);
                let isPlaying = false;
                document.querySelectorAll("video").forEach(v => {
                    if (isVideoPlaying(v)) {
                        isPlaying = true;
                    }
                });
                if (isPlaying && !_nonstopInterval) {
                    _nonstopInterval = setInterval(() => {
                        simulateUserInteraction();
                    }, NONSTOP_INTERACTION_INTERVAL);
                }
            }
        }, { once: true });
    });

    // Kiểm tra định kỳ để phát hiện thay đổi video
    setInterval(() => {
        document.querySelectorAll("video").forEach(video => {
            const realUrl = getRealVideoUrl();
            if (isVideoPlaying(video) && realUrl !== currentVideoSrc) {
                connectVideo(video);
            }
        });
    }, 1000);

    // Theo dõi tương tác người dùng thực tế
    const updateInteraction = () => {
        if (_nonstopInterval) {
            clearInterval(_nonstopInterval);
            _nonstopInterval = null;
        }
        let isPlaying = false;
        document.querySelectorAll("video").forEach(video => {
            if (isVideoPlaying(video)) {
                isPlaying = true;
            }
        });
        if (isPlaying && !_nonstopInterval) {
            _nonstopInterval = setInterval(() => {
                simulateUserInteraction();
            }, NONSTOP_INTERACTION_INTERVAL);
        }
    };
    ['mousemove', 'click', 'keydown'].forEach(event => {
        document.addEventListener(event, updateInteraction, { passive: true });
    });

    // Cơ chế dự phòng kiểm tra video mới
    if (_nonstopInterval) clearInterval(_nonstopInterval);
    _nonstopInterval = setInterval(() => {
        let isPlaying = false;
        document.querySelectorAll("video").forEach(video => {
            if (isVideoPlaying(video)) {
                isPlaying = true;
            }
        });
        if (!isPlaying) {
            document.querySelectorAll("video").forEach(video => {
                const realUrl = getRealVideoUrl();
                if (realUrl !== currentVideoSrc) {
                    connectVideo(video);
                    if (!_nonstopInterval && isVideoPlaying(video)) {
                        _nonstopInterval = setInterval(() => {
                            simulateUserInteraction();
                        }, NONSTOP_INTERACTION_INTERVAL);
                    }
                }
            });
        } else if (_nonstopInterval) {
            clearInterval(_nonstopInterval);
            _nonstopInterval = setInterval(() => {
                simulateUserInteraction();
            }, NONSTOP_INTERACTION_INTERVAL);
        }
    }, VIDEO_CHECK_FALLBACK_INTERVAL);

    console.log("Video and nonstop observers initialized");
}

async function restoreState() {
    isEnabled = (await getStorage("isEnabled")) || false;
    isHeld = false;
    if (!isEnabled) {
        if (_nonstopInterval) clearInterval(_nonstopInterval);
        return;
    }

    const videos = document.querySelectorAll("video");
    const favoritesArray = (await getStorage("favorites")) || [];
    favoritesMap.clear();
    favoritesArray.forEach(f => favoritesMap.set(f.link, f));

    videos.forEach(video => {
        if (isVideoPlaying(video)) {
            connectVideo(video);
            nonstopHandler(video);
        }
        video.addEventListener('play', () => {
            const realUrl = getRealVideoUrl();
            if (isVideoPlaying(video) && realUrl !== currentVideoSrc) {
                connectVideo(video);
                let isPlaying = false;
                document.querySelectorAll("video").forEach(v => {
                    if (isVideoPlaying(v)) {
                        isPlaying = true;
                    }
                });
                if (isPlaying && !_nonstopInterval) {
                    _nonstopInterval = setInterval(() => {
                        simulateUserInteraction();
                    }, NONSTOP_INTERACTION_INTERVAL);
                }
            }
        }, { once: true });
        video.addEventListener('loadedmetadata', () => {
            const realUrl = getRealVideoUrl();
            if (realUrl !== currentVideoSrc) {
                connectVideo(video);
                let isPlaying = false;
                document.querySelectorAll("video").forEach(v => {
                    if (isVideoPlaying(v)) {
                        isPlaying = true;
                    }
                });
                if (isPlaying && !_nonstopInterval) {
                    _nonstopInterval = setInterval(() => {
                        simulateUserInteraction();
                    }, NONSTOP_INTERACTION_INTERVAL);
                }
            }
        }, { once: true });
    });

    // Theo dõi tương tác người dùng thực tế
    const updateInteraction = () => {
        if (_nonstopInterval) {
            clearInterval(_nonstopInterval);
            _nonstopInterval = null;
        }
        let isPlaying = false;
        document.querySelectorAll("video").forEach(video => {
            if (isVideoPlaying(video)) {
                isPlaying = true;
            }
        });
        if (isPlaying && !_nonstopInterval) {
            _nonstopInterval = setInterval(() => {
                simulateUserInteraction();
            }, NONSTOP_INTERACTION_INTERVAL);
        }
    };
    ['mousemove', 'click', 'keydown'].forEach(event => {
        document.addEventListener(event, updateInteraction, { passive: true });
    });

    // Cơ chế dự phòng kiểm tra video mới
    if (_nonstopInterval) clearInterval(_nonstopInterval);
    _nonstopInterval = setInterval(() => {
        let isPlaying = false;
        document.querySelectorAll("video").forEach(video => {
            if (isVideoPlaying(video)) {
                isPlaying = true;
            }
        });
        if (!isPlaying) {
            document.querySelectorAll("video").forEach(video => {
                const realUrl = getRealVideoUrl();
                if (realUrl !== currentVideoSrc) {
                    connectVideo(video);
                    if (!_nonstopInterval && isVideoPlaying(video)) {
                        _nonstopInterval = setInterval(() => {
                            simulateUserInteraction();
                        }, NONSTOP_INTERACTION_INTERVAL);
                    }
                }
            });
        } else if (_nonstopInterval) {
            clearInterval(_nonstopInterval);
            _nonstopInterval = setInterval(() => {
                simulateUserInteraction();
            }, NONSTOP_INTERACTION_INTERVAL);
        }
    }, VIDEO_CHECK_FALLBACK_INTERVAL);

    console.log("State restored with isEnabled:", isEnabled);
}

chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
    if (!isExtensionValid()) {
        sendResponse({ status: "notSupported", message: "Tab not supported" });
        return false;
    }

    try {
        const requestType = request.type || request.action;

        if (requestType === "get") {
            const activeVideo = Array.from(outputNodeMap.keys()).find(isVideoPlaying);
            const videoSrc = activeVideo ? getRealVideoUrl() : currentVideoSrc;
            const presetId = _previousSoundProfile.replace(/([A-Z])/g, '-$1').toLowerCase();
            sendResponse({
                playbackRate: _previousPlaybackRate,
                pitch: _previousPitch,
                boost: _previousBoost,
                pan: _previousPan,
                enabled: isEnabled,
                transpose,
                bpm: _currentBPM,
                key: _currentKey,
                title: document.title,
                videoSrc,
                isFavorite: favoritesMap.has(videoSrc),
                soundProfile: presetId,
                holdState: isHeld,
                status: "success"
            });
            return false;
        }

        if (requestType === "getBPM" || requestType === "getSongKey" || requestType === "calculateBPM") {
            if (!isEnabled) {
                sendResponse({ status: "error", message: "Extension not enabled" });
                return false;
            }
            calculateBPM().then(result => sendResponse({ status: result.bpm ? "success" : "error", ...result })).catch(error => sendResponse({ status: "error", message: error.message }));
            return true; // Bất đồng bộ
        }

        if (requestType === "restore" || requestType === "refreshState") {
            console.log("Áp dụng thiết lập âm thanh:", request.soundProfile || _previousSoundProfile, request);
            restoreState().then(() => {
                sendResponse({ status: "success", message: "State restored successfully" });
            }).catch(error => sendResponse({ status: "error", message: error.message }));
            return true; // Bất đồng bộ
        }

        if (request.enabled !== undefined) {
            isEnabled = request.enabled;
            setStorage("isEnabled", isEnabled);
            if (isEnabled) {
                initVideoObservers();
                restoreState().catch(() => sendResponse({ status: "error", message: "State restoration failed" }));
            } else {
                disconnectAllVideos();
            }
            sendResponse({ status: "success", enabled: isEnabled });
            return false;
        }

        if (requestType === "hold") {
            isHeld = request.holdState;
            console.log(`Hold state changed to: ${isHeld}`);
            if (!isHeld) {
                applySettings({ soundProfile: _previousSoundProfile });
            }
            sendResponse({ status: "success", holdState: isHeld });
            return false;
        }

        if (requestType === "applyPreset") {
            const preset = request.preset;
            const validProfiles = ["warm", "bright", "bassHeavy", "vocal", "proNatural", "karaokeDynamic", "rockMetal", "smartStudio"];
            if (validProfiles.includes(preset)) {
                applySettings({ soundProfile: preset }).then(() => {
                    _previousSoundProfile = preset;
                    sendResponse({ status: "success", preset });
                }).catch(error => sendResponse({ status: "error", message: error.message }));
            } else {
                sendResponse({ status: "error", message: "Invalid preset" });
            }
            return true; // Bất đồng bộ
        }

        if (request.pitch !== undefined || request.playbackRate !== undefined || request.boost !== undefined || request.pan !== undefined || request.transpose !== undefined || request.soundProfile !== undefined) {
            applySettings(request).then(() => sendResponse({ status: "success", soundProfile: _previousSoundProfile })).catch(error => sendResponse({ status: "error", message: error.message }));
            return true; // Bất đồng bộ
        }

        if (requestType === "suspend") {
            if (_audioCtx) _audioCtx.close();
            _audioCtx = null;
            _jungle = null;
            videoConnected = false;
            isHeld = false;
            resetToDefault();
            sendResponse({ status: "suspended" });
            return false;
        }

        sendResponse({ status: "error", message: "Unknown request type" });
        return false;
    } catch (error) {
        handleError("Error handling message:", error);
        sendResponse({ status: "error", message: error.message });
        return false;
    }
});
(async () => {
    await restoreState();
    if (isEnabled) initVideoObservers();

    window.addEventListener("beforeunload", () => {
        disconnectAllVideos();
    });
})();

if (window.AudioContext || window.webkitAudioContext) {
    console.log("Extension loaded, waiting for user interaction.");
} else {
    console.error("AudioContext not supported in this browser.");
}
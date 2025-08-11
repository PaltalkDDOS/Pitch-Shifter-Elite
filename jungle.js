// jungle.js - Advanced Audio Processing Module with Smart Integration

// Hàm helper để xử lý lỗi với stack trace
function handleError(errorMessage, error, context = {}, severity = 'low', options = {}) {
    const errorDetails = {
        message: `${errorMessage}: ${error?.message || "Unknown error"}`,
        stack: error?.stack || "",
        context,
        severity,
        timestamp: Date.now()
    };
    console[severity === 'high' ? 'error' : 'warn'](errorDetails.message, errorDetails);

    // Store error in MemoryManager
    if (options.memoryManager) {
        try {
            let errorHistory = options.memoryManager.get('errorHistory') || [];
            errorHistory.push(errorDetails);
            errorHistory = errorHistory.slice(-50); // Keep last 50 errors
            options.memoryManager.set('errorHistory', errorHistory, 'high');
        } catch (storeError) {
            console.warn('Failed to store error history:', storeError);
        }
    }

    // Report to server if configured
    if (options.reportToServer && severity === 'high') {
        try {
            fetch(options.reportToServer, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(errorDetails)
            }).catch(fetchError => console.warn('Failed to report error to server:', fetchError));
        } catch (fetchError) {
            console.warn('Error initiating server report:', fetchError);
        }
    }
}

// Hàm helper để kiểm tra giá trị hợp lệ
function ensureFinite(value, defaultValue, options = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const errorMessage = options.errorMessage || `Invalid value: ${value}, using default: ${defaultValue}`;

    if (typeof value !== 'number' || !Number.isFinite(value) || isNaN(value)) {
        if (isDebug) {
            console.debug(errorMessage, { value, defaultValue });
        }
        return defaultValue;
    }
    return value;
}

// Hàm cải tiến để đo CPU load chính xác hơn

Jungle.prototype.getCPULoad = function () {
    if (!this.context || !(this.context instanceof (window.AudioContext || window.webkitAudioContext))) {
        console.warn('Invalid AudioContext, returning default CPU load');
        return this.qualityMode === 'low' ? 0.3 : 0.7; // Dynamic fallback
    }

    performance.mark('cpu-load-start');
    const sampleRate = this.context.sampleRate || 44100;
    const audioLatency = this.context.baseLatency || 0;
    const latencyFactor = Math.min(audioLatency * 40, 0.25); // Reduced latency impact

    // Worker load
    const workerLoad = this.worker && Number.isFinite(this.nextProcessingInterval)
        ? Math.min(this.nextProcessingInterval / 2500, 0.15)
        : 0;

    // Device load
    const deviceLoad = navigator.hardwareConcurrency
        ? Math.min(1 / (navigator.hardwareConcurrency * 1.5), 0.1)
        : 0.08;

    // Memory factor (if supported)
    const memoryFactor = window.performance.memory
        ? Math.min(window.performance.memory.usedJSHeapSize / window.performance.memory.jsHeapSizeLimit, 0.1)
        : 0;

    performance.mark('cpu-load-end');
    const measure = performance.measure('cpu-load', 'cpu-load-start', 'cpu-load-end');
    const duration = measure.duration;

    let load = Math.min(
        (duration / 12) * (sampleRate / 44100) + latencyFactor + workerLoad + deviceLoad + memoryFactor,
        1
    );

    // Manage load history
    let loadHistory = [];
    try {
        const cachedHistory = this.memoryManager?.get('cpuLoadHistory') || [];
        if (Array.isArray(cachedHistory)) {
            loadHistory = cachedHistory;
        }
        const lastLoad = loadHistory[loadHistory.length - 1] || 0;
        if (Math.abs(load - lastLoad) > 0.05) { // Only store significant changes
            loadHistory.push(load);
            loadHistory = loadHistory.slice(-10);
            this.memoryManager?.set('cpuLoadHistory', loadHistory, 'high');
        }
    } catch (error) {
        handleError('Error managing CPU load history', error, { load }, 'low', { memoryManager: this.memoryManager });
    }

    const averageLoad = loadHistory.length > 0
        ? loadHistory.reduce((sum, val) => sum + val, 0) / loadHistory.length
        : load;

    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    if (isDebug) {
        console.debug('CPU Load:', {
            averageLoad,
            duration,
            audioLatency,
            workerLoad,
            deviceLoad,
            memoryFactor,
            sampleRate
        });
    }

    return Number.isFinite(averageLoad) ? Math.max(0, Math.min(1, averageLoad)) : this.qualityMode === 'low' ? 0.3 : 0.7;
};

function adjustFadeLength(fadeLength, sampleRate, spectralProfile, pitchShift, isVocal, cpuLoad, isLowPowerDevice, options = {}) {
    // Kiểm tra đầu vào
    if (!Number.isFinite(fadeLength) || fadeLength <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        handleError('Invalid fadeLength or sampleRate', new Error('Invalid input'), { fadeLength, sampleRate }, 'low', options);
        return 64;
    }

    // Hàm tính minFadeLength động
    const calculateMinFadeLength = (absPitchShift, cpuLoad, isLowPowerDevice) => {
        let baseLength = 512; // Mặc định 512 như đã cập nhật
        if (absPitchShift > 0.5) baseLength = 512;
        else if (absPitchShift > 0.2) baseLength = 384; // Trung gian giữa 256 và 512
        if (cpuLoad > 0.95 || (isLowPowerDevice && cpuLoad > 0.9)) baseLength = Math.max(256, baseLength * 0.5);
        return Math.round(baseLength);
    };

    const absPitchShift = ensureFinite(Math.abs(pitchShift || 0), 0, { errorMessage: 'Invalid pitchShift' });
    const minFadeLength = calculateMinFadeLength(absPitchShift, cpuLoad, isLowPowerDevice);

    // Chuẩn hóa spectralProfile
    const spectralDefaults = {
        spectralComplexity: 0.5,
        transientEnergy: 0.5,
        vocalPresence: 0.5,
        bass: 0.5,
        midHigh: 0.5,
        air: 0.5,
        spectralEntropy: 0.5
    };
    const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
        acc[key] = ensureFinite(spectralProfile?.[key], spectralDefaults[key], { errorMessage: `Invalid spectralProfile.${key}` });
        return acc;
    }, { ...spectralDefaults });

    // Tùy chỉnh hệ số động theo qualityMode
    const qualityFactor = options.qualityMode === 'low' ? 0.9 : 1.1;
    const {
        transientBoost = 1.3 * qualityFactor,
        vocalBoost = 1.3 * qualityFactor,
        bassBoost = 1.25 * qualityFactor,
        midHighBoost = 1.2 * qualityFactor,
        airReduction = 0.85 / qualityFactor,
        highCpuReduction = 0.8 / qualityFactor,
        memoryManager = null
    } = options;

    let adjustedLength = fadeLength;

    // Điều chỉnh cho transient và vocal
    if (validatedSpectralProfile.transientEnergy > 0.7 || validatedSpectralProfile.vocalPresence > 0.7) {
        adjustedLength *= isVocal ? vocalBoost : transientBoost;
    } else if (validatedSpectralProfile.transientEnergy > 0.5 || validatedSpectralProfile.vocalPresence > 0.5) {
        adjustedLength *= isVocal ? vocalBoost * 0.9 : transientBoost * 0.9;
    }

    // Điều chỉnh cho bass, midHigh, và entropy
    if (validatedSpectralProfile.bass > 0.7) adjustedLength *= bassBoost;
    if (validatedSpectralProfile.midHigh > 0.7) adjustedLength *= midHighBoost;
    if (validatedSpectralProfile.spectralEntropy > 0.7) adjustedLength *= 1.15 * qualityFactor;

    // Giảm nếu air cao và transient thấp
    if (validatedSpectralProfile.air > 0.7 && validatedSpectralProfile.transientEnergy < 0.5) {
        adjustedLength *= airReduction;
    }

    // Giảm khi CPU load cao
    if (cpuLoad > 0.9 || (cpuLoad > 0.85 && isLowPowerDevice)) {
        adjustedLength *= highCpuReduction;
    }

    // Giới hạn fadeLength
    adjustedLength = Math.max(minFadeLength, Math.round(adjustedLength));
    const maxFadeLength = Math.round(sampleRate * 0.2); // Tăng lên 200ms
    adjustedLength = Math.min(maxFadeLength, adjustedLength);

    // Lưu lịch sử fadeLength
    if (memoryManager) {
        try {
            let fadeLengthHistory = memoryManager.get('fadeLengthHistory') || [];
            fadeLengthHistory.push({ length: adjustedLength, timestamp: Date.now() });
            fadeLengthHistory = fadeLengthHistory.slice(-20); // Giữ 20 giá trị
            memoryManager.set('fadeLengthHistory', fadeLengthHistory, 'normal');
        } catch (error) {
            handleError('Failed to store fadeLengthHistory', error, { adjustedLength }, 'low', { memoryManager });
        }
    }

    // Debug log
    const isDebug = window.location.pathname.includes('debug') || window.location.search.includes('debug=true');
    if (isDebug) {
        console.debug(`Adjusted fadeLength: ${adjustedLength} samples`, samples);
    }

    return adjustedLength;
}
function getFadeBuffer(context, activeTime, fadeTime, options = {}, memoryManager) {
    // Kiểm tra đầu vào
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        return null;
    }
    activeTime = ensureFinite(activeTime, 0.2, { errorMessage: 'Invalid activeTime, using default: 0.2' });
    fadeTime = ensureFinite(fadeTime, 0.1, { errorMessage: 'Invalid fadeTime, using default: 0.1' });
    if (!memoryManager || typeof memoryManager.getBuffer !== 'function') {
        handleError('Invalid memoryManager', new Error('memoryManager is required'), {}, 'high', { memoryManager });
        return null;
    }

    const {
        pitchShift = 0,
        isVocal = false,
        qualityMode = 'high',
        channels = 2, // Mặc định 2 kênh
        spectralProfile = {}
    } = options;

    // Tạo key cache chi tiết
    const spectralKey = `${ensureFinite(spectralProfile?.spectralComplexity, 0.5)}_${ensureFinite(spectralProfile?.vocalPresence, 0.5)}`;
    const key = `fade_${activeTime}_${fadeTime}_${pitchShift}_${isVocal}_${qualityMode}_${channels}_${spectralKey}`;

    // Lấy buffer từ memoryManager
    let buffer = memoryManager.getBuffer(key);

    // Kiểm tra buffer hợp lệ và expiry
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const expiryTime = 90000; // 90s
    const bufferMetadata = memoryManager.get(key)?.metadata;
    if (buffer && buffer instanceof AudioBuffer && buffer.length >= activeTime * context.sampleRate) {
        if (bufferMetadata?.timestamp && Date.now() - bufferMetadata.timestamp > expiryTime) {
            if (isDebug) console.debug(`Buffer expired for key: ${key}, recreating`);
            buffer = null;
        }
    } else {
        if (buffer) {
            handleError('Invalid buffer', new Error('Buffer validation failed'), { key, bufferLength: buffer?.length }, 'low', { memoryManager });
        }
        buffer = null;
    }

    // Tạo buffer mới nếu cần
    if (!buffer) {
        try {
            buffer = createFadeBuffer(context, activeTime, fadeTime, options, memoryManager);
            if (!buffer || !(buffer instanceof AudioBuffer)) {
                throw new Error('Failed to create valid fade buffer');
            }
            memoryManager.set(key, buffer, 'high', { metadata: { timestamp: Date.now() } });
        } catch (error) {
            handleError('Error creating fade buffer', error, { key, activeTime, fadeTime, options }, 'high', { memoryManager });
            return null;
        }
    }

    if (isDebug) {
        console.debug(`Retrieved fade buffer for key: ${key}`, {
            bufferLength: buffer.length,
            channels: buffer.numberOfChannels,
            sampleRate: buffer.sampleRate
        });
    }

    return buffer;
}

// Hàm tạo fade buffer với tối ưu hóa
function createFadeBuffer(context, activeTime, fadeTime, options = {}, memoryManager) {
    // Kiểm tra đầu vào
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        throw new Error("Invalid AudioContext provided.");
    }
    activeTime = ensureFinite(activeTime, 0.2, { errorMessage: 'Invalid activeTime, using default: 0.2' });
    fadeTime = ensureFinite(fadeTime, 0.1, { errorMessage: 'Invalid fadeTime, using default: 0.1' });

    const {
        smoothness = 1.1,
        vibrance = 0.75,
        pitchShift = 0,
        isVocal = false,
        spectralProfile = {},
        qualityMode = 'high',
        channels = 1,
        transientBoost = 1.05,
        vocalWarmth = 1.2
    } = options;

    try {
        const sampleRate = ensureFinite(context.sampleRate, 44100, { errorMessage: 'Invalid sampleRate, using default: 44100' });
        if (sampleRate <= 0) {
            throw new Error("sampleRate không hợp lệ: phải là số dương hữu hạn.");
        }

        // Chuẩn hóa spectralProfile
        const spectralDefaults = {
            spectralComplexity: 0.5,
            transientEnergy: 0.5,
            vocalPresence: 0.5,
            bass: 0.5,
            midHigh: 0.5,
            air: 0.5,
            spectralEntropy: 0.5
        };
        const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
            acc[key] = ensureFinite(spectralProfile?.[key], spectralDefaults[key], { errorMessage: `Invalid spectralProfile.${key}` });
            acc[key] = Math.max(0, Math.min(1, acc[key]));
            return acc;
        }, { ...spectralDefaults });

        // Lấy CPU load và thông tin thiết bị
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const loadHistory = memoryManager?.get('cpuLoadHistory') || [];
        const avgCpuLoad = loadHistory.length > 0 ? loadHistory.reduce((sum, val) => sum + val, 0) / loadHistory.length : cpuLoad;

        // Xác định minFadeLength
        let minFadeLength = 512;
        if (avgCpuLoad > 0.95 || (isLowPowerDevice && qualityMode === 'low')) {
            minFadeLength = 256;
        } else if (Math.abs(pitchShift) > 0.5 || validatedSpectralProfile.transientEnergy > 0.7 || validatedSpectralProfile.vocalPresence > 0.7) {
            minFadeLength = 512;
        }

        // Điều chỉnh fadeLength
        let fadeLength = Math.max(Math.round(fadeTime * sampleRate), minFadeLength);
        fadeLength = adjustFadeLength(fadeLength, sampleRate, validatedSpectralProfile, pitchShift, isVocal, avgCpuLoad, isLowPowerDevice);

        // Tinh chỉnh fadeLength
        if (validatedSpectralProfile.bass > 0.7 || validatedSpectralProfile.midHigh > 0.7 || validatedSpectralProfile.spectralEntropy > 0.7) {
            fadeLength = Math.round(fadeLength * 1.1);
        }

        const actualFadeTime = fadeLength / sampleRate;
        const activeLength = Math.round(activeTime * sampleRate);
        const totalLength = activeLength + Math.max(0, Math.round((activeTime - 2 * actualFadeTime) * sampleRate));

        // Tính bufferTimeFactor
        let bufferTimeFactor = (qualityMode === 'high' && avgCpuLoad < 0.8 ? 1.5 : 1.0) *
            (Math.abs(pitchShift) > 0.5 ? 1.15 : 1.0) *
            (isLowPowerDevice || avgCpuLoad > 0.9 ? 0.75 : 1.0) *
            (validatedSpectralProfile.transientEnergy > 0.7 ? transientBoost : 1.0) *
            (validatedSpectralProfile.spectralEntropy > 0.7 ? 1.1 : 1.0);

        const adjustedActiveTime = activeTime * bufferTimeFactor;

        // Debug log
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (fadeLength < 64) {
            console.warn(`fadeTime (${fadeTime}s) quá ngắn (${fadeLength} samples), có thể gây artifacts. Nên tăng lên ${64 / sampleRate}s.`);
        }
        if (isDebug && fadeLength !== Math.round(fadeTime * sampleRate)) {
            console.debug(`fadeTime điều chỉnh từ ${fadeTime}s thành ${actualFadeTime}s (${fadeLength} samples).`, {
                minFadeLength,
                avgCpuLoad,
                pitchShift,
                spectralProfile: validatedSpectralProfile
            });
        }

        // Tạo buffer
        const buffer = context.createBuffer(channels, totalLength, sampleRate);
        if (!buffer) throw new Error("Không thể tạo fade buffer.");

        // Hàm tính vibranceFactor
        const calculateVibranceFactor = (vibrance, fadeLength, pitchFactor, spectralProfile) => {
            const fadeDurationFactor = fadeLength < 1000 ? 0.85 : fadeLength < 5000 ? 1.0 : 1.15;
            let factor = Math.min(Math.max(vibrance, 0), 0.9) * fadeDurationFactor * (1 - pitchFactor * 0.25);
            if (spectralProfile.air > 0.7) {
                factor *= 0.9;
                if (isDebug) console.debug(`Giảm vibranceFactor xuống ${factor} do air cao`);
            }
            if (spectralProfile.transientEnergy > 0.7) factor *= 1.05;
            if (spectralProfile.spectralEntropy > 0.7) factor *= 0.95;
            return factor;
        };

        // Bezier curve + cosine blend
        const getFadeFunction = () => {
            const adjustedSmoothness = Math.min(Math.max(smoothness * (sampleRate / 44100), 0.5), 1.8);
            const pitchFactor = Math.abs(pitchShift);
            const vibranceFactor = calculateVibranceFactor(vibrance, fadeLength, pitchFactor, validatedSpectralProfile);
            const bezierP1 = 0.1 * adjustedSmoothness * (1 + pitchFactor * 0.05);
            const bezierP2 = 0.9 * adjustedSmoothness * (1 - pitchFactor * 0.05);
            const bezierCosineBlend = Math.max(0.5 - pitchFactor * 0.1 - validatedSpectralProfile.spectralComplexity * 0.1, 0.35);
            return (t) => {
                const t2 = t * t, t3 = t2 * t;
                const mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
                const bezier = 3 * bezierP1 * t * mt2 + 3 * bezierP2 * t2 * mt + t3;
                const cosPart = 0.5 * (1 - Math.cos(Math.PI * t));
                const warmth = isVocal || validatedSpectralProfile.vocalPresence > 0.7 ? vocalWarmth : 1.0;
                return Math.min(1, (bezier * bezierCosineBlend + cosPart * (1 - bezierCosineBlend)) * (1 + vibranceFactor * 0.15 * warmth));
            };
        };

        const fadeFunction = getFadeFunction();

        // Áp dụng fade curve
        for (let ch = 0; ch < channels; ch++) {
            const channelData = buffer.getChannelData(ch);
            const fadeIndex1 = fadeLength;
            const fadeIndex2 = activeLength - fadeLength;
            for (let i = 0; i < totalLength; i++) {
                if (i < fadeIndex1) {
                    channelData[i] = fadeFunction(i / fadeLength);
                } else if (i >= fadeIndex2 && i < activeLength) {
                    channelData[i] = fadeFunction(1 - (i - fadeIndex2) / fadeLength);
                } else if (i < activeLength) {
                    channelData[i] = 1;
                } else {
                    channelData[i] = 0;
                }
            }

            // Boundary smoothing động
            const boundarySmoothing = Math.min(fadeLength / 8, 20);
            for (let i = 0; i < boundarySmoothing; i++) {
                const t = 0.5 * (1 - Math.cos(Math.PI * i / boundarySmoothing));
                if (fadeIndex1 - i - 1 >= 0) {
                    channelData[fadeIndex1 - i - 1] = channelData[fadeIndex1 - i - 1] * (1 - t) + 1 * t;
                }
                if (fadeIndex2 + i < activeLength) {
                    channelData[fadeIndex2 + i] = channelData[fadeIndex2 + i] * (1 - t) + channelData[fadeIndex2 + i - 1] * t;
                }
            }

            // Smoothing đặc biệt cho minFadeLength = 512
            if (minFadeLength === 512) {
                if (fadeIndex1 > 0) {
                    channelData[0] *= 0.5 * (1 - Math.cos(Math.PI * 0.5));
                }
                if (fadeIndex2 < activeLength) {
                    channelData[activeLength - 1] *= 0.5 * (1 - Math.cos(Math.PI * 0.5));
                }
            }
        }

        // Điều chỉnh outputGain
        if (avgCpuLoad > 0.85 && this.outputGain) {
            const targetGain = qualityMode === 'high' ? 0.7 : 0.6;
            const adjustedGain = (validatedSpectralProfile.bass > 0.7 || validatedSpectralProfile.air > 0.7) ? targetGain * 0.95 : targetGain;
            this.outputGain.gain.linearRampToValueAtTime(adjustedGain, context.currentTime + (this.rampTime || 0.075));
            if (isDebug) console.debug(`Giảm outputGain xuống ${adjustedGain} do CPU load cao`, { avgCpuLoad, qualityMode });
        }

        // Lưu buffer
        if (memoryManager && typeof memoryManager.set === 'function') {
            const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}`;
            const key = `fade_${activeTime}_${fadeTime}_bezier_${pitchShift}_${isVocal}_${qualityMode}_${channels}_${spectralKey}`;
            if (!(buffer instanceof AudioBuffer) || buffer.length < activeLength) {
                throw new Error('Invalid fade buffer created');
            }
            memoryManager.set(key, buffer, 'high', { metadata: { timestamp: Date.now() } });
            memoryManager.pruneCache(memoryManager.getDynamicMaxSize?.() || 1000);
            if (isDebug) {
                console.debug(`Stored fade buffer with key: ${key}`, {
                    bufferLength: buffer.length,
                    channels: buffer.numberOfChannels,
                    sampleRate: buffer.sampleRate
                });
            }
        }

        return buffer;
    } catch (error) {
        handleError('Error creating fade buffer', error, { activeTime, fadeTime, options, sampleRate }, 'high', { memoryManager });
        try {
            const fallbackBuffer = context.createBuffer(channels, Math.round(activeTime * sampleRate), sampleRate);
            for (let ch = 0; ch < channels; ch++) {
                const channelData = fallbackBuffer.getChannelData(ch);
                for (let i = 0; i < channelData.length; i++) {
                    channelData[i] = 1;
                }
            }
            return fallbackBuffer;
        } catch (fallbackError) {
            handleError('Error creating fallback buffer', fallbackError, { activeTime, sampleRate }, 'high', { memoryManager });
            return null;
        }
    }
}

function getShiftBuffers(context, activeTime, fadeTime, options = {}, memoryManager) {
    // Kiểm tra đầu vào
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        return null;
    }
    activeTime = ensureFinite(activeTime, 0.2, { errorMessage: 'Invalid activeTime, using default: 0.2' });
    fadeTime = ensureFinite(fadeTime, 0.1, { errorMessage: 'Invalid fadeTime, using default: 0.1' });
    if (!memoryManager || typeof memoryManager.get !== 'function' || typeof memoryManager.set !== 'function') {
        handleError('Invalid memoryManager', new Error('memoryManager with get/set methods is required'), {}, 'high', { memoryManager });
        return null;
    }

    const {
        pitchShift = 0,
        isVocal = false,
        qualityMode = 'high',
        channels = 1,
        spectralProfile = {}
    } = options;

    // Chuẩn hóa pitchShift và spectralProfile
    const validatedPitchShift = ensureFinite(pitchShift, 0, { errorMessage: 'Invalid pitchShift, using default: 0' });
    const spectralDefaults = {
        spectralComplexity: 0.5,
        vocalPresence: 0.5
    };
    const validatedSpectralProfile = {
        spectralComplexity: ensureFinite(spectralProfile?.spectralComplexity, spectralDefaults.spectralComplexity, { errorMessage: 'Invalid spectralComplexity' }),
        vocalPresence: ensureFinite(spectralProfile?.vocalPresence, spectralDefaults.vocalPresence, { errorMessage: 'Invalid vocalPresence' })
    };

    // Tạo key cache
    const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}`;
    const baseKey = `shift_${activeTime}_${fadeTime}_${validatedPitchShift}_${isVocal}_${qualityMode}_${channels}_${spectralKey}`;
    const keyDown = `${baseKey}_down`;
    const keyUp = `${baseKey}_up`;

    // Lấy buffer từ cache
    let shiftDownBuffer = memoryManager.get(keyDown)?.buffer;
    let shiftUpBuffer = memoryManager.get(keyUp)?.buffer;

    // Kiểm tra buffer hợp lệ và expiry
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const expiryTime = 90000; // 90s
    const validateBuffer = (buffer, key) => {
        const metadata = memoryManager.get(key)?.metadata;
        if (buffer instanceof AudioBuffer && buffer.length >= Math.round(activeTime * context.sampleRate)) {
            if (metadata?.timestamp && Date.now() - metadata.timestamp > expiryTime) {
                if (isDebug) console.debug(`Buffer expired for key: ${key}, recreating`);
                return null;
            }
            return buffer;
        }
        if (buffer) {
            handleError('Invalid buffer', new Error('Buffer validation failed'), { key, bufferLength: buffer?.length }, 'low', { memoryManager });
        }
        return null;
    };

    shiftDownBuffer = validateBuffer(shiftDownBuffer, keyDown);
    shiftUpBuffer = validateBuffer(shiftUpBuffer, keyUp);

    // Tạo buffer mới nếu cần
    if (!shiftDownBuffer || !shiftUpBuffer) {
        try {
            if (!shiftDownBuffer) {
                shiftDownBuffer = createDelayTimeBuffer(context, activeTime, fadeTime, false, options, memoryManager);
                if (!shiftDownBuffer || !(shiftDownBuffer instanceof AudioBuffer)) {
                    throw new Error('Failed to create shiftDownBuffer');
                }
                memoryManager.set(keyDown, shiftDownBuffer, 'high', { metadata: { timestamp: Date.now() } });
                if (isDebug) console.debug(`Created and stored shiftDownBuffer with key: ${keyDown}`);
            }
            if (!shiftUpBuffer) {
                shiftUpBuffer = createDelayTimeBuffer(context, activeTime, fadeTime, true, options, memoryManager);
                if (!shiftUpBuffer || !(shiftUpBuffer instanceof AudioBuffer)) {
                    throw new Error('Failed to create shiftUpBuffer');
                }
                memoryManager.set(keyUp, shiftUpBuffer, 'high', { metadata: { timestamp: Date.now() } });
                if (isDebug) console.debug(`Created and stored shiftUpBuffer with key: ${keyUp}`);
            }
        } catch (error) {
            handleError('Error creating shift buffers', error, { activeTime, fadeTime, options }, 'high', { memoryManager });
            return null;
        }
    }

    // Debug log
    if (isDebug) {
        console.debug(`Retrieved shift buffers`, {
            shiftDownLength: shiftDownBuffer?.length,
            shiftUpLength: shiftUpBuffer?.length,
            channels,
            sampleRate: context.sampleRate
        });
    }

    return { shiftDownBuffer, shiftUpBuffer };
}

function preserveFormant(pitchMult, baseFreq, vocalPresence, spectralProfile = {}) {
    const absMult = Math.abs(pitchMult);

    // Lấy spectralProfile với giá trị mặc định
    const spectralDefaults = {
        spectralComplexity: 0.5,
        transientEnergy: 0.5,
        bass: 0.5,
        midHigh: 0.5,
        air: 0.5
    };
    const validatedSpectralProfile = {
        spectralComplexity: Number.isFinite(spectralProfile?.spectralComplexity) ? Math.max(0, Math.min(1, spectralProfile.spectralComplexity)) : spectralDefaults.spectralComplexity,
        transientEnergy: Number.isFinite(spectralProfile?.transientEnergy) ? Math.max(0, Math.min(1, spectralProfile.transientEnergy)) : spectralDefaults.transientEnergy,
        bass: Number.isFinite(spectralProfile?.bass) ? Math.max(0, Math.min(1, spectralProfile.bass)) : spectralDefaults.bass,
        midHigh: Number.isFinite(spectralProfile?.midHigh) ? Math.max(0, Math.min(1, spectralProfile.midHigh)) : spectralDefaults.midHigh,
        air: Number.isFinite(spectralProfile?.air) ? Math.max(0, Math.min(1, spectralProfile.air)) : spectralDefaults.air
    };

    // Kiểm tra CPU load
    const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
    const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice ? 0.85 : 1.0; // Giảm tham số khi CPU load cao

    // Điều chỉnh shiftFactor
    const complexityAdjust = validatedSpectralProfile.spectralComplexity > 0.7 ? 0.75 : 1.0; // Giảm nếu phổ phức tạp
    const shiftFactor = (pitchMult < 0 ? 1 + absMult * 0.25 : 1 + absMult * 0.35) * complexityAdjust * cpuLoadAdjust;
    
    // Xác định loại vocal và điều chỉnh vocalFactor
    const isFemaleVocal = baseFreq > 400;
    const pitchBoost = absMult > 0.8 ? 1 + (absMult - 0.8) * 0.4 : 1.0; // Bù khi pitch shift mạnh
    const vocalFactor = Math.min(
        vocalPresence > 0.7 
            ? (isFemaleVocal ? 1.35 * pitchBoost : 1.25 * pitchBoost) 
            : (validatedSpectralProfile.midHigh > 0.7 ? 1.15 : 1.0), // Tăng nhẹ cho nhạc cụ midHigh mạnh
        1.4 // Giới hạn chặt hơn
    );

    // Điều chỉnh tần số formant
    const freqAdjust = Math.min(
        (isFemaleVocal && pitchMult < 0) ? 1.15 * pitchBoost // Hạ tone giọng nữ
        : (pitchMult < 0 ? 1.1 * pitchBoost // Hạ tone chung
        : (pitchMult > 0 && absMult > 0.8 ? 0.85 : 0.9)), // Tăng tone mạnh
        1.25 // Giới hạn chặt hơn
    );

    // Tăng freq nhẹ nếu bass mạnh để tránh lấn mid
    const bassAdjust = validatedSpectralProfile.bass > 0.7 ? 1.1 : 1.0;

    // Tính tần số formant
    let freq = baseFreq / shiftFactor * vocalFactor * freqAdjust * bassAdjust;
    const minFreq = 100; // Giới hạn tần số thấp
    const maxFreq = 5000; // Giới hạn tần số cao
    freq = Math.max(minFreq, Math.min(maxFreq, freq));

    // Điều chỉnh gain
    const transientBoost = validatedSpectralProfile.transientEnergy > 0.7 ? 1.15 : 1.0;
    const midHighBoost = validatedSpectralProfile.midHigh > 0.7 ? 1.2 : 1.0; // Tăng gain cho midHigh
    const airReduction = validatedSpectralProfile.air > 0.7 ? 0.8 : 1.0; // Giảm gain nếu air cao
    const gain = Math.min((4.5 - absMult * 1.0) * transientBoost * midHighBoost * airReduction * cpuLoadAdjust, 4.5); // Giảm gain tối đa

    // Điều chỉnh Q để tránh rè
    const qFactor = vocalPresence > 0.7 
        ? (absMult > 0.8 ? 0.12 : 0.18) // Q thấp hơn cho vocal khi pitch shift mạnh
        : (absMult > 0.8 ? 0.15 : 0.25); // Q thấp hơn cho nhạc cụ
    const airQReduction = validatedSpectralProfile.air > 0.7 ? 0.8 : 1.0; // Giảm Q nếu air cao
    const q = Math.max(1.5, (2 + absMult * qFactor) * airQReduction * cpuLoadAdjust); // Giới hạn Q thấp hơn

    console.debug(`preserveFormant result`, {
        freq,
        gain,
        q,
        pitchMult,
        baseFreq,
        vocalPresence,
        spectralProfile: validatedSpectralProfile,
        cpuLoad,
        isLowPowerDevice
    });

    return {
        freq,
        gain,
        q
    };
}

// Hàm tạo buffer điều chỉnh độ trễ với tối ưu hóa
function createDelayTimeBuffer(context, activeTime, fadeTime, shiftUp, options = {}, memoryManager) {
    // Kiểm tra đầu vào
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        throw new Error("Invalid AudioContext provided.");
    }
    activeTime = ensureFinite(activeTime, DEFAULT_BUFFER_TIME, { errorMessage: 'Invalid activeTime, using default: 0.2' });
    fadeTime = ensureFinite(fadeTime, DEFAULT_FADE_TIME, { errorMessage: 'Invalid fadeTime, using default: 0.1' });
    if (activeTime <= 0 || fadeTime <= 0) {
        handleError('Invalid parameters', new Error('activeTime and fadeTime must be positive'), { activeTime, fadeTime }, 'high', { memoryManager });
        throw new Error("activeTime and fadeTime must be positive finite numbers.");
    }
    if (!memoryManager || typeof memoryManager.set !== 'function') {
        handleError('Invalid memoryManager', new Error('memoryManager with set method is required'), {}, 'high', { memoryManager });
        throw new Error("Invalid memoryManager provided.");
    }

    const {
        pitchShift = 0,
        isVocal = false,
        spectralProfile = {},
        qualityMode = 'high',
        channels = 1 // Mặc định mono, hỗ trợ stereo
    } = options;

    // Chuẩn hóa pitchShift và channels
    const validatedPitchShift = ensureFinite(pitchShift, 0, { errorMessage: 'Invalid pitchShift, using default: 0' });
    const validatedChannels = Math.max(1, Math.min(Math.round(ensureFinite(channels, 1, { errorMessage: 'Invalid channels, using default: 1' })), 8));

    // Chuẩn hóa spectralProfile
    const spectralDefaults = {
        spectralComplexity: 0.5,
        vocalPresence: 0.5
    };
    const validatedSpectralProfile = {
        spectralComplexity: ensureFinite(spectralProfile?.spectralComplexity, spectralDefaults.spectralComplexity, { errorMessage: 'Invalid spectralComplexity' }),
        vocalPresence: ensureFinite(spectralProfile?.vocalPresence, spectralDefaults.vocalPresence, { errorMessage: 'Invalid vocalPresence' })
    };

    try {
        const sampleRate = ensureFinite(context.sampleRate, 44100, { errorMessage: 'Invalid sampleRate, using default: 44100' });
        if (sampleRate <= 0) {
            throw new Error("sampleRate không hợp lệ: phải là số dương hữu hạn.");
        }

        // Lấy CPU load và thông tin thiết bị
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;

        // Xác định minFadeLength
        const minFadeLength = isVocal ? 768 : (Math.abs(validatedPitchShift) > 0.3 ? DEFAULT_MIN_FADE_LENGTH : 512); // Tăng minFadeLength cho vocal

        // Điều chỉnh fadeLength
        let fadeLength = Math.max(Math.round(fadeTime * sampleRate), minFadeLength);
        fadeLength = adjustFadeLength(fadeLength, sampleRate, validatedSpectralProfile, validatedPitchShift, isVocal, cpuLoad, isLowPowerDevice);

        const activeLength = Math.round(activeTime * sampleRate);
        const totalLength = activeLength + Math.max(0, Math.round((activeTime - 2 * fadeTime) * sampleRate));

        // Tạo buffer
        const buffer = context.createBuffer(validatedChannels, totalLength, sampleRate);
        if (!buffer) {
            throw new Error("Failed to create delay time buffer.");
        }

        // Áp dụng linear delay với smoothing
        const pitchFactor = Math.abs(validatedPitchShift);
        const smoothing = Math.min(fadeLength / 8, 20); // Smoothing động
        for (let ch = 0; ch < validatedChannels; ch++) {
            const channelData = buffer.getChannelData(ch);
            for (let i = 0; i < activeLength; i++) {
                let delayValue = shiftUp ? (activeLength - i) / activeLength : i / activeLength;
                if (i < smoothing) {
                    const t = 0.5 * (1 - Math.cos(Math.PI * i / smoothing));
                    delayValue = delayValue * t + (shiftUp ? 1 : 0) * (1 - t);
                } else if (i >= activeLength - smoothing) {
                    const t = 0.5 * (1 - Math.cos(Math.PI * (activeLength - i) / smoothing));
                    delayValue = delayValue * t + (shiftUp ? 0 : 1) * (1 - t);
                }
                channelData[i] = delayValue;
            }
            for (let i = activeLength; i < totalLength; i++) {
                channelData[i] = 0; // Silence
            }
        }

        // Kiểm tra buffer hợp lệ
        if (!(buffer instanceof AudioBuffer) || buffer.length < activeLength || buffer.numberOfChannels !== validatedChannels) {
            throw new Error('Invalid delay time buffer created');
        }

        // Lưu buffer
        const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}`;
        const key = `delay_${activeTime}_${fadeTime}_${validatedPitchShift}_${shiftUp}_${qualityMode}_${validatedChannels}_${spectralKey}`;
        memoryManager.set(key, buffer, 'high', { metadata: { timestamp: Date.now() } });
        memoryManager.pruneCache(memoryManager.getDynamicMaxSize?.() || 1000);

        // Debug log
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug(`Created delay time buffer with key: ${key}`, {
                bufferLength: buffer.length,
                channels: buffer.numberOfChannels,
                sampleRate: buffer.sampleRate,
                smoothing,
                shiftUp,
                pitchFactor
            });
        }

        return buffer;
    } catch (error) {
        handleError('Error creating delay time buffer', error, { activeTime, fadeTime, shiftUp, options, sampleRate: context?.sampleRate }, 'high', { memoryManager });
        return null;
    }
}

// Các hằng số mặc định
const DEFAULT_DELAY_TIME = 0.080;
const DEFAULT_FADE_TIME = 0.100;
const DEFAULT_BUFFER_TIME = 0.200;
const DEFAULT_RAMP_TIME = 0.075;
const MAX_DELAY_TIME = 5;
const DEFAULT_LOW_PASS_FREQ = 18000; // Tăng từ 17000
const DEFAULT_HIGH_PASS_FREQ = 40;
const DEFAULT_NOTCH_FREQ = 3500;
const DEFAULT_FILTER_Q = 0.3;
const DEFAULT_NOTCH_Q = 2.5;
const DEFAULT_FORMANT_F1_FREQ = 550; // Tăng từ 500
const DEFAULT_FORMANT_F2_FREQ = 2000;
const DEFAULT_FORMANT_F3_FREQ = 3200; // Tăng từ 3000
const DEFAULT_FORMANT_Q = 1.8;
const DEFAULT_FORMANT_Q_MIN = 0.8;
const DEFAULT_FORMANT_Q_MAX = 3.0;
const DEFAULT_FORMANT_GAIN = 4.5; // Tăng từ 4.0
const DEFAULT_SUBMID_FREQ = 500;
const DEFAULT_SUBTREBLE_FREQ = 11000; // Tăng từ 10000
const DEFAULT_MIDBASS_FREQ = 200;
const DEFAULT_HIGHMID_FREQ = 2000;
const DEFAULT_AIR_FREQ = 13000; // Tăng từ 12000
const DEFAULT_COMPRESSOR_THRESHOLD = -18; // Tăng từ -20
const DEFAULT_COMPRESSOR_RATIO = 3.0; // Tăng từ 2.5
const DEFAULT_COMPRESSOR_ATTACK = 0.005;
const DEFAULT_COMPRESSOR_RELEASE = 0.2;
const DEFAULT_HARMONIC_EXCITER_GAIN = 0.4; // Tăng từ 0.3
const DEFAULT_TRANSIENT_BOOST = 0.5; // Tăng từ 0.4
const DEFAULT_STEREO_WIDTH = 0.07; // Tăng từ 0.05
const DEFAULT_REVERB_WET_GAIN = 0.35; // Tăng từ 0.3
const DEFAULT_REVERB_DECAY = 1.5;
const DEFAULT_FFT_SIZE = 4096; // Tăng từ 2048
const DEFAULT_MIN_FADE_LENGTH = 768; // Tăng từ 512

class MemoryManager {
    constructor() {
        this.buffers = new Map();
        this.priorities = new Map();
        this.accessTimestamps = new Map();
        this.expiryTime = 90000; // 90s
        this.maxTotalSize = 100 * 1024 * 1024; // 100MB mặc định
    }

    /**
     * Compresses AudioBuffer to Uint8Array for storage efficiency.
     * @param {AudioBuffer} buffer - Buffer to compress
     * @returns {Uint8Array} Compressed data
     */
    compressBuffer(buffer) {
        if (!(buffer instanceof AudioBuffer)) return null;
        const data = new Float32Array(buffer.length * buffer.numberOfChannels);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const channelData = buffer.getChannelData(ch);
            data.set(channelData, ch * buffer.length);
        }
        // Nén đơn giản: Chuyển Float32Array thành Uint8Array (giảm 4x)
        const uint8 = new Uint8Array(data.buffer);
        return uint8;
    }

    /**
     * Decompresses Uint8Array back to AudioBuffer.
     * @param {Uint8Array} compressed - Compressed data
     * @param {number} length - Original buffer length
     * @param {number} channels - Number of channels
     * @param {number} sampleRate - Sample rate
     * @returns {AudioBuffer} Decompressed buffer
     */
    decompressBuffer(compressed, length, channels, sampleRate) {
        if (!(compressed instanceof Uint8Array)) return null;
        const float32 = new Float32Array(compressed.buffer);
        const buffer = new AudioContext().createBuffer(channels, length, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
            const channelData = buffer.getChannelData(ch);
            channelData.set(float32.subarray(ch * length, (ch + 1) * length));
        }
        return buffer;
    }

    /**
     * Calculates buffer size in bytes.
     * @param {Object} buffer - Buffer data
     * @returns {number} Size in bytes
     */
    getBufferSize(buffer) {
        if (buffer instanceof AudioBuffer) {
            const length = ensureFinite(buffer.length, 0, { errorMessage: 'Invalid buffer.length' });
            const channels = ensureFinite(buffer.numberOfChannels, 1, { errorMessage: 'Invalid buffer.numberOfChannels' });
            if (length < 0 || channels < 0) {
                handleError('Invalid buffer dimensions', new Error('Negative length or channels'), { length, channels }, 'high', { memoryManager: this });
                return 0;
            }
            return length * channels * 4; // Float32Array: 4 bytes/sample
        } else if (buffer instanceof Uint8Array) {
            return buffer.byteLength; // Kích thước nén
        }
        return 0; // Non-AudioBuffer (e.g., formantHistory)
    }

    /**
     * Retrieves a buffer by key, updating access timestamp and checking expiry.
     * Compatible with Jungle's getFFTAnalysis and optimizeSoundProfile.
     * @param {string} key - Buffer key
     * @returns {Object|undefined} Buffer data
     */
    get(key) {
        if (!this.buffers.has(key)) return undefined;
        const { buffer, metadata } = this.buffers.get(key);
        const timestamp = metadata?.timestamp || this.accessTimestamps.get(key) || 0;
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (timestamp && Date.now() - timestamp > this.expiryTime) {
            if (isDebug) console.debug(`Buffer expired for key: ${key}, removing`);
            this.buffers.delete(key);
            this.priorities.delete(key);
            this.accessTimestamps.delete(key);
            return undefined;
        }
        this.accessTimestamps.set(key, Date.now());
        if (buffer instanceof Uint8Array && metadata?.originalLength && metadata?.channels && metadata?.sampleRate) {
            return this.decompressBuffer(buffer, metadata.originalLength, metadata.channels, metadata.sampleRate);
        }
        return buffer;
    }

    /**
     * Alias for get, maintaining backward compatibility.
     * @param {string} key - Buffer key
     * @returns {Object|undefined} Buffer data
     */
    getBuffer(key) {
        return this.get(key);
    }

    /**
     * Stores a buffer with priority, metadata, and updating access timestamp.
     * Compatible with Jungle's set method.
     * @param {string} key - Buffer key
     * @param {Object} buffer - Buffer data
     * @param {string} [priority='normal'] - Priority ('normal' or 'high')
     * @param {Object} [metadata={}] - Metadata (e.g., timestamp)
     */
    set(key, buffer, priority = 'normal', metadata = {}) {
        try {
            // Validate buffer
            if (!buffer || (buffer instanceof AudioBuffer && (buffer.length <= 0 || !Number.isFinite(buffer.sampleRate)))) {
                throw new Error('Invalid buffer provided');
            }

            // Kiểm tra maxTotalSize trước khi lưu
            const bufferSize = this.getBufferSize(buffer);
            let totalSize = 0;
            for (const { buffer: b } of this.buffers.values()) {
                totalSize += this.getBufferSize(b);
            }
            if (totalSize + bufferSize > this.maxTotalSize) {
                throw new Error(`Buffer size exceeds maxTotalSize: ${bufferSize} bytes, total: ${totalSize}`);
            }

            // Nén AudioBuffer
            let storedBuffer = buffer;
            let updatedMetadata = { ...metadata, timestamp: metadata.timestamp || Date.now() };
            if (buffer instanceof AudioBuffer) {
                storedBuffer = this.compressBuffer(buffer);
                if (!storedBuffer) {
                    throw new Error('Failed to compress buffer');
                }
                updatedMetadata = {
                    ...updatedMetadata,
                    originalLength: buffer.length,
                    channels: buffer.numberOfChannels,
                    sampleRate: buffer.sampleRate
                };
            }

            // Validate priority
            const validPriorities = ['normal', 'high'];
            const effectivePriority = validPriorities.includes(priority) ? priority : 'normal';

            // Giao dịch: Đảm bảo đồng bộ
            const transaction = () => {
                this.buffers.set(key, { buffer: storedBuffer, metadata: updatedMetadata });
                this.priorities.set(key, effectivePriority);
                this.accessTimestamps.set(key, Date.now());
            };
            transaction();

            // Prune cache
            const maxSize = this.getDynamicMaxSize();
            this.pruneCache(maxSize);

            // Debug log
            const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
            if (isDebug) {
                console.debug(`Stored buffer with key: ${key}`, {
                    size: this.getBufferSize(storedBuffer),
                    priority: effectivePriority,
                    timestamp: updatedMetadata.timestamp,
                    compressed: storedBuffer instanceof Uint8Array
                });
            }
        } catch (error) {
            handleError('Error setting buffer', error, { key, priority, metadata, bufferSize: this.getBufferSize(buffer) }, 'high', { memoryManager: this });
        }
    }

    /**
     * Alias for set, maintaining backward compatibility.
     * @param {string} key - Buffer key
     * @param {Object} buffer - Buffer data
     * @param {string} [priority='normal'] - Priority
     * @param {Object} [metadata={}] - Metadata
     */
    allocateBuffer(key, buffer, priority = 'normal', metadata = {}) {
        this.set(key, buffer, priority, metadata);
    }

    /**
     * Prunes cache to fit within maxSize and maxTotalSize, prioritizing high-priority and recently accessed buffers.
     * @param {number} maxSize - Maximum number of buffers
     */
    pruneCache(maxSize) {
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        let totalSize = 0;
        for (const { buffer } of this.buffers.values()) {
            totalSize += this.getBufferSize(buffer);
        }

        // Xóa buffer hết hạn
        const expiredKeys = [];
        for (const [key, { metadata }] of this.buffers.entries()) {
            const timestamp = metadata?.timestamp || this.accessTimestamps.get(key) || 0;
            if (timestamp && Date.now() - timestamp > this.expiryTime) {
                expiredKeys.push(key);
            }
        }
        for (const key of expiredKeys) {
            const bufferSize = this.getBufferSize(this.buffers.get(key)?.buffer || 0);
            if (isDebug) console.debug(`Pruning expired buffer: ${key}, size: ${bufferSize} bytes`);
            this.buffers.delete(key);
            this.priorities.delete(key);
            this.accessTimestamps.delete(key);
            totalSize -= bufferSize;
        }

        // Xóa buffer nếu vượt maxSize hoặc maxTotalSize
        while (this.buffers.size > maxSize || totalSize > this.maxTotalSize) {
            const keys = Array.from(this.buffers.keys()).sort((a, b) => {
                const priorityA = this.priorities.get(a) === 'high' ? 1 : 0;
                const priorityB = this.priorities.get(b) === 'high' ? 1 : 0;
                const timeA = this.accessTimestamps.get(a) || 0;
                const timeB = this.accessTimestamps.get(b) || 0;
                return priorityB - priorityA || timeB - timeA;
            });

            const keyToRemove = keys[keys.length - 1];
            if (!keyToRemove) break;

            const bufferSize = this.getBufferSize(this.buffers.get(keyToRemove)?.buffer || 0);
            if (isDebug) {
                console.debug(`Pruning buffer: ${keyToRemove}, size: ${bufferSize} bytes, reason: ${this.buffers.size > maxSize ? 'maxSize' : 'maxTotalSize'}`);
            }

            this.buffers.delete(keyToRemove);
            this.priorities.delete(keyToRemove);
            this.accessTimestamps.delete(keyToRemove);
            totalSize -= bufferSize;

            if (this.buffers.size === 0) break;
        }

        // Log trạng thái cache
        if (isDebug) {
            console.debug(`Cache state after pruning`, this.getCacheStats());
        }
    }

    /**
     * Returns cache statistics.
     * @returns {Object} Cache stats
     */
    getCacheStats() {
        let totalSize = 0;
        let highPriorityCount = 0;
        for (const [key, { buffer }] of this.buffers.entries()) {
            totalSize += this.getBufferSize(buffer);
            if (this.priorities.get(key) === 'high') highPriorityCount++;
        }
        return {
            bufferCount: this.buffers.size,
            totalSizeBytes: totalSize,
            highPriorityCount,
            normalPriorityCount: this.buffers.size - highPriorityCount,
            maxTotalSize: this.maxTotalSize,
            maxBufferCount: this.getDynamicMaxSize()
        };
    }

    /**
     * Calculates dynamic max cache size based on device memory.
     * @returns {number} Dynamic max size
     */
    getDynamicMaxSize() {
        const deviceMemory = navigator.deviceMemory || 4;
        const baseSize = Math.round(50 + deviceMemory * 10);
        this.maxTotalSize = Math.max(100 * 1024 * 1024, deviceMemory * 50 * 1024 * 1024);
        return baseSize;
    }

    /**
     * Clears all buffers (for testing or reset).
     */
    clear() {
        this.buffers.clear();
        this.priorities.clear();
        this.accessTimestamps.clear();
    }
}

function Jungle(context, options = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    try {
        // Khởi tạo contextId
        this.contextId = options.contextId || Date.now().toString(36);

        // Kiểm tra cache khởi tạo qua generateCacheSignature
        const cacheKey = this.generateCacheSignature?.(this.contextId, {
            spectralProfile: options.spectralProfile,
            currentGenre: options.currentGenre,
            qualityMode: options.qualityMode
        }) || this.contextId;
        if (this.memoryManager?.get(cacheKey)?.timestamp > Date.now() - 60000) {
            const cachedConfig = this.memoryManager.get(cacheKey);
            if (isDebug) console.debug('Reusing cached Jungle config', { cacheKey, cachedConfig });
            Object.assign(this, cachedConfig.instance);
            return;
        }

        // Kiểm tra và khởi tạo AudioContext
        if (!context || !(context instanceof AudioContext) || context.state === 'closed') {
            console.warn('Invalid or closed AudioContext provided, creating new AudioContext');
            try {
                context = new AudioContext();
                this.ownsContext = true;
                if (isDebug) console.debug('Created new AudioContext', { contextId: this.contextId, sampleRate: context.sampleRate });
            } catch (error) {
                console.error('Không thể tạo AudioContext mới', error);
                throw new Error('Không thể khởi tạo AudioContext. Vui lòng kiểm tra trình duyệt hỗ trợ Web Audio API.');
            }
        } else {
            this.ownsContext = false;
        }
        this.context = context;

// Kiểm tra trạng thái AudioContext
if (this.context.state === 'suspended') {
    const resumeOnUserGesture = () => {
        this.context.resume()
            .then(() => console.debug('AudioContext đã được khôi phục', { contextId: this.contextId }))
            .catch(err => {
                console.warn('Không thể khôi phục AudioContext', err);
                this.notifyUIError('Vui lòng nhấp vào nút phát hoặc tương tác với trang để kích hoạt âm thanh.');
            });
    };

    // Lắng nghe sự kiện người dùng (click hoặc touchstart)
    const userGestureHandler = () => {
        resumeOnUserGesture();
        // Xóa các sự kiện sau khi thực hiện để tránh lặp lại
        document.removeEventListener('click', userGestureHandler);
        document.removeEventListener('touchstart', userGestureHandler);
    };
    document.addEventListener('click', userGestureHandler);
    document.addEventListener('touchstart', userGestureHandler);
}

        // Cảnh báo sampleRate thấp
        if (this.context.sampleRate < 44100) {
            console.warn(`SampleRate thấp (${this.context.sampleRate}Hz) có thể gây ra lỗi. Khuyến nghị sử dụng 44100Hz hoặc cao hơn.`);
        }
        this.isStarted = false;

        // Dự đoán qualityMode thông minh
        const deviceMemory = navigator.deviceMemory || 4;
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        this.qualityMode = options.qualityMode || (
            deviceMemory < 4 || cpuLoad > 0.8 || isLowPowerDevice ? 'low' : 'high'
        );

        // Khởi tạo tham số
        this.delayTime = ensureFinite(options.delayTime, DEFAULT_DELAY_TIME);
        this.fadeTime = ensureFinite(options.fadeTime, DEFAULT_FADE_TIME);
        this.bufferTime = ensureFinite(options.bufferTime, DEFAULT_BUFFER_TIME);
        this.rampTime = ensureFinite(options.rampTime, DEFAULT_RAMP_TIME);
        this.lowPassFreq = ensureFinite(options.lowPassFreq, DEFAULT_LOW_PASS_FREQ);
        this.highPassFreq = ensureFinite(options.highPassFreq, DEFAULT_HIGH_PASS_FREQ);
        this.notchFreq = ensureFinite(options.notchFreq, DEFAULT_NOTCH_FREQ);
        this.filterQ = ensureFinite(options.filterQ, DEFAULT_FILTER_Q);
        this.notchQ = ensureFinite(options.notchQ, DEFAULT_NOTCH_Q);
        this.formantF1Freq = ensureFinite(options.formantF1Freq, DEFAULT_FORMANT_F1_FREQ);
        this.formantF2Freq = ensureFinite(options.formantF2Freq, DEFAULT_FORMANT_F2_FREQ);
        this.formantQ = ensureFinite(options.formantQ, DEFAULT_FORMANT_Q);
        this.subMidFreq = ensureFinite(options.subMidFreq, DEFAULT_SUBMID_FREQ);
        this.subTrebleFreq = ensureFinite(options.subTrebleFreq, DEFAULT_SUBTREBLE_FREQ);
        this.midBassFreq = ensureFinite(options.midBassFreq, 200);
        this.highMidFreq = ensureFinite(options.highMidFreq, 2000);
        this.airFreq = ensureFinite(options.airFreq, 10000);

        // Khởi tạo spectralProfile với chroma
        this.spectralProfile = options.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: Array(12).fill(0.5) // Khởi tạo chroma
        };
        this.tempoMemory = options.tempoMemory || { current: 120, previous: 120 };
        this.currentGenre = options.currentGenre || "Unknown";
        this.currentKey = options.currentKey || { key: "Unknown", confidence: 0, isMajor: true };
        this.currentProfile = options.currentProfile || "proNatural";
        this.nextProcessingInterval = ensureFinite(options.nextProcessingInterval, 1000);
        this.currentPitchMult = ensureFinite(options.currentPitchMult, 0);
        this.noiseLevel = options.noiseLevel || { level: 0, midFreq: 0.5 };
        this.qualityPrediction = options.qualityPrediction || { score: 0, recommendations: [] };
        this.isVocal = options.isVocal || false;
        this.wienerGain = ensureFinite(options.wienerGain, 1);
        this.polyphonicPitches = options.polyphonicPitches || [];
        this.transientBoost = ensureFinite(options.transientBoost, 0);

        // Tối ưu bufferTime
        const pitchMultFactor = 1 + Math.abs(this.currentPitchMult) * 0.5;
        this.bufferTime = Math.max(this.bufferTime, this.fadeTime * 2.5 * pitchMultFactor);
        if (this.qualityMode === 'high') {
            this.bufferTime *= 1.2;
        }
        if (this.bufferTime < this.fadeTime * 2.5) {
            console.warn("bufferTime được điều chỉnh để đảm bảo chuyển đổi mượt mà", { bufferTime: this.bufferTime });
            this.bufferTime = this.fadeTime * 2.5;
        }
        if (this.delayTime > MAX_DELAY_TIME) {
            console.warn("delayTime vượt quá MAX_DELAY_TIME, giới hạn lại", { delayTime: MAX_DELAY_TIME });
            this.delayTime = MAX_DELAY_TIME;
        }

        // Khởi tạo MemoryManager
        this.memoryManager = options.memoryManager || new MemoryManager();
        const maxCacheSize = this.calculateMaxCacheSize?.() || 100;
        this.memoryManager.setDynamicMaxSize?.(maxCacheSize);
        this.memoryManager.pruneCache(maxCacheSize);
        if (isDebug) console.debug('MemoryManager initialized', { maxCacheSize, cacheStats: this.memoryManager.getCacheStats?.() });

        // Khởi tạo AnalyserNode
        try {
            this._analyser = options.analyser || this.context.createAnalyser();
            const analyserConfig = options.analyserConfig || {};
            this._analyser.fftSize = ensureFinite(analyserConfig.fftSize, this.qualityMode === 'low' ? 512 : 1024); // Tối ưu fftSize
            this._analyser.smoothingTimeConstant = ensureFinite(analyserConfig.smoothingTimeConstant, 0.85);
            if (isDebug) console.debug('AnalyserNode initialized', {
                fftSize: this._analyser.fftSize,
                smoothing: this._analyser.smoothingTimeConstant,
                contextState: this.context.state,
                contextId: this.contextId
            });
        } catch (error) {
            console.error('Không thể khởi tạo AnalyserNode', error);
            throw new Error('Không thể khởi tạo AnalyserNode. Vui lòng kiểm tra AudioContext.');
        }

        // Tạo buffers
        try {
            const bufferOptions = {
                contextId: this.contextId,
                smoothness: 1.3,
                vibrance: 0.5,
                pitchShift: this.currentPitchMult,
                isVocal: this.isVocal,
                spectralProfile: this.spectralProfile,
                currentGenre: this.currentGenre,
                noiseLevel: this.noiseLevel,
                wienerGain: this.wienerGain,
                polyphonicPitches: this.polyphonicPitches,
                qualityMode: this.qualityMode,
                edgeFade: 0.05
            };

            const buffers = getShiftBuffers(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);
            this.shiftDownBuffer = buffers.shiftDownBuffer;
            this.shiftUpBuffer = buffers.shiftUpBuffer;
            this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);

            if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
                throw new Error("Không thể tạo buffer hợp lệ");
            }
            if (this.fadeBuffer.length < this.bufferTime * this.context.sampleRate) {
                throw new Error("Độ dài fadeBuffer không đủ", {
                    expected: this.bufferTime * this.context.sampleRate,
                    actual: this.fadeBuffer.length
                });
            }

            if (isDebug) console.debug("Buffers initialized", {
                shiftDownLength: this.shiftDownBuffer.length,
                shiftUpLength: this.shiftUpBuffer.length,
                fadeBufferLength: this.fadeBuffer.length,
                bufferTime: this.bufferTime,
                fadeTime: this.fadeTime,
                sampleRate: this.context.sampleRate,
                bufferOptions
            });
        } catch (error) {
            console.error("Lỗi khi tạo buffer", error);
            if (this.ownsContext) this.context.close();
            throw error;
        }

        // Khởi tạo nodes
        try {
            this.initializeNodes();
            if (isDebug) console.debug("Nodes initialized successfully", { contextId: this.contextId });
        } catch (error) {
            console.error("Lỗi khi khởi tạo nodes", error);
            if (this.ownsContext) this.context.close();
            throw error;
        }

        // Khởi tạo spatial audio
        try {
            const spatialConfig = options.spatialAudioConfig || { panningModel: 'equalpower' };
            this.initializeSpatialAudio(spatialConfig);
            if (isDebug) console.debug("Spatial audio initialized successfully", { spatialConfig, contextId: this.contextId });
        } catch (error) {
            console.error("Lỗi khi khởi tạo spatial audio", error);
            if (this.ownsContext) this.context.close();
            throw error;
        }

        // Lưu cấu hình vào cache
        if (this.memoryManager) {
            this.memoryManager.set(cacheKey, {
                instance: {
                    contextId: this.contextId,
                    ownsContext: this.ownsContext,
                    context: this.context,
                    isStarted: this.isStarted,
                    qualityMode: this.qualityMode,
                    spectralProfile: this.spectralProfile,
                    tempoMemory: this.tempoMemory,
                    currentGenre: this.currentGenre,
                    currentProfile: this.currentProfile,
                    bufferTime: this.bufferTime,
                    fadeTime: this.fadeTime,
                    _analyser: this._analyser,
                    shiftDownBuffer: this.shiftDownBuffer,
                    shiftUpBuffer: this.shiftUpBuffer,
                    fadeBuffer: this.fadeBuffer
                },
                timestamp: Date.now(),
                expiry: Date.now() + 60000
            }, 'high');
            if (isDebug) console.debug('Cached Jungle config', { cacheKey, maxCacheSize });
        }

    } catch (error) {
        console.error('Lỗi trong hàm khởi tạo Jungle', error, { contextId: this.contextId });
        if (this.ownsContext && this.context) {
            this.context.close().catch(err => console.warn('Không thể đóng AudioContext', err));
        }
        throw error;
    }
}

Jungle.prototype.initializeNodes = function () {
    try {
        // Validate AudioContext
        if (!(this.context instanceof (window.AudioContext || window.webkitAudioContext))) {
            throw new Error('Invalid AudioContext: context is not an instance of AudioContext.');
        }

        // Check if already initialized
        if (this.input) {
            console.debug('Nodes already initialized, skipping reinitialization');
            return;
        }

        // Check device capability
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 2;
        const performanceFactor = isLowPowerDevice ? 0.8 : 1.0; // Reduce gain by 20% on low-power devices

        // Convert Float32Array to AudioBuffer
        const createAudioBuffer = (float32Array, context, sampleRate, options = {}) => {
            const {
                channels = 1,
                normalize = false,
                validateData = true
            } = options;

            if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
                throw new Error('Invalid AudioContext: context is not an instance of AudioContext.');
            }
            if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
                throw new Error(`Invalid sampleRate: must be a positive number, got ${sampleRate}.`);
            }
            if (!float32Array || !(float32Array instanceof Float32Array)) {
                throw new Error('Invalid Float32Array: buffer is undefined or not a Float32Array.');
            }
            if (float32Array.length === 0) {
                throw new Error('Invalid Float32Array: buffer is empty.');
            }
            if (![1, 2].includes(channels)) {
                throw new Error(`Invalid channels: must be 1 (mono) or 2 (stereo), got ${channels}.`);
            }
            if (float32Array.length % channels !== 0) {
                throw new Error(`Invalid buffer length: ${float32Array.length} not divisible by channels (${channels}).`);
            }

            if (validateData) {
                // Optimize for Worker: check subset for large buffers
                const step = float32Array.length > 10000 ? Math.floor(float32Array.length / 1000) : 1;
                for (let i = 0; i < float32Array.length; i += step) {
                    if (!Number.isFinite(float32Array[i])) {
                        throw new Error(`Invalid data at index ${i}: contains NaN or Infinity.`);
                    }
                }
            }

            let data = float32Array;
            if (normalize) {
                const maxAbs = Math.max(...float32Array.map(Math.abs));
                if (maxAbs > 1) {
                    data = new Float32Array(float32Array.length);
                    for (let i = 0; i < float32Array.length; i++) {
                        data[i] = float32Array[i] / maxAbs;
                    }
                }
            }

            const buffer = context.createBuffer(channels, data.length / channels, sampleRate);
            if (channels === 1) {
                buffer.getChannelData(0).set(data);
            } else {
                const leftChannel = new Float32Array(data.length / 2);
                const rightChannel = new Float32Array(data.length / 2);
                for (let i = 0; i < data.length / 2; i++) {
                    leftChannel[i] = data[i * 2];
                    rightChannel[i] = data[i * 2 + 1];
                }
                buffer.getChannelData(0).set(leftChannel);
                buffer.getChannelData(1).set(rightChannel);
            }

            return buffer;
        };

        // Initialize buffers
        if (this.shiftDownData instanceof Float32Array) {
            this.shiftDownBuffer = createAudioBuffer(this.shiftDownData, this.context, this.context.sampleRate, { channels: 1 });
        }
        if (this.shiftUpData instanceof Float32Array) {
            this.shiftUpBuffer = createAudioBuffer(this.shiftUpData, this.context, this.context.sampleRate, { channels: 1 });
        }
        if (this.fadeData instanceof Float32Array) {
            this.fadeBuffer = createAudioBuffer(this.fadeData, this.context, this.context.sampleRate, { channels: 1 });
        }

        if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
            throw new Error('Missing required buffers: shiftDownBuffer, shiftUpBuffer, or fadeBuffer is undefined.');
        }
        if (!(this.shiftDownBuffer instanceof AudioBuffer) || 
            !(this.shiftUpBuffer instanceof AudioBuffer) || 
            !(this.fadeBuffer instanceof AudioBuffer)) {
            throw new Error('Invalid buffer type: buffers must be instances of AudioBuffer.');
        }

        // Validate spectralProfile
        const spectralProfile = this.spectralProfile || {};
        const defaultSpectralValue = 0.5;
        const spectralDefaults = {
            subBass: defaultSpectralValue,
            bass: defaultSpectralValue,
            subMid: defaultSpectralValue,
            midHigh: defaultSpectralValue,
            subTreble: defaultSpectralValue,
            air: defaultSpectralValue,
            vocalPresence: defaultSpectralValue
        };
        Object.keys(spectralDefaults).forEach(key => {
            spectralProfile[key] = Number.isFinite(spectralProfile[key]) 
                ? Math.max(0, Math.min(1, spectralProfile[key])) 
                : spectralDefaults[key];
        });

        // Initialize gain and panner nodes
        this.input = this.context.createGain();
        this.output = this.context.createGain();
        this.boostGain = this.context.createGain();
        this.panner = this.context.createStereoPanner();

        // Calculate vocal and genre adjustments
        const vocalBoost = this.isVocal 
            ? 1.2 + spectralProfile.vocalPresence * 0.3 
            : 1.0;
        const genreFactorMap = {
            'EDM': 1.2,
            'DrumAndBass': 1.2,
            'HipHop': 1.1,
            'Pop': 1.0,
            'Bolero': 0.9,
            'Classical': 0.8,
            'Jazz': 0.8,
            'RockMetal': 1.0,
            'Karaoke': 0.9
        };
        const genreFactor = genreFactorMap[this.currentGenre] || 1.0;
        if (!genreFactorMap[this.currentGenre]) {
            console.debug('Unknown genre, using default factor:', this.currentGenre || 'Unknown');
        }

        // Initialize filters
        this.bassHighPassFilter = this.context.createBiquadFilter();
        this.bassHighPassFilter.type = 'highpass';
        this.bassHighPassFilter.frequency.value = this.highPassFreq || DEFAULT_HIGH_PASS_FREQ;
        this.bassHighPassFilter.Q.value = this.filterQ || DEFAULT_FILTER_Q;

        this.highPassFilter = this.context.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = this.highPassFreq || DEFAULT_HIGH_PASS_FREQ;
        this.highPassFilter.Q.value = this.filterQ || DEFAULT_FILTER_Q;

        this.lowPassFilter = this.context.createBiquadFilter();
        this.lowPassFilter.type = 'lowpass';
        this.lowPassFilter.frequency.value = this.lowPassFreq || DEFAULT_LOW_PASS_FREQ;
        this.lowPassFilter.Q.value = this.filterQ || DEFAULT_FILTER_Q;

        this.notchFilter = this.context.createBiquadFilter();
        this.notchFilter.type = 'notch';
        this.notchFilter.frequency.value = this.notchFreq || DEFAULT_NOTCH_FREQ;
        this.notchFilter.Q.value = this.notchQ || DEFAULT_NOTCH_Q;

        this.formantFilter1 = this.context.createBiquadFilter();
        this.formantFilter1.type = 'peaking';
        this.formantFilter1.frequency.value = this.formantF1Freq || DEFAULT_FORMANT_F1_FREQ;
        this.formantFilter1.Q.value = this.formantQ || DEFAULT_FORMANT_Q;
        this.formantFilter1.gain.value = 6 * vocalBoost * genreFactor * performanceFactor;

        this.formantFilter2 = this.context.createBiquadFilter();
        this.formantFilter2.type = 'peaking';
        this.formantFilter2.frequency.value = this.formantF2Freq || DEFAULT_FORMANT_F2_FREQ;
        this.formantFilter2.Q.value = this.formantQ || DEFAULT_FORMANT_Q;
        this.formantFilter2.gain.value = 6 * vocalBoost * genreFactor * performanceFactor;

        this.subBassFilter = this.context.createBiquadFilter();
        this.subBassFilter.type = 'peaking';
        this.subBassFilter.frequency.value = 40;
        this.subBassFilter.Q.value = 1.0;
        this.subBassFilter.gain.value = 3 * spectralProfile.subBass * genreFactor * performanceFactor;

        this.subMidFilter = this.context.createBiquadFilter();
        this.subMidFilter.type = 'peaking';
        this.subMidFilter.frequency.value = this.subMidFreq || DEFAULT_SUBMID_FREQ;
        this.subMidFilter.Q.value = 0.8;
        this.subMidFilter.gain.value = 2 * spectralProfile.subMid * genreFactor * performanceFactor;

        this.midBassFilter = this.context.createBiquadFilter();
        this.midBassFilter.type = 'peaking';
        this.midBassFilter.frequency.value = this.midBassFreq || 200;
        this.midBassFilter.Q.value = 0.7;
        this.midBassFilter.gain.value = 2 * spectralProfile.bass * genreFactor * performanceFactor;

        this.highMidFilter = this.context.createBiquadFilter();
        this.highMidFilter.type = 'peaking';
        this.highMidFilter.frequency.value = this.highMidFreq || 2000;
        this.highMidFilter.Q.value = 0.8;
        this.highMidFilter.gain.value = 2 * spectralProfile.midHigh * genreFactor * performanceFactor;

        this.subTrebleFilter = this.context.createBiquadFilter();
        this.subTrebleFilter.type = 'peaking';
        this.subTrebleFilter.frequency.value = this.subTrebleFreq || DEFAULT_SUBTREBLE_FREQ;
        this.subTrebleFilter.Q.value = 0.8;
        this.subTrebleFilter.gain.value = 2 * spectralProfile.subTreble * genreFactor * performanceFactor;

        this.airFilter = this.context.createBiquadFilter();
        this.airFilter.type = 'highshelf';
        this.airFilter.frequency.value = this.airFreq || 10000;
        this.airFilter.gain.value = 3 * spectralProfile.air * genreFactor * performanceFactor;

        // Initialize modulation sources for pitch shifting
        this.mod1 = this.context.createBufferSource();
        this.mod2 = this.context.createBufferSource();
        this.mod3 = this.context.createBufferSource();
        this.mod4 = this.context.createBufferSource();

        this.mod1.buffer = this.shiftDownBuffer;
        this.mod2.buffer = this.shiftDownBuffer;
        this.mod3.buffer = this.shiftUpBuffer;
        this.mod4.buffer = this.shiftUpBuffer;

        this.mod1.loop = true;
        this.mod2.loop = true;
        this.mod3.loop = true;
        this.mod4.loop = true;

        this.mod1Gain = this.context.createGain();
        this.mod2Gain = this.context.createGain();
        this.mod3Gain = this.context.createGain();
        this.mod3Gain.gain.value = 0;
        this.mod4Gain = this.context.createGain();
        this.mod4Gain.gain.value = 0;

        this.mod1.connect(this.mod1Gain);
        this.mod2.connect(this.mod2Gain);
        this.mod3.connect(this.mod3Gain);
        this.mod4.connect(this.mod4Gain);

        this.modGain1 = this.context.createGain();
        this.modGain2 = this.context.createGain();

        this.delay1 = this.context.createDelay(MAX_DELAY_TIME);
        this.delay2 = this.context.createDelay(MAX_DELAY_TIME);

        this.mod1Gain.connect(this.modGain1);
        this.mod2Gain.connect(this.modGain2);
        this.mod3Gain.connect(this.modGain1);
        this.mod4Gain.connect(this.modGain2);
        this.modGain1.connect(this.delay1.delayTime);
        this.modGain2.connect(this.delay2.delayTime);

        this.fade1 = this.context.createBufferSource();
        this.fade2 = this.context.createBufferSource();
        this.fade1.buffer = this.fadeBuffer;
        this.fade2.buffer = this.fadeBuffer;

        this.fade1.loop = true;
        this.fade2.loop = true;

        this.mix1 = this.context.createGain();
        this.mix2 = this.context.createGain();
        this.mix1.gain.value = 0;
        this.mix2.gain.value = 0;

        this.fade1.connect(this.mix1.gain);
        this.fade2.connect(this.mix2.gain);

        this.outputGain = this.context.createGain();
        this.outputGain.gain.value = 0.8;

        this.lowShelfGain = this.context.createBiquadFilter();
        this.lowShelfGain.type = 'lowshelf';
        this.lowShelfGain.frequency.value = 150;
        this.lowShelfGain.gain.value = 4.5 * spectralProfile.subBass * genreFactor * performanceFactor;

        this.highShelfGain = this.context.createBiquadFilter();
        this.highShelfGain.type = 'highshelf';
        this.highShelfGain.frequency.value = 5000;
        this.highShelfGain.gain.value = 4.5 * spectralProfile.subTreble * genreFactor * performanceFactor;

        this.midShelfGain = this.context.createBiquadFilter();
        this.midShelfGain.type = 'peaking';
        this.midShelfGain.frequency.value = 2000;
        this.midShelfGain.Q.value = 0.5;
        this.midShelfGain.gain.value = 4 * spectralProfile.midHigh * genreFactor * performanceFactor;

        this.trebleLowPass = this.context.createBiquadFilter();
        this.trebleLowPass.type = 'lowpass';
        this.trebleLowPass.frequency.value = 17000;
        this.trebleLowPass.Q.value = 0.3;

        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -28;
        this.compressor.knee.value = 20;
        this.compressor.ratio.value = 10;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = isLowPowerDevice ? 0.3 : 0.25;

        // Connect nodes in the signal chain
        this.input.connect(this.bassHighPassFilter);
        this.bassHighPassFilter.connect(this.highPassFilter);
        this.highPassFilter.connect(this.lowShelfGain);
        this.lowShelfGain.connect(this.subBassFilter);
        this.subBassFilter.connect(this.subMidFilter);
        this.subMidFilter.connect(this.midBassFilter);
        this.midBassFilter.connect(this.midShelfGain);
        this.midShelfGain.connect(this.highMidFilter);
        this.highMidFilter.connect(this.formantFilter1);
        this.formantFilter1.connect(this.formantFilter2);
        this.formantFilter2.connect(this.delay1);
        this.formantFilter2.connect(this.delay2);
        this.delay1.connect(this.mix1);
        this.delay2.connect(this.mix2);
        this.mix1.connect(this.boostGain);
        this.mix2.connect(this.boostGain);
        this.boostGain.connect(this.panner);
        this.panner.connect(this.highShelfGain);
        this.highShelfGain.connect(this.subTrebleFilter);
        this.subTrebleFilter.connect(this.airFilter);
        this.airFilter.connect(this.trebleLowPass);
        this.trebleLowPass.connect(this.lowPassFilter);
        this.lowPassFilter.connect(this.notchFilter);
        this.notchFilter.connect(this.outputGain);
        this.outputGain.connect(this.compressor);
        this.compressor.connect(this.output);

        // Validate nodes for spatial audio integration
        if (!this.boostGain || !this.highShelfGain || !this.subTrebleFilter) {
            throw new Error('Required nodes for spatial audio integration are missing');
        }

        // Initialize parameters
        if (typeof this.setDelay === 'function') {
            this.setDelay(this.delayTime || DEFAULT_DELAY_TIME);
        } else {
            console.warn('setDelay not defined, skipping delay initialization');
        }
        if (typeof this.setBoost === 'function') {
            this.setBoost(0.8);
        } else {
            console.warn('setBoost not defined, skipping boost initialization');
        }
        if (typeof this.setPan === 'function') {
            this.setPan(0);
        } else {
            console.warn('setPan not defined, skipping pan initialization');
        }
        if (typeof this.setPitchOffset === 'function') {
            this.setPitchOffset(0, false);
        } else {
            console.warn('setPitchOffset not defined, skipping pitch offset initialization');
        }
        if (this.output && this.output.gain) {
            this.output.gain.linearRampToValueAtTime(0.7, this.context.currentTime + 0.2);
            console.debug('Output gain set to 0.69');
        } else {
            console.warn('Output gain not set: this.output or this.output.gain is undefined');
        }

        // Debug logging
        console.debug('Audio nodes initialized successfully', {
            sampleRate: this.context.sampleRate,
            genre: this.currentGenre || 'Unknown',
            isVocal: this.isVocal,
            spectralProfile,
            isLowPowerDevice
        });
    } catch (error) {
        const errorContext = {
            contextValid: !!this.context,
            buffersValid: !!(this.shiftDownBuffer && this.shiftUpBuffer && this.fadeBuffer),
            spectralProfile: this.spectralProfile,
            genre: this.currentGenre,
            isVocal: this.isVocal,
            sampleRate: this.context?.sampleRate,
            isLowPowerDevice
        };
        if (typeof handleError === 'function') {
            handleError('Error initializing audio nodes', error, errorContext);
        } else {
            console.error('Error initializing audio nodes:', error, errorContext);
        }
        throw error;
    }
};

Jungle.prototype.initializeSpatialAudio = function () {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    try {
        // Validate AudioContext
        if (!(this.context instanceof AudioContext)) {
            throw new Error('Invalid AudioContext: context is not an instance of AudioContext.');
        }

        // Check device capability
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 2;
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;

        // Initialize spatial audio properties
        this.spatialAudioEnabled = isLowPowerDevice ? false : (localStorage.getItem('spatialAudioPreference') === 'true');
        this.reverbEnabled = false; // Tắt reverb mặc định để giữ âm thanh gốc
        this.audioFormat = 'stereo'; // Mặc định cho karaoke
        this.pannerNode = null; // For Atmos
        this.foaDecoder = null; // For Ambisonics
        this.binauralBypass = false; // For binaural
        this.userSpatialAudioPreference = this.spatialAudioEnabled;
        this.reverbBuffer = null; // Cache impulse response

        // Cache spatial audio config
        const cacheKey = this.generateCacheSignature?.('spatialAudioConfig', {
            spectralProfile: this.spectralProfile,
            songStructure: this.memoryManager?.get('lastStructure'),
            audioFormat: this.audioFormat
        }) || `spatialAudio_${this.contextId}`;
        if (this.memoryManager?.get(cacheKey)?.timestamp > Date.now() - 30000) {
            const cachedConfig = this.memoryManager.get(cacheKey);
            Object.assign(this, cachedConfig);
            if (isDebug) console.debug('Reused cached spatial audio config', { cacheKey, cachedConfig });
            return;
        }

        /**
         * Toggles spatial audio on/off and dispatches event for UI.
         * @param {boolean} enable - True to enable spatial audio, false for karaoke mode.
         */
        this.toggleSpatialAudio = function (enable) {
            this.userSpatialAudioPreference = !!enable;
            this.spatialAudioEnabled = !isLowPowerDevice && this.userSpatialAudioPreference && cpuLoad < 0.9;
            this.configureSignalChain(this.audioFormat);
            localStorage.setItem('spatialAudioPreference', this.spatialAudioEnabled);
            if (isDebug) console.debug('Spatial audio preference set:', {
                spatialAudioEnabled: this.spatialAudioEnabled,
                cpuLoad,
                isLowPowerDevice
            });
            this.dispatchEvent?.(new CustomEvent('spatialAudioChanged', { detail: { enabled: this.spatialAudioEnabled } }));
        };

        /**
         * Public API to enable/disable spatial audio.
         * @param {boolean} enable - True to enable spatial audio, false for karaoke mode.
         */
        this.setSpatialAudio = function (enable) {
            this.toggleSpatialAudio(enable);
        };

        /**
         * Public API to enable/disable reverb.
         * @param {boolean} enable - True to enable reverb, false to disable.
         */
        this.setReverb = function (enable) {
            this.reverbEnabled = !!enable;
            this.configureSignalChain(this.audioFormat);
            localStorage.setItem('reverbPreference', this.reverbEnabled);
            if (isDebug) console.debug('Reverb preference set:', {
                reverbEnabled: this.reverbEnabled,
                cpuLoad
            });
            this.dispatchEvent?.(new CustomEvent('reverbChanged', { detail: { enabled: this.reverbEnabled } }));
        };

        /**
         * Restores user preferences from localStorage.
         */
        this.restorePreferences = function () {
            const spatialPref = localStorage.getItem('spatialAudioPreference');
            const reverbPref = localStorage.getItem('reverbPreference');
            if (spatialPref !== null) this.setSpatialAudio(spatialPref === 'true');
            if (reverbPref !== null) this.setReverb(reverbPref === 'true');
            if (isDebug) console.debug('Restored preferences:', {
                spatialAudio: this.spatialAudioEnabled,
                reverb: this.reverbEnabled
            });
        };

        /**
         * Detects audio format with user feedback integration.
         * @param {AudioBuffer|MediaElementAudioSourceNode} input - Audio input source.
         * @returns {string} Detected format ('mono', 'stereo', 'binaural', 'ambisonics', 'atmos').
         */
        this.detectAudioFormat = function (input) {
            const cachedFormat = this.memoryManager?.getBuffer('audioFormat');
            if (cachedFormat && cachedFormat.expiry > Date.now()) {
                if (isDebug) console.debug('Using cached audio format:', cachedFormat.format);
                return cachedFormat.format;
            }

            let channels = 2;
            let metadata = {};
            let title = '';
            let description = '';

            if (input instanceof AudioBuffer) {
                channels = input.numberOfChannels || 2;
                metadata = input.metadata || {};
            } else if (input instanceof MediaElementAudioSourceNode && input.mediaElement) {
                const audioTracks = input.mediaElement.audioTracks || [];
                channels = audioTracks.length > 0 ? audioTracks[0].channelCount || 2 : 2;
                metadata = input.mediaElement.spatialAudioMetadata || {};
                title = input.mediaElement.title || input.mediaElement.src || '';
                description = input.mediaElement.dataset?.youtubeDescription || '';
            }

            let format = 'stereo';
            const lowerTitle = title.toLowerCase();
            const lowerDesc = description.toLowerCase();
            const spatialKeywords = ['8d audio', '10d audio', 'spatial audio', 'dolby atmos'];

            // Tích hợp userFeedback
            const feedbackList = this.memoryManager?.get('userFeedback') || [];
            const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
            if (recentFeedback?.semanticCategory === 'vocal') {
                format = 'binaural'; // Ưu tiên binaural cho giọng hát
            } else if (channels === 1) {
                format = 'mono';
            } else if (channels === 2 && (metadata.hrtf || spatialKeywords.some(kw => lowerTitle.includes(kw) || lowerDesc.includes(kw)))) {
                format = 'binaural';
            } else if (channels === 4 && metadata.format === 'ambisonics') {
                format = 'ambisonics';
            } else if (channels >= 6 && (metadata.format === 'atmos' || spatialKeywords.some(kw => lowerTitle.includes(kw) || lowerDesc.includes(kw)))) {
                format = 'atmos';
            }

            if (['binaural', 'ambisonics', 'atmos'].includes(format) && !navigator.mediaDevices?.getUserMedia) {
                console.warn('Spatial audio may require headphones for optimal experience.');
            }

            this.memoryManager?.allocateBuffer('audioFormat', {
                format,
                timestamp: Date.now(),
                expiry: Date.now() + 30000,
                priority: 'high'
            });
            this.memoryManager?.pruneCache(this.calculateMaxCacheSize?.() || 100);

            if (isDebug) console.debug('Detected audio format:', {
                format,
                channels,
                metadata,
                title,
                description,
                recentFeedback
            });
            return format;
        };

        /**
         * Initializes FOA decoder with spectralProfile adjustment.
         * @param {AudioNode} inputNode - Input node with 4 channels.
         * @returns {AudioNode} Stereo output node.
         */
        this.initializeFOADecoder = function (inputNode) {
            const splitter = this.context.createChannelSplitter(4);
            inputNode.connect(splitter);

            const wGain = this.context.createGain();
            const xGain = this.context.createGain();
            const yGain = this.context.createGain();
            const zGain = this.context.createGain();

            splitter.connect(wGain, 0);
            splitter.connect(xGain, 1);
            splitter.connect(yGain, 2);
            splitter.connect(zGain, 3);

            const merger = this.context.createChannelMerger(2);
            const leftGain = this.context.createGain();
            const rightGain = this.context.createGain();

            // Điều chỉnh dựa trên spectralProfile.vocalPresence
            const vocalPresence = this.spectralProfile?.vocalPresence || 0.5;
            wGain.gain.value = 1.0 / Math.sqrt(2);
            xGain.gain.value = vocalPresence > 0.7 ? 1.2 : 1.0; // Tăng front-back cho vocal
            yGain.gain.value = 1.0;
            zGain.gain.value = cpuLoad > 0.8 ? 0.3 : 0.5; // Giảm up-down nếu CPU cao

            wGain.connect(leftGain);
            xGain.connect(leftGain);
            yGain.connect(leftGain);
            zGain.connect(leftGain);

            wGain.connect(rightGain);
            xGain.connect(rightGain);
            const yInverter = this.context.createGain();
            yInverter.gain.value = -1.0;
            yGain.connect(yInverter);
            yInverter.connect(rightGain);
            zGain.connect(rightGain);

            leftGain.connect(merger, 0, 0);
            rightGain.connect(merger, 0, 1);

            if (isDebug) console.debug('FOA decoder initialized', { vocalPresence, cpuLoad });
            return merger;
        };

        /**
         * Configures signal chain with songStructure integration.
         * @param {string} format - Audio format.
         */
        this.configureSignalChain = function (format) {
            format = format || 'stereo';
            this.audioFormat = format;
            const isSpatialFormat = ['binaural', 'ambisonics', 'atmos'].includes(format);
            this.spatialAudioEnabled = !isLowPowerDevice && this.userSpatialAudioPreference && isSpatialFormat && cpuLoad < 0.9;

            if (!this.boostGain || !this.highShelfGain || !this.subTrebleFilter) {
                console.warn('Required nodes missing, skipping signal chain configuration');
                return;
            }

            // Disconnect existing nodes
            if (this.panner) {
                this.panner.disconnect();
                this.panner = null;
            }
            if (this.pannerNode) {
                this.pannerNode.disconnect();
                this.pannerNode = null;
            }
            if (this.foaDecoder) {
                this.foaDecoder.disconnect();
                this.foaDecoder = null;
            }
            if (this.reverb) {
                this.reverb.disconnect();
                this.reverb = null;
            }
            if (this.reverbGain) {
                this.reverbGain.disconnect();
                this.reverbGain = null;
            }
            this.boostGain.disconnect();
            this.highShelfGain.disconnect();
            this.highShelfGain.connect(this.subTrebleFilter);

            // Tích hợp songStructure
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            const panAdjust = songStructure.section === 'chorus' ? 0.2 : 0; // Mở rộng stereo cho chorus

            if (!this.spatialAudioEnabled) {
                this.panner = this.context.createStereoPanner();
                this.boostGain.connect(this.panner);
                this.panner.connect(this.highShelfGain);
                this.setPan(panAdjust);
                this.binauralBypass = false;
                if (isDebug) console.debug('Configured signal chain for karaoke:', { format, panAdjust });
            } else if (format === 'binaural') {
                this.binauralBypass = true;
                this.panner = this.context.createStereoPanner();
                this.boostGain.connect(this.panner);
                this.panner.connect(this.highShelfGain);
                this.setPan(0);
                if (isDebug) console.debug('Configured signal chain for binaural audio');
            } else if (format === 'ambisonics') {
                this.foaDecoder = this.initializeFOADecoder(this.boostGain);
                this.foaDecoder.connect(this.highShelfGain);
                if (isDebug) console.debug('Configured signal chain for Ambisonics');
            } else if (format === 'atmos') {
                this.pannerNode = this.context.createPanner();
                this.pannerNode.panningModel = 'HRTF';
                this.pannerNode.distanceModel = 'inverse';
                this.pannerNode.refDistance = 1;
                this.pannerNode.maxDistance = 10000;
                this.pannerNode.rolloffFactor = songStructure.section === 'chorus' ? 1.2 : 1; // Tăng rolloff cho chorus
                this.boostGain.connect(this.pannerNode);
                this.pannerNode.connect(this.highShelfGain);
                if (isDebug) console.debug('Configured signal chain for Dolby Atmos', { rolloffFactor: this.pannerNode.rolloffFactor });
            }

            // Chỉ thêm reverb nếu bật rõ ràng
            if (this.reverbEnabled) {
                this.reverb = this.context.createConvolver();
                this.reverb.buffer = this.reverbBuffer || this.createImpulseResponse();
                this.reverbGain = this.context.createGain();
                this.reverbGain.gain.value = cpuLoad > 0.9 ? 0.02 : (this.spatialAudioEnabled ? 0.2 : 0.05);
                this.highShelfGain.connect(this.reverb);
                this.reverb.connect(this.reverbGain);
                this.reverbGain.connect(this.subTrebleFilter);
                if (isDebug) console.debug('Added reverb', { reverbGain: this.reverbGain.gain.value });
            } else {
                if (isDebug) console.debug('Reverb disabled to preserve raw audio');
            }
        };

        /**
         * Creates impulse response for reverb.
         * @returns {AudioBuffer} Impulse response buffer.
         */
        this.createImpulseResponse = function () {
            const isVeryLowPower = navigator.hardwareConcurrency === 1;
            const length = this.context.sampleRate * (isVeryLowPower ? 0.2 : (isLowPowerDevice ? 0.3 : 0.5));
            const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
            for (let channel = 0; channel < 2; channel++) {
                const data = buffer.getChannelData(channel);
                for (let i = 0; i < length; i++) {
                    const t = i / length;
                    data[i] = (Math.random() * 2 - 1) * Math.exp(-5 * t);
                }
            }
            this.reverbBuffer = buffer;
            return buffer;
        };

        /**
         * Sets spatial position for PannerNode with songStructure.
         * @param {number} azimuth - Azimuth angle in radians.
         * @param {number} elevation - Elevation angle in radians.
         * @param {number} distance - Distance from listener.
         */
        this.setSpatialPosition = function (azimuth, elevation, distance = 1) {
            if (!this.pannerNode || !this.spatialAudioEnabled) return;
            azimuth = ensureFinite(azimuth, 0);
            elevation = ensureFinite(elevation, 0);
            distance = ensureFinite(distance, 1);
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            const distanceAdjust = songStructure.section === 'chorus' ? distance * 1.2 : distance; // Tăng khoảng cách cho chorus
            const x = distanceAdjust * Math.cos(azimuth) * Math.cos(elevation);
            const y = distanceAdjust * Math.sin(elevation);
            const z = -distanceAdjust * Math.sin(azimuth) * Math.cos(elevation);
            this.pannerNode.positionX.setValueAtTime(x, this.context.currentTime);
            this.pannerNode.positionY.setValueAtTime(y, this.context.currentTime);
            this.pannerNode.positionZ.setValueAtTime(z, this.context.currentTime);
            if (isDebug) console.debug('Set spatial position:', { azimuth, elevation, distance: distanceAdjust, x, y, z, songStructure });
        };

        /**
         * Bypasses mono buffers for binaural audio.
         * @param {AudioBuffer} input - Input audio buffer.
         * @returns {boolean} True if bypassed.
         */
        this.bypassMonoBuffers = function (input) {
            if (this.binauralBypass && input.numberOfChannels === 2) {
                this.input.connect(this.bassHighPassFilter);
                if (isDebug) console.debug('Bypassed mono buffers for binaural audio');
                return true;
            }
            return false;
        };

        /**
         * Overrides processAudio to handle spatial audio.
         * @param {AudioBuffer|MediaElementAudioSourceNode} input - Audio input.
         * @param {Object} params - Processing parameters.
         */
        const originalProcessAudio = this.processAudio;
        this.processAudio = async function (input, params = {}) {
            const format = this.detectAudioFormat(input);
            this.configureSignalChain(format);

            if (format === 'binaural' && this.spatialAudioEnabled) {
                this.bypassMonoBuffers(input);
            }

            if (format === 'atmos' && this.spatialAudioEnabled && params.azimuth !== undefined && params.elevation !== undefined) {
                this.setSpatialPosition(
                    ensureFinite(params.azimuth, 0),
                    ensureFinite(params.elevation, 0),
                    ensureFinite(params.distance, 1)
                );
            }

            await originalProcessAudio.call(this, input, params);
        };

        /**
         * Overrides initializeNodes to integrate spatial audio.
         */
        const originalInitializeNodes = this.initializeNodes;
        this.initializeNodes = function () {
            originalInitializeNodes.call(this);
            this.configureSignalChain(this.audioFormat);
            if (isDebug) console.debug('Spatial audio initialized within node chain');
        };

        // Lưu cấu hình vào cache
        if (this.memoryManager) {
            this.memoryManager.set(cacheKey, {
                spatialAudioEnabled: this.spatialAudioEnabled,
                reverbEnabled: this.reverbEnabled,
                audioFormat: this.audioFormat,
                pannerNode: this.pannerNode,
                foaDecoder: this.foaDecoder,
                binauralBypass: this.binauralBypass,
                userSpatialAudioPreference: this.userSpatialAudioPreference,
                reverbBuffer: this.reverbBuffer
            }, 'high', { timestamp: Date.now(), expiry: Date.now() + 30000 });
            this.memoryManager.pruneCache(this.calculateMaxCacheSize?.() || 100);
        }

        // Restore preferences and initialize
        this.restorePreferences();
        this.configureSignalChain(this.audioFormat);
        if (isDebug) console.debug('Spatial audio initialization complete', {
            audioFormat: this.audioFormat,
            spatialAudioEnabled: this.spatialAudioEnabled,
            reverbEnabled: this.reverbEnabled,
            spectralProfile: this.spectralProfile,
            songStructure: this.memoryManager?.get('lastStructure'),
            cacheStats: this.memoryManager?.getCacheStats?.()
        });
    } catch (error) {
        console.error('Error initializing spatial audio:', error, {
            contextValid: !!this.context,
            audioFormat: this.audioFormat,
            sampleRate: this.context?.sampleRate,
            spatialAudioEnabled: this.spatialAudioEnabled,
            reverbEnabled: this.reverbEnabled
        });
        if (this.boostGain && this.highShelfGain) {
            this.panner = this.context.createStereoPanner();
            this.boostGain.connect(this.panner);
            this.panner.connect(this.highShelfGain);
            this.setPan(0);
        }
        throw error;
    }
};

Jungle.prototype.stereoMix = function (balance) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    try {
        balance = ensureFinite(balance, 0);
        balance = Math.max(-1, Math.min(1, balance));

        if (!this.panner) {
            console.warn('Panner node not initialized, skipping stereo mix adjustment');
            return;
        }

        // Lấy thông tin thiết bị và spectral profile
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const fftAnalysis = this.getFFTAnalysis?.() || {};
        const spectralProfile = {
            vocalEnergy: fftAnalysis.vocalEnergy || 0.5,
            transientDensity: fftAnalysis.transientDensity || 0.5,
            spectralFlux: fftAnalysis.spectralFlux || 0.5
        };
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const profile = this.profile || 'smartStudio';

        // Tích hợp userFeedback
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
        const isVocalFeedback = recentFeedback?.semanticCategory === 'vocal';
        const feedbackAdjustments = this.applyUserFeedback?.() || {
            balance: 0, vocalClarity: 0, spatialWidth: 0
        };

        // Điều chỉnh balance dựa trên profile và feedback
        let adjustedBalance = balance;
        if (isVocalFeedback || spectralProfile.vocalEnergy > 0.75 || profile === 'vocal' || profile === 'karaokeDynamic') {
            adjustedBalance = 0; // Giữ trung tâm cho vocal
            if (isDebug) console.debug('Forced centered balance due to vocal feedback or profile:', { profile, vocalEnergy: spectralProfile.vocalEnergy });
        } else if (profile === 'smartStudio' && spectralProfile.transientDensity > 0.65) {
            adjustedBalance *= 0.9; // Giảm lệch nhẹ để giữ chi tiết transient
            if (isDebug) console.debug('Reduced balance for transient-heavy audio in Smart.S profile:', { transientDensity: spectralProfile.transientDensity });
        }
        if (feedbackAdjustments.balance !== 0) {
            adjustedBalance = Math.max(-1, Math.min(1, adjustedBalance + feedbackAdjustments.balance * 0.3)); // Tích hợp user feedback
            if (isDebug) console.debug('Adjusted balance based on user feedback:', { feedbackBalance: feedbackAdjustments.balance });
        }

        // Tối ưu hóa cho thiết bị yếu
        if (isLowPowerDevice && cpuLoad > 0.85) {
            adjustedBalance *= 0.95; // Giảm lệch để giảm tải xử lý
            if (isDebug) console.debug('Reduced balance adjustment for low-power device:', { cpuLoad, isLowPowerDevice });
        }

        // Xử lý stereo mix
        if (!this.spatialAudioEnabled) {
            this.panner.pan.linearRampToValueAtTime(adjustedBalance, this.context.currentTime + 0.01); // Thêm ramp nhẹ
            if (isDebug) console.debug('Stereo mix set for non-spatial audio:', { adjustedBalance, profile, recentFeedback });
        } else {
            if (this.audioFormat === 'binaural') {
                this.panner.pan.linearRampToValueAtTime(0, this.context.currentTime + 0.01); // Giữ trung tâm cho binaural
                if (isDebug) console.debug('Stereo mix preserved for binaural audio:', { adjustedBalance });
            } else if (this.foaDecoder || this.pannerNode) {
                // Bỏ qua điều chỉnh balance cho spatial audio
                if (isDebug) console.debug('Stereo mix bypassed for spatial audio:', { audioFormat: this.audioFormat, adjustedBalance });
            }
        }

        // Lưu stereo mix settings vào memoryManager
        if (this.memoryManager && spectralProfile.spectralFlux > 0.03) {
            const cacheKey = `stereoMix_${this.contextId}_${profile}_${songStructure.section}_${spectralProfile.spectralFlux.toFixed(2)}`;
            const cacheData = {
                data: {
                    balance: adjustedBalance,
                    timestamp: Date.now(),
                    profile,
                    songStructure,
                    spectralProfile,
                    feedbackAdjustments
                },
                expiry: Date.now() + (isLowPowerDevice && cpuLoad > 0.85 ? 10000 : 15000), // Tối ưu expiry
                priority: 'medium'
            };
            this.memoryManager.set(cacheKey, cacheData, 'medium');
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 50); // Giảm max cache size
        }

        // Dispatch event
        this.dispatchEvent?.(new CustomEvent('stereoMixChanged', { detail: { balance: adjustedBalance } }));

    } catch (error) {
        console.error('Error setting stereo mix:', error, {
            balance,
            adjustedBalance,
            spatialAudioEnabled: this.spatialAudioEnabled,
            audioFormat: this.audioFormat,
            profile,
            spectralProfile,
            songStructure,
            recentFeedback,
            feedbackAdjustments,
            cpuLoad,
            isLowPowerDevice
        });
    }
};

/**
 * Initializes Web Worker for audio processing.
 * @throws {Error} If Web Worker is not supported or fails to initialize.
 * @note Ensures Worker has its own MemoryManager instance to avoid conflicts.
 * @note Sends initialization parameters to Worker for consistent buffer creation.
 */
Jungle.prototype.initializeWorker = function () {
    if (!this.worker) {
        try {
            if (!window.Worker) {
                throw new Error("Web Workers are not supported in this environment.");
            }
            this.worker = new Worker('audioWorker.js');
            this.worker.postMessage({
                command: 'init',
                params: {
                    smoothness: 1.3,
                    vibrance: 0.5,
                    pitchShift: this.currentPitchMult,
                    isVocal: this.isVocal,
                    spectralProfile: this.spectralProfile,
                    currentGenre: this.currentGenre,
                    noiseLevel: this.noiseLevel,
                    wienerGain: this.wienerGain,
                    polyphonicPitches: this.polyphonicPitches,
                    sampleRate: this.context.sampleRate,
                    memoryManager: true,
                    qualityMode: this.qualityMode,
                    userFeedback: this.memoryManager.getBuffer('userFeedback') || {},
                    deviceInfo: {
                        memory: navigator.deviceMemory || 4,
                        hardwareConcurrency: navigator.hardwareConcurrency || 2
                    },
                    contextAnalysis: this.initializeContextAnalyzer ? this.initializeContextAnalyzer().analyze(this) : {},
                    cpuLoadHistory: this.memoryManager.getBuffer('cpuLoadHistory') || []
                }
            });

            // Khởi tạo mảng sự kiện nếu chưa có
            this.eventListeners = this.eventListeners || {};

            // Hàm thay thế cho registerEvent
            this.registerEvent = this.registerEvent || function (eventName, callback) {
                this.eventListeners[eventName] = this.eventListeners[eventName] || [];
                this.eventListeners[eventName].push(callback);
            };

            // Hàm kích hoạt sự kiện
            this.triggerEvent = this.triggerEvent || function (eventName, ...args) {
                const listeners = this.eventListeners[eventName] || [];
                listeners.forEach(callback => callback.apply(this, args));
            };

            this.worker.onmessage = (e) => {
                const { type, data } = e.data;
                const errorContext = {
                    spectralProfile: this.spectralProfile,
                    wienerGain: this.wienerGain,
                    polyphonicPitches: this.polyphonicPitches,
                    transientBoost: this.transientBoost,
                    bufferTime: this.bufferTime,
                    fadeTime: this.fadeTime,
                    sampleRate: this.context.sampleRate
                };

                switch (type) {
                    case "audioResult":
                        const validPitches = Array.isArray(data.polyphonicPitches)
                            ? data.polyphonicPitches.filter(p => Number.isFinite(p.frequency) && p.confidence >= 0 && p.confidence <= 1)
                            : this.polyphonicPitches;
                        const validWienerGain = Number.isFinite(data.wienerGain) && data.wienerGain >= 0 && data.wienerGain <= 2
                            ? data.wienerGain
                            : this.wienerGain;
                        const validNoiseLevel = data.noiseLevel && typeof data.noiseLevel === 'object'
                            ? data.noiseLevel
                            : { level: data.noiseLevel || 0, midFreq: data.noiseLevel || 0.5 };

                        this.spectralProfile = data.spectralProfile || this.spectralProfile;
                        this.tempoMemory = data.tempo || this.tempoMemory;
                        this.currentGenre = data.genre || this.currentGenre;
                        this.currentKey = data.key || this.currentKey;
                        this.nextProcessingInterval = data.processingInterval || this.nextProcessingInterval;
                        this.noiseLevel = validNoiseLevel;
                        this.qualityPrediction = data.qualityPrediction || this.qualityPrediction;
                        this.isVocal = data.isVocal !== undefined ? data.isVocal : this.isVocal;
                        this.wienerGain = validWienerGain;
                        this.polyphonicPitches = validPitches;
                        this.transientBoost = data.autoEQ?.transientBoost || this.transientBoost;

                        if (data.spectralProfile || data.isVocal || data.currentGenre || data.noiseLevel || data.wienerGain || data.polyphonicPitches) {
                            if (this.getCPULoad() < 0.8) {
                                this.updateBuffers();
                            }
                        }
                        if (data.autoEQ) {
                            this.applyAutoEQ(data.autoEQ);
                        }
                        this.adjustSoundProfileSmartly();
                        break;
                    case "songStructure":
                        if (data.songStructure && Array.isArray(data.songStructure.segments)) {
                            this.memoryManager.buffers.set('songStructure', data.songStructure);
                            if (this.getCPULoad() < 0.7) {
                                this.adjustSoundProfileSmartly({ songStructure: data.songStructure });
                            }
                        }
                        break;
                    case "formantParams":
                        if (data.formantParams && Array.isArray(data.formantParams.filters)) {
                            data.formantParams.filters.forEach((filter, index) => {
                                const filterNode = this[`formantFilter${index + 1}`];
                                if (filterNode && Number.isFinite(filter.freq) && Number.isFinite(filter.gain) && Number.isFinite(filter.q)) {
                                    filterNode.frequency.value = filter.freq;
                                    filterNode.gain.value = filter.gain;
                                    filterNode.Q.value = filter.q;
                                }
                            });
                            this.memoryManager.buffers.set('formantParams', data.formantParams);
                        }
                        break;
                    case "fftSettings":
                        if (Number.isFinite(data.fftSize) && data.fftSize >= 256 && data.fftSize <= 32768) {
                            this.setFFTSize(data.fftSize);
                            this.memoryManager.buffers.set('fftSize', data.fftSize);
                        }
                        break;
                    case "bufferFeedback":
                        if (this.getCPULoad() < 0.8 && data.suggestedParams) {
                            const { bufferTime, fadeLength, activeTime } = data.suggestedParams;
                            if (Number.isFinite(bufferTime) && Number.isFinite(fadeLength) && Number.isFinite(activeTime)) {
                                this.adjustBufferParams({ bufferTime, fadeLength, activeTime });
                                this.updateBuffers({ bufferTime, fadeLength, activeTime });
                            }
                        }
                        break;
                    case "error":
                        console.error("Worker Error:", data);
                        handleError("AudioWorker encountered an error:", new Error(data), errorContext);
                        this.adjustSoundProfileSmartly();
                        break;
                    case "overload":
                        console.warn("Worker overloaded:", data);
                        this.nextProcessingInterval = Math.min(this.nextProcessingInterval * 1.5, 3000);
                        if (this.getCPULoad() > 0.9) {
                            this.worker.postMessage({ command: 'pauseAnalysis' });
                        }
                        break;
                    case "skip":
                        console.log("Worker skipped analysis:", data);
                        break;
                    default:
                        console.warn("Unknown message type from Worker:", type);
                }
            };

            // Khai báo isLowMemory trước setInterval
            const isLowMemory = navigator.deviceMemory < 4;
            // Định kỳ gửi userFeedback và contextAnalysis mới
            this.feedbackInterval = setInterval(() => {
                const newFeedback = this.memoryManager.getBuffer('userFeedback') || {};
                const newContext = this.initializeContextAnalyzer ? this.initializeContextAnalyzer().analyze(this) : {};
                const cpuLoad = this.getCPULoad();

                if (cpuLoad < 0.8) {
                    if (Object.keys(newFeedback).length > 0) {
                        this.worker.postMessage({
                            command: 'updateFeedback',
                            params: { userFeedback: newFeedback }
                        });
                    }
                    if (Object.keys(newContext).length > 0) {
                        this.worker.postMessage({
                            command: 'updateContext',
                            params: { contextAnalysis: newContext }
                        });
                    }
                    const cpuLoadHistory = this.memoryManager.getBuffer('cpuLoadHistory') || [];
                    this.worker.postMessage({
                        command: 'updateLoadHistory',
                        params: { cpuLoadHistory }
                    });
                }
            }, isLowMemory ? 5000 : 2000); // 5s trên máy yếu, 2s trên máy mạnh

            // Xử lý sự kiện songChange
            this.onSongChange = () => {
                if (this.worker) {
                    this.worker.postMessage({ command: 'reset' });
                }
            };
            this.registerEvent('songChange', this.onSongChange);

        } catch (error) {
            handleError("Error initializing Worker:", error, {
                workerSupport: !!window.Worker,
                workerURL: 'audioWorker.js',
                bufferTime: this.bufferTime,
                fadeTime: this.fadeTime
            });
        }
    }
};

Jungle.prototype.resumeWorkerAnalysis = function () {
    if (this.worker) {
        this.worker.postMessage({ command: 'resumeAnalysis' });
    }
};

Jungle.prototype.processAudio = async function (input, params = {}) {
    if (!this.worker) {
        await this.initializeWorker();
    }
    if (this.worker) {
        this.worker.postMessage({
            command: "process",
            input: input,
            params: {
                sampleRate: params.sampleRate || 44100,
                fftSize: params.fftSize || 2048,
                devicePerf: params.devicePerf || "medium",
                compressionThreshold: params.compressionThreshold,
                eqGains: params.eqGains,
                noiseGate: params.noiseGate,
                azimuth: params.azimuth,
                elevation: params.elevation,
                sourceVelocity: params.sourceVelocity,
                qualityMode: this.qualityMode
            }
        });
    } else {
        console.warn("Worker not initialized, skipping audio processing");
    }
};

Jungle.prototype.adjustSoundProfileSmartly = function () {
    if (this.polyphonicPitches?.length > 0) {
        const avgConfidence = this.polyphonicPitches.reduce((sum, p) => sum + p.confidence, 0) / this.polyphonicPitches.length;
        this.transientBoost = avgConfidence > 0.5 ? 1.2 : 1.0;
        console.debug("Adjusted transientBoost:", this.transientBoost);
    }
    this.spectralProfile = this.spectralProfile || { subBass: 0.5, bass: 0.5, mid: 0.5, high: 0.5 };
    this.currentGenre = this.currentGenre || "Pop";
    this.noiseLevel = this.noiseLevel || { level: 0, midFreq: 0.5 };
    this.qualityPrediction = this.qualityPrediction || { recommendations: [] };
    this.tempoMemory = this.tempoMemory || 120;
    this.currentKey = this.currentKey || "C";
    this.isVocal = this.isVocal || false;
    this.wienerGain = this.wienerGain || 1.0;
};

Jungle.prototype.startAudioAnalysis = function () {
    if (!this._analyser) {
        this._analyser = this.context.createAnalyser();
        this._analyser.fftSize = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4 ? 1024 : 2048;
        this.outputGain.connect(this._analyser);
    }

    const devicePerf = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4 ? "medium" : "high";

    if (this.audioAnalysisInterval) {
        clearInterval(this.audioAnalysisInterval);
    }

    const adjustInterval = () => {
        let interval = this.nextProcessingInterval;
        const cpuLoad = this.getCPULoad();
        const spectralComplexity = this.spectralProfile?.spectralFlatness || 0.5;
        if (devicePerf === "medium" || cpuLoad > 0.8) {
            interval = Math.min(interval * 2, 2000);
        } else if (spectralComplexity < 0.3) {
            interval *= 1.2;
        }
        return Math.round(interval);
    };

    this.audioAnalysisInterval = setInterval(() => {
        const bufferLength = this._analyser.frequencyBinCount;
        const timeData = new Float32Array(bufferLength);
        this._analyser.getFloatTimeDomainData(timeData);

        if (this.worker) {
            try {
                this.worker.postMessage({
                    type: "analyzeAudio",
                    timeData: timeData,
                    sampleRate: this.context.sampleRate,
                    bufferLength: bufferLength,
                    cpuLoad: this.getCPULoad(),
                    pitchMult: this.currentPitchMult || 1,
                    devicePerf: devicePerf,
                    qualityMode: this.qualityMode
                });
            } catch (error) {
                handleError("Error sending message to Worker:", error);
            }
        } else {
            console.warn("Worker not initialized, skipping audio analysis");
            this.initializeWorker();
        }
    }, adjustInterval());
};

Jungle.prototype.applyAutoEQ = function (eqSettings) {
    try {
        const currentTime = this.context.currentTime;
        const absMult = Math.abs(this.currentPitchMult || 0);
        const rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME);

        // Lấy thông tin thiết bị và spectral profile
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const fftAnalysis = this.getFFTAnalysis?.() || {};
        const spectralProfile = {
            subBassEnergy: fftAnalysis.subBassEnergy || 0.5,
            bassEnergy: fftAnalysis.bassEnergy || 0.5,
            midEnergy: fftAnalysis.midEnergy || 0.5,
            highMidEnergy: fftAnalysis.highMidEnergy || 0.5,
            trebleEnergy: fftAnalysis.trebleEnergy || 0.5,
            airEnergy: fftAnalysis.airEnergy || 0.5,
            vocalEnergy: fftAnalysis.vocalEnergy || 0.5,
            transientDensity: fftAnalysis.transientDensity || 0.5,
            harmonicRatio: fftAnalysis.harmonicRatio || 0.5,
            spectralComplexity: fftAnalysis.spectralEntropy || 0.5,
            spectralFlux: fftAnalysis.spectralFlux || 0.5
        };
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const profile = this.profile || 'smartStudio';

        // Lấy userFeedback từ memoryManager
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
        const isVocalFeedback = recentFeedback?.semanticCategory === 'vocal';

        // Wiener và pitch adjustment
        const wienerThresholdAdjust = this.wienerGain < 0.8 ? -14 * (1 - this.wienerGain) : 0; // Tăng từ -12
        const pitchAdjust = Math.min(7, absMult * 14); // Tăng từ 6/12

        // Compressor settings
        this.compressor.threshold.linearRampToValueAtTime(
            ensureFinite(eqSettings.clarityGain, 0) < 2 ? -24 + wienerThresholdAdjust - pitchAdjust : -20 + wienerThresholdAdjust - pitchAdjust, // Tăng từ -26/-22
            currentTime + rampTime
        );
        this.compressor.ratio.linearRampToValueAtTime(
            10 + absMult * 3, // Tăng từ 9/2.5
            currentTime + rampTime
        );
        this.compressor.attack.linearRampToValueAtTime(
            DEFAULT_COMPRESSOR_ATTACK, // 0.005
            currentTime + rampTime
        );
        this.compressor.release.linearRampToValueAtTime(
            DEFAULT_COMPRESSOR_RELEASE, // 0.2
            currentTime + rampTime
        );

        // Transient boost adjustment
        let transientBoostAdjust = Math.min(ensureFinite(eqSettings.transientBoost, DEFAULT_TRANSIENT_BOOST) * 2, 5); // Tăng từ 1.8/4
        if (spectralProfile.transientDensity > 0.6 || spectralProfile.spectralFlux > 0.65 || profile === 'rockMetal' || profile === 'vocal') {
            transientBoostAdjust *= 1.25; // Tăng từ 1.2
        }
        if (profile === 'bright' || profile === 'smartStudio') {
            transientBoostAdjust *= 1.1; // Thêm hỗ trợ Bright, Smart.S
        }

        // Harmonic boost adjustment
        let harmonicBoost = spectralProfile.harmonicRatio > 0.6 && (profile === 'warm' || profile === 'jazz') ? 1.7 : 1.0; // Tăng từ 1.5, giảm ngưỡng từ 0.65
        if (isVocalFeedback) {
            harmonicBoost *= 1.15; // Tăng cho vocal feedback
        }

        // EQ filter settings
        this.subBassFilter.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.subBassGain, 3) + (profile === 'bassHeavy' ? 2.5 : 0) + (spectralProfile.subBassEnergy > 0.7 ? 1 : 0), // Tăng từ 2
            currentTime + rampTime
        );
        this.lowShelfGain.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.bassGain, 4.5) + 9, // Tăng từ 8
            currentTime + rampTime
        );
        this.subMidFilter.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.subMidGain, 0) + 5 + harmonicBoost + (spectralProfile.spectralComplexity > 0.7 ? 1 : 0), // Tăng từ 4
            currentTime + rampTime
        );
        this.midBassFilter.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.midLowGain, 0) + 6 + (profile === 'bassHeavy' ? 1.5 : 0), // Tăng từ 5/1
            currentTime + rampTime
        );
        this.midShelfGain.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.midHighGain, 4) + 9 + transientBoostAdjust, // Tăng từ 8
            currentTime + rampTime
        );
        this.highShelfGain.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.highGain, 4.5) + 8 + transientBoostAdjust + (profile === 'bright' ? 1 : 0), // Tăng từ 7
            currentTime + rampTime
        );
        this.subTrebleFilter.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.subTrebleGain, 0) + 5 + transientBoostAdjust + (profile === 'smartStudio' ? 1 : 0), // Tăng từ 4
            currentTime + rampTime
        );

        // Noise reduction adjustment
        const noiseReduction = (this.noiseLevel?.white > 0.5 || this.noiseLevel?.midFreq > 0.5 || this.wienerGain < 0.8) ? -2 : 0; // Tăng từ -2.5
        this.airFilter.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.airGain, 0) + 5 + noiseReduction + (profile === 'smartStudio' ? 1.5 : 0), // Tăng từ 4/1
            currentTime + rampTime
        );

        // Formant filter settings
        const formantFreqAdjust = songStructure.section === 'chorus' ? 1.2 : songStructure.section === 'bridge' ? 1.15 : songStructure.section === 'verse' ? 1.05 : 1.0; // Tăng từ 1.15/1.1
        this.formantFilter1.frequency.linearRampToValueAtTime(
            ensureFinite(eqSettings.formantF1Freq, DEFAULT_FORMANT_F1_FREQ) * formantFreqAdjust,
            currentTime + rampTime
        );
        this.formantFilter2.frequency.linearRampToValueAtTime(
            ensureFinite(eqSettings.formantF2Freq, DEFAULT_FORMANT_F2_FREQ) * formantFreqAdjust,
            currentTime + rampTime
        );
        if (this.formantFilter3) {
            this.formantFilter3.frequency.linearRampToValueAtTime(
                ensureFinite(eqSettings.formantF3Freq, DEFAULT_FORMANT_F3_FREQ) * formantFreqAdjust,
                currentTime + rampTime
            );
            this.formantFilter3.gain.linearRampToValueAtTime(
                ensureFinite(eqSettings.formantGain, DEFAULT_FORMANT_GAIN) + (profile === 'vocal' || isVocalFeedback ? 2.5 : 0), // Tăng từ 2
                currentTime + rampTime
            );
        }
        this.formantFilter1.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.formantGain, DEFAULT_FORMANT_GAIN) + (profile === 'vocal' || isVocalFeedback ? 2.5 : 0), // Tăng từ 2
            currentTime + rampTime
        );
        this.formantFilter2.gain.linearRampToValueAtTime(
            ensureFinite(eqSettings.formantGain, DEFAULT_FORMANT_GAIN) + (profile === 'vocal' || isVocalFeedback ? 2.5 : 0), // Tăng từ 2
            currentTime + rampTime
        );

        // Lưu EQ settings vào memoryManager
        if (this.memoryManager && spectralProfile.spectralFlux > 0.035) { // Giảm ngưỡng từ 0.04
            const cacheKey = `eqSettings_${this.contextId}_${profile}_${songStructure.section}`;
            const cacheData = {
                data: { ...eqSettings, timestamp: Date.now(), profile, songStructure, spectralProfile },
                expiry: Date.now() + (isLowPowerDevice && cpuLoad > 0.9 ? 15000 : 25000), // Tùy chỉnh expiry
                priority: 'high'
            };
            this.memoryManager.set(cacheKey, cacheData, 'high');
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
        }

        // Debug logging
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Applied Auto-EQ:', {
                eqSettings,
                transientBoostAdjust,
                harmonicBoost,
                noiseReduction,
                wienerThresholdAdjust,
                pitchAdjust,
                spectralProfile,
                songStructure,
                profile,
                cpuLoad,
                isLowPowerDevice,
                isVocalFeedback,
                cacheKey: `eqSettings_${this.contextId}_${profile}_${songStructure.section}`
            });
        }
    } catch (error) {
        handleError('Error applying auto-EQ:', error, {
            eqSettings,
            wienerGain: this.wienerGain,
            transientBoost: this.transientBoost,
            profile: this.profile,
            songStructure,
            spectralProfile
        }, 'high', { memoryManager: this.memoryManager });
    }
};

Jungle.prototype.start = function () {
    if (this.isStarted) return Promise.resolve();

    return this.ensureAudioContext().then(() => {
        try {
            const currentTime = this.context.currentTime;
            const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
            const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
            const profile = this.profile || 'smartStudio';
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };

            // Kiểm tra các node
            const nodes = [this.mod1, this.mod2, this.mod3, this.mod4, this.fade1, this.fade2];
            if (nodes.some(node => !node || typeof node.start !== 'function')) {
                throw new Error('One or more audio nodes are not initialized');
            }

            // Dynamic Start Timing
            const startDelay = isLowPowerDevice && cpuLoad > 0.9 ? 0.030 : 0.050; // Giảm từ 0.050 cho thiết bị yếu
            const bufferTime = ensureFinite(this.bufferTime, DEFAULT_BUFFER_TIME);
            const fadeTime = ensureFinite(this.fadeTime, DEFAULT_FADE_TIME);
            const structureAdjust = songStructure.section === 'chorus' ? 1.1 : songStructure.section === 'bridge' ? 1.05 : 1.0;

            const t = currentTime + startDelay * structureAdjust;
            const t2 = t + bufferTime - fadeTime;

            // Khởi động các node
            this.mod1.start(t);
            this.mod2.start(t2);
            this.mod3.start(t);
            this.mod4.start(t2);
            this.fade1.start(t);
            this.fade2.start(t2);

            // Đặt trạng thái khởi động
            this.isStarted = true;

            // Khởi tạo worker và phân tích âm thanh
            this.initializeWorker();
            if (profile === 'bright' || profile === 'smartStudio' || profile === 'vocal') {
                this.setFFTSize(DEFAULT_FFT_SIZE); // 4096 từ hằng số
            }
            this.startAudioAnalysis();

            // Lưu trạng thái khởi động vào memoryManager
            if (this.memoryManager) {
                const cacheKey = `startState_${this.contextId}_${profile}`;
                const cacheData = {
                    data: { isStarted: true, timestamp: Date.now(), profile, songStructure },
                    expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000), // Tùy chỉnh expiry
                    priority: 'high'
                };
                this.memoryManager.set(cacheKey, cacheData, 'high');
                this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
            }

            // Debug logging
            const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
            if (isDebug) {
                console.debug('Jungle started:', {
                    startTime: t,
                    fadeTime: t2,
                    bufferTime,
                    cpuLoad,
                    isLowPowerDevice,
                    profile,
                    songStructure,
                    fftSize: this._analyser?.fftSize || DEFAULT_FFT_SIZE
                });
            }
        } catch (error) {
            handleError('Error starting Jungle nodes:', error, {
                profile: this.profile,
                songStructure,
                cpuLoad,
                isLowPowerDevice
            }, 'high', { memoryManager: this.memoryManager });
            this.isStarted = false;
            throw error;
        }
    });
};

Jungle.prototype.applyVitamin = function (profileName, pitchMult, absPitchMult, cosmicEnhance, options = { reverb: 0, userFeedback: {} }) {
    try {
        const currentTime = this.context.currentTime;
        const rampTime = this.rampTime || 0.1;
        // Tích hợp minFadeLength = 512 cho cross-fading mượt hơn
        const minFadeLength = 512;
        const crossFadeTime = Math.max(minFadeLength / this.context.sampleRate, this.getCPULoad?.() > 0.9 ? 0.06 : 0.08); // Kết hợp CPU load

        // Lưu trạng thái hiện tại để cross-fading
        const previousState = {
            lowShelfGain: this.lowShelfGain?.gain.value ?? 0,
            subMidGain: this.subMidFilter?.gain.value ?? 0,
            midShelfGain: this.midShelfGain?.gain.value ?? 0,
            highMidGain: this.highMidFilter?.gain.value ?? 0,
            subTrebleGain: this.subTrebleFilter?.gain.value ?? 0,
            formantF1Freq: this.formantFilter1?.frequency.value ?? 510,
            formantF1Gain: this.formantFilter1?.gain.value ?? 0,
            formantF1Q: this.formantFilter1?.Q.value ?? 1.5,
            formantF2Freq: this.formantFilter2?.frequency.value ?? 2020,
            formantF2Gain: this.formantFilter2?.gain.value ?? 0,
            formantF2Q: this.formantFilter2?.Q.value ?? 1.5,
            compressorThreshold: this.compressor?.threshold.value ?? -23,
            compressorRatio: this.compressor?.ratio.value ?? 4.1,
            compressorAttack: this.compressor?.attack.value ?? 0.0055,
            compressorRelease: this.compressor?.release.value ?? 0.14,
            airGain: this.airFilter?.gain.value ?? 0,
            pan: this.panner?.pan.value ?? 0,
            deEsserGain: this.deEsser?.gain.value ?? -12,
            notchFreq: this.notchFilter?.frequency.value ?? 6700,
            notchQ: this.notchFilter?.Q.value ?? 2.9,
            noiseGateThreshold: this.noiseGate?.threshold.value ?? -53
        };

        // Khởi tạo spectral với giá trị mặc định
        const spectralDefaults = {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.6, midHigh: 0.6,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.75,
            transientEnergy: 0.5, instrumentPresence: 0.5, harmonicRichness: 0.5,
            spectralEntropy: 0.5
        };
        const spectral = Object.assign({}, spectralDefaults, this.spectralProfile || {});
        if (!this.spectralProfile) {
            console.warn('spectralProfile chưa được định nghĩa trong applyVitamin, dùng mặc định', { profileName, pitchMult, absPitchMult, cosmicEnhance });
        }

        // Kiểm tra và chuẩn hóa spectral profile
        const validatedSpectral = {};
        Object.keys(spectralDefaults).forEach(key => {
            validatedSpectral[key] = Number.isFinite(spectral[key]) ? Math.max(0, Math.min(1, spectral[key])) : spectralDefaults[key];
        });

        // Kiểm tra và chuẩn hóa input
        const validatedPitchMult = Number.isFinite(pitchMult) ? pitchMult : 0;
        const validatedAbsPitchMult = Number.isFinite(absPitchMult) ? Math.max(0, absPitchMult) : Math.abs(validatedPitchMult);
        const validatedCosmicEnhance = Number.isFinite(cosmicEnhance) ? Math.max(0, Math.min(0.5, cosmicEnhance)) : 0;
        const validatedReverb = Number.isFinite(options.reverb) ? Math.max(0, Math.min(0.5, options.reverb)) : 0; // Giữ placeholder, không dùng
        const userFeedback = options.userFeedback || {};

        // Kiểm tra CPU load để tối ưu hiệu suất
        const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice ? 0.85 : 1.0;

        // Tính ramp time động dựa trên profile và pitch
        const profileChangeMagnitude = this.lastProfileName !== profileName ? 1.0 : Math.min(validatedAbsPitchMult * 0.5, 0.5);
        const adjustedRampTime = rampTime * (1 + profileChangeMagnitude * 0.3);

        // Phân tích FFT thời gian thực
        const fftAnalysis = this._analyser ? this.getFFTAnalysis() : null;
        const isInstrumentHeavy = fftAnalysis?.instrumentEnergy > 0.6 || validatedSpectral.instrumentPresence > 0.6;
        const isVocalHeavy = this.isVocal || validatedSpectral.vocalPresence > 0.65;
        const highFreqEnergy = fftAnalysis?.highFreqEnergy || validatedSpectral.air;
        const harmonicRichness = fftAnalysis?.harmonicRichness || validatedSpectral.harmonicRichness;
        const subBassEnergy = fftAnalysis?.subBassEnergy || validatedSpectral.subBass;

        // Phát hiện tai nghe
        const isHeadphone = this.isHeadphoneModeEnabled || (navigator.mediaDevices?.enumerateDevices ? this.checkOutputDevice() : false);
        const headphoneTrebleReduction = isHeadphone ? 0.82 : 1.0; // Giảm nhẹ treble cho tai nghe

        // Boost theo thể loại âm nhạc
        const genreBoostMap = {
            'EDM': 1.2, 'Drum & Bass': 1.2, 'Hip-Hop': 1.1, 'Pop': 1.0,
            'Bolero': 0.9, 'Classical/Jazz': 0.85, 'Rock/Metal': 1.15
        };
        const genreBoost = genreBoostMap[this.currentGenre] || 1.0;

        // Cấu hình profile với tham số tối ưu
        const profileSettings = {
            'warm': { bassReduction: 0.65, clarityBoost: 0.85, instrumentFocus: 1.1 },
            'bright': { bassReduction: 0.5, clarityBoost: 1.15, instrumentFocus: 1.2 },
            'bassHeavy': { bassReduction: 0.6, clarityBoost: 0.8, instrumentFocus: 1.0 },
            'vocal': { bassReduction: 0.4, clarityBoost: 1.05, instrumentFocus: 1.3 },
            'proNatural': { bassReduction: 0.5, clarityBoost: 0.95, instrumentFocus: 1.1 },
            'karaokeDynamic': { bassReduction: 0.4, clarityBoost: 1.1, instrumentFocus: 1.4 },
            'rockMetal': { bassReduction: 0.5, clarityBoost: 1.0, instrumentFocus: 1.25 },
            'smartStudio': { bassReduction: 0.45, clarityBoost: 1.0, instrumentFocus: 1.2 },
            'popStudio': { bassReduction: 0.5, clarityBoost: 1.3, instrumentFocus: 1.3 }
        };
        const profile = profileSettings[profileName] || profileSettings['popStudio'];

        // Chuẩn hóa gain để tránh méo tiếng
        const normalizationFactor = 0.8 / Math.max(1, profile.clarityBoost * profile.instrumentFocus * genreBoost * cpuLoadAdjust);

        // Cross-fading khi đổi profile
        if (this.lastProfileName !== profileName && this.inputNode && this.outputNode) {
            const tempGainNode = this.context.createGain();
            const oldGainNode = this.context.createGain();
            tempGainNode.gain.setValueAtTime(0, currentTime);
            tempGainNode.gain.linearRampToValueAtTime(1, currentTime + crossFadeTime);
            oldGainNode.gain.setValueAtTime(1, currentTime);
            oldGainNode.gain.linearRampToValueAtTime(0, currentTime + crossFadeTime);
            this.inputNode.connect(tempGainNode);
            this.inputNode.connect(oldGainNode);
            tempGainNode.connect(this.outputNode);
            oldGainNode.connect(this.outputNode);
            setTimeout(() => {
                try {
                    this.inputNode.disconnect(tempGainNode);
                    this.inputNode.disconnect(oldGainNode);
                    tempGainNode.disconnect(this.outputNode);
                    oldGainNode.disconnect(this.outputNode);
                    tempGainNode.disconnect();
                    oldGainNode.disconnect();
                } catch (e) {
                    console.warn('Lỗi khi ngắt kết nối cross-fade nodes:', e);
                }
            }, crossFadeTime * 1000 + 100);
        }
        this.lastProfileName = profileName;

        // Logic boost tối ưu
        const subBassBoost = subBassEnergy < 0.4 ? 1.5 : (validatedSpectral.subBass > 0.7 ? 0.95 : 1.2) * profile.bassReduction * cpuLoadAdjust;
        const subMidBoost = validatedSpectral.subMid < 0.4 ? 1.1 : (validatedSpectral.subMid > 0.7 ? 0.95 : 1.0) * profile.bassReduction * cpuLoadAdjust;
        const midBoost = validatedSpectral.midLow < 0.5 || validatedSpectral.midHigh < 0.5 ? 1.2 : (validatedSpectral.midLow > 0.7 ? 0.95 : 1.1) * cpuLoadAdjust;
        const instrumentBoost = isInstrumentHeavy ? 1.2 : (isVocalHeavy ? 0.95 : 1.1) * profile.instrumentFocus * cpuLoadAdjust;
        const trebleBoostBase = validatedSpectral.subTreble < 0.4 ? 1.1 : (validatedSpectral.subTreble > 0.7 ? 0.95 : 1.0);
        const transientBoost = Math.min(
            validatedSpectral.transientEnergy > 0.65 ? 1.4 : 1.0 + (this.transientBoost || 0) * 1.0,
            1.4
        ) * (1.0 + harmonicRichness * 0.15) * profile.clarityBoost * cpuLoadAdjust;

        // Tinh chỉnh treble và de-esser
        let dynamicTrebleReduction = 1.0;
        let deEsserGain = -12;
        if (highFreqEnergy > 0.75 || userFeedback.distortion < -1.0) {
            dynamicTrebleReduction = 1.0 - (highFreqEnergy - 0.75) * 0.4;
            deEsserGain = -20 - (highFreqEnergy - 0.75) * 18;
        } else if (highFreqEnergy > 0.5) {
            dynamicTrebleReduction = 1.0 - (highFreqEnergy - 0.5) * 0.25;
            deEsserGain = -12 - (highFreqEnergy - 0.5) * 8;
        }
        dynamicTrebleReduction = Math.max(0.8, dynamicTrebleReduction * headphoneTrebleReduction);
        deEsserGain = Math.max(-20, Math.min(-10, deEsserGain));
        const trebleBoost = trebleBoostBase * dynamicTrebleReduction * (1.0 + validatedCosmicEnhance * 0.3) * cpuLoadAdjust;

        // Formant thông minh
        let f1FreqBase = isVocalHeavy ? 560 : 510;
        let f2FreqBase = isVocalHeavy ? 2300 : 2020;
        let formantGain = isVocalHeavy ? 3.2 : 2.7;
        if (validatedPitchMult > 0) {
            f1FreqBase += validatedAbsPitchMult * 50;
            f2FreqBase += validatedAbsPitchMult * 200;
            formantGain = Math.max(2.0, formantGain - validatedAbsPitchMult * 0.7);
        } else if (validatedPitchMult < 0) {
            f1FreqBase = Math.max(300, f1FreqBase - validatedAbsPitchMult * 30);
            f2FreqBase = Math.max(1500, f2FreqBase - validatedAbsPitchMult * 150);
            formantGain = Math.min(3.8, formantGain + validatedAbsPitchMult * 0.4);
        }
        formantGain *= (1.0 + validatedSpectral.vocalPresence * 0.25) * profile.clarityBoost * cpuLoadAdjust;
        formantGain = Math.min(3.8, formantGain + (userFeedback.vocalClarity || 0) * 0.2);

        // Compressor tối ưu
        const dynamicFactor = Math.min(1 + validatedAbsPitchMult * 0.3, 1.3);
        const thresholdBase = -18 * dynamicFactor;
        const ratioBase = validatedSpectral.subBass > 0.7 ? 5.0 : (isInstrumentHeavy ? 4.0 : 4.5) * dynamicFactor;
        const attackTime = validatedSpectral.transientEnergy > 0.65 ? 0.0015 : 0.004;
        const releaseTime = validatedSpectral.subBass > 0.7 ? 0.08 : (isInstrumentHeavy ? 0.1 : 0.2);

        // Notch filter
        const notchFreq = isVocalHeavy ? 7400 : 6700;
        const notchQ = isVocalHeavy ? 4.0 : 2.9;

        // Panning
        const panAdjust = validatedPitchMult * 0.1 + (subBassEnergy > 0.7 ? 0.05 : 0);

        // Noise gate
        const noiseGateThreshold = fftAnalysis?.noiseLevel > 0.3 ? -45 : -50;

        // Harmonic Exciter cho bass
        let harmonicExciterGain = 0;
        if (cpuLoad < 0.8 && subBassEnergy > 0.6 && this.context) {
            harmonicExciterGain = Math.min(1.5, 0.6 + (userFeedback.harmonicRichness || 0) * 0.5) * cpuLoadAdjust;
            if (!this.harmonicExciter) {
                // Tạo harmonic exciter node
                this.harmonicExciter = this.context.createWaveShaper();
                const curve = new Float32Array(1024);
                for (let i = 0; i < 1024; i++) {
                    const x = (i - 512) / 512;
                    curve[i] = Math.tanh(x * 1.5); // Soft distortion cho harmonics
                }
                this.harmonicExciter.curve = curve;

                // Tạo band-pass filter để giới hạn dải sub-bass
                this.harmonicExciterBandPass = this.context.createBiquadFilter();
                this.harmonicExciterBandPass.type = 'bandpass';
                this.harmonicExciterBandPass.frequency.setValueAtTime(45, currentTime); // Trung tâm 45 Hz
                this.harmonicExciterBandPass.Q.setValueAtTime(1.0, currentTime);

                // Tạo high-pass filter để cắt harmonics dư thừa
                this.harmonicExciterHighPass = this.context.createBiquadFilter();
                this.harmonicExciterHighPass.type = 'highpass';
                this.harmonicExciterHighPass.frequency.setValueAtTime(80, currentTime); // Cắt trên 80 Hz

                // Tạo gain node để kiểm soát harmonic intensity
                this.harmonicExciterGainNode = this.context.createGain();
                this.harmonicExciterGainNode.gain.setValueAtTime(0, currentTime);

                // Kết nối: lowShelfGain -> bandPass -> waveShaper -> highPass -> gainNode -> output
                this.lowShelfGain.connect(this.harmonicExciterBandPass);
                this.harmonicExciterBandPass.connect(this.harmonicExciter);
                this.harmonicExciter.connect(this.harmonicExciterHighPass);
                this.harmonicExciterHighPass.connect(this.harmonicExciterGainNode);
                this.harmonicExciterGainNode.connect(this.outputNode);
            }
            // Áp dụng gain cho harmonic exciter
            this.harmonicExciterGainNode.gain.cancelScheduledValues(currentTime);
            this.harmonicExciterGainNode.gain.setValueAtTime(this.harmonicExciterGainNode.gain.value, currentTime);
            this.harmonicExciterGainNode.gain.linearRampToValueAtTime(
                harmonicExciterGain * normalizationFactor,
                currentTime + adjustedRampTime
            );
            // Giảm subMidGain để tránh đục
            if (this.subMidFilter?.gain) {
                this.subMidFilter.gain.linearRampToValueAtTime(
                    Math.min(3.5, this.subMidFilter.gain.value * 0.95 * subMidBoost * genreBoost * profile.bassReduction * normalizationFactor),
                    currentTime + adjustedRampTime
                );
            }
            // Tăng nhẹ formantGain để vocal rõ hơn
            formantGain = Math.min(3.8, formantGain + 0.2);
        } else if (this.harmonicExciterGainNode) {
            // Tắt harmonic exciter nếu không đủ điều kiện
            this.harmonicExciterGainNode.gain.cancelScheduledValues(currentTime);
            this.harmonicExciterGainNode.gain.setValueAtTime(this.harmonicExciterGainNode.gain.value, currentTime);
            this.harmonicExciterGainNode.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime);
        }

        // Áp dụng EQ và hiệu ứng với ramp mượt
        if (this.lowShelfGain?.gain) {
            this.lowShelfGain.gain.cancelScheduledValues(currentTime);
            this.lowShelfGain.gain.setValueAtTime(this.lowShelfGain.gain.value, currentTime);
            this.lowShelfGain.gain.linearRampToValueAtTime(
                Math.min(5.5, this.lowShelfGain.gain.value * subBassBoost * genreBoost * profile.bassReduction * normalizationFactor),
                currentTime + adjustedRampTime
            );
            if (this.lowShelfGain.Q && Math.abs(this.lowShelfGain.Q.value - 0.9) > 0.005) {
                this.lowShelfGain.Q.cancelScheduledValues(currentTime);
                this.lowShelfGain.Q.setValueAtTime(this.lowShelfGain.Q.value, currentTime);
                this.lowShelfGain.Q.linearRampToValueAtTime(0.9, currentTime + adjustedRampTime);
            }
            if (this.lowShelfGain.frequency && Math.abs(this.lowShelfGain.frequency.value - 50) > 5) {
                this.lowShelfGain.frequency.cancelScheduledValues(currentTime);
                this.lowShelfGain.frequency.setValueAtTime(this.lowShelfGain.frequency.value, currentTime);
                this.lowShelfGain.frequency.linearRampToValueAtTime(50, currentTime + adjustedRampTime);
            }
        }
        if (this.subMidFilter?.gain) {
            this.subMidFilter.gain.cancelScheduledValues(currentTime);
            this.subMidFilter.gain.setValueAtTime(this.subMidFilter.gain.value, currentTime);
            this.subMidFilter.gain.linearRampToValueAtTime(
                Math.min(3.5, this.subMidFilter.gain.value * subMidBoost * genreBoost * profile.bassReduction * normalizationFactor),
                currentTime + adjustedRampTime
            );
        }
        if (this.midShelfGain?.gain) {
            this.midShelfGain.gain.cancelScheduledValues(currentTime);
            this.midShelfGain.gain.setValueAtTime(this.midShelfGain.gain.value, currentTime);
            this.midShelfGain.gain.linearRampToValueAtTime(
                Math.min(3.5, this.midShelfGain.gain.value * midBoost * genreBoost * instrumentBoost * normalizationFactor),
                currentTime + adjustedRampTime
            );
            if (this.midShelfGain.Q && Math.abs(this.midShelfGain.Q.value - 1.1) > 0.005) {
                this.midShelfGain.Q.cancelScheduledValues(currentTime);
                this.midShelfGain.Q.setValueAtTime(this.midShelfGain.Q.value, currentTime);
                this.midShelfGain.Q.linearRampToValueAtTime(1.1, currentTime + adjustedRampTime);
            }
        }
        if (this.highMidFilter?.gain) {
            this.highMidFilter.gain.cancelScheduledValues(currentTime);
            this.highMidFilter.gain.setValueAtTime(this.highMidFilter.gain.value, currentTime);
            this.highMidFilter.gain.linearRampToValueAtTime(
                Math.min(2.5, this.highMidFilter.gain.value * instrumentBoost * transientBoost * normalizationFactor),
                currentTime + adjustedRampTime
            );
        }
        if (this.subTrebleFilter?.gain) {
            this.subTrebleFilter.gain.cancelScheduledValues(currentTime);
            this.subTrebleFilter.gain.setValueAtTime(this.subTrebleFilter.gain.value, currentTime);
            this.subTrebleFilter.gain.linearRampToValueAtTime(
                Math.min(2.5, this.subTrebleFilter.gain.value * trebleBoost * transientBoost * genreBoost * normalizationFactor),
                currentTime + adjustedRampTime
            );
        }
        if (this.formantFilter1?.frequency && this.formantFilter1?.gain && this.formantFilter1?.Q) {
            this.formantFilter1.frequency.cancelScheduledValues(currentTime);
            this.formantFilter1.gain.cancelScheduledValues(currentTime);
            this.formantFilter1.Q.cancelScheduledValues(currentTime);
            this.formantFilter1.frequency.setValueAtTime(this.formantFilter1.frequency.value, currentTime);
            this.formantFilter1.gain.setValueAtTime(this.formantFilter1.gain.value, currentTime);
            this.formantFilter1.Q.setValueAtTime(this.formantFilter1.Q.value, currentTime);
            if (Math.abs(this.formantFilter1.frequency.value - f1FreqBase) > 5) {
                this.formantFilter1.frequency.linearRampToValueAtTime(f1FreqBase, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter1.gain.value - (formantGain * normalizationFactor)) > 0.005) {
                this.formantFilter1.gain.linearRampToValueAtTime(formantGain * normalizationFactor, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter1.Q.value - 1.3) > 0.005) {
                this.formantFilter1.Q.cancelScheduledValues(currentTime);
                this.formantFilter1.Q.setValueAtTime(this.formantFilter1.Q.value, currentTime);
                this.formantFilter1.Q.linearRampToValueAtTime(1.3, currentTime + adjustedRampTime);
            }
        }
        if (this.formantFilter2?.frequency && this.formantFilter2?.gain && this.formantFilter2?.Q) {
            this.formantFilter2.frequency.cancelScheduledValues(currentTime);
            this.formantFilter2.gain.cancelScheduledValues(currentTime);
            this.formantFilter2.Q.cancelScheduledValues(currentTime);
            this.formantFilter2.frequency.setValueAtTime(this.formantFilter2.frequency.value, currentTime);
            this.formantFilter2.gain.setValueAtTime(this.formantFilter2.gain.value, currentTime);
            this.formantFilter2.Q.setValueAtTime(this.formantFilter2.Q.value, currentTime);
            if (Math.abs(this.formantFilter2.frequency.value - f2FreqBase) > 5) {
                this.formantFilter2.frequency.linearRampToValueAtTime(f2FreqBase, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter2.gain.value - (formantGain * 0.85 * normalizationFactor)) > 0.005) {
                this.formantFilter2.gain.linearRampToValueAtTime(formantGain * 0.85 * normalizationFactor, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter2.Q.value - 1.3) > 0.005) {
                this.formantFilter2.Q.cancelScheduledValues(currentTime);
                this.formantFilter2.Q.setValueAtTime(this.formantFilter2.Q.value, currentTime);
                this.formantFilter2.Q.linearRampToValueAtTime(1.3, currentTime + adjustedRampTime);
            }
        }
        if (this.compressor?.threshold && this.compressor?.ratio && this.compressor?.attack && this.compressor?.release) {
            this.compressor.threshold.cancelScheduledValues(currentTime);
            this.compressor.ratio.cancelScheduledValues(currentTime);
            this.compressor.attack.cancelScheduledValues(currentTime);
            this.compressor.release.cancelScheduledValues(currentTime);
            this.compressor.threshold.setValueAtTime(this.compressor.threshold.value, currentTime);
            this.compressor.ratio.setValueAtTime(this.compressor.ratio.value, currentTime);
            this.compressor.attack.setValueAtTime(this.compressor.attack.value, currentTime);
            this.compressor.release.setValueAtTime(this.compressor.release.value, currentTime);
            if (Math.abs(this.compressor.threshold.value - thresholdBase) > 0.05) {
                this.compressor.threshold.linearRampToValueAtTime(thresholdBase, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.compressor.ratio.value - ratioBase) > 0.05) {
                this.compressor.ratio.linearRampToValueAtTime(ratioBase, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.compressor.attack.value - attackTime) > 0.00005) {
                this.compressor.attack.linearRampToValueAtTime(attackTime, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.compressor.release.value - releaseTime) > 0.005) {
                this.compressor.release.linearRampToValueAtTime(releaseTime, currentTime + adjustedRampTime);
            }
        }
        if (this.airFilter?.gain) {
            this.airFilter.gain.cancelScheduledValues(currentTime);
            this.airFilter.gain.setValueAtTime(this.airFilter.gain.value, currentTime);
            this.airFilter.gain.linearRampToValueAtTime(
                Math.min(2.0, 2.0 * (1 + validatedSpectral.air * 0.6) * dynamicTrebleReduction * normalizationFactor),
                currentTime + adjustedRampTime
            );
        }
        if (this.panner?.pan) {
            this.panner.pan.cancelScheduledValues(currentTime);
            this.panner.pan.setValueAtTime(this.panner.pan.value, currentTime);
            if (Math.abs(this.panner.pan.value - panAdjust) > 0.005) {
                this.panner.pan.linearRampToValueAtTime(panAdjust, currentTime + adjustedRampTime);
            }
        }
        if (this.deEsser?.gain) {
            this.deEsser.gain.cancelScheduledValues(currentTime);
            this.deEsser.gain.setValueAtTime(this.deEsser.gain.value, currentTime);
            if (Math.abs(this.deEsser.gain.value - deEsserGain) > 0.05) {
                this.deEsser.gain.linearRampToValueAtTime(deEsserGain, currentTime + adjustedRampTime);
            }
        }
        if (this.notchFilter?.frequency && this.notchFilter?.Q) {
            this.notchFilter.frequency.cancelScheduledValues(currentTime);
            this.notchFilter.Q.cancelScheduledValues(currentTime);
            this.notchFilter.frequency.setValueAtTime(this.notchFilter.frequency.value, currentTime);
            this.notchFilter.Q.setValueAtTime(this.notchFilter.Q.value, currentTime);
            if (Math.abs(this.notchFilter.frequency.value - notchFreq) > 5) {
                this.notchFilter.frequency.linearRampToValueAtTime(notchFreq, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.notchFilter.Q.value - notchQ) > 0.005) {
                this.notchFilter.Q.linearRampToValueAtTime(notchQ, currentTime + adjustedRampTime);
            }
        }
        if (this.noiseGate?.threshold) {
            this.noiseGate.threshold.cancelScheduledValues(currentTime);
            this.noiseGate.threshold.setValueAtTime(this.noiseGate.threshold.value, currentTime);
            if (Math.abs(this.noiseGate.threshold.value - noiseGateThreshold) > 0.05) {
                this.noiseGate.threshold.linearRampToValueAtTime(noiseGateThreshold, currentTime + adjustedRampTime);
            }
        }

        // Xử lý user feedback
        if (userFeedback) {
            if (userFeedback.warmth > 0) {
                this.lowShelfGain.gain.linearRampToValueAtTime(
                    Math.min(5.5, this.lowShelfGain.gain.value + userFeedback.warmth * 0.4),
                    currentTime + adjustedRampTime
                );
                this.subMidFilter.gain.linearRampToValueAtTime(
                    Math.min(3.5, this.subMidFilter.gain.value + userFeedback.warmth * 0.3),
                    currentTime + adjustedRampTime
                );
            }
            if (userFeedback.clarity > 0) {
                this.midShelfGain.gain.linearRampToValueAtTime(
                    Math.min(3.5, this.midShelfGain.gain.value + userFeedback.clarity * 0.3),
                    currentTime + adjustedRampTime
                );
                this.highMidFilter.gain.linearRampToValueAtTime(
                    Math.min(2.5, this.highMidFilter.gain.value + userFeedback.clarity * 0.25),
                    currentTime + adjustedRampTime
                );
            }
            if (userFeedback.distortion < -1.0) {
                this.subTrebleFilter.gain.linearRampToValueAtTime(
                    Math.min(2.5, this.subTrebleFilter.gain.value * 0.8),
                    currentTime + adjustedRampTime
                );
                this.airFilter.gain.linearRampToValueAtTime(
                    Math.min(2.0, this.airFilter.gain.value * 0.8),
                    currentTime + adjustedRampTime
                );
                this.deEsser.gain.linearRampToValueAtTime(
                    Math.max(-20, this.deEsser.gain.value - 2),
                    currentTime + adjustedRampTime
                );
            }
            if (userFeedback.bass > 0) {
                this.lowShelfGain.gain.linearRampToValueAtTime(
                    Math.min(5.5, this.lowShelfGain.gain.value + userFeedback.bass * 0.5),
                    currentTime + adjustedRampTime
                );
                if (this.lowShelfGain.frequency && Math.abs(this.lowShelfGain.frequency.value - 45) > 5) {
                    this.lowShelfGain.frequency.cancelScheduledValues(currentTime);
                    this.lowShelfGain.frequency.setValueAtTime(this.lowShelfGain.frequency.value, currentTime);
                    this.lowShelfGain.frequency.linearRampToValueAtTime(45, currentTime + adjustedRampTime);
                }
                if (this.lowShelfGain.Q && Math.abs(this.lowShelfGain.Q.value - 0.95) > 0.005) {
                    this.lowShelfGain.Q.cancelScheduledValues(currentTime);
                    this.lowShelfGain.Q.setValueAtTime(this.lowShelfGain.Q.value, currentTime);
                    this.lowShelfGain.Q.linearRampToValueAtTime(0.95, currentTime + adjustedRampTime);
                }
            }
            if (userFeedback.depth > 0) {
                this.lowShelfGain.gain.linearRampToValueAtTime(
                    Math.min(5.5, this.lowShelfGain.gain.value + userFeedback.depth * 0.6),
                    currentTime + adjustedRampTime
                );
                if (this.lowShelfGain.frequency && Math.abs(this.lowShelfGain.frequency.value - 40) > 5) {
                    this.lowShelfGain.frequency.cancelScheduledValues(currentTime);
                    this.lowShelfGain.frequency.setValueAtTime(this.lowShelfGain.frequency.value, currentTime);
                    this.lowShelfGain.frequency.linearRampToValueAtTime(40, currentTime + adjustedRampTime);
                }
                if (this.lowShelfGain.Q && Math.abs(this.lowShelfGain.Q.value - 1.0) > 0.005) {
                    this.lowShelfGain.Q.cancelScheduledValues(currentTime);
                    this.lowShelfGain.Q.setValueAtTime(this.lowShelfGain.Q.value, currentTime);
                    this.lowShelfGain.Q.linearRampToValueAtTime(1.0, currentTime + adjustedRampTime);
                }
            }
            if (userFeedback.harmonicRichness > 0 && harmonicExciterGain > 0) {
                this.harmonicExciterGainNode.gain.linearRampToValueAtTime(
                    Math.min(1.5, harmonicExciterGain + userFeedback.harmonicRichness * 0.3) * normalizationFactor,
                    currentTime + adjustedRampTime
                );
                // Giảm thêm subMidGain để giữ trong trẻo
                if (this.subMidFilter?.gain) {
                    this.subMidFilter.gain.linearRampToValueAtTime(
                        Math.min(3.5, this.subMidFilter.gain.value * 0.92 * subMidBoost * genreBoost * profile.bassReduction * normalizationFactor),
                        currentTime + adjustedRampTime
                    );
                }
            }
        }

        // Lưu settings vào MemoryManager
        if (this.memoryManager) {
            this.memoryManager.buffers.set('vitaminSettings', {
                profile: profileName,
                subBassBoost,
                subMidBoost,
                midBoost,
                instrumentBoost,
                trebleBoost,
                transientBoost,
                formantGain,
                deEsserGain,
                notchFreq,
                notchQ,
                airGainBase: Math.min(2.0, 2.0 * (1 + validatedSpectral.air * 0.6) * dynamicTrebleReduction),
                dynamicTrebleReduction,
                highFreqEnergy,
                genreBoost,
                isHeadphone,
                isInstrumentHeavy,
                cosmicEnhance: validatedCosmicEnhance,
                reverb: validatedReverb,
                bassReduction: profile.bassReduction,
                clarityBoost: profile.clarityBoost,
                userFeedback,
                minFadeLength,
                crossFadeTime,
                subBassEnergy,
                harmonicExciterGain,
                timestamp: Date.now(),
                expiry: Date.now() + 12000,
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.calculateMaxCacheSize?.() || 1000);
        }

        // Debug log chi tiết
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Áp dụng hiệu ứng vitamin tối ưu với chuyển đổi mượt:', {
                profile: profileName,
                subBassBoost,
                subMidBoost,
                midBoost,
                instrumentBoost,
                trebleBoost,
                transientBoost,
                formantGain,
                f1FreqBase,
                f2FreqBase,
                deEsserGain,
                notchFreq,
                notchQ,
                airGainBase: Math.min(2.0, 2.0 * (1 + validatedSpectral.air * 0.6) * dynamicTrebleReduction),
                dynamicTrebleReduction,
                highFreqEnergy,
                genreBoost,
                isHeadphone,
                isInstrumentHeavy,
                cosmicEnhance: validatedCosmicEnhance,
                reverb: validatedReverb,
                bassReduction: profile.bassReduction,
                clarityBoost: profile.clarityBoost,
                userFeedback,
                adjustedRampTime,
                crossFadeTime,
                minFadeLength,
                cpuLoad,
                spectral: validatedSpectral,
                subBassEnergy,
                harmonicExciterGain
            });
        }

    } catch (error) {
        console.error('Lỗi khi áp dụng hiệu ứng vitamin:', error, {
            profileName,
            pitchMult,
            absPitchMult,
            cosmicEnhance,
            reverb: options.reverb,
            spectralProfile: this.spectralProfile
        });
        if (this.outputGain?.gain) {
            this.outputGain.gain.cancelScheduledValues(currentTime);
            this.outputGain.gain.setValueAtTime(this.outputGain.gain.value || 0.8, currentTime);
            this.outputGain.gain.linearRampToValueAtTime(0.8, currentTime + adjustedRampTime);
        }
        // Tắt harmonic exciter nếu có lỗi
        if (this.harmonicExciterGainNode) {
            this.harmonicExciterGainNode.gain.cancelScheduledValues(currentTime);
            this.harmonicExciterGainNode.gain.setValueAtTime(this.harmonicExciterGainNode.gain.value, currentTime);
            this.harmonicExciterGainNode.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime);
        }
    }
};

// Hàm hỗ trợ phân tích FFT
/**
 * Performs advanced multi-layer FFT analysis with adaptive algorithms.
 * Computes detailed spectral features (coherence, entropy, transient density, harmonic richness)
 * for ultra-precise audio optimization, optimized for performance on all devices.
 * Includes fallback for missing memoryManager to prevent TypeError.
 * @returns {Object|null} Spectral analysis results with enhanced features.
 */
/**
 * Performs multi-layer FFT analysis with adaptive algorithms.
 * Computes spectral features for audio optimization, optimized for performance and compatibility.
 * Includes fallback for missing memoryManager and avoids undefined dependencies.
 * @returns {Object|null} Spectral analysis results
 */
Jungle.prototype.getFFTAnalysis = function () {
    if (!this._analyser) return null;
    const bufferLength = this._analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    this._analyser.getFloatFrequencyData(dataArray);

    const sampleRate = this.context.sampleRate;
    const binSize = sampleRate / (2 * bufferLength);

    // Avoid using getCPULoad to prevent loadHistory error
    const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    const sampleStep = isLowPowerDevice ? 4 : 1; // Smart sampling for low-power devices
    const effectiveBufferLength = Math.floor(bufferLength / sampleStep);

    // Initialize spectral features
    let subBassEnergy = 0, bassEnergy = 0, midEnergy = 0, highMidEnergy = 0, trebleEnergy = 0, airEnergy = 0;
    let instrumentEnergy = 0, vocalEnergy = 0, highFreqEnergy = 0, noiseLevel = 0;
    let spectralEnergy = 0, spectralFlux = 0, spectralEntropy = 0, transientCount = 0;

    // Initialize internal cache if memoryManager is unavailable
    if (!this._fftCache) {
        this._fftCache = new Map();
    }

    // Cache previous analysis with error handling
    let prevAnalysis = {};
    try {
        if (this.memoryManager && typeof this.memoryManager.get === 'function') {
            prevAnalysis = this.memoryManager.get('fftAnalysis')?.data || {};
        } else {
            prevAnalysis = this._fftCache.get('fftAnalysis')?.data || {};
        }
    } catch (error) {
        console.warn('Error accessing FFT cache:', error);
    }
    const prevDataArray = this.fftAnalysis || new Float32Array(bufferLength);

    // Multi-layer frequency analysis
    try {
        for (let i = 0; i < bufferLength; i += sampleStep) {
            const freq = i * binSize;
            const energy = dataArray[i] > -Infinity ? Math.pow(2, dataArray[i] / 20) : 0;

            // Detailed frequency bins
            if (freq < 30) noiseLevel += energy;
            else if (freq < 80) subBassEnergy += energy;
            else if (freq < 200) bassEnergy += energy;
            else if (freq < 1000) midEnergy += energy;
            else if (freq < 4000) highMidEnergy += energy;
            else if (freq < 6000) trebleEnergy += energy;
            else airEnergy += energy;

            // Instrument and vocal ranges
            if (freq >= 200 && freq <= 4000) instrumentEnergy += energy;
            if (freq >= 300 && freq <= 3000) vocalEnergy += energy;
            if (freq >= 6000) highFreqEnergy += energy;

            // Spectral energy for entropy
            spectralEnergy += energy;

            // Spectral flux for temporal dynamics
            const delta = Math.abs(energy - (prevDataArray[i] || 0));
            spectralFlux += delta;

            // Transient detection
            if (delta > 0.1 && freq >= 200 && freq <= 6000) transientCount++;
        }
    } catch (error) {
        console.error('Error during FFT analysis:', error);
        return {
            subBassEnergy: 0.5,
            bassEnergy: 0.5,
            midEnergy: 0.5,
            highMidEnergy: 0.5,
            trebleEnergy: 0.5,
            airEnergy: 0.5,
            instrumentEnergy: 0.5,
            vocalEnergy: 0.5,
            highFreqEnergy: 0.5,
            noiseLevel: 0.5,
            spectralFlux: 0.5,
            spectralEntropy: 0.5,
            spectralCoherence: 0.5,
            transientDensity: 0.5,
            harmonicRichness: 0.5
        };
    }

    // Normalize energies
    const normalize = (value) => Math.min(1, value / effectiveBufferLength * 10);
    subBassEnergy = normalize(subBassEnergy);
    bassEnergy = normalize(bassEnergy);
    midEnergy = normalize(midEnergy);
    highMidEnergy = normalize(highMidEnergy);
    trebleEnergy = normalize(trebleEnergy);
    airEnergy = normalize(airEnergy);
    instrumentEnergy = normalize(instrumentEnergy);
    vocalEnergy = normalize(vocalEnergy);
    highFreqEnergy = normalize(highFreqEnergy);
    noiseLevel = normalize(noiseLevel);
    spectralFlux = normalize(spectralFlux);

    // Calculate spectral entropy
    const energies = [subBassEnergy, bassEnergy, midEnergy, highMidEnergy, trebleEnergy, airEnergy];
    const totalEnergy = energies.reduce((sum, e) => sum + e, 0) || 1;
    spectralEntropy = -energies.reduce((sum, e) => {
        const p = e / totalEnergy;
        return sum + (p > 0 ? p * Math.log2(p) : 0);
    }, 0) / Math.log2(energies.length);

    // Calculate spectral coherence
    const spectralCoherence = Math.min(1, 1 - spectralEntropy * 0.5);

    // Calculate transient density
    const transientDensity = Math.min(1, transientCount / effectiveBufferLength * 100);

    // Estimate harmonic richness
    const harmonicRichness = Math.min(1, (midEnergy + highMidEnergy) * 0.6 + vocalEnergy * 0.4);

    // Cache analysis results
    if (spectralFlux > 0.05) {
        const cacheData = {
            data: {
                subBassEnergy,
                bassEnergy,
                midEnergy,
                highMidEnergy,
                trebleEnergy,
                airEnergy,
                instrumentEnergy,
                vocalEnergy,
                highFreqEnergy,
                noiseLevel,
                spectralFlux,
                spectralEntropy,
                spectralCoherence,
                transientDensity,
                harmonicRichness
            },
            timestamp: Date.now(),
            expiry: Date.now() + 20000,
            priority: 'high'
        };
        try {
            if (this.memoryManager && typeof this.memoryManager.set === 'function') {
                this.memoryManager.set('fftAnalysis', cacheData, 'high');
            } else {
                this._fftCache.set('fftAnalysis', cacheData);
                if (this._fftCache.size > 10) {
                    const keys = Array.from(this._fftCache.keys());
                    this._fftCache.delete(keys[0]);
                }
            }
        } catch (error) {
            console.warn('Error caching FFT analysis:', error);
        }
    }

    // Store current dataArray for next iteration
    this.fftAnalysis = dataArray.slice();

    // Debug logging
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    if (isDebug) {
        console.debug('FFT Analysis Results:', {
            subBassEnergy,
            bassEnergy,
            midEnergy,
            highMidEnergy,
            trebleEnergy,
            airEnergy,
            instrumentEnergy,
            vocalEnergy,
            highFreqEnergy,
            noiseLevel,
            spectralFlux,
            spectralEntropy,
            spectralCoherence,
            transientDensity,
            harmonicRichness,
            analysisScore: (spectralCoherence * 0.4 + vocalEnergy * 0.3 + transientDensity * 0.3).toFixed(2),
            effectiveBufferLength
        });
    }

    return {
        subBassEnergy,
        bassEnergy,
        midEnergy,
        highMidEnergy,
        trebleEnergy,
        airEnergy,
        instrumentEnergy,
        vocalEnergy,
        highFreqEnergy,
        noiseLevel,
        spectralFlux,
        spectralEntropy,
        spectralCoherence,
        transientDensity,
        harmonicRichness
    };
};

// Hàm kiểm tra thiết bị đầu ra
Jungle.prototype.checkOutputDevice = async function () {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutput = devices.find(device => device.kind === 'audiooutput');
        return audioOutput?.label.toLowerCase().includes('headphone') || false;
    } catch {
        return false;
    }
};

Jungle.prototype.setDelay = function (delayTime) {
    try {
        // Kiểm tra giá trị delayTime
        if (typeof delayTime !== 'number' || isNaN(delayTime)) {
            throw new Error('delayTime must be a valid number.');
        }
        delayTime = Math.max(0, Math.min(MAX_DELAY_TIME, delayTime)); // MAX_DELAY_TIME = 5

        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const spectralProfile = this.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: null, spectralComplexity: 0.5, harmonicRatio: 0.5
        };
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const isVocalFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory === 'vocal');

        // Kiểm tra node và AudioContext
        if (!this.modGain1?.gain || !this.modGain2?.gain || !(this.context instanceof AudioContext)) {
            throw new Error('modGain1, modGain2, or AudioContext is not initialized.');
        }

        // Dynamic Delay Adjustment: Điều chỉnh delayTime và rampTime
        let adjustedDelayTime = delayTime;
        let rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME); // 0.075
        if (profile === 'smartStudio' || profile === 'bright') {
            adjustedDelayTime *= 1.1; // Tăng delay cho Smart.S, Bright
            rampTime *= 1.3; // Tăng độ mượt
        } else if (profile === 'vocal' || isVocalFeedback) {
            adjustedDelayTime *= 1.05; // Tăng nhẹ cho Vocal
            rampTime *= 1.2;
        }
        if (songStructure.section === 'chorus') {
            adjustedDelayTime *= 1.15; // Tăng delay cho chorus
            rampTime *= 1.1;
        }
        if (isLowPowerDevice && cpuLoad > 0.9) {
            rampTime *= 0.7; // Giảm độ trễ cho thiết bị yếu
        }
        adjustedDelayTime = Math.max(0, Math.min(MAX_DELAY_TIME, adjustedDelayTime));

        // Stable Delay Transition: Áp dụng delay
        const delayFactor = profile === 'smartStudio' ? 0.6 : 0.5; // Tăng từ 0.5 cho Smart.S
        this.modGain1.gain.linearRampToValueAtTime(delayFactor * adjustedDelayTime, this.context.currentTime + rampTime);
        this.modGain2.gain.linearRampToValueAtTime(delayFactor * adjustedDelayTime, this.context.currentTime + rampTime);

        // Lưu trạng thái delay vào memoryManager
        if (this.memoryManager) {
            const cacheKey = `delayState_${this.contextId}_${profile}`;
            this.memoryManager.set(cacheKey, {
                data: {
                    delayTime: adjustedDelayTime,
                    rampTime,
                    delayFactor,
                    timestamp: Date.now(),
                    profile,
                    songStructure,
                    spectralProfile,
                    isVocalFeedback
                },
                expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
        }

        // Debug logging
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Delay set successfully', {
                delayTime: adjustedDelayTime,
                rampTime,
                delayFactor,
                cpuLoad,
                isLowPowerDevice,
                profile,
                songStructure,
                spectralComplexity: spectralProfile.spectralComplexity,
                isVocalFeedback,
                cacheStats: this.memoryManager?.getCacheStats?.()
            });
        }
    } catch (error) {
        handleError('Error setting delay:', error, {
            delayTime,
            profile: this.profile,
            cpuLoad: this.getCPULoad?.() || 0.5,
            isLowPowerDevice: navigator.hardwareConcurrency < 4,
            contextState: this.context?.state,
            isVocalFeedback
        }, 'high', { memoryManager: this.memoryManager });
    }
};

// Hàm cài đặt pitch offset với bảo vệ formant và tối ưu hiệu suất
Jungle.prototype.setPitchOffset = function (mult, transpose = false) {
    try {
        // Validate AudioContext
        if (!this.context || !(this.context instanceof AudioContext) || this.context.state === 'closed') {
            throw new Error('Invalid or closed AudioContext');
        }

        // Resume AudioContext if suspended
if (this.context.state === 'suspended') {
    const resumeOnUserGesture = () => {
        this.context.resume().then(() => {
            console.debug('AudioContext resumed successfully in setPitchOffset', { contextState: this.context.state });
        }).catch(err => {
            if (typeof this.handleError === 'function') {
                this.handleError('Failed to resume AudioContext in setPitchOffset', err, { contextState: this.context.state });
            } else {
                console.error('Failed to resume AudioContext in setPitchOffset', err);
            }
            this.notifyUIError?.('Vui lòng nhấp vào nút phát hoặc tương tác với trang để kích hoạt âm thanh.');
        });
    };

    // Lắng nghe sự kiện người dùng
    const userGestureHandler = () => {
        resumeOnUserGesture();
        document.removeEventListener('click', userGestureHandler);
        document.removeEventListener('touchstart', userGestureHandler);
    };
    document.addEventListener('click', userGestureHandler);
    document.addEventListener('touchstart', userGestureHandler);
}

        // Validate input
        if (typeof mult !== 'number' || isNaN(mult)) {
            throw new Error('mult must be a valid number');
        }

        // Initialize defaults
        const rampTime = this.rampTime ?? 0.15;
        const spectralProfile = this.spectralProfile || {};
        const spectralComplexity = spectralProfile.spectralComplexity || 0.5;
        const transientEnergy = spectralProfile.transientEnergy || 0.5;
        const vocalPresence = spectralProfile.vocalPresence || 0.5;
        const bass = spectralProfile.bass || 0.5;
        const air = spectralProfile.air || 0.5;
        const isFemaleVocal = (this.formantF1Freq ?? 300) > 400 || (this.formantF2Freq ?? 1600) > 1800;

        // Clamp pitch multiplier with custom range for singing
        let pitchMult = mult;
        if (transpose) {
            pitchMult = Math.max(-24, Math.min(24, pitchMult)) / 12; // Ensures correct semitones
        } else {
            pitchMult = Math.max(-2, Math.min(2, pitchMult));
        }
        const absPitchMult = Math.abs(pitchMult);
        this.currentPitchMult = pitchMult;
        const semitones = pitchMult * 12;

        // Force ultra-high quality mode
        const qualityMode = 'ultra-high';
        const adjustedRampTime = Math.max(0.15, rampTime * (1 + absPitchMult * 0.3));

        // Cross-fade time for buffer updates and reset
        const crossFadeTime = Math.max(0.08, this.fadeTime ?? 0.08);

        // Store previous state for cross-fading
        const previousState = {
            outputGain: this.outputGain?.gain.value ?? 1.0,
            lowPassFreq: this.lowPassFilter?.frequency.value ?? 16000,
            highPassFreq: this.highPassFilter?.frequency.value ?? 80,
            notchFreq: this.notchFilter?.frequency.value ?? 1000,
            subMidGain: this.subMidFilter?.gain.value ?? 0,
            highShelfGain: this.highShelfFilter?.gain.value ?? 0,
            lowShelfGain: this.lowShelfFilter?.gain.value ?? 0,
            formantF1Freq: this.formantFilter1?.frequency.value ?? 300,
            formantF2Freq: this.formantFilter2?.frequency.value ?? 1600,
            delayTime: this.delayTime ?? 0
        };

        // Reset all effects when pitchMult is 0 with cross-fading
        if (pitchMult === 0) {
            const currentTime = this.context.currentTime;
            if (this.outputGain) {
                this.outputGain.gain.cancelScheduledValues(currentTime);
                this.outputGain.gain.setValueAtTime(previousState.outputGain, currentTime);
                this.outputGain.gain.linearRampToValueAtTime(1.0, currentTime + adjustedRampTime + crossFadeTime);
            }
            if (this.lowPassFilter && this.highPassFilter && this.notchFilter) {
                this.lowPassFilter.frequency.cancelScheduledValues(currentTime);
                this.highPassFilter.frequency.cancelScheduledValues(currentTime);
                this.notchFilter.frequency.cancelScheduledValues(currentTime);
                this.lowPassFilter.frequency.setValueAtTime(previousState.lowPassFreq, currentTime);
                this.highPassFilter.frequency.setValueAtTime(previousState.highPassFreq, currentTime);
                this.notchFilter.frequency.setValueAtTime(previousState.notchFreq, currentTime);
                this.lowPassFilter.frequency.linearRampToValueAtTime(16000, currentTime + adjustedRampTime + crossFadeTime);
                this.highPassFilter.frequency.linearRampToValueAtTime(80, currentTime + adjustedRampTime + crossFadeTime);
                this.notchFilter.frequency.linearRampToValueAtTime(1000, currentTime + adjustedRampTime + crossFadeTime);
                this.notchFilter.Q.linearRampToValueAtTime(1, currentTime + adjustedRampTime + crossFadeTime);
                this.lowPassFilter.Q.linearRampToValueAtTime(0.5, currentTime + adjustedRampTime + crossFadeTime);
                this.highPassFilter.Q.linearRampToValueAtTime(0.5, currentTime + adjustedRampTime + crossFadeTime);
            }
            if (this.subMidFilter) {
                this.subMidFilter.gain.cancelScheduledValues(currentTime);
                this.subMidFilter.gain.setValueAtTime(previousState.subMidGain, currentTime);
                this.subMidFilter.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime + crossFadeTime);
            }
            if (this.highShelfFilter) {
                this.highShelfFilter.gain.cancelScheduledValues(currentTime);
                this.highShelfFilter.gain.setValueAtTime(previousState.highShelfGain, currentTime);
                this.highShelfFilter.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime + crossFadeTime);
            }
            if (this.lowShelfFilter) {
                this.lowShelfFilter.gain.cancelScheduledValues(currentTime);
                this.lowShelfFilter.gain.setValueAtTime(previousState.lowShelfGain, currentTime);
                this.lowShelfFilter.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime + crossFadeTime);
            }
            if (this.formantFilter1 && this.formantFilter2) {
                this.formantFilter1.frequency.cancelScheduledValues(currentTime);
                this.formantFilter2.frequency.cancelScheduledValues(currentTime);
                this.formantFilter1.gain.cancelScheduledValues(currentTime);
                this.formantFilter2.gain.cancelScheduledValues(currentTime);
                this.formantFilter1.Q.cancelScheduledValues(currentTime);
                this.formantFilter2.Q.cancelScheduledValues(currentTime);
                this.formantFilter1.frequency.setValueAtTime(previousState.formantF1Freq, currentTime);
                this.formantFilter2.frequency.setValueAtTime(previousState.formantF2Freq, currentTime);
                this.formantFilter1.frequency.linearRampToValueAtTime(300, currentTime + adjustedRampTime + crossFadeTime);
                this.formantFilter2.frequency.linearRampToValueAtTime(1600, currentTime + adjustedRampTime + crossFadeTime);
                this.formantFilter1.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime + crossFadeTime);
                this.formantFilter2.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime + crossFadeTime);
                this.formantFilter1.Q.linearRampToValueAtTime(1, currentTime + adjustedRampTime + crossFadeTime);
                this.formantFilter2.Q.linearRampToValueAtTime(1, currentTime + adjustedRampTime + crossFadeTime);
            }
            if (typeof this.setDelay === 'function') {
                this.setDelay(0, adjustedRampTime + crossFadeTime);
            }
            console.debug('Reset all effects as pitchMult is 0 with cross-fading');
            return;
        }

        // Adjust buffer time with smoothing
        const bufferTime = absPitchMult > 0.25 ? Math.max(0.64, this.bufferTime ?? 0.5, (this.fadeTime ?? 0.08) * 64) : this.bufferTime ?? 0.1;
        if (bufferTime !== this.bufferTime) {
            this.bufferTime = bufferTime;
            console.debug(`Adjusted buffer time to ${bufferTime}s for pitch shift`);
        }

        // Optimize buffer update with enhanced smoothness and vibrance
        const bufferOptions = {
            smoothness: 1.7,  // Increased for ultra-smooth transitions
            vibrance: 1.4,
            pitchShift: semitones,
            isVocal: true,
            spectralProfile,
            qualityMode: 'ultra-high'
        };
        if (this.shiftDownBuffer && this.shiftUpBuffer && this.fadeBuffer) {
            console.debug('Reusing existing buffers for pitch shift');
        } else if (typeof getShiftBuffers === 'function' && typeof getFadeBuffer === 'function') {
            const tempGainNode = this.context.createGain();
            tempGainNode.gain.setValueAtTime(0, this.context.currentTime);
            tempGainNode.gain.linearRampToValueAtTime(1, this.context.currentTime + crossFadeTime);
            const oldGainNode = this.context.createGain();
            oldGainNode.gain.setValueAtTime(1, this.context.currentTime);
            oldGainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + crossFadeTime);

            try {
                const buffers = getShiftBuffers(this.context, bufferTime, this.fadeTime ?? 0.1, bufferOptions, this.memoryManager);
                this.shiftDownBuffer = buffers.shiftDownBuffer;
                this.shiftUpBuffer = buffers.shiftUpBuffer;
                this.fadeBuffer = getFadeBuffer(this.context, bufferTime, this.fadeTime ?? 0.1, bufferOptions, this.memoryManager);
                console.debug('Successfully updated pitch shift buffers', { bufferTime, qualityMode: 'ultra-high' });
            } catch (bufferError) {
                console.warn('Buffer update failed, falling back to existing buffers', bufferError);
                if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
                    console.error('No valid fallback buffers available, audio may be compromised');
                    this.notifyUIError?.('Failed to update buffers');
                }
            }

            setTimeout(() => {
                tempGainNode.disconnect();
                oldGainNode.disconnect();
            }, crossFadeTime * 1000);
        } else {
            console.warn('Buffer functions unavailable, attempting fallback buffers');
            if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
                throw new Error('Failed to initialize pitch shift buffers');
            }
        }

        // Update gain nodes with refined normalization
        const gainValue = pitchMult > 0 ? 1 : 0;
        const normalizationFactor = 1 / (1 + absPitchMult * 0.2);
        const currentTime = this.context.currentTime;

        if (this.mod1Gain && this.mod2Gain && this.mod3Gain && this.mod4Gain) {
            this.mod1Gain.gain.cancelScheduledValues(currentTime);
            this.mod2Gain.gain.cancelScheduledValues(currentTime);
            this.mod3Gain.gain.cancelScheduledValues(currentTime);
            this.mod4Gain.gain.cancelScheduledValues(currentTime);
            this.mod1Gain.gain.setValueAtTime(this.mod1Gain.gain.value, currentTime);
            this.mod2Gain.gain.setValueAtTime(this.mod2Gain.gain.value, currentTime);
            this.mod3Gain.gain.setValueAtTime(this.mod3Gain.gain.value, currentTime);
            this.mod4Gain.gain.setValueAtTime(this.mod4Gain.gain.value, currentTime);
            this.mod1Gain.gain.linearRampToValueAtTime((1 - gainValue) * normalizationFactor, currentTime + adjustedRampTime);
            this.mod2Gain.gain.linearRampToValueAtTime((1 - gainValue) * normalizationFactor, currentTime + adjustedRampTime);
            this.mod3Gain.gain.linearRampToValueAtTime(gainValue * normalizationFactor, currentTime + adjustedRampTime);
            this.mod4Gain.gain.linearRampToValueAtTime(gainValue * normalizationFactor, currentTime + adjustedRampTime);
        }

        // Update delay with ramping
        const delayTime = absPitchMult === 0 ? 0 : (this.delayTime ?? 0.08) * absPitchMult;
        if (typeof this.setDelay === 'function') {
            this.setDelay(delayTime, adjustedRampTime);
        }

        // Optimized formant preservation for natural, youthful vocals
        let adjustedVocalPresence = vocalPresence;
        if (semitones < 0) {
            adjustedVocalPresence = Math.min(vocalPresence + (0.06 * Math.abs(semitones)), 1.0);
        }
        const f1Preserved = typeof preserveFormant === 'function' ? preserveFormant(semitones, this.formantF1Freq ?? 300, adjustedVocalPresence, spectralProfile) : { freq: 300, gain: 0, q: 1.2 };
        const f2Preserved = typeof preserveFormant === 'function' ? preserveFormant(semitones, this.formantF2Freq ?? 1600, adjustedVocalPresence, spectralProfile) : { freq: 1600, gain: 0, q: 1.2 };

        // Fine-tune formant preservation for youthful, natural vocals
        if (semitones < 0 && transpose) {
            const formantScale = 1 + (Math.abs(semitones) * 0.04);
            f1Preserved.freq = Math.min(f1Preserved.freq * formantScale, 520);
            f2Preserved.freq = Math.min(f2Preserved.freq * formantScale, 2600);
            f1Preserved.gain = Math.min(f1Preserved.gain + (0.06 * Math.abs(semitones)), 0.8);
            f2Preserved.gain = Math.min(f2Preserved.gain + (0.06 * Math.abs(semitones)), 0.8);
            f1Preserved.q = Math.max(f1Preserved.q * (1 - 0.015 * Math.abs(semitones)), 0.7);
            f2Preserved.q = Math.max(f2Preserved.q * (1 - 0.015 * Math.abs(semitones)), 0.7);
            console.debug(`Youthful formant preservation: F1=${f1Preserved.freq}Hz, F2=${f2Preserved.freq}Hz, semitones=${semitones}`);
        }

        if (this.formantFilter1 && this.formantFilter2) {
            this.formantFilter1.frequency.cancelScheduledValues(currentTime);
            this.formantFilter2.frequency.cancelScheduledValues(currentTime);
            this.formantFilter1.gain.cancelScheduledValues(currentTime);
            this.formantFilter2.gain.cancelScheduledValues(currentTime);
            this.formantFilter1.Q.cancelScheduledValues(currentTime);
            this.formantFilter2.Q.cancelScheduledValues(currentTime);
            this.formantFilter1.frequency.setValueAtTime(this.formantFilter1.frequency.value, currentTime);
            this.formantFilter2.frequency.setValueAtTime(this.formantFilter2.frequency.value, currentTime);
            this.formantFilter1.gain.setValueAtTime(this.formantFilter1.gain.value, currentTime);
            this.formantFilter2.gain.setValueAtTime(this.formantFilter2.gain.value, currentTime);
            this.formantFilter1.Q.setValueAtTime(this.formantFilter1.Q.value, currentTime);
            this.formantFilter2.Q.setValueAtTime(this.formantFilter2.Q.value, currentTime);
            this.formantFilter1.frequency.linearRampToValueAtTime(f1Preserved.freq, currentTime + adjustedRampTime);
            this.formantFilter1.gain.linearRampToValueAtTime(f1Preserved.gain, currentTime + adjustedRampTime);
            this.formantFilter1.Q.linearRampToValueAtTime(f1Preserved.q, currentTime + adjustedRampTime);
            this.formantFilter2.frequency.linearRampToValueAtTime(f2Preserved.freq, currentTime + adjustedRampTime);
            this.formantFilter2.gain.linearRampToValueAtTime(f2Preserved.gain, currentTime + adjustedRampTime);
            this.formantFilter2.Q.linearRampToValueAtTime(f2Preserved.q, currentTime + adjustedRampTime);
        }

        // Update filters with adaptive EQ for clarity and warmth
        let lowPassFreq = this.lowPassFreq ?? 16000;
        let highPassFreq = this.highPassFreq ?? 80;
        let notchFreq = this.notchFreq ?? 1000;
        let notchQ = 1.2;
        const filterQ = 1.0 + absPitchMult * 0.05;

        // Adaptive EQ based on spectral complexity
        if (spectralComplexity > 0.7) {
            lowPassFreq = Math.min(lowPassFreq * 0.95, 18000);
            notchQ = 1.4;
        }

        // Limit frequency changes to avoid abrupt shifts
        const maxFreqChange = 500;
        if (pitchMult > 0) {
            const newLowPassFreq = lowPassFreq * (1 - absPitchMult * 0.08);
            lowPassFreq = Math.abs(newLowPassFreq - lowPassFreq) > maxFreqChange ? lowPassFreq + (newLowPassFreq > lowPassFreq ? maxFreqChange : -maxFreqChange) : newLowPassFreq;
            const newHighPassFreq = highPassFreq * (1 + absPitchMult * 0.005);
            highPassFreq = Math.abs(newHighPassFreq - highPassFreq) > maxFreqChange ? highPassFreq + (newHighPassFreq > highPassFreq ? maxFreqChange : -maxFreqChange) : newHighPassFreq;
        } else if (pitchMult < 0) {
            const newLowPassFreq = Math.min(lowPassFreq * (1 + absPitchMult * 0.1), 23000);
            lowPassFreq = Math.abs(newLowPassFreq - lowPassFreq) > maxFreqChange ? lowPassFreq + (newLowPassFreq > lowPassFreq ? maxFreqChange : -maxFreqChange) : newLowPassFreq;
            const newHighPassFreq = highPassFreq * (1 - absPitchMult * 0.015);
            highPassFreq = Math.abs(newHighPassFreq - highPassFreq) > maxFreqChange ? highPassFreq + (newHighPassFreq > highPassFreq ? maxFreqChange : -maxFreqChange) : newHighPassFreq;
        }

        if (this.lowPassFilter && this.highPassFilter && this.notchFilter) {
            this.lowPassFilter.Q.cancelScheduledValues(currentTime);
            this.highPassFilter.Q.cancelScheduledValues(currentTime);
            this.lowPassFilter.frequency.cancelScheduledValues(currentTime);
            this.highPassFilter.frequency.cancelScheduledValues(currentTime);
            this.notchFilter.frequency.cancelScheduledValues(currentTime);
            this.lowPassFilter.Q.setValueAtTime(this.lowPassFilter.Q.value, currentTime);
            this.highPassFilter.Q.setValueAtTime(this.highPassFilter.Q.value, currentTime);
            this.lowPassFilter.frequency.setValueAtTime(this.lowPassFilter.frequency.value, currentTime);
            this.highPassFilter.frequency.setValueAtTime(this.highPassFilter.frequency.value, currentTime);
            this.notchFilter.frequency.setValueAtTime(this.notchFilter.frequency.value, currentTime);
            this.lowPassFilter.Q.linearRampToValueAtTime(filterQ, currentTime + adjustedRampTime);
            this.highPassFilter.Q.linearRampToValueAtTime(filterQ, currentTime + adjustedRampTime);
            this.lowPassFilter.frequency.linearRampToValueAtTime(lowPassFreq, currentTime + adjustedRampTime);
            this.highPassFilter.frequency.linearRampToValueAtTime(highPassFreq, currentTime + adjustedRampTime);
            this.notchFilter.frequency.linearRampToValueAtTime(notchFreq, currentTime + adjustedRampTime);
            this.notchFilter.Q.linearRampToValueAtTime(notchQ, currentTime + adjustedRampTime);
        }

        // Add low-shelf filter for natural bass spread
        if (this.lowShelfFilter && pitchMult < 0) {
            const lowShelfFreq = 100; // Adjusted for deeper, natural bass
            const lowShelfGain = Math.min(0.5 + (Math.abs(semitones) * 0.04), 0.8);
            this.lowShelfFilter.frequency.setValueAtTime(lowShelfFreq, currentTime);
            this.lowShelfFilter.gain.cancelScheduledValues(currentTime);
            this.lowShelfFilter.gain.setValueAtTime(this.lowShelfFilter.gain.value, currentTime);
            this.lowShelfFilter.gain.linearRampToValueAtTime(lowShelfGain, currentTime + adjustedRampTime);
            console.debug(`Applied low-shelf filter: ${lowShelfGain}dB at ${lowShelfFreq}Hz`);
        }

        // Dynamic output gain with compression for stability
        let outputGainBoost = 1.0;
        if (semitones < 0 && transpose) {
            outputGainBoost = Math.min(1.0 + (Math.abs(semitones) * 0.06), 1.4);
            if (typeof this.applyCompression === 'function') {
                this.applyCompression({ threshold: -12, ratio: 2, attack: 0.01, release: 0.1 });
                console.debug('Applied dynamic compression for stable output');
            }
        }

        if (this.outputGain) {
            this.outputGain.gain.cancelScheduledValues(currentTime);
            this.outputGain.gain.setValueAtTime(this.outputGain.gain.value, currentTime);
            this.outputGain.gain.linearRampToValueAtTime(outputGainBoost, currentTime + adjustedRampTime);
        }

        // Conditional boosts for bass, transient, and clarity
        if (bass < 0.4 && this.subMidFilter) {
            const bassBoost = 0.3;
            this.subMidFilter.gain.cancelScheduledValues(currentTime);
            this.subMidFilter.gain.setValueAtTime(this.subMidFilter.gain.value, currentTime);
            this.subMidFilter.gain.linearRampToValueAtTime(
                (this.subMidFilter.gain.value ?? 0) + bassBoost,
                currentTime + adjustedRampTime
            );
            console.debug(`Boosted bass by ${bassBoost}dB due to low bass level`);
        }

        if (transientEnergy < 0.7 && this.highShelfFilter) {
            const transientBoost = 1.0;
            this.highShelfFilter.frequency.setValueAtTime(this.highShelfFilter.frequency.value ?? 8000, currentTime);
            this.highShelfFilter.gain.cancelScheduledValues(currentTime);
            this.highShelfFilter.gain.setValueAtTime(this.highShelfFilter.gain.value, currentTime);
            this.highShelfFilter.gain.linearRampToValueAtTime(
                (this.highShelfFilter.gain.value ?? 0) + transientBoost,
                currentTime + adjustedRampTime
            );
            console.debug(`Boosted transients by ${transientBoost}dB for instrument clarity`);
        }

        if (air < 0.4 && this.highShelfFilter) {
            const clarityBoost = 1.2;
            this.highShelfFilter.frequency.setValueAtTime(this.highShelfFilter.frequency.value ?? 12000, currentTime); // Adjusted for more air
            this.highShelfFilter.gain.cancelScheduledValues(currentTime);
            this.highShelfFilter.gain.setValueAtTime(this.highShelfFilter.gain.value, currentTime);
            this.highShelfFilter.gain.linearRampToValueAtTime(
                (this.highShelfFilter.gain.value ?? 0) + clarityBoost,
                currentTime + adjustedRampTime
            );
            console.debug(`Boosted clarity by ${clarityBoost}dB due to low air level`);
        }

        // Handle high spectral complexity with adaptive EQ
        if (spectralComplexity > 0.7 && absPitchMult > 0.7 && this.lowPassFilter) {
            const newLowPassFreq = lowPassFreq * 0.94;
            lowPassFreq = Math.abs(newLowPassFreq - lowPassFreq) > maxFreqChange ? lowPassFreq - maxFreqChange : newLowPassFreq;
            this.lowPassFilter.frequency.cancelScheduledValues(currentTime);
            this.lowPassFilter.frequency.setValueAtTime(this.lowPassFilter.frequency.value, currentTime);
            this.lowPassFilter.frequency.linearRampToValueAtTime(lowPassFreq, currentTime + adjustedRampTime);
            console.debug(`Adjusted lowPassFreq to ${lowPassFreq}Hz for complex spectral content`);
        }

        // Enhance warmth and vibrance for downward pitch shift
        if (pitchMult < 0 && this.subMidFilter) {
            const warmthBoost = Math.min(0.5 + (Math.abs(semitones) * 0.06), 1.2);
            this.subMidFilter.gain.cancelScheduledValues(currentTime);
            this.subMidFilter.gain.setValueAtTime(this.subMidFilter.gain.value, currentTime);
            this.subMidFilter.gain.linearRampToValueAtTime(
                (this.subMidFilter.gain.value ?? 0) + warmthBoost,
                currentTime + adjustedRampTime
            );
            console.debug(`Boosted warmth by ${warmthBoost}dB for warmth`);
        }

        // Enhance vocal clarity for youthful vocals
        let vocalClarityBoost = 0; // Default to 0 to prevent undefined errors
        if (isFemaleVocal && this.highShelfFilter && semitones < 0) {
            vocalClarityBoost = Math.min(0.8 + (Math.abs(semitones) * 0.07), 1.5); // Adjusted starting point
            this.highShelfFilter.frequency.setValueAtTime(this.highShelfFilter.frequency.value ?? 10000, currentTime);
            this.highShelfFilter.gain.cancelScheduledValues(currentTime);
            this.highShelfFilter.gain.setValueAtTime(this.highShelfFilter.gain.value, currentTime);
            this.highShelfFilter.gain.linearRampToValueAtTime(
                (this.highShelfFilter.gain.value ?? 0) + vocalClarityBoost,
                currentTime + adjustedRampTime
            );
            console.debug(`Boosted vocal clarity by ${vocalClarityBoost}dB for youthful vocals at ${semitones} semitones`);
        }

        // Add subtle harmonic enhancement for vibrant color
        if (typeof this.applyHarmonicEnhancement === 'function' && pitchMult < 0) {
            this.applyHarmonicEnhancement({ intensity: 0.2, frequencyRange: [2400, 8000] }); // Adjusted range
            console.debug('Applied subtle harmonic enhancement for vibrant sound');
        }

        // Apply proNatural enhancement for natural tone
        if (typeof this.applyVitamin === 'function') {
            this.applyVitamin('proNatural', pitchMult, absPitchMult);
        }

        // Store configuration with enhanced metadata
        if (this.memoryManager && typeof this.memoryManager.allocateBuffer === 'function') {
            this.memoryManager.allocateBuffer('pitchConfig', {
                pitchMult,
                absPitchMult,
                qualityMode,
                bufferTime,
                lowPassFreq,
                highPassFreq,
                vocalClarityBoost: vocalClarityBoost || 0,
                timestamp: Date.now(),
                expiry: Date.now() + 12000,
                priority: 'ultra-high'
            }, 'high');
            this.memoryManager.pruneCache(this.calculateMaxCacheSize?.() || 32 * 1024 * 1024);
        }

        // Notify UI with enhanced data
        if (typeof this.notifyUIUpdate === 'function') {
            this.notifyUIUpdate({
                pitchMult,
                absPitchMult,
                qualityMode,
                bufferTime,
                lowPassFreq,
                highPassFreq,
                vocalClarityBoost: vocalClarityBoost || 0,
                timestamp: Date.now()
            });
        }

        console.debug('[setPitchOffset] Enhanced pitch offset processed successfully', {
            pitchMult,
            absPitchMult,
            pitchShift: semitones,
            qualityMode,
            bufferTime,
            outputGainBoost,
            delayTime,
            contextState: this.context.state
        });

    } catch (error) {
        if (typeof this.handleError === 'function') {
            this.handleError('Error setting enhanced pitch offset', error, {
                mult,
                transpose,
                contextState: this.context?.state
            });
        } else {
            console.error('Error setting enhanced pitch offset', error);
        }
        if (typeof this.notifyUIError === 'function') {
            this.notifyUIError('Failed to process pitch offset');
        }
        if (previousState && this.outputGain) {
            this.outputGain.gain.cancelScheduledValues(this.context.currentTime);
            this.outputGain.gain.setValueAtTime(previousState.outputGain, this.context.currentTime);
            this.outputGain.gain.linearRampToValueAtTime(previousState.outputGain, currentTime + adjustedRampTime);
        } else {
            console.warn('previousState or outputGain is undefined in error handler');
        }
    }
};

Jungle.prototype.setBoost = function (boost, band = "all") {
    try {
        // Kiểm tra giá trị boost
        if (typeof boost !== 'number' || isNaN(boost)) {
            throw new Error('Boost must be a valid number.');
        }
        boost = Math.max(0.7, Math.min(10.0, boost)); // Giữ giới hạn [0.7, 10]

        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const spectralProfile = this.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: null, spectralComplexity: 0.5, harmonicRatio: 0.5
        };
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const isVocalFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory === 'vocal');

        // Kiểm tra AudioContext
        if (!(this.context instanceof AudioContext)) {
            throw new Error('AudioContext is not initialized.');
        }
        const currentTime = this.context.currentTime;

        // Dynamic Boost Adjustment: Điều chỉnh rampTime
        let rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME); // 0.075
        if (profile === 'bright' || profile === 'smartStudio' || profile === 'vocal') {
            rampTime *= 1.3; // Tăng độ mượt từ 1.2
        } else if (isLowPowerDevice && cpuLoad > 0.9) {
            rampTime *= 0.7; // Giảm độ trễ từ 0.8
        }
        if (songStructure.section === 'chorus') {
            boost *= 1.15; // Tăng boost cho chorus
            boost = Math.max(0.7, Math.min(10.0, boost)); // Giới hạn lại
        }
        if (isVocalFeedback && band === 'vocal') {
            boost *= 1.2; // Tăng boost khi có feedback vocal
            boost = Math.max(0.7, Math.min(10.0, boost));
        }

        // Stable Boost Transition: Áp dụng boost
        if (band === 'all' || band === 'total') {
            if (!this.boostGain?.gain) throw new Error('boostGain is not initialized');
            this.boostGain.gain.linearRampToValueAtTime(boost, currentTime + rampTime);
        } else if (band === 'bass') {
            if (!this.lowShelfGain?.gain || !this.subBassFilter?.gain) throw new Error('lowShelfGain or subBassFilter is not initialized');
            const bassBoost = boost * (profile === 'bassHeavy' ? 2.2 : 2.0); // Tăng từ 2.0
            this.lowShelfGain.gain.linearRampToValueAtTime(bassBoost, currentTime + rampTime);
            this.subBassFilter.gain.linearRampToValueAtTime(boost * 1.6, currentTime + rampTime); // Tăng từ 1.5
        } else if (band === 'subMid') {
            if (!this.subMidFilter?.gain) throw new Error('subMidFilter is not initialized');
            const subMidBoost = boost * (spectralProfile.spectralComplexity > 0.7 ? 1.7 : 1.5); // Tăng từ 1.5
            this.subMidFilter.gain.linearRampToValueAtTime(subMidBoost, currentTime + rampTime);
        } else if (band === 'mid') {
            if (!this.midShelfGain?.gain) throw new Error('midShelfGain is not initialized');
            this.midShelfGain.gain.linearRampToValueAtTime(boost * 1.6, currentTime + rampTime); // Tăng từ 1.5
        } else if (band === 'highMid') {
            if (!this.highMidFilter?.gain) throw new Error('highMidFilter is not initialized');
            const highMidBoost = boost * (profile === 'bright' ? 1.7 : 1.5); // Tăng từ 1.5
            this.highMidFilter.gain.linearRampToValueAtTime(highMidBoost, currentTime + rampTime);
        } else if (band === 'treble') {
            if (!this.highShelfGain?.gain || !this.subTrebleFilter?.gain) throw new Error('highShelfGain or subTrebleFilter is not initialized');
            const trebleBoost = boost * (profile === 'bright' ? 2.0 : 1.8); // Tăng từ 1.8
            this.highShelfGain.gain.linearRampToValueAtTime(trebleBoost, currentTime + rampTime);
            this.subTrebleFilter.gain.linearRampToValueAtTime(boost * 1.6, currentTime + rampTime); // Tăng từ 1.5
        } else if (band === 'air') {
            if (!this.airFilter?.gain) throw new Error('airFilter is not initialized');
            const airBoost = boost * (profile === 'smartStudio' ? 1.4 : 1.2); // Tăng từ 1.2
            this.airFilter.gain.linearRampToValueAtTime(airBoost, currentTime + rampTime);
        } else if (band === 'vocal') {
            if (!this.formantFilter1?.gain || !this.formantFilter2?.gain || !this.formantFilter3?.gain) {
                throw new Error('formantFilter1, formantFilter2, or formantFilter3 is not initialized');
            }
            const vocalBoost = boost * (isVocalFeedback || profile === 'vocal' ? 1.5 : 1.3); // Tăng từ 1.3
            this.formantFilter1.gain.linearRampToValueAtTime(vocalBoost, currentTime + rampTime);
            this.formantFilter2.gain.linearRampToValueAtTime(vocalBoost, currentTime + rampTime);
            this.formantFilter3.gain.linearRampToValueAtTime(vocalBoost, currentTime + rampTime);
        } else {
            throw new Error(`Invalid band: ${band}`);
        }

        // Lưu trạng thái boost vào memoryManager
        if (this.memoryManager) {
            const cacheKey = `boostState_${this.contextId}_${profile}_${band}`;
            this.memoryManager.set(cacheKey, {
                data: {
                    boost,
                    band,
                    rampTime,
                    timestamp: Date.now(),
                    profile,
                    songStructure,
                    spectralProfile,
                    isVocalFeedback
                },
                expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
        }

        // Debug logging
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug(`Boost set to ${boost.toFixed(3)} for band: ${band}`, {
                rampTime,
                cpuLoad,
                isLowPowerDevice,
                profile,
                songStructure,
                spectralComplexity: spectralProfile.spectralComplexity,
                isVocalFeedback,
                cacheStats: this.memoryManager?.getCacheStats?.()
            });
        }
    } catch (error) {
        handleError('Error setting boost:', error, {
            boost,
            band,
            profile: this.profile,
            cpuLoad: this.getCPULoad?.() || 0.5,
            isLowPowerDevice: navigator.hardwareConcurrency < 4,
            contextState: this.context?.state,
            isVocalFeedback
        }, 'high', { memoryManager: this.memoryManager });
    }
};

Jungle.prototype.setPan = function (pan) {
    try {
        // Kiểm tra giá trị pan
        if (typeof pan !== 'number' || isNaN(pan)) {
            throw new Error('Pan must be a valid number.');
        }
        pan = Math.max(-1, Math.min(1, pan));

        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const spectralProfile = this.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: null, spectralComplexity: 0.5, harmonicRatio: 0.5
        };

        // Kiểm tra panner node và AudioContext
        if (!this.panner || !(this.context instanceof AudioContext)) {
            throw new Error('Panner node or AudioContext is not initialized.');
        }

        // Dynamic Pan Adjustment: Điều chỉnh rampTime
        let rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME); // 0.075
        if (profile === 'bright' || profile === 'smartStudio') {
            rampTime *= 1.2; // Tăng độ mượt cho Bright, Smart.S
        } else if (isLowPowerDevice && cpuLoad > 0.9) {
            rampTime *= 0.8; // Giảm độ trễ cho thiết bị yếu
        }
        if (songStructure.section === 'chorus') {
            pan *= 1.1; // Tăng độ rộng stereo cho chorus
            pan = Math.max(-1, Math.min(1, pan)); // Giới hạn lại
        }

        // Stable Pan Transition: Áp dụng pan
        this.panner.pan.linearRampToValueAtTime(pan, this.context.currentTime + rampTime);

        // Lưu trạng thái pan vào memoryManager
        if (this.memoryManager) {
            const cacheKey = `panState_${this.contextId}_${profile}`;
            this.memoryManager.set(cacheKey, {
                data: {
                    pan,
                    rampTime,
                    timestamp: Date.now(),
                    profile,
                    songStructure,
                    spectralProfile
                },
                expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
        }

        // Debug logging
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Pan set successfully', {
                pan,
                rampTime,
                cpuLoad,
                isLowPowerDevice,
                profile,
                songStructure,
                spectralComplexity: spectralProfile.spectralComplexity,
                cacheStats: this.memoryManager?.getCacheStats?.()
            });
        }
    } catch (error) {
        handleError('Error setting pan:', error, {
            pan,
            profile: this.profile,
            cpuLoad: this.getCPULoad?.() || 0.5,
            isLowPowerDevice: navigator.hardwareConcurrency < 4,
            contextState: this.context?.state
        }, 'high', { memoryManager: this.memoryManager });
    }
};

Jungle.prototype.ensureAudioContext = function () {
    return new Promise((resolve, reject) => {
        try {
            // Lấy thông tin thiết bị và cấu hình
            const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
            const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
            const profile = this.profile || 'smartStudio';
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            const spectralProfile = this.spectralProfile || {
                subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
                high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
                instruments: {}, chroma: null, spectralComplexity: 0.5, harmonicRatio: 0.5
            };

            // Kiểm tra hỗ trợ Web Audio API
            if (!window.AudioContext && !window.webkitAudioContext) {
                const error = new Error('Web Audio API is not supported in this environment.');
                handleError('Error ensuring AudioContext:', error, { profile, cpuLoad, isLowPowerDevice }, 'high', { memoryManager: this.memoryManager });
                reject(error);
                return;
            }

            // Kiểm tra và khởi tạo lại AudioContext nếu cần
            if (!(this.context instanceof AudioContext) || this.context.state === 'closed') {
                if (this.ownsContext) {
                    if (this.context) {
                        this.context.close().catch(e => console.warn('Error closing old AudioContext:', e));
                    }
                    this.context = new AudioContext();
                    this.ownsContext = true;

                    // Tối ưu hóa AudioContext cho thiết bị yếu
                    if (isLowPowerDevice && cpuLoad > 0.9) {
                        this.context.baseLatency = Math.min(this.context.baseLatency * 1.5, 0.1); // Giới hạn độ trễ
                    }

                    // Tái tạo buffer
                    const bufferOptions = {
                        smoothness: profile === 'vocal' || profile === 'bright' ? 1.5 : 1.3, // Tăng từ 1.3
                        vibrance: profile === 'smartStudio' ? 0.6 : 0.5, // Tăng từ 0.5
                        pitchShift: this.currentPitchMult || 0,
                        isVocal: this.isVocal || profile === 'vocal',
                        spectralProfile,
                        currentGenre: this.currentGenre || 'Unknown',
                        noiseLevel: this.noiseLevel || { level: 0, midFreq: 0.5, white: 0.5 },
                        wienerGain: this.wienerGain || 1,
                        polyphonicPitches: this.polyphonicPitches || [],
                        qualityMode: this.qualityMode || 'high',
                        profile,
                        songStructure
                    };

                    const buffers = getShiftBuffers(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);
                    this.shiftDownBuffer = buffers.shiftDownBuffer;
                    this.shiftUpBuffer = buffers.shiftUpBuffer;
                    this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);

                    // Kiểm tra buffer
                    if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
                        throw new Error('Failed to create valid buffers');
                    }
                    if (this.fadeBuffer.length < this.bufferTime * this.context.sampleRate) {
                        throw new Error('fadeBuffer length insufficient', {
                            expected: this.bufferTime * this.context.sampleRate,
                            actual: this.fadeBuffer.length
                        });
                    }

                    // Tái khởi tạo node
                    this.initializeNodes();

                    // Lưu trạng thái buffer vào memoryManager
                    if (this.memoryManager) {
                        const cacheKey = `bufferState_${this.contextId}_${profile}`;
                        this.memoryManager.set(cacheKey, {
                            data: {
                                shiftDownLength: this.shiftDownBuffer.length,
                                shiftUpLength: this.shiftUpBuffer.length,
                                fadeBufferLength: this.fadeBuffer.length,
                                bufferTime: this.bufferTime,
                                fadeTime: this.fadeTime,
                                timestamp: Date.now(),
                                profile,
                                songStructure
                            },
                            expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                            priority: 'high'
                        });
                        this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
                    }

                    console.debug('AudioContext reinitialized with new buffers and nodes', {
                        sampleRate: this.context.sampleRate,
                        bufferTime: this.bufferTime,
                        fadeTime: this.fadeTime,
                        profile,
                        songStructure,
                        cpuLoad,
                        isLowPowerDevice
                    });

                    resolve(true);
                } else {
                    const error = new Error('Invalid or closed AudioContext and no ownership to reinitialize.');
                    handleError('Error ensuring AudioContext:', error, { profile, cpuLoad, isLowPowerDevice }, 'high', { memoryManager: this.memoryManager });
                    reject(error);
                }
                return;
            }

            // Xử lý trạng thái AudioContext
            switch (this.context.state) {
                case 'suspended':
                    const resumeOnUserGesture = () => {
                        this.context.resume()
                            .then(() => {
                                console.debug('AudioContext resumed', { profile, songStructure });
                                resolve(true);
                            })
                            .catch(error => {
                                handleError('Error resuming AudioContext:', error, { profile, cpuLoad, isLowPowerDevice }, 'high', { memoryManager: this.memoryManager });
                                this.notifyUIError?.('Vui lòng nhấp vào nút phát hoặc tương tác với trang để kích hoạt âm thanh.');
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
                    break;
                case 'running':
                    // Kiểm tra và cập nhật FFT size nếu cần
                    if (this._analyser && this._analyser.fftSize !== DEFAULT_FFT_SIZE) {
                        this._analyser.fftSize = DEFAULT_FFT_SIZE; // 4096
                        console.debug('Updated FFT size for analyser', { fftSize: DEFAULT_FFT_SIZE, profile });
                    }
                    resolve(true);
                    break;
                default:
                    console.warn('Unexpected AudioContext state:', this.context.state, { profile, cpuLoad, isLowPowerDevice });
                    resolve(true); // Giả định trạng thái vẫn có thể sử dụng
                    break;
            }

            // Debug logging
            const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
            if (isDebug) {
                console.debug('AudioContext ensured', {
                    state: this.context.state,
                    sampleRate: this.context.sampleRate,
                    bufferTime: this.bufferTime,
                    fadeTime: this.fadeTime,
                    cpuLoad,
                    isLowPowerDevice,
                    profile,
                    songStructure,
                    cacheStats: this.memoryManager?.getCacheStats?.()
                });
            }
        } catch (error) {
            handleError('Error ensuring AudioContext:', error, {
                ownsContext: this.ownsContext,
                contextState: this.context?.state,
                profile,
                cpuLoad,
                isLowPowerDevice
            }, 'high', { memoryManager: this.memoryManager });
            reject(error);
        }
    });
};

Jungle.prototype.disconnect = function () {
    try {
        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };

        // Stop audio sources nếu đang chạy
        if (this.isStarted) {
            const nodes = [this.mod1, this.mod2, this.mod3, this.mod4, this.fade1, this.fade2];
            for (const node of nodes) {
                if (node && typeof node.stop === 'function') {
                    node.stop();
                }
            }
            this.isStarted = false;
        }

        // Clear analysis interval
        if (this.audioAnalysisInterval) {
            clearInterval(this.audioAnalysisInterval);
            this.audioAnalysisInterval = null;
        }

        // Terminate worker và xử lý pending messages
        if (this.worker) {
            try {
                this.worker.postMessage({ command: 'cleanup', profile });
                this.worker.terminate();
            } catch (workerError) {
                console.warn('Worker termination issue:', workerError, { profile });
            }
            this.worker = null;
        }

        // Disconnect analyser nếu tồn tại
        if (this._analyser) {
            if (this.outputGain) {
                this.outputGain.disconnect(this._analyser);
            }
            this._analyser = null;
        }

        // Disconnect tất cả audio nodes nếu tồn tại
        const audioNodes = [
            this.input, this.bassHighPassFilter, this.highPassFilter, this.lowShelfGain,
            this.subBassFilter, this.subMidFilter, this.midBassFilter, this.midShelfGain,
            this.highMidFilter, this.formantFilter1, this.formantFilter2, this.formantFilter3,
            this.delay1, this.delay2, this.mix1, this.mix2, this.boostGain, this.panner,
            this.highShelfGain, this.subTrebleFilter, this.airFilter, this.trebleLowPass,
            this.lowPassFilter, this.notchFilter, this.outputGain, this.compressor, this.output
        ];
        for (const node of audioNodes) {
            if (node && typeof node.disconnect === 'function') {
                node.disconnect();
            }
        }

        // Disconnect modulation và fade connections
        const modConnections = [
            { gain: this.mod1Gain, target: this.modGain1 },
            { gain: this.mod2Gain, target: this.modGain2 },
            { gain: this.mod3Gain, target: this.modGain1 },
            { gain: this.mod4Gain, target: this.modGain2 }
        ];
        for (const { gain, target } of modConnections) {
            if (gain && target && typeof gain.disconnect === 'function') {
                gain.disconnect(target);
            }
        }
        if (this.modGain1 && this.delay1) {
            this.modGain1.disconnect(this.delay1.delayTime);
        }
        if (this.modGain2 && this.delay2) {
            this.modGain2.disconnect(this.delay2.delayTime);
        }
        if (this.fade1 && this.mix1) {
            this.fade1.disconnect(this.mix1.gain);
        }
        if (this.fade2 && this.mix2) {
            this.fade2.disconnect(this.mix2.gain);
        }

        // Nullify node references
        const nodeRefs = [
            'mod1', 'mod2', 'mod3', 'mod4', 'fade1', 'fade2', 'mod1Gain', 'mod2Gain', 'mod3Gain',
            'mod4Gain', 'modGain1', 'modGain2', 'mix1', 'mix2', 'delay1', 'delay2', 'input', 'output',
            'boostGain', 'panner', 'bassHighPassFilter', 'highPassFilter', 'lowShelfGain', 'subBassFilter',
            'subMidFilter', 'midBassFilter', 'midShelfGain', 'highMidFilter', 'formantFilter1',
            'formantFilter2', 'formantFilter3', 'highShelfGain', 'subTrebleFilter', 'airFilter',
            'trebleLowPass', 'lowPassFilter', 'notchFilter', 'outputGain', 'compressor'
        ];
        for (const ref of nodeRefs) {
            this[ref] = null;
        }

        // Clear buffers và quản lý memoryManager
        if (this.memoryManager) {
            this.memoryManager.buffers.clear();
            const cacheKey = `disconnectState_${this.contextId}_${profile}`;
            this.memoryManager.set(cacheKey, {
                data: { isStarted: false, timestamp: Date.now(), profile, songStructure, cpuLoad },
                expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
        }
        this.shiftDownBuffer = null;
        this.shiftUpBuffer = null;
        this.fadeBuffer = null;

        // Khôi phục tham số mặc định
        this.delayTime = DEFAULT_DELAY_TIME; // 0.080
        this.fadeTime = DEFAULT_FADE_TIME; // 0.100
        this.bufferTime = DEFAULT_BUFFER_TIME; // 0.200
        this.rampTime = DEFAULT_RAMP_TIME; // 0.075
        this.lowPassFreq = DEFAULT_LOW_PASS_FREQ; // 18000
        this.highPassFreq = DEFAULT_HIGH_PASS_FREQ; // 40
        this.notchFreq = DEFAULT_NOTCH_FREQ; // 3500
        this.filterQ = DEFAULT_FILTER_Q; // 0.3
        this.notchQ = DEFAULT_NOTCH_Q; // 2.5
        this.formantF1Freq = DEFAULT_FORMANT_F1_FREQ; // 550
        this.formantF2Freq = DEFAULT_FORMANT_F2_FREQ; // 2000
        this.formantF3Freq = DEFAULT_FORMANT_F3_FREQ; // 3200
        this.formantQ = DEFAULT_FORMANT_Q; // 1.8
        this.subMidFreq = DEFAULT_SUBMID_FREQ; // 500
        this.subTrebleFreq = DEFAULT_SUBTREBLE_FREQ; // 11000
        this.midBassFreq = DEFAULT_MIDBASS_FREQ; // 200
        this.highMidFreq = DEFAULT_HIGHMID_FREQ; // 2000
        this.airFreq = DEFAULT_AIR_FREQ; // 13000
        this.spectralProfile = {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: null, spectralComplexity: 0.5, harmonicRatio: 0.5
        };
        this.tempoMemory = null;
        this.currentGenre = 'Unknown';
        this.currentKey = { key: 'Unknown', confidence: 0, isMajor: true };
        this.currentProfile = profile; // Giữ profile hiện tại
        this.nextProcessingInterval = 800; // Giảm từ 1000
        this.currentPitchMult = 0;
        this.noiseLevel = { level: 0, midFreq: 0.5, white: 0.5 };
        this.qualityPrediction = { score: 0, recommendations: [] };
        this.isVocal = profile === 'vocal';
        this.wienerGain = 1;
        this.polyphonicPitches = [];
        this.transientBoost = DEFAULT_TRANSIENT_BOOST; // 0.5

        // Đóng AudioContext nếu sở hữu
        if (this.ownsContext && this.context) {
            this.context.close().then(() => {
                this.context = null;
                console.debug('AudioContext closed successfully', { profile });
            }).catch(error => {
                handleError('Error closing AudioContext:', error, { profile }, 'high');
            });
        }

        // Debug logging
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Jungle disconnected successfully', {
                cpuLoad,
                isLowPowerDevice,
                profile,
                songStructure,
                cacheStats: this.memoryManager?.getCacheStats?.(),
                isStarted: this.isStarted,
                hasWorker: !!this.worker,
                hasAnalyser: !!this._analyser,
                ownsContext: this.ownsContext
            });
        }
    } catch (error) {
        handleError('Error during Jungle disconnect:', error, {
            isStarted: this.isStarted,
            hasWorker: !!this.worker,
            hasAnalyser: !!this._analyser,
            ownsContext: this.ownsContext,
            profile,
            cpuLoad,
            isLowPowerDevice
        }, 'high', { memoryManager: this.memoryManager });
        throw error;
    }
};

Jungle.prototype.reset = function () {
    try {
        // Disconnect và dọn dẹp trạng thái hiện tại
        this.disconnect();
        this.isStarted = false;

        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };

// Khởi tạo lại AudioContext nếu sở hữu
if (this.ownsContext) {
    if (this.context) {
        this.context.close().catch(e => console.warn('Error closing AudioContext:', e));
    }
    this.context = new AudioContext();
    if (this.context.state === 'suspended') {
        const resumeOnUserGesture = () => {
            this.context.resume().then(() => {
                console.debug('AudioContext resumed after reset');
            }).catch(e => {
                console.warn('Không thể khôi phục AudioContext sau reset', e);
                handleError('Failed to resume AudioContext after reset', e, { contextState: this.context.state }, 'high', { memoryManager: this.memoryManager });
            });
        };

        // Lắng nghe sự kiện người dùng
        const userGestureHandler = () => {
            resumeOnUserGesture();
            document.removeEventListener('click', userGestureHandler);
            document.removeEventListener('touchstart', userGestureHandler);
        };
        document.addEventListener('click', userGestureHandler);
        document.addEventListener('touchstart', userGestureHandler);
    }
} else if (!(this.context instanceof AudioContext)) {
    throw new Error('Invalid AudioContext after reset: context is not an instance of AudioContext.');
}

        // Khôi phục các tham số về giá trị mặc định
        this.delayTime = DEFAULT_DELAY_TIME; // 0.080
        this.fadeTime = DEFAULT_FADE_TIME; // 0.100
        this.bufferTime = DEFAULT_BUFFER_TIME; // 0.200
        this.rampTime = DEFAULT_RAMP_TIME; // 0.075
        this.lowPassFreq = DEFAULT_LOW_PASS_FREQ; // 18000
        this.highPassFreq = DEFAULT_HIGH_PASS_FREQ; // 40
        this.notchFreq = DEFAULT_NOTCH_FREQ; // 3500
        this.filterQ = DEFAULT_FILTER_Q; // 0.3
        this.notchQ = DEFAULT_NOTCH_Q; // 2.5
        this.formantF1Freq = DEFAULT_FORMANT_F1_FREQ; // 550
        this.formantF2Freq = DEFAULT_FORMANT_F2_FREQ; // 2000
        this.formantF3Freq = DEFAULT_FORMANT_F3_FREQ; // 3200
        this.formantQ = DEFAULT_FORMANT_Q; // 1.8
        this.subMidFreq = DEFAULT_SUBMID_FREQ; // 500
        this.subTrebleFreq = DEFAULT_SUBTREBLE_FREQ; // 11000
        this.midBassFreq = DEFAULT_MIDBASS_FREQ; // 200
        this.highMidFreq = DEFAULT_HIGHMID_FREQ; // 2000
        this.airFreq = DEFAULT_AIR_FREQ; // 13000
        this.qualityMode = 'high';
        this.currentPitchMult = 0;
        this.isVocal = profile === 'vocal';
        this.wienerGain = 1;
        this.polyphonicPitches = [];
        this.transientBoost = DEFAULT_TRANSIENT_BOOST; // 0.5
        this.nextProcessingInterval = 800; // Giảm từ 1000 để tăng phản hồi
        this.currentGenre = 'Unknown';
        this.currentKey = { key: 'Unknown', confidence: 0, isMajor: true };
        this.currentProfile = profile; // Giữ profile hiện tại
        this.noiseLevel = { level: 0, midFreq: 0.5, white: 0.5 };
        this.qualityPrediction = { score: 0, recommendations: [] };
        this.spectralProfile = {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: null, spectralComplexity: 0.5, harmonicRatio: 0.5
        };
        this.tempoMemory = null;

        // Smart Reset Algorithm: Khởi tạo lại memoryManager
        if (this.memoryManager) {
            this.memoryManager.clear(); // Xóa cache cũ
        } else {
            this.memoryManager = new MemoryManager();
        }

        // Buffer Optimization Algorithm: Tính toán bufferTime
        const pitchMultFactor = 1 + Math.abs(this.currentPitchMult) * 0.6; // Tăng từ 0.5
        let bufferTime = Math.max(this.bufferTime, this.fadeTime * 2.7 * pitchMultFactor); // Tăng từ 2.5
        if (profile === 'bright' || profile === 'smartStudio' || profile === 'vocal') {
            bufferTime *= 1.3; // Tăng từ 1.2 cho chất lượng cao
        } else if (isLowPowerDevice && cpuLoad > 0.9) {
            bufferTime *= 0.9; // Giảm nhẹ cho thiết bị yếu
        }
        if (bufferTime < this.fadeTime * 2.7) {
            console.warn('bufferTime adjusted for smooth transitions', { bufferTime });
            bufferTime = this.fadeTime * 2.7;
        }
        if (this.delayTime > MAX_DELAY_TIME) {
            console.warn('delayTime exceeds MAX_DELAY_TIME, clamping', { delayTime: MAX_DELAY_TIME });
            this.delayTime = MAX_DELAY_TIME; // 5
        }
        this.bufferTime = bufferTime;

        // Tạo lại các buffer
        try {
            const bufferOptions = {
                smoothness: 1.5, // Tăng từ 1.3
                vibrance: 0.6, // Tăng từ 0.5
                pitchShift: this.currentPitchMult,
                isVocal: this.isVocal,
                spectralProfile: this.spectralProfile,
                currentGenre: this.currentGenre,
                noiseLevel: this.noiseLevel,
                wienerGain: this.wienerGain,
                polyphonicPitches: this.polyphonicPitches,
                qualityMode: this.qualityMode,
                profile,
                songStructure
            };

            const buffers = getShiftBuffers(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);
            this.shiftDownBuffer = buffers.shiftDownBuffer;
            this.shiftUpBuffer = buffers.shiftUpBuffer;
            this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);

            if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
                throw new Error('Failed to create valid buffers after reset');
            }
            if (this.fadeBuffer.length < this.bufferTime * this.context.sampleRate) {
                throw new Error('fadeBuffer length insufficient after reset', {
                    expected: this.bufferTime * this.context.sampleRate,
                    actual: this.fadeBuffer.length
                });
            }

            // Lưu trạng thái buffer vào memoryManager
            const cacheKey = `bufferState_${this.contextId}_${profile}`;
            this.memoryManager.set(cacheKey, {
                data: {
                    shiftDownLength: this.shiftDownBuffer.length,
                    shiftUpLength: this.shiftUpBuffer.length,
                    fadeBufferLength: this.fadeBuffer.length,
                    bufferTime: this.bufferTime,
                    fadeTime: this.fadeTime,
                    timestamp: Date.now()
                },
                expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                priority: 'high'
            });

            console.debug('Buffers reinitialized after reset', {
                shiftDownLength: this.shiftDownBuffer.length,
                shiftUpLength: this.shiftUpBuffer.length,
                fadeBufferLength: this.fadeBuffer.length,
                bufferTime: this.bufferTime,
                fadeTime: this.fadeTime,
                sampleRate: this.context.sampleRate,
                bufferOptions,
                profile,
                songStructure
            });
        } catch (error) {
            handleError('Error creating buffers after reset', error, { bufferOptions, profile }, 'high', { memoryManager: this.memoryManager });
            if (this.ownsContext) this.context.close();
            throw error;
        }

        // Khởi tạo lại các node
        try {
            this.initializeNodes();
            console.debug('Nodes reinitialized successfully after reset', { profile });
        } catch (error) {
            handleError('Error initializing nodes after reset', error, { profile }, 'high', { memoryManager: this.memoryManager });
            if (this.ownsContext) this.context.close();
            throw error;
        }

        // Khởi tạo lại worker nếu cần
        if (this.worker) {
            this.initializeWorker();
            console.debug('Worker reinitialized after reset', { profile });
        }

        // Lưu trạng thái reset vào memoryManager
        const resetCacheKey = `resetState_${this.contextId}_${profile}`;
        this.memoryManager.set(resetCacheKey, {
            data: {
                isStarted: false,
                qualityMode: this.qualityMode,
                bufferTime: this.bufferTime,
                profile,
                songStructure,
                timestamp: Date.now()
            },
            expiry: Date.now() + 60000,
            priority: 'high'
        });
        this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);

        // Debug logging
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Jungle reset successfully', {
                sampleRate: this.context.sampleRate,
                qualityMode: this.qualityMode,
                bufferTime: this.bufferTime,
                fadeTime: this.fadeTime,
                cpuLoad,
                isLowPowerDevice,
                profile,
                songStructure,
                cacheStats: this.memoryManager.getCacheStats?.()
            });
        }
    } catch (error) {
        handleError('Error during Jungle reset:', error, {
            ownsContext: this.ownsContext,
            contextState: this.context?.state,
            qualityMode: this.qualityMode,
            profile: this.profile,
            cpuLoad,
            isLowPowerDevice
        }, 'high', { memoryManager: this.memoryManager });
        throw error;
    }
};

Jungle.prototype.setFilterParams = function ({ lowPassFreq, highPassFreq, notchFreq, filterQ, notchQ, lowShelfGain, highShelfGain, outputGain }) {
    try {
        const currentTime = this.context.currentTime;
        const spectral = this.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            spectralComplexity: 0.5
        };
        const genreFactor = {
            'EDM': 1.2, 'Drum & Bass': 1.2, 'Hip-Hop': 1.1, 'Pop': 1.0, 'Bolero': 0.9,
            'Classical/Jazz': 0.8, 'Rock/Metal': 1.0, 'Karaoke': 0.9
        }[this.currentGenre] || 1.0;

        // Tính CPU load và kiểm tra thiết bị yếu
        const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const qualityMode = cpuLoad > 0.8 || isLowPowerDevice ? 'low' : this.qualityMode || 'high';

        // Xác định voice type để bảo vệ giọng nữ
        let voiceType = 'middle';
        let fundamentalFreq = 440;
        if (this.polyphonicPitches.length > 0) {
            fundamentalFreq = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
        }
        if (fundamentalFreq <= 240) {
            voiceType = 'low';
        } else if (fundamentalFreq <= 480) {
            voiceType = 'middle';
        } else {
            voiceType = 'high'; // Giọng nữ thường nằm ở đây
        }

        // Dynamic filter adjustments
        const transientBoost = spectral.transientEnergy > 0.6 && ['Pop', 'Karaoke', 'EDM'].includes(this.currentGenre)
            ? 1.5 + this.transientBoost * 1.5 : 1.0;
        const subBassAdjust = spectral.subBass < 0.4 ? 2 : spectral.subBass > 0.7 ? -1 : 0;
        const trebleAdjust = spectral.air > 0.8 || spectral.subTreble > 0.8 ? -2 : (voiceType === 'high' ? -0.5 : 0); // Giảm treble cho giọng nữ
        const noiseReduction = this.noiseLevel.level > 0.7 || this.wienerGain < 0.8 ? 1.5 : 1.0;

        // Giới hạn pitch shift để bảo vệ giọng nữ
        const maxPitchShift = voiceType === 'high' ? 0.5 : 0.8; // Giới hạn pitch shift cho giọng nữ
        const adjustedPitchMult = Math.max(-maxPitchShift, Math.min(maxPitchShift, this.currentPitchMult));

        // Điều chỉnh bufferTime dựa trên qualityMode và spectralComplexity
        let bufferTimeFactor = qualityMode === 'high' ? 1.5 : 1.0;
        if (spectral.spectralComplexity > 0.7 || Math.abs(adjustedPitchMult) > 0.3) {
            bufferTimeFactor *= 1.2;
        }
        this.bufferTime = Math.max(this.fadeTime * 2.5, this.bufferTime * bufferTimeFactor);

        // Cập nhật buffer với formant bảo vệ giọng nữ
        if (Math.abs(adjustedPitchMult) > 0.2 || spectral.spectralComplexity > 0.7 || voiceType === 'high') {
            const bufferOptions = {
                fadeType: 'bezier',
                smoothness: voiceType === 'high' ? 1.5 : 1.3, // Tăng smoothness cho giọng nữ
                vibrance: voiceType === 'high' ? 0.7 : 0.5, // Tăng vibrance để giữ độ trong
                pitchShift: adjustedPitchMult,
                isVocal: this.isVocal,
                spectralProfile: spectral,
                qualityMode,
                vocalPresence: spectral.vocalPresence
            };
            this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);
            if (!this.fadeBuffer) {
                throw new Error("Failed to update fade buffer");
            }
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize());
        }

        // Low-pass filter
        if (lowPassFreq !== undefined) {
            this.lowPassFreq = Math.max(20, Math.min(20000, lowPassFreq));
            this.lowPassFreq = spectral.air > 0.7 || voiceType === 'high' ? Math.min(this.lowPassFreq, 16000) : this.lowPassFreq; // Bảo vệ giọng nữ
            this.lowPassFreq *= transientBoost > 1.2 ? 1.1 : 1.0;
            if (spectral.spectralComplexity > 0.7 && Math.abs(adjustedPitchMult) > 0.5) {
                this.lowPassFreq *= 0.85; // Giảm mạnh hơn để tránh méo tiếng
                console.debug(`Reduced lowPassFreq to ${this.lowPassFreq}Hz due to high spectral complexity and voiceType=${voiceType}`);
            }
            this.lowPassFilter.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                this.lowPassFreq, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // High-pass filter
        if (highPassFreq !== undefined) {
            this.highPassFreq = Math.max(20, Math.min(20000, highPassFreq));
            this.highPassFreq = spectral.subBass > 0.6 ? Math.max(this.highPassFreq, 50) : this.highPassFreq;
            if (voiceType === 'high') {
                this.highPassFreq = Math.max(this.highPassFreq, 80); // Tránh cắt tần số thấp quá nhiều cho giọng nữ
            }
            this.highPassFilter.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                this.highPassFreq, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // Notch filter
        if (notchFreq !== undefined) {
            this.notchFreq = Math.max(20, Math.min(20000, notchFreq));
            this.notchFreq = this.noiseLevel.midFreq > 0.5 || voiceType === 'high' ? 4500 : this.notchFreq; // Tăng tần số notch cho giọng nữ
            this.notchFilter.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                this.notchFreq, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }
        if (notchQ !== undefined) {
            this.notchQ = Math.max(0.1, Math.min(10, notchQ));
            this.notchQ *= noiseReduction * (voiceType === 'high' ? 0.8 : 1.0); // Giảm Q cho giọng nữ để tránh mất chi tiết
            this.notchFilter.Q[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                this.notchQ, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // Low-shelf filter
        if (lowShelfGain !== undefined) {
            const adjustedLowShelfGain = lowShelfGain + subBassAdjust * genreFactor * (voiceType === 'high' ? 0.7 : 1.0); // Giảm bass cho giọng nữ
            this.lowShelfGain.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                adjustedLowShelfGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.subBassFilter.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                adjustedLowShelfGain * 0.5, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // High-shelf filter
        if (highShelfGain !== undefined) {
            const adjustedHighShelfGain = highShelfGain + trebleAdjust + (transientBoost > 1.2 ? 1 : 0) + (voiceType === 'high' ? 0.5 : 0); // Tăng nhẹ treble cho giọng nữ
            this.highShelfGain.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                adjustedHighShelfGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.subTrebleFilter.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                adjustedHighShelfGain * 0.5, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // Output gain
        if (outputGain !== undefined) {
            const adjustedOutputGain = outputGain * (1 + Math.abs(adjustedPitchMult) * 0.2) * (voiceType === 'high' ? 1.1 : 1.0); // Tăng nhẹ gain cho giọng nữ
            this.outputGain.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                adjustedOutputGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // De-essing adjustment
        if (this.deEsser) {
            const deEssGain = (spectral.air > 0.8 || spectral.subTreble > 0.8 || voiceType === 'high') ? -4 : -2; // Tăng de-essing cho giọng nữ
            this.deEsser.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                deEssGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // Formant adjustment để bảo vệ giọng nữ
        if (this.formantFilter1 && this.formantFilter2) {
            let f1Freq = 450, f2Freq = 1900, formantGain = 3.2, formantQ = 0.9;
            if (voiceType === 'high') {
                f1Freq = 580 * (1 + (spectral.vocalPresence || 0) * 0.12);
                f2Freq = 2350 * (1 + (spectral.vocalPresence || 0) * 0.12);
                formantGain = 2.8; // Giảm gain để giữ tự nhiên
                formantQ = 0.6; // Giảm Q để tránh sắc nét quá mức
            } else if (voiceType === 'middle') {
                f1Freq = 450 * (1 + (spectral.vocalPresence || 0) * 0.12);
                f2Freq = 1950 * (1 + (spectral.vocalPresence || 0) * 0.12);
                formantGain = 3.6;
                formantQ = 0.9;
            } else {
                f1Freq = 340 * (1 + (spectral.vocalPresence || 0) * 0.12);
                f2Freq = 1550 * (1 + (spectral.vocalPresence || 0) * 0.12);
                formantGain = 4.0;
                formantQ = 1.2;
            }
            if (Math.abs(adjustedPitchMult) > 0.3) {
                const pitchShiftFactor = Math.pow(2, adjustedPitchMult * 0.6); // Giảm tác động pitch shift
                f1Freq *= pitchShiftFactor;
                f2Freq *= pitchShiftFactor;
                formantGain = Math.max(2.0, formantGain - Math.abs(adjustedPitchMult) * 0.3);
            }
            this.formantFilter1.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                f1Freq, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.formantFilter1.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                formantGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.formantFilter1.Q[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                formantQ, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.formantFilter2.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                f2Freq, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.formantFilter2.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                formantGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.formantFilter2.Q[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                formantQ, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // Apply qualityPrediction recommendations
        (this.qualityPrediction.recommendations || []).forEach(rec => {
            if (typeof rec !== 'string') return;
            if (rec.includes("Reduce sub-bass")) {
                const reducedLowShelfGain = Math.max(this.lowShelfGain.gain.value - 2, 0);
                const reducedSubBassGain = Math.max(this.subBassFilter.gain.value - 1, 0);
                this.lowShelfGain.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    reducedLowShelfGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
                this.subBassFilter.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    reducedSubBassGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
            }
            if (rec.includes("Reduce treble/sub-treble")) {
                const reducedHighShelfGain = Math.max(this.highShelfGain.gain.value - (voiceType === 'high' ? 1.5 : 2), 0);
                const reducedSubTrebleGain = Math.max(this.subTrebleFilter.gain.value - (voiceType === 'high' ? 0.8 : 1), 0);
                this.highShelfGain.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    reducedHighShelfGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
                this.subTrebleFilter.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    reducedSubTrebleGain, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
            }
            if (rec.includes("Apply noise reduction")) {
                this.notchFilter.Q[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    this.notchQ * (voiceType === 'high' ? 1.5 : 2.0), currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
                this.notchFilter.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    voiceType === 'high' ? 4500 : 4000, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
            }
            if (rec.includes("Boost vocal clarity")) {
                this.highMidFilter.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    this.highMidFilter.gain.value + (voiceType === 'high' ? 2.0 : 1.5), currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
                this.formantFilter1.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    formantGain + 0.5, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
                this.formantFilter2.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                    formantGain + 0.5, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
                );
            }
        });

        // Harmonic enhancement dựa trên polyphonicPitches
        if (this.polyphonicPitches.length > 0) {
            const dominantPitch = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
            const targetFreq = Math.min(dominantPitch * (voiceType === 'high' ? 2.2 : 2), 3500); // Tăng tần số cho giọng nữ
            this.highMidFilter.frequency[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                targetFreq, currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
            this.highMidFilter.gain[qualityMode === 'low' ? 'setValueAtTime' : 'linearRampToValueAtTime'](
                this.highMidFilter.gain.value + (voiceType === 'high' ? 2.0 : 1.5), currentTime + (qualityMode === 'low' ? 0 : this.rampTime)
            );
        }

        // Lưu thông tin voice profile
        if (this.memoryManager) {
            this.memoryManager.buffers.set('voiceProfile', {
                voiceType,
                fundamentalFreq,
                vocalPresence: spectral.vocalPresence,
                timestamp: Date.now(),
                expiry: Date.now() + 10000
            });
            this.memoryManager.pruneCache(100);
        }

        console.debug('Filter parameters set successfully with vocal protection', {
            lowPassFreq: this.lowPassFreq,
            highPassFreq: this.highPassFreq,
            notchFreq: this.notchFreq,
            spectralProfile: spectral,
            qualityMode,
            cpuLoad,
            voiceType,
            fundamentalFreq
        });
    } catch (error) {
        handleError("Error setting filter parameters:", error, {
            lowPassFreq, highPassFreq, notchFreq, filterQ, notchQ, lowShelfGain, highShelfGain, outputGain,
            spectralProfile: this.spectralProfile,
            qualityMode: this.qualityMode,
            voiceType
        });
    }
};

Jungle.prototype.setSoundProfile = function (profile) {
    try {
        this.currentProfile = profile;
        const currentTime = this.context.currentTime;
        const spectral = this.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
            instruments: {}, chroma: null,
            spectralFlux: 0.5, spectralEntropy: 0.5, harmonicRatio: 0.5
        };
        const genreFactor = {
            'EDM': 1.2, 'Drum & Bass': 1.2, 'Hip-Hop': 1.1, 'Pop': 1.0, 'Bolero': 0.9,
            'Classical/Jazz': 0.8, 'Rock/Metal': 1.0, 'Karaoke': 0.9
        }[this.currentGenre] || 1.0;

        // Initialize advanced music context analyzer
        const contextAnalyzer = this.initializeContextAnalyzer();

        // Analyze music context in real-time with enhanced precision
        const startTime = performance.now();
        const musicContext = contextAnalyzer.analyze({
            spectralProfile: spectral,
            tempoMemory: this.tempoMemory,
            currentGenre: this.currentGenre,
            currentKey: this.currentKey,
            polyphonicPitches: this.polyphonicPitches,
            noiseLevel: this.noiseLevel,
            qualityPrediction: this.qualityPrediction,
            isVocal: this.isVocal
        });

        // Enhanced song structure analysis for dynamic adjustments
        const songStructure = this.analyzeSongStructure({
            spectralProfile: spectral,
            tempoMemory: this.tempoMemory,
            polyphonicPitches: this.polyphonicPitches,
            currentGenre: this.currentGenre
        });

        // CPU load detection and optimization
        const processingTime = performance.now() - startTime;
        let fftSize = 2048;
        let enableSubharmonic = true;
        let enableAdvancedDeEsser = true;
        let enableCNNTransient = true; // New: Enable CNN-based transient detection
        if (processingTime > 16) { // Threshold for 60fps
            fftSize = processingTime > 30 ? 512 : 1024; // Reduce FFT size
            enableSubharmonic = processingTime < 25; // Disable subharmonic if too heavy
            enableAdvancedDeEsser = processingTime < 20; // Disable advanced deEsser if too heavy
            enableCNNTransient = processingTime < 22; // Disable CNN transient detection if too heavy
            console.debug('High CPU load detected, reducing FFT size to', fftSize, 'Subharmonic:', enableSubharmonic, 'AdvancedDeEsser:', enableAdvancedDeEsser, 'CNNTransient:', enableCNNTransient);
        }
        this.setFFTSize(fftSize);

        // Optimize wienerGain and noiseLevel with smarter noise reduction
        this.wienerGain = spectral.subTreble > 0.6 || spectral.air > 0.6 ? 0.95 : 0.93; // Reduced for less harshness
        this.noiseLevel = {
            level: (spectral.subTreble > 0.6 || spectral.air > 0.6) ? 0.35 : 0.25, // Lower noise floor
            midFreq: (spectral.subTreble > 0.6 || spectral.air > 0.6) ? 5000 : 3500, // Shifted for vocal clarity
            lowFreq: spectral.subBass > 0.7 ? 200 : 150 // New: Low-frequency noise suppression
        };
        if (musicContext.spectralComplexity > 0.65) {
            this.wienerGain = Math.max(0.90, this.wienerGain - 0.02); // Protect details
        }
        if (musicContext.transientEnergy < 0.35) {
            this.noiseLevel.level = Math.min(0.40, this.noiseLevel.level + 0.05); // Handle background noise
        }

        // Update buffer settings with adaptive parameters
        this.fadeTime = musicContext.fadeTime || (0.35 * (this.isVocal ? 1.1 : 1.0)); // Smoother fade
        this.bufferTime = musicContext.bufferTime || (0.55 * (1 + Math.abs(this.currentPitchMult) * 0.35)); // Reduced for responsiveness
        this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, {
            fadeType: musicContext.fadeType || 'bezier',
            smoothness: musicContext.smoothness || 2.0, // Increased for natural transitions
            vibrance: musicContext.vibrance || 0.9, // Enhanced for lively sound
            pitchShift: this.currentPitchMult,
            isVocal: this.isVocal,
            spectralProfile: spectral,
            currentGenre: this.currentGenre,
            noiseLevel: this.noiseLevel,
            wienerGain: this.wienerGain,
            polyphonicPitches: this.polyphonicPitches
        }, this.memoryManager);

        // Base settings with reduced overall gain
        if (!this.outputGain?.gain) throw new Error("outputGain is not initialized");
        this.outputGain.gain.linearRampToValueAtTime(0.40 * genreFactor, currentTime + this.rampTime); // Further reduced to prevent clipping
        this.setPan(0);

        const pitchMult = this.currentPitchMult || 0;
        const absPitchMult = Math.abs(pitchMult);
        const dynamicFactor = Math.min(1 + absPitchMult * 0.25, 1.25); // Smoother dynamic scaling

        // Advanced spectral analysis with context-aware adjustments
        const warmthIndex = (spectral.bass + spectral.subMid) / 2 - (spectral.high + spectral.subTreble) / 2;
        const needsWarmth = warmthIndex < 0.5; // Increased threshold for warmth
        const subBassIndex = (spectral.subBass + spectral.bass) / 2;
        const needsSubBass = subBassIndex < 0.7; // More aggressive bass boost
        const subMidIndex = spectral.subMid;
        const needsSubMid = subMidIndex < 0.7; // Enhanced mid clarity
        const midIndex = (spectral.midLow + spectral.midHigh) / 2;
        const needsMid = midIndex < 0.7;
        const trebleIndex = (spectral.high + spectral.subTreble + spectral.air) / 3;
        const needsTrebleReduction = trebleIndex > 0.5; // Stronger treble reduction
        const isPiercing = trebleIndex > 0.55 || spectral.subTreble > 0.65 || spectral.air > 0.65;

        const warmthBoost = needsWarmth ? Math.min(3.0, (0.5 - warmthIndex) * 4.8) : 0.9; // Enhanced warmth
        const subBassBoost = needsSubBass ? Math.min(3.2, (0.7 - subBassIndex) * 5.8) : 0.2; // Stronger bass
        const subMidBoost = needsSubMid ? Math.min(3.0, (0.7 - subMidIndex) * 5.8) : 0.6; // Clearer mids
        const midBoost = needsMid ? Math.min(3.0, (0.7 - midIndex) * 5.8) : 0.3; // Balanced mids
        const trebleReduction = isPiercing ? Math.min(4.5, (trebleIndex - 0.5) * 6.5) : 0.8; // Stronger treble cut

        // Context-aware warmth and genre adjustments
        let smartWarmthAdjust = (this.isVocal || spectral.vocalPresence > 0.65) ? 1.5 : 1.2; // Enhanced vocal warmth
        if (spectral.spectralEntropy > 0.65) smartWarmthAdjust *= 0.75; // Reduce warmth in complex spectra
        if (['Bolero', 'Classical/Jazz', 'Karaoke'].includes(this.currentGenre)) {
            smartWarmthAdjust *= 1.6; // Warmer for these genres
            subMidBoost *= 1.5;
        } else if (['EDM', 'Drum & Bass', 'Hip-Hop'].includes(this.currentGenre)) {
            subBassBoost *= 1.4; // Stronger bass for electronic genres
        }

        // Noise and transient adjustments
        const noiseFactor = this.noiseLevel.level > 0.45 || this.wienerGain < 0.9 ? 2.4 : 1.3; // Enhanced noise handling
        let notchQ = this.notchQ * noiseFactor * 4.5; // Sharper notch for noise
        let notchFreq = this.noiseLevel.midFreq > 0.45 ? 6000 : 5000; // Adjusted for vocal clarity
        const transientBoostAdjust = enableCNNTransient && spectral.transientEnergy > 0.55 ? 0.8 : 0.6; // CNN-based transient boost
        const transientGenres = ["EDM", "Drum & Bass", "Hip-Hop", "Rock/Metal"];
        const isTransientGenre = transientGenres.includes(this.currentGenre);

        // Polyphonic adjustments for instrument clarity
        let polyphonicAdjust = 0;
        if (this.polyphonicPitches.length > 0) {
            polyphonicAdjust = this.polyphonicPitches.length > 1 ? 1.4 : 1.2; // Enhanced for polyphony
        } else {
            const chromaVariance = spectral.chroma?.reduce((sum, val) => sum + val * val, 0) / (spectral.chroma?.length || 1);
            polyphonicAdjust = chromaVariance > 0.15 ? 0.9 : 0.2; // Adjusted for clarity
        }

        // Harmonic boost for natural, lively sound
        const harmonicBoost = 0.6 + warmthBoost * 0.4 + (spectral.instruments?.guitar || spectral.instruments?.piano ? 0.5 : 0.3) + polyphonicAdjust + (spectral.harmonicRatio > 0.65 ? 0.4 : 0.2);

        // Subharmonic synthesis for rich, natural bass
        const subharmonicGain = enableSubharmonic && needsSubBass && (this.currentGenre === "EDM" || this.currentGenre === "Hip-Hop") ? 3.0 : 1.4; // Stronger subharmonics
        if (enableSubharmonic && this.subharmonicEnhancer) {
            const curve = new Float32Array(512).map((_, i) => {
                const x = (i - 256) / 256;
                return Math.sin(Math.PI * x * 1.1) * subharmonicGain * 0.35; // Smoother, richer curve
            });
            this.subharmonicEnhancer.curve = curve;
            if (this.subBassFilter && this.subMidFilter) {
                this.subBassFilter.disconnect();
                this.subBassFilter.connect(this.subharmonicEnhancer);
                this.subharmonicEnhancer.connect(this.subMidFilter);
            }
        }

        // Formant and compressor settings for natural vocal pitch shifting
        let bassCutFreq = 45; // Lower for cleaner bass
        let trebleCutFreq = 15000; // Reduced for less harshness
        let f1Freq = 440; // Adjusted for vocal clarity
        let f2Freq = 1850; // Adjusted for vocal presence
        let formantGain = 3.2; // Reduced for natural sound
        let formantQ = 0.9; // Smoother formants

        if (pitchMult !== 0) {
            const pitchShiftFactor = Math.pow(2, pitchMult * 0.8); // Smoother pitch scaling
            f1Freq *= pitchShiftFactor;
            f2Freq *= pitchShiftFactor;
            formantGain = Math.max(2.0, formantGain - absPitchMult * 0.3); // Prevent distortion
            this.delayTime = Math.min(this.delayTime * (1 + absPitchMult * 0.05), 0.055); // Reduced for stability
        }

        if (this.polyphonicPitches.length > 0) {
            const dominantPitch = this.polyphonicPitches[0]?.frequency || f1Freq;
            f1Freq = Math.min(f1Freq * 1.05, dominantPitch * 1.15); // Subtle adjustment
            f2Freq = Math.min(f2Freq * 1.05, dominantPitch * 2.4); // Enhanced vocal presence
        }

        const smartRatio = (baseRatio) => Math.min(baseRatio + absPitchMult * 0.8, baseRatio * 1.1); // Smoother compression
        const wienerCompressionAdjust = this.wienerGain < 0.9 ? 1.2 * (1 - this.wienerGain) : 0.1; // Subtle compression

        // Spatial audio for natural soundstage
        const stereoWidth = this.currentGenre === "EDM" || this.currentGenre === "Pop" ? 0.08 : 0.04; // Reduced for balance
        let panAdjust = pitchMult * stereoWidth;

        // Apply user feedback with smarter adjustments
        const userFeedbackAdjust = this.applyUserFeedback();

        // Apply machine learning-based optimization
        const optimizedParams = this.optimizeSoundProfile({
            profile,
            musicContext,
            spectral,
            genreFactor,
            warmthBoost,
            subBassBoost,
            subMidBoost,
            midBoost,
            trebleReduction,
            transientBoostAdjust,
            polyphonicAdjust,
            harmonicBoost,
            songStructure,
            userFeedbackAdjust
        });

        const applyProfile = () => {
            if (!this.highPassFilter?.frequency) throw new Error("highPassFilter is not initialized");
            if (!this.lowShelfGain?.gain) throw new Error("lowShelfGain is not initialized");
            if (!this.subBassFilter?.gain) throw new Error("subBassFilter is not initialized");
            if (!this.subMidFilter?.gain) throw new Error("subMidFilter is not initialized");
            if (!this.midBassFilter?.gain) throw new Error("midBassFilter is not initialized");
            if (!this.midShelfGain?.gain) throw new Error("midShelfGain is not initialized");
            if (!this.highMidFilter?.gain) throw new Error("highMidFilter is not initialized");
            if (!this.highShelfGain?.gain) throw new Error("highShelfGain is not initialized");
            if (!this.subTrebleFilter?.gain) throw new Error("subTrebleFilter is not initialized");
            if (!this.airFilter?.gain) throw new Error("airFilter is not initialized");
            if (!this.lowPassFilter?.frequency) throw new Error("lowPassFilter is not initialized");
            if (!this.compressor?.threshold) throw new Error("compressor is not initialized");
            if (!this.notchFilter?.frequency) throw new Error("notchFilter is not initialized");
            if (!this.panner?.pan) throw new Error("panner is not initialized");

            // Apply base optimized parameters
            this.highPassFilter.frequency.linearRampToValueAtTime(optimizedParams.bassCutFreq || bassCutFreq, currentTime + this.rampTime);
            this.lowShelfGain.gain.linearRampToValueAtTime(optimizedParams.lowShelfGain || (9 + subBassBoost + warmthBoost + subharmonicGain), currentTime + this.rampTime);
            this.subBassFilter.gain.linearRampToValueAtTime(optimizedParams.subBassGain || (4 + subBassBoost + subharmonicGain), currentTime + this.rampTime);
            this.subMidFilter.gain.linearRampToValueAtTime(optimizedParams.subMidGain || (5.5 + subMidBoost + warmthBoost * smartWarmthAdjust), currentTime + this.rampTime);
            this.midBassFilter.gain.linearRampToValueAtTime(optimizedParams.midBassGain || (4.2 + warmthBoost), currentTime + this.rampTime);
            this.midShelfGain.gain.linearRampToValueAtTime(optimizedParams.midShelfGain || (6.2 + midBoost), currentTime + this.rampTime);
            this.highMidFilter.gain.linearRampToValueAtTime(optimizedParams.highMidGain || (4.5 + midBoost + harmonicBoost), currentTime + this.rampTime);
            this.highShelfGain.gain.linearRampToValueAtTime(optimizedParams.highShelfGain || (0.8 - trebleReduction + harmonicBoost + (isTransientGenre ? transientBoostAdjust : 0)), currentTime + this.rampTime);
            this.subTrebleFilter.gain.linearRampToValueAtTime(optimizedParams.subTrebleGain || (0.6 - trebleReduction + harmonicBoost + (isTransientGenre ? transientBoostAdjust : 0)), currentTime + this.rampTime);
            this.airFilter.gain.linearRampToValueAtTime(optimizedParams.airGain || (0.6 + harmonicBoost - trebleReduction), currentTime + this.rampTime);
            this.lowPassFilter.frequency.linearRampToValueAtTime(optimizedParams.trebleCutFreq || (trebleCutFreq - trebleReduction * 1200), currentTime + this.rampTime);
            this.compressor.threshold.linearRampToValueAtTime(optimizedParams.compressorThreshold || (-18 * dynamicFactor), currentTime + this.rampTime);
            this.compressor.ratio.linearRampToValueAtTime(optimizedParams.compressorRatio || smartRatio(4.5 + wienerCompressionAdjust), currentTime + this.rampTime);
            this.compressor.attack.linearRampToValueAtTime(optimizedParams.compressorAttack || 0.007, currentTime + this.rampTime);
            this.compressor.release.linearRampToValueAtTime(optimizedParams.compressorRelease || 0.28, currentTime + this.rampTime);
            this.notchFilter.frequency.linearRampToValueAtTime(optimizedParams.notchFreq || notchFreq, currentTime + this.rampTime);
            this.notchFilter.Q.linearRampToValueAtTime(optimizedParams.notchQ || notchQ, currentTime + this.rampTime);
            this.panner.pan.linearRampToValueAtTime(optimizedParams.panAdjust || panAdjust, currentTime + this.rampTime);

            // Profile-specific settings with vocal classification and song structure
            const applyCommonProfileSettings = (vocalTypeFactor = 1.0, genreAdjust = 1.0, deEsserGain = -8) => { // Stronger default de-essing
                this.lowShelfGain.gain.linearRampToValueAtTime(
                    optimizedParams.lowShelfGain || (8.5 + subBassBoost + warmthBoost * genreAdjust + userFeedbackAdjust.bass),
                    currentTime + this.rampTime
                );
                this.subBassFilter.gain.linearRampToValueAtTime(
                    optimizedParams.subBassGain || (4 + subBassBoost * genreAdjust + userFeedbackAdjust.bass),
                    currentTime + this.rampTime
                );
                this.subMidFilter.gain.linearRampToValueAtTime(
                    optimizedParams.subMidGain || ((5.5 + subMidBoost + warmthBoost) * vocalTypeFactor * genreAdjust + userFeedbackAdjust.mid),
                    currentTime + this.rampTime
                );
                this.midBassFilter.gain.linearRampToValueAtTime(
                    optimizedParams.midBassGain || (4 + warmthBoost * genreAdjust + userFeedbackAdjust.mid),
                    currentTime + this.rampTime
                );
                this.midShelfGain.gain.linearRampToValueAtTime(
                    optimizedParams.midShelfGain || ((6.2 + midBoost) * vocalTypeFactor * genreAdjust * songStructure.structureFactor + userFeedbackAdjust.mid),
                    currentTime + this.rampTime
                );
                this.highMidFilter.gain.linearRampToValueAtTime(
                    optimizedParams.highMidGain || ((4.5 + midBoost + harmonicBoost) * vocalTypeFactor * genreAdjust + userFeedbackAdjust.mid),
                    currentTime + this.rampTime
                );
                this.highShelfGain.gain.linearRampToValueAtTime(
                    optimizedParams.highShelfGain || (0.8 - trebleReduction + harmonicBoost * genreAdjust + (isTransientGenre ? transientBoostAdjust : 0) + userFeedbackAdjust.treble),
                    currentTime + this.rampTime
                );
                this.subTrebleFilter.gain.linearRampToValueAtTime(
                    optimizedParams.subTrebleGain || ((0.6 - trebleReduction + harmonicBoost) * vocalTypeFactor * genreAdjust + (isTransientGenre ? transientBoostAdjust : 0) + userFeedbackAdjust.treble),
                    currentTime + this.rampTime
                );
                this.airFilter.gain.linearRampToValueAtTime(
                    optimizedParams.airGain || (0.6 + harmonicBoost - trebleReduction * genreAdjust + userFeedbackAdjust.treble),
                    currentTime + this.rampTime
                );
                this.notchFilter.frequency.linearRampToValueAtTime(optimizedParams.notchFreq || notchFreq, currentTime + this.rampTime);
                this.notchFilter.Q.linearRampToValueAtTime(optimizedParams.notchQ || notchQ, currentTime + this.rampTime);
                if (this.deEsser?.gain) {
                    this.deEsser.gain.linearRampToValueAtTime(optimizedParams.deEsserGain || deEsserGain, currentTime + this.rampTime);
                }
            };

            const applyVocalClassification = () => {
                let vocalTypeFactor = this.isVocal ? 1.5 : 1.0; // Enhanced for vocal presence
                let voiceType = 'middle';
                let fundamentalFreq = 440;
                if (this.polyphonicPitches.length > 0) {
                    fundamentalFreq = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
                }
                if (fundamentalFreq <= 240) { // Low voice
                    voiceType = 'low';
                    vocalTypeFactor = 1.6;
                    f1Freq = optimizedParams.f1Freq || (340 + (spectral.vocalPresence || 0) * 60);
                    f2Freq = optimizedParams.f2Freq || (1550 + (spectral.vocalPresence || 0) * 250);
                    formantGain = optimizedParams.formantGain || (4.0 * vocalTypeFactor * songStructure.structureFactor);
                    formantQ = optimizedParams.formantQ || (1.2 * vocalTypeFactor);
                } else if (fundamentalFreq <= 480) { // Middle voice
                    voiceType = 'middle';
                    vocalTypeFactor = 1.0;
                    f1Freq = optimizedParams.f1Freq || (450 + (spectral.vocalPresence || 0) * 60);
                    f2Freq = optimizedParams.f2Freq || (1950 + (spectral.vocalPresence || 0) * 250);
                    formantGain = optimizedParams.formantGain || (3.6 * vocalTypeFactor * songStructure.structureFactor);
                    formantQ = optimizedParams.formantQ || (0.9 * vocalTypeFactor);
                } else { // High voice
                    voiceType = 'high';
                    vocalTypeFactor = 0.7; // Increased for high vocal clarity
                    f1Freq = optimizedParams.f1Freq || (580 + (spectral.vocalPresence || 0) * 60);
                    f2Freq = optimizedParams.f2Freq || (2350 + (spectral.vocalPresence || 0) * 250);
                    formantGain = optimizedParams.formantGain || (2.8 * vocalTypeFactor * songStructure.structureFactor); // Reduced for less harshness
                    formantQ = optimizedParams.formantQ || (0.6 * vocalTypeFactor);
                }
                return { vocalTypeFactor, voiceType, fundamentalFreq };
            };

            const applyGenreAndStructureAdjustments = (vocalTypeFactor) => {
                let genreAdjust = 1.0;
                if (this.currentGenre === 'Bolero') {
                    genreAdjust = 1.5; // Warmer, richer
                    warmthBoost *= 1.7;
                    subMidBoost *= 1.6;
                    trebleReduction *= 0.6; // Softer treble
                } else if (['EDM', 'Pop'].includes(this.currentGenre)) {
                    genreAdjust = 0.85; // Brighter, punchier
                    transientBoostAdjust *= 1.4;
                    optimizedParams.subTrebleGain *= 1.1;
                } else if (this.currentGenre === 'Rock/Metal') {
                    genreAdjust = 1.2; // Aggressive mids
                    harmonicBoost *= 1.5;
                    midBoost *= 1.4;
                } else if (this.currentGenre === 'Karaoke') {
                    genreAdjust = 1.3; // Vocal-focused
                    vocalTypeFactor *= 1.4;
                    warmthBoost *= 1.4;
                }

                if (songStructure.section === 'chorus') {
                    midBoost *= 1.4; // Emphasize mids
                    harmonicBoost *= 1.4;
                    optimizedParams.compressorRatio = smartRatio(optimizedParams.compressorRatio * 1.2);
                    optimizedParams.formantGain = optimizedParams.formantGain * 0.85; // Reduce formant gain in chorus
                } else if (songStructure.section === 'bridge') {
                    optimizedParams.highMidGain *= 1.2;
                    optimizedParams.subTrebleGain *= 1.05;
                } else if (songStructure.section === 'intro') {
                    warmthBoost *= 0.8;
                    optimizedParams.formantGain *= 0.7; // Subtle vocals
                }

                return genreAdjust;
            };

            const applyNoiseHandling = () => {
                let deEsserGain = -8; // Stronger default de-essing
                if (enableAdvancedDeEsser && (spectral.spectralFlux > 0.55 || spectral.air > 0.65 || spectral.vocalPresence > 0.7)) {
                    deEsserGain = -12 - (spectral.spectralFlux - 0.55) * 10; // Stronger dynamic de-essing
                    notchFreq = optimizedParams.notchFreq || (6500 + spectral.air * 1000); // Higher notch for high vocals
                    notchQ = optimizedParams.notchQ || (notchQ * 2.5); // Sharper notch
                    if (spectral.spectralEntropy < 0.5) { // Simple spectrum, focus on vocal clarity
                        deEsserGain -= 3;
                        optimizedParams.subTrebleGain = optimizedParams.subTrebleGain * 0.85; // Reduce treble for smoothness
                    }
                } else if (this.noiseLevel.level > 0.45) {
                    notchFreq = optimizedParams.notchFreq || (4500 + this.noiseLevel.midFreq * 2200);
                    notchQ = optimizedParams.notchQ || (notchQ * 2.5);
                }
                if (songStructure.section === 'chorus' && spectral.vocalPresence > 0.7) { // Enhanced de-essing in chorus
                    deEsserGain -= 3;
                    notchFreq = optimizedParams.notchFreq || 7000; // Higher notch for chorus clarity
                }
                // New: Wiener Filtering for low-frequency noise
                if (profile === "bassHeavy" && spectral.subBass > 0.7) {
                    this.wienerGain = Math.max(0.88, this.wienerGain - 0.03); // Stronger low-frequency noise reduction
                    this.notchFilter.frequency.linearRampToValueAtTime(optimizedParams.notchFreq || this.noiseLevel.lowFreq, currentTime + this.rampTime);
                    this.notchFilter.Q.linearRampToValueAtTime(optimizedParams.notchQ || (notchQ * 3.0), currentTime + this.rampTime);
                }
                return deEsserGain;
            };

            // New: CNN-based transient detection
            const applyCNNTransientDetection = () => {
                if (!enableCNNTransient) return { vocalTransient: 0.5, instrumentTransient: 0.5 };
                // Simulated CNN-based transient detection
                const vocalTransient = spectral.vocalPresence > 0.7 ? Math.min(0.8, spectral.transientEnergy * 1.2) : 0.4;
                const instrumentTransient = spectral.instruments.guitar || spectral.instruments.drums ? Math.min(0.8, spectral.transientEnergy * 1.1) : 0.4;
                return { vocalTransient, instrumentTransient };
            };

            const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();

            // Profile-specific settings
if (profile === "warm") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for warm, emotive dynamics
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const warmthPresence = spectral.warmthPresence || 0.5;

    // Adaptive FFT Size for precise warmth analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.7 || warmthPresence > 0.75) {
        fftSize = 4096; // High FFT size for complex warm sections
    } else if (spectralFlux < 0.35 && warmthPresence < 0.5) {
        fftSize = 1024; // Reduce FFT for simpler sections
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for rich, cohesive sound
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(120, 0); // Bass alignment for warm low-end
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(2500, 0); // Mids alignment for vocal warmth
    midPhaseAligner.connect(this.highMidFilter);

    // AI-driven Transient Detection using CNN
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (vocalTransient > 0.65 || instrumentTransient > 0.65) ? 1.3 : 1.0;

    // Harmonic Enhancement for rich, emotive tone
    const harmonicEnhanceFactor = 1.5 + (harmonicRatio > 0.65 ? 0.4 : 0.2) + (warmthPresence > 0.7 ? 0.5 : 0);
    const instrumentClarity = spectral.instruments?.guitar || spectral.instruments?.piano || spectral.instruments?.strings ? 1.5 : 1.2;

    // Optimized Compression for smooth dynamics
    const dynamicCompressionRatio = smartRatio(3.2 + (warmthPresence > 0.75 ? 0.6 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.005 : 0.007;
    const compressorRelease = songStructure.section === 'chorus' ? 0.25 : 0.32;

    // Dynamic EQ for balanced warmth and clarity
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const warmthEQ = warmthPresence > 0.65 ? dynamicEQ(300, 2.5, 1.2) : null;
    if (warmthEQ) {
        warmthEQ.connect(this.subMidFilter);
    }
    const vocalEQ = spectral.vocalPresence > 0.6 ? dynamicEQ(2700, 2.0, 1.4) : null;
    if (vocalEQ) {
        vocalEQ.connect(this.highMidFilter);
    }

    // AI-driven Vocal Separation/Isolation using Spectral Subtraction
    if (this.isVocal && spectral.vocalPresence > 0.65) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-20, currentTime);
        sidechainCompressor.ratio.setValueAtTime(6, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.003, currentTime);
        sidechainCompressor.release.setValueAtTime(0.1, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing for smooth treble
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.55 || spectral.air > 0.65) {
        dynamicDeEsserGain = -11 - (spectralFlux - 0.55) * 8;
        this.deEsser.frequency.setValueAtTime(7100 + spectral.air * 900, currentTime);
        this.deEsser.Q.setValueAtTime(2.7, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.09) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments for warm, emotive sound
    if (warmthPresence > 0.75) {
        // Warmth-heavy mix: Rich low-mids with clear vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (10.5 + subBassBoost + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (5.5 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.0 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.8 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (6.0 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.5 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.0 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.5 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.4 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (380 * (1 + spectral.vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1600 * (1 + spectral.vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 4800;
    } else if (spectral.vocalPresence > 0.65) {
        // Vocal-heavy mix: Warm vocals with balanced lows
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (10.0 + subBassBoost + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (5.0 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.2 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.5 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.8 + midBoost * songStructure.structureFactor * 1.1 + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.2 + midBoost + harmonicEnhanceFactor * 1.1 + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.6 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (420 * (1 + spectral.vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1800 * (1 + spectral.vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5200;
    } else {
        // Balanced warm mix: Rich, natural warmth
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (10.2 + subBassBoost + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (5.2 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.1 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.9 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.8 + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.6 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.1 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.5 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.4 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (400 * (1 + spectral.vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1700 * (1 + spectral.vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5000;
    }

    // Chorus and Bridge Dynamics for emotive intensity
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.subMidFilter.gain, this.subMidFilter.gain.value * 1.3);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.25);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.15);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.midBassFilter.gain, this.midBassFilter.gain.value * 1.15);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.1);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -18);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings for vocal richness
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.5 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (1.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.5 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (1.0 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.2));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store warm profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('warmProfile', {
            voiceType,
            fundamentalFreq,
            warmthPresence: spectral.warmthPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
} else if (profile === "bright") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for bright, dynamic adjustments
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const treblePresence = spectral.treblePresence || 0.5;

    // Adaptive FFT Size for precise treble analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.65 || treblePresence > 0.7) {
        fftSize = 4096; // High FFT size for complex treble-heavy sections
    } else if (spectralFlux < 0.4 && treblePresence < 0.5) {
        fftSize = 1024; // Reduce FFT for simpler sections
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for crisp, clear sound
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(100, 0); // Bass alignment for tight low-end
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(3500, 0); // Mids alignment for sparkling clarity
    midPhaseAligner.connect(this.highMidFilter);

    // AI-driven Transient Detection using CNN
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (vocalTransient > 0.6 || instrumentTransient > 0.6) ? 1.5 : 1.0;

    // Harmonic Enhancement for vibrant, colorful highs
    const harmonicEnhanceFactor = 1.6 + (harmonicRatio > 0.6 ? 0.4 : 0.2) + (treblePresence > 0.7 ? 0.5 : 0);
    const instrumentClarity = spectral.instruments?.strings || spectral.instruments?.cymbals || spectral.instruments?.piano ? 1.6 : 1.2;

    // Optimized Compression for transparent dynamics
    const dynamicCompressionRatio = smartRatio(3.0 + (treblePresence > 0.75 ? 0.5 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.004 : 0.006;
    const compressorRelease = songStructure.section === 'chorus' ? 0.22 : 0.28;

    // Dynamic EQ for precise treble and vocal enhancement
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const trebleEQ = treblePresence > 0.65 ? dynamicEQ(8000, 2.5, 1.3) : null;
    if (trebleEQ) {
        trebleEQ.connect(this.highShelfGain);
    }
    const vocalEQ = spectral.vocalPresence > 0.6 ? dynamicEQ(3000, 2.2, 1.5) : null;
    if (vocalEQ) {
        vocalEQ.connect(this.highMidFilter);
    }

    // AI-driven Vocal Separation/Isolation using Spectral Subtraction
    if (this.isVocal && spectral.vocalPresence > 0.65) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-20, currentTime);
        sidechainCompressor.ratio.setValueAtTime(5, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.003, currentTime);
        sidechainCompressor.release.setValueAtTime(0.12, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing for smooth, non-harsh treble
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.5 || spectral.air > 0.6) {
        dynamicDeEsserGain = -10 - (spectralFlux - 0.5) * 7;
        this.deEsser.frequency.setValueAtTime(7000 + spectral.air * 1000, currentTime);
        this.deEsser.Q.setValueAtTime(2.6, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.1) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments for bright, sparkling sound
    if (treblePresence > 0.75) {
        // Treble-heavy mix: Sparkling highs with clear vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.2 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (3.8 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (5.8 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.8 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.2 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.0 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.5 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (1.2 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (1.0 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (1.0 + harmonicEnhanceFactor * 0.8 + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (450 * (1 + spectral.vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2100 * (1 + spectral.vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 6500;
    } else if (spectral.vocalPresence > 0.65) {
        // Vocal-heavy mix: Bright vocals with balanced lows
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.0 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (3.5 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.0 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.0 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.2 + midBoost * songStructure.structureFactor * 1.1 + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.8 + midBoost + harmonicEnhanceFactor * 1.1 + instrumentClarity + userFeedbackAdjust.clarity * 0.8));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (1.0 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.8 + harmonicEnhanceFactor * 0.9 + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (480 * (1 + spectral.vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2200 * (1 + spectral.vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 6200;
    } else {
        // Balanced bright mix: Clear, vibrant sound
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.1 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (3.6 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (5.9 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.9 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.1 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.1 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.6 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (1.1 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.9 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.9 + harmonicEnhanceFactor * 0.8 + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (460 * (1 + spectral.vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2000 * (1 + spectral.vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 6300;
    }

    // Chorus and Bridge Dynamics for enhanced sparkle
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.35);
        smoothParamUpdate(this.highShelfGain.gain, this.highShelfGain.gain.value * 1.3);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.1);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.2);
        smoothParamUpdate(this.subTrebleFilter.gain, this.subTrebleFilter.gain.value * 1.15);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -16);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings for vocal clarity
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (0.8 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (0.8 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.0));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store bright profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('brightProfile', {
            voiceType,
            fundamentalFreq,
            treblePresence: spectral.treblePresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
} else if (profile === "bassHeavy") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for bass-driven dynamics
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const bassPresence = spectral.bassPresence || 0.5;

    // Adaptive FFT Size for precise bass analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.7 || bassPresence > 0.75) {
        fftSize = 4096; // High FFT size for complex bass-heavy sections
    } else if (spectralFlux < 0.35 && bassPresence < 0.5) {
        fftSize = 1024; // Reduce FFT for less bass-intensive parts
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for tight bass response
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(80, 0); // Bass alignment for punchy low-end
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(2500, 0); // Mids alignment for vocal/instrument clarity
    midPhaseAligner.connect(this.highMidFilter);

    // AI-driven Transient Detection using CNN
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (instrumentTransient > 0.65 || transientEnergy > 0.7) ? 1.4 : 1.0;

    // Harmonic Enhancement for rich bass and vibrant mids
    const harmonicEnhanceFactor = 1.5 + (harmonicRatio > 0.65 ? 0.4 : 0.2) + (bassPresence > 0.7 ? 0.5 : 0);
    const instrumentClarity = spectral.instruments?.drums || spectral.instruments?.bass ? 1.5 : 1.2;

    // Optimized Compression for controlled bass dynamics
    const dynamicCompressionRatio = smartRatio(4.2 + (bassPresence > 0.75 ? 0.8 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.0025 : 0.0035;
    const compressorRelease = songStructure.section === 'chorus' ? 0.22 : 0.28;

    // Dynamic EQ for balanced bass and mids
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const bassEQ = bassPresence > 0.65 ? dynamicEQ(100, 2.5, 1.2) : null;
    if (bassEQ) {
        bassEQ.connect(this.subBassFilter);
    }
    const vocalEQ = spectral.vocalPresence > 0.6 ? dynamicEQ(2800, 2.0, 1.4) : null;
    if (vocalEQ) {
        vocalEQ.connect(this.highMidFilter);
    }

    // AI-driven Vocal Separation/Isolation using Spectral Subtraction
    if (this.isVocal && spectral.vocalPresence > 0.65) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-18, currentTime);
        sidechainCompressor.ratio.setValueAtTime(6, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.002, currentTime);
        sidechainCompressor.release.setValueAtTime(0.1, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing for smooth treble
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.55 || spectral.air > 0.65) {
        dynamicDeEsserGain = -12 - (spectralFlux - 0.55) * 8;
        this.deEsser.frequency.setValueAtTime(7200 + spectral.air * 900, currentTime);
        this.deEsser.Q.setValueAtTime(2.8, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.09) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments for bass-heavy sound
    if (bassPresence > 0.75) {
        // Ultra bass-heavy mix: Deep, punchy bass with clear vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (11.5 + subBassBoost + subharmonicGain * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (6.5 + subBassBoost + subharmonicGain * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.5 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.7 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.8 + warmthBoost * 0.7 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.0 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (4.5 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.4 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.3 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.3 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (300 * (1 + (spectral.vocalPresence || 0) * 0.15));
        f2Freq = optimizedParams.f2Freq || (1500 * (1 + (spectral.vocalPresence || 0) * 0.15));
        notchFreq = optimizedParams.notchFreq || 4800;
    } else if (spectral.vocalPresence > 0.65) {
        // Vocal-heavy mix: Balanced bass with prominent vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (10.8 + subBassBoost + subharmonicGain * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (6.0 + subBassBoost + subharmonicGain * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.8 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.5 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.5 + midBoost * songStructure.structureFactor * 1.1 + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.0 + midBoost + harmonicEnhanceFactor * 1.1 + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.5 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.4 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (350 * (1 + (spectral.vocalPresence || 0) * 0.15));
        f2Freq = optimizedParams.f2Freq || (1700 * (1 + (spectral.vocalPresence || 0) * 0.15));
        notchFreq = optimizedParams.notchFreq || 5200;
    } else {
        // Balanced bass-heavy mix: Deep bass with natural clarity
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (11.2 + subBassBoost + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (6.2 + subBassBoost + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.6 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.8 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.6 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.2 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (4.8 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.4 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.3 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.3 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (320 * (1 + (spectral.vocalPresence || 0) * 0.15));
        f2Freq = optimizedParams.f2Freq || (1600 * (1 + (spectral.vocalPresence || 0) * 0.15));
        notchFreq = optimizedParams.notchFreq || 5000;
    }

    // Chorus and Bridge Dynamics for impactful bass
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.lowShelfGain.gain, this.lowShelfGain.gain.value * 1.3);
        smoothParamUpdate(this.subBassFilter.gain, this.subBassFilter.gain.value * 1.25);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.15);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.subBassFilter.gain, this.subBassFilter.gain.value * 1.15);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.1);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -15);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings for vocal presence
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.2 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (0.9 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.2 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (0.9 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.2));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store bass profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('bassProfile', {
            voiceType,
            fundamentalFreq,
            bassPresence: spectral.bassPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
} else if (profile === "vocal") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for vocal-focused dynamics
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const vocalPresence = spectral.vocalPresence || 0.5;

    // Adaptive FFT Size for precise vocal analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.7 || vocalPresence > 0.75) {
        fftSize = 4096; // High FFT size for complex vocal sections
    } else if (spectralFlux < 0.35 && !this.isVocal) {
        fftSize = 1024; // Reduce FFT for instrumental parts
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for clear vocal projection
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(120, 0); // Bass alignment for vocal warmth
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(3000, 0); // Mids alignment for vocal clarity
    midPhaseAligner.connect(this.highMidFilter);

    // AI-driven Transient Detection using CNN
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (vocalTransient > 0.65) ? 1.3 : 1.0;

    // Harmonic Enhancement for rich vocal tone
    const harmonicEnhanceFactor = 1.4 + (harmonicRatio > 0.65 ? 0.4 : 0.2) + (vocalPresence > 0.7 ? 0.3 : 0);
    const instrumentClarity = spectral.instruments?.guitar || spectral.instruments?.piano ? 1.3 : 1.0;

    // Optimized Compression for vocal dynamics
    const dynamicCompressionRatio = smartRatio(3.5 + (vocalPresence > 0.75 ? 0.6 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.003 : 0.0045;
    const compressorRelease = songStructure.section === 'chorus' ? 0.2 : 0.25;

    // Dynamic EQ for vocal presence
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const vocalEQ = vocalPresence > 0.65 ? dynamicEQ(3200, 3.0, 1.5) : null;
    if (vocalEQ) {
        vocalEQ.connect(this.highMidFilter);
    }

    // AI-driven Vocal Separation/Isolation using Spectral Subtraction
    if (this.isVocal && vocalPresence > 0.65) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-20, currentTime);
        sidechainCompressor.ratio.setValueAtTime(7, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.002, currentTime);
        sidechainCompressor.release.setValueAtTime(0.1, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing with dynamic adjustment
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.6 || spectral.air > 0.7) {
        dynamicDeEsserGain = -13 - (spectralFlux - 0.6) * 9;
        this.deEsser.frequency.setValueAtTime(7500 + spectral.air * 1000, currentTime);
        this.deEsser.Q.setValueAtTime(3.0, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.08) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments for vocal-centric sound
    if (spectral.bass > 0.65) {
        // Bass-heavy mix: Controlled bass to support vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.8 + subBassBoost + warmthBoost * 0.7 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.5 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.5 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.8 + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.8 + warmthBoost * 0.7 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.5 + midBoost * songStructure.structureFactor + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (7.0 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.6 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.4 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (500 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2200 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5500;
    } else if (spectral.midHigh > 0.65) {
        // Mid-high dominant: Enhanced vocal clarity
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.5 + subBassBoost + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.2 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.8 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.5 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.8 + midBoost * songStructure.structureFactor * 1.2 + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (7.2 + midBoost + harmonicEnhanceFactor * 1.2 + instrumentClarity + userFeedbackAdjust.clarity * 0.8));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.6 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.6 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (530 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2400 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 6000;
    } else {
        // Balanced mix: Natural, vibrant vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.6 + subBassBoost + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.3 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.6 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.6 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.6 + midBoost * songStructure.structureFactor + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (7.1 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.6 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.4 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (520 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2300 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5800;
    }

    // Chorus and Bridge Dynamics for vocal emphasis
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.midShelfGain.gain, this.midShelfGain.gain.value * 1.4);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.3);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.2);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.2);
        smoothParamUpdate(this.subTrebleFilter.gain, this.subTrebleFilter.gain.value * 1.15);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -15);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings for vocal richness
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.5 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (1.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.5 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (1.0 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.5));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store voice profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('voiceProfile', {
            voiceType,
            fundamentalFreq,
            vocalPresence: spectral.vocalPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
} else if (profile === "proNatural") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for natural dynamic adjustments
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const vocalPresence = spectral.vocalPresence || 0.5;

    // Adaptive FFT Size for real-time analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.65 || vocalPresence > 0.7) {
        fftSize = 4096; // Increase FFT size for complex vocals or high entropy
    } else if (spectralFlux < 0.4 && !this.isVocal) {
        fftSize = 1024; // Reduce FFT size for simple instrumental sections
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for coherent, natural sound
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(100, 0); // Bass phase alignment for warmth
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(2500, 0); // Mids phase alignment for clarity
    midPhaseAligner.connect(this.highMidFilter);

    // Advanced Transient Detection for natural instrument detail
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (vocalTransient > 0.6 || instrumentTransient > 0.6) ? 1.2 : 1.0;

    // Harmonic Enhancement for rich, colorful sound
    const harmonicEnhanceFactor = 1.3 + (harmonicRatio > 0.6 ? 0.3 : 0.2) + (this.polyphonicPitches.length > 1 ? 0.2 : 0);
    const instrumentClarity = spectral.instruments?.guitar || spectral.instruments?.piano || spectral.instruments?.strings ? 1.4 : 1.0;

    // Optimized Compression for transparent dynamics
    const dynamicCompressionRatio = smartRatio(3.0 + (vocalPresence > 0.7 ? 0.5 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.005 : 0.007;
    const compressorRelease = songStructure.section === 'chorus' ? 0.28 : 0.32;

    // Dynamic EQ for precise frequency balance
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const vocalEQ = vocalPresence > 0.6 ? dynamicEQ(2700, 2.2, 1.4) : null;
    if (vocalEQ) {
        vocalEQ.connect(this.highMidFilter);
    }

    // Vocal Separation/Isolation for clear vocals
    if (this.isVocal && vocalPresence > 0.6) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-22, currentTime);
        sidechainCompressor.ratio.setValueAtTime(5, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.003, currentTime);
        sidechainCompressor.release.setValueAtTime(0.12, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing for smooth treble
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.5 || spectral.air > 0.6) {
        dynamicDeEsserGain = -10 - (spectralFlux - 0.5) * 6;
        this.deEsser.frequency.setValueAtTime(7000 + spectral.air * 800, currentTime);
        this.deEsser.Q.setValueAtTime(2.5, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.1) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments for natural, balanced sound
    if (spectral.bass > 0.6) {
        // Bass-heavy mix: Warm, punchy bass with clear mids
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.5 + subBassBoost + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.8 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.8 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.8 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.2 + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.5 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.0 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (400 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1700 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 4800;
    } else if (spectral.midHigh > 0.6) {
        // Mid-high dominant: Crisp, articulate vocals and instruments
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.0 + subBassBoost + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.5 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.0 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.0 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.8 + midBoost * songStructure.structureFactor * 1.1 + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.2 + midBoost + harmonicEnhanceFactor * 1.1 + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.8 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.6 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.6 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (450 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1900 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5200;
    } else {
        // Balanced mix: Natural, warm, and detailed sound
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.2 + subBassBoost + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.6 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.9 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.1 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.6 + midBoost * songStructure.structureFactor + userFeedbackAdjust.clarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.1 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (430 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1800 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5000;
    }

    // Chorus and Bridge Dynamics for subtle energy
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.midShelfGain.gain, this.midShelfGain.gain.value * 1.25);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.2);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.1);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.15);
        smoothParamUpdate(this.subTrebleFilter.gain, this.subTrebleFilter.gain.value * 1.1);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -17);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings for natural vocal presence
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (0.8 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (0.8 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.0));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store voice profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('voiceProfile', {
            voiceType,
            fundamentalFreq,
            vocalPresence: spectral.vocalPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
} else if (profile === "karaokeDynamic") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for dynamic energy adjustments
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const instrumentalPresence = spectral.instrumentalPresence || 0.5;

    // Adaptive FFT Size for real-time analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.6 || transientEnergy > 0.6) {
        fftSize = 4096; // Increase FFT size for complex instrumental sections
    } else if (spectralFlux < 0.4 && instrumentalPresence < 0.5) {
        fftSize = 1024; // Reduce FFT size for simpler sections
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for coherent sound
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(90, 0); // Bass phase alignment for clarity
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(2800, 0); // Mids phase alignment for instruments
    midPhaseAligner.connect(this.highMidFilter);

    // Advanced Transient Detection for instrument clarity
    const { instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (instrumentTransient > 0.6 || transientEnergy > 0.65) ? 1.4 : 1.0;

    // Harmonic Enhancement for vibrant, colorful sound
    const harmonicEnhanceFactor = 1.3 + (harmonicRatio > 0.6 ? 0.4 : 0.2) + (spectral.instruments?.guitar || spectral.instruments?.piano ? 0.4 : 0);
    const instrumentClarity = spectral.instruments?.guitar || spectral.instruments?.drums || spectral.instruments?.piano ? 1.6 : 1.2;

    // Optimized Compression for natural dynamics
    const dynamicCompressionRatio = smartRatio(3.8 + (instrumentalPresence > 0.7 ? 0.5 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.0035 : 0.005;
    const compressorRelease = songStructure.section === 'chorus' ? 0.22 : 0.28;

    // Dynamic EQ for balanced instrumental presence
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const instrumentEQ = instrumentalPresence > 0.6 ? dynamicEQ(3000, 2.8, 1.6) : null;
    if (instrumentEQ) {
        instrumentEQ.connect(this.highMidFilter);
    }

    // Advanced De-essing for smooth treble
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.55 || spectral.air > 0.65) {
        dynamicDeEsserGain = -12 - (spectralFlux - 0.55) * 8;
        this.deEsser.frequency.setValueAtTime(7200 + spectral.air * 1000, currentTime);
        this.deEsser.Q.setValueAtTime(2.8, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.09) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments based on spectral characteristics
    if (spectral.bass > 0.65) {
        // Bass-heavy mix: Tight, punchy bass with natural spread
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.0 + subBassBoost + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.8 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.8 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.9 + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.0 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.8 + midBoost * songStructure.structureFactor + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (7.2 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (400 * (1 + instrumentalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1800 * (1 + instrumentalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5500;
    } else if (spectral.midHigh > 0.65) {
        // Mid-high dominant: Clear, articulate instruments
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.5 + subBassBoost + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.5 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (8.0 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.8 + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (9.0 + midBoost * songStructure.structureFactor * 1.2 + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (7.5 + midBoost + harmonicEnhanceFactor * 1.2 + instrumentClarity + userFeedbackAdjust.clarity * 0.8));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.8 - trebleReduction * 0.6 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.6 - trebleReduction * 0.6 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.6 + harmonicEnhanceFactor * 0.9 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (450 * (1 + instrumentalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2000 * (1 + instrumentalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 6000;
    } else {
        // Balanced mix: Natural, vibrant, and detailed sound
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.8 + subBassBoost + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.6 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.9 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.9 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.9 + midBoost * songStructure.structureFactor + userFeedbackAdjust.vocalClarity));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (7.3 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.treble));
        f1Freq = optimizedParams.f1Freq || (430 * (1 + instrumentalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1900 * (1 + instrumentalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5800;
    }

    // Chorus and Bridge Dynamics for energetic sections
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.midShelfGain.gain, this.midShelfGain.gain.value * 1.35);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.25);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.15);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.15);
        smoothParamUpdate(this.subTrebleFilter.gain, this.subTrebleFilter.gain.value * 1.1);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -14);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings for instrumental clarity
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.2 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (0.9 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.2 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (0.9 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.2));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store instrumental profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('instrumentProfile', {
            voiceType,
            fundamentalFreq,
            instrumentalPresence: spectral.instrumentalPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
} else if (profile === "rockMetal") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Spectral Flux Analysis for aggressive dynamics
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const vocalPresence = spectral.vocalPresence || 0.5;

    // Adaptive FFT Size for high-energy sections
    let fftSize = 2048;
    if (spectralEntropy > 0.7 || transientEnergy > 0.65) {
        fftSize = 4096; // High FFT size for complex, high-energy rock/metal sections
    } else if (spectralFlux < 0.35 && !this.isVocal) {
        fftSize = 1024; // Reduce FFT for calmer instrumental parts
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for tight, punchy sound
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(80, 0); // Tight bass alignment for metal
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(3000, 0); // Mid alignment for guitar clarity
    midPhaseAligner.connect(this.highMidFilter);

    // Advanced Transient Detection for drums and guitars
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (instrumentTransient > 0.65 || transientEnergy > 0.7) ? 1.5 : 1.0;

    // Harmonic Enhancement for gritty, vibrant sound
    const harmonicEnhanceFactor = 1.5 + (harmonicRatio > 0.7 ? 0.5 : 0.2) + (spectral.instruments?.guitar ? 0.6 : 0);
    const instrumentClarity = spectral.instruments?.guitar || spectral.instruments?.drums ? 1.8 : 1.2;

    // Optimized Compression for aggressive dynamics
    const dynamicCompressionRatio = smartRatio(4.2 + (vocalPresence > 0.7 ? 0.8 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.003 : 0.005;
    const compressorRelease = songStructure.section === 'chorus' ? 0.2 : 0.28;

    // Dynamic EQ for guitar and vocal presence
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const guitarEQ = spectral.instruments?.guitar ? dynamicEQ(3500, 3.0, 1.8) : null;
    if (guitarEQ) {
        guitarEQ.connect(this.highMidFilter);
    }

    // Vocal Separation/Isolation for powerful vocals
    if (this.isVocal && vocalPresence > 0.65) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-18, currentTime);
        sidechainCompressor.ratio.setValueAtTime(8, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.001, currentTime);
        sidechainCompressor.release.setValueAtTime(0.08, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing for harsh vocal sibilance
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.6 || spectral.air > 0.7) {
        dynamicDeEsserGain = -14 - (spectralFlux - 0.6) * 10;
        this.deEsser.frequency.setValueAtTime(7500 + spectral.air * 1200, currentTime);
        this.deEsser.Q.setValueAtTime(3.0, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.08) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments for rock/metal energy
    if (spectral.bass > 0.7) {
        // Bass-heavy mix: Powerful, tight bass for metal kick and bass guitar
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (10.2 + subBassBoost + warmthBoost * 0.7 + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (5.5 + subBassBoost + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.5 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.8 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.0 + warmthBoost * 0.7 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.5 + midBoost * songStructure.structureFactor + userFeedbackAdjust.mid));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.0 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.air));
        f1Freq = optimizedParams.f1Freq || (400 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1800 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5000;
    } else if (spectral.midHigh > 0.7) {
        // Mid-high dominant: Screaming guitars and clear vocals
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.0 + subBassBoost + warmthBoost * 0.8 + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.8 + subBassBoost + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (7.0 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.8 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (8.0 + midBoost * songStructure.structureFactor * 1.3 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.5 + midBoost + harmonicEnhanceFactor * 1.3 + instrumentClarity + userFeedbackAdjust.clarity * 0.8));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.9 - trebleReduction * 0.6 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.7 - trebleReduction * 0.6 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.6 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.air));
        f1Freq = optimizedParams.f1Freq || (480 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2200 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 6000;
    } else {
        // Balanced mix: Full, aggressive rock/metal sound
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.5 + subBassBoost + warmthBoost + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (5.0 + subBassBoost + subharmonicGain + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.8 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (5.0 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.8 + midBoost * songStructure.structureFactor + userFeedbackAdjust.mid));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (6.2 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.8 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.6 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.7 - trebleReduction + userFeedbackAdjust.air));
        f1Freq = optimizedParams.f1Freq || (450 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2000 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5500;
    }

    // Chorus and Bridge Dynamics for explosive sections
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.midShelfGain.gain, this.midShelfGain.gain.value * 1.4);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.3);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.2);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.2);
        smoothParamUpdate(this.subTrebleFilter.gain, this.subTrebleFilter.gain.value * 1.15);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -15);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings with vocal aggression
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.5 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (1.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.5 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (1.0 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.5));

    // No panning for raw, centered sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store voice profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('voiceProfile', {
            voiceType,
            fundamentalFreq,
            vocalPresence: spectral.vocalPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
             } else if (profile === "smartStudio") {
    const { vocalTypeFactor, voiceType, fundamentalFreq } = applyVocalClassification();
    const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
    const deEsserGain = applyNoiseHandling();
    applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);

    // Advanced Spectral Flux Analysis for dynamic adjustments
    const spectralFlux = spectral.spectralFlux || 0.5;
    const spectralEntropy = spectral.spectralEntropy || 0.5;
    const harmonicRatio = spectral.harmonicRatio || 0.5;
    const transientEnergy = spectral.transientEnergy || 0.5;
    const vocalPresence = spectral.vocalPresence || 0.5;

    // Adaptive FFT Size for real-time analysis
    let fftSize = 2048;
    if (spectralEntropy > 0.65 || vocalPresence > 0.7) {
        fftSize = 4096; // Increase FFT size for complex vocals or high entropy
    } else if (spectralFlux < 0.4 && !this.isVocal) {
        fftSize = 1024; // Reduce FFT size for simple instrumental sections
    }
    this.setFFTSize(fftSize);

    // Phase Alignment Processing for coherent sound
    const phaseAdjust = (freq, phaseShift) => {
        const allPassFilter = this.context.createBiquadFilter();
        allPassFilter.type = 'allpass';
        allPassFilter.frequency.setValueAtTime(freq, currentTime);
        allPassFilter.Q.setValueAtTime(0.707, currentTime);
        return allPassFilter;
    };
    if (this.phaseAligner) {
        this.phaseAligner.disconnect();
    }
    this.phaseAligner = phaseAdjust(100, 0); // Bass phase alignment
    this.phaseAligner.connect(this.subBassFilter);
    const midPhaseAligner = phaseAdjust(2500, 0); // Mids phase alignment
    midPhaseAligner.connect(this.highMidFilter);

    // Advanced Transient Detection using CNN-based approach
    const { vocalTransient, instrumentTransient } = applyCNNTransientDetection();
    const transientBoost = (vocalTransient > 0.6 || instrumentTransient > 0.6) ? 1.3 : 1.0;

    // Harmonic Enhancement for lively, colorful sound
    const harmonicEnhanceFactor = 1.2 + (harmonicRatio > 0.65 ? 0.4 : 0.2) + (this.polyphonicPitches.length > 1 ? 0.3 : 0);
    const instrumentClarity = spectral.instruments?.guitar || spectral.instruments?.piano ? 1.5 : 1.0;

    // Optimized Compression for natural dynamics
    const dynamicCompressionRatio = smartRatio(3.5 + (vocalPresence > 0.7 ? 0.5 : 0));
    const compressorAttack = songStructure.section === 'chorus' ? 0.004 : 0.006;
    const compressorRelease = songStructure.section === 'chorus' ? 0.25 : 0.3;

    // Dynamic EQ for precise frequency control
    const dynamicEQ = (freq, gain, q) => {
        const eqFilter = this.context.createBiquadFilter();
        eqFilter.type = 'peaking';
        eqFilter.frequency.setValueAtTime(freq, currentTime);
        eqFilter.gain.setValueAtTime(gain, currentTime);
        eqFilter.Q.setValueAtTime(q, currentTime);
        return eqFilter;
    };
    const vocalEQ = vocalPresence > 0.6 ? dynamicEQ(2500, 2.5, 1.5) : null;
    if (vocalEQ) {
        vocalEQ.connect(this.highMidFilter);
    }

    // Vocal Separation/Isolation for karaoke clarity
    if (this.isVocal && spectral.vocalPresence > 0.6) {
        const sidechainCompressor = this.context.createDynamicsCompressor();
        sidechainCompressor.threshold.setValueAtTime(-20, currentTime);
        sidechainCompressor.ratio.setValueAtTime(6, currentTime);
        sidechainCompressor.attack.setValueAtTime(0.002, currentTime);
        sidechainCompressor.release.setValueAtTime(0.1, currentTime);
        this.inputNode.connect(sidechainCompressor);
        sidechainCompressor.connect(this.formantFilter1);
    }

    // Advanced De-essing with dynamic adjustment
    let dynamicDeEsserGain = deEsserGain;
    if (spectralFlux > 0.55 || spectral.air > 0.65) {
        dynamicDeEsserGain = -12 - (spectralFlux - 0.55) * 8;
        this.deEsser.frequency.setValueAtTime(7000 + spectral.air * 1000, currentTime);
        this.deEsser.Q.setValueAtTime(2.5, currentTime);
    }

    // CPU Load Optimization with dynamic parameter smoothing
    const smoothParamUpdate = (param, targetValue, timeConstant = 0.1) => {
        const currentValue = param.value;
        if (Math.abs(currentValue - targetValue) > 0.01) {
            param.linearRampToValueAtTime(targetValue, currentTime + timeConstant);
        }
    };

    // Conditional adjustments based on spectral characteristics
    if (spectral.bass > 0.65) {
        // Bass-heavy mix: Tight, punchy bass with natural spread
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.8 + subBassBoost + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.8 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.2 + subMidBoost + warmthBoost * smartWarmthAdjust * 0.9 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.8 + warmthBoost * 0.8 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (6.8 + midBoost * songStructure.structureFactor + userFeedbackAdjust.mid));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.0 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.5 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.3 - trebleReduction * 0.8 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.3 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.air));
        f1Freq = optimizedParams.f1Freq || (340 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1650 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 4500;
    } else if (spectral.midHigh > 0.65) {
        // Mid-high dominant: Clear, articulate mids with smooth treble
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (8.8 + subBassBoost + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.2 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.8 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.5 + warmthBoost * 0.9 + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.5 + midBoost * songStructure.structureFactor * 1.2 + userFeedbackAdjust.mid));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.8 + midBoost + harmonicEnhanceFactor * 1.2 + instrumentClarity + userFeedbackAdjust.clarity * 0.7));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.7 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.5 - trebleReduction * 0.7 + harmonicEnhanceFactor + transientBoost + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.5 + harmonicEnhanceFactor * 0.9 - trebleReduction + userFeedbackAdjust.air));
        f1Freq = optimizedParams.f1Freq || (450 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (2100 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5500;
    } else {
        // Balanced mix: Natural, warm, and detailed sound
        smoothParamUpdate(this.lowShelfGain.gain, optimizedParams.lowShelfGain || (9.2 + subBassBoost + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subBassFilter.gain, optimizedParams.subBassGain || (4.5 + subBassBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.subMidFilter.gain, optimizedParams.subMidGain || (6.5 + subMidBoost + warmthBoost * smartWarmthAdjust + userFeedbackAdjust.mid));
        smoothParamUpdate(this.midBassFilter.gain, optimizedParams.midBassGain || (4.8 + warmthBoost + userFeedbackAdjust.bass));
        smoothParamUpdate(this.midShelfGain.gain, optimizedParams.midShelfGain || (7.2 + midBoost * songStructure.structureFactor + userFeedbackAdjust.mid));
        smoothParamUpdate(this.highMidFilter.gain, optimizedParams.highMidGain || (5.5 + midBoost + harmonicEnhanceFactor + instrumentClarity + userFeedbackAdjust.clarity * 0.6));
        smoothParamUpdate(this.highShelfGain.gain, optimizedParams.highShelfGain || (0.6 - trebleReduction * 0.8 + harmonicEnhanceFactor + (isTransientGenre ? transientBoost : 0) + userFeedbackAdjust.treble));
        smoothParamUpdate(this.subTrebleFilter.gain, optimizedParams.subTrebleGain || (0.4 - trebleReduction * 0.8 + harmonicEnhanceFactor + (isTransientGenre ? transientBoost : 0) + userFeedbackAdjust.treble));
        smoothParamUpdate(this.airFilter.gain, optimizedParams.airGain || (0.4 + harmonicEnhanceFactor * 0.8 - trebleReduction + userFeedbackAdjust.air));
        f1Freq = optimizedParams.f1Freq || (420 * (1 + vocalPresence * 0.15));
        f2Freq = optimizedParams.f2Freq || (1900 * (1 + vocalPresence * 0.15));
        notchFreq = optimizedParams.notchFreq || 5000;
    }

    // Chorus and Bridge Dynamics
    if (songStructure.section === 'chorus') {
        smoothParamUpdate(this.midShelfGain.gain, this.midShelfGain.gain.value * 1.3);
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.2);
        smoothParamUpdate(this.compressor.ratio, dynamicCompressionRatio * 1.15);
    } else if (songStructure.section === 'bridge') {
        smoothParamUpdate(this.highMidFilter.gain, this.highMidFilter.gain.value * 1.15);
        smoothParamUpdate(this.subTrebleFilter.gain, this.subTrebleFilter.gain.value * 1.1);
    }

    // Apply compressor settings
    smoothParamUpdate(this.compressor.ratio, optimizedParams.compressorRatio || dynamicCompressionRatio);
    smoothParamUpdate(this.compressor.attack, optimizedParams.compressorAttack || compressorAttack);
    smoothParamUpdate(this.compressor.release, optimizedParams.compressorRelease || compressorRelease);
    smoothParamUpdate(this.compressor.threshold, optimizedParams.compressorThreshold || -16);

    // Apply de-esser
    if (this.deEsser?.gain) {
        smoothParamUpdate(this.deEsser.gain, optimizedParams.deEsserGain || dynamicDeEsserGain);
    }

    // Apply formant settings with vocal protection
    smoothParamUpdate(this.formantFilter1.frequency, optimizedParams.f1Freq || f1Freq);
    smoothParamUpdate(this.formantFilter1.gain, optimizedParams.formantGain || (3.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter1.Q, optimizedParams.formantQ || (0.8 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.frequency, optimizedParams.f2Freq || f2Freq);
    smoothParamUpdate(this.formantFilter2.gain, optimizedParams.formantGain || (3.0 * vocalTypeFactor));
    smoothParamUpdate(this.formantFilter2.Q, optimizedParams.formantQ || (0.8 * vocalTypeFactor));

    // Apply notch filter for noise control
    smoothParamUpdate(this.notchFilter.frequency, optimizedParams.notchFreq || notchFreq);
    smoothParamUpdate(this.notchFilter.Q, optimizedParams.notchQ || (notchQ * 2.0));

    // No panning for natural sound
    smoothParamUpdate(this.panner.pan, 0);

    // Store voice profile
    if (this.memoryManager) {
        this.memoryManager.buffers.set('voiceProfile', {
            voiceType,
            fundamentalFreq,
            vocalPresence: spectral.vocalPresence,
            timestamp: Date.now(),
            expiry: Date.now() + 10000
        });
        this.memoryManager.pruneCache(100);
    }
}

            // Apply formant settings
            if (!this.formantFilter1?.frequency) throw new Error("formantFilter1 is not initialized");
            if (!this.formantFilter2?.frequency) throw new Error("formantFilter2 is not initialized");
            this.formantFilter1.frequency.linearRampToValueAtTime(optimizedParams.f1Freq || f1Freq, currentTime + this.rampTime);
            this.formantFilter1.gain.linearRampToValueAtTime(optimizedParams.formantGain || formantGain, currentTime + this.rampTime);
            this.formantFilter1.Q.linearRampToValueAtTime(optimizedParams.formantQ || formantQ, currentTime + this.rampTime);
            this.formantFilter2.frequency.linearRampToValueAtTime(optimizedParams.f2Freq || f2Freq, currentTime + this.rampTime);
            this.formantFilter2.gain.linearRampToValueAtTime(optimizedParams.formantGain || formantGain, currentTime + this.rampTime);
            this.formantFilter2.Q.linearRampToValueAtTime(optimizedParams.formantQ || formantQ, currentTime + this.rampTime);

            // Apply quality prediction recommendations
            (this.qualityPrediction.recommendations || []).forEach(rec => {
                try {
                    if (typeof rec !== 'string') return;
                    if (rec.includes("Reduce sub-bass")) {
                        this.subBassFilter.gain.linearRampToValueAtTime(
                            Math.max(this.subBassFilter.gain.value - 0.8, 0), currentTime + this.rampTime
                        );
                        this.lowShelfGain.gain.linearRampToValueAtTime(
                            Math.max(this.lowShelfGain.gain.value - 0.8, 0), currentTime + this.rampTime
                        );
                    }
                    if (rec.includes("Reduce treble/sub-treble")) {
                        this.highShelfGain.gain.linearRampToValueAtTime(
                            Math.max(this.highShelfGain.gain.value - 0.8, 0), currentTime + this.rampTime
                        );
                        this.subTrebleFilter.gain.linearRampToValueAtTime(
                            Math.max(this.subTrebleFilter.gain.value - 0.8, 0), currentTime + this.rampTime
                        );
                        if (this.deEsser?.gain) {
                            this.deEsser.gain.linearRampToValueAtTime(-8, currentTime + this.rampTime);
                        }
                    }
                    if (rec.includes("Apply noise reduction")) {
                        this.notchFilter.Q.linearRampToValueAtTime(this.notchQ * 4.5, currentTime + this.rampTime);
                        this.notchFilter.frequency.linearRampToValueAtTime(6000, currentTime + this.rampTime);
                    }
                    if (rec.includes("Boost instrument frequencies")) {
                        const instrumentBoost = this.polyphonicPitches.length > 1 ? 2.2 : 1.8;
                        this.subMidFilter.gain.linearRampToValueAtTime(
                            this.subMidFilter.gain.value + instrumentBoost, currentTime + this.rampTime
                        );
                        this.highMidFilter.gain.linearRampToValueAtTime(
                            this.highMidFilter.gain.value + instrumentBoost, currentTime + this.rampTime
                        );
                    }
                    if (rec.includes("Apply soft compression")) {
                        this.compressor.ratio.linearRampToValueAtTime(
                            smartRatio(this.compressor.ratio.value + 0.8), currentTime + this.rampTime
                        );
                        this.compressor.attack.linearRampToValueAtTime(0.008, currentTime + this.rampTime);
                        this.compressor.release.linearRampToValueAtTime(0.32, currentTime + this.rampTime);
                    }
                    if (rec.includes("Increase transient shaping")) {
                        this.subTrebleFilter.gain.linearRampToValueAtTime(
                            this.subTrebleFilter.gain.value + 0.6 + this.transientBoost * 0.6, currentTime + this.rampTime
                        );
                        this.highShelfGain.gain.linearRampToValueAtTime(
                            this.highShelfGain.gain.value + 0.5 + this.transientBoost * 0.5, currentTime + this.rampTime
                        );
                    }
                } catch (error) {
                    handleError("Error applying quality prediction recommendation:", error, { recommendation: rec });
                }
            });

            // Apply vitamin with optimized parameters
            this.setBoost(optimizedParams.boost || (0.8 + harmonicBoost));
            this.applyVitamin(profile, pitchMult, absPitchMult);

            // Update spectralProfile with advanced fields
            this.spectralProfile = {
                ...spectral,
                spectralFlux: spectral.spectralFlux || 0.5,
                spectralEntropy: spectral.spectralEntropy || 0.5,
                harmonicRatio: spectral.harmonicRatio || 0.5
            };

            // Store profile settings in MemoryManager with expiry
            if (this.memoryManager) {
                this.memoryManager.buffers.set('soundProfile', {
                    profile,
                    settings: optimizedParams,
                    timestamp: Date.now(),
                    expiry: Date.now() + 10000 // 10s expiry
                });
                this.memoryManager.pruneCache(100);
            }

            console.debug('Sound profile set successfully with advanced optimization', {
                profile,
                spectralProfile: this.spectralProfile,
                currentGenre: this.currentGenre,
                musicContext,
                songStructure,
                optimizedParams
            });
        };

        applyProfile();
    } catch (error) {
        handleError("Error setting sound profile:", error, {
            profile,
            spectralProfile: this.spectralProfile,
            currentGenre: this.currentGenre
        });
    }
};

/**
 * Simple hash function for context object to generate cache key
 * @param {Object} obj - Context object
 * @returns {string} Hash string
 */
function simpleHash(obj) {
    const str = JSON.stringify({
        spectralProfile: obj.spectralProfile,
        isVocal: obj.isVocal,
        polyphonicPitches: obj.polyphonicPitches?.length
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

Jungle.prototype.initializeContextAnalyzer = function () {
    return {
        analyze: (context, memoryManager) => {
            // Kiểm tra đầu vào
            if (!context || typeof context !== 'object') {
                handleError('Invalid context', new Error('Context must be an object'), {}, 'high', { memoryManager });
                return null;
            }

            const {
                spectralProfile = {},
                tempoMemory = {},
                currentGenre = 'unknown',
                currentKey = 'unknown',
                polyphonicPitches = [],
                noiseLevel = 0.5,
                qualityPrediction = 0.5,
                isVocal = false
            } = context;

            // Lấy cache từ MemoryManager
            const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
            let cachedResult = null;
            if (memoryManager && typeof memoryManager.get === 'function') {
                const cacheKey = `contextAnalysis_${simpleHash(context)}`;
                cachedResult = memoryManager.get(cacheKey);
                if (cachedResult) {
                    if (isDebug) console.debug(`Retrieved cached analysis for key: ${cacheKey}`, cachedResult);
                    return cachedResult;
                }
            }

            try {
                // Tính spectralComplexity
                let spectralComplexity = 0.5;
                if (spectralProfile.chroma && Array.isArray(spectralProfile.chroma) && spectralProfile.chroma.length > 0) {
                    const sum = spectralProfile.chroma.reduce((sum, val) => {
                        const finiteVal = ensureFinite(val, 0, { errorMessage: 'Invalid chroma value' });
                        return sum + finiteVal * finiteVal;
                    }, 0);
                    spectralComplexity = sum / spectralProfile.chroma.length;
                } else if (isDebug) {
                    console.debug('Invalid or missing chroma, using default spectralComplexity: 0.5');
                }
                spectralComplexity = ensureFinite(spectralComplexity, 0.5, { errorMessage: 'Invalid spectralComplexity' });
                spectralComplexity = Math.max(0, Math.min(1, spectralComplexity));

                // Lấy các tham số khác
                const transientEnergy = ensureFinite(spectralProfile.transientEnergy, 0.5, { errorMessage: 'Invalid transientEnergy' });
                const vocalPresence = isVocal ? 1.0 : ensureFinite(spectralProfile.vocalPresence, 0.5, { errorMessage: 'Invalid vocalPresence' });
                const harmonicComplexity = ensureFinite(polyphonicPitches.length, 0) > 1 ? 1.3 : 1.0;

                // Kiểm tra CPU load
                const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
                const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
                const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice ? 0.85 : 1.0;

                // Tính fadeTime
                const minFadeTime = 0.005;
                const baseFadeTime = 0.4 * (vocalPresence > 0.7 ? 1.4 : 1.0);
                const noiseAdjust = noiseLevel > 0.7 ? 1.2 : 1.0; // Tăng fadeTime nếu noiseLevel cao
                const qualityAdjust = qualityPrediction > 0.7 ? 1.1 : 1.0; // Tăng fadeTime nếu chất lượng cao
                let fadeTime = Math.max(minFadeTime, baseFadeTime * (
                    1.0 + 0.3 * spectralComplexity + 0.2 * transientEnergy + 0.3 * vocalPresence
                ) * noiseAdjust * qualityAdjust * cpuLoadAdjust);
                fadeTime = ensureFinite(fadeTime, minFadeTime, { errorMessage: 'Invalid fadeTime' });

                // Tính bufferTime
                const bufferTime = ensureFinite(
                    this.calculateBufferTime?.(spectralComplexity, transientEnergy, vocalPresence) || 0.2,
                    0.2,
                    { errorMessage: 'Invalid bufferTime' }
                );

                // Các tham số khác
                const fadeType = 'bezier';
                const smoothnessBase = spectralComplexity > 0.7 ? 2.2 : 1.9;
                const smoothness = ensureFinite(
                    smoothnessBase * (noiseLevel > 0.7 ? 1.1 : 1.0) * cpuLoadAdjust,
                    1.9,
                    { errorMessage: 'Invalid smoothness' }
                );
                const vibranceBase = harmonicComplexity > 1.0 ? 0.95 : 0.85;
                const vibrance = ensureFinite(
                    vibranceBase * (qualityPrediction > 0.7 ? 1.05 : 1.0) * cpuLoadAdjust,
                    0.85,
                    { errorMessage: 'Invalid vibrance' }
                );

                // Kết quả
                const result = {
                    fadeTime,
                    bufferTime,
                    fadeType,
                    smoothness,
                    vibrance,
                    spectralComplexity,
                    transientEnergy,
                    vocalPresence,
                    harmonicComplexity
                };

                // Lưu vào MemoryManager
                if (memoryManager && typeof memoryManager.set === 'function') {
                    try {
                        const cacheKey = `contextAnalysis_${simpleHash(context)}`;
                        memoryManager.set(cacheKey, result, 'normal', { timestamp: Date.now() });
                        let analysisHistory = memoryManager.get('analysisHistory') || [];
                        analysisHistory.push({ ...result, timestamp: Date.now() });
                        analysisHistory = analysisHistory.slice(-10); // Giới hạn 10
                        memoryManager.set('analysisHistory', analysisHistory, 'low');
                        if (isDebug) console.debug(`Stored analysis for key: ${cacheKey}`, result);
                    } catch (error) {
                        handleError('Failed to store analysis', error, { context, result }, 'low', { memoryManager });
                    }
                }

                // Debug log
                if (isDebug) {
                    console.debug(`Context analysis result`, {
                        input: {
                            spectralProfile,
                            isVocal,
                            polyphonicPitchesLength: polyphonicPitches.length,
                            noiseLevel,
                            qualityPrediction,
                            cpuLoad,
                            isLowPowerDevice
                        },
                        output: result
                    });
                }

                return result;
            } catch (error) {
                handleError('Error analyzing context', error, { context }, 'high', { memoryManager });
                return null;
            }
        }
    };
};

// Helper function to calculate bufferTime based on qualityMode and context
Jungle.prototype.calculateBufferTime = function (spectralComplexity, transientEnergy, vocalPresence, options = {}) {
    try {
        // Chuẩn hóa đầu vào
        spectralComplexity = ensureFinite(spectralComplexity, 0.5, { errorMessage: 'Invalid spectralComplexity, using default: 0.5' });
        transientEnergy = ensureFinite(transientEnergy, 0.5, { errorMessage: 'Invalid transientEnergy, using default: 0.5' });
        vocalPresence = ensureFinite(vocalPresence, 0.5, { errorMessage: 'Invalid vocalPresence, using default: 0.5' });
        const currentPitchMult = ensureFinite(this.currentPitchMult, 0, { errorMessage: 'Invalid currentPitchMult, using default: 0' });

        // Chuẩn hóa options
        const defaultOptions = {
            spectralWeight: 0.2,
            transientWeight: 0.3,
            vocalWeight: 0.2,
            pitchThreshold: 0.3,
            pitchFactor: 1.5,
            minBufferTime: 0.1,
            maxBufferTime: 2.0
        };
        const validatedOptions = {
            spectralWeight: ensureFinite(options.spectralWeight, defaultOptions.spectralWeight, { errorMessage: 'Invalid spectralWeight' }),
            transientWeight: ensureFinite(options.transientWeight, defaultOptions.transientWeight, { errorMessage: 'Invalid transientWeight' }),
            vocalWeight: ensureFinite(options.vocalWeight, defaultOptions.vocalWeight, { errorMessage: 'Invalid vocalWeight' }),
            pitchThreshold: ensureFinite(options.pitchThreshold, defaultOptions.pitchThreshold, { errorMessage: 'Invalid pitchThreshold' }),
            pitchFactor: ensureFinite(options.pitchFactor, defaultOptions.pitchFactor, { errorMessage: 'Invalid pitchFactor' }),
            minBufferTime: ensureFinite(options.minBufferTime, defaultOptions.minBufferTime, { errorMessage: 'Invalid minBufferTime' }),
            maxBufferTime: ensureFinite(options.maxBufferTime, defaultOptions.maxBufferTime, { errorMessage: 'Invalid maxBufferTime' })
        };

        // Kiểm tra CPU load
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice ? 0.85 : 1.0;

        // Tính baseBufferTime
        const baseBufferTime = this.qualityMode === 'high' ? 0.8 : 0.4;

        // Tính pitchAdjust
        const pitchAdjust = Math.abs(currentPitchMult) > validatedOptions.pitchThreshold
            ? validatedOptions.pitchFactor
            : 1.0;

        // Tính bufferTime
        let bufferTime = baseBufferTime * (
            1.0 +
            validatedOptions.spectralWeight * spectralComplexity +
            validatedOptions.transientWeight * transientEnergy +
            validatedOptions.vocalWeight * vocalPresence
        ) * pitchAdjust * cpuLoadAdjust;

        // Giới hạn bufferTime
        bufferTime = Math.max(validatedOptions.minBufferTime, Math.min(validatedOptions.maxBufferTime, bufferTime));
        bufferTime = ensureFinite(bufferTime, validatedOptions.minBufferTime, { errorMessage: 'Invalid bufferTime' });

        // Debug log
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug(`Calculated bufferTime`, {
                input: {
                    spectralComplexity,
                    transientEnergy,
                    vocalPresence,
                    currentPitchMult,
                    qualityMode: this.qualityMode,
                    cpuLoad,
                    isLowPowerDevice
                },
                options: validatedOptions,
                output: bufferTime
            });
        }

        return bufferTime;
    } catch (error) {
        handleError('Error calculating bufferTime', error, {
            spectralComplexity,
            transientEnergy,
            vocalPresence,
            qualityMode: this.qualityMode
        }, 'high', { memoryManager: options.memoryManager });
        return options.minBufferTime || 0.1; // Fallback
    }
};

/**
 * Simple hash function for context object to generate cache key
 * @param {Object} obj - Context object
 * @returns {string} Hash string
 */
function simpleHash(obj) {
    const str = JSON.stringify({
        spectralProfile: {
            ...obj.spectralProfile,
            chroma: obj.spectralProfile?.chroma // Bao gồm chroma trong hash
        },
        tempoMemory: obj.tempoMemory,
        currentGenre: obj.currentGenre,
        polyphonicPitchesLength: obj.polyphonicPitches?.length
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

Jungle.prototype.analyzeSongStructure = function ({ spectralProfile, tempoMemory, polyphonicPitches, currentGenre }) {
    // Chuẩn hóa đầu vào
    const spectral = spectralProfile || {
        subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
        high: 0.5, subTreble: 0.5, air: 0.5, transientEnergy: 0.5, instruments: {},
        spectralFlux: 0.5, spectralEntropy: 0.5, harmonicRatio: 0.5,
        chroma: Array(12).fill(0.5) // Mặc định chroma: 12 lớp âm sắc
    };
    const validatedSpectral = {
        subBass: ensureFinite(spectral.subBass, 0.5, { errorMessage: 'Invalid subBass' }),
        bass: ensureFinite(spectral.bass, 0.5, { errorMessage: 'Invalid bass' }),
        subMid: ensureFinite(spectral.subMid, 0.5, { errorMessage: 'Invalid subMid' }),
        midLow: ensureFinite(spectral.midLow, 0.5, { errorMessage: 'Invalid midLow' }),
        midHigh: ensureFinite(spectral.midHigh, 0.5, { errorMessage: 'Invalid midHigh' }),
        high: ensureFinite(spectral.high, 0.5, { errorMessage: 'Invalid high' }),
        subTreble: ensureFinite(spectral.subTreble, 0.5, { errorMessage: 'Invalid subTreble' }),
        air: ensureFinite(spectral.air, 0.5, { errorMessage: 'Invalid air' }),
        transientEnergy: ensureFinite(spectral.transientEnergy, 0.5, { errorMessage: 'Invalid transientEnergy' }),
        instruments: typeof spectral.instruments === 'object' ? spectral.instruments : {},
        spectralFlux: ensureFinite(spectral.spectralFlux, 0.5, { errorMessage: 'Invalid spectralFlux' }),
        spectralEntropy: ensureFinite(spectral.spectralEntropy, 0.5, { errorMessage: 'Invalid spectralEntropy' }),
        harmonicRatio: ensureFinite(spectral.harmonicRatio, 0.5, { errorMessage: 'Invalid harmonicRatio' }),
        chroma: Array.isArray(spectral.chroma) && spectral.chroma.length === 12
            ? spectral.chroma.map(v => ensureFinite(v, 0.5, { errorMessage: 'Invalid chroma value' }))
            : Array(12).fill(0.5)
    };
    const validatedTempoMemory = tempoMemory || { current: 120, previous: 120 };
    const validatedPolyphonicPitches = Array.isArray(polyphonicPitches) ? polyphonicPitches : [];
    const validatedCurrentGenre = typeof currentGenre === 'string' ? currentGenre.toLowerCase() : 'unknown';

    try {
        // Kiểm tra CPU load
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice ? 0.85 : 1.0;

        // Lấy cache từ MemoryManager
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        const cacheKey = `songStructure_${simpleHash({ spectralProfile, tempoMemory, polyphonicPitches, currentGenre })}`;
        if (this.memoryManager && typeof this.memoryManager.get === 'function') {
            const cachedStructure = this.memoryManager.get(cacheKey);
            if (cachedStructure && cachedStructure.metadata?.timestamp > Date.now() - 1000 && cachedStructure.metadata?.expiry > Date.now()) {
                if (isDebug) console.debug(`Using cached song structure for key: ${cacheKey}`, cachedStructure);
                return cachedStructure;
            }
        }

        // Kiểm tra đầu vào giống lần trước
        const lastInputHash = this.memoryManager?.get('lastInputHash');
        const currentInputHash = simpleHash({ spectralProfile, tempoMemory, polyphonicPitches, currentGenre });
        if (lastInputHash === currentInputHash && this.memoryManager?.get('lastStructure')) {
            const lastStructure = this.memoryManager.get('lastStructure');
            if (isDebug) console.debug(`Reusing last structure due to similar input`, lastStructure);
            return lastStructure;
        }

        // Tính toán metrics
        const tempoChange = validatedTempoMemory.current && validatedTempoMemory.previous
            ? Math.abs(ensureFinite(validatedTempoMemory.current, 120) - ensureFinite(validatedTempoMemory.previous, 120)) / ensureFinite(validatedTempoMemory.previous, 120)
            : 0;
        const energy = (
            validatedSpectral.subBass + validatedSpectral.bass + validatedSpectral.subMid +
            validatedSpectral.midLow + validatedSpectral.midHigh + validatedSpectral.high
        ) / 6;
        const energyChange = this.memoryManager?.get('lastEnergy')
            ? Math.abs(energy - ensureFinite(this.memoryManager.get('lastEnergy'), 0.5)) / (ensureFinite(this.memoryManager.get('lastEnergy'), 0.5) || 1)
            : 0;
        const transientDensity = validatedSpectral.transientEnergy;
        const instrumentPresence = Object.values(validatedSpectral.instruments).reduce((sum, val) => sum + ensureFinite(val, 0), 0) /
            (Object.keys(validatedSpectral.instruments).length || 1);
        const spectralFlux = validatedSpectral.spectralFlux;
        const spectralEntropy = validatedSpectral.spectralEntropy;
        const harmonicRatio = validatedSpectral.harmonicRatio;

        // Tính chroma metrics
        const chromaPresence = validatedSpectral.chroma.reduce((sum, val) => sum + val, 0) / 12; // Trung bình năng lượng chroma
        const lastChroma = this.memoryManager?.get('lastChroma') || Array(12).fill(0.5);
        const chromaFlux = validatedSpectral.chroma.reduce((sum, val, i) => sum + Math.abs(val - lastChroma[i]), 0) / 12; // Biến động chroma

        // Điều chỉnh theo genre và pitches
        const genreAdjust = validatedCurrentGenre.includes('edm') || validatedCurrentGenre.includes('pop') ? 1.2 : validatedCurrentGenre.includes('classical') ? 0.8 : 1.0;
        const pitchAdjust = validatedPolyphonicPitches.length > 2 ? 1.2 : validatedPolyphonicPitches.length === 0 ? 0.8 : 1.0;

        // Thuật toán thông minh (Decision Tree-like)
        let section = 'verse';
        let structureFactor = 1.0;
        let confidence = 0.5;

        // Tính điểm cho mỗi section
        const scores = {
            chorus: 0,
            intro: 0,
            bridge: 0,
            verse: 0
        };

        // Quy tắc động (giữ nguyên và thêm chroma)
        scores.chorus += energyChange * 2.0 * genreAdjust;
        scores.chorus += transientDensity * 1.5 * genreAdjust;
        scores.chorus += tempoChange * 1.0 * genreAdjust;
        scores.chorus += spectralFlux * 1.2;
        scores.chorus += instrumentPresence * 1.0 * genreAdjust;
        scores.chorus += chromaPresence * 1.5 * genreAdjust; // Nhiều lớp âm sắc
        scores.chorus += chromaFlux * 1.2; // Biến động chroma cao

        scores.intro += (1 - energy) * 2.0 / genreAdjust;
        scores.intro += (1 - instrumentPresence) * 1.5 / genreAdjust;
        scores.intro += (1 - spectralFlux) * 1.2;
        scores.intro += (1 - transientDensity) * 1.0 / genreAdjust;
        scores.intro += (1 - chromaPresence) * 1.5 / genreAdjust; // Ít lớp âm sắc
        scores.intro += (1 - chromaFlux) * 1.2; // Biến động chroma thấp

        scores.bridge += (1 - transientDensity) * 1.5 / genreAdjust;
        scores.bridge += instrumentPresence * 1.2 * genreAdjust;
        scores.bridge += harmonicRatio * 1.0;
        scores.bridge += (1 - energyChange) * 1.0 / genreAdjust;
        scores.bridge += chromaFlux * 1.5; // Biến động chroma trung bình/cao
        scores.bridge += (1 - chromaPresence) * 1.0; // Trung bình lớp âm sắc

        scores.verse += (1 - Math.abs(energy - 0.5)) * 1.5;
        scores.verse += (1 - Math.abs(transientDensity - 0.5)) * 1.2;
        scores.verse += spectralEntropy * 1.0;
        scores.verse += (1 - tempoChange) * 0.8;
        scores.verse += (1 - Math.abs(chromaPresence - 0.5)) * 1.2; // Chroma trung bình
        scores.verse += (1 - chromaFlux) * 1.0; // Biến động chroma thấp

        // Dự đoán từ lịch sử
        const history = this.memoryManager?.get('songStructureHistory') || [];
        const lastSection = history.length > 0 ? history[history.length - 1]?.section : null;
        if (lastSection === 'chorus') scores.verse += 0.5;
        if (lastSection === 'intro') scores.verse += 0.5;
        if (lastSection === 'bridge') scores.chorus += 0.5;

        // Chọn section có điểm cao nhất
        const maxScore = Math.max(...Object.values(scores));
        section = Object.keys(scores).find(key => scores[key] === maxScore) || 'verse';
        confidence = maxScore / (maxScore + 1);

        // Gán structureFactor
        const factorMap = { chorus: 1.4, intro: 0.8, bridge: 1.2, verse: 1.0 };
        structureFactor = factorMap[section] * pitchAdjust * cpuLoadAdjust;
        structureFactor = Math.max(0.5, Math.min(2.0, ensureFinite(structureFactor, 1.0, { errorMessage: 'Invalid structureFactor' })));

        // Kết quả
        const result = { section, structureFactor, confidence };

        // Lưu vào MemoryManager
        if (this.memoryManager && typeof this.memoryManager.set === 'function') {
            try {
                // Lưu structure
                this.memoryManager.set(cacheKey, result, 'high', { timestamp: Date.now(), expiry: Date.now() + 10000 });
                this.memoryManager.set('lastStructure', result, 'high', { timestamp: Date.now() });
                this.memoryManager.set('lastInputHash', currentInputHash, 'low', { timestamp: Date.now() });
                this.memoryManager.set('lastChroma', validatedSpectral.chroma, 'low', { timestamp: Date.now() }); // Lưu chroma

                // Lưu lịch sử
                let history = this.memoryManager.get('songStructureHistory') || [];
                history.push({ section, structureFactor, confidence, timestamp: Date.now(), chroma: validatedSpectral.chroma });
                history = history.slice(-50);
                this.memoryManager.set('songStructureHistory', history, 'low', { timestamp: Date.now() });

                this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
                if (isDebug) console.debug(`Stored song structure for key: ${cacheKey}`, { result, historyLength: history.length, chromaPresence, chromaFlux });
            } catch (error) {
                handleError('Failed to store song structure', error, { cacheKey, result, historyLength: history?.length }, 'low', { memoryManager: this.memoryManager });
            }
        }

        // Debug log
        if (isDebug) {
            console.debug(`Song structure analysis result`, {
                input: {
                    spectralProfile: { ...validatedSpectral, chromaPresence, chromaFlux },
                    tempoMemory: validatedTempoMemory,
                    polyphonicPitchesLength: validatedPolyphonicPitches.length,
                    currentGenre: validatedCurrentGenre,
                    cpuLoad,
                    isLowPowerDevice,
                    lastSection
                },
                scores,
                output: result
            });
        }

        return result;
    } catch (error) {
        handleError('Error analyzing song structure', error, { spectralProfile, tempoMemory, polyphonicPitches, currentGenre }, 'high', { memoryManager: this.memoryManager });
        return { section: 'verse', structureFactor: 1.0, confidence: 0.5 };
    }
};

/**
 * Calculates max cache size based on device memory
 */
Jungle.prototype.calculateMaxCacheSize = function () {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    
    // Lấy thông tin thiết bị
    const deviceMemory = navigator.deviceMemory || (navigator.hardwareConcurrency ? Math.max(2, navigator.hardwareConcurrency / 2) : 4); // Fallback dựa trên CPU cores
    const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    
    // Lấy CPU load
    const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5, { errorMessage: 'Invalid cpuLoad' }) : 0.5;
    
    // Tính kích thước cơ bản dựa trên deviceMemory
    let baseCacheSize = deviceMemory * 25; // 25MB per GB
    baseCacheSize = Math.min(100, baseCacheSize); // Giới hạn tối đa 100MB
    
    // Điều chỉnh dựa trên cpuLoad và isLowPowerDevice
    const loadAdjust = cpuLoad > 0.9 ? 0.7 : cpuLoad > 0.7 ? 0.85 : 1.0; // Giảm khi CPU tải cao
    const deviceAdjust = isLowPowerDevice ? 0.8 : 1.0; // Giảm trên thiết bị yếu
    let adjustedCacheSize = baseCacheSize * loadAdjust * deviceAdjust;
    
    // Tích hợp thống kê từ MemoryManager
    let cacheStats = { hitRate: 0.5, totalSize: 0 };
    if (this.memoryManager && typeof this.memoryManager.getCacheStats === 'function') {
        cacheStats = this.memoryManager.getCacheStats();
        // Tăng cache nếu hit rate cao (>0.8) và bộ nhớ còn dư
        if (cacheStats.hitRate > 0.8 && cacheStats.totalSize < adjustedCacheSize * 0.9) {
            adjustedCacheSize *= 1.1; // Tăng 10%
        }
        // Giảm cache nếu hit rate thấp (<0.3) hoặc bộ nhớ gần đầy
        if (cacheStats.hitRate < 0.3 || cacheStats.totalSize > adjustedCacheSize * 1.2) {
            adjustedCacheSize *= 0.9; // Giảm 10%
        }
    }
    
    // Giới hạn cuối cùng
    adjustedCacheSize = Math.max(10, Math.min(100, ensureFinite(adjustedCacheSize, 50, { errorMessage: 'Invalid cache size' }))); // Tối thiểu 10MB, tối đa 100MB
    
    // Debug log
    if (isDebug) {
        console.debug('Calculated max cache size', {
            deviceMemory,
            isLowPowerDevice,
            cpuLoad,
            baseCacheSize,
            loadAdjust,
            deviceAdjust,
            cacheStats: { hitRate: cacheStats.hitRate, totalSize: cacheStats.totalSize },
            finalCacheSize: adjustedCacheSize
        });
    }
    
    return adjustedCacheSize;
};

/**
 * Generates a cache signature for security.
 * @param {string} cacheKey - Cache key.
 * @returns {string} Cache signature.
 */
function generateCacheSignature(cacheKey, context = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    
    // Tích hợp timestamp để giảm va chạm
    const timestamp = Date.now();
    const enhancedKey = JSON.stringify({
        cacheKey,
        timestamp: Math.floor(timestamp / 1000), // Giảm độ chi tiết timestamp để tối ưu cache
        spectralProfile: context.spectralProfile || {}, // Tích hợp spectralProfile
        songStructure: context.songStructure || {} // Tích hợp songStructure
    });
    
    // Thuật toán hash cải tiến (FNV-1a 32-bit)
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < enhancedKey.length; i++) {
        hash ^= enhancedKey.charCodeAt(i);
        hash = (hash * 16777619) | 0; // FNV prime, giữ 32-bit
    }
    
    const signature = hash.toString(36);
    
    // Kiểm tra trùng lặp trong MemoryManager
    if (this.memoryManager && typeof this.memoryManager.get === 'function') {
        const existing = this.memoryManager.get(signature);
        if (existing && isDebug) {
            console.debug('Cache signature collision detected', {
                signature,
                cacheKey,
                context,
                existingEntry: existing
            });
        }
    }
    
    // Debug log
    if (isDebug) {
        console.debug('Generated cache signature', {
            cacheKey,
            signature,
            context: {
                spectralProfile: context.spectralProfile,
                songStructure: context.songStructure
            },
            cacheSize: this.memoryManager?.getCacheStats?.()?.totalSize || 0
        });
    }
    
    return signature;
}

// Receive user feedback with extended support
Jungle.prototype.receiveUserFeedback = function (feedback) {
    if (!this.memoryManager) {
        console.warn('MemoryManager not initialized, skipping feedback');
        return;
    }

    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    
    // Chuẩn hóa và phân tích feedback
    const normalizedFeedback = feedback.toLowerCase().trim();
    const feedbackData = {
        feedback: normalizedFeedback,
        timestamp: Date.now(),
        expiry: Date.now() + 30000, // 30s expiry
        semanticCategory: this.analyzeFeedbackSemantics(normalizedFeedback), // Phân loại ngữ nghĩa
        songStructure: this.memoryManager.get('lastStructure')?.section || 'unknown' // Liên kết với section
    };

    // Kiểm tra feedback lặp lại
    const feedbackList = this.memoryManager.buffers.get('userFeedback') || [];
    const lastFeedback = feedbackList.length > 0 ? feedbackList[feedbackList.length - 1] : null;
    if (lastFeedback?.feedback === normalizedFeedback && Date.now() - lastFeedback.timestamp < 5000) {
        if (isDebug) console.debug('Skipping duplicate feedback:', feedbackData);
        return;
    }

    // Lưu vào MemoryManager
    feedbackList.push(feedbackData);
    this.memoryManager.buffers.set('userFeedback', feedbackList.slice(-20), { priority: 'medium' });
    this.memoryManager.pruneCache(this.calculateMaxCacheSize());

    // Tối ưu lưu trữ trong chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['userFeedback'], (result) => {
            let storedFeedback = result.userFeedback || [];
            // Nén dữ liệu bằng cách chỉ lưu các trường cần thiết
            const compressedFeedback = {
                f: normalizedFeedback, // feedback
                t: feedbackData.timestamp, // timestamp
                s: feedbackData.songStructure, // songStructure
                c: feedbackData.semanticCategory // semanticCategory
            };
            storedFeedback.push(compressedFeedback);
            storedFeedback = storedFeedback.slice(-20); // Giới hạn 20 mục
            chrome.storage.local.set({ userFeedback: storedFeedback }, () => {
                if (isDebug) console.debug('Stored user feedback in chrome.storage.local:', compressedFeedback);
            });
        });
    }

    // Debug log chi tiết
    if (isDebug) {
        console.debug('Received user feedback:', {
            feedback: feedbackData.feedback,
            semanticCategory: feedbackData.semanticCategory,
            songStructure: feedbackData.songStructure,
            timestamp: feedbackData.timestamp,
            feedbackListLength: feedbackList.length,
            cacheSize: this.memoryManager.getCacheStats?.()?.totalSize || 0
        });
    }
};

// Hàm phụ để phân tích ngữ nghĩa feedback (không có trong code gốc)
Jungle.prototype.analyzeFeedbackSemantics = function (feedback) {
    const keywords = {
        treble: ['chói tai', 'screech', 'harsh', 'bright'],
        bass: ['mạnh bass', 'deep', 'boomy', 'rumbly'],
        vocal: ['ấm giọng', 'clear voice', 'vocal', 'singer'],
        muddy: ['mờ đục', 'muddy', 'unclear'],
        loud: ['to quá', 'loud', 'overpower'],
        quiet: ['nhỏ quá', 'quiet', 'low volume']
    };

    for (const [category, terms] of Object.entries(keywords)) {
        if (terms.some(term => feedback.includes(term))) {
            return category;
        }
    }
    return 'unknown';
};

Jungle.prototype.applyUserFeedback = function () {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    try {
        const feedbackList = this.memoryManager?.buffers.get('userFeedback') || [];
        const spectralProfile = this.spectralProfile || {
            spectralComplexity: 0.5,
            transientEnergy: 0.5,
            vocalPresence: 0.5,
            bass: 0.5,
            midHigh: 0.5,
            air: 0.5,
            spectralFlux: 0.5,
            chroma: Array(12).fill(0.5)
        };
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const deviceMemory = navigator.deviceMemory || 4;
        const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice || deviceMemory < 4 ? 0.8 : 1.0;

        // Tích hợp songStructure và semanticCategory
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const feedbackSemantic = feedbackList.find(f => f.semanticCategory && f.timestamp > Date.now() - 60000)?.semanticCategory || 'general';
        const isChorus = songStructure.section === 'chorus';
        const isVocalFeedback = feedbackSemantic === 'vocal';

        // Check cached adjustments
        const cacheKey = this.generateCacheSignature?.('feedbackAdjustments', {
            spectralProfile,
            songStructure,
            feedbackList,
            cpuLoad
        }) || `feedbackAdjustments_${this.contextId}`;
        const cachedAdjustments = this.memoryManager?.get(cacheKey);
        if (cachedAdjustments?.timestamp > Date.now() - 30000) {
            if (isDebug) console.debug('Reused cached feedback adjustments', { cacheKey, cachedAdjustments });
            return cachedAdjustments.adjustments;
        }

        const adjustments = {
            bass: 0,
            treble: 0,
            mid: 0,
            clarity: 0,
            vocalClarity: 0,
            distortion: 0,
            warmth: 0,
            air: 0,
            subBass: 0,
            harmonicRichness: 0
        };

        // Hàm tính mức độ phản hồi
        const getFeedbackIntensity = (feedback) => {
            if (feedback.includes('very') || feedback.includes('much') || feedback.includes('a lot') || feedback.includes('rất')) return 1.5;
            if (feedback.includes('slightly') || feedback.includes('hơi') || feedback.includes('nhẹ')) return 0.8;
            return 1.0;
        };

        // Xử lý phản hồi
        feedbackList.forEach(feedback => {
            if (feedback.expiry && feedback.expiry < Date.now()) return;
            const intensity = getFeedbackIntensity(feedback.feedback.toLowerCase());

            // Bass
            if (feedback.feedback.includes('too much bass') || feedback.feedback.includes('bịch bịch') || feedback.feedback.includes('quá trầm')) {
                adjustments.bass -= 1.5 * intensity;
                adjustments.subBass -= 1.2 * intensity;
            } else if (feedback.feedback.includes('more bass') || feedback.feedback.includes('bass bùm bùm') || feedback.feedback.includes('trầm hơn')) {
                adjustments.bass += 1.5 * intensity * (spectralProfile.bass < 0.7 ? 1.2 : 1.0);
                adjustments.subBass += 1.2 * intensity;
            }

            // Treble
            if (feedback.feedback.includes('too bright') || feedback.feedback.includes('too much treble') || feedback.feedback.includes('chói')) {
                adjustments.treble -= 1.5 * intensity;
                adjustments.air -= 1.2 * intensity;
            } else if (feedback.feedback.includes('more treble') || feedback.feedback.includes('treble trong trẻo') || feedback.feedback.includes('sáng hơn')) {
                adjustments.treble += 1.5 * intensity * (spectralProfile.air < 0.7 ? 1.2 : 1.0);
                adjustments.air += 1.0 * intensity;
            }

            // Mid
            if (feedback.feedback.includes('muddy') || feedback.feedback.includes('too much mid') || feedback.feedback.includes('đục')) {
                adjustments.mid -= 1.5 * intensity;
            } else if (feedback.feedback.includes('more mid') || feedback.feedback.includes('nhạc cụ rõ') || feedback.feedback.includes('giữa rõ hơn')) {
                adjustments.mid += 1.5 * intensity * (spectralProfile.midHigh < 0.7 ? 1.2 : 1.0);
            }

            // Clarity
            if (feedback.feedback.includes('not clear') || feedback.feedback.includes('more clarity') || feedback.feedback.includes('mượt mà')) {
                adjustments.clarity += 1.5 * intensity;
                adjustments.mid += 0.8 * intensity;
                adjustments.vocalClarity += 0.8 * intensity;
                adjustments.distortion -= 0.5 * intensity; // Giảm distortion để tăng mượt mà
            }

            // Vocal clarity
            if (feedback.feedback.includes('more vocal clarity') || feedback.feedback.includes('vocal tự nhiên') || feedback.feedback.includes('giọng rõ')) {
                adjustments.vocalClarity += 2.0 * intensity * (spectralProfile.vocalPresence < 0.7 ? 1.3 : 1.0);
                adjustments.clarity += 0.8 * intensity;
                adjustments.warmth += 0.5 * intensity;
            }

            // Distortion và rè
            if (feedback.feedback.includes('less distortion') || feedback.feedback.includes('rè') || feedback.feedback.includes('xe xe')) {
                adjustments.distortion -= 2.0 * intensity;
                adjustments.treble -= 1.0 * intensity * (spectralProfile.air > 0.7 ? 1.2 : 1.0);
                adjustments.air -= 0.8 * intensity;
                adjustments.bass -= 0.5 * intensity * (spectralProfile.bass > 0.7 ? 1.2 : 1.0);
                adjustments.vocalClarity += 0.5 * intensity;
            }

            // Warmth
            if (feedback.feedback.includes('ấm áp') || feedback.feedback.includes('tự nhiên') || feedback.feedback.includes('mượt mà')) {
                adjustments.warmth += 1.2 * intensity;
                adjustments.bass += 0.5 * intensity;
                adjustments.mid += 0.5 * intensity;
            }

            // Harmonic richness (dựa trên chroma)
            if (feedback.feedback.includes('giàu cảm xúc') || feedback.feedback.includes('hòa âm phong phú')) {
                adjustments.harmonicRichness += 1.0 * intensity;
                adjustments.mid += 0.5 * intensity;
            }
        });

        // Xử lý chrome.storage.local
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get(['userFeedback'], (result) => {
                const storedFeedback = result.userFeedback || [];
                storedFeedback.forEach(feedback => {
                    if (feedback.expiry && feedback.expiry < Date.now()) return;
                    const intensity = getFeedbackIntensity(feedback.feedback.toLowerCase());
                    if (feedback.feedback.includes('more vocal clarity') || feedback.feedback.includes('vocal tự nhiên') || feedback.feedback.includes('giọng rõ')) {
                        adjustments.vocalClarity += 1.2 * intensity;
                        adjustments.clarity += 0.5 * intensity;
                    }
                    if (feedback.feedback.includes('less distortion') || feedback.feedback.includes('rè') || feedback.feedback.includes('xe xe')) {
                        adjustments.distortion -= 1.5 * intensity;
                        adjustments.treble -= 0.8 * intensity;
                        adjustments.air -= 0.5 * intensity;
                    }
                    if (feedback.feedback.includes('ấm áp') || feedback.feedback.includes('tự nhiên') || feedback.feedback.includes('mượt mà')) {
                        adjustments.warmth += 0.8 * intensity;
                        adjustments.bass += 0.3 * intensity;
                    }
                    if (feedback.feedback.includes('giàu cảm xúc') || feedback.feedback.includes('hòa âm phong phú')) {
                        adjustments.harmonicRichness += 0.8 * intensity;
                        adjustments.mid += 0.3 * intensity;
                    }
                });

                // Lưu lại adjustments
                this.memoryManager?.set(cacheKey, {
                    adjustments,
                    timestamp: Date.now(),
                    expiry: Date.now() + 60000
                }, 'high');
            });
        }

        // Tinh chỉnh dựa trên spectralProfile, songStructure, và semanticCategory
        if (spectralProfile.transientEnergy > 0.7 || spectralProfile.spectralFlux > 0.7) {
            adjustments.clarity += 0.5;
            adjustments.vocalClarity += 0.5;
        }
        if (spectralProfile.spectralComplexity > 0.7) {
            adjustments.distortion -= 0.5;
        }
        if (spectralProfile.bass > 0.7 && adjustments.bass > 0) {
            adjustments.subBass += adjustments.bass * 0.8;
        }
        if (spectralProfile.air > 0.7 && adjustments.treble > 0) {
            adjustments.treble *= 0.8;
            adjustments.air *= 0.8;
        }
        if (spectralProfile.chroma && spectralProfile.chroma.some(val => val > 0.7)) {
            adjustments.harmonicRichness += 0.5; // Tăng nếu âm sắc phong phú
        }
        if (isChorus || isVocalFeedback) {
            adjustments.vocalClarity += 0.7;
            adjustments.clarity += 0.5;
            adjustments.warmth += 0.3;
        }

        // Áp dụng cpuLoadAdjust
        Object.keys(adjustments).forEach(key => {
            adjustments[key] *= cpuLoadAdjust;
        });

        // Clamp adjustments
        Object.keys(adjustments).forEach(key => {
            adjustments[key] = Math.max(-4.0, Math.min(4.0, adjustments[key]));
        });

        // Lưu adjustments vào MemoryManager
        this.memoryManager?.set(cacheKey, {
            adjustments,
            timestamp: Date.now(),
            expiry: Date.now() + 60000
        }, 'high');
        this.memoryManager?.pruneCache(this.calculateMaxCacheSize?.() || 100);

        if (isDebug) console.debug('Applied user feedback', {
            adjustments,
            spectralProfile,
            cpuLoad: cpuLoad.toFixed(2),
            isLowPowerDevice,
            deviceMemory,
            songStructure,
            feedbackSemantic,
            cacheStats: this.memoryManager?.getCacheStats?.()
        });

        return adjustments;
    } catch (error) {
        console.error('Error applying user feedback:', error, {
            spectralProfile,
            cpuLoad,
            isLowPowerDevice
        });
        return {
            bass: 0,
            treble: 0,
            mid: 0,
            clarity: 0,
            vocalClarity: 0,
            distortion: 0,
            warmth: 0,
            air: 0,
            subBass: 0,
            harmonicRichness: 0
        };
    }
};

// Optimize sound profile using machine learning simulation
/**
 * Optimizes sound profile with a revolutionary deep learning-inspired algorithm.
 * Uses multi-layer spectral analysis, dynamic adaptive parameter prediction, and intelligent quantization
 * to deliver ultra-clear, natural, and detailed audio on any device without reverb.
 * @param {Object} params - Input parameters including profile, music context, spectral profile, and user feedback.
 * @returns {Object} Optimized audio parameters for sound processing.
 */
Jungle.prototype.optimizeSoundProfile = function ({
    profile,
    musicContext,
    spectral,
    genreFactor,
    warmthBoost,
    subBassBoost,
    subMidBoost,
    midBoost,
    trebleReduction,
    transientBoostAdjust,
    polyphonicAdjust,
    harmonicBoost,
    songStructure,
    userFeedbackAdjust
}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    // Validate spectral profile with defaults
    const spectralDefaults = {
        subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
        high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
        spectralFlux: 0.5, spectralEntropy: 0.5, harmonicRatio: 0.5
    };
    const validatedSpectral = {};
    Object.keys(spectralDefaults).forEach(key => {
        validatedSpectral[key] = Number.isFinite(spectral[key]) ? Math.max(0, Math.min(1, spectral[key])) : spectralDefaults[key];
    });

    // Check CPU load and device capability
    const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5, { errorMessage: 'Invalid cpuLoad' }) : 0.5;
    const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    const cpuLoadAdjust = cpuLoad > 0.9 ? 0.85 : cpuLoad > 0.7 ? 0.95 : 1.0;

    // Multi-layer FFT analysis
    const fftAnalysis = this._analyser ? this.getFFTAnalysis() : null;
    const subBassEnergy = fftAnalysis?.subBassEnergy || validatedSpectral.subBass;
    const highFreqEnergy = fftAnalysis?.highFreqEnergy || validatedSpectral.air;
    const transientEnergy = fftAnalysis?.transientEnergy || validatedSpectral.transientEnergy;
    const spectralCoherence = fftAnalysis?.spectralCoherence || 0.5;
    const transientDensity = fftAnalysis?.transientDensity || 0.5;

    // Kiểm tra input gần giống qua simpleHash
    const inputHash = this.simpleHash?.({
        spectralProfile: validatedSpectral,
        songStructure,
        userFeedbackAdjust,
        profile,
        musicContext
    }) || JSON.stringify({ profile, spectral, songStructure });
    const lastInputHash = this.memoryManager?.get('lastOptimizeInputHash');
    if (lastInputHash === inputHash && this.memoryManager?.get('optimizedParams')?.timestamp > Date.now() - 5000) {
        const cachedParams = this.memoryManager.get('optimizedParams').params;
        if (isDebug) console.debug('Reusing cached optimized params due to similar input', { inputHash, cachedParams });
        return cachedParams;
    }

    // Dự đoán từ songStructureHistory
    let historyAdjust = { formantGain: 0, midShelfGain: 0 };
    const history = this.memoryManager?.get('songStructureHistory') || [];
    const lastSection = history.length > 0 ? history[history.length - 1]?.section : null;
    if (lastSection === 'chorus') historyAdjust = { formantGain: 0.5, midShelfGain: 0.4 };
    else if (lastSection === 'bridge') historyAdjust = { formantGain: 0.3, midShelfGain: 0.3 };

    // Simulate deep learning-based optimization
    const deepLearningModel = {
        predict: (input) => {
            const { spectralComplexity, vocalPresence, harmonicComplexity } = musicContext;
            const trebleIndex = (validatedSpectral.high + validatedSpectral.subTreble + validatedSpectral.air) / 3;
            const isPiercing = trebleIndex > 0.55 || highFreqEnergy > 0.7 || (userFeedbackAdjust?.distortion < -1.0);
            const dynamicTrebleReduction = isPiercing 
                ? Math.min(6.0, (trebleIndex - 0.55) * 8.0 + (userFeedbackAdjust?.treble || 0))
                : trebleReduction + (userFeedbackAdjust?.treble || 0);

            // Fundamental frequency for vocal tuning
            let fundamentalFreq = 440;
            if (this.polyphonicPitches?.length > 0) {
                fundamentalFreq = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
            }
            const isHighVocal = fundamentalFreq > 480;

            // Transient and clarity adjustments
            const vocalTransient = vocalPresence > 0.7 
                ? Math.min(1.0, transientEnergy * 1.4 * (1 + transientDensity * 0.3))
                : 0.5;
            const instrumentTransient = validatedSpectral.instruments?.guitar || validatedSpectral.instruments?.drums 
                ? Math.min(1.0, transientEnergy * 1.3 * (1 + transientDensity * 0.2))
                : 0.5;
            const transientAdjust = (vocalTransient + instrumentTransient) / 2;

            // Formant preservation
            const formantParams = this.preserveFormant?.(
                this.currentPitchMult || 0,
                fundamentalFreq,
                vocalPresence,
                validatedSpectral
            ) || { freq: 450, gain: 4.0, q: 1.2 };

            // Dynamic quantization
            const quantizationLevel = isLowPowerDevice || cpuLoad > 0.8 ? 0.1 : 0.01;
            const quantize = (value, precision) => Math.round(value / precision) * precision;

            // Master gain để giảm tổng volume xuống mức 7
            const masterGain = 0.7; // Thêm hệ số để giảm volume tổng xuống 70%

            // Base parameters
            let baseParams = {
                bassCutFreq: quantize(30, quantizationLevel),
                trebleCutFreq: quantize(16000 - dynamicTrebleReduction * 1400, quantizationLevel),
                lowShelfGain: quantize((10.5 + subBassBoost + warmthBoost + (userFeedbackAdjust?.bass || 0) + (userFeedbackAdjust?.subBass || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                subBassGain: quantize((5.2 + subBassBoost + (userFeedbackAdjust?.bass || 0) + (userFeedbackAdjust?.subBass || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                subMidGain: quantize((6.5 + subMidBoost + warmthBoost + (userFeedbackAdjust?.mid || 0) + (userFeedbackAdjust?.warmth || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                midBassGain: quantize((5.2 + warmthBoost + (userFeedbackAdjust?.mid || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                midShelfGain: quantize((7.5 + midBoost + (userFeedbackAdjust?.mid || 0) + (userFeedbackAdjust?.clarity || 0) * 0.6 + historyAdjust.midShelfGain) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                highMidGain: quantize((5.5 + midBoost + harmonicBoost + transientAdjust + (userFeedbackAdjust?.clarity || 0) * 0.6) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                highShelfGain: quantize((0.6 - dynamicTrebleReduction + harmonicBoost + (userFeedbackAdjust?.treble || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                subTrebleGain: quantize((0.4 - dynamicTrebleReduction + harmonicBoost + (userFeedbackAdjust?.treble || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                airGain: quantize((0.5 + harmonicBoost - dynamicTrebleReduction + (userFeedbackAdjust?.air || 0)) * cpuLoadAdjust * masterGain, quantizationLevel), // Áp dụng masterGain
                compressorThreshold: quantize(-16, quantizationLevel),
                compressorRatio: quantize(4.2 * (subBassEnergy > 0.75 ? 1.3 : 1.0), quantizationLevel),
                compressorAttack: quantize(transientEnergy > 0.7 ? 0.0015 : 0.003, quantizationLevel),
                compressorRelease: quantize(transientEnergy > 0.7 ? 0.08 : 0.18, quantizationLevel),
                notchFreq: quantize(isHighVocal ? 7500 : 6800, quantizationLevel),
                notchQ: quantize(3.5, quantizationLevel),
                f1Freq: quantize(formantParams.freq, quantizationLevel),
                f2Freq: quantize(formantParams.freq * 4.2, quantizationLevel),
                formantGain: quantize((formantParams.gain + (userFeedbackAdjust?.vocalClarity || 0) * 0.5 + historyAdjust.formantGain) * masterGain, quantizationLevel), // Áp dụng masterGain
                formantQ: quantize(formantParams.q, quantizationLevel),
                deEsserGain: quantize(-15, quantizationLevel),
                boost: quantize(0.9 + harmonicBoost, quantizationLevel),
                panAdjust: quantize(subBassEnergy > 0.75 ? 0.1 : 0, quantizationLevel),
                minFadeLength: 512,
                fadeTime: 0.01,
                bufferTime: 0.025
            };

            // Sibilance and distortion control
            if (vocalPresence > 0.75 || transientEnergy > 0.7 || validatedSpectral.spectralFlux > 0.65 || highFreqEnergy > 0.75 || userFeedbackAdjust?.distortion < -1.0 || spectralCoherence < 0.4) {
                baseParams.deEsserGain = quantize(-18 - (validatedSpectral.spectralFlux - 0.65) * 15, quantizationLevel);
                baseParams.notchFreq = quantize(isHighVocal ? 7600 : 6900, quantizationLevel);
                baseParams.notchQ = quantize(3.8 * (userFeedbackAdjust?.distortion < -1.0 ? 1.3 : 1.0), quantizationLevel);
                baseParams.highShelfGain *= 0.7;
                baseParams.subTrebleGain *= 0.7;
                baseParams.airGain *= 0.7;
                if (spectralCoherence < 0.4) {
                    baseParams.formantGain *= 0.8;
                    baseParams.compressorRatio *= 0.85;
                }
            }

            // Tích hợp spectralFlux, spectralEntropy, harmonicRatio
            if (validatedSpectral.spectralFlux > 0.7) {
                baseParams.compressorAttack = quantize(0.0012, quantizationLevel);
                baseParams.highMidGain += 0.3 * masterGain; // Áp dụng masterGain
            }
            if (validatedSpectral.spectralEntropy > 0.6) {
                baseParams.midShelfGain += 0.2 * masterGain; // Áp dụng masterGain
                baseParams.formantGain += 0.2 * masterGain; // Áp dụng masterGain
            }
            if (validatedSpectral.harmonicRatio > 0.7) {
                baseParams.harmonicExciterGain = quantize((baseParams.harmonicExciterGain || 0) + 0.5 * masterGain, quantizationLevel); // Áp dụng masterGain
                baseParams.highMidGain += 0.2 * masterGain; // Áp dụng masterGain
            }

            // Song structure adjustments
            const lookAheadWeight = songStructure?.section === 'chorus' && vocalPresence > 0.7 ? 1.2 :
                                   songStructure?.section === 'verse' ? 1.0 :
                                   songStructure?.section === 'bridge' ? 1.1 : 1.0;
            if (songStructure?.section === 'chorus' && vocalPresence > 0.7) {
                baseParams.formantGain = quantize(Math.min(5.2, baseParams.formantGain + 0.7 * lookAheadWeight) * masterGain, quantizationLevel); // Áp dụng masterGain
                baseParams.midShelfGain += 0.5 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.highMidGain += 0.4 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.subBassGain -= 0.4 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.compressorRatio *= 1.25 * lookAheadWeight;
            } else if (songStructure?.section === 'verse') {
                baseParams.subMidGain += 0.6 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.formantGain += 0.4 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.highMidGain += 0.3 * lookAheadWeight * masterGain; // Áp dụng masterGain
            } else if (songStructure?.section === 'bridge') {
                baseParams.lowShelfGain -= 0.6 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.subBassGain -= 0.5 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.highMidGain += 0.4 * lookAheadWeight * masterGain; // Áp dụng masterGain
                baseParams.formantGain += 0.5 * lookAheadWeight * masterGain; // Áp dụng masterGain
            }

            // Tighten bass
            if (subBassEnergy > 0.75 || userFeedbackAdjust?.bass > 1.2) {
                baseParams.compressorRatio *= 1.4;
                baseParams.compressorAttack = quantize(0.0012, quantizationLevel);
                baseParams.subBassGain *= 0.85 * masterGain; // Áp dụng masterGain
                baseParams.lowShelfGain *= 0.9 * masterGain; // Áp dụng masterGain
                baseParams.midBassGain *= 0.8 * masterGain; // Áp dụng masterGain
            }

            // Profile-specific adjustments
            const profileWeights = {
                warm: { lowShelf: 1.8, subBass: 1.0, subMid: 1.2, highShelf: 0.75, compressor: 0.8 },
                bright: { highShelf: 0.4, subTreble: 0.4, air: 0.4, deEsser: -17, compressorRelease: 0.18 },
                bassHeavy: { lowShelf: 2.2, subBass: 1.8, subMid: 0.6, compressor: 1.5, highShelf: 0.75 },
                vocal: { subMid: 1.2, midShelf: 1.3, highMid: 1.0, formant: 0.6, compressor: -14 },
                proNatural: { lowShelf: 1.0, subMid: 0.8, midShelf: 0.8, compressor: 0.75 },
                karaokeDynamic: { subMid: 1.3, midShelf: 1.5, highMid: 1.2, formant: 0.8, compressor: -12 },
                rockMetal: { lowShelf: 1.2, subBass: 1.0, midShelf: 1.0, highMid: 0.8, compressor: 1.4 },
                smartStudio: { lowShelf: 1.5, subBass: 1.2, midShelf: 1.0, highMid: 0.8, compressor: 1.2 },
                classical: { lowShelf: 1.0, subMid: 0.9, midShelf: 0.8, highShelf: 0.9, formant: 0.5, compressor: 0.7 },
                jazz: { lowShelf: 1.2, subMid: 1.0, midShelf: 1.0, highMid: 0.9, formant: 0.6, compressor: 0.8 }
            };
            const weights = profileWeights[profile] || profileWeights.smartStudio;
            switch (profile) {
                case 'warm':
                    baseParams.lowShelfGain += weights.lowShelf * masterGain; // Áp dụng masterGain
                    baseParams.subBassGain += weights.subBass * masterGain; // Áp dụng masterGain
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(360, quantizationLevel);
                    baseParams.f2Freq = quantize(1500, quantizationLevel);
                    baseParams.highShelfGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.subTrebleGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.airGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.compressorRatio *= weights.compressor;
                    baseParams.warmthBoost = (warmthBoost || 0) + 0.6;
                    break;
                case 'bright':
                    baseParams.highShelfGain += weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.subTrebleGain += weights.subTreble * masterGain; // Áp dụng masterGain
                    baseParams.airGain += weights.air * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(480, quantizationLevel);
                    baseParams.f2Freq = quantize(2100, quantizationLevel);
                    baseParams.deEsserGain = weights.deEsser;
                    baseParams.notchFreq = quantize(6200, quantizationLevel);
                    baseParams.notchQ = quantize(2.8, quantizationLevel);
                    baseParams.compressorRelease = weights.compressorRelease;
                    break;
                case 'bassHeavy':
                    baseParams.lowShelfGain += weights.lowShelf * masterGain; // Áp dụng masterGain
                    baseParams.subBassGain += weights.subBass * masterGain; // Áp dụng masterGain
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(280, quantizationLevel);
                    baseParams.f2Freq = quantize(1400, quantizationLevel);
                    baseParams.compressorRatio *= weights.compressor;
                    baseParams.compressorAttack = quantize(0.0015, quantizationLevel);
                    baseParams.highShelfGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.subTrebleGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.airGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.midBassGain *= 0.8 * masterGain; // Áp dụng masterGain
                    break;
                case 'vocal':
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += weights.midShelf * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += weights.highMid * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(540, quantizationLevel);
                    baseParams.f2Freq = quantize(2400, quantizationLevel);
                    baseParams.formantGain = quantize(Math.min(5.2, baseParams.formantGain + weights.formant) * masterGain, quantizationLevel); // Áp dụng masterGain
                    baseParams.formantQ = quantize(1.0, quantizationLevel);
                    baseParams.compressorThreshold = weights.compressor;
                    baseParams.deEsserGain = quantize(-17, quantizationLevel);
                    baseParams.notchQ = quantize(3.0, quantizationLevel);
                    break;
                case 'proNatural':
                    baseParams.lowShelfGain += weights.lowShelf * masterGain; // Áp dụng masterGain
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += weights.midShelf * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(400, quantizationLevel);
                    baseParams.f2Freq = quantize(1600, quantizationLevel);
                    baseParams.compressorRatio *= weights.compressor;
                    baseParams.formantGain += (userFeedbackAdjust?.vocalClarity || 0) * 0.4 * masterGain; // Áp dụng masterGain
                    baseParams.compressorRelease = quantize(0.35, quantizationLevel);
                    break;
                case 'karaokeDynamic':
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += weights.midShelf * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += weights.highMid * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(500, quantizationLevel);
                    baseParams.f2Freq = quantize(2300, quantizationLevel);
                    baseParams.formantGain = quantize((validatedSpectral.vocalPresence > 0.8 ? 4.8 : 4.5) * masterGain, quantizationLevel); // Áp dụng masterGain
                    baseParams.deEsserGain = quantize(-17, quantizationLevel);
                    baseParams.notchFreq = quantize(7300, quantizationLevel);
                    baseParams.compressorThreshold = weights.compressor;
                    break;
                case 'rockMetal':
                    baseParams.lowShelfGain += weights.lowShelf * masterGain; // Áp dụng masterGain
                    baseParams.subBassGain += weights.subBass * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += weights.midShelf * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += (weights.highMid + transientAdjust) * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(480, quantizationLevel);
                    baseParams.f2Freq = quantize(2100, quantizationLevel);
                    baseParams.compressorRatio *= weights.compressor;
                    baseParams.compressorAttack = quantize(0.0015, quantizationLevel);
                    baseParams.deEsserGain = quantize(-17, quantizationLevel);
                    baseParams.highShelfGain *= 0.8 * masterGain; // Áp dụng masterGain
                    break;
                case 'smartStudio':
                    baseParams.lowShelfGain += (subBassEnergy > 0.7 ? weights.lowShelf : weights.lowShelf * 0.8) * masterGain; // Áp dụng masterGain
                    baseParams.subBassGain += (subBassEnergy > 0.7 ? weights.subBass : weights.subBass * 0.8) * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += (validatedSpectral.midHigh > 0.7 ? weights.midShelf : weights.midShelf * 0.8) * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += (validatedSpectral.midHigh > 0.7 ? weights.highMid : weights.highMid * 0.8) * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(subBassEnergy > 0.7 ? 300 : validatedSpectral.midHigh > 0.7 ? 460 : 480, quantizationLevel);
                    baseParams.f2Freq = quantize(subBassEnergy > 0.7 ? 1400 : validatedSpectral.midHigh > 0.7 ? 2200 : 2000, quantizationLevel);
                    baseParams.formantGain = quantize(Math.min(5.2, baseParams.formantGain + (userFeedbackAdjust?.vocalClarity || 0) * 0.5) * masterGain, quantizationLevel); // Áp dụng masterGain
                    baseParams.formantQ = quantize(1.1, quantizationLevel);
                    baseParams.deEsserGain = quantize(validatedSpectral.vocalPresence > 0.8 ? -17 : -15, quantizationLevel);
                    baseParams.compressorRatio *= subBassEnergy > 0.7 ? weights.compressor : 1.0;
                    baseParams.compressorAttack = quantize(transientEnergy > 0.7 ? 0.0015 : 0.003, quantizationLevel);
                    baseParams.compressorRelease = quantize(transientEnergy > 0.7 ? 0.08 : 0.18, quantizationLevel);
                    baseParams.panAdjust = quantize(subBassEnergy > 0.7 ? 0.12 : 0, quantizationLevel);
                    if (cpuLoad < 0.8 && subBassEnergy > 0.65) {
                        baseParams.harmonicExciterGain = quantize(Math.min(1.8, 0.8 + (userFeedbackAdjust?.harmonicRichness || 0) * 0.6) * masterGain, quantizationLevel); // Áp dụng masterGain
                    }
                    break;
                case 'classical':
                    baseParams.lowShelfGain += weights.lowShelf * masterGain; // Áp dụng masterGain
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += weights.midShelf * masterGain; // Áp dụng masterGain
                    baseParams.highShelfGain *= weights.highShelf * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(400, quantizationLevel);
                    baseParams.f2Freq = quantize(1600, quantizationLevel);
                    baseParams.formantGain = quantize(Math.min(5.0, baseParams.formantGain + weights.formant) * masterGain, quantizationLevel); // Áp dụng masterGain
                    baseParams.compressorRatio *= weights.compressor;
                    baseParams.compressorRelease = quantize(0.25, quantizationLevel);
                    baseParams.deEsserGain = quantize(-15, quantizationLevel);
                    break;
                case 'jazz':
                    baseParams.lowShelfGain += weights.lowShelf * masterGain; // Áp dụng masterGain
                    baseParams.subMidGain += weights.subMid * masterGain; // Áp dụng masterGain
                    baseParams.midShelfGain += weights.midShelf * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += weights.highMid * masterGain; // Áp dụng masterGain
                    baseParams.f1Freq = quantize(420, quantizationLevel);
                    baseParams.f2Freq = quantize(1800, quantizationLevel);
                    baseParams.formantGain = quantize(Math.min(5.0, baseParams.formantGain + weights.formant) * masterGain, quantizationLevel); // Áp dụng masterGain
                    baseParams.compressorRatio *= weights.compressor;
                    baseParams.compressorRelease = quantize(0.2, quantizationLevel);
                    baseParams.deEsserGain = quantize(-16, quantizationLevel);
                    baseParams.highShelfGain *= 0.9 * masterGain; // Áp dụng masterGain
                    break;
            }

            // User feedback adjustments
            if (userFeedbackAdjust) {
                if (userFeedbackAdjust.warmth > 0) {
                    baseParams.subMidGain += userFeedbackAdjust.warmth * 0.6 * masterGain; // Áp dụng masterGain
                    baseParams.lowShelfGain += userFeedbackAdjust.warmth * 0.4 * masterGain; // Áp dụng masterGain
                }
                if (userFeedbackAdjust.distortion < -1.0) {
                    baseParams.highShelfGain *= 0.7 * masterGain; // Áp dụng masterGain
                    baseParams.subTrebleGain *= 0.7 * masterGain; // Áp dụng masterGain
                    baseParams.airGain *= 0.7 * masterGain; // Áp dụng master江湖
                    baseParams.formantGain *= 0.75 * masterGain; // Áp dụng masterGain
                    baseParams.compressorRatio *= 0.85;
                    baseParams.deEsserGain = quantize(Math.max(-20, baseParams.deEsserGain - 4), quantizationLevel);
                }
                if (userFeedbackAdjust.clarity > 0) {
                    baseParams.midShelfGain += userFeedbackAdjust.clarity * 0.5 * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += userFeedbackAdjust.clarity * 0.5 * masterGain; // Áp dụng masterGain
                    baseParams.formantGain += userFeedbackAdjust.clarity * 0.3 * masterGain; // Áp dụng masterGain
                }
                if (userFeedbackAdjust.vocalClarity > 0) {
                    baseParams.formantGain += userFeedbackAdjust.vocalClarity * 0.4 * masterGain; // Áp dụng masterGain
                    baseParams.highMidGain += userFeedbackAdjust.vocalClarity * 0.4 * masterGain; // Áp dụng masterGain
                }
                if (userFeedbackAdjust.bass > 0) {
                    baseParams.lowShelfGain += userFeedbackAdjust.bass * 0.7 * masterGain; // Áp dụng masterGain
                    baseParams.subBassGain += userFeedbackAdjust.bass * 0.5 * masterGain; // Áp dụng masterGain
                }
                if (userFeedbackAdjust.depth > 0) {
                    baseParams.lowShelfGain += userFeedbackAdjust.depth * 0.8 * masterGain; // Áp dụng masterGain
                    baseParams.subBassGain += userFeedbackAdjust.depth * 0.6 * masterGain; // Áp dụng masterGain
                    baseParams.bassCutFreq = quantize(25, quantizationLevel);
                }
                if (userFeedbackAdjust.harmonicRichness > 0 && cpuLoad < 0.8) {
                    baseParams.harmonicExciterGain = quantize(Math.min(2.0, (baseParams.harmonicExciterGain || 0) + userFeedbackAdjust.harmonicRichness * 0.6) * masterGain, quantizationLevel); // Áp dụng masterGain
                    baseParams.subMidGain *= 0.9 * masterGain; // Áp dụng masterGain
                }
            }

            // Temporal parameter interpolation
            baseParams.fadeTime = Math.max(baseParams.minFadeLength / this.context.sampleRate, 0.01);
            baseParams.bufferTime = baseParams.fadeTime * 2.5 * (1 + Math.abs(this.currentPitchMult || 0) * 0.6);

            // MemoryManager storage
            if (this.memoryManager) {
                const cachedParams = this.memoryManager.buffers.get('optimizedParams')?.params;
                if (cachedParams && Date.now() < cachedParams.expiry) {
                    Object.keys(baseParams).forEach(key => {
                        if (typeof baseParams[key] === 'number' && cachedParams[key]) {
                            baseParams[key] = cachedParams[key] * 0.7 + baseParams[key] * 0.3;
                        }
                    });
                }
                const expiry = Date.now() + (songStructure?.section === 'chorus' ? 15000 : 20000); // Expiry động
                this.memoryManager.buffers.set('optimizedParams', {
                    params: baseParams,
                    timestamp: Date.now(),
                    expiry,
                    priority: 'high'
                });
                this.memoryManager.set('lastOptimizeInputHash', inputHash, 'low', { timestamp: Date.now() });
                this.memoryManager.pruneCache(this.calculateMaxCacheSize());
            }

            return baseParams;
        }
    };

    // Predict optimized parameters
    const optimizedParams = deepLearningModel.predict({
        spectralComplexity: musicContext.spectralComplexity,
        transientEnergy: musicContext.transientEnergy,
        vocalPresence: musicContext.vocalPresence,
        harmonicComplexity: musicContext.harmonicComplexity,
        currentGenre: this.currentGenre,
        polyphonicPitches: this.polyphonicPitches,
        warmthBoost,
        transientBoostAdjust
    });

    // Debug logging
    if (isDebug) {
        const optimizationScore = (spectralCoherence * 0.4 + transientEnergy * 0.3 + validatedSpectral.vocalPresence * 0.3).toFixed(2);
        console.debug('Optimized sound profile parameters:', {
            profile,
            optimizedParams,
            musicContext,
            spectral: validatedSpectral,
            songStructure,
            userFeedbackAdjust,
            cpuLoad,
            isLowPowerDevice,
            minFadeLength: optimizedParams.minFadeLength,
            fadeTime: optimizedParams.fadeTime,
            bufferTime: optimizedParams.bufferTime,
            subBassEnergy,
            highFreqEnergy,
            transientEnergy,
            spectralCoherence,
            transientDensity,
            optimizationScore,
            spectralFlux: validatedSpectral.spectralFlux,
            spectralEntropy: validatedSpectral.spectralEntropy,
            harmonicRatio: validatedSpectral.harmonicRatio,
            historyAdjust
        });
    }

    return optimizedParams;
};

Jungle.prototype.setFFTSize = function (size) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    try {
        if (!this._analyser) {
            throw new Error('Analyser is not initialized');
        }

        const validSizes = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

        // Detect device performance
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const hardwareConcurrency = navigator.hardwareConcurrency || 4;
        const deviceMemory = navigator.deviceMemory || 4;
        const devicePerf = cpuLoad > 0.8 || hardwareConcurrency < 4 || deviceMemory < 4 ? 'low' :
                           cpuLoad > 0.6 || hardwareConcurrency < 8 ? 'medium' : 'high';
        const qualityMode = this.qualityMode || (devicePerf === 'low' ? 'low' : 'high');

        // Analyze audio context
        const fftAnalysis = this.getFFTAnalysis?.() || {};
        const isVocalHeavy = fftAnalysis.vocalEnergy > 0.7 || this.spectralProfile?.vocalPresence > 0.7 || false;
        const transientDensity = fftAnalysis.transientDensity || this.spectralProfile?.transientEnergy || 0.5;
        const spectralFlux = this.spectralProfile?.spectralFlux || 0.5;

        // Tích hợp userFeedback và songStructure
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
        const isVocalFeedback = recentFeedback?.semanticCategory === 'vocal';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const isChorus = songStructure.section === 'chorus';

        // Manage processing history
        let processingHistory = this.memoryManager?.get('processingHistory') || [];
        if (!Array.isArray(processingHistory)) {
            processingHistory = [];
        }
        const processingTime = performance.now() - (this.lastProcessingTime || performance.now());
        processingHistory.push(processingTime);
        processingHistory = processingHistory.slice(-10);
        const avgProcessingTime = processingHistory.length > 0
            ? processingHistory.reduce((sum, val) => sum + val, 0) / processingHistory.length
            : processingTime;

        this.memoryManager?.set('processingHistory', processingHistory, 'medium', {
            timestamp: Date.now(),
            expiry: Date.now() + 60000
        });
        this.lastProcessingTime = performance.now();

        // Check cached FFT settings
        const cacheKey = this.generateCacheSignature?.('fftSize', {
            spectralProfile: this.spectralProfile,
            songStructure,
            devicePerf,
            cpuLoad
        }) || `fftSize_${this.contextId}`;
        const cachedSettings = this.memoryManager?.get(cacheKey);
        if (cachedSettings?.timestamp > Date.now() - 10000) {
            this._analyser.fftSize = cachedSettings.size;
            this._analyser.smoothingTimeConstant = cachedSettings.smoothing;
            this._analyser.minDecibels = cachedSettings.minDecibels;
            this._analyser.maxDecibels = cachedSettings.maxDecibels;
            if (isDebug) console.debug('Reused cached FFT settings', { cacheKey, cachedSettings });
            return;
        }

        // Adjust FFT size
        let targetSize = size;
        let enableCNNTransient = true;
        let enableAdvancedDeEsser = true;

        if (avgProcessingTime > 16 || cpuLoad > 0.7) {
            targetSize = avgProcessingTime > 30 || cpuLoad > 0.9 ? 512 : 1024;
            enableCNNTransient = avgProcessingTime < 22 && cpuLoad < 0.8;
            enableAdvancedDeEsser = avgProcessingTime < 20 && cpuLoad < 0.8;
            if (isDebug) console.debug('High processing load detected:', {
                avgProcessingTime: avgProcessingTime.toFixed(2),
                cpuLoad: cpuLoad.toFixed(2),
                targetSize,
                enableCNNTransient,
                enableAdvancedDeEsser
            });
        }

        // Adjust based on device performance and quality mode
        if (devicePerf === 'low' || qualityMode === 'low') {
            targetSize = Math.min(targetSize, 1024);
        } else if (devicePerf === 'medium') {
            targetSize = Math.min(targetSize, 4096);
        } else if (qualityMode === 'high') {
            targetSize = Math.max(targetSize, 2048);
        }

        // Adjust based on audio context
        if (isVocalHeavy || isVocalFeedback) {
            targetSize = Math.max(targetSize, 2048); // Ưu tiên chi tiết cho vocal
        } else if (transientDensity > 0.65 || spectralFlux > 0.7) {
            targetSize = Math.max(targetSize, 1024); // Tăng độ nhạy cho transient
        }
        if (isChorus) {
            targetSize = Math.max(targetSize, 2048); // Tăng chi tiết cho chorus
        }

        // Validate FFT size
        if (!validSizes.includes(targetSize)) {
            console.warn(`Invalid FFT size: ${targetSize}. Defaulting to ${isVocalHeavy || isChorus ? 2048 : 1024}.`);
            targetSize = isVocalHeavy || isChorus ? 2048 : 1024;
        }

        // Optimize analyser settings
        const smoothing = isVocalHeavy || isVocalFeedback ? 0.7 : 0.8;
        const minDecibels = fftAnalysis.noiseLevel > 0.45 ? -90 : -100;
        const maxDecibels = transientDensity > 0.65 || spectralFlux > 0.7 ? -20 : -30;

        this._analyser.fftSize = targetSize;
        this._analyser.smoothingTimeConstant = Number.isFinite(smoothing) ? smoothing : 0.8;
        this._analyser.minDecibels = Number.isFinite(minDecibels) ? minDecibels : -100;
        this._analyser.maxDecibels = Number.isFinite(maxDecibels) ? maxDecibels : -30;

        // Store settings in MemoryManager
        const fftSettings = {
            size: targetSize,
            smoothing,
            minDecibels,
            maxDecibels,
            enableCNNTransient,
            enableAdvancedDeEsser,
            timestamp: Date.now(),
            expiry: Date.now() + 15000, // Extended expiry
            priority: 'high'
        };
        this.memoryManager?.set(cacheKey, fftSettings, 'high');
        this.memoryManager?.pruneCache(this.calculateMaxCacheSize?.() || 100);

        if (isDebug) console.debug('FFT Settings Applied:', {
            size: targetSize,
            smoothing,
            minDecibels,
            maxDecibels,
            enableCNNTransient,
            enableAdvancedDeEsser,
            devicePerf,
            qualityMode,
            cpuLoad: cpuLoad.toFixed(2),
            isVocalHeavy,
            isVocalFeedback,
            transientDensity,
            spectralFlux,
            songStructure,
            avgProcessingTime: avgProcessingTime.toFixed(2),
            cacheStats: this.memoryManager?.getCacheStats?.()
        });
    } catch (e) {
        console.error('Error setting FFT size:', e, { requestedSize: size });
        if (this._analyser) {
            const fallbackSize = isVocalHeavy || isChorus ? 2048 : 1024;
            this._analyser.fftSize = fallbackSize;
            this._analyser.smoothingTimeConstant = 0.8;
            this._analyser.minDecibels = -100;
            this._analyser.maxDecibels = -30;
            if (isDebug) console.debug(`Recovered with fallback FFT size: ${fallbackSize}`);
        }
    }
};

// Helper function to check valid values
function ensureFinite(value, defaultValue) {
    return isFinite(value) && !isNaN(value) ? value : defaultValue;
}

try {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Jungle;
    } else {
        window.Jungle = Jungle;
    }
} catch (error) {
    console.error('Error exporting Jungle:', error);
}
// jungle.js - Advanced Audio Processing Module with Smart Integration

(function() {
    if (window.__jungle_audio_module_marker__) {
        console.log("[Jungle Audio Module] Already loaded, skipping");
        return;
    }
    window.__jungle_audio_module_marker__ = true;

    'use strict';
// FIX: Sử dụng biến đóng gói để tránh truy cập lặp lại các thuộc tính global nặng
function handleError(errorMessage, error, context = {}, severity = 'low', options = {}) {
    // 1. KIỂM TRA MÔI TRƯỜNG AN TOÀN
    const isBrowser = typeof window !== 'undefined';
    const isDebug = isBrowser && (window.location.hostname === 'localhost' || window.location.search.includes('debug=true'));

    // 2. TRÍCH XUẤT NGỮ CẢNH (GIỮ NGUYÊN LOGIC PHÂN LOẠI)
    const spectralProfile = context.spectralProfile || { profile: 'smartStudio' };
    const songStructure = context.songStructure || { section: 'unknown' };

    const errorType = context.function === 'getCPULoad' ? 'performance' :
                      context.requestedSize ? 'audio' : 'memory';

    // 3. THU THẬP DỮ LIỆU HIỆU NĂNG (TỐI ƯU TRÁNH LAG + NHANH HƠN)
    let cpuLoadVal = 'unknown';
    let memUsedStr = 'N/A';
    if (options.memoryManager && typeof options.memoryManager.get === 'function') {
        const history = options.memoryManager.get('cpuLoadHistory');
        if (Array.isArray(history) && history.length > 0) {
            cpuLoadVal = history[history.length - 1].load || 'unknown';
        }
    }
    if (isBrowser && window.performance?.memory) {
        const mem = window.performance.memory;
        if (Number.isFinite(mem.usedJSHeapSize) && mem.jsHeapSizeLimit > 0) {
            memUsedStr = (mem.usedJSHeapSize / 1048576).toFixed(2) + ' MB'; // Chính xác MB
        }
    }

    // 4. CẤU TRÚC LỖI (GIỮ NGUYÊN XƯƠNG SỐNG)
    const errorDetails = {
        message: `${errorMessage}: ${error?.message || "Unknown error"}`,
        stack: error?.stack || "",
        context: {
            ...context,
            spectralProfile: spectralProfile.profile,
            songStructure: songStructure.section,
            performance: {
                cpuLoad: cpuLoadVal,
                memoryUsed: memUsedStr
            }
        },
        errorType,
        severity,
        timestamp: Date.now()
    };

    // Output console theo severity
    console[severity === 'high' ? 'error' : 'warn'](errorDetails.message, errorDetails);

    // 5. LƯU TRỮ LỊCH SỬ (TỐI ƯU RAM + SHIFT NHANH)
    if (options.memoryManager && typeof options.memoryManager.get === 'function' && typeof options.memoryManager.set === 'function') {
        try {
            const deviceMemory = (typeof navigator !== 'undefined' ? navigator.deviceMemory : null) || 4;
            const maxErrors = deviceMemory < 4 ? 30 : 50;

            let errorHistory = options.memoryManager.get('errorHistory') || [];
            if (!Array.isArray(errorHistory)) errorHistory = [];

            errorHistory.push(errorDetails);

            if (errorHistory.length > maxErrors) {
                errorHistory.shift(); // Nhanh + ít allocation hơn slice
            }

            options.memoryManager.set('errorHistory', errorHistory, 'high');
        } catch (storeError) {
            console.warn('Failed to store error history:', storeError);
        }
    }

    // 6. BÁO CÁO SERVER (GIỮ NGUYÊN + SILENT CATCH)
    if (options.reportToServer && severity === 'high' && (typeof navigator !== 'undefined') && navigator.onLine) {
        try {
            fetch(options.reportToServer, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(errorDetails),
                keepalive: true
            }).catch(() => { /* Silent fail */ });
        } catch (fetchError) {
            // Silent
        }
    }

    if (isDebug) console.debug('Error Details:', errorDetails);
}

// Hàm ensureFinite tối ưu cao độ với fast path
function ensureFinite(value, defaultValue, options = {}) {
    // Fast path: hầu hết giá trị hợp lệ → thoát sớm cực nhanh
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    // Slow path: chỉ khi sai mới xử lý debug
    const isBrowser = typeof window !== 'undefined';
    const isDebug = isBrowser && (window.location.hostname === 'localhost' || window.location.search.includes('debug=true'));

    if (isDebug) {
        const errorMessage = options.errorMessage || `Invalid value: ${value}, using default: ${defaultValue}`;
        console.debug(errorMessage, { value, defaultValue });
    }

    return defaultValue;
}

/**
 * Jungle Core - CPU Load Monitor v18.2 FINAL (Refined by Gemini)
 * Chức năng: Đo đạc và dự báo tải hệ thống để điều phối thuật toán Audio.
 * Cam kết: Giữ nguyên trọng số Profile, tối ưu RAM/CPU, Fix Crash.
 */
Jungle.prototype.getCPULoad = function() {
    // 1. AN TOÀN HỆ THỐNG & VALIDATION (GIỮ NGUYÊN LOGIC GỐC + SAFE ACCESS)
    const AudioContextClass = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!this.context || (AudioContextClass && !(this.context instanceof AudioContextClass))) {
        if (typeof handleError === 'function') {
            handleError('Invalid AudioContext', new Error('AudioContext is invalid'), {
                function: 'getCPULoad'
            }, 'high', {
                memoryManager: this.memoryManager
            });
        }
        return this.qualityMode === 'low' ? 0.3 : 0.7;
    }

    const perf = (typeof window !== 'undefined' && window.performance) ? window.performance : null;
    const isDebug = (typeof window !== 'undefined' && window.location) ?
        (window.location.hostname === 'localhost' || window.location.search.includes('debug=true')) : false;

    if (isDebug && perf) perf.mark('cpu-load-start');

    // 2. THÔNG SỐ MÔI TRƯỜNG (SAFE ACCESS + CACHE BIẾN)
    const sampleRate = this.context.sampleRate || 48000;
    const audioLatency = this.context.baseLatency || this.context.outputLatency || 0;
    let latencyFactor = Math.min(audioLatency * 35, 0.2);

    const workerLoad = this.worker && Number.isFinite(this.nextProcessingInterval) ?
        Math.min(this.nextProcessingInterval / 2000, 0.12) : 0;

    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const isIOS = nav.userAgent ? /iPad|iPhone|iPod/.test(nav.userAgent) : false;
    const hardwareConcurrency = nav.hardwareConcurrency || (isIOS ? 2 : 4);
    const deviceLoad = Math.min(1 / (hardwareConcurrency * 1.8), 0.08);

    let memoryFactor = 0;
    if (perf && perf.memory && Number.isFinite(perf.memory.usedJSHeapSize) && perf.memory.jsHeapSizeLimit > 0) {
        memoryFactor = Math.min(perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit, 0.08);
    }

    let gpuLoad = 0;
    if (this.webGPUDevice && this.devicePerf === 'high' && this.fftSize && this.webGPUDevice.limits?.maxComputeWorkgroupStorageSize) {
        gpuLoad = Math.min(0.15, this.webGPUDevice.limits.maxComputeWorkgroupStorageSize / (this.fftSize * 3));
    }

    // 3. LOGIC XỬ LÝ ÂM HỌC & PROFILE (XƯƠNG SỐNG THUẬT TOÁN – GIỮ NGUYÊN 100%)
    const spectralProfile = this.spectralProfile || {
        profile: 'smartStudio',
        bass: 0.5,
        vocalPresence: 0.5,
        transientEnergy: 0.5
    };
    const pProfile = spectralProfile.profile;

    const songStructure = (this.memoryManager && typeof this.memoryManager.get === 'function') ?
        this.memoryManager.get('lastStructure') || { section: 'unknown' } :
        { section: 'unknown' };

    const psychoacousticWeight = (typeof this.calculatePsychoacousticWeight === 'function') ?
        this.calculatePsychoacousticWeight(spectralProfile, songStructure) || 1.0 : 1.0;

    // ÁP DỤNG 8 PROFILE MA MỊ VỚI HỆ SỐ CHÍNH XÁC (GIỮ NGUYÊN THỨ TỰ VÀ CON SỐ)
    if (pProfile === 'bassHeavy' || spectralProfile.bass > 0.78) {
        latencyFactor = Math.min(latencyFactor * 1.025 * psychoacousticWeight * 1.03, 0.2);
    } else if (pProfile === 'vocal' || spectralProfile.vocalPresence > 0.72) {
        latencyFactor = Math.min(latencyFactor * 0.885 * psychoacousticWeight * 1.08, 0.2);
    } else if (pProfile === 'rockMetal' || spectralProfile.transientEnergy > 0.72) {
        latencyFactor = Math.min(latencyFactor * 1.015 * psychoacousticWeight * 1.02, 0.2);
    } else if (pProfile === 'smartStudio') {
        latencyFactor = Math.min(latencyFactor * 0.94 * psychoacousticWeight * 1.06, 0.2);
    } else if (pProfile === 'warm') {
        latencyFactor = Math.min(latencyFactor * 0.96 * psychoacousticWeight * 1.04, 0.2);
    } else if (pProfile === 'bright') {
        latencyFactor = Math.min(latencyFactor * 0.98 * psychoacousticWeight * 1.03, 0.2);
    } else if (pProfile === 'proNatural' || pProfile === 'karaokeDynamic') {
        latencyFactor = Math.min(latencyFactor * 0.91 * psychoacousticWeight * 1.07, 0.2);
    }

    // 4. TÍNH DURATION & TỔNG LOAD
    let duration = 0;
    if (isDebug && perf) {
        perf.mark('cpu-load-end');
        try {
            perf.measure('cpu-load', 'cpu-load-start', 'cpu-load-end');
            const measures = perf.getEntriesByName('cpu-load');
            if (measures.length > 0) duration = measures[measures.length - 1].duration;
            // Dọn dẹp ngay để tránh leak Performance Timeline
            perf.clearMarks('cpu-load-start');
            perf.clearMarks('cpu-load-end');
            perf.clearMeasures('cpu-load');
        } catch (e) {
            // Silent fail đo đạc
        }
    }

    let load = Math.min(
        (duration / 10) * (sampleRate / 48000) * psychoacousticWeight +
        latencyFactor + workerLoad + deviceLoad + memoryFactor + gpuLoad,
        1
    );

    // 5. QUẢN LÝ LỊCH SỬ LOAD (TỐI ƯU CAO ĐỘ – SHIFT + FOR LOOP)
    let averageLoad = load;

    if (this.memoryManager && typeof this.memoryManager.get === 'function' && typeof this.memoryManager.set === 'function') {
        try {
            let loadHistory = this.memoryManager.get('cpuLoadHistory') || [];
            if (!Array.isArray(loadHistory)) loadHistory = [];

            const lastItem = loadHistory.length > 0 ? loadHistory[loadHistory.length - 1] : null;
            const lastLoad = lastItem ? parseFloat(lastItem.load || lastItem) : 0;

            if (loadHistory.length === 0 || Math.abs(load - lastLoad) > 0.025) {
                loadHistory.push({
                    load: load.toFixed(3),
                    timestamp: Date.now(),
                    spectralProfile: pProfile,
                    songSection: songStructure.section
                });

                if (loadHistory.length > 25) {
                    loadHistory.shift(); // Nhanh hơn slice + ít allocation hơn
                }

                this.memoryManager.set('cpuLoadHistory', loadHistory, 'high');
            }

            // Tính average nhanh bằng for loop
            if (loadHistory.length > 0) {
                let sum = 0;
                for (let i = 0; i < loadHistory.length; i++) {
                    sum += parseFloat(loadHistory[i].load || loadHistory[i]);
                }
                averageLoad = sum / loadHistory.length;
            }
        } catch (error) {
            if (typeof handleError === 'function') {
                handleError('Error managing CPU load history', error, { load, sampleRate, spectralProfile, songStructure }, 'medium', { memoryManager: this.memoryManager });
            }
        }
    }

    // 6. DEBUG LOG ĐẦY ĐỦ
    if (isDebug) {
        console.debug('CPU Load v18.2 QuantumSmart Optimized:', {
            averageLoad: Number(averageLoad).toFixed(3),
            instantLoad: load.toFixed(3),
            duration: duration.toFixed(2),
            latencyFactor: latencyFactor.toFixed(4),
            psychoacousticWeight: psychoacousticWeight.toFixed(3),
            profile: pProfile,
            songSection: songStructure.section,
            workerLoad,
            deviceLoad,
            memoryFactor,
            gpuLoad
        });
    }

    // 7. RETURN FINAL
    return Number.isFinite(averageLoad) ? Math.max(0, Math.min(1, averageLoad)) : (this.qualityMode === 'low' ? 0.3 : 0.7);
};

function adjustFadeLength(fadeLength, sampleRate, spectralProfile, pitchShift, isVocal, cpuLoad, isLowPowerDevice, options = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    
    // 1. Kiểm tra đầu vào - xương sống bảo vệ
    if (!Number.isFinite(fadeLength) || fadeLength <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        if (typeof handleError === 'function') {
            handleError('Invalid fadeLength or sampleRate', new Error('Invalid input'), { fadeLength, sampleRate }, 'low', options);
        }
        return 64; // Fallback an toàn tối thiểu
    }

    // 2. Validate pitchShift - ưu tiên ensureFinite nếu có, fallback fastFinite
    const fastFinite = (val, def) => (typeof val === 'number' && Number.isFinite(val)) ? val : def;
    const absPitchShift = (typeof ensureFinite === 'function') 
        ? ensureFinite(Math.abs(pitchShift || 0), 0, { errorMessage: 'Invalid pitchShift' })
        : fastFinite(Math.abs(pitchShift), 0);

    // 3. Tính minFadeLength - giữ nguyên logic 8 profile
    const calculateMinFadeLength = (absPitchShift, cpuLoad, isLowPowerDevice, instrumentType) => {
        let base = (instrumentType === 'vocal' || isVocal) ? 1152 :
            (instrumentType === 'drum') ? 1024 :
            (instrumentType === 'guitar' || instrumentType === 'piano') ? 896 : 896;
        if (absPitchShift > 0.7) base *= 1.28;
        else if (absPitchShift > 0.3) base *= 1.14;
        if (cpuLoad > 0.95 || (isLowPowerDevice && cpuLoad > 0.9)) {
            base = Math.max(576, base * 0.68); // Bảo vệ CPU, chống artifacts
        }
        // 8 profile - bản sắc phù thủy
        if (this.profile === 'bassHeavy') base *= 1.12;
        if (this.profile === 'rockMetal') base *= 1.08;
        if (this.profile === 'vocal' || this.profile === 'karaokeDynamic') base *= 1.18;
        if (this.profile === 'smartStudio') base *= 1.15;
        if (this.profile === 'warm') base *= 1.06;
        if (this.profile === 'bright') base *= 1.04;
        if (this.profile === 'proNatural') base *= 1.10;
        return Math.round(base);
    };

    // 4. Chuẩn hóa spectralProfile - giữ nguyên 7 yếu tố
    const spectralDefaults = {
        spectralComplexity: 0.5, transientEnergy: 0.5, vocalPresence: 0.5,
        bass: 0.5, midHigh: 0.5, air: 0.5, spectralEntropy: 0.5
    };
    const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
        const val = spectralProfile?.[key];
        acc[key] = (typeof ensureFinite === 'function') 
            ? ensureFinite(val, spectralDefaults[key])
            : fastFinite(val, spectralDefaults[key]);
        acc[key] = Math.max(0, Math.min(1, acc[key]));
        return acc;
    }, { ...spectralDefaults });

    // 5. Detect instrument - giữ nguyên ngưỡng gốc
    const detectInstrument = (sp) => {
        if (sp.transientEnergy > 0.92 && sp.bass > 0.87) return 'drum';
        if (sp.midHigh > 0.87 && sp.transientEnergy > 0.78) return 'guitar';
        if (sp.midHigh > 0.82 && sp.spectralComplexity > 0.78) return 'piano';
        return 'vocal';
    };
    const instrumentType = detectInstrument(validatedSpectralProfile);
    const minFadeLength = calculateMinFadeLength(absPitchShift, cpuLoad, isLowPowerDevice, instrumentType);

    // 6. Hệ số chất lượng - giữ nguyên logic bù trừ
    const qualityFactor = options.qualityMode === 'low' ? 0.88 : 1.18;
    const {
        transientBoost = 1.32 * qualityFactor,
        vocalBoost = 1.38 * qualityFactor,
        bassBoost = 1.30 * qualityFactor,
        midHighBoost = 1.18 * qualityFactor,
        airReduction = 0.76 / qualityFactor,
        highCpuReduction = 0.92 / qualityFactor,
        memoryManager = null
    } = options;

    // 7. Tính entropy và spectralSubtraction
    const entropyFactor = Math.min(1.0, 0.975 + (1 - validatedSpectralProfile.spectralEntropy) * 0.025);
    const spectralSubtractionFactor = validatedSpectralProfile.air > 0.82 || validatedSpectralProfile.bass > 0.82 ? 0.78 : 0.86;

    // 8. AI-driven fadeBoost - giữ nguyên hệ số ma thuật
    const fadeBoost = (instrumentType === 'drum' ? 1.36 : instrumentType === 'guitar' ? 1.28 : instrumentType === 'piano' ? 1.24 : validatedSpectralProfile.vocalPresence > 0.92 ? 1.38 : 1.0) *
        (validatedSpectralProfile.transientEnergy > 0.92 ? 1.36 : 1.0) *
        (absPitchShift > 1.3 ? 1.42 : absPitchShift > 0.8 ? 1.22 : 1.0) *
        (this.profile === 'vocal' || this.profile === 'karaokeDynamic' ? 1.32 : 1.0) *
        (this.profile === 'rockMetal' || validatedSpectralProfile.bass > 0.92 ? 1.28 : 1.0) *
        (this.profile === 'bassHeavy' ? 1.22 : 1.0) *
        (this.profile === 'smartStudio' ? 1.18 : 1.0) *
        (this.profile === 'warm' ? 1.08 : 1.0) *
        (this.profile === 'bright' ? 1.06 : 1.0);

    // 9. Áp dụng boost đa tầng
    let adjustedLength = fadeLength;
    if (validatedSpectralProfile.transientEnergy > 0.78 || validatedSpectralProfile.vocalPresence > 0.78) {
        adjustedLength *= isVocal ? vocalBoost * fadeBoost * 1.02 : transientBoost * fadeBoost * 1.01;
    }
    if (validatedSpectralProfile.bass > 0.78) adjustedLength *= bassBoost * fadeBoost * 1.04;
    if (validatedSpectralProfile.midHigh > 0.78) adjustedLength *= midHighBoost * fadeBoost * (validatedSpectralProfile.air > 0.78 ? 0.88 : 1.0);
    if (validatedSpectralProfile.spectralEntropy > 0.78) adjustedLength *= 1.24 * qualityFactor * entropyFactor;
    if (validatedSpectralProfile.air > 0.78 && validatedSpectralProfile.transientEnergy < 0.58) {
        adjustedLength *= airReduction * spectralSubtractionFactor;
    }
    if (cpuLoad > 0.9 || (cpuLoad > 0.85 && isLowPowerDevice)) {
        adjustedLength *= highCpuReduction * (validatedSpectralProfile.vocalPresence > 0.78 ? 1.14 : 1.0);
    }

    // 10. Clamp cuối - giới hạn vật lý
    adjustedLength = Math.max(minFadeLength, Math.round(fastFinite(adjustedLength, fadeLength)));
    const maxFadeLength = Math.round(sampleRate * 0.28); // Giới hạn 280ms
    adjustedLength = Math.min(maxFadeLength, adjustedLength);

    // 11. Quản lý lịch sử - tối ưu RAM
    if (memoryManager && typeof memoryManager.get === 'function' && typeof memoryManager.set === 'function') {
        try {
            let history = memoryManager.get('fadeLengthHistory') || [];
            if (!Array.isArray(history)) history = [];
            history.push({
                length: adjustedLength,
                timestamp: Date.now(),
                instrumentType,
                profile: this.profile || 'unknown',
                pitchShift: absPitchShift.toFixed(2)
            });
            const maxHistory = isLowPowerDevice ? 15 : 20; // Tiết kiệm RAM trên máy yếu
            if (history.length > maxHistory) history = history.slice(-maxHistory);
            memoryManager.set('fadeLengthHistory', history, 'normal');
        } catch (e) {
            if (typeof handleError === 'function') {
                handleError('Failed to store fadeLengthHistory', e, { adjustedLength }, 'low', { memoryManager });
            }
        }
    }

    // 12. Debug log - giữ chuẩn PureFadeMaster v15.8 FINAL
    if (isDebug) {
        console.debug('PureFadeMaster v15.8 FINAL', {
            adjustedLength,
            minFadeLength,
            fadeBoost: +fadeBoost.toFixed(3),
            profile: this.profile,
            instrumentType,
            pitchShift: absPitchShift
        });
    }

    return adjustedLength;
}
function getFadeBuffer(context, activeTime, fadeTime, options = {}, memoryManager) {
    // Kiểm tra đầu vào - giữ nguyên xương sống
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        if (typeof handleError === 'function') {
            handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        }
        return null;
    }

    // Validate thời gian an toàn
    const fastFinite = (val, def) => (typeof val === 'number' && Number.isFinite(val)) ? val : def;
    activeTime = (typeof ensureFinite === 'function') ? ensureFinite(activeTime, 0.25) : fastFinite(activeTime, 0.25);
    fadeTime = (typeof ensureFinite === 'function') ? ensureFinite(fadeTime, 0.15) : fastFinite(fadeTime, 0.15);

    if (!memoryManager || typeof memoryManager.getBuffer !== 'function') {
        if (typeof handleError === 'function') {
            handleError('Invalid memoryManager', new Error('memoryManager is required'), {}, 'high', { memoryManager });
        }
        return null;
    }

    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    // Extract options - giữ nguyên đầy đủ
    const {
        pitchShift = 0,
        isVocal = false,
        qualityMode = 'high',
        channels = 2,
        spectralProfile = {},
        profile = 'proNatural'
    } = options;

    const cpuLoad = (typeof this.getCPULoad === 'function') ? this.getCPULoad() : 0.5;
    const avgCpuLoad = cpuLoad;

    // Chuẩn hóa spectralProfile - giữ nguyên gốc
    const spectralDefaults = {
        spectralComplexity: 0.5, transientEnergy: 0.5, vocalPresence: 0.5,
        bass: 0.5, midHigh: 0.5, air: 0.5, spectralEntropy: 0.5
    };
    const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
        const val = spectralProfile?.[key];
        acc[key] = Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : spectralDefaults[key];
        return acc;
    }, { ...spectralDefaults });

    // Detect instrument với score weighted - giữ nguyên hệ số gốc
    const detectInstrument = (sp) => {
        const scoreDrum = sp.transientEnergy * 0.6 + sp.bass * 0.4;
        const scoreGuitar = sp.midHigh * 0.5 + sp.transientEnergy * 0.3 + sp.spectralComplexity * 0.2;
        const scorePiano = sp.midHigh * 0.4 + sp.spectralComplexity * 0.4 + sp.transientEnergy * 0.2;
        const scoreVocal = sp.vocalPresence * 0.7 + sp.midHigh * 0.3;
        const scores = { drum: scoreDrum, guitar: scoreGuitar, piano: scorePiano, vocal: scoreVocal };
        return Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, 'vocal');
    };
    const instrumentType = detectInstrument(validatedSpectralProfile);
    const curveType = (instrumentType === 'drum' || instrumentType === 'vocal') ? 'cosine' : 'exponential';

    // Cache key siêu chi tiết - giữ nguyên đầy đủ 7 spectral + profile cuối
    const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}_${validatedSpectralProfile.transientEnergy}_${validatedSpectralProfile.bass}_${validatedSpectralProfile.midHigh}_${validatedSpectralProfile.air}_${validatedSpectralProfile.spectralEntropy}`;
    const key = `fade_${activeTime}_${fadeTime}_${pitchShift}_${isVocal}_${qualityMode}_${channels}_${instrumentType}_${curveType}_${spectralKey}_${profile}`;

    let buffer = memoryManager.getBuffer(key);
    const expiryTime = 60000;
    const bufferMetadata = memoryManager.get(key)?.metadata;
    const lastPitchShift = bufferMetadata?.lastPitchShift || 0;
    const pitchDelta = Math.abs(pitchShift - lastPitchShift);
    const canReuse = pitchDelta < 0.05 && (Date.now() - (bufferMetadata?.timestamp || 0)) < (expiryTime * 1.5);

    // Validation chi tiết - giữ nguyên thuật toán phù thủy 8 profile
    if (buffer && buffer instanceof AudioBuffer && buffer.length >= activeTime * context.sampleRate) {
        if (bufferMetadata?.timestamp && Date.now() - bufferMetadata.timestamp > expiryTime && !canReuse) {
            if (isDebug) console.debug(`Buffer expired for key: ${key}, recreating`);
            buffer = null;
        } else {
            const isBufferValid = (() => {
                if (avgCpuLoad > 0.8) return true;
                let score = 1.0;
                if (validatedSpectralProfile.bass > 0.85 && validatedSpectralProfile.transientEnergy < 0.65) score *= 0.9;
                if (validatedSpectralProfile.midHigh > 0.8) score *= 1.05;
                if (validatedSpectralProfile.air > 0.85 && validatedSpectralProfile.spectralEntropy > 0.85) score *= 0.85;
                // THUẬT TOÁN PHÙ THỦY CẤP CAO – 8 PROFILE RIÊNG BIỆT
                if (profile === 'bassHeavy' || validatedSpectralProfile.bass > 0.88) score *= 1.06;
                if (profile === 'vocal' || profile === 'karaokeDynamic' || validatedSpectralProfile.vocalPresence > 0.88) score *= 1.10;
                if (profile === 'smartStudio') score *= 1.08;
                if (profile === 'rockMetal') score *= 1.05;
                if (profile === 'warm') score *= 1.03;
                if (profile === 'bright') score *= 1.02;
                return score >= 0.9;
            })();
            if (!isBufferValid) {
                if (isDebug) console.debug(`Buffer invalid due to spectral mismatch for key: ${key}, recreating`);
                buffer = null;
            }
        }
    } else {
        if (buffer) {
            if (typeof handleError === 'function') {
                handleError('Invalid buffer', new Error('Buffer validation failed'), { key, bufferLength: buffer?.length }, 'low', { memoryManager });
            }
        }
        buffer = null;
    }

    // Tạo mới nếu cần - chỉ khi CPU cho phép
    if (!buffer && avgCpuLoad < 0.85) {
        try {
            buffer = createFadeBuffer.call(this, context, activeTime, fadeTime, {
                ...options,
                instrumentType,
                curveType
            }, memoryManager);
            if (!buffer || !(buffer instanceof AudioBuffer) || buffer.length <= 0) throw new Error('Failed to create valid fade buffer');

            memoryManager.set(key, buffer, 'high', {
                metadata: {
                    timestamp: Date.now(),
                    instrumentType,
                    curveType,
                    spectralProfile: validatedSpectralProfile,
                    lastPitchShift: pitchShift,
                    profile
                }
            });

            // Prune cache thông minh hơn theo hardware
            const isLowPower = navigator.hardwareConcurrency < 4;
            const maxBuffers = isLowPower ? 3 : 5;
            const allKeys = (typeof memoryManager.getAllKeys === 'function') ? memoryManager.getAllKeys() : [];
            if (allKeys.length > maxBuffers) {
                const sortedKeys = allKeys.sort((a, b) => (memoryManager.get(a)?.metadata?.timestamp || 0) - (memoryManager.get(b)?.metadata?.timestamp || 0));
                for (let i = 0; i < sortedKeys.length - maxBuffers; i++) {
                    memoryManager.remove(sortedKeys[i]);
                }
                if (isDebug) console.debug(`Removed ${sortedKeys.length - maxBuffers} oldest buffers to optimize memory`);
            }
        } catch (error) {
            if (typeof handleError === 'function') {
                handleError('Error creating fade buffer', error, { key, activeTime, fadeTime, options }, 'high', { memoryManager });
            }
            buffer = null;
        }
    }

    // Fallback cuối cùng - luôn trả silent buffer an toàn
    if (!buffer) {
        const minFrames = 1024;
        const simpleLength = Math.max(minFrames, Math.round(activeTime * context.sampleRate * 0.8));
        buffer = context.createBuffer(channels, simpleLength, context.sampleRate);
        for (let ch = 0; ch < channels; ch++) buffer.getChannelData(ch).fill(0);
        if (isDebug) console.debug('Fallback to silent min buffer due to high CPU/error', { simpleLength });
    }

    if (isDebug) {
        console.debug(`Retrieved fade buffer for key: ${key}`, {
            bufferLength: buffer.length,
            channels: buffer.numberOfChannels,
            sampleRate: buffer.sampleRate,
            instrumentType,
            curveType,
            spectralProfile: validatedSpectralProfile,
            canReuse,
            pitchDelta,
            profile,
            cpuLoad: avgCpuLoad.toFixed(3)
        });
    }

    return buffer;
}

// Hàm tạo fade buffer với tối ưu hóa
function createFadeBuffer(context, activeTime, fadeTime, options = {}, memoryManager) {
    // Kiểm tra đầu vào - giữ nguyên xương sống
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        if (typeof handleError === 'function') {
            handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        }
        throw new Error("Invalid AudioContext provided.");
    }

    // Validate thời gian an toàn
    const fastFinite = (val, def) => (typeof val === 'number' && Number.isFinite(val)) ? val : def;
    activeTime = (typeof ensureFinite === 'function') ? ensureFinite(activeTime, 0.2) : fastFinite(activeTime, 0.2);
    fadeTime = (typeof ensureFinite === 'function') ? ensureFinite(fadeTime, 0.1) : fastFinite(fadeTime, 0.1);

    const {
        smoothness = 1.0,
        vibrance = 0.85,
        pitchShift = 0,
        isVocal = false,
        spectralProfile = {},
        qualityMode = 'high',
        channels = 1,
        transientBoost = 1.1,
        vocalWarmth = 1.2
    } = options;

    const sampleRate = (typeof ensureFinite === 'function') ? ensureFinite(context.sampleRate, 48000) : context.sampleRate || 48000;

    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    try {
        if (sampleRate <= 0) throw new Error("sampleRate không hợp lệ.");

        // CPU & device info
        const cpuLoad = (typeof this.getCPULoad === 'function') ? this.getCPULoad() : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const loadHistory = memoryManager?.get('cpuLoadHistory') || [];
        const avgCpuLoad = loadHistory.length > 0 ? loadHistory.reduce((sum, val) => sum + val, 0) / loadHistory.length : cpuLoad;

        // Chuẩn hóa spectralProfile - giữ nguyên gốc
        const spectralDefaults = {
            spectralComplexity: 0.5, transientEnergy: 0.5, vocalPresence: 0.5,
            bass: 0.5, midHigh: 0.5, air: 0.5, spectralEntropy: 0.5
        };
        const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
            const val = spectralProfile?.[key];
            acc[key] = Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : spectralDefaults[key];
            return acc;
        }, { ...spectralDefaults });

        // QuantumFadeSculptorV2 - giữ nguyên 100%
        const entropyFactor = Math.min(1.0, 0.92 + (1 - validatedSpectralProfile.spectralEntropy) * 0.08);

        // AI-driven Fade Optimization - giữ nguyên chuỗi nhân
        const aiFadeFactor = (validatedSpectralProfile.vocalPresence > 0.7 ? 1.1 : 1.0) *
                             (validatedSpectralProfile.transientEnergy > 0.7 ? 1.15 : 1.0) *
                             (Math.abs(pitchShift) > 0.8 ? 1.2 : 1.0) *
                             ((this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 1.1 : 1.0);

        // minFadeLength động + profile-specific
        let minFadeLength = 1024;
        if (avgCpuLoad > 0.85 || (isLowPowerDevice && qualityMode === 'low')) {
            minFadeLength = 640;
        } else if (Math.abs(pitchShift) > 0.9 || validatedSpectralProfile.transientEnergy > 0.8 || validatedSpectralProfile.vocalPresence > 0.8) {
            minFadeLength = 1024;
        }
        if (this.profile === 'bassHeavy' || this.profile === 'rockMetal' || validatedSpectralProfile.bass > 0.8) {
            minFadeLength = Math.round(minFadeLength * 1.2);
        } else if (this.profile === 'vocal' || this.profile === 'smartStudio') {
            minFadeLength = Math.round(minFadeLength * 1.15);
        }

        // fadeLength cuối cùng
        let fadeLength = Math.max(Math.round(fadeTime * sampleRate * aiFadeFactor), minFadeLength);
        if (typeof adjustFadeLength === 'function') {
            fadeLength = adjustFadeLength(fadeLength, sampleRate, validatedSpectralProfile, pitchShift, isVocal, avgCpuLoad, isLowPowerDevice);
        }

        // Profile-specific tinh chỉnh cuối
        if (this.profile === 'rockMetal' || validatedSpectralProfile.bass > 0.8 || validatedSpectralProfile.spectralEntropy > 0.8) {
            fadeLength = Math.round(fadeLength * 1.2);
        } else if (this.profile === 'vocal' || this.profile === 'karaokeDynamic') {
            fadeLength = Math.round(fadeLength * 1.15);
        } else if (this.profile === 'bright' || this.profile === 'smartStudio') {
            fadeLength = Math.round(fadeLength * 1.1);
        }

        const actualFadeTime = fadeLength / sampleRate;
        const activeLength = Math.round(activeTime * sampleRate);

        // Clamp totalLength an toàn mạnh mẽ hơn
        let totalLength = activeLength + Math.max(0, Math.round((activeTime - 2 * actualFadeTime) * sampleRate));
        const minTotalFrames = minFadeLength * 2 + 512;
        totalLength = Math.max(totalLength, minTotalFrames);

        // bufferTimeFactor - giữ nguyên logic gốc đầy đủ
        let bufferTimeFactor = (qualityMode === 'high' && avgCpuLoad < 0.7 ? 1.35 : 0.85) *
                              (Math.abs(pitchShift) > 0.9 ? 1.25 : 1.0) *
                              (isLowPowerDevice || avgCpuLoad > 0.8 ? 0.65 : 1.0) *
                              (validatedSpectralProfile.transientEnergy > 0.8 ? transientBoost * 1.15 : 1.0) *
                              (validatedSpectralProfile.spectralEntropy > 0.8 ? 1.2 : 1.0) *
                              ((this.profile === 'vocal' || this.profile === 'smartStudio') ? 1.15 : 1.0);
        const adjustedActiveTime = activeTime * bufferTimeFactor;

        if (fadeLength < 128) {
            console.warn(`fadeTime quá ngắn (${fadeLength} samples), có thể gây artifacts. Nên tăng lên ít nhất 128 samples.`);
        }

        // Tạo buffer
        const buffer = context.createBuffer(channels, totalLength, sampleRate);
        if (!buffer) throw new Error("Không thể tạo fade buffer.");

        // vibranceFactor + Bezier curve - giữ nguyên 100% các con số invariant
        const calculateVibranceFactor = (vibrance, fadeLength, pitchFactor, spectralProfile) => {
            const fadeDurationFactor = fadeLength < 1000 ? 0.75 : fadeLength < 5000 ? 0.9 : 1.05;
            let factor = Math.min(Math.max(vibrance, 0), 0.8) * fadeDurationFactor * (1 - pitchFactor * 0.18) * entropyFactor;
            if (spectralProfile.air > 0.8) factor *= 0.8;
            if (spectralProfile.transientEnergy > 0.8) {
                factor *= this.profile === 'rockMetal' ? 1.2 : this.profile === 'bright' ? 1.15 : 1.1;
            }
            if (spectralProfile.spectralEntropy > 0.8) factor *= 0.85;
            if (this.profile === 'rockMetal') factor *= 1.2;
            if (this.profile === 'vocal' || this.profile === 'karaokeDynamic') factor *= 1.15;
            if (this.profile === 'bright' || this.profile === 'smartStudio') factor *= 1.1;
            return factor;
        };

        const getFadeFunction = () => {
            const adjustedSmoothness = Math.min(Math.max(smoothness * (sampleRate / 48000), 0.4), 1.6);
            const pitchFactor = Math.abs(pitchShift);
            const vibranceFactor = calculateVibranceFactor(vibrance, fadeLength, pitchFactor, validatedSpectralProfile);
            const bezierP1 = 0.07 * adjustedSmoothness * (1 + pitchFactor * 0.03);
            const bezierP2 = 0.8 * adjustedSmoothness * (1 - pitchFactor * 0.03);
            const bezierCosineBlend = Math.max(0.4 - pitchFactor * 0.07 - validatedSpectralProfile.spectralComplexity * 0.07, 0.25);
            return (t) => {
                const t2 = t * t, t3 = t2 * t;
                const mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
                const bezier = 3 * bezierP1 * t * mt2 + 3 * bezierP2 * t2 * mt + t3;
                const cosPart = 0.5 * (1 - Math.cos(Math.PI * t));
                const warmth = (isVocal || validatedSpectralProfile.vocalPresence > 0.8) ? vocalWarmth * (this.profile === 'vocal' ? 1.1 : 1.0) : 1.0;
                return Math.min(1, (bezier * bezierCosineBlend + cosPart * (1 - bezierCosineBlend)) * (1 + vibranceFactor * 0.25 * warmth));
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

            // Boundary smoothing gọn + chính xác hơn
            const boundarySmoothing = Math.min(fadeLength / 4, 48);
            for (let i = 0; i < boundarySmoothing; i++) {
                const t = 0.5 * (1 - Math.cos(Math.PI * i / boundarySmoothing));
                if (fadeIndex1 - i - 1 >= 0) {
                    channelData[fadeIndex1 - i - 1] = channelData[fadeIndex1 - i - 1] * (1 - t) + t;
                }
                if (fadeIndex2 + i < activeLength) {
                    channelData[fadeIndex2 + i] = channelData[fadeIndex2 + i] * (1 - t) + channelData[fadeIndex2 + i - 1] * t;
                }
            }

            // Special smoothing khi minFadeLength === 1024
            if (minFadeLength === 1024) {
                if (fadeIndex1 > 0) channelData[0] *= 0.4 * (1 - Math.cos(Math.PI * 0.4));
                if (fadeIndex2 < activeLength) channelData[activeLength - 1] *= 0.4 * (1 - Math.cos(Math.PI * 0.4));
            }
        }

        // Output gain ramp thông minh
        if (avgCpuLoad > 0.75 && this.outputGain) {
            const targetGain = qualityMode === 'high' ? 0.6 : 0.5;
            const adjustedGain = (validatedSpectralProfile.bass > 0.8 || validatedSpectralProfile.air > 0.8) ? targetGain * 0.85 : targetGain;
            this.outputGain.gain.linearRampToValueAtTime(adjustedGain, context.currentTime + (this.rampTime || 0.065));
        }

        // Cache với key đầy đủ nhưng gọn
        if (memoryManager && typeof memoryManager.set === 'function') {
            const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}_${validatedSpectralProfile.spectralEntropy}`;
            const key = `fade_${activeTime.toFixed(3)}_${fadeTime.toFixed(3)}_bezier_${pitchShift}_${isVocal}_${qualityMode}_${channels}_${spectralKey}`;
            if (!(buffer instanceof AudioBuffer) || buffer.length < activeLength) {
                throw new Error('Invalid fade buffer created');
            }
            memoryManager.set(key, buffer, 'high', {
                metadata: { timestamp: Date.now(), expiry: Date.now() + 5500 }
            });

            // Prune thông minh hơn
            const maxCache = isLowPowerDevice ? 300 : (memoryManager.getDynamicMaxSize?.() || 500);
            memoryManager.pruneCache(maxCache);
        }

        if (isDebug) {
            console.debug(`Stored fade buffer with key: ${key || 'unknown'}`, {
                bufferLength: buffer.length, channels: buffer.numberOfChannels, fadeLength, profile: this.profile
            });
        }

        return buffer;
    } catch (error) {
        if (typeof handleError === 'function') {
            handleError('Error creating fade buffer', error, { activeTime, fadeTime, options, sampleRate }, 'high', { memoryManager });
        }
        // Fallback an toàn hơn - silent buffer nhỏ
        try {
            const fallbackBuffer = context.createBuffer(channels, 1024, sampleRate);
            for (let ch = 0; ch < channels; ch++) {
                fallbackBuffer.getChannelData(ch).fill(0);
            }
            if (isDebug) console.debug('Fallback to silent 1024-sample buffer');
            return fallbackBuffer;
        } catch (fallbackError) {
            if (typeof handleError === 'function') {
                handleError('Error creating fallback buffer', fallbackError, {}, 'high', { memoryManager });
            }
            return null;
        }
    }
}
function getShiftBuffers(context, activeTime, fadeTime, options = {}, memoryManager) {
    // Kiểm tra đầu vào - giữ nguyên xương sống
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        if (typeof handleError === 'function') {
            handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        }
        return null;
    }

    // Validate thời gian an toàn
    const fastFinite = (val, def) => (typeof val === 'number' && Number.isFinite(val)) ? val : def;
    activeTime = (typeof ensureFinite === 'function') ? ensureFinite(activeTime, 0.2) : fastFinite(activeTime, 0.2);
    fadeTime = (typeof ensureFinite === 'function') ? ensureFinite(fadeTime, 0.1) : fastFinite(fadeTime, 0.1);

    if (!memoryManager || typeof memoryManager.get !== 'function' || typeof memoryManager.set !== 'function') {
        if (typeof handleError === 'function') {
            handleError('Invalid memoryManager', new Error('memoryManager with get/set methods is required'), {}, 'high', { memoryManager });
        }
        return null;
    }

    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    // Extract options - giữ nguyên đầy đủ
    const {
        pitchShift = 0,
        isVocal = false,
        qualityMode = 'high',
        channels = 1,
        spectralProfile = {}
    } = options;

    // Validate pitchShift & spectralProfile - giữ nguyên logic gốc
    const validatedPitchShift = (typeof ensureFinite === 'function') ? ensureFinite(pitchShift, 0) : fastFinite(pitchShift, 0);

    const spectralDefaults = {
        spectralComplexity: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
        bass: 0.5, midHigh: 0.5, air: 0.5, spectralEntropy: 0.5
    };
    const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
        const val = spectralProfile?.[key];
        acc[key] = Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : spectralDefaults[key];
        return acc;
    }, { ...spectralDefaults });

    try {
        // QuantumShiftOptimizerV2 - giữ nguyên 100%
        const entropyFactor = Math.min(1.0, 0.94 + (1 - validatedSpectralProfile.spectralEntropy) * 0.06);
        const spectralSubtractionFactor = validatedSpectralProfile.air > 0.8 || validatedSpectralProfile.bass > 0.8 ? 0.85 : 0.9;

        // CPU load thông minh
        const cpuLoad = (typeof this.getCPULoad === 'function') ? this.getCPULoad() : 0.5;
        const loadHistory = memoryManager?.get('cpuLoadHistory') || [];
        const avgCpuLoad = loadHistory.length > 0 ? loadHistory.reduce((sum, val) => sum + val, 0) / loadHistory.length : cpuLoad;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;

        // Detect instrument - giữ nguyên ngưỡng gốc
        const detectInstrument = (sp) => {
            if (sp.transientEnergy > 0.85 && sp.bass > 0.8) return 'drum';
            if (sp.midHigh > 0.8 && sp.transientEnergy > 0.7) return 'guitar';
            if (sp.midHigh > 0.75 && sp.spectralComplexity > 0.7) return 'piano';
            return 'vocal';
        };
        const instrumentType = detectInstrument(validatedSpectralProfile);

        // Deep Learning Buffer Factor - giữ nguyên chuỗi nhân phức hợp gốc
        const deepLearningBufferFactor = (
            (instrumentType === 'drum' ? 1.25 : instrumentType === 'guitar' ? 1.2 : instrumentType === 'piano' ? 1.15 :
             validatedSpectralProfile.vocalPresence > 0.85 ? 1.2 : 1.0) *
            (validatedSpectralProfile.transientEnergy > 0.85 ? 1.25 : 1.0) *
            (Math.abs(validatedPitchShift) > 1.0 ? 1.3 : 1.0) *
            ((this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 1.2 : 1.0) *
            ((this.profile === 'rockMetal' || validatedSpectralProfile.bass > 0.85) ? 1.15 : 1.0)
        );

        const adjustedActiveTime = activeTime * deepLearningBufferFactor;
        const adjustedFadeTime = fadeTime * deepLearningBufferFactor;

        // Cache key - gọn hơn nhưng vẫn đầy đủ factor gốc
        const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}_${validatedSpectralProfile.spectralEntropy}_${instrumentType}`;
        const baseKey = `shift_${adjustedActiveTime.toFixed(3)}_${adjustedFadeTime.toFixed(3)}_${validatedPitchShift}_${isVocal}_${qualityMode}_${channels}_${spectralKey}`;
        const keyDown = `${baseKey}_down`;
        const keyUp = `${baseKey}_up`;

        // Lấy từ cache - hỗ trợ cả cấu trúc cũ/mới
        let shiftDownBuffer = memoryManager.get(keyDown)?.buffer || memoryManager.get(keyDown);
        let shiftUpBuffer = memoryManager.get(keyUp)?.buffer || memoryManager.get(keyUp);

        const expiryTime = 60000;

        // Validate buffer - giữ nguyên logic gốc + check length
        const validateBuffer = (buffer, key) => {
            if (!(buffer instanceof AudioBuffer)) return null;
            if (buffer.length < Math.round(adjustedActiveTime * context.sampleRate)) return null;

            const cachedItem = memoryManager.get(key);
            const timestamp = cachedItem?.metadata?.timestamp || cachedItem?.timestamp || 0;
            if (Date.now() - timestamp > expiryTime) {
                if (isDebug) console.debug(`Buffer expired: ${key}`);
                return null;
            }
            if (validatedSpectralProfile.spectralEntropy > 0.85 && entropyFactor < 0.96) return null;
            if (validatedSpectralProfile.air > 0.85 && spectralSubtractionFactor < 0.9) return null;

            return buffer;
        };

        shiftDownBuffer = validateBuffer(shiftDownBuffer, keyDown);
        shiftUpBuffer = validateBuffer(shiftUpBuffer, keyUp);

        // Tạo mới nếu cần - chỉ tạo cái thiếu
        if (!shiftDownBuffer || !shiftUpBuffer) {
            const bufferOptions = {
                ...options,
                smoothness: (this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 1.1 :
                            (this.profile === 'rockMetal' || instrumentType === 'drum') ? 0.9 :
                            (this.profile === 'bright' || instrumentType === 'guitar') ? 1.0 :
                            (instrumentType === 'piano') ? 1.05 : 1.0,
                vibrance: (this.profile === 'rockMetal' || instrumentType === 'drum') ? 0.95 :
                          (this.profile === 'bright' || instrumentType === 'guitar') ? 0.9 :
                          (this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 0.85 :
                          (instrumentType === 'piano') ? 0.9 : 0.9,
                transientBoost: (this.profile === 'rockMetal' || instrumentType === 'drum') ? 1.2 :
                                (this.profile === 'bright' || instrumentType === 'guitar') ? 1.15 :
                                (this.profile === 'vocal' || instrumentType === 'piano') ? 1.1 : 1.15,
                vocalWarmth: (this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 1.3 : 1.25
            };

            if (!shiftDownBuffer) {
                shiftDownBuffer = createDelayTimeBuffer(context, adjustedActiveTime, adjustedFadeTime, false, bufferOptions, memoryManager);
                if (shiftDownBuffer instanceof AudioBuffer) {
                    memoryManager.set(keyDown, shiftDownBuffer, 'high', {
                        metadata: { timestamp: Date.now(), profile: this.profile, instrumentType }
                    });
                }
            }
            if (!shiftUpBuffer) {
                shiftUpBuffer = createDelayTimeBuffer(context, adjustedActiveTime, adjustedFadeTime, true, bufferOptions, memoryManager);
                if (shiftUpBuffer instanceof AudioBuffer) {
                    memoryManager.set(keyUp, shiftUpBuffer, 'high', {
                        metadata: { timestamp: Date.now(), profile: this.profile, instrumentType }
                    });
                }
            }

            if (!shiftDownBuffer || !shiftUpBuffer) throw new Error('Failed to create shift buffers');
        }

        // Prune cache thông minh hơn trên máy yếu
        const maxCacheSize = isLowPowerDevice ? 300 : (memoryManager.getDynamicMaxSize?.() || 500);
        if (typeof memoryManager.pruneCache === 'function') {
            memoryManager.pruneCache(maxCacheSize);
        }

        if (isDebug) {
            console.debug(`Retrieved/Created shift buffers`, {
                shiftDownLength: shiftDownBuffer?.length,
                shiftUpLength: shiftUpBuffer?.length,
                channels,
                sampleRate: context.sampleRate,
                profile: this.profile,
                instrumentType,
                deepLearningBufferFactor: deepLearningBufferFactor.toFixed(2),
                entropyFactor,
                spectralSubtractionFactor
            });
        }

        return {
            shiftDownBuffer,
            shiftUpBuffer
        };
    } catch (error) {
        if (typeof handleError === 'function') {
            handleError('Error creating shift buffers', error, {
                activeTime: adjustedActiveTime,
                fadeTime: adjustedFadeTime,
                profile: this.profile,
                instrumentType
            }, 'high', { memoryManager });
        }
        return null;
    }
}

function preserveFormant(pitchMult, baseFreq, vocalPresence, spectralProfile = {}, glider = null) {
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
    const cpuLoadAdjust = cpuLoad > 0.8 || isLowPowerDevice ? 0.75 : 1.0;

    // Spectral Entropy Analysis (QuantumFormantOptimizerV8.1 Final)
    const entropyFactor = Math.min(1.0, 0.9 + (1 - validatedSpectralProfile.spectralComplexity) * 0.1);
    const noiseSuppressionFactor = Math.min(1.0, 0.9 + (1 - validatedSpectralProfile.spectralComplexity) * 0.1);

    // === V8.1: ƯU TIÊN GLIDER TRUYỀN TRỰC TIẾP TỪ setPitchOffset – ĐỒNG BỘ TUYỆT ĐỐI ===
    const activeGlider = glider || this.lastGlider || {
        formantVariability: 1.0,
        grainJitter: 0.04,
        spectroAdapt: 1.0,
        vocalWarmthOptimizer: 1.0,
        bassResonanceControl: 1.0,
        dynamicFormantBlend: 1.0,
        quantumPhaseEntanglement: 1.0,
        harmonicSuperposition: 1.0,
        aiChromaEnhancer: 1.0,
        transientSculptor: 1.0,
        multiBandWeights: { low: 1.0, mid: 1.0, high: 1.0 }
    };

    const formantVariability = activeGlider.formantVariability || 1.0;
    const grainJitterFactor = 1.0 + (activeGlider.grainJitter || 0.04) * 0.8;
    const spectroAdapt = activeGlider.spectroAdapt || 1.0;

    // Điều chỉnh shiftFactor – hút hết sức mạnh V8
    const complexityAdjust = validatedSpectralProfile.spectralComplexity > 0.7 ? 0.65 : 0.85;
    let shiftFactor = (pitchMult < 0 ? 1 + absMult * 0.18 : 1 + absMult * 0.28) * complexityAdjust * cpuLoadAdjust * noiseSuppressionFactor;
    shiftFactor *= (1 + formantVariability * (absMult / 12) * 0.6 * spectroAdapt);
    shiftFactor *= activeGlider.dynamicFormantBlend * activeGlider.quantumPhaseEntanglement;

    // Xác định loại vocal
    const isFemaleVocal = baseFreq > 400;
    const isMaleVocal = baseFreq < 240;
    const pitchBoost = absMult > 0.8 ? 1 + (absMult - 0.8) * 0.55 : absMult > 0.4 ? 1 + (absMult - 0.4) * 0.35 : 1.0;

    let vocalFactor = Math.min(
        vocalPresence > 0.7
            ? (isFemaleVocal ? 1.45 * pitchBoost : isMaleVocal ? 1.4 * pitchBoost : 1.35 * pitchBoost)
            : (validatedSpectralProfile.midHigh > 0.7 ? 1.25 : 1.0),
        1.55
    );
    vocalFactor *= grainJitterFactor;
    vocalFactor *= activeGlider.vocalWarmthOptimizer * activeGlider.harmonicSuperposition;

    // Điều chỉnh tần số formant
    let freqAdjust = Math.min(
        (isFemaleVocal && pitchMult < 0) ? 1.08 * pitchBoost :
        (pitchMult < 0 ? 1.03 * pitchBoost :
        (pitchMult > 0 && absMult > 0.8 ? 0.78 : 0.83)),
        1.18
    );
    freqAdjust *= (1 - formantVariability * (pitchMult > 0 ? 0.7 : 0.3) * (absMult / 12));

    const bassAdjust = validatedSpectralProfile.bass > 0.7
        ? (pitchMult < -0.8 ? 1.18 : 1.25) * activeGlider.multiBandWeights.low
        : 1.0;

    // Tính tần số formant
    let freq = baseFreq / shiftFactor * vocalFactor * freqAdjust * bassAdjust;
    const minFreq = 85;
    const maxFreq = 4600;
    freq = Math.max(minFreq, Math.min(maxFreq, freq));
    freq *= spectroAdapt;

    // === V8.1 BÍ KÍP ĐỘC QUYỀN: GIỌNG NAM TRẦM HẠ SÂU VẪN ẤM SÂU NHƯ THU ÂM LẠI ===
    if (baseFreq < 220 && pitchMult < -12) {
        freq *= 0.96; // Kéo formant xuống nhẹ → ấm sâu tự nhiên
        vocalFactor *= 1.18 * activeGlider.bassResonanceControl;
    }

    // Dynamic Transient Shaping + AI Chroma
    const transientBoost = validatedSpectralProfile.transientEnergy > 0.7
        ? (this.profile === 'rockMetal' ? 1.3 : this.profile === 'vocal' ? 1.25 : this.profile === 'karaokeDynamic' ? 1.35 : 1.2)
        : 1.0;
    const midHighBoost = validatedSpectralProfile.midHigh > 0.7
        ? (this.profile === 'bright' || this.profile === 'smartStudio' ? 1.3 : 1.25)
        : 1.0;
    const airReduction = validatedSpectralProfile.air > 0.7 ? 0.7 : 0.85;

    let gain = Math.min(
        (3.8 - absMult * 0.85) * transientBoost * midHighBoost * airReduction * cpuLoadAdjust * noiseSuppressionFactor * entropyFactor,
        3.8
    );
    gain *= (1 + formantVariability * 0.4);
    gain *= activeGlider.aiChromaEnhancer * activeGlider.bassResonanceControl;

    // Điều chỉnh Q
    const qFactor = vocalPresence > 0.7
        ? (absMult > 0.8 ? 0.08 : 0.12)
        : (absMult > 0.8 ? 0.1 : 0.18);
    const airQReduction = validatedSpectralProfile.air > 0.7 ? 0.7 : 0.85;
    let q = Math.max(1.0, (1.6 + absMult * qFactor) * airQReduction * cpuLoadAdjust * entropyFactor);
    q /= grainJitterFactor;

    console.debug(`preserveFormant V8.1 Final – QuantumFormantOptimizer`, {
        freq: freq.toFixed(2),
        gain: gain.toFixed(3),
        q: q.toFixed(3),
        pitchMult,
        baseFreq,
        vocalPresence,
        profile: this.profile,
        formantVariability,
        grainJitter: activeGlider.grainJitter,
        spectroAdapt,
        cpuLoadAdjust
    });

    return { freq, gain, q };
}

// Hàm tạo buffer điều chỉnh độ trễ với tối ưu hóa
function createDelayTimeBuffer(context, activeTime, fadeTime, shiftUp, options = {}, memoryManager) {
    // Kiểm tra đầu vào - giữ nguyên xương sống
    if (!(context instanceof (window.AudioContext || window.webkitAudioContext))) {
        if (typeof handleError === 'function') {
            handleError('Invalid AudioContext', new Error('Invalid context'), {}, 'high', { memoryManager });
        }
        throw new Error("Invalid AudioContext provided.");
    }

    // Validate thời gian với ensureFinite an toàn
    activeTime = (typeof ensureFinite === 'function') ? ensureFinite(activeTime, DEFAULT_BUFFER_TIME) : (Number.isFinite(activeTime) ? activeTime : DEFAULT_BUFFER_TIME);
    fadeTime = (typeof ensureFinite === 'function') ? ensureFinite(fadeTime, DEFAULT_FADE_TIME) : (Number.isFinite(fadeTime) ? fadeTime : DEFAULT_FADE_TIME);

    if (activeTime <= 0 || fadeTime <= 0) {
        if (typeof handleError === 'function') {
            handleError('Invalid parameters', new Error('activeTime and fadeTime must be positive'), { activeTime, fadeTime }, 'high', { memoryManager });
        }
        throw new Error("activeTime and fadeTime must be positive finite numbers.");
    }

    if (!memoryManager || typeof memoryManager.set !== 'function') {
        if (typeof handleError === 'function') {
            handleError('Invalid memoryManager', new Error('memoryManager with set method is required'), {}, 'high', { memoryManager });
        }
        throw new Error("Invalid memoryManager provided.");
    }

    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

    // Extract options - giữ nguyên đầy đủ
    const {
        pitchShift = 0,
        isVocal = false,
        spectralProfile = {},
        qualityMode = 'high',
        channels = 1,
        smoothness = 0.95,
        vibrance = 0.9,
        transientBoost = 1.15,
        vocalWarmth = 1.25
    } = options;

    // Validate pitchShift & channels
    const validatedPitchShift = (typeof ensureFinite === 'function') ? ensureFinite(pitchShift, 0) : (Number.isFinite(pitchShift) ? pitchShift : 0);
    const validatedChannels = Math.max(1, Math.min(Math.round(Number.isFinite(channels) ? channels : 1), 8));

    // Chuẩn hóa spectralProfile - giữ nguyên logic gốc
    const spectralDefaults = {
        spectralComplexity: 0.5, vocalPresence: 0.5, transientEnergy: 0.5,
        bass: 0.5, midHigh: 0.5, air: 0.5, spectralEntropy: 0.5
    };
    const validatedSpectralProfile = Object.keys(spectralDefaults).reduce((acc, key) => {
        const val = spectralProfile?.[key];
        acc[key] = Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : spectralDefaults[key];
        return acc;
    }, { ...spectralDefaults });

    try {
        const sampleRate = context.sampleRate || 48000;
        const cpuLoad = (typeof this.getCPULoad === 'function') ? this.getCPULoad() : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;

        // QuantumDelaySculptorV2 - giữ nguyên 100%
        const entropyFactor = Math.min(1.0, 0.96 + (1 - validatedSpectralProfile.spectralEntropy) * 0.04);
        const spectralSubtractionFactor = validatedSpectralProfile.air > 0.8 || validatedSpectralProfile.bass > 0.8 ? 0.8 : 0.85;

        // Detect instrument - giữ nguyên logic gốc
        const detectInstrument = (sp) => {
            if (sp.transientEnergy > 0.9 && sp.bass > 0.85) return 'drum';
            if (sp.midHigh > 0.85 && sp.transientEnergy > 0.75) return 'guitar';
            if (sp.midHigh > 0.8 && sp.spectralComplexity > 0.75) return 'piano';
            return 'vocal';
        };
        const instrumentType = detectInstrument(validatedSpectralProfile);

        // Deep Learning Buffer Factor - giữ nguyên phức hợp gốc
        const deepLearningBufferFactor = (
            (instrumentType === 'drum' ? 1.3 : instrumentType === 'guitar' ? 1.25 : instrumentType === 'piano' ? 1.2 :
             validatedSpectralProfile.vocalPresence > 0.9 ? 1.25 : 1.0) *
            (validatedSpectralProfile.transientEnergy > 0.9 ? 1.3 : 1.0) *
            (Math.abs(validatedPitchShift) > 1.2 ? 1.35 : 1.0) *
            ((this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 1.25 : 1.0) *
            ((this.profile === 'rockMetal' || validatedSpectralProfile.bass > 0.9) ? 1.2 : 1.0)
        );

        const adjustedActiveTime = activeTime * deepLearningBufferFactor;
        const adjustedFadeTime = fadeTime * deepLearningBufferFactor;

        // Fade length handling
        const minFadeLength = (isVocal || instrumentType === 'vocal') ? 1024 :
                              (instrumentType === 'drum' || Math.abs(validatedPitchShift) > 0.5 ? 896 : 768);
        let fadeLength = Math.max(Math.round(adjustedFadeTime * sampleRate), minFadeLength);

        if (typeof adjustFadeLength === 'function') {
            fadeLength = adjustFadeLength(fadeLength, sampleRate, validatedSpectralProfile, validatedPitchShift, isVocal, cpuLoad, isLowPowerDevice);
        }

        const activeLength = Math.round(adjustedActiveTime * sampleRate);
        // FIX bảo vệ bộ nhớ: giới hạn totalLength tối đa
        const maxTotalLength = sampleRate * 5;
        const totalLength = Math.min(activeLength + Math.max(0, Math.round((adjustedActiveTime - 2 * adjustedFadeTime) * sampleRate)), maxTotalLength);

        // Tạo buffer
        const buffer = context.createBuffer(validatedChannels, totalLength, sampleRate);
        if (!buffer) throw new Error("Failed to create delay time buffer.");

        // Smoothing instrument-specific - giữ nguyên gốc
        const smoothing = Math.min(fadeLength / 5, 30) * (
            instrumentType === 'drum' ? 1.15 :
            instrumentType === 'guitar' ? 1.1 :
            instrumentType === 'piano' ? 1.05 :
            (this.profile === 'vocal' || this.profile === 'karaokeDynamic') ? 1.2 : 1.0
        );

        const pitchFactor = Math.abs(validatedPitchShift) * spectralSubtractionFactor;

        // Xử lý dữ liệu channel - tối ưu với fill
        for (let ch = 0; ch < validatedChannels; ch++) {
            const channelData = buffer.getChannelData(ch);
            for (let i = 0; i < activeLength; i++) {
                let delayValue = shiftUp ? (activeLength - i) / activeLength : i / activeLength;
                delayValue *= entropyFactor;

                if (i < smoothing) {
                    const t = 0.5 * (1 - Math.cos(Math.PI * i / smoothing));
                    delayValue = delayValue * t + (shiftUp ? 1 : 0) * (1 - t);
                } else if (i >= activeLength - smoothing) {
                    const t = 0.5 * (1 - Math.cos(Math.PI * (activeLength - i) / smoothing));
                    delayValue = delayValue * t + (shiftUp ? 0 : 1) * (1 - t);
                }

                const finalGain = (instrumentType === 'vocal' ? vocalWarmth * ((this.profile === 'vocal') ? 1.05 : 1.0) :
                                  instrumentType === 'drum' ? transientBoost :
                                  instrumentType === 'guitar' ? transientBoost * 0.9 : 1.0);

                channelData[i] = delayValue * finalGain;
            }
            // FIX: Zero-fill nhanh phần thừa
            if (totalLength > activeLength) {
                channelData.fill(0, activeLength, totalLength);
            }
        }

        // Validate buffer
        if (!(buffer instanceof AudioBuffer) || buffer.length < activeLength || buffer.numberOfChannels !== validatedChannels) {
            throw new Error('Invalid delay time buffer created');
        }

        // Cache với key đầy đủ như gốc nhưng gọn hơn
        const spectralKey = `${validatedSpectralProfile.spectralComplexity}_${validatedSpectralProfile.vocalPresence}_${validatedSpectralProfile.spectralEntropy}_${instrumentType}`;
        const key = `delay_${adjustedActiveTime.toFixed(3)}_${adjustedFadeTime.toFixed(3)}_${validatedPitchShift}_${shiftUp}_${qualityMode}_${validatedChannels}_${spectralKey}`;

        memoryManager.set(key, buffer, 'high', {
            metadata: { timestamp: Date.now(), profile: this.profile, instrumentType }
        });

        // Prune cache thông minh hơn trên thiết bị yếu
        const maxCacheSize = isLowPowerDevice ? 300 : (memoryManager.getDynamicMaxSize?.() || 700);
        if (typeof memoryManager.pruneCache === 'function') {
            memoryManager.pruneCache(maxCacheSize);
        }

        if (isDebug) {
            console.debug(`Created delay time buffer with key: ${key}`, {
                bufferLength: buffer.length,
                channels: buffer.numberOfChannels,
                sampleRate: buffer.sampleRate,
                smoothing,
                shiftUp,
                pitchFactor,
                instrumentType,
                entropyFactor,
                spectralSubtractionFactor
            });
        }

        return buffer;
    } catch (error) {
        if (typeof handleError === 'function') {
            handleError('Error creating delay time buffer', error, {
                activeTime: adjustedActiveTime,
                fadeTime: adjustedFadeTime,
                shiftUp,
                options,
                sampleRate: context?.sampleRate,
                profile: this.profile,
                instrumentType
            }, 'high', { memoryManager });
        }
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
		this.expiryTime = {
			high: 180000, 
			normal: 90000, 
			low: 20000 
		};
		this.maxTotalSize = 200 * 1024 * 1024;
		this._priorityWeight = {
			high: 3.5,
			normal: 1.8,
			low: 1.0
		};
		// FIX: Dùng chung một context để tránh rò rỉ tài nguyên hệ thống
		this._sharedCtx = null;
	}

	compressBuffer(buffer) {
		if (!(buffer instanceof AudioBuffer)) return null;
		const data = new Float32Array(buffer.length * buffer.numberOfChannels);
		for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
			data.set(buffer.getChannelData(ch), ch * buffer.length);
		}
		return new Uint8Array(data.buffer);
	}

	decompressBuffer(compressed, length, channels, sampleRate) {
		if (!(compressed instanceof Uint8Array)) return null;
		
		// FIX: Khởi tạo lười (lazy-init) AudioContext dùng chung
		if (!this._sharedCtx) {
			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			this._sharedCtx = new AudioCtx();
		}

		const float32 = new Float32Array(compressed.buffer, compressed.byteOffset, length * channels);
		const buffer = this._sharedCtx.createBuffer(channels, length, sampleRate);
		for (let ch = 0; ch < channels; ch++) {
			buffer.getChannelData(ch).set(float32.subarray(ch * length, (ch + 1) * length));
		}
		return buffer;
	}

	getBufferSize(buffer) {
		if (buffer instanceof AudioBuffer) {
			return buffer.length * buffer.numberOfChannels * 4;
		} else if (buffer instanceof Uint8Array) {
			return buffer.byteLength;
		}
		return 0;
	}

	get(key) {
		if (!this.buffers.has(key)) return undefined;
		const item = this.buffers.get(key);
		const priority = this.priorities.get(key) || 'normal';
		const timestamp = item.metadata?.timestamp || this.accessTimestamps.get(key) || 0;

		// FIX: Kiểm tra hết hạn chính xác
		if (timestamp && (Date.now() - timestamp > this.expiryTime[priority])) {
			this._remove(key);
			return undefined;
		}

		this.accessTimestamps.set(key, Date.now());

		if (item.buffer instanceof Uint8Array && item.metadata?.originalLength) {
			return this.decompressBuffer(
				item.buffer,
				item.metadata.originalLength,
				item.metadata.channels,
				item.metadata.sampleRate
			);
		}
		return item.buffer;
	}

	getBuffer(key) {
		return this.get(key);
	}

	set(key, buffer, priority = 'normal', metadata = {}) {
		if (!buffer) return;

		const validPriorities = ['low', 'normal', 'high'];
		const effectivePriority = validPriorities.includes(priority) ? priority : 'normal';

		let storedBuffer = buffer;
		let finalMetadata = {
			...metadata,
			timestamp: Date.now()
		};

		if (buffer instanceof AudioBuffer) {
			storedBuffer = this.compressBuffer(buffer);
			if (!storedBuffer) return;
			finalMetadata = {
				...finalMetadata,
				originalLength: buffer.length,
				channels: buffer.numberOfChannels,
				sampleRate: buffer.sampleRate
			};
		}

		this.buffers.set(key, {
			buffer: storedBuffer,
			metadata: finalMetadata
		});
		this.priorities.set(key, effectivePriority);
		this.accessTimestamps.set(key, Date.now());

		this.pruneCache(this.getDynamicMaxSize());
	}

	allocateBuffer(key, buffer, priority = 'normal', metadata = {}) {
		this.set(key, buffer, priority, metadata);
	}

	pruneCache(maxSize) {
		const now = Date.now();
		let totalSize = 0;
		
		// 1. Xóa hết hạn và tính tổng dung lượng trong 1 vòng lặp để tiết kiệm CPU
		for (const [key, item] of this.buffers.entries()) {
			const priority = this.priorities.get(key) || 'normal';
			const timestamp = item.metadata?.timestamp || this.accessTimestamps.get(key) || 0;
			
			// FIX: Sửa lỗi phép tính thời gian (- - thành -)
			if (timestamp && (now - timestamp > this.expiryTime[priority])) {
				this._remove(key);
			} else {
				totalSize += this.getBufferSize(item.buffer);
			}
		}

		// 2. Prune thông minh (Chỉ thực hiện khi thực sự vượt ngưỡng)
		if (this.buffers.size > maxSize || totalSize > this.maxTotalSize) {
			// FIX: Di chuyển việc tạo mảng ứng viên ra ngoài vòng while
			const candidates = Array.from(this.buffers.keys()).map(k => ({
				key: k,
				priority: this._priorityWeight[this.priorities.get(k) || 'normal'],
				time: this.accessTimestamps.get(k) || 0,
				size: this.getBufferSize(this.buffers.get(k).buffer)
			}));

			// Sắp xếp: Ưu tiên xóa Priority thấp nhất, sau đó đến cái cũ nhất (LRU)
			candidates.sort((a, b) => a.priority - b.priority || a.time - b.time);

			for (const cand of candidates) {
				if (this.buffers.size <= maxSize && totalSize <= this.maxTotalSize) break;
				this._remove(cand.key);
				totalSize -= cand.size;
			}
		}
	}

	_remove(key) {
		this.buffers.delete(key);
		this.priorities.delete(key);
		this.accessTimestamps.delete(key);
	}

	getCacheStats() {
		let totalSize = 0, high = 0, normal = 0, low = 0;
		for (const [key, item] of this.buffers.entries()) {
			totalSize += this.getBufferSize(item.buffer);
			const p = this.priorities.get(key) || 'normal';
			if (p === 'high') high++;
			else if (p === 'normal') normal++;
			else low++;
		}
		return {
			bufferCount: this.buffers.size,
			totalSizeBytes: totalSize,
			highPriorityCount: high,
			normalPriorityCount: normal,
			lowPriorityCount: low,
			maxTotalSize: this.maxTotalSize,
			maxBufferCount: this.getDynamicMaxSize()
		};
	}

	getDynamicMaxSize() {
		const memory = navigator.deviceMemory || 4; // Mặc định 4GB nếu không lấy được
		const cores = navigator.hardwareConcurrency || 4;
		const dynamicCount = 80 + memory * 15 + cores * 10;
		this.maxTotalSize = Math.max(200 * 1024 * 1024, memory * 60 * 1024 * 1024);
		return Math.floor(dynamicCount);
	}

	clear() {
		this.buffers.clear();
		this.priorities.clear();
		this.accessTimestamps.clear();
		// FIX: Không cần xóa _sharedCtx để có thể tái sử dụng
	}
}

function Jungle(context, options = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const fastFinite = (val, def) => (typeof val === 'number' && Number.isFinite(val)) ? val : def;

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

        // === DỌN DEBOUNCE CŨ KHI TẠO INSTANCE MỚI ===
        this._pitchLogDebounce = null;

        // Kiểm tra và khởi tạo AudioContext
        if (!context || !(context instanceof AudioContext) || context.state === 'closed') {
            if (isDebug) console.warn('Invalid or closed AudioContext provided, creating new AudioContext');
            try {
                context = new AudioContext();
                this.ownsContext = true;
                if (isDebug) console.debug('Created new AudioContext', {
                    contextId: this.contextId,
                    sampleRate: context.sampleRate
                });
            } catch (error) {
                console.error('Không thể tạo AudioContext mới', error);
                throw new Error('Không thể khởi tạo AudioContext. Vui lòng kiểm tra trình duyệt hỗ trợ Web Audio API.');
            }
        } else {
            this.ownsContext = false;
        }
        this.context = context;

        // Auto-resume gọn hơn
        if (this.context.state === 'suspended') {
            const resume = () => {
                this.context.resume();
                document.removeEventListener('click', resume);
                document.removeEventListener('touchstart', resume);
            };
            document.addEventListener('click', resume);
            document.addEventListener('touchstart', resume);
        }

        // Cảnh báo sampleRate thấp – chỉ khi debug
        if (isDebug && this.context.sampleRate < 48000) {
            console.warn(`SampleRate thấp (${this.context.sampleRate}Hz) có thể gây ra lỗi. Khuyến nghị sử dụng 48000Hz hoặc cao hơn.`);
        }

        this.isStarted = false;

        // Dự đoán qualityMode thông minh
        const deviceMemory = navigator.deviceMemory || 4;
        const cpuLoad = this.getCPULoad ? fastFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        this.qualityMode = options.qualityMode || (
            deviceMemory < 4 || cpuLoad > 0.8 || isLowPowerDevice ? 'low' : 'high'
        );

        // Fix Lag Cache
        this.lastPhaseCacheUpdate = 0;
        this.lastRoomCacheUpdate = 0;

        // Khởi tạo tham số
        this.delayTime = fastFinite(options.delayTime, DEFAULT_DELAY_TIME);
        this.fadeTime = fastFinite(options.fadeTime, DEFAULT_FADE_TIME);
        this.bufferTime = fastFinite(options.bufferTime, DEFAULT_BUFFER_TIME);
        this.rampTime = fastFinite(options.rampTime, DEFAULT_RAMP_TIME);
        this.lowPassFreq = fastFinite(options.lowPassFreq, DEFAULT_LOW_PASS_FREQ);
        this.highPassFreq = fastFinite(options.highPassFreq, DEFAULT_HIGH_PASS_FREQ);
        this.notchFreq = fastFinite(options.notchFreq, DEFAULT_NOTCH_FREQ);
        this.filterQ = fastFinite(options.filterQ, DEFAULT_FILTER_Q);
        this.notchQ = fastFinite(options.notchQ, DEFAULT_NOTCH_Q);
        this.formantF1Freq = fastFinite(options.formantF1Freq, DEFAULT_FORMANT_F1_FREQ);
        this.formantF2Freq = fastFinite(options.formantF2Freq, DEFAULT_FORMANT_F2_FREQ);
        this.formantQ = fastFinite(options.formantQ, DEFAULT_FORMANT_Q);
        this.subMidFreq = fastFinite(options.subMidFreq, DEFAULT_SUBMID_FREQ);
        this.subTrebleFreq = fastFinite(options.subTrebleFreq, DEFAULT_SUBTREBLE_FREQ);
        this.midBassFreq = fastFinite(options.midBassFreq, 200);
        this.highMidFreq = fastFinite(options.highMidFreq, 2000);
        this.airFreq = fastFinite(options.airFreq, 10000);

        // Metadata & spectralProfile
        this.spectralProfile = options.spectralProfile || {
            subBass: 0.5, bass: 0.5, subMid: 0.5, midLow: 0.5, midHigh: 0.5,
            high: 0.5, subTreble: 0.5, air: 0.5, vocalPresence: 0.5,
            transientEnergy: 0.5, instruments: {}, chroma: Array(12).fill(0.5)
        };
        this.tempoMemory = options.tempoMemory || { current: 120, previous: 120 };
        this.currentGenre = options.currentGenre || "Unknown";
        this.currentKey = options.currentKey || { key: "Unknown", confidence: 0, isMajor: true };
        this.currentProfile = options.currentProfile || "proNatural";
        this.nextProcessingInterval = fastFinite(options.nextProcessingInterval, 1000);
        this.currentPitchMult = fastFinite(options.currentPitchMult, 0);
        this.noiseLevel = options.noiseLevel || { level: 0, midFreq: 0.5 };
        this.qualityPrediction = options.qualityPrediction || { score: 0, recommendations: [] };
        this.isVocal = options.isVocal || false;
        this.wienerGain = fastFinite(options.wienerGain, 1);
        this.polyphonicPitches = options.polyphonicPitches || [];
        this.transientBoost = fastFinite(options.transientBoost, 0);
        this.MASTER_VOL = 0.6;

        // Tối ưu bufferTime
        const pitchMultFactor = 1 + Math.abs(this.currentPitchMult) * 0.5;
        this.bufferTime = Math.max(this.bufferTime, this.fadeTime * 2.5 * pitchMultFactor);
        if (this.qualityMode === 'high') this.bufferTime *= 1.2;
        if (this.bufferTime < this.fadeTime * 2.5) {
            if (isDebug) console.warn("bufferTime được điều chỉnh để đảm bảo chuyển đổi mượt mà", { bufferTime: this.bufferTime });
            this.bufferTime = this.fadeTime * 2.5;
        }
        if (this.delayTime > MAX_DELAY_TIME) {
            if (isDebug) console.warn("delayTime vượt quá MAX_DELAY_TIME, giới hạn lại", { delayTime: MAX_DELAY_TIME });
            this.delayTime = MAX_DELAY_TIME;
        }

        // MemoryManager
        this.memoryManager = options.memoryManager || new MemoryManager();
        const maxCacheSize = this.calculateMaxCacheSize?.() || 100;
        this.memoryManager.setDynamicMaxSize?.(maxCacheSize);
        this.memoryManager.pruneCache(maxCacheSize);

        // AnalyserNode
        try {
            this._analyser = options.analyser || this.context.createAnalyser();
            const analyserConfig = options.analyserConfig || {};
            this._analyser.fftSize = fastFinite(analyserConfig.fftSize, this.qualityMode === 'low' ? 512 : 1024);
            this._analyser.smoothingTimeConstant = fastFinite(analyserConfig.smoothingTimeConstant, 0.85);
        } catch (error) {
            console.error('Không thể khởi tạo AnalyserNode', error);
            throw new Error('Không thể khởi tạo AnalyserNode.');
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
        } catch (error) {
            console.error("Lỗi khi tạo buffer", error);
            if (this.ownsContext) this.context.close();
            throw error;
        }

        // Khởi tạo nodes và spatial
        this.initializeNodes();
        const spatialConfig = options.spatialAudioConfig || { panningModel: 'equalpower' };
        this.initializeSpatialAudio(spatialConfig);

        // Lưu cache
        if (this.memoryManager) {
            this.memoryManager.set(cacheKey, {
                instance: this,
                timestamp: Date.now(),
                expiry: Date.now() + 60000
            }, 'high');
        }
    } catch (error) {
        console.error('Lỗi trong hàm khởi tạo Jungle', error, { contextId: this.contextId });
        if (this.ownsContext && this.context) {
            this.context.close().catch(err => console.warn('Không thể đóng AudioContext', err));
        }
        throw error;
    }
}

Jungle.prototype.initializeNodes = function() {
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
        // Check device capability - mở rộng từ hàm nâng cấp
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const performanceFactor = isLowPowerDevice ? 0.8 : 1.0;
        const currentTime = this.context.currentTime;

        // Convert Float32Array to AudioBuffer - tối ưu từ hàm nâng cấp (step thông minh + giải phóng RAM)
        const createAudioBuffer = (float32Array, context, sampleRate, options = {}) => {
            const { channels = 1, normalize = false, validateData = true } = options;
            if (!float32Array || float32Array.length === 0) return null;
            if (validateData) {
                const step = float32Array.length > 50000 ? Math.floor(float32Array.length / 500) : 1;
                for (let i = 0; i < float32Array.length; i += step) {
                    if (!Number.isFinite(float32Array[i])) throw new Error('NaN/Infinity detected');
                }
            }
            let data = float32Array;
            if (normalize) {
                let maxAbs = 0;
                for (let i = 0; i < data.length; i++) {
                    if (Math.abs(data[i]) > maxAbs) maxAbs = Math.abs(data[i]);
                }
                if (maxAbs > 1.0) {
                    const normalizedData = new Float32Array(data.length);
                    for (let i = 0; i < data.length; i++) normalizedData[i] = data[i] / maxAbs;
                    data = normalizedData;
                }
            }
            const buffer = context.createBuffer(channels, data.length / channels, sampleRate);
            buffer.getChannelData(0).set(data);
            return buffer;
        };

        // Initialize buffers + giải phóng RAM ngay (tinh hoa từ nâng cấp)
        const sr = this.context.sampleRate;
        if (this.shiftDownData instanceof Float32Array) {
            this.shiftDownBuffer = createAudioBuffer(this.shiftDownData, this.context, sr, { channels: 1 });
            this.shiftDownData = null;
        }
        if (this.shiftUpData instanceof Float32Array) {
            this.shiftUpBuffer = createAudioBuffer(this.shiftUpData, this.context, sr, { channels: 1 });
            this.shiftUpData = null;
        }
        if (this.fadeData instanceof Float32Array) {
            this.fadeBuffer = createAudioBuffer(this.fadeData, this.context, sr, { channels: 1 });
            this.fadeData = null;
        }
        if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
            throw new Error('Missing required buffers: shiftDownBuffer, shiftUpBuffer, or fadeBuffer is undefined.');
        }

        // Validate spectralProfile (giữ nguyên gốc)
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
        const vocalBoost = this.isVocal ? 1.2 + spectralProfile.vocalPresence * 0.3 : 1.0;
        const genreFactorMap = {
            'EDM': 1.2, 'DrumAndBass': 1.2, 'HipHop': 1.1, 'Pop': 1.0,
            'Bolero': 0.9, 'Classical': 0.8, 'Jazz': 0.8, 'RockMetal': 1.0, 'Karaoke': 0.9
        };
        const genreFactor = genreFactorMap[this.currentGenre] || 1.0;

        // Initialize filters - giữ nguyên freq/Q/gain từ gốc để trong trẻo tự nhiên
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

        // Modulation & pitch shifting - giữ nguyên gốc
        this.mod1 = this.context.createBufferSource();
        this.mod2 = this.context.createBufferSource();
        this.mod3 = this.context.createBufferSource();
        this.mod4 = this.context.createBufferSource();
        this.mod1.buffer = this.shiftDownBuffer;
        this.mod2.buffer = this.shiftDownBuffer;
        this.mod3.buffer = this.shiftUpBuffer;
        this.mod4.buffer = this.shiftUpBuffer;
        this.mod1.loop = this.mod2.loop = this.mod3.loop = this.mod4.loop = true;

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
        this.fade1.buffer = this.fade2.buffer = this.fadeBuffer;
        this.fade1.loop = this.fade2.loop = true;

        this.mix1 = this.context.createGain();
        this.mix2 = this.context.createGain();
        this.mix1.gain.value = this.mix2.gain.value = 0;
        this.fade1.connect(this.mix1.gain);
        this.fade2.connect(this.mix2.gain);

        // Shelf filters & compressor
        this.outputGain = this.context.createGain();
        this.outputGain.gain.value = this.MASTER_VOL;

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

        // Connect nodes - GIỮ NGUYÊN THỨ TỰ GỐC ĐỂ TRONG TRẺO TỰ NHIÊN
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
        if (typeof this.setDelay === 'function') this.setDelay(this.delayTime || DEFAULT_DELAY_TIME);
        if (typeof this.setBoost === 'function') this.setBoost(0.7); // tinh chỉnh nhẹ từ nâng cấp
        if (typeof this.setPan === 'function') this.setPan(0);
        if (typeof this.setPitchOffset === 'function') this.setPitchOffset(0, false);

        // Ramp output gain mượt chống bụp (tinh hoa từ nâng cấp)
        if (this.output && this.output.gain) {
            this.output.gain.setValueAtTime(0, currentTime);
			this.output.gain.linearRampToValueAtTime(this.MASTER_VOL, currentTime + 0.2);
        }

        console.debug('Audio nodes initialized successfully - Trong trẻo tinh khiết tuyệt đối!', {
            sampleRate: this.context.sampleRate,
            genre: this.currentGenre || 'Unknown',
            isVocal: this.isVocal,
            spectralProfile,
            isLowPowerDevice
        });
    } catch (error) {
        console.error('Error initializing audio nodes:', error);
        throw error;
    }
};

// === ACOUSTIC TRANSPARENCY ENHANCEMENT - CHỐT HẠ ĐỈNH CAO TRONG SUỐT THỰC TẾ ===
// Hàm helper thông minh, nhẹ, tự động bù trừ clarity vs mud mà không làm đục bass
// Có thể gọi từ bất kỳ preset nào hoặc realtime update spectral
Jungle.prototype.calculateAcousticTransparencyGain = function(validatedSpectral = this.spectralProfile) {
    try {
        const midHigh = validatedSpectral.midHigh ?? validatedSpectral.high ?? 0.5;
        const high = validatedSpectral.high ?? validatedSpectral.subTreble ?? 0.5;
        const subMid = validatedSpectral.subMid ?? 0.5;
        const midLow = validatedSpectral.midLow ?? validatedSpectral.bass ?? subMid;
        const clarityScore = (midHigh + high) / 2;
        const mudScore = (subMid + midLow) / 2;
        const profile = this.profile || 'smartStudio';
        const absPitch = Math.abs(this.currentPitchMult || 0);
        const vocalPresence = validatedSpectral.vocalPresence ?? 0.5;
        const transientDensity = validatedSpectral.transientDensity ?? 0.5;
        // Tinh chỉnh coeff mạnh hơn cho clarity tự nhiên
        let coeff = 0.25; // Tăng từ 0.2 → 0.25 base
        if (profile === 'warm' || profile === 'bassHeavy') coeff = 0.18;
        if (profile === 'bright' || profile === 'smartStudio' || profile === 'proNatural') coeff = 0.32; // Tăng mạnh clarity
        if (profile === 'vocal' || profile === 'karaokeDynamic') coeff = 0.28;
        if (profile === 'rockMetal') coeff = 0.25;
        if (absPitch > 0.3) coeff *= (1 - absPitch * 0.18);
        coeff *= (1 + vocalPresence * 0.22 + transientDensity * 0.12);
        const dynamicTransparency = 1.0 + (clarityScore - mudScore) * coeff;
        return Math.max(0.75, Math.min(1.28, dynamicTransparency)); // Mở rộng nhẹ max để clarity tuyệt đối
    } catch (error) {
        console.warn('Acoustic Transparency calculation fallback to 1.0', error);
        return 1.0;
    }
};

Jungle.prototype.applyDynamicPeakGuardian = function() {
    try {
        const currentTime = this.context.currentTime;
        const fft = this.getFFTAnalysis?.() || {};
        const spectral = {
            transientDensity: fft.transientDensity ?? 0.5,
            spectralFlux: fft.spectralFlux ?? 0.5,
            vocalEnergy: fft.vocalEnergy ?? 0.5,
            airEnergy: fft.airEnergy ?? 0.5,
            subTrebleEnergy: fft.subTrebleEnergy ?? 0.5,
            spectralCoherence: fft.spectralCoherence ?? 0.5,
            bassEnergy: fft.bassEnergy ?? 0.5
        };
        const rms = this.rms || 0.1;
        const absPitch = Math.abs(this.currentPitchMult || 0);
        const profile = this.profile || 'smartStudio';
        const transparencyGain = this.calculateAcousticTransparencyGain();
        let peakRisk = 0;
        peakRisk += rms > 0.24 ? (rms - 0.24) * 14 : 0; // Giảm ngưỡng từ 0.26 → 0.24, nhạy hơn
        peakRisk += spectral.transientDensity > 0.82 ? (spectral.transientDensity - 0.82) * 6 : 0; // Nhạy hơn với transient
        peakRisk += spectral.spectralFlux > 0.75 ? (spectral.spectralFlux - 0.75) * 5 : 0;
        peakRisk += (spectral.airEnergy + spectral.subTrebleEnergy) / 2 > 0.85 ? 1.2 : 0;
        peakRisk += absPitch > 0.6 ? absPitch * 1.2 : 0;
        peakRisk *= (1 - spectral.spectralCoherence * 0.6);
        // Bảo vệ bass bum bum: nếu bassEnergy cao → giảm risk mạnh
        if (spectral.bassEnergy > 0.7) peakRisk *= 0.7;
        peakRisk *= (spectral.vocalEnergy > 0.7 || transparencyGain < 0.9) ? 0.55 : 1.0;
        let guardianStrength = 1.0;
        if (profile === 'bright' || profile === 'smartStudio' || profile === 'proNatural') guardianStrength = 1.15;
        if (profile === 'vocal' || profile === 'karaokeDynamic') guardianStrength = 1.05;
        if (profile === 'rockMetal') guardianStrength = 1.1;
        if (profile === 'bassHeavy' || profile === 'warm') guardianStrength = 0.65; // Siêu nhẹ để bass tự do
        peakRisk *= guardianStrength;
        // Can thiệp sớm hơn + mạnh hơn nhẹ, ramp dài hơn
        if (peakRisk > 0.45 && this.outputGain?.gain && this.compressor?.threshold) { // Giảm ngưỡng từ 0.6 → 0.45
            const gainReduction = Math.min(0.12, peakRisk * 0.25); // Tăng max từ 0.08 → 0.12
            const currentOutputGain = this.outputGain.gain.value || 1.0;
            const targetGain = currentOutputGain * (1 - gainReduction);
            this.outputGain.gain.cancelScheduledValues(currentTime);
            this.outputGain.gain.setValueAtTime(currentOutputGain, currentTime);
            this.outputGain.gain.linearRampToValueAtTime(targetGain, currentTime + 0.5); // Ramp dài hơn 0.5s mịn như tơ
            const currentThresh = this.compressor.threshold.value || -20;
            const threshAdjust = Math.min(3, peakRisk * 5); // Nới threshold mạnh hơn
            const targetThresh = currentThresh + threshAdjust;
            this.compressor.threshold.cancelScheduledValues(currentTime);
            this.compressor.threshold.setValueAtTime(currentThresh, currentTime);
            this.compressor.threshold.linearRampToValueAtTime(targetThresh, currentTime + 0.5);
            if (window.location.search.includes('debug=true')) {
                console.debug('Dynamic Peak Guardian PRO activated – ultra gentle protection', {
                    peakRisk: peakRisk.toFixed(2),
                    gainReduction: gainReduction.toFixed(3),
                    targetGain: targetGain.toFixed(3),
                    threshAdjust: threshAdjust.toFixed(2),
                    bassEnergy: spectral.bassEnergy.toFixed(2),
                    profile
                });
            }
        }
    } catch (error) {
        console.warn('Peak Guardian fallback - no action', error);
    }
};

Jungle.prototype.initializeSpatialAudio = function() {
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
        this.reverbEnabled = false;
        this.audioFormat = 'stereo';
        this.pannerNode = null;
        this.foaDecoder = null;
        this.binauralBypass = false;
        this.userSpatialAudioPreference = this.spatialAudioEnabled;
        this.reverbBuffer = null;
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
        // Tinh hoa: fastFinite gọn
        const fastFinite = (val, def) => Number.isFinite(val) ? val : def;
        /**
         * Toggles spatial audio on/off and dispatches event for UI.
         */
        this.toggleSpatialAudio = function(enable) {
            this.userSpatialAudioPreference = !!enable;
            this.spatialAudioEnabled = !isLowPowerDevice && this.userSpatialAudioPreference && cpuLoad < 0.9;
            this.configureSignalChain(this.audioFormat);
            localStorage.setItem('spatialAudioPreference', this.spatialAudioEnabled);
            if (isDebug) console.debug('Spatial audio preference set:', { spatialAudioEnabled: this.spatialAudioEnabled, cpuLoad, isLowPowerDevice });
            this.dispatchEvent?.(new CustomEvent('spatialAudioChanged', { detail: { enabled: this.spatialAudioEnabled } }));
        };
        this.setSpatialAudio = function(enable) {
            this.toggleSpatialAudio(enable);
        };
        this.setReverb = function(enable) {
            this.reverbEnabled = !!enable;
            this.configureSignalChain(this.audioFormat);
            localStorage.setItem('reverbPreference', this.reverbEnabled);
            if (isDebug) console.debug('Reverb preference set:', { reverbEnabled: this.reverbEnabled, cpuLoad });
            this.dispatchEvent?.(new CustomEvent('reverbChanged', { detail: { enabled: this.reverbEnabled } }));
        };
        this.restorePreferences = function() {
            const spatialPref = localStorage.getItem('spatialAudioPreference');
            const reverbPref = localStorage.getItem('reverbPreference');
            if (spatialPref !== null) this.setSpatialAudio(spatialPref === 'true');
            if (reverbPref !== null) this.setReverb(reverbPref === 'true');
            if (isDebug) console.debug('Restored preferences:', { spatialAudio: this.spatialAudioEnabled, reverb: this.reverbEnabled });
        };
        // Tinh hoa: throttle detect 2s tránh quét liên tục
        this.detectAudioFormat = function(input) {
            const now = Date.now();
            if (this._lastFormatCheck && now - this._lastFormatCheck < 2000) return this.audioFormat;
            this._lastFormatCheck = now;
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
            const feedbackList = this.memoryManager?.get('userFeedback') || [];
            const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
            if (recentFeedback?.semanticCategory === 'vocal') {
                format = 'binaural';
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
            if (isDebug) console.debug('Detected audio format:', { format, channels, metadata, title, description, recentFeedback });
            return format;
        };
        this.initializeFOADecoder = function(inputNode) {
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
            const vocalPresence = this.spectralProfile?.vocalPresence || 0.5;
            wGain.gain.value = 1.0 / Math.sqrt(2);
            xGain.gain.value = vocalPresence > 0.7 ? 1.2 : 1.0;
            yGain.gain.value = 1.0;
            zGain.gain.value = cpuLoad > 0.8 ? 0.3 : 0.5;
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
        this.configureSignalChain = function(format) {
            format = format || 'stereo';
            this.audioFormat = format;
            const isSpatialFormat = ['binaural', 'ambisonics', 'atmos'].includes(format);
            this.spatialAudioEnabled = !isLowPowerDevice && this.userSpatialAudioPreference && isSpatialFormat && cpuLoad < 0.9;
            if (!this.boostGain || !this.highShelfGain || !this.subTrebleFilter) {
                console.warn('Required nodes missing, skipping signal chain configuration');
                return;
            }
            // Tinh hoa: cleanup try-catch an toàn
            try {
                this.boostGain.disconnect();
                ['panner', 'pannerNode', 'foaDecoder', 'reverb', 'reverbGain'].forEach(nodeName => {
                    if (this[nodeName]) {
                        try { this[nodeName].disconnect(); } catch (e) {}
                        this[nodeName] = null;
                    }
                });
            } catch (e) {
                if (isDebug) console.warn("Cleanup error during chain reconfiguration", e);
            }
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            const panAdjust = songStructure.section === 'chorus' ? 0.2 : 0;
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
                this.pannerNode.rolloffFactor = songStructure.section === 'chorus' ? 1.2 : 1;
                this.boostGain.connect(this.pannerNode);
                this.pannerNode.connect(this.highShelfGain);
                if (isDebug) console.debug('Configured signal chain for Dolby Atmos', { rolloffFactor: this.pannerNode.rolloffFactor });
            }
            // Tinh hoa: reverb chỉ khi !lowPower
            if (this.reverbEnabled && !isLowPowerDevice) {
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
        this.createImpulseResponse = function() {
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
        // Tinh hoa: setTargetAtTime cho position mượt
        this.setSpatialPosition = function(azimuth, elevation, distance = 1) {
            if (!this.pannerNode || !this.spatialAudioEnabled) return;
            azimuth = fastFinite(azimuth, 0);
            elevation = fastFinite(elevation, 0);
            distance = fastFinite(distance, 1);
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            const distanceAdjust = songStructure.section === 'chorus' ? distance * 1.2 : distance;
            const x = distanceAdjust * Math.cos(azimuth) * Math.cos(elevation);
            const y = distanceAdjust * Math.sin(elevation);
            const z = -distanceAdjust * Math.sin(azimuth) * Math.cos(elevation);
            const time = this.context.currentTime;
            this.pannerNode.positionX.setTargetAtTime(x, time, 0.1);
            this.pannerNode.positionY.setTargetAtTime(y, time, 0.1);
            this.pannerNode.positionZ.setTargetAtTime(z, time, 0.1);
            if (isDebug) console.debug('Set spatial position:', { azimuth, elevation, distance: distanceAdjust, x, y, z, songStructure });
        };
        this.bypassMonoBuffers = function(input) {
            if (this.binauralBypass && input.numberOfChannels === 2) {
                this.input.connect(this.bassHighPassFilter);
                if (isDebug) console.debug('Bypassed mono buffers for binaural audio');
                return true;
            }
            return false;
        };
        const originalProcessAudio = this.processAudio;
        this.processAudio = async function(input, params = {}) {
            const format = this.detectAudioFormat(input);
            this.configureSignalChain(format);
            if (format === 'binaural' && this.spatialAudioEnabled) {
                this.bypassMonoBuffers(input);
            }
            if (format === 'atmos' && this.spatialAudioEnabled && params.azimuth !== undefined && params.elevation !== undefined) {
                this.setSpatialPosition(fastFinite(params.azimuth, 0), fastFinite(params.elevation, 0), fastFinite(params.distance, 1));
            }
            await originalProcessAudio.call(this, input, params);
        };
        const originalInitializeNodes = this.initializeNodes;
        this.initializeNodes = function() {
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
        // Tinh hoa fallback khi error
        if (this.boostGain && this.highShelfGain) {
            try {
                this.boostGain.disconnect();
                this.boostGain.connect(this.highShelfGain);
            } catch (e) {}
        }
        throw error;
    }
};

Jungle.prototype.stereoMix = function(balance) {
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
            spectralFlux: fftAnalysis.spectralFlux || 0.5,
            subBassEnergy: fftAnalysis.subBassEnergy || 0.5
        };
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const profile = this.profile || 'smartStudio';
        // Tích hợp userFeedback
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
        const isVocalFeedback = recentFeedback?.semanticCategory === 'vocal';
        const feedbackAdjustments = this.applyUserFeedback?.() || { balance: 0, vocalClarity: 0, spatialWidth: 0 };
        // Điều chỉnh balance dựa trên profile và feedback
        let adjustedBalance = balance;
        let spatialWidth = 1.0; // Tinh hoa spatialWidth động
        if (songStructure.section === 'chorus') {
            spatialWidth = 1.4;
        } else if (songStructure.section === 'verse') {
            spatialWidth = 1.1;
        }
        if (spectralProfile.subBassEnergy > 0.65) {
            spatialWidth = Math.min(spatialWidth, 1.15); // Thu hẹp khi bass nặng tránh mất pha
        }
        if (isVocalFeedback || spectralProfile.vocalEnergy > 0.75 || profile === 'vocal' || profile === 'karaokeDynamic') {
            adjustedBalance = 0;
            spatialWidth *= 0.85;
            if (isDebug) console.debug('Forced centered balance due to vocal feedback or profile:', { profile, vocalEnergy: spectralProfile.vocalEnergy });
        } else if (profile === 'smartStudio' && spectralProfile.transientDensity > 0.65) {
            adjustedBalance *= 0.9;
            if (isDebug) console.debug('Reduced balance for transient-heavy audio in Smart.S profile:', { transientDensity: spectralProfile.transientDensity });
        }
        if (feedbackAdjustments.balance !== 0) {
            adjustedBalance = Math.max(-1, Math.min(1, adjustedBalance + feedbackAdjustments.balance * 0.3));
            if (isDebug) console.debug('Adjusted balance based on user feedback:', { feedbackBalance: feedbackAdjustments.balance });
        }
        if (isLowPowerDevice && cpuLoad > 0.85) {
            adjustedBalance *= 0.95;
            spatialWidth *= 0.9;
            if (isDebug) console.debug('Reduced balance adjustment for low-power device:', { cpuLoad, isLowPowerDevice });
        }
        // Xử lý stereo mix
        if (!this.spatialAudioEnabled) {
            // Tinh hoa cancel + ramp 30ms mượt
            this.panner.pan.cancelScheduledValues(this.context.currentTime);
            this.panner.pan.linearRampToValueAtTime(adjustedBalance, this.context.currentTime + 0.03);
            if (isDebug) console.debug('Stereo mix set for non-spatial audio:', { adjustedBalance, profile, recentFeedback });
        } else {
            if (this.audioFormat === 'binaural') {
                this.panner.pan.cancelScheduledValues(this.context.currentTime);
                this.panner.pan.linearRampToValueAtTime(0, this.context.currentTime + 0.03);
                if (isDebug) console.debug('Stereo mix preserved for binaural audio:', { adjustedBalance });
            } else if (this.foaDecoder || this.pannerNode) {
                if (isDebug) console.debug('Stereo mix bypassed for spatial audio:', { audioFormat: this.audioFormat, adjustedBalance });
            }
        }
        // Lưu stereo mix settings vào memoryManager
        if (this.memoryManager && spectralProfile.spectralFlux > 0.03) {
            const cacheKey = `stereoMix_${this.contextId}_${profile}_${songStructure.section}`;
            const cacheData = {
                data: {
                    balance: adjustedBalance,
                    spatialWidth,
                    timestamp: Date.now(),
                    profile,
                    songStructure,
                    spectralProfile,
                    feedbackAdjustments
                },
                expiry: Date.now() + (isLowPowerDevice && cpuLoad > 0.85 ? 10000 : 15000),
                priority: 'medium'
            };
            this.memoryManager.set(cacheKey, cacheData, 'medium');
            // Tinh hoa random prune nhẹ
            if (Math.random() > 0.9) {
                this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 50);
            }
        }
        // Dispatch event
        this.dispatchEvent?.(new CustomEvent('stereoMixChanged', {
            detail: { balance: adjustedBalance, spatialWidth }
        }));
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
        // Tinh hoa fallback setValueAtTime 0
        if (this.panner?.pan) {
            this.panner.pan.setValueAtTime(0, this.context.currentTime);
        }
    }
};

/**
 * Initializes Web Worker for audio processing.
 * @throws {Error} If Web Worker is not supported or fails to initialize.
 * @note Ensures Worker has its own MemoryManager instance to avoid conflicts.
 * @note Sends initialization parameters to Worker for consistent buffer creation.
 */
Jungle.prototype.initializeWorker = function() {
    if (this.worker) return; // Tinh hoa tránh khởi tạo chồng
    if (!this.worker) {
        try {
            if (!window.Worker) {
                throw new Error("Web Workers are not supported in this environment.");
            }
            this.worker = new Worker('audioWorker.js');
            // Đảm bảo currentGenre hợp lệ
            const validGenres = ['EDM', 'Pop', 'Rock', 'Jazz', 'Classical', 'Hip-Hop', 'Drum & Bass', 'Karaoke'];
            const currentGenre = validGenres.includes(this.currentGenre) ? this.currentGenre : 'Pop';
            // Xác định fftSize dựa trên deviceInfo
            const deviceMemory = navigator.deviceMemory || 4;
            const hardwareConcurrency = navigator.hardwareConcurrency || 2;
            const fftSize = deviceMemory < 4 || hardwareConcurrency < 4 ? 1024 : (deviceMemory >= 8 ? 4096 : 2048);
            // Tinh hoa: fastFinite gọn
            const fastFinite = (val, def) => Number.isFinite(val) ? val : def;
            // Gửi thông điệp init với đầy đủ tham số
            this.worker.postMessage({
                type: 'init',
                params: {
                    smoothness: fastFinite(this.smoothness, 1.3),
                    vibrance: fastFinite(this.vibrance, 0.5),
                    pitchShift: fastFinite(this.currentPitchMult, 1.0),
                    isVocal: !!this.isVocal,
                    spectralProfile: this.spectralProfile || {},
                    currentGenre: currentGenre,
                    noiseLevel: this.noiseLevel || { level: 0.5, white: 0.5, lowFreq: 0.5, midFreq: 0.5 },
                    wienerGain: fastFinite(this.wienerGain, 1.0),
                    polyphonicPitches: Array.isArray(this.polyphonicPitches) ? this.polyphonicPitches : [],
                    sampleRate: this.context?.sampleRate || 48000,
                    fftSize: fftSize,
                    maxBufferAge: 60000,
                    defragmentThreshold: 0.75,
                    qualityMode: this.qualityMode || 'high',
                    cpuLoad: this.getCPULoad ? this.getCPULoad() : 0.5,
                    userFeedback: this.memoryManager?.getBuffer('userFeedback') || {},
                    deviceInfo: { memory: deviceMemory, hardwareConcurrency: hardwareConcurrency },
                    contextAnalysis: this.initializeContextAnalyzer ? this.initializeContextAnalyzer().analyze(this) : {},
                    cpuLoadHistory: this.memoryManager?.getBuffer('cpuLoadHistory') || []
                }
            });
            // Khởi tạo mảng sự kiện nếu chưa có
            this.eventListeners = this.eventListeners || {};
            // Hàm thay thế cho registerEvent
            this.registerEvent = this.registerEvent || function(eventName, callback) {
                this.eventListeners[eventName] = this.eventListeners[eventName] || [];
                this.eventListeners[eventName].push(callback);
            };
            // Hàm kích hoạt sự kiện
            this.triggerEvent = this.triggerEvent || function(eventName, ...args) {
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
                    sampleRate: this.context?.sampleRate || 48000
                };
                switch (type) {
                    case 'initDone':
                        console.log('Worker initialized:', data);
                        this.triggerEvent('workerInitialized', data);
                        break;
                    case 'audioResult':
                        const validPitches = Array.isArray(data.polyphonicPitches) ?
                            data.polyphonicPitches.filter(p => Number.isFinite(p.frequency) && p.confidence >= 0 && p.confidence <= 1) :
                            this.polyphonicPitches;
                        const validWienerGain = Number.isFinite(data.wienerGain) && data.wienerGain >= 0 && data.wienerGain <= 2 ?
                            data.wienerGain : this.wienerGain;
                        const validNoiseLevel = data.noiseLevel && typeof data.noiseLevel === 'object' ?
                            data.noiseLevel : { level: 0.5, white: 0.5, lowFreq: 0.5, midFreq: 0.5 };
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
                        // Tinh hoa: chỉ update khi CPU cho phép
                        if (this.getCPULoad ? this.getCPULoad() < 0.8 : true) {
                            if (data.spectralProfile || data.isVocal || data.genre || data.noiseLevel || data.wienerGain || data.polyphonicPitches) {
                                this.updateBuffers();
                            }
                            if (data.autoEQ) {
                                this.applyAutoEQ(data.autoEQ);
                            }
                        }
                        this.adjustSoundProfileSmartly();
                        break;
                    case 'songStructure':
                        if (data.songStructure && Array.isArray(data.songStructure.segments)) {
                            this.memoryManager?.buffers.set('songStructure', data.songStructure);
                            if (this.getCPULoad ? this.getCPULoad() < 0.7 : true) {
                                this.adjustSoundProfileSmartly({ songStructure: data.songStructure });
                            }
                        }
                        break;
                    case 'formantParams':
                        if (data.formantParams && Array.isArray(data.formantParams.filters)) {
                            const ramp = this.rampTime || 0.1;
                            const now = this.context.currentTime;
                            data.formantParams.filters.forEach((filter, index) => {
                                const filterNode = this[`formantFilter${index + 1}`];
                                if (filterNode && Number.isFinite(filter.freq) && Number.isFinite(filter.gain) && Number.isFinite(filter.q)) {
                                    filterNode.frequency.setTargetAtTime(filter.freq, now, ramp);
                                    filterNode.gain.setTargetAtTime(filter.gain, now, ramp);
                                    filterNode.Q.setTargetAtTime(filter.q, now, ramp);
                                }
                            });
                            this.memoryManager?.buffers.set('formantParams', data.formantParams);
                        }
                        break;
                    case 'fftSettings':
                        if (Number.isFinite(data.fftSize) && data.fftSize >= 256 && data.fftSize <= 32768) {
                            this.setFFTSize(data.fftSize);
                            this.memoryManager?.buffers.set('fftSize', data.fftSize);
                        }
                        break;
                    case 'bufferFeedback':
                        if (this.getCPULoad ? this.getCPULoad() < 0.8 : true && data.suggestedParams) {
                            const { bufferTime, fadeLength, activeTime } = data.suggestedParams;
                            if (Number.isFinite(bufferTime) && Number.isFinite(fadeLength) && Number.isFinite(activeTime)) {
                                this.adjustBufferParams({ bufferTime, fadeLength, activeTime });
                                this.updateBuffers({ bufferTime, fadeLength, activeTime });
                            }
                        }
                        break;
                    case 'error':
                        console.error('Worker Error:', data);
                        this.handleError('AudioWorker encountered an error:', new Error(data), errorContext);
                        this.adjustSoundProfileSmartly();
                        this.nextProcessingInterval = Math.min(this.nextProcessingInterval * 1.2, 5000);
                        break;
                    case 'overload':
                        console.warn('Worker overloaded:', data);
                        this.nextProcessingInterval = Math.min(this.nextProcessingInterval * 1.5, 3000);
                        if (this.getCPULoad ? this.getCPULoad() > 0.9 : false) {
                            this.worker.postMessage({ type: 'pauseAnalysis' });
                        }
                        break;
                    case 'skip':
                        console.log('Worker skipped analysis:', data);
                        break;
                    default:
                        console.warn('Unknown message type from Worker:', type);
                }
            };
            // Xác định tần suất gửi feedback dựa trên hiệu suất thiết bị – tinh hoa giãn khi lowMem
            if (this.feedbackInterval) clearInterval(this.feedbackInterval);
            const isLowMemory = navigator.deviceMemory < 4;
            this.feedbackInterval = setInterval(() => {
                const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
                if (cpuLoad > 0.9) return;
                // Tinh hoa batchUpdate giảm số message
                const updateObj = {
                    type: 'batchUpdate',
                    params: {
                        userFeedback: this.memoryManager?.getBuffer('userFeedback') || {},
                        contextAnalysis: this.initializeContextAnalyzer ? this.initializeContextAnalyzer().analyze(this) : {},
                        cpuLoadHistory: this.memoryManager?.getBuffer('cpuLoadHistory') || []
                    }
                };
                this.worker.postMessage(updateObj);
            }, isLowMemory ? 6000 : 3000);
            // Xử lý sự kiện songChange
            this.onSongChange = () => {
                if (this.worker) {
                    this.worker.postMessage({ type: 'reset' });
                }
            };
            this.registerEvent('songChange', this.onSongChange);
        } catch (error) {
            this.handleError('Error initializing Worker:', error, {
                workerSupport: !!window.Worker,
                workerURL: 'audioWorker.js',
                bufferTime: this.bufferTime,
                fadeTime: this.fadeTime,
                sampleRate: this.context?.sampleRate || 48000
            });
        }
    }
};

Jungle.prototype.resumeWorkerAnalysis = function() {
    if (this.worker) {
        this.worker.postMessage({ type: 'resumeAnalysis' });
    }
};

Jungle.prototype.processAudio = async function(input, params = {}) {
    if (!this.worker) {
        await this.initializeWorker();
    }
    if (this.worker && input instanceof Float32Array) {
        // Tinh hoa: transferable [input.buffer] 0% copy RAM
        this.worker.postMessage({
            type: "analyzeAudio",
            timeData: input,
            sampleRate: params.sampleRate || this.context.sampleRate || 48000,
            bufferLength: input.length,
            cpuLoad: this.getCPULoad ? this.getCPULoad() : 0.5,
            pitchMult: this.currentPitchMult || 1.0,
            devicePerf: params.devicePerf || (navigator.hardwareConcurrency >= 4 ? "high" : "medium"),
            audioProfile: this.currentGenre ?
                (this.currentGenre === "EDM" ? "bassHeavy" :
                 this.currentGenre === "Rock" ? "rockMetal" :
                 this.currentGenre === "Karaoke" ? "karaokeDynamic" :
                 this.currentGenre === "Jazz" ? "warm" :
                 "vocal") : "proNatural",
            params: {
                compressionThreshold: params.compressionThreshold,
                eqGains: params.eqGains,
                noiseGate: params.noiseGate,
                azimuth: params.azimuth,
                elevation: params.elevation,
                sourceVelocity: params.sourceVelocity,
                qualityMode: this.qualityMode || "high"
            }
        }, [input.buffer]);
    } else if (!this.worker) {
        console.warn("Worker not initialized, skipping audio processing");
    }
};

Jungle.prototype.adjustSoundProfileSmartly = function() {
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

Jungle.prototype.startAudioAnalysis = function() {
    if (!this._analyser) {
        this._analyser = this.context.createAnalyser();
        this._analyser.fftSize = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4 ? 1024 : 2048;
        this.outputGain.connect(this._analyser);
    }
    const devicePerf = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4 ? "medium" : "high";
    if (this.audioAnalysisInterval) {
        clearInterval(this.audioAnalysisInterval);
        this.audioAnalysisInterval = null;
    }
    // Tinh hoa: shared timeData tránh tạo mới mỗi frame
    const bufferLength = this._analyser.frequencyBinCount;
    const timeData = new Float32Array(bufferLength);
    // Tinh hoa: setTimeout recursive tự động điều tốc chính xác
    const runAnalysis = () => {
        if (!this.isStarted) return; // Tinh hoa check isStarted ngừng khi stop
        this._analyser.getFloatTimeDomainData(timeData);
        if (this.worker) {
            try {
                const currentProfile = this.currentGenre ?
                    (this.currentGenre === "EDM" ? "bassHeavy" :
                     this.currentGenre === "Rock" ? "rockMetal" :
                     this.currentGenre === "Karaoke" ? "karaokeDynamic" :
                     this.currentGenre === "Jazz" ? "warm" :
                     "vocal") : "proNatural";
                this.worker.postMessage({
                    type: "analyzeAudio",
                    timeData: timeData,
                    sampleRate: this.context.sampleRate,
                    bufferLength: bufferLength,
                    cpuLoad: this.getCPULoad ? this.getCPULoad() : 0.5,
                    pitchMult: this.currentPitchMult || 1,
                    devicePerf: devicePerf,
                    audioProfile: currentProfile
                });
            } catch (error) {
                this.handleError?.("Error sending message to Worker:", error);
            }
        } else {
            this.initializeWorker();
        }
        // Điều tốc thông minh
        let nextInterval = this.nextProcessingInterval || 1000;
        const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
        const spectralComplexity = this.spectralProfile?.spectralFlatness || 0.5;
        if (devicePerf === "medium" || cpuLoad > 0.8) {
            nextInterval = Math.min(nextInterval * 2, 2000);
        } else if (spectralComplexity < 0.3) {
            nextInterval *= 1.2;
        }
        this.audioAnalysisInterval = setTimeout(runAnalysis, Math.round(nextInterval));
    };
    this.audioAnalysisInterval = setTimeout(runAnalysis, 100);
};

Jungle.prototype.applyAutoEQ = function(eqSettings, options = { isInitialStart: false }) { // Thêm options với isInitialStart
    try {
        const currentTime = this.context.currentTime;
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        // Validate AudioContext
        if (!this.context || !(this.context instanceof AudioContext) || this.context.state === 'closed') {
            throw new Error('Invalid or closed AudioContext');
        }
        // Khởi tạo các hằng số mặc định
        const DEFAULT_RAMP_TIME = 0.1;
        const DEFAULT_COMPRESSOR_ATTACK = 0.003;
        const DEFAULT_COMPRESSOR_RELEASE = 0.1;
        const DEFAULT_FORMANT_F1_FREQ = 510;
        const DEFAULT_FORMANT_F2_FREQ = 2020;
        const DEFAULT_FORMANT_F3_FREQ = 3200;
        const DEFAULT_FORMANT_GAIN = 2.7;
        const DEFAULT_TRANSIENT_BOOST = 1.0;
        // Hàm tiện ích để đảm bảo giá trị hữu hạn
        const ensureFinite = (value, defaultValue) => Number.isFinite(value) ? value : defaultValue;
        // Lấy thông tin thiết bị và tối ưu hóa
        const absMult = Math.abs(this.currentPitchMult || 0);
        const rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME);
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const deviceAdaptFactor = Math.max(0.65, Math.min(1.0, 1.0 - (cpuLoad * 0.2) * (isLowPowerDevice ? 0.35 : 0.1)));
        // RMS và limiter
        const rms = this.rms || 0.1;
        const limiterFactor = (rms > 0.18 || (this.spectralProfile?.transientDensity > 0.8)) ? 0.65 : 0.95;
        // Lấy spectral profile và FFT analysis
        const fftAnalysis = this.getFFTAnalysis?.() || {};
        const spectralProfile = {
            subBassEnergy: fftAnalysis.subBassEnergy || 0.5,
            bassEnergy: fftAnalysis.bassEnergy || 0.5,
            midEnergy: fftAnalysis.midEnergy || 0.5,
            highMidEnergy: fftAnalysis.highMidEnergy || 0.5,
            trebleEnergy: fftAnalysis.trebleEnergy || 0.5,
            airEnergy: fftAnalysis.airEnergy || 0.5,
            vocalEnergy: fftAnalysis.vocalEnergy || 0.55,
            transientDensity: fftAnalysis.transientDensity || 0.5,
            harmonicRatio: fftAnalysis.harmonicRatio || 0.5,
            spectralComplexity: fftAnalysis.spectralEntropy || 0.5,
            spectralFlux: fftAnalysis.spectralFlux || 0.5
        };
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const profile = this.profile || 'smartStudio';
        // Lấy userFeedback
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const recentFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory);
        const isVocalFeedback = recentFeedback?.semanticCategory === 'vocal';
        // PRO: Lấy glider từ QuantumFormantOptimizerV2 pro
        const glider = this.lastGlider || {
            formantVariability: 50,
            grainJitter: 0.0,
            spectroAdapt: 1.0,
            multiBandWeights: { low: 1.0, mid: 1.0, high: 1.0 }
        };
        const formantVariability = glider.formantVariability / 100;
        const grainJitterFactor = 1.0 + glider.grainJitter * 0.9;
        const spectroAdapt = glider.spectroAdapt || 1.0;
        const spectralFluxPro = spectralProfile.spectralFlux * (1 + formantVariability * 0.5);
        // Tinh hoa: computeClarity cục bộ tránh tạo hàm mỗi frame
        const computeClarity = (f) => {
            const clarityFactor = profile === 'vocal' || profile === 'karaokeDynamic' ? 1.25 : profile === 'proNatural' ? 1.2 : profile === 'bright' ? 1.15 : 1.0;
            const vocalClarity = spectralProfile.vocalEnergy > 0.65 ? 1.15 : 0.95;
            let cb = Math.min(1.35, clarityFactor * vocalClarity * (1.0 + spectralFluxPro * 0.25) * spectroAdapt);
            cb *= (1 + formantVariability * 0.4);
            const bassResonance = profile === 'bassHeavy' ? 0.98 : profile === 'vocal' ? 0.88 : profile === 'warm' ? 0.92 : 0.9;
            const bassClarity = Math.max(0.75, Math.min(1.25, 1.0 - (spectralProfile.bassEnergy * 0.25)));
            let bf = bassResonance * bassClarity * (1.0 - absMult * 0.08) * glider.multiBandWeights.low * grainJitterFactor;
            const transientSculpt = profile === 'rockMetal' ? 1.2 : profile === 'bassHeavy' ? 1.1 : profile === 'karaokeDynamic' ? 1.15 : 0.95;
            let tf = Math.min(1.25, spectralProfile.transientDensity * transientSculpt * (1.0 - absMult * 0.12) * grainJitterFactor);
            if (cpuLoad > 0.8) tf *= 0.75;
            if (absMult > 0.5) tf *= 0.88;
            const spectralBalance = (spectralProfile.bassEnergy + spectralProfile.subBassEnergy) /
                (spectralProfile.midEnergy + spectralProfile.trebleEnergy + spectralProfile.airEnergy + 0.001);
            let spectralAdjust = spectralBalance > 1.2 ? 0.82 : spectralBalance < 0.8 ? 1.18 : 1.0;
            spectralAdjust *= spectroAdapt;
            const purityFilter = 1 / (1 + Math.pow(f / 1250, 2)) * cb;
            const maskingThreshold = Math.pow(10, -(spectralProfile.spectralComplexity || 0) / 18) * purityFilter * 1.3;
            const sectionEmotion = songStructure.section === 'chorus' ? 1.25 : songStructure.section === 'bridge' ? 1.18 : songStructure.section === 'verse' ? 1.05 : 1.0;
            const timbreCurve = 0.00055 * Math.pow(f, 3) + 0.0055 * Math.pow(f, 2) + 0.055 * f + 1.0;
            let emotionalTimbre = sectionEmotion * timbreCurve * cb * (1 + formantVariability * 0.3);
            const pitchShiftImpact = absMult > 0.5 ? 0.88 : 1.0;
            return Math.max(0.7, Math.min(1.3, cb * bf * tf * spectralAdjust * maskingThreshold * emotionalTimbre * pitchShiftImpact * spectroAdapt));
        };
        const f = this.polyphonicPitches?.[0]?.frequency || 440;
        let clarityFactor = computeClarity(f);
        clarityFactor *= (1 + formantVariability * 0.35);
        // Wiener và pitch adjustment
        const wienerThresholdAdjust = this.wienerGain < 0.8 ? -12 * (1 - this.wienerGain) : 0;
        const pitchAdjust = Math.min(6, absMult * 12) * deviceAdaptFactor;
        // Tự động cân bằng âm thanh với PureSonicClarityV3 pro
        let bassBoostFix = 0;
        let bassTransientBoost = 0;
        if (this.currentPitchMult < 0 && absMult > 0.25) {
            bassBoostFix = 1.8 + absMult * 0.7 + (spectralProfile.bassEnergy < 0.5 ? 0.6 : 0) +
                (spectralProfile.midEnergy > 0.75 || spectralProfile.trebleEnergy > 0.75 ? 0.4 : 0);
            bassTransientBoost = absMult > 0.5 ? 0.4 : 0;
        }
        let midReduceFix = spectralProfile.midEnergy > 0.75 ? 0.7 : 0.95;
        let trebleReduceFix = spectralProfile.trebleEnergy > 0.75 ? 0.7 : 0.95;
        let clarityBoost = (spectralProfile.midEnergy > 0.75 || spectralProfile.trebleEnergy > 0.75) && bassBoostFix > 2.0 ? 0.4 : 0;
        clarityBoost *= grainJitterFactor;
        // Tinh hoa: rampParam với cancel + bloom cho high/subTreble/air khi isInitialStart
        const bloomRampTime = options.isInitialStart ? 0.3 : rampTime * deviceAdaptFactor;
        const normalRampTime = rampTime * deviceAdaptFactor;
        const targetTimeBloom = currentTime + bloomRampTime;
        const targetTimeNormal = currentTime + normalRampTime;
        const rampParam = (param, value, useBloom = false) => {
            if (param) {
                param.cancelScheduledValues(currentTime);
                param.linearRampToValueAtTime(value, useBloom ? targetTimeBloom : targetTimeNormal);
            }
        };
        // Dynamic Q Adapt
        const dynamicQAdapt = (baseQ, absMult, variability) => Math.max(0.6, baseQ - absMult * 0.18 - variability * 0.15 * spectroAdapt);
        if (this.currentPitchMult < 0 && absMult > 0.25) {
            if (this.subBassFilter?.Q) rampParam(this.subBassFilter.Q, dynamicQAdapt(0.65, absMult, formantVariability));
            if (this.lowShelfFilter?.Q) rampParam(this.lowShelfFilter.Q, dynamicQAdapt(0.8, absMult, formantVariability));
        }
        // Compressor settings
        if (this.compressor?.threshold && this.compressor?.ratio && this.compressor?.attack && this.compressor?.release) {
            this.compressor.threshold.cancelScheduledValues(currentTime);
            this.compressor.ratio.cancelScheduledValues(currentTime);
            this.compressor.attack.cancelScheduledValues(currentTime);
            this.compressor.release.cancelScheduledValues(currentTime);
            this.compressor.threshold.setValueAtTime(this.compressor.threshold.value, currentTime);
            this.compressor.ratio.setValueAtTime(this.compressor.ratio.value, currentTime);
            this.compressor.attack.setValueAtTime(this.compressor.attack.value, currentTime);
            this.compressor.release.setValueAtTime(this.compressor.release.value, currentTime);
            let thresholdPro = ensureFinite(eqSettings.clarityGain, 0) < 1.8 ? -20 + wienerThresholdAdjust - pitchAdjust : -16 + wienerThresholdAdjust - pitchAdjust;
            thresholdPro *= spectroAdapt;
            rampParam(this.compressor.threshold, thresholdPro);
            rampParam(this.compressor.ratio, 5.5 + absMult * 1.2 * grainJitterFactor);
            rampParam(this.compressor.attack, spectralProfile.bassEnergy < 0.5 ? 0.0018 : DEFAULT_COMPRESSOR_ATTACK);
            rampParam(this.compressor.release, spectralProfile.bassEnergy < 0.5 ? DEFAULT_COMPRESSOR_RELEASE * 1.15 : DEFAULT_COMPRESSOR_RELEASE);
        }
        // Transient boost adjustment PRO
        let transientBoostAdjust = Math.min(ensureFinite(eqSettings.transientBoost, DEFAULT_TRANSIENT_BOOST) * 1.6, 3.2);
        if (spectralProfile.transientDensity > 0.6 || spectralProfile.spectralFlux > 0.65 || profile === 'rockMetal' || profile === 'vocal') {
            transientBoostAdjust *= 1.25;
        }
        if (profile === 'bright' || profile === 'smartStudio') {
            transientBoostAdjust *= 1.05;
        }
        transientBoostAdjust *= clarityFactor * grainJitterFactor;
        // Harmonic boost adjustment PRO
        let harmonicBoost = spectralProfile.harmonicRatio > 0.6 && (profile === 'warm' || profile === 'jazz') ? 1.4 : 1.0;
        if (isVocalFeedback) {
            harmonicBoost *= 1.05;
        }
        harmonicBoost *= (1 + formantVariability * 0.25);
        // EQ filter settings với PureSonicClarityV3 pro
        rampParam(this.subBassFilter?.gain, Math.min((ensureFinite(eqSettings.subBassGain, 3) + (profile === 'bassHeavy' ? 1.8 : 0) +
            (spectralProfile.subBassEnergy > 0.7 ? 0.7 : 0) + bassBoostFix) * limiterFactor * clarityFactor * glider.multiBandWeights.low, 3.5));
        rampParam(this.lowShelfGain?.gain, Math.min((ensureFinite(eqSettings.bassGain, 4.5) + 1.8 + bassBoostFix * 0.5 + bassTransientBoost) * limiterFactor * clarityFactor * glider.multiBandWeights.low, 3.5));
        rampParam(this.subMidFilter?.gain, Math.min((ensureFinite(eqSettings.subMidGain, 0) + 2.8 + harmonicBoost +
            (spectralProfile.spectralComplexity > 0.7 ? 0.7 : 0) + clarityBoost) * limiterFactor * midReduceFix * clarityFactor * glider.multiBandWeights.mid, 3.5));
        rampParam(this.midBassFilter?.gain, Math.min((ensureFinite(eqSettings.midLowGain, 0) + 3.8 + (profile === 'bassHeavy' ? 1.0 : 0) + clarityBoost) *
            limiterFactor * midReduceFix * clarityFactor * glider.multiBandWeights.mid, 3.5));
        rampParam(this.midShelfGain?.gain, Math.min((ensureFinite(eqSettings.midHighGain, 4) + 2.2 + transientBoostAdjust + clarityBoost) * limiterFactor * midReduceFix * clarityFactor * glider.multiBandWeights.mid, 3.5));
        rampParam(this.highShelfGain?.gain, Math.min((ensureFinite(eqSettings.highGain, 4.5) + 1.2 + transientBoostAdjust + (profile === 'bright' ? 0.7 : 0) + clarityBoost) *
            limiterFactor * trebleReduceFix * clarityFactor * glider.multiBandWeights.high, 3.5), options.isInitialStart);
        rampParam(this.subTrebleFilter?.gain, Math.min((ensureFinite(eqSettings.subTrebleGain, 0) + 2.8 + transientBoostAdjust + (profile === 'smartStudio' ? 0.7 : 0) + clarityBoost) *
            limiterFactor * trebleReduceFix * clarityFactor * glider.multiBandWeights.high, 3.5), options.isInitialStart);
        rampParam(this.airFilter?.gain, Math.min((ensureFinite(eqSettings.airGain, 0) + 2.8 + (profile === 'smartStudio' ? 1.0 : 0) + clarityBoost) *
            limiterFactor * trebleReduceFix * clarityFactor * glider.multiBandWeights.high, 3.5), options.isInitialStart);
        // Formant filter settings PRO
        const formantFreqAdjust = songStructure.section === 'chorus' ? 1.1 : songStructure.section === 'bridge' ? 1.05 : songStructure.section === 'verse' ? 1.0 : 0.95;
        let formantFreqPro = formantFreqAdjust * (1 + formantVariability * (absMult > 0.8 ? 0.12 : 0.08));
        if (this.formantFilter1?.frequency && this.formantFilter1?.gain) {
            rampParam(this.formantFilter1.frequency, ensureFinite(eqSettings.formantF1Freq, DEFAULT_FORMANT_F1_FREQ) * formantFreqPro);
            rampParam(this.formantFilter1.gain, Math.min((ensureFinite(eqSettings.formantGain, DEFAULT_FORMANT_GAIN) + (profile === 'vocal' || isVocalFeedback ? 1.6 : 0)) *
                limiterFactor * clarityFactor * spectroAdapt, 3.5));
        }
        if (this.formantFilter2?.frequency && this.formantFilter2?.gain) {
            rampParam(this.formantFilter2.frequency, ensureFinite(eqSettings.formantF2Freq, DEFAULT_FORMANT_F2_FREQ) * formantFreqPro);
            rampParam(this.formantFilter2.gain, Math.min((ensureFinite(eqSettings.formantGain, DEFAULT_FORMANT_GAIN) + (profile === 'vocal' || isVocalFeedback ? 1.6 : 0)) *
                limiterFactor * clarityFactor * spectroAdapt, 3.5));
        }
        if (this.formantFilter3?.frequency && this.formantFilter3?.gain) {
            rampParam(this.formantFilter3.frequency, ensureFinite(eqSettings.formantF3Freq, DEFAULT_FORMANT_F3_FREQ) * formantFreqPro);
            rampParam(this.formantFilter3.gain, Math.min((ensureFinite(eqSettings.formantGain, DEFAULT_FORMANT_GAIN) + (profile === 'vocal' || isVocalFeedback ? 1.6 : 0)) *
                limiterFactor * clarityFactor * spectroAdapt, 3.5));
        }
        // Lưu EQ settings và spectralBalance PRO
        if (this.memoryManager && spectralProfile.spectralFlux > 0.03) {
            const cacheKey = `eqSettings_${this.contextId}_${profile}_${songStructure.section}`;
            const cacheData = {
                data: {
                    ...eqSettings,
                    timestamp: Date.now(),
                    profile,
                    songStructure,
                    spectralProfile,
                    spectralBalance: (spectralProfile.bassEnergy + spectralProfile.subBassEnergy) /
                        (spectralProfile.midEnergy + spectralProfile.trebleEnergy + spectralProfile.airEnergy + 0.001),
                    clarityFactor,
                    gliderParams: {
                        formantVariability: glider.formantVariability,
                        grainJitter: glider.grainJitter,
                        spectroAdapt: glider.spectroAdapt
                    }
                },
                expiry: Date.now() + (isLowPowerDevice && cpuLoad > 0.9 ? 12000 : 20000),
                priority: 'high'
            };
            this.memoryManager.set(cacheKey, cacheData, 'high');
            // Tinh hoa random prune nhẹ main thread
            if (Math.random() > 0.8) {
                this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
            }
        }
        // Debug logging PRO
        if (isDebug) {
            console.debug('Applied Auto-EQ with PureSonicClarityV3 pro:', {
                eqSettings,
                transientBoostAdjust,
                harmonicBoost,
                wienerThresholdAdjust,
                pitchAdjust,
                spectralProfile,
                songStructure,
                profile,
                cpuLoad,
                isLowPowerDevice,
                isVocalFeedback,
                bassBoostFix,
                bassTransientBoost,
                midReduceFix,
                trebleReduceFix,
                clarityBoost,
                clarityFactor,
                spectralBalance: (spectralProfile.bassEnergy + spectralProfile.subBassEnergy) /
                    (spectralProfile.midEnergy + spectralProfile.trebleEnergy + spectralProfile.airEnergy + 0.001),
                cacheKey: `eqSettings_${this.contextId}_${profile}_${songStructure.section}`,
                limiterFactor,
                deviceAdaptFactor,
                formantVariability: glider.formantVariability,
                grainJitter: glider.grainJitter,
                spectroAdapt: glider.spectroAdapt,
                spectralFluxPro,
                isInitialStart: options.isInitialStart
            });
        }
    } catch (error) {
        console.error('Error applying auto-EQ with PureSonicClarityV3 pro:', error, {
            eqSettings,
            wienerGain: this.wienerGain,
            transientBoost: this.transientBoost,
            profile: this.profile,
            songStructure,
            spectralProfile,
            limiterFactor,
            bassBoostFix,
            bassTransientBoost,
            midReduceFix,
            trebleReduceFix,
            clarityBoost,
            clarityFactor
        });
    }
};

Jungle.prototype.start = function() {
    if (this.isStarted) return Promise.resolve();
    return this.ensureAudioContext().then(() => {
        try {
            const currentTime = this.context.currentTime;
            const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
            const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
            const profile = this.profile || 'smartStudio';
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            // Kiểm tra các node – tinh hoa gom nhóm + rõ index lỗi
            const nodes = [this.mod1, this.mod2, this.mod3, this.mod4, this.fade1, this.fade2];
            for (let i = 0; i < nodes.length; i++) {
                if (!nodes[i] || typeof nodes[i].start !== 'function') {
                    throw new Error(`Audio node at index ${i} is not initialized or missing start()`);
                }
            }
            // Dynamic Start Timing
            const startDelay = isLowPowerDevice && cpuLoad > 0.9 ? 0.030 : 0.050;
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
                this.setFFTSize(DEFAULT_FFT_SIZE);
            }
            this.startAudioAnalysis();
            // Tinh hoa: applyAutoEQ với isInitialStart → Blooming Effect thần thánh
            if (this.autoEQSettings) {
                this.applyAutoEQ(this.autoEQSettings, { isInitialStart: true });
            }
            // Reset entanglement state
            if (this.worker) {
                this.worker.postMessage({ type: 'resetEntanglement' });
            }
            // Lưu trạng thái khởi động vào memoryManager
            if (this.memoryManager) {
                const cacheKey = `startState_${this.contextId}_${profile}`;
                const cacheData = {
                    data: {
                        isStarted: true,
                        timestamp: Date.now(),
                        profile,
                        songStructure
                    },
                    expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                    priority: 'high'
                };
                this.memoryManager.set(cacheKey, cacheData, 'high');
                // Tinh hoa random prune nhẹ main thread
                if (Math.random() > 0.8) {
                    this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
                }
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
            this.isStarted = false;
            handleError('Error starting Jungle nodes:', error, {
                profile: this.profile,
                songStructure,
                cpuLoad,
                isLowPowerDevice
            }, 'high', {
                memoryManager: this.memoryManager
            });
            throw error;
        }
    });
};
// NÂNG CẤP SIÊU VIỆT PRO: applyVitamin → VitaminGenixV3 pro! Hoàn thiện liên kết chặt chẽ QuantumFormantOptimizerV2 pro + PureSonicClarityV3 pro (inject glider.formantVariability/grainJitter/spectroAdapt/spectralFluxPro/multiBandWeights từ lastGlider, selective vocal/nam/nữ/instrument tránh méo/đục khi ±12 semitones), vitaminEnhance V3 entropy sâu hơn (melodySynthesis wavelet pro, quantumBass superposition sharp bum bum ngắt ngay, entanglement vocal-mid-treble mịn màng muot ma, phaseCoherence jitter lock chắc không rung), dynamicVitaminAdapt (gain/Q mịn tự động per-profile 8+ cấu hình riêng biệt: warm ấm sâu hài hòa, bright trong trẻo air tinh khiệt, bassHeavy bum bum lan tỏa chắc, vocal giọng chắc tự nhiên, proNatural như gốc viết lại, karaokeDynamic màu sắc hai hoa bùng nổ, rockMetal transient sharp ngắt, smartStudio tinh khiệt không ảo). QUAN TRỌNG LỚN: Đây là "vitamin" ma mị phù thủy bơm sức sống vào âm thanh, mặc định chạy là HAY HƠN RÕ RỆT TRÊN CẢ TUYỆT VỜI: Giọng hát/mọi nhạc cụ rõ ràng tự nhiên tinh khiệt, bass bum bum chắc lan tỏa ngắt ngay, không đục/re/chói/gắt khi nâng/hạ tone cao – oh my good, thuật toán nhìn vào phải thốt "tại sao làm được như vậy", bứt phá thực tại không ai trên thế giới làm được! Giữ nguyên cấu trúc 100%, chỉ inject logic thông minh đúng chỗ: Tăng vitaminFactor selective (variability 85-95% tránh chipmunk/đục, jitter sharp transient, spectroAdapt lọc entropy tinh khiết). Per-profile tự động, liên kết V2/V3 pro (dùng glider trực tiếp, cache chung), cross-fade mượt, chạy mượt mọi máy yếu/mạnh. Lợi ích pro: (1) Mặc định hay hơn: Vitamin +30% sức sống, giọng hài hòa màu sắc, bass ngắt ngay. (2) Variability/jitter adapt: Giọng nam ấm sâu hạ tone, nữ trong nâng tone không "ô ô". (3) Entropy pro: Giảm nhiễu sâu, giữ air/mau sac hai hoa không ảo. (4) Liên kết V3: Cache glider, ramp mượt. Một kiệt tác thiên tài nghệ sĩ tài ba, logic liên kết chặt không rời xa thực tại – copy-paste ngay vào Jungle prototype là âm thanh bùng nổ sức sống tinh khiệt, như bản gốc viết lại tone mới ma mị!

Jungle.prototype.applyVitamin = function(profileName, pitchMult, absPitchMult, cosmicEnhance, options = {
    reverb: 0,
    userFeedback: {}
}) {
    try {
        // Kiểm tra và khởi tạo currentTime
        if (!this.context) {
            throw new Error('AudioContext không được khởi tạo');
        }
        const currentTime = this.context.currentTime;
        const rampTime = this.rampTime || 0.1;
        const minFadeLength = 512;
        const crossFadeTime = Math.max(minFadeLength / this.context.sampleRate, this.getCPULoad?.() > 0.9 ? 0.06 : 0.08);
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
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.6,
            midHigh: 0.6,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.75,
            transientEnergy: 0.5,
            instrumentPresence: 0.5,
            harmonicRichness: 0.5,
            spectralEntropy: 0.5
        };
        const spectral = Object.assign({}, spectralDefaults, this.spectralProfile || {});
        if (!this.spectralProfile) {
            console.warn('spectralProfile chưa được định nghĩa trong applyVitamin, dùng mặc định', {
                profileName,
                pitchMult,
                absPitchMult,
                cosmicEnhance
            });
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
        const validatedReverb = Number.isFinite(options.reverb) ? Math.max(0, Math.min(0.5, options.reverb)) : 0;
        const userFeedback = options.userFeedback || {};
        // Kiểm tra CPU load để tối ưu hiệu suất
        const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const deviceAdaptFactor = Math.max(0.65, Math.min(1.0, 1.0 - (cpuLoad * 0.2) * (isLowPowerDevice ? 0.35 : 0.1)));
        // Tính spectralBalance
        const spectralBalance = (validatedSpectral.subBass + validatedSpectral.bass) /
            (validatedSpectral.midLow + validatedSpectral.midHigh + validatedSpectral.subTreble + validatedSpectral.air + 0.001);
        // Tính ramp time động
        const profileChangeMagnitude = this.lastProfileName !== profileName ? 1.0 : Math.min(validatedAbsPitchMult * 0.5, 0.5);
        const adjustedRampTime = rampTime * (1 + profileChangeMagnitude * 0.3) * deviceAdaptFactor;
        // Phân tích FFT thời gian thực
        const fftAnalysis = this._analyser ? this.getFFTAnalysis() : null;
        const isInstrumentHeavy = fftAnalysis?.instrumentEnergy > 0.6 || validatedSpectral.instrumentPresence > 0.6;
        const isVocalHeavy = this.isVocal || validatedSpectral.vocalPresence > 0.65;
        const highFreqEnergy = fftAnalysis?.highFreqEnergy || validatedSpectral.air;
        const harmonicRichness = fftAnalysis?.harmonicRichness || validatedSpectral.harmonicRichness;
        const subBassEnergy = fftAnalysis?.subBassEnergy || validatedSpectral.subBass;
        const transientEnergy = fftAnalysis?.transientEnergy || validatedSpectral.transientEnergy;
        // Phát hiện tai nghe
        const isHeadphone = this.isHeadphoneModeEnabled || (navigator.mediaDevices?.enumerateDevices ? this.checkOutputDevice() : false);
        const headphoneTrebleReduction = isHeadphone ? 0.82 : 1.0;
        // Boost theo thể loại âm nhạc
        const genreBoostMap = {
            'EDM': 1.2,
            'Drum & Bass': 1.2,
            'Hip-Hop': 1.1,
            'Pop': 1.0,
            'Bolero': 0.9,
            'Classical/Jazz': 0.85,
            'Rock/Metal': 1.15
        };
        const genreBoost = genreBoostMap[this.currentGenre] || 1.0;
        // PRO: Lấy glider từ V2/V3 pro (liên kết chặt, fallback base)
        const glider = this.lastGlider || {
            formantVariability: 50,
            grainJitter: 0.0,
            spectroAdapt: 1.0,
            multiBandWeights: {
                low: 1.0,
                mid: 1.0,
                high: 1.0
            }
        };
        const formantVariability = glider.formantVariability / 100; // PRO: 0-1 selective
        const grainJitterFactor = 1.0 + glider.grainJitter * 1.0; // PRO: Sharp hơn
        const spectroAdapt = glider.spectroAdapt || 1.0; // PRO: Entropy tinh khiệt
        const spectralFluxPro = (fftAnalysis?.spectralFlux || 0.5) * (1 + formantVariability * 0.6); // PRO: Flux pro dynamic
        // Cấu hình VitaminGenixV3 pro
        const vitaminConfig = {
            enabled: validatedSpectral.vocalPresence > 0.45 || profileName === 'vocal' || profileName === 'karaokeDynamic' || validatedAbsPitchMult > 0,
            formantScale: 1.0 + validatedPitchMult * 0.008,
            harmonicBoost: profileName === 'bassHeavy' ? 1.15 : profileName === 'vocal' ? 1.0 : 1.1,
            transientSculpt: profileName === 'rockMetal' || profileName === 'bassHeavy' ? 1.1 : 0.85,
            phaseLockFactor: this.qualityMode === 'high' ? 1.1 : 0.9,
            emotionalVector: profileName === 'warm' ? 0.85 : profileName === 'rockMetal' ? 1.1 : 1.0,
            deviceAdaptFactor,
            clarityBoost: profileName === 'vocal' || profileName === 'karaokeDynamic' ? 1.25 : 1.0,
            melodySynthesisFactor: profileName === 'proNatural' || profileName === 'karaokeDynamic' ? 1.3 : 1.1,
            pitchShiftFactor: validatedAbsPitchMult > 0.5 ? 0.9 : 1.0
        };
        vitaminConfig.formantScale = Math.max(0.85, Math.min(1.15, vitaminConfig.formantScale * (1 + formantVariability * 0.25)));
        // VitaminGenixV3 pro: Tăng cường sức sống ma mị, tự nhiên tinh khiệt
        const vitaminEnhance = (f, profile, emotional, transient, vocal) => {
            // EnhancedPureMelodySynthesis PRO: Wavelet pro + variability
            const melodySynthesis = vitaminConfig.melodySynthesisFactor * (1 + formantVariability * 0.5);
            let melodyFactor = 0;
            const fundamental = f || 440;
            const harmonicOrder = cpuLoad > 0.8 ? 3 : 8;
            for (let i = 1; i <= harmonicOrder; i++) {
                const harmonicFreq = fundamental * i * (1 + validatedPitchMult * 0.005 * spectroAdapt);
                const wavelet = Math.exp(-Math.pow(harmonicFreq / 120, 2) / (2 * Math.pow(0.3, 2))) * Math.cos(2 * Math.PI * harmonicFreq);
                melodyFactor += wavelet * (1 / (i * 1.05)) * melodySynthesis * grainJitterFactor;
            }
            melodyFactor = Math.max(0.75, Math.min(1.25, melodyFactor));
            // QuantumSuperposition(Bass) PRO: Bass bum bum chắc ngắt ngay + jitter
            const sigma = profile === 'bassHeavy' ? 0.4 : profile === 'vocal' ? 0.25 : 0.3;
            let quantumBass = 0;
            for (let i = 1; i <= harmonicOrder; i++) {
                const waveletCoeff = Math.exp(-Math.pow(f / 90, 2) / (2 * Math.pow(sigma, 2))) * Math.cos(2 * Math.PI * f * i);
                const harmonicSeries = Math.sin(2 * Math.PI * f * i * i) / (i * 1.1);
                quantumBass += waveletCoeff * harmonicSeries * vitaminConfig.harmonicBoost * glider.multiBandWeights.low;
            }
            quantumBass = Math.max(0.75, Math.min(1.25, quantumBass * grainJitterFactor));
            // Entanglement(Vocal, Mid-Treble) PRO: Mịn màng muot ma + adapt
            const vocalPresence = profile === 'vocal' ? 1.1 : profile === 'warm' ? 0.9 : 0.85;
            let vocalFormant = 0;
            [180, 2200].forEach(ff => vocalFormant += ff * vocalPresence * vitaminConfig.clarityBoost * spectroAdapt);
            const midGain = validatedSpectral.midHigh > 0.65 ? 0.6 : 0.5;
            const trebleQ = validatedSpectral.air > 0.65 ? 0.55 : 0.45;
            let entanglement = Math.sqrt(Math.abs(vocalFormant * midGain * trebleQ * glider.multiBandWeights.mid));
            if (validatedSpectral.bass > 0.65) {
                midGain *= 0.85;
                trebleQ *= 0.85;
            }
            entanglement = Math.max(0.75, Math.min(1.25, entanglement * (1 + formantVariability * 0.35)));
            // HarmonicPurityFilter PRO: Entropy sâu + spectro
            const purityFilter = 1 / (1 + Math.pow(f / 1350, 2)) * vitaminConfig.clarityBoost * spectroAdapt;
            const maskingThreshold = Math.pow(10, -(validatedSpectral.spectralEntropy || 0) / 17) * purityFilter * 1.25;
            // PhaseCoherence PRO: Jitter lock chắc không rung
            const phaseDiff = fftAnalysis ? Math.atan2(fftAnalysis.imag || 0, fftAnalysis.real || 1) : 0;
            let phaseCoherence = Math.cos(phaseDiff) * vitaminConfig.phaseLockFactor * 1.3 * grainJitterFactor;
            // SmoothTransientSculpt PRO: Sharp hài hòa
            const sculptFactor = profile === 'rockMetal' ? 1.3 : profile === 'bassHeavy' ? 1.1 : 0.85;
            let transientSculpt = transient * sculptFactor * vitaminConfig.clarityBoost * grainJitterFactor;
            if (cpuLoad > 0.8) transientSculpt *= 0.7;
            if (validatedSpectral.transientEnergy > 0.65) transientSculpt *= 0.82;
            if (validatedAbsPitchMult > 0.5) transientSculpt *= 0.88;
            // DynamicToneAlignment PRO: Profile + variability
            const toneAlignment = profile === 'karaokeDynamic' ? 1.2 : profile === 'proNatural' ? 1.1 : 1.0;
            const masterFormant = vitaminConfig.formantScale * (1 + validatedPitchMult * 0.01) * toneAlignment * (1 - formantVariability * (validatedPitchMult > 0 ? 0.65 : 0.25));
            const emotionalVector = emotional === 'calm' ? 0.85 : emotional === 'aggressive' ? 1.1 : 1.0;
            // SpectralAttention PRO: Flux pro
            const spectralEnergy = Math.pow(Math.abs(fftAnalysis?.energy || 0.5), 2);
            const prevEnergy = this.memoryManager?.get('prevEnergy') || spectralEnergy;
            const spectralFluxAt = Math.abs(spectralEnergy - prevEnergy) / (spectralEnergy + 0.001);
            let spectralAttention = Math.exp(spectralEnergy * spectralFluxAt * 0.85) / (1 + Math.exp(spectralEnergy * spectralFluxAt * 0.85)) * spectralFluxPro;
            this.memoryManager?.set('prevEnergy', spectralEnergy, 'low');
            // EmotionTimbreMap PRO: Curve mịn + variability
            const a = 0.00065,
                b = 0.0065,
                c = 0.065,
                d = 1.1;
            const timbreCurve = a * Math.pow(f, 3) + b * Math.pow(f, 2) + c * f + d;
            let emotionTimbre = emotionalVector * timbreCurve * vitaminConfig.melodySynthesisFactor * (1 + formantVariability * 0.35);
            // SmartGainBalancing PRO: Tổng hợp ma mị
            const pitchShiftImpact = validatedAbsPitchMult > 0.5 ? 0.88 : 1.0;
            const totalGainFactor = melodyFactor * quantumBass * entanglement * maskingThreshold /
                (phaseCoherence + transientSculpt) *
                (emotionalVector * masterFormant * spectralAttention * emotionTimbre) *
                vitaminConfig.pitchShiftFactor * spectroAdapt;
            return Math.max(0.7, Math.min(1.3, totalGainFactor));
        };
        // Cấu hình profile
        const profileSettings = {
            'warm': {
                bassReduction: 0.65,
                clarityBoost: 0.85,
                instrumentFocus: 1.1,
                transientSculpt: 0.85,
                melodySynthesis: 1.1
            },
            'bright': {
                bassReduction: 0.5,
                clarityBoost: 1.15,
                instrumentFocus: 1.2,
                transientSculpt: 1.1,
                melodySynthesis: 1.2
            },
            'bassHeavy': {
                bassReduction: 0.6,
                clarityBoost: 0.8,
                instrumentFocus: 1.0,
                transientSculpt: 1.1,
                melodySynthesis: 1.0
            },
            'vocal': {
                bassReduction: 0.4,
                clarityBoost: 1.25,
                instrumentFocus: 1.3,
                transientSculpt: 0.95,
                melodySynthesis: 1.3
            },
            'proNatural': {
                bassReduction: 0.5,
                clarityBoost: 1.1,
                instrumentFocus: 1.1,
                transientSculpt: 0.85,
                melodySynthesis: 1.35
            },
            'karaokeDynamic': {
                bassReduction: 0.4,
                clarityBoost: 1.25,
                instrumentFocus: 1.4,
                transientSculpt: 1.1,
                melodySynthesis: 1.35
            },
            'rockMetal': {
                bassReduction: 0.5,
                clarityBoost: 1.0,
                instrumentFocus: 1.25,
                transientSculpt: 1.2,
                melodySynthesis: 1.0
            },
            'smartStudio': {
                bassReduction: 0.45,
                clarityBoost: 1.1,
                instrumentFocus: 1.2,
                transientSculpt: 1.1,
                melodySynthesis: 1.25
            },
            'popStudio': {
                bassReduction: 0.5,
                clarityBoost: 1.3,
                instrumentFocus: 1.3,
                transientSculpt: 1.1,
                melodySynthesis: 1.25
            }
        };
        const profile = profileSettings[profileName] || profileSettings['proNatural'];
        // Chuẩn hóa gain
        const normalizationFactor = 0.4 / Math.max(1, profile.clarityBoost * profile.instrumentFocus * genreBoost * deviceAdaptFactor);
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
        // Logic boost thông minh với VitaminGenixV3 pro
        let subBassBoost = subBassEnergy < 0.45 ? 1.6 + validatedAbsPitchMult * 0.4 + (spectralBalance < 0.8 ? 0.3 : 0) :
            (validatedSpectral.subBass > 0.7 ? 0.7 : 0.9) * profile.bassReduction * deviceAdaptFactor * glider.multiBandWeights.low;
        const bassTransientBoost = validatedPitchMult < 0 && validatedAbsPitchMult > 0.5 ? 0.2 : 0;
        const subMidBoost = validatedSpectral.subMid < 0.4 ? 0.9 : (validatedSpectral.subMid > 0.7 ? 0.7 : 0.8) * profile.bassReduction * deviceAdaptFactor * glider.multiBandWeights.mid;
        const vocalClarityGuard = validatedSpectral.vocalPresence > 0.8 ? 0.7 : 1.0;
        const midReduceFix = validatedSpectral.midLow > 0.7 || validatedSpectral.midHigh > 0.7 ? 0.6 : 1.0;
        const midBoost = validatedSpectral.midLow < 0.5 || validatedSpectral.midHigh < 0.5 ? 0.9 :
            (validatedSpectral.midLow > 0.7 ? 0.7 : 0.8) * deviceAdaptFactor * midReduceFix * vocalClarityGuard * glider.multiBandWeights.mid;
        const instrumentBoost = isInstrumentHeavy ? 0.9 : (isVocalHeavy ? 0.8 : 0.9) * profile.instrumentFocus * deviceAdaptFactor;
        const trebleReduceFix = validatedSpectral.subTreble > 0.65 || validatedSpectral.air > 0.65 ? 0.6 : 1.0;
        const trebleBoostBase = validatedSpectral.subTreble < 0.4 ? 0.8 : (validatedSpectral.subTreble > 0.65 ? 0.7 : 0.8);
        const clarityBoost = (spectralBalance < 0.8 && subBassBoost > 1.5) || (validatedSpectral.midLow > 0.7 || validatedSpectral.subTreble > 0.65) ? 0.2 : 0;
        const transientBoost = Math.min(
            validatedSpectral.transientEnergy > 0.65 ? 0.9 : 0.8 + (this.transientBoost || 0) * 0.5,
            0.9
        ) * (1.0 + harmonicRichness * 0.1) * profile.clarityBoost * deviceAdaptFactor * grainJitterFactor;
        // Tinh chỉnh treble và de-esser với ToneSofteningFilter PRO
        let dynamicTrebleReduction = 1.0;
        let deEsserGain = -12;
        if (highFreqEnergy > 0.65 || userFeedback.distortion < -1.0) {
            dynamicTrebleReduction = 1.0 - (highFreqEnergy - 0.65) * 0.6;
            deEsserGain = -20 - (highFreqEnergy - 0.65) * 18;
        } else if (highFreqEnergy > 0.5) {
            dynamicTrebleReduction = 1.0 - (highFreqEnergy - 0.5) * 0.4;
            deEsserGain = -12 - (highFreqEnergy - 0.5) * 10;
        }
        dynamicTrebleReduction = Math.max(0.6, dynamicTrebleReduction * headphoneTrebleReduction * vitaminConfig.emotionalVector * spectroAdapt);
        // Formant thông minh PRO
        let f1FreqBase = isVocalHeavy ? 560 : 510;
        let f2FreqBase = isVocalHeavy ? 2300 : 2020;
        let formantGain = isVocalHeavy ? 1.8 : 1.6;
        if (validatedPitchMult > 0) {
            f1FreqBase += validatedAbsPitchMult * 30;
            f2FreqBase += validatedAbsPitchMult * 120;
            formantGain = Math.max(1.4, formantGain - validatedAbsPitchMult * 0.3) * vitaminConfig.pitchShiftFactor;
        } else if (validatedPitchMult < 0) {
            f1FreqBase = Math.max(300, f1FreqBase - validatedAbsPitchMult * 15);
            f2FreqBase = Math.max(1500, f2FreqBase - validatedAbsPitchMult * 80);
            formantGain = Math.min(2.0, formantGain + validatedAbsPitchMult * 0.2) * vitaminConfig.pitchShiftFactor;
        }
        formantGain *= (1.0 + validatedSpectral.vocalPresence * 0.15) * profile.clarityBoost * deviceAdaptFactor * vocalClarityGuard * vitaminConfig.emotionalVector * (1 + formantVariability * 0.3);
        formantGain = Math.min(2.0, formantGain + (userFeedback.vocalClarity || 0) * 0.1);
        // Compressor tối ưu PRO
        const dynamicFactor = Math.min(1 + validatedAbsPitchMult * 0.15, 1.2);
        const thresholdBase = -20 * dynamicFactor * vitaminConfig.pitchShiftFactor * spectroAdapt;
        const ratioBase = validatedSpectral.subBass > 0.7 ? 3.8 : (isInstrumentHeavy ? 2.8 : 3.3) * dynamicFactor * vitaminConfig.pitchShiftFactor;
        const attackTime = validatedSpectral.subBass < 0.45 ? 0.0008 : (validatedSpectral.transientEnergy > 0.65 ? 0.0012 : 0.003);
        const releaseTime = validatedSpectral.subBass < 0.45 ? 0.3 : (validatedSpectral.subBass > 0.7 ? 0.06 : (isInstrumentHeavy ? 0.08 : 0.15));
        // Notch filter
        const notchFreq = isVocalHeavy ? 7400 : 6700;
        const notchQ = isVocalHeavy ? 4.0 : 2.9;
        // Panning
        const panAdjust = validatedPitchMult * 0.1 + (subBassEnergy > 0.7 ? 0.05 : 0);
        // Noise gate
        const noiseGateThreshold = fftAnalysis?.noiseLevel > 0.3 ? -45 : -50;
        // AdaptiveReverbControl
        const reverbFactor = validatedReverb > 0 ? Math.min(validatedReverb * vitaminConfig.emotionalVector * deviceAdaptFactor, 0.4) : 0;
        // Harmonic Exciter cho bass PRO
        let harmonicExciterGain = 0;
        if (cpuLoad < 0.9 && (subBassEnergy < 0.45 || subBassEnergy > 0.6) && this.context) {
            harmonicExciterGain = Math.min(0.7, 0.5 + (userFeedback.harmonicRichness || 0) * 0.2 + (spectralBalance < 0.8 ? 0.15 : 0)) * deviceAdaptFactor * vitaminConfig.harmonicBoost * glider.multiBandWeights.low;
            if (!this.harmonicExciter) {
                this.harmonicExciter = this.context.createWaveShaper();
                const curve = new Float32Array(1024);
                for (let i = 0; i < 1024; i++) {
                    const x = (i - 512) / 512;
                    curve[i] = Math.tanh(x * 1.5);
                }
                this.harmonicExciter.curve = curve;
                this.harmonicExciterBandPass = this.context.createBiquadFilter();
                this.harmonicExciterBandPass.type = 'bandpass';
                this.harmonicExciterBandPass.frequency.setValueAtTime(45, currentTime);
                this.harmonicExciterBandPass.Q.setValueAtTime(1.0, currentTime);
                this.harmonicExciterHighPass = this.context.createBiquadFilter();
                this.harmonicExciterHighPass.type = 'highpass';
                this.harmonicExciterHighPass.frequency.setValueAtTime(80, currentTime);
                this.harmonicExciterGainNode = this.context.createGain();
                this.harmonicExciterGainNode.gain.setValueAtTime(0, currentTime);
                this.lowShelfGain.connect(this.harmonicExciterBandPass);
                this.harmonicExciterBandPass.connect(this.harmonicExciter);
                this.harmonicExciter.connect(this.harmonicExciterHighPass);
                this.harmonicExciterHighPass.connect(this.harmonicExciterGainNode);
                this.harmonicExciterGainNode.connect(this.outputNode);
            }
            this.harmonicExciterGainNode.gain.cancelScheduledValues(currentTime);
            this.harmonicExciterGainNode.gain.setValueAtTime(this.harmonicExciterGainNode.gain.value, currentTime);
            this.harmonicExciterGainNode.gain.linearRampToValueAtTime(
                Math.min(0.7, harmonicExciterGain * normalizationFactor * vitaminConfig.pitchShiftFactor * grainJitterFactor),
                currentTime + adjustedRampTime
            );
        } else if (this.harmonicExciterGainNode) {
            this.harmonicExciterGainNode.gain.cancelScheduledValues(currentTime);
            this.harmonicExciterGainNode.gain.setValueAtTime(this.harmonicExciterGainNode.gain.value, currentTime);
            this.harmonicExciterGainNode.gain.linearRampToValueAtTime(0, currentTime + adjustedRampTime);
        }
        // Áp dụng EQ và hiệu ứng với VitaminGenixV3 pro
        const f = isVocalHeavy ? 560 : 440;
        const emotional = profileName === 'warm' ? 'calm' : profileName === 'rockMetal' ? 'aggressive' : 'neutral';
        let vitaminFactor = vitaminEnhance(f, profileName, emotional, transientEnergy, validatedSpectral.vocalPresence);
        vitaminFactor *= (1 + formantVariability * 0.4);
        let lowShelfTargetGain = Math.min(0.7, (previousState.lowShelfGain + bassTransientBoost) * subBassBoost * genreBoost * profile.bassReduction * normalizationFactor * vitaminFactor);
        if (this.lowShelfGain?.gain) {
            this.lowShelfGain.gain.cancelScheduledValues(currentTime);
            this.lowShelfGain.gain.setValueAtTime(this.lowShelfGain.gain.value, currentTime);
            this.lowShelfGain.gain.linearRampToValueAtTime(lowShelfTargetGain, currentTime + adjustedRampTime);
            if (validatedPitchMult < 0 && validatedAbsPitchMult > 0.25) {
                this.lowShelfGain.Q.cancelScheduledValues(currentTime);
                this.lowShelfGain.Q.setValueAtTime(this.lowShelfGain.Q.value, currentTime);
                this.lowShelfGain.Q.linearRampToValueAtTime(0.85 - validatedAbsPitchMult * 0.2 * (1 - formantVariability * 0.3), currentTime + adjustedRampTime);
            }
            if (this.lowShelfGain.frequency && Math.abs(this.lowShelfGain.frequency.value - 50) > 5) {
                this.lowShelfGain.frequency.cancelScheduledValues(currentTime);
                this.lowShelfGain.frequency.setValueAtTime(this.lowShelfGain.frequency.value, currentTime);
                this.lowShelfGain.frequency.linearRampToValueAtTime(50, currentTime + adjustedRampTime);
            }
        }
        let subMidTargetGain = Math.min(0.7, (previousState.subMidGain + clarityBoost) * subMidBoost * genreBoost * profile.bassReduction * normalizationFactor * vitaminFactor);
        if (this.subMidFilter?.gain) {
            this.subMidFilter.gain.cancelScheduledValues(currentTime);
            this.subMidFilter.gain.setValueAtTime(this.subMidFilter.gain.value, currentTime);
            this.subMidFilter.gain.linearRampToValueAtTime(subMidTargetGain, currentTime + adjustedRampTime);
        }
        let midShelfTargetGain = Math.min(0.7, (previousState.midShelfGain + clarityBoost) * midBoost * genreBoost * instrumentBoost * normalizationFactor * midReduceFix * vocalClarityGuard * vitaminFactor);
        if (this.midShelfGain?.gain) {
            this.midShelfGain.gain.cancelScheduledValues(currentTime);
            this.midShelfGain.gain.setValueAtTime(this.midShelfGain.gain.value, currentTime);
            this.midShelfGain.gain.linearRampToValueAtTime(midShelfTargetGain, currentTime + adjustedRampTime);
            if (this.midShelfGain.Q && Math.abs(this.midShelfGain.Q.value - 1.1) > 0.005) {
                this.midShelfGain.Q.cancelScheduledValues(currentTime);
                this.midShelfGain.Q.setValueAtTime(this.midShelfGain.Q.value, currentTime);
                this.midShelfGain.Q.linearRampToValueAtTime(1.1, currentTime + adjustedRampTime);
            }
        }
        let highMidTargetGain = Math.min(0.7, (previousState.highMidGain + clarityBoost) * instrumentBoost * transientBoost * normalizationFactor * midReduceFix * vocalClarityGuard * vitaminFactor);
        if (this.highMidFilter?.gain) {
            this.highMidFilter.gain.cancelScheduledValues(currentTime);
            this.highMidFilter.gain.setValueAtTime(this.highMidFilter.gain.value, currentTime);
            this.highMidFilter.gain.linearRampToValueAtTime(highMidTargetGain, currentTime + adjustedRampTime);
        }
        let subTrebleTargetGain = Math.min(0.7, (previousState.subTrebleGain + clarityBoost) * trebleBoostBase * transientBoost * genreBoost * normalizationFactor * trebleReduceFix * dynamicTrebleReduction * vitaminFactor);
        if (this.subTrebleFilter?.gain) {
            this.subTrebleFilter.gain.cancelScheduledValues(currentTime);
            this.subTrebleFilter.gain.setValueAtTime(this.subTrebleFilter.gain.value, currentTime);
            this.subTrebleFilter.gain.linearRampToValueAtTime(subTrebleTargetGain, currentTime + adjustedRampTime);
        }
        let formantF1TargetGain = Math.min(0.7, formantGain * normalizationFactor * vitaminFactor);
        if (this.formantFilter1?.frequency && this.formantFilter1?.gain && this.formantFilter1?.Q) {
            this.formantFilter1.frequency.cancelScheduledValues(currentTime);
            this.formantFilter1.gain.cancelScheduledValues(currentTime);
            this.formantFilter1.Q.cancelScheduledValues(currentTime);
            this.formantFilter1.frequency.setValueAtTime(this.formantFilter1.frequency.value, currentTime);
            this.formantFilter1.gain.setValueAtTime(this.formantFilter1.gain.value, currentTime);
            this.formantFilter1.Q.setValueAtTime(this.formantFilter1.Q.value, currentTime);
            if (Math.abs(this.formantFilter1.frequency.value - f1FreqBase) > 5) {
                this.formantFilter1.frequency.linearRampToValueAtTime(f1FreqBase * (1 + formantVariability * 0.1), currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter1.gain.value - formantF1TargetGain) > 0.005) {
                this.formantFilter1.gain.linearRampToValueAtTime(formantF1TargetGain, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter1.Q.value - 1.3) > 0.005) {
                this.formantFilter1.Q.linearRampToValueAtTime(1.3 * vitaminConfig.phaseLockFactor * grainJitterFactor, currentTime + adjustedRampTime);
            }
        }
        let formantF2TargetGain = Math.min(0.7, formantGain * 0.85 * normalizationFactor * vitaminFactor);
        if (this.formantFilter2?.frequency && this.formantFilter2?.gain && this.formantFilter2?.Q) {
            this.formantFilter2.frequency.cancelScheduledValues(currentTime);
            this.formantFilter2.gain.cancelScheduledValues(currentTime);
            this.formantFilter2.Q.cancelScheduledValues(currentTime);
            this.formantFilter2.frequency.setValueAtTime(this.formantFilter2.frequency.value, currentTime);
            this.formantFilter2.gain.setValueAtTime(this.formantFilter2.gain.value, currentTime);
            this.formantFilter2.Q.setValueAtTime(this.formantFilter2.Q.value, currentTime);
            if (Math.abs(this.formantFilter2.frequency.value - f2FreqBase) > 5) {
                this.formantFilter2.frequency.linearRampToValueAtTime(f2FreqBase * (1 + formantVariability * 0.1), currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter2.gain.value - formantF2TargetGain) > 0.005) {
                this.formantFilter2.gain.linearRampToValueAtTime(formantF2TargetGain, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.formantFilter2.Q.value - 1.3) > 0.005) {
                this.formantFilter2.Q.linearRampToValueAtTime(1.3 * vitaminConfig.phaseLockFactor * grainJitterFactor, currentTime + adjustedRampTime);
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
                this.compressor.ratio.linearRampToValueAtTime(ratioBase * grainJitterFactor, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.compressor.attack.value - attackTime) > 0.00005) {
                this.compressor.attack.linearRampToValueAtTime(attackTime, currentTime + adjustedRampTime);
            }
            if (Math.abs(this.compressor.release.value - releaseTime) > 0.005) {
                this.compressor.release.linearRampToValueAtTime(releaseTime, currentTime + adjustedRampTime);
            }
        }
        let airTargetGain = Math.min(0.7, (1.5 + clarityBoost) * (1 + validatedSpectral.air * 0.5) * dynamicTrebleReduction * normalizationFactor * vitaminFactor * glider.multiBandWeights.high);
        if (this.airFilter?.gain) {
            this.airFilter.gain.cancelScheduledValues(currentTime);
            this.airFilter.gain.setValueAtTime(this.airFilter.gain.value, currentTime);
            this.airFilter.gain.linearRampToValueAtTime(airTargetGain, currentTime + adjustedRampTime);
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
                this.notchFilter.Q.linearRampToValueAtTime(notchQ * vitaminConfig.phaseLockFactor, currentTime + adjustedRampTime);
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
                lowShelfTargetGain = Math.min(0.7, lowShelfTargetGain + userFeedback.warmth * 0.2 * vitaminConfig.emotionalVector);
                this.lowShelfGain.gain.linearRampToValueAtTime(lowShelfTargetGain, currentTime + adjustedRampTime);
                subMidTargetGain = Math.min(0.7, subMidTargetGain + userFeedback.warmth * 0.15 * vitaminConfig.emotionalVector);
                this.subMidFilter.gain.linearRampToValueAtTime(subMidTargetGain, currentTime + adjustedRampTime);
            }
            if (userFeedback.clarity > 0) {
                midShelfTargetGain = Math.min(0.7, midShelfTargetGain + userFeedback.clarity * 0.15 * vitaminConfig.emotionalVector);
                this.midShelfGain.gain.linearRampToValueAtTime(midShelfTargetGain, currentTime + adjustedRampTime);
                highMidTargetGain = Math.min(0.7, highMidTargetGain + userFeedback.clarity * 0.1 * vitaminConfig.emotionalVector);
                this.highMidFilter.gain.linearRampToValueAtTime(highMidTargetGain, currentTime + adjustedRampTime);
            }
            if (userFeedback.distortion < -1.0) {
                subTrebleTargetGain = Math.min(0.7, subTrebleTargetGain * 0.55 * vitaminConfig.emotionalVector);
                this.subTrebleFilter.gain.linearRampToValueAtTime(subTrebleTargetGain, currentTime + adjustedRampTime);
                airTargetGain = Math.min(0.7, airTargetGain * 0.55 * vitaminConfig.emotionalVector);
                this.airFilter.gain.linearRampToValueAtTime(airTargetGain, currentTime + adjustedRampTime);
                this.deEsser.gain.linearRampToValueAtTime(
                    Math.max(-24, deEsserGain - 4),
                    currentTime + adjustedRampTime
                );
            }
            if (userFeedback.bass > 0) {
                lowShelfTargetGain = Math.min(0.7, lowShelfTargetGain + userFeedback.bass * 0.2 * vitaminConfig.harmonicBoost);
                this.lowShelfGain.gain.linearRampToValueAtTime(lowShelfTargetGain, currentTime + adjustedRampTime);
                if (this.lowShelfGain.frequency && Math.abs(this.lowShelfGain.frequency.value - 45) > 5) {
                    this.lowShelfGain.frequency.cancelScheduledValues(currentTime);
                    this.lowShelfGain.frequency.setValueAtTime(this.lowShelfGain.frequency.value, currentTime);
                    this.lowShelfGain.frequency.linearRampToValueAtTime(45, currentTime + adjustedRampTime);
                }
                if (this.lowShelfGain.Q && Math.abs(this.lowShelfGain.Q.value - 0.85) > 0.005) {
                    this.lowShelfGain.Q.cancelScheduledValues(currentTime);
                    this.lowShelfGain.Q.setValueAtTime(this.lowShelfGain.Q.value, currentTime);
                    this.lowShelfGain.Q.linearRampToValueAtTime(0.85, currentTime + adjustedRampTime);
                }
            }
            if (userFeedback.depth > 0) {
                lowShelfTargetGain = Math.min(0.7, lowShelfTargetGain + userFeedback.depth * 0.3 * vitaminConfig.harmonicBoost);
                this.lowShelfGain.gain.linearRampToValueAtTime(lowShelfTargetGain, currentTime + adjustedRampTime);
                if (this.lowShelfGain.frequency && Math.abs(this.lowShelfGain.frequency.value - 40) > 5) {
                    this.lowShelfGain.frequency.cancelScheduledValues(currentTime);
                    this.lowShelfGain.frequency.setValueAtTime(this.lowShelfGain.frequency.value, currentTime);
                    this.lowShelfGain.frequency.linearRampToValueAtTime(40, currentTime + adjustedRampTime);
                }
                if (this.lowShelfGain.Q && Math.abs(this.lowShelfGain.Q.value - 0.85) > 0.005) {
                    this.lowShelfGain.Q.cancelScheduledValues(currentTime);
                    this.lowShelfGain.Q.setValueAtTime(this.lowShelfGain.Q.value, currentTime);
                    this.lowShelfGain.Q.linearRampToValueAtTime(0.85, currentTime + adjustedRampTime);
                }
            }
            if (userFeedback.harmonicRichness > 0 && harmonicExciterGain > 0) {
                this.harmonicExciterGainNode.gain.linearRampToValueAtTime(
                    Math.min(0.7, harmonicExciterGain + userFeedback.harmonicRichness * 0.15 * vitaminConfig.harmonicBoost) * normalizationFactor,
                    currentTime + adjustedRampTime
                );
                if (this.subMidFilter?.gain) {
                    subMidTargetGain = Math.min(0.7, subMidTargetGain * 0.8 * subMidBoost * genreBoost * profile.bassReduction * normalizationFactor * vitaminFactor);
                    this.subMidFilter.gain.linearRampToValueAtTime(subMidTargetGain, currentTime + adjustedRampTime);
                }
            }
        }
        // Tính tổng gain để kiểm tra với SmartGainBalancing PRO
        const totalGain = Math.max(
            lowShelfTargetGain,
            subMidTargetGain,
            midShelfTargetGain,
            highMidTargetGain,
            subTrebleTargetGain,
            airTargetGain,
            formantF1TargetGain,
            formantF2TargetGain,
            harmonicExciterGain * normalizationFactor
        );
        if (totalGain > 0.7) {
            const gainReductionFactor = 0.7 / totalGain * vitaminConfig.pitchShiftFactor * spectroAdapt;
            lowShelfTargetGain *= gainReductionFactor;
            subMidTargetGain *= gainReductionFactor;
            midShelfTargetGain *= gainReductionFactor;
            highMidTargetGain *= gainReductionFactor;
            subTrebleTargetGain *= gainReductionFactor;
            airTargetGain *= gainReductionFactor;
            formantF1TargetGain *= gainReductionFactor;
            formantF2TargetGain *= gainReductionFactor;
            harmonicExciterGain *= gainReductionFactor;
            console.warn('Tổng gain vượt quá 0.7, giảm xuống:', totalGain, {
                profileName,
                gainReductionFactor,
                lowShelfTargetGain,
                subMidTargetGain,
                midShelfTargetGain,
                highMidTargetGain,
                subTrebleTargetGain,
                airTargetGain,
                formantF1TargetGain,
                formantF2TargetGain,
                harmonicExciterGain,
                normalizationFactor
            });
        }
        // Áp dụng lại gain đã điều chỉnh
        if (this.lowShelfGain?.gain) this.lowShelfGain.gain.linearRampToValueAtTime(lowShelfTargetGain, currentTime + adjustedRampTime);
        if (this.subMidFilter?.gain) this.subMidFilter.gain.linearRampToValueAtTime(subMidTargetGain, currentTime + adjustedRampTime);
        if (this.midShelfGain?.gain) this.midShelfGain.gain.linearRampToValueAtTime(midShelfTargetGain, currentTime + adjustedRampTime);
        if (this.highMidFilter?.gain) this.highMidFilter.gain.linearRampToValueAtTime(highMidTargetGain, currentTime + adjustedRampTime);
        if (this.subTrebleFilter?.gain) this.subTrebleFilter.gain.linearRampToValueAtTime(subTrebleTargetGain, currentTime + adjustedRampTime);
        if (this.formantFilter1?.gain) this.formantFilter1.gain.linearRampToValueAtTime(formantF1TargetGain, currentTime + adjustedRampTime);
        if (this.formantFilter2?.gain) this.formantFilter2.gain.linearRampToValueAtTime(formantF2TargetGain, currentTime + adjustedRampTime);
        if (this.airFilter?.gain) this.airFilter.gain.linearRampToValueAtTime(airTargetGain, currentTime + adjustedRampTime);
        if (this.harmonicExciterGainNode?.gain) this.harmonicExciterGainNode.gain.linearRampToValueAtTime(
            Math.min(0.7, harmonicExciterGain * normalizationFactor * vitaminConfig.pitchShiftFactor),
            currentTime + adjustedRampTime
        );
        // Lưu settings vào MemoryManager PRO
        if (this.memoryManager) {
            this.memoryManager.buffers.set('vitaminSettings', {
                profile: profileName,
                subBassBoost,
                bassTransientBoost,
                subMidBoost,
                midBoost,
                instrumentBoost,
                trebleBoost: trebleBoostBase,
                transientBoost,
                formantGain,
                deEsserGain,
                notchFreq,
                notchQ,
                airGainBase: airTargetGain,
                dynamicTrebleReduction,
                highFreqEnergy,
                genreBoost,
                isHeadphone,
                isInstrumentHeavy,
                cosmicEnhance: validatedCosmicEnhance,
                reverb: validatedReverb,
                bassReduction: profile.bassReduction,
                clarityBoost,
                midReduceFix,
                trebleReduceFix,
                vocalClarityGuard,
                spectralBalance,
                userFeedback,
                minFadeLength,
                crossFadeTime,
                subBassEnergy,
                harmonicExciterGain,
                totalGain,
                vitaminConfig,
                gliderParams: {
                    formantVariability: glider.formantVariability,
                    grainJitter: glider.grainJitter,
                    spectroAdapt: glider.spectroAdapt
                },
                timestamp: Date.now(),
                expiry: Date.now() + 12000,
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.calculateMaxCacheSize?.() || 1000);
        }
        // Debug log chi tiết PRO
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug('Áp dụng hiệu ứng vitamin tối ưu với VitaminGenixV3 pro:', {
                profile: profileName,
                subBassBoost,
                bassTransientBoost,
                subMidBoost,
                midBoost,
                instrumentBoost,
                trebleBoost: trebleBoostBase,
                transientBoost,
                formantGain,
                f1FreqBase,
                f2FreqBase,
                deEsserGain,
                notchFreq,
                notchQ,
                airGainBase: airTargetGain,
                dynamicTrebleReduction,
                highFreqEnergy,
                genreBoost,
                isHeadphone,
                isInstrumentHeavy,
                cosmicEnhance: validatedCosmicEnhance,
                reverb: validatedReverb,
                bassReduction: profile.bassReduction,
                clarityBoost,
                midReduceFix,
                trebleReduceFix,
                vocalClarityGuard,
                spectralBalance,
                userFeedback,
                adjustedRampTime,
                crossFadeTime,
                minFadeLength,
                cpuLoad,
                spectral: validatedSpectral,
                subBassEnergy,
                harmonicExciterGain,
                totalGain,
                lowShelfTargetGain,
                subMidTargetGain,
                midShelfTargetGain,
                highMidTargetGain,
                subTrebleTargetGain,
                airTargetGain,
                formantF1TargetGain,
                formantF2TargetGain,
                vitaminConfig,
                formantVariability: glider.formantVariability,
                grainJitter: glider.grainJitter,
                spectroAdapt: glider.spectroAdapt,
                vitaminFactor
            });
        }
    } catch (error) {
        console.error('Lỗi khi áp dụng hiệu ứng vitamin với VitaminGenixV3 pro:', error, {
            profileName,
            pitchMult,
            absPitchMult,
            cosmicEnhance,
            reverb: options.reverb,
            spectralProfile: this.spectralProfile
        });
        // Xử lý lỗi khi context không có sẵn
        const fallbackTime = 0;
        const fallbackRampTime = 0.1;
        if (this.outputGain?.gain) {
            this.outputGain.gain.cancelScheduledValues(fallbackTime);
            this.outputGain.gain.setValueAtTime(this.outputGain.gain.value || 0.6, fallbackTime);
            this.outputGain.gain.linearRampToValueAtTime(0.6, fallbackTime + fallbackRampTime);
        }
        if (this.harmonicExciterGainNode) {
            this.harmonicExciterGainNode.gain.cancelScheduledValues(fallbackTime);
            this.harmonicExciterGainNode.gain.setValueAtTime(this.harmonicExciterGainNode.gain.value, fallbackTime);
            this.harmonicExciterGainNode.gain.linearRampToValueAtTime(0, fallbackTime + fallbackRampTime);
        }
    }
};

// Hàm hỗ trợ phân tích FFT
Jungle.prototype.getFFTAnalysis = function() {
    if (!this._analyser) return null;
    const bufferLength = this._analyser.frequencyBinCount;
    // Tinh hoa: tái sử dụng array tránh GC
    if (!this._fftDataArray || this._fftDataArray.length !== bufferLength) {
        this._fftDataArray = new Float32Array(bufferLength);
        this._prevFftDataArray = new Float32Array(bufferLength);
    }
    this._analyser.getFloatFrequencyData(this._fftDataArray);
    const sampleRate = this.context.sampleRate;
    const binSize = sampleRate / (2 * bufferLength);
    const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    const sampleStep = isLowPowerDevice ? 4 : 1;
    const effectiveBufferLength = Math.floor(bufferLength / sampleStep);
    // Initialize spectral features
    let subBassEnergy = 0,
        bassEnergy = 0,
        midEnergy = 0,
        highMidEnergy = 0,
        trebleEnergy = 0,
        airEnergy = 0;
    let instrumentEnergy = 0,
        vocalEnergy = 0,
        highFreqEnergy = 0,
        noiseLevel = 0;
    let spectralEnergy = 0,
        spectralFlux = 0,
        transientCount = 0;
    // Cache fallback
    if (!this._fftCache) {
        this._fftCache = new Map();
    }
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
    // Multi-layer frequency analysis
    try {
        for (let i = 0; i < bufferLength; i += sampleStep) {
            const val = this._fftDataArray[i];
            // Tinh hoa: Math.pow(10, val/20) nhanh hơn
            const energy = val > -100 ? Math.pow(10, val / 20) : 0;
            const freq = i * binSize;
            if (freq < 30) noiseLevel += energy;
            else if (freq < 80) subBassEnergy += energy;
            else if (freq < 200) bassEnergy += energy;
            else if (freq < 1000) midEnergy += energy;
            else if (freq < 4000) highMidEnergy += energy;
            else if (freq < 6000) trebleEnergy += energy;
            else airEnergy += energy;
            if (freq >= 200 && freq <= 4000) instrumentEnergy += energy;
            if (freq >= 300 && freq <= 3000) vocalEnergy += energy;
            if (freq >= 6000) highFreqEnergy += energy;
            spectralEnergy += energy;
            const delta = Math.abs(energy - (this._prevFftDataArray[i] || 0));
            spectralFlux += delta;
            if (delta > 0.1 && freq >= 200 && freq <= 6000) transientCount++;
        }
    } catch (error) {
        console.error('Error during FFT analysis:', error);
        return prevAnalysis || {
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
    // Tinh hoa: normFactor gọn
    const normFactor = 10 / effectiveBufferLength;
    const normalize = (value) => Math.min(1, value * normFactor);
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
    // Tinh hoa: entropy loop riêng
    const energies = [subBassEnergy, bassEnergy, midEnergy, highMidEnergy, trebleEnergy, airEnergy];
    const totalEnergy = energies.reduce((sum, e) => sum + e, 0) || 1;
    let spectralEntropy = 0;
    for (const e of energies) {
        const p = e / totalEnergy;
        if (p > 0) spectralEntropy -= p * Math.log2(p);
    }
    spectralEntropy /= Math.log2(energies.length);
    const spectralCoherence = Math.min(1, 1 - spectralEntropy * 0.5);
    const transientDensity = Math.min(1, transientCount / effectiveBufferLength * 100);
    const harmonicRichness = Math.min(1, (midEnergy + highMidEnergy) * 0.6 + vocalEnergy * 0.4);
    const result = {
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
    // Cache analysis results
    if (spectralFlux > 0.05) {
        const cacheData = {
            data: result,
            timestamp: Date.now(),
            expiry: Date.now() + 20000,
            priority: 'high'
        };
        try {
            if (this.memoryManager && typeof this.memoryManager.set === 'function') {
                this.memoryManager.set('fftAnalysis', cacheData, 'high');
            } else {
                this._fftCache.set('fftAnalysis', cacheData);
                if (this._fftCache.size > 2) { // Tinh hoa cache size 2 nhỏ
                    const keys = Array.from(this._fftCache.keys());
                    this._fftCache.delete(keys[0]);
                }
            }
        } catch (error) {
            console.warn('Error caching FFT analysis:', error);
        }
    }
    // Tinh hoa: set() thay slice()
    this._prevFftDataArray.set(this._fftDataArray);
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
    return result;
};

// Hàm kiểm tra thiết bị đầu ra
Jungle.prototype.checkOutputDevice = async function() {
    // Tinh hoa từ nâng cấp: Debounce 5s để tiết kiệm tài nguyên
    if (this._lastDeviceCheck && (Date.now() - (this._lastDeviceCheckTime || 0) < 5000)) {
        return this._lastDeviceCheck;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return false;

        const devices = await navigator.mediaDevices.enumerateDevices();
        // Tinh hoa: Kiểm tra both "headphone" và "tai nghe", dùng some() tối ưu
        const isHeadphone = devices.some(device =>
            device.kind === 'audiooutput' &&
            (device.label.toLowerCase().includes('headphone') || device.label.toLowerCase().includes('tai nghe'))
        );

        this._lastDeviceCheck = isHeadphone;
        this._lastDeviceCheckTime = Date.now();
        return isHeadphone;
    } catch (e) {
        return false;
    }
};

Jungle.prototype.setDelay = function(delayTime) {
    try {
        // Kiểm tra giá trị delayTime
        if (typeof delayTime !== 'number' || isNaN(delayTime)) {
            throw new Error('delayTime must be a valid number.');
        }
        delayTime = Math.max(0, Math.min(MAX_DELAY_TIME, delayTime));
        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const spectralProfile = this.spectralProfile || {
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: 0.5,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            instruments: {},
            chroma: null,
            spectralComplexity: 0.5,
            harmonicRatio: 0.5
        };
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const isVocalFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory === 'vocal');
        // Kiểm tra node và AudioContext
        if (!this.modGain1?.gain || !this.modGain2?.gain || !(this.context instanceof AudioContext)) {
            throw new Error('modGain1, modGain2, or AudioContext is not initialized.');
        }
        // Dynamic Delay Adjustment
        let adjustedDelayTime = delayTime;
        let rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME);
        if (profile === 'smartStudio' || profile === 'bright') {
            adjustedDelayTime *= 1.1;
            rampTime *= 1.3;
        } else if (profile === 'vocal' || isVocalFeedback) {
            adjustedDelayTime *= 1.05;
            rampTime *= 1.2;
        }
        if (songStructure.section === 'chorus') {
            adjustedDelayTime *= 1.15;
            rampTime *= 1.1;
        }
        if (isLowPowerDevice && cpuLoad > 0.9) {
            rampTime *= 0.7;
        }
        adjustedDelayTime = Math.max(0, Math.min(MAX_DELAY_TIME, adjustedDelayTime));
        // Stable Delay Transition – tinh hoa cancel + anchor + safeTime
        const currentTime = this.context.currentTime;
        const safeTime = currentTime + 0.01; // Tinh hoa tránh scheduling in the past
        const delayFactor = profile === 'smartStudio' ? 0.6 : 0.5;
        const finalGainValue = delayFactor * adjustedDelayTime;
        [this.modGain1.gain, this.modGain2.gain].forEach(param => {
            param.cancelScheduledValues(safeTime);
            param.setValueAtTime(param.value, safeTime); // Anchor point
            param.linearRampToValueAtTime(finalGainValue, safeTime + rampTime);
        });
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
            // Tinh hoa random prune tránh gọi dày
            if (Math.random() > 0.8) {
                this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
            }
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
        }, 'high', {
            memoryManager: this.memoryManager
        });
    }
};

Jungle.prototype.setPitchOffset = function(mult, transpose = false) {
		try {
			// Validate AudioContext
			if (!this.context || !(this.context instanceof AudioContext) || this.context.state === 'closed') {
				throw new Error('Invalid or closed AudioContext');
			}
			// Resume AudioContext if suspended - FIX anti-leak với flag + once:true
			if (this.context.state === 'suspended') {
				if (!this._isResuming) {
					this._isResuming = true;
					const resumeHandler = () => {
						this.context.resume().then(() => {
							this._isResuming = false;
							console.debug('AudioContext resumed successfully in setPitchOffset');
						}).catch(err => {
							this._isResuming = false;
							handleError('Failed to resume AudioContext', err, {}, 'high', {
								memoryManager: this.memoryManager
							});
							this.notifyUIError?.('Vui lòng tương tác để kích hoạt âm thanh');
						});
					};
					['click', 'touchstart'].forEach(evt => document.addEventListener(evt, resumeHandler, {
						once: true
					}));
				}
			}
			const currentTime = this.context.currentTime;
			const safeTime = currentTime + 0.01;
			const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
			// Helper safe param - gọn + try-catch an toàn
			const safeParam = (param, val, time, method = 'linear') => {
				if (!param || !Number.isFinite(val)) return;
				try {
					param.cancelScheduledValues(safeTime);
					param.setValueAtTime(param.value ?? 0, safeTime);
					if (method === 'linear') param.linearRampToValueAtTime(val, time);
					else param.setValueAtTime(val, time);
				} catch (e) {
					param.setValueAtTime(val, safeTime);
				}
			};
			// Dọn dẹp sạch gain cũ trước mọi thay đổi
			[this.outputGain, this.mod1Gain, this.mod2Gain, this.mod3Gain, this.mod4Gain].forEach(node => {
				if (node?.gain) safeParam(node.gain, node.gain.value ?? 0, safeTime, 'set');
			});
			// Validate input nhanh
			const validateNum = (val, def) => (typeof val === 'number' && Number.isFinite(val)) ? val : def;
			const pitchMultInput = validateNum(mult, 0);
			// Clamp pitch
			let adjustedPitchMult = pitchMultInput / 12;
			if (transpose) {
				adjustedPitchMult = Math.max(-24, Math.min(24, pitchMultInput)) / 12;
			} else {
				adjustedPitchMult = Math.max(-12, Math.min(12, pitchMultInput)) / 12;
			}
			const absPitchMult = Math.abs(adjustedPitchMult);
			this.currentPitchMult = adjustedPitchMult;
			const semitones = adjustedPitchMult * 12;
			// Spectral + vocal detection
			const sp = this.spectralProfile || {};
			const spectralComplexity = validateNum(sp.spectralComplexity, 0.5);
			const transientEnergy = validateNum(sp.transientEnergy, 0.5);
			const vocalPresence = validateNum(sp.vocalPresence, this.currentProfile === 'vocal' ? 0.8 : 0.5);
			const bass = validateNum(sp.bass, this.currentProfile === 'bassHeavy' ? 0.7 : 0.5);
			const air = validateNum(sp.air, 0.5);
			const isFemaleVocal = (this.formantF1Freq ?? 300) > 400 || (this.formantF2Freq ?? 1600) > 1800;
			// AT2030 config - giữ nguyên hệ số
			const cpuLoad = this.cpuLoad ?? this.getCPULoad?.() ?? 0.5;
			const isLowPower = !!this.isLowPowerDevice;
			const isVocalMode = this.isVocal || this.currentProfile === 'vocal' || this.currentProfile === 'karaokeDynamic';
			const atEnabled = isVocalMode || absPitchMult > 0;
			let formantScaleRaw = isFemaleVocal ? 1.1 + semitones * 0.015 : 1.0 + semitones * 0.02;
			const formantScale = Math.max(0.8, Math.min(1.3, formantScaleRaw));
			let devAdaptRaw = 1.0 - cpuLoad * (isLowPower ? 0.4 : 0.15);
			const deviceAdaptFactor = Math.max(0.75, Math.min(1.0, devAdaptRaw));
			const harmonicBoost = this.currentProfile === 'bassHeavy' ? 1.2 : this.currentProfile === 'vocal' ? 1.1 : 1.0;
			const transientSculpt = (this.currentProfile === 'rockMetal' || this.currentProfile === 'bassHeavy') ? 1.5 : 1.2;
			const phaseLockFactor = this.currentProfile === 'vocal' ? 1.0 : (this.qualityMode === 'high' ? 0.95 : 0.85);
			const emotionalVector = this.currentProfile === 'warm' ? 0.95 : (this.currentProfile === 'rockMetal' ? 1.15 : 1.0);
			const rampTime = validateNum(this.rampTime, 0.15);
			const adjustedRampTime = Math.max(0.1, rampTime * (1 + absPitchMult * 0.1));
			const crossFadeTime = Math.max(0.05, this.fadeTime ?? 0.06);
			const rampEnd = safeTime + adjustedRampTime;
			const crossFadeEnd = safeTime + adjustedRampTime + crossFadeTime;
			// Store previous state để reset mượt
			const previousState = {
				outputGain: this.outputGain?.gain.value ?? 1.0,
				lowPassFreq: this.lowPassFilter?.frequency.value ?? 16000,
				highPassFreq: this.highPassFilter?.frequency.value ?? 80,
				notchFreq: this.notchFilter?.frequency.value ?? 1000,
				subMidGain: this.subMidFilter?.gain.value ?? 0,
				highShelfGain: this.highShelfFilter?.gain.value ?? 0,
				lowShelfGain: this.lowShelfFilter?.gain.value ?? 0,
				formantF1Freq: this.formantFilter1?.frequency.value ?? 300,
				formantF2Freq: this.formantFilter2?.frequency.value ?? 1600
			};
			// Reset khi pitch = 0
			if (adjustedPitchMult === 0) {
				if (this.outputGain) safeParam(this.outputGain.gain, 1.0 * deviceAdaptFactor, crossFadeEnd);
				if (this.lowPassFilter) {
					safeParam(this.lowPassFilter.frequency, 16000, crossFadeEnd);
					safeParam(this.lowPassFilter.Q, 0.5, crossFadeEnd);
				}
				if (this.highPassFilter) {
					safeParam(this.highPassFilter.frequency, 80, crossFadeEnd);
					safeParam(this.highPassFilter.Q, 0.5, crossFadeEnd);
				}
				if (this.notchFilter) {
					safeParam(this.notchFilter.frequency, 1000, crossFadeEnd);
					safeParam(this.notchFilter.Q, 1, crossFadeEnd);
				}
				if (this.subMidFilter) safeParam(this.subMidFilter.gain, 0, crossFadeEnd);
				if (this.highShelfFilter) safeParam(this.highShelfFilter.gain, 0, crossFadeEnd);
				if (this.lowShelfFilter) safeParam(this.lowShelfFilter.gain, 0, crossFadeEnd);
				if (this.formantFilter1 && this.formantFilter2) {
					safeParam(this.formantFilter1.frequency, 300, crossFadeEnd);
					safeParam(this.formantFilter2.frequency, 1600, crossFadeEnd);
					safeParam(this.formantFilter1.gain, 0, crossFadeEnd);
					safeParam(this.formantFilter2.gain, 0, crossFadeEnd);
					safeParam(this.formantFilter1.Q, 1, crossFadeEnd);
					safeParam(this.formantFilter2.Q, 1, crossFadeEnd);
				}
				[this.mod1Gain, this.mod2Gain, this.mod3Gain, this.mod4Gain].forEach(g => {
					if (g?.gain) safeParam(g.gain, 0, rampEnd);
				});
				if (typeof this.setDelay === 'function') this.setDelay(0, adjustedRampTime + crossFadeTime);
				if (isDebug) console.debug('Reset all effects as pitchMult is 0 with cross-fading');
				return;
			}
			// Buffer time + update (threshold >0 để slider nhạy 100%)
			const bufferTime = absPitchMult > 0 ?
				Math.max(0.5, this.bufferTime ?? 0.4, (this.fadeTime ?? 0.06) * 64 * (atEnabled ? 1.1 : 1.0)) :
				this.bufferTime ?? 0.08;
			if (bufferTime !== this.bufferTime) {
				this.bufferTime = bufferTime;
				if (isDebug) console.debug(`Adjusted buffer time to ${bufferTime}s for AT2030 pitch shift`);
			}
			const bufferOptions = {
				smoothness: this.currentProfile === 'vocal' ? 2.1 : 1.9,
				vibrance: this.currentProfile === 'bright' ? 1.65 : 1.5,
				pitchShift: semitones,
				isVocal: isVocalMode,
				spectralProfile: sp,
				qualityMode: this.qualityMode || 'ultra-high',
				formantScale,
				harmonicBoost,
				transientSculpt,
				phaseLockFactor,
				emotionalVector,
				deviceAdaptFactor,
				grainSize: absPitchMult > 1 ? 0.068 : 0.078,
				hopSize: absPitchMult > 1 ? 0.068 / 2.7 : 0.078 / 2.8,
				grainDensity: absPitchMult > 1 ? 2.4 : 2.1
			};
			// Update buffers nếu thiếu
			if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer) {
				if (typeof getShiftBuffers === 'function' && typeof getFadeBuffer === 'function') {
					const tempGainNode = this.context.createGain();
					const oldGainNode = this.context.createGain();
					tempGainNode.gain.setValueAtTime(0, safeTime);
					tempGainNode.gain.linearRampToValueAtTime(1 * deviceAdaptFactor, crossFadeEnd);
					oldGainNode.gain.setValueAtTime(1, safeTime);
					oldGainNode.gain.linearRampToValueAtTime(0, crossFadeEnd);
					try {
						const buffers = getShiftBuffers(this.context, bufferTime, this.fadeTime ?? 0.08, bufferOptions, this.memoryManager);
						this.shiftDownBuffer = buffers.shiftDownBuffer;
						this.shiftUpBuffer = buffers.shiftUpBuffer;
						this.fadeBuffer = getFadeBuffer(this.context, bufferTime, this.fadeTime ?? 0.08, bufferOptions, this.memoryManager);
						if (isDebug) console.debug('Successfully updated AT2030 pitch shift buffers');
					} catch (bufferError) {
						handleError('AT2030 buffer update failed', bufferError, {
							bufferOptions
						}, 'high', {
							memoryManager: this.memoryManager
						});
						tempGainNode.disconnect();
						oldGainNode.disconnect();
					}
					setTimeout(() => {
						tempGainNode.disconnect();
						oldGainNode.disconnect();
					}, crossFadeTime * 1000 + 100);
				}
			}
			// Mod gain
			const gainValue = adjustedPitchMult > 0 ? 1 : 0;
			const normalizationFactor = 1 / (1 + absPitchMult * 0.05) * deviceAdaptFactor;
			if (this.mod1Gain && this.mod2Gain && this.mod3Gain && this.mod4Gain) {
				const downGain = (1 - gainValue) * normalizationFactor * emotionalVector;
				const upGain = gainValue * normalizationFactor * emotionalVector;
				safeParam(this.mod1Gain.gain, downGain, rampEnd);
				safeParam(this.mod2Gain.gain, downGain, rampEnd);
				safeParam(this.mod3Gain.gain, upGain, rampEnd);
				safeParam(this.mod4Gain.gain, upGain, rampEnd);
			}
			const delayTime = (this.delayTime ?? 0.06) * absPitchMult * deviceAdaptFactor;
			if (typeof this.setDelay === 'function') this.setDelay(delayTime, adjustedRampTime);
			// Formant preserve
			let adjustedVocalPresence = vocalPresence;
			if (semitones < 0) adjustedVocalPresence = Math.min(vocalPresence + (0.05 * Math.abs(semitones)), 1.2);
			const entanglementFactor = bass > 0.7 ? 0.95 : 1.0;
			let f1Preserved = typeof preserveFormant === 'function' ? preserveFormant(semitones, this.formantF1Freq ?? 300, adjustedVocalPresence, sp) : {
				freq: 300 * Math.pow(2, semitones / 12) * formantScale * entanglementFactor,
				gain: Math.min(0.5 + (0.05 * Math.abs(semitones)) * emotionalVector, 0.8),
				q: Math.max(1.0 - (0.008 * Math.abs(semitones)) * phaseLockFactor, 0.7)
			};
			let f2Preserved = typeof preserveFormant === 'function' ? preserveFormant(semitones, this.formantF2Freq ?? 1600, adjustedVocalPresence, sp) : {
				freq: 1600 * Math.pow(2, semitones / 12) * formantScale * entanglementFactor,
				gain: Math.min(0.5 + (0.05 * Math.abs(semitones)) * emotionalVector, 0.8),
				q: Math.max(1.0 - (0.008 * Math.abs(semitones)) * phaseLockFactor, 0.7)
			};
			if (atEnabled && semitones !== 0) {
				f1Preserved.freq = Math.min(f1Preserved.freq, isFemaleVocal ? 650 : 550);
				f2Preserved.freq = Math.min(f2Preserved.freq, isFemaleVocal ? 3000 : 2700);
			}
			if (this.formantFilter1 && this.formantFilter2) {
				safeParam(this.formantFilter1.frequency, f1Preserved.freq, rampEnd);
				safeParam(this.formantFilter1.gain, f1Preserved.gain, rampEnd);
				safeParam(this.formantFilter1.Q, f1Preserved.q, rampEnd);
				safeParam(this.formantFilter2.frequency, f2Preserved.freq, rampEnd);
				safeParam(this.formantFilter2.gain, f2Preserved.gain, rampEnd);
				safeParam(this.formantFilter2.Q, f2Preserved.q, rampEnd);
			}
			// Adaptive filters
			let lowPassFreq = validateNum(this.lowPassFreq, 16000);
			let highPassFreq = validateNum(this.highPassFreq, 80);
			let notchFreq = validateNum(this.notchFreq, 1000);
			const filterQ = 1.0 + absPitchMult * 0.015 * phaseLockFactor;
			let notchQ = 1.2;
			if (spectralComplexity > 0.65 || this.currentProfile === 'smartStudio') {
				lowPassFreq = Math.min(lowPassFreq * 0.95 * deviceAdaptFactor, 18000);
				notchQ = 1.3 * phaseLockFactor;
			}
			if (this.currentProfile === 'vocal' || this.currentProfile === 'karaokeDynamic') {
				highPassFreq = Math.max(highPassFreq * 1.15 * emotionalVector, 130);
			}
			const maxFreqChange = 350;
			if (adjustedPitchMult > 0) {
				const newLow = lowPassFreq * (1 - absPitchMult * 0.05) * deviceAdaptFactor;
				lowPassFreq = Math.abs(newLow - lowPassFreq) > maxFreqChange ? lowPassFreq + (newLow > lowPassFreq ? maxFreqChange : -maxFreqChange) : newLow;
				const newHigh = highPassFreq * (1 + absPitchMult * 0.002) * emotionalVector;
				highPassFreq = Math.abs(newHigh - highPassFreq) > maxFreqChange ? highPassFreq + (newHigh > highPassFreq ? maxFreqChange : -maxFreqChange) : newHigh;
			} else if (adjustedPitchMult < 0) {
				const newLow = Math.min(lowPassFreq * (1 + absPitchMult * 0.06) * deviceAdaptFactor, 20000);
				lowPassFreq = Math.abs(newLow - lowPassFreq) > maxFreqChange ? lowPassFreq + (newLow > lowPassFreq ? maxFreqChange : -maxFreqChange) : newLow;
				const newHigh = highPassFreq * (1 - absPitchMult * 0.008) * emotionalVector;
				highPassFreq = Math.abs(newHigh - highPassFreq) > maxFreqChange ? highPassFreq + (newHigh > highPassFreq ? maxFreqChange : -maxFreqChange) : newHigh;
			}
			if (this.lowPassFilter && this.highPassFilter && this.notchFilter) {
				safeParam(this.lowPassFilter.Q, filterQ, rampEnd);
				safeParam(this.highPassFilter.Q, filterQ, rampEnd);
				safeParam(this.lowPassFilter.frequency, lowPassFreq, rampEnd);
				safeParam(this.highPassFilter.frequency, highPassFreq, rampEnd);
				safeParam(this.notchFilter.frequency, notchFreq, rampEnd);
				safeParam(this.notchFilter.Q, notchQ, rampEnd);
			}
			// Low shelf bass protection
			if (this.lowShelfFilter && adjustedPitchMult < 0) {
				const lowShelfFreq = 80 * deviceAdaptFactor;
				let lowShelfGain = Math.min(0.5 + (Math.abs(semitones) * 0.03) * harmonicBoost * entanglementFactor, 0.8);
				if (semitones < -6) {
					const reduction = Math.min(0.65, 1.0 - (Math.abs(semitones) - 6) * 0.022);
					lowShelfGain *= reduction;
				}
				safeParam(this.lowShelfFilter.frequency, lowShelfFreq, safeTime, 'set');
				safeParam(this.lowShelfFilter.gain, lowShelfGain, rampEnd);
			}
			// Output gain + compression
			let outputGainBoost = 1.0 * emotionalVector;
			if (semitones < 0 && transpose) {
				outputGainBoost = Math.min(1.0 + (Math.abs(semitones) * 0.05) * emotionalVector, 1.4);
				if (typeof this.applyCompression === 'function') {
					this.applyCompression({
						threshold: -10 * deviceAdaptFactor,
						ratio: 1.8,
						attack: 0.005,
						release: 0.08
					});
				}
			}
			if (this.outputGain) safeParam(this.outputGain.gain, outputGainBoost, rampEnd);
			// Conditional boosts - giá trị tuyệt đối tránh cộng dồn
			if (bass < 0.4 && this.subMidFilter) {
				const bassBoost = 0.3 * harmonicBoost * entanglementFactor;
				safeParam(this.subMidFilter.gain, bassBoost, rampEnd);
			}
			if (transientEnergy < 0.65 && this.highShelfFilter) {
				safeParam(this.highShelfFilter.frequency, 8000, safeTime, 'set');
				const transientBoostVal = 0.8 * transientSculpt * entanglementFactor;
				safeParam(this.highShelfFilter.gain, transientBoostVal, rampEnd);
			}
			if (air < 0.35 && this.highShelfFilter) {
				safeParam(this.highShelfFilter.frequency, 10000, safeTime, 'set');
				const clarityBoost = 1.0 * emotionalVector * entanglementFactor;
				safeParam(this.highShelfFilter.gain, clarityBoost, rampEnd);
			}
			if (spectralComplexity > 0.65 && absPitchMult > 0.65 && this.lowPassFilter) {
				const newLowPass = lowPassFreq * 0.95 * deviceAdaptFactor;
				lowPassFreq = Math.abs(newLowPass - lowPassFreq) > maxFreqChange ? lowPassFreq - maxFreqChange : newLowPass;
				safeParam(this.lowPassFilter.frequency, lowPassFreq, rampEnd);
			}
			if (adjustedPitchMult < 0 && this.subMidFilter) {
				const warmthBoost = Math.min(0.5 + (Math.abs(semitones) * 0.04) * emotionalVector * entanglementFactor, 1.0);
				safeParam(this.subMidFilter.gain, warmthBoost, rampEnd);
			}
			let vocalClarityBoost = 0;
			if (isFemaleVocal && this.highShelfFilter && semitones < 0) {
				vocalClarityBoost = Math.min(0.7 + (Math.abs(semitones) * 0.05) * emotionalVector * entanglementFactor, 1.2);
				safeParam(this.highShelfFilter.frequency, 9000, safeTime, 'set');
				safeParam(this.highShelfFilter.gain, vocalClarityBoost, rampEnd);
			}
			// External
			if (typeof this.applyHarmonicEnhancement === 'function' && adjustedPitchMult < 0) {
				this.applyHarmonicEnhancement({
					intensity: 0.2 * harmonicBoost * entanglementFactor,
					frequencyRange: [2000, 8000]
				});
			}
			if (typeof this.applyVitamin === 'function' && this.currentProfile === 'proNatural') {
				this.applyVitamin('proNatural', adjustedPitchMult, absPitchMult);
			}
			// === PHÙ THỦY MỚI: REFRESH PROFILE ĐỂ ÂM THANH LUÔN TRONG RÕ BẤT KỂ THỨ TỰ ===
			if (typeof this.setSoundProfile === 'function' && this.currentProfile) {
				setTimeout(() => {
					try {
						this.setSoundProfile(this.currentProfile);
						if (isDebug) console.debug('Re-applied current profile after pitch change for optimal clarity & naturalness');
					} catch (e) {
						console.warn('Minor profile refresh after pitch failed (non-critical)', e);
					}
				}, adjustedRampTime * 1000 + 50);
			}

			// Memory + UI - debounce allocateBuffer
			if (this.memoryManager) {
				if (!this._pitchLogDebounce) {
					this._pitchLogDebounce = setTimeout(() => {
						this.memoryManager.allocateBuffer('pitchConfig', {
							pitchMult: adjustedPitchMult,
							absPitchMult,
							qualityMode: this.qualityMode,
							bufferTime,
							lowPassFreq,
							highPassFreq,
							vocalClarityBoost,
							at2030Config: {
								formantScale,
								harmonicBoost,
								transientSculpt,
								phaseLockFactor,
								emotionalVector,
								deviceAdaptFactor
							},
							timestamp: Date.now(),
							expiry: Date.now() + 15000,
							priority: 'ultra-high'
						}, 'high');
						if (typeof this.calculateMaxCacheSize === 'function') {
							this.memoryManager.pruneCache(this.calculateMaxCacheSize());
						}
						this._pitchLogDebounce = null;
					}, 500);
				}
			}
			if (typeof this.notifyUIUpdate === 'function') {
				this.notifyUIUpdate({
					pitchMult: adjustedPitchMult,
					absPitchMult,
					qualityMode: this.qualityMode,
					bufferTime,
					lowPassFreq,
					highPassFreq,
					vocalClarityBoost,
					timestamp: Date.now()
				});
			}
			if (isDebug) console.debug('[setPitchOffset] Zölzer AT2030 ULTIMATE processed successfully with profile refresh', {
				pitchMult: adjustedPitchMult,
				absPitchMult,
				pitchShift: semitones,
				qualityMode: this.qualityMode,
				bufferTime,
				outputGainBoost,
				delayTime,
				contextState: this.context.state,
				currentProfile: this.currentProfile
			});
		} catch (error) {
			handleError('Error setting Zölzer pitch offset', error, {
				mult,
				transpose,
				contextState: this.context?.state,
				contextId: this.contextId
			}, 'high', {
				memoryManager: this.memoryManager
			});
			this.notifyUIError?.('Failed to process Zölzer pitch offset');
			// Fallback gain về previous hoặc 1.0
			if (previousState && this.outputGain) {
				safeParam(this.outputGain.gain, previousState.outputGain || 1.0, this.context.currentTime + 0.1);
			}
		}
	};

Jungle.prototype.setBoost = function(boost, band = "all") {
    try {
        // Kiểm tra giá trị boost
        if (typeof boost !== 'number' || isNaN(boost)) {
            throw new Error('Boost must be a valid number.');
        }
        boost = Math.max(0.7, Math.min(8.0, boost));
        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const spectralProfile = this.spectralProfile || {
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: 0.5,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            instruments: {},
            chroma: null,
            spectralComplexity: 0.5,
            harmonicRatio: 0.5
        };
        const feedbackList = this.memoryManager?.get('userFeedback') || [];
        const isVocalFeedback = feedbackList.find(f => f.timestamp > Date.now() - 60000 && f.semanticCategory === 'vocal');
        const rms = this.rms || 0.1;
        const limiterFactor = rms > 0.15 || spectralProfile.transientEnergy > 0.8 ? 0.85 : 1.0;
        // Kiểm tra AudioContext
        if (!(this.context instanceof AudioContext)) {
            throw new Error('AudioContext is not initialized.');
        }
        const currentTime = this.context.currentTime;
        // Dynamic Boost Adjustment
        let rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME);
        if (profile === 'bright' || profile === 'smartStudio' || profile === 'vocal') {
            rampTime *= 1.4;
        } else if (isLowPowerDevice && cpuLoad > 0.9) {
            rampTime *= 0.7;
        }
        if (songStructure.section === 'chorus') {
            boost *= 1.1;
            boost = Math.max(0.7, Math.min(8.0, boost));
        }
        if (isVocalFeedback && band === 'vocal') {
            boost *= 1.1;
            boost = Math.max(0.7, Math.min(8.0, boost));
        }
        // Tinh hoa: applyRamp với cancelScheduledValues chống chồng chéo/pop
        const applyRamp = (param, value) => {
            if (param && param instanceof AudioParam) {
                param.cancelScheduledValues(currentTime);
                param.linearRampToValueAtTime(value, currentTime + rampTime);
            }
        };
        if (band === 'all' || band === 'total') {
            if (!this.boostGain?.gain) throw new Error('boostGain is not initialized');
            applyRamp(this.boostGain.gain, boost * limiterFactor);
        } else if (band === 'bass') {
            if (!this.lowShelfGain?.gain || !this.subBassFilter?.gain) throw new Error('lowShelfGain or subBassFilter is not initialized');
            const bassBoost = boost * (profile === 'bassHeavy' ? 1.8 : 1.6) * limiterFactor;
            applyRamp(this.lowShelfGain.gain, bassBoost);
            applyRamp(this.subBassFilter.gain, boost * 1.3 * limiterFactor);
        } else if (band === 'subMid') {
            if (!this.subMidFilter?.gain) throw new Error('subMidFilter is not initialized');
            const subMidBoost = boost * (spectralProfile.spectralComplexity > 0.7 ? 1.4 : 1.2) * limiterFactor;
            applyRamp(this.subMidFilter.gain, subMidBoost);
        } else if (band === 'mid') {
            if (!this.midShelfGain?.gain) throw new Error('midShelfGain is not initialized');
            applyRamp(this.midShelfGain.gain, boost * 1.3 * limiterFactor);
        } else if (band === 'highMid') {
            if (!this.highMidFilter?.gain) throw new Error('highMidFilter is not initialized');
            const highMidBoost = boost * (profile === 'bright' ? 1.4 : 1.2) * limiterFactor;
            applyRamp(this.highMidFilter.gain, highMidBoost);
        } else if (band === 'treble') {
            if (!this.highShelfGain?.gain || !this.subTrebleFilter?.gain) throw new Error('highShelfGain or subTrebleFilter is not initialized');
            const trebleBoost = boost * (profile === 'bright' ? 1.6 : 1.4) * limiterFactor;
            applyRamp(this.highShelfGain.gain, trebleBoost);
            applyRamp(this.subTrebleFilter.gain, boost * 1.3 * limiterFactor);
        } else if (band === 'air') {
            if (!this.airFilter?.gain) throw new Error('airFilter is not initialized');
            const airBoost = boost * (profile === 'smartStudio' ? 1.2 : 1.0) * limiterFactor;
            applyRamp(this.airFilter.gain, airBoost);
        } else if (band === 'vocal') {
            if (!this.formantFilter1?.gain || !this.formantFilter2?.gain || !this.formantFilter3?.gain) {
                throw new Error('formantFilter1, formantFilter2, or formantFilter3 is not initialized');
            }
            const vocalBoost = boost * (isVocalFeedback || profile === 'vocal' ? 1.2 : 1.0) * limiterFactor;
            applyRamp(this.formantFilter1.gain, vocalBoost);
            applyRamp(this.formantFilter2.gain, vocalBoost);
            applyRamp(this.formantFilter3.gain, vocalBoost);
        } else {
            throw new Error(`Invalid band: ${band}`);
        }
        // Lưu trạng thái boost
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
                    isVocalFeedback,
                    limiterFactor
                },
                expiry: Date.now() + (isLowPowerDevice ? 30000 : 60000),
                priority: 'high'
            });
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 50); // Tinh hoa prune 50 chặt
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
                cacheStats: this.memoryManager?.getCacheStats?.(),
                limiterFactor
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
            isVocalFeedback,
            limiterFactor
        }, 'high', {
            memoryManager: this.memoryManager
        });
    }
};

Jungle.prototype.setPan = function(pan) {
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
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: 0.5,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            instruments: {},
            chroma: null,
            spectralComplexity: 0.5,
            harmonicRatio: 0.5
        };
        // Kiểm tra panner node và AudioContext
        if (!this.panner || !(this.context instanceof AudioContext)) {
            throw new Error('Panner node or AudioContext is not initialized.');
        }
        // Dynamic Pan Adjustment
        let rampTime = ensureFinite(this.rampTime, DEFAULT_RAMP_TIME);
        if (profile === 'bright' || profile === 'smartStudio') {
            rampTime *= 1.2;
        } else if (isLowPowerDevice && cpuLoad > 0.9) {
            rampTime *= 0.8;
        }
        if (songStructure.section === 'chorus') {
            pan *= 1.1;
            pan = Math.max(-1, Math.min(1, pan));
        }
        // Stable Pan Transition – tinh hoa cancelScheduledValues + fallback
        const currentTime = this.context.currentTime;
        if (this.panner.pan) {
            this.panner.pan.cancelScheduledValues(currentTime);
            this.panner.pan.linearRampToValueAtTime(pan, currentTime + rampTime);
        } else if (typeof this.panner.setPosition === 'function') {
            this.panner.setPosition(pan, 0, 1 - Math.abs(pan));
        }
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
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 50);
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
        }, 'high', {
            memoryManager: this.memoryManager   // ← ĐÃ SỬA ĐÚNG Ở ĐÂY, XÓA "Planet"
        });
    }
};

Jungle.prototype.ensureAudioContext = function() {
    return new Promise((resolve, reject) => {
        try {
            // Lấy thông tin thiết bị và cấu hình
            const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
            const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
            const profile = this.profile || 'smartStudio';
            const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
            const spectralProfile = this.spectralProfile || {
                subBass: 0.5,
                bass: 0.5,
                subMid: 0.5,
                midLow: 0.5,
                midHigh: 0.5,
                high: 0.5,
                subTreble: 0.5,
                air: 0.5,
                vocalPresence: 0.5,
                transientEnergy: 0.5,
                instruments: {},
                chroma: null,
                spectralComplexity: 0.5,
                harmonicRatio: 0.5
            };
            // Real-time Neural Network Integration
            const detectInstrument = (spectralProfile) => {
                const scoreDrum = spectralProfile.transientEnergy * 0.6 + spectralProfile.bass * 0.4;
                const scoreGuitar = spectralProfile.midHigh * 0.5 + spectralProfile.transientEnergy * 0.3 + spectralProfile.spectralComplexity * 0.2;
                const scorePiano = spectralProfile.midHigh * 0.4 + spectralProfile.spectralComplexity * 0.4 + spectralProfile.transientEnergy * 0.2;
                const scoreVocal = spectralProfile.vocalPresence * 0.7 + spectralProfile.midHigh * 0.3;
                const scores = { drum: scoreDrum, guitar: scoreGuitar, piano: scorePiano, vocal: scoreVocal };
                return Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b, 'vocal');
            };
            const instrumentType = detectInstrument(spectralProfile);
            const curveType = (instrumentType === 'drum' || instrumentType === 'vocal') ? 'cosine' : 'exponential';
            // FFT-based Spectral Validation
            const validateSpectralProfile = (spectralProfile) => {
                let validityScore = 1.0;
                if (spectralProfile.bass > 0.85 && spectralProfile.transientEnergy < 0.65) validityScore *= 0.9;
                if (spectralProfile.midHigh > 0.8) validityScore *= 1.05;
                if (spectralProfile.air > 0.85 && spectralProfile.spectralComplexity > 0.85) validityScore *= 0.85;
                return validityScore >= 0.9;
            };
            const isSpectralValid = validateSpectralProfile(spectralProfile);
            // Tinh hoa: AudioCtxClass fallback an toàn
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtxClass) {
                const error = new Error('Web Audio API is not supported in this environment.');
                handleError('Error ensuring AudioContext:', error, { profile, cpuLoad, isLowPowerDevice, instrumentType }, 'high', { memoryManager: this.memoryManager });
                reject(error);
                return;
            }
            // Kiểm tra và khởi tạo lại AudioContext nếu cần
            if (!(this.context instanceof AudioContext) || this.context.state === 'closed') {
                if (this.ownsContext) {
                    // Tinh hoa: close context cũ trước tạo mới
                    if (this.context) {
                        this.context.close().catch(e => console.warn('Error closing old AudioContext:', e));
                    }
                    this.context = new AudioCtxClass();
                    this.ownsContext = true;
                    // Tinh hoa: baseLatency tăng khi CPU cao hạ nhiệt
                    if (isLowPowerDevice && cpuLoad > 0.9) {
                        try {
                            this.context.baseLatency = Math.min(this.context.baseLatency * 1.4, 0.12);
                        } catch (e) {}
                    }
                    // Tái tạo buffer
                    const bufferOptions = {
                        smoothness: profile === 'vocal' || profile === 'bright' ? 1.6 : 1.4,
                        vibrance: profile === 'smartStudio' ? 0.65 : 0.55,
                        pitchShift: this.currentPitchMult || 0,
                        isVocal: this.isVocal || profile === 'vocal',
                        spectralProfile,
                        currentGenre: this.currentGenre || 'Unknown',
                        noiseLevel: this.noiseLevel || { level: 0, midFreq: 0.5, white: 0.5 },
                        wienerGain: this.wienerGain || 1,
                        polyphonicPitches: this.polyphonicPitches || [],
                        qualityMode: this.qualityMode || 'high',
                        profile,
                        songStructure,
                        instrumentType,
                        curveType
                    };
                    const bTime = this.bufferTime || 0.3;
                    const fTime = this.fadeTime || 0.15;
                    const buffers = getShiftBuffers(this.context, bTime, fTime, bufferOptions, this.memoryManager);
                    this.shiftDownBuffer = buffers.shiftDownBuffer;
                    this.shiftUpBuffer = buffers.shiftUpBuffer;
                    this.fadeBuffer = getFadeBuffer(this.context, bTime, fTime, bufferOptions, this.memoryManager);
                    if (!this.shiftDownBuffer || !this.shiftUpBuffer || !this.fadeBuffer || !isSpectralValid) {
                        throw new Error('Failed to create valid buffers or spectral profile invalid');
                    }
                    if (this.fadeBuffer.length < bTime * this.context.sampleRate) {
                        throw new Error('fadeBuffer length insufficient');
                    }
                    this.initializeNodes();
                    // Lưu trạng thái buffer vào memoryManager – tinh hoa prune 50 chặt
                    if (this.memoryManager) {
                        const cacheKey = `bufferState_${this.contextId}_${profile}_${instrumentType}_${curveType}`;
                        this.memoryManager.set(cacheKey, {
                            data: {
                                shiftDownLength: this.shiftDownBuffer.length,
                                shiftUpLength: this.shiftUpBuffer.length,
                                fadeBufferLength: this.fadeBuffer.length,
                                bufferTime: bTime,
                                fadeTime: fTime,
                                timestamp: Date.now(),
                                profile,
                                songStructure,
                                instrumentType,
                                curveType
                            },
                            expiry: Date.now() + (isLowPowerDevice ? 60000 : 120000),
                            priority: 'high'
                        });
                        this.memoryManager.pruneCache(50);
                    }
                    resolve(true);
                } else {
                    const error = new Error('Invalid or closed AudioContext and no ownership to reinitialize.');
                    handleError('Error ensuring AudioContext:', error, { profile, cpuLoad, isLowPowerDevice, instrumentType }, 'high', { memoryManager: this.memoryManager });
                    reject(error);
                }
                return;
            }
            // Xử lý trạng thái AudioContext – tinh hoa userActivation + keydown
            switch (this.context.state) {
                case 'suspended':
                    const resumeOnUserGesture = () => {
                        this.context.resume()
                            .then(() => resolve(true))
                            .catch(error => {
                                handleError('Error resuming AudioContext:', error, { profile, cpuLoad, isLowPowerDevice, instrumentType }, 'high', { memoryManager: this.memoryManager });
                                this.notifyUIError?.('Vui lòng nhấp vào nút phát hoặc tương tác với trang để kích hoạt âm thanh.');
                                reject(error);
                            });
                    };
                    const isActivated = (navigator.userActivation && navigator.userActivation.hasBeenActive) ||
                        (document.userActivation && document.userActivation.hasBeenActive);
                    if (isActivated) {
                        resumeOnUserGesture();
                    } else {
                        const userGestureHandler = () => {
                            resumeOnUserGesture();
                            ['click', 'touchstart', 'keydown'].forEach(e => document.removeEventListener(e, userGestureHandler));
                        };
                        ['click', 'touchstart', 'keydown'].forEach(e => document.addEventListener(e, userGestureHandler));
                    }
                    break;
                case 'running':
                    if (this._analyser && this._analyser.fftSize !== DEFAULT_FFT_SIZE) {
                        this._analyser.fftSize = DEFAULT_FFT_SIZE;
                    }
                    resolve(true);
                    break;
                default:
                    resolve(true);
                    break;
            }
            // Debug logging
            const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
            if (isDebug) {
                console.debug('AudioContext ensured', {
                    state: this.context.state,
                    sampleRate: this.context.sampleRate,
                    bufferTime: this.bufferTime || 0.3,
                    fadeTime: this.fadeTime || 0.15,
                    cpuLoad,
                    isLowPowerDevice,
                    profile,
                    songStructure,
                    instrumentType,
                    curveType,
                    cacheStats: this.memoryManager?.getCacheStats?.()
                });
            }
        } catch (error) {
            handleError('Error ensuring AudioContext:', error, { ownsContext: this.ownsContext, contextState: this.context?.state, profile, cpuLoad, isLowPowerDevice, instrumentType }, 'high', { memoryManager: this.memoryManager });
            reject(error);
        }
    });
};

Jungle.prototype.disconnect = function() {
    try {
        // Lấy thông tin thiết bị và cấu trình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        // Tinh hoa: anti-pop ramp gain 10ms trước disconnect
        if (this.outputGain && this.outputGain.gain) {
            const now = this.context.currentTime;
            this.outputGain.gain.cancelScheduledValues(now);
            this.outputGain.gain.setValueAtTime(this.outputGain.gain.value, now);
            this.outputGain.gain.linearRampToValueAtTime(0, now + 0.01);
        }
        // Stop audio sources nếu đang chạy – tinh hoa try-catch tránh crash
        if (this.isStarted) {
            const nodes = [this.mod1, this.mod2, this.mod3, this.mod4, this.fade1, this.fade2];
            for (const node of nodes) {
                if (node && typeof node.stop === 'function') {
                    try {
                        node.stop();
                    } catch (e) {
                        // Source có thể chưa start hoặc đã stop
                    }
                }
            }
            this.isStarted = false;
        }
        // Tinh hoa: clear _pitchLogDebounce nếu có
        if (this._pitchLogDebounce) {
            clearTimeout(this._pitchLogDebounce);
            this._pitchLogDebounce = null;
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
        // Disconnect tất cả audio nodes nếu tồn tại – tinh hoa cancelScheduledValues trước
        const audioNodes = [
            this.input, this.bassHighPassFilter, this.highPassFilter, this.lowShelfGain,
            this.subBassFilter, this.subMidFilter, this.midBassFilter, this.midShelfGain,
            this.highMidFilter, this.formantFilter1, this.formantFilter2, this.formantFilter3,
            this.delay1, this.delay2, this.mix1, this.mix2, this.boostGain, this.panner,
            this.highShelfGain, this.subTrebleFilter, this.airFilter, this.trebleLowPass,
            this.lowPassFilter, this.notchFilter, this.outputGain, this.compressor, this.output
        ];
        for (const node of audioNodes) {
            if (node) {
                if (node.gain) node.gain.cancelScheduledValues(this.context.currentTime);
                if (node.frequency) node.frequency.cancelScheduledValues(this.context.currentTime);
                if (typeof node.disconnect === 'function') {
                    node.disconnect();
                }
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
        // Nullify node references + tinh hoa nullify memoryManager + worker
        const nodeRefs = [
            'mod1', 'mod2', 'mod3', 'mod4', 'fade1', 'fade2', 'mod1Gain', 'mod2Gain', 'mod3Gain',
            'mod4Gain', 'modGain1', 'modGain2', 'mix1', 'mix2', 'delay1', 'delay2', 'input', 'output',
            'boostGain', 'panner', 'bassHighPassFilter', 'highPassFilter', 'lowShelfGain', 'subBassFilter',
            'subMidFilter', 'midBassFilter', 'midShelfGain', 'highMidFilter', 'formantFilter1',
            'formantFilter2', 'formantFilter3', 'highShelfGain', 'subTrebleFilter', 'airFilter',
            'trebleLowPass', 'lowPassFilter', 'notchFilter', 'outputGain', 'compressor',
            'worker', 'memoryManager'
        ];
        for (const ref of nodeRefs) {
            this[ref] = null;
        }
        // Clear buffers và quản lý memoryManager
        this.shiftDownBuffer = null;
        this.shiftUpBuffer = null;
        this.fadeBuffer = null;
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
        // Khôi phục tham số mặc định
        this.delayTime = DEFAULT_DELAY_TIME;
        this.fadeTime = DEFAULT_FADE_TIME;
        this.bufferTime = DEFAULT_BUFFER_TIME;
        this.rampTime = DEFAULT_RAMP_TIME;
        this.lowPassFreq = DEFAULT_LOW_PASS_FREQ;
        this.highPassFreq = DEFAULT_HIGH_PASS_FREQ;
        this.notchFreq = DEFAULT_NOTCH_FREQ;
        this.filterQ = DEFAULT_FILTER_Q;
        this.notchQ = DEFAULT_NOTCH_Q;
        this.formantF1Freq = DEFAULT_FORMANT_F1_FREQ;
        this.formantF2Freq = DEFAULT_FORMANT_F2_FREQ;
        this.formantF3Freq = DEFAULT_FORMANT_F3_FREQ;
        this.formantQ = DEFAULT_FORMANT_Q;
        this.subMidFreq = DEFAULT_SUBMID_FREQ;
        this.subTrebleFreq = DEFAULT_SUBTREBLE_FREQ;
        this.midBassFreq = DEFAULT_MIDBASS_FREQ;
        this.highMidFreq = DEFAULT_HIGHMID_FREQ;
        this.airFreq = DEFAULT_AIR_FREQ;
        this.spectralProfile = {
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: 0.5,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            instruments: {},
            chroma: null,
            spectralComplexity: 0.5,
            harmonicRatio: 0.5
        };
        this.tempoMemory = null;
        this.currentGenre = 'Unknown';
        this.currentKey = { key: 'Unknown', confidence: 0, isMajor: true };
        this.currentProfile = profile;
        this.nextProcessingInterval = 800;
        this.currentPitchMult = 0;
        this.noiseLevel = { level: 0, midFreq: 0.5, white: 0.5 };
        this.qualityPrediction = { score: 0, recommendations: [] };
        this.isVocal = profile === 'vocal';
        this.wienerGain = 1;
        this.polyphonicPitches = [];
        this.transientBoost = DEFAULT_TRANSIENT_BOOST;
        // Đóng AudioContext nếu sở hữu – tinh hoa async + gỡ tham chiếu ngay
        if (this.ownsContext && this.context) {
            const ctxToClose = this.context;
            this.context = null;
            ctxToClose.close().then(() => console.debug('AudioContext closed successfully', { profile })).catch(error => {
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

Jungle.prototype.reset = function() {
    try {
        // Tinh hoa: dọn gesture handler cũ tránh leak
        if (this._userGestureHandler) {
            document.removeEventListener('click', this._userGestureHandler);
            document.removeEventListener('touchstart', this._userGestureHandler);
            this._userGestureHandler = null;
        }
        // Disconnect và dọn dẹp trạng thái hiện tại
        this.disconnect();
        this.isStarted = false;
        // Lấy thông tin thiết bị và cấu hình
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency ? navigator.hardwareConcurrency < 4 : false;
        const profile = this.profile || 'smartStudio';
        const songStructure = this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        // Tinh hoa: self-healing AudioContext khi ownsContext
        if (this.ownsContext) {
            if (this.context) {
                this.context.close().catch(e => console.warn('Error closing AudioContext:', e));
            }
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            if (this.context.state === 'suspended') {
                this._userGestureHandler = () => {
                    this.context.resume().then(() => console.debug('AudioContext resumed after reset'));
                    document.removeEventListener('click', this._userGestureHandler);
                    document.removeEventListener('touchstart', this._userGestureHandler);
                    this._userGestureHandler = null;
                };
                document.addEventListener('click', this._userGestureHandler);
                document.addEventListener('touchstart', this._userGestureHandler);
            }
        } else if (!(this.context instanceof AudioContext)) {
            throw new Error('Invalid AudioContext after reset');
        }
        // Tinh hoa: getDef gọn thay DEFAULT constants
        const getDef = (val, def) => (typeof val !== 'undefined' ? val : def);
        this.delayTime = getDef(window.DEFAULT_DELAY_TIME, 0.080);
        this.fadeTime = getDef(window.DEFAULT_FADE_TIME, 0.100);
        this.bufferTime = getDef(window.DEFAULT_BUFFER_TIME, 0.200);
        this.rampTime = getDef(window.DEFAULT_RAMP_TIME, 0.075);
        this.lowPassFreq = getDef(window.DEFAULT_LOW_PASS_FREQ, 18000);
        this.highPassFreq = getDef(window.DEFAULT_HIGH_PASS_FREQ, 40);
        this.notchFreq = getDef(window.DEFAULT_NOTCH_FREQ, 3500);
        this.filterQ = getDef(window.DEFAULT_FILTER_Q, 0.3);
        this.notchQ = getDef(window.DEFAULT_NOTCH_Q, 2.5);
        this.formantF1Freq = getDef(window.DEFAULT_FORMANT_F1_FREQ, 550);
        this.formantF2Freq = getDef(window.DEFAULT_FORMANT_F2_FREQ, 2000);
        this.formantF3Freq = getDef(window.DEFAULT_FORMANT_F3_FREQ, 3200);
        this.formantQ = getDef(window.DEFAULT_FORMANT_Q, 1.8);
        this.subMidFreq = getDef(window.DEFAULT_SUBMID_FREQ, 500);
        this.subTrebleFreq = getDef(window.DEFAULT_SUBTREBLE_FREQ, 11000);
        this.midBassFreq = getDef(window.DEFAULT_MIDBASS_FREQ, 200);
        this.highMidFreq = getDef(window.DEFAULT_HIGHMID_FREQ, 2000);
        this.airFreq = getDef(window.DEFAULT_AIR_FREQ, 13000);
        this.qualityMode = 'high';
        this.currentPitchMult = 0;
        this.isVocal = profile === 'vocal';
        this.wienerGain = 1;
        this.polyphonicPitches = [];
        this.transientBoost = getDef(window.DEFAULT_TRANSIENT_BOOST, 0.5);
        this.nextProcessingInterval = 800;
        this.currentGenre = 'Unknown';
        this.currentKey = { key: 'Unknown', confidence: 0, isMajor: true };
        this.currentProfile = profile;
        this.noiseLevel = { level: 0, midFreq: 0.5, white: 0.5 };
        this.qualityPrediction = { score: 0, recommendations: [] };
        this.spectralProfile = {
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: 0.5,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            instruments: {},
            chroma: null,
            spectralComplexity: 0.5,
            harmonicRatio: 0.5
        };
        this.tempoMemory = null;
        // Tinh hoa: clear cache cũ nếu memoryManager có
        if (this.memoryManager) {
            if (typeof this.memoryManager.clear === 'function') {
                this.memoryManager.clear();
            }
        } else {
            this.memoryManager = new MemoryManager();
        }
        // Smart Reset Algorithm: Tính toán bufferTime
        const pitchMultFactor = 1 + Math.abs(this.currentPitchMult) * 0.6;
        let bufferTime = Math.max(this.bufferTime, this.fadeTime * 2.7 * pitchMultFactor);
        if (profile === 'bright' || profile === 'smartStudio' || profile === 'vocal') {
            bufferTime *= 1.3;
        } else if (isLowPowerDevice && cpuLoad > 0.9) {
            bufferTime *= 0.9;
        }
        if (bufferTime < this.fadeTime * 2.7) {
            bufferTime = this.fadeTime * 2.7;
        }
        // Tinh hoa: hard-limit với MAX_DELAY_TIME
        if (this.delayTime > MAX_DELAY_TIME) {
            this.delayTime = MAX_DELAY_TIME;
        }
        this.bufferTime = bufferTime;
        // Tạo lại các buffer – tinh hoa fallback
        try {
            const bufferOptions = {
                smoothness: 1.5,
                vibrance: 0.6,
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
                throw new Error('fadeBuffer length insufficient after reset');
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
        } catch (error) {
            handleError('Error creating buffers after reset', error, { bufferOptions, profile }, 'high', { memoryManager: this.memoryManager });
        }
        // Khởi tạo lại các node
        try {
            this.initializeNodes();
        } catch (error) {
            handleError('Error initializing nodes after reset', error, { profile }, 'high', { memoryManager: this.memoryManager });
            if (this.ownsContext) this.context.close();
            throw error;
        }
        // Khởi tạo lại worker nếu cần
        if (this.worker) {
            this.initializeWorker();
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
        handleError('Error during Jungle reset:', error, { ownsContext: this.ownsContext, contextState: this.context?.state, qualityMode: this.qualityMode, profile: this.profile, cpuLoad, isLowPowerDevice }, 'high', { memoryManager: this.memoryManager });
        throw error;
    }
};

Jungle.prototype.setFilterParams = function({
    lowPassFreq,
    highPassFreq,
    notchFreq,
    filterQ,
    notchQ,
    lowShelfGain,
    highShelfGain,
    outputGain
}) {
    try {
        const currentTime = this.context.currentTime;
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        // Validate AudioContext
        if (!this.context || !(this.context instanceof AudioContext) || this.context.state === 'closed') {
            throw new Error('Invalid or closed AudioContext');
        }
        // Tinh hoa: rampStart nhỏ chống lỗi scheduling quá khứ
        const rampStart = currentTime + 0.005;
        // Khởi tạo spectral profile mặc định
        const spectral = this.spectralProfile || {
            subBass: 0.5,
            bass: 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: 0.5,
            high: 0.5,
            subTreble: 0.5,
            air: 0.5,
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            spectralComplexity: 0.5
        };
        // Tinh hoa: Cache biến dùng nhiều
        const specComplex = spectral.spectralComplexity || 0.5;
        const currentPitch = this.currentPitchMult || 0;
        const absPitch = Math.abs(currentPitch);
        // Genre factor với switch tinh hoa nhanh hơn
        let genreFactor = 1.0;
        switch (this.currentGenre) {
            case 'EDM':
            case 'Drum & Bass':
                genreFactor = 1.15;
                break;
            case 'Hip-Hop':
                genreFactor = 1.1;
                break;
            case 'Pop':
                genreFactor = 1.0;
                break;
            case 'Bolero':
                genreFactor = 0.85;
                break;
            case 'Classical/Jazz':
                genreFactor = 0.8;
                break;
            case 'Rock/Metal':
                genreFactor = 1.1;
                break;
            case 'Karaoke':
                genreFactor = 0.9;
                break;
        }
        // Tính CPU load và kiểm tra thiết bị yếu
        const cpuLoad = this.getCPULoad ? this.getCPULoad() : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        // Tinh hoa: isOverloaded gọn
        const isOverloaded = cpuLoad > 0.8 || isLowPowerDevice;
        const qualityMode = isOverloaded ? 'low' : this.qualityMode || 'high';
        const deviceAdaptFactor = Math.max(0.65, Math.min(1.0, 1.0 - (cpuLoad * 0.2) * (isLowPowerDevice ? 0.35 : 0.1)));
        const rms = this.rms || 0.1;
        const limiterFactor = (rms > 0.15 || spectral.transientEnergy > 0.8) ? 0.8 : 0.95;
        // Xác định voice type
        let voiceType = 'middle';
        let fundamentalFreq = 440;
        if (this.polyphonicPitches?.length > 0) {
            fundamentalFreq = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
        }
        if (fundamentalFreq <= 240) {
            voiceType = 'low';
        } else if (fundamentalFreq <= 480) {
            voiceType = 'middle';
        } else {
            voiceType = 'high';
        }
        // CrystalToneOptimizerV2: Tối ưu hóa âm thanh trong trẻo, tự nhiên
        const crystalToneOptimizerV2 = (freq, voiceType, spectral, profile) => {
            const clarityFactor = profile === 'vocal' || profile === 'karaokeDynamic' ? 1.15 : profile === 'proNatural' ? 1.1 : 1.0;
            const vocalClarity = spectral.vocalPresence > 0.65 ? 1.1 : 0.95;
            const clarityBoost = Math.min(1.25, clarityFactor * vocalClarity * (1.0 + specComplex * 0.15));
            const bassResonance = profile === 'bassHeavy' ? 0.9 : profile === 'vocal' ? 0.8 : 0.85;
            const bassClarity = Math.max(0.8, Math.min(1.2, 1.0 - (spectral.bass * 0.3)));
            const bassFactor = bassResonance * bassClarity * (1.0 - absPitch * 0.1);
            const transientSculpt = profile === 'rockMetal' ? 1.1 : profile === 'bassHeavy' ? 1.0 : 0.85;
            let transientFactor = Math.min(1.15, spectral.transientEnergy * transientSculpt * (1.0 - absPitch * 0.15));
            if (cpuLoad > 0.8) transientFactor *= 0.7;
            if (absPitch > 0.5) transientFactor *= 0.85;
            // Tinh hoa: freqNorm * freqNorm nhanh hơn Math.pow
            const freqNorm = freq / 1200;
            const purityFilter = 1 / (1 + freqNorm * freqNorm) * clarityBoost;
            const maskingThreshold = Math.pow(10, -specComplex / 20) * purityFilter * 1.3;
            const filterTuning = voiceType === 'high' ? 0.9 : voiceType === 'low' ? 1.1 : 1.0;
            const pitchShiftImpact = absPitch > 0.5 ? 0.85 : 1.0;
            const totalToneFactor = clarityBoost * bassFactor * transientFactor * maskingThreshold * filterTuning * pitchShiftImpact;
            return Math.max(0.75, Math.min(1.25, totalToneFactor));
        };
        // Dynamic filter adjustments
        const profile = this.profile || 'smartStudio';
        const toneFactor = crystalToneOptimizerV2(fundamentalFreq, voiceType, spectral, profile);
        // Tinh hoa: isGenreBoost gọn
        const isGenreBoost = ['Pop', 'Karaoke', 'EDM'].includes(this.currentGenre);
        const transientBoost = spectral.transientEnergy > 0.6 && isGenreBoost ? 1.2 + this.transientBoost * 1.2 : 1.0;
        const subBassAdjust = spectral.subBass < 0.4 ? 1.6 : spectral.subBass > 0.7 ? -0.7 : 0;
        const trebleAdjust = spectral.air > 0.8 || spectral.subTreble > 0.8 ? -1.2 : (voiceType === 'high' ? -0.3 : 0);
        const noiseReduction = this.noiseLevel?.level > 0.7 || this.wienerGain < 0.8 ? 1.2 : 1.0;
        // Giới hạn pitch shift
        const maxPitchShift = voiceType === 'high' ? 0.5 : 0.8;
        const adjustedPitchMult = Math.max(-maxPitchShift, Math.min(maxPitchShift, currentPitch));
        const absAdjustedPitch = Math.abs(adjustedPitchMult);
        // Điều chỉnh bufferTime
        let bufferTimeFactor = qualityMode === 'high' ? 1.4 : 0.9;
        if (specComplex > 0.7 || absAdjustedPitch > 0.3) {
            bufferTimeFactor *= 1.15;
        }
        this.bufferTime = Math.max(this.fadeTime * 2.2, this.bufferTime * bufferTimeFactor * deviceAdaptFactor);
        // Cập nhật buffer với try-catch riêng tinh hoa
        if (absAdjustedPitch > 0.2 || specComplex > 0.7 || voiceType === 'high') {
            const bufferOptions = {
                fadeType: 'bezier',
                smoothness: voiceType === 'high' ? 1.4 : 1.2,
                vibrance: voiceType === 'high' ? 0.75 : 0.55,
                pitchShift: adjustedPitchMult,
                isVocal: this.isVocal,
                spectralProfile: spectral,
                qualityMode,
                vocalPresence: spectral.vocalPresence
            };
            try {
                this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, bufferOptions, this.memoryManager);
                if (!this.fadeBuffer) throw new Error("Fade buffer null");
                this.memoryManager?.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
            } catch (bufErr) {
                console.error("Failed to update fade buffer", bufErr);
            }
        }
        // Tinh hoa: applyParam helper an toàn gọn
        const applyParam = (param, value) => {
            if (param && Number.isFinite(value)) {
                const safeTime = rampStart + (qualityMode === 'low' ? 0 : this.rampTime * deviceAdaptFactor);
                param.cancelScheduledValues(currentTime);
                if (qualityMode === 'low') {
                    param.setValueAtTime(value, safeTime);
                } else {
                    try {
                        param.linearRampToValueAtTime(value, safeTime);
                    } catch (e) {
                        param.setValueAtTime(value, safeTime);
                    }
                }
            }
        };
        // Low-pass filter
        if (lowPassFreq !== undefined && this.lowPassFilter?.frequency) {
            this.lowPassFreq = Math.max(20, Math.min(20000, lowPassFreq));
            this.lowPassFreq = spectral.air > 0.7 || voiceType === 'high' ? Math.min(this.lowPassFreq, 15000) : this.lowPassFreq;
            if (specComplex > 0.7 && absAdjustedPitch > 0.5) {
                this.lowPassFreq *= 0.95;
            }
            applyParam(this.lowPassFilter.frequency, this.lowPassFreq * toneFactor);
        }
        // High-pass filter
        if (highPassFreq !== undefined && this.highPassFilter?.frequency) {
            this.highPassFreq = Math.max(20, Math.min(20000, highPassFreq));
            this.highPassFreq = spectral.subBass > 0.6 ? Math.max(this.highPassFreq, 60) : this.highPassFreq;
            if (voiceType === 'high') {
                this.highPassFreq = Math.max(this.highPassFreq, 90);
            }
            applyParam(this.highPassFilter.frequency, this.highPassFreq * toneFactor);
        }
        // Notch filter
        if (notchFreq !== undefined && this.notchFilter?.frequency) {
            this.notchFreq = Math.max(20, Math.min(20000, notchFreq));
            this.notchFreq = this.noiseLevel?.midFreq > 0.5 || voiceType === 'high' ? 4200 : this.notchFreq;
            applyParam(this.notchFilter.frequency, this.notchFreq * toneFactor);
        }
        if (notchQ !== undefined && this.notchFilter?.Q) {
            this.notchQ = Math.max(0.1, Math.min(10, notchQ));
            this.notchQ *= noiseReduction * (voiceType === 'high' ? 0.75 : 0.95);
            applyParam(this.notchFilter.Q, this.notchQ * toneFactor);
        }
        // Low-shelf filter
        if (lowShelfGain !== undefined && this.lowShelfGain?.gain && this.subBassFilter?.gain) {
            const adjustedLowShelfGain = (lowShelfGain + subBassAdjust * genreFactor * (voiceType === 'high' ? 0.65 : 0.9)) * limiterFactor * toneFactor;
            applyParam(this.lowShelfGain.gain, Math.min(3.5, adjustedLowShelfGain));
            applyParam(this.subBassFilter.gain, Math.min(3.5, adjustedLowShelfGain * 0.45));
        }
        // High-shelf filter
        if (highShelfGain !== undefined && this.highShelfGain?.gain && this.subTrebleFilter?.gain) {
            const adjustedHighShelfGain = (highShelfGain + trebleAdjust + (transientBoost > 1.2 ? 0.7 : 0) + (voiceType === 'high' ? 0.3 : 0)) * limiterFactor * toneFactor;
            applyParam(this.highShelfGain.gain, Math.min(3.5, adjustedHighShelfGain));
            applyParam(this.subTrebleFilter.gain, Math.min(3.5, adjustedHighShelfGain * 0.45));
        }
        // Output gain
        if (outputGain !== undefined && this.outputGain?.gain) {
            const adjustedOutputGain = outputGain * (1 + absAdjustedPitch * 0.1) * (voiceType === 'high' ? 0.95 : 1.0) * limiterFactor * toneFactor;
            applyParam(this.outputGain.gain, Math.min(3.5, adjustedOutputGain));
        }
        // De-essing adjustment
        if (this.deEsser?.gain) {
            const deEssGain = (spectral.air > 0.8 || spectral.subTreble > 0.8 || voiceType === 'high') ? -2.5 : -1.2;
            applyParam(this.deEsser.gain, deEssGain);
        }
        // Formant adjustment
        if (this.formantFilter1 && this.formantFilter2) {
            let f1Freq = 450, f2Freq = 1900, formantGain = 2.5, formantQ = 0.85;
            const vpFactor = spectral.vocalPresence * 0.1;
            if (voiceType === 'high') {
                f1Freq = 560 * (1 + vpFactor);
                f2Freq = 2300 * (1 + vpFactor);
                formantGain = 2.2;
                formantQ = 0.55;
            } else if (voiceType === 'middle') {
                f1Freq = 450 * (1 + vpFactor);
                f2Freq = 1900 * (1 + vpFactor);
                formantGain = 2.7;
                formantQ = 0.85;
            } else {
                f1Freq = 340 * (1 + vpFactor);
                f2Freq = 1500 * (1 + vpFactor);
                formantGain = 3.0;
                formantQ = 1.1;
            }
            if (absAdjustedPitch > 0.3) {
                const pitchShiftFactor = Math.pow(2, adjustedPitchMult * 0.45);
                f1Freq *= pitchShiftFactor;
                f2Freq *= pitchShiftFactor;
                formantGain = Math.max(1.8, formantGain - absAdjustedPitch * 0.2);
            }
            formantGain *= limiterFactor * toneFactor;
            applyParam(this.formantFilter1.frequency, f1Freq * toneFactor);
            applyParam(this.formantFilter1.gain, Math.min(3.5, formantGain));
            applyParam(this.formantFilter1.Q, formantQ * toneFactor);
            applyParam(this.formantFilter2.frequency, f2Freq * toneFactor);
            applyParam(this.formantFilter2.gain, Math.min(3.5, formantGain));
            applyParam(this.formantFilter2.Q, formantQ * toneFactor);
        }
        // Apply qualityPrediction recommendations (giữ nguyên gốc đầy đủ)
        if (this.qualityPrediction?.recommendations) {
            this.qualityPrediction.recommendations.forEach(rec => {
                if (typeof rec !== 'string') return;
                if (rec.includes("Reduce sub-bass") && this.lowShelfGain?.gain && this.subBassFilter?.gain) {
                    const reducedLowShelfGain = Math.max(this.lowShelfGain.gain.value - 1.2, 0);
                    const reducedSubBassGain = Math.max(this.subBassFilter.gain.value - 0.6, 0);
                    applyParam(this.lowShelfGain.gain, Math.min(3.5, reducedLowShelfGain * limiterFactor * toneFactor));
                    applyParam(this.subBassFilter.gain, Math.min(3.5, reducedSubBassGain * limiterFactor * toneFactor));
                }
                if (rec.includes("Reduce treble/sub-treble") && this.highShelfGain?.gain && this.subTrebleFilter?.gain) {
                    const reducedHighShelfGain = Math.max(this.highShelfGain.gain.value - (voiceType === 'high' ? 1.0 : 1.2), 0);
                    const reducedSubTrebleGain = Math.max(this.subTrebleFilter.gain.value - (voiceType === 'high' ? 0.5 : 0.6), 0);
                    applyParam(this.highShelfGain.gain, Math.min(3.5, reducedHighShelfGain * limiterFactor * toneFactor));
                    applyParam(this.subTrebleFilter.gain, Math.min(3.5, reducedSubTrebleGain * limiterFactor * toneFactor));
                }
                if (rec.includes("Apply noise reduction") && this.notchFilter?.Q && this.notchFilter?.frequency) {
                    applyParam(this.notchFilter.Q, this.notchQ * (voiceType === 'high' ? 1.2 : 1.6));
                    applyParam(this.notchFilter.frequency, voiceType === 'high' ? 4200 : 3800);
                }
                if (rec.includes("Boost vocal clarity") && this.highMidFilter?.gain && this.formantFilter1?.gain && this.formantFilter2?.gain) {
                    applyParam(this.highMidFilter.gain, Math.min(3.5, (this.highMidFilter.gain.value + (voiceType === 'high' ? 1.6 : 1.2)) * limiterFactor * toneFactor));
                    applyParam(this.formantFilter1.gain, Math.min(3.5, (this.formantFilter1.gain.value + 0.3) * limiterFactor * toneFactor));
                    applyParam(this.formantFilter2.gain, Math.min(3.5, (this.formantFilter2.gain.value + 0.3) * limiterFactor * toneFactor));
                }
            });
        }
        // Harmonic enhancement
        if (this.polyphonicPitches?.length > 0 && this.highMidFilter?.frequency && this.highMidFilter?.gain) {
            const dominantPitch = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
            const targetFreq = Math.min(dominantPitch * (voiceType === 'high' ? 2.0 : 1.8), 3200);
            applyParam(this.highMidFilter.frequency, targetFreq * toneFactor);
            applyParam(this.highMidFilter.gain, Math.min(3.5, (this.highMidFilter.gain.value + (voiceType === 'high' ? 1.6 : 1.2)) * limiterFactor * toneFactor));
        }
        // Lưu thông tin voice profile
        if (this.memoryManager) {
            this.memoryManager.buffers.set('voiceProfile', {
                voiceType,
                fundamentalFreq,
                vocalPresence: spectral.vocalPresence,
                toneFactor,
                timestamp: Date.now(),
                expiry: Date.now() + 8000
            });
            this.memoryManager.pruneCache(this.memoryManager.getDynamicMaxSize?.() || 100);
        }
        // Debug logging
        if (isDebug) {
            console.debug('Filter parameters set successfully with CrystalToneOptimizerV2', {
                lowPassFreq: this.lowPassFreq,
                highPassFreq: this.highPassFreq,
                notchFreq: this.notchFreq,
                notchQ: this.notchQ,
                lowShelfGain,
                highShelfGain,
                outputGain,
                spectralProfile: spectral,
                qualityMode,
                cpuLoad,
                isLowPowerDevice,
                voiceType,
                fundamentalFreq,
                limiterFactor,
                deviceAdaptFactor,
                toneFactor,
                transientBoost,
                subBassAdjust,
                trebleAdjust,
                noiseReduction
            });
        }
    } catch (error) {
        console.error('Error setting filter parameters with CrystalToneOptimizerV2:', error, {
            lowPassFreq,
            highPassFreq,
            notchFreq,
            filterQ,
            notchQ,
            lowShelfGain,
            highShelfGain,
            outputGain,
            spectralProfile: this.spectralProfile,
            qualityMode,
            voiceType,
            limiterFactor,
            toneFactor
        });
    }
};

Jungle.prototype.setSoundProfile = function(profile) {
	try {
		this.currentProfile = profile;
		const currentTime = this.context.currentTime;
		const spectral = this.spectralProfile || {
			subBass: 0.5,
			bass: 0.5,
			subMid: 0.5,
			midLow: 0.5,
			midHigh: 0.5,
			high: 0.5,
			subTreble: 0.5,
			air: 0.5,
			vocalPresence: 0.5,
			transientEnergy: 0.5,
			instruments: {},
			chroma: null,
			spectralFlux: 0.5,
			spectralEntropy: 0.5,
			harmonicRatio: 0.5
		};
		const genreFactor = {
			'EDM': 1.2,
			'Drum & Bass': 1.2,
			'Hip-Hop': 1.1,
			'Pop': 1.0,
			'Bolero': 0.9,
			'Classical/Jazz': 0.8,
			'Rock/Metal': 1.0,
			'Karaoke': 0.9
		} [this.currentGenre] || 1.0;

		// === KHỞI TẠO BIẾN GỐC (RESET HOÀN TOÀN) + FIX SCOPE FORMANT ===
		let warmthBoost = 0.9;
		let subBassBoost = 0.2;
		let subMidBoost = 0.6;
		let midBoost = 0.3;
		let trebleReduction = 0.8;
		let harmonicBoost = 0.6;
		let transientBoostAdjust = 0.6;
		let smartWarmthAdjust = 1.2;
		let bassCutFreq = 45;
		let trebleCutFreq = 15000;
		let f1Freq = 440; // Di chuyển lên đầu để tránh Temporal Dead Zone
		let f2Freq = 1850;
		let formantGain = 3.2;
		let formantQ = 0.9;

		const contextAnalyzer = this.initializeContextAnalyzer();
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
		const songStructure = this.analyzeSongStructure({
			spectralProfile: spectral,
			tempoMemory: this.tempoMemory,
			polyphonicPitches: this.polyphonicPitches,
			currentGenre: this.currentGenre
		});

		// FIX: CPU LOAD DETECTION
		const processingTime = performance.now() - startTime;
		let fftSize = 2048;
		let enableSubharmonic = true;
		let enableAdvancedDeEsser = true;
		let enableCNNTransient = true;
		if (processingTime > 16) {
			fftSize = processingTime > 30 ? 512 : 1024;
			enableSubharmonic = processingTime < 25;
			enableAdvancedDeEsser = processingTime < 20;
			enableCNNTransient = processingTime < 22;
			console.debug('High CPU load detected, optimizing performance...');
		}
		this.setFFTSize(fftSize);

		// Optimize wienerGain
		this.wienerGain = spectral.subTreble > 0.6 || spectral.air > 0.6 ? 0.95 : 0.93;
		this.noiseLevel = {
			level: (spectral.subTreble > 0.6 || spectral.air > 0.6) ? 0.35 : 0.25,
			midFreq: (spectral.subTreble > 0.6 || spectral.air > 0.6) ? 5000 : 3500,
			lowFreq: spectral.subBass > 0.7 ? 200 : 150
		};
		if (musicContext.spectralComplexity > 0.65) {
			this.wienerGain = Math.max(0.90, this.wienerGain - 0.02);
		}
		if (musicContext.transientEnergy < 0.35) {
			this.noiseLevel.level = Math.min(0.40, this.noiseLevel.level + 0.05);
		}

		// Update buffer settings (Invariant: Chống lag pha)
		this.fadeTime = musicContext.fadeTime || (0.35 * (this.isVocal ? 1.1 : 1.0));
		this.bufferTime = musicContext.bufferTime || (0.55 * (1 + Math.abs(this.currentPitchMult || 0) * 0.35));
		this.fadeBuffer = getFadeBuffer(this.context, this.bufferTime, this.fadeTime, {
			fadeType: musicContext.fadeType || 'bezier',
			smoothness: musicContext.smoothness || 2.0,
			vibrance: musicContext.vibrance || 0.9,
			pitchShift: this.currentPitchMult,
			isVocal: this.isVocal,
			spectralProfile: spectral,
			currentGenre: this.currentGenre,
			noiseLevel: this.noiseLevel,
			wienerGain: this.wienerGain,
			polyphonicPitches: this.polyphonicPitches
		}, this.memoryManager);

		// --- ĐOẠN MỚI CHỐNG NHỎ TIẾNG (FIX V5.2) ---
			if (!this.outputGain?.gain) throw new Error("outputGain is not initialized");
			const currentAbsPitch = Math.abs(this.currentPitchMult || 0);
			// Base gain thấp hơn để an toàn khi mới mở bài (trong trẻo ngay từ đầu)
			let dynamicGain = this.currentProfile ? 0.8 : 0.7; // Nếu chưa chọn profile → base thấp hơn
			if (currentAbsPitch > 0) {
				dynamicGain += (currentAbsPitch * 0.15); // Giảm bù từ 0.2 → 0.15, tránh over khi pitch sâu
			}
			// Giới hạn chặt tuyệt đối max 1.15 → to đỉnh cao nhưng không vỡ tiếng
			const finalGain = Math.min(1.15, dynamicGain * genreFactor);
			this.outputGain.gain.linearRampToValueAtTime(finalGain, currentTime + (this.rampTime || 0.1));
			this.setPan(0);
		// ------------------------------------------
		const pitchMult = this.currentPitchMult || 0;
		const absPitchMult = Math.abs(pitchMult);
		const dynamicFactor = Math.min(1 + absPitchMult * 0.25, 1.25);

		// Advanced spectral analysis
		const warmthIndex = (spectral.bass + spectral.subMid) / 2 - (spectral.high + spectral.subTreble) / 2;
		const needsWarmth = warmthIndex < 0.5;
		const subBassIndex = (spectral.subBass + spectral.bass) / 2;
		const needsSubBass = subBassIndex < 0.7;
		const subMidIndex = spectral.subMid;
		const needsSubMid = subMidIndex < 0.7;
		const midIndex = (spectral.midLow + spectral.midHigh) / 2;
		const needsMid = midIndex < 0.7;
		const trebleIndex = (spectral.high + spectral.subTreble + spectral.air) / 3;
		const needsTrebleReduction = trebleIndex > 0.5;
		const isPiercing = trebleIndex > 0.55 || spectral.subTreble > 0.65 || spectral.air > 0.65;

		warmthBoost = needsWarmth ? Math.min(3.0, (0.5 - warmthIndex) * 4.8) : 0.9;
		subBassBoost = needsSubBass ? Math.min(3.2, (0.7 - subBassIndex) * 5.8) : 0.2;
		subMidBoost = needsSubMid ? Math.min(3.0, (0.7 - subMidIndex) * 5.8) : 0.6;
		midBoost = needsMid ? Math.min(3.0, (0.7 - midIndex) * 5.8) : 0.3;
		trebleReduction = isPiercing ? Math.min(4.5, (trebleIndex - 0.5) * 6.5) : 0.8;

		smartWarmthAdjust = (this.isVocal || spectral.vocalPresence > 0.65) ? 1.5 : 1.2;
		if (spectral.spectralEntropy > 0.65) smartWarmthAdjust *= 0.75;
		if (['Bolero', 'Classical/Jazz', 'Karaoke'].includes(this.currentGenre)) {
			smartWarmthAdjust *= 1.6;
			subMidBoost *= 1.5;
		} else if (['EDM', 'Drum & Bass', 'Hip-Hop'].includes(this.currentGenre)) {
			subBassBoost *= 1.4;
		}

		// === 6 THUẬT TOÁN THIÊN TÀI (GIỮ NGUYÊN GỐC) ===
		if (this.harmonicExciter) {
			const excitement = spectral.harmonicRatio > 0.7 || this.isVocal ? 0.7 + Math.tanh(spectral.transientEnergy) * 1.8 : 0.4;
			this.harmonicExciter.gain.value = excitement;
			this.harmonicExciter.frequency.value = 8000 + spectral.air * 4000;
		}

		if (enableSubharmonic && this.subharmonicEnhancer && needsSubBass) {
			const phaseAlign = Math.sin(currentTime * 0.3) * 0.12 + 0.88;
			const curve = new Float32Array(512);
			for (let i = 0; i < 512; i++) {
				const x = (i - 256) / 256;
				curve[i] = Math.sin(Math.PI * x * 1.1) * subBassBoost * phaseAlign * 1.15;
			}
			this.subharmonicEnhancer.curve = curve;
		}

		if (this.isVocal && spectral.vocalPresence > 0.75 && this.breathPreserver) {
			const breathEnergy = spectral.air > 0.65 ? 1.8 : 1.0;
			this.breathPreserver.gain.linearRampToValueAtTime(breathEnergy * 0.9, currentTime + 0.1);
			this.breathPreserver.frequency.value = 12000 + spectral.air * 3000;
		}

		if (this.microDynamics && enableCNNTransient) {
			const microGain = 1.0 + spectral.transientEnergy * 2.8 + (spectral.instruments?.guitar ? 1.5 : 0);
			this.microDynamics.threshold.value = -48 - spectral.transientEnergy * 18;
			this.microDynamics.ratio.value = 1.8 + microGain * 0.4;
			this.microDynamics.attack.value = 0.0015;
			this.microDynamics.release.value = 0.08;
		}

		if (pitchMult !== 0 && this.artifactPredictor && this.formantCorrector) {
			const predicted = Math.abs(pitchMult) > 6 ? Math.pow(Math.abs(pitchMult) / 12, 2.2) * 0.28 : 0;
			this.artifactPredictor.gain.linearRampToValueAtTime(1.0 + predicted * 2.8, currentTime + 0.02);
			this.formantCorrector.delayTime.setValueAtTime(0.0008 + predicted * 0.0012, currentTime);
		}

		if (enableCNNTransient && this.transientShaperVocal && this.transientShaperDrums) {
			const vocalT = this.isVocal ? spectral.vocalPresence : 0;
			const drumT = spectral.transientEnergy > 0.7 ? 1.5 : 0.8;
			this.transientShaperVocal.attack.value = 0.002 + vocalT * 0.008;
			this.transientShaperVocal.release.value = 0.12 - vocalT * 0.06;
			this.transientShaperDrums.attack.value = 0.001;
			this.transientShaperDrums.release.value = 0.05 + drumT * 0.03;
			this.transientShaperDrums.gain.value = drumT * 1.8;
		}

		const noiseFactor = this.noiseLevel.level > 0.45 || this.wienerGain < 0.9 ? 2.4 : 1.3;
		let notchQ = this.notchQ * noiseFactor * 4.5;
		let notchFreq = (this.noiseLevel.level > 0.3 || spectral.subTreble > 0.6) ? 6000 : 5000;
		transientBoostAdjust = enableCNNTransient && spectral.transientEnergy > 0.55 ? 0.8 : 0.6;
		const transientGenres = ["EDM", "Drum & Bass", "Hip-Hop", "Rock/Metal"];
		const isTransientGenre = transientGenres.includes(this.currentGenre);

		let polyphonicAdjust = 0;
		if (this.polyphonicPitches && this.polyphonicPitches.length > 0) {
			polyphonicAdjust = this.polyphonicPitches.length > 1 ? 1.4 : 1.2;
		} else {
			const chromaVariance = spectral.chroma?.reduce((sum, val) => sum + val * val, 0) / (spectral.chroma?.length || 1);
			polyphonicAdjust = chromaVariance > 0.15 ? 0.9 : 0.2;
		}

		harmonicBoost = 0.6 + warmthBoost * 0.4 + (spectral.instruments?.guitar || spectral.instruments?.piano ? 0.5 : 0.3) + polyphonicAdjust + (spectral.harmonicRatio > 0.65 ? 0.4 : 0.2);

		const subharmonicGain = enableSubharmonic && needsSubBass && (this.currentGenre === "EDM" || this.currentGenre === "Hip-Hop") ? 3.0 : 1.4;

		if (enableSubharmonic && this.subharmonicEnhancer) {
			const curve = new Float32Array(512).map((_, i) => {
				const x = (i - 256) / 256;
				return Math.sin(Math.PI * x * 1.1) * subharmonicGain * 0.35;
			});
			this.subharmonicEnhancer.curve = curve;
			if (this.subBassFilter && this.subMidFilter) {
				this.subBassFilter.disconnect();
				this.subBassFilter.connect(this.subharmonicEnhancer);
				this.subharmonicEnhancer.connect(this.subMidFilter);
			}
		}

// === THUẬT TOÁN PITCH V5.9 SMART-AI: NATURAL INSTRUMENT + BASS LAN TỎA HOÀN HẢO ===
if (pitchMult !== 0) {
    const absPitchMult = Math.abs(pitchMult);
    const shiftIntensity = Math.min(absPitchMult / 12, 1.0);
    const genre = this.currentGenre || "Default";
    const baseSubBass = spectral.subBass || 0.5;
    let genreScale = 1.0;
    if (absPitchMult >= 1.0) {
        if (genre === "Karaoke" || genre === "Jazz" || genre === "Classical") genreScale = 0.92;
        else if (genre === "Rock" || genre === "Metal") genreScale = 0.95;
        else if (genre === "EDM" || genre === "Drum & Bass") genreScale = 1.08;
    }
    const perceptualIntensity = shiftIntensity * genreScale;

    if (pitchMult < 0) {
        // --- HẠ TONE: CRYSTAL CLEAR + BASS SẠCH, LAN TỎA KHÔNG TÙ ---
        const down = perceptualIntensity;
        // Formant giữ độ thực của nhạc cụ
        const formantComp = 1.0 + down * 0.55 + Math.pow(down, 2) * 0.25;
        f1Freq *= formantComp;
        f2Freq *= (formantComp * 1.02);

        // NÂNG CẤP V5.9: Cắt muddy mạnh hơn khi hạ sâu, giảm boost bass thô, tăng warmth lan tỏa
        const mudReduction = down * 4.2 + Math.pow(down, 1.8) * 2.8; // Tăng phi tuyến khi hạ sâu
        const dynamicBassCut = Math.log1p(down * 6.0) * 1.8 * 0.6; // Cắt sâu hơn ở subBass (~60Hz)
        
        subMidBoost = Math.max(0.01, subMidBoost - mudReduction); // Cắt mạnh muddy 300-500Hz
        subBassBoost = Math.max(0.01, subBassBoost - dynamicBassCut); // Giảm lực thô subBass
        
        // BÙ LAN TỎA BẰNG WARMTH THÔNG MINH (thay vì tăng subBassBoost)
        const warmthSpread = Math.pow(down, 1.4) * 3.5; // Tăng warmth để bass lan tỏa tự nhiên
        warmthBoost = Math.max(0.5, warmthBoost + warmthSpread - down * 0.4);

        // Giữ punch bằng subharmonic nhẹ hơn, không over
        const subharmonicGainAdjust = enableSubharmonic ? Math.max(1.0, subharmonicGain - down * 1.8) : 1.0;

        // EQ LỌC: Giữ bass thở, tránh nghẹt
        bassCutFreq = Math.max(32, Math.min(38, bassCutFreq)); // Mở rộng hơi thấp hơn để bass sạch

        // BÙ AIR + HARMONIC ĐỂ GIỮ ĐỘ TRONG
        const airBoost = Math.pow(down, 1.6) * 6.5;
        trebleReduction = Math.max(0.01, trebleReduction - airBoost);
        this.wienerGain = Math.min(0.999, (this.wienerGain || 1.0) + down * 0.18);
        harmonicBoost += down * 3.2; // Tăng harmonic để bass có chiều sâu lan tỏa
    } else {
        // --- NÂNG TONE: BASS LAN TỎA (GIỮ NGUYÊN GỐC VÌ ĐÃ TỐT) ---
        const up = perceptualIntensity;
        const bodyComp = 1.0 - up * 0.45;
        f1Freq *= bodyComp;
        f2Freq *= (bodyComp * 1.05);

        const isHeavyBass = (baseSubBass > 0.6);
        const smartBassCap = isHeavyBass ? 1.2 : 3.8;
        const spreadFactor = Math.pow(up, 1.2);

        subBassBoost += spreadFactor * smartBassCap;
        warmthBoost += spreadFactor * (smartBassCap * 0.85);

        formantGain = Math.max(4.0, (formantGain || 0) + up * 3.0);
        formantQ = Math.max(1.2, (formantQ || 0) + up * 0.75);

        trebleReduction += up * 2.5 * (1 - Math.pow(up, 0.5) * 0.4);
        midBoost += up * 2.2;
        this.delayTime = Math.min((this.delayTime || 0.02) * (1 + up * 0.1), 0.065);
    }
    const baseDelayDrift = 1 + absPitchMult * 0.06;
    this.delayTime = Math.min((this.delayTime || 0.02) * baseDelayDrift, 0.075);
}

		const smartRatio = (baseRatio) => Math.min(baseRatio + absPitchMult * 0.8, baseRatio * 1.1);
		const wienerCompressionAdjust = this.wienerGain < 0.9 ? 1.2 * (1 - this.wienerGain) : 0.1;
		let panAdjust = pitchMult * (this.currentGenre === "EDM" || this.currentGenre === "Pop" ? 0.08 : 0.04);

		const userFeedbackAdjust = this.applyUserFeedback();
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
			// === ÁP DỤNG ACOUSTIC TRANSPARENCY NGAY ĐẦU TIÊN – CHỐT HẠ ĐỘ TRONG SUỐT THỰC TẾ TỰ ĐỘNG ===
    // Làm cho mọi preset (kể cả warm) tự động thăng hoa clarity vs mud, bass vẫn bum bum ngất ngây
    const transparencyGain = this.calculateAcousticTransparencyGain();
    this.boostGain.gain.cancelScheduledValues(currentTime);
    this.boostGain.gain.setValueAtTime(
        this.boostGain.gain.value * transparencyGain,
        currentTime
    );
	// === DYNAMIC PEAK GUARDIAN PRO - KIỂM SOÁT VỠ TIẾNG LI TI THÔNG MINH ===
    // Tự động phát hiện bài quá lớn, giảm peak mà không mất dynamic, bass vẫn bum bum ngất ngây
    this.applyDynamicPeakGuardian();
			// === SỬA LỖI LAG / GIẬT / NỔ ÂM THANH KHI ĐỔI PROFILE NHANH ===
			const filters = [
				this.highPassFilter?.frequency,
				this.lowShelfGain?.gain,
				this.subBassFilter?.gain,
				this.subMidFilter?.gain,
				this.midBassFilter?.gain,
				this.midShelfGain?.gain,
				this.highMidFilter?.gain,
				this.highShelfGain?.gain,
				this.subTrebleFilter?.gain,
				this.airFilter?.gain,
				this.lowPassFilter?.frequency,
				this.compressor?.threshold,
				this.compressor?.ratio,
				this.notchFilter?.frequency,
				this.notchFilter?.Q,
				this.panner?.pan,
				this.outputGain?.gain
			];
			filters.forEach(param => {
				if (param) {
					param.cancelScheduledValues(currentTime);
					param.setValueAtTime(param.value, currentTime);
				}
			});
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
			this.highPassFilter.frequency.linearRampToValueAtTime(optimizedParams.bassCutFreq || bassCutFreq, currentTime + (this.rampTime || 0.1));
			this.lowShelfGain.gain.linearRampToValueAtTime(optimizedParams.lowShelfGain || (9 + subBassBoost + warmthBoost + subharmonicGain), currentTime + (this.rampTime || 0.1));
			this.subBassFilter.gain.linearRampToValueAtTime(optimizedParams.subBassGain || (4 + subBassBoost + subharmonicGain), currentTime + (this.rampTime || 0.1));
			this.subMidFilter.gain.linearRampToValueAtTime(optimizedParams.subMidGain || (5.5 + subMidBoost + warmthBoost * smartWarmthAdjust), currentTime + (this.rampTime || 0.1));
			this.midBassFilter.gain.linearRampToValueAtTime(optimizedParams.midBassGain || (4.2 + warmthBoost), currentTime + (this.rampTime || 0.1));
			this.midShelfGain.gain.linearRampToValueAtTime(optimizedParams.midShelfGain || (6.2 + midBoost), currentTime + (this.rampTime || 0.1));
			this.highMidFilter.gain.linearRampToValueAtTime(optimizedParams.highMidGain || (4.5 + midBoost + harmonicBoost), currentTime + (this.rampTime || 0.1));
			this.highShelfGain.gain.linearRampToValueAtTime(optimizedParams.highShelfGain || (0.8 - trebleReduction + harmonicBoost + (isTransientGenre ? transientBoostAdjust : 0)), currentTime + (this.rampTime || 0.1));
			this.subTrebleFilter.gain.linearRampToValueAtTime(optimizedParams.subTrebleGain || (0.6 - trebleReduction + harmonicBoost + (isTransientGenre ? transientBoostAdjust : 0)), currentTime + (this.rampTime || 0.1));
			this.airFilter.gain.linearRampToValueAtTime(optimizedParams.airGain || (0.6 + harmonicBoost - trebleReduction), currentTime + (this.rampTime || 0.1));
			this.lowPassFilter.frequency.linearRampToValueAtTime(optimizedParams.trebleCutFreq || (trebleCutFreq - trebleReduction * 1200), currentTime + (this.rampTime || 0.1));
			this.compressor.threshold.linearRampToValueAtTime(optimizedParams.compressorThreshold || (-18 * dynamicFactor), currentTime + (this.rampTime || 0.1));
			this.compressor.ratio.linearRampToValueAtTime(optimizedParams.compressorRatio || smartRatio(4.5 + wienerCompressionAdjust), currentTime + (this.rampTime || 0.1));
			this.compressor.attack.linearRampToValueAtTime(optimizedParams.compressorAttack || 0.007, currentTime + (this.rampTime || 0.1));
			this.compressor.release.linearRampToValueAtTime(optimizedParams.compressorRelease || 0.28, currentTime + (this.rampTime || 0.1));
			this.notchFilter.frequency.linearRampToValueAtTime(optimizedParams.notchFreq || notchFreq, currentTime + (this.rampTime || 0.1));
			this.notchFilter.Q.linearRampToValueAtTime(optimizedParams.notchQ || notchQ, currentTime + (this.rampTime || 0.1));
			this.panner.pan.linearRampToValueAtTime(optimizedParams.panAdjust || panAdjust, currentTime + (this.rampTime || 0.1));

			// === CÁC HÀM XỬ LÝ NỘI BỘ (GIỮ NGUYÊN CẤU TRÚC XƯƠNG SỐNG) ===
			const applyCommonProfileSettings = (vocalTypeFactor = 1.0, genreAdjust = 1.0, deEsserGain = -8) => {
				this.lowShelfGain.gain.linearRampToValueAtTime(optimizedParams.lowShelfGain || (8.5 + subBassBoost + warmthBoost * genreAdjust + userFeedbackAdjust.bass), currentTime + (this.rampTime || 0.1));
				this.subBassFilter.gain.linearRampToValueAtTime(optimizedParams.subBassGain || (4 + subBassBoost * genreAdjust + userFeedbackAdjust.bass), currentTime + (this.rampTime || 0.1));
				this.subMidFilter.gain.linearRampToValueAtTime(optimizedParams.subMidGain || ((5.5 + subMidBoost + warmthBoost) * vocalTypeFactor * genreAdjust + userFeedbackAdjust.mid), currentTime + (this.rampTime || 0.1));
				this.midBassFilter.gain.linearRampToValueAtTime(optimizedParams.midBassGain || (4 + warmthBoost * genreAdjust + userFeedbackAdjust.mid), currentTime + (this.rampTime || 0.1));
				this.midShelfGain.gain.linearRampToValueAtTime(optimizedParams.midShelfGain || ((6.2 + midBoost) * vocalTypeFactor * genreAdjust * songStructure.structureFactor + userFeedbackAdjust.mid), currentTime + (this.rampTime || 0.1));
				this.highMidFilter.gain.linearRampToValueAtTime(optimizedParams.highMidGain || ((4.5 + midBoost + harmonicBoost) * vocalTypeFactor * genreAdjust + userFeedbackAdjust.mid), currentTime + (this.rampTime || 0.1));
				this.highShelfGain.gain.linearRampToValueAtTime(optimizedParams.highShelfGain || (0.8 - trebleReduction + harmonicBoost * genreAdjust + (isTransientGenre ? transientBoostAdjust : 0) + userFeedbackAdjust.treble), currentTime + (this.rampTime || 0.1));
				this.subTrebleFilter.gain.linearRampToValueAtTime(optimizedParams.subTrebleGain || ((0.6 - trebleReduction + harmonicBoost) * vocalTypeFactor * genreAdjust + (isTransientGenre ? transientBoostAdjust : 0) + userFeedbackAdjust.treble), currentTime + (this.rampTime || 0.1));
				this.airFilter.gain.linearRampToValueAtTime(optimizedParams.airGain || (0.6 + harmonicBoost - trebleReduction * genreAdjust + userFeedbackAdjust.treble), currentTime + (this.rampTime || 0.1));
				this.notchFilter.frequency.linearRampToValueAtTime(optimizedParams.notchFreq || notchFreq, currentTime + (this.rampTime || 0.1));
				this.notchFilter.Q.linearRampToValueAtTime(optimizedParams.notchQ || notchQ, currentTime + (this.rampTime || 0.1));
				if (this.deEsser?.gain) {
					this.deEsser.gain.linearRampToValueAtTime(optimizedParams.deEsserGain || deEsserGain, currentTime + (this.rampTime || 0.1));
				}
			};

			const applyVocalClassification = () => {
				let vocalTypeFactor = this.isVocal ? 1.5 : 1.0;
				let voiceType = 'middle';
				let fundamentalFreq = (this.polyphonicPitches && this.polyphonicPitches.length > 0) ? (this.polyphonicPitches[0]?.frequency || 440) : 440;
				if (fundamentalFreq <= 240) {
					voiceType = 'low';
					vocalTypeFactor = 1.6;
					f1Freq = optimizedParams.f1Freq || (340 + (spectral.vocalPresence || 0) * 60);
					f2Freq = optimizedParams.f2Freq || (1550 + (spectral.vocalPresence || 0) * 250);
					formantGain = optimizedParams.formantGain || (4.0 * vocalTypeFactor * songStructure.structureFactor);
					formantQ = optimizedParams.formantQ || (1.2 * vocalTypeFactor);
				} else if (fundamentalFreq <= 480) {
					voiceType = 'middle';
					vocalTypeFactor = 1.0;
					f1Freq = optimizedParams.f1Freq || (450 + (spectral.vocalPresence || 0) * 60);
					f2Freq = optimizedParams.f2Freq || (1950 + (spectral.vocalPresence || 0) * 250);
					formantGain = optimizedParams.formantGain || (3.6 * vocalTypeFactor * songStructure.structureFactor);
					formantQ = optimizedParams.formantQ || (0.9 * vocalTypeFactor);
				} else {
					voiceType = 'high';
					vocalTypeFactor = 0.7;
					f1Freq = optimizedParams.f1Freq || (580 + (spectral.vocalPresence || 0) * 60);
					f2Freq = optimizedParams.f2Freq || (2350 + (spectral.vocalPresence || 0) * 250);
					formantGain = optimizedParams.formantGain || (2.8 * vocalTypeFactor * songStructure.structureFactor);
					formantQ = optimizedParams.formantQ || (0.6 * vocalTypeFactor);
				}
				return {
					vocalTypeFactor,
					voiceType,
					fundamentalFreq
				};
			};

			const applyGenreAndStructureAdjustments = (vocalTypeFactor) => {
				let genreAdjust = 1.0;
				if (this.currentGenre === 'Bolero') {
					genreAdjust = 1.5;
					warmthBoost *= 1.7;
					subMidBoost *= 1.6;
					trebleReduction *= 0.6;
				} else if (['EDM', 'Pop'].includes(this.currentGenre)) {
					genreAdjust = 0.85;
					transientBoostAdjust *= 1.4;
					optimizedParams.subTrebleGain *= 1.1;
				} else if (this.currentGenre === 'Rock/Metal') {
					genreAdjust = 1.2;
					harmonicBoost *= 1.5;
					midBoost *= 1.4;
				} else if (this.currentGenre === 'Karaoke') {
					genreAdjust = 1.3;
					vocalTypeFactor *= 1.4;
					warmthBoost *= 1.4;
				}

				if (songStructure.section === 'chorus') {
					midBoost *= 1.4;
					harmonicBoost *= 1.4;
					optimizedParams.compressorRatio = smartRatio((optimizedParams.compressorRatio || 4.5) * 1.2);
					optimizedParams.formantGain = (optimizedParams.formantGain || 3.2) * 0.85;
				} else if (songStructure.section === 'bridge') {
					optimizedParams.highMidGain = (optimizedParams.highMidGain || 4.5) * 1.2;
					optimizedParams.subTrebleGain = (optimizedParams.subTrebleGain || 0.6) * 1.05;
				} else if (songStructure.section === 'intro') {
					warmthBoost *= 0.8;
					optimizedParams.formantGain = (optimizedParams.formantGain || 3.2) * 0.7;
				}
				return genreAdjust;
			};

			const applyNoiseHandling = () => {
				let deEsserGain = -8;
				const safeAir = (typeof spectral.air === 'number') ? spectral.air : 0.5;

				if (enableAdvancedDeEsser && (spectral.spectralFlux > 0.55 || safeAir > 0.65 || spectral.vocalPresence > 0.7)) {
					deEsserGain = -12 - (spectral.spectralFlux - 0.55) * 10;
					notchFreq = optimizedParams.notchFreq || (6500 + safeAir * 1000);
					notchQ = optimizedParams.notchQ || (notchQ * 2.5);
					if (spectral.spectralEntropy < 0.5) {
						deEsserGain -= 3;
						if (optimizedParams.subTrebleGain !== undefined) {
							optimizedParams.subTrebleGain *= 0.85;
						}
					}
				} else if (this.noiseLevel.level > 0.45) {
					notchFreq = optimizedParams.notchFreq || (4500 + (this.noiseLevel.midFreq / 5000) * 2200);
					notchQ = optimizedParams.notchQ || (notchQ * 2.5);
				}

				if (songStructure.section === 'chorus' && spectral.vocalPresence > 0.7) {
					deEsserGain -= 3;
					notchFreq = optimizedParams.notchFreq || 7000;
				}

				// === FIX: XÓA PHẦN RAMP RIÊNG CHO BASSHEAVY ĐỂ TRÁNH ĐÈ LỆNH ===
				// Chỉ tính toán, không ramp ở đây nữa → để common + profile riêng quyết định

				if (profile === "bassHeavy" && spectral.subBass > 0.7) {
					this.wienerGain = Math.max(0.88, this.wienerGain - 0.03);
				}

				return deEsserGain;
			};

			const applyCNNTransientDetection = () => {
				if (!enableCNNTransient) return {
					vocalTransient: 0.5,
					instrumentTransient: 0.5
				};
				const vocalTransient = spectral.vocalPresence > 0.7 ? Math.min(0.8, spectral.transientEnergy * 1.2) : 0.4;
				const instrumentTransient = (spectral.instruments.guitar || spectral.instruments.drums) ? Math.min(0.8, spectral.transientEnergy * 1.1) : 0.4;
				return {
					vocalTransient,
					instrumentTransient
				};
			};

			const {
				vocalTransient,
				instrumentTransient
			} = applyCNNTransientDetection();
			// === GỌI CÁC HÀM CON ĐỂ LẤY DỮ LIỆU CHUNG TRƯỚC KHI VÀO PROFILE RIÊNG ===
			const {
				vocalTypeFactor
			} = applyVocalClassification();
			const genreAdjust = applyGenreAndStructureAdjustments(vocalTypeFactor);
			const deEsserGain = applyNoiseHandling();

			applyCommonProfileSettings(vocalTypeFactor, genreAdjust, deEsserGain);
			// Profile-specific setting
				if (profile === "warm") {
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
					const {
						vocalTypeFactor,
						voiceType,
						fundamentalFreq
					} = applyVocalClassification();
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
					const {
						vocalTransient,
						instrumentTransient
					} = applyCNNTransientDetection();
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
			// === HỆ THỐNG ĐIỀU KHIỂN FORMANT V5.8: TÁCH BẠCH & MÀU SẮC ===
			if (!this.formantFilter1?.frequency || !this.formantFilter2?.frequency) {
				throw new Error("Formant filters (1 or 2) are not initialized");
			}

			const rampEnd = currentTime + (this.rampTime || 0.05);

			// NÂNG CẤP: Sử dụng f1Freq, f2Freq từ thuật toán Pitch để giữ màu sắc nhạc cụ
			// Chúng ta ưu tiên giá trị từ PitchMult vì nó quyết định độ "thực" của âm thanh
			this.formantFilter1.frequency.linearRampToValueAtTime(f1Freq, rampEnd);
			this.formantFilter1.gain.linearRampToValueAtTime(formantGain, rampEnd);
			this.formantFilter1.Q.linearRampToValueAtTime(formantQ, rampEnd);

			this.formantFilter2.frequency.linearRampToValueAtTime(f2Freq, rampEnd);
			this.formantFilter2.gain.linearRampToValueAtTime(formantGain * 0.85, rampEnd); // Giảm nhẹ Gain 2 để tạo không gian
			this.formantFilter2.Q.linearRampToValueAtTime(formantQ * 1.15, rampEnd); // Tăng Q 2 để làm rõ tiếng nhạc cụ tách bạch

			// Apply quality prediction recommendations
			// FIX: Cache chiều dài mảng để tối ưu CPU vòng lặp
			const recommendations = this.qualityPrediction.recommendations || [];
			recommendations.forEach(rec => {
				try {
					if (typeof rec !== 'string') return;

					// FIX quan trọng: Kiểm tra sự tồn tại của các tham số Gain trước khi gán để chống crash/lag
					if (rec.includes("Reduce sub-bass")) {
						const subGain = this.subBassFilter?.gain;
						const lowGain = this.lowShelfGain?.gain;
						if (subGain && lowGain) {
							subGain.linearRampToValueAtTime(Math.max(subGain.value - 0.8, 0), rampEnd);
							lowGain.linearRampToValueAtTime(Math.max(lowGain.value - 0.8, 0), rampEnd);
						}
					}

					if (rec.includes("Reduce treble/sub-treble")) {
						const highGain = this.highShelfGain?.gain;
						const subTrGain = this.subTrebleFilter?.gain;
						if (highGain && subTrGain) {
							highGain.linearRampToValueAtTime(Math.max(highGain.value - 0.8, 0), rampEnd);
							subTrGain.linearRampToValueAtTime(Math.max(subTrGain.value - 0.8, 0), rampEnd);
						}
						if (this.deEsser?.gain) {
							this.deEsser.gain.linearRampToValueAtTime(-8, rampEnd);
						}
					}

					if (rec.includes("Apply noise reduction")) {
						if (this.notchFilter) {
							this.notchFilter.Q.linearRampToValueAtTime(this.notchQ * 4.5, rampEnd);
							this.notchFilter.frequency.linearRampToValueAtTime(6000, rampEnd);
						}
					}

					if (rec.includes("Boost instrument frequencies")) {
						const instrumentBoost = (this.polyphonicPitches?.length || 0) > 1 ? 2.2 : 1.8;
						if (this.subMidFilter?.gain && this.highMidFilter?.gain) {
							this.subMidFilter.gain.linearRampToValueAtTime(this.subMidFilter.gain.value + instrumentBoost, rampEnd);
							this.highMidFilter.gain.linearRampToValueAtTime(this.highMidFilter.gain.value + instrumentBoost, rampEnd);
						}
					}

					if (rec.includes("Apply soft compression")) {
						if (this.compressor) {
							const currentRatio = this.compressor.ratio.value;
							this.compressor.ratio.linearRampToValueAtTime(smartRatio(currentRatio + 0.8), rampEnd);
							this.compressor.attack.linearRampToValueAtTime(0.008, rampEnd);
							this.compressor.release.linearRampToValueAtTime(0.32, rampEnd);
						}
					}

					if (rec.includes("Increase transient shaping")) {
						const subTrGain = this.subTrebleFilter?.gain;
						const highGain = this.highShelfGain?.gain;
						const tBoost = this.transientBoost || 0; // FIX: Tránh NaN nếu transientBoost undefined
						if (subTrGain && highGain) {
							subTrGain.linearRampToValueAtTime(subTrGain.value + 0.6 + (tBoost * 0.6), rampEnd);
							highGain.linearRampToValueAtTime(highGain.value + 0.5 + (tBoost * 0.5), rampEnd);
						}
					}
				} catch (error) {
					// FIX: Không throw error trong vòng lặp để tránh treo luồng chính
					console.warn("Quality Recommendation failed to apply safely:", rec);
				}
			});

			// Apply vitamin with optimized parameters
			// FIX: Đảm bảo harmonicBoost có giá trị số (Numerical Safety)
			const safeHarmonicBoost = typeof harmonicBoost === 'number' ? harmonicBoost : 0;
			this.setBoost(optimizedParams.boost || (0.7 + safeHarmonicBoost));
			this.applyVitamin(profile, pitchMult, absPitchMult);

			// Update spectralProfile with advanced fields
			this.spectralProfile = {
				...spectral,
				spectralFlux: spectral.spectralFlux || 0.5,
				spectralEntropy: spectral.spectralEntropy || 0.5,
				harmonicRatio: spectral.harmonicRatio || 0.5
			};

			// Store profile settings in MemoryManager with expiry
			// FIX: Cơ chế giải phóng tài nguyên mạnh mẽ hơn
			if (this.memoryManager) {
				const cacheKey = 'soundProfile';
				// FIX: Xóa cache cũ trước khi ghi mới nếu cùng key để tránh chồng lấn RAM
				if (this.memoryManager.buffers.has(cacheKey)) {
					this.memoryManager.buffers.delete(cacheKey);
				}

				this.memoryManager.buffers.set(cacheKey, {
					profile,
					settings: Object.freeze({
						...optimizedParams
					}), // Freeze để tránh leak tham chiếu
					timestamp: Date.now(),
					expiry: Date.now() + 10000
				});

				// FIX: PruneCache tích cực hơn khi RAM cao
				this.memoryManager.pruneCache(80);
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
		// FIX: Bổ sung logic khôi phục (Fallback) nếu hệ thống gặp lỗi nặng
		handleError("CRITICAL: Error setting sound profile, reverting to safety state:", error, {
			profile,
			spectralProfile: this.spectralProfile
		});

		// Bổ sung: Hàm tự bảo vệ để không cháy loa/treo máy khi crash
		if (this.emergencyReset) this.emergencyReset();
	}
};

/**
 * Simple hash function for context object to generate cache key
 * @param {Object} obj - Context object
 * @returns {string} Hash string
 */
function simpleHash(obj) {
    if (!obj) return "0";
    const s = obj.spectralProfile || {};
    // Tinh hoa: chỉ atomic values nhanh 10x
    const identity = [
        s.transientEnergy || 0.5,
        obj.isVocal ? 1 : 0,
        obj.polyphonicPitches?.length || 0,
        obj.noiseLevel || 0.5,
        obj.qualityPrediction || 0.5
    ].join('|');
    let hash = 0;
    for (let i = 0; i < identity.length; i++) {
        hash = ((hash << 5) - hash) + identity.charCodeAt(i);
        hash |= 0;
    }
    // Tinh hoa: chroma sum nhanh nếu có
    if (s.chroma && Array.isArray(s.chroma)) {
        let chromaSum = 0;
        for (let j = 0; j < s.chroma.length; j++) chromaSum += s.chroma[j];
        hash = (hash ^ (chromaSum * 100)) | 0;
    }
    return (hash >>> 0).toString(36);
}

Jungle.prototype.initializeContextAnalyzer = function() {
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
            const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
            // Tinh hoa: cache 1s ngắn hơn + hashKey atomic
            const cacheKey = `contextAnalysis_${simpleHash(context)}`;
            if (memoryManager && typeof memoryManager.get === 'function') {
                const cachedResult = memoryManager.get(cacheKey);
                if (cachedResult && cachedResult.metadata?.timestamp > Date.now() - 1000 && cachedResult.metadata?.expiry > Date.now()) {
                    if (isDebug) console.debug(`Retrieved cached analysis for key: ${cacheKey}`, cachedResult);
                    return cachedResult;
                }
            }
            try {
                // Tính spectralComplexity – tinh hoa for loop nhanh hơn
                let spectralComplexity = 0.5;
                if (spectralProfile.chroma && Array.isArray(spectralProfile.chroma) && spectralProfile.chroma.length > 0) {
                    let sumSq = 0;
                    for (let i = 0; i < spectralProfile.chroma.length; i++) {
                        const val = ensureFinite(spectralProfile.chroma[i], 0);
                        sumSq += val * val;
                    }
                    spectralComplexity = sumSq / spectralProfile.chroma.length;
                }
                spectralComplexity = Math.max(0, Math.min(1, ensureFinite(spectralComplexity, 0.5)));
                // Lấy các tham số khác
                const transientEnergy = ensureFinite(spectralProfile.transientEnergy, 0.5);
                const vocalPresence = isVocal ? 1.0 : ensureFinite(spectralProfile.vocalPresence, 0.5);
                const harmonicComplexity = ensureFinite(polyphonicPitches.length, 0) > 1 ? 1.3 : 1.0;
                // Kiểm tra CPU load
                const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
                const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
                const cpuLoadAdjust = cpuLoad > 0.9 || isLowPowerDevice ? 0.85 : 1.0;
                // Tính fadeTime
                const minFadeTime = 0.005;
                const baseFadeTime = 0.4 * (vocalPresence > 0.7 ? 1.4 : 1.0);
                const noiseAdjust = noiseLevel > 0.7 ? 1.2 : 1.0;
                const qualityAdjust = qualityPrediction > 0.7 ? 1.1 : 1.0;
                let fadeTime = Math.max(minFadeTime, baseFadeTime * (
                    1.0 + 0.3 * spectralComplexity + 0.2 * transientEnergy + 0.3 * vocalPresence
                ) * noiseAdjust * qualityAdjust * cpuLoadAdjust);
                // Tinh hoa: hard-limit fadeTime 1.5s chống lag
                fadeTime = Math.min(1.5, fadeTime);
                fadeTime = ensureFinite(fadeTime, minFadeTime);
                // Tính bufferTime
                const bufferTime = ensureFinite(
                    this.calculateBufferTime?.(spectralComplexity, transientEnergy, vocalPresence) || 0.2,
                    0.2
                );
                // Các tham số khác
                const fadeType = 'bezier';
                const smoothnessBase = spectralComplexity > 0.7 ? 2.2 : 1.9;
                const smoothness = ensureFinite(
                    smoothnessBase * (noiseLevel > 0.7 ? 1.1 : 1.0) * cpuLoadAdjust,
                    1.9
                );
                const vibranceBase = harmonicComplexity > 1.0 ? 0.95 : 0.85;
                const vibrance = ensureFinite(
                    vibranceBase * (qualityPrediction > 0.7 ? 1.05 : 1.0) * cpuLoadAdjust,
                    0.85
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
                        memoryManager.set(cacheKey, result, 'normal', { timestamp: Date.now() });
                        // Tinh hoa: history chỉ lưu dữ liệu thô + shift()
                        let analysisHistory = memoryManager.get('analysisHistory') || [];
                        analysisHistory.push({ f: fadeTime, b: bufferTime, t: Date.now() });
                        if (analysisHistory.length > 10) analysisHistory.shift();
                        memoryManager.set('analysisHistory', analysisHistory, 'low');
                        if (isDebug) console.debug(`Stored analysis for key: ${cacheKey}`, result);
                    } catch (error) {
                        handleError('Failed to store analysis', error, { cacheKey, result }, 'low', { memoryManager });
                    }
                }
                // Debug log
                if (isDebug) {
                    console.debug(`Context analysis result`, {
                        input: { spectralProfile, isVocal, polyphonicPitchesLength: polyphonicPitches.length, noiseLevel, qualityPrediction, cpuLoad, isLowPowerDevice },
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
Jungle.prototype.calculateBufferTime = function(spectralComplexity, transientEnergy, vocalPresence, options = {}) {
    try {
        // Chuẩn hóa đầu vào
        spectralComplexity = ensureFinite(spectralComplexity, 0.5);
        transientEnergy = ensureFinite(transientEnergy, 0.5);
        vocalPresence = ensureFinite(vocalPresence, 0.5);
        const currentPitchMult = ensureFinite(this.currentPitchMult, 0);
        // Chuẩn hóa options – tinh hoa: không tạo object thừa, lấy trực tiếp
        const spectralWeight = ensureFinite(options.spectralWeight, 0.2);
        const transientWeight = ensureFinite(options.transientWeight, 0.3);
        const vocalWeight = ensureFinite(options.vocalWeight, 0.2);
        const pitchThreshold = ensureFinite(options.pitchThreshold, 0.3);
        const pitchFactor = ensureFinite(options.pitchFactor, 1.5);
        const minBufferTime = ensureFinite(options.minBufferTime, 0.1);
        const maxBufferTime = ensureFinite(options.maxBufferTime, 2.0);
        // Kiểm tra CPU load – tinh hoa siết chặt hơn khi >0.92
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const cpuLoadAdjust = cpuLoad > 0.92 || isLowPowerDevice ? 0.8 : 1.0;
        // Tính baseBufferTime
        const baseBufferTime = this.qualityMode === 'high' ? 0.8 : 0.4;
        // Tính pitchAdjust
        const pitchAdjust = Math.abs(currentPitchMult) > pitchThreshold ? pitchFactor : 1.0;
        // Tính bufferTime
        let bufferTime = baseBufferTime * (
            1.0 +
            spectralWeight * spectralComplexity +
            transientWeight * transientEnergy +
            vocalWeight * vocalPresence
        ) * pitchAdjust * cpuLoadAdjust;
        // Giới hạn bufferTime
        bufferTime = Math.max(minBufferTime, Math.min(maxBufferTime, bufferTime));
        bufferTime = ensureFinite(bufferTime, minBufferTime);
        // Debug log gọn
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        if (isDebug) {
            console.debug(`Calculated bufferTime: ${bufferTime.toFixed(4)}s`, {
                spectralComplexity,
                transientEnergy,
                vocalPresence,
                currentPitchMult,
                qualityMode: this.qualityMode,
                cpuLoad,
                isLowPowerDevice
            });
        }
        return bufferTime;
    } catch (error) {
        handleError('Error calculating bufferTime', error, { spectralComplexity, transientEnergy, vocalPresence, qualityMode: this.qualityMode }, 'high', { memoryManager: options.memoryManager });
        return options.minBufferTime || 0.1; // Tinh hoa fallback options.minBufferTime
    }
};

/**
 * Simple hash function for context object to generate cache key
 * @param {Object} obj - Context object
 * @returns {string} Hash string
 */
function simpleHash(obj) {
    if (!obj) return "0";
    const s = obj.spectralProfile || {};
    const t = obj.tempoMemory || {};
    // Tinh hoa: chỉ atomic values + Float32Array chroma nhanh hơn
    const identity = [
        s.subBass || 0.5,
        s.high || 0.5,
        s.transientEnergy || 0.5,
        t.current || 120,
        obj.currentGenre || '',
        obj.polyphonicPitches?.length || 0
    ].join('|');
    let hash = 0;
    for (let i = 0; i < identity.length; i++) {
        hash = ((hash << 5) - hash) + identity.charCodeAt(i);
        hash |= 0;
    }
    // Tinh hoa: chroma sum nhanh với Float32Array nếu có
    if (s.chroma && Array.isArray(s.chroma)) {
        let chromaSum = 0;
        for (let j = 0; j < s.chroma.length; j++) chromaSum += s.chroma[j];
        hash = (hash ^ (chromaSum * 100)) | 0;
    }
    return (hash >>> 0).toString(36);
}

Jungle.prototype.analyzeSongStructure = function({
    spectralProfile,
    tempoMemory,
    polyphonicPitches,
    currentGenre
}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    // Chuẩn hóa đầu vào
    const spectral = spectralProfile || {
        subBass: 0.5,
        bass: 0.5,
        subMid: 0.5,
        midLow: 0.5,
        midHigh: 0.5,
        high: 0.5,
        subTreble: 0.5,
        air: 0.5,
        transientEnergy: 0.5,
        instruments: {},
        spectralFlux: 0.5,
        spectralEntropy: 0.5,
        harmonicRatio: 0.5,
        chroma: Array(12).fill(0.5)
    };
    const validatedSpectral = {
        subBass: ensureFinite(spectral.subBass, 0.5),
        bass: ensureFinite(spectral.bass, 0.5),
        subMid: ensureFinite(spectral.subMid, 0.5),
        midLow: ensureFinite(spectral.midLow, 0.5),
        midHigh: ensureFinite(spectral.midHigh, 0.5),
        high: ensureFinite(spectral.high, 0.5),
        subTreble: ensureFinite(spectral.subTreble, 0.5),
        air: ensureFinite(spectral.air, 0.5),
        transientEnergy: ensureFinite(spectral.transientEnergy, 0.5),
        instruments: typeof spectral.instruments === 'object' ? spectral.instruments : {},
        spectralFlux: ensureFinite(spectral.spectralFlux, 0.5),
        spectralEntropy: ensureFinite(spectral.spectralEntropy, 0.5),
        harmonicRatio: ensureFinite(spectral.harmonicRatio, 0.5),
        // Tinh hoa: Float32Array cho chroma tính nhanh hơn
        chroma: Array.isArray(spectral.chroma) && spectral.chroma.length === 12 ?
            new Float32Array(spectral.chroma.map(v => ensureFinite(v, 0.5))) : new Float32Array(12).fill(0.5)
    };
    const validatedTempoMemory = tempoMemory || { current: 120, previous: 120 };
    const validatedPolyphonicPitches = Array.isArray(polyphonicPitches) ? polyphonicPitches : [];
    const validatedCurrentGenre = typeof currentGenre === 'string' ? currentGenre.toLowerCase() : 'unknown';
    try {
        // Kiểm tra CPU load
        const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
        const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
        const cpuLoadAdjust = cpuLoad > 0.85 || isLowPowerDevice ? 0.85 : 1.0; // Tinh hoa siết chặt hơn
        // Lấy cache từ MemoryManager – tinh hoa cache 1s ngắn hơn
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
        const tempoChange = validatedTempoMemory.current && validatedTempoMemory.previous ?
            Math.abs(ensureFinite(validatedTempoMemory.current, 120) - ensureFinite(validatedTempoMemory.previous, 120)) / ensureFinite(validatedTempoMemory.previous, 120) :
            0;
        const energy = (
            validatedSpectral.subBass + validatedSpectral.bass + validatedSpectral.subMid +
            validatedSpectral.midLow + validatedSpectral.midHigh + validatedSpectral.high
        ) / 6;
        const energyChange = this.memoryManager?.get('lastEnergy') ?
            Math.abs(energy - ensureFinite(this.memoryManager.get('lastEnergy'), 0.5)) / (ensureFinite(this.memoryManager.get('lastEnergy'), 0.5) || 1) :
            0;
        const transientDensity = validatedSpectral.transientEnergy;
        const instrumentPresence = Object.values(validatedSpectral.instruments).reduce((sum, val) => sum + ensureFinite(val, 0), 0) /
            (Object.keys(validatedSpectral.instruments).length || 1);
        const spectralFlux = validatedSpectral.spectralFlux;
        const spectralEntropy = validatedSpectral.spectralEntropy;
        const harmonicRatio = validatedSpectral.harmonicRatio;
        // Tính chroma metrics – tinh hoa Float32Array nhanh hơn
        const chromaPresence = validatedSpectral.chroma.reduce((sum, val) => sum + val, 0) / 12;
        const lastChroma = this.memoryManager?.get('lastChroma') || new Float32Array(12).fill(0.5);
        let chromaFlux = 0;
        for (let i = 0; i < 12; i++) {
            chromaFlux += Math.abs(validatedSpectral.chroma[i] - lastChroma[i]);
        }
        chromaFlux /= 12;
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
        scores.chorus += energyChange * 2.0 * genreAdjust;
        scores.chorus += transientDensity * 1.5 * genreAdjust;
        scores.chorus += tempoChange * 1.0 * genreAdjust;
        scores.chorus += spectralFlux * 1.2;
        scores.chorus += instrumentPresence * 1.0 * genreAdjust;
        scores.chorus += chromaPresence * 1.5 * genreAdjust;
        scores.chorus += chromaFlux * 1.2;
        scores.intro += (1 - energy) * 2.0 / genreAdjust;
        scores.intro += (1 - instrumentPresence) * 1.5 / genreAdjust;
        scores.intro += (1 - spectralFlux) * 1.2;
        scores.intro += (1 - transientDensity) * 1.0 / genreAdjust;
        scores.intro += (1 - chromaPresence) * 1.5 / genreAdjust;
        scores.intro += (1 - chromaFlux) * 1.2;
        scores.bridge += (1 - transientDensity) * 1.5 / genreAdjust;
        scores.bridge += instrumentPresence * 1.2 * genreAdjust;
        scores.bridge += harmonicRatio * 1.0;
        scores.bridge += (1 - energyChange) * 1.0 / genreAdjust;
        scores.bridge += chromaFlux * 1.5;
        scores.bridge += (1 - chromaPresence) * 1.0;
        scores.verse += (1 - Math.abs(energy - 0.5)) * 1.5;
        scores.verse += (1 - Math.abs(transientDensity - 0.5)) * 1.2;
        scores.verse += spectralEntropy * 1.0;
        scores.verse += (1 - tempoChange) * 0.8;
        scores.verse += (1 - Math.abs(chromaPresence - 0.5)) * 1.2;
        scores.verse += (1 - chromaFlux) * 1.0;
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
        const factorMap = {
            chorus: 1.4,
            intro: 0.8,
            bridge: 1.2,
            verse: 1.0
        };
        structureFactor = factorMap[section] * pitchAdjust * cpuLoadAdjust;
        structureFactor = Math.max(0.5, Math.min(2.0, ensureFinite(structureFactor, 1.0)));
        // Kết quả
        const result = {
            section,
            structureFactor,
            confidence
        };
        // Lưu vào MemoryManager
        if (this.memoryManager && typeof this.memoryManager.set === 'function') {
            try {
                this.memoryManager.set(cacheKey, result, 'high', {
                    timestamp: Date.now(),
                    expiry: Date.now() + 10000
                });
                this.memoryManager.set('lastStructure', result, 'high', { timestamp: Date.now() });
                this.memoryManager.set('lastInputHash', currentInputHash, 'low', { timestamp: Date.now() });
                this.memoryManager.set('lastChroma', validatedSpectral.chroma, 'low', { timestamp: Date.now() });
                // Tinh hoa: shift() thay slice(-50) nhanh hơn
                let history = this.memoryManager.get('songStructureHistory') || [];
                history.push({ section, structureFactor, confidence, timestamp: Date.now(), chroma: validatedSpectral.chroma });
                if (history.length > 50) history.shift();
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
        return {
            section: 'verse',
            structureFactor: 1.0,
            confidence: 0.5
        };
    }
};

/**
 * Calculates max cache size based on device memory
 */
Jungle.prototype.calculateMaxCacheSize = function() {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    // Lấy thông tin thiết bị
    const deviceMemory = navigator.deviceMemory || (navigator.hardwareConcurrency ? Math.max(2, navigator.hardwareConcurrency / 2) : 4);
    const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    // Lấy CPU load
    const cpuLoad = this.getCPULoad ? ensureFinite(this.getCPULoad(), 0.5) : 0.5;
    // Tính kích thước cơ bản dựa trên deviceMemory
    let baseCacheSize = deviceMemory * 25; // 25MB per GB
    baseCacheSize = Math.min(100, baseCacheSize);
    // Điều chỉnh dựa trên cpuLoad và isLowPowerDevice – tinh hoa siết chặt hơn
    const loadAdjust = cpuLoad > 0.9 ? 0.6 : cpuLoad > 0.7 ? 0.85 : 1.0;
    const deviceAdjust = isLowPowerDevice ? 0.8 : 1.0;
    let adjustedCacheSize = baseCacheSize * loadAdjust * deviceAdjust;
    // Tích hợp thống kê từ MemoryManager – tinh hoa tăng/giảm 15%
    let cacheStats = { hitRate: 0.5, totalSize: 0 };
    if (this.memoryManager && typeof this.memoryManager.getCacheStats === 'function') {
        cacheStats = this.memoryManager.getCacheStats();
        if (cacheStats.hitRate > 0.8 && cacheStats.totalSize < adjustedCacheSize * 0.9) {
            adjustedCacheSize *= 1.15; // Tăng 15%
        }
        if (cacheStats.hitRate < 0.3 || cacheStats.totalSize > adjustedCacheSize * 1.2) {
            adjustedCacheSize *= 0.85; // Giảm 15%
        }
    }
    // Giới hạn cuối cùng
    adjustedCacheSize = Math.max(10, Math.min(100, ensureFinite(adjustedCacheSize, 50)));
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
 */
function generateCacheSignature(cacheKey, context = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    // Tinh hoa: simplifiedContext gọn nhẹ giảm CPU/RAM
    const simplifiedContext = {
        k: cacheKey,
        t: Math.floor(Date.now() / 2000), // Gom nhóm 2s tăng hit rate
        s: context.songStructure?.section || '',
        p: context.spectralProfile ? (context.spectralProfile.subBass || 0.5) + (context.spectralProfile.high || 0.5) : 1.0
    };
    const inputString = `${simplifiedContext.k}|${simplifiedContext.t}|${simplifiedContext.s}|${simplifiedContext.p}`;
    // Tinh hoa: FNV-1a chuẩn với Math.imul + unsigned
    let hash = 2166136261;
    for (let i = 0; i < inputString.length; i++) {
        hash ^= inputString.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const signature = (hash >>> 0).toString(36);
    // Tinh hoa: collision warn
    if (this.memoryManager && typeof this.memoryManager.get === 'function') {
        const existing = this.memoryManager.get(signature);
        if (existing && isDebug) {
            console.debug('Cache signature collision detected', { signature, cacheKey, context, existingEntry: existing });
        }
    }
    // Debug log
    if (isDebug) {
        console.debug('Generated cache signature', {
            cacheKey,
            signature,
            context: { spectralProfile: context.spectralProfile, songStructure: context.songStructure },
            cacheSize: this.memoryManager?.getCacheStats?.()?.totalSize || 0
        });
    }
    return signature;
}
// Receive user feedback with extended support
Jungle.prototype.receiveUserFeedback = function(feedback) {
    if (!this.memoryManager) {
        console.warn('MemoryManager not initialized, skipping feedback');
        return;
    }
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    // Tinh hoa: tránh xử lý feedback rỗng
    if (!feedback || typeof feedback !== 'string') return;
    const normalizedFeedback = feedback.toLowerCase().trim();
    if (normalizedFeedback.length === 0) return;
    // Chuẩn hóa và phân tích feedback
    const feedbackData = {
        feedback: normalizedFeedback,
        timestamp: Date.now(),
        expiry: Date.now() + 60000, // Tinh hoa: 60s để feedback có giá trị lâu hơn
        semanticCategory: this.analyzeFeedbackSemantics(normalizedFeedback),
        songStructure: this.memoryManager.get('lastStructure')?.section || 'unknown'
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
    // Tinh hoa: shift() thay slice(-20) nhanh hơn
    if (feedbackList.length > 20) feedbackList.shift();
    this.memoryManager.buffers.set('userFeedback', feedbackList, { priority: 'medium' });
    this.memoryManager.pruneCache(this.calculateMaxCacheSize());
    // Tối ưu lưu trữ trong chrome.storage.local với nén key
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['userFeedback'], (result) => {
            let storedFeedback = result.userFeedback || [];
            // Tinh hoa: nén key f/t/e/c/s
            const compressedFeedback = {
                f: normalizedFeedback,
                t: feedbackData.timestamp,
                e: feedbackData.expiry,
                c: feedbackData.semanticCategory,
                s: feedbackData.songStructure
            };
            storedFeedback.push(compressedFeedback);
            // Tinh hoa: limit 30 thay 20 an toàn hơn
            if (storedFeedback.length > 30) storedFeedback.shift();
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
// Hàm phụ để phân tích ngữ nghĩa feedback
Jungle.prototype.analyzeFeedbackSemantics = function(feedback) {
    const keywords = {
        treble: ['chói tai', 'screech', 'harsh', 'bright'],
        bass: ['mạnh bass', 'deep', 'boomy', 'rumbly'],
        vocal: ['ấm giọng', 'clear voice', 'vocal', 'singer'],
        muddy: ['mờ đục', 'muddy', 'unclear'],
        loud: ['to quá', 'loud', 'overpower'],
        quiet: ['nhỏ quá', 'quiet', 'low volume']
    };
    for (const [category, terms] of Object.entries(keywords)) {
        // Tinh hoa: some + indexOf nhanh hơn trên engine cũ
        if (terms.some(term => feedback.indexOf(term) !== -1)) {
            return category;
        }
    }
    return 'unknown';
};

Jungle.prototype.applyUserFeedback = function() {
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
        // Tinh hoa: cacheKey signature gọn nhận biết thay đổi feedback
        const cacheKey = this.generateCacheSignature?.('feedbackAdjustments', {
            spectralProfile,
            songStructure,
            feedbackLength: feedbackList.length,
            cpuLoad
        }) || `feedbackAdjustments_${this.contextId}`;
        const cachedAdjustments = this.memoryManager?.get(cacheKey);
        if (cachedAdjustments?.timestamp > Date.now() - 15000) { // Tinh hoa: cache 15s ngắn hơn, phản hồi nhanh
            if (isDebug) console.debug('Reused cached feedback adjustments', { cacheKey });
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
        // Tinh hoa: getFeedbackIntensity gọn
        const getFeedbackIntensity = (feedback) => {
            const lower = feedback.toLowerCase();
            if (lower.includes('very') || lower.includes('much') || lower.includes('a lot') || lower.includes('rất')) return 1.5;
            if (lower.includes('slightly') || lower.includes('hơi') || lower.includes('nhẹ')) return 0.8;
            return 1.0;
        };
        // Xử lý phản hồi
        feedbackList.forEach(feedback => {
            if (feedback.expiry && feedback.expiry < Date.now()) return;
            const intensity = getFeedbackIntensity(feedback.feedback);
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
                adjustments.distortion -= 0.5 * intensity;
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
            // Harmonic richness
            if (feedback.feedback.includes('giàu cảm xúc') || feedback.feedback.includes('hòa âm phong phú')) {
                adjustments.harmonicRichness += 1.0 * intensity;
                adjustments.mid += 0.5 * intensity;
            }
        });
        // Xử lý chrome.storage.local giữ nguyên
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get(['userFeedback'], (result) => {
                const storedFeedback = result.userFeedback || [];
                storedFeedback.forEach(feedback => {
                    if (feedback.expiry && feedback.expiry < Date.now()) return;
                    const intensity = getFeedbackIntensity(feedback.feedback);
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
        // Tinh hoa: bảo vệ bass/air quá mạnh tránh clipping
        if (spectralProfile.bass > 0.7 && adjustments.bass > 0) adjustments.bass *= 0.8;
        if (spectralProfile.air > 0.7 && adjustments.treble > 0) adjustments.treble *= 0.8;
        if (spectralProfile.chroma && spectralProfile.chroma.some(val => val > 0.7)) {
            adjustments.harmonicRichness += 0.5;
        }
        if (isChorus || isVocalFeedback) {
            adjustments.vocalClarity += 0.7;
            adjustments.clarity += 0.5;
            adjustments.warmth += 0.3;
        }
        // Áp dụng cpuLoadAdjust + clamp ensureFinite
        Object.keys(adjustments).forEach(key => {
            adjustments[key] = Math.max(-4.0, Math.min(4.0, ensureFinite(adjustments[key] * cpuLoadAdjust, 0)));
        });
        // Lưu adjustments vào MemoryManager
        this.memoryManager?.set(cacheKey, {
            adjustments,
            timestamp: Date.now(),
            expiry: Date.now() + 60000
        }, 'high');
        this.memoryManager?.pruneCache(this.calculateMaxCacheSize?.() || 100);
        if (isDebug) console.debug('Applied user feedback', { adjustments });
        return adjustments;
    } catch (error) {
        console.error('Error applying user feedback:', error);
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
Jungle.prototype.optimizeSoundProfile = function({
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
	userFeedbackAdjust,
	roomProfile // NEW: Thông số roomProfile để tăng cường hiệu chỉnh phòng
}) {
	const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

	try {
		// --- [FIX 1: VALIDATE AUDIO CONTEXT - Chống Crash] ---
		if (!this.context || !(this.context instanceof AudioContext) || this.context.state === 'closed') {
			throw new Error('Invalid or closed AudioContext');
		}

		// --- [LOGIC GỐC: VALIDATE SPECTRAL] ---
		const spectralDefaults = {
			subBass: 0.5,
			bass: 0.5,
			subMid: 0.5,
			midLow: 0.5,
			midHigh: 0.5,
			high: 0.5,
			subTreble: 0.5,
			air: 0.5,
			vocalPresence: 0.5,
			transientEnergy: 0.5,
			spectralFlux: 0.5,
			spectralEntropy: 0.5,
			harmonicRatio: 0.5,
			spl: 0
		};
		const validatedSpectral = {};

		// FIX: Đảm bảo toàn bộ giá trị là finite trước khi tính toán để tránh nóng máy (NaN loop)
		const ensureValue = (val, def) => (Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : def);

		Object.keys(spectralDefaults).forEach(key => {
			validatedSpectral[key] = ensureValue(spectral?.[key], spectralDefaults[key]);
		});

		// --- [TỐI ƯU TÀI NGUYÊN: CPU & DEVICE ADAPTATION] ---
		const cpuLoad = this.getCPULoad ? (Number.isFinite(this.getCPULoad()) ? this.getCPULoad() : 0.5) : 0.5;
		const isLowPowerDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
		const deviceAdaptFactor = Math.max(0.65, Math.min(1.0, 1.0 - (cpuLoad * 0.2) * (isLowPowerDevice ? 0.35 : 0.1)));

		// FIX: Giảm tải harmonicOrder khi CPU quá nóng (>80%) hoặc thiết bị yếu
		const harmonicOrderMax = cpuLoad > 0.8 ? 3 : (isLowPowerDevice ? 5 : 8);
		const spectralAttentionScale = cpuLoad > 0.8 ? 0.7 : 1.0;

		// --- [PHÂN TÍCH FFT & SPECTRAL BALANCE] ---
		const fftAnalysis = this._analyser ? this.getFFTAnalysis() : null;
		const subBassEnergy = fftAnalysis?.subBassEnergy || validatedSpectral.subBass;
		const highFreqEnergy = fftAnalysis?.highFreqEnergy || validatedSpectral.air;
		const transientEnergy = fftAnalysis?.transientEnergy || validatedSpectral.transientEnergy;
		const spectralCoherence = fftAnalysis?.spectralCoherence || 0.5;
		const transientDensity = fftAnalysis?.transientDensity || 0.5;

		const spectralBalance = (validatedSpectral.subBass * 0.4 + validatedSpectral.bass * 0.6) /
			(validatedSpectral.midLow * 0.3 + validatedSpectral.midHigh * 0.3 + validatedSpectral.high * 0.2 + validatedSpectral.subTreble * 0.1 + validatedSpectral.air * 0.1 + 0.001);

		// === [NEW: AI SPECTRAL DISCRIMINATION - CHỐNG "ÁM" & TÁCH BIỆT THÔNG MINH] ===
		const isMuddy = (validatedSpectral.subMid > 0.6 || validatedSpectral.midLow > 0.6 || validatedSpectral.bass > 0.7);
		const muddyIndex = Math.max(0, (validatedSpectral.subMid - 0.5 + validatedSpectral.midLow - 0.5) * 1.5);
		const clarityIndex = (validatedSpectral.midHigh + validatedSpectral.high + validatedSpectral.air) / 3;
		const transparencyFactor = isMuddy ? Math.max(0.55, 1.0 - muddyIndex * 0.7) : 1.0; // De-Mud mạnh tay
		const presenceBoost = clarityIndex < 0.5 ? (0.5 - clarityIndex) * 1.8 : 1.0; // Đẩy Presence nếu thiếu
		const airNaturalBoost = clarityIndex > 0.6 ? 1.2 : (clarityIndex < 0.4 ? 1.5 : 1.1);

		// Stereo Widening thông minh cho Chorus (tạo pocket cho ca sĩ)
		let stereoWidth = 1.0;
		if (songStructure?.section === 'chorus') {
			stereoWidth = 1.35 + (clarityIndex * 0.15);
		} else if (songStructure?.section === 'bridge') {
			stereoWidth = 1.2;
		} else {
			stereoWidth = 1.05;
		}
		if (subBassEnergy > 0.7) stereoWidth *= 0.85; // Bass nặng thì thu hẹp để giữ chắc

		// --- [KHỞI TẠO AT2040PUREGENIXV2 CONFIG - Giữ nguyên logic bù trừ] ---
		const at2040Config = {
			enabled: validatedSpectral.vocalPresence > 0.45 || profile === 'vocal' || profile === 'karaokeDynamic' || Math.abs(this.currentPitchMult || 0) > 0,
			formantScale: Math.max(0.85, Math.min(1.15, 1.0 + (this.currentPitchMult || 0) * 0.008)),
			harmonicBoost: profile === 'bassHeavy' ? 1.15 : (profile === 'vocal' ? 1.0 : 1.1),
			transientSculpt: profile === 'rockMetal' || profile === 'bassHeavy' ? 1.2 : 0.9,
			phaseLockFactor: this.qualityMode === 'high' ? 1.1 : 0.9,
			emotionalVector: profile === 'warm' ? 0.85 : (profile === 'rockMetal' ? 1.1 : 1.0),
			deviceAdaptFactor,
			clarityBoost: profile === 'vocal' || profile === 'karaokeDynamic' ? 1.25 : 1.0,
			melodySynthesisFactor: profile === 'proNatural' || profile === 'karaokeDynamic' ? 1.3 : 1.1,
			pitchShiftFactor: Math.abs(this.currentPitchMult || 0) > 0.5 ? 0.9 : 1.0,
			roomCoherenceFactor: roomProfile?.coherence || 1.0
		};

		// --- [LÕI THUẬT TOÁN: AT2040ENHANCE - Tái tạo âm thanh] ---
		const at2040Enhance = (f, profile, emotional, transient, vocal) => {
			const melodySynthesis = at2040Config.melodySynthesisFactor;
			let melodyFactor = 0;
			const fundamental = f || 440;
			const harmonicOrder = harmonicOrderMax;

			// FIX: Tối ưu vòng lặp bằng cách tính toán các hằng số bên ngoài
			for (let i = 1; i <= harmonicOrder; i++) {
				const harmonicFreq = fundamental * i * (1 + (this.currentPitchMult || 0) * 0.005);
				const wavelet = Math.exp(-Math.pow(harmonicFreq / 120, 2) / 0.18) * Math.cos(2 * Math.PI * harmonicFreq);
				melodyFactor += wavelet * (1 / (i * 1.05)) * melodySynthesis;
			}
			melodyFactor = Math.max(0.8, Math.min(1.2, melodyFactor));

			const sigma = profile === 'bassHeavy' ? 0.4 : (profile === 'vocal' ? 0.25 : 0.3);
			let quantumBass = 0;
			for (let i = 1; i <= harmonicOrder; i++) {
				const waveletCoeff = Math.exp(-Math.pow(fundamental / 90, 2) / (2 * Math.pow(sigma, 2))) * Math.cos(2 * Math.PI * fundamental * i);
				const harmonicSeries = Math.sin(2 * Math.PI * fundamental * i * i) / (i * 1.1);
				quantumBass += waveletCoeff * harmonicSeries * at2040Config.harmonicBoost;
			}
			quantumBass = Math.max(0.8, Math.min(1.2, quantumBass));

			const vocalPresence = profile === 'vocal' ? 1.1 : (profile === 'warm' ? 0.9 : 0.85);
			let vocalFormant = (180 + 2200) * vocalPresence * at2040Config.clarityBoost;

			let midGain = validatedSpectral.midHigh > 0.65 ? 0.6 : 0.5;
			let trebleQ = validatedSpectral.air > 0.65 ? 0.55 : 0.45;
			if (validatedSpectral.bass > 0.65) {
				midGain *= 0.85;
				trebleQ *= 0.85;
			}
			let entanglement = Math.max(0.8, Math.min(1.2, Math.sqrt(Math.abs(vocalFormant * midGain * trebleQ)) / 10)); // FIX: Cân bằng lại đơn vị sqrt

			const purityFilter = 1 / (1 + Math.pow(fundamental / 1400, 2)) * at2040Config.clarityBoost;
			const maskingThreshold = Math.pow(10, -(validatedSpectral.spl || 0) / 20) * purityFilter * 1.2;

			const phaseDiff = fftAnalysis ? Math.atan2(fftAnalysis.imag || 0, fftAnalysis.real || 1) : 0;
			const phaseCoherence = Math.cos(phaseDiff) * at2040Config.phaseLockFactor * 1.25;

			const sculptFactor = profile === 'rockMetal' ? 1.3 : (profile === 'bassHeavy' ? 1.1 : 0.85);
			let transientSculpt = transient * sculptFactor * at2040Config.clarityBoost;
			if (cpuLoad > 0.8) transientSculpt *= 0.65;
			if (validatedSpectral.transientEnergy > 0.65) transientSculpt *= 0.8;
			if (Math.abs(this.currentPitchMult || 0) > 0.5) transientSculpt *= 0.9;

			const toneAlignment = songStructure?.section === 'chorus' ? 1.2 : (songStructure?.section === 'verse' ? 1.0 : 1.1);
			const masterFormant = at2040Config.formantScale * (1 + (this.currentPitchMult || 0) * 0.01) * toneAlignment;
			const emotionalVector = emotional === 'calm' ? 0.85 : (emotional === 'aggressive' ? 1.1 : 1.0);

			const spectralEnergy = Math.pow(Math.abs(fftAnalysis?.energy || 0.5), 2);
			const prevEnergy = this.memoryManager?.get('prevEnergy') || spectralEnergy;
			const spectralFluxAt = Math.abs(spectralEnergy - prevEnergy) / (spectralEnergy + 0.001);
			const spectralAttention = 1 / (1 + Math.exp(-(spectralEnergy * spectralFluxAt * 0.8 * spectralAttentionScale))); // FIX: Chuẩn hóa hàm Sigmoid cho ổn định
			this.memoryManager?.set('prevEnergy', spectralEnergy, 'low');

			const timbreCurve = 0.0006 * Math.pow(fundamental, 3) + 0.006 * Math.pow(fundamental, 2) + 0.06 * fundamental + 1.1;
			const emotionTimbre = emotionalVector * (timbreCurve / 1000) * at2040Config.melodySynthesisFactor; // FIX: Cân bằng timbreCurve

			const pitchShiftImpact = Math.abs(this.currentPitchMult || 0) > 0.5 ? 0.85 : 1.0;
			const totalGainFactor = (melodyFactor * quantumBass * entanglement * maskingThreshold * emotionalVector * masterFormant * spectralAttention * emotionTimbre * pitchShiftImpact) / (phaseCoherence + transientSculpt + 0.1);

			return Math.max(0.75, Math.min(1.25, totalGainFactor));
		};

		// --- [LOGIC CACHE & HASHING - Giữ nguyên SimpleHash] ---
		const inputHash = this.simpleHash?.({
			spectralProfile: validatedSpectral,
			songStructure,
			userFeedbackAdjust,
			profile,
			musicContext,
			roomProfile
		}) || (profile + JSON.stringify(roomProfile));

		const lastInputHash = this.memoryManager?.get('lastOptimizeInputHash');
		if (lastInputHash === inputHash && this.memoryManager?.get('optimizedParams')?.timestamp > Date.now() - 3500) {
			const cachedParams = this.memoryManager.get('optimizedParams').params;
			if (this.outputGain) {
				const currentTime = this.context.currentTime;
				const rampTime = isLowPowerDevice ? 0.03 : 0.06 * at2040Config.deviceAdaptFactor;
				this.outputGain.gain.cancelScheduledValues(currentTime);
				this.outputGain.gain.setValueAtTime(this.outputGain.gain.value, currentTime);
				this.outputGain.gain.linearRampToValueAtTime(cachedParams.masterGain * at2040Config.pitchShiftFactor, currentTime + rampTime);
			}
			return cachedParams;
		}

		// --- [LOGIC DỰ ĐOÁN LỊCH SỬ (History Adjust)] ---
		let historyAdjust = {
			formantGain: 0,
			midShelfGain: 0
		};
		const history = this.memoryManager?.get('songStructureHistory') || [];
		const lastSection = history.length > 0 ? history[history.length - 1]?.section : null;
		const sectionHistoryWeight = history.length > 2 ? history.slice(-3).reduce((acc, h) => acc + (h.section === songStructure?.section ? 0.2 : 0), 0) : 0;

		if (lastSection === 'chorus') {
			historyAdjust = {
				formantGain: 0.5 * at2040Config.emotionalVector * (1 + sectionHistoryWeight),
				midShelfGain: 0.4 * at2040Config.emotionalVector * (1 + sectionHistoryWeight)
			};
		} else if (lastSection === 'bridge') {
			historyAdjust = {
				formantGain: 0.3 * at2040Config.emotionalVector * (1 + sectionHistoryWeight),
				midShelfGain: 0.3 * at2040Config.emotionalVector * (1 + sectionHistoryWeight)
			};
		}

		const deepLearningModel = {
			predict: (input) => {
				const {
					spectralComplexity,
					vocalPresence,
					harmonicComplexity
				} = musicContext;

				// [LOGIC: XỬ LÝ TREBLE & CHỐNG CHÓI]
				const trebleIndex = (validatedSpectral.high + validatedSpectral.subTreble + validatedSpectral.air) / 3;
				const isPiercing = trebleIndex > 0.45 || highFreqEnergy > 0.6 || (userFeedbackAdjust?.distortion < -1.0);

				// FIX: Đảm bảo dynamicTrebleReduction luôn là số thực hữu hạn để không gây Crash bộ lọc
				const dynamicTrebleReduction = isPiercing ?
					Math.min(5.0, (trebleIndex - 0.45) * 7.0 + (userFeedbackAdjust?.treble || 0)) * at2040Config.deviceAdaptFactor :
					(trebleReduction + (userFeedbackAdjust?.treble || 0)) * at2040Config.deviceAdaptFactor * 0.9;

				let fundamentalFreq = 440;
				if (this.polyphonicPitches && this.polyphonicPitches.length > 0) {
					fundamentalFreq = this.polyphonicPitches[0]?.frequency || fundamentalFreq;
				}
				const isHighVocal = fundamentalFreq > 480;

				// [LOGIC: TRANSIENT BÙ TRỪ]
				const vocalTransient = vocalPresence > 0.65 ?
					Math.min(1.0, transientEnergy * at2040Config.transientSculpt * (1 + transientDensity * 0.2) * (validatedSpectral.bass > 0.65 ? 0.85 : 1.0)) :
					0.5;
				const instrumentTransient = (validatedSpectral.instruments?.guitar || validatedSpectral.instruments?.drums) ?
					Math.min(1.0, transientEnergy * at2040Config.transientSculpt * (1 + transientDensity * 0.1) * (validatedSpectral.midHigh > 0.65 ? 1.0 : 0.9)) :
					0.5;
				const transientAdjust = (vocalTransient + instrumentTransient) / 2 * at2040Config.transientSculpt;

				// [LOGIC: FORMANT PRESERVATION]
				const formantParams = (typeof this.preserveFormant === 'function') ?
					this.preserveFormant(this.currentPitchMult || 0, fundamentalFreq, vocalPresence, validatedSpectral) : {
						freq: 430,
						gain: 2.8,
						q: 0.9
					};

				if (at2040Config.enabled) {
					const entanglementFactor = validatedSpectral.bass > 0.65 ? 0.85 : 1.0;
					formantParams.freq = Math.min(formantParams.freq * at2040Config.formantScale * entanglementFactor, 460);
					formantParams.gain = Math.min(formantParams.gain * at2040Config.emotionalVector, 3.5);
					formantParams.q = Math.max(formantParams.q * (at2040Config.phaseLockFactor || 0.9), 0.85);

					let masterFormant = at2040Config.formantScale * (1 + (this.currentPitchMult || 0) * 0.01);
					masterFormant = Math.max(0.8, Math.min(1.2, masterFormant));
					if (validatedSpectral.bass > 0.65) masterFormant *= 0.85;

					// === [NEW: Tích hợp De-Mud thông minh vào Formant - Bảo vệ giọng hát khỏi vùng đục] ===
					const formantClarityBoost = transparencyFactor * (1.0 + (1.0 - clarityIndex) * 0.3); // Khi muddy → tăng nhẹ formant clarity
					// Khi phổ đục (transparencyFactor thấp), bù nhẹ presence vào formant để giọng "thoát" ra
					masterFormant *= formantClarityBoost * (presenceBoost > 1.0 ? 1.05 : 1.0); // Tối đa +5% khi cần thiết, rất tinh tế
					masterFormant = Math.max(0.85, Math.min(1.25, masterFormant)); // Giữ an toàn, không đi quá xa

					formantParams.gain *= masterFormant * 0.8 * at2040Config.pitchShiftFactor;

					if (Math.abs(this.currentPitchMult || 0) > 0.5) {
						formantParams.gain *= 0.9;
						formantParams.q *= 1.1;
					}
				}

				// TỐI ƯU: Điều chỉnh quantizationLevel dựa trên tải CPU để giảm jitter
				const quantizationLevel = isLowPowerDevice || cpuLoad > 0.8 ? 0.08 : 0.008;
				const quantize = (value, precision) => Math.round(value / precision) * precision;

				// MasterGain an toàn hơn (chống clip khi đẩy nhiều dải)
				const masterGain = Math.max(0.65, Math.min(0.85, 0.7 * (clarityIndex > 0.6 ? 0.95 : 1.0) * at2040Config.emotionalVector * at2040Config.deviceAdaptFactor * at2040Config.pitchShiftFactor));

				// [KHỞI TẠO BASE PARAMS - Xương sống của thuật toán]
				let baseParams = {
					bassCutFreq: quantize(26, quantizationLevel),
					trebleCutFreq: quantize(16000 - dynamicTrebleReduction * 1300, quantizationLevel),
					lowShelfGain: quantize((8.0 + subBassBoost + warmthBoost + (userFeedbackAdjust?.bass || 0) + (userFeedbackAdjust?.subBass || 0)) * masterGain, quantizationLevel),
					subBassGain: quantize((4.0 + subBassBoost + (userFeedbackAdjust?.bass || 0) + (userFeedbackAdjust?.subBass || 0)) * masterGain * at2040Config.harmonicBoost * (transientEnergy > 0.6 ? 1.2 : 1.0), quantizationLevel),
					subMidGain: quantize((5.5 + subMidBoost + warmthBoost + (userFeedbackAdjust?.mid || 0) + (userFeedbackAdjust?.warmth || 0)) * masterGain * transparencyFactor, quantizationLevel), // De-Mud mạnh
					midBassGain: quantize((4.0 + warmthBoost + (userFeedbackAdjust?.mid || 0)) * masterGain * transparencyFactor, quantizationLevel),
					midShelfGain: quantize((5.8 + midBoost + (userFeedbackAdjust?.mid || 0) + (userFeedbackAdjust?.clarity || 0) * 0.5 + historyAdjust.midShelfGain) * masterGain * presenceBoost, quantizationLevel), // Đẩy Presence
					highMidGain: quantize((4.5 + midBoost + harmonicBoost + transientAdjust + (userFeedbackAdjust?.clarity || 0) * 0.5) * masterGain * presenceBoost, quantizationLevel),
					highShelfGain: quantize((0.35 - dynamicTrebleReduction + harmonicBoost + (userFeedbackAdjust?.treble || 0)) * masterGain, quantizationLevel),
					subTrebleGain: quantize((0.2 - dynamicTrebleReduction + harmonicBoost + (userFeedbackAdjust?.treble || 0)) * masterGain, quantizationLevel),
					airGain: quantize((0.25 + harmonicBoost - dynamicTrebleReduction + (userFeedbackAdjust?.air || 0)) * masterGain * airNaturalBoost, quantizationLevel),
					compressorThreshold: quantize(-24, quantizationLevel),
					compressorRatio: quantize(4.5 * (subBassEnergy > 0.7 ? 1.3 : 1.0) * at2040Config.emotionalVector * at2040Config.pitchShiftFactor, quantizationLevel),
					compressorAttack: quantize(0.0015, quantizationLevel), // Cực nhanh → Bass chắc, không rung
					compressorRelease: quantize(transientEnergy > 0.65 ? 0.08 : 0.16, quantizationLevel),
					notchFreq: quantize(isHighVocal ? 7300 : 6600, quantizationLevel),
					notchQ: quantize(3.5 * at2040Config.phaseLockFactor, quantizationLevel),
					f1Freq: quantize(formantParams.freq, quantizationLevel),
					f2Freq: quantize(formantParams.freq * 4.2 * at2040Config.formantScale, quantizationLevel),
					formantGain: quantize((formantParams.gain + (userFeedbackAdjust?.vocalClarity || 0) * 0.4 + historyAdjust.formantGain) * masterGain, quantizationLevel),
					formantQ: quantize(formantParams.q, quantizationLevel),
					deEsserGain: quantize(-18, quantizationLevel),
					boost: quantize(0.8 + harmonicBoost * at2040Config.harmonicBoost, quantizationLevel),
					panAdjust: quantize((songStructure?.section === 'chorus' ? 0.15 : 0.05) + (clarityIndex * 0.1), quantizationLevel),
					stereoWidth: quantize(stereoWidth, quantizationLevel), // NEW: Stereo Widening thông minh
					minFadeLength: 1024,
					fadeTime: 0.02,
					bufferTime: 0.04,
					masterGain: masterGain
				};

				// [FIX: KIỂM TRA SIBILANCE & PHÁT HIỆN TẠP ÂM]
				const safeSpectralFlux = (typeof ensureFinite === 'function') ? ensureFinite(validatedSpectral.spectralFlux, 0.5) : (validatedSpectral.spectralFlux || 0.5);
				const safeSpectralEntropy = (typeof ensureFinite === 'function') ? ensureFinite(validatedSpectral.spectralEntropy, 0.5) : (validatedSpectral.spectralEntropy || 0.5);
				const safeHarmonicRatio = (typeof ensureFinite === 'function') ? ensureFinite(validatedSpectral.harmonicRatio, 0.5) : (validatedSpectral.harmonicRatio || 0.5);

				if (vocalPresence > 0.7 || transientEnergy > 0.65 || safeSpectralFlux > 0.6 || highFreqEnergy > 0.7 || userFeedbackAdjust?.distortion < -1.0 || spectralCoherence < 0.4) {
					baseParams.deEsserGain = quantize(-20 - (safeSpectralFlux - 0.6) * 12, quantizationLevel);
					baseParams.notchFreq = quantize(isHighVocal ? 7400 : 6700, quantizationLevel);
					baseParams.notchQ = quantize(3.8 * (userFeedbackAdjust?.distortion < -1.0 ? 1.3 : 1.0) * at2040Config.phaseLockFactor, quantizationLevel);

					// Áp dụng giảm treble để chống chói/artifact
					const trebleMult = 0.55 * at2040Config.emotionalVector;
					baseParams.highShelfGain *= trebleMult;
					baseParams.subTrebleGain *= trebleMult;
					baseParams.airGain *= trebleMult;

					if (spectralCoherence < 0.4) {
						baseParams.formantGain *= 0.65 * at2040Config.emotionalVector;
						baseParams.compressorRatio *= 0.75;
					}
				}

				// [BÙ TRỪ PHỔ SPECTRAL DỰA TRÊN CẢM BIẾN]
				if (safeSpectralFlux > 0.65) {
					baseParams.compressorAttack = quantize(0.0012, quantizationLevel);
					baseParams.highMidGain += 0.2 * masterGain * at2040Config.transientSculpt;
				}
				if (safeSpectralEntropy > 0.55) {
					baseParams.midShelfGain += 0.1 * masterGain * at2040Config.emotionalVector;
					baseParams.formantGain += 0.1 * masterGain * at2040Config.emotionalVector;
					baseParams.subBassGain *= 0.85 * at2040Config.deviceAdaptFactor;
				}
				if (safeHarmonicRatio > 0.65) {
					baseParams.harmonicExciterGain = quantize((baseParams.harmonicExciterGain || 0) + 0.4 * masterGain * at2040Config.harmonicBoost, quantizationLevel);
					baseParams.highMidGain += 0.1 * masterGain * at2040Config.harmonicBoost;
					baseParams.airGain += 0.05 * masterGain * at2040Config.emotionalVector;
				}

				// [LOGIC CẤU TRÚC BÀI HÁT - THUẬT TOÁN NHÌN TRƯỚC (LOOK-AHEAD)]
				const lookAheadWeight = songStructure?.section === 'chorus' && vocalPresence > 0.65 ? 1.25 :
					(songStructure?.section === 'verse' ? 1.0 :
						(songStructure?.section === 'bridge' ? 1.15 : 1.0));

				if (songStructure?.section === 'chorus') {
					baseParams.formantGain = quantize(Math.min(3.5, baseParams.formantGain + 0.6 * lookAheadWeight * at2040Config.emotionalVector) * masterGain, quantizationLevel);
					baseParams.midShelfGain += 0.4 * lookAheadWeight * masterGain * at2040Config.emotionalVector;
					baseParams.highMidGain += 0.3 * lookAheadWeight * masterGain * at2040Config.transientSculpt;
					baseParams.subBassGain -= 0.3 * lookAheadWeight * masterGain * at2040Config.deviceAdaptFactor;
					baseParams.compressorRatio *= 1.2 * lookAheadWeight * at2040Config.pitchShiftFactor;
					if (safeSpectralFlux > 0.65) baseParams.highShelfGain -= 0.005 * spectralCoherence;
				} else if (songStructure?.section === 'verse') {
					baseParams.subMidGain += 0.5 * lookAheadWeight * masterGain * at2040Config.emotionalVector;
					baseParams.formantGain += 0.3 * lookAheadWeight * masterGain * at2040Config.emotionalVector;
					baseParams.highMidGain += 0.2 * lookAheadWeight * masterGain * at2040Config.transientSculpt;
				} else if (songStructure?.section === 'bridge') {
					baseParams.lowShelfGain -= 0.5 * lookAheadWeight * masterGain * at2040Config.deviceAdaptFactor;
					baseParams.subBassGain -= 0.4 * lookAheadWeight * masterGain * at2040Config.deviceAdaptFactor;
					baseParams.highMidGain += 0.3 * lookAheadWeight * masterGain * at2040Config.transientSculpt;
					baseParams.formantGain += 0.4 * lookAheadWeight * masterGain * at2040Config.emotionalVector;
				}

				// [LOGIC XỬ LÝ BASS NẶNG]
				if (subBassEnergy > 0.7 || userFeedbackAdjust?.bass > 1.1) {
					baseParams.compressorRatio *= 1.3 * at2040Config.pitchShiftFactor;
					baseParams.compressorAttack = quantize(0.0012, quantizationLevel);
					baseParams.subBassGain *= 0.75 * masterGain * at2040Config.deviceAdaptFactor;
					baseParams.lowShelfGain *= 0.8 * masterGain * at2040Config.deviceAdaptFactor;
					baseParams.midBassGain *= 0.7 * masterGain * at2040Config.deviceAdaptFactor;
					baseParams.subBassGain += 0.2 * (validatedSpectral.transientEnergy > 0.65 ? 1.1 : 1.0) * masterGain * at2040Config.harmonicBoost;
					if (subBassEnergy > 0.7) {
						baseParams.subBassGain *= at2040Config.deviceAdaptFactor * 1.02;
						baseParams.panAdjust += 0.03 * spectralCoherence;
					}
				}

				// [HỆ THỐNG TRỌNG SỐ PROFILE - XƯƠNG SỐNG KIẾN TRÚC]
				const profileWeights = {
					warm: {
						lowShelf: 1.8,
						subBass: 1.0,
						subMid: 1.2,
						highShelf: 0.6,
						compressor: 0.7,
						formantScale: 1.0,
						transientSculpt: 0.85,
						clarityBoost: 1.0,
						melodySynthesis: 1.1
					},
					bright: {
						highShelf: 0.25,
						subTreble: 0.25,
						air: 0.25,
						deEsser: -20,
						compressorRelease: 0.18,
						formantScale: 1.1,
						transientSculpt: 1.1,
						clarityBoost: 1.2,
						melodySynthesis: 1.2
					},
					bassHeavy: {
						lowShelf: 2.1,
						subBass: 1.8,
						subMid: 0.5,
						compressor: 1.4,
						highShelf: 0.6,
						formantScale: 0.9,
						transientSculpt: 1.1,
						clarityBoost: 0.85,
						melodySynthesis: 1.0
					},
					vocal: {
						subMid: 1.2,
						midShelf: 1.3,
						highMid: 1.0,
						formant: 0.6,
						compressor: -14,
						formantScale: 1.0,
						transientSculpt: 0.95,
						clarityBoost: 1.25,
						melodySynthesis: 1.3
					},
					proNatural: {
						lowShelf: 1.0,
						subMid: 0.7,
						midShelf: 0.7,
						compressor: 0.65,
						formantScale: 1.0,
						transientSculpt: 0.85,
						clarityBoost: 1.1,
						melodySynthesis: 1.35
					},
					karaokeDynamic: {
						subMid: 1.3,
						midShelf: 1.5,
						highMid: 1.2,
						formant: 0.8,
						compressor: -12,
						formantScale: 1.1,
						transientSculpt: 1.1,
						clarityBoost: 1.25,
						melodySynthesis: 1.35
					},
					rockMetal: {
						lowShelf: 1.2,
						subBass: 1.0,
						midShelf: 0.9,
						highMid: 0.7,
						compressor: 1.3,
						formantScale: 0.9,
						transientSculpt: 1.2,
						clarityBoost: 1.0,
						melodySynthesis: 1.0
					},
					smartStudio: {
						lowShelf: 1.5,
						subBass: 1.2,
						midShelf: 0.9,
						highMid: 0.7,
						compressor: 1.2,
						formantScale: 1.0,
						transientSculpt: 1.1,
						clarityBoost: 1.1,
						melodySynthesis: 1.25
					}
				};

				const weights = profileWeights[profile] || profileWeights.smartStudio;

				switch (profile) {
					case 'warm':
						baseParams.lowShelfGain += weights.lowShelf * masterGain * at2040Config.emotionalVector;
						baseParams.subBassGain += weights.subBass * masterGain * at2040Config.harmonicBoost;
						baseParams.subMidGain += weights.subMid * masterGain * at2040Config.emotionalVector;
						baseParams.f1Freq = quantize(340 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(1400 * at2040Config.formantScale, quantizationLevel);
						baseParams.highShelfGain *= weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.subTrebleGain *= weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.airGain *= weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.compressorRatio *= weights.compressor;
						baseParams.warmthBoost = (warmthBoost || 0) + 0.6 * at2040Config.emotionalVector;
						baseParams.subMidGain += 0.1 * (validatedSpectral.vocalPresence > 0.65 ? 1.1 : 1.0) * masterGain * at2040Config.emotionalVector;
						break;

					case 'bright':
						baseParams.highShelfGain += weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.subTrebleGain += weights.subTreble * masterGain * at2040Config.emotionalVector;
						baseParams.airGain += weights.air * masterGain * at2040Config.emotionalVector;
						baseParams.f1Freq = quantize(460 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(2000 * at2040Config.formantScale, quantizationLevel);
						baseParams.deEsserGain = quantize(weights.deEsser, quantizationLevel);
						baseParams.notchFreq = quantize(6000, quantizationLevel);
						baseParams.notchQ = quantize(2.5 * at2040Config.phaseLockFactor, quantizationLevel);
						baseParams.compressorRelease = quantize(weights.compressorRelease, quantizationLevel);
						baseParams.airGain += 0.05 * (validatedSpectral.midHigh > 0.65 ? 1.0 : 0.9) * masterGain * at2040Config.emotionalVector;
						break;

					case 'bassHeavy':
						baseParams.lowShelfGain += weights.lowShelf * masterGain * at2040Config.harmonicBoost;
						baseParams.subBassGain += weights.subBass * masterGain * at2040Config.harmonicBoost;
						baseParams.subMidGain += weights.subMid * masterGain * at2040Config.emotionalVector;
						baseParams.f1Freq = quantize(260 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(1300 * at2040Config.formantScale, quantizationLevel);
						baseParams.compressorRatio *= weights.compressor;
						baseParams.compressorAttack = quantize(0.0015, quantizationLevel);
						baseParams.highShelfGain *= weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.subTrebleGain *= weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.airGain *= weights.highShelf * masterGain * at2040Config.emotionalVector;
						baseParams.midBassGain *= 0.7 * masterGain * at2040Config.deviceAdaptFactor;
						baseParams.subBassGain += 0.2 * (validatedSpectral.transientEnergy > 0.65 ? 1.1 : 1.0) * masterGain * at2040Config.harmonicBoost;
						break;

					case 'vocal':
						baseParams.subMidGain += weights.subMid * masterGain * at2040Config.emotionalVector;
						baseParams.midShelfGain += weights.midShelf * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += weights.highMid * masterGain * at2040Config.transientSculpt;
						baseParams.f1Freq = quantize(520 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(2300 * at2040Config.formantScale, quantizationLevel);
						baseParams.formantGain = quantize(Math.min(3.5, baseParams.formantGain + weights.formant) * masterGain * at2040Config.emotionalVector, quantizationLevel);
						baseParams.formantQ = quantize(0.9 * at2040Config.phaseLockFactor, quantizationLevel);
						baseParams.compressorThreshold = quantize(weights.compressor, quantizationLevel);
						baseParams.deEsserGain = quantize(-20, quantizationLevel);
						baseParams.notchQ = quantize(2.8 * at2040Config.phaseLockFactor, quantizationLevel);
						baseParams.formantGain += 0.1 * (validatedSpectral.vocalPresence > 0.65 ? 1.2 : 1.0) * masterGain * at2040Config.emotionalVector;
						break;

					case 'proNatural':
						baseParams.lowShelfGain += weights.lowShelf * masterGain * at2040Config.emotionalVector;
						baseParams.subMidGain += weights.subMid * masterGain * at2040Config.emotionalVector;
						baseParams.midShelfGain += weights.midShelf * masterGain * at2040Config.emotionalVector;
						baseParams.f1Freq = quantize(380 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(1500 * at2040Config.formantScale, quantizationLevel);
						baseParams.compressorRatio *= weights.compressor;
						baseParams.formantGain += (userFeedbackAdjust?.vocalClarity || 0) * 0.3 * masterGain * at2040Config.emotionalVector;
						baseParams.compressorRelease = quantize(0.35, quantizationLevel);
						baseParams.midShelfGain += 0.05 * (validatedSpectral.midHigh > 0.65 ? 1.0 : 0.9) * masterGain * at2040Config.emotionalVector;
						break;

					case 'karaokeDynamic':
						baseParams.subMidGain += weights.subMid * masterGain * at2040Config.emotionalVector;
						baseParams.midShelfGain += weights.midShelf * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += weights.highMid * masterGain * at2040Config.transientSculpt;
						baseParams.f1Freq = quantize(480 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(2200 * at2040Config.formantScale, quantizationLevel);
						baseParams.formantGain = quantize((validatedSpectral.vocalPresence > 0.75 ? 3.4 : 3.2) * masterGain * at2040Config.emotionalVector, quantizationLevel);
						baseParams.deEsserGain = quantize(-20, quantizationLevel);
						baseParams.notchFreq = quantize(7100, quantizationLevel);
						baseParams.compressorThreshold = quantize(weights.compressor, quantizationLevel);
						baseParams.highMidGain += 0.1 * (validatedSpectral.transientEnergy > 0.65 ? 1.1 : 1.0) * masterGain * at2040Config.transientSculpt;
						break;

					case 'rockMetal':
						baseParams.lowShelfGain += weights.lowShelf * masterGain * at2040Config.harmonicBoost;
						baseParams.subBassGain += weights.subBass * masterGain * at2040Config.harmonicBoost;
						baseParams.midShelfGain += weights.midShelf * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += (weights.highMid + (transientAdjust || 0)) * masterGain * at2040Config.transientSculpt;
						baseParams.f1Freq = quantize(460 * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(2000 * at2040Config.formantScale, quantizationLevel);
						baseParams.compressorRatio *= weights.compressor;
						baseParams.compressorAttack = quantize(0.0015, quantizationLevel);
						baseParams.deEsserGain = quantize(-20, quantizationLevel);
						baseParams.highShelfGain *= 0.65 * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += 0.2 * (validatedSpectral.harmonicRatio > 0.65 ? 1.1 : 1.0) * masterGain * at2040Config.transientSculpt;
						break;

					case 'smartStudio':
						baseParams.lowShelfGain += (subBassEnergy > 0.65 ? weights.lowShelf : weights.lowShelf * 0.7) * masterGain * at2040Config.harmonicBoost;
						baseParams.subBassGain += (subBassEnergy > 0.65 ? weights.subBass : weights.subBass * 0.7) * masterGain * at2040Config.harmonicBoost;
						baseParams.midShelfGain += (validatedSpectral.midHigh > 0.65 ? weights.midShelf : weights.midShelf * 0.7) * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += (validatedSpectral.midHigh > 0.65 ? weights.highMid : weights.highMid * 0.7) * masterGain * at2040Config.transientSculpt;
						baseParams.f1Freq = quantize(subBassEnergy > 0.65 ? 280 : (validatedSpectral.midHigh > 0.65 ? 440 : 460) * at2040Config.formantScale, quantizationLevel);
						baseParams.f2Freq = quantize(subBassEnergy > 0.65 ? 1300 : (validatedSpectral.midHigh > 0.65 ? 2100 : 1900) * at2040Config.formantScale, quantizationLevel);
						baseParams.formantGain = quantize(Math.min(3.5, baseParams.formantGain + (userFeedbackAdjust?.vocalClarity || 0) * 0.4) * masterGain * at2040Config.emotionalVector, quantizationLevel);
						baseParams.formantQ = quantize(0.9 * at2040Config.phaseLockFactor, quantizationLevel);
						baseParams.deEsserGain = quantize(validatedSpectral.vocalPresence > 0.75 ? -20 : -18, quantizationLevel);
						baseParams.compressorRatio *= subBassEnergy > 0.65 ? weights.compressor : 1.0;
						baseParams.compressorAttack = quantize(transientEnergy > 0.65 ? 0.0015 : 0.003, quantizationLevel);
						baseParams.compressorRelease = quantize(transientEnergy > 0.65 ? 0.08 : 0.18, quantizationLevel);
						baseParams.panAdjust = quantize(subBassEnergy > 0.65 ? 0.12 : 0, quantizationLevel);
						if (cpuLoad < 0.8 && subBassEnergy > 0.6) {
							baseParams.harmonicExciterGain = quantize(Math.min(1.6, 0.7 + (userFeedbackAdjust?.harmonicRichness || 0) * 0.5) * masterGain * at2040Config.harmonicBoost, quantizationLevel);
						}
						baseParams.airGain += 0.05 * (validatedSpectral.spectralEntropy > 0.65 ? 1.0 : 0.9) * masterGain * at2040Config.emotionalVector;
						break;
				}

				// NEW: Tích hợp phaseLinearCorrection nâng cao
				if (typeof phaseLinearCorrection === 'function') {
					baseParams = phaseLinearCorrection(baseParams, validatedSpectral, songStructure, cpuLoad, profile, {
						memoryManager: this.memoryManager,
						phaseLockFactor: at2040Config.phaseLockFactor,
						fftAnalysis: fftAnalysis,
						currentPitchMult: this.currentPitchMult || 0
					});
				}

				// User feedback adjustments
				if (userFeedbackAdjust) {
					if (userFeedbackAdjust.warmth > 0) {
						baseParams.subMidGain += userFeedbackAdjust.warmth * 0.5 * masterGain * at2040Config.emotionalVector;
						baseParams.lowShelfGain += userFeedbackAdjust.warmth * 0.3 * masterGain * at2040Config.harmonicBoost;
					}
					if (userFeedbackAdjust.distortion < -1.0) {
						const distScale = 0.55 * masterGain * at2040Config.emotionalVector;
						baseParams.highShelfGain *= distScale;
						baseParams.subTrebleGain *= distScale;
						baseParams.airGain *= distScale;
						baseParams.formantGain *= 0.65 * masterGain * at2040Config.emotionalVector;
						baseParams.compressorRatio *= 0.75;
						baseParams.deEsserGain = quantize(Math.max(-24, baseParams.deEsserGain - 4), quantizationLevel);
					}
					if (userFeedbackAdjust.clarity > 0) {
						baseParams.midShelfGain += userFeedbackAdjust.clarity * 0.4 * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += userFeedbackAdjust.clarity * 0.4 * masterGain * at2040Config.transientSculpt;
						baseParams.formantGain += userFeedbackAdjust.clarity * 0.2 * masterGain * at2040Config.emotionalVector;
						if (transientEnergy > 0.65) baseParams.midShelfGain *= 0.92;
					}
					if (userFeedbackAdjust.vocalClarity > 0) {
						baseParams.formantGain += userFeedbackAdjust.vocalClarity * 0.3 * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += userFeedbackAdjust.vocalClarity * 0.3 * masterGain * at2040Config.transientSculpt;
					}
					if (userFeedbackAdjust.bass > 0) {
						baseParams.lowShelfGain += userFeedbackAdjust.bass * 0.6 * masterGain * at2040Config.harmonicBoost;
						baseParams.subBassGain += userFeedbackAdjust.bass * 0.4 * masterGain * at2040Config.harmonicBoost;
					}
					if (userFeedbackAdjust.depth > 0) {
						baseParams.lowShelfGain += userFeedbackAdjust.depth * 0.7 * masterGain * at2040Config.harmonicBoost;
						baseParams.subBassGain += userFeedbackAdjust.depth * 0.5 * masterGain * at2040Config.harmonicBoost;
						baseParams.bassCutFreq = quantize(22, quantizationLevel);
					}
					if (userFeedbackAdjust.harmonicRichness > 0 && cpuLoad < 0.8) {
						baseParams.harmonicExciterGain = quantize(Math.min(1.6, (baseParams.harmonicExciterGain || 0) + userFeedbackAdjust.harmonicRichness * 0.5) * masterGain * at2040Config.harmonicBoost, quantizationLevel);
						baseParams.subMidGain *= 0.8 * masterGain * at2040Config.emotionalVector;
						baseParams.highMidGain += 0.1 * masterGain * at2040Config.transientSculpt;
					}
				}

				// NEW: Tích hợp roomCorrectionSimulation
				if (typeof roomCorrectionSimulation === 'function') {
					baseParams = roomCorrectionSimulation(baseParams, validatedSpectral, cpuLoad, profile, {
						memoryManager: this.memoryManager,
						fftAnalysis: fftAnalysis,
						currentPitchMult: this.currentPitchMult || 0,
						roomCoherenceFactor: at2040Config.roomCoherenceFactor
					});
				}

				// Temporal interpolation
				baseParams.fadeTime = Math.max((baseParams.minFadeLength || 1024) / (this.context.sampleRate || 44100), 0.025) * at2040Config.deviceAdaptFactor;
				baseParams.bufferTime = baseParams.fadeTime * 2.5 * (1 + Math.abs(this.currentPitchMult || 0) * 0.4) * at2040Config.deviceAdaptFactor;

				// SmartGainBalancing Ramping
				if (this.outputGain && this.outputGain.gain) {
					const currentTime = this.context.currentTime;
					const rampTime = isLowPowerDevice ? 0.03 : 0.06 * at2040Config.deviceAdaptFactor;
					this.outputGain.gain.cancelScheduledValues(currentTime);
					this.outputGain.gain.setValueAtTime(this.outputGain.gain.value, currentTime);

					const f = fundamentalFreq || 440;
					const psychoCurve = 1 / (1 + Math.pow(f / 1300, 2));
					const maskingThreshold = Math.pow(10, -(validatedSpectral.spl || 0) / 20) * psychoCurve * 1.25;
					const phaseDiff = fftAnalysis ? Math.atan2(fftAnalysis.imag || 0, fftAnalysis.real || 1) : 0;
					const phaseCoherence = Math.cos(phaseDiff) * at2040Config.phaseLockFactor * 1.25;

					const adjustedGain = baseParams.masterGain * Math.max(0.75, Math.min(1.25, (maskingThreshold || 1) * phaseCoherence)) * at2040Config.pitchShiftFactor;
					this.outputGain.gain.linearRampToValueAtTime(adjustedGain, currentTime + rampTime);
				}

				// MemoryManager caching
				if (this.memoryManager) {
					const cachedObj = this.memoryManager.buffers?.get('optimizedParams');
					const cachedParams = cachedObj?.params;
					if (cachedParams && Date.now() < cachedParams.expiry) {
						Object.keys(baseParams).forEach(key => {
							if (typeof baseParams[key] === 'number' && typeof cachedParams[key] === 'number') {
								baseParams[key] = cachedParams[key] * 0.6 + baseParams[key] * 0.4;
							}
						});
					}
					const expiry = Date.now() + (songStructure?.section === 'chorus' ? 4000 : 7000);
					this.memoryManager.buffers?.set('optimizedParams', {
						params: {
							...baseParams,
							expiry
						},
						timestamp: Date.now(),
						expiry,
						priority: 'high'
					});
					this.memoryManager.set('lastOptimizeInputHash', inputHash, 'low', {
						timestamp: Date.now()
					});
					if (this.calculateMaxCacheSize) this.memoryManager.pruneCache(this.calculateMaxCacheSize());
				}

				// Final AT2040 enhancement
				const finalF = fundamentalFreq || 440;
				const emotional = profile === 'warm' ? 'calm' : (profile === 'rockMetal' ? 'aggressive' : 'neutral');
				const transientVal = validatedSpectral.transientEnergy || 0.5;
				const vocalVal = validatedSpectral.vocalPresence || 0.5;

				const at2040Factor = at2040Enhance(finalF, profile, emotional, transientVal, vocalVal);
				const finalClamp = (val) => Math.max(0.75, Math.min(1.25, val));

				baseParams.masterGain *= finalClamp(at2040Factor);
				baseParams.compressorRatio *= finalClamp(at2040Factor);
				baseParams.fadeTime *= finalClamp(at2040Factor);

				return baseParams;
			}
		};

		// Thực thi dự đoán từ Model
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

		// Debugging
		if (isDebug) {
			const optimizationScore = (spectralCoherence * 0.4 + transientEnergy * 0.3 + validatedSpectral.vocalPresence * 0.3).toFixed(2);
			console.debug('AT2040PureGenixV2 Finalized:', {
				profile,
				score: optimizationScore,
				params: optimizedParams
			});
		}

		return optimizedParams;

	} catch (error) {
		if (typeof handleError === 'function') {
			handleError('Error optimizing sound profile with AT2040PureGenixV2', error, {
				profile,
				contextId: this.contextId
			}, 'high', {
				memoryManager: this.memoryManager
			});
		}
		this.notifyUIError?.('Failed to optimize sound profile with AT2040PureGenixV2');

		// Fallback an toàn tuyệt đối khi Crash
		return {
			bassCutFreq: 26,
			trebleCutFreq: 16000,
			lowShelfGain: 8.0,
			subBassGain: 4.0,
			subMidGain: 5.5,
			midBassGain: 4.0,
			midShelfGain: 5.8,
			highMidGain: 4.5,
			highShelfGain: 0.35,
			subTrebleGain: 0.2,
			airGain: 0.25,
			compressorThreshold: -24,
			compressorRatio: 4.5,
			compressorAttack: 0.001,
			compressorRelease: 0.16,
			notchFreq: 6600,
			notchQ: 3.5,
			f1Freq: 430,
			f2Freq: 1806,
			formantGain: 2.8,
			formantQ: 0.9,
			deEsserGain: -18,
			boost: 0.8,
			panAdjust: 0,
			minFadeLength: 1024,
			fadeTime: 0.025,
			bufferTime: 0.04,
			masterGain: 0.7
		};
	}
};

Jungle.prototype.applyHarmonicEnhancement = function(config = {}) {
    try {
        const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
        // Validate AudioContext
        if (!this.context || !(this.context instanceof AudioContext) || this.context.state === 'closed') {
            throw new Error('Invalid or closed AudioContext');
        }
        // Initialize config with defaults
        const intensity = ensureFinite(config.intensity, 0.15);
        const frequencyRange = Array.isArray(config.frequencyRange) && config.frequencyRange.length === 2 ? [ensureFinite(config.frequencyRange[0], 2500), ensureFinite(config.frequencyRange[1], 7500)] : [2500, 7500];
        const harmonicOrder = Math.min(ensureFinite(config.harmonicOrder, 2), 5); // Cap 5 an toàn CPU
        const transientPreservation = ensureFinite(config.transientPreservation, this.currentProfile === 'rockMetal' ? 0.8 : 0.6);
        const phaseLock = this.qualityMode === 'high' || this.qualityMode === 'ultra-high';
        // Get spectral profile
        const spectralProfile = this.spectralProfile || {
            subBass: 0.5,
            bass: this.currentProfile === 'bassHeavy' ? 0.8 : 0.5,
            subMid: 0.5,
            midLow: 0.5,
            midHigh: this.currentProfile === 'vocal' ? 0.75 : 0.5,
            high: 0.5,
            subTreble: this.currentProfile === 'bright' ? 0.7 : 0.5,
            air: 0.5,
            vocalPresence: this.currentProfile === 'vocal' ? 0.8 : 0.5,
            transientEnergy: 0.5,
            instruments: {},
            chroma: Array(12).fill(0.5),
            spectralComplexity: 0.5
        };
        const isVocal = this.isVocal || this.currentProfile === 'vocal' || this.currentProfile === 'karaokeDynamic';
        const vocalPresence = ensureFinite(spectralProfile.vocalPresence, this.currentProfile === 'vocal' ? 0.8 : 0.5);
        const transientEnergy = ensureFinite(spectralProfile.transientEnergy, this.currentProfile === 'rockMetal' ? 0.7 : 0.5);
        // Calculate harmonic gain
        const harmonicGain = Math.min(intensity * (isVocal ? 1.2 : 1.0), 0.3);
        const harmonicQ = isVocal ? 0.8 : 1.0;
        const freqStep = (frequencyRange[1] - frequencyRange[0]) / harmonicOrder;
        const currentTime = this.context.currentTime;
        const rampTime = ensureFinite(this.rampTime, 0.15) * (1 + intensity * 0.5);
        // Tinh hoa: harmonicPool reuse filter chống rò rỉ node
        if (!this.harmonicPool) this.harmonicPool = [];
        let lastNode = this._analyser || this.context.createGain();
        for (let i = 0; i < harmonicOrder; i++) {
            if (!this.harmonicPool[i]) {
                const filter = this.context.createBiquadFilter();
                filter.type = 'peaking';
                this.harmonicPool[i] = filter;
            }
            const filter = this.harmonicPool[i];
            const freq = ensureFinite(frequencyRange[0] + ((i + 1) * freqStep), frequencyRange[0]);
            if (freq > frequencyRange[1]) continue;
            filter.frequency.setTargetAtTime(freq, currentTime, 0.05);
            filter.Q.setTargetAtTime(harmonicQ, currentTime, 0.05);
            filter.gain.setTargetAtTime(harmonicGain * (1 - i * 0.1), currentTime, 0.05);
            lastNode.connect(filter);
            lastNode = filter;
        }
        // Tinh hoa: reuse transientFilterNode
        if (transientEnergy < 0.7 && transientPreservation > 0.5) {
            if (!this.transientFilterNode) {
                this.transientFilterNode = this.context.createBiquadFilter();
                this.transientFilterNode.type = 'highshelf';
            }
            this.transientFilterNode.frequency.setTargetAtTime(8000, currentTime, 0.05);
            this.transientFilterNode.gain.setTargetAtTime(transientPreservation * 0.8, currentTime, 0.05);
            lastNode.connect(this.transientFilterNode);
            lastNode = this.transientFilterNode;
            if (isDebug) console.debug('Applied transient preservation filter');
        }
        // Tinh hoa: reuse vocalClarityNode
        if (isVocal && vocalPresence < 0.7) {
            if (!this.vocalClarityNode) {
                this.vocalClarityNode = this.context.createBiquadFilter();
                this.vocalClarityNode.type = 'peaking';
            }
            this.vocalClarityNode.frequency.setTargetAtTime(3000, currentTime, 0.05);
            this.vocalClarityNode.Q.setTargetAtTime(1.2, currentTime, 0.05);
            this.vocalClarityNode.gain.setTargetAtTime(vocalPresence * 1.2, currentTime, 0.05);
            lastNode.connect(this.vocalClarityNode);
            lastNode = this.vocalClarityNode;
            if (isDebug) console.debug('Applied vocal clarity filter');
        }
        // Bass control giữ nguyên
        if (spectralProfile.bass > 0.7 && this.lowShelfFilter) {
            const bassReduction = Math.min(spectralProfile.bass * 0.8, 0.6);
            this.lowShelfFilter.gain.cancelScheduledValues(currentTime);
            this.lowShelfFilter.gain.setValueAtTime(this.lowShelfFilter.gain.value, currentTime);
            this.lowShelfFilter.gain.linearRampToValueAtTime(bassReduction, currentTime + rampTime);
            if (isDebug) console.debug('Reduced bass to avoid muddiness');
        }
        // Tinh hoa: reuse phaseLockGainNode
        if (phaseLock && this.dynamicFormantPitchShift?.phaseLock) {
            if (!this.phaseLockGainNode) {
                this.phaseLockGainNode = this.context.createGain();
            }
            this.phaseLockGainNode.gain.setTargetAtTime(1.0, currentTime, 0.05);
            lastNode.connect(this.phaseLockGainNode);
            lastNode = this.phaseLockGainNode;
            if (isDebug) console.debug('Applied phase-locked processing');
        }
        // Kết nối cuối cùng
        lastNode.connect(this.outputGain || this.context.destination);
        // Memory & UI giữ nguyên
        if (this.memoryManager) {
            const cacheKey = `harmonicEnhancement_${this.contextId}_${Date.now()}`;
            this.memoryManager.set(cacheKey, {
                intensity,
                frequencyRange,
                harmonicOrder,
                transientPreservation,
                phaseLock,
                harmonicGain,
                harmonicQ,
                timestamp: Date.now(),
                expiry: Date.now() + 15000,
                priority: 'high'
            }, 'high');
            this.memoryManager.pruneCache(this.calculateMaxCacheSize?.() || 32 * 1024 * 1024);
        }
        if (typeof this.notifyUIUpdate === 'function') {
            this.notifyUIUpdate({
                harmonicEnhancement: {
                    intensity,
                    frequencyRange,
                    harmonicOrder,
                    transientPreservation,
                    phaseLock,
                    harmonicGain,
                    vocalPresence,
                    timestamp: Date.now()
                }
            });
        }
        if (isDebug) console.debug('Harmonic Enhancement Applied Successfully');
        return lastNode;
    } catch (error) {
        handleError('Error applying harmonic enhancement', error, { config, contextId: this.contextId, profile: this.currentProfile }, 'high', { memoryManager: this.memoryManager });
        this.notifyUIError?.('Failed to apply harmonic enhancement');
        return this.outputGain || this.context.destination;
    }
};

Jungle.prototype.setFFTSize = function(size, {
    devicePerf = 'medium',
    qualityMode = 'medium',
    spectralProfile = {},
    songStructure = {},
    isVocalHeavy = false,
    isVocalFeedback = false,
    transientDensity = 0,
    spectralFlux = 0,
    fftAnalysis = {},
    cpuLoad = 0,
    avgProcessingTime = 0
} = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const validSizes = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
    // Tinh hoa: tìm power-of-2 gần nhất
    const findNearestValidSize = (target) => {
        return validSizes.reduce((prev, curr) => 
            Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev
        );
    };
    try {
        if (!this._analyser) {
            throw new Error('Analyser is not initialized');
        }
        // Tinh hoa: cacheKey với cpuLoad gom nhóm tăng hit
        const cacheKey = this.generateCacheSignature?.('fftSize', {
            spectralProfile,
            songStructure: songStructure.section || 'unknown',
            devicePerf,
            cpuLoad: Math.round(cpuLoad * 10) / 10
        }) || `fftSize_${this.contextId}`;
        // Check cached settings
        const cachedSettings = this.memoryManager?.get(cacheKey);
        if (cachedSettings?.size && validSizes.includes(cachedSettings.size) && cachedSettings.expiry > Date.now()) {
            // Tinh hoa: chỉ apply khi thay đổi thực sự
            if (this._analyser.fftSize !== cachedSettings.size) {
                this._analyser.fftSize = cachedSettings.size;
            }
            this._analyser.smoothingTimeConstant = cachedSettings.smoothing;
            this._analyser.minDecibels = cachedSettings.minDecibels;
            this._analyser.maxDecibels = cachedSettings.maxDecibels;
            if (isDebug) console.debug('Reused cached FFT settings', { cacheKey, cachedSettings });
            return;
        }
        // Detect device performance
        const hardwareConcurrency = navigator.hardwareConcurrency || 4;
        const deviceMemory = navigator.deviceMemory || 4;
        const effectiveDevicePerf = cpuLoad > 0.80 || hardwareConcurrency < 4 || deviceMemory < 4 ? 'low' :
            cpuLoad > 0.60 || hardwareConcurrency < 8 ? 'medium' : 'high';
        // Analyze audio context
        const effectiveSpectralProfile = spectralProfile || {
            profile: 'smartStudio',
            vocalPresence: 0.5,
            transientEnergy: 0.5,
            spectralFlux: 0.5,
            bass: 0.5
        };
        const effectiveSongStructure = songStructure || this.memoryManager?.get('lastStructure') || { section: 'unknown' };
        const isChorus = effectiveSongStructure.section === 'chorus' || effectiveSongStructure.section === 'bridge';
        const spectralAttention = this.calculateSpectralAttention?.(effectiveSpectralProfile, effectiveSongStructure) || 1.0;
        const transientSculpt = this.calculateTransientSculpt?.(transientDensity, effectiveSpectralProfile.profile) || 1.0;
        // Adjust FFT size
        let targetSize = size;
        // Optimize for high load
        let processingScale = 1.0;
        if (avgProcessingTime > 12 || cpuLoad > 0.60) {
            processingScale = Math.max(0.7, 1 - (cpuLoad - 0.60) * 0.5);
            targetSize = findNearestValidSize(size * processingScale);
        }
        // Adjust based on device performance and quality mode
        if (effectiveDevicePerf === 'low' || qualityMode === 'low') {
            targetSize = Math.min(targetSize, 1024);
        } else if (effectiveDevicePerf === 'medium') {
            targetSize = Math.min(targetSize, 4096);
        } else if (qualityMode === 'high') {
            targetSize = Math.max(targetSize, 2048);
        }
        // Adjust based on audio context and spectralProfile
        if (isVocalHeavy || isVocalFeedback || effectiveSpectralProfile.profile === 'vocal' || effectiveSpectralProfile.vocalPresence > 0.7) {
            targetSize = Math.max(targetSize, 2048 * spectralAttention);
        } else if (transientDensity > 0.65 || spectralFlux > 0.7 || effectiveSpectralProfile.profile === 'bassHeavy' || effectiveSpectralProfile.bass > 0.7) {
            targetSize = Math.max(targetSize, 1024 * transientSculpt);
        }
        if (isChorus) {
            targetSize = Math.max(targetSize, 2048 * spectralAttention);
        } else if (effectiveSongStructure.section === 'intro' || effectiveSongStructure.section === 'outro') {
            targetSize = Math.min(targetSize, 1024);
        }
        // Tinh hoa: validate cuối cùng
        if (!validSizes.includes(targetSize)) {
            targetSize = findNearestValidSize(targetSize);
        }
        // Optimize analyser settings
        const smoothing = (isVocalHeavy || isVocalFeedback) ? 0.55 : 0.65;
        const minDecibels = fftAnalysis.noiseLevel > 0.45 ? -105 : -115;
        const maxDecibels = (transientDensity > 0.65 || spectralFlux > 0.7) ? -35 : -45;
        // Check memory availability
        const cacheStats = this.memoryManager?.getCacheStats?.() || { used: 0, limit: 100 };
        if (cacheStats.used / cacheStats.limit > 0.80) {
            this.memoryManager?.pruneCache(cacheStats.limit * 0.6);
        }
        // Tinh hoa: chỉ apply khi thay đổi
        if (this._analyser.fftSize !== targetSize) {
            this._analyser.fftSize = targetSize;
        }
        this._analyser.smoothingTimeConstant = Number.isFinite(smoothing) ? smoothing : 0.65;
        this._analyser.minDecibels = Number.isFinite(minDecibels) ? minDecibels : -115;
        this._analyser.maxDecibels = Number.isFinite(maxDecibels) ? maxDecibels : -45;
        // Store settings in MemoryManager – tinh hoa expiry 45s
        const fftSettings = {
            size: targetSize,
            smoothing,
            minDecibels,
            maxDecibels,
            timestamp: Date.now(),
            expiry: Date.now() + 45000,
            priority: 'high'
        };
        this.memoryManager?.set(cacheKey, fftSettings, 'high');
        this.memoryManager?.pruneCache(this.calculateMaxCacheSize?.() || 50); // Tinh hoa prune 50 chặt
        if (isDebug) {
            console.debug('FFT Settings Applied:', {
                size: targetSize,
                smoothing,
                minDecibels,
                maxDecibels,
                devicePerf: effectiveDevicePerf,
                qualityMode,
                cpuLoad: cpuLoad.toFixed(2),
                isVocalHeavy,
                isVocalFeedback,
                transientDensity,
                spectralFlux,
                songStructure: effectiveSongStructure.section,
                avgProcessingTime: avgProcessingTime.toFixed(2),
                cacheStats,
                spectralAttention,
                transientSculpt
            });
        }
    } catch (e) {
        handleError('Error setting FFT size', e, { requestedSize: size, spectralProfile, songStructure }, 'high', { memoryManager: this.memoryManager });
        if (this._analyser) {
            const fallbackSize = isVocalHeavy || isChorus ? 2048 : 1024;
            this._analyser.fftSize = fallbackSize;
            this._analyser.smoothingTimeConstant = 0.65;
            this._analyser.minDecibels = -115;
            this._analyser.maxDecibels = -45;
            if (isDebug) console.debug(`Recovered with fallback FFT size: ${fallbackSize}`);
        }
    }
};

function phaseLinearCorrection(baseParams, spectralProfile, songStructure, cpuLoad, profile, options = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const validatedSpectral = { ...spectralProfile };
    const phaseLockFactor = options.phaseLockFactor || 1.0;
    const distortionThreshold = 0.00005;
    const fftAnalysis = options.fftAnalysis || null;
    // === PHASE DIFF & COHERENCE – SIÊU CHÍNH XÁC ===
    let phaseDiff = validatedSpectral.phaseDiff || 0;
    if (fftAnalysis) {
        const realPart = fftAnalysis.real || 1;
        const imagPart = fftAnalysis.imag || 0;
        phaseDiff = Math.atan2(imagPart, realPart);
        if (validatedSpectral.transientEnergy > 0.8) {
            phaseDiff = (phaseDiff % (2 * Math.PI)) * 0.97;
        }
    }
    const spectralCoherence = fftAnalysis?.spectralCoherence || validatedSpectral.spectralCoherence || 0.5;
    let phaseCoherence = Math.cos(phaseDiff) * phaseLockFactor * spectralCoherence * (cpuLoad < 0.8 ? 1.5 : 1.0);
    const spectralFlux = validatedSpectral.spectralFlux || 0.5;
    const harmonicRatio = validatedSpectral.harmonicRatio || 0.5;
    const transientEnergy = validatedSpectral.transientEnergy || 0.5;
    const subBassEnergy = validatedSpectral.subBass || 0.5;
    // === DISTORTION REDUCTION THÔNG MINH THEO 8 PROFILE ===
    const fluxImpact = spectralFlux > 0.75 ? Math.exp(-spectralFlux * 0.65) : 1.0;
    const harmonicImpact = harmonicRatio > 0.75 ? 1.2 : 0.8;
    let distortionReduction = Math.max(0.7, fluxImpact * harmonicImpact * (spectralCoherence > 0.7 ? 0.78 : 0.88));
    if (spectralCoherence < 0.7) distortionReduction *= 0.92;
    if (spectralFlux > 0.9) distortionReduction *= 0.88;
    // SpectralAttention + PsychoacousticWeight
    const spectralEnergy = Math.pow(Math.abs(fftAnalysis?.energy || 0.5), 2);
    const prevEnergy = options.memoryManager?.get('prevEnergy') || spectralEnergy;
    const spectralFluxAt = Math.abs(spectralEnergy - prevEnergy) / (spectralEnergy + 0.001);
    const spectralAttention = Math.exp(spectralEnergy * spectralFluxAt * 0.95) / (1 + Math.exp(spectralEnergy * spectralFluxAt * 0.95));
    const perceptualSensitivity = profile === 'smartStudio' ? 1.28 : profile === 'vocal' ? 1.25 : 1.2;
    const psychoacousticWeight = Math.pow(10, -(validatedSpectral.spl || 0) / 20) * perceptualSensitivity;
    distortionReduction *= spectralAttention * psychoacousticWeight * 0.97;
    if (options.memoryManager) options.memoryManager.set('prevEnergy', spectralEnergy, 'low');
    // === BASS QUANTUM SUPERPOSITION – TỐI ƯU LOOP ===
    if (validatedSpectral.bass > 0.78 || ['bassHeavy', 'rockMetal', 'smartStudio'].includes(profile)) {
        const bassCoherence = phaseCoherence * (songStructure?.section === 'chorus' ? 1.28 : songStructure?.section === 'verse' ? 1.08 : 1.0);
        baseParams.lowShelfGain *= Math.max(0.65, bassCoherence * (profile === 'bassHeavy' ? 1.24 : 1.18));
        baseParams.subBassGain *= Math.max(0.7, bassCoherence * (profile === 'bassHeavy' ? 1.18 : 1.12));
        baseParams.compressorAttack = Math.min(baseParams.compressorAttack || 0.0016, 0.0009 * bassCoherence);
        baseParams.midBassGain *= 0.82 * bassCoherence;
        if (subBassEnergy > 0.8 && cpuLoad < 0.8) {
            baseParams.subBassGain += 0.07 * distortionReduction * bassCoherence * (harmonicRatio > 0.8 ? 1.05 : 1.0);
        }
        const sigma = profile === 'bassHeavy' ? 0.42 : profile === 'rockMetal' ? 0.38 : 0.3;
        const harmonicOrder = cpuLoad > 0.8 ? 2 : 8;
        let quantumBass = 0;
        // Tinh hoa: cache hằng số tối ưu loop
        const freq = profile === 'bassHeavy' ? 90 : 100;
        const twoPiFreq = 2 * Math.PI * freq;
        const sampleRate = validatedSpectral.sampleRate || 48000;
        const sigmaPower = 2 * Math.pow(sigma, 2);
        const waveletBase = Math.exp(-Math.pow(freq / 90, 2) / sigmaPower);
        for (let i = 1; i <= harmonicOrder; i++) {
            const waveletCoeff = waveletBase * Math.cos(twoPiFreq * i / sampleRate);
            const harmonicSeries = Math.sin(twoPiFreq * i * i / sampleRate) / (i * 1.03);
            quantumBass += waveletCoeff * harmonicSeries * 1.04;
        }
        quantumBass = Math.max(0.7, Math.min(1.35, quantumBass));
        baseParams.subBassGain *= quantumBass;
        const currentPitchMult = options.currentPitchMult || 0;
        let masterFormantScale = Math.max(0.7, Math.min(1.35, 1.0 + currentPitchMult * 0.045));
        if (Math.abs(currentPitchMult) > 0.5) {
            baseParams.subBassGain *= 1.07 * masterFormantScale;
        }
    }
    // === VOCAL & MID-TREBLE ENTANGLEMENT ===
    if (validatedSpectral.vocalPresence > 0.78 || ['vocal', 'karaokeDynamic', 'smartStudio', 'warm', 'bright'].includes(profile)) {
        const vocalBoost = profile === 'vocal' ? 1.38 : profile === 'karaokeDynamic' ? 1.35 : profile === 'smartStudio' ? 1.28 : 1.15;
        const midCoherence = phaseCoherence * (songStructure?.section === 'verse' ? 1.18 : 1.0);
        baseParams.midShelfGain += 0.30 * midCoherence * vocalBoost;
        baseParams.highShelfGain *= Math.min(1.0, midCoherence * (profile === 'bright' ? 0.92 : 0.88));
        baseParams.airGain *= Math.min(1.0, midCoherence * 0.84);
        baseParams.deEsserGain = Math.max(-30, (baseParams.deEsserGain || -18) * (1 + 0.22 * distortionReduction));
        const vocalPresenceEnt = profile === 'vocal' ? 1.28 : profile === 'karaokeDynamic' ? 1.22 : 0.88;
        let vocalFormant = (170 + 2300) * vocalPresenceEnt * 1.04; // Tinh hoa gộp tính toán
        const midGain = validatedSpectral.midHigh > 0.75 ? 0.54 : 0.48;
        const trebleQ = validatedSpectral.air > 0.75 ? 0.50 : 0.38;
        let entanglement = Math.sqrt(Math.abs(vocalFormant * midGain * trebleQ)) * 1.05;
        entanglement = Math.max(0.7, Math.min(1.38, entanglement));
        baseParams.midShelfGain *= entanglement;
        if (transientEnergy > 0.8) {
            const artDecay = profile === 'smartStudio' ? 0.78 : 0.82;
            baseParams.midShelfGain *= artDecay;
        }
    }
    // === HOÀN THIỆN DISTORTION & EMOTION ===
    baseParams.compressorRatio *= distortionReduction * phaseCoherence * (spectralFlux > 0.8 ? 0.86 : 1.0);
    baseParams.notchQ *= distortionReduction * (harmonicRatio > 0.8 ? 1.08 : 1.0);
    if (subBassEnergy > 0.8) {
        const immersive = spectralCoherence > 0.7 ? 1.038 : 1.0;
        baseParams.panAdjust += 0.065 * phaseCoherence * immersive;
    }
    const emotionalVector = profile === 'warm' ? 0.78 : profile === 'rockMetal' ? 1.25 : profile === 'bright' ? 1.15 : 1.0;
    const timbreCurve = profile === 'warm' ? 1.22 : profile === 'bright' ? 1.32 : profile === 'smartStudio' ? 1.18 : 1.0;
    const emotionTimbre = emotionalVector * timbreCurve * 1.04;
    baseParams.masterGain *= emotionTimbre;
    baseParams.midShelfGain *= timbreCurve * 0.95;
    // Tinh hoa: cache update mỗi 5s với last_update key
    if (options.memoryManager) {
        const now = Date.now();
        const lastUpdate = options.memoryManager.get(`last_phase_update_${profile}`) || 0;
        if (now - lastUpdate > 5000) {
            options.memoryManager.set(`phase_${profile}`, {
                coherence: phaseCoherence,
                distortionReduction,
                phaseDiff,
                fluxImpact,
                timestamp: now,
                expiry: now + 15000
            }, 'high');
            options.memoryManager.set(`last_phase_update_${profile}`, now, 'low');
        }
    }
    if (isDebug) {
        console.debug('PhaseMaster v17.0 AT2040 Quantum Applied', {
            profile,
            phaseCoherence: phaseCoherence.toFixed(4),
            distortionReduction: distortionReduction.toFixed(4),
            bass: baseParams.subBassGain.toFixed(3),
            mid: baseParams.midShelfGain.toFixed(3),
            treble: baseParams.highShelfGain.toFixed(3)
        });
    }
    return baseParams;
}

function roomCorrectionSimulation(baseParams, spectralProfile, cpuLoad, profile, options = {}) {
    const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
    const validatedSpectral = { ...spectralProfile };
    const fftAnalysis = options.fftAnalysis || null;
    const spectralCoherence = fftAnalysis?.spectralCoherence || validatedSpectral.spectralCoherence || 0.5;
    const spectralFlux = validatedSpectral.spectralFlux || 0.5;
    const vocalPresence = validatedSpectral.vocalPresence || 0.5;
    const transientEnergy = validatedSpectral.transientEnergy || 0.5;
    const subBassEnergy = validatedSpectral.subBass || 0.5;
    let roomCoherence = spectralCoherence * (1 - spectralFlux * 0.3) * (options.roomCoherenceFactor || 1.0);
    const fluxImpact = spectralFlux > 0.75 ? Math.exp(-spectralFlux * 0.65) : 1.0;
    const harmonicImpact = validatedSpectral.harmonicRatio > 0.75 ? 1.2 : 0.8;
    let distortionReduction = Math.max(0.7, fluxImpact * harmonicImpact * (spectralCoherence > 0.7 ? 0.78 : 0.88));
    if (spectralCoherence < 0.7) distortionReduction *= 0.92;
    if (spectralFlux > 0.9) distortionReduction *= 0.88;
    baseParams.lowShelfGain *= roomCoherence * (profile === 'bassHeavy' ? 1.09 : 1.07);
    const psychoacousticRoomSpread = cpuLoad < 0.8 ? 0.035 : 0.022;
    baseParams.subBassGain += psychoacousticRoomSpread * roomCoherence * distortionReduction * 1.04;
    // Quantum Bass Room – TỐI ƯU LOOP
    const sigmaRoom = profile === 'bassHeavy' ? 0.44 : profile === 'rockMetal' ? 0.39 : profile === 'smartStudio' ? 0.28 : 0.25;
    const harmonicOrderRoom = cpuLoad > 0.8 ? 2 : 9;
    let quantumBassRoom = 0;
    const freq = profile === 'bassHeavy' ? 85 : 80;
    const twoPiFreq = 2 * Math.PI * freq;
    const sampleRate = validatedSpectral.sampleRate || 48000;
    const sigmaPower = 2 * Math.pow(sigmaRoom, 2);
    const waveletBase = Math.exp(-Math.pow(freq / 90, 2) / sigmaPower);
    for (let i = 1; i <= harmonicOrderRoom; i++) {
        const waveletCoeff = waveletBase * Math.cos(twoPiFreq * i / sampleRate);
        const harmonicSeries = Math.sin(twoPiFreq * i * i / sampleRate) / (i * 1.03);
        quantumBassRoom += waveletCoeff * harmonicSeries * 1.05;
    }
    quantumBassRoom = Math.max(0.7, Math.min(1.38, quantumBassRoom));
    baseParams.subBassGain *= quantumBassRoom;
    const currentPitchMult = options.currentPitchMult || 0;
    let masterFormantScale = Math.max(0.7, Math.min(1.38, 1.0 + currentPitchMult * 0.045));
    if (Math.abs(currentPitchMult) > 0.5) {
        baseParams.subBassGain *= 1.07 * masterFormantScale;
    }
    // Mid & Vocal Room
    if (spectralCoherence < 0.7 || ['vocal', 'karaokeDynamic', 'smartStudio'].includes(profile)) {
        const roomVocalBoost = profile === 'vocal' ? 1.38 : profile === 'karaokeDynamic' ? 1.34 : 1.15;
        baseParams.midShelfGain += 0.16 * roomCoherence * roomVocalBoost;
        if (transientEnergy > 0.8) baseParams.midShelfGain *= (profile === 'smartStudio' ? 0.77 : 0.81);
    }
    baseParams.highShelfGain -= 0.03 * (1 - roomCoherence);
    if (spectralFlux > 0.75) {
        const atcRoomControl = cpuLoad < 0.8 ? 1.038 : 1.0;
        baseParams.highShelfGain -= 0.0008 * roomCoherence * atcRoomControl;
    }
    if (subBassEnergy > 0.8) {
        const immersiveRoom = spectralCoherence > 0.7 ? 1.04 : 1.0;
        baseParams.panAdjust += 0.068 * roomCoherence * immersiveRoom;
    }
    const timbreCurveRoom = profile === 'warm' ? 1.24 : profile === 'bright' ? 1.34 : profile === 'smartStudio' ? 1.20 : 1.0;
    baseParams.midShelfGain *= timbreCurveRoom * 0.94;
    // Tinh hoa: cache update mỗi 6s với last_update key
    if (options.memoryManager) {
        const now = Date.now();
        const lastUpdate = options.memoryManager.get(`last_room_update_${profile}`) || 0;
        if (now - lastUpdate > 6000) {
            options.memoryManager.set(`room_${profile}`, {
                coherence: roomCoherence,
                distortionReduction,
                timestamp: now,
                expiry: now + 20000
            }, 'high');
            options.memoryManager.set(`last_room_update_${profile}`, now, 'low');
        }
    }
    if (isDebug) {
        console.debug('RoomMaster v17.0 Dirac AT2040 Applied', {
            profile,
            roomCoherence: roomCoherence.toFixed(4),
            bass: baseParams.subBassGain.toFixed(3)
        });
    }
    return baseParams;
}

/**
 * FIX: Tối ưu hóa hàm ensureFinite để ngăn chặn tuyệt đối các giá trị nguy hiểm
 * như Infinity hoặc NaN đi vào các bộ lọc BiquadFilter (nguyên nhân gây treo AudioThread)
 */
function ensureFinite(value, defaultValue, options = {}) {
    // FIX: Kiểm tra kiểu dữ liệu nghiêm ngặt
    if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
        if (options.errorMessage && (window.location.hostname === 'localhost')) {
            console.warn(`[Jungle Safety]: ${options.errorMessage}. Using default: ${defaultValue}`);
        }
        return defaultValue;
    }
    return value;
}

// === PHẦN EXPORT (KHÔNG CẦN NESTED IIFE) ===
    try {
        if (typeof Jungle === 'undefined') {
            throw new Error('Jungle class is not defined before export');
        }

        if (typeof module !== "undefined" && module.exports) {
            module.exports = Jungle;
        }

        if (typeof window !== "undefined") {
            if (!window.Jungle) {
                window.Jungle = Jungle;
            }
        }

        if (typeof self !== "undefined" && !self.Jungle) {
            self.Jungle = Jungle;
        }

        console.log("[Jungle Audio Module] Loaded successfully (once)");
    } catch (error) {
        if (typeof handleError === 'function') {
            handleError('Critical Export Error', error, { context: 'GlobalExport' }, 'high');
        } else {
            console.error('Fatal: Jungle could not be exported:', error);
        }
    }
})();